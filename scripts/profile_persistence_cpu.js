"use strict";
// Real serialization/clone helpers with generated state; excludes PostgreSQL/IO latency.
const assert=require('node:assert/strict');
const {createWorldStateHelpers}=require('../server_world_state_helpers');
const {clonePersistenceSnapshot}=require('../server_persistence_helpers');
const PostgresStore=require('../postgres_store');
function measure(run,n=61){const values=[];for(let i=0;i<n;i++){const start=performance.now();run();if(i)values.push(performance.now()-start);}
 values.sort((a,b)=>a-b);return {samples:values.length,median_ms:values[Math.floor(values.length/2)],p95_ms:values[Math.floor(values.length*.95)],max_ms:values.at(-1)};}
async function main(){
 const worlds=[];
 for(const count of [100,1000,7000]){
  const state={foreground:new Map(Array.from({length:count},(_,i)=>[String(i),{x:i%100,y:Math.floor(i/100),block_type:'dirt',block_revision:i+1}])),seeds:new Map(),world_revision:10};
  const helper=createWorldStateHelpers({ensureWorldState:()=>state,cleanWorld:String,clampInteger:(n,a,b)=>Math.max(a,Math.min(b,Number(n))),
   getForegroundBlocksForState:s=>Array.from(s.foreground.values()),getElectricalLayerForSave:()=>[],getElectricalDevicesForSave:()=>[],
   getActiveWorldBackgroundTheme:()=>'',getEffectiveWorldLockStateInState:()=>null,sanitizeAreaLocksList:x=>x,
   sanitizeCctvWorldState:x=>x,buildActiveWorldEventSnapshot:()=>null});
  let saved;
  const clone=measure(()=>{saved=clonePersistenceSnapshot(helper.serializeWorldState('BENCH'));});
  assert.equal(saved.blocks.length,count);assert.notEqual(saved.blocks[0],state.foreground.get('0'));
  const json=measure(()=>JSON.stringify(saved));
  worlds.push({edited_cells:count,wire_bytes:Buffer.byteLength(JSON.stringify(saved)),snapshot_clone:clone,json_encode:json});
 }
 const accounts=[];
 for(const count of [100,2000,5000]){
  const data=Array.from({length:count},(_,i)=>({username:'fixture'+i,email:'fixture@example.invalid',password_hash:'x'.repeat(100),
   created_at:'2026-01-01T00:00:00Z',last_login_at:'2026-09-19T00:00:00Z',role:'player',device_ids:['fixture'],login_history:[]}));
  const store=new PostgresStore({enabled:false,logger:()=>{}});store.isReady=()=>true;
  store.withTransaction=async work=>work({});let upserts=0;store.upsertAccountState=async()=>{upserts++;};
  assert.equal(await store.saveAccountStates(data),true);assert.equal(upserts,count);
  accounts.push({accounts:count,upserts_for_one_snapshot:upserts,json_backup_cpu:measure(()=>JSON.stringify({accounts:data},null,2)),json_bytes:Buffer.byteLength(JSON.stringify(data,null,2))});
 }
 console.log(JSON.stringify({scope:'synthetic CPU and query-count evidence only; no live DB, locks or IO; world ancillary components empty',worlds,accounts},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
