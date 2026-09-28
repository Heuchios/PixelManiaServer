"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const names = ['makeDeterministicRng', 'deterministicInt', 'serverCellNoise', 'serverSurfaceYAt', 'serverMapSet', 'serverMapSetIfEmpty', 'serverMapClear', 'isServerSpawnSafeColumn', 'serverCreateTree', 'serverGenerateTrees', 'serverCreateNaturalTree', 'serverGenerateNaturalTrees', 'getServerGeneratedBaseTerrain', 'getWorldGenerationVersion', 'buildServerGeneratedWorldMaps'];
const functions = names.map(name => {
 const start = source.indexOf(`function ${name}(`);
 assert(start >= 0, `Missing ${name}`);
 const end = source.indexOf('\nfunction ',start+1);
 assert(end > start, `Missing boundary after ${name}`);
 return source.slice(start,end);
});
const context = { crypto, Map, WORLD_WIDTH: 100, WORLD_HEIGHT: 70, SERVER_TREE_MIN_HEIGHT: 5, SERVER_TREE_MAX_HEIGHT: 8, SERVER_TREE_SURFACE_NOISE_THRESHOLD: 0.30, SERVER_TREE_RANDOM_PLACEMENT_CHANCE: 0.45, LEGACY_WORLD_GENERATION_VERSION: 1, CURRENT_WORLD_GENERATION_VERSION: 3, NATURAL_TREE_GENERATION_VERSION: 3, SERVER_GENERATED_TERRAIN_CACHE_MAX_WORLDS: 16, serverGeneratedBaseTerrainByWorld: new Map(), gridKey: (x,y) => `${x},${y}`, clampInteger: (v,a,b) => Math.max(a,Math.min(b,Math.trunc(v))), isGridInWorld: (x,y) => x>=0 && x<100 && y>=0 && y<70, cleanWorld: s => String(s).toUpperCase(), ServerLandfillEventModule: {isLandfillWorldName: s => s.startsWith('LANDFILL')}, buildServerTerrainSurface: () => ({generationSeed: 5139, surface: new Map(Array.from({length:100},(_,x)=>[x,32]))}), serverGeneratedBlockType: ()=>'dirt', shouldServerPlaceCaveBackground: ()=>false, serverGenerateNaturalPonds: ()=>{}, serverGenerateSurfaceDecorations: ()=>{}, serverApplyLandfillTrashOverlay: ()=>{}, applyServerDefaultEntranceGateToGeneratedMaps: ()=>{} };
vm.createContext(context);
vm.runInContext(functions.join('\n'), context);
function fixture(seed=1) {
 const surface=new Map(), map=new Map();
 for(let x=0;x<100;x++) {const y=32+Math.round(Math.sin(x*0.15+seed)*3);surface.set(x,y);map.set(`${x},${y}`,{x,y,block_type:'grass'});}
 return {map,surface};
}
function trees(map) {return [...map.values()].filter(c=>['wood','leaf'].includes(c.block_type));}
function signature(map) {return JSON.stringify([...map.entries()]);}
let total=0;const crowns=new Set(),heights=new Set();
for(let seed=1;seed<=500;seed++) {
 const a=fixture(seed), b=fixture(seed);
 context.serverGenerateNaturalTrees(a.map,a.surface,seed,context.makeDeterministicRng(String(seed)));
 context.serverGenerateNaturalTrees(b.map,b.surface,seed,context.makeDeterministicRng(String(seed)));
 assert.equal(signature(a.map),signature(b.map),'same seed must reproduce identical trees');
 const cells=new Map(trees(a.map).map(c=>[`${c.x},${c.y}`,c]));
 while(cells.size) {
  const first=cells.values().next().value, queue=[first], component=[];cells.delete(`${first.x},${first.y}`);
  while(queue.length) {const c=queue.pop();component.push(c);for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {const key=`${c.x+dx},${c.y+dy}`;if(cells.has(key)){queue.push(cells.get(key));cells.delete(key);}}}
  const wood=component.filter(c=>c.block_type==='wood'),leaf=component.filter(c=>c.block_type==='leaf');
  assert(wood.length>=5 && wood.length<=8,'no detached canopy or broken trunk');
  assert(leaf.length>12,'every tree has a full crown');
  assert.equal(new Set(wood.map(c=>c.x)).size,1,'trunk must stay vertically connected');
  const root=wood.reduce((a,b)=>a.y>b.y?a:b);
  assert.equal(root.y+1,a.surface.get(root.x));
  assert.equal(a.map.get(`${root.x},${root.y+1}`).block_type,'dirt');
  const ys=wood.map(c=>c.y);assert.equal(Math.max(...ys)-Math.min(...ys)+1,wood.length);
  assert(component.every(c=>context.isGridInWorld(c.x,c.y) && !context.isServerSpawnSafeColumn(c.x) && Math.abs(c.x-50)>3));
  heights.add(wood.length);crowns.add(leaf.map(c=>`${c.x-root.x},${c.y-Math.min(...ys)}`).sort().join('|'));total++;
 }
}
assert(total>1000,`worlds need healthy tree density, found ${total}`);assert.equal(heights.size,4);assert(crowns.size>20);
for(const obstacle of ['stone','water','wood','leaf']) {
 const surface=new Map(Array.from({length:100},(_,x)=>[x,32]));const map=new Map([['25,32',{block_type:'grass'}],['25,29',{block_type:obstacle}]]);const before=signature(map);
 assert.equal(context.serverCreateNaturalTree(map,surface,4,context.makeDeterministicRng('blocked'),25),false);
 assert.equal(signature(map),before,'failed placement must be atomic');
}
const legacy=context.buildServerGeneratedWorldMaps('VERSIONTEST',{world_generation_version:2});
const legacyCopy=signature(legacy.foreground);
const modern=context.buildServerGeneratedWorldMaps('VERSIONTEST',{world_generation_version:3});
assert.notEqual(signature(modern.foreground),legacyCopy,'version 3 must use the new trees');
assert.equal(signature(context.buildServerGeneratedWorldMaps('VERSIONTEST',{world_generation_version:2}).foreground),legacyCopy,'cache must not mix old and new world generation');
assert.equal(signature(context.buildServerGeneratedWorldMaps('VERSIONTEST',{}).foreground),legacyCopy,'unversioned existing worlds retain legacy trees');
assert.equal(context.buildServerGeneratedWorldMaps('VERSIONTEST',{cleared:true,world_generation_version:3}).foreground.size,0);
assert.equal(trees(context.buildServerGeneratedWorldMaps('LANDFILLTEST',{world_generation_version:3}).foreground).length,0);
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify([...modern.foreground.values()]));
console.log(`[natural-trees] PASS: ${total} connected trees across 500 seeds, ${crowns.size} crown shapes; deterministic, supported, atomic, versioned, landfill-safe`);
