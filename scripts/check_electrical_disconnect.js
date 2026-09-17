"use strict";
const assert = require("node:assert/strict");
const { createServerPhase8WorldActionRoutes } = require("../server_phase8_world_action_routes");

function fixture(overrides = {}) {
  let state = { generator: { x: 1, y: 1, device_type: "generator", pads: ["2,2"], poles: ["3,3"] }, poles: { "3,3": { x: 3, y: 3, device_type: "electric_pole", links: ["4,4"] }, "4,4": { x: 4, y: 4, device_type: "electric_pole", links: ["3,3"] } } };
  const events = [], rejections = [];
  const deps = {
    requireAuthenticated: () => true, requireSameWorld: () => true, rejectIfWorldBanned: async () => false,
    cleanWorld: x => x, gridKey: (x,y) => `${x},${y}`, isGridInWorld: () => true, isPlayerNearGrid: () => true,
    canPlayerViewElectricalLayer: () => true, playerHasElectricToolEquipped: () => true, canPlayerBuildAtGrid: () => true,
    ensureWorldState: () => state, getGeneratorDeviceStateAt: () => state.generator,
    getMetalPadDeviceStateAt: () => ({device_type: "metal_pad"}),
    getElectricPoleDeviceStateAt: (_s,x,y) => state.poles[`${x},${y}`],
    findGeneratorLinkedToPad: () => state.generator.pads.length ? "1,1" : "", getGeneratorKeysLinkedToPole: () => state.generator.poles.length ? ["1,1"] : [],
    getGeneratorLinkedPadKeys: g => g.pads, getGeneratorLinkedPoleKeys: g => g.poles, getPoleLinkedPoleKeys: p => p.links,
    setGeneratorLinkedPadKeys: (g,v) => {g.pads=v;}, setGeneratorLinkedPoleKeys: (g,v) => {g.poles=v;}, setPoleLinkedPoleKeys: (p,v) => {p.links=v;},
    serializeWorldState: () => structuredClone(state), deserializeWorldState: (_w,s) => s,
    worldStates: {set: (_w,s) => {state=s;}}, cloneJson: structuredClone, markElectricalNetworksDirty: () => events.push("dirty"),
    makeAuditId: () => "test", makeGeneratorDataPayload: (_w,g,extra) => ({...structuredClone(g),...extra}),
    buildWorldObjectChangeEntry: (_s,_p,_w,action,before,after) => ({...action,before,after}),
    commitWorldStateWithBlockChanges: async (_w,changes) => {events.push({commit: changes}); return {ok:true,postgres_committed:true};},
    sendElectricalPayloadToVisiblePlayers: () => events.push("broadcast"), refreshElectricalVisibilityForWorld: () => events.push("broadcast"),
    sendElectricalVisibilityRefresh: () => events.push("refresh"), sendJson: () => events.push("reply"),
    logWorldChange: () => events.push("journal"), sendActionRejected: (_s,_a,_m,extra) => rejections.push(extra.reason),
    ELECTRICAL_DEVICE_GENERATOR: "generator", ELECTRICAL_DEVICE_METAL_PAD: "metal_pad", ELECTRICAL_DEVICE_POLE: "electric_pole",
    ELECTRICAL_GENERATOR_ITEM: "generator", ELECTRICAL_POLE_ITEM: "electric_pole",
    ELECTRICAL_MAX_PADS_PER_GENERATOR: 1, ELECTRICAL_MAX_POLES_PER_GENERATOR: 1, ELECTRICAL_MAX_TRANSFORMER_LINKS_PER_POLE: 1, ELECTRICAL_MAX_POLE_LINKS_PER_POLE: 1,
    ...overrides,
  };
  return {routes:createServerPhase8WorldActionRoutes(deps), state:()=>state, events,rejections};
}
const payload={world:"TEST",generator_x:1,generator_y:1,pad_x:2,pad_y:2,pole_x:3,pole_y:3,pole_a_x:3,pole_a_y:3,pole_b_x:4,pole_b_y:4,disconnect:true};
(async()=>{
  for(const method of ["handleRequestLinkGeneratorPad","handleRequestLinkGeneratorPole","handleRequestLinkElectricPoles"]){
    const f=fixture();
    await f.routes[method]({}, {world:"TEST"},payload,{});
    assert.equal(f.rejections.length,0);
    if(method.endsWith("Pad")) assert.deepEqual(f.state().generator.pads,[]);
    else if(method.endsWith("Pole")) assert.deepEqual(f.state().generator.poles,[]);
    else {assert.deepEqual(f.state().poles["3,3"].links,[]);assert.deepEqual(f.state().poles["4,4"].links,[]);}
    assert.ok(f.events.findIndex(x=>x.commit)>=0);
    assert.ok(f.events.findIndex(x=>x.commit)<f.events.indexOf("broadcast"),"persist before broadcast");
    // Reconnect is the inverse operation used by Undo, through the same validation.
    await f.routes[method]({}, {world:"TEST"},{...payload,disconnect:false},{});
    assert.equal(f.rejections.length,0);
    if(method.endsWith("Pad")) assert.deepEqual(f.state().generator.pads,["2,2"]);
    else if(method.endsWith("Pole")) assert.deepEqual(f.state().generator.poles,["3,3"]);
    else assert.deepEqual(f.state().poles["3,3"].links,["4,4"]);
    const denied=fixture({playerHasElectricToolEquipped:()=>false});
    await denied.routes[method]({}, {world:"TEST"},payload,{});
    assert.deepEqual(denied.rejections,["electric_tool_required"]);
    assert.equal(denied.events.length,0);
    const failed=fixture({commitWorldStateWithBlockChanges:async()=>({ok:false,reason:"db_failed"})});
    const before=structuredClone(failed.state());
    await failed.routes[method]({}, {world:"TEST"},payload,{});
    assert.deepEqual(failed.state(),before,"failed commit restores wiring");
    assert.ok(!failed.events.includes("broadcast"));
  }
  console.log("[electrical-disconnect] remove, undo, permissions and rollback passed");
})().catch(e=>{console.error(e);process.exitCode=1;});
