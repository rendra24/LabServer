const { checkForUpdate, parseRepo } = require("./update-check");

/** Izinkan hanya halaman rilis milik repo yang dikonfigurasi. */
function isReleaseUrl(url, repo) {
  return typeof url === "string" && url.startsWith(`https://github.com/${repo.owner}/${repo.repo}/releases/tag/`);
}

function registerUpdateIpc({ handle, dialog, winOf, shell, pkg = require("../../package.json"), check = checkForUpdate, installer = null }) {
  handle("update:check", async (event) => {
    const repo = parseRepo(pkg);
    const result = await check({ current: pkg.version, repo });
    if (result.status === "available" && repo && isReleaseUrl(result.url, repo)) {
      const release = { owner: repo.owner, repo: repo.repo, tag: result.tag, version: result.latest, assets: result.assets ?? [] };
      const canInstall = installer ? (await installer.supported(release)).ok === true : false;
      const { response } = await dialog.showMessageBox(winOf(event), {
        type: "info",
        buttons: canInstall ? ["Nanti", "Buka halaman rilis", "Perbarui sekarang"] : ["Nanti", "Buka halaman rilis"],
        defaultId: canInstall ? 2 : 1,
        cancelId: 0,
        message: `Versi ${result.latest} tersedia (Anda memakai ${result.current}).`,
        detail: canInstall
          ? "Perbarui sekarang mengunduh versi baru, memverifikasinya, lalu membuka ulang aplikasi. Sesi SSH dan terminal yang aktif akan berakhir. Data server dan pengaturan Anda tetap tersimpan."
          : "Unduh installer terbaru dari halaman rilis, lalu pasang di atas versi lama. Data server dan pengaturan Anda tetap tersimpan.",
      });
      if (response === 1) await shell.openExternal(result.url);
      if (response === 2 && canInstall) {
        const sender = event.sender;
        const done = await installer.install(release, (progress) => { if (sender && !sender.isDestroyed?.()) sender.send("update:progress", progress); });
        return done.ok
          ? { status: "restarting", current: result.current, latest: result.latest }
          : { status: "error", current: result.current, latest: result.latest, message: done.message };
      }
    }
    // Renderer hanya menerima status dan pesan, bukan URL.
    return { status: result.status, current: result.current, latest: result.latest, message: result.message };
  });
}

module.exports = { registerUpdateIpc, isReleaseUrl };
