const test = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, parseRepo, checkForUpdate, TAG_PREFIX } = require("../src/main/update-check");

const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/acme/vps-panel/releases/tag/${tag}`, ...extra });
const fakeFetch = (body, { status = 200 } = {}) => async () => ({ ok: status === 200, status, json: async () => body });
const repo = { owner: "acme", repo: "vps-panel" };

test("compareVersions: numerik, bukan teks; prarilis < rilis", () => {
  assert.equal(compareVersions("0.2.0", "0.1.9"), 1);
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1); // bukan perbandingan string
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.1.0", "0.1.1"), -1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.throws(() => compareVersions("abc", "1.0.0"));
  assert.throws(() => compareVersions("1.0.0", "1.x.0"));
});

test("parseRepo dari package.json; placeholder/format salah = belum dikonfigurasi", () => {
  assert.deepEqual(parseRepo({ repository: { url: "https://github.com/acme/vps-panel.git" } }), repo);
  assert.deepEqual(parseRepo({ repository: "github:acme/vps-panel" }), repo);
  assert.deepEqual(parseRepo({ repository: "https://github.com/acme/vps-panel" }), repo);
  for (const pkg of [{}, { repository: "" }, { repository: { url: "https://github.com/OWNER/REPO.git" } }, { repository: "https://gitlab.com/a/b" }, { repository: "https://github.com/a/b/../../c" }, { repository: { url: "https://github.com/ac me/x.git" } }]) {
    assert.equal(parseRepo(pkg), null, JSON.stringify(pkg));
  }
});

test("versi baru tersedia -> status available + URL halaman rilis", async () => {
  const r = await checkForUpdate({ current: "0.1.0", repo, fetchImpl: fakeFetch([release(`${TAG_PREFIX}0.2.0`)]) });
  assert.deepEqual(r, { status: "available", current: "0.1.0", latest: "0.2.0", url: "https://github.com/acme/vps-panel/releases/tag/desktop-v0.2.0" });
});

test("pilih versi tertinggi dari tag desktop saja; abaikan draft/prarilis/tag lain", async () => {
  const body = [
    release("v9.9.9"), // bukan tag desktop
    release(`${TAG_PREFIX}0.3.0`, { draft: true }),
    release(`${TAG_PREFIX}0.4.0-beta.1`, { prerelease: true }),
    release(`${TAG_PREFIX}0.2.0`),
    release(`${TAG_PREFIX}0.2.1`),
    release(`${TAG_PREFIX}notversion`),
  ];
  const r = await checkForUpdate({ current: "0.1.0", repo, fetchImpl: fakeFetch(body) });
  assert.equal(r.latest, "0.2.1");
});

test("sudah terbaru / lebih baru dari rilis", async () => {
  assert.equal((await checkForUpdate({ current: "0.2.0", repo, fetchImpl: fakeFetch([release(`${TAG_PREFIX}0.2.0`)]) })).status, "up-to-date");
  assert.equal((await checkForUpdate({ current: "0.3.0", repo, fetchImpl: fakeFetch([release(`${TAG_PREFIX}0.2.0`)]) })).status, "up-to-date");
  assert.equal((await checkForUpdate({ current: "0.1.0", repo, fetchImpl: fakeFetch([]) })).status, "no-releases");
});

test("repo belum dikonfigurasi", async () => {
  assert.equal((await checkForUpdate({ current: "0.1.0", repo: null, fetchImpl: fakeFetch([]) })).status, "unconfigured");
});

test("error ramah: 404/403 (repo privat/tidak ada), jaringan, bentuk salah, timeout", async () => {
  for (const status of [404, 403, 500]) {
    const r = await checkForUpdate({ current: "0.1.0", repo, fetchImpl: fakeFetch({}, { status }) });
    assert.equal(r.status, "error");
    assert.ok(r.message && !/token/i.test(r.message) === true || r.message);
  }
  const priv = await checkForUpdate({ current: "0.1.0", repo, fetchImpl: fakeFetch({}, { status: 404 }) });
  assert.match(priv.message, /privat|tidak ditemukan/i);

  const net = await checkForUpdate({ current: "0.1.0", repo, fetchImpl: async () => { throw new TypeError("fetch failed: ECONNREFUSED 1.2.3.4"); } });
  assert.equal(net.status, "error");
  assert.ok(!net.message.includes("1.2.3.4"));

  assert.equal((await checkForUpdate({ current: "0.1.0", repo, fetchImpl: fakeFetch({ not: "array" }) })).status, "error");

  const slow = await checkForUpdate({ current: "0.1.0", repo, timeoutMs: 50, fetchImpl: (_u, { signal }) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  assert.equal(slow.status, "error");
  assert.match(slow.message, /waktu|timeout/i);
});

test("URL rilis yang bukan milik repo ditolak (tidak pernah dibuka)", async () => {
  const evil = release(`${TAG_PREFIX}0.9.0`, { html_url: "https://evil.example/phish" });
  const r = await checkForUpdate({ current: "0.1.0", repo, fetchImpl: fakeFetch([evil]) });
  assert.equal(r.status, "available");
  assert.equal(r.url, "https://github.com/acme/vps-panel/releases/tag/desktop-v0.9.0"); // dibangun sendiri dari repo+tag
});

test("permintaan ke API GitHub: URL, header, tanpa kredensial", async () => {
  let seen;
  await checkForUpdate({ current: "0.1.0", repo, fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => [] }; } });
  assert.equal(seen.url, "https://api.github.com/repos/acme/vps-panel/releases?per_page=30");
  assert.equal(seen.opts.headers.Accept, "application/vnd.github+json");
  assert.equal(seen.opts.headers.Authorization, undefined);
});
