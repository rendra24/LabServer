const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createStore } = require("../src/main/store");
const { registerBackupIpc } = require("../src/main/backup-ipc");

const password = "password-backup-uji-123";
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labserver-backup-ipc-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir, { encrypt: (s) => Buffer.from(s).reverse(), decrypt: (b) => Buffer.from(b).reverse().toString() });
  const profile = store.save({ name: "VPS", host: "10.0.0.1", username: "deploy", auth: "password" });
  store.setSecret(profile.id, "password", "stored-secret");
  const handlers = {};
  const sender = new EventEmitter();
  const file = path.join(dir, "data.lsb");
  const state = { connected: false, cancel: false, dialogs: 0, openFile: file };
  registerBackupIpc({
    handle: (channel, fn) => { handlers[channel] = fn; },
    store, dir, winOf: () => null, isConnected: () => state.connected,
    dialog: {
      showSaveDialog: async (_win, options) => { state.dialogs++; state.saveOptions = options; return { canceled: state.cancel, filePath: file }; },
      showOpenDialog: async (_win, options) => { state.dialogs++; state.openOptions = options; return { canceled: state.cancel, filePaths: [state.openFile] }; },
    },
  });
  t.after(() => sender.emit("destroyed"));
  return { store, profile, state, file, sender, call: (channel, ...args) => handlers[`backup:${channel}`]({ sender }, ...args), handlers };
}

test("IPC export -> preview -> restore; renderer menerima ringkasan tanpa secret", async (t) => {
  const { call, store, profile, state, handlers, file } = setup(t);
  assert.equal((await call("export", password, password)).ok, true);
  assert.match(state.saveOptions.defaultPath, /^LabServer-\d{8}\.lsb$/);
  assert.deepEqual(state.saveOptions.filters[0].extensions, ["lsb"]);
  const legacy = file.replace(/\.lsb$/, ".labserver");
  fs.renameSync(file, legacy);
  state.openFile = legacy;
  store.setSecret(profile.id, "password", "changed-local");
  const preview = await call("inspect", password);
  assert.deepEqual(state.openOptions.filters[0].extensions, ["lsb", "labserver"]);
  assert.equal(preview.ok, true, "backup ekstensi lama tetap dapat dipulihkan");
  assert.equal(preview.summary.servers, 1);
  assert.ok(!JSON.stringify(preview).includes("stored-secret"));
  assert.ok(!JSON.stringify(preview).includes("10.0.0.1"));
  assert.equal((await handlers["backup:restore"]({ sender: new EventEmitter() }, preview.token, "update")).ok, false);
  state.connected = true;
  assert.match((await call("restore", preview.token, "update")).message, /Putuskan/);
  assert.equal(store.getSecret(profile.id, "password"), "changed-local");
  state.connected = false;
  const result = await call("restore", preview.token, "update");
  assert.equal(result.updated, 1);
  assert.equal(store.getSecret(profile.id, "password"), "stored-secret");
  assert.equal((await call("restore", preview.token, "update")).ok, false, "token hanya sekali dipakai");
});

test("cancel, konfirmasi salah, password salah, discard, dan renderer ditutup tidak mengubah data", async (t) => {
  const { call, state, store, profile, sender } = setup(t);
  assert.equal((await call("export", password, "different")).ok, false);
  assert.equal(state.dialogs, 0);
  state.cancel = true;
  assert.equal((await call("export", password, password)).cancelled, true);
  assert.equal((await call("inspect", password)).cancelled, true);
  state.cancel = false;
  await call("export", password, password);
  assert.equal((await call("inspect", "wrong-password-value")).ok, false);
  const preview = await call("inspect", password);
  await call("discard", preview.token);
  assert.equal((await call("restore", preview.token, "update")).ok, false);
  const second = await call("inspect", password);
  sender.emit("destroyed");
  assert.equal((await call("restore", second.token, "update")).ok, false);
  assert.equal(store.getSecret(profile.id, "password"), "stored-secret");
});
