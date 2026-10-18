const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { validateAccount } = require('./cloudflare');
const { validateTunnels } = require('./forwarding-config');

const HOSTNAME_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const USERNAME_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,63}$/;
// Path remote dipakai di perintah shell (fallback sudo), jadi sengaja sempit.
const REMOTE_PATH_RE = /^\/[A-Za-z0-9._/-]*$/;
const RELOAD_METHODS = ["systemctl", "service", "nginx-signal"];
const SECRET_KINDS = ["password", "passphrase"];
const NGINX_DEFAULTS = {
  available: "/etc/nginx/sites-available",
  enabled: "/etc/nginx/sites-enabled",
  nginxBin: "/usr/sbin/nginx",
  reload: "systemctl",
};

const PROMETHEUS_DEFAULTS = { host: "127.0.0.1", port: 9090 };

class ValidationError extends Error {
  constructor(errors) {
    super("Data server tidak valid.");
    this.errors = errors;
  }
}

const validRemotePath = (p) =>
  typeof p === "string" && REMOTE_PATH_RE.test(p) && !p.split("/").includes("..");

function validateServer(input) {
  const errors = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 64) errors.name = "Nama wajib diisi (maks. 64 karakter).";

  const host = typeof input.host === "string" ? input.host.trim() : "";
  if (!(net.isIP(host) || HOSTNAME_RE.test(host))) errors.host = "Host harus hostname atau alamat IP yang valid.";

  const port = input.port === undefined || input.port === "" ? 22 : Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = "Port harus 1–65535.";

  const username = typeof input.username === "string" ? input.username.trim() : "";
  if (!USERNAME_RE.test(username)) errors.username = "Username tidak valid.";

  if (!["password", "key"].includes(input.auth)) errors.auth = "Metode autentikasi harus password atau key.";
  let keyPath;
  if (input.auth === "key") {
    keyPath = typeof input.keyPath === "string" ? input.keyPath.trim() : "";
    if (!keyPath || !path.isAbsolute(keyPath)) errors.keyPath = "Pilih berkas private key (path absolut).";
  }

  const nginx = { ...NGINX_DEFAULTS };
  for (const key of ["available", "enabled", "nginxBin"]) {
    const value = input.nginx?.[key];
    if (value === undefined || value === "") continue;
    if (!validRemotePath(value)) errors[`nginx.${key}`] = "Path harus absolut, tanpa spasi, '..', atau karakter khusus.";
    else nginx[key] = value.replace(/\/+$/, "") || "/";
  }
  const reload = input.nginx?.reload;
  if (reload !== undefined && reload !== "") {
    if (!RELOAD_METHODS.includes(reload)) errors["nginx.reload"] = "Metode reload tidak dikenal.";
    else nginx.reload = reload;
  }

  const prometheus = { ...PROMETHEUS_DEFAULTS };
  const promHost = input.prometheus?.host;
  if (promHost !== undefined && promHost !== "") {
    if (typeof promHost === "string" && (net.isIP(promHost.trim()) || HOSTNAME_RE.test(promHost.trim()))) prometheus.host = promHost.trim();
    else errors["prometheus.host"] = "Host Prometheus harus hostname atau alamat IP yang valid.";
  }
  const promPort = input.prometheus?.port;
  if (promPort !== undefined && promPort !== "") {
    const n = Number(promPort);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) prometheus.port = n;
    else errors["prometheus.port"] = "Port Prometheus harus 1–65535.";
  }

  if (Object.keys(errors).length) throw new ValidationError(errors);
  const profile = { id: input.id, name, host, port, username, auth: input.auth, nginx, prometheus };
  if (input.tunnels !== undefined) profile.tunnels = validateTunnels(input.tunnels);
  if (keyPath) profile.keyPath = keyPath;
  return profile;
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(tmp, "w", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}

function readStrict(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return fallback; throw new Error("Data lokal tidak dapat dibaca. Backup/restore dibatalkan agar data tidak tertimpa.", { cause: e }); }
}

function readJson(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Simpan salinan berkas rusak agar data tidak hilang diam-diam saat ditimpa.
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    return fallback;
  }
}

