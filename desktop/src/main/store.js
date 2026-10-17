const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

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
  if (keyPath) profile.keyPath = keyPath;
  return profile;
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
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
  const servers = () => readJson(serversFile, []);
  const secrets = () => readJson(secretsFile, {});

  return {
    list: () => servers(),
    get: (id) => servers().find((s) => s.id === id) || null,
    save(input) {
      const all = servers();
      const profile = validateServer(input);
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
  };
}

module.exports = { createStore, validateServer, ValidationError, NGINX_DEFAULTS, PROMETHEUS_DEFAULTS, RELOAD_METHODS };
