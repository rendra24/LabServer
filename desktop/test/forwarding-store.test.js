const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../src/main/store');
const {collectBackup,encryptBackup,decryptBackup,restoreBackup,summarizeBackup}=require('../src/main/backup');
const base={name:'VPS',host:'203.0.113.9',username:'deploy',auth:'password'};
const tunnel={id:'11111111-1111-4111-8111-111111111111',name:'MySQL',localPort:13307,remoteHost:'127.0.0.1',remotePort:3306};
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'labserver-forward-store-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return{dir,store:createStore(dir,null)};}
test('saved tunnels survive unrelated server edits and portable backup restore without runtime state',async t=>{
 const a=setup(t),b=setup(t);const profile=a.store.save({...base,tunnels:[tunnel]});assert.deepEqual(profile.tunnels,[tunnel]);
 a.store.save({...base,id:profile.id,name:'Renamed'});assert.deepEqual(a.store.get(profile.id).tunnels,[tunnel]);
 const data=await decryptBackup(await encryptBackup(collectBackup(a.store),'long-backup-password'),'long-backup-password');
 assert.equal(summarizeBackup(data,b.store).tunnels,1);restoreBackup(data,b.store,b.dir,'keep');assert.deepEqual(b.store.get(profile.id).tunnels,[tunnel]);
 const old={...data,servers:data.servers.map(e=>({...e,profile:{...base,id:profile.id}}))};restoreBackup(old,b.store,b.dir,'update');assert.deepEqual(b.store.get(profile.id).tunnels,[tunnel]);
 a.store.save({...base,id:profile.id,tunnels:[]});assert.deepEqual(a.store.get(profile.id).tunnels,[]);
});
test('invalid or duplicate tunnel endpoints cannot replace saved server data',t=>{
 const {store,dir}=setup(t);const profile=store.save(base);const before=fs.readFileSync(path.join(dir,'servers.json'));
 for(const tunnels of [[{...tunnel,remoteHost:'host\nsecret'}],[tunnel,tunnel],[tunnel,{...tunnel,id:'22222222-2222-4222-8222-222222222222'}],[{...tunnel,localPort:80}],Array(33).fill(tunnel)])assert.throws(()=>store.save({...base,id:profile.id,tunnels}));
 assert.deepEqual(fs.readFileSync(path.join(dir,'servers.json')),before);
});
