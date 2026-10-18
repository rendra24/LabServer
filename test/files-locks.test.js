const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {fileSftp}=require('./helpers/fileSftp');
const {registerFilesIpc}=require('../src/main/files-ipc');

test('a pending remote deletion reserves its path against upload, retry and editor reads',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'labserver-locks-'));
  await fs.mkdir(path.join(root,'remote/home/deploy'),{recursive:true});await fs.mkdir(path.join(root,'local'));
  await fs.writeFile(path.join(root,'remote/home/deploy/old.txt'),'old bytes');await fs.writeFile(path.join(root,'local/old.txt'),'new upload');
  const conn=fileSftp(path.join(root,'remote'));conn.client=new EventEmitter();
  const sender=new EventEmitter();sender.send=()=>{};sender.isDestroyed=()=>false;
  t.after(async()=>{sender.emit('destroyed');await fs.rm(root,{recursive:true,force:true});});
  const handlers={};registerFilesIpc({handle:(key,fn)=>{handlers[key]=fn;},sessions:{connection:()=>conn},store:{get:()=>({})},winOf:()=>null,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[path.join(root,'local')]}),showMessageBox:async()=>({response:1})}});
  const event={sender};const opened=await handlers['files:call'](event,'vps','open');const contextId=opened.data.contextId;
  const call=(op,args={})=>handlers['files:call'](event,'vps',op,{contextId,...args});
  const grant=(await handlers['files:pick'](event,'local')).data.grants[0];
  let reached;const blocked=new Promise(r=>{reached=r;});let release;
  const unlink=conn.s.unlink;conn.s.unlink=(p,cb)=>{release=()=>unlink(p,cb);reached();};
  const removing=call('remove',{paths:['/home/deploy/old.txt']});await blocked;
  try {
    const upload=await call('start',{direction:'upload',sources:[{grantId:grant.id,relative:'old.txt'}],destination:{path:'/home/deploy'}});
    assert.equal(upload.code,'BUSY');
    assert.equal((await call('read',{path:'/home/deploy/old.txt'})).code,'BUSY');
    assert.equal((await call('rename',{path:'/home/deploy/old.txt',name:'other.txt'})).code,'BUSY');
  } finally {release();await removing;}
  assert.equal((await call('mkdir',{path:'/home/deploy',name:'after-delete'})).ok,true,'lock releases after mutation');
});

test('SSL reservation blocks new remote writes while keeping reads available and reports dirty workspaces',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'labserver-ssl-files-'));
  await fs.mkdir(path.join(root,'remote/home/deploy'),{recursive:true});await fs.writeFile(path.join(root,'remote/home/deploy/config.txt'),'original');
  const conn=fileSftp(path.join(root,'remote'));conn.client=new EventEmitter();
  const sender=new EventEmitter();sender.send=()=>{};sender.isDestroyed=()=>false;let sslBusy=true;
  const handlers={};const files=registerFilesIpc({handle:(key,fn)=>handlers[key]=fn,sessions:{connection:()=>conn,sslBusy:()=>sslBusy,acquireWrite(){if(sslBusy)throw Object.assign(new Error('busy'),{code:'BUSY'});return()=>{};}},store:{get:()=>({})},winOf:()=>null,dialog:{showMessageBox:async()=>({response:1})}});
  t.after(async()=>{files.dispose();sender.emit('destroyed');await fs.rm(root,{recursive:true,force:true});});
  const event={sender};const opened=await handlers['files:call'](event,'vps','open');const contextId=opened.data.contextId;
  const call=(op,args={})=>handlers['files:call'](event,'vps',op,{contextId,...args});
  assert.equal((await call('list',{path:'/home/deploy'})).ok,true);
  const read=await call('read',{path:'/home/deploy/config.txt'});assert.equal(read.ok,true);
  assert.equal((await call('mkdir',{path:'/home/deploy',name:'must-not-exist'})).code,'BUSY');
  assert.equal((await call('rename',{path:'/home/deploy/config.txt',name:'renamed.txt'})).code,'BUSY');
  assert.equal((await call('save',{path:'/home/deploy/config.txt',text:'changed',revision:read.data.revision})).code,'BUSY');
  assert.equal(await fs.readFile(path.join(root,'remote/home/deploy/config.txt'),'utf8'),'original');
  sslBusy=false;await call('editor',{path:'/home/deploy/config.txt',dirty:true});assert.equal(files.blocksSsl('vps'),true);
  await call('editor',{path:null});assert.equal(files.blocksSsl('vps'),false);
  assert.equal((await call('mkdir',{path:'/home/deploy',name:'after-ssl'})).ok,true);
});
