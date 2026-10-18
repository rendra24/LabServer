// Operasi Nginx remote terhadap container dari setup-container.sh (OpenSSH + Nginx sungguhan).
// Dilewati kecuali SSHD_PORT dan NGINX_CONTAINER diset.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { connect } = require("../../src/main/ssh");
const { createHostKeyStore } = require("../../src/main/hostkeys");
const { createNginxOps } = require("../../src/main/nginx");
const { validateServer } = require("../../src/main/store");

const env = process.env;
const skip = !(env.SSHD_PORT && env.NGINX_CONTAINER) && "set SSHD_PORT dan NGINX_CONTAINER (lihat setup-container.sh)";
const docker = (cmd) => execFileSync("docker", ["exec", env.NGINX_CONTAINER, "bash", "-c", cmd], { encoding: "utf8" });
const httpGet = (host) => docker(`curl -s -H 'Host: ${host}' http://127.0.0.1:8081/ || true`);
// reload nginx asinkron (sinyal ke master): tunggu worker baru sebelum menyimpulkan.
async function served(host, expected, ms = 5000) {
  const end = Date.now() + ms;
  let got;
  while (Date.now() < end) {
    got = httpGet(host);
    if (got === expected) return got;
    await new Promise((r) => setTimeout(r, 100));
  }
  return got;
}
const owner = (p) => docker(`stat -c %U ${p}`).trim();

// Isi rumit: kutip, $, backslash, unicode, tanpa newline di akhir.
const tricky = (domain, body) =>
  `# 'kutip' "ganda" $host \\backslash — ünïcødé\nserver {\n    listen 8081;\n    server_name ${domain};\n    location / { return 200 "${body}"; }\n}`;

async function session(username, extra = {}) {
  const hostKeys = createHostKeyStore(fs.mkdtempSync(path.join(os.tmpdir(), "ds-ng-")));
  const profile = validateServer({
    name: username, host: "127.0.0.1", port: env.SSHD_PORT, username, auth: "password",
    nginx: { reload: "nginx-signal" },
  });
  const conn = await connect(profile, { password: `pw-${username}`, hostKeys, onUnknownHost: async () => true });
  return { conn, ops: createNginxOps(conn, profile, extra) };
}

