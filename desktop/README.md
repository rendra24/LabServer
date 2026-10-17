# Dashboard Server — Desktop (Electron)

Kelola vhost Nginx di server remote lewat SSH (agentless). Spesifikasi: [`../docs/desktop/PRD.md`](../docs/desktop/PRD.md), tugas: [`../docs/desktop/TASKS.md`](../docs/desktop/TASKS.md).

```bash
npm install          # Node >= 20
npm start            # jalankan aplikasi
npm test             # unit + tes SSH dengan server in-process
npm run lint
npm run css          # bangun ulang Tailwind (butuh tailwindcss CLI)
```

## Mencoba tanpa VPS
```bash
node scripts/dev-ssh-server.js   # SSH palsu di 127.0.0.1:2222, user deploy, password pw-123
```
Key uji dibuat di `scripts/.dev-key` (passphrase `frasa-dev`) dan `scripts/.dev-key-plain` (tanpa passphrase). Server ini hanya untuk menguji koneksi/autentikasi; belum ada Nginx di baliknya.

Uji terhadap OpenSSH + Nginx sungguhan (container Docker Ubuntu dengan 3 model izin: `writer` grup-writable, `sudoer` NOPASSWD, `sudopw` sudo berpassword):
```bash
test/integration/setup-container.sh            # butuh Docker; mengunduh paket apt di container
SSHD_PORT=2223 NGINX_CONTAINER=dssshd npm test
```

Data aplikasi (profil server, fingerprint, secret terenkripsi) ada di folder userData Electron, mis. `~/Library/Application Support/Dashboard Server/`.

## Instalasi (pengguna)
Unduh installer dari hasil build (`dist/`): macOS `Dashboard Server-<versi>-arm64.dmg` (Apple Silicon) atau `…-<versi>.dmg` (Intel), Windows `Dashboard Server Setup <versi>.exe`.

Aplikasi **belum ditandatangani** (tanpa sertifikat developer), jadi OS akan memperingatkan:
- **macOS**: buka `.dmg`, seret ke Applications. Saat pertama buka: klik kanan → Open → Open. Jika diblokir: `xattr -dr com.apple.quarantine "/Applications/Dashboard Server.app"`.
- **Windows**: SmartScreen "Windows protected your PC" → More info → Run anyway.

## Kebutuhan di server
Aplikasi hanya butuh SSH (tidak memasang apa pun di server). User SSH perlu salah satu:
1. **Izin tulis ke direktori Nginx** (disarankan, tulis langsung lewat SFTP): anggota grup yang memiliki `sites-available`/`sites-enabled` (lihat `docs/OPERATIONS.md` bagian 1), ditambah sudo untuk `nginx -t` dan reload saja:
   ```
   deploy ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /bin/systemctl reload nginx
   ```
2. **sudo penuh** (NOPASSWD atau berpassword): berkas ditulis lewat `sudo`; password sudo diminta sekali per sesi dan hanya disimpan di memori.
3. Login sebagai `root` (tidak disarankan).

Cara reload dipilih per server (Lanjutan → Cara reload): `systemctl`, `service`, atau `nginx -s reload`. Path `sites-available`/`sites-enabled`/binary nginx juga bisa diubah per server.

## Keamanan singkat
- Fingerprint host key diminta persetujuan saat pertama connect; jika berubah, koneksi **diblokir** dan kredensial tidak dikirim.
- Password/passphrase hanya disimpan bila "Ingat" dicentang, terenkripsi Keychain (macOS) / DPAPI (Windows). Private key tidak disalin; hanya path-nya yang disimpan.
- Renderer disandbox tanpa akses Node; semua operasi lewat IPC sempit dengan validasi di proses utama; tanpa CDN.
- Reload selalu menjalankan `nginx -t` ulang di proses utama; sintaks rusak = reload ditolak.

## Build installer
```bash
npm run dist:mac     # .dmg arm64 + x64 (dijalankan di macOS)
npm run dist:win     # .exe NSIS x64 (bisa cross-build dari macOS/Linux)
```
CI: `.github/workflows/desktop.yml` membangun di macOS dan Windows serta menjalankan smoke test (belum pernah dijalankan: repo belum di GitHub).

## Batasan
- Belum ada code signing/notarisasi, auto-update, ikon aplikasi khusus (memakai ikon Electron), build Linux.
- Hapus berkas konfigurasi belum tersedia.
- Installer Windows dibangun lewat cross-build dari macOS dan **belum pernah dijalankan di Windows**.
