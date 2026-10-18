const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {toolSsh}=require('./helpers/toolSsh');
const {createSessionManager}=require('../src/main/sessions');
const {registerServerToolsIpc}=require('../src/main/server-tools-ipc');
const ID='a'.repeat(64);
function fixture(handler){
 const ssh=toolSsh(handler || (command=>({stdout:command.includes('inspect')?JSON.stringify({id:ID,name:'/web',state:{Status:'running',Pid:42}}):''})));
 const profile={id:'s1',name:'Fixture VPS',username:'root',nginx:{nginxBin:'/usr/sbin/nginx'}};
 const sessions=createSessionManager({open:async()=>ssh.conn,getProfile:()=>profile,makeOps:()=>({})});
 const handlers={},sender=new EventEmitter();sender.send=()=>{};sender.isDestroyed=()=>false;
 let approve=false;const prompts=[];
 registerServerToolsIpc({handle:(name,fn)=>handlers[name]=fn,sessions,dialog:{showMessageBox:async(_win,options)=>{prompts.push(options);return{response:approve?1:0};}},winOf:()=>null,getProfile:()=>profile,askSudoPassword:async()=>null});
 const input=value=>({requestId:crypto.randomUUID(),...value});
 return{...ssh,sessions,handlers,sender,prompts,input,approve:()=>approve=true,event:{sender}};
}
test('Docker broker requires SSH and native confirmation before mutation',async()=>{
 const s=fixture();assert.equal((await s.handlers['docker:call'](s.event,'s1','list',s.input({}))).code,'NOT_CONNECTED');
 await s.sessions.connect('s1',{});const input=s.input({id:ID,action:'restart'});
 assert.equal((await s.handlers['docker:call'](s.event,'s1','action',input)).cancelled,true);
 assert.equal(s.commands.some(c=>c.command.includes('container restart')),false);
 s.approve();assert.equal((await s.handlers['docker:call'](s.event,'s1','action',s.input({id:ID,action:'restart'}))).ok,true);
 assert.equal(s.prompts.length,2);assert.ok(s.prompts[1].message.includes('web')&&s.prompts[1].detail.includes('Fixture VPS'));
 s.sessions.closeAll();
});
test('Docker cancellation is scoped to sender and server and preserves the SSH session',async()=>{
 const s=fixture(()=>null);await s.sessions.connect('s1',{});
 const input=s.input({id:ID,lines:300});const pending=s.handlers['docker:call'](s.event,'s1','logs',input);
 assert.equal((await s.handlers['docker:cancel']({sender:new EventEmitter()},'s1',input.requestId)).cancelled,false);
 assert.equal((await s.handlers['docker:cancel'](s.event,'other',input.requestId)).cancelled,false);
 assert.equal((await s.handlers['docker:cancel'](s.event,'s1',input.requestId)).cancelled,true);
 assert.equal((await pending).code,'CANCELLED');assert.equal(s.sessions.isConnected('s1'),true);s.sessions.closeAll();
});
test('destroyed renderer and reconnected SSH cannot deliver old Docker reads to a new session',async()=>{
 const s=fixture(()=>null);await s.sessions.connect('s1',{});
 const first=s.handlers['docker:call'](s.event,'s1','logs',s.input({id:ID,lines:100}));s.sender.emit('destroyed');
 assert.equal((await first).code,'CANCELLED');
 const second=s.handlers['docker:call'](s.event,'s1','logs',s.input({id:ID,lines:100}));await s.sessions.connect('s1',{});
 assert.equal((await second).code,'NOT_CONNECTED');assert.equal(s.sessions.isConnected('s1'),true);s.sessions.closeAll();
});

test('SSL confirmation reserves Nginx writes and only emits syntax invalidation after approval',async()=>{
 const certificate='Found the following certs:\n  Certificate Name: example.com\n    Domains: example.com\n    Expiry Date: 2027-10-18 10:00:00+00:00 (VALID: 365 days)\n';
 const s=fixture(command=>({stdout:command.includes(' certificates')?certificate:'',stderr:command.includes(' -V')?'configure arguments: --conf-path=/etc/nginx/nginx.conf':''}));
 await s.sessions.connect('s1',{});let approve;const packets=[];s.sender.send=(channel,packet)=>packets.push({channel,packet});
 // Exercise the real session reservation with delayed external confirmation.
 const pending=s.sessions.ssl('s1','issue',{domains:['example.com'],email:'owner@example.com',redirect:true,agreeTerms:true},{confirm:()=>new Promise(r=>approve=r)});
 assert.equal(s.sessions.sslBusy('s1'),true);assert.equal(s.sessions.busyActions('s1'),true);
 assert.equal((await s.sessions.call('s1','write','example.com','new config')).code,'BUSY');
 assert.throws(()=>s.sessions.acquireWrite('s1'),e=>e.code==='BUSY');
 assert.equal((await s.sessions.system('s1','action',{unit:'nginx.service',action:'restart'},{confirm:async()=>true})).code,'BUSY');
 approve(false);assert.equal((await pending).cancelled,true);assert.equal(s.sessions.sslBusy('s1'),false);
 assert.equal(packets.length,0);
 s.approve();const result=await s.handlers['ssl:call'](s.event,'s1','issue',s.input({domains:['example.com'],email:'owner@example.com',redirect:true,agreeTerms:true}));
 assert.equal(result.ok,true);assert.equal(packets.filter(p=>p.channel==='tools:event'&&p.packet.type==='nginx-changed').length,1);s.sessions.closeAll();
});
test('SSL cannot begin during an existing file/Nginx write or blocked workspace and releases reservations',async()=>{
 const s=fixture();await s.sessions.connect('s1',{});
 const release=s.sessions.acquireWrite('s1');
 assert.equal((await s.sessions.ssl('s1','renew',{name:'example.com'},{confirm:async()=>true})).code,'BUSY');
 release();release();
 assert.equal((await s.sessions.ssl('s1','renew',{name:'example.com'},{canStart:()=>false,confirm:async()=>true})).code,'BUSY');
 assert.equal(s.sessions.sslBusy('s1'),false);assert.equal(s.commands.length,0);s.sessions.closeAll();
});
