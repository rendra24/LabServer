# PERMISSIONS — Dashboard Server

Dokumen ini mendefinisikan kontrol akses, aturan penegakan izin di sisi server (*server-side enforcement*), pembatasan cakupan data (*data scoping*), dan mitigasi keamanan untuk aplikasi Dashboard Server.

---

## Matriks Kapabilitas dan Peran

Sistem menerapkan model peran berbasis tier otentikasi lapis ganda: **Administrator** (kredensial Basic Auth penuh dengan akses tulis), **Auditor / Viewer** (kredensial Basic Auth terbatas baca), dan **System Daemon** (identitas proses sistem Python di OS host). Akses tanpa otentikasi atau di luar *IP Whitelist* ditolak secara mutlak pada layer gateway.

| Fitur / Kapabilitas PRD | Administrator | Auditor / Viewer | System Daemon (`dashboard-user`) | Tamu / IP Luar Whitelist |
| :--- | :---: | :---: | :---: | :---: |
| **Bypass IP Whitelist & Gateway** | ❌ | ❌ | N/A (Localhost) | ❌ |
| **Login HTTP Basic Auth** | ✅ | ✅ | ❌ | ❌ |
| **Lihat Daftar & Status Situs (`sites-available`, `sites-enabled`)** | ✅ | ✅ | ✅ (Read OS) | ❌ |
| **Baca Berkas Konfigurasi Vhost (Monaco/Ace)** | ✅ | ✅ | ✅ (Read OS) | ❌ |
| **Buat / Edit Berkas Konfigurasi Vhost** | ✅ | ❌ | ✅ (Write OS) | ❌ |
| **Hapus Berkas Konfigurasi Vhost** | ✅ | ❌ | ✅ (Write OS) | ❌ |
| **Toggle Symlink Aktivasi (`sites-enabled`)** | ✅ | ❌ | ✅ (Symlink OS) | ❌ |
| **Jalankan Validasi Sintaks (`nginx -t`)** | ✅ | ✅ | ✅ (via Sudo) | ❌ |
| **Jalankan Nginx Safe Reload (`systemctl reload nginx`)** | ✅ | ❌ | ✅ (via Sudo) | ❌ |
| **Jalankan Curl Connectivity Test (`--resolve`, header)** | ✅ | ✅ | ✅ (CLI Exec) | ❌ |
| **Simpan / Ubah Profil Curl (`test_profiles`)** | ✅ | ❌ | ✅ (DB CRUD) | ❌ |
| **Baca Riwayat Aktivitas (`audit_logs`)** | ✅ | ✅ | ✅ (DB Read) | ❌ |
| **Tulis Entri Audit Baru (`audit_logs`)** | ❌ (Sistem) | ❌ (Sistem) | ✅ (DB Append Only) | ❌ |

---

## Aturan Penegakan di Sisi Server (Server-Side Enforcement)

Validasi izin dan proteksi tidak boleh hanya bergantung pada *disabling* tombol atau elemen di antarmuka (UI). Server wajib menjalankan validasi independen pada setiap permintaan API.

### 1. Gateway & Network Layer Enforcement (Nginx Reverse Proxy)
- **IP Whitelisting**: Nginx gateway memblokir koneksi di luar IP yang diizinkan sebelum *handshake* HTTP Basic Auth diproses.
  ```nginx
  # Cuplikan konfigurasi proteksi Nginx Gateway
  location / {
      allow 192.168.1.0/24;  # Contoh subnet lokal tepercaya
      allow 10.8.0.0/24;      # Contoh VPN internal
      deny all;

      auth_basic "Dashboard Server Internal Access";
      auth_basic_user_file /etc/nginx/.htpasswd;

      proxy_pass http://127.0.0.1:8000;
  }
  ```
- Header `X-Remote-User` diteruskan oleh Nginx ke backend Python setelah lolos otentikasi Basic Auth.

