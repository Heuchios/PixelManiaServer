# Ops player evidence

The **Players** tab lists all registered accounts, including offline, disabled and not-yet-played accounts. Search accepts username, display name, account UUID or player UUID. It uses the existing authenticated ops session/token boundary. It does not change gameplay data or issue punishments.

## Available evidence

- Profiles read committed PostgreSQL inventory, gems, role, level, last login/world/save and inventory hashes in repeatable-read, read-only transactions.
- Worlds includes ownership, memberships and world-lock access, rather than treating visits as ownership.
- Punishments includes active, scheduled, expired and revoked entries; admin actions and rollbacks add context.
- Transaction, item-balance and gem ledgers retain IDs, quantities, before/after evidence and correlations. Block/object journals show recorded world changes.
- Instances includes all states associated with a player. Public `PM-ITEM-*` identifiers open retained lifecycle events and linked ledger rows across owners. Batch transactions may involve other items.
- Pagination exposes `has_more`. Numbered history pages retain an initial maximum record ID so inserts do not shift later pages. Current-state lists and combined security flags are fresh snapshots per page.

## Flags and coverage

Checks compare tracked inventory with active instances, inventory hashes, latest item/gem after-balances and impossible instance state/location combinations. Historical flags include high/critical security events, duplication/integrity events and failed item-integrity transactions. Ledger hashes are verified on returned pages before redaction.

An inconsistency, blocked attempt or missing hash is a reason to investigate, not proof of deliberate duplication. No automatic punishments are issued. These checks do not prove the absence of every duplication technique. Committed-state lag and historical gaps are identified in the UI. Unrecorded/deleted historical actions cannot be reconstructed. A successful page is not a full historical database scan.

## Access receipts and exports

`ops_player_access_audit` is an additive PostgreSQL table. Every authorized lookup appends a requested event and a success/failure event with operator, session fingerprint, remote address, target, filters and request UUID. Success binds the response SHA-256 and capture time. Evidence is not returned unless both database reads and durable logging succeed. Pool size, concurrency and query duration are bounded.

Writes serialize with a PostgreSQL advisory transaction lock. Receipts hash the previous hash plus the event using JSON with recursively sorted object keys, preserved array order and ISO dates. Application code only inserts receipts; a database owner can still alter the database. This is tamper-evident evidence, not immutable external notarization.

**Export this evidence** includes the selected profile and current evidence page, receipts and explicit scope. Follow pagination for remaining records. Verify content with:

```text
node scripts/verify_ops_player_evidence.js exported-evidence.json
```

Compare request/receipt IDs against retained database access logs to establish provenance. Passwords, salts, tokens, authentication secrets and account-state blobs are excluded/redacted. Redacted exports cannot independently recompute transaction hashes containing excluded fields; `hash_verification` records the server check before redaction.

## Validation

```powershell
node scripts/check_ops_player_http.js
$env:OPS_TEST_PGLITE_PATH = 'path/to/installed/@electric-sql/pglite'
node scripts/check_ops_player_audit.js
```

The PostgreSQL/WASM suite uses isolated fixtures without loading `.env`. It covers all sections, literal search/injection input, pagination, disabled/new accounts, counterparties, instances, hashes, discrepancies, redaction, receipt chains, audit failure denial and preservation of game data. `--serve` exposes fixture UI on `127.0.0.1:19094`. HTTP tests launch the actual server with isolated configuration to check auth, rejected mutations and database failure.

## Ops-only rollout

Dashboard artifacts live in `shared/ops-releases/<release-id>`, with dependencies/contracts/item definitions linked from the active backend, and `.env`/admin account in shared storage. `shared/ops-current` selects the artifact. `shared/ecosystem.ops-active.config.cjs` starts it with the active game release as working directory. Replace/save only `pixelmania-ops`; game processes and the backend `current` pointer stay intact. Preserve this override until a backend release containing these source changes is activated.

To roll back, restore the previous ops pointer and restart only `pixelmania-ops`. Retain the additive access-audit table and include it in normal PostgreSQL backups.
