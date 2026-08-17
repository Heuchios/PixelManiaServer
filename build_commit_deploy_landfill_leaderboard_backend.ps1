<#
    PixelManiaServer - build + commit + deploy the CORRECTED Landfill leaderboard/score/
    prize-claim Postgres backend fix (2026-08-17, round 2).

    WHY THIS EXISTS (updated -- supersedes the first version of this script)
    --------------------------------------------------------------------------
    The first version of this script (same filename, deployed as commit 95b2493) diagnosed the
    "EVENT LEADERBOARD stuck on Loading forever" bug correctly but misdiagnosed its cause: it
    assumed the Landfill Postgres persistence layer (ensureLandfillSchema + 5 methods) had never
    been built, and added a brand-new username-text-keyed version from scratch.

    That was wrong. The layer HAD been built before (commits db3be58, 11c9139, player_id-keyed,
    matching every other per-player table in this file), had been running in production, and had
    already accumulated two real players' season scores (413kg, 270kg, dated 2026-08-14). It was
    then accidentally deleted by commit fd0edc0 ("Optimize world-join DB path and add permanent
    WORLD_JOIN_PROFILE telemetry") -- an unrelated world-join latency optimization pass that swept
    up the entire Landfill backend (and the original deleteWorldState) as collateral damage.

    Because the first fix's new tables used different column names (username text) than the
    still-live original tables (player_id uuid) with the SAME NAMES, `CREATE TABLE IF NOT EXISTS`
    was a silent no-op against the live tables, and every method then failed at runtime with
    Postgres errors like `column "username" does not exist` -- caught by try/catch, silently
    returning empty results. That's why the leaderboard started loading (no more unhandled
    rejection) but showed no data even after playing a race: the fix "worked" against tables that
    didn't match what was actually live.

    THIS version of the fix restores the original player_id-based implementation (recovered via
    `git show fd0edc0 -- src/postgres_store.ts`, whose removed lines are the complete final
    pre-deletion source) so it is compatible with the tables already live on staging and does not
    orphan the two existing players' scores. See project memory "Landfill seasonal event design"
    for the full writeup once it's updated with this round's findings.

    This change is confined to ONE file: src/postgres_store.ts (same table names as the first
    fix, but player_id-keyed to match what's actually live; same 5 methods, restored to their
    original logic, plus incrementLandfillKilograms which the original also had). Nothing else
    was touched.

    Like build_commit_deploy_landfill.ps1, this script does not stop at a green build -- it
    re-reads the generated postgres_store.js afterward and asserts the new code actually landed
    there, so a build that silently didn't run (or a sync step that didn't fire) fails HERE,
    loudly, instead of shipping a stale artifact. It also asserts the OLD (wrong) username-keyed
    schema markers are gone, so this can't accidentally re-ship the first, incompatible fix.

    WHAT IT DOES
    ------------
      1. Sanity-checks the repo path.
      2. Confirms the corrected fix's source markers are present in src/postgres_store.ts, AND
         that the old incompatible (username-keyed) markers are gone.
      3. npm run check:postgres-store   -- builds postgres_store.js and runs the project's own
                                            build-output gate (scripts/check_postgres_store_build.js)
      4. Verifies the generated postgres_store.js actually contains the new code.
      5. Commits ONLY src/postgres_store.ts + postgres_store.js + this script itself.
      6. Runs .\deploy_staging.ps1 (STAGING ONLY -- see SAFETY)

    SAFETY
    ------
      * Never runs promote_staging_to_production.ps1. Per this project's deploy-environment
        rule, an unqualified "deploy" defaults to STAGING; production is a separate, explicit
        step Hassan runs himself once staging is verified.
      * Only ever `git add`s an explicit list of files -- never sweeps in unrelated
        work-in-progress. This list includes the script's OWN filename this time, so it can't
        repeat the first version's bug (which left itself untracked and tripped the deploy
        preflight's "repo must be completely clean" check).
      * Skips the commit step cleanly when nothing is staged, so re-running after a partial
        failure is safe.
      * Does NOT touch the database directly. The corrected code targets the tables that are
        already live on staging (landfill_season_scores, landfill_race_results,
        landfill_prize_claims, all player_id-keyed) -- no migration needed, no data loss risk.

    USAGE
        cd G:\PixelMania\PixelManiaServer
        .\build_commit_deploy_landfill_leaderboard_backend.ps1                # build, commit, deploy to staging
        .\build_commit_deploy_landfill_leaderboard_backend.ps1 -SkipDeploy    # build + commit only
        .\build_commit_deploy_landfill_leaderboard_backend.ps1 -DryRun        # show what would happen, change nothing
        .\build_commit_deploy_landfill_leaderboard_backend.ps1 -Fast          # deploy with -Fast (skips local preflight)
