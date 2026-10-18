const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const syncFs = require('node:fs');
const { fileSftp } = require('./helpers/fileSftp');
const { createLocalFiles } = require('../src/main/local-files');
const { createRemoteFiles } = require('../src/main/remote-files');
const { createTransfers } = require('../src/main/file-transfers');

async function setup(t, onEvent) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'labserver-transfer-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'remote/home/deploy'), { recursive: true });
  await fs.mkdir(path.join(root, 'local'));
  const local = createLocalFiles(); const grant = await local.grant(path.join(root, 'local'));
  const conn = fileSftp(path.join(root, 'remote'));
  const remote = createRemoteFiles(conn);
  const queue = createTransfers({ local, remote, emit: onEvent || (() => {}), changed() {} });
  t.after(() => queue.dispose());
  return { root, local, grant, conn, remote, queue };
}
async function wait(queue, id, state) {
  for (let i = 0; i < 300; i++) { const job = queue.list().find(j => j.id === id); if (state ? job.status === state : ['complete','partial','failed','cancelled'].includes(job.status)) return job; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('Transfer timeout');
}
test('recursive streamed upload/download preserves bytes, empty folders and hidden files', async t => {
  const { root, grant, conn, queue } = await setup(t);
  await fs.mkdir(path.join(root, 'local/source/empty'), { recursive: true });
  await fs.writeFile(path.join(root, 'local/source/.env'), 'private fixture');
  const bytes = Buffer.alloc(2 * 1024 * 1024, 73);
  await fs.writeFile(path.join(root, 'local/source/日本 file.bin'), bytes);
  const [id] = await queue.start('upload', [{ grantId: grant.id, relative: 'source' }], { path: '/home/deploy' });
  assert.equal((await wait(queue, id)).status, 'complete');
  assert.deepEqual(await fs.readFile(conn.target('/home/deploy/source/日本 file.bin')), bytes);
  assert.equal((await fs.stat(conn.target('/home/deploy/source/empty'))).isDirectory(), true);
  await fs.mkdir(path.join(root, 'local/download'));
  const [down] = await queue.start('download', ['/home/deploy/source'], { grantId: grant.id, relative: 'download' });
  assert.equal((await wait(queue, down)).status, 'complete');
  assert.equal(await fs.readFile(path.join(root, 'local/download/source/.env'), 'utf8'), 'private fixture');
});
test('explicit conflicts, cancellation while waiting and retry never truncate old destination', async t => {
  const { root, grant, conn, queue } = await setup(t);
  await fs.writeFile(path.join(root, 'local/test.txt'), 'new data');
  await fs.writeFile(conn.target('/home/deploy/test.txt'), 'old data');
  const [id] = await queue.start('upload', [{ grantId: grant.id, relative: 'test.txt' }], { path: '/home/deploy' });
  await wait(queue, id, 'conflict');
  queue.cancel(id);
  assert.equal((await wait(queue, id)).status, 'cancelled');
  assert.equal(await fs.readFile(conn.target('/home/deploy/test.txt'), 'utf8'), 'old data');
  const [retry] = await queue.retry(id);
  await wait(queue, retry, 'conflict');
  queue.decide(retry, 'rename', false);
  assert.equal((await wait(queue, retry)).status, 'complete');
  assert.equal(await fs.readFile(conn.target('/home/deploy/test (1).txt'), 'utf8'), 'new data');
  assert.equal(await fs.readFile(conn.target('/home/deploy/test.txt'), 'utf8'), 'old data');
});

test('cancelling a slow stream preserves old destination and removes only owned temporary files', async t => {
  let queue;
  const data = await setup(t, packet => { if (packet.job.status === 'running' && packet.job.copied > 0) queue.cancel(packet.job.id); });
  queue = data.queue;
  const originalWrite = data.conn.s.createWriteStream;
  data.conn.s.createWriteStream = (p, opts) => {
    const stream = originalWrite(p, opts); const write = stream._write;
    stream._write = (chunk, encoding, callback) => setTimeout(() => stream.destroyed ? callback(new Error('cancelled fixture write')) : write.call(stream, chunk, encoding, callback), 8);
    return stream;
  };
  await fs.writeFile(path.join(data.root, 'local/large.bin'), Buffer.alloc(4 * 1024 * 1024, 66));
  await fs.writeFile(data.conn.target('/home/deploy/large.bin'), 'original-user-data');
  const [id] = await queue.start('upload', [{grantId:data.grant.id,relative:'large.bin'}], {path:'/home/deploy'});
  await wait(queue,id,'conflict'); queue.decide(id,'overwrite');
  const job = await wait(queue,id);
  assert.equal(job.status,'cancelled');
  assert.match(job.message,/dibatalkan/);
  assert.equal(await fs.readFile(data.conn.target('/home/deploy/large.bin'),'utf8'),'original-user-data');
  assert.equal((await fs.readdir(data.conn.target('/home/deploy'))).filter(n=>n.endsWith('.part')).length,0);
});

test('destination appearing during transfer is never silently replaced; concurrency stays at two', async t => {
  const {root,grant,conn,queue}=await setup(t);
  for(const name of ['a','b','c'])await fs.writeFile(path.join(root,'local',name),Buffer.alloc(1024*1024,65));
  let simultaneous=0,max=0;
  const original=conn.s.createWriteStream;
  conn.s.createWriteStream=(p,options)=>{simultaneous++;max=Math.max(max,simultaneous);const stream=original(p,options);stream.once('close',()=>simultaneous--);if(p.endsWith('.part')&&!syncFs.existsSync(conn.target('/home/deploy/a')))syncFs.writeFileSync(conn.target('/home/deploy/a'),'appeared concurrently');return stream;};
  const ids=await queue.start('upload',['a','b','c'].map(relative=>({grantId:grant.id,relative})),{path:'/home/deploy'});
  const results=await Promise.all(ids.map(id=>wait(queue,id)));
  assert.equal(results[0].status,'failed');
  assert.equal(await fs.readFile(conn.target('/home/deploy/a'),'utf8'),'appeared concurrently');
  assert.ok(max<=2);
});

test('download cleanup preserves outside files after a granted directory is replaced by a symlink', async t => {
  const {root,grant,conn,local,queue}=await setup(t);
  await fs.writeFile(conn.target('/home/deploy/data.txt'),'download bytes');
  const outside=path.join(root,'outside');await fs.mkdir(outside);
  const resolve=local.resolve;let temporaryChecks=0;let outsideFile;
  local.resolve=async(...args)=>{
    const result=await resolve(...args);
    if(args[1]?.endsWith('.part')&&++temporaryChecks===2){
      await fs.rename(path.join(root,'local'),path.join(root,'moved-local'));
      await fs.symlink(outside,path.join(root,'local'));
      outsideFile=path.join(outside,path.basename(result));
      await fs.writeFile(outsideFile,'outside user data');
    }
    return result;
  };
  const [id]=await queue.start('download',['/home/deploy/data.txt'],{grantId:grant.id,relative:''});
  const job=await wait(queue,id);
  assert.equal(job.status,'failed');
  assert.equal(await fs.readFile(outsideFile,'utf8'),'outside user data');
  assert.ok(job.errors.some(e=>e.path.endsWith('.part')),'unsafe cleanup must be reported');
});
