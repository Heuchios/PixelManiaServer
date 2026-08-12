#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Phase11aRuntimeModule = require("../server_phase11a_runtime");
const ServerRuntimeStats = require("../server_runtime_stats");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase11a_runtime.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_phase11a_runtime.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_phase11a_runtime_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-phase11a-runtime.json"), "utf8"));

assert.equal(Phase11aRuntimeModule.isBrokenStdIoError({ code: "EPIPE" }), true);
assert.equal(Phase11aRuntimeModule.isBrokenStdIoError({ code: "ERR_STREAM_DESTROYED" }), true);
assert.equal(Phase11aRuntimeModule.isBrokenStdIoError(new Error("ordinary failure")), false);

/** @type {Record<string, (error: unknown) => void>} */
const streamListeners = {};
/** @type {unknown[]} */
const warnings = [];
const fakeRuntimeProcess = {
  stdout: {
    on: (/** @type {string} */ event, /** @type {(error: unknown) => void} */ callback) => {
      streamListeners[`stdout:${event}`] = callback;
    },
  },
  stderr: {
    on: (/** @type {string} */ event, /** @type {(error: unknown) => void} */ callback) => {
      streamListeners[`stderr:${event}`] = callback;
    },
  },
  emitWarning: (/** @type {unknown} */ warning) => warnings.push(warning),
};
const fakeConsole = {
  log: () => {
    const error = new Error("broken pipe");
    // @ts-ignore test-only error code
    error.code = "EPIPE";
    throw error;
  },
};
Phase11aRuntimeModule.installConsoleWriteGuard(
  /** @type {any} */ (fakeRuntimeProcess),
  /** @type {any} */ (fakeConsole),
);
assert.doesNotThrow(() => fakeConsole.log());
streamListeners["stdout:error"]({ code: "EPIPE" });
streamListeners["stderr:error"](new Error("visible warning"));
assert.equal(warnings.length, 1);

