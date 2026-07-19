#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const compiledPath = path.join(repoRoot, ".tsbuild", "server-entry", "server.js");
const outputPath = path.join(repoRoot, "server.js");
const temporaryPath = `${outputPath}.typescript-build-${process.pid}.tmp`;

if (!fs.existsSync(compiledPath)) {
  throw new Error(`Missing compiled TypeScript server entry: ${compiledPath}`);
}

const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^\uFEFF/, "");
const header = "// Generated from src/server.ts. Do not edit by hand.\n";
const nextSource = `${header}${compiledSource}`;
const currentSource = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";

if (currentSource === nextSource) {
  console.log("[server-entry] generated server.js is current");
  process.exit(0);
}

fs.writeFileSync(temporaryPath, nextSource, "utf8");
fs.renameSync(temporaryPath, outputPath);
console.log("[server-entry] synced generated server.js");
