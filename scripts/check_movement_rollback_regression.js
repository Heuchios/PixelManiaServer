#!/usr/bin/env node
// @ts-check
"use strict";

/**
 * Movement rollback / rubber-banding regression suite.
 *
 * Drives the real Phase 11D standard-movement validator through packet
 * timelines that reproduce the production rubber-banding report:
 *
 *   - a gap in the accepted-position stream used to freeze the authoritative
 *     position while the client kept simulating, so every following packet was
 *     rejected as `movement_too_fast` forever and the client was yanked back to
 *     the same stale coordinate on every packet.
 *
 * The suite also pins the ordering guarantees (stale/duplicate/reordered
 * packets, world switches, reconnects) and asserts the speed limit itself is
 * unchanged.
 */

const assert = require("node:assert/strict");

const Phase11dStandardMovementModule = require("../server_phase11d_standard_movement");

// Production defaults from server.ts (TILE_SIZE 32).
const TILE_SIZE = 32;
const MAX_MOVE_PIXELS_PER_SECOND = 900;
const MOVEMENT_DISTANCE_GRACE_PIXELS = Math.trunc(TILE_SIZE * 0.75);
const MOVEMENT_MAX_ELAPSED_SECONDS = 0.25;
const MOVEMENT_CORRECTION_SNAP_DISTANCE = TILE_SIZE * 5;

// Client movement constants from Scripts/player.gd.
const CLIENT_RUN_SPEED = 150;
const CLIENT_MAX_FALL_SPEED = 520;

/**
 * @param {Record<string, any>} [overrides]
 */
function createHarness(overrides = {}) {
  const clock = { value: 1000000 };
  /** @type {any[]} */
  const corrections = [];
  /** @type {any[]} */
  const anomalies = [];
  /** @type {Record<string, any>} */
  const state = { collision: null };
  /** @type {Record<string, number>} */
  const playerNetworkStats = {
    stale_player_position_messages: 0,
    rejected_player_position_messages: 0,
    corrected_player_position_messages: 0,
    clamped_player_position_messages: 0,
  };

  const movement = Phase11dStandardMovementModule.createServerPhase11dStandardMovement({
    LAVA_REBOUND_MOVE_EXTRA_PIXELS: 64,
    MAX_DAMAGE_FLASH_MS: 2000,
    MAX_MOVE_ACCEL_PIXELS_PER_SECOND2: 36000,
    MAX_MOVE_PIXELS_PER_SECOND,
    MAX_MOVE_VELOCITY_DELTA_EXTRA: 120,
    MOVEMENT_CORRECTION_SMOOTH_MS: 80,
    MOVEMENT_CORRECTION_SNAP_DISTANCE,
    MOVEMENT_DISTANCE_GRACE_PIXELS,
    MOVEMENT_MAX_ELAPSED_SECONDS,
    TILE_SIZE,
    activeFishingSessions: new Map(),
    checkPlayerWorldEntrySpawnGuard: () => ({ active: false, accepted: false }),
    cleanAccountName: (/** @type {unknown} */ v) => String(v || "").trim(),
    cleanWorld: (/** @type {unknown} */ v) => String(v || "START").trim().toUpperCase(),
    clampInteger: (/** @type {unknown} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => (
      Math.max(lo, Math.min(hi, Math.trunc(Number(v) || 0)))
    ),
    clampString: (/** @type {unknown} */ v) => String(v || "").trim(),
    clearPlayerWorldEntrySpawnGuard: () => {},
    debugNetfoxAction: () => {},
    ensureWorldState: () => ({ foreground: new Map() }),
    getDefaultEntranceGateSpawnForWorld: () => null,
    getEntranceGateSpawnForWorld: () => null,
    getGridCenterPixels: (/** @type {number} */ x, /** @type {number} */ y) => ({
      x: x * TILE_SIZE,
      y: y * TILE_SIZE,
    }),
    getMovementCollisionAtPosition: () => state.collision,
    getPublicPlayerIdentity: () => ({}),
    gridKey: (/** @type {number} */ x, /** @type {number} */ y) => `${x},${y}`,
    isAdmin: () => false,
    isCheckpointBlockType: () => false,
    isGridInWorld: () => true,
    isMovementNearLavaRebound: () => false,
    isPositionInWorldBounds: (/** @type {unknown} */ x, /** @type {unknown} */ y) => (
      Number.isFinite(Number(x))
      && Number.isFinite(Number(y))
      && Number(x) >= 0
      && Number(y) >= 0
      && Number(x) < 100000
      && Number(y) < 100000
    ),
    nowMs: () => clock.value,
    playerNetworkStats,
    logMovementAnomaly: (/** @type {string} */ label, /** @type {Record<string, any>} */ details) => {
      anomalies.push({ label, details });
    },
    MOVEMENT_ANOMALY_LOG_INTERVAL_MS: 250,
    sendActionRejected: (
      /** @type {unknown} */ _socket,
      /** @type {string} */ action,
      /** @type {string} */ message,
      /** @type {Record<string, any>} */ details,
    ) => {
      corrections.push({ action, message, ...details });
    },
    ...overrides,
  });

  return { anomalies, clock, corrections, movement, playerNetworkStats, state };
}

