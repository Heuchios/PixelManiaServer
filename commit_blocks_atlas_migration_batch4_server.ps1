#!/usr/bin/env pwsh
# Commits the fourth "blocks atlas migration" batch's SERVER-side changes in
# PixelManiaServer: 20 new furniture/decor items (blue_couch, green_couch,
# side_table, toilet/toilet_open, refrigerator/refrigerator_open,
# fireplace/fireplace_on, bathtub/bathtub_on, sink/sink_on,
# red_brick_platform, white_brick_block, white_brick_wall,
# white_brick_platform, fan, bed), a position fix for the pre-existing
# red_brick_wall, and the matching item-data build-gate fix.
#
# Runs check:item-data (build + the hardcoded-assertion gate script) first,
# so a TypeScript error OR a stale check-script assertion blocks the commit
# instead of shipping something deploy_staging.ps1 will just reject later.
# This script also stages ITSELF so it can't be left untracked and fail
# deploy_staging.ps1's clean-tree gate (the exact failure hit by
# commit_blocks_atlas_migration_batch3_checkfix_server.ps1 last time -- this
# script defensively re-stages that leftover file too, in case it is still
# sitting untracked from that earlier batch).
# Does NOT push or deploy.

$ErrorActionPreference = "Stop"
Set-Location "G:\PixelMania\PixelManiaServer"

function Fail($msg) {
    Write-Host $msg -ForegroundColor Red
    exit 1
}

Write-Host "== git status before staging ==" -ForegroundColor Cyan
git status --short

Write-Host "`n== check:item-data (build src/server_item_database.ts -> server_item_database.js, then run the item-data build-gate assertions) ==" -ForegroundColor Yellow
npm run check:item-data
if ($LASTEXITCODE -ne 0) { Fail "check:item-data failed -- not committing. Fix the error above first." }

$selfName = Split-Path -Leaf $PSCommandPath

$files = @(
    "src/server_item_database.ts",
    "server_item_database.js",
    "scripts/check_item_data_build.js",
    "commit_blocks_atlas_migration_batch3_checkfix_server.ps1",
    $selfName
)

Write-Host "`n== staging blocks-atlas-migration-batch4 files ==" -ForegroundColor Cyan
git add -- $files

Write-Host "`n== staged diff stat ==" -ForegroundColor Cyan
git diff --cached --stat

$commitMessage = @"
Add couches/toilet/fridge/fireplace/bathtub/sink/bricks/fan/bed (server)

20 new block() entries in ITEM_DEFINITIONS, plus a position fix for the
pre-existing red_brick_wall:

- red_brick_wall: atlas_coords/texture/inventory_icon moved from the old
  [17, 6] cell to [16, 23] per Hassan's new layout. atlas_item_id (44) and
  all drop_rules/rarity/block_health are unchanged.
- blue_couch / green_couch: seed field pointed at the pre-existing
  blue_couch_seed / green_couch_seed (grows_into already targeted these
  keys, they just didn't exist yet), rarity "uncommon", block_health 3,
  full drop_rules + tree_drop_rules matching the client and
  atlas_items.json exactly. No atlas_coords here (server does not render).
- side_table: plain non-collideable block, no seed.
- toilet/toilet_open, refrigerator/refrigerator_open, fireplace/
  fireplace_on, bathtub/bathtub_on, sink/sink_on: five punch-to-toggle
  pairs using the existing generic punch_toggle_block mechanism (same
  fields as the pre-existing tv/tv_active and death_gate/death_gate_active
  pairs -- punch_toggle_block: true, toggle_active_block,
  toggle_inactive_block, toggle_drop_block, block_health: 2 on both
  variants). With block_health 2, applyServerBlockDamage() in server.ts
  swaps the block type (no break) on the first punch and only breaks it
  on the second -- exactly "punch once to toggle, punch again to start
  breaking it", with zero new server logic. The *_open/*_on variants are
  hidden/non-placeable/non-dropable, matching the tv_active pattern.
- red_brick_platform, white_brick_platform: platform_collision: true
  (true walk-through/jump-up platform physics).
- white_brick_block: the one solid item in this batch --
  collidable: true, solid: true, collision_type: "full", block_health: 3.
- white_brick_wall: backgroundBlock() wallpaper item, matching
  red_brick_wall's shape.
- fan, bed: plain non-collideable blocks (fan has no server-side
  animation fields -- server does not render, matches the grass/fish_bowl
  precedent).

All 20 new entries deliberately omit texture/inventory_icon/atlas_coords/
animated/animation_frames -- the server does not render, per the
established convention (grass/fish_bowl/tv). Verified with an isolated
tsc --noEmit against tsconfig.item-data.json -- clean compile.

Also fixes scripts/check_item_data_build.js: brickBlockCases still
hardcoded red_brick_wall's OLD cell [17, 6] (would have failed the
item-data build gate with a coordinate mismatch, the same failure class
as the shift_block->shifty_block checkfix from the previous batch) --
updated to [16, 23]. Checked the rest of the file for coverage of the
other 17 new items; none exists, so no further check-script changes were
needed. The pre-existing couchBlockCases assertions for blue_couch/
green_couch already matched this implementation exactly and needed no
changes.
"@

Write-Host "`n== creating commit ==" -ForegroundColor Cyan
git commit -m $commitMessage

Write-Host "`n== git log (last commit) ==" -ForegroundColor Cyan
git log -1 --stat

Write-Host "`nDone. This commit was NOT pushed or deployed." -ForegroundColor Yellow
