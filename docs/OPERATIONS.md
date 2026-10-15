# OPERATIONS — Dashboard Server

Panduan operasional (Task 4.5). Target: Ubuntu/Debian dengan Nginx, PostgreSQL ≥ 12, Python 3.11+, `curl`, `sudo`, `apache2-utils`.

> **Status verifikasi.** Langkah bertanda ✔ sudah dicoba di mesin pengembangan (macOS: Nginx/PHP/Docker nyata, `visudo`, PostgreSQL) dan/atau di container **Ubuntu 24.04** (Nginx 1.24, sudo 1.9 asli: bagian 1, 2, 5). Langkah bertanda ⚠ **belum dijalankan di VPS Linux** (Task 4.4 menunggu akses VPS). Jalankan `deploy/verify-deployment.sh` di VPS untuk memeriksanya, lalu perbarui dokumen ini.

## 1. User sistem dan izin direktori ✔ (container Ubuntu 24.04)

```bash
useradd --system --create-home --shell /usr/sbin/nologin dashboard_app
groupadd -f nginxconf
usermod -aG nginxconf dashboard_app
# Grup nginxconf boleh menulis sites-available & membuat/menghapus link di sites-enabled
chgrp nginxconf /etc/nginx/sites-available /etc/nginx/sites-enabled
chmod 2775 /etc/nginx/sites-available /etc/nginx/sites-enabled
```
Berkas lama di direktori itu tetap milik root dan **tidak** bisa diubah dashboard sampai kepemilikannya disesuaikan:
`chgrp nginxconf /etc/nginx/sites-available/* && chmod g+w /etc/nginx/sites-available/*`.
`nginx.conf` utama harus memuat `include /etc/nginx/sites-enabled/*;`.

## 2. Sudoers (hak minimum) ✔ (container Ubuntu 24.04: `nginx -t` tanpa password, perintah lain ditolak)

```bash
install -m 0440 -o root -g root deploy/dashboard-server.sudoers /etc/sudoers.d/dashboard-server
visudo -cf /etc/sudoers.d/dashboard-server      # harus: parsed OK
deploy/verify-sudoers.sh dashboard_app           # sebagai root
```
Isinya hanya dua perintah persis: `/usr/sbin/nginx -t` dan `/bin/systemctl reload nginx` (sebagai root, tanpa password). Backend memanggilnya sebagai `sudo -n <perintah>`; `curl` **tidak** memakai sudo. Jangan pernah mengganti dengan `ALL`. Edit hanya lewat `visudo -f /etc/sudoers.d/dashboard-server`; berkas yang rusak bisa mengunci sudo untuk semua user. Jika path binary berbeda (`which nginx systemctl`), sesuaikan sudoers **dan** env `NGINX_BIN` / `SYSTEMCTL_BIN`.

## 3. PostgreSQL ✔

```bash
sudo -u postgres createdb dashboard_server        # pemilik: role migrasi
cd /opt/dashboard-server/backend
python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env && chmod 600 .env && chown dashboard_app: .env   # isi DATABASE_URL
.venv/bin/alembic upgrade head          # jalankan dengan role pemilik tabel
.venv/bin/python -m app.seed            # opsional: data contoh
psql -d dashboard_server -v app_role=dashboard_app -v app_password='GANTI' -f deploy/db-roles.sql
```
`DATABASE_URL` aplikasi harus memakai **role runtime** (`dashboard_app`), bukan pemilik. Role itu hanya punya SELECT+INSERT pada `audit_logs` (append-only) — terbukti: DELETE/UPDATE/TRUNCATE ditolak, sementara semua fitur dashboard tetap jalan. Migrasi (`alembic`) memakai `DATABASE_URL` pemilik, jadi jalankan dengan `DATABASE_URL=... alembic upgrade head`.
Backup dan retensi: lihat `docs/DATABASE.md`.

## 4. Menjalankan backend ⚠

