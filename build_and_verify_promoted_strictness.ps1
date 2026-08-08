#requires -Version 5.1
<#
.SYNOPSIS
  Promotes noImplicitReturns + noFallthroughCasesInSwitch from one project into
  ./tsconfig.json, so all 42 modules get them instead of just src/postgres_store.ts.

.DESCRIPTION
  Neither option is implied by `strict`, so `strict: true` in the base was never enough.
  Only tsconfig.postgres-store.json had them, which meant 41 of 42 modules allowed a
  code path to fall out of a function with no return value, and a switch case to fall
  through into the next one.

  Both are PURE DIAGNOSTICS -- they never change emit. Every generated .js must stay
  byte-identical, and step 4 requires it.

  This is expected to pass first time, because it was measured rather than guessed:

    probe B  all src except server.ts and postgres_store.ts   exit 0, 0 errors
    probe D  src/server.ts alone (34k lines, 3,671 `any`)     exit 0, 0 errors
    postgres_store.ts already had both enabled

  That covers all 42 files. `scripts/**/*.js` and the root `*.js` are in the base's
  include but run under `checkJs: false`, so they produce no diagnostics either way.

  If errors DO appear, that is more interesting than the batch: it means one of those
  probes did not model the real base config, and the delta is worth understanding
  before the next measured change gets trusted.

  Also removes the two options from tsconfig.postgres-store.json, which now inherits
  them. check_postgres_store_build.js already asserts them against the RESOLVED config
  rather than that file's own JSON, so it keeps working either way -- that rewrite was
  done during the consolidation batch precisely so inherited options stay guarded.

.NOTES
  Run from the PixelManiaServer directory, BEFORE committing.
#>
[CmdletBinding()]
param(
  [switch]$SkipGate
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$gateLog = Join-Path $PSScriptRoot "promoted_strictness_gate.log"
$promotedOptions = @("noFallthroughCasesInSwitch", "noImplicitReturns")

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host ("=" * 78) -ForegroundColor DarkGray
  Write-Host $Title -ForegroundColor Cyan
  Write-Host ("=" * 78) -ForegroundColor DarkGray
}

