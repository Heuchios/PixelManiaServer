#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RedisStore = require("../redis_store");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const redisStoreSource = fs.readFileSync(path.join(repoRoot, "src", "redis_store.ts"), "utf8");
const redisStoreBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_redis_store_build.js"), "utf8");
const redisStoreBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.redis-store.json"), "utf8"));
const generatedSource = fs.readFileSync(path.join(repoRoot, "redis_store.js"), "utf8");

async function main() {
  const store = new RedisStore({
    enabled: false,
    keyPrefix: "Pixel Test",
    logger: () => {},
  });

  assert.equal(store.isReady(), false);
  assert.equal(store.key("World Route", "START"), "pixel_test:world_route:start");
  assert.equal(store.pattern("lock", "*"), "pixel_test:lock:*");

  assert.deepEqual(await store.checkRateLimit("scope", "subject", 1, 1000), {
    allowed: true,
    fallback: true,
    count: 0,
    resetInMs: 1000,
  });

  /** @type {string[][]} */
  const redisCommands = [];
  const enabledStore = new RedisStore({
    enabled: true,
    keyPrefix: "Pixel Test",
    logger: () => {},
  });
  enabledStore.client = {
    isOpen: true,
    connect: async () => undefined,
    quit: async () => undefined,
    on: () => undefined,
    sendCommand: async (/** @type {string[]} */ command) => {
      redisCommands.push(command);
      return [2, 875];
    },
  };
  enabledStore.ready = true;
  assert.deepEqual(await enabledStore.checkRateLimit("message:player_position", "account:load001", 150, 1000), {
    allowed: true,
    fallback: false,
    count: 2,
    resetInMs: 875,
  });
  assert.equal(redisCommands.length, 1);
  assert.equal(redisCommands[0][0], "EVAL");
  assert.equal(redisCommands[0][2], "1");
  assert.equal(redisCommands[0][3], "pixel_test:rate:message:player_position:account:load001");
  assert.equal(redisCommands[0][4], "1000");
  assert.match(redisCommands[0][1], /count == 1 or ttl < 0/);
  assert.match(redisCommands[0][1], /PEXPIRE/);
  assert.deepEqual(await store.acquireLock("scope", "resource", 1000, "owner"), {
    acquired: true,
    fallback: true,
    key: "",
    token: "",
  });
  assert.deepEqual(await store.reserveWorldAdmission("START", "player-1", 50, 45000), {
    ok: true,
    fallback: true,
    count: 0,
    key: "",
  });
  assert.deepEqual(await store.getWorldAdmissionCount("START"), {
    ok: false,
    fallback: true,
    count: 0,
  });
  assert.deepEqual(await store.claimWorldRoute("START", "instance-1", "wss://example.test/ws", 45000), {
    ok: true,
    fallback: true,
    world: "START",
    owner_instance_id: "instance-1",
    ws_url: "wss://example.test/ws",
  });
  assert.deepEqual(await store.getNetfoxMovementRoute("START"), {
    ok: false,
    fallback: true,
    reason: "redis_unavailable",
    world: "START",
    route: null,
  });
  assert.equal(await store.setActiveSession("uso", "player-1", 60000), false);
  assert.equal(await store.setPresence("uso", { world: "START" }, 45000), false);
  assert.deepEqual(await store.listPresence(), []);

  /** @type {string[][]} */
  const presenceCommands = [];
  const presenceStore = new RedisStore({
    enabled: true,
    keyPrefix: "Pixel Test",
    logger: () => {},
  });
  presenceStore.client = {
    isOpen: true,
    connect: async () => undefined,
    quit: async () => undefined,
    on: () => undefined,
    sendCommand: async (/** @type {string[]} */ command) => {
      presenceCommands.push(command);
      if (command[0] === "SCAN") {
        return ["0", ["pixel_test:presence:uso", "pixel_test:presence:rayan"]];
      }
      if (command[0] === "MGET") {
        return [
          JSON.stringify({ username: "uso", world: "START", joined_world: true }),
          JSON.stringify({ username: "rayan", world: "FARM", joined_world: true }),
        ];
      }
      throw new Error(`Unexpected Redis command: ${command[0]}`);
    },
  };
  presenceStore.ready = true;
  assert.deepEqual(await presenceStore.listPresence(25), [
    { username: "uso", world: "START", joined_world: true },
    { username: "rayan", world: "FARM", joined_world: true },
  ]);
  assert.equal(presenceCommands[0][0], "SCAN");
  assert.equal(presenceCommands[1][0], "MGET");

  const health = await store.getHealthSnapshot();
  assert.equal(health.enabled, false);
  assert.equal(health.ready, false);
  assert.equal(health.key_prefix, "pixel_test");

  assert.equal(
    packageJson.scripts["build:redis-store"],
    "tsc --project tsconfig.redis-store.json && node scripts/sync_redis_store_build.js"
  );
  assert.equal(packageJson.scripts["check:redis-store"], "npm run build:redis-store && node scripts/check_redis_store_build.js");
  assert.match(packageJson.scripts["check:typescript"], /npm run check:redis-store/);
  assert.deepEqual(redisStoreBuildConfig.include, ["src/redis_store.ts"]);
  assert.match(redisStoreBuildSource, /Generated from src\/redis_store\.ts/);
  assert.match(redisStoreSource, /type RedisRecord = Record<string, unknown>/);
  assert.match(redisStoreSource, /RATE_LIMIT_INCREMENT_SCRIPT/);
  assert.match(redisStoreSource, /"EVAL"/);
  assert.match(redisStoreSource, /export = RedisStore/);
  assert.match(generatedSource, /Generated from src\/redis_store\.ts/);
  assert.match(generatedSource, /module\.exports = RedisStore/);

  assert.match(deploySource, /src\/redis_store\.ts/);
  assert.match(deploySource, /tsconfig\.redis-store\.json/);
  assert.match(deploySource, /sync_redis_store_build\.js/);
  assert.match(deploySource, /npm run build:redis-store/);
  assert.match(deploySource, /node --check redis_store\.js/);

  console.log("[redis-store] success");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
