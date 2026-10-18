const { EventEmitter } = require('node:events');
function toolSsh(handler) {
  const commands = [], streams = [];
  const conn = { client: new EventEmitter(), end() { this.client.emit('close'); } };
  conn.client.exec = (command, options, callback) => {
    if (typeof options === 'function') { callback = options; options = undefined; }
    const stream = new EventEmitter(); stream.stderr = new EventEmitter();
    stream.close = () => { if (!stream.closed) { stream.closed = true; stream.emit('close', null); } };
    stream.end = stdin => setImmediate(async () => {
      commands.push({ command, stdin, options });
      const result = await handler(command, stdin, stream, options);
      if (result === null || stream.closed) return;
      if (result.stdout) stream.emit('data', Buffer.from(result.stdout));
      if (result.stderr) stream.stderr.emit('data', Buffer.from(result.stderr));
      stream.emit('close', result.code ?? 0);
    });
    streams.push(stream); callback(null, stream);
  };
  return { conn, commands, streams };
}
module.exports = { toolSsh };
