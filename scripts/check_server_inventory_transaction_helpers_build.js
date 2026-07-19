#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const InventoryContracts = require("../server_inventory_contracts");
const InventoryTransactionHelpersModule = require("../server_inventory_transaction_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_inventory_transaction_helpers.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_inventory_transaction_helpers.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_inventory_transaction_helpers_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-inventory-transaction-helpers.json"), "utf8"));

/** @type {Record<string, string>} */
const categoryToField = {
  block: "inventory",
  seed: "seed_inventory",
  tool: "tool_inventory",
  currency: "currency_inventory",
};
/** @type {Record<string, string>} */
const fieldToCategory = Object.fromEntries(Object.entries(categoryToField).map(([category, field]) => [field, category]));
const itemCategories = new Map([
  ["dirt", "block"],
  ["apple_seed", "seed"],
  ["wrench", "tool"],
  ["gem", "currency"],
]);
const stackLimits = new Map([
  ["dirt", 10],
  ["apple_seed", 50],
  ["wrench", 1],
  ["gem", 100000000000],
]);

/** @type {any} */
const helpers = InventoryTransactionHelpersModule.createServerInventoryTransactionHelpers({
  itemDatabase: {
    CATEGORY_TO_FIELD: categoryToField,
    FIELD_TO_CATEGORY: fieldToCategory,
    hasItem(/** @type {string} */ itemId) {
      return itemCategories.has(itemId);
    },
    canStoreItemInCategory(/** @type {string} */ itemId, /** @type {string} */ category) {
      return itemCategories.get(itemId) === category;
    },
    getStackLimit(/** @type {string} */ itemId) {
      return stackLimits.get(itemId) || 200;
    },
  },
  inventoryContracts: InventoryContracts,
  cleanAccountName(/** @type {unknown} */ value) {
    return String(value || "").trim();
  },
  clampInteger(/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) {
    const parsed = Math.trunc(Number(value) || 0);
    return Math.max(min, Math.min(max, parsed));
  },
  clampString(/** @type {unknown} */ value, /** @type {number | undefined} */ limit = 64) {
    return String(value || "").trim().slice(0, limit);
  },
  resolveInventoryCategory(/** @type {string} */ itemId, /** @type {unknown} */ requestedCategory = "") {
    const requested = String(requestedCategory || "").trim();
    return itemCategories.get(itemId) === requested ? requested : itemCategories.get(itemId) || "block";
  },
  getInventoryCount(/** @type {unknown} */ state, /** @type {string} */ itemId, /** @type {string} */ itemCategory) {
    if (!state || typeof state !== "object" || Array.isArray(state)) return 0;
    const stateRecord = /** @type {Record<string, unknown>} */ (state);
    const field = categoryToField[itemCategory] || "inventory";
    const inventory = stateRecord[field];
    if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) return 0;
    const inventoryRecord = /** @type {Record<string, unknown>} */ (inventory);
    return Math.max(0, Math.trunc(Number(inventoryRecord[itemId]) || 0));
  },
  makeRequestId(/** @type {unknown} */ data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return "";
    const record = /** @type {Record<string, unknown>} */ (data);
    return String(record.request_id || record.action_id || "").trim();
  },
});

const beforeState = {
  inventory: { dirt: 2, missing_item: 9 },
  seed_inventory: { apple_seed: 1 },
  tool_inventory: { wrench: 1 },
};
const afterState = {
  inventory: { dirt: 5 },
  seed_inventory: { apple_seed: 0 },
  tool_inventory: { wrench: 1 },
};

assert.deepEqual(helpers.buildInventoryDeltasBetweenStates(beforeState, afterState), [
  {
    item_type: "dirt",
    item_category: "block",
    delta: 3,
    expected_before_amount: 2,
    stack_limit: 10,
  },
  {
    item_type: "apple_seed",
    item_category: "seed",
    delta: -1,
    expected_before_amount: 1,
    stack_limit: 50,
  },
]);

assert.deepEqual(helpers.buildInventoryDeltaClientPayloads([
  { item_type: "dirt", item_category: "block", delta: 7 },
  { item_type: "dirt", item_category: "block", delta: 2 },
  { item_id: "apple_seed", category: "seed", delta: -100 },
  { item_type: "missing_item", item_category: "block", delta: 1 },
  { item_type: "wrench", item_category: "block", delta: 1 },
  { item_type: "gem", item_category: "currency", delta: 0 },
], afterState), [
  {
    item_type: "dirt",
    item_category: "block",
    delta: 7,
    stack_limit: 10,
    after_count: 5,
  },
  {
    item_type: "apple_seed",
    item_category: "seed",
    delta: -50,
    stack_limit: 50,
    after_count: 0,
  },
  {
    item_type: "wrench",
    item_category: "tool",
    delta: 1,
    stack_limit: 1,
    after_count: 1,
  },
]);

