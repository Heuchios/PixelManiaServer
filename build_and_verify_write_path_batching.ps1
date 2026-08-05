<#
    PixelManiaServer - write-path batching pass (2026-08-05), Phase 4c

    Removes the two largest remaining N+1 loops on the PostgreSQL write path:
      * world-change audit rows  (was 1 INSERT per change, up to 500 per save,
        all issued while holding the exclusive lock on the `worlds` row)
      * inventory snapshot rows  (was 1 INSERT per stack in replaceInventorySnapshot)

    Builds src\postgres_store.ts, runs the new equivalence gate, then runs the
    full release gate. It does NOT commit or deploy -- review the diff first.

    Usage:
        cd G:\PixelMania\PixelManiaServer
        .\build_and_verify_write_path_batching.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer folder (package.json not found here)."
}

$required = @(
    "src\postgres_store.ts",
    "scripts\check_world_change_batching.js"
)
foreach ($file in $required) {
    if (-not (Test-Path $file)) { throw "Missing expected file: $file" }
}

Write-Host ""
Write-Host "=== 1/4  Building postgres_store ===" -ForegroundColor Cyan
npm run build:postgres-store
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run build:postgres-store" }

Write-Host ""
Write-Host "=== 2/4  New equivalence gate (batched rows vs per-change rows) ===" -ForegroundColor Cyan
node scripts/check_world_change_batching.js
if ($LASTEXITCODE -ne 0) { throw "FAILED: scripts/check_world_change_batching.js" }

Write-Host ""
Write-Host "=== 3/4  Item-loss and world-revision gates ===" -ForegroundColor Cyan
# These three are the ones that would catch a regression in inventory rows,
# drop persistence, or world save ordering. Run them before the long chain so a
# failure shows up in seconds rather than minutes.
foreach ($check in @("check:postgres-store", "check:drop-pickup-item-loss", "check:world-revision-persistence", "check:inventory-contracts")) {
    Write-Host ("  -> npm run {0}" -f $check) -ForegroundColor DarkGray
    npm run $check
    if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run $check" }
}

Write-Host ""
Write-Host "=== 4/4  Full release gate ===" -ForegroundColor Cyan
npm run check:security
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:security" }

Write-Host ""
Write-Host "All gates passed." -ForegroundColor Green
Write-Host ""
Write-Host "Files to commit (source AND generated output, or deploy_to_droplet.ps1 will refuse):" -ForegroundColor Yellow
Write-Host "    git add src/postgres_store.ts postgres_store.js scripts/check_world_change_batching.js package.json"
Write-Host "    git commit -m ""perf(postgres): batch world-change and inventory-snapshot inserts"""
Write-Host ""
Write-Host "Then review the diff before deploying:" -ForegroundColor Yellow
Write-Host "    git diff HEAD~1 --stat"
