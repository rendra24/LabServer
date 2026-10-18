const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function fixture(){
  const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{open:false,hidden:false,textContent:'',addEventListener(){},replaceChildren(){},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const editor={setValue(value){this.value=value;},getValue(){return this.value;},resize(){},focus(){},session:{on(){},setMode(){}},commands:{addCommand(command){this[command.name]=command;}}};
  const source=fs.readFileSync(path.join(__dirname,'../src/renderer/files-editor.js'),'utf8').replace(/^import .*;\n/,'').replace('export function','function');
  const create=vm.runInNewContext(source+';createFilesEditor',{$,el(){},busy:(_b,_l,fn)=>fn(),showError(){},document:{documentElement:{dataset:{}},addEventListener(){}},window:{ace:{config:{set(){}},edit:()=>editor},addEventListener(){}},requestAnimationFrame:fn=>fn(),setTimeout,clearTimeout});
  return {create,$,editor};
}
for(const change of ['server','context'])test(`editor discards a delayed read after its ${change} changes`,async()=>{
  const {create,$}=fixture();let server='A',context='session-1',resolve;const pins=[];
  const editor=create({serverId:()=>server,contextId:()=>context,request:async(op,args)=>{if(op==='read')return new Promise(r=>{resolve=r;});pins.push(args.path);return{ok:true};}});
  const loading=editor.open('/home/deploy/a.txt');await new Promise(r=>setImmediate(r));
  if(change==='server')server='B';else context='session-2';
  resolve({ok:true,data:{text:'old server text',revision:'old-revision'}});await loading;
  assert.equal($('fm-editor-dialog').open,false);
  assert.ok(!pins.includes('/home/deploy/a.txt'),'stale content must not pin the current session');
});

test('closing cannot discard the buffer while a save is in flight',async()=>{
  const {create,$,editor:ace}=fixture();let finish;
  const fileEditor=create({serverId:()=> 'A',contextId:()=> '1',request:async(op)=>op==='read'?{ok:true,data:{text:'original',revision:'v1'}}:op==='save'?new Promise(resolve=>{finish=resolve;}):{ok:true}});
  await fileEditor.open('/home/deploy/file.txt');ace.setValue('new user bytes');
  const saving=ace.commands.saveFile.exec();await new Promise(r=>setImmediate(r));
  const closing=fileEditor.guard(true);
  try {assert.equal($('fm-dirty-dialog').open,false);assert.equal(await closing,false);}
  finally {finish({ok:true,data:{revision:'v2'}});await saving;}
});
