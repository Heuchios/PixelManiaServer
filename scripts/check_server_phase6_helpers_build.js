#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Phase6HelpersModule = require("../server_phase6_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase6_helpers.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_phase6_helpers.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_phase6_helpers_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-phase6-helpers.json"), "utf8"));

/** @type {{ action: string, message: string, extra?: Record<string, unknown> }[]} */
const rejections = [];
const drops = new Map([
  ["drop-a", { drop_id: "drop-a", item_type: "apple", item_category: "food", amount: 3, x: 64, y: 96, status: "active", stack_grid_x: 2, stack_grid_y: 3 }],
  ["drop-b", { drop_id: "drop-b", item_type: "apple", item_category: "food", amount: 2, x: 65, y: 96, status: "active", stack_grid_x: 2, stack_grid_y: 3 }],
  ["drop-empty", { drop_id: "drop-empty", item_type: "apple", item_category: "food", amount: 0, x: 66, y: 96, status: "active", stack_grid_x: 2, stack_grid_y: 3 }],
  ["drop-far", { drop_id: "drop-far", item_type: "apple", item_category: "food", amount: 1, x: 9999, y: 9999, status: "active", stack_grid_x: 4, stack_grid_y: 4 }],
]);
let population = 2;
const validItems = new Set(["apple", "gem"]);

/** @returns {{ action: string, message: string, extra?: Record<string, unknown> }} */
function lastRejection() {
  const rejection = rejections[rejections.length - 1];
  assert.ok(rejection);
  return rejection;
}

/** @type {any} */
const helpers = Phase6HelpersModule.createServerPhase6Helpers({
  packetContracts: {
    isBulkDropPickupRequested(/** @type {any} */ data) {
      return Boolean(data && typeof data === "object" && !Array.isArray(data) && data.bulk_pickup === true);
    },
    isDropWorldUpdatePayload(/** @type {any} */ message) {
      return Boolean(message && typeof message === "object" && String(message.type || "").startsWith("world_item_drop_"));
    },
    isDropRemoveWorldUpdatePayload(/** @type {any} */ message) {
      return Boolean(message && typeof message === "object" && String(message.type || "") === "world_item_drop_remove");
    },
  },
  itemDatabase: {
    hasItem(/** @type {unknown} */ itemType) {
      return validItems.has(String(itemType || ""));
    },
    isDropableItem(/** @type {unknown} */ itemType) {
      return String(itemType || "") !== "gem";
    },
    canStoreItemInCategory(/** @type {unknown} */ itemType, /** @type {unknown} */ itemCategory) {
      return String(itemType || "") === "apple" && String(itemCategory || "") === "food";
    },
  },
  maxDropCreateDistancePixels: 192,
  maxDropTileAmount: 2000,
  maxDropIdLength: 96,
  maxBulkDropPickupIds: 3,
  maxItemIdLength: 64,
  maxItemCategoryLength: 32,
  worldUpdateBatchingEnabled: true,
  worldUpdateBatchMinClientVersion: "1.0.3",
  worldUpdateBatchMaxItems: 64,
  worldUpdateBatchIntervalMs: 16,
  playerPositionBroadcastIntervalMs: 16,
  playerPositionBatchMaxItems: 64,
  playerPositionIdleHeartbeatMs: 1000,
  tileSize: 32,
  cleanWorld(/** @type {unknown} */ value) {
    return String(value || "START").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32) || "START";
  },
  cleanName(/** @type {unknown} */ value) {
    return String(value || "").trim().slice(0, 16);
  },
  clampString(/** @type {unknown} */ value, /** @type {number} */ limit = 64) {
    return String(value || "").trim().slice(0, limit);
  },
  clampInteger(/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) {
    const parsed = Math.trunc(Number(value) || 0);
    return Math.max(min, Math.min(max, parsed));
  },
  resolveInventoryCategory(/** @type {unknown} */ itemType, /** @type {unknown} */ requestedCategory = "") {
    return String(requestedCategory || itemType || "").trim();
  },
  compareVersions(/** @type {unknown} */ a, /** @type {unknown} */ b) {
    const left = String(a || "").split(".").map((part) => Math.trunc(Number(part) || 0));
    const right = String(b || "").split(".").map((part) => Math.trunc(Number(part) || 0));
    for (let index = 0; index < 3; index += 1) {
      if ((left[index] || 0) > (right[index] || 0)) return 1;
      if ((left[index] || 0) < (right[index] || 0)) return -1;
    }
    return 0;
  },
  getWorldPopulationCount() {
    return population;
  },
  getWorldPopulationForBatching() {
    return population;
  },
  isGridInWorld(/** @type {unknown} */ x, /** @type {unknown} */ y) {
    const gridX = Number(x);
    const gridY = Number(y);
    return Number.isInteger(gridX) && Number.isInteger(gridY) && gridX >= 0 && gridY >= 0;
  },
  isPlayerNearPoint(/** @type {any} */ player, /** @type {unknown} */ x, /** @type {unknown} */ y, /** @type {number} */ maxDistancePixels) {
    const dx = Number(player?.x || 0) - Number(x || 0);
    const dy = Number(player?.y || 0) - Number(y || 0);
    return dx * dx + dy * dy <= maxDistancePixels * maxDistancePixels;
  },
  getDropGridFromPosition(/** @type {any} */ position) {
    return { x: Math.trunc(Number(position?.x || 0) / 32), y: Math.trunc(Number(position?.y || 0) / 32) };
  },
  getDropStackGridFromDrop(/** @type {any} */ drop) {
    return { x: Math.trunc(Number(drop?.stack_grid_x || 0)), y: Math.trunc(Number(drop?.stack_grid_y || 0)) };
  },
  isDropGridBlockedByBlock(/** @type {unknown} */ _worldName, /** @type {any} */ grid) {
    return Boolean(grid && grid.x === 9 && grid.y === 9);
  },
  ensureWorldState() {
    return { drops };
  },
  cleanDropIdList(/** @type {unknown} */ rawIds, /** @type {number} */ maxIds = 3) {
    return Array.isArray(rawIds)
      ? rawIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, maxIds)
      : [];
  },
  sendActionRejected(/** @type {unknown} */ _socket, /** @type {string} */ action, /** @type {string} */ message, /** @type {Record<string, unknown> | undefined} */ extra) {
    rejections.push({ action, message, extra });
  },
});

