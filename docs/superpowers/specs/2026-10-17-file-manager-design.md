# File manager LabServer — rancangan versi pertama

Status: **disetujui pengguna pada 17 Oktober 2026**, setelah pemeriksaan builder tanpa pertanyaan penting yang tersisa. Mockup interaktif memakai data contoh saja.

## Tujuan dan keputusan pengguna

Pengguna ingin mengelola transfer seperti aplikasi FTP ketika sesi VPS aktif, menggunakan LabServer yang sudah memiliki SSH, monitoring, terminal, Nginx, serta backup kredensial. Mereka mengonfirmasi upload/download file **dan folder lengkap secara rekursif**, menyetujui tujuh prioritas berikut, lalu memilih **B — Dua Panel** pada mockup: komputer lokal di kiri dan VPS di kanan.

Prioritas yang disetujui:

1. Pilihan banyak file dan drag & drop untuk upload.
2. Progres, antrean transfer, pembatalan, dan coba lagi.
3. Membuat folder, mengganti nama, dan menghapus file/folder di VPS.
4. Keputusan saat nama sama: lewati, simpan dengan nama baru, atau timpa.
5. Pencarian di folder yang sedang dibuka dan toggle file tersembunyi.
6. Informasi file: ukuran, waktu perubahan, izin akses, dan pemilik/grup jika tersedia.
7. Editor teks langsung untuk file VPS.

Riwayat pengguna menekankan kepemilikan dan keutuhan data. File tidak boleh tertimpa atau dihapus diam-diam. Perubahan ini tidak mengubah namespace penyimpanan atau format backup `.lsb`/`.labserver`.

## Pilihan yang saya usulkan untuk implementasi

Bagian ini merupakan keputusan perancang, **bukan tambahan permintaan yang sudah disetujui pengguna**. Pengguna meninjau bagian ini bersama rancangan sebelum implementasi.

- Transfer menggunakan **SFTP pada koneksi SSH aktif yang sama**. Tidak meminta login FTP terpisah atau memasang agent di VPS.
- Hak akses mengikuti user SSH. Versi pertama tidak menaikkan hak akses melalui sudo, mengubah ownership, atau menyediakan chmod/chown sebagai operasi pengguna. Akses ditolak ditampilkan jelas tanpa mengubah izin secara otomatis.
- Panel lokal mulai dengan **Pilih folder lokal…** melalui dialog sistem. User dapat mengganti akar folder melalui dialog. Panel VPS mulai di home user SSH (`realpath('.')`), kemudian bebas menavigasi lokasi yang boleh diakses akun tersebut.
- Operasi buat folder, rename, dan hapus berlaku pada **VPS**. Panel lokal berfungsi untuk navigasi sumber upload dan tujuan download, bukan menghapus/rename file komputer.
- Dua file ditransfer bersamaan sebagai batas awal. Antrean serta progres dikelola main process dan tetap hidup saat pindah dashboard, terminal, Nginx, atau kembali ke file manager.
- Coba lagi memulai ulang file yang gagal/dibatalkan. **Resume dari byte terakhir** dan pemulihan antrean setelah aplikasi ditutup tidak termasuk versi pertama.
- Editor menerima file teks UTF-8 maksimal **1 MiB**; file lebih besar atau biner tetap dapat ditransfer. Isi dan perubahan editor dipertahankan ketika berpindah halaman pada sesi yang sama.
- Symlink ditandai dan target dapat ditampilkan. Traversal rekursif tidak mengikuti symlink; item yang dilewati dilaporkan. Menghapus symlink hanya menghapus link, tidak targetnya.

## Tampilan yang dipilih

Mengikuti bahasa visual LabServer saat ini: font UI sistem, path dan izin monospace, warna biru untuk aksi utama, hijau untuk berhasil, tema terang/gelap, dan dukungan hide sidebar.

```text
Sidebar aplikasi | Server aktif                 Folder baru / Download / Upload
                 | Komputer lokal               | File di VPS
                 | Pilih folder / path lokal    | Home / induk / path / refresh
                 | Cari / file tersembunyi      | Cari / file tersembunyi
                 | Daftar dan pilihan lokal     | Daftar dan pilihan VPS
                 |                              | Rename / Hapus / Detail / Edit
                 | Transfer: arah, nama, progres, kecepatan, status, Batal/Coba lagi
```

