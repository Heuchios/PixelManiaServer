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

Write-Host "== PixelManiaServer: fix beard_inventory being dropped from player state sync ==" -ForegroundColor Cyan
Write-Host "Repo path: $RepoPath"

Set-Location -Path $RepoPath

if (-not (Test-Path ".git")) {
    Fail "ERROR: '$RepoPath' does not look like a git repo (no .git folder). Run this script from inside PixelManiaServer, or pass -RepoPath."
}

if (-not (Test-Path "src/server_player_state_helpers.ts")) {
    Fail "ERROR: src/server_player_state_helpers.ts not found (are you in the right repo?)"
}

Write-Host ""
Write-Host "-- npm run build:server-player-state-helpers --" -ForegroundColor Yellow
npm run build:server-player-state-helpers
if ($LASTEXITCODE -ne 0) { Fail "ERROR: build:server-player-state-helpers failed. Fix the TypeScript error above before continuing." }

Write-Host ""
Write-Host "-- npm run build:server-entry (this compiles server.ts, ~1.4MB, may take a bit) --" -ForegroundColor Yellow
npm run build:server-entry
if ($LASTEXITCODE -ne 0) { Fail "ERROR: build:server-entry failed. Fix the TypeScript error above before continuing." }

Write-Host ""
Write-Host "-- npm run build:server-admin-lookup-routes --" -ForegroundColor Yellow
npm run build:server-admin-lookup-routes
if ($LASTEXITCODE -ne 0) { Fail "ERROR: build:server-admin-lookup-routes failed. Fix the TypeScript error above before continuing." }

$files = @(
    "src/server_player_state_helpers.ts",
    "server_player_state_helpers.js",
    "src/server.ts",
    "server.js",
    "src/server_admin_lookup_routes.ts",
    "server_admin_lookup_routes.js"
)

foreach ($f in $files) {
    if (-not (Test-Path $f)) {
        Fail "ERROR: expected file not found after build: $f"
    }
}

Write-Host ""
Write-Host "-- git status before --" -ForegroundColor Yellow
git status --short $files

Write-Host ""
Write-Host "-- diff (review before continuing -- server.ts is large, scroll to confirm only the expected 'beard' lines changed) --" -ForegroundColor Yellow
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
Fix beard_inventory being silently dropped from player state sync

Root cause: sanitizePlayerState() in server_player_state_helpers.ts (and its
near-duplicate ADMIN_INVENTORY_LOOKUP_FIELDS list in server.ts) whitelist which
inventory fields get read from / written to a player's state. "beard_inventory"
was never added to that whitelist when the beard equipment slot was created
client-side, even though CATEGORY_TO_FIELD in server_item_database.ts (fixed in
the previous commit) correctly resolves black_beard's category to that field
name. Net effect: /give black_beard would succeed (item exists, category
resolves, grant is staged), but the very next time the player's state passed
through sanitizePlayerState -- which happens on every load/save -- the
beard_inventory field was stripped because it wasn't in the recognized field
list. This is why the server reported "Item delivered by server." while the
item never actually reached the client's inventory.

Fixes, mirroring every place "eyewear" already appears in these three files:
- server_player_state_helpers.ts: INVENTORY_FIELDS, EQUIPMENT_STATE_FIELDS_BY_SLOT,
  EQUIPMENT_SLOT_COMPARISON_ORDER, ALLOWED_EQUIPMENT_SLOTS, the equippedSources
  loop and its default-state initializer, getEquipmentSlotsFromPlayerState(),
  and isCoreVisibleEquipmentSlot().
- server.ts: ADMIN_INVENTORY_LOOKUP_FIELDS (used by the admin inventory lookup
  tool), the two doesStateOwnEquippedItem()-based equipped_beard_item merge
  blocks in mergeClientPlayerStateIntoServerState(), and the equipped_beard_item
  line in the outgoing multiplayer equipment-slot broadcast payload.
- server_admin_lookup_routes.ts: added equipped_beard_item alongside
  equipped_eyewear_item in buildAdminInventoryLookupPlayerData(), so the admin
  inventory lookup tool also reflects a player's equipped beard.
"@

Write-Host ""
Write-Host "-- committing --" -ForegroundColor Yellow
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { Fail "ERROR: git commit failed." }

Write-Host ""
Write-Host "Done. Committed (not pushed, not deployed)." -ForegroundColor Green
Write-Host "Next: run .\deploy_to_droplet.ps1 to push, build-verify, and release to the droplet." -ForegroundColor Cyan
Write-Host "Press Enter to close..."
[void][System.Console]::ReadLine()
