const path = require('node:path');
const crypto = require('node:crypto');
const { createLocalFiles } = require('./local-files');
const { createRemoteFiles } = require('./remote-files');
const { createTransfers } = require('./file-transfers');
const { FileError, failure, remotePath, safeName } = require('./file-utils');
const overlaps = (a, b) => a === b || a.startsWith(b.replace(/\/$/, '') + '/') || b.startsWith(a.replace(/\/$/, '') + '/');

function registerFilesIpc({ handle, dialog, winOf, sessions, store }) {
  const owners = new Map();
  function owner(sender) {
    if (owners.has(sender)) return owners.get(sender);
    const data = { local: createLocalFiles(), states: new Map() };
    owners.set(sender, data);
    sender.once('destroyed', () => { for (const state of data.states.values()) state.queue.dispose(); data.local.clear(); owners.delete(sender); });
    return data;
  }
  function workspace(sender, serverId) {
    const conn = sessions.connection(serverId);
    if (!conn) throw new FileError('DISCONNECTED');
    const data = owner(sender);
    let state = data.states.get(serverId);
    if (state?.conn === conn) return state;
    const previous = state;
    previous?.queue.dispose();
    const history = [...(previous?.history || []), ...(previous ? previous.queue.list().map(job => ({ ...job, status: ['complete','partial','cancelled','failed'].includes(job.status) ? job.status : 'failed', message: job.message || 'Sesi sebelumnya berakhir.' })) : [])].slice(-1000);
    const retryConfigs = new Map(previous?.retryConfigs || []);
    if (previous) for (const job of previous.queue.list()) retryConfigs.set(job.id, previous.queue.config(job.id));
    state = { id: crypto.randomUUID(), conn, remote: createRemoteFiles(conn), editor: null, history, retryConfigs, operations: new Map() };
    const emit = packet => { if (!sender.isDestroyed?.()) sender.send('files:event', { serverId, contextId: state.id, ...packet }); };
    const invalidates = p => p && [store.get(serverId)?.nginx.available, store.get(serverId)?.nginx.enabled].some(dir => dir && (p === dir || p.startsWith(dir.replace(/\/$/, '') + '/')));
    state.queue = createTransfers({ remote: state.remote, local: data.local, emit, changed: p => emit({ type: 'changed', path: p, invalidateSyntax: Boolean(invalidates(p)) }) });
    conn.client.once('close', () => { state.queue.dispose(); emit({ type: 'disconnected' }); });
    data.states.set(serverId, state);
    return state;
  }
  const wrap = fn => async (event, ...args) => { try { return { ok: true, data: await fn(event, ...args) }; } catch (error) { return failure(error); } };
  handle('files:local', wrap(async (event, op, grantId, relative) => {
    if (op !== 'list') throw new FileError('INVALID_PATH');
    return owner(event.sender).local.list(grantId, relative);
  }));
  handle('files:pick', wrap(async (event, kind) => {
    if (!['local', 'upload-files', 'upload-folder'].includes(kind)) throw new FileError('INVALID_PATH');
    const result = await dialog.showOpenDialog(winOf(event), { title: kind === 'local' ? 'Pilih folder lokal' : 'Pilih sumber upload', properties: kind === 'upload-files' ? ['openFile','multiSelections','showHiddenFiles'] : ['openDirectory','showHiddenFiles'] });
    if (result.canceled) return { cancelled: true };
    const local = owner(event.sender).local;
    return { grants: await Promise.all(result.filePaths.map(p => local.grant(p))) };
  }));
  handle('files:drop', wrap(async (event, paths) => {
    if (!Array.isArray(paths) || !paths.length || paths.length > 1000 || !paths.every(p => typeof p === 'string' && path.isAbsolute(p))) throw new FileError('INVALID_PATH');
    return { grants: await Promise.all(paths.map(p => owner(event.sender).local.grant(p))) };
  }));
  handle('files:call', wrap(async (event, serverId, op, args = {}) => {
    if (typeof serverId !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) throw new FileError('INVALID_PATH');
    const state = workspace(event.sender, serverId);
    const { remote, queue } = state;
    if (['save','mkdir','rename','remove','start','retry'].includes(op) && sessions.sslBusy?.(serverId)) throw new FileError('BUSY', 'SSL sedang diproses. Tunggu sebelum mengubah file atau memulai transfer.');
    if (op === 'open') return { contextId: state.id, home: await remote.home(), roots: owner(event.sender).local.roots(), jobs: [...state.history, ...queue.list()] };
    if (args.contextId !== state.id) throw new FileError('DISCONNECTED');
    function writable(p, editor = false) {
      p = remotePath(p);
      if (queue.busy(p) || [...state.operations.values()].some(paths => paths.some(other => overlaps(p, other))) || (!editor && state.editor && overlaps(state.editor.path, p))) throw new FileError('BUSY');
      return p;
    }
    async function operation(paths, fn, { transfer = false, editor = false, write = true } = {}) {
      paths = paths.map(remotePath);
      for (const p of paths) {
        if (transfer) {
          if ([...state.operations.values()].some(values => values.some(other => overlaps(p, other))) || (state.editor && overlaps(state.editor.path, p))) throw new FileError('BUSY');
        } else writable(p, editor);
      }
      let release = () => {};
      if (write && sessions.acquireWrite) {
        try { release = sessions.acquireWrite(serverId); } catch (error) { throw new FileError(error.code === 'BUSY' ? 'BUSY' : 'DISCONNECTED'); }
      }
      const token = crypto.randomUUID(); state.operations.set(token, paths);
      try { return await fn(); } finally { state.operations.delete(token); release(); }
    }
    function start(config) {
      const paths = config.direction === 'upload' ? [config.destination?.path] : config.sources;
      if (!Array.isArray(paths)) throw new FileError('INVALID_PATH');
      return operation(paths, () => queue.start(config.direction, config.sources, config.destination), { transfer: true });
    }
    const changed = p => {
      const config = store.get(serverId)?.nginx;
      const invalidateSyntax = [config?.available, config?.enabled].some(dir => dir && (p === dir || p.startsWith(dir.replace(/\/$/, '') + '/')));
      if (!event.sender.isDestroyed?.()) event.sender.send('files:event', { serverId, contextId: state.id, type: 'changed', path: p, invalidateSyntax });
    };
    if (op === 'list') return remote.list(args.path);
    if (op === 'details') return remote.details(args.path);
    if (op === 'read') return operation([args.path], () => remote.read(args.path), { editor: true, write: false });
    if (op === 'editor') { state.editor = args.path ? { path: writable(args.path, true), dirty: args.dirty === true } : null; return {}; }
    if (op === 'save') return operation([args.path], async () => { const p = remotePath(args.path); const result = await remote.save(p, args.text, args.revision, args.force === true); changed(p); return result; }, { editor: true });
    if (op === 'mkdir') return operation([args.path], async () => { const p = remotePath(args.path); await remote.mkdir(p, args.name); changed(p); return {}; });
    if (op === 'rename') return operation([args.path, path.posix.join(path.posix.dirname(remotePath(args.path)), safeName(args.name))], async () => { const p = remotePath(args.path); await remote.rename(p, args.name); changed(p); return {}; });
    if (op === 'remove') {
      if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > 1000) throw new FileError('INVALID_PATH');
      const paths = args.paths.map(p => writable(p));
      if (paths.includes('/')) throw new FileError('INVALID_PATH');
      const result = await dialog.showMessageBox(winOf(event), { type: 'warning', title: 'Hapus dari VPS', buttons: ['Batal','Hapus permanen'], defaultId: 0, cancelId: 0, message: `Hapus ${paths.length} item beserta seluruh isinya?`, detail: paths.slice(0, 5).join('\n') + '\n\nPenghapusan di VPS permanen dan tidak masuk Trash. Symlink tidak diikuti.' });
      if (result.response !== 1) return { cancelled: true };
      if (sessions.connection(serverId) !== state.conn) throw new FileError('DISCONNECTED');
      return operation(paths, async () => { const results = await remote.remove(paths); for (const p of paths) changed(p); return { results }; });
    }
    if (op === 'start') {
      return { ids: await start(args) };
    }
    if (op === 'cancel') { queue.cancel(args.id); return {}; }
    if (op === 'decide') { queue.decide(args.id, args.choice, args.all); return {}; }
    if (op === 'retry') {
      const config = state.retryConfigs.get(args.id) || queue.config(args.id);
      if (!config || queue.list().some(job => job.id === args.id && !['complete','partial','failed','cancelled'].includes(job.status))) throw new FileError('BUSY');
      return { ids: await start(config) };
    }
    throw new FileError('INVALID_PATH');
  }));
  return {
    blocksSsl(id) { return [...owners.values()].some(data => [...data.states.entries()].some(([key,state]) => key === id && state.conn === sessions.connection(id) && (state.queue.active() || state.operations.size || state.editor?.dirty))); },
    hasActive(sender, id) { const data = owners.get(sender); return Boolean(data && [...data.states.entries()].some(([key,s]) => (!id || key === id) && s.queue.active())); },
    hasDirty(sender, id) { const data = owners.get(sender); return Boolean(data && [...data.states.entries()].some(([key,s]) => (!id || key === id) && s.editor?.dirty)); },
    dispose(id) { for (const data of owners.values()) for (const [key,state] of data.states) if (!id || id === key) { state.queue.dispose(); state.editor = null; } },
  };
}
module.exports = { registerFilesIpc };
