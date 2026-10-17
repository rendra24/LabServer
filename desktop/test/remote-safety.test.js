const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { validateFilename, shq, remotePath, NginxError } = require("../src/main/nginx");

test("nama berkas valid", () => {
  for (const n of ["default", "app.local", "my_site-2.conf", "a".repeat(255)]) assert.equal(validateFilename(n), n);
});

test("nama berkas berbahaya ditolak sebelum menyentuh server", () => {
  const bad = ["", ".", "..", ".hidden", "../etc/passwd", "a/b", "a\\b", "a b", "a;id", "$(id)", "`id`",
    "a\nb", "a\0b", "-rf", "a'b", "é", "a".repeat(256)];
  for (const n of bad) {
    assert.throws(() => validateFilename(n), (e) => e instanceof NginxError && e.code === "INVALID_FILENAME", JSON.stringify(n));
  }
});

test("remotePath hanya menggabung dir tervalidasi + nama tervalidasi", () => {
  assert.equal(remotePath("/etc/nginx/sites-available", "app.local"), "/etc/nginx/sites-available/app.local");
  assert.throws(() => remotePath("/etc/nginx/sites-available", "../x"));
  assert.throws(() => remotePath("relative/dir", "x"));
  assert.throws(() => remotePath("/etc/../root", "x"));
});

test("shq: string apa pun kembali utuh lewat sh, tanpa eksekusi", () => {
  const payloads = ["simple", "a b", "it's", "'; touch /tmp/pwned-ds; '", "$(id)", "`id`", "a\nb",
    "\\'\"", "--flag", "*", "~root", "!", "$HOME", ""];
  for (const p of payloads) {
    const out = execFileSync("sh", ["-c", `printf %s ${shq(p)}`], { encoding: "utf8" });
    assert.equal(out, p, JSON.stringify(p));
  }
});