assert.deepEqual(helpers.combineRewardEntries([
  { item_id: "dirt", item_category: "block", amount: 7 },
  { item_id: "dirt", category: "block", amount: 8 },
  { item_id: "apple_seed", item_category: "seed", amount: 3 },
  { item_id: "missing_item", item_category: "block", amount: 3 },
  { item_id: "wrench", item_category: "block", amount: 1 },
]), [
  { item_id: "dirt", item_category: "block", amount: 10 },
  { item_id: "apple_seed", item_category: "seed", amount: 3 },
  { item_id: "wrench", item_category: "tool", amount: 1 },
]);

assert.equal(helpers.getPostgresInventoryFailureMessage({ reason: "postgres_unavailable" }), "PostgreSQL is not ready.");
assert.equal(helpers.getPostgresInventoryFailureMessage({ reason: "insufficient_inventory", item_type: "dirt" }), "Not enough dirt.");
assert.equal(helpers.getPostgresInventoryFailureMessage({ reason: "insufficient_capacity", item_type: "dirt" }), "Your inventory cannot hold dirt.");
assert.equal(helpers.getPostgresInventoryFailureMessage({ reason: "missing_world_drop_item_instances", item_type: "dirt" }), "Tracked item data is missing for dirt.");
assert.equal(helpers.getPostgresInventoryFailureMessage({ reason: "player_not_found" }), "Could not load your server inventory.");
assert.equal(helpers.getPostgresInventoryFailureMessage({ reason: "database_error" }), "PostgreSQL rejected the inventory update.");
assert.equal(helpers.getPostgresInventoryFailureMessage({ reason: "other" }, "Fallback."), "Fallback.");

assert.deepEqual(helpers.buildInventoryTransactionResultResponse({
  ok: true,
  request_id: 123,
  action: "drop_pickup",
  message: "Picked up dirt.",
  username: " hasan ",
  rewards: [{ item_id: "dirt", item_category: "block", amount: 2 }],
  player_data: {},
}), {
  type: "inventory_transaction_result",
  ok: true,
  request_id: "123",
  action: "drop_pickup",
  message: "Picked up dirt.",
  username: "hasan",
  rewards: [{ item_id: "dirt", item_category: "block", amount: 2 }],
});

assert.deepEqual(helpers.buildInventoryTransactionRejectedPayload({
  request_id: "req-1",
  action: "seed_place",
  world: " test ",
  x: "4.8",
  y: "9.1",
  seed_type: "apple_seed",
  mature: 1,
  mutated: 0,
}, "Nope."), {
  ok: false,
  request_id: "req-1",
  action: "seed_place",
  message: "Nope.",
  world: "test",
  x: 4,
  y: 9,
  seed_type: "apple_seed",
  mature: true,
  mutated: false,
});

assert.equal(
  packageJson.scripts["build:server-inventory-transaction-helpers"],
  "tsc --project tsconfig.server-inventory-transaction-helpers.json && node scripts/sync_server_inventory_transaction_helpers_build.js"
);
assert.equal(
  packageJson.scripts["check:server-inventory-transaction-helpers"],
  "npm run build:server-inventory-transaction-helpers && node scripts/check_server_inventory_transaction_helpers_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-inventory-transaction-helpers/);
assert.deepEqual(buildConfig.include, ["src/server_inventory_transaction_helpers.ts"]);
assert.match(helperSource, /function createServerInventoryTransactionHelpers/);
assert.match(helperSource, /function buildInventoryDeltasBetweenStates/);
assert.match(helperSource, /function getPostgresInventoryFailureMessage/);
assert.match(generatedSource, /Generated from src\/server_inventory_transaction_helpers\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(syncSource, /server_inventory_transaction_helpers\.js/);
assert.match(serverSource, /require\("\.\/server_inventory_transaction_helpers"\)/);
assert.match(serverSource, /ServerInventoryTransactionHelpers\.buildInventoryTransactionResultResponse/);
assert.match(serverSource, /ServerInventoryTransactionHelpers\.buildInventoryTransactionRejectedPayload/);
assert.match(serverSource, /ServerInventoryTransactionHelpers\.buildInventoryDeltasBetweenStates/);
assert.match(serverSource, /ServerInventoryTransactionHelpers\.buildInventoryDeltaClientPayloads/);
assert.match(serverSource, /ServerInventoryTransactionHelpers\.combineRewardEntries/);
assert.match(serverSource, /ServerInventoryTransactionHelpers\.getPostgresInventoryFailureMessage/);
assert.match(deploySource, /server_inventory_transaction_helpers\.js/);
assert.match(deploySource, /src\/server_inventory_transaction_helpers\.ts/);
assert.match(deploySource, /tsconfig\.server-inventory-transaction-helpers\.json/);
assert.match(deploySource, /sync_server_inventory_transaction_helpers_build\.js/);
assert.match(deploySource, /check_server_inventory_transaction_helpers_build\.js/);
assert.match(deploySource, /npm run build:server-inventory-transaction-helpers/);

console.log("[server-inventory-transaction-helpers] success");
