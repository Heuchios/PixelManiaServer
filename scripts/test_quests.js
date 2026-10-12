const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../server_quest_engine');
const base=Date.UTC(2026,8,21,4,1);
const slots=['favor_0','favor_1','trip_0','trip_1'];
let now=base,state=E.fresh(),total=0,receipts=[];
function call(action,payload={}){const r=E.transition(state,action,{revision:state.revision,...payload},now,'quest-test');state=r.state;total+=r.gemDelta;receipts.push(...r.receipts);return r;}
function finish(tier){const a=state.active[tier];a.progress=a.objectives.map(o=>o.target);a.solved=true;return call('quest_choose',{tier,instance_id:a.id,choice:'a'});}
const output=path.join(__dirname,'../test-output');fs.mkdirSync(output,{recursive:true});
function fixture(name,board){fs.writeFileSync(path.join(output,`quest_${name}.json`),JSON.stringify(board,null,2));}
let r=call('quest_board_get');
assert.equal(r.board.daily_mode,'automatic');assert.equal(r.board.dailies.length,4);
assert.deepEqual(Object.keys(state.active),slots);
assert.equal(new Set(r.board.dailies.map(d=>d.quest.id)).size,4);
fixture('board_snapshot',r.board);
for(let day=0;day<30;day++){
 now=base+day*86400000;r=call('quest_board_get');
 assert.equal(Object.keys(state.active).length,4);
 for(const tier of [...slots,'story']){
  if(tier==='story')call('quest_accept',{tier,quest_id:r.board.story.id});
  const a=state.active[tier];
  if(day===0)fixture(`active_${tier}`,call('quest_board_get').board);
  assert.throws(()=>call('quest_choose',{tier,instance_id:a.id,choice:'a'}));
  assert.throws(()=>call('quest_solve',{tier,instance_id:a.id,answer:a.puzzle.solution}));
  if(tier!=='story'){
   assert.throws(()=>call('quest_abandon',{tier,instance_id:a.id}));
   assert.throws(()=>call('quest_accept',{tier,quest_id:a.quest.id}));
  }
  const publicView=call('quest_board_get').board.active[tier];
  assert(!Object.hasOwn(publicView.puzzle,'solution'));assert(!Object.hasOwn(publicView.quest,'variants'));
  const before=total;const paid=finish(tier);assert.equal(total-before,a.reward.gems+paid.receipts.filter(r=>r.tier==='weekly').reduce((n,r)=>n+r.gems,0));
  assert.throws(()=>call('quest_choose',{tier,instance_id:a.id,choice:'a'}));
  assert.throws(()=>call('quest_accept',{tier,quest_id:a.quest.id}));
 }
 const claimed=call('quest_board_get');assert(claimed.board.dailies.every(d=>d.claimed));
 assert.equal(Object.keys(state.active).length,0);
}
assert.equal(total,25850);assert.equal(state.stamps,0);assert.equal(Object.keys(state.chapters).length,24);
assert.equal(receipts.reduce((n,r)=>n+(r.xp||0),0),17650);
assert.equal(state.story_next,25);fixture('archive',call('quest_board_get').board);
assert.equal(new Set(receipts.map(r=>r.id)).size,receipts.length);
assert.equal(receipts.filter(r=>r.tier==='weekly').length,4);
const saved=JSON.parse(JSON.stringify(state));assert.deepEqual(E.transition(saved,'quest_board_get',{},now,'quest-test').state,state);
assert.throws(()=>E.transition(state,'quest_redeem',{revision:-1,cosmetic_id:'envelope_sticker'},now,'quest-test'));
state.stamps=392;call('quest_redeem',{cosmetic_id:'envelope_sticker'});assert.equal(state.stamps,380);
assert.throws(()=>call('quest_redeem',{cosmetic_id:'envelope_sticker'}));
assert.throws(()=>call('quest_equip',{cosmetic_id:'not-owned'}));
call('quest_equip',{cosmetic_id:'envelope_sticker'});
// Reset replaces all unclaimed dailies; no replay of yesterday's instance can claim today.
state=E.fresh();now=base;call('quest_board_get');const yesterday=state.active.favor_0.id;
now+=86400000;r=call('quest_board_get');assert.notEqual(state.active.favor_0.id,yesterday);
assert.equal(state.active.favor_0.accepted_at,E.dayId(now)*86400000+4*3600000);
assert.throws(()=>call('quest_choose',{tier:'favor_0',instance_id:yesterday,choice:'a'}));
assert.throws(()=>call('quest_refresh',{tier:'favor'}));
// Previously completed slots stay claimed; matching accepted quests keep progress and receipt identity.
state=E.fresh();now=base;call('quest_board_get');const legacy=structuredClone(state.active.favor_0);
legacy.id=`${E.dayId(now)}:favor`;legacy.tier='favor';legacy.progress=[1];legacy.solved=true;
state.active={favor:legacy};state.days[E.dayId(now)].done.trip=true;
r=call('quest_board_get');assert.equal(state.active.favor_0.quest.id,legacy.quest.id);
assert.equal(state.active.favor_0.id,legacy.id);assert.deepEqual(state.active.favor_0.progress,[1]);
assert.equal(r.board.dailies.find(d=>d.slot==='trip_0').claimed,true);
assert(!state.active.trip_0);assert(state.active.trip_1);
assert.equal(new Set(r.board.dailies.map(d=>d.quest.id)).size,4);
// Story persists independently through many daily resets.
call('quest_accept',{tier:'story',quest_id:'S01'});now+=40*86400000;
r=call('quest_board_get');assert.equal(r.board.active.story.quest.id,'S01');finish('story');assert.equal(state.story_next,2);
assert.equal(E.dayId(Date.UTC(2026,8,21,3,59)),E.dayId(Date.UTC(2026,8,20,4,1)));
// All accounts share the complete daily selection, independent of history and time of visit.
let regular=E.fresh();
const signatures=new Set();
for(let offset=0;offset<30;offset++){
 const time=base+offset*86400000;
 const a=E.transition(regular,'quest_board_get',{},time,'regular-player');regular=a.state;
 const absent=E.fresh();absent.history=[{day:E.dayId(time)-1,ids:E.CATALOGUE.map(q=>q.id)}];
 const b=E.transition(absent,'quest_board_get',{},time+12*3600000,'returning-player');
 const c=E.transition(E.fresh(),'quest_board_get',{},time,'brand-new-player');
 assert.deepEqual(a.board.dailies,b.board.dailies);assert.deepEqual(a.board.dailies,c.board.dailies);
 assert.deepEqual(a.board.active,b.board.active);assert.deepEqual(a.board.active,c.board.active);
 assert.equal(a.board.reset_at,b.board.reset_at);
 signatures.add(JSON.stringify(a.board.offers));
}
assert(signatures.size>1,'Global quests still rotate by day');
// Cached personal offers migrate immediately, with personal claims and story intact.
const global=E.transition(E.fresh(),'quest_board_get',{},base,'global-player');
const personal=structuredClone(global.state),today=E.dayId(base);
delete personal.days[today].assignment;
personal.days[today].offers.favor.reverse();personal.days[today].offers.trip.reverse();
for(const tier of ['favor','trip']){
 const first=personal.active[`${tier}_0`],second=personal.active[`${tier}_1`];
 first.quest=structuredClone(second.quest);first.objectives=structuredClone(second.objectives);
 first.progress=first.objectives.map(o=>o.target);first.solved=true;
}
personal.days[today].done.trip_1=true;delete personal.active.trip_1;
const oldRevision=personal.revision;
const migrated=E.transition(personal,'quest_board_get',{},base,'old-player');
assert.deepEqual(migrated.board.offers,global.board.offers);
assert.deepEqual(migrated.board.dailies.map(d=>d.quest),global.board.dailies.map(d=>d.quest));
assert(migrated.board.dailies.find(d=>d.slot==='trip_1').claimed);
assert(!migrated.state.active.trip_1);
assert.deepEqual(migrated.state.active.favor_0.progress,[0]);
assert.equal(migrated.state.active.favor_0.id,global.state.active.favor_0.id);
assert.equal(migrated.state.revision,oldRevision+1);
assert.throws(()=>E.transition(personal,'quest_choose',{revision:oldRevision,tier:'favor_0',instance_id:personal.active.favor_0.id,choice:'a'},base,'old-player'),/board changed/);
assert.deepEqual(E.transition(migrated.state,'quest_board_get',{},base,'old-player').state,migrated.state);
const beforeReset=E.transition(E.fresh(),'quest_board_get',{},Date.UTC(2026,8,22,3,59,59,999),'first');
const atReset=E.transition(beforeReset.state,'quest_board_get',{},Date.UTC(2026,8,22,4),'first');
const freshAtReset=E.transition(E.fresh(),'quest_board_get',{},Date.UTC(2026,8,22,4),'second');
assert.equal(atReset.board.day,beforeReset.board.day+1);
assert.deepEqual(atReset.board.dailies,freshAtReset.board.dailies);
console.log('[quests] PASS: four automatic dailies, independent claims, 30 reward days, 24 chapters, 25,850 gems / 17,650 XP, resets, legacy migration and replay protection');
console.log('[quests] PASS: global daily selection across accounts/history, cached-board migration, stale claim rejection and shared reset boundary');

