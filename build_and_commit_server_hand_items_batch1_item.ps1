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

Write-Host "== PixelManiaServer: build + commit hand-items batch 1 atlas migration (server) ==" -ForegroundColor Cyan
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
Write-Host "Mirrors the client change for 15 hand items: stone/golden/diamond/emerald/" -ForegroundColor Yellow
Write-Host "neptune/void pickaxe, void_trident, blood_battleaxe, neptune_trident, blue/red/" -ForegroundColor Yellow
Write-Host "green saber, sakura_sword, angelic_sword (renamed from ant_sword), and" -ForegroundColor Yellow
Write-Host "phoenix_sword now reference wearable atlas frame keys for texture/inventory_icon" -ForegroundColor Yellow
Write-Host "instead of res://Assets/items/swords/*.png files. neptune_pickaxe and" -ForegroundColor Yellow
Write-Host "void_pickaxe keep their existing hand_item_animations frame lists, just" -ForegroundColor Yellow
Write-Host "re-pointed at the atlas keys -- every other item here does NOT get" -ForegroundColor Yellow
Write-Host "hand_item_animations added server-side, matching the existing pattern (only" -ForegroundColor Yellow
Write-Host "neptune_pickaxe/void_pickaxe had it before, and blue/red/green_saber's new idle" -ForegroundColor Yellow
Write-Host "loop is client-only, same as void_saber's)." -ForegroundColor Yellow
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
Make 15 hand items fully atlas-driven, rename ant_sword to angelic_sword (server mirror)

- Mirror the client's item_database.gd changes: stone_pickaxe, golden_pickaxe,
  diamond_pickaxe, emerald_pickaxe, neptune_pickaxe, void_pickaxe, void_trident,
  blood_battleaxe, neptune_trident, blue_saber, red_saber, green_saber, sakura_sword,
  angelic_sword (renamed from ant_sword), and phoenix_sword now reference wearable
  atlas frame keys for texture/inventory_icon instead of res://Assets/items/swords/*.png
  files. neptune_pickaxe/void_pickaxe keep their existing hand_item_animations frame
  arrays, re-pointed at the new atlas keys. No other item gains hand_item_animations
  server-side, matching the established pattern that the server database only needs
  static texture/icon references for hand items without pre-existing animation data.
  angelic_sword's key rename does NOT migrate any live player inventory referencing the
  old ant_sword id.
"@

Write-Host ""
Write-Host "-- committing --" -ForegroundColor Yellow
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { Fail "ERROR: git commit failed." }

Write-Host ""
Write-Host "Done. Committed (not pushed, not deployed)." -ForegroundColor Green
Write-Host "Next: run .\deploy_staging.ps1 to ship this to STAGING." -ForegroundColor Cyan
Write-Host "Press Enter to close..."
[void][System.Console]::ReadLine()
