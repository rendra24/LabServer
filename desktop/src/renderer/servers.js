import { app, show } from "./app.js";
import { withCredentials } from "./creds.js";
import { $, announce, busy, el, showError } from "./ui.js";

const api = window.api;

export async function renderServers() {
  const servers = await api.servers.list();
  $("empty").hidden = servers.length > 0;
  $("servers").replaceChildren(...servers.map(card));
}

function card(s) {
  const result = el("p", { cls: "mt-2 min-h-5 text-sm", attrs: { role: "status" } });
  const openBtn = el("button", { text: "Buka", cls: "btn btn-primary", attrs: { type: "button", "aria-label": `Buka ${s.name}` } });
  const test = el("button", { text: "Tes Koneksi", cls: "btn", attrs: { type: "button" } });
  const edit = el("button", { text: "Ubah", cls: "btn", attrs: { type: "button" } });
  const del = el("button", { text: "Hapus", cls: "btn btn-danger", attrs: { type: "button", "aria-label": `Hapus ${s.name}` } });
  openBtn.addEventListener("click", () => busy(openBtn, "Menghubungkan…", () => openServer(s, result)));
  test.addEventListener("click", () => busy(test, "Menghubungkan…", () => testServer(s, result)));
  edit.addEventListener("click", () => openForm(s));
  del.addEventListener("click", async () => {
    if ((await api.servers.remove(s.id)).ok) {
      announce(`${s.name} dihapus.`);
      renderServers();
    }
  });
  const authText = s.auth === "key" ? `key ${s.keyPath.split(/[\\/]/).pop()}` : "password";
  const saved = s.hasSavedPassword || s.hasSavedPassphrase ? " · kredensial tersimpan" : "";
  return el(
    "li",
    { cls: "rounded-lg border border-slate-800 bg-slate-900 p-4" },
    el(
      "div",
      { cls: "flex flex-wrap items-center gap-3" },
      el("div", { cls: "min-w-0 flex-1" },
        el("p", { text: s.name, cls: "font-semibold" }),
        el("p", { text: `${s.username}@${s.host}:${s.port} · ${authText}${saved}`, cls: "truncate font-mono text-xs text-slate-400" })),
      openBtn, test, edit, del,
    ),
    result,
  );
}

function showResult(result, s, r) {
  result.className = `mt-2 min-h-5 text-sm ${r.ok ? "text-emerald-300" : "text-red-300"}`;
  result.replaceChildren(r.ok ? "✔ Terhubung. Autentikasi dan host key valid." : `✘ ${r.message}`);
  if (r.code === "HOSTKEY_CHANGED") {
    const forget = el("button", { text: "Lupakan fingerprint lama…", cls: "btn ml-3", attrs: { type: "button" } });
    forget.addEventListener("click", async () => {
      if ((await api.servers.forgetHostKey(s.id)).ok) {
        result.className = "mt-2 min-h-5 text-sm text-slate-300";
        result.textContent = "Fingerprint dilupakan. Hubungkan ulang untuk memverifikasi fingerprint baru.";
      }
    });
    result.append(forget);
  }
  announce(r.ok ? `Terhubung ke ${s.name}.` : r.message);
}

async function testServer(s, result) {
  showError("");
  result.textContent = "";
  const r = await withCredentials(s, (creds) => api.servers.test(s.id, creds), app.canRemember);
  if (r) showResult(result, s, r);
  renderServers();
}

async function openServer(s, result) {
  showError("");
  result.textContent = "";
  const r = await withCredentials(s, (creds) => api.servers.connect(s.id, creds), app.canRemember);
  if (!r) return;
  if (!r.ok) return showResult(result, s, r);
  app.server = (await api.servers.list()).find((x) => x.id === s.id);
  app.syntaxValid = false;
  show("sites");
}

// ---------- form server ----------
const form = $("server-form");
const setAuthUi = () => ($("key-row").hidden = form.auth.value !== "key");
form.querySelectorAll('input[name="auth"]').forEach((r) => r.addEventListener("change", setAuthUi));

function clearErrors() {
  form.querySelectorAll(".err").forEach((p) => (p.textContent = ""));
  form.querySelectorAll("[aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
}

export function openForm(s) {
  form.reset();
  clearErrors();
  $("server-title").textContent = s ? `Ubah ${s.name}` : "Tambah Server";
  form.id.value = s?.id || "";
  if (s) {
    for (const k of ["name", "host", "port", "username", "keyPath"]) form[k].value = s[k] ?? "";
    form.auth.value = s.auth;
    for (const k of ["available", "enabled", "nginxBin", "reload"]) form[`nginx.${k}`].value = s.nginx[k];
  }
  setAuthUi();
  $("server-dialog").showModal();
  $("f-name").focus();
}

$("pick-key").addEventListener("click", async () => {
  const p = await api.pickKey();
  if (p) form.keyPath.value = p;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await api.servers.save({
    id: form.id.value || undefined,
    name: form.name.value,
    host: form.host.value,
    port: form.port.value,
    username: form.username.value,
    auth: form.auth.value,
    keyPath: form.keyPath.value,
    nginx: Object.fromEntries(["available", "enabled", "nginxBin", "reload"].map((k) => [k, form[`nginx.${k}`].value])),
  });
  clearErrors();
  if (!r.ok) {
    let first = null;
    for (const [field, msg] of Object.entries(r.errors)) {
      const p = document.getElementById(`e-${field}`);
      if (p) p.textContent = msg;
      const input = form.querySelector(`[name="${field}"]`);
      if (input) {
        input.setAttribute("aria-invalid", "true");
        first ??= input;
      }
      if (field.startsWith("nginx.")) form.querySelector("details").open = true;
    }
    first?.focus();
    return;
  }
  $("server-dialog").close();
  announce(`${r.profile.name} disimpan.`);
  renderServers();
});

document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
$("add").addEventListener("click", () => openForm(null));
$("add-empty").addEventListener("click", () => openForm(null));