- Menu **File manager** aktif hanya setelah VPS terhubung, bersama Dashboard monitoring, Terminal, dan Konfigurasi Nginx. Dashboard monitoring tetap menjadi halaman awal setelah connect.
- Masing-masing panel memiliki path, tombol induk, refresh, pencarian nama di folder saat ini, toggle file tersembunyi, pilihan banyak item, serta pengurutan nama/ukuran/waktu. Direktori dikelompokkan di atas file.
- Upload memakai item yang dipilih di panel lokal; tersedia dialog sistem untuk memilih file atau folder serta drag & drop dari file explorer. Download memakai item yang dipilih di panel VPS dan tujuan folder lokal yang dipilih pengguna.
- Detail VPS dibuka sebagai panel samping overlay agar dua panel utama tetap terbaca. File teks dibuka dalam editor modal dengan path lengkap, status tersimpan/belum disimpan, dan tombol Simpan ke VPS. Ace yang sudah dibundel digunakan untuk editor produksi; textarea dalam mockup hanyalah simulasi.
- Toolbar menonaktifkan aksi yang tidak sesuai seleksi: rename satu item, edit satu file teks, upload dari pilihan lokal, download dari pilihan VPS.
- Antrean menampilkan progres per file, progres kelompok folder, kecepatan, jumlah selesai/dilewati/gagal, dan status pemindaian. Total akhir baru dinyatakan lengkap setelah pemindaian selesai; jangan menampilkan persentase total yang seolah pasti saat jumlah file masih bertambah.
- Pada ukuran minimum aplikasi (900 px), kedua panel tetap bisa dipakai dengan kolom sekunder disembunyikan dan scrollbar terpisah. Sidebar dapat disembunyikan untuk memberi ruang. Semua operasi utama dapat dijangkau dengan keyboard dan mempunyai label aksesibel.

Mockup sumber lokal (diabaikan Git): `.superpowers/brainstorm/91846-1792236364/content/file-manager-layout.html`. Screenshot dua panel terang/gelap serta editor berada di direktori `state` pada sesi yang sama. Mockup sudah dipilihkan B secara default; angka dan direktori di dalamnya bukan data pengguna.

## Perilaku transfer dan integritas data

### File dan folder

- Upload/download mendukung banyak file dan folder, subfolder, file kosong, folder kosong, nama Unicode, spasi, serta file tersembunyi di dalam folder yang dipilih. Toggle tampilan tidak mengecualikan file tersembunyi dari transfer folder.
- Streaming digunakan untuk isi file; file besar tidak dimuat seluruhnya di renderer atau memori main. Traversal folder dan antrean dibatasi per batch, dengan pembatalan diperiksa selama pemindaian dan penyalinan.
- Setiap pekerjaan terikat pada ID server **dan instance koneksi**. Event sesi lama tidak boleh mengubah panel, antrean, atau berkas milik koneksi baru.
- Konflik direktori yang sama boleh digabung tanpa menghapus isi lama, tetapi setiap konflik file tetap membutuhkan keputusan. Konflik file-versus-direktori tidak diubah menjadi tipe lain secara otomatis.
- Dialog konflik default **Lewati**. Pengguna dapat memilih nama baru atau secara eksplisit menimpa, dengan opsi menerapkan keputusan pada sisa konflik dalam pekerjaan yang sama. Nama hasil otomatis harus unik, misalnya `laporan (1).txt`.
- Tulisan masuk ke file sementara unik pada direktori tujuan yang sama, lalu dikomit setelah stream selesai. File tujuan lama tidak dibuka dengan mode truncate pada awal transfer.
- Untuk mengganti file lama, gunakan atomic replace bila tersedia (termasuk ekstensi rename OpenSSH untuk SFTP). Jika server tidak mendukung penggantian yang aman, tampilkan kegagalan yang jelas; jangan menghapus file lama dahulu demi memaksa rename berhasil. Pertahankan mode izin file lama saat overwrite sejauh didukung, dan jangan diam-diam mengganti ownership yang tidak dapat dipertahankan.
- Pembatalan hanya menghapus file sementara yang dimiliki pekerjaan tersebut. File lengkap yang sudah selesai dalam transfer folder tetap ada dan ditampilkan dalam ringkasan; pembatalan bukan rollback seluruh folder.
- Nama remote yang tidak bisa diwakili dengan aman pada filesystem lokal, konflik nama karena case-insensitive Windows/macOS, atau path traversal dari entri server harus menghasilkan kegagalan/lewati yang terlihat. Jangan mengganti nama secara diam-diam dan jangan menulis di luar folder tujuan.
- Koneksi terputus menghentikan pekerjaan, menandai item belum selesai sebagai gagal, dan mempertahankan ringkasan. File sementara lokal dibersihkan; file sementara remote yang tidak dapat dibersihkan karena offline dilaporkan dan boleh dibersihkan setelah reconnect hanya jika kepemilikannya oleh pekerjaan terverifikasi. Tidak ada retry otomatis ke server lain. Setelah reconnect ke profil yang sama, tombol Coba lagi boleh memulai pekerjaan baru dengan mengulang validasi sumber, tujuan, dan konflik.
- Menutup/disconnect sesi ketika transfer berjalan meminta konfirmasi bahwa transfer belum selesai akan dibatalkan. Membatalkan konfirmasi mempertahankan koneksi dan pekerjaan.

