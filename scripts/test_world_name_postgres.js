"use strict";
// Isolated PostgreSQL/WASM database; never loads .env or connects to game servers.
process.env.WORLD_NAME_CLAIMS_ENABLED = "true";
process.env.WORLD_TAX_ENABLED = "false"; // Taxes have their own isolated integration suite.
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
  const alice = await store.withTransaction(client => store.ensurePlayerIdentity(client,"namealice"));
  const bob = await store.withTransaction(client => store.ensurePlayerIdentity(client,"namebob"));
  const account = async player => (await db.query("SELECT account_id FROM pixelmania.players WHERE player_id=$1",[player])).rows[0].account_id;
  const aliceAccount = await account(alice), bobAccount = await account(bob);
  const lock = (id,name) => ({is_locked:true,owner_account_id:id,owner_name:name,owner_username:name,lock_grid_x:4,lock_grid_y:4});
  // Existing owned world migrates on activation, with permanent terrain identity.
  const existing = await store.withTransaction(client => store.ensureWorldIdentity(client,"SHOP"));
  await db.query("UPDATE pixelmania.worlds SET world_state=$2::jsonb WHERE world_id=$1",[existing,JSON.stringify({world_lock:lock(aliceAccount,"namealice"),blocks:[{x:8,y:9,block_type:"gold_block"}]})]);
  await Names.ensureSchema(store);
  let row = await Names.status(store,"SHOP");
  assert.equal(row.status,"reserved"); assert.equal(Number(row.quoted_gems),750000);
  const originalDeadline = new Date(row.expires_at).getTime();
  assert.equal(originalDeadline-new Date(row.reserved_at).getTime(),604800000);
  await Names.ensureSchema(store);
  assert.equal(new Date((await Names.status(store,"SHOP")).expires_at).getTime(),originalDeadline,"Restart cannot extend deadline");
  await store.withTransaction(client=>Names.mirrorOwner(store,client,existing,{},null));
  assert.equal((await Names.status(store,"SHOP")).owner_account_id,null,"Removing an unpaid lock releases ownership");
  assert.equal((await Names.status(store,"SHOP")).public_name,"SHOP","Unlocking must not auto-rename");
  assert.equal((await Names.status(store,"SHOP")).status,"unowned");
  assert.equal((await Names.status(store,"SHOP")).expires_at,null);
  const releasedSearch = await Names.search(store,aliceAccount,"SHOP");
  assert.equal(releasedSearch.available,true);
  assert.equal(releasedSearch.requires_world_lock,true);
  assert.equal(await Names.resolve(store,"SHOP"),"SHOP","Released name remains the address of the unlocked world");
  await store.withTransaction(client=>Names.mirrorOwner(store,client,existing,lock(bobAccount,"namebob"),bobAccount));
  assert.equal((await Names.status(store,"SHOP")).owner_account_id,bobAccount,"Another player can immediately reserve the released world");
  await store.withTransaction(client=>Names.mirrorOwner(store,client,existing,{},null));
  await store.withTransaction(client=>Names.mirrorOwner(store,client,existing,lock(aliceAccount,"namealice"),aliceAccount));
  const renewedDeadline = new Date((await Names.status(store,"SHOP")).expires_at).getTime();
  await Names.reserve(store,"SHOP",aliceAccount,"shop");
  assert.equal(new Date((await Names.status(store,"SHOP")).expires_at).getTime(),renewedDeadline,"Repeated reserve without unlocking cannot reset deadline");
  await assert.rejects(Names.reserve(store,"SHOP",bobAccount,"SHOP"),/owner/);

  // Insufficient funds and forged price/name leave receipt and balance untouched.
  const claim = (username,world,amount=750000,name="SHOP") => store.applyInventoryDeltaTransaction({
    account_username:username,world,source:"world_name",action:"world_name_claim",request_id:"claim-test",
    metadata:{claim_name:name,claim_price:amount},
    deltas:[{item_type:"gem",item_category:"currency",delta:-amount}],
  });
  assert.equal((await claim("namealice","SHOP")).ok,false);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixelmania.world_name_claim_receipts")).rows[0].n,0);
  await db.query("INSERT INTO pixelmania.inventory(player_id,item_type,item_category,amount,stack_limit) VALUES($1,'gem','currency',1000000,2000000000)",[alice]);
  assert.equal((await claim("namealice","SHOP",500)).ok,false);
  assert.equal((await claim("namealice","SHOP",750000,"A")).ok,false);
  assert.equal((await claim("namebob","SHOP")).ok,false);
  // Inject failure after ledger/debit and receipt insert: all must roll back.
  const finish = Names.finishClaim;
  Names.finishClaim = async (...args) => {await finish(...args); throw new Error("injected failure");};
  assert.equal((await claim("namealice","SHOP")).ok,false);
  Names.finishClaim = finish;
  assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE player_id=$1 AND item_type='gem'",[alice])).rows[0].amount),1000000);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixelmania.world_name_claim_receipts")).rows[0].n,0);
  const results = await Promise.all([claim("namealice","SHOP"),claim("namealice","SHOP"),claim("namealice","SHOP")]);
  assert.equal(results.filter(r=>r.ok).length,1,JSON.stringify(results));
  row = await Names.status(store,"SHOP");
  assert.equal(row.status,"claimed"); assert.equal(Number(row.paid_gems),750000);
  await store.withTransaction(client=>Names.mirrorOwner(store,client,existing,{},null));
  assert.equal((await Names.status(store,"SHOP")).owner_account_id,aliceAccount,"Paid ownership survives removing the physical lock");
  assert.equal(Number((await db.query("SELECT amount FROM pixelmania.inventory WHERE player_id=$1 AND item_type='gem'",[alice])).rows[0].amount),250000);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pixelmania.gem_ledger WHERE player_id=$1 AND delta=-750000",[alice])).rows[0].n,1);
  await store.withTransaction(client=>Names.mirrorOwner(store,client,existing,lock(bobAccount,"namebob"),bobAccount));
  assert.equal(Number((await Names.status(store,"SHOP")).paid_gems),750000,"Transfer must retain original receipt");
  assert.equal((await Names.status(store,"SHOP")).owner_account_id,bobAccount);

  // Every newly locked world retains its entered name for the full payment window.
  const first = await Names.resolve(store,"FISHING");
  assert.equal((await Names.status(store,first)).public_name,"FISHING");
  assert.equal((await Names.status(store,first)).status,"unowned");
  assert.equal((await Names.status(store,first)).expires_at,null,"Creation alone must not start an expiry or generate a public name");
  const firstId = (await db.query("SELECT world_id FROM pixelmania.worlds WHERE world_name=$1",[first])).rows[0].world_id;
  await store.withTransaction(client=>Names.mirrorOwner(store,client,firstId,lock(aliceAccount,"namealice"),aliceAccount));
  const second = await Names.resolve(store,"HELLO123");
  const secondId = (await db.query("SELECT world_id FROM pixelmania.worlds WHERE world_name=$1",[second])).rows[0].world_id;
  await store.withTransaction(client=>Names.mirrorOwner(store,client,secondId,lock(aliceAccount,"namealice"),aliceAccount));
  const secondRow = await Names.status(store,second);
  assert.equal(secondRow.status,"reserved"); assert.equal(secondRow.public_name,"HELLO123");
  assert.equal(new Date(secondRow.expires_at)-new Date(secondRow.reserved_at),604800000);
  assert.equal((await Names.status(store,first)).public_name,"FISHING");
  assert.equal(Number(secondRow.quoted_gems),500);
  await store.withTransaction(client=>Names.mirrorOwner(store,client,secondId,lock(aliceAccount,"namealice"),aliceAccount));
  assert.equal(new Date((await Names.status(store,second)).expires_at).getTime(),new Date(secondRow.expires_at).getTime());
  await assert.rejects(Names.reserve(store,second,aliceAccount,"MYNEWNAME"),/already/);
  // Occupied names count even when unowned; suffix generation must skip all of them.
  for (let suffix=0;suffix<10;suffix++) await Names.resolve(store,"FISHING"+suffix);
  const beforeWorld = (await db.query("SELECT * FROM pixelmania.worlds WHERE world_id=$1",[firstId])).rows[0];
  await db.query("UPDATE pixelmania.world_name_registry SET expires_at=clock_timestamp()-interval '1 second' WHERE world_id=$1",[firstId]);
  await Names.sweep(store);
  row = await Names.status(store,first);
  assert.equal(row.status,"generated"); assert.equal(row.owner_account_id,aliceAccount);
  assert.match(row.public_name,/^FISHING[1-9][0-9]$/);
  assert.deepEqual((await db.query("SELECT * FROM pixelmania.worlds WHERE world_id=$1",[firstId])).rows[0],beforeWorld,"Expiry must not modify terrain, routing identity or snapshot row");
  assert.equal(await Names.resolve(store,row.public_name),first,"Generated alias reaches the original world");
  await assert.rejects(Names.reserve(store,first,aliceAccount,"FISHING"),/seven days/);
  const reused = await Names.resolve(store,"fishing");
  assert.notEqual(reused,first,"Released name points to a different identity");
  assert.equal(await Names.resolve(store,"FISHING"),reused);
  const reusedId = (await db.query("SELECT world_id FROM pixelmania.worlds WHERE world_name=$1",[reused])).rows[0].world_id;
  await assert.rejects(store.withTransaction(client=>Names.mirrorOwner(store,client,reusedId,lock(aliceAccount,"namealice"),aliceAccount)),/seven days/);
  assert.equal((await Names.status(store,reused)).status,"unowned","Cooldown cannot be bypassed by locking a fresh world");
  assert.equal((await Names.resolveEntry(store,"FISHING",first)).internal,first,"Reconnect by identity keeps the original world after expiry");
  assert.equal((await Names.resolveEntry(store,"FISHING")).internal,reused,"Fresh name entry reaches the new owner");
  const beforeSearch = await Names.status(store,first);
  const searched = await Names.search(store,aliceAccount,"another123");
  assert.equal(searched.name,"ANOTHER123"); assert.equal(searched.price_gems,500); assert.equal(searched.available,true);
  assert.equal((await Names.status(store,first)).public_name,beforeSearch.public_name,"Search must not rename or reserve");
  assert.equal((await Names.search(store,aliceAccount,"SHOP")).available,false,"Claimed names unavailable");
  assert.equal((await Names.search(store,aliceAccount,"HELLO123")).available,false,"Pending names unavailable");
  assert.equal((await Names.search(store,aliceAccount,"START")).available,false,"System names unavailable");
  await assert.rejects(Names.search(store,aliceAccount,"BAD NAME"));
  await assert.rejects(Names.reserve(store,first,aliceAccount,"ANOTHER123",1),/price changed/);
  // A different visitor can take a searched name before the reservation commits.
  await Names.resolve(store,"ANOTHER123");
  await assert.rejects(Names.reserve(store,first,aliceAccount,"ANOTHER123",500),/in use/);
  const nextQuote = await Names.search(store,aliceAccount,"ANOTHER456");
  await Names.reserve(store,first,aliceAccount,"ANOTHER456",nextQuote.price_gems);
  assert.equal(Number((await Names.status(store,first)).quoted_gems),500);
  const reservedAgain = await Names.status(store,first);
  assert.equal(reservedAgain.public_name,"ANOTHER456"); assert.equal(reservedAgain.status,"reserved");
  assert(Math.abs(new Date(reservedAgain.expires_at)-new Date(reservedAgain.reserved_at)-604800000)<10);
  await db.query("UPDATE pixelmania.world_name_registry SET quoted_gems=1234 WHERE world_id=$1",[existing]);
  assert.equal(Names.publicStatus(await Names.status(store,"SHOP")).original_paid_gems,750000,"Live quote changes never rewrite the original payment");
  const owned = await Names.owned(store,aliceAccount);
  assert(owned.some(w=>w.world_name==="ANOTHER456"));
  await db.query("UPDATE pixelmania.world_name_registry SET expires_at=clock_timestamp()-interval '1 second' WHERE world_id=$1",[firstId]);
  await Names.sweep(store);
  assert.match((await Names.status(store,first)).public_name,/^ANOTHER456\d{1,3}$/,"Replacement reservation expires to its own numeric fallback");
  await assert.rejects(Names.reserve(store,second,aliceAccount,"START"),/cannot/);
  const legacyId = await store.withTransaction(client=>store.ensureWorldIdentity(client,"LEGACYABC"));
  await store.withTransaction(client=>Names.mirrorOwner(store,client,legacyId,lock(aliceAccount,"namealice"),aliceAccount));
  assert.equal((await Names.status(store,"LEGACYABC")).public_name,"LEGACYABC");
  assert.equal((await Names.status(store,"LEGACYABC")).status,"reserved");
  const occupiedShort = {query:async(_sql,[names])=>({rows:names.filter(name=>/^ABC\d{1,2}$/.test(name)).map(name=>({name}))})};
  assert.match(await Names.availableFallbackName(store,occupiedShort,"ABC"),/^ABC[1-9][0-9]{2}$/);
  const occupiedAll = {query:async(_sql,[names])=>({rows:names.map(name=>({name}))})};
  assert.equal(await Names.availableFallbackName(store,occupiedAll,"ABC"),null,"Exhaustion must not steal a name");
  const noNames = {query:async()=>({rows:[]})};
  assert.match(await Names.availableFallbackName(store,noNames,"ABC"),/^ABC\d$/);
  assert.match(await Names.availableFallbackName(store,noNames,"A".repeat(32)),/^A{31}\d$/,"Fallback stays within 32 characters");
  await db.close();
  console.log("[world-name-postgres] PASS: activation, restart, ownership, price validation, atomic rollback, duplicate claims, ledgers, transfer receipt, multiple pending names, numeric expiry suffixes, collisions, cooldown and alias reuse");
}
main().catch(error=>{console.error(error);process.exit(1);});
