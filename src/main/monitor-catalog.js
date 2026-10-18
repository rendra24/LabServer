// Katalog panel tetap. PromQL hanya berasal dari sini; renderer cukup mengirim {panelId, range}.
const NET_DEV = 'device!~"lo|veth.*|docker.*|br-.*"';
const FS = 'mountpoint="/",fstype!~"tmpfs|squashfs|ramfs"';

/** unit: percent | bytes | bytesPerSec | perSec | count | seconds | ratio | number */
const PANELS = [
  { id: "cpu", group: "host", requires: "node", title: "CPU", unit: "percent",
    series: [{ label: "Terpakai", query: '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)' }] },
  { id: "memory", group: "host", requires: "node", title: "Memori", unit: "percent",
    series: [{ label: "Terpakai", query: "(1 - (sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes))) * 100" }] },
  { id: "disk", group: "host", requires: "node", title: "Disk /", unit: "percent",
    series: [{ label: "Terpakai", query: `(1 - (sum(node_filesystem_avail_bytes{${FS}}) / sum(node_filesystem_size_bytes{${FS}}))) * 100` }] },
  { id: "net", group: "host", requires: "node", title: "Jaringan", unit: "bytesPerSec",
    series: [
      { label: "Masuk", query: `sum(rate(node_network_receive_bytes_total{${NET_DEV}}[2m]))` },
      { label: "Keluar", query: `sum(rate(node_network_transmit_bytes_total{${NET_DEV}}[2m]))` },
    ] },
  { id: "load", group: "host", requires: "node", title: "Load average", unit: "number",
    series: [
      { label: "1 mnt", query: "avg(node_load1)" },
      { label: "5 mnt", query: "avg(node_load5)" },
      { label: "15 mnt", query: "avg(node_load15)" },
    ] },
  { id: "uptime", group: "host", requires: "node", title: "Uptime", unit: "seconds", statOnly: true,
    series: [{ label: "Uptime", query: "time() - min(node_boot_time_seconds)" }] },
  { id: "nginx_up", group: "nginx", requires: "nginx", title: "Status Nginx", unit: "ratio", statOnly: true,
    series: [{ label: "nginx_up", query: "min(nginx_up)" }] },
  { id: "nginx_connections", group: "nginx", requires: "nginx", title: "Koneksi Nginx", unit: "count",
    series: [
      { label: "Aktif", query: "sum(nginx_connections_active)" },
      { label: "Reading", query: "sum(nginx_connections_reading)" },
      { label: "Writing", query: "sum(nginx_connections_writing)" },
      { label: "Waiting", query: "sum(nginx_connections_waiting)" },
    ] },
  { id: "nginx_requests", group: "nginx", requires: "nginx", title: "Request per detik", unit: "perSec",
    series: [{ label: "Request/dtk", query: "sum(rate(nginx_http_requests_total[2m]))" }] },
];

const RANGES = { "15m": 900, "1h": 3600, "6h": 21_600, "24h": 86_400, "7d": 604_800 };
const MAX_POINTS = 360;
const STEP_UNIT = 15;

const byId = new Map(PANELS.map((p) => [p.id, p]));
const getPanel = (id) => (typeof id === "string" && byId.has(id) ? byId.get(id) : null);

/** start/end diselaraskan ke kelipatan step supaya refresh berturut-turut memakai titik yang sama. */
function buildRange(key, nowSec) {
  if (typeof key !== "string" || !Object.hasOwn(RANGES, key)) throw new Error("Rentang waktu tidak dikenal.");
  const seconds = RANGES[key];
  const step = Math.max(STEP_UNIT, Math.ceil(seconds / MAX_POINTS / STEP_UNIT) * STEP_UNIT);
  const end = Math.floor(nowSec / step) * step;
  return { start: end - seconds, end, step };
}

function parseRequest(req) {
  if (req === null || typeof req !== "object") return null;
  const panel = getPanel(req.panelId);
  if (!panel || typeof req.range !== "string" || !Object.hasOwn(RANGES, req.range)) return null;
  return { panel, range: req.range };
}

module.exports = { PANELS, RANGES, buildRange, getPanel, parseRequest };
