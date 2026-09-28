// Execute real PostgreSQL constraints, migrations and transactions in an isolated
// WASM database. No .env, network connection, or existing player data is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtime = process.env.MAGNET_TEST_PGLITE_PATH || process.env.QUEST_TEST_PGLITE_PATH || '@electric-sql/pglite';
const { PGlite } = require(runtime);
const extension = name => require(path.isAbsolute(runtime) ? path.join(runtime, `dist/contrib/${name}.cjs`) : `@electric-sql/pglite/contrib/${name}`)[name];
const PostgresStore = require('../postgres_store');
const { createMagnetSystem } = require('../magnet_machine');
const ItemDatabase = require('../server_item_database');

async function main() {
  const db = new PGlite({ extensions: { citext: extension('citext'), pgcrypto: extension('pgcrypto') } });
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../docs/postgres_security_foundation.sql'), 'utf8'));
    const store = new PostgresStore({ enabled: false, schema: 'pixelmania', logger: () => {} });
    store.pool = { query: (sql, args) => args ? db.query(sql, args) : db.exec(sql).then(r => r.at(-1)) };
    store.enabled = true; store.ready = true; store.degraded = false;
    await store.ensureInventorySchema();
    await store.ensurePersistenceSchema();
    await store.ensureProgressionSchema();
    store.progressionReady = true;
    // Prove the startup migration upgrades an already-existing old constraint.
    await db.exec(`ALTER TABLE pixelmania.item_transactions DROP CONSTRAINT item_transactions_source_check;
      ALTER TABLE pixelmania.item_transactions ADD CONSTRAINT item_transactions_source_check CHECK (source IN ('admin','system'));`);
    await store.ensurePersistenceSchema();
    await store.ensurePersistenceSchema();
    store.withTransaction = work => db.transaction(async tx => {
      store.beginIdentityCache(tx);
      try { return await work(tx); } finally { store.endIdentityCache(tx); }
    });
    const owner = { id: 'sql-owner', account_username: 'magnet-sql-test', world: 'MAGNETSQL' };
    const ownership = { require_owner: true, server_instance: 'magnet-sql', ownership_token: 'magnet-sql-token', ownership_epoch: 1 };
    const claimed = await store.claimWorldPersistenceOwnership(owner.world, ownership);
    assert.equal(claimed.ok, true, JSON.stringify(claimed));
    let inventory = { dirt: 40 }, last, revision = 0, sequence = 0;
    const world = { foreground: new Map([['1,2', { x: 1, y: 2, block_type: 'magnet_machine' }]]), interactions: new Map(), removed_foreground: new Map() };
    const copy = value => structuredClone(value);
    const snapshot = () => ({ world_name: owner.world, world_revision: ++revision, foreground: [...world.foreground.values()], interactions: [...world.interactions.values()], seeds: [], drops: [] });
    const persist = (action, deltas = [], source = 'magnet_machine') => store.applyInventoryDeltaTransaction({
      account_username: owner.account_username, world: owner.world, request_id: `sql-${++sequence}`, source, action, deltas, world_state: snapshot(), metadata: { world_persistence: ownership },
    });
    const seeded = await persist('give', [{ item_type: 'dirt', item_category: 'block', delta: 40 }], 'admin');
    assert.equal(seeded.ok, true, JSON.stringify(seeded));
    const system = createMagnetSystem({
      ItemDatabase, ensureWorldState: () => world, cleanWorld: w => w, cloneJson: copy,
      acquireLiveActionLock: async () => ({ acquired: true }), releaseLiveActionLock: () => {},
      makeRequestId: d => d.request_id, makeAuditId: () => `sql-machine-${++sequence}`,
      sendActionRejected: (_s, _a, message) => { last = { ok: false, message }; },
      sendInventoryTransactionResult: (_s, result) => { last = result; }, queueWorldUpdateBroadcast: () => {},
      requireAuthenticated: () => true, requireSameWorld: () => true, rejectIfWorldBanned: async () => false,
      tradeByPlayerId: new Map(), getTransactionGrid: d => d, isPlayerNearGrid: () => true,
      isWorldLocked: () => true, canPlayerControlWorldLock: () => true,
      ensureWritablePlayerState: () => inventory, getInventoryCount: (s, id) => s[id] || 0,
      canAddItemToState: (s, id, _cat, n) => (s[id] || 0) + n <= ItemDatabase.getStackLimit(id),
      addItemToState: (s, id, _cat, n) => { s[id] = (s[id] || 0) + n; },
      spendItemFromState: (s, id, _cat, n) => { if ((s[id] || 0) < n) return false; s[id] -= n; return true; },
      buildWorldObjectChangeEntry: (_s, _p, _w, update) => update,
      commitWorldStateWithBlockChanges: () => persist('magnet_update'),
      commitPlayerInventoryState: async (_s, _p, _name, before, after, opts) => {
        const deltas = [...new Set([...Object.keys(before), ...Object.keys(after)])].map(id => ({
          item_type: id, item_category: ItemDatabase.getItemDefinition(id).category, delta: (after[id] || 0) - (before[id] || 0),
        })).filter(d => d.delta !== 0);
        const result = await persist(opts.action, deltas, opts.source);
        if (result.ok) inventory = after;
        return { ...result, state: after, deltas, postgres_committed: result.ok };
      },
      persistWorldStateAfterInventoryCommit: () => {}, buildInventoryDeltaClientPayloads: () => [],
      applyBlockUpdateToWorldState: (_w, u) => { const key = `${u.x},${u.y}`; world.foreground.delete(key); world.interactions.delete(key); world.removed_foreground.set(key, u); },
    });
    async function request(action, extra = {}, ok = true) {
      await system.handle({}, owner, { action, world: owner.world, x: 1, y: 2, request_id: `request-${++sequence}`, ...extra });
      assert.equal(last.ok, ok, `${action}: ${JSON.stringify(last)}`);
    }
    const persistedStock = async () => (await db.query("SELECT world_state FROM pixelmania.worlds WHERE world_name='MAGNETSQL'")).rows[0].world_state.interactions[0].count;
    await request('magnet_select', { item_id: 'dirt' });
    await request('magnet_update', { collecting: true, building: true });
    await request('magnet_deposit', { amount: 20 });
    assert.equal(inventory.dirt, 20); assert.equal(await persistedStock(), 20);
    await request('magnet_withdraw', { amount: 6 });
    assert.equal(inventory.dirt, 26); assert.equal(await persistedStock(), 14);
    await request('magnet_remote');
    await request('magnet_remote');
    const instances = (await db.query("SELECT public_item_instance_id, state, current_location, created_by_source FROM pixelmania.item_instances WHERE item_type='magnet_machine_remote'")).rows;
    assert.equal(instances.length, 1); assert.match(instances[0].public_item_instance_id, /^PM-ITEM-/);
    assert.equal(instances[0].state, 'active'); assert.equal(instances[0].current_location, 'inventory');
    assert.equal(instances[0].created_by_source, 'magnet_machine');
    // Fail after inventory/ledger writes, at the world snapshot write boundary.
    await db.exec(`CREATE FUNCTION pixelmania.fail_magnet_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected save failure'; END $$;
      CREATE TRIGGER fail_magnet_save BEFORE UPDATE OF world_state ON pixelmania.worlds FOR EACH ROW EXECUTE FUNCTION pixelmania.fail_magnet_save();`);
    await request('magnet_withdraw', { amount: 3 }, false);
    assert.equal(inventory.dirt, 26); assert.equal(system.get(owner.world, 1, 2).count, 14); assert.equal(await persistedStock(), 14);
    assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE item_type='dirt'")).rows[0].amount), 26);
    await db.exec('DROP TRIGGER fail_magnet_save ON pixelmania.worlds');
    await request('magnet_withdraw', { amount: 14 });
    await request('magnet_remove');
    assert.equal(inventory.dirt, 40); assert.equal(inventory.magnet_machine, 1);
    const sources = (await db.query("SELECT DISTINCT source FROM pixelmania.item_transactions WHERE action LIKE 'magnet_%'")).rows;
    assert.deepEqual(sources, [{ source: 'magnet_machine' }]);
    console.log('MAGNET_POSTGRES_OK: startup migration, deposit, withdraw, remote PM-ITEM creation/reuse, late-save rollback and empty-machine removal');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
