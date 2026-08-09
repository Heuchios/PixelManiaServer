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

Write-Host "== PixelManiaServer: fix stale pickaxe texture assertion in check_item_data_build.js ==" -ForegroundColor Cyan
Write-Host "Repo path: $RepoPath"

Set-Location -Path $RepoPath

if (-not (Test-Path ".git")) {
    Fail "ERROR: '$RepoPath' does not look like a git repo (no .git folder). Run this script from inside PixelManiaServer, or pass -RepoPath."
}

$files = @("scripts/check_item_data_build.js")

Write-Host ""
Write-Host "-- git status before --" -ForegroundColor Yellow
git status --short $files

Write-Host ""
Write-Host "-- diff (review before continuing) --" -ForegroundColor Yellow
Write-Host "check:item-data still asserted stone_pickaxe/golden_pickaxe/diamond_pickaxe/" -ForegroundColor Yellow
Write-Host "emerald_pickaxe/neptune_pickaxe/void_pickaxe's texture/inventory_icon as the OLD" -ForegroundColor Yellow
Write-Host "res://Assets/items/swords/*.png paths -- stale relative to tonight's hand-items" -ForegroundColor Yellow
Write-Host "atlas migration, which correctly re-pointed them at '<itemId>_1' / '<itemId>_icon'" -ForegroundColor Yellow
Write-Host "atlas keys (same pattern as void_saber). This updates the check's own pinned" -ForegroundColor Yellow
Write-Host "expectation to match -- nothing else in this file changes." -ForegroundColor Yellow
git --no-pager diff -- $files
Write-Host ""
Write-Host "Press Enter to continue and stage/commit this file, or close this window to abort." -ForegroundColor Cyan
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
Update check_item_data_build.js's pickaxe texture assertion for the atlas migration

stone_pickaxe/golden_pickaxe/diamond_pickaxe/emerald_pickaxe/neptune_pickaxe/
void_pickaxe now reference wearable atlas frame keys (<itemId>_1 texture,
<itemId>_icon inventory_icon) instead of res://Assets/items/swords/*.png files,
per the hand-items-batch-1 atlas migration (server_item_database.ts). This check
still asserted the old file-path format and was failing check:item-data /
deploy_staging.ps1 for a reason unrelated to the vending_machine regression fix --
just a stale pinned expectation. Confirmed via repo-wide grep that no other
check_*.js scripts reference the old swords/*.png paths for any of the 15
hand-items-batch-1 items.
"@

Write-Host ""
Write-Host "-- committing --" -ForegroundColor Yellow
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { Fail "ERROR: git commit failed." }

Write-Host ""
Write-Host "Done. Committed (not pushed)." -ForegroundColor Green
Write-Host "Next: git push, then run .\deploy_staging.ps1 again." -ForegroundColor Cyan
Write-Host "Press Enter to close..."
[void][System.Console]::ReadLine()
