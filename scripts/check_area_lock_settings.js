"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
function compile(name, deps) {
  const start = source.indexOf(`function ${name}(`);
  assert(start > 0);
  const end = source.indexOf("\nfunction ", start + 1);
  return new Function(...Object.keys(deps), `${source.slice(start, end)}; return ${name};`)(...Object.values(deps));
}
const state = { area_locks: [
  {lock_id:"mine",owner_name:"OWNER",lock_grid_x:5,lock_grid_y:5,lock_type:"big_lock",public_build:false},
  {lock_id:"theirs",owner_name:"OTHER",lock_grid_x:30,lock_grid_y:5,lock_type:"small_lock",public_build:false}
], foreground:new Map([["5:5",{block_type:"big_lock"}],["30:5",{block_type:"small_lock"}]]) };
const canManage = (player, _world, lock) => player.name === lock.owner_name;
const rejected=[];
const prepare = compile("prepareAreaLockStateUpdate", {
  ensureWorldState:()=>state, sanitizeAreaLocksList:v=>structuredClone(v),
  getAreaLockAtGrid:()=>null, canPlayerManageAreaLock:canManage,
  sendActionRejected:(_s,_a,_m,extra)=>rejected.push(extra.reason), gridKey:(x,y)=>`${x}:${y}`,
  isAreaLockBlockType:t=>t.endsWith("lock"), normalizeAreaLockBlockType:t=>t,
  getAreaLockTileLimit:()=>80,sanitizeAreaLockPositions:v=>v||[],getConnectedAreaLockPositions:()=>[]
});
const owner={name:"OWNER",authenticated:true};
const patch={state:{area_locks:[{...state.area_locks[0],public_build:true,allowed_players:["FRIEND"],player_roles:{FRIEND:"builder"}}]}};
assert.equal(prepare({},owner,"TEST",patch),true);
assert.equal(patch.state.area_locks.length,2);
assert.deepEqual(patch.state.area_locks[1],state.area_locks[1],"Other locks survive a partial update unchanged");
assert.equal(patch.state.area_locks[0].public_build,true);
state.area_locks=patch.state.area_locks;
assert.equal(prepare({},owner,"TEST",{state:{area_locks:[{...state.area_locks[1],public_build:true}]}}),false);
assert.deepEqual(rejected,["area_lock_denied"]);
const canArea=compile("canPlayerBuildInAreaLock",{canPlayerManageAreaLock:canManage,getAreaLockRoleForPlayer:(lock,p)=>lock.player_roles?.[p.name]||"visitor"});
const canBuild=compile("canPlayerBuildAtGrid",{
  ensureWorldState:()=>state,getAreaLockCoveringGrid:(_s,x)=>x<10?state.area_locks[0]:null,
  canPlayerBuildInAreaLock:canArea,canPlayerBuildInWorld:p=>p.name==="WORLDOWNER"
});
const guest={name:"GUEST",authenticated:true},friend={name:"FRIEND",authenticated:true};
assert(canBuild(guest,"TEST",6,6),"Public area permits building inside a private world");
assert(!canBuild(guest,"TEST",20,6),"Surrounding world stays protected");
state.area_locks[0].public_build=false;
assert(canBuild(friend,"TEST",6,6),"Named builder access works inside private worlds");
assert(!canBuild(guest,"TEST",6,6),"Private area denies guests");
assert(!canBuild({name:"FRIEND",authenticated:false},"TEST",6,6));
console.log("[area-lock-settings] PASS: scoped updates, ownership, public access, named builders and surrounding world protection");
