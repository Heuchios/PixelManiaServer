const fs = require("fs");
const path = require("path");
const readline = require("readline");
const ItemDb = require("../server_item_database");

const ROOT = path.resolve(__dirname, "..");

try {
  require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
} catch (_) {
  // dotenv is optional for this scanner; server defaults still work without it.
}

function resolveConfiguredPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

const DATA_FOLDER = resolveConfiguredPath(process.env.PIXELMANIA_DATA_DIR, ROOT);
const PLAYER_SAVE_FOLDER = resolveConfiguredPath(
  process.env.PLAYER_SAVE_FOLDER,
  path.join(DATA_FOLDER, "players")
);
const WORLD_SAVE_FOLDER = resolveConfiguredPath(
  process.env.WORLD_SAVE_FOLDER,
  path.join(DATA_FOLDER, "worlds")
);
const ACCOUNTS_SAVE_PATH = resolveConfiguredPath(
  process.env.ACCOUNTS_SAVE_PATH,
  path.join(DATA_FOLDER, "accounts.json")
);
const ADMIN_LOG_PATH = resolveConfiguredPath(
  process.env.ADMIN_LOG_PATH,
  path.join(DATA_FOLDER, "admin_actions.log")
);
const INTEGRITY_LOG_FOLDER = resolveConfiguredPath(
  process.env.INTEGRITY_LOG_FOLDER,
  path.join(DATA_FOLDER, "integrity_logs")
);

const LOG_FILES = [
  ["admin", ADMIN_LOG_PATH],
  ["security", path.join(INTEGRITY_LOG_FOLDER, "security_events.log")],
  ["item", path.join(INTEGRITY_LOG_FOLDER, "item_ledger.log")],
  ["gem", path.join(INTEGRITY_LOG_FOLDER, "gem_ledger.log")],
  ["shop", path.join(INTEGRITY_LOG_FOLDER, "shop_purchases.log")],
  ["trade", path.join(INTEGRITY_LOG_FOLDER, "trade_transactions.log")],
  ["vending", path.join(INTEGRITY_LOG_FOLDER, "vending_transactions.log")],
  ["world", path.join(INTEGRITY_LOG_FOLDER, "world_change_journal.log")],
  ["rollback", path.join(INTEGRITY_LOG_FOLDER, "rollback_jobs.log")],
];

const INVENTORY_FIELDS = Object.values(ItemDb.CATEGORY_TO_FIELD || {});
const VALID_ROLES = new Set(["player", "moderator", "mod", "admin", "developer", "owner"]);
const VEND_BLOCKS = new Set(["vend_empty", "vend_pending", "vend_sold"]);
const STORAGE_BLOCKS = new Set(["safe", ...VEND_BLOCKS]);

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function getOption(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cleanName(value) {
  return cleanText(value).toLowerCase();
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { __read_error: error.message };
  }
}

function listJsonFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder)
    .filter((file) => file.toLowerCase().endsWith(".json"))
    .map((file) => path.join(folder, file));
}

