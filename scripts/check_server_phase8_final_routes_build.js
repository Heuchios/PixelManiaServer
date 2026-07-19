#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Phase8FinalRoutesModule = require("../server_phase8_final_routes");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const dispatcherSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase7_dispatcher.ts"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase8_final_routes.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_phase8_final_routes.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_phase8_final_routes_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-phase8-final-routes.json"), "utf8"));

const dependencyBlockMatch = helperSource.match(/const \{([\s\S]*?)\n  \} = deps;/);
assert.ok(dependencyBlockMatch, "phase8 final route dependency block exists");
const dependencyNames = Array.from(dependencyBlockMatch[1].matchAll(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)/gm), (match) => match[1]);

/** @type {Record<string, any>} */
const deps = {};
for (const name of dependencyNames) {
  deps[name] = () => {
    throw new Error(`Unexpected dependency call: ${name}`);
  };
}

/** @type {string[]} */
const events = [];
/** @type {{ action: string, message: string, extra?: Record<string, unknown> }[]} */
const rejected = [];

function record(/** @type {string} */ event) {
  events.push(event);
}

Object.assign(deps, {
  playerNetworkStats: {
    player_position_messages_received: 0,
    accepted_player_position_messages: 0,
    rejected_player_position_messages: 0,
    stale_player_position_messages: 0,
    corrected_player_position_messages: 0,
    duplicated_player_position_heartbeats: 0,
    queued_player_position_updates: 0,
  },
  tradeByPlayerId: new Set(["p1"]),
  requireAuthenticated: () => true,
  requireSameWorld: () => true,
  rejectIfWorldBanned: async () => false,
  requireBuildPermission: () => true,
  cleanWorld: (/** @type {unknown} */ value) => String(value || "START").trim().toUpperCase(),
  cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim().toLowerCase(),
  cleanName: (/** @type {unknown} */ value) => String(value || "").trim(),
  makeRequestId: () => "req-final",
  makeAuditId: (/** @type {string} */ prefix) => `${prefix}-audit`,
  sendActionRejected: (/** @type {unknown} */ _socket, /** @type {string} */ action, /** @type {string} */ message, /** @type {Record<string, unknown>} */ extra = {}) => {
    rejected.push({ action, message, extra });
  },

  sanitizeInteractionUpdate: () => ({ action: "springboard_animation", x: 1, y: 2 }),
  prepareSpringboardAnimationUpdate: () => true,
  queueWorldUpdateBroadcast: (/** @type {string} */ world) => record(`interaction_broadcast:${world}`),
  touchLivePresence: () => record("touch_presence"),

  sanitizeDropUpdate: () => ({ type: "world_item_drop_update", world: "START", drop_id: "drop-1" }),
  validateDropUpdateAgainstServerState: () => true,
  applyDropUpdateToWorldState: () => record("drop_update_apply"),
  queueWorldSave: (/** @type {string} */ world) => record(`world_save:${world}`),
  sendWorldUpdateToRequesterAndWorld: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {string} */ world, /** @type {Record<string, unknown>} */ payload) => {
    record(`world_update:${world}:${payload.type || payload.action || ""}`);
  },
  logWorldChange: () => record("world_change_log"),

  shouldUseBulkDropPickup: () => true,
  handleBulkDropPickup: async (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ _data, /** @type {string} */ world) => {
    record(`bulk_pickup:${world}`);
  },

  sanitizePlayerPosition: () => ({ world: "START", x: 32, y: 64, facing: 1 }),
  enforceStandardMovementForSocket: () => false,
  usesTrustedMovementPosition: () => true,
  debugNetfoxAction: (/** @type {string} */ label) => record(`debug:${label}`),
  getTrustedMovementModeLabel: () => "trusted",
});

const routes = /** @type {any} */ (Phase8FinalRoutesModule.createServerPhase8FinalRoutes(deps));
const socket = {};
const player = {
  id: "p1",
  account_username: "uso",
  name: "USO",
  world: "START",
  joined_world: true,
  equipment_slots: {},
};

