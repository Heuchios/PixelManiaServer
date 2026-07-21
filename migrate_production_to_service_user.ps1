[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$RemoteIp,

  [string]$RootUser = "root",
  [string]$ServiceUser = "pixelmania",
  [string]$RemoteDir = "PixelManiaServer",
  [string]$SshKeyPath,
  [ValidateRange(1, 1440)]
  [int]$SnapshotIntervalMinutes = 60,
  [ValidateRange(1, 1000)]
  [int]$SnapshotMaxWorldsPerCycle = 5,
  [switch]$AllowActivePlayers
)

$ErrorActionPreference = "Stop"

foreach ($entry in @(
  @{ Name = "RootUser"; Value = $RootUser },
  @{ Name = "ServiceUser"; Value = $ServiceUser },
  @{ Name = "RemoteDir"; Value = $RemoteDir }
)) {
  if (-not $entry.Value -or $entry.Value -notmatch "^[A-Za-z0-9._-]+$") {
    throw "$($entry.Name) contains unsupported characters."
  }
}

if (-not $RemoteIp -or $RemoteIp -notmatch "^[A-Za-z0-9.:-]+$") {
  throw "RemoteIp contains unsupported characters."
}

if (-not $SshKeyPath) {
  $keyCandidates = @(
    (Join-Path $HOME ".ssh\pixelmania_ed25519"),
    (Join-Path $HOME ".ssh\id_ed25519")
  )
  $SshKeyPath = $keyCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $SshKeyPath -or -not (Test-Path -LiteralPath $SshKeyPath)) {
  throw "SSH key not found. Pass -SshKeyPath explicitly."
}

$publicKey = (& ssh-keygen -y -f $SshKeyPath 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $publicKey) {
  throw "Could not derive the public key from $SshKeyPath."
}
$authorizedKey = "$publicKey pixelmania-deploy"
$authorizedKeyBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($authorizedKey))

$allowActivePlayersValue = if ($AllowActivePlayers) { "1" } else { "0" }
$serviceUserRemoteCommand = @'
#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_SOURCE="/root/__REMOTE_DIR__"
SERVICE_USER="__SERVICE_USER__"
SERVICE_HOME="/home/$SERVICE_USER"
SERVICE_GROUP="$SERVICE_USER"
TARGET_ROOT="$SERVICE_HOME/__REMOTE_DIR__"
SERVICE_PM2_HOME="$SERVICE_HOME/.pm2"
ROOT_PM2_HOME="/root/.pm2"
AUTHORIZED_KEY_B64='__AUTHORIZED_KEY_B64__'
SNAPSHOT_INTERVAL_MINUTES='__SNAPSHOT_INTERVAL_MINUTES__'
SNAPSHOT_MAX_WORLDS_PER_CYCLE='__SNAPSHOT_MAX_WORLDS_PER_CYCLE__'
ALLOW_ACTIVE_PLAYERS='__ALLOW_ACTIVE_PLAYERS__'
HEALTH_URL="http://127.0.0.1:8080/health"
ROOT_APPS=(pixelmania pixelmania-a pixelmania-b pixelmania-ops)
CUTOVER_STARTED=0

run_service() {
  (
    cd "$SERVICE_HOME"
    runuser -u "$SERVICE_USER" -- env \
      HOME="$SERVICE_HOME" \
      USER="$SERVICE_USER" \
      LOGNAME="$SERVICE_USER" \
      PM2_HOME="$SERVICE_PM2_HOME" \
      PATH="$PATH" \
      "$@"
  )
}

root_pm2() {
  env HOME=/root PM2_HOME="$ROOT_PM2_HOME" pm2 "$@"
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temp_file="${file}.next.$$"
  awk -v key="$key" 'index($0, key "=") != 1 { print }' "$file" > "$temp_file"
  printf '%s=%s\n' "$key" "$value" >> "$temp_file"
  chown "$SERVICE_USER:$SERVICE_GROUP" "$temp_file"
  chmod 0600 "$temp_file"
  mv -f "$temp_file" "$file"
}

read_health_number() {
  local expression="$1"
  curl -fsS "$HEALTH_URL" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const health = JSON.parse(input);
      const expression = process.argv[1].split(".");
      let value = health;
      for (const key of expression) value = value && value[key];
      process.stdout.write(String(Number(value) || 0));
    });
  ' "$expression"
}

