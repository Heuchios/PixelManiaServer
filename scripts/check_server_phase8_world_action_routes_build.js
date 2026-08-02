#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Phase8WorldActionRoutesModule = require("../server_phase8_world_action_routes");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const dispatcherSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase7_dispatcher.ts"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase8_world_action_routes.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_phase8_world_action_routes.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_phase8_world_action_routes_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-phase8-world-action-routes.json"), "utf8"));

const dependencyBlockMatch = helperSource.match(/const \{([\s\S]*?)\n  \} = deps;/);
assert.ok(dependencyBlockMatch, "phase8 world action route dependency block exists");
const dependencyNames = Array.from(dependencyBlockMatch[1].matchAll(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)/gm), (match) => match[1]);
/** @type {Record<string, any>} */
const deps = {};
for (const name of dependencyNames) {
  deps[name] = () => {
    throw new Error(`Unexpected dependency call: ${name}`);
  };
}

/** @type {unknown[]} */
const sent = [];
/** @type {{ action: string, message: string, extra?: Record<string, unknown> }[]} */
const rejected = [];
/** @type {string[]} */
const events = [];

function record(/** @type {string} */ value) {
  events.push(value);
}

Object.assign(deps, {
  POSTGRES_AUTHORITATIVE: false,
  POSTGRES_ENABLED: false,
  ELECTRICAL_DEVICE_GENERATOR: "generator",
  ELECTRICAL_DEVICE_METAL_PAD: "metal_pad",
  ELECTRICAL_DEVICE_POLE: "electric_pole",
  ELECTRICAL_GENERATOR_ITEM: "generator",
  ELECTRICAL_POLE_ITEM: "electric_pole",
  ELECTRICAL_GENERATOR_MAX_WATTS: 1000,
  ELECTRICAL_MAX_PADS_PER_GENERATOR: 4,
  ELECTRICAL_MAX_POLES_PER_GENERATOR: 4,
  ELECTRICAL_MAX_POLE_LINKS_PER_POLE: 4,
  ELECTRICAL_MAX_TRANSFORMER_LINKS_PER_POLE: 2,
  MAX_GRID_ACTION_DISTANCE_PIXELS: 96,
  MAX_ITEM_ID_LENGTH: 64,
  worldBlockActionLocks: new Set(),
  worldSpecialBlockActionLocks: new Set(),
  worldStates: new Map(),

  requireAuthenticated: () => true,
  requireSameWorld: () => true,
  requireBuildPermission: () => true,
  rejectIfWorldBanned: async () => false,
  shouldAllowPhase7DevJsonFallback: () => false,
  isPostgresAuthoritativeReady: () => true,
  makeRequestId: () => "req-8",
  cleanWorld: (/** @type {unknown} */ value) => String(value || "START").trim().toUpperCase(),
  cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim().toLowerCase(),
  clampString: (/** @type {unknown} */ value, /** @type {number} */ limit = 64) => String(value || "").slice(0, limit),
  clampInteger: (/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) => Math.max(min, Math.min(max, Math.trunc(Number(value) || 0))),
  getPlayerCurrentWorldName: () => "START",
  getPlayerValidationPosition: () => ({ ok: true, x: 0, y: 0, facing: 1, source: "check" }),
  beginPhase7BlockActionContext: () => record("block_context"),
  clearPhase7BlockActionContext: () => record("clear_block_context"),
  releaseLiveActionLock: () => record("release_lock"),
  sanitizeBlockUpdate: () => ({ action: "place", block_type: "stone", layer: "foreground", x: 1, y: 2 }),
  sanitizeElectricalLayerUpdate: () => ({ action: "place", block_type: "electric_wire", layer: "electrical", x: 1, y: 2 }),
  sanitizeSeedUpdate: () => ({ action: "place", seed_type: "apple_seed", x: 1, y: 2 }),
  validateSeedUpdateAgainstServerState: async () => ({ ok: false }),
  sendActionRejected: (/** @type {unknown} */ _socket, /** @type {string} */ action, /** @type {string} */ message, /** @type {Record<string, unknown>} */ extra = {}) => {
    rejected.push({ action, message, extra });
  },
  sanitizeEquipmentSlots: (/** @type {unknown} */ slots) => slots,
  sendElectricalVisibilityRefresh: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ world) => record(`wire_refresh:${world}`),
  isGridInWorld: () => true,
  gridKey: (/** @type {number} */ x, /** @type {number} */ y) => `${x},${y}`,
  isPlayerNearGrid: () => true,
  canPlayerViewElectricalLayer: () => true,
  playerHasElectricToolEquipped: () => false,
  canPlayerBuildAtGrid: () => true,
  ensureWorldState: () => ({ electrical: new Map() }),
  getGeneratorDeviceStateAt: () => ({ x: 3, y: 4, device_type: "generator", watts: 10, max_watts: 1000 }),
  makeGeneratorDataPayload: (/** @type {unknown} */ world, /** @type {unknown} */ entry, /** @type {unknown} */ options) => ({ type: "generator_data", world, entry, options }),
  sendJson: (/** @type {unknown} */ _socket, /** @type {unknown} */ payload) => sent.push(payload),
});

