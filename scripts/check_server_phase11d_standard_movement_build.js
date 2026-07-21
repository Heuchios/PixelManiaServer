#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Phase11dStandardMovementModule = require("../server_phase11d_standard_movement");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const routeSource = fs.readFileSync(
  path.join(repoRoot, "src", "server_phase8_final_routes.ts"),
  "utf8",
);
const helperSource = fs.readFileSync(
  path.join(repoRoot, "src", "server_phase11d_standard_movement.ts"),
  "utf8",
);
const generatedSource = fs.readFileSync(
  path.join(repoRoot, "server_phase11d_standard_movement.js"),
  "utf8",
);
const syncSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "sync_server_phase11d_standard_movement_build.js"),
  "utf8",
);
const buildConfig = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "tsconfig.server-phase11d-standard-movement.json"),
    "utf8",
  ),
);

/**
 * @param {Record<string, any>} [overrides]
 */
function createFixture(overrides = {}) {
  const clock = { value: 1000 };
  const activeFishingSessions = new Map();
  /** @type {any[]} */
  const correctionRejections = [];
  /** @type {any[]} */
  const debugEvents = [];
  /** @type {Record<string, any>} */
  const state = {
    collision: null,
    lava: false,
    admin: false,
    spawnCheck: { active: false, accepted: false },
    spawnGuardClears: 0,
  };
  const playerNetworkStats = {
    stale_player_position_messages: 0,
    rejected_player_position_messages: 0,
    corrected_player_position_messages: 0,
  };
  const foreground = new Map();

  /** @type {Record<string, any>} */
  const deps = {
    LAVA_REBOUND_MOVE_EXTRA_PIXELS: 100,
    MAX_DAMAGE_FLASH_MS: 2000,
    MAX_MOVE_ACCEL_PIXELS_PER_SECOND2: 1000,
    MAX_MOVE_PIXELS_PER_SECOND: 100,
    MAX_MOVE_VELOCITY_DELTA_EXTRA: 25,
    MOVEMENT_CORRECTION_SMOOTH_MS: 80,
    MOVEMENT_CORRECTION_SNAP_DISTANCE: 64,
    MOVEMENT_DISTANCE_GRACE_PIXELS: 8,
    MOVEMENT_MAX_ELAPSED_SECONDS: 0.25,
    TILE_SIZE: 32,
    activeFishingSessions,
    checkPlayerWorldEntrySpawnGuard: () => ({ ...state.spawnCheck }),
    cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim(),
    cleanWorld: (/** @type {unknown} */ value) => String(value || "START").trim().toUpperCase(),
    clampInteger: (/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) => (
      Math.max(min, Math.min(max, Math.trunc(Number(value) || 0)))
    ),
    clampString: (/** @type {unknown} */ value) => String(value || "").trim(),
    clearPlayerWorldEntrySpawnGuard: () => {
      state.spawnGuardClears += 1;
    },
    debugNetfoxAction: (/** @type {string} */ label, /** @type {Record<string, any>} */ details) => {
      debugEvents.push({ label, details });
    },
    ensureWorldState: () => ({ foreground }),
    getDefaultEntranceGateSpawnForWorld: () => ({ x: 64, y: 64 }),
    getEntranceGateSpawnForWorld: () => null,
    getGridCenterPixels: (/** @type {number} */ x, /** @type {number} */ y) => ({
      x: x * 32 + 16,
      y: y * 32 + 16,
    }),
    getMovementCollisionAtPosition: () => state.collision,
    getPublicPlayerIdentity: (/** @type {Record<string, any>} */ player) => ({
      name: player.account_username || player.name || "Player",
      username: player.account_username || player.name || "Player",
      role: "player",
    }),
    gridKey: (/** @type {number} */ x, /** @type {number} */ y) => `${x},${y}`,
    isAdmin: () => state.admin,
    isCheckpointBlockType: (/** @type {unknown} */ blockType) => blockType === "checkpoint",
    isGridInWorld: (/** @type {unknown} */ x, /** @type {unknown} */ y) => (
      Number.isInteger(x) && Number.isInteger(y) && Number(x) >= 0 && Number(y) >= 0
    ),
    isMovementNearLavaRebound: () => state.lava,
    isPositionInWorldBounds: (/** @type {unknown} */ x, /** @type {unknown} */ y) => (
      Number.isFinite(Number(x))
      && Number.isFinite(Number(y))
      && Number(x) >= 0
      && Number(x) < 1000
      && Number(y) >= 0
      && Number(y) < 1000
    ),
    nowMs: () => clock.value,
    playerNetworkStats,
    sendActionRejected: (
      /** @type {unknown} */ _socket,
      /** @type {string} */ action,
      /** @type {string} */ message,
      /** @type {Record<string, any>} */ details,
    ) => {
      correctionRejections.push({ action, message, details });
    },
    ...overrides,
  };

  return {
    activeFishingSessions,
    clock,
    correctionRejections,
    debugEvents,
    foreground,
    movement: Phase11dStandardMovementModule.createServerPhase11dStandardMovement(deps),
    playerNetworkStats,
    state,
  };
}

