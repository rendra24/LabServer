// Filesystem-backed SFTP protocol fixture; paths are rooted in the test directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { STATUS_CODE: S, flagsToString } = require('ssh2').utils.sftp;
function serveSftp(s, root) {
  const handles = new Map();
  const target = p => path.join(root, path.posix.resolve('/', p));
  const attrs = st => ({ mode: st.mode, uid: st.uid, gid: st.gid, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) });
  const error = (id, e) => s.status(id, e.code === 'ENOENT' ? S.NO_SUCH_FILE : ['EACCES','EPERM'].includes(e.code) ? S.PERMISSION_DENIED : S.FAILURE);
  const on = (event, fn) => s.on(event, (id, ...args) => Promise.resolve().then(() => fn(id, ...args)).catch(e => error(id, e)));
  function add(data) { const h = crypto.randomBytes(12); handles.set(h.toString('hex'), data); return h; }
  function get(h) { const value = handles.get(h.toString('hex')); if (!value) throw new Error('bad handle'); return value; }
  on('REALPATH', async (id,p) => s.name(id, [{ filename: p === '.' ? '/home/deploy' : path.posix.resolve('/',p), longname:'', attrs:{} }]));
  for (const event of ['STAT','LSTAT']) on(event, async (id,p) => s.attrs(id,attrs(await fs[event==='STAT'?'stat':'lstat'](target(p)))));
  on('FSTAT', async (id,h) => s.attrs(id, attrs(await get(h).fd.stat())));
  on('OPEN', async (id,p,flags,a) => s.handle(id,add({ fd:await fs.open(target(p), flagsToString(flags), a.mode ?? 0o666) })));
  on('CLOSE', async (id,h) => { const value=get(h); if(value.fd)await value.fd.close(); handles.delete(h.toString('hex')); s.status(id,S.OK); });
  on('READ', async (id,h,offset,length) => { const buffer=Buffer.alloc(Math.min(length,262144)); const {bytesRead}=await get(h).fd.read(buffer,0,buffer.length,offset); if(!bytesRead)s.status(id,S.EOF);else s.data(id,buffer.subarray(0,bytesRead)); });
  on('WRITE', async (id,h,offset,data) => { let written=0;while(written<data.length){const r=await get(h).fd.write(data,written,data.length-written,offset+written);written+=r.bytesWritten;}s.status(id,S.OK); });
  on('OPENDIR', async (id,p) => s.handle(id,add({ path:p, names:await fs.readdir(target(p)), sent:false })));
  on('READDIR', async (id,h) => {const d=get(h);if(d.sent||!d.names.length)return s.status(id,S.EOF);d.sent=true;s.name(id,await Promise.all(d.names.map(async filename=>({filename,longname:filename,attrs:attrs(await fs.lstat(target(path.posix.join(d.path,filename))))}))));});
  on('MKDIR', async (id,p,a) => {await fs.mkdir(target(p),{mode:a.mode});s.status(id,S.OK);});
  on('RMDIR', async (id,p) => {await fs.rmdir(target(p));s.status(id,S.OK);});
  on('REMOVE', async (id,p) => {await fs.unlink(target(p));s.status(id,S.OK);});
  on('RENAME', async (id,a,b) => {try{await fs.lstat(target(b));throw Object.assign(new Error('exists'),{code:'EEXIST'});}catch(e){if(e.code!=='ENOENT')throw e;}await fs.rename(target(a),target(b));s.status(id,S.OK);});
  on('SETSTAT', async (id,p,a) => {if(a.mode!==undefined)await fs.chmod(target(p),a.mode);if(a.uid!==undefined)await fs.chown(target(p),a.uid,a.gid);s.status(id,S.OK);});
  on('FSETSTAT', async (id,h,a) => {const fd=get(h).fd;if(a.mode!==undefined)await fd.chmod(a.mode);if(a.uid!==undefined)await fd.chown(a.uid,a.gid);s.status(id,S.OK);});
  on('READLINK', async (id,p) => s.name(id,[{filename:await fs.readlink(target(p)),longname:'',attrs:{}}]));
  on('EXTENDED', async (id,name,data) => {
    if(name!=='posix-rename@openssh.com')return s.status(id,S.OP_UNSUPPORTED);
    let offset=0;const string=()=>{const size=data.readUInt32BE(offset);offset+=4;const value=data.subarray(offset,offset+size).toString();offset+=size;return value;};
    const a=string(),b=string();await fs.rename(target(a),target(b));s.status(id,S.OK);
  });
  s.on('close',()=>{for(const h of handles.values())h.fd?.close().catch(()=>{});handles.clear();});
}
// ssh2's fixture server advertises no extensions; enable only the extension implemented above.
function enableFixtureExtensions(conn) {
  const original = conn.sftp.bind(conn);
  conn.sftp = async () => { const s=await original();s._extensions['posix-rename@openssh.com']='1';return s; };
  return conn;
}
module.exports = { serveSftp, enableFixtureExtensions };
