// Isolated PostgreSQL/WASM; does not contact game servers or read credentials.
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const runtime = process.env.QUEST_TEST_PGLITE_PATH || "@electric-sql/pglite";
const {PGlite} = require(runtime);
const contrib = process.env.QUEST_TEST_PGLITE_PATH ? path.join(runtime,"dist/contrib") : "@electric-sql/pglite/contrib";
const {citext} = require(process.env.QUEST_TEST_PGLITE_PATH ? path.join(contrib,"citext.cjs") : contrib+"/citext");
const {pgcrypto} = require(process.env.QUEST_TEST_PGLITE_PATH ? path.join(contrib,"pgcrypto.cjs") : contrib+"/pgcrypto");
const Store = require("../postgres_store"), Rewards = require("../server_daily_rewards");

async function main() {
  const db = new PGlite({extensions:{citext,pgcrypto}});
  await db.exec(fs.readFileSync(path.join(__dirname,"../docs/postgres_security_foundation.sql"),"utf8"));
  const store = new Store({enabled:false,schema:"pixelmania",logger:()=>{}});
  const query = (sql,args) => args ? db.query(sql,args) : db.exec(sql).then(results => results[results.length-1]);
  store.pool = {query,connect:async()=>({query,release(){}})};
  store.enabled=true;store.ready=true;store.degraded=false;
  await store.ensureInventorySchema();await store.ensurePersistenceSchema();
  await Rewards.ensureSchema(store);await Rewards.ensureSchema(store);
  store.dailyRewardsReady = true;
  let now = 21000 * Rewards.DAY_MS + 60000;
  store.withTransaction = work => db.transaction(async tx => {
    const client = {query:(sql,args)=>sql.startsWith("SELECT floor(extract(epoch FROM clock_timestamp())")
      ? Promise.resolve({rows:[{now_ms:now}]}) : tx.query(sql,args)};
    store.beginIdentityCache(client);
    try {return await work(client);} catch (error) { console.log("[daily-test rollback]",error.message,error.code || ""); throw error; } finally {store.endIdentityCache(client);}
  });
  let sequence=0;
  const call = (action="daily_reward_claim", extra={}) => Rewards.apply(store,{username:"daily-sql-test",world:"START",
    request_id:`claim-${++sequence}`,action,reward_day:Math.floor(now/Rewards.DAY_MS),...extra});
  const count = async table => Number((await db.query(`SELECT count(*) AS total FROM pixelmania.${table}`)).rows[0].total);
  const gems = async () => Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE item_type='gem'")).rows[0]?.amount || 0);
  const status = await call("daily_reward_status");
  assert.equal(status.daily_reward.can_claim,true);assert.equal(status.daily_reward.reset_at,21001*Rewards.DAY_MS);
  assert.equal(await count("daily_reward_receipts"),0);
  for (const reward_day of [undefined,-1,21001,"21000",21000.5]) assert.equal((await call("daily_reward_claim",{reward_day})).ok,false);
  // Force a late write failure after balance, item/gem ledger writes.
  await db.exec("CREATE FUNCTION pixelmania.fail_daily_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER fail_daily_save BEFORE INSERT ON pixelmania.daily_reward_receipts FOR EACH ROW EXECUTE FUNCTION pixelmania.fail_daily_save();");
  assert.equal((await call()).ok,false);
  for (const table of ["daily_reward_receipts","gem_ledger","item_transactions","transaction_ledger"]) assert.equal(await count(table),0,table);
  assert.equal(await gems(),0);
  await db.exec("DROP TRIGGER fail_daily_save ON pixelmania.daily_reward_receipts");
  const claimed = await call("daily_reward_claim",{gems:999999,reward:{gems:999999}});
  assert.equal(claimed.ok,true,claimed.message);assert.equal(claimed.daily_reward.can_claim,false);
  const first = claimed.daily_reward.reward.gems;
  assert([250,1000,5000].includes(first));assert.equal(await gems(),first);
  for (const table of ["daily_reward_receipts","gem_ledger","item_transactions","transaction_ledger"]) assert.equal(await count(table),1,table);
  const ledger = (await db.query("SELECT * FROM pixelmania.transaction_ledger")).rows[0];
  assert.equal(ledger.source,"reward");assert.equal(ledger.transaction_type,"DAILY_REWARD");assert.equal(Number(ledger.quantity),first);assert(ledger.transaction_hash);assert(ledger.gem_ledger_id);
  const results = await Promise.all(Array.from({length:8},()=>call()));
  assert(results.every(result=>result.ok&&result.already_claimed));assert.equal(await gems(),first);
  assert.equal((await call("daily_reward_claim",{username:"DAILY-SQL-TEST"})).already_claimed,true,"Account case changes cannot re-claim");
  // Recreated module/server returns the durable receipt, without re-granting.
  delete require.cache[require.resolve("../server_daily_rewards")];
  const restarted = require("../server_daily_rewards");
  const recovered = await restarted.apply(store,{username:"daily-sql-test",world:"START",action:"daily_reward_status"});
  assert.deepEqual(recovered.daily_reward.reward,claimed.daily_reward.reward);
  now = 21001 * Rewards.DAY_MS;
  assert.equal((await call("daily_reward_claim",{reward_day:21000})).ok,false,"Stale midnight retry must not consume new day");
  assert.equal((await call("daily_reward_status")).daily_reward.can_claim,true);
  const newDay = await call();assert.equal(newDay.ok,true);assert.equal(await count("daily_reward_receipts"),2);
  assert.equal(await gems(),first+newDay.daily_reward.reward.gems);
  now += Rewards.DAY_MS;
  await db.exec("UPDATE pixelmania.inventory SET amount=2147483647 WHERE item_type='gem'");
  assert.equal((await call()).ok,false);assert.equal(await count("daily_reward_receipts"),2);
  assert.equal((await call("daily_reward_status")).daily_reward.can_claim,true);
  const simultaneous = await Promise.all(Array.from({length:8},()=>call("daily_reward_claim",{username:"simultaneous-daily-test"})));
  assert.equal(simultaneous.filter(result=>result.ok && !result.already_claimed).length,1,"Simultaneous first claims award once");
  assert.equal(simultaneous.filter(result=>result.already_claimed).length,7);
  assert.equal(await count("daily_reward_receipts"),3);
  store.dailyRewardsReady=false;assert.equal((await call()).ok,false);
  store.dailyRewardsReady=true;store.withTransaction=async()=>null;
  assert.equal((await call()).ok,false,"Database becoming unavailable returns a retryable result");
  await db.close();
  console.log("DAILY_REWARDS_POSTGRES_PASS: real SQL, odds, atomic rollback, ledgers, duplicate/concurrent retries, restart recovery, UTC rollover, stale day rejection, full balance, unavailable database");
}
main().catch(error=>{console.error(error);process.exit(1);});
