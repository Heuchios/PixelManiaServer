#!/usr/bin/env bash
# Provision the PixelMania staging environment on the SAME droplet as production.
#
# Run once, as root, on the droplet:
#   sudo bash provision_staging.sh
#
# Isolation model — the whole design rests on this: staging runs as its own OS user, so it
# gets its own PM2 daemon. That is what makes a staging deploy structurally unable to touch
# production, because deploy_to_droplet.ps1 and rollback_release.sh both decide what to
# restart with `pm2 describe pixelmania-a` / `pixelmania-ops`. Run under the production user
# those probes succeed and a staging deploy restarts PRODUCTION's route instances pointing
# at staging's release directory. Run under pixelmania-stg they fail, and staging only ever
# touches its own single app.
#
# Never "simplify" this by running staging under the pixelmania user.
set -Eeuo pipefail

STG_USER="${STG_USER:-pixelmania-stg}"
PROD_USER="${PROD_USER:-pixelmania}"
STG_PORT="${STG_PORT:-8180}"
STG_HOSTNAME="${STG_HOSTNAME:-staging-api.pixelmaniagame.com}"
STG_DB="${STG_DB:-pixelmania_staging}"
STG_DB_USER="${STG_DB_USER:-pixelmania_stg}"
STG_REDIS_DB="${STG_REDIS_DB:-1}"
STG_REDIS_PREFIX="${STG_REDIS_PREFIX:-pixelmania_stg}"
STG_DATA_DIR="${STG_DATA_DIR:-/var/lib/pixelmania-staging}"
STG_BASE_DIR_NAME="${STG_BASE_DIR_NAME:-PixelManiaServer}"
CADDY_SNIPPET="/etc/caddy/staging.pixelmania.caddy"

STG_HOME="/home/$STG_USER"
STG_BASE_DIR="$STG_HOME/$STG_BASE_DIR_NAME"
STG_SHARED="$STG_BASE_DIR/shared"
STG_ENV="$STG_SHARED/.env"

log() { printf '\n== %s ==\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run this as root (sudo bash provision_staging.sh)."

log "Preflight"
for binary in node npm pm2 psql redis-cli sudo openssl ss adduser; do
  command -v "$binary" >/dev/null 2>&1 || fail "Missing required command: $binary"
done
id "$PROD_USER" >/dev/null 2>&1 || fail "Production user '$PROD_USER' does not exist; check PROD_USER."
[ "$STG_USER" != "$PROD_USER" ] || fail "STG_USER must not be the production user; the separate PM2 daemon is the whole isolation model."

if [ "$STG_PORT" = "8080" ] || [ "$STG_PORT" = "18091" ] || [ "$STG_PORT" = "18092" ]; then
  fail "STG_PORT $STG_PORT collides with a production listener."
fi
if ss -ltn "sport = :$STG_PORT" 2>/dev/null | grep -q LISTEN; then
  fail "Port $STG_PORT is already in use."
fi
case "$STG_DB" in
  *staging*|*stg*) ;;
  *) fail "STG_DB '$STG_DB' must contain 'staging' or 'stg'. This guard is what stops a typo from pointing staging at the live database." ;;
esac
[ "$STG_DB" != "pixelmania" ] || fail "STG_DB must not be the production database."
[ "$STG_REDIS_DB" != "0" ] || fail "STG_REDIS_DB must not be 0; production uses Redis DB 0."

log "Staging OS user: $STG_USER"
if id "$STG_USER" >/dev/null 2>&1; then
  echo "User already exists."
else
  adduser --disabled-password --gecos "PixelMania staging" "$STG_USER"
fi

log "SSH access"
install -d -m 0700 -o "$STG_USER" -g "$STG_USER" "$STG_HOME/.ssh"
if [ -f "$STG_HOME/.ssh/authorized_keys" ] && [ -s "$STG_HOME/.ssh/authorized_keys" ]; then
  echo "authorized_keys already present; leaving it alone."
