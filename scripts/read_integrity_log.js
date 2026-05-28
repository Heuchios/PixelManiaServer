const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
try {
  require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
} catch (_) {
  // dotenv is optional for this viewer; server defaults still work without it.
}

function resolveConfiguredPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

const DATA_FOLDER = resolveConfiguredPath(process.env.PIXELMANIA_DATA_DIR, ROOT);
const INTEGRITY_LOG_FOLDER = resolveConfiguredPath(
  process.env.INTEGRITY_LOG_FOLDER,
  path.join(DATA_FOLDER, "integrity_logs")
);

const LOGS = {
  item: path.join(INTEGRITY_LOG_FOLDER, "item_ledger.log"),
  items: path.join(INTEGRITY_LOG_FOLDER, "item_ledger.log"),
  gem: path.join(INTEGRITY_LOG_FOLDER, "gem_ledger.log"),
  gems: path.join(INTEGRITY_LOG_FOLDER, "gem_ledger.log"),
  shop: path.join(INTEGRITY_LOG_FOLDER, "shop_purchases.log"),
  trade: path.join(INTEGRITY_LOG_FOLDER, "trade_transactions.log"),
  trades: path.join(INTEGRITY_LOG_FOLDER, "trade_transactions.log"),
  vend: path.join(INTEGRITY_LOG_FOLDER, "vending_transactions.log"),
  vending: path.join(INTEGRITY_LOG_FOLDER, "vending_transactions.log"),
  world: path.join(INTEGRITY_LOG_FOLDER, "world_change_journal.log"),
  rollback: path.join(INTEGRITY_LOG_FOLDER, "rollback_jobs.log"),
  rollbacks: path.join(INTEGRITY_LOG_FOLDER, "rollback_jobs.log"),
  security: path.join(INTEGRITY_LOG_FOLDER, "security_events.log"),
  admin: resolveConfiguredPath(process.env.ADMIN_LOG_PATH, path.join(DATA_FOLDER, "admin_actions.log")),
};

const args = process.argv.slice(2);
const logName = String(args[0] || "item").toLowerCase();

function usage() {
  console.log("PixelMania readable integrity logs");
  console.log("");
  console.log("Usage:");
  console.log("  node scripts/read_integrity_log.js item --limit 20");
  console.log("  node scripts/read_integrity_log.js world --world FARM --limit 40");
  console.log("  node scripts/read_integrity_log.js item --user uso --contains world_lock");
  console.log("");
  console.log("Logs:");
  console.log("  item, gem, shop, trade, vending, world, rollback, security, admin");
  console.log("");
  console.log("Filters:");
  console.log("  --limit N       Number of matching rows to show. Default 25.");
  console.log("  --user NAME     Match actor/account/target username.");
  console.log("  --world NAME    Match world.");
  console.log("  --action NAME   Match action/source/reason.");
  console.log("  --contains TEXT Match anywhere in the record.");
  console.log("  --json          Pretty-print each matching JSON record.");
}

function getOption(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function short(value, width) {
  const text = cleanText(value);
  if (text.length <= width) return text.padEnd(width, " ");
  return `${text.slice(0, Math.max(0, width - 3))}...`;
}

function timeOnly(value) {
  const text = cleanText(value);
  if (text.length >= 19) return text.slice(11, 19);
  return text;
}

function signed(value) {
  const number = Math.trunc(Number(value) || 0);
  return number > 0 ? `+${number}` : String(number);
}

function formatDetails(details) {
  if (!details || typeof details !== "object") return "";
  const parts = [];
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      parts.push(`${key}:${value.length}`);
    } else if (typeof value === "object") {
      parts.push(`${key}:{...}`);
    } else {
      parts.push(`${key}:${value}`);
    }
  }
  return parts.join(" ");
}

function formatRewards(rewards) {
  if (!Array.isArray(rewards)) return "";
  return rewards
    .map((reward) => `${reward.item_id || "item"} x${reward.amount || 0}`)
    .join(", ");
}

