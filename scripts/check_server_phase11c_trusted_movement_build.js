#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Phase11cTrustedMovementModule = require("../server_phase11c_trusted_movement");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(
  path.join(repoRoot, "src", "server_phase11c_trusted_movement.ts"),
  "utf8",
);
const generatedSource = fs.readFileSync(
  path.join(repoRoot, "server_phase11c_trusted_movement.js"),
  "utf8",
);
const syncSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "sync_server_phase11c_trusted_movement_build.js"),
  "utf8",
);
const buildConfig = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "tsconfig.server-phase11c-trusted-movement.json"),
    "utf8",
  ),
);

/**
 * @param {Record<string, any>} [overrides]
 */
function createFixture(overrides = {}) {
  const clock = { value: 1000 };
  /** @type {Array<{action: string, message: string, extra: Record<string, any>}>} */
  const rejections = [];
  /** @type {Array<{event: string, details: Record<string, any>, severity: string}>} */
  const securityEvents = [];
  /** @type {any[]} */
  const logLines = [];
  /** @type {{value: Record<string, any> | null}} */
  const collision = { value: null };

  const cleanWorld = (/** @type {unknown} */ value) => (
    String(value || "START").trim().toUpperCase()
  );
  const isPositionInWorldBounds = (/** @type {unknown} */ x, /** @type {unknown} */ y) => (
    Number.isFinite(Number(x))
    && Number.isFinite(Number(y))
    && Number(x) >= 0
    && Number(x) < 1000
    && Number(y) >= 0
    && Number(y) < 1000
  );
  const sanitizePlayerPosition = (
    /** @type {Record<string, any>} */ data,
    /** @type {Record<string, any>} */ player,
  ) => {
    if (!isPositionInWorldBounds(data.x, data.y)) return null;
    return {
      x: Number(data.x),
      y: Number(data.y),
      facing: Number(data.facing) < 0 ? -1 : 1,
      world: cleanWorld(data.world || player.world || "START"),
      in_water: data.in_water === true,
      in_lava_fire: data.in_lava_fire === true,
    };
  };

  /** @type {Record<string, any>} */
  const deps = {
    ACTION_RATE_LIMIT_MS: 25,
    CUSTOM_TRUSTED_PLAYER_STATE_ENABLED: true,
    LAVA_REBOUND_MOVE_EXTRA_PIXELS: 100,
    MAX_MOVE_PIXELS_PER_SECOND: 100,
    MAX_TRUSTED_POSITION_AGE_MS: 200,
    MAX_TRUSTED_POSITION_AGE_MS_COMBAT: 75,
    MAX_TRUSTED_POSITION_AGE_MS_WORLD_ACTION: 100,
    MOVEMENT_MODE_CUSTOM_AUTHORITATIVE: "CUSTOM_AUTHORITATIVE",
    MOVEMENT_MODE_NETFOX_REAL: "NETFOX_REAL",
    MOVEMENT_MODE_WEBSOCKET: "WEBSOCKET",
    NETFOX_ACTION_DEBUG: true,
    NETFOX_MOVEMENT_ENABLED: true,
    NETFOX_TRUSTED_PLAYER_STATE_ENABLED: true,
    NETFOX_TRUSTED_POSITION_DEBUG: false,
    PacketContracts: {
      isWorldDropTrustedPositionAction: (/** @type {string} */ action) => (
        action.startsWith("world_item_drop_")
      ),
    },
    TRUSTED_MOVEMENT_ALLOWLIST: new Set(["alice"]),
    TRUSTED_MOVEMENT_ALLOWLIST_ENABLED: true,
    TRUSTED_MOVEMENT_BASELINE_RESET_MS: 1500,
    TRUSTED_MOVEMENT_EXTRA_PIXELS: 10,
    TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD: true,
    TRUSTED_MOVEMENT_SOFT_RESYNC_PIXELS: 50,
    TRUSTED_MOVEMENT_SPEED_MULTIPLIER: 1,
    WORLD_ENTRY_SPAWN_GUARD_MS: 30000,
    WORLD_ENTRY_SPAWN_TOLERANCE_PIXELS: 4,
    cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim(),
    cleanWorld,
    clampString: (/** @type {unknown} */ value) => String(value || "").trim(),
    getMovementCollisionAtPosition: () => collision.value,
    isAdmin: (/** @type {Record<string, any>} */ player) => player.role === "admin",
    isMovementNearLavaRebound: () => false,
    isPositionInWorldBounds,
    isValidRespawnTeleportPosition: () => false,
    logSecurityEvent: (
      /** @type {any} */ _socket,
      /** @type {Record<string, any>} */ _player,
      /** @type {string} */ event,
      /** @type {Record<string, any>} */ details,
      /** @type {string} */ severity,
    ) => securityEvents.push({ event, details, severity }),
    logger: {
      log: (/** @type {any[]} */ ...args) => logLines.push(args),
      warn: (/** @type {any[]} */ ...args) => logLines.push(args),
    },
    normalizePhase7Reason: (/** @type {unknown} */ value) => (
      String(value || "unknown").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
    ),
    nowMs: () => clock.value,
    requireAuthenticated: (
      /** @type {any} */ _socket,
      /** @type {Record<string, any>} */ player,
    ) => player.authenticated === true,
    requireSameWorld: (
      /** @type {any} */ _socket,
      /** @type {Record<string, any>} */ player,
      /** @type {unknown} */ world,
    ) => cleanWorld(player.world) === cleanWorld(world),
    sanitizeActionPositionPayload: (
      /** @type {Record<string, any>} */ data,
      /** @type {Record<string, any>} */ player,
      /** @type {string} */ fallbackWorld,
    ) => sanitizePlayerPosition({
      x: data.actor_x ?? data.player_x,
      y: data.actor_y ?? data.player_y,
      facing: data.actor_facing ?? data.player_facing ?? data.facing,
      world: data.actor_world || data.player_world || data.world || fallbackWorld,
    }, player),
    sanitizePlayerPosition,
    sanitizePlayerVelocity: (/** @type {unknown} */ value) => (
      Math.max(-2000, Math.min(2000, Number(value) || 0))
    ),
    sendActionRejected: (
      /** @type {any} */ _socket,
      /** @type {string} */ action,
      /** @type {string} */ message,
      /** @type {Record<string, any>} */ extra,
    ) => rejections.push({ action, message, extra }),
    touchLivePresence: () => undefined,
    ...overrides,
  };

  /** @type {any} */
  const movement = Phase11cTrustedMovementModule.createServerPhase11cTrustedMovement(deps);

  return {
    clock,
    collision,
    deps,
    logLines,
    movement,
    rejections,
    securityEvents,
  };
}

