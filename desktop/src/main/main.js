const path = require("node:path");
const { app, BrowserWindow, shell } = require("electron");
const { webPreferences, isAllowedNavigation, RENDERER_DIR } = require("./security");
const { registerIpc } = require("./ipc");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#020617",
    title: "Dashboard Server",
    webPreferences: webPreferences(path.join(__dirname, "..", "preload", "preload.js")),
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isAllowedNavigation(url)) e.preventDefault();
  });
  // Tautan eksternal (jika ada) dibuka di browser sistem, tidak di dalam aplikasi.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadFile(path.join(RENDERER_DIR, "index.html"));
  return win;
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
