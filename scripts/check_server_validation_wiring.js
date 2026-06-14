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
  server: readFirst(fromBackend("server.js")),
  packageJson: readFirst(fromBackend("package.json")),
  deploy: readFirst(fromBackend("deploy_to_droplet.ps1"), false),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
};

const checks = [
  {
    name: "block break/place requests use server state, reach, permission, pace, and inventory cost validation",
    ok: files.server.includes("validateBlockUpdateAgainstServerState(socket, player, worldName, update")
      && files.server.includes("canPlayerBuildInWorld(player, worldName)")
      && files.server.includes("isPlayerNearGrid(player, update.x, update.y")
      && files.server.includes("validateBlockBreakPace(socket, player)")
      && files.server.includes("spendServerInventoryCost(player.account_username"),
  },
  {
    name: "world-based inventory actions consistently enforce world bans",
    ok: files.server.includes('rejectIfWorldBanned(socket, player, worldName, "vending")')
      && files.server.includes('rejectIfWorldBanned(socket, player, worldName, "safe")')
      && files.server.includes('rejectIfWorldBanned(socket, player, worldName, "station_recipe")')
      && files.server.includes('rejectIfWorldBanned(socket, player, worldName, "fishing_start")')
      && files.server.includes('rejectIfWorldBanned(socket, player, session.world, "fishing_complete")')
      && files.server.includes('rejectIfWorldBanned(socket, player, worldName, "fish_monger")')
      && files.server.includes('rejectIfWorldBanned(socket, player, worldName, "drop_inventory_item")')
      && files.server.includes('rejectIfWorldBanned(socket, player, worldName, "seed_place")')
      && files.server.includes('rejectIfWorldBanned(socket, player, worldName, "seed_splice")')
      && files.server.includes('rejectIfWorldBanned(socket, player, worldName, "seed_harvest")'),
  },
  {
    name: "trade requests and finalization revalidate online state, distance, world, inventory, and PostgreSQL transaction",
    ok: files.server.includes("arePlayersCloseEnoughForTrade(player, target)")
      && files.server.includes("cleanWorld(requesterRecord.player.world")
      && files.server.includes("Trade canceled because players moved too far apart.")
      && files.server.includes("validateFullTradeInventory(trade, stateA, stateB)")
      && files.server.includes("applyTradeFinalizationTransaction({"),
  },
  {
    name: "vending validates access, vendability, stock/capacity, owner, and serializes mutations",
    ok: files.server.includes("function validateVendAccess")
      && files.server.includes("canListItemInVend(itemId, itemCategory)")
      && files.server.includes("canPlayerManageVend(player, vend, worldName)")
      && files.server.includes("canAddItemToState(buyerState, listing.item_id, listing.item_category, itemAmount)")
      && files.server.includes("const worldVendActionLocks = new Set()")
      && files.server.includes("async function acquireVendMutationLock")
      && files.server.includes("acquireLiveActionLock(worldVendActionLocks, \"vend\""),
  },
  {
    name: "safes validate access, storage rules, capacity, owner, and serialize mutations",
    ok: files.server.includes("function validateSafeAccess")
      && files.server.includes("canPlayerManageSafe(player, safe, worldName)")
      && files.server.includes("canStoreItemInSafe(itemId, itemCategory)")
      && files.server.includes("findSafeMergeSlot(safe, itemId, itemCategory, amount)")
      && files.server.includes("const worldSafeActionLocks = new Set()")
      && files.server.includes("async function acquireSafeMutationLock")
      && files.server.includes("acquireLiveActionLock(worldSafeActionLocks, \"safe\""),
  },
  {
    name: "shop, station, fishing, fish monger, drops, and seeds validate server item data and capacity",
    ok: files.server.includes("SHOP_CATALOG.get(itemId)")
      && files.server.includes("validateStationAccess(socket, player, worldName, stationId, stationGrid)")
      && files.server.includes("validateFishingTarget(socket, player, worldName, grid, data)")
      && files.server.includes("validateFishMongerAccess(socket, player, data, worldName, grid)")
      && files.server.includes("ItemDatabase.isDropableItem(itemId)")
      && files.server.includes("isPlayerNearPoint(player, position.x, position.y, MAX_DROP_CREATE_DISTANCE_PIXELS)")
      && files.server.includes("requireBuildPermission(socket, player, worldName, \"edit this locked world\")"),
  },
  {
    name: "admin/developer-only actions require role and developer PIN unlock",
    ok: files.server.includes("function isAdmin(player)")
      && files.server.includes("function isDeveloperPinUnlocked(player)")
      && files.server.includes("if (!isAdmin(player))")
      && files.server.includes("if (!isDeveloperPinUnlocked(player))")
      && files.server.includes("logAdminAction(socket, player"),
  },
  {
    name: "cooldowns/rate limits and live action locks remain wired",
    ok: files.server.includes("MESSAGE_RATE_LIMITS")
      && files.server.includes("checkMessageRateLimit(socket, player")
      && files.server.includes("async function acquireLiveActionLock")
      && files.server.includes("const worldDropActionLocks = new Set()")
      && files.server.includes("acquireLiveActionLock(worldDropActionLocks, \"drop\""),
  },
  {
    name: "package security check includes server validation wiring check",
    ok: files.packageJson.includes('"check:server-validation": "node scripts/check_server_validation_wiring.js"')
      && files.packageJson.includes("npm run check:server-validation"),
  },
  {
    name: "production deploy helper ships and runs server validation wiring check",
    ok: files.deploy.includes("$localServerValidationWiringCheck")
      && files.deploy.includes("node --check scripts/check_server_validation_wiring.js")
      && files.deploy.includes("npm run check:server-validation"),
  },
  {
    name: "project docs describe server-side validation policy",
    ok: files.rules.includes("Server-Side Validation")
      && files.handoff.includes("Server-Side Validation")
      && files.handoff.includes("check:server-validation"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[server-validation-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[server-validation-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[server-validation-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[server-validation-wiring] success");