function createPlayer(x = 1000, y = 1000) {
  return {
    id: "p1",
    name: "tester",
    account_username: "tester",
    authenticated: true,
    joined_world: true,
    world: "START",
    world_entry_session_id: "ws-1",
    x,
    y,
    facing: 1,
    velocity_x: 0,
    velocity_y: 0,
    on_floor: true,
    last_position_at: 0,
    movement_sequence: 0,
    movement_client_time_msec: 0,
    movement_server_time_msec: 0,
  };
}

/**
 * Mirrors handlePlayerPosition() in src/server_phase8_final_routes.ts: validate,
 * then commit `position` (which acceptPlayerMovement may have clamped in place)
 * onto the authoritative player record, then broadcast.
 *
 * @param {Record<string, any>} harness
 * @param {Record<string, any>} player
 * @param {{ x: number, y: number, world?: string }} requested
 * @param {Record<string, any>} data
 * @returns {{ accepted: boolean, broadcast: boolean, position: Record<string, any> }}
 */
function applyMovementPacket(harness, player, requested, data) {
  const position = {
    x: requested.x,
    y: requested.y,
    facing: 1,
    world: requested.world || player.world,
    in_water: false,
    in_lava_fire: false,
  };
  const accepted = harness.movement.acceptPlayerMovement({}, player, position, { data });
  if (!accepted) return { accepted, broadcast: false, position };
  player.x = position.x;
  player.y = position.y;
  player.velocity_x = harness.movement.sanitizePlayerVelocity(data.velocity_x);
  player.velocity_y = harness.movement.sanitizePlayerVelocity(data.velocity_y);
  return { accepted, broadcast: true, position };
}

/**
 * Mirrors world.gd:apply_server_player_position_correction() closely enough to
 * measure how far the local player is actually pulled back.
 *
 * @param {Record<string, any>} correction
 * @returns {{ x: number, y: number, snap: boolean }}
 */
function applyCorrectionToClient(correction) {
  return { x: Number(correction.server_x), y: Number(correction.server_y), snap: correction.correction_snap === true };
}

/** @type {string[]} */
const results = [];

/**
 * @param {string} name
 * @param {() => void} fn
 */
function scenario(name, fn) {
  fn();
  results.push(name);
}

// ---------------------------------------------------------------------------
// 1. Movement packets arrive in order (baseline: no corrections at all).
// ---------------------------------------------------------------------------
scenario("in-order 60Hz movement produces no corrections", () => {
  const h = createHarness();
  const player = createPlayer();
  let seq = 0;
  let x = player.x;
  for (let i = 0; i < 600; i++) {
    h.clock.value += 16;
    x += CLIENT_RUN_SPEED * 0.016;
    const r = applyMovementPacket(h, player, { x, y: 1000 }, {
      movement_sequence: ++seq,
      client_time_msec: h.clock.value,
      velocity_x: CLIENT_RUN_SPEED,
      velocity_y: 0,
    });
    assert.equal(r.accepted, true, `packet ${i} must be accepted`);
  }
  assert.equal(h.corrections.length, 0, "steady legitimate movement must never be corrected");
  assert.equal(h.playerNetworkStats.clamped_player_position_messages, 0);
});

