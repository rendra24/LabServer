import { DOMAIN_RE, api, announce, clearError, showError, validFilename } from "/static/common.js";

const $ = (id) => document.getElementById(id);
const route = location.pathname.match(/^\/editor\/(new|\d+)$/);
let isNew = route?.[1] === "new";
let siteId = isNew ? null : Number(route?.[1]);
let baseline = "";
let baselineDomain = "";
let editor = null;

function content() {
  return editor.getValue();
}

function isDirty() {
  return content() !== baseline || $("domain").value !== baselineDomain;
}

function refreshState() {
  const dirty = isDirty();
  const badge = $("state");
  badge.textContent = dirty ? "Belum Disimpan" : "Tersimpan";
  badge.className = `badge ${dirty ? "bg-amber-900 text-amber-100" : "bg-emerald-900 text-emerald-100"}`;
}

function initEditor() {
  if (!window.ace) {
    $("editor").textContent = "Editor gagal dimuat (CDN tidak terjangkau). Muat ulang halaman.";
    showError("Editor tidak dapat dimuat. Periksa koneksi internet lalu muat ulang halaman.");
    return false;
  }
  $("editor").textContent = "";
  editor = ace.edit("editor");
  editor.setTheme("ace/theme/tomorrow_night");
  editor.session.setMode("ace/mode/nginx");
  editor.setOptions({
    tabSize: 4,
    useSoftTabs: true,
    showPrintMargin: false,
    fontSize: 14,
    enableKeyboardAccessibility: true,
  });
  editor.session.on("change", refreshState);
  return true;
}

function setBaseline(text, domain) {
  baseline = text;
  baselineDomain = domain;
  editor.setValue(text, -1);
  $("domain").value = domain;
  refreshState();
}

async function loadExisting() {
  $("title").textContent = "Memuat…";
  try {
    const site = await api(`/api/v1/sites/${siteId}`);
    $("filename").value = site.filename;
    $("title").textContent = `Sunting ${site.filename}`;
    document.title = `${site.filename} · Dashboard Server`;
    setBaseline(site.content, site.domain_name);
    announce(`${site.filename} dimuat.`);
  } catch (e) {
    $("title").textContent = "Editor Konfigurasi";
    showError(e.message);
    editor.setReadOnly(true);
    $("save").disabled = true;
  }
}

function fieldError(field, message) {
  $(`${field}-err`).textContent = message;
  $(field).toggleAttribute("aria-invalid", Boolean(message));
  if (!message) $(field).removeAttribute("aria-invalid");
  return Boolean(message);
}

function validate() {
  let bad = false;
  if (isNew && fieldError("filename", validFilename($("filename").value) ? "" : "Nama berkas hanya boleh menggunakan huruf, angka, titik, garis bawah, dan tanda hubung (tidak boleh diawali titik).")) bad = true;
  const domain = $("domain").value.trim();
  if (fieldError("domain", domain && DOMAIN_RE.test(domain) ? "" : "Domain wajib diisi dan hanya boleh berisi huruf, angka, titik, dan tanda hubung.")) bad = true;
  if (!content().trim()) {
    showError("Isi konfigurasi Nginx tidak boleh kosong.");
    bad = true;
  }
  if (bad) (document.querySelector("[aria-invalid]") || editor).focus();
  return !bad;
}

function setSaving(on) {
  const b = $("save");
  b.disabled = on;
  b.replaceChildren(
    ...(on
      ? [Object.assign(document.createElement("span"), { className: "spinner", ariaHidden: "true" }), "Menyimpan…"]
      : ["Simpan Berkas"]),
  );
}

let saving = false;

async function save() {
  if (saving || !siteId && !isNew) return;
  clearError();
  if (!validate()) return;
  saving = true;
  setSaving(true);
  const text = content();
  const domain = $("domain").value.trim();
  try {
    let site;
    if (isNew) {
      site = await api("/api/v1/sites", {
        method: "POST",
        body: { filename: $("filename").value, content: text, domain_name: domain },
      });
      siteId = site.id;
      isNew = false;
      $("filename").disabled = true;
      $("title").textContent = `Sunting ${site.filename}`;
      history.replaceState(null, "", `/editor/${site.id}`);
    } else {
      site = await api(`/api/v1/sites/${siteId}`, { method: "PUT", body: { content: text, domain_name: domain } });
    }
    baseline = text;
    baselineDomain = domain;
    refreshState();
    announce(`${site.filename} berhasil disimpan.`);
  } catch (e) {
    showError(`Gagal menyimpan: ${e.message}`);
    announce("Gagal menyimpan berkas.");
  } finally {
    saving = false;
    setSaving(false);
  }
}

function init() {
  if (!route) {
    showError("Alamat editor tidak valid.");
    return;
  }
  $("filename").disabled = !isNew;
  if (!initEditor()) return;
  $("domain").addEventListener("input", refreshState);
  $("meta").addEventListener("submit", (e) => {
    e.preventDefault();
    save();
  });
  editor.commands.addCommand({
    name: "save",
    bindKey: { win: "Ctrl-S", mac: "Command-S" },
    exec: save,
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      save();
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (isDirty()) e.preventDefault();
  });
  if (isNew) {
    $("title").textContent = "Berkas Konfigurasi Baru";
    setBaseline("", "");
  } else {
    loadExisting();
  }
}

init();
