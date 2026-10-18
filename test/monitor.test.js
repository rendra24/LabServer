const test = require("node:test");
const assert = require("node:assert/strict");
const { createMonitor } = require("../src/main/monitor");
const { PromError } = require("../src/main/prometheus");
const { PANELS } = require("../src/main/monitor-catalog");

const NOW = 1_800_000_000;
const matrix = (values) => ({ resultType: "matrix", result: values === null ? [] : [{ metric: {}, values }] });
const vector = (v) => ({ resultType: "vector", result: v === null ? [] : [{ metric: {}, value: [NOW, String(v)] }] });

function fakeClient({ hasNode = true, hasNginx = true, rangeImpl, targets } = {}) {
  const calls = { range: [], query: [] };
  return {
    calls,
    async query(q) {
      calls.query.push(q);
      if (q.startsWith("count(node_cpu_seconds_total)")) return vector(hasNode ? 1 : null);
      if (q.startsWith("count(nginx_up)")) return vector(hasNginx ? 1 : null);
      return vector(7);
    },
    async queryRange(q, start, end, step) {
      calls.range.push({ q, start, end, step });
      if (rangeImpl) return rangeImpl(q);
      return matrix([[start, "1"], [start + step, "2.5"], [end, "3"]]);
    },
    async targets() {
      if (targets instanceof Error) throw targets;
      return targets || { activeTargets: [] };
    },
  };
}
const monitor = (client) => createMonitor(null, { prometheus: { host: "127.0.0.1", port: 9090 } }, { client, now: () => NOW + 7 });
const byId = (r, id) => r.panels.find((p) => p.id === id);

test("load: panel Host berisi data, panel Nginx 'tidak tersedia' bila exporter tidak ada", async () => {
  const client = fakeClient({ hasNginx: false });
  const r = await monitor(client).load("1h");
  assert.equal(r.availability.node, true);
  assert.equal(r.availability.nginx, false);
  assert.equal(r.panels.length, PANELS.length);
  const cpu = byId(r, "cpu");
  assert.equal(cpu.available, true);
  assert.equal(cpu.series[0].label, "Terpakai");
  assert.equal(cpu.series[0].points.length, 3);
  assert.equal(cpu.last, 3);
  assert.equal(byId(r, "nginx_requests").available, false);
  assert.equal(byId(r, "nginx_requests").series, undefined);
  // tidak ada query nginx dijalankan bila tidak tersedia
  assert.ok(!client.calls.range.some((c) => /nginx_/.test(c.q)));
});

test("load: start/end/step dari builder rentang, sama untuk semua seri", async () => {
  const client = fakeClient();
  await monitor(client).load("15m");
  const first = client.calls.range[0];
  assert.deepEqual([first.end - first.start, first.step], [900, 15]);
  assert.ok(client.calls.range.every((c) => c.start === first.start && c.end === first.end && c.step === first.step));
});

test("normalisasi: NaN/Inf -> null, nilai angka, last = titik non-null terakhir", async () => {
  const client = fakeClient({ rangeImpl: () => matrix([[100, "1.5"], [115, "NaN"], [130, "+Inf"], [145, "4"], [160, "NaN"]]) });
  const cpu = byId(await monitor(client).load("1h"), "cpu");
  assert.deepEqual(cpu.series[0].points, [[100, 1.5], [115, null], [130, null], [145, 4], [160, null]]);
  assert.equal(cpu.last, 4);
});

test("seri kosong -> points [] dan last null (bukan error)", async () => {
  const client = fakeClient({ rangeImpl: () => matrix(null) });
  const cpu = byId(await monitor(client).load("1h"), "cpu");
  assert.deepEqual(cpu.series[0].points, []);
  assert.equal(cpu.last, null);
  assert.equal(cpu.error, undefined);
});

test("panel statOnly memakai query instan", async () => {
  const client = fakeClient();
  const up = byId(await monitor(client).load("1h"), "uptime");
  assert.equal(up.last, 7);
  assert.equal(up.series, undefined);
  assert.ok(client.calls.query.some((q) => q.includes("node_boot_time_seconds")));
  assert.ok(!client.calls.range.some((c) => c.q.includes("node_boot_time_seconds")));
});

test("kegagalan satu panel tidak menjatuhkan yang lain", async () => {
  const client = fakeClient({
    rangeImpl: (q) => {
      if (q.includes("MemAvailable")) throw new PromError("PROM_QUERY_ERROR", "x");
      return matrix([[1, "1"]]);
    },
  });
  const r = await monitor(client).load("1h");
  assert.equal(byId(r, "memory").error.code, "PROM_QUERY_ERROR");
  assert.ok(byId(r, "memory").error.message);
  assert.equal(byId(r, "cpu").error, undefined);
});

test("Prometheus tidak terjangkau saat deteksi -> melempar (UI menampilkan error umum)", async () => {
  const client = fakeClient();
  client.query = async () => {
    throw new PromError("PROM_UNREACHABLE");
  };
  await assert.rejects(monitor(client).load("1h"), { code: "PROM_UNREACHABLE" });
});

test("rentang tidak valid ditolak", async () => {
  await assert.rejects(monitor(fakeClient()).load("30d"), /rentang/i);
});

test("test(): ringkas target tanpa membocorkan lastError/URL", async () => {
  const client = fakeClient({
    targets: { activeTargets: [
      { labels: { job: "node", instance: "localhost:9100" }, health: "up", lastError: "", scrapeUrl: "http://localhost:9100/metrics" },
      { labels: { job: "nginx", instance: "localhost:9113" }, health: "down", lastError: "connection refused to /internal/x", scrapeUrl: "http://localhost:9113/metrics" },
    ] },
  });
  const r = await monitor(client).test();
  assert.deepEqual(r.targets, [
    { job: "node", instance: "localhost:9100", health: "up" },
    { job: "nginx", instance: "localhost:9113", health: "down" },
  ]);
  assert.equal(JSON.stringify(r).includes("refused"), false);
  assert.equal(JSON.stringify(r).includes("scrape"), false);
});