function formatOffers(offers) {
  if (!Array.isArray(offers)) return "";
  return offers
    .map((item) => `${item.item_id || "item"}x${item.amount || 0}`)
    .join(", ");
}

function readLastLines(filePath, desiredLines) {
  if (!fs.existsSync(filePath)) return [];
  const stats = fs.statSync(filePath);
  if (stats.size === 0) return [];

  const fd = fs.openSync(filePath, "r");
  const chunks = [];
  const chunkSize = 64 * 1024;
  let position = stats.size;
  let newlineCount = 0;

  try {
    while (position > 0 && newlineCount <= desiredLines * 4) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, position);
      chunks.unshift(buffer);
      for (let i = 0; i < readSize; i += 1) {
        if (buffer[i] === 10) newlineCount += 1;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return Buffer.concat(chunks)
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
}

function recordMatches(record, filters) {
  const jsonText = JSON.stringify(record).toLowerCase();
  if (filters.contains && !jsonText.includes(filters.contains)) return false;

  if (filters.world) {
    const world = cleanText(record.world || record.target_world).toLowerCase();
    if (world !== filters.world) return false;
  }

  if (filters.user) {
    const users = [
      record.actor_username,
      record.account_username,
      record.admin_username,
      record.target_username,
      record.requester_username,
      record.buyer_username,
      record.owner_username,
    ].map((value) => cleanText(value).toLowerCase());
    if (!users.some((value) => value === filters.user)) return false;
  }

  if (filters.action) {
    const actions = [
      record.action,
      record.source_type,
      record.reason,
      record.command,
      record.event,
      record.kind,
      record.status,
    ].map((value) => cleanText(value).toLowerCase());
    if (!actions.some((value) => value.includes(filters.action))) return false;
  }

  return true;
}

function rowFor(record, kind) {
  if (kind === "item" || kind === "items" || kind === "gem" || kind === "gems") {
    return [
      short(timeOnly(record.at), 8),
      short(record.account_username, 12),
      short(record.item_id || "gem", 18),
      short(signed(record.quantity_delta), 7),
      short(record.balance_after, 8),
      short(record.source_type, 18),
      short(record.reason, 16),
      short(record.world, 10),
      short(formatDetails(record.details), 34),
    ].join("  ");
  }

  if (kind === "world") {
    return [
      short(timeOnly(record.at), 8),
      short(record.actor_username, 12),
      short(record.world, 10),
      short(record.action, 22),
      short(record.layer, 10),
      short(record.x === null ? "" : `${record.x},${record.y}`, 8),
      short(record.block_type, 18),
      short(formatDetails(record.details), 42),
    ].join("  ");
  }

  if (kind === "shop") {
    return [
      short(timeOnly(record.at), 8),
      short(record.account_username, 12),
      short(record.listing_id, 18),
      short(record.item_id, 18),
      short(`-${record.price_gems}`, 8),
      short(record.gem_balance_after, 8),
      short(formatRewards(record.rewards), 44),
    ].join("  ");
  }

  if (kind === "trade" || kind === "trades") {
    return [
      short(timeOnly(record.at), 8),
      short(record.status, 10),
      short(record.requester_username, 12),
      short("<->", 3),
      short(record.target_username, 12),
      short(formatOffers(record.requester_offer), 32),
      short(formatOffers(record.target_offer), 32),
    ].join("  ");
  }

  if (kind === "vend" || kind === "vending") {
    return [
      short(timeOnly(record.at), 8),
      short(record.action, 12),
      short(record.world, 10),
      short(`${record.x},${record.y}`, 8),
      short(record.owner_username, 12),
      short(record.buyer_username, 12),
      short(record.item_id, 18),
      short(`x${record.amount}`, 8),
      short(`${record.price_wls} WL`, 9),
      short(`stock:${record.stock_after}`, 10),
      short(`pending:${record.pending_wls_after}`, 12),
    ].join("  ");
  }

  if (kind === "security") {
    return [
      short(timeOnly(record.at), 8),
      short(record.severity, 8),
      short(record.actor_username, 12),
      short(record.world, 10),
      short(record.event, 28),
      short(formatDetails(record.details), 52),
    ].join("  ");
  }

  if (kind === "rollback" || kind === "rollbacks") {
    return [
      short(timeOnly(record.at), 8),
      short(record.status, 10),
      short(record.kind, 22),
      short(record.target_world, 12),
      short(record.actor_username || record.actor || "tool", 14),
      short(record.reason, 24),
      short(formatDetails(record.details), 52),
    ].join("  ");
  }

  if (kind === "admin") {
    return [
      short(timeOnly(record.at), 8),
      short(record.ok ? "ok" : "denied", 7),
      short(record.admin_username, 12),
      short(record.action, 24),
      short(record.message, 46),
    ].join("  ");
  }

  return JSON.stringify(record);
}

function headerFor(kind) {
  if (kind === "item" || kind === "items" || kind === "gem" || kind === "gems") {
    return "TIME      ACCOUNT       ITEM                DELTA    BALANCE   SOURCE              REASON            WORLD       DETAILS";
  }
  if (kind === "world") {
    return "TIME      ACTOR         WORLD       ACTION                  LAYER       XY        BLOCK              DETAILS";
  }
  if (kind === "shop") {
    return "TIME      ACCOUNT       LISTING            ITEM              PRICE    BALANCE   REWARDS";
  }
  if (kind === "trade" || kind === "trades") {
    return "TIME      STATUS      REQUESTER     <->  TARGET       REQUESTER OFFER                   TARGET OFFER";
  }
  if (kind === "vend" || kind === "vending") {
    return "TIME      ACTION        WORLD       XY        OWNER        BUYER        ITEM                AMOUNT    PRICE     STOCK      PENDING";
  }
  if (kind === "security") {
    return "TIME      SEVERITY  ACTOR         WORLD       EVENT                         DETAILS";
  }
  if (kind === "rollback" || kind === "rollbacks") {
    return "TIME      STATUS      KIND                    WORLD        ACTOR          REASON                    DETAILS";
  }
  if (kind === "admin") {
    return "TIME      STATUS   ADMIN        ACTION                    MESSAGE";
  }
  return "";
}

function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    usage();
    return;
  }

  const logPath = LOGS[logName];
  if (!logPath) {
    console.error(`Unknown log "${logName}".`);
    usage();
    process.exitCode = 1;
    return;
  }

  const limit = Math.max(1, Math.min(500, Math.trunc(Number(getOption("--limit", "25")) || 25)));
  const filters = {
    user: cleanText(getOption("--user")).toLowerCase(),
    world: cleanText(getOption("--world")).toLowerCase(),
    action: cleanText(getOption("--action")).toLowerCase(),
    contains: cleanText(getOption("--contains")).toLowerCase(),
  };

  const lines = readLastLines(logPath, Math.max(limit, 1000));
  const records = [];
  for (let i = lines.length - 1; i >= 0 && records.length < limit; i -= 1) {
    try {
      const record = JSON.parse(lines[i]);
      if (recordMatches(record, filters)) records.push(record);
    } catch (_) {
      // Skip corrupt or partial lines; append-only logs can be mid-write.
    }
  }

  const newestFirst = records;
  if (newestFirst.length === 0) {
    console.log(`No matching ${logName} log rows found at: ${logPath}`);
    return;
  }

  console.log(`Showing ${newestFirst.length} newest ${logName} rows from ${logPath}`);
  console.log("");

  if (hasFlag("--json")) {
    for (const record of newestFirst) console.log(JSON.stringify(record, null, 2));
    return;
  }

  const header = headerFor(logName);
  if (header) {
    console.log(header);
    console.log("-".repeat(Math.min(140, header.length)));
  }
  for (const record of newestFirst) console.log(rowFor(record, logName));
}

main();
