"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  DEFAULT_MAX_MOVEMENT_BUFFERED_BYTES,
  DEFAULT_MAX_PONG_AGE_MS,
  DEFAULT_TOKEN_POOL_MAX_AGE_MS,
  buildRoutes,
  deriveHealthEndpoints,
  extractServerHealthMetrics,
  getMovementTransportDecision,
  nanosecondsToMilliseconds,
  parseDurationMs,
  parseHealthEndpoints,
  readTokenPool,
  summarizeMetricSeries,
  validateLiveTokenPool,
  validateWorldCapacityPlan,
  writeTokenAccounts,
} = require("./staged_ws_load_test");

const loadScriptSource = fs.readFileSync(path.join(__dirname, "staged_ws_load_test.js"), "utf8");

assert.equal(parseDurationMs("1.5h", 0), 5_400_000);
assert.equal(parseDurationMs("2s", 0), 2_000);
assert.equal(nanosecondsToMilliseconds(15_163_000_000), 15_163);
assert.equal(nanosecondsToMilliseconds(Number.NaN), 0);

const healthyTransport = getMovementTransportDecision(
  { bufferedAmount: 0 },
  { positionWritePending: false, lastPongAt: 9_000 },
  { now: 10_000 },
);
assert.equal(healthyTransport.ok, true);
assert.equal(healthyTransport.pongAgeMs, 1_000);

const pendingTransport = getMovementTransportDecision(
  { bufferedAmount: 0 },
  { positionWritePending: true, positionWriteStartedAt: 8_500, lastPongAt: 9_000 },
  { now: 10_000 },
);
assert.equal(pendingTransport.ok, false);
assert.equal(pendingTransport.reason, "pending_write");
assert.equal(pendingTransport.pendingWriteAgeMs, 1_500);

const bufferedTransport = getMovementTransportDecision(
  { bufferedAmount: DEFAULT_MAX_MOVEMENT_BUFFERED_BYTES + 1 },
  { positionWritePending: false, lastPongAt: 9_000 },
  { now: 10_000 },
);
assert.equal(bufferedTransport.ok, false);
assert.equal(bufferedTransport.reason, "buffered_amount");

const staleHeartbeatTransport = getMovementTransportDecision(
  { bufferedAmount: 0 },
  { positionWritePending: false, lastPongAt: 1 },
  { now: DEFAULT_MAX_PONG_AGE_MS + 2 },
);
assert.equal(staleHeartbeatTransport.ok, false);
assert.equal(staleHeartbeatTransport.reason, "stale_peer_activity");

const delayedPongWithFreshInboundTransport = getMovementTransportDecision(
  { bufferedAmount: 0 },
  {
    positionWritePending: false,
    lastPongAt: 1,
    lastInboundAt: DEFAULT_MAX_PONG_AGE_MS,
  },
  { now: DEFAULT_MAX_PONG_AGE_MS + 2 },
);
assert.equal(delayedPongWithFreshInboundTransport.ok, true);
assert.equal(delayedPongWithFreshInboundTransport.pongAgeMs, DEFAULT_MAX_PONG_AGE_MS + 1);
assert.equal(delayedPongWithFreshInboundTransport.inboundAgeMs, 2);

const routePlan = buildRoutes(
  ["wss://example.test/ws-a", "wss://example.test/ws-b"],
  ["LOAD_A1", "LOAD_B1", "LOAD_A2", "LOAD_B2", "LOAD_A3", "LOAD_B3"],
);
assert.equal(routePlan.length, 6);
assert.equal(routePlan[0].url, "wss://example.test/ws-a");
assert.equal(routePlan[1].url, "wss://example.test/ws-b");
assert.equal(routePlan[2].url, "wss://example.test/ws-a");
assert.equal(validateWorldCapacityPlan(250, routePlan, 50), 42);
assert.throws(
  () => validateWorldCapacityPlan(250, routePlan.slice(0, 2), 50),
  /Impossible world-cap plan/,
);
assert.match(loadScriptSource, /PIXELMANIA_LOAD_CLIENT_VERSION \|\| "1\.0\.4"/);
assert.match(loadScriptSource, /type === "world_state_stream_begin"/);
assert.match(loadScriptSource, /type === "world_state_stream_chunk"/);
assert.match(loadScriptSource, /type === "world_state_stream_end"/);
assert.match(loadScriptSource, /worldStateStreamErrors === 0/);
assert.match(loadScriptSource, /worldStatePacketBytesMax/);
assert.match(loadScriptSource, /worldStates >= this\.clientsTarget/);

