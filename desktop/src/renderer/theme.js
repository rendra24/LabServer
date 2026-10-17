const root = document.documentElement;
let stored;
try { stored = localStorage.getItem("labserver-theme"); } catch { /* Preferensi tidak tersedia di sesi ini. */ }
const preference = stored === "light" || stored === "dark" ? stored : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

export function setTheme(theme) {
  root.dataset.theme = theme;
  root.classList.toggle("scheme-dark", theme === "dark");
  root.classList.toggle("scheme-light", theme === "light");
  for (const choice of ["light", "dark"]) {
    const button = document.getElementById(`theme-${choice}`);
    button?.setAttribute("aria-pressed", String(theme === choice));
  }
  try { localStorage.setItem("labserver-theme", theme); } catch { /* Tema tetap berlaku tanpa penyimpanan. */ }
  document.dispatchEvent(new CustomEvent("theme-change", { detail: theme }));
}

setTheme(preference);
for (const theme of ["light", "dark"]) {
  document.getElementById(`theme-${theme}`).addEventListener("click", () => setTheme(theme));
}
