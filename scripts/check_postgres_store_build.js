#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PostgresStore = require("../postgres_store");
const { effectiveStrictness, resolveTsconfig } = require("./tsconfig_effective");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const baseTypeScriptConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.json"), "utf8"));
// The SOURCE, not the emit. Pins here use the `import X = require(...)` form.
// check_postgres_contracts.js reads the GENERATED postgres_store.js instead, where the
// same declaration appears as `const X = require(...)` -- do not unify the two.
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
assert.equal(typeof store.queryReadWithRetry, "function");
assert.equal(typeof store.applyDropPickupTransaction, "function");
assert.equal(typeof store.applyInventoryDeltaTransaction, "function");
assert.equal(typeof store.loadPlayerState, "function");
assert.equal(typeof store.saveWorldStateWithWorldChanges, "function");
assert.equal(typeof store.listOwnedWorldLocks, "function");
assert.equal(typeof store.auditIntegrityHashes, "function");
assert.equal(typeof store.getAdminMonitoringDashboard, "function");
assert.equal(typeof store.recordWorldHonorVisit, "function");
assert.equal(typeof store.getWorldHonorLeaderboard, "function");

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
    beard_inventory: {},
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

// Stays on `tsc --project`, but the REASON changed once the four seams became typed
// imports. It used to be that nothing crossed the boundary at all: as
// `const X = require("./y")` tsc never loaded the target, so a project reference had
// nothing to short-circuit (--listFiles showed 200 files with server_item_database in
// neither source nor .d.ts form). Now those four ARE type-level imports, so this project
// genuinely compiles their source -- pinned as `inlineDependencies` in
// check_tsconfig_projects.js. Inline is the deliberate choice: it checks more than
// reading a .d.ts. Switching to `references` would require `tsc --build` here and
// `composite: true` on all four targets.
assert.equal(
  packageJson.scripts["build:postgres-store"],
  "tsc --project tsconfig.postgres-store.json && node scripts/sync_postgres_store_build.js"
);
assert.equal(packageJson.scripts["check:postgres-store"], "npm run build:postgres-store && node scripts/check_postgres_store_build.js");
assert.match(packageJson.scripts["check:typescript"], /npm run check:postgres-store/);
assert.deepEqual(postgresStoreBuildConfig.include, ["src/postgres_store.ts"]);

