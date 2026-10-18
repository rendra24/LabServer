# LabServer — Panduan lengkap

Ruang kerja server melalui SSH: monitoring, terminal, file manager SFTP, layanan systemd, log, Docker, SSL Nginx, dan konfigurasi Nginx, ditambah DNS Cloudflare. Spesifikasi awal: [`PRD.md`](PRD.md), tugas: [`TASKS.md`](TASKS.md).

```bash
npm install          # Node >= 20
npm start            # jalankan aplikasi
npm test             # unit + tes SSH dengan server in-process
npm run lint
npm run test:ui      # tes renderer Electron dengan fixture lokal
npm run css          # bangun ulang Tailwind (butuh tailwindcss CLI)
```

## Tampilan LabServer

Setelah koneksi VPS berhasil, aplikasi langsung membuka **Dashboard monitoring**. Sidebar menyediakan menu global **Server** dan **DNS Management**. Setelah terhubung, identitas VPS dan tab **Monitoring**, **Terminal**, **File manager**, **Service Manager**, **Log Viewer**, **Docker Manager**, **SSL Manager**, **Port Forwarding**, serta **Konfigurasi Nginx** tampil di area kerja server aktif. Tombol **Putus koneksi** mengakhiri sesi SSH dan kembali ke daftar server, dengan konfirmasi jika ada perubahan yang belum disimpan. Tab server dapat dibuka bergantian tanpa memutus koneksi. Jika Prometheus belum tersedia, dashboard menampilkan pesan dan tab lainnya tetap dapat diakses.

Daftar server mendukung pencarian nama/host/username (Cmd/Ctrl+K), tampilan kartu atau daftar, serta hasil tes koneksi. Tema **Terang** / **Gelap** tersedia di bawah sidebar, mengikuti tema sistem pada sesi pertama dan menyimpan pilihan berikutnya. Editor Ace mengikuti tema aplikasi.

Tombol sidebar di kiri breadcrumb menyembunyikan/menampilkan navigasi agar ruang kerja lebih luas. Pilihan ini tersimpan saat aplikasi dibuka kembali.

Logo aplikasi ada di `src/renderer/assets/labserver-logo.png`; ikon installer ada di `build/icon.icns` dan `build/icon.ico`. Detail identitas dan preview: [docs/design/BRAND.md](design/BRAND.md).

`npm start` adalah mode pengembangan yang menjalankan binary `Electron.app`. Logo Dock, menu, dan panel Tentang memakai LabServer, tetapi nama bundle di OS tetap Electron. Untuk identitas OS lengkap (Finder, Dock, dan App Switcher), jalankan hasil build `dist/mac-arm64/LabServer.app` atau instal DMG/EXE LabServer. Installer Dashboard Server yang lama tidak memuat perubahan terbaru.

Ikon dan metadata EXE Windows tetap ditulis meskipun code signing dinonaktifkan (`signExecutable: false`). Jangan memakai `signAndEditExecutable: false`, karena itu juga melewati penulisan ikon dan nama produk.

`npm run test:ui` membuka renderer asli melalui preload yang disandbox dan IPC fixture. Tes menjalankan server SSH sementara di localhost untuk terminal, tanpa menghubungi VPS atau memakai data pengguna. Untuk menyimpan screenshot, jalankan `LABSERVER_SCREENSHOTS=/path/output npm run test:ui`.

## Backup dan restore data

Pada halaman **Server**, pilih **Backup & restore** → **Buat backup**. Tentukan password minimal 12 karakter, ulangi password, lalu pilih lokasi file `.lsb` (contoh: `LabServer-20261017.lsb`). Backup berisi profil server (termasuk pengaturan Nginx/Prometheus), password/passphrase yang sudah disimpan, serta isi private key yang dirujuk profil SSH. Private key yang tidak bisa dibaca atau kredensial yang tidak bisa didekripsi membatalkan ekspor; aplikasi tidak membuat backup parsial diam-diam. File `.labserver` dari versi sebelumnya tetap dapat dipulihkan.

Untuk memulihkan, pilih **Pulihkan backup**, masukkan password backup, lalu pilih file. Ringkasan menampilkan jumlah server, kredensial, private key, dan konflik ID. Secara default server dengan ID yang sudah ada dilewati. Pilihan **Perbarui server dan kredensial dari backup** mengganti profil yang ID-nya cocok dan menambahkan yang belum ada. Server lain serta kredensial lokal yang tidak tersedia di backup tetap dipertahankan. Putuskan koneksi VPS sebelum restore.

