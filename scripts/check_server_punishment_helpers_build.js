#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PunishmentHelpersModule = require("../server_punishment_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_punishment_helpers.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_punishment_helpers.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_punishment_helpers_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-punishment-helpers.json"), "utf8"));

/** @type {Map<string, { expiresAt: number, rows: Record<string, unknown>[] }>} */
const punishmentCache = new Map();
let postgresReady = true;
let lookupCount = 0;

/** @type {any} */
const helpers = PunishmentHelpersModule.createServerPunishmentHelpers({
  punishmentTypes: new Set(["ban", "mute", "trade_ban", "world_ban", "lockout"]),
  scopeGlobal: "global",
  scopeWorld: "world",
  maxDurationMinutes: 120,
  cacheTtlMs: 5000,
  punishmentCache,
  accountKey(/** @type {unknown} */ value) {
    return String(value || "").trim().toLowerCase();
  },
  cleanAccountName(/** @type {unknown} */ value) {
    return String(value || "").trim();
  },
  cleanWorld(/** @type {unknown} */ value) {
    return String(value || "START").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32) || "START";
  },
  cleanPunishmentReason(/** @type {unknown} */ value, /** @type {number} */ limit) {
    return String(value || "").trim().slice(0, limit);
  },
  isPostgresAuthoritativeReady() {
    return postgresReady;
  },
  async getActivePunishments(/** @type {string} */ username, /** @type {{ punishment_type: string, scope: string, world: string }} */ options) {
    lookupCount += 1;
    assert.equal(username, "Uso");
    assert.deepEqual(options, { punishment_type: "world_ban", scope: "world", world: "TEST" });
    return [
      {
        punishment_id: 7,
        punishment_type: "world_ban",
        scope: "world",
        world: "TEST",
        reason: "too loud",
        starts_at: "2026-01-01T00:00:00.000Z",
        ends_at: "2026-01-02T00:00:00.000Z",
        issued_by_username: "Admin",
      },
    ];
  },
});

assert.equal(helpers.normalizeServerPunishmentType("tradeban"), "trade_ban");
assert.equal(helpers.normalizeServerPunishmentType("world-ban"), "world_ban");
assert.equal(helpers.normalizeServerPunishmentType("missing"), "");
assert.equal(helpers.getPunishmentTypeLabel("lockout"), "security lockout");
assert.equal(helpers.cleanWorldNameForPunishment("te st!"), "TEST");
assert.equal(helpers.cleanPunishmentReason("  reason  "), "reason");
assert.equal(helpers.getPunishmentCacheKey("Uso", "world-ban", "world", "te st!"), "uso:world_ban:world:TEST");
assert.deepEqual(helpers.parsePunishmentDurationToken(""), { ok: false, consumed: false, durationMinutes: 0, label: "permanent" });
assert.deepEqual(helpers.parsePunishmentDurationToken("perm"), { ok: true, consumed: true, durationMinutes: 0, label: "permanent" });
assert.deepEqual(helpers.parsePunishmentDurationToken("2h"), { ok: true, consumed: true, durationMinutes: 120, label: "2h" });
assert.deepEqual(helpers.parsePunishmentDurationToken("3h"), { ok: true, consumed: true, durationMinutes: 120, label: "3h" });
assert.deepEqual(helpers.parsePunishmentDurationToken("bad"), { ok: false, consumed: false, durationMinutes: 0, label: "permanent" });
assert.equal(helpers.formatPunishmentExpires({}), "permanent");
assert.equal(helpers.formatPunishmentExpires({ ends_at: "bad-date" }), "until bad-date");
assert.equal(helpers.formatPunishmentExpires({ ends_at: "2026-01-02T00:00:00.000Z" }), "until 2026-01-02T00:00:00.000Z");

