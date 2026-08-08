#requires -Version 5.1
<#
.SYNOPSIS
  Verifies the first runtime-require seam batch: 4 of the 10 `const X = require("./y")`
  boundaries converted to real `import X = require("./y")` imports.

.DESCRIPTION
  `const X = require("./y")` is not an import. It is a call on Node's `require`, typed
  `any` by @types/node, and tsc never loads ./y -- so nothing about that boundary is
  checked. Converting the equivalent 39 seams in src/server.ts surfaced 118 compiler
  errors and three real bugs.

  Converted here:
    src/postgres_store_contracts.ts  -> ./server_item_database
        was `const ItemDatabase: any = require(...)`. An explicit `any` on the item
        database, used by the persistence layer for stack limits and item categories.
    src/server_account_helpers.ts    -> ./server_identity_helpers
    src/server_account_session_helpers.ts -> ./server_account_helpers
    src/server_account_session_helpers.ts -> ./server_text_helpers
        these three were `require(...) as { ...hand-written shape... }`. A cast cannot
        fail; it silently lies when the producer changes. The AccountHelpers one had
        already drifted -- it claimed validateUsername/validateEmail/validatePassword
        could return action/retry_ms/retry_after_seconds. They cannot; those fields
        belong to the rate-limit path that shares the same local ValidationResult type.

  WHAT THE FIRST RUN FOUND, and the follow-up fix included here:

    src/postgres_store_contracts.ts(216,80): error TS2345
      Argument of type 'unknown' is not assignable to parameter of type 'string | undefined'

  Exactly one error for the whole conversion, and it was the PRODUCER under-declaring,
  not the consumer misusing it -- the same pattern that dominated the src/server.ts
  batch. `resolveItemCategory(itemId: unknown, requestedCategory = "")` in
  src/server_item_database.ts infers `string | undefined` for the second parameter from
  its default, but the only thing the body does with it is pass it to
  `cleanCategory(category: unknown)`. Its own siblings in the same file already declare
  `unknown`: `canStoreItemInCategory(itemId: unknown, category: unknown)` and
  `getInventoryFieldForCategory(category: unknown)`. It was the odd one out.

  Fix: one line, `requestedCategory: unknown = ""`. 9 bytes, emit-identical (the
  annotation erases), and it widens a parameter, so no existing caller can break.

  Casting at the consumer would have been wrong: it would have added a real
  `cleanName(...)` call to the emitted output and quietly changed what reaches
  `cleanCategory`.

  Emit should be unchanged: `import X = require(...)` emits the identical
  `const X = require("...")` line, and the type assertions erase. Verified in-container
  against the current generated output -- same lines, same order.

.NOTES
  Run from the PixelManiaServer directory, BEFORE committing.
#>
[CmdletBinding()]
param(
  [switch]$SkipGate
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$gateLog = Join-Path $PSScriptRoot "runtime_require_seams_gate.log"

# source file -> the import line that must now be present
$convertedSeams = [ordered]@{
  "src/postgres_store_contracts.ts"       = @('import ItemDatabase = require("./server_item_database");')
  "src/server_account_helpers.ts"         = @('import IdentityHelpers = require("./server_identity_helpers");')
  "src/server_account_session_helpers.ts" = @(
    'import AccountHelpers = require("./server_account_helpers");',
    'import TextHelpers = require("./server_text_helpers");'
  )
}

$affectedGenerated = @(
  "postgres_store_contracts.js",
  "server_account_helpers.js",
  "server_account_session_helpers.js",
  "server_item_database.js"
)

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

Write-Section "1. Preflight: the 4 seams converted, 6 left, no stale casts"

foreach ($file in $convertedSeams.Keys) {
  $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot $file) -Raw
  foreach ($expected in $convertedSeams[$file]) {
    if ($source -notlike "*$expected*") {
      throw "$file is missing the converted import:`n  $expected"
    }
  }
  # A leftover `as {` on a local require would mean a half-finished conversion.
  if ($source -match 'require\("\./[A-Za-z0-9_./-]+"\)\s*as\s*\{') {
    throw "$file still casts a local require with an 'as { ... }' type assertion. The conversion is incomplete."
  }
}
Write-Host "All 4 seams converted, no leftover local-require casts." -ForegroundColor Green

