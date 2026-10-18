import { app, onShow, onLeave, show } from './app.js';
import { $, el, announce, showError } from './ui.js';
import { readHistory, historyLabel } from './history.js';
const api = window.api.system;
const serviceReads = new Map();
let services = [], selected = '', serviceServer = null, serviceGeneration = 0, detailGeneration = 0, servicePage = 1;
let detailUnit = '', actionPending = null, serviceStale = false;
let logServer = null, logGeneration = 0, logRequest = null, logTimer = null, rawLog = '', appliedLog = null;
const labels = { active: 'Berjalan', inactive: 'Tidak aktif', failed: 'Gagal', activating: 'Memulai', deactivating: 'Menghentikan', reloading: 'Reload', unknown: 'Tidak diketahui' };
const apiCall = async (server, op, input, requests) => {
  const requestId = crypto.randomUUID();
  requests?.set(requestId, server.id);
  try { return await api.call(server.id, op, { ...input, requestId }); }
  catch { return { ok: false, code: 'UNKNOWN', message: 'Permintaan server gagal. Silakan coba kembali.' }; }
  finally { requests?.delete(requestId); }
};
function cancelReads(requests) {
  for (const [requestId, serverId] of requests) api.cancel(serverId, requestId).catch(() => {});
  requests.clear();
}
function message(id, text) { $(id).textContent = text || ''; $(id).hidden = !text; }
function lost(result, server) {
  if (result.code !== 'NOT_CONNECTED' || app.server !== server) return;
  const keepDns = !$('view-dns').hidden;
  app.server = null; show(keepDns ? 'dns' : 'servers', { preserve: keepDns }); showError(result.message);
}
function serviceStatus(text) { $('svc-status').textContent = text; announce(text); }
function serviceControls() {
  const record = services.find(service => service.name === selected);
  const busy = Boolean(actionPending && actionPending.server === app.server);
  $('svc-selected').textContent = busy ? `${actionPending.action} · ${actionPending.unit} sedang diproses…` : record ? `Terpilih: ${record.name}` : 'Pilih layanan untuk menjalankan tindakan';
  for (const action of ['start', 'stop', 'restart']) {
    const button = $(`svc-${action}`);
    button.disabled = !record || record.template || busy || serviceStale || (action === 'start' && record.active === 'active') || (action === 'stop' && record.active === 'inactive');
  }
}
function renderServices() {
  const search = $('svc-search').value.trim().toLocaleLowerCase(), filter = $('svc-filter').value;
  const visible = services.filter(service => `${service.name} ${service.description}`.toLocaleLowerCase().includes(search) && (filter === 'all' || service.active === filter));
  const totalPages = Math.max(1, Math.ceil(visible.length / 100)); servicePage = Math.min(servicePage, totalPages);
  $('svc-total').textContent = services.length;
  $('svc-running').textContent = services.filter(service => service.active === 'active').length;
  $('svc-failed').textContent = services.filter(service => service.active === 'failed').length;
  $('svc-table').hidden = !visible.length; $('svc-empty').hidden = Boolean(visible.length);
  $('svc-page-status').textContent = `${visible.length} layanan · Halaman ${servicePage} dari ${totalPages}`;
  $('svc-prev').disabled = servicePage <= 1; $('svc-next').disabled = servicePage >= totalPages;
  $('logs-units').replaceChildren(...services.filter(service => !service.template).map(service => el('option', { attrs: { value: service.name } })));
  $('svc-rows').replaceChildren(...visible.slice((servicePage - 1) * 100, servicePage * 100).map(service => {
    const radio = el('input', { attrs: { type: 'radio', name: 'svc-selection', 'aria-label': `Pilih ${service.name}` } });
    radio.checked = service.name === selected;
    const row = el('tr', { cls: service.name === selected ? 'is-selected' : '', attrs: { tabindex: '0', 'aria-selected': String(service.name === selected) } });
    const choose = () => { selected = service.name; renderServices(); $('svc-rows').querySelector('input:checked')?.focus(); };
    row.addEventListener('click', choose);
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    radio.addEventListener('change', choose);
    const details = el('button', { text: 'Detail', cls: 'btn', attrs: { type: 'button', 'aria-label': `Detail ${service.name}` } });
    details.disabled = service.template;
    details.addEventListener('click', event => { event.stopPropagation(); selected = service.name; renderServices(); showDetail(service.name); });
    const logs = el('button', { text: 'Log', cls: 'btn', attrs: { type: 'button', 'aria-label': `Log ${service.name}` } });
    logs.disabled = service.template;
    logs.addEventListener('click', event => { event.stopPropagation(); show('logs', { unit: service.name }); });
    row.append(el('td', {}, radio), el('td', {}, el('strong', { text: service.name }), el('p', { text: service.template ? 'Template · pilih instance layanan melalui terminal' : service.description })), el('td', {}, el('span', { text: labels[service.active] || service.active || 'Tidak aktif', cls: `svc-badge ${service.active === 'active' ? 'is-running' : service.active === 'failed' ? 'is-failed' : ''}` }), el('small', { text: service.sub || '' })), el('td', { text: service.startup, cls: 'svc-startup' }), el('td', {}, el('div', { cls: 'svc-row-actions' }, details, logs)));
    return row;
  }));
  serviceControls();
}
async function loadServices() {
  const server = app.server; if (!server) return;
  const ticket = ++serviceGeneration;
  cancelReads(serviceReads);
  message('svc-error', ''); $('svc-loading').hidden = false; $('svc-table').hidden = true; $('svc-empty').hidden = true; $('svc-refresh').disabled = true;
  $('svc-start').disabled = true; $('svc-stop').disabled = true; $('svc-restart').disabled = true;
  const cached = await readHistory(server, 'services');
  if (ticket !== serviceGeneration || app.server !== server || $('view-services').hidden) return;
  if (cached) {
    services = cached.data.services; serviceStale = true;
    if (!services.some(service => service.name === selected)) selected = '';
    $('svc-loading').hidden = true; renderServices(); historyLabel($('svc-history'), cached.recordedAt, 'refreshing');
  }
  const result = await apiCall(server, 'services', {}, serviceReads);
  if (ticket !== serviceGeneration || app.server !== server || $('view-services').hidden) return;
  $('svc-loading').hidden = true; $('svc-refresh').disabled = false;
  if (!result.ok) {
    if (!result.cancelled) message('svc-error', result.message);
    if (cached) historyLabel($('svc-history'), cached.recordedAt, result.cancelled ? 'cancelled' : 'failed');
    else { services = []; selected = ''; serviceStale = false; renderServices(); }
    lost(result, server); return;
  }
  serviceStale = false; historyLabel($('svc-history'));
  services = result.data.services;
  if (!services.some(service => service.name === selected)) selected = '';
  renderServices();
}
const memory = bytes => bytes === null ? 'Tidak tersedia' : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
async function showDetail(unit) {
  const server = app.server, ticket = ++detailGeneration;
  if (!server) return;
  detailUnit = unit; $('svc-detail-title').textContent = unit; $('svc-detail-description').textContent = 'Memuat detail…';
  $('svc-detail').replaceChildren(); message('svc-detail-error', ''); $('svc-detail-logs').disabled = true;
  if (!$('svc-detail-dialog').open) $('svc-detail-dialog').showModal();
  const result = await apiCall(server, 'detail', { unit }, serviceReads);
  if (ticket !== detailGeneration || app.server !== server || !$('svc-detail-dialog').open) return;
  $('svc-detail-logs').disabled = false;
  if (!result.ok) { $('svc-detail-description').textContent = ''; message('svc-detail-error', result.message); lost(result, server); return; }
  const detail = result.data;
  $('svc-detail-description').textContent = detail.description;
  const values = [['Status', `${labels[detail.active] || detail.active} · ${detail.sub}`], ['Startup', detail.startup], ['PID utama', detail.pid || '—'], ['Memori', memory(detail.memory)], ['Aktif sejak', detail.since || '—'], ['Unit file', detail.path || '—'], ['Exit status', detail.exitStatus || '0']];
  $('svc-detail').replaceChildren(...values.flatMap(([key, value]) => [el('dt', { text: key }), el('dd', { text: value })]));
}
async function runAction(action) {
  const server = app.server, unit = selected;
  if (!server || !unit || actionPending) return;
  const record = services.find(service => service.name === unit); if (!record || record.template) return;
  actionPending = { server, unit, action }; message('svc-error', ''); serviceControls(); serviceStatus(`Menunggu tindakan ${action} untuk ${unit}.`);
  const result = await apiCall(server, 'action', { unit, action });
  actionPending = null;
  if (app.server !== server) return;
  if (!result.ok) {
    if (result.cancelled) serviceStatus(`Tindakan ${action} untuk ${unit} dibatalkan.`);
    else { message('svc-error', result.message); serviceStatus(''); }
    serviceControls(); lost(result, server); return;
  }
  serviceStatus(`${unit}: ${action} selesai. ${result.data.notice || ''}`);
  if (!$('view-services').hidden) await loadServices();
}
$('svc-refresh').addEventListener('click', loadServices);
for (const id of ['svc-search', 'svc-filter']) $(id).addEventListener(id === 'svc-search' ? 'input' : 'change', () => { selected = ''; servicePage = 1; if ($('svc-loading').hidden) renderServices(); });
$('svc-prev').addEventListener('click', () => { if (servicePage > 1) { servicePage--; renderServices(); } });
$('svc-next').addEventListener('click', () => { servicePage++; renderServices(); });
for (const action of ['start', 'stop', 'restart']) $(`svc-${action}`).addEventListener('click', () => runAction(action));
$('svc-detail-dialog').addEventListener('close', () => { detailGeneration++; });
$('svc-detail-logs').addEventListener('click', () => { const unit = detailUnit; $('svc-detail-dialog').close(); show('logs', { unit }); });
onShow('services', () => {
  if (serviceServer !== app.server) { serviceServer = app.server; services = []; selected = ''; serviceStale = false; historyLabel($('svc-history')); servicePage = 1; $('svc-search').value = ''; $('svc-filter').value = 'all'; serviceStatus(''); }
  loadServices();
});
onLeave('services', () => { serviceGeneration++; detailGeneration++; cancelReads(serviceReads); $('svc-refresh').disabled = false; if ($('svc-detail-dialog').open) $('svc-detail-dialog').close(); });

