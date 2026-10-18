const test = require('node:test');
const assert = require('node:assert/strict');
const { toolSsh } = require('./helpers/toolSsh');
const { createToolRunner } = require('../src/main/tool-runner');
const { createDockerOps } = require('../src/main/docker-ops');
const ID = 'a'.repeat(64), STOPPED = 'b'.repeat(64);
const profile = { username: 'root' };
function setup(handler, username = 'root') {
  const state = { status: 'running' };
  const ssh = toolSsh((command, stdin, stream) => handler?.(command, stdin, stream) ?? (
    command.includes('container ls') ? { stdout: [JSON.stringify({ ID, Names: 'web', Image: 'nginx:alpine', State: state.status, Status: 'Up 2 hours (healthy)', Ports: '80/tcp' }), JSON.stringify({ ID: STOPPED, Names: 'db', Image: 'mysql:8', State: 'exited', Status: 'Exited (0)', Ports: '' })].join('\n') } :
    command.includes('container stats') ? { stdout: JSON.stringify({ ID, Name: 'web', CPUPerc: '2.50%', MemUsage: '32MiB / 1GiB', MemPerc: '3.13%' }) } :
    command.includes('container inspect') ? { stdout: JSON.stringify({ id: ID, name: '/web', state: { Status: state.status, Running: state.status === 'running', Pid: 42, ExitCode: 0, StartedAt: '2026-10-18T00:00:00Z', FinishedAt: '0001-01-01T00:00:00Z', OOMKilled: false, Env: ['TOKEN=must-not-leak'] } }) } :
    (state.status = command.includes(' stop ') ? 'exited' : 'running', { stdout: ID+'\n' })
  ));
  const runner = createToolRunner(ssh.conn, { ...profile, username });
  return { ...ssh, runner, ops: createDockerOps(runner), state };
}
test('Docker list combines stopped containers and bounded resource snapshots without private inspect metadata', async () => {
  const s = setup(); const result = await s.ops.request('list', { sudo: false });
  assert.equal(result.containers.length, 2);
  assert.equal(result.containers[0].cpu, '2.50%');
  assert.equal(result.containers[0].memory, '32MiB / 1GiB');
  assert.equal(result.containers[1].state, 'exited');
  assert.equal(result.containers[1].cpu, null);
  assert.ok(s.commands.every(({command}) => command.includes('--host=unix:///var/run/docker.sock') && command.includes('DOCKER_CONTEXT=')));
  const detail = await s.ops.request('detail', { id: ID });
  assert.equal(detail.pid, 42); assert.equal(JSON.stringify(detail).includes('must-not-leak'), false);
});
test('Docker rejects command/option injection and unsupported operations before contacting SSH', async () => {
  const s=setup();
  for(const [op,input] of [['action',{id:'--all',action:'stop'}],['action',{id:ID,action:'rm'}],['logs',{id:ID,lines:100000}],['list',{sudo:'yes'}],['exec',{command:'reboot'}],['action',{id:ID+';reboot',action:'restart'}]]) await assert.rejects(s.ops.request(op,input),e=>e.code==='INVALID_REQUEST');
  assert.equal(s.commands.length,0);
});
test('cancelled Docker confirmation performs no mutation; approved stop refreshes actual state', async () => {
  const s=setup(); await assert.rejects(s.ops.request('action',{id:ID,action:'stop'},{confirm:async()=>false}),e=>e.code==='CANCELLED');
  assert.equal(s.commands.some(c=>c.command.includes('container stop')),false);
  const result=await s.ops.request('action',{id:ID,action:'stop'},{confirm:async(action,identity)=>action==='stop'&&identity.id===ID});
  assert.equal(result.state,'exited'); assert.equal(s.commands.filter(c=>c.command.includes('container stop')).length,1);
});
test('pending Docker confirmation locks only the selected container and disposal prevents a late mutation', async () => {
  const s=setup(); let answer;
  const pending=s.ops.request('action',{id:ID,action:'restart'},{confirm:()=>new Promise(resolve=>answer=resolve)});
  for(let i=0;i<10&&!answer;i++)await new Promise(r=>setImmediate(r));
  assert.equal(s.ops.active(),true);
  await assert.rejects(s.ops.request('action',{id:ID,action:'stop'},{confirm:async()=>true}),e=>e.code==='BUSY');
  s.runner.dispose(); answer(true); await assert.rejects(pending,e=>e.code==='CANCELLED');
  assert.equal(s.commands.some(c=>c.command.includes('container restart')),false); assert.equal(s.ops.active(),false);
});
test('Docker sudo sends a password only in stdin and clears the cached credential on dispose', async () => {
  const s=setup((command)=>command.startsWith('sudo -n')?{code:1,stderr:'sudo: a password is required'}:undefined,'deploy');
  await s.ops.request('list',{sudo:true},{askSudoPassword:async()=> 'fixture-password'});
  assert.ok(s.commands.some(c=>c.stdin==='fixture-password\n'));
  assert.equal(s.commands.some(c=>c.command.includes('fixture-password')),false);
  s.runner.dispose(); await assert.rejects(s.ops.request('list',{sudo:true}),e=>e.code==='CANCELLED');
});
test('Docker log cap reports truncation and missing daemon/tool errors do not expose stderr secrets', async () => {
  const flood=setup(()=>({stdout:'x'.repeat(600000)}));
  const log=await flood.ops.request('logs',{id:ID,lines:300}); assert.equal(log.truncated,true); assert.ok(Buffer.byteLength(log.text)<=524288);
  const missing=setup(()=>({code:127,stderr:'docker: not found SECRET'}));
  await assert.rejects(missing.ops.request('list',{}),e=>e.code==='DOCKER_MISSING'&&!e.message.includes('SECRET'));
  const denied=setup(()=>({code:1,stderr:'permission denied while trying to connect to the Docker daemon socket SECRET'}));
  await assert.rejects(denied.ops.request('list',{}),e=>e.code==='PERMISSION_DENIED'&&!e.message.includes('SECRET'));
});
test('Docker daemon malformed JSON is rejected rather than inventing an empty successful list', async () => {
  const s=setup(()=>({stdout:'not json'})); await assert.rejects(s.ops.request('list',{}),e=>e.code==='BAD_RESPONSE');
});
