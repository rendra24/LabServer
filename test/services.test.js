const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../src/main/store");
const { createHostKeyStore } = require("../src/main/hostkeys");
const { createServerService } = require("../src/main/services");
const { SshError } = require("../src/main/ssh");

const fakeCrypto = { encrypt: (s) => Buffer.from(`e:${s}`), decrypt: (b) => b.toString().slice(2) };
const base = { name: "VPS", host: "10.0.0.5", username: "deploy", auth: "password" };

function setup(connectImpl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-svc-"));
  const store = createStore(dir, fakeCrypto);
  const calls = [];
  const svc = createServerService({
    store,
    hostKeys: createHostKeyStore(dir),
    confirmHostKey: async () => true,
    connect: async (profile, opts) => {
      calls.push({ profile, opts });
      return connectImpl(profile, opts);
    },
  });
  return { store, svc, calls };
}
const okConn = () => ({ end() {}, exec: async () => "" });

test("save mengembalikan error per field, bukan exception", () => {
  const { svc } = setup(okConn);
  const r = svc.save({ ...base, port: 0 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.port);
  assert.equal(svc.save(base).ok, true);
});

test("tes koneksi: password dari input, 'ingat' menyimpan terenkripsi", async () => {
  const { svc, store, calls } = setup(okConn);
  const { profile } = svc.save(base);
  const r = await svc.testConnection(profile.id, { password: "pw", remember: true });
  assert.deepEqual(r, { ok: true });
  assert.equal(calls[0].opts.password, "pw");
  assert.equal(store.getSecret(profile.id, "password"), "pw");
  assert.equal(svc.list()[0].hasSavedPassword, true);
});

test("tes koneksi: memakai password tersimpan bila input kosong", async () => {
  const { svc, store, calls } = setup(okConn);
  const { profile } = svc.save(base);
  store.setSecret(profile.id, "password", "tersimpan");
  await svc.testConnection(profile.id, {});
  assert.equal(calls[0].opts.password, "tersimpan");
});

test("tanpa 'ingat', password tidak disimpan", async () => {
  const { svc, store } = setup(okConn);
  const { profile } = svc.save(base);
  await svc.testConnection(profile.id, { password: "pw" });
  assert.equal(store.getSecret(profile.id, "password"), null);
});

test("login ditolak tidak menghapus password tersimpan", async () => {
  const { svc, store } = setup(() => {
    throw new SshError("AUTH_FAILED");
  });
  const { profile } = svc.save(base);
  store.setSecret(profile.id, "password", "lama-salah");
  const r = await svc.testConnection(profile.id, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, "AUTH_FAILED");
  assert.match(r.message, /Autentikasi/);
  await svc.testConnection(profile.id, { password: "password-baru-ditolak", remember: true });
  assert.equal(store.getSecret(profile.id, "password"), "lama-salah");
});

test("passphrase ditolak dan password baru gagal tidak menimpa kredensial lama", async () => {
  const { svc, store } = setup(() => { throw new SshError("BAD_PASSPHRASE"); });
  const { profile } = svc.save({ ...base, auth: "key", keyPath: path.resolve("/tmp/key") });
  store.setSecret(profile.id, "passphrase", "passphrase-lama");
  await svc.testConnection(profile.id, {});
  await svc.testConnection(profile.id, { passphrase: "passphrase-baru", remember: true });
  assert.equal(store.getSecret(profile.id, "passphrase"), "passphrase-lama");
});

test("error tak terduga tidak membocorkan detail", async () => {
  const { svc } = setup(() => {
    throw new Error("/Users/me/secret/path stack");
  });
  const { profile } = svc.save(base);
  const r = await svc.testConnection(profile.id, { password: "x" });
  assert.equal(r.code, "UNKNOWN");
  assert.ok(!r.message.includes("/Users"));
});

test("server tak dikenal", async () => {
  const { svc } = setup(okConn);
  assert.equal((await svc.testConnection("tidak-ada", {})).code, "NOT_FOUND");
});

test("hapus server ikut menghapus secret", () => {
  const { svc, store } = setup(okConn);
  const { profile } = svc.save(base);
  store.setSecret(profile.id, "password", "x");
  svc.remove(profile.id);
  assert.equal(store.getSecret(profile.id, "password"), null);
});

test("list tidak pernah memuat secret", () => {
  const { svc, store } = setup(okConn);
  const { profile } = svc.save(base);
  store.setSecret(profile.id, "password", "rahasia");
  assert.ok(!JSON.stringify(svc.list()).includes("rahasia"));
});
