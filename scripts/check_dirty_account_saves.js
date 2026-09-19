"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const PostgresStore=require('../postgres_store');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
function body(name){const match=new RegExp(`^function ${name}\\(`,'m').exec(source);assert(match,name);const rest=source.slice(match.index),end=/\n(?:async )?function \w+\(/.exec(rest);return end?rest.slice(0,end.index):rest;}
async function main(){
 const accounts=new Map(Array.from({length:5000},(_,i)=>['p'+i,{username:'p'+i,last_seen_at:'before'}]));
 const batches=[],backups=[],timers=[];let ready=true,fail=false,hold=null;
 const store=new PostgresStore({enabled:false,logger:()=>{}});store.isReady=()=>true;store.withTransaction=async work=>work({});
 let upserts=0;store.upsertAccountState=async()=>{upserts++;};await store.saveAccountStates([...accounts.values()]);assert.equal(upserts,5000);upserts=0;
 const ctx={accounts,dirtyAccountSaveKeys:new Set(),saveAllAccountsPending:false,accountsSaveTimer:null,
  SAVE_DEBOUNCE_MS:250,POSTGRES_ENABLED:true,ACCOUNTS_SAVE_PATH:'fixture-only',Promise,Array,Set,Date,Error,
  cleanAccountName:x=>String(x||'').trim(),accountKey:x=>String(x).toLowerCase(),
  setTimeout:(run,delay)=>{const timer={run,delay,unref(){this.unreferenced=true;}};timers.push(timer);return timer;},clearTimeout:()=>{},
  writeJsonFileAtomicAsync:async(_file,payload)=>{backups.push(payload.accounts.length);},
  trackPersistenceWrite:p=>Promise.resolve(p).catch(()=>false),
  postgresStore:{isReady:()=>ready,saveAccountStates:async rows=>{batches.push(rows.map(x=>x.username));if(hold)await hold;if(fail)return false;return store.saveAccountStates(rows);}}
 };
 vm.createContext(ctx);vm.runInContext(body('queueAccountsSave')+'\n'+body('saveAccounts'),ctx);
 const flush=()=>{ctx.accountsSaveTimer=null;return ctx.saveAccounts();};
 ctx.queueAccountsSave('p1');ctx.queueAccountsSave('P1');assert.equal(ctx.dirtyAccountSaveKeys.size,1);
 await flush();assert.deepEqual(batches.at(-1),['p1']);assert.equal(upserts,1);assert.equal(backups.at(-1),5000);
 // Two-sided friend state must stay in the same transaction batch.
 ctx.queueAccountsSave('p2','p3');await flush();assert.deepEqual(batches.at(-1),['p2','p3']);
 let release;hold=new Promise(resolve=>release=resolve);ctx.queueAccountsSave('p4');const pending=flush();await Promise.resolve();
 ctx.queueAccountsSave('p4','p5');release();await pending;hold=null;
 assert(ctx.dirtyAccountSaveKeys.has('p4')&&ctx.dirtyAccountSaveKeys.has('p5'),'An in-flight save must not erase newer dirty work');
 await flush();assert.deepEqual(batches.at(-1),['p4','p5']);
 fail=true;ctx.queueAccountsSave('p6');assert.equal(await flush(),false);assert(ctx.dirtyAccountSaveKeys.has('p6'));
 assert.equal(timers.at(-1).delay,5000);assert.equal(timers.at(-1).unreferenced,true);
 fail=false;ctx.queueAccountsSave('p7');await flush();assert.deepEqual(batches.at(-1),['p6','p7']);
 ready=false;ctx.queueAccountsSave('p8');assert.equal(await flush(),false);assert(ctx.dirtyAccountSaveKeys.has('p8'));
 ready=true;await flush();assert.deepEqual(batches.at(-1),['p8']);
 ctx.queueAccountsSave();await flush();assert.equal(batches.at(-1).length,5000,'Explicit full-save compatibility');
 for(const file of ['src/server.ts','src/server_account_auth_routes.ts','src/server_account_session_helpers.ts','src/server_friend_routes.ts']){
  assert(!/queueAccountsSave\(\);/.test(fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8')),file+' must name changed accounts');
 }
 console.log('DIRTY_ACCOUNT_SAVES_OK: 5000 -> 1 upserts for one changed account; full backup, paired friends, concurrent edits, failed writes, DB outage, retries and explicit full-save preserved');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
