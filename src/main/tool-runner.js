const { remoteCommand, RemoteCommandError } = require('./remote-command');
const MESSAGES = {
  INVALID_REQUEST: 'Permintaan tidak valid.', CANCELLED: 'Operasi dibatalkan.', BUSY: 'Operasi masih berjalan. Tunggu hingga selesai.',
  DOCKER_MISSING: 'Docker belum tersedia di VPS. Buka panduan instalasi Docker.', DOCKER_OFFLINE: 'Docker daemon tidak dapat dihubungi pada socket lokal VPS.',
  CERTBOT_MISSING: 'Certbot belum tersedia di VPS. Buka panduan instalasi Certbot dan plugin Nginx.', NGINX_MISSING: 'Binary Nginx tidak tersedia. Periksa pengaturan server.',
  PERMISSION_DENIED: 'Akses ditolak. Gunakan sudo atau periksa izin akun SSH.', SUDO_PASSWORD_REQUIRED: 'Password sudo diperlukan. Jalankan kembali untuk melanjutkan.',
  SUDO_BAD_PASSWORD: 'Password sudo salah. Silakan coba kembali.', SUDO_DENIED: 'Akun SSH tidak diizinkan menjalankan operasi ini melalui sudo.',
  CONTAINER_GONE: 'Container tidak ditemukan. Muat ulang daftar container.', BAD_RESPONSE: 'Respons server tidak dapat dibaca. Periksa versi Docker atau Certbot.',
  OUTPUT_LIMIT: 'Output melewati batas ukuran. Gunakan terminal untuk pemeriksaan lebih lanjut.', TIMEOUT: 'Batas waktu terlewati. Periksa status di VPS sebelum mengulangi tindakan; perubahan mungkin sudah dijalankan.',
  NOT_CONNECTED: 'Koneksi SSH terputus. Hubungkan ulang ke server.', COMMAND_FAILED: 'Operasi di VPS gagal. Periksa status layanan dan izin akun SSH.',
  NGINX_INVALID: 'Konfigurasi Nginx gagal diperiksa. Perbaiki konfigurasi sebelum memasang SSL.', NGINX_ROOT: 'Konfigurasi Nginx belum didukung. Pemasangan SSL memerlukan --conf-path absolut dengan nama file nginx.conf. Periksa binary dan konfigurasi Nginx.',
  CERTIFICATE_CONFLICT: 'Nama sertifikat sudah dipakai dengan cakupan domain berbeda. Perpanjang sertifikat yang ada atau periksa melalui Certbot.', CERTIFICATE_GONE: 'Sertifikat tidak ditemukan. Muat ulang daftar sertifikat.',
  SSL_FAILED: 'Certbot gagal. Konfigurasi atau sertifikat mungkin sudah berubah sebagian. Periksa Nginx dan log Certbot di VPS sebelum mencoba kembali.',
};
class ToolError extends Error { constructor(code) { super(MESSAGES[code] || MESSAGES.COMMAND_FAILED); this.code = code; } }
const shq = value => `'${String(value).replace(/'/g, "'\\''")}'`;
function checkResult(result, tool) {
  if (result.truncated) throw new ToolError('OUTPUT_LIMIT');
  if (result.code === 0) return result;
  const text = result.stderr || '';
  if (result.code === 127 || /command not found|: not found/i.test(text)) throw new ToolError(tool === 'docker' ? 'DOCKER_MISSING' : tool === 'certbot' ? 'CERTBOT_MISSING' : tool === 'nginx' ? 'NGINX_MISSING' : 'COMMAND_FAILED');
  if (/incorrect password|Sorry, try again|no password was provided/i.test(text)) throw new ToolError('SUDO_BAD_PASSWORD');
  if (/not in the sudoers|not allowed to execute|may not run sudo|must have a tty/i.test(text)) throw new ToolError('SUDO_DENIED');
  if (/a password is required|a terminal is required|no tty present|askpass/i.test(text)) throw new ToolError('SUDO_PASSWORD_REQUIRED');
  if (/permission denied|access denied|not authorized/i.test(text)) throw new ToolError('PERMISSION_DENIED');
  if (/Cannot connect to the Docker daemon|Is the docker daemon running|connection refused|error during connect/i.test(text)) throw new ToolError('DOCKER_OFFLINE');
  if (/No such container|No such object/i.test(text)) throw new ToolError('CONTAINER_GONE');
  if (/Another instance of Certbot/i.test(text)) throw new ToolError('BUSY');
  throw new ToolError(tool === 'certbot' ? 'SSL_FAILED' : 'COMMAND_FAILED');
}
function createToolRunner(conn, profile) {
  const lifetime = new AbortController();
  let password = null, pending = 0;
  async function run(command, context = {}, options = {}) {
    const signal = AbortSignal.any([lifetime.signal, ...(context.signal ? [context.signal] : [])]);
    if (signal.aborted) throw new ToolError('CANCELLED');
    if (pending >= 4) throw new ToolError('BUSY');
    pending++;
    try { return await remoteCommand(conn, command, { ...options, signal }); }
    catch (error) { if (signal.aborted) throw new ToolError('CANCELLED'); if (error instanceof RemoteCommandError) throw new ToolError(error.code); throw new ToolError('COMMAND_FAILED'); }
    finally { pending--; }
  }
  return {
    run,
    async privileged(command, context = {}, options = {}) {
      if (profile.username === 'root') return run(command, context, options);
      let result = await run(`sudo -n -- ${command}`, context, options);
      if (result.code !== 0 && /a password is required|a terminal is required|no tty present|askpass/i.test(result.stderr)) {
        const signal = AbortSignal.any([lifetime.signal, ...(context.signal ? [context.signal] : [])]);
        const answer = password ?? await context.askSudoPassword?.(signal);
        if (signal.aborted) throw new ToolError('CANCELLED');
        if (!answer) throw new ToolError('SUDO_PASSWORD_REQUIRED');
        if (typeof answer !== 'string' || answer.length > 4096 || /[\r\n\0]/.test(answer)) throw new ToolError('SUDO_BAD_PASSWORD');
        result = await run(`sudo -S -p '' -- ${command}`, context, { ...options, stdin: `${answer}\n` });
        if (/incorrect password|Sorry, try again|no password was provided/i.test(result.stderr)) { password = null; throw new ToolError('SUDO_BAD_PASSWORD'); }
        if (result.code === 0) password = answer;
      }
      return result;
    },
    dispose() { password = null; lifetime.abort(); },
  };
}
module.exports = { createToolRunner, ToolError, shq, checkResult };
