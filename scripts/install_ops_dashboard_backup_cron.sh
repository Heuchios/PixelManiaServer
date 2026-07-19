#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PIXELMANIA_SERVER_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ROOT_DIR}/.env"

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

BACKUP_DIR="$(read_env_value OPS_DASHBOARD_ACCOUNT_BACKUP_DIR /var/backups/pixelmania/ops-dashboard)"
RETENTION_DAYS="$(read_env_value OPS_DASHBOARD_ACCOUNT_BACKUP_RETENTION_DAYS 30)"
CRON_FILE="$(read_env_value OPS_DASHBOARD_ACCOUNT_BACKUP_CRON_FILE /etc/cron.d/pixelmania-ops-dashboard-backup)"
LOG_FILE="$(read_env_value OPS_DASHBOARD_ACCOUNT_BACKUP_LOG_FILE /var/log/pixelmania-ops-dashboard-backup.log)"
SCHEDULE="$(read_env_value OPS_DASHBOARD_ACCOUNT_BACKUP_SCHEDULE '17 * * * *')"

if [ "$(id -u)" -ne 0 ]; then
  echo "[ops-account-backup-cron] run as root so the cron file can be installed under /etc/cron.d." >&2
  exit 1
fi

if [ ! -x "${ROOT_DIR}/scripts/ops_dashboard_account_backup.sh" ]; then
  chmod +x "${ROOT_DIR}/scripts/ops_dashboard_account_backup.sh"
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
touch "$LOG_FILE"
chmod 600 "$LOG_FILE" 2>/dev/null || true

cat > "$CRON_FILE" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

${SCHEDULE} root cd ${ROOT_DIR} && OPS_DASHBOARD_ACCOUNT_BACKUP_DIR=${BACKUP_DIR} OPS_DASHBOARD_ACCOUNT_BACKUP_RETENTION_DAYS=${RETENTION_DAYS} bash scripts/ops_dashboard_account_backup.sh >> ${LOG_FILE} 2>&1
EOF

chmod 644 "$CRON_FILE"

bash "${ROOT_DIR}/scripts/ops_dashboard_account_backup.sh"

echo "[ops-account-backup-cron] installed=$CRON_FILE"
echo "[ops-account-backup-cron] schedule=${SCHEDULE}"
echo "[ops-account-backup-cron] backup_dir=$BACKUP_DIR"
echo "[ops-account-backup-cron] log=$LOG_FILE"
