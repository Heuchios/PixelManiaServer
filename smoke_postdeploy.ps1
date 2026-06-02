param(
  [Parameter(Mandatory = $false)]
  [string]$ApiBase = "https://api.pixelmaniagame.com",

  [string]$SmokeName = "PixelMania post-deploy smoke",

  [int]$RetryCount = 3,

  [int]$RetryDelayMs = 900,

  [int]$TimeoutSeconds = 20,

  [switch]$RequireRedisStats,

  [switch]$RequireRedisReady
)

$ErrorActionPreference = "Stop"

function Invoke-SmokeCheck {
  param([string]$Name, [scriptblock]$Action)
  Write-Host "[$SmokeName] $Name"
  & $Action
}

function Get-JsonWithRetry {
  param([string]$Uri)
  for ($attempt = 1; $attempt -le $RetryCount; $attempt++) {
    try {
      return Invoke-RestMethod -Uri $Uri -Method GET -TimeoutSec $TimeoutSeconds
    } catch {
      if ($attempt -ge $RetryCount) {
        throw "[${SmokeName}] Failed after $RetryCount attempt(s): $Uri. $($_.Exception.Message)"
      }
      Start-Sleep -Milliseconds $RetryDelayMs
    }
  }
  throw "[${SmokeName}] Failed to fetch $Uri"
}

function RequireTrue {
  param([object]$Value, [string]$Message)
  if ($Value -ne $true) {
    throw "[${SmokeName}] $Message"
  }
}

Invoke-SmokeCheck "checking /health" {
  $health = Get-JsonWithRetry "$ApiBase/health"

  if (-not $health.ok) {
    throw "[${SmokeName}] /health did not return ok=true."
  }

  RequireTrue $health.persistence.postgres_ready "postgres_ready must be true in /health payload."
  RequireTrue $health.persistence.postgres_authoritative "postgres_authoritative must be true in /health payload."

  if ($RequireRedisReady) {
    RequireTrue $health.persistence.redis_ready "redis_ready must be true in /health payload."
  }

  if ($RequireRedisStats) {
    if (-not $health.persistence.redis_stats) {
      throw "[${SmokeName}] require redis_stats but it was not returned from /health."
    }
    if (-not $health.persistence.redis_stats.enabled) {
      throw "[${SmokeName}] redis_stats.enabled is not true."
    }
  }

  $health | ConvertTo-Json -Depth 10 | Write-Output
}

Invoke-SmokeCheck "checking /verify-email no-token guard" {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$ApiBase/verify-email" -Method GET -TimeoutSec $TimeoutSeconds -ErrorAction Stop | Out-Null
  } catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      try {
        $statusCode = [int]$_.Exception.Response.StatusCode
      } catch {
        $statusCode = $null
      }
    }
    if ($statusCode -ne 400) {
      throw "[${SmokeName}] /verify-email check failed: $($_.Exception.Message)"
    }
  }
}

Write-Host "[$SmokeName] success"
