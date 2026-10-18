import { app, onShow, onLeave } from './app.js';
import { $, el, busy, announce } from './ui.js';
const api = window.api.dns;
const TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'];
let accounts = [], zones = [], records = [];
let generation = 0, page = 1, pages = 1, editingAccount = null, editingRecord = null;
let working = false, loadingZones = false;
const dirty = new Set();
const error = message => { $('dns-error').textContent = message || ''; $('dns-error').hidden = !message; };
const call = async fn => { try { return await fn(); } catch { return { ok: false, message: 'Permintaan Cloudflare gagal. Silakan coba kembali.' }; } };
const selection = () => ({ account: $('dns-account').value, zone: $('dns-zone').value });
const sameSelection = context => { const s = selection(); return s.account === context.account && s.zone === context.zone; };
function status(message) { $('dns-status').textContent = message; announce(message); }
function resetRecords() {
  records = []; pages = 1;
  $('dns-rows').replaceChildren(); $('dns-table').hidden = true; $('dns-no-records').hidden = true;
  $('dns-count').textContent = '0'; $('dns-page-status').textContent = '';
  $('dns-prev').disabled = true; $('dns-next').disabled = true; $('dns-add-record').disabled = true;
}
function renderRecords(data) {
  records = data.records; pages = data.pages;
  $('dns-count').textContent = data.total;
  $('dns-page-status').textContent = `${data.total} record · Halaman ${page} dari ${pages}`;
  $('dns-prev').disabled = page <= 1; $('dns-next').disabled = page >= pages;
  $('dns-table').hidden = !records.length; $('dns-no-records').hidden = Boolean(records.length);
  $('dns-no-records').textContent = $('dns-search').value.trim() ? 'Tidak ada record yang cocok dengan pencarian.' : 'Belum ada record DNS. Pilih Tambah record untuk memulai.';
  $('dns-rows').replaceChildren(...records.map(record => {
    const edit = el('button', { text: 'Edit', cls: 'btn', attrs: { type: 'button', 'aria-label': `Edit ${record.type} ${record.name}` } });
    edit.disabled = !TYPES.includes(record.type);
    if (edit.disabled) edit.title = 'Tipe ini belum dapat diedit di LabServer. Gunakan dashboard Cloudflare.';
    edit.addEventListener('click', () => openRecord(record));
    const remove = el('button', { text: 'Hapus', cls: 'btn', attrs: { type: 'button', 'aria-label': `Hapus ${record.type} ${record.name}` } });
    remove.addEventListener('click', async () => {
      const context = selection(); error('');
      const result = await busy(remove, 'Menghapus…', () => call(() => api.remove(context.account, context.zone, record.id)));
      if (!sameSelection(context)) return;
      if (!result.ok) { if (!result.cancelled) error(result.message); return; }
      status(`Record ${record.name} dihapus.`); await loadRecords();
    });
    const content = record.type === 'SRV' && record.data ? `${record.data.priority} ${record.data.weight} ${record.data.port} ${record.data.target}` : record.type === 'CAA' && record.data ? `${record.data.flags} ${record.data.tag} ${record.data.value}` : record.type === 'MX' ? `${record.priority} ${record.content}` : record.content || '';
    return el('tr', {}, el('td', {}, el('span', { text: record.type, cls: 'dns-type' })), el('td', { text: record.name, cls: 'dns-name', attrs: { title: record.name } }), el('td', { text: content, cls: 'dns-content', attrs: { title: content } }), el('td', {}, el('span', { text: record.proxied ? 'Proxied' : 'DNS only', cls: record.proxied ? 'dns-proxied' : 'dns-only' })), el('td', { text: record.ttl === 1 ? 'Auto' : `${record.ttl} dtk`, cls: 'dns-ttl' }), el('td', {}, el('div', { cls: 'dns-row-actions' }, edit, remove)));
  }));
}
async function loadRecords() {
  if (loadingZones) return;
  const context = selection(), ticket = ++generation;
  resetRecords(); error('');
  if (!context.account || !context.zone) { $('dns-loading').hidden = true; return; }
  $('dns-loading').hidden = false;
  const result = await call(() => api.records(context.account, context.zone, { page, search: $('dns-search').value }));
  if (ticket !== generation) return;
  $('dns-loading').hidden = true;
  if (!result.ok) { error(result.message); return; }
  renderRecords(result.data); $('dns-add-record').disabled = false;
}
async function loadZones() {
  const account = $('dns-account').value, previous = $('dns-zone').value, ticket = ++generation;
  resetRecords(); error(''); zones = []; loadingZones = true;
  $('dns-search').disabled = true; $('dns-search-form').querySelector('button').disabled = true;
  $('dns-zone').replaceChildren(); $('dns-zone').disabled = true; $('dns-zone-status').textContent = '';
  if (!account) { $('dns-loading').hidden = true; loadingZones = false; return; }
  $('dns-loading').hidden = false;
  const result = await call(() => api.zones(account));
  if (ticket !== generation) return;
  loadingZones = false; $('dns-search').disabled = false; $('dns-search-form').querySelector('button').disabled = false;
  $('dns-loading').hidden = true;
  if (!result.ok) { error(result.message); return; }
  zones = result.data;
  $('dns-zone').replaceChildren(...zones.map(zone => el('option', { text: zone.name, attrs: { value: zone.id } })));
  $('dns-zone').disabled = !zones.length;
  if (zones.some(zone => zone.id === previous)) $('dns-zone').value = previous;
  if (!zones.length) { error('Tidak ada domain tersedia. Tambahkan domain di Cloudflare atau periksa Zone Read dan Zone Resources pada token.'); return; }
  page = 1; updateZoneStatus(); await loadRecords();
}
function updateZoneStatus() {
  const zone = zones.find(z => z.id === $('dns-zone').value);
  $('dns-zone-status').textContent = zone ? `${zone.name}${zone.status === 'active' ? ' · Aktif' : ` · ${zone.status || 'Status tidak tersedia'}`}` : '';
}
async function loadAccounts(preferred = $('dns-account').value) {
  const ticket = ++generation;
  const result = await call(() => api.accounts());
  if (ticket !== generation) return;
  if (!result.ok) { error(result.message); return; }
  accounts = result.data;
  $('dns-account').replaceChildren(...accounts.map(a => el('option', { text: a.memo, attrs: { value: a.id } })));
  if (accounts.some(a => a.id === preferred)) $('dns-account').value = preferred;
  $('dns-empty').hidden = Boolean(accounts.length); $('dns-workspace').hidden = !accounts.length;
  if (!accounts.length) { resetRecords(); return; }
  await loadZones();
}
function openAccount(account = null) {
  editingAccount = account;
  $('dns-account-form').reset(); $('dns-account-fields').disabled = false;
  $('dns-account-error').textContent = '';
  $('dns-memo').value = account?.memo || '';
  $('dns-token').required = !account;
  $('dns-token').placeholder = account ? 'Kosongkan untuk memakai token tersimpan' : 'Paste API Token di sini';
  $('dns-token-hint').textContent = account ? 'Token tersimpan tidak ditampilkan. Isi token baru hanya jika ingin menggantinya.' : 'Token disimpan terenkripsi di perangkat ini dan disertakan dalam backup .lsb.';
  $('dns-account-title').textContent = account ? 'Edit akun Cloudflare' : 'Hubungkan Cloudflare';
  dirty.delete('dns-account-dialog'); $('dns-account-dialog').showModal(); $('dns-memo').focus();
}
function recordFields() {
  const type = $('dns-record-type').value;
  const structured = ['SRV', 'CAA'].includes(type), proxy = ['A', 'AAAA', 'CNAME'].includes(type);
  $('dns-content-row').hidden = structured; $('dns-record-content').required = !structured;
  $('dns-priority-row').hidden = type !== 'MX'; $('dns-srv-row').hidden = type !== 'SRV'; $('dns-caa-row').hidden = type !== 'CAA';
  for (const [id, disabled] of [['dns-content-row', structured], ['dns-priority-row', type !== 'MX'], ['dns-srv-row', type !== 'SRV'], ['dns-caa-row', type !== 'CAA']]) $(id).querySelectorAll('input, select, textarea').forEach(field => { field.disabled = disabled; });
  $('dns-proxy-row').hidden = !proxy;
  if (!proxy) $('dns-record-proxied').checked = false;
  if ($('dns-record-proxied').checked) $('dns-record-ttl').value = '1';
  $('dns-record-ttl').disabled = $('dns-record-proxied').checked;
}
function openRecord(record = null) {
  const context = selection(); if (!context.account || !context.zone) return;
  editingRecord = { ...context, record };
  $('dns-record-form').reset(); $('dns-record-fields').disabled = false; $('dns-record-error').textContent = '';
  $('dns-record-title').textContent = record ? 'Edit record DNS' : 'Tambah record DNS';
  $('dns-record-zone').textContent = zones.find(z => z.id === context.zone)?.name || '';
  $('dns-record-type').value = record?.type || 'A'; $('dns-record-type').disabled = Boolean(record);
  $('dns-record-name').value = record?.name || '@'; $('dns-record-content').value = record?.content || '';
  $('dns-record-priority').value = record?.priority ?? 10;
  $('dns-record-comment').value = record?.comment || '';
  $('dns-record-proxied').checked = record?.proxied === true;
  $('dns-record-ttl').querySelector('[data-custom]')?.remove();
  const ttl = String(record?.ttl || 1);
  if (![...$('dns-record-ttl').options].some(option => option.value === ttl)) $('dns-record-ttl').append(el('option', { text: `${ttl} detik`, attrs: { value: ttl, 'data-custom': '' } }));
  $('dns-record-ttl').value = ttl;
  for (const name of ['priority', 'weight', 'port', 'target']) $(`dns-srv-${name}`).value = record?.data?.[name] ?? (name === 'port' ? 443 : name === 'target' ? '' : 0);
  for (const name of ['flags', 'tag', 'value']) $(`dns-caa-${name}`).value = record?.data?.[name] ?? (name === 'flags' ? 0 : name === 'tag' ? 'issue' : '');
  recordFields(); dirty.delete('dns-record-dialog'); $('dns-record-dialog').showModal(); $('dns-record-name').focus();
}
function mayClose(id) {
  if (working) return false;
  return !dirty.has(id) || window.confirm('Perubahan belum disimpan. Tutup dan buang perubahan?');
}
export function guardDnsChanges() {
  if (working) return false;
  return ['dns-account-dialog', 'dns-record-dialog'].every(id => !$(id).open || mayClose(id));
}
for (const id of ['dns-account-dialog', 'dns-record-dialog']) {
  $(id).addEventListener('input', () => dirty.add(id)); $(id).addEventListener('change', () => dirty.add(id));
  $(id).addEventListener('cancel', event => { if (!mayClose(id)) event.preventDefault(); });
  $(id).addEventListener('close', () => { dirty.delete(id); if (id === 'dns-account-dialog') $('dns-token').value = ''; });
}
for (const button of document.querySelectorAll('[data-dns-close]')) button.addEventListener('click', () => { const id = button.dataset.dnsClose; if (mayClose(id)) $(id).close(); });
function lockDialog(id, locked) { $(id).querySelector('fieldset').disabled = locked; $(id).querySelectorAll('[data-dns-close]').forEach(button => { button.disabled = locked; }); }
$('dns-account-form').addEventListener('submit', async event => {
  event.preventDefault(); if (working) return;
  if (!app.canRemember) { $('dns-account-error').textContent = 'Enkripsi OS tidak tersedia. API Token tidak dapat disimpan di perangkat ini.'; return; }
  working = true; lockDialog('dns-account-dialog', true); $('dns-account-error').textContent = '';
  const input = { ...(editingAccount ? { id: editingAccount.id } : {}), memo: $('dns-memo').value, token: $('dns-token').value.trim() };
  try {
    const result = await busy($('dns-account-save'), 'Memverifikasi…', () => call(() => api.save(input)));
    if (!result.ok) { $('dns-account-error').textContent = result.message; return; }
    dirty.delete('dns-account-dialog'); $('dns-account-dialog').close(); status(`Akun ${result.data.memo} terhubung.`);
    await loadAccounts(result.data.id);
  } finally { working = false; lockDialog('dns-account-dialog', false); }
});
$('dns-record-form').addEventListener('submit', async event => {
  event.preventDefault(); if (working || !editingRecord) return;
  const context = editingRecord, type = $('dns-record-type').value;
  const input = { type, name: $('dns-record-name').value, content: $('dns-record-content').value, ttl: Number($('dns-record-ttl').value), proxied: $('dns-record-proxied').checked, priority: Number($('dns-record-priority').value), comment: $('dns-record-comment').value };
  if (type === 'SRV') input.data = Object.fromEntries(['priority', 'weight', 'port', 'target'].map(name => [name, name === 'target' ? $(`dns-srv-${name}`).value : Number($(`dns-srv-${name}`).value)]));
  if (type === 'CAA') input.data = { flags: Number($('dns-caa-flags').value), tag: $('dns-caa-tag').value, value: $('dns-caa-value').value };
  working = true; lockDialog('dns-record-dialog', true); $('dns-record-error').textContent = '';
  try {
    const result = await busy($('dns-record-save'), 'Menyimpan…', () => call(() => context.record ? api.update(context.account, context.zone, context.record.id, input, context.record.modified_on) : api.create(context.account, context.zone, input)));
    if (!result.ok) { $('dns-record-error').textContent = result.message; return; }
    dirty.delete('dns-record-dialog'); $('dns-record-dialog').close(); status(`Record ${result.data.name} disimpan.`);
    if (sameSelection(context)) await loadRecords();
  } finally { working = false; lockDialog('dns-record-dialog', false); $('dns-record-type').disabled = Boolean(context.record); recordFields(); }
});
$('dns-add-account').addEventListener('click', () => openAccount());
$('dns-add-empty').addEventListener('click', () => openAccount());
$('dns-edit-account').addEventListener('click', () => openAccount(accounts.find(a => a.id === $('dns-account').value)));
$('dns-remove-account').addEventListener('click', async () => {
  const id = $('dns-account').value;
  const result = await busy($('dns-remove-account'), '…', () => call(() => api.removeAccount(id)));
  if (!result.ok) { if (!result.cancelled) error(result.message); return; }
  status('Akun Cloudflare dihapus dari perangkat ini.'); await loadAccounts();
});
$('dns-guide').addEventListener('click', () => $('dns-guide-dialog').showModal());
$('dns-backup').addEventListener('click', () => $('backup-open').click());
$('dns-add-record').addEventListener('click', () => openRecord());
$('dns-record-type').addEventListener('change', recordFields);
$('dns-record-proxied').addEventListener('change', recordFields);
$('dns-account').addEventListener('change', () => { $('dns-search').value = ''; loadZones(); });
$('dns-zone').addEventListener('change', () => { page = 1; $('dns-search').value = ''; updateZoneStatus(); loadRecords(); });
$('dns-refresh').addEventListener('click', () => loadZones());
$('dns-search-form').addEventListener('submit', event => { event.preventDefault(); page = 1; loadRecords(); });
$('dns-search').addEventListener('search', () => { page = 1; loadRecords(); });
$('dns-prev').addEventListener('click', () => { if (page > 1) { page--; loadRecords(); } });
$('dns-next').addEventListener('click', () => { if (page < pages) { page++; loadRecords(); } });
onShow('dns', params => { if (!params?.preserve) { error(''); loadAccounts(); } });
onLeave('dns', () => { generation++; loadingZones = false; });
window.addEventListener('labserver-restored', () => { generation++; if (!$('view-dns').hidden) loadAccounts(); });