const fixture = createFixture();
const { movement } = fixture;

assert.equal(movement.sanitizeMovementMode("custom_enet"), "CUSTOM_AUTHORITATIVE");
assert.equal(movement.sanitizeMovementMode("unknown"), "WEBSOCKET");
assert.equal(movement.isTrustedMovementModeName("NETFOX_REAL"), true);

/** @type {Record<string, any>} */
const player = {
  id: "profile-alice",
  account_username: "Alice",
  authenticated: true,
  joined_world: true,
  movement_mode: "WEBSOCKET",
  world: "TEST",
  x: 100,
  y: 100,
};
/** @type {Record<string, any>} */
const socket = { playerId: "session-alice" };

movement.updatePlayerMovementModeFromPayload(player, { movement_mode: "NETFOX_REAL" });
assert.equal(player.movement_mode, "NETFOX_REAL");
assert.equal(movement.usesTrustedMovementPosition(player), true);
assert.equal(movement.isTrustedMovementModeEnabled("NETFOX_REAL", player), true);

const spawnGuard = movement.setPlayerWorldEntrySpawnGuard(
  player,
  "TEST",
  { x: 120, y: 140 },
  fixture.clock.value,
);
assert.deepEqual(spawnGuard, {
  world: "TEST",
  x: 120,
  y: 140,
  expires_at: 31000,
});
const rejectedSpawn = movement.acceptTrustedMovementState(
  socket,
  player,
  { world: "TEST", x: 140, y: 140 },
  {},
  "NETFOX_REAL",
  { now: 1010, peer_id: 7, tick: 1 },
);
assert.equal(rejectedSpawn.ok, false);
assert.equal(rejectedSpawn.reason, "world_entry_position_pending");
assert.ok(player.world_entry_spawn_guard, "Rejected first movement must preserve the spawn guard");

