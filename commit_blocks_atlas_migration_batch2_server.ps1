#!/usr/bin/env pwsh
# Commits the second "blocks atlas migration" batch's SERVER-side changes in
# PixelManiaServer. Builds the touched modules first so a TypeScript error
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

Write-Host "`n== build:server-entry (src/server.ts -> server.js) ==" -ForegroundColor Yellow
npm run build:server-entry
if ($LASTEXITCODE -ne 0) { Fail "Build failed (server-entry) -- not committing. Fix the TypeScript error above first." }

$files = @(
    "src/server.ts",
    "src/server_item_database.ts",
    "server.js",
    "server_item_database.js"
)

Write-Host "`n== staging blocks-atlas-migration-batch2 files ==" -ForegroundColor Cyan
git add -- $files

Write-Host "`n== staged diff stat ==" -ForegroundColor Cyan
git diff --cached --stat

$commitMessage = @"
Rename vines/ice_block_2/tulip and add wooden_treasure_chest (server)

- LEGACY_BLOCK_ITEM_ALIASES gained vines -> hanging_vine,
  ice_block_2 -> ice_treasure, tulip -> sunflower so any already-persisted
  world block or inventory entry using the old id still resolves via
  getItemDefinition()/normalizeLegacyItemId().
- Renamed the block() definitions and SPLICE_BALANCE-style grow-rate table
  entries to match: hanging_vine, ice_treasure (display name fixed to
  "Ice Treasure"), sunflower.
- tulip_seed / vines_seed keep their existing ids; only grows_into was
  repointed to sunflower / hanging_vine respectively.
- sun_flower (the old, unrelated item with its own seed/recipe chain) is
  now hidden: true -- retired from new acquisition, not deleted, so
  anything already holding/placed as sun_flower keeps working.
- Added wooden_treasure_chest (placeable, drops itself) and hidden
  wooden_treasure_chest_open (reserved for a future open/close
  interaction -- no interaction logic wired yet), matching the
  wooden_chair/wooden_table decorative-placeable pattern.
- server.ts: serverGenerateSurfaceDecorations's "tulip" decoration pick and
  serverCreateTree's ground-type whitelist now use "sunflower";
  getSnowStormIceEventBlock now returns "ice_treasure" instead of
  "ice_block_2", matching the client's get_snow_storm_ice_block_type().
- Atlas coordinates themselves are client-only (informational) -- the
  server does not render, so no atlas_coords fields were added here.
"@

Write-Host "`n== creating commit ==" -ForegroundColor Cyan
git commit -m $commitMessage

Write-Host "`n== git log (last commit) ==" -ForegroundColor Cyan
git log -1 --stat

Write-Host "`nDone. This commit was NOT pushed or deployed." -ForegroundColor Yellow
