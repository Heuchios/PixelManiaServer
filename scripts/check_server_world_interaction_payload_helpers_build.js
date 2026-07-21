#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WorldInteractionPayloadHelpersModule = require("../server_world_interaction_payload_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_world_interaction_payload_helpers.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_world_interaction_payload_helpers.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_world_interaction_payload_helpers_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-world-interaction-payload-helpers.json"), "utf8"));

/** @type {any} */
const helpers = WorldInteractionPayloadHelpersModule.createServerWorldInteractionPayloadHelpers({
  chickenBlockType: "chicken",
  cowBlockType: "cow",
  duckBlockType: "duck",
  oilRefineryOutputCapacity: 5,
  oilRefineryBatteryInputCapacity: 3,
  batteryChargerOutputCapacity: 4,
  cleanWorld(/** @type {unknown} */ value) {
    return String(value || "START").trim().toUpperCase() || "START";
  },
  clampInteger(/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) {
    const parsed = Math.trunc(Number(value) || 0);
    return Math.max(min, Math.min(max, parsed));
  },
  clampString(/** @type {unknown} */ value, /** @type {number | undefined} */ limit = 64) {
    return String(value || "").trim().slice(0, limit);
  },
  sanitizeTackleBoxState(/** @type {any} */ rawEntry, /** @type {unknown} */ worldName, /** @type {unknown} */ x, /** @type {unknown} */ y) {
    return {
      action: "tackle_box_state",
      world: String(rawEntry?.world || worldName || ""),
      x: Math.trunc(Number(x) || 0),
      y: Math.trunc(Number(y) || 0),
      next_harvest_at_ms: Math.trunc(Number(rawEntry?.next_harvest_at_ms) || 0),
      cooldown_ms: Math.trunc(Number(rawEntry?.cooldown_ms) || 0),
    };
  },
  sanitizeChickenState(/** @type {any} */ rawEntry, /** @type {unknown} */ worldName, /** @type {unknown} */ x, /** @type {unknown} */ y) {
    return { action: "chicken_state", world: rawEntry?.world || worldName, x, y, status: rawEntry?.status || "hungry" };
  },
  sanitizeCowState(/** @type {any} */ rawEntry, /** @type {unknown} */ worldName, /** @type {unknown} */ x, /** @type {unknown} */ y) {
    return { action: "cow_state", world: rawEntry?.world || worldName, x, y, status: rawEntry?.status || "hungry" };
  },
  sanitizeDuckState(/** @type {any} */ rawEntry, /** @type {unknown} */ worldName, /** @type {unknown} */ x, /** @type {unknown} */ y) {
    return { action: "duck_state", world: rawEntry?.world || worldName, x, y, status: rawEntry?.status || "hungry" };
  },
  sanitizeBulletinBoardState(/** @type {any} */ rawEntry, /** @type {unknown} */ worldName, /** @type {unknown} */ x, /** @type {unknown} */ y) {
    return {
      action: "bulletin_board_state",
      world: rawEntry?.world || worldName,
      x,
      y,
      messages: Array.isArray(rawEntry?.messages) ? rawEntry.messages : [],
      updated_at: "now",
    };
  },
  serializeChickenStateForClient(/** @type {any} */ chicken) {
    return { action: "chicken_state", world: chicken.world, x: Number(chicken.x), y: Number(chicken.y), status: chicken.status };
  },
  serializeCowStateForClient(/** @type {any} */ cow) {
    return { action: "cow_state", world: cow.world, x: Number(cow.x), y: Number(cow.y), status: cow.status };
  },
  serializeDuckStateForClient(/** @type {any} */ duck) {
    return { action: "duck_state", world: duck.world, x: Number(duck.x), y: Number(duck.y), status: duck.status };
  },
  serializeBulletinBoardStateForClient(/** @type {any} */ board, /** @type {any} */ receiverPlayer = null) {
    return {
      action: "bulletin_board_state",
      world: String(board.world || ""),
      x: Number(board.x),
      y: Number(board.y),
      messages: board.messages,
      can_manage: Boolean(receiverPlayer?.can_manage),
      updated_at: board.updated_at,
    };
  },
  makeOilRefineryStatePayload(/** @type {unknown} */ worldName, /** @type {any} */ oilState) {
    return {
      type: "world_interaction_update",
      action: "oil_refinery_state",
      world: String(worldName || "").trim().toUpperCase(),
      x: Math.trunc(Number(oilState?.x) || 0),
      y: Math.trunc(Number(oilState?.y) || 0),
      output_count: Math.trunc(Number(oilState?.output_count) || 0),
    };
  },
  makeBatteryChargerStatePayload(/** @type {unknown} */ worldName, /** @type {any} */ chargerState) {
    return {
      type: "world_interaction_update",
      action: "battery_charger_state",
      world: String(worldName || "").trim().toUpperCase(),
      x: Math.trunc(Number(chargerState?.x) || 0),
      y: Math.trunc(Number(chargerState?.y) || 0),
      output_count: Math.trunc(Number(chargerState?.output_count) || 0),
    };
  },
  ensureWorldState(/** @type {unknown} */ _worldName) {
    return {
      foreground: new Map([["3,4", { block_type: "password_door", door_password: "from-block" }]]),
      interactions: new Map([["3,4", { door_password: "secret" }]]),
    };
  },
  gridKey(/** @type {unknown} */ x, /** @type {unknown} */ y) {
    return `${Math.trunc(Number(x) || 0)},${Math.trunc(Number(y) || 0)}`;
  },
  cleanDoorPassword(/** @type {unknown} */ value) {
    return String(value || "").trim();
  },
  isPasswordDoorBlockType(/** @type {unknown} */ blockType) {
    return String(blockType || "") === "password_door";
  },
});

