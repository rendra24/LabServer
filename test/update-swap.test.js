// Uji nyata (tanpa tiruan): skrip penukar dijalankan oleh /bin/sh, dan pipeline hdiutil/ditto/codesign di macOS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { SWAP_SCRIPT, stageUpdate, run } = require('../src/main/update-install');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lsu-swap-'));
function layout({ withStaged = true } = {}) {
  const root = tmp(), target = path.join(root, 'LabServer.app'), staged = `${target}.update`, backup = `${target}.old`, work = path.join(root, 'work');
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'marker'), 'lama');
  if (withStaged) { fs.mkdirSync(staged); fs.writeFileSync(path.join(staged, 'marker'), 'baru'); }
  fs.mkdirSync(work); fs.writeFileSync(path.join(work, 'x.dmg'), 'dmg');
  return { root, target, staged, backup, work };
}
// Asinkron: proses 'sleep' anak harus bisa di-reap oleh event loop, kalau tidak jadi zombie dan kill -0 tetap berhasil.
const sh = (args, options = {}) => new Promise((resolve) => {
  const child = spawn('/bin/sh', ['-c', SWAP_SCRIPT, 'sh', ...args], { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stderr }));
});
const runSwap = (pid, l, extra = []) => sh([String(pid), l.target, l.staged, l.backup, l.work, ...extra]);

test('skrip penukar menunggu proses lama keluar, menukar aplikasi, dan membersihkan sisa', async () => {
  const l = layout();
  const marker = path.join(l.root, 'opened');
  const opener = path.join(l.root, 'opener.sh');
  fs.writeFileSync(opener, `#!/bin/sh\necho "$1" > "${marker}"\n`, { mode: 0o755 });
  const child = spawn('sleep', ['0.6']);
  const started = Date.now();
  const result = await runSwap(child.pid, l, [opener]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started >= 400, 'harus menunggu proses lama keluar');
  assert.equal(fs.readFileSync(path.join(l.target, 'marker'), 'utf8'), 'baru');
  assert.equal(fs.existsSync(l.backup), false);
  assert.equal(fs.existsSync(l.staged), false);
  assert.equal(fs.existsSync(l.work), false);
  assert.equal(fs.readFileSync(marker, 'utf8').trim(), l.target);
});

test('skrip penukar mengembalikan aplikasi lama bila penukaran gagal', async () => {
  const l = layout({ withStaged: false });
  const child = spawn('sleep', ['0.2']);
  const result = await runSwap(child.pid, l, ['true']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(l.target, 'marker'), 'utf8'), 'lama');
  assert.equal(fs.existsSync(l.backup), false);
});

test('skrip penukar menyerah bila proses lama tidak keluar dan tidak menyentuh aplikasi', async () => {
  const l = layout();
  const child = spawn('sleep', ['5']);
  const result = await runSwap(child.pid, l, ['true', '3']);
  child.kill();
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(l.target, 'marker'), 'utf8'), 'lama');
  assert.equal(fs.existsSync(l.staged), false);
  assert.equal(fs.existsSync(l.work), false);
});

test('skrip penukar aman terhadap nama folder dengan spasi dan karakter shell', async () => {
  const root = tmp(), target = path.join(root, 'Lab Server $(touch pwned) `x`.app'), staged = `${target}.update`, backup = `${target}.old`, work = path.join(root, 'w');
  for (const dir of [target, staged, work]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(staged, 'marker'), 'baru');
  const child = spawn('sleep', ['0.1']);
  const result = await sh([String(child.pid), target, staged, backup, work, 'true'], { cwd: root });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(target, 'marker'), 'utf8'), 'baru');
  assert.equal(fs.existsSync(path.join(root, 'pwned')), false);
});

const mac = process.platform === 'darwin' ? test : test.skip;

function buildFakeApp(dir, id, version) {
  const app = path.join(dir, 'LabServer.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'LabServer'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>LabServer</string>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`);
  spawnSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'pipe' });
  return app;
}
async function buildDmg(id, version) {
  const src = tmp();
  buildFakeApp(src, id, version);
  const dmg = path.join(tmp(), 'LabServer-macOS-arm64.dmg');
  const made = spawnSync('/usr/bin/hdiutil', ['create', '-srcfolder', src, '-volname', 'LabServer', '-format', 'UDZO', '-ov', dmg], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return dmg;
}
function installedApp() {
  const apps = tmp(), target = path.join(apps, 'LabServer.app');
  fs.mkdirSync(target);
  return { target, work: tmp() };
}

mac('stageUpdate nyata: DMG sungguhan di-mount, disalin, diverifikasi, lalu di-unmount', async () => {
  const dmgPath = await buildDmg('com.labserver.desktop', '0.1.4');
  const { target, work } = installedApp();
  const staged = await stageUpdate({ dmgPath, target, workDir: work, expected: { id: 'com.labserver.desktop', version: '0.1.4' }, run });
  assert.equal(staged, `${target}.update`);
  assert.ok(fs.existsSync(path.join(staged, 'Contents', 'MacOS', 'LabServer')));
  assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]).status, 0);
  const mounted = spawnSync('/sbin/mount', { encoding: 'utf8' }).stdout;
  assert.ok(!mounted.includes(path.join(work, 'mnt')), 'DMG harus sudah di-unmount');
});

mac('stageUpdate nyata: menolak DMG dengan bundle id lain dan tidak meninggalkan salinan atau mount', async () => {
  const dmgPath = await buildDmg('com.evil.app', '0.1.4');
  const { target, work } = installedApp();
  await assert.rejects(stageUpdate({ dmgPath, target, workDir: work, expected: { id: 'com.labserver.desktop', version: '0.1.4' }, run }), /identitas/i);
  assert.equal(fs.existsSync(`${target}.update`), false);
  assert.ok(!spawnSync('/sbin/mount', { encoding: 'utf8' }).stdout.includes(path.join(work, 'mnt')));
});
