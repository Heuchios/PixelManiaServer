param(
  [string]$RemoteIp = "68.183.141.114",
  [string]$RemoteUser = "pixelmania-stg",
  [string]$RemoteDir = "PixelManiaServer",
  [string]$StagingApiBase = "https://staging-api.pixelmaniagame.com",
  [int]$StagingHealthPort = 8180,
  [string]$SshKeyPath,
  [string]$ReleaseId,
  [switch]$Fast,
  [switch]$SkipClientVersionLock,
  [switch]$RunSmokeChecks
)

# Deploy the current backend commit to STAGING.
#
# This is a thin wrapper over deploy_to_droplet.ps1. It exists so the three values that
# decide which environment gets touched -- remote user, public health URL and the LOCAL
# health port the activation gate polls -- can never be forgotten. Passing -RemoteUser
# without -LocalHealthPort would deploy staging and then verify production's 8080, read
# production's release_id, decide activation failed, and roll staging back.
#
# Promote what you tested with:  .\promote_staging_to_production.ps1

$ErrorActionPreference = "Stop"

$deployScript = Join-Path $PSScriptRoot "deploy_to_droplet.ps1"
if (-not (Test-Path -LiteralPath $deployScript)) {
  throw "Missing $deployScript"
}

$arguments = @{
  RemoteIp        = $RemoteIp
  RemoteUser      = $RemoteUser
  RemoteDir       = $RemoteDir
  SmokeApiBase    = $StagingApiBase
  LocalHealthPort = $StagingHealthPort
}
if ($SshKeyPath) { $arguments.SshKeyPath = $SshKeyPath }
if ($ReleaseId)  { $arguments.ReleaseId = $ReleaseId }

# Staging still runs the full local security preflight by default. -Fast skips it for a
# tight edit/test loop, but never promote a release whose full gate has not run.
if ($Fast) {
  Write-Warning "-Fast skips the local check:security preflight. Re-run without -Fast before promoting."
  $arguments.SkipLocalPreflight = $true
}
if ($RunSmokeChecks) { $arguments.RunSmokeChecks = $true }

# Staging normally locks to the client build in this repo, exactly like production, so the
# gate you test is the gate players get. -SkipClientVersionLock leaves the floor alone when
# you need to test backend changes against an older client.
if ($SkipClientVersionLock) { $arguments.SkipClientVersionLock = $true }

if ($arguments.RemoteUser -eq "pixelmania") {
  throw "RemoteUser 'pixelmania' is the production account. Staging must deploy as its own user."
}
if ($arguments.LocalHealthPort -eq 8080) {
  throw "LocalHealthPort 8080 is production's listener. Staging must poll its own port."
}

Write-Host "Deploying to STAGING ($($arguments.RemoteUser)@$RemoteIp, port $StagingHealthPort)..."
& $deployScript @arguments

$commit = (& git -C $PSScriptRoot rev-parse --short=12 HEAD).Trim()

Write-Host ""
Write-Host "Staging is running commit $commit."
Write-Host ""
Write-Host "Point the Godot editor at it (Project > Project Settings, or the run arguments):"
Write-Host "  --pixelmania-api-base $StagingApiBase --pixelmania-ws-url $($StagingApiBase -replace '^https://', 'wss://')/ws"
Write-Host ""
Write-Host "The override only applies in editor and debug builds, and never on Android."
Write-Host ""
Write-Host "When it looks good:  .\promote_staging_to_production.ps1"