const acceptedSpawn = movement.acceptTrustedMovementState(
  socket,
  player,
  { world: "TEST", x: 123, y: 142 },
  {},
  "NETFOX_REAL",
  { now: 1020, peer_id: 7, tick: 2 },
);
assert.equal(acceptedSpawn.ok, true);
assert.equal(acceptedSpawn.reason, "world_entry_spawn");
assert.equal(player.world_entry_spawn_guard, undefined);

const tooFast = movement.acceptTrustedMovementState(
  socket,
  player,
  { world: "TEST", x: 900, y: 900 },
  { velocity_x: 0, velocity_y: 0 },
  "NETFOX_REAL",
  { now: 1030, peer_id: 7, tick: 3 },
);
assert.equal(tooFast.ok, false);
assert.equal(tooFast.reason, "trusted_movement_too_fast");

fixture.collision.value = { grid_x: 4, grid_y: 5, block_type: "stone" };
const collisionPlayer = {
  ...player,
  id: "profile-collision",
  trusted_movement_baseline: null,
};
movement.acceptTrustedMovementState(
  socket,
  collisionPlayer,
  { world: "TEST", x: 200, y: 200 },
  {},
  "NETFOX_REAL",
  { now: 1100, peer_id: 8, tick: 1 },
);
const blocked = movement.acceptTrustedMovementState(
  socket,
  collisionPlayer,
  { world: "TEST", x: 201, y: 200 },
  {},
  "NETFOX_REAL",
  { now: 1120, peer_id: 8, tick: 2 },
);
assert.equal(blocked.ok, false);
assert.equal(blocked.reason, "trusted_movement_blocked");
fixture.collision.value = null;

fixture.clock.value = 3000;
movement.handleNetfoxTrustedPlayerState(socket, player, {
  x: 200,
  y: 220,
  world: "TEST",
  peer_id: 7,
  tick: 4,
  velocity_x: 10,
  velocity_y: 20,
  facing: -1,
  player_node_path: "/root/TestPlayer",
});
assert.equal(player.x, 200);
assert.equal(player.y, 220);
assert.equal(player.facing, -1);
assert.equal(movement.getRegistryStats().state_count, 1);

const profileState = movement.get_trusted_position_for_profile(
  "profile-alice",
  { action: "validation", world: "TEST" },
);
const peerState = movement.get_trusted_position_for_peer(
  7,
  { action: "validation", world: "TEST" },
);
const sessionState = movement.get_trusted_position_for_session(
  "session-alice",
  { action: "validation", world: "TEST" },
);
assert.equal(profileState.ok, true);
assert.equal(peerState.ok, true);
assert.equal(sessionState.ok, true);
assert.equal(peerState.game_player_id, "profile-alice");

fixture.clock.value = 3300;
assert.equal(
  movement.get_trusted_position_for_profile(
    "profile-alice",
    { action: "validation", world: "TEST" },
  ).reason,
  "stale",
);

fixture.clock.value = 4000;
assert.equal(movement.validateNetfoxActionCooldown(socket, player, "world_block_update"), true);
fixture.clock.value = 4010;
assert.equal(movement.validateNetfoxActionCooldown(socket, player, "world_block_update"), false);
assert.equal(fixture.rejections.at(-1)?.extra.reason, "rate_limited");

movement.handleCustomTrustedPlayerStateClear(socket, player, {
  world: "TEST",
  peer_id: 7,
  reason: "disconnect",
});
assert.equal(movement.getRegistryStats().state_count, 0);
assert.equal(player.custom_peer_id, 0);

player.movement_mode = "WEBSOCKET";
player.x = 320;
player.y = 240;
assert.deepEqual(
  movement.getPlayerValidationPosition(player, { action: "validation", world: "TEST" }),
  {
    ok: true,
    source: "websocket",
    action: "validation",
    player_id: "profile-alice",
    peer_id: 0,
    world: "TEST",
    x: 320,
    y: 240,
    velocity_x: 10,
    velocity_y: 20,
    facing: -1,
    age_ms: 0,
  },
);

fixture.clock.value = 6000;
const deniedPlayer = {
  ...player,
  id: "profile-bob",
  account_username: "Bob",
  movement_mode: "NETFOX_REAL",
};
assert.equal(
  movement.enforceStandardMovementForSocket(socket, deniedPlayer, "player_position"),
  true,
);
assert.equal(deniedPlayer.movement_mode, "WEBSOCKET");
assert.equal(fixture.securityEvents.some((event) => (
  event.event === "trusted_movement_auto_demoted"
)), true);

