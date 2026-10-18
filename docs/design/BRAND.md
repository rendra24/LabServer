# LabServer

LabServer adalah ruang kerja desktop untuk mengelola server Nginx melalui SSH. Nama ini menggabungkan kebebasan bereksperimen di lab dengan fungsi utama pengelolaan server. Nama digunakan sebagai identitas produk lokal; pemeriksaan merek/domain bukan bagian perubahan ini.

## Arah desain

Terinspirasi ruang kerja [Termius](https://termius.com) dan kejelasan panel [Coolify](https://coolify.io), dengan identitas sendiri: emblem L yang membentuk rak server, aksen biru, dan navigasi ringkas. Bukan replika UI kedua produk tersebut.

- Gelap: canvas `#101115`, sidebar `#14151a`, surface `#191b22`, border `#2b2e39`, teks `#eceef4`, aksi `#5279ed`.
- Terang: canvas `#f7f8fc`, sidebar `#eef0f6`, surface `#ffffff`, border `#dce1eb`, teks `#252d42`, aksi `#4a70dd`.
- Tipografi: font sistem native untuk antarmuka, SF Mono/Consolas untuk host, konfigurasi, dan log; tidak memerlukan jaringan.
- Layout: sidebar tetap, breadcrumb dan status sesi, daftar server yang dapat dicari, editor dan diagnostik berdampingan pada jendela lebar.
- Fokus: pengelolaan SSH/Nginx yang sudah tersedia. Tidak menampilkan statistik, status online, terminal, atau fitur deployment yang belum diimplementasikan.

## Aset

- `../../src/renderer/assets/labserver-logo.png`: logo transparan hasil built-in image generation, 1254 × 1254.
- `../../build/icon.icns`: ikon macOS berbagai ukuran.
- `../../build/icon.ico`: ikon Windows, PNG RGBA 256 × 256 dalam container ICO.

Logo dibuat dengan tool imagegen bawaan. Prompt final:

> Use case: logo-brand. Create the final application icon for LabServer, a modern desktop SSH and Nginx server management workspace. A single original geometric emblem combining an abstract lowercase L with two stacked server trays, in a compact isometric hexagonal silhouette. Crisp confident vector-like edges, softly rounded corners, cobalt blue #5985ff upper plane, periwinkle #90aaff and subtle icy cyan #8edfe4 lower detail. Restrained depth from two flat overlapping planes, no 3D rendering or shadows. Strong recognizable silhouette that works at 24px. Centered isolated emblem occupying 78 percent of square canvas. True transparent background outside the emblem. No lettering, no wordmark, no mockup, no border, no watermark. Professional developer tool identity, calm precise technical feel.

Ikon installer diturunkan dari logo yang sama, dengan resize melalui `sips` dan container ICNS/ICO. Package name, app ID, direktori userData, dan nama internal Keychain versi lama dipertahankan; nama tampilan jendela/installer menjadi LabServer. Logo Dock, menu native, dan panel Tentang juga memakai LabServer; nama bundle OS di mode pengembangan tetap mengikuti binary Electron.app. Gunakan aplikasi hasil build untuk identitas OS LabServer sepenuhnya.

## Preview

Gambar di folder ini diambil dari renderer Electron asli dengan profil fixture, bukan data server pengguna:

- [Daftar server gelap](labserver-servers-dark.png)
- [Daftar server terang](labserver-servers-light.png)
- [Workspace kosong](labserver-empty-dark.png)
- [Dialog server terang](labserver-dialog-light.png)
- [Konfigurasi Nginx](labserver-sites-dark.png)
- [Editor gelap](labserver-editor-dark.png)
- [Editor terang](labserver-editor-light.png)

Regenerasi preview: `LABSERVER_SCREENSHOTS=docs/design npm run test:ui`. Untuk path output yang pasti, gunakan path absolut.
