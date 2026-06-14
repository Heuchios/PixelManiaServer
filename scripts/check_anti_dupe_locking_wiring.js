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

function sliceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) return "";
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : -1;
  return end > start ? text.slice(start, end) : text.slice(start);
}

const files = {
  server: readFirst(fromBackend("server.js")),
  postgres: readFirst(fromBackend("postgres_store.js")),
  packageJson: readFirst(fromBackend("package.json")),
  deploy: readFirst(fromBackend("deploy_to_droplet.ps1"), false),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
  production: readFirst(fromRepoRoot("docs/production_backend_wiring.md"), false),
};

const postgresDropPickup = sliceBetween(files.postgres, "async applyDropPickupTransaction", "async applyTradeFinalizationTransaction");
const postgresTrade = sliceBetween(files.postgres, "async applyTradeFinalizationTransaction", "async applyVendBuyTransaction");
const postgresVend = sliceBetween(files.postgres, "async applyVendBuyTransaction", "async issuePunishment");
const postgresInventoryDelta = sliceBetween(files.postgres, "async applyInventoryDeltaTransaction", "async recordVendingTransaction");
const postgresTransferInstances = sliceBetween(files.postgres, "async transferTrackedItemInstances", "async claimTrackedWorldDropItemInstances");
const postgresClaimWorldDrop = sliceBetween(files.postgres, "async claimTrackedWorldDropItemInstances", "async createTrackedWorldDropItemInstances");

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
      && files.server.includes("postgresStore.applyInventoryDeltaTransaction({"),
  },
  {
    name: "drop pickup locks the drop and picker inventory around the PostgreSQL pickup transaction",
    ok: files.server.includes("const dropLock = await acquireLiveActionLock(worldDropActionLocks, \"drop\"")
      && files.server.includes("inventoryLocks = await acquirePlayerInventoryLocks([player.account_username], `drop:")
      && files.server.includes("postgresStore.applyDropPickupTransaction({")
      && files.server.includes("releasePlayerInventoryLocks(inventoryLocks)")
      && files.server.includes("releaseLiveActionLock(dropLock)"),
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
    name: "PostgreSQL drop pickup locks inventory and exact world-drop PM-ITEM rows",
    ok: postgresDropPickup.includes("return await this.withTransaction(async (client)")
      && postgresDropPickup.includes("FROM ${this.table(\"inventory\")}")
      && postgresDropPickup.includes("FOR UPDATE")
      && postgresDropPickup.includes("claimTrackedWorldDropItemInstances")
      && postgresClaimWorldDrop.includes("current_location = 'world_drop'")
      && postgresClaimWorldDrop.includes("FOR UPDATE"),
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
