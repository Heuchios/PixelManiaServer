param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$RemoteIp,

  [string]$RemoteUser = "root",
  [string]$RemoteDir = "PixelManiaServer",
  [string]$SshKeyPath,
  [string]$SmokeApiBase = "https://api.pixelmaniagame.com",
  [switch]$RunSmokeChecks
)

$ErrorActionPreference = "Stop"

$localBackend = Join-Path $PSScriptRoot "server.js"
$localPostgresStore = Join-Path $PSScriptRoot "postgres_store.js"
$localRedisStore = Join-Path $PSScriptRoot "redis_store.js"
$localEcosystem = Join-Path $PSScriptRoot "ecosystem.config.js"
$localPackage = Join-Path $PSScriptRoot "package.json"
$localSmoke = Join-Path $PSScriptRoot "smoke_postdeploy.ps1"
$localPostgresBackup = Join-Path $PSScriptRoot "scripts/postgres_backup.sh"
$localPostgresRestoreCheck = Join-Path $PSScriptRoot "scripts/postgres_restore_check.sh"
$localPostgresMaintenance = Join-Path $PSScriptRoot "scripts/postgres_maintenance.sh"

if (-not (Test-Path $localBackend)) {
  throw "Missing file: $localBackend"
}
if (-not (Test-Path $localPostgresStore)) {
  throw "Missing file: $localPostgresStore"
}
if (-not (Test-Path $localRedisStore)) {
  throw "Missing file: $localRedisStore"
}
if (-not (Test-Path $localEcosystem)) {
  throw "Missing file: $localEcosystem"
}
if (-not (Test-Path $localPackage)) {
  throw "Missing file: $localPackage"
}
if ($RunSmokeChecks -and -not (Test-Path $localSmoke)) {
  throw "Missing file: $localSmoke"
}
if (-not (Test-Path $localPostgresBackup)) {
  throw "Missing file: $localPostgresBackup"
}
if (-not (Test-Path $localPostgresRestoreCheck)) {
  throw "Missing file: $localPostgresRestoreCheck"
}
if (-not (Test-Path $localPostgresMaintenance)) {
  throw "Missing file: $localPostgresMaintenance"
}

$sshTarget = "${RemoteUser}@${RemoteIp}"
$remotePath = "~/$RemoteDir"
$healthUrl = ("$SmokeApiBase".TrimEnd("/") + "/health")

if ($SshKeyPath) {
  $sshBaseArgs = @("-i", $SshKeyPath, "-o", "BatchMode=yes")
} else {
  $sshBaseArgs = @()
}

function Invoke-RemoteCommand {
  param([string]$Command)
  & ssh @sshBaseArgs "$sshTarget" $Command
}

Write-Host "Copying backend files to ${sshTarget}:${remotePath}..."
Invoke-RemoteCommand "mkdir -p $remotePath/scripts"
& scp @sshBaseArgs $localBackend "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPostgresStore "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localRedisStore "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localEcosystem "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPackage "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPostgresBackup "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPostgresRestoreCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPostgresMaintenance "${sshTarget}:$remotePath/scripts/"

Write-Host "Restarting PM2 and verifying health..."
$remoteCommand = @'
set -euo pipefail
cd __REMOTE_PATH__
echo "== Files on droplet =="
grep -n "redis_stats\\|getHealthSnapshot" server.js || true
node --check server.js
node --check postgres_store.js
node --check redis_store.js
chmod +x scripts/postgres_backup.sh scripts/postgres_restore_check.sh
chmod +x scripts/postgres_maintenance.sh
pm2 delete pixelmania || true
pm2 startOrReload ecosystem.config.js --env production --update-env
pm2 save
echo "== Health =="
health_ok=0
for attempt in 1 2 3 4 5; do
  if health_payload="$(curl -fsS "__HEALTH_URL__" 2>/tmp/pixelmania-health.err)"; then
    echo "$health_payload"
    health_ok=1
    break
  fi
  echo "Health is not ready yet (attempt $attempt/5)."
  sleep 1
done
if [ "$health_ok" != "1" ]; then
  echo "Health check failed:"
  cat /tmp/pixelmania-health.err || true
  exit 1
fi
'@

$remoteCommand = $remoteCommand.Replace("__REMOTE_PATH__", $remotePath).Replace("__HEALTH_URL__", $healthUrl)

Invoke-RemoteCommand $remoteCommand

if ($RunSmokeChecks) {
  Write-Host "Running local post-deploy smoke checks against $SmokeApiBase ..."
  & powershell -ExecutionPolicy Bypass -File $localSmoke -ApiBase $SmokeApiBase -RequireRedisReady -RequireRedisStats
}

Write-Host "Done. If curl output does not show persistence.redis_stats, run:"
Write-Host "ssh $sshTarget 'cd $remotePath && sed -n \"1235,1270p\" server.js'"
