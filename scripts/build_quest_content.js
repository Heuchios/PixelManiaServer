// Compile the authored Dispatch catalogue into bounded, server-validated activities.
// The source is checked in; runtime never reads the external design workspace.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'data/quests/dispatch_authoring.json'), 'utf8'));
const puzzles = {};
function order(ids, cards, hint) { for (const id of ids.split(' ')) puzzles[id] = {kind:'order', prompt:'Tap the cards in the order described by the clues.', cards, hint, solution:cards.map((_,i)=>i)}; }
function match(ids, cards, slots, hint) {for(const id of ids.split(' '))puzzles[id]={kind:'match',prompt:'Match each card to its place. Select a place, then select its card.',cards,slots,hint,solution:cards.map((_,i)=>i)};}
function build(ids,cells,label,hint){for(const id of ids.split(' '))puzzles[id]={kind:'build',prompt:label,width:5,height:5,solution:cells,hint,clues:['Columns run A–E from left to right; rows run 1–5 from top to bottom.',hint,'Tap squares to place or remove loaned tiles. Nothing is taken from your inventory.']};}
order('C01',['An unlit lantern: the delivery has not begun.','The lantern is lighting: the courier has arrived.','A lit lantern: the parcel has been delivered.'],'Start before the light is lit, then the lighting, then the finished light.');
match('C02',['The kite found a roof.','The sailor reached shore.','The boot found its partner.'],['A lost kite','A teacup sailor','A lonely boot'],'Look for the object named in each ending.');
match('C03',['Seed labels','Measuring tape','Reed whistle'],['Tansy grows things.','Rue checks dimensions.','Nell listens beside the river.'],'Match each parcel to the activity in the recipient clue.');
order('C04',['Weather shelf: the page describes rain.','Water index: rain is water from the sky.','Rain section: file the page here.'],'Begin with the broad subject, then the material, then the specific subject.');
build('C05',[6,7,8,11],'Build a tiny roof: B2, C2, D2. Add one wall at B3. Leave C3 and C4 open.','Fill B2, C2, D2 and B3 only.');
build('C06',[11,12,13],'Place two chairs at B3 and D3 and a table at C3. Keep the lower doorway clear.','Fill B3, C3 and D3 only.');
build('C07 S18',[5,6,7,10,12,17],'Build a festival corner: roof A2–C2, supports A3/C3, table C4. Keep B3/B4 clear.','Fill A2, B2, C2, A3, C3 and C4 only.');
build('C08',[10,11,12,13,14,17],'Bridge row 3 from A to E; add a support at C4. Keep the rest clear.','Fill A3, B3, C3, D3, E3 and C4.');
match('C09',['Round seed','Striped seed','Heart seed'],['Circle-marked dry planter','Stripe-marked cool planter','Heart-marked sheltered planter'],'The symbols on seed and planter match; color is not needed.');
match('C10',['Round leaves','Pointed leaves','Split leaves'],['Round label','Pointed label','Split label'],'Each label describes the visible leaf shape.');
build('C11 S11',[6,7,12,17],'Connect the cloud at B2 to the planter at C4 using B2, C2, C3, C4.','The channel runs right once and then down twice.');
match('C12',['Round leaves + climbing stem','Striped leaves + short stem','Broad leaves + shelter'],['Round climbing silhouette','Low striped border','Broad canopy silhouette'],'Both traits must match the resulting silhouette.');
match('C13',['Pip carrying a lantern','A hat resting on a boat','A whistle hanging in reeds'],['A walking light with a satchel','A floating hat without a head','A singing reed in the wind'],'Identify the ordinary object that explains both clues.');
order('C14',['Reed: begin at the bank.','Stone: cross the stepping stone.','Moon: look up at the destination.'],'The message travels from the bank, across the stone, then looks upward.');
match('C15 S06',['Nell beside the bridge','Pip at the reed bank','Rue beside the boat'],['The witness next to a crossing','The witness behind tall grass','The witness beside an oar'],'Bridge means crossing, reeds mean tall grass, and a boat carries an oar.');
build('C16 S07',[6,7,12],'Reflect light from B2 to C3 using panels at B2, C2 and C3.','The path turns at C2. Place exactly three panels.');
match('C17',['Straight connector','Elbow connector','Bridge connector'],['Two opposite terminals','Two terminals at a corner','Two wires crossing without joining'],'Choose the shape that joins the indicated terminals.');
order('C18 S13',['Secure the base before anything can stand.','Attach the wheel to the secured base.','Place the parcel on the completed cart.'],'Base, wheel, then parcel. Each step needs the previous one.');
build('C19 S14',[7,11,12,13],'Fit a lantern silhouette: cap C2, middle B3/C3/D3.','One tile at C2, then three across B3–D3.');
build('C20',[5,6,11,12],'Route the parcel A2 → B2 → B3 → C3. Do not return to A3.','Fill only the four positions in the route; the return loop stays empty.');
order('C21',['Muddy footprints leave the river.','Grass-stained footprints cross the garden.','Dry footprints arrive at the doorstep.'],'Follow the trail as it dries: mud, grass, doorstep.');
match('C22',['Bench and crooked lantern','Bridge and round stone','Gate and empty planter'],['A place to sit beside a tilted light','A crossing beside a round step','An entrance with room to grow'],'Use every detail; matching only the first object is not enough.');
order('C23 S22',['Enter through the garden gate.','Follow the path past the little shelter.','Cross the bridge to the letter desk.'],'The gate leads to the shelter; the shelter path leads to the bridge.');
match('C24',['Lantern between gate and table','Sign between pool and garden','Bench between workshop and bridge'],['The place beside a light','The place below a sign','The place beside a seat'],'Match the final landmark; every location is between two named places.');
order('S01',['The unlit lantern belongs to the old desk.','A pebble marks the dry path to the desk.','The clock hand points to the desk address.'],'Follow the place, its path, then the address pointing back to it.');
build('S02',[6,7,8,11],'Shelter the letter: roof B2–D2, wall B3, open entry C3.','Place B2, C2, D2 and B3 only.');
order('S03',['H: a house-shaped first scrap.','O: a round window in the second scrap.','ME: the final scrap names who belongs.'],'H + O + ME spells HOME.');
order('S04',['Remember the envelope and its seal.','Remember the shelter and its light.','Finish with the recovered word HOME.'],'The letter arrived first, the shelter followed, and HOME finished it.');
match('S05',['Reed token','Bell token','Moon token'],['Tall grass on the bank','A tune under the water','A reflection above the river'],'The bottle seal shows a bell: it points to the second clue.');
order('S08',['Circle chime: the first note.','Triangle chime: the note after the circle.','Square chime: the final note.'],'Circle, triangle, square. The captions contain all the sound information.');
match('S09',['Almost: a round seed','Perhaps: a striped seed','Not Yet: a heart seed'],['Circle soil','Stripe soil','Heart soil'],'Match the packet symbol with the soil symbol.');
match('S10',['Closed under a grand title','Closed under a formal title','Open beside laughter'],['Moon Majesty','Supreme Blossom','A silly joke'],'The open flower is the one beside laughter, not a grand name.');
build('S12',[6,8,12,17],'Place flower B2, cloud D2, memory C3 and an empty planter C4.','Use the four marked memory locations; leave the side paths open.');
order('S15',['First picnic: clear sky and a full basket.','Second memory: gathering clouds and a half-full basket.','Last repetition: rain and an empty basket.'],'The basket empties while the weather worsens.');
build('S16',[5,6,7,12],'Route to REMEMBER along A2, B2, C2, C3. Leave REPEAT at B3 empty.','Avoid B3; it closes the repeat loop.');
match('S17',['Pip','Nell','Tansy'],['Chair nearest the mail slot','Chair nearest the river window','Chair nearest the planter'],'Keep the unassigned fourth place open for a visitor.');
order('S19',['Circle lantern: there is a place for you.','Triangle lantern: follow the welcome.','Square lantern: we are glad you came.'],'Follow circle, triangle, square. No audio or color distinction is required.');
match('S20',['Shelter postcard','Garden postcard','Empty chair'],['A place to rest','A place to grow','A place for the next guest'],'Match what each memory offers somebody.');
match('S21',['A picnic drawing','A blank margin','An unfinished address'],['A memory to keep','A space between memories','A story still waiting'],'Morrow carried the empty spaces, not the picnic memory.');
match('S23',['Nell\'s message','Bolt\'s postcard','The empty next page'],['A memory of a friend','A memory of a good day','Room for another day'],'Keep the two memories; leave the next page free.');
order('S24',['Begin with the letter that arrived.','Leave room like the garden\'s empty planter.','End with a welcome like Rue\'s spare chair.'],'Letter, garden, then welcome. These are the three lines of the final reply.');

