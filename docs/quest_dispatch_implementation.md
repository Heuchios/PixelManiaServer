# Threadlight Dispatch — implementation status

Date: 2026-09-19. Local implementation; not deployed or tested in a connected multiplayer session.

## Playable locally with the matching backend

The existing `quest_board` block opens the native Godot Dispatch panel through the existing wrench interaction. Visitors may read public boards without build permission. The backend checks authentication, world ban, world identity, board existence and interaction reach. Client movement/gameplay input is blocked while the panel is open. Escape, the close button and changing worlds close it.

The panel has Today, Storybook and Rewards tabs, six original character portraits, persistent progress, clues, free hints, three puzzle interactions (ordering, matching, a 5×5 work mat), completion choices and later story callbacks.

The runtime catalogue contains 24 commissions with three configurations each and 24 sequential story chapters across six arcs. Ordering/matching configurations currently change presentation; construction configurations mirror the mat. They are not 72 completely different adventures.

Daily entitlements reset at 04:00 UTC. A Favor awards 10 gems / 3 stamps, a Trip 25 / 5 and a Story 15 / 4. Completing quests on five distinct days in a Monday-based week awards 8 additional stamps. Commission letters last until the second reset after acceptance. Story letters persist indefinitely. Carryover consumes its original daily entitlement, so completing carryover plus today's letters can exceed 50 gems on the calendar day without duplicating an entitlement.

Two offers per commission tier, one free replacement per tier, a three-day offer cooldown with fallback for depleted content pools, one active letter per tier, and a commission encore after chapter 24 are implemented. No paid refreshes, streak losses, inventory ingredient costs or tradable stamps.

Nine stamp purchases unlock account-bound **Dispatch decorations**. Their native pixel motifs appear in reward previews and the header; the paper moth companion animates inside the panel. These are not wearable, placeable or world-following inventory items.

## Persistence and integrity

`src/server_quest_engine.ts` is a pure state transition module. Clients cannot supply reward amounts, timestamps, content, solutions or completion flags. The server stores the accepted content snapshot and verifies clue reads and puzzle answers. Revision checks reject stale mutations.

`src/server_quest_store.ts` saves JSONB progress in `quest_accounts`, with the account row locked during mutations. Unique `quest_receipts` enforce one durable grant per entitlement and purchase. Canonical inventory gems, item transaction, gem ledger, transaction ledger, inventory hash, stamps and story state commit in one PostgreSQL transaction. Capacity/database failure rolls everything back. Database unavailability disables the feature rather than falling back to local JSON. Server requests use existing inventory locks and session-persistence flushing. Valuable failed completions/redemptions enter the failed transaction audit.

Schema migration adds only `quest_accounts`, `quest_receipts` and its time index. Both reference existing player IDs. Rewards must not be rolled back by deleting only quest state: permanent receipts intentionally block regranting rewards from a stale restored state.

Build source is `data/quests/dispatch_authoring.json` plus `scripts/build_quest_content.js`. The compiler emits `data/quests/dispatch.json`. `build:quests` emits the two root runtime modules. Server-entry and PostgreSQL-store builds include that build dependency. Ship runtime modules and the compiled catalogue together. Deployment packaging uses a Git commit; untracked/uncommitted files are not a release.

## Differences from the larger design — still outstanding

This is the first board-contained playable implementation, not completion of the entire earlier design package.

- No public Dispatch Yard or dedicated outdoor scenes/NPC encounters yet.
- No hooks into world building, fishing, gardening, exploration or machine events. “Field Trip” currently denotes its reward tier; the activity still takes place on the board's work mat.
- The proposed wearable satchel/pin/outfit, placeable lantern and following world pet have not been implemented. Current rewards are explicitly labelled panel decorations.
- The scrapbook records choices, replies, postcards and arc emblems as text. Illustrated postcard assets and interactive chapter replay are still outstanding.
- The broader seven-day completion-recency weighting, distinct authored alternate adventures, feature-specific operator dashboard, telemetry and staged rollout controls remain outstanding.
- No production deployment, live-server multi-instance concurrency test or connected multiplayer acceptance pass has been performed.

## Verification performed

1. `npm run test:quests`: simulated 30 reward days, all 24 chapters, 1,500 gems, 392 stamps, four weekly bonuses; wrong answers, premature claims, duplicate claims, daily caps, hints, JSON persistence, carryover, long story absences, reset boundaries and cosmetic ownership.
2. `npm run test:quests:postgres`: isolated PGlite PostgreSQL engine, complete game foundation schema plus real runtime migrations and real PostgresStore ledger/hash methods. Checked rollback after an injected late save failure, receipt/gem/ledger consistency, four concurrent duplicate requests, unique-receipt protection after stale state restoration, account isolation and fail-closed readiness. PGlite serializes transactions; this is not a distributed locking load test. [Runtime API](https://pglite.dev/docs/api).
3. `node scripts/test_quest_route.js`: real generated request-handler function with controlled dependencies; checks board existence, reach, ban, lock failure, post-await revalidation and `player_data`/quest reply shape.
4. Godot `tests/quest_board_ui_test.gd`: parse all changed gameplay scripts; instantiate scene; load server fixtures; render all tabs, active quests and full story archive; close/reopen; resize to 640×360; desktop screenshot rendered with OpenGL.
5. TypeScript checks, ESLint (one existing unrelated warning), gem-ledger, transaction-ledger, server-validation and anti-dupe checks passed. Existing wiring checks are supplementary, not quest-specific behavioral proof.
6. Dedicated server-entry and PostgreSQL-store generated-build checks passed. The broader `check:tsconfig-projects` audit still fails on pre-existing runtime-only imports throughout `src/server.ts` and other modules versus its stale pinned import list. The new quest module uses a typed import and is registered with the guard; the remaining repository-wide drift is not treated as a passing check.

For SQL tests install `@electric-sql/pglite` in an isolated tools directory and set `QUEST_TEST_PGLITE_PATH` to that package's absolute directory, then run `npm run test:quests:postgres`. It reads no `.env` and contacts no live database. UI fixtures are generated by `npm run test:quests`; run the Godot test from the sibling client repository. On this Windows machine APPDATA/LOCALAPPDATA were redirected to `D:/Pixelmania/quest-runtime` for testing. Godot reported a host certificate-store warning; no test account was authenticated.

## Connected acceptance before release

Run matching backend/client in staging. Place an actual Quest Board; use the wrench from in range and out of range, including a locked world visitor. Complete a letter, confirm visible gem balance and ledger receipt, reconnect, then verify progress and stamps. Check reset/carryover with a controlled server clock, concurrent sessions, mobile touch and world transfer. Verify old clients remain compatible. Confirm migration readiness on every serving instance. Deploy only after these pass.
