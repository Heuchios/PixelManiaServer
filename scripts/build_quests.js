const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
for(const name of ['server_quest_engine','server_quest_store'])fs.writeFileSync(path.join(root,name+'.js'),'// Generated from src/'+name+'.ts. Do not edit by hand.\n'+fs.readFileSync(path.join(root,'.tsbuild/quests',name+'.js'),'utf8'));
console.log('[quests] generated server modules');
