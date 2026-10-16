import { api, announce, clearError, el, showError } from "/static/common.js";
import { busy, runSyntaxTest } from "/static/diag.js";

const rows = document.getElementById("rows");
const empty = document.getElementById("empty");
const tableWrap = document.getElementById("table-wrap");
const dialog = document.getElementById("confirm");
let sites = [];

function skeleton() {
  rows.replaceChildren(
    ...Array.from({ length: 3 }, () =>
      el("tr", {}, ...Array.from({ length: 6 }, () =>
        el("td", { cls: "px-4 py-4" }, el("div", { cls: "h-4 animate-pulse rounded bg-slate-800" })),
      )),
    ),
  );
}

function badge(text, cls) {
  return el("span", { text, cls: `badge ${cls}` });
}

function switchButton(site) {
  const on = site.is_enabled;
  const b = el(
    "button",
    {
      cls: `relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-slate-600 transition-colors disabled:opacity-50 ${on ? "bg-emerald-600" : "bg-slate-700"}`,
      attrs: {
        type: "button",
        role: "switch",
        "aria-checked": String(on),
        "aria-label": `Aktifkan ${site.filename}`,
      },
    },
    el("span", { cls: `inline-block size-5 rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`, attrs: { "aria-hidden": "true" } }),
  );
  b.disabled = !site.file_exists;
  b.addEventListener("click", () => toggle(site, b));
  // area sentuh 44px tanpa memperbesar tampilan
  return el("div", { cls: "flex min-h-11 items-center" }, b);
}

function row(site) {
  const when = new Date(site.updated_at).toLocaleString("id-ID");
  const actions = el("div", { cls: "flex gap-2" });
  if (site.file_exists) {
    actions.append(el("a", { text: "Edit", cls: "btn", attrs: { href: `/editor/${site.id}` } }));
    actions.append(el("a", { text: "Clone", cls: "btn", attrs: { href: `/editor/new?from=${site.id}`, "aria-label": `Clone ${site.filename}` } }));
  }
  const del = el("button", { text: "Hapus", cls: "btn btn-danger", attrs: { type: "button" } });
  del.addEventListener("click", () => remove(site));
  actions.append(del);
  return el(
    "tr",
    {},
    el("td", { text: site.filename, cls: "px-4 py-2 font-mono" }),
    el("td", { text: site.domain_name, cls: "px-4 py-2" }),
    el("td", { cls: "px-4 py-2" },
      !site.file_exists
        ? badge("File tidak ada", "bg-amber-900 text-amber-100")
        : site.is_enabled
          ? badge("Aktif", "bg-emerald-900 text-emerald-100")
          : badge("Nonaktif", "bg-slate-700 text-slate-100")),
    el("td", { cls: "px-4 py-2" }, switchButton(site)),
    el("td", { text: when, cls: "px-4 py-2 whitespace-nowrap text-slate-300" }),
    el("td", { cls: "px-4 py-2" }, actions),
  );
}

function render() {
  empty.hidden = sites.length > 0;
  tableWrap.hidden = sites.length === 0;
  rows.replaceChildren(...sites.map(row));
}

async function fetchSites() {
  sites = (await api("/api/v1/sites?limit=200")).items;
  render();
}

async function load() {
  clearError();
  skeleton();
  try {
    await fetchSites();
    announce(`${sites.length} berkas konfigurasi dimuat.`);
  } catch (e) {
    rows.replaceChildren();
    showError(e.message);
  }
}

// Setelah aksi gagal, tampilan mungkin basi (mis. berkas diubah di luar dashboard).
async function resync() {
  try {
    await fetchSites();
  } catch {
    render();
  }
}

async function toggle(site, button) {
  clearError();
  button.disabled = true;
  try {
    const updated = await api(`/api/v1/sites/${site.id}/toggle`, { method: "POST" });
    sites = sites.map((s) => (s.id === site.id ? updated : s));
    announce(`${updated.filename} ${updated.is_enabled ? "diaktifkan" : "dinonaktifkan"}.`);
    render();
  } catch (e) {
    showError(e.message);
    await resync();
  }
}

function remove(site) {
  document.getElementById("confirm-text").textContent =
    `Berkas ${site.filename} dan symlink-nya akan dihapus dari disk server. Tindakan ini tidak dapat dibatalkan.`;
  dialog.returnValue = "";
  dialog.addEventListener("close", async function onClose() {
    dialog.removeEventListener("close", onClose);
    if (dialog.returnValue !== "ok") return;
    clearError();
    try {
      await api(`/api/v1/sites/${site.id}`, { method: "DELETE" });
      sites = sites.filter((s) => s.id !== site.id);
      announce(`${site.filename} dihapus.`);
      render();
    } catch (e) {
      showError(e.message);
      await resync();
    }
  });
  dialog.showModal();
}

load();

document.getElementById("test-all").addEventListener("click", (e) =>
  busy(e.currentTarget, "Menguji…", async () => {
    document.getElementById("diag").hidden = false;
    const ok = await runSyntaxTest(document.getElementById("log"));
    announce(ok ? "Sintaks Nginx valid." : "Sintaks Nginx tidak valid.");
  }),
);
