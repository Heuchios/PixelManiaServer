param(
  [string]$RemoteIp = "68.183.141.114",
  [string]$StagingUser = "pixelmania-stg",
  [string]$ProductionUser = "pixelmania",
  [string]$RemoteDir = "PixelManiaServer",
  [string]$ProductionApiBase = "https://api.pixelmaniagame.com",
  [int]$ProductionHealthPort = 8080,
  [string]$SshKeyPath,
  [string]$ClientVersion,
  [string]$MinClientVersion,
  [string]$UpdateUrl,
  [switch]$ForceClientUpdate,
  [switch]$SkipClientVersionLock,
  [switch]$RunSmokeChecks,
  [switch]$Force
)

# Promote the release currently verified on staging to production.
#
# The guarantee this script provides is that production runs the same bytes staging ran.
# It gets that not by copying the staging server's files, but by refusing to proceed
# unless the local HEAD commit matches the commit staging recorded, then rebuilding the
# artifact from that identical commit with `git archive` and re-using the same ReleaseId.
# Afterwards it compares production's recorded backend_sha256 against staging's, which is
# the actual proof rather than an assumption.

$ErrorActionPreference = "Stop"

$deployScript = Join-Path $PSScriptRoot "deploy_to_droplet.ps1"
if (-not (Test-Path -LiteralPath $deployScript)) {
  throw "Missing $deployScript"
}

if (-not $SshKeyPath -and $env:PIXELMANIA_SSH_KEY) {
  $SshKeyPath = $env:PIXELMANIA_SSH_KEY
}
if (-not $SshKeyPath) {
  $defaultSshKeyPath = Join-Path $HOME ".ssh/pixelmania_ed25519"
  if (Test-Path -LiteralPath $defaultSshKeyPath) {
    $SshKeyPath = $defaultSshKeyPath
  }
}

$sshBaseArgs = @()
if ($SshKeyPath) { $sshBaseArgs += @("-i", $SshKeyPath) }
$sshBaseArgs += @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15")

function Get-RemoteReleaseManifest {
  param([string]$User)

  $remotePath = "~/$RemoteDir/shared/last_successful_release.json"
  $output = & ssh @sshBaseArgs "${User}@${RemoteIp}" "cat $remotePath" 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read $remotePath as ${User}: $($output -join ' ')"
  }
  return (($output -join "`n") | ConvertFrom-Json)
}

Write-Host "Reading the last successful STAGING release..."
$staging = Get-RemoteReleaseManifest -User $StagingUser

if (-not $staging.release_id -or -not $staging.backend_commit) {
  throw "The staging manifest is missing release_id or backend_commit. Deploy to staging first."
}

$localCommit = (& git -C $PSScriptRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "git rev-parse HEAD failed in $PSScriptRoot"
}

Write-Host ""
Write-Host "  staging release : $($staging.release_id)"
Write-Host "  staging commit  : $($staging.backend_commit)"
Write-Host "  staging sha256  : $($staging.backend_sha256)"
Write-Host "  local HEAD      : $localCommit"
Write-Host ""

if ($localCommit -ne $staging.backend_commit) {
  throw @"
Refusing to promote: local HEAD does not match the commit running on staging.

Promotion re-packages the artifact from your local commit. Shipping a different commit
than the one you tested is exactly the drift this workflow exists to prevent.

Check out $($staging.backend_commit), or deploy the current HEAD to staging first:
  git checkout $($staging.backend_commit)
  .\deploy_staging.ps1
"@
}

if (-not $Force) {
  Write-Host "This promotes release $($staging.release_id) to PRODUCTION at $ProductionApiBase."
  $answer = Read-Host "Type PROMOTE to continue"
  if ($answer -cne "PROMOTE") {
    Write-Host "Promotion canceled."
    exit 0
  }
}

$arguments = @{
  RemoteIp        = $RemoteIp
  RemoteUser      = $ProductionUser
  RemoteDir       = $RemoteDir
  SmokeApiBase    = $ProductionApiBase
  LocalHealthPort = $ProductionHealthPort
  # Same ReleaseId on both environments, so `readlink current` on either box names the
  # same tested build and the deployments.log lines line up.
  ReleaseId       = $staging.release_id
}
if ($SshKeyPath)        { $arguments.SshKeyPath = $SshKeyPath }
if ($ClientVersion)     { $arguments.ClientVersion = $ClientVersion }
if ($MinClientVersion)  { $arguments.MinClientVersion = $MinClientVersion }
if ($UpdateUrl)         { $arguments.UpdateUrl = $UpdateUrl }
if ($ForceClientUpdate) { $arguments.ForceClientUpdate = $true }
if ($RunSmokeChecks)    { $arguments.RunSmokeChecks = $true }
# By default every deploy pins the server to the CLIENT_VERSION constant in the
# client repo, so an older client cannot connect. Pass -SkipClientVersionLock to
# ship the backend while a store rollout is still reaching players.
if ($SkipClientVersionLock) { $arguments.SkipClientVersionLock = $true }

& $deployScript @arguments

Write-Host ""
Write-Host "Verifying production shipped the same artifact staging tested..."
$production = Get-RemoteReleaseManifest -User $ProductionUser

if ($production.release_id -ne $staging.release_id) {
  throw "Production recorded release $($production.release_id), expected $($staging.release_id)."
}
if ($production.backend_sha256 -ne $staging.backend_sha256) {
  throw @"
Production's backend archive hash does not match staging's.

  staging    : $($staging.backend_sha256)
  production : $($production.backend_sha256)

The same commit produced different bytes, which means a build step is not deterministic.
Investigate before trusting this release; roll back with:
  .\rollback_release.ps1 $RemoteIp
"@
}

Write-Host ""
Write-Host "Promoted $($staging.release_id) to production."
Write-Host "Backend archive sha256 matches staging: $($production.backend_sha256)"
Write-Host "Roll back with: .\rollback_release.ps1 $RemoteIp"
