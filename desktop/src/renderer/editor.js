import { app, invalidateSyntax, onShow, show } from "./app.js";
import { parseServerName, replaceDomain } from "./clone.js";
import { createDiag } from "./diag.js";
import { $, DOMAIN_RE, announce, busy, showError, validFilename } from "./ui.js";

const api = window.api;
let mode = "edit"; // edit | new | clone
let name = null; // nama berkas yang sedang disunting (mode edit)
let baseline = "";
let editor = null;

const isDirty = () => Boolean(editor) && (mode !== "edit" || editor.getValue() !== baseline);

const diag = createDiag(
  { testBtn: $("ed-test"), reloadBtn: $("ed-reload"), log: $("ed-log") },
  { serverId: () => app.server.id, isDirty, state: app },
);

function refreshState() {
  const dirty = isDirty();
  const b = $("ed-state");
  b.textContent = dirty ? "Belum Disimpan" : "Tersimpan";
  b.className = `inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${dirty ? "bg-amber-900 text-amber-100" : "bg-emerald-900 text-emerald-100"}`;
  diag.refresh();
}

function ensureEditor() {
  if (editor) return;
  const ace = window.ace;
  ace.config.set("useStrictCSP", true); // CSS dari berkas lokal, bukan <style> inline
  ace.config.set("basePath", "vendor/ace");
  editor = ace.edit("ed-editor", {
    mode: "ace/mode/nginx",
    theme: document.documentElement.dataset.theme === "light" ? "ace/theme/tomorrow" : "ace/theme/tomorrow_night",
    tabSize: 4,
    useSoftTabs: true,
    showPrintMargin: false,
    fontSize: 14,
    useWorker: false,
    enableKeyboardAccessibility: true,
  });
  editor.session.on("change", () => {
    invalidateSyntax();
    refreshState();
  });
  editor.commands.addCommand({ name: "save", bindKey: { win: "Ctrl-S", mac: "Command-S" }, exec: () => save() });
}

function fieldError(id, msg) {
  $(`${id}-err`).textContent = msg;
  if (msg) $(id).setAttribute("aria-invalid", "true");
  else $(id).removeAttribute("aria-invalid");
  return Boolean(msg);
}

function setMode(next, fileName) {
  mode = next;
  name = fileName;
  $("ed-filename").value = next === "edit" ? fileName : "";
  $("ed-filename").readOnly = next === "edit";
  $("ed-clone").hidden = next !== "clone";
  fieldError("ed-filename", "");
}

async function open(params) {
  showError("");
  ensureEditor();
  $("ed-clone-result").textContent = "";
  $("ed-log").replaceChildren();
  editor.setReadOnly(true);
  editor.setValue("Memuat berkas konfigurasi...", -1);
  if (params.mode === "new") {
    setMode("new", null);
    $("ed-title").textContent = "Konfigurasi Baru";
    baseline = "";
    editor.setValue("", -1);
  } else {
    const fileName = params.mode === "edit" ? params.name : params.source;
    const r = await api.sites(app.server.id, "read", fileName);
    if (!r.ok) {
      showError(r.message);
      return show("sites");
    }
    if (params.mode === "edit") {
      setMode("edit", fileName);
      $("ed-title").textContent = `Sunting ${fileName}`;
      baseline = r.data;
    } else {
      setMode("clone", null);
      $("ed-title").textContent = `Clone dari ${fileName}`;
      $("ed-old-domain").value = parseServerName(r.data);
      $("ed-new-domain").value = "";
      baseline = "";
    }
    editor.setValue(r.data, -1);
  }
  editor.setReadOnly(false);
  invalidateSyntax();
  refreshState();
  (mode === "edit" ? editor : $("ed-filename")).focus();
}

let saving = false;

async function save() {
  if (saving) return;
  showError("");
  const content = editor.getValue();
  if (!content.trim()) return showError("Isi konfigurasi tidak boleh kosong.");
  const target = mode === "edit" ? name : $("ed-filename").value.trim();
  if (mode !== "edit" && fieldError("ed-filename", validFilename(target) ? "" : "Nama berkas hanya huruf, angka, titik, garis bawah, tanda hubung; tidak diawali titik/tanda hubung.")) {
    return $("ed-filename").focus();
  }
  saving = true;
  await busy($("ed-save"), "Menyimpan…", async () => {
    const r = await api.sites(app.server.id, mode === "edit" ? "write" : "create", target, content);
    if (!r.ok) {
      showError(`Gagal menyimpan: ${r.message}`);
      announce("Gagal menyimpan.");
      return;
    }
    setMode("edit", target);
    $("ed-title").textContent = `Sunting ${target}`;
    baseline = content;
    invalidateSyntax();
    announce(`${target} tersimpan di server.`);
  }).finally(() => (saving = false));
  refreshState();
}

function replaceInContent() {
  const oldD = $("ed-old-domain").value.trim();
  const newD = $("ed-new-domain").value.trim();
  if (fieldError("ed-new-domain", newD && DOMAIN_RE.test(newD) ? "" : "Isi domain baru yang valid.")) return $("ed-new-domain").focus();
  const { text, count } = replaceDomain(editor.getValue(), oldD, newD);
  if (!count) {
    $("ed-clone-result").textContent = `"${oldD}" tidak ditemukan di isi.`;
  } else {
    editor.setValue(text, -1);
    $("ed-clone-result").textContent = `${count} kemunculan ${oldD} diganti dengan ${newD}.`;
    $("ed-old-domain").value = newD;
  }
  if (!$("ed-filename").value.trim() && validFilename(newD)) $("ed-filename").value = newD;
  announce($("ed-clone-result").textContent);
}

$("ed-save").addEventListener("click", save);
$("ed-replace").addEventListener("click", replaceInContent);
$("ed-back").addEventListener("click", () => {
  if (isDirty() && !window.confirm("Ada perubahan yang belum disimpan. Tinggalkan editor?")) return;
  show("sites");
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s" && !$("view-editor").hidden) {
    e.preventDefault();
    save();
  }
});

onShow("editor", open);
document.addEventListener("theme-change", (e) => {
  editor?.setTheme(e.detail === "light" ? "ace/theme/tomorrow" : "ace/theme/tomorrow_night");
});
