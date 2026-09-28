#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
function compile(name, deps) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start > 0, name);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n(?:async )?function /) + 1;
  return new Function(...Object.keys(deps), `${rest.slice(0, next)};return ${name};`)(...Object.values(deps));
}
const DAY = 86400000;
function activityHarness(ageDays = 365) {
  const now = Date.parse("2027-10-01T00:00:00Z");
  const state = { now, ready: true, redisOnline: false, online: false, rows: [
    { username: "OWNER", account_id: "a1", player_id: "p1", last_login_at: new Date(now - ageDays * DAY).toISOString() },
  ] };
  const accounts = new Map();
  const getStatus = compile("getLockDecayStatus", {
    postgresStore: { getLockAccountActivity: async () => ({ ok: state.ready, entries: state.rows }) },
    accounts, accountKey: (v) => String(v || "").toLowerCase(),
    findOnlinePlayerByUsername: () => state.online,
    REDIS_ENABLED: true, redisStore: { hasActiveSessions: async () => state.redisOnline },
    Date: class extends Date { static now() { return state.now; } },
  });
  const lock = { owner_name: "OWNER", owner_account_id: "a1", owner_player_id: "p1", allowed_players: [] };
  return { state, accounts, getStatus, lock };
}
function validationHarness(type, expired) {
  const area = ["small_lock", "medium_lock", "big_lock"].includes(type);
  const block = { block_type: type };
  const lock = { owner_name: "OWNER", is_locked: true, lock_grid_x: 1, lock_grid_y: 2 };
  const state = { foreground: new Map([["1,2", block]]), seeds: new Map(), world_lock: lock };
  const rejected = [];
  const controls = { near: true, owns: false, changeLock: false, storage: true, damageCalled: false };
  const deps = {
    ensureWorldState: () => state, gridKey: (x, y) => `${x},${y}`,
    getBlockActionReachPixels: () => 96, isPlayerNearGrid: () => controls.near,
    getPlayerValidationPosition: () => ({}), usesTrustedMovementPosition: () => false,
    MAX_PLACE_REACH_TILES: 3, MAX_BREAK_REACH_TILES: 3,
    getWorldLayerMap: () => state.foreground, getWorldRemovedLayerMap: () => new Set(),
    ItemDatabase: { getPlaceLayer: () => "foreground", canBreakBlock: () => true },
    WATER_BLOCK_TYPE: "water", isDoorBlockType: () => false,
    isWorldLockBlockType: (v) => ["world_lock", "super_world_lock"].includes(v),
    isAreaLockBlockType: (v) => ["small_lock", "medium_lock", "big_lock"].includes(v),
    getEffectiveWorldLockStateInState: () => lock, getAreaLockAtGrid: () => lock,
    lockOwnerMatchesPlayer: () => controls.owns, areaLockOwnerMatchesPlayer: () => controls.owns,
    canPlayerControlWorldLock: () => controls.owns, canPlayerManageAreaLock: () => controls.owns,
    getLockDecayStatus: async () => {
      if (controls.changeLock) lock.owner_name = "NEWOWNER";
      return { known: true, expired, days: area ? 180 : 365, remaining_days: 1 };
    },
    hasWorldLockProtectedStorageBlocks: () => controls.storage,
    canPlayerBuildAtGrid: () => controls.owns,
    sendActionRejected: (_s, _a, message, details) => rejected.push({ message, ...details }),
    isVendBlockType: () => false, isSafeBlockType: () => false, isDonationBoxBlockType: () => false,
    isDisplayBlockType: () => false, isFishMongerBlockType: () => false, isFishHangerBlockType: () => false,
    isWaterBucketScoopBreak: () => false, validateBlockHitPace: () => true, validateBlockBreakPace: () => true,
    applyServerBlockDamage: () => { controls.damageCalled = true; return { ok: true, shouldBreak: false, hitPower: 1, damage: 1, required: 5 }; },
    clearServerBlockDamage() {}, clampInteger: (value) => value,
    MAX_BLOCK_HIT_METRIC: 1000, BLOCK_DAMAGE_RESET_MS: 5000, getPunchToggleNextBlockType: () => "",
  };
  const validate = compile("validateBlockUpdateAgainstServerState", deps);
  const update = { action: "hit", layer: "foreground", x: 1, y: 2, block_type: type, lock_decay: true };
  return { validate, update, controls, rejected, state };
}
async function main() {
  for (const [world, days] of [[false, 180], [true, 365]]) {
    const h = activityHarness(days);
    h.state.now -= 1;
    assert.equal((await h.getStatus(h.lock, world)).expired, false, "Not even one ms early");
    h.state.now += 1;
    assert.equal((await h.getStatus(h.lock, world)).expired, true, "Exact boundary");
    assert.equal((await h.getStatus({ allowed_players: ["OWNER"] }, world)).known, false, "Missing owner identity fails closed");
    h.lock.allowed_players = ["MEMBER"];
    assert.equal((await h.getStatus(h.lock, world)).known, false, "Unknown member fails closed");
    h.state.rows.push({ username: "MEMBER", account_id: "a2", player_id: "p2", last_login_at: new Date(h.state.now - DAY).toISOString() });
    assert.equal((await h.getStatus(h.lock, world)).expired, false, "Any active access holder protects the lock");
    h.lock.allowed_players = [];
    h.state.rows.pop();
    h.state.redisOnline = true;
    assert.equal((await h.getStatus(h.lock, world)).expired, false, "Online on another route protects the lock");
    h.state.redisOnline = null;
    assert.equal((await h.getStatus(h.lock, world)).known, false, "Redis outage cannot unlock property");
    h.state.redisOnline = false; h.state.online = true;
    assert.equal((await h.getStatus(h.lock, world)).expired, false, "Local online session protects the lock");
    h.state.online = false; h.state.ready = false;
    assert.equal((await h.getStatus(h.lock, world)).known, false, "DB outage cannot unlock property");
    h.state.ready = true;
    h.accounts.set("owner", { last_seen_at: new Date(h.state.now).toISOString() });
    assert.equal((await h.getStatus(h.lock, world)).expired, false, "Recent login not yet flushed protects the lock");
  }
  for (const type of ["small_lock", "medium_lock", "big_lock", "world_lock", "super_world_lock"]) {
    const h = validationHarness(type, true);
    const result = await h.validate({}, {}, "TEST", h.update);
    assert.equal(result.ok, true, type);
    assert.equal(h.update.action, "break", "One hit crumbles an expired lock");
    assert.equal(h.update.lock_decay, true);
    assert.equal(h.controls.damageCalled, false);
    assert.equal(result.inventoryDeltas, undefined, "No lock returned to inventory");
    assert.equal(h.state.foreground.size, 1, "Validation must leave mutation to the committed route");
    const createDrops = compile("createBreakDrops", {});
    assert.deepEqual(createDrops("TEST", h.update), [], "No decay drops");

    const active = validationHarness(type, false);
    assert.equal((await active.validate({}, {}, "TEST", active.update)).ok, false);
    assert.equal(active.rejected[0].reason, "lock_not_decayed", "Forged client flag cannot bypass activity check");
    const far = validationHarness(type, true); far.controls.near = false;
    assert.equal((await far.validate({}, {}, "TEST", far.update)).ok, false);
    assert.equal(far.rejected[0].reason, "too_far");
    const changed = validationHarness(type, true); changed.controls.changeLock = true;
    assert.equal((await changed.validate({}, {}, "TEST", changed.update)).ok, false);
    assert.equal(changed.rejected[0].reason, "lock_changed");
    const owner = validationHarness(type, false); owner.controls.owns = true; owner.controls.storage = false;
    const normal = await owner.validate({}, {}, "TEST", owner.update);
    assert.equal(normal.pendingHit, true, "Owner retains ordinary lock damage and returns");
    assert.equal(owner.controls.damageCalled, true);
  }
  const PostgresStore = require("../postgres_store");
  const store = new PostgresStore({ enabled: false });
  store.isReady = () => true;
  store.queryReadWithRetry = async (_label, sql, params) => {
    assert.match(sql, /last_login_at/);
    assert.match(sql, /LEFT JOIN/);
    assert.deepEqual(params, [["owner"], ["a1"], ["p1"]]);
    return { rows: [{ username: "OWNER" }] };
  };
  assert.equal((await store.getLockAccountActivity(["owner"], ["a1"], ["p1"])).ok, true);
  console.log("[lock-decay] 180/365-day boundaries, access activity, outages, online sessions, lock races, all five lock types, no rewards, and reach checks passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