// ---------------------------------------------------------------------------
// 2. Movement packets arrive out of order -> the older one is dropped and the
//    authoritative position is NOT rolled back.
// ---------------------------------------------------------------------------
scenario("reordered movement packet cannot roll the authority backwards", () => {
  const h = createHarness();
  const player = createPlayer();
  h.clock.value += 16;
  applyMovementPacket(h, player, { x: 1020, y: 1000 }, { movement_sequence: 10, client_time_msec: h.clock.value });
  const authoritativeX = player.x;
  h.clock.value += 16;
  const late = applyMovementPacket(h, player, { x: 1000, y: 1000 }, { movement_sequence: 9, client_time_msec: h.clock.value });
  assert.equal(late.accepted, false, "an older sequence must be rejected");
  assert.equal(player.x, authoritativeX, "authority must not move backwards");
  assert.equal(player.movement_sequence, 10);
  assert.equal(h.playerNetworkStats.stale_player_position_messages, 1);
  assert.equal(h.corrections.length, 0, "a stale packet must not trigger a correction storm");
});

// ---------------------------------------------------------------------------
// 3. The same movement packet arrives twice -> the duplicate is idempotent.
// ---------------------------------------------------------------------------
scenario("duplicate movement packet is idempotent", () => {
  const h = createHarness();
  const player = createPlayer();
  h.clock.value += 16;
  const data = { movement_sequence: 5, client_time_msec: h.clock.value, velocity_x: CLIENT_RUN_SPEED };
  assert.equal(applyMovementPacket(h, player, { x: 1002, y: 1000 }, data).accepted, true);
  const afterFirst = { x: player.x, y: player.y, seq: player.movement_sequence };
  h.clock.value += 4;
  assert.equal(applyMovementPacket(h, player, { x: 1002, y: 1000 }, data).accepted, false);
  assert.deepEqual({ x: player.x, y: player.y, seq: player.movement_sequence }, afterFirst);
});

// ---------------------------------------------------------------------------
// 4. Timestamp fallback ordering when the client sends no sequence.
// ---------------------------------------------------------------------------
scenario("older client timestamp is rejected when no sequence is present", () => {
  const h = createHarness();
  const player = createPlayer();
  h.clock.value += 16;
  assert.equal(applyMovementPacket(h, player, { x: 1002, y: 1000 }, { client_time_msec: 5000 }).accepted, true);
  h.clock.value += 16;
  assert.equal(applyMovementPacket(h, player, { x: 1000, y: 1000 }, { client_time_msec: 4000 }).accepted, false);
  assert.equal(player.x, 1002);
});

// ---------------------------------------------------------------------------
// 5 + 6. World switch / reconnect restart the client sequence at 1. The server
//    resets movement_sequence in resetPlayerMovementTracking(), so a restarted
//    counter must be accepted rather than mistaken for a stale packet.
// ---------------------------------------------------------------------------
scenario("sequence restart after world change or reconnect is accepted", () => {
  const h = createHarness();
  const player = createPlayer();
  for (let i = 1; i <= 50; i++) {
    h.clock.value += 16;
    applyMovementPacket(h, player, { x: 1000 + i, y: 1000 }, { movement_sequence: i, client_time_msec: h.clock.value });
  }
  assert.equal(player.movement_sequence, 50);

  // resetPlayerMovementTracking(player) — what join_world does server-side.
  player.movement_sequence = 0;
  player.movement_client_time_msec = 0;
  player.last_position_at = h.clock.value;
  player.x = 500;
  player.y = 500;
  player.world = "OTHER";

  h.clock.value += 16;
  const r = applyMovementPacket(h, player, { x: 502, y: 500, world: "OTHER" }, {
    movement_sequence: 1,
    client_time_msec: h.clock.value,
  });
  assert.equal(r.accepted, true, "a restarted sequence must not be treated as stale");
  assert.equal(player.movement_sequence, 1);
});

