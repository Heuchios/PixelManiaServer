#requires -Version 5.1
<#
    Builds and verifies the /health process-memory addition plus the staged-load-test
    server-metric instrumentation.

    Run from the PixelManiaServer repo root:
        powershell -ExecutionPolicy Bypass -File .\build_and_verify_phase11a_health_memory.ps1

    Changed files:
        src/server_phase11a_runtime.ts                    (adds persistence.process_runtime)
        scripts/check_server_phase11a_runtime_build.js     (asserts it)
        scripts/staged_ws_load_test.js                     (server metric capture)
        scripts/check_staged_ws_load_test_safety.js        (asserts it)
        scripts/check_scale_readiness_wiring.js            (release gate pins)
        .gitignore                                         (tmp_*.jsonl)

    The Cowork session could not run tsc or npm, so this script performs the real build and
    the real checks. Nothing here is verified until this run is green.
#>

$ErrorActionPreference = "Stop"

function Invoke-Step {
    param([string]$Label, [scriptblock]$Action)
    Write-Host ""
    Write-Host "=== $Label ===" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer repo root (no package.json here)."
}

Invoke-Step "Syntax check the edited scripts" {
    node --check .\scripts\staged_ws_load_test.js
    node --check .\scripts\check_staged_ws_load_test_safety.js
    node --check .\scripts\check_scale_readiness_wiring.js
    node --check .\scripts\check_server_phase11a_runtime_build.js
}

# This compiles src/server_phase11a_runtime.ts and syncs it to the root
# server_phase11a_runtime.js that the server actually runs.
Invoke-Step "Build phase11a runtime (tsc + sync)" {
    npm run build:server-phase11a-runtime
}

Invoke-Step "Phase11a runtime build check (/health process_runtime)" {
    npm run check:server-phase11a-runtime
}

Invoke-Step "Staged load-test safety check" {
    npm run check:load-staged-safety
}

Invoke-Step "Scale readiness gate" {
    npm run check:scale-readiness
}

# Root tsconfig strict-typechecks scripts/**/*.js, so the new load-test helpers are covered here.
Invoke-Step "TypeScript typecheck chain" {
    npm run check:typescript
}

Write-Host ""
Write-Host "=== Generated build diff (must be committed alongside the .ts) ===" -ForegroundColor Cyan
git status --short -- src/server_phase11a_runtime.ts server_phase11a_runtime.js scripts .gitignore

Write-Host ""
Write-Host "All checks passed." -ForegroundColor Green
Write-Host "Commit source AND generated output together, or deploy_to_droplet.ps1's" -ForegroundColor Yellow
Write-Host "rebuild-and-diff check will refuse to ship:" -ForegroundColor Yellow
Write-Host ""
Write-Host '  git add src/server_phase11a_runtime.ts server_phase11a_runtime.js scripts/check_server_phase11a_runtime_build.js scripts/staged_ws_load_test.js scripts/check_staged_ws_load_test_safety.js scripts/check_scale_readiness_wiring.js .gitignore'
Write-Host '  git commit -m "Report process memory on /health and capture server metrics in the staged load test"'
Write-Host ""
Write-Host "Then deploy so the staging route instances serve the new /health:" -ForegroundColor Yellow
Write-Host '  .\deploy_to_droplet.ps1'