assert.deepEqual(helpers.publicPunishmentPayload({
  punishment_id: "7",
  type: "worldban",
  scope: "world",
  world: "te st!",
  reason: "  no  ",
  starts_at: "start",
  ends_at: "end",
  issued_by_username: "Admin",
}), {
  punishment_id: 7,
  punishment_type: "world_ban",
  scope: "world",
  world: "TEST",
  reason: "no",
  starts_at: "start",
  ends_at: "end",
  issued_by: "Admin",
});
assert.equal(
  helpers.formatPunishmentBlockMessage("chat", { punishment_type: "mute", reason: "spam" }),
  "You are muted (permanent). Reason: spam"
);
assert.equal(
  helpers.formatPunishmentBlockMessage("world", { punishment_type: "world_ban", scope: "world", world: "TEST" }),
  "You cannot enter or edit this world in TEST (permanent)."
);
assert.deepEqual(helpers.buildPunishmentNoticePayload({ world: "START" }, "blocked", { punishment_type: "mute" }), {
  type: "chat",
  player_id: "system",
  name: "System",
  message: "blocked",
  world: "START",
  punishment: {
    punishment_id: 0,
    punishment_type: "mute",
    scope: "",
    world: "",
    reason: "",
    starts_at: "",
    ends_at: "",
    issued_by: "",
  },
});

(async () => {
  const first = await helpers.getActivePunishmentsCached("Uso", {
    punishment_type: "world_ban",
    scope: "world",
    world: "test",
  });
  const second = await helpers.getActivePunishmentsCached("Uso", {
    punishment_type: "world_ban",
    scope: "world",
    world: "test",
  });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(lookupCount, 1);
  assert.equal((await helpers.getBlockingPunishment("Uso", ["mute"], { punishment_type: "world_ban", scope: "world", world: "test" })), null);
  assert.equal((await helpers.getBlockingPunishment("Uso", ["world_ban"], { punishment_type: "world_ban", scope: "world", world: "test" })).punishment_id, 7);

  punishmentCache.set("uso:mute:global:", { expiresAt: Date.now() + 1000, rows: [] });
  punishmentCache.set("other:mute:global:", { expiresAt: Date.now() + 1000, rows: [] });
  helpers.clearPunishmentCache("Uso");
  assert.equal(punishmentCache.has("uso:mute:global:"), false);
  assert.equal(punishmentCache.has("other:mute:global:"), true);
  helpers.clearPunishmentCache("");
  assert.equal(punishmentCache.size, 0);

  postgresReady = false;
  assert.deepEqual(await helpers.getActivePunishmentsCached("Uso", { scope: "global" }), []);

  assert.equal(
    packageJson.scripts["build:server-punishment-helpers"],
    "tsc --project tsconfig.server-punishment-helpers.json && node scripts/sync_server_punishment_helpers_build.js"
  );
  assert.equal(
    packageJson.scripts["check:server-punishment-helpers"],
    "npm run build:server-punishment-helpers && node scripts/check_server_punishment_helpers_build.js"
  );
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-punishment-helpers/);
  assert.deepEqual(buildConfig.include, ["src/server_punishment_helpers.ts"]);
  assert.match(helperSource, /function createServerPunishmentHelpers/);
  assert.match(helperSource, /function formatPunishmentBlockMessage/);
  assert.match(generatedSource, /Generated from src\/server_punishment_helpers\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.match(syncSource, /server_punishment_helpers\.js/);
  assert.match(serverSource, /require\("\.\/server_punishment_helpers"\)/);
  assert.match(serverSource, /ServerPunishmentHelpers\.formatPunishmentBlockMessage/);
  assert.match(serverSource, /ServerPunishmentHelpers\.getBlockingPunishment/);
  assert.match(deploySource, /server_punishment_helpers\.js/);
  assert.match(deploySource, /src\/server_punishment_helpers\.ts/);
  assert.match(deploySource, /tsconfig\.server-punishment-helpers\.json/);
  assert.match(deploySource, /sync_server_punishment_helpers_build\.js/);
  assert.match(deploySource, /check_server_punishment_helpers_build\.js/);
  assert.match(deploySource, /npm run build:server-punishment-helpers/);

  console.log("[server-punishment-helpers] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
