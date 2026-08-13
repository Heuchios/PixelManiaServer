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
    /**
     * @param {string} username
     * @param {string} seasonKey
     * @param {number} amount
     */
    async incrementLandfillKilograms(username, seasonKey, amount) {
      const key = `${username}:${seasonKey}`;
      scores.set(key, (scores.get(key) || 0) + amount);
      return { ok: true, kilograms: scores.get(key) };
    },
    /**
     * @param {string} seasonKey
     * @param {number} limit
     */
    async getLandfillLeaderboard(seasonKey, limit) {
      const entries = Array.from(scores.entries())
        .filter(([key]) => key.endsWith(`:${seasonKey}`))
        .map(([key, kilograms]) => ({ username: key.split(":")[0], kilograms }))
        .sort((a, b) => b.kilograms - a.kilograms)
        .slice(0, limit)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
      return { ok: true, entries };
    },
    /**
     * @param {string} username
     * @param {string} seasonKey
     */
    async getLandfillPlayerScore(username, seasonKey) {
      const key = `${username}:${seasonKey}`;
      return { kilograms: scores.get(key) || 0, rank: 0 };
    },
    /**
     * @param {string} username
     * @param {string} seasonKey
     * @param {number} rank
     */
    async insertLandfillPrizeClaim(username, seasonKey, rank) {
      const key = `${username}:${seasonKey}`;
      if (claims.has(key)) return { ok: true, inserted: false };
      claims.add(key);
      return { ok: true, inserted: true };
    },
    /**
     * @param {string} username
     * @param {string} seasonKey
     */
    async deleteLandfillPrizeClaim(username, seasonKey) {
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
    /** @param {any} value */
    cleanAccountName: (value) => String(value || "").trim().toLowerCase(),
    /** @param {string} username */
    ensureWritablePlayerState: (username) => playerStates.get(username) || null,
    canAddItemToState: () => true,
    addItemToState: () => true,
    /** @param {any} value */
    cloneJson: (value) => JSON.parse(JSON.stringify(value)),
    commitPlayerInventoryState: async () => ({ ok: true }),
    postgresStore,
    /** @param {string} worldName */
    getWorldPopulationCount: (worldName) => populationByWorld[worldName] || 0,
    sendJson: () => {},
    makeRequestId: () => "req_test",
    /** @param {any} error */
    getErrorMessage: (error) => String(error && error.message ? error.message : error),
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
  const closedResult = await system.requestJoinLandfillRace();
  assert.equal(closedResult.ok, false);
  assert.equal(closedResult.reason, "event_not_active");
  eventOpen = true;

  // First join creates a fresh numbered instance. Instance names are generated in canonical
  // UPPERCASE (see createNewInstance's comment) because every join_world request that actually
  // reaches this module in production has already been through cleanWorld()
  // (server_identity_helpers.ts), which uppercases everything -- server_phase8_player_session_routes.ts's
  // handleJoinWorld does `const newWorld = deps.cleanWorld(data.world);` BEFORE calling
  // checkLandfillInstanceJoinEligibility. A lowercase-vs-uppercase mismatch here caused every
  // real post-Join-Race join to be rejected as instance_not_found -- this test's world names are
  // deliberately uppercase throughout to match what production actually sees and guard against
  // that regression.
  const first = await system.requestJoinLandfillRace();
  assert.equal(first.ok, true);
  assert.equal(first.world_name, "LANDFILL_1");

  // --- Round-trip regression guard (the actual production failure) ---------------------------
  // The Join Race button's whole contract is: requestJoinLandfillRace hands a world name to the
  // client, the client echoes it back in a join_world request, and handleJoinWorld runs it
  // through cleanWorld() before canPlayerJoinLandfillInstance sees it. That round trip previously
  // returned a lowercase "landfill_1" that could never match the Map, so EVERY Join Race click
  // was rejected instance_not_found and the client stalled at 88% until its retry budget ran out.
  //
  // Assert the property directly rather than just the literal above: whatever name the module
  // hands out MUST be immediately accepted by its own eligibility guard, in the exact form
  // cleanWorld() would produce. simulateCleanWorld mirrors cleanWorld() in
  // server_identity_helpers.ts.
  const simulateCleanWorld = (/** @type {string} */ value) =>
    String(value || "START").trim().toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_-]/g, "").slice(0, 32) || "START";
  const roundTripped = simulateCleanWorld(String(first.world_name));
  assert.equal(
    system.canPlayerJoinLandfillInstance(roundTripped, "round_tripper").ok,
    true,
    "a world name handed out by requestJoinLandfillRace must survive cleanWorld() and still be joinable",
  );

  // The registry must be case-insensitive at the boundary, so no future caller can reintroduce
  // the mismatch by normalizing differently on its way in.
  for (const variant of ["landfill_1", "Landfill_1", "  LANDFILL_1  "]) {
    assert.equal(
      system.canPlayerJoinLandfillInstance(variant, "case_prober").ok,
      true,
      `instance lookup must be canonical, but "${variant}" did not resolve to LANDFILL_1`,
    );
  }

  // While that instance still has room, more joiners go to the same instance.
  populationByWorld["LANDFILL_1"] = 3;
  const second = await system.requestJoinLandfillRace();
  assert.equal(second.world_name, "LANDFILL_1");

  // Once an instance is full (>= maxPlayersPerInstance), new joiners are routed elsewhere.
  populationByWorld["LANDFILL_1"] = 5;
  const third = await system.requestJoinLandfillRace();
  assert.equal(third.world_name, "LANDFILL_2", "a full instance should overflow joiners to a new instance");

  // Kilograms are only awarded inside a Landfill world for a registered trash block.
  await system.awardKilogramsForBlockBreak("LANDFILL_1", "alice", "banana_peel");
  await system.awardKilogramsForBlockBreak("LANDFILL_1", "alice", "not_a_trash_block");
  await system.awardKilogramsForBlockBreak("START", "alice", "banana_peel");
  const seasonKey = system.getCurrentSeasonKey();
  assert.equal(postgresStore.scores.get(`alice:${seasonKey}`), 3, "only the Landfill-world, registered-trash-block break should have scored");

  // --- Phase 2: join_world-layer eligibility guard (canPlayerJoinLandfillInstance /
  // recordLandfillInstanceJoin), exercised against LANDFILL_2 (created above by the overflow
  // test, still empty/"entry" at this point), and called with the SAME post-cleanWorld uppercase
  // form handleJoinWorld actually passes in -- this is the exact call shape the case-mismatch
  // bug broke. ---

  // A no-op for any world that isn't a Landfill instance -- must never block a normal join.
  assert.equal(system.canPlayerJoinLandfillInstance("START", "bob").ok, true);

  // A world name nobody ever routed a player to (never created via requestJoinLandfillRace, and
  // not garbage-collected either -- just never existed) fails closed rather than silently
  // admitting into an untracked instance.
  const unknown = system.canPlayerJoinLandfillInstance("LANDFILL_99", "bob");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "instance_not_found");

  // Fill LANDFILL_2 to maxPlayersPerInstance (5) via the same eligibility-check-then-record
  // sequence handleJoinWorld performs; the 6th distinct player must be refused *before* the
  // ~5s population poll would ever see the instance as full.
  for (let i = 1; i <= 5; i += 1) {
    const username = `p${i}`;
    const check = system.canPlayerJoinLandfillInstance("LANDFILL_2", username);
    assert.equal(check.ok, true, `p${i} should be admitted (slot ${i} of 5)`);
    system.recordLandfillInstanceJoin("LANDFILL_2", username);
  }
  const overflowJoiner = system.canPlayerJoinLandfillInstance("LANDFILL_2", "p6");
  assert.equal(overflowJoiner.ok, false);
  assert.equal(overflowJoiner.reason, "instance_full");

  // Once the instance locks (state flips "entry" -> "active", normally done by the population
  // poll once minPlayersToStart is reached), a brand-new player must be rejected, but any
  // already-recorded participant must still be able to rejoin their own instance (e.g. after a
  // disconnect) even though it is locked and nominally full.
  const landfill2 = system.listInstances().find((instance) => instance.worldName === "LANDFILL_2");
  assert.ok(landfill2, "LANDFILL_2 should be discoverable via listInstances()");
  landfill2.state = "active";
  const lateStranger = system.canPlayerJoinLandfillInstance("LANDFILL_2", "p7");
  assert.equal(lateStranger.ok, false);
  assert.equal(lateStranger.reason, "instance_locked");
  const reconnectingParticipant = system.canPlayerJoinLandfillInstance("LANDFILL_2", "p1");
  assert.equal(reconnectingParticipant.ok, true, "an already-recorded participant must be able to rejoin their own locked instance");

  // --- Abandoned-entry slot reconciliation ----------------------------------------------------
  // recordLandfillInstanceJoin runs in handleJoinWorld BEFORE the world-route check that can still
  // fail the join, so a join that dies after that point leaves a username holding a capacity slot
  // for a player who never arrived. Without reconciliation those slots accumulate until the
  // instance reports instance_full with nobody in it -- permanently un-joinable. Uses its own
  // system so the release threshold can be driven deterministically.
  /** @type {Record<string, number>} */
  const abandonedPopulation = {};
  const abandonedSystem = LandfillEventModule.createLandfillEventSystem({
    /** @param {any} value */
    cleanAccountName: (value) => String(value || "").trim().toLowerCase(),
    ensureWritablePlayerState: () => null,
    canAddItemToState: () => true,
    addItemToState: () => true,
    /** @param {any} value */
    cloneJson: (value) => JSON.parse(JSON.stringify(value)),
    commitPlayerInventoryState: async () => ({ ok: true }),
    postgresStore: makeFakePostgresStore(),
    /** @param {string} worldName */
    getWorldPopulationCount: (worldName) => abandonedPopulation[worldName] || 0,
    sendJson: () => {},
    makeRequestId: () => "req_test",
    /** @param {any} error */
    getErrorMessage: (error) => String(error && error.message ? error.message : error),
    minPlayersToStart: 2,
    maxPlayersPerInstance: 2,
    isEventWindowOpen: () => true,
    // Negative threshold => any elapsed time counts as "long enough", so the test never races.
    abandonedEntryReleaseMs: -1,
  });

  const abandoned = await abandonedSystem.requestJoinLandfillRace();
  assert.equal(abandoned.ok, true);
  const abandonedWorld = String(abandoned.world_name);

  // Two players pass the guard and get recorded, then both joins die before either player ever
  // becomes visible to getWorldPopulationCount -- the instance is now "full" of nobody.
  abandonedSystem.recordLandfillInstanceJoin(abandonedWorld, "ghost_a");
  abandonedSystem.recordLandfillInstanceJoin(abandonedWorld, "ghost_b");
  assert.equal(
    abandonedSystem.canPlayerJoinLandfillInstance(abandonedWorld, "real_player").reason,
    "instance_full",
    "precondition: two recorded-but-absent players should saturate a maxPlayersPerInstance=2 instance",
  );

  // The poll must notice the instance is provably empty and release the stale slots.
  abandonedSystem.pollInstancesOnce();
  assert.equal(
    abandonedSystem.canPlayerJoinLandfillInstance(abandonedWorld, "real_player").ok,
    true,
    "an 'entry' instance with zero players present must release abandoned slots rather than stay full forever",
  );

  // ...but it must NOT release slots while players are actually present, or it would hand out
  // capacity an occupied instance does not have.
  abandonedSystem.recordLandfillInstanceJoin(abandonedWorld, "present_a");
  abandonedPopulation[abandonedWorld] = 1;
  abandonedSystem.pollInstancesOnce();
  const stillTracked = abandonedSystem
    .listInstances()
    .find((/** @type {any} */ instance) => instance.worldName === abandonedWorld);
  assert.ok(stillTracked, "the instance should still exist while occupied");
  assert.equal(
    stillTracked.participantUsernames.has("present_a"),
    true,
    "a participant must never be released while the world still reports population",
  );

  console.log("[check_server_landfill_event_build] all assertions passed.");
}

main().catch((error) => {
  console.error("[check_server_landfill_event_build] FAILED:", error);
  process.exitCode = 1;
});