/** @type {Record<string, any>} */
const actionPlayer = {
  ...player,
  id: "profile-action",
  account_username: "Alice",
  movement_mode: "NETFOX_REAL",
  joined_world: true,
  trusted_movement_baseline: null,
};
fixture.clock.value = 7000;
assert.equal(movement.applyTrustedActionPositionFromPayload(
  socket,
  actionPlayer,
  {
    type: "world_block_update",
    actor_x: 400,
    actor_y: 420,
    actor_world: "TEST",
    actor_peer_id: 9,
    actor_tick: 1,
  },
  "TEST",
), true);
assert.equal(actionPlayer.x, 400);
assert.equal(actionPlayer.y, 420);
assert.equal(movement.getRegistryStats().state_count, 1);

const requiredBridges = [
  "acceptTrustedMovementState",
  "applyTrustedActionPositionFromPayload",
  "checkPlayerWorldEntrySpawnGuard",
  "clearNetfoxTrustedPlayerState",
  "clearPlayerWorldEntrySpawnGuard",
  "clearTrustedMovementBaseline",
  "debugNetfoxAction",
  "enforceStandardMovementForSocket",
  "getNetfoxTrustedPlayerState",
  "getPlayerValidationPosition",
  "getTrustedMovementModeLabel",
  "handleCustomTrustedPlayerState",
  "handleCustomTrustedPlayerStateClear",
  "handleNetfoxTrustedPlayerState",
  "resetPlayerMovementTracking",
  "sanitizeMovementMode",
  "setPlayerWorldEntrySpawnGuard",
  "usesTrustedMovementPosition",
  "validateNetfoxActionCooldown",
];
for (const name of requiredBridges) {
  assert.ok(
    serverSource.includes(`ServerPhase11cTrustedMovement.${name}(`),
    `server.js must delegate ${name} to the Phase 11C TypeScript owner`,
  );
  assert.ok(
    helperSource.includes(`function ${name}(`),
    `TypeScript source must own ${name}`,
  );
}

assert.ok(serverSource.includes('require("./server_phase11c_trusted_movement")'));
assert.ok(serverSource.includes("createServerPhase11cTrustedMovement({"));
assert.ok(!serverSource.includes("const netfoxPlayerStateRegistry = new Map()"));
assert.ok(!serverSource.includes("const netfoxPlayerStateRegistryByPeer = new Map()"));
assert.ok(!serverSource.includes("const phase7TrustedPositionLoggedKeys = new Set()"));
assert.ok(helperSource.includes("const netfoxPlayerStateRegistry = new Map<string, JsonRecord>()"));
assert.ok(helperSource.includes('reason: "world_entry_position_pending"'));
assert.ok(helperSource.includes('reason: "trusted_movement_too_fast"'));
assert.ok(helperSource.includes('reason: "trusted_movement_blocked"'));
assert.ok(generatedSource.startsWith(
  "// Generated from src/server_phase11c_trusted_movement.ts.",
));
assert.ok(syncSource.includes('.tsbuild",'));
assert.ok(syncSource.includes('"server_phase11c_trusted_movement.js"'));
assert.deepEqual(buildConfig.include, ["src/server_phase11c_trusted_movement.ts"]);
assert.ok(packageJson.scripts["build:server-phase11c-trusted-movement"]);
assert.ok(packageJson.scripts["check:server-phase11c-trusted-movement"]);
assert.ok(
  packageJson.scripts["check:typescript"].includes(
    "check:server-phase11c-trusted-movement",
  ),
);
for (const marker of [
  "$localServerPhase11cTrustedMovement",
  "$localServerPhase11cTrustedMovementSource",
  "$localServerPhase11cTrustedMovementBuildConfig",
  "$localServerPhase11cTrustedMovementCheck",
  "$localServerPhase11cTrustedMovementBuildSync",
  "npm run check:server-phase11c-trusted-movement",
]) {
  assert.ok(deploySource.includes(marker), `deploy script must include ${marker}`);
}

console.log(
  "[server-phase11c-trusted-movement] trusted modes, spawn guards, registry indexes, "
  + "authority checks, ownership, and deploy wiring passed",
);