function amountFromValue(value) {
  if (typeof value === "number") return value;
  if (!value || typeof value !== "object") return null;
  for (const key of ["quantity", "amount", "count", "qty"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return Number(value[key]);
  }
  return null;
}

function itemCategory(itemId) {
  const definition = ItemDb.getItemDefinition(itemId);
  return definition ? definition.category : "";
}

function itemField(itemId) {
  return ItemDb.getInventoryFieldForItem(itemId) || "";
}

function positionKey(entry) {
  return `${Math.trunc(Number(entry.x))},${Math.trunc(Number(entry.y))}`;
}

function blockType(entry) {
  return cleanText(entry.block_type || entry.item_id || entry.type || entry.foreground_item_id);
}

function usage() {
  console.log("PixelMania integrity scanner");
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/integrity_scan.js");
  console.log("  node scripts/integrity_scan.js --write-report");
  console.log("  node scripts/integrity_scan.js --world FARM --limit 100");
  console.log("  node scripts/integrity_scan.js --user uso --json");
  console.log("");
  console.log("Flags:");
  console.log("  --write-report  Save a JSON report to integrity_logs/integrity_scan_reports.");
  console.log("  --json          Print the full report as JSON.");
  console.log("  --strict        Exit with code 1 when warnings exist.");
  console.log("  --limit N       Human output issue limit. Default 80.");
  console.log("  --world NAME    Only scan matching world save files.");
  console.log("  --user NAME     Only scan matching player save files/account rows.");
}

function makeReport() {
  return {
    generated_at: new Date().toISOString(),
    paths: {
      data_folder: DATA_FOLDER,
      accounts: ACCOUNTS_SAVE_PATH,
      players: PLAYER_SAVE_FOLDER,
      worlds: WORLD_SAVE_FOLDER,
      integrity_logs: INTEGRITY_LOG_FOLDER,
    },
    filters: {
      user: cleanName(getOption("--user")),
      world: cleanName(getOption("--world")),
    },
    summary: {
      accounts: 0,
      players: 0,
      worlds: 0,
      log_files_checked: 0,
      errors: 0,
      warnings: 0,
      notices: 0,
      issues: 0,
    },
    issues: [],
  };
}

function addIssue(report, severity, code, file, message, details = {}) {
  const normalized = severity === "error" ? "error" : severity === "notice" ? "notice" : "warning";
  report.summary.issues += 1;
  if (normalized === "error") report.summary.errors += 1;
  if (normalized === "warning") report.summary.warnings += 1;
  if (normalized === "notice") report.summary.notices += 1;
  report.issues.push({
    severity: normalized,
    code,
    file,
    message,
    details,
  });
}

function accountsFromData(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.accounts)) return data.accounts;
  if (data && typeof data === "object") {
    return Object.values(data).filter((value) => value && typeof value === "object");
  }
  return [];
}

function scanAccounts(report) {
  if (!fs.existsSync(ACCOUNTS_SAVE_PATH)) {
    addIssue(report, "notice", "accounts_missing", ACCOUNTS_SAVE_PATH, "No accounts file found.");
    return;
  }

  const data = safeReadJson(ACCOUNTS_SAVE_PATH);
  if (data.__read_error) {
    addIssue(report, "error", "accounts_unreadable", ACCOUNTS_SAVE_PATH, data.__read_error);
    return;
  }

  const usernames = new Map();
  const emails = new Map();
  for (const account of accountsFromData(data)) {
    const username = cleanName(account.username || account.name);
    const email = cleanName(account.email);
    if (report.filters.user && username !== report.filters.user) continue;

    report.summary.accounts += 1;

    if (!username) {
      addIssue(report, "error", "account_missing_username", ACCOUNTS_SAVE_PATH, "Account is missing username.", { email });
    } else if (usernames.has(username)) {
      addIssue(report, "error", "account_duplicate_username", ACCOUNTS_SAVE_PATH, "Duplicate account username.", { username });
    } else {
      usernames.set(username, true);
    }

    if (!email) {
      addIssue(report, "warning", "account_missing_email", ACCOUNTS_SAVE_PATH, "Account is missing email.", { username });
    } else if (emails.has(email)) {
      addIssue(report, "error", "account_duplicate_email", ACCOUNTS_SAVE_PATH, "Duplicate account email.", { email });
    } else {
      emails.set(email, true);
    }

    if (!cleanText(account.password_hash)) {
      addIssue(report, "error", "account_missing_password_hash", ACCOUNTS_SAVE_PATH, "Account is missing password_hash.", { username });
    }
    if (!cleanText(account.password_salt)) {
      addIssue(report, "warning", "account_missing_password_salt", ACCOUNTS_SAVE_PATH, "Account is missing password_salt.", { username });
    }
    for (const badField of ["password", "plain_password", "raw_password", "pass"]) {
      if (Object.prototype.hasOwnProperty.call(account, badField)) {
        addIssue(report, "error", "account_plain_password_field", ACCOUNTS_SAVE_PATH, "Account contains a plaintext password-like field.", {
          username,
          field: badField,
        });
      }
    }

    const role = cleanName(account.role || "player");
    if (role && !VALID_ROLES.has(role)) {
      addIssue(report, "warning", "account_unknown_role", ACCOUNTS_SAVE_PATH, "Account has an unknown role.", { username, role });
    }
  }
}

