const { SshError, MESSAGES } = require("./ssh");
const { ValidationError } = require("./store");

/** Logika aplikasi di main process, terpisah dari Electron agar bisa dites. */
function createServerService({ store, hostKeys, connect, confirmHostKey }) {
  const publicView = (p) => ({
    ...p,
    hasSavedPassword: Boolean(store.getSecret(p.id, "password")),
    hasSavedPassphrase: Boolean(store.getSecret(p.id, "passphrase")),
  });

  async function open(id, creds = {}) {
    const profile = store.get(id);
    if (!profile) throw Object.assign(new Error("Server tidak ditemukan."), { code: "NOT_FOUND" });
    const password = creds.password || (profile.auth === "password" ? store.getSecret(id, "password") : null);
    const passphrase = creds.passphrase || (profile.auth === "key" ? store.getSecret(id, "passphrase") : null);
    const conn = await connect(profile, {
      password,
      passphrase,
      hostKeys,
      onUnknownHost: (info) => confirmHostKey({ ...info, name: profile.name }),
    });
    if (creds.remember) {
      if (creds.password) store.setSecret(id, "password", creds.password);
      if (creds.passphrase) store.setSecret(id, "passphrase", creds.passphrase);
    }
    return conn;
  }

  return {
    list: () => store.list().map(publicView),
    save(input) {
      try {
        return { ok: true, profile: publicView(store.save(input)) };
      } catch (e) {
        if (e instanceof ValidationError) return { ok: false, errors: e.errors };
        return { ok: false, errors: { _: e.message } };
      }
    },
    remove(id) {
      store.remove(id);
      return { ok: true };
    },
    forgetHostKey(id) {
      const p = store.get(id);
      if (p) hostKeys.forget(p.host, p.port);
      return { ok: Boolean(p) };
    },
    open,
    async testConnection(id, creds) {
      try {
        const conn = await open(id, creds);
        conn.end();
        return { ok: true };
      } catch (e) {
        return failure(e);
      }
    },
  };
}

function failure(e) {
  if (e instanceof SshError) return { ok: false, code: e.code, message: e.message };
  if (e.code === "NOT_FOUND") return { ok: false, code: "NOT_FOUND", message: e.message };
  return { ok: false, code: "UNKNOWN", message: MESSAGES.UNKNOWN };
}

module.exports = { createServerService, failure };
