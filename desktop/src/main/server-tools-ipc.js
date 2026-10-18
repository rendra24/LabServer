const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function registerServerToolsIpc({ handle, sessions, dialog, winOf, getProfile, askSudoPassword, files }) {
  const owners = new WeakMap();
  for (const feature of ['docker','ssl']) {
    handle(`${feature}:call`, async (event, serverId, op, input) => {
      if (typeof serverId !== 'string' || !UUID.test(input?.requestId || '')) return { ok: false, code: 'INVALID_REQUEST', message: 'Permintaan tidak valid.' };
      let requests = owners.get(event.sender);
      if (!requests) {
        requests = new Map(); owners.set(event.sender, requests);
        event.sender.once('destroyed', () => { for (const item of requests.values()) item.controller.abort(); requests.clear(); });
      }
      if (requests.has(input.requestId) || requests.size >= 8) return { ok: false, code: 'BUSY', message: 'Tunggu permintaan sebelumnya selesai.' };
      const connection = sessions.connection(serverId);
      const controller = new AbortController();
      requests.set(input.requestId, { feature, serverId, controller });
      try {
        return await sessions[feature](serverId, op, input, {
          signal: controller.signal,
          canStart: () => !files?.blocksSsl(serverId),
          nginxChanged: () => { if (sessions.connection(serverId) === connection && !event.sender.isDestroyed?.()) event.sender.send('tools:event', { serverId, type: 'nginx-changed' }); },
          askSudoPassword: signal => askSudoPassword(event, serverId, signal),
          confirm: async (action, identity) => {
            if (controller.signal.aborted) return false;
            if (feature === 'ssl') {
              const label = action === 'issue' ? 'Pasang SSL' : 'Perpanjang SSL';
              const summary = action === 'issue' ? `Domain: ${identity.domains.join(', ')}\nEmail: ${identity.email}\nRedirect HTTPS: ${identity.redirect ? 'Aktif' : 'Nonaktif'}` : `Sertifikat: ${identity.name}`;
              const result = await dialog.showMessageBox(winOf(event), { type: 'warning', buttons: ['Batal', label], defaultId: 0, cancelId: 0, message: `${label} di ${getProfile(serverId)?.name || 'VPS'}?`, detail: `${summary}\n\nCertbot dapat mengubah dan reload konfigurasi Nginx. Menutup koneksi tidak menjamin perubahan dibatalkan.` });
              return !controller.signal.aborted && result.response === 1;
            }
            const label = { start: 'Start', stop: 'Stop', restart: 'Restart' }[action];
            const profile = getProfile(serverId);
            const answer = await dialog.showMessageBox(winOf(event), { type: action === 'start' ? 'question' : 'warning', buttons: ['Batal', label], defaultId: 0, cancelId: 0, message: `${label} ${identity.name}?`, detail: `Server: ${profile?.name || 'VPS'}\nContainer: ${identity.id}\n\n${action === 'start' ? 'Container akan dijalankan.' : 'Proses dan koneksi aplikasi dalam container dapat terputus.'}` });
            return !controller.signal.aborted && answer.response === 1;
          },
        });
      } finally { requests.delete(input.requestId); }
    });
    handle(`${feature}:cancel`, (event, serverId, requestId) => {
      const item = owners.get(event.sender)?.get(requestId);
      const owned = Boolean(item && item.serverId === serverId && item.feature === feature);
      if (owned) item.controller.abort();
      return { ok: true, cancelled: owned };
    });
  }
}
module.exports = { registerServerToolsIpc };