/**
 * @returns {Record<string, any>}
 */
function createPlayer() {
  return {
    id: "p1",
    account_username: "uso",
    authenticated: true,
    joined_world: true,
    world: "TEST",
    x: 100,
    y: 100,
    facing: 1,
    velocity_x: 0,
    velocity_y: 0,
    on_floor: true,
    last_position_at: 900,
    movement_sequence: 5,
    movement_client_time_msec: 500,
    movement_server_time_msec: 900,
    equipment_slots: {
      hand: "wrench",
      back: "cape",
    },
  };
}

const fixture = createFixture();
const { movement } = fixture;

assert.equal(movement.sanitizeMovementSequence({ movement_sequence: 12.9 }), 12);
assert.equal(movement.sanitizeMovementSequence({ seq: -5 }), 0);
assert.equal(movement.sanitizeMovementClientTimeMsec({ sent_at_msec: 3456.8 }), 3456);
assert.equal(movement.sanitizeMovementClientTimeMsec({ timestamp: "bad" }), 0);
assert.equal(movement.sanitizePlayerVelocity(2500), 2000);
assert.equal(movement.sanitizePlayerVelocity(-2500), -2000);
assert.equal(movement.sanitizePlayerAnimationState("JUMP"), "jump");
assert.equal(movement.sanitizePlayerAnimationState("teleport"), "idle");
assert.deepEqual(
  movement.sanitizePlayerPosition(
    { x: 80, y: 96, facing: -1, world: "test", in_water: true },
    createPlayer(),
  ),
  {
    x: 80,
    y: 96,
    facing: -1,
    world: "TEST",
    in_water: true,
    in_lava_fire: false,
  },
);
assert.equal(movement.sanitizePlayerPosition({ x: -1, y: 50 }, createPlayer()), null);

const damage = movement.sanitizePlayerDamageFlash({
  damage_flash_active: true,
  damage_flash_remaining_ms: 5000,
  damage_flash_token: 8,
});
assert.deepEqual(damage, { active: true, remaining_ms: 2000, token: 8 });

let player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 101, y: 100, world: "TEST" }, {
    data: { movement_sequence: 5 },
  }),
  false,
);
assert.equal(fixture.playerNetworkStats.stale_player_position_messages, 1);
assert.equal(fixture.playerNetworkStats.rejected_player_position_messages, 1);
assert.equal(fixture.debugEvents.at(-1).label, "ignored stale websocket movement sequence");

player = createPlayer();
player.movement_sequence = 0;
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 101, y: 100, world: "TEST" }, {
    data: { client_time_msec: 500 },
  }),
  false,
);

player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 1200, y: 100, world: "TEST" }, {
    data: { movement_sequence: 6 },
  }),
  false,
);
assert.equal(fixture.correctionRejections.at(-1).details.reason, "outside_world_bounds");
assert.equal(fixture.correctionRejections.at(-1).details.correction_snap, true);

