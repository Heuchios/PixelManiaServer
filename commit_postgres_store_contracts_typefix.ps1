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

Write-Host "== PixelManiaServer: commit postgres_store_contracts.ts type fix ==" -ForegroundColor Cyan
Write-Host "Repo path: $RepoPath"

Set-Location -Path $RepoPath

if (-not (Test-Path ".git")) {
    Fail "ERROR: '$RepoPath' does not look like a git repo (no .git folder). Run this script from inside PixelManiaServer, or pass -RepoPath."
}

$files = @(
    "src/postgres_store_contracts.ts"
)

foreach ($f in $files) {
    if (-not (Test-Path $f)) {
        Fail "ERROR: expected file not found: $f (are you in the right repo?)"
    }
}

Write-Host ""
Write-Host "-- git status before (whole repo, so you can see everything else that's dirty) --" -ForegroundColor Yellow
git status --short

Write-Host ""
Write-Host "-- diff of the file THIS script will commit (postgres_store_contracts.ts only) --" -ForegroundColor Yellow
Write-Host "This does NOT touch .env.example, src/server.ts, src/server_phase11a_runtime.ts, or" -ForegroundColor Yellow
Write-Host "the untracked build_and_verify_pc_launcher_manifest script -- those are left as-is" -ForegroundColor Yellow
Write-Host "for you to handle separately." -ForegroundColor Yellow
Write-Host ""
git --no-pager diff -- $files

Write-Host ""
Write-Host "Press Enter to continue and stage/commit ONLY postgres_store_contracts.ts, or close this window to abort." -ForegroundColor Cyan
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
Fix TS2345 in postgres_store_contracts.ts's local resolveItemCategory wrapper

Line 216 passed the wrapper's itemCategory param (typed unknown) straight into
ItemDatabase.resolveItemCategory's second parameter (typed string), which tsc
correctly rejects under strict mode. Wrap it with the file's own cleanName()
helper first, matching the same pattern already used two lines below (line
219: cleanName(itemCategory || "block")). Pure type-safety fix, no behavior
change -- ItemDatabase.resolveItemCategory's own cleanCategory() already
String()-coerces its input, so pre-cleaning via cleanName() is a no-op on the
actual runtime value.

Unrelated to the item-atlas migration batch; found while chasing a
check:security build failure on this branch.
"@

Write-Host ""
Write-Host "-- committing --" -ForegroundColor Yellow
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { Fail "ERROR: git commit failed." }

Write-Host ""
Write-Host "Done. Committed (not pushed)." -ForegroundColor Green
Write-Host "Remaining dirty files (.env.example, src/server.ts, src/server_phase11a_runtime.ts," -ForegroundColor Yellow
Write-Host "build_and_verify_pc_launcher_manifest...ps1) are still untouched -- deploy_staging.ps1" -ForegroundColor Yellow
Write-Host "will still block on those until you commit or stash them yourself." -ForegroundColor Yellow
Write-Host "Press Enter to close..."
[void][System.Console]::ReadLine()
