# Same recurring pattern as before: the migration commit script itself
# (commit_rod_migration_server.ps1) is left untracked in the repo root,
# which blocks deploy_staging.ps1's clean-tree check. Fix: commit it too,
# same convention as the other one-off migration/fix scripts already
# tracked in this repo (commit_skip_tsconfig_projects_check.ps1,
# commit_fix_item_data_pickaxe_check.ps1, etc).

$ErrorActionPreference = "Stop"

Set-Location "G:\PixelMania\PixelManiaServer"

Write-Host "=== git status (before) ===" -ForegroundColor Cyan
git status

git add commit_rod_migration_server.ps1
git commit -m "Track rod migration commit script"

Write-Host ""
Write-Host "=== git status (after) ===" -ForegroundColor Cyan
git status

Write-Host ""
Write-Host "Pushing..." -ForegroundColor Cyan
git push

Write-Host ""
Write-Host "Done. Tree should now be clean. Re-run .\deploy_staging.ps1" -ForegroundColor Green
