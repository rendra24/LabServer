class RemoteCommandError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function remoteCommand(conn, command, { stdin, signal, maxBytes = 1048576, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let stream, settled = false, bytes = 0;
    const stdout = [], stderr = [];
    const finish = (error, code, truncated = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), truncated });
    };
    const stop = code => { finish(new RemoteCommandError(code)); stream?.close(); };
    const abort = () => stop('CANCELLED');
    const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      conn.client.exec(command, (error, channel) => {
        if (settled) { channel?.close(); return; }
        if (error) { finish(new RemoteCommandError(/not connected|socket|channel open failure/i.test(error.message) ? 'NOT_CONNECTED' : 'COMMAND_FAILED')); return; }
        stream = channel;
        const append = (chunks, data) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          const available = maxBytes - bytes;
          if (available > 0) { const part = Buffer.from(buffer.subarray(0, available)); chunks.push(part); bytes += part.length; }
          if (buffer.length > available) { finish(null, null, true); channel.close(); }
        };
        channel.on('data', data => append(stdout, data));
        channel.stderr.on('data', data => append(stderr, data));
        channel.on('error', () => stop('COMMAND_FAILED'));
        channel.stderr.on('error', () => stop('COMMAND_FAILED'));
        channel.on('close', code => finish(null, code));
        channel.end(stdin ?? undefined);
      });
    } catch { stop('NOT_CONNECTED'); }
  });
}
module.exports = { remoteCommand, RemoteCommandError };