function scanInventoryBucket(report, filePath, username, field, bucket) {
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
    if (bucket !== undefined) {
      addIssue(report, "warning", "player_inventory_bucket_invalid", filePath, "Inventory bucket is not an object.", { username, field });
    }
    return;
  }

  for (const [itemId, rawAmount] of Object.entries(bucket)) {
    const amount = amountFromValue(rawAmount);
    if (!ItemDb.hasItem(itemId)) {
      addIssue(report, "error", "player_unknown_item", filePath, "Player inventory contains an item ID missing from server_item_database.", {
        username,
        field,
        item_id: itemId,
        amount,
      });
      continue;
    }

    const expectedField = itemField(itemId);
    if (expectedField && expectedField !== field) {
      addIssue(report, "warning", "player_item_wrong_bucket", filePath, "Item is stored in a different inventory bucket than its server category.", {
        username,
        item_id: itemId,
        actual_field: field,
        expected_field: expectedField,
      });
    }

    if (!Number.isFinite(amount)) {
      addIssue(report, "error", "player_item_amount_invalid", filePath, "Item quantity is not a number.", { username, field, item_id: itemId });
      continue;
    }
    if (!Number.isInteger(amount)) {
      addIssue(report, "warning", "player_item_amount_fractional", filePath, "Item quantity is not an integer.", {
        username,
        field,
        item_id: itemId,
        amount,
      });
    }
    if (amount < 0) {
      addIssue(report, "error", "player_item_amount_negative", filePath, "Item quantity is negative.", {
        username,
        field,
        item_id: itemId,
        amount,
      });
    }

    const stackLimit = ItemDb.getStackLimit(itemId);
    if (amount > stackLimit) {
      addIssue(report, "warning", "player_item_over_stack_limit", filePath, "Item quantity is above its stack limit.", {
        username,
        field,
        item_id: itemId,
        amount,
        stack_limit: stackLimit,
      });
    }
  }
}

function scanPlayerFile(report, filePath) {
  const data = safeReadJson(filePath);
  if (data.__read_error) {
    addIssue(report, "error", "player_file_unreadable", filePath, data.__read_error);
    return;
  }

  const username = cleanName(data.username || data.name || path.basename(filePath, ".json"));
  if (report.filters.user && username !== report.filters.user) return;
  report.summary.players += 1;

  const playerData = data.player_data && typeof data.player_data === "object" ? data.player_data : data;
  if (!playerData || typeof playerData !== "object") {
    addIssue(report, "error", "player_data_missing", filePath, "Player save is missing player_data.");
    return;
  }

  for (const field of INVENTORY_FIELDS) {
    scanInventoryBucket(report, filePath, username, field, playerData[field]);
  }

  const hotbar = Array.isArray(playerData.hotbar) ? playerData.hotbar : [];
  for (const slot of hotbar) {
    const itemId = cleanText(slot && (slot.item_id || slot.item_type || slot.id));
    if (itemId && itemId !== "punch" && !ItemDb.hasItem(itemId)) {
      addIssue(report, "warning", "player_hotbar_unknown_item", filePath, "Hotbar references an unknown item.", { username, item_id: itemId });
    }
  }

  const equipmentFields = [
    "selected_item",
    "equipped_tool",
    "equipped_back",
    "equipped_shirt",
    "equipped_pants",
    "tool",
    "back",
    "shirt",
    "pants",
  ];
  for (const field of equipmentFields) {
    const itemId = cleanText(playerData[field]);
    if (itemId && itemId !== "punch" && itemId !== "none" && !ItemDb.hasItem(itemId)) {
      addIssue(report, "warning", "player_equipment_unknown_item", filePath, "Equipment field references an unknown item.", {
        username,
        field,
        item_id: itemId,
      });
    }
  }

  const gemAmount = amountFromValue(playerData.currency_inventory && playerData.currency_inventory.gem);
  if (Number.isFinite(gemAmount) && gemAmount < 0) {
    addIssue(report, "error", "player_negative_gems", filePath, "Player gem balance is negative.", { username, gems: gemAmount });
  }
}

function scanPlayers(report) {
  if (!fs.existsSync(PLAYER_SAVE_FOLDER)) {
    addIssue(report, "notice", "players_folder_missing", PLAYER_SAVE_FOLDER, "No players folder found.");
    return;
  }
  for (const filePath of listJsonFiles(PLAYER_SAVE_FOLDER)) {
    scanPlayerFile(report, filePath);
  }
}

