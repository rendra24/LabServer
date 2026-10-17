// Tes terhadap OpenSSH sungguhan. Dilewati kecuali SSHD_PORT diset, mis.:
//   SSHD_PORT=2223 SSHD_PASSWORD=... SSHD_FINGERPRINT=SHA256:... SSHD_CONTAINER=dssshd npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { connect } = require("../../src/main/ssh");
const { createHostKeyStore } = require("../../src/main/hostkeys");

const env = process.env;
const skip = !env.SSHD_PORT && "set SSHD_PORT untuk menguji sshd sungguhan";
const scripts = path.join(__dirname, "..", "..", "scripts");
const base = { host: "127.0.0.1", port: Number(env.SSHD_PORT), username: "deploy" };

test("OpenSSH sungguhan", { skip }, async (t) => {
  const hostKeys = createHostKeyStore(fs.mkdtempSync(path.join(os.tmpdir(), "ds-sshd-")));
  const prompts = [];
  const opts = (extra) => ({ hostKeys, onUnknownHost: async (i) => (prompts.push(i), true), ...extra });

  await t.test("password -> fingerprint sama dengan ssh-keygen di server, exec jalan", async () => {
    const conn = await connect({ ...base, auth: "password" }, opts({ password: env.SSHD_PASSWORD }));
    assert.equal(prompts[0].fingerprint, env.SSHD_FINGERPRINT);
    assert.equal((await conn.exec("id -un")).trim(), "deploy");
    conn.end();
  });

  await t.test("password salah ditolak", async () => {
    await assert.rejects(connect({ ...base, auth: "password" }, opts({ password: "salah" })), { code: "AUTH_FAILED" });
  });

  await t.test("key tanpa passphrase", async () => {
    const conn = await connect({ ...base, auth: "key", keyPath: path.join(scripts, ".dev-key-plain") }, opts());
    conn.end();
  });

  await t.test("key berpassphrase", async () => {
    const p = { ...base, auth: "key", keyPath: path.join(scripts, ".dev-key") };
    (await connect(p, opts({ passphrase: "frasa-dev" }))).end();
    await assert.rejects(connect(p, opts()), { code: "NEED_PASSPHRASE" });
  });

  await t.test("host key server diganti -> HOSTKEY_CHANGED", { skip: !env.SSHD_CONTAINER && "butuh SSHD_CONTAINER" }, async () => {
    execFileSync("docker", ["exec", env.SSHD_CONTAINER, "bash", "-c",
      "rm /etc/ssh/ssh_host_* && ssh-keygen -A >/dev/null && pkill -HUP -x sshd || /usr/sbin/sshd"]);
    await new Promise((r) => setTimeout(r, 1000));
    await assert.rejects(connect({ ...base, auth: "password" }, opts({ password: env.SSHD_PASSWORD })), { code: "HOSTKEY_CHANGED" });
  });
});
