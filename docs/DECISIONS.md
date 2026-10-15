# DECISIONS — Dashboard Server

Prioritas dokumen jika konflik: PRD > DATABASE > BACKEND > FRONTEND > ROLES/PERMISSIONS > TASKS > README.

## Konflik dokumen (2026-10-15)

| # | Konflik | Keputusan | Alasan |
|---|---|---|---|
| 1 | Path API: BACKEND `/api/v1/nginx/test`, `/nginx/reload`, `/curl/test`; FRONTEND `/api/diagnostic/test-syntax`, `/api/curl/execute` (tanpa v1); TASKS `/api/health` | Ikut BACKEND (`/api/v1/...`). Health check tetap `/api/health` (tanpa versi). Frontend disesuaikan. | BACKEND prioritas lebih tinggi dari FRONTEND/TASKS; health bukan bagian API bisnis. |
| 2 | PERMISSIONS punya role Auditor/Viewer; PRD & ROLES: satu admin, RBAC di Backlog | Tidak ada role Viewer. Satu admin. | PRD menang; RBAC = Backlog = tidak dikerjakan. |
| 3 | Reload dengan sintaks gagal: BACKEND 400, PERMISSIONS 422 | 400 | BACKEND prioritas lebih tinggi. |
| 4 | Port curl: BACKEND/FRONTEND 1–65535; PERMISSIONS allowlist 80/443/8080/8443/8000 | Allowlist 80, 443, 8080, 8443, 8000, bisa diubah lewat env (`CURL_ALLOWED_PORTS`). Skema DB tetap 1–65535. | Disetujui user 2026-10-15. Lebih ketat, cegah SSRF ke mis. Postgres :5432. Menyimpang dari BACKEND secara sadar. |
| 5 | `action_type`: DATABASE `NGINX_TEST/NGINX_RELOAD/CONFIG_SAVE/CURL_TEST`; FRONTEND `RELOAD/FILE_SAVE/SYMLINK_TOGGLE` | Nilai DATABASE + tambahan `SYMLINK_TOGGLE`. Filter UI mengikuti. | DATABASE menang; kolom VARCHAR tanpa CHECK sehingga tidak perlu ubah skema; TASKS 2.4 mewajibkan toggle tercatat. |
| 6 | Nama user sudoers: `dashboard_app` / `dashboard-user` / `dashboard-runner` | `dashboard_app` | BACKEND menang. |
| 7 | Perintah curl BACKEND `-I -X GET` + `-o /dev/null` tidak konsisten (HEAD vs GET, tanpa header keluaran) | GET biasa, `-D -` (header), `-o /dev/null`, `-w` pipa, `--max-time 5`, timeout subprocess 15 dtk | Maksud BACKEND (status, TTFB, header) tidak tercapai dengan flag aslinya; `--max-time` dari PERMISSIONS. |
| 8 | Regex nama file: BACKEND `^[a-zA-Z0-9._-]+$`; FRONTEND huruf kecil, min 3 | Ikut BACKEND; UI memakai aturan sama. Server juga menolak `.`, `..`, nama berawalan titik. | BACKEND menang; hindari UI≠server. |
| 9 | `resolve_ip`: FRONTEND IPv4 saja; BACKEND IPv4/IPv6; DATABASE NOT NULL | IPv4/IPv6 via `ipaddress`. Opsional pada request curl, wajib pada profil. | BACKEND/DATABASE menang. |
| 10 | Rute UI tanpa bundler | FastAPI menyajikan halaman HTML statis per rute; `/api/*` JSON. | Paling sederhana; origin sama. |
| 11 | Seed: DATABASE punya seed SQL; TASKS 1.3 "eksekusi migrasi dan pasang seed" | Seed = skrip terpisah, idempoten (`python -m app.seed`), bukan migrasi. | Migrasi tidak boleh membawa data contoh ke produksi. |
| 12 | Direktori Nginx hardcode `/etc/nginx/...`, mesin dev macOS | Default tetap `/etc/nginx/...`; override lewat env `NGINX_AVAILABLE_DIR`/`NGINX_ENABLED_DIR`. | Dokumen tidak melarang; perlu untuk tes. |
| 13 | Baris `sites` tanpa file di disk (seed) | Baris dipertahankan, detail → 404; file baru di disk diimpor saat list. | Disetujui user 2026-10-15. |
| 14 | Tailwind "terkompilasi" tanpa library eksternal; Monaco via CDN/vendor | Tailwind standalone CLI (tanpa Node), CSS hasil build di-commit; Monaco dari CDN jsdelivr versi dikunci. | Disetujui user 2026-10-15. |
| 15 | PRD tidak punya bagian "Non-Goals" | Backlog di TASKS.md dianggap Non-Goals. | Satu-satunya daftar penundaan. |
| 16 | PRD/FRONTEND: "Monaco atau Ace"; Monaco tidak punya mode sintaks Nginx bawaan | Ace 1.36.5 (mode `nginx` bawaan) dari CDN jsdelivr, versi dikunci | Highlight Nginx tanpa menulis tokenizer sendiri. Disetujui pada keputusan #14 (CDN). |
| 17 | Pembuatan berkas yang sudah ada: BACKEND hanya mendaftar 400/404/422/500 | `400 FILE_EXISTS` | Tetap dalam daftar kode BACKEND. |
| 18 | FRONTEND meminta tombol "Test All Nginx Syntax" dan menu Curl Tester/Audit Logs di navigasi | Ditambahkan saat halaman/endpoint-nya ada (Sprint 3). Halaman `/audit-logs` dan endpoint `GET /api/v1/audit-logs` tidak ada di task TASKS.md mana pun; diusulkan masuk Sprint 3 (lihat Usulan). | Tidak membuat link mati. |
| 19 | TASKS.md tidak punya task untuk halaman `/audit-logs` dan endpoint `GET /api/v1/audit-logs`, padahal PRD Core Feature 4 dan FRONTEND/BACKEND mendefinisikannya | Ditambahkan sebagai task 3.8 (endpoint) dan 3.9 (halaman) di Sprint 3. Filter `is_success` ditambahkan di endpoint untuk filter status di FRONTEND. | Diminta user 2026-10-16. Mengisi celah TASKS, bukan fitur baru di luar PRD. |
| 20 | BACKEND: `sudo /usr/sbin/nginx -t` | Argv `sudo -n <bin> -t` (tambah `-n`); path binary default tetap BACKEND, bisa di-override env (`SUDO_BIN`, `NGINX_BIN`, `SYSTEMCTL_BIN`, `CURL_BIN`). | `-n` membuat sudo gagal cepat bila aturan sudoers belum terpasang, bukan menggantung. Aturan sudoers tetap cocok (`-n` opsi sudo). Override hanya untuk dev/tes. |
| 21 | PERMISSIONS: hanya port allowlist untuk cegah SSRF; BACKEND tidak membatasi alamat tujuan | Selain allowlist port, `resolve_ip` dan target berupa IP literal **link-local** (169.254.0.0/16, fe80::/10) ditolak (`TARGET_NOT_ALLOWED`). Redirect tidak diikuti, proxy env diabaikan, protokol dibatasi http/https. | Tanpa ini, port 80 + `resolve_ip=169.254.169.254` menjangkau metadata cloud VPS — risiko yang disebut PERMISSIONS. Pembatasan tambahan, bukan fitur baru. |
| 22 | Sprint 4: 4.4 (uji VPS) dan 4.5 (panduan) butuh VPS | MVP ditutup 2026-10-16 dengan 4.4 dan 4.5 **tetap terbuka** sampai ada akses VPS. DoD Sprint 4 belum terpenuhi (bagian VPS). | Keputusan user. Artefak siap: `deploy/verify-deployment.sh`, `docs/OPERATIONS.md` (draf, langkah ⚠ belum diuji). |

