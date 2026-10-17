import { app, show } from "./app.js";
import { withCredentials } from "./creds.js";
import { $, announce, busy, el, showError } from "./ui.js";
import { icon } from "./icons.js";

const api = window.api;
let profiles = [];
const connectionResults = new Map();

export async function renderServers() {
  profiles = await api.servers.list();
  renderCollection();
}

function renderCollection() {
  const query = $("server-search").value.trim().toLocaleLowerCase();
  const visible = profiles.filter((s) => [s.name, s.host, s.username].some((v) => v.toLocaleLowerCase().includes(query)));
  $("empty").hidden = profiles.length > 0;
  $("no-results").hidden = profiles.length === 0 || visible.length > 0;
  $("servers").hidden = visible.length === 0;
  $("server-count").textContent = query ? `${visible.length} / ${profiles.length}` : profiles.length;
  $("nav-count").textContent = profiles.length;
  $("servers").replaceChildren(...visible.map(card));
}

function card(s) {
  const result = el("p", { cls: "connection-result", attrs: { role: "status" } });
  const openBtn = el("button", { text: "Hubungkan", cls: "btn btn-connect", attrs: { type: "button", "aria-label": `Buka ${s.name}` } });
  openBtn.append(icon("arrow"));
  const test = el("button", { text: "Tes Koneksi", cls: "btn", attrs: { type: "button" } });
  const edit = el("button", { cls: "icon-button", attrs: { type: "button", "aria-label": `Ubah ${s.name}`, title: "Ubah server" } }, icon("edit"));
  const del = el("button", { cls: "icon-button delete-server", attrs: { type: "button", "aria-label": `Hapus ${s.name}`, title: "Hapus server" } }, icon("trash"));
  openBtn.addEventListener("click", () => busy(openBtn, "Menghubungkan…", () => openServer(s, result)));
  test.addEventListener("click", () => busy(test, "Menghubungkan…", () => testServer(s, result)));
  edit.addEventListener("click", () => openForm(s));
  del.addEventListener("click", async () => {
    if ((await api.servers.remove(s.id)).ok) {
      announce(`${s.name} dihapus.`);
      renderServers();
    }
  });
  const authText = s.auth === "key" ? "SSH key" : "Password";
  const saved = s.hasSavedPassword || s.hasSavedPassphrase;
  const previous = connectionResults.get(s.id);
  if (previous) showResult(result, s, previous, false);
  return el(
    "li",
    { cls: "server-card" },
    el("div", { cls: "server-card-top" }, el("span", { cls: "server-avatar" }, icon("server")), el("span", { text: "SSH", cls: "protocol-badge" }), el("div", { cls: "server-card-tools" }, edit, del)),
    el("div", { cls: "server-identity" }, el("h3", { text: s.name }), el("p", { text: `${s.host}:${s.port}`, cls: "server-address" })),
    el("div", { cls: "server-meta" }, el("span", { text: s.username, cls: "server-user" }), el("span", {}, icon(s.auth === "key" ? "key" : "lock"), authText), ...(saved ? [el("span", { attrs: { title: "Kredensial terenkripsi di perangkat ini" }, cls: "saved-credential" }, icon("shield"))] : [])),
    el("div", { cls: "server-card-actions" }, test, openBtn),
    result,
  );
}

function showResult(result, s, r, notify = true) {
  result.className = `connection-result ${r.ok ? "text-emerald-300" : "text-red-300"}`;
  result.replaceChildren(r.ok ? "✔ Tes berhasil. Autentikasi dan host key valid." : `✘ ${r.message}`);
  if (r.code === "HOSTKEY_CHANGED") {
    const forget = el("button", { text: "Lupakan fingerprint lama…", cls: "btn ml-3", attrs: { type: "button" } });
    forget.addEventListener("click", async () => {
      if ((await api.servers.forgetHostKey(s.id)).ok) {
        connectionResults.delete(s.id);
        result.className = "connection-result text-slate-300";
        result.textContent = "Fingerprint dilupakan. Hubungkan ulang untuk memverifikasi fingerprint baru.";
      }
    });
    result.append(forget);
  }
  if (notify) announce(r.ok ? `Terhubung ke ${s.name}.` : r.message);
}

async function testServer(s, result) {
  showError("");
  result.textContent = "";
  const r = await withCredentials(s, (creds) => api.servers.test(s.id, creds), app.canRemember);
  if (r) {
    connectionResults.set(s.id, r);
    showResult(result, s, r);
    await renderServers();
  }
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
    form["prometheus.host"].value = s.prometheus?.host ?? "";
    form["prometheus.port"].value = s.prometheus?.port ?? "";
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
    prometheus: { host: form["prometheus.host"].value, port: form["prometheus.port"].value },
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
      if (field.startsWith("nginx.") || field.startsWith("prometheus.")) input?.closest("details")?.setAttribute("open", "");
    }
    first?.focus();
    return;
  }
  $("server-dialog").close();
  connectionResults.delete(r.profile.id);
  announce(`${r.profile.name} disimpan.`);
  renderServers();
});

document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
$("add").addEventListener("click", () => openForm(null));
$("add-empty").addEventListener("click", () => openForm(null));
$("server-search").addEventListener("input", renderCollection);
$("clear-search").addEventListener("click", () => {
  $("server-search").value = "";
  renderCollection();
  $("server-search").focus();
});
for (const mode of ["grid", "list"]) {
  $(`${mode}-view`).addEventListener("click", () => {
    $("servers").classList.toggle("is-list", mode === "list");
    for (const option of ["grid", "list"]) {
      $(`${option}-view`).classList.toggle("is-active", option === mode);
      $(`${option}-view`).setAttribute("aria-pressed", String(option === mode));
    }
  });
}
