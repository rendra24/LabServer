const test = require("node:test");
const assert = require("node:assert/strict");
const { PANELS, RANGES, buildRange, getPanel, parseRequest } = require("../src/main/monitor-catalog");
const { validateServer, ValidationError } = require("../src/main/store");

test("setiap panel punya id unik, query tetap, dan exporter yang dibutuhkan", () => {
  const ids = new Set();
  for (const p of PANELS) {
    assert.ok(!ids.has(p.id), `id ganda ${p.id}`);
    ids.add(p.id);
    assert.ok(["host", "nginx"].includes(p.group));
    assert.ok(["node", "nginx"].includes(p.requires));
    assert.ok(p.series.length >= 1);
    for (const s of p.series) {
      assert.equal(typeof s.query, "string");
      // PromQL hanya dari katalog: tanpa placeholder/interpolasi yang tersisa
      assert.doesNotMatch(s.query, /\$\{|\{\{|undefined/);
      assert.equal([...s.query].filter((c) => c === "(").length, [...s.query].filter((c) => c === ")").length, s.query);
      assert.equal([...s.query].filter((c) => c === "{").length, [...s.query].filter((c) => c === "}").length, s.query);
    }
  }
  const groups = new Set(PANELS.map((p) => p.group));
  assert.deepEqual([...groups].sort(), ["host", "nginx"]);
  for (const id of ["cpu", "memory", "disk", "net", "load", "uptime", "nginx_connections", "nginx_requests"]) {
    assert.ok(getPanel(id), `panel ${id}`);
  }
});

test("getPanel hanya untuk id katalog", () => {
  assert.equal(getPanel("cpu").id, "cpu");
  for (const bad of ["constructor", "__proto__", "up", "", undefined, 5, "cpu; drop"]) assert.equal(getPanel(bad), null, String(bad));
});

test("rentang & step: tersedia, selaras, <= 500 titik, step kelipatan 15", () => {
  assert.deepEqual(Object.keys(RANGES), ["15m", "1h", "6h", "24h", "7d"]);
  const now = 1_800_000_123;
  for (const [key, seconds] of Object.entries(RANGES)) {
    const r = buildRange(key, now);
    assert.equal(r.step % 15, 0, key);
    assert.equal(r.start % r.step, 0);
    assert.equal(r.end % r.step, 0);
    assert.ok(r.end <= now && now - r.end < r.step, key);
    assert.ok((r.end - r.start) / r.step <= 500, key);
    assert.ok(r.end - r.start >= seconds - r.step, key);
  }
  assert.throws(() => buildRange("30d", now), /rentang/i);
  assert.throws(() => buildRange("__proto__", now), /rentang/i);
});

test("parseRequest: hanya {panelId, range} valid", () => {
  assert.deepEqual(parseRequest({ panelId: "cpu", range: "1h" }), { panel: getPanel("cpu"), range: "1h" });
  assert.equal(parseRequest({ panelId: "cpu", range: "1h", promql: "up" }).panel.id, "cpu"); // properti ekstra diabaikan
  for (const bad of [null, undefined, "cpu", { panelId: "x", range: "1h" }, { panelId: "cpu", range: "9y" }, { panelId: {}, range: "1h" }]) {
    assert.equal(parseRequest(bad), null, JSON.stringify(bad));
  }
});

test("profil server: konfigurasi Prometheus default & validasi", () => {
  const base = { name: "S", host: "10.0.0.1", username: "deploy", auth: "password" };
  assert.deepEqual(validateServer(base).prometheus, { host: "127.0.0.1", port: 9090 });
  assert.deepEqual(validateServer({ ...base, prometheus: { host: "prom.internal", port: "9091" } }).prometheus, { host: "prom.internal", port: 9091 });
  for (const bad of [{ host: "a b" }, { host: "-x" }, { host: "x;id" }, { port: 0 }, { port: 70000 }, { port: "9090; id" }]) {
    assert.throws(() => validateServer({ ...base, prometheus: bad }), (e) => e instanceof ValidationError && Object.keys(e.errors).some((k) => k.startsWith("prometheus")), JSON.stringify(bad));
  }
});
