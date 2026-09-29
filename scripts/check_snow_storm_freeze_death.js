"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
function extract(name) {
 const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
 assert(start >= 0, `Missing ${name}`);
 const next = source.slice(start+1).search(/\n(?:async )?function /);
 assert(next >= 0);
 return source.slice(start,start+1+next);
}
function compile(name,deps) {return new Function(...Object.keys(deps),`${extract(name)}; return ${name};`)(...Object.values(deps));}
const gridKey=(x,y)=>`${x},${y}`;
const cleanWorld=s=>String(s).toUpperCase();
const getGridPositionsOverlappingRect=compile('getGridPositionsOverlappingRect',{TILE_SIZE:32});
const getPlayerMovementCollisionRect=compile('getPlayerMovementCollisionRect',{PLAYER_COLLISION_HALF_WIDTH:8,PLAYER_COLLISION_HALF_HEIGHT:12.5,PLAYER_COLLISION_OFFSET_X:1,PLAYER_COLLISION_OFFSET_Y:-5,PLAYER_COLLISION_SHRINK_PIXELS:2});
const records = [
 ['standing',320,640], ['feet-only',320,620], ['spanning',320,656],
 ['treasure',480,640], ['above',320,618], ['dry',800,640],
 ['old-ice',352,640], ['other-world',320,640,'OTHER'], ['dead',320,640,'SNOW','dead'],
 ['invalid',NaN,640],
].map(([id,x,y,world='SNOW',animation_state='idle'])=>({playerId:id,player:{id,x,y,world,animation_state,name:id},socket:{}}));
const helper=compile('buildSnowStormFreezeDeathTargets',{
 gridKey, cleanWorld, cleanAccountName:s=>s,
 getWorldPlayerRecords:world=>records.filter(r=>r.player.world===world),
 getPlayerValidationPosition:p=>({ok:true,x:p.x,y:p.y}),getGridPositionsOverlappingRect,getPlayerMovementCollisionRect,
});
const changes=[{x:10,y:20,original_block_id:'water',event_block_id:'ice_block'}, {x:10,y:21,original_block_id:'water',event_block_id:'ice_block'}, {x:15,y:20,original_block_id:'water',event_block_id:'ice_treasure'}, {x:25,y:20,original_block_id:'dirt',event_block_id:'snow_block'}];
const makeUpdates=()=>changes.slice().reverse().map(c=>({action:'place',layer:'foreground',x:c.x,y:c.y,block_type:c.event_block_id}));
const updates=makeUpdates();
const victims=helper('SNOW','event-1',changes,updates);
assert.deepEqual(victims.map(v=>v.playerId).sort(),['feet-only','spanning','standing','treasure']);
assert.equal(updates.flatMap(u=>u.kill_player_ids||[]).length,4,'one death per player even across several cells');
assert(updates[0].instant_death,'deaths must not wait behind unrelated terrain updates');
assert(updates.filter(u=>u.instant_death).every(u=>u.kill_reason==='snow_storm_freeze' && u.kill_event_id==='event-1'));
assert.equal(helper('SNOW','thaw',changes.map(c=>({...c,original_block_id:'ice_block',event_block_id:'water'})),makeUpdates()).length,0);
assert.equal(helper('SNOW','empty',[],[]).length,0);

async function checkCommit(commitOk) {
 const state={foreground:new Map(),removed_foreground:new Map(),interactions:new Map(),seeds:new Map()};
 const effective=new Map(changes.map(c=>[gridKey(c.x,c.y),{x:c.x,y:c.y,block_type:c.original_block_id,source:c.x===15?'explicit':'generated'}]));
 let committed=false, presenceCalls=0, sent=[];
 const start=compile('startSnowStormEvent',{
  ServerLandfillEventModule:{isLandfillWorldName:()=>false},cleanWorld,worldEventActionLocks:new Set(),SNOW_STORM_EVENT_TYPE:'snow_storm',ensureWorldState:()=>state,hasActiveSnowStormEvent:()=>false,hasSnowRepellentBlock:()=>false,serializeWorldState:()=>({}),makeAuditId:()=> 'event-commit',SNOW_STORM_EVENT_DURATION_MS:1000,SNOW_STORM_MAX_CHANGED_TILES:7000,buildEffectiveForegroundMap:()=>effective,clampString:s=>String(s||''),getSnowStormEventBlockForOriginal:(type,_map,x)=>type==='water'?(x===15?'ice_treasure':'ice_block'):'',gridKey,getSnowStormIceEventBlock:()=> 'ice_block',makeDeterministicRng:()=>()=>1,SNOW_STORM_PILE_OF_SNOW_CHANCE:0,canSpawnSnowStormPileAt:()=>false,invalidateMovementCollisionCache:()=>{},buildSnowStormFreezeDeathTargets:helper,
  commitWorldEventStateOnly:async()=>{committed=commitOk;return {ok:commitOk};},worldStates:new Map(),deserializeWorldState:()=>state,scheduleWorldEventEnd:()=>{},
  applyPunchToggleInstantDeathPresence:targets=>{assert(committed,'no death before durable commit');presenceCalls++;assert.equal(targets.length,4);},
  broadcastToWorld:()=>{assert(committed);},buildWorldEventStartedMessage:()=>({}),broadcastEventSystemMessage:()=>{},SNOW_STORM_SYSTEM_MESSAGE:'Snow',broadcastEventTileUpdates:async(_w,_e,_p,u)=>{assert(committed);sent=u;},getErrorStack:e=>e.stack,getErrorMessage:e=>e.message,console:{log:()=>{},warn:()=>{}},
 });
 const result=await start('snow');assert.equal(result.ok,commitOk);
 assert.equal(presenceCalls,commitOk?1:0);
 assert.equal(sent.flatMap(u=>u.kill_player_ids||[]).length,commitOk?4:0);
}
(async()=>{await checkCommit(true);await checkCommit(false);console.log('[snow-freeze-death] PASS: stationary, partial overlap, multi-cell, ice treasure, world isolation, dry/old ice/thaw exclusions, commit failure');})().catch(e=>{console.error(e);process.exitCode=1;});
