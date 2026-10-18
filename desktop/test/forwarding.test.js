const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { startServer } = require('./helpers/sshServer');
const { connect } = require('../src/main/ssh');
const { createForwarding } = require('../src/main/forwarding');
const config = { id: '11111111-1111-4111-8111-111111111111', name: 'Database', localPort: 13307, remoteHost: '127.0.0.1', remotePort: 3306 };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function freePort() { const server = net.createServer(); await listen(server); const port = server.address().port; await new Promise(r => server.close(r)); return port; }
const tick = () => new Promise(r => setImmediate(r));
async function until(fn) { for (let i=0;i<100;i++) { if (fn()) return; await new Promise(r=>setTimeout(r,10)); } assert.fail('Timed out'); }

test('local forwarding carries binary TCP bytes over real SSH, binds loopback, and releases the port on stop', async t => {
  const target = net.createServer(socket => socket.pipe(socket)); await listen(target);
  const ssh = await startServer();
  const conn = await connect({host:'127.0.0.1',port:ssh.port,username:'deploy',auth:'password'}, {password:'pw-123',hostKeys:{get:()=>ssh.fingerprint}});
  const forwards = createForwarding(conn);
  t.after(async()=>{forwards.dispose();conn.end();await ssh.close();await new Promise(r=>target.close(r));});
  const entry = {...config,localPort:await freePort(),remotePort:target.address().port};
  await forwards.start(entry);
  assert.equal(forwards.list()[0].status,'listening');
  const data = Buffer.alloc(256*1024);for(let i=0;i<data.length;i++)data[i]=i%256;
  const result = await new Promise((resolve,reject)=>{const socket=net.connect(entry.localPort,'127.0.0.1');const chunks=[];let size=0;socket.on('error',reject);socket.on('connect',()=>socket.write(data));socket.on('data',chunk=>{chunks.push(chunk);size+=chunk.length;if(size===data.length){socket.destroy();resolve(Buffer.concat(chunks));}});});
  assert.deepEqual(result,data);assert.deepEqual(ssh.stats.forwards,[{host:'127.0.0.1',port:entry.remotePort}]);
  forwards.stop(entry.id);
  const replacement=net.createServer();await new Promise((resolve,reject)=>{replacement.once('error',reject);replacement.listen(entry.localPort,'127.0.0.1',resolve);});await new Promise(r=>replacement.close(r));
});

test('occupied local ports fail safely and a failed destination does not stop the listener', async t => {
  const occupied=net.createServer();await listen(occupied);
  const client=new EventEmitter();client.forwardOut=(_a,_b,_c,_d,callback)=>callback(new Error('SECRET destination rejected'));
  const forwards=createForwarding({client});t.after(async()=>{forwards.dispose();await new Promise(r=>occupied.close(r));});
  await assert.rejects(forwards.start({...config,localPort:occupied.address().port}),e=>e.code==='PORT_IN_USE'&&!e.message.includes('SECRET'));
  const port=await freePort();await forwards.start({...config,localPort:port});
  const socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});await new Promise(r=>socket.once('close',r));
  assert.equal(forwards.list()[0].status,'listening');assert.equal(forwards.list()[0].connections,0);assert.ok(forwards.list()[0].lastError);assert.ok(!forwards.list()[0].lastError.includes('SECRET'));
});

test('stop and disposal destroy active clients and reject late SSH channels', async t => {
  const callbacks=[];const client=new EventEmitter();client.forwardOut=(_a,_b,_c,_d,callback)=>callbacks.push(callback);
  const forwards=createForwarding({client});t.after(()=>forwards.dispose());const port=await freePort();await forwards.start({...config,localPort:port});
  const socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});await until(()=>callbacks.length===1);
  const closed=new Promise(r=>socket.once('close',r));forwards.stop(config.id);const late=new PassThrough();callbacks[0](null,late);await closed;assert.equal(late.destroyed,true);
  forwards.dispose();await assert.rejects(forwards.start({...config,localPort:port}),e=>e.code==='NOT_CONNECTED');
});

test('forwarding validates endpoints before binding or opening channels and limits active tunnels', async t => {
  const client=new EventEmitter();const forwards=createForwarding({client});t.after(()=>forwards.dispose());
  for(const input of [{...config,localPort:0},{...config,localPort:80},{...config,remotePort:65536},{...config,remoteHost:'host;reboot'},{...config,id:'../bad'},{...config,bindHost:'0.0.0.0'}])await assert.rejects(forwards.start(input),e=>e.code==='TUNNEL_INVALID');
  for(let i=0;i<8;i++)await forwards.start({...config,id:`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`,localPort:await freePort()});
  await assert.rejects(forwards.start({...config,localPort:await freePort()}),e=>e.code==='TUNNEL_LIMIT');
});

test('pending client openings count toward the per-tunnel limit and disappear on disconnect', async t => {
  const client=new EventEmitter();let openings=0;client.forwardOut=()=>{openings++;};
  const forwards=createForwarding({client});t.after(()=>forwards.dispose());const port=await freePort();await forwards.start({...config,localPort:port});
  const sockets=Array.from({length:33},()=>{const s=net.connect(port,'127.0.0.1');s.on('error',()=>{});return s;});t.after(()=>sockets.forEach(s=>s.destroy()));
  await until(()=>sockets.some(s=>s.destroyed));assert.equal(openings,32);assert.equal(forwards.list()[0].connections,32);
  client.emit('close');await tick();assert.equal(forwards.list().length,0);
});

