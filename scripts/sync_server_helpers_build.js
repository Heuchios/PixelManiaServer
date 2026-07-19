#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const moduleNames = [
  "server_identity_helpers",
  "server_text_helpers",
  "server_version_helpers",
  "server_account_helpers",
];

for (const moduleName of moduleNames) {
  const compiledPath = path.join(repoRoot, ".tsbuild", `${moduleName}.js`);
  const outputPath = path.join(repoRoot, `${moduleName}.js`);

  if (!fs.existsSync(compiledPath)) {
    throw new Error(`Missing compiled server helper module: ${compiledPath}`);
  }

  const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "");
  const header = `// Generated from src/${moduleName}.ts. Do not edit by hand.\n`;
  fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
}

console.log("[server-helpers] synced generated helper modules");
