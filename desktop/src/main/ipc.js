const { ipcMain } = require("electron");

function registerIpc() {
  ipcMain.handle("app:version", () => require("../../package.json").version);
}

module.exports = { registerIpc };
