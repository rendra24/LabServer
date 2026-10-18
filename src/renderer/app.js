// State bersama antar-view dan navigasi workspace.
export const app = {
  server: null, // profil server yang sedang dibuka
  syntaxValid: false, // hasil nginx -t terakhir masih berlaku (direset oleh setiap perubahan)
  canRemember: false,
};

const VIEWS = ["servers", "sites", "editor", "monitor", "terminal", "files", "services", "logs", "docker", "ssl", "tunnels", "dns"];
const listeners = {};
const leavers = {};
let current = null;

export function show(view, params) {
  if (current && current !== view) leavers[current]?.();
  current = view;
  for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
  const connected = Boolean(app.server);
  if (!['servers', 'dns'].includes(view)) app.serverView = view;
  document.getElementById("server-workspace").hidden = !connected || ['servers', 'dns'].includes(view);
  document.getElementById("current-view").textContent = { servers: "Server", sites: "Konfigurasi Nginx", editor: "Editor konfigurasi", monitor: "Dashboard monitoring", terminal: "Terminal", files: "File manager", services: 'Service Manager', logs: 'Log Viewer', docker: 'Docker Manager', ssl: 'SSL Manager', tunnels: 'Port Forwarding', dns: "DNS Management" }[view];
  for (const name of ["servers", "monitor", "terminal", "sites", "files", "services", "logs", "docker", "ssl", "tunnels", "dns"]) {
    const nav = document.getElementById(`nav-${name}`);
    nav.disabled = !['servers', 'dns'].includes(name) && !connected;
    const active = name === view || (name === "sites" && view === "editor");
    nav.classList.toggle("is-active", (name === "servers" && view !== 'dns') || active);
    if (active) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
    if (active && nav.classList.contains('server-tab')) nav.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  document.getElementById("server-session").hidden = !connected;
  document.getElementById("server-disconnect").disabled = !connected;
  document.getElementById("session-name").textContent = app.server?.name || "";
  document.getElementById("session-host").textContent = app.server ? `${app.server.username}@${app.server.host}:${app.server.port || 22}` : "";
  const status = document.getElementById("connection-status");
  status.classList.toggle("is-connected", connected);
  status.lastChild.textContent = connected ? "Sesi SSH aktif" : "Workspace lokal";
  listeners[view]?.(params);
  if (!params?.preserve) document.getElementById(`view-${view}`).querySelector("h1")?.focus();
}

export const onShow = (view, fn) => (listeners[view] = fn);
export const onLeave = (view, fn) => (leavers[view] = fn);

/** Setiap perubahan di server membatalkan hasil nginx -t sebelumnya. */
export const invalidateSyntax = () => (app.syntaxValid = false);

// Keep the selected server tool visible when the window becomes narrower.
window.addEventListener("resize", () => requestAnimationFrame(() => {
  if (document.getElementById("server-workspace").hidden) return;
  const nav = document.querySelector(".server-nav"), active = nav.querySelector('[aria-current="page"]');
  if (!active) return;
  const bounds = nav.getBoundingClientRect(), item = active.getBoundingClientRect();
  if (item.left < bounds.left) nav.scrollLeft += Math.floor(item.left - bounds.left);
  else if (item.right > bounds.right) nav.scrollLeft += Math.ceil(item.right - bounds.right);
}));
