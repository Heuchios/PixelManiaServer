#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PostgresContracts = require("../postgres_store_contracts");

const repoRoot = path.join(__dirname, "..");
const postgresSource = fs.readFileSync(path.join(repoRoot, "postgres_store.js"), "utf8");
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const postgresContractsSource = fs.readFileSync(path.join(repoRoot, "src", "postgres_store_contracts.ts"), "utf8");
const postgresContractsBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_postgres_contracts_build.js"), "utf8");
const postgresContractsBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.postgres-contracts.json"), "utf8"));

const normalized = PostgresContracts.normalizeWorldDropPayload({
  drop_id: "drop-1",
  item_type: "dirt",
  amount: 7,
  x: 320.5,
  y: 640.25,
  grid_x: 10,
  grid_y: 20,
  pickup_delay: 0.25,
  metadata: { source: "test" },
});

assert.deepEqual(normalized, {
  drop_id: "drop-1",
  item_type: "dirt",
  item_category: "block",
  amount: 7,
  x: 320.5,
  y: 640.25,
  stack_grid_x: 10,
  stack_grid_y: 20,
  pickup_delay: 0.25,
  metadata: { source: "test" },
});

assert.equal(PostgresContracts.normalizeWorldDropPayload({ drop_id: "drop-2", item_type: "dirt", amount: 0 }), null);
assert.equal(PostgresContracts.normalizeWorldDropPayload({ drop_id: "drop-3", item_type: "missing_item", amount: 1 }), null);

assert.deepEqual(PostgresContracts.normalizeWorldDropPayload({
  id: "drop-fallback",
  item_id: "stone",
  quantity: 999999,
}, {
  x: 12,
  y: 34,
  stack_grid_x: 2,
  stack_grid_y: 3,
}), {
  drop_id: "drop-fallback",
  item_type: "stone",
  item_category: "block",
  amount: 2000,
  x: 12,
  y: 34,
  stack_grid_x: 2,
  stack_grid_y: 3,
  pickup_delay: 0,
  metadata: {},
});

assert.deepEqual(PostgresContracts.worldDropRowToPayload({
  drop_id: "drop-row",
  item_type: "dirt_seed",
  item_category: "seed",
  amount: 3,
  x: 96,
  y: 128,
  stack_grid_x: 3.9,
  stack_grid_y: 4.1,
  pickup_delay: 1.5,
}), {
  drop_id: "drop-row",
  item_type: "dirt_seed",
  item_category: "seed",
  is_seed: true,
  amount: 3,
  x: 96,
  y: 128,
  pickup_delay: 1.5,
  stack_grid_x: 3,
  stack_grid_y: 4,
});

assert.deepEqual(PostgresContracts.safeJson("raw-value"), { value: "raw-value" });
assert.deepEqual(PostgresContracts.safeJson(["a", "b"]), { items: ["a", "b"] });
assert.equal(PostgresContracts.stableJsonString({ b: 1, a: { d: 4, c: 3 } }), "{\"a\":{\"c\":3,\"d\":4},\"b\":1}");

const cloneSource = { nested: { value: 1 } };
const clonedSource = PostgresContracts.clonePlainJson(cloneSource);
assert.deepEqual(clonedSource, cloneSource);
assert.notEqual(clonedSource, cloneSource);

const ledgerPayload = PostgresContracts.buildTransactionLedgerHashPayload({
  transaction_id: "",
  transaction_type: "drop_pickup",
  status: "unexpected",
  player_id: "player-1",
  item_transaction_id: 42.9,
  quantity: 5.8,
  device_info: { z: true, a: false },
  metadata: { b: 2, a: 1 },
  server_time: "2026-07-15T00:00:00.000Z",
});

assert.equal(ledgerPayload.algorithm, "sha256:v1");
assert.equal(ledgerPayload.transaction_id, null);
assert.equal(ledgerPayload.transaction_type, "drop_pickup");
assert.equal(ledgerPayload.status, "success");
assert.equal(ledgerPayload.player_id, "player-1");
assert.equal(ledgerPayload.item_transaction_id, "42");
assert.equal(ledgerPayload.quantity, "5");
assert.deepEqual(ledgerPayload.device_info, { a: false, z: true });
assert.deepEqual(ledgerPayload.metadata, { a: 1, b: 2 });
assert.equal(ledgerPayload.server_time, "2026-07-15T00:00:00.000Z");

