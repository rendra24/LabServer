// Read-only terminal timing audit. Uses only a temporary loopback SSH echo server and userData.
// Run: electron scripts/audit-terminal-latency.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { Server, utils } = require('ssh2');
const { connect } = require('../src/main/ssh');
const { createSessionManager } = require('../src/main/sessions');
const { webPreferences, isAllowedNavigation } = require('../src/main/security');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labserver-latency-'));
app.setPath('userData', dir);
const channels = [], clients = new Set(), errors = [];
let win, sshServer, sessions, conn, flood;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = source => win.webContents.executeJavaScript(source);
async function until(source) {
  for (let i = 0; i < 200; i++) { if (await evaluate(source)) return; await wait(20); }
  throw new Error(`Timed out: ${source}`);
}

app.whenReady().then(async () => {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  sshServer = new Server({ hostKeys: [hostKey] }, client => {
    clients.add(client); client.setNoDelay(true);
    client.on('close', () => clients.delete(client)); client.on('error', () => {});
    client.on('authentication', ctx => ctx.username === 'deploy' && ctx.password === 'fixture-only' ? ctx.accept() : ctx.reject());
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', acceptPty => acceptPty());
      session.on('window-change', acceptResize => acceptResize?.());
      session.on('shell', acceptShell => {
        const channel = acceptShell(); channels.push(channel);
        channel.on('error', () => {});
        channel.on('data', data => channel.write(data));
        channel.write('FIXTURE $ ');
      });
    }));
  });
  await new Promise(resolve => sshServer.listen(0, '127.0.0.1', resolve));
  const fingerprint = require('../src/main/ssh').fingerprintOf(utils.parseKey(hostKey).getPublicSSH());
  const profile = { id: 'audit-only', name: 'Latency fixture', host: '127.0.0.1', port: sshServer.address().port, username: 'deploy', auth: 'password' };
  sessions = createSessionManager({
    open: async () => { conn = await connect(profile, { password: 'fixture-only', hostKeys: { get: () => fingerprint } }); return conn; },
    getProfile: () => profile, makeOps: () => ({}),
  });
  win = new BrowserWindow({ width: 1320, height: 868, webPreferences: webPreferences(path.join(__dirname, '../src/preload/preload.js')) });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  for (const [name, handler] of Object.entries({
    'app:info': () => ({ version: 'audit', canRemember: false }), 'servers:list': () => [],
    'terminal:call': (_event, id, op, ...args) => sessions.terminal(id, op, ...args),
  })) ipcMain.handle(name, (event, ...args) => {
    if (!event.senderFrame || !isAllowedNavigation(event.senderFrame.url)) throw new Error('Untrusted frame');
    return handler(event, ...args);
  });
  await sessions.connect(profile.id, {}, packet => win.webContents.send('terminal:event', { serverId: profile.id, ...packet }));
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  await evaluate(`
    window.auditTerms = [];
    window.Terminal = class extends window.Terminal {
      constructor(options) {
        super(options);
        const item = {term:this,pending:[],paintPending:[],echo:[],paint:[],parse:[],measuring:false};
        window.auditTerms.push(item);
        this.onData(data => { if(item.measuring) for(const char of data) item.pending.push({char,start:performance.now()}); });
        this.onRender(() => { const now=performance.now(); for(const sent of item.paintPending.splice(0))item.paint.push(now-sent.start); });
        const write = this.write.bind(this);
        this.write = (data,callback) => {
          const arrived=performance.now(), matched=[];
          const text=typeof data==='string'?data:new TextDecoder().decode(data);
          if(item.measuring)for(const char of text)if(item.pending[0]?.char===char)matched.push(item.pending.shift());
          write(data,() => {
            if(item.measuring)item.parse.push(performance.now()-arrived);
            for(const sent of matched){item.echo.push(performance.now()-sent.start);item.paintPending.push(sent);}
            callback?.();
          });
        };
      }
    };
    import('./app.js').then(({app,show})=>{app.server=${JSON.stringify(profile)};show('terminal');});
  `);
  await until("document.getElementById('term-status').textContent === 'Shell aktif'");
  await wait(300); win.focus();
  const results = [];
  async function measure(label, nativeKeys = false) {
    win.focus();
    await wait(200);
    const measurement = evaluate(`(async()=>{
      const item=window.auditTerms.at(-1);
      item.echo=[];item.paint=[];item.parse=[];item.pending=[];item.paintPending=[];item.measuring=true;
      const visibility=[{state:document.visibilityState,focus:document.hasFocus()}];
      const visibilityChanged=()=>visibility.push({state:document.visibilityState,focus:document.hasFocus()});
      document.addEventListener('visibilitychange',visibilityChanged);
      const delays=[];let last=performance.now();
      const timer=setInterval(()=>{const now=performance.now();delays.push(Math.max(0,now-last-10));last=now;},10);
      if(!${nativeKeys})for(let i=0;i<80;i++){item.term.input(String.fromCharCode(97+i%26),true);await new Promise(r=>setTimeout(r,15));}
      for(let i=0;i<200&&item.echo.length<80;i++)await new Promise(r=>setTimeout(r,10));
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      clearInterval(timer);item.measuring=false;document.removeEventListener('visibilitychange',visibilityChanged);
      const stats=data=>{const values=data.sort((a,b)=>a-b);const q=p=>Number((values[Math.floor((values.length-1)*p)]||0).toFixed(2));return{p50:q(.5),p95:q(.95),max:q(1)};};
      return {label:${JSON.stringify(label)},visibility,echoes:item.echo.length,renderEvents:item.paint.length,echoMs:stats(item.echo),renderEventMs:stats(item.paint),parseMs:stats(item.parse),eventLoopDelayMs:stats(delays)};
    })()`);
    if(nativeKeys) {
      await wait(100);
      for(let i=0;i<80;i++) {
        const keyCode=String.fromCharCode(97+i%26);
        win.webContents.sendInputEvent({type:'keyDown',keyCode});
        win.webContents.sendInputEvent({type:'char',keyCode});
        win.webContents.sendInputEvent({type:'keyUp',keyCode});
        await wait(15);
      }
    }
    const result = await measurement;
    results.push(result); console.log(JSON.stringify(result));
  }
  await measure('one tab, production defaults');
  await measure('one tab, native keyboard events',true);
  conn.client.setNoDelay(true);
  await measure('one tab, TCP_NODELAY enabled');
  conn.client.setNoDelay(false);
  await evaluate('window.auditTerms[0].term.options.screenReaderMode=false');
  await measure('one tab, screen reader mode disabled');
  await evaluate('window.auditTerms[0].term.options.screenReaderMode=true');
  await measure('one tab, screen reader mode restored');
  for(let i=0;i<7;i++) {
    await evaluate("document.getElementById('term-new').click()");
    await until("document.getElementById('term-status').textContent === 'Shell aktif'");
  }
  await wait(300);
  await measure('eight tabs, seven idle');
  const chunk=Buffer.from(('LOG 1234567890 ABCDEFGHIJKLMNOPQRSTUVWXYZ\r\n').repeat(100));
  flood=setInterval(()=>{for(const channel of channels.slice(0,-1))if(!channel.destroyed&&!channel.writableNeedDrain)channel.write(chunk);},30);
  await wait(500);
  await measure('eight tabs, seven background streams ~0.9 MiB/s total');
  clearInterval(flood); flood=null;
  console.log(JSON.stringify({electron:process.versions.electron,platform:process.platform,arch:process.arch,rendererErrors:errors,results},null,2));
  if(errors.length || results.some(result=>result.echoes!==80))throw new Error('Incomplete audit samples or renderer errors');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  clearInterval(flood);sessions?.closeAll();for(const client of clients)client.end();
  if(sshServer)await new Promise(resolve=>sshServer.close(resolve));
  win?.destroy();fs.rmSync(dir,{recursive:true,force:true});app.exit(process.exitCode||0);
});