### Operasi file VPS

- Membuat folder dan rename tidak menimpa entri lain. Validasi nama menolak nama kosong, `.`/`..`, separator path, dan NUL; nama normal dengan Unicode, spasi, atau awalan titik tetap didukung.
- Hapus meminta konfirmasi berisi jumlah item, contoh nama, path tujuan, dan pemberitahuan bahwa penghapusan VPS permanen. Hapus folder rekursif tidak mengikuti symlink dan tidak berjalan dengan shell `rm -rf` yang dibentuk dari input renderer.
- Root filesystem tidak dapat dihapus atau di-rename. Aksi terhadap item yang sedang ditransfer/diedit harus menolak dengan pesan yang jelas agar tidak berlomba dengan penulisan.
- Sukses memuat ulang panel terkait. Kegagalan sebagian pada banyak item ditampilkan per item, bukan dilaporkan sebagai sukses keseluruhan.

### Editor teks

- Buka file melalui path lengkap di panel VPS. Deteksi biner/UTF-8 tidak valid dan batas 1 MiB dilakukan di main process sebelum mengirim isi ke renderer.
- Ace menggunakan aset lokal, worker dinonaktifkan seperti editor Nginx, dan tema aplikasi. Pemilihan mode berdasarkan ekstensi adalah keputusan builder; minimal teks biasa, JSON, Markdown, shell, dan Nginx.
- Simpan menggunakan file sementara dan commit yang aman. Bandingkan versi sumber sebelum menulis (ukuran/mtime dan fingerprint isi bila diperlukan); jika file berubah di luar aplikasi, minta keputusan muat ulang atau timpa eksplisit. Tidak boleh menimpa perubahan eksternal diam-diam.
- Ctrl/Cmd+S menyimpan editor yang aktif. Menutup editor, membuka file lain, disconnect, atau menutup jendela saat dirty meminta keputusan simpan/buang/batal. Berpindah ke monitoring/terminal dapat mempertahankan buffer dirty tanpa memaksa penyimpanan.
- File yang diedit lewat file manager dapat termasuk konfigurasi Nginx. Penulisan atau operasi yang mengubah isi direktori Nginx yang dikonfigurasi harus membatalkan hasil `nginx -t` terdahulu; jangan meninggalkan tombol reload terbuka dengan validasi lama. File manager tidak otomatis reload layanan.

## Integrasi dan batas kepercayaan

Keadaan kode yang sudah diperiksa: `ssh.js` menyediakan `conn.sftp()` yang dicache; `sessions.js` menyimpan koneksi/terminal/monitor/operasi Nginx; `ipc.js` mengizinkan hanya senderFrame renderer lokal; preload tidak memberikan Node atau ipcRenderer mentah; Ace sudah tersedia dan editor Nginx terikat pada asumsi direktori/nama berkas Nginx.

