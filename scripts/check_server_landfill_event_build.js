#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LandfillEventModule = require("../server_landfill_event");

const repoRoot = path.join(__dirname, "..");
JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
fs.readFileSync(path.join(repoRoot, "src", "server_landfill_event.ts"), "utf8");
fs.readFileSync(path.join(repoRoot, "server_landfill_event.js"), "utf8");
fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_landfill_event_build.js"), "utf8");
JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-landfill-event.json"), "utf8"));

function makeFakePostgresStore() {
  /** @type {Map<string, number>} */
  const scores = new Map(); // `${username}:${seasonKey}` -> kilograms
  /** @type {Set<string>} */
  const claims = new Set(); // `${username}:${seasonKey}`

  return {
    scores,
    claims,
    async incrementLandfillKilograms(/** @type {string} */ username, /** @type {string} */ seasonKey, /** @type {number} */ amount) {
      const key = `${username}:${seasonKey}`;
      scores.set(key, (scores.get(key) || 0) + amount);
      return { ok: true, kilograms: scores.get(key) };
    },
    async getLandfillLeaderboard(/** @type {string} */ seasonKey, /** @type {number} */ limit) {
      const entries = Array.from(scores.entries())
        .filter(([key]) => key.endsWith(`:${seasonKey}`))
        .map(([key, kilograms]) => ({ username: key.split(":")[0], kilograms }))
        .sort((a, b) => b.kilograms - a.kilograms)
        .slice(0, limit)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
      return { ok: true, entries };
    },
    async getLandfillPlayerScore(/** @type {string} */ username, /** @type {string} */ seasonKey) {
      const key = `${username}:${seasonKey}`;
      return { kilograms: scores.get(key) || 0, rank: 0 };
    },
    async insertLandfillPrizeClaim(/** @type {string} */ username, /** @type {string} */ seasonKey, /** @type {number} */ rank) {
      const key = `${username}:${seasonKey}`;
      if (claims.has(key)) return { ok: true, inserted: false };
      claims.add(key);
      return { ok: true, inserted: true };
    },
    async deleteLandfillPrizeClaim(/** @type {string} */ username, /** @type {string} */ seasonKey) {
      claims.delete(`${username}:${seasonKey}`);
      return { ok: true };
    },
  };
}

