const { checkForUpdate, parseRepo } = require("./update-check");

/** Izinkan hanya halaman rilis milik repo yang dikonfigurasi. */
function isReleaseUrl(url, repo) {
  return typeof url === "string" && url.startsWith(`https://github.com/${repo.owner}/${repo.repo}/releases/tag/`);
}

function registerUpdateIpc({ handle, dialog, winOf, shell, pkg = require("../../package.json"), check = checkForUpdate }) {
  handle("update:check", async (event) => {
    const repo = parseRepo(pkg);
    const result = await check({ current: pkg.version, repo });
    if (result.status === "available" && repo && isReleaseUrl(result.url, repo)) {
      const { response } = await dialog.showMessageBox(winOf(event), {
        type: "info",
        buttons: ["Nanti", "Buka halaman rilis"],
        defaultId: 1,
        cancelId: 0,
        message: `Versi ${result.latest} tersedia (Anda memakai ${result.current}).`,
        detail: "Unduh installer terbaru dari halaman rilis, lalu pasang di atas versi lama. Data server dan pengaturan Anda tetap tersimpan.",
      });
      if (response === 1) await shell.openExternal(result.url);
    }
    // Renderer hanya menerima status dan pesan, bukan URL.
    return { status: result.status, current: result.current, latest: result.latest, message: result.message };
  });
}

module.exports = { registerUpdateIpc, isReleaseUrl };
