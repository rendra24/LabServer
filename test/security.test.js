const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webPreferences, isAllowedNavigation } = require("../src/main/security");

test("renderer terisolasi dari Node", () => {
  const w = webPreferences("/x/preload.js");
  assert.equal(w.contextIsolation, true);
  assert.equal(w.sandbox, true);
  assert.equal(w.nodeIntegration, false);
  assert.equal(w.webviewTag, false);
  assert.equal(w.preload, "/x/preload.js");
});

test("navigasi hanya ke berkas renderer lokal", () => {
  const index = path.join(__dirname, "..", "src", "renderer", "index.html");
  assert.equal(isAllowedNavigation(`file://${index}`), true);
  assert.equal(isAllowedNavigation("https://evil.example"), false);
  assert.equal(isAllowedNavigation("file:///etc/passwd"), false);
  assert.equal(isAllowedNavigation("javascript:alert(1)"), false);
});

test("index.html memasang CSP ketat tanpa sumber remote", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "index.html"), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.equal(csp.split(";").map((rule) => rule.trim()).find((rule) => rule.startsWith("script-src ")), "script-src 'self'");
  assert.doesNotMatch(csp, /unsafe-eval|https?:|\*/);
});
