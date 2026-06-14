param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$RemoteIp,

  [string]$RemoteUser = "root",
  [string]$RemoteDir = "PixelManiaServer",
  [string]$SshKeyPath,
  [string]$SmokeApiBase = "https://api.pixelmaniagame.com",
  [string]$ClientVersion,
  [string]$MinClientVersion,
  [string]$UpdateUrl,
  [switch]$ForceClientUpdate,
  [switch]$RunSmokeChecks
)

$ErrorActionPreference = "Stop"

function Resolve-RepoDoc {
  param([string]$FileName)

  $candidateRoots = @()
  if ($env:PIXELMANIA_CLIENT_ROOT) {
    $candidateRoots += $env:PIXELMANIA_CLIENT_ROOT
  }
  $candidateRoots += Split-Path -Parent $PSScriptRoot
  $candidateRoots += Join-Path (Split-Path -Parent $PSScriptRoot) "pixel-mania"
  $candidateRoots += (Get-Location).Path

  foreach ($candidateRoot in $candidateRoots) {
    if (-not $candidateRoot) {
      continue
    }

    $candidatePath = Join-Path $candidateRoot "docs/$FileName"
    if (Test-Path $candidatePath) {
      return $candidatePath
    }
  }

  throw "Could not find docs/$FileName. Run from the Godot repo root or set PIXELMANIA_CLIENT_ROOT."
}

$localBackend = Join-Path $PSScriptRoot "server.js"
$localServerItemDatabase = Join-Path $PSScriptRoot "server_item_database.js"
$localClientItemDatabase = Join-Path (Split-Path -Parent $PSScriptRoot) "Scripts/item_database.gd"
$localDeveloperPanelUi = Join-Path (Split-Path -Parent $PSScriptRoot) "Scripts/developer_panel_ui.gd"
$localNetworkManager = Join-Path (Split-Path -Parent $PSScriptRoot) "Scripts/network_manager.gd"
$localWorldScript = Join-Path (Split-Path -Parent $PSScriptRoot) "Scripts/world.gd"
$localPostgresStore = Join-Path $PSScriptRoot "postgres_store.js"
$localRedisStore = Join-Path $PSScriptRoot "redis_store.js"
$localEcosystem = Join-Path $PSScriptRoot "ecosystem.config.js"
$localPackage = Join-Path $PSScriptRoot "package.json"
$localSmoke = Join-Path $PSScriptRoot "smoke_postdeploy.ps1"
$localPostgresSchema = Join-Path $PSScriptRoot "docs/postgres_security_foundation.sql"
$localBackendPersistenceRules = Resolve-RepoDoc "backend_persistence_rules.md"
$localCodexHandoffStatus = Resolve-RepoDoc "codex_handoff_status.md"
$localProductionBackendWiring = Resolve-RepoDoc "production_backend_wiring.md"
$localPostgresBackup = Join-Path $PSScriptRoot "scripts/postgres_backup.sh"
$localPostgresRestoreCheck = Join-Path $PSScriptRoot "scripts/postgres_restore_check.sh"
$localPostgresMaintenance = Join-Path $PSScriptRoot "scripts/postgres_maintenance.sh"
$localRollbackPlan = Join-Path $PSScriptRoot "scripts/rollback_plan.js"
$localRollbackApply = Join-Path $PSScriptRoot "scripts/rollback_apply.js"
$localWorldRecoverAtCrash = Join-Path $PSScriptRoot "scripts/world_recover_at_crash.js"
$localWorldSnapshotTool = Join-Path $PSScriptRoot "scripts/world_snapshot_tool.js"
$localItemInstanceWiringCheck = Join-Path $PSScriptRoot "scripts/check_item_instance_wiring.js"
$localTransactionLedgerWiringCheck = Join-Path $PSScriptRoot "scripts/check_transaction_ledger_wiring.js"
$localGemLedgerWiringCheck = Join-Path $PSScriptRoot "scripts/check_gem_ledger_wiring.js"
$localWorldJournalWiringCheck = Join-Path $PSScriptRoot "scripts/check_world_journal_wiring.js"
$localRollbackWiringCheck = Join-Path $PSScriptRoot "scripts/check_rollback_wiring.js"
$localServerValidationWiringCheck = Join-Path $PSScriptRoot "scripts/check_server_validation_wiring.js"
$localAntiDupeLockingCheck = Join-Path $PSScriptRoot "scripts/check_anti_dupe_locking_wiring.js"
$localAdminActionWiringCheck = Join-Path $PSScriptRoot "scripts/check_admin_action_wiring.js"
$localAccountSessionSecurityWiringCheck = Join-Path $PSScriptRoot "scripts/check_account_session_security_wiring.js"
$localBotRateLimitWiringCheck = Join-Path $PSScriptRoot "scripts/check_bot_rate_limit_wiring.js"
$localIntegrityHashWiringCheck = Join-Path $PSScriptRoot "scripts/check_integrity_hash_wiring.js"
$localMonitoringDashboardWiringCheck = Join-Path $PSScriptRoot "scripts/check_monitoring_dashboard_wiring.js"
$localIntegrityHashAudit = Join-Path $PSScriptRoot "scripts/integrity_hash_audit.js"

