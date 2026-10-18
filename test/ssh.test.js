const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { utils } = require("ssh2");
const { connect, SshError } = require("../src/main/ssh");
const { createHostKeyStore } = require("../src/main/hostkeys");
const { startServer } = require("./helpers/sshServer");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ds-ssh-"));
const plainKey = utils.generateKeyPairSync("ed25519");
const encKey = utils.generateKeyPairSync("ed25519", { passphrase: "frasa-rahasia", cipher: "aes256-ctr", rounds: 4 });

function writeKey(pem) {
  const f = path.join(tmp(), "id_test");
  fs.writeFileSync(f, pem, { mode: 0o600 });
  return f;
}

const profile = (port, extra = {}) => ({ host: "127.0.0.1", port, username: "deploy", auth: "password", ...extra });
const trustAll = () => ({ hostKeys: createHostKeyStore(tmp()), onUnknownHost: async () => true });

async function expectCode(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof SshError, `bukan SshError: ${e}`);
    assert.equal(e.code, code, `${e.code}: ${e.message}`);
    return true;
  });
}

test("koneksi SSH", async (t) => {
  const srv = await startServer({ authorizedKey: plainKey.public });
  const srvEnc = await startServer({ authorizedKey: encKey.public });
  t.after(() => Promise.all([srv.close(), srvEnc.close()]));

  await t.test("password benar -> terhubung & bisa exec", async () => {
    const conn = await connect(profile(srv.port), { password: "pw-123", ...trustAll() });
    assert.equal(await conn.exec("true"), "ran:true\n");
    conn.end();
  });

  await t.test("password salah -> AUTH_FAILED (pesan tidak memuat password)", async () => {
    await assert.rejects(connect(profile(srv.port), { password: "salah-xyz", ...trustAll() }), (e) => {
      assert.equal(e.code, "AUTH_FAILED");
      assert.ok(!e.message.includes("salah-xyz"));
      return true;
    });
  });

  await t.test("password kosong -> NEED_PASSWORD tanpa membuka koneksi", async () => {
    await expectCode(connect(profile(srv.port), { ...trustAll() }), "NEED_PASSWORD");
  });

  await t.test("key tanpa passphrase", async () => {
    const conn = await connect(profile(srv.port, { auth: "key", keyPath: writeKey(plainKey.private) }), trustAll());
    conn.end();
  });

  await t.test("key berpassphrase: benar / kosong / salah", async () => {
    const keyPath = writeKey(encKey.private);
    const p = profile(srvEnc.port, { auth: "key", keyPath });
    (await connect(p, { passphrase: "frasa-rahasia", ...trustAll() })).end();
    await expectCode(connect(p, trustAll()), "NEED_PASSPHRASE");
    await expectCode(connect(p, { passphrase: "keliru", ...trustAll() }), "BAD_PASSPHRASE");
  });

  await t.test("key tidak terdaftar di server -> AUTH_FAILED", async () => {
    const other = utils.generateKeyPairSync("ed25519");
    await expectCode(connect(profile(srv.port, { auth: "key", keyPath: writeKey(other.private) }), trustAll()), "AUTH_FAILED");
  });

  await t.test("berkas key tidak ada / bukan key -> KEY_UNREADABLE", async () => {
    await expectCode(connect(profile(srv.port, { auth: "key", keyPath: "/tidak/ada/id_x" }), trustAll()), "KEY_UNREADABLE");
    await expectCode(connect(profile(srv.port, { auth: "key", keyPath: writeKey("bukan key") }), trustAll()), "KEY_UNREADABLE");
  });
});

test("error jaringan dipetakan ramah", async (t) => {
  const closedPort = await new Promise((r) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
  await t.test("port tertutup -> CONN_REFUSED", () =>
    expectCode(connect(profile(closedPort), { password: "x", ...trustAll() }), "CONN_REFUSED"));
  await t.test("host tidak ada -> HOST_NOT_FOUND", () =>
    expectCode(connect({ ...profile(22), host: "tidak-ada.invalid" }, { password: "x", ...trustAll() }), "HOST_NOT_FOUND"));
  await t.test("server diam -> TIMEOUT", async () => {
    const silent = net.createServer(() => {}).listen(0, "127.0.0.1");
    await new Promise((r) => silent.once("listening", r));
    try {
      await expectCode(connect(profile(silent.address().port), { password: "x", timeoutMs: 800, ...trustAll() }), "TIMEOUT");
    } finally {
      silent.close();
    }
  });
});

test("verifikasi host key (TOFU)", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const dir = tmp();
  const hostKeys = createHostKeyStore(dir);
  const prompts = [];
  const ask = (answer) => async (info) => {
    prompts.push(info);
    return answer;
  };

  await t.test("host baru ditolak pengguna -> HOSTKEY_REJECTED, tidak disimpan", async () => {
    await expectCode(connect(profile(srv.port), { password: "pw-123", hostKeys, onUnknownHost: ask(false) }), "HOSTKEY_REJECTED");
    assert.equal(hostKeys.get("127.0.0.1", srv.port), null);
  });

  await t.test("host baru diterima -> fingerprint SHA256 ditampilkan & disimpan", async () => {
    (await connect(profile(srv.port), { password: "pw-123", hostKeys, onUnknownHost: ask(true) })).end();
    assert.equal(prompts.at(-1).fingerprint, srv.fingerprint);
    assert.equal(hostKeys.get("127.0.0.1", srv.port), srv.fingerprint);
  });

  await t.test("koneksi berikutnya tanpa prompt", async () => {
    const before = prompts.length;
    (await connect(profile(srv.port), { password: "pw-123", hostKeys, onUnknownHost: ask(true) })).end();
    assert.equal(prompts.length, before);
  });

  await t.test("host key berubah -> HOSTKEY_CHANGED tanpa prompt, kredensial tidak dikirim", async () => {
    const impostor = await startServer({ password: "pw-123" });
    try {
      hostKeys.set("127.0.0.1", impostor.port, srv.fingerprint); // seolah dulu server asli di port ini
      const before = prompts.length;
      await expectCode(connect(profile(impostor.port), { password: "pw-123", hostKeys, onUnknownHost: ask(true) }), "HOSTKEY_CHANGED");
      assert.equal(prompts.length, before);
      assert.equal(impostor.stats.authAttempts, 0); // password tidak pernah dikirim ke peniru
      assert.equal(hostKeys.get("127.0.0.1", impostor.port), srv.fingerprint); // tidak ditimpa
    } finally {
      await impostor.close();
    }
  });

  await t.test("format fingerprint sama dengan ssh-keygen -lf", { skip: !hasSshKeygen() }, () => {
    const pubFile = path.join(tmp(), "host.pub");
    fs.writeFileSync(pubFile, utils.parseKey(srv.hostKey).getPublicSSH().toString("base64").replace(/^/, "ssh-ed25519 ") + "\n");
    const out = execFileSync("ssh-keygen", ["-lf", pubFile], { encoding: "utf8" });
    assert.ok(out.includes(srv.fingerprint), out);
  });
});

function hasSshKeygen() {
  try {
    execFileSync("ssh-keygen", ["-?"], { stdio: "ignore" });
    return true;
  } catch (e) {
    return e.status !== undefined && e.code !== "ENOENT";
  }
}
