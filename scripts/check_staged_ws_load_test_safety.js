"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  DEFAULT_TOKEN_POOL_MAX_AGE_MS,
  buildRoutes,
  parseDurationMs,
  readTokenPool,
  validateLiveTokenPool,
  validateWorldCapacityPlan,
  writeTokenAccounts,
} = require("./staged_ws_load_test");

const loadScriptSource = fs.readFileSync(path.join(__dirname, "staged_ws_load_test.js"), "utf8");

assert.equal(parseDurationMs("1.5h", 0), 5_400_000);
assert.equal(parseDurationMs("2s", 0), 2_000);

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
assert.match(loadScriptSource, /--auth-only/);
assert.match(loadScriptSource, /if \(this\.runner\.authOnly\) return;/);
assert.match(loadScriptSource, /this\.authOnly \|\| this\.stats\.worldStates >= this\.clientsTarget/);
assert.match(loadScriptSource, /if \(!authOnly\) validateWorldCapacityPlan/);

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
