# Merilis versi baru (desktop, macOS)

Pemakaian internal: installer **belum ditandatangani/dinotarisasi**, jadi tidak ada auto-update. Pengguna memeriksa versi baru lewat tombol **Periksa pembaruan** di sidebar (membuka halaman Releases) dan memasang installer baru di atas yang lama.

## Sekali saja
1. Buat repo GitHub dan push.
2. Isi `repository.url` di `desktop/package.json` dengan URL repo (ganti `OWNER/REPO`). Tanpa ini, tombol pembaruan menjawab "alamat repositori belum diatur".
3. Tombol "Periksa pembaruan" memakai API GitHub tanpa token, jadi hanya bekerja untuk **repo publik**. Untuk repo privat, pengecekan menjawab "repositori tidak ditemukan atau privat" dan pengguna mengunduh manual dari Releases (anggota repo yang login).

## Tiap rilis
```bash
cd desktop
npm version patch --no-git-tag-version     # atau minor / major; mengubah package.json + lock
git commit -am "desktop: versi 0.1.1"      # sesuaikan angka
git tag desktop-v0.1.1                     # harus persis desktop-v + versi package.json
git push origin HEAD desktop-v0.1.1
```
Workflow `.github/workflows/desktop.yml` (macOS) lalu: lint → tes → build `.dmg` arm64 + Intel → membuat GitHub Release berisi dua `.dmg` dan `SHA256SUMS.txt`. Tag yang tidak sama dengan versi di `package.json` ditolak.

## Format versi
Semver `MAJOR.MINOR.PATCH`. Hanya tag berawalan `desktop-v` yang dihitung sebagai rilis aplikasi desktop; draft dan pre-release diabaikan oleh pengecek.

## Nanti (bila ada sertifikat)
Tanda tangan + notarisasi macOS (Apple Developer Program) membuka jalan ke auto-update penuh dengan `electron-updater`; pada macOS update otomatis mensyaratkan aplikasi bertanda tangan.