function scanBlockArray(report, filePath, worldName, blocks, layer, seenCells) {
  if (!Array.isArray(blocks)) {
    if (blocks !== undefined) {
      addIssue(report, "warning", "world_block_array_invalid", filePath, "World block list is not an array.", { world: worldName, layer });
    }
    return;
  }

  for (const block of blocks) {
    const x = Number(block && block.x);
    const y = Number(block && block.y);
    const type = blockType(block || {});
    const key = `${Math.trunc(x)},${Math.trunc(y)}`;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      addIssue(report, "error", "world_block_position_invalid", filePath, "World block has invalid coordinates.", { world: worldName, layer, block });
      continue;
    }

    if (seenCells.has(key)) {
      addIssue(report, "error", "world_duplicate_cell", filePath, "World has multiple blocks in the same cell/layer.", {
        world: worldName,
        layer,
        cell: key,
      });
    } else {
      seenCells.add(key);
    }

    if (!type) {
      addIssue(report, "error", "world_block_missing_type", filePath, "World block is missing block_type.", { world: worldName, layer, cell: key });
    } else if (!ItemDb.hasItem(type)) {
      addIssue(report, "error", "world_unknown_block", filePath, "World contains a block ID missing from server_item_database.", {
        world: worldName,
        layer,
        cell: key,
        block_type: type,
      });
    } else if (itemCategory(type) !== "block") {
      addIssue(report, "error", "world_non_block_in_blocks", filePath, "World block list contains a non-block item.", {
        world: worldName,
        layer,
        cell: key,
        item_id: type,
        category: itemCategory(type),
      });
    }
  }
}

function mapBlocksByCell(blocks) {
  const map = new Map();
  if (!Array.isArray(blocks)) return map;
  for (const block of blocks) {
    const x = Number(block && block.x);
    const y = Number(block && block.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    map.set(positionKey(block), block);
  }
  return map;
}

function scanWorldInteractions(report, filePath, worldName, interactions, foregroundMap, worldLocked) {
  if (!Array.isArray(interactions)) {
    if (interactions !== undefined) {
      addIssue(report, "warning", "world_interactions_invalid", filePath, "World interactions is not an array.", { world: worldName });
    }
    return;
  }

  for (const interaction of interactions) {
    const action = cleanText(interaction && interaction.action);
    const x = Number(interaction && interaction.x);
    const y = Number(interaction && interaction.y);
    const cell = `${Math.trunc(x)},${Math.trunc(y)}`;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      addIssue(report, "warning", "world_interaction_position_invalid", filePath, "Interaction has invalid coordinates.", { world: worldName, action });
      continue;
    }

    if (action === "vend_state") {
      const block = foregroundMap.get(cell);
      if (!block || !VEND_BLOCKS.has(blockType(block))) {
        addIssue(report, "warning", "vend_state_without_vend_block", filePath, "Vending interaction exists without a vending block at the same cell.", {
          world: worldName,
          cell,
        });
      }
      if (!worldLocked) {
        addIssue(report, "error", "vend_in_unlocked_world", filePath, "Vending machine state exists in an unlocked world.", { world: worldName, cell });
      }

      const listing = interaction.listing && typeof interaction.listing === "object" ? interaction.listing : {};
      const itemId = cleanText(listing.item_id || listing.item_type || interaction.item_id);
      if (itemId && !ItemDb.hasItem(itemId)) {
        addIssue(report, "error", "vend_unknown_item", filePath, "Vending listing references an unknown item.", { world: worldName, cell, item_id: itemId });
      }

      for (const [field, label] of [
        ["stock", "stock"],
        ["amount_per_sale", "amount per sale"],
        ["price_wls", "price"],
      ]) {
        const value = Number(listing[field] ?? interaction[field]);
        if (itemId && (!Number.isFinite(value) || value <= 0)) {
          addIssue(report, "error", "vend_invalid_listing_number", filePath, `Vending listing has invalid ${label}.`, {
            world: worldName,
            cell,
            field,
            value,
          });
        }
      }
    }

    if (action === "safe_state") {
      const block = foregroundMap.get(cell);
      if (!block || blockType(block) !== "safe") {
        addIssue(report, "warning", "safe_state_without_safe_block", filePath, "Safe interaction exists without a safe block at the same cell.", {
          world: worldName,
          cell,
        });
      }
      if (!worldLocked) {
        addIssue(report, "error", "safe_in_unlocked_world", filePath, "Safe state exists in an unlocked world.", { world: worldName, cell });
      }

      const slots = Array.isArray(interaction.slots) ? interaction.slots : [];
      if (slots.length > 10) {
        addIssue(report, "warning", "safe_too_many_slots", filePath, "Safe has more than 10 stored slots.", { world: worldName, cell, slots: slots.length });
      }
      for (const slot of slots) {
        const itemId = cleanText(slot && (slot.item_id || slot.item_type));
        const amount = Number(slot && (slot.amount || slot.quantity || slot.count));
        if (!itemId || !ItemDb.hasItem(itemId)) {
          addIssue(report, "error", "safe_unknown_item", filePath, "Safe slot references an unknown item.", { world: worldName, cell, item_id: itemId });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          addIssue(report, "error", "safe_invalid_amount", filePath, "Safe slot has invalid amount.", { world: worldName, cell, item_id: itemId, amount });
        }
      }
    }
  }
}

