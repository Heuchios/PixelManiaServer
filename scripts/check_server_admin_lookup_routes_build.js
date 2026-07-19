#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AdminLookupRoutesModule = require("../server_admin_lookup_routes");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_admin_lookup_routes.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_admin_lookup_routes.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_admin_lookup_routes_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-admin-lookup-routes.json"), "utf8"));

/** @type {Map<string, Record<string, any>>} */
const accounts = new Map([
  ["target", { username: "Target", role: "player", last_seen_at: "2026-07-18T00:00:00.000Z" }],
]);
/** @type {Map<string, Record<string, any>>} */
const players = new Map([
  ["p-admin", { authenticated: true, account_username: "admin", name: "Admin", world: "START", x: 4, y: 5, joined_world: true }],
  ["p-target", { authenticated: true, account_username: "Target", name: "Target", world: "START", x: 8, y: 9, joined_world: true }],
]);
/** @type {Map<string, Record<string, any>>} */
const playerStates = new Map([
  ["target", {
    account_username: "Target",
    player_level: 7,
    selected_item_type: "seed",
    inventory: { apple: 2 },
    tool_inventory: { wrench: 1 },
    saved_at: "2026-07-18T00:00:01.000Z",
  }],
]);
/** @type {Map<string, Record<string, any>>} */
const worldStates = new Map([
  ["START", { drops: { "drop-1": { amount: 1 } }, saved_at: "saved", updated_at: "updated" }],
]);
/** @type {Map<string, Set<string>>} */
const worldPlayers = new Map([
  ["START", new Set(["p-admin", "p-target"])],
]);
/** @type {unknown[]} */
const messages = [];
/** @type {unknown[]} */
const adminLogs = [];
/** @type {unknown[]} */
const securityLogs = [];

function lastRecord(/** @type {unknown[]} */ records) {
  const record = records.at(-1);
  assert.ok(record && typeof record === "object");
  return /** @type {Record<string, any>} */ (record);
}

function accountKey(/** @type {unknown} */ value) {
  return String(value || "").trim().toLowerCase();
}

function cleanAccountName(/** @type {unknown} */ value) {
  return String(value || "").trim().toLowerCase();
}

function cleanName(/** @type {unknown} */ value) {
  return String(value || "").trim();
}

function cleanWorld(/** @type {unknown} */ value) {
  return String(value || "START").trim().toUpperCase();
}

function clampInteger(/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) {
  const number = Math.trunc(Number(value) || 0);
  return Math.max(min, Math.min(max, number));
}

