#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Phase11bLifecycleModule = require("../server_phase11b_lifecycle");
const PersistenceHelpers = require("../server_persistence_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase11b_lifecycle.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_phase11b_lifecycle.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_phase11b_lifecycle_build.js"), "utf8");
const buildConfig = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "tsconfig.server-phase11b-lifecycle.json"), "utf8"),
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-phase11b-"));

/**
 * @param {string} name
 * @param {Record<string, any>} [overrides]
 */
function createFixture(name, overrides = {}) {
  const root = path.join(tempRoot, name);
  const worldsFolder = path.join(root, "worlds");
  const playersFolder = path.join(root, "players");
  const snapshotsFolder = path.join(root, "snapshots");
  const integrityFolder = path.join(root, "integrity");
  /** @type {string[]} */
  const calls = [];
  /** @type {string[]} */
  const logLines = [];
  /** @type {Array<{event: string, details: Record<string, any>}>} */
  const crashReports = [];
  /** @type {Record<string, Array<(...args: any[]) => any>>} */
  const processListeners = {};
  /** @type {any[]} */
  const timerHandles = [];
  /** @type {string[]} */
  const clearedTimers = [];
  let nextTimerId = 1;
  let fatalCrashReportWritten = false;
  /** @type {{value: any}} */
  const accountsSaveTimerRef = { value: null };

  const timerApi = {
    setInterval(/** @type {(...args: any[]) => any} */ callback, /** @type {number} */ ms) {
      const handle = {
        id: nextTimerId++,
        kind: "interval",
        callback,
        ms,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        },
      };
      timerHandles.push(handle);
      return handle;
    },
    setTimeout(/** @type {(...args: any[]) => any} */ callback, /** @type {number} */ ms) {
      const handle = {
        id: nextTimerId++,
        kind: "timeout",
        callback,
        ms,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        },
      };
      timerHandles.push(handle);
      return handle;
    },
    clearInterval(/** @type {any} */ handle) {
      clearedTimers.push(`interval:${handle?.id || "unknown"}`);
    },
    clearTimeout(/** @type {any} */ handle) {
      clearedTimers.push(`timeout:${handle?.id || "unknown"}`);
    },
  };

  const accounts = overrides.accounts || new Map();
  const playerStates = overrides.playerStates || new Map();
  const worldStates = overrides.worldStates || new Map();
  const worldSaveTimers = overrides.worldSaveTimers || new Map();
  const playerSaveTimers = overrides.playerSaveTimers || new Map();
  const worldSnapshotSchedulerState = overrides.worldSnapshotSchedulerState || {
    enabled: false,
    last_run_at: "",
    last_duration_ms: 0,
    last_world_count: 0,
    last_error: "",
  };

  const postgresStore = {
    isReady: () => true,
    auditItemInstances: async () => ({
      ok: true,
      scanned_at: "2026-07-19T00:00:00.000Z",
      summary: { total_issues: 0 },
      issues: [],
    }),
    loadAccountStates: async () => [],
    saveAccountStates: async (/** @type {any[]} */ values) => calls.push(`postgres:save-accounts:${values.length}`),
    loadPlayerStates: async () => [],
    savePlayerStates: async (/** @type {any[]} */ values) => calls.push(`postgres:save-players:${values.length}`),
    reconcileStoredItemInstancesFromPlayerStates: async () => ({ ok: true, player_count: 0 }),
    loadWorldStates: async () => [],
    saveWorldState: async (/** @type {string} */ worldName) => calls.push(`postgres:save-world:${worldName}`),
    close: async () => calls.push("postgres:close"),
    ...(overrides.postgresStore || {}),
  };
  const redisStore = {
    close: async () => calls.push("redis:close"),
    ...(overrides.redisStore || {}),
  };

  const deps = {
    ACCOUNTS_SAVE_PATH: path.join(root, "accounts.json"),
    ADMIN_LOG_PATH: path.join(root, "logs", "admin.log"),
    ALLOW_LEGACY_WORLD_STATE_IMPORT: false,
    ANTI_DUPE_AUDIT_INTERVAL_MS: 60000,
    ANTI_DUPE_AUDIT_LIMIT: 100,
    ANTI_DUPE_AUDIT_LOG_CLEAN: true,
    CRASH_REPORT_PATH: path.join(root, "logs", "crash.log"),
    INTEGRITY_LOG_FOLDER: integrityFolder,
    LEGACY_DATA_FOLDERS: [],
    PERIODIC_SAVE_MS: 30000,
    PLAYER_SAVE_FOLDER: playersFolder,
    POSTGRES_AUTHORITATIVE: true,
    WORLD_SAVE_FOLDER: worldsFolder,
    WORLD_SNAPSHOT_FOLDER: snapshotsFolder,
    WORLD_SNAPSHOT_INTERVAL_MINUTES: 15,
    WORLD_SNAPSHOT_INTERVAL_MS: 900000,
    WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE: 2,
    WORLD_SNAPSHOT_STARTUP_RUN: true,
    WORLD_ROUTE_TTL_MS: 45000,
    accountKey: (/** @type {unknown} */ value) => String(value || "").trim().toLowerCase(),
    assertAuthoritativePostgresReady: () => calls.push("postgres:assert"),
    clampInteger: (/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) => (
      Math.max(min, Math.min(max, Math.trunc(Number(value) || 0)))
    ),
    cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim(),
    cleanText: (/** @type {unknown} */ value) => String(value || "").trim(),
    cleanWorld: (/** @type {unknown} */ value) => String(value || "START").trim().toUpperCase(),
    createWorldSnapshot: (/** @type {string} */ worldName) => {
      calls.push(`snapshot:${worldName}`);
      return { snapshotId: `snapshot-${worldName}` };
    },
    deserializeWorldState: (/** @type {string} */ worldName, /** @type {Record<string, any>} */ data) => ({
      ...data,
      world_name: worldName,
    }),
    errorToCrashDetails: (/** @type {unknown} */ error) => ({ message: String(error) }),
    exitProcess: (/** @type {number} */ code) => calls.push(`exit:${code}`),
    fileSystem: fs,
    flushWorldStateJsonBackups: (/** @type {Record<string, any>} */ options) => (
      calls.push(`json-backups:${options.sync === true}`)
    ),
    getAccountsSaveTimer: () => accountsSaveTimerRef.value,
    getCrashRuntimeState: () => ({ ok: true }),
    getFatalCrashReportWritten: () => fatalCrashReportWritten,
    getOwnedWorldNames: () => Array.from(worldStates.keys()),
    isPostgresAuthoritativeReady: () => true,
    loadAccountsFromJson: () => calls.push("accounts:load-json"),
    logger: {
      log: (/** @type {any[]} */ ...args) => logLines.push(args.map(String).join(" ")),
      warn: (/** @type {any[]} */ ...args) => logLines.push(args.map(String).join(" ")),
      error: (/** @type {any[]} */ ...args) => logLines.push(args.map(String).join(" ")),
    },
    markFatalCrashReportWritten: () => {
      fatalCrashReportWritten = true;
    },
    pathModule: path,
    pendingPersistenceWrites: new Set(),
    persistenceHelpers: PersistenceHelpers,
    processRuntime: {
      on(/** @type {string} */ event, /** @type {(...args: any[]) => any} */ callback) {
        processListeners[event] ||= [];
        processListeners[event].push(callback);
      },
    },
    safeFileName: (/** @type {unknown} */ value, /** @type {string} */ fallback) => (
      String(value || fallback).replace(/[^A-Za-z0-9_-]/g, "_")
    ),
    sanitizeAccountState: (/** @type {Record<string, any>} */ value) => ({ ...value }),
    sanitizePlayerState: (/** @type {Record<string, any>} */ value, /** @type {string} */ username) => ({
      ...value,
      account_username: String(value.account_username || username),
    }),
    saveAccounts: () => calls.push("accounts:save"),
    savePlayerState: (/** @type {string} */ username) => calls.push(`player:save:${username}`),
    saveWorldState: (/** @type {string} */ worldName) => calls.push(`world:save:${worldName}`),
    serializeWorldState: (/** @type {string} */ worldName) => worldStates.get(worldName) || { world_name: worldName },
    setAccountsSaveTimer: (/** @type {any} */ timer) => {
      accountsSaveTimerRef.value = timer;
    },
    stopGameplaySchedulers: () => calls.push("gameplay-schedulers:stop"),
    waitForPersistenceWrites: async () => {
      calls.push("persistence:wait");
      return { ok: true, total: 0, failed: 0 };
    },
    waitForWorldPersistence: async () => {
      calls.push("world-persistence:wait");
    },
    refreshOwnedWorldRoutes: async () => {
      calls.push("routes:refresh");
    },
    writeCrashReport: (/** @type {string} */ event, /** @type {Record<string, any>} */ details) => {
      crashReports.push({ event, details });
    },
    ...overrides,
    accounts,
    playerSaveTimers,
    playerStates,
    postgresStore,
    redisStore,
    timerApi,
    worldSaveTimers,
    worldSnapshotSchedulerState,
    worldStates,
  };

  return {
    accountsSaveTimerRef,
    calls,
    clearedTimers,
    crashReports,
    deps,
    lifecycle: Phase11bLifecycleModule.createServerPhase11bLifecycle(deps),
    logLines,
    playersFolder,
    processListeners,
    root,
    timerHandles,
    worldsFolder,
  };
}

