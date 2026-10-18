const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { validateServer } = require("./store");
const { validateAccount } = require('./cloudflare');

const deriveKey = promisify(crypto.scrypt);
const MAX_FILE = 24 * 1024 * 1024;
const MAX_DATA = 16 * 1024 * 1024;
const MAX_KEY = 1024 * 1024;
const AAD = Buffer.from("LabServer encrypted backup v1");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class BackupError extends Error {}
const fail = (message = "File backup tidak valid atau versinya belum didukung.") => { throw new BackupError(message); };

function checkPassword(password) {
  if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password) > 1024) fail("Password backup harus 12–1.024 karakter (maksimal 1.024 byte).");
}

function base64(value, max, exact) {
  if (typeof value !== "string" || value.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail();
  const data = Buffer.from(value, "base64");
  if (!data.length || data.length > max || (exact && data.length !== exact) || data.toString("base64") !== value) fail();
  return data;
}

function readBounded(file, max) {
  const fd = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) fail("Berkas terlalu besar atau bukan berkas biasa.");
    const buffer = Buffer.alloc(max + 1);
    let size = 0;
    while (size <= max) {
      const read = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > max) fail("Berkas melebihi batas ukuran.");
    return buffer.subarray(0, size);
  } finally { fs.closeSync(fd); }
}

function validateData(data) {
  if (!data || data.format !== "labserver-data" || data.version !== 1 || typeof data.createdAt !== "string" || !Number.isFinite(Date.parse(data.createdAt)) || !Array.isArray(data.servers) || data.servers.length > 2000) fail();
  const ids = new Set();
  const servers = data.servers.map((entry) => {
    if (!entry?.profile || !UUID.test(entry.profile.id) || ids.has(entry.profile.id)) fail();
    ids.add(entry.profile.id);
    let profile;
    try {
      // Path perangkat asal tidak dipakai saat restore, termasuk Windows -> macOS.
      profile = validateServer({ ...entry.profile, keyPath: entry.profile.auth === "key" ? path.join(path.sep, "labserver-restored-key") : undefined });
    } catch { fail("Profil server dalam backup tidak valid."); }
    if (!entry.credentials || typeof entry.credentials !== "object" || Array.isArray(entry.credentials)) fail();
    const credentials = {};
    for (const kind of ["password", "passphrase"]) {
      const value = entry.credentials[kind];
      if (value === undefined) continue;
      if (typeof value !== "string" || Buffer.byteLength(value) > 65536) fail();
      credentials[kind] = value;
    }
    const privateKey = profile.auth === "key" ? base64(entry.privateKey, MAX_KEY).toString("base64") : undefined;
    return { profile, credentials, ...(privateKey ? { privateKey } : {}) };
  });
  let cloudflare;
  if (data.cloudflare !== undefined) {
    if (!Array.isArray(data.cloudflare) || data.cloudflare.length > 2000) fail();
    const accountIds = new Set();
    cloudflare = data.cloudflare.map(entry => {
      if (!entry || !UUID.test(entry.id) || accountIds.has(entry.id)) fail();
      accountIds.add(entry.id);
      try { return validateAccount(entry); } catch { fail('Akun Cloudflare dalam backup tidak valid.'); }
    });
  }
  return { format: "labserver-data", version: 1, createdAt: data.createdAt, servers, ...(cloudflare ? { cloudflare } : {}) };
}

async function encryptBackup(data, password) {
  checkPassword(password);
  const plain = Buffer.from(JSON.stringify(validateData(data)));
  if (plain.length > MAX_DATA) fail("Data backup melebihi batas 16 MB.");
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.from(JSON.stringify({ format: "labserver-backup", version: 1, cipher: "aes-256-gcm", kdf: "scrypt", salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") }));
  } finally { key.fill(0); plain.fill(0); }
}

async function decryptBackup(file, password) {
  checkPassword(password);
  if (!Buffer.isBuffer(file) || file.length > MAX_FILE) fail();
  let envelope;
  try { envelope = JSON.parse(file.toString("utf8")); } catch { fail(); }
  if (!envelope || envelope.format !== "labserver-backup" || envelope.version !== 1 || envelope.cipher !== "aes-256-gcm" || envelope.kdf !== "scrypt") fail();
  const salt = base64(envelope.salt, 16, 16);
  const iv = base64(envelope.iv, 12, 12);
  const tag = base64(envelope.tag, 16, 16);
  const ciphertext = base64(envelope.data, MAX_DATA);
  const key = await deriveKey(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  let plain;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    try { plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]); }
    catch { fail("Password backup salah atau file backup telah rusak/berubah. Data lokal tidak diubah."); }
    let data;
    try { data = JSON.parse(plain.toString("utf8")); } catch { fail(); }
    return validateData(data);
  } finally { key.fill(0); plain?.fill(0); }
}