assert.deepEqual(helpers.sanitizeTackleBoxPayloadForClient({
  type: "world_interaction_update",
  world: " start ",
  operation: "harvest",
  block_type: "water_well",
  state: { x: 7.9, y: 8.2, next_harvest_at_ms: 12345, cooldown_ms: 6000 },
}), {
  action: "tackle_box_state",
  world: "START",
  x: 7,
  y: 8,
  next_harvest_at_ms: 12345,
  cooldown_ms: 6000,
  type: "world_interaction_update",
  operation: "harvest",
  block_type: "water_well",
});

assert.deepEqual(helpers.sanitizeChickenPayloadForClient({
  world: " farm ",
  operation: "feed",
  state: { x: 1, y: 2, status: "ready" },
}), {
  action: "chicken_state",
  world: "FARM",
  x: 1,
  y: 2,
  status: "ready",
  type: "world_interaction_update",
  block_type: "chicken",
  operation: "feed",
});

assert.deepEqual(helpers.sanitizeCowPayloadForClient({
  type: "custom",
  world: " ranch ",
  block_type: "golden_cow",
  state: { x: 3, y: 4, status: "producing" },
}), {
  action: "cow_state",
  world: "RANCH",
  x: 3,
  y: 4,
  status: "producing",
  type: "custom",
  block_type: "golden_cow",
});

assert.deepEqual(helpers.sanitizeDuckPayloadForClient({
  world: " pond ",
  state: { x: 5, y: 6, status: "hungry" },
}), {
  action: "duck_state",
  world: "POND",
  x: 5,
  y: 6,
  status: "hungry",
  type: "world_interaction_update",
  block_type: "duck",
});

assert.deepEqual(helpers.sanitizeBulletinBoardPayloadForClient({
  type: "world_interaction_update",
  operation: "POST",
  state: { world: "social", x: 9, y: 10, messages: [{ message: "hi" }] },
}, "", { can_manage: true }), {
  action: "bulletin_board_state",
  world: "social",
  x: 9,
  y: 10,
  messages: [{ message: "hi" }],
  can_manage: true,
  updated_at: "now",
  type: "world_interaction_update",
  operation: "post",
});

