# Backend Persistence Rules

## World Change Journal

World state persistence must keep an auditable World Change Journal for block and object mutations.

- Block tile changes are recorded in `world_block_changes` with before/after block values.
- Interactive object changes are recorded in `world_object_changes` with `old_data` and `new_data` snapshots.
- Any path that mutates a persisted world object should send the same journal entry through the world commit path that saves the world state.

## Server-Side Validation

Server-side validation is authoritative for world edits, inventory costs, storage access, trades, vending, drops, seeds, admin actions, cooldowns, and live action locks.

## Account / Session Security

Account and session persistence must keep password algorithm metadata, refresh-token rotation, login-attempt audit rows, admin 2FA gates, and developer/admin command confirmation wired through `check:account-security`.

## Admin Action Logs

Admin Action Logs must preserve actor identity, session/network context, target, affected item/world, amount, reason, and before/after evidence for developer commands, moderation, lookups, and item-instance actions.

## Bot / Rate-Limit Protection

Bot / Rate-Limit Protection must stay wired through broad message limits, action-specific limits, Redis-backed buckets when available, local fallback buckets, visible client rejections, and security-event logging.

## Monitoring Dashboard

Monitoring Dashboard data must stay admin/PIN gated and audited, with loop health, economy, suspicious account, duplicate warning, and integrity audit signals served through the guarded developer panel path.

## Anti-Dupe Transaction Locking

Inventory, drop pickup, trade, vending, storage, and world mutations must hold the relevant live locks before changing durable state. Do not bypass these locks for convenience.

## Transaction Ledger

Permanent audit data belongs in Postgres. item transactions and gem ledger rows must be written for valuable movements including trade, shop, vending, pickup, crafting, fishing, and admin actions.

## Gem Ledger

Every gem balance change must write an explainable `gem_ledger` row. Gems must not be changed silently.

## Item Instances

Valuable, rare, equipment, locks, tools, and other tracked items must keep a stable `PM-ITEM-*` public ID. Create or move the specific item instance instead of minting vague inventory counts.

## Rollback System

Rollback jobs live in `rollback_jobs`; rollback corrections must carry `admin_corrected` metadata when an admin applies a correction.

## Integrity Hashes

Integrity Hashes protect inventory, transaction, and world snapshot evidence from silent drift.
