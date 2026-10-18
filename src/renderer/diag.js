import { appendLog, busy } from "./ui.js";

/**
 * Panel Test/Reload. Reload hanya aktif setelah nginx -t lolos dan belum ada perubahan sesudahnya.
 * Gerbang sebenarnya ada di main process (reload selalu menjalankan nginx -t ulang).
 */
export function createDiag({ testBtn, reloadBtn, log }, { serverId, isDirty = () => false, state }) {
  const refresh = () => {
    reloadBtn.disabled = !(state.syntaxValid && !isDirty());
  };

  async function runTest() {
    if (isDirty()) appendLog(log, "Perhatian: ada perubahan belum disimpan; nginx -t menguji berkas di server.", "text-amber-300");
    appendLog(log, "$ sudo nginx -t", "text-sky-300");
    const r = await window.api.sites(serverId(), "test");
    if (!r.ok) {
      state.syntaxValid = false;
      appendLog(log, `✘ ${r.message}`, "text-red-300");
    } else {
      state.syntaxValid = r.data.ok;
      if (r.data.output) appendLog(log, r.data.output, r.data.ok ? "text-emerald-300" : "text-orange-300");
      appendLog(log, r.data.ok ? "✔ Sintaks valid" : "✘ Sintaks tidak valid", r.data.ok ? "text-emerald-300" : "text-red-300");
    }
    refresh();
  }

  async function runReload() {
    appendLog(log, "$ reload nginx (didahului nginx -t)", "text-sky-300");
    const r = await window.api.sites(serverId(), "reload");
    if (!r.ok) appendLog(log, `✘ ${r.message}`, "text-red-300");
    else if (r.data.blocked) appendLog(log, `✘ Reload dibatalkan: sintaks tidak valid.\n${r.data.output}`, "text-red-300");
    else if (!r.data.ok) appendLog(log, `✘ Reload gagal.\n${r.data.output}`, "text-red-300");
    else appendLog(log, "✔ Nginx berhasil di-reload.", "text-emerald-300");
    state.syntaxValid = false; // kunci kembali setelah reload
    refresh();
  }

  testBtn.addEventListener("click", () => busy(testBtn, "Menguji…", runTest).then(refresh));
  reloadBtn.addEventListener("click", () => busy(reloadBtn, "Reload…", runReload).then(refresh));
  return { refresh };
}
