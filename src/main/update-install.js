// Pembaruan di dalam aplikasi (macOS, tanpa code signing Apple).
// Alur: unduh DMG dari Release repo sendiri -> cocokkan SHA256 -> mount -> salin ke samping aplikasi terpasang ->
// verifikasi tanda tangan, bundle id, dan versi -> skrip terpisah menukar folder .app setelah aplikasi keluar.
// Semua langkah berisiko dikerjakan selagi aplikasi masih hidup agar kegagalan tampil di UI.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { execFile, spawn: nodeSpawn } = require('node:child_process');

const MAX_DMG = 600 * 1024 * 1024;
const MAX_SUMS = 64 * 1024;
const ASSETS = { arm64: 'LabServer-macOS-arm64.dmg', x64: 'LabServer-macOS-x64.dmg' };
const SUMS = 'SHA256SUMS.txt';
const TRUSTED_HOSTS = [/^github\.com$/, /(^|\.)githubusercontent\.com$/];

class UpdateError extends Error {}
const fail = (message) => new UpdateError(message);

const assetName = (arch) => ASSETS[arch] || null;

function parseChecksums(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m) map.set(m[2], m[1].toLowerCase());
  }
  return map;
}

const appBundleFromExe = (exe) => /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(String(exe))?.[1] ?? null;

const downloadUrl = ({ owner, repo, tag }, name) => `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}/${name}`;

function trusted(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && TRUSTED_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

async function get(fetchImpl, url, signal) {
  let res;
  try { res = await fetchImpl(url, { headers: { 'User-Agent': 'dashboard-server-desktop' }, signal, redirect: 'follow' }); }
  catch (e) { throw fail(e?.name === 'AbortError' ? 'Unduhan dibatalkan.' : 'Tidak dapat mengunduh dari GitHub. Periksa koneksi internet.'); }
  if (!trusted(res.url || url)) throw fail('Unduhan dialihkan ke host yang tidak tepercaya dan dibatalkan.');
  if (!res.ok) throw fail(`GitHub membalas status ${res.status} saat mengunduh pembaruan.`);
  return res;
}

async function downloadVerified({ release, name, dir, fetchImpl = fetch, onProgress = () => {}, signal }) {
  if (!Object.values(ASSETS).includes(name)) throw fail('Nama installer tidak dikenal.');
  const sumsRes = await get(fetchImpl, downloadUrl(release, SUMS), signal);
  const sumsText = await sumsRes.text();
  if (sumsText.length > MAX_SUMS) throw fail('Berkas checksum tidak wajar besarnya.');
  const expected = parseChecksums(sumsText).get(name);
  if (!expected) throw fail('Checksum untuk installer tidak ditemukan di rilis ini.');

  const res = await get(fetchImpl, downloadUrl(release, name), signal);
  const total = Number(res.headers?.get?.('content-length')) || 0;
  if (total > MAX_DMG) throw fail('Installer terlalu besar dan tidak diunduh.');
  const dest = path.join(dir, name);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 });
  let received = 0;
  try {
    for await (const chunk of res.body) {
      received += chunk.length;
      if (received > MAX_DMG) throw fail('Installer terlalu besar dan unduhan dihentikan.');
      hash.update(chunk);
      if (!out.write(chunk)) await once(out, 'drain');
      onProgress({ received, total });
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (e) {
    out.destroy();
    await fsp.rm(dest, { force: true });
    throw e instanceof UpdateError ? e : fail('Unduhan terputus sebelum selesai.');
  }
  if (hash.digest('hex') !== expected) {
    await fsp.rm(dest, { force: true });
    throw fail('Checksum installer tidak cocok. Unduhan dibatalkan.');
  }
  return dest;
}

const run = (cmd, args, options = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 120000, maxBuffer: 1 << 20, ...options }, (error, stdout, stderr) => (error ? reject(error) : resolve({ stdout, stderr })));
});

