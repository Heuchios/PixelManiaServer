#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Phase7DispatcherModule = require("../server_phase7_dispatcher");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase7_dispatcher.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_phase7_dispatcher.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_phase7_dispatcher_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-phase7-dispatcher.json"), "utf8"));

/** @type {{ route: string, name?: unknown, id?: unknown, usedActionPosition: boolean }[]} */
const handlerCalls = [];
/** @type {unknown[]} */
const actionPositionCalls = [];
/** @type {string[]} */
const fallbackCalls = [];
function asRecord(/** @type {unknown} */ value) {
  return value && typeof value === "object" && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

const packetContracts = {
  isWorldDropCreatePacket(/** @type {unknown} */ packet) {
    return asRecord(packet).drop_kind === "create";
  },
  isWorldDropUpdateRequestPacket(/** @type {unknown} */ packet) {
    return asRecord(packet).drop_kind === "update";
  },
  isWorldDropPickupRequestPacket(/** @type {unknown} */ packet) {
    return asRecord(packet).drop_kind === "pickup";
  },
};

const dispatcher = Phase7DispatcherModule.createServerPhase7Dispatcher({
  packetContracts,
  handlers: {
    login(/** @type {unknown} */ _socket, /** @type {any} */ _player, /** @type {any} */ data, /** @type {any} */ context) {
      handlerCalls.push({ route: context.routeType, name: data.name, usedActionPosition: context.usedActionPosition });
    },
    inventory_transaction_request(/** @type {unknown} */ _socket, /** @type {any} */ _player, /** @type {any} */ data, /** @type {any} */ context) {
      handlerCalls.push({ route: context.routeType, id: data.id, usedActionPosition: context.usedActionPosition });
    },
    world_block_update(/** @type {unknown} */ _socket, /** @type {any} */ _player, /** @type {any} */ data, /** @type {any} */ context) {
      handlerCalls.push({ route: context.routeType, id: data.id, usedActionPosition: context.usedActionPosition });
    },
    world_interaction_update(/** @type {unknown} */ _socket, /** @type {any} */ _player, /** @type {any} */ data, /** @type {any} */ context) {
      handlerCalls.push({ route: context.routeType, id: data.id, usedActionPosition: context.usedActionPosition });
    },
    world_item_drop_create(/** @type {unknown} */ _socket, /** @type {any} */ _player, /** @type {any} */ data, /** @type {any} */ context) {
      handlerCalls.push({ route: context.routeType, id: data.id, usedActionPosition: context.usedActionPosition });
    },
    world_item_drop_update(/** @type {unknown} */ _socket, /** @type {any} */ _player, /** @type {any} */ data, /** @type {any} */ context) {
      handlerCalls.push({ route: context.routeType, id: data.id, usedActionPosition: context.usedActionPosition });
    },
    world_item_drop_pickup(/** @type {unknown} */ _socket, /** @type {any} */ _player, /** @type {any} */ data, /** @type {any} */ context) {
      handlerCalls.push({ route: context.routeType, id: data.id, usedActionPosition: context.usedActionPosition });
    },
    player_position(/** @type {unknown} */ _socket, /** @type {any} */ _player, /** @type {any} */ data, /** @type {any} */ context) {
      handlerCalls.push({ route: context.routeType, id: data.id, usedActionPosition: context.usedActionPosition });
    },
  },
  applyActionPositionFromPayload(/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ _data, /** @type {unknown} */ fallbackWorld) {
    actionPositionCalls.push(fallbackWorld);
  },
  getPlayerCurrentWorldName() {
    return "START";
  },
  onFallbackRoute(/** @type {string} */ routeType) {
    fallbackCalls.push(routeType);
  },
});

(async () => {
  assert.deepEqual(
    await dispatcher.dispatch({}, { id: "p1" }, { type: "login", name: "Uso" }, { playerId: "p1" }),
    { handled: true, route_type: "login", mode: "handler", phase: "phase7", used_action_position: false }
  );
  assert.deepEqual(handlerCalls.pop(), { route: "login", name: "Uso", usedActionPosition: false });
  assert.deepEqual(actionPositionCalls, []);

  assert.deepEqual(
    await dispatcher.dispatch({}, { id: "p1" }, { type: "inventory_transaction_request", id: "tx1", world: "test" }, { playerId: "p1" }),
    { handled: true, route_type: "inventory_transaction_request", mode: "handler", phase: "phase7", used_action_position: true }
  );
  assert.deepEqual(handlerCalls.pop(), { route: "inventory_transaction_request", id: "tx1", usedActionPosition: true });
  assert.deepEqual(actionPositionCalls.pop(), "test");

  assert.deepEqual(
    await dispatcher.dispatch({}, { id: "p1" }, { drop_kind: "create", id: "drop-create-1" }, { playerId: "p1" }),
    { handled: true, route_type: "world_item_drop_create", mode: "handler", phase: "phase7", used_action_position: false }
  );
  assert.deepEqual(handlerCalls.pop(), { route: "world_item_drop_create", id: "drop-create-1", usedActionPosition: false });
  assert.deepEqual(
    await dispatcher.dispatch({}, { id: "p1" }, { drop_kind: "update", id: "drop-update-1" }, { playerId: "p1" }),
    { handled: true, route_type: "world_item_drop_update", mode: "handler", phase: "phase7", used_action_position: false }
  );
  assert.deepEqual(handlerCalls.pop(), { route: "world_item_drop_update", id: "drop-update-1", usedActionPosition: false });
  assert.deepEqual(
    await dispatcher.dispatch({}, { id: "p1" }, { drop_kind: "pickup", id: "drop-pickup-1" }, { playerId: "p1" }),
    { handled: true, route_type: "world_item_drop_pickup", mode: "handler", phase: "phase7", used_action_position: false }
  );
  assert.deepEqual(handlerCalls.pop(), { route: "world_item_drop_pickup", id: "drop-pickup-1", usedActionPosition: false });
  assert.deepEqual(fallbackCalls, []);

  assert.deepEqual(
    await dispatcher.dispatch({}, { id: "p1" }, { type: "world_interaction_update", id: "interact-1" }, { playerId: "p1" }),
    { handled: true, route_type: "world_interaction_update", mode: "handler", phase: "phase7", used_action_position: false }
  );
  assert.deepEqual(handlerCalls.pop(), { route: "world_interaction_update", id: "interact-1", usedActionPosition: false });
  assert.deepEqual(
    await dispatcher.dispatch({}, { id: "p1" }, { type: "player_position", id: "pos-1" }, { playerId: "p1" }),
    { handled: true, route_type: "player_position", mode: "handler", phase: "phase7", used_action_position: false }
  );
  assert.deepEqual(handlerCalls.pop(), { route: "player_position", id: "pos-1", usedActionPosition: false });
  assert.deepEqual(
    await dispatcher.dispatch({}, { id: "p1" }, { type: "world_block_update", id: "block-1" }, { playerId: "p1" }),
    { handled: true, route_type: "world_block_update", mode: "handler", phase: "phase7", used_action_position: false }
  );
  assert.deepEqual(handlerCalls.pop(), { route: "world_block_update", id: "block-1", usedActionPosition: false });

  assert.equal(dispatcher.getRouteMode("login"), "handler");
  assert.equal(dispatcher.getRouteMode("world_block_update"), "handler");
  assert.equal(dispatcher.getRouteMode("world_item_drop_pickup"), "handler");
  assert.equal(dispatcher.getRouteMode("player_position"), "handler");
  assert.equal(dispatcher.getRouteMode("not_real"), "unknown");
  assert.equal(dispatcher.isPostActionPositionRoute("inventory_transaction_request"), true);
  assert.equal(dispatcher.isPostActionPositionRoute("world_block_update"), false);
  assert.equal(dispatcher.isPostActionPositionRoute("login"), false);

  const routeCatalog = dispatcher.getRouteCatalog();
  assert.ok(routeCatalog.handled_routes.includes("chat"));
  assert.ok(routeCatalog.handled_routes.includes("player_punch"));
  assert.ok(routeCatalog.handled_routes.includes("player_profile_update"));
  assert.ok(routeCatalog.handled_routes.includes("world_block_update"));
  assert.deepEqual(routeCatalog.fallback_routes, []);
  assert.equal(Object.hasOwn(routeCatalog, "phase8_legacy_routes"), false);
  assert.ok(routeCatalog.post_action_position_routes.includes("developer_command_request"));
  assert.ok(routeCatalog.post_action_position_routes.includes("player_profile_update"));
  assert.ok(!routeCatalog.post_action_position_routes.includes("world_block_update"));

  assert.equal(
    packageJson.scripts["build:server-phase7-dispatcher"],
    "tsc --project tsconfig.server-phase7-dispatcher.json && node scripts/sync_server_phase7_dispatcher_build.js"
  );
  assert.equal(
    packageJson.scripts["check:server-phase7-dispatcher"],
    "npm run build:server-phase7-dispatcher && node scripts/check_server_phase7_dispatcher_build.js"
  );
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-phase7-dispatcher/);
  assert.deepEqual(buildConfig.include, ["src/server_phase7_dispatcher.ts"]);
  assert.match(helperSource, /function createServerPhase7Dispatcher/);
  assert.doesNotMatch(helperSource, /legacyRouteHandler/);
  assert.doesNotMatch(helperSource, /legacy_handler/);
  assert.doesNotMatch(helperSource, /phase8_legacy_routes/);
  assert.match(helperSource, /DIRECT_HANDLER_ROUTE_TYPES/);
  assert.match(helperSource, /POST_ACTION_HANDLER_ROUTE_TYPES/);
  assert.match(helperSource, /world_item_drop_pickup/);
  assert.match(helperSource, /player_position/);
  assert.match(generatedSource, /Generated from src\/server_phase7_dispatcher\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.match(syncSource, /server_phase7_dispatcher\.js/);
  assert.match(serverSource, /require\("\.\/server_phase7_dispatcher"\)/);
  assert.match(serverSource, /createServerPhase7Dispatcher/);
  assert.match(serverSource, /ServerPhase7Dispatcher\.dispatch/);
  assert.doesNotMatch(serverSource, /runLegacyPhase8Route/);
  assert.doesNotMatch(serverSource, /legacyRouteHandler: runLegacyPhase8Route/);
  assert.match(serverSource, /handleWorldItemDropPickup/);
  assert.match(serverSource, /handlePlayerPosition/);
  assert.match(serverSource, /trade_final_confirm/);
  assert.match(serverSource, /world_block_update/);
  assert.match(deploySource, /server_phase7_dispatcher\.js/);
  assert.match(deploySource, /src\/server_phase7_dispatcher\.ts/);
  assert.match(deploySource, /tsconfig\.server-phase7-dispatcher\.json/);
  assert.match(deploySource, /sync_server_phase7_dispatcher_build\.js/);
  assert.match(deploySource, /check_server_phase7_dispatcher_build\.js/);
  assert.match(deploySource, /npm run build:server-phase7-dispatcher/);

  console.log("[server-phase7-dispatcher] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
