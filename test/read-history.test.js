const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createReadHistory}=require('../src/main/read-history');
const base={id:'server-a',host:'203.0.113.1',port:22,username:'deploy',auth:'password',nginx:{available:'/etc/nginx/sites-available',enabled:'/etc/nginx/sites-enabled',nginxBin:'/usr/sbin/nginx'}};
const data={containers:[{id:'a'.repeat(64),name:'web',image:'nginx:alpine',state:'running',status:'Up',ports:'80/tcp',cpu:'1%',memory:'10MiB',memoryPercent:'1%',env:'SECRET',privateKey:'SECRET'}],notice:''};
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'labserver-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let profile={...base},fingerprint='SHA256:first';const options={getProfile:id=>id===profile.id?profile:null,getHostKey:()=>fingerprint};return{dir,options,history:createReadHistory(dir,options),setProfile:value=>profile=value,setFingerprint:value=>fingerprint=value};}
test('successful snapshots persist across app restarts with timestamp and allowlisted metadata only',t=>{
 const f=setup(t),ticket=f.history.begin(base.id,'docker');const saved=f.history.save(ticket,data);assert.ok(Number.isFinite(Date.parse(saved.recordedAt)));
 const restored=createReadHistory(f.dir,f.options).read(base.id,'docker');assert.equal(restored.data.containers[0].name,'web');assert.equal(restored.recordedAt,saved.recordedAt);assert.equal(JSON.stringify(restored).includes('SECRET'),false);
 assert.equal(f.history.read(base.id,'logs'),null);assert.equal(f.history.read('other','docker'),null);
 if(process.platform!=='win32'){const file=fs.readdirSync(path.join(f.dir,'read-history'))[0];assert.equal(fs.statSync(path.join(f.dir,'read-history',file)).mode&0o777,0o600);}
});
test('endpoint account nginx path and trusted host key changes cannot reuse previous snapshots',t=>{
 const f=setup(t);const key=f.history.key(base.id);f.history.save(f.history.begin(base.id,'docker',key),data);
 for(const profile of [{...base,host:'203.0.113.2'},{...base,username:'root'},{...base,nginx:{...base.nginx,available:'/different'}}]){f.setProfile(profile);assert.equal(f.history.read(base.id,'docker'),null);assert.equal(f.history.begin(base.id,'docker',key),null);}
 f.setProfile(base);f.setFingerprint('SHA256:changed');assert.equal(f.history.read(base.id,'docker'),null);assert.equal(f.history.save(f.history.begin(base.id,'docker',key),data),null);
});
test('older reads and pre-mutation reads cannot overwrite the latest snapshot; empty success is cached',t=>{
 const f=setup(t);const old=f.history.begin(base.id,'docker'),fresh=f.history.begin(base.id,'docker');f.history.save(fresh,{containers:[],notice:''});assert.equal(f.history.save(old,data),null);assert.equal(f.history.read(base.id,'docker').data.containers.length,0);
 const pending=f.history.begin(base.id,'docker');f.history.invalidate(base.id,['docker']);assert.equal(f.history.save(pending,data),null);assert.equal(f.history.read(base.id,'docker'),null);
 f.history.save(f.history.begin(base.id,'docker'),data);f.history.remove(base.id);assert.equal(f.history.read(base.id,'docker'),null);
});
test('corrupt oversize unknown or unavailable cache data becomes a miss without breaking live reads',t=>{
 const f=setup(t);f.history.save(f.history.begin(base.id,'docker'),data);const folder=path.join(f.dir,'read-history');const file=path.join(folder,fs.readdirSync(folder)[0]);fs.writeFileSync(file,'broken-json');assert.equal(f.history.read(base.id,'docker'),null);
 assert.equal(f.history.save(f.history.begin(base.id,'docker'),{containers:[{id:'bad'}]}),null);
 assert.equal(f.history.save(f.history.begin(base.id,'docker'),{...data,notice:'x'.repeat(2*1024*1024)}),null);
 const blocked=path.join(f.dir,'blocked');fs.writeFileSync(blocked,'file');const unavailable=createReadHistory(blocked,f.options);assert.equal(unavailable.read(base.id,'docker'),null);assert.equal(unavailable.save(unavailable.begin(base.id,'docker'),data),null);
});
