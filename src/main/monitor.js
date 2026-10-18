const { PANELS, RANGES, buildRange } = require("./monitor-catalog");
const { PromError, createPrometheusClient } = require("./prometheus");

const MAX_POINTS = 1000;
const PRESENCE = { node: "count(node_cpu_seconds_total)", nginx: "count(nginx_up)" };
const CONCURRENCY = 4;

const toNumber = (s) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : null; // "NaN", "+Inf", "-Inf" -> null
};
const hasSample = (vec) => Array.isArray(vec.result) && vec.result.length > 0;

function normalizeMatrix(label, data) {
  const first = data.result[0];
  const raw = Array.isArray(first?.values) ? first.values.slice(-MAX_POINTS) : [];
  const points = raw
    .filter((v) => Array.isArray(v) && v.length === 2)
    .map(([t, v]) => [Number(t), toNumber(v)]);
  return { label, points };
}

const lastValue = (seriesList) => {
  let best = null;
  for (const s of seriesList) {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i][1] !== null) {
        if (best === null) best = s.points[i][1];
        break;
      }
    }
  }
  return best;
};

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Monitoring untuk satu sesi SSH. opts.client / opts.now dipakai tes. */
function createMonitor(conn, profile, opts = {}) {
  const client = opts.client || createPrometheusClient(conn, profile.prometheus);
  const now = opts.now || (() => Date.now() / 1000);

  async function panelData(panel, range) {
    try {
      if (panel.statOnly) {
        const v = await client.query(panel.series[0].query);
        const sample = v.result[0]?.value;
        return { ...head(panel), last: Array.isArray(sample) ? toNumber(sample[1]) : null };
      }
      const series = [];
      for (const s of panel.series) {
        series.push(normalizeMatrix(s.label, await client.queryRange(s.query, range.start, range.end, range.step)));
      }
      return { ...head(panel), series, last: lastValue(series) };
    } catch (e) {
      if (e instanceof PromError) return { ...head(panel), error: { code: e.code, message: e.message } };
      throw e;
    }
  }

  const head = (p) => ({ id: p.id, group: p.group, title: p.title, unit: p.unit, statOnly: Boolean(p.statOnly), available: true });

  return {
    async load(rangeKey) {
      const range = buildRange(rangeKey, now()); // melempar bila rentang tidak dikenal
      const [node, nginx] = await Promise.all([client.query(PRESENCE.node), client.query(PRESENCE.nginx)]);
      const availability = { node: hasSample(node), nginx: hasSample(nginx) };
      const panels = await mapLimit(PANELS, CONCURRENCY, async (p) =>
        availability[p.requires] ? panelData(p, range) : { ...head(p), available: false });
      return { range: rangeKey, rangeSeconds: RANGES[rangeKey], step: range.step, end: range.end, availability, panels };
    },

    /** Uji koneksi: daftar target (job/instance/health saja; tanpa lastError atau URL scrape). */
    async test() {
      const data = await client.targets();
      const targets = data.activeTargets.map((t) => ({
        job: String(t.labels?.job ?? ""),
        instance: String(t.labels?.instance ?? ""),
        health: String(t.health ?? "unknown"),
      }));
      return { ok: true, targets };
    },
  };
}

module.exports = { createMonitor };
