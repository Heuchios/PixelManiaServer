<#
    PixelManiaServer - typed module seams

    Round 1: 10 route/dispatcher modules moved from `export {}` + `module.exports = {...}`
             to `export = {...}`; all 39 local `const X = require("./y")` in src\server.ts
             became `import X = require("./y")`. Emit for server.ts is byte-identical; the
             10 modules each lose one line:
                 Object.defineProperty(exports, "__esModule", { value: true });
             Nothing reads it (module.exports is reassigned wholesale below it) and no
             check_*_build.js asserts on it.

    This script writes a NEW log per run (tsc_seam_errors_<n>.log) because re-reading a
    path that already exists defeats the file bridge's cache.

    STAGE 3 ERRORS ARE THE POINT -- they are call sites being type-checked for the first
    time. Send me the newest tsc_seam_errors_*.log.

    Node builtins in server.ts (ws, fs, http, crypto, path, os, child_process, nodemailer)
    are still `const x = require(...)` and therefore still `any`. Deliberate separate batch.

    This script does NOT commit and does NOT deploy.

    Usage:
        cd G:\PixelMania\PixelManiaServer
        .\build_and_verify_typed_module_seams.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer folder (package.json not found here)."
}

$n = 1
while (Test-Path (Join-Path (Get-Location) ("tsc_seam_errors_{0}.log" -f $n))) { $n++ }
$log = Join-Path (Get-Location) ("tsc_seam_errors_{0}.log" -f $n)
Write-Host ("Log for this run: {0}" -f (Split-Path $log -Leaf)) -ForegroundColor DarkGray

$converted = @(
    @{ Script = "server-account-auth-routes";          Src = "src\server_account_auth_routes.ts" },
    @{ Script = "server-admin-lookup-routes";          Src = "src\server_admin_lookup_routes.ts" },
    @{ Script = "server-friend-routes";                Src = "src\server_friend_routes.ts" },
    @{ Script = "server-inventory-economy-routes";     Src = "src\server_inventory_economy_routes.ts" },
    @{ Script = "server-phase7-dispatcher";            Src = "src\server_phase7_dispatcher.ts" },
    @{ Script = "server-phase8-final-routes";          Src = "src\server_phase8_final_routes.ts" },
    @{ Script = "server-phase8-player-session-routes"; Src = "src\server_phase8_player_session_routes.ts" },
    @{ Script = "server-phase8-world-action-routes";   Src = "src\server_phase8_world_action_routes.ts" },
    @{ Script = "server-phase9-remaining-routes";      Src = "src\server_phase9_remaining_routes.ts" },
    @{ Script = "server-trade-routes";                 Src = "src\server_trade_routes.ts" }
)

foreach ($m in $converted) {
    if (-not (Test-Path $m.Src)) { throw "Missing expected file: $($m.Src)" }
    $text = Get-Content $m.Src -Raw
    if ($text -match "(?m)^module\.exports = \{") { throw "$($m.Src) still uses module.exports" }
    if (-not ($text -match "(?m)^export = \{"))   { throw "$($m.Src) is missing its export = block" }
}

$serverSrc   = Get-Content "src\server.ts" -Raw
$importCount = ([regex]::Matches($serverSrc, '(?m)^import [A-Za-z_$][\w$]* = require\("\./')).Count
$leftover    = ([regex]::Matches($serverSrc, '(?m)^const [A-Za-z_$][\w$]* = require\("\./')).Count
Write-Host ("src/server.ts: {0} typed seams, {1} untyped local requires remaining" -f $importCount, $leftover)
if ($importCount -ne 39) { throw "Expected 39 typed seams in src/server.ts, found $importCount" }
if ($leftover -ne 0)     { throw "src/server.ts still has $leftover untyped local requires" }

Write-Host ""
Write-Host "=== 1/4  Rebuild the 10 converted modules ===" -ForegroundColor Cyan
foreach ($m in $converted) {
    Write-Host ("  -> npm run build:{0}" -f $m.Script) -ForegroundColor DarkGray
    npm run ("build:" + $m.Script) 2>&1 | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run build:$($m.Script) -- see $log" }
}

Write-Host ""
Write-Host "=== 2/4  Their build checks ===" -ForegroundColor Cyan
foreach ($m in $converted) {
    Write-Host ("  -> npm run check:{0}" -f $m.Script) -ForegroundColor DarkGray
    npm run ("check:" + $m.Script) 2>&1 | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:$($m.Script) -- see $log" }
}

Write-Host ""
Write-Host "=== 3/4  Server entry build -- the newly type-checked surface ===" -ForegroundColor Cyan
npm run build:server-entry 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) {
    $errs = @(Select-String -Path $log -Pattern '^src[\\/][^\(]+\([0-9]+,[0-9]+\): error TS')
    Write-Host ""
    Write-Host ("{0} compiler errors remain." -f $errs.Count) -ForegroundColor Yellow
    Write-Host ""
    Write-Host "By error code:" -ForegroundColor Cyan
    $errs | ForEach-Object { if ($_.Line -match '(error TS\d+)') { $Matches[1] } } |
        Group-Object | Sort-Object Count -Descending | Format-Table Count, Name -AutoSize
    Write-Host ("Send me {0}" -f (Split-Path $log -Leaf)) -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=== 4/4  Full release gate ===" -ForegroundColor Cyan
npm run check:security 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:security -- see $log" }

Write-Host ""
Write-Host "All gates passed." -ForegroundColor Green
Write-Host ""
Write-Host "Commit source AND generated output, or deploy_to_droplet.ps1 will refuse:" -ForegroundColor Yellow
Write-Host "    git add src/server.ts server.js ``"
Write-Host "            src/server_account_auth_routes.ts server_account_auth_routes.js ``"
Write-Host "            src/server_admin_lookup_routes.ts server_admin_lookup_routes.js ``"
Write-Host "            src/server_friend_routes.ts server_friend_routes.js ``"
Write-Host "            src/server_inventory_economy_routes.ts server_inventory_economy_routes.js ``"
Write-Host "            src/server_phase7_dispatcher.ts server_phase7_dispatcher.js ``"
Write-Host "            src/server_phase8_final_routes.ts server_phase8_final_routes.js ``"
Write-Host "            src/server_phase8_player_session_routes.ts server_phase8_player_session_routes.js ``"
Write-Host "            src/server_phase8_world_action_routes.ts server_phase8_world_action_routes.js ``"
Write-Host "            src/server_phase9_remaining_routes.ts server_phase9_remaining_routes.js ``"
Write-Host "            src/server_trade_routes.ts server_trade_routes.js ``"
Write-Host "            tsconfig.server-phase8-world-action-routes.json tsconfig.server-phase11a-runtime.json"
Write-Host "    git commit -m ""refactor(ts): type the 39 server.ts module seams via import-equals"""
