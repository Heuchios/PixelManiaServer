# Same pattern one more time: commit_rod_script_leftover.ps1 committed
# everything except itself. This script uses a glob so it also catches
# itself (it's already written to disk before you run it), so this
# should be the last one needed.

$ErrorActionPreference = "Stop"

Set-Location "G:\PixelMania\PixelManiaServer"

Write-Host "=== git status (before) ===" -ForegroundColor Cyan
git status

git add commit_rod_*.ps1
git commit -m "Track remaining rod migration scripts"

Write-Host ""
Write-Host "=== git status (after) ===" -ForegroundColor Cyan
git status

Write-Host ""
Write-Host "Pushing..." -ForegroundColor Cyan
git push

Write-Host ""
Write-Host "Done. Tree should now be fully clean. Re-run .\deploy_staging.ps1" -ForegroundColor Green