read_release_id() {
  local url="$1"
  curl -fsS "$url" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const health = JSON.parse(input);
      process.stdout.write(String(health.release_id || ""));
    });
  '
}

wait_for_release_health() {
  local expected_release="$1"
  local attempt
  local port
  local actual
  for attempt in $(seq 1 45); do
    local all_ready=1
    for port in 8080 18091 18092; do
      actual="$(read_release_id "http://127.0.0.1:${port}/health" 2>/dev/null || true)"
      if [ "$actual" != "$expected_release" ]; then
        all_ready=0
        break
      fi
    done
    if [ "$all_ready" = "1" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

restore_root_processes() {
  set +e
  echo "Restoring the original root-run PM2 processes." >&2
  systemctl disable --now "pm2-${SERVICE_USER}.service" >/dev/null 2>&1 || true
  run_service pm2 delete "${ROOT_APPS[@]}" >/dev/null 2>&1 || true
  run_service pm2 save --force >/dev/null 2>&1 || true
  run_service pm2 kill >/dev/null 2>&1 || true
  for app in "${ROOT_APPS[@]}"; do
    root_pm2 restart "$app" --update-env >/dev/null 2>&1 || true
  done
  root_pm2 save --force >/dev/null 2>&1 || true
  systemctl enable --now pm2-root.service >/dev/null 2>&1 || true
  set -e
}

on_error() {
  local exit_code=$?
  if [ "$CUTOVER_STARTED" = "1" ]; then
    restore_root_processes
  fi
  exit "$exit_code"
}
trap on_error ERR

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this migration through the root SSH account." >&2
  exit 1
fi
if [ ! -L "$ROOT_SOURCE/current" ] || [ ! -f "$ROOT_SOURCE/current/release.json" ]; then
  echo "The root deployment does not have an active versioned release at $ROOT_SOURCE/current." >&2
  exit 1
fi

active_sessions="$(read_health_number 'persistence.redis_stats.key_counts.active_sessions')"
indexed_players="$(read_health_number 'persistence.world_index.indexed_player_count')"
if [ "$ALLOW_ACTIVE_PLAYERS" != "1" ] && { [ "$active_sessions" -gt 0 ] || [ "$indexed_players" -gt 0 ]; }; then
  echo "Migration refused while players are active (sessions=$active_sessions, indexed_players=$indexed_players)." >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$SERVICE_USER"
fi
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$SERVICE_HOME/.ssh"
authorized_key="$(printf '%s' "$AUTHORIZED_KEY_B64" | base64 --decode)"
touch "$SERVICE_HOME/.ssh/authorized_keys"
if ! grep -qxF "$authorized_key" "$SERVICE_HOME/.ssh/authorized_keys"; then
  printf '%s\n' "$authorized_key" >> "$SERVICE_HOME/.ssh/authorized_keys"
fi
chown "$SERVICE_USER:$SERVICE_GROUP" "$SERVICE_HOME/.ssh/authorized_keys"
chmod 0600 "$SERVICE_HOME/.ssh/authorized_keys"

install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$TARGET_ROOT"
rsync -aH \
  --exclude current \
  --exclude previous \
  "$ROOT_SOURCE/" "$TARGET_ROOT/"

current_name="$(basename "$(readlink -f "$ROOT_SOURCE/current")")"
previous_name="$(basename "$(readlink -f "$ROOT_SOURCE/previous")")"
if [ ! -d "$TARGET_ROOT/releases/$current_name" ] || [ ! -d "$TARGET_ROOT/releases/$previous_name" ]; then
  echo "Could not map the current and previous release directories into $TARGET_ROOT." >&2
  exit 1
fi
ln -sfn "$TARGET_ROOT/releases/$current_name" "$TARGET_ROOT/current"
ln -sfn "$TARGET_ROOT/releases/$previous_name" "$TARGET_ROOT/previous"

for release_dir in "$TARGET_ROOT"/releases/*; do
  [ -d "$release_dir" ] || continue
  ln -sfn "$TARGET_ROOT/shared/.env" "$release_dir/.env"
  if [ -f "$release_dir/.release-env" ]; then
    set_env_value "$release_dir/.release-env" PIXELMANIA_RELEASE_ROOT "$TARGET_ROOT"
    chmod 0640 "$release_dir/.release-env"
  fi
done

set_env_value "$TARGET_ROOT/shared/.env" WORLD_SNAPSHOT_INTERVAL_MINUTES "$SNAPSHOT_INTERVAL_MINUTES"
set_env_value "$TARGET_ROOT/shared/.env" WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE "$SNAPSHOT_MAX_WORLDS_PER_CYCLE"
set_env_value "$TARGET_ROOT/shared/.env" WORLD_SNAPSHOT_STARTUP_RUN false

install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" /var/lib/pixelmania /var/lib/pixelmania-route-production
chown -R "$SERVICE_USER:$SERVICE_GROUP" /var/lib/pixelmania /var/lib/pixelmania-route-production

if [ -d /root/.aws ]; then
  install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$SERVICE_HOME/.aws"
  rsync -a /root/.aws/ "$SERVICE_HOME/.aws/"
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$SERVICE_HOME/.aws"
  find "$SERVICE_HOME/.aws" -type d -exec chmod 0700 {} +
  find "$SERVICE_HOME/.aws" -type f -exec chmod 0600 {} +
fi

chown -R "$SERVICE_USER:$SERVICE_GROUP" "$TARGET_ROOT"

smoke_root="$(mktemp -d /tmp/pixelmania-snapshot-restore.XXXXXX)"
trap 'rm -rf -- "$smoke_root"' EXIT
chown "$SERVICE_USER:$SERVICE_GROUP" "$smoke_root"
chmod 0750 "$smoke_root"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$smoke_root/worlds"
cat > "$smoke_root/worlds/RESTORE_SMOKE.json" <<'JSON'
{"world_name":"RESTORE_SMOKE","blocks":[{"x":1,"y":2,"block_type":"dirt"}],"background_blocks":[],"seeds":[],"interactions":{}}
JSON
chown "$SERVICE_USER:$SERVICE_GROUP" "$smoke_root/worlds/RESTORE_SMOKE.json"
run_service env \
  PIXELMANIA_DATA_DIR="$smoke_root" \
  WORLD_SAVE_FOLDER="$smoke_root/worlds" \
  WORLD_SNAPSHOT_FOLDER="$smoke_root/world_snapshots" \
  INTEGRITY_LOG_FOLDER="$smoke_root/integrity_logs" \
  POSTGRES_ENABLED=false \
  node "$TARGET_ROOT/current/scripts/world_snapshot_tool.js" create RESTORE_SMOKE --reason service_user_smoke >/dev/null
printf '%s\n' '{"world_name":"RESTORE_SMOKE","blocks":[{"x":1,"y":2,"block_type":"stone"}],"background_blocks":[],"seeds":[],"interactions":{}}' > "$smoke_root/worlds/RESTORE_SMOKE.json"
chown "$SERVICE_USER:$SERVICE_GROUP" "$smoke_root/worlds/RESTORE_SMOKE.json"
run_service env \
  PIXELMANIA_DATA_DIR="$smoke_root" \
  WORLD_SAVE_FOLDER="$smoke_root/worlds" \
  WORLD_SNAPSHOT_FOLDER="$smoke_root/world_snapshots" \
  INTEGRITY_LOG_FOLDER="$smoke_root/integrity_logs" \
  POSTGRES_ENABLED=false \
  node "$TARGET_ROOT/current/scripts/world_snapshot_tool.js" restore RESTORE_SMOKE --latest --apply >/dev/null
node -e '
  const fs = require("fs");
  const world = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (world.blocks?.[0]?.block_type !== "dirt") process.exit(1);
' "$smoke_root/worlds/RESTORE_SMOKE.json"
echo "Snapshot create/restore smoke test passed as $SERVICE_USER."

run_service pm2 ping >/dev/null 2>&1
pm2 startup systemd -u "$SERVICE_USER" --hp "$SERVICE_HOME" >/tmp/pixelmania-pm2-startup.log
systemctl daemon-reload

if [ -f "$ROOT_PM2_HOME/dump.pm2" ]; then
  cp -p "$ROOT_PM2_HOME/dump.pm2" "$ROOT_PM2_HOME/dump.pre-pixelmania-user.pm2"
fi

expected_release="$(node -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(value.release_id || ""));' "$TARGET_ROOT/current/release.json")"
if [ -z "$expected_release" ]; then
  echo "Could not read the expected release ID." >&2
  exit 1
fi

CUTOVER_STARTED=1
for app in "${ROOT_APPS[@]}"; do
  root_pm2 stop "$app" >/dev/null 2>&1 || true
done

run_service bash -c '
  set -Eeuo pipefail
  current_link="$1"
  target_root="$2"
  set -a
  . "$current_link/.release-env"
  set +a
  export PIXELMANIA_BACKEND_ROOT="$current_link"
  export PIXELMANIA_RELEASE_ROOT="$target_root"
  cd "$current_link"
  "$target_root/bin/activate_main_release.sh" "$current_link"
  PIXELMANIA_BACKEND_ROOT="$current_link" \
  PIXELMANIA_RELEASE_ROOT="$target_root" \
  ROUTE_PRODUCTION_PM2_CONFIG="$target_root/shared/ecosystem.route-production.config.js" \
  ROUTE_PRODUCTION_QUIET=true \
    bash scripts/start_route_production_instances.sh
  pm2 startOrReload ecosystem.ops.config.js --env production --update-env
  pm2 save
' bash "$TARGET_ROOT/current" "$TARGET_ROOT"

if ! wait_for_release_health "$expected_release"; then
  echo "The non-root processes did not become healthy for release $expected_release." >&2
  exit 1
fi

run_service pm2 save
run_service pm2 kill
systemctl reset-failed "pm2-${SERVICE_USER}.service" >/dev/null 2>&1 || true
systemctl enable "pm2-${SERVICE_USER}.service" >/dev/null
systemctl start "pm2-${SERVICE_USER}.service"
systemctl is-active --quiet "pm2-${SERVICE_USER}.service"
if ! wait_for_release_health "$expected_release"; then
  echo "The systemd-managed non-root processes did not become healthy for release $expected_release." >&2
  exit 1
fi
systemctl disable --now pm2-root.service >/dev/null 2>&1 || true

CUTOVER_STARTED=0
trap - ERR
rm -rf -- "$smoke_root"
trap - EXIT

echo "== Dedicated service user migration complete =="
printf 'service user: %s\n' "$SERVICE_USER"
printf 'release root: %s\n' "$TARGET_ROOT"
printf 'release id:   %s\n' "$expected_release"
run_service pm2 list
for port in 8080 18091 18092; do
  printf 'health %s: %s\n' "$port" "$(read_release_id "http://127.0.0.1:${port}/health")"
done
systemctl is-enabled "pm2-${SERVICE_USER}.service"
'@

$serviceUserRemoteCommand = $serviceUserRemoteCommand.
  Replace("__REMOTE_DIR__", $RemoteDir).
  Replace("__SERVICE_USER__", $ServiceUser).
  Replace("__AUTHORIZED_KEY_B64__", $authorizedKeyBase64).
  Replace("__SNAPSHOT_INTERVAL_MINUTES__", [string]$SnapshotIntervalMinutes).
  Replace("__SNAPSHOT_MAX_WORLDS_PER_CYCLE__", [string]$SnapshotMaxWorldsPerCycle).
  Replace("__ALLOW_ACTIVE_PLAYERS__", $allowActivePlayersValue).
  Replace("`r`n", "`n")

$sshArgs = @(
  "-i", $SshKeyPath,
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15",
  "${RootUser}@${RemoteIp}",
  "bash -se"
)

Write-Host "Migrating PixelMania to the '$ServiceUser' Linux account on $RemoteIp..."
$processStart = [System.Diagnostics.ProcessStartInfo]::new()
$processStart.FileName = "ssh"
$processStart.UseShellExecute = $false
$processStart.RedirectStandardInput = $true
foreach ($argument in $sshArgs) {
  [void]$processStart.ArgumentList.Add($argument)
}
$process = [System.Diagnostics.Process]::Start($processStart)
$process.StandardInput.Write($serviceUserRemoteCommand)
$process.StandardInput.Close()
$process.WaitForExit()
if ($process.ExitCode -ne 0) {
  throw "Service-user migration failed with exit code $($process.ExitCode). The script restores the root PM2 processes after a cutover failure."
}

$serviceTarget = "${ServiceUser}@${RemoteIp}"
& ssh -i $SshKeyPath -o BatchMode=yes -o ConnectTimeout=15 $serviceTarget "cd ~/$RemoteDir && pm2 list && bash bin/rollback_release.sh --status"
if ($LASTEXITCODE -ne 0) {
  throw "The service-user SSH verification failed."
}

Write-Host "Migration verified. Future deploys and rollbacks now use ${serviceTarget}."
