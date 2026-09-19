const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../server_quest_engine');
const base=Date.UTC(2026,8,21,4,1); // Monday, after global reset.
let now=base,state=E.fresh(),total=0,receipts=[];
function call(action,payload={}){const r=E.transition(state,action,{revision:state.revision,...payload},now,'quest-test');state=r.state;total+=r.gemDelta;receipts.push(...r.receipts);return r;}
function finish(tier){const a=state.active[tier];for(let i=0;i<a.puzzle.clues.length;i++)call('quest_inspect',{tier,instance_id:a.id,clue:i});
 call('quest_solve',{tier,instance_id:a.id,answer:a.puzzle.solution});assert(state.active[tier].solved);
 return call('quest_choose',{tier,instance_id:a.id,choice:'a'});}
let r=call('quest_board_get');
assert.equal(r.board.offers.favor.length,2);assert.equal(r.board.offers.trip.length,2);
fs.mkdirSync(path.join(__dirname,'../test-output'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'../test-output/quest_board_snapshot.json'),JSON.stringify(r.board,null,2));
for(let day=0;day<30;day++){
 now=base+day*86400000;r=call('quest_board_get');
 for(const tier of ['favor','trip','story']){
  const id=tier==='story'?r.board.story.id:r.board.offers[tier][0].id;
  call('quest_accept',{tier,quest_id:id});const a=state.active[tier];
  if(day===0)fs.writeFileSync(path.join(__dirname,`../test-output/quest_active_${tier}.json`),JSON.stringify(call('quest_board_get').board,null,2));
  assert.throws(()=>call('quest_choose',{tier,instance_id:a.id,choice:'a'}));
  assert.throws(()=>call('quest_solve',{tier,instance_id:a.id,answer:a.puzzle.solution}));
  const publicView=call('quest_board_get').board.active[tier];
  assert(!Object.hasOwn(publicView.puzzle,'solution'));assert(!Object.hasOwn(publicView.quest,'variants'));
  for(let i=0;i<a.puzzle.clues.length;i++)call('quest_inspect',{tier,instance_id:a.id,clue:i});
  const wrong=call('quest_solve',{tier,instance_id:a.id,answer:[99]});assert(!wrong.state.active[tier].solved);assert.equal(wrong.gemDelta,0);
  const before=total;finish(tier);assert.equal(total-before,{favor:10,trip:25,story:15}[tier]);
  assert.throws(()=>call('quest_choose',{tier,instance_id:a.id,choice:'a'}));
  assert.throws(()=>call('quest_accept',{tier,quest_id:id}));
 }
}
assert.equal(total,1500);assert.equal(state.stamps,392);assert.equal(Object.keys(state.chapters).length,24);assert.equal(state.story_next,25);
fs.writeFileSync(path.join(__dirname,'../test-output/quest_archive.json'),JSON.stringify(call('quest_board_get').board,null,2));
assert.equal(new Set(receipts.map(r=>r.id)).size,receipts.length);
assert.equal(receipts.filter(r=>r.tier==='weekly').length,4);
assert(Object.keys(state.flags).length===8);
const saved=JSON.parse(JSON.stringify(state));
assert.deepEqual(E.transition(saved,'quest_board_get',{},now,'quest-test').state,state);
assert.throws(()=>E.transition(state,'quest_redeem',{revision:-1,cosmetic_id:'envelope_sticker'},now,'quest-test'));
call('quest_redeem',{cosmetic_id:'envelope_sticker'});assert.equal(state.stamps,380);
assert.throws(()=>call('quest_redeem',{cosmetic_id:'envelope_sticker'}));
assert.throws(()=>call('quest_equip',{cosmetic_id:'not-owned'}));
call('quest_equip',{cosmetic_id:'envelope_sticker'});assert.equal(state.equipped,'envelope_sticker');
// Carryover consumes its origin day, not today's new entitlement.
state=E.fresh();now=base;r=call('quest_board_get');call('quest_accept',{tier:'favor',quest_id:r.board.offers.favor[0].id});
const original=state.active.favor.day;now+=86400000;r=finish('favor');
assert(state.days[original].done.favor);assert(!state.days[E.dayId(now)].done.favor);
call('quest_accept',{tier:'favor',quest_id:r.board.offers.favor[0].id});now+=3*86400000;call('quest_board_get');assert(!state.active.favor);
// Story is persistent; it does not stockpile one entitlement per absent day.
call('quest_accept',{tier:'story',quest_id:'S01'});now+=40*86400000;r=call('quest_board_get');assert.equal(r.board.active.story.quest.id,'S01');finish('story');assert.equal(state.story_next,2);
for(const q of E.CATALOGUE){assert(q.variants.length===(q.tier==='story'?1:3));for(const p of q.variants){assert(p.solution.length);assert(p.clues.length);if(p.kind==='build')assert(p.solution.every(x=>Number.isInteger(x)&&x>=0&&x<25));}}
assert.equal(E.dayId(Date.UTC(2026,8,21,3,59)),E.dayId(Date.UTC(2026,8,20,4,1)));
console.log('[quests] PASS: 48 quests, 30 reward days, 24 chapters, persistence, carryover, reset, hints, server answers, duplicate grants, cosmetics, 4 weekly bonuses');
