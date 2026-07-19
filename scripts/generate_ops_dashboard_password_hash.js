"use strict";

const crypto = require("crypto");

const providedPassword = process.argv.slice(2).join(" ").trim();
const password = providedPassword || crypto.randomBytes(24).toString("base64url");
const salt = crypto.randomBytes(16);
const n = 16384;
const r = 8;
const p = 1;
const keyLength = 64;
const hash = crypto.scryptSync(password, salt, keyLength, {
  N: n,
  r,
  p,
  maxmem: 128 * 1024 * 1024,
}).toString("hex");

console.log("PixelMania Ops Dashboard password setup");
console.log("");
if (!providedPassword) {
  console.log("OPS_DASHBOARD_ADMIN_PASSWORD=" + password);
}
console.log(`OPS_DASHBOARD_ADMIN_PASSWORD_HASH=scrypt:${n}:${r}:${p}:${salt.toString("base64url")}:${hash}`);
console.log("");
console.log("Use the raw password to sign in. Store only the hash on the server.");