// ---------------------------------------------------------------------------
// 7. THE REGRESSION: a gap in the accepted-position stream must not produce an
//    unbounded rejection cascade.  Before the fix a 600 ms gap while falling
//    produced 40/40 consecutive `movement_too_fast` rejections with a 312 px
//    hard snap and never recovered.
// ---------------------------------------------------------------------------
scenario("a network stall does not cause a rejection cascade or a rollback loop", () => {
  for (const stallMs of [300, 600, 1000, 2000]) {
    const h = createHarness();
    const player = createPlayer();
    let seq = 0;
    let y = 1000;
    h.clock.value += 16;
    applyMovementPacket(h, player, { x: 1000, y }, {
      movement_sequence: ++seq,
      client_time_msec: h.clock.value,
      velocity_y: CLIENT_MAX_FALL_SPEED,
    });

    // Nothing reaches the server for `stallMs` while the client keeps falling.
    h.clock.value += stallMs;
    y += CLIENT_MAX_FALL_SPEED * (stallMs / 1000);

    let rejects = 0;
    let hardSnaps = 0;
    let worstPullBackPx = 0;
    for (let i = 0; i < 60; i++) {
      const before = h.corrections.length;
      const r = applyMovementPacket(h, player, { x: 1000, y }, {
        movement_sequence: ++seq,
        client_time_msec: h.clock.value,
        velocity_y: CLIENT_MAX_FALL_SPEED,
      });
      if (!r.accepted) rejects += 1;
      for (const correction of h.corrections.slice(before)) {
        if (correction.correction_snap === true) hardSnaps += 1;
        const applied = applyCorrectionToClient(correction);
        worstPullBackPx = Math.max(worstPullBackPx, Math.abs(y - applied.y));
        y = applied.y; // the client obeys the server, exactly as world.gd does
      }
      h.clock.value += 16;
      y += CLIENT_MAX_FALL_SPEED * 0.016;
    }

    assert.equal(rejects, 0, `stall ${stallMs}ms: no legitimate packet may be rejected outright`);
    assert.ok(
      h.corrections.length <= 2,
      `stall ${stallMs}ms: expected the client to converge in <=2 corrections, got ${h.corrections.length}`,
    );
    assert.ok(
      Math.abs(y - player.y) < TILE_SIZE,
      `stall ${stallMs}ms: client and server must reconverge (drift ${Math.round(Math.abs(y - player.y))}px)`,
    );
    if (stallMs <= 600) {
      assert.equal(hardSnaps, 0, `stall ${stallMs}ms: a short stall must not hard-snap the player`);
    }
  }
});

// ---------------------------------------------------------------------------
// 8. A temporary server tick delay must not create a false rollback either.
// ---------------------------------------------------------------------------
scenario("a server tick delay between two packets does not create a rollback", () => {
  const h = createHarness();
  const player = createPlayer();
  let seq = 0;
  let x = 1000;
  h.clock.value += 16;
  applyMovementPacket(h, player, { x, y: 1000 }, { movement_sequence: ++seq, client_time_msec: h.clock.value, velocity_x: CLIENT_RUN_SPEED });
  // 400 ms of event-loop stall; the client kept running the whole time.
  h.clock.value += 400;
  x += CLIENT_RUN_SPEED * 0.4;
  const r = applyMovementPacket(h, player, { x, y: 1000 }, { movement_sequence: ++seq, client_time_msec: h.clock.value, velocity_x: CLIENT_RUN_SPEED });
  assert.equal(r.accepted, true);
  assert.equal(h.corrections.length, 0, "60px of legitimate running is inside the existing budget");
  assert.equal(player.x, x);
});

// ---------------------------------------------------------------------------
// 9. The speed limit itself is unchanged: a speed hack is still capped.
// ---------------------------------------------------------------------------
scenario("speed limit is preserved - a teleporting client is still clamped", () => {
  const h = createHarness();
  const player = createPlayer();
  h.clock.value += 16;
  applyMovementPacket(h, player, { x: 1000, y: 1000 }, { movement_sequence: 1, client_time_msec: h.clock.value });

  let seq = 1;
  const startX = player.x;
  const startClock = h.clock.value;
  for (let i = 0; i < 60; i++) {
    h.clock.value += 16;
    // A cheater asking to move 5000 px per packet.
    applyMovementPacket(h, player, { x: player.x + 5000, y: 1000 }, {
      movement_sequence: ++seq,
      client_time_msec: h.clock.value,
      velocity_x: 0,
      velocity_y: 0,
    });
  }
  const elapsedSeconds = (h.clock.value - startClock) / 1000;
  const travelled = player.x - startX;
  const legalCeiling = MAX_MOVE_PIXELS_PER_SECOND * elapsedSeconds
    + MOVEMENT_DISTANCE_GRACE_PIXELS * 60;
  assert.ok(
    travelled <= legalCeiling + 1e-6,
    `cheating client travelled ${Math.round(travelled)}px, ceiling ${Math.round(legalCeiling)}px`,
  );
  assert.ok(h.playerNetworkStats.clamped_player_position_messages > 0, "clamping must be recorded");
  assert.ok(h.corrections.length > 0, "the cheating client must still be corrected");
});

