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
SCHEMA_NAME="${POSTGRES_SCHEMA:-$(read_env POSTGRES_SCHEMA pixelmania)}"
BACKUP_DIR="${PIXELMANIA_POSTGRES_BACKUP_DIR:-/var/backups/pixelmania/postgres}"
RESTORE_DB="${PIXELMANIA_RESTORE_CHECK_DATABASE:-${DB_NAME}_restore_check}"
KEEP_RESTORE_DB="${PIXELMANIA_KEEP_RESTORE_CHECK_DB:-false}"
BACKUP_FILE="${1:-$BACKUP_DIR/latest.dump}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file does not exist: $BACKUP_FILE" >&2
  exit 1
fi

if [[ ! "$RESTORE_DB" =~ ^[a-zA-Z0-9_]+$ ]]; then
  echo "Unsafe restore database name: $RESTORE_DB" >&2
  exit 1
fi

if [[ ! "$SCHEMA_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "Unsafe schema name: $SCHEMA_NAME" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is not installed. Install PostgreSQL client tools first." >&2
  exit 1
fi

cleanup() {
  if [ "$KEEP_RESTORE_DB" != "true" ]; then
    run_postgres dropdb --if-exists "$RESTORE_DB" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "[postgres-restore-check] using backup $BACKUP_FILE"
echo "[postgres-restore-check] restoring into $RESTORE_DB"

run_postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 --quiet --command \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$RESTORE_DB' AND pid <> pg_backend_pid();" >/dev/null
run_postgres dropdb --if-exists "$RESTORE_DB" >/dev/null 2>&1 || true
run_postgres createdb "$RESTORE_DB"
run_postgres pg_restore --dbname="$RESTORE_DB" --no-owner --no-privileges "$BACKUP_FILE"

echo "[postgres-restore-check] core table counts"
run_postgres psql --dbname="$RESTORE_DB" --set=ON_ERROR_STOP=1 --tuples-only --no-align <<SQL
SET search_path TO "$SCHEMA_NAME", public;
SELECT 'accounts=' || count(*) FROM accounts;
SELECT 'players=' || count(*) FROM players;
SELECT 'worlds=' || count(*) FROM worlds;
SELECT 'inventory_rows=' || count(*) FROM inventory;
SELECT 'item_transactions=' || count(*) FROM item_transactions;
SELECT 'gem_ledger=' || count(*) FROM gem_ledger;
SELECT 'world_block_changes=' || count(*) FROM world_block_changes;
SELECT 'world_snapshots=' || count(*) FROM world_snapshots;
SELECT 'security_events=' || count(*) FROM security_events;
SQL

if [ "$KEEP_RESTORE_DB" = "true" ]; then
  echo "[postgres-restore-check] kept restore database: $RESTORE_DB"
else
  echo "[postgres-restore-check] restore database will be removed"
fi
echo "[postgres-restore-check] success"
