// Satu-satunya jembatan renderer -> main. Hanya fungsi sempit, tanpa akses ipcRenderer mentah.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("api", {
  info: call("app:info"),
  checkUpdate: call('update:check'),
  history: {get:call('history:get')},
  docker: { call: call('docker:call'), cancel: call('docker:cancel') },
  ssl: { call: call('ssl:call'), cancel: call('ssl:cancel') },
  tunnels: {call:call('tunnels:call')},
  onToolEvent(handler) { const listener = (_event, packet) => handler(packet); ipcRenderer.on('tools:event', listener); return () => ipcRenderer.removeListener('tools:event', listener); },
  system: { call: call('system:call'), cancel: call('system:cancel') },
  dns: Object.fromEntries(['accounts', 'save', 'removeAccount', 'zones', 'records', 'create', 'update', 'remove'].map(name => [name, call(`dns:${name}`)])),
  files: {
    call: call('files:call'), local: call('files:local'), pick: call('files:pick'),
    drop: (files) => ipcRenderer.invoke('files:drop', files.map(file => webUtils.getPathForFile(file))),
    onEvent(handler) { const listener = (_event, packet) => handler(packet); ipcRenderer.on('files:event', listener); return () => ipcRenderer.removeListener('files:event', listener); },
  },
  onCloseRequest(handler) {
    ipcRenderer.on('app:close-request', async (_event, requestId) => {
      let allowed = false;
      try { allowed = await handler(); } catch { /* Guard errors keep the window open. */ }
      ipcRenderer.invoke('app:close-answer', requestId, allowed === true);
    });
  },
  backup: {
    export: call("backup:export"),
    inspect: call("backup:inspect"),
    restore: call("backup:restore"),
    discard: call("backup:discard"),
  },
  servers: {
    list: call("servers:list"),
    save: call("servers:save"),
    remove: call("servers:remove"),
    test: call("servers:test"),
    forgetHostKey: call("servers:forgetHostKey"),
    connect: call("servers:connect"),
    disconnect: call("servers:disconnect"),
  },
  monitor: (id, op, range) => ipcRenderer.invoke("monitor:call", id, op, range),
  terminal: {
    open: (id, size) => ipcRenderer.invoke("terminal:call", id, "open", size),
    write: (id, sessionId, data) => ipcRenderer.invoke("terminal:call", id, "write", sessionId, data),
    resize: (id, sessionId, size) => ipcRenderer.invoke("terminal:call", id, "resize", sessionId, size),
    close: (id, sessionId) => ipcRenderer.invoke("terminal:call", id, "close", sessionId),
    ack: (id, sessionId, bytes) => ipcRenderer.invoke("terminal:call", id, "ack", sessionId, bytes),
    onEvent(handler) {
      const listener = (_event, packet) => handler(packet);
      ipcRenderer.on("terminal:event", listener);
      return () => ipcRenderer.removeListener("terminal:event", listener);
    },
  },
  sites: (id, op, ...args) => ipcRenderer.invoke("sites:call", id, op, ...args),
  /** handler({requestId, server}) -> Promise<string|null> */
  onSudoAsk(handler) {
    ipcRenderer.removeAllListeners("sudo:ask");
    ipcRenderer.on("sudo:ask", async (_e, req) => {
      const value = await handler({ requestId: req.requestId, server: req.server });
      ipcRenderer.invoke("sudo:answer", req.requestId, value ?? "");
    });
  },
  onSudoCancel(handler) { ipcRenderer.on('sudo:cancel', (_event, requestId) => handler(requestId)); },
  pickKey: call("dialog:pickKey"),
});
