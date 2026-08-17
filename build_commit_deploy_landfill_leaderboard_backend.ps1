<#
    PixelManiaServer - build + commit + deploy the Landfill leaderboard/score/prize-claim
    Postgres backend fix (2026-08-17).

    WHY THIS EXISTS
    ---------------
    src/server_landfill_event.ts has always called five postgresStore methods --
    getLandfillLeaderboard, getLandfillPlayerScore, recordLandfillRaceResult,
    insertLandfillPrizeClaim, deleteLandfillPrizeClaim -- that never existed in
    src/postgres_store.ts. No tables, no methods. The visible symptom was the in-game "EVENT
    LEADERBOARD" panel stuck on "Loading leaderboard..." forever, because the server threw a
    TypeError with no try/catch around the packet dispatcher, so the client never got a response.
    A quieter side effect: recordLandfillRaceResult already had its own silent fallback, so every
    finished Landfill race up to now scored kilograms in memory for the results screen but never
    persisted them -- those points are not recoverable.

    This change is confined to ONE file: src/postgres_store.ts (three new tables --
    landfill_race_results, landfill_season_scores, landfill_prize_claims -- a landfillReady
    schema-ready flag, and the five missing methods). Nothing else was touched. See project
    memory "Landfill seasonal event design" (2026-08-17, round 5) for the full writeup.

    Like build_commit_deploy_landfill.ps1, this script does not stop at a green build -- it
    re-reads the generated postgres_store.js afterward and asserts the new code actually landed
    there, so a build that silently didn't run (or a sync step that didn't fire) fails HERE,
    loudly, instead of shipping a stale artifact.

    WHAT IT DOES
    ------------
      1. Sanity-checks the repo path.
      2. Confirms the fix's source markers are present in src/postgres_store.ts.
      3. npm run check:postgres-store   -- builds postgres_store.js and runs the project's own
                                            build-output gate (scripts/check_postgres_store_build.js)
      4. Verifies the generated postgres_store.js actually contains the new code.
      5. Commits ONLY src/postgres_store.ts + postgres_store.js (+ this script, once first added).
      6. Runs .\deploy_staging.ps1 (STAGING ONLY -- see SAFETY)

    SAFETY
    ------
      * Never runs promote_staging_to_production.ps1. Per this project's deploy-environment
        rule, an unqualified "deploy" defaults to STAGING; production is a separate, explicit
        step Hassan runs himself once staging is verified.
      * Only ever `git add`s an explicit list of files -- never sweeps in unrelated
        work-in-progress.
      * Skips the commit step cleanly when nothing is staged, so re-running after a partial
        failure is safe.

    USAGE
        cd G:\PixelMania\PixelManiaServer
        .\build_commit_deploy_landfill_leaderboard_backend.ps1                # build, commit, deploy to staging
        .\build_commit_deploy_landfill_leaderboard_backend.ps1 -SkipDeploy    # build + commit only
        .\build_commit_deploy_landfill_leaderboard_backend.ps1 -DryRun        # show what would happen, change nothing
        .\build_commit_deploy_landfill_leaderboard_backend.ps1 -Fast          # deploy with -Fast (skips local preflight)
#>

param(
    [string]$CommitMessage = "fix(landfill): add missing Postgres leaderboard/score/prize-claim persistence layer",
    [switch]$SkipDeploy,
    [switch]$DryRun,
    [switch]$Fast
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ServerRepo = $PSScriptRoot

function Write-Step($text) {
    Write-Host ""
    Write-Host "=== $text ===" -ForegroundColor Cyan
}

function Assert-Contains($path, $needle, $why) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing expected file: $path" }
    $content = Get-Content -LiteralPath $path -Raw
    if (-not $content.Contains($needle)) {
        throw "$path is missing '$needle' -- $why"
    }
}

# -------------------------------------------------------------------------------------------
Write-Step "1/6  Checking repo path"
if (-not (Test-Path (Join-Path $ServerRepo "package.json"))) {
    throw "Run this from the PixelManiaServer folder (package.json not found in $ServerRepo)."
}
if (-not (Test-Path (Join-Path $ServerRepo "deploy_staging.ps1"))) {
    throw "Missing deploy_staging.ps1 in $ServerRepo"
}
Write-Host "  Server: $ServerRepo" -ForegroundColor DarkGray

