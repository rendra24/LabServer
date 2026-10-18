const path = require('node:path').posix;
const { isIP } = require('node:net');
const { ToolError, shq, checkResult } = require('./tool-runner');
const ENV = 'env LC_ALL=C LANG=C';
const validName = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(value);
function domain(value) {
  if (typeof value !== 'string') throw new ToolError('INVALID_REQUEST');
  const name = value.trim().toLowerCase().replace(/\.$/, '');
  if (name.length > 253 || !name.includes('.') || isIP(name) || !name.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new ToolError('INVALID_REQUEST');
  return name;
}
function validate(op, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolError('INVALID_REQUEST');
  if (op === 'list') return {};
  if (op === 'renew') { if (!validName(input.name)) throw new ToolError('INVALID_REQUEST'); return { name: input.name }; }
  if (op !== 'issue' || !Array.isArray(input.domains) || !input.domains.length || input.domains.length > 20 || typeof input.email !== 'string' || input.email.length > 254 || !/^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(input.email) || input.agreeTerms !== true || typeof input.redirect !== 'boolean') throw new ToolError('INVALID_REQUEST');
  return { domains: [...new Set(input.domains.map(domain))], email: input.email, redirect: input.redirect };
}
function expiry(value) {
  const date = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2})$/);
  if (!date) return null;
  const [,year,month,day,hour,minute,second,offset] = date;
  const calendar = new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth()+1 !== Number(month) || calendar.getUTCDate() !== Number(day) || Number(hour)>23 || Number(minute)>59 || Number(second)>59) return null;
  const result = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
  return Number.isFinite(result) ? result : null;
}
function parseCertificates(stdout) {
  if (!/Found the following certs:|No cert(?:ificate)?s found\./i.test(stdout)) throw new ToolError('BAD_RESPONSE');
  const blocks = stdout.split(/(?:^|\n)\s*Certificate Name:\s*/).slice(1);
  return blocks.map(block => {
    const name = block.split('\n')[0].trim().slice(0,1000);
    const domains = (block.match(/^\s*Domains:\s*(.*)$/m)?.[1] || '').trim().split(/\s+/).filter(Boolean);
    const expiryLine = block.match(/^\s*Expiry Date:\s*(.*)$/m)?.[1] || '';
    const rawExpiry = expiryLine.split(/\s+\(/)[0].trim();
    const validity = /\(INVALID\s*:/i.test(expiryLine) ? 'invalid' : /\(VALID\s*:/i.test(expiryLine) ? 'valid' : 'unknown';
    const testCertificate = /\(INVALID\s*:\s*TEST_CERT\b/i.test(expiryLine);
    const expiresAt = expiry(rawExpiry);
    let supported = validName(name) && domains.length > 0;
    try { for (const value of domains) domain(value); } catch { supported = false; }
    return { name, domains, expiresAt, supported, validity, testCertificate };
  });
}
function nginxRoot(stderr) {
  const match = stderr.match(/(?:^|\s)--conf-path=(?:'([^']+)'|"([^"]+)"|(\S+))/);
  const file = match && (match[1] || match[2] || match[3]);
  if (!file || !/^\/[A-Za-z0-9._/-]+$/.test(file) || file.split('/').includes('..') || path.basename(file) !== 'nginx.conf') throw new ToolError('NGINX_ROOT');
  return path.dirname(file);
}
function createSslOps(runner, profile) {
  const bin = profile.nginx?.nginxBin || '/usr/sbin/nginx';
  let active = false;
  async function list(context) {
    const result = checkResult(await runner.privileged(`${ENV} certbot certificates --non-interactive`, context), 'certbot');
    return { certificates: parseCertificates(result.stdout) };
  }
  async function testNginx(context, post = false) {
    if (!/^\/[A-Za-z0-9._/-]+$/.test(bin) || bin.split('/').includes('..')) throw new ToolError('NGINX_ROOT');
    const result = await runner.privileged(`${ENV} ${shq(bin)} -t`, context);
    if (result.code !== 0 || result.truncated) throw new ToolError(post ? 'SSL_FAILED' : 'NGINX_INVALID');
  }
  return {
    active: () => active,
    async request(op, input = {}, context = {}) {
      const args = validate(op,input);
      if (op === 'list') return list(context);
      if (active) throw new ToolError('BUSY');
      active = true; let changed = false;
      try {
        if (!await context.confirm?.(op,args)) throw new ToolError('CANCELLED');
        context.signal?.throwIfAborted();
        const before = (await list(context)).certificates;
        let command, previous;
        if (op === 'issue') {
          const name = args.domains[0]; previous = before.find(cert => cert.name === name);
          if (previous && JSON.stringify([...previous.domains].sort()) !== JSON.stringify([...args.domains].sort())) throw new ToolError('CERTIFICATE_CONFLICT');
          await testNginx(context);
          const version = checkResult(await runner.privileged(`${ENV} ${shq(bin)} -V`,context), 'nginx');
          const root = nginxRoot(version.stderr + '\n' + version.stdout);
          command = `${ENV} certbot --nginx --non-interactive --agree-tos --keep-until-expiring --nginx-ctl=${shq(bin)} --nginx-server-root=${shq(root)} --cert-name=${shq(name)} --email=${shq(args.email)} ${args.redirect ? '--redirect' : '--no-redirect'} ${args.domains.map(name=>`-d ${shq(name)}`).join(' ')}`;
        } else {
          previous = before.find(cert=>cert.name===args.name);
          if (!previous) throw new ToolError('CERTIFICATE_GONE');
          if (!previous.supported) throw new ToolError('INVALID_REQUEST');
          await testNginx(context);
          command = `${ENV} certbot renew --non-interactive --no-random-sleep-on-renew --cert-name=${shq(args.name)}`;
        }
        context.signal?.throwIfAborted();
        changed = true; context.nginxChanged?.();
        checkResult(await runner.privileged(command, context, { timeoutMs:300000,maxBytes:1048576 }), 'certbot');
        await testNginx(context, true);
        const after = await list(context);
        const current = after.certificates.find(cert=>cert.name===(op==='issue'?args.domains[0]:args.name));
        const renewed = op === 'renew' && Number.isFinite(previous?.expiresAt) && Number.isFinite(current?.expiresAt) && current.expiresAt > previous.expiresAt;
        return { ...after, renewed, notice: op==='issue' ? 'Permintaan pemasangan SSL selesai. Periksa cakupan domain dan masa berlaku di bawah.' : renewed ? 'Sertifikat diperpanjang dan konfigurasi Nginx sudah diperiksa.' : 'Permintaan selesai. Sertifikat yang belum memasuki window renewal tidak diperpanjang; periksa masa berlaku terbaru.' };
      } catch (cause) {
        const error = cause?.name === 'AbortError' ? new ToolError('CANCELLED') : cause;
        if (changed && error instanceof ToolError) { error.partial = true; if (!['SSL_FAILED','TIMEOUT'].includes(error.code)) error.message += ' Perubahan mungkin sudah terjadi sebagian; periksa Nginx dan Certbot di VPS sebelum mencoba kembali.'; }
        throw error;
      } finally { active = false; }
    },
  };
}
module.exports = { createSslOps, parseCertificates, nginxRoot };
