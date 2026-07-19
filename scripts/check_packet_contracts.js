#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PacketContracts = require("../server_packet_contracts");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const packetContractsSource = fs.readFileSync(path.join(repoRoot, "src", "server_packet_contracts.ts"), "utf8");
const packetContractsBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_packet_contracts_build.js"), "utf8");
const packetContractsBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.packet-contracts.json"), "utf8"));
const typeContracts = fs.readFileSync(path.join(repoRoot, "types", "pixelmania-contracts.d.ts"), "utf8");
const redisSource = fs.readFileSync(path.join(repoRoot, "redis_store.js"), "utf8");
const postgresSource = fs.readFileSync(path.join(repoRoot, "postgres_store.js"), "utf8");

const blockUpdate = {
  type: "world_block_update",
  action: "place",
  layer: "foreground",
  x: 12,
  y: 34,
  block_type: "pillar_top",
  world: "START",
  actor_x: 384,
  actor_y: 1088,
  actor_world: "START",
};

const dropCreate = {
  type: "world_item_drop_create",
  item_type: "dirt",
  item_category: "block",
  amount: 5,
  x: 320,
  y: 640,
  world: "START",
};

const singlePickup = {
  type: "world_item_drop_pickup",
  drop_id: "drop-1",
  world: "START",
  actor_x: 320,
  actor_y: 640,
};

const genericBulkPickup = {
  type: "world_item_drop_pickup",
  bulk_pickup: true,
  drop_id: "drop-1",
  drop_ids: ["drop-1", "drop-2"],
};

const sameTilePickup = {
  type: "world_item_drop_pickup",
  bulk_pickup_same_tile: true,
  drop_id: "drop-1",
  drop_ids: ["drop-1"],
};

const oneEntryBulkFallback = {
  type: "world_item_drop_pickup",
  drop_id: "drop-1",
  drop_ids: ["drop-1"],
};

const plainBulkSinglePickup = {
  type: "world_item_drop_pickup",
  bulk_pickup: true,
  drop_id: "drop-1",
  drop_ids: ["drop-1"],
};

const movementOnly = {
  type: "player_position",
  x: 320,
  y: 640,
  world: "START",
  facing: 1,
  movement_sequence: 17,
  client_time_msec: 123456,
  animation_state: "walk",
  velocity_x: 96,
  velocity_y: 0,
  on_floor: true,
};

const movementVisualSync = {
  ...movementOnly,
  visual_sync: true,
  equipment_slots: {
    hand: "bamboo_rod",
    back: "jetpack",
  },
};

const legacyMovementVisualSync = {
  ...movementOnly,
  equipped_tool: "bamboo_rod",
};

