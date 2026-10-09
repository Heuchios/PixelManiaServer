"use strict";
// Explicit operator recovery of ORIGINAL identities retired by the historical
// 250-unit startup cap. Never mint replacements, modify counts, or revive items
// consumed by gameplay. The detailed reviewed plan stays on the database host.
const fs=require("node:fs"), path=require("node:path"), crypto=require("node:crypto");
const hash=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");

async function makePlan(client,store,stack,originTransactionId) {
  if(!Number.isSafeInteger(Number(originTransactionId)) || Number(originTransactionId)<=0) throw new Error("Reviewed original grant transaction required");
  const args=[stack.player_id,stack.item_type,stack.item_category];
  const inventory=(await client.query(`SELECT player_id,item_type,item_category,amount,stack_limit,row_version
    FROM ${store.table("inventory")} WHERE player_id=$1 AND item_type=$2 AND item_category=$3`,args)).rows[0];
  if(!inventory || Number(inventory.amount)<=250 || Number(inventory.amount)>400) throw new Error("Expected a legal stack affected by the old 250 cap");
  const active=(await client.query(`SELECT item_instance_id,public_item_instance_id,current_location
    FROM ${store.table("item_instances")} WHERE owner_player_id=$1 AND item_type=$2 AND item_category=$3 AND state='active'
    ORDER BY item_instance_id`,args)).rows;
  if(active.length!==250 || active.some(i=>i.current_location!=="inventory")) throw new Error("Expected exactly 250 usable existing identities");
  const retired=(await client.query(`SELECT i.*,e.item_instance_event_id AS last_event_id
    FROM ${store.table("item_instances")} i
    JOIN ${store.table("item_transactions")} t ON t.item_transaction_id=i.origin_transaction_id
    CROSS JOIN LATERAL (SELECT * FROM ${store.table("item_instance_events")} e
      WHERE e.item_instance_id=i.item_instance_id ORDER BY e.created_at DESC,e.item_instance_event_id DESC LIMIT 1) e
    WHERE i.owner_player_id=$1 AND i.item_type=$2 AND i.item_category=$3
      AND i.state='consumed' AND i.current_location='unknown' AND i.origin_transaction_id=$4
      AND i.metadata->>'source'='inventory_snapshot_reconcile'
      AND e.event_type='retired' AND e.source='startup_item_instance_reconcile'
      AND e.metadata->>'reason'='inventory_snapshot_reconcile'
      AND e.from_player_id=$1 AND e.to_player_id=$1 AND e.from_location='inventory' AND e.to_location='unknown'
      AND t.player_id=$1 AND t.item_type=$2 AND t.item_category=$3 AND t.source='admin' AND t.action='admin_give' AND t.delta>0
    ORDER BY i.item_instance_id`,[...args,originTransactionId])).rows;
  if(retired.length!==Number(inventory.amount)-active.length) throw new Error("Retirement evidence does not exactly cover the missing identities");
  const body={version:1,origin_transaction_id:String(originTransactionId),inventory,active,retired};
  return {...body,sha256:hash(body)};
}

