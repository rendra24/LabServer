const { NginxError } = require("./nginx");
const { failure } = require("./services");

const MAX_CONTENT = 1_048_576;
const isName = (v) => typeof v === "string" && v.length <= 255;
const isContent = (v) => typeof v === "string" && v.length <= MAX_CONTENT && !v.includes("\0");

// Operasi yang boleh dipanggil renderer, beserta validator argumennya.
const OPS = {
  list: [],
  read: [isName],
  write: [isName, isContent],
  create: [isName, isContent],
  enable: [isName],
  disable: [isName],
  test: [],
  reload: [],
};

const notConnected = { ok: false, code: "NOT_CONNECTED", message: "Koneksi ke server terputus. Hubungkan ulang." };
const isConnectionLoss = (e) => /not connected|no response from server|ECONNRESET|channel open failure|socket/i.test(e?.message || "");

/** Satu sesi SSH (koneksi + operasi Nginx) per server, hidup di main process. */
function createSessionManager({ open, getProfile, makeOps, askSudoPassword }) {
  const sessions = new Map();

  function close(id) {
    const s = sessions.get(id);
    sessions.delete(id);
    s?.conn.end();
  }

  return {
    isConnected: (id) => sessions.has(id),
    close,
    closeAll: () => [...sessions.keys()].forEach(close),

    async connect(id, creds) {
      const profile = getProfile(id);
      if (!profile) return { ok: false, code: "NOT_FOUND", message: "Server tidak ditemukan." };
      close(id);
      try {
        const conn = await open(id, creds);
        const ops = makeOps(conn, profile, { askSudoPassword: () => askSudoPassword(id) });
        sessions.set(id, { conn, ops });
        conn.client.on("close", () => {
          if (sessions.get(id)?.conn === conn) sessions.delete(id);
        });
        return { ok: true };
      } catch (e) {
        return failure(e);
      }
    },

    async call(id, op, ...args) {
      const validators = Object.hasOwn(OPS, op) ? OPS[op] : null;
      if (!validators || args.length < validators.length || !validators.every((check, i) => check(args[i]))) {
        return { ok: false, code: "INVALID_REQUEST", message: "Permintaan tidak valid." };
      }
      const s = sessions.get(id);
      if (!s) return notConnected;
      try {
        return { ok: true, data: await s.ops[op](...args.slice(0, validators.length)) };
      } catch (e) {
        if (e instanceof NginxError) return { ok: false, code: e.code, message: e.message };
        if (isConnectionLoss(e)) {
          close(id);
          return notConnected;
        }
        return failure(e);
      }
    },
  };
}

module.exports = { createSessionManager, OPS };
