#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const InventoryEconomyRoutesModule = require("../server_inventory_economy_routes");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_inventory_economy_routes.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_inventory_economy_routes.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_inventory_economy_routes_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-inventory-economy-routes.json"), "utf8"));

/** @type {Record<string, any>} */
const player = {
  authenticated: true,
  account_username: "uso",
  id: "player-1",
  world: "START",
};
/** @type {Record<string, any>} */
const socket = { playerId: player.id };
/** @type {Map<string, string>} */
const tradeByPlayerId = new Map();
/** @type {Map<string, Record<string, any>>} */
const states = new Map([
  ["uso", {
    inventory_slot_count: 20,
    currency_inventory: { gem: 20 },
    inventory: {},
  }],
]);
/** @type {Record<string, any>[]} */
const results = [];
/** @type {Record<string, any>[]} */
const rejections = [];
/** @type {Record<string, any>[]} */
const delegated = [];
/** @type {Record<string, any>[]} */
const commits = [];
/** @type {any[][]} */
const itemLedgers = [];
/** @type {any[][]} */
const rewardLedgers = [];
/** @type {Record<string, any>[]} */
const shopLogs = [];
/** @type {string[]} */
const systemChats = [];
let auditSequence = 0;

/**
 * @param {any} value
 * @returns {any}
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {Record<string, any>} state
 * @param {string} itemId
 * @param {string} itemCategory
 * @returns {number}
 */
function getInventoryCount(state, itemId, itemCategory) {
  const field = itemCategory === "currency" ? "currency_inventory" : "inventory";
  return Number(state?.[field]?.[itemId] || 0);
}

/**
 * @param {Record<string, any>} state
 * @param {string} itemId
 * @param {string} itemCategory
 * @param {number} amount
 * @returns {boolean}
 */
function spendItemFromState(state, itemId, itemCategory, amount) {
  const field = itemCategory === "currency" ? "currency_inventory" : "inventory";
  const current = getInventoryCount(state, itemId, itemCategory);
  if (current < amount) return false;
  state[field] = state[field] || {};
  state[field][itemId] = current - amount;
  return true;
}

/**
 * @param {Record<string, any>} state
 * @param {string} itemId
 * @param {string} itemCategory
 * @param {number} amount
 * @returns {boolean}
 */
function addItemToState(state, itemId, itemCategory, amount) {
  const field = itemCategory === "currency" ? "currency_inventory" : "inventory";
  state[field] = state[field] || {};
  state[field][itemId] = getInventoryCount(state, itemId, itemCategory) + amount;
  return true;
}

/**
 * @param {Record<string, any>[]} rewards
 * @returns {Record<string, any>[]}
 */
function combineRewardEntries(rewards) {
  /** @type {Map<string, Record<string, any>>} */
  const combined = new Map();
  for (const reward of rewards) {
    const key = `${reward.item_category}:${reward.item_id}`;
    const current = combined.get(key) || { ...reward, amount: 0 };
    current.amount += reward.amount;
    combined.set(key, current);
  }
  return Array.from(combined.values());
}

/**
 * @param {string} name
 * @returns {(socket: unknown, player: Record<string, any>, data: Record<string, any>) => Promise<void>}
 */
function delegate(name) {
  return async (_socket, _player, data) => {
    delegated.push({ name, action: data.action });
  };
}

/** @param {...any} args */
function captureItemLedger(...args) {
  itemLedgers.push(args);
}

/** @param {...any} args */
function captureRewardLedger(...args) {
  rewardLedgers.push(args);
}

/** @type {Record<string, any>} */
const ItemDatabase = {
  hasItem: (/** @type {unknown} */ itemId) => ["dirt", "gem"].includes(String(itemId || "")),
  canStoreItemInCategory: (
    /** @type {unknown} */ itemId,
    /** @type {unknown} */ category,
  ) => (
    (itemId === "dirt" && category === "block")
    || (itemId === "gem" && category === "currency")
  ),
  getStackLimit: (/** @type {unknown} */ itemId) => itemId === "gem" ? 999999 : 200,
};

