#!/usr/bin/env node
// @ts-check
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const compiledPath = path.join(repoRoot, ".tsbuild", "server_calendar_events.js");
const outputPath = path.join(repoRoot, "server_calendar_events.js");

if (!fs.existsSync(compiledPath)) {
  throw new Error(`Missing compiled server calendar events module: ${compiledPath}`);
}

const compiledSource = fs.readFileSync(compiledPath, "utf8").replace(/^﻿/, "");
const header = "// Generated from src/server_calendar_events.ts. Do not edit by hand.\n";

fs.writeFileSync(outputPath, `${header}${compiledSource}`, "utf8");
console.log("[server-calendar-events] synced generated server_calendar_events.js");
