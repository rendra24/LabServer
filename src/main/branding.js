const path = require("node:path");
const { app, Menu } = require("electron");
const { productName, version, build } = require("../../package.json");
const { RENDERER_DIR } = require("./security");

function applyBranding() {
  const iconPath = path.join(RENDERER_DIR, "assets", "labserver-logo.png");
  app.setAboutPanelOptions({ applicationName: productName, applicationVersion: version, iconPath });
  if (process.platform === "win32") app.setAppUserModelId(build.appId);
  if (process.platform !== "darwin") return;

  app.dock.setIcon(iconPath);
  // Nama internal tetap dipakai Keychain; nama menu mengikuti identitas produk.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: productName, submenu: [
      { role: "about", label: `Tentang ${productName}` },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide", label: `Sembunyikan ${productName}` },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit", label: `Keluar dari ${productName}` },
    ] },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
}

module.exports = { applyBranding };
