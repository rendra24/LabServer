const crypto = require("node:crypto");
const fs = require("node:fs");
const { Client, utils } = require("ssh2");
const { decideHostKey } = require("./hostkeys");

const MESSAGES = {
  NEED_PASSWORD: "Password SSH diperlukan.",
  NEED_PASSPHRASE: "Private key terenkripsi; masukkan passphrase.",
  BAD_PASSPHRASE: "Passphrase salah untuk private key ini.",
  KEY_UNREADABLE: "Berkas private key tidak bisa dibaca atau bukan private key yang didukung.",
  AUTH_FAILED: "Autentikasi ditolak server (username, password, atau key salah).",
  HOST_NOT_FOUND: "Host tidak ditemukan (periksa nama host/DNS).",
  CONN_REFUSED: "Koneksi ditolak: tidak ada layanan SSH di host/port tersebut.",
  UNREACHABLE: "Host tidak dapat dijangkau dari jaringan ini.",
  TIMEOUT: "Waktu koneksi habis. Periksa host, port, dan firewall.",
  HOSTKEY_REJECTED: "Koneksi dibatalkan: fingerprint server tidak disetujui.",
  HOSTKEY_CHANGED:
    "PERINGATAN: fingerprint server BERUBAH sejak koneksi terakhir. Bisa jadi server diinstal ulang, " +
    "atau ada pihak yang menyadap koneksi. Koneksi diblokir.",
  UNKNOWN: "Koneksi SSH gagal.",
};

class SshError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || MESSAGES.UNKNOWN);
    this.code = code;
    this.detail = detail; // untuk log, bukan untuk ditampilkan mentah
  }
}

function fingerprintOf(rawKey) {
  return `SHA256:${crypto.createHash("sha256").update(rawKey).digest("base64").replace(/=+$/, "")}`;
}

function loadPrivateKey(keyPath, passphrase) {
  let data;
  try {
    data = fs.readFileSync(keyPath);
  } catch (e) {
    throw new SshError("KEY_UNREADABLE", e.code);
  }
  const parsed = utils.parseKey(data, passphrase || undefined);
  if (parsed instanceof Error) {
    const msg = parsed.message;
    if (/no passphrase/i.test(msg)) throw new SshError("NEED_PASSPHRASE");
    if (/decrypt|bad passphrase|integrity|padding/i.test(msg) && passphrase) throw new SshError("BAD_PASSPHRASE");
    throw new SshError("KEY_UNREADABLE", msg);
  }
  return data;
}

function mapError(err, state) {
  if (state.hostKey) return new SshError(state.hostKey);
  if (err instanceof SshError) return err;
  if (err.level === "client-authentication") return new SshError("AUTH_FAILED");
  if (err.level === "client-timeout") return new SshError("TIMEOUT");
  switch (err.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return new SshError("HOST_NOT_FOUND");
    case "ECONNREFUSED":
      return new SshError("CONN_REFUSED");
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return new SshError("UNREACHABLE");
    case "ETIMEDOUT":
      return new SshError("TIMEOUT");
    default:
      return new SshError("UNKNOWN", err.message);
  }
}

/**
 * Hubungkan ke server. opts: { password, passphrase, hostKeys, onUnknownHost({host, port, fingerprint}) -> Promise<bool>, timeoutMs }
 * Resolve ke { exec(cmd, {stdin}) -> stdout, client, end() }.
 */
function connect(profile, opts = {}) {
  const config = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    readyTimeout: opts.timeoutMs || 15000,
    keepaliveInterval: 15000,
  };
  try {
    if (profile.auth === "password") {
      if (!opts.password) throw new SshError("NEED_PASSWORD");
      config.password = opts.password;
      config.tryKeyboard = true;
    } else {
      config.privateKey = loadPrivateKey(profile.keyPath, opts.passphrase);
      if (opts.passphrase) config.passphrase = opts.passphrase;
    }
  } catch (e) {
    return Promise.reject(e);
  }

  const state = { hostKey: null };
  // Diverifikasi SEBELUM autentikasi: kredensial tidak dikirim ke server yang tidak dipercaya.
  config.hostVerifier = (key, verify) => {
    const fingerprint = fingerprintOf(key);
    const decision = decideHostKey(opts.hostKeys.get(profile.host, profile.port), fingerprint);
    if (decision === "trusted") return verify(true);
    if (decision === "changed") {
      state.hostKey = "HOSTKEY_CHANGED";
      return verify(false);
    }
    Promise.resolve(opts.onUnknownHost({ host: profile.host, port: profile.port, fingerprint }))
      .then((ok) => {
        if (ok) opts.hostKeys.set(profile.host, profile.port, fingerprint);
        else state.hostKey = "HOSTKEY_REJECTED";
        verify(Boolean(ok));
      })
      .catch(() => {
        state.hostKey = "HOSTKEY_REJECTED";
        verify(false);
      });
  };

  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    client
      .on("keyboard-interactive", (_n, _i, _l, prompts, finish) => finish(prompts.map(() => opts.password)))
      .on("ready", () => {
        settled = true;
        resolve(wrap(client));
      })
      .on("error", (err) => {
        if (settled) return;
        settled = true;
        client.end();
        reject(mapError(err, state));
      })
      .on("close", () => {
        if (!settled) {
          settled = true;
          reject(mapError(new Error("closed"), state));
        }
      })
      .connect(config);
  });
}

function wrap(client) {
  let sftpPromise = null;
  return {
    client,
    end: () => client.end(),
    sftp() {
      sftpPromise ??= new Promise((resolve, reject) =>
        client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp))));
      return sftpPromise;
    },
    /** Seperti exec, tetapi selalu resolve {code, stdout, stderr} (exit non-zero bukan error). */
    execFull(command, { stdin, timeoutMs = 20000 } = {}) {
      return new Promise((resolve, reject) => {
        client.exec(command, (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          const timer = setTimeout(() => {
            stream.close();
            reject(Object.assign(new Error("Perintah melewati batas waktu."), { code: "TIMEOUT" }));
          }, timeoutMs);
          stream.on("data", (d) => (stdout += d)).stderr.on("data", (d) => (stderr += d));
          stream.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
          });
          stream.end(stdin ?? undefined);
        });
      });
    },
    /** Jalankan perintah; resolve stdout bila exit 0, reject {code, stdout, stderr} bila tidak. */
    exec(command, { stdin, timeoutMs = 20000 } = {}) {
      return new Promise((resolve, reject) => {
        client.exec(command, (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          const timer = setTimeout(() => {
            stream.close();
            reject(Object.assign(new Error("Perintah melewati batas waktu."), { code: "TIMEOUT", stdout, stderr }));
          }, timeoutMs);
          stream.on("data", (d) => (stdout += d)).stderr.on("data", (d) => (stderr += d));
          stream.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve(stdout);
            else reject(Object.assign(new Error(`exit ${code}`), { exitCode: code, stdout, stderr }));
          });
          if (stdin !== undefined) stream.end(stdin);
        });
      });
    },
  };
}

module.exports = { connect, SshError, fingerprintOf, MESSAGES };
