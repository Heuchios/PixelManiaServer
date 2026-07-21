param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$RemoteIp,

  [string]$RemoteUser = "pixelmania",
  [string]$RemoteDir = "PixelManiaServer",
  [string]$SshKeyPath,
  [string]$SmokeApiBase = "https://api.pixelmaniagame.com",
  [string]$ClientVersion,
  [string]$MinClientVersion,
  [string]$UpdateUrl,
  [string]$ReleaseId,
  [switch]$ForceClientUpdate,
  [switch]$RunSmokeChecks,
  [switch]$RunRemoteFullChecks,
  [switch]$SkipLocalPreflight
)

$ErrorActionPreference = "Stop"

function Resolve-ClientRoot {
  $repoParent = Split-Path -Parent $PSScriptRoot
  $candidateRoots = @()
  if ($env:PIXELMANIA_CLIENT_ROOT) {
    $candidateRoots += $env:PIXELMANIA_CLIENT_ROOT
  }
  $candidateRoots += Join-Path $repoParent "pixel-mania"
  $candidateRoots += $repoParent
  $candidateRoots += (Get-Location).Path

  foreach ($candidateRoot in $candidateRoots) {
    if (-not $candidateRoot) {
      continue
    }

    if (Test-Path (Join-Path $candidateRoot "Scripts/item_database.gd")) {
      return (Resolve-Path -LiteralPath $candidateRoot).Path
    }
  }

  throw "Could not find the PixelMania client root. Set PIXELMANIA_CLIENT_ROOT or keep the pixel-mania repo beside PixelManiaServer."
}

function Assert-SafeName {
  param(
    [string]$Name,
    [string]$Value
  )

  if (-not $Value -or $Value -notmatch "^[A-Za-z0-9._-]+$") {
    throw "$Name may contain only letters, numbers, dots, underscores, and hyphens."
  }
}

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

function ConvertTo-ShellLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "'\''") + "'"
}

function Invoke-NativeProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FileName,
    [string[]]$Arguments = @(),
    [string]$StandardInput,
    [string]$FailureMessage = "Command failed"
  )

  $processStart = [System.Diagnostics.ProcessStartInfo]::new()
  $processStart.FileName = $FileName
  foreach ($argument in $Arguments) {
    [void]$processStart.ArgumentList.Add($argument)
  }
  $processStart.UseShellExecute = $false
  if ($PSBoundParameters.ContainsKey("StandardInput")) {
    $processStart.RedirectStandardInput = $true
  }

  $process = [System.Diagnostics.Process]::Start($processStart)
  try {
    if ($PSBoundParameters.ContainsKey("StandardInput")) {
      $process.StandardInput.NewLine = "`n"
      $process.StandardInput.Write(($StandardInput -replace "`r`n", "`n" -replace "`r", "`n"))
      $process.StandardInput.Close()
    }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      throw "$FailureMessage with exit code $($process.ExitCode)"
    }
  } finally {
    if ($process -and -not $process.HasExited) {
      $process.Kill()
    }
    if ($process) {
      $process.Dispose()
    }
  }
}

function Get-GitText {
  param(
    [string]$RepoRoot,
    [string[]]$Arguments
  )

  $output = & git -C $RepoRoot @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed in $RepoRoot`: $($output -join ' ')"
  }
  return (($output -join "`n").Trim())
}

function Assert-ArchiveScriptsUseLf {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,
    [Parameter(Mandatory = $true)]
    [string]$InspectionRoot
  )

  New-Item -ItemType Directory -Path $InspectionRoot -Force | Out-Null
  Invoke-NativeProcess -FileName "tar" -Arguments @("-xzf", $ArchivePath, "-C", $InspectionRoot) -FailureMessage "Backend archive inspection failed"

  $invalidScripts = @()
  $scripts = Get-ChildItem -LiteralPath $InspectionRoot -File -Recurse | Where-Object {
    $_.Extension -in @(".sh", ".ps1")
  }
  foreach ($script in $scripts) {
    $bytes = [System.IO.File]::ReadAllBytes($script.FullName)
    if ([Array]::IndexOf($bytes, [byte]13) -ge 0) {
      $invalidScripts += [System.IO.Path]::GetRelativePath($InspectionRoot, $script.FullName)
    }
  }

  if ($invalidScripts.Count -gt 0) {
    throw "Backend archive contains CRLF scripts: $($invalidScripts -join ', '). Ensure .gitattributes enforces LF for shell and PowerShell files."
  }

  Write-Host "Backend archive scripts use LF line endings."
}

