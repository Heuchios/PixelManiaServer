#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const compiledPath = path.join(repoRoot, ".tsbuild", "server_punishment_helpers.js");
const outputPath = path.join(repoRoot, "server_punishment_helpers.js");

if (!fs.existsSync(compiledPath)) {
  throw new Error(`Missing compiled server punishment helpers module: ${compiledPath}`);
}

const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "");
const header = "// Generated from src/server_punishment_helpers.ts. Do not edit by hand.\n";

fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
console.log("[server-punishment-helpers] synced generated server_punishment_helpers.js");
