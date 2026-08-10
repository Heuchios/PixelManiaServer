<#
    PixelManiaServer - diagnostic instrumentation for the intermittent fishing-cast delay

    This is NOT a behavior fix. It adds timing/logging so the next time a player sees the
    "sometimes casting has a delay" symptom, we can see WHY from the server logs instead of
    guessing. It changes nothing about how fast writes actually run.

    Background (why this exists): fishing_start's own Postgres write is small (it only
    deducts one lure -- confirmed by reading handleFishingStartTransaction /
    commitPlayerInventoryState, no world-state save is attached to it). But EVERY write on
    this server -- fishing casts, trades, world saves, block placements, all players --
    funnels through one single global FIFO queue with effective concurrency 1
    (PostgresStore.enqueueWrite chains every write onto one promise). A world-save
    transaction elsewhere in that same queue can run 100-600 statements while holding an
    exclusive lock (see [[server-write-path]] memory). So a fishing cast's own write can be
    fast, but still show up late to the player if it lands behind a big transaction in the
    shared queue. That's the leading theory for bug #4 -- this change lets us prove or
    disprove it with real numbers instead of leaving it as a guess.

    What changed:
      * src/postgres_store.ts
          - enqueueWrite() now records queue_wait_ms (time spent waiting for its turn in the
            FIFO) and exec_ms (time actually running) separately, and logs both via
            this.logger(...) whenever their sum crosses `slowWriteLogThresholdMs` (new
            constructor option, default 250ms, 0 disables).
          - withTransaction() now accepts an optional `label` (default stays "transaction",
            so none of the ~44 other call sites change behavior).
          - applyInventoryDeltaTransaction()'s withTransaction call now passes the real
            `action` string as that label (e.g. "fishing_start", "trade_finalize", etc), so
            the slow-write log line is actually attributable instead of every transaction
            saying "transaction" (a known gap called out in the write-path audit).
      * src/server.ts
          - new POSTGRES_SLOW_WRITE_LOG_MS env-driven constant (default 250), wired into the
            PostgresStore constructor as slowWriteLogThresholdMs.
      * ecosystem.config.js
          - POSTGRES_SLOW_WRITE_LOG_MS: env("POSTGRES_SLOW_WRITE_LOG_MS", "250") added to the
            shared productionEnv object (covers both staging and production, same as every
            other POSTGRES_* var here).

    How to read it once deployed:
        Watch (or grep) the PM2 log for lines like:
            [postgres] slow write: label=fishing_start queue_wait_ms=612 exec_ms=9 queue_depth_at_enqueue=4
        - High queue_wait_ms, low exec_ms  -> confirms the shared-queue-contention theory;
          the fishing write itself is fast, it's waiting behind other work.
        - High exec_ms                     -> the transaction itself is slow (would be a
          different, new finding -- fishing_start shouldn't normally look like this).
        - queue_depth_at_enqueue tells you how many other writes were already queued ahead
          of it at the moment it was scheduled.
        Lower POSTGRES_SLOW_WRITE_LOG_MS temporarily (e.g. to 50) via ecosystem.config.js +
        redeploy if you want to catch smaller delays too; raise it or set it to "0" to go
        quiet again once you have enough data. Either way is just a redeploy, no code change.

    Builds src\server.ts and src\postgres_store.ts, then runs the full release gate. Does
    NOT commit or deploy -- review the diff first.

    Usage:
        cd G:\PixelMania\PixelManiaServer
        .\build_and_verify_fishing_delay_instrumentation.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer folder (package.json not found here)."
}

$required = @(
    "src\server.ts",
    "src\postgres_store.ts",
    "ecosystem.config.js"
)
foreach ($file in $required) {
    if (-not (Test-Path $file)) { throw "Missing expected file: $file" }
}

Write-Host ""
Write-Host "=== 0/5  Confirming the fix is present ===" -ForegroundColor Cyan

$postgresSource = Get-Content "src\postgres_store.ts" -Raw
if (-not $postgresSource.Contains("slowWriteLogThresholdMs")) {
    throw "src\postgres_store.ts does not contain slowWriteLogThresholdMs -- did the write-back land?"
}
if (-not $postgresSource.Contains("queue_wait_ms=")) {
    throw "src\postgres_store.ts does not contain the slow-write log line -- did the write-back land?"
}
if ($postgresSource -notmatch 'withTransaction<T>\(work: TransactionWork<T>, label: string = "transaction"\)') {
    throw "src\postgres_store.ts withTransaction() does not have the optional label parameter -- did the write-back land?"
}