function Assert-VersionValue {
  param(
    [string]$Name,
    [string]$Value
  )

  if (-not $Value) {
    return
  }

  if ($Value -notmatch "^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$") {
    throw "$Name must look like 1.2.3, optionally with a prerelease/build suffix."
  }
}

function Get-LocalClientVersion {
  $candidateRoots = @()
  if ($env:PIXELMANIA_CLIENT_ROOT) {
    $candidateRoots += $env:PIXELMANIA_CLIENT_ROOT
  }
  $candidateRoots += Split-Path -Parent $PSScriptRoot
  $candidateRoots += Join-Path (Split-Path -Parent $PSScriptRoot) "pixel-mania"
  $candidateRoots += (Get-Location).Path

  $localNetworkManager = ""
  foreach ($candidateRoot in $candidateRoots) {
    if (-not $candidateRoot) {
      continue
    }

    $candidatePath = Join-Path $candidateRoot "Scripts/network_manager.gd"
    if (Test-Path $candidatePath) {
      $localNetworkManager = $candidatePath
      break
    }
  }

  if (-not $localNetworkManager) {
    throw "Could not find Scripts/network_manager.gd. Run from the Godot repo root, pass -ClientVersion, or set PIXELMANIA_CLIENT_ROOT."
  }

  $content = Get-Content -LiteralPath $localNetworkManager -Raw
  $match = [regex]::Match($content, 'const\s+CLIENT_VERSION\s*:=\s*"([^"]+)"')
  if (-not $match.Success) {
    throw "Could not find CLIENT_VERSION in $localNetworkManager"
  }

  return $match.Groups[1].Value
}

function ConvertTo-ShellLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "'\''") + "'"
}

if ($ForceClientUpdate) {
  if (-not $ClientVersion) {
    $ClientVersion = Get-LocalClientVersion
  }
  if (-not $MinClientVersion) {
    $MinClientVersion = $ClientVersion
  }
}

if ($MinClientVersion -and -not $ClientVersion) {
  $ClientVersion = $MinClientVersion
}

Assert-VersionValue "ClientVersion" $ClientVersion
Assert-VersionValue "MinClientVersion" $MinClientVersion

