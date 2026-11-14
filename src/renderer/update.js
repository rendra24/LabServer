// Tombol "Periksa pembaruan" di sidebar. Pembaruan dipasang dari dialog sistem ("Perbarui sekarang") atau manual dari halaman rilis.
import { announce } from "./ui.js";

const MESSAGES = {
  "up-to-date": (r) => `Sudah versi terbaru (${r.current}).`,
  "no-releases": () => "Belum ada rilis yang dipublikasikan.",
  unconfigured: () => "Alamat repositori GitHub belum diatur di package.json.",
  available: (r) => `Versi ${r.latest} tersedia.`,
  restarting: (r) => `Memasang versi ${r.latest}. Aplikasi akan dibuka ulang.`,
};
const PHASES = {
  download: (p) => (p.percent == null ? "Mengunduh pembaruan…" : `Mengunduh ${p.percent}%`),
  verify: () => "Memverifikasi…",
  install: () => "Menyiapkan…",
  restart: () => "Membuka ulang…",
};

const host = document.querySelector(".sidebar-version");
if (host) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Periksa pembaruan";
  button.className = "sidebar-update";
  button.style.cssText = "background:none;border:0;padding:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer;opacity:.8";
  const original = button.textContent;
  window.api.onUpdateProgress((p) => { button.textContent = PHASES[p?.phase]?.(p) ?? button.textContent; });
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Memeriksa…";
    try {
      const r = await window.api.checkUpdate();
      const text = r.status === "error" ? r.message : (MESSAGES[r.status]?.(r) ?? "Status pembaruan tidak dikenal.");
      announce(text);
      button.textContent = r.status === "available" ? `Versi ${r.latest} tersedia` : r.status === "up-to-date" ? "Sudah terbaru" : r.status === "restarting" ? "Membuka ulang…" : original;
      button.title = text;
    } catch {
      button.textContent = original;
      announce("Pengecekan pembaruan gagal.");
    } finally {
      button.disabled = false;
    }
  });
  host.append(button);
}
