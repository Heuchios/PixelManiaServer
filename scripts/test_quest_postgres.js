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
 await store.ensureProgressionSchema();
 store.progressionReady=true;
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
 await call('quest_choose',{tier:'story',instance_id:active.id,choice:'a'},false);
 const raw=(await db.query('SELECT state FROM pixelmania.quest_accounts')).rows[0].state;
 await call('quest_solve',{tier:'story',instance_id:active.id,answer:raw.active.story.puzzle.solution},false);
 const playerId=(await db.query('SELECT player_id FROM pixelmania.quest_accounts')).rows[0].player_id;
 const objective=active.objectives[0];
 const action={plant:'seed_place',splice:'seed_splice',harvest:'seed_harvest',fish:'fishing_complete',break:'world_block_break'}[objective.action];
 for(let i=0;i<objective.target;i++){
  if(i===0&&action==='seed_place'){
   await db.query("INSERT INTO pixelmania.inventory(player_id,item_type,item_category,amount,stack_limit) VALUES($1,'dirt_seed','seed',20,400)",[playerId]);
   const real=await store.applyInventoryDeltaTransaction({username:'quest-sql-test',source:'seed_place',action:'seed_place',request_id:'real-plant',deltas:[{item_type:'dirt_seed',item_category:'seed',delta:-1,expected_before_amount:20}],metadata:{transaction_id:'real-plant',seed_type:'dirt_seed'}});
   assert.equal(real.ok,true,JSON.stringify(real));continue;
  }
  await db.transaction(async tx=>{
   const metadata={seed_type:objective.item_type,item_id:objective.item_type,block_type:objective.item_type,item_category:'fish',matured:true};
   await Quests.recordGameplay(store,tx,playerId,action,metadata,'event-'+i);
   await Quests.recordGameplay(store,tx,playerId,action,metadata,'event-'+i);
  });
 }
 await call('quest_board_get');assert.equal(board.active.story.progress[0],objective.target);
 assert.equal(Number((await db.query('SELECT count(*) FROM pixelmania.quest_gameplay_events')).rows[0].count),objective.target);
 // Fake catches, immature trees, rejected requests and rolled-back gameplay cannot count.
 await db.transaction(async tx=>{
  await Quests.recordGameplay(store,tx,playerId,'seed_harvest',{seed_type:'dirt_seed',matured:false},'immature');
  await Quests.recordGameplay(store,tx,playerId,'fishing_complete',{item_category:'block'},'junk');
 });
 await assert.rejects(db.transaction(async tx=>{await Quests.recordGameplay(store,tx,playerId,'seed_place',{seed_type:'dirt_seed'},'rollback-action');throw Error('rollback');}));
 assert.equal(Number((await db.query('SELECT count(*) FROM pixelmania.quest_gameplay_events')).rows[0].count),objective.target);
 // Force a late database failure: all earlier gem, stamp, and receipt writes roll back.
 await db.exec("CREATE FUNCTION pixelmania.fail_quest_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected save failure'; END $$; CREATE TRIGGER fail_quest_save BEFORE UPDATE ON pixelmania.quest_accounts FOR EACH ROW EXECUTE FUNCTION pixelmania.fail_quest_save();");
 await call('quest_choose',{tier:'story',instance_id:active.id,choice:'a'},false);
 assert.equal(Number((await db.query('SELECT count(*) FROM pixelmania.quest_receipts')).rows[0].count),0);
 assert.equal(Number((await db.query('SELECT count(*) FROM pixelmania.gem_ledger')).rows[0].count),0);
 assert.equal(Number((await db.query('SELECT player_total_xp FROM pixelmania.players WHERE player_id=$1',[playerId])).rows[0].player_total_xp),0);
 await db.exec('DROP TRIGGER fail_quest_save ON pixelmania.quest_accounts');
 const revision=board.revision;
 await call('quest_choose',{tier:'story',instance_id:active.id,choice:'a'});
 assert.equal(board.stamps,0);
 assert.equal(Number((await db.query('SELECT player_total_xp FROM pixelmania.players WHERE player_id=$1',[playerId])).rows[0].player_total_xp),75);
 assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE item_type='gem'")).rows[0].amount),15);
 assert.equal(Number((await db.query('SELECT count(*) FROM pixelmania.gem_ledger')).rows[0].count),1);
 assert.equal(Number((await db.query("SELECT count(*) FROM pixelmania.transaction_ledger WHERE transaction_type='QUEST_REWARD'")).rows[0].count),1);
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
 assert.equal(Number((await db.query('SELECT player_total_xp FROM pixelmania.players WHERE player_id=$1',[playerId])).rows[0].player_total_xp),75);
 // Named objectives reject wrong species; every gameplay category is reconciled from committed rows.
 const tracking=structuredClone(raw);
 tracking.active.story.accepted_at=Date.now()+1000;
 tracking.active.story.objectives=[
  {action:'plant',item_type:'grass_seed',target:1},
  {action:'splice',item_type:'grass_seed',target:1},
  {action:'harvest',item_type:'grass_seed',target:1},
  {action:'fish',item_type:'',target:1},
  {action:'break',item_type:'stone',target:1},
 ];
 await db.query('UPDATE pixelmania.quest_accounts SET state=$1::jsonb WHERE player_id=$2',[JSON.stringify(tracking),playerId]);
 await db.transaction(async tx=>{
  for(const source of ['seed_place','seed_splice','seed_harvest'])await Quests.recordGameplay(store,tx,playerId,source,{seed_type:'dirt_seed',matured:true},'wrong-'+source);
 });
 await call('quest_board_get');assert.deepEqual(board.active.story.progress,[0,0,0,0,0]);
 await db.transaction(async tx=>{
  for(const source of ['seed_place','seed_splice','seed_harvest'])await Quests.recordGameplay(store,tx,playerId,source,{seed_type:'grass_seed',matured:true},'valid-'+source);
  await Quests.recordGameplay(store,tx,playerId,'fishing_complete',{item_id:'trout',item_category:'fish'},'valid-fish');
  // Exercise the actual foreground-break hook while isolating unrelated world audit writes.
  const audit=store.recordWorldChangeAndTrackedDrops;
  store.recordWorldChangeAndTrackedDrops=async()=>{};
  try{
   await store.recordWorldChangesAndTrackedDrops(tx,'test-world',[{source_type:'world_block_update',action:'break',layer:'foreground',actor_username:'quest-sql-test',block_type_before:'stone',source_id:'valid-break'}]);
   await store.recordWorldChangesAndTrackedDrops(tx,'test-world',[{source_type:'world_block_update',action:'break',layer:'background',actor_username:'quest-sql-test',block_type_before:'stone',source_id:'invalid-background'}]);
  }finally{store.recordWorldChangeAndTrackedDrops=audit;}
 });
 // Before acceptance, even matching actions do not count.
 await call('quest_board_get');assert.deepEqual(board.active.story.progress,[0,0,0,0,0]);
 await db.query("UPDATE pixelmania.quest_gameplay_events SET created_at=to_timestamp($1::double precision/1000)+interval '1 second' WHERE event_key LIKE '%valid-%'",[tracking.active.story.accepted_at]);
 await call('quest_board_get');assert.deepEqual(board.active.story.progress,[1,1,1,1,1]);
 assert.equal(board.active.story.solved,true);
 assert.equal((await db.query("SELECT count(*)::integer AS n FROM pixelmania.quest_gameplay_events WHERE event_key LIKE '%invalid-background'")).rows[0].n,0);
 await db.query('UPDATE pixelmania.quest_accounts SET state=$1::jsonb WHERE player_id=$2',[JSON.stringify(persisted),playerId]);
 // Account isolation and fail-closed database readiness.
 const other=await Quests.apply(store,{username:'quest-other-test',world:'START',request_id:'other',action:'quest_board_get',payload:{}});
 assert.equal(other.board.stamps,0);assert.equal(other.board.story_next,1);
 // Every automatic slot is independently claimable through committed gameplay.
 let autoBoard=other.board;
 const autoId=(await db.query("SELECT p.player_id FROM pixelmania.players p JOIN pixelmania.accounts a ON a.account_id=p.account_id WHERE a.username='quest-other-test'")).rows[0].player_id;
 assert.equal(autoBoard.dailies.length,4);
 for(const [slot,letter] of Object.entries(autoBoard.active)){
  for(const objective of letter.objectives){
   const source={plant:'seed_place',splice:'seed_splice',harvest:'seed_harvest',fish:'fishing_complete',break:'world_block_break'}[objective.action];
   for(let i=0;i<objective.target;i++)await db.transaction(tx=>Quests.recordGameplay(store,tx,autoId,source,{seed_type:objective.item_type,item_category:'fish',matured:true},`${slot}-${i}`));
  }
 }
 autoBoard=(await Quests.apply(store,{username:'quest-other-test',world:'START',request_id:'auto-progress',action:'quest_board_get',payload:{}})).board;
 assert(Object.values(autoBoard.active).every(a=>a.solved));
 const dailyClaims=[];
 for(const slot of autoBoard.dailies.map(d=>d.slot)){
  const claim={username:'quest-other-test',world:'START',request_id:`auto-claim-${slot}`,action:'quest_choose',payload:{revision:autoBoard.revision,tier:slot,instance_id:autoBoard.active[slot].id,choice:'a'}};
  dailyClaims.push(claim);
  const result=await Quests.apply(store,claim);
  assert.equal(result.ok,true,result.message);autoBoard=result.board;
 }
 assert(autoBoard.dailies.every(d=>d.claimed));assert.equal(Object.keys(autoBoard.active).length,0);
 assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE player_id=$1 AND item_type='gem'",[autoId])).rows[0].amount),70);
 assert.equal(Number((await db.query('SELECT player_total_xp FROM pixelmania.players WHERE player_id=$1',[autoId])).rows[0].player_total_xp),350);
 // Reconnect/reload and retransmission of every daily claim keep all rewards single-grant.
 const reloaded=await Quests.apply(store,{username:'quest-other-test',world:'START',request_id:'reconnect',action:'quest_board_get',payload:{}});
 assert(reloaded.board.dailies.every(d=>d.claimed));
 for(const claim of dailyClaims)assert.equal((await Quests.apply(store,claim)).ok,false);
 assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE player_id=$1 AND item_type='gem'",[autoId])).rows[0].amount),70);
 const xpReload=(await store.loadPlayerState('quest-other-test'));
 assert.equal(xpReload.ok,true);assert.equal(xpReload.found,true);
 assert.equal(Number(xpReload.state.player_total_xp),350,'XP survives canonical player-state reload');
 assert.equal(Number(xpReload.state.player_level),2,'Quest XP applies level-ups');
 assert(xpReload.state.last_level_up_at,'Quest level-up timestamp survives reload');
 assert.equal((await db.query('SELECT count(*)::integer AS n FROM pixelmania.quest_receipts WHERE player_id=$1',[autoId])).rows[0].n,4);
 // Continue recording between resets even when every quest was already claimed.
 await db.transaction(tx=>Quests.recordGameplay(store,tx,autoId,'seed_place',{seed_type:'grass_seed'},'after-all-claimed'));
 assert.equal((await db.query("SELECT count(*)::integer AS n FROM pixelmania.quest_gameplay_events WHERE player_id=$1 AND event_key='seed_place:after-all-claimed'",[autoId])).rows[0].n,1);
 store.questReady=false;
 assert.equal((await Quests.apply(store,{username:'quest-sql-test',action:'quest_board_get',payload:{}})).ok,false);
 await db.close();
 console.log('[quest-postgres] PASS: full schema, migrations, real ledger/hash SQL, atomic rollback, four concurrent duplicate claims, durable reload');
}
main().catch(error=>{console.error(error);process.exit(1);});
