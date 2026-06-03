#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="${1:-${PIXELMANIA_POSTGRES_MAINT_MODE:-backup}}"
PRIMARY_BACKUP_DIR="${PIXELMANIA_POSTGRES_BACKUP_DIR:-/var/backups/pixelmania/postgres}"
FALLBACK_BACKUP_DIR="${PIXELMANIA_POSTGRES_BACKUP_FALLBACK_DIR:-/tmp/pixelmania/postgres}"
OFFSITE_TARGET="${PIXELMANIA_POSTGRES_OFFSITE_TARGET:-}"
OFFSITE_METHOD="${PIXELMANIA_POSTGRES_OFFSITE_METHOD:-scp}"
OFFSITE_ENDPOINT="${PIXELMANIA_POSTGRES_OFFSITE_ENDPOINT:-}"
OFFSITE_REGION="${PIXELMANIA_POSTGRES_OFFSITE_REGION:-us-east-1}"
OFFSITE_KEY_PATH="${PIXELMANIA_POSTGRES_OFFSITE_KEY_PATH:-}"
OFFSITE_PRE_COPY_COMMAND="${PIXELMANIA_POSTGRES_OFFSITE_PRE_COPY_COMMAND:-}"
OFFSITE_POST_COPY_COMMAND="${PIXELMANIA_POSTGRES_OFFSITE_POST_COPY_COMMAND:-}"
RUN_RESTORE_CHECK="${PIXELMANIA_POSTGRES_MAINT_RUN_RESTORE_CHECK:-false}"
ALERT_WEBHOOK_URL="${PIXELMANIA_POSTGRES_MAINT_ALERT_WEBHOOK:-}"
LOG_FILE="${PIXELMANIA_POSTGRES_MAINT_LOG:-/var/log/pixelmania-postgres-maintenance.log}"
PREFLIGHT_SEND_ALERT="${PIXELMANIA_POSTGRES_PREFLIGHT_SEND_ALERT:-false}"

shell_quote() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

run_postgres() {
  if [ "${PIXELMANIA_POSTGRES_SUDO:-auto}" != "false" ] && command -v sudo >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
    sudo -u postgres "$@"
  else
    "$@"
  fi
}

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

offsite_method_is_s3() {
  [ "${OFFSITE_METHOD}" = "s3" ] || [ "${OFFSITE_METHOD}" = "spaces" ] || [ "${OFFSITE_METHOD}" = "aws-s3" ]
}

normalize_s3_target() {
  printf "%s" "${OFFSITE_TARGET%/}"
}

get_s3_bucket() {
  local target
  target="$(normalize_s3_target)"
  target="${target#s3://}"
  printf "%s" "${target%%/*}"
}

get_s3_prefix() {
  local target
  target="$(normalize_s3_target)"
  target="${target#s3://}"
  if [ "${target#*/}" = "${target}" ]; then
    printf "%s" ""
  else
    printf "%s" "${target#*/}"
  fi
}

get_s3_key() {
  local prefix="$1"
  local file_name="$2"
  if [ -n "${prefix}" ]; then
    printf "%s/%s" "${prefix%/}" "$file_name"
  else
    printf "%s" "$file_name"
  fi
}

aws_spaces_cli() {
  local aws_args=()
  if [ -n "${OFFSITE_ENDPOINT}" ]; then
    aws_args+=("--endpoint-url" "${OFFSITE_ENDPOINT}")
  fi
  AWS_DEFAULT_REGION="${OFFSITE_REGION}" \
    AWS_REGION="${OFFSITE_REGION}" \
    AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}" \
    AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}" \
    AWS_EC2_METADATA_DISABLED="${AWS_EC2_METADATA_DISABLED:-true}" \
    aws "${aws_args[@]}" "$@"
}

