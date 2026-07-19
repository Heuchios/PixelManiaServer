#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const modules = [
  "atlas_item_definition",
  "item_atlas_db",
  "server_item_database",
];

for (const moduleName of modules) {
  const compiledPath = path.join(repoRoot, ".tsbuild", `${moduleName}.js`);
  const outputPath = path.join(repoRoot, `${moduleName}.js`);

  if (!fs.existsSync(compiledPath)) {
    throw new Error(`Missing compiled item data module: ${compiledPath}`);
  }

  const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "");
  const header = `// Generated from src/${moduleName}.ts. Do not edit by hand.\n`;
  fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
}

console.log("[item-data] synced generated item data modules");
