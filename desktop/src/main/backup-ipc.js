const crypto = require("node:crypto");
const path = require("node:path");
const { BackupError, MAX_FILE, checkPassword, readBounded, encryptBackup, decryptBackup, collectBackup, summarizeBackup, restoreBackup, writeBackup } = require("./backup");

function registerBackupIpc({ handle, dialog, winOf, store, dir, isConnected }) {
  const pending = new WeakMap();
  let working = false;
  function discard(sender, token) {
    const entry = pending.get(sender);
    if (!entry || (token && entry.token !== token)) return;
    clearTimeout(entry.timer);
    sender.removeListener('destroyed', entry.destroyed);
    pending.delete(sender);
  }
  const operation = (fn) => async (...args) => {
    if (working) return { ok: false, message: "Backup/restore sedang diproses. Tunggu hingga selesai." };
    working = true;
    try { return await fn(...args); }
    catch (e) { return { ok: false, message: e instanceof BackupError ? e.message : "Backup/restore gagal. Data lokal tidak diubah; periksa izin berkas dan ruang penyimpanan." }; }
    finally { working = false; }
  };

  handle("backup:export", operation(async (event, password, confirmation) => {
    checkPassword(password);
    if (confirmation !== password) throw new BackupError("Konfirmasi password backup tidak sama.");
    const selection = await dialog.showSaveDialog(winOf(event), {
      title: "Simpan backup terenkripsi LabServer",
      defaultPath: `LabServer-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.lsb`,
      filters: [{ name: "Backup LabServer", extensions: ["lsb"] }],
    });
    if (selection.canceled || !selection.filePath) return { ok: false, cancelled: true };
    const data = collectBackup(store);
    const encrypted = await encryptBackup(data, password);
    writeBackup(selection.filePath, encrypted);
    return { ok: true, filename: path.basename(selection.filePath), servers: data.servers.length, cloudflare: data.cloudflare?.length || 0 };
  }));

  handle("backup:inspect", operation(async (event, password) => {
    discard(event.sender);
    checkPassword(password);
    const selection = await dialog.showOpenDialog(winOf(event), {
      title: "Pilih backup LabServer",
      properties: ["openFile"],
      filters: [{ name: "Backup LabServer", extensions: ["lsb", "labserver"] }],
    });
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, cancelled: true };
    const data = await decryptBackup(readBounded(selection.filePaths[0], MAX_FILE), password);
    if (event.sender.isDestroyed?.()) return { ok: false, cancelled: true };
    const summary = summarizeBackup(data, store);
    const token = crypto.randomUUID();
    const timer = setTimeout(() => discard(event.sender, token), 10 * 60 * 1000);
    timer.unref?.();
    const destroyed = () => discard(event.sender, token);
    pending.set(event.sender, { token, data, timer, destroyed });
    event.sender.once('destroyed', destroyed);
    return { ok: true, token, summary };
  }));

  handle("backup:restore", operation((event, token, mode) => {
    const entry = pending.get(event.sender);
    if (!entry || entry.token !== token) throw new BackupError("Pratinjau backup telah berakhir. Pilih file backup kembali.");
    if (store.listForBackup().some((p) => isConnected(p.id))) throw new BackupError("Putuskan koneksi VPS sebelum melakukan restore.");
    const result = restoreBackup(entry.data, store, dir, mode);
    discard(event.sender, token);
    return { ok: true, ...result };
  }));
  handle("backup:discard", (event, token) => { discard(event.sender, token); return { ok: true }; });
}

module.exports = { registerBackupIpc };
