import { app, onLeave, onShow, show } from "./app.js";
import { formatValue, summarize } from "./format.js";
import { $, announce, el, showError } from "./ui.js";

const api = window.api;
const RANGES = [["15m", "15 mnt"], ["1h", "1 jam"], ["6h", "6 jam"], ["24h", "24 jam"], ["7d", "7 hari"]];
const COLORS = ["#38bdf8", "#34d399", "#fbbf24", "#f472b6"];
const GROUP_TITLES = { host: "Host", nginx: "Nginx" };
const REFRESH_MS = 15_000;

let range = "1h";
let timer = null;
let requestId = 0;
const charts = new Map(); // panelId -> { chart, box }
const cards = new Map();

function buildRangeButtons() {
  $("mon-ranges").replaceChildren(
    ...RANGES.map(([key, label]) => {
      const b = el("button", { text: label, cls: "btn", attrs: { type: "button", "aria-pressed": String(key === range) } });
      b.addEventListener("click", () => {
        range = key;
        buildRangeButtons();
        load();
      });
      return b;
    }),
  );
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
}

function startTimer() {
  stopTimer();
  if ($("mon-auto").checked) timer = setInterval(load, REFRESH_MS);
}

function destroyCharts() {
  for (const { chart } of charts.values()) chart.destroy();
  charts.clear();
  cards.clear();
}

// ---------- kartu panel ----------
function chartOptions(panel, width) {
  const axis = { stroke: "#94a3b8", grid: { stroke: "#1e293b", width: 1 }, ticks: { stroke: "#334155", width: 1 }, font: "11px sans-serif" };
  return {
    width,
    height: 170,
    legend: { show: false },
    cursor: { drag: { x: false, y: false } },
    scales: { x: { time: true }, y: { range: (_u, min, max) => [panel.unit === "percent" ? 0 : Math.min(0, min), panel.unit === "percent" ? Math.max(100, max) : Math.max(max, 1)] } },
    axes: [axis, { ...axis, size: 70, values: (_u, ticks) => ticks.map((t) => formatValue(panel.unit, t)) }],
    series: [{}, ...panel.series.map((s, i) => ({ label: s.label, stroke: COLORS[i % COLORS.length], width: 1.5, spanGaps: false }))],
  };
}

function chartData(panel) {
  const xs = panel.series[0].points.map((p) => p[0]);
  return [xs, ...panel.series.map((s) => s.points.map((p) => p[1]))];
}

function textSummary(panel) {
  // Ringkasan teks sebagai alternatif grafik (pembaca layar) — juga berguna sebagai tooltip cepat.
  return panel.series
    .map((s) => {
      const sum = summarize(s.points);
      return sum
        ? `${s.label}: terakhir ${formatValue(panel.unit, s.points.findLast((p) => p[1] !== null)?.[1])}, min ${formatValue(panel.unit, sum.min)}, rata-rata ${formatValue(panel.unit, sum.avg)}, maks ${formatValue(panel.unit, sum.max)}`
        : `${s.label}: belum ada data`;
    })
    .join(". ");
}

function createCard(panel) {
  const value = el("p", { cls: "text-2xl font-semibold tabular-nums" });
  const body = el("div", { cls: "mt-2" });
  const legend = el("ul", { cls: "mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300" });
  const summary = el("p", { cls: "sr-only", attrs: { id: `sum-${panel.id}` } });
  const root = el(
    "section",
    { cls: "rounded-lg border border-slate-800 bg-slate-900 p-4", attrs: { "aria-label": panel.title } },
    el("div", { cls: "flex items-baseline justify-between gap-2" }, el("h3", { text: panel.title, cls: "text-sm font-medium text-slate-300" }), value),
    body, legend, summary,
  );
  const card = { root, value, body, legend, summary };
  cards.set(panel.id, card);
  return card;
}

function fillCard(panel) {
  const card = cards.get(panel.id) || createCard(panel);
  const { value, body, legend, summary } = card;
  if (!panel.available) {
    value.textContent = "";
    body.replaceChildren(el("p", { text: "Tidak tersedia: exporter belum terpasang atau belum di-scrape Prometheus.", cls: "text-sm text-slate-400" }));
    legend.replaceChildren();
    return card;
  }
  if (panel.error) {
    value.textContent = "";
    body.replaceChildren(el("p", { text: `Gagal memuat panel: ${panel.error.message}`, cls: "text-sm text-red-300" }));
    legend.replaceChildren();
    return card;
  }
  value.textContent = formatValue(panel.unit, panel.last);
  if (panel.statOnly) {
    body.replaceChildren();
    summary.textContent = `${panel.title}: ${value.textContent}`;
    return card;
  }
  const maxPoints = Math.max(0, ...panel.series.map((s) => s.points.filter((p) => p[1] !== null).length));
  const hasData = maxPoints >= 2; // satu titik tidak bisa digambar sebagai garis
  const existing = charts.get(panel.id);
  if (!hasData) {
    existing?.chart.destroy();
    charts.delete(panel.id);
    body.replaceChildren(el("p", { text: maxPoints === 1 ? "Data baru terkumpul; grafik tampil setelah minimal 2 titik." : "Belum ada data untuk rentang ini.", cls: "text-sm text-slate-400" }));
  } else if (existing && body.contains(existing.box)) {
    existing.chart.setData(chartData(panel));
  } else {
    const box = el("div", { attrs: { role: "img", "aria-label": `Grafik ${panel.title}`, "aria-describedby": `sum-${panel.id}` } });
    body.replaceChildren(box);
    const chart = new window.uPlot(chartOptions(panel, Math.max(220, body.clientWidth || 400)), chartData(panel), box);
    charts.set(panel.id, { chart, box });
  }
  legend.replaceChildren(
    ...panel.series.map((s) => {
      const last = s.points.findLast((p) => p[1] !== null)?.[1] ?? null;
      return el("li", { cls: "flex items-center gap-1.5" },
        el("span", { cls: "inline-block size-2.5 rounded-full", attrs: { style: "", "aria-hidden": "true" } }),
        el("span", { text: `${s.label}: ${formatValue(panel.unit, last)}` }));
    }),
  );
  legend.querySelectorAll("li > span:first-child").forEach((dot, i) => (dot.style.backgroundColor = COLORS[i % COLORS.length]));
  summary.textContent = textSummary(panel);
  return card;
}