// --- server-side metric capture -------------------------------------------
// /health lives at the host root, so per-path routes on one host share one endpoint. This is
// the trap that left the July 2026 250-player stage with client-only telemetry: the runner must
// still poll, and must warn instead of silently measuring a single process.
assert.deepEqual(
  deriveHealthEndpoints(["wss://api.example.test/ws-a", "wss://api.example.test/ws-b"]).map((route) => route.url),
  ["https://api.example.test/health"],
);
assert.equal(deriveHealthEndpoints(["ws://127.0.0.1:18091", "ws://127.0.0.1:18092"]).length, 2);
assert.deepEqual(
  parseHealthEndpoints("a=http://127.0.0.1:18091/health,b=http://127.0.0.1:18092/health"),
  [
    { label: "a", url: "http://127.0.0.1:18091/health" },
    { label: "b", url: "http://127.0.0.1:18092/health" },
  ],
);
assert.deepEqual(
  parseHealthEndpoints("http://127.0.0.1:18091/health"),
  [{ label: "h0", url: "http://127.0.0.1:18091/health" }],
);
assert.throws(() => parseHealthEndpoints("ws://127.0.0.1:8080/health"), /must use http:\/\/ or https:\/\//);

// Field names are pinned to what server_phase11a_runtime.ts emits. server_tick reports
// event_loop_lag_ms / max_event_loop_lag_ms; reading last_lag_ms / max_lag_ms silently yields
// nothing, which is how the tick lag went unrecorded before.
const serverMetrics = extractServerHealthMetrics({
  ok: true,
  release_id: "rel-check",
  persistence: {
    postgres_ready: true,
    redis_ready: true,
    server_tick: { enabled: true, tick_time_ms: 1120, avg_tick_time_ms: 1030, max_tick_time_ms: 1400, event_loop_lag_ms: 120, max_event_loop_lag_ms: 400 },
    process_runtime: { pid: 4242, uptime_seconds: 900, rss_mb: 412.5, heap_used_mb: 210.25, heap_total_mb: 260, external_mb: 6, array_buffers_mb: 2 },
    player_network: {
      inbound_message_queue_pending: 4,
      inbound_message_queue_wait_max_ms: 260,
      player_position_queue_wait_max_ms: 310,
      pending_position_updates: 9,
      active_interest_links: 1200,
      rate_limit_rejections_by_bucket: { player_position: 3 },
    },
    world_network: { pending_world_updates: 2 },
    world_index: { active_world_count: 6, indexed_player_count: 250, largest_world_population: 50 },
    world_route: { instance_id: "pixelmania-a", local_owned_world_count: 3 },
    persistence_queue: { pending_persistence_writes: 5 },
  },
});
assert.equal(serverMetrics.reachable, true);
assert.equal(serverMetrics.instance_id, "pixelmania-a");
assert.equal(serverMetrics.event_loop_lag_ms, 120);
assert.equal(serverMetrics.max_event_loop_lag_ms, 400);
assert.equal(serverMetrics.tick_time_ms, 1120);
assert.equal(serverMetrics.inbound_message_queue_wait_max_ms, 260);
assert.equal(serverMetrics.player_position_queue_wait_max_ms, 310);
assert.equal(serverMetrics.pending_position_updates, 9);
assert.equal(serverMetrics.pending_world_updates, 2);
assert.equal(serverMetrics.active_interest_links, 1200);
assert.equal(serverMetrics.indexed_player_count, 250);
assert.equal(serverMetrics.pending_persistence_writes, 5);
assert.deepEqual(serverMetrics.rate_limit_rejections_by_bucket, { player_position: 3 });
assert.equal(serverMetrics.process_runtime_available, true);
assert.equal(serverMetrics.process_pid, 4242);
assert.equal(serverMetrics.rss_mb, 412.5);
assert.equal(serverMetrics.heap_used_mb, 210.25);

const unreachableMetrics = extractServerHealthMetrics(null);
assert.equal(unreachableMetrics.reachable, false);
assert.equal(unreachableMetrics.event_loop_lag_ms, 0);
assert.equal(unreachableMetrics.instance_id, "");

// A server build without process-memory reporting must read as UNMEASURED, never as 0 MB.
const legacyServerMetrics = extractServerHealthMetrics({ ok: true, persistence: { server_tick: { event_loop_lag_ms: 5 } } });
assert.equal(legacyServerMetrics.reachable, true);
assert.equal(legacyServerMetrics.process_runtime_available, false);
assert.equal(legacyServerMetrics.rss_mb, 0);

// The running max is monotonic by construction, so the degradation verdict has to come from
// the instantaneous per-sample values.
const risingSeries = summarizeMetricSeries([1, 1, 1, 1, 9, 9, 9, 9]);
assert.equal(risingSeries.samples, 8);
assert.equal(risingSeries.min, 1);
assert.equal(risingSeries.max, 9);
assert.equal(risingSeries.first_quarter_avg, 1);
assert.equal(risingSeries.last_quarter_avg, 9);
assert.equal(risingSeries.growth, 8);
assert.equal(summarizeMetricSeries([]).samples, 0);
assert.equal(summarizeMetricSeries([5]).growth, 0);

assert.match(loadScriptSource, /--metrics-out <file\.jsonl>/);
assert.match(loadScriptSource, /--health-urls <a,b>/);
assert.match(loadScriptSource, /async sampleServerHealth\(options = \{\}\)/);
// The abort path is where the July stage ended; it must still capture a final server sample.
assert.match(loadScriptSource, /this\.sampleServerHealth\(\{ phase: "abort" \}\)/);
assert.match(loadScriptSource, /printServerHealthSummary\(\)/);

const freshTimestamp = new Date().toISOString();
const staleTimestamp = new Date(Date.now() - DEFAULT_TOKEN_POOL_MAX_AGE_MS - 60_000).toISOString();
const account = {
  username: "LoadSafety0001",
  session_token: "session-token",
  refresh_token: "refresh-token",
};

assert.doesNotThrow(() => validateLiveTokenPool(
  { metadata: { generated_at: freshTimestamp } },
  { likelyLive: true, devLogin: false },
));
assert.throws(
  () => validateLiveTokenPool(
    { metadata: { generated_at: staleTimestamp } },
    { likelyLive: true, devLogin: false },
  ),
  /stale live token pool/,
);
assert.throws(
  () => validateLiveTokenPool(
    { metadata: {} },
    { likelyLive: true, devLogin: false },
  ),
  /unverified live token pool/,
);
assert.throws(
  () => validateLiveTokenPool(
    { metadata: { generated_at: freshTimestamp, last_run: { ok: false } } },
    { likelyLive: true, devLogin: false },
  ),
  /failed load stage/,
);
assert.doesNotThrow(() => validateLiveTokenPool(
  { metadata: {} },
  { likelyLive: true, devLogin: false, allowUnsafeTokenFile: true },
));

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-load-safety-"));
try {
  const sourcePath = path.join(temporaryDirectory, "tokens.json");
  const outputPath = path.join(temporaryDirectory, "tokens.next.json");
  fs.writeFileSync(sourcePath, `${JSON.stringify({
    generated_at: freshTimestamp,
    purpose: "safety-check",
    accounts: [account],
  }, null, 2)}\n`, "utf8");

  const tokenPool = readTokenPool(sourcePath);
  assert.equal(tokenPool.accounts.length, 1);
  assert.equal(tokenPool.metadata.purpose, "safety-check");
  writeTokenAccounts(outputPath, tokenPool.accounts, {
    ...tokenPool.metadata,
    last_run: { ok: true },
  });

  const rotatedPool = readTokenPool(outputPath);
  assert.equal(rotatedPool.accounts.length, 1);
  assert.equal(rotatedPool.metadata.purpose, "safety-check");
  assert.equal(rotatedPool.metadata.last_run.ok, true);
  assert.equal(rotatedPool.metadata.count, 1);
  assert.ok(Number.isFinite(Date.parse(rotatedPool.metadata.updated_at)));
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("[staged-load-safety] success");
