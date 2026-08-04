#!/usr/bin/env node
// @ts-check
"use strict";

/**
 * Drop pickup item-loss regression checks.
 *
 * These tests drive the real `PostgresStore.applyDropPickupTransaction` against an
 * in-memory PostgreSQL double and assert the core invariant that the reported bug
 * violated:
 *
 *   - If the inventory quantity increased, the world drop was consumed exactly once.
 *   - If the inventory quantity did NOT increase, the world drop is still collectible
 *     and its tracked item instances are untouched.
 *   - No failure path may delete both the drop and its tracked data.
 *   - Tracked item instances are never minted for drops that came out of a player's
 *     inventory (that would duplicate real items).
 *
 * They also lock in the routing rule that only a proven `picked_up` drop may be
 * removed from live world state.
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const PostgresStore = require("../postgres_store.js");
const DropContracts = require("../server_drop_contracts.js");
const InventoryTransactionHelpers = require("../server_inventory_transaction_helpers.js");

const WORLD_ID = "11111111-1111-4111-8111-111111111111";
const PLAYER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PLAYER_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";

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
 * @param {string} name
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
async function checkAsync(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAIL ${name}`);
    console.error(`       ${message}`);
  }
}

/* ------------------------------------------------------------------ *
 * In-memory PostgreSQL double
 * ------------------------------------------------------------------ */

/**
 * @param {any} state
 * @returns {any}
 */
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/**
 * Creates a fake pg pool that understands only the statements
 * `applyDropPickupTransaction` issues. Unknown statements resolve to an empty
 * result, which is safe because every statement whose result the transaction
 * depends on is matched explicitly below.
 *
 * @param {any} initialState
 * @returns {any}
 */