function collectBackup(store) {
  let entries, cloudflare;
  try { entries = store.exportData(); cloudflare = store.exportCloudflare(); }
  catch { fail("Data lokal atau kredensial tidak dapat dibaca. Buka kunci penyimpanan sistem operasi lalu coba lagi; backup dibatalkan tanpa mengubah data."); }
  const servers = entries.map((entry) => {
    if (entry.profile.auth !== "key") return entry;
    try { return { ...entry, privateKey: readBounded(entry.profile.keyPath, MAX_KEY).toString("base64") }; }
    catch { fail(`Private key untuk server “${entry.profile.name}” tidak dapat dibaca (maksimal 1 MB). Pilih ulang private key sebelum membuat backup.`); }
  });
  return validateData({ format: "labserver-data", version: 1, createdAt: new Date().toISOString(), servers, ...(cloudflare.length ? { cloudflare } : {}) });
}

function summarizeBackup(data, store) {
  const current = new Set(store.listForBackup().map((p) => p.id));
  const accounts = new Set(store.listCloudflare().map(a => a.id));
  return { ...(data.servers.some(e => e.profile.tunnels !== undefined) ? {tunnels:data.servers.reduce((n,e)=>n+(e.profile.tunnels?.length||0),0)} : {}), createdAt: data.createdAt, servers: data.servers.length, credentials: data.servers.filter((e) => Object.keys(e.credentials).length).length, privateKeys: data.servers.filter((e) => e.privateKey).length, conflicts: data.servers.filter((e) => current.has(e.profile.id)).length, ...(data.cloudflare ? { cloudflare: data.cloudflare.length, cloudflareConflicts: data.cloudflare.filter(a => accounts.has(a.id)).length } : {}) };
}

function restoreBackup(data, store, dir, mode) {
  if (!["keep", "update"].includes(mode)) fail("Pilihan restore tidak valid.");
  data = validateData(data);
  const current = new Set(store.listForBackup().map((p) => p.id));
  const entries = data.servers.filter((e) => mode === "update" || !current.has(e.profile.id));
  const result = { added: entries.filter((e) => !current.has(e.profile.id)).length, updated: entries.filter((e) => current.has(e.profile.id)).length, skipped: data.servers.length - entries.length };
  const accountIds = new Set(store.listCloudflare().map(a => a.id));
  const accounts = (data.cloudflare || []).filter(a => mode === 'update' || !accountIds.has(a.id));
  if (data.cloudflare) result.cloudflare = { added: accounts.filter(a => !accountIds.has(a.id)).length, updated: accounts.filter(a => accountIds.has(a.id)).length, skipped: data.cloudflare.length - accounts.length };
  if (!entries.length && !accounts.length) return result;
  let keyDir;
  try {
    const restored = entries.map((entry, index) => {
      if (!entry.privateKey) return entry;
      if (!keyDir) {
        const root = path.join(dir, "restored-keys");
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        keyDir = fs.mkdtempSync(path.join(root, "restore-"));
      }
      const keyPath = path.join(keyDir, `${index}.key`);
      fs.writeFileSync(keyPath, Buffer.from(entry.privateKey, "base64"), { flag: "wx", mode: 0o600 });
      return { ...entry, profile: { ...entry.profile, keyPath } };
    });
    store.importData(restored, accounts);
    return result;
  } catch {
    // Jangan hapus key jika jurnal rollback masih diperlukan setelah error disk.
    if (keyDir && !fs.existsSync(path.join(dir, "restore-journal.json"))) fs.rmSync(keyDir, { recursive: true, force: true });
    fail("Restore gagal. Data sebelumnya dipertahankan; periksa penyimpanan lokal dan enkripsi sistem operasi.");
  }
}

function writeBackup(file, content) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, content, { flag: "wx", mode: 0o600 }); fs.renameSync(tmp, file); }
  finally { fs.rmSync(tmp, { force: true }); }
}

module.exports = { BackupError, MAX_FILE, checkPassword, readBounded, encryptBackup, decryptBackup, collectBackup, summarizeBackup, restoreBackup, writeBackup };