test('TCP half-close still delivers the destination response after client input ends', async t => {
  const target=net.createServer({allowHalfOpen:true},socket=>{socket.resume();socket.once('end',()=>socket.end('response-after-fin'));});await listen(target);
  const ssh=await startServer();const conn=await connect({host:'127.0.0.1',port:ssh.port,username:'deploy',auth:'password'},{password:'pw-123',hostKeys:{get:()=>ssh.fingerprint}});
  const forwards=createForwarding(conn);t.after(async()=>{forwards.dispose();conn.end();await ssh.close();await new Promise(r=>target.close(r));});
  const port=await freePort();await forwards.start({...config,localPort:port,remotePort:target.address().port});
  const result=await new Promise((resolve,reject)=>{const socket=net.connect(port,'127.0.0.1');let text='';socket.on('error',reject);socket.on('connect',()=>socket.end('request'));socket.on('data',chunk=>text+=chunk);socket.on('end',()=>resolve(text));});
  assert.equal(result,'response-after-fin');
});

test('a slow local reader receives the complete remote payload before SSH channel cleanup', {timeout:10000}, async t => {
  const payload=Buffer.alloc(8*1024*1024,173);
  const target=net.createServer(socket=>socket.end(payload));await listen(target);
  const ssh=await startServer();const conn=await connect({host:'127.0.0.1',port:ssh.port,username:'deploy',auth:'password'},{password:'pw-123',hostKeys:{get:()=>ssh.fingerprint}});
  const forwards=createForwarding(conn);t.after(async()=>{forwards.dispose();conn.end();await ssh.close();await new Promise(r=>target.close(r));});
  const port=await freePort();await forwards.start({...config,localPort:port,remotePort:target.address().port});
  const actual=await new Promise((resolve,reject)=>{const chunks=[];const socket=net.connect(port,'127.0.0.1');socket.on('error',reject);socket.pause();setTimeout(()=>socket.resume(),150);socket.on('data',chunk=>chunks.push(chunk));socket.on('close',()=>resolve(Buffer.concat(chunks)));});
  assert.deepEqual(actual,payload);
});

test('an unresponsive SSH channel opening times out and its eventual channel is destroyed', async t => {
  let opened,callback;const opening=new Promise(r=>opened=r);const client=new EventEmitter();client.forwardOut=(_a,_b,_c,_d,cb)=>{callback=cb;opened();};
  const forwards=createForwarding({client});t.after(()=>forwards.dispose());const port=await freePort();await forwards.start({...config,localPort:port});
  t.mock.timers.enable({apis:['setTimeout']});
  const socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});const closed=new Promise(r=>socket.once('close',r));await opening;
  t.mock.timers.tick(15000);await closed;
  assert.equal(forwards.list()[0].connections,0);assert.ok(forwards.list()[0].lastError);
  const channel=new PassThrough();callback(null,channel);assert.equal(channel.destroyed,true);
});

test('total pending clients are bounded across multiple tunnels', async t => {
  const client=new EventEmitter();let openings=0;client.forwardOut=()=>{openings++;};const forwards=createForwarding({client});t.after(()=>forwards.dispose());
  const sockets=[];t.after(()=>sockets.forEach(s=>s.destroy()));
  for(let i=0;i<5;i++){
    const port=await freePort();await forwards.start({...config,id:`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`,localPort:port});
    const count=i===4?1:32;for(let j=0;j<count;j++){const socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});sockets.push(socket);}
    await until(()=>i===4?sockets.at(-1).destroyed:openings===(i+1)*32);
  }
  assert.equal(openings,128);assert.equal(forwards.list().reduce((n,e)=>n+e.connections,0),128);
});

test('unanswered SSH opening quotas survive timeout and Stop/Start until SSH replies',async t=>{
 const client=new EventEmitter(),callbacks=[];let onOpen=()=>{};client.forwardOut=(_a,_b,_c,_d,callback)=>{callbacks.push(callback);onOpen();};
 const forwards=createForwarding({client});t.after(()=>forwards.dispose());const port=await freePort();await forwards.start({...config,localPort:port});
 t.mock.timers.enable({apis:['setTimeout']});
 const clients=[];t.after(()=>clients.forEach(s=>s.destroy()));
 for(let i=0;i<32;i++){const opened=new Promise(r=>onOpen=r);const socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});clients.push(socket);await opened;socket.destroy();}
 t.mock.timers.tick(15000);await tick();assert.equal(forwards.list()[0].connections,0);
 forwards.stop(config.id);await forwards.start({...config,localPort:port});
 const extraOpened=new Promise(r=>onOpen=r);const extra=net.connect(port,'127.0.0.1');extra.on('error',()=>{});clients.push(extra);const closed=new Promise(r=>extra.once('close',r));
 assert.equal(await Promise.race([closed.then(()=>'closed'),extraOpened.then(()=>'opened')]),'closed','unanswered SSH requests must still consume capacity');
 assert.equal(callbacks.length,32);
 for(const callback of callbacks.splice(0))callback(new Error('rejected'));
 const recoveredOpen=new Promise(r=>onOpen=r);const recovered=net.connect(port,'127.0.0.1');recovered.on('error',()=>{});clients.push(recovered);await recoveredOpen;assert.equal(callbacks.length,1);
});