function Get-LocalClientVersion {
  param([string]$ClientRoot)

  $networkManager = Join-Path $ClientRoot "Scripts/network_manager.gd"
  $content = Get-Content -LiteralPath $networkManager -Raw
  $match = [regex]::Match($content, 'const\s+CLIENT_VERSION\s*:=\s*"([^"]+)"')
  if (-not $match.Success) {
    throw "Could not find CLIENT_VERSION in $networkManager"
  }
  return $match.Groups[1].Value
}

function Assert-CleanBackendCommit {
  $status = Get-GitText -RepoRoot $PSScriptRoot -Arguments @("status", "--porcelain", "--untracked-files=all")
  if ($status) {
    throw @"
Versioned deployment requires a clean backend Git commit. Commit or stash these changes first:
$status
"@
  }
}

function Invoke-LocalDeployPreflight {
  Push-Location $PSScriptRoot
  try {
    if ($SkipLocalPreflight) {
      Write-Host "Running reduced local release preflight..."
      & npm run build:server-entry
      if ($LASTEXITCODE -ne 0) {
        throw "Local build:server-entry failed with exit code $LASTEXITCODE"
      }
      & npm run check:release-deploy
      if ($LASTEXITCODE -ne 0) {
        throw "Local check:release-deploy failed with exit code $LASTEXITCODE"
      }
      & node --check server.js
      if ($LASTEXITCODE -ne 0) {
        throw "Generated server.js syntax check failed with exit code $LASTEXITCODE"
      }
      return
    }

    Write-Host "Running full local security and TypeScript release preflight..."
    & npm run check:security
    if ($LASTEXITCODE -ne 0) {
      throw "Local check:security failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Assert-SafeName "RemoteUser" $RemoteUser
Assert-SafeName "RemoteDir" $RemoteDir
Assert-VersionValue "ClientVersion" $ClientVersion
Assert-VersionValue "MinClientVersion" $MinClientVersion

$clientRoot = Resolve-ClientRoot
if ($ForceClientUpdate) {
  if (-not $ClientVersion) {
    $ClientVersion = Get-LocalClientVersion -ClientRoot $clientRoot
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

$requiredBackendPaths = @(
  "server.js",
  "package.json",
  "package-lock.json",
  "ecosystem.config.js",
  "ecosystem.ops.config.js",
  "scripts/activate_main_release.sh",
  "scripts/rollback_release.sh",
  "scripts/check_release_deployment_wiring.js",
  "scripts/release_deployment_test_helpers.js",
  "scripts/start_route_production_instances.sh"
)
foreach ($relativePath in $requiredBackendPaths) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $relativePath))) {
    throw "Missing backend release file: $relativePath"
  }
}

$clientReleasePaths = @(
  "Scripts/item_database.gd",
  "Scripts/ItemAtlasDB.gd",
  "Scripts/developer_panel_ui.gd",
  "Scripts/network_manager.gd",
  "Scripts/world.gd",
  "Scripts/block_manager.gd",
  "Scripts/world_tilemap_renderer.gd",
  "Scripts/item_gameplay_manager.gd",
  "Scripts/drop_manager.gd",
  "Scripts/save_manager.gd",
  "Scripts/world_state_sync_manager.gd",
  "Data/items/atlas_items.json",
  "docs/production_backend_wiring.md",
  "docs/scale_readiness_10k.md",
  "project.godot"
)
foreach ($relativePath in $clientReleasePaths) {
  if (-not (Test-Path -LiteralPath (Join-Path $clientRoot $relativePath))) {
    throw "Missing client release file: $relativePath"
  }
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
if ($SshKeyPath -and -not (Test-Path -LiteralPath $SshKeyPath)) {
  throw "SSH key not found: $SshKeyPath"
}

$sshTarget = "${RemoteUser}@${RemoteIp}"
$sshBaseArgs = @()
if ($SshKeyPath) {
  Write-Host "Using SSH key: $SshKeyPath"
  $sshBaseArgs += @("-i", $SshKeyPath)
}
$sshBaseArgs += @(
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=4"
)

function Invoke-RemoteCommand {
  param([string]$Command)
  Invoke-NativeProcess -FileName "ssh" -Arguments ($sshBaseArgs + @($sshTarget, "bash -se")) -StandardInput $Command -FailureMessage "Remote command failed"
}

function Send-ReleaseArtifact {
  param(
    [string]$LocalPath,
    [string]$RemotePath
  )
  Invoke-NativeProcess -FileName "scp" -Arguments ($sshBaseArgs + @($LocalPath, "${sshTarget}:$RemotePath")) -FailureMessage "Artifact upload failed"
}

Invoke-LocalDeployPreflight
Assert-CleanBackendCommit

$commit = Get-GitText -RepoRoot $PSScriptRoot -Arguments @("rev-parse", "HEAD")
$shortCommit = Get-GitText -RepoRoot $PSScriptRoot -Arguments @("rev-parse", "--short=12", "HEAD")
$branch = Get-GitText -RepoRoot $PSScriptRoot -Arguments @("branch", "--show-current")
if (-not $ReleaseId) {
  $ReleaseId = "{0}-{1}" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ"), $shortCommit
}
Assert-SafeName "ReleaseId" $ReleaseId

$clientCommit = "unversioned"
$clientDirty = $true
try {
  $clientCommit = Get-GitText -RepoRoot $clientRoot -Arguments @("rev-parse", "HEAD")
  $clientStatus = Get-GitText -RepoRoot $clientRoot -Arguments (@("status", "--porcelain", "--") + $clientReleasePaths)
  $clientDirty = [bool]$clientStatus
} catch {
  Write-Warning "Client Git metadata is unavailable; the release manifest will rely on the client archive hash."
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("pixelmania-release-" + [guid]::NewGuid().ToString("N"))
$backendArchive = Join-Path $tempRoot "backend.tar.gz"
$clientArchive = Join-Path $tempRoot "client.tar.gz"
$manifestPath = Join-Path $tempRoot "release.json"
$remotePath = "~/$RemoteDir"
$backendRemoteName = "$ReleaseId-backend.tar.gz"
$clientRemoteName = "$ReleaseId-client.tar.gz"
$manifestRemoteName = "$ReleaseId-release.json"
$healthUrl = ("$SmokeApiBase".TrimEnd("/") + "/health")

New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
  Write-Host "Packaging immutable backend release $ReleaseId from commit $shortCommit..."
  Invoke-NativeProcess -FileName "git" -Arguments @("-C", $PSScriptRoot, "archive", "--worktree-attributes", "--format=tar.gz", "--output=$backendArchive", $commit) -FailureMessage "Backend archive creation failed"
  Assert-ArchiveScriptsUseLf -ArchivePath $backendArchive -InspectionRoot (Join-Path $tempRoot "backend-archive-inspection")
  Invoke-NativeProcess -FileName "tar" -Arguments (@("-czf", $clientArchive, "-C", $clientRoot) + $clientReleasePaths) -FailureMessage "Client metadata archive creation failed"

  $backendHash = (Get-FileHash -LiteralPath $backendArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $clientHash = (Get-FileHash -LiteralPath $clientArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $manifest = [ordered]@{
    release_id = $ReleaseId
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    backend_commit = $commit
    backend_branch = $branch
    backend_sha256 = $backendHash
    client_commit = $clientCommit
    client_selected_files_dirty = $clientDirty
    client_sha256 = $clientHash
    server_client_version = [string]$ClientVersion
    minimum_client_version = [string]$MinClientVersion
    update_url = [string]$UpdateUrl
  }
  [System.IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 4),
    [System.Text.UTF8Encoding]::new($false)
  )

  $initializeRemote = @'
set -euo pipefail
umask 027
base_dir="$HOME/__REMOTE_DIR__"
mkdir -p "$base_dir/incoming" "$base_dir/releases" "$base_dir/shared" "$base_dir/bin"
'@.Replace("__REMOTE_DIR__", $RemoteDir)
  Invoke-RemoteCommand $initializeRemote

  Write-Host "Uploading three release artifacts to $sshTarget..."
  Send-ReleaseArtifact -LocalPath $backendArchive -RemotePath "$remotePath/incoming/$backendRemoteName"
  Send-ReleaseArtifact -LocalPath $clientArchive -RemotePath "$remotePath/incoming/$clientRemoteName"
  Send-ReleaseArtifact -LocalPath $manifestPath -RemotePath "$remotePath/incoming/$manifestRemoteName"

  $releaseEnvLines = @(
    "PIXELMANIA_RELEASE_ID=$(ConvertTo-ShellLiteral $ReleaseId)",
    'PIXELMANIA_RELEASE_ROOT="$BASE_DIR"'
  )
  if ($ClientVersion) {
    $releaseEnvLines += "SERVER_CLIENT_VERSION=$(ConvertTo-ShellLiteral $ClientVersion)"
  }
  if ($MinClientVersion) {
    $releaseEnvLines += "MIN_CLIENT_VERSION=$(ConvertTo-ShellLiteral $MinClientVersion)"
  }
  if ($UpdateUrl) {
    $releaseEnvLines += "UPDATE_URL=$(ConvertTo-ShellLiteral $UpdateUrl)"
  }
  $releaseEnvContent = $releaseEnvLines -join "`n"
  $remoteFullChecksValue = if ($RunRemoteFullChecks) { "1" } else { "0" }

  $remoteCommand = @'
set -Eeuo pipefail
umask 027

BASE_DIR="$HOME/__REMOTE_DIR__"
RELEASE_ID='__RELEASE_ID__'
RELEASE_DIR="$BASE_DIR/releases/$RELEASE_ID"
CURRENT_LINK="$BASE_DIR/current"
PREVIOUS_LINK="$BASE_DIR/previous"
SHARED_DIR="$BASE_DIR/shared"
BACKEND_ARCHIVE="$BASE_DIR/incoming/__BACKEND_ARCHIVE__"
CLIENT_ARCHIVE="$BASE_DIR/incoming/__CLIENT_ARCHIVE__"
MANIFEST_FILE="$BASE_DIR/incoming/__MANIFEST_FILE__"
BACKEND_SHA256='__BACKEND_SHA256__'
CLIENT_SHA256='__CLIENT_SHA256__'
LOCAL_HEALTH_URL="http://127.0.0.1:8080/health"
RUN_REMOTE_FULL_CHECKS='__RUN_REMOTE_FULL_CHECKS__'
cleanup_release_on_error=1

cleanup_incoming() {
  rm -f -- "$BACKEND_ARCHIVE" "$CLIENT_ARCHIVE" "$MANIFEST_FILE"
}

cleanup_failed_prepare() {
  local exit_code=$?
  cleanup_incoming
  if [ "$cleanup_release_on_error" = "1" ] && [ -n "${RELEASE_DIR:-}" ] && [ -d "$RELEASE_DIR" ]; then
    rm -rf -- "$RELEASE_DIR"
  fi
  exit "$exit_code"
}
trap cleanup_failed_prepare ERR

validate_archive() {
  local archive="$1"
  local entry
  while IFS= read -r entry; do
    case "$entry" in
      /*|../*|*/../*|*/..)
        echo "Unsafe archive path rejected: $entry" >&2
        return 1
        ;;
    esac
  done < <(tar -tzf "$archive")
}

atomic_link() {
  local target="$1"
  local link_path="$2"
  local temporary_link="${link_path}.next.$$"
  rm -f -- "$temporary_link"
  ln -s "$target" "$temporary_link"
  mv -Tf "$temporary_link" "$link_path"
}

echo "== Verify release artifacts =="
printf '%s  %s\n' "$BACKEND_SHA256" "$BACKEND_ARCHIVE" | sha256sum -c -
printf '%s  %s\n' "$CLIENT_SHA256" "$CLIENT_ARCHIVE" | sha256sum -c -
validate_archive "$BACKEND_ARCHIVE"
validate_archive "$CLIENT_ARCHIVE"

if [ -e "$RELEASE_DIR" ]; then
  echo "Release already exists: $RELEASE_DIR" >&2
  exit 1
fi

echo "== Prepare $RELEASE_ID =="
mkdir -p "$RELEASE_DIR/_client"
tar -xzf "$BACKEND_ARCHIVE" -C "$RELEASE_DIR"
tar -xzf "$CLIENT_ARCHIVE" -C "$RELEASE_DIR/_client"
cp "$MANIFEST_FILE" "$RELEASE_DIR/release.json"

if [ ! -f "$SHARED_DIR/.env" ]; then
  if [ -f "$BASE_DIR/.env" ]; then
    cp -p "$BASE_DIR/.env" "$SHARED_DIR/.env"
  elif [ -L "$CURRENT_LINK" ] && [ -f "$CURRENT_LINK/.env" ]; then
    cp -p "$CURRENT_LINK/.env" "$SHARED_DIR/.env"
  else
    install -m 0600 /dev/null "$SHARED_DIR/.env"
  fi
fi
chmod 0600 "$SHARED_DIR/.env"
ln -s "$SHARED_DIR/.env" "$RELEASE_DIR/.env"

for state_file in ops_dashboard_admin.json ops_dashboard_audit.log; do
  if [ ! -e "$SHARED_DIR/$state_file" ] && [ -e "$BASE_DIR/$state_file" ]; then
    cp -p "$BASE_DIR/$state_file" "$SHARED_DIR/$state_file"
  fi
done
touch "$SHARED_DIR/ops_dashboard_audit.log"
chmod 0600 "$SHARED_DIR/ops_dashboard_audit.log"

cat > "$RELEASE_DIR/.release-env" <<EOF
__RELEASE_ENV_CONTENT__
EOF
chmod 0640 "$RELEASE_DIR/.release-env"

previous_target="$BASE_DIR"
if [ -L "$CURRENT_LINK" ]; then
  previous_target="$(readlink -f "$CURRENT_LINK")"
elif [ -e "$CURRENT_LINK" ]; then
  echo "$CURRENT_LINK must be a symlink." >&2
  exit 1
fi
if [ ! -f "$previous_target/package-lock.json" ]; then
  previous_target=""
fi

cd "$RELEASE_DIR"
export PIXELMANIA_CLIENT_DIR="$RELEASE_DIR/_client"
if [ "$RUN_REMOTE_FULL_CHECKS" = "1" ]; then
  npm ci --no-audit --no-fund
elif [ -n "$previous_target" ] && [ -d "$previous_target/node_modules" ] && cmp -s package-lock.json "$previous_target/package-lock.json"; then
  echo "Reusing unchanged production dependencies from $previous_target"
  if ! cp -al "$previous_target/node_modules" "$RELEASE_DIR/node_modules"; then
    rm -rf -- "$RELEASE_DIR/node_modules"
    npm ci --omit=dev --no-audit --no-fund
  fi
else
  npm ci --omit=dev --no-audit --no-fund
fi

echo "== Validate prepared release =="
npm ls --omit=dev --depth=0
node --check server.js
node --check ecosystem.config.js
node --check ecosystem.ops.config.js
bash -n scripts/rollback_release.sh
bash -n scripts/activate_main_release.sh
bash -n scripts/start_route_production_instances.sh
npm run check:release-deploy
npm run check:item-db
npm run check:anti-dupe
if [ "$RUN_REMOTE_FULL_CHECKS" = "1" ]; then
  npm run check:security
fi

install -m 0755 scripts/rollback_release.sh "$BASE_DIR/bin/rollback_release.sh"
install -m 0755 scripts/activate_main_release.sh "$BASE_DIR/bin/activate_main_release.sh"

if [ -n "$previous_target" ]; then
  atomic_link "$previous_target" "$PREVIOUS_LINK"
else
  atomic_link "$BASE_DIR" "$PREVIOUS_LINK"
fi
atomic_link "$RELEASE_DIR" "$CURRENT_LINK"
cleanup_release_on_error=0
trap - ERR

echo "== Activate $RELEASE_ID =="
had_routes=0
if pm2 describe pixelmania-a >/dev/null 2>&1 || pm2 describe pixelmania-b >/dev/null 2>&1; then
  had_routes=1
fi
had_ops=0
if pm2 describe pixelmania-ops >/dev/null 2>&1; then
  had_ops=1
fi

if ! (
  set -Eeuo pipefail
  set -a
  . "$CURRENT_LINK/.release-env"
  set +a
  export PIXELMANIA_RELEASE_ROOT="$BASE_DIR"
  "$BASE_DIR/bin/activate_main_release.sh" "$CURRENT_LINK"
  if [ "$had_routes" = "1" ]; then
    PIXELMANIA_BACKEND_ROOT="$CURRENT_LINK" \
    PIXELMANIA_RELEASE_ROOT="$BASE_DIR" \
    ROUTE_PRODUCTION_PM2_CONFIG="$SHARED_DIR/ecosystem.route-production.config.js" \
    ROUTE_PRODUCTION_QUIET=true \
      bash scripts/start_route_production_instances.sh
  fi
  if [ "$had_ops" = "1" ]; then
    pm2 startOrReload ecosystem.ops.config.js --env production --update-env
  fi
  pm2 save
); then
  echo "PM2 activation failed; restoring the previous release." >&2
  "$BASE_DIR/bin/rollback_release.sh" --yes --health-url "$LOCAL_HEALTH_URL" || true
  cleanup_incoming
  exit 1
fi

health_ok=0
for attempt in $(seq 1 30); do
  http_code="$(curl -sS "$LOCAL_HEALTH_URL" -o /tmp/pixelmania-release-health.json -w "%{http_code}" 2>/tmp/pixelmania-release-health.err || true)"
  if [ "$http_code" = "200" ]; then
    active_release="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(p.release_id||""));' /tmp/pixelmania-release-health.json)"
    if [ "$active_release" = "$RELEASE_ID" ]; then
      cat /tmp/pixelmania-release-health.json
      health_ok=1
      break
    fi
    echo "Health is from release '${active_release:-unknown}', waiting for $RELEASE_ID."
  else
    echo "Health is not ready: attempt ${attempt}/30 (http ${http_code:-curl_failed})."
  fi
  sleep 2
done

if [ "$health_ok" != "1" ]; then
  echo "Activation failed; restoring the previous release." >&2
  cat /tmp/pixelmania-release-health.err 2>/dev/null || true
  cat /tmp/pixelmania-release-health.json 2>/dev/null || true
  pm2 logs pixelmania --lines 80 --nostream || true
  "$BASE_DIR/bin/rollback_release.sh" --yes --health-url "$LOCAL_HEALTH_URL" || true
  cleanup_incoming
  exit 1
fi

cp "$RELEASE_DIR/release.json" "$SHARED_DIR/last_successful_release.json"
printf '%s\n' "$RELEASE_ID" > "$SHARED_DIR/current_release"
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RELEASE_ID" "activated" >> "$SHARED_DIR/deployments.log"
cleanup_incoming

echo "== Release pointers =="
printf 'current  -> %s\n' "$(readlink -f "$CURRENT_LINK")"
printf 'previous -> %s\n' "$(readlink -f "$PREVIOUS_LINK")"
echo "Rollback: $BASE_DIR/bin/rollback_release.sh --yes"
'@

  $remoteCommand = $remoteCommand.Replace("__REMOTE_DIR__", $RemoteDir)
  $remoteCommand = $remoteCommand.Replace("__RELEASE_ID__", $ReleaseId)
  $remoteCommand = $remoteCommand.Replace("__BACKEND_ARCHIVE__", $backendRemoteName)
  $remoteCommand = $remoteCommand.Replace("__CLIENT_ARCHIVE__", $clientRemoteName)
  $remoteCommand = $remoteCommand.Replace("__MANIFEST_FILE__", $manifestRemoteName)
  $remoteCommand = $remoteCommand.Replace("__BACKEND_SHA256__", $backendHash)
  $remoteCommand = $remoteCommand.Replace("__CLIENT_SHA256__", $clientHash)
  $remoteCommand = $remoteCommand.Replace("__RUN_REMOTE_FULL_CHECKS__", $remoteFullChecksValue)
  $remoteCommand = $remoteCommand.Replace("__RELEASE_ENV_CONTENT__", $releaseEnvContent)

  Invoke-RemoteCommand $remoteCommand

  Write-Host "Verifying public health from $healthUrl ..."
  $healthPayload = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 15
  if ([string]$healthPayload.release_id -ne $ReleaseId) {
    throw "Expected public release_id $ReleaseId, got $($healthPayload.release_id)"
  }
  if ($ClientVersion -and [string]$healthPayload.server_client_version -ne $ClientVersion) {
    throw "Expected server_client_version $ClientVersion, got $($healthPayload.server_client_version)"
  }
  if ($MinClientVersion -and [string]$healthPayload.min_client_version -ne $MinClientVersion) {
    throw "Expected min_client_version $MinClientVersion, got $($healthPayload.min_client_version)"
  }

  if ($RunSmokeChecks) {
    Write-Host "Running post-deploy smoke checks against $SmokeApiBase ..."
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "smoke_postdeploy.ps1") -ApiBase $SmokeApiBase -RequireRedisReady -RequireRedisStats
    if ($LASTEXITCODE -ne 0) {
      throw "Post-deploy smoke checks failed with exit code $LASTEXITCODE"
    }
  }

  Write-Host "Release $ReleaseId is active."
  Write-Host "Rollback from Windows: .\rollback_release.ps1 $RemoteIp"
  Write-Host "Rollback on the server: bash ~/$RemoteDir/bin/rollback_release.sh --yes"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
