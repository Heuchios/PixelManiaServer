#!/usr/bin/env pwsh
# Commits the round-2 EQUIPMENT_PERSIST_DEBUG_LOGS diagnostic instrumentation in
# src/server_player_state_helpers.ts (see project memory
# equipment_unequip_on_world_rejoin.md) -- this is UNRELATED to the blocks-atlas-
# migration batch 4 commit and is being committed separately on purpose, so it
# doesn't get bundled into an unrelated feature commit. This was already sitting
# on disk (not written by this script) and was blocking deploy_staging.ps1's
# clean-tree gate.
#
# Runs check:server-player-state-helpers (build + its assertion gate) first, so
# a TypeScript error or a check-script mismatch blocks the commit instead of
# shipping something that fails later. Self-commits (stages itself) so it can't
# be left untracked and fail the next deploy's clean-tree check, the same class
# of failure this file's presence just caused for the batch-4 deploy attempt.
# Does NOT push or deploy.

$ErrorActionPreference = "Stop"
Set-Location "G:\PixelMania\PixelManiaServer"

function Fail($msg) {
    Write-Host $msg -ForegroundColor Red
    exit 1
}

Write-Host "== git status before staging ==" -ForegroundColor Cyan
git status --short

Write-Host "`n== check:server-player-state-helpers (build src/server_player_state_helpers.ts -> server_player_state_helpers.js, then run its build-gate assertions) ==" -ForegroundColor Yellow
npm run check:server-player-state-helpers
if ($LASTEXITCODE -ne 0) { Fail "check:server-player-state-helpers failed -- not committing. Fix the error above first." }

$selfName = Split-Path -Leaf $PSCommandPath

$files = @(
    "src/server_player_state_helpers.ts",
    "server_player_state_helpers.js",
    $selfName
)

Write-Host "`n== staging equipment-persist-debug-logs files ==" -ForegroundColor Cyan
git add -- $files

Write-Host "`n== staged diff ==" -ForegroundColor Cyan
git diff --cached

$commitMessage = @"
Add EQUIPMENT_PERSIST_DEBUG_LOGS instrumentation (round 2)

Diagnostic-only change for the eyewear/hair/shoes-unequip-on-rejoin
investigation (see project memory equipment_unequip_on_world_rejoin.md).
Not a fix -- round 1 and round 2 both exhaustively ruled out any
slot-specific code asymmetry between hair/eyewear/shoes and the
unaffected back/hat/shirt/pants/ride slots on both client and server.
Root cause is still not identified.

doesStateOwnEquippedItem() -- the single choke point every server-side
equip-ownership check funnels through -- now logs EVERY call for
hair/eyewear/shoes (both PASS and FAIL, round 1 only logged failures),
tagged "ownership check PASSED" / "ownership check FAILED -- clearing
equip field", including countFound, slotAllowed, inventoryField,
inventoryDictSize, and rawDictEntry (distinguishes *key absent* from
*key present with count 0*, since sanitizeCountDictionary() keeps
zero-count keys).

Entirely gated behind EQUIPMENT_PERSIST_DEBUG_LOGS=1 (checked once at
module load via a boolean env parse) -- a no-op with zero behavioural
or performance impact when unset, matching how the rest of this
codebase's temporary diagnostic flags are gated. No validation logic,
timers, or client-side re-equip behavior was touched, per Hassan's
explicit brief for this investigation (no speculative changes before
the failure point is identified).

Verified via check:server-player-state-helpers (build + its own
build-gate assertions) -- clean.
"@

Write-Host "`n== creating commit ==" -ForegroundColor Cyan
git commit -m $commitMessage

Write-Host "`n== git log (last commit) ==" -ForegroundColor Cyan
git log -1 --stat

Write-Host "`nDone. This commit was NOT pushed or deployed." -ForegroundColor Yellow