Kredensial dienkripsi ulang menggunakan penyimpanan aman OS perangkat tujuan. Private key dipulihkan ke folder privat `restored-keys` dalam direktori data LabServer, tanpa menggunakan path perangkat asal. Fingerprint host tidak dipindahkan: pada perangkat baru, verifikasi ulang fingerprint saat koneksi pertama. File di VPS, riwayat terminal, dan pilihan tampilan tidak termasuk backup.

Password/passphrase tersimpan **tidak dihapus ketika autentikasi gagal**. Login berikutnya tetap dapat meminta input pengganti; kredensial lama hanya diganti bila login dengan kredensial baru berhasil dan **Ingat di perangkat ini** dipilih, atau dihapus bersama profil oleh pengguna.

Backup bersifat manual. Simpan file di tempat lain dari perangkat sumber dan password di tempat terpisah. Password backup tidak disimpan oleh LabServer dan tidak dapat dipulihkan. File memakai AES-256-GCM dengan kunci scrypt; perubahan file atau password salah ditolak sebelum data lokal ditulis. Restore memakai jurnal rollback dengan kredensial terenkripsi OS untuk menjaga konsistensi profil dan kredensial jika proses terputus. Rincian format terbuka tersedia di [docs/backup-format.md](backup-format.md).

## Terminal SSH

Setelah VPS terhubung, pilih tab **Terminal** di area server aktif. Tombol **+** di bagian atas membuka shell interaktif baru pada koneksi SSH yang sama, hingga **8 tab per VPS**. Setiap tab memiliki shell, proses, direktori kerja, dan riwayat layar sendiri. Pilih tab untuk berpindah sesi; tombol **×** menutup tab tersebut setelah konfirmasi jika shell masih aktif. Menutup tab terakhir menampilkan keadaan kosong dan tombol + tetap tersedia. Alamat server ditampilkan langsung pada kartu **SSH shell - user@host:port**, tanpa judul halaman tambahan.

Terminal mendukung warna ANSI, scrollback 5.000 baris per tab, input Unicode, Tab/autocomplete, panah/riwayat shell, Ctrl+C, dan program interaktif yang tersedia di server. Ukuran PTY mengikuti jendela, hide/show sidebar, dan tab aktif. Gunakan Cmd+C/Cmd+V di macOS atau perintah Copy/Paste pada menu Edit untuk clipboard. Shift+Tab mengembalikan fokus ke toolbar; tombol panah kiri/kanan serta Home/End pada daftar tab memindahkan pilihan tab.

Semua shell dan riwayat layar tetap hidup saat berpindah tab, dashboard, atau konfigurasi Nginx. **Tutup terminal** menutup shell tab aktif dan mempertahankan layar; **Buka ulang** membuat shell baru dalam tab tersebut. Tab lain tetap berjalan. Disconnect VPS atau menutup jendela aplikasi mengakhiri seluruh shell. Proses yang perlu bertahan setelah disconnect sebaiknya dijalankan dalam tmux/screen di server.

Tombol **Fullscreen** di toolbar menampilkan terminal memenuhi layar dan menyesuaikan ukuran PTY tanpa membuka sesi baru. Gunakan **Keluar fullscreen** atau Esc untuk kembali ke tampilan biasa.

Tab hanya berlaku pada VPS yang sedang terhubung; split pane dan pemulihan tab setelah restart belum tersedia. Server dapat membatasi jumlah channel SSH lebih kecil dari batas aplikasi; kegagalan membuka shell ditampilkan pada tab terkait. Terminal tidak merekam input maupun output ke berkas. Input dibatasi 1 MB per tab dalam antrean dan dikirim bertahap; output memakai acknowledgement per sesi untuk menahan log deras sebelum membanjiri renderer.

xterm.js dan addon-fit disalin sebagai aset lokal. CSP tetap melarang script inline/eval dan sumber jaringan; `style-src-elem` mengizinkan stylesheet dinamis xterm untuk warna, font, cursor, dan ukuran sel. Tidak ada akses Node dari renderer.

Tes terminal: `node --test test/terminal.test.js test/terminal-ssh.test.js` (tes SSH memerlukan izin membuka port localhost). Preview: [tab gelap](design/labserver-terminal-tabs-dark.png) / [tab terang](design/labserver-terminal-tabs-light.png), dengan server uji.

## File manager SFTP

Hubungkan VPS lalu pilih **File manager**. Panel kiri menampilkan komputer lokal, panel kanan menampilkan VPS mulai dari home akun SSH. Pilih **Pilih folder** untuk memberikan akses ke satu folder lokal; navigasi lokal tetap berada di dalam folder tersebut. Panel VPS dapat menavigasi path yang diizinkan akun SSH. SFTP memakai sesi yang sama dengan terminal dan monitoring.

