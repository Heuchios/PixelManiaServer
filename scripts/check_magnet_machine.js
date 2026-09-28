"use strict";
const assert = require("node:assert/strict");
const { createMagnetSystem, sanitizeMagnetState } = require("../magnet_machine");
const ItemDatabase = require("../server_item_database");
const copy = v => JSON.parse(JSON.stringify(v));

function fixture() {
  const world = { foreground: new Map([["1,2", { block_type: "magnet_machine", x: 1, y: 2 }]]), interactions: new Map(), removed_foreground: new Map() };
  const inventories = { owner: { dirt: 400, dirt_seed: 20 }, guest: {} };
  let last, failure = false, near = true, banned = false, commits = 0, sequence = 0;
  const messages = [];
  const owner = { id: "owner-session", account_username: "owner", world: "TEST" };
  const guest = { id: "guest-session", account_username: "guest", world: "TEST" };
  const deps = {
    ItemDatabase, ensureWorldState: () => world, cleanWorld: x => x,
    acquireLiveActionLock: async (locks, _scope, key) => {
      if (locks.has(key)) return { acquired: false };
      locks.add(key); return { acquired: true, locks, key };
    }, releaseLiveActionLock: lock => lock.locks.delete(lock.key),
    makeRequestId: d => d.request_id || String(++sequence), makeAuditId: () => String(++sequence),
    sendActionRejected: (_s, _t, message) => { last = { ok: false, message }; },
    queueWorldUpdateBroadcast: (_w, data) => messages.push(copy(data)),
    sendInventoryTransactionResult: (_s, data) => { last = copy(data); },
    requireAuthenticated: () => true, requireSameWorld: (_s, p, w) => p.world === w,
    rejectIfWorldBanned: async () => banned, tradeByPlayerId: new Map(),
    getTransactionGrid: d => Number.isInteger(d.x) && Number.isInteger(d.y) ? { x: d.x, y: d.y } : null,
    isPlayerNearGrid: () => near, isWorldLocked: () => true,
    canPlayerControlWorldLock: p => p.account_username === "owner",
    ensureWritablePlayerState: name => inventories[name], getInventoryCount: (s, id) => s[id] || 0,
    cloneJson: copy,
    spendItemFromState: (s, id, _cat, n) => { if ((s[id] || 0) < n) return false; s[id] -= n; return true; },
    canAddItemToState: (s, id, _cat, n) => (s[id] || 0) + n <= ItemDatabase.getStackLimit(id),
    addItemToState: (s, id, _cat, n) => { s[id] = (s[id] || 0) + n; return true; },
    buildWorldObjectChangeEntry: (_s, _p, _w, data) => copy(data),
    commitPlayerInventoryState: async (_s, _p, name, _before, after, opts) => {
      commits++; assert.equal(opts.world_mutation, true); assert.ok(opts.world_changes.length);
      if (failure) return { ok: false };
      inventories[name] = copy(after); return { ok: true, state: after, deltas: [], postgres_committed: true };
    },
    commitWorldStateWithBlockChanges: async () => { commits++; return { ok: !failure }; },
    persistWorldStateAfterInventoryCommit: () => {}, buildInventoryDeltaClientPayloads: () => [],
    applyBlockUpdateToWorldState: (_w, u) => { const k = `${u.x},${u.y}`; world.foreground.delete(k); world.interactions.delete(k); world.removed_foreground.set(k, u); },
    place: async (_s, p, packet) => {
      const source = system.source(packet); assert.ok(source);
      if (packet.x === 99) return; // Occupied/out-of-reach canonical placement rejects.
      assert.ok(system.consume(source, p.world, packet.block_type));
    },
  };
  const system = createMagnetSystem(deps);
  return { system, world, inventories, messages, owner, guest, deps,
    get last() { return last; }, get commits() { return commits; },
    set failure(v) { failure = v; }, set near(v) { near = v; },
    request: (action, extra = {}, p = owner) => system.handle({}, p, { type: "inventory_transaction_request", world: p.world, x: 1, y: 2, action, ...extra }),
    get machine() { return system.get("TEST", 1, 2); },
  };
}

