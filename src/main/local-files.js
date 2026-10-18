const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { FileError, metadata } = require('./file-utils');

function createLocalFiles() {
  const grants = new Map();
  const inside = (root, value) => { const rel = path.relative(root, value); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
  async function resolve(id, relative = '', { missing = false } = {}) {
    const grant = grants.get(id);
    if (!grant) throw new FileError('GRANT_REQUIRED');
    if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new FileError('INVALID_PATH');
    const target = path.resolve(grant.root, relative);
    if (!inside(grant.root, target) || (grant.kind === 'file' && relative)) throw new FileError('INVALID_PATH');
    let actual;
    try { actual = await fs.realpath(target); }
    catch (error) {
      if (!missing || error.code !== 'ENOENT') throw error;
      actual = path.join(await fs.realpath(path.dirname(target)), path.basename(target));
    }
    if (!inside(grant.root, actual)) throw new FileError('ACCESS_DENIED');
    return target;
  }
  return {
    async grant(value) {
      const root = await fs.realpath(value);
      const stat = await fs.stat(root);
      if (!stat.isDirectory() && !stat.isFile()) throw new FileError('INVALID_PATH');
      const grant = { id: crypto.randomUUID(), root, name: path.basename(root) || root, kind: stat.isDirectory() ? 'directory' : 'file' };
      grants.set(grant.id, grant);
      return grant;
    },
    resolve,
    async list(id, relative = '') {
      const target = await resolve(id, relative);
      const entries = [];
      const dir = await fs.opendir(target);
      for await (const entry of dir) {
        try { entries.push(metadata(entry.name, await fs.lstat(path.join(target, entry.name)))); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (entries.length >= 10000) { throw new FileError('LIMIT', 'Folder berisi lebih dari 10.000 item. Buka subfolder untuk mempersempit daftar.'); }
      }
      return { path: relative, root: grants.get(id).root, entries };
    },
    roots: () => [...grants.values()],
    clear: () => grants.clear(),
  };
}
module.exports = { createLocalFiles };
