# Threadlight Dispatch gameplay quests

2026-09-28 global daily journal update.

The two Easy quests and two Challenges are now identical for every player on the same reset day, across accounts and servers. Selection uses a shared date seed and catalogue; account identity and personal history do not affect it. The reset remains 04:00 UTC. Story progression, daily progress, claims and rewards remain individual.

Previously saved personal boards migrate on the next board request, including today. Claimed slots and their receipt IDs stay claimed, preventing an extra payout when the selected quest changes. Unclaimed objectives are reconciled from that player's committed gameplay since the daily reset. Matching active quests retain their state; replaced quests never inherit progress for unrelated objectives. Migration advances the board revision so an old open board cannot claim a changed assignment without refreshing.

Daily quests now count server-accepted gameplay: planting seeds, splicing named trees, harvesting mature trees, breaking foreground blocks, and successful fish catches. Named targets use canonical item IDs; splice descriptions show the recipe. Story chapters retain their narrative and completion choices while using gameplay objectives. All four daily quests activate together when the board is first visited; after enrollment, gameplay continues to be recorded between daily resets even when every reward has been claimed. Play, then return or refresh to reconcile progress and claim each reward independently. Story quests still require acceptance. Progress is not a live HUD feed.

There are 24 commission templates and 24 story chapters. Two Easy quests and two Challenges are assigned automatically each day. There are no daily accept, abandon or reroll controls. Daily reset remains 04:00 UTC; unclaimed daily quests expire at that reset and story chapters persist. Level-100 players receive no additional XP under the existing progression cap.

## Weekly gem rewards (content version 4, 2026-10-12)

All 28 daily quests in a Monday-Sunday quest week pay exactly **5,000 gems**, plus a **1,000-gem completion bonus** on the final claim. Easy quests pay 100 gems each. Challenges pay 250 gems each Monday-Saturday and 300 each Sunday: six 700-gem days plus one 800-gem day. The week resets Monday at 04:00 UTC. Daily XP stays at 500; full completion also pays the existing 100 weekly XP. Optional story rewards remain 15 gems/75 XP and do not count toward daily-week completion.

Weekly eligibility is derived from all four claimed slots on each of seven days. One claim per day, story activity, old visit counters, skipped days and client-supplied completion fields cannot unlock the bonus. The final daily reward and bonus share the existing locked PostgreSQL transaction with the gem ledger, transaction ledger, receipts and quest state. A unique `week_complete:<week>` receipt prevents repeat payouts even after stale state restoration. The old `week:<week>` XP receipt does not block the new gems; its saved paid flag prevents paying the old XP twice.

Existing unclaimed quests adopt the reward rebalance without resetting earned progress, IDs or acceptance windows. Already claimed quests remain claimed and are not retroactively topped up; the advertised 5,000-gem base total applies to a full week under the new schedule. The journal reads weekly amounts, claimed-quest progress and bonus status from the server.

## Daily pacing rebalance (content version 3)

The full set targets roughly 30–45 minutes of normal gameplay: 5–7 minutes per Easy quest and 10–15 minutes per Challenge. These are initial design estimates, not measured player timings or a minimum-time claim gate. Stockpiled seeds, prepared farms, tools, travel and simultaneous planting/harvesting can change actual completion time. Validate pacing with player sessions before further tuning.

| Activity | Easy target | Challenge target |
| --- | ---: | ---: |
| Plant seeds | 120 | 300 |
| Harvest mature trees | 90 | 225 |
| Break foreground blocks | 240 | 600 |
| Catch fish | 12 | 30 |
| Splice named trees | 30 | 75 |

Named-item restrictions remain unchanged. The selection favors four distinct activities, so two quests do not finish from the same action stream. The initial target calibration assumes sustained effective rates of 20 plants, 15 harvests, 40 breaks, 2 catches or 5 splices per minute, including routine preparation; that gives a 42-minute nominal set. This assumption needs playtesting and is not a benchmark of maximum action speed.

`data/quests/balance.json` supplies both compiled catalogue rewards and authoritative claim rewards. Existing unclaimed dailies migrate when the board is read, retaining instance IDs and progress; the PostgreSQL adapter recounts committed gameplay since reset against the higher targets. Old solved flags are recalculated, board revisions invalidate stale claim requests, and completed slots stay claimed. Version 3 left story instances and weekly rewards unchanged; version 4 adds the weekly gem schedule above.

Existing active puzzle letters migrate to gameplay objectives with progress reset at migration. Completed story history, receipts, owned decorations and previously earned stamps survive. New quests award no stamps; old stamps can still purchase the existing account-bound panel decorations. Those decorations are not wearable inventory items or world pets.

## Authority and persistence

The additive quest_gameplay_events table records committed gameplay by player, action, item and unique event key. Inventory/world transactions insert events atomically with the action. Immature tree destruction and fishing junk are excluded. Foreground breaks use the persisted world change's authenticated actor. No client completion flag or puzzle answer can complete gameplay quests. Counts are capped at the objective target, from the daily reset for dailies and acceptance for stories. Legacy entitlement IDs survive the global selection migration; previously completed tiers occupy the first slot to prevent duplicate payouts. Events currently have no retention job; add archival before long-term event growth becomes material.

Claims require an in-range quest board and reconcile events in the locked quest-account transaction. Canonical gems, XP columns and player-state snapshot, progression event, gem/transaction ledgers, unique receipt and story state commit together. Late failures roll back all rewards. Repeated requests and stale restored state cannot duplicate receipts. Existing inventory locks and session flushes apply. No JSON fallback exists when PostgreSQL is unavailable.

Sources: scripts/quest_gameplay_content.js overlays the authored narrative compiled by scripts/build_quest_content.js. npm run build:quests emits the runtime catalogue and quest modules. The server-entry and postgres-store builds include that dependency. Deploy from a clean commit with the matching client UI.

## Validation and remaining acceptance

The pure-engine suite exercises 30 reward days, 24 chapters, automatic assignment, all independent claims, daily resets, legacy migration, decorations, four weekly bonuses and duplicate protection. Weekly regressions verify exactly 5,000 + 1,000 gems, one missing slot, incomplete days, story exclusion, old visit counters, Sunday reward display and Monday reset. The isolated PGlite suite uses real foundation schema, migrations and PostgresStore inventory/ledger methods; it covers committed planting, all five objective types, named-item and pre-acceptance filtering, immature trees/junk, rollback and duplicate gem/XP claims. A complete week commits exactly 6,000 gems; an injected final-save failure rolls back the bonus, and the permanent weekly receipt independently blocks a restored-state regrant. The foreground hook test isolates unrelated world audit writes. PGlite serializes requests; this is not a distributed locking test.

The real generated request-dispatcher test covers routing, board/reach/ban/lock validation and authoritative replies. The Godot UI test renders server fixtures and exercises tabs, active quests, narrow layouts, disabled incomplete buttons and the actual claim button callback. Daily quests use horizontal icon/objective/progress/reward rows with a reset countdown; story content lives in Storybook. Full security/build checks are required before staging activation.

A connected player acceptance pass remains necessary: open the board, perform each action in the world, reopen the board, claim, reconnect and verify gems/XP. No authenticated player session was used for automated checks. No production promotion is included. Larger outdoor NPC scenes, wearable quest cosmetics and live progress notifications remain future work.
