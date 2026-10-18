// Server SSH in-process (ssh2.Server) untuk tes koneksi tanpa sshd sungguhan.
const crypto = require("node:crypto");
const net = require("node:net");
const { Server, utils } = require("ssh2");

function startServer({ password = "pw-123", authorizedKey, hostKey, port = 0, shell = false, sftpRoot, execHandler } = {}) {
  hostKey = hostKey || utils.generateKeyPairSync("ed25519").private;
  const stats = { authAttempts: 0, forwards: [], ptys: [], resizes: [], inputs: [], shells: 0 };
  const clients = new Set();
  const allowedKeys = [].concat(authorizedKey || []).map((k) => utils.parseKey(k));
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.once("close", () => clients.delete(client));
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
      // direct-tcpip (port forward) untuk tes klien Prometheus: selalu diteruskan ke loopback lokal.
      client.on("tcpip", (accept, reject, info) => {
        stats.forwards.push({ host: info.destIP, port: info.destPort });
        const sock = net.connect(info.destPort, "127.0.0.1");
        sock.once("connect", () => {
          const ch = accept();
          ch.pipe(sock).pipe(ch);
          ch.on("error", () => sock.destroy());
          sock.on("error", () => ch.destroy());
        });
        sock.once("error", () => reject());
      });
      client.on("session", (accept) => {
        const session = accept();
        if (sftpRoot) session.on('sftp', acceptSftp => require('./sftpServer').serveSftp(acceptSftp(), sftpRoot));
        if (shell) {
          session.on("pty", (acc, _rej, info) => { stats.ptys.push(info); acc(); });
          session.on("window-change", (acc, _rej, info) => { stats.resizes.push(info); acc?.(); });
          session.on("shell", (acc) => {
            stats.shells++;
            const channel = acc();
            let line = "";
            channel.write("\x1b[32mdeploy@fixture\x1b[0m:~$ ");
            channel.on("data", (data) => {
              stats.inputs.push(Buffer.from(data));
              for (const char of data.toString()) {
                if (char === "\x03") { line = ""; channel.write("^C\r\ndeploy@fixture:~$ "); }
                else if (char === "\r") {
                  if (line === "exit") { channel.exit(0); channel.end(); return; }
                  channel.write(`\r\nreceived:${line}\r\ndeploy@fixture:~$ `);
                  line = "";
                } else { line += char; channel.write(char); }
              }
            });
            channel.on("error", () => {});
          });
        }
        session.on("exec", (acc, _rej, info) => {
          const stream = acc();
          if (execHandler) { execHandler(stream, info.command); return; }
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
      resolve({ port, fingerprint, hostKey, stats, disconnectClients: () => clients.forEach((client) => client.end()), close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { startServer };
