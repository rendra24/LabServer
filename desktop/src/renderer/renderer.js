import { app, onShow, show } from "./app.js";
import "./editor.js";
import { renderServers } from "./servers.js";
import "./sites.js";
import { $, askSecret, showError } from "./ui.js";

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
