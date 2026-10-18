// Tombol "Periksa pembaruan" di sidebar. Pengecekan manual; installer diunduh dari halaman rilis.
import { announce } from "./ui.js";

const MESSAGES = {
  "up-to-date": (r) => `Sudah versi terbaru (${r.current}).`,
  "no-releases": () => "Belum ada rilis yang dipublikasikan.",
  unconfigured: () => "Alamat repositori GitHub belum diatur di package.json.",
  available: (r) => `Versi ${r.latest} tersedia.`,
};

const host = document.querySelector(".sidebar-version");
if (host) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Periksa pembaruan";
  button.className = "sidebar-update";
  button.style.cssText = "background:none;border:0;padding:0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer;opacity:.8";
  const original = button.textContent;
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Memeriksa…";
    try {
      const r = await window.api.checkUpdate();
      const text = r.status === "error" ? r.message : (MESSAGES[r.status]?.(r) ?? "Status pembaruan tidak dikenal.");
      announce(text);
      button.textContent = r.status === "available" ? `Versi ${r.latest} tersedia` : r.status === "up-to-date" ? "Sudah terbaru" : original;
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