fixture.state.spawnCheck = { active: true, accepted: false };
player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 105, y: 100, world: "TEST" }, {
    data: { movement_sequence: 6 },
  }),
  false,
);
assert.equal(fixture.correctionRejections.at(-1).details.reason, "world_entry_position_pending");

fixture.state.spawnCheck = { active: true, accepted: true };
player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 105, y: 100, world: "TEST" }, {
    data: { movement_sequence: 6, client_time_msec: 600, chat_typing: true },
  }),
  true,
);
assert.equal(fixture.state.spawnGuardClears, 1);
assert.equal(player.movement_sequence, 6);
assert.equal(player.movement_client_time_msec, 600);
assert.equal(player.chat_typing, true);

fixture.state.spawnCheck = { active: false, accepted: false };
player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 500, y: 500, world: "TEST" }, {
    respawnTeleport: true,
    data: { movement_sequence: 6 },
  }),
  true,
);

player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 200, y: 100, world: "TEST" }, {
    data: { movement_sequence: 6, velocity_x: 0, velocity_y: 0 },
  }),
  false,
);
assert.equal(fixture.correctionRejections.at(-1).details.reason, "movement_too_fast");

fixture.state.lava = true;
player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 180, y: 100, world: "TEST" }, {
    data: { movement_sequence: 6 },
  }),
  true,
);
fixture.state.lava = false;

player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 105, y: 100, world: "TEST" }, {
    data: { movement_sequence: 6, velocity_x: 500, velocity_y: 0 },
  }),
  false,
);
assert.equal(
  fixture.correctionRejections.at(-1).details.reason,
  "movement_acceleration_too_high",
);

fixture.state.collision = { grid_x: 4, grid_y: 3, block_type: "stone" };
player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 105, y: 100, world: "TEST" }, {
    data: { movement_sequence: 6 },
  }),
  false,
);
assert.equal(fixture.correctionRejections.at(-1).details.reason, "movement_blocked");
assert.equal(fixture.correctionRejections.at(-1).details.block_type, "stone");
fixture.state.collision = null;

player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 110, y: 100, world: "TEST" }, {
    data: { movement_sequence: 6, client_time_msec: 600 },
  }),
  true,
);
assert.equal(player.last_position_at, fixture.clock.value);
assert.equal(player.movement_server_time_msec, fixture.clock.value);

const rejectionCount = fixture.correctionRejections.length;
player = createPlayer();
assert.equal(
  movement.acceptPlayerMovement({}, player, { x: 500, y: 100, world: "TEST" }, {
    silent: true,
    data: { movement_sequence: 6 },
  }),
  false,
);
assert.equal(fixture.correctionRejections.length, rejectionCount);

assert.equal(
  movement.isValidRespawnTeleportPosition(
    createPlayer(),
    { world: "TEST", x: 64, y: 64 },
    { respawn_teleport: true },
  ),
  true,
);
const checkpointPlayer = createPlayer();
checkpointPlayer.respawn_checkpoint = { world: "TEST", x: 4, y: 5 };
fixture.foreground.set("4,5", { block_type: "checkpoint" });
assert.equal(
  movement.isValidRespawnTeleportPosition(
    checkpointPlayer,
    { world: "TEST", x: 4 * 32 + 16, y: 5 * 32 + 16 },
    { position_reason: "respawn" },
  ),
  true,
);

player = createPlayer();
fixture.activeFishingSessions.set(player.id, {
  world: "TEST",
  target_x: 8,
  target_y: 9,
  lure_id: "worm",
  rod_id: "rod",
  expires_at: 2000,
});
assert.equal(movement.refreshPlayerFishingPresence(player, "TEST"), true);
assert.equal(player.fishing_active, true);
assert.equal(player.fishing_target_x, 8);
fixture.clock.value = 2100;
assert.equal(movement.refreshPlayerFishingPresence(player, "TEST"), false);
assert.equal(player.fishing_active, false);

