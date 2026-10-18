import { app, invalidateSyntax, onShow, show } from "./app.js";
import { createDiag } from "./diag.js";
import { $, announce, el, showError } from "./ui.js";

const api = window.api;
let sites = [];

const diag = createDiag(
  { testBtn: $("sites-test"), reloadBtn: $("sites-reload"), log: $("sites-log") },
  { serverId: () => app.server.id, state: app },
);

function badge(text, cls) {
  return el("span", { text, cls: `inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}` });
}

function row(s) {
  const toggle = el(
    "button",
    {
      cls: `relative inline-flex h-7 w-12 items-center rounded-full border border-slate-600 disabled:opacity-50 ${s.enabled ? "bg-emerald-600" : "bg-slate-700"}`,
      attrs: { type: "button", role: "switch", "aria-checked": String(s.enabled), "aria-label": `Aktifkan ${s.name}` },
    },
    el("span", { cls: `inline-block size-5 rounded-full bg-white transition-transform ${s.enabled ? "translate-x-6" : "translate-x-1"}`, attrs: { "aria-hidden": "true" } }),
  );
  toggle.disabled = s.conflict;
  toggle.addEventListener("click", () => setEnabled(s, !s.enabled, toggle));
  const edit = el("button", { text: "Edit", cls: "btn", attrs: { type: "button" } });
  edit.addEventListener("click", () => show("editor", { mode: "edit", name: s.name }));
  const clone = el("button", { text: "Clone", cls: "btn", attrs: { type: "button", "aria-label": `Clone ${s.name}` } });
  clone.addEventListener("click", () => show("editor", { mode: "clone", source: s.name }));
  const status = s.conflict
    ? badge("Konflik di sites-enabled", "bg-amber-900 text-amber-100")
    : s.enabled
      ? badge("Aktif", "bg-emerald-900 text-emerald-100")
      : badge("Nonaktif", "bg-slate-700 text-slate-100");
  return el(
    "tr",
    {},
    el("td", { text: s.name, cls: "px-4 py-2 font-mono" }),
    el("td", { cls: "px-4 py-2" }, status),
    el("td", { cls: "px-4 py-2" }, toggle),
    el("td", { text: new Date(s.mtime * 1000).toLocaleString("id-ID"), cls: "px-4 py-2 whitespace-nowrap text-slate-300" }),
    el("td", { cls: "px-4 py-2" }, el("div", { cls: "flex gap-2" }, edit, clone)),
  );
}

function render() {
  $("sites-empty").hidden = sites.length > 0;
  $("sites-table").hidden = sites.length === 0;
  $("sites-rows").replaceChildren(...sites.map(row));
}

export async function loadSites() {
  showError("");
  $("sites-rows").replaceChildren(
    el("tr", {}, el("td", { cls: "px-4 py-4", attrs: { colspan: "5" } }, el("div", { cls: "h-4 animate-pulse rounded bg-slate-800" }))),
  );
  const r = await api.sites(app.server.id, "list");
  if (!r.ok) {
    $("sites-rows").replaceChildren();
    showError(r.message);
    if (r.code === "NOT_CONNECTED") {
      app.server = null;
      show("servers");
    }
    return;
  }
  sites = r.data;
  render();
  announce(`${sites.length} berkas konfigurasi.`);
}

async function setEnabled(s, on, button) {
  showError("");
  button.disabled = true;
  const r = await api.sites(app.server.id, on ? "enable" : "disable", s.name);
  if (!r.ok) showError(r.message);
  else {
    invalidateSyntax();
    diag.refresh();
    announce(`${s.name} ${on ? "diaktifkan" : "dinonaktifkan"}. Jalankan Test lalu Reload agar berlaku.`);
  }
  await loadSites();
}

$("sites-refresh").addEventListener("click", loadSites);
$("sites-new").addEventListener("click", () => show("editor", { mode: "new" }));

let shownServerId = null;

onShow("sites", () => {
  if (shownServerId !== app.server.id) $("sites-log").replaceChildren(); // log milik server lain tidak relevan
  shownServerId = app.server.id;
  $("sites-title").textContent = "Konfigurasi Nginx";
  $("sites-sub").textContent = app.server.nginx.available;
  diag.refresh();
  loadSites();
});