async function restorePlan(client,store,plan,expectedHash,reason) {
  const {sha256,...body}=plan;
  if(!expectedHash || sha256!==expectedHash || hash(body)!==expectedHash) throw new Error("Plan hash mismatch");
  if(!String(reason||"").trim()) throw new Error("Operator reason required");
  const s=plan.inventory;
  await client.query(`SELECT player_id FROM ${store.table("players")} WHERE player_id=$1 FOR UPDATE`,[s.player_id]);
  await client.query(`SELECT player_id FROM ${store.table("inventory")} WHERE player_id=$1 AND item_type=$2 AND item_category=$3 FOR UPDATE`,[s.player_id,s.item_type,s.item_category]);
  await client.query(`SELECT item_instance_id FROM ${store.table("item_instances")} WHERE owner_player_id=$1 AND item_type=$2 AND item_category=$3 ORDER BY item_instance_id FOR UPDATE`,[s.player_id,s.item_type,s.item_category]);
  const fresh=await makePlan(client,store,s,plan.origin_transaction_id);
  if(fresh.sha256!==expectedHash) throw new Error("Inventory or identity history changed since review");
  const requestId=`inventory-cap-restore-${crypto.randomUUID()}`;
  const audit=(await client.query(`INSERT INTO ${store.table("admin_actions")}
    (action_type,target_type,target_id,request_id,metadata) VALUES ('inventory_identity_restore','player',$1,$2,$3::jsonb) RETURNING admin_action_id`,
    [s.player_id,requestId,JSON.stringify({operator:"authenticated_ssh_operator",reason,plan_sha256:expectedHash,before:plan})])).rows[0];
  const ids=plan.retired.map(i=>i.item_instance_id);
  await client.query(`UPDATE ${store.table("item_instances")} SET state='active',current_location='inventory',updated_at=now(),
    metadata=metadata||$2::jsonb WHERE item_instance_id=ANY($1::uuid[])`,[ids,JSON.stringify({admin_corrected:true,identity_restore_request:requestId})]);
  for(const item of plan.retired) {
    await store.recordItemInstanceEvent(client,{item_instance_id:item.item_instance_id,event_type:"reconciled",
      from_player_id:s.player_id,to_player_id:s.player_id,from_location:"unknown",to_location:"inventory",source:"admin",
      metadata:{action:"inventory_identity_restore",previous_state:"consumed",state:"active",reason,plan_sha256:expectedHash,
        request_id:requestId,previous_event_id:item.last_event_id,public_item_instance_id:item.public_item_instance_id}});
  }
  await store.recordTransactionLedger(client,{player_id:s.player_id,source:"admin",action:"inventory_identity_restore",
    transaction_type:"ADMIN_INVENTORY_IDENTITY_RESTORE",admin_action_id:audit.admin_action_id,request_id:requestId,
    item_type:s.item_type,item_category:s.item_category,item_instances:plan.retired.map(i=>({...i,state:"active",current_location:"inventory"})),
    metadata:{reason,plan_sha256:expectedHash,quantity_before:Number(s.amount),quantity_after:Number(s.amount),quantity_delta:0}});
  return {request_id:requestId,restored:ids.length,quantity_before:Number(s.amount),quantity_after:Number(s.amount),created:0};
}

async function main() {
  const args=process.argv.slice(2),option=k=>{const n=args.indexOf(k);return n<0?"":args[n+1]||"";};
  const root=process.env.PIXELMANIA_REPAIR_ROOT||path.resolve(__dirname,"..");
  require(path.join(root,"node_modules/dotenv")).config({path:path.join(root,".env"),quiet:true});
  const Store=require(path.join(root,"postgres_store")),{Pool}=require(path.join(root,"node_modules/pg")),e=process.env;
  const store=new Store({enabled:false,schema:e.POSTGRES_SCHEMA||"pixelmania"});
  const pool=new Pool({connectionString:e.POSTGRES_CONNECTION_STRING||e.DATABASE_URL,host:e.POSTGRES_HOST,port:Number(e.POSTGRES_PORT||5432),
    database:e.POSTGRES_DATABASE,user:e.POSTGRES_USER,password:e.POSTGRES_PASSWORD,ssl:e.POSTGRES_SSL==="true"?{rejectUnauthorized:false}:undefined});
  const client=await pool.connect();
  try {
    if(option("--apply")) {
      const plan=JSON.parse(fs.readFileSync(option("--apply"),"utf8"));
      fs.writeFileSync(`${option("--apply")}.before-${Date.now()}.json`,JSON.stringify(plan),{flag:"wx",mode:0o600});
      await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='60s'");
      const result=await restorePlan(client,store,plan,option("--expect-hash"),option("--reason"));
      await client.query("COMMIT");console.log(JSON.stringify(result));
    } else {
      if(!option("--audit")||!option("--out")) throw new Error("Use --audit server-side-audit.json --out plan.json; apply with --apply plan.json --expect-hash SHA --reason TEXT");
      const audit=JSON.parse(fs.readFileSync(option("--audit"),"utf8"));
      const rows=audit.mismatches||audit.rows;
      if(!rows||rows.length!==1) throw new Error("Expected one reviewed affected stack");
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const plan=await makePlan(client,store,rows[0],option("--origin-transaction"));await client.query("ROLLBACK");
      fs.writeFileSync(option("--out"),JSON.stringify(plan,null,2),{flag:"wx",mode:0o600});
      console.log(JSON.stringify({mode:"dry_run",sha256:plan.sha256,restored:plan.retired.length,quantity:plan.inventory.amount,created:0}));
    }
  } catch(err) {await client.query("ROLLBACK");throw err;} finally {client.release();await pool.end();}
}
module.exports={makePlan,restorePlan};
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
