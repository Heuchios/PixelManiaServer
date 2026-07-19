#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const compiledPath = path.join(repoRoot, ".tsbuild", "redis_store.js");
const outputPath = path.join(repoRoot, "redis_store.js");

if (!fs.existsSync(compiledPath)) {
  throw new Error(`Missing compiled Redis store: ${compiledPath}`);
}

const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "");
const header = "// Generated from src/redis_store.ts. Do not edit by hand.\n";

fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
console.log("[redis-store] synced generated redis_store.js");
