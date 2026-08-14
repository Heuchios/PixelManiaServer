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

Write-Host "== PixelManiaServer: build + commit Wizard's Staff hand item (server mirror) ==" -ForegroundColor Cyan
Write-Host "Repo path: $RepoPath"

Set-Location -Path $RepoPath

if (-not (Test-Path '.git')) {
    Fail "ERROR: '$RepoPath' does not look like a git repo (no .git folder). Run this script from inside PixelManiaServer, or pass -RepoPath."
}

if (-not (Test-Path 'src/server_item_database.ts')) {
    Fail 'ERROR: src/server_item_database.ts not found (are you in the right repo?)'
}

Write-Host ''
Write-Host '-- npm run build:item-data (compiles src/server_item_database.ts -> server_item_database.js) --' -ForegroundColor Yellow
npm run build:item-data
if ($LASTEXITCODE -ne 0) { Fail 'ERROR: build:item-data failed. Fix the TypeScript error above before continuing.' }

# NOTE: this script commits itself along with the data files. deploy_staging.ps1 enforces a
# clean git tree before deploying, and a brand-new *.ps1 helper script left untracked at the
# repo root fails that gate on the very next deploy run (hit exactly this with
# build_and_commit_server_fire_staff_item.ps1). Staging this script's own filename here means
# there is nothing left over afterward.
$scriptSelf = Split-Path -Leaf $PSCommandPath
$files = @(
    'src/server_item_database.ts',
    'server_item_database.js',
    $scriptSelf
)

Write-Host ''
Write-Host '-- git status before --' -ForegroundColor Yellow
git status --short $files

Write-Host ''
Write-Host '-- diff (review before continuing) --' -ForegroundColor Yellow
Write-Host "Mirrors the client change: a new wizards_staff item entry (category tool," -ForegroundColor Yellow
Write-Host 'equipment_slot hand, equipable true, hand_item true, rarity legendary,' -ForegroundColor Yellow
Write-Host 'punch_animation punch_sword, texture wizards_staff_1, inventory_icon' -ForegroundColor Yellow
Write-Host 'wizards_staff_icon, shop_price 0). No hand_item_animations block server-side --' -ForegroundColor Yellow
Write-Host 'matching the fire_staff/phoenix_sword precedent (static texture/icon fields' -ForegroundColor Yellow
Write-Host 'only). Also stages this script itself so it does not trip the clean-tree gate' -ForegroundColor Yellow
Write-Host 'in deploy_staging.ps1 on the next deploy.' -ForegroundColor Yellow
git --no-pager diff -- 'src/server_item_database.ts' 'server_item_database.js'
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
Add Wizard's Staff hand item (server mirror)

- Mirror the client's item_database.gd change: add a "wizards_staff" entry to
  src/server_item_database.ts (category tool, equipment_slot hand, equipable true,
  hand_item true, rarity legendary, punch_animation punch_sword, texture
  wizards_staff_1, inventory_icon wizards_staff_icon, shop_price 0). No
  hand_item_animations server-side, matching the fire_staff/phoenix_sword precedent.
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
Write-Host '  2. In pixel-mania, run commit_and_push_wizards_staff_atlas.ps1 if you have not already' -ForegroundColor Cyan
Write-Host '  3. Run .\deploy_staging.ps1 to ship this to STAGING (this is a brand-new item id,' -ForegroundColor Cyan
Write-Host '     so there is nothing to promote to production until you have verified it on' -ForegroundColor Cyan
Write-Host '     staging first -- run .\promote_staging_to_production.ps1 only after that).' -ForegroundColor Cyan
Write-Host 'Press Enter to close...'
[void][System.Console]::ReadLine()