Pilih beberapa item melalui checkbox, lalu **Upload pilihan** atau **Download**. Tombol **Upload** juga dapat memilih file/folder lewat dialog sistem; drag & drop dari Finder/Explorer dapat dipakai untuk upload. Folder disalin rekursif, termasuk file tersembunyi dan folder kosong. Toggle file tersembunyi hanya memengaruhi daftar. Pencarian berlaku pada folder saat ini; pengurutan tersedia menurut nama, ukuran, atau waktu. **Detail** menampilkan ukuran, waktu, izin, UID/GID, dan target symlink. Symlink dan file khusus dilewati saat transfer rekursif dan dilaporkan.

Antrean menjalankan dua pekerjaan bersamaan, menampilkan progres file aktif, kecepatan, serta jumlah selesai/dilewati/gagal. Antrean tetap berjalan saat berpindah halaman. Konflik file meminta **Lewati**, **Nama baru**, atau **Timpa**; direktori yang namanya sama digabung. File ditulis ke `.labserver-….part` terlebih dahulu dan dikomit setelah selesai. File lama dipertahankan jika transfer gagal. Server tanpa dukungan atomic replace menolak overwrite dengan pesan jelas. **Batal** menghentikan pekerjaan dan membersihkan file sementara yang dapat diverifikasi; file lengkap yang sudah selesai tetap ada. Rincian antrean menunjukkan file sementara yang tidak dapat dibersihkan.

Di panel VPS tersedia **Folder baru**, **Ganti nama**, dan **Hapus**. Penghapusan meminta konfirmasi dan bersifat permanen. File yang sedang ditransfer atau diedit dilindungi dari operasi yang bertabrakan. Semua operasi mengikuti izin akun SSH; file manager tidak memakai sudo atau mengubah izin/ownership melalui UI. Perubahan dalam direktori Nginx membatalkan hasil tes sintaks sebelumnya dan tidak otomatis reload layanan.

Pilih file VPS lalu **Edit**, atau klik dua kali. Editor menerima teks UTF-8 maksimal **1 MiB**, mendukung Cmd/Ctrl+S, dan mempertahankan buffer saat diminimalkan atau berpindah halaman. Jika file berubah di server, pengguna memilih muat ulang atau timpa secara eksplisit. Menutup editor, disconnect, dan menutup jendela menawarkan simpan/buang/batal untuk perubahan yang belum disimpan. File besar dan biner tetap dapat ditransfer.

**Coba lagi** memulai ulang pekerjaan setelah validasi ulang; tidak ada resume dari byte terakhir, sinkronisasi, atau antrean persisten setelah aplikasi ditutup. Batas versi ini: 1.000 pekerjaan per sesi, 10.000 entri per folder, dan kedalaman 128 folder. Profil/kredensial tetap tersimpan seperti sebelumnya; pilihan folder lokal perlu diberikan lagi setelah aplikasi dibuka ulang.

Preview: [dua panel gelap](design/labserver-files-dark.png), [terang](design/labserver-files-light.png), dan [editor](design/labserver-files-editor-dark.png). Tes SFTP memakai filesystem dan server SSH sementara tanpa menghubungi VPS pengguna.

## Service Manager dan Log Viewer

Pada VPS yang sudah terhubung, buka **Service Manager** untuk melihat layanan systemd yang aktif, gagal, atau tidak aktif. Cari nama/deskripsi, filter status, lalu pilih satu layanan untuk **Start**, **Stop**, atau **Restart**. Setiap tindakan meminta konfirmasi sistem dengan identitas server dan layanan. **Detail** menampilkan status, PID, penggunaan memori, startup, dan lokasi unit; **Lihat log** membuka jurnal layanan tersebut. Template unit yang belum memiliki instance tidak dapat dijalankan melalui UI.

**Log Viewer** membaca jurnal systemd, log akses/error Nginx di `/var/log/nginx/`, atau file aplikasi dengan path absolut. Pilih 100, 300, 500, atau 1.000 baris terakhir. Pencarian berlaku pada baris yang ditampilkan. Filter warning/error diterapkan oleh journalctl untuk jurnal dan secara lokal pada cuplikan file. **Refresh otomatis** mengambil cuplikan baru setiap 3 detik setelah pembacaan sebelumnya selesai; meninggalkan halaman atau terjadi kesalahan menghentikannya. File harus berupa file reguler yang dapat diakses akun SSH.

