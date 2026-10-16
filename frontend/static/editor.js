import { DOMAIN_RE, api, announce, clearError, showError, validFilename } from "/static/common.js";
import { replaceDomain } from "/static/clone.js";
import { appendLog, busy, runReload, runSyntaxTest } from "/static/diag.js";

const $ = (id) => document.getElementById(id);
const route = location.pathname.match(/^\/editor\/(new|\d+)$/);
let isNew = route?.[1] === "new";
let siteId = isNew ? null : Number(route?.[1]);
let baseline = "";
let baselineDomain = "";
let editor = null;
let cloneSource = null; // {filename, domain} bila halaman ini hasil clone
let syntaxValid = false; // hasil nginx -t terakhir, valid hanya untuk isi yang sudah tersimpan

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
  $("reload").disabled = !(syntaxValid && !dirty);
}

function invalidateSyntax() {
  syntaxValid = false;
  refreshState();
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
  editor.session.on("change", invalidateSyntax);
  return true;
}

function showCloneLink() {
  const link = $("clone-link");
  link.href = `/editor/new?from=${siteId}`;
  link.hidden = false;
}

async function loadClone(fromId) {
  setBaseline("", "");
  try {
    const src = await api(`/api/v1/sites/${fromId}`);
    cloneSource = { filename: src.filename, domain: src.domain_name };
    editor.setValue(src.content, -1); // baseline kosong: halaman langsung "Belum Disimpan"
    $("title").textContent = `Clone dari ${src.filename}`;
    $("clone-info").textContent = `Isi disalin dari ${src.filename} (domain ${src.domain_name}). Isi nama berkas dan domain baru, lalu ganti domain lama. Port dan path lain tetap perlu Anda sesuaikan; dua vhost dengan server_name yang sama akan memicu peringatan Nginx.`;
    $("clone-bar").hidden = false;
    $("domain").focus();
    announce(`Isi ${src.filename} disalin. Silakan ubah domain.`);
  } catch (e) {
    showError(`Tidak dapat memuat sumber clone: ${e.message}`);
  }
}

function applyDomainReplace() {
  const result = $("clone-result");
  const domain = $("domain").value.trim();
  if (fieldError("domain", domain && DOMAIN_RE.test(domain) ? "" : "Isi domain baru yang valid dulu (huruf, angka, titik, tanda hubung).")) {
    result.textContent = "";
    return $("domain").focus();
  }
  const { text, count } = replaceDomain(content(), cloneSource.domain, domain);
  if (!count) {
    result.textContent = `Domain lama (${cloneSource.domain}) tidak ditemukan di isi.`;
  } else {
    editor.setValue(text, -1);
    result.textContent = `${count} kemunculan ${cloneSource.domain} diganti dengan ${domain}.`;
    cloneSource.domain = domain; // klik berikutnya mengganti domain terbaru
  }
  if (!$("filename").value.trim() && validFilename(domain)) $("filename").value = domain;
  announce(result.textContent);
}

function updateNote(enabled) {
  const note = $("diag-note");
  note.hidden = enabled !== false;
  note.textContent = "Situs ini nonaktif: nginx -t tidak ikut menguji berkasnya sampai symlink diaktifkan.";
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
    showCloneLink();
    document.title = `${site.filename} · Dashboard Server`;
    setBaseline(site.content, site.domain_name);
    updateNote(site.is_enabled);
    announce(`${site.filename} dimuat.`);
  } catch (e) {
    $("title").textContent = "Editor Konfigurasi";
    showError(e.message);
    editor.setReadOnly(true);
    $("save").disabled = true;
  }
}

async function testSyntax() {
  const log = $("log");
  if (isDirty()) {
    appendLog(log, "Perhatian: ada perubahan belum disimpan. nginx -t hanya menguji berkas yang sudah ada di disk.", "text-amber-300");
  }
  syntaxValid = await runSyntaxTest(log, siteId);
  refreshState();
  announce(syntaxValid ? "Sintaks Nginx valid." : "Sintaks Nginx tidak valid.");
}

async function reload() {
  const ok = await runReload($("log"));
  syntaxValid = false; // kunci kembali setelah reload
  refreshState();
  announce(ok ? "Nginx berhasil di-reload." : "Reload Nginx gagal.");
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
      cloneSource = null;
      $("clone-bar").hidden = true;
      showCloneLink();
    } else {
      site = await api(`/api/v1/sites/${siteId}`, { method: "PUT", body: { content: text, domain_name: domain } });
    }
    baseline = text;
    baselineDomain = domain;
    invalidateSyntax(); // isi di disk berubah: tes ulang diperlukan
    updateNote(site.is_enabled);
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
  $("test").addEventListener("click", () => busy($("test"), "Menguji…", testSyntax).then(refreshState));
  $("reload").addEventListener("click", () => busy($("reload"), "Reload…", reload).then(refreshState));
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
  $("clone-replace").addEventListener("click", applyDomainReplace);
  if (isNew) {
    $("title").textContent = "Berkas Konfigurasi Baru";
    const from = Number(new URLSearchParams(location.search).get("from"));
    if (Number.isInteger(from) && from > 0) loadClone(from);
    else setBaseline("", "");
  } else {
    loadExisting();
  }
}

init();
