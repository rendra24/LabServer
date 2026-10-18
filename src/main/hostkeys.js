const fs = require("node:fs");
const path = require("node:path");

/** known_hosts milik aplikasi: { "host:port": "SHA256:..." }. */
function createHostKeyStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "known_hosts.json");
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  const key = (host, port) => `${host.toLowerCase()}:${port}`;
  return {
    get: (host, port) => read()[key(host, port)] || null,
    set(host, port, fingerprint) {
      const all = read();
      all[key(host, port)] = fingerprint;
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
    forget(host, port) {
      const all = read();
      delete all[key(host, port)];
      fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
    },
  };
}

function decideHostKey(known, fingerprint) {
  if (!known) return "unknown";
  return known === fingerprint ? "trusted" : "changed";
}

module.exports = { createHostKeyStore, decideHostKey };
