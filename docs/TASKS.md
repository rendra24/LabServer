# TASKS.md — Dashboard Server

Dokumen ini memuat rencana kerja bertahap untuk pengembangan MVP Dashboard Server. Setiap sprint dirancang untuk diselesaikan secara berurutan dengan task yang terukur.

---

## Sprint 1: Setup Proyek, Keamanan Gateway, dan Skema Basis Data

**Tujuan:** Menyiapkan struktur proyek backend, gateway web server Nginx dengan proteksi ganda (Basic Auth & IP Whitelist), konfigurasi hak akses `visudo`, dan skema database PostgreSQL.

- [x] **1.1** Inisialisasi struktur repositori Python (FastAPI/Flask), modul virtual environment, file dependency (`requirements.txt`), serta pembacaan konfigurasi environment variable (`.env`).
- [x] **1.2** Buat migrasi skema database PostgreSQL untuk tabel `sites`, `test_profiles`, dan `audit_logs` sesuai kamus data.
  - *Dependensi:* Task 1.1
- [x] **1.3** Eksekusi migrasi dan pasang data awalan (*seeding*) pada tabel `sites`, `test_profiles`, dan `audit_logs`.
  - *Dependensi:* Task 1.2
- [x] **1.4** Siapkan template konfigurasi Nginx reverse proxy untuk membungkus dashboard (`:8000`) dengan proteksi `auth_basic` (HTTP Basic Auth) dan blok `allow`/`deny` (IP Whitelist).
  - *Dependensi:* Task 1.1
- [x] **1.5** Buat konfigurasi izin sudoers (`/etc/sudoers.d/dashboard-server`) untuk eksekusi tanpa password: `/usr/sbin/nginx -t` dan `/bin/systemctl reload nginx`.
- [x] **1.6** Bangun koneksi database pool dan implementasikan endpoint *health check* (`GET /api/health`) untuk memvalidasi kesiapan backend dan koneksi database PostgreSQL.
  - *Dependensi:* Task 1.2

**DoD:** Aplikasi backend berjalan di port `:8000`, terproteksi Nginx reverse proxy (IP Whitelist & Basic Auth), tabel PostgreSQL terinisialisasi dengan data seed, dan eksekusi sudo untuk perintah Nginx dapat dijalankan tanpa prompt password.

---

## Sprint 2: Manajemen Berkas Konfigurasi & Symlink Nginx

**Tujuan:** Membangun antarmuka editor dan backend I/O untuk membaca, menulis, membuat berkas di `/etc/nginx/sites-available/`, serta mengelola symlink di `/etc/nginx/sites-enabled/`.

- [x] **2.1** Buat modul backend I/O untuk listing file, membaca isi file, membuat file baru, dan menghapus file di direktori `/etc/nginx/sites-available/`.
  - *Dependensi:* Task 1.1
- [x] **2.2** Buat modul backend untuk deteksi, pembuatan, dan penghapusan *symbolic link* di `/etc/nginx/sites-enabled/` dengan sinkronisasi status ke tabel `sites`.
  - *Dependensi:* Task 2.1
- [x] **2.3** Bangun REST API CRUD untuk manajemen situs (daftar situs, detail konfigurasi, buat/edit berkas, hapus berkas, dan toggle status symlink).
  - *Dependensi:* Task 2.1, Task 2.2
- [x] **2.4** Implementasikan pencatatan otomatis ke tabel `audit_logs` setiap kali terjadi pembuatan, modifikasi berkas, atau perubahan status symlink.
  - *Dependensi:* Task 2.3
- [x] **2.5** Bangun tampilan antarmuka web daftar situs menggunakan Tailwind CSS (menampilkan nama berkas, domain utama, dan status toggle aktif/nonaktif).
  - *Dependensi:* Task 2.3
- [x] **2.6** Integrasikan raw text code editor (Monaco Editor / Ace Editor) dengan syntax highlighting Nginx pada halaman editor konfigurasi.
  - *Dependensi:* Task 2.5
