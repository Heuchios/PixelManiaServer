# Commits + verifies the SERVER half of the leaderboard block (PixelManiaServer).
#
# WHY THE SERVER NEEDS THIS AT ALL: the leaderboard panel is client-only (it reuses the
# existing landfill_leaderboard_request), but the server must still know the `leaderboard`
# BLOCK ID exists, for placement validation and drop handling -- and, critically, for
# COLLISION PARITY.
#
# The collision part is not cosmetic. isSolidMovementCollisionBlock() defaults collision_type
# to "full", so a server definition that merely omits the flags is SOLID. With the client
# walking through the block and the server refusing the movement, acceptPlayerMovement rejects
# with movement_blocked -> correction_snap -> the client hard-snaps back every frame. In game
# that reads as being physically TRAPPED by the block, not as a collision bug -- and there are
# no collision shapes to find when you go looking. scripts/check_item_database_sync.js asserts
# this parity and will fail the build gate if it drifts.
#
# What changed: one new `leaderboard: block({...})` entry in src/server_item_database.ts with
# no_collision/collidable/solid/collision_type matching the client's Scripts/item_database.gd.
#
# NOTE: src/server_item_database.ts is a CRLF file. It was edited with raw byte operations to
# preserve that exactly -- verify the diff is ~1 added hunk, NOT a whole-file rewrite. If git
# shows the entire file as changed, the line endings were normalized; do not commit that.
#
# Files touched:
#   src/server_item_database.ts

$ErrorActionPreference = "Stop"
Set-Location "G:\PixelMania\PixelManiaServer"

$files = @("src/server_item_database.ts")

Write-Host "=== git status (before) ===" -ForegroundColor Cyan
git status

Write-Host ""
Write-Host "=== git diff --stat (expect a SMALL hunk, not the whole file) ===" -ForegroundColor Cyan
git diff --stat -- $files

Write-Host ""
Write-Host "=== Full diff for review ===" -ForegroundColor Cyan
git --no-pager diff -- $files

Write-Host ""
Write-Host "=== Build + gate: item data ===" -ForegroundColor Cyan
# check:item-data is "npm run build:item-data && node scripts/check_item_data_build.js",
# so this compiles src/server_item_database.ts (tsc + sync_item_data_build.js) AND runs the
# build-gate assertions in one step. There is no separate build command to run first.
npm run check:item-data
if ($LASTEXITCODE -ne 0) { Write-Host "check:item-data FAILED - not committing." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=== Gate: client/server collision parity ===" -ForegroundColor Cyan
# check_item_database_sync.js is the one that fails if a client non-collidable block is solid
# server-side -- i.e. the exact trap this change has to avoid.
npm run check:item-db
if ($LASTEXITCODE -ne 0) { Write-Host "check:item-db FAILED - not committing." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "All build gates passed." -ForegroundColor Green
Write-Host "Review the diff above carefully." -ForegroundColor Yellow
Write-Host "Press Enter to continue and commit, or Ctrl+C to abort." -ForegroundColor Yellow
Read-Host

git add -- $files commit_leaderboard_server.ps1

Write-Host ""
Write-Host "=== git status (staged) ===" -ForegroundColor Cyan
git status

$commitMessage = @"
feat(items): add the leaderboard block definition

Server-side counterpart to the client's new walk-through `leaderboard`
block. The server does not render or serve the panel (that reuses the
existing landfill_leaderboard_request), but it must know the block id
for placement validation and drops.

no_collision / collidable / solid / collision_type mirror the client's
Scripts/item_database.gd entry exactly. isSolidMovementCollisionBlock
defaults collision_type to "full", so omitting them would make the
block solid server-side while the client walks through it -- the
player is then hard-snapped back every frame and reads as physically
trapped. check_item_database_sync.js asserts this parity.
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
Write-Host ""
Write-Host "NEXT: deploy to staging (deploy_staging.ps1) before placing this block in a live" -ForegroundColor Yellow
Write-Host "world. Until the server has this definition, the block is SOLID server-side and" -ForegroundColor Yellow
Write-Host "will trap players who walk into it." -ForegroundColor Yellow
