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

Write-Host "== PixelManiaServer: build + commit flaming_hair item DB entry ==" -ForegroundColor Cyan
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
Add flaming_hair to server item database

- Mirrors client's flaming_hair (hair slot, common rarity, equipable)
  so scripts/check_item_database_sync.js (npm run check:item-db) stops
  failing the release gate with "Missing from server_item_database.js".
- Server entry is intentionally minimal: textures/icons/hair_animations
  are client presentation with no server counterpart.
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
