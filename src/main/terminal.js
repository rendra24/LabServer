const { randomUUID } = require('node:crypto');
const { validId, DOCKER } = require('./docker-ops');
const { shq } = require('./tool-runner');

const invalid = { ok: false, code: 'INVALID_REQUEST', message: 'Permintaan terminal tidak valid.' };
const closed = { ok: false, code: 'TERMINAL_CLOSED', message: 'Terminal sudah ditutup. Buka terminal baru untuk melanjutkan.' };
const validSize = (size) => size && Number.isInteger(size.cols) && size.cols >= 2 && size.cols <= 500 && Number.isInteger(size.rows) && size.rows >= 1 && size.rows <= 300;
const HIGH_WATER = 262144;
const LOW_WATER = 131072;

/** PTY independen di koneksi SSH yang ada; tidak membuka shell lokal atau mencatat input. */
function createTerminal(conn, { onEvent = () => {}, username } = {}) {
  const active = new Map();
  let disposed = false;

  function emit(state, event) {
    try { return onEvent({ sessionId: state.id, requestId: state.requestId, ...event }) !== false; }
    catch { return false; }
  }

  function finish(state, reason = 'exit') {
    if (state.closed) return;
    state.closed = true;
    active.delete(state.id);
    emit(state, { type: 'exit', code: state.code, reason });
  }

  function close(state, reason = 'close') {
    if (!state || state.closed) return;
    finish(state, reason);
    state.stream?.close();
  }

  function open(size) {
    if (!validSize(size)) return invalid;
    if (size.containerId !== undefined ? (!validId(size.containerId) || (size.shell !== undefined && !['/bin/sh','/bin/bash'].includes(size.shell)) || (size.sudo !== undefined && typeof size.sudo !== 'boolean')) : (size.shell !== undefined || size.sudo !== undefined)) return invalid;
    if (size.requestId !== undefined && (typeof size.requestId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(size.requestId) || [...active.values()].some(s => s.requestId === size.requestId))) return invalid;
    if (disposed) return { ok: false, code: 'NOT_CONNECTED', message: 'Koneksi SSH sudah ditutup. Hubungkan ulang.' };
    if (active.size >= 8) return { ok: false, code: 'TERMINAL_LIMIT', message: 'Maksimal 8 sesi shell aktif per VPS. Tutup salah satu sesi untuk membuka terminal baru.' };
    const state = { id: randomUUID(), requestId: size.requestId, stream: null, pending: 0, closed: false, code: null };
    active.set(state.id, state);
    return new Promise((resolve) => {
      const ready = (error, stream) => {
        if (state.closed || disposed || active.get(state.id) !== state) {
          stream?.close();
          return resolve(closed);
        }
        if (error) {
          active.delete(state.id);
          state.closed = true;
          return resolve({ ok: false, code: 'TERMINAL_OPEN_FAILED', message: 'Shell SSH tidak dapat dibuka. Periksa izin shell user di server.' });
        }
        state.stream = stream;
        const output = (chunk) => {
          if (state.closed) return;
          const buffer = Buffer.from(chunk);
          for (let offset = 0; offset < buffer.length; offset += 32768) {
            const data = Uint8Array.from(buffer.subarray(offset, offset + 32768));
            state.pending += data.byteLength;
            if (!emit(state, { type: 'data', data })) return close(state);
          }
          if (state.pending >= HIGH_WATER) {
            stream.pause();
            stream.stderr?.pause();
          }
        };
        stream.on('data', output);
        stream.stderr?.on('data', output);
        stream.once('exit', (code) => { state.code = code ?? null; });
        stream.once('close', () => finish(state));
        stream.on('error', () => {
          if (state.closed) return;
          emit(state, { type: 'error', message: 'Channel terminal terputus. Buka ulang terminal untuk melanjutkan.' });
          close(state);
        });
        stream.stderr?.on('error', () => close(state));
        resolve({ ok: true, sessionId: state.id });
      };
      try {
        const pty = { term: 'xterm-256color', cols: size.cols, rows: size.rows };
        if (size.containerId) conn.client.exec(`${size.sudo && username !== 'root' ? 'sudo -- ' : ''}${DOCKER} container exec -it -- ${shq(size.containerId)} ${shq(size.shell || '/bin/sh')}`, { pty }, ready);
        else conn.client.shell(pty, ready);
      }
      catch (error) { ready(error); }
    });
  }

  return {
    dispose() { disposed = true; for (const state of active.values()) close(state, 'disconnect'); },
    request(op, ...args) {
      if (!['open', 'write', 'resize', 'close', 'ack'].includes(op)) return invalid;
      if (op === 'open') return args.length === 1 ? open(args[0]) : invalid;
      const [sessionId, value] = args;
      const state = active.get(sessionId);
      if (!state || state.closed || state.id !== sessionId || !state.stream) return closed;
      if (op === 'close') { close(state); return { ok: true }; }
      if (op === 'ack') {
        if (!Number.isInteger(value) || value < 1 || value > state.pending) return invalid;
        state.pending -= value;
        if (state.pending <= LOW_WATER) {
          state.stream.resume();
          state.stream.stderr?.resume();
        }
        return { ok: true };
      }
      if (op === 'resize') {
        if (!validSize(value)) return invalid;
        try { state.stream.setWindow(value.rows, value.cols, 0, 0); return { ok: true }; }
        catch { return closed; }
      }
      if (!(value instanceof Uint8Array) || value.byteLength > 65536) return invalid;
      return new Promise((resolve) => {
        try { state.stream.write(Buffer.from(value), (error) => resolve(error ? closed : { ok: true })); }
        catch { resolve(closed); }
      });
    },
  };
}

module.exports = { createTerminal };