function render(data) {
  const groups = ["host", "nginx"].map((g) => ({ g, panels: data.panels.filter((p) => p.group === g) })).filter((x) => x.panels.length);
  const children = [];
  for (const { g, panels } of groups) {
    const grid = el("div", { cls: "grid gap-4 md:grid-cols-2 xl:grid-cols-3" });
    for (const p of panels) grid.append(fillCard(p).root);
    children.push(el("section", { attrs: { "aria-labelledby": `grp-${g}` } }, el("h2", { text: GROUP_TITLES[g], attrs: { id: `grp-${g}` }, cls: "mb-3 text-base font-semibold" }), grid));
  }
  $("mon-body").replaceChildren(...children);
  const missing = [];
  if (!data.availability.node) missing.push("panel Host: pasang node_exporter dan tambahkan sebagai target scrape Prometheus");
  if (!data.availability.nginx) missing.push("panel Nginx: pasang nginx-prometheus-exporter (dengan stub_status aktif) dan scrape");
  $("mon-notice").hidden = missing.length === 0;
  $("mon-notice").textContent = missing.length ? `Belum ada data untuk ${missing.join("; ")}. Lihat panduan di README.` : "";
}

// ---------- muat data ----------
async function load() {
  const id = ++requestId;
  const r = await api.monitor(app.server.id, "load", range);
  if (id !== requestId || $("view-monitor").hidden) return; // jawaban basi / sudah pindah view
  if (!r.ok) {
    if (r.code === "NOT_CONNECTED") return show("servers");
    showError(r.message);
    $("mon-updated").textContent = "Gagal memuat. Mencoba lagi pada refresh berikutnya.";
    return;
  }
  showError("");
  render(r.data);
  $("mon-updated").textContent = `Diperbarui ${new Date().toLocaleTimeString("id-ID")} · rentang ${RANGES.find(([k]) => k === range)[1]}, resolusi ${r.data.step} dtk`;
  announce("Data monitoring diperbarui.");
}

async function testPrometheus() {
  const box = $("mon-targets");
  box.hidden = false;
  box.replaceChildren(el("p", { text: "Menguji koneksi ke Prometheus…", cls: "text-slate-300" }));
  const r = await api.monitor(app.server.id, "test");
  if (!r.ok) {
    if (r.code === "NOT_CONNECTED") return show("servers");
    box.replaceChildren(el("p", { text: `✘ ${r.message}`, cls: "text-red-300" }));
    return;
  }
  const t = r.data.targets;
  box.replaceChildren(
    el("p", { text: `✔ Prometheus terjangkau (${app.server.prometheus.host}:${app.server.prometheus.port}). ${t.length} target di-scrape.`, cls: "mb-2 text-emerald-300" }),
    ...(t.length
      ? [el("ul", { cls: "space-y-1" }, ...t.map((x) => el("li", { cls: "flex items-center gap-2 font-mono text-xs" },
          el("span", { text: x.health === "up" ? "● up" : `● ${x.health}`, cls: x.health === "up" ? "text-emerald-300" : "text-red-300" }),
          el("span", { text: `${x.job} · ${x.instance}` }))))]
      : [el("p", { text: "Belum ada target. Tambahkan scrape_configs di prometheus.yml.", cls: "text-slate-400" })]),
  );
}

$("mon-test").addEventListener("click", testPrometheus);
$("mon-back").addEventListener("click", () => show("sites"));
$("mon-refresh").addEventListener("click", load);
$("mon-auto").addEventListener("change", startTimer);
window.addEventListener("resize", () => {
  for (const { chart, box } of charts.values()) chart.setSize({ width: Math.max(220, box.parentElement.clientWidth), height: 170 });
});

onShow("monitor", () => {
  showError("");
  $("mon-title").textContent = `Monitoring · ${app.server.name}`;
  $("mon-notice").hidden = true;
  $("mon-targets").hidden = true;
  $("mon-body").replaceChildren(el("p", { text: "Memuat data…", cls: "text-sm text-slate-400" }));
  $("mon-updated").textContent = "";
  buildRangeButtons();
  load();
  startTimer();
});

onLeave("monitor", () => {
  stopTimer();
  requestId++; // abaikan jawaban yang masih berjalan
  destroyCharts();
});
