const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { FileError, failure, safeName, safeLocalName, remotePath, metadata, revision } = require('./file-utils');

function createTransfers({ remote, local, emit, changed }) {
  const jobs = new Map(); let running = 0; let disposed = false;
  const terminal = new Set(['complete', 'partial', 'failed', 'cancelled']);
  const snapshot = j => ({ id: j.id, direction: j.direction, name: j.name, status: j.status, copied: j.copied, total: j.total, files: j.files, skipped: j.skipped, failed: j.failed, current: j.current, currentBytes: j.currentBytes, currentSize: j.currentSize, speed: Math.round(j.copied / Math.max(.1, (Date.now() - j.started) / 1000)), message: j.message, conflict: j.conflict, errors: j.errors.slice(0, 30) });
  function publish(j, force = false) {
    if (!force && Date.now() - j.updated < 100) return;
    j.updated = Date.now(); emit({ type: 'transfer', job: snapshot(j) });
  }
  function check(j) { if (disposed || j.abort.signal.aborted) throw new FileError(disposed ? 'DISCONNECTED' : 'CANCELLED'); }
  async function existsLocal(p) { try { return await fsp.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  async function cleanupLocal(tmp, owned, resolve) {
    if (!owned) return;
    await resolve(tmp);
    const current = await existsLocal(tmp);
    if (current && (current.dev !== owned.dev || current.ino !== owned.ino || !current.isFile())) throw new FileError('CHANGED');
    if (current) await fsp.unlink(tmp);
  }
  async function conflict(j, target, incompatible) {
    check(j);
    if (j.policy && !(incompatible && j.policy === 'overwrite')) return j.policy;
    j.status = 'conflict'; j.conflict = { path: target, incompatible }; publish(j, true);
    try {
      return await new Promise((resolve, reject) => {
        const abort = () => { j.waiting = null; reject(new FileError('CANCELLED')); };
        j.abort.signal.addEventListener('abort', abort, { once: true });
        j.waiting = value => { j.abort.signal.removeEventListener('abort', abort); j.waiting = null; resolve(value); };
      });
    } finally { j.conflict = null; j.status = 'running'; publish(j, true); }
  }
  async function destination(j, proposed, sourceType, stat) {
    let target = proposed; let attrs = await stat(target);
    if (!attrs) return { target, expected: null };
    if (sourceType === 'directory' && metadata('', attrs).type === 'directory') return { target, expected: revision(attrs) };
    const incompatible = sourceType !== 'file' || metadata('', attrs).type !== 'file';
    const choice = await conflict(j, target, incompatible);
    if (choice === 'skip') { j.skipped++; return null; }
    if (choice === 'overwrite') { if (incompatible) throw new FileError('EXISTS'); return { target, expected: revision(attrs) }; }
    const join = j.direction === 'upload' ? path.posix : path;
    const ext = sourceType === 'file' ? join.extname(target) : '';
    const stem = join.basename(target).slice(0, ext ? -ext.length : undefined);
    for (let index = 1; index <= 10000; index++) {
      target = join.join(join.dirname(proposed), `${stem} (${index})${ext}`);
      attrs = await stat(target);
      if (!attrs) return { target, expected: null };
    }
    throw new FileError('EXISTS');
  }
  async function copy(j, source, target, attrs, expected, sourceResolve, targetResolve) {
    check(j);
    const upload = j.direction === 'upload';
    const tmp = (upload ? path.posix : path).join((upload ? path.posix : path).dirname(target), `.labserver-${crypto.randomUUID()}.part`);
    let owned = null;
    j.current = (upload ? path : path.posix).basename(source); j.currentBytes = 0; j.currentSize = attrs.size; j.total += attrs.size;
    publish(j, true);
    try {
      check(j); await sourceResolve(); await targetResolve(tmp);
      let input, output;
      try {
        if (upload) output = await remote.writeStream(tmp);
        else {
          const handle = await fsp.open(tmp, 'wx', 0o600);
          try { owned = await handle.stat(); output = handle.createWriteStream(); }
          catch (error) { await handle.close(); throw error; }
          await targetResolve(tmp);
        }
        input = upload ? fs.createReadStream(source) : await remote.readStream(source);
        await pipeline(input, new Transform({ transform(chunk, _encoding, cb) { j.copied += chunk.length; j.currentBytes += chunk.length; publish(j); cb(null, chunk); } }), output, { signal: j.abort.signal });
      } finally { input?.destroy(); output?.destroy(); }
      check(j); await sourceResolve(); await targetResolve(tmp);
      const after = upload ? await fsp.lstat(source) : await remote.stat(source);
      if (revision(after) !== revision(attrs)) throw new FileError('CHANGED');
      if (upload) {
        await remote.commit(tmp, target, expected, () => check(j));
      } else {
        await targetResolve(target);
        const before = await existsLocal(target);
        if (revision(before) !== expected) throw new FileError('CHANGED');
        if (before) {
          await fsp.chmod(tmp, before.mode & 0o7777);
          const created = await fsp.stat(tmp);
          if (created.uid !== before.uid || created.gid !== before.gid) await fsp.chown(tmp, before.uid, before.gid);
          check(j);
          if (revision(await existsLocal(target)) !== expected) throw new FileError('CHANGED');
          await fsp.rename(tmp, target);
        } else {
          check(j); await fsp.link(tmp, target); await fsp.unlink(tmp);
        }
      }
      j.files++; changed(upload ? target : null);
    } finally {
      try {
        if (upload) await remote.cleanup(tmp);
        else await cleanupLocal(tmp, owned, targetResolve);
      }
      catch { j.errors.push({ path: tmp, message: 'File sementara belum dapat dibersihkan. Periksa file .part ini setelah reconnect.' }); }
    }
  }
  async function walk(j, source, proposed, depth = 0) {
    check(j);
    if (depth > 128) throw new FileError('LIMIT', 'Struktur folder melebihi 128 tingkat.');
    const upload = j.direction === 'upload';
    const src = upload ? await local.resolve(j.source.grantId, source) : remotePath(source);
    const attrs = upload ? await fsp.lstat(src) : await remote.stat(src);
    if (!attrs) throw new FileError('NOT_FOUND');
    const type = metadata('', attrs).type;
    if (!['file', 'directory'].includes(type)) { j.skipped++; j.errors.push({ path: source, message: 'Symlink atau tipe khusus dilewati.' }); return; }
    const resolveTarget = upload ? async p => { remotePath(p); } : async p => local.resolve(j.destination.grantId, path.relative(j.localRoot, p), { missing: true });
    const targetStat = upload ? p => remote.stat(p) : async p => { await resolveTarget(p); return existsLocal(p); };
    const dest = await destination(j, proposed, type, targetStat);
    if (!dest) return;
    check(j);
    if (type === 'directory') {
      if (upload) await remote.ensureDirectory(dest.target);
      else { await resolveTarget(dest.target); await fsp.mkdir(dest.target, { recursive: false }).catch(e => { if (e.code !== 'EEXIST') throw e; }); }
      const entries = upload ? (await local.list(j.source.grantId, source)).entries : (await remote.list(src)).entries;
      for (const entry of entries) {
        check(j);
        try {
          const name = upload ? safeName(entry.name) : safeLocalName(entry.name);
          await walk(j, (upload ? path : path.posix).join(source, name), (upload ? path.posix : path).join(dest.target, name), depth + 1);
        } catch (error) {
          check(j); j.failed++; j.errors.push({ path: entry.name, message: failure(error).message }); publish(j, true);
        }
      }
      changed(upload ? dest.target : null);
    } else {
      await copy(j, src, dest.target, attrs, dest.expected, upload ? () => local.resolve(j.source.grantId, source) : async () => {}, resolveTarget);
    }
  }
  async function run(j) {
    j.status = 'running'; j.started = Date.now(); publish(j, true);
    try {
      if (j.direction === 'upload') {
        const source = await local.resolve(j.source.grantId, j.source.relative);
        await walk(j, j.source.relative, path.posix.join(j.destination.path, safeName(path.basename(source))));
      } else {
        const root = local.roots().find(g => g.id === j.destination.grantId);
        if (!root || root.kind !== 'directory') throw new FileError('GRANT_REQUIRED');
        j.localRoot = root.root;
        const destDir = await local.resolve(root.id, j.destination.relative);
        await walk(j, j.source, path.join(destDir, safeLocalName(path.posix.basename(j.source))));
      }
      check(j); j.status = j.failed ? 'partial' : 'complete';
    } catch (error) {
      j.status = disposed ? 'failed' : j.abort.signal.aborted ? 'cancelled' : 'failed';
      j.message = failure(disposed ? new FileError('DISCONNECTED') : j.abort.signal.aborted ? new FileError('CANCELLED') : error).message;
    } finally { j.current = null; publish(j, true); running--; pump(); }
  }
  function pump() {
    if (disposed) return;
    for (const j of jobs.values()) {
      if (running >= 2) break;
      if (j.status !== 'queued') continue;
      running++; run(j);
    }
  }
  async function start(direction, sources, destination) {
    if (disposed) throw new FileError('DISCONNECTED');
    if (!['upload', 'download'].includes(direction) || !Array.isArray(sources) || !sources.length || sources.length > 1000 || jobs.size + sources.length > 1000 || !destination || typeof destination !== 'object') throw new FileError('INVALID_PATH');
    if (direction === 'upload') {
      destination = { path: remotePath(destination.path) };
      const attrs = await remote.stat(destination.path);
      if (!attrs || metadata('', attrs).type !== 'directory') throw new FileError('NOT_FOUND');
      for (const source of sources) { if (!source || typeof source.relative !== 'string') throw new FileError('INVALID_PATH'); await local.resolve(source.grantId, source.relative); }
    } else {
      await local.resolve(destination.grantId, destination.relative);
      sources = sources.map(remotePath);
      for (const source of sources) { if (source === '/') throw new FileError('INVALID_PATH'); }
    }
    const ids = [];
    for (const source of sources) {
      const name = direction === 'upload' ? path.basename(await local.resolve(source.grantId, source.relative)) : path.posix.basename(source);
      const j = { id: crypto.randomUUID(), name, direction, source: structuredClone(source), destination: structuredClone(destination), status: 'queued', copied: 0, total: 0, files: 0, skipped: 0, failed: 0, currentBytes: 0, currentSize: 0, errors: [], updated: 0, started: Date.now(), abort: new AbortController() };
      jobs.set(j.id, j); ids.push(j.id); publish(j, true);
    }
    pump(); return ids;
  }
  return {
    start,
    list: () => [...jobs.values()].map(snapshot),
    cancel(id) { const j = jobs.get(id); if (!j || terminal.has(j.status)) return; j.abort.abort(); if (j.status === 'queued') { j.status = 'cancelled'; publish(j, true); } },
    retry(id) { const j = jobs.get(id); if (!j || !terminal.has(j.status)) throw new FileError('BUSY'); return start(j.direction, [j.source], j.destination); },
    config(id) { const j = jobs.get(id); return j ? { direction: j.direction, sources: [j.source], destination: j.destination } : null; },
    decide(id, choice, all = false) {
      const j = jobs.get(id);
      if (!j?.waiting || !['skip', 'rename', 'overwrite'].includes(choice) || (choice === 'overwrite' && j.conflict.incompatible)) throw new FileError('INVALID_PATH');
      if (all === true) j.policy = choice;
      j.waiting(choice);
    },
    active: () => [...jobs.values()].some(j => !terminal.has(j.status)),
    busy(p) { return [...jobs.values()].some(j => !terminal.has(j.status) && (j.direction === 'download' ? (p === j.source || p.startsWith(j.source + '/') || j.source.startsWith(p + '/')) : (p === j.destination.path || p.startsWith(j.destination.path.replace(/\/$/, '') + '/') || j.destination.path.startsWith(p + '/')))); },
    dispose() { disposed = true; for (const j of jobs.values()) { if (terminal.has(j.status)) continue; j.abort.abort(); if (j.status === 'queued') { j.status = 'failed'; j.message = new FileError('DISCONNECTED').message; publish(j, true); } } },
  };
}
module.exports = { createTransfers };
