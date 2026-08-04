#!/usr/bin/env node
// @ts-check
"use strict";

/**
 * Drop / world-rollback isolation regression checks.
 *
 * The bug these lock down: a player breaks a block, the server creates the drop
 * in live world state and broadcasts it, and then some *other* in-flight request
 * finishes and restores a whole-world snapshot it captured before that drop
 * existed. The drop vanishes from authoritative state while the client is still
 * showing it, so the next pickup answers "That drop is not available." and the
 * item is lost for good once the next world save mirrors the missing drop away.
 *
 * Two independent guarantees are asserted here:
 *
 *   1. Behavioural - a world rollback restores its own mutations but carries
 *      across every drop another request created after the snapshot was taken.
 *      Only drops the rolling-back request itself created may be discarded.
 *
 *   2. Structural - the bulk drop pickup route is PostgreSQL-first: it must not
 *      speculatively mutate live world state before the transaction, must not
 *      hand the transaction a world snapshot captured before an await (that
 *      snapshot is what marked concurrently created drops 'removed' and what
 *      made the save fail with stale_world_revision), and must persist the world
 *      after the batch from state serialized at persist time.
 *
 * The block-break and electrical-break rollbacks are checked the same way: they
 * may only discard the drops they emitted themselves.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

let failures = 0;
let checks = 0;

/**
 * @param {string} name
 * @param {() => void} fn
 * @returns {void}
 */
