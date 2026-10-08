const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createServerPhase9RemainingRoutes} = require('../server_phase9_remaining_routes');
const {createServerPhase7Dispatcher} = require('../server_phase7_dispatcher');
const {createServerPhase11dStandardMovement} = require('../server_phase11d_standard_movement');
const sessions = new Map();
const messages = [];
const cleanWorld = value => String(value || '').trim().toUpperCase();
const movement = createServerPhase11dStandardMovement({
  activeFishingSessions: sessions, cleanWorld, clampString: value => String(value || ''),
  clampInteger: (v,min,max) => Math.min(max,Math.max(min,Number(v)||0)), MAX_DAMAGE_FLASH_MS: 500,
  MAX_MOVE_PIXELS_PER_SECOND: 1000, isGridInWorld: (x,y) => x>=0 && x<200 && y>=0 && y<200,
  getPublicPlayerIdentity: () => ({}),
});
const routes = createServerPhase9RemainingRoutes({activeFishingSessions:sessions, cleanWorld,
  requireAuthenticated: (_s,p) => p.authenticated,
  publishPlayerPresenceUpdate: (_s,p,w) => messages.push(movement.buildPublicPlayerPresencePayload('player_position',p,w)),
});
const dispatcher = createServerPhase7Dispatcher({
  packetContracts: {isWorldDropCreatePacket:()=>false,isWorldDropUpdateRequestPacket:()=>false,isWorldDropPickupRequestPacket:()=>false},
  handlers:{fishing_hook:routes.handleFishingHook}, applyActionPositionFromPayload:()=>assert.fail('Hook must not move player'),
  getPlayerCurrentWorldName: p => p.world,
});
const player = {id:'angler',world:'TEST',joined_world:true,authenticated:true};
const cast = () => ({session_id:'paid-cast',world:'TEST',item_id:'guppy',item_category:'fish',target_x:2,target_y:3,expires_at:Date.now()+5000});
const packet = {type:'fishing_hook',world:'TEST',session_id:'paid-cast',item_id:'swordfish',target_x:99,player_id:'victim'};
(async()=>{
  sessions.set(player.id,cast());
  const before=movement.buildPublicPlayerPresencePayload('player_position',player,'TEST');
  assert.equal(before.fishing_hooked_item_id,'');
  for(const changes of [{world:'OTHER'},{session_id:'old-cast'}]) await dispatcher.dispatch({},player,{...packet,...changes});
  await dispatcher.dispatch({}, {...player,authenticated:false}, packet);
  await dispatcher.dispatch({}, {...player,joined_world:false}, packet);
  assert.equal(messages.length,0);
  const result=await dispatcher.dispatch({},player,packet);
  assert.equal(result.used_action_position,false);
  assert.equal(messages.length,1);
  const hooked=messages[0];
  assert.equal(hooked.player_id,'angler'); assert.equal(hooked.fishing_hooked_item_id,'guppy');
  assert.equal(hooked.fishing_hooked_item_category,'fish'); assert.equal(hooked.fishing_target_x,2);
  assert.equal(hooked.fishing_session_id,'paid-cast');
  assert.notEqual(movement.getPlayerPresenceBroadcastSignature(before),movement.getPlayerPresenceBroadcastSignature(hooked));
  assert.equal(movement.buildPublicPlayerPresencePayload('player_joined',player,'TEST').fishing_hooked_item_id,'guppy','Late joiner sees hooked fish');
  await dispatcher.dispatch({},player,packet); assert.equal(messages.length,1,'Duplicate hook is silent');
  sessions.set(player.id,{...cast(),expires_at:0});
  await dispatcher.dispatch({},player,packet); assert.equal(messages.length,1);
  assert.equal(movement.buildPublicPlayerPresencePayload('player_position',player,'TEST').fishing_hooked_item_id,'','Expiry clears hook');
  sessions.delete(player.id);
  await dispatcher.dispatch({},player,packet); assert.equal(messages.length,1);
  assert.equal(movement.buildPublicPlayerPresencePayload('player_position',player,'TEST').fishing_session_id,'');
  // Exercise the actual generated payload builder without starting the server.
  const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
  const start=source.indexOf('function buildFishingRewardFxPayload(');
  const end=source.indexOf('\nfunction ',start+1);
  for(const rarity of ['common','uncommon','rare','epic','legendary']) {
    const context={getFishingRewardFxRarity:()=>rarity,clampString:String,resolveInventoryCategory:(_id,c)=>c,getPublicPlayerIdentity:()=>({}),TILE_SIZE:32};
    vm.createContext(context); vm.runInContext(source.slice(start,end),context);
    const reward=context.buildFishingRewardFxPayload(player,cast(),'guppy','fish');
    assert.equal(reward.session_id,'paid-cast');assert.equal(reward.target_x,2);assert.equal(reward.target_y,3);
    assert.equal(reward.rarity,rarity);assert.equal(reward.item_id,'guppy');
  }
  console.log('FISHING_VISUAL_SYNC_PASS: authenticated hook, server-owned item, stationary/late-join presence, expiry, duplicate and every-rarity landing');
})().catch(e=>{console.error(e);process.exitCode=1;});
