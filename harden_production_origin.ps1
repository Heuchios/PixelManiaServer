[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$RemoteIp,

  [ValidateSet("Apply", "Confirm", "Status", "Rollback")]
  [string]$Mode = "Apply",

  [string]$RootUser = "root",
  [string]$SshKeyPath,
  [string]$RollbackBackup,
  [string]$ApiBase = "https://api.pixelmaniagame.com"
)

$ErrorActionPreference = "Stop"

foreach ($entry in @(
  @{ Name = "RemoteIp"; Value = $RemoteIp; Pattern = "^[A-Za-z0-9.:-]+$" },
  @{ Name = "RootUser"; Value = $RootUser; Pattern = "^[A-Za-z0-9._-]+$" }
)) {
  if (-not $entry.Value -or $entry.Value -notmatch $entry.Pattern) {
    throw "$($entry.Name) contains unsupported characters."
  }
}

if (-not $SshKeyPath) {
  $SshKeyPath = @(
    (Join-Path $HOME ".ssh\pixelmania_ed25519"),
    (Join-Path $HOME ".ssh\id_ed25519")
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $SshKeyPath -or -not (Test-Path -LiteralPath $SshKeyPath)) {
  throw "SSH key not found. Pass -SshKeyPath explicitly."
}

$remote = "${RootUser}@${RemoteIp}"
$sshOptions = @(
  "-i", $SshKeyPath,
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=12",
  "-o", "ServerAliveInterval=5",
  "-o", "ServerAliveCountMax=2"
)

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code $LASTEXITCODE)"
  }
}

function Invoke-RemoteHardening {
  param([string]$RemoteMode, [string]$Argument = "")
  $command = "/usr/local/sbin/pixelmania-origin-hardening $($RemoteMode.ToLowerInvariant())"
  if ($Argument) {
    if ($Argument -notmatch "^/var/backups/pixelmania-origin-hardening/[A-Za-z0-9._-]+$") {
      throw "RollbackBackup is outside the managed backup directory."
    }
    $command += " '$Argument'"
  }
  Invoke-NativeChecked -FilePath "ssh" -Arguments ($sshOptions + @($remote, $command)) -FailureMessage "Remote origin-hardening command failed"
}

function Install-RemoteHardeningTool {
  $localScript = Join-Path $PSScriptRoot "scripts\harden_production_origin.sh"
  if (-not (Test-Path -LiteralPath $localScript)) {
    throw "Missing local hardening script: $localScript"
  }
  $remoteTemporary = "/tmp/pixelmania-origin-hardening-$PID.sh"
  Invoke-NativeChecked -FilePath "scp" -Arguments ($sshOptions + @($localScript, "${remote}:${remoteTemporary}")) -FailureMessage "Could not upload the origin-hardening tool"
  $installCommand = "install -o root -g root -m 0700 '$remoteTemporary' /usr/local/sbin/pixelmania-origin-hardening && rm -f '$remoteTemporary'"
  Invoke-NativeChecked -FilePath "ssh" -Arguments ($sshOptions + @($remote, $installCommand)) -FailureMessage "Could not install the origin-hardening tool"
}

function Test-FreshSshConnection {
  Write-Host "[origin-hardening] verifying a fresh key-only SSH session..."
  Invoke-NativeChecked -FilePath "ssh" -Arguments ($sshOptions + @($remote, "printf 'pixelmania-ssh-key-ok\n'")) -FailureMessage "Fresh key-only SSH verification failed"
}

function Test-CloudflareHealth {
  Write-Host "[origin-hardening] verifying public health through Cloudflare..."
  $response = Invoke-WebRequest -UseBasicParsing -Uri "$ApiBase/health" -Method GET -TimeoutSec 20
  if ($response.StatusCode -ne 200) {
    throw "Cloudflare health request returned HTTP $($response.StatusCode)."
  }
  $serverHeader = [string]$response.Headers["Server"]
  $cfRayHeader = [string]$response.Headers["CF-RAY"]
  if ($serverHeader -notmatch "(?i)cloudflare" -or -not $cfRayHeader) {
    throw "Public health response did not contain Cloudflare edge headers."
  }
  & (Join-Path $PSScriptRoot "smoke_postdeploy.ps1") -ApiBase $ApiBase -RequireRedisReady -RequireRedisStats
}

function Test-DirectOriginBlocked {
  $uri = [Uri]$ApiBase
  if ($uri.Scheme -ne "https") {
    throw "ApiBase must use HTTPS for the direct-origin test."
  }
  Write-Host "[origin-hardening] verifying that direct HTTPS to $RemoteIp is blocked..."
  $curlArguments = @(
    "--silent",
    "--show-error",
    "--output", "NUL",
    "--noproxy", "*",
    "--connect-timeout", "4",
    "--max-time", "8",
    "--resolve", "$($uri.Host):443:$RemoteIp",
    "$($uri.Scheme)://$($uri.Host)/health"
  )
  $curlOutput = & curl.exe @curlArguments 2>&1
  $curlExitCode = $LASTEXITCODE
  if ($curlExitCode -eq 0) {
    throw "Direct-origin HTTPS is still reachable; automatic rollback remains armed."
  }
  Write-Host "[origin-hardening] direct-origin request was blocked as expected (curl exit $curlExitCode)."
  if ($curlOutput) {
    Write-Verbose ($curlOutput | Out-String)
  }
}

switch ($Mode) {
  "Apply" {
    Install-RemoteHardeningTool
    try {
      Invoke-RemoteHardening -RemoteMode "Apply"
      Start-Sleep -Seconds 2
      Test-FreshSshConnection
      Test-CloudflareHealth
      Test-DirectOriginBlocked
      Invoke-RemoteHardening -RemoteMode "Confirm"
      Invoke-RemoteHardening -RemoteMode "Status"
      Write-Host "[origin-hardening] production perimeter hardening is active and confirmed."
    } catch {
      Write-Error "Hardening was not confirmed. The server will restore its saved firewall and SSH policy automatically when the rollback timer expires. $($_.Exception.Message)"
      throw
    }
  }
  "Confirm" {
    Test-FreshSshConnection
    Test-CloudflareHealth
    Test-DirectOriginBlocked
    Invoke-RemoteHardening -RemoteMode "Confirm"
  }
  "Status" {
    Invoke-RemoteHardening -RemoteMode "Status"
  }
  "Rollback" {
    if (-not $RollbackBackup) {
      throw "Pass -RollbackBackup with a directory reported by the apply command."
    }
    Invoke-RemoteHardening -RemoteMode "Rollback" -Argument $RollbackBackup
  }
}
