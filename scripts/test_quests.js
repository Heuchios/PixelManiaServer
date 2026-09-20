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
  const before=total;finish(tier);assert.equal(total-before,tier==='story'?15:tier.startsWith('favor')?10:25);
  assert.throws(()=>call('quest_choose',{tier,instance_id:a.id,choice:'a'}));
  assert.throws(()=>call('quest_accept',{tier,quest_id:a.quest.id}));
 }
 const claimed=call('quest_board_get');assert(claimed.board.dailies.every(d=>d.claimed));
 assert.equal(Object.keys(state.active).length,0);
}
assert.equal(total,2550);assert.equal(state.stamps,0);assert.equal(Object.keys(state.chapters).length,24);
assert.equal(receipts.reduce((n,r)=>n+(r.xp||0),0),13150);
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
// Previously completed slots stay claimed; accepted second choices keep progress and receipt identity.
state=E.fresh();now=base;call('quest_board_get');const legacy=structuredClone(state.active.favor_1);
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
console.log('[quests] PASS: four automatic dailies, independent claims, 30 reward days, 24 chapters, 2,550 gems / 13,150 XP, resets, legacy migration and replay protection');
