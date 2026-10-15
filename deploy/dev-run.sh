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
printf '#!/bin/bash\necho "stub dev: reload tidak menyentuh nginx sungguhan" >&2\n' > "$data/bin/systemctl"
chmod +x "$data"/bin/*

cd "$root/backend"
.venv/bin/alembic upgrade head
.venv/bin/python -m app.seed
export NGINX_AVAILABLE_DIR="$data/sites-available" NGINX_ENABLED_DIR="$data/sites-enabled"
export SUDO_BIN="$data/bin/sudo" NGINX_BIN="$data/bin/nginx" SYSTEMCTL_BIN="$data/bin/systemctl"
echo "Dashboard: http://127.0.0.1:8000/sites  (Ctrl+C untuk berhenti)"
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
