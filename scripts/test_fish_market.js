"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Market = require("../server_fish_market");
const Store = require("../server_fish_market_store");
const Items = require("../server_item_database");

async function run() {
  assert.deepEqual(Market.mergeSpecies({pond_fish_small: 13, pond_fish_med: 24, pond_fish_large: 57, pond_fish: 6}), {pond_fish_large: 100});
  assert.throws(() => Market.mergeSpecies({pond_fish_small: 20000, pond_fish_large: 1}), /exceeds/);
  const speciesWorld = {safe:{slots:[{item_id:'bone_fish_small',amount:17}]},vend:{item_id:'bone_fish_med',stock:28}};
  assert.equal(Market.migrateWorldSpecies(speciesWorld), true);
  assert.equal(speciesWorld.safe.slots[0].item_id, 'bone_fish_large');
  assert.equal(speciesWorld.safe.slots[0].amount,17);
  assert.equal(speciesWorld.vend.stock,28);
  assert.equal(Market.migrateWorldSpecies(speciesWorld), false);
  for (const [id,target] of Object.entries(Market.SPECIES_ALIASES)) {
    assert.equal(Items.ITEMS[id].hidden,true);
    assert.equal(Items.ITEMS[target].hidden,false);
    assert.ok(!/^(Small|Medium|Large) /.test(Items.ITEMS[target].display_name));
  }
  assert.equal(Market.saleValue([{ amount: 57, price_cents: 200 }]), 12);
  assert.equal(Market.saleValue([{ amount: 50, price_cents: 200 }]), 10);
  assert.equal(Market.saleValue([{ amount: 1, price_cents: 200 }, { amount: 1, price_cents: 200 }]), 1);
  assert.equal(Market.saleValue([{ amount: 29, price_cents: 1000 }]), 29);
  for (const invalid of [NaN, Infinity, -1, 0, 0.01, 5.71, 2000.1, "5.7", true, {}]) assert.equal(Market.kgToUnits(invalid), 0);
  assert.equal(Market.kgToUnits(5.7), 57);
  assert.equal(Market.kgToUnits(0.1), 1);
  assert.equal(Market.kgToUnits(2000), 20000);
  assert.equal(Market.catchAmount(() => 0), 1);
  assert.equal(Market.catchAmount(() => 1), 1500);
  for (let i = 0; i < 10000; i++) {
    const weight = Market.catchAmount(); assert.ok(Number.isInteger(weight) && weight >= 1 && weight <= 1500);
  }
  const migrated = Market.migratePlayer({ fish_inventory: { pond_fish_large: 7 } });
  assert.equal(migrated.fish_inventory.pond_fish_large, 70);
  assert.equal(Market.migratePlayer(migrated).fish_inventory.pond_fish_large, 70);
  const holdings = { safe: { slots: [{ item_id: "pond_fish_large", amount: 7 }, { item_id: "dirt", amount: 2 }] },
    vending: { item_id: "pond_fish_large", stock: 10, amount_per_sale: 2 }, drops: [{ item_type: "pond_fish_large", amount: 400 }] };
  assert.equal(Market.migrateWorldHoldings(holdings, id => Items.ITEMS[id]?.category === "fish"), true);
  assert.equal(holdings.safe.slots[0].amount, 70); assert.equal(holdings.safe.slots[1].amount, 2);
  assert.equal(holdings.vending.stock, 100); assert.equal(holdings.vending.amount_per_sale, 20);
  assert.equal(holdings.drops[0].amount, 4000);
  assert.equal(Market.migrateWorldHoldings(holdings, id => Items.ITEMS[id]?.category === "fish"), false);
  const settings = Market.policy(Items.ITEMS.pond_fish_large);
  const row = { item_id: "pond_fish_large", supply: settings.target, updated_ms: 1000, revision: 0 };
  const base = Market.quote(row, settings, 1000);
  assert.equal(base.price_cents, 200);
  assert.ok(Market.quote({ ...row, supply: row.supply * 2 }, settings, 1000).price_cents < 200);
  assert.ok(Market.quote(row, settings, 1000 + settings.halfLife).price_cents > 200);
  assert.equal(Market.quote({ ...row, supply: 1e15 }, settings, 1000).price_cents, settings.min);
  assert.equal(Market.quote(row, settings, 1e15).price_cents, settings.max);
  for (const definition of Object.values(Items.ITEMS).filter(d => d.category === "fish")) {
    assert.equal(definition.stack_limit, 20000);
    const p = Market.policy(definition); assert.ok(p.min <= p.base && p.base <= p.max);
  }
  // Execute the actual route with mocked persistence and an exact authoritative inventory.
  const server = fs.readFileSync(require.resolve("../server"), "utf8");
  const start = server.indexOf("async function handleFishMongerTransaction(");
  const end = server.indexOf("function getTransactionDropPosition", start);
  let state; let result; let commits; let released;
  const wire = require('../server_inventory_transaction_helpers').createServerInventoryTransactionHelpers({
    cleanAccountName: String, inventoryContracts: require('../server_inventory_contracts')
  });
  const context = {
    FishMarket: Market, FishMarketStore: { quotes: async () => ({ pond_fish_large: base }), commitLocal: () => {} },
    ItemDatabase: Items, POSTGRES_ENABLED: false, POSTGRES_AUTHORITATIVE: false, tradeByPlayerId: new Map(),
    makeRequestId: d => d.request_id || "request", getTransactionWorldName: () => "START", cleanWorld: v => v,
    rejectIfWorldBanned: async () => false, getTransactionGrid: () => ({ x: 1, y: 1 }), validateFishMongerAccess: () => ({ x: 1, y: 1 }),
    acquirePlayerInventoryLocks: async () => ({ acquired: true }), releasePlayerInventoryLocks: () => { released++; },
    ensureWritablePlayerState: () => state, isPostgresAuthoritativeReady: () => false,
    isSellableFishItem: id => Items.ITEMS[id]?.category === "fish", clampString: s => String(s), cloneJson: o => JSON.parse(JSON.stringify(o)),
    getInventoryCount: (s, id, category) => (category === "fish" ? s.fish_inventory[id] : s.currency_inventory[id]) || 0,
    spendItemFromState: (s, id, category, amount) => { if (s.fish_inventory[id] < amount) return false; s.fish_inventory[id] -= amount; return true; },
    addItemToState: (s, id, category, amount) => { s.currency_inventory[id] += amount; return true; },
    makeAuditId: () => "sale", commitPlayerInventoryState: async (socket, player, name, before, after) => { commits++; state = after; return { ok: true, state, deltas: [], postgres_committed: false }; },
    buildInventoryDeltaClientPayloads: () => [], logItemLedgerForState: () => {}, logSecurityEvent: () => {},
    sendInventoryTransactionResult: (socket, data) => { result = JSON.parse(JSON.stringify(wire.buildInventoryTransactionResultResponse(data))); },
    sendInventoryTransactionRejected: (socket, data, message) => { result = { ok: false, message }; },
  };
  vm.createContext(context); vm.runInContext(server.slice(start, end), context);
  const sell = async (data, gems = 0) => {
    state = { fish_inventory: { pond_fish_large: 57 }, currency_inventory: { gem: gems } }; commits = 0; released = 0;
    await context.handleFishMongerTransaction({}, { id: "p", world: "START", account_username: "p" },
      { action: "fish_monger_sell", weight_kg: 5.7, item_id: "pond_fish_large", expected_prices: { pond_fish_large: 200 }, ...data });
    assert.equal(released, 1); return result;
  };
  assert.equal((await sell({})).total_gems, 12); assert.equal(state.fish_inventory.pond_fish_large, 0); assert.equal(state.currency_inventory.gem, 12);
  assert.equal((await sell({ weight_kg: 0.1 })).total_gems, 1); assert.equal(state.fish_inventory.pond_fish_large, 56);
  for (const data of [{ weight_kg: 5.8 }, { weight_kg: -1 }, { weight_kg: 0.01 }]) {
    assert.equal((await sell(data)).ok, false); assert.equal(commits, 0); assert.equal(state.fish_inventory.pond_fish_large, 57);
  }
  for (const data of [{expected_prices:{pond_fish_large:100}}, {expected_prices:{}}, {expected_prices:null}]) {
    assert.equal((await sell(data)).ok,true, 'A stale or missing displayed quote must not block a sale');
    assert.equal(result.total_gems,12);
  }
  assert.equal((await sell({}, Items.getStackLimit("gem"))).ok, false); assert.equal(commits, 0);
  assert.equal((await sell({ action: "fish_monger_sell_all" })).total_gems, 12);
  assert.equal((await sell({ action: "fish_monger_prices" })).ok, true); assert.equal(commits, 0);
  assert.equal(result.fish_market.pond_fish_large.price_cents,200, 'Price response must survive the real wire serializer');
  const originalCommit = context.commitPlayerInventoryState;
  context.isPostgresAuthoritativeReady = () => true;
  context.postgresStore = {};
  context.commitPlayerInventoryState = async (socket,player,name,before,after) => {
    assert.equal(after.currency_inventory.gem,1,'Route must defer final payout to PostgreSQL');
    const settled = [{...base,price_cents:125,amount:57}];
    after.currency_inventory.gem = Market.saleValue(settled);
    state=after;commits++;
    return {ok:true,state,deltas:[],postgres_committed:true,fish_market_sales:settled};
  };
  assert.equal((await sell({})).total_gems,8,'Response must report settled payout rather than the 12-gem estimate');
  assert.equal(result.rewards[0].amount,8);
  assert.match(result.message,/8 gems/);
  context.commitPlayerInventoryState = originalCommit;
  context.isPostgresAuthoritativeReady = () => false;
  const completeStart = server.indexOf('async function handleFishingCompleteTransaction(');
  const completeEnd = server.indexOf('function isSellableFishItem(', completeStart);
  const sessions = new Map();
  Object.assign(context, {
    activeFishingSessions: sessions, clearPlayerFishingPresence:()=>{}, publishPlayerPresenceUpdate:()=>{},
    resolveInventoryCategory:()=> 'fish', getFishingXp:()=>1, grantExperienceToState:()=>({}),
    getProgressionMessage:(_,message)=>message, buildProgressionPayload:()=>({}),
    buildFishingRewardFxPayload:()=>null, getFishingRewardFxRarity:()=> 'common',
    addItemToState:(s,id,category,amount)=>{s.fish_inventory[id]=(s.fish_inventory[id]||0)+amount;return true;}
  });
  vm.runInContext(server.slice(completeStart,completeEnd),context);
  for (const rng of [0,0.4,0.5,0.8,1]) {
    const units = Market.catchAmount(()=>rng);
    context.FishMarket = {...Market,catchAmount:()=>units};
    sessions.set('p',{session_id:'catch',world:'START',expires_at:Date.now()+10000,item_id:'pond_fish_large',fish_id:'pond_fish_large',item_category:'fish'});
    state={fish_inventory:{},currency_inventory:{gem:0}};
    await context.handleFishingCompleteTransaction({}, {id:'p',world:'START',account_username:'p'}, {success:true,session_id:'catch'});
    assert.equal(result.catch_weight,units/10);
    assert.equal(result.rewards[0].amount,units);
    assert.equal(state.fish_inventory.pond_fish_large,units);
    assert.equal(result.fish_inventory_unit,'tenths_kg');
    assert.equal(result.fish_market.pond_fish_large.price_cents,200);
  }
  // Two shard clients see the same row. A queued sale reprices after the first commits.
  const realNow = Date.now;
  Date.now = () => 1000;
  let marketRow = { ...row };
  const client = { query: async (sql, args) => {
    if (sql.includes("FOR UPDATE")) return { rows: [{ ...marketRow }] };
    if (sql.startsWith("UPDATE")) { marketRow = { ...marketRow, supply: args[1], updated_ms: args[2], revision: marketRow.revision + 1 }; return {}; }
    throw Error(sql);
  } };
  const sale = { ...base, amount: 57 };
  const deltas = [{ item_type: "pond_fish_large", item_category: "fish", delta: -57 }, { item_type: "gem", item_category: "currency", delta: 12 }];
  await Store.lockSale({ table: s => s }, client, { fish_market_sales: [sale] }, deltas);
  assert.equal(marketRow.supply, settings.target + 57);
  const secondMetadata = {fish_market_sales:[{...sale,price_cents:999999}]};
  await Store.lockSale({table:s=>s},client,secondMetadata,deltas);
  assert.equal(marketRow.revision,2);
  assert.equal(secondMetadata.fish_market_sales[0].price_cents,199);
  assert.equal(deltas[1].delta,Market.saleValue(secondMetadata.fish_market_sales));
  Date.now = () => 1000 + settings.halfLife;
  const laterMetadata = {fish_market_sales:[sale]};
  await Store.lockSale({table:s=>s},client,laterMetadata,deltas);
  assert.ok(laterMetadata.fish_market_sales[0].price_cents > 200);
  assert.equal(deltas[1].delta,Market.saleValue(laterMetadata.fish_market_sales));
  Date.now = () => 1000;
  await assert.rejects(Store.lockSale({ table: s => s }, { query: async () => ({ rowCount: 0 }) },
    { fish_market_sales: [sale] }, deltas, "player", "replayed-request"), /already completed/);
  // Exercise the real transaction wrapper: an inventory failure after market writes must roll them back.
  const PostgresStore = require("../postgres_store");
  const pg = new PostgresStore({ enabled: false });
  let saved; const sqlCalls = [];
  const transactionalClient = { release() {}, query: async (sql, args) => {
    sqlCalls.push(sql);
    if (sql === "BEGIN") { saved = { ...marketRow }; return {}; }
    if (sql === "ROLLBACK") { marketRow = saved; return {}; }
    if (sql === "COMMIT") return {};
    return client.query(sql, args);
  } };
  pg.enabled = true; pg.ready = true; pg.pool = { connect: async () => transactionalClient };
  marketRow = { ...row };
  const rejected = await pg.withTransactionNow(async connection => {
    await Store.lockSale({ table: s => s }, connection, { fish_market_sales: [sale] }, deltas);
    return { ok: false, reason: "insufficient_inventory" };
  }, "fish_monger_sell");
  assert.equal(rejected.ok, false); assert.deepEqual(marketRow, row);
  assert.ok(sqlCalls.includes("ROLLBACK")); assert.ok(!sqlCalls.includes("COMMIT"));
  Date.now = realNow;
  console.log("Fish market: weights, migration, rounding, price bounds/recovery, route validation, capacity and competing quotes passed.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