- [x] **2.7** Hubungkan aksi simpan editor ke endpoint update konfigurasi backend dan tampilkan feedback visual (status tersimpan/gagal).
  - *Dependensi:* Task 2.4, Task 2.6

**DoD:** Pengguna dapat melihat daftar situs, membuat berkas baru, menyunting konfigurasi via Monaco/Ace Editor, mengaktifkan/menonaktifkan symlink melalui toggle switch, dan seluruh perubahan berkas tercatat di `audit_logs`.

---

## Sprint 3: Validasi Sintaks, Safe Reload, dan Curl Tester

**Tujuan:** Mengintegrasikan eksekusi verifikasi sintaks Nginx, reload daemon aman berbasis status validasi, serta utilitas pengujian konektivitas via `curl` CLI.

- [x] **3.1** Buat modul wrapper `subprocess` untuk menjalankan perintah `sudo nginx -t`, menangkap output `stdout`, `stderr`, dan return code secara aman.
  - *Dependensi:* Task 1.5
- [x] **3.2** Bangun endpoint API dan panel antarmuka konsol log interaktif untuk memicu "Test Nginx Config" serta menampilkan pesan diagnostik sintaks.
  - *Dependensi:* Task 3.1
- [x] **3.3** Implementasikan endpoint dan tombol antarmuka "Reload Nginx" (`sudo systemctl reload nginx`) yang secara otomatis terkunci (*disabled*) jika hasil `nginx -t` gagal atau belum dijalankan.
  - *Dependensi:* Task 3.1, Task 3.2
- [x] **3.4** Buat modul backend pemanggil CLI `curl` yang mendukung injeksi flag `--resolve <host>:<port>:<ip>` serta kustomisasi header `Host`.
  - *Dependensi:* Task 1.1
- [x] **3.5** Bangun endpoint API untuk menjalankan pengujian curl dan menyimpan konfigurasi target ke tabel `test_profiles`.
  - *Dependensi:* Task 3.4
- [x] **3.6** Bangun form antarmuka Curl Connectivity Tester (input domain target, target IP resolusi, port, protokol, dan custom headers).
  - *Dependensi:* Task 3.5
- [x] **3.7** Integrasikan penampil hasil curl tester (HTTP Status Code, TTFB/latensi, response headers, status SSL) dan simpan hasil eksekusi ke `audit_logs`.
  - *Dependensi:* Task 3.6
- [x] **3.8** *(ditambahkan 2026-10-16, atas permintaan user; lihat DECISIONS.md)* Bangun endpoint `GET /api/v1/audit-logs` (filter `action_type`, `site_id`, `is_success`; paginasi `limit`/`offset`; terbaru dulu; read-only).
  - *Dependensi:* Task 2.4, Task 3.7
- [x] **3.9** *(ditambahkan 2026-10-16)* Bangun halaman `/audit-logs` (toolbar filter, tabel riwayat, modal output lengkap, state loading/error/kosong) dan tambahkan menu Curl Tester & Audit Logs di navigasi.
  - *Dependensi:* Task 3.8

**DoD:** Pengujian `sudo nginx -t` menampilkan output riil di UI konsol log; tombol reload Nginx terkunci jika sintaks galat dan hanya aktif jika sintaks sukses; pengujian curl dengan parameter `--resolve` menampilkan status kode, latensi, dan response header dengan benar; halaman `/audit-logs` menampilkan riwayat aksi (termasuk NGINX_TEST, NGINX_RELOAD, CURL_TEST) beserta output lengkapnya.

---

## Sprint 4: Pengujian Terpadu & Validasi Lintas Lingkungan

**Tujuan:** Memvalidasi kestabilan aplikasi bersama runtime lokal (PHP 8.3, PHP 7.4, Docker), skenario penanganan kegagalan konfigurasi, kesiapan deployment VPS Linux, serta dokumentasi sistem.

