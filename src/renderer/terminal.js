import { app, onLeave, onShow, show } from './app.js';
import { $, el, announce, showError } from './ui.js';
import { icon } from './icons.js';
import { withCredentials } from './creds.js';

const api = window.api.terminal;
const serversApi = window.api.servers;
const encoder = new TextEncoder();
const tabs = new Map();
const sequence = new Map(); // serverId -> nomor tab terakhir
const connecting = new Map(); // serverId -> koneksi yang sedang dibuat (dibagi antar-tab)
const seeded = new Set(); // server workspace yang sudah dibuatkan tab otomatis
const MAX_PER_SERVER = 8, MAX_TOTAL = 32;
let current = null;

export const terminalCount = serverId => [...tabs.values()].filter(tab => tab.serverId === serverId).length;

function theme() {
  return document.documentElement.dataset.theme === 'light'
    ? { background: '#ffffff', foreground: '#33415d', cursor: '#456cd8', selectionBackground: '#dbe5ff', black: '#33415d', brightBlack: '#73829d' }
    : { background: '#12151d', foreground: '#dce4f5', cursor: '#8daaff', selectionBackground: '#35476f', black: '#12151d', brightBlack: '#8290a9' };
}
const alive = state => state && !state.disposed && tabs.get(state.id) === state;

