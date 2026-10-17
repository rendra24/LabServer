const crypto = require("node:crypto");
const path = require("node:path").posix;

const FILENAME_RE = /^[A-Za-z0-9._-]+$/;
const DIR_RE = /^\/[A-Za-z0-9._/-]*$/;
const NEEDS_PW = /a password is required|a terminal is required|no tty present|askpass/i;
const BAD_PW = /incorrect password|Sorry, try again|no password was provided/i;
const DENIED = /not in the sudoers|not allowed to execute|may not run sudo/i;

const MESSAGES = {
  INVALID_FILENAME: "Nama berkas hanya boleh huruf, angka, titik, garis bawah, dan tanda hubung (tidak diawali titik atau tanda hubung).",
  FILE_EXISTS: "Berkas dengan nama itu sudah ada di server.",
  FILE_NOT_FOUND: "Berkas tidak ditemukan di server.",
  PERMISSION_DENIED: "Akses ditolak. Beri user ini izin tulis ke direktori Nginx atau hak sudo.",
  SYMLINK_CONFLICT: "Sudah ada entri lain dengan nama itu di sites-enabled; tidak ditimpa.",
  SUDO_PASSWORD_REQUIRED: "Perintah ini butuh password sudo.",
  SUDO_BAD_PASSWORD: "Password sudo salah.",
  SUDO_DENIED: "User ini tidak diizinkan menjalankan perintah tersebut lewat sudo.",
  COMMAND_FAILED: "Perintah di server gagal.",
};

class NginxError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || MESSAGES.COMMAND_FAILED);
    this.code = code;
    this.detail = detail;
  }
}

function validateFilename(name) {
  if (typeof name !== "string" || name.length < 1 || name.length > 255 || !FILENAME_RE.test(name) || /^[.-]/.test(name)) {
    throw new NginxError("INVALID_FILENAME");
  }
  return name;
}

/** Kutip tunggal POSIX: hasilnya selalu satu argumen literal untuk sh. */
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function remotePath(dir, name) {
  if (!DIR_RE.test(dir) || dir.split("/").includes("..")) throw new NginxError("COMMAND_FAILED", "direktori tidak valid");
  return `${dir.replace(/\/+$/, "")}/${validateFilename(name)}`;
}

const sftpCall = (sftp, method, ...args) =>
  new Promise((resolve, reject) => sftp[method](...args, (err, res) => (err ? reject(err) : resolve(res))));
const isPerm = (e) => e?.code === 3 || /permission denied/i.test(e?.message || "");
const isMissing = (e) => e?.code === 2 || /no such file/i.test(e?.message || "");

/**
 * Operasi Nginx untuk satu sesi SSH.
 * askSudoPassword: async () => string|null — dipanggil sekali bila sudo butuh password; disimpan hanya di memori sesi.
 */
