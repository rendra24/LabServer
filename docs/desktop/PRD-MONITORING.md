# PRD v3.1 — Monitoring (tambahan aplikasi desktop)

Tanggal: 2026-10-17 · Status: draf, menunggu konfirmasi · Menambah `docs/desktop/PRD.md`; non-goals PRD v3 yang tidak disebut di sini tetap berlaku.

## Tujuan
Halaman **Monitoring** per server (mirip dashboard Grafana sederhana) yang menampilkan statistik server dari **Prometheus yang terpasang di server tersebut**. Aplikasi tidak memasang apa pun di server dan tidak menyimpan data metrik sendiri.

## Keputusan (dipilih user 2026-10-17)
| Topik | Keputusan |
|---|---|
| Cakupan | **Host + Nginx**: panel bawaan; panel yang exporter-nya tidak ada ditandai "tidak tersedia" |
| Akses | **SSH tunnel**: aplikasi membuka koneksi `forwardOut` lewat sesi SSH yang sudah ada ke `127.0.0.1:9090` di server (tanpa membuka port) |
| Tampilan | **Panel tetap** + pilihan rentang waktu + auto-refresh; tanpa editor panel/PromQL bebas |
| Grafik | **uPlot**, di-bundle lokal (tanpa CDN) |

## Prasyarat di server (dijelaskan di panduan)
Prometheus sendiri tidak mengumpulkan metrik host. Agar panel muncul, server perlu:
- **Prometheus** (wajib) dan di-scrape: `node_exporter` untuk panel Host, `nginx-prometheus-exporter` (+ `stub_status` aktif) untuk panel Nginx.
- Prometheus cukup listen di `127.0.0.1:9090`.

## Panel bawaan
**Host** (node_exporter): CPU %, memori terpakai %, disk `/` terpakai %, jaringan masuk/keluar (B/s), load 1/5/15, uptime.
**Nginx** (nginx-prometheus-exporter): koneksi aktif, request/detik, koneksi reading/writing/waiting, status `nginx_up`.
Kartu ringkas (nilai terkini) + grafik garis per panel. Rentang: 15 mnt, 1 j, 6 j, 24 j, 7 hr. Auto-refresh 15 dtk (dapat dimatikan).

## Aturan keamanan & desain
- Renderer **tidak** mengirim PromQL: ia hanya mengirim `{panelId, rentang}`; proses utama membuat query dari katalog tetap (cegah query berat/arbitrer dan injeksi).
- Rentang dibatasi 5 mnt–7 hr; `step` dihitung agar maksimal ~500 titik/seri.
- Tujuan tunnel (host:port Prometheus) per server, default `127.0.0.1:9090`, divalidasi (hostname/IP + port 1–65535).
- Timeout per permintaan (10 dtk); respons dibatasi ukuran (5 MB) dan divalidasi bentuknya sebelum diteruskan ke renderer.
- Hanya HTTP ke Prometheus; tanpa autentikasi/TLS Prometheus di tahap ini (cukup karena lewat SSH ke loopback).
- Semua teks (nama seri/label) dirender via `textContent`.

## Non-Goals
Penyimpanan metrik lokal, alerting, editor panel/PromQL bebas, dashboard multi-server, autentikasi/TLS Prometheus, log Nginx.

## Kriteria penerimaan
- Dengan Prometheus + node_exporter + nginx exporter nyata, semua panel menampilkan data; nilai CPU/RAM/disk sesuai `top`/`free`/`df` di server dalam toleransi wajar.
- Tanpa nginx exporter: panel Nginx berlabel "tidak tersedia", panel Host tetap jalan. Tanpa Prometheus/tunnel gagal: pesan jelas, tanpa crash.
- Tidak ada permintaan PromQL dari renderer yang sampai ke server selain dari katalog.
