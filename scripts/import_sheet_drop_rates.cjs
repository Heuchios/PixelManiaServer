// Import reviewed numeric fields from a checked-in Google Sheets snapshot.
// Source row numbers are evidence only: names/known IDs are used for matching.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const client=path.resolve(__dirname,'../../pixel-mania');
const read=p=>JSON.parse(fs.readFileSync(path.join(client,p),'utf8'));
const config=read('Data/items/farming_balance.json'),source=read('docs/item-sheet-reference.json');
const audit=read('docs/item-data-audit.json').rows;
const db=require('../server_item_database');
const norm=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={'magneticmachine':['magnet_machine'],'thegirlwithpearlearrings':['the_girl_the_pearl_painting']};
const names=new Map();
for(const r of audit){if(r.visual_state)continue;const k=norm(r.name);names.set(k,[...new Set([...(names.get(k)||[]),...(r.resolved_ids||[])])]);}
const candidates=new Map(),unmatched=[];
for(const row of source.rows){
  const key=norm(row.name);
  let ids=(aliases[key]||names.get(key)||[]).filter(id=>config.items[id]);
  if(!ids.length)ids=Object.entries(db.ITEMS).filter(([id,d])=>config.items[id]&&(norm(d.display_name)===key||norm(id)===key)).map(([id])=>id);
  if(!ids.length){unmatched.push(row);continue;}
  for(const id of ids)candidates.set(id,[...(candidates.get(id)||[]),row]);
}
const numeric=x=>/^\d+(\.\d+)?$/.test(String(x??'').trim())?Number(x):null;
const range=x=>/^\d+\s*-\s*\d+$/.test(String(x??''))?String(x).split('-').map(Number):null;
function field(rows,key){
  const values=[];let invalid=false;
  for(const r of rows){
    let value;
    if(key==='gems'){
      const rates=r.gems.map((x,i)=>{const n=numeric(x);return n===null?null:n/[1,50,100,500,1000][i];}).filter(x=>x!==null);
      if(rates.some(x=>Math.abs(x-rates[0])>1e-8))invalid=true;
      value=rates.length?rates[0]:null;
    }else value=key==='xp'?numeric(r.xp):range(r[key]);
    if(value!==null)values.push(value);
  }
  const unique=[...new Set(values.map(JSON.stringify))];
  return {value:!invalid&&unique.length===1?JSON.parse(unique[0]):null,status:invalid||unique.length>1?'Conflicting values':unique.length?'Specified':'Not specified'};
}
const comparison=[];
for(const [id,item]of Object.entries(config.items)){
  const rows=candidates.get(id)||[],fields=Object.fromEntries(['gems','xp','blocks','seeds'].map(k=>[k,field(rows,k)]));
  if(id==='sugar_cane'&&rows.some(r=>r.row===606))fields.gems={value:2.2,status:'User confirmed 2.2; source bulk totals conflict'};
  const applied=[];
  if(item.mode==='farm'){
    if(fields.gems.value!==null){item.tree_gem_mean??=2*item.gem_mean;item.gem_mean=fields.gems.value;item.source=`Live ITEM DATA gem average, rows ${rows.map(r=>r.row).join(', ')}`;applied.push('gems');}
    if(fields.xp.value!==null){assert(Number.isInteger(fields.xp.value));item.break_xp=fields.xp.value;applied.push('xp');}
    for(const key of ['blocks','seeds'])if(fields[key].value!==null){
      assert(fields[key].value[0]<=fields[key].value[1]);
      item[key==='blocks'?'sheet_block_range':'sheet_seed_range']=fields[key].value;applied.push(key);
    }
    if(applied.length)item.sheet_rows=rows.map(r=>r.row);
  }
  comparison.push({id,source_rows:rows,fields,applied,base_item:item.base_item||'',mode:item.mode});
}
config.version=2;
config.design='Live ITEM DATA numeric gem averages and break XP. Listed block/seed quantities roll uniformly and independently on breaks and harvests (0–3 = 25% each; 0–1 = 50% each), as explicitly requested. Tree gems/XP and growth times are retained. Missing/conflicting fields and special recovery behavior retain existing rules. Uniform block returns can exceed one block per break; no finite full-recycling yield is claimed.';
const write=(p,data)=>fs.writeFileSync(path.join(client,p),JSON.stringify(data,null,2)+'\n');
write('Data/items/farming_balance.json',config);
write('docs/item-sheet-matches.json',{source:source.spreadsheet_id,comparison,unmatched});
console.log(`Matched ${comparison.filter(r=>r.source_rows.length).length}/${comparison.length} blocks/states; updated ${comparison.filter(r=>r.applied.length).length} farmable block definitions.`);
