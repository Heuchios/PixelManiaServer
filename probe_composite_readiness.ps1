#requires -Version 5.1
<#
.SYNOPSIS
  Measures what the composite + project-references batch will cost, before committing
  to a shape for it. Changes nothing in the repo.

.DESCRIPTION
  Five questions, five probes. All output goes to .tsbuild\probe\ and *.log, both
  gitignored, so this leaves no untracked files and cannot affect a deploy.

    A. Can these modules emit .d.ts at all?
       composite: true FORCES declaration: true. If declaration emit is clean, the
       whole reference graph is cheap. If it throws TS4xxx "using private name"
       errors, each one needs an `export` added to a local interface, and that count
       decides whether references are worth it.

    B. What would promoting noImplicitReturns + noFallthroughCasesInSwitch cost?
       src/postgres_store.ts already enables both. Neither is implied by `strict`, so
       every other project is missing them. This counts the errors in the other 40.

    C. Does composite reject the ambient contracts file?
       7 src files pull in types/pixelmania-contracts.d.ts via a triple-slash
       reference. composite requires every file in the program to be listed in
       include/files (TS6307). If C1 fails and C2 passes, composite projects need
       that .d.ts added to their include -- which is the one real unknown in the plan.

    E. Are the project references from batch 2 actually being used?
       Reads the real program file list for postgres-store. This is the measurement
       that justifies batch 2, and the .tsbuildinfo inspection could not answer it.

    D. Same as B, but for src/server.ts alone.
       B excluded it, yet tsconfig.server-entry.json extends the base, so promoting
       those two options reaches a 34k-line file with 3,671 explicit `any`. If D is
       clean the promotion is one batch; if not, it is two.

  This replaces the broken step 5/6 in build_and_verify_tsconfig_consolidation.ps1,
  which piped tsc straight into Tee-Object. TypeScript 7 exits silently on success,
  Tee-Object never created the file, and Select-String then failed on a missing path.
  Here output is captured into a variable first and the log is always written.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$probeDir = Join-Path $PSScriptRoot ".tsbuild\probe"
$null = New-Item -ItemType Directory -Force -Path $probeDir

$tscShim = Join-Path $PSScriptRoot "node_modules\.bin\tsc.cmd"
if (-not (Test-Path -LiteralPath $tscShim)) {
  throw "Missing $tscShim. Run npm install first."
}

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host ("=" * 78) -ForegroundColor DarkGray
  Write-Host $Title -ForegroundColor Cyan
  Write-Host ("=" * 78) -ForegroundColor DarkGray
}

<#
  Runs one probe config and reports it. Captures output into a variable rather than
  piping to Tee-Object, because tsc emits nothing on success and an empty pipeline
  leaves no log file behind.
#>
function Invoke-Probe {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$ConfigJson,
    [string]$EmitSubdirectory
  )

  $configPath = Join-Path $probeDir "tsconfig.$Name.json"
  $logPath = Join-Path $PSScriptRoot "tsconfig_probe_$Name.log"
  [System.IO.File]::WriteAllText($configPath, $ConfigJson)

  if ($EmitSubdirectory) {
    $emitPath = Join-Path $probeDir $EmitSubdirectory
    if (Test-Path -LiteralPath $emitPath) {
      Remove-Item -LiteralPath $emitPath -Recurse -Force
    }
  }

  $output = (& $tscShim --project $configPath 2>&1 | Out-String)
  $exit = $LASTEXITCODE

  # Always write the log, even when tsc said nothing at all.
  Set-Content -LiteralPath $logPath -Value $output -Encoding UTF8

  $errorLines = @($output -split '\r?\n' | Where-Object { $_ -match 'error TS\d+' })
  $codes = $errorLines |
    ForEach-Object { [regex]::Match($_, 'error (TS\d+)').Groups[1].Value } |
    Group-Object | Sort-Object Count -Descending

  Write-Host ""
  Write-Host ("  exit code       : {0}" -f $exit) -ForegroundColor $(if ($exit -eq 0) { "Green" } else { "Yellow" })
  Write-Host ("  error lines     : {0}" -f $errorLines.Count)
  if ($output.Trim().Length -eq 0) {
    Write-Host "  tsc output      : (empty -- TypeScript 7 prints nothing on success)"
  }
  if ($EmitSubdirectory) {
    $emitted = @(Get-ChildItem -Path (Join-Path $probeDir $EmitSubdirectory) -Filter "*.d.ts" -Recurse -ErrorAction SilentlyContinue)
    Write-Host ("  .d.ts emitted   : {0}" -f $emitted.Count)
  }
  if ($codes) {
    Write-Host "  by error code   :"
    $codes | ForEach-Object { Write-Host ("      {0,-8} {1}" -f $_.Name, $_.Count) }
    Write-Host "  first 20 errors :"
    $errorLines | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" }
  }
  Write-Host ("  full log        : {0}" -f (Split-Path -Leaf $logPath))

  return [pscustomobject]@{
    Name       = $Name
    Exit       = $exit
    ErrorCount = $errorLines.Count
  }
}

