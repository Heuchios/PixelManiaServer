<#
    PixelManiaServer - fix for "Tracked item data is missing for vending_machine."
    on every vending machine break.

    Root cause: placing an instance-tracked block (vending_machine is
    instance_tracked: true in src/server_item_database.ts) spends it from the
    player's inventory via the generic ledger label source="world_block_place",
    action="world_block_place". getItemInstanceLedgerDestination() in
    src/postgres_store.ts does not recognize that label as vending/safe/
    donation_box/display/etc, so it falls through to its default bucket:
        { state: ITEM_INSTANCE_RETIRED_STATE, location: "unknown" }
    i.e. the vending machine's own tracked item_instance row is stored RETIRED
    at location "unknown" the moment it's placed.

    When the machine is later broken, prepareVendBreakInventoryReturn() credits
    it back with reason "vending_machine_break_recovery". Inside
    syncItemInstancesForLedger(), that sets isMachineRecovery = true and builds a
    release plan at location "unknown" -- but the releaseStates search (just above
    the "FOR UPDATE" query) only searched for state = 'locked' unless
    metadata_action === "world_block_place", and machine recovery deliberately
    sets metadata_action to "" (not "world_block_place"). So the release query
    never found the RETIRED_STATE row the placement had created, always returned
    reason: "insufficient_locked_item_instances", and getPostgresInventoryFailureMessage()
    (src/server_inventory_transaction_helpers.ts) turned that into the player-visible
    "Tracked item data is missing for vending_machine." on every single break attempt.

    location = "unknown" is ONLY ever produced by the machine-recovery release plan
    (every other release plan uses "vending"/"safe"/"donation_box"/"display"), so
    widening the releaseStates check to also match on plan.location === "unknown" is
    safe and precisely targeted -- it does not affect safe/donation_box/display/vending
    listing recovery at all.

    Fix (src/postgres_store.ts, inside syncItemInstancesForLedger's release-plan loop):
        const releaseStates =
            plan.metadata_action === "world_block_place" || plan.location === "unknown"
              ? ["locked", ITEM_INSTANCE_RETIRED_STATE]
              : ["locked"];

    No DB backfill needed. Existing vending machines already placed (and currently
    stuck with this error on break) self-heal on their next break attempt -- the wider
    state search finds their existing RETIRED_STATE/"unknown" row and releases it back
    to active/inventory normally.

    The src/postgres_store.ts edit has ALREADY been written back to your machine by
    Claude. This script builds it and runs the relevant release gates.

    Usage:
        cd G:\PixelMania\PixelManiaServer
        .\build_and_verify_vending_machine_break_recovery_fix.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer folder (package.json not found here)."
}

if (-not (Test-Path "src\postgres_store.ts")) { throw "Missing expected file: src\postgres_store.ts" }

Write-Host ""
Write-Host "=== 0/3  Confirming the fix is present in src\postgres_store.ts ===" -ForegroundColor Cyan
$storeSource = Get-Content "src\postgres_store.ts" -Raw

$expectedFix = 'plan.metadata_action === "world_block_place" || plan.location === "unknown"'
if (-not $storeSource.Contains($expectedFix)) {
    throw "src\postgres_store.ts does not contain the widened releaseStates check -- did the write-back land?"
}
Write-Host "  Fix confirmed present." -ForegroundColor DarkGray

Write-Host ""
Write-Host "=== 1/3  Building postgres-store ===" -ForegroundColor Cyan
npm run build:postgres-store
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run build:postgres-store" }

Write-Host ""
Write-Host "=== 2/3  Item-instance and persistence gates ===" -ForegroundColor Cyan
foreach ($check in @(
    "check:postgres-store",
    "check:world-revision-persistence",
    "check:drop-pickup-item-loss",
    "check:inventory-contracts"
)) {
    Write-Host ("  -> npm run {0}" -f $check) -ForegroundColor DarkGray
    npm run $check
    if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run $check" }
}

Write-Host ""
Write-Host "=== 3/3  Full release gate ===" -ForegroundColor Cyan
Write-Host "  NOTE: check:security currently also fails on check:tsconfig-projects due to an" -ForegroundColor DarkYellow
Write-Host "  UNRELATED, pre-existing, in-progress typed-import migration on this branch" -ForegroundColor DarkYellow
Write-Host "  (confirmed separately -- not caused by this fix). If it fails only on that gate," -ForegroundColor DarkYellow
Write-Host "  it is safe to proceed the same way you did for the world-route fix." -ForegroundColor DarkYellow
npm run check:security
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:security (see NOTE above -- check whether this is the known tsconfig-projects gate)" }

Write-Host ""
Write-Host "All gates passed." -ForegroundColor Green
Write-Host ""
Write-Host "Commit source AND generated output, or deploy_to_droplet.ps1 will refuse:" -ForegroundColor Yellow
Write-Host "    git add src/postgres_store.ts postgres_store.js build_and_verify_vending_machine_break_recovery_fix.ps1"
Write-Host "    git commit -m ""fix(inventory): vending machine break-return now finds its own retired item_instance so breaking no longer fails with 'Tracked item data is missing'"""
Write-Host ""
Write-Host "Then deploy the same way as before:" -ForegroundColor Yellow
Write-Host "    .\deploy_staging.ps1 -Fast"
Write-Host ""
Write-Host "To verify in-game: break a placed vending machine on staging. It should return to" -ForegroundColor Yellow
Write-Host "your inventory with no error. This self-heals for machines placed before this fix --" -ForegroundColor Yellow
Write-Host "no manual DB cleanup needed." -ForegroundColor Yellow
