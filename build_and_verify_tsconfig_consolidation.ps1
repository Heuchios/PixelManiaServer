#requires -Version 5.1
<#
.SYNOPSIS
  Verifies the tsconfig consolidation batch: 37 hand-copied project configs now
  extend ./tsconfig.json, and the 12 that silently set
  useUnknownInCatchVariables:false no longer do.

.DESCRIPTION
  The dangerous failure mode for this change is NOT a build error. It is a build
  that succeeds while checking less than it did before -- a project that inherits
  an empty program, or loses a strict option, and still exits 0. So this script
  does four things in order, and stops at the first one that fails:

    0b. Verifies the lint split. `npm run lint` used to lint the positive control
       as a target, so it exited 1 forever and check:security could never pass.
    1. Runs the new structural guard (check:tsconfig-projects), which asserts the
       RESOLVED options of all 37 projects rather than the text of any one file.
    2. Proves that guard is not vacuous, by swapping one config back to its
       pre-consolidation form on disk and requiring the guard to reject it.
    3. Runs the full check:security gate.
    4. Requires every generated root .js to be byte-identical to HEAD, which is
       what deploy_to_droplet.ps1 independently enforces.

  The composite / project-reference measurements live in probe_composite_readiness.ps1
  so they can be rerun without repeating the gate.

.NOTES
  Run from the PixelManiaServer directory. Logs are written as *.log, which
  .gitignore already covers, so a failed run leaves no untracked files behind.
#>
[CmdletBinding()]
param(
  [switch]$SkipGate
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$gateLog = Join-Path $PSScriptRoot "tsconfig_consolidation_gate.log"

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
# 0. Preflight: are the edited files actually in place?
# ---------------------------------------------------------------------------

Write-Section "0. Preflight"

$requiredFiles = @(
  "scripts\tsconfig_effective.js",
  "scripts\check_tsconfig_projects.js",
  "scripts\check_lint_positive_control.js",
  "scripts\check_postgres_store_build.js",
  "scripts\check_server_phase11e_to_11j_entry_build.js",
  "package.json",
  "tsconfig.json"
)
foreach ($file in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $file))) {
    throw "Missing expected file: $file"
  }
}

$projectConfigs = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter "tsconfig.*.json" |
  Where-Object { $_.Name -ne "tsconfig.eslint.json" })
Write-Host "Project configs found: $($projectConfigs.Count) (expected 37)"
if ($projectConfigs.Count -ne 37) {
  throw "Expected 37 project configs, found $($projectConfigs.Count). The file set does not match this batch."
}

$notExtending = @($projectConfigs | Where-Object {
  $json = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
  $json.extends -ne "./tsconfig.json"
})
if ($notExtending.Count -gt 0) {
  throw "These configs do not extend ./tsconfig.json: $($notExtending.Name -join ', ')"
}
Write-Host "All 37 configs extend ./tsconfig.json" -ForegroundColor Green

$looseCatch = @($projectConfigs | Where-Object {
  $json = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
  $null -ne $json.compilerOptions.PSObject.Properties["useUnknownInCatchVariables"] -and
    $json.compilerOptions.useUnknownInCatchVariables -eq $false
})
if ($looseCatch.Count -gt 0) {
  throw "These configs still weaken useUnknownInCatchVariables: $($looseCatch.Name -join ', ')"
}
Write-Host "No config weakens useUnknownInCatchVariables (was 12 before this batch)" -ForegroundColor Green

# The generated files whose bytes must not move. Derived from src/, not hardcoded,
# so a new module cannot slip past this check.
$generatedFiles = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "src") -Filter "*.ts" |
  ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Name) + ".js" })
Write-Host "Generated root .js files to verify: $($generatedFiles.Count)"

$missingGenerated = @($generatedFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $_)) })
if ($missingGenerated.Count -gt 0) {
  throw "These generated files are missing from the repo root: $($missingGenerated -join ', ')"
}