fixture.clock.value = 1000;
fixture.activeFishingSessions.set(player.id, {
  world: "TEST",
  target_x: 8,
  target_y: 9,
  lure_id: "worm",
  rod_id: "rod",
  expires_at: 2000,
});
player.damage_flash_expires_at = 1500;
player.damage_flash_token = 7;
const presence = movement.buildPublicPlayerPresencePayload("player_position", player, "TEST");
assert.equal(presence.player_id, "p1");
assert.equal(presence.username, "uso");
assert.equal(presence.fishing_active, true);
assert.equal(presence.damage_flash_remaining_ms, 500);
assert.equal(presence.equipped_tool, "wrench");
assert.equal(presence.equipped_back_item, "cape");

const signature = movement.getPlayerPresenceBroadcastSignature(presence);
assert.equal(
  movement.getPlayerPresenceBroadcastSignature({ ...presence, server_time_msec: 9999 }),
  signature,
);
assert.notEqual(
  movement.getPlayerPresenceBroadcastSignature({ ...presence, x: presence.x + 1 }),
  signature,
);

const requiredBridges = [
  "acceptPlayerMovement",
  "applyPlayerFishingPresenceFromSession",
  "buildPublicPlayerPresencePayload",
  "clearPlayerFishingPresence",
  "commitAcceptedMovementTiming",
  "getPlayerPresenceBroadcastSignature",
  "getPublicPlayerDamageFlash",
  "isValidRespawnTeleportPosition",
  "refreshPlayerFishingPresence",
  "sanitizeMovementClientTimeMsec",
  "sanitizeMovementSequence",
  "sanitizePlayerAnimationState",
  "sanitizePlayerDamageFlash",
  "sanitizePlayerPosition",
  "sanitizePlayerVelocity",
  "sendPlayerPositionCorrection",
];
for (const name of requiredBridges) {
  assert.ok(
    serverSource.includes(`ServerPhase11dStandardMovement.${name}(`),
    `server.js must delegate ${name} to the Phase 11D TypeScript owner`,
  );
  assert.ok(
    helperSource.includes(`function ${name}(`),
    `TypeScript source must own ${name}`,
  );
}

assert.ok(serverSource.includes('require("./server_phase11d_standard_movement")'));
assert.ok(serverSource.includes("createServerPhase11dStandardMovement({"));
assert.ok(routeSource.includes("if (!acceptPlayerMovement(socket, player, position"));
assert.ok(routeSource.includes('buildPublicPlayerPresencePayload("player_position"'));
assert.ok(helperSource.includes('"movement_acceleration_too_high"'));
assert.ok(helperSource.includes('"world_entry_position_pending"'));
assert.ok(helperSource.includes("getMovementCollisionAtPosition("));
assert.ok(generatedSource.startsWith(
  "// Generated from src/server_phase11d_standard_movement.ts.",
));
assert.ok(syncSource.includes('"server_phase11d_standard_movement.js"'));
assert.deepEqual(buildConfig.include, ["src/server_phase11d_standard_movement.ts"]);
assert.ok(packageJson.scripts["build:server-phase11d-standard-movement"]);
assert.ok(packageJson.scripts["check:server-phase11d-standard-movement"]);
assert.ok(
  packageJson.scripts["check:typescript"].includes(
    "check:server-phase11d-standard-movement",
  ),
);
for (const marker of [
  "$localServerPhase11dStandardMovement",
  "$localServerPhase11dStandardMovementSource",
  "$localServerPhase11dStandardMovementBuildConfig",
  "$localServerPhase11dStandardMovementCheck",
  "$localServerPhase11dStandardMovementBuildSync",
  "npm run check:server-phase11d-standard-movement",
]) {
  assert.ok(deploySource.includes(marker), `deploy script must include ${marker}`);
}

console.log(
  "[server-phase11d-standard-movement] freshness, bounds, spawn, speed, acceleration, "
  + "collision, corrections, fishing, presence, ownership, and deploy wiring passed",
);
