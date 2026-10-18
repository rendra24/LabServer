# Docker Manager dan SSL Manager untuk LabServer

Status: **disetujui pengguna pada 18 Oktober 2026**, termasuk Let’s Encrypt + Certbot. Builder check independen selesai dengan hasil **nothing important left**.

## Tujuan dan konteks

Pengguna meminta melanjutkan poin 3 dan 5 dari rekomendasi sebelumnya: Docker Manager (container, resource, log, restart, terminal container) serta SSL Manager (masa berlaku, pemasangan dan perpanjangan sertifikat Nginx). Implementasi dilakukan berurutan: Docker, lalu SSL. Ini melengkapi monitoring, terminal multi-tab, SFTP, Service Manager, Log Viewer, Nginx, DNS Cloudflare dan backup yang sudah ada.

Keduanya menjadi **tab di workspace server yang terhubung**, bukan menu global satu level dengan Server/DNS. Monitoring tetap halaman awal setelah koneksi. Tab dapat digeser horizontal pada lebar minimum 900 px; hide sidebar dan tema terang/gelap tetap berlaku.

Pengguna baru meminta audit delay mengetik: belum ada akar masalah terkonfirmasi pada VPS. Pekerjaan fitur ini tidak mencampur optimasi transport terminal yang belum terverifikasi; jalur input/ack/backpressure terminal tetap dipakai.

## Pilihan perancang yang perlu ditinjau

- Gunakan SSH, Electron, ssh2, xterm dan komponen yang sudah ada; tanpa agent atau dependensi aplikasi baru.
- Docker versi pertama mengelola Docker Engine lokal dengan socket standar `/var/run/docker.sock`. Tidak mengikuti context/DOCKER_HOST yang menunjuk daemon lain. Rootless socket khusus, Docker remote, Podman, Kubernetes, Compose/deploy, penghapusan container/image/volume dan pembuatan container tidak termasuk versi ini.
- SSL versi pertama memakai **Let's Encrypt + Certbot dengan plugin Nginx**, melalui HTTP-01. Ini usulan perancang, bukan pilihan SSL yang telah dikonfirmasi pengguna. Sertifikat yang dikelola Certbot dapat dilihat dan diperpanjang. Import sertifikat manual/Cloudflare Origin, wildcard/DNS-01, pencabutan/penghapusan sertifikat, Apache dan Nginx di dalam container tidak termasuk versi pertama.
- Docker/Certbot belum terpasang ditampilkan sebagai keadaan kosong dengan panduan. Paket tidak dipasang diam-diam. Panduan SSL Ubuntu/Debian menyediakan salin command pemasangan Certbot + plugin Nginx; Docker menautkan panduan resmi instalasi sesuai OS.

## Docker Manager

Halaman menampilkan jumlah container/running/stopped, pencarian nama/image, filter status dan tabel container. Kolom utama: nama, image, status/health, port, CPU dan penggunaan/batas RAM. Data resource merupakan cuplikan Docker stats; container berhenti menampilkan resource tidak tersedia. Daftar dipaginasi 100 entri agar tidak membuat ribuan node DOM sekaligus.

Pengguna memilih satu container; toolbar menyediakan **Start**, **Stop**, **Restart**, **Log** dan **Terminal**. Tindakan yang tidak sesuai status dinonaktifkan. Start/Stop/Restart selalu meminta konfirmasi native dengan nama, ID dan server; Stop/Restart menjelaskan proses/koneksi aplikasi dapat terputus. Setelah selesai, status aktual dimuat ulang. Kegagalan membaca status setelah tindakan tidak dilaporkan seolah tindakan belum dijalankan.

Daftar/resource default dimuat manual. Refresh otomatis opsional setiap 5 detik, dijadwalkan setelah pembacaan sebelumnya selesai, berhenti saat navigasi/kesalahan. Tampilan tidak mencampur hasil server atau seleksi sebelumnya. Detail container tidak menampilkan environment variables, token, atau keseluruhan hasil inspect.

**Log** membuka modal dengan identitas container, pilihan 100/300/500/1000 baris terakhir, pencarian dalam cuplikan dan refresh manual/opsional 3 detik. stdout/stderr ditampilkan sebagai teks, bukan HTML. Penutupan modal/navigasi membatalkan pembacaan dan polling.