const routes = /** @type {any} */ (Phase8WorldActionRoutesModule.createServerPhase8WorldActionRoutes(deps));
const socket = {};
const player = { id: "p1", account_username: "uso", name: "USO", world: "START", equipment_slots: { hand: "electric_tool" } };

(async () => {
  await routes.handleWorldBlockUpdate(socket, player, { type: "world_block_update", world: "other", action_id: "a1" }, { playerId: "p1" });
  assert.equal(rejected.pop()?.extra?.reason, "wrong_world");
  assert.ok(events.includes("block_context"));

  await routes.handleElectricalLayerUpdate(socket, player, { type: "electrical_layer_update", world: "other" }, { playerId: "p1" });
  assert.equal(rejected.pop()?.extra?.reason, "wrong_world");

  await routes.handleRequestWireVisibilityRefresh(socket, player, { type: "request_wire_visibility_refresh", world: "start", equipped_tool: "electric_tool" }, { playerId: "p1" });
  assert.ok(events.includes("wire_refresh:START"));

  await routes.handleRequestOpenGenerator(socket, player, { type: "request_open_generator", world: "start", x: 3, y: 4 }, { playerId: "p1" });
  assert.equal(/** @type {any} */ (sent.pop()).type, "generator_data");

  await routes.handleRequestLinkGeneratorPad(socket, player, { type: "request_link_generator_pad", world: "start", generator_x: 3, generator_y: 4, pad_x: 5, pad_y: 6 }, { playerId: "p1" });
  assert.equal(rejected.pop()?.extra?.reason, "electric_tool_required");

  await routes.handleRequestLinkGeneratorPole(socket, player, { type: "request_link_generator_pole", world: "start", generator_x: 3, generator_y: 4, pole_x: 5, pole_y: 6 }, { playerId: "p1" });
  assert.equal(rejected.pop()?.extra?.reason, "electric_tool_required");

  await routes.handleRequestLinkElectricPoles(socket, player, { type: "request_link_electric_poles", world: "start", pole_a_x: 1, pole_a_y: 2, pole_b_x: 5, pole_b_y: 6 }, { playerId: "p1" });
  assert.equal(rejected.pop()?.extra?.reason, "electric_tool_required");

  await routes.handleWorldSeedUpdate(socket, player, { type: "world_seed_update", world: "start" }, { playerId: "p1" });
  assert.match(helperSource, /function handleWorldBlockUpdate/);
  assert.match(helperSource, /function handleElectricalLayerUpdate/);
  assert.match(helperSource, /function handleWorldSeedUpdate/);
  const breakDropJournalStart = helperSource.indexOf("const dropWorldChangeEntries = emittedDrops.map");
  assert.ok(breakDropJournalStart >= 0, "break drop journal block exists");
  const breakDropJournal = helperSource.slice(breakDropJournalStart, helperSource.indexOf("const electricalGenerationChanges", breakDropJournalStart));
  assert.match(breakDropJournal, /action: "break_drop"/);
  assert.match(breakDropJournal, /item_type: drop\.item_type/);
  assert.match(breakDropJournal, /x: drop\.x/);
  assert.match(breakDropJournal, /y: drop\.y/);
  assert.match(breakDropJournal, /stack_grid_x: drop\.stack_grid_x/);
  assert.match(breakDropJournal, /stack_grid_y: drop\.stack_grid_y/);
  assert.match(breakDropJournal, /pickup_delay: drop\.pickup_delay/);
  assert.match(generatedSource, /Generated from src\/server_phase8_world_action_routes\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.deepEqual(buildConfig.include, ["src/server_phase8_world_action_routes.ts"]);
  assert.match(syncSource, /server_phase8_world_action_routes\.js/);
  assert.match(serverSource, /require\("\.\/server_phase8_world_action_routes"\)/);
  assert.match(serverSource, /createServerPhase8WorldActionRoutes/);
  assert.match(serverSource, /handleWorldBlockUpdate/);
  assert.match(serverSource, /handleElectricalLayerUpdate/);
  assert.match(serverSource, /handleWorldSeedUpdate/);
  assert.match(dispatcherSource, /DIRECT_HANDLER_ROUTE_TYPES/);
  assert.match(dispatcherSource, /"world_block_update"/);
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-phase8-world-action-routes/);
  assert.match(deploySource, /server_phase8_world_action_routes\.js/);
  assert.match(deploySource, /src\/server_phase8_world_action_routes\.ts/);
  assert.match(deploySource, /tsconfig\.server-phase8-world-action-routes\.json/);
  assert.match(deploySource, /check_server_phase8_world_action_routes_build\.js/);
  assert.match(deploySource, /sync_server_phase8_world_action_routes_build\.js/);
  assert.match(deploySource, /npm run build:server-phase8-world-action-routes/);

  console.log("[server-phase8-world-action-routes] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