function createFakePool(initialState) {
  const store = {
    committed: cloneState(initialState),
  };
  let working = cloneState(store.committed);
  /** @type {string[]} */
  const log = [];

  /**
   * @param {any} dropId
   * @returns {any}
   */
  function matchDrop(dropId) {
    return working.world_drops.find((/** @type {any} */ row) => row.drop_id === dropId) || null;
  }

  /**
   * @param {any} instance
   * @returns {string}
   */
  function dropIdOf(instance) {
    const metadata = instance.metadata || {};
    return (
      metadata.drop_id ||
      (metadata.details && metadata.details.drop_id) ||
      (metadata.details && metadata.details.details && metadata.details.details.drop_id) ||
      ""
    );
  }

  /**
   * @param {any} text
   * @param {any[]} [params]
   * @returns {Promise<any>}
   */
  async function query(text, params = []) {
    const sql = String(text || "");
    log.push(sql.replace(/\s+/g, " ").trim().slice(0, 120));

    if (sql === "BEGIN") {
      working = cloneState(store.committed);
      return { rows: [], rowCount: 0 };
    }
    if (sql === "COMMIT") {
      store.committed = cloneState(working);
      return { rows: [], rowCount: 0 };
    }
    if (sql === "ROLLBACK") {
      working = cloneState(store.committed);
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('INTO "pixelmania"."accounts"')) {
      return { rows: [{ account_id: ACCOUNT_ID }], rowCount: 1 };
    }
    if (sql.includes('INTO "pixelmania"."players"')) {
      return { rows: [{ player_id: PLAYER_ID }], rowCount: 1 };
    }
    if (sql.includes('INTO "pixelmania"."worlds"')) {
      return { rows: [{ world_id: WORLD_ID }], rowCount: 1 };
    }

    if (sql.includes('FROM "pixelmania"."world_drops"') && sql.includes("FOR UPDATE")) {
      const row = matchDrop(params[1]);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('INSERT INTO "pixelmania"."world_drops"')) {
      const [, dropId, itemType, itemCategory, amount, x, y, gridX, gridY, pickupDelay, metadata] = params;
      const parsedMetadata = JSON.parse(String(metadata || "{}"));
      const existing = matchDrop(dropId);
      if (existing) {
        existing.item_type = itemType;
        existing.item_category = itemCategory;
        existing.amount = amount;
        existing.status = "active";
        existing.metadata = { ...(existing.metadata || {}), ...parsedMetadata };
      } else {
        working.world_drops.push({
          drop_id: dropId,
          item_type: itemType,
          item_category: itemCategory,
          amount,
          status: "active",
          x,
          y,
          stack_grid_x: gridX,
          stack_grid_y: gridY,
          pickup_delay: pickupDelay,
          metadata: parsedMetadata,
        });
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('UPDATE "pixelmania"."world_drops"') && sql.includes("SET amount = $3::bigint")) {
      const row = matchDrop(params[1]);
      if (row) {
        row.amount = params[2];
        row.status = Number(params[2]) <= 0 ? "picked_up" : "active";
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (sql.includes('FROM "pixelmania"."inventory"') && sql.includes("FOR UPDATE")) {
      const row = working.inventory.find(
        (/** @type {any} */ entry) => entry.item_type === params[1] && entry.item_category === params[2]
      );
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('FROM "pixelmania"."inventory"')) {
      const rows = working.inventory.map((/** @type {any} */ entry) => ({ ...entry }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes('UPDATE "pixelmania"."inventory"')) {
      const row = working.inventory.find(
        (/** @type {any} */ entry) => entry.item_type === params[1] && entry.item_category === params[2]
      );
      if (row) row.amount = params[3];
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO "pixelmania"."inventory"')) {
      working.inventory.push({
        item_type: params[1],
        item_category: params[2],
        amount: params[3],
        stack_limit: params[4],
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO "pixelmania"."item_transactions"')) {
      working.item_transactions.push({ item_type: params[2], delta: params[4] });
      return { rows: [{ item_transaction_id: working.item_transactions.length }], rowCount: 1 };
    }

    // claimTrackedWorldDropItemInstances
    if (
      sql.includes('FROM "pixelmania"."item_instances"') &&
      sql.includes("state = 'dropped'") &&
      sql.includes("FOR UPDATE")
    ) {
      const [itemType, itemCategory, worldId, dropId, limit] = params;
      const rows = working.item_instances
        .filter((/** @type {any} */ instance) => instance.item_type === itemType)
        .filter((/** @type {any} */ instance) => instance.item_category === itemCategory)
        .filter(
          (/** @type {any} */ instance) => instance.state === "dropped" && instance.current_location === "world_drop"
        )
        .filter((/** @type {any} */ instance) => !worldId || instance.world_id === worldId)
        .filter((/** @type {any} */ instance) => dropId === "" || dropIdOf(instance) === dropId)
        .slice(0, Number(limit));
      return { rows: rows.map((/** @type {any} */ instance) => ({ ...instance })), rowCount: rows.length };
    }

    // Orphan probe added by the item-loss fix.
    if (sql.includes('FROM "pixelmania"."item_instances"') && sql.includes("count(*)::integer AS instance_count")) {
      const [itemType, itemCategory, worldId, dropId] = params;
      const count = working.item_instances.filter(
        (/** @type {any} */ instance) =>
          instance.item_type === itemType &&
          instance.item_category === itemCategory &&
          (!worldId || instance.world_id === worldId) &&
          dropIdOf(instance) === dropId
      ).length;
      return { rows: [{ instance_count: count }], rowCount: 1 };
    }
    // createTrackedWorldDropItemInstances dedupe probe.
    if (sql.includes('FROM "pixelmania"."item_instances"') && sql.includes("count(*)::integer AS existing_count")) {
      const [itemType, itemCategory, worldId, dropId] = params;
      const count = working.item_instances.filter(
        (/** @type {any} */ instance) =>
          instance.item_type === itemType &&
          instance.item_category === itemCategory &&
          instance.world_id === worldId &&
          instance.state === "dropped" &&
          instance.current_location === "world_drop" &&
          dropIdOf(instance) === dropId
      ).length;
      return { rows: [{ existing_count: count }], rowCount: 1 };
    }
    if (sql.includes('FROM "pixelmania"."item_instances"') && sql.includes("count(*)::integer AS active_count")) {
      const count = working.item_instances.filter(
        (/** @type {any} */ instance) => instance.state === "active" && instance.item_type === params[1]
      ).length;
      return { rows: [{ active_count: count }], rowCount: 1 };
    }

    if (sql.includes('UPDATE "pixelmania"."item_instances"') && sql.includes("current_location = 'inventory'")) {
      const instance = working.item_instances.find(
        (/** @type {any} */ entry) => entry.item_instance_id === params[0]
      );
      if (instance) {
        instance.owner_player_id = params[1];
        instance.state = "active";
        instance.current_location = "inventory";
      }
      return { rows: [], rowCount: instance ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO "pixelmania"."item_instances"')) {
      const id = crypto.randomUUID();
      working.item_instances.push({
        item_instance_id: id,
        public_item_instance_id: params[0],
        item_type: params[1],
        item_category: params[2],
        owner_player_id: null,
        world_id: params[3],
        state: "dropped",
        current_location: "world_drop",
        metadata: JSON.parse(String(params[6] || "{}")),
      });
      return { rows: [{ item_instance_id: id }], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  return {
    pool: {
      async connect() {
        return { query, release() {} };
      },
      query,
    },
    log,
    get state() {
      return store.committed;
    },
  };
}

/**
 * @param {any} initialState
 * @returns {{ store: any, fake: any }}
 */
function createStore(initialState) {
  const fake = createFakePool(initialState);
  /** @type {any} */
  const store = new PostgresStore({ enabled: false, schema: "pixelmania", logger: () => {} });
  store.enabled = true;
  store.ready = true;
  store.degraded = false;
  store.pool = fake.pool;
  return { store, fake };
}

/**
 * @param {any} [overrides]
 * @returns {any}
 */
function serverAuthoredDrop(overrides = {}) {
  return {
    drop_id: "drop-server-1",
    item_type: "pickaxe",
    item_category: "tool",
    amount: 1,
    status: "active",
    x: 32,
    y: 32,
    stack_grid_x: 1,
    stack_grid_y: 1,
    pickup_delay: 0,
    metadata: {
      source: "world_state_mirror",
      action: "mirror",
      origin_source: "world_block_break",
      origin_action: "break_drop",
    },
    ...overrides,
  };
}

/**
 * @param {string} dropId
 * @param {any} [overrides]
 * @returns {any}
 */
function trackedInstance(dropId, overrides = {}) {
  return {
    item_instance_id: crypto.randomUUID(),
    public_item_instance_id: `PM-ITEM-${dropId}`,
    item_type: "pickaxe",
    item_category: "tool",
    owner_player_id: null,
    world_id: WORLD_ID,
    state: "dropped",
    current_location: "world_drop",
    metadata: { drop_id: dropId },
    ...overrides,
  };
}

/**
 * @param {any} [overrides]
 * @returns {any}
 */
function baseState(overrides = {}) {
  return {
    world_drops: [serverAuthoredDrop()],
    inventory: [],
    item_instances: [],
    item_transactions: [],
    ...overrides,
  };
}

/**
 * @param {any} [overrides]
 * @returns {any}
 */
function pickupEntry(overrides = {}) {
  return {
    account_username: "tester",
    world: "START",
    drop_id: "drop-server-1",
    item_type: "pickaxe",
    item_category: "tool",
    amount: 1,
    stack_limit: 1,
    allow_state_repair: true,
    allow_world_drop_repair: true,
    request_id: "req-1",
    source_id: "pickup-1",
    at: new Date(0).toISOString(),
    ...overrides,
  };
}

/**
 * `applyDropPickupTransaction` returns a success/failure union. The tests inspect
 * failure-only diagnostics, so widen the result before reading them.
 *
 * @param {any} result
 * @returns {any}
 */
function asRecord(result) {
  return result;
}

/**
 * @param {any} state
 * @param {string} itemType
 * @returns {number}
 */
function inventoryAmount(state, itemType) {
  const row = state.inventory.find((/** @type {any} */ entry) => entry.item_type === itemType);
  return row ? Number(row.amount) : 0;
}

/**
 * @param {any} state
 * @param {string} dropId
 * @returns {any}
 */
function activeDrop(state, dropId) {
  return (
    state.world_drops.find(
      (/** @type {any} */ row) => row.drop_id === dropId && row.status === "active" && Number(row.amount) > 0
    ) || null
  );
}

/**
 * @param {any} state
 * @param {string} dropId
 * @returns {any[]}
 */
function trackedInstancesFor(state, dropId) {
  return state.item_instances.filter((/** @type {any} */ instance) => {
    const metadata = instance.metadata || {};
    return metadata.drop_id === dropId;
  });
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

async function run() {
  console.log("drop pickup item-loss invariants");

  await checkAsync("happy path: inventory gains the item and the drop is consumed once", async () => {
    const { store, fake } = createStore(baseState({ item_instances: [trackedInstance("drop-server-1")] }));
    const result = asRecord(await store.applyDropPickupTransaction(pickupEntry()));
    assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result)}`);
    assert.equal(inventoryAmount(fake.state, "pickaxe"), 1, "inventory must gain exactly one item");
    assert.equal(activeDrop(fake.state, "drop-server-1"), null, "collected drop must not stay active");
    const instances = trackedInstancesFor(fake.state, "drop-server-1");
    assert.equal(instances.length, 1, "tracked instance must survive the pickup");
    assert.equal(instances[0].current_location, "inventory", "tracked instance must move to the inventory");
    assert.equal(instances[0].owner_player_id, PLAYER_ID, "tracked instance must be owned by the picker");
  });

  await checkAsync("missing tracked data for a server drop is repaired, never lost", async () => {
    const { store, fake } = createStore(baseState());
    const result = asRecord(await store.applyDropPickupTransaction(pickupEntry()));
    assert.equal(result.ok, true, `expected repaired success, got ${JSON.stringify(result)}`);
    assert.equal(inventoryAmount(fake.state, "pickaxe"), 1, "inventory must gain the repaired item");
    assert.equal(trackedInstancesFor(fake.state, "drop-server-1").length, 1, "exactly one instance may be rebuilt");
  });

  await checkAsync("inventory drop with missing tracked data is quarantined, not minted", async () => {
    const state = baseState({
      world_drops: [
        serverAuthoredDrop({
          drop_id: "drop-inventory-1",
          metadata: {
            source: "world_state_mirror",
            action: "mirror",
            origin_source: "world_item_drop_create",
            origin_action: "drop_create",
          },
        }),
      ],
    });
    const { store, fake } = createStore(state);
    const result = asRecord(await store.applyDropPickupTransaction(pickupEntry({ drop_id: "drop-inventory-1" })));
    assert.equal(result.ok, false, "inventory-sourced drops must not mint replacement instances");
    assert.equal(result.reason, "world_drop_item_instances_pending", `unexpected reason ${result.reason}`);
    assert.equal(inventoryAmount(fake.state, "pickaxe"), 0, "no item may be granted");
    assert.ok(activeDrop(fake.state, "drop-inventory-1"), "the drop must stay collectible in the world");
    assert.equal(trackedInstancesFor(fake.state, "drop-inventory-1").length, 0, "no instance may be minted");
  });

  await checkAsync("unknown drop origin with missing tracked data is quarantined", async () => {
    const state = baseState({
      world_drops: [
        serverAuthoredDrop({
          drop_id: "drop-unknown-1",
          metadata: { source: "world_state_mirror", action: "mirror" },
        }),
      ],
    });
    const { store, fake } = createStore(state);
    const result = asRecord(await store.applyDropPickupTransaction(pickupEntry({ drop_id: "drop-unknown-1" })));
    assert.equal(result.ok, false, "unprovenanced drops must not mint instances");
    assert.equal(result.reason, "world_drop_item_instances_pending");
    assert.ok(activeDrop(fake.state, "drop-unknown-1"), "the drop must remain in the world");
    assert.equal(inventoryAmount(fake.state, "pickaxe"), 0, "no item may be granted");
  });

  await checkAsync("server drop whose instances were already consumed is quarantined", async () => {
    const state = baseState({
      item_instances: [
        trackedInstance("drop-server-1", {
          state: "active",
          current_location: "inventory",
          owner_player_id: OTHER_PLAYER_ID,
        }),
      ],
    });
    const { store, fake } = createStore(state);
    const result = asRecord(await store.applyDropPickupTransaction(pickupEntry()));
    assert.equal(result.ok, false, "an already-owned instance must never be duplicated");
    assert.equal(result.reason, "world_drop_item_instances_pending");
    assert.equal(inventoryAmount(fake.state, "pickaxe"), 0, "no item may be granted");
    assert.equal(trackedInstancesFor(fake.state, "drop-server-1").length, 1, "no instance may be minted");
    assert.ok(activeDrop(fake.state, "drop-server-1"), "the drop must remain in the world");
  });

  await checkAsync("a fully collected drop reports drop_status=picked_up", async () => {
    const state = baseState({
      world_drops: [serverAuthoredDrop({ amount: 0, status: "picked_up" })],
    });
    const { store, fake } = createStore(state);
    const result = asRecord(await store.applyDropPickupTransaction(pickupEntry()));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "drop_not_available");
    assert.equal(result.drop_status, "picked_up", "collected drops must be distinguishable");
    assert.equal(inventoryAmount(fake.state, "pickaxe"), 0);
  });

  await checkAsync("a removed drop reports drop_status=removed and is not treated as collected", async () => {
    const state = baseState({
      world_drops: [serverAuthoredDrop({ amount: 0, status: "removed" })],
    });
    const { store } = createStore(state);
    const result = asRecord(await store.applyDropPickupTransaction(pickupEntry()));
    assert.equal(result.reason, "drop_not_available");
    assert.equal(result.drop_status, "removed");
    assert.equal(
      DropContracts.isPostgresDropPickupCollectedFailure(result),
      false,
      "a removed drop must never authorise deleting the live drop"
    );
  });

  await checkAsync("a stale expected drop amount never destroys the drop", async () => {
    const state = baseState({
      world_drops: [serverAuthoredDrop({ amount: 5 })],
      item_instances: [1, 2, 3, 4, 5].map(() => trackedInstance("drop-server-1")),
    });
    const { store, fake } = createStore(state);
    const result = asRecord(
      await store.applyDropPickupTransaction(
        pickupEntry({ amount: 2, stack_limit: 10, expected_drop_before_amount: 4 })
      )
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "drop_amount_changed");
    assert.equal(result.drop_status, "active");
    assert.equal(
      DropContracts.isPostgresDropPickupCollectedFailure(result),
      false,
      "an amount mismatch must not authorise deleting the drop"
    );
    assert.equal(Number(activeDrop(fake.state, "drop-server-1").amount), 5, "drop amount must be untouched");
    assert.equal(inventoryAmount(fake.state, "pickaxe"), 0);
  });

  await checkAsync("insufficient capacity leaves the drop and the tracked data intact", async () => {
    const state = baseState({
      inventory: [{ item_type: "pickaxe", item_category: "tool", amount: 1, stack_limit: 1 }],
      item_instances: [trackedInstance("drop-server-1")],
    });
    const { store, fake } = createStore(state);
    const result = asRecord(await store.applyDropPickupTransaction(pickupEntry()));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "insufficient_capacity");
    assert.equal(inventoryAmount(fake.state, "pickaxe"), 1, "inventory must not change");
    assert.ok(activeDrop(fake.state, "drop-server-1"), "the drop must stay collectible");
    assert.equal(trackedInstancesFor(fake.state, "drop-server-1")[0].current_location, "world_drop");
  });

  await checkAsync("partial pickup consumes exactly the claimed instances", async () => {
    const state = baseState({
      world_drops: [serverAuthoredDrop({ item_type: "dirt", item_category: "block", amount: 5 })],
    });
    const { store, fake } = createStore(state);
    const result = asRecord(
      await store.applyDropPickupTransaction(
        pickupEntry({ item_type: "dirt", item_category: "block", amount: 2, stack_limit: 400 })
      )
    );
    assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result)}`);
    assert.equal(inventoryAmount(fake.state, "dirt"), 2);
    assert.equal(Number(activeDrop(fake.state, "drop-server-1").amount), 3, "the remainder must stay collectible");
  });

  await checkAsync("a second pickup of a drained drop cannot grant the item twice", async () => {
    const { store, fake } = createStore(baseState({ item_instances: [trackedInstance("drop-server-1")] }));
    const first = asRecord(await store.applyDropPickupTransaction(pickupEntry()));
    assert.equal(first.ok, true);
    const second = asRecord(
      await store.applyDropPickupTransaction(pickupEntry({ request_id: "req-2", source_id: "pickup-2" }))
    );
    assert.equal(second.ok, false, "the same drop must not be granted twice");
    assert.equal(second.drop_status, "picked_up");
    assert.equal(inventoryAmount(fake.state, "pickaxe"), 1, "inventory must not increase twice");
  });

  console.log("failure routing contract");

  check("only a proven picked_up drop authorises removing live world state", () => {
    assert.equal(
      DropContracts.isPostgresDropPickupCollectedFailure({
        ok: false,
        reason: "drop_not_available",
        drop_status: "picked_up",
      }),
      true
    );
    for (const status of ["missing", "removed", "expired", "active", ""]) {
      assert.equal(
        DropContracts.isPostgresDropPickupCollectedFailure({
          ok: false,
          reason: "drop_not_available",
          drop_status: status,
        }),
        false,
        `drop_status=${status} must not authorise removal`
      );
    }
    for (const reason of [
      "drop_changed",
      "drop_amount_changed",
      "world_drop_item_instances_pending",
      "database_error",
    ]) {
      assert.equal(
        DropContracts.isPostgresDropPickupCollectedFailure({ ok: false, reason, drop_status: "active" }),
        false,
        `reason=${reason} must not authorise removal`
      );
    }
    assert.equal(DropContracts.isPostgresDropPickupCollectedFailure({ ok: true }), false);
  });

  check("retryable failures are reported as retryable", () => {
    assert.equal(
      DropContracts.isPostgresDropPickupRetryableFailure({
        ok: false,
        reason: "world_drop_item_instances_pending",
      }),
      true
    );
    assert.equal(
      DropContracts.isPostgresDropPickupRetryableFailure({
        ok: false,
        reason: "drop_not_available",
        drop_status: "picked_up",
      }),
      false
    );
  });

  check("the pending-instance rejection does not claim the item is gone", () => {
    /** @type {any} */
    const helperConfig = {
      itemDatabase: {
        CATEGORY_TO_FIELD: {},
        FIELD_TO_CATEGORY: {},
        hasItem: () => true,
        getStackLimit: () => 1,
        canStoreItemInCategory: () => true,
      },
      inventoryContracts: {},
      clampString: (/** @type {any} */ value) => String(value || ""),
      clampInteger: (/** @type {any} */ value) => Number(value || 0),
      cleanAccountName: (/** @type {any} */ value) => String(value || ""),
      getInventoryCount: () => 0,
      makeRequestId: () => "",
      resolveInventoryCategory: (/** @type {any} */ _id, /** @type {any} */ category) => String(category || ""),
    };
    const helpers = InventoryTransactionHelpers.createServerInventoryTransactionHelpers(helperConfig);
    const message = helpers.getPostgresInventoryFailureMessage({
      reason: "world_drop_item_instances_pending",
      item_type: "pickaxe",
    });
    assert.ok(message.includes("still in the world"), `unexpected message: ${message}`);
    assert.ok(!message.includes("Tracked item data is missing"), "must not reuse the item-loss wording");
  });

  console.log("");
  if (failures > 0) {
    console.error(`${failures} of ${checks} drop pickup checks failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`All ${checks} drop pickup item-loss checks passed.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
