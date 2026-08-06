#!/usr/bin/env bash
# Replace the staging database with a snapshot of production, so staging exercises
# real world_state, inventory and account shapes rather than synthetic fixtures.
#
# Run as root on the droplet:
#   sudo bash clone_production_to_staging.sh
#
# This is one-way and destructive to STAGING only. It never writes to production;
# the production connection is opened read-only by pg_dump.
#
# Run it off-peak. pg_dump takes a consistent snapshot of a ~100-world JSONB database
# on the same four vCPUs that serve live players, and the read burst is the one part of
# having staging on this box that players could actually feel.
set -Eeuo pipefail

PROD_DB="${PROD_DB:-pixelmania}"
STG_DB="${STG_DB:-pixelmania_staging}"
STG_DB_USER="${STG_DB_USER:-pixelmania_stg}"
STG_SCHEMA="${STG_SCHEMA:-pixelmania}"
STG_USER="${STG_USER:-pixelmania-stg}"
STG_REDIS_DB="${STG_REDIS_DB:-1}"
STG_APP="${STG_APP:-pixelmania}"
DUMP_DIR="${DUMP_DIR:-/var/tmp}"

log() { printf '\n== %s ==\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run this as root."

# --- Guards. Every one of these has to pass before anything is dropped. -------
case "$STG_DB" in
  *staging*|*stg*) ;;
  *) fail "Refusing to drop '$STG_DB': the target database name must contain 'staging' or 'stg'." ;;
esac
[ "$STG_DB" != "$PROD_DB" ] || fail "Source and target database are the same. Refusing."
[ "$STG_REDIS_DB" != "0" ] || fail "Refusing to flush Redis DB 0; that is production."
# This script stops and starts "$STG_APP" in "$STG_USER"'s PM2 daemon. Staging's app is
# also named "pixelmania", so a wrong STG_USER here would stop the LIVE server.
[ "$STG_USER" != "pixelmania" ] || fail "STG_USER is the production account; refusing to touch its PM2 daemon."
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$STG_DB'" | grep -q 1 \
  || fail "Staging database '$STG_DB' does not exist. Run provision_staging.sh first."

if [ "${ASSUME_YES:-0}" != "1" ]; then
  printf 'This DESTROYS all data in %s and replaces it with a copy of %s.\n' "$STG_DB" "$PROD_DB"
  read -r -p "Type CLONE to continue: " answer
  [ "$answer" = "CLONE" ] || { echo "Canceled."; exit 0; }
fi

DUMP_FILE="$(mktemp "$DUMP_DIR/pixelmania-prod-XXXXXX.dump")"
cleanup() { rm -f -- "$DUMP_FILE"; }
trap cleanup EXIT

log "Stopping the staging server"
# Stopped, not just paused: a live staging process holding connections would block
# DROP SCHEMA and would write into a half-restored database.
sudo -u "$STG_USER" -H bash -lc "pm2 stop $STG_APP" >/dev/null 2>&1 || echo "Staging app was not running."

log "Dumping production schema '$STG_SCHEMA' from '$PROD_DB' (read-only)"
sudo -u postgres pg_dump --format=custom --no-owner --no-privileges \
  --schema="$STG_SCHEMA" --dbname="$PROD_DB" --file="$DUMP_FILE"
printf 'Dump size: %s\n' "$(du -h "$DUMP_FILE" | cut -f1)"

log "Matching extensions"
# pg_dump -n <schema> omits extensions living in public, so create them explicitly
# or the restore fails on the first gen_random_uuid()/digest() default.
while IFS= read -r extension; do
  [ -n "$extension" ] || continue
  echo "  ensuring extension: $extension"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$STG_DB" \
    -c "CREATE EXTENSION IF NOT EXISTS \"$extension\";"
done < <(sudo -u postgres psql -tA -d "$PROD_DB" \
  -c "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql';")

log "Replacing schema '$STG_SCHEMA' in '$STG_DB'"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$STG_DB" <<SQL
DROP SCHEMA IF EXISTS $STG_SCHEMA CASCADE;
SQL

log "Restoring into '$STG_DB' as '$STG_DB_USER'"
sudo -u postgres pg_restore --no-owner --role="$STG_DB_USER" \
  --dbname="$STG_DB" --exit-on-error "$DUMP_FILE"

sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$STG_DB" <<SQL
ALTER SCHEMA $STG_SCHEMA OWNER TO $STG_DB_USER;
GRANT ALL ON SCHEMA $STG_SCHEMA TO $STG_DB_USER;
GRANT ALL ON ALL TABLES IN SCHEMA $STG_SCHEMA TO $STG_DB_USER;
GRANT ALL ON ALL SEQUENCES IN SCHEMA $STG_SCHEMA TO $STG_DB_USER;
SQL

log "Flushing staging Redis DB $STG_REDIS_DB"
# Presence, world routes and admission tickets from before the clone now point at
# world revisions that no longer exist. Left in place they produce exactly the
# permanently-unjoinable-world symptom that route epoch fencing was written to fix.
redis-cli -n "$STG_REDIS_DB" FLUSHDB >/dev/null

log "Starting the staging server"
sudo -u "$STG_USER" -H bash -lc "pm2 start $STG_APP --update-env" >/dev/null 2>&1 \
  || sudo -u "$STG_USER" -H bash -lc "pm2 restart $STG_APP --update-env" >/dev/null 2>&1 \
  || echo "Could not start $STG_APP via PM2; deploy staging first."

log "Verifying"
worlds="$(sudo -u postgres psql -tA -d "$STG_DB" -c "SELECT count(*) FROM $STG_SCHEMA.world_state;" 2>/dev/null || echo "?")"
printf 'Staging worlds restored: %s\n' "$worlds"

cat <<'SUMMARY'

Clone complete.

Note: this copies real account rows, including password hashes and email addresses,
onto an environment with looser login rate limits and no SMTP. Treat the staging
subdomain as production-sensitive, and do not hand out access to it.
SUMMARY
