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

Write-Host "== PixelManiaServer: build + commit phoenix_wings atlas migration (server) ==" -ForegroundColor Cyan
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
Make phoenix_wings fully atlas-driven (server mirror)

- Mirror the client's item_database.gd change: phoenix_wings' texture/inventory_icon and
  idle_frames/jump_frames/fall_frames/flap_frames now reference the wearable atlas frame
  keys (phoenix_wings_icon, phoenix_wings_1..5) instead of
  res://Assets/items/back_items/phoenix_wings_*.png, using the same 5-frame devil_wings-
  style pattern as the client entry.
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
