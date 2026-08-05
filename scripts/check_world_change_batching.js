#!/usr/bin/env node
// @ts-check
"use strict";

// World-change audit rows and inventory snapshot rows used to be written one statement at a
// time, inside the transaction that already holds the exclusive lock on the `worlds` row. A
// single authoritative save can carry hundreds of changes, so that loop was the dominant
// remaining N+1 on the write path and it throttled every world mutation behind it.
//
// The batched writers must stay *observationally identical* to the per-change writers: same
// column values, same row order, same drop/item-instance side effects in the same sequence,
// all still inside one transaction. This gate pins that equivalence directly rather than
// pinning source text, because the failure mode we care about (a row silently losing a
// column, or drop side effects running out of order) is invisible to a regex.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PostgresStore = require("../postgres_store");

const repoRoot = path.join(__dirname, "..");
const postgresStoreSource = fs.readFileSync(path.join(repoRoot, "src", "postgres_store.ts"), "utf8");

const WORLD_BLOCK_CHANGE_COLUMN_COUNT = 13;

/** @returns {any} */
function createStore() {
  const store = /** @type {any} */ (new PostgresStore({
    enabled: false,
    schema: "pixel_mania_test",
    logger: () => {},
  }));
  // Identity resolution and the drop side effects are exercised elsewhere; stub them so this
  // gate measures only how the change rows themselves are written.
  /** @param {unknown} _client @param {unknown} username */
  store.ensurePlayerIdentity = async (_client, username) => (username ? `pid:${username}` : null);
  store.createTrackedWorldDropItemInstances = async () => ({ ok: true });
  store.upsertWorldDropRow = async () => ({ ok: true });
  return store;
}