assert.equal(PacketContracts.getCanonicalWorldActionType(blockUpdate), "world_block_update");
assert.equal(PacketContracts.getCanonicalWorldActionType(dropCreate), "world_item_drop_create");
assert.equal(PacketContracts.getCanonicalWorldActionType({ type: "world_drop_create" }), "world_item_drop_create");
assert.equal(PacketContracts.getCanonicalWorldActionType(singlePickup), "world_item_drop_pickup");
assert.equal(PacketContracts.getCanonicalWorldActionType({ type: "world_drop_pickup" }), "world_item_drop_pickup");
assert.equal(PacketContracts.getCanonicalWorldActionType({ type: "drop_pickup" }), "world_item_drop_pickup");
assert.equal(PacketContracts.isWorldActionPacket({ type: "chat_message" }), false);
for (const type of ["world_item_drop_create", "world_drop_create"]) {
  assert.equal(PacketContracts.isWorldDropCreatePacket({ type }), true, type);
}
for (const type of ["world_item_drop_update", "world_drop_update"]) {
  assert.equal(PacketContracts.isWorldDropUpdateRequestPacket({ type }), true, type);
}
for (const type of ["world_item_drop_pickup", "world_item_drop_remove", "world_drop_pickup", "world_drop_remove"]) {
  assert.equal(PacketContracts.isWorldDropPickupRequestPacket({ type }), true, type);
}
assert.equal(PacketContracts.isWorldDropUpdateRequestPacket({ type: "drop_updated" }), false);
assert.equal(PacketContracts.isWorldDropPickupRequestPacket({ type: "drop_pickup" }), false);
assert.equal(PacketContracts.isWorldDropPickupRequestPacket({ type: "drop_removed" }), false);
for (const type of [
  "world_item_drop_create",
  "world_drop_create",
  "world_item_drop_update",
  "world_drop_update",
  "world_item_drop_pickup",
  "world_drop_pickup",
  "world_item_drop_remove",
  "world_drop_remove",
]) {
  assert.equal(PacketContracts.isWorldDropIdempotencyRequestPacket({ type }), true, type);
}
for (const type of ["drop_spawned", "drop_updated", "drop_pickup", "drop_removed"]) {
  assert.equal(PacketContracts.isWorldDropIdempotencyRequestPacket({ type }), false, type);
}
for (const action of ["world_item_drop_create", "world_drop_create", "world_item_drop_pickup", "world_drop_pickup"]) {
  assert.equal(PacketContracts.isWorldDropTrustedPositionAction(action), true, action);
}
for (const action of ["world_item_drop_update", "world_drop_update", "world_item_drop_remove", "world_drop_remove", "drop_pickup"]) {
  assert.equal(PacketContracts.isWorldDropTrustedPositionAction(action), false, action);
}
for (const type of [
  "world_item_drop_create",
  "world_drop_create",
  "drop_spawned",
  "world_item_drop_update",
  "world_drop_update",
  "drop_updated",
  "world_item_drop_pickup",
  "world_drop_pickup",
  "world_item_drop_remove",
  "world_drop_remove",
  "drop_removed",
]) {
  assert.equal(PacketContracts.isDropWorldUpdatePayload({ type }), true, type);
}
for (const type of [
  "world_item_drop_pickup",
  "world_drop_pickup",
  "world_item_drop_remove",
  "world_drop_remove",
  "drop_removed",
]) {
  assert.equal(PacketContracts.isDropRemoveWorldUpdatePayload({ type }), true, type);
}
assert.equal(PacketContracts.isDropWorldUpdatePayload({ type: "drop_pickup" }), false);
assert.equal(PacketContracts.isDropRemoveWorldUpdatePayload({ type: "drop_pickup" }), false);

assert.deepEqual(PacketContracts.getActionActorPosition(blockUpdate), {
  x: 384,
  y: 1088,
  world: "START",
  facing: undefined,
});

assert.equal(PacketContracts.isBulkDropPickupRequested(singlePickup), false);
assert.equal(PacketContracts.isSameTileBulkDropPickupRequested(singlePickup), false);
assert.equal(PacketContracts.isBulkDropPickupRequested(genericBulkPickup), true);
assert.equal(PacketContracts.isSameTileBulkDropPickupRequested(genericBulkPickup), false);
assert.equal(PacketContracts.isBulkDropPickupRequested(sameTilePickup), true);
assert.equal(PacketContracts.isSameTileBulkDropPickupRequested(sameTilePickup), true);
assert.equal(PacketContracts.isBulkDropPickupRequested(oneEntryBulkFallback), false);
assert.equal(PacketContracts.isSameTileBulkDropPickupRequested(oneEntryBulkFallback), false);
assert.deepEqual(PacketContracts.getDropPickupIds(oneEntryBulkFallback), ["drop-1"]);
assert.equal(PacketContracts.isBulkDropPickupRequested(plainBulkSinglePickup), true);
assert.equal(PacketContracts.isSameTileBulkDropPickupRequested(plainBulkSinglePickup), false);
assert.deepEqual(PacketContracts.getDropPickupIds({
  type: "world_drop_pickup",
  drop_id: "drop-1",
  drop_ids: ["drop-1", "drop-2", "", "drop-2"],
}), ["drop-1", "drop-2"]);

