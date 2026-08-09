<#
    PixelManiaServer - fix for "Snow Storm never appears automatically in game."

    Root cause: nothing in the gameplay code was broken. server.ts already has a fully
    working random-snow-storm scheduler:

        const SNOW_STORM_RANDOM_EVENTS_ENABLED = ["1","true","yes"].includes(
            String(process.env.SNOW_STORM_RANDOM_EVENTS_ENABLED || "false").trim().toLowerCase()
        );
        ...
        function startWorldEventRandomScheduler() {
            if (!SNOW_STORM_RANDOM_EVENTS_ENABLED || worldEventRandomTimer) return;
            worldEventRandomTimer = setInterval(() => {
                tryStartRandomSnowStormEvent()...
            }, SNOW_STORM_RANDOM_INTERVAL_MS);
        }

    ...and this IS called unconditionally on every server boot (server_phase11a_runtime.ts,
    bootstrapServer()). But SNOW_STORM_RANDOM_EVENTS_ENABLED defaults to "false" unless the
    env var is explicitly set, and ecosystem.config.js -- the file that sets every single
    env var PM2 actually launches the server with on staging/production -- never listed
    SNOW_STORM_RANDOM_EVENTS_ENABLED (or its interval/chance/etc siblings) at all, unlike
    every other configurable value in server.ts, which all have an explicit
    `env("X", "default")` entry there. So PM2 never set the var, the code's own "false"
    fallback always won, and the interval that rolls the dice for a random snow storm has
    never actually been running in any environment launched via this config -- that's why
    it's never appeared automatically, in staging or production.

    The event mechanics themselves (tile freezing/piling, client rendering, event_started/
    event_ended/event_tile_updates/event_system_message network messages, the client-side
    handlers in network_manager.gd -> world.gd) were all already correct and are unchanged
    by this fix -- confirmed by reading through them, and by the existing
    `/forceevent snow_storm` and `/event snow_storm start|end` developer commands, which
    already work today (those call startSnowStormEvent()/endSnowStormEvent() directly,
    bypassing the random scheduler entirely).

    The fix (ecosystem.config.js, end of the productionEnv object):
        SNOW_STORM_RANDOM_EVENTS_ENABLED: env("SNOW_STORM_RANDOM_EVENTS_ENABLED", "true"),
        SNOW_STORM_RANDOM_INTERVAL_MS: env("SNOW_STORM_RANDOM_INTERVAL_MS", "60000"),
        SNOW_STORM_RANDOM_CHANCE: env("SNOW_STORM_RANDOM_CHANCE", "0.05"),
        SNOW_STORM_PILE_OF_SNOW_CHANCE: env("SNOW_STORM_PILE_OF_SNOW_CHANCE", "0.08"),
        SNOW_STORM_EVENT_TILE_BATCH_SIZE: env("SNOW_STORM_EVENT_TILE_BATCH_SIZE", "250"),
        SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS: env("SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS", "0"),
        SNOW_STORM_MAX_CHANGED_TILES: env("SNOW_STORM_MAX_CHANGED_TILES", ""),
        SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS: env("SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS", "1000"),

    Every value except SNOW_STORM_RANDOM_EVENTS_ENABLED matches server.ts's own existing
    hardcoded fallback exactly -- this does not change any other behavior, it only turns
    the scheduler on. With the current defaults: every world with at least 1 player online
    gets an independent ~5% roll once a minute (skipped entirely for worlds that already
    have an active storm or a placed Snow Repellent block), so a populated world can expect
    a storm roughly every ~20 minutes on average, lasting 10 minutes each.

    This is a config-only change (ecosystem.config.js is plain JS PM2 reads directly --
    nothing to build/compile) and is a committed, tracked file (unlike .env, which is
    gitignored and per-machine), so it *will* reach staging/production through your normal
    deploy pipeline once committed and deployed -- same as any other src/ fix.

    Usage:
        cd G:\PixelMania\PixelManiaServer
        .\build_and_verify_snow_storm_event_fix.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer folder (package.json not found here)."
}

