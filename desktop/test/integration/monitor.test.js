// Monitoring terhadap Prometheus + node_exporter + nginx exporter SUNGGUHAN di container.
// Siapkan: setup-container.sh, apt install prometheus prometheus-node-exporter prometheus-nginx-exporter,
// setup-monitoring.sh. Jalankan: SSHD_PORT=2223 PROM_CONTAINER=dssshd npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { connect } = require("../../src/main/ssh");
const { createHostKeyStore } = require("../../src/main/hostkeys");
const { createMonitor } = require("../../src/main/monitor");
const { validateServer } = require("../../src/main/store");

const env = process.env;
const skip = !(env.SSHD_PORT && env.PROM_CONTAINER) && "set SSHD_PORT dan PROM_CONTAINER (lihat setup-monitoring.sh)";
const sh = (cmd) => execFileSync("docker", ["exec", env.PROM_CONTAINER, "bash", "-c", cmd], { encoding: "utf8" });
const setup = path.join(__dirname, "setup-monitoring.sh");
const byId = (r, id) => r.panels.find((p) => p.id === id);

async function open() {
  const profile = validateServer({ name: "w", host: "127.0.0.1", port: env.SSHD_PORT, username: "writer", auth: "password" });
  const hostKeys = createHostKeyStore(fs.mkdtempSync(path.join(os.tmpdir(), "ds-mon-")));
  const conn = await connect(profile, { password: "pw-writer", hostKeys, onUnknownHost: async () => true });
  return { conn, monitor: createMonitor(conn, profile) };
}

async function until(fn, ms = 40_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last.ok) return last.value;
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.fail(`kondisi tidak tercapai: ${JSON.stringify(last?.why)}`);
}

test("Monitoring dengan Prometheus nyata", { skip }, async (t) => {
  execFileSync(setup, [env.PROM_CONTAINER], { stdio: "ignore" });
  sh("for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1/; done"); // beri Nginx lalu lintas
  const { conn, monitor } = await open();
  t.after(() => conn.end());

  await t.test("test(): target node & nginx up", async () => {
    const r = await monitor.test();
    const jobs = Object.fromEntries(r.targets.map((x) => [x.job, x.health]));
    assert.deepEqual(jobs, { node: "up", nginx: "up" });
  });

  await t.test("semua panel tersedia dan berisi data; nilai cocok dengan kenyataan di server", async () => {
    const r = await until(async () => {
      const x = await monitor.load("15m");
      const cpu = byId(x, "cpu");
      const ready = x.availability.node && x.availability.nginx && cpu.series?.[0].points.length >= 3 && byId(x, "nginx_requests").last !== null;
      return { ok: ready, value: x, why: x.availability };
    });
    assert.equal(r.panels.filter((p) => p.error).length, 0, JSON.stringify(r.panels.filter((p) => p.error)));
    assert.ok(r.panels.every((p) => p.available));

    const num = (id) => byId(r, id).last;
    for (const id of ["cpu", "memory", "disk"]) assert.ok(num(id) >= 0 && num(id) <= 100, `${id}=${num(id)}`);

    // memori & disk vs sumber kebenaran di server (toleransi karena selisih waktu/GC)
    const [total, avail] = sh("awk '/MemTotal|MemAvailable/{print $2}' /proc/meminfo").trim().split("\n").map(Number);
    assert.ok(Math.abs(num("memory") - (1 - avail / total) * 100) < 5, `memori ${num("memory")}`);
    const dfPct = Number(sh("df -P / | awk 'NR==2{gsub(\"%\",\"\",$5); print $5}'"));
    assert.ok(Math.abs(num("disk") - dfPct) < 5, `disk ${num("disk")} vs df ${dfPct}`);
    const up = Number(sh("cut -d' ' -f1 /proc/uptime"));
    assert.ok(Math.abs(num("uptime") - up) < 120, `uptime ${num("uptime")} vs ${up}`);

    assert.equal(num("nginx_up"), 1);
    assert.ok(num("nginx_requests") !== null);
    assert.ok(byId(r, "nginx_connections").series.length === 4);
    assert.ok(byId(r, "net").series.length === 2 && byId(r, "load").series.length === 3);
    for (const p of r.panels.filter((x) => !x.statOnly)) {
      for (const s of p.series) assert.ok(s.points.every(([ts, v]) => Number.isFinite(ts) && (v === null || Number.isFinite(v))), p.id);
    }
  });

  await t.test("tanpa nginx exporter: panel Nginx 'tidak tersedia', panel Host tetap jalan", async () => {
    execFileSync(setup, [env.PROM_CONTAINER, "--no-nginx-exporter"], { stdio: "ignore" });
    const r = await until(async () => {
      const x = await monitor.load("15m");
      return { ok: x.availability.node && byId(x, "cpu").last !== null, value: x, why: x.availability };
    });
    assert.equal(r.availability.nginx, false);
    for (const p of r.panels.filter((x) => x.group === "nginx")) assert.equal(p.available, false, p.id);
    assert.equal(byId(r, "cpu").available, true);
    execFileSync(setup, [env.PROM_CONTAINER], { stdio: "ignore" }); // pulihkan
  });
});
