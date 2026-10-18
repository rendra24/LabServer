const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../src/main/store");
const { BackupError, collectBackup, encryptBackup, decryptBackup, restoreBackup, summarizeBackup, writeBackup, readBounded, MAX_FILE } = require("../src/main/backup");

const password = "password-backup-uji-123";
const base = { name: "VPS rahasia", host: "203.0.113.8", username: "deploy", auth: "password" };
const cryptoFor = (device) => ({
  encrypt: (text) => Buffer.from(`${device}:${text}`).reverse(),
  decrypt: (buffer) => {
    const text = Buffer.from(buffer).reverse().toString();
    if (!text.startsWith(`${device}:`)) throw new Error("wrong device");
    return text.slice(device.length + 1);
  },
});
function setup(t, device = "A") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labserver-backup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createStore(dir, device ? cryptoFor(device) : null) };
}

test("backup terenkripsi portabel: profil, password, passphrase, dan private key", async (t) => {
  const source = setup(t);
  const a = source.store.save(base);
  source.store.setSecret(a.id, "password", "password-vps-unik");
  const key = path.join(source.dir, "id_ed25519");
  fs.writeFileSync(key, "PRIVATE KEY FIXTURE\n");
  const b = source.store.save({ ...base, name: "SSH key", auth: "key", keyPath: key });
  source.store.setSecret(b.id, "passphrase", "passphrase-key-unik");
  const data = collectBackup(source.store);
  const encrypted = await encryptBackup(data, password);
  for (const text of ["password-vps-unik", "passphrase-key-unik", "203.0.113.8", "PRIVATE KEY FIXTURE"]) assert.ok(!encrypted.includes(text));
  assert.notDeepEqual(await encryptBackup(data, password), encrypted, "salt dan nonce acak");
  const destination = setup(t, "B");
  const decoded = await decryptBackup(encrypted, password);
  assert.deepEqual(summarizeBackup(decoded, destination.store), { createdAt: data.createdAt, servers: 2, credentials: 2, privateKeys: 1, conflicts: 0 });
  assert.deepEqual(restoreBackup(decoded, destination.store, destination.dir, "keep"), { added: 2, updated: 0, skipped: 0 });
  assert.equal(destination.store.getSecret(a.id, "password"), "password-vps-unik");
  assert.equal(destination.store.getSecret(b.id, "passphrase"), "passphrase-key-unik");
  const restoredPath = destination.store.get(b.id).keyPath;
  assert.ok(restoredPath.startsWith(path.join(destination.dir, "restored-keys")));
  assert.equal(fs.readFileSync(restoredPath, "utf8"), "PRIVATE KEY FIXTURE\n");
  if (process.platform !== "win32") assert.equal(fs.statSync(restoredPath).mode & 0o777, 0o600);
  assert.ok(!fs.readFileSync(path.join(destination.dir, "secrets.json"), "utf8").includes("password-vps-unik"));
  assert.equal(fs.existsSync(path.join(destination.dir, "restore-journal.json")), false);
});

test("password salah dan ciphertext berubah ditolak tanpa menyentuh data lokal", async (t) => {
  const { store, dir } = setup(t);
  store.save(base);
  const before = fs.readFileSync(path.join(dir, "servers.json"));
  const encrypted = await encryptBackup(collectBackup(store), password);
  await assert.rejects(decryptBackup(encrypted, "password-yang-salah"), /salah|rusak/);
  const changed = JSON.parse(encrypted);
  const ciphertext = Buffer.from(changed.data, "base64");
  ciphertext[0] ^= 1;
  changed.data = ciphertext.toString("base64");
  await assert.rejects(decryptBackup(Buffer.from(JSON.stringify(changed)), password), /rusak/);
  assert.deepEqual(fs.readFileSync(path.join(dir, "servers.json")), before);
});

test("format, versi, batas ukuran, base64, profil, dan password divalidasi", async (t) => {
  const { store } = setup(t);
  const a = store.save(base);
  const data = collectBackup(store);
  await assert.rejects(encryptBackup(data, "pendek"), /12/);
  await assert.rejects(encryptBackup(data, "🔒".repeat(400)), /1.024/);
  for (const file of [Buffer.from("broken json"), Buffer.from('{"format":"other"}'), Buffer.alloc(MAX_FILE + 1)]) await assert.rejects(decryptBackup(file, password), BackupError);
  const encrypted = JSON.parse(await encryptBackup(data, password));
  for (const change of [{ version: 2 }, { kdf: "evil" }, { iv: "%%%%" }, { tag: "YQ==" }, { salt: "AAA" }]) {
    await assert.rejects(decryptBackup(Buffer.from(JSON.stringify({ ...encrypted, ...change })), password), BackupError);
  }
  for (const invalid of [
    { ...data, servers: [...data.servers, ...data.servers] },
    { ...data, servers: [{ profile: { ...a, host: "host;id" }, credentials: {} }] },
    { ...data, servers: [{ profile: { ...a, id: "../../escape" }, credentials: {} }] },
  ]) await assert.rejects(encryptBackup(invalid, password), BackupError);
});

