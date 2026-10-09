# Inventory identity recovery — 1.2.20

The 2026-10-08 production audit covered 5,692 players, 1,057 nonempty
inventory/identity stacks and 222 tracked stacks. One Super World Lock stack
held 400 units but only 250 usable identities. The original admin grant (49055)
created all 400 identities. Startup snapshot reconciliation later retired 150
under a fixed 250-unit cap. One further identity from that grant was legitimately
placed; a later incoming item brought the count back to 400. That placed identity
was excluded from recovery.

Both snapshot reconciliation and non-strict ledger synchronization now use the
item's actual stack limit. This preserves all 400 identities across restart and
covers full legal grants. Verification-only snapshots remain unable to create or
retire identities.

`npm run audit:inventory-identities` reads every normalized inventory and active
owned identity using the authoritative item tracking policy. Only aggregate
results are printed. `--out` optionally saves a private detailed report on the
database host; do not export player-level reports to a workstation.

`scripts/restore_capped_inventory_identities.js` is an explicit operator recovery,
not an automatic gameplay fallback. Dry-run inputs are `--audit REPORT --out PLAN
--origin-transaction GRANT_ID`. Apply requires `--apply PLAN --expect-hash SHA
--reason TEXT`. `PIXELMANIA_REPAIR_ROOT` supports running the standalone script
against the active release. The original grant, owner, type, category, latest
retirement event, inventory count/version, active IDs and full retired rows must
still match the reviewed plan under player/inventory/identity locks. A later
gameplay event or partial change aborts recovery. It restores the same IDs, writes
per-instance events, admin action and transaction ledger in one transaction, and
never changes inventory counts or creates replacement IDs.

Production recovery:

- Verified private backup: `shared/backups/before-inventory-1220-1791505116523.dump`
  (62,199,851 bytes; pg_restore table-of-contents validation passed).
- Reviewed plan remained at `/tmp/inventory-cap-restore-1220.json` on the host.
- SHA-256: `3e8dad2a6ca8b9aab446d7958fdae53c8160b5a8d32a62ed54c12473089c06a9`.
- Request: `inventory-cap-restore-60798c86-a46f-48ba-a6f4-45b7c3184a7b`.
- Restored 150 original IDs, created zero, quantity before/after 400.
- Immediate repeat global audit: zero affected stacks or players.

Validation: full `check:security` and the real SQL/PGlite
`test:inventory-identities-postgres` and `test:drop-identities-postgres` passed.
The inventory suite checks 400-unit grants/restarts, unchanged original IDs,
audit failure rollback, stale plan/history rejection, repeat rejection and
verification-only snapshots. Set `QUEST_TEST_PGLITE_PATH` if PGlite is installed
outside this repository.
