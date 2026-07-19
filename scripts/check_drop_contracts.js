#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const DropContracts = require("../server_drop_contracts");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const dropContractsSource = fs.readFileSync(path.join(repoRoot, "src", "server_drop_contracts.ts"), "utf8");
const dropContractsBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_drop_contracts_build.js"), "utf8");
const dropContractsBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.drop-contracts.json"), "utf8"));

const created = DropContracts.buildSanitizedDropCreate({
  world: "START",
  dropId: "drop-1",
  itemType: "dirt",
  itemCategory: "block",
  isSeed: false,
  amount: 3,
  x: 320,
  y: 640,
  stackGrid: { x: 10, y: 20 },
  pickupDelay: 0.25,
});

assert.deepEqual(created, {
  type: "drop_spawned",
  world: "START",
  drop_id: "drop-1",
  item_type: "dirt",
  item_category: "block",
  is_seed: false,
  amount: 3,
  x: 320,
  y: 640,
  stack_grid_x: 10,
  stack_grid_y: 20,
  pickup_delay: 0.25,
});

assert.deepEqual(DropContracts.buildSanitizedDropUpdate({
  world: "START",
  dropId: "drop-1",
  amount: 0,
}), {
  type: "world_item_drop_update",
  world: "START",
  drop_id: "drop-1",
  amount: 0,
});

const pickup = DropContracts.buildSanitizedDropPickup({
  world: "START",
  requestedWorld: "START",
  dropId: "drop-1",
  playerId: "player-1",
  name: "Hasan",
  actionPosition: { x: 320, y: 640, world: "START", facing: "right" },
});

assert.equal(pickup.type, "world_item_drop_pickup");
assert.equal(pickup.drop_id, "drop-1");
assert.equal(pickup.action_position?.world, "START");

const bulk = DropContracts.buildSanitizedBulkDropPickup({
  world: "START",
  requestedWorld: "START",
  dropId: "drop-1",
  dropIds: ["drop-1", "drop-2"],
  playerId: "player-1",
  name: "Hasan",
  actionPosition: null,
});

assert.equal(bulk.bulk_pickup, true);
assert.deepEqual(bulk.drop_ids, ["drop-1", "drop-2"]);

assert.deepEqual(DropContracts.buildDropPickupFailure({
  reason: "too_far",
  drop: { drop_id: "drop-1", item_type: "dirt", item_category: "block", amount: 1, x: 320, y: 640 },
  world: "START",
}), {
  ok: false,
  reason: "too_far",
  drop: { drop_id: "drop-1", item_type: "dirt", item_category: "block", amount: 1, x: 320, y: 640 },
  world: "START",
});

const prepared = DropContracts.buildPreparedDropPickupPlan({
  player: { id: "player-1", account_username: "hasan", name: "Hasan", x: 320, y: 640 },
  world: "START",
  dropId: "drop-1",
  dropStateKey: "drop-1",
  drop: { drop_id: "drop-1", item_type: "dirt", item_category: "block", amount: 3, x: 320, y: 640 },
  playerState: {},
  item_type: "dirt",
  item_category: "block",
  validationPosition: { ok: true, x: 320, y: 640, world: "START" },
  dropAmount: 3,
  pickedAmount: 3,
  stackLimit: 200,
  currentCount: 0,
  availableSpace: 200,
  remaining: 0,
});

assert.equal(prepared.ok, true);
assert.equal(prepared.dropId, "drop-1");
assert.equal(prepared.remaining, 0);

const removePayload = DropContracts.buildDropPickupRemovePayload({
  world: "START",
  dropId: "drop-1",
  requestedBy: "player-1",
  requestedByName: "Hasan",
  reason: "server_drop_unavailable",
});

assert.deepEqual(removePayload, {
  type: "world_item_drop_remove",
  world: "START",
  drop_id: "drop-1",
  remaining: 0,
  removed: true,
  requested_by: "player-1",
  requested_by_name: "Hasan",
  reason: "server_drop_unavailable",
});

