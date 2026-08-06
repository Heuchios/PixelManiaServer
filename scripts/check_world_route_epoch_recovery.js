#!/usr/bin/env node
// @ts-check
"use strict";

// World ownership is fenced by an epoch that lives in TWO stores with different lifetimes:
//
//   Redis    pixelmania:world_route_epoch:<world>   mints epochs, CAN be lost (TTL, flush,
//                                                   replica failover)
//   Postgres worlds.world_owner_epoch               high-water mark, never cleared
//
// `claimWorldPersistenceOwnership` only accepts an epoch strictly greater than the Postgres
// value. So when the Redis counter is lost it restarts near 1, every claim is refused as
// stale, and the world becomes PERMANENTLY unjoinable -- players hang on the loading screen
// with no error at all. This happened in production on 2026-08-05: TEST sat at epoch 322 in
// Postgres while Redis handed out 3, and the world could never be entered again.
//
// The recovery is to re-mint the route once with the Postgres mark as a FLOOR. Raising the
// counter only ever moves the fence forward, so fencing is not weakened. This gate pins the
// pieces of that path, and pins that the pre-fix shape fails.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RedisStore = require("../redis_store");
const PostgresStore = require("../postgres_store");

const repoRoot = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(repoRoot, "src", "server.ts"), "utf8");

/** @returns {{ commands: string[][], store: any }} */
function createRouteStore() {
  /** @type {string[][]} */
  const commands = [];
  const store = /** @type {any} */ (new RedisStore({
    enabled: true,
    keyPrefix: "Pixel Test",
    logger: () => {},
  }));
  store.client = {
    isOpen: true,
    connect: async () => undefined,
    quit: async () => undefined,
    on: () => undefined,
    /** @param {string[]} command */
    sendCommand: async (command) => {
      commands.push(command);
      if (command[0] !== "EVAL") throw new Error(`Unexpected Redis command: ${command[0]}`);
      if (command[2] === "4") return [1, "instance-1", "wss://example.test/ws", "process-a:7", 7];
      if (command[2] === "3") return 3;
      throw new Error(`Unexpected Redis EVAL key count: ${command[2]}`);
    },
  };
  store.ready = true;
  return { commands, store };
}

