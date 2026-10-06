const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const db = require('../server_item_database');
const config = require('../../pixel-mania/Data/items/farming_balance.json');
const report = require('../../pixel-mania/docs/farming-balance-report.json');
const atlas = require('../../pixel-mania/Data/items/atlas_items.json');
const rows = new Map(report.rows.map(r=>[r.id,r]));
for(const [id,d] of Object.entries(db.ITEMS)) if(d.category==='block') assert(rows.has(id),`Missing block ${id}`);
for(const d of atlas.items) if(db.getItemDefinition(d.item_key)?.category==='block') assert(rows.has(d.item_key),`Missing atlas block ${d.item_key}`);
for(const row of report.rows) {
  const item=db.getItemDefinition(row.id);assert(item, row.id);
  assert(!(row.break_blocks.mean>=1&&row.break_gems.mean>0),`${row.id}: self-sustaining gem payout loop`);
  for(const rules of [item.drop_rules,item.tree_drop_rules]) {
    assert(rules && Array.isArray(rules.fixed_drops || rules.loot_table || rules.weighted_drops),`${row.id}: explicit rules`);
    for(const d of rules.fixed_drops || rules.loot_table || rules.weighted_drops) {
      assert(db.hasItem(d.item_id),`${row.id}: invalid reward ${d.item_id}`);
      assert((d.chance??1)>=0&&(d.chance??1)<=1);
      assert((d.amount_range||[d.amount??1]).every(x=>Number.isInteger(x)&&x>=0));
    }
  }
  if(row.mode==='farm') {
    assert.notEqual(item.break_return_to_inventory,true,`${row.id}: bypasses farming rolls`);
    assert(row.break_blocks.mean<1,`${row.id}: unlimited re-break duplication`);
    assert(row.seeds_per_cycle>=1.05-1e-8&&row.seeds_per_cycle<=1.10+1e-8,`${row.id}: replanting balance`);
    assert(row.grow_seconds>0&&Number.isInteger(row.grow_seconds));
    assert.equal(db.getItemDefinition(row.seed_id).grow_time,row.grow_seconds);
    assert.equal(db.getItemDefinition(row.seed_id).grows_into,row.id,`${row.id}: seed grows a different block`);
    assert.equal(db.getItemDefinition(row.seed_id).max_grow_time,row.grow_seconds);
  }
  if(['return','reclaimable_tree','unbreakable','liquid'].includes(row.mode)) assert.deepEqual(item.drop_rules.fixed_drops,[]);
  if(row.mode==='variant') assert.deepEqual(item.drop_rules,db.getItemDefinition(row.base_item).drop_rules,`${row.id}: state farming bypass`);
}
// Execute the actual server roller in isolation, with deterministic random numbers.
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const names=['getFixedBreakDropAmount','getBreakDropFromRuleEntry','rollWeightedBreakDrop','getConfiguredDropsFromRules','getDirectBreakInventoryReturn','getBreakDropsForBlock','getTreeHarvestDropsForBlock'];
let state=78123;
function random(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;}
const context=vm.createContext({ItemDatabase:db,Math:Object.assign(Object.create(Math),{random}),MAX_DROP_TILE_AMOUNT:100000,MAX_ITEM_ID_LENGTH:128,
 clampInteger:(x,min,max)=>Math.min(max,Math.max(min,Math.trunc(Number(x)||0))),clampString:x=>String(x||''),
 resolveInventoryCategory:(id,c)=>db.resolveItemCategory(id,c),randomRangeInclusive:(min,max)=>min+Math.floor(random()*(max-min+1))});
for(const name of names){const start=source.indexOf(`function ${name}(`);assert(start>=0);const end=source.indexOf('\nfunction ',start+1);vm.runInContext(source.slice(start,end),context);}
for(const id of ['dirt','barn_block','metal_pad','dice_block','gold_block']) {
  const row=rows.get(id);let seeds=0,gems=0;
  for(let n=0;n<30000;n++) {
    let blocks=0,steps=0;
    const accept=d=>{if(d.item_category==='block'&&d.item_id===id)blocks+=d.amount;else if(d.item_category==='seed')seeds+=d.amount;else if(d.item_id==='gem')gems+=d.amount;};
    context.getTreeHarvestDropsForBlock(id).forEach(accept);
    while(blocks>0){assert(++steps<1000,`${id}: non-terminating recycling`);blocks--;context.getBreakDropsForBlock(id,'foreground').forEach(accept);}
  }
  assert(Math.abs(seeds/30000-row.seeds_per_cycle)<.035,`${id}: actual server seed yield ${seeds/30000}`);
  assert(Math.abs(gems/30000-row.gems_per_cycle)<Math.max(.05,row.gems_per_cycle*.025),`${id}: actual server gems ${gems/30000}`);
}
assert.equal(rows.get('dirt').grow_seconds,30);
assert.equal(rows.get('obsidian').break_gems.mean,.35);
assert.equal(rows.get('water').grow_seconds,null);
assert.equal(rows.get('pinball').grow_seconds,6*3600+25*60);
assert.equal(rows.get('cctv').grow_seconds,12*3600);
assert.equal(rows.get('snow_repellent').grow_seconds,6*3600);
assert.equal(config.items.water.mode,'liquid');
console.log(`FARMING_BALANCE_PASS: ${rows.size} blocks/states, full coverage, finite recycling and simulated server rewards`);