test("konflik default dipertahankan; update eksplisit tanpa menghapus server lain/kredensial yang tidak dibackup", (t) => {
  const source = setup(t);
  const a = source.store.save(base);
  const b = source.store.save({ ...base, name: "Server baru" });
  source.store.setSecret(a.id, "password", "dari-backup");
  const data = collectBackup(source.store);
  const dest = setup(t, "B");
  restoreBackup(data, dest.store, dest.dir, "keep");
  dest.store.save({ ...a, name: "Nama lokal" });
  dest.store.setSecret(a.id, "password", "lokal");
  const other = dest.store.save({ ...base, name: "Server lain" });
  assert.deepEqual(restoreBackup(data, dest.store, dest.dir, "keep"), { added: 0, updated: 0, skipped: 2 });
  assert.equal(dest.store.get(a.id).name, "Nama lokal");
  assert.equal(dest.store.getSecret(a.id, "password"), "lokal");
  assert.deepEqual(restoreBackup(data, dest.store, dest.dir, "update"), { added: 0, updated: 2, skipped: 0 });
  assert.equal(dest.store.get(a.id).name, base.name);
  assert.equal(dest.store.getSecret(a.id, "password"), "dari-backup");
  assert.ok(dest.store.get(other.id));
  dest.store.setSecret(b.id, "password", "tidak-ada-di-backup");
  restoreBackup(data, dest.store, dest.dir, "update");
  assert.equal(dest.store.getSecret(b.id, "password"), "tidak-ada-di-backup");
  assert.throws(() => restoreBackup(data, dest.store, dest.dir, "replace"), /tidak valid/);
});

test("private key hilang atau secret tak bisa didekripsi membatalkan backup, tanpa ekspor parsial", (t) => {
  const { store, dir } = setup(t);
  const a = store.save(base);
  store.setSecret(a.id, "password", "rahasia");
  assert.throws(() => collectBackup(createStore(dir, cryptoFor("B"))), /kredensial/);
  assert.throws(() => collectBackup(createStore(dir, null)), /kredensial/);
  store.save({ ...base, auth: "key", keyPath: path.join(dir, "missing-key") });
  assert.throws(() => collectBackup(store), /Private key/);
  assert.equal(store.getSecret(a.id, "password"), "rahasia");
});

test("restore Windows -> perangkat lain tidak menggunakan path sumber, gagal enkripsi membersihkan key staging", (t) => {
  const source = setup(t);
  const key = path.join(source.dir, "key");
  fs.writeFileSync(key, "private-key");
  const a = source.store.save({ ...base, auth: "key", keyPath: key });
  source.store.setSecret(a.id, "passphrase", "secret-key");
  const data = collectBackup(source.store);
  data.servers[0].profile.keyPath = "C:\\Users\\owner\\.ssh\\key";
  const dest = setup(t, null);
  const existing = dest.store.save(base);
  assert.throws(() => restoreBackup(data, dest.store, dest.dir, "keep"), /Restore gagal/);
  assert.deepEqual(dest.store.list().map((p) => p.id), [existing.id]);
  assert.deepEqual(fs.readdirSync(path.join(dest.dir, "restored-keys")), []);
});

test("gagal menulis profil mengembalikan secret dan profil lama; jurnal crash dipulihkan saat startup", (t) => {
  const { store, dir } = setup(t);
  const a = store.save(base);
  store.setSecret(a.id, "password", "lama");
  const previous = { servers: store.list(), secrets: JSON.parse(fs.readFileSync(path.join(dir, "secrets.json"))) };
  const rename = fs.renameSync;
  let failOnce = true;
  t.mock.method(fs, "renameSync", (source, target) => {
    if (failOnce && target === path.join(dir, "servers.json")) { failOnce = false; throw new Error("disk failure"); }
    return rename(source, target);
  });
  assert.throws(() => store.importData([{ profile: { ...a, name: "Baru" }, credentials: { password: "baru" } }]), /disk failure/);
  assert.equal(store.get(a.id).name, base.name);
  assert.equal(store.getSecret(a.id, "password"), "lama");
  fs.writeFileSync(path.join(dir, "restore-journal.json"), JSON.stringify(previous));
  fs.writeFileSync(path.join(dir, "servers.json"), "[]");
  fs.writeFileSync(path.join(dir, "secrets.json"), "{}");
  const recovered = createStore(dir, cryptoFor("A"));
  assert.equal(recovered.getSecret(a.id, "password"), "lama");
  assert.deepEqual(recovered.list(), previous.servers);
});

test("backup rusak lokal tidak ditimpa; output atomik dan batas pembacaan", (t) => {
  const { store, dir } = setup(t);
  store.save(base);
  fs.writeFileSync(path.join(dir, "servers.json"), "broken");
  assert.throws(() => collectBackup(store), /tidak dapat dibaca/);
  assert.equal(fs.readFileSync(path.join(dir, "servers.json"), "utf8"), "broken");
  const file = path.join(dir, "data.labserver");
  writeBackup(file, Buffer.from("encrypted-fixture"));
  assert.equal(readBounded(file, 30).toString(), "encrypted-fixture");
  assert.throws(() => readBounded(file, 5), /besar/);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0);
});