run_s3_offsite_copy() {
  local latest="$1"
  local latest_sha="$2"
  local target
  local backup_name
  local bucket
  local prefix
  local latest_sha_tmp=""
  target="$(normalize_s3_target)"
  backup_name="$(basename "$latest")"
  bucket="$(get_s3_bucket)"
  prefix="$(get_s3_prefix)"

  if [ -z "${target}" ] || [ "${target#s3://}" = "${target}" ]; then
    echo "[postgres-maintenance] S3 offsite target must look like s3://bucket/path." >&2
    return 1
  fi
  if ! command -v aws >/dev/null 2>&1; then
    echo "[postgres-maintenance] AWS CLI unavailable; install AWS CLI v2 before using S3/Spaces offsite copy." >&2
    return 1
  fi
  if [ -z "${OFFSITE_ENDPOINT}" ]; then
    echo "[postgres-maintenance] PIXELMANIA_POSTGRES_OFFSITE_ENDPOINT is required for DigitalOcean Spaces." >&2
    return 1
  fi
  if [ -z "${bucket}" ]; then
    echo "[postgres-maintenance] S3 offsite bucket could not be parsed from ${target}." >&2
    return 1
  fi

  aws_spaces_cli s3api put-object --bucket "$bucket" --key "$(get_s3_key "$prefix" "$backup_name")" --body "$latest" >/dev/null || return $?
  aws_spaces_cli s3api put-object --bucket "$bucket" --key "$(get_s3_key "$prefix" "latest.dump")" --body "$latest" >/dev/null || return $?

  if [ -f "$latest_sha" ]; then
    aws_spaces_cli s3api put-object --bucket "$bucket" --key "$(get_s3_key "$prefix" "${backup_name}.sha256")" --body "$latest_sha" >/dev/null || return $?
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    latest_sha_tmp="$(mktemp)"
    sha256sum "$latest" | awk '{print $1 "  latest.dump"}' > "$latest_sha_tmp"
    aws_spaces_cli s3api put-object --bucket "$bucket" --key "$(get_s3_key "$prefix" "latest.dump.sha256")" --body "$latest_sha_tmp" >/dev/null || {
      rm -f "$latest_sha_tmp"
      return 1
    }
    rm -f "$latest_sha_tmp"
  fi

  echo "[postgres-maintenance] S3 offsite copy complete to ${target}"
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

  if offsite_method_is_s3; then
    run_s3_offsite_copy "$latest" "$latest_sha" || return $?
  elif [ "${OFFSITE_METHOD}" = "rsync" ]; then
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

post_alert_message() {
  local message="$1"
  if [ -z "${ALERT_WEBHOOK_URL}" ]; then
    echo "[postgres-maintenance] alert webhook is not configured." >&2
    return 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "[postgres-maintenance] curl unavailable; cannot post alert webhook." >&2
    return 1
  fi
  local payload
  payload="$(printf '{"text":"%s"}' "$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')")"
  curl -fsS -X POST -H "Content-Type: application/json" -d "$payload" "$ALERT_WEBHOOK_URL" >/dev/null
}

notify_failure() {
  local reason="$1"
  post_alert_message "PixelMania postgres maintenance failed: ${reason}" >/dev/null 2>&1 || true
}

run_alert_test() {
  local host="unknown-host"
  if command -v hostname >/dev/null 2>&1; then
    host="$(hostname)"
  fi
  post_alert_message "PixelMania postgres maintenance test alert from ${host} at $(timestamp)"
  echo "[postgres-maintenance] alert webhook test sent."
}

offsite_target_is_remote() {
  [ "${OFFSITE_TARGET}" != "${OFFSITE_TARGET#*:}" ] && [ "${OFFSITE_TARGET#/}" = "${OFFSITE_TARGET}" ]
}

get_offsite_target_host() {
  printf "%s" "${OFFSITE_TARGET%%:*}"
}

get_offsite_target_path() {
  printf "%s" "${OFFSITE_TARGET#*:}"
}

run_offsite_preflight() {
  local failures=0

  if [ -z "${OFFSITE_TARGET}" ]; then
    echo "[postgres-preflight] warn: PIXELMANIA_POSTGRES_OFFSITE_TARGET is not set; off-site copy will be skipped."
    return 0
  fi

  if offsite_method_is_s3; then
    if command -v aws >/dev/null 2>&1; then
      echo "[postgres-preflight] ok: aws CLI is available for S3/Spaces copy."
    else
      echo "[postgres-preflight] fail: aws CLI is not installed." >&2
      failures=$((failures + 1))
    fi
    if [ -z "${OFFSITE_ENDPOINT}" ]; then
      echo "[postgres-preflight] fail: PIXELMANIA_POSTGRES_OFFSITE_ENDPOINT is required for DigitalOcean Spaces." >&2
      failures=$((failures + 1))
    else
      echo "[postgres-preflight] ok: S3/Spaces endpoint is configured: ${OFFSITE_ENDPOINT}"
    fi
    if [ "${OFFSITE_TARGET#s3://}" = "${OFFSITE_TARGET}" ]; then
      echo "[postgres-preflight] fail: S3 offsite target must look like s3://bucket/path." >&2
      failures=$((failures + 1))
    fi

    if [ "$failures" -eq 0 ]; then
      local target
      local test_name
      local test_file
      local bucket
      local prefix
      local test_key
      target="$(normalize_s3_target)"
      test_name=".pixelmania_preflight_$(date -u +"%Y%m%dT%H%M%SZ").txt"
      test_file="$(mktemp)"
      bucket="$(get_s3_bucket)"
      prefix="$(get_s3_prefix)"
      test_key="$(get_s3_key "$prefix" "$test_name")"
      printf "%s\n" "pixelmania postgres spaces preflight" > "$test_file"

      if aws_spaces_cli s3api put-object --bucket "$bucket" --key "$test_key" --body "$test_file" >/dev/null && \
         aws_spaces_cli s3api head-object --bucket "$bucket" --key "$test_key" >/dev/null && \
         aws_spaces_cli s3api delete-object --bucket "$bucket" --key "$test_key" >/dev/null; then
        echo "[postgres-preflight] ok: S3/Spaces write/list/delete test passed."
      else
        echo "[postgres-preflight] fail: S3/Spaces write/list/delete test failed for ${target}." >&2
        failures=$((failures + 1))
      fi

      rm -f "$test_file"
    fi

    return "$failures"
  elif [ "${OFFSITE_METHOD}" = "rsync" ]; then
    if command -v rsync >/dev/null 2>&1; then
      echo "[postgres-preflight] ok: rsync is available."
    else
      echo "[postgres-preflight] fail: rsync is not installed." >&2
      failures=$((failures + 1))
    fi
  elif [ "${OFFSITE_METHOD}" = "scp" ]; then
    if command -v scp >/dev/null 2>&1; then
      echo "[postgres-preflight] ok: scp is available."
    else
      echo "[postgres-preflight] fail: scp is not installed." >&2
      failures=$((failures + 1))
    fi
  else
    echo "[postgres-preflight] fail: unsupported off-site method '${OFFSITE_METHOD}'." >&2
    failures=$((failures + 1))
  fi

  if offsite_target_is_remote; then
    if ! command -v ssh >/dev/null 2>&1; then
      echo "[postgres-preflight] fail: ssh is not installed." >&2
      return 1
    fi

    local target_host
    local target_path
    local quoted_path
    local test_file
    local quoted_test_file
    local ssh_args=("-o" "BatchMode=yes" "-o" "ConnectTimeout=8")
    target_host="$(get_offsite_target_host)"
    target_path="$(get_offsite_target_path)"
    target_path="${target_path%/}"
    quoted_path="$(shell_quote "$target_path")"
    test_file="${target_path}/.pixelmania_preflight_$(date -u +"%Y%m%dT%H%M%SZ").tmp"
    quoted_test_file="$(shell_quote "$test_file")"
    if [ -n "${OFFSITE_KEY_PATH}" ]; then
      ssh_args+=("-i" "${OFFSITE_KEY_PATH}")
    fi

    if [ -n "${OFFSITE_KEY_PATH}" ] && [ ! -f "${OFFSITE_KEY_PATH}" ]; then
      echo "[postgres-preflight] fail: SSH key does not exist: ${OFFSITE_KEY_PATH}" >&2
      failures=$((failures + 1))
    fi

    if ssh "${ssh_args[@]}" "$target_host" "mkdir -p $quoted_path && test -d $quoted_path && test -w $quoted_path"; then
      echo "[postgres-preflight] ok: remote off-site directory is reachable and writable."
    else
      echo "[postgres-preflight] fail: remote off-site directory is not reachable/writable: ${OFFSITE_TARGET}" >&2
      failures=$((failures + 1))
    fi

    if ssh "${ssh_args[@]}" "$target_host" "umask 077; printf '%s\n' 'pixelmania postgres preflight' > $quoted_test_file && test -s $quoted_test_file && rm -f $quoted_test_file"; then
      echo "[postgres-preflight] ok: remote off-site write/delete test passed."
    else
      echo "[postgres-preflight] fail: remote off-site write/delete test failed." >&2
      failures=$((failures + 1))
    fi
  else
    mkdir -p "$OFFSITE_TARGET"
    if [ -d "$OFFSITE_TARGET" ] && [ -w "$OFFSITE_TARGET" ]; then
      echo "[postgres-preflight] ok: local off-site target is writable."
    else
      echo "[postgres-preflight] fail: local off-site target is not writable: ${OFFSITE_TARGET}" >&2
      failures=$((failures + 1))
    fi
  fi

  return "$failures"
}

run_preflight() {
  local failures=0

  echo "[postgres-preflight] checking PixelMania Postgres maintenance setup..."

  for command_name in pg_dump pg_restore psql createdb dropdb; do
    if command -v "$command_name" >/dev/null 2>&1; then
      echo "[postgres-preflight] ok: ${command_name} is available."
    else
      echo "[postgres-preflight] fail: ${command_name} is not installed." >&2
      failures=$((failures + 1))
    fi
  done
  if command -v curl >/dev/null 2>&1; then
    echo "[postgres-preflight] ok: curl is available for optional webhook alerts."
  else
    echo "[postgres-preflight] warn: curl is not installed; webhook alerts cannot be sent."
  fi

  for script_path in "$ROOT_DIR/scripts/postgres_backup.sh" "$ROOT_DIR/scripts/postgres_restore_check.sh"; do
    if [ -x "$script_path" ]; then
      echo "[postgres-preflight] ok: executable script ${script_path}"
    else
      echo "[postgres-preflight] fail: script is not executable: ${script_path}" >&2
      failures=$((failures + 1))
    fi
  done

  mkdir -p "$PRIMARY_BACKUP_DIR" 2>/dev/null || true
  mkdir -p "$FALLBACK_BACKUP_DIR" 2>/dev/null || true
  if [ -w "$PRIMARY_BACKUP_DIR" ]; then
    echo "[postgres-preflight] ok: primary backup directory is writable by current user."
  else
    echo "[postgres-preflight] warn: primary backup directory is not writable by current user: ${PRIMARY_BACKUP_DIR}"
  fi
  if run_postgres sh -c "test -w $(shell_quote "$PRIMARY_BACKUP_DIR")"; then
    echo "[postgres-preflight] ok: primary backup directory is writable by postgres runtime."
  else
    echo "[postgres-preflight] warn: primary backup directory is not writable by postgres runtime: ${PRIMARY_BACKUP_DIR}"
  fi
  if [ -w "$FALLBACK_BACKUP_DIR" ]; then
    echo "[postgres-preflight] ok: fallback backup directory is writable by current user."
  else
    echo "[postgres-preflight] warn: fallback backup directory is not writable by current user: ${FALLBACK_BACKUP_DIR}"
  fi

  if resolve_latest_dump >/dev/null 2>&1; then
    local latest
    latest="$(resolve_latest_dump)"
    echo "[postgres-preflight] ok: latest backup found: ${latest}"
  else
    echo "[postgres-preflight] warn: no backup exists yet; run './scripts/postgres_maintenance.sh backup' first."
  fi

  if ! run_offsite_preflight; then
    failures=$((failures + 1))
  fi

  if [ -n "${ALERT_WEBHOOK_URL}" ]; then
    if [ "${PREFLIGHT_SEND_ALERT}" = "true" ]; then
      if run_alert_test; then
        echo "[postgres-preflight] ok: alert webhook accepted test payload."
      else
        echo "[postgres-preflight] fail: alert webhook test failed." >&2
        failures=$((failures + 1))
      fi
    else
      echo "[postgres-preflight] ok: alert webhook is configured. Set PIXELMANIA_POSTGRES_PREFLIGHT_SEND_ALERT=true to send a test."
    fi
  else
    echo "[postgres-preflight] warn: alert webhook is not configured."
  fi

  if [ "$failures" -gt 0 ]; then
    echo "[postgres-preflight] failed with ${failures} blocking issue(s)." >&2
    return 1
  fi

  echo "[postgres-preflight] success"
}

run_mode() {
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
    preflight)
      run_preflight
      ;;
    alert-test)
      run_alert_test
      ;;
    full)
      run_backup || return $?
      if [ "${RUN_RESTORE_CHECK}" = "true" ]; then
        run_restore_check || return $?
      fi
      run_offsite_copy
      ;;
    *)
      echo "[postgres-maintenance] unknown mode '${MODE}'. Supported modes: backup, restore-check, copy-only, preflight, alert-test, full."
      return 1
      ;;
  esac
}

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