## Asumsi
- Python 3.11 (min. BACKEND), SQLAlchemy 2.x + psycopg 3, Alembic. Dependensi dev: pytest, httpx (TestClient), ruff (linter). Versi dipin di `backend/requirements*.txt`.
- Nama file migrasi `YYYYMMDDHHMM_<deskripsi>.py` (Alembic `file_template`).
- DB dev lokal: `dashboard_server`; DB tes: `dashboard_server_test` (dikosongkan oleh tes migrasi).
- `backend/.env` untuk dev lokal (di-gitignore); contoh di `.env.example`.
- Kolom respons `file_exists` ditambahkan di SiteResponse (tidak ada di BACKEND) untuk menandai baris tanpa berkas (keputusan #13).
- Impor otomatis: domain diambil dari `server_name` pertama; jika tidak valid, dipakai nama berkas yang disanitasi.
- Batas isi konfigurasi 1 MiB; karakter null ditolak.
- Audit hanya mencatat operasi mutasi yang berhasil (satu transaksi dengan operasinya).
- Sprint 4: artefak deployment di `deploy/` (unit systemd, `db-roles.sql`, `verify-deployment.sh`) dan `docs/OPERATIONS.md` adalah pelengkap Task 4.4/4.5, bukan fitur aplikasi. Role DB runtime terpisah dari pemilik tabel agar `audit_logs` benar-benar append-only (PERMISSIONS.md); terbukti: DELETE/UPDATE/TRUNCATE ditolak, fitur lain jalan.
- Tes integrasi (`backend/tests/integration/`) memakai nginx, php-fpm, dan (opsional, `INTEGRATION_DOCKER_IMAGE`) container nyata; dilewati otomatis bila tidak tersedia.
- Sudoers memakai `(root)` bukan `(ALL)` sebagai run-as user: perintah sama, hak lebih sempit.
- Docs OpenAPI (`/docs`) dimatikan: backend internal, kurangi permukaan.

## Usulan (TIDAK diimplementasikan)
- (kosong)
