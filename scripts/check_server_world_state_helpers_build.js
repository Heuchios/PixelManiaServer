#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WorldStateHelpersModule = require("../server_world_state_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_world_state_helpers.ts"), "utf8");
const buildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_world_state_helpers_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-world-state-helpers.json"), "utf8"));
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_world_state_helpers.js"), "utf8");

/** @type {Record<string, any>} */
const itemDefinitions = {
  dirt: { category: "block" },
  bedrock: { category: "block" },
  door: { category: "block" },
  password_door: { category: "block" },
  safe: { category: "block" },
  display_case: { category: "block" },
  world_lock: { category: "block" },
  world_lock_key: { category: "consumable" },
  apple_seed: { category: "seed", max_grow_time: 20 },
  electric_wire: { category: "block", electrical_layer: true },
  metal_pad: { category: "block" },
  generator: { category: "block" },
  electric_pole: { category: "block" },
  gem: { category: "currency" },
};

/** @type {Record<string, any>} */
const itemDatabase = {
  /** @param {unknown} itemId */
  hasItem(itemId) {
    return Boolean(itemDefinitions[String(itemId)]);
  },
  /** @param {unknown} itemId */
  getItemDefinition(itemId) {
    return itemDefinitions[String(itemId)] || null;
  },
  /**
   * @param {unknown} itemId
   * @param {unknown} [requestedCategory]
   */
  resolveItemCategory(itemId, requestedCategory = "") {
    return itemDefinitions[String(itemId)]?.category || String(requestedCategory || "");
  },
  /** @param {unknown} itemId */
  getStackLimit(itemId) {
    if (String(itemId) === "world_lock") return 200;
    return 999;
  },
  /**
   * @param {unknown} itemId
   * @param {unknown} category
   */
  canStoreItemInCategory(itemId, category) {
    return itemDefinitions[String(itemId)]?.category === String(category || "");
  },
  /** @param {unknown} itemId */
  isDropableItem(itemId) {
    return itemId !== "bedrock" && this.hasItem(itemId);
  },
};

const drops = new Map([
  ["drop_a", {
    drop_id: "drop_a",
    item_type: "dirt",
    item_category: "block",
    amount: 2,
    x: 64,
    y: 64,
    stack_grid_x: 2,
    stack_grid_y: 2,
  }],
  ["drop_b", {
    drop_id: "drop_b",
    item_type: "gem",
    item_category: "currency",
    amount: 1,
    x: 64,
    y: 64,
    stack_grid_x: 2,
    stack_grid_y: 2,
  }],
]);

const mockWorldStates = new Map();
let rebuildElectricalNetworksCallCount = 0;
let repairEntranceGateCallCount = 0;

/** @param {unknown} worldName */
function getMockWorldState(worldName) {
  const key = String(worldName || "START");
  if (!mockWorldStates.has(key)) {
    mockWorldStates.set(key, {
      foreground: new Map([["1,1", { x: 1, y: 1, block_type: "password_door" }]]),
      background: new Map(),
      removed_foreground: new Map(),
      removed_background: new Map(),
      seeds: new Map(),
      electrical: new Map(),
      electrical_devices: new Map(),
      interactions: new Map(),
      drops,
      world_lock: {},
      area_locks: [],
    });
  }
  return mockWorldStates.get(key);
}