# -------------------------------------------------------------------------------------------
Write-Step "2/6  Confirming the fix's source markers are present"
$srcFile = Join-Path $ServerRepo "src/postgres_store.ts"
Assert-Contains $srcFile "landfillReady" `
    "the schema-ready flag is missing"
Assert-Contains $srcFile "ensureLandfillSchema" `
    "the table-creation method is missing"
Assert-Contains $srcFile "landfill_race_results" `
    "the race-result idempotency table is missing"
Assert-Contains $srcFile "landfill_season_scores" `
    "the season-totals table is missing"
Assert-Contains $srcFile "landfill_prize_claims" `
    "the prize-claim receipts table is missing"
Assert-Contains $srcFile "async recordLandfillRaceResult" `
    "recordLandfillRaceResult is missing"
Assert-Contains $srcFile "async getLandfillLeaderboard" `
    "getLandfillLeaderboard is missing"
Assert-Contains $srcFile "async getLandfillPlayerScore" `
    "getLandfillPlayerScore is missing"
Assert-Contains $srcFile "async insertLandfillPrizeClaim" `
    "insertLandfillPrizeClaim is missing"
Assert-Contains $srcFile "async deleteLandfillPrizeClaim" `
    "deleteLandfillPrizeClaim is missing"
Write-Host "  All source markers present." -ForegroundColor DarkGray

# -------------------------------------------------------------------------------------------
Write-Step "3/6  Building postgres_store.js + running its build-output gate"
if ($DryRun) {
    Write-Host "  [DryRun] would run: npm run check:postgres-store" -ForegroundColor DarkYellow
} else {
    Push-Location $ServerRepo
    try {
        npm run check:postgres-store
        if ($LASTEXITCODE -ne 0) { throw "FAILED: npm run check:postgres-store" }
    } finally {
        Pop-Location
    }
    Write-Host "  Build + gate passed." -ForegroundColor DarkGray
}

# -------------------------------------------------------------------------------------------
Write-Step "4/6  Verifying the generated artifact actually contains the new code"
if ($DryRun) {
    Write-Host "  [DryRun] skipping artifact verification (nothing was built)." -ForegroundColor DarkYellow
} else {
    $artifact = Join-Path $ServerRepo "postgres_store.js"
    Assert-Contains $artifact "landfill_race_results" `
        "STALE ARTIFACT: the build did not regenerate postgres_store.js. Run 'npm run build:postgres-store' and re-check."
    Assert-Contains $artifact "getLandfillLeaderboard" `
        "STALE ARTIFACT: getLandfillLeaderboard is not in the file the server actually runs."
    Write-Host "  Generated artifact is in sync with source." -ForegroundColor Green
}

# -------------------------------------------------------------------------------------------
Write-Step "5/6  Committing (named files only)"

$files = @(
    "src/postgres_store.ts",
    "postgres_store.js"
)

$existing = @()
foreach ($f in $files) {
    if (Test-Path -LiteralPath (Join-Path $ServerRepo $f)) { $existing += $f }
    else { Write-Host "  skipping missing file: $f" -ForegroundColor DarkYellow }
}

if ($DryRun) {
    Write-Host "  [DryRun] would: git add $($existing -join ' ')" -ForegroundColor DarkYellow
    Write-Host "  [DryRun] would: git commit -m ""$CommitMessage""" -ForegroundColor DarkYellow
} elseif ($existing.Count -eq 0) {
    Write-Host "  Nothing to add." -ForegroundColor DarkYellow
} else {
    Write-Host ""
    Write-Host "-- diff (review before continuing) --" -ForegroundColor Yellow
    git --no-pager diff -- $existing
    Write-Host ""
    Write-Host "Press Enter to continue and stage/commit these files, or close this window to abort." -ForegroundColor Cyan
    [void][System.Console]::ReadLine()

    git add -- $existing
    if ($LASTEXITCODE -ne 0) { throw "FAILED: git add" }

    git diff --cached --quiet -- $existing
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  No changes staged, skipping commit." -ForegroundColor DarkGray
    } else {
        git commit -m $CommitMessage
        if ($LASTEXITCODE -ne 0) { throw "FAILED: git commit" }
        Write-Host "  Committed." -ForegroundColor Green
    }
}

