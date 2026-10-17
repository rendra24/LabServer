# PRD v3 — Dashboard Server Desktop (Electron)

Tanggal: 2026-10-17 · Status: draf, menunggu konfirmasi · Menggantikan arah produk PRD v2 untuk **aplikasi desktop**. Web dashboard (PRD v2, `backend/` + `frontend/`) tetap ada di repo dan tidak diubah.

## Ringkasan
Aplikasi desktop (macOS & Windows, Electron) untuk mengelola konfigurasi virtual host Nginx di server remote melalui **SSH**, tanpa memasang apa pun di server (agentless). Autentikasi SSH memakai **SSH key** (dengan/atau tanpa passphrase) atau **username + password**.

## Tujuan Tahap 1 (desktop)
1. Menyimpan daftar server (host, port, user, metode auth, path Nginx) dan terhubung lewat SSH.
2. Melihat daftar berkas di `sites-available` beserta status aktif (`sites-enabled`).
3. **Edit** berkas konfigurasi (editor dengan highlight Nginx) dan menyimpannya ke server.
4. **Tambah** berkas konfigurasi baru.
5. **Clone** berkas yang ada menjadi berkas baru, dengan bantuan mengganti domain di isinya.
6. Aktif/nonaktif vhost (symlink), **`nginx -t`**, dan **reload** yang hanya boleh jalan bila `nginx -t` lolos.

## Non-Goals (Tahap 1 desktop)
- Curl Tester, Audit Log, PostgreSQL, Basic Auth gateway (fitur web PRD v2) — tidak dibawa.
- Hapus berkas konfigurasi (tidak diminta; bisa diusulkan nanti).
- Linux build, auto-update, code signing/notarisasi (catat sebagai risiko distribusi).
- Mengelola selain Nginx; terminal SSH interaktif; transfer berkas umum.

## Arsitektur
```
Renderer (HTML + Tailwind + Ace, tanpa akses Node)
   │  window.api.*  (preload, contextBridge, IPC sempit)
Main process (Node)
   ├─ store: profil server (JSON di userData), known_hosts aplikasi, secret via safeStorage (opsional)
   └─ ssh2: sesi SSH per server
        ├─ SFTP: baca/tulis/rename/symlink bila user punya izin tulis
        └─ exec (perintah tetap, argumen di-quote): sudo -n /usr/sbin/nginx -t, reload,
           dan fallback tulis via `sudo tee`/`sudo mv`/`sudo ln` bila SFTP ditolak izin
```

## Keputusan produk & keamanan
- **Agentless**: tidak ada daemon/DB di server.
- **Host key**: TOFU — saat pertama connect tampilkan fingerprint SHA256 dan minta persetujuan; fingerprint disimpan; jika berubah, koneksi **ditolak** dengan peringatan.
- **Sudo**: coba `sudo -n`; bila butuh password, aplikasi meminta password sudo sekali per sesi, hanya di memori, dikirim lewat stdin (`sudo -S`), tidak pernah ke log/disk.
- **Kredensial SSH**: password/passphrase tidak disimpan kecuali pengguna mencentang "Ingat" → dienkripsi dengan Electron `safeStorage` (Keychain macOS / DPAPI Windows). Private key tidak disalin; aplikasi menyimpan path-nya saja.
- **Renderer terisolasi**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP ketat, aset lokal (Ace di-bundle, tanpa CDN), navigasi/window baru diblokir.
- **Validasi di main process**: nama berkas `^[a-zA-Z0-9._-]+$`, tidak diawali titik, ≤255; path selalu `<dir>/<nama>` dan direktori dari profil divalidasi absolut. Perintah remote hanya dari daftar tetap; argumen dinamis (nama berkas) di-quote shell dengan aman dan sudah lolos regex.
- **Tulis atomik**: tulis ke berkas sementara di direktori yang sama lalu rename.
- **Reload aman**: main process selalu menjalankan `nginx -t` tepat sebelum reload; gagal → reload ditolak.

## Tech Stack
| Komponen | Teknologi |
|---|---|
| Desktop shell | Electron (versi stabil terbaru saat implementasi) |
| SSH/SFTP | `ssh2` (Node, murni JS) |
| UI | HTML5, Tailwind CSS (CLI, dibangun), Ace Editor (paket npm `ace-builds`, di-bundle lokal) |
| Packaging | `electron-builder` — macOS `.dmg`, Windows `.exe` (NSIS) |
| Tes | `node:test` (unit), server SSH di container Docker (integrasi) |

## Data lokal (per pengguna)
- `servers.json`: `{id, name, host, port, username, auth: "password"|"key", keyPath?, nginx: {available, enabled, testCmd, reloadCmd}}`
- `known_hosts.json`: `{ "host:port": "SHA256:..." }`
- Secret (opsional): disimpan terenkripsi `safeStorage`.

Default path Nginx: `/etc/nginx/sites-available`, `/etc/nginx/sites-enabled`, test `nginx -t` (`/usr/sbin/nginx -t`), reload `systemctl reload nginx` (`/bin/systemctl reload nginx`), dapat diubah per server (mis. `service nginx reload`).

## Alur pengguna
1. Tambah server → isi host/user/auth → **Tes koneksi** (verifikasi fingerprint).
2. Pilih server → daftar vhost (nama, status aktif).
3. Edit / Tambah / Clone → simpan → aktifkan bila perlu → **Test** → **Reload**.

## Kriteria penerimaan
- Connect berhasil dengan (a) password, (b) key tanpa passphrase, (c) key dengan passphrase; fingerprint berubah → ditolak.
- Edit, tambah, clone tersimpan di server dengan isi persis; nama berkas ilegal ditolak sebelum menyentuh server.
- Bekerja baik dengan user yang punya izin tulis (grup) maupun yang perlu sudo (NOPASSWD atau password).
- Reload ditolak bila `nginx -t` gagal, di level main process.
- Installer macOS (.dmg) dan Windows (.exe) dihasilkan dan aplikasi berjalan.
