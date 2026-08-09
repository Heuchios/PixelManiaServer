<#
    PixelManiaServer - RE-FIX for the "world permanently unjoinable" bug
    (client freezes at ~88% on the loading screen). This regressed back in
    on 2026-08-09 -- MAX_WORLD_OWNERSHIP_TOKEN_LENGTH had disappeared from
    src/server.ts and both ownership_token clampString() calls had fallen
    back to clampString()'s default limit, MAX_ITEM_ID_LENGTH (64).

    World ownership tokens are "instance:pid:uuid:epoch", e.g.
        pixelmania-staging:895822:d39ff9fc-ceff-4957-b172-dca639d5de50:12
    That token is 64 characters while the epoch is a single digit, and 65
    the moment the epoch reaches two digits. Clamped at 64, the trailing
    digit is silently cut off, the cached token stops matching the one in
    Redis, verifyWorldPersistenceOwnership() fails, and every join to that
    world is rejected forever with the client-retryable
    "World data is still loading. Try again." -- so it looks like a silent
    freeze on both ends.

    This script re-applies the original fix:
      - const MAX_WORLD_OWNERSHIP_TOKEN_LENGTH = 256; (near MAX_ITEM_ID_LENGTH)
      - both ownership_token clampString(...) call sites (the initial claim
        and the reseeded-after-fence-rejection claim in
        claimWorldRouteForCurrentInstance) now pass that explicit limit
        instead of relying on the default.

    The src/server.ts edit has ALREADY been written back to your machine by
    Claude. This script just builds it and runs the release gates so you can
    confirm the fix compiles clean and nothing else regressed, then commits.

    Usage:
        cd G:\PixelMania\PixelManiaServer
        .\build_and_verify_world_ownership_token_length_fix.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer folder (package.json not found here)."
}

if (-not (Test-Path "src\server.ts")) { throw "Missing expected file: src\server.ts" }

Write-Host ""
Write-Host "=== 0/3  Confirming the fix is present in src\server.ts ===" -ForegroundColor Cyan
$serverSource = Get-Content "src\server.ts" -Raw

if ($serverSource -notmatch "MAX_WORLD_OWNERSHIP_TOKEN_LENGTH\s*=\s*256") {
    throw "src\server.ts does not contain the MAX_WORLD_OWNERSHIP_TOKEN_LENGTH fix -- did the write-back land?"
}

# Literal substring checks (not regex) -- avoids PowerShell quote-escaping footguns
# around the embedded `""` empty-string literal in the source text.
$expectedInitial  = 'clampString(route.ownership_token || "", MAX_WORLD_OWNERSHIP_TOKEN_LENGTH)'
$expectedReseeded = 'clampString(reseeded.ownership_token || "", MAX_WORLD_OWNERSHIP_TOKEN_LENGTH)'

if (-not $serverSource.Contains($expectedInitial)) {
    throw "Initial ownership_token clampString() call site is missing the explicit limit."
}
if (-not $serverSource.Contains($expectedReseeded)) {
    throw "Reseeded ownership_token clampString() call site is missing the explicit limit."
}
Write-Host "  Fix confirmed present." -ForegroundColor DarkGray

Write-Host ""
Write-Host "=== 1/3  Building server-entry ===" -ForegroundColor Cyan
npm run build:server-entry
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run build:server-entry" }

Write-Host ""
Write-Host "=== 2/3  server-entry + ownership/routing gates ===" -ForegroundColor Cyan
foreach ($check in @(
    "check:server-entry",
    "check:world-revision-persistence",
    "check:world-route-epoch"
)) {
    Write-Host ("  -> npm run {0}" -f $check) -ForegroundColor DarkGray
    npm run $check
    if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run $check" }
}

Write-Host ""
Write-Host "=== 3/3  Full release gate ===" -ForegroundColor Cyan
npm run check:security
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:security" }

Write-Host ""
Write-Host "All gates passed." -ForegroundColor Green
Write-Host ""
Write-Host "Commit source AND generated output, or deploy_to_droplet.ps1 will refuse:" -ForegroundColor Yellow
Write-Host "    git add src/server.ts server.js build_and_verify_world_ownership_token_length_fix.ps1"
Write-Host "    git commit -m ""fix(world-route): restore MAX_WORLD_OWNERSHIP_TOKEN_LENGTH so ownership tokens stop truncating at 64 chars (regression re-fix)"""
Write-Host ""
Write-Host "This world becomes joinable again the moment the fixed release is live -- no manual" -ForegroundColor Yellow
Write-Host "DB cleanup needed. Rows still holding truncated tokens self-heal on the next claim" -ForegroundColor Yellow
Write-Host "because every claim INCRs the epoch, so currentEpoch < requested and the takeover" -ForegroundColor Yellow
Write-Host "succeeds normally (confirmed in practice on 2026-08-08)." -ForegroundColor Yellow
