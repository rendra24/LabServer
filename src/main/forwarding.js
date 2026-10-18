const net = require('node:net');
const { TunnelError, validateTunnel } = require('./forwarding-config');

function createForwarding(conn, onChange = () => {}) {
  const entries = new Map();
  const reservations = new Set();
  let disposed = false;
  const notify = () => { try { onChange(); } catch { /* Renderer may already be closed. */ } };
  const current = entry => !disposed && entries.get(entry.config.id) === entry;
  const active = () => [...entries.values()].filter(e => ['starting','listening'].includes(e.status));
  function stop(id) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    entry.cancelStart?.(); entry.listener.close();
    for (const pair of [...entry.clients]) pair.finish();
    notify();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const id of [...entries.keys()]) stop(id);
    reservations.clear();
    conn.client.removeListener('close', dispose);
  }
  conn.client.once('close', dispose);
  function accept(entry, socket) {
    socket.on('error', () => {});
    if (!current(entry) || entry.status !== 'listening') { socket.destroy(); return; }
    if ([...reservations].filter(pair=>pair.entry.config.id===entry.config.id).length >= 32 || reservations.size >= 128) {
      entry.lastError='Batas koneksi tunnel tercapai. Tunggu koneksi/channel sebelumnya selesai atau hubungkan ulang SSH jika server tidak menjawab.';socket.destroy();notify();return;
    }
    const pair = { entry, socket, channel: null, closed: false, opening: true, timer: null };
    pair.finish = () => {
      if (pair.closed) return;
      pair.closed = true; clearTimeout(pair.timer); entry.clients.delete(pair);
      // ssh2 retains unanswered forwardOut callbacks until a reply or SSH close.
      if (!pair.opening) reservations.delete(pair);
      socket.destroy(); pair.channel?.destroy(); notify();
    };
    const fail = () => { if (current(entry)) entry.lastError = 'Koneksi ke tujuan tunnel gagal atau ditolak. Periksa layanan tujuan dan izin TCP forwarding SSH.'; pair.finish(); };
    entry.clients.add(pair); reservations.add(pair); notify();
    socket.once('close', pair.finish); socket.once('error', fail);
    pair.timer = setTimeout(fail, 15000); pair.timer.unref?.();
    try {
      conn.client.forwardOut(socket.remoteAddress || '127.0.0.1', socket.remotePort || 0, entry.config.remoteHost, entry.config.remotePort, (error, channel) => {
        pair.opening = false;
        if (pair.closed) reservations.delete(pair);
        if (pair.closed || !current(entry) || socket.destroyed) { channel?.on('error', () => {}); channel?.destroy(); return; }
        clearTimeout(pair.timer);
        if (error || !channel) { fail(); return; }
        pair.channel = channel; channel.on('error', fail); channel.once('close', pair.finish);
        entry.lastError = ''; socket.setNoDelay(true);
        socket.pipe(channel); channel.pipe(socket); notify();
      });
    } catch { pair.opening=false;fail(); }
  }
  return {
    list: () => [...entries.values()].map(e => ({id:e.config.id,status:e.status,connections:e.clients.size,lastError:e.lastError})),
    hasActive: () => active().length > 0,
    stop, dispose,
    async start(input) {
      const config = validateTunnel(input);
      if (disposed) throw new TunnelError('NOT_CONNECTED');
      if (entries.has(config.id) && entries.get(config.id).status !== 'error') throw new TunnelError('BUSY');
      if (active().length >= 8) throw new TunnelError('TUNNEL_LIMIT');
      if (entries.has(config.id)) stop(config.id);
      const entry = {config,status:'starting',clients:new Set(),lastError:''};
      entry.listener = net.createServer({allowHalfOpen:true}, socket => accept(entry,socket));
      entries.set(config.id,entry); notify();
      await new Promise((resolve,reject) => {
        entry.cancelStart = () => reject(new TunnelError('NOT_CONNECTED'));
        entry.listener.on('error', error => {
          const failure = new TunnelError(error.code === 'EADDRINUSE' ? 'PORT_IN_USE' : 'BIND_FAILED');
          if (current(entry)) { entry.status = 'error'; entry.lastError = failure.message; for (const pair of [...entry.clients]) pair.finish(); notify(); }
          reject(failure);
        });
        entry.listener.once('listening', () => {
          entry.cancelStart = null;
          if (!current(entry)) { entry.listener.close(); reject(new TunnelError('NOT_CONNECTED')); return; }
          entry.status = 'listening'; notify(); resolve();
        });
        entry.listener.listen({port:config.localPort,host:'127.0.0.1'});
      });
    },
  };
}
module.exports = { createForwarding };
