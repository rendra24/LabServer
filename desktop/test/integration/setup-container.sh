#!/usr/bin/env bash
# Membuat container uji: OpenSSH + Nginx + 3 model izin. HANYA untuk tes.
#   writer : anggota grup nginxconf (tulis via SFTP), sudo NOPASSWD hanya untuk nginx -t/reload
#   sudoer : tanpa izin tulis, sudo NOPASSWD: ALL (pola user "ubuntu" di VPS cloud)
#   sudopw : tanpa izin tulis, sudo ALL dengan password
# Pakai: test/integration/setup-container.sh [nama] [port]
set -euo pipefail
NAME="${1:-dssshd}"
PORT="${2:-2223}"
here="$(cd "$(dirname "$0")" && pwd)"
keys="$here/../../scripts"
[ -f "$keys/.dev-key-plain.pub" ] || { echo "Jalankan dulu: node scripts/dev-ssh-server.js (membuat key uji)"; exit 1; }

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:22" ubuntu:24.04 sleep infinity >/dev/null
docker exec "$NAME" bash -c '
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq openssh-server nginx sudo curl >/dev/null
mkdir -p /run/sshd
groupadd -f nginxconf
chgrp nginxconf /etc/nginx/sites-available /etc/nginx/sites-enabled
chmod 2775 /etc/nginx/sites-available /etc/nginx/sites-enabled
for u in writer sudoer sudopw; do
  useradd -m -s /bin/bash "$u"
  echo "$u:pw-$u" | chpasswd
  mkdir -p /home/$u/.ssh && chmod 700 /home/$u/.ssh
done
usermod -aG nginxconf writer
cat > /etc/sudoers.d/ds-test <<SUDO
writer ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/sbin/nginx -s reload, /bin/systemctl reload nginx
sudoer ALL=(ALL) NOPASSWD: ALL
sudopw ALL=(ALL) ALL
SUDO
chmod 440 /etc/sudoers.d/ds-test && visudo -cf /etc/sudoers.d/ds-test >/dev/null
printf "PasswordAuthentication yes\n" > /etc/ssh/sshd_config.d/50-test.conf
/usr/sbin/sshd
nginx
'
for u in writer sudoer sudopw; do
  { cat "$keys/.dev-key-plain.pub"; echo; cat "$keys/.dev-key.pub"; echo; } | docker exec -i "$NAME" bash -c "cat > /home/$u/.ssh/authorized_keys && chmod 600 /home/$u/.ssh/authorized_keys && chown -R $u: /home/$u/.ssh"
done
echo "SSHD_PORT=$PORT NGINX_CONTAINER=$NAME SSHD_FINGERPRINT=$(docker exec "$NAME" ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | cut -d' ' -f2)"
