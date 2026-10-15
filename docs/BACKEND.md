# BACKEND.md — Dashboard Server

Dokumen arsitektur backend, spesifikasi API, dan panduan teknis implementasi untuk aplikasi internal Dashboard Server.

---

## Struktur Direktori

Aplikasi menggunakan Python 3.11+ dengan framework FastAPI. Arsitektur modular memisahkan routing, manipulasi sistem (Nginx/Curl), dan interaksi PostgreSQL.

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # Inisialisasi FastAPI & middleware
│   ├── config.py            # Konfigurasi via pydantic-settings
│   ├── database.py          # Koneksi psycopg/SQLAlchemy engine & session
│   ├── models.py            # Model ORM / tabel PostgreSQL
│   ├── schemas.py           # Skema Pydantic untuk validasi I/O
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── sites.py         # Endpoint manajemen virtual host
│   │   ├── nginx.py         # Endpoint validasi sintaks & reload
│   │   ├── curl.py          # Endpoint diagnostik konektivitas
│   │   └── audit.py         # Endpoint pembacaan log audit
│   └── services/
│       ├── __init__.py
│       ├── file_service.py  # I/O /etc/nginx/sites-* & symlink
│       ├── system_service.py# Subprocess sudo nginx -t & reload
│       ├── curl_service.py  # Eksekusi CLI curl & parsing output
│       └── audit_service.py # Pencatatan histori aksi ke DB
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   └── test_services.py
├── requirements.txt
└── .env.example
```

---

## Daftar Endpoint API

Semua endpoint berbasis REST JSON dengan awalan `/api/v1`. Autentikasi dan pembatasan IP dilakukan di tingkat reverse proxy Nginx host sebelum request masuk ke backend.

| Method | Path / Nama Fungsi | Peran | Input | Output |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/sites`<br>`list_sites` | Mengambil semua konfigurasi virtual host dan status symlink | Query: `limit`, `offset` | `200 OK`: `{"items": [SiteResponse], "total": int}` |
| `POST` | `/api/v1/sites`<br>`create_site` | Membuat berkas konfigurasi baru di `sites-available` | JSON: `SiteCreate` (`filename`, `content`, `domain_name`) | `201 Created`: `SiteResponse` |
| `GET` | `/api/v1/sites/{id}`<br>`get_site` | Mengambil detail situs beserta isi berkas konfigurasi | Path: `id` (int) | `200 OK`: `SiteDetailResponse` (termasuk `content`) |
| `PUT` | `/api/v1/sites/{id}`<br>`update_site` | Memperbarui isi berkas konfigurasi Nginx | Path: `id`<br>JSON: `SiteUpdate` (`content`, `domain_name`) | `200 OK`: `SiteDetailResponse` |
| `DELETE` | `/api/v1/sites/{id}`<br>`delete_site` | Menghapus berkas dari `sites-available` dan symlink di `sites-enabled` | Path: `id` | `204 No Content` |
| `POST` | `/api/v1/sites/{id}/toggle`<br>`toggle_site_status` | Mengaktifkan/menonaktifkan symlink di `sites-enabled` | Path: `id` | `200 OK`: `SiteResponse` (`is_enabled`: bool) |
| `POST` | `/api/v1/nginx/test`<br>`run_nginx_test` | Menjalankan `sudo nginx -t` | JSON: opsional `site_id` | `200 OK`: `NginxTestResponse` (`is_success`, `stdout`, `stderr`) |
| `POST` | `/api/v1/nginx/reload`<br>`reload_nginx` | Menjalankan `sudo systemctl reload nginx` (hanya jika test lolos) | Tidak ada | `200 OK`: `CommandResultResponse` (`is_success`, `message`) |
| `POST` | `/api/v1/curl/test`<br>`run_curl_test` | Menjalankan pengujian konektivitas domain via `curl` | JSON: `CurlTestRequest` (`target_domain`, `resolve_ip`, `port`, `custom_headers`, `protocol`) | `200 OK`: `CurlTestResponse` (`status_code`, `ttfb_ms`, `headers`, `ssl_status`, `raw_output`) |
| `GET` | `/api/v1/profiles`<br>`list_test_profiles` | Mengambil riwayat profil pengujian curl | Query: `site_id` (opsional) | `200 OK`: `List[TestProfileResponse]` |
| `POST` | `/api/v1/profiles`<br>`create_test_profile` | Menyimpan profil pengujian curl baru | JSON: `TestProfileCreate` | `201 Created`: `TestProfileResponse` |
| `GET` | `/api/v1/audit-logs`<br>`list_audit_logs` | Mengambil log riwayat eksekusi dan perubahan konfigurasi | Query: `limit`, `offset`, `action_type`, `site_id` | `200 OK`: `{"items": [AuditLogResponse], "total": int}` |

---

## Service Layer dan Aturan Bisnis

