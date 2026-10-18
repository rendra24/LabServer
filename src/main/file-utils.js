const path = require('node:path');
const crypto = require('node:crypto');

const MESSAGES = {
  INVALID_PATH: 'Path atau nama file tidak valid.', GRANT_REQUIRED: 'Pilih folder lokal terlebih dahulu.',
  ACCESS_DENIED: 'Akses ditolak. Periksa hak akses akun SSH atau folder lokal.', NOT_FOUND: 'File atau folder tidak ditemukan.',
  EXISTS: 'Nama tersebut sudah digunakan.', CHANGED: 'File berubah sejak dibuka. Muat ulang atau pilih timpa secara eksplisit.',
  UNSUPPORTED: 'Server tidak mendukung penggantian file secara aman. File lama tetap utuh.',
  NOT_TEXT: 'Editor hanya mendukung teks UTF-8 hingga 1 MiB. Gunakan download untuk file ini.',
  CANCELLED: 'Transfer dibatalkan.', DISCONNECTED: 'Koneksi SSH terputus. Hubungkan ulang untuk melanjutkan.',
  BUSY: 'Item sedang dipakai oleh editor atau transfer. Selesaikan operasi tersebut terlebih dahulu.',
};
class FileError extends Error {
  constructor(code, message) { super(message || MESSAGES[code] || 'Operasi file gagal. Periksa koneksi, hak akses, dan ruang penyimpanan.'); this.code = code; }
}
function failure(error) {
  if (error instanceof FileError) return { ok: false, code: error.code, message: error.message };
  const code = [2, 'ENOENT'].includes(error?.code) ? 'NOT_FOUND' : [3, 'EACCES', 'EPERM'].includes(error?.code) ? 'ACCESS_DENIED' : error?.code === 'EEXIST' ? 'EXISTS' : 'FAILED';
  return { ok: false, code, message: new FileError(code).message };
}
function safeName(name) {
  if (typeof name !== 'string' || !name || ['.', '..'].includes(name) || name.includes('/') || name.includes('\0') || Buffer.byteLength(name) > 255) throw new FileError('INVALID_PATH');
  return name;
}
function safeLocalName(name, platform = process.platform) {
  safeName(name);
  if (name.includes('\\') || (platform === 'win32' && (/[<>:"|?*]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32) || /[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)))) throw new FileError('INVALID_PATH');
  return name;
}
function remotePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0') || value.length > 8192) throw new FileError('INVALID_PATH');
  return path.posix.normalize(value);
}
const call = (s, method, ...args) => new Promise((resolve, reject) => s[method](...args, (err, data) => err ? reject(err) : resolve(data)));
const revision = attrs => attrs ? JSON.stringify([attrs.size, attrs.mtimeMs ?? attrs.mtime, attrs.mode, attrs.uid, attrs.gid]) : null;
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function metadata(name, attrs) {
  const mode = attrs.mode || 0;
  return { name, size: attrs.size || 0, mtime: attrs.mtimeMs ?? (attrs.mtime || 0) * 1000, mode: (mode & 0o7777).toString(8), uid: attrs.uid, gid: attrs.gid, type: (mode & 0o170000) === 0o040000 ? 'directory' : (mode & 0o170000) === 0o120000 ? 'link' : (mode & 0o170000) === 0o100000 ? 'file' : 'other' };
}
module.exports = { FileError, failure, safeName, safeLocalName, remotePath, call, revision, digest, metadata };
