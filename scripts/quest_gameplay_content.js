// Objectives use canonical server item IDs; only committed gameplay counts.
const tasks=[
 ['A Fresh Start','Tansy','plant','',8,'Plant 8 seeds','A bare patch can become a little promise. Plant a fresh row for tomorrow.'],
 ['The Morning Harvest','Tansy','harvest','',6,'Harvest 6 mature trees','The neighbors are waiting for the first harvest. Let the trees finish growing.'],
 ['Room to Grow','Rue','break','dirt',20,'Break 20 dirt blocks','Rue needs a planting patch cleared before the next garden visit.'],
 ['Supper by the River','Nell','fish','',3,'Catch 3 fish','Nell has invited the neighbors for supper. A few good catches will help.'],
 ['A Little Green','Tansy','splice','grass_seed',1,'Splice 1 Grass tree (Dirt + Leaf seeds)','Tansy wants a green border for the community garden.'],
 ['Seeds for Tomorrow','Pip','plant','',12,'Plant 12 seeds','Pip promised to bring news of a new orchard on the next delivery.'],
 ['Stone for the Path','Rue','break','stone',15,'Break 15 stone blocks','The path to the garden needs a sturdier foundation.'],
 ['The Patient Angler','Nell','fish','',5,'Catch 5 fish','Nell says every catch has a story. Bring back five of them.'],
 ['A Wooden Welcome','Rue','splice','wooden_block_seed',1,'Splice 1 Wooden Block tree (Dirt + Wood seeds)','Rue is preparing materials for a welcoming bench.'],
 ['Harvest Letters','Pip','harvest','',8,'Harvest 8 mature trees','The mailbag is full of requests from the growers. Time to help with their harvest.'],
 ['A Brick Beginning','Bolt','splice','stone_brick_seed',1,'Splice 1 Stone Brick tree (Dirt + Stone seeds)','Bolt has a drawing for a tiny workshop foundation.'],
 ['The Garden Border','Tansy','plant','grass_seed',5,'Plant 5 Grass seeds','A small green border will make this corner feel like home.'],
 ['Orchard Afternoon','Tansy','plant','',25,'Plant 25 seeds','Tansy is planning a larger orchard. Every planted seed gets it closer.'],
 ['The Harvest Basket','Pip','harvest','',15,'Harvest 15 mature trees','Pip volunteered to help with the harvest. The basket is larger than expected.'],
 ['The Builders Pitch In','Rue','break','',60,'Break 60 foreground blocks','The neighbors are clearing space for their next building project.'],
 ['A River Gathering','Nell','fish','',8,'Catch 8 fish','The river picnic grew into a neighborhood gathering. Nell could use a hand.'],
 ['Three Green Promises','Tansy','splice','grass_seed',3,'Splice 3 Grass trees (Dirt + Leaf seeds)','Three little patches of green will connect the neighbors gardens.'],
 ['The Wooden Workshop','Bolt','splice','wooden_block_seed',3,'Splice 3 Wooden Block trees (Dirt + Wood seeds)','Bolt wants to try building with something quieter than metal.'],
 ['A Stone Brick Path','Rue','splice','stone_brick_seed',3,'Splice 3 Stone Brick trees (Dirt + Stone seeds)','Rue has marked the first three sections of a new path.'],
 ['Green Harvest','Tansy','harvest','grass_seed',8,'Harvest 8 mature Grass trees','The garden border has grown. Help Tansy gather its first harvest.'],
 ['A Rocky Errand','Mica','break','stone',40,'Break 40 stone blocks','Mica wants the old stonework rebuilt with freshly gathered material.'],
 ['A Day by the Water','Nell','fish','',10,'Catch 10 fish','Nell has time for a longer fishing trip. There is a place beside her for you.'],
 ['The Next Orchard','Pip','plant','',35,'Plant 35 seeds','Pip wants to deliver a letter saying the orchard is finally underway.'],
 ['Harvest Festival','Tansy','harvest','',20,'Harvest 20 mature trees','The festival begins with a harvest, and the neighbors are counting on yours.'],
];
module.exports=function gameplay(q,index){
 const story=q.tier==='story';
 const t=tasks[story?(index*5)%tasks.length:Number(q.id.slice(1))-1];
 const limits={plant:12,harvest:8,break:20,fish:3,splice:1};
 const minimum={plant:20,harvest:12,break:40,fish:6,splice:2};
 const target=story?Math.min(t[4],t[2]==='splice'?2:t[2]==='fish'?4:10):q.tier==='favor'?Math.min(t[4],limits[t[2]]):Math.max(t[4],minimum[t[2]]);
 const label=t[5].replace(String(t[4]),String(target));
 return {...q,...(!story?{title:t[0],npc:t[1],opening:t[6],family:t[2],choices:[{id:'a',label:'Share the good news',reply:`${t[1]} smiles. Your help made a difference today.`},{id:'b',label:'Thank the neighbors',reply:`${t[1]} promises to pass your thanks along. The next adventure can wait until tomorrow.`}]}:{}),
  objectives:[{action:t[2],item_type:t[3],target,label}],
  reward:{gems:q.tier==='favor'?10:q.tier==='trip'?25:15,xp:q.tier==='favor'?50:q.tier==='trip'?125:75,stamps:0},
  content_version:2};
};
