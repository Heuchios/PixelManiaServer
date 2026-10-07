"use strict";
const assert = require("node:assert/strict");
const { createMagnetSystem, sanitizeMagnetState } = require("../magnet_machine");
const ItemDatabase = require("../server_item_database");
const copy = v => JSON.parse(JSON.stringify(v));

function fixture(durable = false) {
  const db = durable ? require('./postgres_test_double').createStore({ inventory: [], item_instances: [], item_transactions: [], world_drops: [] }, {
    accountId: '11111111-1111-4111-8111-111111111111', playerId: '22222222-2222-4222-8222-222222222222', worldId: '33333333-3333-4333-8333-333333333333',
  }) : null;
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
    commitPlayerInventoryState: async (_s, _p, name, before, after, opts) => {
      commits++; assert.equal(opts.world_mutation, true); assert.ok(opts.world_changes.length);
      if (failure) return { ok: false };
      if (db) {
        const result = await db.store.applyInventoryDeltaTransaction({
          account_username: name, world: 'TEST', source: opts.source, action: opts.action, request_id: opts.request_id,
          deltas: [{ item_type: 'magnet_machine_remote', item_category: 'tool', delta: (after.magnet_machine_remote || 0) - (before.magnet_machine_remote || 0), stack_limit: 1 }],
        });
        if (!result.ok) return result;
      }
      inventories[name] = copy(after); return { ok: true, state: after, deltas: [], postgres_committed: true };
    },
    commitWorldStateWithBlockChanges: async () => { commits++; return { ok: !failure }; },
    persistWorldStateAfterInventoryCommit: () => {}, buildInventoryDeltaClientPayloads: () => [],
    applyBlockUpdateToWorldState: (_w, u) => { const k = `${u.x},${u.y}`; world.foreground.delete(k); world.interactions.delete(k); world.removed_foreground.set(k, u); },
    place: async (_s, p, packet) => {
      const source = system.source(packet); assert.ok(source);
      if (packet.x === 99) return; // Occupied/out-of-reach canonical placement rejects.
      const before = system.snapshot(p.world);
      assert.ok(system.consume(source, p.world, packet.block_type));
      if (failure) system.restore(p.world, before); // Canonical late-save rollback.
    },
  };
  const system = createMagnetSystem(deps);
  return { system, world, inventories, messages, owner, guest, deps, db,
    get last() { return last; }, get commits() { return commits; },
    set failure(v) { failure = v; }, set near(v) { near = v; },
    request: (action, extra = {}, p = owner) => system.handle({}, p, { type: "inventory_transaction_request", world: p.world, x: 1, y: 2, action, ...extra }),
    get machine() { return system.get("TEST", 1, 2); },
  };
}

