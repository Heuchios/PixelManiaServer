"use strict";
// Isolated PostgreSQL/WASM integration test; never reads game credentials.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runtime = process.env.FISHING_TEST_PGLITE_PATH || "@electric-sql/pglite";
const {PGlite} = require(runtime);
const contrib = process.env.FISHING_TEST_PGLITE_PATH ? path.join(runtime,"dist/contrib") : "@electric-sql/pglite/contrib";
const extension = name => require(process.env.FISHING_TEST_PGLITE_PATH ? path.join(contrib,name+".cjs") : contrib+"/"+name)[name];
const PostgresStore = require("../postgres_store");
const FishStore = require("../server_fish_market_store");

async function main() {
  const db = new PGlite({extensions:{citext:extension("citext"),pgcrypto:extension("pgcrypto")}});
  try {
    await db.exec(fs.readFileSync(path.join(__dirname,"../docs/postgres_security_foundation.sql"),"utf8"));
    const query = (sql,args) => args ? db.query(sql,args) : db.exec(sql).then(rows=>rows.at(-1));
    const store = new PostgresStore({enabled:false,schema:"pixelmania",logger:()=>{}});
    store.pool = {query,connect:async()=>({query,release(){}})};
    store.enabled=true;store.ready=true;store.degraded=false;
    await store.ensureInventorySchema();await store.ensurePersistenceSchema();await store.ensureProgressionSchema();
    await FishStore.ensureSchema(store);
    const connection = {query};
    const player = await store.ensurePlayerIdentity(connection,"fishingmigrationtest");
    const world = await store.ensureWorldIdentity(connection,"FISHMIGRATION");
    const state = {fish_inventory:{kraken:90,bluegill:25},lure_inventory:{hook:6,lure_pack:2},currency_inventory:{gem:100},fishing_records:{total_fishing_xp:500,rarest_catch:{fish_id:"kraken",name:"Kraken"}}};
    await query("UPDATE pixelmania.players SET player_state=$2::jsonb WHERE player_id=$1",[player,JSON.stringify(state)]);
    for (const [id,category,amount] of [["kraken","fish",90],["bluegill","fish",25],["hook","lure",6],["lure_pack","lure",2],["gem","currency",100]]) {
      await query("INSERT INTO pixelmania.inventory(player_id,item_type,item_category,amount,stack_limit) VALUES($1,$2,$3,$4,20000)",[player,id,category,amount]);
    }
    await query("INSERT INTO pixelmania.item_instances(item_type,item_category,owner_player_id,current_location) VALUES('kraken','fish',$1,'inventory')",[player]);
    await query("UPDATE pixelmania.worlds SET world_state=$2::jsonb WHERE world_id=$1",[world,JSON.stringify({blocks:[{type:"dirt",x:2,y:3}],safe:{slots:[{item_id:"kraken",amount:20},{item_id:"dirt",amount:10}]},vending:{item_type:"hook",stock:5},hanger:{fish_id:"kraken",weight:4.5}})]);
    await query("INSERT INTO pixelmania.world_drops(world_id,drop_id,item_type,item_category,amount) VALUES($1,'legacy','kraken','fish',10)",[world]);
    await query("INSERT INTO pixelmania.fish_market(item_id,supply,updated_ms) VALUES('kraken',100,1000)");
    await query("DELETE FROM pixelmania.fish_weight_migrations WHERE version=3");
    // A ledger failure must roll back every removal and the completion marker.
    const originalLedger = store.recordTransactionLedger.bind(store);
    store.recordTransactionLedger = async()=>{throw Error("injected ledger failure");};
    await assert.rejects(FishStore.ensureSchema(store),/injected ledger failure/);
    assert.equal((await query("SELECT count(*)::int AS n FROM pixelmania.inventory WHERE item_type='kraken'")).rows[0].n,1);
    assert.equal((await query("SELECT count(*)::int AS n FROM pixelmania.fish_weight_migrations WHERE version=3")).rows[0].n,0);
    store.recordTransactionLedger=originalLedger;
    await FishStore.ensureSchema(store);
    const holdings=(await query("SELECT item_type,amount FROM pixelmania.inventory WHERE player_id=$1 ORDER BY item_type",[player])).rows;
    assert.deepEqual(holdings.map(row=>[row.item_type,Number(row.amount)]),[["gem",100],["lure_pack",2]]);
    const after=(await query("SELECT player_state FROM pixelmania.players WHERE player_id=$1",[player])).rows[0].player_state;
    assert.deepEqual(after.fish_inventory,{});assert.deepEqual(after.fishing_records.rarest_catch,{});
    assert.equal(after.fishing_records.total_fishing_xp,500);assert.equal(after.fishing_catalog_version,3);
    assert.equal((await query("SELECT state FROM pixelmania.item_instances WHERE item_type='kraken'")).rows[0].state,"destroyed");
    assert.equal((await query("SELECT status FROM pixelmania.world_drops WHERE drop_id='legacy'")).rows[0].status,"removed");
    const terrain=(await query("SELECT world_state FROM pixelmania.worlds WHERE world_id=$1",[world])).rows[0].world_state;
    assert.deepEqual(terrain.blocks,[{type:"dirt",x:2,y:3}]);assert.equal(terrain.safe.slots[0].amount,0);assert.equal(terrain.safe.slots[1].amount,10);
    assert.equal((await query("SELECT count(*)::int AS n FROM pixelmania.item_transactions WHERE action='fishing_catalog_v3'")).rows[0].n,3);
    assert.equal((await query("SELECT count(*)::int AS n FROM pixelmania.transaction_ledger WHERE action='fishing_catalog_v3'")).rows[0].n,3);
    assert.equal((await query("SELECT count(*)::int AS n FROM pixelmania.item_instance_events WHERE event_type='retired'")).rows[0].n,1);
    await query("INSERT INTO pixelmania.inventory(player_id,item_type,item_category,amount,stack_limit) VALUES($1,'bluegill','fish',55,20000)",[player]);
    await FishStore.ensureSchema(store);
    assert.equal(Number((await query("SELECT amount FROM pixelmania.inventory WHERE item_type='bluegill'")).rows[0].amount),55);
    console.log("FISHING_POSTGRES_PASS: removal, rollback, journal, instances, drops, terrain, ledgers and restart idempotency");
  } finally {await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
