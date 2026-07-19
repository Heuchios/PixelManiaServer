// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");

/**
 * @typedef {Record<
 *   "server" | "phase8PlayerSessionRoutes" | "serverPhase8WorldActionRoutes" | "serverPhase8FinalRoutes" | "phase11aRuntime" | "serverRouteSources" | "postgres" | "packageJson" | "deploy" | "clientDropManager" | "rules" | "handoff" | "production",
 *   string
 * >} AntiDupeFiles
 *
 * @typedef {object} WiringCheck
 * @property {string} name
 * @property {boolean} ok
 */

const backendRootCandidates = [
  process.cwd(),
  path.resolve(__dirname, ".."),
  path.resolve(process.cwd(), "backend"),
];

/**
 * @param {string[]} candidates
 * @param {boolean} [required]
 * @returns {string}
 */
function readFirst(candidates, required = true) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }
  if (!required) return "";
  throw new Error(`Could not find required file. Checked: ${candidates.join(", ")}`);
}

/**
 * @param {string} filename
 * @returns {string[]}
 */
function fromBackend(filename) {
  return backendRootCandidates.map((root) => path.join(root, filename));
}

/**
 * @param {string} filename
 * @returns {string[]}
 */
function fromRepoRoot(filename) {
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(__dirname, "..", ".."),
  ];
  /** @type {string[]} */
  const expandedRoots = [];
  for (const root of roots) {
    expandedRoots.push(root);
    expandedRoots.push(path.join(root, "pixel-mania"));
  }
  return [...new Set(expandedRoots)].map((root) => path.join(root, filename));
}

/**
 * @param {string} text
 * @param {string} startMarker
 * @param {string} endMarker
 * @returns {string}
 */
function sliceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return "";
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : -1;
  return end > start ? text.slice(start, end) : text.slice(start);
}

/**
 * @param {string} text
 * @param {string} needle
 * @returns {number}
 */
function countOccurrences(text, needle) {
  if (!text || !needle) return 0;
  return text.split(needle).length - 1;
}

/**
 * @param {string} text
 * @param {string} reason
 * @returns {boolean}
 */
function includesWorldDropRefreshReason(text, reason) {
  if (!text || !reason) return false;
  return new RegExp(`refreshWorldDropsFromPostgres\\([^\\n;]*["']${reason}["']`).test(text);
}

/** @type {AntiDupeFiles} */
const files = {
  server: readFirst(fromBackend("server.js")),
  phase8PlayerSessionRoutes: readFirst(fromBackend("server_phase8_player_session_routes.js")),
  serverPhase8WorldActionRoutes: readFirst(fromBackend("server_phase8_world_action_routes.js"), false),
  serverPhase8FinalRoutes: readFirst(fromBackend("server_phase8_final_routes.js"), false),
  phase11aRuntime: readFirst(fromBackend("server_phase11a_runtime.js"), false),
  serverRouteSources: "",
  postgres: readFirst(fromBackend("postgres_store.js")),
  packageJson: readFirst(fromBackend("package.json")),
  deploy: readFirst(fromBackend("deploy_to_droplet.ps1"), false),
  clientDropManager: readFirst(fromRepoRoot("Scripts/drop_manager.gd"), false),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
  production: readFirst(fromRepoRoot("docs/production_backend_wiring.md"), false),
};

files.serverRouteSources = [
  files.server,
  files.phase8PlayerSessionRoutes,
  files.serverPhase8WorldActionRoutes,
  files.serverPhase8FinalRoutes,
  files.phase11aRuntime,
].filter(Boolean).join("\n");

const postgresDropPickup = sliceBetween(files.postgres, "async applyDropPickupTransaction", "async applyTradeFinalizationTransaction");
const postgresTrade = sliceBetween(files.postgres, "async applyTradeFinalizationTransaction", "async applyVendBuyTransaction");
const postgresVend = sliceBetween(files.postgres, "async applyVendBuyTransaction", "async issuePunishment");
const postgresInventoryDelta = sliceBetween(files.postgres, "async applyInventoryDeltaTransaction", "async recordVendingTransaction");
const postgresTransferInstances = sliceBetween(files.postgres, "async transferTrackedItemInstances", "async claimTrackedWorldDropItemInstances");
const postgresClaimWorldDrop = sliceBetween(files.postgres, "async claimTrackedWorldDropItemInstances", "async createTrackedWorldDropItemInstances");
const serverAndSessionRouteSources = files.serverRouteSources;
const dropPickupLocksDrop = files.serverRouteSources.includes("const dropLock = await acquireLiveActionLock(worldDropActionLocks, \"drop\"")
  || files.serverRouteSources.includes("dropLock = await acquireLiveActionLock(worldDropActionLocks, \"drop\"");