/** crypto: {encrypt(str) -> Buffer, decrypt(Buffer) -> str} atau null bila enkripsi OS tidak tersedia. */
function createStore(dir, cryptoImpl) {
  fs.mkdirSync(dir, { recursive: true });
  const serversFile = path.join(dir, "servers.json");
  const secretsFile = path.join(dir, "secrets.json");
  const journalFile = path.join(dir, "restore-journal.json");
  const cloudflareFile = path.join(dir, 'cloudflare.json');
  const rollback = (previous) => {
    const files = [[serversFile, previous.servers], [secretsFile, previous.secrets]];
    if (Object.hasOwn(previous, 'cloudflare')) files.push([cloudflareFile, previous.cloudflare]);
    for (const [file, data] of files) {
      if (data === null) fs.rmSync(file, { force: true });
      else writeJsonAtomic(file, data);
    }
    fs.unlinkSync(journalFile);
  };
  // Restore terputus: pulihkan kedua berkas sebelum aplikasi membaca data.
  if (fs.existsSync(journalFile)) rollback(readStrict(journalFile));
  const servers = () => readJson(serversFile, []);
  const secrets = () => readJson(secretsFile, {});
  const accounts = () => {
    const entries = readStrict(cloudflareFile, []);
    if (!Array.isArray(entries) || entries.some(a => !a || typeof a.id !== 'string' || typeof a.memo !== 'string' || typeof a.encryptedToken !== 'string')) throw new Error('Data Cloudflare lokal tidak valid.');
    return entries;
  };
  const sealAccount = input => {
    const account = validateAccount(input);
    if (!cryptoImpl) throw new Error('Enkripsi OS tidak tersedia; API Token tidak disimpan.');
    return { id: account.id || crypto.randomUUID(), memo: account.memo, encryptedToken: cryptoImpl.encrypt(account.token).toString('base64') };
  };
  const openAccount = account => {
    if (!account || !cryptoImpl) throw new Error('Kredensial Cloudflare tidak tersedia.');
    try { return cryptoImpl.decrypt(Buffer.from(account.encryptedToken, 'base64')); }
    catch { throw new Error('Kredensial Cloudflare tidak dapat dibuka. Buka kunci penyimpanan sistem operasi.'); }
  };

  return {
    listCloudflare: () => accounts().map(({ id, memo }) => ({ id, memo })),
    getCloudflareToken: id => openAccount(accounts().find(a => a.id === id)),
    saveCloudflare(input) {
      const all = accounts();
      const index = all.findIndex(a => a.id === input.id);
      if (input.id && index < 0) throw new Error('Akun Cloudflare tidak ditemukan.');
      const entry = sealAccount({ ...input, token: input.token || (index >= 0 ? openAccount(all[index]) : '') });
      if (index < 0) all.push(entry); else all[index] = entry;
      writeJsonAtomic(cloudflareFile, all);
      return { id: entry.id, memo: entry.memo };
    },
    removeCloudflare(id) { writeJsonAtomic(cloudflareFile, accounts().filter(a => a.id !== id)); },
    exportCloudflare: () => accounts().map(a => ({ id: a.id, memo: a.memo, token: openAccount(a) })),
    list: () => servers(),
    listForBackup: () => {
      const profiles = readStrict(serversFile, []);
      if (!Array.isArray(profiles)) throw new Error("Format profil lokal tidak valid.");
      return profiles;
    },
    get: (id) => servers().find((s) => s.id === id) || null,
    save(input) {
      const all = servers();
      const previous = all.find(s => s.id === input.id);
      const profile = validateServer({ ...input, ...(input.tunnels === undefined && previous?.tunnels !== undefined ? {tunnels:previous.tunnels} : {}) });
      if (profile.id) {
        const i = all.findIndex((s) => s.id === profile.id);
        if (i < 0) throw new Error("Server tidak ditemukan.");
        all[i] = profile;
      } else {
        profile.id = crypto.randomUUID();
        all.push(profile);
      }
      writeJsonAtomic(serversFile, all);
      return profile;
    },
    remove(id) {
      writeJsonAtomic(serversFile, servers().filter((s) => s.id !== id));
      this.clearSecrets(id);
    },
    setSecret(id, kind, value) {
      if (!SECRET_KINDS.includes(kind)) throw new Error("Jenis secret tidak dikenal.");
      if (!cryptoImpl) throw new Error("Enkripsi OS tidak tersedia; secret tidak disimpan.");
      const all = secrets();
      all[id] = { ...all[id], [kind]: cryptoImpl.encrypt(value).toString("base64") };
      writeJsonAtomic(secretsFile, all);
    },
    getSecret(id, kind) {
      const enc = secrets()[id]?.[kind];
      if (!enc || !cryptoImpl) return null;
      try {
        return cryptoImpl.decrypt(Buffer.from(enc, "base64"));
      } catch {
        return null;
      }
    },
    clearSecrets(id, kind) {
      const all = secrets();
      if (!all[id]) return;
      if (kind) delete all[id][kind];
      else delete all[id];
      writeJsonAtomic(secretsFile, all);
    },
    exportData() {
      const profiles = readStrict(serversFile, []);
      const encrypted = readStrict(secretsFile, {});
      if (!Array.isArray(profiles) || !encrypted || typeof encrypted !== "object" || Array.isArray(encrypted)) throw new Error("Format data lokal tidak valid.");
      return profiles.map((profile) => {
        const credentials = {};
        for (const kind of SECRET_KINDS) {
          const value = encrypted[profile.id]?.[kind];
          if (value === undefined) continue;
          if (!cryptoImpl) throw new Error("Enkripsi sistem operasi tidak tersedia. Kredensial tidak dapat diekspor.");
          try { credentials[kind] = cryptoImpl.decrypt(Buffer.from(value, "base64")); }
          catch { throw new Error("Kredensial tersimpan tidak dapat dibuka. Buka kunci penyimpanan sistem operasi, lalu coba lagi."); }
        }
        return { profile, credentials };
      });
    },
    importData(entries, cloudflare = []) {
      const all = readStrict(serversFile, []);
      const encrypted = readStrict(secretsFile, {});
      if (!Array.isArray(all) || !encrypted || typeof encrypted !== "object" || Array.isArray(encrypted)) throw new Error("Format data lokal tidak valid.");
      const next = [...all];
      const nextSecrets = { ...encrypted };
      const oldAccounts = accounts();
      const nextAccounts = [...oldAccounts];
      for (const account of cloudflare) {
        const sealed = sealAccount(account);
        const index = nextAccounts.findIndex(a => a.id === sealed.id);
        if (index < 0) nextAccounts.push(sealed); else nextAccounts[index] = sealed;
      }
      for (const { profile, credentials } of entries) {
        const validated = validateServer(profile);
        if (typeof validated.id !== "string" || !/^[0-9a-f-]{36}$/i.test(validated.id)) throw new Error("ID server backup tidak valid.");
        const index = next.findIndex((p) => p.id === validated.id);
        if (index >= 0 && validated.tunnels === undefined && next[index].tunnels !== undefined) validated.tunnels = next[index].tunnels;
        if (index < 0) next.push(validated);
        else next[index] = validated;
        for (const kind of SECRET_KINDS) {
          if (credentials[kind] === undefined) continue;
          if (!cryptoImpl) throw new Error("Enkripsi sistem operasi tidak tersedia. Restore kredensial dibatalkan.");
          nextSecrets[validated.id] = { ...nextSecrets[validated.id], [kind]: cryptoImpl.encrypt(credentials[kind]).toString("base64") };
        }
      }
      const previous = { servers: fs.existsSync(serversFile) ? all : null, secrets: fs.existsSync(secretsFile) ? encrypted : null, cloudflare: fs.existsSync(cloudflareFile) ? oldAccounts : null };
      writeJsonAtomic(journalFile, previous);
      try {
        writeJsonAtomic(secretsFile, nextSecrets);
        writeJsonAtomic(serversFile, next);
        if (cloudflare.length) writeJsonAtomic(cloudflareFile, nextAccounts);
        fs.unlinkSync(journalFile);
      } catch (e) {
        rollback(previous);
        throw e;
      }
    },
  };
}

module.exports = { createStore, validateServer, ValidationError, NGINX_DEFAULTS, PROMETHEUS_DEFAULTS, RELOAD_METHODS };
