# Merilis versi baru (desktop, macOS)

Pemakaian internal: installer **belum ditandatangani/dinotarisasi**, jadi tidak memakai `electron-updater`. Pengguna menekan **Periksa pembaruan** di sidebar; bila ada versi baru, dialog menawarkan **Perbarui sekarang** (unduh, verifikasi, pasang, buka ulang di dalam aplikasi), **Buka halaman rilis** (manual), atau **Nanti**.

## Sekali saja
1. Buat repo GitHub dan push.
2. Isi `repository.url` di `package.json` dengan URL repo (ganti `OWNER/REPO`). Tanpa ini, tombol pembaruan menjawab "alamat repositori belum diatur".
3. Tombol "Periksa pembaruan" memakai API GitHub tanpa token, jadi hanya bekerja untuk **repo publik**. Untuk repo privat, pengecekan menjawab "repositori tidak ditemukan atau privat" dan pengguna mengunduh manual dari Releases (anggota repo yang login).

## Tiap rilis
```bash
npm version patch --no-git-tag-version     # atau minor / major; mengubah package.json + lock
git commit -am "desktop: versi 0.1.1"      # sesuaikan angka
git tag desktop-v0.1.1                     # harus persis desktop-v + versi package.json
git push origin HEAD desktop-v0.1.1
```
Workflow `.github/workflows/desktop.yml` (macOS) lalu: lint → tes → build `.dmg` arm64 + Intel (`LabServer-macOS-arm64.dmg`, `LabServer-macOS-x64.dmg`) → membuat GitHub Release berisi dua `.dmg` dan `SHA256SUMS.txt`. Tag yang tidak sama dengan versi di `package.json` ditolak.

## Format versi
Semver `MAJOR.MINOR.PATCH`. Hanya tag berawalan `desktop-v` yang dihitung sebagai rilis aplikasi desktop; draft dan pre-release diabaikan oleh pengecek.

## Pembaruan di dalam aplikasi
Syarat agar **Perbarui sekarang** muncul dan berhasil (macOS, aplikasi terpasang di folder yang bisa ditulis, mis. `/Applications`):
- Release memuat `LabServer-macOS-arm64.dmg` dan/atau `LabServer-macOS-x64.dmg` **dengan nama persis itu**, plus `SHA256SUMS.txt` (dibuat otomatis oleh workflow).
- Aplikasi mengunduh dari `github.com/<owner>/<repo>/releases/download/<tag>/...` saja, mencocokkan SHA256, memastikan tanda tangan bundle valid, bundle id `appId`, dan versi sama dengan tag, lalu menukar `LabServer.app` setelah aplikasi keluar. Jika penukaran gagal, aplikasi lama dikembalikan.
- Jika ada perubahan belum tersimpan, penutupan aplikasi meminta konfirmasi seperti biasa. Bila dibatalkan, skrip penukar menyerah setelah ±3 menit dan versi lama tetap berjalan.
- Keamanan: SHA256 hanya membuktikan unduhan utuh, bukan keaslian (checksum berasal dari Release yang sama). Keaslian penuh butuh tanda tangan Developer ID.
- Setelah pembaruan, tanda tangan ad-hoc berubah sehingga macOS dapat meminta izin Keychain lagi untuk password yang tersimpan.

## Nanti (bila ada sertifikat)
Tanda tangan + notarisasi macOS (Apple Developer Program) membuka jalan ke auto-update penuh dengan `electron-updater`; pada macOS update otomatis mensyaratkan aplikasi bertanda tangan.
