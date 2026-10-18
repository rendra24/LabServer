function registerSystemIpc({ handle, sessions, dialog, winOf, getProfile, askSudoPassword }) {
  const owners = new WeakMap();
  const validRequest = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
  handle('system:call', async (event, serverId, op, input) => {
    if (typeof serverId !== 'string' || !validRequest(input?.requestId)) return { ok: false, code: 'INVALID_REQUEST', message: 'Permintaan layanan tidak valid.' };
    let requests = owners.get(event.sender);
    if (!requests) {
      requests = new Map(); owners.set(event.sender, requests);
      event.sender.once('destroyed', () => { for (const request of requests.values()) request.controller.abort(); requests.clear(); });
    }
    const id = input.requestId;
    if (requests.has(id) || requests.size >= 8) return { ok: false, code: 'BUSY', message: 'Tunggu hingga permintaan sebelumnya selesai.' };
    const controller = new AbortController(); requests.set(id, { serverId, controller });
    try {
      return await sessions.system(serverId, op, input, {
        signal: controller.signal,
        askSudoPassword: signal => askSudoPassword(event, serverId, signal),
        confirm: async (action, unit) => {
          if (controller.signal.aborted) return false;
          const label = { start: 'Start', stop: 'Stop', restart: 'Restart' }[action];
          const profile = getProfile(serverId);
          const result = await dialog.showMessageBox(winOf(event), { type: action === 'start' ? 'question' : 'warning', buttons: ['Batal', label], defaultId: 0, cancelId: 0, message: `${label} ${unit} di ${profile?.name || 'server ini'}?`, detail: action === 'start' ? 'Layanan akan dijalankan di VPS.' : 'Proses layanan dan koneksi pengguna layanan ini dapat terputus. Periksa nama layanan sebelum melanjutkan.' });
          return !controller.signal.aborted && result.response === 1;
        },
      });
    } finally { requests.delete(id); }
  });
  handle('system:cancel', (event, serverId, requestId) => {
    const request = owners.get(event.sender)?.get(requestId);
    const owned = Boolean(request && request.serverId === serverId);
    if (owned) request.controller.abort();
    return { ok: true, cancelled: owned };
  });
}
module.exports = { registerSystemIpc };
