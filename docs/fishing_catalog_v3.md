# Fishing lineup, material atlas rows 5–6

Five usable baits replace the previous lures. Lure Pack remains a package, with
five rolls at its existing shop price. Packs and tackle boxes use these weights:

| Bait | Atlas cell | Pack chance | Common / uncommon / rare / epic / legendary catches |
|---|---|---|---|
| Bait | 0,5 | 60% | 80 / 16 / 3 / 0.9 / 0.1% |
| Worm Bait | 1,5 | 18% | 30 / 61 / 8 / 0.9 / 0.1% |
| Shiny Worm Bait | 2,5 | 16% | 20 / 30 / 45 / 4.9 / 0.1% |
| Minnow Bait | 3,5 | 5.5% | 10 / 20 / 30 / 35 / 5% |
| Shrimp Bait | 4,5 | 0.5% | 10 / 15 / 20 / 20 / 35% |

Species share their rarity's catch weight evenly, allowing for integer rounding.
The Neptune Rod keeps its separate Golden Statue reward. Fish retain 0.1–150 kg
catch weights, integer tenths of a kilogram in inventory, 2000 kg stack limits,
and the existing supply-based market pricing. Each species inherits a comparable
previous species' difficulty and market policy.

| Fish | Atlas cell | Rarity |
|---|---|---|
| Guppy | 0,6 | Common |
| Goldfish | 1,6 | Common |
| Blue Tang | 2,6 | Rare |
| Bass | 3,6 | Uncommon |
| Catfish | 4,6 | Common |
| Red Snapper | 5,6 | Rare |
| Minnow | 6,6 | Common |
| Bluegill | 7,6 | Uncommon |
| Mudfish | 8,6 | Uncommon |
| Clownfish | 9,6 | Rare |
| Tuna | 10,6 | Epic |
| Salmon | 11,6 | Epic |
| Swordfish | 12,6 | Legendary |

## Save transition

The user requested removal, not conversion, of existing fish/lure holdings.
Version 3 runs once under the fish-schema PostgreSQL transaction/advisory lock.
It removes the old inventory rows, retires item instances, clears current world
containers/displays/drops, clears old market rows, and updates inventory hashes.
Item transactions, transaction ledger rows, instance events and world journals
record the change; historical audit records are retained. Bluegill retains its
ID, so old Bluegill holdings are removed only during the initial migration.
Lure Packs remain and award the new baits.

Player-state and local-save sanitizers retain a catalog version marker so newly
caught Bluegill survives future loads. Retired journal entries are cleared while
lifetime catch totals and fishing XP remain. The personal profile exposes a
Fish Journal button alongside Recipe Book and My Worlds.

Checks: `npm run check:fishing-catalog`, client `tests/run_fishing_tests.ps1`,
`tests/profile_fishing_journal_test.gd`, and `tests/fish_kilograms_test.gd`.
`scripts/test_fishing_catalog_postgres.js` also runs the actual migration SQL in
an isolated PGlite PostgreSQL engine, covering rollback, inventory, item instances,
world drops, terrain preservation, audit rows and restart idempotency. Set
`FISHING_TEST_PGLITE_PATH` when the test runtime lives outside node_modules.
Back up staging before rollout. Client and server must ship together.
