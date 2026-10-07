# World name reservations and original payment receipts

Implementation is behind `WORLD_NAME_CLAIMS_ENABLED=true`. It is off by default;
local implementation/testing does not activate claims or start production deadlines.

## Player behavior

- Lock placement secures world ownership and automatically reserves its current
  name for seven days. This prevents an owner from keeping a desirable name
  indefinitely by never pressing Reserve. Reservation is free; claim payment is
  a single gem debit at the frozen rarity price.
- The World Lock window displays the quoted price, UTC deadline, claim status,
  and **Original claim paid**. Visitors can read the same server receipt. Paying
  requires an explicit confirmation. This is the original claim fee, not a resale
  price or an estimate of market value.
- Payment permanently claims the name. A transfer retains its original receipt.
  Separate optional account-wide taxes are described in `world-taxes.md`; they
  never remove a permanently claimed name.
- Unpaid expiry changes only the public name to its original name plus 1–3 random
  digits (for example `ABC7`, `ABC42`, or `ABC315`). All occupied names are skipped,
  trying one-digit suffixes first, then two and three. Names at the 32-character
  limit are shortened only enough to fit the suffix. If all 1,000 suffixes are
  occupied, expiry retries later; payment remains blocked and no name is stolen. The
  world row, terrain seed/routing identity, snapshots, contents, and ownership
  stay intact. The former public name can identify a fresh world. Owned Worlds
  lists the original owner's new public name.
- A generated-name world can reserve an unused public name in its lock window.
  Search shows a server-verified claim price and availability without reserving
  anything. Owners confirm a free seven-day reservation after searching; the
  server rechecks the quoted price, availability and cooldown before renaming the
  same world. Editing the search clears the previous quote. Permanently claimed
  worlds hide search controls, and the server rejects searches from those worlds.
  Expiry after a replacement reservation uses that replacement name plus digits.
  Exact, case-insensitive rarity pricing is in `src/world_name_pricing.ts`.
- Breaking/replacing the lock never clears ownership or resets the deadline.
  The owner can place a replacement physical lock; other players cannot take
  ownership by placing one. World-lock inactivity decay is disabled while this
  permanent-ownership system is active. Area-lock decay is unchanged.
- Each newly locked world keeps its entered public name for seven days, even if
  its owner already has other pending names. After an unpaid expiry, that account
  cannot reserve that same name for seven more days. Unpaid names cannot be
  transferred by issuing or trading World Lock Keys.
- Existing owned worlds all receive the same seven-day deadline at initial
  activation, even if an owner has multiple worlds. Restarting does not extend it.
- START, LANDFILL, and event-instance names remain system-controlled. Premium
  price inclusion does not make an official/system name available for purchase.

These controls discourage unpaid blocking, not all hoarding. Multiple accounts
can evade account-level cooldowns, and paid claims are permanent regardless of how
many names an account already owns.

## Persistence and protocol

`world_name_registry` maps public names to stable `worlds.world_id` rows. The
existing `worlds.world_name` remains an internal routing/storage identity. Do not
rename it when a reservation expires; name-derived terrain and in-flight writes
must continue to refer to the original world.

`world_name_claim_receipts` has one immutable-by-application receipt per world.
No settings, world snapshot, transfer, or reprice operation overwrites its
`paid_gems`. Claim validation locks the registry row inside the existing gem
inventory transaction. Debit, gem ledger, transaction ledger, and receipt commit
or roll back together. A duplicate payment cannot create a second receipt.

Directory mutations use a PostgreSQL transaction-scoped advisory lock and a
unique public-name constraint. Ownership and quotes survive server restarts.
Database timestamps govern expiry. The five-second sweep is only background
cleanup: name resolution and claim validation also enforce expiry on demand.

Client inventory actions are `world_name_status`, `world_name_search`, `world_name_reserve`, and
`world_name_claim`. Claim sends the name and price the user confirmed; the server
checks these against the stored quote, never uses them as the authority.
`world_name_redirect` changes the client's routing identity before the join
acknowledgment. `world_name_status` updates the displayed public name/receipt.
Reconnects use explicit `world_identity`; a fresh user-entered name always resolves
the public namespace, including a recycled name previously visited by that client.
World lists publish aliases and doors resolve public destinations.

## Activation

1. Build and ship the matching client for all supported platforms. It advertises
   `world_name_claims_v1`; outdated clients receive an update-required join rejection.
2. Back up PostgreSQL and validate the feature on an isolated staging database,
   including two backend shards, reconnects, trading, and event entry.
3. Enable `WORLD_NAME_CLAIMS_ENABLED=true` on **every** backend shard together.
   On the first successful startup transaction, all existing names are migrated
   and their seven-day deadlines begin. Owners with unresolved legacy account
   identities block migration rather than silently lose protection.
4. Keep the flag on after activation. Startup fails closed if the database has
   activated claims but a shard's flag is off. A rollback needs an explicit
   name-directory migration, not merely an older server binary or changed flag.

No production deployment or activation is performed by the local tests.

## Verification

`npm run check:world-name-pricing` covers all 2,010 premium names and input rules.
`npm run test:world-name-postgres` uses an isolated PGlite PostgreSQL database
(set `WORLD_NAME_TEST_PGLITE_PATH` to its installed package directory). It exercises
real store migrations, inventory/ledger SQL, rollback, duplicate claims, ownership,
frozen deadlines, transfer receipts, multiple pending names, numeric expiry suffixes,
collision avoidance, cooldowns and alias reuse. Search tests cover availability,
system/invalid names, price changes, names taken after a search, replacement
reservations and their subsequent expiry.
PGlite serializes concurrent transactions; a real multi-process PostgreSQL/Redis
staging check is still required before rollout.

Client tests: `tests/world_name_claim_ui_test.gd` (desktop/mobile receipt and
payment states), `tests/world_lock_layout_test.gd`, `tests/world_name_alias_test.gd`,
`tests/world_name_ownership_test.gd`, and `tests/world_loading_operation_id_test.gd`.

Local verification limitations: the existing `world_join_state_lifecycle_test.gd`
fails at line 164 because it expects a 0.34-second reveal fade while the unchanged
loading manager uses 0.08. Fish-market build ownership is now registered, but the
standalone TypeScript project registry check still reports pre-existing runtime
require boundaries that disagree with its typed-import ledger. This is outside
the standard deployment gate and has not been weakened to accept those boundaries.
Godot emits a local root-certificate-store warning during headless tests.
