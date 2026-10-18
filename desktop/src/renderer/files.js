import { app, invalidateSyntax, onShow } from './app.js';
import { $, el, showError, announce, busy } from './ui.js';
import { icon } from './icons.js';
import { createFilesEditor } from './files-editor.js';

const api = window.api.files;
let server = null;
let contextId = null;
let conflictId = null;
let refreshTimer;
let queueFrame = false;
let action = null;
const jobs = new Map();
const panels = { local: { path: '', grant: null, entries: [], selected: new Set(), generation: 0 }, remote: { path: '/', entries: [], selected: new Set(), generation: 0 } };
const join = (parent, name) => `${parent.replace(/\/$/, '')}/${name}`;
const relativeJoin = (parent, name) => parent ? `${parent}/${name}` : name;
const size = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(1)} GB`;
async function request(op, args = {}) {
  if (!app.server || !contextId || server !== app.server) return { ok: false, code: 'DISCONNECTED', message: 'Hubungkan server untuk membuka file manager.' };
  return api.call(app.server.id, op, { contextId, ...args });
}
const fileEditor = createFilesEditor({ request, serverId: () => app.server?.id, contextId: () => contextId });
export const guardFileChanges = () => fileEditor.guard(true);

function filtered(side) {
  const query = $(`fm-${side}-search`).value.toLocaleLowerCase();
  const hidden = $(`fm-${side}-hidden`).checked;
  const sort = $(`fm-${side}-sort`).value;
  return panels[side].entries.filter(e => (hidden || !e.name.startsWith('.')) && e.name.toLocaleLowerCase().includes(query)).sort((a,b) => Number(b.type === 'directory') - Number(a.type === 'directory') || (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.size - a.size : b.mtime - a.mtime));
}
function selection(side) { return panels[side].entries.filter(e => panels[side].selected.has(e.name)); }
function render(side) {
  const panel = panels[side];
  const entries = filtered(side);
  $(`fm-${side}-rows`).replaceChildren(...entries.map(entry => {
    const check = el('input', { attrs: { type: 'checkbox', 'aria-label': `Pilih ${side === 'local' ? 'lokal' : 'VPS'} ${entry.name}` } });
    check.checked = panel.selected.has(entry.name);
    check.addEventListener('click', event => { event.stopPropagation(); if (check.checked) panel.selected.add(entry.name); else panel.selected.delete(entry.name); render(side); });
    const row = el('tr', { cls: check.checked ? 'is-selected' : '', attrs: { tabindex: '0', 'aria-label': entry.name } },
      el('td', {}, check), el('td', { cls: 'fm-file-name', attrs: { title: entry.name } }, icon(entry.type === 'directory' ? 'folder' : entry.type === 'link' ? 'arrow' : 'file'), entry.name),
      el('td', { text: entry.type === 'directory' ? '—' : size(entry.size) }),
      el('td', { text: new Date(entry.mtime).toLocaleString('id-ID', { day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit' }), cls:'fm-secondary' }),
      ...(side === 'remote' ? [el('td',{ text:entry.mode, cls:'fm-secondary' })] : []));
    const choose = event => { if (event?.metaKey || event?.ctrlKey) { if (panel.selected.has(entry.name)) panel.selected.delete(entry.name); else panel.selected.add(entry.name); } else panel.selected = new Set([entry.name]); render(side); };
    const open = () => entry.type === 'directory' ? load(side, side === 'local' ? relativeJoin(panel.path, entry.name) : join(panel.path, entry.name)) : side === 'remote' && entry.type === 'file' ? fileEditor.open(join(panel.path, entry.name)).catch(e => showError(e.message)) : announce('Pilih Download untuk menyalin item ini. Symlink tidak diikuti.');
    row.addEventListener('click', choose); row.addEventListener('dblclick', open);
    row.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); choose(event); open(); } if (event.key === ' ') { event.preventDefault(); choose({ ctrlKey:true }); } });
    return row;
  }));
  $(`fm-${side}-all`).checked = entries.length > 0 && entries.every(e => panel.selected.has(e.name));
  $(`fm-${side}-count`).textContent = `${entries.length} item · ${panel.selected.size} dipilih`;
  $(`fm-${side}-empty`).hidden = entries.length > 0;
  if (side === 'local') {
    if (panel.grant) $(`fm-${side}-empty`).textContent = panel.entries.length ? 'Tidak ada file yang cocok.' : 'Folder ini kosong.';
    $('fm-upload-selected').disabled = !panel.selected.size || !contextId;
    $('fm-local-up').disabled = !panel.grant || !panel.path;
  } else {
    $('fm-remote-empty').textContent = panel.entries.length ? 'Tidak ada file yang cocok.' : 'Folder ini kosong.';
    const one = selection('remote');
    $('fm-download').disabled = !one.length;
    for (const id of ['fm-rename','fm-detail']) $(id).disabled = one.length !== 1;
    $('fm-edit').disabled = one.length !== 1 || one[0].type !== 'file';
    $('fm-delete').disabled = !one.length;
    $('fm-remote-up').disabled = panel.path === '/';
  }
}
async function load(side, path = panels[side].path) {
  const panel = panels[side];
  if (side === 'local' && !panel.grant) return;
  const generation = ++panel.generation;
  const activeContext = contextId;
  try {
    const result = side === 'local' ? await api.local('list', panel.grant.id, path) : await request('list', { path });
    if (generation !== panel.generation || activeContext !== contextId) return;
    if (!result.ok) return showError(result.message);
    panel.path = result.data.path; panel.entries = result.data.entries;
    panel.selected = new Set([...panel.selected].filter(name => panel.entries.some(e => e.name === name)));
    $(`fm-${side}-path`).value = panel.path || '/';
    render(side);
  } catch { showError('Folder tidak dapat dimuat. Periksa koneksi dan hak akses.'); }
}
async function setLocal(grant) {
  panels.local.grant = grant; panels.local.path = ''; panels.local.selected.clear();
  $('fm-local-path').disabled = false; $('fm-local-refresh').disabled = false;
  $('fm-local-path').title = grant.root; $('fm-local-root').title = grant.root;
  await load('local', '');
}
async function start(direction, sources) {
  if (direction === 'download' && !panels.local.grant) {
    const picked = await api.pick('local');
    if (!picked.ok) return showError(picked.message);
    if (picked.data.cancelled) return;
    await setLocal(picked.data.grants[0]);
  }
  const destination = direction === 'upload' ? { path: panels.remote.path } : { grantId: panels.local.grant.id, relative: panels.local.path };
  const result = await request('start', { direction, sources, destination });
  if (!result.ok) showError(result.message);
  else { showError(''); announce(`${sources.length} item ditambahkan ke antrean ${direction}.`); }
}
async function pickUpload(kind) {
  const result = await api.pick(kind);
  if (!result.ok) return showError(result.message);
  if (result.data.cancelled) return;
  $('fm-upload-dialog').close();
  await start('upload', result.data.grants.map(g => ({ grantId:g.id, relative:'' })));
}
function queuePaint() { if (queueFrame) return; queueFrame = true; requestAnimationFrame(() => { queueFrame = false; renderJobs(); }); }
function renderJobs() {
  const all = [...jobs.values()].reverse();
  $('fm-queue-count').textContent = all.length;
  if (!all.length) { $('fm-transfers').replaceChildren(el('p', { text:'Belum ada transfer pada sesi ini.', cls:'fm-empty' })); return; }
  $('fm-transfers').replaceChildren(...all.map(job => {
    const statuses = { queued:'Dalam antrean', running:job.current ? `${size(job.speed)}/s` : 'Memindai…', conflict:'Menunggu keputusan', complete:'Selesai', partial:'Sebagian gagal', failed:'Gagal', cancelled:'Dibatalkan' };
    const percent = job.currentSize ? Math.min(100, Math.round(job.currentBytes / job.currentSize * 100)) : job.status === 'complete' ? 100 : 0;
    const fill = el('span'); fill.style.width = `${percent}%`;
    const bar = el('div', { cls:'fm-progress', attrs:{role:'progressbar','aria-label':`Progres ${job.name}`,'aria-valuenow':String(percent),'aria-valuemin':'0','aria-valuemax':'100'} }, fill);
    const progress = el('div', {}, el('small',{text:job.current ? `${size(job.currentBytes)} / ${size(job.currentSize)} · ${percent}%` : `${job.files} selesai · ${job.skipped} dilewati · ${job.failed} gagal`}), bar);
    const done = ['complete','partial','failed','cancelled'].includes(job.status);
    const button = el('button', { text: done ? 'Coba lagi' : job.status === 'conflict' ? 'Putuskan' : 'Batal', cls:'btn',attrs:{type:'button'} });
    button.addEventListener('click', async () => {
      if (job.status === 'conflict') { showConflict(job); return; }
      const result = await request(done ? 'retry' : 'cancel', { id:job.id });
      if (!result.ok) showError(result.message);
    });
    const row = el('div', { cls:'fm-transfer' }, el('div',{},el('strong',{text:job.name}),el('small',{text:job.direction==='upload'?'Komputer → VPS':'VPS → Komputer'})),progress,el('span',{text:statuses[job.status]||job.status,cls:`fm-transfer-status ${job.status==='complete'?'is-complete':job.status==='failed'||job.status==='partial'?'is-failed':''}`}), job.status==='complete'?el('span',{text:'✓',cls:'fm-transfer-status is-complete'}):button);
    if (job.message || job.errors?.length) row.append(el('details',{},el('summary',{text:'Lihat rincian'}),...(job.message?[el('p',{text:job.message})]:[]),...job.errors.map(e=>el('p',{text:`${e.path}: ${e.message}`}))));
    return row;
  }));
  if (conflictId && jobs.get(conflictId)?.status !== 'conflict') { conflictId=null; $('fm-conflict-dialog').close(); }
  if (!conflictId && !document.querySelector('dialog[open]')) { const waiting=all.find(j=>j.status==='conflict'); if(waiting)showConflict(waiting); }
}
function showConflict(job) {
  if (!job.conflict || $('fm-conflict-dialog').open) return;
  if (document.querySelector('dialog[open]')) return;
  conflictId=job.id; $('fm-conflict-path').textContent=job.conflict.path;
  document.querySelector('[name=fm-conflict][value=skip]').checked=true;
  $('fm-conflict-all').checked=false; $('fm-conflict-overwrite').disabled=job.conflict.incompatible;
  $('fm-conflict-dialog').showModal();
}
api.onEvent(packet => {
  if (packet.contextId !== contextId || packet.serverId !== app.server?.id) return;
  if (packet.type==='transfer') { jobs.set(packet.job.id,packet.job); queuePaint(); }
  if (packet.type==='changed') {
    if (packet.invalidateSyntax) invalidateSyntax();
    clearTimeout(refreshTimer); refreshTimer=setTimeout(()=>{ if (!$('view-files').hidden) { load('remote'); if(panels.local.grant)load('local'); } },200);
  }
});
$('fm-conflict-form').addEventListener('submit',async event=>{event.preventDefault();const id=conflictId;const result=await request('decide',{id,choice:document.querySelector('[name=fm-conflict]:checked').value,all:$('fm-conflict-all').checked});if(!result.ok)showError(result.message);conflictId=null;$('fm-conflict-dialog').close();queuePaint();});
async function cancelConflict(){if(conflictId)await request('cancel',{id:conflictId});conflictId=null;$('fm-conflict-dialog').close();queuePaint();}
$('fm-conflict-cancel').addEventListener('click',cancelConflict);
$('fm-conflict-dialog').addEventListener('cancel',event=>{event.preventDefault();cancelConflict();});
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',queuePaint));

for(const side of ['local','remote']){
  for(const control of ['search','hidden','sort'])$(`fm-${side}-${control}`).addEventListener(control==='search'?'input':'change',()=>render(side));
  $(`fm-${side}-all`).addEventListener('change',event=>{panels[side].selected=event.target.checked?new Set(filtered(side).map(e=>e.name)):new Set();render(side);});
  $(`fm-${side}-refresh`).addEventListener('click',()=>load(side));
  $(`fm-${side}-up`).addEventListener('click',()=>{const parts=panels[side].path.split('/');parts.pop();load(side,side==='remote'?(parts.join('/')||'/'):parts.join('/'));});
  $(`fm-${side}-path-form`).addEventListener('submit',event=>{event.preventDefault();let path=$(`fm-${side}-path`).value;if(side==='local')path=path.replace(/^\/+/, '');load(side,path);});
}
$('fm-pick-local').addEventListener('click',()=>busy($('fm-pick-local'),'Memilih…',async()=>{const result=await api.pick('local');if(!result.ok)showError(result.message);else if(!result.data.cancelled)await setLocal(result.data.grants[0]);}));
$('fm-upload').addEventListener('click',()=>$('fm-upload-dialog').showModal());
$('fm-pick-files').addEventListener('click',()=>pickUpload('upload-files'));
$('fm-pick-folder').addEventListener('click',()=>pickUpload('upload-folder'));
$('fm-upload-selected').addEventListener('click',()=>start('upload',selection('local').map(e=>({grantId:panels.local.grant.id,relative:relativeJoin(panels.local.path,e.name)}))));
$('fm-download').addEventListener('click',()=>start('download',selection('remote').map(e=>join(panels.remote.path,e.name))));
$('fm-edit').addEventListener('click',()=>fileEditor.open(join(panels.remote.path,selection('remote')[0].name)));
function actionDialog(kind){action=kind;$('fm-action-title').textContent=kind==='mkdir'?'Folder baru di VPS':'Ganti nama di VPS';$('fm-action-path').textContent=panels.remote.path;$('fm-action-name').value=kind==='rename'?selection('remote')[0].name:'';$('fm-action-error').textContent='';$('fm-action-dialog').showModal();$('fm-action-name').focus();}
$('fm-new-folder').addEventListener('click',()=>actionDialog('mkdir'));
$('fm-rename').addEventListener('click',()=>actionDialog('rename'));
$('fm-action-form').addEventListener('submit',async event=>{event.preventDefault();const p=action==='mkdir'?panels.remote.path:join(panels.remote.path,selection('remote')[0].name);const result=await busy($('fm-action-save'),'Menyimpan…',()=>request(action,{path:p,name:$('fm-action-name').value}));if(!result.ok){$('fm-action-error').textContent=result.message;return;}$('fm-action-dialog').close();await load('remote');});
$('fm-delete').addEventListener('click',async()=>{const result=await request('remove',{paths:selection('remote').map(e=>join(panels.remote.path,e.name))});if(!result.ok)showError(result.message);else if(!result.data.cancelled){const errors=result.data.results.filter(r=>!r.ok);if(errors.length)showError(errors.map(item=>`${item.path}: ${item.message}`).join(" · "));await load('remote');}});
$('fm-detail').addEventListener('click',async()=>{const entry=selection('remote')[0];const result=await request('details',{path:join(panels.remote.path,entry.name)});if(!result.ok)return showError(result.message);const info=result.data;$('fm-detail-content').replaceChildren(...Object.entries({'Nama':info.name,'Path':join(panels.remote.path,info.name),'Tipe':info.type,'Ukuran':size(info.size),'Diubah':new Date(info.mtime).toLocaleString('id-ID'),'Izin akses':info.mode,'Pemilik (UID)':info.uid??'—','Grup (GID)':info.gid??'—',...(info.target?{'Target symlink':info.target}:{})}).flatMap(([label,value])=>[el('dt',{text:label}),el('dd',{text:String(value)})]));$('fm-detail-dialog').showModal();});
const drop=$('fm-drop-target');
drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('fm-drag-over');});
drop.addEventListener('dragleave',()=>drop.classList.remove('fm-drag-over'));
drop.addEventListener('drop',async event=>{event.preventDefault();drop.classList.remove('fm-drag-over');try{const result=await api.drop([...event.dataTransfer.files]);if(!result.ok)return showError(result.message);await start('upload',result.data.grants.map(g=>({grantId:g.id,relative:''})));}catch{showError('Sumber drag & drop tidak dapat diverifikasi. Gunakan tombol Upload untuk memilih file atau folder.');}});

onShow('files',async()=>{
  $('fm-host').textContent='Kelola file di komputer Anda dan VPS.';
  const opening=app.server;
  try{
    const result=await api.call(opening.id,'open');
    if(app.server!==opening)return;
    if(!result.ok)return showError(result.message);
    const different=contextId!==result.data.contextId;
    server=opening;contextId=result.data.contextId;
    if(different){panels.remote.path=result.data.home;panels.remote.selected.clear();jobs.clear();}
    for(const job of result.data.jobs)jobs.set(job.id,job);
    if(!panels.local.grant){const root=result.data.roots.find(g=>g.kind==='directory');if(root)await setLocal(root);}
    await load('remote');if(panels.local.grant)await load('local');queuePaint();
  }catch{showError('File manager tidak dapat dibuka. Periksa koneksi SSH dan dukungan SFTP server.');}
});
