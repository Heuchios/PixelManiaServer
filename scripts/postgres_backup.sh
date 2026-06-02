#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

read_env() {
  local key="$1"
  local fallback="${2:-}"
  local value=""
  if [ -f "$ENV_FILE" ]; then
    value="$(awk -v key="$key" 'BEGIN { FS = "=" } $1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE" || true)"
    value="${value%$'\r'}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
  fi
  if [ -n "$value" ]; then
    printf "%s" "$value"
  else
    printf "%s" "$fallback"
  fi
}

run_postgres() {
  if [ "${PIXELMANIA_POSTGRES_SUDO:-auto}" != "false" ] && command -v sudo >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
    sudo -u postgres "$@"
  else
    "$@"
  fi
}

DB_NAME="${POSTGRES_DATABASE:-$(read_env POSTGRES_DATABASE pixelmania)}"
BACKUP_DIR="${PIXELMANIA_POSTGRES_BACKUP_DIR:-/var/backups/pixelmania/postgres}"
RETENTION_DAYS="${PIXELMANIA_POSTGRES_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
BACKUP_NAME="pixelmania_postgres_${DB_NAME}_${STAMP}.dump"
TMP_FILE="$BACKUP_DIR/.${BACKUP_NAME}.tmp"
FINAL_FILE="$BACKUP_DIR/$BACKUP_NAME"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is not installed. Install PostgreSQL client tools first." >&2
  exit 1
fi

umask 077
mkdir -p "$BACKUP_DIR"

echo "[postgres-backup] writing $FINAL_FILE"
run_postgres pg_dump \
  --dbname="$DB_NAME" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$TMP_FILE"

mv "$TMP_FILE" "$FINAL_FILE"
ln -sfn "$(basename "$FINAL_FILE")" "$BACKUP_DIR/latest.dump"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$FINAL_FILE" > "$FINAL_FILE.sha256"
fi

find "$BACKUP_DIR" -type f -name "pixelmania_postgres_${DB_NAME}_*.dump" -mtime "+$RETENTION_DAYS" -print -delete
find "$BACKUP_DIR" -type f -name "pixelmania_postgres_${DB_NAME}_*.dump.sha256" -mtime "+$RETENTION_DAYS" -print -delete

if command -v stat >/dev/null 2>&1; then
  echo "[postgres-backup] size_bytes=$(stat -c%s "$FINAL_FILE" 2>/dev/null || echo unknown)"
fi
echo "[postgres-backup] latest=$BACKUP_DIR/latest.dump"
echo "[postgres-backup] success"
