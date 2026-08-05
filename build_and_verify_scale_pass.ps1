<#
    PixelManiaServer - scale/latency pass (2026-08-05), Phases 1-4a

    Builds every src/*.ts touched by the pass, then runs the full release gate.
    Run this from the PixelManiaServer folder. It does NOT commit or deploy --
    review the diff yourself first, then commit.

    Usage:
        cd G:\PixelMania\PixelManiaServer
        .\build_and_verify_scale_pass.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer folder (package.json not found here)."
}

# Every file changed by the pass, with the npm target that regenerates its root .js.
# Order matters only in that server-entry is the slowest, so it goes last.
$targets = @(
    @{ Src = "src\server_runtime_stats.ts";              Build = "build:server-runtime-stats" },
    @{ Src = "src\postgres_store.ts";                   Build = "build:postgres-store" },
    @{ Src = "src\redis_store.ts";                       Build = "build:redis-store" },
    @{ Src = "src\server_account_session_helpers.ts";    Build = "build:server-account-session-helpers" },
    @{ Src = "src\server_account_auth_routes.ts";        Build = "build:server-account-auth-routes" },
    @{ Src = "src\server_phase8_final_routes.ts";        Build = "build:server-phase8-final-routes" },
    @{ Src = "src\server_phase11b_lifecycle.ts";         Build = "build:server-phase11b-lifecycle" },
    @{ Src = "src\server_phase11c_trusted_movement.ts";  Build = "build:server-phase11c-trusted-movement" },
    @{ Src = "src\server.ts";                            Build = "build:server-entry" }
)

foreach ($t in $targets) {
    if (-not (Test-Path $t.Src)) { throw "Missing expected source file: $($t.Src)" }
}

Write-Host ""
Write-Host "=== Building changed modules ===" -ForegroundColor Cyan
foreach ($t in $targets) {
    Write-Host ("  -> {0}" -f $t.Build) -ForegroundColor DarkGray
    npm run $t.Build
    if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run $($t.Build)" }
}

Write-Host ""
Write-Host "=== Release gate (check:security) ===" -ForegroundColor Cyan
Write-Host "This runs the full typecheck chain plus every wiring check. Takes a few minutes." -ForegroundColor DarkGray
npm run check:security
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:security" }

Write-Host ""
Write-Host "=== Working tree ===" -ForegroundColor Cyan
git status --short

Write-Host ""
Write-Host "All builds and checks passed." -ForegroundColor Green
Write-Host ""
Write-Host "Both the sources AND the generated root .js files must be committed together," -ForegroundColor Yellow
Write-Host "or deploy_to_droplet.ps1's rebuild-and-diff check will fail. Suggested:" -ForegroundColor Yellow
Write-Host ""
Write-Host '  git add src/server.ts src/redis_store.ts src/server_runtime_stats.ts `' -ForegroundColor Gray
Write-Host '          src/server_account_session_helpers.ts src/server_account_auth_routes.ts `' -ForegroundColor Gray
Write-Host '          src/server_phase8_final_routes.ts src/server_phase11b_lifecycle.ts `' -ForegroundColor Gray
Write-Host '          src/server_phase11c_trusted_movement.ts src/postgres_store.ts `' -ForegroundColor Gray
Write-Host '          server.js redis_store.js server_runtime_stats.js `' -ForegroundColor Gray
Write-Host '          server_account_session_helpers.js server_account_auth_routes.js `' -ForegroundColor Gray
Write-Host '          server_phase8_final_routes.js server_phase11b_lifecycle.js `' -ForegroundColor Gray
Write-Host '          server_phase11c_trusted_movement.js postgres_store.js' -ForegroundColor Gray
Write-Host '  git commit -m "perf: cut redundant per-action CPU and unbounded growth for 500-player scale"' -ForegroundColor Gray
Write-Host ""
Write-Host "New env kill switches (all default to the NEW behaviour):" -ForegroundColor Cyan
Write-Host "  PHASE7_ACTION_LOGS=1                        restore per-block-action logging" -ForegroundColor Gray
Write-Host "  WORLD_STATE_REFRESH_TRACE=1                 restore per-mutation world-persistence logging" -ForegroundColor Gray
Write-Host "  APPEARANCE_DEBUG_LOGS=1                     restore [APPEARANCE] logs" -ForegroundColor Gray
Write-Host "  PLAYER_STATE_DISCONNECT_EVICTION_ENABLED=0  keep playerStates cached forever (old leak behaviour)" -ForegroundColor Gray
Write-Host "  SERVER_GENERATED_TERRAIN_CACHE_MAX_WORLDS=N bound the generated-terrain cache (default 128)" -ForegroundColor Gray
Write-Host ""
Write-Host "Phase 4a also fixes a live trade bug -- please test a trade where the REQUESTER" -ForegroundColor Yellow
Write-Host "offers two or more different item stacks. That case previously aborted its" -ForegroundColor Yellow
Write-Host "transaction on a duplicate-key error and could not commit." -ForegroundColor Yellow
Write-Host ""
Write-Host "After deploying, watch these two existing metrics -- both should drop:" -ForegroundColor Cyan
Write-Host "  event_loop_lag_ms   and   inbound_message_queue_wait_max_ms" -ForegroundColor Gray
Write-Host ""
