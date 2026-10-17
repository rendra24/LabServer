const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, shell } = require("electron");
const { webPreferences, isAllowedNavigation, RENDERER_DIR } = require("./security");
const { registerIpc } = require("./ipc");
const { applyBranding } = require("./branding");

// Pertahankan namespace data dan Keychain dari versi sebelum rebrand.
app.setName("Dashboard Server");
const dataDir = path.join(app.getPath("appData"), "Dashboard Server");
fs.mkdirSync(dataDir, { recursive: true });
app.setPath("userData", dataDir);

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#101115",
    title: "LabServer",
    icon: path.join(RENDERER_DIR, "assets", "labserver-logo.png"),
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
  applyBranding();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
