'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('src/server_phase8_world_action_routes.ts','utf8');
const names=[...source.match(/const \{([\s\S]*?)\n  \} = deps;/)[1].matchAll(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)/gm)].map(m=>m[1]);
const deps=Object.fromEntries(names.map(n=>[n,()=>false]));
let finishCommit;const commitGate=new Promise(resolve=>{finishCommit=resolve});
let removed=false,drops=0;const locks=new Set(),sent=[],rejected=[];
Object.assign(deps,{
 POSTGRES_ENABLED:false,POSTGRES_AUTHORITATIVE:false,
 requireAuthenticated:()=>true, rejectIfWorldBanned:async()=>false,
 makeRequestId:d=>d.request_id, getPlayerCurrentWorldName:()=> 'TEST',cleanWorld:String,clampString:String,cleanAccountName:String,
 sanitizeBlockUpdate:d=>({...d}), getPlayerValidationPosition:()=>({ok:true,x:0,y:0}),
 getWorldBlockActionLockResource:(_w,u)=>`${u.layer}:${u.x},${u.y}`,
 acquireLiveActionLock:async(_set,_scope,key)=>{if(locks.has(key))return {acquired:false};locks.add(key);return {acquired:true,key}},
 releaseLiveActionLock:l=>{if(l?.acquired)locks.delete(l.key)},validateNetfoxActionCooldown:()=>true,canPlayerBuildAtGrid:()=>true,
 validateBlockUpdateAgainstServerState:async()=>({ok:!removed}),
 getWorldBlockTypeAt:()=>removed?'':'dirt',serializeWorldState:()=>({removed}),
 applyBlockUpdateToWorldState:()=>{removed=true},buildPunchToggleInstantDeathTargets:()=>[],
 awardPlayerExperience:()=>({xp_gained:0}),createBreakDrops:()=>{drops++;return []},
 buildInventoryDeltaClientPayloads:()=>[],commitWorldStateWithBlockChanges:async()=>{await commitGate;return {ok:true,postgres_committed:true}},
 sendWorldUpdateToRequesterAndWorld:(_s,_p,_w,u)=>sent.push({...u}),
 sendActionRejected:(_s,_a,_m,d)=>rejected.push(d),
 writeCrashReport:(_kind,details)=>{throw Error(JSON.stringify(details))},
});
const routes=require('../server_phase8_world_action_routes').createServerPhase8WorldActionRoutes(deps);
(async()=>{
const data={action:'break',world:'TEST',layer:'foreground',x:31,y:32,block_type:'dirt',request_id:'a'};
const first=routes.handleWorldBlockUpdate({}, {id:'a'},data,{});
await new Promise(r=>setImmediate(r));
assert.equal(removed,true);assert.equal(sent.length,0,'No uncommitted success/drop broadcast');
await routes.handleWorldBlockUpdate({}, {id:'b'},{...data,request_id:'b'},{});
assert.equal(rejected.at(-1)?.reason,'block_action_busy');assert.equal(drops,1);
finishCommit();await first;
assert.equal(sent.length,1);assert.equal(drops,1);assert.equal(locks.size,0);
await routes.handleWorldBlockUpdate({}, {id:'b'},{...data,request_id:'late'},{});
assert.equal(sent.length,1);assert.equal(drops,1);
console.log('Delayed commit + two-player same-cell race: one removal, one drop-generation pass, one confirmed broadcast, no premature success.');
})().catch(e=>{console.error(e);process.exitCode=1});
