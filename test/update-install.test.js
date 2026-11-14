const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assetName, parseChecksums, appBundleFromExe, downloadVerified, stageUpdate, launchSwap, createUpdater, SWAP_SCRIPT } = require('../src/main/update-install');

const release = { owner: 'rendra24', repo: 'LabServer', tag: 'desktop-v0.1.4', version: '0.1.4', assets: ['LabServer-macOS-arm64.dmg', 'LabServer-macOS-x64.dmg', 'SHA256SUMS.txt'] };
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lsu-test-'));

function reply(body, { url = '', status = 200, size } = {}) {
  const buffer = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300, status, url,
    headers: { get: (name) => (name.toLowerCase() === 'content-length' ? String(size ?? buffer.length) : null) },
    text: async () => buffer.toString('utf8'),
    body: (async function* () { for (let i = 0; i < buffer.length; i += 4) yield buffer.subarray(i, i + 4); })(),
  };
}
function fakeFetch(files, finalUrl) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const name = url.split('/').pop();
    return files[name] === undefined ? reply('', { status: 404 }) : reply(files[name], { url: finalUrl ?? url });
  };
  fn.calls = calls;
  return fn;
}

test('assetName memilih DMG sesuai arsitektur dan menolak arsitektur lain', () => {
  assert.equal(assetName('arm64'), 'LabServer-macOS-arm64.dmg');
  assert.equal(assetName('x64'), 'LabServer-macOS-x64.dmg');
  assert.equal(assetName('ia32'), null);
});

test('parseChecksums membaca format shasum dan mengabaikan baris lain', () => {
  const a = 'a'.repeat(64), b = 'B'.repeat(64);
  const map = parseChecksums(`${a}  LabServer-macOS-arm64.dmg\n${b} *LabServer-macOS-x64.dmg\nsampah\n`);
  assert.equal(map.get('LabServer-macOS-arm64.dmg'), a);
  assert.equal(map.get('LabServer-macOS-x64.dmg'), 'b'.repeat(64));
  assert.equal(map.size, 2);
});

test('appBundleFromExe mengambil folder .app dari path executable', () => {
  assert.equal(appBundleFromExe('/Applications/LabServer.app/Contents/MacOS/LabServer'), '/Applications/LabServer.app');
  assert.equal(appBundleFromExe('/Users/x/Apps/My App.app/Contents/MacOS/LabServer'), '/Users/x/Apps/My App.app');
  assert.equal(appBundleFromExe('/usr/local/bin/node'), null);
});

test('downloadVerified mengunduh, memverifikasi SHA256, dan melaporkan progres', async () => {
  const dir = tmp(), dmg = 'isi-dmg-palsu-1234567890';
  const fetchImpl = fakeFetch({ 'SHA256SUMS.txt': `${sha(dmg)}  LabServer-macOS-arm64.dmg\n`, 'LabServer-macOS-arm64.dmg': dmg });
  const seen = [];
  const file = await downloadVerified({ release, name: 'LabServer-macOS-arm64.dmg', dir, fetchImpl, onProgress: (p) => seen.push(p) });
  assert.equal(fs.readFileSync(file, 'utf8'), dmg);
  assert.ok(seen.length > 1);
  assert.equal(seen.at(-1).received, dmg.length);
  assert.ok(fetchImpl.calls.every((url) => url.startsWith('https://github.com/rendra24/LabServer/releases/download/desktop-v0.1.4/')));
});

