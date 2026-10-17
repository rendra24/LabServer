// Satu-satunya jembatan renderer -> main. Hanya fungsi sempit, tanpa akses ipcRenderer mentah.
const { contextBridge, ipcRenderer } = require("electron");

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("api", {
  info: call("app:info"),
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
  sites: (id, op, ...args) => ipcRenderer.invoke("sites:call", id, op, ...args),
  /** handler({requestId, server}) -> Promise<string|null> */
  onSudoAsk(handler) {
    ipcRenderer.removeAllListeners("sudo:ask");
    ipcRenderer.on("sudo:ask", async (_e, req) => {
      const value = await handler({ server: req.server });
      ipcRenderer.invoke("sudo:answer", req.requestId, value ?? "");
    });
  },
  pickKey: call("dialog:pickKey"),
});