async function main() {
  assert.equal(LandfillEventModule.isLandfillWorldName("landfill_1"), true);
  assert.equal(LandfillEventModule.isLandfillWorldName("START"), false);
  assert.equal(LandfillEventModule.getSeasonKeyForDate(new Date("2026-08-15T00:00:00Z")), "2026-08");
  assert.equal(LandfillEventModule.getSeasonKeyForDate(new Date("2026-01-01T00:00:00Z")), "2026-01");

  /** @type {Map<string, Record<string, any>>} */
  const playerStates = new Map([
    ["alice", { account_username: "alice", inventory: [] }],
  ]);
  /** @type {Record<string, number>} */
  const populationByWorld = {};
  let eventOpen = true;

  const postgresStore = makeFakePostgresStore();

  const system = LandfillEventModule.createLandfillEventSystem({
    cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim().toLowerCase(),
    ensureWritablePlayerState: (/** @type {string} */ username) => playerStates.get(username) || null,
    canAddItemToState: () => true,
    addItemToState: () => true,
    cloneJson: (/** @type {Record<string, any>} */ value) => JSON.parse(JSON.stringify(value)),
    commitPlayerInventoryState: async () => ({ ok: true }),
    postgresStore,
    getWorldPopulationCount: (/** @type {string} */ worldName) => populationByWorld[worldName] || 0,
    sendJson: () => {},
    makeRequestId: () => "req_test",
    getErrorMessage: (/** @type {unknown} */ error) => (error instanceof Error ? error.message : String(error)),
    minPlayersToStart: 2,
    maxPlayersPerInstance: 5,
    isEventWindowOpen: () => eventOpen,
  });

  // Trash weight registry starts empty; unregistered blocks award nothing.
  assert.equal(system.getTrashBlockWeight("banana_peel"), 0);
  system.registerTrashBlockWeight("banana_peel", 3);
  assert.equal(system.getTrashBlockWeight("banana_peel"), 3);

  // Join requests are refused while the event window is closed.
  eventOpen = false;
  const closedResult = system.requestJoinLandfillRace();
  assert.equal(closedResult.ok, false);
  assert.equal(closedResult.reason, "event_not_active");
  eventOpen = true;

  // First join creates a fresh numbered instance.
  const first = system.requestJoinLandfillRace();
  assert.equal(first.ok, true);
  assert.equal(first.world_name, "landfill_1");

  // While that instance still has room, more joiners go to the same instance.
  populationByWorld["landfill_1"] = 3;
  const second = system.requestJoinLandfillRace();
  assert.equal(second.world_name, "landfill_1");

  // Once an instance is full (>= maxPlayersPerInstance), new joiners are routed elsewhere.
  populationByWorld["landfill_1"] = 5;
  const third = system.requestJoinLandfillRace();
  assert.equal(third.world_name, "landfill_2", "a full instance should overflow joiners to a new instance");

  // Kilograms are only awarded inside a Landfill world for a registered trash block.
  await system.awardKilogramsForBlockBreak("landfill_1", "alice", "banana_peel");
  await system.awardKilogramsForBlockBreak("landfill_1", "alice", "not_a_trash_block");
  await system.awardKilogramsForBlockBreak("START", "alice", "banana_peel");
  const seasonKey = system.getCurrentSeasonKey();
  assert.equal(postgresStore.scores.get(`alice:${seasonKey}`), 3, "only the Landfill-world, registered-trash-block break should have scored");

  // --- Phase 2: join_world-layer eligibility guard (canPlayerJoinLandfillInstance /
  // recordLandfillInstanceJoin), exercised against landfill_2 (created above by the overflow
  // test, still empty/"entry" at this point). ---

  // A no-op for any world that isn't a Landfill instance -- must never block a normal join.
  assert.equal(system.canPlayerJoinLandfillInstance("START", "bob").ok, true);

  // A world name nobody ever routed a player to (never created via requestJoinLandfillRace, and
  // not garbage-collected either -- just never existed) fails closed rather than silently
  // admitting into an untracked instance.
  const unknown = system.canPlayerJoinLandfillInstance("landfill_99", "bob");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "instance_not_found");

  // Fill landfill_2 to maxPlayersPerInstance (5) via the same eligibility-check-then-record
  // sequence handleJoinWorld performs; the 6th distinct player must be refused *before* the
  // ~5s population poll would ever see the instance as full.
  for (let i = 1; i <= 5; i += 1) {
    const username = `p${i}`;
    const check = system.canPlayerJoinLandfillInstance("landfill_2", username);
    assert.equal(check.ok, true, `p${i} should be admitted (slot ${i} of 5)`);
    system.recordLandfillInstanceJoin("landfill_2", username);
  }
  const overflowJoiner = system.canPlayerJoinLandfillInstance("landfill_2", "p6");
  assert.equal(overflowJoiner.ok, false);
  assert.equal(overflowJoiner.reason, "instance_full");

  // Once the instance locks (state flips "entry" -> "active", normally done by the population
  // poll once minPlayersToStart is reached), a brand-new player must be rejected, but any
  // already-recorded participant must still be able to rejoin their own instance (e.g. after a
  // disconnect) even though it is locked and nominally full.
  const landfill2 = system.listInstances().find((instance) => instance.worldName === "landfill_2");
  assert.ok(landfill2, "landfill_2 should be discoverable via listInstances()");
  landfill2.state = "active";
  const lateStranger = system.canPlayerJoinLandfillInstance("landfill_2", "p7");
  assert.equal(lateStranger.ok, false);
  assert.equal(lateStranger.reason, "instance_locked");
  const reconnectingParticipant = system.canPlayerJoinLandfillInstance("landfill_2", "p1");
  assert.equal(reconnectingParticipant.ok, true, "an already-recorded participant must be able to rejoin their own locked instance");

  console.log("[check_server_landfill_event_build] all assertions passed.");
}

main().catch((error) => {
  console.error("[check_server_landfill_event_build] FAILED:", error);
  process.exitCode = 1;
});