/** @type {string[]} */
const calls = [];
/** @type {string[]} */
const logLines = [];
/** @type {string[]} */
const crashWrites = [];
const playerNetworkStats = {
  started_at: "2026-07-19T00:00:00.000Z",
  inbound_messages_received: 2,
  inbound_bytes_received: 64,
  inbound_messages_oversize_rejected: 0,
  inbound_message_queue_pending: 3,
  inbound_message_queue_pending_max: 8,
  inbound_message_queue_max_socket_depth: 5,
  inbound_message_queue_wait_samples: 4,
  inbound_message_queue_wait_total_ms: 50,
  inbound_message_queue_wait_max_ms: 25,
  coalesced_inbound_player_position_messages: 7,
  player_position_queue_wait_samples: 2,
  player_position_queue_wait_total_ms: 30,
  player_position_queue_wait_max_ms: 20,
  player_position_queue_wait_over_250ms: 1,
  player_position_queue_last_delay: {
    at: "2026-07-19T00:00:02.000Z",
    player_id: "player-1",
    queue_wait_ms: 275,
    queue_depth_at_enqueue: 4,
    socket_queue_depth_at_start: 3,
  },
  inbound_packet_type_stats: {},
  outbound_packet_type_stats: {},
  rate_limit_checks_by_bucket: { "message:player_position": 12, empty: 0 },
  rate_limit_rejections_by_bucket: { "message:player_position": 2 },
  rate_limit_checks_by_subject_kind: { account: 12 },
  rate_limit_rejections_by_subject_kind: { account: 2 },
  rate_limit_store_fallback_allows: 1,
  rate_limit_last_rejection: {
    at: "2026-07-19T00:00:01.000Z",
    scope: "message",
    bucket: "player_position",
    subject_kind: "socket",
    store: "socket_token_bucket",
    count: 301,
    limit: 150,
    window_ms: 1000,
    capacity: 300,
    available_tokens: 0.25,
    reset_in_ms: 5,
  },
};
const serverTickStats = ServerRuntimeStats.createServerTickStats(1000);
const worldNetworkStats = {
  started_at: "2026-07-19T00:00:00.000Z",
  queued_world_updates: 3,
  batch_world_packets_sent: 1,
  batch_world_items_sent: 2,
};
const httpServer = {
  listen: (/** @type {number} */ port, /** @type {string} */ host, /** @type {() => void} */ callback) => {
    calls.push(`listen:${host}:${port}`);
    callback();
  },
};
const redisStore = {
  init: async () => calls.push("redis:init"),
  isReady: () => true,
  getHealthSnapshot: async () => ({ enabled: true, ready: true }),
};
const postgresStore = {
  init: async () => calls.push("postgres:init"),
  isReady: () => true,
};
const deps = new Proxy({
  ALLOW_LEGACY_WORLD_STATE_IMPORT: false,
  CUSTOM_TRUSTED_PLAYER_STATE_ENABLED: false,
  DEV_BACKEND_LOGIN_ALLOWED: false,
  DROP_INTEREST_LEAVE_RADIUS_PIXELS: 3072,
  DROP_INTEREST_RADIUS_PIXELS: 2560,
  DROP_INTEREST_SYNC_INTERVAL_MS: 250,
  dropInterestByReceiver: new Map([["p1", new Set(["d1"])]]),
  HOST: "127.0.0.1",
  IDEMPOTENCY_TTL_MS: 10000,
  IDEMPOTENCY_TTL_MS_COMBAT: 600,
  IDEMPOTENCY_TTL_MS_CRITICAL: 2500,
  IDEMPOTENCY_TTL_MS_WORLD_ACTION: 1200,
  MAX_MOVE_ACCEL_PIXELS_PER_SECOND2: 36000,
  MAX_MOVE_PIXELS_PER_SECOND: 900,
  MAX_PACKET_BYTES: 65536,
  MAX_PLAYERS_PER_WORLD: 50,
  MAX_TRUSTED_POSITION_AGE_MS: 1000,
  MAX_TRUSTED_POSITION_AGE_MS_COMBAT: 180,
  MAX_TRUSTED_POSITION_AGE_MS_WORLD_ACTION: 250,
  MIN_CLIENT_VERSION: "1.0.1",
  MIN_PASSWORD_LENGTH: 8,
  MOVEMENT_COLLISION_GUARD_ENABLED: true,
  MOVEMENT_CORRECTION_SNAP_DISTANCE: 160,
  MOVEMENT_DISTANCE_GRACE_PIXELS: 24,
  MOVEMENT_MAX_ELAPSED_SECONDS: 0.25,
  NETFOX_ARCHIVE_TOOLS_ALLOWED: false,
  NETFOX_MOVEMENT_ALLOW_STATIC_FALLBACK: false,
  NETFOX_MOVEMENT_ENABLED: false,
  NETFOX_MOVEMENT_MAX_CLIENTS: 50,
  NETFOX_MOVEMENT_PUBLIC_HOST: "127.0.0.1",
  NETFOX_MOVEMENT_PUBLIC_PORT: 24566,
  NETFOX_MOVEMENT_ROUTE_TTL_MS: 45000,
  NETFOX_SPAWN_TICKET_TTL_MS: 30000,
  NETFOX_TRUSTED_PLAYER_STATE_ENABLED: true,
  PACKET_SIZE_TELEMETRY_ENABLED: true,
  PACKET_TYPE_SIZE_SAMPLE_LIMIT: 128,
  PLAYER_ACTION_INTEREST_MANAGEMENT_ENABLED: true,
  PLAYER_INTEREST_LEAVE_RADIUS_PIXELS: 3072,
  PLAYER_INTEREST_RADIUS_PIXELS: 2560,
  PLAYER_POSITION_BATCHING_ENABLED: true,
  PLAYER_POSITION_BATCH_MAX_ITEMS: 64,
  PLAYER_POSITION_BATCH_MIN_CLIENT_VERSION: "1.0.3",
  PLAYER_POSITION_BROADCAST_INTERVAL_MS: 16,
  PLAYER_POSITION_DELIVERY_RETRY_MS: 25,
  PLAYER_POSITION_IDLE_HEARTBEAT_MS: 1000,
  PLAYER_POSITION_MAX_BUFFERED_AMOUNT: 262144,
  PLAYER_POSITION_RESUME_BUFFERED_AMOUNT: 65536,
  PORT: 8080,
  POSTGRES_AUTHORITATIVE: true,
  POSTGRES_ENABLED: true,
  POSTGRES_SCHEMA: "pixelmania",
  PUBLIC_BASE_URL: "https://api.pixelmaniagame.com",
  PUBLIC_WS_URL: "wss://api.pixelmaniagame.com/ws",
  REDIS_ENABLED: true,
  REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT: true,
  REQUIRE_POSTGRES_AUTHORITATIVE_FOR_GAMEPLAY: true,
  SAVE_DEBOUNCE_MS: 250,
  SERVER_CLIENT_VERSION: "1.0.1",
  SERVER_INSTANCE_ID: "test-instance",
  SERVER_INSTANCE_WS_URL: "wss://api.pixelmaniagame.com/ws",
  SERVER_TICK_MONITOR_INTERVAL_MS: 1000,
  SMTP_HOST: "smtp.example.test",
  TRUSTED_MOVEMENT_ALLOWLIST: new Set(),
  TRUSTED_MOVEMENT_ALLOWLIST_ENABLED: false,
  TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD: true,
  WORLD_ADMISSION_TTL_MS: 45000,
  WORLD_JSON_BACKUP_DEBOUNCE_MS: 1000,
  WORLD_JSON_BACKUP_WHEN_PG_READY: false,
  WORLD_NON_CRITICAL_WORLD_SAVE_DEBOUNCE_MS: 1200,
  WORLD_ROUTE_ENFORCEMENT_ENABLED: true,
  WORLD_ROUTE_TTL_MS: 45000,
  WORLD_SNAPSHOT_INTERVAL_MINUTES: 15,
  WORLD_SNAPSHOT_INTERVAL_MS: 900000,
  WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE: 5,
  WORLD_SNAPSHOT_POSTGRES_INLINE: false,
  WORLD_SNAPSHOT_SPACES_ENDPOINT: "",
  WORLD_SNAPSHOT_SPACES_TARGET: "",
  WORLD_SNAPSHOT_STARTUP_RUN: false,
  WORLD_SNAPSHOT_STORAGE: "local",
  WORLD_UPDATE_BATCHING_ENABLED: true,
  WORLD_UPDATE_BATCH_INTERVAL_MS: 16,
  WORLD_UPDATE_BATCH_MAX_ITEMS: 64,
  WORLD_UPDATE_BATCH_MIN_CLIENT_VERSION: "1.0.3",
  applyPasswordResetToken: async () => ({ ok: true, message: "changed" }),
  assertAuthoritativePostgresReady: () => calls.push("postgres:assert"),
  buildNetfoxWorldStateHttpPayload: () => ({ world: "START" }),
  cleanWorld: (/** @type {unknown} */ value) => String(value || "START").toUpperCase(),
  confirmEmailChangeToken: async () => ({ ok: true, message: "changed" }),
  cryptoRandomUUID: () => "report-id",
  CRASH_REPORT_PATH: "/tmp/crash_reports.log",
  errorToCrashDetails: (/** @type {unknown} */ error) => ({ message: String(error), stack: String(error) }),
  escapeHtml: (/** @type {unknown} */ value) => String(value),
  exitProcess: (/** @type {number} */ code) => calls.push(`exit:${code}`),
  fileSystem: {
    mkdirSync: () => undefined,
    appendFileSync: (/** @type {unknown} */ _file, /** @type {string} */ value) => crashWrites.push(value),
  },
  getNetfoxMovementRouteForWorld: async () => null,
  getNetfoxMovementRouteStats: () => ({ registered_worlds: 0 }),
  getWorldIndexStatsSnapshot: () => ({ active_world_count: 1 }),
  getWorldRouteStatsSnapshot: () => ({ checks: 1 }),
  getWorldSnapshotSchedulerRunning: () => false,
  httpServer,
  isCustomMovementServerWorldStateEndpointConfigured: () => false,
  isDropInterestManagementEnabled: () => true,
  isNetfoxServerWorldStateEndpointConfigured: () => false,
  isNetfoxSpawnTicketConfigured: () => false,
  isPlayerInterestManagementEnabled: () => true,
  loadPersistentState: async () => calls.push("state:load"),
  logger: {
    log: (/** @type {unknown[]} */ ...args) => logLines.push(args.map(String).join(" ")),
    warn: (/** @type {unknown[]} */ ...args) => logLines.push(args.map(String).join(" ")),
    error: (/** @type {unknown[]} */ ...args) => logLines.push(args.map(String).join(" ")),
  },
  markFatalCrashReportWritten: () => calls.push("crash:marked"),
  pathModule: path,
  pendingPersistenceWrites: new Set(["save"]),
  pendingPlayerPositionBroadcasts: new Map([["START", new Map([["p1", {}]])]]),
  pendingWorldJsonBackups: new Set(["START"]),
  pendingWorldUpdateBroadcasts: new Map([["START", [{}, {}]]]),
  playerInterestByReceiver: new Map([["p1", new Set(["p2"])]]),
  playerNetworkStats,
  playerStates: new Map([["p1", {}]]),
  players: new Map([["p1", {}]]),
  postgresStore,
  processRuntime: {
    pid: 1,
    ppid: 0,
    version: "v-test",
    platform: "test",
    arch: "x64",
    cwd: () => "/tmp",
    uptime: () => 10,
    memoryUsage: () => ({
      rss: 268_435_456,
      heapUsed: 134_217_728,
      heapTotal: 157_286_400,
      external: 5_242_880,
      arrayBuffers: 1_048_576,
    }),
    hrtime: { bigint: () => process.hrtime.bigint() },
  },
  recoverWorldEventsAfterLoad: async () => calls.push("events:recover"),
  redisStore,
  refreshWorldDropsFromPostgres: async () => undefined,
  registerNetfoxMovementRoute: async () => null,
  serverRuntimeStats: ServerRuntimeStats,
  serverTickStats,
  startAntiDupeAuditScanner: () => calls.push("anti-dupe:start"),
  startCalendarEventScheduler: () => calls.push("calendar-events:start"),
  startPeriodicWorldSnapshotScheduler: () => calls.push("snapshot:start"),
  startWorldEventRandomScheduler: () => calls.push("world-events:start"),
  verifyCustomMovementServerWorldStateRequest: () => false,
  verifyEmailToken: async () => ({ ok: true, message: "verified" }),
  verifyNetfoxServerWorldStateRequest: () => false,
  verifyNetfoxSpawnTicketPayload: () => ({ ok: false }),
  worldJsonBackupTimers: new Map([["START", {}]]),
  worldNetworkStats,
  worldSaveTimers: new Map([["START", {}]]),
  worldSnapshotSchedulerState: {
    enabled: true,
    last_run_at: "",
    last_duration_ms: 0,
    last_world_count: 0,
    last_error: "",
  },
  worldSnapshotStorageIsSpaces: () => false,
  worldStates: new Map([["START", {}]]),
  wss: { clients: new Set([{}]) },
}, {
  get(target, property, receiver) {
    if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
    return 0;
  },
});