elif [ -s "/home/$PROD_USER/.ssh/authorized_keys" ]; then
  install -m 0600 -o "$STG_USER" -g "$STG_USER" \
    "/home/$PROD_USER/.ssh/authorized_keys" "$STG_HOME/.ssh/authorized_keys"
  echo "Copied authorized_keys from $PROD_USER so the same deploy key works."
else
  echo "WARNING: no authorized_keys found for $PROD_USER. Add your public key to $STG_HOME/.ssh/authorized_keys manually."
fi

log "Release directory layout: $STG_BASE_DIR"
sudo -u "$STG_USER" mkdir -p \
  "$STG_BASE_DIR/incoming" \
  "$STG_BASE_DIR/releases" \
  "$STG_SHARED" \
  "$STG_BASE_DIR/bin"

log "Save-data directory: $STG_DATA_DIR"
install -d -m 0750 -o "$STG_USER" -g "$STG_USER" "$STG_DATA_DIR"

log "PostgreSQL role and database"
DB_PASSWORD=""
if [ -f "$STG_ENV" ]; then
  DB_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$STG_ENV" | head -n 1)"
fi
if [ -z "$DB_PASSWORD" ]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  echo "Generated a new staging database password."
else
  echo "Reusing the password already in $STG_ENV."
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$STG_DB_USER') THEN
    CREATE ROLE $STG_DB_USER LOGIN;
  END IF;
END
\$\$;
ALTER ROLE $STG_DB_USER WITH PASSWORD '$DB_PASSWORD';
-- Staging must never be able to exhaust the connection slots production needs.
ALTER ROLE $STG_DB_USER CONNECTION LIMIT 10;
SQL

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$STG_DB'" | grep -q 1; then
  echo "Database $STG_DB already exists."
else
  sudo -u postgres createdb -O "$STG_DB_USER" "$STG_DB"
  echo "Created database $STG_DB owned by $STG_DB_USER."
fi
# Belt and braces: the staging role must have no rights at all on the production database.
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d pixelmania \
  -c "REVOKE ALL ON DATABASE pixelmania FROM $STG_DB_USER;" 2>/dev/null || true

log "Redis"
redis-cli -n "$STG_REDIS_DB" PING >/dev/null || fail "Cannot reach Redis DB $STG_REDIS_DB."
echo "Staging will use Redis DB $STG_REDIS_DB with key prefix '$STG_REDIS_PREFIX' (production uses DB 0 / 'pixelmania')."

log "Staging .env"
if [ -f "$STG_ENV" ]; then
  echo "$STG_ENV already exists; not overwriting. Delete it and re-run to regenerate."
else
  SNIPPET_SOURCE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/env.staging.example"
  [ -f "$SNIPPET_SOURCE" ] || fail "Missing template: $SNIPPET_SOURCE"
  sed \
    -e "s|__STG_PORT__|$STG_PORT|g" \
    -e "s|__STG_HOSTNAME__|$STG_HOSTNAME|g" \
    -e "s|__STG_DB__|$STG_DB|g" \
    -e "s|__STG_DB_USER__|$STG_DB_USER|g" \
    -e "s|__STG_DB_PASSWORD__|$DB_PASSWORD|g" \
    -e "s|__STG_REDIS_DB__|$STG_REDIS_DB|g" \
    -e "s|__STG_REDIS_PREFIX__|$STG_REDIS_PREFIX|g" \
    -e "s|__STG_DATA_DIR__|$STG_DATA_DIR|g" \
    -e "s|__STG_HONOR_SECRET__|$(openssl rand -hex 32)|g" \
    -e "s|__STG_NETFOX_SECRET__|$(openssl rand -hex 32)|g" \
    "$SNIPPET_SOURCE" | tr -d '\r' > "$STG_ENV"
  # tr -d '\r': .gitattributes forces LF only for *.sh and *.ps1. If this template ever
  # reaches the droplet with CRLF, every value picks up a trailing carriage return and the
  # database password silently stops matching.
  chown "$STG_USER:$STG_USER" "$STG_ENV"
  chmod 0600 "$STG_ENV"
  echo "Wrote $STG_ENV"
fi

