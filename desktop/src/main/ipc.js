const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require("electron");
const { createStore } = require("./store");
const { createHostKeyStore } = require("./hostkeys");
const { connect } = require("./ssh");
const { createServerService } = require("./services");
const { createSessionManager } = require("./sessions");
const { createNginxOps } = require("./nginx");
const crypto = require("node:crypto");
const { isAllowedNavigation } = require("./security");

const str = (v) => (typeof v === "string" ? v : undefined);

function registerIpc() {
  const dir = app.getPath("userData");
  const cryptoImpl = safeStorage.isEncryptionAvailable()
    ? { encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) }
    : null;
  const winOf = (event) => BrowserWindow.fromWebContents(event.sender);

  let currentEvent = null;
  const svc = createServerService({
    store: createStore(dir, cryptoImpl),
    hostKeys: createHostKeyStore(dir),
    connect,
    // Dialog native di main: renderer tidak bisa memalsukan persetujuan fingerprint.
    confirmHostKey: async ({ name, host, port, fingerprint }) => {
      const { response } = await dialog.showMessageBox(winOf(currentEvent), {
        type: "warning",
        buttons: ["Batal", "Percaya & Lanjutkan"],
        defaultId: 0,
        cancelId: 0,
        title: "Server baru",
        message: `Pertama kali terhubung ke ${name} (${host}:${port}).`,
        detail:
          `Fingerprint host key:\n${fingerprint}\n\n` +
          "Cocokkan dengan fingerprint di server (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub) sebelum melanjutkan.",
      });
      return response === 1;
    },
  });

  // Password sudo diminta lewat dialog di renderer (Electron tidak punya prompt teks native).
  const pendingSudo = new Map();
  const askSudoPassword = (id) =>
    new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        pendingSudo.delete(requestId);
        resolve(null);
      }, 120_000);
      pendingSudo.set(requestId, (value) => {
        clearTimeout(timer);
        pendingSudo.delete(requestId);
        resolve(typeof value === "string" && value ? value : null);
      });
      const server = svc.list().find((x) => x.id === id);
      currentEvent.sender.send("sudo:ask", { requestId, server: server ? `${server.username}@${server.host}` : "" });
    });

  const sessions = createSessionManager({
    open: (id, creds) => svc.open(id, creds),
    getProfile: (id) => svc.list().find((x) => x.id === id) || null,
    makeOps: createNginxOps,
    askSudoPassword,
  });
  app.on("before-quit", () => sessions.closeAll());

  // Semua kanal hanya menerima panggilan dari halaman renderer aplikasi sendiri.
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.senderFrame || !isAllowedNavigation(event.senderFrame.url)) throw new Error("Pengirim tidak sah.");
      currentEvent = event;
      return fn(event, ...args);
    });

  handle("app:info", () => ({ version: require("../../package.json").version, canRemember: Boolean(cryptoImpl) }));
  handle("servers:list", () => svc.list());
  handle("servers:save", (_e, input) => svc.save(input && typeof input === "object" ? input : {}));
  handle("servers:remove", async (event, id) => {
    const p = svc.list().find((s) => s.id === str(id));
    if (!p) return { ok: false };
    const { response } = await dialog.showMessageBox(winOf(event), {
      type: "question",
      buttons: ["Batal", "Hapus"],
      defaultId: 0,
      cancelId: 0,
      message: `Hapus server "${p.name}" dari daftar?`,
      detail: "Hanya profil di aplikasi ini yang dihapus; tidak ada yang berubah di server.",
    });
    return response === 1 ? svc.remove(p.id) : { ok: false, cancelled: true };
  });
  handle("servers:test", (_e, id, creds) =>
    svc.testConnection(str(id), {
      password: str(creds?.password),
      passphrase: str(creds?.passphrase),
      remember: creds?.remember === true,
    }));
  handle("servers:forgetHostKey", async (event, id) => {
    const { response } = await dialog.showMessageBox(winOf(event), {
      type: "warning",
      buttons: ["Batal", "Lupakan fingerprint"],
      defaultId: 0,
      cancelId: 0,
      message: "Lupakan fingerprint lama server ini?",
      detail: "Lakukan hanya jika Anda yakin server memang diinstal ulang atau host key-nya diganti. Koneksi berikutnya akan meminta persetujuan fingerprint baru.",
    });
    return response === 1 ? svc.forgetHostKey(str(id)) : { ok: false, cancelled: true };
  });
  handle("servers:connect", (_e, id, creds) =>
    sessions.connect(str(id), {
      password: str(creds?.password),
      passphrase: str(creds?.passphrase),
      remember: creds?.remember === true,
    }));
  handle("servers:disconnect", (_e, id) => {
    sessions.close(str(id));
    return { ok: true };
  });
  handle("sites:call", (_e, id, op, ...args) => sessions.call(str(id), str(op), ...args));
  handle("sudo:answer", (_e, requestId, value) => {
    pendingSudo.get(str(requestId))?.(str(value));
    return { ok: true };
  });

  handle("dialog:pickKey", async (event) => {
    const r = await dialog.showOpenDialog(winOf(event), {
      title: "Pilih private key SSH",
      defaultPath: path.join(os.homedir(), ".ssh"),
      properties: ["openFile", "showHiddenFiles"],
    });
    return r.canceled ? null : r.filePaths[0];
  });
}

module.exports = { registerIpc };
