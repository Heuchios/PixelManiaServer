#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PlayerStateHelpersModule = require("../server_player_state_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const playerStateSource = fs.readFileSync(path.join(repoRoot, "src", "server_player_state_helpers.ts"), "utf8");
const buildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_player_state_helpers_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-player-state-helpers.json"), "utf8"));
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_player_state_helpers.js"), "utf8");

/** @type {Record<string, any>} */
const definitions = {
  dirt: { category: "block" },
  gem: { category: "currency" },
  wrench: { category: "tool", equipable: true, equipment_slot: "hand" },
  wings: { category: "back", equipable: true, equipment_slot: "back" },
  crown: { category: "hat", equipable: true, equipment_slot: "hat" },
  secret: { category: "tool", hidden: true },
};

/** @type {Record<string, string>} */
const fieldByCategory = {
  block: "inventory",
  currency: "currency_inventory",
  tool: "tool_inventory",
  back: "back_inventory",
  hat: "hat_inventory",
};

/** @type {Record<string, any>} */
const itemDatabase = {
  /** @param {unknown} value */
  cleanCategory(value) {
    return String(value || "").trim();
  },
  /**
   * @param {unknown} itemId
   * @param {string} [requestedCategory]
   */
  resolveItemCategory(itemId, requestedCategory = "") {
    return definitions[String(itemId)]?.category || this.cleanCategory(requestedCategory);
  },
  /**
   * @param {unknown} itemId
   * @param {unknown} category
   */
  canStoreItemInCategory(itemId, category) {
    return definitions[String(itemId)]?.category === this.cleanCategory(category);
  },
  /**
   * @param {unknown} itemId
   * @param {string} [requestedCategory]
   */
  getInventoryFieldForItem(itemId, requestedCategory = "") {
    const category = this.resolveItemCategory(itemId, requestedCategory);
    return fieldByCategory[category] || "";
  },
  /** @param {unknown} itemId */
  getItemDefinition(itemId) {
    return definitions[String(itemId)] || null;
  },
  /** @param {unknown} itemId */
  getStackLimit(itemId) {
    return itemId === "gem" ? 999999 : 200;
  },
  /** @param {unknown} itemId */
  hasItem(itemId) {
    return Boolean(definitions[String(itemId)]);
  },
};

const helpers = /** @type {any} */ (PlayerStateHelpersModule.createPlayerStateHelpers({
  itemDatabase,
  cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim(),
  clampInteger: (/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) => Math.min(max, Math.max(min, Math.trunc(Number(value) || 0))),
  clampString: (/** @type {unknown} */ value, /** @type {number} */ limit = 64) => String(value || "").trim().slice(0, limit),
  maxPlayerInventoryKeys: 500,
  inventoryMinSlotCount: 20,
  inventoryMaxSlotCount: 300,
  inventorySlotUpgradeStep: 20,
  inventorySlotUpgradeCosts: [2000, 4000, 6000],
  playerLevelMin: 1,
  playerLevelMax: 100,
  playerXpFirstLevel: 300,
  hotbarSlotCount: 6,
}));

assert.equal(helpers.getXpNeededForLevel(1), 300);
assert.equal(helpers.getPlayerTitleForLevel(1), "Explorer");
assert.equal(helpers.normalizeProgressionState({ player_level: 1, player_xp: 350 }).player_level, 2);
assert.deepEqual(helpers.sanitizeCountDictionary({ dirt: "3", missing: 4, gem: 5 }, 500, "block"), { dirt: 3 });
assert.equal(helpers.normalizeInventorySlotCount(21), 40);
assert.deepEqual(helpers.buildInventoryUpgradePreview(20), {
  inventory_slot_count: 20,
  current_slots: 20,
  next_inventory_slot_count: 40,
  next_slots: 40,
  inventory_upgrade_cost: 2000,
  cost: 2000,
  max_slots: 300,
  step: 20,
});
assert.deepEqual(helpers.normalizeInventoryAmountEntry({ item_type: "gem", amount: "7" }), {
  item_id: "gem",
  item_category: "currency",
  amount: 7,
});

