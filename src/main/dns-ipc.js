const { createCloudflareClient, validateAccount, validateRecord, CloudflareError } = require('./cloudflare');
function registerDnsIpc({ handle, store, dialog, winOf, fetchImpl }) {
  const working = new Set();
  const account = id => {
    if (typeof id !== 'string' || !store.listCloudflare().some(a => a.id === id)) throw new CloudflareError('Akun Cloudflare tidak ditemukan. Muat ulang daftar akun.', 'ACCOUNT_NOT_FOUND');
    return createCloudflareClient(store.getCloudflareToken(id), fetchImpl);
  };
  const wrap = (fn, mutation = false) => async (event, ...args) => {
    const key = typeof args[0] === 'string' ? args[0] : args[0]?.id || 'new';
    if (mutation && working.has(key)) return { ok: false, message: 'Perubahan akun ini sedang diproses. Tunggu hingga selesai.' };
    if (mutation) working.add(key);
    try { return await fn(event, ...args); }
    catch (error) { return { ok: false, code: error instanceof CloudflareError ? error.code : 'LOCAL_STORAGE', message: error instanceof CloudflareError ? error.message : 'Data Cloudflare tidak dapat dibaca atau disimpan. Periksa izin penyimpanan, ruang disk, dan enkripsi sistem operasi.' }; }
    finally { if (mutation) working.delete(key); }
  };
  handle('dns:accounts', wrap(() => ({ ok: true, data: store.listCloudflare() })));
  handle('dns:save', wrap(async (_event, input) => {
    const current = input?.id && store.listCloudflare().find(a => a.id === input.id);
    if (input?.id && !current) throw new CloudflareError('Akun Cloudflare tidak ditemukan.');
    const credentials = validateAccount({ ...input, token: input?.token || (current ? store.getCloudflareToken(current.id) : '') });
    await createCloudflareClient(credentials.token, fetchImpl).zones();
    return { ok: true, data: store.saveCloudflare(credentials) };
  }, true));
  handle('dns:removeAccount', wrap(async (event, id) => {
    const profile = store.listCloudflare().find(a => a.id === id);
    if (!profile) throw new CloudflareError('Akun Cloudflare tidak ditemukan.');
    const result = await dialog.showMessageBox(winOf(event), { type: 'question', buttons: ['Batal', 'Hapus akun lokal'], defaultId: 0, cancelId: 0, message: `Hapus akun “${profile.memo}” dari LabServer?`, detail: 'Memo dan token tersimpan akan dihapus dari perangkat ini. Domain dan record DNS di Cloudflare tetap ada.' });
    if (result.response !== 1) return { ok: false, cancelled: true };
    store.removeCloudflare(id);
    return { ok: true };
  }, true));
  handle('dns:zones', wrap(async (_event, id) => ({ ok: true, data: await account(id).zones() })));
  handle('dns:records', wrap(async (_event, id, zone, options) => ({ ok: true, data: await account(id).records(zone, options) })));
  handle('dns:create', wrap(async (_event, id, zone, input) => {
    const client = account(id);
    const details = await client.zone(zone);
    const body = validateRecord(input, details.name);
    return { ok: true, data: await client.create(zone, body) };
  }, true));
  handle('dns:update', wrap(async (_event, id, zone, record, input, modified) => {
    const client = account(id);
    const details = await client.zone(zone);
    const body = validateRecord(input, details.name);
    const current = await client.record(zone, record);
    if (typeof modified !== 'string' || modified !== current.modified_on) throw new CloudflareError('Record telah berubah di Cloudflare. Muat ulang daftar dan periksa perubahan sebelum menyimpan.', 'STALE_RECORD');
    return { ok: true, data: await client.update(zone, record, body) };
  }, true));
  handle('dns:remove', wrap(async (event, id, zone, record) => {
    const client = account(id);
    const current = await client.record(zone, record);
    const result = await dialog.showMessageBox(winOf(event), { type: 'warning', buttons: ['Batal', 'Hapus record'], defaultId: 0, cancelId: 0, message: `Hapus record ${current.type} “${current.name}”?`, detail: 'Record akan dihapus dari Cloudflare. Layanan yang memakai record ini dapat terpengaruh.' });
    if (result.response !== 1) return { ok: false, cancelled: true };
    return { ok: true, data: await client.remove(zone, record) };
  }, true));
}
module.exports = { registerDnsIpc };