async function fullScenario(t, username, expectOwner, opts = {}) {
  const { conn, ops } = await session(username, opts);
  t.after(() => conn.end());
  const site = `ds-${username}.local`;
  const copy = `ds-${username}-copy.local`;
  docker(`rm -f /etc/nginx/sites-enabled/ds-${username}* /etc/nginx/sites-available/ds-${username}*; nginx -s reload`);

  await t.test("list memuat default yang aktif", async () => {
    const def = (await ops.list()).find((s) => s.name === "default");
    assert.ok(def && def.enabled && !def.conflict);
  });

  await t.test("create persis isinya, pemilik sesuai model izin", async () => {
    await ops.create(site, tricky(site, `v1-${username}`));
    assert.equal(await ops.read(site), tricky(site, `v1-${username}`));
    assert.equal(owner(`/etc/nginx/sites-available/${site}`), expectOwner);
    assert.equal(docker(`ls -a /etc/nginx/sites-available | grep -c '\\.ds-' || true`).trim(), "0"); // tanpa sisa tmp
  });

  await t.test("create nama yang sudah ada -> FILE_EXISTS, isi tidak berubah", async () => {
    await assert.rejects(ops.create(site, "x"), { code: "FILE_EXISTS" });
    assert.equal(await ops.read(site), tricky(site, `v1-${username}`));
  });

  await t.test("nama ilegal ditolak tanpa menyentuh server", async () => {
    await assert.rejects(ops.create("../../etc/x", "x"), { code: "INVALID_FILENAME" });
    await assert.rejects(ops.write("a;id", "x"), { code: "INVALID_FILENAME" });
  });

  await t.test("write mengganti isi secara utuh", async () => {
    await ops.write(site, tricky(site, `v2-${username}`));
    assert.equal(await ops.read(site), tricky(site, `v2-${username}`));
  });

  await t.test("clone dengan isi baru (domain diganti)", async () => {
    await ops.clone(site, copy, tricky(copy, `copy-${username}`));
    assert.equal(await ops.read(copy), tricky(copy, `copy-${username}`));
    assert.equal(await ops.read(site), tricky(site, `v2-${username}`)); // sumber utuh
  });

  await t.test("enable + test + reload -> vhost benar-benar dilayani", async () => {
    await ops.enable(site);
    await ops.enable(site); // idempoten
    const s = (await ops.list()).find((x) => x.name === site);
    assert.ok(s.enabled);
    assert.equal((await ops.test()).ok, true);
    const r = await ops.reload();
    assert.equal(r.ok, true, r.output);
    assert.equal(await served(site, `v2-${username}`), `v2-${username}`);
  });

  await t.test("config rusak: test gagal, reload DIBLOKIR, daemon tetap melayani versi lama", async () => {
    await ops.write(site, tricky(site, "rusak").replace("listen 8081;", "listen 8081;\n    bogus_directive on;"));
    const t1 = await ops.test();
    assert.equal(t1.ok, false);
    assert.match(t1.output, /bogus_directive/);
    const r = await ops.reload();
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    assert.equal(httpGet(site), `v2-${username}`);
    await ops.write(site, tricky(site, `v3-${username}`));
    assert.equal((await ops.reload()).ok, true);
    assert.equal(await served(site, `v3-${username}`), `v3-${username}`);
  });

  await t.test("disable menghapus symlink saja", async () => {
    await ops.disable(site);
    await ops.disable(site); // idempoten
    assert.equal((await ops.list()).find((x) => x.name === site).enabled, false);
    assert.equal(await ops.read(site), tricky(site, `v3-${username}`));
  });

  await t.test("entri asing di sites-enabled tidak ditimpa", async () => {
    docker(`echo asing > /etc/nginx/sites-enabled/${copy}`);
    await assert.rejects(ops.enable(copy), { code: "SYMLINK_CONFLICT" });
    await assert.rejects(ops.disable(copy), { code: "SYMLINK_CONFLICT" });
    assert.equal((await ops.list()).find((x) => x.name === copy).conflict, true);
    assert.equal(docker(`cat /etc/nginx/sites-enabled/${copy}`).trim(), "asing");
    docker(`rm -f /etc/nginx/sites-enabled/${copy}`);
  });
}

test("model izin: writer (grup nginxconf, SFTP langsung)", { skip }, (t) => fullScenario(t, "writer", "writer"));
test("model izin: sudoer (sudo NOPASSWD)", { skip }, (t) => fullScenario(t, "sudoer", "root"));

test("model izin: sudopw (sudo berpassword)", { skip }, async (t) => {
  let asked = 0;
  await t.test("tanpa penyedia password -> SUDO_PASSWORD_REQUIRED", async () => {
    const { conn, ops } = await session("sudopw");
    try {
      await assert.rejects(ops.test(), { code: "SUDO_PASSWORD_REQUIRED" });
    } finally {
      conn.end();
    }
  });
  await t.test("password sudo salah -> SUDO_BAD_PASSWORD, lalu benar -> jalan", async () => {
    const answers = ["salah", "pw-sudopw"];
    const { conn, ops } = await session("sudopw", { askSudoPassword: async () => (asked++, answers.shift()) });
    try {
      await assert.rejects(ops.test(), { code: "SUDO_BAD_PASSWORD" });
      assert.equal((await ops.test()).ok, true);
    } finally {
      conn.end();
    }
  });
  asked = 0;
  await t.test("skenario lengkap; password diminta sekali per sesi", async (tt) => {
    await fullScenario(tt, "sudopw", "root", { askSudoPassword: async () => (asked++, "pw-sudopw") });
    assert.equal(asked, 1);
  });
});
