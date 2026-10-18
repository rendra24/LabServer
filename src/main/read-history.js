const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const FEATURES = ['services','docker','ssl','sites'];
const MAX_FILE = 1048576, MAX_TOTAL = 64 * MAX_FILE, MAX_ENTRIES = 256;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function text(value, max = 4096) { if (typeof value !== 'string' || value.length > max) throw new Error('Invalid cache'); return value; }
function rows(value) { if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid cache'); return value; }
function fields(row, keys) { return Object.fromEntries(keys.map(key => [key,text(row[key])])); }
function project(feature, data) {
  if (feature === 'services') return {services:rows(data.services).map(row => ({...fields(row,['name','description','load','active','sub','startup']),template:row.template === true}))};
  if (feature === 'docker') return {containers:rows(data.containers).map(row => {
    if (!/^[a-f0-9]{64}$/.test(row.id)) throw new Error('Invalid cache');
    return {...fields(row,['id','name','image','state','status','ports']),...Object.fromEntries(['cpu','memory','memoryPercent'].map(key=>[key,row[key] === null ? null : text(row[key],256)]))};
  }),notice:text(data.notice || '')};
  if (feature === 'ssl') return {certificates:rows(data.certificates).map(row => {
    if (row.expiresAt !== null && !Number.isFinite(row.expiresAt)) throw new Error('Invalid cache');
    return {name:text(row.name,1000),domains:rows(row.domains).map(value=>text(value,4096)),expiresAt:row.expiresAt,supported:row.supported === true,validity:['valid','invalid'].includes(row.validity)?row.validity:'unknown',testCertificate:row.testCertificate === true};
  })};
  if (feature === 'sites') return rows(data).map(row => ({name:text(row.name,255),enabled:row.enabled === true,conflict:row.conflict === true,size:Number.isFinite(row.size)?row.size:null,mtime:Number.isFinite(row.mtime)?row.mtime:0}));
  throw new Error('Invalid feature');
}

function createReadHistory(dir, {getProfile,getHostKey}) {
  const folder = path.join(dir,'read-history'), versions = new Map(), index = new Map();
  try {
    fs.mkdirSync(folder,{recursive:true,mode:0o700});
    for (const name of fs.readdirSync(folder)) {
      if (!/^[a-f0-9]{64}\.(services|docker|ssl|sites)\.json$/.test(name)) continue;
      const stat=fs.lstatSync(path.join(folder,name));if(stat.isFile())index.set(name,{size:stat.size,time:stat.mtimeMs});
    }
  } catch { /* Cache storage is optional; live requests must still work. */ }
  const file = (id,feature) => `${hash(id)}.${feature}.json`;
  const versionKey = (id,feature) => `${id}:${feature}`;
  function key(id, profile) {
    try {
      profile ||= getProfile(id);
      if (!profile) return null;
      return hash(JSON.stringify({id,host:profile.host?.toLowerCase(),port:profile.port || 22,username:profile.username,auth:profile.auth,keyPath:profile.keyPath || '',nginx:profile.nginx,fingerprint:getHostKey(profile.host,profile.port || 22)}));
    } catch { return null; }
  }
  function prune() {
    let total=[...index.values()].reduce((n,item)=>n+item.size,0);
    for(const [name,item] of [...index].sort((a,b)=>a[1].time-b[1].time)) {
      if(index.size<=MAX_ENTRIES&&total<=MAX_TOTAL)break;
      try{fs.unlinkSync(path.join(folder,name));}catch{ /* Ignore disposable cache errors. */ }
      index.delete(name);total-=item.size;
    }
  }
  prune();
  return {
    key,
    begin(id,feature,connectionKey) {
      if (!FEATURES.includes(feature)) return null;
      const context=key(id);if(!context||(connectionKey && connectionKey!==context))return null;
      const name=versionKey(id,feature),version=(versions.get(name)||0)+1;versions.set(name,version);
      return {id,feature,context,version};
    },
    save(ticket,data) {
      if(!ticket||versions.get(versionKey(ticket.id,ticket.feature))!==ticket.version||key(ticket.id)!==ticket.context)return null;
      let tmp;
      try {
        const recordedAt=new Date().toISOString();
        const content=JSON.stringify({version:1,context:ticket.context,recordedAt,data:project(ticket.feature,data)});
        const size=Buffer.byteLength(content);if(size>MAX_FILE)return null;
        const name=file(ticket.id,ticket.feature);tmp=path.join(folder,`${name}.${crypto.randomUUID()}.tmp`);
        fs.writeFileSync(tmp,content,{flag:'wx',mode:0o600});fs.renameSync(tmp,path.join(folder,name));
        index.set(name,{size,time:Date.now()});prune();return{recordedAt};
      } catch { return null; }
      finally { if(tmp)try{fs.unlinkSync(tmp);}catch{ /* Already renamed or unavailable. */ } }
    },
    read(id,feature,connectionKey) {
      if(!FEATURES.includes(feature))return null;
      const context=key(id);if(!context||(connectionKey && connectionKey!==context))return null;
      let fd;
      try {
        fd=fs.openSync(path.join(folder,file(id,feature)),fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>MAX_FILE)return null;
        const buffer=Buffer.alloc(MAX_FILE+1);const size=fs.readSync(fd,buffer,0,buffer.length,0);if(size>MAX_FILE)return null;
        const saved=JSON.parse(buffer.subarray(0,size));
        if(saved.version!==1||saved.context!==context||typeof saved.recordedAt!=='string'||!Number.isFinite(Date.parse(saved.recordedAt)))return null;
        return{recordedAt:saved.recordedAt,data:project(feature,saved.data)};
      } catch { return null; }
      finally { if(fd!==undefined)try{fs.closeSync(fd);}catch{ /* Optional cache IO. */ } }
    },
    invalidate(id,features=FEATURES) {
      for(const feature of features) {
        if(!FEATURES.includes(feature))continue;
        const name=versionKey(id,feature);versions.set(name,(versions.get(name)||0)+1);
        try{fs.unlinkSync(path.join(folder,file(id,feature)));}catch{ /* Missing caches are normal. */ }
        index.delete(file(id,feature));
      }
    },
    remove(id) { this.invalidate(id); },
  };
}
module.exports = { createReadHistory };