const hashA = PostgresContracts.buildTransactionLedgerHash({ metadata: { b: 2, a: 1 }, device_info: { z: true, a: false } });
const hashB = PostgresContracts.buildTransactionLedgerHash({ device_info: { a: false, z: true }, metadata: { a: 1, b: 2 } });
assert.equal(hashA, hashB);
assert.match(hashA, /^[a-f0-9]{64}$/);

const worldLockPayload = PostgresContracts.worldLockRowToPayload({
  is_locked: true,
  lock_type: "super_world_lock",
  owner_username: "uso",
  owner_account_id: "acct-1",
  owner_player_id: "player-1",
  lock_x: 5.9,
  lock_y: 6.1,
  metadata: {
    allowed_players: ["USO"],
    allowed_account_ids: ["acct-2"],
    allowed_player_ids: ["player-2"],
    player_roles: { USO: "owner" },
    public_build: true,
    trusted_builder_slot_limit: 99,
    trade_key_holder: "friend",
    trade_key_holder_profile_id: "profile-2",
    trade_key_public_item_instance_id: "key-1",
  },
});

assert.deepEqual({
  is_locked: worldLockPayload.is_locked,
  owner_name: worldLockPayload.owner_name,
  owner_account_id: worldLockPayload.owner_account_id,
  owner_player_id: worldLockPayload.owner_player_id,
  owner_profile_id: worldLockPayload.owner_profile_id,
  lock_block_type: worldLockPayload.lock_block_type,
  lock_type: worldLockPayload.lock_type,
  lock_grid_x: worldLockPayload.lock_grid_x,
  lock_grid_y: worldLockPayload.lock_grid_y,
  allowed_players: worldLockPayload.allowed_players,
  allowed_account_ids: worldLockPayload.allowed_account_ids,
  allowed_player_ids: worldLockPayload.allowed_player_ids,
  player_roles: worldLockPayload.player_roles,
  public_build: worldLockPayload.public_build,
  trusted_builder_slot_limit: worldLockPayload.trusted_builder_slot_limit,
  trade_key_holder: worldLockPayload.trade_key_holder,
  trade_key_holder_player_id: worldLockPayload.trade_key_holder_player_id,
  trade_key_holder_profile_id: worldLockPayload.trade_key_holder_profile_id,
  trade_key_public_item_instance_id: worldLockPayload.trade_key_public_item_instance_id,
}, {
  is_locked: true,
  owner_name: "USO",
  owner_account_id: "acct-1",
  owner_player_id: "player-1",
  owner_profile_id: "player-1",
  lock_block_type: "super_world_lock",
  lock_type: "super_world_lock",
  lock_grid_x: 5,
  lock_grid_y: 6,
  allowed_players: ["USO"],
  allowed_account_ids: ["acct-2"],
  allowed_player_ids: ["player-2"],
  player_roles: { USO: "owner" },
  public_build: true,
  trusted_builder_slot_limit: 50,
  trade_key_holder: "FRIEND",
  trade_key_holder_player_id: "profile-2",
  trade_key_holder_profile_id: "profile-2",
  trade_key_public_item_instance_id: "key-1",
});

assert.deepEqual(PostgresContracts.worldLockRowToPayload({ is_locked: false }), {});

