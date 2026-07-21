#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

/**
 * @param {string} relativePath
 * @returns {string}
 */
function readRequired(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  assert.ok(fs.existsSync(filePath), `Missing Phase 11E-11J artifact: ${relativePath}`);
  return fs.readFileSync(filePath, "utf8");
}

const source = readRequired("src/server.ts");
const generated = readRequired("server.js");
const compiled = readRequired(".tsbuild/server-entry/server.js").replace(/^\uFEFF/, "");
const syncSource = readRequired("scripts/sync_server_entry_build.js");
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const config = JSON.parse(readRequired("tsconfig.server-entry.json"));
const packageJson = JSON.parse(readRequired("package.json"));
const explicitAnyCount = (source.match(/:\s*any\b/g) || []).length;
const maxExplicitAnyCount = 3673;

const phaseOwnership = {
  "11E presence, interest, and delivery": [
    "broadcastPlayerPresenceToInterestedPlayers",
    "queuePlayerPositionBroadcast",
    "syncDropInterestForReceiver",
    "queueWorldUpdateBroadcast",
    "broadcastToWorld",
  ],
  "11F world routing and admission": [
    "getWorldPlayerRecords",
    "ensureWorldRouteForAction",
    "reserveWorldAdmission",
    "commitWorldAdmissionReservation",
    "broadcastWorldPopulationUpdate",
  ],
  "11G world simulation and persistence": [
    "ensureWorldState",
    "queueWorldSave",
    "createWorldSnapshot",
    "startWorldEventRandomScheduler",
    "buildWorldStateMessage",
  ],
  "11H gameplay transactions and interactions": [
    "handleInventoryTransactionRequest",
    "prepareDropPickup",
    "handleBulkDropPickup",
    "applyInteractionUpdateToWorldState",
    "handleVendingTransaction",
  ],
  "11I administration, moderation, and security": [
    "handleDeveloperCommandRequestUnsafe",
    "handleAdminMonitoringDashboardRequest",
    "logSecurityEvent",
    "checkBotActionRateLimit",
    "requireAuthenticated",
  ],
  "11J production entry and shutdown": [
    "handleHttpRequest",
    "bootstrapServer",
    "startHttpServer",
    "shutdown",
    "handleFatalProcessError",
  ],
};

for (const [label, functionNames] of Object.entries(phaseOwnership)) {
  for (const functionName of functionNames) {
    assert.match(
      source,
      new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`),
      `src/server.ts must own ${functionName} for ${label}`,
    );
    assert.match(
      generated,
      new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`),
      `generated server.js must contain ${functionName} for ${label}`,
    );
  }
  console.log(`[server-entry] ok: ${label}`);
}

const generatedHeader = "// Generated from src/server.ts. Do not edit by hand.\n";
assert.ok(generated.startsWith(generatedHeader), "server.js must be marked as generated");
assert.equal(generated, `${generatedHeader}${compiled}`, "server.js must exactly match the current TypeScript build");
assert.ok(!source.includes("@ts-nocheck"), "src/server.ts must not disable TypeScript checking");
assert.ok(config.compilerOptions?.noEmitOnError === true, "server entry build must refuse emit on compiler errors");
assert.ok(config.compilerOptions?.noCheck !== true, "server entry build must not use noCheck");
for (const strictOption of [
  "strict",
  "noImplicitAny",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictPropertyInitialization",
  "useUnknownInCatchVariables",
]) {
  assert.equal(config.compilerOptions?.[strictOption], true, `server entry build must enable ${strictOption}`);
}
assert.ok(
  explicitAnyCount <= maxExplicitAnyCount,
  `src/server.ts explicit any count increased: ${explicitAnyCount} > ${maxExplicitAnyCount}`,
);
console.log(`[server-entry] explicit any budget: ${explicitAnyCount}/${maxExplicitAnyCount}`);
assert.deepEqual(config.include, ["src/server.ts"]);
assert.ok(syncSource.includes(".tsbuild\", \"server-entry\", \"server.js"));
assert.ok(syncSource.includes("Generated from src/server.ts"));

assert.equal(packageJson.main, "server.js");
assert.equal(packageJson.scripts?.start, "node server.js");
assert.ok(packageJson.scripts?.["build:server-entry"]?.includes("tsconfig.server-entry.json"));
assert.ok(packageJson.scripts?.["build:server-entry"]?.includes("sync_server_entry_build.js"));
assert.ok(packageJson.scripts?.["check:server-entry"]?.includes("npm run build:server-entry"));
assert.ok(packageJson.scripts?.["check:server-entry"]?.includes("check_server_phase11e_to_11j_entry_build.js"));
assert.ok(packageJson.scripts?.["check:typescript"]?.includes("npm run check:server-entry"));

for (const deployMarker of [
  "$localBackendSource",
  "$localServerEntryBuildConfig",
  "$localServerEntryCheck",
  "$localServerEntryBuildSync",
  "npm run check:server-entry",
]) {
  assert.ok(deploySource.includes(deployMarker), `deploy helper must include ${deployMarker}`);
}

childProcess.execFileSync(process.execPath, ["--check", path.join(repoRoot, "server.js")], {
  cwd: repoRoot,
  stdio: "pipe",
});

console.log("[server-entry] success");