assert.equal(helpers.validateDropCreateAgainstServerState({}, { x: 0, y: 0 }, { item_type: "missing", item_category: "food", x: 0, y: 0, world: "test" }), false);
assert.equal(lastRejection().message, "That item does not exist on the server.");
assert.equal(helpers.validateDropCreateAgainstServerState({}, { x: 0, y: 0 }, { item_type: "gem", item_category: "currency", x: 0, y: 0, world: "test" }), false);
assert.equal(lastRejection().message, "That item cannot be dropped.");
assert.equal(helpers.validateDropCreateAgainstServerState({}, { x: 0, y: 0 }, { item_type: "apple", item_category: "tool", x: 0, y: 0, world: "test" }), false);
assert.equal(lastRejection().message, "That item category does not match the server.");
assert.equal(helpers.validateDropCreateAgainstServerState({}, { x: 0, y: 0 }, { item_type: "apple", item_category: "food", x: 999, y: 0, world: "test" }), false);
assert.equal(lastRejection().message, "Drop closer to your player.");
assert.equal(helpers.validateDropCreateAgainstServerState({}, { x: 288, y: 288 }, { item_type: "apple", item_category: "food", x: 288, y: 288, stack_grid_x: 9, stack_grid_y: 9, world: "test" }), false);
assert.equal(lastRejection().message, "Can't drop on a block.");
assert.equal(helpers.validateDropCreateAgainstServerState({}, { x: 64, y: 96 }, { item_type: "apple", item_category: "food", x: 64, y: 96, world: "test" }), true);

assert.equal(helpers.validateDropUpdateAgainstServerState({}, { x: 64, y: 96 }, "test", { drop_id: "missing" }), false);
assert.equal(lastRejection().message, "That drop no longer exists.");
assert.equal(helpers.validateDropUpdateAgainstServerState({}, { x: 64, y: 96 }, "test", { drop_id: "drop-a", amount: 1 }), false);
assert.equal(lastRejection().message, "Drop movement and amounts are server controlled.");
assert.equal(helpers.validateDropUpdateAgainstServerState({}, { x: 0, y: 0 }, "test", { drop_id: "drop-far" }), false);
assert.equal(lastRejection().message, "Too far away.");
assert.equal(helpers.validateDropUpdateAgainstServerState({}, { x: 64, y: 96 }, "test", { drop_id: "drop-a" }), true);

assert.equal(helpers.shouldUseBulkDropPickup({ bulk_pickup: true }), true);
assert.deepEqual(helpers.appendSameTileBulkDropIds(["drop-a"], "test", { x: 2, y: 3 }), ["drop-a", "drop-b"]);
assert.deepEqual(helpers.makeBulkDropPickupFailure("drop-a", "too_far", "Too far", { retry: false }), {
  ok: false,
  drop_id: "drop-a",
  reason: "too_far",
  message: "Too far",
  retry: false,
});
assert.equal(helpers.getPreparedDropPickupFailureMessage({ reason: "inventory_full" }), "Inventory full.");
assert.equal(helpers.getPreparedDropPickupFailureMessage({ reason: "wrong_world" }), "Join that world before sending actions for it.");

const deltas = new Map();
helpers.addBulkPickupDelta(deltas, "apple", "food", 4);
helpers.addBulkPickupDelta(deltas, "apple", "food", 6);
assert.deepEqual(deltas.get("food:apple"), { item_type: "apple", item_category: "food", delta: 10 });