**Terminal** membuka tab baru dalam halaman Terminal yang sudah ada, berlabel container. Pengguna memilih `/bin/sh` atau `/bin/bash`; default `/bin/sh`. Command menjalankan `docker exec -it` melalui SSH exec dengan PTY, bukan shell lokal atau shell command bebas dari renderer. Jika shell tersebut tidak tersedia, tab menampilkan kegagalan yang jelas; tidak otomatis mengulang command ke container lain. Batas 8 tab mencakup shell host dan container. Input, resize, Ctrl+C, fullscreen, penutupan satu tab dan disconnect mengikuti perilaku terminal yang ada.

Akses Docker mengikuti akun SSH. Opsi **Gunakan sudo** tersedia untuk daemon yang tidak bisa diakses langsung, tanpa mengubah grup/izin socket. Operasi noninteraktif memakai mekanisme prompt sudo yang diantrekan dan password dalam stdin/memori sesi. Untuk terminal container dengan sudo, sudo berjalan pada PTY dan meminta password di terminal secara normal; aplikasi tidak mengirim password cache ke PTY atau mencatat inputnya. Pengguna root tidak perlu sudo.

Main menerima ID container penuh 64 hex, bukan nama/argumen command bebas. Pemilihan container diambil dari hasil daemon; sebelum tindakan, identitas/status diperiksa lagi. CLI menggunakan endpoint socket lokal yang ditetapkan perancang di atas, terlepas dari environment/context pengguna.

## SSL Manager

Daftar menampilkan nama sertifikat Certbot, domain/SAN, tanggal kedaluwarsa, sisa hari dan status **Aktif**, **Segera kedaluwarsa** (30 hari atau kurang), **Kedaluwarsa**, atau **Tidak diketahui**. Informasi berasal dari VPS, tidak dari sertifikat edge Cloudflare. Nilai tanggal yang tidak dapat diparse tidak boleh dianggap valid. Nama sertifikat yang tidak didukung validasi aplikasi tetap dapat ditampilkan, dengan tindakan dinonaktifkan dan alasan.

**Pasang SSL** membuka formulir domain (bisa beberapa domain eksplisit), email Let's Encrypt dan pilihan redirect HTTP→HTTPS (default aktif, terlihat sebelum konfirmasi). Form menjelaskan domain harus melayani vhost Nginx pada VPS dan HTTP challenge harus dapat dijangkau melalui port 80. Wildcard tidak diterima pada alur HTTP-01 ini. Email tidak disimpan sebagai kredensial aplikasi. Persetujuan syarat Let's Encrypt memakai checkbox yang tidak dicentang otomatis dan tautan syarat resmi.

Setelah validasi, pengguna meninjau domain, server dan pilihan redirect, lalu mengonfirmasi tindakan native. Main menjalankan pemeriksaan sintaks Nginx sebelum Certbot, dan memeriksa konfigurasi lagi setelahnya. Certbot plugin mengurus challenge, pemasangan sertifikat, perubahan konfigurasi dan reload Nginx. Path binary memakai profil Nginx yang sudah ada; root konfigurasi ditemukan dari `nginx -V --conf-path` dan diteruskan ke plugin. Jika root tidak dapat ditemukan dengan aman, tindakan ditolak dengan panduan, bukan menebak lokasi konfigurasi lain.

Nama sertifikat baru diturunkan dari domain pertama. Sertifikat yang sudah ada dengan nama itu dan cakupan domain berbeda tidak boleh ditimpa/dikurangi diam-diam. Jika cakupannya sama, gunakan sertifikat yang masih berlaku melalui opsi keep-until-expiring. Hasil yang gagal menjelaskan bahwa Certbot dapat sudah membuat perubahan sebagian dan meminta pengguna memeriksa konfigurasi; aplikasi tidak menjanjikan rollback penuh atau menjalankan retry otomatis.

**Perpanjang** berlaku untuk sertifikat terpilih, memakai renewal config Certbot yang sudah tersimpan di VPS, tanpa force-renewal. Konfirmasi native menyebut sertifikat/server. Sertifikat yang belum memasuki window renewal dapat dilewati Certbot; UI menjelaskan hasil itu, bukan mengklaim sudah menerbitkan sertifikat baru. Daftar/masa berlaku dimuat ulang setelah selesai. Penjadwalan renewal otomatis mengikuti mekanisme Certbot pada server; versi ini tidak membuat scheduler dari aplikasi desktop atau menjamin timer/cron server sudah aktif.

Sertifikat/private key tetap berada di VPS; private key tidak dibaca/dikirim ke renderer atau dimasukkan backup aplikasi. Informasi domain/tanggal dan nama sertifikat dirender sebagai teks. Tindakan SSL memerlukan hak root/sudo sesuai server; password hanya berada dalam memori sesi.