```bash
install -m 0644 deploy/dashboard-server.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now dashboard-server
ss -ltn 'sport = :8000'        # harus 127.0.0.1:8000, bukan 0.0.0.0
```
Blokir juga port 8000 dari luar di firewall (`ufw`/`iptables`) sebagai lapis kedua.

## 5. Gateway: Basic Auth + IP whitelist ✔ (Nginx 1.24 Ubuntu) · ⚠ TLS/IP publik di VPS

```bash
apt install apache2-utils                 # untuk htpasswd
htpasswd -c /etc/nginx/.htpasswd admin    # -c hanya untuk akun pertama; tambah akun tanpa -c
chmod 640 /etc/nginx/.htpasswd && chgrp www-data /etc/nginx/.htpasswd
cp deploy/nginx-dashboard.conf /etc/nginx/sites-available/dashboard-server
```
Edit `server_name` dan blok `allow`/`deny` (IP admin, subnet VPN). Aktifkan (`ln -s`), lalu `nginx -t && systemctl reload nginx`.
Perilaku yang sudah teruji (Nginx macOS 1.27 dan Ubuntu 1.24): tanpa kredensial → **401**, kredensial salah → **401**, benar → **200**, IP di luar whitelist → **403** (diperiksa sebelum Basic Auth). Cek template tanpa menyentuh `/etc`: `deploy/check-nginx-template.sh`.
Dashboard **tidak** punya login sendiri: siapa pun yang lolos gateway adalah administrator penuh. Pasang TLS di gateway (mis. Certbot) agar kata sandi Basic Auth tidak lewat jaringan polos. Otomasi SSL bukan bagian MVP.

## 6. Verifikasi menyeluruh ⚠

```bash
read -rs DASH_PASS; export DASH_USER=admin DASH_PASS DASH_DB_ROLE=dashboard_app
deploy/verify-deployment.sh dashboard_app https://dashboard.example.com
```
Memeriksa: user, sudoers (termasuk penolakan perintah lain), izin tulis direktori, symlink menggantung, backend hanya di loopback, `.env` 0600 dan tidak ter-track, 401 di gateway, hak DB `audit_logs`.

## 7. Menguji vhost baru dari dashboard ✔

1. Buat/edit berkas di **Sites → Buat Konfigurasi Baru** lalu Simpan.
2. Aktifkan toggle (membuat symlink).
3. Di editor: **Test Nginx Syntax**; **Reload Nginx** baru aktif setelah tes lolos dan tidak ada perubahan belum tersimpan. Server menolak reload dengan sintaks rusak (400) meski tombol dilewati.
4. **Curl Tester**: isi URL, IP resolusi (mis. `127.0.0.1`), port, lalu jalankan. Untuk domain `.local` **selalu** isi IP resolusi; tanpa itu, lookup DNS/mDNS bisa memakan 5 detik lalu timeout.

Hasil uji lintas runtime di mesin dev (lihat `backend/tests/integration/`): vhost `fastcgi_pass` ke PHP 8.3-FPM dan 7.4-FPM menjawab dengan `X-PHP-Version` masing-masing; `proxy_pass` ke container Docker menjawab 200; konfigurasi rusak → reload ditolak, daemon tetap melayani (0 request gagal selama skenario), kegagalan tercatat di audit log.
Jalankan ulang: `INTEGRATION_DOCKER_IMAGE=<image dengan sh+nc> backend/.venv/bin/pytest backend/tests/integration` (php-fpm dan nginx harus terpasang; tanpa env itu, tes Docker dilewati).

## 8. Batasan Curl Tester (keamanan)

Port dibatasi `CURL_ALLOWED_PORTS` (default `80,443,8080,8443,8000`); alamat link-local (`169.254.0.0/16`, `fe80::/10`, termasuk metadata cloud) ditolak; redirect tidak diikuti; timeout 5 detik. Ubah port lewat env bila perlu, lalu restart service.