printf 'http://127.0.0.1:%s/health\n' "$STG_PORT" > "$STG_SHARED/health_url"
chown "$STG_USER:$STG_USER" "$STG_SHARED/health_url"
chmod 0644 "$STG_SHARED/health_url"

log "PM2 daemon for $STG_USER"
sudo -u "$STG_USER" -H bash -lc 'pm2 ping >/dev/null 2>&1 || true'
startup_command="$(sudo -u "$STG_USER" -H bash -lc "pm2 startup systemd -u $STG_USER --hp $STG_HOME" | grep -E '^sudo env' || true)"
if [ -n "$startup_command" ]; then
  echo "Enabling PM2 boot persistence for $STG_USER..."
  eval "${startup_command#sudo }"
else
  echo "PM2 startup already configured (or reported nothing to run)."
fi
sudo -u "$STG_USER" -H bash -lc 'pm2 save --force' >/dev/null 2>&1 || true

log "Caddy site for $STG_HOSTNAME"
if command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ]; then
  # The staging site logs to journald, not to a file. A file-logging block passes
  # `caddy validate` (which checks config only, never the filesystem) and then fails the
  # reload against the caddy unit's sandboxing -- on the same Caddy that fronts
  # production. Read staging's logs with: journalctl -u caddy | grep staging-api
  SNIPPET_SOURCE="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/Caddyfile.staging"
  sed -e "s|__STG_HOSTNAME__|$STG_HOSTNAME|g" -e "s|__STG_PORT__|$STG_PORT|g" \
    "$SNIPPET_SOURCE" | tr -d '\r' > "$CADDY_SNIPPET"
  chmod 0644 "$CADDY_SNIPPET"

  BACKUP="/etc/caddy/Caddyfile.bak.pixelmania-staging"
  cp -p /etc/caddy/Caddyfile "$BACKUP"
  if ! grep -qF "import $CADDY_SNIPPET" /etc/caddy/Caddyfile; then
    printf '\nimport %s\n' "$CADDY_SNIPPET" >> /etc/caddy/Caddyfile
  fi

  # Restore on ANY failure, not just a validate failure. A reload that fails leaves the
  # running process on the old config but leaves the BROKEN config on disk, so the next
  # restart or reboot would take production's edge down. Never leave that state behind.
  caddy_restore() {
    cp -p "$BACKUP" /etc/caddy/Caddyfile
    systemctl reload caddy >/dev/null 2>&1 || true
    echo "The original Caddyfile was restored; production is unaffected."
    echo "Diagnose with: journalctl -xeu caddy --no-pager | tail -40"
    echo "Then add this line to /etc/caddy/Caddyfile and reload:"
    echo "  import $CADDY_SNIPPET"
  }

  if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    echo "WARNING: caddy validate failed."
    caddy_restore
  elif ! systemctl reload caddy; then
    echo "WARNING: caddy reload failed even though the config validated."
    caddy_restore
  else
    echo "Caddy reloaded with the staging site. Backup of the previous Caddyfile: $BACKUP"
  fi
else
  echo "Caddy not detected. Serve $STG_HOSTNAME -> 127.0.0.1:$STG_PORT yourself."
fi

log "Done"
cat <<SUMMARY
Staging environment provisioned.

  OS user       $STG_USER          (own PM2 daemon: sudo -u $STG_USER pm2 list)
  Base dir      $STG_BASE_DIR
  Env file      $STG_ENV
  Node port     $STG_PORT          (production: 8080 / 18091 / 18092)
  Database      $STG_DB as $STG_DB_USER
  Redis         DB $STG_REDIS_DB, prefix $STG_REDIS_PREFIX
  Data dir      $STG_DATA_DIR
  Public URL    https://$STG_HOSTNAME

Remaining manual steps:
  1. Add a Cloudflare DNS record for $STG_HOSTNAME pointing at this droplet (proxied).
  2. From Windows:  .\\deploy_staging.ps1
  3. Seed data:     sudo bash $STG_BASE_DIR/current/staging/clone_production_to_staging.sh
SUMMARY