// Existing boards adopt the rebalance without losing counts or granting a
// completed slot again. An old solved flag must not bypass the harder target.
const oldBoard=E.transition(E.fresh(),'quest_board_get',{},base,'balance-player');
const oldState=structuredClone(oldBoard.state);
for(const a of Object.values(oldState.active)){
 a.quest.content_version=2;
 a.objectives[0].target=1;a.progress=[1];a.solved=true;
 a.reward={gems:10,xp:50,stamps:0};
}
oldState.days[E.dayId(base)].done.trip_1=true;
delete oldState.active.trip_1;
const balanced=E.transition(oldState,'quest_board_get',{},base,'balance-player');
assert.equal(balanced.state.revision,oldState.revision+1);
assert(balanced.board.dailies.find(d=>d.slot==='trip_1').claimed);
assert(!balanced.state.active.trip_1);
for(const [slot,a] of Object.entries(balanced.state.active)){
 assert.equal(a.id,oldState.active[slot].id);
 assert.equal(a.accepted_at,oldState.active[slot].accepted_at);
 assert.deepEqual(a.progress,[1]);assert(!a.solved);
 assert.deepEqual(a.reward,a.quest.reward);
 assert(a.objectives[0].target>1);
}
assert.throws(()=>E.transition(oldState,'quest_choose',{revision:oldState.revision,tier:'favor_0',instance_id:oldState.active.favor_0.id,choice:'a'},base,'balance-player'),/board changed/);
assert.throws(()=>E.transition(balanced.state,'quest_choose',{revision:balanced.state.revision,tier:'favor_0',instance_id:balanced.state.active.favor_0.id,choice:'a'},base,'balance-player'),/Complete the gameplay/);
assert.deepEqual(E.transition(balanced.state,'quest_board_get',{},base,'balance-player').state,balanced.state);
// Check a year's rotations: four different activities, consistent advertised
// and payable rewards, and a 30–44 minute authored daily effort budget.
for(let day=0;day<366;day++){
 const board=E.transition(E.fresh(),'quest_board_get',{},base+day*86400000,'balance-player').board;
 assert.equal(new Set(board.dailies.map(d=>d.quest.family)).size,4);
 assert.equal(board.dailies.reduce((n,d)=>n+d.quest.minutes[0],0),30);
 assert.equal(board.dailies.reduce((n,d)=>n+d.quest.minutes[1],0),44);
 assert.equal(board.dailies.reduce((n,d)=>n+d.quest.reward.gems,0),day%7===6?800:700);
 assert.equal(board.dailies.reduce((n,d)=>n+d.quest.reward.xp,0),500);
 for(const d of board.dailies){
  assert.deepEqual(board.active[d.slot].reward,d.quest.reward);
  assert(d.quest.objectives[0].label.includes(String(d.quest.objectives[0].target)));
 }
}
console.log('[quests] PASS: harder daily migration preserves progress and claims; all annual rotations share the new effort and reward budgets');