LOG_DIR="$(dirname "$LOG_FILE")"
if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_FILE="${PIXELMANIA_POSTGRES_MAINT_FALLBACK_LOG:-/tmp/pixelmania-postgres-maintenance.log}"
  mkdir -p "$(dirname "$LOG_FILE")"
fi
mkdir -p "$PRIMARY_BACKUP_DIR" 2>/dev/null || true
mkdir -p "$FALLBACK_BACKUP_DIR" 2>/dev/null || true

if [ ! -x "$ROOT_DIR/scripts/postgres_backup.sh" ] || [ ! -x "$ROOT_DIR/scripts/postgres_restore_check.sh" ] || [ ! -x "$ROOT_DIR/scripts/postgres_maintenance.sh" ]; then
  chmod +x "$ROOT_DIR/scripts/postgres_backup.sh" "$ROOT_DIR/scripts/postgres_restore_check.sh" "$ROOT_DIR/scripts/postgres_maintenance.sh"
fi

maintenance_result=0
{
  echo "[$(timestamp)] [postgres-maintenance] mode=${MODE}"
  run_mode || maintenance_result=$?
  if [ "$maintenance_result" = "0" ]; then
    echo "[$(timestamp)] [postgres-maintenance] success"
  fi
} >> "$LOG_FILE" 2>&1

if [ "$maintenance_result" != "0" ]; then
  notify_failure "mode=${MODE} failed (exit ${maintenance_result})"
  echo "[$(timestamp)] [postgres-maintenance] failed mode=${MODE} exit=${maintenance_result}" >> "$LOG_FILE"
  echo "[$(timestamp)] [postgres-maintenance] failed mode=${MODE}; log=${LOG_FILE}" >&2
  exit "$maintenance_result"
fi

echo "[$(timestamp)] [postgres-maintenance] completed mode=${MODE}; log=${LOG_FILE}"