const dropPickupLocksPickerInventory = files.serverRouteSources.includes("inventoryLocks = await acquirePlayerInventoryLocks([player.account_username], `drop:")
  || files.serverRouteSources.includes("inventoryLocks = await acquirePlayerInventoryLocksWithWait([player.account_username], `drop:");

/** @type {WiringCheck[]} */
const checks = [
  {
    name: "server has reusable live inventory locks backed by Redis/local action locks",
    ok: files.server.includes("const playerInventoryActionLocks = new Set()")
      && files.server.includes("async function acquirePlayerInventoryLocks")
      && files.server.includes("function releasePlayerInventoryLocks")
      && files.server.includes('acquireLiveActionLock(playerInventoryActionLocks, "inventory"')
      && files.server.includes(".sort()"),
  },
  {
    name: "shared inventory commits lock one player inventory before writing state",
    ok: files.server.includes("async function commitPlayerInventoryState")
      && files.server.includes("options.skip_inventory_lock !== true")
      && files.server.includes("inventoryLock = await acquirePlayerInventoryLocks([cleanUsername]")
      && files.server.includes("releasePlayerInventoryLocks(inventoryLock)")
      && files.server.includes("postgresStore.applyInventoryDeltaTransaction(")
      && files.server.includes("buildPostgresInventoryDeltaTransactionEntry({"),
  },
  {
    name: "drop pickup locks the drop and picker inventory around the PostgreSQL pickup transaction",
    ok: dropPickupLocksDrop
      && dropPickupLocksPickerInventory
      && files.serverRouteSources.includes("postgresStore.applyDropPickupTransaction({")
      && files.serverRouteSources.includes("allow_world_drop_repair: true")
      && files.serverRouteSources.includes("releasePlayerInventoryLocks(inventoryLocks)")
      && files.serverRouteSources.includes("releaseLiveActionLock(dropLock)"),
  },
  {
    name: "client drop manager keeps legacy local drop/pickup authority disabled",
    ok: files.clientDropManager.includes("const USE_LEGACY_CLIENT_LOCAL_DROPS := false")
      && files.clientDropManager.includes("func request_server_drop_inventory_item")
      && files.clientDropManager.includes("send_inventory_transaction_request(payload)"),
  },
  {
    name: "block edits lock contested tiles and defer storage break returns into the world commit",
    ok: files.serverRouteSources.includes("const worldBlockActionLocks = new Set()")
      && files.serverRouteSources.includes("acquireLiveActionLock(worldBlockActionLocks, \"world_block\"")
      && files.serverRouteSources.includes("releaseLiveActionLock(blockActionLock)")
      && files.serverRouteSources.includes("rollbackWorldState")
      && files.serverRouteSources.includes("worldChanges: [vendBreakWorldChange]")
      && files.serverRouteSources.includes("worldChanges: [safeBreakWorldChange]")
      && files.serverRouteSources.includes("worldChanges: [displayBreakWorldChange]")
      && files.serverRouteSources.includes("deferred_inventory_commit"),
  },
  {
    name: "trade finalization locks both inventories, validates, commits, and unlocks in finally",
    ok: files.server.includes("trade._finalizing = true")
      && files.server.includes("[trade.requester_username, trade.target_username]")
      && files.server.includes("validateFullTradeInventory(trade, stateA, stateB)")
      && files.server.includes("postgresStore.applyTradeFinalizationTransaction({")
      && files.server.includes("releasePlayerInventoryLocks(inventoryLocks)")
      && files.server.includes("trade._finalizing = false"),
  },
  {
    name: "vending buy locks vending machine plus buyer/owner inventories",
    ok: files.server.includes("const vendLock = await acquireLiveActionLock(worldVendActionLocks, \"vend\"")
      && files.server.includes("[player.account_username, vend.owner_username]")
      && files.server.includes("postgresStore.applyVendBuyTransaction({")
      && files.server.includes("releasePlayerInventoryLocks(inventoryLocks)")
      && files.server.includes("releaseLiveActionLock(vendLock)"),
  },
  {
    name: "PostgreSQL generic inventory delta uses transactions and row-level inventory locks",
    ok: postgresInventoryDelta.includes("return await this.withTransaction(async (client)")
      && postgresInventoryDelta.includes("FROM ${this.table(\"inventory\")}")
      && postgresInventoryDelta.includes("FOR UPDATE")
      && postgresInventoryDelta.includes("row_version = ${this.table(\"inventory\")}.row_version + 1"),
  },
  {
    name: "PostgreSQL schema durably mirrors active world drops",
    ok: files.postgres.includes("CREATE TABLE IF NOT EXISTS ${this.table(\"world_drops\")}")
      && files.postgres.includes("UNIQUE (world_id, drop_id)")
      && files.postgres.includes("idx_world_drops_world_active")
      && files.postgres.includes("async mirrorWorldDropsState")
      && files.postgres.includes("async loadActiveWorldDrops"),
  },
  {
    name: "PostgreSQL drop pickup locks inventory and exact world-drop PM-ITEM rows",
    ok: postgresDropPickup.includes("return await this.withTransaction(async (client)")
      && postgresDropPickup.includes("FROM ${this.table(\"world_drops\")}")
      && postgresDropPickup.includes("UPDATE ${this.table(\"world_drops\")}")
      && postgresDropPickup.includes("drop_amount_changed")
      && postgresDropPickup.includes("FROM ${this.table(\"inventory\")}")
      && postgresDropPickup.includes("FOR UPDATE")
      && postgresDropPickup.includes("claimTrackedWorldDropItemInstances")
      && postgresClaimWorldDrop.includes("current_location = 'world_drop'")
      && postgresClaimWorldDrop.includes("FOR UPDATE"),
  },
  {
    name: "authoritative drop pickup persists and refreshes world drop state",
    ok: files.server.includes("async function persistAuthoritativeWorldState")
      && files.server.includes("async function refreshWorldDropsFromPostgres")
      && /persistAuthoritativeWorldState\(\s*pickupPlan\.world\s*,/.test(files.serverRouteSources)
      && includesWorldDropRefreshReason(serverAndSessionRouteSources, "join_world")
      && includesWorldDropRefreshReason(serverAndSessionRouteSources, "door_enter")
      && includesWorldDropRefreshReason(files.serverRouteSources, "netfox_server_world_load")
      && files.server.includes("state.drops.clear()")
      && files.server.includes("loadDropsIntoMap(state.drops, result.drops || [])"),
  },
  {
    name: "drop pickup success response carries authoritative drop metadata and inventory deltas",
    ok: countOccurrences(files.serverRouteSources, "drop_id: pickedDrop.drop_id") >= 2
      && countOccurrences(files.serverRouteSources, "remaining_amount:") >= 2
      && countOccurrences(files.serverRouteSources, "inventory_deltas: pickupInventoryDelta") >= 2
      && files.serverRouteSources.includes('source_type: "world_item_drop_pickup"'),
  },
  {
    name: "production deploy refreshes existing route PM2 apps that can serve pickup traffic",
    ok: files.deploy.includes("for route_app in pixelmania-a pixelmania-b")
      && files.deploy.includes('pm2 restart "$route_app"')
      && files.deploy.includes("Restarting existing route app"),
  },
  {
    name: "PostgreSQL trade finalization locks inventory rows and moves exact tracked item instances",
    ok: postgresTrade.includes("return await this.withTransaction(async (client)")
      && postgresTrade.includes("FOR UPDATE")
      && postgresTrade.includes("transferTrackedItemInstances(client, {")
      && postgresTrade.includes("strict_item_instances: true")
      && postgresTransferInstances.includes("FOR UPDATE"),
  },
  {
    name: "PostgreSQL vending buy locks buyer payment/item rows and exact vending/payment PM-ITEM rows",
    ok: postgresVend.includes("return await this.withTransaction(async (client)")
      && postgresVend.includes("item_type = 'world_lock'")
      && postgresVend.includes("FOR UPDATE")
      && postgresVend.includes("strict_item_instances: true")
      && postgresVend.includes("from_locations: [\"vending\", \"inventory\"]")
      && postgresVend.includes("action: \"payment\""),
  },
  {
    name: "package and production deploy include anti-dupe locking checks",
    ok: files.packageJson.includes('"check:anti-dupe": "node scripts/check_anti_dupe_locking_wiring.js"')
      && files.packageJson.includes("npm run check:anti-dupe")
      && files.deploy.includes("$localAntiDupeLockingCheck")
      && files.deploy.includes("node --check scripts/check_anti_dupe_locking_wiring.js")
      && files.deploy.includes("npm run check:anti-dupe"),
  },
  {
    name: "project docs describe anti-dupe transaction locking policy",
    ok: files.rules.includes("Anti-Dupe Transaction Locking")
      && files.handoff.includes("Anti-Dupe Transaction Locking")
      && files.production.includes("check:anti-dupe"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[anti-dupe-locking] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[anti-dupe-locking] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[anti-dupe-locking] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[anti-dupe-locking] success");
