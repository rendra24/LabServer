// Semua teks dari main/server dirender lewat textContent, tidak pernah innerHTML.
const $ = (id) => document.getElementById(id);
const api = window.api;
let canRemember = false;

function el(tag, { text, cls, attrs } = {}, ...children) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  n.append(...children);
  return n;
}
const announce = (m) => ($("status").textContent = m);
function showError(m) {
  $("error").textContent = m;
  $("error").hidden = !m;
}

// ---------- daftar server ----------
async function render() {
  const servers = await api.servers.list();
  $("empty").hidden = servers.length > 0;
  $("servers").replaceChildren(...servers.map(card));
}

function card(s) {
  const result = el("p", { cls: "mt-2 min-h-5 text-sm", attrs: { role: "status" } });
  const test = el("button", { text: "Tes Koneksi", cls: "btn btn-primary", attrs: { type: "button" } });
  const edit = el("button", { text: "Ubah", cls: "btn", attrs: { type: "button" } });
  const del = el("button", { text: "Hapus", cls: "btn btn-danger", attrs: { type: "button", "aria-label": `Hapus ${s.name}` } });
  test.addEventListener("click", () => testConnection(s, test, result));
  edit.addEventListener("click", () => openForm(s));
  del.addEventListener("click", async () => {
    const r = await api.servers.remove(s.id);
    if (r.ok) {
      announce(`${s.name} dihapus.`);
      render();
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
      test, edit, del,
    ),
    result,
  );
}

// ---------- tes koneksi ----------
function askSecret({ kind, server, message }) {
  const d = $("secret-dialog");
  const isPass = kind === "password";
  $("secret-title").textContent = isPass ? "Password SSH" : "Passphrase private key";
  $("secret-label").textContent = isPass ? "Password" : "Passphrase";
  $("secret-desc").textContent = message || `${server.username}@${server.host}`;
  $("secret-input").value = "";
  $("remember").checked = false;
  $("remember-row").hidden = !canRemember;
  d.showModal();
  $("secret-input").focus();
  return new Promise((resolve) => {
    const form = $("secret-form");
    const done = (value) => {
      form.removeEventListener("submit", onSubmit);
      d.removeEventListener("close", onClose);
      d.close();
      resolve(value);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      done({ value: $("secret-input").value, remember: $("remember").checked });
    };
    const onClose = () => done(null);
    form.addEventListener("submit", onSubmit);
    d.addEventListener("close", onClose);
  });
}

async function testConnection(s, button, result) {
  showError("");
  const creds = {};
  for (let attempt = 0; attempt < 4; attempt++) {
    button.disabled = true;
    button.replaceChildren(el("span", { cls: "spinner", attrs: { "aria-hidden": "true" } }), "Menghubungkan…");
    result.textContent = "";
    const r = await api.servers.test(s.id, creds);
    button.textContent = "Tes Koneksi";
    button.disabled = false;
    if (r.ok) {
      result.className = "mt-2 min-h-5 text-sm text-emerald-300";
      result.textContent = "✔ Terhubung. Autentikasi dan host key valid.";
      announce(`Terhubung ke ${s.name}.`);
      return render();
    }
    const need = { NEED_PASSWORD: "password", AUTH_FAILED: s.auth === "password" ? "password" : null, NEED_PASSPHRASE: "passphrase", BAD_PASSPHRASE: "passphrase" }[r.code];
    if (need) {
      const message = r.code === "NEED_PASSWORD" || r.code === "NEED_PASSPHRASE" ? null : r.message;
      const answer = await askSecret({ kind: need, server: s, message });
      if (!answer) break;
      creds[need] = answer.value;
      creds.remember = answer.remember;
      continue;
    }
    result.className = "mt-2 min-h-5 text-sm text-red-300";
    result.replaceChildren(`✘ ${r.message}`);
    if (r.code === "HOSTKEY_CHANGED") {
      const forget = el("button", { text: "Lupakan fingerprint lama…", cls: "btn ml-3", attrs: { type: "button" } });
      forget.addEventListener("click", async () => {
        const f = await api.servers.forgetHostKey(s.id);
        if (f.ok) result.textContent = "Fingerprint dilupakan. Tes ulang untuk memverifikasi fingerprint baru.";
      });
      result.append(forget);
    }
    announce(r.message);
    return;
  }
  result.textContent = "";
}

// ---------- form server ----------
const form = $("server-form");
function setAuthUi() {
  $("key-row").hidden = form.auth.value !== "key";
}
form.querySelectorAll('input[name="auth"]').forEach((r) => r.addEventListener("change", setAuthUi));

function openForm(s) {
  form.reset();
  form.querySelectorAll(".err").forEach((p) => (p.textContent = ""));
  form.querySelectorAll("[aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
  $("server-title").textContent = s ? `Ubah ${s.name}` : "Tambah Server";
  form.id.value = s?.id || "";
  if (s) {
    for (const k of ["name", "host", "port", "username", "keyPath"]) if (form[k]) form[k].value = s[k] ?? "";
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
  const input = {
    id: form.id.value || undefined,
    name: form.name.value,
    host: form.host.value,
    port: form.port.value,
    username: form.username.value,
    auth: form.auth.value,
    keyPath: form.keyPath.value,
    nginx: Object.fromEntries(["available", "enabled", "nginxBin", "reload"].map((k) => [k, form[`nginx.${k}`].value])),
  };
  const r = await api.servers.save(input);
  form.querySelectorAll(".err").forEach((p) => (p.textContent = ""));
  form.querySelectorAll("[aria-invalid]").forEach((i) => i.removeAttribute("aria-invalid"));
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
  render();
});

document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
$("add").addEventListener("click", () => openForm(null));
$("add-empty").addEventListener("click", () => openForm(null));

api.info().then((i) => {
  canRemember = i.canRemember;
  $("version").textContent = `v${i.version}`;
});
render().catch((e) => showError(e.message));