const runtime=source.quests.map(q=>{
 assert(puzzles[q.id],`Missing puzzle ${q.id}`);
 const variants=Array.from({length:q.kind==='commission'?3:1},(_,v)=>{
  const p=JSON.parse(JSON.stringify(puzzles[q.id]));
  // Mirror actual work-mat geometry, not only its title. Text clues are rebuilt.
  if(p.kind==='build'&&v>0){p.solution=p.solution.map(cell=>{const x=cell%5,y=Math.floor(cell/5);return v===1?y*5+4-x:(4-y)*5+x;});
   const coords=p.solution.map(c=>String.fromCharCode(65+c%5)+(Math.floor(c/5)+1));
   p.prompt=`${q.title}: assemble the alternate layout at ${coords.join(', ')}. Leave other squares clear.`;
   p.hint=`Place only ${coords.join(', ')}.`;p.clues[1]=p.hint;
  }
  // Different order or matching presentation, with stable IDs verified server-side.
  const count=p.cards?.length||0;
  p.display_order=Array.from({length:count},(_,i)=>(i+v+1)%count);
  p.clues=p.clues||[q.opening,...p.cards];
  return p;
 });
 return {id:q.id,tier:q.tier,family:q.family,npc:q.npc,title:q.title,opening:q.opening,
   reward:q.reward,minutes:q.minutes,steps:q.steps,choices:q.choices,variants,
   chapter_order:q.chapter_order,arc:q.arc||'',chapter_in_arc:q.chapter_in_arc||0,
   flag:q.persistent_flag,postcard:q.first_completion_postcard,arc_reward:q.first_completion_arc_reward,
   content_version:1};
});
const gameplay=require('./quest_gameplay_content');
const out=path.join(root,'data/quests/dispatch.json');fs.writeFileSync(out,JSON.stringify({version:2,quests:runtime.map(gameplay)},null,2)+'\n');
console.log(`[quests] compiled ${runtime.length} gameplay quests with gem and XP rewards`);
