# World drop identity audit and recovery

The October 8, 2026 production audit covered all 5,596 active drops in 95 worlds
(220 saved worlds were inspected). Seventy-eight active drops required tracked
identities. After the separately approved recovery of 50 old FISHING snow drops,
two mismatches remained: one Serpent Staff in FISHING and one in BUYSEED. Both
had only world-state mirror metadata, no claimable identities, and no references
in global item identity, identity-event, item-transaction or transaction-ledger
history. Both were recovered under the user's global repair request. A fresh
audit found zero mismatches. No quantities, positions or player holdings changed.

The old harvest handler persisted visible rewards through a world snapshot but
omitted explicit drop changes, so PostgreSQL did not create their identities or
record origin metadata. The October 6 harvest fix (`f727ec1`) closes that source
for new ordinary and mutated-tree rewards; it cannot reconstruct provenance for
old drops. Serpent Staff is a mutated-tree reward. The missing historical journal
means the exact originating action for each legacy drop cannot be proven.

This release also fixes repair of a partially collected stack: rebuild the full
outstanding quantity once, then transfer those identities on subsequent pickups.
Pickup recovery searches identities and historical events across every world and
owner so moving, consuming or redropping an item cannot make it eligible for minting
again. Explicit reward item types take precedence over source block types when
creating identities.

## Read-only audit

From the configured backend release, run `npm run audit:world-drop-identities`.
It uses a repeatable-read, read-only PostgreSQL transaction and the gameplay item
tracking policy. Exit code 2 means mismatches exist. Output is aggregate world/item
counts, not player account details. This command never repairs data automatically.

## Reviewed legacy recovery

`scripts/repair_legacy_drop_identities.js` produces a hashed plan with
`--world WORLD --item ITEM --before ISO_DATE --out PLAN.json`. Inspect the plan and
excluded evidence on the database host. Take and verify a database backup, then
apply the exact plan with `--apply PLAN.json --expect-hash SHA256 --reason TEXT`.
The operation rechecks the plan and all references under world/drop row locks,
creates exactly the missing identities, and writes admin and transaction-ledger
records in the same transaction. Any state change, evidence or audit failure
aborts the whole operation. Unknown origin is recorded as unknown, never replaced
with fabricated server provenance. Do not infer origin from a `server_` ID.

The staff recovery backup is
`shared/backups/before-staff-repair-1791502655200.dump` (62,173,018 bytes,
verified with `pg_restore --list`). Recovery request IDs:

- FISHING: `legacy-drop-repair-f133d76e-1eac-4186-b603-b7b674a64c7b`
- BUYSEED: `legacy-drop-repair-7d028170-c218-4bd7-a790-bffd7c418549`

## Regression checks

`npm run check:security` includes 19 pickup invariants and the shipped harvest
handler's normal/mutated reward, race, failed-commit and rollback tests.
`npm run test:drop-identities-postgres` additionally runs real PostgreSQL SQL in
PGlite: snapshot mirroring, reward identities, partial pickup conservation,
cross-world/history anti-duplication, recovery audits, stale/repeated plan refusal,
and atomic rollback. Like the other optional PostgreSQL integration checks, set
`QUEST_TEST_PGLITE_PATH` to the installed `@electric-sql/pglite` runtime if it is
not installed in the backend's node_modules.