assert.deepEqual(helpers.makeBulkDropPickupWorldResultPayload("test", { id: "p1", name: "Uso" }, ["drop-a", "drop-b"], [
  { ok: true, drop_id: "drop-a" },
  { ok: false, drop_id: "drop-b" },
], [
  { payload: { type: "world_item_drop_remove", drop_id: "drop-a", remaining: 0 } },
  { payload: { type: "world_item_drop_update", drop_id: "drop-b", item_type: "apple", item_category: "food", amount: 1, remaining: 1 } },
], 3), {
  type: "world_item_drop_remove",
  world: "TEST",
  drop_id: "drop-a",
  drop_ids: ["drop-a"],
  removed_drop_ids: ["drop-a"],
  updated_drops: [{
    type: "world_item_drop_update",
    world: "TEST",
    drop_id: "drop-b",
    item_type: "apple",
    item_category: "food",
    amount: 1,
    remaining: 1,
    remaining_amount: 1,
    requested_by: "p1",
    requested_by_name: "Uso",
  }],
  bulk_pickup: true,
  amount: 3,
  picked_count: 1,
  pickup_results: [
    { ok: true, drop_id: "drop-a" },
    { ok: false, drop_id: "drop-b" },
  ],
  requested_by: "p1",
  requested_by_name: "Uso",
  _server_inventory_update_applied: true,
  _apply_pickup_inventory: false,
});

assert.deepEqual(helpers.clampBatchMaxItems(0, 64), 64);
assert.deepEqual(helpers.makeWorldDensityBatchProfile("test", 16, 64), { interval_ms: 16, max_items: 38 });
assert.equal(helpers.getPlayerPositionHeartbeatIntervalMs("test"), 5000);
assert.equal(helpers.buildClientMovementGuidance("test").world_population_for_batching, 2);
assert.deepEqual(helpers.buildWorldPopulationUpdatePayload("test").world_counts, { TEST: 2 });
assert.equal(helpers.supportsWorldUpdateBatch({ client_version: "1.0.3" }), true);
assert.equal(helpers.supportsWorldUpdateBatch({ client_version: "1.0.2" }), false);
assert.equal(helpers.isDropWorldUpdatePayload({ type: "world_item_drop_create" }), true);
assert.equal(helpers.isDropRemoveWorldUpdatePayload({ type: "world_item_drop_remove" }), true);
assert.equal(helpers.getDropPublicId({ id: "drop-x" }), "drop-x");
assert.deepEqual(helpers.getDropPublicPosition({ stack_grid_x: 2, stack_grid_y: 3 }), { x: 64, y: 96 });
assert.equal(helpers.getSquaredDropDistance({ x: 64, y: 96 }, { stack_grid_x: 2, stack_grid_y: 3 }), 0);
assert.deepEqual(helpers.buildDropCreatePayload({ drop_id: "drop-a", item_type: "apple", item_category: "food", amount: 2, x: 1, y: 2, stack_grid_x: 2, stack_grid_y: 3 }, "test"), {
  type: "world_item_drop_create",
  world: "TEST",
  drop_id: "drop-a",
  item_type: "apple",
  item_category: "food",
  is_seed: false,
  amount: 2,
  x: 1,
  y: 2,
  stack_grid_x: 2,
  stack_grid_y: 3,
  pickup_delay: 0,
});
assert.deepEqual(helpers.buildDropInterestCullPayload({ drop_id: "drop-a" }, "test"), {
  type: "world_item_drop_remove",
  world: "TEST",
  drop_id: "drop-a",
  interest_cull: true,
  reason: "out_of_drop_interest",
});

population = 25;
assert.deepEqual(helpers.getAdaptiveWorldUpdateBatchProfile("test"), { interval_ms: 24, max_items: 112 });

assert.equal(
  packageJson.scripts["build:server-phase6-helpers"],
  "tsc --project tsconfig.server-phase6-helpers.json && node scripts/sync_server_phase6_helpers_build.js"
);
assert.equal(
  packageJson.scripts["check:server-phase6-helpers"],
  "npm run build:server-phase6-helpers && node scripts/check_server_phase6_helpers_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-phase6-helpers/);
assert.deepEqual(buildConfig.include, ["src/server_phase6_helpers.ts"]);
assert.match(helperSource, /function createServerPhase6Helpers/);
assert.match(helperSource, /function validateDropCreateAgainstServerState/);
assert.match(helperSource, /function buildDropCreatePayload/);
assert.match(generatedSource, /Generated from src\/server_phase6_helpers\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(syncSource, /server_phase6_helpers\.js/);
assert.match(serverSource, /require\("\.\/server_phase6_helpers"\)/);
assert.match(serverSource, /ServerPhase6Helpers\.validateDropCreateAgainstServerState/);
assert.match(serverSource, /ServerPhase6Helpers\.makeBulkDropPickupWorldResultPayload/);
assert.match(serverSource, /ServerPhase6Helpers\.buildDropCreatePayload/);
assert.match(serverSource, /MAX_ITEM_CATEGORY_LENGTH/);
assert.match(deploySource, /server_phase6_helpers\.js/);
assert.match(deploySource, /src\/server_phase6_helpers\.ts/);
assert.match(deploySource, /tsconfig\.server-phase6-helpers\.json/);
assert.match(deploySource, /sync_server_phase6_helpers_build\.js/);
assert.match(deploySource, /check_server_phase6_helpers_build\.js/);
assert.match(deploySource, /npm run build:server-phase6-helpers/);

console.log("[server-phase6-helpers] success");
