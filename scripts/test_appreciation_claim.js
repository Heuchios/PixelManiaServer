// Real PostgreSQL transactions in a disposable WASM database; no player data or .env.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtime = process.env.QUEST_TEST_PGLITE_PATH || '@electric-sql/pglite';
const { PGlite } = require(runtime);
const extension = name => require(path.isAbsolute(runtime) ? path.join(runtime, `dist/contrib/${name}.cjs`) : `@electric-sql/pglite/contrib/${name}`)[name];
const PostgresStore = require('../postgres_store');
const ItemDatabase = require('../server_item_database');
const { createServerInventoryEconomyRoutes } = require('../server_inventory_economy_routes');
const { ensureSchema } = require('../server_quest_store');

async function main() {
  const db = new PGlite({extensions: {citext: extension('citext'), pgcrypto: extension('pgcrypto')}});
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../docs/postgres_security_foundation.sql'), 'utf8'));
    const store = new PostgresStore({enabled: false, schema: 'pixelmania', logger: () => {}});
    store.pool = {query: (sql, args) => args ? db.query(sql, args) : db.exec(sql).then(r => r.at(-1))};
    store.enabled = true; store.ready = true; store.degraded = false;
    await store.ensureInventorySchema();
    await store.ensurePersistenceSchema();
    await store.ensurePersistenceSchema();
    await store.ensureProgressionSchema();
    await ensureSchema(store);
    store.progressionReady = true;
    store.withTransaction = work => db.transaction(async tx => {
      store.beginIdentityCache(tx);
      try { return await work(tx); } finally { store.endIdentityCache(tx); }
    });
    const listing = {item_id: 'appreciation_wings', item_category: 'back', amount: 1, price: 0, once_per_account: true};
    let state = {back_inventory: {}, currency_inventory: {gem: 0}, shop_claims: []};
    let full = false, last;
    const count = (s, id, cat) => s[ItemDatabase.getInventoryFieldForCategory(cat)]?.[id] || 0;
    const deps = {
      ItemDatabase, SHOP_CATALOG: new Map([['appreciation_wings', listing]]), MAX_SHOP_PRICE: 999999,
      clampString: s => String(s), clampInteger: (v, min, max) => Math.min(max, Math.max(min, Math.trunc(v))),
      makeRequestId: d => d.request_id, ensureWritablePlayerState: () => state, cloneJson: structuredClone,
      resolveInventorySlotCount: () => 20, getInventoryCount: count,
      spendItemFromState: () => { throw new Error('A free gift must not spend gems'); },
      canAddItemToState: () => !full,
      addItemToState: (s, id, cat, n) => { const f = ItemDatabase.getInventoryFieldForCategory(cat); s[f] ||= {}; s[f][id] = count(s,id,cat) + n; return true; },
      makeAuditId: () => 'gift-test', combineRewardEntries: r => r, buildInventoryDeltaClientPayloads: d => d,
      logShopPurchase: () => {}, logItemLedgerForState: () => {}, logRewardLedgers: () => {},
      sendInventoryTransactionRejected: (_s, _d, message) => { last = {ok: false, message}; },
      sendInventoryTransactionResult: (_s, result) => { last = result; },
      commitPlayerInventoryState: async (_s, player, username, before, after, opts) => {
        const delta = count(after,'appreciation_wings','back') - count(before,'appreciation_wings','back');
        const result = await store.applyInventoryDeltaTransaction({account_username: username, world: player.world,
          source: opts.source, action: opts.action, request_id: opts.request_id, metadata: opts.metadata,
          player_state: after, deltas: [{item_type: 'appreciation_wings', item_category: 'back', delta}]});
        if (result.ok) state = after;
        return {...result, state: after, deltas: result.ledger_entries || [], postgres_committed: result.ok};
      },
    };
    const routes = createServerInventoryEconomyRoutes(deps);
    const player = {account_username: 'gift-test', world: 'GIFTTEST'};
    const buy = async (request_id, extra = {}) => { await routes.handleShopBuyTransaction({}, player, {request_id, item_id: 'appreciation_wings', amount: 1, price: 0, ...extra}); return last; };
    assert.equal((await buy('tamper', {amount: 2})).ok, false);
    full = true;
    assert.equal((await buy('full')).ok, false);
    assert.equal((await db.query('SELECT * FROM pixelmania.account_shop_claims')).rows.length, 0);
    full = false;
    const recordLedger = store.recordTransactionLedger.bind(store);
    store.recordTransactionLedger = async () => { throw new Error('simulated ledger write failure'); };
    assert.equal((await buy('failed')).ok, false);
    assert.equal((await db.query('SELECT * FROM pixelmania.account_shop_claims')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM pixelmania.inventory')).rows.length, 0, 'Failed award rolls back inventory too');
    store.recordTransactionLedger = recordLedger;
    assert.equal((await buy('first')).ok, true, JSON.stringify(last));
    assert.deepEqual(last.shop_claims, ['appreciation_wings']);
    assert.equal(state.back_inventory.appreciation_wings, 1);
    assert.equal((await buy('duplicate')).ok, false);
    // Bypass the in-memory hint with stale state and new request IDs: the DB must still refuse.
    state = {back_inventory: {}, currency_inventory: {gem: 0}, shop_claims: []};
    const results = await Promise.all(['race-a', 'race-b'].map(id => deps.commitPlayerInventoryState({}, player, player.account_username, state,
      {...state, back_inventory: {appreciation_wings: 1}}, {source: 'shop', action: 'shop_purchase', request_id: id, metadata: {listing_id: 'appreciation_wings', once_per_account: true}})));
    assert(results.every(r => !r.ok && r.reason === 'shop_already_claimed'));
    const loaded = await store.loadPlayerState(player.account_username);
    assert(loaded.ok, JSON.stringify(loaded));
    assert.deepEqual(loaded.state.shop_claims, ['appreciation_wings']);
    const all = await store.loadPlayerStates();
    assert.deepEqual(all[0][1]?.shop_claims || all[0]?.state?.shop_claims || all[0]?.shop_claims, ['appreciation_wings']);
    assert.equal((await db.query("SELECT * FROM pixelmania.item_instances WHERE item_type='appreciation_wings'")).rows.length, 1);
    assert.equal((await db.query("SELECT * FROM pixelmania.transaction_ledger WHERE item_type='appreciation_wings' AND status='success'")).rows.length, 1);
    // The claim survives the item leaving inventory.
    await db.exec("UPDATE pixelmania.inventory SET amount=0 WHERE item_type='appreciation_wings'");
    assert.equal((await buy('after-removal')).ok, false);
    assert.equal((await db.query('SELECT * FROM pixelmania.account_shop_claims')).rows.length, 1);
    const newClaim = request_id => store.applyInventoryDeltaTransaction({account_username:'second-gift-account', world:'GIFTTEST',
      source:'shop', action:'shop_purchase', request_id, metadata:{listing_id:'appreciation_wings',once_per_account:true},
      deltas:[{item_type:'appreciation_wings',item_category:'back',delta:1}], player_state:{back_inventory:{appreciation_wings:1},shop_claims:['appreciation_wings']}});
    const concurrent = await Promise.all([newClaim('concurrent-a'),newClaim('concurrent-b')]);
    assert.equal(concurrent.filter(r=>r.ok).length, 1, 'Concurrent first claims award once');
    assert.equal(concurrent.filter(r=>r.reason==='shop_already_claimed').length, 1);
    assert.equal((await db.query('SELECT * FROM pixelmania.account_shop_claims')).rows.length, 2, 'Each account has its own claim');
    console.log('APPRECIATION_CLAIM_PASS: free award, tampering, full inventory, rollback, duplicate/racing requests, restart, item instance and ledger');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