(async () => {
  let f = fixture();
  await f.request("magnet_select", { item_id: "dirt" }); assert.ok(f.last.ok); assert.equal(f.machine.collecting, true);
  await f.request("magnet_deposit", { amount: 300 }); assert.ok(f.last.ok); assert.equal(f.machine.count, 300); assert.equal(f.inventories.owner.dirt, 100);
  await f.request("magnet_select", { item_id: "dirt_seed" }); assert.equal(f.last.ok, false); assert.equal(f.machine.item_id, "dirt");
  const updates = []; assert.equal(f.system.collect("TEST", "dirt", "block", 4800, updates), 100); assert.equal(f.machine.count, 5000);
  assert.equal(f.system.collect("TEST", "dirt_seed", "seed", 3, updates), 3);
  assert.equal(f.system.collect("TEST", "gem", "currency", 10, updates), 10);
  assert.equal(f.system.collect("TEST", "dirt", "block", 1, updates), 1);
  await f.request("magnet_withdraw", { amount: 100 }); assert.equal(f.machine.count, 4900); assert.equal(f.inventories.owner.dirt, 200);
  const saved = copy(f.machine); f.failure = true;
  await f.request("magnet_withdraw", { amount: 100 }); assert.equal(f.last.ok, false); assert.deepEqual(f.machine, saved); assert.equal(f.inventories.owner.dirt, 200);
  await f.request("magnet_update", { collecting: false, building: true }); assert.deepEqual(f.machine, saved);
  f.failure = false;
  for (const amount of [-1, 0, 0.5, 5001, NaN]) { await f.request("magnet_deposit", { amount }); assert.equal(f.last.ok, false); }
  for (const action of ["magnet_select", "magnet_update", "magnet_toggle", "magnet_deposit", "magnet_withdraw", "magnet_remove"]) {
    await f.request(action, { item_id: "dirt", amount: 1 }, f.guest); assert.equal(f.last.ok, false);
  }
  await f.request("magnet_remote", {}, f.guest); assert.equal(f.last.ok, false);
  await f.request("magnet_update", { collecting: true, building: true });
  await f.request("magnet_remote", {}, f.guest); assert.ok(f.last.ok); assert.equal(f.inventories.guest.magnet_machine_remote, 1);
  await f.request("magnet_remote", {}, f.guest); assert.equal(f.inventories.guest.magnet_machine_remote, 1);
  const count = f.machine.count;
  await f.request("magnet_place", { x: 99 }, f.guest); assert.equal(f.machine.count, count); assert.equal(f.last.ok, false);
  await f.request("magnet_place", { x: 4 }, f.guest); assert.equal(f.machine.count, count - 1); assert.equal(f.last.ok, true);
  await f.request("magnet_update", { collecting: false, building: false });
  await f.request("magnet_place", { x: 5 }, f.guest); assert.equal(f.last.ok, false);
  assert.equal(f.system.collect("TEST", "dirt", "block", 3, []), 3);
  f.near = false; await f.request("magnet_withdraw", { amount: 1 }); assert.equal(f.last.ok, false); f.near = true;
  assert.equal(f.system.source({ magnet_source: f.machine }), null, "A client cannot forge a stock source");
  const persisted = sanitizeMagnetState(copy(f.machine), "TEST", 1, 2); assert.deepEqual(persisted, f.machine);
  f = fixture(); await f.request("magnet_select", { item_id: "dirt_seed" });
  await f.request("magnet_deposit", { amount: 10 });
  await f.request("magnet_update", { collecting: true, building: true });
  await f.request("magnet_remote"); await f.request("magnet_place", { x: 8 }); assert.equal(f.machine.count, 9);
  await f.request("magnet_remove"); assert.equal(f.last.ok, false);
  await f.request("magnet_withdraw", { amount: 9 });
  f.failure = true; await f.request("magnet_remove"); assert.ok(f.machine); assert.equal(f.inventories.owner.magnet_machine || 0, 0);
  f.failure = false; await f.request("magnet_remove"); assert.equal(f.machine, null); assert.equal(f.inventories.owner.magnet_machine, 1);
  f.world.foreground.set("1,2", { block_type: "magnet_machine" });
  await f.request("magnet_place", { x: 8 }); assert.equal(f.last.ok, false, "Old remotes cannot control a replacement machine");
  f = fixture(); await f.request("magnet_select", { item_id: "dirt" });
  f.world.foreground.set("3,2", { block_type: "magnet_machine" });
  f.system.save({ ...f.machine, x: 3, count: 4999 }); f.system.save({ ...f.machine, count: 4999 });
  assert.equal(f.system.collect("TEST", "dirt", "block", 4, []), 2, "Collection spills across machines and leaves overflow");
  let release; const hold = new Promise(r => { release = r; });
  const running = f.system.locked({}, f.owner, {}, () => hold, true);
  await Promise.resolve(); await f.request("magnet_withdraw", { amount: 1 }); assert.equal(f.last.ok, false);
  release(); await running;
  console.log("[magnet-machine] capacity, overflow, filters, deposits, withdrawals, permissions, remotes, replacement, rollback, persistence and concurrency passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
