#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ServerRuntimeStats = require("../server_runtime_stats");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const phase11aRuntimeSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase11a_runtime.ts"), "utf8");
const runtimeStatsSource = fs.readFileSync(path.join(repoRoot, "src", "server_runtime_stats.ts"), "utf8");
const runtimeStatsBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_runtime_stats_build.js"), "utf8");
const runtimeStatsBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-runtime-stats.json"), "utf8"));
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_runtime_stats.js"), "utf8");
const runtimeOwnerSource = `${serverSource}\n${phase11aRuntimeSource}`;

const tickStats = ServerRuntimeStats.createServerTickStats(1000);
assert.deepEqual(ServerRuntimeStats.getServerTickSnapshot(tickStats, { intervalMs: 1000 }), {
  enabled: false,
  started_at: "",
  last_sample_at: "",
  interval_ms: 1000,
  sample_count: 0,
  tps: 0,
  tick_time_ms: 0,
  avg_tick_time_ms: 0,
  max_tick_time_ms: 0,
  event_loop_lag_ms: 0,
  max_event_loop_lag_ms: 0,
});

ServerRuntimeStats.applyServerTickSample(tickStats, 1250, 1000, "2026-01-01T00:00:00.000Z");
assert.equal(tickStats.last_sample_at, "2026-01-01T00:00:00.000Z");
assert.equal(tickStats.sample_count, 1);
assert.equal(tickStats.tick_time_ms, 1250);
assert.equal(tickStats.event_loop_lag_ms, 250);
assert.equal(tickStats.tps, 0.8);

/** @type {Record<string, any>} */
const packetStats = {};
ServerRuntimeStats.recordPacketTypeSize(packetStats, "Player_Position", 100, 2);
ServerRuntimeStats.recordPacketTypeSize(packetStats, "player_position", 140, 2);
ServerRuntimeStats.recordPacketTypeSize(packetStats, "", 20, 2);
ServerRuntimeStats.recordPacketTypeSize(packetStats, "player_position", 200, 2);
/** @type {Record<string, any>} */
const packetSnapshot = ServerRuntimeStats.getPacketTypeSizeStatsSnapshot(packetStats);
assert.equal(packetSnapshot.player_position.count, 3);
assert.equal(packetSnapshot.player_position.avg_bytes, 440 / 3);
assert.equal(packetSnapshot.player_position.p95_bytes, 200);
assert.equal(packetSnapshot.player_position.min_bytes, 100);
assert.equal(packetSnapshot.player_position.max_bytes, 200);
assert.equal(packetSnapshot.player_position.sample_count, 3);
assert.equal(packetSnapshot.unknown.count, 1);
assert.equal(ServerRuntimeStats.normalizePacketTypeName(" Chat "), "chat");

assert.equal(
  packageJson.scripts["build:server-runtime-stats"],
  "tsc --project tsconfig.server-runtime-stats.json && node scripts/sync_server_runtime_stats_build.js"
);
assert.equal(
  packageJson.scripts["check:server-runtime-stats"],
  "npm run build:server-runtime-stats && node scripts/check_server_runtime_stats_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-runtime-stats/);
assert.deepEqual(runtimeStatsBuildConfig.include, ["src/server_runtime_stats.ts"]);
assert.match(runtimeStatsBuildSource, /Generated from src\/server_runtime_stats\.ts/);
assert.match(runtimeStatsSource, /function applyServerTickSample/);
assert.match(runtimeStatsSource, /export = \{/);
assert.match(generatedSource, /Generated from src\/server_runtime_stats\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(serverSource, /require\("\.\/server_runtime_stats"\)/);
assert.match(serverSource, /ServerRuntimeStats\.createServerTickStats/);
assert.match(runtimeOwnerSource, /serverRuntimeStats\.recordPacketTypeSize/);
assert.match(runtimeOwnerSource, /serverRuntimeStats\.getPacketTypeSizeStatsSnapshot/);
assert.match(deploySource, /server_runtime_stats\.js/);
assert.match(deploySource, /src\/server_runtime_stats\.ts/);
assert.match(deploySource, /tsconfig\.server-runtime-stats\.json/);
assert.match(deploySource, /sync_server_runtime_stats_build\.js/);
assert.match(deploySource, /npm run build:server-runtime-stats/);

console.log("[server-runtime-stats] success");
