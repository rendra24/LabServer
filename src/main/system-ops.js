const path = require('node:path').posix;
const { remoteCommand, RemoteCommandError } = require('./remote-command');
const UNIT = /^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,240}\.service$/;
const ENV = 'env LC_ALL=C SYSTEMD_COLORS=0 SYSTEMD_PAGER=cat';
const MESSAGES = {
  INVALID_REQUEST: 'Permintaan layanan atau log tidak valid.', CANCELLED: 'Operasi dibatalkan.', BUSY: 'Operasi masih diproses. Tunggu hingga selesai.',
  UNSUPPORTED: 'Server ini tidak menyediakan systemd atau journalctl. Fitur ini membutuhkan Linux dengan systemd.',
  PERMISSION_DENIED: 'Akses ditolak. Gunakan opsi sudo untuk log atau periksa izin akun SSH.',
  SUDO_PASSWORD_REQUIRED: 'Password sudo diperlukan. Muat ulang atau jalankan tindakan kembali untuk melanjutkan.',
  SUDO_BAD_PASSWORD: 'Password sudo salah. Silakan coba kembali.', SUDO_DENIED: 'Akun SSH tidak diizinkan menjalankan operasi ini melalui sudo.',
  FILE_NOT_FOUND: 'File log tidak ditemukan atau bukan file biasa. Periksa path file di VPS.',
  UNIT_NOT_FOUND: 'Layanan tidak ditemukan di server. Muat ulang daftar layanan.',
  COMMAND_FAILED: 'Operasi di server gagal. Periksa status layanan atau baca jurnal layanan untuk detail.',
  OUTPUT_LIMIT: 'Daftar layanan melewati batas ukuran. Periksa layanan di server melalui terminal.',
  TIMEOUT: 'Batas waktu operasi terlewati. Periksa status layanan sebelum mengulangi tindakan.', NOT_CONNECTED: 'Koneksi SSH terputus. Hubungkan ulang ke server.',
};
class SystemError extends Error { constructor(code) { super(MESSAGES[code] || MESSAGES.COMMAND_FAILED); this.code = code; } }
const invalid = () => { throw new SystemError('INVALID_REQUEST'); };
const shq = value => `'${value.replace(/'/g, "'\\''")}'`;
function unitName(value, allowEmpty = false) {
  if (allowEmpty && value === '') return '';
  if (typeof value !== 'string') invalid();
  if (/\.(target|socket|timer|mount|automount|device|path|slice|scope)$/.test(value)) invalid();
  const unit = value.endsWith('.service') ? value : `${value}.service`;
  if (!UNIT.test(unit) || /@\.service$/.test(unit)) invalid();
  return unit;
}
function validate(op, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  if (op === 'services') return {};
  if (op === 'detail') return { unit: unitName(input.unit) };
  if (op === 'action') {
    if (!['start', 'stop', 'restart'].includes(input.action)) invalid();
    return { unit: unitName(input.unit), action: input.action };
  }
  if (op !== 'logs' || !['journal', 'nginx-access', 'nginx-error', 'file'].includes(input.source) || ![100, 300, 500, 1000].includes(input.lines)) invalid();
  if (input.sudo !== undefined && typeof input.sudo !== 'boolean') invalid();
  const priority = input.priority ?? 'all';
  if (!['all', 'err', 'warning'].includes(priority)) invalid();
  const result = { source: input.source, lines: input.lines, sudo: input.sudo === true, priority };
  if (input.source === 'journal') result.unit = unitName(input.unit ?? '', true);
  if (input.source === 'file') {
    if (typeof input.path !== 'string' || !path.isAbsolute(input.path) || input.path.length > 4096 || [...input.path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || input.path.split('/').includes('..')) invalid();
    result.path = input.path;
  }
  return result;
}
function parseServices(units, files) {
  const services = new Map();
  for (const line of files.split('\n')) {
    const [name, startup] = line.trim().split(/\s+/);
    if (UNIT.test(name)) services.set(name, { name, description: '', load: 'not-loaded', active: 'inactive', sub: 'dead', startup, template: /@\.service$/.test(name) });
  }
  for (const line of units.split('\n')) {
    const [name, load, active, sub, ...description] = line.trim().replace(/^●\s*/, '').split(/\s+/);
    if (UNIT.test(name) && active && sub) services.set(name, { ...services.get(name), name, load, active, sub, description: description.join(' '), startup: services.get(name)?.startup || '—', template: /@\.service$/.test(name) });
  }
  return [...services.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function checkResult(result) {
  if (result.truncated) throw new SystemError('OUTPUT_LIMIT');
  if (result.code === 0) return result;
  const text = result.stderr;
  if (result.code === 127 || /not been booted with systemd|Failed to connect to bus|command not found|systemctl: not found|journalctl: not found/i.test(text)) throw new SystemError('UNSUPPORTED');
  if (/incorrect password|Sorry, try again|no password was provided/i.test(text)) throw new SystemError('SUDO_BAD_PASSWORD');
  if (/not in the sudoers|not allowed to execute|may not run sudo|must have a tty/i.test(text)) throw new SystemError('SUDO_DENIED');
  if (/a password is required|a terminal is required|no tty present|askpass/i.test(text)) throw new SystemError('SUDO_PASSWORD_REQUIRED');
  if (/permission denied|access denied|not authorized/i.test(text)) throw new SystemError('PERMISSION_DENIED');
  if (result.code === 66 || /No such file|cannot open/i.test(text)) throw new SystemError('FILE_NOT_FOUND');
  if (/not found|does not exist|not loaded/i.test(text)) throw new SystemError('UNIT_NOT_FOUND');
  throw new SystemError('COMMAND_FAILED');
}
function createSystemOps(conn, profile) {
  const lifetime = new AbortController(), mutations = new Set();
  let sudoPassword = null, active = 0;
  async function execute(command, context, options = {}) {
    context.signal.throwIfAborted();
    return remoteCommand(conn, command, { ...options, signal: context.signal });
  }
  async function privileged(command, context, options) {
    if (profile.username === 'root') return execute(command, context, options);
    let result = await execute(`sudo -n -- ${command}`, context, options);
    if (result.code !== 0 && /a password is required|a terminal is required|no tty present|askpass/i.test(result.stderr)) {
      const password = sudoPassword ?? await context.askSudoPassword?.(context.signal);
      context.signal.throwIfAborted();
      if (!password) throw new SystemError('SUDO_PASSWORD_REQUIRED');
      if (typeof password !== 'string' || /[\r\n\0]/.test(password)) throw new SystemError('SUDO_BAD_PASSWORD');
      result = await execute(`sudo -S -p '' -- ${command}`, context, { ...options, stdin: `${password}\n` });
      if (/incorrect password|Sorry, try again|no password was provided/i.test(result.stderr)) { sudoPassword = null; throw new SystemError('SUDO_BAD_PASSWORD'); }
      if (result.code === 0) sudoPassword = password;
    }
    return result;
  }
  async function detail(unit, context) {
    const properties = 'Id,Description,LoadState,ActiveState,SubState,UnitFileState,MainPID,MemoryCurrent,ActiveEnterTimestamp,FragmentPath,ExecMainStatus';
    const result = checkResult(await execute(`${ENV} systemctl --no-pager show --property=${properties} -- ${shq(unit)}`, context));
    const values = Object.fromEntries(result.stdout.split('\n').filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    if (!values.Id || values.LoadState === 'not-found') throw new SystemError('UNIT_NOT_FOUND');
    return { name: values.Id, description: values.Description || '', load: values.LoadState, active: values.ActiveState, sub: values.SubState, startup: values.UnitFileState || '—', pid: Number(values.MainPID) || 0, memory: /^\d+$/.test(values.MemoryCurrent || '') && Number(values.MemoryCurrent) < Number.MAX_SAFE_INTEGER ? Number(values.MemoryCurrent) : null, since: values.ActiveEnterTimestamp || '', path: values.FragmentPath || '', exitStatus: values.ExecMainStatus || '' };
  }
  return {
    dispose() { sudoPassword = null; lifetime.abort(); },
    async request(op, input = {}, context = {}) {
      const args = validate(op, input);
      if (lifetime.signal.aborted || context.signal?.aborted) throw new SystemError('CANCELLED');
      if (active >= 4 || (op === 'action' && mutations.has(args.unit))) throw new SystemError('BUSY');
      const signal = AbortSignal.any([lifetime.signal, ...(context.signal ? [context.signal] : [])]);
      const scope = { ...context, signal };
      active++; if (op === 'action') mutations.add(args.unit);
      try {
        if (op === 'services') {
          const units = checkResult(await execute(`${ENV} systemctl list-units --type=service --all --plain --no-legend --no-pager`, scope));
          const files = checkResult(await execute(`${ENV} systemctl list-unit-files --type=service --no-legend --no-pager`, scope));
          return { services: parseServices(units.stdout, files.stdout) };
        }
        if (op === 'detail') return await detail(args.unit, scope);
        if (op === 'action') {
          if (!await scope.confirm?.(args.action, args.unit)) throw new SystemError('CANCELLED');
          signal.throwIfAborted();
          checkResult(await privileged(`${ENV} systemctl --no-pager --no-ask-password ${args.action} -- ${shq(args.unit)}`, scope, { timeoutMs: 60000 }));
          try { return await detail(args.unit, scope); }
          catch (error) { if (signal.aborted) throw error; return { name: args.unit, active: 'unknown', sub: '', notice: 'Tindakan selesai. Muat ulang daftar untuk memeriksa status terbaru.' }; }
        }
        let command;
        if (args.source === 'journal') command = `${ENV} journalctl --no-pager --output=short-iso -n ${args.lines}${args.unit ? ` --unit=${shq(args.unit)}` : ''}${args.priority !== 'all' ? ` --priority=${shq(args.priority)}` : ''}`;
        else {
          const file = args.source === 'file' ? args.path : `/var/log/nginx/${args.source === 'nginx-access' ? 'access' : 'error'}.log`;
          command = `${ENV} sh -c ${shq(`if [ -f ${shq(file)} ]; then tail -n ${args.lines} -- ${shq(file)}; else exit 66; fi`)}`;
        }
        const options = { maxBytes: 512 * 1024, timeoutMs: 15000 };
        const result = args.sudo ? await privileged(command, scope, options) : await execute(command, scope, options);
        if (!result.truncated) checkResult(result);
        const restricted = args.source === 'journal' && /not seeing|permission|inaccessible|No journal files/i.test(result.stderr);
        return { text: result.stdout.replace(/^-- No entries --\s*$/, ''), truncated: result.truncated, notice: result.truncated ? 'Output dibatasi 512 KiB. Kurangi jumlah baris atau gunakan terminal untuk log lebih besar.' : restricted ? 'Akun SSH mungkin hanya dapat membaca sebagian jurnal. Aktifkan Gunakan sudo untuk membaca log sistem.' : '', lines: args.lines, source: args.source };
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') throw new SystemError('CANCELLED');
        if (error instanceof RemoteCommandError) throw new SystemError(error.code);
        if (error instanceof SystemError) throw error;
        throw new SystemError('COMMAND_FAILED');
      } finally { active--; if (op === 'action') mutations.delete(args.unit); }
    },
  };
}
module.exports = { createSystemOps, parseServices, SystemError };
