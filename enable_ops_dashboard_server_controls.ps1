param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$RemoteIp,

  [string]$RemoteUser = "root",
  [string]$RemoteDir = "PixelManiaServer",
  [string]$SshKeyPath
)

$ErrorActionPreference = "Stop"

if (-not $SshKeyPath -and $env:PIXELMANIA_SSH_KEY) {
  $SshKeyPath = $env:PIXELMANIA_SSH_KEY
}

if (-not $SshKeyPath) {
  $defaultSshKeyPath = Join-Path $HOME ".ssh/pixelmania_ed25519"
  if (Test-Path -LiteralPath $defaultSshKeyPath) {
    $SshKeyPath = $defaultSshKeyPath
  }
}

if ($SshKeyPath) {
  if (-not (Test-Path -LiteralPath $SshKeyPath)) {
    throw "SSH key not found: $SshKeyPath"
  }
  Write-Host "Using SSH key: $SshKeyPath"
  $sshBaseArgs = @("-i", $SshKeyPath, "-o", "BatchMode=yes")
} else {
  $sshBaseArgs = @()
}

$sshTarget = "${RemoteUser}@${RemoteIp}"
$remotePath = "~/$RemoteDir"

function Invoke-RemoteCommand {
  param([string]$Command)
  & ssh @sshBaseArgs "$sshTarget" $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Remote command failed with exit code $LASTEXITCODE"
  }
}

$remoteCommand = @'
set -euo pipefail
cd __REMOTE_PATH__

set_env() {
  key="$1"
  value="$2"
  touch .env
  if grep -qE "^${key}=" .env; then
    escaped_value="$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')"
    sed -i "s/^${key}=.*/${key}=${escaped_value}/" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

set_env OPS_DASHBOARD_ALLOW_CONTROL true
set_env OPS_DASHBOARD_ALLOWED_ACTIONS restart,start,stop,deploy,rollback
set_env OPS_DASHBOARD_RESTART_APPS pixelmania,pixelmania-a,pixelmania-b
set_env OPS_DASHBOARD_RESTART_COMMAND "pm2 startOrReload ecosystem.config.js --env production --update-env && bash scripts/start_route_production_instances.sh"
set_env OPS_DASHBOARD_START_COMMAND "pm2 startOrReload ecosystem.config.js --env production --update-env && bash scripts/start_route_production_instances.sh"
set_env OPS_DASHBOARD_STOP_COMMAND 'for app in pixelmania pixelmania-a pixelmania-b; do pm2 stop "$app" || true; done; pm2 save'
set_env OPS_DASHBOARD_ALLOW_STOP_WITH_PLAYERS false
set_env OPS_DASHBOARD_ALLOW_DEPLOY_WITH_PLAYERS false
set_env OPS_DASHBOARD_ALLOW_ROLLBACK_WITH_PLAYERS false
set_env OPS_DASHBOARD_DEPLOY_COMMAND "bash scripts/ops_dashboard_git_deploy.sh"
set_env OPS_DASHBOARD_ROLLBACK_COMMAND "bash scripts/ops_dashboard_git_rollback.sh"
set_env OPS_DASHBOARD_CONFIRM_ACTIONS stop,deploy,rollback

pm2 startOrReload ecosystem.ops.config.js --env production --update-env
pm2 save
pm2 describe pixelmania-ops
'@

$remoteCommand = $remoteCommand.Replace("__REMOTE_PATH__", $remotePath)
$remoteBootstrap = "$remotePath/scripts/enable_ops_dashboard_server_controls_remote.sh"
$tempBootstrap = Join-Path ([System.IO.Path]::GetTempPath()) ("pixelmania-ops-dashboard-controls-" + [guid]::NewGuid().ToString("N") + ".sh")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tempBootstrap, $remoteCommand, $utf8NoBom)
try {
  & ssh @sshBaseArgs "$sshTarget" "mkdir -p $remotePath/scripts"
  if ($LASTEXITCODE -ne 0) { throw "Remote command failed with exit code $LASTEXITCODE" }
  & scp @sshBaseArgs $tempBootstrap "${sshTarget}:$remoteBootstrap"
  if ($LASTEXITCODE -ne 0) { throw "scp failed for remote ops dashboard controls script." }
  Invoke-RemoteCommand "chmod +x $remoteBootstrap && bash $remoteBootstrap"
} finally {
  Remove-Item -LiteralPath $tempBootstrap -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "PixelMania ops dashboard controls are enabled for restart, start, stop, deploy, and rollback."