- Tambahkan modul operasi file dan transfer terpisah dari `nginx.js`; validasi Nginx saat ini terlalu sempit untuk file umum, dan fallback sudo-nya tidak boleh dipakai untuk file manager.
- Main process melakukan seluruh filesystem lokal, SFTP, traversal, penulisan, dan lifecycle transfer. Renderer hanya mengirim operasi sempit yang divalidasi, menampilkan metadata/progres, serta mengirim isi editor yang dibatasi.
- Panel lokal memakai grant folder hasil dialog native, terikat webContents. Enumerasi/baca/upload/download tidak menerima sembarang path dari renderer sebagai izin. Validasi containment menggunakan canonical path dan pengecekan symlink sebelum akses, termasuk saat menulis tujuan yang belum ada.
- Drop file/folder dari OS diselesaikan melalui API Electron yang sesuai di preload dan diverifikasi main. String path yang dikirim renderer saja tidak boleh menciptakan grant. Bila sumber drop tidak dapat diverifikasi, minta pemilihan ulang melalui dialog sistem.
- Metadata/nama dan pesan server dirender dengan textContent. Jangan menjalankan nama file/path dalam shell. Respons error tidak memuat stack, password, atau isi file.
- Kanal transfer memakai whitelist operasi dan pemeriksaan senderFrame yang sama dengan fitur lain. Progress dibatasi frekuensinya; listener dibersihkan ketika view/window ditutup, tanpa memutus transfer hanya karena view berpindah.
- Membatalkan file manager tidak menutup transport SSH atau channel SFTP bersama yang masih dipakai Nginx. Hanya handle/stream pekerjaan yang dibatalkan. Disconnect sesi menutup semua pekerjaan, terminal, dan SSH dalam urutan yang terkontrol.
- File manager tidak merekam isi file, kredensial, maupun buffer editor ke log. Preferensi tampilan boleh disimpan lokal; grants dan antrean aktif tidak dipulihkan sebagai izin permanen tanpa persetujuan user.

## Tidak termasuk versi pertama

FTP/FTPS terpisah, multi-server serentak, sinkronisasi otomatis, resume byte-offset, antrean persisten setelah restart aplikasi, chmod/chown UI, sudo file manager, kompresi/ekstraksi remote, preview multimedia, pencarian seluruh filesystem, dan CRUD terhadap file lokal di luar proses download.

## Pembuktian yang diperlukan saat implementasi

- Tes operasi SFTP dan transfer terhadap server SSH fixture: rekursi, folder/file kosong, Unicode, file tersembunyi, pilihan banyak, konfliknya, bytes hasil transfer, dan stream besar dengan memori terkendali.
- Tes keamanan path lokal/remote, entri berbahaya, symlink/lintasan keluar grant, konflik nama lintas platform, symlink loop, perlindungan root, dan pengirim IPC tidak sah.
- Tes kegagalan/cancel saat scan, tengah stream, dan commit; file lama tetap utuh, partial file dilaporkan/bersih, dan hasil parsial ditampilkan benar. Uji server yang tidak memiliki atomic replace.
- Tes disconnect/reconnect ke profil sama/berbeda dan late event; terminal/monitor/Nginx tetap berfungsi saat pindah view atau membatalkan transfer.
- Tes editor untuk batas ukuran, biner/UTF-8, dirty prompt, perubahan eksternal, dan invalidasi hasil tes Nginx.
- Smoke UI Electron asli dengan dialog native fixture dan filesystem/SSH sementara: dua panel, file tersembunyi, cari/sort, transfer, operasi file, editor, tema terang/gelap, hide sidebar, viewport minimum, keyboard, dan tidak ada console error.
- Lint, build renderer, regresi yang relevan, serta installer macOS dan Windows. Pemeriksaan paket harus memastikan modul baru dan aset editor tercakup; laporkan platform yang belum diuji langsung.

## Diserahkan kepada builder

Pembagian modul/fungsi, representasi antrean dan grant, throttling progress yang tepat, batch traversal, mode Ace tambahan yang tidak memerlukan dependensi baru, serta detail dialog yang tidak mengubah perilaku di atas. Prioritaskan pemakaian pustaka `ssh2`, Electron, dan Ace yang sudah ada. Tidak perlu menambah server web/backend baru untuk file manager.
