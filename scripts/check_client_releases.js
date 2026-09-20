"use strict";
const assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path"), os=require("node:os"), http=require("node:http");
const {createReleaseHandler}=require("../client_releases");
(async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"pixelmania-releases-"));
 const handler=createReleaseHandler({folder,origin:"https://api.example.test"});
 const server=http.createServer((req,res)=>{if(!handler(req,res,new URL(req.url,"http://localhost"))){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
  assert.equal((await fetch(base+"/client/desktop-manifest")).status,503);
  const manifest={latest_version:"1.2.3",min_client_version:"1.2.0",published:true,sha256:"a".repeat(64),release_notes:"New launcher"};
  fs.writeFileSync(path.join(folder,"desktop.json"),JSON.stringify(manifest));
  assert.equal((await fetch(base+"/client/desktop-manifest")).status,503);
  fs.writeFileSync(path.join(folder,"PixelMania-desktop-1.2.3.zip"),"package");
  const response=await fetch(base+"/client/desktop-manifest");
  assert.equal(response.headers.get("cache-control"),"no-store");
  const result=await response.json();
  assert.equal(result.download_url,"https://api.example.test/downloads/PixelMania-desktop-1.2.3.zip");
  assert.equal(result.release_notes,"New launcher");
  assert.equal(await (await fetch(base+"/downloads/PixelMania-desktop-1.2.3.zip")).text(),"package");
  assert.equal((await fetch(base+"/downloads/PixelMania-desktop-..%2fsecret.zip")).status,404);
  assert.equal((await fetch(base+"/client/desktop-manifest",{method:"POST"})).status,405);
  fs.writeFileSync(path.join(folder,"android.json"),JSON.stringify(manifest));
  assert.equal((await (await fetch(base+"/client/android-manifest")).json()).update_url,"https://play.google.com/store/apps/details?id=com.pixelmaniagame.pixelmania");
  console.log("CLIENT_RELEASES_PASS");
 } finally {await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