#>

param(
    [string]$CommitMessage = "fix(landfill): restore original player_id-keyed Postgres leaderboard/score/prize-claim persistence (fd0edc0 regression)",
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

function Assert-NotContains($path, $needle, $why) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing expected file: $path" }
    $content = Get-Content -LiteralPath $path -Raw
    if ($content.Contains($needle)) {
        throw "$path still contains '$needle' -- $why"
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
Write-Step "2/6  Confirming the corrected fix's source markers are present (and the old, incompatible ones are gone)"
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
Assert-Contains $srcFile "async incrementLandfillKilograms" `
    "incrementLandfillKilograms is missing"
Assert-Contains $srcFile "async getLandfillLeaderboard" `
    "getLandfillLeaderboard is missing"
Assert-Contains $srcFile "async getLandfillPlayerScore" `
    "getLandfillPlayerScore is missing"
Assert-Contains $srcFile "async insertLandfillPrizeClaim" `
    "insertLandfillPrizeClaim is missing"
Assert-Contains $srcFile "async deleteLandfillPrizeClaim" `
    "deleteLandfillPrizeClaim is missing"

# Positive marker that the schema is player_id-keyed (the live/correct shape), not username-keyed.
Assert-Contains $srcFile "PRIMARY KEY (session_id, player_id)" `
    "landfill_race_results does not look player_id-keyed -- did the old username-keyed fix get restored by mistake?"
Assert-Contains $srcFile "ensurePlayerIdentityForExistingAccount(client, cleanUsername)" `
    "the landfill methods don't look like they resolve username -> player_id -- did the old username-keyed fix get restored by mistake?"

# Negative markers: these strings only exist in the FIRST (wrong, username-keyed) version of this
# fix. If either is present, this is about to re-ship a schema that's incompatible with the tables
# already live on staging.
Assert-NotContains $srcFile "landfill_race_result_id bigserial PRIMARY KEY" `
    "this is the OLD username-keyed landfill_race_results primary key -- the wrong fix is still here"
Assert-NotContains $srcFile "UNIQUE (session_id, username)" `
    "this is the OLD username-keyed uniqueness constraint -- the wrong fix is still here"

Write-Host "  All source markers present, old incompatible markers absent." -ForegroundColor DarkGray

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
    Assert-NotContains $artifact "landfill_race_result_id" `
        "STALE ARTIFACT: the compiled output still has the OLD username-keyed schema -- rebuild didn't pick up the fix."
    Write-Host "  Generated artifact is in sync with source." -ForegroundColor Green
}

# -------------------------------------------------------------------------------------------
Write-Step "5/6  Committing (named files only)"

$files = @(
    "src/postgres_store.ts",
    "postgres_store.js",
    "build_commit_deploy_landfill_leaderboard_backend.ps1"
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
Write-Host "  1. Open the EVENT LEADERBOARD panel -> the two existing players (413kg, 270kg from"
Write-Host "     Aug 14) should now show up in the top 10 -- this is the key check that this fix"
Write-Host "     is reading the SAME rows the old code wrote, not orphaning them"
Write-Host "  2. Play one Landfill race to completion -> your name/points appear on the leaderboard"
Write-Host "     and 'Your rank' / 'Your points' update"
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
