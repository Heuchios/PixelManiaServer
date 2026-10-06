"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawn}=require("node:child_process");
const crypto=require("node:crypto");
const root=path.resolve(__dirname,"..");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"pixelmania-ops-http-"));
const token=crypto.randomBytes(32).toString("hex");
let child;
async function main(){
  // Copy the actual HTTP boundary without any production env/account files.
  fs.copyFileSync(path.join(root,"ops_dashboard_server.js"),path.join(tmp,"ops_dashboard_server.js"));
  fs.writeFileSync(path.join(tmp,"ops_player_audit.js"),`module.exports=require(${JSON.stringify(path.join(root,"ops_player_audit.js"))});`);
  fs.mkdirSync(path.join(tmp,"ops_dashboard_public"));
  fs.copyFileSync(path.join(root,"ops_dashboard_public/index.html"),path.join(tmp,"ops_dashboard_public/index.html"));
  const env={...process.env,NODE_PATH:path.join(root,"node_modules")};
  for(const key of Object.keys(env)) if(/^(OPS_|SMTP_|POSTGRES_|DATABASE_URL|PIXELMANIA_)/.test(key)) delete env[key];
  Object.assign(env,{OPS_DASHBOARD_PORT:"19095",OPS_DASHBOARD_HOST:"127.0.0.1",OPS_DASHBOARD_TOKEN:token,OPS_DASHBOARD_ACCOUNT_FILE:path.join(tmp,"account.json"),POSTGRES_ENABLED:"false"});
  child=spawn(process.execPath,[path.join(tmp,"ops_dashboard_server.js")],{env,cwd:tmp,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("HTTP test did not start")),10000);child.stdout.on("data",d=>{if(String(d).includes("listening")){clearTimeout(timer);resolve();}});child.on("error",reject);child.on("exit",code=>{clearTimeout(timer);reject(Error(`HTTP test exited ${code}`));});});
  for(const url of ["/api/players","/api/players/access-audit","/api/players/instances/PM-ITEM-TEST","/api/players/10000000-0000-0000-0000-000000000001"]){
    assert.equal((await fetch(`http://127.0.0.1:19095${url}`)).status,401,url);
  }
  assert.equal((await fetch("http://127.0.0.1:19095/api/players",{headers:{authorization:`Bearer ${token}`},method:"POST"})).status,405);
  const disabled=await fetch("http://127.0.0.1:19095/api/players",{headers:{authorization:`Bearer ${token}`}});
  assert.equal(disabled.status,503); assert.match((await disabled.json()).error,/authoritative PostgreSQL/);
  assert.match(await (await fetch("http://127.0.0.1:19095/")).text(),/data-view-tab="players"/);
  console.log("OPS_PLAYER_HTTP_PASS: every player route requires ops auth, mutations rejected, database unavailable fails closed, tab served");
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(child && child.exitCode===null) await new Promise(resolve=>{child.once("exit",resolve);child.kill();});
  assert.equal(path.dirname(fs.realpathSync(tmp)),fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(tmp).startsWith("pixelmania-ops-http-"));fs.rmSync(tmp,{recursive:true,force:true});
});
