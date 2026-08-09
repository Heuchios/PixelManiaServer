# Commits the electric_tool / wire_cutter / metal_detector atlas migration
# on the SERVER repo (PixelManiaServer).
#
# - electric_tool: texture/inventory_icon updated to atlas keys (visuals
#   only - the ELECTRICAL_TOOL_ITEM gameplay wiring in server.ts is
#   untouched since the item id "electric_tool" didn't change).
# - wire_cutter, metal_detector: new item("tool", {...}) definitions,
#   same shape as electric_tool. Not added to the shop catalog (shop_price
#   0, not sellable yet).
#
# Source file touched: src/server_item_database.ts
# This rebuilds server_item_database.js from it via check:item-data,
# which validates before this script commits anything.
#
# Uses a glob (commit_tool_*.ps1) when adding itself, so this script
# doesn't get left behind as an untracked file blocking deploy.

$ErrorActionPreference = "Stop"

Set-Location "G:\PixelMania\PixelManiaServer"

Write-Host "=== git status (before) ===" -ForegroundColor Cyan
git status

Write-Host ""
Write-Host "=== Rebuilding + validating item-data ===" -ForegroundColor Cyan
npm run check:item-data
if ($LASTEXITCODE -ne 0) {
    Write-Host "check:item-data FAILED. Not committing." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Checking client/server item database sync ===" -ForegroundColor Cyan
npm run check:item-db
if ($LASTEXITCODE -ne 0) {
    Write-Host "check:item-db FAILED. Not committing." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== git status (after build) ===" -ForegroundColor Cyan
git status

Write-Host ""
Write-Host "=== git diff --stat ===" -ForegroundColor Cyan
git diff --stat -- src/server_item_database.ts server_item_database.js

Write-Host ""
Write-Host "=== Full diff for review ===" -ForegroundColor Cyan
git --no-pager diff -- src/server_item_database.ts server_item_database.js

Write-Host ""
Write-Host "Review the diff above carefully." -ForegroundColor Yellow
Write-Host "Press Enter to continue and commit, or Ctrl+C to abort." -ForegroundColor Yellow
Read-Host

git add src/server_item_database.ts server_item_database.js commit_tool_*.ps1

Write-Host ""
Write-Host "=== git status (staged) ===" -ForegroundColor Cyan
git status

$commitMessage = @"
Move electric_tool to atlas, add wire_cutter and metal_detector

- electric_tool: texture/inventory_icon updated to atlas keys
  (electric_tool_1 / electric_tool_icon). Stats unchanged.
- Add wire_cutter and metal_detector item definitions, same shape as
  electric_tool (rarity common, shop_price 0 - not sellable yet).
"@

git commit -m $commitMessage

Write-Host ""
Write-Host "=== git log -1 ===" -ForegroundColor Cyan
git log -1

Write-Host ""
Write-Host "Pushing..." -ForegroundColor Cyan
git push

Write-Host ""
Write-Host "Done. Server repo pushed." -ForegroundColor Green
Write-Host "Next: run .\deploy_staging.ps1 to deploy to staging (NOT production)." -ForegroundColor Yellow