test('downloadVerified menolak dan menghapus file bila checksum tidak cocok', async () => {
  const dir = tmp();
  const fetchImpl = fakeFetch({ 'SHA256SUMS.txt': `${'0'.repeat(64)}  LabServer-macOS-arm64.dmg\n`, 'LabServer-macOS-arm64.dmg': 'isi' });
  await assert.rejects(downloadVerified({ release, name: 'LabServer-macOS-arm64.dmg', dir, fetchImpl }), /checksum/i);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('downloadVerified menolak bila checksum untuk installer tidak ada', async () => {
  const fetchImpl = fakeFetch({ 'SHA256SUMS.txt': `${'a'.repeat(64)}  nama-lain.dmg\n`, 'LabServer-macOS-arm64.dmg': 'isi' });
  await assert.rejects(downloadVerified({ release, name: 'LabServer-macOS-arm64.dmg', dir: tmp(), fetchImpl }), /checksum/i);
});

test('downloadVerified menolak pengalihan ke host selain GitHub', async () => {
  const fetchImpl = fakeFetch({ 'SHA256SUMS.txt': 'x', 'LabServer-macOS-arm64.dmg': 'isi' }, 'https://evil.example.com/file');
  await assert.rejects(downloadVerified({ release, name: 'LabServer-macOS-arm64.dmg', dir: tmp(), fetchImpl }), /tidak tepercaya|host/i);
});

test('downloadVerified menerima pengalihan ke objects.githubusercontent.com', async () => {
  const dir = tmp(), dmg = 'isi';
  const fetchImpl = fakeFetch({ 'SHA256SUMS.txt': `${sha(dmg)}  LabServer-macOS-arm64.dmg\n`, 'LabServer-macOS-arm64.dmg': dmg }, 'https://objects.githubusercontent.com/abc');
  await downloadVerified({ release, name: 'LabServer-macOS-arm64.dmg', dir, fetchImpl });
});

test('downloadVerified menolak ukuran berlebihan dan membersihkan file', async () => {
  const dir = tmp();
  const fetchImpl = async (url) => url.endsWith('SHA256SUMS.txt')
    ? reply(`${'a'.repeat(64)}  LabServer-macOS-arm64.dmg\n`, { url })
    : reply('isi', { url, size: 10 * 1024 * 1024 * 1024 });
  await assert.rejects(downloadVerified({ release, name: 'LabServer-macOS-arm64.dmg', dir, fetchImpl }), /terlalu besar/i);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('downloadVerified menolak nama aset di luar daftar yang dikenal', async () => {
  await assert.rejects(downloadVerified({ release, name: '../../etc/passwd', dir: tmp(), fetchImpl: fakeFetch({}) }), /tidak dikenal/i);
});

function fakeRun(overrides = {}) {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([path.basename(cmd), ...args]);
    const key = path.basename(cmd);
    if (overrides[key]) return overrides[key](args);
    if (key === 'PlistBuddy') return { stdout: args[1].includes('CFBundleShortVersionString') ? '0.1.4\n' : 'com.labserver.desktop\n' };
    if (key === 'ditto') fs.mkdirSync(args[1], { recursive: true });
    return { stdout: '' };
  };
  run.calls = calls;
  return run;
}
function stageFixture() {
  const work = tmp(), apps = tmp(), target = path.join(apps, 'LabServer.app');
  fs.mkdirSync(target);
  return { workDir: work, target, dmgPath: path.join(work, 'x.dmg'), expected: { id: 'com.labserver.desktop', version: '0.1.4' } };
}
// hdiutil palsu: "mount" = buat folder LabServer.app di mountpoint
const attach = (args) => { fs.mkdirSync(path.join(args[args.indexOf('-mountpoint') + 1], 'LabServer.app'), { recursive: true }); return { stdout: '' }; };

test('stageUpdate: attach, salin, verifikasi tanda tangan dan identitas, lalu detach', async () => {
  const f = stageFixture(), run = fakeRun({ hdiutil: (args) => (args[0] === 'attach' ? attach(args) : { stdout: '' }) });
  const staged = await stageUpdate({ ...f, run });
  assert.equal(staged, `${f.target}.update`);
  assert.ok(fs.existsSync(staged));
  const names = run.calls.map((c) => c[0]);
  assert.deepEqual(names.filter((n) => ['hdiutil', 'ditto', 'codesign'].includes(n)), ['hdiutil', 'ditto', 'codesign', 'hdiutil']);
  assert.equal(run.calls.at(-1)[0], 'hdiutil');
  assert.equal(run.calls.at(-1)[1], 'detach');
});

test('stageUpdate menolak aplikasi dengan bundle id berbeda, tetap detach, dan menghapus hasil salinan', async () => {
  const f = stageFixture(), run = fakeRun({ hdiutil: (args) => (args[0] === 'attach' ? attach(args) : { stdout: '' }), PlistBuddy: () => ({ stdout: 'com.evil.app\n' }) });
  await assert.rejects(stageUpdate({ ...f, run }), /identitas/i);
  assert.equal(fs.existsSync(`${f.target}.update`), false);
  assert.equal(run.calls.at(-1)[1], 'detach');
});

test('stageUpdate menolak versi yang berbeda dari rilis', async () => {
  const f = stageFixture(), run = fakeRun({ hdiutil: (args) => (args[0] === 'attach' ? attach(args) : { stdout: '' }), PlistBuddy: (args) => ({ stdout: args[1].includes('ShortVersion') ? '9.9.9\n' : 'com.labserver.desktop\n' }) });
  await assert.rejects(stageUpdate({ ...f, run }), /versi/i);
  assert.equal(fs.existsSync(`${f.target}.update`), false);
});

test('stageUpdate menolak tanda tangan tidak valid dan tetap detach', async () => {
  const f = stageFixture(), run = fakeRun({ hdiutil: (args) => (args[0] === 'attach' ? attach(args) : { stdout: '' }), codesign: () => { throw new Error('invalid signature'); } });
  await assert.rejects(stageUpdate({ ...f, run }), /tanda tangan/i);
  assert.equal(fs.existsSync(`${f.target}.update`), false);
  assert.equal(run.calls.at(-1)[1], 'detach');
});

test('stageUpdate gagal bila DMG tidak memuat LabServer.app', async () => {
  const f = stageFixture(), run = fakeRun();
  await assert.rejects(stageUpdate({ ...f, run }), /tidak memuat/i);
});

test('launchSwap menjalankan skrip terpisah dengan argumen posisi, bukan string yang disisipi path', () => {
  const calls = [];
  const child = { unref() { calls.push('unref'); } };
  launchSwap({ spawn: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return child; }, pid: 4242, target: '/Applications/Lab Server $(x).app', staged: '/Applications/Lab Server $(x).app.update', workDir: '/tmp/w' });
  const { cmd, args, opts } = calls[0];
  assert.equal(cmd, '/bin/sh');
  assert.equal(args[0], '-c');
  assert.equal(args[1], SWAP_SCRIPT);
  assert.ok(!args[1].includes('Lab Server'));
  assert.ok(args.includes('/Applications/Lab Server $(x).app'));
  assert.equal(opts.detached, true);
  assert.equal(opts.stdio, 'ignore');
  assert.equal(calls.at(-1), 'unref');
});

function updater(extra = {}) {
  const events = [];
  const work = tmp(), apps = tmp(), target = path.join(apps, 'LabServer.app');
  fs.mkdirSync(path.join(target, 'Contents', 'MacOS'), { recursive: true });
  const dmg = 'dmg-isi';
  const quit = [];
  const u = createUpdater({
    app: { isPackaged: true, getPath: () => work, quit: () => quit.push(1) },
    pkg: { build: { appId: 'com.labserver.desktop' } },
    platform: 'darwin', arch: 'arm64', pid: 99,
    exePath: path.join(target, 'Contents', 'MacOS', 'LabServer'),
    fetchImpl: fakeFetch({ 'SHA256SUMS.txt': `${sha(dmg)}  LabServer-macOS-arm64.dmg\n`, 'LabServer-macOS-arm64.dmg': dmg }),
    run: fakeRun({ hdiutil: (args) => (args[0] === 'attach' ? attach(args) : { stdout: '' }) }),
    spawn: (cmd, args) => { events.push(['spawn', args]); return { unref() {} }; },
    ...extra,
  });
  return { u, events, quit, target, work };
}

test('createUpdater.supported: hanya macOS terkemas dengan arsitektur dikenal dan folder bisa ditulis', async () => {
  assert.equal((await updater().u.supported(release)).ok, true);
  assert.equal((await updater({ platform: 'win32' }).u.supported(release)).ok, false);
  assert.equal((await updater({ arch: 'ia32' }).u.supported(release)).ok, false);
  assert.equal((await updater({ app: { isPackaged: false, getPath: () => tmp(), quit() {} } }).u.supported(release)).ok, false);
  assert.equal((await updater().u.supported({ ...release, assets: ['SHA256SUMS.txt'] })).ok, false);
  const translocated = updater({ exePath: '/private/var/folders/x/AppTranslocation/ABC/d/LabServer.app/Contents/MacOS/LabServer' });
  assert.equal((await translocated.u.supported(release)).ok, false);
});

test('createUpdater.install: unduh, siapkan, jalankan skrip penukar, lalu keluar dari aplikasi', async () => {
  const { u, events, quit } = updater();
  const phases = [];
  const result = await u.install(release, (p) => phases.push(p.phase));
  assert.deepEqual(result, { ok: true });
  assert.ok(['download', 'verify', 'install', 'restart'].every((p) => phases.includes(p)), phases.join());
  assert.equal(events.filter((e) => e[0] === 'spawn').length, 1);
  assert.deepEqual(quit, [1]);
});

test('createUpdater.install: kegagalan di tengah tidak menjalankan skrip dan tidak keluar dari aplikasi', async () => {
  const { u, events, quit } = updater({ fetchImpl: fakeFetch({ 'SHA256SUMS.txt': `${'0'.repeat(64)}  LabServer-macOS-arm64.dmg\n`, 'LabServer-macOS-arm64.dmg': 'x' }) });
  const result = await u.install(release, () => {});
  assert.equal(result.ok, false);
  assert.match(result.message, /checksum/i);
  assert.equal(events.length, 0);
  assert.deepEqual(quit, []);
});

test('createUpdater.install: tidak berjalan ganda', async () => {
  const { u } = updater();
  const first = u.install(release, () => {});
  const second = await u.install(release, () => {});
  assert.equal(second.ok, false);
  assert.match(second.message, /sedang berjalan/i);
  await first;
});

test('createUpdater.install: penjaga tutup menolak -> batal dengan pesan, skrip tidak jalan', async () => {
  const { u, events, quit } = updater({ beforeQuit: async () => false });
  const result = await u.install(release, () => {});
  assert.equal(result.ok, false);
  assert.match(result.message, /dibatalkan/i);
  assert.equal(events.length, 0);
  assert.deepEqual(quit, []);
});

test('createUpdater.install: keluar lewat exit() bila diberikan, bukan app.quit', async () => {
  const exited = [];
  const { u, quit } = updater({ exit: () => exited.push(1) });
  assert.deepEqual(await u.install(release, () => {}), { ok: true });
  assert.deepEqual(exited, [1]);
  assert.deepEqual(quit, []);
});
