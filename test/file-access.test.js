const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalFiles } = require('../src/main/local-files');
const { safeName, safeLocalName, remotePath } = require('../src/main/file-utils');

test('folder grant: Unicode, hidden files, metadata; invalid grants and traversal rejected', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'labserver-access-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'root'));
  await fs.writeFile(path.join(dir, 'root', 'catatan 日本.txt'), 'hello');
  await fs.writeFile(path.join(dir, 'root', '.env'), 'secret');
  await fs.writeFile(path.join(dir, 'outside'), 'private');
  await fs.symlink(path.join(dir, 'outside'), path.join(dir, 'root', 'escape'));
  const local = createLocalFiles();
  const grant = await local.grant(path.join(dir, 'root'));
  const list = await local.list(grant.id, '');
  assert.ok(list.entries.some(e => e.name === '.env'));
  assert.equal(list.entries.find(e => e.name === 'catatan 日本.txt').size, 5);
  assert.equal(await local.resolve(grant.id, 'catatan 日本.txt'), await fs.realpath(path.join(dir, 'root', 'catatan 日本.txt')));
  for (const rel of ['../outside', '/etc/passwd', 'escape']) await assert.rejects(local.resolve(grant.id, rel));
  await assert.rejects(local.resolve('unknown', ''));
  local.clear();
  await assert.rejects(local.resolve(grant.id, ''));
});

test('names and remote paths remain literal and safe across platforms', () => {
  for (const name of ['.env', '日本 語.txt', "a'b;$x.txt"]) assert.equal(safeName(name), name);
  for (const name of ['', '.', '..', 'a/b', 'a\0b']) assert.throws(() => safeName(name));
  for (const name of ['CON', 'NUL.txt', 'a:b', 'a\\b', 'trailing.']) assert.throws(() => safeLocalName(name, 'win32'));
  assert.equal(remotePath('/var/www/../log'), '/var/log');
  assert.throws(() => remotePath('relative'));
});
