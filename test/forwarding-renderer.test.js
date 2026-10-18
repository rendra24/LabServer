const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('completion from an old server cannot unlock a mutation on its replacement',async()=>{
 const nodes=new Map(),calls=[],shows={};const app={server:{id:'old-server'}};
 const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,value:'',textContent:'',open:false,addEventListener(){},replaceChildren(){},close(){this.open=false;}});return nodes.get(id);};
 const source=fs.readFileSync(path.join(__dirname,'../src/renderer/tunnels.js'),'utf8').replace(/^import .*;\n/gm,'');
 const {load,mutate}=vm.runInNewContext(source+'\n;({load,mutate})',{app,$,el(){},announce(){},onShow:(name,fn)=>shows[name]=fn,onLeave(){},window:{api:{tunnels:{call:(id,op)=>new Promise(resolve=>calls.push({id,op,resolve}))},terminal:{onEvent(){}}}}});
 const old=mutate('start',{id:'old-tunnel'});
 app.server={id:'new-server'};shows.tunnels();calls[1].resolve({ok:true,data:{tunnels:[]}});await new Promise(r=>setImmediate(r));
 const current=mutate('start',{id:'new-tunnel'});
 calls[0].resolve({ok:true,data:{tunnels:[]}});await old;
 const refresh=load();if(calls[3])calls[3].resolve({ok:true,data:{tunnels:[]}});await refresh;
 assert.equal($('tunnel-new').disabled,true,'old completion must not unlock the current server');
 calls[2].resolve({ok:true,data:{tunnels:[]}});await current;
});