function scanWorldDrops(report, filePath, worldName, drops) {
  if (!Array.isArray(drops)) {
    if (drops !== undefined) {
      addIssue(report, "warning", "world_drops_invalid", filePath, "World drops is not an array.", { world: worldName });
    }
    return;
  }

  const dropIds = new Set();
  for (const drop of drops) {
    const dropId = cleanText(drop && drop.drop_id);
    const itemId = cleanText(drop && (drop.item_id || drop.item_type));
    const amount = Number(drop && (drop.amount || drop.quantity || drop.count || 1));

    if (dropId) {
      if (dropIds.has(dropId)) {
        addIssue(report, "error", "drop_duplicate_id", filePath, "Two floating drops share the same drop_id.", { world: worldName, drop_id: dropId });
      }
      dropIds.add(dropId);
    }

    if (!itemId || !ItemDb.hasItem(itemId)) {
      addIssue(report, "error", "drop_unknown_item", filePath, "Floating drop references an unknown item.", { world: worldName, item_id: itemId, drop_id: dropId });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      addIssue(report, "error", "drop_invalid_amount", filePath, "Floating drop has invalid amount.", { world: worldName, item_id: itemId, amount, drop_id: dropId });
    }
  }
}

function scanWorldSeeds(report, filePath, worldName, seeds) {
  if (!Array.isArray(seeds)) {
    if (seeds !== undefined) {
      addIssue(report, "warning", "world_seeds_invalid", filePath, "World seeds is not an array.", { world: worldName });
    }
    return;
  }

  for (const seedEntry of seeds) {
    const seedType = cleanText(seedEntry && (seedEntry.seed_type || seedEntry.item_id));
    const block = cleanText(seedEntry && seedEntry.block_type);
    if (seedType && !ItemDb.hasItem(seedType)) {
      addIssue(report, "error", "seed_unknown_seed_item", filePath, "Seed entry references an unknown seed item.", { world: worldName, seed_type: seedType });
    }
    if (block && !ItemDb.hasItem(block)) {
      addIssue(report, "error", "seed_unknown_block_item", filePath, "Seed entry references an unknown grown block.", { world: worldName, block_type: block });
    }
  }
}

function scanWorldFile(report, filePath) {
  const data = safeReadJson(filePath);
  if (data.__read_error) {
    addIssue(report, "error", "world_file_unreadable", filePath, data.__read_error);
    return;
  }

  const worldName = cleanName(data.world_name || path.basename(filePath, ".json"));
  if (report.filters.world && worldName !== report.filters.world) return;
  report.summary.worlds += 1;

  const foregroundSeen = new Set();
  const backgroundSeen = new Set();
  scanBlockArray(report, filePath, worldName, data.blocks || [], "foreground", foregroundSeen);
  scanBlockArray(report, filePath, worldName, data.background_blocks || [], "background", backgroundSeen);

  const foregroundMap = mapBlocksByCell(data.blocks || []);
  const worldLockBlocks = [];
  const storageBlocks = [];
  for (const [cell, block] of foregroundMap.entries()) {
    const type = blockType(block);
    if (type === "world_lock") worldLockBlocks.push({ cell, block });
    if (STORAGE_BLOCKS.has(type)) storageBlocks.push({ cell, type });
  }

  if (worldLockBlocks.length > 1) {
    addIssue(report, "error", "world_multiple_locks", filePath, "World has more than one world lock block.", {
      world: worldName,
      locks: worldLockBlocks.map((entry) => entry.cell),
    });
  }

  const worldLock = data.world_lock && typeof data.world_lock === "object" ? data.world_lock : {};
  const isLocked = Boolean(worldLock.is_locked);
  if (isLocked) {
    const lockCell = `${Math.trunc(Number(worldLock.lock_grid_x))},${Math.trunc(Number(worldLock.lock_grid_y))}`;
    const lockBlock = foregroundMap.get(lockCell);
    if (!lockBlock || blockType(lockBlock) !== "world_lock") {
      addIssue(report, "error", "world_lock_metadata_without_block", filePath, "World lock metadata points to a missing world_lock block.", {
        world: worldName,
        lock_cell: lockCell,
      });
    }
  } else if (storageBlocks.length > 0) {
    addIssue(report, "error", "storage_blocks_in_unlocked_world", filePath, "Safe or vending blocks exist in an unlocked world.", {
      world: worldName,
      storage_blocks: storageBlocks,
    });
  }

  scanWorldInteractions(report, filePath, worldName, data.interactions || [], foregroundMap, isLocked);
  scanWorldDrops(report, filePath, worldName, data.drops || []);
  scanWorldSeeds(report, filePath, worldName, data.seeds || []);
}