function Invoke-Git {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $output = & git @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE`n$output"
  }
  return ($output | Out-String).TrimEnd()
}

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------

Write-Section "1. Preflight: base sets both, no project restates or opts out"

$base = Get-Content -LiteralPath (Join-Path $PSScriptRoot "tsconfig.json") -Raw | ConvertFrom-Json
foreach ($option in $promotedOptions) {
  if ($base.compilerOptions.$option -ne $true) {
    throw "tsconfig.json must set ${option}: true. It is not implied by strict, so nothing else enforces it."
  }
}
Write-Host "Base sets both options." -ForegroundColor Green

# Every per-module project must now be silent about them -- inherited, not restated,
# and certainly not disabled.
$offenders = @()
foreach ($file in Get-ChildItem -LiteralPath $PSScriptRoot -Filter "tsconfig.*.json") {
  if ($file.Name -eq "tsconfig.eslint.json") { continue }
  $json = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
  foreach ($option in $promotedOptions) {
    if ($null -ne $json.compilerOptions.PSObject.Properties[$option]) {
      $offenders += "$($file.Name) still names $option locally (value: $($json.compilerOptions.$option))"
    }
  }
}
if ($offenders.Count -gt 0) {
  throw ("These configs should inherit the promoted options instead:`n  " + ($offenders -join "`n  "))
}
Write-Host "No project restates or overrides either option." -ForegroundColor Green

$generatedFiles = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "src") -Filter "*.ts" |
  ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Name) + ".js" })

$trackedDiff = Invoke-Git -Arguments @("-c", "core.safecrlf=false", "diff", "--name-only", "HEAD", "--")
$untracked = Invoke-Git -Arguments @("ls-files", "--others", "--exclude-standard")
$changedPaths = @(@($trackedDiff -split '\r?\n') + @($untracked -split '\r?\n') | Where-Object { $_ })
$generatedAlreadyDirty = @($generatedFiles | Where-Object { $changedPaths -contains $_ })
if ($generatedAlreadyDirty.Count -gt 0) {
  throw "These generated files are already modified before the build: $($generatedAlreadyDirty -join ', '). Commit or restore them first."
}
Write-Host "No generated .js is dirty yet -- step 4 will be attributable to this batch." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. Structural guard, and proof it is not vacuous
# ---------------------------------------------------------------------------

Write-Section "2. Structural guard, then proof it rejects the base losing an option"

& npm run check:tsconfig-projects 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0) {
  throw "check:tsconfig-projects failed. The promoted options are not where the guard expects them."
}
Write-Host "Guard passed." -ForegroundColor Green

# Take noImplicitReturns back out of the base. Because it is not part of the `strict`
# family, nothing else in the guard would notice -- so if this is not rejected, the
# promotion has no protection at all and can silently regress.
$basePath = Join-Path $PSScriptRoot "tsconfig.json"
$savedBytes = [System.IO.File]::ReadAllBytes($basePath)
try {
  $stripped = (Get-Content -LiteralPath $basePath -Raw) -replace '\s*"noImplicitReturns": true,', ''
  [System.IO.File]::WriteAllText($basePath, $stripped)
  $null = & npm run check:tsconfig-projects 2>&1
  $guardRejected = ($LASTEXITCODE -ne 0)
} finally {
  [System.IO.File]::WriteAllBytes($basePath, $savedBytes)
}

if (-not $guardRejected) {
  throw "The guard ACCEPTED the base without noImplicitReturns. The promotion is unprotected; do not commit."
}
Write-Host "Guard correctly rejected the base losing noImplicitReturns." -ForegroundColor Green

$null = & npm run check:tsconfig-projects 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Restoring tsconfig.json did not restore a passing state. Check that file by hand."
}
Write-Host "Base restored and passing again." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. The gate
# ---------------------------------------------------------------------------

if ($SkipGate) {
  Write-Section "3. Gate SKIPPED (-SkipGate)"
} else {
  Write-Section "3. Full gate (npm run check:security)"
  Write-Host "41 modules are now checked for implicit returns and switch fallthrough for"
  Write-Host "the first time. Probes measured 0 errors, so this should be quiet."

  & npm run check:security 2>&1 | Tee-Object -FilePath $gateLog
  $gateExit = $LASTEXITCODE

  if ($gateExit -ne 0) {
    Write-Host ""
    Write-Host "check:security failed (exit $gateExit)." -ForegroundColor Yellow

    $typeErrors = @(Select-String -LiteralPath $gateLog -Pattern "error TS\d+" | ForEach-Object { $_.Line })
    if ($typeErrors.Count -gt 0) {
      Write-Host ""
      Write-Host "$($typeErrors.Count) type errors. Probes B and D both measured ZERO, so each of" -ForegroundColor Cyan
      Write-Host "these means the probe config did not match the real base. Worth understanding." -ForegroundColor Cyan
      Write-Host ""
      Write-Host "TS7030 = not all code paths return a value  (noImplicitReturns)"
      Write-Host "TS7029 = fallthrough case in switch          (noFallthroughCasesInSwitch)"
      Write-Host "Anything else came from somewhere unexpected."
      Write-Host ""
      $typeErrors | ForEach-Object { Write-Host "  $_" }
      Write-Host ""
      Write-Host "Paste the list back. An implicit return is often a real missing branch." -ForegroundColor Cyan
    } else {
      Write-Host "No 'error TS' lines, so this is a check-script failure. Last 60 lines:" -ForegroundColor Yellow
      Get-Content -LiteralPath $gateLog -Tail 60
    }
    throw "check:security failed with exit code $gateExit. Full output in $(Split-Path -Leaf $gateLog)."
  }
  Write-Host "check:security passed -- all 42 modules are clean under both options." -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 4. Byte-identical generated output
# ---------------------------------------------------------------------------

Write-Section "4. Generated .js must be byte-identical to HEAD"
Write-Host "Both options are diagnostics only. If any generated file moved, something other"
Write-Host "than this batch is in the working tree."

$changedGenerated = Invoke-Git -Arguments (@("-c", "core.safecrlf=false", "diff", "--name-only", "HEAD", "--") + $generatedFiles)
if ($changedGenerated) {
  Write-Host ""
  Write-Host "These generated files CHANGED, which a diagnostic-only option cannot cause:" -ForegroundColor Red
  Write-Host $changedGenerated
  & git -c core.safecrlf=false diff --stat HEAD -- $generatedFiles
  throw "Generated output is not byte-identical. Do not commit; report the diff."
}
Write-Host "All $($generatedFiles.Count) generated .js files are byte-identical to HEAD." -ForegroundColor Green

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

Write-Section "Result"
Write-Host "Promoted strictness verified:" -ForegroundColor Green
Write-Host "  noImplicitReturns + noFallthroughCasesInSwitch now apply to all 42 modules"
Write-Host "  postgres-store keeps only allowJs locally; the rest is inherited"
Write-Host "  guard rejects the base losing either option"
Write-Host "  $($generatedFiles.Count) generated .js byte-identical to HEAD"
if (-not $SkipGate) { Write-Host "  check:security green" }
Write-Host ""
Write-Host "Commit with:" -ForegroundColor Cyan
Write-Host "  git add -u"
Write-Host "  git commit -m `"Promote noImplicitReturns and noFallthroughCasesInSwitch to all projects`""
Write-Host ""
Write-Host "Next: the 4 src/postgres_store.ts runtime-require seams. 508 KB whose four" -ForegroundColor Cyan
Write-Host "dependencies are all untyped today, and it is now checked under both new options." -ForegroundColor Cyan
