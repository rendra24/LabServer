const path = require('node:path').posix;
const crypto = require('node:crypto');
const { FileError, failure, safeName, remotePath, call, revision, digest, metadata } = require('./file-utils');
const LIMIT = 1048576;

function createRemoteFiles(conn) {
  const sftp = () => conn.sftp();
  async function stat(p) {
    try { return await call(await sftp(), 'lstat', remotePath(p)); }
    catch (error) { if ([2, 'ENOENT'].includes(error.code)) return null; throw error; }
  }
  async function list(p) {
    p = remotePath(p);
    const entries = await call(await sftp(), 'readdir', p);
    if (entries.length > 10000) throw new FileError('LIMIT', 'Folder berisi lebih dari 10.000 item. Buka subfolder untuk mempersempit daftar.');
    return { path: p, entries: entries.filter(e => !['.', '..'].includes(e.filename)).map(e => metadata(safeName(e.filename), e.attrs)) };
  }
  async function read(p) {
    p = remotePath(p);
    const attrs = await stat(p);
    if (!attrs) throw new FileError('NOT_FOUND');
    if (metadata('', attrs).type !== 'file' || attrs.size > LIMIT) throw new FileError('NOT_TEXT');
    const chunks = []; let size = 0;
    const stream = (await sftp()).createReadStream(p);
    for await (const data of stream) {
      size += data.length;
      if (size > LIMIT) { stream.destroy(); throw new FileError('NOT_TEXT'); }
      chunks.push(data);
    }
    const data = Buffer.concat(chunks);
    if (data.includes(0)) throw new FileError('NOT_TEXT');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new FileError('NOT_TEXT'); }
    return { path: p, text, revision: digest(data), attrs: metadata(path.basename(p), attrs) };
  }
  async function cleanup(p) { try { await call(await sftp(), 'unlink', p); } catch (error) { if (![2, 'ENOENT'].includes(error.code)) throw error; } }
  async function commit(tmp, destination, expected, check = () => {}) {
    destination = remotePath(destination);
    check();
    const before = await stat(destination);
    if (revision(before) !== expected) throw new FileError('CHANGED');
    const s = await sftp();
    if (before) {
      if (metadata('', before).type !== 'file') throw new FileError('EXISTS');
      const created = await stat(tmp);
      const attrs = { mode: before.mode & 0o7777 };
      if (created.uid !== before.uid || created.gid !== before.gid) { attrs.uid = before.uid; attrs.gid = before.gid; }
      await call(s, 'setstat', tmp, attrs);
      check();
      if (revision(await stat(destination)) !== expected) throw new FileError('CHANGED');
      try { await call(s, 'ext_openssh_rename', tmp, destination); }
      catch (error) { if (error.code === 8 || /unsupported|does not support|not a function/i.test(error.message)) throw new FileError('UNSUPPORTED'); throw error; }
    } else {
      check();
      await call(s, 'rename', tmp, destination);
    }
  }
  async function save(p, text, expected, force = false) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > LIMIT || text.includes('\0')) throw new FileError('NOT_TEXT');
    p = remotePath(p);
    const before = await read(p);
    if (!force && before.revision !== expected) throw new FileError('CHANGED');
    const attrs = await stat(p);
    const tmp = path.join(path.dirname(p), `.labserver-${crypto.randomUUID()}.part`);
    try {
      await call(await sftp(), 'writeFile', tmp, Buffer.from(text), { flag: 'wx', mode: 0o600 });
      if (!force && (await read(p)).revision !== expected) throw new FileError('CHANGED');
      await commit(tmp, p, revision(attrs));
    } finally { await cleanup(tmp); }
    return { revision: digest(Buffer.from(text)) };
  }
  async function remove(paths) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 1000) throw new FileError('INVALID_PATH');
    const validated = paths.map(remotePath);
    if (validated.includes('/')) throw new FileError('INVALID_PATH');
    const s = await sftp();
    async function erase(p, depth = 0) {
      if (depth > 128) throw new FileError('LIMIT', 'Struktur folder terlalu dalam.');
      const attrs = await stat(p);
      if (!attrs) throw new FileError('NOT_FOUND');
      if (metadata('', attrs).type === 'directory') {
        for (const e of (await list(p)).entries) await erase(path.join(p, safeName(e.name)), depth + 1);
        await call(s, 'rmdir', p);
      } else await call(s, 'unlink', p);
    }
    const results = [];
    for (const p of validated) { try { await erase(p); results.push({ path: p, ok: true }); } catch (error) { results.push({ path: p, ...failure(error) }); } }
    return results;
  }
  return {
    home: async () => remotePath(await call(await sftp(), 'realpath', '.')),
    list, stat, read, save, commit, cleanup, remove,
    async details(p) {
      const attrs = await stat(p);
      if (!attrs) throw new FileError('NOT_FOUND');
      const data = metadata(path.basename(p), attrs);
      if (data.type === 'link') data.target = await call(await sftp(), 'readlink', remotePath(p));
      return data;
    },
    async mkdir(p, name) { await call(await sftp(), 'mkdir', path.join(remotePath(p), safeName(name))); },
    async ensureDirectory(p) {
      const attrs = await stat(p);
      if (attrs) { if (metadata('', attrs).type !== 'directory') throw new FileError('EXISTS'); return; }
      await call(await sftp(), 'mkdir', remotePath(p));
    },
    async rename(p, name) {
      p = remotePath(p);
      if (p === '/') throw new FileError('INVALID_PATH');
      const dest = path.join(path.dirname(p), safeName(name));
      if (await stat(dest)) throw new FileError('EXISTS');
      await call(await sftp(), 'rename', p, dest);
    },
    readStream: async p => (await sftp()).createReadStream(remotePath(p)),
    writeStream: async p => (await sftp()).createWriteStream(remotePath(p), { flags: 'wx', mode: 0o600 }),
  };
}
module.exports = { createRemoteFiles };
