"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const runtime=process.env.QUEST_TEST_PGLITE_PATH||"@electric-sql/pglite";
const {PGlite}=require(runtime);
const extension=n=>require(path.isAbsolute(runtime)?path.join(runtime,`dist/contrib/${n}.cjs`):`@electric-sql/pglite/contrib/${n}`)[n];
const Store=require("../postgres_store"),{makePlan,restorePlan}=require("./restore_capped_inventory_identities"),{auditInventoryIdentities}=require("./audit_inventory_identities");
async function main(){
  const db=new PGlite({extensions:{citext:extension("citext"),pgcrypto:extension("pgcrypto")}});
  try{
    await db.exec(fs.readFileSync(path.join(__dirname,"../docs/postgres_security_foundation.sql"),"utf8"));
    const store=new Store({enabled:false,schema:"pixelmania",logger:()=>{}});
    store.pool={query:(sql,args)=>args?db.query(sql,args):db.exec(sql).then(r=>r.at(-1))};
    store.enabled=true;store.ready=true;store.degraded=false;
    await store.ensureInventorySchema();await store.ensurePersistenceSchema();await store.ensureProgressionSchema();
    const account=(await db.query("INSERT INTO pixelmania.accounts(username,email,password_hash) VALUES('test','test@example.invalid','unused') RETURNING account_id")).rows[0].account_id;
    const player=(await db.query("INSERT INTO pixelmania.players(account_id,display_name) VALUES($1,'test') RETURNING player_id",[account])).rows[0].player_id;
    const stack={player_id:player,item_type:"super_world_lock",item_category:"block"};
    await db.query("INSERT INTO pixelmania.inventory(player_id,item_type,item_category,amount,stack_limit) VALUES($1,'super_world_lock','block',400,400)",[player]);
    const origin=(await db.query("INSERT INTO pixelmania.item_transactions(player_id,source,action,item_type,item_category,delta,before_amount,after_amount) VALUES($1,'admin','admin_give','super_world_lock','block',400,0,400) RETURNING item_transaction_id",[player])).rows[0].item_transaction_id;
    const created=await store.syncItemInstancesForLedger(db,{...stack,source:"admin",action:"admin_give",delta:400,after_amount:400,item_transaction_id:origin});
    assert.equal(created.created,400,"Non-strict grants must cover all 400 legal units");
    const original=(await db.query("SELECT item_instance_id FROM pixelmania.item_instances ORDER BY item_instance_id")).rows;
    await store.reconcileItemInstancesForInventory(db,player,{inventory:{super_world_lock:400}},{source:"startup_item_instance_reconcile"});
    assert.equal((await auditInventoryIdentities(db,store)).summary.affected_stacks,0,"Startup must preserve all 400 IDs");
    assert.deepEqual((await db.query("SELECT item_instance_id FROM pixelmania.item_instances WHERE state='active' ORDER BY item_instance_id")).rows,original);
    // Simulate the old truncated desired count without running old application code.
    await store.reconcileItemInstancesForInventory(db,player,{inventory:{super_world_lock:250}},{source:"startup_item_instance_reconcile"});
    const report=await auditInventoryIdentities(db,store);
    assert.equal(report.summary.groups['super_world_lock|block'].missing,150);
    const plan=await makePlan(db,store,stack,origin);
    assert.equal(plan.retired.length,150);
    const ledger=store.recordTransactionLedger.bind(store);
    store.recordTransactionLedger=async()=>{throw new Error("audit unavailable");};
    await assert.rejects(db.transaction(tx=>restorePlan(tx,store,plan,plan.sha256,"test")),/audit unavailable/);
    assert.equal((await auditInventoryIdentities(db,store)).summary.groups['super_world_lock|block'].missing,150);
    assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.admin_actions")).rows[0].count),0);
    store.recordTransactionLedger=ledger;
    await assert.rejects(db.transaction(tx=>restorePlan(tx,store,plan,"wrong","test")),/hash/);
    await db.query("UPDATE pixelmania.inventory SET row_version=row_version+1");
    await assert.rejects(db.transaction(tx=>restorePlan(tx,store,plan,plan.sha256,"test")),/changed since review/);
    const reviewed=await makePlan(db,store,stack,origin);
    // A later gameplay consumption must invalidate the reviewed retirement.
    const instance=reviewed.retired[0];
    await db.transaction(async tx=>{
      await store.recordItemInstanceEvent(tx,{item_instance_id:instance.item_instance_id,event_type:"state_changed",source:"world_block_place",from_player_id:player,to_player_id:player,from_location:"inventory",to_location:"unknown"});
      await assert.rejects(makePlan(tx,store,stack,origin),/evidence/);
      throw new Error("fixture rollback");
    }).catch(e=>assert.match(e.message,/fixture rollback/));
    const result=await db.transaction(tx=>restorePlan(tx,store,reviewed,reviewed.sha256,"restore proven cap retirements"));
    assert.equal(result.restored,150);assert.equal(result.created,0);
    assert.equal((await auditInventoryIdentities(db,store)).summary.affected_stacks,0);
    assert.deepEqual((await db.query("SELECT item_instance_id FROM pixelmania.item_instances WHERE state='active' ORDER BY item_instance_id")).rows,original,"Same original IDs, no replacements");
    assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory")).rows[0].amount),400);
    assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.transaction_ledger WHERE transaction_type='ADMIN_INVENTORY_IDENTITY_RESTORE'")).rows[0].count),150);
    await assert.rejects(db.transaction(tx=>restorePlan(tx,store,reviewed,reviewed.sha256,"repeat")),/250 usable/);
    await store.reconcileItemInstancesForInventory(db,player,{inventory:{super_world_lock:400}},{source:"startup_item_instance_reconcile"});
    await store.reconcileItemInstancesForInventory(db,player,{inventory:{}},{allow_create_missing:false,allow_retire_extra:false});
    assert.equal((await auditInventoryIdentities(db,store)).summary.affected_stacks,0,"Restart and partial verification snapshots cannot undo the repair");
    console.log("INVENTORY_IDENTITY_RESTORE_PASS: 400-unit grant/startup conservation, exact original IDs, stale/history/replay guards, atomic audit rollback");
  }finally{await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
