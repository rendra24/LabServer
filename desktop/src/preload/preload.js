// Satu-satunya jembatan renderer -> main. Hanya fungsi sempit, tanpa akses ipcRenderer mentah.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  version: () => ipcRenderer.invoke("app:version"),
});
