"use strict";

const crypto = require("crypto");

const providedToken = process.argv.slice(2).join(" ").trim();
const token = providedToken || crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(token, "utf8").digest("hex");

console.log("PixelMania Ops Dashboard token setup");
console.log("");
if (!providedToken) {
  console.log("OPS_DASHBOARD_TOKEN=" + token);
}
console.log("OPS_DASHBOARD_TOKEN_HASH=" + hash);
console.log("");
console.log("Use the raw token to log in. Store only the hash on the server when possible.");
