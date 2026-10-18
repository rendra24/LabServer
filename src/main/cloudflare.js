const net = require('node:net');
const { domainToASCII } = require('node:url');
const TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'];
class CloudflareError extends Error {
  constructor(message, code = 'CLOUDFLARE') { super(message); this.code = code; }
}
const invalid = message => { throw new CloudflareError(message, 'VALIDATION'); };
function validateAccount(input) {
  if (!input || typeof input !== 'object') invalid('Data akun tidak valid.');
  const memo = typeof input.memo === 'string' ? input.memo.trim() : '';
  if (!memo || memo.length > 64) invalid('Memo wajib diisi, maksimal 64 karakter.');
  if (typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(input.token)) invalid('API Token tidak valid. Salin token lengkap dari Cloudflare.');
  if (input.id !== undefined && !/^[0-9a-f-]{36}$/i.test(input.id)) invalid('ID akun tidak valid.');
  return { ...(input.id ? { id: input.id } : {}), memo, token: input.token };
}
function hostname(value) {
  if (typeof value !== 'string') invalid('Hostname wajib diisi.');
  if (/[\s/:@?#\\]/.test(value.trim())) invalid('Hostname tidak valid.');
  const name = domainToASCII(value.trim().replace(/\.$/, '')).toLowerCase();
  if (!name || name.length > 253 || !name.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) invalid('Hostname tidak valid. Gunakan nama host tanpa http:// atau path.');
  return name;
}
function integer(value, min, max, label) {
  if (!['string', 'number'].includes(typeof value) || value === '' || !Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) invalid(`${label} harus ${min}–${max}.`);
  return Number(value);
}
function validateRecord(input, zoneName) {
  if (!input || typeof input !== 'object' || !TYPES.includes(input.type)) invalid('Tipe record ini belum dapat diedit di LabServer.');
  const zone = hostname(zoneName);
  let name = typeof input.name === 'string' ? input.name.trim().toLowerCase() : '';
  if (!name) invalid('Nama record wajib diisi. Gunakan @ untuk domain utama.');
  if (name !== '@' && /[\s/:@?#\\]/.test(name)) invalid('Nama record tidak valid.');
  const absolute = name.endsWith('.');
  name = name.replace(/\.$/, '');
  if (name === '@') name = zone;
  else if (name !== zone && !name.endsWith(`.${zone}`)) {
    if (absolute) invalid('Nama record harus berada di domain yang dipilih.');
    name = `${name}.${zone}`;
  }
  name = name.split('.').map(label => label === '*' || label.includes('_') ? label : domainToASCII(label)).join('.');
  if (name.length > 253 || !name.split('.').every((label, i) => (i === 0 && label === '*') || /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(label))) invalid('Nama record tidak valid.');
  if (!['string', 'number'].includes(typeof input.ttl)) invalid('TTL tidak valid.');
  let ttl = Number(input.ttl);
  if (ttl !== 1) ttl = integer(input.ttl, 30, 86400, 'TTL');
  if (input.proxied !== undefined && typeof input.proxied !== 'boolean') invalid('Pilihan proxy tidak valid.');
  const proxied = input.proxied === true;
  if (proxied && !['A', 'AAAA', 'CNAME'].includes(input.type)) invalid('Proxy hanya tersedia untuk A, AAAA, dan CNAME.');
  if (proxied) ttl = 1;
  const comment = input.comment === undefined ? '' : input.comment;
  if (typeof comment !== 'string' || comment.length > 500) invalid('Catatan maksimal 500 karakter.');
  const result = { type: input.type, name, ttl, proxied, comment };
  if (input.type === 'SRV') {
    const d = input.data || {};
    result.data = { priority: integer(d.priority, 0, 65535, 'Priority'), weight: integer(d.weight, 0, 65535, 'Weight'), port: integer(d.port, 0, 65535, 'Port'), target: d.target === '.' ? '.' : hostname(d.target) };
  } else if (input.type === 'CAA') {
    const d = input.data || {};
    if (!['issue', 'issuewild', 'iodef'].includes(d.tag) || typeof d.value !== 'string' || !d.value.trim() || d.value.length > 4096) invalid('Tag atau value CAA tidak valid.');
    result.data = { flags: integer(d.flags, 0, 255, 'Flags'), tag: d.tag, value: d.value };
  } else {
    if (typeof input.content !== 'string' || !input.content || input.content.length > 65535) invalid('Isi record wajib diisi (maksimal 65.535 karakter).');
    result.content = input.type === 'TXT' ? input.content : input.content.trim();
    if (input.type === 'A' && net.isIP(result.content) !== 4) invalid('Record A membutuhkan IPv4 yang valid.');
    if (input.type === 'AAAA' && net.isIP(result.content) !== 6) invalid('Record AAAA membutuhkan IPv6 yang valid.');
    if (['CNAME', 'MX', 'NS'].includes(input.type)) result.content = hostname(result.content);
    if (input.type === 'MX') result.priority = integer(input.priority, 0, 65535, 'Priority');
  }
  return result;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/i.test(value)) invalid('ID domain atau record tidak valid.');
  return value;
}
function createCloudflareClient(token, fetchImpl = globalThis.fetch) {
  // Kredensial tidak pernah dikirim ke origin atau redirect yang dipilih renderer.
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(token)) invalid('API Token tidak valid.');
  async function request(endpoint, method = 'GET', body) {
    let response, data;
    try {
      response = await fetchImpl(`https://api.cloudflare.com/client/v4${endpoint}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000), ...(body ? { body: JSON.stringify(body) } : {}) });
      data = await response.json();
    } catch { throw new CloudflareError('Tidak dapat menghubungi Cloudflare. Periksa koneksi internet lalu coba lagi.', 'NETWORK'); }
    if (!response.ok || data?.success !== true) {
      const messages = { 401: 'API Token ditolak atau telah kedaluwarsa.', 403: 'Token tidak memiliki izin untuk domain ini. Periksa Zone Read dan DNS Edit.', 429: 'Batas permintaan Cloudflare tercapai. Tunggu beberapa saat sebelum mencoba lagi.' };
      const code = Number.isInteger(data?.errors?.[0]?.code) ? ` (kode ${data.errors[0].code})` : '';
      throw new CloudflareError((messages[response.status] || 'Cloudflare menolak permintaan. Periksa data record, izin token, dan konflik DNS.') + code, `HTTP_${response.status}`);
    }
    return data;
  }
  return {
    async zones() {
      const zones = [];
      for (let page = 1; page <= 100; page++) {
        const data = await request(`/zones?per_page=50&page=${page}`);
        if (!Array.isArray(data.result)) throw new CloudflareError('Daftar domain Cloudflare tidak valid.');
        zones.push(...data.result.map(z => ({ id: z.id, name: z.name, status: z.status, account: z.account?.name || '' })));
        if (page >= (data.result_info?.total_pages || 1)) return zones;
      }
      throw new CloudflareError('Terlalu banyak domain. Batasi token ke domain yang ingin dikelola.');
    },
    async records(zone, options = {}) {
      const page = integer(options.page ?? 1, 1, 100000, 'Halaman');
      const search = options.search ?? '';
      if (typeof search !== 'string' || search.length > 100) invalid('Pencarian maksimal 100 karakter.');
      const query = new URLSearchParams({ page: String(page), per_page: '100' });
      if (search.trim()) query.set('search', search.trim());
      const data = await request(`/zones/${identifier(zone)}/dns_records?${query}`);
      if (!Array.isArray(data.result)) throw new CloudflareError('Daftar DNS Cloudflare tidak valid.');
      return { records: data.result, page, pages: Math.max(1, data.result_info?.total_pages || 1), total: data.result_info?.total_count ?? data.result.length };
    },
    zone: async zone => (await request(`/zones/${identifier(zone)}`)).result,
    record: async (zone, id) => (await request(`/zones/${identifier(zone)}/dns_records/${identifier(id)}`)).result,
    create: async (zone, body) => (await request(`/zones/${identifier(zone)}/dns_records`, 'POST', body)).result,
    update: async (zone, id, body) => (await request(`/zones/${identifier(zone)}/dns_records/${identifier(id)}`, 'PATCH', body)).result,
    remove: async (zone, id) => (await request(`/zones/${identifier(zone)}/dns_records/${identifier(id)}`, 'DELETE')).result,
  };
}
module.exports = { createCloudflareClient, validateRecord, validateAccount, CloudflareError, TYPES };
