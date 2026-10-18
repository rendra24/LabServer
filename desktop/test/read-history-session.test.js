const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createReadHistory}=require('../src/main/read-history');
const {createSessionManager}=require('../src/main/sessions');
const {toolSsh}=require('./helpers/toolSsh');
const profile={id:'server',name:'Fixture',host:'203.0.113.1',port:22,username:'root',auth:'password',nginx:{nginxBin:'/usr/sbin/nginx'}};
const ID='a'.repeat(64);
function setup(t,ops={list:async()=>[{name:'example.com',enabled:true,conflict:false,mtime:1,size:10}]}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'labserver-history-session-'));const history=createReadHistory(dir,{getProfile:()=>profile,getHostKey:()=> 'SHA256:fixture'});
 const sessions=createSessionManager({history,getProfile:()=>profile,makeOps:()=>ops,open:async()=>toolSsh(command=>({stdout:command.includes('container ls')?JSON.stringify({ID,Names:'web',Image:'nginx',State:'exited',Status:'Exited',Ports:''}):command.includes('inspect')?JSON.stringify({id:ID,name:'/web',state:{Status:'exited'}}):''})).conn});
 t.after(()=>{sessions.closeAll();fs.rmSync(dir,{recursive:true,force:true});});return{history,sessions};
}
test('live list results are cached on the owned connection, failed reads preserve history, disconnected snapshots stay inaccessible',async t=>{
 const f=setup(t);await f.sessions.connect('server',{});const result=await f.sessions.docker('server','list',{});assert.equal(result.ok,true);assert.ok(result.history.recordedAt);assert.equal(f.sessions.snapshot('server','docker').data.containers[0].name,'web');
 const failed=await f.sessions.docker('server','list',{sudo:'invalid'});assert.equal(failed.ok,false);assert.equal(f.sessions.snapshot('server','docker').data.containers.length,1);
 f.sessions.close('server');assert.equal(f.sessions.snapshot('server','docker'),null);await f.sessions.connect('server',{});assert.equal(f.sessions.snapshot('server','docker').data.containers[0].name,'web');
});
test('native cancel keeps snapshots while approved Docker mutations invalidate old list history',async t=>{
 const f=setup(t);await f.sessions.connect('server',{});await f.sessions.docker('server','list',{});
 await f.sessions.docker('server','action',{id:ID,action:'start'},{confirm:async()=>false});assert.ok(f.sessions.snapshot('server','docker'));
 await f.sessions.docker('server','action',{id:ID,action:'start'},{confirm:async()=>true});assert.equal(f.sessions.snapshot('server','docker'),null);
});
test('a late nginx list cannot repopulate cache after a write starts or session reconnects',async t=>{
 let finish,delayed=false;const ops={list:()=>delayed?new Promise(r=>finish=r):Promise.resolve([{name:'site',enabled:true,mtime:1}]),write:async()=>{}};
 const f=setup(t,ops);await f.sessions.connect('server',{});await f.sessions.call('server','list');assert.ok(f.sessions.snapshot('server','sites'));
 delayed=true;const stale=f.sessions.call('server','list');await f.sessions.call('server','write','site','changed');finish([{name:'old',enabled:true,mtime:1}]);await stale;assert.equal(f.sessions.snapshot('server','sites'),null);
 const old=f.sessions.call('server','list');await f.sessions.connect('server',{});finish([{name:'wrong',enabled:true,mtime:1}]);assert.equal((await old).code,'NOT_CONNECTED');assert.equal(f.sessions.snapshot('server','sites'),null);
});
