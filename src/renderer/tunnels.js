import { app, onShow, onLeave } from './app.js';
import { $, el, announce } from './ui.js';
const api = window.api.tunnels;
let profiles = [], generation = 0, pending = null, server = null;
const active = entry => ['starting','listening'].includes(entry.status);
function error(text) { $('tunnel-error').textContent=text || ''; $('tunnel-error').hidden=!text; }
function render() {
  const busy=pending?.owner===app.server;
  const query=$('tunnel-search').value.trim().toLocaleLowerCase();
  const visible=profiles.filter(entry=>`${entry.name} ${entry.remoteHost} ${entry.localPort} ${entry.remotePort}`.toLocaleLowerCase().includes(query));
  $('tunnel-total').textContent=profiles.length;$('tunnel-active').textContent=profiles.filter(active).length;
  $('tunnel-empty').hidden=Boolean(visible.length);$('tunnel-list').hidden=!visible.length;
  $('tunnel-new').disabled=busy;$('tunnel-refresh').disabled=busy;$('tunnel-submit').disabled=busy;
  $('tunnel-list').replaceChildren(...visible.map(entry=>{
    const row=el('li',{cls:'tunnel-card'});
    const label={listening:'Aktif · menunggu koneksi',starting:'Membuka port…',error:'Gagal membuka port',stopped:'Berhenti'}[entry.status] || 'Berhenti';
    const status=el('span',{text:label,cls:`svc-badge ${entry.status==='listening'?'is-running':entry.status==='error'?'is-failed':''}`});
    const route=el('div',{cls:'tunnel-route'},el('code',{text:`127.0.0.1:${entry.localPort}`}),el('span',{text:'→ melalui SSH →'}),el('code',{text:`${entry.remoteHost}:${entry.remotePort}`}));
    const details=el('div',{cls:'tunnel-details'},el('strong',{text:entry.name}),route,el('small',{text:`${entry.connections} koneksi aplikasi · Tujuan diakses dari VPS`}));
    if(entry.lastError)details.append(el('p',{text:entry.lastError,cls:'system-error'}));
    const actions=el('div',{cls:'tunnel-actions'});
    for(const [op,text]of [['copy','Salin alamat'],[active(entry)?'stop':'start',active(entry)?'Stop':'Start'],['edit','Edit'],['remove','Hapus']]){
      const button=el('button',{text,cls:op==='start'?'btn btn-primary':'btn',attrs:{type:'button','aria-label':`${text} ${entry.name}`}});
      button.disabled=busy||(active(entry)&&['edit','remove'].includes(op));
      button.addEventListener('click',async()=>{
        if(op==='edit'){edit(entry);return;}
        if(op==='copy'){try{await navigator.clipboard.writeText(`127.0.0.1:${entry.localPort}`);$('tunnel-status').textContent='Alamat lokal tersalin.';}catch{error(`Clipboard tidak tersedia. Salin alamat ini: 127.0.0.1:${entry.localPort}`);}return;}
        mutate(op,{id:entry.id});
      });actions.append(button);
    }
    row.append(el('div',{cls:'tunnel-card-top'},details,status),actions);return row;
  }));
}
async function load() {
  const owner=app.server;if(!owner||$('view-tunnels').hidden||pending?.owner===owner)return;
  const ticket=++generation;
  let result;try{result=await api.call(owner.id,'list');}catch{result={ok:false,message:'Profil tunnel gagal dimuat. Silakan coba kembali.'};}
  if(ticket!==generation||owner!==app.server||$('view-tunnels').hidden)return;
  if(!result.ok){error(result.message);return;}
  profiles=result.data.tunnels;render();
}
function edit(entry=null) {
  if(pending?.owner===app.server||!app.server)return;
  $('tunnel-form').reset();$('tunnel-id').value=entry?.id || '';
  $('tunnel-name').value=entry?.name || '';$('tunnel-local-port').value=entry?.localPort || 3307;
  $('tunnel-host').value=entry?.remoteHost || '127.0.0.1';$('tunnel-remote-port').value=entry?.remotePort || 3306;
  $('tunnel-form-error').hidden=true;$('tunnel-dialog').showModal();$('tunnel-name').focus();
}
async function mutate(op,input) {
  const owner=app.server;if(!owner||pending?.owner===owner)return;
  const operation={owner};generation++;pending=operation;render();error('');$('tunnel-status').textContent='';
  let result;try{result=await api.call(owner.id,op,input);}catch{result={ok:false,message:'Permintaan tunnel gagal. Periksa koneksi SSH dan coba kembali.'};}
  if(pending===operation)pending=null;
  if(owner!==app.server)return;
  if(result.ok){profiles=result.data.tunnels;if(op==='save')$('tunnel-dialog').close();const text={save:'Profil tunnel tersimpan.',start:'Port lokal aktif. Hubungkan aplikasi Anda menggunakan alamat lokal.',stop:'Tunnel dihentikan.',remove:'Profil tunnel dihapus.'}[op];$('tunnel-status').textContent=text;announce(text);}
  else if(!result.cancelled){if(op==='save'&&$('tunnel-dialog').open){$('tunnel-form-error').textContent=result.message;$('tunnel-form-error').hidden=false;}else error(result.message);}
  render();load();
}
$('tunnel-new').addEventListener('click',()=>edit());$('tunnel-refresh').addEventListener('click',()=>{error('');load();});
$('tunnel-search').addEventListener('input',render);
$('tunnel-form').addEventListener('submit',event=>{event.preventDefault();mutate('save',{id:$('tunnel-id').value || undefined,name:$('tunnel-name').value,localPort:Number($('tunnel-local-port').value),remoteHost:$('tunnel-host').value,remotePort:Number($('tunnel-remote-port').value)});});
window.api.terminal.onEvent(packet=>{if(packet.type==='tunnels-changed'&&packet.serverId===app.server?.id)load();});
onShow('tunnels',()=>{if(server!==app.server){server=app.server;profiles=[];$('tunnel-search').value='';$('tunnel-status').textContent='';error('');}render();load();});
onLeave('tunnels',()=>{generation++;if($('tunnel-dialog').open)$('tunnel-dialog').close();});
