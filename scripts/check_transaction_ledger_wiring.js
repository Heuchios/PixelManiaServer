// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");

/**
 * @typedef {Record<
 *   "postgres" | "postgresContracts" | "server" | "adminLookupRoutes" | "worldSnapshotTool" |
 *   "developerPanel" | "networkManager" | "world" | "schema" | "rootSchema" | "rules",
 *   string
 * >} TransactionLedgerFiles
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

/** @type {TransactionLedgerFiles} */
const files = {
  postgres: readFirst(fromBackend("postgres_store.js")),
  postgresContracts: readFirst(fromBackend("postgres_store_contracts.js"), false),
  server: readFirst(fromBackend("server.js")),
  adminLookupRoutes: readFirst(fromBackend("server_admin_lookup_routes.js")),
  worldSnapshotTool: readFirst(fromBackend("scripts/world_snapshot_tool.js"), false),
  developerPanel: readFirst(fromRepoRoot("Scripts/developer_panel_ui.gd"), false),
  networkManager: readFirst(fromRepoRoot("Scripts/network_manager.gd"), false),
  world: readFirst(fromRepoRoot("Scripts/world.gd"), false),
  schema: readFirst(fromBackend("docs/postgres_security_foundation.sql")),
  rootSchema: readFirst([
    path.resolve(process.cwd(), "docs/postgres_security_foundation.sql"),
    path.resolve(process.cwd(), "../docs/postgres_security_foundation.sql"),
    path.resolve(__dirname, "../../docs/postgres_security_foundation.sql"),
  ], false),
  rules: readFirst([
    path.resolve(process.cwd(), "docs/backend_persistence_rules.md"),
    path.resolve(process.cwd(), "../docs/backend_persistence_rules.md"),
    path.resolve(process.cwd(), "../pixel-mania/docs/backend_persistence_rules.md"),
    path.resolve(__dirname, "../docs/backend_persistence_rules.md"),
    path.resolve(__dirname, "../../docs/backend_persistence_rules.md"),
    path.resolve(__dirname, "../../pixel-mania/docs/backend_persistence_rules.md"),
  ], false),
};
const adminLookupSources = `${files.server}\n${files.adminLookupRoutes}`;

if (files.rules === "") {
  console.warn("[transaction-ledger-wiring] warn: backend_persistence_rules.md was not found; code checks will still run.");
}

const requiredInventorySources = [
  "world_block_break",
  "world_block_place",
  "world_lock_conversion",
  "world_interaction",
  "drop_pickup",
  "drop_inventory",
  "seed_place",
  "seed_splice",
  "seed_harvest",
  "trade",
  "vending",
  "safe",
  "display",
  "shop",
  "craft",
  "crafting",
  "event",
  "quest",
  "loot_box",
  "reward",
  "world_drop",
  "furnace",
  "fishing",
  "fish_monger",
  "admin",
  "rollback",
  "system",
];

/**
 * @param {string} schema
 * @returns {boolean}
 */
function schemaIncludesInventorySources(schema) {
  return requiredInventorySources.every((source) => schema.includes(`'${source}'`));
}