const plist = async (runner, file, key) => (await runner('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file])).stdout.trim();

async function stageUpdate({ dmgPath, target, workDir, expected, run: runner = run }) {
  const mount = path.join(workDir, 'mnt');
  const staged = `${target}.update`;
  await fsp.mkdir(mount, { recursive: true, mode: 0o700 });
  let attached = false;
  try {
    try {
      await runner('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noverify', '-noautoopen', '-mountpoint', mount, dmgPath]);
      attached = true;
    } catch { throw fail('Installer tidak dapat dibuka (hdiutil gagal).'); }
    const source = path.join(mount, 'LabServer.app');
    if (!fs.existsSync(source)) throw fail('Installer tidak memuat LabServer.app.');
    await fsp.rm(staged, { recursive: true, force: true });
    try { await runner('/usr/bin/ditto', [source, staged]); }
    catch { throw fail('Aplikasi baru tidak dapat disalin. Periksa ruang disk dan izin folder.'); }
    try { await runner('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]); }
    catch { throw fail('Tanda tangan aplikasi baru tidak valid. Pembaruan dibatalkan.'); }
    const info = path.join(staged, 'Contents', 'Info.plist');
    if ((await plist(runner, info, 'CFBundleIdentifier')) !== expected.id) throw fail('Identitas aplikasi baru tidak cocok. Pembaruan dibatalkan.');
    if ((await plist(runner, info, 'CFBundleShortVersionString')) !== expected.version) throw fail('Versi aplikasi di installer tidak sama dengan versi rilis. Pembaruan dibatalkan.');
    await runner('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', staged]).catch(() => {});
    return staged;
  } catch (e) {
    await fsp.rm(staged, { recursive: true, force: true });
    throw e instanceof UpdateError ? e : fail('Aplikasi baru tidak dapat disiapkan.');
  } finally {
    if (attached) await runner('/usr/bin/hdiutil', ['detach', '-force', mount]).catch(() => {});
  }
}

// Argumen posisi: pid target staged backup work [pembuka=open] [batas-tunggu=900]. Path tidak pernah disisipkan ke teks skrip.
const SWAP_SCRIPT = `pid="$1"; target="$2"; staged="$3"; backup="$4"; work="$5"; opener="\${6:-open}"; limit="\${7:-900}"
n=0
while kill -0 "$pid" 2>/dev/null; do
  n=$((n+1))
  if [ "$n" -gt "$limit" ]; then rm -rf "$staged" "$work"; exit 1; fi
  sleep 0.2
done
rm -rf "$backup"
if mv "$target" "$backup"; then
  if mv "$staged" "$target"; then rm -rf "$backup"; else mv "$backup" "$target"; fi
fi
rm -rf "$staged" "$work"
"$opener" "$target"
`;

function launchSwap({ spawn = nodeSpawn, pid, target, staged, workDir }) {
  const child = spawn('/bin/sh', ['-c', SWAP_SCRIPT, 'sh', String(pid), target, staged, `${target}.old`, workDir], { detached: true, stdio: 'ignore' });
  child.unref();
}

function createUpdater({ app, pkg, platform = process.platform, arch = process.arch, pid = process.pid, exePath = process.execPath, fetchImpl = fetch, run: runner = run, spawn = nodeSpawn }) {
  let installing = false;
  const target = platform === 'darwin' ? appBundleFromExe(exePath) : null;

  async function supported(release) {
    const name = assetName(arch);
    if (platform !== 'darwin' || !app.isPackaged) return { ok: false, reason: 'Pembaruan otomatis hanya untuk aplikasi macOS yang sudah terpasang.' };
    if (!name || !release.assets?.includes(name) || !release.assets.includes(SUMS)) return { ok: false, reason: 'Rilis ini tidak memuat installer untuk Mac Anda.' };
    if (!target || target.includes('/AppTranslocation/')) return { ok: false, reason: 'Pindahkan LabServer ke folder Applications terlebih dahulu.' };
    try {
      await fsp.access(path.dirname(target), fs.constants.W_OK);
      await fsp.access(target, fs.constants.W_OK);
    } catch { return { ok: false, reason: 'Folder aplikasi tidak bisa ditulis oleh akun ini. Pasang manual dari halaman rilis.' }; }
    return { ok: true };
  }

  async function install(release, emit = () => {}) {
    if (installing) return { ok: false, message: 'Pembaruan sedang berjalan.' };
    installing = true;
    let work;
    try {
      const check = await supported(release);
      if (!check.ok) return { ok: false, message: check.reason };
      work = await fsp.mkdtemp(path.join(app.getPath('temp'), 'labserver-update-'));
      const dmgPath = await downloadVerified({
        release, name: assetName(arch), dir: work, fetchImpl,
        onProgress: ({ received, total }) => emit({ phase: 'download', percent: total ? Math.min(100, Math.floor((received / total) * 100)) : null }),
      });
      emit({ phase: 'verify' });
      emit({ phase: 'install' });
      const staged = await stageUpdate({ dmgPath, target, workDir: work, expected: { id: pkg.build.appId, version: release.version }, run: runner });
      emit({ phase: 'restart' });
      launchSwap({ spawn, pid, target, staged, workDir: work });
      work = null; // dibersihkan oleh skrip penukar
      app.quit();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof UpdateError ? e.message : 'Pembaruan gagal. Coba lagi atau pasang manual dari halaman rilis.' };
    } finally {
      installing = false;
      if (work) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { supported, install };
}

module.exports = { assetName, parseChecksums, appBundleFromExe, downloadVerified, stageUpdate, launchSwap, createUpdater, SWAP_SCRIPT, run, UpdateError };
