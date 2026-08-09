# Commits the fishing rod migration on the SERVER repo (PixelManiaServer).
# Run this from anywhere; the script cd's into the repo itself.
#
# What this migration does (server side):
#   - fishingRod()-based definitions for wooden_fishing_rod, bamboo_fishing_rod,
#     fiberglass_fishing_rod, platinum_rod, golden_fishing_rod.
#   - fishing_rod / platinum_prestige_rod kept as hidden legacy aliases
#     pointing at bamboo_fishing_rod / golden_fishing_rod.
#   - Removes the old rod tiers, their crafting-station upgrade recipes
#     (STATION_RECIPES.crafting_station), and updates isFishingRodItem().
#   - server.ts: updates the shop catalog rod entries and the separate
#     getCraftingCostItemIds() alias-repoint logic.
#   - neptune_rod left untouched.
#
# Source files touched:
#   src/server_item_database.ts
#   src/server.ts
#
# This script rebuilds the generated .js outputs from those .ts sources
# (server_item_database.js, server.js) via the project's own check scripts,
# which run the build step and then validate it. If either check fails,
# the script stops WITHOUT committing.

$ErrorActionPreference = "Stop"

Set-Location "G:\PixelMania\PixelManiaServer"

Write-Host "=== git status (before) ===" -ForegroundColor Cyan
git status

Write-Host ""
Write-Host "=== Rebuilding + validating item-data ===" -ForegroundColor Cyan
npm run check:item-data
if ($LASTEXITCODE -ne 0) {
    Write-Host "check:item-data FAILED. Not committing." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Rebuilding + validating server-entry ===" -ForegroundColor Cyan
npm run check:server-entry
if ($LASTEXITCODE -ne 0) {
    Write-Host "check:server-entry FAILED. Not committing." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== git status (after build) ===" -ForegroundColor Cyan
git status

Write-Host ""
Write-Host "=== git diff --stat ===" -ForegroundColor Cyan
git diff --stat -- src/server_item_database.ts src/server.ts server_item_database.js server.js

Write-Host ""
Write-Host "=== Full diff for review (scoped to touched files) ===" -ForegroundColor Cyan
git --no-pager diff -- src/server_item_database.ts src/server.ts server_item_database.js server.js

Write-Host ""
Write-Host "Review the diff above carefully." -ForegroundColor Yellow
Write-Host "Press Enter to continue and commit these files, or Ctrl+C to abort." -ForegroundColor Yellow
Read-Host

git add src/server_item_database.ts src/server.ts server_item_database.js server.js

Write-Host ""
Write-Host "=== git status (staged) ===" -ForegroundColor Cyan
git status

$commitMessage = @"
Migrate fishing rods to atlas-driven visuals, remove old rod tiers

- Add wooden_fishing_rod, bamboo_fishing_rod, fiberglass_fishing_rod,
  platinum_rod, golden_fishing_rod via fishingRod().
- Keep fishing_rod and platinum_prestige_rod as hidden legacy aliases
  pointing at bamboo_fishing_rod / golden_fishing_rod.
- Remove refined/pristine bamboo, fiberglass, and tungsten rod tiers.
- Remove their crafting-station upgrade recipes (STATION_RECIPES.crafting_station).
- Update isFishingRodItem()'s fallback comparison.
- server.ts: update shop catalog rod entries and getCraftingCostItemIds()
  alias-repoint logic to match.
- neptune_rod left untouched.
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
Write-Host "Next: run .\deploy_staging.ps1 to deploy to staging (NOT production)." -ForegroundColor Yellow
