const path = require("node:path");
const { pathToFileURL } = require("node:url");

const RENDERER_DIR = path.join(__dirname, "..", "renderer");

function webPreferences(preload) {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webviewTag: false,
    spellcheck: false,
  };
}

// Hanya berkas di folder renderer aplikasi yang boleh dimuat.
function isAllowedNavigation(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol !== "file:") return false;
  const base = pathToFileURL(RENDERER_DIR + path.sep).href;
  return target.href.startsWith(base);
}

module.exports = { webPreferences, isAllowedNavigation, RENDERER_DIR };
