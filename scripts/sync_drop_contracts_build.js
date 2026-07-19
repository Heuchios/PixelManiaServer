#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const compiledPath = path.join(repoRoot, ".tsbuild", "server_drop_contracts.js");
const outputPath = path.join(repoRoot, "server_drop_contracts.js");

if (!fs.existsSync(compiledPath)) {
  throw new Error(`Missing compiled drop contracts: ${compiledPath}`);
}

const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "");
const header = "// Generated from src/server_drop_contracts.ts. Do not edit by hand.\n";

fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
console.log("[drop-contracts] synced generated server_drop_contracts.js");
