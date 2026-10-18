import { app, onShow, show } from "./app.js";
import "./editor.js";
import "./monitor.js";
import "./update.js";
import "./terminal.js";
import "./backup.js";
import { guardDnsChanges } from './dns.js';
import './system.js';
import './docker.js';
import './ssl.js';
import './tunnels.js';
import { guardFileChanges } from './files.js';
import { guardNginxClose } from './editor.js';
import { renderServers } from "./servers.js";
import "./sites.js";
import { $, askSecret, showError } from "./ui.js";
import { decorateIcons } from "./icons.js";
import "./theme.js";

decorateIcons();

function setSidebarHidden(hidden) {
  $("sidebar").hidden = hidden;
  document.documentElement.classList.toggle("sidebar-hidden", hidden);
  const label = hidden ? "Tampilkan sidebar" : "Sembunyikan sidebar";
  $("sidebar-toggle").setAttribute("aria-expanded", String(!hidden));
  $("sidebar-toggle").setAttribute("aria-label", label);
  $("sidebar-toggle").title = label;
  try { localStorage.setItem("labserver-sidebar-hidden", String(hidden)); } catch { /* Tampilan tetap berfungsi tanpa penyimpanan. */ }
  window.dispatchEvent(new Event("resize"));
}

let sidebarHidden = false;
try { sidebarHidden = localStorage.getItem("labserver-sidebar-hidden") === "true"; } catch { /* Gunakan tampilan default. */ }
setSidebarHidden(sidebarHidden);
$("sidebar-toggle").addEventListener("click", () => setSidebarHidden(!$("sidebar").hidden));

async function goToServers() {
  if (!$("view-editor").hidden) $("ed-back").click();
  if (!$("view-editor").hidden) return;
  if (app.server) {
    if (!await guardFileChanges() || !app.server) return;
    const result = await window.api.servers.disconnect(app.server.id);
    if (!result.ok) return;
    app.server = null;
  }
  show("servers");
}

function openServers() {
  if (!$("view-dns").hidden && app.server) show(app.serverView || 'monitor');
  else goToServers();
}
$("nav-servers").addEventListener("click", openServers);
$("server-disconnect").addEventListener("click", goToServers);
$("nav-dns").addEventListener("click", () => {
  if (!$("view-editor").hidden) $("ed-back").click();
  if (!$("view-editor").hidden) return;
  show('dns');
});
$("brand-home").addEventListener("click", (e) => { e.preventDefault(); openServers(); });
$("nav-terminal").addEventListener("click", () => {
  if (!$("view-editor").hidden) $("ed-back").click();
  if (!$("view-editor").hidden) return;
  if (app.server) show("terminal");
});
$("nav-files").addEventListener('click', () => {
  if (!$("view-editor").hidden) $("ed-back").click();
  if (!$("view-editor").hidden) return;
  if (app.server) show('files');
});
$("nav-monitor").addEventListener("click", () => {
  if (!$("view-editor").hidden) $("ed-back").click();
  if (!$("view-editor").hidden) return;
  if (app.server) show("monitor");
});
$("nav-sites").addEventListener("click", () => {
  if (!$("view-editor").hidden) $("ed-back").click();
  else if (app.server) show("sites");
});
for (const view of ['services', 'logs', 'docker', 'ssl', 'tunnels']) $(`nav-${view}`).addEventListener('click', () => {
  if (!$("view-editor").hidden) $("ed-back").click();
  if (!$("view-editor").hidden) return;
  if (app.server) show(view);
});
$("help").addEventListener("click", () => $("help-dialog").showModal());

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !$("view-servers").hidden && !document.querySelector("dialog[open]")) {
    e.preventDefault();
    $("server-search").focus();
  }
});
$("server-search").nextElementSibling.textContent = /Mac/.test(navigator.platform) ? "⌘ K" : "Ctrl K";

const sudoRequests = new Map();
window.api.onSudoAsk(async ({ requestId, server }) => {
  const controller = new AbortController();
  sudoRequests.set(requestId, controller);
  const answer = await askSecret({
    title: "Password sudo",
    label: "Password sudo",
    description: `Perintah ini butuh hak root di ${server}. Password hanya disimpan di memori selama sesi ini.`,
    allowRemember: false,
    submitLabel: "Lanjutkan",
    signal: controller.signal,
  });
  sudoRequests.delete(requestId);
  return answer?.value ?? null;
});
window.api.onSudoCancel(requestId => sudoRequests.get(requestId)?.abort());
window.api.onCloseRequest(async () => guardDnsChanges() && (await guardFileChanges()) && guardNginxClose());

onShow("servers", () => renderServers().catch((e) => showError(e.message)));

window.api.info().then((i) => {
  app.canRemember = i.canRemember;
  $("version").textContent = `v${i.version}`;
});
show("servers");
