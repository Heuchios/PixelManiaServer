#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Phase11cTrustedMovementModule = require("../server_phase11c_trusted_movement");

const repoRoot = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const sessionRoutesSource = fs.readFileSync(
  path.join(repoRoot, "src", "server_phase8_player_session_routes.ts"),
  "utf8"
);
const trustedMovementSource = fs.readFileSync(
  path.join(repoRoot, "src", "server_phase11c_trusted_movement.ts"),
  "utf8"
);
const standardMovementSource = fs.readFileSync(
  path.join(repoRoot, "src", "server_phase11d_standard_movement.ts"),
  "utf8"
);

/**
 * @param {string} source
 * @param {string} startMarker
 * @param {string} endMarker
 */
function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const guardDurationMs = 30000;
const guardTolerancePixels = 4;
const helpers = Phase11cTrustedMovementModule.createServerPhase11cTrustedMovement({
  ACTION_RATE_LIMIT_MS: 25,
  CUSTOM_TRUSTED_PLAYER_STATE_ENABLED: true,
  LAVA_REBOUND_MOVE_EXTRA_PIXELS: 100,
  MAX_MOVE_PIXELS_PER_SECOND: 900,
  MAX_TRUSTED_POSITION_AGE_MS: 1000,
  MAX_TRUSTED_POSITION_AGE_MS_COMBAT: 180,
  MAX_TRUSTED_POSITION_AGE_MS_WORLD_ACTION: 250,
  MOVEMENT_MODE_CUSTOM_AUTHORITATIVE: "CUSTOM_AUTHORITATIVE",
  MOVEMENT_MODE_NETFOX_REAL: "NETFOX_REAL",
  MOVEMENT_MODE_WEBSOCKET: "WEBSOCKET",
  NETFOX_ACTION_DEBUG: false,
  NETFOX_MOVEMENT_ENABLED: true,
  NETFOX_TRUSTED_PLAYER_STATE_ENABLED: true,
  NETFOX_TRUSTED_POSITION_DEBUG: false,
  PacketContracts: { isWorldDropTrustedPositionAction: () => false },
  TRUSTED_MOVEMENT_ALLOWLIST: new Set(["test"]),
  TRUSTED_MOVEMENT_ALLOWLIST_ENABLED: true,
  TRUSTED_MOVEMENT_BASELINE_RESET_MS: 1500,
  TRUSTED_MOVEMENT_EXTRA_PIXELS: 256,
  TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD: true,
  TRUSTED_MOVEMENT_SOFT_RESYNC_PIXELS: 512,
  TRUSTED_MOVEMENT_SPEED_MULTIPLIER: 2.25,
  WORLD_ENTRY_SPAWN_GUARD_MS: guardDurationMs,
  WORLD_ENTRY_SPAWN_TOLERANCE_PIXELS: guardTolerancePixels,
  cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim(),
  cleanWorld: (/** @type {unknown} */ value) => String(value || "").trim().toUpperCase(),
  clampString: (/** @type {unknown} */ value) => String(value || "").trim(),
  getMovementCollisionAtPosition: () => null,
  isAdmin: () => false,
  isMovementNearLavaRebound: () => false,
  isPositionInWorldBounds: (/** @type {number} */ x, /** @type {number} */ y) => (
    Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x < 3200 && y >= 0 && y < 2240
  ),
  isValidRespawnTeleportPosition: () => false,
  logSecurityEvent: () => undefined,
  logger: { log: () => undefined, warn: () => undefined },
  normalizePhase7Reason: (/** @type {unknown} */ value) => String(value || "unknown"),
  requireAuthenticated: () => true,
  requireSameWorld: () => true,
  sanitizeActionPositionPayload: () => null,
  sanitizePlayerPosition: () => null,
  sanitizePlayerVelocity: (/** @type {unknown} */ value) => Number(value) || 0,
  sendActionRejected: () => undefined,
  touchLivePresence: () => undefined,
});

/** @type {Record<string, any>} */
const player = { world: "TEST" };
const now = 1000;
const expectedSpawn = { world: "TEST", x: 1600, y: 800 };
const guard = helpers.setPlayerWorldEntrySpawnGuard(player, "test", expectedSpawn, now);
assert.deepEqual(guard, {
  world: "TEST",
  x: 1600,
  y: 800,
  expires_at: now + guardDurationMs,
});

