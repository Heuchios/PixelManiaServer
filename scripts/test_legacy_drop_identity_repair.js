"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runtime = process.env.QUEST_TEST_PGLITE_PATH || "@electric-sql/pglite";
const { PGlite } = require(runtime);
const extension = name => require(path.isAbsolute(runtime) ? path.join(runtime, `dist/contrib/${name}.cjs`) : `@electric-sql/pglite/contrib/${name}`)[name];
const PostgresStore = require("../postgres_store");
const { digest, snapshot, inspectReferences, validatePlan, repairPlan } = require("./repair_legacy_drop_identities");
const { auditWorldDropIdentities } = require("./audit_world_drop_identities");

async function main() {
  const db = new PGlite({ extensions: { citext: extension("citext"), pgcrypto: extension("pgcrypto") } });
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, "../docs/postgres_security_foundation.sql"), "utf8"));
    const store = new PostgresStore({ enabled: false, schema: "pixelmania", logger: () => {} });
    store.pool = { query: (sql, args) => args ? db.query(sql, args) : db.exec(sql).then(r => r.at(-1)) };
    store.enabled = true; store.ready = true; store.degraded = false;
    await store.ensureInventorySchema();
    await store.ensurePersistenceSchema();
    await store.ensureProgressionSchema();
    store.progressionReady = true;
    store.withTransaction = work => db.transaction(async tx => {
      store.beginIdentityCache(tx);
      try { return await work(tx); } finally { store.endIdentityCache(tx); }
    });
    const world = "LEGACYTEST";
    const worldId = (await db.query("INSERT INTO pixelmania.worlds (world_name) VALUES ($1) RETURNING world_id", [world])).rows[0].world_id;
    await store.upsertWorldDropRow(db, worldId, { drop_id: "old-snow", item_type: "snow_block", item_category: "block", amount: 3, x: 32, y: 32 }, { source: "world_state_mirror", action: "mirror", mirrored_from_world_state: true });
    const makePlan = async () => {
      const drops = (await db.query("SELECT * FROM pixelmania.world_drops WHERE world_id=$1 ORDER BY drop_id", [worldId])).rows.map(snapshot);
      return { version: 1, world, drops, sha256: digest({ world, drops }) };
    };
    const plan = await makePlan();
    assert.equal((await auditWorldDropIdentities(db, store)).mismatched_drops, 1);
    assert.throws(() => validatePlan(plan, "forged"), /hash/);
    const inventoryOrigin = structuredClone(plan);
    inventoryOrigin.drops[0].metadata.origin_source = "drop_inventory_item";
    inventoryOrigin.sha256 = digest({ world, drops: inventoryOrigin.drops });
    assert.throws(() => validatePlan(inventoryOrigin, inventoryOrigin.sha256), /missing provenance/);
    const entry = { account_username: "repair-tester", world, drop_id: "old-snow", item_type: "snow_block", item_category: "block", amount: 1, allow_world_drop_repair: true };
    assert.equal((await store.applyDropPickupTransaction(entry)).reason, "world_drop_item_instances_pending");

    const ledger = store.recordTransactionLedger.bind(store);
    store.recordTransactionLedger = async () => { throw new Error("injected audit failure"); };
    await assert.rejects(db.transaction(tx => repairPlan(tx, store, plan, plan.sha256, "test")), /injected audit failure/);
    assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.item_instances")).rows[0].count), 0, "All created identities roll back on audit failure");
    assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.admin_actions")).rows[0].count), 0);
    store.recordTransactionLedger = ledger;
    const result = await db.transaction(tx => repairPlan(tx, store, plan, plan.sha256, "test legacy recovery"));
    assert.equal(result.instance_count, 3, "Repair the entire outstanding stack before partial pickup");
    assert.equal((await auditWorldDropIdentities(db, store)).mismatched_drops, 0);
    assert.deepEqual((await makePlan()).drops, plan.drops, "No drop count, position, status or metadata replacement");
    assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.inventory")).rows[0].count), 0, "Recovery never grants items directly to an inventory");
    assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.admin_actions")).rows[0].count), 1);
    assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.transaction_ledger WHERE transaction_type='ADMIN_WORLD_DROP_IDENTITY_REPAIR'")).rows[0].count), 3);
    await assert.rejects(db.transaction(tx => repairPlan(tx, store, plan, plan.sha256, "repeat")), /Existing item identity/);
    for (let i = 0; i < 3; i++) {
      const pickup = await store.applyDropPickupTransaction({ ...entry, request_id: `pickup-${i}`, allow_world_drop_repair: false });
      assert.equal(pickup.ok, true, JSON.stringify(pickup));
    }
    assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE item_type='snow_block'")).rows[0].amount), 3);
    assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.item_instances")).rows[0].count), 3, "Pickups only transfer repaired identities");
    assert.equal((await store.applyDropPickupTransaction(entry)).ok, false, "Collected drops cannot pay twice");
    await assert.rejects(db.transaction(tx => repairPlan(tx, store, plan, plan.sha256, "stale")), /Drop state changed/);

    // A record in another world/owner/location still prevents reminting.
    await db.query("UPDATE pixelmania.item_instances SET world_id=NULL, state='consumed', current_location='unknown'");
    const evidence = await inspectReferences(db, store, ["old-snow"]);
    assert.ok(evidence["old-snow"].includes("item_instances"));
    assert.ok(evidence["old-snow"].includes("item_instance_events"));
    assert.ok(evidence["old-snow"].includes("item_transactions"));
    assert.ok(evidence["old-snow"].includes("transaction_ledger"));

    // Real SQL: newly generated rewards survive repeated snapshot mirroring,
    // transfer existing identities on pickup, and cannot be recreated after
    // their current metadata/world changes (the immutable event still proves it).
    for (const [item, category, amount, source, action] of [
      ["snow_block", "block", 3, "seed_harvest", "harvest_drop"],
      ["serpent_staff", "tool", 1, "seed_harvest", "harvest_drop"],
      ["sakura_sword", "tool", 1, "world_block_break", "break_drop"],
      ["snow_block", "block", 2, "server_event", "drop_create"],
    ]) {
      const dropId = `${source}-${item}`;
      const drop = { drop_id: dropId, item_type: item, item_category: category, amount, x: 64, y: 96 };
      await db.transaction(async tx => {
        await store.mirrorWorldDropsState(tx, worldId, { drops: [drop] });
        await store.recordTrackedDropsForWorldChange(tx, worldId, { source_type: source, action, block_type: "dirt", details: drop });
      });
      await store.mirrorWorldDropsState(db, worldId, { drops: [drop] });
      const row = (await db.query("SELECT metadata FROM pixelmania.world_drops WHERE drop_id=$1", [dropId])).rows[0];
      assert.equal(row.metadata.origin_source, source);
      const before = Number((await db.query("SELECT count(*) FROM pixelmania.item_instances")).rows[0].count);
      for (let i = 0; i < amount; i++) {
        const result = await store.applyDropPickupTransaction({ ...entry, drop_id: dropId, item_type: item, item_category: category, request_id: `${dropId}-${i}`, allow_world_drop_repair: false });
        assert.equal(result.ok, true, JSON.stringify(result));
      }
      assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.item_instances")).rows[0].count), before);
      // Simulate an old snapshot plus an item subsequently consumed/redropped.
      await db.query("UPDATE pixelmania.item_instances SET world_id=NULL, state='consumed', current_location='unknown', metadata='{}' WHERE metadata->>'drop_id'=$1", [dropId]);
      await store.mirrorWorldDropsState(db, worldId, { drops: [drop] });
      const blocked = await store.applyDropPickupTransaction({ ...entry, drop_id: dropId, item_type: item, item_category: category, request_id: `${dropId}-replay` });
      assert.equal(blocked.reason, "world_drop_item_instances_pending", JSON.stringify(blocked));
      assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.item_instances")).rows[0].count), before);
    }

    // A proven server-origin stack missing all identities must be rebuilt in
    // full on the first partial pickup; all later pickups reuse those identities.
    await store.upsertWorldDropRow(db, worldId, { drop_id: "repair-stack", item_type: "snow_block", item_category: "block", amount: 4 }, { source: "seed_harvest", action: "harvest_drop" });
    const countBefore = Number((await db.query("SELECT count(*) FROM pixelmania.item_instances")).rows[0].count);
    for (let i = 0; i < 4; i++) {
      const result = await store.applyDropPickupTransaction({ ...entry, drop_id: "repair-stack", request_id: `partial-repair-${i}` });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.item_instances")).rows[0].count), countBefore + 4);
    }
    console.log("LEGACY_DROP_REPAIR_PASS: real SQL rollback, evidence guards, audit, stale/repeat rejection, partial pickup and conservation");
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