- [x] **4.1** Buat automated test/self-check script untuk memvalidasi sanitasi parameter CLI pada modul subprocess (mencegah command injection pada pemanggilan Nginx dan Curl).
  - *Dependensi:* Task 3.1, Task 3.4
- [x] **4.2** Uji integrasi konfigurasi virtual host terhadap runtime lokal: verifikasi reverse proxy ke port container Docker dan FastCGI pass ke PHP 8.3-FPM serta PHP 7.4-FPM menggunakan Curl Tester (`--resolve`).
  - *Dependensi:* Task 3.7
- [x] **4.3** Simulasikan skenario error sintaks Nginx (memasukkan berkas konfigurasi rusak): verifikasi bahwa Nginx daemon tidak mengalami downtime, tombol reload terkunci, dan error tercatat di audit log.
  - *Dependensi:* Task 3.3
- [ ] **4.4** Uji coba deployment menyeluruh pada server VPS Ubuntu/Debian target (validasi hak akses file, user permissions, visudo, dan reverse proxy Nginx).
  - *Status 2026-10-16:* artefak siap (`deploy/verify-deployment.sh`, `deploy/dashboard-server.service`, `deploy/db-roles.sql`); **eksekusi di VPS belum dilakukan** (tidak ada akses VPS di sesi ini).
  - *Dependensi:* Task 4.2, Task 4.3
- [ ] **4.5** Tulis panduan operasional teknis (prosedur setup sudoers, konfigurasi IP whitelist, pembuatan akun basic auth `htpasswd`, dan troubleshooting izin direktori).
  - *Status 2026-10-16:* draf `docs/OPERATIONS.md` selesai; langkah bertanda ⚠ menunggu verifikasi 4.4.
  - *Dependensi:* Task 4.4

**DoD:** Seluruh fitur teruji pada lingkungan lokal berdampingan dengan PHP/Docker dan VPS Linux; penanganan error sintaks terbukti aman tanpa downtime daemon; dokumentasi operasional dan izin sistem lengkap.

---

## Backlog (pasca-MVP)

Hal-hal berikut sengaja ditunda dari cakupan Tahap 1 sesuai batasan PRD:

- **Otomasi SSL/TLS:** Integrasi Certbot / Let's Encrypt untuk penerbitan dan pembaruan sertifikat SSL otomatis.
- **Visual VHost Builder:** Form GUI interaktif (wizard) untuk membuat blok Nginx tanpa mengedit raw text configuration.
- **Git Versioning:** Integrasi Git commit & push otomatis untuk setiap riwayat perubahan berkas pada `/etc/nginx/sites-available/`.
- **Role-Based Access Control (RBAC):** Manajemen hak akses multi-user di dalam aplikasi backend (selain proteksi HTTP Basic Auth level Nginx).
- **Log Streaming Real-time:** Fitur live streaming akses log (`access.log`) dan error log (`error.log`) Nginx via WebSocket.
- **Dukungan Web Server Lain:** Dukungan manajemen web server Apache, Caddy, atau Traefik.

---

## Asumsi

1. Dashboard dijalankan di bawah akun Linux khusus (misal: `dashboard-runner`) yang tergabung dalam grup sistem dengan hak baca/tulis terhadap `/etc/nginx/sites-available` dan `/etc/nginx/sites-enabled`.
2. Utilitas `curl` yang terpasang pada host server minimal versi 7.21.3 untuk mendukung opsi `--resolve`.
3. Basis data PostgreSQL telah terpasang dan dapat diakses dari host backend melalui socket lokal atau TCP port 5432.
4. Nginx gateway dashboard menggunakan berkas htpasswd standar (`/etc/nginx/.htpasswd`) untuk mekanisme HTTP Basic Auth.
5. Konfigurasi `nginx.conf` utama server sudah memuat direktif `include /etc/nginx/sites-enabled/*;`.