Param(
    [string]$RepoPath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

function Fail($msg) {
    Write-Host $msg -ForegroundColor Red
    Write-Host ''
    Write-Host 'Press Enter to close...'
    [void][System.Console]::ReadLine()
    exit 1
}

Write-Host '== PixelManiaServer: build + commit Neptune Rod atlas merge + Serpent Staff rename (server mirror) ==' -ForegroundColor Cyan
Write-Host "Repo path: $RepoPath"

Set-Location -Path $RepoPath

if (-not (Test-Path '.git')) {
    Fail "ERROR: '$RepoPath' does not look like a git repo (no .git folder). Run this script from inside PixelManiaServer, or pass -RepoPath."
}

if (-not (Test-Path 'src/server_item_database.ts')) {
    Fail 'ERROR: src/server_item_database.ts not found (are you in the right repo?)'
}
if (-not (Test-Path 'src/server.ts')) {
    Fail 'ERROR: src/server.ts not found (are you in the right repo?)'
}

Write-Host ''
Write-Host '-- npm run build:item-data (compiles src/server_item_database.ts -> server_item_database.js) --' -ForegroundColor Yellow
npm run build:item-data
if ($LASTEXITCODE -ne 0) { Fail 'ERROR: build:item-data failed. Fix the TypeScript error above before continuing.' }

Write-Host ''
Write-Host '-- npm run build:server-entry (compiles src/server.ts -> server.js) --' -ForegroundColor Yellow
Write-Host 'This build is heavier than build:item-data (server.ts is the full server entry) --' -ForegroundColor Yellow
Write-Host 'give it a minute if it looks stuck.' -ForegroundColor Yellow
npm run build:server-entry
if ($LASTEXITCODE -ne 0) { Fail 'ERROR: build:server-entry failed. Fix the TypeScript error above before continuing.' }

# NOTE: this script commits itself along with the data files. deploy_staging.ps1 enforces a
# clean git tree before deploying, and a brand-new *.ps1 helper script left untracked at the
# repo root fails that gate on the very next deploy run (hit exactly this with
# build_and_commit_server_fire_staff_item.ps1). Staging this script's own filename here means
# there is nothing left over afterward.
$scriptSelf = Split-Path -Leaf $PSCommandPath
$files = @(
    'src/server_item_database.ts',
    'server_item_database.js',
    'src/server.ts',
    'server.js',
    $scriptSelf
)

Write-Host ''
Write-Host '-- git status before --' -ForegroundColor Yellow
git status --short $files

Write-Host ''
Write-Host '-- diff (review before continuing) --' -ForegroundColor Yellow
Write-Host 'Mirrors the client change: neptune_rod gains texture/inventory_icon atlas keys' -ForegroundColor Yellow
Write-Host '(no hand_item_animations server-side, matching precedent). pulu_pulu is renamed' -ForegroundColor Yellow
Write-Host 'to serpent_staff with display_name/texture/inventory_icon added. Also updates' -ForegroundColor Yellow
Write-Host 'SEED_MUTATION_REWARD_TABLE in src/server.ts, which hardcoded item_id "pulu_pulu"' -ForegroundColor Yellow
Write-Host '-- left unrenamed this would have handed out a broken/nonexistent item id after' -ForegroundColor Yellow
Write-Host 'the rename. Also stages this script itself so it does not trip the clean-tree gate' -ForegroundColor Yellow
Write-Host 'in deploy_staging.ps1 on the next deploy.' -ForegroundColor Yellow
git --no-pager diff -- 'src/server_item_database.ts' 'server_item_database.js' 'src/server.ts' 'server.js'
Write-Host ''
Write-Host 'Press Enter to continue and stage/commit these files, or close this window to abort.' -ForegroundColor Cyan
[void][System.Console]::ReadLine()

Write-Host ''
Write-Host '-- staging --' -ForegroundColor Yellow
git add -- $files
if ($LASTEXITCODE -ne 0) { Fail 'ERROR: git add failed.' }

$staged = git diff --cached --name-only -- $files
if (-not $staged) {
    Write-Host ''
    Write-Host 'Nothing to commit -- these files already match the last commit.' -ForegroundColor Yellow
    Write-Host 'Press Enter to close...'
    [void][System.Console]::ReadLine()
    exit 0
}

$commitMessage = @'
Merge Neptune Rod to atlas, rename Pulu Pulu to Serpent Staff (server mirror)

- Mirror the client's item_database.gd change: neptune_rod gains texture
  ("neptune_rod_1") and inventory_icon ("neptune_rod_icon") atlas keys. No
  hand_item_animations server-side, matching the fire_staff/phoenix_sword precedent.
- Rename the pulu_pulu item entry to serpent_staff: add display_name "Serpent
  Staff", texture ("serpent_staff_1"), inventory_icon ("serpent_staff_icon").
- Update SEED_MUTATION_REWARD_TABLE in src/server.ts: item_id "pulu_pulu" ->
  "serpent_staff" (this table hardcodes item ids directly and does not go through
  any legacy-alias resolution, so it would have handed out a broken item id after
  the rename otherwise). Does NOT migrate any live player inventory that already
  holds the old pulu_pulu id.
- Include this commit helper script itself so it is not left untracked (avoids
  tripping deploy_staging.ps1's clean-tree gate on the next deploy).
'@

Write-Host ''
Write-Host '-- committing --' -ForegroundColor Yellow
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { Fail 'ERROR: git commit failed.' }

Write-Host ''
Write-Host 'Done. Committed (not pushed, not deployed).' -ForegroundColor Green
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. git push (this script does not push automatically)' -ForegroundColor Cyan
Write-Host '  2. In pixel-mania, run commit_and_push_neptune_rod_serpent_staff_atlas.ps1 if you have not already' -ForegroundColor Cyan
Write-Host '  3. Run .\deploy_staging.ps1 to ship this to STAGING (Serpent Staff is a brand-new' -ForegroundColor Cyan
Write-Host '     item id, so there is nothing to promote to production until you have verified' -ForegroundColor Cyan
Write-Host '     it -- and the Neptune Rod re-texture -- on staging first; run' -ForegroundColor Cyan
Write-Host '     .\promote_staging_to_production.ps1 only after that).' -ForegroundColor Cyan
Write-Host 'Press Enter to close...'
[void][System.Console]::ReadLine()