/** @type {any} */
const routeDeps = {
  BASIC_ITEMS_PACK_TABLE: [],
  HAIR_PACK_TABLE: [],
  INVENTORY_MAX_SLOT_COUNT: 300,
  INVENTORY_SLOT_UPGRADE_STEP: 20,
  ItemDatabase,
  LURE_PACK_TABLE: [],
  MAX_SHOP_PRICE: 999999,
  PRESTIGE_COLOURED_BLOCK_PACK_TABLE: [],
  SHOP_CATALOG: new Map([
    ["dirt", { item_id: "dirt", item_category: "block", amount: 2, price: 5 }],
  ]),
  addItemToState,
  buildInventoryDeltaClientPayloads: (/** @type {Record<string, any>[]} */ deltas) => deltas,
  buildInventoryUpgradePreview: (/** @type {number} */ slots) => ({
    current_slots: slots,
    next_slots: Math.min(300, slots + 20),
    inventory_upgrade_cost: slots >= 300 ? 0 : 10,
    cost: slots >= 300 ? 0 : 10,
  }),
  buildPlayerStateForClient: (/** @type {Record<string, any>} */ state) => cloneJson(state),
  clampInteger: (
    /** @type {unknown} */ value,
    /** @type {number} */ min,
    /** @type {number} */ max,
  ) => Math.max(min, Math.min(max, Math.trunc(Number(value) || 0))),
  clampString: (/** @type {unknown} */ value) => String(value || "").trim(),
  cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim(),
  cloneJson,
  combineRewardEntries,
  commitPlayerInventoryState: async (
    /** @type {unknown} */ _socket,
    /** @type {Record<string, any>} */ _player,
    /** @type {string} */ username,
    /** @type {Record<string, any>} */ beforeState,
    /** @type {Record<string, any>} */ afterState,
    /** @type {Record<string, any>} */ options,
  ) => {
    const committedState = cloneJson(afterState);
    states.set(username, committedState);
    commits.push({ username, beforeState, afterState: committedState, options });
    return {
      ok: true,
      state: committedState,
      deltas: [{ item_type: "gem", item_category: "currency", delta: -options.metadata.cost_gems || -5 }],
      postgres_committed: true,
    };
  },
  ensureWritablePlayerState: (/** @type {unknown} */ username) => states.get(String(username || "")) || null,
  getInventoryCount,
  handleDisplayTransaction: delegate("display"),
  handleDropInventoryItemTransaction: delegate("drop"),
  handleFishMongerTransaction: delegate("fish_monger"),
  handleFishingCompleteTransaction: delegate("fishing_complete"),
  handleFishingStartTransaction: delegate("fishing_start"),
  handleSafeTransaction: delegate("safe"),
  handleSeedHarvestTransaction: delegate("seed_harvest"),
  handleSeedPlaceTransaction: delegate("seed_place"),
  handleSeedSpliceTransaction: delegate("seed_splice"),
  handleStationRecipeTransaction: delegate("station"),
  handleTrashInventoryItemTransaction: delegate("trash"),
  handleVendingTransaction: delegate("vending"),
  handleWorldLockConversionTransaction: delegate("world_lock_conversion"),
  handleWorldLockGetKeyTransaction: delegate("world_lock_get_key"),
  logItemLedgerForState: captureItemLedger,
  logRewardLedgers: captureRewardLedger,
  logShopPurchase: (
    /** @type {unknown} */ _socket,
    /** @type {Record<string, any>} */ _player,
    /** @type {Record<string, any>} */ entry,
  ) => shopLogs.push(entry),
  makeAuditId: (/** @type {string} */ prefix) => `${prefix}-${++auditSequence}`,
  makeRequestId: (/** @type {Record<string, any>} */ data) => String(data.request_id || ""),
  requireAuthenticated: (
    /** @type {unknown} */ _socket,
    /** @type {Record<string, any>} */ currentPlayer,
  ) => Boolean(currentPlayer.authenticated),
  resolveInventorySlotCount: (
    /** @type {Record<string, any>} */ state,
  ) => Number(state.inventory_slot_count || 20),
  rollWeightedReward: (
    /** @type {Record<string, any>[]} */ table,
  ) => table[0],
  sendInventoryTransactionRejected: (
    /** @type {unknown} */ _socket,
    /** @type {Record<string, any>} */ data,
    /** @type {string} */ message,
  ) => rejections.push({ action: data.action, message }),
  sendInventoryTransactionResult: (
    /** @type {unknown} */ _socket,
    /** @type {Record<string, any>} */ payload,
  ) => results.push(payload),
  sendSystemChatToPlayer: (
    /** @type {unknown} */ _socket,
    /** @type {Record<string, any>} */ _player,
    /** @type {string} */ message,
  ) => systemChats.push(message),
  spendItemFromState,
  tradeByPlayerId,
};

/** @type {any} */
const routes = InventoryEconomyRoutesModule.createServerInventoryEconomyRoutes(routeDeps);

