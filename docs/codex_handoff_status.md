# Codex Handoff Status

## World Change Journal

The backend has a World Change Journal split between block and object entries.

- `world_block_changes` stores tile-level block changes.
- `world_object_changes` stores interactive object changes with old/new JSON snapshots.
- Keep world-object mutation paths wired through the journal when editing world persistence, inventory-deferred world commits, vending, safe, display, doors, locks, and event object changes.

## Server-Side Validation

`check:server-validation` covers the current server-side validation policy for block/place/break, inventory, storage, trade, vending, drops, seeds, admin actions, cooldowns, and locks.

## Account / Session Security

`check:account-security` covers password algorithm metadata, refresh-token rotation, login-attempt audit rows, admin 2FA, developer PIN, admin confirmation, cooldown, and audit wiring.

## Admin Action Logs

`check:admin-actions` covers actor/session/network context, target, affected item/world, amount, reason, and before/after evidence for developer/admin commands, moderation, lookups, and item-instance actions.

## Bot / Rate-Limit Protection

`check:bot-rate-limits` covers broad message limits, action-specific bot limits, Redis/local fallback buckets, visible client rejections, and security-event logging.

## Monitoring dashboard

`check:monitoring-dashboard` covers admin/PIN-gated runtime, economy, suspicious account, duplicate warning, integrity audit, and developer panel monitoring status.

## Anti-Dupe Transaction Locking

Anti-Dupe Transaction Locking is wired through live action locks, inventory locks, Postgres transactions, and deployment checks.

## Gem Ledger

Gem ledger coverage includes trade gem sends/receives and drop pickup gem rewards, plus shop, station, fishing, fish monger, admin, and rollback-related gem movements.

## Rollback System

Rollback System status: `rollback:apply` is the guarded apply path, and admin corrections must preserve `admin_corrected` evidence.

## Integrity Hashes

Integrity hashes are wired for transaction, inventory, and world snapshot evidence.
