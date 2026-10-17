const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore, validateServer, ValidationError } = require("../src/main/store");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ds-store-"));
const base = { name: "VPS 1", host: "203.0.113.10", username: "deploy", auth: "password" };
const fakeCrypto = {
  encrypt: (s) => Buffer.from(`enc:${s}`),
  decrypt: (b) => b.toString().replace(/^enc:/, ""),
};

function errorsOf(input) {
  try {
    validateServer(input);
  } catch (e) {
    assert.ok(e instanceof ValidationError);
    return e.errors;
  }
  assert.fail("harusnya gagal validasi");
}

test("default port & path nginx diisi", () => {
  const p = validateServer(base);
  assert.equal(p.port, 22);
  assert.deepEqual(p.nginx, {
    available: "/etc/nginx/sites-available",
    enabled: "/etc/nginx/sites-enabled",
    nginxBin: "/usr/sbin/nginx",
    reload: "systemctl",
  });
});

test("host: hostname, IPv4, IPv6 diterima; lainnya ditolak", () => {
  for (const host of ["server.example.com", "10.0.0.1", "::1", "2001:db8::5", "vps-1"]) {
    assert.equal(validateServer({ ...base, host }).host, host);
  }
  for (const host of ["", "-oProxyCommand=x", "a b", "host;id", "a..b", "x".repeat(254)]) {
    assert.ok(errorsOf({ ...base, host }).host, host);
  }
});

test("port, username, nama, auth divalidasi", () => {
  assert.ok(errorsOf({ ...base, port: 0 }).port);
  assert.ok(errorsOf({ ...base, port: 70000 }).port);
  assert.ok(errorsOf({ ...base, port: "22; id" }).port);
  assert.ok(errorsOf({ ...base, username: "root;id" }).username);
  assert.ok(errorsOf({ ...base, username: "-x" }).username);
  assert.ok(errorsOf({ ...base, name: "  " }).name);
  assert.ok(errorsOf({ ...base, auth: "kerberos" }).auth);
});

test("auth key wajib keyPath absolut", () => {
  assert.ok(errorsOf({ ...base, auth: "key" }).keyPath);
  assert.ok(errorsOf({ ...base, auth: "key", keyPath: "id_ed25519" }).keyPath);
  const abs = path.resolve("/home/me/.ssh/id_ed25519");
  assert.equal(validateServer({ ...base, auth: "key", keyPath: abs }).keyPath, abs);
  assert.equal(validateServer({ ...base, keyPath: abs }).keyPath, undefined); // diabaikan untuk password
});

test("path nginx harus absolut, tanpa .. dan karakter aneh; reload dari daftar tetap", () => {
  for (const bad of ["etc/nginx", "/etc/../root", "/etc/nginx;id", "/etc/nginx sites", "/etc/$(id)"]) {
    assert.ok(errorsOf({ ...base, nginx: { available: bad } })["nginx.available"], bad);
  }
  assert.ok(errorsOf({ ...base, nginx: { nginxBin: "nginx" } })["nginx.nginxBin"]);
  assert.ok(errorsOf({ ...base, nginx: { reload: "rm -rf /" } })["nginx.reload"]);
  const p = validateServer({ ...base, nginx: { available: "/usr/local/nginx/conf/sites", reload: "service" } });
  assert.equal(p.nginx.available, "/usr/local/nginx/conf/sites");
  assert.equal(p.nginx.enabled, "/etc/nginx/sites-enabled");
  assert.equal(p.nginx.reload, "service");
});

test("properti tak dikenal dibuang", () => {
  const p = validateServer({ ...base, evil: "x", password: "secret" });
  assert.equal(p.evil, undefined);
  assert.equal(p.password, undefined); // password tidak pernah masuk servers.json
});

test("CRUD tersimpan ke disk dengan mode 0600", () => {
  const dir = tmp();
  const s = createStore(dir, fakeCrypto);
  const a = s.save(base);
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  const b = s.save({ ...base, name: "VPS 2" });
  assert.deepEqual(s.list().map((x) => x.name), ["VPS 1", "VPS 2"]);
  s.save({ ...a, name: "VPS 1 baru" });
  assert.equal(createStore(dir, fakeCrypto).get(a.id).name, "VPS 1 baru"); // persist
  s.remove(b.id);
  assert.deepEqual(s.list().map((x) => x.id), [a.id]);
  const mode = fs.statSync(path.join(dir, "servers.json")).mode & 0o777;
  if (process.platform !== "win32") assert.equal(mode, 0o600);
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes(".tmp")).length, 0);
});

test("update id tak dikenal ditolak", () => {
  const s = createStore(tmp(), fakeCrypto);
  assert.throws(() => s.save({ ...base, id: "00000000-0000-0000-0000-000000000000" }), /tidak ditemukan/);
});

test("secret terenkripsi, tidak tertulis polos, ikut terhapus bersama server", () => {
  const dir = tmp();
  const s = createStore(dir, fakeCrypto);
  const a = s.save(base);
  s.setSecret(a.id, "password", "rahasia-123");
  assert.equal(s.getSecret(a.id, "password"), "rahasia-123");
  assert.ok(!fs.readFileSync(path.join(dir, "secrets.json"), "utf8").includes("rahasia-123"));
  assert.ok(!fs.readFileSync(path.join(dir, "servers.json"), "utf8").includes("rahasia"));
  s.remove(a.id);
  assert.equal(s.getSecret(a.id, "password"), null);
});

test("tanpa enkripsi OS, secret tidak disimpan", () => {
  const s = createStore(tmp(), null);
  const a = s.save(base);
  assert.throws(() => s.setSecret(a.id, "password", "x"), /enkripsi/i);
});

test("berkas rusak tidak membuat aplikasi crash", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "servers.json"), "{bukan json");
  assert.deepEqual(createStore(dir, fakeCrypto).list(), []);
});