if (-not (Test-Path $localBackend)) {
  throw "Missing file: $localBackend"
}
if (-not (Test-Path $localServerItemDatabase)) {
  throw "Missing file: $localServerItemDatabase"
}
if (-not (Test-Path $localClientItemDatabase)) {
  throw "Missing file: $localClientItemDatabase"
}
if (-not (Test-Path $localDeveloperPanelUi)) {
  throw "Missing file: $localDeveloperPanelUi"
}
if (-not (Test-Path $localNetworkManager)) {
  throw "Missing file: $localNetworkManager"
}
if (-not (Test-Path $localWorldScript)) {
  throw "Missing file: $localWorldScript"
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
if (-not (Test-Path $localPostgresSchema)) {
  throw "Missing file: $localPostgresSchema"
}
if (-not (Test-Path $localBackendPersistenceRules)) {
  throw "Missing file: $localBackendPersistenceRules"
}
if (-not (Test-Path $localCodexHandoffStatus)) {
  throw "Missing file: $localCodexHandoffStatus"
}
if (-not (Test-Path $localProductionBackendWiring)) {
  throw "Missing file: $localProductionBackendWiring"
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
if (-not (Test-Path $localRollbackPlan)) {
  throw "Missing file: $localRollbackPlan"
}
if (-not (Test-Path $localRollbackApply)) {
  throw "Missing file: $localRollbackApply"
}
if (-not (Test-Path $localWorldRecoverAtCrash)) {
  throw "Missing file: $localWorldRecoverAtCrash"
}
if (-not (Test-Path $localWorldSnapshotTool)) {
  throw "Missing file: $localWorldSnapshotTool"
}
if (-not (Test-Path $localItemInstanceWiringCheck)) {
  throw "Missing file: $localItemInstanceWiringCheck"
}
if (-not (Test-Path $localTransactionLedgerWiringCheck)) {
  throw "Missing file: $localTransactionLedgerWiringCheck"
}
if (-not (Test-Path $localGemLedgerWiringCheck)) {
  throw "Missing file: $localGemLedgerWiringCheck"
}
if (-not (Test-Path $localWorldJournalWiringCheck)) {
  throw "Missing file: $localWorldJournalWiringCheck"
}
if (-not (Test-Path $localRollbackWiringCheck)) {
  throw "Missing file: $localRollbackWiringCheck"
}
if (-not (Test-Path $localServerValidationWiringCheck)) {
  throw "Missing file: $localServerValidationWiringCheck"
}
if (-not (Test-Path $localAntiDupeLockingCheck)) {
  throw "Missing file: $localAntiDupeLockingCheck"
}
if (-not (Test-Path $localAdminActionWiringCheck)) {
  throw "Missing file: $localAdminActionWiringCheck"
}
if (-not (Test-Path $localAccountSessionSecurityWiringCheck)) {
  throw "Missing file: $localAccountSessionSecurityWiringCheck"
}
if (-not (Test-Path $localBotRateLimitWiringCheck)) {
  throw "Missing file: $localBotRateLimitWiringCheck"
}
if (-not (Test-Path $localIntegrityHashWiringCheck)) {
  throw "Missing file: $localIntegrityHashWiringCheck"
}
if (-not (Test-Path $localMonitoringDashboardWiringCheck)) {
  throw "Missing file: $localMonitoringDashboardWiringCheck"
}
if (-not (Test-Path $localIntegrityHashAudit)) {
  throw "Missing file: $localIntegrityHashAudit"
}

$sshTarget = "${RemoteUser}@${RemoteIp}"
$remotePath = "~/$RemoteDir"
$healthUrl = ("$SmokeApiBase".TrimEnd("/") + "/health")

if ($SshKeyPath) {
  $sshBaseArgs = @("-i", $SshKeyPath, "-o", "BatchMode=yes")
} else {
  $sshBaseArgs = @()
}

$releaseEnvExports = @()
if ($ClientVersion) {
  $releaseEnvExports += ("export SERVER_CLIENT_VERSION=" + (ConvertTo-ShellLiteral $ClientVersion))
}
if ($MinClientVersion) {
  $releaseEnvExports += ("export MIN_CLIENT_VERSION=" + (ConvertTo-ShellLiteral $MinClientVersion))
}
if ($UpdateUrl) {
  $releaseEnvExports += ("export UPDATE_URL=" + (ConvertTo-ShellLiteral $UpdateUrl))
}
if ($releaseEnvExports.Count -gt 0) {
  $releaseEnvExports += 'echo "== Client version gate =="'
  $releaseEnvExports += 'echo "SERVER_CLIENT_VERSION=${SERVER_CLIENT_VERSION:-}"'
  $releaseEnvExports += 'echo "MIN_CLIENT_VERSION=${MIN_CLIENT_VERSION:-}"'
  $releaseEnvExports += 'echo "UPDATE_URL=${UPDATE_URL:-}"'
}
$releaseEnvScript = $releaseEnvExports -join "`n"

function Invoke-RemoteCommand {
  param([string]$Command)
  & ssh @sshBaseArgs "$sshTarget" $Command
}

Write-Host "Copying backend files to ${sshTarget}:${remotePath}..."
Invoke-RemoteCommand "mkdir -p $remotePath/scripts $remotePath/docs"
Invoke-RemoteCommand "mkdir -p ~/pixel-mania/Scripts"
& scp @sshBaseArgs $localBackend "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerItemDatabase "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localClientItemDatabase "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localDeveloperPanelUi "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localNetworkManager "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localWorldScript "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localPostgresStore "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localRedisStore "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localEcosystem "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPackage "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPostgresSchema "${sshTarget}:$remotePath/docs/"
& scp @sshBaseArgs $localBackendPersistenceRules "${sshTarget}:$remotePath/docs/"
& scp @sshBaseArgs $localCodexHandoffStatus "${sshTarget}:$remotePath/docs/"
& scp @sshBaseArgs $localProductionBackendWiring "${sshTarget}:$remotePath/docs/"
& scp @sshBaseArgs $localPostgresBackup "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPostgresRestoreCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPostgresMaintenance "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRollbackPlan "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRollbackApply "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localWorldRecoverAtCrash "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localWorldSnapshotTool "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localItemInstanceWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localTransactionLedgerWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localGemLedgerWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localWorldJournalWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRollbackWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerValidationWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localAntiDupeLockingCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localAdminActionWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localAccountSessionSecurityWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localBotRateLimitWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localIntegrityHashWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localMonitoringDashboardWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localIntegrityHashAudit "${sshTarget}:$remotePath/scripts/"

Write-Host "Restarting PM2 and verifying health..."
$remoteCommand = @'
set -euo pipefail
cd __REMOTE_PATH__
echo "== Files on droplet =="
grep -n "redis_stats\\|getHealthSnapshot" server.js || true
node --check server.js
node --check server_item_database.js
node --check postgres_store.js
node --check redis_store.js
node --check scripts/rollback_plan.js
node --check scripts/rollback_apply.js
node --check scripts/world_recover_at_crash.js
node --check scripts/world_snapshot_tool.js
node --check scripts/check_server_validation_wiring.js
node --check scripts/check_anti_dupe_locking_wiring.js
node --check scripts/check_admin_action_wiring.js
node --check scripts/check_account_session_security_wiring.js
node --check scripts/check_bot_rate_limit_wiring.js
node --check scripts/check_integrity_hash_wiring.js
node --check scripts/check_monitoring_dashboard_wiring.js
node --check scripts/integrity_hash_audit.js
npm run check:item-db
npm run check:item-instances
npm run check:transaction-ledger
npm run check:gem-ledger
npm run check:world-journal
npm run check:rollback
npm run check:server-validation
npm run check:anti-dupe
npm run check:admin-actions
npm run check:account-security
npm run check:bot-rate-limits
npm run check:integrity-hashes
npm run check:monitoring-dashboard
chmod +x scripts/postgres_backup.sh scripts/postgres_restore_check.sh
chmod +x scripts/postgres_maintenance.sh
__RELEASE_ENV_EXPORTS__
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

$remoteCommand = $remoteCommand.Replace("__REMOTE_PATH__", $remotePath).Replace("__HEALTH_URL__", $healthUrl).Replace("__RELEASE_ENV_EXPORTS__", $releaseEnvScript)

Invoke-RemoteCommand $remoteCommand

if ($ClientVersion -or $MinClientVersion) {
  Write-Host "Verifying client version gate from $healthUrl ..."
  $healthPayload = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 12
  if ($ClientVersion -and [string]$healthPayload.server_client_version -ne $ClientVersion) {
    throw "Expected server_client_version $ClientVersion, got $($healthPayload.server_client_version)"
  }
  if ($MinClientVersion -and [string]$healthPayload.min_client_version -ne $MinClientVersion) {
    throw "Expected min_client_version $MinClientVersion, got $($healthPayload.min_client_version)"
  }
}

if ($RunSmokeChecks) {
  Write-Host "Running local post-deploy smoke checks against $SmokeApiBase ..."
  & powershell -ExecutionPolicy Bypass -File $localSmoke -ApiBase $SmokeApiBase -RequireRedisReady -RequireRedisStats
}

Write-Host "Done. If curl output does not show persistence.redis_stats, run:"
Write-Host "ssh $sshTarget 'cd $remotePath && sed -n \"1235,1270p\" server.js'"
