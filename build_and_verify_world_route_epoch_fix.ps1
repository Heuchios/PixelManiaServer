<#
    PixelManiaServer - permanent fix for the "world permanently unjoinable" bug
    (client freezes at ~88% on the loading screen), 2026-08-06.

    The ownership epoch lives in two stores with different lifetimes:
        Redis    world_route_epoch:<world>   mints epochs, CAN be lost (TTL / flush / failover)
        Postgres worlds.world_owner_epoch    high-water mark, never cleared

    The Postgres claim only accepts an epoch strictly greater than the stored mark, so once
    the Redis counter is lost it restarts near 1 and the world can never be claimed again.
    TEST sat at 322 in Postgres vs 3 in Redis on 2026-08-05 and was unenterable.

    This change re-mints the route once using the Postgres mark as a FLOOR. Raising the
    counter only moves the fence forward, so fencing is not weakened.

    Files changed:
        src/redis_store.ts     optional minEpoch -> Lua raises the counter before INCR
        src/postgres_store.ts  new getWorldOwnerEpoch() (plain read, outside the write queue)
        src/server.ts          claimWorldRouteForCurrentInstance retries the claim ONCE
        scripts/check_world_route_epoch_recovery.js   new regression gate
        package.json           wires check:world-route-epoch into check:security

    Builds, runs the new gate, then runs the full release gate. Does NOT commit or deploy.

    Usage:
        cd G:\PixelMania\PixelManiaServer
        .\build_and_verify_world_route_epoch_fix.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer folder (package.json not found here)."
}

foreach ($file in @(
    "src\redis_store.ts",
    "src\postgres_store.ts",
    "src\server.ts",
    "scripts\check_world_route_epoch_recovery.js"
)) {
    if (-not (Test-Path $file)) { throw "Missing expected file: $file" }
}

Write-Host ""
Write-Host "=== 1/4  Building changed modules ===" -ForegroundColor Cyan
foreach ($target in @("build:redis-store", "build:postgres-store", "build:server-entry")) {
    Write-Host ("  -> npm run {0}" -f $target) -ForegroundColor DarkGray
    npm run $target
    if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run $target" }
}

Write-Host ""
Write-Host "=== 2/4  New epoch-recovery gate ===" -ForegroundColor Cyan
node scripts/check_world_route_epoch_recovery.js
if ($LASTEXITCODE -ne 0) { throw "FAILED: scripts/check_world_route_epoch_recovery.js" }

Write-Host ""
Write-Host "=== 3/4  Routing, ownership and item-loss gates ===" -ForegroundColor Cyan
foreach ($check in @(
    "check:redis-store",
    "check:postgres-store",
    "check:world-revision-persistence",
    "check:world-change-batching",
    "check:drop-pickup-item-loss",
    "check:server-entry"
)) {
    Write-Host ("  -> npm run {0}" -f $check) -ForegroundColor DarkGray
    npm run $check
    if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run $check" }
}

Write-Host ""
Write-Host "=== 4/4  Full release gate ===" -ForegroundColor Cyan
npm run check:security
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:security" }

Write-Host ""
Write-Host "All gates passed." -ForegroundColor Green
Write-Host ""
Write-Host "Commit source AND generated output, or deploy_to_droplet.ps1 will refuse:" -ForegroundColor Yellow
Write-Host "    git add src/redis_store.ts redis_store.js src/postgres_store.ts postgres_store.js src/server.ts server.js scripts/check_world_route_epoch_recovery.js package.json build_and_verify_world_route_epoch_fix.ps1"
Write-Host "    git commit -m ""fix(world-route): reseed the ownership epoch from PostgreSQL so a lost Redis counter cannot make a world permanently unjoinable"""
Write-Host ""
Write-Host "After deploying, confirm recovery is automatic:" -ForegroundColor Yellow
Write-Host "    ssh root@68.183.141.114"
Write-Host "    redis-cli del pixelmania:world_route_epoch:test    # simulate the loss"
Write-Host "    # then join TEST in game - it should enter normally, and the server log should show:"
Write-Host "    #   [world-route] ownership epoch reseeded from PostgreSQL { world: 'test', ... }"
