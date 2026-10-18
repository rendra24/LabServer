const test = require("node:test");
const assert = require("node:assert/strict");
const { registerUpdateIpc, isReleaseUrl } = require("../src/main/update-ipc");

const repoPkg = { version: "0.1.0", repository: "github:acme/vps-panel" };
function setup({ result, response = 0, pkg = repoPkg }) {
  const handlers = {};
  const opened = [];
  let dialogs = 0;
  registerUpdateIpc({
    handle: (name, fn) => (handlers[name] = fn),
    dialog: { showMessageBox: async () => (dialogs++, { response }) },
    winOf: () => null,
    shell: { openExternal: async (u) => opened.push(u) },
    pkg,
    check: async () => result,
  });
  return { call: () => handlers["update:check"]({}), opened, dialogs: () => dialogs };
}
const available = { status: "available", current: "0.1.0", latest: "0.2.0", url: "https://github.com/acme/vps-panel/releases/tag/desktop-v0.2.0" };

test("tersedia + pengguna setuju -> buka halaman rilis; renderer tidak menerima URL", async () => {
  const { call, opened } = setup({ result: available, response: 1 });
  const r = await call();
  assert.deepEqual(opened, [available.url]);
  assert.equal(r.status, "available");
  assert.equal(r.url, undefined);
});

test("pengguna pilih 'Nanti' -> tidak membuka apa pun", async () => {
  const { call, opened } = setup({ result: available, response: 0 });
  await call();
  assert.deepEqual(opened, []);
});

test("URL di luar repo tidak pernah dibuka", async () => {
  const { call, opened, dialogs } = setup({ result: { ...available, url: "https://evil.example/x" }, response: 1 });
  await call();
  assert.deepEqual(opened, []);
  assert.equal(dialogs(), 0);
});

test("tanpa pembaruan / error: tanpa dialog", async () => {
  for (const result of [{ status: "up-to-date", current: "0.1.0", latest: "0.1.0" }, { status: "error", message: "x" }, { status: "unconfigured", current: "0.1.0" }]) {
    const { call, dialogs } = setup({ result });
    assert.equal((await call()).status, result.status);
    assert.equal(dialogs(), 0);
  }
});

test("isReleaseUrl", () => {
  const repo = { owner: "acme", repo: "vps-panel" };
  assert.equal(isReleaseUrl("https://github.com/acme/vps-panel/releases/tag/desktop-v1.0.0", repo), true);
  for (const u of ["https://github.com/acme/other/releases/tag/x", "http://github.com/acme/vps-panel/releases/tag/x", "https://github.com.evil/acme/vps-panel/releases/tag/x", "", null]) {
    assert.equal(isReleaseUrl(u, repo), false, String(u));
  }
});