/** @returns {{ statements: Array<{ sql: string, params: any[] }>, query: (sql: string, params: any[]) => Promise<any> }} */
function createRecordingClient() {
  /** @type {Array<{ sql: string, params: any[] }>} */
  const statements = [];
  return {
    statements,
    /** @param {string} sql @param {any[]} params */
    query: async (sql, params) => {
      statements.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  };
}

/** @param {number} index @returns {Record<string, unknown>} */
function buildBlockChange(index) {
  return {
    actor_username: "uso",
    action: index % 2 === 0 ? "break_block" : "place_block",
    layer: index % 3 === 0 ? "background" : "foreground",
    x: index,
    y: index * 2,
    block_type: `after_${index}`,
    old_block_type: `before_${index}`,
    source_type: "world_block_place",
    source_id: `source-${index}`,
    request_id: `request-${index}`,
    at: "",
    details: { hit_count: index },
  };
}

async function main() {
  // ---- 1. batched rows are byte-identical to the per-change writer ----
  const changes = [];
  for (let index = 0; index < 7; index += 1) changes.push(buildBlockChange(index));

  const referenceStore = createStore();
  const referenceClient = createRecordingClient();
  for (const change of changes) {
    await referenceStore.recordWorldChangeAndTrackedDrops(referenceClient, "world-1", change);
  }
  assert.equal(referenceClient.statements.length, 7, "per-change writer issues one statement per change");

  const batchedStore = createStore();
  const batchedClient = createRecordingClient();
  await batchedStore.recordWorldChangesAndTrackedDrops(batchedClient, "world-1", changes);
  assert.equal(batchedClient.statements.length, 1, "batched writer collapses the same changes into one statement");

  const batchedParams = batchedClient.statements[0].params;
  assert.equal(batchedParams.length, changes.length * WORLD_BLOCK_CHANGE_COLUMN_COUNT);
  for (let row = 0; row < changes.length; row += 1) {
    assert.deepEqual(
      batchedParams.slice(row * WORLD_BLOCK_CHANGE_COLUMN_COUNT, (row + 1) * WORLD_BLOCK_CHANGE_COLUMN_COUNT),
      referenceClient.statements[row].params,
      `batched row ${row} must carry exactly the columns the per-change writer wrote`
    );
  }

  // Placeholder arity has to track the parameter array or Postgres rejects the statement.
  const placeholders = [...batchedClient.statements[0].sql.matchAll(/\$(\d+)/g)]
    .map((/** @type {RegExpMatchArray} */ match) => Number(match[1]));
  assert.equal(Math.max(...placeholders), batchedParams.length, "highest placeholder equals the parameter count");

  // ---- 2. drop side effects still run per change, in the original order ----
  const orderedStore = createStore();
  const orderedClient = createRecordingClient();
  /** @type {string[]} */
  const upsertedDropIds = [];
  /** @param {unknown} _client @param {unknown} _worldId @param {any} drop */
  orderedStore.upsertWorldDropRow = async (_client, _worldId, drop) => {
    upsertedDropIds.push(drop.drop_id);
    return { ok: true };
  };
  await orderedStore.recordWorldChangesAndTrackedDrops(orderedClient, "world-1", [
    { actor_username: "uso", action: "break_drop", x: 1, y: 1, details: { drop_id: "drop-a", item_type: "dirt", amount: 1, x: 10, y: 10 } },
    { object_type: "machine", object_id: "machine-1", action: "update", actor_username: "uso", x: 3, y: 4, new_data: { on: true } },
    { actor_username: "uso", action: "break_drop", x: 2, y: 2, details: { drop_id: "drop-b", item_type: "stone", amount: 1, x: 20, y: 20 } },
  ]);
  assert.deepEqual(upsertedDropIds, ["drop-a", "drop-b"], "tracked drops must be replayed in the original change order");
  assert.equal(orderedClient.statements.length, 2, "block and object changes are grouped into one statement per target table");

  // ---- 3. a single change stays on the single-row path; an empty list writes nothing ----
  const singleStore = createStore();
  const singleClient = createRecordingClient();
  await singleStore.recordWorldChangesAndTrackedDrops(singleClient, "world-1", [changes[0]]);
  assert.equal(singleClient.statements.length, 1);
  assert.deepEqual(singleClient.statements[0].params, referenceClient.statements[0].params);

  const emptyStore = createStore();
  const emptyClient = createRecordingClient();
  await emptyStore.recordWorldChangesAndTrackedDrops(emptyClient, "world-1", []);
  assert.equal(emptyClient.statements.length, 0, "an empty change list must not issue a statement");

  // ---- 4. batches stay under the Postgres bind-parameter limit ----
  const manyChanges = [];
  for (let index = 0; index < 250; index += 1) manyChanges.push(buildBlockChange(index));
  const chunkStore = createStore();
  const chunkClient = createRecordingClient();
  await chunkStore.recordWorldChangesAndTrackedDrops(chunkClient, "world-1", manyChanges);
  assert.equal(chunkClient.statements.length, 3, "250 changes chunk into 3 statements at 100 rows each");
  for (const statement of chunkClient.statements) {
    assert.ok(statement.params.length <= 65535, "no statement may exceed the Postgres bind-parameter limit");
  }

  // ---- 5. inventory snapshot writes one row set, filtered exactly as before ----
  const inventoryStore = createStore();
  const inventoryClient = createRecordingClient();
  inventoryStore.updatePlayerInventoryHash = async () => {};
  await inventoryStore.replaceInventorySnapshot(inventoryClient, "player-1", {
    inventory: { dirt: 5, stone: 0, "": 3 },
    seed_inventory: { dirt_seed: 2 },
    tool_inventory: { wrench: 1 },
  });
  assert.equal(inventoryClient.statements.length, 2, "snapshot is one DELETE plus one batched INSERT");
  assert.match(inventoryClient.statements[0].sql, /DELETE FROM/);
  assert.match(inventoryClient.statements[1].sql, /UNNEST/);
  assert.deepEqual(
    inventoryClient.statements[1].params[1],
    ["dirt", "dirt_seed", "wrench"],
    "zero-amount and blank item types stay filtered out of the snapshot"
  );
  assert.deepEqual(inventoryClient.statements[1].params[2], ["block", "seed", "tool"]);
  assert.deepEqual(inventoryClient.statements[1].params[3], [5, 2, 1]);

  const emptyInventoryStore = createStore();
  const emptyInventoryClient = createRecordingClient();
  emptyInventoryStore.updatePlayerInventoryHash = async () => {};
  await emptyInventoryStore.replaceInventorySnapshot(emptyInventoryClient, "player-1", { inventory: {} });
  assert.equal(emptyInventoryClient.statements.length, 1, "an empty inventory issues only the DELETE");

  // ---- 6. every world-change call site must use the batched writer ----
  // Reintroducing `for (const change of ...) await this.recordWorldChangeAndTrackedDrops(...)`
  // silently restores the N+1, so pin the absence of that loop shape.
  assert.doesNotMatch(
    postgresStoreSource,
    /for \(const change of \[\.\.\.worldChanges[\s\S]{0,200}?await this\.recordWorldChangeAndTrackedDrops\(/,
    "world-change call sites must not loop the per-change writer"
  );
  assert.equal(
    (postgresStoreSource.match(/await this\.recordWorldChangesAndTrackedDrops\(client, /g) || []).length,
    4,
    "all four world-change call sites route through the batched writer"
  );

  console.log("[world-change-batching] success");
}

main().catch((/** @type {unknown} */ error) => {
  console.error(error);
  process.exitCode = 1;
});
