#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const compiledPath = path.join(repoRoot, ".tsbuild", "server_landfill_event.js");
const outputPath = path.join(repoRoot, "server_landfill_event.js");

if (!fs.existsSync(compiledPath)) {
  throw new Error(`Missing compiled server landfill event module: ${compiledPath}`);
}

const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^﻿/, "");
const header = "// Generated from src/server_landfill_event.ts. Do not edit by hand.\n";

fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
console.log("[server-landfill-event] synced generated server_landfill_event.js");
