param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$RemoteIp,

  [string]$RemoteUser = "pixelmania",
  [string]$RemoteDir = "PixelManiaServer",
  [string]$SshKeyPath,
  [switch]$Status,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

foreach ($entry in @(
  @{ Name = "RemoteUser"; Value = $RemoteUser },
  @{ Name = "RemoteDir"; Value = $RemoteDir }
)) {
  if (-not $entry.Value -or $entry.Value -notmatch "^[A-Za-z0-9._-]+$") {
    throw "$($entry.Name) may contain only letters, numbers, dots, underscores, and hyphens."
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

$sshArgs = @()
if ($SshKeyPath) {
  Write-Host "Using SSH key: $SshKeyPath"
  $sshArgs += @("-i", $SshKeyPath)
}
$sshArgs += @(
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=4"
)

$remoteScript = "bash ~/$RemoteDir/bin/rollback_release.sh"
if ($Status) {
  $remoteScript += " --status"
} else {
  if (-not $Force) {
    $answer = Read-Host "Swap the current and previous PixelMania releases on $RemoteIp? Type YES to continue"
    if ($answer -cne "YES") {
      Write-Host "Rollback canceled."
      exit 0
    }
  }
  $remoteScript += " --yes"
}

$target = "${RemoteUser}@${RemoteIp}"
$processStart = [System.Diagnostics.ProcessStartInfo]::new()
$processStart.FileName = "ssh"
foreach ($argument in ($sshArgs + @($target, $remoteScript))) {
  [void]$processStart.ArgumentList.Add($argument)
}
$processStart.UseShellExecute = $false

$process = [System.Diagnostics.Process]::Start($processStart)
try {
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "Remote rollback command failed with exit code $($process.ExitCode)"
  }
} finally {
  if ($process -and -not $process.HasExited) {
    $process.Kill()
  }
  if ($process) {
    $process.Dispose()
  }
}