# NOTE: run this BEFORE committing. Step 4 compares generated output against HEAD,
# so if this batch is already committed there is nothing left to compare against.
$trackedDiff = Invoke-Git -Arguments @("-c", "core.safecrlf=false", "diff", "--name-only", "HEAD", "--")
$untracked = Invoke-Git -Arguments @("ls-files", "--others", "--exclude-standard")
$changedPaths = @(@($trackedDiff -split '\r?\n') + @($untracked -split '\r?\n') | Where-Object { $_ })

Write-Host ""
Write-Host "Working tree changes going into this run (expected: the tsconfigs, package.json, and scripts):"
if ($changedPaths.Count -eq 0) {
  Write-Host "  (none -- this batch appears to be committed already; step 4 cannot detect emit drift)" -ForegroundColor Yellow
} else {
  $changedPaths | ForEach-Object { Write-Host "  $_" }
}

$generatedAlreadyDirty = @($generatedFiles | Where-Object { $changedPaths -contains $_ })
if ($generatedAlreadyDirty.Count -gt 0) {
  throw @"
These generated files are ALREADY modified before the build runs:
  $($generatedAlreadyDirty -join ', ')
Commit or restore them first, otherwise step 4 cannot tell this batch's effect
apart from a change that was already sitting in the tree.
"@
}
Write-Host "No generated .js is dirty yet -- step 4 will be attributable to this batch." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 0b. Lint split (fixes a pre-existing gate failure, not part of consolidation)
# ---------------------------------------------------------------------------

Write-Section "0b. Lint split: 'lint' must pass, positive control must still fire"

# `npm run lint` used to pass lint/positive_control.ts as a target. That file exists
# to PRODUCE an error, so the script exited 1 forever -- and once it was prepended to
# check:typescript, check:security could never go green. The two jobs are now split:
#   lint                    -> src only, must find nothing
#   lint:positive-control   -> reads ESLint's JSON report, fails if the rule DOESN'T fire
& npm run lint:positive-control 2>&1 | Write-Host
$controlExit = $LASTEXITCODE
if ($controlExit -ne 0) {
  throw "lint:positive-control failed with exit code $controlExit. The type-aware linter may be inert -- see the message above."
}
Write-Host "Positive control fires: the linter is live." -ForegroundColor Green

& npm run lint 2>&1 | Write-Host
$lintExit = $LASTEXITCODE
if ($lintExit -ne 0) {
  throw "npm run lint failed with exit code $lintExit. These are real findings in src/ -- paste them back."
}
Write-Host "src/ lints clean." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 1. Structural guard
# ---------------------------------------------------------------------------

Write-Section "1. Structural guard (check:tsconfig-projects)"

& npm run check:tsconfig-projects 2>&1 | Write-Host
$guardExit = $LASTEXITCODE
if ($guardExit -ne 0) {
  throw "check:tsconfig-projects failed with exit code $guardExit. The project layout does not match the pinned registry."
}
Write-Host "Structural guard passed." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. Prove the guard is not vacuous
# ---------------------------------------------------------------------------

Write-Section "2. Non-vacuity: the guard must REJECT the pre-consolidation config"

$probeConfigPath = Join-Path $PSScriptRoot "tsconfig.server-trade-routes.json"
$savedBytes = [System.IO.File]::ReadAllBytes($probeConfigPath)

# Exactly what tsconfig.server-trade-routes.json looked like before this batch:
# a hand-copied sibling of the base that also switched catch variables to `any`.
$preConsolidationForm = @'
{
  "compilerOptions": {
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "module": "CommonJS",
    "noEmit": false,
    "outDir": ".tsbuild",
    "rootDir": "src",
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022",
    "types": ["node"],
    "useUnknownInCatchVariables": false
  },
  "include": ["src/server_trade_routes.ts"],
  "exclude": ["node_modules"]
}
'@

try {
  [System.IO.File]::WriteAllText($probeConfigPath, $preConsolidationForm)
  $null = & npm run check:tsconfig-projects 2>&1
  $guardRejected = ($LASTEXITCODE -ne 0)
} finally {
  [System.IO.File]::WriteAllBytes($probeConfigPath, $savedBytes)
}

