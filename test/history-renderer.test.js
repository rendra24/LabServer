const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(feature){
 const nodes=new Map(),calls=[],hooks={};let resolveCache;const app={server:{id:'server-a',nginx:{available:'/etc/nginx/sites-available'}},syntaxValid:false};
 function node(){return{hidden:true,open:false,value:'',dataset:{},children:[],addEventListener(){},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},querySelectorAll(){return[];},querySelector(){return null;},close(){this.open=false;},focus(){}};}
 const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};$('view-'+feature).hidden=false;$('svc-filter').value='all';$('docker-filter').value='all';
 const remote=(...args)=>new Promise(resolve=>calls.push({args,resolve}));
 const api={system:{call:remote,cancel:async()=>{}},docker:{call:remote,cancel:async()=>{}},ssl:{call:remote,cancel:async()=>{}},sites:remote,onToolEvent(){}};
 const file={services:'system',docker:'docker',ssl:'ssl',sites:'sites'}[feature];
 const source=fs.readFileSync(path.join(__dirname,`../src/renderer/${file}.js`),'utf8').replace(/^import .*;\n/gm,'').replace(/export (async function|function)/g,'$1');
 const fn={services:'loadServices',docker:'load',ssl:'load',sites:'loadSites'}[feature];
 const sourceHistory=fs.readFileSync(path.join(__dirname,'../src/renderer/history.js'),'utf8').replace(/export (async function|function)/g,'$1');
 api.history={get:()=>new Promise(resolve=>resolveCache=resolve)};
 const context=vm.createContext({app,$,el:node,announce(){},showError(){},show(){},invalidateSyntax(){},createDiag:()=>({refresh(){}}),onShow:(name,fn)=>hooks[name]=fn,onLeave(){},guardFileChanges:async()=>true,crypto:{randomUUID:()=>String(calls.length)},setTimeout,clearTimeout,window:{api}});
 vm.runInContext(sourceHistory,context);const load=vm.runInContext(source+`;${fn}`,context);
 return{load,$,calls,app,cached:value=>resolveCache(value)};
}
const snapshots={
 services:{services:[{name:'nginx.service',description:'Nginx',load:'loaded',active:'active',sub:'running',startup:'enabled',template:false}]},
 docker:{containers:[{id:'a'.repeat(64),name:'web',image:'nginx',state:'running',status:'Up',ports:'80/tcp',cpu:'1%',memory:'10MiB',memoryPercent:'1%'}],notice:''},
 ssl:{certificates:[{name:'example.com',domains:['example.com'],expiresAt:Date.now()+86400000,supported:true,validity:'valid'}]},
 sites:[{name:'example.com',enabled:true,conflict:false,mtime:1,size:10}],
};
const ids={services:['svc-total','svc-rows','svc-history'],docker:['docker-total','docker-rows','docker-history'],ssl:['ssl-total','ssl-rows','ssl-history'],sites:[null,'sites-rows','sites-history']};
for(const feature of Object.keys(snapshots))test(`${feature} displays persistent history before the live response and retains it on failure`,async()=>{
 const f=fixture(feature),loading=f.load();f.cached({recordedAt:'2026-10-18T00:00:00.000Z',data:snapshots[feature]});await new Promise(r=>setImmediate(r));
 const [total,rows,status]=ids[feature];assert.equal(f.$(rows).children.length,1);if(total)assert.equal(f.$(total).textContent,1);assert.match(f.$(status).textContent,/Data terakhir/);assert.equal(f.calls.length,1);
 f.calls[0].resolve({ok:false,message:'Network failure'});await loading;
 assert.equal(f.$(rows).children.length,1);if(total)assert.equal(f.$(total).textContent,1);assert.match(f.$(status).textContent,/gagal/);
});
for(const feature of Object.keys(snapshots))test(`${feature} ignores history returned after the active server changes`,async()=>{
 const f=fixture(feature),loading=f.load();f.app.server={id:'other-server'};f.cached({recordedAt:'2026-10-18T00:00:00.000Z',data:snapshots[feature]});await loading;
 assert.equal(f.$(ids[feature][1]).children.length,0);assert.equal(f.calls.length,0);
});