function stopLogTimer() { clearTimeout(logTimer); logTimer = null; $('logs-live-state').textContent = $('logs-auto').checked ? 'Auto · 3 dtk' : 'Manual'; }
function cancelLog() {
  if (logRequest) { api.cancel(logRequest.serverId, logRequest.requestId).catch(() => {}); logRequest = null; }
}
function sourceFields() {
  const source = $('logs-source').value;
  $('logs-unit-row').hidden = source !== 'journal'; $('logs-path-row').hidden = source !== 'file';
  $('logs-path').required = source === 'file';
}
function options() {
  return { source: $('logs-source').value, unit: $('logs-unit').value.trim(), path: $('logs-path').value, lines: Number($('logs-lines').value), priority: $('logs-priority').value, sudo: $('logs-sudo').checked };
}
function renderLog() {
  const ESC = String.fromCharCode(27);
  const plain = rawLog.replace(new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g'), '').replace(/\r/g, '');
  const all = plain.replace(/\n$/, '').split('\n').filter((line, index, array) => !(array.length === 1 && !line));
  const query = $('logs-search').value.toLocaleLowerCase(), level = $('logs-priority').value;
  const errorPattern = /\b(error|err|fatal|crit|critical|panic|emerg|alert)\b/i, warningPattern = /\b(warn|warning)\b/i;
  const lines = all.filter(line => line.toLocaleLowerCase().includes(query) && (appliedLog?.source === 'journal' || level === 'all' || errorPattern.test(line) || (level === 'warning' && warningPattern.test(line))));
  const displayed = lines.join('\n') || (rawLog ? 'Tidak ada baris yang cocok dengan filter.' : 'Tidak ada entri log untuk sumber dan izin yang dipilih.');
  if ($('logs-output').textContent !== displayed) $('logs-output').textContent = displayed;
  $('logs-count').textContent = `${lines.length} dari ${all.length} baris ditampilkan`;
  if ($('logs-follow').checked) $('logs-output').scrollTop = $('logs-output').scrollHeight;
}
function pauseAuto() { $('logs-auto').checked = false; stopLogTimer(); }
async function loadLogs() {
  const server = app.server; if (!server || $('view-logs').hidden) return;
  const input = options(), ticket = ++logGeneration;
  clearTimeout(logTimer); cancelLog(); message('logs-error', ''); $('logs-notice').textContent = '';
  if (input.source === 'file' && !input.path) { pauseAuto(); rawLog = ''; appliedLog = null; $('logs-context').textContent = 'File log aplikasi'; $('logs-count').textContent = '0 baris'; $('logs-updated').textContent = ''; $('logs-refresh').disabled = false; $('logs-apply').disabled = false; $('logs-output').textContent = 'Masukkan path file log di VPS lalu pilih Terapkan.'; return; }
  const context = input.source === 'journal' ? `Jurnal systemd${input.unit ? ` · ${input.unit}` : ' · Semua layanan'}` : input.source === 'nginx-access' ? '/var/log/nginx/access.log' : input.source === 'nginx-error' ? '/var/log/nginx/error.log' : input.path;
  const changed = !appliedLog || ['source', 'unit', 'path', 'sudo'].some(key => appliedLog[key] !== input[key]);
  if (changed) { rawLog = ''; $('logs-output').textContent = 'Memuat log…'; }
  $('logs-context').textContent = context; $('logs-refresh').disabled = true; $('logs-apply').disabled = true; $('logs-live-state').textContent = 'Membaca…';
  const requestId = crypto.randomUUID(); logRequest = { serverId: server.id, requestId };
  let result;
  try { result = await api.call(server.id, 'logs', { ...input, requestId }); }
  catch { result = { ok: false, message: 'Pembacaan log gagal. Silakan coba kembali.' }; }
  if (ticket !== logGeneration || app.server !== server || $('view-logs').hidden) return;
  logRequest = null; $('logs-refresh').disabled = false; $('logs-apply').disabled = false;
  if (!result.ok) { pauseAuto(); if (!result.cancelled) message('logs-error', result.message); if (changed) $('logs-output').textContent = 'Log belum tersedia. Periksa sumber dan izin baca.'; lost(result, server); return; }
  rawLog = result.data.text; appliedLog = input; $('logs-notice').textContent = result.data.notice;
  renderLog(); $('logs-updated').textContent = `Diperbarui ${new Date().toLocaleTimeString('id-ID')}`;
  stopLogTimer();
  if ($('logs-auto').checked) logTimer = setTimeout(loadLogs, 3000);
}
$('logs-form').addEventListener('submit', event => { event.preventDefault(); loadLogs(); });
$('logs-refresh').addEventListener('click', loadLogs);
$('logs-source').addEventListener('change', () => { pauseAuto(); sourceFields(); loadLogs(); });
$('logs-priority').addEventListener('change', () => { if ($('logs-source').value === 'journal') loadLogs(); else renderLog(); });
$('logs-search').addEventListener('input', renderLog);
$('logs-follow').addEventListener('change', renderLog);
$('logs-auto').addEventListener('change', () => { stopLogTimer(); if ($('logs-auto').checked) loadLogs(); });
for (const id of ['logs-unit', 'logs-path']) $(id).addEventListener('input', pauseAuto);
for (const id of ['logs-lines', 'logs-sudo']) $(id).addEventListener('change', () => loadLogs());
onShow('logs', params => {
  if (logServer !== app.server) {
    logServer = app.server; rawLog = ''; appliedLog = null; $('logs-source').value = 'journal'; $('logs-unit').value = ''; $('logs-path').value = ''; $('logs-search').value = ''; $('logs-priority').value = 'all'; $('logs-sudo').checked = false; pauseAuto();
  }
  if (params?.unit) { $('logs-source').value = 'journal'; $('logs-unit').value = params.unit; $('logs-priority').value = 'all'; $('logs-search').value = ''; }
  sourceFields(); loadLogs();
});
onLeave('logs', () => { logGeneration++; pauseAuto(); cancelLog(); $('logs-refresh').disabled = false; $('logs-apply').disabled = false; });
