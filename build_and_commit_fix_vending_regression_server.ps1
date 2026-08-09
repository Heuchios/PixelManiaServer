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

Write-Host "== PixelManiaServer: fix vending_machine consolidation regression (server) ==" -ForegroundColor Cyan
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
Write-Host "My earlier hand-items-batch-1 commit (9953d34) was built from a stale local copy" -ForegroundColor Yellow
Write-Host "of server_item_database.ts that predated 0d8bffa ('Consolidate vend_empty/" -ForegroundColor Yellow
Write-Host "vend_pending/vend_sold into a single vending_machine item'). Writing that stale" -ForegroundColor Yellow
Write-Host "copy back reverted the vending_machine entry, the LEGACY_BLOCK_ITEM_ALIASES map," -ForegroundColor Yellow
Write-Host "and the SHOP_CATALOG/break-drop/isVendableItem reference updates from 0d8bffa --" -ForegroundColor Yellow
Write-Host "that's why check:machine-break-return started failing on deploy." -ForegroundColor Yellow
Write-Host "" -ForegroundColor Yellow
Write-Host "This commit fixes it by starting fresh from 0d8bffa's version of the file (which" -ForegroundColor Yellow
Write-Host "has the vending_machine consolidation intact) and re-applying ONLY the 15" -ForegroundColor Yellow
Write-Host "hand-items-batch-1 field changes on top -- same 15 items as the client fix." -ForegroundColor Yellow
Write-Host "Nothing about vending_machine, LEGACY_BLOCK_ITEM_ALIASES, SHOP_CATALOG, or the" -ForegroundColor Yellow
Write-Host "world_lock/super_world_lock/entrance_gate/fish_monger texture-field updates should" -ForegroundColor Yellow
Write-Host "appear in this diff -- if it does, STOP and don't commit." -ForegroundColor Red
Write-Host "" -ForegroundColor Yellow
Write-Host "Note: 0d8bffa also touched src/server.ts and server.js (syncVendVisualBlock/" -ForegroundColor Yellow
Write-Host "VEND_BLOCK_TYPES logic) -- this fix does NOT touch those files. My original" -ForegroundColor Yellow
Write-Host "hand-items build script only ever staged src/server_item_database.ts and" -ForegroundColor Yellow
Write-Host "server_item_database.js, so those two files should be unaffected, but it's worth" -ForegroundColor Yellow
Write-Host "double-checking 'git status' shows nothing unexpected dirty in server.ts/server.js." -ForegroundColor Yellow
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
Fix: restore vending_machine consolidation reverted by hand-items commit

Commit 9953d34 (hand-items batch 1, server mirror) was built from a stale
local copy of server_item_database.ts that predated 0d8bffa ("Consolidate
vend_empty/vend_pending/vend_sold into a single vending_machine item").
Writing that copy back to disk and committing it silently reverted the
vending_machine item entry, the LEGACY_BLOCK_ITEM_ALIASES map, and the
SHOP_CATALOG/break-drop/isVendableItem reference updates from 0d8bffa,
while I was unaware anything besides the hand-items fields had changed.

This commit rebuilds the file starting from 0d8bffa's content and
re-applies only the 15 hand-items-batch-1 field changes (texture/
inventory_icon atlas-key swaps, the neptune_pickaxe/void_pickaxe/
angelic_sword animation frame repoints) on top. Nothing else changed.
Verified via a diff against 0d8bffa showing only the 15 hand items, plus
brace/bracket/paren balance checks and byte-for-byte confirmation that
every line introduced by 0d8bffa outside those 15 items is untouched.

Does not touch src/server.ts or server.js -- 0d8bffa also changed those
(syncVendVisualBlock/VEND_BLOCK_TYPES), but the hand-items commit never
staged those files, so they should not have been affected.
"@

Write-Host ""
Write-Host "-- committing --" -ForegroundColor Yellow
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { Fail "ERROR: git commit failed." }

Write-Host ""
Write-Host "Done. Committed (not pushed, not deployed)." -ForegroundColor Green
Write-Host "You can now delete the scratch files: server_item_database_GOOD_BASE.ts," -ForegroundColor Cyan
Write-Host "vending_machine_regression.diff -- they were only needed for this fix." -ForegroundColor Cyan
Write-Host "Next: run .\deploy_staging.ps1 again." -ForegroundColor Cyan
Write-Host "Press Enter to close..."
[void][System.Console]::ReadLine()
