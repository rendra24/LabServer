const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseCertificates } = require('../src/main/ssl-ops');

function fixture() {
  const nodes = new Map(), calls = [], cancelled = [];
  function node() {
    return { hidden: true, open: false, value: '', dataset: {}, children: [],
      addEventListener() {}, replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      querySelectorAll() { return []; }, close() { this.open = false; } };
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  $('view-ssl').hidden = false;
  const api = {
    call: (id, op, input) => new Promise(resolve => calls.push({ id, op, input, resolve })),
    cancel: async (id, requestId) => { cancelled.push({ id, requestId }); },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/ssl.js'), 'utf8').replace(/^import .*;\n/gm, '');
  const renderer = vm.runInNewContext(source + '\n;({load,mutate,state})', {
    app: { server: { id: 'server-a' } }, $, el: node, onShow() {}, onLeave() {},
    show() {}, invalidateSyntax() {}, announce() {}, showError() {},
    guardFileChanges: async () => true, readHistory: async () => null, historyLabel() {}, crypto: { randomUUID: () => `request-${calls.length}` },
    window: { api: { ssl: api, onToolEvent() {} } },
  });
  return { ...renderer, $, calls, cancelled };
}

for (const [marker, label] of [['VALID: 90 days', 'Aktif'], ['INVALID: TEST_CERT', 'Tidak valid'], ['INVALID: EXPIRED', 'Tidak valid']]) {
  test(`SSL retains Certbot validity for ${marker} even with a future expiry`, () => {
    const expiry = new Date(Date.now() + 90 * 86400000).toISOString().replace('T', ' ').slice(0, 19) + '+00:00';
    const [cert] = parseCertificates(`Found the following certs:\n  Certificate Name: example.com\n    Domains: example.com\n    Expiry Date: ${expiry} (${marker})\n`);
    assert.ok(Number.isFinite(cert.expiresAt));
    const status = fixture().state(cert);
    assert.equal(status.label, label);
    if (marker.startsWith('INVALID')) assert.notEqual(status.cls, 'is-running');
    if (marker.includes('TEST_CERT')) assert.match(status.days, /uji|staging/i);
  });
}

for (const op of ['issue', 'renew']) for (const stale of ['success', 'error']) {
  test(`SSL ${op} result survives a delayed list ${stale}`, async () => {
    const f = fixture();
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const initial = f.load(); await tick(); // pembacaan history lokal selesai, lalu permintaan live dikirim
    f.calls[0].resolve({ ok: true, data: { certificates: [] } }); await initial;
    const refresh = f.load(); await tick();
    const mutation = f.mutate(op, {}); await tick();
    assert.equal(f.calls[2].op, op);
    f.calls[2].resolve({ ok: true, data: { certificates: [{ name: 'new.example.com', domains: ['new.example.com'], expiresAt: Date.now() + 90 * 86400000, supported: true }], notice: 'Sertifikat terbaru' } });
    await mutation;
    f.calls[1].resolve(stale === 'success' ? { ok: true, data: { certificates: [] } } : { ok: false, message: 'Old failure' });
    await refresh;
    assert.equal(f.$('ssl-total').textContent, 1, 'old reads must not replace mutation results');
    assert.equal(f.$('ssl-new').disabled, false);
    assert.equal(f.$('ssl-loading').hidden, true);
    assert.equal(f.$('ssl-status').textContent, 'Sertifikat terbaru');
    assert.equal(f.$('ssl-error').textContent, '');
    assert.ok(f.cancelled.some(call => call.requestId === f.calls[1].input.requestId));
  });
}