/** @type {WiringCheck[]} */
const checks = [
  {
    name: "transaction_ledger table exists in bootstrap schema",
    ok: files.schema.includes("CREATE TABLE IF NOT EXISTS transaction_ledger")
      && files.schema.includes("inventory_before_hash")
      && files.schema.includes("inventory_after_hash")
      && files.schema.includes("public_item_instance_id"),
  },
  {
    name: "startup migration creates transaction_ledger and indexes",
    ok: files.postgres.includes('CREATE TABLE IF NOT EXISTS ${this.table("transaction_ledger")}')
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS transaction_id")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS vending_transaction_id")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS shop_purchase_id")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS admin_action_id")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS item_instance_id")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS ip_address")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS metadata")
      && files.postgres.includes("idx_transaction_ledger_player_time")
      && files.postgres.includes("transaction_ledger_status_check"),
  },
  {
    name: "startup migration repairs pickup-side ledger tables",
    ok: files.postgres.includes('ALTER TABLE ${this.table("world_drops")}')
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS drop_id")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS item_type")
      && files.postgres.includes("world_drops_amount_check")
      && files.postgres.includes('ALTER TABLE ${this.table("item_transactions")}')
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS request_id")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS correlation_id")
      && files.postgres.includes('CREATE TABLE IF NOT EXISTS ${this.table("gem_ledger")}')
      && files.postgres.includes('ALTER TABLE ${this.table("gem_ledger")}')
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS before_balance")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS after_balance")
      && files.postgres.includes("idx_gem_ledger_player_time")
      && files.postgres.includes('ALTER TABLE ${this.table("item_instance_events")}')
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS item_transaction_id")
      && files.postgres.includes("item_instance_events_event_type_check"),
  },
  {
    name: "bootstrap schemas allow all inventory transaction sources",
    ok: schemaIncludesInventorySources(files.schema)
      && (files.rootSchema === "" || schemaIncludesInventorySources(files.rootSchema)),
  },
  {
    name: "Postgres helper writes canonical ledger rows",
    ok: files.postgres.includes("async recordTransactionLedger")
      && files.postgres.includes("async recordTransactionLedgerEvent")
      && files.postgres.includes("async listTransactionLedger")
      && files.postgres.includes("normalizeTransactionLedgerType")
      && files.postgres.includes("getInventorySnapshotHash"),
  },
  {
    name: "generic inventory commits write transaction ledger rows",
    ok: files.postgres.includes("transactionLedgerEntries.push")
      && files.postgres.includes("recordTransactionLedger(client, {")
      && files.server.includes("ipAddress: options.ip_address || getSocketAddress(socket)"),
  },
  {
    name: "drop pickup, trade, and vending buy write transaction ledger rows",
    ok: files.postgres.includes('transaction_type: "ITEM_PICKUP"')
      && files.postgres.includes('transaction_type: "TRADE_COMPLETE"')
      && files.postgres.includes('transaction_type: "VENDING_BUY"'),
  },
  {
    name: "drop pickup world-drop update uses explicit PostgreSQL casts",
    ok: files.postgres.includes("SET amount = $3::bigint")
      && files.postgres.includes("CASE WHEN $3::bigint <= 0 THEN 'picked_up'")
      && files.postgres.includes("CASE WHEN $3::bigint <= 0 THEN $4::uuid"),
  },
  {
    name: "network context is passed for custom valuable actions",
    ok: files.server.includes("applyDropPickupTransaction({")
      && files.server.includes("applyTradeFinalizationTransaction({")
      && files.server.includes("applyVendBuyTransaction({")
      && files.server.includes("ip_address: getSocketAddress(socket)")
      && files.server.includes("ip_address: getSocketAddress(requesterRecord.socket)"),
  },
  {
    name: "failed/rejected valuable actions write failed ledger rows",
    ok: files.server.includes("function queueFailedTransactionLedger")
      && files.server.includes("shouldRecordFailedTransactionLedgerAction")
      && files.server.includes('status: "failed"')
      && files.server.includes("recordTransactionLedgerEvent({")
      && files.server.includes("queueFailedTransactionLedger(socket, action, message, extra);"),
  },
  {
    name: "rollback restore tool writes reversed rollback ledger rows",
    ok: files.worldSnapshotTool.includes("async function recordRollbackLedger")
      && files.worldSnapshotTool.includes('transaction_type: "ROLLBACK_RESTORE"')
      && files.worldSnapshotTool.includes('status: "reversed"')
      && files.worldSnapshotTool.includes('source: "rollback"')
      && (files.postgres.includes('if (source === "rollback")')
        || files.postgresContracts.includes('if (source === "rollback")')),
  },
  {
    name: "admin transaction ledger lookup endpoint is wired",
    ok: adminLookupSources.includes("ADMIN_TRANSACTION_LEDGER_LOOKUP_PURPOSE")
      && adminLookupSources.includes("handleAdminTransactionLedgerLookupRequest")
      && adminLookupSources.includes("buildAdminTransactionLedgerLookupRows")
      && adminLookupSources.includes("postgresStore.listTransactionLedger({"),
  },
  {
    name: "developer panel can request and render transaction ledger rows",
    ok: files.developerPanel.includes("TRANSACTION_LEDGER_LOOKUP_PURPOSE")
      && files.developerPanel.includes("request_transaction_ledger_lookup")
      && files.developerPanel.includes("handle_transaction_ledger_lookup_result")
      && files.developerPanel.includes("render_transaction_ledger_entries"),
  },
  {
    name: "client lookup router recognizes transaction ledger responses",
    ok: files.networkManager.includes("admin_transaction_ledger_lookup")
      && files.networkManager.includes('payload["transaction_type"]')
      && files.networkManager.includes('payload["item_type"]'),
  },
  {
    name: "world forwards transaction ledger lookup responses to developer panel",
    ok: files.world.includes('purpose == "admin_transaction_ledger_lookup"')
      && files.world.includes("developer_panel_ui.handle_player_state_lookup_result(request_id, data, request_context)"),
  },
  {
    name: "project rules mention permanent transaction/audit data in Postgres",
    ok: files.rules === ""
      || (files.rules.includes("item transactions and gem ledger rows")
      && files.rules.includes("trade, shop")
      && files.rules.includes("admin actions")),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[transaction-ledger-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[transaction-ledger-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[transaction-ledger-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[transaction-ledger-wiring] success");
