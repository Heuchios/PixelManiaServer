'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const ItemDatabase=require('../server_item_database');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
const context={ItemDatabase, console, makeRequestId:()=> 'test-request', SAFE_BLOCK_TYPE:'safe', DONATION_BOX_BLOCK_TYPE:'donation_box', WORLD_LOCK_KEY_ITEM_TYPE:'world_lock_key',
  clampString:v=>String(v||'').trim(), clampInteger:(v,min,max)=>Math.min(max,Math.max(min,Math.trunc(Number(v)||0))),
  resolveInventoryCategory:ItemDatabase.resolveItemCategory, cleanWorld:v=>String(v||'START').trim().toUpperCase(),
  cleanDoorId:v=>String(v||'').trim().toUpperCase(),cleanDoorDestination:v=>String(v||'').trim(),cleanDoorName:v=>String(v||''),cleanDoorPassword:v=>String(v||''),
  gridKey:(x,y)=>`${x},${y}`, isWorldLockBlockType:id=>id==='world_lock',isVendBlockType:id=>id==='vending_machine',
};
vm.createContext(context);
function load(name,text=source,indent=''){
 const head=text.includes(`async function ${name}(`)?`async function ${name}(`:`function ${name}(`;
 const start=text.indexOf(head),end=text.indexOf('\n'+indent+'}',start)+indent.length+2;
 assert.ok(start>=0 && end>start,name);vm.runInContext(text.slice(start,end),context);
}
for(const name of ['canStoreItemInSafe','canStoreItemInDonationBox','canListItemInVend','parseDoorDestination','getDoorStateForBlock','handleSafeDeposit','handleDonationBoxDonate','handleDropInventoryItemTransaction','handleDoorEnterRequest']) load(name);
load('sanitizeTradeOfferItem',fs.readFileSync(require.resolve('../server_trade_routes'),'utf8'),'    ');
Object.assign(context,{TRADE_SLOT_COUNT:4,MAX_ITEM_STACK:400});
(async()=>{
 const rejections=[];
 Object.assign(context,{rejectSafeTransaction:(_s,_d,m)=>rejections.push(m),rejectDonationBoxTransaction:(_s,_d,m)=>rejections.push(m),sendInventoryTransactionRejected:(_s,_d,m)=>rejections.push(m),
  getTransactionWorldName:()=> 'HOME',requireSameWorld:()=>true,rejectIfWorldBanned:async()=>false,tradeByPlayerId:new Map()});
 for(const id of ['magnet_machine_remote','world_lock_key']){
  const category=ItemDatabase.resolveItemCategory(id);
  assert.equal(context.canStoreItemInSafe(id,category),false);
  assert.equal(context.canStoreItemInDonationBox(id,category),false);
  assert.equal(context.canListItemInVend(id,category),false);
  assert.equal(ItemDatabase.isDropableItem(id),false);
  const request={item_id:id,item_category:category,amount:1,slot_index:0};
  assert.equal(context.sanitizeTradeOfferItem(request)!==null,id==='world_lock_key','Key remains tradable; remote never is');
  const before=rejections.length;
  await context.handleSafeDeposit({}, {},request,'HOME',{});
  await context.handleDonationBoxDonate({}, {},request,'HOME',{});
  await context.handleDropInventoryItemTransaction({}, {},request);
  assert.equal(rejections.length-before,3,'Forged deposit/donate/drop requests rejected before mutations');
 }
 for(const fn of ['canStoreItemInSafe','canStoreItemInDonationBox','canListItemInVend']) assert.equal(context[fn]('dirt','block'),true);
 // Existing safe contents remain readable: rejecting new deposits must not erase old slots.
 const {createWorldStateHelpers}=require('../server_world_state_helpers');
 const helpers=createWorldStateHelpers({itemDatabase:ItemDatabase,clampString:context.clampString,clampInteger:context.clampInteger,safeBlockType:'safe',worldLockKeyItemType:'world_lock_key'});
 assert.equal(helpers.sanitizeSafeSlot({item_id:'magnet_machine_remote',item_category:'tool',amount:1}).item_id,'magnet_machine_remote');
 for(const block_type of ['wooden_door','blue_portal']){
  const block={x:3,y:4,block_type,door_destination:'OLDWORLD:door:STALE',door_target_world:'OLDWORLD',door_target_id:'STALE'};
  const state={interactions:new Map([['3,4',{destination:'BEACH',target_world:'OLDWORLD',target_door_id:'STALE'}]])};
  const door=context.getDoorStateForBlock(state,block,'HOME');
  assert.equal(door.target_world,'BEACH');assert.equal(door.target_door_id,'');
  let entranceVisits=0,cleanup=0;const reached=new Error('arrival guard');
  Object.assign(context,{requireAuthenticated:()=>true,getPlayerCurrentWorldName:p=>p.world,sanitizeDoorEnterRequest:d=>d,getDoorAtGrid:()=>door,
   isPlayerNearGrid:()=>true,isPasswordDoorBlockType:()=>false,IdentityHelpers:require('../server_identity_helpers'),
   ServerLandfillEventModule:{isLandfillWorldName:()=>false},WorldNames:{enabled:false},ensureWorldRouteForAction:async()=>({ok:true}),refreshWorldStateFromPostgres:async()=>({ok:true}),
   findDoorById:()=>assert.fail('A world name must not look up a door'),
   getJoinWorldSpawnForWorld:w=>{assert.equal(w,'BEACH');entranceVisits++;return {x:320,y:640};},
   reserveWorldAdmission:async()=>({ok:true}),cancelActiveTradeForPlayer:()=>{},activeFishingSessions:new Map(),clearPlayerFishingPresence:()=>{},
   removeWorldLockKeysFromPlayerInventory:async()=>{cleanup++;return {ok:true};},
   updatePlayerWorldIndex:()=>{},commitWorldAdmissionReservation:async()=>{},resetPlayerMovementTracking:()=>{},releaseWorldAdmissionReservation:async()=>{},
   setPlayerWorldEntrySpawnGuard:(p,w,pos)=>{assert.equal(w,'BEACH');assert.equal(p.world,'BEACH');assert.equal(pos.x,320);assert.equal(pos.y,640);throw reached;},
  });
  await assert.rejects(context.handleDoorEnterRequest({}, {world:'HOME',joined_world:false},{world:'HOME',x:3,y:4}),e=>e===reached);
  assert.equal(entranceVisits,1);assert.equal(cleanup,1,'Normal world-exit cleanup still runs');
  for(const [destination,world,id] of [['door:EXIT','HOME','EXIT'],['BEACH:door:EXIT','BEACH','EXIT'],['BEACH:EXIT','BEACH','EXIT']]){
   state.interactions.set('3,4',{destination});const linked=context.getDoorStateForBlock(state,block,'HOME');
   assert.equal(linked.target_world,world);assert.equal(linked.target_door_id,id);
  }
  state.interactions.set('3,4',{destination:''});assert.equal(context.getDoorStateForBlock(state,block,'HOME').destination,'','Clearing destination cannot revive stale block link');
 }
 console.log('WORLD_ITEM_DOOR_RULES_PASS: restriction matrix, forged requests, old safe withdrawal, world-only travel to entrance, key cleanup and explicit links');
})().catch(e=>{console.error(e);process.exitCode=1;});
