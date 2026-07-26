#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PersistenceHelpers = require("../server_persistence_helpers");

function createDeferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => undefined;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function main() {
  const repoRoot = path.join(__dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
  const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
  const persistenceSource = fs.readFileSync(path.join(repoRoot, "src", "server_persistence_helpers.ts"), "utf8");
  const persistenceBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_persistence_helpers_build.js"), "utf8");
  const persistenceBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-persistence-helpers.json"), "utf8"));
  const generatedSource = fs.readFileSync(path.join(repoRoot, "server_persistence_helpers.js"), "utf8");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-persistence-"));
  /** @type {string[]} */
  const warnings = [];
  /** @param {...unknown} args */
  const warn = (...args) => warnings.push(args.join(" "));

  try {
    const jsonPath = path.join(tempRoot, "nested", "state.json");
    PersistenceHelpers.writeJsonFileAtomic(jsonPath, { saved_at: "2026-01-01T00:00:00.000Z", inventory: { dirt: 2 } });
    assert.deepEqual(PersistenceHelpers.readJsonFile(jsonPath, warn), {
      saved_at: "2026-01-01T00:00:00.000Z",
      inventory: { dirt: 2 },
    });
    assert.equal(fs.readFileSync(jsonPath, "utf8").endsWith("\n"), true);
    assert.equal(PersistenceHelpers.getJsonSavedAtTime(jsonPath, warn), Date.parse("2026-01-01T00:00:00.000Z"));

    const asyncPath = path.join(tempRoot, "async", "state.json");
    await PersistenceHelpers.writeJsonFileAtomicAsync(asyncPath, { player_data: { saved_at: "2026-01-02T00:00:00.000Z" } });
    assert.equal(PersistenceHelpers.getJsonSavedAtTime(asyncPath, warn), Date.parse("2026-01-02T00:00:00.000Z"));

    const corruptPath = path.join(tempRoot, "bad.json");
    fs.writeFileSync(corruptPath, "{bad", "utf8");
    assert.equal(PersistenceHelpers.readJsonFile(corruptPath, warn), null);
    assert.equal(fs.readdirSync(tempRoot).some((name) => name.startsWith("bad.json.corrupt-")), true);

    assert.equal(PersistenceHelpers.getCountDictionaryScore({ a: 2, b: "3", c: -1, d: "nope" }), 5);
    assert.equal(PersistenceHelpers.getJsonContentScore({ player_data: { inventory: { dirt: 2 }, tool_inventory: { wrench: 1 } } }), 3);
    assert.equal(PersistenceHelpers.getJsonContentScore({ foreground: [{}, {}], drops: [{}] }), 3);
    assert.equal(PersistenceHelpers.getJsonContentScore({ accounts: [{}, {}, {}] }), 3);

    const mutableSnapshot = { foreground: [{ x: 1, y: 2, block_type: "dirt" }] };
    const frozenSnapshot = PersistenceHelpers.clonePersistenceSnapshot(mutableSnapshot);
    mutableSnapshot.foreground[0].block_type = "lava";
    assert.equal(frozenSnapshot.foreground[0].block_type, "dirt");

    assert.deepEqual(PersistenceHelpers.resolveWorldLoadRevision({
      memory_exists: true,
      memory_revision: 12,
      database_found: true,
      database_revision: 10,
      memory_authoritative: true,
    }), { source: "memory", reason: "owned_memory_revision_newer" });
    assert.deepEqual(PersistenceHelpers.resolveWorldLoadRevision({
      memory_exists: true,
      memory_revision: 12,
      database_found: true,
      database_revision: 10,
      memory_authoritative: false,
    }), { source: "database", reason: "uncommitted_memory_rejected" });
    assert.deepEqual(PersistenceHelpers.resolveWorldLoadRevision({
      memory_exists: true,
      memory_revision: 12,
      database_found: true,
      database_revision: 13,
      memory_authoritative: true,
    }), { source: "database", reason: "database_revision_current" });
    assert.deepEqual(PersistenceHelpers.resolveWorldLoadRevision({
      memory_exists: true,
      memory_revision: 12,
      database_found: false,
      database_revision: 0,
      memory_authoritative: false,
    }), { source: "empty", reason: "database_missing" });

    const coordinator = PersistenceHelpers.createWorldPersistenceCoordinator();
    const firstSaveGate = createDeferred();
    /** @type {string[]} */
    const saveOrder = [];
    const firstSave = coordinator.enqueue("TEST", async () => {
      saveOrder.push("first:start");
      await firstSaveGate.promise;
      saveOrder.push("first:end");
    });
    const secondSave = coordinator.enqueue("test", async () => {
      saveOrder.push("second:start");
      saveOrder.push("second:end");
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(saveOrder, ["first:start"]);
    firstSaveGate.resolve();
    await Promise.all([firstSave, secondSave]);
    assert.deepEqual(saveOrder, ["first:start", "first:end", "second:start", "second:end"]);
    assert.equal(coordinator.pendingCount(), 0);

    const sourcePath = path.join(tempRoot, "source.json");
    const targetPath = path.join(tempRoot, "target", "state.json");
    PersistenceHelpers.writeJsonFileAtomic(sourcePath, {
      saved_at: "2026-01-03T00:00:00.000Z",
      inventory: { dirt: 20 },
    });
    PersistenceHelpers.writeJsonFileAtomic(targetPath, {
      saved_at: "2026-01-04T00:00:00.000Z",
      inventory: { dirt: 1 },
    });
    PersistenceHelpers.copyJsonIfMissingOrNewer(sourcePath, targetPath, "state", warn);
    assert.deepEqual(PersistenceHelpers.readJsonFile(targetPath, warn).inventory, { dirt: 20 });
    assert.equal(fs.readdirSync(path.dirname(targetPath)).some((name) => name.startsWith("state.json.pre-migration-")), true);

    const folderSource = path.join(tempRoot, "folder-source");
    const folderTarget = path.join(tempRoot, "folder-target");
    fs.mkdirSync(folderSource, { recursive: true });
    PersistenceHelpers.writeJsonFileAtomic(path.join(folderSource, "a.json"), { saved_at: "2026-01-05T00:00:00.000Z" });
    fs.writeFileSync(path.join(folderSource, "ignore.txt"), "ignored", "utf8");
    PersistenceHelpers.copyJsonFolderIfMissingOrNewer(folderSource, folderTarget, "folder", warn);
    assert.equal(fs.existsSync(path.join(folderTarget, "a.json")), true);
    assert.equal(fs.existsSync(path.join(folderTarget, "ignore.txt")), false);

    const pending = new Set();
    const tracked = PersistenceHelpers.trackPersistenceWrite(pending, Promise.resolve("ok"), "ok", warn);
    assert.equal(typeof tracked.then, "function");
    assert.equal(pending.size, 1);
    await PersistenceHelpers.waitForPersistenceWrites(pending);
    assert.equal(pending.size, 0);

    PersistenceHelpers.trackPersistenceWrite(pending, Promise.reject(new Error("boom")), "bad", warn);
    await PersistenceHelpers.waitForPersistenceWrites(pending);
    assert.equal(pending.size, 0);
    assert.equal(warnings.some((line) => line.includes("[persistence] bad failed: boom")), true);

    const retainedFailures = new Set();
    PersistenceHelpers.trackPersistenceWrite(
      pending,
      Promise.resolve(false),
      "database-world-save",
      warn,
      /** @type {any} */ (retainedFailures),
    );
    const failedSummary = await PersistenceHelpers.waitForPersistenceWrites(
      pending,
      /** @type {any} */ (retainedFailures),
    );
    assert.deepEqual(failedSummary, { ok: false, total: 1, failed: 1 });
    assert.equal(retainedFailures.has("database-world-save"), true);

    assert.equal(PersistenceHelpers.trackPersistenceWrite(pending, 123, "noop", warn), 123);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  assert.equal(
    packageJson.scripts["build:server-persistence-helpers"],
    "tsc --project tsconfig.server-persistence-helpers.json && node scripts/sync_server_persistence_helpers_build.js"
  );
  assert.equal(
    packageJson.scripts["check:server-persistence-helpers"],
    "npm run build:server-persistence-helpers && node scripts/check_server_persistence_helpers_build.js"
  );
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-persistence-helpers/);
  assert.deepEqual(persistenceBuildConfig.include, ["src/server_persistence_helpers.ts"]);
  assert.match(persistenceBuildSource, /Generated from src\/server_persistence_helpers\.ts/);
  assert.match(persistenceSource, /function writeJsonFileAtomic/);
  assert.match(persistenceSource, /export = \{/);
  assert.match(generatedSource, /Generated from src\/server_persistence_helpers\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.match(serverSource, /require\("\.\/server_persistence_helpers"\)/);
  assert.match(serverSource, /PersistenceHelpers\.readJsonFile/);
  assert.match(serverSource, /PersistenceHelpers\.trackPersistenceWrite/);
  assert.match(deploySource, /server_persistence_helpers\.js/);
  assert.match(deploySource, /src\/server_persistence_helpers\.ts/);
  assert.match(deploySource, /tsconfig\.server-persistence-helpers\.json/);
  assert.match(deploySource, /sync_server_persistence_helpers_build\.js/);
  assert.match(deploySource, /npm run build:server-persistence-helpers/);

  console.log("[server-persistence-helpers] success");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
