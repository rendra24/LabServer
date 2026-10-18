// Logika clone di renderer + parser server_name.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "src", "renderer", "clone.js")).href);

test("replaceDomain berbatas kata", async () => {
  const { replaceDomain } = await load();
  const r = replaceDomain("server_name app.local www.app.local myapp.local;\nroot /var/www/app.local;", "app.local", "baru.test");
  assert.equal(r.text, "server_name baru.test www.baru.test myapp.local;\nroot /var/www/baru.test;");
  assert.equal(r.count, 3);
});

test("parseServerName melewati komentar", async () => {
  const { parseServerName } = await load();
  assert.equal(parseServerName("# server_name x.com;\nserver {\n  server_name  a.local b.local;\n}"), "a.local");
  assert.equal(parseServerName("server {}"), "");
});
