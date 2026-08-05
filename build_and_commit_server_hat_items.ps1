Param(
    [string]$RepoPath = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
    Write-Host $msg -ForegroundColor Red
    Write-Host ""
    Write-Host "Press Enter to close..."
    [void][System.Console]::ReadLine()
    exit 1
}

Write-Host "== PixelManiaServer: build + commit hat items + beard/eyewear item DB entries ==" -ForegroundColor Cyan
Write-Host "Repo path: $RepoPath"

Set-Location -Path $RepoPath

if (-not (Test-Path ".git")) {
    Fail "ERROR: '$RepoPath' does not look like a git repo (no .git folder). Run this script from inside PixelManiaServer, or pass -RepoPath."
}

if (-not (Test-Path "src/server_item_database.ts")) {
    Fail "ERROR: src/server_item_database.ts not found (are you in the right repo?)"
}

Write-Host ""
Write-Host "-- npm run build:item-data (compiles src/server_item_database.ts -> server_item_database.js) --" -ForegroundColor Yellow
npm run build:item-data
if ($LASTEXITCODE -ne 0) { Fail "ERROR: build:item-data failed. Fix the TypeScript error above before continuing." }

$files = @(
    "src/server_item_database.ts",
    "server_item_database.js"
)

Write-Host ""
Write-Host "-- git status before --" -ForegroundColor Yellow
git status --short $files

Write-Host ""
Write-Host "-- diff (review before continuing) --" -ForegroundColor Yellow
git --no-pager diff -- $files
Write-Host ""
Write-Host "Press Enter to continue and stage/commit these files, or close this window to abort." -ForegroundColor Cyan
[void][System.Console]::ReadLine()

Write-Host ""
Write-Host "-- staging --" -ForegroundColor Yellow
git add -- $files
if ($LASTEXITCODE -ne 0) { Fail "ERROR: git add failed." }

$staged = git diff --cached --name-only -- $files
if (-not $staged) {
    Write-Host ""
    Write-Host "Nothing to commit -- these files already match the last commit." -ForegroundColor Yellow
    Write-Host "Press Enter to close..."
    [void][System.Console]::ReadLine()
    exit 0
}

$commitMessage = @"
Switch baseball caps to atlas, add 8 new hats, add sunglasses + beard category (server)

- Switch red_baseball_cap, green_baseball_cap, blue_baseball_cap texture/inventory_icon
  fields to the new atlas frame keys, mirroring the client change.
- Add straw_hat, yellow_cap, white_cap, red_headband, chefs_hat, cowboy_hat, top_hat,
  black_fedora (hat slot, common rarity, equipable) for scripts/check_item_database_sync.js
  (npm run check:item-db) parity with the client.
- Add sunglasses (eyewear slot) using the existing eyewear category plumbing.
- Add "beard" as a new item category server-side: CATEGORY_TO_FIELD now maps
  beard -> beard_inventory (previously only block/seed/tool/back/hat/hair/eyewear/
  shirt/pants/shoes/ride/currency/material/lure/fish were recognized -- without this,
  the server would have rejected black_beard's category). Add black_beard (beard slot,
  common rarity, equipable) to match the client's new beard equipment slot.
- Not added to any shop pack in this change.
"@

Write-Host ""
Write-Host "-- committing --" -ForegroundColor Yellow
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { Fail "ERROR: git commit failed." }

Write-Host ""
Write-Host "Done. Committed (not pushed, not deployed)." -ForegroundColor Green
Write-Host "Next: run .\deploy_to_droplet.ps1 to push, build-verify, and release to the droplet." -ForegroundColor Cyan
Write-Host "Press Enter to close..."
[void][System.Console]::ReadLine()
