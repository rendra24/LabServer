// Server SSH in-process (ssh2.Server) untuk tes koneksi tanpa sshd sungguhan.
const crypto = require("node:crypto");
const { Server, utils } = require("ssh2");

function startServer({ password = "pw-123", authorizedKey, hostKey, port = 0 } = {}) {
  hostKey = hostKey || utils.generateKeyPairSync("ed25519").private;
  const stats = { authAttempts: 0 };
  const allowedKeys = [].concat(authorizedKey || []).map((k) => utils.parseKey(k));
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on("authentication", (ctx) => {
      stats.authAttempts += 1;
      if (ctx.username !== "deploy") return ctx.reject();
      if (ctx.method === "password" && ctx.password === password) return ctx.accept();
      const allowed = ctx.method === "publickey"
        && allowedKeys.find((k) => k.type === ctx.key.algo && Buffer.compare(ctx.key.data, k.getPublicSSH()) === 0);
      if (allowed) {
        if (!ctx.signature) return ctx.accept(); // tahap cek kunci
        if (allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true) return ctx.accept();
      }
      ctx.reject(["password", "publickey"]);
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        accept().on("exec", (acc, _rej, info) => {
          const stream = acc();
          stream.write(`ran:${info.command}\n`);
          stream.exit(0);
          stream.end();
        });
      });
    });
    client.on("error", () => {});
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const port = server.address().port;
      const pub = utils.parseKey(hostKey).getPublicSSH();
      const fingerprint = `SHA256:${crypto.createHash("sha256").update(pub).digest("base64").replace(/=+$/, "")}`;
      resolve({ port, fingerprint, hostKey, stats, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { startServer };
