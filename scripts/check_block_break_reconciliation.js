'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
function extract(name) {
  const start = source.search(new RegExp('^(?:async )?function '+name+'\\(', 'm'));
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/^(?:async )?function /m);
  return rest.slice(0, end < 0 ? undefined : end + 1);
}
const sent = [], rejections = [], locks = new Set();
const state = {foreground:new Map(), removed_foreground:new Map([['31,32',{block_revision:7}]])};
const sandbox = {
  ensureWorldState:()=>state, gridKey:(x,y)=>`${x},${y}`, getBlockActionReachPixels:()=>96,
  isPlayerNearGrid:()=>true, getWorldLayerMap:()=>state.foreground,
  getWorldRemovedLayerMap:()=>state.removed_foreground, getCollisionAreaAnchorInState:()=>null,
  getEffectiveGeneratedBottomForegroundBlockAt:()=>null,
  sendActionRejected:(_socket,_action,_message,details)=>rejections.push(details),
  sendWorldBlockReconciliation:(socket,player,data,options)=>sent.push({socket,player,data,options}),
  requireAuthenticated:()=>true, worldBlockActionLocks:locks,
  getWorldBlockActionLockResource:(_world,data)=>`TEST:${data.layer}:${data.x},${data.y}`,
  getPlayerCurrentWorldName:()=> 'TEST',
};
vm.createContext(sandbox);
vm.runInContext(extract('validateBlockUpdateAgainstServerState')+'\n'+extract('handleWorldBlockReconcileRequest'),sandbox);
(async()=>{
  // Two players arriving after the same committed removal receive the exact cell repair.
  for (const id of ['player-a','player-b']) {
    const data={action:'break',layer:'foreground',x:31,y:32,block_type:'dirt'};
    const result=await sandbox.validateBlockUpdateAgainstServerState({}, {id}, 'TEST',data,id);
    assert.equal(result.ok,false);
    assert.equal(sent.at(-1).data.request_id,id);
    assert.equal(sent.at(-1).options.reason,'already_broken');
    assert.equal(sent.at(-1).data.x,31);
  }
  assert.equal(state.removed_foreground.size,1);
  assert.equal(state.foreground.size,0);
  assert.equal(rejections.length,2);
  const data={request_id:'pending',block_action:'break',layer:'foreground',x:31,y:32};
  locks.add('TEST:foreground:31,32');
  sandbox.handleWorldBlockReconcileRequest({}, {}, data);
  assert.equal(sent.at(-1).options.authoritative_pending,true,'Uncommitted removal must not be confirmed');
  locks.clear();
  sandbox.handleWorldBlockReconcileRequest({}, {}, data);
  assert.equal(sent.at(-1).options.authoritative_pending,false);
  console.log('Break reconciliation: competing players, exact coordinates/IDs, no reward path, persistence lock gate passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
