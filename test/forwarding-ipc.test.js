const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {EventEmitter}=require('node:events');
const {createStore}=require('../src/main/store');
const {createSessionManager}=require('../src/main/sessions');
const {registerForwardingIpc}=require('../src/main/forwarding-ipc');
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'labserver-forward-ipc-'));const store=createStore(dir,null);const profile=store.save({name:'VPS',host:'203.0.113.5',username:'deploy',auth:'password'});
 const sessions=createSessionManager({getProfile:store.get,makeOps:()=>({}),open:async()=>{const client=new EventEmitter();return{client,end:()=>client.emit('close')};}});
 await sessions.connect(profile.id,{});const handlers={};let answer=async()=>({response:1});
 registerForwardingIpc({handle:(name,handler)=>handlers[name]=handler,sessions,store,winOf:()=>null,dialog:{showMessageBox:(...args)=>answer(...args)}});
 t.after(()=>{sessions.closeAll();fs.rmSync(dir,{recursive:true,force:true});});
 const sender=new EventEmitter();sender.isDestroyed=()=>false;
 return{store,profile,sessions,setAnswer:fn=>answer=fn,call:(op,input)=>handlers['tunnels:call']({sender},profile.id,op,input)};
}
const input={name:'MySQL',localPort:13307,remoteHost:'127.0.0.1',remotePort:3306};
test('tunnel IPC saves only validated profiles and refuses active edits/deletes',async t=>{
 const f=await setup(t);const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 let result=await f.call('save',{...input,localPort:port});assert.equal(result.ok,true);const id=result.data.tunnels[0].id;
 assert.equal((await f.call('start',{id})).ok,true);assert.equal(f.sessions.hasTunnels(f.profile.id),true);
 assert.equal((await f.call('save',{...input,id,localPort:port})).code,'BUSY');assert.equal((await f.call('remove',{id})).code,'BUSY');
 f.setAnswer(async()=>({response:0}));assert.equal((await f.call('stop',{id})).cancelled,true);assert.equal(f.sessions.hasTunnels(f.profile.id),true);
 f.setAnswer(async()=>({response:1}));assert.equal((await f.call('stop',{id})).ok,true);assert.equal(f.sessions.hasTunnels(f.profile.id),false);
 assert.equal((await f.call('remove',{id})).ok,true);assert.deepEqual(f.store.get(f.profile.id).tunnels,[]);
});
test('late stop confirmation cannot touch a replacement SSH session and mutations are serialized',async t=>{
 const f=await setup(t);const saved=await f.call('save',input);const id=saved.data.tunnels[0].id;let approve;
 f.setAnswer(()=>new Promise(r=>approve=r));const removing=f.call('remove',{id});await new Promise(r=>setImmediate(r));
 assert.equal((await f.call('save',{...input,name:'Other',localPort:13308})).code,'BUSY');
 await f.sessions.connect(f.profile.id,{});approve({response:1});assert.equal((await removing).code,'NOT_CONNECTED');assert.equal(f.store.get(f.profile.id).tunnels.length,1);
});
test('tunnel IPC rejects arbitrary runtime targets and disconnected profile changes',async t=>{
 const f=await setup(t);assert.equal((await f.call('start',{id:'../../bad',...input})).ok,false);assert.equal((await f.call('exec',input)).code,'TUNNEL_INVALID');
 assert.equal((await f.call('save',{...input,bindHost:'0.0.0.0'})).code,'TUNNEL_INVALID');
 f.sessions.close(f.profile.id);assert.equal((await f.call('save',input)).code,'NOT_CONNECTED');
});