function getLegacyBody() {
  const marker = "async function runLegacyPhase8Route()";
  const start = serverSource.indexOf(marker);
  if (start < 0) return "";
  const open = serverSource.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < serverSource.length; i += 1) {
    const char = serverSource[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return serverSource.slice(open + 1, i);
    }
  }
  throw new Error("Could not parse runLegacyPhase8Route");
}

(async () => {
  await routes.handleWorldInteractionUpdate(socket, player, { type: "world_interaction_update", world: "start" }, { playerId: "p1" });
  assert.ok(events.includes("interaction_broadcast:START"));
  assert.ok(events.includes("touch_presence"));

  await routes.handleWorldItemDropCreate(socket, player, { type: "world_item_drop_create", world: "start" }, { playerId: "p1" });
  assert.equal(rejected.pop()?.action, "world_item_drop_create");

  await routes.handleWorldItemDropUpdate(socket, player, { type: "world_item_drop_update", world: "start" }, { playerId: "p1" });
  assert.ok(events.includes("drop_update_apply"));
  assert.ok(events.includes("world_save:START"));

  await routes.handleWorldItemDropPickup(socket, player, { type: "world_item_drop_pickup", world: "start", drop_ids: ["drop-1", "drop-2"] }, { playerId: "p1" });
  assert.ok(events.includes("bulk_pickup:START"));

  await routes.handlePlayerPosition(socket, player, { type: "player_position", world: "start" }, { playerId: "p1" });
  assert.equal(deps.playerNetworkStats.player_position_messages_received, 1);
  assert.ok(events.includes("debug:ignored legacy player_position in trusted movement mode"));

  const legacyBody = getLegacyBody();
  assert.doesNotMatch(legacyBody, /if \(data\.type === "world_block_update"\)/);
  assert.doesNotMatch(legacyBody, /if \(data\.type === "electrical_layer_update"\)/);
  assert.doesNotMatch(legacyBody, /if \(data\.type === "world_interaction_update"\)/);
  assert.doesNotMatch(legacyBody, /if \(PacketContracts\.isWorldDropCreatePacket\(data\)\)/);
  assert.doesNotMatch(legacyBody, /if \(PacketContracts\.isWorldDropPickupRequestPacket\(data\)\)/);
  assert.doesNotMatch(legacyBody, /if \(data\.type === "player_position"\)/);

  assert.match(helperSource, /function handleWorldInteractionUpdate/);
  assert.match(helperSource, /function handleWorldItemDropPickup/);
  assert.match(helperSource, /function handlePlayerPosition/);
  assert.match(generatedSource, /Generated from src\/server_phase8_final_routes\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.deepEqual(buildConfig.include, ["src/server_phase8_final_routes.ts"]);
  assert.match(syncSource, /server_phase8_final_routes\.js/);
  assert.match(serverSource, /require\("\.\/server_phase8_final_routes"\)/);
  assert.match(serverSource, /createServerPhase8FinalRoutes/);
  assert.match(serverSource, /handleWorldInteractionUpdate/);
  assert.match(serverSource, /handleWorldItemDropCreate/);
  assert.match(serverSource, /handleWorldItemDropPickup/);
  assert.match(serverSource, /handlePlayerPosition/);
  assert.match(dispatcherSource, /DIRECT_HANDLER_ROUTE_TYPES/);
  assert.match(dispatcherSource, /"world_interaction_update"/);
  assert.match(dispatcherSource, /"world_item_drop_pickup"/);
  assert.match(dispatcherSource, /"player_position"/);
  assert.match(dispatcherSource, /const FALLBACK_ROUTE_TYPES = Object\.freeze\(\[\]\)/);
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-phase8-final-routes/);
  assert.match(deploySource, /server_phase8_final_routes\.js/);
  assert.match(deploySource, /src\/server_phase8_final_routes\.ts/);
  assert.match(deploySource, /tsconfig\.server-phase8-final-routes\.json/);
  assert.match(deploySource, /check_server_phase8_final_routes_build\.js/);
  assert.match(deploySource, /sync_server_phase8_final_routes_build\.js/);
  assert.match(deploySource, /npm run build:server-phase8-final-routes/);

  console.log("[server-phase8-final-routes] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
