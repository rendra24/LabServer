const test = require("node:test");
const assert = require("node:assert/strict");
const { registerUpdateIpc, isReleaseUrl } = require("../src/main/update-ipc");

const repoPkg = { version: "0.1.0", repository: "github:acme/vps-panel" };
function setup({ result, response = 0, pkg = repoPkg, installer }) {
  const handlers = {};
  const opened = [];
  const shown = [];
  const sent = [];
  let dialogs = 0;
  registerUpdateIpc({
    handle: (name, fn) => (handlers[name] = fn),
    dialog: { showMessageBox: async (_w, options) => (dialogs++, shown.push(options), { response }) },
    winOf: () => null,
    shell: { openExternal: async (u) => opened.push(u) },
    pkg,
    check: async () => result,
    installer,
  });
  return { call: () => handlers["update:check"]({ sender: { isDestroyed: () => false, send: (channel, packet) => sent.push([channel, packet]) } }), opened, shown, sent, dialogs: () => dialogs };
}
const available = { status: "available", current: "0.1.0", latest: "0.2.0", tag: "desktop-v0.2.0", assets: ["LabServer-macOS-arm64.dmg", "SHA256SUMS.txt"], url: "https://github.com/acme/vps-panel/releases/tag/desktop-v0.2.0" };

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

function fakeInstaller({ ok = true, reason = "", installResult = { ok: true } } = {}) {
  const calls = [];
  return {
    calls,
    supported: async () => ({ ok, reason }),
    install: async (release, emit) => { calls.push(release); emit({ phase: "download", percent: 50 }); return installResult; },
  };
}

test("installer didukung -> dialog menawarkan 'Perbarui sekarang'; tanpa installer hanya dua tombol", async () => {
  const withInstaller = setup({ result: available, response: 0, installer: fakeInstaller() });
  await withInstaller.call();
  assert.deepEqual(withInstaller.shown[0].buttons, ["Nanti", "Buka halaman rilis", "Perbarui sekarang"]);
  const without = setup({ result: available, response: 0 });
  await without.call();
  assert.deepEqual(without.shown[0].buttons, ["Nanti", "Buka halaman rilis"]);
  const unsupported = setup({ result: available, response: 0, installer: fakeInstaller({ ok: false, reason: "x" }) });
  await unsupported.call();
  assert.deepEqual(unsupported.shown[0].buttons, ["Nanti", "Buka halaman rilis"]);
});

test("'Perbarui sekarang' memanggil installer dengan data rilis dari repo, mengirim progres, dan melapor restart", async () => {
  const installer = fakeInstaller();
  const { call, sent, opened } = setup({ result: available, response: 2, installer });
  const r = await call();
  assert.deepEqual(installer.calls, [{ owner: "acme", repo: "vps-panel", tag: "desktop-v0.2.0", version: "0.2.0", assets: available.assets }]);
  assert.deepEqual(sent, [["update:progress", { phase: "download", percent: 50 }]]);
  assert.equal(r.status, "restarting");
  assert.deepEqual(opened, []);
  assert.equal(r.url, undefined);
});

test("kegagalan installer dilaporkan sebagai error dengan pesan, tanpa membuka halaman rilis", async () => {
  const { call, opened } = setup({ result: available, response: 2, installer: fakeInstaller({ installResult: { ok: false, message: "Checksum tidak cocok." } }) });
  const r = await call();
  assert.deepEqual({ status: r.status, message: r.message }, { status: "error", message: "Checksum tidak cocok." });
  assert.deepEqual(opened, []);
});

test("tombol 'Perbarui sekarang' diabaikan bila installer tidak mendukung (tidak ada instalasi diam-diam)", async () => {
  const installer = fakeInstaller({ ok: false });
  const { call } = setup({ result: available, response: 2, installer });
  const r = await call();
  assert.equal(installer.calls.length, 0);
  assert.equal(r.status, "available");
});