const runtime = Phase11aRuntimeModule.createServerPhase11aRuntime(deps);
assert.equal(runtime.getCrashRuntimeState().connected_sockets, 1);
assert.equal(runtime.getPendingPlayerPositionUpdateCount(), 1);
assert.equal(runtime.getPendingWorldUpdateCount(), 2);
assert.equal(runtime.getActivePlayerInterestLinkCount(), 1);
assert.equal(runtime.getActiveDropInterestLinkCount(), 1);
assert.equal(runtime.getWorldNetworkStatsSnapshot().active_drop_interest_receivers, 1);

runtime.recordPacketTypeSize("inbound", "PLAYER_POSITION", 64);
const networkSnapshot = /** @type {Record<string, any>} */ (runtime.getPlayerNetworkStatsSnapshot());
assert.equal(networkSnapshot.inbound_messages_received, 2);
assert.equal(networkSnapshot.inbound_packet_type_stats.player_position.count, 1);
assert.equal(networkSnapshot.inbound_message_queue_pending, 3);
assert.equal(networkSnapshot.inbound_message_queue_pending_max, 8);
assert.equal(networkSnapshot.inbound_message_queue_max_socket_depth, 5);
assert.equal(networkSnapshot.inbound_message_queue_wait_avg_ms, 12.5);
assert.equal(networkSnapshot.inbound_message_queue_wait_max_ms, 25);
assert.equal(networkSnapshot.coalesced_inbound_player_position_messages, 7);
assert.equal(networkSnapshot.player_position_queue_wait_avg_ms, 15);
assert.equal(networkSnapshot.player_position_queue_wait_max_ms, 20);
assert.equal(networkSnapshot.player_position_queue_wait_over_250ms, 1);
assert.equal(networkSnapshot.player_position_queue_last_delay.queue_wait_ms, 275);
assert.equal(networkSnapshot.rate_limit_checks_by_bucket["message:player_position"], 12);
assert.equal(networkSnapshot.rate_limit_rejections_by_bucket["message:player_position"], 2);
assert.equal(networkSnapshot.rate_limit_checks_by_subject_kind.account, 12);
assert.equal(networkSnapshot.rate_limit_rejections_by_subject_kind.account, 2);
assert.equal(networkSnapshot.rate_limit_store_fallback_allows, 1);
assert.equal(networkSnapshot.rate_limit_last_rejection.store, "socket_token_bucket");
assert.equal(networkSnapshot.rate_limit_last_rejection.capacity, 300);
assert.equal(networkSnapshot.config.position_max_buffered_amount, 262144);
assert.equal(networkSnapshot.config.position_resume_buffered_amount, 65536);
assert.equal(networkSnapshot.config.position_delivery_retry_ms, 25);
assert.equal(Object.hasOwn(networkSnapshot.rate_limit_checks_by_bucket, "empty"), false);

