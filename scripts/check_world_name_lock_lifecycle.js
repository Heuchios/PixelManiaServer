"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../server.js"),"utf8");
const names=["getEffectiveWorldLockStateInState","makeWorldLockStatePayload","applyWorldLockStateForBlockUpdate","isWorldLockPlacementBlocked"];
const selected=names.map(name=>{const match=source.match(new RegExp("^function "+name+"\\([\\s\\S]*?^}","m"));assert(match,name);return match[0];});
const context={WorldNames:{enabled:true},sanitizeWorldLockState:s=>({...s}),cleanWorld:s=>s,
  state:{},ensureWorldState:()=>context.state,reconcileWorldLockStateWithBlocks:()=>{},
  getWorldLockBlockEntry:s=>s.foreground.size?{block_type:"world_lock",x:4,y:5}:null,
  hasWorldLockBlockInState:s=>s.foreground.size>0,
  makeWorldLockStateForPlacement:()=>({is_locked:true,owner_name:"ALICE"})};
vm.createContext(context);vm.runInContext(selected.join("\n"),context);
for(const status of ["reserved","generated","claimed"]) {
  const lock={is_locked:true,owner_name:"ALICE",persistent_ownership:true};
  context.state={world_name_claim:{status},world_lock:{...lock},world_name_owner:{...lock},foreground:new Map([["4,5",{}]])};
  assert.equal(context.isWorldLockPlacementBlocked("ABC"),true);
  assert.equal(context.getEffectiveWorldLockStateInState(context.state).persistent_ownership,status==="claimed");
  context.state.foreground.clear();
  const payload=context.applyWorldLockStateForBlockUpdate("ABC",{action:"break"},{},true);
  assert.equal(Boolean(payload.state.is_locked),status==="claimed",status+" break protection");
  assert.equal(context.isWorldLockPlacementBlocked("ABC"),false,"A missing physical lock must allow replacement");
  assert.equal(Boolean(context.getEffectiveWorldLockStateInState(context.state).is_locked),status==="claimed");
}
console.log("[world-name-lock-lifecycle] PASS: unpaid release, claimed protection, physical re-placement, and persistent ownership flags");
