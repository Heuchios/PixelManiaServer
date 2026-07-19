#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PIXELMANIA_SERVER_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ROOT_DIR}/.env"
DOMAIN="${1:-${OPS_DASHBOARD_DOMAIN:-ops.pixelmaniagame.com}}"
PORT="${OPS_DASHBOARD_PORT:-9090}"
CADDYFILE="${OPS_DASHBOARD_CADDYFILE:-/etc/caddy/Caddyfile}"
MARKER_BEGIN="# PixelMania Ops Dashboard HTTPS BEGIN"
MARKER_END="# PixelMania Ops Dashboard HTTPS END"

read_env_value() {
  local key="$1"
  local fallback="${2:-}"
  if [ -n "${!key:-}" ]; then
    printf '%s\n' "${!key}"
    return
  fi
  if [ -f "$ENV_FILE" ]; then
    local line
    line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
    if [ -n "$line" ]; then
      printf '%s\n' "${line#*=}"
      return
    fi
  fi
  printf '%s\n' "$fallback"
}

set_env() {
  local key="$1"
  local value="$2"
  touch "$ENV_FILE"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    local escaped_value
    escaped_value="$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')"
    sed -i "s/^${key}=.*/${key}=${escaped_value}/" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

if [ "$(id -u)" -ne 0 ]; then
  echo "[ops-https] run as root so Caddy can be updated." >&2
  exit 1
fi

PORT="$(read_env_value OPS_DASHBOARD_PORT "$PORT")"
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "[ops-https] invalid OPS_DASHBOARD_PORT: $PORT" >&2
  exit 1
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "[ops-https] Caddy is not installed." >&2
  exit 1
fi

if ! getent ahosts "$DOMAIN" >/dev/null 2>&1; then
  cat >&2 <<EOF
[ops-https] DNS is not ready for ${DOMAIN}.
Create an A record:
  ${DOMAIN} -> 68.183.141.114
Then rerun:
  sudo bash scripts/install_ops_dashboard_https.sh ${DOMAIN}
EOF
  exit 2
fi

if ! curl -fsS "http://127.0.0.1:${PORT}/api/status" -o /tmp/pixelmania-ops-status.json; then
  status_code="$(curl -sS -o /tmp/pixelmania-ops-status.json -w '%{http_code}' "http://127.0.0.1:${PORT}/api/status" || true)"
  if [ "$status_code" != "401" ]; then
    echo "[ops-https] local ops dashboard did not answer on 127.0.0.1:${PORT}; status=${status_code}" >&2
    cat /tmp/pixelmania-ops-status.json >&2 || true
    exit 1
  fi
fi

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT
if [ -f "$CADDYFILE" ]; then
  awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  ' "$CADDYFILE" > "$tmp_file"
else
  : > "$tmp_file"
fi

cat >> "$tmp_file" <<EOF

${MARKER_BEGIN}
${DOMAIN} {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "no-referrer"
    }
    reverse_proxy 127.0.0.1:${PORT}
}
${MARKER_END}
EOF

install -m 644 "$tmp_file" "$CADDYFILE"
caddy validate --config "$CADDYFILE"
systemctl reload caddy

set_env OPS_DASHBOARD_HOST 127.0.0.1
set_env OPS_DASHBOARD_PUBLIC_BASE_URL "https://${DOMAIN}"
set_env OPS_DASHBOARD_COOKIE_SECURE true

cd "$ROOT_DIR"
pm2 startOrReload ecosystem.ops.config.js --env production --update-env
pm2 save

echo "[ops-https] domain=https://${DOMAIN}"
echo "[ops-https] caddyfile=$CADDYFILE"
echo "[ops-https] cookie_secure=true"
echo "[ops-https] success"