assert.equal(PostgresContracts.normalizeOptionalTimestamp("2026-07-15T00:00:00Z"), "2026-07-15T00:00:00.000Z");
assert.equal(PostgresContracts.normalizeOptionalTimestamp("not-a-date"), null);
assert.match(PostgresContracts.jsonChecksum({ ok: true }), /^[a-f0-9]{64}$/);
assert.equal(PostgresContracts.clampStackLimit(0, 0), 1);
assert.equal(PostgresContracts.getInventoryStackLimitForItem("missing_item", 0), 1);
assert.equal(PostgresContracts.resolveItemCategory("dirt", ""), "block");
assert.equal(PostgresContracts.shouldTrackItemInstance("", "tool"), false);
assert.equal(PostgresContracts.shouldTrackItemInstance("future_tool", "tool"), true);
assert.equal(PostgresContracts.normalizeItemInstanceState("LOCKED"), "locked");
assert.equal(PostgresContracts.normalizeItemInstanceState("bad-state", "consumed"), "consumed");
assert.equal(PostgresContracts.normalizeItemInstanceLocation("WORLD_DROP"), "world_drop");
assert.equal(PostgresContracts.normalizeItemInstanceSource("Admin Give!!"), "admin_give");
assert.equal(PostgresContracts.isVagueItemInstanceCreationSource("system"), true);
assert.equal(PostgresContracts.normalizeTransactionLedgerStatus("reversed"), "reversed");
assert.equal(PostgresContracts.normalizeTransactionLedgerType({ source: "vending", action: "buy_item", amount: -10 }), "VENDING_BUY");
assert.equal(PostgresContracts.normalizeTransactionLedgerType({ source: "world_block_place", item_type: "world_lock", amount: -1 }), "WORLD_LOCK_PLACE");
assert.equal(PostgresContracts.normalizeTransactionLedgerType({ source: "rollback", action: "restore_snapshot" }), "ROLLBACK_RESTORE");
assert.equal(PostgresContracts.normalizeItemInstanceEventType("owner_changed"), "owner_changed");
assert.match(PostgresContracts.generatePublicItemInstanceId(), /^PM-ITEM-[A-F0-9]{16}$/);
assert.equal(PostgresContracts.extractItemInstanceSource({ details: { source: "Fishing Reward" } }), "fishing_reward");
assert.deepEqual(PostgresContracts.summarizeItemInstanceEventMetadata({
  source: "admin",
  reason: "manual test",
  ignored: "nope",
}), {
  reason: "manual test",
  source: "admin",
});
assert.equal(PostgresContracts.normalizePunishmentType("BAN"), "ban");
assert.equal(PostgresContracts.normalizePunishmentType("dance"), "");
assert.equal(PostgresContracts.normalizePunishmentScope("world"), "world");
assert.equal(PostgresContracts.normalizePunishmentScope("bad"), "global");
assert.equal(PostgresContracts.normalizePunishmentEndsAt({ ends_at: "2026-07-15T00:00:00Z" }), "2026-07-15T00:00:00.000Z");
const oneMinutePunishmentEnd = PostgresContracts.normalizePunishmentEndsAt({ duration_minutes: 1 });
assert.notEqual(oneMinutePunishmentEnd, null);
assert.match(String(oneMinutePunishmentEnd), /^20\d{2}-\d{2}-\d{2}T/);
assert.equal(PostgresContracts.defaultEmailForUsername("U S O!"), "uso@pixelmania.local");
assert.equal(PostgresContracts.getXpNeededForLevel(100), 0);
assert.equal(PostgresContracts.getPlayerTitleForLevel(60), "Architect");
const maxProgression = PostgresContracts.normalizeProgressionState({
  level: 100,
  xp: 5,
  player_title: "",
});
assert.equal(maxProgression.player_level, 100);
assert.equal(maxProgression.player_xp, 0);
assert.equal(maxProgression.player_xp_needed, 0);
assert.ok(Number(maxProgression.player_total_xp) > 5);
assert.equal(maxProgression.player_title, "Pixel Legend");
assert.equal(maxProgression.last_level_up_at, "");
assert.equal(PostgresContracts.normalizeWorldObjectAction("Door State!!"), "door_state");
assert.equal(PostgresContracts.normalizeWorldObjectType({ action: "vending_buy" }), "vending");
assert.equal(PostgresContracts.normalizeWorldObjectId({ action: "door_state", details: { door_id: "north" } }), "door:north");
assert.equal(PostgresContracts.shouldTreatAsWorldObjectChange({ action: "sign_text" }), true);

const journalMap = PostgresContracts.extractWorldObjectJournalMap({
  world_name: "START",
  world_lock: { lock_grid_x: 1, lock_grid_y: 2, owner_name: "USO" },
  interactions: [
    { action: "sign_text", x: 3.9, y: 4.1, text: "hello" },
    { action: "ignored", x: 5, y: 6 },
  ],
});
assert.equal(journalMap.size, 2);
assert.deepEqual(journalMap.get("world_lock:START"), {
  object_type: "world_lock",
  object_id: "START:world_lock",
  x: 1,
  y: 2,
  data: { lock_grid_x: 1, lock_grid_y: 2, owner_name: "USO" },
});
assert.equal(PostgresContracts.isUuid("550e8400-e29b-41d4-a716-446655440000"), true);
assert.equal(PostgresContracts.isUuid("not-a-uuid"), false);
assert.equal(PostgresContracts.normalizeLedgerSource("developer give"), "admin");
assert.equal(PostgresContracts.normalizeSecuritySeverity("warn"), "medium");
assert.equal(PostgresContracts.normalizeSecuritySeverity("error"), "high");
assert.equal(PostgresContracts.normalizeIp("127.0.0.1"), "127.0.0.1");
assert.equal(PostgresContracts.normalizeIp("bad ip"), "");

