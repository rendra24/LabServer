const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createTerminal } = require('../src/main/terminal');

function setup({ delayed = false, fail = false } = {}) {
  const events = [];
  const calls = [];
  let callback;
  const makeStream = () => {
    const value = new PassThrough(); value.stderr = new PassThrough();
    value.setWindow = (...size) => calls.push(['resize', ...size]);
    value.close = () => { calls.push(['close']); value.emit('close'); };
    return value;
  };
  const stream = makeStream(); const streams = [];
  const conn = { client: new EventEmitter() };
  conn.client.shell = (options, cb) => {
    calls.push(['shell', options]);
    const channel = streams.length ? makeStream() : stream; streams.push(channel);
    callback = () => cb(fail ? new Error('private details') : null, fail ? undefined : channel);
    if (!delayed) callback();
  };
  const terminal = createTerminal(conn, { onEvent: (e) => events.push(e) });
  return { terminal, stream, streams, events, calls, finishOpen: () => callback() };
}

test('PTY interaktif: input Unicode/control, output biner, resize dan close tanpa menutup SSH', async () => {
  const { terminal, events, calls } = setup();
  const opened = await terminal.request('open', { cols: 100, rows: 30 });
  assert.equal(opened.ok, true);
  assert.deepEqual(calls[0], ['shell', { term: 'xterm-256color', cols: 100, rows: 30 }]);
  const input = new TextEncoder().encode('echo café\r\x03\x1b[A\t');
  assert.equal((await terminal.request('write', opened.sessionId, input)).ok, true);
  assert.deepEqual(Buffer.from(events[0].data), Buffer.from(input));
  assert.equal((await terminal.request('resize', opened.sessionId, { cols: 120, rows: 40 })).ok, true);
  assert.deepEqual(calls.at(-1), ['resize', 40, 120, 0, 0]);
  assert.equal((await terminal.request('close', opened.sessionId)).ok, true);
  assert.equal(events.at(-1).type, 'exit');
  assert.equal((await terminal.request('write', opened.sessionId, input)).code, 'TERMINAL_CLOSED');
});

test('validasi operasi/ukuran/input sebelum membuka atau menulis shell', async () => {
  const { terminal, calls } = setup();
  for (const size of [{ cols: 0, rows: 24 }, { cols: 80, rows: 0 }, { cols: 5000, rows: 24 }, { cols: 80.5, rows: 24 }, null]) {
    assert.equal((await terminal.request('open', size)).code, 'INVALID_REQUEST');
  }
  assert.equal(calls.length, 0);
  assert.equal((await terminal.request('__proto__')).code, 'INVALID_REQUEST');
  const { sessionId } = await terminal.request('open', { cols: 80, rows: 24 });
  for (const data of ['text', {}, new Uint8Array(65537)]) assert.equal((await terminal.request('write', sessionId, data)).code, 'INVALID_REQUEST');
  assert.equal((await terminal.request('resize', sessionId, { cols: Infinity, rows: 20 })).code, 'INVALID_REQUEST');
  assert.equal((await terminal.request('ack', sessionId, -1)).code, 'INVALID_REQUEST');
  assert.equal((await terminal.request('open', { cols: 80, rows: 24, requestId: '../invalid' })).code, 'INVALID_REQUEST');
  terminal.dispose();
});

test('event dan input sesi lama tidak masuk ke terminal baru', async () => {
  const { terminal, streams, events } = setup();
  const first = await terminal.request('open', { cols: 80, rows: 24 });
  await terminal.request('close', first.sessionId);
  const second = await terminal.request('open', { cols: 80, rows: 24 });
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal((await terminal.request('write', first.sessionId, new Uint8Array([3]))).code, 'TERMINAL_CLOSED');
  const before = events.length;
  streams[1].emit('data', Buffer.from('new output'));
  assert.equal(events.length, before + 1);
  assert.equal(events.at(-1).sessionId, second.sessionId);
  terminal.dispose();
});

test('parallel shells route input, output and acknowledgements independently; closing one preserves siblings', async () => {
  const { terminal, streams, events } = setup();
  const requestId = '78b1cdd7-e736-41de-91be-7ec583381e08';
  const first = await terminal.request('open', { cols: 80, rows: 24, requestId });
  const second = await terminal.request('open', { cols: 100, rows: 30, requestId: 'f37b7002-aedc-43d5-a857-65656ff012da' });
  assert.equal(second.ok, true);
  assert.notEqual(first.sessionId, second.sessionId);
  await terminal.request('write', first.sessionId, new TextEncoder().encode('first shell'));
  await terminal.request('write', second.sessionId, new TextEncoder().encode('second shell'));
  const firstData = events.filter(e=>e.type==='data'&&e.sessionId===first.sessionId);
  assert.equal(Buffer.concat(firstData.map(e=>Buffer.from(e.data))).toString(),'first shell');
  assert.equal(firstData[0].requestId,requestId);
  assert.equal(Buffer.concat(events.filter(e=>e.type==='data'&&e.sessionId===second.sessionId).map(e=>Buffer.from(e.data))).toString(),'second shell');
  assert.equal((await terminal.request('ack', first.sessionId, 11)).ok,true);
  assert.equal((await terminal.request('ack', second.sessionId, 12)).ok,true);
  await terminal.request('close',first.sessionId);
  assert.equal((await terminal.request('write', second.sessionId, new Uint8Array([3]))).ok,true);
  assert.equal(streams[1].destroyed,false);
  terminal.dispose();
  assert.ok(events.some(e=>e.type==='exit'&&e.sessionId===second.sessionId&&e.reason==='disconnect'));
});