const state = /** @type {Record<string, any>} */ (helpers.sanitizePlayerState({
  account_username: " uso ",
  inventory: { dirt: 5 },
  currency_inventory: { gem: 10 },
  tool_inventory: { wrench: 1, secret: 1 },
  back_inventory: { wings: 1 },
  selected_item_type: "dirt",
  selected_item_category: "block",
  hotbar_items: ["punch", "dirt", "secret"],
  hotbar_item_categories: ["tool", "block", "tool"],
  equipped_tool: "wrench",
  equipped_back_item: "wings",
  equipped_hat_item: "crown",
}, "uso"));
assert.ok(state);

assert.equal(state.account_username, "uso");
assert.equal(state.equipped_tool, "wrench");
assert.equal(state.equipped_back_item, "wings");
assert.equal(state.equipped_hat_item, "");
assert.deepEqual(state.hotbar_items, ["punch", "dirt"]);
assert.equal(helpers.getInventoryCount(state, "dirt", "block"), 5);
assert.equal(helpers.getInventoryOccupiedSlotCount(state), 3);

const overCapacityState = { inventory_slot_count: 20, inventory: {} };
for (let index = 0; index < 21; index += 1) {
  const itemId = `reserved_item_${index}`;
  definitions[itemId] = { category: "block" };
  overCapacityState.inventory[itemId] = 1;
}
assert.equal(helpers.getInventoryOccupiedSlotCount(overCapacityState), 21);
overCapacityState.inventory.reserved_item_20 = 0;
assert.equal(helpers.canRestoreReservedInventorySlot(overCapacityState, 21), true);
overCapacityState.inventory.replacement_item = 1;
definitions.replacement_item = { category: "block" };
assert.equal(helpers.canRestoreReservedInventorySlot(overCapacityState, 21), false);
assert.deepEqual(helpers.sanitizeEquipmentSlots({ hand: "wrench", back: "wings", hat: "crown" }, state), {
  hand: "wrench",
  back: "wings",
  hat: "",
  hair: "",
  eyewear: "",
  shirt: "",
  pants: "",
  shoes: "",
  ride: "",
});

state.tool_inventory.wrench = 0;
assert.equal(helpers.clearUnavailableEquipmentInState(state), true);
assert.equal(state.equipped_tool, "");

const player = { equipment_slots: { hand: "wrench", back: "" } };
state.tool_inventory.wrench = 1;
state.equipped_tool = "wrench";
assert.equal(helpers.syncPlayerEquipmentSlotsFromState(player, state), true);
assert.equal(player.equipment_slots.hand, "wrench");

assert.equal(
  packageJson.scripts["build:server-player-state-helpers"],
  "tsc --project tsconfig.server-player-state-helpers.json && node scripts/sync_server_player_state_helpers_build.js"
);
assert.equal(
  packageJson.scripts["check:server-player-state-helpers"],
  "npm run build:server-player-state-helpers && node scripts/check_server_player_state_helpers_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-player-state-helpers/);
assert.deepEqual(buildConfig.include, ["src/server_player_state_helpers.ts"]);
assert.match(buildSource, /Generated from src\/server_player_state_helpers\.ts/);
assert.match(playerStateSource, /function createPlayerStateHelpers/);
assert.match(playerStateSource, /function getInventoryOccupiedSlotCount/);
assert.match(playerStateSource, /function canRestoreReservedInventorySlot/);
assert.match(playerStateSource, /function sanitizePlayerState/);
assert.match(playerStateSource, /function sanitizeEquipmentSlots/);
assert.match(generatedSource, /Generated from src\/server_player_state_helpers\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(serverSource, /require\("\.\/server_player_state_helpers"\)/);
assert.match(serverSource, /PlayerStateHelpers\.sanitizePlayerState/);
assert.match(serverSource, /PlayerStateHelpers\.sanitizeEquipmentSlots/);
assert.match(deploySource, /server_player_state_helpers\.js/);
assert.match(deploySource, /src\/server_player_state_helpers\.ts/);
assert.match(deploySource, /tsconfig\.server-player-state-helpers\.json/);
assert.match(deploySource, /sync_server_player_state_helpers_build\.js/);
assert.match(deploySource, /npm run build:server-player-state-helpers/);

console.log("[server-player-state-helpers] success");
