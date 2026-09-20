"use strict";
// Public, read-only release metadata. Publish packages before atomically replacing
// the manifest; never derive a filesystem path directly from a request URL.
const fs = require("node:fs");
const path = require("node:path");
const versionPattern = /^\d+\.\d+\.\d+$/;
function createReleaseHandler(options = {}) {
  const shared = path.resolve(__dirname, "../../shared");
  const folder = options.folder || process.env.CLIENT_RELEASE_FOLDER || path.join(process.env.PIXELMANIA_DATA_DIR || (fs.existsSync(shared) ? shared : __dirname), "client_releases");
  const origin = (options.origin || process.env.CLIENT_RELEASE_PUBLIC_URL || "https://api.pixelmaniagame.com").replace(/\/$/, "");
  const json = (res, code, value) => { res.writeHead(code, {"Content-Type": "application/json", "Cache-Control": "no-store"}); res.end(JSON.stringify(value)); };
  return function handleRelease(req, res, url) {
    const platform = url.pathname === "/client/desktop-manifest" ? "desktop" : url.pathname === "/client/android-manifest" ? "android" : "";
    const download = url.pathname.startsWith("/downloads/PixelMania-desktop-") || url.pathname === "/downloads/PixelManiaLauncher.exe";
    if (!platform && !download) return false;
    if (req.method !== "GET" && req.method !== "HEAD") { json(res, 405, {ok:false}); return true; }
    try {
      if (platform) {
        const manifest = JSON.parse(fs.readFileSync(path.join(folder, `${platform}.json`), "utf8"));
        if (!versionPattern.test(manifest.latest_version) || !versionPattern.test(manifest.min_client_version)) throw Error("Invalid version");
        const result = {ok:true, published:manifest.published === true, latest_version:manifest.latest_version, min_client_version:manifest.min_client_version, release_notes:String(manifest.release_notes || "").slice(0, 12000)};
        if (platform === "desktop") {
          const name = `PixelMania-desktop-${manifest.latest_version}.zip`;
          if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || !fs.statSync(path.join(folder, name)).isFile()) throw Error("Missing package");
          Object.assign(result, {download_url:`${origin}/downloads/${name}`, sha256:manifest.sha256, size_bytes:fs.statSync(path.join(folder, name)).size});
        } else result.update_url = "https://play.google.com/store/apps/details?id=com.pixelmaniagame.pixelmania";
        json(res, 200, result);
      } else {
        const name = url.pathname.slice("/downloads/".length);
        const launcher = name === "PixelManiaLauncher.exe";
        if (!launcher && !/^PixelMania-desktop-\d+\.\d+\.\d+\.zip$/.test(name)) { json(res, 404, {ok:false}); return true; }
        const file = path.join(folder, name);
        const stat = fs.statSync(file);
        if (!stat.isFile()) throw Error("Missing package");
        res.writeHead(200, {"Content-Type":launcher ? "application/octet-stream" : "application/zip", "Content-Disposition":`attachment; filename="${name}"`, "Content-Length":stat.size, "Cache-Control":launcher ? "no-cache" : "public, max-age=31536000, immutable", "X-Content-Type-Options":"nosniff"});
        if (req.method === "HEAD") res.end();
        else { const stream = fs.createReadStream(file); stream.on("error", () => res.destroy()); res.on("close", () => stream.destroy()); stream.pipe(res); }
      }
    } catch { json(res, 503, {ok:false, message:"No published update is available yet."}); }
    return true;
  };
}
module.exports = { createReleaseHandler };
