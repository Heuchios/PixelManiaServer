#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const compiledPath = path.join(repoRoot, ".tsbuild", "server_account_auth_routes.js");
const outputPath = path.join(repoRoot, "server_account_auth_routes.js");

if (!fs.existsSync(compiledPath)) {
  throw new Error(`Missing compiled server account auth routes module: ${compiledPath}`);
}

const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "");
const header = "// Generated from src/server_account_auth_routes.ts. Do not edit by hand.\n";

fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
console.log("[server-account-auth-routes] synced generated server_account_auth_routes.js");