const oldJoinOrderOffset = helpers.checkPlayerWorldEntrySpawnGuard(
  player,
  { world: "TEST", x: expectedSpawn.x + 48, y: expectedSpawn.y },
  now + 10
);
assert.equal(oldJoinOrderOffset.active, true);
assert.equal(oldJoinOrderOffset.accepted, false);
assert.equal(oldJoinOrderOffset.distance, 48);
assert.ok(player.world_entry_spawn_guard, "A rejected first packet must not consume the entrance guard");

const smallNumericDrift = helpers.checkPlayerWorldEntrySpawnGuard(
  player,
  { world: "TEST", x: expectedSpawn.x + 3, y: expectedSpawn.y + 2 },
  now + 20
);
assert.equal(smallNumericDrift.active, true);
assert.equal(smallNumericDrift.accepted, true);

helpers.clearPlayerWorldEntrySpawnGuard(player);
assert.equal(player.world_entry_spawn_guard, undefined);

helpers.setPlayerWorldEntrySpawnGuard(player, "TEST", expectedSpawn, now);
assert.equal(
  helpers.getPlayerWorldEntrySpawnGuard(player, "TEST", now + guardDurationMs + 1),
  null
);
assert.equal(player.world_entry_spawn_guard, undefined);

const normalMovementSource = sourceBetween(
  standardMovementSource,
  "function acceptPlayerMovement",
  "function buildPublicPlayerPresencePayload"
);
assert.match(normalMovementSource, /checkPlayerWorldEntrySpawnGuard\(player, position, now\)/);
assert.match(
  normalMovementSource,
  /sendPlayerPositionCorrection\(\s*socket,\s*player,\s*position,\s*"world_entry_position_pending"/
);
assert.ok(
  normalMovementSource.indexOf("checkPlayerWorldEntrySpawnGuard") <
    normalMovementSource.indexOf("if (respawnTeleport)"),
  "World-entry validation must run before teleport and movement baseline acceptance"
);

const trustedMovementAcceptanceSource = sourceBetween(
  trustedMovementSource,
  "function acceptTrustedMovementState",
  "function getTrustedPositionMaxAgeMs"
);
assert.match(trustedMovementAcceptanceSource, /reason: "world_entry_position_pending"/);
assert.match(trustedMovementAcceptanceSource, /clearPlayerWorldEntrySpawnGuard\(player\)/);
assert.match(trustedMovementAcceptanceSource, /reason: "world_entry_spawn"/);
assert.match(
  serverSource,
  /checkPlayerWorldEntrySpawnGuard: ServerPhase11cTrustedMovement\.checkPlayerWorldEntrySpawnGuard/
);
assert.match(
  serverSource,
  /ServerPhase11dStandardMovement\.acceptPlayerMovement\(/
);

assert.match(
  serverSource,
  /Math\.min\(TILE_SIZE \* 0\.25, Number\(process\.env\.WORLD_ENTRY_SPAWN_TOLERANCE_PIXELS\) \|\| 4\)/
);
assert.match(
  serverSource,
  /if \(changedWorld\) \{\s*setPlayerWorldEntrySpawnGuard\(player, targetWorld, targetPosition\);/
);
assert.match(
  sessionRoutesSource,
  /player\.x = joinSpawn\.x;\s*player\.y = joinSpawn\.y;\s*deps\.setPlayerWorldEntrySpawnGuard\(player, player\.world, joinSpawn\);/
);
assert.match(sessionRoutesSource, /deps\.clearPlayerWorldEntrySpawnGuard\(player\)/);
assert.equal(packageJson.scripts["check:join-spawn"], "node scripts/check_join_spawn_safety.js");
assert.match(packageJson.scripts["check:security"], /npm run check:join-spawn/);
assert.match(deploySource, /node --check scripts\/check_join_spawn_safety\.js/);
assert.match(deploySource, /npm run check:join-spawn/);

console.log("[join-spawn-safety] success");
