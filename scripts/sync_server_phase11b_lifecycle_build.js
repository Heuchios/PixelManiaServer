#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const compiledPath = path.join(repoRoot, ".tsbuild", "server_phase11b_lifecycle.js");
const outputPath = path.join(repoRoot, "server_phase11b_lifecycle.js");

if (!fs.existsSync(compiledPath)) {
  throw new Error(`Missing compiled server phase 11B lifecycle module: ${compiledPath}`);
}

const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "");
const header = "// Generated from src/server_phase11b_lifecycle.ts. Do not edit by hand.\n";

fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
console.log("[server-phase11b-lifecycle] synced generated server_phase11b_lifecycle.js");
