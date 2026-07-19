#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PIXELMANIA_SERVER_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ROOT_DIR}/.env"
DEFAULT_ACCOUNT_FILE="${ROOT_DIR}/ops_dashboard_admin.json"
BACKUP_DIR="${OPS_DASHBOARD_ACCOUNT_BACKUP_DIR:-/var/backups/pixelmania/ops-dashboard}"
RETENTION_DAYS="${OPS_DASHBOARD_ACCOUNT_BACKUP_RETENTION_DAYS:-30}"

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

ACCOUNT_FILE="$(read_env_value OPS_DASHBOARD_ACCOUNT_FILE "$DEFAULT_ACCOUNT_FILE")"
if [ -z "$ACCOUNT_FILE" ]; then
  ACCOUNT_FILE="$DEFAULT_ACCOUNT_FILE"
fi
if [[ "$ACCOUNT_FILE" != /* ]]; then
  ACCOUNT_FILE="${ROOT_DIR}/${ACCOUNT_FILE}"
fi

if [ ! -f "$ACCOUNT_FILE" ]; then
  echo "[ops-account-backup] account file does not exist: $ACCOUNT_FILE" >&2
  exit 1
fi

if ! mkdir -p "$BACKUP_DIR" 2>/dev/null; then
  BACKUP_DIR="${ROOT_DIR}/backups/ops-dashboard"
  mkdir -p "$BACKUP_DIR"
fi

chmod 700 "$BACKUP_DIR" 2>/dev/null || true

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${BACKUP_DIR}/ops_dashboard_admin-${stamp}.json"
checksum_file="${backup_file}.sha256"

install -m 600 "$ACCOUNT_FILE" "$backup_file"
sha256sum "$backup_file" > "$checksum_file"
chmod 600 "$checksum_file" 2>/dev/null || true

ln -sfn "$(basename "$backup_file")" "${BACKUP_DIR}/latest.json"
ln -sfn "$(basename "$checksum_file")" "${BACKUP_DIR}/latest.json.sha256"

if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -type f \( -name 'ops_dashboard_admin-*.json' -o -name 'ops_dashboard_admin-*.json.sha256' \) -mtime +"$RETENTION_DAYS" -delete
fi

echo "[ops-account-backup] backup=$backup_file"
echo "[ops-account-backup] checksum=$checksum_file"
echo "[ops-account-backup] success"
