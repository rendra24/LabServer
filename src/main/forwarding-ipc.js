const crypto = require('node:crypto');
const { TunnelError, validateTunnel } = require('./forwarding-config');
function registerForwardingIpc({ handle, sessions, store, dialog, winOf }) {
  const mutations = new Set();
  handle('tunnels:call', async (event, serverId, op, input = {}) => {
    let locked = false;
    try {
      if (typeof serverId !== 'string' || !['list','save','remove','start','stop'].includes(op) || !input || typeof input !== 'object' || Array.isArray(input)) throw new TunnelError('TUNNEL_INVALID');
      const connection = sessions.connection(serverId), runtime = sessions.forwarding(serverId);
      if (!connection || !runtime) throw new TunnelError('NOT_CONNECTED');
      const valid = () => !event.sender.isDestroyed?.() && sessions.connection(serverId) === connection;
      const read = () => { const profile = store.get(serverId); if (!profile) throw new TunnelError('NOT_FOUND'); return profile; };
      const snapshot = () => {
        const states = new Map(runtime.list().map(entry => [entry.id,entry]));
        return {tunnels:(read().tunnels || []).map(entry => ({...entry,status:'stopped',connections:0,lastError:'',...states.get(entry.id)}))};
      };
      if (op === 'list') return {ok:true,data:snapshot()};
      if (mutations.has(serverId)) throw new TunnelError('BUSY');
      mutations.add(serverId); locked = true;
      const profile = read(), profiles = profile.tunnels || [];
      const entry = profiles.find(tunnel => tunnel.id === input.id);
      const active = runtime.list().some(state => state.id === input.id && ['listening','starting'].includes(state.status));
      if (op === 'save') {
        if (input.id && !entry) throw new TunnelError('NOT_FOUND');
        if (active) throw new TunnelError('BUSY');
        const saved = validateTunnel({...input,id:input.id || crypto.randomUUID()});
        store.save({...profile,tunnels:entry ? profiles.map(tunnel => tunnel.id === entry.id ? saved : tunnel) : [...profiles,saved]});
      } else {
        if (!entry) throw new TunnelError('NOT_FOUND');
        if (op === 'remove' && active) throw new TunnelError('BUSY');
        if (['stop','remove'].includes(op)) {
          const label = op === 'stop' ? 'Hentikan' : 'Hapus';
          const answer = await dialog.showMessageBox(winOf(event), {type:op === 'stop' ? 'warning' : 'question',buttons:['Batal',label],defaultId:0,cancelId:0,message:`${label} tunnel “${entry.name}”?`,detail:`Server: ${profile.name}\n127.0.0.1:${entry.localPort} → ${entry.remoteHost}:${entry.remotePort}\n\n${op === 'stop' ? 'Koneksi aplikasi melalui tunnel ini akan terputus. Profil tetap tersimpan.' : 'Hanya profil lokal ini yang dihapus.'}`});
          if (!valid()) throw new TunnelError('NOT_CONNECTED');
          if (answer.response !== 1) return {ok:false,cancelled:true};
        }
        if (op === 'start') await runtime.start(entry);
        if (!valid()) throw new TunnelError('NOT_CONNECTED');
        if (op === 'stop') runtime.stop(entry.id);
        if (op === 'remove') {
          runtime.stop(entry.id);
          store.save({...read(),tunnels:(read().tunnels || []).filter(tunnel => tunnel.id !== entry.id)});
        }
      }
      if (!valid()) throw new TunnelError('NOT_CONNECTED');
      return {ok:true,data:snapshot()};
    } catch (error) {
      return {ok:false,code:error instanceof TunnelError ? error.code : 'UNKNOWN',message:error instanceof TunnelError ? error.message : 'Profil tunnel gagal disimpan atau dibaca. Periksa penyimpanan lokal.'};
    } finally { if (locked) mutations.delete(serverId); }
  });
}
module.exports = { registerForwardingIpc };