function controls() {
  const active = current && !current.closed && !current.opening;
  $('term-status').textContent = !current ? 'Belum ada terminal' : current.opening ? 'Membuka shell…' : current.closed ? 'Shell ditutup' : 'Shell aktif';
  $('term-status').classList.toggle('is-connected', Boolean(active));
  $('term-close').disabled = !active;
  $('term-reopen').disabled = !current || !current.closed || current.opening;
  $('term-clear').disabled = !current;
  $('term-new').disabled = tabs.size >= MAX_TOTAL;
  $('term-new').title = tabs.size >= MAX_TOTAL ? `Maksimal ${MAX_TOTAL} tab. Tutup tab untuk membuka terminal baru.` : 'Pilih server dan buka sesi terminal baru';
  $('term-empty').hidden = Boolean(current);
  $('term-shell-title').textContent = current ? `SSH shell - ${current.server.username}@${current.server.host}:${current.server.port}` : 'SSH shell';
  if (!current) $('term-size').textContent = '';
  for (const state of tabs.values()) {
    const selected = state === current;
    state.panel.hidden = !selected;
    state.tab.setAttribute('aria-selected', String(selected));
    state.tab.tabIndex = selected ? 0 : -1;
    state.wrapper.classList.toggle('is-active', selected);
    state.wrapper.classList.toggle('is-closed', state.closed);
    state.tab.title = `${state.name} (${state.server.username}@${state.server.host}) - ${state.opening ? 'Membuka shell' : state.closed ? 'Shell ditutup' : 'Shell aktif'}`;
  }
}
function fit() {
  if (!current || $('view-terminal').hidden || current.panel.hidden) return;
  current.fit.fit();
  if (current.term.cols > 500 || current.term.rows > 300) current.term.resize(Math.min(500, current.term.cols), Math.min(300, current.term.rows));
  $('term-size').textContent = `${current.term.cols} × ${current.term.rows}`;
}
function select(state, focusTerminal = true) {
  current?.term.blur(); current = state; controls();
  requestAnimationFrame(() => {
    if (current !== state || !state) return;
    fit();
    if (focusTerminal && !$('view-terminal').hidden) state.term.focus();
    else state.tab.focus();
  });
}
function end(state, message) {
  if (!alive(state) || state.closed) return;
  state.closed = true; state.opening = false;
  state.term.options.disableStdin = true;
  state.term.writeln(`\r\n\x1b[90m[${message}]\x1b[0m`);
  controls(); announce(`${state.name}: ${message}`);
}
function dispose(state) {
  state.disposed = true;
  if (state.sessionId && !state.closed) api.close(state.serverId, state.sessionId).catch(() => {});
  state.observer.disconnect(); state.term.dispose();
  state.panel.remove(); state.wrapper.remove(); tabs.delete(state.id);
}
async function ensureConnected(target) {
  const pending = connecting.get(target.id);
  if (pending) return pending;
  if ((await serversApi.connected()).includes(target.id)) return { ok: true };
  if (connecting.has(target.id)) return connecting.get(target.id);
  const attempt = withCredentials(target, creds => serversApi.connect(target.id, creds), app.canRemember)
    .then(result => result || { ok: false, message: 'Koneksi dibatalkan.' })
    .finally(() => connecting.delete(target.id));
  connecting.set(target.id, attempt);
  return attempt;
}
function remove(state) {
  if (!alive(state)) return;
  if (!state.closed && !window.confirm(`Tutup tab ${state.name}? Proses di shell ini dapat berhenti. Tab lain dan koneksi VPS tetap aktif.`)) return;
  const remaining = [...tabs.values()].filter(tab => tab !== state);
  const replacement = remaining[Math.min([...tabs.keys()].indexOf(state.id), remaining.length - 1)] || null;
  const selected = state === current;
  dispose(state);
  if (selected) select(replacement); else controls();
  if (!current) $('term-new').focus();
}
function sendInput(state, data) {
  if (!alive(state) || state !== current || state.closed || !state.sessionId) return;
  if (state.queuedBytes + data.byteLength > 1048576) { showError('Input terminal terlalu besar. Tunggu input sebelumnya terkirim, lalu tempel dalam bagian lebih kecil.'); return; }
  for (let offset = 0; offset < data.byteLength; offset += 16384) {
    const chunk = data.slice(offset, offset + 16384);
    const sessionId = state.sessionId;
    state.queuedBytes += chunk.byteLength;
    state.queue = state.queue.then(async () => {
      if (!alive(state) || state.closed || state.sessionId !== sessionId) return;
      const result = await api.write(state.serverId, sessionId, chunk);
      if (!result.ok && state.sessionId === sessionId) end(state, result.message);
    }).catch(() => { if (state.sessionId === sessionId) end(state, 'Input terminal gagal dikirim. Buka ulang terminal.'); })
      .finally(() => { state.queuedBytes -= chunk.byteLength; });
  }
}
async function open(state) {
  if (!alive(state) || state.opening || !state.closed) return;
  state.closed = false; state.opening = true; state.sessionId = null;
  state.requestId = crypto.randomUUID();
  const requestId = state.requestId;
  state.term.options.disableStdin = true;
  showError(''); controls(); fit();
  try {
    const link = await ensureConnected(state.server);
    if (!alive(state) || state.requestId !== requestId) return;
    if (!link.ok) { end(state, link.message || 'Koneksi SSH gagal.'); return; }
    const result = await api.open(state.serverId, { cols: state.term.cols, rows: state.term.rows, requestId, ...(state.container ? { containerId: state.container.id, shell: state.container.shell, sudo: state.container.sudo } : {}) });
    if (!alive(state) || state.requestId !== requestId) {
      if (result.ok) await api.close(state.serverId, result.sessionId);
      return;
    }
    state.opening = false;
    if (!result.ok) {
      end(state, result.message);
      if (result.code === 'NOT_CONNECTED' && state.serverId === app.server?.id) loseConnection(result.message);
      return;
    }
    // Match early output by requestId, even when multiple opens are pending.
    if (state.closed) return;
    state.sessionId = result.sessionId;
    state.term.options.disableStdin = false;
    controls();
    if (current === state && !$('view-terminal').hidden) { fit(); state.term.focus(); }
  } catch { if (state.requestId === requestId) end(state, 'Shell SSH tidak dapat dibuka. Coba buka ulang terminal.'); }
}
function create(server, container = null) {
  if (!server) return;
  if (terminalCount(server.id) >= MAX_PER_SERVER) { showError(`Maksimal ${MAX_PER_SERVER} tab terminal untuk ${server.name}. Tutup salah satu tab sebelum membuka shell baru.`); return; }
  if (tabs.size >= MAX_TOTAL) { showError(`Maksimal ${MAX_TOTAL} tab terminal. Tutup salah satu tab sebelum membuka shell baru.`); return; }
  const number = (sequence.get(server.id) || 0) + 1; sequence.set(server.id, number);
  const id = crypto.randomUUID(), name = container ? `${server.name} · Container ${container.name}` : `${server.name} · ${number}`;
  const panel = el('div', { cls: 'terminal-session', attrs: { id: `terminal-session-${id}`, role: 'tabpanel', 'aria-labelledby': `terminal-tab-${id}` } });
  const tab = el('button', { text: name, cls: 'terminal-tab', attrs: { id: `terminal-tab-${id}`, type: 'button', role: 'tab', 'aria-controls': panel.id } });
  const close = el('button', { cls: 'terminal-tab-close', attrs: { type: 'button', 'aria-label': `Tutup tab ${name}`, title: `Tutup ${name}` } }, icon('close'));
  const wrapper = el('div', { cls: 'terminal-tab-item', attrs: { role: 'presentation' } }, tab, close);
  $('term-container').append(panel); $('term-tabs').append(wrapper);
  const term = new window.Terminal({ cursorBlink: true, fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: 14, scrollback: 5000, screenReaderMode: true, theme: theme(), disableStdin: true, macOptionIsMeta: true });
  const addon = new window.FitAddon.FitAddon(); term.loadAddon(addon); term.open(panel);
  const state = { id, name, container, server, serverId: server.id, term, fit: addon, panel, tab, wrapper, sessionId: null, requestId: null, closed: true, opening: false, disposed: false, queue: Promise.resolve(), queuedBytes: 0 };
  tabs.set(id, state);
  tab.addEventListener('click', () => select(state)); close.addEventListener('click', () => remove(state));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const all = [...tabs.values()], index = all.indexOf(state);
    select(all[event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length], false);
  });
  term.onData(data => sendInput(state, encoder.encode(data)));
  term.onBinary(data => sendInput(state, Uint8Array.from(data, char => char.charCodeAt(0))));
  term.onResize(({ cols, rows }) => { if (alive(state) && state.sessionId && !state.closed) api.resize(state.serverId, state.sessionId, { cols, rows }).catch(() => {}); });
  term.attachCustomKeyEventHandler(event => {
    if (event.metaKey && ['c','v'].includes(event.key.toLowerCase())) return false;
    if (event.key === 'Tab' && event.shiftKey) { $('term-clear').focus(); return false; }
    return true;
  });
  state.observer = new ResizeObserver(() => { if (current === state) fit(); }); state.observer.observe(panel);
  select(state); open(state);
}
async function pickServer() {
  let profiles, connected;
  try { [profiles, connected] = await Promise.all([serversApi.list(), serversApi.connected()]); }
  catch { showError('Daftar server tidak dapat dimuat. Coba lagi.'); return; }
  if (!profiles.length) { showError('Belum ada server. Tambahkan server di menu Server terlebih dahulu.'); return; }
  if (profiles.length === 1) { create(profiles[0]); return; }
  const rows = [...profiles].sort((a, b) => Number(connected.includes(b.id)) - Number(connected.includes(a.id))).map(profile => {
    const live = connected.includes(profile.id);
    const option = el('button', { cls: 'btn term-server-option', attrs: { type: 'button' } },
      el('strong', { text: profile.name }), el('small', { text: `${profile.username}@${profile.host}:${profile.port}` }),
      el('span', { text: live ? 'Terhubung' : 'Belum terhubung', cls: `svc-badge ${live ? 'is-running' : ''}` }));
    option.addEventListener('click', () => { $('term-server-dialog').close(); create(profile); });
    return el('li', {}, option);
  });
  $('term-server-list').replaceChildren(...rows);
  $('term-server-dialog').showModal();
}
function loseConnection(message) {
  const keep = !$('view-dns').hidden ? 'dns' : !$('view-terminal').hidden ? 'terminal' : null;
  app.server = null; show(keep || 'servers', { preserve: Boolean(keep) }); showError(message);
}
api.onEvent(packet => {
  if (packet.type === 'disconnected') {
    seeded.delete(packet.serverId);
    for (const state of tabs.values()) if (state.serverId === packet.serverId) end(state, 'Koneksi SSH terputus.');
    if (app.server?.id === packet.serverId) loseConnection('Koneksi SSH terputus. Hubungkan ulang untuk melanjutkan.');
    return;
  }
  const state = [...tabs.values()].find(tab => alive(tab) && tab.serverId === packet.serverId && !tab.closed && (tab.sessionId === packet.sessionId || (tab.opening && tab.requestId === packet.requestId)));
  if (!state) return;
  state.sessionId = packet.sessionId;
  if (packet.type === 'data') {
    const data = new Uint8Array(packet.data);
    state.term.write(data, () => { api.ack(state.serverId, packet.sessionId, data.byteLength).catch(() => {}); });
  } else if (packet.type === 'error') end(state, packet.message);
  else if (packet.type === 'exit') end(state, packet.code === null ? 'Sesi terminal berakhir.' : `Shell keluar dengan kode ${packet.code}.`);
});
$('term-new').addEventListener('click', () => pickServer());
$('term-close').addEventListener('click', async () => {
  const state = current;
  if (!alive(state) || !state.sessionId || state.closed) return;
  if (!window.confirm(`Tutup shell ${state.name}? Proses di shell ini dapat berhenti. Tab lain dan koneksi VPS tetap aktif.`)) return;
  const sessionId = state.sessionId;
  await api.close(state.serverId, sessionId);
  if (state.sessionId === sessionId) end(state, 'Terminal ditutup. Koneksi SSH tetap aktif.');
});
$('term-reopen').addEventListener('click', () => open(current));
$('term-clear').addEventListener('click', () => { current?.term.clear(); current?.term.focus(); });
$('term-fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement === $('term-panel')) await document.exitFullscreen(); else await $('term-panel').requestFullscreen(); }
  catch { showError('Mode fullscreen tidak dapat diubah. Coba lagi.'); }
});
document.addEventListener('fullscreenchange', () => {
  const active = document.fullscreenElement === $('term-panel');
  $('term-fullscreen').setAttribute('aria-pressed', String(active));
  $('term-fullscreen').title = active ? 'Kembali ke tampilan biasa (Esc)' : 'Tampilkan terminal dalam layar penuh';
  $('term-fullscreen-label').textContent = active ? 'Keluar fullscreen' : 'Fullscreen';
  requestAnimationFrame(() => { fit(); if (!$('view-terminal').hidden) current?.term.focus(); });
});
window.addEventListener('resize', fit);
document.addEventListener('theme-change', () => { for (const state of tabs.values()) state.term.options.theme = theme(); });
onShow('terminal', params => {
  if (params?.container && app.server) create(app.server, params.container);
  else if (app.server && !params?.preserve && !seeded.has(app.server.id) && terminalCount(app.server.id) === 0) { seeded.add(app.server.id); create(app.server); }
  else { controls(); requestAnimationFrame(() => { fit(); current?.term.focus(); }); }
});
onLeave('terminal', () => { current?.term.blur(); if (document.fullscreenElement === $('term-panel')) document.exitFullscreen().catch(() => {}); });
