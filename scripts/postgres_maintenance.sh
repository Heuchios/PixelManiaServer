#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="${1:-${PIXELMANIA_POSTGRES_MAINT_MODE:-backup}}"
PRIMARY_BACKUP_DIR="${PIXELMANIA_POSTGRES_BACKUP_DIR:-/var/backups/pixelmania/postgres}"
FALLBACK_BACKUP_DIR="${PIXELMANIA_POSTGRES_BACKUP_FALLBACK_DIR:-/tmp/pixelmania/postgres}"
OFFSITE_TARGET="${PIXELMANIA_POSTGRES_OFFSITE_TARGET:-}"
OFFSITE_METHOD="${PIXELMANIA_POSTGRES_OFFSITE_METHOD:-scp}"
OFFSITE_KEY_PATH="${PIXELMANIA_POSTGRES_OFFSITE_KEY_PATH:-}"
OFFSITE_PRE_COPY_COMMAND="${PIXELMANIA_POSTGRES_OFFSITE_PRE_COPY_COMMAND:-}"
OFFSITE_POST_COPY_COMMAND="${PIXELMANIA_POSTGRES_OFFSITE_POST_COPY_COMMAND:-}"
RUN_RESTORE_CHECK="${PIXELMANIA_POSTGRES_MAINT_RUN_RESTORE_CHECK:-false}"
ALERT_WEBHOOK_URL="${PIXELMANIA_POSTGRES_MAINT_ALERT_WEBHOOK:-}"
LOG_FILE="${PIXELMANIA_POSTGRES_MAINT_LOG:-/var/log/pixelmania-postgres-maintenance.log}"

run_backup() {
  "$ROOT_DIR/scripts/postgres_backup.sh"
}

resolve_latest_dump() {
  local file=""
  if [ -f "${PRIMARY_BACKUP_DIR}/latest.dump" ]; then
    file="$(readlink -f "${PRIMARY_BACKUP_DIR}/latest.dump")"
  elif [ -f "${FALLBACK_BACKUP_DIR}/latest.dump" ]; then
    file="$(readlink -f "${FALLBACK_BACKUP_DIR}/latest.dump")"
  else
    file="$(find "$PRIMARY_BACKUP_DIR" "$FALLBACK_BACKUP_DIR" -maxdepth 1 -type f -name 'pixelmania_postgres_*_*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | awk '{print $2}' || true)"
  fi

  if [ -z "${file}" ] || [ ! -f "${file}" ]; then
    echo "[postgres-maintenance] no backup file found to restore-check." >&2
    return 1
  fi

  echo "${file}"
}

run_restore_check() {
  local latest
  latest="$(resolve_latest_dump)"
  "$ROOT_DIR/scripts/postgres_restore_check.sh" "$latest"
}

run_offsite_copy() {
  if [ -z "${OFFSITE_TARGET}" ]; then
    echo "[postgres-maintenance] skipping offsite copy (PIXELMANIA_POSTGRES_OFFSITE_TARGET not set)." >&2
    return 0
  fi

  if [ -n "${OFFSITE_PRE_COPY_COMMAND}" ]; then
    eval "$OFFSITE_PRE_COPY_COMMAND" || true
  fi

  local latest
  latest="$(resolve_latest_dump)"
  local latest_sha="$latest.sha256"

  if [ "${OFFSITE_METHOD}" = "rsync" ]; then
    if ! command -v rsync >/dev/null 2>&1; then
      echo "[postgres-maintenance] rsync unavailable; set PIXELMANIA_POSTGRES_OFFSITE_METHOD=scp or install rsync." >&2
      return 1
    fi
    local rsync_ssh_cmd="ssh"
    if [ -n "${OFFSITE_KEY_PATH}" ]; then
      rsync_ssh_cmd="ssh -i ${OFFSITE_KEY_PATH}"
    fi
    rsync -av -e "$rsync_ssh_cmd" "$latest" "${OFFSITE_TARGET}/" >/dev/null
    if [ -f "$latest_sha" ]; then
      rsync -av -e "$rsync_ssh_cmd" "$latest_sha" "${OFFSITE_TARGET}/" >/dev/null
    fi
  else
    if [ "${OFFSITE_METHOD}" != "scp" ]; then
      echo "[postgres-maintenance] unknown offsite method '${OFFSITE_METHOD}', defaulting to scp."
    fi
    if [ -n "${OFFSITE_KEY_PATH}" ]; then
      scp -i "${OFFSITE_KEY_PATH}" "$latest" "${OFFSITE_TARGET}/"
    else
      scp "$latest" "${OFFSITE_TARGET}/"
    fi
    if [ -f "$latest_sha" ]; then
      if [ -n "${OFFSITE_KEY_PATH}" ]; then
        scp -i "${OFFSITE_KEY_PATH}" "$latest_sha" "${OFFSITE_TARGET}/"
      else
        scp "$latest_sha" "${OFFSITE_TARGET}/"
      fi
    fi
  fi

  if [ -n "${OFFSITE_POST_COPY_COMMAND}" ]; then
    eval "$OFFSITE_POST_COPY_COMMAND" || true
  fi

  echo "[postgres-maintenance] offsite copy complete to ${OFFSITE_TARGET}"
}

notify_failure() {
  local reason="$1"
  if [ -z "${ALERT_WEBHOOK_URL}" ]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi
  local payload
  payload="$(printf '{"text":"PixelMania postgres maintenance failed: %s"}' "$(printf '%s' "$reason" | sed 's/"/\\"/g')")"
  curl -fsS -X POST -H "Content-Type: application/json" -d "$payload" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$PRIMARY_BACKUP_DIR" "$FALLBACK_BACKUP_DIR"

if [ ! -x "$ROOT_DIR/scripts/postgres_backup.sh" ] || [ ! -x "$ROOT_DIR/scripts/postgres_restore_check.sh" ]; then
  chmod +x "$ROOT_DIR/scripts/postgres_backup.sh" "$ROOT_DIR/scripts/postgres_restore_check.sh"
fi

{
  echo "[$(timestamp)] [postgres-maintenance] mode=${MODE}"
  case "${MODE}" in
    backup)
      run_backup
      ;;
    restore-check)
      run_restore_check
      ;;
    copy-only)
      run_offsite_copy
      ;;
    full)
      run_backup
      if [ "${RUN_RESTORE_CHECK}" = "true" ]; then
        run_restore_check
      fi
      run_offsite_copy
      ;;
    *)
      echo "[postgres-maintenance] unknown mode '${MODE}'. Supported modes: backup, restore-check, copy-only, full."
      exit 1
      ;;
  esac
  echo "[$(timestamp)] [postgres-maintenance] success"
} >> "$LOG_FILE" 2>&1 || {
  result=$?
  notify_failure "mode=${MODE} failed (exit ${result})"
  echo "[$(timestamp)] [postgres-maintenance] failed mode=${MODE}"
  exit ${result}
}

echo "[$(timestamp)] [postgres-maintenance] completed mode=${MODE}"