function check(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAIL ${name}`);
    console.error(`       ${message}`);
  }
}

/**
 * @param {string} relativePath
 * @returns {string}
 */
function readRequired(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  assert.ok(fs.existsSync(filePath), `Missing artifact: ${relativePath} (run the matching npm run build:* script)`);
  return fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
}

/**
 * Slice a top-level `function name(...) { ... }` out of a source file by
 * balancing braces, so the real shipped implementation can be exercised.
 *
 * @param {string} source
 * @param {string} functionName
 * @returns {string}
 */
function extractFunctionSource(source, functionName) {
  const marker = `\nfunction ${functionName}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Could not find function ${functionName} in the built server entry`);
  const bodyStart = source.indexOf("{", start + marker.length);
  assert.ok(bodyStart > 0, `Could not find the body of ${functionName}`);

  let depth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  /** @type {string} */
  let quote = "";
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") { inBlockComment = false; index += 1; }
      continue;
    }
    if (quote !== "") {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") { inLineComment = true; index += 1; continue; }
    if (char === "/" && next === "*") { inBlockComment = true; index += 1; continue; }
    if (char === "\"" || char === "'" || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index + 1);
    }
  }
  throw new Error(`Unbalanced braces while extracting ${functionName}`);
}

/**
 * Body of `handleBulkDropPickup` only, so ordering assertions cannot be
 * satisfied by unrelated code elsewhere in the entry file.
 *
 * @param {string} source
 * @returns {string}
 */
function extractBulkDropPickupSource(source) {
  const marker = "async function handleBulkDropPickup(";
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "Could not find handleBulkDropPickup");
  const rest = source.slice(start);
  return extractFunctionSource(`\n${rest.replace(/^async /, "")}`, "handleBulkDropPickup");
}

/**
 * Load the shipped rollback helpers into a sandbox with the smallest possible
 * stubs, so the behaviour under test is the real implementation.
 *
 * @param {string} builtEntrySource
 */
function loadRollbackHelpers(builtEntrySource) {
  const helperSources = [
    "collectSerializedWorldDropIds",
    "collectForeignLiveWorldDrops",
    "restoreWorldStateSnapshot",
  ].map((name) => extractFunctionSource(builtEntrySource, name)).join("\n\n");

  const factory = new Function(
    "stubs",
    `
    "use strict";
    const { worldStates, deserializeWorldState, cleanWorld, clampString, recordDropRemovalTombstone, console } = stubs;
    const MAX_DROP_ID_LENGTH = 96;
    const MAX_ROLLBACK_PRESERVED_DROP_IDS_LOGGED = 8;
    ${helperSources}
    return { collectForeignLiveWorldDrops, restoreWorldStateSnapshot, collectSerializedWorldDropIds };
    `
  );

  /** @type {Map<string, any>} */
  const worldStates = new Map();
  /** @type {Array<{ world: string, drop_id: string, reason: string }>} */
  const tombstones = [];
  const api = factory({
    worldStates,
    /**
     * @param {string} worldName
     * @param {any} snapshot
     */
    deserializeWorldState: (worldName, snapshot) => ({
      world_name: worldName,
      drops: new Map((Array.isArray(snapshot?.drops) ? snapshot.drops : []).map((/** @type {any} */ drop) => [drop.drop_id, drop])),
    }),
    /** @param {any} value */
    cleanWorld: (value) => String(value || "START").trim().toUpperCase(),
    /** @param {any} value */
    clampString: (value) => String(value || "").slice(0, 96),
    /**
     * @param {any} worldName
     * @param {any} dropId
     * @param {any} reason
     */
    recordDropRemovalTombstone: (worldName, dropId, reason) => {
      tombstones.push({ world: String(worldName), drop_id: String(dropId || ""), reason: String(reason || "") });
    },
    console: { warn: () => {}, log: () => {} },
  });

  return { ...api, worldStates, tombstones };
}

/**
 * Load the duplicate-pickup classifier out of the built entry with stubbed
 * collaborators, so the real whitelist / world / collector / window rules are
 * what gets exercised.
 *
 * @param {string} builtEntrySource
 */
function loadDuplicatePickupHelpers(builtEntrySource) {
  const helperSource = extractFunctionSource(builtEntrySource, "wasDropJustCollectedByPlayer");

  /** @type {Map<string, any>} */
  const dropRemovalTombstones = new Map();
  const factory = new Function(
    "stubs",
    `
    "use strict";
    const { dropRemovalTombstones, cleanWorld, clampString, cleanAccountName } = stubs;
    const MAX_DROP_ID_LENGTH = 96;
    const DUPLICATE_DROP_PICKUP_GRACE_MS = 15000;
    const DROP_COLLECTED_TOMBSTONE_REASONS = new Set(["picked_up", "picked_up_legacy", "postgres_reported_collected"]);
    ${helperSource}
    return { wasDropJustCollectedByPlayer };
    `
  );
  const api = factory({
    dropRemovalTombstones,
    /** @param {any} value */
    cleanWorld: (value) => String(value || "START").trim().toUpperCase(),
    /** @param {any} value */
    clampString: (value) => String(value || "").slice(0, 96),
    /** @param {any} value */
    cleanAccountName: (value) => String(value || "").trim().toLowerCase(),
  });
  return { ...api, dropRemovalTombstones };
}

/**
 * @param {string} dropId
 * @param {string} itemType
 */
function makeDrop(dropId, itemType = "dirt") {
  return { drop_id: dropId, item_type: itemType, item_category: "block", amount: 1, x: 32, y: 32 };
}

function run() {
  console.log("Drop / world-rollback isolation checks");

  const entrySource = readRequired("src/server.ts");
  const builtEntry = readRequired("server.js");
  const worldActionRoutesSource = readRequired("src/server_phase8_world_action_routes.ts");

  /** @type {ReturnType<typeof loadRollbackHelpers> | null} */
  let helpers = null;
  check("the built server entry exposes the drop-preserving rollback helpers", () => {
    helpers = loadRollbackHelpers(builtEntry);
  });

  /**
   * @returns {ReturnType<typeof loadRollbackHelpers>}
   */
  function requireHelpers() {
    assert.ok(helpers, "rollback helpers are missing from the built server entry; rebuild with npm run build:server-entry");
    return /** @type {ReturnType<typeof loadRollbackHelpers>} */ (helpers);
  }

  /**
   * @param {string[]} snapshotDropIds
   * @param {string[]} liveDropIds
   * @param {string[]} discardDropIds
   */
  function runRollback(snapshotDropIds, liveDropIds, discardDropIds) {
    const { worldStates, tombstones, restoreWorldStateSnapshot } = requireHelpers();
    worldStates.clear();
    tombstones.length = 0;
    worldStates.set("START", {
      world_name: "START",
      drops: new Map(liveDropIds.map((dropId) => [dropId, makeDrop(dropId)])),
    });
    const snapshot = { drops: snapshotDropIds.map((dropId) => makeDrop(dropId)) };
    restoreWorldStateSnapshot("START", snapshot, discardDropIds);
    return Array.from(worldStates.get("START").drops.keys()).sort();
  }

  check("a rollback keeps a drop another request created after the snapshot", () => {
    // Snapshot was taken before the concurrent block break created DROP_NEW.
    const remaining = runRollback(["DROP_OLD"], ["DROP_OLD", "DROP_NEW"], []);
    assert.deepEqual(remaining, ["DROP_NEW", "DROP_OLD"], "a foreign break drop was destroyed by an unrelated rollback");
  });

  check("a rollback still discards the drops its own request created", () => {
    const remaining = runRollback(["DROP_OLD"], ["DROP_OLD", "DROP_MINE"], ["DROP_MINE"]);
    assert.deepEqual(remaining, ["DROP_OLD"], "the rolling-back request's own speculative drop survived");
  });

  check("a rollback discards its own drops while keeping concurrent ones", () => {
    const remaining = runRollback(["DROP_OLD"], ["DROP_OLD", "DROP_MINE", "DROP_NEW"], ["DROP_MINE"]);
    assert.deepEqual(remaining, ["DROP_NEW", "DROP_OLD"], "foreign and own drops were not separated");
  });

  check("own-drop ids may be passed as the emitted drop payloads themselves", () => {
    const { worldStates, tombstones, restoreWorldStateSnapshot } = requireHelpers();
    worldStates.clear();
    tombstones.length = 0;
    worldStates.set("START", {
      world_name: "START",
      drops: new Map([["DROP_OLD", makeDrop("DROP_OLD")], ["DROP_MINE", makeDrop("DROP_MINE")]]),
    });
    restoreWorldStateSnapshot("START", { drops: [makeDrop("DROP_OLD")] }, [makeDrop("DROP_MINE")]);
    assert.deepEqual(
      Array.from(worldStates.get("START").drops.keys()).sort(),
      ["DROP_OLD"],
      "emitted drop payloads were not recognised as the caller's own drops"
    );
  });

  check("every drop a rollback does discard leaves a removal tombstone", () => {
    runRollback(["DROP_OLD"], ["DROP_OLD", "DROP_MINE"], ["DROP_MINE"]);
    const { tombstones } = requireHelpers();
    const discarded = tombstones.filter((/** @type {any} */ entry) => entry.drop_id === "DROP_MINE");
    assert.equal(discarded.length, 1, "a discarded drop must be recorded so a later miss can be explained");
    assert.equal(discarded[0].reason, "world_rollback_discarded");
  });

  check("preserved drops are not tombstoned", () => {
    runRollback(["DROP_OLD"], ["DROP_OLD", "DROP_NEW"], []);
    assert.equal(
      requireHelpers().tombstones.filter((/** @type {any} */ entry) => entry.drop_id === "DROP_NEW").length,
      0,
      "a preserved drop must not be reported as removed"
    );
  });

  /** @type {ReturnType<typeof loadDuplicatePickupHelpers> | null} */
  let duplicateHelpers = null;
  check("the built server entry exposes the duplicate-pickup classifier", () => {
    duplicateHelpers = loadDuplicatePickupHelpers(builtEntry);
  });

  /**
   * @param {{ reason?: string, world?: string, collector?: string, ageMs?: number }} tombstone
   * @param {{ world?: string, username?: string }} request
   */
  function classifyDuplicate(tombstone, request = {}) {
    assert.ok(duplicateHelpers, "duplicate-pickup classifier missing from the built server entry");
    const helpers = /** @type {ReturnType<typeof loadDuplicatePickupHelpers>} */ (duplicateHelpers);
    helpers.dropRemovalTombstones.clear();
    helpers.dropRemovalTombstones.set("DROP_A", {
      world: tombstone.world === undefined ? "START" : tombstone.world,
      reason: tombstone.reason === undefined ? "picked_up" : tombstone.reason,
      at_ms: Date.now() - (tombstone.ageMs === undefined ? 25 : tombstone.ageMs),
      collector: tombstone.collector === undefined ? "uso" : tombstone.collector,
      created_at_ms: 0,
    });
    return helpers.wasDropJustCollectedByPlayer(
      request.world === undefined ? "START" : request.world,
      "DROP_A",
      { account_username: request.username === undefined ? "uso" : request.username }
    );
  }

  check("a repeat request for a drop this player just collected is a duplicate", () => {
    assert.equal(classifyDuplicate({}), true);
  });

  check("another player's repeat request is not treated as their duplicate", () => {
    assert.equal(classifyDuplicate({}, { username: "someone_else" }), false, "would hide a genuine lost race");
  });

  check("a duplicate is scoped to the world the drop was collected in", () => {
    assert.equal(classifyDuplicate({ world: "OTHER" }), false);
  });

  check("only removal reasons that prove collection count as a duplicate", () => {
    assert.equal(classifyDuplicate({ reason: "picked_up_legacy" }), true);
    assert.equal(classifyDuplicate({ reason: "postgres_reported_collected" }), true);
    for (const reason of ["world_rollback_discarded", "drop_update_emptied", "empty_drop", "unknown"]) {
      assert.equal(classifyDuplicate({ reason }), false, `${reason} does not prove the item was granted`);
    }
  });

  check("a stale collection is no longer treated as a duplicate", () => {
    assert.equal(classifyDuplicate({ ageMs: 60000 }), false);
  });

  check("an unknown drop id is never a duplicate", () => {
    assert.ok(duplicateHelpers, "classifier missing");
    const helpers = /** @type {ReturnType<typeof loadDuplicatePickupHelpers>} */ (duplicateHelpers);
    helpers.dropRemovalTombstones.clear();
    assert.equal(helpers.wasDropJustCollectedByPlayer("START", "NOPE", { account_username: "uso" }), false);
  });

  check("a duplicate pickup is acknowledged, never rejected, on both routes", () => {
    const finalRoutes = readRequired("src/server_phase8_final_routes.ts");
    for (const [label, source] of [["bulk", entrySource], ["single", finalRoutes]]) {
      assert.ok(
        source.includes("wasDropJustCollectedByPlayer(") && source.includes("acknowledgeDropAlreadyCollected("),
        `${label} pickup route must answer a self-duplicate with an acknowledgement`
      );
    }
  });

  check("the duplicate acknowledgement grants nothing and stays private", () => {
    const ack = extractFunctionSource(entrySource, "acknowledgeDropAlreadyCollected");
    assert.ok(ack.includes("sendJson(socket"), "the acknowledgement must go only to the requester");
    assert.ok(!ack.includes("queueWorldUpdateBroadcast"), "a duplicate must not be broadcast to the world");
    assert.ok(!/addItemToState|persistPlayerInventoryChange|inventory_delta/.test(ack), "a duplicate must never grant an item");
  });

  check("the client never batches a pickup it already has in flight", () => {
    const dropManager = readRequired("../pixel-mania/Scripts/drop_manager.gd");
    const start = dropManager.indexOf("func send_network_drop_pickup_bulk(");
    assert.ok(start >= 0, "send_network_drop_pickup_bulk is missing");
    const bulkSender = dropManager.slice(start, dropManager.indexOf("\nfunc ", start + 10));
    assert.ok(bulkSender.includes("pickup_request_sent"), "bulk sender must honour the in-flight guard");
    assert.ok(bulkSender.includes("was_drop_id_recently_removed"), "bulk sender must skip drops already confirmed gone");
    assert.ok(bulkSender.includes("batched_drop_ids"), "bulk sender must not send the same drop id twice in one batch");
  });

  const bulkSource = extractBulkDropPickupSource(entrySource);

  check("bulk drop pickup never rolls back the whole world", () => {
    assert.ok(
      !bulkSource.includes("captureWorldMutationRollback") && !bulkSource.includes("restoreWorldMutationRollback"),
      "handleBulkDropPickup still uses a world-wide snapshot rollback, which destroys concurrent break drops"
    );
  });

  check("bulk drop pickup does not hand the transaction a pre-await world snapshot", () => {
    assert.ok(
      !/world_state\s*:/.test(bulkSource),
      "handleBulkDropPickup passes world_state into applyDropPickupTransaction; that stale snapshot mirrors concurrent drops away as 'removed'"
    );
    assert.ok(
      !/serializeWorldState\s*\(/.test(bulkSource),
      "handleBulkDropPickup serializes the world before awaiting PostgreSQL"
    );
  });

  check("bulk drop pickup applies world state only after PostgreSQL commits", () => {
    const transactionIndex = bulkSource.indexOf("applyDropPickupTransaction");
    const worldApplyIndex = bulkSource.indexOf("applyDropPickupWorldState");
    assert.ok(transactionIndex >= 0, "handleBulkDropPickup no longer calls applyDropPickupTransaction");
    assert.ok(worldApplyIndex >= 0, "handleBulkDropPickup no longer applies the pickup to world state");
    assert.ok(
      worldApplyIndex > transactionIndex,
      "handleBulkDropPickup mutates live world state before the PostgreSQL transaction"
    );
  });

  check("bulk drop pickup persists the world after the batch", () => {
    assert.ok(
      bulkSource.includes("persistAuthoritativeWorldState("),
      "handleBulkDropPickup must persist the live world after the batch, from state serialized at persist time"
    );
  });

  check("only a proven collected drop is removed on a bulk pickup failure", () => {
    assert.ok(
      bulkSource.includes("isPostgresDropPickupCollectedFailure"),
      "bulk pickup failures must only delete a drop PostgreSQL proved was collected"
    );
    assert.ok(
      !bulkSource.includes("isPostgresDropPickupUnavailableFailure"),
      "isPostgresDropPickupUnavailableFailure also matches drop_changed / removed rows and would destroy a live item"
    );
  });

  check("block-break rollback only discards the drops that break emitted", () => {
    const blockUpdateRollbacks = worldActionRoutesSource.match(/restoreWorldStateSnapshot\(worldName, previousWorldState, emittedDrops\)/g) || [];
    assert.ok(
      blockUpdateRollbacks.length >= 4,
      `expected the block-break and electrical-break rollbacks to preserve foreign drops, found ${blockUpdateRollbacks.length}`
    );
  });

  check("no drop-emitting handler restores a raw world snapshot", () => {
    const rawRestores = worldActionRoutesSource.match(/worldStates\.set\(cleanWorld\(worldName\), deserializeWorldState\(worldName, previousWorldState\)\)/g) || [];
    const emittingHandlers = (worldActionRoutesSource.match(/const emittedDrops\b/g) || []).length;
    assert.ok(emittingHandlers >= 2, "expected the block-update and electrical handlers to emit drops");
    assert.ok(
      rawRestores.length <= 3,
      `drop-emitting handlers still restore a raw world snapshot in ${rawRestores.length} places`
    );
  });

  check("a missing drop is logged with a cause, not just a count", () => {
    const missingLogIndex = entrySource.indexOf("[drop_pickup_missing]");
    assert.ok(missingLogIndex >= 0, "the drop_pickup_missing diagnostic disappeared");
    const missingLog = entrySource.slice(missingLogIndex, missingLogIndex + 1400);
    for (const field of ["removal_reason", "removed_ms_ago", "age_at_request_ms", "server_instance"]) {
      assert.ok(missingLog.includes(field), `drop_pickup_missing must report ${field}`);
    }
  });

  console.log("");
  if (failures > 0) {
    console.error(`${failures} of ${checks} drop rollback isolation checks failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`All ${checks} drop rollback isolation checks passed.`);
}

run();
