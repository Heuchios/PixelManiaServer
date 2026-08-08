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

Write-Host "== PixelManiaServer: build + commit postgres_store_contracts.js (generated output) ==" -ForegroundColor Cyan
Write-Host "Repo path: $RepoPath"

Set-Location -Path $RepoPath

if (-not (Test-Path ".git")) {
    Fail "ERROR: '$RepoPath' does not look like a git repo (no .git folder). Run this script from inside PixelManiaServer, or pass -RepoPath."
}

if (-not (Test-Path "src/postgres_store_contracts.ts")) {
    Fail "ERROR: src/postgres_store_contracts.ts not found (are you in the right repo?)"
}

Write-Host ""
Write-Host "-- npm run build:postgres-contracts (compiles src/postgres_store_contracts.ts -> postgres_store_contracts.js) --" -ForegroundColor Yellow
npm run build:postgres-contracts
if ($LASTEXITCODE -ne 0) { Fail "ERROR: build:postgres-contracts failed. Fix the TypeScript error above before continuing." }

$files = @(
    "postgres_store_contracts.js"
)

Write-Host ""
Write-Host "-- git status before --" -ForegroundColor Yellow
git status --short $files

Write-Host ""
Write-Host "-- diff (review before continuing) --" -ForegroundColor Yellow
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
    Write-Host "Nothing to commit -- this file already matches the last commit." -ForegroundColor Yellow
    Write-Host "Press Enter to close..."
    [void][System.Console]::ReadLine()
    exit 0
}

$commitMessage = @"
Regenerate postgres_store_contracts.js from the TS2345 type fix

The src/postgres_store_contracts.ts fix (commit 4594ee6) was committed without
regenerating its compiled output, so deploy_to_droplet.ps1's release-content
preflight correctly refused to ship (committed postgres_store_contracts.js did
not match a fresh build). This commits the regenerated .js so the two are back
in sync. No source changes, purely a rebuild.
"@

Write-Host ""
Write-Host "-- committing --" -ForegroundColor Yellow
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { Fail "ERROR: git commit failed." }

Write-Host ""
Write-Host "Done. Committed (not pushed)." -ForegroundColor Green
Write-Host "Next: re-run .\deploy_staging.ps1" -ForegroundColor Cyan
Write-Host "Press Enter to close..."
[void][System.Console]::ReadLine()
