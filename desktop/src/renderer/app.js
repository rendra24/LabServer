// State bersama antar-view dan navigasi sederhana (satu halaman, tiga view).
export const app = {
  server: null, // profil server yang sedang dibuka
  syntaxValid: false, // hasil nginx -t terakhir masih berlaku (direset oleh setiap perubahan)
  canRemember: false,
};

const VIEWS = ["servers", "sites", "editor", "monitor"];
const listeners = {};
const leavers = {};
let current = null;

export function show(view, params) {
  if (current && current !== view) leavers[current]?.();
  current = view;
  for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
  const connected = Boolean(app.server);
  document.getElementById("current-view").textContent = { servers: "Server", sites: "Konfigurasi Nginx", editor: "Editor konfigurasi", monitor: "Monitoring" }[view];
  document.getElementById("nav-sites").disabled = !connected;
  for (const name of ["servers", "sites"]) {
    const nav = document.getElementById(`nav-${name}`);
    const active = name === "servers" ? view === "servers" : view !== "servers";
    nav.classList.toggle("is-active", active);
    if (active) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  }
  document.getElementById("sidebar-session").hidden = !connected;
  document.getElementById("session-name").textContent = app.server?.name || "";
  document.getElementById("session-host").textContent = app.server ? `${app.server.username}@${app.server.host}` : "";
  const status = document.getElementById("connection-status");
  status.classList.toggle("is-connected", connected);
  status.lastChild.textContent = connected ? "Sesi SSH aktif" : "Workspace lokal";
  listeners[view]?.(params);
  document.getElementById(`view-${view}`).querySelector("h1")?.focus();
}

export const onShow = (view, fn) => (listeners[view] = fn);
export const onLeave = (view, fn) => (leavers[view] = fn);

/** Setiap perubahan di server membatalkan hasil nginx -t sebelumnya. */
export const invalidateSyntax = () => (app.syntaxValid = false);
