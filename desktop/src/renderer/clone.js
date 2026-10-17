const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Ganti semua kemunculan domain `from` dengan `to` pada isi vhost.
 * Batas kiri/kanan: bukan huruf/angka/tanda hubung, sehingga "myapp.local" tidak ikut berubah
 * saat mengganti "app.local", tetapi "www.app.local" dan "app.local.access.log" ikut.
 */
export function replaceDomain(text, from, to) {
  if (!from || !to) return { text, count: 0 };
  const re = new RegExp(`(?<![A-Za-z0-9-])${escapeRe(from)}(?![A-Za-z0-9-])`, "gi");
  let count = 0;
  const out = text.replace(re, () => {
    count += 1;
    return to; // fungsi, agar "$&" dll. di `to` tidak ditafsirkan
  });
  return { text: out, count };
}

/** Nama pertama dari direktif server_name pertama yang bukan komentar. */
export function parseServerName(content) {
  for (const line of content.split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*server_name\s+([^;]+);/);
    if (m) return m[1].trim().split(/\s+/)[0];
  }
  return "";
}
