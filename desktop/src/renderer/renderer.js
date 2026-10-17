import { app, onShow, show } from "./app.js";
import "./editor.js";
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

function goToServers() {
  if (!$("view-editor").hidden) $("ed-back").click();
  if (!$("view-editor").hidden) return;
  if (app.server) $("sites-back").click();
  else show("servers");
}

$("nav-servers").addEventListener("click", goToServers);
$("brand-home").addEventListener("click", (e) => { e.preventDefault(); goToServers(); });
$("nav-sites").addEventListener("click", () => {
  if (!$("view-editor").hidden) $("ed-back").click();
  else if (app.server) show("sites");
});
$("help").addEventListener("click", () => $("help-dialog").showModal());

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !$("view-servers").hidden && !document.querySelector("dialog[open]")) {
    e.preventDefault();
    $("server-search").focus();
  }
});
$("server-search").nextElementSibling.textContent = /Mac/.test(navigator.platform) ? "⌘ K" : "Ctrl K";

window.api.onSudoAsk(async ({ server }) => {
  const answer = await askSecret({
    title: "Password sudo",
    label: "Password sudo",
    description: `Perintah ini butuh hak root di ${server}. Password hanya disimpan di memori selama sesi ini.`,
    allowRemember: false,
    submitLabel: "Lanjutkan",
  });
  return answer?.value ?? null;
});

onShow("servers", () => renderServers().catch((e) => showError(e.message)));

window.api.info().then((i) => {
  app.canRemember = i.canRemember;
  $("version").textContent = `v${i.version}`;
});
show("servers");
