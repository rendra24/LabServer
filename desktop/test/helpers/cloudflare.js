const ZONE = 'a'.repeat(32), SECOND_ZONE = 'c'.repeat(32);
function cloudflareFixture() {
  const requests = [];
  let denied = false;
  let serial = 10;
  const records = [
    { id: 'b'.repeat(32), type: 'A', name: 'example.com', content: '192.0.2.1', ttl: 1, proxied: true, proxiable: true, comment: '', modified_on: '2026-10-17T00:00:00Z', settings: {}, tags: [] },
    { id: 'd'.repeat(32), type: 'MX', name: 'example.com', content: 'mail.example.com', priority: 10, ttl: 3600, proxied: false, proxiable: false, comment: '', modified_on: '2026-10-17T00:00:00Z', settings: {}, tags: [] },
    { id: 'e'.repeat(32), type: 'TXT', name: '_dmarc.example.com', content: 'v=DMARC1; p=none', ttl: 1, proxied: false, proxiable: false, comment: '', modified_on: '2026-10-17T00:00:00Z', settings: {}, tags: [] },
  ];
  const delays = new Map();
  async function fetchImpl(url, options) {
    requests.push({ url, options });
    const u = new URL(url), parts = u.pathname.split('/').filter(Boolean).slice(2);
    const delay = delays.get(parts[1] || 'zones');
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const respond = (result, result_info) => new Response(JSON.stringify({ success: true, errors: [], messages: [], result, result_info }), { status: 200 });
    if (denied || options.headers.Authorization.includes('invalid')) return new Response(JSON.stringify({ success: false, errors: [{ code: 9109, message: 'Invalid access token' }] }), { status: 403 });
    if (parts.length === 1) return respond([{ id: ZONE, name: 'example.com', status: 'active', account: { name: 'Personal' } }, { id: SECOND_ZONE, name: 'second.test', status: 'active', account: { name: 'Personal' } }], { page: 1, total_pages: 1, total_count: 2 });
    if (parts.length === 2) return respond({ id: parts[1], name: parts[1] === ZONE ? 'example.com' : 'second.test' });
    const id = parts[3];
    if (options.method === 'GET' && id) return respond(records.find(r => r.id === id));
    if (options.method === 'DELETE') { records.splice(records.findIndex(r => r.id === id), 1); return respond({ id }); }
    if (options.method === 'POST' || options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      const entry = { ...(records.find(r => r.id === id) || {}), ...body, id: id || (++serial).toString(16).padStart(32, '0'), modified_on: new Date().toISOString(), settings: {}, tags: [] };
      if (id) records[records.findIndex(r => r.id === id)] = entry; else records.push(entry);
      return respond(entry);
    }
    const search = (u.searchParams.get('search') || '').toLowerCase();
    const selected = parts[1] === ZONE ? records.filter(r => `${r.name} ${r.content}`.toLowerCase().includes(search)) : [];
    return respond(selected, { page: 1, total_pages: 1, total_count: selected.length });
  }
  return { fetchImpl, requests, records, delays, deny(value) { denied = value; } };
}
module.exports = { cloudflareFixture, ZONE, SECOND_ZONE };
