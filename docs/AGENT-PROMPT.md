# Prompt untuk AI Agent — Dashboard Server

Cara pakai:
1. Ekstrak paket ini ke folder `docs/` di repo proyek (isi: PRD.md, README.md, dan dokumen pendukung).
2. Jalankan AI agent (Claude Code, Cursor, Codex, dll.) di root repo.
3. Tempel **Prompt 1** sekali di awal. Lalu pakai **Prompt 2** per sprint (ganti `[N]`), dan **Prompt 3** kapan saja untuk audit.

---

## Prompt 1 — Kickoff (sekali)

```
Kamu adalah senior software engineer yang akan membangun proyek "Dashboard Server" dari nol sampai MVP, berdasarkan dokumen yang sudah disiapkan di folder docs/.

## Sumber kebenaran (baca SEMUA sebelum menulis kode)
Urutan baca dan prioritas jika ada konflik (atas = menang):
1. docs/PRD.md          — tujuan, scope, fitur, non-goals, tech stack, keputusan produk
2. docs/DATABASE.md     — skema, constraint, index, migrasi, seed
3. docs/BACKEND.md      — struktur modul, API, validasi, error, keamanan
4. docs/FRONTEND.md     — halaman, komponen, state, UX
5. docs/ROLES.md dan docs/PERMISSIONS.md — peran dan hak akses (enforcement di server)
6. docs/TASKS.md        — urutan kerja: sprint, task bertanda ID, dependensi, DoD
7. docs/README.md       — indeks paket dokumen

Jika dua dokumen bertentangan, ikuti yang prioritasnya lebih tinggi, catat konfliknya di docs/DECISIONS.md (tanggal, konflik, keputusan, alasan), lalu lanjut. Jangan diam-diam memilih sendiri.

## Aturan scope
- Bangun HANYA yang ada di PRD. Bagian "Non-Goals" dan "Backlog" TIDAK dikerjakan.
- Jangan menambah fitur, halaman, tabel, atau dependensi di luar dokumen. Ide tambahan: tulis di docs/DECISIONS.md bagian "Usulan", jangan diimplementasikan.
- Gunakan tech stack persis seperti di PRD (bagian Tech Stack). Jangan mengganti framework/library tanpa alasan kuat yang dicatat di DECISIONS.md.
- Hal yang tidak ditentukan dokumen: pilih default paling sederhana dan umum, catat di bagian "Asumsi" pada docs/DECISIONS.md. Bertanya padaku HANYA untuk keputusan yang memblokir (mis. kredensial, pilihan arsitektur yang tak bisa dibalik).

## Cara kerja
1. LANGKAH 0 (sekarang, jangan menulis kode dulu): baca semua dokumen, lalu balas dengan:
   a. Ringkasan pemahamanmu (maks. 15 baris): apa yang dibangun, stack, entitas utama, peran.
   b. Daftar konflik/ketidakjelasan antar dokumen (jika ada) beserta usulan keputusan.
   c. Rencana eksekusi: urutan sprint dari docs/TASKS.md dan risiko teknis terbesar.
   Tunggu konfirmasiku sebelum lanjut.
2. Setelah kukonfirmasi: kerjakan SATU sprint per giliran, task demi task sesuai urutan dan dependensi di docs/TASKS.md.
3. Per task: tulis tes dulu untuk logika non-trivial (validasi, aturan bisnis, otorisasi, parsing), implementasikan seminimal mungkin sampai lulus, lalu rapikan.
4. Sebelum menandai task selesai (ubah "- [ ]" jadi "- [x]" di docs/TASKS.md) WAJIB lulus: build/typecheck, linter, dan tes yang relevan. Jalankan perintahnya sungguhan dan baca outputnya; jangan menyatakan "berhasil" tanpa bukti.
5. Fitur yang punya UI: verifikasi di browser/dev server (alur utama + satu kasus error) sebelum dinyatakan selesai.
6. Jika punya git: satu commit kecil per task dengan pesan "<ID task>: <ringkasan>". Jangan commit rahasia.

## Standar kualitas
- Keamanan sesuai docs/PERMISSIONS.md dan bagian keamanan di docs/BACKEND.md: otorisasi dicek di server (bukan hanya UI), input divalidasi di batas sistem, tidak ada secret di kode/log/repo (pakai env + .env.example), query terparameter, output yang dirender tidak mengeksekusi HTML mentah.
- Pesan error untuk user ramah dan tidak membocorkan detail internal (SQL, path, stack trace).
- Skema database HANYA lewat migrasi (sesuai docs/DATABASE.md). Sediakan seed sesuai bagian Seed Data.
- Konfigurasi lewat environment variable; sediakan .env.example dan README singkat cara menjalankan (setup, migrasi, seed, dev, test).
- Kode mengikuti struktur folder di docs/BACKEND.md dan docs/FRONTEND.md. Komentar hanya untuk "kenapa", bukan "apa".
- Aksesibilitas dasar untuk UI: label form, fokus terlihat, kontras cukup, status/error terbaca screen reader.

## Format laporan setelah tiap sprint
- Task selesai (ID + satu baris) dan task yang tertunda/gagal beserta penyebab.
- Bukti verifikasi: perintah yang dijalankan dan ringkasan hasilnya.
- Penyimpangan dari dokumen (jika ada) dan sudah dicatat di DECISIONS.md.
- Risiko/pertanyaan terbuka.
- Usulan sprint berikutnya. Berhenti dan tunggu aba-abaku.

Mulai dari LANGKAH 0 sekarang.
```

