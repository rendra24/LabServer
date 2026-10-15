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
```
Health check: `GET /api/health`.

## Deploy (host Linux)
- `deploy/nginx-dashboard.conf` — gateway Basic Auth + IP whitelist (ganti placeholder). Cek sintaks: `deploy/check-nginx-template.sh`.
- `deploy/dashboard-server.sudoers` — salin ke `/etc/sudoers.d/dashboard-server` (0440, root); verifikasi dengan `deploy/verify-sudoers.sh` (sebagai root).
- Backend hanya listen di `127.0.0.1:8000`.
