#!/usr/bin/env pwsh
# Fixes the deploy_staging.ps1 failure from the batch-3 atlas migration:
# scripts/check_item_data_build.js (the item-data build gate) still hardcoded
# assertions against the OLD "shift_block" id. It doesn't go through
# LEGACY_BLOCK_ITEM_ALIASES like itemDatabase.getItemDefinition() does --
# atlasDb.getItemIdForKey() is a raw lookup straight off atlas_items.json's
# item_key, so once that JSON's id-57 entry was renamed to "shifty_block",
# looking it up by "shift_block" returned nothing (0 !== 57).
# Does NOT push or deploy.

$ErrorActionPreference = "Stop"
Set-Location "G:\PixelMania\PixelManiaServer"

Write-Host "== git status before staging ==" -ForegroundColor Cyan
git status --short

$files = @(
    "scripts/check_item_data_build.js"
)

Write-Host "`n== staging check_item_data_build.js fix ==" -ForegroundColor Cyan
git add -- $files

Write-Host "`n== staged diff ==" -ForegroundColor Cyan
git diff --cached

$commitMessage = @"
Fix item-data build-gate check for the shift_block -> shifty_block rename

check_item_data_build.js asserted against the item's OLD key directly:
- atlasDb.getItemIdForKey("shift_block") -- a raw lookup off
  Data/items/atlas_items.json's item_key field, which has no legacy-alias
  resolution (unlike itemDatabase.getItemDefinition(), which does resolve
  LEGACY_BLOCK_ITEM_ALIASES). Once that JSON's id-57 entry was renamed to
  "shifty_block" in the previous commit, this lookup returned nothing,
  failing with "0 !== 57".
- The fixedDrop() lookup for the block's own self-drop, which also keys
  on the literal string passed in, so it needed to look for
  "shifty_block" now that the drop_rules.fixed_drops entry itself carries
  that id.

Renamed the local variable/assertions to shifty_block throughout that
block and added one extra check confirming the OLD "shift_block" id still
resolves via getItemDefinition() (legacy-alias regression coverage,
matching the existing wooden_background check earlier in the same file).

Re-run npm run check:item-data (or deploy_staging.ps1) to confirm this
clears the build gate.
"@

Write-Host "`n== creating commit ==" -ForegroundColor Cyan
git commit -m $commitMessage

Write-Host "`n== git log (last commit) ==" -ForegroundColor Cyan
git log -1 --stat

Write-Host "`nDone. This commit was NOT pushed or deployed." -ForegroundColor Yellow