async function main() {
  // ---- 1. the floor reaches the script, and the pinned argv layout is untouched ----
  const { commands, store } = createRouteStore();
  await store.claimWorldRoute("START", "instance-1", "wss://example.test/ws", 45000, "process-a");
  assert.equal(commands[0][2], "4", "key count must stay 4");
  assert.equal(commands[0][10], "process-a", "claimant id must stay at argv index 10");
  assert.equal(commands[0][12], "0", "absent floor defaults to 0");

  await store.claimWorldRoute("START", "instance-1", "wss://example.test/ws", 45000, "process-a", 322);
  assert.equal(commands[1][12], "322", "the Postgres high-water mark is passed as the floor");
  assert.equal(commands[1][10], "process-a", "adding the floor must not shift existing arguments");

  // ---- 2. the script raises the counter BEFORE minting, and never destroys it ----
  const script = commands[0][1];
  const floorIndex = script.indexOf("if stored_epoch < min_epoch then");
  const firstIncrIndex = script.indexOf("redis.call('INCR', epoch_key)");
  assert.ok(floorIndex >= 0, "script must read the floor");
  assert.ok(firstIncrIndex >= 0, "script must still mint by INCR");
  assert.ok(floorIndex < firstIncrIndex, "the floor must be applied before any epoch is minted");
  assert.ok(
    script.includes("redis.call('SET', epoch_key, tostring(min_epoch))"),
    "the floor must be written to the epoch key"
  );
  // Second recovery source: if the key is lost while the world is STILL OWNED (a flush or
  // failover rather than TTL expiry), the live token already ends in the epoch it was minted
  // with, so the counter can be restored exactly. Without this the periodic lease renewal
  // reads the missing key as 0, the server calls that a missing fence, and it drops a route
  // it legitimately holds -- observed live on 2026-08-06 as
  // "presence refresh could not renew local world route".
  const tokenRestoreIndex = script.indexOf("string.match(current_token, ':(%d+)$')");
  assert.ok(tokenRestoreIndex >= 0, "the epoch must be recoverable from the live token");
  assert.ok(
    script.indexOf("local current_token = redis.call") < tokenRestoreIndex,
    "the token must be read before it is parsed"
  );
  assert.ok(tokenRestoreIndex < floorIndex, "the token floor must be folded in before the write");
  assert.equal(
    "pixelmania-a:820032:58e4a728-cf23-4b17-a444-a39d9199e7f0:334".match(/:(\d+)$/)?.[1],
    "334",
    "sanity: a real production token ends in its epoch"
  );

  // The epoch is the fencing token. Deleting it is what creates the unjoinable world.
  assert.doesNotMatch(script, /DEL[^\n]*epoch_key/, "the epoch key must never be deleted");
  assert.match(script, /PEXPIRE/, "the lease keys must still expire");

  // ---- 3. Postgres exposes the high-water mark off the hot path ----
  const offlineStore = /** @type {any} */ (new PostgresStore({
    enabled: false,
    schema: "pixel_mania_test",
    logger: () => {},
  }));
  assert.equal(typeof offlineStore.getWorldOwnerEpoch, "function");
  assert.equal(await offlineStore.getWorldOwnerEpoch("TEST"), 0, "no Postgres means no floor");
  assert.equal(await offlineStore.getWorldOwnerEpoch(""), 0);

  const readStore = /** @type {any} */ (new PostgresStore({
    enabled: false,
    schema: "pixel_mania_test",
    logger: () => {},
  }));
  /** @type {string[]} */
  const reads = [];
  readStore.isReady = () => true;
  /** @param {string} label */
  readStore.queryReadWithRetry = async (label) => {
    reads.push(label);
    return { rows: [{ world_owner_epoch: "322" }], rowCount: 1 };
  };
  assert.equal(await readStore.getWorldOwnerEpoch("TEST"), 322, "the mark is read as a number");
  assert.equal(reads.length, 1, "one plain read, never a queued write");

  readStore.queryReadWithRetry = async () => ({ rows: [], rowCount: 0 });
  assert.equal(await readStore.getWorldOwnerEpoch("MISSING"), 0, "an unknown world has no floor");

  readStore.queryReadWithRetry = async () => { throw new Error("postgres down"); };
  assert.equal(await readStore.getWorldOwnerEpoch("TEST"), 0, "a failed read must not throw into the join");

  // ---- 4. the server retries the claim exactly once, with the mark as the floor ----
  const claimStart = serverSource.indexOf("async function claimWorldRouteForCurrentInstance");
  assert.ok(claimStart >= 0, "route claim entry point must exist");
  const claimBody = serverSource.slice(claimStart, serverSource.indexOf("\nasync function ", claimStart + 10));

  assert.match(claimBody, /claimed\?\.reason === "world_ownership_fence_rejected"/,
    "recovery must trigger only on the fence rejection");
  assert.match(claimBody, /const fenceEpoch = await postgresStore\.getWorldOwnerEpoch\(clean\)/,
    "the floor must come from Postgres, not from a guess");
  assert.match(claimBody, /SERVER_PROCESS_OWNERSHIP_ID,\s*fenceEpoch/,
    "the floor must be handed to the Redis claim");
  assert.match(claimBody, /reseededEpoch > fenceEpoch/,
    "the re-minted epoch must actually beat the mark before it is trusted");
  assert.equal(
    (claimBody.match(/claimed = await postgresStore\.claimWorldPersistenceOwnership/g) || []).length,
    2,
    "exactly one retry -- the initial claim plus one re-minted attempt, never a loop"
  );

  // ---- 5. the pre-fix shape must fail this gate ----
  // Strip the floor and the assertions above must break, or they are not guarding anything.
  const preFixScript = script
    .replace("if stored_epoch < min_epoch then", "if false then")
    .replace("redis.call('SET', epoch_key, tostring(min_epoch))", "");
  assert.ok(
    !preFixScript.includes("redis.call('SET', epoch_key, tostring(min_epoch))"),
    "sanity: the pre-fix script has no floor write"
  );
  const preFixServer = claimBody.replace(/const fenceEpoch = await postgresStore\.getWorldOwnerEpoch\(clean\)/, "");
  assert.doesNotMatch(preFixServer, /const fenceEpoch = await postgresStore\.getWorldOwnerEpoch\(clean\)/,
    "sanity: the pre-fix server has no Postgres floor lookup");

  console.log("[world-route-epoch-recovery] success");
}

main().catch((/** @type {unknown} */ error) => {
  console.error(error);
  process.exitCode = 1;
});