## 9. Troubleshooting

| Gejala | Penyebab umum | Perbaikan |
|---|---|---|
| Simpan/Buat gagal "Terjadi kesalahan pada server" dan log `PermissionError` | `dashboard_app` bukan anggota `nginxconf`, direktori tidak `g+w`, atau berkas dimiliki root | Langkah 1; `sudo -u dashboard_app test -w /etc/nginx/sites-available && echo ok`. Perubahan grup butuh restart service |
| Toggle: "Sudah ada entri lain dengan nama itu di sites-enabled" | Ada berkas biasa / symlink ke target lain dengan nama sama | Periksa `ls -l /etc/nginx/sites-enabled`; hapus/rapikan manual (dashboard sengaja tidak menimpa) |
| Test Nginx Syntax: "tidak dapat dijalankan atau melewati batas waktu" | Aturan sudoers belum terpasang/salah path, atau `requiretty` | `deploy/verify-sudoers.sh`; `sudo -n -u dashboard_app sudo -n /usr/sbin/nginx -t`; periksa `which nginx` |
| `nginx -t` gagal padahal vhost baru benar | Konfigurasi lain di `sites-enabled` rusak, atau **symlink menggantung** (berkas sumber dihapus manual) | Baca stderr di panel diagnostik; `find /etc/nginx/sites-enabled -xtype l` lalu hapus |
| Situs nonaktif "lolos" tes padahal isinya salah | `nginx -t` hanya membaca `sites-enabled` | Aktifkan dulu, lalu tes |
| Reload ditolak 400 `INVALID_SYNTAX` | Sintaks rusak (disengaja oleh desain) | Perbaiki berkas; lihat `details`/audit log |
| Reload 500 `RELOAD_FAILED` | `systemctl reload nginx` gagal (service mati, sudoers) | `systemctl status nginx`; lihat output di Audit Logs |
| Baris situs berlabel "File tidak ada" | Baris seed/DB tanpa berkas di disk (atau berkas dihapus manual) | Buat berkas dengan nama itu (baris diambil alih) atau hapus baris lewat tombol Hapus |
| Gateway 403 | IP klien tidak ada di `allow` | Tambahkan IP/subnet, `nginx -t && systemctl reload nginx` |
| Gateway 502 | Backend mati/bukan di 127.0.0.1:8000 | `systemctl status dashboard-server`; `journalctl -u dashboard-server` |
| `/api/health` 503 | PostgreSQL mati atau `DATABASE_URL` salah | `systemctl status postgresql`; cek `.env` |
| Editor menampilkan "Editor gagal dimuat" | Server tidak bisa menjangkau CDN jsdelivr (Ace) | Beri akses internet ke browser klien, atau vendor aset Ace secara lokal |
| Curl Tester: "Port N tidak diizinkan" | Di luar allowlist | Ubah `CURL_ALLOWED_PORTS` (lihat bagian 8) |
| Curl Tester HTTPS: SSL "Gagal" / kode 60 | Sertifikat tidak tepercaya atau tidak cocok dengan domain | Perilaku disengaja (tidak ada `-k`); pasang sertifikat valid |
| Audit Logs kosong setelah migrasi/restore | Retensi 90 hari atau restore dari backup lama | Lihat DATABASE.md |

## 10. Pemeliharaan

- **Memperbarui aplikasi:** `git pull`, `pip install -r requirements.txt`, `alembic upgrade head` (role pemilik), `systemctl restart dashboard-server`. Jangan mengubah berkas migrasi yang sudah dipakai; buat revisi baru.
- **Mengubah akun gateway:** `htpasswd /etc/nginx/.htpasswd <user>` (tanpa `-c`), tidak perlu reload.
- **Mengubah path/izin sudo:** edit dengan `visudo -f`, lalu jalankan `deploy/verify-sudoers.sh`.
- **Membangun ulang CSS** setelah mengubah kelas Tailwind: lihat README.
