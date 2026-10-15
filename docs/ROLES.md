# ROLES — Dashboard Server

Dokumen ini mendefinisikan seluruh peran dan aktor (baik manusia maupun sistem) yang berinteraksi dalam ekosistem aplikasi Dashboard Server, cakupan akses, batasan hak operasi, serta metode penentuan identitas berdasarkan Dokumen Persyaratan Produk (PRD).

---

## Ringkasan Peran

| Peran / Aktor | Tipe Aktor | Tanggung Jawab Utama | Mekanisme Identifikasi |
| :--- | :--- | :--- | :--- |
| **Administrator Server** | Manusia (*Internal User*) | Mengelola berkas vhost, validasi sintaks, reload layanan, dan pengujian konektivitas situs. | Nginx Gateway (HTTP Basic Auth & IP Whitelist). |
| **Backend Service Engine** | Sistem (*Automated Process*) | Membaca/menulis konfigurasi, manipulasi symlink, menjalankan subprocess CLI, dan mencatat audit log. | User OS Host Server (Linux User & izin `visudo`). |
| **Nginx Edge Gateway** | Sistem (*Reverse Proxy*) | Menyaring lalu lintas jaringan terlarang dan memverifikasi kredensial dasar sebelum diteruskan ke backend. | Konfigurasi blok server Nginx (Konfigurasi Direktif Akses). |

---

## Rincian Peran dan Aktor

### 1. Administrator Server
* **Siapa**: Pengembang perangkat lunak, DevOps, atau Sysadmin yang memiliki wewenang untuk mengelola server web pada lingkungan lokal maupun VPS produksi.
* **Tujuan**:
  - Mengonfigurasi dan mengaktifkan/menonaktifkan *virtual host* Nginx.
  - Memastikan konfigurasi Nginx valid tanpa merusak runtime web server yang sedang berjalan.
  - Melakukan reload daemon Nginx secara aman pasca pembaruan berkas.
  - Memverifikasi aksesibilitas domain/layanan internal menggunakan utilitas Curl CLI.
* **Area / Halaman yang Diakses**:
  - **Nginx Site Manager**: Daftar vhost, tombol toggle symlink, dan antarmuka teks editor (Monaco/Ace Editor).
  - **Nginx Diagnostic Runner**: Tombol eksekusi `nginx -t`, konsol keluaran *log* (stdout/stderr), dan tombol eksekusi reload Nginx.
  - **Curl Connectivity Tester**: Formulir pengetesan domain (Target IP, port, protokol, custom headers) dan panel respons status HTTP.
  - **Audit & Log Riwayat**: Riwayat eksekusi perintah dan pencatatan riwayat perubahan vhost.
* **Batasan**:
  - Akses ditolak jika alamat IP klien tidak terdaftar pada daftar izin (*IP Whitelist*).
  - Tidak dapat mengeksekusi tombol "Reload Nginx" sebelum pengujian `nginx -t` menghasilkan status sukses (tervalidasi).
  - Tidak memiliki akses shell/terminal bebas; eksekusi perintah dibatasi hanya pada antarmuka fitur yang disediakan backend.
* **Penentuan Identitas**:
  - *Tidak ada modul autentikasi internal pada aplikasi backend (FastAPI/Flask).*
  - Identitas diverifikasi sepenuhnya pada lapisan perimeter web server (Nginx Reverse Proxy) melalui **HTTP Basic Authentication** dan **IP Whitelist Filter**. Setiap permintaan yang berhasil mencapai backend dianggap memiliki wewenang penuh sebagai Administrator.

---

### 2. Backend Service Engine (Python Process)
* **Siapa**: Proses layanan backend (berbasis FastAPI atau Flask) yang berjalan sebagai daemon/service lokal pada sistem operasi host.
* **Tujuan**:
  - Menjalankan operasi I/O terhadap berkas konfigurasi di disk server.
  - Mengelola *symbolic link* antar direktori Nginx.
  - Mengeksekusi perintah CLI sistem (`nginx -t`, `systemctl reload nginx`, `curl`) melalui proses turunan (*subprocess*).
  - Menyimpan rekam jejak operasi ke basis data PostgreSQL.
* **Area / Sumber Daya yang Diakses**:
  - Direktori `/etc/nginx/sites-available/` (Baca, Tulis, Buat, Hapus).
  - Direktori `/etc/nginx/sites-enabled/` (Buat Symlink, Hapus Symlink).
  - Utilitas biner sistem: `sudo nginx`, `sudo systemctl reload nginx`, `curl`.
  - Basis data PostgreSQL: Tabel `sites`, `test_profiles`, dan `audit_logs`.
* **Batasan**:
  - Hak eksekusi perintah dengan hak akses elevated dibatasi secara eksplisit oleh aturan `visudo` (hanya `nginx -t` dan `systemctl reload nginx` tanpa password).
  - Tidak dapat menjalankan perintah *reload* Nginx jika hasil *exit code* dari eksekusi perintah validasi sintaks bernilai selain `0` (gagal).
