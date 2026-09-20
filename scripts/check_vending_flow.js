'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
function extract(name) {
 const start = source.indexOf('async function '+name+'(');
 const end = source.indexOf('\n/**', start);
 return source.slice(start,end);
}
const copy = x => JSON.parse(JSON.stringify(x));
function fixture() {
 const original = {x:1,y:2,owner_username:'owner',pending_wls:0,logs:[],listing:{listing_id:'L',item_id:'dirt',item_category:'block',stock:25,amount_per_sale:10,price_wls:1}};
 let vend=copy(original), error='', purchases=0, commits=0, commitOptions, sound=0, releases=0;
 const buyer={world_lock:20,dirt:0};
 const c={
 worldVendActionLocks:new Map(),VEND_LOG_LIMIT:20,VEND_BLOCK_TYPE:'vending_machine',
 acquireLiveActionLock:async()=>({acquired:true}),acquireVendMutationLock:async()=>({acquired:true}),
 acquirePlayerInventoryLocks:async()=>({acquired:true}),releasePlayerInventoryLocks:()=>{},releaseLiveActionLock:()=>{releases++},
 getVendStateAt:()=>copy(vend),requireSameWorld:()=>true,validateVendAccess:()=>true,
 canPlayerManageVend:p=>p.account_username==='owner',canPlayerPlaceVendingMachine:()=>true,isWorldLocked:()=>true,
 rejectVendTransaction:(_s,_d,m)=>{error=m},sendVendTransactionResult:(_s,_d,_p,_v,ok,m)=>{if(!ok)error=m},
 ItemDatabase:{getStackLimit:()=>200},ensureWritablePlayerState:()=>buyer,
 getInventoryCount:(s,id)=>s[id]||0,canAddItemToState:()=>true,
 makeAuditId:()=> 'new-id',captureWorldMutationRollback:()=>copy(vend),cloneJson:copy,
 setVendStateAt:(_w,v)=>{vend=copy(v);return vend},syncVendVisualBlock:()=> 'vending_machine',
 advanceAuthoritativeWorldRevision:()=>{},serializeWorldState:()=>({}),buildWorldObjectChangeEntry:()=>({}),
 runOwnedWorldPersistence:async(_w,_a,fn)=>({ok:true,value:await fn({})}),
 postgresStore:{applyVendBuyTransaction:async(e)=>{purchases++;return {ok:true,buyer:{after_world_lock:buyer.world_lock-e.price_wls,after_item:buyer.dirt+e.amount,item_type:'dirt',item_category:'block'}}}},
 buildInventoryBaselineForItems:()=>[],makeRequestId:()=> 'request',getSocketAddress:()=>'',
 setInventoryCountInState:(s,id,_cat,n)=>{s[id]=n;return true},persistPlayerInventoryChange:()=>{},markWorldRevisionPersisted:()=>{},writeWorldStateJsonBackup:()=>{},
 logVendingTransaction:()=>{},logItemLedgerForState:()=>{},buildInventoryDeltaClientPayloads:()=>[],sendVendStateUpdateToWorld:()=>{},sendVendPurchaseSoundToRequesterAndWorld:()=>{sound++},
 restoreWorldMutationRollback:(_w,v)=>{vend=v},clampInteger:(v,min,max)=>Math.min(max,Math.max(min,Math.trunc(v))),
 clampString:v=>String(v),accountKey:v=>String(v).toLowerCase(),resolveInventoryCategory:()=> 'block',canListItemInVend:()=>true,
 spendItemFromState:(s,id,_cat,n)=>{s[id]-=n;return true},
 commitPlayerInventoryState:async(_s,_p,_u,_before,after,opts)=>{commits++;commitOptions=opts;return {ok:true,state:after,deltas:[],postgres_committed:true}},persistWorldStateAfterInventoryCommit:()=>{}
 };
 vm.createContext(c);vm.runInContext(extract('handleVendBuy')+'\n'+extract('handleVendSetListing'),c);
 return {c,buyer,get vend(){return vend},get error(){return error},get purchases(){return purchases},get commits(){return commits},get options(){return commitOptions},get sound(){return sound},get releases(){return releases},buy:async(d,stale=original)=>c.handleVendBuy({}, {id:1,account_username:'buyer'},d,'WORLD',stale),list:async(d)=>c.handleVendSetListing({}, {id:2,account_username:'owner'},d,'WORLD',original)};
}
(async()=>{
 let f=fixture();await f.buy({sale_count:2});assert.equal(f.buyer.dirt,20);assert.equal(f.buyer.world_lock,18);assert.equal(f.vend.listing.stock,5);assert.equal(f.sound,1);assert.equal(f.releases,1);
 await f.buy({sale_count:1});assert.equal(f.purchases,1);assert.match(f.error,/stock/);
 for(const n of [0,-1,1.5,3,NaN]){f=fixture();await f.buy({sale_count:n});assert.equal(f.purchases,0);assert.equal(f.releases,1)}
 f=fixture();await f.buy({sale_count:1,expected_listing_id:'L',expected_item_id:'dirt',expected_amount_per_sale:10,expected_price_wls:2});assert.equal(f.purchases,0);assert.match(f.error,/changed/);
 f=fixture();f.c.postgresStore.applyVendBuyTransaction=async()=>({ok:false,reason:'insufficient_inventory'});await f.buy({sale_count:1});assert.equal(f.vend.listing.stock,25);assert.equal(f.vend.pending_wls,0);assert.equal(f.sound,0);
 f=fixture();f.vend.pending_wls=8;f.buyer.dirt=50;await f.list({item_id:'dirt',stock:10,amount_per_sale:1,price_wls:3});assert.equal(f.vend.listing.stock,35);assert.equal(f.vend.pending_wls,8);assert.equal(f.vend.listing.listing_id,'L');assert.equal(f.options.metadata.listing_transaction_id,'L');
 f=fixture();await f.list({item_id:'dirt',stock:0,amount_per_sale:1,price_wls:5});assert.equal(f.vend.listing.stock,25);assert.equal(f.vend.listing.price_wls,5);assert.equal(f.commits,1);
 f=fixture();await f.list({item_id:'stone',stock:1,amount_per_sale:1,price_wls:1});assert.equal(f.commits,0);
 console.log('[vending-flow] quantity, quote changes, remainder stock, rollback, restock, price edits and effects passed');
})().catch(e=>{console.error(e);process.exitCode=1});
