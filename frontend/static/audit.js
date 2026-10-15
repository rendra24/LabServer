import { api, announce, clearError, el, showError } from "/static/common.js";

const $ = (id) => document.getElementById(id);
const PAGE = 25;
let offset = 0;
let total = 0;
let items = [];

function skeleton() {
  $("rows").replaceChildren(
    ...Array.from({ length: 4 }, () =>
      el("tr", {}, ...Array.from({ length: 5 }, () =>
        el("td", { cls: "px-4 py-4" }, el("div", { cls: "h-4 animate-pulse rounded bg-slate-800" })),
      )),
    ),
  );
}

function row(log) {
  const when = new Date(log.created_at).toLocaleString("id-ID");
  const open = el("button", { text: "Lihat Output Lengkap", cls: "btn", attrs: { type: "button" } });
  open.addEventListener("click", () => showDetail(log));
  return el(
    "tr",
    {},
    el("td", { text: when, cls: "px-4 py-2 whitespace-nowrap text-slate-300" }),
    el("td", { cls: "px-4 py-2" },
      el("div", { text: log.action_type, cls: "font-mono text-xs" }),
      el("div", { text: log.site_filename ?? "—", cls: "text-xs text-slate-400" })),
    el("td", { text: log.command_executed, cls: "max-w-xs truncate px-4 py-2 font-mono text-xs", attrs: { title: log.command_executed } }),
    el("td", { cls: "px-4 py-2" },
      el("span", {
        text: log.is_success ? "Success" : "Failure",
        cls: `badge ${log.is_success ? "bg-emerald-900 text-emerald-100" : "bg-red-900 text-red-100"}`,
      })),
    el("td", { cls: "px-4 py-2" }, open),
  );
}

function filtered() {
  return Boolean($("f-action").value || $("f-status").value);
}

function render() {
  const none = items.length === 0;
  $("table-wrap").hidden = none;
  $("pager").hidden = total === 0;
  const empty = $("empty");
  empty.hidden = !none;
  empty.textContent = filtered()
    ? "Tidak ada riwayat yang cocok dengan filter."
    : "Belum ada riwayat aktivitas tercatat.";
  $("rows").replaceChildren(...items.map(row));
  $("range").textContent = total ? `${offset + 1}–${offset + items.length} dari ${total}` : "";
  $("prev").disabled = offset === 0;
  $("next").disabled = offset + PAGE >= total;
}

async function load() {
  clearError();
  $("table-wrap").hidden = false;
  $("empty").hidden = true;
  skeleton();
  const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if ($("f-action").value) q.set("action_type", $("f-action").value);
  if ($("f-status").value) q.set("is_success", $("f-status").value);
  try {
    const data = await api(`/api/v1/audit-logs?${q}`);
    items = data.items;
    total = data.total;
    render();
    announce(`${total} catatan riwayat.`);
  } catch (e) {
    items = [];
    total = 0;
    $("rows").replaceChildren();
    $("table-wrap").hidden = true;
    $("pager").hidden = true;
    showError(e.message);
  }
}

function showDetail(log) {
  $("detail-meta").textContent = `${log.action_type} · ${log.is_success ? "Success" : "Failure"} · ${new Date(log.created_at).toLocaleString("id-ID")}`;
  $("detail-cmd").textContent = log.command_executed;
  $("detail-out").textContent = log.execution_output || "(tidak ada output)";
  $("detail").showModal();
}

for (const id of ["f-action", "f-status"]) {
  $(id).addEventListener("change", () => {
    offset = 0;
    load();
  });
}
$("refresh").addEventListener("click", load);
$("prev").addEventListener("click", () => {
  offset = Math.max(0, offset - PAGE);
  load();
});
$("next").addEventListener("click", () => {
  offset += PAGE;
  load();
});

load();