* **Penentuan Identitas**:
  - Diidentifikasi oleh kernel Linux sebagai akun pengguna lokal host (misalnya `www-data` atau *service user* tertentu).
  - Diidentifikasi oleh server PostgreSQL menggunakan kredensial koneksi basis data yang dimuat via *environment variables*.

---

### 3. Nginx Edge Gateway
* **Siapa**: Layanan Nginx yang diposisikan di depan backend Python sebagai reverse proxy dan penjaga gerbang lalu lintas masuk.
* **Tujuan**:
  - Menerapkan kontrol keamanan perimeter sebelum lalu lintas HTTP diteruskan ke port lokal backend (`localhost:8000`).
  - Menghentikan upaya akses tidak sah di level jaringan.
* **Area / Sumber Daya yang Diakses**:
  - Port listening publik atau lokal dashboard (port HTTP/HTTPS).
  - Berkas kredensial `.htpasswd` sistem.
  - Aturan direktif akses IP pada blok server Nginx.
* **Batasan**:
  - Hanya bertindak sebagai proxy dan filter keamanan; tidak memiliki interaksi langsung dengan basis data PostgreSQL atau eksekusi logika aplikasi.
* **Penentuan Identitas**:
  - Dijalankan langsung oleh Systemd Linux sebagai daemon layanan web server utama.

---

## Matriks Hak Akses

| Fitur / Operasi Sistem | Administrator Server | Backend Service Engine | Nginx Edge Gateway |
| :--- | :---: | :---: | :---: |
| Akses Dashboard UI | **Ya** (via Basic Auth) | Tidak | Tidak |
| Baca Berkas di `/etc/nginx/sites-available/` | Melalui UI | **Ya** (Direct I/O) | Tidak |
| Tulis/Ubah Berkas `/etc/nginx/sites-available/` | Melalui UI | **Ya** (Direct I/O) | Tidak |
| Manipulasi Symlink `/etc/nginx/sites-enabled/` | Melalui UI | **Ya** (`os.symlink`/`unlink`) | Tidak |
| Eksekusi Diagnostik Sintaks (`nginx -t`) | Melalui Tombol UI | **Ya** (via `sudo`) | Tidak |
| Eksekusi Reload Nginx (`systemctl reload`) | Terkunci jika tes gagal | **Ya** (Kondisional) | Tidak |
| Eksekusi Pengujian Jaringan (`curl`) | Melalui Form UI | **Ya** (via subprocess) | Tidak |
| Baca/Tulis Data ke PostgreSQL | Melalui API | **Ya** (Direct SQL/ORM) | Tidak |
| Filter Kredensial & IP Whitelist | Subjek Pemeriksaan | Tidak | **Ya** (Evaluasi Request) |

---

## Catatan Evolusi Peran

Untuk rilis tahap awal (MVP/Tahap 1), arsitektur peran sengaja dibuat sederhana (*single human role*) dengan pengamanan berbasis perimeter server. Rencana pengembangan hak akses untuk fase berikutnya meliputi:

1. **Migrasi Autentikasi ke Layer Aplikasi**:
   - Menghilangkan ketergantungan mutlak pada HTTP Basic Auth di level Nginx, menggantikannya dengan modul login internal berbasis sesi/JWT.
   - Penambahan tabel `users` pada skema basis data PostgreSQL.
2. **Pemisahan Peran Pengguna (Role-Based Access Control / RBAC)**:
   - **Viewer / Auditor**: Hanya memiliki akses baca konfigurasi Nginx, melihat log riwayat, dan melakukan eksekusi Curl Connectivity Tester tanpa izin mengubah konfigurasi atau reload server.
   - **Operator**: Dapat mengedit konfigurasi dan menjalankan tes sintaks, namun membutuhkan persetujuan (*approval*) untuk melakukan reload Nginx pada lingkungan VPS produksi.
   - **Super Admin**: Memiliki akses penuh termasuk pengelolaan pengguna dashboard dan modifikasi aturan pengujian.
3. **Audit Log Berbasis Identitas Pengguna**:
   - Memodifikasi skema tabel `audit_logs` untuk mencatat atribut `user_id` atau `username` pada setiap aktivitas pengubahan berkas dan eksekusi perintah sistem (pada MVP saat ini, riwayat log belum terikat pada identitas pengguna perorangan).

---

## Asumsi

1. **Single-User Persona pada MVP**: Seluruh anggota tim internal yang memegang kredensial HTTP Basic Auth valid dan berasal dari IP terdaftar diperlakukan setara sebagai **Administrator Server** dengan hak penuh.
2. **Ketiadaan Session Context di Backend**: Aplikasi backend tidak membedakan pengguna individual; audit log mencatat aksi yang dilakukan oleh sistem atas pemicu dari antarmuka web tanpa menyertakan metadata akun pengguna.
3. **Kepatuhan visudo**: Akun Linux yang menjalankan aplikasi backend telah dikonfigurasi pada `/etc/sudoers` dengan direktif `NOPASSWD` terbatas hanya untuk perintah `/usr/sbin/nginx -t` dan `/bin/systemctl reload nginx`.