#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RedisStore = require("../redis_store");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
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