Layanan dan jurnal memerlukan server Linux dengan systemd; log file menggunakan `sh` dan `tail`. Tidak ada agent yang dipasang. Tindakan layanan memakai sudo bila akun bukan root; log memakai sudo hanya jika opsi tersebut dipilih. Password sudo hanya disimpan dalam memori sesi dan dialog password diantrekan per permintaan. Izin sudo tetap mengikuti konfigurasi server.

Pembacaan log dibatasi 512 KiB/15 detik, daftar/detail layanan 1 MiB/20 detik, dan tindakan layanan 60 detik. Batas output ditampilkan sebagai pemberitahuan. Navigasi membatalkan pembacaan yang masih berjalan. Tindakan layanan yang sudah dikonfirmasi dapat terus berjalan di server meskipun pengguna berpindah halaman atau koneksi berakhir; timeout tidak menjamin tindakan dibatalkan dan aplikasi tidak mengulanginya otomatis.

Preview: [layanan gelap](design/labserver-services-dark.png), [layanan terang](design/labserver-services-light.png), [log gelap](design/labserver-logs-dark.png), dan [log terang](design/labserver-logs-light.png). Tes memakai fixture melalui SSH lokal, tanpa menjalankan tindakan pada VPS pengguna.

## Docker Manager

Setelah VPS terhubung, pilih **Docker Manager**. Daftar menampilkan semua container, image, status/health, port, dan cuplikan CPU/RAM untuk container yang berjalan. Cari nama/image, filter status, lalu pilih container. **Start**, **Stop**, dan **Restart** meminta konfirmasi sistem dengan identitas server/container. Refresh otomatis opsional setiap 5 detik; meninggalkan halaman atau kegagalan menghentikannya.

**Log** menampilkan 100/300/500/1000 baris terakhir dengan pencarian lokal dan auto-refresh opsional 3 detik. Menutup modal atau berpindah halaman menghentikan pembacaan. Batas log 512 KiB/15 detik; daftar/detail/resource 1 MiB/20 detik. Tindakan memiliki timeout 90 detik dan tidak diulang otomatis.

**Terminal** membuka tab xterm untuk container terpilih, memakai `/bin/sh` atau `/bin/bash` melalui SSH exec dengan PTY. Shell harus tersedia dalam image; kegagalan tampil di tab tersebut. Tab host dan container dapat berjalan bersamaan, hingga total 8 tab per VPS, dengan resize, Ctrl+C, fullscreen dan penutupan independen.

