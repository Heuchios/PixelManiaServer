# Threadlight Dispatch gameplay quests

2026-09-20 automatic daily journal update.

Daily quests now count server-accepted gameplay: planting seeds, splicing named trees, harvesting mature trees, breaking foreground blocks, and successful fish catches. Named targets use canonical item IDs; splice descriptions show the recipe. Story chapters retain their narrative and completion choices while using gameplay objectives. All four daily quests activate together when the board is first visited; after enrollment, gameplay continues to be recorded between daily resets even when every reward has been claimed. Play, then return or refresh to reconcile progress and claim each reward independently. Story quests still require acceptance. Progress is not a live HUD feed.

There are 24 commission templates and 24 story chapters. Two Easy quests and two Challenges are assigned automatically each day. There are no daily accept, abandon or reroll controls. All four can be completed, for 70 gems and 350 XP total, plus the optional story reward. Quick favors award 10 gems/50 XP, daily challenges 25 gems/125 XP, and story chapters 15 gems/75 XP. Five distinct completion days in the week award 100 extra XP. Daily reset remains 04:00 UTC; unclaimed daily quests expire at that reset and story chapters persist. Level-100 players receive no additional XP under the existing progression cap.

Existing active puzzle letters migrate to gameplay objectives with progress reset at migration. Completed story history, receipts, owned decorations and previously earned stamps survive. New quests award no stamps; old stamps can still purchase the existing account-bound panel decorations. Those decorations are not wearable inventory items or world pets.

## Authority and persistence

The additive quest_gameplay_events table records committed gameplay by player, action, item and unique event key. Inventory/world transactions insert events atomically with the action. Immature tree destruction and fishing junk are excluded. Foreground breaks use the persisted world change's authenticated actor. No client completion flag or puzzle answer can complete gameplay quests. Counts are capped at the objective target, from the daily reset for dailies and acceptance for stories. Same-day legacy accepted quests retain progress and their original entitlement IDs; previously completed tiers occupy the first slot to prevent duplicate payouts. Events currently have no retention job; add archival before long-term event growth becomes material.

Claims require an in-range quest board and reconcile events in the locked quest-account transaction. Canonical gems, XP columns and player-state snapshot, progression event, gem/transaction ledgers, unique receipt and story state commit together. Late failures roll back all rewards. Repeated requests and stale restored state cannot duplicate receipts. Existing inventory locks and session flushes apply. No JSON fallback exists when PostgreSQL is unavailable.

Sources: scripts/quest_gameplay_content.js overlays the authored narrative compiled by scripts/build_quest_content.js. npm run build:quests emits the runtime catalogue and quest modules. The server-entry and postgres-store builds include that dependency. Deploy from a clean commit with the matching client UI.

## Validation and remaining acceptance

The pure-engine suite exercises 30 reward days, 24 chapters, automatic assignment, all independent claims, daily resets, legacy migration, decorations, four weekly bonuses and duplicate protection. The isolated PGlite suite uses real foundation schema, migrations and PostgresStore inventory/ledger methods; it covers committed planting, all five objective types, named-item and pre-acceptance filtering, immature trees/junk, rollback and duplicate gem/XP claims. The foreground hook test isolates unrelated world audit writes. PGlite serializes requests; this is not a distributed locking test.

The real generated request-dispatcher test covers routing, board/reach/ban/lock validation and authoritative replies. The Godot UI test renders server fixtures and exercises tabs, active quests, narrow layouts, disabled incomplete buttons and the actual claim button callback. Daily quests use horizontal icon/objective/progress/reward rows with a reset countdown; story content lives in Storybook. Full security/build checks are required before staging activation.

A connected player acceptance pass remains necessary: open the board, perform each action in the world, reopen the board, claim, reconnect and verify gems/XP. No authenticated player session was used for automated checks. No production promotion is included. Larger outdoor NPC scenes, wearable quest cosmetics and live progress notifications remain future work.