if (-not (Test-Path "ecosystem.config.js")) { throw "Missing expected file: ecosystem.config.js" }

Write-Host ""
Write-Host "=== 0/2  Confirming the fix is present in ecosystem.config.js ===" -ForegroundColor Cyan
$ecosystemSource = Get-Content "ecosystem.config.js" -Raw

$expectedFix = 'SNOW_STORM_RANDOM_EVENTS_ENABLED: env("SNOW_STORM_RANDOM_EVENTS_ENABLED", "true")'
if (-not $ecosystemSource.Contains($expectedFix)) {
    throw "ecosystem.config.js does not contain the enabled-by-default snow storm config -- did the write-back land?"
}
Write-Host "  Fix confirmed present." -ForegroundColor DarkGray

Write-Host ""
Write-Host "=== 1/2  Syntax-checking ecosystem.config.js ===" -ForegroundColor Cyan
node --check "ecosystem.config.js"
if ($LASTEXITCODE -ne 0) { throw "FAILED: node --check ecosystem.config.js" }
Write-Host "  Syntax OK." -ForegroundColor DarkGray

Write-Host ""
Write-Host "=== 2/2  Full release gate ===" -ForegroundColor Cyan
Write-Host "  NOTE: check:security currently also fails on check:tsconfig-projects due to an" -ForegroundColor DarkYellow
Write-Host "  UNRELATED, pre-existing, in-progress typed-import migration on this branch" -ForegroundColor DarkYellow
Write-Host "  (confirmed separately, multiple times -- not caused by this fix). If it fails only" -ForegroundColor DarkYellow
Write-Host "  on that gate, it is safe to proceed the same way you have for prior fixes." -ForegroundColor DarkYellow
npm run check:security
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:security (see NOTE above -- check whether this is the known tsconfig-projects gate)" }

Write-Host ""
Write-Host "All gates passed." -ForegroundColor Green
Write-Host ""
Write-Host "No TypeScript build needed -- ecosystem.config.js is plain JS, read directly by PM2." -ForegroundColor Yellow
Write-Host "Commit it:" -ForegroundColor Yellow
Write-Host "    git add ecosystem.config.js build_and_verify_snow_storm_event_fix.ps1"
Write-Host "    git commit -m ""fix(world-events): wire SNOW_STORM_RANDOM_EVENTS_ENABLED and friends into ecosystem.config.js so the random snow storm scheduler actually turns on in deployed environments"""
Write-Host ""
Write-Host "Then deploy the same way as before:" -ForegroundColor Yellow
Write-Host "    .\deploy_staging.ps1 -Fast"
Write-Host ""
Write-Host "How to verify:" -ForegroundColor Yellow
Write-Host "  Fast check (event pipeline, not the scheduler): join staging with a dev/admin" -ForegroundColor Yellow
Write-Host "  account and run '/forceevent snow_storm' -- this already worked before this fix" -ForegroundColor Yellow
Write-Host "  and confirms the event mechanics + client rendering are fine end to end." -ForegroundColor Yellow
Write-Host "  Real check (the actual fix): stay logged into a populated staging world and watch" -ForegroundColor Yellow
Write-Host "  for a storm to start on its own -- expect one roughly every ~20 minutes on average" -ForegroundColor Yellow
Write-Host "  per populated world (5% chance, rolled once a minute, skipped for worlds with an" -ForegroundColor Yellow
Write-Host "  active storm or a placed Snow Repellent block). To force it near-instantly for a" -ForegroundColor Yellow
Write-Host "  one-off local test without touching the committed defaults, run the server with:" -ForegroundColor Yellow
Write-Host "    `$env:SNOW_STORM_RANDOM_EVENTS_ENABLED='true'; `$env:SNOW_STORM_RANDOM_CHANCE='1'; `$env:SNOW_STORM_RANDOM_INTERVAL_MS='10000'; node server.js"