test('parallel shell count is bounded and a closed shell releases its slot', async () => {
  const { terminal }=setup();const opened=[];
  for(let i=0;i<8;i++)opened.push(await terminal.request('open',{cols:80,rows:24}));
  assert.ok(opened.every(result=>result.ok));
  assert.equal((await terminal.request('open',{cols:80,rows:24})).code,'TERMINAL_LIMIT');
  await terminal.request('close',opened[3].sessionId);
  assert.equal((await terminal.request('open',{cols:80,rows:24})).ok,true);
  terminal.dispose();
});

test('dispose saat pembukaan tertunda menutup channel yang datang terlambat', async () => {
  const { terminal, calls, finishOpen } = setup({ delayed: true });
  const pending = terminal.request('open', { cols: 80, rows: 24 });
  terminal.dispose();
  finishOpen();
  assert.equal((await pending).code, 'TERMINAL_CLOSED');
  assert.equal(calls.at(-1)[0], 'close');
  assert.equal((await terminal.request('open', { cols: 80, rows: 24 })).code, 'NOT_CONNECTED');
});

test('error shell disamarkan, exit ditangani tanpa unhandled error', async () => {
  const bad = setup({ fail: true });
  const result = await bad.terminal.request('open', { cols: 80, rows: 24 });
  assert.equal(result.code, 'TERMINAL_OPEN_FAILED');
  assert.ok(!result.message.includes('private details'));
  const { terminal, stream, events } = setup();
  await terminal.request('open', { cols: 80, rows: 24 });
  stream.emit('error', new Error('private details'));
  assert.equal(events.at(-1).type, 'exit');
  assert.ok(!JSON.stringify(events).includes('private details'));
});

test('output besar berhenti sampai renderer mengakui byte yang selesai ditampilkan', async () => {
  const { terminal, stream, events } = setup();
  const { sessionId } = await terminal.request('open', { cols: 80, rows: 24 });
  for (let i = 0; i < 8; i++) stream.emit('data', Buffer.alloc(32768, 65));
  assert.equal(stream.isPaused(), true);
  const bytes = events.filter(e => e.type === 'data').reduce((n, e) => n + e.data.byteLength, 0);
  assert.equal(bytes, 262144);
  assert.equal((await terminal.request('ack', sessionId, bytes + 1)).code, 'INVALID_REQUEST');
  assert.equal((await terminal.request('ack', sessionId, bytes)).ok, true);
  assert.equal(stream.isPaused(), false);
  terminal.dispose();
});

test('container PTY validates identity and shell before SSH exec and keeps input resize and close isolated', async () => {
  const { terminal, stream, calls } = setup();
  const id = 'a'.repeat(64);
  const invalid = await terminal.request('open', {cols:80,rows:24,containerId:'--all',shell:'/bin/sh'});
  assert.equal(invalid.code,'INVALID_REQUEST');
  assert.equal((await terminal.request('open',{cols:80,rows:24,containerId:id,shell:'/bin/sh;reboot'})).code,'INVALID_REQUEST');
  assert.equal(calls.length,0);
  // The real adapter must choose exec with a PTY instead of a host shell.
  const { createTerminal } = require('../src/main/terminal');
  const executions=[];
  const output=[];
  const container = createTerminal({client:{exec(command,options,ready){executions.push({command,options});ready(null,stream);}}},{onEvent:packet=>output.push(packet)});
  const opened=await container.request('open',{cols:95,rows:29,containerId:id,shell:'/bin/sh',sudo:true});
  assert.equal(opened.ok,true);
  assert.ok(executions[0].command.startsWith('sudo -- env '));
  assert.ok(executions[0].command.includes('--host=unix:///var/run/docker.sock'));
  assert.ok(executions[0].command.endsWith("container exec -it -- '"+id+"' '/bin/sh'"));
  assert.deepEqual(executions[0].options.pty,{term:'xterm-256color',cols:95,rows:29});
  await container.request('write',opened.sessionId,new Uint8Array([3]));
  assert.deepEqual(Buffer.from(output.find(packet=>packet.type==='data').data),Buffer.from([3]));
  await container.request('resize',opened.sessionId,{cols:110,rows:30});
  assert.deepEqual(calls.at(-1),['resize',30,110,0,0]);
  await container.request('close',opened.sessionId);
  assert.deepEqual(calls.at(-1),['close']);
});
