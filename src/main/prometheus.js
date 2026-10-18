const http = require("node:http");

const MESSAGES = {
  PROM_UNREACHABLE: "Prometheus tidak dapat dijangkau lewat SSH. Pastikan Prometheus berjalan dan alamat/port-nya benar.",
  PROM_TIMEOUT: "Prometheus tidak menjawab tepat waktu.",
  PROM_BAD_RESPONSE: "Jawaban dari server bukan respons Prometheus yang valid. Periksa host/port Prometheus.",
  PROM_QUERY_ERROR: "Prometheus menolak query.",
  PROM_TOO_LARGE: "Jawaban Prometheus terlalu besar. Pilih rentang waktu yang lebih pendek.",
};

class PromError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || "Terjadi kesalahan saat membaca Prometheus.");
    this.code = code;
    this.detail = detail; // untuk log, bukan untuk ditampilkan
  }
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Klien HTTP Prometheus lewat port-forward SSH (direct-tcpip): tidak ada port lokal yang dibuka,
 * koneksi hanya hidup selama satu permintaan.
 * conn: hasil connect() (punya .client dengan forwardOut).
 */
function createPrometheusClient(conn, { host = "127.0.0.1", port = 9090, timeoutMs = 10_000, maxBytes = 5 * 1024 * 1024 } = {}) {
  function request(pathname, params) {
    const search = new URLSearchParams(params).toString();
    const target = search ? `${pathname}?${search}` : pathname;
    return new Promise((resolve, reject) => {
      let settled = false;
      let req = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (req) req.destroy();
        fn(value);
      };
      const timer = setTimeout(() => finish(reject, new PromError("PROM_TIMEOUT")), timeoutMs);

      let forward;
      try {
        forward = conn.client.forwardOut("127.0.0.1", 0, host, port, (err, stream) => {
          if (err) return finish(reject, new PromError("PROM_UNREACHABLE", err.message));
          const agent = new http.Agent({ keepAlive: false });
          agent.createConnection = () => stream; // pakai channel SSH sebagai socket
          req = http.request(
            { agent, method: "GET", path: target, headers: { Host: `${host}:${port}`, Accept: "application/json", Connection: "close" } },
            (res) => {
              const chunks = [];
              let size = 0;
              res.on("data", (c) => {
                size += c.length;
                if (size > maxBytes) return finish(reject, new PromError("PROM_TOO_LARGE"));
                chunks.push(c);
              });
              res.on("end", () => {
                let body;
                try {
                  body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                } catch {
                  return finish(reject, new PromError("PROM_BAD_RESPONSE", `HTTP ${res.statusCode}, bukan JSON`));
                }
                if (!isObj(body) || (body.status !== "success" && body.status !== "error")) {
                  return finish(reject, new PromError("PROM_BAD_RESPONSE", "bentuk tidak dikenal"));
                }
                if (body.status === "error") return finish(reject, new PromError("PROM_QUERY_ERROR", `${body.errorType}: ${body.error}`));
                if (res.statusCode !== 200 || !isObj(body.data)) {
                  return finish(reject, new PromError("PROM_BAD_RESPONSE", `HTTP ${res.statusCode}`));
                }
                finish(resolve, body.data);
              });
              res.on("error", () => finish(reject, new PromError("PROM_UNREACHABLE")));
            },
          );
          req.on("error", (e) => {
            if (process.env.DS_DEBUG) console.error("req error:", e);
            finish(reject, new PromError("PROM_UNREACHABLE", e.message));
          });
          req.end();
        });
      } catch (e) {
        return finish(reject, new PromError("PROM_UNREACHABLE", e.message));
      }
      if (forward === false) finish(reject, new PromError("PROM_UNREACHABLE", "forwardOut ditolak"));
    });
  }

  const checkMatrix = (data) => {
    if (!Array.isArray(data.result)) throw new PromError("PROM_BAD_RESPONSE", "result bukan array");
    return data;
  };

  return {
    async query(promql, time) {
      const data = checkMatrix(await request("/api/v1/query", time === undefined ? { query: promql } : { query: promql, time: String(time) }));
      return data;
    },
    async queryRange(promql, start, end, step) {
      return checkMatrix(await request("/api/v1/query_range", { query: promql, start: String(start), end: String(end), step: String(step) }));
    },
    async targets() {
      const data = await request("/api/v1/targets", { state: "active" });
      if (!Array.isArray(data.activeTargets)) throw new PromError("PROM_BAD_RESPONSE", "activeTargets bukan array");
      return data;
    },
  };
}

module.exports = { createPrometheusClient, PromError };
