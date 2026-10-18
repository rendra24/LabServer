const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { createStore } = require("./store");
const { createHostKeyStore } = require("./hostkeys");
const { connect } = require("./ssh");
const { createServerService } = require("./services");
const { createSessionManager } = require("./sessions");
const { createNginxOps } = require("./nginx");
const { createMonitor } = require("./monitor");
const crypto = require("node:crypto");
const { registerForwardingIpc } = require('./forwarding-ipc');
const { isAllowedNavigation } = require("./security");
const { registerBackupIpc } = require("./backup-ipc");
const { registerFilesIpc } = require('./files-ipc');
const { registerDnsIpc } = require('./dns-ipc');
const { registerSystemIpc } = require('./system-ipc');
const { registerServerToolsIpc } = require('./server-tools-ipc');
const { createReadHistory } = require('./read-history');
const { registerUpdateIpc } = require('./update-ipc');

const str = (v) => (typeof v === "string" ? v : undefined);

function registerIpc() {
  const dir = app.getPath("userData");
  const cryptoImpl = safeStorage.isEncryptionAvailable()
    ? { encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) }
    : null;
  const winOf = (event) => BrowserWindow.fromWebContents(event.sender);

  let currentEvent = null;
  const store = createStore(dir, cryptoImpl);
  const hostKeys = createHostKeyStore(dir);
  const history = createReadHistory(dir,{getProfile:id=>store.get(id),getHostKey:(host,port)=>hostKeys.get(host,port)});
  const svc = createServerService({
    store,
    hostKeys,
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
  const askSudoPassword = (id, event = currentEvent, signal) =>
    new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const sender = event.sender;
      const done = value => {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel); sender.removeListener('destroyed', cancel);
        pendingSudo.delete(requestId);
        resolve(typeof value === "string" && value ? value : null);
      };
      const cancel = () => { done(null); if (!sender.isDestroyed?.()) sender.send('sudo:cancel', requestId); };
      const timer = setTimeout(cancel, 120_000); timer.unref?.();
      if (signal?.aborted) { cancel(); return; }
      signal?.addEventListener('abort', cancel, { once: true }); sender.once('destroyed', cancel);
      pendingSudo.set(requestId, { sender, resolve: done });
      const server = svc.list().find((x) => x.id === id);
      sender.send("sudo:ask", { requestId, server: server ? `${server.username}@${server.host}` : "" });
    });

  const sessions = createSessionManager({
    open: (id, creds) => svc.open(id, creds),
    getProfile: (id) => svc.list().find((x) => x.id === id) || null,
    makeOps: createNginxOps,
    makeMonitor: createMonitor,
    askSudoPassword,
    history,
  });
  const terminalOwners = new WeakSet();

  // Semua kanal hanya menerima panggilan dari halaman renderer aplikasi sendiri.
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.senderFrame || !isAllowedNavigation(event.senderFrame.url)) throw new Error("Pengirim tidak sah.");
      currentEvent = event;
      return fn(event, ...args);
    });

  registerBackupIpc({ handle, dialog, winOf, store, dir, isConnected: sessions.isConnected });
  registerDnsIpc({ handle, dialog, winOf, store });
  registerUpdateIpc({ handle, dialog, winOf, shell });
  registerForwardingIpc({ handle, dialog, winOf, store, sessions });
  registerSystemIpc({ handle, sessions, dialog, winOf, getProfile: id => store.get(id), askSudoPassword: (event, id, signal) => askSudoPassword(id, event, signal) });
  const files = registerFilesIpc({ handle, dialog, winOf, sessions, store });
  registerServerToolsIpc({ handle, sessions, dialog, winOf, files, getProfile: id => store.get(id), askSudoPassword: (event, id, signal) => askSudoPassword(id, event, signal) });
  const pendingCloses = new Map();
  const ready = new WeakSet();
  handle('app:close-answer', (event, requestId, allowed) => {
    const pending = pendingCloses.get(requestId);
    if (pending?.sender === event.sender) pending.resolve(allowed === true);
    return { ok: true };
  });

  handle("app:info", (event) => { ready.add(event.sender); return { version: require("../../package.json").version, canRemember: Boolean(cryptoImpl) }; });
  handle("servers:list", () => svc.list());
  handle('history:get', (_event,id,feature) => typeof id==='string'&&typeof feature==='string'?sessions.snapshot(id,feature):null);
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
    if(response!==1)return{ok:false,cancelled:true};
    const result=svc.remove(p.id);if(result.ok)history.remove(p.id);return result;
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
    if(response!==1)return{ok:false,cancelled:true};
    const result=svc.forgetHostKey(str(id));if(result.ok)history.remove(str(id));return result;
  });
  handle("servers:connect", (event, id, creds) => {
    const sender = event.sender;
    if (!terminalOwners.has(sender)) {
      terminalOwners.add(sender);
      sender.once("destroyed", () => sessions.closeAll());
    }
    return sessions.connect(str(id), {
      password: str(creds?.password),
      passphrase: str(creds?.passphrase),
      remember: creds?.remember === true,
    }, (packet) => {
      if (sender.isDestroyed()) return false;
      sender.send("terminal:event", { serverId: str(id), ...packet });
      return true;
    });
  });
  handle("servers:disconnect", async (event, id) => {
    const connection = sessions.connection(str(id));
    if (files.hasActive(event.sender, id) || files.hasDirty(event.sender, id) || sessions.busyActions(str(id)) || sessions.hasTunnels(str(id))) {
      const r = await dialog.showMessageBox(winOf(event), { type: 'warning', buttons: ['Batal','Putuskan sesi'], defaultId: 0, cancelId: 0, message: 'Putuskan koneksi VPS?', detail: 'Transfer yang belum selesai akan dibatalkan dan perubahan editor yang belum disimpan akan hilang.' + (sessions.hasTunnels(str(id)) ? '\n\nSemua tunnel akan dihentikan dan koneksi aplikasi melalui tunnel akan terputus.' : '') + (sessions.busyActions(str(id)) ? '\n\nTindakan di VPS masih diproses. Menutup SSH tidak menjamin proses remote dibatalkan atau perubahan dikembalikan.' : '') });
      if (r.response !== 1) return { ok: false, cancelled: true };
    }
    if (sessions.connection(str(id)) !== connection) return { ok: false, code: 'NOT_CONNECTED', message: 'Sesi berubah. Periksa koneksi aktif.' };
    files.dispose(str(id));
    sessions.close(str(id));
    return { ok: true };
  });
  handle("sites:call", (_e, id, op, ...args) => sessions.call(str(id), str(op), ...args));
  handle("monitor:call", (_e, id, op, range) => sessions.monitor(str(id), str(op), str(range)));
  handle("terminal:call", (_e, id, op, ...args) => sessions.terminal(str(id), str(op), ...args));
  handle("sudo:answer", (event, requestId, value) => {
    const pending = pendingSudo.get(str(requestId));
    if (pending?.sender === event.sender) pending.resolve(str(value));
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
  return {
    dispose() { files.dispose(); sessions.closeAll(); },
    async canClose(win) {
      const sender = win.webContents;
      if (!ready.has(sender)) return true;
      const requestId = crypto.randomUUID();
      const allowed = await new Promise(resolve => {
        const timer = setTimeout(() => { pendingCloses.delete(requestId); resolve(false); }, 120000);
        pendingCloses.set(requestId, { sender, resolve: value => { clearTimeout(timer); pendingCloses.delete(requestId); resolve(value); } });
        sender.send('app:close-request', requestId);
      });
      if (!allowed) return false;
      if (!files.hasActive(sender) && !sessions.busyActions() && !sessions.hasTunnels()) return true;
      const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Batal','Tutup aplikasi'], defaultId: 0, cancelId: 0, message: 'Masih ada operasi berjalan.', detail: 'Menutup aplikasi membatalkan transfer yang belum selesai. File lengkap yang sudah ditransfer tetap ada.' + (sessions.hasTunnels() ? '\n\nSemua tunnel dan koneksi aplikasi melalui tunnel akan ditutup.' : '') + (sessions.busyActions() ? '\n\nTindakan di VPS dapat terus berjalan setelah aplikasi ditutup; perubahan tidak otomatis dikembalikan.' : '') });
      return r.response === 1;
    },
  };
}

module.exports = { registerIpc };