assert.equal(PacketContracts.PLAYER_POSITION_TYPE, "player_position");
assert.equal(PacketContracts.isPlayerPositionPacket(movementOnly), true);
assert.equal(PacketContracts.isPlayerPositionPacket({ type: "player_position", x: "bad", y: 640 }), false);
assert.equal(PacketContracts.isPlayerPositionPacket({ type: "player_position", x: 320 }), false);
assert.equal(PacketContracts.hasPlayerPositionVisualSnapshot(movementOnly), false);
assert.equal(PacketContracts.hasPlayerPositionVisualSnapshot(movementVisualSync), true);
assert.equal(PacketContracts.hasPlayerPositionVisualSnapshot(legacyMovementVisualSync), true);

assert.match(packageJson.scripts["check:typescript"], /npm run check:types/);
assert.match(packageJson.scripts["check:typescript"], /npm run check:item-data/);
assert.match(packageJson.scripts["check:typescript"], /npm run check:packet-contracts/);
assert.match(packageJson.scripts["check:typescript"], /npm run check:drop-contracts/);
assert.match(packageJson.scripts["check:typescript"], /npm run check:inventory-contracts/);
assert.match(packageJson.scripts["check:typescript"], /npm run check:postgres-contracts/);
assert.equal(
  packageJson.scripts["build:packet-contracts"],
  "tsc --project tsconfig.packet-contracts.json && node scripts/sync_packet_contracts_build.js"
);
assert.equal(packageJson.scripts["check:packet-contracts"], "npm run build:packet-contracts && node scripts/check_packet_contracts.js");
assert.match(packageJson.scripts["check:security"], /npm run check:typescript/);
assert.match(deploySource, /npm run check:typescript/);
assert.match(deploySource, /npm run build:packet-contracts/);
assert.match(deploySource, /node --check redis_store\.js/);
assert.match(deploySource, /src\/server_packet_contracts\.ts/);
assert.match(deploySource, /tsconfig\.packet-contracts\.json/);
assert.match(deploySource, /sync_packet_contracts_build\.js/);
assert.match(packetContractsSource, /type PacketRecord = Record<string, unknown>/);
assert.match(packetContractsSource, /export = PacketContracts/);
assert.deepEqual(packetContractsBuildConfig.include, ["src/server_packet_contracts.ts"]);
assert.match(packetContractsBuildSource, /Generated from src\/server_packet_contracts\.ts/);
assert.match(packageJson.scripts["check:typescript"], /npm run check:redis-store/);
assert.match(deploySource, /npm run build:redis-store/);
assert.match(redisSource, /^\/\/ Generated from src\/redis_store\.ts/);
for (const contract of [
  "RedisStoreOptions",
  "RedisHealthSnapshot",
  "RedisRateLimitResult",
  "RedisLockResult",
  "RedisWorldAdmissionResult",
  "RedisWorldRouteResult",
  "RedisNetfoxMovementRouteGetResult",
  "PostgresStoreOptions",
]) {
  assert.match(typeContracts, new RegExp(`interface ${contract}\\b`));
}
assert.match(postgresSource, /@param \{PixelMania\.PostgresStoreOptions\} options[\s\S]*?constructor\(options = \{\}\)/);
assert.match(postgresSource, /@returns \{Promise<PixelMania\.PostgresSaveWorldStateWithWorldChangesResult>\}[\s\S]*?async saveWorldStateWithWorldChanges\b/);
assert.match(postgresSource, /@returns \{Promise<PixelMania\.PostgresInventoryDeltaTransactionResult>\}[\s\S]*?async applyInventoryDeltaTransaction\b/);
assert.match(postgresSource, /@returns \{Promise<PixelMania\.PostgresDropPickupResult>\}[\s\S]*?async applyDropPickupTransaction\b/);

console.log("[packet-contracts] success");
