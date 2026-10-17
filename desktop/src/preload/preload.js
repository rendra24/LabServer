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
  },
  pickKey: call("dialog:pickKey"),
});
