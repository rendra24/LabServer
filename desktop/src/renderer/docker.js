import { app, onShow, onLeave, show } from './app.js';
import { $, el, announce } from './ui.js';
const api = window.api.docker;
const reads = new Map();
let server = null, containers = [], selected = '', page = 1, generation = 0, timer = null, action = null;
let logGeneration = 0, logRequest = null, logTimer = null, logContainer = null, logText = '';
const stateNames = { running: 'Berjalan', exited: 'Berhenti', created: 'Belum dijalankan', paused: 'Paused', restarting: 'Restarting', dead: 'Dead', removing: 'Removing' };
function message(id, text) { $(id).textContent = text || ''; $(id).hidden = !text; }
function lost(result, owner) {
  if (result.code !== 'NOT_CONNECTED' || app.server !== owner) return;
  const keepDns = !$('view-dns').hidden; app.server = null; show(keepDns ? 'dns' : 'servers', { preserve: keepDns });
}
function cancelReads() { for (const [id, owner] of reads) api.cancel(owner, id).catch(() => {}); reads.clear(); }
function pause() { clearTimeout(timer); timer = null; $('docker-auto').checked = false; }
function controls() {
  const container = containers.find(row => row.id === selected), busy = action?.server === app.server;
  $('docker-selected').textContent = busy ? `${action.name}: ${action.type} sedang diproses…` : container ? `Terpilih: ${container.name}` : 'Pilih container untuk menjalankan tindakan';
  for (const name of ['start','stop','restart','log','terminal']) $(`docker-${name}`).disabled = !container || busy || (name === 'start' && !['exited','created'].includes(container.state)) || (['stop','terminal'].includes(name) && container.state !== 'running') || (name === 'restart' && ['dead','removing'].includes(container.state));
}
function render() {
  const query = $('docker-search').value.trim().toLocaleLowerCase(), filter = $('docker-filter').value;
  const visible = containers.filter(row => `${row.name} ${row.image}`.toLocaleLowerCase().includes(query) && (filter === 'all' || row.state === filter));
  const pages = Math.max(1, Math.ceil(visible.length / 100)); page = Math.min(page, pages);
  $('docker-total').textContent = containers.length; $('docker-running').textContent = containers.filter(row => row.state === 'running').length; $('docker-stopped').textContent = containers.filter(row => ['exited','created'].includes(row.state)).length;
  $('docker-empty').hidden = Boolean(visible.length); $('docker-table').hidden = !visible.length;
  $('docker-page-status').textContent = `${visible.length} container · Halaman ${page} dari ${pages}`; $('docker-prev').disabled = page <= 1; $('docker-next').disabled = page >= pages;
  $('docker-rows').replaceChildren(...visible.slice((page-1)*100,page*100).map(container => {
    const radio = el('input',{attrs:{type:'radio',name:'docker-selection','aria-label':`Pilih container ${container.name}`}}); radio.checked = container.id === selected;
    const row = el('tr',{cls:radio.checked?'is-selected':'',attrs:{tabindex:'0','aria-selected':String(radio.checked)}});
    const choose = () => { selected=container.id; render(); $('docker-rows').querySelector('input:checked')?.focus(); };
    radio.addEventListener('change',choose); row.addEventListener('click',choose); row.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();choose();}});
    row.append(el('td',{},radio),el('td',{},el('strong',{text:container.name}),el('small',{text:container.image}),el('small',{text:container.id.slice(0,12)})),el('td',{},el('span',{text:stateNames[container.state]||container.state,cls:`svc-badge ${container.state==='running'?'is-running':container.state==='dead'?'is-failed':''}`}),el('small',{text:container.status})),el('td',{text:container.ports||'—',cls:'docker-ports'}),el('td',{cls:'docker-resource'},el('span',{text:`CPU ${container.cpu||'—'}`}),el('small',{text:`RAM ${container.memory||'—'}`})));
    return row;
  })); controls();
}
async function load() {
  const owner=app.server; if(!owner || $('view-docker').hidden)return;
  const ticket=++generation;clearTimeout(timer);cancelReads();message('docker-error','');$('docker-refresh').disabled=true;$('docker-loading').hidden=false;$('docker-table').hidden=true;$('docker-empty').hidden=true;
  for(const name of ['start','stop','restart','log','terminal'])$(`docker-${name}`).disabled=true;
  const requestId=crypto.randomUUID();reads.set(requestId,owner.id);
  let result;try{result=await api.call(owner.id,'list',{requestId,sudo:$('docker-sudo').checked});}catch{result={ok:false,message:'Permintaan Docker gagal. Silakan coba kembali.'};}finally{reads.delete(requestId);}
  if(ticket!==generation || app.server!==owner || $('view-docker').hidden)return;
  $('docker-refresh').disabled=false;$('docker-loading').hidden=true;
  if(!result.ok){pause();containers=[];selected='';render();if(!result.cancelled)message('docker-error',result.message);lost(result,owner);return;}
  containers=result.data.containers;if(!containers.some(row=>row.id===selected))selected='';$('docker-notice').textContent=result.data.notice;render();
  if($('docker-auto').checked)timer=setTimeout(load,5000);
}
async function mutate(type) {
  const owner=app.server, container=containers.find(row=>row.id===selected);if(!owner||!container||action)return;
  action={server:owner,name:container.name,type};controls();message('docker-error','');$('docker-status').textContent=`Menunggu ${type} ${container.name}.`;
  let result;try{result=await api.call(owner.id,'action',{requestId:crypto.randomUUID(),id:container.id,action:type,sudo:$('docker-sudo').checked});}catch{result={ok:false,message:'Tindakan Docker gagal. Periksa status sebelum mencoba kembali.'};}
  action=null;if(app.server!==owner)return;
  if(!result.ok){$('docker-status').textContent=result.cancelled?`Tindakan ${type} dibatalkan.`:'';if(!result.cancelled)message('docker-error',result.message);controls();lost(result,owner);return;}
  $('docker-status').textContent=`${container.name}: ${type} selesai. ${result.data.notice||''}`;announce($('docker-status').textContent);
  if(!$('view-docker').hidden)await load();
}
function stopLog() {logGeneration++;clearTimeout(logTimer);logTimer=null;$('docker-log-auto').checked=false;if(logRequest){api.cancel(logRequest.serverId,logRequest.id).catch(()=>{});logRequest=null;}}
function renderLog() {const query=$('docker-log-search').value.toLocaleLowerCase();$('docker-log-output').textContent=logText.split('\n').filter(line=>line.toLocaleLowerCase().includes(query)).join('\n')||'Tidak ada baris yang cocok.';}
async function loadLog() {
  const owner=app.server, container=logContainer;if(!owner||!container||!$('docker-log-dialog').open)return;
  clearTimeout(logTimer);if(logRequest)api.cancel(logRequest.serverId,logRequest.id).catch(()=>{});
  const ticket=++logGeneration, id=crypto.randomUUID();logRequest={serverId:owner.id,id};message('docker-log-error','');$('docker-log-refresh').disabled=true;
  let result;try{result=await api.call(owner.id,'logs',{requestId:id,id:container.id,lines:Number($('docker-log-lines').value),sudo:$('docker-sudo').checked});}catch{result={ok:false,message:'Log container gagal dibaca.'};}
  if(ticket!==logGeneration||app.server!==owner||!$('docker-log-dialog').open)return;
  logRequest=null;$('docker-log-refresh').disabled=false;
  if(!result.ok){stopLog();if(!result.cancelled)message('docker-log-error',result.message);lost(result,owner);return;}
  logText=result.data.text.replace(/\r/g,'');$('docker-log-notice').textContent=result.data.notice;renderLog();
  if($('docker-log-auto').checked)logTimer=setTimeout(loadLog,3000);
}
$('docker-refresh').addEventListener('click',load);
$('docker-sudo').addEventListener('change',load);
$('docker-auto').addEventListener('change',()=>{clearTimeout(timer);if($('docker-auto').checked)load();});
for(const id of ['docker-search','docker-filter'])$(id).addEventListener(id==='docker-search'?'input':'change',()=>{selected='';page=1;if($('docker-loading').hidden)render();});
$('docker-prev').addEventListener('click',()=>{page--;render();});$('docker-next').addEventListener('click',()=>{page++;render();});
for(const action of ['start','stop','restart'])$(`docker-${action}`).addEventListener('click',()=>mutate(action));
$('docker-guide').addEventListener('click',()=>$('docker-guide-dialog').showModal());
$('docker-log').addEventListener('click',()=>{logContainer=containers.find(row=>row.id===selected);if(!logContainer)return;stopLog();logText='';$('docker-log-search').value='';$('docker-log-title').textContent=`Log · ${logContainer.name}`;$('docker-log-context').textContent=logContainer.id;$('docker-log-output').textContent='Memuat log…';$('docker-log-dialog').showModal();loadLog();});
$('docker-log-dialog').addEventListener('close',stopLog);
$('docker-log-search').addEventListener('input',renderLog);$('docker-log-lines').addEventListener('change',loadLog);$('docker-log-refresh').addEventListener('click',loadLog);$('docker-log-auto').addEventListener('change',()=>{clearTimeout(logTimer);if($('docker-log-auto').checked)loadLog();});
$('docker-terminal').addEventListener('click',()=>{const container=containers.find(row=>row.id===selected);if(container)show('terminal',{container:{id:container.id,name:container.name,shell:$('docker-shell').value,sudo:$('docker-sudo').checked}});});
onShow('docker',()=>{if(server!==app.server){server=app.server;containers=[];selected='';page=1;$('docker-search').value='';$('docker-filter').value='all';$('docker-sudo').checked=false;$('docker-status').textContent='';pause();}load();});
onLeave('docker',()=>{generation++;pause();cancelReads();stopLog();$('docker-refresh').disabled=false;if($('docker-log-dialog').open)$('docker-log-dialog').close();});
