"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const n=arg.indexOf("="); return [arg.slice(0,n),arg.slice(n+1)]; }));
async function main() {
  const platform=args.platform, version=args.version, minimum=args.minimum || version;
  if (!["desktop","android"].includes(platform) || !/^\d+\.\d+\.\d+$/.test(version) || !/^\d+\.\d+\.\d+$/.test(minimum)) throw Error("Use platform=desktop|android version=1.2.3 minimum=1.2.3 folder=... notes=... package=... (desktop) play_available=yes (Android)");
  if (minimum.split('.').map(Number).some((v,i,a) => a.slice(0,i).every((p,j)=>p===Number(version.split('.')[j])) && v>Number(version.split('.')[i]))) throw Error("Minimum cannot exceed latest version");
  if (platform === "android" && args.play_available !== "yes") throw Error("Publish Android only after this version is available to all affected players in Google Play. Pass play_available=yes.");
  const folder=path.resolve(args.folder || process.env.CLIENT_RELEASE_FOLDER || path.join(__dirname,"..","client_releases"));
  fs.mkdirSync(folder,{recursive:true});
  const manifest={published:true,latest_version:version,min_client_version:minimum,release_notes:args.notes ? fs.readFileSync(args.notes,"utf8").slice(0,12000) : ""};
  if (platform === "desktop") {
    if (!args.package) throw Error("package=<zip path> is required");
    const hash=crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(args.package)) hash.update(chunk);
    manifest.sha256=hash.digest("hex");
    const target=path.join(folder,`PixelMania-desktop-${version}.zip`);
    if (fs.existsSync(target)) {
      const existing=crypto.createHash("sha256");
      for await (const chunk of fs.createReadStream(target)) existing.update(chunk);
      if (existing.digest("hex")!==manifest.sha256) throw Error("This version already has a different package. Use a new version.");
    } else { fs.copyFileSync(args.package,target+".pending"); fs.renameSync(target+".pending",target); }
  }
  const target=path.join(folder,`${platform}.json`);
  fs.writeFileSync(target+".pending",JSON.stringify(manifest,null,2));
  fs.renameSync(target+".pending",target);
  console.log(`Published ${platform} ${version}: ${target}`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