const deps = {
  ADMIN_INVENTORY_LOOKUP_FIELDS: Object.freeze([{ field: "inventory", category: "" }, { field: "tool_inventory", category: "tool" }]),
  ADMIN_INVENTORY_LOOKUP_PURPOSE: "admin_inventory_lookup",
  ADMIN_ITEM_INSTANCE_HISTORY_LOOKUP_PURPOSE: "admin_item_instance_history_lookup",
  ADMIN_ITEM_INSTANCE_LOOKUP_LIMIT: 250,
  ADMIN_ITEM_INSTANCE_LOOKUP_PURPOSE: "admin_item_instance_lookup",
  ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS: 5000,
  ADMIN_MONITORING_DASHBOARD_LOOKUP_LIMIT: 40,
  ADMIN_MONITORING_DASHBOARD_PURPOSE: "admin_monitoring_dashboard",
  ADMIN_MONITORING_DASHBOARD_WINDOW_HOURS: 24,
  ADMIN_TRANSACTION_LEDGER_LOOKUP_LIMIT: 150,
  ADMIN_TRANSACTION_LEDGER_LOOKUP_PURPOSE: "admin_transaction_ledger_lookup",
  MAX_PLAYER_INVENTORY_KEYS: 500,
  PLAYER_LEVEL_MAX: 100,
  PLAYER_LEVEL_MIN: 1,
  WORLD_SNAPSHOT_INTERVAL_MINUTES: 60,
  WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE: 5,
  accountKey,
  accounts,
  activeTrades: new Map([["trade-1", {}]]),
  cleanAccountName,
  cleanInventoryCategory: cleanAccountName,
  cleanName,
  cleanText: cleanName,
  cleanWorld,
  clampInteger,
  clampString: cleanName,
  createDefaultPlayerState: (/** @type {unknown} */ username) => ({ account_username: cleanAccountName(username), inventory: {}, tool_inventory: {} }),
  doesAccountExist: (/** @type {unknown} */ username) => accountKey(username) === "target",
  ensurePlayerState: (/** @type {unknown} */ username) => playerStates.get(accountKey(username)) || null,
  findOnlinePlayerByUsername: (/** @type {unknown} */ username) => (
    accountKey(username) === "target" ? { socket: {}, player: players.get("p-target") } : null
  ),
  getAccountRole: (/** @type {unknown} */ username) => accountKey(username) === "admin" ? "admin" : "player",
  getDeveloperSecurityRequirement: () => ({ ok: true }),
  getPlayerNetworkStatsSnapshot: () => ({ sent: 1 }),
  getServerTickSnapshot: () => ({ tps: 60 }),
  getWorldIndexStatsSnapshot: () => ({ active_world_count: 1 }),
  getWorldPopulationCount: (/** @type {unknown} */ worldName) => worldPlayers.get(cleanWorld(worldName))?.size || 0,
  getWorldSnapshotSchedulerRunning: () => true,
  isAdmin: (/** @type {Record<string, any>} */ player) => accountKey(player.account_username || player.name) === "admin",
  isPostgresAuthoritativeReady: () => true,
  logAdminAction: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ action, /** @type {unknown} */ details, /** @type {unknown} */ ok, /** @type {unknown} */ message) => adminLogs.push({ action, details, ok, message }),
  logSecurityEvent: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ type, /** @type {unknown} */ details, /** @type {unknown} */ severity) => securityLogs.push({ type, details, severity }),
  pendingPersistenceWrites: new Set(["write-1"]),
  playerStates,
  players,
  postgresStore: {
    reconcileItemInstancesForUsername: async () => ({ ok: true, reason: "" }),
    listActiveItemInstances: async () => ([{
      item_instance_id: "internal-1",
      public_item_instance_id: "PM-ITEM-1",
      item_type: "wrench",
      item_category: "tool",
      state: "inventory",
      created_by_source: "test",
      current_location: "inventory",
      created_at: "created",
      updated_at: "updated",
    }]),
    getItemInstanceHistory: async () => ({ ok: true, item_instance: { source_confidence: "high" }, events: [{ id: 1 }], integrity: { flags: [] } }),
    listTransactionLedger: async () => ({
      ok: true,
      query: { username: "Target" },
      entries: [{
        transaction_ledger_id: 1,
        transaction_id: "tx-1",
        transaction_type: "pickup",
        status: "committed",
        username: "Target",
        item_type: "wrench",
        item_category: "tool",
        quantity: 1,
      }],
    }),
    getAdminMonitoringDashboard: async () => ({ ok: true, world_count: 1, dupe_warning_count: 0, suspicious_accounts: [] }),
    isReady: () => true,
  },
  redisStore: { isReady: () => true },
  sanitizeCountDictionary: (/** @type {unknown} */ value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {}),
  sanitizeStringArray: (/** @type {unknown} */ value) => Array.isArray(value) ? value.map(String) : [],
  sendJson: (/** @type {unknown} */ _socket, /** @type {unknown} */ payload) => messages.push(payload),
  withTimeout: async (/** @type {Promise<unknown>} */ promise) => promise,
  worldPlayers,
  worldSnapshotSchedulerState: { enabled: true, last_run_at: "now", last_duration_ms: 12, last_world_count: 1, last_error: "" },
  worldStates,
  wss: { clients: new Set([{}, {}]) },
};

