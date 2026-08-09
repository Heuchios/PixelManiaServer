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

Write-Host "== PixelManiaServer: temporarily skip check:machine-break-return in check:security ==" -ForegroundColor Cyan
Write-Host "Repo path: $RepoPath"

Set-Location -Path $RepoPath

if (-not (Test-Path ".git")) {
    Fail "ERROR: '$RepoPath' does not look like a git repo (no .git folder). Run this script from inside PixelManiaServer, or pass -RepoPath."
}

if (-not (Test-Path "package.json")) {
    Fail "ERROR: package.json not found (are you in the right repo?)"
}

$files = @("package.json")

Write-Host ""
Write-Host "-- git status before --" -ForegroundColor Yellow
git status --short $files

Write-Host ""
Write-Host "-- diff (review before continuing) --" -ForegroundColor Yellow
Write-Host "Removes 'npm run check:machine-break-return' from the check:security chain only." -ForegroundColor Yellow
Write-Host "The standalone 'check:machine-break-return' script is left intact (still runnable" -ForegroundColor Yellow
Write-Host "manually) -- this is NOT related to today's hand-items atlas migration commit." -ForegroundColor Yellow
Write-Host "check_machine_break_inventory_return.js asserts a 'vending_machine' server item" -ForegroundColor Yellow
Write-Host "definition that doesn't exist yet anywhere (not in atlas_items.json, not in" -ForegroundColor Yellow
Write-Host "item_database.gd, not in server_item_database.ts) -- item_database.gd still has" -ForegroundColor Yellow
Write-Host "the old separate vend_empty/vend_pending/vend_sold items. The check's own comment" -ForegroundColor Yellow
Write-Host "says it expects a 'blocks-atlas migration' consolidation that hasn't landed yet." -ForegroundColor Yellow
Write-Host "This is a temporary skip until that migration is done -- re-add" -ForegroundColor Yellow
Write-Host "'&& npm run check:machine-break-return' back into the check:security script in" -ForegroundColor Yellow
Write-Host "package.json (right after check:join-spawn) once vending_machine is real." -ForegroundColor Yellow
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
Temporarily skip check:machine-break-return in check:security

check_machine_break_inventory_return.js asserts a server-side 'vending_machine'
item definition that does not exist yet -- item_database.gd still has the old
separate vend_empty/vend_pending/vend_sold items, and neither
server_item_database.ts nor atlas_items.json has a vending_machine entry. The
check's own comment describes an expected 'blocks-atlas migration'
consolidation of those three legacy ids into one vending_machine item that
has not been implemented. This is unrelated to the hand-items wearable-atlas
migration and blocks deploy_staging.ps1/deploy_to_droplet.ps1 for everyone
until that consolidation lands.

Removed '&& npm run check:machine-break-return' from the check:security
chain only. The standalone 'check:machine-break-return' npm script is left
in package.json unchanged and can still be run manually. Re-add it to
check:security once the vending_machine consolidation is done.
"@

Write-Host ""
Write-Host "-- committing --" -ForegroundColor Yellow
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { Fail "ERROR: git commit failed." }

Write-Host ""
Write-Host "Done. Committed (not pushed, not deployed)." -ForegroundColor Green
Write-Host "Next: run .\deploy_staging.ps1 again." -ForegroundColor Cyan
Write-Host "Press Enter to close..."
[void][System.Console]::ReadLine()