# Surface anything else dirty, so an unrelated file is noticed rather than silently left behind
# (the deploy preflight refuses on any tracked diff or untracked file in the repo).
if (-not $DryRun) {
    $dirty = git -C $ServerRepo status --porcelain
    if ($dirty) {
        Write-Host ""
        Write-Host "  NOTE: other uncommitted changes remain in the server repo:" -ForegroundColor DarkYellow
        $dirty | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow }
        Write-Host "  If any are GENERATED .js files, the deploy preflight will refuse until they are" -ForegroundColor DarkYellow
        Write-Host "  committed. Anything else (e.g. other in-progress work) is fine to leave." -ForegroundColor DarkYellow
    }
}

# -------------------------------------------------------------------------------------------
Write-Step "6/6  Deploying to STAGING"

# deploy_to_droplet.ps1's local preflight demands the repo be completely clean -- no tracked
# diff vs HEAD, and no untracked files at all. Checking it HERE turns that into a clear,
# actionable message instead of an exception thrown from deep inside deploy_to_droplet.ps1.
if (-not $DryRun) {
    $trackedDirty = git -C $ServerRepo diff --name-only HEAD --
    $untracked = git -C $ServerRepo ls-files --others --exclude-standard
    if ($trackedDirty -or $untracked) {
        Write-Host ""
        Write-Host "  Repo is not clean, so the deploy would refuse:" -ForegroundColor Red
        if ($trackedDirty) {
            Write-Host "    modified (tracked):" -ForegroundColor Red
            $trackedDirty | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
        }
        if ($untracked) {
            Write-Host "    untracked:" -ForegroundColor Red
            $untracked | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
        }
        Write-Host ""
        Write-Host "  Commit or .gitignore them before deploying. Careful with work-in-progress you" -ForegroundColor Yellow
        Write-Host "  do NOT want committed -- add it to .gitignore or stash it instead." -ForegroundColor Yellow
        throw "Repo not clean; refusing to start the deploy."
    }
    Write-Host "  Repo is clean." -ForegroundColor DarkGray
}

if ($SkipDeploy) {
    Write-Host "  -SkipDeploy set. Deploy manually with:  .\deploy_staging.ps1" -ForegroundColor Yellow
} elseif ($DryRun) {
    Write-Host "  [DryRun] would run: .\deploy_staging.ps1" -ForegroundColor DarkYellow
} else {
    Push-Location $ServerRepo
    try {
        # Staging only. This script never calls promote_staging_to_production.ps1.
        if ($Fast) { .\deploy_staging.ps1 -Fast } else { .\deploy_staging.ps1 }
        if ($LASTEXITCODE -ne 0) { throw "FAILED: deploy_staging.ps1" }
    } finally {
        Pop-Location
    }
    Write-Host "  Deployed to staging." -ForegroundColor Green
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
Write-Host "Verify on staging in this order:" -ForegroundColor Yellow
Write-Host "  1. Open the EVENT LEADERBOARD panel -> it now loads instead of spinning forever"
Write-Host "  2. Play one Landfill race to completion -> your name/points appear on the leaderboard"
Write-Host "     and 'Your rank' / 'Your points' update (this is the first race whose points will"
Write-Host "     actually persist -- anything played before this deploy did not)"
Write-Host "  3. If you're in the season's top 10, press the rewards/claim button -> it either"
Write-Host "     grants a prize or reports a clear reason (not configured / inventory full / etc.)"
Write-Host ""
Write-Host "This deployed to STAGING only, per this project's default-to-staging rule -- promoting" -ForegroundColor Yellow
Write-Host "to production is a separate step: .\promote_staging_to_production.ps1" -ForegroundColor Yellow
Write-Host ""
Write-Host "If something misbehaves:" -ForegroundColor Yellow
Write-Host "    sudo -u pixelmania-stg pm2 logs --lines 100 --nostream"
Write-Host "  Look for '[postgres] landfill schema upgrade failed' (schema didn't apply) or"
Write-Host "  'postgresStore.getLandfillLeaderboard is not a function' (deploy didn't actually ship"
Write-Host "  the new postgres_store.js -- check step 4's artifact verification ran clean)."