# The producer fix that resolved the single TS2345 from the first run.
$itemDatabaseSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot "src\server_item_database.ts") -Raw
if ($itemDatabaseSource -notlike '*function resolveItemCategory(itemId: unknown, requestedCategory: unknown = ""): string {*') {
  throw @"
src/server_item_database.ts is missing the resolveItemCategory parameter fix.
Expected: function resolveItemCategory(itemId: unknown, requestedCategory: unknown = ""): string {
Without it, src/postgres_store_contracts.ts(216,80) fails with TS2345.
"@
}
Write-Host "Producer fix present: resolveItemCategory now takes unknown, like its siblings." -ForegroundColor Green

# Count what remains, the same way the guard does.
$remaining = 0
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "src") -Filter "*.ts") {
  foreach ($line in (Get-Content -LiteralPath $file.FullName)) {
    if ($line -match '\bimport\s+[A-Za-z0-9_$]+\s*=\s*require\(') { continue }
    if ($line -match 'require\(\s*"\./') { $remaining += 1 }
  }
}
Write-Host "Runtime-only requires still invisible to tsc: $remaining (was 10, expected 6)"
if ($remaining -ne 6) {
  throw "Expected 6 remaining runtime requires, found $remaining. The guard's KNOWN_RUNTIME_REQUIRES pin will disagree."
}
Write-Host "Ledger count matches." -ForegroundColor Green

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

Write-Section "2. Structural guard, then proof it rejects a reverted seam"

& npm run check:tsconfig-projects 2>&1 | Write-Host
if ($LASTEXITCODE -ne 0) {
  throw "check:tsconfig-projects failed. The seam ledger or the inline-dependency pins do not match the source."
}
Write-Host "Guard passed." -ForegroundColor Green

# Put one seam back the way it was. The guard must notice, both because the ledger
# count changes and because postgres-contracts stops type-importing item-data.
$probeFile = Join-Path $PSScriptRoot "src\postgres_store_contracts.ts"
$savedBytes = [System.IO.File]::ReadAllBytes($probeFile)
try {
  $reverted = (Get-Content -LiteralPath $probeFile -Raw).Replace(
    'import ItemDatabase = require("./server_item_database");',
    'const ItemDatabase: any = require("./server_item_database");')
  [System.IO.File]::WriteAllText($probeFile, $reverted)
  $null = & npm run check:tsconfig-projects 2>&1
  $guardRejected = ($LASTEXITCODE -ne 0)
} finally {
  [System.IO.File]::WriteAllBytes($probeFile, $savedBytes)
}

if (-not $guardRejected) {
  throw "The guard ACCEPTED a seam reverted to a runtime require. It is vacuous; do not commit."
}
Write-Host "Guard correctly rejected the reverted seam." -ForegroundColor Green

$null = & npm run check:tsconfig-projects 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Restoring src/postgres_store_contracts.ts did not restore a passing state. Check that file by hand."
}
Write-Host "Source restored and passing again." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. The gate -- where the new type errors will show up
# ---------------------------------------------------------------------------

