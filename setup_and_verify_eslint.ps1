<#
    PixelManiaServer - ESLint setup, attempt 2: isolated lint toolchain

    WHAT WENT WRONG LAST TIME
    -------------------------
    typescript-eslint refuses to load against typescript@7:
        Error: typescript-eslint does not support TS 7.0.
    TS 7 removed the classic compiler API (createProgram is undefined) that
    typescript-eslint drives for type information. Support for TS >=7.1 is still open
    upstream (typescript-eslint issue #10940). Microsoft documents running TypeScript
    6.0 side by side with 7.0 for exactly this reason.

    A root npm override did not help: peer dependencies hoist to the root, so the
    nested typescript was never created ("nested typescript: NOT PRESENT").

    THE FIX
    -------
    lint/ becomes its own npm project with its own node_modules:
        lint/node_modules/typescript          6.0.x   <- linter only
        node_modules/typescript               7.0.2   <- tsc, all 43 build scripts
    TS 6.0 satisfies typescript-eslint's peer range (>=4.8.4 <6.1.0) and still has the
    compiler API. The two toolchains cannot disturb each other. Your package.json
    dependencies are NOT touched -- step 1 removes what attempt 1 added.

    ESLint runs from the repo root with --config lint/eslint.config.mjs, which makes
    the base path the cwd, so `files` patterns stay repo-relative.

    Step 5 asserts the POSITIVE CONTROL: lint/positive_control.ts holds a deliberate
    floating promise and MUST be flagged. It is what caught the inert linter last run.

    Nothing is wired into check:security. The full run is a survey, not a gate.

    This script does NOT commit and does NOT deploy.

    Usage:
        cd G:\PixelMania\PixelManiaServer
        .\setup_and_verify_eslint.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path ".\package.json")) {
    throw "Run this from the PixelManiaServer folder (package.json not found here)."
}
foreach ($f in @("lint\package.json", "lint\eslint.config.mjs", "lint\positive_control.ts", "tsconfig.eslint.json")) {
    if (-not (Test-Path $f)) { throw "Missing expected file: $f" }
}

$log = Join-Path (Get-Location) "eslint_findings.log"
if (Test-Path $log) { Remove-Item $log }

$tsBefore = (node -e "console.log(require('typescript').version)")
Write-Host ("Build TypeScript before: {0}" -f $tsBefore) -ForegroundColor DarkGray

Write-Host ""
Write-Host "=== 1/6  Undoing attempt 1 (root eslint deps + override) ===" -ForegroundColor Cyan
npm pkg delete "overrides.typescript-eslint" 2>&1 | Out-Null
npm pkg delete "overrides" 2>&1 | Out-Null
npm uninstall eslint typescript-eslint 2>&1 | Out-Null
if (Test-Path ".\eslint.config.mjs") {
    Remove-Item ".\eslint.config.mjs"
    Write-Host "  removed stray root eslint.config.mjs (superseded by lint/eslint.config.mjs)" -ForegroundColor DarkGray
}
Write-Host "  root package.json cleaned" -ForegroundColor DarkGray

Write-Host ""
Write-Host "=== 2/6  Installing the isolated toolchain in lint/ ===" -ForegroundColor Cyan
Push-Location lint
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "FAILED: npm install inside lint/" }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "=== 3/6  Verifying the two TypeScripts are separate ===" -ForegroundColor Cyan
$tsAfter = (node -e "console.log(require('typescript').version)")
Write-Host ("  root typescript (tsc, all builds):  {0}" -f $tsAfter)
if ($tsAfter -ne $tsBefore) {
    throw "ABORT: root typescript changed from $tsBefore to $tsAfter. Builds would be affected."
}

$lintTsPkg = "lint\node_modules\typescript\package.json"
if (-not (Test-Path $lintTsPkg)) { throw "lint/node_modules/typescript is missing -- the isolated install did not work." }
$lintTsVer = (Get-Content $lintTsPkg -Raw | ConvertFrom-Json).version
Write-Host ("  lint typescript (linter only):      {0}" -f $lintTsVer)

$hasApi = (node -e "console.log(typeof require('./lint/node_modules/typescript').createProgram)")
Write-Host ("  lint typescript createProgram:      {0}" -f $hasApi)
if ($hasApi -ne "function") {
    throw "ABORT: lint/node_modules/typescript@$lintTsVer still has no compiler API. typescript-eslint cannot work with it."
}
Write-Host "  build TypeScript unchanged; linter has a usable compiler API." -ForegroundColor Green

$eslintBin = "lint\node_modules\eslint\bin\eslint.js"
if (-not (Test-Path $eslintBin)) { throw "Missing $eslintBin" }

Write-Host ""
Write-Host "=== 4/6  ESLint + typescript-eslint versions in use ===" -ForegroundColor Cyan
Push-Location lint
try { npm ls eslint typescript-eslint typescript --depth=0 } finally { Pop-Location }

Write-Host ""
Write-Host "=== 5/6  POSITIVE CONTROL -- is the linter actually alive? ===" -ForegroundColor Cyan
$control = & node $eslintBin --config lint/eslint.config.mjs lint/positive_control.ts --format stylish 2>&1 | Out-String
Write-Host $control
if ($control -notmatch "no-floating-promises") {
    Write-Host ""
    Write-Host "POSITIVE CONTROL FAILED." -ForegroundColor Red
    Write-Host "lint/positive_control.ts contains a deliberate floating promise and was NOT flagged." -ForegroundColor Red
    Write-Host "The linter is inert -- any clean result on src/ would be meaningless." -ForegroundColor Red
    Write-Host "Do not commit this setup. Send me the output above." -ForegroundColor Yellow
    exit 1
}
Write-Host "Positive control flagged as expected. Type-aware linting is genuinely working." -ForegroundColor Green

Write-Host ""
Write-Host "=== 6/6  Survey across src/ (includes the 34k-line server.ts) ===" -ForegroundColor Cyan
Write-Host "     Findings are expected. This is a survey, not a gate." -ForegroundColor DarkGray
& node $eslintBin --config lint/eslint.config.mjs src --format stylish 2>&1 | Tee-Object -FilePath $log
$lintExit = $LASTEXITCODE

npm pkg set scripts.lint="node lint/node_modules/eslint/bin/eslint.js --config lint/eslint.config.mjs src lint/positive_control.ts"
Write-Host ""
Write-Host "Added npm script: lint" -ForegroundColor DarkGray
Write-Host "  (it lints the positive control too, so an inert linter fails loudly forever after)" -ForegroundColor DarkGray

$errs = @(Select-String -Path $log -Pattern "@typescript-eslint/")
Write-Host ""
Write-Host ("Total findings in src/: {0}" -f $errs.Count) -ForegroundColor Cyan

$byRule = @{}
foreach ($e in $errs) {
    if ($e.Line -match '(@typescript-eslint/[a-z-]+)') {
        $r = $Matches[1]
        if ($byRule.ContainsKey($r)) { $byRule[$r]++ } else { $byRule[$r] = 1 }
    }
}
if ($byRule.Count -gt 0) {
    Write-Host ""
    Write-Host "By rule:" -ForegroundColor Cyan
    $byRule.GetEnumerator() | Sort-Object Value -Descending | Format-Table Name, Value -AutoSize
}

Write-Host "Full output: eslint_findings.log" -ForegroundColor Yellow
Write-Host ""
Write-Host "Do NOT wire lint into check:security yet -- triage first. Some findings will be" -ForegroundColor Yellow
Write-Host "real dropped writes; others are intentional fire-and-forget that want an explicit void." -ForegroundColor Yellow
