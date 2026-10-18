const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function fileSftp(root, { atomic = true } = {}) {
  const target = value => path.join(root, value);
  const callback = (promise, cb) => promise.then(value => cb(null, value), cb);
  const s = {
    realpath: (p, cb) => cb(null, p === '.' ? '/home/deploy' : path.posix.resolve(p)),
    lstat: (p, cb) => callback(fsp.lstat(target(p)), cb),
    readdir: (p, cb) => callback(fsp.readdir(target(p)).then(names => Promise.all(names.map(async filename => ({ filename, attrs: await fsp.lstat(target(path.posix.join(p, filename))) })))), cb),
    mkdir: (p, cb) => callback(fsp.mkdir(target(p)), cb),
    rmdir: (p, cb) => callback(fsp.rmdir(target(p)), cb),
    unlink: (p, cb) => callback(fsp.unlink(target(p)), cb),
    rename: (a, b, cb) => callback(fsp.lstat(target(b)).then(() => { throw Object.assign(new Error('exists'), { code: 'EEXIST' }); }, e => { if (e.code !== 'ENOENT') throw e; return fsp.rename(target(a), target(b)); }), cb),
    readlink: (p, cb) => callback(fsp.readlink(target(p)), cb),
    setstat: (p, attrs, cb) => callback((async () => { if (attrs.mode !== undefined) await fsp.chmod(target(p), attrs.mode); if (attrs.uid !== undefined) await fsp.chown(target(p), attrs.uid, attrs.gid); })(), cb),
    createReadStream: (p, opts) => fs.createReadStream(target(p), opts),
    createWriteStream: (p, opts) => fs.createWriteStream(target(p), opts),
    writeFile: (p, data, opts, cb) => callback(fsp.writeFile(target(p), data, opts), cb),
    ext_openssh_rename: (a, b, cb) => atomic ? callback(fsp.rename(target(a), target(b)), cb) : cb(Object.assign(new Error('unsupported'), { code: 8 })),
  };
  return { sftp: async () => s, client: { on() {} }, target, s };
}
module.exports = { fileSftp };
