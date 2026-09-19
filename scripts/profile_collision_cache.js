"use strict";
// Real production cache/overlay functions, synthetic immutable world contents.
// No sockets, database, credentials or live world mutations.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
function body(name){const match=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert(match,name);
 const rest=source.slice(match.index),end=/\n(?:async )?function \w+\(/.exec(rest);return end?rest.slice(0,end.index):rest;}
const names=['getMovementCollisionRevision','invalidateMovementCollisionCache','getMovementCollisionMap','buildEffectiveForegroundMap'];
if(source.includes('function updateMovementCollisionCell('))names.push('updateMovementCollisionCell');
const results=[];
for(const cells of [6000,7000,20000,50000]){
 const generated=new Map(Array.from({length:cells},(_,i)=>[`${i%100}:${Math.floor(i/100)}`,{x:i%100,y:Math.floor(i/100),block_type:'dirt'}]));
 const state={foreground:new Map(),removed_foreground:new Map()};let builds=0;
 const ctx={Map,Math,Number,String,performance,MOVEMENT_COLLISION_CACHE_MAX_WORLDS:64,
  movementCollisionWorldRevision:new Map(),movementCollisionCacheByWorld:new Map(),cleanWorld:x=>x,
  ensureWorldState:()=>state,buildServerGeneratedForegroundMap:()=>{builds++;return generated;},
  runtimeProfiler:{enabled:false,observe:()=>{}},gridKey:(x,y)=>`${x}:${y}`};
 vm.createContext(ctx);vm.runInContext(names.map(body).join('\n'),ctx);
 ctx.getMovementCollisionMap('BENCH');
 const samples=[];const initialBuilds=builds;
 for(let i=0;i<120;i++){
  const key='10:10',place=i%2===0;
  if(place){state.foreground.set(key,{x:10,y:10,block_type:'stone'});state.removed_foreground.delete(key);}
  else {state.foreground.delete(key);state.removed_foreground.set(key,{x:10,y:10});}
  const start=performance.now();
  if(ctx.updateMovementCollisionCell && !process.argv.includes('--legacy'))ctx.updateMovementCollisionCell('BENCH',{x:10,y:10,action:place?'place':'break',layer:'foreground'});
  else ctx.invalidateMovementCollisionCache('BENCH');
  const map=ctx.getMovementCollisionMap('BENCH');samples.push(performance.now()-start);
  assert.equal(map.get(key)?.block_type,place?'stone':undefined);
  assert.equal(map.get('11:10').block_type,'dirt','Neighbor changed');
 }
 samples.sort((a,b)=>a-b);results.push({cells,edits:120,overlay_rebuilds:builds-initialBuilds,
  mean_ms:samples.reduce((a,b)=>a+b,0)/samples.length,p95_ms:samples[114],max_ms:samples.at(-1)});
 // Bulk restore must still rebuild, including generated terrain and tombstones.
 ctx.invalidateMovementCollisionCache('BENCH');state.removed_foreground.clear();state.foreground.clear();
 assert.equal(ctx.getMovementCollisionMap('BENCH').get('10:10').block_type,'dirt');
 if(ctx.updateMovementCollisionCell){
  const revision=ctx.getMovementCollisionRevision('BENCH');
  ctx.updateMovementCollisionCell('BENCH',{x:10,y:10,layer:'foreground',action:'hit'});
  ctx.updateMovementCollisionCell('BENCH',{x:10,y:10,layer:'background',action:'break'});
  assert.equal(ctx.getMovementCollisionRevision('BENCH'),revision,'Hit/background must not invalidate solid collision');
  state.foreground.set('10:10',{x:10,y:10,block_type:'stone'});
  ctx.updateMovementCollisionCell('BENCH',{x:10,y:10,layer:'foreground',action:'place'});
  assert.equal(ctx.getMovementCollisionMap('BENCH').get('10:10').block_type,'stone');
  state.foreground.delete('10:10');
  ctx.updateMovementCollisionCell('BENCH',{x:10,y:10,layer:'foreground',action:'break'});
  assert.equal(ctx.getMovementCollisionMap('BENCH').get('10:10').block_type,'dirt','Rollback must restore generated terrain');
  state.foreground.set('10:10',{x:10,y:10,block_type:'stone'});
  ctx.updateMovementCollisionCell('BENCH',{x:10,y:10,action:'place'});
  assert.equal(ctx.getMovementCollisionMap('BENCH').get('10:10').block_type,'stone','Legacy broadcast defaults to foreground');
  ctx.invalidateMovementCollisionCache('COLD');
  ctx.updateMovementCollisionCell('COLD',{x:10,y:10,layer:'foreground',action:'place'});
  assert.equal(ctx.movementCollisionCacheByWorld.has('COLD'),false,'Cold edits must stay lazy');
  assert(ctx.movementCollisionCacheByWorld.has('BENCH'),'Other world cache must remain valid');
 }
}
console.log(JSON.stringify({scope:'cache and foreground overlay CPU; no network/database',results},null,2));