function createNginxOps(conn, profile, { askSudoPassword } = {}) {
  const { available, enabled, nginxBin, reload: reloadMethod } = profile.nginx;
  let sudoPassword = null;

  async function priv(command, { stdin } = {}) {
    if (profile.username === "root") return conn.execFull(command, { stdin });
    let r = await conn.execFull(`sudo -n ${command}`, { stdin });
    if (r.code !== 0 && NEEDS_PW.test(r.stderr)) {
      const pw = sudoPassword ?? (askSudoPassword ? await askSudoPassword() : null);
      if (!pw) throw new NginxError("SUDO_PASSWORD_REQUIRED");
      // Validasi password sendiri dulu: bila salah, sudo -S akan memakan baris stdin berikutnya sebagai tebakan.
      const v = await conn.execFull("sudo -S -p '' -v", { stdin: `${pw}\n` });
      if (v.code !== 0) {
        sudoPassword = null;
        if (DENIED.test(v.stderr)) throw new NginxError("SUDO_DENIED");
        throw new NginxError("SUDO_BAD_PASSWORD");
      }
      sudoPassword = pw;
      r = await conn.execFull(`sudo -S -p '' ${command}`, { stdin: `${pw}\n${stdin ?? ""}` });
    }
    if (r.code !== 0 && DENIED.test(r.stderr)) throw new NginxError("SUDO_DENIED");
    if (r.code !== 0 && BAD_PW.test(r.stderr)) throw new NginxError("SUDO_BAD_PASSWORD");
    return r;
  }

  async function privOk(command, opts) {
    const r = await priv(command, opts);
    if (r.code !== 0) {
      if (/File exists/i.test(r.stderr)) throw new NginxError("FILE_EXISTS");
      if (/No such file/i.test(r.stderr)) throw new NginxError("FILE_NOT_FOUND");
      throw new NginxError("COMMAND_FAILED", r.stderr.trim());
    }
    return r;
  }

  const sftp = () => conn.sftp();
  const tmpPath = (dir, name) => `${dir}/.${name}.ds-${crypto.randomBytes(6).toString("hex")}`;

  async function lstatOrNull(p) {
    try {
      return await sftpCall(await sftp(), "lstat", p);
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  async function linkTarget(linkPath) {
    const target = await sftpCall(await sftp(), "readlink", linkPath);
    return path.resolve(path.dirname(linkPath), target);
  }

  async function exists(p) {
    return (await lstatOrNull(p)) !== null;
  }

  return {
    async list() {
      const s = await sftp();
      let files;
      let links;
      try {
        files = await sftpCall(s, "readdir", available);
        links = await sftpCall(s, "readdir", enabled);
      } catch (e) {
        if (isPerm(e)) throw new NginxError("PERMISSION_DENIED");
        if (isMissing(e)) throw new NginxError("FILE_NOT_FOUND", "direktori Nginx tidak ada");
        throw e;
      }
      const enabledMap = new Map();
      for (const l of links) {
        if (!FILENAME_RE.test(l.filename) || l.filename.startsWith(".")) continue;
        const full = `${enabled}/${l.filename}`;
        enabledMap.set(l.filename, l.attrs.isSymbolicLink() ? await linkTarget(full) : full);
      }
      return files
        .filter((f) => FILENAME_RE.test(f.filename) && !f.filename.startsWith(".") && f.attrs.isFile())
        .map((f) => {
          const target = enabledMap.get(f.filename);
          const own = `${available}/${f.filename}`;
          return {
            name: f.filename,
            enabled: target === own,
            conflict: target !== undefined && target !== own,
            size: f.attrs.size,
            mtime: f.attrs.mtime,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async read(name) {
      const p = remotePath(available, name);
      try {
        return await sftpCall(await sftp(), "readFile", p, "utf8");
      } catch (e) {
        if (isMissing(e)) throw new NginxError("FILE_NOT_FOUND");
        if (!isPerm(e)) throw e;
      }
      return (await privOk(`cat ${shq(p)}`)).stdout;
    },

    async write(name, content) {
      const p = remotePath(available, name);
      if (!(await exists(p))) throw new NginxError("FILE_NOT_FOUND");
      const tmp = tmpPath(available, name);
      const s = await sftp();
      try {
        await sftpCall(s, "writeFile", tmp, content, { mode: 0o644 });
        await sftpCall(s, "ext_openssh_rename", tmp, p); // rename atomik yang boleh menimpa
        return;
      } catch (e) {
        await sftpCall(s, "unlink", tmp).catch(() => {});
        if (!isPerm(e)) throw e;
      }
      await privOk(
        `sh -c ${shq(`cat > ${shq(tmp)} && chmod 644 ${shq(tmp)} && mv -f ${shq(tmp)} ${shq(p)}`)}`,
        { stdin: content },
      );
    },

    async create(name, content) {
      const p = remotePath(available, name);
      if (await exists(p)) throw new NginxError("FILE_EXISTS");
      const tmp = tmpPath(available, name);
      const s = await sftp();
      try {
        await sftpCall(s, "writeFile", tmp, content, { mode: 0o644 });
        try {
          await sftpCall(s, "ext_openssh_hardlink", tmp, p); // gagal bila tujuan ada: pembuatan eksklusif
        } catch (e) {
          if (!isPerm(e) && (await exists(p))) throw new NginxError("FILE_EXISTS");
          throw e;
        } finally {
          await sftpCall(s, "unlink", tmp).catch(() => {});
        }
        return;
      } catch (e) {
        if (e instanceof NginxError || !isPerm(e)) throw e;
      }
      await privOk(
        `sh -c ${shq(`cat > ${shq(tmp)} && chmod 644 ${shq(tmp)} && { ln ${shq(tmp)} ${shq(p)}; r=$?; rm -f ${shq(tmp)}; exit $r; }`)}`,
        { stdin: content },
      );
    },

    async clone(source, target, content) {
      validateFilename(target);
      return this.create(target, content ?? (await this.read(source)));
    },

    async enable(name) {
      const target = remotePath(available, name);
      const link = remotePath(enabled, name);
      if (!(await exists(target))) throw new NginxError("FILE_NOT_FOUND");
      const st = await lstatOrNull(link);
      if (st) {
        if (st.isSymbolicLink() && (await linkTarget(link)) === target) return;
        throw new NginxError("SYMLINK_CONFLICT");
      }
      try {
        await sftpCall(await sftp(), "symlink", target, link);
        if ((await linkTarget(link)) !== target) throw new Error("symlink terbalik");
        return;
      } catch (e) {
        if (!isPerm(e)) throw e;
      }
      await privOk(`ln -s ${shq(target)} ${shq(link)}`);
    },

    async disable(name) {
      const link = remotePath(enabled, name);
      const st = await lstatOrNull(link);
      if (!st) return;
      if (!st.isSymbolicLink()) throw new NginxError("SYMLINK_CONFLICT");
      try {
        await sftpCall(await sftp(), "unlink", link);
        return;
      } catch (e) {
        if (!isPerm(e)) throw e;
      }
      await privOk(`rm -f ${shq(link)}`);
    },

    /** nginx -t. Resolve {ok, output}; tidak melempar untuk sintaks salah. */
    async test() {
      const r = await priv(`${shq(nginxBin)} -t`);
      return { ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim() };
    },

    /** Reload hanya bila nginx -t lolos SAAT ITU JUGA (bukan mengandalkan hasil tes sebelumnya di UI). */
    async reload() {
      const t = await this.test();
      if (!t.ok) return { ok: false, blocked: true, output: t.output };
      const cmd = {
        systemctl: "/bin/systemctl reload nginx",
        service: "/usr/sbin/service nginx reload",
        "nginx-signal": `${shq(nginxBin)} -s reload`,
      }[reloadMethod];
      const r = await priv(cmd);
      return { ok: r.code === 0, blocked: false, output: `${t.output}\n${r.stdout}${r.stderr}`.trim() };
    },
  };
}

module.exports = { createNginxOps, validateFilename, shq, remotePath, NginxError, MESSAGES };
