"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const DB = require("../server_item_database");
const Catalog = require("../server_fishing_catalog");
const Store = require("../server_fishing_catalog_store");
const manifest = require("../fishing_catalog.json");

async function run() {
  const client = JSON.parse(fs.readFileSync(path.join(__dirname,"../../pixel-mania/Data/items/fishing_catalog.json"),"utf8"));
  assert.deepEqual(client, manifest);
  const fish = Object.keys(DB.ITEMS).filter(id=>DB.ITEMS[id].category==='fish');
  const baits = Object.keys(DB.ITEMS).filter(id=>DB.ITEMS[id].category==='lure'&&!DB.ITEMS[id].shop_pack);
  assert.deepEqual(fish.sort(), [...manifest.fish_ids].sort());
  assert.deepEqual(baits.sort(), [...manifest.bait_ids].sort());
  for (const [row, ids] of [[5,manifest.bait_ids],[6,manifest.fish_ids]]) ids.forEach((id,x)=>{
    assert.deepEqual(DB.ITEMS[id].texture,{atlas:'res://Assets/items/material.png',cell:[x,row],cell_size:[32,32]});
  });
  for (const bait of baits) {
    const table = DB.getFishingTable(bait);
    assert.equal(table.reduce((sum,e)=>sum+e.weight,0),10000);
    assert.deepEqual(table.map(e=>e.fish_id).sort(),fish);
    for (const rarity of Object.keys(manifest.bait_weights[bait])) {
      assert.equal(table.filter(e=>DB.ITEMS[e.fish_id].rarity===rarity).reduce((sum,e)=>sum+e.weight,0),manifest.bait_weights[bait][rarity]);
    }
  }
  for (const id of manifest.retired_ids) assert.equal(DB.ITEMS[id],undefined);
  for (const definition of Object.values(DB.ITEMS)) {
    for (const reward of definition.drop_rules?.loot_table || []) assert.ok(DB.ITEMS[reward.item_id],`Unknown reward ${reward.item_id}`);
  }
  const state = {fish_inventory:{pond_fish_large:50,bluegill:20},lure_inventory:{hook:5,lure_pack:1},currency_inventory:{gem:123},
    fishing_records:{total_fishing_xp:123,total_caught_per_species:{kraken:1},rarest_catch:{fish_id:'kraken',name:'Kraken'}}};
  Catalog.migratePlayer(state);
  assert.deepEqual(state.fish_inventory,{});assert.deepEqual(state.lure_inventory,{lure_pack:1});
  assert.equal(state.currency_inventory.gem,123);assert.equal(state.fishing_records.total_fishing_xp,123);
  assert.deepEqual(state.fishing_records.rarest_catch,{});
  state.fish_inventory = {bluegill:25,guppy:100};state.lure_inventory.shrimp_bait=2;
  Catalog.migratePlayer(state);
  assert.deepEqual(state.fish_inventory,{bluegill:25,guppy:100});assert.equal(state.lure_inventory.shrimp_bait,2);
  const world = {safe:{slots:[{item_id:'kraken',amount:20},{item_id:'dirt',amount:12}]},vend:{item_type:'hook',stock:9,x:12},hanger:{fish_id:'pond_fish_large',weight:2.5}};
  assert.ok(Catalog.pruneHoldings(world,true));assert.equal(world.safe.slots[0].amount,0);assert.equal(world.safe.slots[1].amount,12);
  assert.equal(world.vend.stock,0);assert.equal(world.vend.x,12);assert.equal(world.hanger.fish_id,'');
  assert.equal(Catalog.pruneHoldings(world,true),false);
  // Exercise the migration orchestration: one ledger entry per holding, preserved
  // audit history, marker written last, and no work on subsequent startups.
  let completed=false; const calls=[];const events=[];const ledgers=[];
  const connection={query:async(sql,args=[])=>{
    calls.push([sql,args]);
    if(sql.includes('SELECT version'))return {rowCount:completed?1:0,rows:[]};
    if(sql.includes('SELECT player_id, player_state'))return {rows:[{player_id:'p',player_state:{fish_inventory:{kraken:10}}}]};
    if(sql.includes('SELECT * FROM inventory'))return {rows:[{player_id:'p',item_type:'kraken',item_category:'fish',amount:10}]};
    if(sql.includes('SELECT * FROM item_instances'))return {rows:[{item_instance_id:'i',owner_player_id:'p',current_location:'inventory'}]};
    if(sql.includes('INSERT INTO fish_weight_migrations'))completed=true;
    return {rows:[],rowCount:0};
  }};
  const store={table:s=>s,recordTransactionLedger:async(c,e)=>ledgers.push(e),recordItemInstanceEvent:async(c,e)=>events.push(e),
    updatePlayerInventoryHash:async()=>{},getInventorySnapshotHash:async()=>"hash",insertWorldObjectChange:async()=>{}};
  await Store.retireOldLineup(store,connection);
  assert.equal(ledgers.length,1);assert.equal(ledgers[0].metadata.removed_amount,10);
  assert.equal(events[0].event_type,'retired');assert.ok(completed);
  assert.ok(calls.at(-1)[0].includes('INSERT INTO fish_weight_migrations'));
  const before=calls.length;await Store.retireOldLineup(store,connection);assert.equal(calls.length,before+1);
  console.log('Fishing catalog: atlas, catches, economy rewards, retirement, journal cleanup and migration idempotency passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
