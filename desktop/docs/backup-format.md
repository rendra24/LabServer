# Format backup LabServer versi 1

Ekstensi `.lsb` berisi JSON UTF-8. File `.labserver` dari versi sebelumnya memakai format yang sama dan tetap didukung saat restore. Nama default backup adalah `LabServer-YYYYMMDD.lsb`. Format ini tidak memerlukan akun LabServer, koneksi internet, atau kunci perangkat asal untuk didekripsi; hanya password backup pengguna.

| Field envelope | Nilai |
| --- | --- |
| `format` | `labserver-backup` |
| `version` | `1` |
| `cipher` | `aes-256-gcm` |
| `kdf` | `scrypt` |
| `salt` | 16 byte acak, Base64 standar dengan padding |
| `iv` | 12 byte acak, Base64 |
| `tag` | Tag autentikasi GCM 16 byte, Base64 |
| `data` | Ciphertext, Base64 |

Kunci 32 byte diturunkan dengan scrypt: password UTF-8 tanpa normalisasi, salt di envelope, `N=32768`, `r=8`, `p=1`. Implementasi Node menyediakan `maxmem=67108864` byte. AES-GCM memakai AAD UTF-8 persis `LabServer encrypted backup v1` (tanpa newline). Pembaca wajib memverifikasi tag sebelum menggunakan plaintext. Parameter KDF tetap untuk versi 1 dan tidak diterima dari file.

Plaintext adalah JSON `{format:"labserver-data", version:1, createdAt:<ISO timestamp>, servers:[...]}`. Setiap elemen `servers` berisi:

- `profile`: UUID `id`, `name`, `host`, `port`, `username`, `auth`, pengaturan `nginx` dan `prometheus`. `keyPath` untuk profil key hanyalah placeholder; pembaca tidak boleh menulis ke path tersebut.
- `credentials`: `password` dan/atau `passphrase`, bila disimpan pengguna. Keduanya berupa string UTF-8. Objek kosong berarti tidak ada kredensial tersimpan.
- `privateKey`: isi asli berkas private key sebagai Base64, wajib untuk profil `auth:"key"`.

Batas implementasi: 2.000 server; plaintext maksimal 16 MiB; berkas maksimal 24 MiB; setiap private key maksimal 1 MiB; setiap kredensial maksimal 64 KiB. Password backup minimal 12 karakter dan maksimal 1.024 byte UTF-8. Salt dan IV baru dipilih pada setiap ekspor. Tidak ada password backup maupun secret plaintext yang ditulis ke file sementara.

Restore divalidasi sepenuhnya sebelum perubahan lokal. Konflik ditentukan berdasarkan UUID, bukan nama atau alamat host. Mode `keep` melewati UUID yang sudah ada; `update` memperbarui UUID yang cocok tanpa menghapus server lain atau kredensial lokal yang tidak disertakan. Private key ditulis ke direktori baru milik aplikasi dengan izin privat; path dari file backup tidak dipakai. Kredensial dienkripsi ulang dengan enkripsi OS tujuan. Jika enkripsi OS tidak tersedia, impor yang memerlukan penyimpanan kredensial dibatalkan.

`restore-journal.json` di direktori data lokal hanya memuat profil sebelumnya dan ciphertext secret OS sebelumnya, bukan password backup/plaintext secret. Jurnal dihapus setelah commit berhasil; startup memulihkan data sebelumnya bila jurnal tersisa karena proses terhenti. File backup portabel terpisah dari jurnal ini.

Fingerprint SSH, file konfigurasi di VPS, log terminal, dan preferensi UI tidak disertakan. Implementasi referensi: `src/main/backup.js` dan `src/main/store.js`.

Payload versi 1 kini dapat memuat field opsional `cloudflare:[{id,memo,token}]`, maksimal 2.000 akun. `id` berupa UUID, memo maksimal 64 karakter dan token string API Token Cloudflare. Seluruh field berada di dalam ciphertext AES-GCM; tidak ada token plaintext pada envelope atau jurnal restore. Backup tanpa field ini tetap valid dan tidak menghapus akun Cloudflare lokal saat dipulihkan. Konflik Cloudflare juga ditentukan berdasarkan UUID dan mengikuti mode `keep`/`update`. Restore mengenkripsi ulang token menggunakan OS tujuan dan jurnal atomik mencakup `servers.json`, `secrets.json`, serta `cloudflare.json`. Snapshot record DNS tidak disertakan. Untuk memulihkan akun Cloudflare, gunakan LabServer versi yang mendukung DNS Management.

Profil server dapat memuat field opsional `tunnels:[{id,name,localPort,remoteHost,remotePort}]`. Maksimal 32 profil tunnel per server; ID UUID dan localPort unik dalam server yang sama. Label maksimal 64 karakter, localPort 1024–65535, remoteHost hostname/IP, remotePort 1–65535. Bind lokal selalu 127.0.0.1; tidak ada bind host/runtime state/traffic/password aplikasi tujuan dalam payload. Field ini berada dalam ciphertext envelope versi 1 yang sama. Backup tanpa field tunnels tetap valid; update profil dari backup lama mempertahankan tunnel lokal jika field tersebut tidak ada, sedangkan `tunnels:[]` mengosongkannya. Mode keep mempertahankan seluruh profil server yang sudah ada. Restore tidak mengaktifkan listener. Pembaca LabServer versi lama tidak mempertahankan field ini; gunakan versi yang mendukung Port Forwarding untuk backup/restore tunnel.