(async () => {
  await routes.handleInventoryTransactionRequest(socket, player, {
    action: "vend_get_state",
    request_id: "vend-1",
  });
  assert.deepEqual(delegated.pop(), { name: "vending", action: "vend_get_state" });

  await routes.handleInventoryTransactionRequest(socket, player, {
    action: "world_lock_get_key",
    request_id: "lock-1",
  });
  assert.deepEqual(delegated.pop(), { name: "world_lock_get_key", action: "world_lock_get_key" });

  await routes.handleInventoryTransactionRequest(socket, player, {
    action: "not_real",
    request_id: "unknown-1",
  });
  assert.deepEqual(rejections.pop(), {
    action: "not_real",
    message: "Unknown inventory transaction.",
  });

  await routes.handleInventoryTransactionRequest(socket, player, {
    action: "shop_buy",
    request_id: "shop-1",
    item_id: "dirt",
    amount: 2,
    price: 5,
  });
  const shopResult = /** @type {Record<string, any>} */ (results.pop());
  assert.equal(shopResult.ok, true);
  assert.equal(shopResult.action, "shop_buy");
  assert.deepEqual(shopResult.rewards, [{ item_id: "dirt", item_category: "block", amount: 2 }]);
  assert.equal(states.get("uso")?.currency_inventory?.gem, 15);
  assert.equal(states.get("uso")?.inventory?.dirt, 2);
  assert.equal(commits.at(-1)?.options?.source, "shop");
  assert.equal(shopLogs.length, 1);
  assert.equal(itemLedgers.length, 1);
  assert.equal(rewardLedgers.length, 1);

  await routes.handleInventoryUpgradePurchase(socket, player, {
    request_id: "upgrade-1",
  });
  const upgradeResult = /** @type {Record<string, any>} */ (results.pop());
  assert.equal(upgradeResult.ok, true);
  assert.equal(upgradeResult.inventory_slot_count, 40);
  assert.equal(upgradeResult.spent_gems, 10);
  assert.equal(states.get("uso")?.currency_inventory?.gem, 5);
  assert.equal(commits.at(-1)?.options?.source, "inventory_upgrade");

  await routes.handleInventoryUpgradePurchase(socket, player, {
    request_id: "upgrade-2",
  });
  assert.equal(results.at(-1)?.reason, "insufficient_gems");
  assert.equal(systemChats.at(-1), "you dont have enough gems for this purchase.");

  tradeByPlayerId.set(player.id, "trade-1");
  await routes.handleInventoryUpgradePurchase(socket, player, {
    request_id: "upgrade-3",
  });
  assert.equal(results.at(-1)?.message, "Finish or cancel your trade before upgrading inventory.");

  assert.equal(
    packageJson.scripts["build:server-inventory-economy-routes"],
    "tsc --project tsconfig.server-inventory-economy-routes.json && node scripts/sync_server_inventory_economy_routes_build.js",
  );
  assert.equal(
    packageJson.scripts["check:server-inventory-economy-routes"],
    "npm run build:server-inventory-economy-routes && node scripts/check_server_inventory_economy_routes_build.js",
  );
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-inventory-economy-routes/);
  assert.deepEqual(buildConfig.include, ["src/server_inventory_economy_routes.ts"]);
  assert.match(helperSource, /function createServerInventoryEconomyRoutes/);
  assert.match(helperSource, /async function handleInventoryTransactionRequest/);
  assert.match(helperSource, /async function handleInventoryUpgradePurchase/);
  assert.match(helperSource, /async function handleShopBuyTransaction/);
  assert.match(helperSource, /source: "shop"/);
  assert.match(generatedSource, /Generated from src\/server_inventory_economy_routes\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.match(syncSource, /server_inventory_economy_routes\.js/);
  assert.match(serverSource, /require\("\.\/server_inventory_economy_routes"\)/);
  assert.match(serverSource, /createServerInventoryEconomyRoutes/);
  assert.match(serverSource, /getServerInventoryEconomyRoutes\(\)\.handleInventoryTransactionRequest/);
  assert.match(serverSource, /getServerInventoryEconomyRoutes\(\)\.handleInventoryUpgradePurchase/);
  assert.match(serverSource, /getServerInventoryEconomyRoutes\(\)\.handleShopBuyTransaction/);
  assert.match(deploySource, /server_inventory_economy_routes\.js/);
  assert.match(deploySource, /src\/server_inventory_economy_routes\.ts/);
  assert.match(deploySource, /tsconfig\.server-inventory-economy-routes\.json/);
  assert.match(deploySource, /check_server_inventory_economy_routes_build\.js/);
  assert.match(deploySource, /sync_server_inventory_economy_routes_build\.js/);
  assert.match(deploySource, /npm run build:server-inventory-economy-routes/);

  console.log("[server-inventory-economy-routes] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
