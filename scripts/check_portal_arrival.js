"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
const start = source.indexOf("async function handleDoorEnterRequest(");
const end = source.indexOf("\n}", start) + 2;
assert.ok(start > 0 && end > start);

// Reuse the standard movement fixture, but wire in the real spawn guard instead
// of its unit-test stub. This reproduces source packets arriving after teleport.
const fixtureSource = fs.readFileSync(require.resolve("./check_server_phase11d_standard_movement_build.js"), "utf8");
const fixtureStart = fixtureSource.indexOf("function createFixture(");
const fixtureEnd = fixtureSource.indexOf("\n}", fixtureStart) + 2;
const fixtureContext = vm.createContext({Phase11dStandardMovementModule: require("../server_phase11d_standard_movement")});
vm.runInContext(fixtureSource.slice(fixtureStart, fixtureEnd), fixtureContext);
const guard = require("../server_phase11c_trusted_movement").createServerPhase11cTrustedMovement({
  cleanWorld: value => String(value).toUpperCase(),
  isPositionInWorldBounds: (x,y) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0,
  WORLD_ENTRY_SPAWN_GUARD_MS:30000, WORLD_ENTRY_SPAWN_TOLERANCE_PIXELS:4,
  nowMs: () => 1000,
});

(async () => {
  for (const targetX of [2, 24]) {
    const player = {world:"TEST", joined_world:true, x:480, y:128};
    const destination = {block:{x:targetX, y:4}, door_id:"LEFT"};
    const reachedGuard = new Error("destination guard reached");
    let guarded = null;
    const context = {
      requireAuthenticated: () => true, getPlayerCurrentWorldName: p => p.world,
      cleanWorld: s => s, requireSameWorld: () => true, rejectIfWorldBanned: async () => false,
      sanitizeDoorEnterRequest: data => data,
      getDoorAtGrid: () => ({block:{block_type:"blue_portal"}, target_world:"TEST", target_door_id:"LEFT", destination:"door:LEFT"}),
      isPlayerNearGrid: () => true, isPasswordDoorBlockType: () => false,
      IdentityHelpers: {isValidDoorDestinationWorld: () => true, isValidWorldName: () => true},
      WorldNames: {enabled:false}, cleanDoorId: s => s, findDoorById: () => destination,
      getGridCenterPixels: (x,y) => ({x:x*32, y:y*32}),
      updatePlayerWorldIndex: () => {}, resetPlayerMovementTracking: () => {},
      setPlayerWorldEntrySpawnGuard: (p, world, position) => {
        assert.equal(world, "TEST");
        assert.equal(p.x, targetX*32);
        assert.equal(p.y, 128);
        guarded = position;
        guard.setPlayerWorldEntrySpawnGuard(p, world, position);
        throw reachedGuard; // Stop before persistence/presence; exercise the real travel setup.
      },
      releaseWorldAdmissionReservation: async () => {},
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    await assert.rejects(context.handleDoorEnterRequest({}, player, {x:15,y:4,world:"TEST"}), error => error === reachedGuard);
    assert.equal(guarded.x, targetX*32, "Guard the linked portal, not the source or an entrance gate");
    assert.equal(guarded.y, 128);
    const movementFixture = fixtureContext.createFixture({
      checkPlayerWorldEntrySpawnGuard: guard.checkPlayerWorldEntrySpawnGuard,
      clearPlayerWorldEntrySpawnGuard: guard.clearPlayerWorldEntrySpawnGuard,
    });
    Object.assign(player, {id:"portal-test", account_username:"portal-test", authenticated:true, last_position_at:1000});
    for (let sequence = 1; sequence <= 8; sequence++) {
      movementFixture.clock.value += 16;
      const accepted = movementFixture.movement.acceptPlayerMovement({}, player, {world:"TEST", x:480, y:137}, {
        data:{movement_sequence:sequence, client_time_msec:sequence*16},
      });
      assert.equal(accepted, false, "Queued source movement must be rejected, not clamped toward the old portal");
      assert.equal(player.x, targetX*32, "Server must stay exactly at the landing tile");
      assert.equal(player.y, 128);
      const correction = movementFixture.correctionRejections.at(-1).details;
      assert.equal(correction.reason, "world_entry_position_pending");
      assert.equal(correction.server_x, targetX*32, "Corrections must point at the portal, never partway between portals");
      assert.equal(correction.server_y, 128);
    }
    assert.equal(movementFixture.movement.acceptPlayerMovement({}, player, {world:"TEST", x:targetX*32, y:128}, {
      data:{movement_sequence:9, client_time_msec:144},
    }), true, "Destination acknowledgement resumes normal movement immediately");
    assert.equal(player.world_entry_spawn_guard, undefined);
  }
  console.log("PORTAL_ARRIVAL_OK: same-world travel protects the exact linked destination from stale source movement");
})().catch(error => { console.error(error); process.exitCode = 1; });
