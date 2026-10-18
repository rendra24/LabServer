const { ToolError, shq, checkResult } = require('./tool-runner');
const DOCKER = 'env LC_ALL=C DOCKER_CONTEXT= DOCKER_HOST= docker --host=unix:///var/run/docker.sock';
const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function validate(op, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || (input.sudo !== undefined && typeof input.sudo !== 'boolean')) throw new ToolError('INVALID_REQUEST');
  if (!['list','detail','action','logs'].includes(op) || (op !== 'list' && !validId(input.id)) || (op === 'action' && !['start','stop','restart'].includes(input.action)) || (op === 'logs' && ![100,300,500,1000].includes(input.lines))) throw new ToolError('INVALID_REQUEST');
}
function json(value) { try { return JSON.parse(value); } catch { throw new ToolError('BAD_RESPONSE'); } }
function rows(value) {
  const data = value.trim() ? value.trim().split('\n').map(json) : [];
  if (data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new ToolError('BAD_RESPONSE');
  return data;
}
const text = value => typeof value === 'string' ? value.slice(0, 4096) : '';
function createDockerOps(runner) {
  const mutations = new Set();
  async function execute(command, input, context, options) { return (input.sudo ? runner.privileged : runner.run)(command, context, options); }
  async function detail(id, input, context) {
    const format = '{"id":{{json .Id}},"name":{{json .Name}},"state":{{json .State}}}';
    const result = checkResult(await execute(`${DOCKER} container inspect --format ${shq(format)} -- ${shq(id)}`, input, context), 'docker');
    const data = json(result.stdout), state = data?.state;
    if (data?.id !== id || !state || typeof state !== 'object') throw new ToolError('BAD_RESPONSE');
    return { id, name: text(data.name).replace(/^\//, ''), state: text(state.Status), pid: Number(state.Pid) || 0, exitCode: Number(state.ExitCode) || 0, startedAt: text(state.StartedAt), finishedAt: text(state.FinishedAt), oomKilled: state.OOMKilled === true };
  }
  return {
    active: () => mutations.size > 0,
    async request(op, input = {}, context = {}) {
      validate(op, input);
      if (op === 'list') {
        const listing = checkResult(await execute(`${DOCKER} container ls --all --no-trunc --format '{{json .}}'`, input, context), 'docker');
        const containers = rows(listing.stdout).map(row => {
          if (!validId(row.ID) || typeof row.Names !== 'string' || typeof row.State !== 'string') throw new ToolError('BAD_RESPONSE');
          return { id: row.ID, name: text(row.Names), image: text(row.Image), state: row.State, status: text(row.Status), ports: text(row.Ports), cpu: null, memory: null, memoryPercent: null };
        });
        let notice = '';
        if (containers.some(row => row.state === 'running')) {
          try {
            const stats = checkResult(await execute(`${DOCKER} container stats --no-stream --no-trunc --format '{{json .}}'`, input, context), 'docker');
            const byId = new Map(rows(stats.stdout).map(row => [row.ID || row.Container, row]));
            for (const container of containers) {
              const metric = byId.get(container.id);
              if (container.state === 'running' && metric) { container.cpu = text(metric.CPUPerc) || null; container.memory = text(metric.MemUsage) || null; container.memoryPercent = text(metric.MemPerc) || null; }
            }
          } catch (error) { if (['CANCELLED','NOT_CONNECTED'].includes(error.code)) throw error; notice = 'Resource belum tersedia. Daftar container tetap dapat digunakan.'; }
        }
        return { containers, notice };
      }
      if (op === 'detail') return detail(input.id, input, context);
      if (op === 'logs') {
        const result = await execute(`${DOCKER} container logs --timestamps --tail ${input.lines} -- ${shq(input.id)}`, input, context, { maxBytes: 524288, timeoutMs: 15000 });
        if (!result.truncated) checkResult(result, 'docker');
        return { text: result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : ''), truncated: result.truncated, notice: result.truncated ? 'Output dibatasi 512 KiB. Kurangi jumlah baris atau gunakan terminal.' : '' };
      }
      if (mutations.has(input.id)) throw new ToolError('BUSY');
      mutations.add(input.id);
      try {
        const identity = await detail(input.id, input, context);
        if (!await context.confirm?.(input.action, identity)) throw new ToolError('CANCELLED');
        context.signal?.throwIfAborted();
        checkResult(await execute(`${DOCKER} container ${input.action}${input.action === 'start' ? '' : ' --time 10'} -- ${shq(input.id)}`, input, context, { timeoutMs: 90000 }), 'docker');
        try { return await detail(input.id, input, context); }
        catch (error) { if (['CANCELLED','NOT_CONNECTED'].includes(error.code)) throw error; return { id: input.id, name: identity.name, state: 'unknown', notice: 'Tindakan selesai. Muat ulang daftar untuk memeriksa status terbaru.' }; }
      } catch (error) { if (error?.name === 'AbortError') throw new ToolError('CANCELLED'); throw error; }
      finally { mutations.delete(input.id); }
    },
  };
}
module.exports = { createDockerOps, validId, DOCKER };
