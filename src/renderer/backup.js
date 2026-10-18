import { $, announce, busy } from './ui.js';
import { renderServers } from './servers.js';

const api = window.api.backup;
const dialog = $('backup-dialog');
let mode = 'export';
let token = null;
let working = false;

function clearPasswords() {
  $('backup-password').value = '';
  $('backup-confirm').value = '';
}

function discard() {
  if (token) api.discard(token).catch(() => {});
  token = null;
}

function selectMode(next) {
  discard();
  clearPasswords();
  mode = next;
  $('backup-preview').hidden = true;
  $('backup-password-fields').hidden = false;
  $('backup-confirm-row').hidden = mode !== 'export';
  $('backup-password').autocomplete = mode === 'export' ? 'new-password' : 'current-password';
  $('backup-description').textContent = mode === 'export'
    ? 'Profil server dan tunnel, password/passphrase, private key SSH, serta memo dan API Token Cloudflare disertakan dalam file terenkripsi. Konfigurasi VPS dan record DNS tidak disalin.'
    : 'Pilih file .lsb atau .labserver menggunakan password saat backup dibuat. Anda dapat meninjau isinya sebelum menerapkan restore.';
  $('backup-submit').textContent = mode === 'export' ? 'Simpan backup…' : 'Pilih file backup…';
  $('backup-error').textContent = '';
  $('backup-result').hidden = true;
  for (const name of ['export', 'restore']) $(`backup-tab-${name}`).setAttribute('aria-pressed', String(mode === name));
  $('backup-password').focus();
}

$('backup-open').addEventListener('click', () => {
  dialog.showModal();
  selectMode('export');
});
for (const name of ['export', 'restore']) $(`backup-tab-${name}`).addEventListener('click', () => selectMode(name));
dialog.addEventListener('close', () => { discard(); clearPasswords(); });
dialog.addEventListener('cancel', (event) => { if (working) event.preventDefault(); });

$('backup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (working) return;
  $('backup-error').textContent = '';
  $('backup-result').hidden = true;
  const password = $('backup-password').value;
  const confirmation = $('backup-confirm').value;
  if (!token && (password.length < 12 || new TextEncoder().encode(password).length > 1024)) {
    $('backup-error').textContent = 'Password backup minimal 12 karakter dan maksimal 1.024 byte.';
    $('backup-password').focus();
    return;
  }
  if (mode === 'export' && password !== confirmation) {
    $('backup-error').textContent = 'Konfirmasi password backup tidak sama.';
    $('backup-confirm').focus();
    return;
  }
  working = true;
  const controls = [...dialog.querySelectorAll('[data-close], .backup-tabs button, #backup-restore-mode')];
  controls.forEach((button) => { button.disabled = true; });
  let result;
  const restoring = Boolean(token);
  try {
    result = await busy($('backup-submit'), restoring ? 'Memulihkan…' : 'Memproses…', () => {
      if (mode === 'export') return api.export(password, confirmation);
      return token ? api.restore(token, $('backup-restore-mode').value) : api.inspect(password);
    });
    if (!result.ok) {
      if (!result.cancelled) $('backup-error').textContent = result.message;
      if (restoring) {
        discard();
        $('backup-preview').hidden = true;
        $('backup-password-fields').hidden = false;
        $('backup-submit').textContent = 'Pilih file backup…';
      }
      return;
    }
    if (mode === 'restore' && !restoring) {
      token = result.token;
      const summary = result.summary;
      $('backup-password-fields').hidden = true;
      $('backup-preview').hidden = false;
      $('backup-date').textContent = `Dibuat ${new Date(summary.createdAt).toLocaleString('id-ID')}`;
      $('backup-servers').textContent = summary.servers;
      $('backup-credentials').textContent = summary.credentials;
      $('backup-keys').textContent = summary.privateKeys;
      $('backup-cloudflare').textContent = summary.cloudflare || 0;
      $('backup-tunnels').textContent = summary.tunnels || 0;
      $('backup-conflicts').textContent = `${summary.conflicts} server dan ${summary.cloudflareConflicts || 0} akun Cloudflare memiliki ID yang sudah ada di perangkat ini.`;
      $('backup-restore-mode').value = 'keep';
      $('backup-submit').textContent = 'Terapkan restore';
      $('backup-restore-mode').focus();
      return;
    }
    token = null;
    if (restoring) {
      await renderServers();
      window.dispatchEvent(new Event('labserver-restored'));
      $('backup-preview').hidden = true;
      $('backup-password-fields').hidden = false;
      $('backup-submit').textContent = 'Pilih file backup…';
    }
    let message = restoring
      ? `Restore selesai: ${result.added} server ditambahkan, ${result.updated} diperbarui, ${result.skipped} dipertahankan.`
      : `Backup ${result.servers} server tersimpan di ${result.filename}. Simpan file dan password backup secara terpisah.`;
    if (restoring && result.cloudflare) message += ` Cloudflare: ${result.cloudflare.added} ditambahkan, ${result.cloudflare.updated} diperbarui, ${result.cloudflare.skipped} dipertahankan.`;
    if (!restoring && result.cloudflare) message += ` Termasuk ${result.cloudflare} akun Cloudflare dan API Token.`;
    $('backup-result').textContent = message;
    $('backup-result').hidden = false;
    announce(message);
  } catch {
    $('backup-error').textContent = 'Backup/restore gagal. Silakan coba kembali.';
  } finally {
    clearPasswords();
    controls.forEach((button) => { button.disabled = false; });
    working = false;
  }
});
