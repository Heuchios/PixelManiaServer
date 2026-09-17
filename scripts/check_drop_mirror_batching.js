"use strict";
const assert = require("node:assert/strict");
const Store = require("../postgres_store");

async function main() {
  const store = new Store({ enabled: false });
  const world = "00000000-0000-4000-8000-000000000001";
  const drops = Array.from({ length: 1001 }, (_, i) => ({
    drop_id: `batch-${i}`, item_type: "dirt", item_category: "block",
    amount: i % 7 + 1, x: i, y: 64, metadata: { origin_source: "world_block_break" },
  }));
  const single = [];
  for (const drop of drops) await store.upsertWorldDropRow({ query: async (sql, values) => {
    single.push(values);
    return { rows: [], rowCount: 1 };
  } }, world, drop, { source: "world_state_mirror", action: "mirror", mirrored_from_world_state: true });
  const calls = [];
  const client = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [], rowCount: 1 }; } };
  await store.mirrorWorldDropsState(client, world, { drops });
  assert.equal(calls.length, 6, "1001 drops use five batches and one removal query");
  const rows = calls.slice(0, -1).flatMap(c => {
    const rows = [];
    for (let i = 0; i < c.values.length; i += 11) rows.push(c.values.slice(i, i + 11));
    assert.match(c.sql, /metadata = .*\.metadata \|\| EXCLUDED.metadata/);
    return rows;
  });
  assert.deepEqual(rows, single, "Batch values preserve single-row normalization and provenance");
  calls.length = 0;
  await store.mirrorWorldDropsState(client, world, { drops: [drops[0], {...drops[0], amount: 99}, drops[1]] });
  assert.equal(calls.length, 3, "Duplicate IDs flush before their next occurrence");
  assert.equal(calls[1].values[4], 99);
  calls.length = 0;
  await store.mirrorWorldDropsState(client, world, {});
  assert.equal(calls.length, 0, "Absent drop data must not clear drops");
  await store.mirrorWorldDropsState(client, world, { drops: [] });
  assert.equal(calls.length, 1, "Explicit empty snapshot clears active drops");
  await assert.rejects(store.mirrorWorldDropsState({query: async()=>{throw Error("rollback required");}}, world, {drops}), /rollback required/);
  await store.reconcileItemInstancesForInventory({query:()=>{throw Error("Unnecessary instance lock");}}, "player", {}, {allow_create_missing:false,allow_retire_extra:false});
  store.isReady = () => true;
  store.logWorldPersistence = () => {};
  const scopes = [];
  store.withTransaction = async (work, label, scope) => { scopes.push(scope); return {ok:true}; };
  await store.saveWorldStateWithWorldChanges("PERF_A", {world_revision:1}, []);
  await store.saveWorldSnapshot("PERF_A", {});
  assert.deepEqual(scopes, ["world:perf_a", "world:perf_a"]);
  const queued = new Store({enabled:false});
  queued.isReady = () => true;
  let release;
  const gate = new Promise(resolve=>{release=resolve;});
  const order = [];
  const first = queued.enqueueWrite("first", async()=>{order.push("first");await gate;}, scopes[0]);
  const second = queued.enqueueWrite("second", async()=>{order.push("second");}, scopes[1]);
  await queued.enqueueWrite("unrelated", async()=>{order.push("unrelated");}, "world:perf_b");
  assert.deepEqual(order, ["first", "unrelated"], "Other worlds progress while same-world writes stay ordered");
  release();await Promise.all([first,second]);
  assert.deepEqual(order, ["first", "unrelated", "second"]);
  console.log("DROP_MIRROR_BATCHING_OK: 1002 queries reduced to 6; values, duplicates, failures and no-op reconciliation verified");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
