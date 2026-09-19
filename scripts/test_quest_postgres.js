// Real PostgreSQL SQL/rollback test in an isolated WASM database. No network or .env.
// Set QUEST_TEST_PGLITE_PATH to an installed @electric-sql/pglite directory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtime = process.env.QUEST_TEST_PGLITE_PATH || '@electric-sql/pglite';
const {PGlite} = require(runtime);
const contrib = process.env.QUEST_TEST_PGLITE_PATH ? path.join(runtime,'dist/contrib') : '@electric-sql/pglite/contrib';
const {citext} = require(process.env.QUEST_TEST_PGLITE_PATH ? path.join(contrib,'citext.cjs') : contrib+'/citext');
const {pgcrypto} = require(process.env.QUEST_TEST_PGLITE_PATH ? path.join(contrib,'pgcrypto.cjs') : contrib+'/pgcrypto');
const PostgresStore = require('../postgres_store');
const Quests = require('../server_quest_store');
const Engine = require('../server_quest_engine');

async function main() {
 const db = new PGlite({extensions:{citext,pgcrypto}});
 await db.exec(fs.readFileSync(path.join(__dirname,'../docs/postgres_security_foundation.sql'),'utf8'));
 const store = new PostgresStore({enabled:false,schema:'pixelmania',logger:console.log});
 store.pool = {query:(sql,args)=>args?db.query(sql,args):db.exec(sql).then(r=>r[r.length-1]),connect:async()=>({query:(sql,args)=>db.query(sql,args),release(){}})};
 store.enabled=true;store.ready=true;store.degraded=false;
 // Exercise the same migrations and ledger/hash methods used by the real store.
 await store.ensureInventorySchema();
 await store.ensurePersistenceSchema();
 await Quests.ensureSchema(store); await Quests.ensureSchema(store);
 store.questReady=true;
 store.withTransaction = work => db.transaction(async tx => {
   store.beginIdentityCache(tx);
   try { return await work(tx); } finally { store.endIdentityCache(tx); }
 });
 let board,seq=0;
 async function call(action,payload={},ok=true) {
  const result = await Quests.apply(store,{username:'quest-sql-test',world:'START',request_id:`sql-${++seq}`,action,payload:{revision:board?.revision,...payload}});
  assert.equal(result.ok,ok,result.message);
  if(result.ok)board=result.board;
  return result;
 }
 await call('quest_board_get');
 await call('quest_accept',{tier:'story',quest_id:board.story.id});
 const active=board.active.story;
 for(let clue=0;clue<active.puzzle.clues.length;clue++)await call('quest_inspect',{tier:'story',instance_id:active.id,clue});
 const raw=(await db.query('SELECT state FROM pixelmania.quest_accounts')).rows[0].state;
 await call('quest_solve',{tier:'story',instance_id:active.id,answer:raw.active.story.puzzle.solution});
 // Force a late database failure: all earlier gem, stamp, and receipt writes roll back.
 await db.exec("CREATE FUNCTION pixelmania.fail_quest_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected save failure'; END $$; CREATE TRIGGER fail_quest_save BEFORE UPDATE ON pixelmania.quest_accounts FOR EACH ROW EXECUTE FUNCTION pixelmania.fail_quest_save();");
 await call('quest_choose',{tier:'story',instance_id:active.id,choice:'a'},false);
 assert.equal(Number((await db.query('SELECT count(*) FROM pixelmania.quest_receipts')).rows[0].count),0);
 assert.equal(Number((await db.query('SELECT count(*) FROM pixelmania.gem_ledger')).rows[0].count),0);
 await db.exec('DROP TRIGGER fail_quest_save ON pixelmania.quest_accounts');
 const revision=board.revision;
 await call('quest_choose',{tier:'story',instance_id:active.id,choice:'a'});
 assert.equal(board.stamps,4);
 assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE item_type='gem'")).rows[0].amount),15);
 assert.equal(Number((await db.query('SELECT count(*) FROM pixelmania.gem_ledger')).rows[0].count),1);
 assert.equal(Number((await db.query('SELECT count(*) FROM pixelmania.transaction_ledger')).rows[0].count),1);
 // Concurrent stale completions cannot mint a second reward.
 const retries=await Promise.all(Array.from({length:4},()=>Quests.apply(store,{username:'quest-sql-test',world:'START',request_id:`retry-${++seq}`,action:'quest_choose',payload:{revision,tier:'story',instance_id:active.id,choice:'a'}})));
 assert(retries.every(r=>!r.ok));
 assert.equal(Number((await db.query('SELECT count(*) FROM pixelmania.quest_receipts')).rows[0].count),1);
 assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE item_type='gem'")).rows[0].amount),15);
 const persisted=(await db.query('SELECT state FROM pixelmania.quest_accounts')).rows[0].state;
 assert.equal(Engine.transition(persisted,'quest_board_get',{},Date.now(),'quest-sql-test').board.story_next,2);
 // Even a stale restored state cannot bypass the permanent unique receipt guard.
 raw.active.story.solved=true;
 await db.query('UPDATE pixelmania.quest_accounts SET state=$1::jsonb',[JSON.stringify(raw)]);
 board.revision=raw.revision;
 await call('quest_choose',{tier:'story',instance_id:active.id,choice:'a'},false);
 assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE item_type='gem'")).rows[0].amount),15);
 await db.query('UPDATE pixelmania.quest_accounts SET state=$1::jsonb',[JSON.stringify(persisted)]);
 // Account isolation and fail-closed database readiness.
 const other=await Quests.apply(store,{username:'quest-other-test',world:'START',request_id:'other',action:'quest_board_get',payload:{}});
 assert.equal(other.board.stamps,0);assert.equal(other.board.story_next,1);
 store.questReady=false;
 assert.equal((await Quests.apply(store,{username:'quest-sql-test',action:'quest_board_get',payload:{}})).ok,false);
 await db.close();
 console.log('[quest-postgres] PASS: full schema, migrations, real ledger/hash SQL, atomic rollback, four concurrent duplicate claims, durable reload');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
