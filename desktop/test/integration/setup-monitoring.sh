#!/usr/bin/env bash
# Menyalakan Prometheus + node_exporter (+ nginx exporter) DI DALAM container uji (tanpa systemd).
# Prasyarat: setup-container.sh, lalu apt install prometheus prometheus-node-exporter prometheus-nginx-exporter.
# Pakai: setup-monitoring.sh [container] [--no-nginx-exporter]
set -euo pipefail
NAME="${1:-dssshd}"
NGINX_EXPORTER=1
[ "${2:-}" = "--no-nginx-exporter" ] && NGINX_EXPORTER=0

docker exec -e NGINX_EXPORTER="$NGINX_EXPORTER" "$NAME" bash -c '
set -e
# "[p]rometheus" agar pola tidak mencocokkan shell ini sendiri
pkill -f "^/usr/bin/[p]rometheus" || true
sleep 1
# stub_status hanya untuk loopback
cat > /etc/nginx/conf.d/stub.conf <<CONF
server {
    listen 127.0.0.1:8082;
    location /stub_status { stub_status; allow 127.0.0.1; deny all; }
}
CONF
nginx -t >/dev/null 2>&1 && nginx -s reload

cat > /etc/prometheus/prometheus.yml <<YML
global:
  scrape_interval: 5s
scrape_configs:
  - job_name: node
    static_configs: [{ targets: ["127.0.0.1:9100"] }]
YML
if [ "$NGINX_EXPORTER" = "1" ]; then
cat >> /etc/prometheus/prometheus.yml <<YML
  - job_name: nginx
    static_configs: [{ targets: ["127.0.0.1:9113"] }]
YML
fi

rm -rf /tmp/prom-data; mkdir -p /tmp/prom-data
nohup /usr/bin/prometheus-node-exporter --web.listen-address=127.0.0.1:9100 >/tmp/node-exporter.log 2>&1 &
if [ "$NGINX_EXPORTER" = "1" ]; then
  nohup /usr/bin/prometheus-nginx-exporter --nginx.scrape-uri=http://127.0.0.1:8082/stub_status --web.listen-address=127.0.0.1:9113 >/tmp/nginx-exporter.log 2>&1 &
fi
nohup /usr/bin/prometheus --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/tmp/prom-data --web.listen-address=127.0.0.1:9090 >/tmp/prometheus.log 2>&1 &
sleep 12
curl -s http://127.0.0.1:9090/api/v1/targets?state=active | python3 -c "import sys,json;[print(t[\"labels\"][\"job\"],t[\"health\"]) for t in json.load(sys.stdin)[\"data\"][\"activeTargets\"]]"
'
