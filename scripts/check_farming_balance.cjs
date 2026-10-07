const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const db = require('../server_item_database');
const config = require('../../pixel-mania/Data/items/farming_balance.json');
const report = require('../../pixel-mania/docs/farming-balance-report.json');
const atlas = require('../../pixel-mania/Data/items/atlas_items.json');
const rows = new Map(report.rows.map(r=>[r.id,r]));
const sheetMatches=require('../../pixel-mania/docs/item-sheet-matches.json').comparison;
const baseline=require('../../pixel-mania/docs/item-sheet-comparison-baseline.json').rows;
for(const match of sheetMatches){
  const row=rows.get(match.id);
  for(const key of match.applied){
    const value=match.fields[key].value;
    if(key==='gems')assert.equal(row.break_gems.mean,value,`${match.id}: sheet gems`);
    if(key==='xp')assert.equal(row.break_xp,value,`${match.id}: sheet XP`);
    if(key==='blocks'||key==='seeds')for(const prefix of ['break','tree']){
      const m=row[`${prefix}_${key}`];assert.equal(m.min,value[0]);assert.equal(m.max,value[1]);assert.equal(m.mean,(value[0]+value[1])/2);
    }
  }
}
for(const old of baseline){
  const current=rows.get(old.id);assert.equal(current.grow_seconds,old.grow_seconds,`${old.id}: growth retained`);
  assert.equal(current.tree_gems.mean,old.tree_gems.mean,`${old.id}: harvest gems retained`);
}
assert.equal(rows.get('sugar_cane').break_gems.mean,2.2);
for(const [id,d] of Object.entries(db.ITEMS)) if(d.category==='block') assert(rows.has(id),`Missing block ${id}`);
for(const d of atlas.items) if(db.getItemDefinition(d.item_key)?.category==='block') assert(rows.has(d.item_key),`Missing atlas block ${d.item_key}`);
for(const row of report.rows) {
  const item=db.getItemDefinition(row.id);assert(item, row.id);
  // Uniform sheet rolls intentionally average >1 returned block; do not model
  // them as a finite, depleting recycling cycle.
  if(row.mode==='farm'&&row.break_blocks.mean>=1){assert.equal(row.seeds_per_cycle,null);assert.equal(row.gems_per_cycle,null);}
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
    const authored=config.items[row.id];
    if(!authored.sheet_block_range&&!authored.sheet_seed_range)assert(row.seeds_per_cycle>=1.05-1e-8&&row.seeds_per_cycle<=1.10+1e-8,`${row.id}: retained replanting balance`);
    for(const [category,key]of [['block','sheet_block_range'],['seed','sheet_seed_range']]){
      if(!authored[key])continue;
      for(const rules of [item.drop_rules,item.tree_drop_rules]){
        const drops=rules.fixed_drops.filter(d=>d.item_category===category);
        assert.equal(drops.length,1,`${row.id}: one independent ${category} roll`);
        assert.deepEqual(drops[0].amount_range,authored[key]);
        assert.equal(drops[0].chance??1,1,`${row.id}: no second chance gate on uniform quantity`);
      }
    }
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
  if(row.seeds_per_cycle===null)continue;
  for(let n=0;n<30000;n++) {
    let blocks=0,steps=0;
    const accept=d=>{if(d.item_category==='block'&&d.item_id===id)blocks+=d.amount;else if(d.item_category==='seed')seeds+=d.amount;else if(d.item_id==='gem')gems+=d.amount;};
    context.getTreeHarvestDropsForBlock(id).forEach(accept);
    while(blocks>0){assert(++steps<1000,`${id}: non-terminating recycling`);blocks--;context.getBreakDropsForBlock(id,'foreground').forEach(accept);}
  }
  assert(Math.abs(seeds/30000-row.seeds_per_cycle)<.035,`${id}: actual server seed yield ${seeds/30000}`);
  assert(Math.abs(gems/30000-row.gems_per_cycle)<Math.max(.05,row.gems_per_cycle*.025),`${id}: actual server gems ${gems/30000}`);
}
// Execute real break and harvest paths and verify independent uniform payouts,
// including omission of zero-quantity stacks. Wagon Wheel has larger ranges.
for(const id of ['dirt','grass','star_block','wagon_wheel']){
  const row=rows.get(id);
  for(const [fn,prefix]of [['getBreakDropsForBlock','break'],['getTreeHarvestDropsForBlock','tree']]){
    const totals={block:0,seed:0,currency:0},hist={block:[],seed:[]},n=40000;
    for(let i=0;i<n;i++){
      const amounts={block:0,seed:0,currency:0};
      for(const d of context[fn](id,'foreground')){assert(d.amount>0);amounts[d.item_category]+=d.amount;}
      for(const cat of Object.keys(totals))totals[cat]+=amounts[cat];
      for(const cat of ['block','seed'])hist[cat][amounts[cat]]=(hist[cat][amounts[cat]]||0)+1;
    }
    for(const [cat,suffix]of [['block','blocks'],['seed','seeds'],['currency','gems']])assert(Math.abs(totals[cat]/n-row[`${prefix}_${suffix}`].mean)<.04,`${id} ${fn} ${cat} mean`);
    for(const [cat,key]of [['block','sheet_block_range'],['seed','sheet_seed_range']]){
      const [lo,hi]=config.items[id][key];
      for(let x=lo;x<=hi;x++)assert(Math.abs((hist[cat][x]||0)/n-1/(hi-lo+1))<.012,`${id} ${fn}: uniform ${cat} quantity ${x}`);
    }
  }
}
const xpStart=source.indexOf('function getBlockBreakXp('),xpEnd=source.indexOf('\nfunction ',xpStart+1);
vm.runInContext(source.slice(xpStart,xpEnd),context);
for(const row of report.rows)if(Number.isInteger(db.getItemDefinition(row.id).break_xp))assert.equal(context.getBlockBreakXp(row.id,'foreground'),row.break_xp);
assert.equal(context.getBlockBreakXp('dirt','foreground'),1);
assert.equal(context.getBlockBreakXp('star_block','foreground'),70);
assert.equal(context.getBlockBreakXp('missing','foreground'),0);
assert.equal(rows.get('dirt').grow_seconds,30);
assert.equal(rows.get('obsidian').break_gems.mean,.35);
assert.equal(rows.get('water').grow_seconds,null);
assert.equal(rows.get('pinball').grow_seconds,6*3600+25*60);
assert.equal(rows.get('cctv').grow_seconds,12*3600);
assert.equal(rows.get('snow_repellent').grow_seconds,6*3600);
assert.equal(config.items.water.mode,'liquid');
console.log(`FARMING_BALANCE_PASS: ${rows.size} blocks/states, full coverage, uniform zero-inclusive rewards and server XP`);
