#!/usr/bin/env pwsh
# Commits the "blocks atlas migration" server-side changes in PixelManiaServer.
# Builds both touched modules first so a TypeScript error blocks the commit.
# Does NOT push or deploy.

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

Write-Host "`n== staging vending-machine consolidation files ==" -ForegroundColor Cyan
git add -- $files

Write-Host "`n== staged diff stat ==" -ForegroundColor Cyan
git diff --cached --stat

$commitMessage = @"
Consolidate vend_empty/vend_pending/vend_sold into a single vending_machine item

- VEND_BLOCK_TYPES keeps the legacy ids for detection, but VEND_BLOCK_TYPE
  ("vending_machine") is now the only id ever placed or broadcast
- syncVendVisualBlock() no longer mutates the placed block_type between
  states; the client resolves empty/full/sold/out_of_stock visuals from the
  synced vend_state payload (listing + pending_wls) instead
- server_item_database.ts: merged the three vend_* block definitions into
  one vending_machine entry with vending_*_atlas_coords fields; added a
  LEGACY_BLOCK_ITEM_ALIASES map so getItemDefinition() still resolves old
  persisted vend_empty/vend_pending/vend_sold ids to vending_machine
- SHOP_CATALOG, break-drop, and isVendableItem references updated
- world_lock/super_world_lock/big_lock/entrance_gate/fish_monger texture
  fields updated to atlas coordinates/regions into image.png, matching the
  client migration (informational only -- the server does not render)
"@

Write-Host "`n== creating commit ==" -ForegroundColor Cyan
git commit -m $commitMessage

Write-Host "`n== git log (last commit) ==" -ForegroundColor Cyan
git log -1 --stat

Write-Host "`nDone. This commit was NOT pushed or deployed." -ForegroundColor Yellow
