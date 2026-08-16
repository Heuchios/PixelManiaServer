<#
    PixelManiaServer - block/display latency investigation fixes (2026-08-15)

    Two changes:
      1. src\server.ts: enforceMessageIdempotency no longer does a synchronous Postgres
         transaction (claimIdempotency) for the hottest gameplay scopes (world_block_update,
         world_seed_update, world_interaction_update, world_item_drop_*/world_drop_*). Those
         now use an in-memory per-process claim table instead, removing one DB round trip from
         the critical path of every block break/place/hit message. Trade/purchase scopes are
         unchanged (still Postgres-backed).
      2. src\server.ts: handleDisplayDeposit / handleDisplayWithdraw now broadcast the new
         display state to the world immediately after the authoritative in-memory mutation,
         instead of after awaiting the Postgres inventory-delta commit. If that commit later
         fails, a corrective broadcast restores the original display state.
      3. src\server.ts and src\server_phase8_world_action_routes.ts: added temporary
         [BLOCK_PLACE_PROFILE] / [BLOCK_BREAK_PROFILE] / [DISPLAY_PROFILE] timing logs (off by
         default -- set BLOCK_ACTION_PROFILE_LOGS=1 in the environment to enable) covering
         request_received / validation_complete / world_mutation_complete / broadcast_sent /
         persistence_queued / database_completed.

    Builds both changed files, runs the security/release gate, then prints the git commands.
    Does NOT commit or deploy -- review the diff first.

    Usage:
        cd G:\PixelMania\PixelManiaServer
        .\build_and_verify_block_action_latency_fix.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer folder (package.json not found here)."
}

$required = @(
    "src\server.ts",
    "src\server_phase8_world_action_routes.ts"
)
foreach ($file in $required) {
    if (-not (Test-Path $file)) { throw "Missing expected file: $file" }
}

Write-Host ""
Write-Host "=== 1/4  Building server.ts (server-entry) ===" -ForegroundColor Cyan
npm run build:server-entry
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run build:server-entry" }

Write-Host ""
Write-Host "=== 2/4  Building server_phase8_world_action_routes.ts ===" -ForegroundColor Cyan
npm run build:server-phase8-world-action-routes
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run build:server-phase8-world-action-routes" }

Write-Host ""
Write-Host "=== 3/4  Targeted gates (idempotency, world journal, rollback, anti-dupe, drop item-loss) ===" -ForegroundColor Cyan
foreach ($check in @("check:world-journal", "check:rollback", "check:anti-dupe", "check:drop-pickup-item-loss", "check:server-validation")) {
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
Write-Host "Files to commit (source AND generated output, or deploy_to_droplet.ps1 will refuse):" -ForegroundColor Yellow
Write-Host "    git add src/server.ts server.js src/server_phase8_world_action_routes.ts server_phase8_world_action_routes.js"
Write-Host "    git commit -m ""perf(server): remove idempotency DB round trip from hot path, broadcast display box before persisting, add block/display timing instrumentation"""
Write-Host ""
Write-Host "Then review the diff before deploying:" -ForegroundColor Yellow
Write-Host "    git diff HEAD~1 --stat"
Write-Host ""
Write-Host "To see the new per-stage timing breakdown on staging, set this before starting the server:" -ForegroundColor Yellow
Write-Host "    `$env:BLOCK_ACTION_PROFILE_LOGS = ""1"""
Write-Host "It logs to the normal server output/log files; unset it (or leave it out) for production."
