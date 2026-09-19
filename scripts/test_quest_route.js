const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
const start=source.indexOf('async function handleInventoryTransactionRequest(');
const end=source.indexOf('\nasync function handleInventoryUpgradePurchase(',start);
assert(start>0&&end>start);
async function run(overrides={}){
 let applied=0,released=0,response=null,rejected=null,legacy=0;
 const player={authenticated:true,account_username:'tester',world:'START'};
 const context={
  requireAuthenticated:()=>true,makeRequestId:()=> 'route-test',cleanWorld:s=>s,
  rejectIfWorldBanned:async()=>false,getTransactionGrid:d=>({x:d.x,y:d.y}),isPlayerNearGrid:()=>true,
  ensureWorldState:()=>({foreground:new Map([['1,2',{block_type:'quest_board'}]])}),gridKey:(x,y)=>`${x},${y}`,
  acquirePlayerInventoryLocks:async()=>({acquired:true}),releasePlayerInventoryLocks:()=>released++,
  flushPendingSessionPersistence:async()=>({ok:true}),postgresStore:{},getSocketAddress:()=> '127.0.0.1',
  ServerQuestStore:{apply:async()=>{applied++;return {ok:true,board:{stamps:4},gems:15,message:'Done'};}},
  refreshPlayerStateFromPostgres:async()=>({ok:true,state:{gems:15}}),buildPlayerStateForClient:s=>s,
  sendInventoryTransactionResult:(_,r)=>response=r,sendInventoryTransactionRejected:(_,d,m)=>rejected=m,
  queueFailedTransactionLedger:()=>{},...overrides,
  getServerInventoryEconomyRoutes:()=>({handleInventoryTransactionRequest:()=>{legacy++;}}),
 };
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 // Exercise the actual dispatcher dependency, not only the leaf quest handler.
 const binding=source.match(/handleInventoryTransactionRequest: ([^\r\n]+),/);
 assert(binding,'Missing inventory dispatcher binding');
 const handler=vm.runInContext('('+binding[1]+')',context);
 const routes=require('../server_phase9_remaining_routes').createServerPhase9RemainingRoutes({handleInventoryTransactionRequest:handler});
 await routes.handleInventoryTransactionRequest({},player,{action:'quest_accept',world:'START',x:1,y:2});
 assert.equal(legacy,0,'Quest packets must not bypass the quest handler');
 await routes.handleInventoryTransactionRequest({},player,{action:'shop_buy',world:'START'});
 assert.equal(legacy,1,'Ordinary inventory actions must keep their existing route');
 return {applied,released,response,rejected};
}
(async()=>{
 const normal=await run();assert.equal(normal.applied,1);assert.equal(normal.released,1);assert.equal(normal.response.player_data.gems,15);assert.equal(normal.response.quest_board.stamps,4);
 assert.equal((await run({isPlayerNearGrid:()=>false})).applied,0);
 assert.equal((await run({ensureWorldState:()=>({foreground:new Map()})})).applied,0);
 assert.equal((await run({rejectIfWorldBanned:async()=>true})).applied,0);
 assert.equal((await run({acquirePlayerInventoryLocks:async()=>({acquired:false})})).applied,0);
 const failedFlush=await run({flushPendingSessionPersistence:async()=>({ok:false})});assert.equal(failedFlush.applied,0);assert.equal(failedFlush.released,1);
 let checks=0;const removed=await run({isPlayerNearGrid:()=>++checks===1});assert.equal(removed.applied,0);assert.equal(removed.released,1);
 console.log('[quest-route] PASS: real handler, board/reach/ban/lock validation, revalidation, authoritative client payload');
})().catch(error=>{console.error(error);process.exitCode=1;});
