#!/usr/bin/env bash
# Menjalankan dashboard untuk pengembangan lokal TANPA menyentuh /etc/nginx.
# Prasyarat: backend/.venv + backend/.env (lihat README), PostgreSQL berjalan, nginx terpasang (opsional).
# Pakai: deploy/dev-run.sh   -> http://127.0.0.1:8000/sites
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
data="$root/.devdata"
mkdir -p "$data"/{sites-available,sites-enabled,bin,run}

# nginx -t sungguhan terhadap sites-enabled dev (bila nginx ada); sudo/systemctl = pengganti dev
cat > "$data/nginx.conf" <<CONF
pid $data/run/nginx.pid;
error_log $data/run/error.log;
events {}
http { access_log off; include $data/sites-enabled/*; }
CONF
printf '#!/bin/bash\n[ "$1" = "-n" ] && shift\nexec "$@"\n' > "$data/bin/sudo"
if command -v nginx >/dev/null; then
  printf '#!/bin/bash\nexec %s -t -c %s -p %s\n' "$(command -v nginx)" "$data/nginx.conf" "$data/run" > "$data/bin/nginx"
else
  printf '#!/bin/bash\necho "nginx tidak terpasang (stub dev): ok" >&2\n' > "$data/bin/nginx"
fi
if command -v nginx >/dev/null; then  # reload dev sungguhan terhadap daemon dev (di bawah)
  printf '#!/bin/bash\n[ "$1 $2" = "reload nginx" ] && exec %s -s reload -c %s -p %s\nexit 1\n' "$(command -v nginx)" "$data/nginx.conf" "$data/run" > "$data/bin/systemctl"
else
  printf '#!/bin/bash\necho "nginx tidak terpasang (stub dev)" >&2\n' > "$data/bin/systemctl"
fi
chmod +x "$data"/bin/*

# Berkas contoh untuk baris seed, supaya tombol Edit/Clone muncul (baris tanpa berkas tidak punya aksi itu)
for name in default app-php83.local legacy-php74.local; do
  f="$data/sites-available/$name"
  [ -e "$f" ] || printf 'server {\n    listen 8080;\n    server_name %s;\n    default_type text/plain;\n    location / { return 200 "halo dari %s\\n"; }\n}\n' \
    "$([ "$name" = default ] && echo localhost || echo "$name")" "$name" > "$f"
done
for name in default app-php83.local; do  # sesuai seed: dua situs pertama aktif
  [ -e "$data/sites-enabled/$name" ] || ln -s "$data/sites-available/$name" "$data/sites-enabled/$name"
done

cd "$root/backend"
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed
export NGINX_AVAILABLE_DIR="$data/sites-available" NGINX_ENABLED_DIR="$data/sites-enabled"
export SUDO_BIN="$data/bin/sudo" NGINX_BIN="$data/bin/nginx" SYSTEMCTL_BIN="$data/bin/systemctl"

# Daemon nginx dev: tanpa ini vhost yang dibuat tidak punya server yang mendengarkan portnya
if command -v nginx >/dev/null; then
  "$data/bin/nginx" >/dev/null 2>&1 || echo "PERINGATAN: konfigurasi dev tidak valid; daemon nginx tidak dijalankan"
  if nginx -c "$data/nginx.conf" -p "$data/run" 2>"$data/run/start.log"; then
    trap 'nginx -c "$data/nginx.conf" -p "$data/run" -s stop 2>/dev/null' EXIT
    echo "Nginx dev berjalan (konfigurasi: $data/nginx.conf). Vhost dengan 'listen 8080;' bisa dites di http://<domain>:8080"
  else
    echo "PERINGATAN: nginx dev gagal start (port dipakai proses lain?): $(tail -1 "$data/run/start.log")"
  fi
fi
echo "Dashboard: http://127.0.0.1:8000/sites  (Ctrl+C untuk berhenti)"
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