const helpers = /** @type {any} */ (WorldStateHelpersModule.createWorldStateHelpers({
  itemDatabase,
  itemAtlasDb: {
    /** @param {unknown} id */
    getItemKey(id) {
      return Number(id) === 1 ? "dirt" : "";
    },
    /** @param {unknown} key */
    getItemIdForKey(key) {
      return key === "dirt" ? 1 : 0;
    },
  },
  dropContracts: {
    /** @param {any} input */
    buildSanitizedDropCreate(input) {
      return {
        type: "drop_spawned",
        world: input.world,
        drop_id: input.dropId,
        item_type: input.itemType,
        item_category: input.itemCategory,
        is_seed: input.isSeed,
        amount: input.amount,
        x: input.x,
        y: input.y,
        stack_grid_x: input.stackGrid?.x,
        stack_grid_y: input.stackGrid?.y,
        pickup_delay: input.pickupDelay,
      };
    },
    /** @param {any} input */
    buildSanitizedDropUpdate(input) {
      return {
        type: "world_item_drop_update",
        world: input.world,
        drop_id: input.dropId,
        amount: input.amount,
        x: input.x,
        y: input.y,
      };
    },
    /** @param {any} input */
    buildSanitizedDropPickup(input) {
      return {
        type: "world_item_drop_pickup",
        world: input.world,
        requested_world: input.requestedWorld,
        drop_id: input.dropId,
        player_id: input.playerId,
        name: input.name,
        action_position: input.actionPosition,
      };
    },
    /** @param {any} input */
    buildSanitizedBulkDropPickup(input) {
      return {
        type: "world_item_drop_pickup",
        world: input.world,
        requested_world: input.requestedWorld,
        drop_id: input.dropId,
        drop_ids: input.dropIds,
        bulk_pickup: true,
        player_id: input.playerId,
        name: input.name,
        action_position: input.actionPosition,
      };
    },
  },
  packetContracts: {
    /** @param {any} packet */
    isSameTileBulkDropPickupRequested(packet) {
      return packet.bulk_pickup_same_tile === true;
    },
  },
  cleanWorld: (/** @type {unknown} */ value) => String(value || "START").trim() || "START",
  cleanName: (/** @type {unknown} */ value) => String(value || "").trim(),
  cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim().toLowerCase(),
  clampString: (/** @type {unknown} */ value, /** @type {number} */ limit = 64) => String(value || "").trim().slice(0, limit),
  clampInteger: (/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) => Math.min(max, Math.max(min, Math.trunc(Number(value) || 0))),
  cleanDoorId: (/** @type {unknown} */ value) => String(value || "").trim().slice(0, 32),
  cleanDoorName: (/** @type {unknown} */ value) => String(value || "").trim().slice(0, 64),
  cleanDoorPassword: (/** @type {unknown} */ value) => String(value || "").trim().slice(0, 32),
  cleanDoorDestination: (/** @type {unknown} */ value) => String(value || "").trim().slice(0, 128),
  /**
   * @param {unknown} value
   * @param {unknown} [sourceWorld]
   */
  parseDoorDestination(value, sourceWorld = "START") {
    return {
      destination: String(value || "").trim(),
      target_world: String(sourceWorld || "START").trim() || "START",
      target_door_id: "",
    };
  },
  isDoorBlockType: (/** @type {unknown} */ blockType) => String(blockType || "").includes("door"),
  isPasswordDoorBlockType: (/** @type {unknown} */ blockType) => String(blockType || "") === "password_door",
  isDisplayBlockType: (/** @type {unknown} */ blockType) => String(blockType || "") === "display_case",
  isGridInWorld: (/** @type {number} */ x, /** @type {number} */ y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 100 && y >= 0 && y < 70,
  isPositionInWorldBounds: (/** @type {number} */ x, /** @type {number} */ y) => Number.isFinite(x) && Number.isFinite(y) && x >= -128 && y >= -128 && x <= 3328 && y <= 2368,
  getSeedConfiguredGrowTime: (/** @type {unknown} */ seedType) => Number(itemDefinitions[String(seedType)]?.max_grow_time || 8),
  /**
   * @param {Record<string, any>} data
   * @param {string} [xKey]
   * @param {string} [yKey]
   */
  getTransactionGrid(data, xKey = "x", yKey = "y") {
    const x = Math.trunc(Number(data[xKey]));
    const y = Math.trunc(Number(data[yKey]));
    return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
  },
  /**
   * @param {Record<string, any>} data
   * @param {{ x: number, y: number } | null} [position]
   */
  getTransactionDropGrid(data, position = null) {
    if (data.stack_grid_x !== undefined && data.stack_grid_y !== undefined) {
      return { x: Math.trunc(Number(data.stack_grid_x)), y: Math.trunc(Number(data.stack_grid_y)) };
    }
    return position ? { x: Math.round(Number(position.x) / 32), y: Math.round(Number(position.y) / 32) } : null;
  },
  /** @param {any} position */
  getDropGridFromPosition(position) {
    return position ? { x: Math.round(Number(position.x) / 32), y: Math.round(Number(position.y) / 32) } : null;
  },
  makeServerDropId: () => "server_test_drop",
  sanitizeOptionalDropPickupPosition: () => null,
  resolveDropPickupWorldName: (/** @type {unknown} */ worldName) => String(worldName || "START"),
  ensureWorldState: getMockWorldState,
  makeAuditId: (/** @type {string} */ prefix = "audit") => `${prefix}_test`,
  makeEmptyElectricalNetworkCache: () => ({ by_tile: new Map() }),
  makeEmptyCctvWorldState: () => ({ status: "START" }),
  sanitizeWorldLockState: (/** @type {any} */ state) => ({ ...state }),
  sanitizeAreaLockState: (/** @type {any} */ state) => ({ ...state }),
  getForegroundBlocksForState: (/** @type {any} */ state) => Array.from(state.foreground.values()),
  serializeSeedForMessage: (/** @type {unknown} */ seed) => seed,
  getElectricalLayerForSave: () => [],
  getElectricalDevicesForSave: () => [],
  rebuildElectricalNetworksForState: (/** @type {any} */ state) => {
    rebuildElectricalNetworksCallCount += 1;
    state.electrical_network_version = Number(state.electrical_network_version || 0) + 1;
    return state.electrical_networks;
  },
  repairEntranceGateState: (/** @type {any} */ state) => {
    repairEntranceGateCallCount += 1;
    state.entrance_gate_repaired = true;
    return state;
  },
  getActiveWorldBackgroundTheme: () => "",
  getEffectiveWorldLockStateInState: () => ({}),
  sanitizeAreaLocksList: (/** @type {unknown} */ locks) => Array.isArray(locks) ? locks : [],
  sanitizeCctvWorldState: (/** @type {any} */ state) => ({ ...state }),
  buildActiveWorldEventSnapshot: () => ({}),
  worldBackgroundThemes: new Set(["night", "snow"]),
  worldWidth: 100,
  worldHeight: 70,
  bedrockStartY: 66,
  snowStormEventType: "snow_storm",
  snowStormEventDurationMs: 10 * 60 * 1000,
  maxSignTextLength: 500,
  maxMailboxMessageLength: 128,
  maxBulletinBoardMessageLength: 220,
  vendLogLimit: 30,
  safeSlotCount: 10,
  mailboxMessageLimit: 20,
  bulletinBoardMessageLimit: 30,
  tackleBoxCooldownMs: 4 * 60 * 60 * 1000,
  chickenProductionMs: 12 * 60 * 60 * 1000,
  chickenHungerMs: 7 * 24 * 60 * 60 * 1000,
  cowProductionMs: 12 * 60 * 60 * 1000,
  cowHungerMs: 7 * 24 * 60 * 60 * 1000,
  duckProductionMs: 12 * 60 * 60 * 1000,
  duckHungerMs: 7 * 24 * 60 * 60 * 1000,
  maxDropTileAmount: 2000,
  maxDropIdLength: 96,
  maxBulkDropPickupIds: 48,
  maxElectricalPadsPerGenerator: 20,
  maxElectricalPolesPerGenerator: 20,
  maxPoleLinksPerPole: 10,
  electricalWireItem: "electric_wire",
  electricalMetalPadItem: "metal_pad",
  electricalGeneratorItem: "generator",
  electricalPoleItem: "electric_pole",
  electricalDeviceWire: "wire",
  electricalDeviceMetalPad: "metal_pad",
  electricalDeviceGenerator: "generator",
  electricalDevicePole: "electric_pole",
  electricalItemTypes: new Set(["electric_wire", "metal_pad", "generator", "electric_pole"]),
  electricalValidDeviceTypes: new Set(["wire", "metal_pad", "generator", "electric_pole"]),
  electricalSignalModes: new Set(["on_off", "power_storage", "power_output", "signal", "gate"]),
  electricalGeneratorMaxWatts: 1000,
  safeBlockType: "safe",
  worldLockKeyItemType: "world_lock_key",
  oilRefineryOutputCapacity: 200,
  oilRefineryBatteryInputCapacity: 400,
  oilRefineryBatteryWatts: 20,
  oilRefineryBatteryWattCapacity: 8000,
  oilRefineryConsumptionWattsPerHour: 100,
  batteryChargerOutputCapacity: 200,
  batteryChargerConsumptionWattsPerHour: 80,
  batteryChargerOutputPerHour: 3,
}));

assert.equal(helpers.createEmptyWorldState().foreground instanceof Map, true);
assert.deepEqual(helpers.normalizeBlockEntry({ x: 1.9, y: 2.1, type: "dirt" }), {
  x: 1,
  y: 2,
  block_type: "dirt",
});
assert.equal(helpers.normalizeBlockEntry({ x: 1, y: 2, type: "missing" }), null);
assert.deepEqual(helpers.normalizeRemovedBlockEntry({ x: 3, y: 4, type: "" }), {
  x: 3,
  y: 4,
  block_type: "",
});
assert.equal(helpers.normalizeSeedEntry({ x: 1, y: 2, seed_type: "apple_seed" }).max_grow_time, 20);
assert.equal(helpers.normalizeElectricalEntry({ x: 5, y: 6, item_id: "electric_wire" }).device_type, "wire");
const generatorEntry = helpers.normalizeElectricalDeviceStateEntry({
  x: 5,
  y: 6,
  item_id: "generator",
  watts: 250,
  linked_pad_keys: ["7,8"],
  linked_pole_keys: ["9,10"],
});
assert.equal(generatorEntry.device_type, "generator");
assert.equal(generatorEntry.watts, 250);
assert.deepEqual(generatorEntry.linked_pad_keys, ["7,8"]);
assert.deepEqual(generatorEntry.linked_pole_keys, ["9,10"]);
const poleEntry = helpers.normalizeElectricalDeviceStateEntry({ x: 7, y: 8, item_id: "electric_pole", linked_pole_keys: ["7,8", "8,8"] });
assert.deepEqual(poleEntry.linked_pole_keys, ["8,8"]);
assert.equal(helpers.sanitizeWorldBackgroundTheme("snow"), "snow");
assert.equal(helpers.sanitizeWorldBackgroundTheme("sunset"), "");
const loadedBlocks = new Map();
helpers.loadGridArrayIntoMap(loadedBlocks, [
  { x: 1.9, y: 2.1, type: "dirt" },
  { x: 1, y: 2, type: "missing" },
], helpers.normalizeBlockEntry);
assert.equal(loadedBlocks.get("1,2").block_type, "dirt");
assert.equal(loadedBlocks.size, 1);
const loadedWorldState = helpers.createEmptyWorldState();
helpers.loadSavedWorldGridData(loadedWorldState, {
  world_cleared: true,
  blocks: [{ x: 1, y: 2, block_type: "dirt" }],
  background_blocks: [{ x: 3, y: 4, block_type: "dirt" }],
  removed_foreground: [{ x: 5, y: 6, block_type: "dirt" }],
  removed_background: [{ x: 7, y: 8, block_type: "dirt" }],
  planted_seeds: [{ x: 9, y: 10, seed_type: "apple_seed", mature: true }],
});
assert.equal(loadedWorldState.cleared, true);
assert.equal(loadedWorldState.foreground.get("1,2").block_type, "dirt");
assert.equal(loadedWorldState.foreground.get("0,66").block_type, "bedrock");
assert.equal(loadedWorldState.background.get("3,4").block_type, "dirt");
assert.equal(loadedWorldState.removed_foreground.get("5,6").block_type, "dirt");
assert.equal(loadedWorldState.removed_background.get("7,8").block_type, "dirt");
assert.equal(loadedWorldState.seeds.get("9,10").seed_type, "apple_seed");
const manyRemovedBlocks = Array.from({ length: 3301 }, (_, index) => ({
  x: index % 100,
  y: Math.floor(index / 100),
  block_type: "dirt",
}));
const repairedWorldState = helpers.createEmptyWorldState();
helpers.loadSavedWorldGridData(repairedWorldState, { removed_foreground: manyRemovedBlocks });
assert.equal(repairedWorldState.cleared, true);
assert.equal(repairedWorldState.removed_foreground.size, 0);
assert.equal(repairedWorldState.removed_background.size, 0);
assert.equal(repairedWorldState.foreground.get("0,66").block_type, "bedrock");
const loadedElectricalState = helpers.createEmptyWorldState();
helpers.loadElectricalDataIntoState(loadedElectricalState, {
  electrical_layer: [
    { x: 1, y: 2, item_id: "electric_wire" },
    { x: 3, y: 4, item_id: "metal_pad" },
  ],
  electrical_devices: [
    { x: 5, y: 6, item_id: "generator", watts: 300, linked_pad_keys: ["3,4"], linked_pole_keys: ["7,8"] },
    { x: 7, y: 8, item_id: "electric_pole", linked_pole_keys: ["7,8", "8,8"] },
  ],
});
assert.equal(loadedElectricalState.electrical.get("1,2").device_type, "wire");
assert.equal(loadedElectricalState.electrical_devices.get("3,4").device_type, "metal_pad");
assert.equal(loadedElectricalState.background.get("3,4").block_type, "metal_pad");
assert.equal(loadedElectricalState.electrical_devices.get("5,6").watts, 300);
assert.equal(loadedElectricalState.foreground.get("5,6").block_type, "generator");
assert.deepEqual(loadedElectricalState.electrical_devices.get("7,8").linked_pole_keys, ["8,8"]);
assert.equal(helpers.normalizeEventTimestamp("2026-01-02T03:04:05Z"), "2026-01-02T03:04:05.000Z");
const eventTile = helpers.normalizeWorldEventTileEntry({
  x: 12.9,
  y: 13.1,
  original_block_id: "bedrock",
  event_block_id: "dirt",
  changed_at: "2026-01-02T03:04:05Z",
  source: "storm",
}, "event_a");
assert.equal(eventTile.x, 12);
assert.equal(eventTile.y, 13);
assert.equal(eventTile.event_id, "event_a");
assert.equal(eventTile.changed_at, "2026-01-02T03:04:05.000Z");
const eventState = helpers.createEmptyWorldState();
helpers.loadWorldEventStateIntoState(eventState, {
  active_event: {
    event_type: "snow_storm",
    changed_tiles: [
      { x: 1, y: 2, event_block_id: "dirt", original_block_id: "bedrock" },
      { x: 3, y: 4, event_block_id: "missing" },
    ],
  },
});
assert.equal(eventState.active_event_type, "snow_storm");
assert.equal(eventState.event_id, "event_test");
assert.equal(eventState.event_changed_tiles.length, 1);
const beforeDeserializeRebuildCount = rebuildElectricalNetworksCallCount;
const beforeDeserializeGateRepairCount = repairEntranceGateCallCount;
const deserializedState = helpers.deserializeWorldState("WORLD", {
  blocks: [{ x: 1, y: 2, block_type: "dirt" }],
  background_blocks: [{ x: 2, y: 2, block_type: "dirt" }],
  planted_seeds: [{ x: 3, y: 3, seed_type: "apple_seed", mature: true }],
  electrical_layer: [{ x: 4, y: 4, item_id: "electric_wire" }],
  electrical_devices: [{ x: 5, y: 5, item_id: "generator", watts: 100 }],
  interactions: [{ action: "sign_text", x: 6, y: 6, text: "hello" }],
  drops: [{ drop_id: "drop_saved", item_type: "dirt", item_category: "block", amount: 2, x: 64, y: 64 }],
  world_lock: { owner_username: "uso", area_locks: [{ x: 1, y: 1 }] },
  cctv_state: { status: "ok" },
  active_event_type: "snow_storm",
  event_changed_tiles: [{ x: 7, y: 7, event_block_id: "dirt", original_block_id: "bedrock" }],
});
assert.equal(deserializedState.foreground.get("1,2").block_type, "dirt");
assert.equal(deserializedState.background.get("2,2").block_type, "dirt");
assert.equal(deserializedState.seeds.get("3,3").seed_type, "apple_seed");
assert.equal(deserializedState.electrical.get("4,4").device_type, "wire");
assert.equal(deserializedState.electrical_devices.get("5,5").device_type, "generator");
assert.equal(deserializedState.interactions.get("6,6").text, "hello");
assert.equal(deserializedState.drops.get("drop_saved").amount, 2);
assert.equal(deserializedState.world_lock.owner_username, "uso");
assert.equal(deserializedState.area_locks.length, 1);
assert.equal(deserializedState.cctv_state.status, "ok");
assert.equal(deserializedState.event_changed_tiles.length, 1);
assert.equal(deserializedState.entrance_gate_repaired, true);
assert.equal(rebuildElectricalNetworksCallCount, beforeDeserializeRebuildCount + 1);
assert.equal(repairEntranceGateCallCount, beforeDeserializeGateRepairCount + 1);
assert.equal(helpers.deserializeWorldState("WORLD", null).foreground instanceof Map, true);
assert.deepEqual(helpers.sanitizeBlockUpdate({ action: "place", x: 1, y: 2, item_id: 1 }, "WORLD"), {
  type: "world_block_update",
  action: "place",
  layer: "foreground",
  x: 1,
  y: 2,
  block_type: "dirt",
  item_id: 1,
  source_tool: "",
  water_bucket_action: "",
  world: "WORLD",
});
assert.equal(helpers.sanitizeElectricalLayerUpdate({ action: "place", x: 1, y: 2, item_id: "electric_wire" }, "WORLD").device_type, "wire");
const vendState = helpers.sanitizeVendState({
  owner_username: "Uso",
  listing: { item_id: "dirt", stock: 3, amount_per_sale: 1, price_wls: 2 },
  logs: [{ buyer_username: "Buyer", item_id: "dirt", amount: 1, price_wls: 2 }],
}, "WORLD", 4, 5);
assert.equal(vendState.owner_name, "USO");
assert.equal(vendState.listing.item_id, "dirt");
assert.equal(vendState.logs[0].buyer_username, "buyer");
const safeState = helpers.sanitizeSafeState({
  owner_username: "Uso",
  slots: [{ item_id: "dirt", amount: 5 }, { item_id: "safe", amount: 1 }],
}, "WORLD", 4, 5);
assert.equal(safeState.slots.length, 1);
assert.equal(safeState.slots[0].amount, 5);
const displayState = helpers.sanitizeDisplayState({
  owner_username: "Uso",
  slot: { item_id: "dirt", source_transaction_id: "tx_display", source_inventory_occupied_slots: 64 },
}, "WORLD", 4, 5);
assert.equal(displayState.slot.display_transaction_id, "tx_display");
assert.equal(displayState.slot.source_inventory_occupied_slots, 64);
assert.equal(helpers.sanitizeDisplaySlot({ item_id: "display_case", amount: 1 }), null);
assert.equal(helpers.sanitizeMailboxState({ messages: [{ from: "Uso", message: "hello" }, { message: "" }] }, "WORLD", 1, 2).messages[0].from, "USO");
assert.equal(helpers.sanitizeBulletinBoardState({ messages: [{ player_name: "Uso", message: "posted" }] }, "WORLD", 1, 2).messages[0].username, "USO");
const futureReady = Date.now() + 10000;
assert.equal(helpers.sanitizeTackleBoxState({ next_harvest_at_ms: futureReady }, "WORLD", 1, 2).next_harvest_at_ms, futureReady);
assert.equal(helpers.sanitizeChickenState({ ready: true, hungry_since_at_ms: 1 }, "WORLD", 1, 2).status, "ready");
assert.equal(helpers.sanitizeCowState({ next_harvest_at_ms: futureReady }, "WORLD", 1, 2).status, "producing");
assert.equal(helpers.sanitizeDuckState({ hungry_since_at_ms: 1 }, "WORLD", 1, 2).status, "hungry");
assert.equal(helpers.sanitizeDiceState({ face: 4, rolled_by: "Uso", roll_id: "roll1" }, "WORLD", 1, 2).rolled_number, 4);
assert.equal(helpers.sanitizeAntiPunchState({ enabled: true, block_type: "anti_punch" }, "WORLD", 1, 2).enabled, true);
assert.equal(helpers.sanitizeAntiTalkState({ enabled: true }, "WORLD", 1, 2).block_type, "anti_talk");
assert.equal(helpers.sanitizeAntiGravityState({ enabled: false }, "WORLD", 1, 2).enabled, false);
const oilState = helpers.sanitizeOilRefineryState({
  enabled: true,
  running: true,
  battery_count: 3,
  output_count: 201,
  crude_progress: 1.5,
  linked_pole_x: 7,
  linked_pole_y: 8,
}, "WORLD", 10, 11);
assert.equal(oilState.output_count, 200);
assert.equal(oilState.battery_watts, 60);
assert.equal(oilState.battery_count, 3);
assert.equal(oilState.crude_progress, 0.999999);
assert.equal(oilState.linked_pole_key, "7,8");
const chargerState = helpers.sanitizeBatteryChargerState({
  machine_enabled: true,
  output_count: 999,
  charge_ratio: 0.5,
  pole_key: "9,10",
}, "WORLD", 12, 13);
assert.equal(chargerState.enabled, true);
assert.equal(chargerState.output_count, 200);
assert.equal(chargerState.battery_progress, 0.5);
assert.equal(chargerState.linked_pole_key, "9,10");
helpers.applyInteractionUpdateToWorldState("WORLD", {
  action: "door_state",
  x: 1,
  y: 1,
  locked: true,
  door_id: "door-a",
  destination: "WORLD:door-b",
  target_world: "WORLD",
  target_door_id: "door-b",
  password: "secret",
  door_name: "Main",
});
assert.equal(getMockWorldState("WORLD").interactions.get("1,1").password, "secret");
helpers.applyInteractionUpdateToWorldState("WORLD", { action: "world_lock_state", state: { owner_username: "uso" } });
assert.equal(getMockWorldState("WORLD").world_lock.owner_username, "uso");
helpers.applyInteractionUpdateToWorldState("WORLD", { action: "area_lock_state", state: [{ x: 1, y: 2 }] });
assert.equal(getMockWorldState("WORLD").area_locks.length, 1);
helpers.applyInteractionUpdateToWorldState("WORLD", {
  action: "mailbox_state",
  x: 2,
  y: 3,
  state: { messages: [{ from: "Uso", message: "mail" }] },
});
assert.equal(getMockWorldState("WORLD").interactions.get("2,3").messages[0].message, "mail");
helpers.applyInteractionUpdateToWorldState("WORLD", {
  action: "display_state",
  x: 4,
  y: 5,
  state: { owner_username: "Uso", slot: { item_id: "dirt" } },
});
assert.equal(getMockWorldState("WORLD").interactions.get("4,5").slot.item_id, "dirt");
helpers.applyInteractionUpdateToWorldState("WORLD", { action: "anti_punch_state", x: 6, y: 7, enabled: true });
assert.equal(getMockWorldState("WORLD").interactions.get("6,7").enabled, true);
helpers.applyInteractionUpdateToWorldState("WORLD", { action: "anti_punch_state", x: 6, y: 7, enabled: false });
assert.equal(getMockWorldState("WORLD").interactions.has("6,7"), false);
helpers.applyInteractionUpdateToWorldState("WORLD", { action: "theme_machine_state", x: 8, y: 9, enabled: true, theme: "snow" });
assert.equal(getMockWorldState("WORLD").interactions.get("8,9").theme, "snow");
helpers.applyInteractionUpdateToWorldState("WORLD", { action: "oil_refinery_state", x: 10, y: 11, battery_count: 2 });
assert.equal(getMockWorldState("WORLD").interactions.get("10,11").battery_watts, 40);
helpers.applyInteractionUpdateToWorldState("WORLD", { action: "battery_charger_state", x: 12, y: 13, production_progress: 0.25 });
assert.equal(getMockWorldState("WORLD").interactions.get("12,13").battery_progress, 0.25);
const savedInteractions = new Map();
helpers.loadInteractionsIntoMap(savedInteractions, [
  {
    action: "door_state",
    x: 14,
    y: 15,
    locked: true,
    door_id: "saved-door",
    door_name: "Saved",
    destination: "TARGET:door-b",
    target_world: "TARGET",
    target_door_id: "door-b",
    password: "secret",
  },
  { action: "anti_punch_state", x: 6, y: 7, enabled: false },
  { action: "anti_talk_state", x: 6, y: 8, enabled: true },
  { action: "theme_machine_state", x: 8, y: 9, enabled: true, theme: "snow" },
  { action: "oil_refinery_state", x: 10, y: 11, battery_count: 2 },
  { action: "battery_charger_state", x: 12, y: 13, charge_ratio: 0.25 },
  { action: "missing_state", x: 1, y: 2 },
], "WORLD");
assert.equal(savedInteractions.get("14,15").password, "secret");
assert.equal(savedInteractions.has("6,7"), false);
assert.equal(savedInteractions.get("6,8").block_type, "anti_talk");
assert.equal(savedInteractions.get("8,9").theme, "snow");
assert.equal(savedInteractions.get("10,11").battery_watts, 40);
assert.equal(savedInteractions.get("12,13").battery_progress, 0.25);
assert.equal(savedInteractions.has("1,2"), false);
const savedDrops = new Map();
helpers.loadDropsIntoMap(savedDrops, [
  { drop_id: "saved_drop", item_type: "dirt", item_category: "block", amount: 3, x: 64, y: 64, stack_grid_x: 2, stack_grid_y: 2 },
  { drop_id: "missing_item", item_type: "missing", x: 64, y: 64 },
  { drop_id: "out_of_bounds", item_type: "dirt", x: 99999, y: 64 },
]);
assert.equal(savedDrops.get("saved_drop").amount, 3);
assert.equal(savedDrops.get("saved_drop").stack_grid_x, 2);
assert.equal(savedDrops.has("missing_item"), false);
assert.equal(savedDrops.has("out_of_bounds"), false);
assert.equal(helpers.sanitizeDropCreate({ item_type: "dirt", x: 64, y: 64, amount: 2 }, "WORLD").drop_id, "server_test_drop");
assert.equal(helpers.sanitizeDropUpdate({ drop_id: "drop_a", amount: 1 }, "WORLD").amount, 1);
assert.equal(helpers.sanitizeDropPickup({ drop_id: "drop_a" }, "WORLD", { id: "p1", name: "Uso" }).player_id, "p1");
assert.deepEqual(
  helpers.sanitizeBulkDropPickup({ drop_id: "drop_a", bulk_pickup_same_tile: true }, "WORLD", { id: "p1", name: "Uso" }).drop_ids,
  ["drop_a", "drop_b"]
);
const verboseWorldLayer = [
  { x: 1, y: 2, block_type: "dirt", item_id: 100 },
  { x: 3, y: 4, block_type: "door", item_id: 200, door_id: "entry", locked: true },
  { x: 5, y: 6, block_type: "bedrock" },
];
const compactWorldLayer = helpers.compactWorldLayerEntriesForNetwork(verboseWorldLayer);
assert.equal(compactWorldLayer["1,2"], 100);
assert.deepEqual(compactWorldLayer["3,4"], {
  block_type: "door",
  item_id: 200,
  door_id: "entry",
  locked: true,
});
assert.deepEqual(compactWorldLayer["5,6"], { block_type: "bedrock" });
assert.ok(
  Buffer.byteLength(JSON.stringify(compactWorldLayer)) < Buffer.byteLength(JSON.stringify(verboseWorldLayer)),
  "dictionary world layers must be smaller than verbose arrays",
);
assert.equal(helpers.serializeWorldState("WORLD").world_state_version, 1);

assert.equal(
  packageJson.scripts["build:server-world-state-helpers"],
  "tsc --project tsconfig.server-world-state-helpers.json && node scripts/sync_server_world_state_helpers_build.js"
);
assert.equal(
  packageJson.scripts["check:server-world-state-helpers"],
  "npm run build:server-world-state-helpers && node scripts/check_server_world_state_helpers_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-world-state-helpers/);
assert.deepEqual(buildConfig.include, ["src/server_world_state_helpers.ts"]);
assert.match(buildSource, /Generated from src\/server_world_state_helpers\.ts/);
assert.match(helperSource, /function createWorldStateHelpers/);
assert.match(helperSource, /function deserializeWorldState/);
assert.match(helperSource, /function applyInteractionUpdateToWorldState/);
assert.match(helperSource, /function sanitizeBlockUpdate/);
assert.match(helperSource, /function sanitizeVendState/);
assert.match(helperSource, /function sanitizeSafeState/);
assert.match(helperSource, /function sanitizeDisplayState/);
assert.match(helperSource, /function sanitizeMailboxState/);
assert.match(helperSource, /function sanitizeBulletinBoardState/);
assert.match(helperSource, /function sanitizeChickenState/);
assert.match(helperSource, /function sanitizeDiceState/);
assert.match(helperSource, /function sanitizeAntiPunchState/);
assert.match(helperSource, /function sanitizeOilRefineryState/);
assert.match(helperSource, /function sanitizeBatteryChargerState/);
assert.match(helperSource, /function addBedrockFloorEntries/);
assert.match(helperSource, /function loadGridArrayIntoMap/);
assert.match(helperSource, /function loadSavedWorldGridData/);
assert.match(helperSource, /function normalizeElectricalDeviceStateEntry/);
assert.match(helperSource, /function loadElectricalDataIntoState/);
assert.match(helperSource, /function normalizeEventTimestamp/);
assert.match(helperSource, /function normalizeWorldEventTileEntry/);
assert.match(helperSource, /function loadWorldEventStateIntoState/);
assert.match(helperSource, /function loadInteractionsIntoMap/);
assert.match(helperSource, /function loadDropsIntoMap/);
assert.match(helperSource, /function compactWorldLayerEntriesForNetwork/);
assert.match(helperSource, /function serializeWorldState/);
assert.match(generatedSource, /Generated from src\/server_world_state_helpers\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(serverSource, /require\("\.\/server_world_state_helpers"\)/);
assert.match(serverSource, /WorldStateHelpers\.deserializeWorldState/);
assert.match(serverSource, /WorldStateHelpers\.applyInteractionUpdateToWorldState/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeBlockUpdate/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeVendState/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeSafeState/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeDisplayState/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeMailboxState/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeBulletinBoardState/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeChickenState/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeDiceState/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeAntiPunchState/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeOilRefineryState/);
assert.match(serverSource, /WorldStateHelpers\.sanitizeBatteryChargerState/);
assert.match(serverSource, /WorldStateHelpers\.addBedrockFloorEntries/);
assert.match(serverSource, /WorldStateHelpers\.loadGridArrayIntoMap/);
assert.match(serverSource, /WorldStateHelpers\.normalizeElectricalDeviceStateEntry/);
assert.match(serverSource, /WorldStateHelpers\.loadElectricalDataIntoState/);
assert.match(serverSource, /WorldStateHelpers\.normalizeEventTimestamp/);
assert.match(serverSource, /WorldStateHelpers\.normalizeWorldEventTileEntry/);
assert.match(serverSource, /WorldStateHelpers\.loadWorldEventStateIntoState/);
assert.match(serverSource, /WorldStateHelpers\.loadInteractionsIntoMap/);
assert.match(serverSource, /WorldStateHelpers\.loadDropsIntoMap/);
assert.match(serverSource, /WorldStateHelpers\.compactWorldLayerEntriesForNetwork/);
assert.match(serverSource, /world_state_encoding: "grid_dictionary_v1"/);
assert.match(serverSource, /WorldStateHelpers\.serializeWorldState/);
assert.match(deploySource, /server_world_state_helpers\.js/);
assert.match(deploySource, /src\/server_world_state_helpers\.ts/);
assert.match(deploySource, /tsconfig\.server-world-state-helpers\.json/);
assert.match(deploySource, /sync_server_world_state_helpers_build\.js/);
assert.match(deploySource, /npm run build:server-world-state-helpers/);

console.log("[server-world-state-helpers] success");
