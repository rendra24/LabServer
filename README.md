# Dashboard Server

Internal tool untuk mengelola vhost Nginx (editor, `nginx -t`, reload aman, curl tester, audit log). Dokumen: [`docs/`](docs/README.md). Keputusan: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Setup (dev)
```bash
cd backend
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env            # isi DATABASE_URL & TEST_DATABASE_URL
createdb dashboard_server && createdb dashboard_server_test
```

## Migrasi, seed, jalankan, tes
```bash
cd backend
.venv/bin/alembic upgrade head            # skema (downgrade: alembic downgrade -1)
.venv/bin/python -m app.seed              # data contoh, idempoten
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
.venv/bin/pytest                          # TEST_DATABASE_URL dikosongkan ulang oleh tes!
.venv/bin/ruff check .
node --test frontend/test/                # tes logika frontend (butuh Node ≥ 20)
```
Health check: `GET /api/health`. Halaman: `/sites`, `/editor/:id`, `/curl-tester`, `/audit-logs`.

Di mesin non-Debian (mis. macOS) perintah `sudo nginx -t` / `systemctl` tidak ada; tes memakai mock, dan untuk dev bisa menunjuk skrip pengganti lewat `SUDO_BIN`, `NGINX_BIN`, `SYSTEMCTL_BIN` (lihat `.env.example`). Port Curl Tester dibatasi `CURL_ALLOWED_PORTS`.

## Melihat dashboard di lokal
```bash
deploy/dev-run.sh      # lalu buka http://127.0.0.1:8000/sites
```
Memakai direktori Nginx palsu di `.devdata/` (tidak menyentuh `/etc/nginx`). `nginx -t` dijalankan sungguhan bila nginx terpasang; reload hanya stub.

## Frontend
HTML/JS statis di `frontend/`, disajikan oleh FastAPI (`/sites`, `/editor/:id`). Editor: Ace dari CDN jsdelivr. CSS Tailwind (CLI standalone, `brew install tailwindcss`) di-commit; bangun ulang setelah mengubah kelas:
```bash
tailwindcss -i frontend/src/input.css -o frontend/static/app.css --minify
```

## Deploy (host Linux)
- `deploy/nginx-dashboard.conf` — gateway Basic Auth + IP whitelist (ganti placeholder). Cek sintaks: `deploy/check-nginx-template.sh`.
- `deploy/dashboard-server.sudoers` — salin ke `/etc/sudoers.d/dashboard-server` (0440, root); verifikasi dengan `deploy/verify-sudoers.sh` (sebagai root).
- Backend hanya listen di `127.0.0.1:8000`.
