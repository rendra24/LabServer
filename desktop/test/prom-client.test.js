const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { connect } = require("../src/main/ssh");
const { createHostKeyStore } = require("../src/main/hostkeys");
const { createPrometheusClient, PromError } = require("../src/main/prometheus");
const { startServer } = require("./helpers/sshServer");

function fakeProm(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host, method: req.method });
    handler(req, res);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, seen, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) })));
}
const json = (res, body, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

async function setup(t, handler) {
  const prom = await fakeProm(handler);
  const ssh = await startServer();
  const hostKeys = createHostKeyStore(fs.mkdtempSync(path.join(os.tmpdir(), "ds-prom-")));
  const conn = await connect(
    { host: "127.0.0.1", port: ssh.port, username: "deploy", auth: "password" },
    { password: "pw-123", hostKeys, onUnknownHost: async () => true },
  );
  t.after(async () => {
    conn.end();
    await Promise.all([prom.close(), ssh.close()]);
  });
  return { prom, ssh, conn, client: (opts = {}) => createPrometheusClient(conn, { host: "127.0.0.1", port: prom.port, ...opts }) };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof PromError, `bukan PromError: ${e}`);
    assert.equal(e.code, code, `${e.code}: ${e.message}`);
    return true;
  });
}

test("query & queryRange lewat SSH forward, parameter ter-encode", async (t) => {
  const { prom, ssh, client } = await setup(t, (req, res) => {
    json(res, { status: "success", data: { resultType: "vector", result: [{ metric: { job: "node" }, value: [1, "42"] }] } });
  });
  const c = client();
  const q = 'sum(rate(x{a="b c"}[2m])) / 100 & 1';
  const r = await c.query(q);
  assert.deepEqual(r.result[0].value, [1, "42"]);
  const u = new URL(prom.seen[0].url, "http://x");
  assert.equal(u.pathname, "/api/v1/query");
  assert.equal(u.searchParams.get("query"), q);
  assert.equal(prom.seen[0].host, `127.0.0.1:${prom.port}`);
  assert.deepEqual(ssh.stats.forwards.at(-1), { host: "127.0.0.1", port: prom.port }); // lewat tunnel, bukan koneksi langsung

  await c.queryRange("up", 100, 460, 15);
  const ur = new URL(prom.seen[1].url, "http://x");
  assert.equal(ur.pathname, "/api/v1/query_range");
  assert.deepEqual([ur.searchParams.get("start"), ur.searchParams.get("end"), ur.searchParams.get("step")], ["100", "460", "15"]);
});

test("targets mengembalikan target aktif", async (t) => {
  const { prom, client } = await setup(t, (req, res) =>
    json(res, { status: "success", data: { activeTargets: [{ labels: { job: "node" }, health: "up" }] } }));
  const r = await client().targets();
  assert.equal(r.activeTargets[0].labels.job, "node");
  assert.equal(new URL(prom.seen[0].url, "http://x").pathname, "/api/v1/targets");
});

test("error Prometheus -> PROM_QUERY_ERROR, pesan tidak memuat teks mentah server", async (t) => {
  const { client } = await setup(t, (req, res) =>
    json(res, { status: "error", errorType: "bad_data", error: "parse error: /secret/path/leak" }, 400));
  await assert.rejects(client().query("sum(("), (e) => {
    assert.equal(e.code, "PROM_QUERY_ERROR");
    assert.ok(!e.message.includes("/secret"));
    return true;
  });
});

test("respons bukan JSON / bentuk salah / HTTP 500 -> PROM_BAD_RESPONSE", async (t) => {
  let mode = "html";
  const { client } = await setup(t, (req, res) => {
    if (mode === "html") return void res.end("<html>nginx</html>");
    if (mode === "shape") return json(res, { status: "success" });
    if (mode === "range") return json(res, { status: "success", data: { resultType: "matrix", result: "bukan array" } });
    res.writeHead(500);
    res.end("boom");
  });
  for (mode of ["html", "shape", "range", "500"]) {
    await expectCode(client().queryRange("up", 1, 2, 1), "PROM_BAD_RESPONSE");
  }
});

test("respons terlalu besar -> PROM_TOO_LARGE", async (t) => {
  const { client } = await setup(t, (req, res) => json(res, { status: "success", data: { resultType: "vector", result: [], pad: "x".repeat(5000) } }));
  await expectCode(client({ maxBytes: 1000 }).query("up"), "PROM_TOO_LARGE");
});

test("server tidak menjawab -> PROM_TIMEOUT", async (t) => {
  const { client } = await setup(t, () => {});
  await expectCode(client({ timeoutMs: 300 }).query("up"), "PROM_TIMEOUT");
});

test("port Prometheus tertutup -> PROM_UNREACHABLE", async (t) => {
  const { prom, client } = await setup(t, () => {});
  const dead = prom.port;
  await prom.close();
  await expectCode(client({ port: dead }).query("up"), "PROM_UNREACHABLE");
});

test("koneksi SSH sudah putus -> PROM_UNREACHABLE", async (t) => {
  const { conn, client } = await setup(t, (req, res) => json(res, { status: "success", data: { result: [] } }));
  conn.end();
  await new Promise((r) => setTimeout(r, 100));
  await expectCode(client().query("up"), "PROM_UNREACHABLE");
});
