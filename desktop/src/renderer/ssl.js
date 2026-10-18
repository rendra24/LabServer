import { app, onShow, onLeave, show, invalidateSyntax } from './app.js';
import { $, el, announce, showError } from './ui.js';
import { guardFileChanges } from './files.js';
const api = window.api.ssl;
const reads = new Map();
let server = null, certificates = [], generation = 0, page = 1, ready = false, pending = null, preparing = false;
const DAY = 86400000;
function message(id,text) {$(id).textContent=text||'';$(id).hidden=!text;}
function state(cert) {
  if(cert.validity==='invalid'&&(!Number.isFinite(cert.expiresAt)||cert.expiresAt>=Date.now()))return{label:'Tidak valid',cls:'is-warning',days:cert.testCertificate?'Sertifikat uji (staging)':'Ditandai tidak valid oleh Certbot'};
  if(!Number.isFinite(cert.expiresAt))return{label:'Tidak diketahui',cls:'',days:'Tanggal belum tersedia'};
  const delta=cert.expiresAt-Date.now(), days=Math.ceil(Math.abs(delta)/DAY);
  return{label:delta<0?'Kedaluwarsa':delta<=30*DAY?'Segera kedaluwarsa':'Aktif',cls:delta<0?'is-failed':delta<=30*DAY?'is-warning':'is-running',days:delta<0?`${days} hari lalu`:`${Math.ceil(delta/DAY)} hari lagi`};
}
function controls() {
  const busy=pending?.owner===app.server || preparing;
  $('ssl-new').disabled=!ready||busy;$('ssl-refresh').disabled=busy||!$('ssl-loading').hidden;$('ssl-submit').disabled=busy;
  for(const id of ['ssl-domains','ssl-email','ssl-redirect','ssl-terms'])$(id).disabled=busy;
  for(const button of $('ssl-rows').querySelectorAll('button'))button.disabled=busy||button.dataset.supported!=='true';
}
function render() {
  const query=$('ssl-search').value.trim().toLocaleLowerCase();
  const visible=certificates.filter(cert=>`${cert.name} ${cert.domains.join(' ')}`.toLocaleLowerCase().includes(query));
  const pages=Math.max(1,Math.ceil(visible.length/100));page=Math.min(page,pages);
  $('ssl-total').textContent=certificates.length;$('ssl-expiring').textContent=certificates.filter(cert=>state(cert).label==='Segera kedaluwarsa').length;$('ssl-expired').textContent=certificates.filter(cert=>state(cert).label==='Kedaluwarsa').length;
  $('ssl-table').hidden=!visible.length;$('ssl-empty').hidden=Boolean(visible.length);$('ssl-page-status').textContent=`${visible.length} sertifikat · Halaman ${page} dari ${pages}`;$('ssl-prev').disabled=page<=1;$('ssl-next').disabled=page>=pages;
  $('ssl-rows').replaceChildren(...visible.slice((page-1)*100,page*100).map(cert=>{
    const status=state(cert), row=el('tr');
    const renew=el('button',{text:'Perpanjang',cls:'btn',attrs:{type:'button','aria-label':`Perpanjang ${cert.name}`,'data-supported':String(cert.supported)}});
    if(!cert.supported)renew.title='Nama atau domain sertifikat ini belum didukung. Kelola melalui Certbot di VPS.';
    renew.addEventListener('click',()=>mutate('renew',{name:cert.name}));
    row.append(el('td',{},el('strong',{text:cert.name}),el('small',{text:cert.domains.join(', '),cls:'ssl-domains'})),el('td',{},el('span',{text:Number.isFinite(cert.expiresAt)?new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(cert.expiresAt):'—'}),el('small',{text:status.days})),el('td',{},el('span',{text:status.label,cls:`svc-badge ${status.cls}`})),el('td',{},renew));return row;
  }));controls();
}
function cancelReads() {for(const [id,owner]of reads)api.cancel(owner,id).catch(()=>{});reads.clear();}
function lost(result,owner) {if(result.code!=='NOT_CONNECTED'||app.server!==owner)return;const keepDns=!$('view-dns').hidden;app.server=null;show(keepDns?'dns':'servers',{preserve:keepDns});showError(result.message);}
async function load() {
  const owner=app.server;if(!owner||$('view-ssl').hidden||pending?.owner===owner)return;
  const ticket=++generation;cancelReads();message('ssl-error','');$('ssl-loading').hidden=false;$('ssl-table').hidden=true;$('ssl-empty').hidden=true;controls();
  const requestId=crypto.randomUUID();reads.set(requestId,owner.id);
  let result;try{result=await api.call(owner.id,'list',{requestId});}catch{result={ok:false,message:'Sertifikat gagal dimuat. Silakan coba kembali.'};}finally{reads.delete(requestId);}
  if(ticket!==generation||owner!==app.server||$('view-ssl').hidden)return;
  $('ssl-loading').hidden=true;ready=result.ok;
  if(!result.ok){certificates=[];render();if(!result.cancelled)message('ssl-error',result.message);lost(result,owner);return;}
  certificates=result.data.certificates;render();
}
async function mutate(op,input) {
  const owner=app.server;if(!owner||pending?.owner===owner||preparing)return;
  preparing=true;controls();
  let permitted;try{permitted=await guardFileChanges();}finally{preparing=false;}
  if(!permitted||app.server!==owner){controls();return;}
  generation++;cancelReads();$('ssl-loading').hidden=true;
  const operation={owner,op};pending=operation;render();message('ssl-error','');message('ssl-form-error','');$('ssl-status').textContent=op==='issue'?'Pemasangan SSL sedang diproses…':'Perpanjangan sertifikat sedang diproses…';
  let result;try{result=await api.call(owner.id,op,{...input,requestId:crypto.randomUUID()});}catch{result={ok:false,message:'Permintaan SSL gagal. Periksa Nginx dan Certbot di VPS sebelum mencoba kembali.'};}
  if(pending===operation)pending=null;
  if(app.server!==owner)return;
  controls();
  if(!result.ok){$('ssl-status').textContent='';message(op==='issue'&&$('ssl-issue-dialog').open?'ssl-form-error':'ssl-error',result.cancelled?'Pemasangan atau perpanjangan SSL dibatalkan.':result.message);if(result.partial&&$('view-ssl').hidden)showError(result.message);lost(result,owner);return;}
  certificates=result.data.certificates;ready=true;render();$('ssl-status').textContent=result.data.notice;announce(result.data.notice);if(op==='issue'&&$('ssl-issue-dialog').open)$('ssl-issue-dialog').close();
}
$('ssl-refresh').addEventListener('click',load);
$('ssl-search').addEventListener('input',()=>{page=1;if($('ssl-loading').hidden)render();});
$('ssl-prev').addEventListener('click',()=>{page--;render();});$('ssl-next').addEventListener('click',()=>{page++;render();});
$('ssl-new').addEventListener('click',()=>{if(!app.server||pending?.owner===app.server)return;$('ssl-form').reset();$('ssl-redirect').checked=true;message('ssl-form-error','');$('ssl-issue-dialog').showModal();$('ssl-domains').focus();});
$('ssl-form').addEventListener('submit',event=>{
  event.preventDefault();message('ssl-form-error','');
  const domains=[...new Set($('ssl-domains').value.trim().split(/[\s,]+/).filter(Boolean).map(value=>value.toLowerCase().replace(/\.$/,'')))];
  if(!domains.length||domains.length>20||domains.some(name=>name.length>253||!name.includes('.')||!name.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))){message('ssl-form-error','Masukkan domain lengkap tanpa wildcard, misalnya example.com. Maksimal 20 domain.');return;}
  if(!$('ssl-terms').checked){message('ssl-form-error',"Persetujuan syarat layanan Let's Encrypt diperlukan.");return;}
  mutate('issue',{domains,email:$('ssl-email').value.trim(),redirect:$('ssl-redirect').checked,agreeTerms:true});
});
$('ssl-guide').addEventListener('click',()=>$('ssl-guide-dialog').showModal());
$('ssl-install-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('ssl-install-command').textContent);$('ssl-copy-status').textContent='Command tersalin. Paste ke terminal VPS.';}catch{$('ssl-copy-status').textContent='Clipboard tidak tersedia. Pilih dan salin command secara manual.';}});
window.api.onToolEvent(packet=>{if(packet.serverId!==app.server?.id||packet.type!=='nginx-changed')return;invalidateSyntax();$('sites-reload').disabled=true;$('ed-reload').disabled=true;});
onShow('ssl',()=>{if(server!==app.server){server=app.server;certificates=[];ready=false;page=1;$('ssl-search').value='';$('ssl-status').textContent='';}if(pending?.owner===app.server){render();controls();}else load();});
onLeave('ssl',()=>{generation++;cancelReads();$('ssl-loading').hidden=true;if($('ssl-issue-dialog').open)$('ssl-issue-dialog').close();});