Versi ini memakai Docker Engine lokal pada `/var/run/docker.sock` dan tidak mengikuti context/DOCKER_HOST yang menunjuk daemon lain. Jika akses ditolak, pilih **Gunakan sudo** sesuai izin akun SSH. Operasi noninteraktif menggunakan password dalam stdin/memori sesi. Terminal container dengan sudo meminta password langsung pada PTY, tanpa menyuntikkan password cache aplikasi. Aplikasi tidak mengubah grup user atau izin socket. Docker rootless dengan socket khusus, daemon remote, Compose/deploy, pembuatan/penghapusan container, image dan volume belum termasuk versi ini. Panduan di aplikasi menautkan [instalasi resmi Docker](https://docs.docker.com/engine/install/).

Preview: [Docker gelap](design/labserver-docker-dark.png), [terang](design/labserver-docker-light.png), [log](design/labserver-docker-logs-dark.png), dan [terminal container](design/labserver-container-terminal-dark.png).

## SSL Manager

Pilih **SSL Manager** untuk melihat sertifikat yang dikelola Certbot pada VPS: nama, domain/SAN, tanggal kedaluwarsa dan status aktif/segera kedaluwarsa (30 hari)/kedaluwarsa/tidak diketahui. Penanda sertifikat tidak valid dari Certbot dipertahankan: sertifikat staging ditampilkan sebagai **Tidak valid — Sertifikat uji (staging)** meskipun belum kedaluwarsa. Ini adalah metadata Certbot pada VPS, bukan pemeriksaan TLS endpoint atau sertifikat edge Cloudflare. Tanggal yang gagal dibaca tidak dianggap valid; nama/domain di luar dukungan aplikasi tetap terlihat dengan tindakan dinonaktifkan.

**Pasang SSL** menerima hingga 20 domain eksplisit dan email Let's Encrypt, dengan pilihan redirect HTTP→HTTPS yang terlihat sebelum konfirmasi. Centang persetujuan syarat Let's Encrypt secara eksplisit. Domain harus sesuai vhost Nginx dan HTTP challenge harus bisa dijangkau melalui port 80. LabServer memeriksa `nginx -t`, menemukan root konfigurasi dari `nginx -V --conf-path` menggunakan binary pada profil server, lalu menjalankan Certbot Nginx. Root yang tidak dapat ditemukan dengan aman ditolak. Nama file konfigurasi utama harus `nginx.conf`, sesuai parser Certbot; binary dengan `--conf-path` seperti `custom.conf` ditolak sebelum pemasangan agar file yang diperiksa sama dengan yang dikelola Certbot. [Plugin Certbot Nginx](https://eff-certbot.readthedocs.io/en/stable/using.html#nginx) mengurus penerbitan, pemasangan, perubahan konfigurasi dan reload; sintaks diperiksa lagi setelahnya.

Nama sertifikat diambil dari domain pertama. Sertifikat dengan nama yang sama tetapi cakupan domain berbeda tidak diganti/dikurangi diam-diam. Untuk cakupan yang sama, sertifikat yang belum perlu diperpanjang dipertahankan. **Perpanjang** memakai renewal config di VPS untuk sertifikat terpilih, tanpa force-renewal; UI menjelaskan bila belum memasuki window renewal. Penjadwalan otomatis mengikuti timer/cron Certbot pada server dan tidak dijalankan oleh aplikasi desktop. [Panduan renewal Certbot](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates).

Pemasangan/perpanjangan meminta konfirmasi sistem dan hak root/sudo. Selesaikan editor yang belum disimpan, operasi Nginx, serta transfer/file mutation sebelum memulai. Selama SSL diproses, mutasi file/transfer baru dan perubahan/restart Nginx dari aplikasi diblokir sementara. Pembacaan dan terminal lain tetap tersedia. Hasil tes sintaks lama dibatalkan saat Certbot mulai mengubah server.

Operasi Certbot dibatasi 300 detik/1 MiB. Navigasi hanya membatalkan pembacaan. Disconnect/window close saat tindakan berjalan meminta konfirmasi bahwa proses remote mungkin tetap berjalan. Timeout/kegagalan bukan jaminan rollback: konfigurasi atau sertifikat dapat sudah berubah sebagian; periksa Nginx dan log Certbot di VPS sebelum mencoba lagi. Private key tetap berada di VPS dan tidak dibaca/dikirim ke renderer atau ditambahkan ke backup aplikasi.

Panduan **SSL** menyediakan command Ubuntu/Debian untuk memasang `certbot python3-certbot-nginx` dan tombol salin. Paket tidak dipasang otomatis. Versi ini mencakup Let's Encrypt HTTP-01 pada Nginx host; import sertifikat manual/Cloudflare Origin, wildcard/DNS-01, pencabutan/penghapusan dan Nginx container belum didukung.

Preview: [SSL gelap](design/labserver-ssl-dark.png), [terang](design/labserver-ssl-light.png), [900px](design/labserver-ssl-900.png), dan [panduan](design/labserver-ssl-guide-dark.png). Pengujian Docker/Certbot memakai respons fixture melalui SSH lokal; Docker daemon/ACME live tidak dijalankan pada VPS pengguna. Bila host pengujian tidak bisa memfokuskan jendela macOS, `LABSERVER_UI_DOM_FULLSCREEN=1 npm run test:ui` mempertahankan pemeriksaan fullscreen DOM dan melaporkan transisi fullscreen native/Escape sebagai skipped. Secara default kedua pemeriksaan native tetap aktif.

## SSH Port Forwarding

Setelah server terhubung, pilih tab **Port Forwarding**. Tambahkan label, port lokal komputer (1024–65535), host tujuan dari VPS, dan port tujuan (1–65535). Contoh MySQL: lokal `127.0.0.1:3307` → VPS `127.0.0.1:3306`. Simpan profil, klik **Start**, lalu gunakan host `127.0.0.1` dan port `3307` pada aplikasi database. Password database tetap diisi di aplikasi database; LabServer hanya meneruskan TCP melalui sesi SSH yang ada.

Port lokal selalu bind `127.0.0.1` IPv4, sehingga tidak dibuka ke LAN. Host tujuan dapat berupa IP/hostname yang diakses dari VPS; untuk layanan pada VPS sendiri gunakan `127.0.0.1`. **Aktif** berarti listener lokal siap, bukan bukti bahwa database/layanan tujuan sehat. Tujuan baru dihubungi ketika klien tersambung; penolakan tujuan/izin SSH muncul sebagai pesan aman, sementara listener tetap tersedia. Port lokal yang sudah dipakai dapat diganti dengan mengedit profil saat tunnel berhenti.

Tersedia pencarian, jumlah koneksi aplikasi, **Salin alamat**, Start/Stop, Edit dan Hapus. Stop meminta konfirmasi dan menutup koneksi klien; Edit/Hapus dinonaktifkan selama tunnel aktif. Maksimal 32 profil tersimpan per server, 8 tunnel aktif per sesi SSH, 32 koneksi per tunnel dan 128 koneksi total per sesi (termasuk channel yang masih dibuka). Pembukaan channel dibatasi 15 detik. Channel yang belum dijawab SSH tetap dihitung dalam batas koneksi meskipun klien lokal timeout atau tunnel dihentikan; kapasitas kembali setelah SSH menjawab atau sesi dihubungkan ulang. Koneksi aktif tidak memakai idle timeout agar sesi database tetap dapat digunakan. Aliran TCP memakai backpressure dan mendukung half-close.

Tunnel tetap berjalan ketika berpindah tab. Disconnect, SSH terputus, reconnect, atau aplikasi benar-benar ditutup akan menutup semua listener/channel; close/disconnect meminta konfirmasi bila masih ada tunnel aktif. Profil tidak dihapus dan tidak auto-start ketika server dihubungkan kembali. Layanan dan izin TCP forwarding pada SSH server harus tersedia; LabServer tidak mengubah konfigurasi SSH/firewall/VPS. Versi ini mendukung local forwarding TCP; remote forwarding, SOCKS, UDP dan background daemon belum tersedia.

Profil tunnel disimpan bersama profil server dan ikut backup terenkripsi `.lsb`. Pratinjau backup menampilkan jumlah profil tunnel. Runtime state, koneksi, isi traffic dan kredensial aplikasi tujuan tidak disimpan. Backup lama tanpa pengaturan tunnel tetap dapat dipulihkan dan tidak menghapus tunnel lokal pada mode update; daftar kosong eksplisit mengosongkan konfigurasi. Restore tidak menjalankan tunnel. Gunakan LabServer versi ini atau lebih baru untuk mempertahankan field tunnel pada backup.

Pengujian memakai listener TCP dan server SSH loopback nyata, termasuk byte biner, half-close, timeout, port bentrok, batas koneksi, channel terlambat dan pembatalan close/disconnect. Tidak ada VPS pengguna yang diubah. Preview: [gelap](design/labserver-tunnels-dark.png), [terang](design/labserver-tunnels-light.png), [900px](design/labserver-tunnels-900.png).

## Mencoba tanpa VPS
```bash
node scripts/dev-ssh-server.js   # SSH palsu di 127.0.0.1:2222, user deploy, password pw-123
```
Key uji dibuat di `scripts/.dev-key` (passphrase `frasa-dev`) dan `scripts/.dev-key-plain` (tanpa passphrase). Server ini hanya untuk menguji koneksi/autentikasi; belum ada Nginx di baliknya.

Uji terhadap OpenSSH + Nginx sungguhan (container Docker Ubuntu dengan 3 model izin: `writer` grup-writable, `sudoer` NOPASSWD, `sudopw` sudo berpassword):
```bash
test/integration/setup-container.sh            # butuh Docker; mengunduh paket apt di container
SSHD_PORT=2223 NGINX_CONTAINER=dssshd npm test
```

Data aplikasi (profil server, fingerprint, secret terenkripsi) tetap memakai namespace `Dashboard Server`, termasuk folder `~/Library/Application Support/Dashboard Server/` di macOS dan identitas Keychain. App ID juga dipertahankan agar rebrand tidak memutus akses ke profil dan kredensial versi lama.

## Instalasi (pengguna)
Unduh dari Releases: macOS `LabServer-macOS-arm64.dmg` (Apple Silicon) atau `LabServer-macOS-x64.dmg` (Intel), Windows `LabServer Setup <versi>.exe`.

Aplikasi macOS memakai **signature ad-hoc yang valid**, tetapi belum memakai sertifikat Developer ID atau notarization Apple. Signature ini menjaga integritas bundle; Gatekeeper tetap dapat menolak aplikasi yang dikirim/diunduh di Mac lain.
- **macOS**: buka `.dmg`, seret ke Applications, lalu coba buka aplikasi. Jika macOS menawarkan **System Settings → Privacy & Security → Open Anyway**, gunakan persetujuan khusus aplikasi tersebut. Jika tetap diblokir, hanya untuk build yang berasal dari pengembang dan sudah diverifikasi: `xattr -dr com.apple.quarantine "/Applications/LabServer.app"`, kemudian buka lagi. Perintah ini hanya menghapus karantina aplikasi tersebut, bukan memperbaiki signature yang rusak.
- **Windows**: SmartScreen "Windows protected your PC" → More info → Run anyway.

DMG lama bernama `Dashboard Server-0.1.0-arm64.dmg` memiliki signature bundle tidak valid karena signing dilewati setelah packaging. Gunakan build LabServer yang baru. Jika muncul “is damaged and can't be opened”, periksa integritas file yang diterima dengan `hdiutil verify /path/file.dmg` dan signature aplikasi dengan `codesign --verify --deep --strict --verbose=2 "/Applications/LabServer.app"`. Apple Silicon memakai `arm64`; runtime Electron yang dibundel memerlukan macOS **13.0 atau lebih baru**, sehingga Sequoia 15.5 memenuhi versi minimum.

## Kebutuhan di server
Aplikasi hanya butuh SSH (tidak memasang apa pun di server). User SSH perlu salah satu:
1. **Izin tulis ke direktori Nginx** (disarankan, tulis langsung lewat SFTP): anggota grup yang memiliki `sites-available`/`sites-enabled`, ditambah sudo untuk `nginx -t` dan reload saja:
   ```
   deploy ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /bin/systemctl reload nginx
   ```
2. **sudo penuh** (NOPASSWD atau berpassword): berkas ditulis lewat `sudo`; password sudo diminta sekali per sesi dan hanya disimpan di memori.
3. Login sebagai `root` (tidak disarankan).

Cara reload dipilih per server (Lanjutan → Cara reload): `systemctl`, `service`, atau `nginx -s reload`. Path `sites-available`/`sites-enabled`/binary nginx juga bisa diubah per server.

## Keamanan singkat
- Fingerprint host key diminta persetujuan saat pertama connect; jika berubah, koneksi **diblokir** dan kredensial tidak dikirim.
- Password/passphrase hanya disimpan bila "Ingat" dicentang, terenkripsi Keychain (macOS) / DPAPI (Windows). Private key tidak disalin; hanya path-nya yang disimpan.
- Renderer disandbox tanpa akses Node; semua operasi lewat IPC sempit dengan validasi di proses utama; tanpa CDN.
- Reload selalu menjalankan `nginx -t` ulang di proses utama; sintaks rusak = reload ditolak.

## Monitoring (Prometheus)
Dashboard menyediakan tombol **Panduan install Prometheus** yang membuka tutorial singkat untuk Ubuntu/Debian, beserta **Salin command** untuk instalasi Prometheus + Node Exporter dan mengaktifkan layanannya. Panduan dasar memakai konfigurasi bawaan paket, tanpa meminta pengguna mengedit file konfigurasi. Setelah command dijalankan di VPS, pilih **Tes Prometheus** lalu **Muat Ulang**. Paket Node Exporter menyediakan metrik mesin ([paket resmi Ubuntu](https://packages.ubuntu.com/en/noble/prometheus-node-exporter)); metrik Nginx memakai exporter terpisah seperti panduan lanjutan di bawah.

Halaman **Monitoring** (tombol di daftar vhost) menampilkan CPU, memori, disk `/`, jaringan, load, uptime, dan metrik Nginx dari Prometheus di server, lewat **SSH tunnel** (tidak ada port yang dibuka). Prometheus sendirian hanya punya metrik dirinya; data host dan Nginx datang dari exporter, jadi di server perlu (contoh Ubuntu/Debian, versi yang diuji: Prometheus 2.45, node_exporter 1.7, nginx exporter 1.1):

```bash
sudo apt install prometheus prometheus-node-exporter prometheus-nginx-exporter
```
1. **Batasi ke loopback** (paket apt default membuka semua interface). Di `/etc/default/prometheus`, `/etc/default/prometheus-node-exporter`, `/etc/default/prometheus-nginx-exporter`, set `ARGS`:
   - Prometheus: `ARGS="--web.listen-address=127.0.0.1:9090"`
   - node_exporter: `ARGS="--web.listen-address=127.0.0.1:9100"`
   - nginx exporter: `ARGS="--nginx.scrape-uri=http://127.0.0.1:8082/stub_status --web.listen-address=127.0.0.1:9113"`
2. **Aktifkan `stub_status`** hanya untuk loopback (mis. `/etc/nginx/conf.d/stub.conf`):
   ```nginx
   server { listen 127.0.0.1:8082; location /stub_status { stub_status; allow 127.0.0.1; deny all; } }
   ```
3. **Scrape** di `/etc/prometheus/prometheus.yml`:
   ```yaml
   scrape_configs:
     - job_name: node
       static_configs: [{ targets: ["127.0.0.1:9100"] }]
     - job_name: nginx
       static_configs: [{ targets: ["127.0.0.1:9113"] }]
   ```
4. `sudo systemctl restart prometheus prometheus-node-exporter prometheus-nginx-exporter nginx`, lalu cek `curl -s 127.0.0.1:9090/api/v1/targets` (semua `up`).

Di aplikasi: hubungkan server → **Dashboard monitoring** terbuka otomatis → **Tes Prometheus** untuk melihat target. Menu **Konfigurasi Nginx** membuka pengelolaan vhost secara terpisah. Alamat Prometheus (default `127.0.0.1:9090`) dapat diubah di form server (Monitoring). Panel yang exporter-nya tidak ada ditandai "tidak tersedia", panel lain tetap jalan. Jika root `/` server bukan filesystem yang diekspor node_exporter (mis. `overlay`/di dalam container), panel Disk kosong.
Panel dan query bersifat tetap (tidak ada PromQL bebas). Rentang 15 menit–7 hari, auto-refresh 15 detik.

Tes end-to-end dengan Prometheus sungguhan: `test/integration/setup-monitoring.sh` lalu `SSHD_PORT=2223 PROM_CONTAINER=dssshd npm test`.

## Build installer
```bash
npm run dist:mac     # .dmg arm64 + x64 (dijalankan di macOS)
npm run dist:win     # .exe NSIS x64 (bisa cross-build dari macOS/Linux)
npm run verify:mac   # verifikasi signature final kedua bundle macOS
```
Build macOS menandatangani ulang bundle beserta komponen bersarang setelah packaging; `dist:mac` gagal jika verifikasi signature final tidak lolos. Untuk distribusi tanpa langkah manual Gatekeeper, gunakan sertifikat **Developer ID Application**, hardened runtime, notarization Apple, dan staple tiket. Konfigurasi default ad-hoc ini untuk pengujian/internal; saat membuat rilis resmi, override `mac.identity`, aktifkan `mac.hardenedRuntime` dan `mac.notarize`, serta berikan kredensial Apple melalui environment/Keychain, bukan repository atau percakapan.
CI: `.github/workflows/desktop.yml` menjalankan lint, tes, dan build `.dmg` di macOS; tag `desktop-v<versi>` membuat GitHub Release (lihat `RELEASING.md`).

## Batasan
- Belum ada Developer ID signing/notarisasi, auto-update, build Linux.
- Hapus berkas tersedia melalui File manager; daftar Konfigurasi Nginx belum memiliki tombol hapus tersendiri.
- Installer Windows dibangun lewat cross-build dari macOS dan **belum pernah dijalankan di Windows**.

## DNS Management — Cloudflare

**DNS Management** berada di sidebar sejajar dengan **Server** dan dapat digunakan tanpa koneksi VPS. Tambahkan akun dengan **memo / label** dan **API Token Cloudflare**. Aplikasi memverifikasi akses domain sebelum menyimpan token terenkripsi melalui penyimpanan OS. Token tersimpan tidak dikirim kembali ke renderer; biarkan kolom token kosong saat mengedit akun untuk mempertahankan token lama.

Di **Panduan API Token**, tersedia langkah pembuatan token dan tautan [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens). Gunakan template **Edit zone DNS**, dengan izin **Zone / DNS / Edit** dan **Zone / Zone / Read**, lalu batasi **Zone Resources** ke domain yang dikelola. Panduan mengikuti [dokumentasi resmi Cloudflare](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

Pilih akun dan domain untuk melihat, mencari, menambah, mengedit, atau menghapus record. Pembuatan/edit mendukung **A, AAAA, CNAME, TXT, MX, NS, SRV, CAA**, TTL, catatan, dan proxy untuk A/AAAA/CNAME. Tipe lain tetap ditampilkan; pengeditannya dilakukan melalui dashboard Cloudflare. Daftar DNS memakai pagination 100 record per halaman. Penghapusan memerlukan konfirmasi native; edit memeriksa `modified_on` terakhir untuk mendeteksi perubahan eksternal sebelum PATCH. API Cloudflare tidak menyediakan transaksi kondisional untuk celah waktu antara pemeriksaan dan penyimpanan.

Akun Cloudflare dan API Token ikut dalam backup `.lsb`, termasuk saat belum ada profil VPS. Restore lama tetap didukung; akun yang tidak disertakan tetap dipertahankan. Record DNS berada di Cloudflare dan tidak disalin ke backup. Saat membuka DNS dari VPS aktif, sesi SSH dan tab terminal tetap berjalan; menu Server mengembalikan ruang kerja VPS terakhir. Putuskan sesi dari ruang kerja VPS sebelum restore.

Tes memakai client/API fixture, penyimpanan dan IPC asli; tidak mengubah domain Cloudflare sungguhan.