assert.deepEqual(helpers.sanitizeWorldInteractionPayloadForClient({
  action: "oil_refinery_state",
  world: "factory",
  x: 2,
  y: 3,
  operation: "COLLECT",
  opened: 1,
  collected_count: 99,
  added_battery_count: 99,
}), {
  type: "world_interaction_update",
  action: "oil_refinery_state",
  world: "FACTORY",
  x: 2,
  y: 3,
  output_count: 0,
  operation: "collect",
  opened: true,
  collected_count: 5,
  added_battery_count: 3,
});

assert.deepEqual(helpers.sanitizeWorldInteractionPayloadForClient({
  action: "battery_charger_state",
  world: "power",
  x: 11,
  y: 12,
  operation: "OPEN",
  opened: 0,
  collected_count: 99,
}), {
  type: "world_interaction_update",
  action: "battery_charger_state",
  world: "POWER",
  x: 11,
  y: 12,
  output_count: 0,
  operation: "open",
  opened: false,
  collected_count: 4,
});

assert.deepEqual(helpers.sanitizeWorldInteractionPayloadForClient({
  action: "door_state",
  world: "doors",
  x: 3,
  y: 4,
  block_type: "password_door",
  password: "secret",
  door_password: "secret",
  password_changed: true,
}), {
  action: "door_state",
  world: "doors",
  x: 3,
  y: 4,
  block_type: "password_door",
  password_configured: true,
});

assert.deepEqual(helpers.sanitizeWorldInteractionPayloadForClient({
  action: "door_state",
  world: "doors",
  x: 1,
  y: 1,
  block_type: "wooden_door",
  password_configured: true,
}), {
  action: "door_state",
  world: "doors",
  x: 1,
  y: 1,
  block_type: "wooden_door",
});

assert.deepEqual(helpers.sanitizeWorldInteractionPayloadForClient({
  action: "sign_text",
  message: "hello",
}), {
  action: "sign_text",
  message: "hello",
});

assert.equal(
  packageJson.scripts["build:server-world-interaction-payload-helpers"],
  "tsc --project tsconfig.server-world-interaction-payload-helpers.json && node scripts/sync_server_world_interaction_payload_helpers_build.js"
);
assert.equal(
  packageJson.scripts["check:server-world-interaction-payload-helpers"],
  "npm run build:server-world-interaction-payload-helpers && node scripts/check_server_world_interaction_payload_helpers_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-world-interaction-payload-helpers/);
assert.deepEqual(buildConfig.include, ["src/server_world_interaction_payload_helpers.ts"]);
assert.match(helperSource, /function createServerWorldInteractionPayloadHelpers/);
assert.match(helperSource, /function sanitizeWorldInteractionPayloadForClient/);
assert.match(helperSource, /function sanitizeDoorPayloadForClient/);
assert.match(generatedSource, /Generated from src\/server_world_interaction_payload_helpers\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(syncSource, /server_world_interaction_payload_helpers\.js/);
assert.match(serverSource, /require\("\.\/server_world_interaction_payload_helpers"\)/);
assert.match(serverSource, /ServerWorldInteractionPayloadHelpers\.sanitizeWorldInteractionPayloadForClient/);
assert.match(serverSource, /ServerWorldInteractionPayloadHelpers\.sanitizeChickenPayloadForClient/);
assert.match(serverSource, /ServerWorldInteractionPayloadHelpers\.sanitizeCowPayloadForClient/);
assert.match(serverSource, /ServerWorldInteractionPayloadHelpers\.sanitizeDuckPayloadForClient/);
assert.match(deploySource, /server_world_interaction_payload_helpers\.js/);
assert.match(deploySource, /src\/server_world_interaction_payload_helpers\.ts/);
assert.match(deploySource, /tsconfig\.server-world-interaction-payload-helpers\.json/);
assert.match(deploySource, /sync_server_world_interaction_payload_helpers_build\.js/);
assert.match(deploySource, /check_server_world_interaction_payload_helpers_build\.js/);
assert.match(deploySource, /npm run build:server-world-interaction-payload-helpers/);

console.log("[server-world-interaction-payload-helpers] success");