// tsconfig.postgres-store.json extends ./tsconfig.json, so most of these options
// are inherited and are absent from its own JSON. Reading the raw file would make
// every assertion below pass vacuously -- including if the base dropped `strict`
// entirely. Assert the values tsc will actually use.
const postgresStoreEffective = resolveTsconfig(path.join(repoRoot, "tsconfig.postgres-store.json"));
const postgresStoreStrictness = effectiveStrictness(postgresStoreEffective.compilerOptions);
assert.equal(postgresStoreStrictness.strict, true);
assert.equal(postgresStoreStrictness.noImplicitAny, true);
assert.equal(postgresStoreStrictness.noImplicitThis, true);
assert.equal(postgresStoreStrictness.strictFunctionTypes, true);
assert.equal(postgresStoreStrictness.useUnknownInCatchVariables, true);
// Not part of the `strict` family, so `effectiveStrictness` cannot see them. These two
// were local to this project until measurements showed enabling them everywhere was
// free; they now come from the base. Asserted on the RESOLVED config so this keeps
// working whether they are inherited or local.
assert.equal(postgresStoreEffective.compilerOptions.noFallthroughCasesInSwitch, true);
assert.equal(postgresStoreEffective.compilerOptions.noImplicitReturns, true);
// The base leaves this file out so it is only ever checked by the strict project
// above; postgres-store clears `exclude` so its own include can still see it.
assert.ok(baseTypeScriptConfig.exclude.includes("src/postgres_store.ts"));
assert.deepEqual(postgresStoreBuildConfig.exclude, []);
assert.doesNotMatch(postgresStoreSource, /@ts-nocheck/);
assert.match(postgresStoreBuildSource, /Generated from src\/postgres_store\.ts/);
assert.match(postgresStoreSource, /export = PostgresStore/);
// All four dependency seams are type-level imports. As `const X = require(...)` they
// were calls on Node's `require` typed `any`, so none of the 73 call sites across 54
// distinct members was checked against its producer.
for (const dependency of [
  "DropContracts = require(\"./server_drop_contracts\")",
  "InventoryContracts = require(\"./server_inventory_contracts\")",
  "PostgresContracts = require(\"./postgres_store_contracts\")",
  "ItemDatabase = require(\"./server_item_database\")",
]) {
  assert.ok(
    postgresStoreSource.includes(`import ${dependency};`),
    `src/postgres_store.ts must import ${dependency} as a typed import, not a runtime require`,
  );
}
assert.match(postgresStoreSource, /^import PostgresContracts = require\("\.\/postgres_store_contracts"\);$/m);
assert.match(postgresStoreSource, /queryReadWithRetry\("account states load"/);
assert.match(postgresStoreSource, /queryReadWithRetry\("player states load"/);
assert.match(postgresStoreSource, /queryReadWithRetry\("world states load"/);
assert.match(postgresStoreSource, /world state load failed after retries:[\s\S]*throw postgresError\(error\)/);
assert.match(postgresStoreSource, /function assertPostgresOperationCanContinue/);
assert.match(postgresStoreSource, /concurrent \? this\.withTransactionNow\(work\) : this\.withTransaction\(work\)/);
assert.match(postgresStoreSource, /world_honor_visits/);
assert.match(postgresStoreSource, /async recordWorldHonorVisit/);
assert.match(postgresStoreSource, /async getWorldHonorLeaderboard/);
const trackedDropBodyStart = postgresStoreSource.indexOf("async recordWorldChangeAndTrackedDrops");
assert.ok(trackedDropBodyStart >= 0, "tracked drop writer exists");
const trackedDropBody = postgresStoreSource.slice(
  trackedDropBodyStart,
  postgresStoreSource.indexOf("async loadWorldStateForUpdate", trackedDropBodyStart)
);
assert.match(trackedDropBody, /const detailDropX = Number\(changeDetails\.x\)/);
assert.match(trackedDropBody, /const auditDropX = Number\(change\?\.x\)/);
assert.ok(
  trackedDropBody.indexOf("Number.isFinite(detailDropX)") < trackedDropBody.indexOf("Number.isFinite(auditDropX)"),
  "tracked drop rows must prefer actual detail x before audit grid x"
);
assert.match(trackedDropBody, /item_type: cleanName\(changeDetails\.item_type \|\| change\?\.item_type \|\| change\?\.block_type \|\| ""\)/);
assert.match(trackedDropBody, /x: dropX/);
assert.match(trackedDropBody, /y: dropY/);
assert.match(postgresStoreSource, /pg_advisory_xact_lock/);
assert.match(postgresStoreSource, /revokeRotatedToken/);
assert.match(postgresStoreSource, /revokeOtherSessions/);
assert.match(postgresStoreSource, /PIXELMANIA_OPERATION_ABORTED/);
assert.match(generatedSource, /Generated from src\/postgres_store\.ts/);
assert.match(generatedSource, /module\.exports = PostgresStore/);
assert.match(generatedSource, /return PostgresContracts\.worldLockRowToPayload\(row\);/);
assert.match(generatedSource, /applyDropPickupTransaction/);
assert.match(generatedSource, /applyInventoryDeltaTransaction/);
assert.match(generatedSource, /applyCanonicalInventoryRowsToPlayerState/);
assert.match(generatedSource, /async loadPlayerState/);
assert.match(generatedSource, /async queryReadWithRetry/);
assert.match(generatedSource, /saveWorldStateWithWorldChanges/);
assert.match(generatedSource, /async recordWorldHonorVisit/);
assert.match(generatedSource, /async getWorldHonorLeaderboard/);

assert.match(deploySource, /src\/postgres_store\.ts/);
assert.match(deploySource, /tsconfig\.postgres-store\.json/);
assert.match(deploySource, /sync_postgres_store_build\.js/);
assert.match(deploySource, /npm run build:postgres-store/);
assert.match(deploySource, /node --check postgres_store\.js/);

async function verifyTrackedDropCoordinatePersistence() {
  /** @type {{ drop: any, options: any }} */
  const captured = {
    drop: null,
    options: null,
  };
  const testStore = /** @type {any} */ (store);
  testStore.recordWorldChangeEntry = async () => ({ ok: true });
  testStore.createTrackedWorldDropItemInstances = async () => ({
    ok: true,
    tracked: true,
    created: 0,
    item_instances: [],
  });
  /**
   * @param {unknown} _client
   * @param {unknown} _worldId
   * @param {any} drop
   * @param {any} options
   */
  testStore.upsertWorldDropRow = async (_client, _worldId, drop, options) => {
    captured.drop = drop;
    captured.options = options;
    return { ok: true, drop };
  };

  await testStore.recordWorldChangeAndTrackedDrops({}, "world-1", {
    source_type: "world_block_break",
    source_id: "block-tx-1",
    action: "break_drop",
    x: 12,
    y: 9,
    block_type: "stone",
    details: {
      drop_id: "drop-1",
      item_type: "dirt",
      item_category: "block",
      amount: 2,
      x: 400,
      y: 288,
      stack_grid_x: 12,
      stack_grid_y: 9,
      pickup_delay: 0.75,
    },
  });

  assert.equal(captured.drop.x, 400);
  assert.equal(captured.drop.y, 288);
  assert.equal(captured.drop.item_type, "dirt");
  assert.equal(captured.drop.stack_grid_x, 12);
  assert.equal(captured.drop.stack_grid_y, 9);
  assert.equal(captured.drop.pickup_delay, 0.75);
  assert.equal(captured.options.action, "break_drop");
}

verifyTrackedDropCoordinatePersistence()
  .then(() => {
    console.log("[postgres-store] success");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
