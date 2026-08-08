#!/usr/bin/env node
// @ts-check
"use strict";

/**
 * In-memory PostgreSQL double for behaviour tests.
 *
 * Extracted verbatim from check_drop_pickup_item_loss.js so that new behaviour tests do
 * not each grow their own copy. A hand-copied second version of this file is exactly how
 * the 43 tsconfigs and the drifted InventoryLedgerEntry happened -- one shared copy, or
 * the copies disagree about what the schema does.
 *
 * FIDELITY CAVEAT, and it matters: this understands only the statements the transactions
 * under test issue. An unmatched statement resolves to an empty result. That is safe for
 * statements nothing depends on, and silently wrong for statements something does depend
 * on -- so a test that exercises a NEW code path must confirm its statements are matched
 * here before trusting a green result. `fake.log` holds every statement issued, which is
 * the way to check.
 *
 * Statements currently modelled: BEGIN / COMMIT / ROLLBACK, upserts into accounts,
 * players and worlds, world_drops (SELECT FOR UPDATE, INSERT, amount UPDATE), inventory
 * (SELECT FOR UPDATE, UPDATE, INSERT), item_transactions INSERT, and item_instances
 * (SELECT FOR UPDATE on dropped state, three count(*) probes, INSERT).
 */

const crypto = require("node:crypto");

const PostgresStore = require("../postgres_store.js");

/**
 * The ids the double hands back from the account/player/world upserts. Tests pass their
 * own fixtures so the double carries no test's constants.
 *
 * @typedef {object} DoubleIdentity
 * @property {string} accountId
 * @property {string} playerId
 * @property {string} worldId
 */

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
 * @param {DoubleIdentity} identity
 * @returns {any}
 */
function createFakePool(initialState, identity) {
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
      return { rows: [{ account_id: identity.accountId }], rowCount: 1 };
    }
    if (sql.includes('INTO "pixelmania"."players"')) {
      return { rows: [{ player_id: identity.playerId }], rowCount: 1 };
    }
    if (sql.includes('INTO "pixelmania"."worlds"')) {
      return { rows: [{ world_id: identity.worldId }], rowCount: 1 };
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
 * @param {DoubleIdentity} identity
 * @returns {{ store: any, fake: any }}
 */
function createStore(initialState, identity) {
  const fake = createFakePool(initialState, identity);
  /** @type {any} */
  const store = new PostgresStore({ enabled: false, schema: "pixelmania", logger: () => {} });
  store.enabled = true;
  store.ready = true;
  store.degraded = false;
  store.pool = fake.pool;
  return { store, fake };
}

module.exports = {
  cloneState,
  createFakePool,
  createStore,
};
