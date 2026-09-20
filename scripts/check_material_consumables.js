"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
const names = new Set(["handleSeedFertilizeTransaction", "authorizeLandfillTicket", "getSeedGrowthRemaining", "speedupSeedGrowthState", "serializeSeedForMessage"]);
const functions = [...names].map(name => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, "m"));
  assert.ok(match, name);
  return match[0];
}).join("\n");

function fixture({remaining = 20000, count = 2, fail = false, near = true, allowed = true, seedPresent = true, item = "fertilizer"} = {}) {
  const now = 2000000000000;
  const original = { x: 1, y: 2, seed_type: "dirt_seed", planted_at: now - (30000 - remaining) * 1000, tree_created_at: now - 5000, max_grow_time: 30000 };
  const world = { seeds: new Map(seedPresent ? [["1,2", original]] : []) };
  let state = { tool_inventory: { [item]: count }, material_inventory: { landfill_ticket: count } };
  const commits = [], results = [], rejected = [], broadcasts = [];
  const context = {
    Date: { now: () => now }, Math, Number, Boolean, SERVER_SEED_GROW_TIME_SECONDS: 30,
    runSeedActionLocked: async (_s, _p, _d, run) => run(),
    getTransactionWorldName: () => "TEST", getTransactionGrid: () => ({ x: 1, y: 2 }),
    clampString: String, requireSameWorld: () => true, rejectIfWorldBanned: async () => false,
    requireBuildPermission: () => allowed, isPlayerNearGrid: () => near, canPlayerBuildAtGrid: () => allowed,
    ensureWorldState: () => world, gridKey: (x,y) => `${x},${y}`, ensureWritablePlayerState: () => state,
    cloneJson: v => structuredClone(v), makeRequestId: () => "request-1",
    getInventoryCount: (s,id,cat) => s[cat + "_inventory"][id] || 0,
    spendItemFromState: (s,id,cat,n) => { const bag = s[cat + "_inventory"]; if ((bag[id] || 0) < n) return false; bag[id] -= n; return true; },
    commitPlayerInventoryState: async (_s,_p,_u,_b,after,options) => { commits.push(options); if(fail) return {ok:false,message:"save failed"}; state=after; return {ok:true,state,deltas:[],postgres_committed:true}; },
    buildInventoryDeltaClientPayloads: () => [], persistWorldStateAfterInventoryCommit: () => {},
    sendWorldUpdateToRequesterAndWorld: (...args) => broadcasts.push(args.at(-1)), logItemLedgerForState: () => {},
    buildWorldObjectChangeEntry: (...args) => ({ old_data: args[4], new_data: args[5] }),
    sendInventoryTransactionResult: (_s,r) => results.push(r),
    sendInventoryTransactionRejected: (_s,_d,message) => rejected.push(message),
    sendActionRejected: (_s,_a,message) => rejected.push(message),
  };
  vm.createContext(context); vm.runInContext(functions, context);
  const player = {account_username:"test",world_entry_session_id:"entry-1"};
  return {context,world,original,commits,results,rejected,broadcasts,state:()=>state,
    use: () => context.handleSeedFertilizeTransaction({},player,{item_id:item}),
    ticket: consume => context.authorizeLandfillTicket({},player,"LANDFILL_1",consume)};
}

(async () => {
  for (const [item,seconds] of [["fertilizer",3600],["super_fertilizer",14400]]) {
    const f=fixture({item}); await f.use();
    assert.equal(f.context.getSeedGrowthRemaining(f.world.seeds.get("1,2")),20000-seconds);
    assert.equal(f.state().tool_inventory[item],1);
    assert.equal(f.world.seeds.get("1,2").tree_created_at,f.original.tree_created_at);
    assert.equal(f.commits[0].world_mutation,true);
    assert.equal(f.broadcasts.length,1);
  }
  const short=fixture({remaining:100}); await short.use(); assert.equal(short.context.getSeedGrowthRemaining(short.world.seeds.get("1,2")),0);
  for(const options of [{remaining:0},{count:0},{near:false},{allowed:false},{seedPresent:false},{item:"battery"}]) {
    const f=fixture(options); await f.use(); assert.equal(f.commits.length,0); assert.equal(f.rejected.length,1);
  }
  const failed=fixture({fail:true}); await failed.use(); assert.equal(failed.world.seeds.get("1,2"),failed.original); assert.equal(failed.state().tool_inventory.fertilizer,2); assert.equal(failed.broadcasts.length,0);
  const ticket=fixture({count:1}); assert.equal(await ticket.ticket(false),true); assert.equal(ticket.state().material_inventory.landfill_ticket,1);
  assert.equal(await ticket.ticket(true),true); assert.equal(ticket.state().material_inventory.landfill_ticket,0); assert.equal(await ticket.ticket(true),false);
  const noTicket=fixture({count:0}); assert.equal(await noTicket.ticket(false),false); assert.equal(noTicket.commits.length,0);
  const badTicket=fixture({fail:true}); assert.equal(await badTicket.ticket(true),false); assert.equal(badTicket.state().material_inventory.landfill_ticket,2);
  console.log("Material consumables: growth reduction, caps, permissions, stock, rollback and ticket commits passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