(async () => {
  try {
    const legacyRoot = path.join(tempRoot, "legacy-data");
    fs.mkdirSync(path.join(legacyRoot, "players"), { recursive: true });
    fs.mkdirSync(path.join(legacyRoot, "worlds"), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, "accounts.json"), JSON.stringify({ accounts: [] }));
    fs.writeFileSync(path.join(legacyRoot, "players", "legacy.json"), JSON.stringify({
      account_username: "legacy",
      inventory: { dirt: 2 },
    }));
    fs.writeFileSync(path.join(legacyRoot, "worlds", "LEGACY.json"), JSON.stringify({
      world_name: "LEGACY",
      foreground: [],
    }));

    const migrationFixture = createFixture("migration", {
      LEGACY_DATA_FOLDERS: [legacyRoot],
    });
    migrationFixture.lifecycle.ensureDataFolders();
    assert.equal(fs.existsSync(migrationFixture.deps.ACCOUNTS_SAVE_PATH), true);
    assert.equal(fs.existsSync(path.join(migrationFixture.playersFolder, "legacy.json")), true);
    assert.equal(fs.existsSync(path.join(migrationFixture.worldsFolder, "LEGACY.json")), true);
    assert.equal(migrationFixture.lifecycle.getWorldSavePath("my world").endsWith("MY_WORLD.json"), true);
    assert.equal(migrationFixture.lifecycle.getPlayerSavePath("Test User").endsWith("test_user.json"), true);
    assert.equal(migrationFixture.lifecycle.readPlayerStatesFromJsonFolder().length, 1);
    assert.equal(migrationFixture.lifecycle.readWorldStatesFromJsonFolder().length, 1);

    const authorityAccounts = new Map();
    const authorityPlayers = new Map();
    const authorityWorlds = new Map();
    /** @type {string[]} */
    const authorityCalls = [];
    const authorityFixture = createFixture("authority", {
      accounts: authorityAccounts,
      playerStates: authorityPlayers,
      worldStates: authorityWorlds,
      loadAccountsFromJson: () => {
        authorityAccounts.set("legacy-account", { username: "legacy-account" });
      },
      postgresStore: {
        isReady: () => true,
        auditItemInstances: async () => ({
          ok: true,
          scanned_at: "2026-07-19T00:00:00.000Z",
          summary: { total_issues: 0 },
          issues: [],
        }),
        loadAccountStates: async () => [{ username: "db-account" }],
        saveAccountStates: async (/** @type {any[]} */ values) => authorityCalls.push(`accounts:${values.length}`),
        loadPlayerStates: async () => [{ username: "db-player", state: { account_username: "db-player" } }],
        savePlayerStates: async (/** @type {any[]} */ values) => authorityCalls.push(`players:${values.length}`),
        reconcileStoredItemInstancesFromPlayerStates: async () => ({ ok: true, player_count: 2 }),
        loadWorldStates: async () => [{ world_name: "DBWORLD", state: { world_name: "DBWORLD" } }],
        saveWorldState: async (/** @type {string} */ worldName) => authorityCalls.push(`world:${worldName}`),
        close: async () => authorityCalls.push("close"),
      },
    });
    fs.mkdirSync(authorityFixture.playersFolder, { recursive: true });
    fs.mkdirSync(authorityFixture.worldsFolder, { recursive: true });
    fs.writeFileSync(path.join(authorityFixture.playersFolder, "legacy-player.json"), JSON.stringify({
      account_username: "legacy-player",
    }));
    fs.writeFileSync(path.join(authorityFixture.worldsFolder, "LEGACYWORLD.json"), JSON.stringify({
      world_name: "LEGACYWORLD",
    }));
    await authorityFixture.lifecycle.loadPersistentState();
    assert.equal(authorityAccounts.has("db-account"), true);
    assert.equal(authorityAccounts.has("legacy-account"), true);
    assert.equal(authorityPlayers.has("db-player"), true);
    assert.equal(authorityPlayers.has("legacy-player"), true);
    assert.equal(authorityWorlds.has("DBWORLD"), false);
    assert.equal(authorityWorlds.has("LEGACYWORLD"), false);
    assert.deepEqual(authorityCalls.slice(0, 2), ["accounts:1", "players:1"]);
    assert.equal(authorityFixture.logLines.some((line) => (
      line.includes("indexed 1 world state(s)") && line.includes("load on demand")
    )), true);
    assert.equal(authorityFixture.logLines.some((line) => line.includes("skipped 1 legacy JSON world import")), true);

    const fallbackFixture = createFixture("fallback", {
      isPostgresAuthoritativeReady: () => false,
    });
    await fallbackFixture.lifecycle.loadPersistentState();
    assert.deepEqual(fallbackFixture.calls.slice(0, 2), ["accounts:load-json", "postgres:assert"]);

    const schedulerFixture = createFixture("schedulers", {
      worldStates: new Map([
        ["ALPHA", {}],
        ["BRAVO", {}],
        ["CHARLIE", {}],
        ["DELTA", {}],
      ]),
    });
    assert.deepEqual(
      schedulerFixture.lifecycle.selectWorldsForSnapshotCycle(["ALPHA", "BRAVO", "CHARLIE", "DELTA"]),
      ["ALPHA", "BRAVO"],
    );
    assert.deepEqual(
      schedulerFixture.lifecycle.selectWorldsForSnapshotCycle(["ALPHA", "BRAVO", "CHARLIE", "DELTA"]),
      ["CHARLIE", "DELTA"],
    );
    await schedulerFixture.lifecycle.runAntiDupeAuditNow();
    await schedulerFixture.lifecycle.runWorldSnapshotCycleNow();
    assert.equal(schedulerFixture.calls.filter((call) => call.startsWith("snapshot:")).length, 2);
    assert.equal(schedulerFixture.deps.worldSnapshotSchedulerState.last_world_count, 2);

    const ownedSnapshotFixture = createFixture("owned-snapshots", {
      worldStates: new Map([
        ["ALPHA", {}],
        ["BRAVO", {}],
      ]),
      getOwnedWorldNames: () => ["BRAVO"],
    });
    await ownedSnapshotFixture.lifecycle.runWorldSnapshotCycleNow();
    assert.deepEqual(
      ownedSnapshotFixture.calls.filter((call) => call.startsWith("snapshot:")),
      ["snapshot:BRAVO"],
    );

    schedulerFixture.lifecycle.startAntiDupeAuditScanner();
    schedulerFixture.lifecycle.startPeriodicWorldSnapshotScheduler();
    schedulerFixture.lifecycle.startPeriodicSaveScheduler();
    assert.equal(schedulerFixture.lifecycle.getLifecycleState().anti_dupe_audit_scheduled, true);
    assert.equal(schedulerFixture.lifecycle.getLifecycleState().world_snapshot_scheduled, true);
    assert.equal(schedulerFixture.lifecycle.getLifecycleState().periodic_save_scheduled, true);
    assert.equal(schedulerFixture.timerHandles.every((handle) => handle.unrefCalled), true);
    const routeHeartbeat = schedulerFixture.timerHandles.find((handle) => (
      handle.kind === "interval" && handle.ms === 15000
    ));
    assert.ok(routeHeartbeat, "world ownership leases must refresh before their TTL expires");
    await routeHeartbeat.callback();
    assert.equal(schedulerFixture.calls.includes("routes:refresh"), true);

    const flushFixture = createFixture("flush", {
      playerSaveTimers: new Map([["alice", { id: 11 }]]),
      playerStates: new Map([["alice", { account_username: "Alice" }]]),
      worldSaveTimers: new Map([["START", { id: 10 }]]),
    });
    flushFixture.accountsSaveTimerRef.value = { id: 12 };
    flushFixture.lifecycle.flushPendingSaves({ syncLocalJson: true });
    assert.equal(flushFixture.calls.includes("world:save:START"), true);
    assert.equal(flushFixture.calls.includes("player:save:Alice"), true);
    assert.equal(flushFixture.calls.includes("accounts:save"), true);
    assert.equal(flushFixture.calls.includes("json-backups:true"), true);
    assert.equal(flushFixture.deps.worldSaveTimers.size, 0);
    assert.equal(flushFixture.deps.playerSaveTimers.size, 0);

    schedulerFixture.lifecycle.installShutdownHandlers();
    schedulerFixture.lifecycle.installShutdownHandlers();
    assert.equal(schedulerFixture.processListeners.SIGINT.length, 1);
    assert.equal(schedulerFixture.processListeners.SIGTERM.length, 1);
    assert.equal(schedulerFixture.processListeners.exit.length, 1);
    await schedulerFixture.lifecycle.shutdown("SIGTERM");
    assert.equal(schedulerFixture.calls.includes("gameplay-schedulers:stop"), true);
    assert.equal(schedulerFixture.calls.includes("world-persistence:wait"), true);
    assert.equal(schedulerFixture.calls.includes("persistence:wait"), true);
    assert.equal(schedulerFixture.calls.includes("postgres:close"), true);
    assert.equal(schedulerFixture.calls.includes("redis:close"), true);
    assert.equal(schedulerFixture.calls.includes("exit:0"), true);
    assert.equal(schedulerFixture.lifecycle.getLifecycleState().shutdown_started, true);
    assert.equal(schedulerFixture.lifecycle.getLifecycleState().periodic_save_scheduled, false);
    assert.ok(schedulerFixture.clearedTimers.length >= 3);

    const failedShutdownFixture = createFixture("failed-shutdown", {
      waitForPersistenceWrites: async () => ({ ok: false, total: 1, failed: 1 }),
    });
    await failedShutdownFixture.lifecycle.shutdown("SIGTERM");
    assert.equal(failedShutdownFixture.calls.includes("exit:1"), true);
    assert.equal(
      failedShutdownFixture.logLines.some((line) => line.includes("shutdown detected failed writes")),
      true,
    );

    const exitFixture = createFixture("exit-handler");
    exitFixture.lifecycle.installShutdownHandlers();
    exitFixture.processListeners.exit[0](1);
    assert.equal(exitFixture.crashReports[0].event, "process_exit");
    assert.equal(exitFixture.calls.includes("json-backups:true"), true);

    const requiredBridges = [
      "ensureDataFolders",
      "flushPendingSaves",
      "getPlayerSavePath",
      "getWorldSavePath",
      "getWorldSnapshotSchedulerRunning",
      "handleShutdownSignal",
      "listJsonFiles",
      "loadPersistentState",
      "loadPlayerStatesFromJsonFolder",
      "loadWorldStatesFromJsonFolder",
      "migrateLegacyDataFolders",
      "readPlayerStatesFromJsonFolder",
      "readWorldStatesFromJsonFolder",
      "selectWorldsForSnapshotCycle",
      "shutdown",
      "startAntiDupeAuditScanner",
      "startPeriodicSaveScheduler",
      "startPeriodicWorldSnapshotScheduler",
    ];
    for (const name of requiredBridges) {
      assert.ok(
        serverSource.includes(`ServerPhase11bLifecycle.${name}(`),
        `server.js must delegate ${name} to the Phase 11B TypeScript lifecycle`,
      );
      assert.ok(
        helperSource.includes(`function ${name}(`) || helperSource.includes(`async function ${name}(`),
        `TypeScript source must own ${name}`,
      );
    }

    assert.ok(serverSource.includes('require("./server_phase11b_lifecycle")'));
    assert.ok(serverSource.includes("createServerPhase11bLifecycle({"));
    assert.ok(serverSource.includes("ServerPhase11bLifecycle.installShutdownHandlers();"));
    assert.ok(serverSource.includes("clearInterval(batteryChargerTimer)"));
    assert.ok(!serverSource.includes("postgresStore.auditItemInstances({ limit: ANTI_DUPE_AUDIT_LIMIT })"));
    assert.ok(!serverSource.includes("periodic world checkpoint completed with failures"));
    assert.ok(!serverSource.includes("PostgreSQL returned no world states; skipped"));
    assert.ok(!serverSource.includes('process.on("SIGINT"'));
    assert.ok(helperSource.includes("postgresStore.auditItemInstances({ limit: ANTI_DUPE_AUDIT_LIMIT })"));
    assert.ok(helperSource.includes("periodic world checkpoint completed with failures"));
    assert.ok(helperSource.includes("PostgreSQL returned no world states; skipped"));
    assert.ok(helperSource.includes('processRuntime.on("SIGINT"'));

    assert.ok(generatedSource.startsWith("// Generated from src/server_phase11b_lifecycle.ts."));
    assert.ok(syncSource.includes(".tsbuild\", \"server_phase11b_lifecycle.js"));
    assert.deepEqual(buildConfig.include, ["src/server_phase11b_lifecycle.ts"]);
    assert.ok(packageJson.scripts["build:server-phase11b-lifecycle"]);
    assert.ok(packageJson.scripts["check:server-phase11b-lifecycle"]);
    assert.ok(packageJson.scripts["check:typescript"].includes("check:server-phase11b-lifecycle"));
    for (const marker of [
      "$localServerPhase11bLifecycle",
      "$localServerPhase11bLifecycleSource",
      "$localServerPhase11bLifecycleBuildConfig",
      "$localServerPhase11bLifecycleCheck",
      "$localServerPhase11bLifecycleBuildSync",
      "npm run check:server-phase11b-lifecycle",
    ]) {
      assert.ok(deploySource.includes(marker), `deploy script must include ${marker}`);
    }

    console.log("[server-phase11b-lifecycle] persistence, scheduler, shutdown, ownership, and deploy checks passed");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
