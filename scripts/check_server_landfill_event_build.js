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
  const FIRST_WORLD = String(first.world_name);
  // Names are minted randomly per session now (see mintSessionWorldName): terrain is a pure
  // function of the world name, so a reused name means a reused map. Assert the SHAPE and the
  // round-trip property rather than a fixed literal.
  assert.match(FIRST_WORLD, /^LANDFILL_\d+$/, "instance names must be canonical LANDFILL_<n>");

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
  const roundTripped = simulateCleanWorld(FIRST_WORLD);
  assert.equal(
    system.canPlayerJoinLandfillInstance(roundTripped, "round_tripper").ok,
    true,
    "a world name handed out by requestJoinLandfillRace must survive cleanWorld() and still be joinable",
  );

  // The registry must be case-insensitive at the boundary, so no future caller can reintroduce
  // the mismatch by normalizing differently on its way in.
  for (const variant of [FIRST_WORLD.toLowerCase(), ` ${FIRST_WORLD} `]) {
    assert.equal(
      system.canPlayerJoinLandfillInstance(variant, "case_prober").ok,
      true,
      `instance lookup must be canonical, but "${variant}" did not resolve`,
    );
  }

  // While that instance still has room, more joiners go to the same instance.
  populationByWorld[FIRST_WORLD] = 3;
  const second = await system.requestJoinLandfillRace();
  assert.equal(second.world_name, FIRST_WORLD);

  // Once an instance is full (>= maxPlayersPerInstance), new joiners are routed elsewhere -- and
  // critically to a DIFFERENT world name, because terrain is a pure function of the name.
  populationByWorld[FIRST_WORLD] = 5;
  const third = await system.requestJoinLandfillRace();
  const SECOND_WORLD = String(third.world_name);
  assert.notEqual(SECOND_WORLD, FIRST_WORLD, "a full instance should overflow joiners to a NEW world");
  assert.match(SECOND_WORLD, /^LANDFILL_\d+$/);

  // --- Progress is session-scoped and only counts while RACING ---------------------------------
  // Progress no longer touches the database at all (it used to open a transaction per block
  // break). It accrues in memory on the session and is persisted once at completion.
  const seasonKey = system.getCurrentSeasonKey();
  const firstSession = system.listInstances().find((/** @type {any} */ i) => i.worldName === FIRST_WORLD);
  assert.ok(firstSession, "the first session should be discoverable via listInstances()");

  // Before GO nothing scores, even for a real participant breaking a real trash block.
  firstSession.participants.set("alice", {
    username: "alice", displayName: "alice", kilograms: 0, joinOrder: 1,
    lastProgressAtMs: Date.now(), connected: true,
  });
  assert.equal(firstSession.state, "waiting_for_players");
  await system.awardKilogramsForBlockBreak(FIRST_WORLD, "alice", "banana_peel");
  assert.equal(firstSession.participants.get("alice").kilograms, 0, "progress must not count before the race starts");

  // Once racing, only registered trash in a Landfill world scores.
  firstSession.state = "racing";
  await system.awardKilogramsForBlockBreak(FIRST_WORLD, "alice", "banana_peel");
  await system.awardKilogramsForBlockBreak(FIRST_WORLD, "alice", "not_a_trash_block");
  await system.awardKilogramsForBlockBreak("START", "alice", "banana_peel");
  assert.equal(firstSession.participants.get("alice").kilograms, 3, "only the Landfill-world, registered-trash-block break should have scored");

  // And nothing reached the database on the hot path.
  assert.equal(postgresStore.scores.get(`alice:${seasonKey}`), undefined, "live progress must never write to Postgres");

  // After the finish, a late break must not alter a ranked result.
  firstSession.state = "finishing";
  await system.awardKilogramsForBlockBreak(FIRST_WORLD, "alice", "banana_peel");
  assert.equal(firstSession.participants.get("alice").kilograms, 3, "progress must not count after the race ends");
  firstSession.state = "racing";

  // --- join_world-layer eligibility guard -----------------------------------------------------

  // A no-op for any world that isn't a Landfill instance -- must never block a normal join.
  assert.equal(system.canPlayerJoinLandfillInstance("START", "bob").ok, true);

  // A world name nobody ever routed a player to fails closed.
  const unknown = system.canPlayerJoinLandfillInstance("LANDFILL_999999", "bob");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "instance_not_found");

  // Fill the second instance to maxPlayersPerInstance via the same check-then-record sequence
  // handleJoinWorld performs; the 6th distinct player must be refused.
  for (let i = 1; i <= 5; i += 1) {
    const username = `p${i}`;
    const check = system.canPlayerJoinLandfillInstance(SECOND_WORLD, username);
    assert.equal(check.ok, true, `p${i} should be admitted (slot ${i} of 5)`);
    system.recordLandfillInstanceJoin(SECOND_WORLD, username);
  }
  const overflowJoiner = system.canPlayerJoinLandfillInstance(SECOND_WORLD, "p6");
  assert.equal(overflowJoiner.ok, false);
  assert.equal(overflowJoiner.reason, "instance_full");

  // Late-entry lock: once RACING, a brand-new player is refused, but an already-recorded
  // participant may still rejoin their own session (reconnect).
  const secondSession = system.listInstances().find((/** @type {any} */ i) => i.worldName === SECOND_WORLD);
  assert.ok(secondSession, "the second session should be discoverable via listInstances()");
  secondSession.state = "racing";
  const lateStranger = system.canPlayerJoinLandfillInstance(SECOND_WORLD, "p7");
  assert.equal(lateStranger.ok, false);
  assert.equal(lateStranger.reason, "instance_locked");
  const reconnectingParticipant = system.canPlayerJoinLandfillInstance(SECOND_WORLD, "p1");
  assert.equal(reconnectingParticipant.ok, true, "an already-recorded participant must be able to rejoin their own locked instance");

  // The entry pen is released exactly at GO and never re-arms.
  assert.equal(system.getLandfillEntryPenBounds(SECOND_WORLD), null, "the entry pen must be off once RACING");

  // One live session per player: pressing Join Race again must return the session they are
  // already in, never enrol them in a second one (which would persist two results for one race).
  const duplicateJoin = await system.requestJoinLandfillRace("p1");
  assert.equal(duplicateJoin.world_name, SECOND_WORLD, "a player already in a session must be returned to it");

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


  // --- Full session lifecycle: countdown -> cancel -> restart -> race -> results ---------------
  // Drives the real state machine through pollInstancesOnce with an injected roster, which is the
  // same path production runs on a 250ms timer. Nothing here pokes state directly.
  /** @type {Array<{username: string, displayName: string}>} */
  let roster = [];
  /** @type {Array<Record<string, any>>} */
  const broadcasts = [];
  /** @type {Array<Record<string, any>>} */
  const persisted = [];
  const lifecycleSystem = LandfillEventModule.createLandfillEventSystem({
    /** @param {any} value */
    cleanAccountName: (value) => String(value || "").trim().toLowerCase(),
    ensureWritablePlayerState: () => null,
    canAddItemToState: () => true,
    addItemToState: () => true,
    /** @param {any} value */
    cloneJson: (value) => JSON.parse(JSON.stringify(value)),
    commitPlayerInventoryState: async () => ({ ok: true }),
    postgresStore: {
      /** @param {Record<string, any>} entry */
      async recordLandfillRaceResult(entry) {
        // Mirrors the real UNIQUE(session_id, player_id) guarantee: a repeat is a no-op.
        const key = `${entry.sessionId}:${entry.username}`;
        if (persisted.some((row) => `${row.sessionId}:${row.username}` === key)) {
          return { ok: true, recorded: false, duplicate: true, awarded_kilograms: 0 };
        }
        persisted.push(entry);
        return { ok: true, recorded: true, duplicate: false, awarded_kilograms: entry.awardedKilograms };
      },
    },
    getWorldPopulationCount: () => roster.length,
    /** @param {string} _worldName */
    getWorldPlayerIdentities: (_worldName) => roster,
    /** @param {string} _worldName @param {Record<string, any>} payload */
    broadcastToWorld: (_worldName, payload) => { broadcasts.push(payload); },
    sendJson: () => {},
    makeRequestId: () => "req_test",
    /** @param {any} error */
    getErrorMessage: (error) => String(error && error.message ? error.message : error),
    minPlayersToStart: 2,
    maxPlayersPerInstance: 5,
    isEventWindowOpen: () => true,
    countdownMs: 0,
    raceDurationMs: 0,
    resultsDisplayMs: 0,
    broadcastMinIntervalMs: -1,
    placementBonusKilograms: [100, 75, 50],
    participationBonusKilograms: 20,
    resetLandfillWorldState: async () => {},
  });

  const lifecycleJoin = await lifecycleSystem.requestJoinLandfillRace("haris");
  const LIFECYCLE_WORLD = String(lifecycleJoin.world_name);
  const lifecycleSession = lifecycleSystem.listInstances()[0];

  // One player: stays waiting, no countdown.
  roster = [{ username: "haris", displayName: "Haris" }];
  lifecycleSystem.pollInstancesOnce();
  assert.equal(lifecycleSession.state, "waiting_for_players", "one player must not start a countdown");

  // Second player arrives -> countdown.
  roster = [{ username: "haris", displayName: "Haris" }, { username: "playertwo", displayName: "PlayerTwo" }];
  lifecycleSystem.pollInstancesOnce();
  assert.equal(lifecycleSession.state, "countdown", "reaching the minimum must start the countdown");

  // One leaves mid-countdown -> cancel back to waiting (must NOT start a one-player race).
  roster = [{ username: "haris", displayName: "Haris" }];
  lifecycleSystem.pollInstancesOnce();
  assert.equal(lifecycleSession.state, "waiting_for_players", "dropping below the minimum must cancel the countdown");
  assert.equal(lifecycleSession.countdownEndsAtMs, 0, "a cancelled countdown must clear its deadline, not resume a stale one");

  // They come back -> countdown restarts, then (countdownMs=0) the race begins.
  roster = [{ username: "haris", displayName: "Haris" }, { username: "playertwo", displayName: "PlayerTwo" }];
  lifecycleSystem.pollInstancesOnce();
  assert.equal(lifecycleSession.state, "countdown");
  lifecycleSystem.pollInstancesOnce();
  assert.equal(lifecycleSession.state, "racing", "the countdown must hand off to the race");

  // Score during the race, then let the clock expire (raceDurationMs=0).
  lifecycleSystem.registerTrashBlockWeight("banana_peel", 3);
  await lifecycleSystem.awardKilogramsForBlockBreak(LIFECYCLE_WORLD, "haris", "banana_peel");
  await lifecycleSystem.awardKilogramsForBlockBreak(LIFECYCLE_WORLD, "haris", "banana_peel");
  await lifecycleSystem.awardKilogramsForBlockBreak(LIFECYCLE_WORLD, "playertwo", "banana_peel");
  lifecycleSystem.pollInstancesOnce();
  assert.equal(lifecycleSession.state, "finishing", "an expired race clock must end the race");
  assert.equal(lifecycleSession.finalRankings[0].username, "haris", "the higher score must rank first");
  assert.equal(lifecycleSession.finalRankings[0].kilograms, 6);
  assert.equal(lifecycleSession.finalRankings[1].username, "playertwo");

  // Let the async persist settle, then confirm exactly-once crediting.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(persisted.length, 2, "every participant must get exactly one result row");
  // Throwing rather than assert.ok() so the lookup narrows for `// @ts-check` without depending on
  // assert's `asserts` overload being visible.
  const awardedFor = (/** @type {string} */ name) => {
    const row = persisted.find((entry) => entry.username === name);
    if (!row) throw new Error(`expected exactly one persisted result row for ${name}`);
    return Number(row.awardedKilograms);
  };
  assert.equal(awardedFor("haris"), 6 + 100, "awarded KG = collected + placement bonus");
  assert.equal(awardedFor("playertwo"), 3 + 75);

  // Re-running the completion handler must NOT double-award.
  lifecycleSession.resultsPersisted = false;
  lifecycleSession.resultsPersistInFlight = false;
  lifecycleSession.state = "finishing";
  lifecycleSystem.pollInstancesOnce();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(persisted.length, 2, "a repeated completion must not create a second result row");

  // Finished -> cleanup -> the session and its world are retired.
  lifecycleSystem.pollInstancesOnce();
  lifecycleSystem.pollInstancesOnce();
  assert.equal(
    lifecycleSystem.listInstances().some((/** @type {any} */ i) => i.worldName === LIFECYCLE_WORLD),
    false,
    "a completed session must be destroyed, never reused as the next race's world",
  );

  // A brand-new race must get a brand-new world name (terrain is a pure function of the name).
  const nextJoin = await lifecycleSystem.requestJoinLandfillRace("haris");
  assert.notEqual(String(nextJoin.world_name), LIFECYCLE_WORLD, "the next race must not reuse the finished world");

  assert.ok(broadcasts.some((p) => p.type === "landfill_race_state"), "race state must be broadcast");
  assert.ok(broadcasts.some((p) => p.type === "landfill_race_results"), "results must be broadcast");

  console.log("[check_server_landfill_event_build] all assertions passed.");
}

main().catch((error) => {
  console.error("[check_server_landfill_event_build] FAILED:", error);
  process.exitCode = 1;
});
