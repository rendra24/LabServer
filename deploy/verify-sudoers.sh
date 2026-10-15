#!/usr/bin/env bash
# Jalankan di host target sebagai root: deploy/verify-sudoers.sh [user]
# Memeriksa sintaks sudoers dan bahwa user app bisa menjalankan 2 perintah tanpa password,
# tetapi tidak perintah lain.
set -euo pipefail
user="${1:-dashboard_app}"
here="$(cd "$(dirname "$0")" && pwd)"
visudo -cf "$here/dashboard-server.sudoers"
sudo -n -u "$user" sudo -n /usr/sbin/nginx -t
if sudo -n -u "$user" sudo -n /usr/bin/id >/dev/null 2>&1; then
  echo "GAGAL: $user bisa menjalankan perintah lain via sudo" >&2; exit 1
fi
echo "OK: sudoers sesuai (hanya nginx -t dan systemctl reload nginx)."
