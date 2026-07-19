#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const compiledPath = path.join(
  repoRoot,
  ".tsbuild",
  "server_phase11d_standard_movement.js",
);
const outputPath = path.join(repoRoot, "server_phase11d_standard_movement.js");

if (!fs.existsSync(compiledPath)) {
  throw new Error(`Missing compiled server phase 11D standard movement module: ${compiledPath}`);
}

const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "");
const header = "// Generated from src/server_phase11d_standard_movement.ts. Do not edit by hand.\n";

fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
console.log("[server-phase11d-standard-movement] synced generated server_phase11d_standard_movement.js");
