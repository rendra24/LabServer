import { $, el, busy, showError } from './ui.js';

export function createFilesEditor({ request, serverId, contextId }) {
  let file = null;
  let editor = null;
  let changing = false;
  let timer;
  let dirtyResolver = null;
  let saving = false;
  let generation = 0;
  const dialog = $('fm-editor-dialog');
  const dirty = () => Boolean(file && editor && editor.getValue() !== file.baseline);
  function state() {
    $('fm-editor-state').textContent = dirty() ? 'Belum disimpan' : 'Tersimpan';
    $('fm-resume-editor').hidden = !file || dialog.open;
    clearTimeout(timer);
    if (file) {
      const buffer = file, context = contextId();
      timer = setTimeout(() => { if (file === buffer && file.server === serverId() && context === contextId()) request('editor', { path: file.path, dirty: dirty() }).catch(() => {}); }, 100);
    }
  }
  function ensure() {
    if (editor) return;
    window.ace.config.set('useStrictCSP', true);
    window.ace.config.set('basePath', 'vendor/ace');
    editor = window.ace.edit('fm-editor-area', { mode: 'ace/mode/text', theme: document.documentElement.dataset.theme === 'light' ? 'ace/theme/tomorrow' : 'ace/theme/tomorrow_night', useWorker: false, fontSize: 13, showPrintMargin: false, tabSize: 2, enableKeyboardAccessibility: true });
    editor.session.on('change', () => { if (!changing) state(); });
    editor.commands.addCommand({ name: 'saveFile', bindKey: { win: 'Ctrl-S', mac: 'Command-S' }, exec: () => save() });
  }
  function reveal() {
    if (!file) return;
    if (!dialog.open) dialog.showModal();
    $('fm-resume-editor').hidden = true;
    requestAnimationFrame(() => { editor.resize(); editor.focus(); });
  }
  async function load(path) {
    const server = serverId(), context = contextId(), current = ++generation;
    const valid = () => current === generation && server === serverId() && context === contextId();
    const result = await request('read', { path });
    if (!valid()) return false;
    if (!result.ok) { $('fm-editor-error').textContent = result.message; showError(result.message); return false; }
    const pinned = await request('editor', { path, dirty: false });
    if (!valid()) return false;
    if (!pinned.ok) { showError(pinned.message); return false; }
    ensure();
    file = { path, server, revision: result.data.revision, baseline: result.data.text };
    changing = true; editor.setValue(file.baseline, -1); changing = false;
    const ext = path.split('.').pop().toLowerCase();
    const mode = { json: 'json', md: 'markdown', sh: 'sh', js: 'javascript', css: 'css', html: 'html', yml: 'yaml', yaml: 'yaml', conf: 'nginx' }[ext] || 'text';
    editor.session.setMode(`ace/mode/${mode}`);
    $('fm-editor-title').textContent = path.split('/').pop();
    $('fm-editor-path').textContent = path;
    $('fm-editor-error').replaceChildren();
    state(); reveal(); return true;
  }
  async function save(force = false) {
    if (saving) return false;
    if (!file || file.server !== serverId()) { $('fm-editor-error').textContent = 'Hubungkan kembali server asal sebelum menyimpan file ini.'; reveal(); return false; }
    saving = true;
    try {
    const text = editor.getValue();
    const result = await busy($('fm-editor-save'), 'Menyimpan…', () => request('save', { path: file.path, text, revision: file.revision, force }));
    if (!result.ok) {
      $('fm-editor-error').replaceChildren(result.message);
      if (result.code === 'CHANGED') {
        const reload = el('button', { text: 'Muat ulang dan buang perubahan', cls: 'btn', attrs: { type: 'button' } });
        const overwrite = el('button', { text: 'Timpa perubahan di server', cls: 'btn btn-danger', attrs: { type: 'button' } });
        reload.addEventListener('click', () => load(file.path)); overwrite.addEventListener('click', () => save(true));
        $('fm-editor-error').append(reload, overwrite);
      }
      reveal(); return false;
    }
    file.baseline = text; file.revision = result.data.revision;
    $('fm-editor-error').replaceChildren();
    await request('editor', { path: file.path, dirty: dirty() });
    state(); return true;
    } finally { saving = false; }
  }
  function release() { generation++; clearTimeout(timer); file = null; $('fm-resume-editor').hidden = true; request('editor', { path: null, dirty: false }).catch(() => {}); if (dialog.open) dialog.close(); }
  async function guard(releaseAfter = false) {
    if (saving) return false;
    let allowed = true;
    if (dirty()) {
      if (dirtyResolver) return false;
      $('fm-dirty-dialog').showModal();
      allowed = await new Promise(resolve => { dirtyResolver = resolve; });
    }
    if (allowed && releaseAfter) release();
    return allowed;
  }
  function decide(value) { const resolve = dirtyResolver; dirtyResolver = null; if ($('fm-dirty-dialog').open) $('fm-dirty-dialog').close(); resolve?.(value); }
  $('fm-dirty-cancel').addEventListener('click', () => decide(false));
  $('fm-dirty-discard').addEventListener('click', () => { if (file) { changing = true; editor.setValue(file.baseline, -1); changing = false; state(); } decide(true); });
  $('fm-dirty-save').addEventListener('click', async () => decide(await save()));
  $('fm-dirty-dialog').addEventListener('cancel', e => { e.preventDefault(); decide(false); });
  $('fm-editor-close').addEventListener('click', async () => { if (await guard()) release(); });
  dialog.addEventListener('cancel', async e => { e.preventDefault(); if (await guard()) release(); });
  $('fm-editor-minimize').addEventListener('click', () => { dialog.close(); state(); });
  $('fm-resume-editor').addEventListener('click', reveal);
  $('fm-editor-save').addEventListener('click', () => save());
  document.addEventListener('theme-change', e => editor?.setTheme(e.detail === 'light' ? 'ace/theme/tomorrow' : 'ace/theme/tomorrow_night'));
  window.addEventListener('resize', () => editor?.resize());
  return { async open(path) { if (file?.path === path && file.server === serverId()) return reveal(); if (await guard(true)) await load(path); }, guard, dirty, reveal };
}
