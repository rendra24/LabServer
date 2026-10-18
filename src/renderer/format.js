// Pemformat nilai metrik. Murni (tanpa DOM) agar bisa dites.
const num = (n, d = 1) => n.toLocaleString("id-ID", { maximumFractionDigits: d, minimumFractionDigits: 0 });

function bytes(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${num(Math.sign(n) * v, v >= 100 ? 0 : 1)} ${units[i]}`;
}

function duration(sec) {
  let s = Math.floor(sec);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}h ${h}j ${m}m`;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m ${s - m * 60}d`;
}

export function formatValue(unit, v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  switch (unit) {
    case "percent": return `${num(v, 1)}%`;
    case "bytesPerSec": return `${bytes(v)}/dtk`;
    case "bytes": return bytes(v);
    case "perSec": return `${num(v, 2)}/dtk`;
    case "count": return num(v, 0);
    case "seconds": return duration(v);
    case "ratio": return v >= 1 ? "Aktif" : "Mati";
    default: return num(v, 2);
  }
}

export function summarize(points) {
  const vals = points.map((p) => p[1]).filter((v) => v !== null);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length };
}
