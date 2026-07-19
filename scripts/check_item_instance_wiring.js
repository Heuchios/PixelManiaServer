// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");

/**
 * @typedef {Record<"postgres" | "server" | "inventoryTransactionHelpers" | "inventoryEconomyRoutes" | "serverTransactionSources" | "rules", string>} ItemInstanceFiles
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

/** @type {ItemInstanceFiles} */
const files = {
  postgres: readFirst(fromBackend("postgres_store.js")),
  server: readFirst(fromBackend("server.js")),
  inventoryTransactionHelpers: readFirst(fromBackend("server_inventory_transaction_helpers.js")),
  inventoryEconomyRoutes: readFirst(fromBackend("server_inventory_economy_routes.js"), false),
  serverTransactionSources: "",
  rules: readFirst([
    path.resolve(process.cwd(), "docs/backend_persistence_rules.md"),
    path.resolve(process.cwd(), "../docs/backend_persistence_rules.md"),
    path.resolve(__dirname, "../docs/backend_persistence_rules.md"),
    path.resolve(__dirname, "../../docs/backend_persistence_rules.md"),
  ], false),
};
files.serverTransactionSources = [files.server, files.inventoryEconomyRoutes].filter(Boolean).join("\n");

if (files.rules === "") {
  console.warn("[item-instance-wiring] warn: backend_persistence_rules.md was not found; code checks will still run.");
}

/** @type {WiringCheck[]} */
const checks = [
  {
    name: "tracked item source guard rejects vague strict creation",
    ok: files.postgres.includes("ITEM_INSTANCE_VAGUE_CREATION_SOURCES")
      && files.postgres.includes("missing_item_instance_source")
      && (files.server.includes("missing_item_instance_source")
      || files.inventoryTransactionHelpers.includes("missing_item_instance_source")),
  },
  {
    name: "trade moves exact tracked item instances",
    ok: files.postgres.includes("transferTrackedItemInstances(client, {")
      && files.postgres.includes('source: "trade"')
      && files.postgres.includes("trade_missing_item_instances")
      && files.postgres.includes("strict_item_instances: true"),
  },
  {
    name: "vending list/buy/payment paths move exact tracked item instances",
    ok: files.postgres.includes('source: "vending"')
      && files.postgres.includes("vending_missing_item_instances")
      && files.postgres.includes("vending_payment_missing_item_instances")
      && files.postgres.includes("from_metadata_action: \"vending_list\""),
  },
  {
    name: "world drop and pickup paths use tracked instance rows",
    ok: files.postgres.includes("createTrackedWorldDropItemInstances")
      && files.postgres.includes("claimTrackedWorldDropItemInstances")
      && files.server.includes('source: "drop_inventory"')
      && files.postgres.includes('source: "drop_pickup"'),
  },
  {
    name: "startup migration repairs item instance event tables",
    ok: files.postgres.includes('ALTER TABLE ${this.table("item_instance_events")}')
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS item_transaction_id")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS correlation_id")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS metadata")
      && files.postgres.includes("item_instance_events_event_type_check"),
  },
  {
    name: "admin give/remove uses explicit admin source",
    ok: files.server.includes('source: "admin"')
      && files.server.includes('action: "admin_give"')
      && files.server.includes('action: "admin_remove"'),
  },
  {
    name: "shop, crafting, and fishing rewards use explicit sources",
    ok: files.serverTransactionSources.includes('source: "shop"')
      && files.serverTransactionSources.includes('source: stationId === "furnace" ? "furnace" : "craft"')
      && files.serverTransactionSources.includes('source: "fishing"'),
  },
  {
    name: "raw inventory mirrors do not mint missing tracked items",
    ok: files.postgres.includes("allow_create_missing: false")
      && files.postgres.includes('source: "mirror_inventory_snapshot"'),
  },
  {
    name: "project rules require PM-ITEM rows for valuable future sources",
    ok: files.rules === ""
      || (files.rules.includes("Valuable, rare, equipment, locks, tools")
      && files.rules.includes("stable `PM-ITEM-*` public ID")
      && files.rules.includes("Create or move the specific item instance")),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[item-instance-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[item-instance-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[item-instance-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[item-instance-wiring] success");