## Integrasi dan perlindungan perubahan

- Setiap request terikat sender, server ID dan instance SSH. Request lama setelah reconnect tidak boleh bertindak pada sesi baru atau menimpa UI baru. Validasi/quoting berada di main, bukan hanya form.
- Mutasi Docker diserialkan per container; operasi SSL diserialkan per server dan berbagi lock dengan mutasi konfigurasi Nginx dari aplikasi. Tidak ada command execution generik di API baru.
- Navigasi dari editor Nginx menghormati konfirmasi perubahan belum disimpan. Mulai pemasangan/renew SSL juga memeriksa editor file: perubahan belum disimpan harus diselesaikan dulu.
- Untuk versi pertama, SSL tidak boleh dimulai saat ada transfer aktif atau file mutation aktif pada workspace. Selama SSL berjalan, mutasi Nginx, transfer baru/retry dan mutasi file remote ditolak sementara dengan status **SSL sedang diproses**. Pembacaan dan terminal lain tetap tersedia. Pilihan konservatif ini merupakan keputusan perancang untuk menghindari benturan konfigurasi tanpa merombak sistem lock file yang ada.
- Selesai atau gagalnya operasi SSL membatalkan hasil tes sintaks Nginx lama. Buffer file yang sudah terbuka memakai pemeriksaan revision saat save sehingga tidak menimpa perubahan Certbot diam-diam.
- Navigasi membatalkan pembacaan, bukan tindakan yang sudah dikonfirmasi. Disconnect/window close ketika tindakan Docker/SSL berjalan meminta konfirmasi khusus; membatalkannya mempertahankan sesi. Mengakhiri channel/SSH tidak menjamin proses remote sudah dibatalkan atau perubahan di-rollback.
- Timeout/output cap awal: daftar/detail/stats 1 MiB/20 detik, log 512 KiB/15 detik, tindakan Docker 90 detik, tindakan Certbot 300 detik/1 MiB. Batas/missing tool/permission/daemon offline diterjemahkan menjadi pesan yang jelas; tidak ada retry mutasi otomatis.
- Tetap pertahankan namespace data/Keychain, backup `.lsb`, DNS global dan sesi terminal yang ada. Fitur baru tidak memerlukan migrasi format backup.

## Kriteria selesai

1. Dua tab hanya tersedia setelah server terhubung; tema terang/gelap dan lebar 900 px diverifikasi.
2. Docker: daftar/status/resource, search/filter, konfirmasi batal/setuju, log, terminal PTY, sudo, shell tidak tersedia dan daemon tidak tersedia diuji.
3. SSL: parse sertifikat/tanggal, validasi domain/email/persetujuan, install/renew, sertifikat belum waktunya renew, preflight Nginx gagal, Certbot gagal, konflik editor/transfer, tidak ada private key pada API, dan invalidasi sintaks diuji.
4. Payload command/option injection, timeout/output flood, pembatalan read, sender ownership, reconnect/dispose dan late sudo answers diuji di main/IPC.
5. Alur Electron/preload/SSH nyata memakai fixture lokal; tidak memasang Docker/Certbot atau menerbitkan SSL pada VPS pengguna saat pengembangan. Pengujian live ACME/daemon dinyatakan terpisah dari fixture.
6. npm test, lint, renderer build dan UI smoke lulus, dokumentasi serta screenshot diperbarui. ARM DMG dibangun ulang dan signature/integritas/isi sumber diverifikasi; status ad-hoc/notarization dilaporkan apa adanya.

## Diserahkan ke builder

Pembagian modul baru, penggunaan kembali bounded remoteCommand dan prompt sudo, bentuk hasil API, detail pagination, ikon, implementasi lock serta fixture ditentukan builder mengikuti pola yang ada. Hindari refactor umum yang tidak diperlukan fitur ini. Baca dokumen Docker/Certbot primer untuk flag sesuai versi yang didukung; jelaskan kompatibilitas yang tidak tersedia dengan pesan, bukan menjalankan fallback command bebas.

Referensi primer yang telah diperiksa: [Docker ps](https://docs.docker.com/reference/cli/docker/container/ls/), [Docker stats](https://docs.docker.com/reference/cli/docker/container/stats/), [Certbot Nginx](https://eff-certbot.readthedocs.io/en/stable/using.html#nginx), [Certbot renewal](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates).