$serverSource = Get-Content "src\server.ts" -Raw
if (-not $serverSource.Contains("POSTGRES_SLOW_WRITE_LOG_MS")) {
    throw "src\server.ts does not contain POSTGRES_SLOW_WRITE_LOG_MS -- did the write-back land?"
}

$ecosystemSource = Get-Content "ecosystem.config.js" -Raw
if (-not $ecosystemSource.Contains('POSTGRES_SLOW_WRITE_LOG_MS: env("POSTGRES_SLOW_WRITE_LOG_MS", "250")')) {
    throw "ecosystem.config.js does not contain the POSTGRES_SLOW_WRITE_LOG_MS entry -- did the write-back land?"
}
Write-Host "  All three fixes confirmed present." -ForegroundColor DarkGray

Write-Host ""
Write-Host "=== 1/5  Syntax-checking ecosystem.config.js ===" -ForegroundColor Cyan
node --check "ecosystem.config.js"
if ($LASTEXITCODE -ne 0) { throw "FAILED: node --check ecosystem.config.js" }
Write-Host "  Syntax OK." -ForegroundColor DarkGray

Write-Host ""
Write-Host "=== 2/5  Building postgres_store ===" -ForegroundColor Cyan
npm run check:postgres-store
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:postgres-store" }

Write-Host ""
Write-Host "=== 3/5  Building server entry ===" -ForegroundColor Cyan
npm run check:server-entry
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:server-entry" }

Write-Host ""
Write-Host "=== 4/5  Item-loss and world-revision gates ===" -ForegroundColor Cyan
# withTransaction's signature changed (new optional param) and applyInventoryDeltaTransaction's
# call site changed -- these are the gates that would catch a regression in how transactions
# commit, not just whether they compile.
foreach ($check in @("check:drop-pickup-item-loss", "check:world-revision-persistence", "check:inventory-contracts", "check:world-change-batching")) {
    Write-Host ("  -> npm run {0}" -f $check) -ForegroundColor DarkGray
    npm run $check
    if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run $check" }
}

Write-Host ""
Write-Host "=== 5/5  Full release gate ===" -ForegroundColor Cyan
Write-Host "  NOTE: if check:security fails ONLY on check:tsconfig-projects, that is a known" -ForegroundColor DarkYellow
Write-Host "  pre-existing, unrelated, in-progress typed-import migration on this branch" -ForegroundColor DarkYellow
Write-Host "  (confirmed separately, multiple times -- not caused by this change). Safe to" -ForegroundColor DarkYellow
Write-Host "  proceed the same way you have for prior fixes if that's the only failure." -ForegroundColor DarkYellow
npm run check:security
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:security (see NOTE above)" }

Write-Host ""
Write-Host "All gates passed." -ForegroundColor Green
Write-Host ""
Write-Host "Files to commit (source AND generated output, or deploy_to_droplet.ps1 will refuse):" -ForegroundColor Yellow
Write-Host "    git add src/server.ts src/postgres_store.ts server.js postgres_store.js ecosystem.config.js build_and_verify_fishing_delay_instrumentation.ps1"
Write-Host "    git commit -m ""diag(postgres): log write-queue wait time vs exec time per transaction label"""
Write-Host ""
Write-Host "Then review the diff before deploying:" -ForegroundColor Yellow
Write-Host "    git diff HEAD~1 --stat"
Write-Host ""
Write-Host "Then deploy the same way as before (this DOES need a restart -- it's a code + env change):" -ForegroundColor Yellow
Write-Host "    .\deploy_staging.ps1 -Fast"
Write-Host ""
Write-Host "How to verify:" -ForegroundColor Yellow
Write-Host "  Play fishing for a while (ideally until you hit the delay again), then check the" -ForegroundColor Yellow
Write-Host "  staging PM2 log for '[postgres] slow write: label=fishing_start ...' lines -- see" -ForegroundColor Yellow
Write-Host "  the header comment in this script for how to read queue_wait_ms vs exec_ms." -ForegroundColor Yellow
