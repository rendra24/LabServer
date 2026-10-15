#!/usr/bin/env bash
# Verifikasi deployment di host Linux (Task 4.4). Jalankan sebagai root:
#   deploy/verify-deployment.sh [user-app] [url-gateway]
# Contoh: deploy/verify-deployment.sh dashboard_app http://dashboard.example.com
# Opsional: DASH_USER / DASH_PASS untuk mengetes login Basic Auth (jangan simpan di riwayat shell
# bersama; pakai `read -rs DASH_PASS; export DASH_PASS`).
set -u
APP_USER="${1:-dashboard_app}"
GATEWAY="${2:-}"
AVAIL=/etc/nginx/sites-available
ENAB=/etc/nginx/sites-enabled
fail=0
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; fail=$((fail + 1)); }
check(){ local msg="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$msg"; else bad "$msg"; fi; }

[ "$(id -u)" -eq 0 ] || { echo "Jalankan sebagai root." >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"

check "user $APP_USER ada" id "$APP_USER"
check "curl terpasang (dipakai Curl Tester)" command -v curl

# --- sudoers --------------------------------------------------------------------------------
S=/etc/sudoers.d/dashboard-server
check "sudoers $S ada" test -f "$S"
check "sudoers sintaks valid (visudo -cf)" visudo -cf "$S"
[ "$(stat -c '%a %U' "$S" 2>/dev/null)" = "440 root" ] && ok "sudoers mode 0440 milik root" || bad "sudoers harus 0440 root"
check "$APP_USER bisa sudo nginx -t tanpa password" sudo -n -u "$APP_USER" sudo -n /usr/sbin/nginx -t
if sudo -n -u "$APP_USER" sudo -n /usr/bin/id >/dev/null 2>&1; then bad "$APP_USER bisa sudo perintah lain (terlalu longgar)"; else ok "sudo perintah lain ditolak"; fi
if sudo -n -u "$APP_USER" sudo -n /usr/sbin/nginx -s stop >/dev/null 2>&1; then bad "sudo nginx dengan argumen lain diizinkan"; else ok "sudo nginx dengan argumen lain ditolak"; fi

# --- izin direktori -------------------------------------------------------------------------
check "$APP_USER bisa menulis $AVAIL" sudo -n -u "$APP_USER" test -w "$AVAIL"
check "$APP_USER bisa menulis $ENAB"  sudo -n -u "$APP_USER" test -w "$ENAB"
check "nginx.conf memuat sites-enabled" bash -c "nginx -T 2>/dev/null | grep -q 'sites-enabled'"
dangling=$(find "$ENAB" -xtype l 2>/dev/null | wc -l)
[ "$dangling" -eq 0 ] && ok "tidak ada symlink menggantung di sites-enabled" || bad "$dangling symlink menggantung di sites-enabled (nginx -t akan gagal)"

# --- backend --------------------------------------------------------------------------------
listen="$(ss -ltnH 'sport = :8000' 2>/dev/null | awk '{print $4}')"
[ -n "$listen" ] && ok "port 8000 listen ($listen)" || bad "tidak ada yang listen di :8000"
if echo "$listen" | grep -vqE '^(127\.0\.0\.1|\[::1\]):8000$'; then bad "backend listen di interface publik: $listen"; else ok "backend hanya listen di loopback"; fi
check "GET /api/health langsung ke backend" bash -c "curl -fsS --max-time 5 http://127.0.0.1:8000/api/health | grep -q '\"status\":\"ok\"'"
[ "$(stat -c '%a' /opt/dashboard-server/backend/.env 2>/dev/null)" = "600" ] && ok ".env mode 0600" || bad ".env harus 0600"
if ! command -v git >/dev/null || ! git -C /opt/dashboard-server rev-parse >/dev/null 2>&1; then
  echo "SKIP  cek .env ter-track git (git/repo tidak ada di host)"
elif git -C /opt/dashboard-server ls-files --error-unmatch backend/.env >/dev/null 2>&1; then bad ".env ter-track git"; else ok ".env tidak ter-track git"; fi

# --- gateway --------------------------------------------------------------------------------
if [ -n "$GATEWAY" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$GATEWAY/api/health")"
  [ "$code" = "401" ] && ok "gateway menolak tanpa kredensial (401)" || bad "gateway tanpa kredensial = $code (harusnya 401; 403 berarti IP ini tidak di whitelist)"
  if [ -n "${DASH_USER:-}" ] && [ -n "${DASH_PASS:-}" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -u "$DASH_USER:$DASH_PASS" "$GATEWAY/api/health")"
    [ "$code" = "200" ] && ok "gateway menerima kredensial valid (200)" || bad "gateway dengan kredensial = $code"
  fi
else
  echo "SKIP  cek gateway (beri URL sebagai argumen ke-2)"
fi

# --- database (opsional) --------------------------------------------------------------------
if command -v psql >/dev/null && [ -n "${DASH_DB_ROLE:-}" ]; then
  for priv in DELETE UPDATE TRUNCATE; do
    r="$(sudo -u postgres psql -Atc "select has_table_privilege('$DASH_DB_ROLE','audit_logs','$priv')" dashboard_server 2>/dev/null)"
    [ "$r" = "f" ] && ok "role DB tidak punya $priv pada audit_logs" || bad "role DB punya/tidak terverifikasi $priv pada audit_logs"
  done
else
  echo "SKIP  cek hak DB (set DASH_DB_ROLE=<role runtime>)"
fi

echo
[ "$fail" -eq 0 ] && echo "SEMUA CEK LOLOS" || echo "$fail cek GAGAL"
exit $((fail > 0))
