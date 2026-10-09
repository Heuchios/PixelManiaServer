"use strict";
const path = require("node:path");
const root = process.env.PIXELMANIA_REPAIR_ROOT || path.resolve(__dirname,"..");
const Contracts = require(path.join(root,"postgres_store_contracts"));

async function auditInventoryIdentities(client, store) {
  const result = await client.query(`WITH ids AS (
    SELECT owner_player_id AS player_id,item_type,item_category,
      count(*)::integer AS active,
      count(*) FILTER (WHERE current_location='inventory' AND public_item_instance_id LIKE 'PM-ITEM-%')::integer AS usable
    FROM ${store.table("item_instances")} WHERE state='active' AND owner_player_id IS NOT NULL
    GROUP BY owner_player_id,item_type,item_category
  ) SELECT coalesce(v.player_id,i.player_id) AS player_id,
      coalesce(v.item_type,i.item_type) AS item_type,coalesce(v.item_category,i.item_category) AS item_category,
      coalesce(v.amount,0)::integer AS amount,coalesce(i.active,0)::integer AS active,coalesce(i.usable,0)::integer AS usable
    FROM ${store.table("inventory")} v FULL JOIN ids i USING(player_id,item_type,item_category)
    WHERE coalesce(v.amount,0)>0 OR coalesce(i.active,0)>0`);
  const tracked = result.rows.filter(r => Contracts.shouldTrackItemInstance(r.item_type,r.item_category));
  const mismatches = tracked.filter(r => r.amount !== r.usable || r.active !== r.usable);
  const groups = {};
  for (const r of mismatches) {
    const g = groups[`${r.item_type}|${r.item_category}`] ||= {stacks:0, missing:0, extra:0, invalid:0};
    g.stacks++; g.missing += Math.max(0,r.amount-r.usable); g.extra += Math.max(0,r.usable-r.amount); g.invalid += r.active-r.usable;
  }
  const players = Number((await client.query(`SELECT count(*) FROM ${store.table("players")}`)).rows[0].count);
  return { summary: { players, inventory_stacks:result.rows.length, tracked_stacks:tracked.length,
    affected_stacks:mismatches.length, affected_players:new Set(mismatches.map(r=>r.player_id)).size, groups }, mismatches };
}

async function main() {
  require(path.join(root,"node_modules/dotenv")).config({path:path.join(root,".env"),quiet:true});
  const {Pool} = require(path.join(root,"node_modules/pg")), Store = require(path.join(root,"postgres_store")), e=process.env;
  const store = new Store({enabled:false,schema:e.POSTGRES_SCHEMA||"pixelmania"});
  const pool = new Pool({connectionString:e.POSTGRES_CONNECTION_STRING||e.DATABASE_URL,
    host:e.POSTGRES_HOST,port:Number(e.POSTGRES_PORT||5432),database:e.POSTGRES_DATABASE,user:e.POSTGRES_USER,password:e.POSTGRES_PASSWORD,
    ssl:e.POSTGRES_SSL==="true"?{rejectUnauthorized:false}:undefined});
  const client=await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='60s'");
    const report=await auditInventoryIdentities(client,store);
    await client.query("ROLLBACK");
    const outIndex=process.argv.indexOf("--out");
    if(outIndex>=0) require("node:fs").writeFileSync(process.argv[outIndex+1],JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
    console.log(JSON.stringify(report.summary,null,2));
    if(report.mismatches.length) process.exitCode=2;
  } finally {client.release();await pool.end();}
}
module.exports={auditInventoryIdentities};
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