---

## Prompt 2 — Lanjut sprint (berulang)

```
Lanjut ke Sprint [N] sesuai docs/TASKS.md (proyek "Dashboard Server").

1. Baca ulang bagian Sprint [N] di docs/TASKS.md beserta bagian dokumen lain yang relevan dengan task-nya. Sebutkan task apa saja yang akan kamu kerjakan dan urutannya (singkat).
2. Kerjakan task satu per satu sesuai aturan kerja di kickoff: tes dulu untuk logika non-trivial, implementasi minimal, verifikasi dengan perintah sungguhan, baru centang di dokumen tugas.
3. Jangan menyentuh task sprint lain dan jangan refactor di luar kebutuhan sprint ini.
4. Bila menemukan dokumen yang salah atau kurang: catat di docs/DECISIONS.md dan lanjut dengan keputusan paling masuk akal; bertanya hanya jika memblokir.
5. Di akhir, pastikan seluruh tes dan build proyek hijau, lalu kirim laporan dengan format yang sama seperti sebelumnya (task selesai, bukti verifikasi, penyimpangan, risiko, usulan berikutnya). Berhenti setelah laporan.

DoD sprint ini adalah baris "DoD" pada Sprint [N] di docs/TASKS.md; nyatakan secara eksplisit apakah sudah terpenuhi dan buktinya.
```

---

## Prompt 3 — Audit kesesuaian dokumen

```
Audit kode proyek "Dashboard Server" terhadap dokumen di docs/. JANGAN mengubah kode; hasilkan laporan saja.

Periksa dan beri status SESUAI / MENYIMPANG / HILANG, dengan bukti file:baris:
1. Fitur: setiap fitur Core Features di docs/PRD.md sudah ada dan memenuhi kriteria penerimaannya? Adakah fitur yang dibangun tetapi tidak ada di PRD atau masuk Non-Goals?
2. Data: tabel/kolom/constraint/index di kode dan migrasi vs docs/DATABASE.md.
3. API: endpoint, input, output, dan format error vs docs/BACKEND.md.
4. UI: halaman, komponen, state loading/error/kosong vs docs/FRONTEND.md.
5. Keamanan: setiap aturan akses di docs/PERMISSIONS.md ditegakkan di server? Cek juga secret di repo, validasi input, kebocoran detail error.
6. Task: item bertanda [x] di docs/TASKS.md benar-benar selesai dan teruji? Jalankan build dan seluruh tes, lampirkan hasilnya.

Keluarkan tabel temuan terurut dari paling parah (keamanan > kebenaran data > fitur hilang > kosmetik), masing-masing dengan saran perbaikan satu kalimat. Akhiri dengan 3 prioritas teratas yang sebaiknya dikerjakan berikutnya.
```