# ---------------------------------------------------------------------------
# A. Declaration emit across every module except server.ts
# ---------------------------------------------------------------------------

Write-Section "A. Can these modules emit .d.ts? (composite forces declaration: true)"
Write-Host "Nothing imports src/server.ts, so it never needs a .d.ts and is excluded."
Write-Host "Expecting ~41 .d.ts files if this is clean."

$resultA = Invoke-Probe -Name "declaration" -EmitSubdirectory "decl" -ConfigJson @'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "./decl",
    "rootDir": "../../src",
    "allowJs": false
  },
  "include": ["../../src/**/*.ts", "../../types/**/*.d.ts"],
  "exclude": ["../../src/server.ts"]
}
'@

# ---------------------------------------------------------------------------
# B. Cost of promoting the two non-strict-family options into the base
# ---------------------------------------------------------------------------

Write-Section "B. Cost of promoting noImplicitReturns + noFallthroughCasesInSwitch"
Write-Host "postgres_store.ts already has both and is excluded here, as is server.ts."

$resultB = Invoke-Probe -Name "extra_strictness" -ConfigJson @'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["../../src/**/*.ts", "../../types/**/*.d.ts"],
  "exclude": ["../../src/server.ts", "../../src/postgres_store.ts"]
}
'@

# ---------------------------------------------------------------------------
# C. Does composite reject the triple-slash ambient contracts file?
# ---------------------------------------------------------------------------

Write-Section "C1. composite WITHOUT the ambient .d.ts in include (expect TS6307)"
Write-Host "src/server_drop_contracts.ts pulls in types/pixelmania-contracts.d.ts via"
Write-Host "/// <reference path=...>. composite requires all program files to be listed."

$resultC1 = Invoke-Probe -Name "composite_bare" -EmitSubdirectory "c1" -ConfigJson @'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "outDir": "./c1",
    "rootDir": "../../src",
    "tsBuildInfoFile": "./c1.tsbuildinfo"
  },
  "include": ["../../src/server_drop_contracts.ts"],
  "exclude": []
}
'@

Write-Section "C2. composite WITH the ambient .d.ts in include (expect clean)"

$resultC2 = Invoke-Probe -Name "composite_listed" -EmitSubdirectory "c2" -ConfigJson @'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "outDir": "./c2",
    "rootDir": "../../src",
    "tsBuildInfoFile": "./c2.tsbuildinfo"
  },
  "include": ["../../src/server_drop_contracts.ts", "../../types/pixelmania-contracts.d.ts"],
  "exclude": []
}
'@

# ---------------------------------------------------------------------------
# D. The one file probe B could not cover: src/server.ts
# ---------------------------------------------------------------------------

Write-Section "D. noImplicitReturns + noFallthroughCasesInSwitch on src/server.ts"
Write-Host "Probe B excluded server.ts. But tsconfig.server-entry.json EXTENDS the base, so"
Write-Host "promoting those two options there hits a 34k-line file with 3,671 explicit any."
Write-Host "This is the number that decides whether the promotion is one batch or two."

$resultD = Invoke-Probe -Name "server_entry_extra_strictness" -ConfigJson @'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "moduleDetection": "force"
  },
  "include": ["../../src/server.ts"],
  "exclude": []
}
'@

# ---------------------------------------------------------------------------
# E. Is postgres-store REALLY reading the .d.ts instead of the source?
# ---------------------------------------------------------------------------

Write-Section "E. Proof that the project references are actually being used"
Write-Host "This is the whole justification for batch 2: postgres-store should no longer"
Write-Host "recompile server_item_database.ts (162 KB) plus three contract modules on each"
Write-Host "of its four invocations in check:security."
Write-Host ""
Write-Host "The .tsbuildinfo check in build_and_verify_composite_projects.ps1 came back"
Write-Host "inconclusive because TypeScript 7 does not store paths there as plain text."
Write-Host "--listFiles prints the real program file list, which settles it."

