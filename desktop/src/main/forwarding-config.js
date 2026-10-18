const net = require('node:net');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
class TunnelError extends Error {
  constructor(code) {
    super({ TUNNEL_INVALID:'Profil tunnel tidak valid. Isi label, port lokal 1024–65535, host tujuan, dan port tujuan 1–65535.', PORT_IN_USE:'Port lokal sedang dipakai. Hentikan tunnel lain atau pilih port berbeda.', BIND_FAILED:'Port lokal tidak dapat dibuka. Periksa izin atau pilih port lain.', TUNNEL_LIMIT:'Maksimal 8 tunnel aktif per server.', BUSY:'Hentikan tunnel dan tunggu operasi sebelumnya selesai sebelum mengubah profil.', NOT_CONNECTED:'Koneksi SSH terputus. Hubungkan ulang untuk melanjutkan.', NOT_FOUND:'Profil tunnel tidak ditemukan.' }[code] || 'Tunnel gagal diproses.');
    this.code = code;
  }
}
function validateTunnel(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TunnelError('TUNNEL_INVALID');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const remoteHost = typeof input.remoteHost === 'string' ? input.remoteHost.trim() : '';
  const localPort = Number(input.localPort), remotePort = Number(input.remotePort);
  if (!UUID.test(input.id || '') || !name || name.length > 64 || [...name].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127) || !(net.isIP(remoteHost) || HOST.test(remoteHost)) || !Number.isInteger(localPort) || localPort < 1024 || localPort > 65535 || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535 || (input.bindHost !== undefined && input.bindHost !== '127.0.0.1')) throw new TunnelError('TUNNEL_INVALID');
  return { id: input.id, name, localPort, remoteHost, remotePort };
}
function validateTunnels(input) {
  if (!Array.isArray(input) || input.length > 32) throw new TunnelError('TUNNEL_INVALID');
  const ids = new Set(), ports = new Set();
  return input.map(value => {
    const entry = validateTunnel(value);
    if (ids.has(entry.id) || ports.has(entry.localPort)) throw new TunnelError('TUNNEL_INVALID');
    ids.add(entry.id); ports.add(entry.localPort); return entry;
  });
}
module.exports = { TunnelError, validateTunnel, validateTunnels };