const updatePayload = DropContracts.buildDropPickupUpdatePayload({
  world: "START",
  dropId: "drop-1",
  itemType: "dirt",
  itemCategory: "block",
  amount: 2,
  remaining: 2,
  requestedBy: "player-1",
  requestedByName: "Hasan",
});

assert.equal(updatePayload.type, "world_item_drop_update");
assert.equal(updatePayload.remaining, 2);
assert.deepEqual(DropContracts.buildDropPickupWorldApplySuccess(updatePayload), {
  ok: true,
  payload: updatePayload,
});
assert.deepEqual(DropContracts.buildDropPickupWorldApplyFailure("not_available"), {
  ok: false,
  reason: "not_available",
});

assert.deepEqual(DropContracts.buildLegacyDropPickupSuccess({
  drop: { drop_id: "drop-1", item_type: "dirt", item_category: "block", amount: 3, x: 320, y: 640 },
  playerState: {},
  update: removePayload,
  remaining: 0,
}), {
  ok: true,
  drop: { drop_id: "drop-1", item_type: "dirt", item_category: "block", amount: 3, x: 320, y: 640 },
  playerState: {},
  update: removePayload,
  remaining: 0,
});

const postgresSuccess = DropContracts.buildPostgresDropPickupSuccess({
  before_amount: 4,
  after_amount: 7,
  item_type: "dirt",
  item_category: "block",
  repaired_inventory_before_amount: null,
  drop_before_amount: 5,
  drop_after_amount: 2,
  item_instances: [{ public_item_instance_id: "PM-ITEM-1" }],
});

assert.equal(postgresSuccess.ok, true);
assert.equal(postgresSuccess.after_amount, 7);
assert.equal(postgresSuccess.drop_after_amount, 2);
assert.deepEqual(postgresSuccess.item_instances, [{ public_item_instance_id: "PM-ITEM-1" }]);

const postgresDropChanged = DropContracts.buildPostgresDropPickupFailure({
  reason: "drop_changed",
  drop_id: "drop-1",
  item_type: "stone",
  item_category: "block",
});

assert.equal(postgresDropChanged.ok, false);
assert.equal(DropContracts.getPostgresDropPickupFailureReason(postgresDropChanged), "drop_changed");
assert.equal(DropContracts.isPostgresDropPickupUnavailableFailure(postgresDropChanged), true);
assert.equal(DropContracts.isPostgresDropPickupUnavailableFailure(DropContracts.buildPostgresDropPickupFailure({
  reason: "insufficient_capacity",
})), false);
assert.equal(DropContracts.getPostgresDropPickupFailureReason({}, "postgres_rejected"), "postgres_rejected");

assert.equal(
  packageJson.scripts["build:drop-contracts"],
  "tsc --project tsconfig.drop-contracts.json && node scripts/sync_drop_contracts_build.js"
);
assert.equal(packageJson.scripts["check:drop-contracts"], "npm run build:drop-contracts && node scripts/check_drop_contracts.js");
assert.match(packageJson.scripts["check:typescript"], /npm run check:drop-contracts/);
assert.match(deploySource, /npm run build:drop-contracts/);
assert.match(deploySource, /src\/server_drop_contracts\.ts/);
assert.match(deploySource, /tsconfig\.drop-contracts\.json/);
assert.match(deploySource, /sync_drop_contracts_build\.js/);
assert.match(dropContractsSource, /type SanitizedDropCreate = PixelMania\.SanitizedDropCreate/);
assert.match(dropContractsSource, /export = DropContracts/);
assert.deepEqual(dropContractsBuildConfig.include, ["src/server_drop_contracts.ts"]);
assert.match(dropContractsBuildSource, /Generated from src\/server_drop_contracts\.ts/);

console.log("[drop-contracts] success");
