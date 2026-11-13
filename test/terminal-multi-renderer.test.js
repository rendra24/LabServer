const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const A = { id: 'a', name: 'Server A', username: 'u', host: 'a.test', port: 22, auth: 'password' };
const B = { id: 'b', name: 'Server B', username: 'u', host: 'b.test', port: 22, auth: 'password' };
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

function fixture({ connected = [] } = {}) {
  const nodes = new Map(), opens = [], connects = [], errors = [], shows = [];
  let listener = null, uuid = 0, connectedNow = [...connected], connectResult = { ok: true };
  function node() {
    return { hidden: false, disabled: false, textContent: '', title: '', tabIndex: 0, children: [], classList: { toggle() {}, add() {}, remove() {} },
      append(...c) { this.children.push(...c); }, remove() {}, setAttribute() {}, addEventListener() {}, focus() {}, replaceChildren() {} };
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  $('view-terminal').hidden = false; $('view-dns').hidden = true;
  class FakeTerminal {
    constructor() { this.options = {}; this.cols = 80; this.rows = 24; }
    loadAddon() {} open() {} onData() {} onBinary() {} onResize() {} attachCustomKeyEventHandler() {}
    blur() {} focus() {} write(_d, cb) { cb?.(); } writeln() {} clear() {} resize() {} dispose() {}
  }
  const terminalApi = {
    open: async (serverId, size) => { opens.push({ serverId, size }); return { ok: true, sessionId: `s${opens.length}` }; },
    write: async () => ({ ok: true }), resize: async () => ({ ok: true }), close: async () => ({ ok: true }), ack: async () => ({ ok: true }),
    onEvent(handler) { listener = handler; return () => {}; },
  };
  const serversApi = {
    connected: async () => [...connectedNow],
    connect: async id => { connects.push(id); await new Promise(resolve => setImmediate(resolve)); if (connectResult.ok) connectedNow.push(id); return connectResult; },
    list: async () => [A, B],
  };
  const app = { server: null, canRemember: false };
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/terminal.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const exposed = vm.runInNewContext(source + '\n;({ create, tabs, terminalCount })', {
    app, $, el: node, icon: node, announce() {}, showError: message => { if (message) errors.push(message); }, show: (...args) => shows.push(args),
    onShow() {}, onLeave() {}, withCredentials: (_server, attempt) => attempt({}),
    TextEncoder, Uint8Array, Promise, setImmediate,
    crypto: { randomUUID: () => `${String(++uuid).padStart(8, '0')}-0000-4000-8000-000000000000` },
    requestAnimationFrame: fn => fn(), ResizeObserver: class { observe() {} disconnect() {} },
    document: { documentElement: { dataset: {} }, addEventListener() {}, fullscreenElement: null },
    window: { api: { terminal: terminalApi, servers: serversApi }, Terminal: FakeTerminal, FitAddon: { FitAddon: class { fit() {} } }, addEventListener() {}, confirm: () => true },
  });
  return { ...exposed, app, opens, connects, errors, shows, emit: packet => listener(packet), failConnect: message => { connectResult = { ok: false, code: 'CONNECT_FAILED', message }; } };
}

test('tabs of two servers coexist and each opens a shell on its own server', async () => {
  const f = fixture({ connected: ['a', 'b'] });
  f.create(A); f.create(B); await settle();
  assert.equal(f.tabs.size, 2);
  assert.deepEqual(f.opens.map(open => open.serverId).sort(), ['a', 'b']);
  assert.equal(f.terminalCount('a'), 1);
  assert.equal(f.terminalCount('b'), 1);
});

test('the 8-tab limit applies per server, not across servers', async () => {
  const f = fixture({ connected: ['a', 'b'] });
  for (let i = 0; i < 9; i++) f.create(A);
  assert.equal(f.terminalCount('a'), 8);
  assert.equal(f.errors.length, 1);
  f.create(B);
  assert.equal(f.terminalCount('b'), 1);
});

test('a disconnected server ends only its own tabs and does not navigate away from other servers', async () => {
  const f = fixture({ connected: ['a', 'b'] });
  f.create(A); f.create(B); await settle();
  f.app.server = B;
  f.emit({ type: 'disconnected', serverId: 'a' });
  const [tabA, tabB] = [...f.tabs.values()];
  assert.equal(tabA.closed, true);
  assert.equal(tabB.closed, false);
  assert.equal(f.shows.length, 0);
  assert.equal(f.app.server, B);
});

test('a disconnect of the active workspace server leaves the workspace', async () => {
  const f = fixture({ connected: ['a'] });
  f.create(A); await settle();
  f.app.server = A;
  f.emit({ type: 'disconnected', serverId: 'a' });
  assert.equal(f.app.server, null);
  assert.equal(f.shows.length, 1);
});

test('an unconnected server is connected once even when two tabs open together', async () => {
  const f = fixture();
  f.create(A); f.create(A); await settle();
  assert.deepEqual(f.connects, ['a']);
  assert.equal(f.opens.length, 2);
});

test('an already connected server is reused without reconnecting', async () => {
  const f = fixture({ connected: ['a'] });
  f.create(A); await settle();
  assert.deepEqual(f.connects, []);
  assert.equal(f.opens.length, 1);
});

test('a failed connection ends the tab without opening a shell', async () => {
  const f = fixture();
  f.failConnect('Autentikasi gagal.');
  f.create(A); await settle();
  assert.equal(f.opens.length, 0);
  assert.equal([...f.tabs.values()][0].closed, true);
});