assert.match(postgresSource, /const PostgresContracts = require\("\.\/postgres_store_contracts"\)/);
assert.match(postgresSource, /return PostgresContracts\.normalizeOptionalTimestamp\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.jsonChecksum\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.stableNormalizeForHash\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.stableJsonStringify\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.integrityHash\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.clampStackLimit\(value, fallback\);/);
assert.match(postgresSource, /return PostgresContracts\.getInventoryStackLimitForItem\(itemType, fallback\);/);
assert.match(postgresSource, /return PostgresContracts\.resolveItemCategory\(itemType, itemCategory\);/);
assert.match(postgresSource, /return PostgresContracts\.shouldTrackItemInstance\(itemType, itemCategory\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeItemInstanceState\(value, fallback\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeTransactionLedgerStatus\(value, fallback\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeTransactionLedgerType\(entry\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeItemInstanceEventType\(value, fallback\);/);
assert.match(postgresSource, /return PostgresContracts\.generatePublicItemInstanceId\(\);/);
assert.match(postgresSource, /return PostgresContracts\.summarizeItemInstanceEventMetadata\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizePunishmentType\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeProgressionState\(state\);/);
assert.match(postgresSource, /return PostgresContracts\.buildTransactionLedgerHashPayload\(entry\);/);
assert.match(postgresSource, /return PostgresContracts\.buildTransactionLedgerHash\(entry\);/);
assert.match(postgresSource, /return PostgresContracts\.safeJson\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.clonePlainJson\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.stableJsonForCompare\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.stableJsonString\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeWorldDropPayload\(drop, fallback\);/);
assert.match(postgresSource, /return PostgresContracts\.worldDropRowToPayload\(row\);/);
assert.match(postgresSource, /return PostgresContracts\.worldLockRowToPayload\(row\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeWorldObjectAction\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeWorldObjectType\(entry\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeWorldObjectId\(entry, worldName, objectType\);/);
assert.match(postgresSource, /return PostgresContracts\.extractWorldObjectJournalMap\(worldState, fallbackWorldName\);/);
assert.match(postgresSource, /return PostgresContracts\.isUuid\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeLedgerSource\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeSecuritySeverity\(value\);/);
assert.match(postgresSource, /return PostgresContracts\.normalizeIp\(value\);/);
assert.match(deploySource, /\$localPostgresContracts/);
assert.match(deploySource, /\$localPostgresContractsCheck/);
assert.match(deploySource, /src\/postgres_store_contracts\.ts/);
assert.match(deploySource, /tsconfig\.postgres-contracts\.json/);
assert.match(deploySource, /sync_postgres_contracts_build\.js/);
assert.match(deploySource, /npm run build:postgres-contracts/);
assert.match(deploySource, /node --check postgres_store_contracts\.js/);
assert.match(deploySource, /node --check scripts\/check_postgres_contracts\.js/);
assert.equal(
  packageJson.scripts["build:postgres-contracts"],
  "tsc --project tsconfig.postgres-contracts.json && node scripts/sync_postgres_contracts_build.js"
);
assert.equal(packageJson.scripts["check:postgres-contracts"], "npm run build:postgres-contracts && node scripts/check_postgres_contracts.js");
assert.match(packageJson.scripts["check:typescript"], /npm run check:postgres-contracts/);
assert.match(postgresContractsSource, /type PostgresRecord = Record<string, unknown>/);
assert.match(postgresContractsSource, /export = PostgresContracts/);
assert.deepEqual(postgresContractsBuildConfig.include, ["src/postgres_store_contracts.ts"]);
assert.match(postgresContractsBuildSource, /Generated from src\/postgres_store_contracts\.ts/);

console.log("[postgres-contracts] success");