(async () => {
  let f = fixture();
  assert.equal(ItemDatabase.getItemDefinition("magnet_machine_remote").equipable, false);
  assert.equal(ItemDatabase.getItemDefinition("magnet_machine_remote").hand_item, false);
  await f.request("magnet_select", { item_id: "dirt" }); assert.ok(f.last.ok); assert.equal(f.machine.collecting, true);
  await f.request("magnet_deposit", { amount: 300 }); assert.ok(f.last.ok); assert.equal(f.machine.count, 300); assert.equal(f.inventories.owner.dirt, 100);
  await f.request("magnet_select", { item_id: "dirt_seed" }); assert.equal(f.last.ok, false); assert.equal(f.machine.item_id, "dirt");
  const updates = []; assert.equal(f.system.collect("TEST", "dirt", "block", 4800, updates, { x: 320, y: 96 }), 100); assert.equal(f.machine.count, 5000);
  assert.deepEqual(updates[0].collection_fx, { event_id: updates[0].collection_fx.event_id, x: 320, y: 96, amount: 4700 });
  assert.ok(updates[0].collection_fx.event_id);
  assert.equal(f.world.interactions.get('1,2').collection_fx, undefined, 'Visual events must not be persisted or replayed on joining');
  assert.equal(f.system.collect("TEST", "dirt_seed", "seed", 3, updates), 3);
  assert.equal(f.system.collect("TEST", "gem", "currency", 10, updates), 10);
  assert.equal(f.system.collect("TEST", "dirt", "block", 1, updates), 1);
  assert.equal(updates.length, 1, 'Full or mismatched machines must not emit suction');
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
  for (const item_id of ["dirt", "dirt_seed"]) {
    const emptyMessage = "Magnet Machine is out of stock. Please refill it.";
    const stock = fixture();
    await stock.request("magnet_select", { item_id });
    await stock.request("magnet_deposit", { amount: 2 });
    await stock.request("magnet_update", { collecting: true, building: true });
    await stock.request("magnet_remote", {}, stock.guest);
    assert.ok(stock.system.canPreview(stock.guest, item_id), "Bound machine stock authorizes a preview without player stock");
    assert.equal(stock.system.canPreview(stock.owner, item_id), false, "Unbound players cannot preview machine stock");
    assert.equal(stock.system.canPreview(stock.guest, "stone"), false, "The preview must match the machine's configured item");
    stock.guest.world = "OTHER";
    assert.equal(stock.system.canPreview(stock.guest, item_id), false);
    stock.guest.world = "TEST";
    assert.notEqual(stock.last.message, emptyMessage, "Binding must not emit a depletion popup");
    await stock.request("magnet_place", { x: 4 }, stock.guest);
    assert.equal(stock.machine.count, 1);
    assert.equal(stock.last.message, "", "Stock remaining must not emit a popup");
    await stock.request("magnet_place", { x: 99 }, stock.guest);
    assert.equal(stock.last.ok, false);
    assert.equal(stock.last.message, "", "Rejected placement must not announce depletion");
    stock.failure = true;
    await stock.request("magnet_place", { x: 5 }, stock.guest);
    assert.equal(stock.machine.count, 1);
    assert.equal(stock.last.ok, false);
    assert.equal(stock.last.message, "", "Rolled-back last-item placement must not announce depletion");
    stock.failure = false;
    await stock.request("magnet_place", { x: 5 }, stock.guest);
    assert.equal(stock.machine.count, 0);
    assert.equal(stock.system.canPreview(stock.guest, item_id), false, "Empty machines cannot authorize a hand preview");
    assert.equal(stock.last.ok, true);
    assert.equal(stock.last.message, emptyMessage, "Last-item placement must immediately request a refill");
    const broadcasts = stock.messages.length;
    await stock.request("magnet_place", { x: 6 }, stock.guest);
    assert.equal(stock.last.ok, false);
    assert.equal(stock.last.message, emptyMessage, "Empty remote use must explain how to resume");
    assert.equal(stock.messages.length, broadcasts, "Empty attempts must not broadcast world updates");
    assert.ok(stock.messages.every(message => !message.message), "Other players must not receive the popup");
    await stock.request("magnet_deposit", { amount: 1 });
    assert.ok(stock.system.canPreview(stock.guest, item_id));
    assert.equal(stock.last.message, "");
    await stock.request("magnet_place", { x: 6 }, stock.guest);
    assert.equal(stock.last.ok, true);
    assert.equal(stock.last.message, emptyMessage, "Refilling must allow building and a new depletion notice");
  }
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
  f = fixture(true);
  await f.request('magnet_select', { item_id: 'dirt' });
  await f.request('magnet_update', { collecting: true, building: true });
  await f.request('magnet_remote', {}, f.guest);
  assert.equal(f.last.ok, true, 'The real PostgreSQL inventory transaction must accept the remote creation source');
  assert.equal(f.db.fake.state.inventory[0].amount, 1);
  assert.equal(f.db.fake.state.item_instances.length, 1);
  const remoteInstance = f.db.fake.state.item_instances[0];
  assert.equal(remoteInstance.item_type, 'magnet_machine_remote');
  assert.equal(remoteInstance.created_by_source, 'magnet_machine');
  assert.equal(remoteInstance.state, 'active');
  assert.equal(remoteInstance.current_location, 'inventory');
  assert.match(remoteInstance.public_item_instance_id, /^PM-ITEM-/);
  assert.equal(f.db.fake.state.item_transactions[0].source, 'magnet_machine');
  await f.request('magnet_remote', {}, f.guest);
  assert.equal(f.db.fake.state.item_instances.length, 1, 'Reconnecting a remote must reuse its tracked instance');
  const rejected = await f.db.store.applyInventoryDeltaTransaction({ account_username: 'owner', source: 'system', action: 'test',
    deltas: [{ item_type: 'wrench', item_category: 'tool', delta: 1 }] });
  assert.equal(rejected.reason, 'missing_item_instance_source', 'Vague creation sources remain blocked');
  assert.equal(f.db.fake.state.item_instances.length, 1);
  console.log("[magnet-machine] capacity, overflow, filters, deposits, withdrawals, permissions, remotes, stock notifications, replacement, rollback, persistence and concurrency passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
