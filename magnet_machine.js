"use strict";

const BLOCK = "magnet_machine";
const REMOTE = "magnet_machine_remote";
const CAPACITY = 5000;
const integer = (v, max = CAPACITY) => Math.max(0, Math.min(max, Math.trunc(Number(v) || 0)));

function sanitizeMagnetState(raw = {}, world = "", x = 0, y = 0) {
  return { action: "magnet_state", world, x, y,
    machine_id: String(raw.machine_id || "").slice(0, 100),
    item_id: String(raw.item_id || "").slice(0, 100),
    item_category: raw.item_category === "seed" ? "seed" : "block",
    count: integer(raw.count), capacity: CAPACITY,
    collecting: raw.collecting === true, building: raw.building === true };
}

function createMagnetSystem(d) {
  const locks = new Set();
  const bindings = new WeakMap();
  // Only server-created packets can select machine stock as a placement cost.
  const placementSources = new WeakMap();
  const key = (x, y) => `${x},${y}`;
  function get(world, x, y) {
    const state = d.ensureWorldState(world);
    if (state.foreground.get(key(x, y))?.block_type !== BLOCK) return null;
    return sanitizeMagnetState(state.interactions.get(key(x, y)), world, x, y);
  }
  function save(machine) {
    d.ensureWorldState(machine.world).interactions.set(key(machine.x, machine.y), machine);
  }
  function eligible(id) {
    const def = d.ItemDatabase.getItemDefinition(id);
    return !!def && ["block", "seed"].includes(def.category) && !def.instance_tracked
      && (def.category === "seed" || d.ItemDatabase.isPlaceableBlock(id)) && id !== BLOCK;
  }
  function payload(machine) {
    return { type: "world_interaction_update", ...machine };
  }
  function broadcast(machine) { d.queueWorldUpdateBroadcast(machine.world, payload(machine)); }
  function hasMachines(world) {
    return [...d.ensureWorldState(world).interactions.values()].some(m => m.action === "magnet_state");
  }
  async function locked(socket, player, data, run, force = false) {
    const world = d.cleanWorld(player.world || data.world);
    if (!force && !hasMachines(world) && data.block_type !== BLOCK) return run();
    const lock = await d.acquireLiveActionLock(locks, "magnet_world", world, player.id);
    if (!lock.acquired) {
      d.sendActionRejected(socket, data.type || "inventory_transaction_request", "The machines are busy. Try again.",
        { request_id: d.makeRequestId(data), reason: "magnet_busy" });
      return;
    }
    try { return await run(); } finally { d.releaseLiveActionLock(lock); }
  }
  // Called only for freshly generated block/tree loot, in its enclosing world
  // transaction. Remainders keep their normal drop and pickup behavior.
  function collect(world, id, category, amount, updates, origin = null) {
    if (!eligible(id)) return amount;
    let remaining = amount;
    const state = d.ensureWorldState(world);
    for (const raw of state.interactions.values()) {
      if (remaining <= 0) break;
      if (raw.action !== "magnet_state") continue;
      const m = get(world, raw.x, raw.y);
      if (!m || !m.collecting || m.item_id !== id || m.item_category !== category) continue;
      const taken = Math.min(remaining, CAPACITY - m.count);
      if (taken <= 0) continue;
      m.count += taken; remaining -= taken; save(m);
      const update = payload(m);
      // Ephemeral visual, broadcast by the caller only after its transaction commits.
      if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
        update.collection_fx = { event_id: d.makeAuditId("magnet_fx"), x: origin.x, y: origin.y, amount: taken };
      }
      updates.push(update);
    }
    return remaining;
  }
  function snapshot(world) {
    return [...d.ensureWorldState(world).interactions.values()]
      .filter(m => m.action === "magnet_state").map(m => ({ ...m }));
  }
  function restore(world, machines) {
    const state = d.ensureWorldState(world);
    for (const [k, m] of state.interactions) if (m.action === "magnet_state") state.interactions.delete(k);
    for (const m of machines) save(m);
  }
  function source(data) { return placementSources.get(data) || null; }
  function consume(machine, world, id) {
    const current = get(world, machine.x, machine.y);
    if (!current || current.machine_id !== machine.machine_id || !current.building || current.item_id !== id || current.count < 1) return null;
    current.count--; save(current); return current;
  }
  function reply(socket, player, data, machine, ok, message = "", extras = {}) {
    d.sendInventoryTransactionResult(socket, { ok, request_id: d.makeRequestId(data), action: data.action,
      message, world: d.cleanWorld(player.world), magnet_state: machine ? { ...machine,
        can_manage: d.canPlayerControlWorldLock(player, machine.world) } : {}, ...extras });
  }
  async function handle(socket, player, data) {
    return locked(socket, player, data, () => handleLocked(socket, player, data), true);
  }
  async function handleLocked(socket, player, data) {
    const world = d.cleanWorld(data.world || player.world);
    if (!d.requireAuthenticated(socket, player, "use a Magnet Machine")
        || !d.requireSameWorld(socket, player, world, "use that machine")
        || await d.rejectIfWorldBanned(socket, player, world, "magnet_machine")) return;
    const reject = message => reply(socket, player, data, null, false, message);
    if (d.tradeByPlayerId.has(player.id)) return reject("Finish your trade first.");
    if (data.action === "magnet_place") {
      const binding = bindings.get(player);
      const m = binding?.world === world ? get(world, binding.x, binding.y) : null;
      const inv = d.ensureWritablePlayerState(player.account_username);
      if (!m || m.machine_id !== binding.machine_id || !m.building || !eligible(m.item_id)
          || !inv || d.getInventoryCount(inv, REMOTE, "tool") < 1 || m.count < 1)
        return reject("Get a remote from an active machine with stock in this world.");
      const packet = { ...data, action: m.item_category === "seed" ? "seed_place" : "place",
        type: m.item_category === "seed" ? "inventory_transaction_request" : "world_block_update",
        block_type: m.item_id, seed_type: m.item_id, item_id: m.item_id,
        layer: d.ItemDatabase.getPlaceLayer(m.item_id) || "foreground" };
      placementSources.set(packet, m);
      try { await d.place(socket, player, packet, m.item_category); }
      finally { placementSources.delete(packet); }
      const after = get(world, m.x, m.y);
      if (after) broadcast(after);
      return reply(socket, player, data, after, !!after && after.count === m.count - 1, "");
    }
    const grid = d.getTransactionGrid(data);
    if (!grid || !d.isPlayerNearGrid(player, grid.x, grid.y)) return reject("Too far away.");
    let m = get(world, grid.x, grid.y);
    if (!m) return reject("That Magnet Machine is gone.");
    if (!d.isWorldLocked(world)) return reject("Lock the world before using a Magnet Machine.");
    if (data.action === "magnet_get_state") return reply(socket, player, data, m, true);
    const manages = d.canPlayerControlWorldLock(player, world);
    if (data.action !== "magnet_remote" && !manages) return reject("Only the world owner can manage this machine.");
    if (data.action === "magnet_remote" && (!m.building || !m.item_id || !m.machine_id))
      return reject("The owner must select an item and enable building first.");
    const state = d.ensureWritablePlayerState(player.account_username);
    if (!state) return reject("Inventory unavailable.");
    const before = d.cloneJson(state), after = d.cloneJson(state);
    const original = snapshot(world);
    const previous = { ...m };
    const worldState = d.ensureWorldState(world);
    const tileKey = key(m.x, m.y);
    const originalBlock = worldState.foreground.get(tileKey);
    const originalRemoved = worldState.removed_foreground.get(tileKey);
    const rollback = () => {
      restore(world, original);
      if (data.action === "magnet_remove") {
        worldState.foreground.set(tileKey, originalBlock);
        if (originalRemoved) worldState.removed_foreground.set(tileKey, originalRemoved);
        else worldState.removed_foreground.delete(tileKey);
      }
    };
    let inventoryChanged = false;
    if (!m.machine_id) m.machine_id = d.makeAuditId("magnet");
    if (data.action === "magnet_update") {
      m.collecting = data.collecting === true;
      m.building = data.building === true;
    } else if (data.action === "magnet_toggle") {
      m.building = !m.building;
    } else if (data.action === "magnet_select") {
      const id = String(data.item_id || "");
      if (m.count > 0) return reject("Empty the machine before changing its item.");
      if (id && (!eligible(id) || d.getInventoryCount(state, id, d.ItemDatabase.getItemDefinition(id).category) < 1))
        return reject("Choose a block or seed from your inventory.");
      m.item_id = id;
      m.item_category = id ? d.ItemDatabase.getItemDefinition(id).category : "block";
      m.collecting = !!id;
      m.building = false;
    } else if (data.action === "magnet_deposit" || data.action === "magnet_withdraw") {
      const amount = Number(data.amount);
      if (!eligible(m.item_id) || !Number.isSafeInteger(amount) || amount < 1 || amount > CAPACITY)
        return reject("Enter a valid item amount.");
      if (data.action === "magnet_deposit") {
        if (m.count + amount > CAPACITY || !d.spendItemFromState(after, m.item_id, m.item_category, amount))
          return reject("Not enough items or machine capacity.");
        m.count += amount;
      } else {
        if (amount > m.count || !d.canAddItemToState(after, m.item_id, m.item_category, amount))
          return reject("Not enough stock or inventory space.");
        d.addItemToState(after, m.item_id, m.item_category, amount); m.count -= amount;
      }
      inventoryChanged = true;
    } else if (data.action === "magnet_remove") {
      if (m.count > 0) return reject("Empty the machine before removing it.");
      if (!d.canAddItemToState(after, BLOCK, "block", 1)) return reject("Make room for the machine first.");
      d.addItemToState(after, BLOCK, "block", 1); inventoryChanged = true;
    } else if (data.action === "magnet_remote") {
      if (d.getInventoryCount(after, REMOTE, "tool") < 1) {
        if (!d.canAddItemToState(after, REMOTE, "tool", 1)) return reject("Make room in your inventory for the remote.");
        d.addItemToState(after, REMOTE, "tool", 1); inventoryChanged = true;
      }
    } else return reject("Unknown machine action.");
    if (!m.item_id) { m.collecting = false; m.building = false; }
    save(m);
    const update = data.action === "magnet_remove"
      ? { type: "world_block_update", action: "break", layer: "foreground", world, x: m.x, y: m.y, block_type: BLOCK }
      : payload(m);
    if (data.action === "magnet_remove") d.applyBlockUpdateToWorldState(world, update);
    const change = d.buildWorldObjectChangeEntry(socket, player, world, update, previous, data.action === "magnet_remove" ? {} : m,
      d.makeAuditId("magnet"), { operation: data.action });
    let commit;
    try {
      commit = inventoryChanged
        ? await d.commitPlayerInventoryState(socket, player, player.account_username, before, after,
          { source: "magnet_machine", action: data.action, reason: data.action, request_id: d.makeRequestId(data),
            world, world_mutation: true, world_changes: [change] })
        : await d.commitWorldStateWithBlockChanges(world, [change], { player });
    } catch (error) { rollback(); throw error; }
    if (!commit.ok) { rollback(); return reject(commit.message || "Could not save the machine."); }
    if (inventoryChanged) d.persistWorldStateAfterInventoryCommit(world, commit.postgres_committed);
    if (data.action === "magnet_remote") bindings.set(player, { world, x: m.x, y: m.y, machine_id: m.machine_id });
    d.queueWorldUpdateBroadcast(world, update);
    return reply(socket, player, data, data.action === "magnet_remove" ? null : m, true, data.action === "magnet_remote" ? "Remote connected. Select it in your inventory to build." : "", {
      inventory_deltas: inventoryChanged ? d.buildInventoryDeltaClientPayloads(commit.deltas, commit.state) : [],
      remote_bound: data.action === "magnet_remote" });
  }
  return { get, save, eligible, payload, broadcast, locked, collect, snapshot, restore, source, consume, handle,
    clearBinding: player => bindings.delete(player) };
}

module.exports = { BLOCK, REMOTE, CAPACITY, sanitizeMagnetState, createMagnetSystem };
