import { app, onLeave, onShow, show } from './app.js';
import { $, el, announce, showError } from './ui.js';
import { icon } from './icons.js';

const api = window.api.terminal;
const encoder = new TextEncoder();
const tabs = new Map();
let current = null;
let server = null;
let sequence = 0;

function theme() {
  return document.documentElement.dataset.theme === 'light'
    ? { background: '#ffffff', foreground: '#33415d', cursor: '#456cd8', selectionBackground: '#dbe5ff', black: '#33415d', brightBlack: '#73829d' }
    : { background: '#12151d', foreground: '#dce4f5', cursor: '#8daaff', selectionBackground: '#35476f', black: '#12151d', brightBlack: '#8290a9' };
}
const alive = state => state && !state.disposed && tabs.get(state.id) === state && state.server === app.server;

function controls() {
  const active = current && !current.closed && !current.opening;
  $('term-status').textContent = !current ? 'Belum ada terminal' : current.opening ? 'Membuka shell…' : current.closed ? 'Shell ditutup' : 'Shell aktif';
  $('term-status').classList.toggle('is-connected', Boolean(active));
  $('term-close').disabled = !active;
  $('term-reopen').disabled = !current || !current.closed || current.opening;
  $('term-clear').disabled = !current;
  $('term-new').disabled = !app.server || tabs.size >= 8;
  $('term-new').title = tabs.size >= 8 ? 'Maksimal 8 tab. Tutup tab untuk membuka terminal baru.' : 'Buka sesi terminal baru';
  $('term-empty').hidden = Boolean(current);
  if (!current) $('term-size').textContent = '';
  for (const state of tabs.values()) {
    const selected = state === current;
    state.panel.hidden = !selected;
    state.tab.setAttribute('aria-selected', String(selected));
    state.tab.tabIndex = selected ? 0 : -1;
    state.wrapper.classList.toggle('is-active', selected);
    state.wrapper.classList.toggle('is-closed', state.closed);
    state.tab.title = `${state.name} - ${state.opening ? 'Membuka shell' : state.closed ? 'Shell ditutup' : 'Shell aktif'}`;
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
    const result = await api.open(state.serverId, { cols: state.term.cols, rows: state.term.rows, requestId, ...(state.container ? { containerId: state.container.id, shell: state.container.shell, sudo: state.container.sudo } : {}) });
    if (!alive(state) || state.requestId !== requestId) {
      if (result.ok) await api.close(state.serverId, result.sessionId);
      return;
    }
    state.opening = false;
    if (!result.ok) {
      end(state, result.message);
      if (result.code === 'NOT_CONNECTED') loseConnection(result.message);
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
function create(container = null) {
  if (!app.server || server !== app.server) return;
  if (tabs.size >= 8) { showError('Maksimal 8 tab terminal. Tutup salah satu tab sebelum membuka shell baru.'); return; }
  const id = crypto.randomUUID(), name = container ? `Container · ${container.name}` : `Terminal ${++sequence}`;
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
function loseConnection(message) {
  const keepDns = !$('view-dns').hidden;
  app.server = null; show(keepDns ? 'dns' : 'servers', { preserve: keepDns }); showError(message);
}
api.onEvent(packet => {
  if (packet.type === 'disconnected' && app.server?.id === packet.serverId) {
    for (const state of tabs.values()) end(state, 'Koneksi SSH terputus.');
    loseConnection('Koneksi SSH terputus. Hubungkan ulang untuk melanjutkan.'); return;
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
$('term-new').addEventListener('click', () => create());
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
  $('term-shell-title').textContent = `SSH shell - ${app.server.username}@${app.server.host}:${app.server.port}`;
  if (server !== app.server) {
    for (const state of tabs.values()) dispose(state);
    current = null; server = app.server; sequence = 0; create(params?.container);
  } else if (params?.container) create(params.container);
  else { controls(); requestAnimationFrame(() => { fit(); current?.term.focus(); }); }
});
onLeave('terminal', () => { current?.term.blur(); if (document.fullscreenElement === $('term-panel')) document.exitFullscreen().catch(() => {}); });
