import { api, announce, clearError, showError } from "/static/common.js";

const $ = (id) => document.getElementById(id);
const route = location.pathname.match(/^\/editor\/(new|\d+)$/);
const isNew = route?.[1] === "new";
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

function init() {
  if (!route) {
    showError("Alamat editor tidak valid.");
    return;
  }
  $("filename").disabled = !isNew;
  if (!initEditor()) return;
  $("domain").addEventListener("input", refreshState);
  if (isNew) {
    $("title").textContent = "Berkas Konfigurasi Baru";
    setBaseline("", "");
  } else {
    loadExisting();
  }
}

init();
