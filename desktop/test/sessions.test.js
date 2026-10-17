const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createSessionManager } = require("../src/main/sessions");
const { NginxError } = require("../src/main/nginx");
const { SshError } = require("../src/main/ssh");

function fakeConn() {
  const client = new EventEmitter();
  return { client, ended: false, end() { this.ended = true; client.emit("close"); } };
}

function setup({ ops = {}, open, monitor = {} } = {}) {
  const conns = [];
  const calls = [];
  const mgr = createSessionManager({
    open: open || (async () => {
      const c = fakeConn();
      conns.push(c);
      return c;
    }),
    getProfile: (id) => (id === "s1" ? { id, username: "u", nginx: {} } : null),
    makeOps: () =>
      new Proxy({}, {
        get: (_t, name) => async (...args) => {
          calls.push([name, ...args]);
          if (ops[name]) return ops[name](...args);
          return `${String(name)}-ok`;
        },
      }),
    askSudoPassword: async () => "x",
    makeMonitor: () => ({
      load: async (range) => {
        calls.push(["monitor.load", range]);
        if (monitor.load) return monitor.load(range);
        return { range, panels: [] };
      },
      test: async () => (monitor.test ? monitor.test() : { ok: true, targets: [] }),
    }),
  });
  return { mgr, conns, calls };
}

test("operasi sebelum connect -> NOT_CONNECTED", async () => {
  const { mgr } = setup();
  assert.deepEqual((await mgr.call("s1", "list")).code, "NOT_CONNECTED");
});

test("connect lalu operasi diteruskan dengan argumen", async () => {
  const { mgr, calls } = setup();
  assert.deepEqual(await mgr.connect("s1", {}), { ok: true });
  assert.deepEqual(await mgr.call("s1", "read", "app.local"), { ok: true, data: "read-ok" });
  assert.deepEqual(calls.at(-1), ["read", "app.local"]);
});

test("hanya operasi yang diizinkan", async () => {
  const { mgr } = setup();
  await mgr.connect("s1", {});
  for (const op of ["constructor", "__proto__", "exec", "priv", "toString"]) {
    assert.equal((await mgr.call("s1", op)).code, "INVALID_REQUEST", op);
  }
});

test("validasi argumen di batas IPC", async () => {
  const { mgr, calls } = setup();
  await mgr.connect("s1", {});
  const before = calls.length;
  const bad = [
    ["read", 123],
    ["read", { toString: () => "x" }],
    ["write", "a.local", 5],
    ["write", "a.local", "x\0y"],
    ["write", "a.local", "x".repeat(1_048_577)],
    ["create", "a.local"],
  ];
  for (const [op, ...args] of bad) assert.equal((await mgr.call("s1", op, ...args)).code, "INVALID_REQUEST", op);
  assert.equal(calls.length, before); // tidak ada yang sampai ke server
});

test("NginxError diteruskan sebagai kode & pesan ramah", async () => {
  const { mgr } = setup({ ops: { create: async () => { throw new NginxError("FILE_EXISTS"); } } });
  await mgr.connect("s1", {});
  const r = await mgr.call("s1", "create", "a.local", "x");
  assert.equal(r.code, "FILE_EXISTS");
  assert.match(r.message, /sudah ada/);
});

test("error tak dikenal disamarkan", async () => {
  const { mgr } = setup({ ops: { list: async () => { throw new Error("/home/u/secret stack"); } } });
  await mgr.connect("s1", {});
  const r = await mgr.call("s1", "list");
  assert.equal(r.code, "UNKNOWN");
  assert.ok(!r.message.includes("/home"));
});

test("koneksi putus -> sesi dibuang, operasi berikutnya NOT_CONNECTED", async () => {
  const { mgr, conns } = setup();
  await mgr.connect("s1", {});
  conns[0].client.emit("close");
  assert.equal((await mgr.call("s1", "list")).code, "NOT_CONNECTED");
});

test("error 'Not connected' dari ssh2 dipetakan & sesi dibuang", async () => {
  const { mgr } = setup({ ops: { list: async () => { throw new Error("Not connected"); } } });
  await mgr.connect("s1", {});
  assert.equal((await mgr.call("s1", "list")).code, "NOT_CONNECTED");
  assert.equal(mgr.isConnected("s1"), false);
});

test("connect ulang menutup sesi lama; close menutup koneksi", async () => {
  const { mgr, conns } = setup();
  await mgr.connect("s1", {});
  await mgr.connect("s1", {});
  assert.equal(conns[0].ended, true);
  mgr.close("s1");
  assert.equal(conns[1].ended, true);
  assert.equal(mgr.isConnected("s1"), false);
});

test("gagal connect dipetakan (SshError)", async () => {
  const { mgr } = setup({ open: async () => { throw new SshError("AUTH_FAILED"); } });
  const r = await mgr.connect("s1", {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "AUTH_FAILED");
});

test("monitor: butuh sesi; rentang divalidasi sebelum menyentuh server", async () => {
  const { mgr, calls } = setup();
  assert.equal((await mgr.monitor("s1", "load", "1h")).code, "NOT_CONNECTED");
  await mgr.connect("s1", {});
  for (const bad of ["30d", "__proto__", 5, undefined, "1h; up"]) {
    assert.equal((await mgr.monitor("s1", "load", bad)).code, "INVALID_REQUEST", String(bad));
  }
  assert.equal(calls.filter((c) => c[0] === "monitor.load").length, 0);
  assert.deepEqual(await mgr.monitor("s1", "load", "1h"), { ok: true, data: { range: "1h", panels: [] } });
  assert.deepEqual(await mgr.monitor("s1", "test"), { ok: true, data: { ok: true, targets: [] } });
  assert.equal((await mgr.monitor("s1", "exec", "1h")).code, "INVALID_REQUEST");
});

test("monitor: PromError dipetakan ke kode & pesan ramah", async () => {
  const { PromError } = require("../src/main/prometheus");
  const { mgr } = setup({ monitor: { load: async () => { throw new PromError("PROM_UNREACHABLE", "ECONNREFUSED 10.0.0.1"); } } });
  await mgr.connect("s1", {});
  const r = await mgr.monitor("s1", "load", "1h");
  assert.equal(r.code, "PROM_UNREACHABLE");
  assert.match(r.message, /Prometheus/);
  assert.ok(!r.message.includes("10.0.0.1"));
});
