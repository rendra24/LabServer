const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/sshServer');
const { connect } = require('../src/main/ssh');
const { createSessionManager } = require('../src/main/sessions');

const until = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.fail('SSH terminal response timeout');
};

test('SSH nyata in-process: PTY, input, interrupt, resize, exit, reopen dan disconnect', async (t) => {
  const server = await startServer({ shell: true });
  const events = [];
  const profile = { id: 's1', host: '127.0.0.1', port: server.port, username: 'deploy', auth: 'password' };
  const mgr = createSessionManager({
    open: () => connect(profile, { password: 'pw-123', hostKeys: { get: () => server.fingerprint } }),
    getProfile: id => id === 's1' ? profile : null,
    makeOps: conn => ({ list: () => conn.exec('test-command') }),
  });
  t.after(async () => { mgr.closeAll(); await server.close(); });
  assert.equal((await mgr.terminal('s1', 'open', { cols: 80, rows: 24 })).code, 'NOT_CONNECTED');
  assert.equal((await mgr.connect('s1', {}, packet => events.push(packet))).ok, true);
  const { sessionId } = await mgr.terminal('s1', 'open', { cols: 80, rows: 24 });
  const second = await mgr.terminal('s1', 'open', { cols: 90, rows: 25 });
  assert.equal(second.ok,true);
  await until(() => events.some(e => e.type === 'data'));
  assert.equal(server.stats.ptys[0].term, 'xterm-256color');
  const text = (id=sessionId) => Buffer.concat(events.filter(e => e.type === 'data'&&e.sessionId===id).map(e => Buffer.from(e.data))).toString();
  await mgr.terminal('s1','write',second.sessionId,new TextEncoder().encode('second shell\r'));
  await until(()=>text(second.sessionId).includes('received:second shell'));
  assert.ok(!text().includes('second shell'));
  await mgr.terminal('s1', 'write', sessionId, new TextEncoder().encode('echo café\r'));
  await until(() => text().includes('received:echo café'));
  await mgr.terminal('s1', 'write', sessionId, new Uint8Array([3]));
  await until(() => text().includes('^C'));
  await mgr.terminal('s1', 'resize', sessionId, { cols: 120, rows: 40 });
  await until(() => server.stats.resizes.length > 0);
  assert.equal(server.stats.resizes[0].cols, 120);
  assert.equal(server.stats.resizes[0].rows, 40);
  await mgr.terminal('s1', 'write', sessionId, new TextEncoder().encode('exit\r'));
  await until(() => events.some(e => e.type === 'exit'));
  assert.equal((await mgr.terminal('s1','write',second.sessionId,new TextEncoder().encode('still active\r'))).ok,true);
  await until(()=>text(second.sessionId).includes('received:still active'));
  assert.equal(mgr.isConnected('s1'), true);
  assert.equal((await mgr.call('s1', 'list')).data.trim(), 'ran:test-command');
  const reopened = await mgr.terminal('s1', 'open', { cols: 90, rows: 25 });
  assert.equal(reopened.ok, true);
  server.disconnectClients();
  await until(() => !mgr.isConnected('s1'));
  assert.equal(mgr.isConnected('s1'), false);
  assert.equal(events.at(-1).type, 'disconnected');
  for(const id of [second.sessionId,reopened.sessionId])assert.ok(events.some(e=>e.type==='exit'&&e.sessionId===id&&e.reason==='disconnect'));
  assert.equal((await mgr.terminal('s1', 'write', reopened.sessionId, new Uint8Array([3]))).code, 'NOT_CONNECTED');
});
