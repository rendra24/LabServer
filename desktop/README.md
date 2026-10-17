# Dashboard Server — Desktop (Electron)

Kelola vhost Nginx di server remote lewat SSH (agentless). Spesifikasi: [`../docs/desktop/PRD.md`](../docs/desktop/PRD.md), tugas: [`../docs/desktop/TASKS.md`](../docs/desktop/TASKS.md).

```bash
npm install          # Node >= 20
npm start            # jalankan aplikasi
npm test             # unit + tes SSH dengan server in-process
npm run lint
npm run css          # bangun ulang Tailwind (butuh tailwindcss CLI)
```

## Mencoba tanpa VPS
```bash
node scripts/dev-ssh-server.js   # SSH palsu di 127.0.0.1:2222, user deploy, password pw-123
```
Key uji dibuat di `scripts/.dev-key` (passphrase `frasa-dev`) dan `scripts/.dev-key-plain` (tanpa passphrase). Server ini hanya untuk menguji koneksi/autentikasi; belum ada Nginx di baliknya.

Data aplikasi (profil server, fingerprint, secret terenkripsi) ada di folder userData Electron, mis. `~/Library/Application Support/Dashboard Server/`.