(async () => {
  const routes = AdminLookupRoutesModule.createServerAdminLookupRoutes(deps);
  assert.equal(typeof routes.handleAdminInventoryLookupRequest, "function");
  assert.equal(typeof routes.handleAdminItemInstanceLookupRequest, "function");
  assert.equal(typeof routes.handleAdminItemInstanceHistoryLookupRequest, "function");
  assert.equal(typeof routes.handleAdminTransactionLedgerLookupRequest, "function");
  assert.equal(typeof routes.handleAdminMonitoringDashboardRequest, "function");

  const adminPlayer = { account_username: "admin", name: "Admin", world: "START" };
  routes.handleAdminInventoryLookupRequest({}, adminPlayer, { target_username: "Target" }, "", "req-inv", "admin_inventory_lookup");
  assert.equal(lastRecord(messages).ok, true);
  assert.equal(lastRecord(messages).purpose, "admin_inventory_lookup");
  assert.equal(lastRecord(messages).player_data.inventory.apple, 2);

  await routes.handleAdminItemInstanceLookupRequest({}, adminPlayer, { target_username: "Target", limit: 1 }, "", "req-inst", "admin_item_instance_lookup");
  assert.equal(lastRecord(messages).purpose, "admin_item_instance_lookup");
  assert.equal(lastRecord(messages).item_instances[0].public_item_instance_id, "pm-item-1");

  await routes.handleAdminItemInstanceHistoryLookupRequest({}, adminPlayer, { item_instance_id: "PM-ITEM-1" }, "Target", "req-history", "admin_item_instance_history_lookup");
  assert.equal(lastRecord(messages).purpose, "admin_item_instance_history_lookup");
  assert.equal(lastRecord(messages).item_instance_history.events.length, 1);

  await routes.handleAdminTransactionLedgerLookupRequest({}, adminPlayer, { target_username: "Target" }, "", "req-ledger", "admin_transaction_ledger_lookup");
  assert.equal(lastRecord(messages).purpose, "admin_transaction_ledger_lookup");
  assert.equal(lastRecord(messages).transaction_ledger[0].transaction_id, "tx-1");

  await routes.handleAdminMonitoringDashboardRequest({}, adminPlayer, { target_username: "Target" }, "", "req-monitor", "admin_monitoring_dashboard");
  assert.equal(lastRecord(messages).purpose, "admin_monitoring_dashboard");
  assert.equal(lastRecord(messages).dashboard.live.connected_sockets, 2);
  assert.equal(lastRecord(messages).dashboard.live.world_snapshot_scheduler.running, true);

  routes.handleAdminInventoryLookupRequest({}, { account_username: "player", world: "START" }, { target_username: "Target" }, "", "req-denied", "admin_inventory_lookup");
  assert.equal(lastRecord(messages).ok, false);
  assert.equal(lastRecord(securityLogs).type, "admin_inventory_lookup_denied");

  assert.equal(
    packageJson.scripts["build:server-admin-lookup-routes"],
    "tsc --project tsconfig.server-admin-lookup-routes.json && node scripts/sync_server_admin_lookup_routes_build.js"
  );
  assert.equal(
    packageJson.scripts["check:server-admin-lookup-routes"],
    "npm run build:server-admin-lookup-routes && node scripts/check_server_admin_lookup_routes_build.js"
  );
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-admin-lookup-routes/);
  assert.deepEqual(buildConfig.include, ["src/server_admin_lookup_routes.ts"]);
  assert.match(helperSource, /function createServerAdminLookupRoutes/);
  assert.match(helperSource, /handleAdminMonitoringDashboardRequest/);
  assert.match(generatedSource, /Generated from src\/server_admin_lookup_routes\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.match(syncSource, /server_admin_lookup_routes\.js/);
  assert.match(serverSource, /require\("\.\/server_admin_lookup_routes"\)/);
  assert.match(serverSource, /createServerAdminLookupRoutes/);
  assert.match(serverSource, /getServerAdminLookupRoutes\(\)\.handleAdminInventoryLookupRequest/);
  assert.match(deploySource, /server_admin_lookup_routes\.js/);
  assert.match(deploySource, /src\/server_admin_lookup_routes\.ts/);
  assert.match(deploySource, /tsconfig\.server-admin-lookup-routes\.json/);
  assert.match(deploySource, /check_server_admin_lookup_routes_build\.js/);
  assert.match(deploySource, /sync_server_admin_lookup_routes_build\.js/);
  assert.match(deploySource, /npm run build:server-admin-lookup-routes/);

  console.log("[server-admin-lookup-routes] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
