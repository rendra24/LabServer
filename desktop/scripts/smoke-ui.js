// Uji renderer Electron asli dengan IPC fixture; tidak menghubungi atau mengubah VPS.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, nativeTheme, Menu, nativeImage } = require("electron");
const { applyBranding } = require("../src/main/branding");
const { createStore } = require("../src/main/store");
const { webPreferences, RENDERER_DIR } = require("../src/main/security");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labserver-ui-"));
app.setPath("userData", dir);
nativeTheme.themeSource = "dark";
const output = process.env.LABSERVER_SCREENSHOTS;
const consoleErrors = [];
let win;
let tests = 0;

async function evaluate(source) { return win.webContents.executeJavaScript(source); }
async function until(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timeout: ${expression}`);
}
async function check(label, source) {
  assert.equal(await evaluate(source), true, label);
  tests++;
  console.log(`PASS ${label}`);
}
async function screenshot(name) {
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  // Beri compositor kesempatan melukis tema/layout terbaru sebelum capturePage.
  await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  await new Promise((resolve) => setTimeout(resolve, 200));
  fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}

app.whenReady().then(async () => {
  const internalName = app.getName();
  applyBranding();
  assert.equal(app.getName(), internalName, "branding preserves internal credential identity");
  assert.equal(nativeImage.createFromPath(path.join(RENDERER_DIR, "assets/labserver-logo.png")).isEmpty(), false, "native logo is readable");
  if (process.platform === "darwin") {
    assert.equal(Menu.getApplicationMenu().items[0].label, "LabServer");
    assert.equal(Menu.getApplicationMenu().items[0].submenu.items[0].label, "Tentang LabServer");
  }
  console.log("PASS native branding and credential identity");
  tests++;
  const store = createStore(dir, null);
  const list = () => store.list().map((p) => ({ ...p, hasSavedPassword: true }));
  const channels = {
    "app:info": () => ({ version: "0.1.0", canRemember: false }),
    "servers:list": list,
    "servers:save": (_e, input) => {
      try { return { ok: true, profile: store.save(input) }; }
      catch (e) { return { ok: false, errors: e.errors }; }
    },
    "servers:remove": () => ({ ok: false, cancelled: true }),
    "servers:test": () => ({ ok: true }),
    "servers:connect": () => ({ ok: true }),
    "servers:disconnect": () => ({ ok: true }),
    "sites:call": (_e, _id, op) => {
      if (op === "list") return { ok: true, data: [{ name: "api.labserver.dev", enabled: true, mtime: 1792200000 }, { name: "staging.labserver.dev", enabled: false, mtime: 1792113600 }] };
      if (op === "read") return { ok: true, data: "server {\n    listen 80;\n    server_name api.labserver.dev;\n\n    location / {\n        proxy_pass http://127.0.0.1:3000;\n        proxy_set_header Host $host;\n    }\n}\n" };
      if (op === "test") return { ok: true, data: { ok: true, output: "nginx: configuration file /etc/nginx/nginx.conf test is successful" } };
      return { ok: true, data: { ok: true } };
    },
  };
  for (const [channel, handler] of Object.entries(channels)) ipcMain.handle(channel, handler);
  win = new BrowserWindow({ width: 1320, height: 900, show: false, webPreferences: { ...webPreferences(path.join(__dirname, "../src/preload/preload.js")), backgroundThrottling: false } });
  win.webContents.on("console-message", (_e, details) => {
    if (details.level === "error") consoleErrors.push(details.message);
  });
  await win.loadFile(path.join(RENDERER_DIR, "index.html"));
  await until("document.getElementById('version').textContent === 'v0.1.0'");
  await check("empty workspace", "!document.getElementById('empty').hidden && document.getElementById('nav-sites').disabled");
  await evaluate("document.getElementById('sidebar-toggle').click()");
  await check("hide sidebar expands workspace", "document.getElementById('sidebar').hidden && getComputedStyle(document.querySelector('.workspace-main')).marginLeft === '0px' && document.getElementById('sidebar-toggle').getAttribute('aria-expanded') === 'false'");
  await win.loadFile(path.join(RENDERER_DIR, "index.html"));
  await until("document.getElementById('version').textContent === 'v0.1.0'");
  await check("hidden sidebar restored after reload", "document.getElementById('sidebar').hidden && document.getElementById('sidebar-toggle').getAttribute('aria-label') === 'Tampilkan sidebar'");
  await evaluate("document.getElementById('sidebar-toggle').click()");
  await check("show sidebar restores workspace", "!document.getElementById('sidebar').hidden && parseFloat(getComputedStyle(document.querySelector('.workspace-main')).marginLeft) > 0 && localStorage.getItem('labserver-sidebar-hidden') === 'false'");
  await screenshot("labserver-empty-dark");
  await evaluate("document.getElementById('add').click(); document.getElementById('server-form').requestSubmit()");
  await until("document.getElementById('f-name').getAttribute('aria-invalid') === 'true'");
  await check("form validation", "document.getElementById('server-dialog').open && document.getElementById('e-host').textContent.length > 0");
  await evaluate(`document.getElementById('f-name').value = 'Production · Singapore'; document.getElementById('f-host').value = '203.0.113.10'; document.getElementById('f-username').value = 'deploy'; document.getElementById('server-form').requestSubmit()`);
  await until("document.querySelectorAll('.server-card').length === 1 && !document.getElementById('server-dialog').open");
  for (const [name, host, username, auth] of [
    ["Staging · Jakarta", "198.51.100.24", "ubuntu", "key"],
    ["Development", "dev.labserver.test", "developer", "password"],
    ["Edge proxy", "203.0.113.42", "nginx", "key"],
    ["Personal lab", "192.0.2.18", "admin", "password"],
  ]) store.save({ name, host, username, auth, keyPath: "/tmp/test-key", port: 22 });
  await evaluate("document.getElementById('nav-servers').click()");
  await until("document.querySelectorAll('.server-card').length === 5");
  await screenshot("labserver-servers-dark");
  await evaluate("document.getElementById('server-search').value = 'UBUNTU'; document.getElementById('server-search').dispatchEvent(new Event('input'))");
  await check("search username, case insensitive", "document.querySelectorAll('.server-card').length === 1 && document.querySelector('.server-card h3').textContent.includes('Staging')");
  await evaluate("document.getElementById('server-search').value = 'missing-host'; document.getElementById('server-search').dispatchEvent(new Event('input'))");
  await check("no results state", "!document.getElementById('no-results').hidden && document.getElementById('servers').hidden");
  await evaluate("document.getElementById('clear-search').click(); document.getElementById('list-view').click()");
  await check("list mode retains edit controls", "document.getElementById('servers').classList.contains('is-list') && getComputedStyle(document.querySelector('.server-card-tools')).display !== 'none'");
  await evaluate("document.getElementById('grid-view').click(); document.querySelector('.server-card-actions .btn').click()");
  await until("document.querySelector('.connection-result').textContent.includes('Tes berhasil')");
  await evaluate("document.getElementById('server-search').dispatchEvent(new Event('input'))");
  await check("connection test result survives filtering", "document.querySelector('.connection-result').textContent.includes('Tes berhasil')");
  await evaluate("document.getElementById('theme-light').click()");
  await check("light theme persisted", "document.documentElement.dataset.theme === 'light' && localStorage.getItem('labserver-theme') === 'light' && document.getElementById('theme-light').getAttribute('aria-pressed') === 'true'");
  await check("light palette applied", "getComputedStyle(document.body).backgroundColor === 'rgb(247, 248, 252)'");
  await screenshot("labserver-servers-light");
  await win.loadFile(path.join(RENDERER_DIR, "index.html"));
  await until("document.querySelectorAll('.server-card').length === 5");
  await check("theme restored after reload", "document.documentElement.dataset.theme === 'light'");
  await evaluate("document.getElementById('add').click(); document.querySelector('input[name=auth][value=key]').click()");
  await check("SSH key selection", "!document.getElementById('key-row').hidden");
  await screenshot("labserver-dialog-light");
  await evaluate("document.getElementById('server-dialog').close(); document.getElementById('theme-dark').click(); document.querySelector('.btn-connect').click()");
  await until("!document.getElementById('view-sites').hidden && document.querySelectorAll('#sites-rows tr').length === 2");
  await check("connected sidebar + reload locked", "!document.getElementById('nav-sites').disabled && !document.getElementById('sidebar-session').hidden && document.getElementById('sites-reload').disabled");
  await screenshot("labserver-sites-dark");
  await evaluate("document.getElementById('sites-test').click()");
  await until("!document.getElementById('sites-reload').disabled");
  await check("syntax test unlocks reload", "document.getElementById('sites-log').textContent.includes('Sintaks valid')");
  await evaluate("document.querySelector('#sites-rows .btn').click()");
  await until("!document.getElementById('view-editor').hidden && document.getElementById('ed-state').textContent === 'Tersimpan'");
  await screenshot("labserver-editor-dark");
  await evaluate("document.getElementById('sidebar-toggle').click()");
  await until("window.ace.edit('ed-editor').renderer.$size.width === document.getElementById('ed-editor').clientWidth");
  await check("hide sidebar preserves editor and resizes Ace", "document.getElementById('sidebar').hidden && document.getElementById('ed-state').textContent === 'Tersimpan' && window.ace.edit('ed-editor').getValue().includes('proxy_pass')");
  await screenshot("labserver-editor-sidebar-hidden");
  await evaluate("document.getElementById('sidebar-toggle').click()");
  await evaluate("document.getElementById('theme-light').click()");
  await until("document.getElementById('ed-editor').classList.contains('ace-tomorrow')");
  await check("editor follows light theme", "!document.getElementById('ed-editor').classList.contains('ace-tomorrow-night')");
  await screenshot("labserver-editor-light");
  await evaluate("window.ace.edit('ed-editor').setValue('server { listen 8080; }'); window.confirm = () => false; document.getElementById('nav-servers').click()");
  await check("sidebar respects unsaved changes", "!document.getElementById('view-editor').hidden && document.getElementById('ed-state').textContent === 'Belum Disimpan'");
  await evaluate("window.confirm = () => true; document.getElementById('nav-servers').click()");
  await until("!document.getElementById('view-servers').hidden");
  await check("disconnect resets sidebar", "document.getElementById('nav-sites').disabled && document.getElementById('sidebar-session').hidden");
  await evaluate("document.getElementById('help').click()");
  await check("help dialog", "document.getElementById('help-dialog').open");
  await evaluate("document.getElementById('help-dialog').close()");
  for (const width of [900, 600]) {
    win.setSize(width, 800);
    await until(`window.innerWidth === ${width}`);
    await evaluate("new Promise(r => requestAnimationFrame(r))");
    await check(`no horizontal overflow at ${width}px`, "document.documentElement.scrollWidth <= window.innerWidth");
    await screenshot(`labserver-servers-${width}`);
    await evaluate("document.getElementById('sidebar-toggle').click()");
    await check(`hidden sidebar fits ${width}px`, "document.getElementById('sidebar').hidden && document.documentElement.scrollWidth <= window.innerWidth && getComputedStyle(document.querySelector('.workspace-main')).marginLeft === '0px'");
    await evaluate("document.getElementById('sidebar-toggle').click()");
  }
  assert.deepEqual(consoleErrors, [], "renderer console errors");
  console.log(`UI smoke: ${tests} checks passed; no renderer errors. IPC uses fixtures, no live VPS.`);
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  win?.destroy();
  app.exit(process.exitCode || 0);
});
