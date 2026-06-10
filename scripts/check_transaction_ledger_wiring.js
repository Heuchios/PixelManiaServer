"use strict";

const fs = require("fs");
const path = require("path");

const backendRootCandidates = [
  process.cwd(),
  path.resolve(__dirname, ".."),
  path.resolve(process.cwd(), "backend"),
];

function readFirst(candidates, required = true) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }
  if (!required) return "";
  throw new Error(`Could not find required file. Checked: ${candidates.join(", ")}`);
}

function fromBackend(filename) {
  return backendRootCandidates.map((root) => path.join(root, filename));
}

function fromRepoRoot(filename) {
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(__dirname, "..", ".."),
  ];
  const expandedRoots = [];
  for (const root of roots) {
    expandedRoots.push(root);
    expandedRoots.push(path.join(root, "pixel-mania"));
  }
  return [...new Set(expandedRoots)].map((root) => path.join(root, filename));
}

const files = {
  postgres: readFirst(fromBackend("postgres_store.js")),
  server: readFirst(fromBackend("server.js")),
  worldSnapshotTool: readFirst(fromBackend("scripts/world_snapshot_tool.js"), false),
  developerPanel: readFirst(fromRepoRoot("Scripts/developer_panel_ui.gd"), false),
  networkManager: readFirst(fromRepoRoot("Scripts/network_manager.gd"), false),
  world: readFirst(fromRepoRoot("Scripts/world.gd"), false),
  schema: readFirst(fromBackend("docs/postgres_security_foundation.sql")),
  rules: readFirst([
    path.resolve(process.cwd(), "docs/backend_persistence_rules.md"),
    path.resolve(process.cwd(), "../docs/backend_persistence_rules.md"),
    path.resolve(process.cwd(), "../pixel-mania/docs/backend_persistence_rules.md"),
    path.resolve(__dirname, "../docs/backend_persistence_rules.md"),
    path.resolve(__dirname, "../../docs/backend_persistence_rules.md"),
    path.resolve(__dirname, "../../pixel-mania/docs/backend_persistence_rules.md"),
  ], false),
};

if (files.rules === "") {
  console.warn("[transaction-ledger-wiring] warn: backend_persistence_rules.md was not found; code checks will still run.");
}

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
      && files.postgres.includes("idx_transaction_ledger_player_time")
      && files.postgres.includes("transaction_ledger_status_check"),
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
      && files.server.includes("ip_address: options.ip_address || getSocketAddress(socket)"),
  },
  {
    name: "drop pickup, trade, and vending buy write transaction ledger rows",
    ok: files.postgres.includes('transaction_type: "ITEM_PICKUP"')
      && files.postgres.includes('transaction_type: "TRADE_COMPLETE"')
      && files.postgres.includes('transaction_type: "VENDING_BUY"'),
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
      && files.postgres.includes('if (source === "rollback")'),
  },
  {
    name: "admin transaction ledger lookup endpoint is wired",
    ok: files.server.includes("ADMIN_TRANSACTION_LEDGER_LOOKUP_PURPOSE")
      && files.server.includes("handleAdminTransactionLedgerLookupRequest")
      && files.server.includes("buildAdminTransactionLedgerLookupRows")
      && files.server.includes("postgresStore.listTransactionLedger({"),
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
