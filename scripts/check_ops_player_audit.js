"use strict";
// Real PostgreSQL semantics in an isolated WASM database; never reads .env.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const http=require("node:http");
const runtime=process.env.OPS_TEST_PGLITE_PATH || "@electric-sql/pglite";
const {PGlite}=require(runtime);
const contrib=process.env.OPS_TEST_PGLITE_PATH ? path.join(runtime,"dist/contrib") : "@electric-sql/pglite/contrib";
const {citext}=require(process.env.OPS_TEST_PGLITE_PATH ? path.join(contrib,"citext.cjs") : `${contrib}/citext`);
const {pgcrypto}=require(process.env.OPS_TEST_PGLITE_PATH ? path.join(contrib,"pgcrypto.cjs") : `${contrib}/pgcrypto`);
const {PlayerAudit,sha256,redact,filters}=require("../ops_player_audit");
const Contracts=require("../postgres_store_contracts");
const root=path.resolve(__dirname,"..");
const A="10000000-0000-0000-0000-000000000001",B="10000000-0000-0000-0000-000000000002",C="10000000-0000-0000-0000-000000000003";
const P="20000000-0000-0000-0000-000000000001",Q="20000000-0000-0000-0000-000000000002",W="30000000-0000-0000-0000-000000000001";
const I="40000000-0000-0000-0000-000000000001",CORR="50000000-0000-0000-0000-000000000001";
async function main(){
  const db=new PGlite({extensions:{citext,pgcrypto}});
  await db.exec(fs.readFileSync(path.join(root,"docs/postgres_security_foundation.sql"),"utf8"));
  const query=(sql,args)=>args ? db.query(sql,args) : db.exec(sql).then(rows=>rows[rows.length-1]);
  // Serialize fixture requests because PGlite has one connection.
  const pool={query,connect:async()=>({query,release(){}})};
  await query(`CREATE TABLE pixelmania.world_area_locks(world_area_lock_id uuid PRIMARY KEY,world_id uuid,lock_key text,lock_type text,owner_player_id uuid,lock_x int,lock_y int);
    CREATE TABLE pixelmania.world_area_lock_access(world_area_lock_id uuid,player_id uuid,role text);`);
  await query(`INSERT INTO pixelmania.accounts(account_id,username,email,password_hash,is_active) VALUES
    ($1,'Alice','alice@example.invalid','NEVER_EXPOSE_PASSWORD',true),($2,'Bob','bob@example.invalid','secret',false),($3,'NewAccount','new@example.invalid','secret',true)`,[A,B,C]);
  await query(`INSERT INTO pixelmania.players(player_id,account_id,display_name,player_state) VALUES ($1,$2,'Alice <script>alert(1)</script>','{"gems":42}'),($3,$4,'Bob','{}')`,[P,A,Q,B]);
  await query(`INSERT INTO pixelmania.worlds(world_id,world_name,owner_player_id) VALUES($1,'ALICE_WORLD',$2)`,[W,P]);
  await query(`INSERT INTO pixelmania.world_members(world_id,player_id,role) VALUES($1,$2,'builder')`,[W,Q]);
  await query(`INSERT INTO pixelmania.world_area_locks VALUES('60000000-0000-0000-0000-000000000001',$1,'2,3','small_lock',$2,2,3)`,[W,Q]);
  await query(`INSERT INTO pixelmania.inventory(player_id,item_type,item_category,amount) VALUES($1,'world_lock','block',2),($1,'dirt','block',100)`,[P]);
  await query(`INSERT INTO pixelmania.item_instances(item_instance_id,public_item_instance_id,item_type,item_category,owner_player_id,created_by_source) VALUES($1,'PM-ITEM-TEST0001','world_lock','block',$2,'shop')`,[I,P]);
  await query(`INSERT INTO pixelmania.item_instance_events(item_instance_id,event_type,from_player_id,to_player_id,from_location,to_location,correlation_id,source) VALUES($1,'owner_changed',$2,$3,'inventory','inventory',$4,'trade'),($1,'created',NULL,$2,NULL,'inventory',NULL,'shop')`,[I,Q,P,CORR]);
  await query(`INSERT INTO pixelmania.item_transactions(player_id,source,action,item_type,item_category,delta,before_amount,after_amount,correlation_id) VALUES($1,'shop','buy','world_lock','block',2,0,2,$2)`,[P,CORR]);
  await query(`INSERT INTO pixelmania.transaction_ledger(player_id,other_player_id,transaction_type,status,item_type,item_category,quantity,public_item_instance_id,item_instance_id,correlation_id,metadata) VALUES($1,$2,'trade','success','world_lock','block',1,'PM-ITEM-TEST0001',$3,$4,'{"session_token":"DO_NOT_LEAK","nested":{"password_hash":"DO_NOT_LEAK"}}'),($1,NULL,'pickup','failed','world_lock','block',1,NULL,NULL,NULL,'{"reason":"duplicate_item_instance"}')`,[P,Q,I,CORR]);
  const ledger=(await query("SELECT * FROM pixelmania.transaction_ledger WHERE status='success'")).rows[0];
  await query("UPDATE pixelmania.transaction_ledger SET transaction_hash=$1 WHERE transaction_ledger_id=$2",[Contracts.buildTransactionLedgerHash(ledger),ledger.transaction_ledger_id]);
  await query(`INSERT INTO pixelmania.gem_ledger(player_id,delta,reason,before_balance,after_balance) VALUES($1,42,'reward',0,42)`,[P]);
  await query(`INSERT INTO pixelmania.security_events(player_id,account_id,severity,event_type,details) VALUES($1,$2,'high','duplicate_instance_blocked','{"reason":"same instance","token":"DO_NOT_LEAK"}'),($1,$2,'low','login_rate_limit','{}')`,[P,A]);
  await query(`INSERT INTO pixelmania.punishments(player_id,issued_by_player_id,punishment_type,reason,is_active,ends_at) VALUES($1,$2,'mute','old punishment',true,now()-interval '1 day'),($1,$2,'trade_ban','revoked punishment',false,NULL),($1,$2,'ban','current punishment',true,NULL)`,[P,Q]);
  await query(`INSERT INTO pixelmania.admin_actions(admin_player_id,action_type,target_type,target_id,metadata) VALUES($1,'inspect','player',$2,'{}')`,[Q,P]);
  await query(`INSERT INTO pixelmania.world_block_changes(world_id,player_id,action,layer,block_x,block_y,block_type_after) VALUES($1,$2,'place','foreground',2,3,'dirt')`,[W,P]);
  await query(`INSERT INTO pixelmania.world_object_changes(world_id,player_id,object_type,object_id,action,old_data,new_data) VALUES($1,$2,'safe','2,3','safe_deposit','{}','{"amount":1}')`,[W,P]);
  await query(`INSERT INTO pixelmania.rollback_jobs(rollback_type,status,reason,target_username) VALUES('player','planned','fixture','Alice')`);
  const svc=new PlayerAudit({pool,env:{POSTGRES_SCHEMA:"pixelmania"}});
  const actor={email:"operator@example.invalid",mode:"session",session_id_hash:"fixture-session"};
  const request=p=>svc.request(new URL(p,"http://localhost"),actor);
  const before=(await query("SELECT password_hash FROM pixelmania.accounts WHERE account_id=$1",[A])).rows[0].password_hash;
  let data=await request("/api/players?limit=1"); assert.equal(data.total,"3"); assert.equal(data.rows.length,1); assert.equal(data.has_more,true);
  assert.equal((await request("/api/players?limit=1&offset=1")).rows[0].username,"Bob");
  assert.equal((await request("/api/players?q=%25")).rows.length,0,"LIKE wildcards are literal search text");
  assert.equal((await request(`/api/players?q=${P}`)).rows[0].username,"Alice");
  assert.equal((await request(`/api/players?q=${encodeURIComponent("' OR 1=1 --")}`)).rows.length,0);
  data=await request(`/api/players/${A}`); assert.equal(data.inventory.length,2); assert.ok(data.flags.some(f=>f.type==="instance_count_mismatch"));
  assert.ok(!JSON.stringify(data).includes("NEVER_EXPOSE_PASSWORD")); assert.ok(!Object.hasOwn(data.profile,"email"));
  const expectedHash=crypto.createHash("sha256").update(JSON.stringify((await query("SELECT item_type,item_category,amount::text,stack_limit::text FROM pixelmania.inventory WHERE player_id=$1 AND amount<>0 ORDER BY item_category,item_type",[P])).rows)).digest("hex");
  await query("UPDATE pixelmania.players SET inventory_hash=$1 WHERE player_id=$2",[expectedHash,P]);
  assert.equal((await request(`/api/players/${A}`)).coverage.inventory_hash,"verified");
  assert.equal((await request(`/api/players/${C}`)).inventory.length,0);
  for(const section of ["worlds","punishments","ledger","items","gems","instances","security","moderation","blocks","objects","rollbacks","flags"]){
    data=await request(`/api/players/${A}/${section}`); assert.ok(data.rows.length>0,`${section} is populated`);
    assert.ok(!JSON.stringify(data).includes("DO_NOT_LEAK"),`${section} redacts secrets`);
    if(section==="punishments") assert.deepEqual(data.rows.map(r=>r.effective_status).sort(),["active","expired","revoked"]);
    if(section==="ledger") assert.equal(data.rows.find(r=>r.status==="success").hash_verification,"verified");
    if(section==="flags") assert.ok(data.rows.some(r=>r.classification==="blocked_or_failed_transaction"));
  }
  data=await request(`/api/players/${A}/ledger?ref=${CORR}`); assert.equal(data.rows.length,1);
  assert.equal((await request(`/api/players/${B}/ledger`)).rows.length,1,"counterparty evidence is included");
  assert.equal((await request(`/api/players/${B}/worlds`)).rows[0].relationship,"builder");
  assert.equal((await request(`/api/players/${B}/worlds`)).rows[0].area_locks[0].role,"owner");
  assert.equal((await request(`/api/players/${A}/ledger?item=dirt`)).rows.length,0);
  assert.equal((await request(`/api/players/${A}/ledger?since=2100-01-01`)).rows.length,0);
  data=await request("/api/players/instances/PM-ITEM-TEST0001?limit=1"); assert.equal(data.instance.owner_username,"Alice"); assert.equal(data.has_more,true);
  const instanceLedger=await request("/api/players/instances/PM-ITEM-TEST0001/ledger"); assert.equal(instanceLedger.rows[0].other_username,"Bob"); assert.equal(instanceLedger.rows[0].hash_verification,"verified");
  assert.equal((await request("/api/players/instances/PM-ITEM-TEST0001?limit=1&offset=1")).rows.length,1);
  await assert.rejects(request("/api/players/not-a-uuid"),e=>e.status===400);
  await assert.rejects(request(`/api/players/${A}/unknown`),e=>e.status===404);
  assert.throws(()=>filters(new URLSearchParams("offset=-1")));
  assert.throws(()=>filters(new URLSearchParams("since=invalid")));
  assert.throws(()=>new PlayerAudit({pool,env:{POSTGRES_SCHEMA:'bad";DROP TABLE accounts;--'}}));
  assert.equal(redact({nested:{refresh_token:"secret"}}).nested.refresh_token,"[redacted]");
  const {audit,...payload}=data; assert.equal(sha256(payload),audit.response_sha256);
  let previous="";
  for(const row of (await query("SELECT * FROM pixelmania.ops_player_access_audit ORDER BY access_id")).rows){
    assert.equal(row.previous_hash,previous); assert.equal(row.entry_hash,sha256({previous_hash:previous,event:row.event}));previous=row.entry_hash;
  }
  assert.equal((await query("SELECT password_hash FROM pixelmania.accounts WHERE account_id=$1",[A])).rows[0].password_hash,before);
  assert.equal((await query("SELECT amount::text FROM pixelmania.inventory WHERE player_id=$1 AND item_type='world_lock'",[P])).rows[0].amount,"2");
  await query("ALTER TABLE pixelmania.ops_player_access_audit RENAME TO ops_player_access_audit_unavailable");
  await assert.rejects(request(`/api/players/${A}`),"must fail closed if durable access audit is unavailable");
  await query("ALTER TABLE pixelmania.ops_player_access_audit_unavailable RENAME TO ops_player_access_audit");
  console.log("OPS_PLAYER_AUDIT_PASS: real SQL, search/pagination, inventory/hash discrepancies, all evidence sections, counterparty/instance tracing, redaction, receipt chain, failed audit denial, gameplay preservation");
  if(process.argv.includes("--serve")){
    let queue=Promise.resolve();
    const server=http.createServer((req,res)=>{queue=queue.then(async()=>{
      const u=new URL(req.url,"http://localhost");
      if(u.pathname.startsWith("/api/")){
        try{const result=u.pathname.startsWith("/api/players")?await request(u.pathname+u.search):u.pathname==="/api/session"?{ok:true,email:"fixture@example.invalid"}:{ok:true};res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(result));}
        catch(e){res.writeHead(e.status||500,{"Content-Type":"application/json"});res.end(JSON.stringify({error:e.message}));}return;
      }
      const name=u.pathname==="/"?"index.html":u.pathname.slice(1);
      if(!/^[a-z.]+$/.test(name)){res.writeHead(404);res.end();return;}
      const file=path.join(root,"ops_dashboard_public",name); if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
      res.writeHead(200,{"Content-Type":name.endsWith(".js")?"application/javascript":name.endsWith(".css")?"text/css":"text/html"});res.end(fs.readFileSync(file));
    }).catch(e=>{res.writeHead(500);res.end("Fixture failed");});});
    server.listen(19094,"127.0.0.1",()=>console.log("Fixture UI: http://127.0.0.1:19094"));
  }else await db.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
