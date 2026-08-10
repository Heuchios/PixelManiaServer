#!/usr/bin/env pwsh
# Commits the third "blocks atlas migration" batch's SERVER-side changes in
# PixelManiaServer. Builds the touched module first so a TypeScript error
# blocks the commit. Does NOT push or deploy.

$ErrorActionPreference = "Stop"
Set-Location "G:\PixelMania\PixelManiaServer"

function Fail($msg) {
    Write-Host $msg -ForegroundColor Red
    exit 1
}

Write-Host "== git status before staging ==" -ForegroundColor Cyan
git status --short

Write-Host "`n== build:item-data (src/server_item_database.ts -> server_item_database.js) ==" -ForegroundColor Yellow
npm run build:item-data
if ($LASTEXITCODE -ne 0) { Fail "Build failed (item-data) -- not committing. Fix the TypeScript error above first." }

$files = @(
    "src/server_item_database.ts",
    "server_item_database.js"
)

Write-Host "`n== staging blocks-atlas-migration-batch3 files ==" -ForegroundColor Cyan
git add -- $files

Write-Host "`n== staged diff stat ==" -ForegroundColor Cyan
git diff --cached --stat

$commitMessage = @"
Migrate wooden furniture, colour blocks, and colour wallpapers (server)

Server does not render, so no atlas_coords were needed here (shift_block/
now shifty_block already carried its atlas_item_id/atlas_coords/texture
fields from an earlier pass -- kept and renamed them for consistency, but
they aren't load-bearing for validation).

- LEGACY_BLOCK_ITEM_ALIASES gained 18 old->new mappings: the 6 renames
  (wooden_background/wooden_frame/dark_red_block/light_brown_block/
  gem_block/shift_block) and the 12 colour-background renames
  (white_bg/red_bg/green_bg/brown_bg/grey_bg/orange_bg/aqua_bg/
  purple_bg/black_bg/yellow_bg/blue_bg/pink_bg -> *_wallpaper).
- Renamed the corresponding block() entries, plus the matching
  TIER_1_SPLICE_BALANCE keys (wooden_background/wooden_frame/gem_block ->
  wooden_wallpaper/wooden_window/rainbow_block; applyTier1SpliceBalance()
  looks these up by dict key, so a missed rename here would have silently
  dropped grow-rate/drop-rule setup for the renamed block).
- maroon_block and dark_orange_block explicitly keep the OLD seed ids
  (dark_red_block_seed / light_brown_block_seed) via seededColourBlock's
  options.seed override, so client and server continue to agree on the
  seed item's id (only its grows_into target changes, resolved
  automatically by ensureSeedDefinitionsFromBlocks() since the seed id
  itself was never explicitly defined elsewhere). gem_block_seed (which
  WAS explicitly defined) had its grows_into repointed by hand to
  rainbow_block, since ensureSeedDefinitionsFromBlocks() only fills in a
  missing grows_into, not an already-set one.
- Added a new wooden_crappy_sign block() (non-collideable, sign_block,
  self-drops), matching the existing "sign" item's pattern -- Hassan's
  requested new item, not previously registered anywhere server-side.
- wooden_door/wooden_chair/wooden_table/wooden_block/wooden_fence/
  wooden_ladder/sand_castle/pile_of_sand and the 28 non-renamed colour
  blocks already existed server-side and needed no changes.
- Grepped the full server.ts for all 18 renamed ids -- zero hits, unlike
  the vines/tulip/ice_block_2 batch, so no world-gen/event-logic edits
  were needed there this time.

Verified with an isolated tsc --noEmit against tsconfig.item-data.json
(the same 3-file project this repo's build:item-data script type-checks)
-- clean compile.
"@

Write-Host "`n== creating commit ==" -ForegroundColor Cyan
git commit -m $commitMessage

Write-Host "`n== git log (last commit) ==" -ForegroundColor Cyan
git log -1 --stat

Write-Host "`nDone. This commit was NOT pushed or deployed." -ForegroundColor Yellow
