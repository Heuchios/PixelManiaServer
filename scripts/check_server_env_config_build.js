#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ServerEnvConfig = require("../server_env_config");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const envConfigSource = fs.readFileSync(path.join(repoRoot, "src", "server_env_config.ts"), "utf8");
const envConfigBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_env_config_build.js"), "utf8");
const envConfigBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-env-config.json"), "utf8"));
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_env_config.js"), "utf8");

assert.equal(ServerEnvConfig.readPositiveIntEnv("LIMIT", 20, 1, 100, { LIMIT: "7" }), 7);
assert.equal(ServerEnvConfig.readPositiveIntEnv("LIMIT", 20, 5, 100, { LIMIT: "0" }), 5);
assert.equal(ServerEnvConfig.readPositiveIntEnv("LIMIT", 20, 1, 50, { LIMIT: "500" }), 50);
assert.equal(ServerEnvConfig.readPositiveIntEnv("LIMIT", 20, 1, 50, { LIMIT: "nope" }), 20);

assert.equal(ServerEnvConfig.readRateWindowMsEnv("WINDOW_MS", "WINDOW_SECONDS", 1000, { WINDOW_MS: "250" }), 250);
assert.equal(ServerEnvConfig.readRateWindowMsEnv("WINDOW_MS", "WINDOW_SECONDS", 1000, { WINDOW_MS: "10" }), 100);
assert.equal(ServerEnvConfig.readRateWindowMsEnv("WINDOW_MS", "WINDOW_SECONDS", 1000, { WINDOW_SECONDS: "2" }), 2000);
assert.equal(ServerEnvConfig.readRateWindowMsEnv("WINDOW_MS", "WINDOW_SECONDS", 2500, {}), 2500);
assert.equal(
  ServerEnvConfig.readRateWindowMsEnv("WINDOW_MS", "WINDOW_SECONDS", 1000, { WINDOW_MS: String(48 * 60 * 60 * 1000) }),
  24 * 60 * 60 * 1000
);

const config = ServerEnvConfig.makeBotRateLimitConfig("BOT_TEST", 10, 1000, 25, {
  BOT_TEST_LIMIT: "30",
  BOT_TEST_WINDOW_SECONDS: "3",
});
assert.equal(config.limit, 25);
assert.equal(config.windowMs, 3000);
assert.equal(Object.isFrozen(config), true);

assert.equal(
  packageJson.scripts["build:server-env-config"],
  "tsc --project tsconfig.server-env-config.json && node scripts/sync_server_env_config_build.js"
);
assert.equal(
  packageJson.scripts["check:server-env-config"],
  "npm run build:server-env-config && node scripts/check_server_env_config_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-env-config/);
assert.deepEqual(envConfigBuildConfig.include, ["src/server_env_config.ts"]);
assert.match(envConfigBuildSource, /Generated from src\/server_env_config\.ts/);
assert.match(envConfigSource, /function makeBotRateLimitConfig/);
assert.match(envConfigSource, /export = \{/);
assert.match(generatedSource, /Generated from src\/server_env_config\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(serverSource, /require\("\.\/server_env_config"\)/);
assert.match(serverSource, /ServerEnvConfig\.makeBotRateLimitConfig/);
assert.match(deploySource, /server_env_config\.js/);
assert.match(deploySource, /src\/server_env_config\.ts/);
assert.match(deploySource, /tsconfig\.server-env-config\.json/);
assert.match(deploySource, /sync_server_env_config_build\.js/);
assert.match(deploySource, /npm run build:server-env-config/);

console.log("[server-env-config] success");
