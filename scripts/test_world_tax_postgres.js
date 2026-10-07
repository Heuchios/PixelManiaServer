"use strict";
process.env.WORLD_NAME_CLAIMS_ENABLED = "true";
process.env.WORLD_TAX_ENABLED = "true";
process.env.WORLD_TAX_SUSPENDED = "false"; // Exercise the archived active implementation in isolation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runtime = process.env.WORLD_NAME_TEST_PGLITE_PATH || "@electric-sql/pglite";
const { PGlite } = require(runtime);
const contrib = process.env.WORLD_NAME_TEST_PGLITE_PATH ? path.join(runtime,"dist/contrib") : "@electric-sql/pglite/contrib";
const { citext } = require(process.env.WORLD_NAME_TEST_PGLITE_PATH ? path.join(contrib,"citext.cjs") : contrib+"/citext");
const { pgcrypto } = require(process.env.WORLD_NAME_TEST_PGLITE_PATH ? path.join(contrib,"pgcrypto.cjs") : contrib+"/pgcrypto");
const PostgresStore = require("../postgres_store");
const Names = require("../server_world_names");
const Tax = require("../server_world_taxes");
async function main() {
  const db = new PGlite({extensions:{citext,pgcrypto}});
  await db.exec(fs.readFileSync(path.join(__dirname,"../docs/postgres_security_foundation.sql"),"utf8"));
  const query = (sql,args) => args ? db.query(sql,args) : db.exec(sql).then(rows => rows[rows.length-1]);
  const store = new PostgresStore({enabled:false,schema:"pixelmania",logger:()=>{}});
  store.pool = {query,connect:async()=>({query,release(){}})};
  store.enabled=true; store.ready=true; store.degraded=false;
  await store.ensureInventorySchema(); await store.ensurePersistenceSchema(); await store.ensureProgressionSchema();
  store.progressionReady=true;
  store.withTransaction = work => db.transaction(async tx => {
    store.beginIdentityCache(tx);
    try {return await work(tx);} finally {store.endIdentityCache(tx);}
  });
  const alice = await store.withTransaction(client => store.ensurePlayerIdentity(client,"taxalice"));
  const bob = await store.withTransaction(client => store.ensurePlayerIdentity(client,"taxbob"));
  const account = async player => (await db.query("SELECT account_id FROM pixelmania.players WHERE player_id=$1",[player])).rows[0].account_id;
  const a = await account(alice), b = await account(bob);
  await Names.ensureSchema(store);
  const lock = id => ({is_locked:true,owner_account_id:id,owner_name:"taxowner"});
  const worlds = [];
  // Existing ownership is counted at activation, without backdated fees.
  // Tax module requires its schema before mirrorOwner, so seed legacy directory rows.
  for (let i=0;i<5;i++) {
    const name = await Names.resolve(store,"TAXWORLD"+i);
    const id = (await db.query("SELECT world_id FROM pixelmania.worlds WHERE world_name=$1",[name])).rows[0].world_id;
    await db.query("UPDATE pixelmania.world_name_registry SET owner_account_id=$2,status='generated',owner_lock=$3 WHERE world_id=$1",[id,a,JSON.stringify(lock(a))]);
    worlds.push({id,name});
  }
  store.ready=false;
  await Tax.ensureSchema(store);
  store.ready=true;
  let info = await Tax.status(store,a);
  assert.equal(info.owned_count,5); assert.equal(info.weekly_gems,1000); assert.equal(info.amount_due,0); assert.equal(info.blocked,false);
  const firstDue = info.next_due_at;
  await Tax.ensureSchema(store);
  assert.equal((await Tax.status(store,a)).next_due_at,firstDue,"Restart must not reset the weekly cycle");
  // Remove unpaid physical lock: release ownership without erasing this week's peak.
  await store.withTransaction(c=>Names.mirrorOwner(store,c,worlds[0].id,{},null));
  assert.equal((await Tax.status(store,a)).owned_count,4);
  assert.equal((await Tax.status(store,a)).current_bill_gems,1000);
  await store.withTransaction(c=>Names.mirrorOwner(store,c,worlds[0].id,lock(a),a));
  assert.equal((await Tax.status(store,a)).owned_count,5);
  for (const w of worlds.slice(0,2)) await store.withTransaction(c=>Names.mirrorOwner(store,c,w.id,lock(b),b));
  info=await Tax.status(store,a);
  assert.equal(info.owned_count,3); assert.equal(info.weekly_gems,0); assert.equal(info.current_bill_gems,1000);
  assert.equal((await Tax.status(store,b)).current_bill_gems,0,"First three worlds are free");
  await db.query("UPDATE pixelmania.world_tax_accounts SET period_start=now()-interval '8 days' WHERE account_id=$1",[a]);
  info=await Tax.status(store,a);
  assert.equal(info.amount_due,1000); assert.equal(info.blocked,false); assert.equal(info.current_bill_gems,0);
  await db.query("UPDATE pixelmania.world_tax_bills SET grace_until=now()-interval '1 second' WHERE account_id=$1",[a]);
  assert.equal((await Tax.status(store,a)).blocked,true);
  await assert.rejects(store.withTransaction(c=>Names.mirrorOwner(store,c,worlds[0].id,lock(a),a)),/overdue world tax/);
  assert.equal((await Names.status(store,worlds[0].name)).owner_account_id,b,"Blocked acquisition rolls back ownership");
  await assert.rejects(Names.reserve(store,worlds[2].name,a,"NEWTAXNAME123",500),/overdue world tax/);
  await assert.rejects(store.withTransaction(c=>Names.prepareClaim(store,c,worlds[3].id,alice,[],{})),/overdue world tax/);
  // Debt is the prior owner's; transferring remaining worlds cannot erase it.
  await store.withTransaction(c=>Names.mirrorOwner(store,c,worlds[2].id,lock(b),b));
  assert.equal((await Tax.status(store,a)).amount_due,1000);
  const pay = (amount=1000,username="taxalice")=>store.applyInventoryDeltaTransaction({
    account_username:username,world:worlds[3].name,source:"world_tax",action:"world_tax_pay",request_id:"tax-test",
    metadata:{tax_amount:amount},deltas:[{item_type:"gem",item_category:"currency",delta:-amount}],
  });
  assert.equal((await pay()).ok,false,"Insufficient funds must not mark bills paid");
  await db.query("INSERT INTO pixelmania.inventory(player_id,item_type,item_category,amount,stack_limit) VALUES($1,'gem','currency',5000,2000000000)",[alice]);
  assert.equal((await pay(1)).ok,false,"Forged amount rejected");
  assert.equal((await pay(1000,"taxbob")).ok,false,"Only own bills can be paid");
  const finish = Tax.finishPayment;
  Tax.finishPayment = async(...args)=>{await finish(...args);throw Error("injected tax failure");};
  assert.equal((await pay()).ok,false);
  Tax.finishPayment=finish;
  assert.equal((await Tax.status(store,a)).amount_due,1000,"Payment and bill clear roll back together");
  assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE player_id=$1 AND item_type='gem'",[alice])).rows[0].amount),5000);
  const results=await Promise.all([pay(),pay(),pay()]);
  assert.equal(results.filter(r=>r.ok).length,1,JSON.stringify(results));
  info=await Tax.status(store,a);
  assert.equal(info.amount_due,0); assert.equal(info.blocked,false); assert.equal(info.history.length,1);
  assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE player_id=$1 AND item_type='gem'",[alice])).rows[0].amount),4000);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixelmania.gem_ledger WHERE player_id=$1 AND delta=-1000",[alice])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixelmania.transaction_ledger WHERE action='world_tax_pay' AND status='success'")).rows[0].n,1);
  await store.withTransaction(c=>Names.mirrorOwner(store,c,worlds[0].id,lock(a),a));
  // Offline accounts catch up every full week; polling does not add duplicate bills.
  await store.withTransaction(c=>Names.mirrorOwner(store,c,worlds[1].id,lock(a),a));
  await db.query("UPDATE pixelmania.world_tax_accounts SET period_start=now()-interval '22 days' WHERE account_id=$1",[a]);
  info=await Tax.status(store,a);
  assert.equal(info.amount_due,1500); assert.equal(info.bills.length,3); assert.equal(info.blocked,true);
  assert.equal((await Tax.status(store,a)).amount_due,1500);
  assert.equal((await pay(1500)).ok,false,"A request ID from a paid bill cannot be replayed against later bills");
  assert.equal((await Tax.status(store,a)).amount_due,1500);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixelmania.transaction_ledger WHERE action='world_tax_assess' AND status='success'")).rows[0].n,4,"Each bill is assessed once in the audit ledger");
  await assert.rejects(store.withTransaction(c=>Tax.authorizeTrade(store,c,worlds[2].id,bob,alice,"blocked-trade")),/overdue world tax/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixelmania.world_tax_transfer_permits")).rows[0].n,0);
  // Authorize while within grace. Crossing its end before the world save must
  // honor the already committed purchase, rather than strand the buyer's gems.
  await db.query("UPDATE pixelmania.world_tax_bills SET grace_until=now()+interval '1 day' WHERE account_id=$1 AND paid_at IS NULL",[a]);
  await assert.rejects(store.withTransaction(async c=>{await Tax.authorizeTrade(store,c,worlds[2].id,bob,alice,"rollback-trade");throw Error("trade rollback");}),/trade rollback/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixelmania.world_tax_transfer_permits")).rows[0].n,0);
  await store.withTransaction(c=>Tax.authorizeTrade(store,c,worlds[2].id,bob,alice,"approved-trade"));
  await db.query("UPDATE pixelmania.world_tax_bills SET grace_until=now()-interval '1 second' WHERE account_id=$1 AND paid_at IS NULL",[a]);
  assert.equal((await Tax.status(store,a)).blocked,true);
  await store.withTransaction(c=>Names.mirrorOwner(store,c,worlds[2].id,lock(a),a));
  assert.equal((await Names.status(store,worlds[2].name)).owner_account_id,a);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixelmania.world_tax_transfer_permits")).rows[0].n,0,"Committed transfer authorization is consumed once");
  console.log("[world-tax-postgres] PASS: activation, restart, allowance, high-water billing, transfers, lock removal, overdue guards, offline catchup, forged/insufficient payments, atomic rollback, duplicate payment, gem and transaction ledgers");
  await db.close();
}
main().catch(error=>{console.error(error);process.exit(1);});