### 1. File Service (`file_service.py`)
- Direktori kerja:
  - `AVAILABLE_DIR`: `/etc/nginx/sites-available/`
  - `ENABLED_DIR`: `/etc/nginx/sites-enabled/`
- **Aturan Operasi Berkas**:
  - Validasi ketat nama berkas untuk mencegah *directory traversal* (tanpa karakter `/`, `\`, atau sekuens `..`).
  - Penulisan berkas dilakukan secara atomik menggunakan file temporer sebelum direplace ke tujuan akhir untuk menghindari *corrupted configuration* jika proses terputus.
  - Sinkronisasi status: Ketika berkas dibaca atau status symlink diubah, kolom `is_enabled` pada tabel `sites` diperbarui.
  - Hapus: Menghapus symlink di `ENABLED_DIR` terlebih dahulu jika ada, lalu menghapus berkas di `AVAILABLE_DIR`.

### 2. System Service (`system_service.py`)
- **Eksekusi `nginx -t`**:
  - Dijalankan via `subprocess.run(["sudo", "/usr/sbin/nginx", "-t"], capture_output=True, text=True, timeout=10)`.
  - Mengembalikan `stdout`, `stderr`, dan status kode exit (`0` = valid).
  - Setiap eksekusi otomatis mencatat ke tabel `audit_logs` dengan `action_type = 'NGINX_TEST'`.
- **Eksekusi Reload Nginx**:
  - **Prasyarat Wajib**: Sistem wajib mengeksekusi `nginx -t` internal terlebih dahulu. Jika verifikasi sintaks gagal (`returncode != 0`), perintah reload DITOLAK seketika dengan status HTTP 400.
  - Jika sintaks valid, jalankan: `subprocess.run(["sudo", "/bin/systemctl", "reload", "nginx"], capture_output=True, text=True, timeout=10)`.
  - Hasil dicatat ke tabel `audit_logs` dengan `action_type = 'NGINX_RELOAD'`.

### 3. Curl Service (`curl_service.py`)
- Membangun perintah CLI curl secara programmatic tanpa eksposur *shell injection*.
- **Parameter Engine**:
  - Flag `--resolve <host>:<port>:<ip>` digunakan untuk bypass DNS jika `resolve_ip` diisi.
  - Format output diagnostik menggunakan flag `-w` (write-out) untuk latensi dan status:
    `curl -s -o /dev/null -w "%{http_code}|%{time_starttransfer}|%{time_total}|%{ssl_verify_result}" -I -X GET [URL]`
  - Dukungan penambahan kustomisasi header menggunakan parameter bertingkat `-H "Key: Value"`.
  - Timeout maksimal subprocess dibatasi 15 detik agar koneksi gantung tidak memblokir thread pekerja.
- Hasil dicatat ke tabel `audit_logs` dengan `action_type = 'CURL_TEST'`.

### 4. Audit Service (`audit_service.py`)
- Bertanggung jawab menyimpan setiap operasi yang bersifat mutatif atau diagnostik ke tabel `audit_logs`.
- Data yang direkam: `site_id`, `action_type`, `command_executed`, `execution_output`, `is_success`, dan timestamp.

---

## Validasi Input

Validasi diimplementasikan pada skema Pydantic (`schemas.py`):

1. **`SiteCreate` / `SiteUpdate`**:
   - `filename`: Wajib regex `^[a-zA-Z0-9._-]+$`. Panjang minimal 1, maksimal 255 karakter. Karakter terlarang: spasi, slash, backslash.
   - `content`: Teks konfigurasi tidak boleh kosong (`min_length=1`).
   - `domain_name`: String representasi domain atau IP, regex `^[a-zA-Z0-9.-]+$`.

2. **`CurlTestRequest`**:
   - `target_domain`: Validasi format domain/hostname valid.
   - `resolve_ip`: Validasi format IPv4/IPv6 standar (menggunakan `ipaddress.ip_address`).
   - `port`: Integer antara `1` sampai `65535`.
   - `protocol`: Enum string `["HTTP", "HTTPS"]`.
   - `custom_headers`: Dict[str, str] opsional. Header divalidasi agar tidak mengandung karakter newline (`\r`, `\n`) guna mencegah *HTTP header injection*.

---

## Format Error

Seluruh respons kegagalan API menggunakan struktur standar HTTP Problem Details sederhana:

```json
{
  "error": {
    "code": "INVALID_SYNTAX",
    "message": "Konfigurasi Nginx memiliki sintaks tidak valid.",
    "details": "nginx: [emerg] unknown directive \"invalid_rule\" in /etc/nginx/sites-available/app.local:12"
  }
}
```

Daftar kode status HTTP yang digunakan:
- `400 Bad Request`: Validasi bisnis gagal (misal: reload saat sintaks `nginx -t` error, *path traversal* pada nama file).
- `404 Not Found`: Berkas konfigurasi atau ID entitas di basis data tidak ditemukan.
- `422 Unprocessable Entity`: Input payload gagal divalidasi oleh skema Pydantic.
- `500 Internal Server Error`: Kegagalan eksekusi subprocess atau filesystem yang tidak tertangani.

---

## Keamanan

### 1. Autentikasi dan Otorisasi
- Sesuai PRD, kontrol akses antarmuka dashboard dan API diserahkan sepenuhnya ke level gateway Nginx host melalui:
  - **HTTP Basic Authentication** (`auth_basic` & `auth_basic_user_file`).
  - **IP Whitelist** (`allow <IP_ADMIN>; deny all;`).
- Backend Python mendengarkan (*listen*) secara lokal pada `127.0.0.1:8000` (atau network bridge Docker internal) dan menolak koneksi langsung dari interface publik.

### 2. Aturan Hak Akses Sudoers (`visudo`)
Pengguna sistem yang menjalankan worker backend (misal: user `dashboard_app`) hanya diberikan hak akses tanpa kata sandi (*NOPASSWD*) untuk sub-perintah spesifik di file `/etc/sudoers.d/dashboard-server`:

```text
dashboard_app ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t
dashboard_app ALL=(ALL) NOPASSWD: /bin/systemctl reload nginx
```

### 3. Eksekusi Subprocess Aman
- Dilarang keras menggunakan flag `shell=True` pada modul `subprocess`.
- Semua argumen CLI diparsing sebagai array string tetap: `['sudo', '/usr/sbin/nginx', '-t']`.
- Argumen `curl` dirakit secara eksplisit; input pengguna (`target_domain`, `resolve_ip`) tidak diinterpretasikan oleh shell bash.

### 4. Manajemen Secret
- Kredensial PostgreSQL (`DATABASE_URL`) dimuat dari berkas `.env` atau *environment variables* sistem.
- Tidak ada *hardcoded credentials* pada kode sumber.

---

## Proses Latar Belakang

Sesuai cakupan MVP pada PRD, tidak dibutuhkan *task queue* terdistribusi (seperti Celery/Redis). 
- Operasi `nginx -t`, `systemctl reload`, dan `curl` dijalankan secara *synchronous* via thread pool internal FastAPI (`def` endpoint langsung dieksekusi di default threadpool Starlette).
- Batas waktu timeout ketat (10 detik untuk Nginx, 15 detik untuk Curl) menjamin thread worker tidak terblokir permanen.

---

## Strategi Testing

Strategi pengujian difokuskan pada isolasi filesystem dan mocking eksekusi perintah sistem agar dapat dijalankan pada environment CI tanpa akses root.

1. **Unit Test Service (`pytest`)**:
   - `file_service`: Menggunakan direktori sementara (`tmp_path`) untuk simulasi `sites-available` dan `sites-enabled`.
   - `system_service`: Menggunakan `unittest.mock.patch('subprocess.run')` untuk mensimulasikan respons `nginx -t` (berhasil dan gagal).
   - `curl_service`: Menggunakan mock pada pemanggilan perintah curl untuk mengecek akurasi parsing string status dan latensi.

2. **Self-Check Test Minimal**:
   Tersedia skrip pengujian berbasis *assert* mandiri tanpa dependensi kompleks untuk verifikasi logika *safe reload*:

```python
# tests/test_reload_safety.py
from unittest.mock import patch, MagicMock
from app.services.system_service import reload_nginx_safe

def test_reload_blocked_on_invalid_syntax():
    with patch("app.services.system_service.run_nginx_test") as mock_test:
        # Simulasi nginx -t gagal
        mock_test.return_value = {"is_success": False, "stderr": "syntax error"}
        
        result, success = reload_nginx_safe()
        assert success is False
        assert "Sintaks tidak valid" in result
```

---

## Logging

Sistem menerapkan dua layer pencatatan:
1. **Application Logging**:
   - Menggunakan modul standar `logging` Python dengan format structured log stream ke `stdout`.
   - Menangkap error runtime, exception database, dan peringatan kegagalan akses filesystem.
2. **Database Audit Trail**:
   - Semua mutasi konfigurasi, eksekusi tes sintaks, reload daemon, dan tes curl tersimpan permanen pada tabel `audit_logs` sesuai skema PRD.
   - Tidak mencatat informasi sensitif kredensial; hanya menyimpan perintah, output ringkas, dan status sukses/gagal.

---

## Asumsi

1. **Izin Tulis Filesystem**: Pengguna OS yang menjalankan backend Python tergabung dalam grup sistem yang memiliki hak akses tulis (*write permissions*) ke `/etc/nginx/sites-available` dan hak manipulasi link di `/etc/nginx/sites-enabled`.
2. **Ketersediaan Binary**: Path binary sistem terpasang pada path standar Linux Ubuntu/Debian: `/usr/sbin/nginx`, `/bin/systemctl`, dan `/usr/bin/curl`.
3. **Karakter Pemisah Curl Write-Out**: Output ringkasan `curl` selalu menggunakan format pemisah pipa (`|`) dan format respon header HTTP standar.