if (-not $guardRejected) {
  throw @"
The guard ACCEPTED the pre-consolidation config. It is vacuous and proves nothing.
Do not commit this batch until check_tsconfig_projects.js rejects that input.
"@
}
Write-Host "Guard correctly rejected the pre-consolidation config." -ForegroundColor Green

$null = & npm run check:tsconfig-projects 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Restoring tsconfig.server-trade-routes.json did not restore a passing state. Check that file by hand."
}
Write-Host "Original config restored and passing again." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. Full gate
# ---------------------------------------------------------------------------

if ($SkipGate) {
  Write-Section "3. Full gate SKIPPED (-SkipGate)"
} else {
  Write-Section "3. Full gate (npm run check:security)"
  Write-Host "This rebuilds every project and reruns all 67 check scripts. Log: $(Split-Path -Leaf $gateLog)"

  & npm run check:security 2>&1 | Tee-Object -FilePath $gateLog
  $gateExit = $LASTEXITCODE

  if ($gateExit -ne 0) {
    Write-Host ""
    Write-Host "check:security FAILED (exit $gateExit). Last 60 lines:" -ForegroundColor Red
    Get-Content -LiteralPath $gateLog -Tail 60
    throw "check:security failed with exit code $gateExit. Full output in $(Split-Path -Leaf $gateLog)."
  }
  Write-Host "check:security passed." -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 4. Byte-identical generated output
# ---------------------------------------------------------------------------

Write-Section "4. Generated .js must be byte-identical to HEAD"

# Windows can mark a rewritten file dirty by timestamp even when the blob matches,
# which is why this compares blobs via git diff rather than mtimes.
$changedGenerated = Invoke-Git -Arguments (@("-c", "core.safecrlf=false", "diff", "--name-only", "HEAD", "--") + $generatedFiles)

if ($changedGenerated) {
  Write-Host ""
  Write-Host "These generated files CHANGED. A tsconfig edit altered compiler output:" -ForegroundColor Red
  Write-Host $changedGenerated
  Write-Host ""
  Write-Host "Per-file diff stat:" -ForegroundColor Yellow
  & git -c core.safecrlf=false diff --stat HEAD -- $generatedFiles
  Write-Host ""
  Write-Host "Inspect one with:" -ForegroundColor Yellow
  Write-Host "  git -c core.safecrlf=false diff HEAD -- <file> | Select-Object -First 80"
  throw "Generated output is not byte-identical. Do not commit; report the diff."
}

Write-Host "All $($generatedFiles.Count) generated .js files are byte-identical to HEAD." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. Next batch
# ---------------------------------------------------------------------------

Write-Section "5. Next batch"
Write-Host "The composite / project-reference probes now live in their own script, so"
Write-Host "they can be rerun without repeating check:security:"
Write-Host ""
Write-Host "  .\probe_composite_readiness.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "They changed nothing in the repo either way; this script's job is verification."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

Write-Section "Result"
Write-Host "Consolidation verified:" -ForegroundColor Green
Write-Host "  37 project configs extend ./tsconfig.json"
Write-Host "  0 configs weaken useUnknownInCatchVariables (was 12)"
Write-Host "  structural guard passes and rejects the pre-consolidation form"
Write-Host "  $($generatedFiles.Count) generated .js byte-identical to HEAD"
if (-not $SkipGate) { Write-Host "  check:security green" }
Write-Host ""
Write-Host "Commit with:" -ForegroundColor Cyan
Write-Host "  git add -u"
Write-Host "  git add scripts/tsconfig_effective.js scripts/check_tsconfig_projects.js scripts/check_lint_positive_control.js"
Write-Host "  git commit -m `"Consolidate 37 tsconfigs onto the base and guard resolved strictness`""
Write-Host ""
Write-Host "Then run .\probe_composite_readiness.ps1 and paste back its verdict." -ForegroundColor Cyan