# The referenced outputs have to exist for `-p` to resolve them, so build first.
$null = & $tscShim --build (Join-Path $PSScriptRoot "tsconfig.postgres-store.json") 2>&1
$buildExit = $LASTEXITCODE
if ($buildExit -ne 0) {
  Write-Host "  tsc --build failed (exit $buildExit); cannot probe. Run the batch 2 verify script first." -ForegroundColor Yellow
} else {
  $listLog = Join-Path $PSScriptRoot "tsconfig_probe_listfiles.log"
  # `-p` (not `-b`) so tsc reports THIS project's program only. With references
  # already built, tsc redirects each import to the referenced project's .d.ts.
  $listOutput = (& $tscShim --project (Join-Path $PSScriptRoot "tsconfig.postgres-store.json") --noEmit --listFiles 2>&1 | Out-String)
  $listExit = $LASTEXITCODE
  Set-Content -LiteralPath $listLog -Value $listOutput -Encoding UTF8

  $lines = @($listOutput -split '\r?\n' | Where-Object { $_ })
  $declarationHits = @($lines | Where-Object { $_ -match 'server_item_database\.d\.ts' })
  $sourceHits = @($lines | Where-Object { $_ -match '[\\/]src[\\/]server_item_database\.ts' })

  Write-Host ""
  Write-Host ("  exit code            : {0}" -f $listExit)
  Write-Host ("  files in program     : {0}" -f $lines.Count)
  Write-Host ("  reads *.d.ts         : {0}" -f $declarationHits.Count)
  Write-Host ("  reads src/*.ts       : {0}" -f $sourceHits.Count)
  foreach ($hit in ($declarationHits + $sourceHits)) { Write-Host ("      {0}" -f $hit.Trim()) }

  if ($lines.Count -eq 0) {
    Write-Host "  -> --listFiles produced nothing. Trying --explainFiles instead." -ForegroundColor Yellow
    $explainOutput = (& $tscShim --project (Join-Path $PSScriptRoot "tsconfig.postgres-store.json") --noEmit --explainFiles 2>&1 | Out-String)
    Set-Content -LiteralPath (Join-Path $PSScriptRoot "tsconfig_probe_explainfiles.log") -Value $explainOutput -Encoding UTF8
    $explainLines = @($explainOutput -split '\r?\n' | Where-Object { $_ -match 'server_item_database' })
    Write-Host ("  --explainFiles mentions of server_item_database: {0}" -f $explainLines.Count)
    $explainLines | Select-Object -First 8 | ForEach-Object { Write-Host ("      {0}" -f $_.Trim()) }
  } elseif ($declarationHits.Count -gt 0 -and $sourceHits.Count -eq 0) {
    Write-Host "  -> CONFIRMED. The reference is live; the 162 KB source is not in this program." -ForegroundColor Green
  } elseif ($sourceHits.Count -gt 0) {
    Write-Host "  -> The SOURCE is still being compiled here. The reference is not taking effect," -ForegroundColor Yellow
    Write-Host "     so batch 2 bought nothing for this project. Report this." -ForegroundColor Yellow
  } else {
    Write-Host "  -> server_item_database appears in neither form. Read the log by hand." -ForegroundColor Yellow
  }
  Write-Host ("  full log             : {0}" -f (Split-Path -Leaf $listLog))
}

# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------

Write-Section "Verdict"

if ($resultA.Exit -eq 0) {
  Write-Host "A: declaration emit is CLEAN -> project references are cheap." -ForegroundColor Green
} else {
  Write-Host "A: declaration emit has $($resultA.ErrorCount) errors -> each needs an export added to a local type." -ForegroundColor Yellow
}

if ($resultB.Exit -eq 0) {
  Write-Host "B: both extra options are FREE -> promote them into tsconfig.json." -ForegroundColor Green
} else {
  Write-Host "B: promoting them costs $($resultB.ErrorCount) errors -> separate batch." -ForegroundColor Yellow
}

if ($resultC1.Exit -ne 0 -and $resultC2.Exit -eq 0) {
  Write-Host "C: composite DOES require the ambient .d.ts in include (as predicted)." -ForegroundColor Green
} elseif ($resultC1.Exit -eq 0 -and $resultC2.Exit -eq 0) {
  Write-Host "C: composite accepts the triple-slash reference without listing it." -ForegroundColor Green
} else {
  Write-Host "C: unexpected -- C1 exit $($resultC1.Exit), C2 exit $($resultC2.Exit). Read both logs." -ForegroundColor Yellow
}

if ($resultD.Exit -eq 0) {
  Write-Host "D: server.ts is CLEAN under both -> promote them into tsconfig.json in one batch." -ForegroundColor Green
} else {
  Write-Host "D: server.ts costs $($resultD.ErrorCount) errors -> promote to the base and keep server-entry" -ForegroundColor Yellow
  Write-Host "   on a temporary explicit opt-out, or fix those first as their own batch." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Paste back these lines plus any error codes shown above." -ForegroundColor Cyan
Write-Host ""
Write-Host "Cleanup (optional -- .tsbuild and *.log are gitignored):"
Write-Host "  Remove-Item -Recurse -Force .tsbuild\probe"
