// Generate identical runtime overrides and the full report from one authored balance file.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const server = path.resolve(__dirname, '..');
const client = path.resolve(server, '../pixel-mania');
const config = JSON.parse(fs.readFileSync(path.join(client, 'Data/items/farming_balance.json'), 'utf8'));
const patches = JSON.parse(fs.readFileSync(path.join(client, 'Data/items/item_data_overrides.json'), 'utf8'));
const results = new Map();
const empty = () => ({seed_chance:0,gem_range:[0,0],fixed_drops:[]});
const drop = (id, category, amount, chance=1) => ({item_id:id,item_category:category,...(Array.isArray(amount)?{amount_range:amount}:{amount}),...(chance===1?{}:{chance})});
function currency(mean) {
  const whole=Math.floor(mean), fraction=Number((mean-whole).toFixed(8));
  return [...(whole?[drop('gem','currency',whole)]:[]),...(fraction?[drop('gem','currency',1,fraction)]:[])];
}
function resolve(id, chain=[]) {
  if(results.has(id)) return results.get(id);
  assert(!chain.includes(id),`Variant cycle ${id}`);
  const item=config.items[id];assert(item,`Missing balance item ${id}`);
  const result={...item,id,break_rules:empty(),tree_rules:empty(),grow_seconds:item.grow_seconds??null};
  if(item.mode==='variant') {
    const base=resolve(item.base_item,[...chain,id]);
    Object.assign(result,{break_rules:structuredClone(base.break_rules),tree_rules:structuredClone(base.tree_rules),grow_seconds:base.grow_seconds,seed_id:base.seed_id,balance_tier:base.balance_tier,break_xp:base.break_xp,sheet_block_range:base.sheet_block_range,sheet_seed_range:base.sheet_seed_range});
  } else if(item.mode==='farm') {
    const profile=config.profiles[item.profile];assert(profile,`Missing profile ${id}`);
    result.break_rules.fixed_drops=[drop(id,'block',[1,3],profile.break_block_chance),...(item.no_break_seed?[]:[drop(item.seed_id,'seed',1,profile.break_seed_chance)]),...currency(item.gem_mean),...item.extra_break_drops];
    const target=profile.tree_seed_chance+2*profile.break_seed_chance/(1-2*profile.break_block_chance);
    const seedDrops=item.no_break_seed?[drop(item.seed_id,'seed',1),drop(item.seed_id,'seed',1,Number((target-1).toFixed(8)))]:[drop(item.seed_id,'seed',1,profile.tree_seed_chance)];
    result.tree_rules.fixed_drops=[drop(id,'block',[1,3]),...seedDrops,...currency(item.tree_gem_mean??2*item.gem_mean),...item.extra_tree_drops];
    // Sheet ranges are independent uniform rolls, including zero outcomes.
    for(const rules of [result.break_rules,result.tree_rules]){
      for(const [category,key,rewardId]of [['block','sheet_block_range',id],['seed','sheet_seed_range',item.seed_id]]){
        if(!item[key])continue;
        rules.fixed_drops=rules.fixed_drops.filter(d=>d.item_category!==category);
        rules.fixed_drops.unshift(drop(rewardId,category,item[key]));
      }
    }
  } else if(item.mode==='reclaimable_tree') {
    result.tree_rules.fixed_drops=[drop(id,'block',1),drop(item.seed_id,'seed',1),drop(item.seed_id,'seed',1,.05)];
  } else if(item.mode==='special') result.break_rules=item.break_rules;
  results.set(id,result);return result;
}
function metrics(rules,category) {
  const table=rules.loot_table||rules.weighted_drops;
  const entries=table||rules.fixed_drops||[];
  const totalWeight=table?entries.reduce((s,d)=>s+d.weight,0):1;
  let mean=0,min=0,max=0,none=table?0:1;
  for(const d of entries) {
    if(d.item_category!==category) {if(table) none+=d.weight/totalWeight;continue;}
    const [lo,hi]=d.amount_range||[d.amount??1,d.amount??1];
    const chance=table?d.weight/totalWeight:d.chance??1;
    const zero=(lo===0?1/(hi-lo+1):0);
    mean+=chance*(lo+hi)/2;
    if(table){max=Math.max(max,hi);none+=chance*zero;}else{min+=chance===1?lo:0;max+=hi;none*=1-chance*(1-zero);}
  }
  return {min,max,mean:Number(mean.toFixed(8)),chance:Number((1-none).toFixed(8))};
}
function describe(rules) {
  const weighted=rules.loot_table||rules.weighted_drops;
  const entries=weighted||rules.fixed_drops||[];
  const total=weighted?entries.reduce((s,d)=>s+d.weight,0):1;
  return entries.map(d=>`${d.item_id}: ${d.amount_range?d.amount_range.join('–'):d.amount??1} at ${Number(100*(weighted?d.weight/total:d.chance??1)).toFixed(2)}%`).join('; ')||'None';
}
const rows=[];
for(const id of Object.keys(config.items).sort()) {
  const r=resolve(id);
  const direct=['return','reclaimable_tree'].includes(r.mode);
  const patch=patches[id]??={};
  Object.assign(patch,{authored_drop_rules:true,drop_rules:r.break_rules,tree_drop_rules:r.tree_rules,farming_balance_version:config.version});
  if(Number.isInteger(r.break_xp))patch.break_xp=r.break_xp;
  if(r.seed_id&&r.grow_seconds) {
    const seedPatch=patches[r.seed_id]??={};
    Object.assign(seedPatch,{grow_time:r.grow_seconds,max_grow_time:r.grow_seconds});
  }
  const bm=direct?{min:1,max:1,mean:1,chance:1}:metrics(r.break_rules,'block');
  const sm=metrics(r.break_rules,'seed'), gm=metrics(r.break_rules,'currency');
  const tb=metrics(r.tree_rules,'block'),ts=metrics(r.tree_rules,'seed'),tg=metrics(r.tree_rules,'currency');
  const farm=r.mode==='farm';
  rows.push({id,name:r.name,tier:r.tier,balance_tier:r.balance_tier,mode:r.mode,base_item:r.base_item||'',seed_id:r.seed_id,grow_seconds:r.grow_seconds,
    break_blocks:bm,break_seeds:sm,break_gems:gm,tree_blocks:tb,tree_seeds:ts,tree_gems:tg,
    break_xp:['unbreakable','liquid'].includes(r.mode)?0:r.break_xp??3,tree_xp:r.seed_id&&r.grow_seconds?3:0,
    seeds_per_cycle:farm&&bm.mean<1?Number((ts.mean+tb.mean*sm.mean/(1-bm.mean)).toFixed(8)):r.mode==='reclaimable_tree'?ts.mean:null,
    gems_per_cycle:farm&&bm.mean<1?Number((tg.mean+tb.mean*gm.mean/(1-bm.mean)).toFixed(8)):r.mode==='reclaimable_tree'?0:null,
    break_details:direct?'1 item returned directly to inventory':describe(r.break_rules),tree_details:describe(r.tree_rules),source:r.source,growth_source:r.growth_source||'',
    notes:r.mode==='variant'?`Placed state of ${r.base_item}; grow the base item's seed.`:r.mode==='liquid'?'Bucket placement and scooping grant no drops. Water has no plantable seed.':r.mode==='unbreakable'?'Cannot be broken; no tree.':r.mode==='return'?'Guaranteed recovery; no break gems or seeds.':r.mode==='reclaimable_tree'?'Guaranteed recovery; no break gems. Tree returns one block and 1–2 seeds.':r.mode==='special'?'Special or non-growable item; reward details shown.':r.sheet_block_range||r.sheet_seed_range?'Listed block/seed ranges roll uniformly, including zero. Unspecified fields retain existing behavior. Growth times and tree gems/XP are unchanged.':r.no_break_seed?'No seeds on break; seed replacement comes from harvesting.':'Independent break rolls; block quantity 1–3 when the block roll succeeds.'});
}
function output(file, data) {
  if(process.argv.includes('--check')) assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),data,`Regenerate farming balance: ${file}`);
  else fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
}
for(const file of [path.join(server,'item_data_overrides.json'),path.join(client,'Data/items/item_data_overrides.json')]) output(file,patches);
const report={version:config.version,design:config.design,profiles:config.profiles,rows};
output(path.join(client,'docs/farming-balance-report.json'),report);
output(path.join(client,'docs/item-gem-rates.json'),{
  interpretation:'Current authored per-break gem averages. Live sheet clear matches updated; conflicts and missing values retain their prior averages. Integer currency: guaranteed floor plus fractional chance of one extra.',
  applied:rows.filter(r=>['farm','variant'].includes(r.mode)&&r.break_gems.mean>0).map(r=>({id:r.id,average:r.break_gems.mean,source:r.source})),
  conflicts:config.version>=2?['See item-sheet-matches.json for field-specific conflicts and preserved exceptions.']:[]
});
console.log(`Generated ${rows.length} block/state rows and shared client/server overrides.`);
