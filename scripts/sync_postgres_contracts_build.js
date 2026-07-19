#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const compiledPath = path.join(repoRoot, ".tsbuild", "postgres_store_contracts.js");
const outputPath = path.join(repoRoot, "postgres_store_contracts.js");

if (!fs.existsSync(compiledPath)) {
  throw new Error(`Missing compiled postgres contracts: ${compiledPath}`);
}

const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "");
const header = "// Generated from src/postgres_store_contracts.ts. Do not edit by hand.\n";

fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
console.log("[postgres-contracts] synced generated postgres_store_contracts.js");
