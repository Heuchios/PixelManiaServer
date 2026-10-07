"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
const start = source.indexOf("async function removeWorldLockKeysFromPlayerInventory(");
const end = source.indexOf("\n}", start) + 2;
assert.ok(start > 0 && end > start);
async function run(keys, remotes, fail = false, silent = false) {
  let state = { world_lock_key: keys, magnet_machine_remote: remotes, dirt: 17 };
  let cleared = 0;
  const replies = [], ledgers = [];
  const player = { account_username: "owner", selected_hand_item: "dirt", selected_hand_category: "block" };
  const context = {
    console, WORLD_LOCK_KEY_ITEM_TYPE: "world_lock_key", WORLD_LOCK_KEY_ITEM_CATEGORY: "material",
    cleanAccountName: s => s, cleanWorld: s => s, clampString: s => s,
    ensureWritablePlayerState: () => state, getInventoryCount: (s, id) => s[id] || 0,
    cloneJson: structuredClone,
    spendItemFromState: (s, id, _cat, n) => { s[id] -= n; return s[id] >= 0; },
    makeAuditId: () => "exit-transaction", traceWorldLockKeyFlow: () => {},
    getMagnetSystem: () => ({clearBinding: () => cleared++}),
    ItemDatabase: {getStackLimit: () => 400},
    commitPlayerInventoryState: async (_socket, _player, _user, before, after, options) => {
      assert.equal(options.action, "world_exit_items_auto_remove");
      assert.equal(options.request_id, "exit-transaction");
      if (fail) return {ok:false, message:"injected failure"};
      state = after;
      const deltas = Object.keys(after).filter(id => after[id] !== before[id]).map(id => ({
        item_type:id, item_category:id === "world_lock_key" ? "material" : "tool", delta:after[id]-before[id], after_count:after[id],
      }));
      return {ok:true, state, deltas, postgres_committed:true};
    },
    buildInventoryDeltaClientPayloads: deltas => deltas,
    buildPlayerStateForClient: s => structuredClone(s),
    logItemLedgerForState: (...args) => ledgers.push(args),
    sendInventoryTransactionResult: (_socket, payload) => replies.push(payload),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const result = await context.removeWorldLockKeysFromPlayerInventory({}, player, "TEST", "leave_world", {silent});
  assert.equal(result.ok, !fail);
  assert.equal(state.dirt, 17);
  assert.equal(state.world_lock_key, fail ? keys : 0);
  assert.equal(state.magnet_machine_remote, fail ? remotes : 0);
  assert.equal(cleared, fail ? 0 : 1, "Clear the binding only after cleanup succeeds");
  if (!fail && keys + remotes > 0) {
    assert.equal(result.removed, keys + remotes);
    assert.equal(ledgers.length, Number(keys > 0) + Number(remotes > 0));
    assert.equal(player.selected_hand_item, "");
    assert.equal(replies.length, silent ? 0 : 1);
    if (!silent) {
      assert.equal(replies[0].inventory_delta, undefined, "A singular key delta must not hide the remote delta");
      assert.equal(replies[0].inventory_deltas.length, ledgers.length);
      assert.equal(replies[0].player_data.magnet_machine_remote, 0);
    }
  } else assert.equal(replies.length, 0);
}
(async () => {
  for (const [keys, remotes] of [[1,1], [1,0], [0,1], [0,0], [3,1]]) await run(keys, remotes);
  await run(1,1,true);
  await run(1,1,false,true);
  console.log("WORLD_EXIT_ITEMS_OK: keys/remotes, atomic failure, full deltas, silent disconnect and unrelated inventory");
})().catch(error => {console.error(error); process.exitCode = 1;});