### 2. Path Traversal & File System Boundary Enforcement
- Backend Python menolak seluruh operasi I/O yang mencoba mengakses di luar path absolut `/etc/nginx/sites-available/` dan `/etc/nginx/sites-enabled/`.
- **Karakter Terlarang**: Parameter `filename` wajib divalidasi dengan regex ketat: `^[a-zA-Z0-9._-]+$`. Penggunaan karakter `/`, `\`, `..`, atau null byte (`\0`) langsung menghasilkan HTTP 400 Bad Request.
- **Resolusi Path Aman**: Backend wajib memverifikasi path kanonikal (`os.path.realpath`) untuk memastikan symlink atau manipulasi path tidak mengarah ke direktori sistem sensitif (seperti `/etc/shadow`, `/root`, atau `/etc/nginx/nginx.conf` utama).

### 3. Conditional State Machine untuk Nginx Reload
- Tombol atau endpoint `POST /api/nginx/reload` tidak boleh dieksekusi secara terisolasi.
- **Enforcement Alur**:
  1. Backend secara otomatis mengeksekusi `sudo /usr/sbin/nginx -t` sesaat sebelum memanggil reload.
  2. Jika kode keluar (*exit code*) bukan `0`, proses dihentikan seketika, status HTTP 422 Unprocessable Entity dikembalikan beserta log error stderr, dan reload dibatalkan.
  3. Reload (`sudo /bin/systemctl reload nginx`) hanya dieksekusi jika dan hanya jika validasi pada langkah 1 bernilai sukses.

### 4. Privilege Isolation (Linux Sudoers Least Privilege)
- User sistem yang menjalankan backend Python (misal: `dashboard-user`) **tidak boleh** memiliki akses sudo penuh (`ALL=(ALL) NOPASSWD: ALL`).
- File `/etc/sudoers.d/dashboard-server` wajib dibatasi hanya untuk dua binary spesifik tanpa argumen liar:
  ```sudoers
  dashboard-user ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t
  dashboard-user ALL=(ALL) NOPASSWD: /bin/systemctl reload nginx
  ```
- Eksekusi `curl` **dilarang** menggunakan `sudo`. Utilitas `curl` dijalankan murni di bawah user biasa tanpa hak istimewa.

### 5. Pencegahan Command Injection pada Curl Tester
- Pemanggilan `curl` pada modul pengujian konektivitas wajib menggunakan eksekusi langsung berbasis array argumen via `subprocess.run(args, shell=False)`.
- Penggunaan `shell=True` dilarang keras untuk mencegah eksploitasi parameter target domain, IP, atau custom headers menjadi eksekusi arbitrary command.

---

## Aturan Scoping Data (Data Scoping Rules)

| Entitas Data | Cakupan / Batasan Akses | Mekanisme Penegakan |
| :--- | :--- | :--- |
| **Berkas Vhost** | Terbatas pada direktori `/etc/nginx/sites-available/` dan symlink di `/etc/nginx/sites-enabled/`. | Validasi path kanonikal OS & whitelist direktori kerja di level kode backend. |
| **Tabel `sites`** | Mewakili representasi metadata dari file vhost aktual. Operasi delete pada DB harus sinkron dengan penghapusan symlink dan file. | Transaksi ACID di PostgreSQL; rollback file I/O jika commit DB gagal. |
| **Tabel `test_profiles`** | Terikat secara relasional ke `site_id` (FK dengan `ON DELETE CASCADE`). | Parameter `resolve_ip` divalidasi sebagai format IPv4/IPv6 valid; `port` dibatasi antara 1 - 65535. |
| **Tabel `audit_logs`** | Data bersifat *Append-Only* (WORM: Write Once, Read Many). | Tidak ada endpoint API `PUT`, `PATCH`, atau `DELETE` untuk tabel ini. Akses user DB di level SQL dibatasi hanya `SELECT` dan `INSERT`. |

---

## Analisis Risiko dan Mitigasi

| Kategori Risiko | Risiko Spesifik | Dampak | Mitigasi Penegakan Server |
| :--- | :--- | :--- | :--- |
| **Akses Tidak Sah** | Akses dashboard terekspos ke internet publik tanpa proteksi. | Penyerang dapat membaca topologi domain internal, mengubah vhost, dan mematikan layanan Nginx. | Lapisan pertahanan ganda: IP Whitelisting ketat dan HTTP Basic Auth langsung pada layer Nginx Gateway sebelum request mencapai Python. |
| **Injeksi Perintah** | Eksploitasi form Curl Tester dengan karakter escape (`&&`, `;`, `\|`) untuk mengeksekusi perintah shell OS. | Kompromi penuh server host lokal/VPS pada level privilege proses aplikasi. | Gunakan array argumen standar library (`subprocess.run([..., "--resolve", ...], shell=False)`). Lakukan sanitasi tipe data dan tolak karakter berbahaya pada header HTTP. |
| **Directory Traversal** | Manipulasi input `filename` (misal: `../../etc/passwd`). | Kebocoran berkas rahasia sistem atau perusakan konfigurasi OS di luar Nginx. | Validasi regex `^[a-zA-Z0-9._-]+$`. Validasi `os.path.commonpath` untuk memastikan hasil resolusi path tetap berada di dalam `/etc/nginx/sites-available/`. |
| **SSRF (Server-Side Request Forgery)** | Fitur Curl Tester digunakan untuk memindai port internal, layanan database (PostgreSQL :5432), atau Docker metadata API. | Pemindaian jaringan internal dan potensi eksploitasi dependensi backend lokal. | Terapkan validasi port pada level server (hanya izinkan port HTTP/HTTPS standar, misal: 80, 443, 8080, 8443, 8000). Batasi opsi `curl` dengan flag `--max-time 5` untuk mencegah denial of service. |
| **Denial of Service (DoS)** | *Reload* Nginx dilakukan dengan konfigurasi vhost yang sintaksnya keliru atau korup. | Seluruh layanan web yang dilayani oleh Nginx mengalami *downtime* total. | Server-side validation pipeline: Perintah `reload` di-*hardcode* agar selalu memicu `nginx -t` terlebih dahulu. Transaksi dibatalkan secara otomatis jika exit code `!= 0`. |
| **Manipulasi Log Audit** | Pengguna menghapus riwayat audit setelah melakukan konfigurasi ilegal atau destruktif. | Hilangnya jejak forensik insiden keamanan dan kegagalan akuntabilitas operasional. | Cabut hak `UPDATE` dan `DELETE` pada tabel `audit_logs` untuk role database yang digunakan backend. Tidak ada rute API untuk modifikasi data audit. |

---

## Asumsi

1. Pembagian peran antara Administrator dan Auditor/Viewer diidentifikasi melalui kredensial pengguna yang didaftarkan pada berkas htpasswd Nginx dan dibedakan melalui variabel environment atau header `X-Remote-User` yang diteruskan oleh reverse proxy.
2. Proses backend dijalankan di bawah akun sistem khusus (misal: `dashboard-user`) yang dimasukkan ke dalam grup sistem yang memiliki hak read/write pada direktori `/etc/nginx/sites-available/` dan `/etc/nginx/sites-enabled/`.
3. Firewall tingkat host (seperti `ufw` atau `iptables`) pada VPS telah mengisolasi port backend Python (port 8000) sehingga hanya dapat diakses secara lokal oleh Nginx reverse proxy gateway.