# Follow-up: commits the COMPILED build output that commit_leaderboard_server.ps1 missed.
#
# WHAT HAPPENED
#   commit_leaderboard_server.ps1 staged only src/server_item_database.ts. But its build gate
#   (`npm run check:item-data` -> `build:item-data` -> tsc + scripts/sync_item_data_build.js)
#   REGENERATES the compiled server_item_database.js at the repo root, and that file is
#   tracked (it is not in .gitignore). So the .ts committed cleanly while the rebuilt .js was
#   left modified in the working tree, and deploy_to_droplet.ps1:197 then refused:
#
#       Versioned deployment requires a clean backend Git commit.
#       Commit or stash these changes first: M server_item_database.js
#
#   The established pattern in this repo (see commit_blocks_atlas_migration_batch3_server.ps1)
#   stages BOTH:
#       $files = @( "src/server_item_database.ts", "server_item_database.js" )
#   That is what this script finishes.
#
#   Nothing is wrong with the code that was already pushed -- this only adds the compiled
#   artifact that belongs with it. After this, re-run .\deploy_staging.ps1.

$ErrorActionPreference = "Stop"
Set-Location "G:\PixelMania\PixelManiaServer"

Write-Host "=== git status (before) ===" -ForegroundColor Cyan
git status

Write-Host ""
Write-Host "=== Sanity: does the compiled output actually contain the leaderboard block? ===" -ForegroundColor Cyan
$hit = Select-String -Path "server_item_database.js" -Pattern "leaderboard_block" -SimpleMatch -Quiet
if (-not $hit) {
    Write-Host "server_item_database.js does NOT contain leaderboard_block." -ForegroundColor Red
    Write-Host "The build did not run or did not pick up the .ts change. Run:" -ForegroundColor Red
    Write-Host "    npm run check:item-data" -ForegroundColor Red
    Write-Host "...then re-run this script." -ForegroundColor Red
    exit 1
}
Write-Host "OK - leaderboard_block found in the compiled output." -ForegroundColor Green

Write-Host ""
Write-Host "=== git diff --stat ===" -ForegroundColor Cyan
git diff --stat -- server_item_database.js

Write-Host ""
Write-Host "Review above. Press Enter to commit the build output, or Ctrl+C to abort." -ForegroundColor Yellow
Read-Host

git add -- server_item_database.js commit_leaderboard_server_build_output.ps1

Write-Host ""
Write-Host "=== git status (staged) ===" -ForegroundColor Cyan
git status

$commitMessage = @"
build(items): commit regenerated server_item_database.js

The leaderboard block commit staged only src/server_item_database.ts.
Its build gate (check:item-data -> build:item-data -> tsc +
sync_item_data_build.js) regenerates the tracked compiled output
server_item_database.js, which was left modified in the working tree
and blocked deploy_to_droplet.ps1's clean-tree requirement.

Same pairing the atlas-migration commits use: the .ts source and its
compiled .js artifact ship together.
"@

git commit -m $commitMessage

Write-Host ""
Write-Host "=== git log -1 ===" -ForegroundColor Cyan
git log -1

Write-Host ""
Write-Host "Pushing..." -ForegroundColor Cyan
git push

Write-Host ""
Write-Host "=== Verifying the tree is clean enough to deploy ===" -ForegroundColor Cyan
$dirty = git status --porcelain
if ([string]::IsNullOrWhiteSpace($dirty)) {
    Write-Host "Working tree is CLEAN. Ready to deploy." -ForegroundColor Green
    Write-Host ""
    Write-Host "Run:  .\deploy_staging.ps1" -ForegroundColor Green
} else {
    Write-Host "Tree still has changes -- deploy will refuse until these are committed or stashed:" -ForegroundColor Yellow
    Write-Host $dirty -ForegroundColor Yellow
    Write-Host ""
    Write-Host "If these are other generated .js files at the repo root, they are build output" -ForegroundColor Yellow
    Write-Host "from the same gate and should be committed the same way. Send me the list if unsure." -ForegroundColor Yellow
}