runtime.writeCrashReport("phase11a_test", { detail: "ok" });
assert.equal(crashWrites.length, 1);
assert.equal(JSON.parse(crashWrites[0]).event, "phase11a_test");

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(/** @type {number} */ statusCode, /** @type {Record<string, string>} */ headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(/** @type {unknown} */ body) {
      this.body = String(body || "");
    },
  };
}

(async () => {
  const healthResponse = createResponse();
  await runtime.handleHttpRequest({
    method: "GET",
    url: "/health",
    headers: { host: "localhost" },
  }, healthResponse);
  assert.equal(healthResponse.statusCode, 200);
  const healthPayload = JSON.parse(healthResponse.body);
  assert.equal(healthPayload.ok, true);
  assert.equal(healthPayload.persistence.postgres_ready, true);
  assert.equal(healthPayload.persistence.redis_ready, true);
  assert.equal(Object.hasOwn(healthPayload, "max_client_version"), false);

  // PM2 restarts a route instance at max_memory_restart (512M in production), dropping every
  // player on it. Without memory in /health, sustained load cannot be checked against that
  // ceiling remotely, which is why the July 2026 250-player stage left it unmeasured.
  const processRuntimeSnapshot = healthPayload.persistence.process_runtime;
  assert.ok(processRuntimeSnapshot, "/health must report process runtime memory");
  assert.equal(processRuntimeSnapshot.pid, 1);
  assert.equal(processRuntimeSnapshot.node_version, "v-test");
  assert.equal(processRuntimeSnapshot.uptime_seconds, 10);
  assert.equal(processRuntimeSnapshot.rss_mb, 256);
  assert.equal(processRuntimeSnapshot.heap_used_mb, 128);
  assert.equal(processRuntimeSnapshot.heap_total_mb, 150);
  assert.equal(processRuntimeSnapshot.external_mb, 5);
  assert.equal(processRuntimeSnapshot.array_buffers_mb, 1);
  assert.equal(typeof runtime.getProcessRuntimeSnapshot, "function");
  assert.equal(runtime.getProcessRuntimeSnapshot().rss_mb, 256);
  // A process that refuses memoryUsage() must degrade to a reported error, never a 500 on the
  // endpoint the deploy activation gate polls.
  const guardedRuntime = Phase11aRuntimeModule.createServerPhase11aRuntime(new Proxy({
    processRuntime: {
      memoryUsage: () => {
        throw new Error("memory_usage_denied");
      },
      hrtime: { bigint: () => process.hrtime.bigint() },
    },
  }, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      return 0;
    },
  }));
  assert.equal(guardedRuntime.getProcessRuntimeSnapshot().snapshot_error, "memory_usage_denied");

  const missingResponse = createResponse();
  await runtime.handleHttpRequest({
    method: "GET",
    url: "/missing",
    headers: { host: "localhost" },
  }, missingResponse);
  assert.equal(missingResponse.statusCode, 404);

  await runtime.bootstrapServer();
  assert.deepEqual(calls.slice(0, 9), [
    "redis:init",
    "postgres:init",
    "postgres:assert",
    "state:load",
    "events:recover",
    "world-events:start",
    "calendar-events:start",
    "anti-dupe:start",
    "snapshot:start",
  ]);
  assert.ok(calls.includes("listen:127.0.0.1:8080"));
  assert.ok(logLines.some((line) => line.includes("PixelMania server listening privately")));

  const requiredBridges = [
    "getCrashRuntimeState",
    "getServerTickSnapshot",
    "getPendingPlayerPositionUpdateCount",
    "getPendingWorldUpdateCount",
    "getActivePlayerInterestLinkCount",
    "getActiveDropInterestLinkCount",
    "getWorldNetworkStatsSnapshot",
    "isPacketTypeTelemetryEnabled",
    "normalizePacketTypeName",
    "recordPacketTypeSize",
    "getPlayerNetworkStatsSnapshot",
    "startServerTickMonitor",
    "writeCrashReport",
    "handleFatalProcessError",
    "sendHtml",
    "sendPasswordResetForm",
    "sendHttpJson",
    "readFormHttpRequestBody",
    "readJsonHttpRequestBody",
    "handleNetfoxVerifySpawnTicketHttpRequest",
    "handleNetfoxRegisterRouteHttpRequest",
    "handleNetfoxGetRouteHttpRequest",
    "handleHttpRequest",
    "bootstrapServer",
    "startHttpServer",
  ];
  for (const name of requiredBridges) {
    assert.ok(
      serverSource.includes(`ServerPhase11aRuntime.${name}(`),
      `server.js must delegate ${name} to the Phase 11A TypeScript runtime`,
    );
    assert.ok(
      helperSource.includes(`function ${name}(`) || helperSource.includes(`async function ${name}(`),
      `TypeScript source must own ${name}`,
    );
  }

  assert.ok(serverSource.includes('require("./server_phase11a_runtime")'));
  assert.ok(serverSource.includes("createServerPhase11aRuntime({"));
  assert.ok(serverSource.includes("function startAntiDupeAuditScanner()"));
  assert.ok(serverSource.includes("function startCalendarEventScheduler()"));
  assert.ok(serverSource.includes("function startPeriodicWorldSnapshotScheduler()"));
  assert.ok(!serverSource.includes("[netfox_server_world_state] served"));
  assert.ok(!serverSource.includes("player_network: getPlayerNetworkStatsSnapshot()"));
  assert.ok(!serverSource.includes("fs.appendFileSync(CRASH_REPORT_PATH"));
  assert.ok(!serverSource.includes("serverTickMonitorTimer = setInterval"));
  assert.ok(helperSource.includes("[netfox_server_world_state] served"));
  assert.ok(helperSource.includes("player_network: getPlayerNetworkStatsSnapshot()"));
  assert.ok(helperSource.includes("process_runtime: getProcessRuntimeSnapshot()"));
  assert.ok(helperSource.includes("fileSystem.appendFileSync(CRASH_REPORT_PATH"));
  assert.ok(helperSource.includes("serverTickMonitorTimer = setInterval"));

  assert.ok(generatedSource.startsWith("// Generated from src/server_phase11a_runtime.ts."));
  assert.ok(syncSource.includes(".tsbuild\", \"server_phase11a_runtime.js"));
  assert.deepEqual(buildConfig.include, ["src/server_phase11a_runtime.ts"]);
  assert.ok(packageJson.scripts["build:server-phase11a-runtime"]);
  assert.ok(packageJson.scripts["check:server-phase11a-runtime"]);
  assert.ok(packageJson.scripts["check:typescript"].includes("check:server-phase11a-runtime"));
  for (const marker of [
    "$localServerPhase11aRuntime",
    "$localServerPhase11aRuntimeSource",
    "$localServerPhase11aRuntimeBuildConfig",
    "$localServerPhase11aRuntimeCheck",
    "$localServerPhase11aRuntimeBuildSync",
    "npm run check:server-phase11a-runtime",
  ]) {
    assert.ok(deploySource.includes(marker), `deploy script must include ${marker}`);
  }

  console.log("[server-phase11a-runtime] runtime, HTTP, bootstrap, ownership, and deploy checks passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
