const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fileSftp } = require('./helpers/fileSftp');
const { createRemoteFiles } = require('../src/main/remote-files');

async function setup(t, options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labserver-remote-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'home/deploy'), { recursive: true });
  const conn = fileSftp(root, options);
  return { conn, remote: createRemoteFiles(conn), root };
}
test('SFTP browse, Unicode CRUD and symlink deletion never follows target', async t => {
  const { conn, remote } = await setup(t);
  assert.equal(await remote.home(), '/home/deploy');
  await remote.mkdir('/home/deploy', '日本 語');
  assert.equal((await remote.list('/home/deploy')).entries[0].name, '日本 語');
  await remote.rename('/home/deploy/日本 語', 'renamed');
  await fs.writeFile(conn.target('/home/deploy/keep'), 'keep');
  await fs.symlink(conn.target('/home/deploy/keep'), conn.target('/home/deploy/renamed/link'));
  await remote.remove(['/home/deploy/renamed']);
  assert.equal(await fs.readFile(conn.target('/home/deploy/keep'), 'utf8'), 'keep');
  await assert.rejects(remote.remove(['/']), /valid/);
  await assert.rejects(remote.rename('/', 'new'), /valid/);
});
test('editor bounds and revisions: binary rejected, external change protected, atomic unsupported keeps original', async t => {
  const { conn, remote } = await setup(t);
  const p = '/home/deploy/test.txt';
  await fs.writeFile(conn.target(p), 'original');
  const opened = await remote.read(p);
  await fs.writeFile(conn.target(p), 'changed!');
  await assert.rejects(remote.save(p, 'updated', opened.revision, false), /berubah/);
  assert.equal(await fs.readFile(conn.target(p), 'utf8'), 'changed!');
  await remote.save(p, 'updated', opened.revision, true);
  assert.equal(await fs.readFile(conn.target(p), 'utf8'), 'updated');
  await fs.writeFile(conn.target(p), Buffer.from([255, 0, 254]));
  await assert.rejects(remote.read(p), /UTF-8/);
  await fs.writeFile(conn.target(p), Buffer.alloc(1048577, 65));
  await assert.rejects(remote.read(p), /1 MiB/);
  const other = await setup(t, { atomic: false });
  await fs.writeFile(other.conn.target(p), 'keep original');
  const old = await other.remote.read(p);
  await assert.rejects(other.remote.save(p, 'new', old.revision, false), /aman/);
  assert.equal(await fs.readFile(other.conn.target(p), 'utf8'), 'keep original');
  assert.equal((await fs.readdir(other.conn.target('/home/deploy'))).some(n => n.endsWith('.part')), false);
  other.conn.s.ext_openssh_rename = () => { throw new Error('Server does not support this extended request'); };
  await assert.rejects(other.remote.save(p, 'new', old.revision, false), error => error.code === 'UNSUPPORTED');
});