// Full Monday-Sunday weeks pay exactly 5,000 regular gems + 1,000 once.
// A single missing slot, or story-only activity, must never unlock the bonus.
for(const missing of [null,'2:trip_1','6:favor_0','every-day']){
 let s=E.fresh(),baseGems=0,bonusGems=0,weeklyReceiptCount=0;
 for(let d=0;d<7;d++){
  const time=base+d*86400000;
  let result=E.transition(s,'quest_board_get',{},time,'weekly-test');s=result.state;
  for(const slot of slots){
   if(missing===`${d}:${slot}`||(missing==='every-day'&&slot==='trip_1'))continue;
   const a=s.active[slot];a.progress=a.objectives.map(o=>o.target);a.solved=true;
   result=E.transition(s,'quest_choose',{revision:s.revision,tier:slot,instance_id:a.id,choice:'a',gems:999999,weekly_complete:true},time,'weekly-test');s=result.state;
   baseGems+=result.receipts.filter(r=>r.tier!=='weekly').reduce((n,r)=>n+r.gems,0);
   bonusGems+=result.receipts.filter(r=>r.tier==='weekly').reduce((n,r)=>n+r.gems,0);
   weeklyReceiptCount+=result.receipts.filter(r=>r.tier==='weekly').length;
   if(d<6||slot!=='trip_1')assert.equal(bonusGems,0);
  }
  assert.equal(result.board.weekly.completed_days,d+1-(missing==='every-day'?d+1:missing&&Number(missing[0])<=d?1:0));
 }
 if(missing===null){
  assert.equal(baseGems,5000);assert.equal(bonusGems,1000);assert.equal(weeklyReceiptCount,1);
  const view=E.transition(s,'quest_board_get',{},base+6*86400000,'weekly-test');
  assert.equal(view.gemDelta,0);assert.equal(view.board.weekly.claimed_quests,28);assert(view.board.weekly.bonus_claimed);
  fixture('weekly_complete',view.board);
  const reset=E.transition(s,'quest_board_get',{},base+7*86400000-60000,'weekly-test');
  assert.equal(reset.board.weekly.claimed_quests,0);assert(!reset.board.weekly.bonus_claimed);
 }else{assert.equal(bonusGems,0);assert.equal(weeklyReceiptCount,0);}
}
let storyOnly=E.fresh();
for(let d=0;d<7;d++){
 const time=base+d*86400000;let result=E.transition(storyOnly,'quest_board_get',{},time,'story-only');
 result=E.transition(result.state,'quest_accept',{revision:result.state.revision,tier:'story',quest_id:result.board.story.id},time,'story-only');
 const a=result.state.active.story;a.progress=a.objectives.map(o=>o.target);a.solved=true;
 result=E.transition(result.state,'quest_choose',{revision:result.state.revision,tier:'story',instance_id:a.id,choice:'a'},time,'story-only');
 storyOnly=result.state;assert.equal(result.board.weekly.claimed_quests,0);assert.equal(result.receipts.length,1);
}
// Old visit counters (including old XP payouts) cannot mint completion gems.
const oldVisits=E.fresh();oldVisits.weeks[E.weekId(E.dayId(base))]={days:Array.from({length:7},(_,i)=>E.dayId(base)+i),rewarded:true};
assert.equal(E.transition(oldVisits,'quest_board_get',{},base,'legacy-visits').board.weekly.claimed_quests,0);
assert.equal(E.transition(oldVisits,'quest_board_get',{},base,'legacy-visits').gemDelta,0);
// A reward-only content upgrade keeps completed gameplay and receipt identity.
const rewardUpgrade=E.transition(E.fresh(),'quest_board_get',{},base+6*86400000,'reward-upgrade').state;
for(const a of Object.values(rewardUpgrade.active)){
 a.quest.content_version=3;a.progress=a.objectives.map(o=>o.target);a.solved=true;a.reward={gems:15,xp:75,stamps:0};
}
const upgraded=E.transition(rewardUpgrade,'quest_board_get',{},base+6*86400000,'reward-upgrade');
for(const slot of slots){assert(upgraded.state.active[slot].solved);assert.equal(upgraded.state.active[slot].id,rewardUpgrade.active[slot].id);}
assert.equal(upgraded.board.active.trip_0.reward.gems,300);
console.log('[quests] PASS: 5,000 + 1,000 weekly, all 28 claims required, skipped days/slots and story excluded, Monday reset, legacy counters and reward migration');