if ($SkipGate) {
  Write-Section "3. Gate SKIPPED (-SkipGate)"
} else {
  Write-Section "3. Full gate (npm run check:security)"
  Write-Host "The first run produced exactly one error, now fixed at its source. Any"
  Write-Host "remaining errors are new information -- paste them back."

  & npm run check:security 2>&1 | Tee-Object -FilePath $gateLog
  $gateExit = $LASTEXITCODE

  if ($gateExit -ne 0) {
    Write-Host ""
    Write-Host "check:security failed (exit $gateExit)." -ForegroundColor Yellow

    $typeErrors = @(Select-String -LiteralPath $gateLog -Pattern "error TS\d+" | ForEach-Object { $_.Line })
    if ($typeErrors.Count -gt 0) {
      $byCode = $typeErrors |
        ForEach-Object { [regex]::Match($_, "error (TS\d+)").Groups[1].Value } |
        Group-Object | Sort-Object Count -Descending
      Write-Host ""
      Write-Host "$($typeErrors.Count) type errors -- this is the expected outcome, not a broken batch:" -ForegroundColor Cyan
      $byCode | ForEach-Object { Write-Host ("  {0,-8} {1}" -f $_.Name, $_.Count) }
      Write-Host ""
      Write-Host "All of them:" -ForegroundColor Cyan
      $typeErrors | ForEach-Object { Write-Host "  $_" }
      Write-Host ""
      Write-Host "Paste the list above back. Each one is a boundary that was previously" -ForegroundColor Cyan
      Write-Host "unchecked -- some will be real bugs, as three were in src/server.ts." -ForegroundColor Cyan
    } else {
      Write-Host "No 'error TS' lines found, so this is a check-script failure rather than a" -ForegroundColor Yellow
      Write-Host "type error. Last 60 lines:" -ForegroundColor Yellow
      Get-Content -LiteralPath $gateLog -Tail 60
    }
    throw "check:security failed with exit code $gateExit. Full output in $(Split-Path -Leaf $gateLog)."
  }
  Write-Host "check:security passed -- the four boundaries type-check as they stand." -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 4. Byte-identical generated output
# ---------------------------------------------------------------------------

Write-Section "4. Generated .js must be byte-identical to HEAD"
Write-Host 'import X = require(...) emits the same const X = require(...) line, and the'
Write-Host "type assertions erase, so nothing should move. The three files below are the"
Write-Host "ones that could."

$changedGenerated = Invoke-Git -Arguments (@("-c", "core.safecrlf=false", "diff", "--name-only", "HEAD", "--") + $generatedFiles)
if ($changedGenerated) {
  Write-Host ""
  Write-Host "These generated files CHANGED:" -ForegroundColor Red
  Write-Host $changedGenerated
  Write-Host ""
  foreach ($file in $affectedGenerated) {
    if (($changedGenerated -split '\r?\n') -contains $file) {
      Write-Host "--- diff for $file ---" -ForegroundColor Yellow
      & git -c core.safecrlf=false diff HEAD -- $file
    }
  }
  Write-Host ""
  Write-Host "A likely cause is import elision: if tsc decides an imported binding is only" -ForegroundColor Yellow
  Write-Host "used in type positions, it drops the require entirely. Paste the diff." -ForegroundColor Yellow
  throw "Generated output is not byte-identical. Do not commit; report the diff."
}
Write-Host "All $($generatedFiles.Count) generated .js files are byte-identical to HEAD." -ForegroundColor Green

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

Write-Section "Result"
Write-Host "Seam batch 1 verified:" -ForegroundColor Green
Write-Host "  4 runtime requires converted to real imports, 6 left in the ledger"
Write-Host "  a drifted cast removed (AccountHelpers claimed 3 fields it never returns)"
Write-Host "  one under-declared parameter fixed at the producer (resolveItemCategory)"
Write-Host "  guard passes and rejects a reverted seam"
Write-Host "  $($generatedFiles.Count) generated .js byte-identical to HEAD"
if (-not $SkipGate) { Write-Host "  check:security green" }
Write-Host ""
Write-Host "Note: src/postgres_store_contracts.ts now compiles src/server_item_database.ts"
Write-Host "(162 KB) into its program, pinned as an inlineDependency. That makes"
Write-Host "check:postgres-contracts slower and emits a duplicate .tsbuild copy of"
Write-Host "server_item_database.js -- harmless, gitignored, and identical because the guard"
Write-Host "forces the same emit options everywhere. A project reference would avoid both,"
Write-Host "and unlike last time there is now a real type dependency to justify one."
Write-Host ""
Write-Host "Commit with:" -ForegroundColor Cyan
Write-Host "  git add -u"
Write-Host "  git commit -m `"Convert four runtime requires to typed imports; widen resolveItemCategory`""
Write-Host ""
Write-Host "Still under-declared for the same reason, but not yet an error:"
Write-Host '  server_item_database.ts getInventoryFieldForItem(itemId: unknown, requestedCategory = "")'
Write-Host "  server_player_state_helpers.ts:17 and server_world_state_helpers.ts:514 both"
Write-Host '  restate resolveItemCategory with requestedCategory?: string in a Deps interface.'