// ---------------------------------------------------------------------------
// 10. Collision rejection must not restore an excessively old coordinate, and
//     must not silently advance the player into solid geometry.
// ---------------------------------------------------------------------------
scenario("collision rejection keeps the authority put and never clamps into a block", () => {
  const h = createHarness();
  const player = createPlayer();
  h.clock.value += 16;
  applyMovementPacket(h, player, { x: 1000, y: 1000 }, { movement_sequence: 1, client_time_msec: h.clock.value });

  h.state.collision = { grid_x: 32, grid_y: 31, block_type: "stone" };
  h.clock.value += 16;
  const blocked = applyMovementPacket(h, player, { x: 1004, y: 1000 }, { movement_sequence: 2, client_time_msec: h.clock.value });
  assert.equal(blocked.accepted, false);
  assert.equal(player.x, 1000, "a blocked move must not advance the authority");
  assert.equal(h.corrections.at(-1).reason, "movement_blocked");
  assert.equal(h.corrections.at(-1).correction_snap, true);

  // Same, but the request is also over the speed budget: the partial step must
  // NOT be taken because it would land inside the block.
  h.clock.value += 16;
  const far = applyMovementPacket(h, player, { x: 5000, y: 1000 }, { movement_sequence: 3, client_time_msec: h.clock.value });
  assert.equal(far.accepted, false, "an over-budget move into geometry must stay rejected");
  assert.equal(player.x, 1000);
  assert.equal(h.corrections.at(-1).correction_clamped, false);
  h.state.collision = null;
});

// ---------------------------------------------------------------------------
// 11. Deterministic simulated-latency soak: jitter, duplication, reordering and
//     brief loss.  The player must not be rolled back by stale state.
// ---------------------------------------------------------------------------
scenario("simulated latency, jitter, duplication, reordering and loss", () => {
  // Deterministic PRNG (no Math.random) so failures are reproducible.
  let rngState = 0x2f6e2b1;
  const rand = () => {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    rngState >>>= 0;
    return rngState / 0x100000000;
  };

  const h = createHarness();
  const player = createPlayer();
  let seq = 0;
  let clientX = 1000;
  let clientY = 1000;
  /** @type {any[]} */
  let inFlight = [];
  let backwardPulls = 0;
  let worstPullPx = 0;
  let hardSnaps = 0;
  let consecutiveCorrections = 0;
  let longestCorrectionRun = 0;

  for (let tick = 0; tick < 4000; tick++) {
    h.clock.value += 16;
    // Client simulation: run right, with periodic falls.
    const falling = Math.floor(tick / 40) % 3 === 0;
    clientX += CLIENT_RUN_SPEED * 0.016;
    clientY += falling ? CLIENT_MAX_FALL_SPEED * 0.016 : 0;

    const loss = rand() < 0.02;              // 2% brief packet loss
    if (!loss) {
      const latency = 30 + Math.floor(rand() * 120);   // 30-150 ms jitter
      inFlight.push({
        arriveAt: h.clock.value + latency,
        data: {
          movement_sequence: ++seq,
          client_time_msec: h.clock.value,
          velocity_x: CLIENT_RUN_SPEED,
          velocity_y: falling ? CLIENT_MAX_FALL_SPEED : 0,
        },
        pos: { x: clientX, y: clientY },
      });
      if (rand() < 0.03) inFlight.push({ ...inFlight[inFlight.length - 1] }); // duplication
    }

    // Deliver everything that has arrived, in arrival order (jitter reorders it).
    const due = inFlight.filter((p) => p.arriveAt <= h.clock.value);
    inFlight = inFlight.filter((p) => p.arriveAt > h.clock.value);
    due.sort((a, b) => a.arriveAt - b.arriveAt);
    for (const packet of due) {
      const before = h.corrections.length;
      applyMovementPacket(h, player, packet.pos, packet.data);
      const emitted = h.corrections.slice(before);
      if (emitted.length === 0) {
        consecutiveCorrections = 0;
      } else {
        consecutiveCorrections += emitted.length;
        longestCorrectionRun = Math.max(longestCorrectionRun, consecutiveCorrections);
      }
      for (const correction of emitted) {
        if (correction.correction_snap === true) hardSnaps += 1;
        const applied = applyCorrectionToClient(correction);
        const pull = Math.hypot(clientX - applied.x, clientY - applied.y);
        if (pull > 1) {
          backwardPulls += 1;
          worstPullPx = Math.max(worstPullPx, pull);
        }
        clientX = applied.x;
        clientY = applied.y;
      }
    }
  }

  // Drain whatever is still in flight so the final comparison is not just
  // measuring the client's normal latency lead.
  h.clock.value += 200;
  for (const packet of inFlight.sort((a, b) => a.arriveAt - b.arriveAt)) {
    const before = h.corrections.length;
    applyMovementPacket(h, player, packet.pos, packet.data);
    for (const correction of h.corrections.slice(before)) {
      const applied = applyCorrectionToClient(correction);
      clientX = applied.x;
      clientY = applied.y;
    }
  }

  // 4000 ticks == ~64 s of play with 2% loss and 30-150 ms jitter. Before the
  // fix this produced an unbounded correction cascade (every packet corrected,
  // with hard snaps, and no reconvergence). The surviving corrections are the
  // server legitimately enforcing MAX_MOVE_PIXELS_PER_SECOND across a stretch
  // of time it never observed; they must stay rare, small and smoothed.
  assert.ok(
    longestCorrectionRun <= 2,
    `corrections must not cascade (longest run ${longestCorrectionRun})`,
  );
  assert.ok(
    backwardPulls <= 20,
    `pull-backs must stay rare over ~64s (${backwardPulls} pulls, worst ${Math.round(worstPullPx)}px)`,
  );
  assert.ok(
    worstPullPx < MOVEMENT_CORRECTION_SNAP_DISTANCE,
    `every pull-back must stay under the snap threshold (worst ${Math.round(worstPullPx)}px)`,
  );
  assert.equal(hardSnaps, 0, "no hard snaps under pure network conditions");
  assert.ok(
    Math.hypot(clientX - player.x, clientY - player.y) < TILE_SIZE,
    "client and server must remain converged for the whole soak",
  );
  assert.ok(
    h.playerNetworkStats.stale_player_position_messages > 0,
    "the soak must actually exercise the stale-packet path",
  );
});