function scanWorlds(report) {
  if (!fs.existsSync(WORLD_SAVE_FOLDER)) {
    addIssue(report, "notice", "worlds_folder_missing", WORLD_SAVE_FOLDER, "No worlds folder found.");
    return;
  }
  for (const filePath of listJsonFiles(WORLD_SAVE_FOLDER)) {
    scanWorldFile(report, filePath);
  }
}

async function checkJsonlFile(report, label, filePath) {
  if (!fs.existsSync(filePath)) {
    addIssue(report, "notice", "log_missing", filePath, "Log file does not exist yet.", { log: label });
    return;
  }

  report.summary.log_files_checked += 1;
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let badLines = 0;
  for await (const line of rl) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      JSON.parse(line);
    } catch (error) {
      badLines += 1;
      if (badLines <= 10) {
        addIssue(report, "warning", "log_malformed_json", filePath, "JSONL log has a malformed row.", {
          log: label,
          line: lineNumber,
          error: error.message,
        });
      }
    }
  }

  if (badLines > 10) {
    addIssue(report, "warning", "log_malformed_json_more", filePath, "JSONL log has additional malformed rows.", { log: label, count: badLines });
  }
}

async function scanLogs(report) {
  for (const [label, filePath] of LOG_FILES) {
    await checkJsonlFile(report, label, filePath);
  }
}

function writeReport(report) {
  const folder = path.join(INTEGRITY_LOG_FOLDER, "integrity_scan_reports");
  fs.mkdirSync(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(folder, `${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  return filePath;
}

function printHumanReport(report, reportPath = "") {
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(getOption("--limit", "80")) || 80)));
  console.log("PixelMania Integrity Scan");
  console.log("=========================");
  console.log(`Generated: ${report.generated_at}`);
  console.log(`Data:      ${report.paths.data_folder}`);
  console.log(`Players:   ${report.summary.players}`);
  console.log(`Worlds:    ${report.summary.worlds}`);
  console.log(`Accounts:  ${report.summary.accounts}`);
  console.log(`Logs:      ${report.summary.log_files_checked} checked`);
  console.log(`Issues:    ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.notices} notices`);
  if (reportPath) console.log(`Report:    ${reportPath}`);
  console.log("");

  if (report.issues.length === 0) {
    console.log("No integrity issues found.");
    return;
  }

  for (const issue of report.issues.slice(0, limit)) {
    console.log(`[${issue.severity.toUpperCase()}] ${issue.code}`);
    console.log(`  ${issue.message}`);
    console.log(`  file: ${issue.file}`);
    const detailKeys = Object.keys(issue.details || {});
    if (detailKeys.length > 0) console.log(`  details: ${JSON.stringify(issue.details)}`);
  }

  if (report.issues.length > limit) {
    console.log("");
    console.log(`Showing ${limit} of ${report.issues.length} issues. Re-run with --limit ${report.issues.length} or --json for all.`);
  }
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    usage();
    return;
  }

  const report = makeReport();
  scanAccounts(report);
  scanPlayers(report);
  scanWorlds(report);
  await scanLogs(report);

  const reportPath = hasFlag("--write-report") ? writeReport(report) : "";
  if (hasFlag("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report, reportPath);
  }

  if (report.summary.errors > 0 || (hasFlag("--strict") && report.summary.warnings > 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
