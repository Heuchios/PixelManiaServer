#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PostgresStore = require("../postgres_store");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const postgresStoreSource = fs.readFileSync(path.join(repoRoot, "src", "postgres_store.ts"), "utf8");
const postgresStoreBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_postgres_store_build.js"), "utf8");
const postgresStoreBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.postgres-store.json"), "utf8"));
const generatedSource = fs.readFileSync(path.join(repoRoot, "postgres_store.js"), "utf8");

const store = new PostgresStore({
  enabled: false,
  schema: "pixel_mania_test",
  logger: () => {},
});

assert.equal(store.isReady(), false);
assert.equal(store.table("accounts"), "\"pixel_mania_test\".\"accounts\"");
assert.equal(typeof store.withTransaction, "function");
assert.equal(typeof store.applyDropPickupTransaction, "function");
assert.equal(typeof store.applyInventoryDeltaTransaction, "function");
assert.equal(typeof store.loadPlayerState, "function");
assert.equal(typeof store.saveWorldStateWithWorldChanges, "function");
assert.equal(typeof store.listOwnedWorldLocks, "function");
assert.equal(typeof store.auditIntegrityHashes, "function");
assert.equal(typeof store.getAdminMonitoringDashboard, "function");

assert.equal(PostgresStore.INTEGRITY_HASH_ALGORITHM, "sha256:v1");
assert.equal(typeof PostgresStore.applyCanonicalInventoryRowsToPlayerState, "function");
assert.equal(typeof PostgresStore.buildTransactionLedgerHash, "function");
assert.equal(typeof PostgresStore.integrityHash, "function");
assert.match(PostgresStore.buildTransactionLedgerHash({ transaction_id: "tx-1" }), /^[a-f0-9]{64}$/);
assert.match(PostgresStore.integrityHash({ ok: true }), /^[a-f0-9]{64}$/);
assert.deepEqual(
  PostgresStore.applyCanonicalInventoryRowsToPlayerState(
    {
      inventory: { dirt: 200 },
      seed_inventory: { dirt_seed: 5 },
      tool_inventory: { wrench: 1 },
      player_level: 7,
    },
    [
      { item_type: "stone", item_category: "block", amount: 12 },
      { item_type: "lava_seed", item_category: "seed", amount: 3 },
      { item_type: "fishing_rod", item_category: "tool", amount: 1 },
    ]
  ),
  {
    inventory: { stone: 12 },
    seed_inventory: { lava_seed: 3 },
    tool_inventory: { fishing_rod: 1 },
    back_inventory: {},
    hat_inventory: {},
    hair_inventory: {},
    eyewear_inventory: {},
    shirt_inventory: {},
    pants_inventory: {},
    shoes_inventory: {},
    ride_inventory: {},
    currency_inventory: {},
    material_inventory: {},
    lure_inventory: {},
    fish_inventory: {},
    player_level: 7,
    fish_inventory_unit: "count",
  }
);

assert.equal(
  packageJson.scripts["build:postgres-store"],
  "tsc --project tsconfig.postgres-store.json && node scripts/sync_postgres_store_build.js"
);
assert.equal(packageJson.scripts["check:postgres-store"], "npm run build:postgres-store && node scripts/check_postgres_store_build.js");
assert.match(packageJson.scripts["check:typescript"], /npm run check:postgres-store/);
assert.deepEqual(postgresStoreBuildConfig.include, ["src/postgres_store.ts"]);
assert.equal(postgresStoreBuildConfig.compilerOptions.strict, false);
assert.match(postgresStoreBuildSource, /Generated from src\/postgres_store\.ts/);
assert.match(postgresStoreSource, /export = PostgresStore/);
assert.match(postgresStoreSource, /const PostgresContracts = require\("\.\/postgres_store_contracts"\)/);
assert.match(generatedSource, /Generated from src\/postgres_store\.ts/);
assert.match(generatedSource, /module\.exports = PostgresStore/);
assert.match(generatedSource, /return PostgresContracts\.worldLockRowToPayload\(row\);/);
assert.match(generatedSource, /applyDropPickupTransaction/);
assert.match(generatedSource, /applyInventoryDeltaTransaction/);
assert.match(generatedSource, /applyCanonicalInventoryRowsToPlayerState/);
assert.match(generatedSource, /async loadPlayerState/);
assert.match(generatedSource, /saveWorldStateWithWorldChanges/);

assert.match(deploySource, /src\/postgres_store\.ts/);
assert.match(deploySource, /tsconfig\.postgres-store\.json/);
assert.match(deploySource, /sync_postgres_store_build\.js/);
assert.match(deploySource, /npm run build:postgres-store/);
assert.match(deploySource, /node --check postgres_store\.js/);

console.log("[postgres-store] success");
