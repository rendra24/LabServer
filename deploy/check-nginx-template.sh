#!/usr/bin/env bash
# Validasi sintaks template gateway dengan nginx -t memakai config sementara (tanpa sudo, tanpa menyentuh /etc).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
htpasswd_file="$tmp/.htpasswd"; echo 'admin:$apr1$x$x' > "$htpasswd_file"
sed "s#/etc/nginx/.htpasswd#$htpasswd_file#" "$here/nginx-dashboard.conf" > "$tmp/site.conf"
cat > "$tmp/nginx.conf" <<CONF
pid $tmp/nginx.pid;
error_log $tmp/error.log;
events {}
http { access_log off; include $tmp/site.conf; }
CONF
nginx -t -c "$tmp/nginx.conf" -p "$tmp"
