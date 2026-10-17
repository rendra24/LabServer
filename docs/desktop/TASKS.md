# TASKS — Dashboard Server Desktop (PRD v3)

Urutan sprint D1 → D4. Aturan kerja sama dengan kickoff: tes dulu untuk logika non-trivial, verifikasi sungguhan, satu commit per task.

## Sprint D1: Fondasi Electron & Koneksi SSH
- [x] **D1.1** Scaffold `desktop/` (Electron, main/preload/renderer, `contextIsolation`, `sandbox`, CSP, blokir navigasi), skrip `npm start`/`npm test`/lint.
- [x] **D1.2** Penyimpanan profil server (`servers.json` di userData) dengan validasi (host, port 1–65535, user, auth, path absolut).
- [x] **D1.3** Modul SSH (`ssh2`): connect dengan password, key, key+passphrase; timeout; error ramah (auth gagal, host tak terjangkau, key tidak terbaca).
  - *Dependensi:* D1.2
- [x] **D1.4** Verifikasi host key TOFU (fingerprint SHA256, persetujuan pengguna, tolak bila berubah).
  - *Dependensi:* D1.3
- [x] **D1.5** UI daftar server: tambah/ubah/hapus profil, tombol Tes Koneksi, dialog fingerprint, opsi "Ingat password" via `safeStorage`.
  - *Dependensi:* D1.3, D1.4

**DoD:** Aplikasi berjalan (`npm start`), bisa connect ke server SSH uji (container) dengan password dan key, fingerprint baru diminta persetujuan dan fingerprint berubah ditolak.

## Sprint D2: Operasi Nginx Remote
- [x] **D2.1** Validasi nama berkas & quoting shell (unit test, termasuk payload injeksi).
- [x] **D2.2** List `sites-available` + status `sites-enabled`; baca berkas.
- [x] **D2.3** Tulis atomik, tambah (eksklusif), clone; fallback `sudo` bila izin SFTP ditolak.
- [x] **D2.4** Aktif/nonaktif symlink (tidak menimpa entri asing).
- [x] **D2.5** `nginx -t` dan reload aman (test ulang di main sebelum reload); `sudo -n` lalu fallback password sudo via stdin.
- [x] **D2.6** Tes integrasi terhadap server SSH di container (user grup-writable, user sudo NOPASSWD, user sudo berpassword).

**DoD:** Semua operasi D2 lulus tes integrasi pada nginx sungguhan di container untuk ketiga model izin.

## Sprint D3: UI Pengelolaan Vhost
- [x] **D3.1** Halaman vhost per server: daftar, status, toggle, Tambah, Edit, Clone.
- [x] **D3.2** Editor Ace (bundle lokal) + simpan + status Tersimpan/Belum Disimpan.
- [x] **D3.3** Clone dengan "ganti domain" (pakai ulang `replaceDomain`).
- [x] **D3.4** Panel diagnostik: Test Nginx Syntax, Reload terkunci sampai tes lolos; dialog password sudo.

**DoD:** Alur edit/tambah/clone/aktifkan/test/reload diverifikasi end-to-end di aplikasi terhadap server container (alur utama + satu kasus error).

## Sprint D4: Paket & Distribusi
- [ ] **D4.1** `electron-builder`: macOS `.dmg` (arm64 + x64) dibangun dan dijalankan.
- [ ] **D4.2** Windows `.exe` (NSIS): build (cross-build atau GitHub Actions `windows-latest`) dan uji jalan.
- [ ] **D4.3** README desktop: instalasi, menambah server, kebutuhan izin di server (sudoers), keterbatasan (tanpa code signing).

**DoD:** Installer macOS dan Windows tersedia dan aplikasi terbuka serta bisa connect.

## Backlog desktop
- Hapus berkas konfigurasi · Linux build · auto-update · code signing/notarisasi · Curl Tester & riwayat aksi lokal · beberapa sesi server paralel.
