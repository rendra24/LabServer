// Server SSH lokal untuk mencoba aplikasi tanpa VPS: user "deploy", password "pw-123",
// dan menerima key di scripts/.dev-key (dibuat otomatis). HANYA untuk pengembangan.
const fs = require("node:fs");
const path = require("node:path");
const { utils } = require("ssh2");
const { startServer } = require("../test/helpers/sshServer");

const keyFile = path.join(__dirname, ".dev-key");
if (!fs.existsSync(keyFile)) {
  const k = utils.generateKeyPairSync("ed25519", { passphrase: "frasa-dev", cipher: "aes256-ctr", rounds: 4 });
  fs.writeFileSync(keyFile, k.private, { mode: 0o600 });
  fs.writeFileSync(`${keyFile}.pub`, `${k.public}\n`);
}
const plainFile = path.join(__dirname, ".dev-key-plain");
if (!fs.existsSync(plainFile)) {
  const k = utils.generateKeyPairSync("ed25519");
  fs.writeFileSync(plainFile, k.private, { mode: 0o600 });
  fs.writeFileSync(`${plainFile}.pub`, `${k.public}\n`);
}
const port = Number(process.env.PORT || 2222);
// Host key tetap antar-restart agar fingerprint yang sudah disetujui tetap valid.
const hostKeyFile = path.join(__dirname, ".dev-hostkey");
if (!fs.existsSync(hostKeyFile)) fs.writeFileSync(hostKeyFile, utils.generateKeyPairSync("ed25519").private, { mode: 0o600 });
const keys = [keyFile, plainFile].map((f) => fs.readFileSync(`${f}.pub`, "utf8"));
startServer({ authorizedKey: keys, port, hostKey: fs.readFileSync(hostKeyFile, "utf8") }).then((s) => {
  console.log(`SSH dev server di 127.0.0.1:${s.port}  user=deploy  password=pw-123`);
  console.log(`Key: ${keyFile} (passphrase: frasa-dev), ${plainFile} (tanpa passphrase)`);
  console.log(`Fingerprint host: ${s.fingerprint}`);
});
