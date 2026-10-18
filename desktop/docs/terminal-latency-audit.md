# Audit latensi mengetik terminal — 18 Oktober 2026

Pengguna melaporkan huruf terlambat muncul saat mengetik melalui `npm start`; Termius/Terminal macOS lancar pada VPS yang sama. Ini mengarahkan investigasi pada perbedaan klien, tetapi belum membuktikan komponen penyebabnya.

## Hasil pengukuran

Audit memakai Electron 44.8.0/macOS arm64, renderer terminal aplikasi, preload yang disandbox, session manager, ssh2, dan server echo SSH sementara di loopback. Data aplikasi diisolasi dalam direktori sementara. Tidak ada profil/kredensial pengguna yang dimuat atau koneksi ke VPS pengguna. Server fixture memakai TCP_NODELAY; pengaturan klien mengikuti aplikasi, kecuali pada kasus A/B yang disebutkan.

Setiap kasus mengirim 80 karakter (560 sampel total). Echo dihitung dari event input xterm hingga callback parser setelah echo diterima. Render dihitung hingga event `onRender` berikutnya, bukan pengukuran presentasi piksel oleh compositor/layar. Input publik xterm menguji jalur onData yang sama; satu kasus tambahan memakai event keyboard native Electron. Semua kasus akhir terverifikasi visible/focused, dengan 80 echo dan 80 event render per kasus.

| Kondisi | Echo median / P95 (ms) | Render median / P95 (ms) |
| --- | --- | --- |
| 1 tab, pengaturan produksi | 0,8 / 1,6 | 9,4 / 17,3 |
| 1 tab, keyboard native | 0,9 / 2,6 | 8,2 / 17,7 |
| 1 tab, TCP_NODELAY aktif | 1,2 / 4,9 | 14,8 / 17,6 |
| 1 tab, screenReaderMode nonaktif | 0,8 / 1,4 | 9,4 / 16,7 |
| 1 tab, screenReaderMode dipulihkan | 0,7 / 3,6 | 9,2 / 17,0 |
| 8 tab, 7 idle | 0,6 / 2,8 | 7,2 / 17,3 |
| 8 tab, 7 stream background sekitar 0,9 MiB/dtk | 0,6 / 4,4 | 10,6 / 17,3 |

Tidak ada error renderer. `npm run lint` dan `git diff --check` lulus. Data: [terminal-latency-audit.json](terminal-latency-audit.json). Ulangi dengan `./node_modules/.bin/electron scripts/audit-terminal-latency.js` dari folder `desktop`; ini membuka jendela fixture dan hanya menggunakan port localhost.

Percobaan pendahuluan tanpa pelacakan visibility mengalami satu outlier scheduling/render beberapa detik. Outlier tidak muncul kembali setelah fokus/visibility dicatat. Penyebab outlier tidak dapat dipastikan; hasil itu tidak digunakan untuk menyimpulkan screenReaderMode sebagai penyebab. Benchmark singkat di loopback tidak merepresentasikan semua keadaan CPU, compositor, IME, atau jaringan WAN.

## Temuan kode dan hipotesis

1. **TCP_NODELAY belum diaktifkan — kandidat yang perlu diuji di WAN.** `src/main/ssh.js` membuat `ssh2.Client`, tetapi tidak memanggil `client.setNoDelay(true)`. ssh2 membuat `net.Socket` dengan pengaturan TCP bawaan. Node mendokumentasikan bahwa Nagle aktif secara default dan dapat menunda pengiriman paket kecil untuk throughput. Ini relevan dengan karakter yang dikirim satu per satu. Namun A/B loopback tidak menunjukkan keuntungan yang konsisten; belum terbukti sebagai penyebab keluhan pengguna.
2. **Antrean input menunggu callback write/IPC, bukan echo dari VPS.** `src/renderer/terminal.js` mengurutkan input per tab melalui Promise. `src/main/terminal.js` menyelesaikannya setelah callback channel.write; tidak ada timer/debounce atau penantian echo server. Pada pengukuran SSH langsung, P95 callback write di bawah 0,6 ms. Tidak ditemukan bukti antrean ini menyebabkan delay besar pada pengetikan biasa. Antrean tetap bisa tertahan setelah paste besar/SSH flow-control; keadaan itu belum dilaporkan pengguna.
3. **Rendering dan aksesibilitas tidak terbukti menjadi bottleneck pada uji ini.** `screenReaderMode: true` menambah tree aksesibilitas. Menonaktifkannya sementara tidak memberikan keuntungan konsisten yang menjelaskan delay besar. Jumlah tab/stream background yang diuji juga tidak mereproduksi keluhan; jangan menghapus dukungan pembaca layar berdasarkan dugaan ini.
4. **Monitoring/log polling berhenti ketika meninggalkan halaman.** Tidak ada interval terminal per karakter. Backpressure output memakai ack setelah parser xterm selesai; ini menjaga batas antrean output dan tidak menunggu render GPU.

## Kesimpulan dan langkah berikut

Delay besar pengguna belum direproduksi pada lingkungan lokal. Belum ada akar masalah yang terkonfirmasi pada koneksi VPS sebenarnya; mengklaim bahwa internet, xterm, atau TCP_NODELAY sudah pasti penyebabnya akan melampaui bukti.

Prioritas eksperimen berikutnya adalah A/B `client.setNoDelay(true)` pada VPS yang sama, dengan host/user/shell dan kondisi foreground yang sama. Ukur input → write callback → echo diterima → parser → render tanpa merekam isi input/output. Jika echo tetap lambat, bedakan waktu transport dari antrean input; jika echo cepat tetapi render lambat, periksa visibility/occlusion, long tasks, dan compositor. Optimasi produksi diterapkan setelah perbandingan itu mengonfirmasi pengaruhnya.

Referensi primer: [Node socket.setNoDelay](https://nodejs.org/api/net.html#socketsetnodelaynodelay), [ssh2 Client.setNoDelay](https://github.com/mscdex/ssh2#client-methods). Perilaku juga diperiksa langsung pada ssh2 1.17.0 dan xterm 6.0.0 yang terpasang.
