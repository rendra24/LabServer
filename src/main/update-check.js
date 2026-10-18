// Pengecek versi baru lewat GitHub Releases (repo publik). Tidak mengunduh/memasang apa pun:
// aplikasi belum ditandatangani, jadi pembaruan dilakukan manual dari halaman rilis.
const TAG_PREFIX = "desktop-v";
const SEMVER = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/;
const SLUG = /^[A-Za-z0-9._-]+$/;

function parse(v) {
  const m = SEMVER.exec(String(v));
  if (!m) throw new Error(`Versi tidak valid: ${v}`);
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)], pre: m[4] ?? null };
}

/** -1 | 0 | 1. Prarilis lebih rendah dari rilis yang sama. */
function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/** {owner, repo} dari package.json (field repository), atau null bila belum diisi/placeholder. */
function parseRepo(pkg) {
  const raw = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (typeof raw !== "string") return null;
  const m = /^(?:github:|(?:git\+)?https:\/\/github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(raw.trim());
  if (!m) return null;
  const [, owner, repo] = m;
  if (!SLUG.test(owner) || !SLUG.test(repo) || owner === ".." || repo === ".." || owner === "OWNER") return null;
  return { owner, repo };
}

const err = (message) => ({ status: "error", message });

async function checkForUpdate({ current, repo, fetchImpl = fetch, timeoutMs = 8000 }) {
  if (!repo) return { status: "unconfigured", current };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=30`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "dashboard-server-desktop" },
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) return err("Repositori tidak ditemukan atau privat. Pengecekan otomatis hanya untuk repositori publik; unduh dari halaman Releases secara manual.");
      return err(`GitHub membalas status ${res.status}. Coba lagi nanti.`);
    }
    body = await res.json();
  } catch (e) {
    return err(e?.name === "AbortError" ? "Waktu pengecekan habis. Periksa koneksi internet." : "Tidak dapat menghubungi GitHub. Periksa koneksi internet.");
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(body)) return err("Jawaban GitHub tidak dikenali.");

  let best = null;
  for (const r of body) {
    if (!r || r.draft || r.prerelease || typeof r.tag_name !== "string" || !r.tag_name.startsWith(TAG_PREFIX)) continue;
    const version = r.tag_name.slice(TAG_PREFIX.length);
    if (!SEMVER.test(version)) continue;
    if (best === null || compareVersions(version, best.version) > 0) best = { version, tag: r.tag_name };
  }
  if (!best) return { status: "no-releases", current };
  if (compareVersions(best.version, current) <= 0) return { status: "up-to-date", current, latest: best.version };
  // URL dibangun dari repo+tag, bukan dipercaya dari respons.
  return { status: "available", current, latest: best.version, url: `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${best.tag}` };
}

module.exports = { checkForUpdate, compareVersions, parseRepo, TAG_PREFIX };