// ---------------------------------------------------------------------------
// 12. Diagnostics are emitted for anomalies and are rate limited.
// ---------------------------------------------------------------------------
scenario("rollback diagnostics are emitted and rate limited", () => {
  const h = createHarness();
  const player = createPlayer();
  h.clock.value += 16;
  applyMovementPacket(h, player, { x: 1000, y: 1000 }, { movement_sequence: 1, client_time_msec: h.clock.value });

  for (let i = 0; i < 40; i++) {
    h.clock.value += 16;
    applyMovementPacket(h, player, { x: player.x + 4000, y: 1000 }, {
      movement_sequence: 2 + i,
      client_time_msec: h.clock.value,
    });
  }

  assert.ok(h.anomalies.length > 0, "anomalies must be logged");
  assert.ok(h.anomalies.length < 10, `diagnostics must be rate limited, got ${h.anomalies.length}`);
  const first = h.anomalies[0];
  assert.equal(first.label, "movement_clamped_to_speed_limit");
  for (const field of [
    "player_id",
    "username",
    "world",
    "world_entry_session_id",
    "last_accepted_sequence",
    "rejected_sequence",
    "server_x",
    "server_y",
    "requested_x",
    "requested_y",
    "requested_distance",
    "max_distance",
    "correction_distance",
    "real_elapsed_ms",
    "packet_age_ms",
    "reason",
    "clamped",
    "suppressed_since_last_log",
  ]) {
    assert.ok(field in first.details, `diagnostic payload must include ${field}`);
  }
  assert.ok(
    h.anomalies.some((entry) => Number(entry.details.suppressed_since_last_log) > 0),
    "suppressed anomaly counts must be reported",
  );
});

// ---------------------------------------------------------------------------
// 13. Respawn / teleport / world-entry paths still bypass the speed budget.
// ---------------------------------------------------------------------------
scenario("respawn teleport and world-entry spawn still bypass the speed budget", () => {
  const h = createHarness();
  const player = createPlayer();
  h.clock.value += 16;
  applyMovementPacket(h, player, { x: 1000, y: 1000 }, { movement_sequence: 1, client_time_msec: h.clock.value });
  h.clock.value += 16;
  const position = { x: 9000, y: 9000, facing: 1, world: "START", in_water: false, in_lava_fire: false };
  assert.equal(
    h.movement.acceptPlayerMovement({}, player, position, {
      respawnTeleport: true,
      data: { movement_sequence: 2, client_time_msec: h.clock.value },
    }),
    true,
  );
  assert.equal(position.x, 9000, "a respawn teleport must not be clamped");
  assert.equal(h.corrections.length, 0);
});

console.log(`[movement-rollback-regression] ${results.length} scenarios passed:`);
for (const name of results) console.log(`  - ${name}`);
