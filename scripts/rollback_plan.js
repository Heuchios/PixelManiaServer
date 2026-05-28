const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

try {
  require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
} catch (_) {
  // dotenv is optional for this offline tool.
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
const ADMIN_LOG_PATH = resolveConfiguredPath(
  process.env.ADMIN_LOG_PATH,
  path.join(DATA_FOLDER, "admin_actions.log")
);
const ROLLBACK_PLAN_FOLDER = path.join(INTEGRITY_LOG_FOLDER, "rollback_plans");

const LOGS = {
  item: path.join(INTEGRITY_LOG_FOLDER, "item_ledger.log"),
  gem: path.join(INTEGRITY_LOG_FOLDER, "gem_ledger.log"),
  shop: path.join(INTEGRITY_LOG_FOLDER, "shop_purchases.log"),
  trade: path.join(INTEGRITY_LOG_FOLDER, "trade_transactions.log"),
  vending: path.join(INTEGRITY_LOG_FOLDER, "vending_transactions.log"),
  world: path.join(INTEGRITY_LOG_FOLDER, "world_change_journal.log"),
  security: path.join(INTEGRITY_LOG_FOLDER, "security_events.log"),
  admin: ADMIN_LOG_PATH,
};

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
  return String(value || "").trim();
}

function cleanLower(value) {
  return cleanText(value).toLowerCase();
}

function cleanWorld(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function usage(exitCode = 0) {
  console.log("PixelMania rollback planner");
  console.log("");
  console.log("Usage:");
  console.log("  npm run rollback:plan -- --source-id <id>");
  console.log("  npm run rollback:plan -- --source-type admin_give --user uso");
  console.log("  npm run rollback:plan -- --user uso --since 2026-05-27T00:00:00Z");
  console.log("  npm run rollback:plan -- --world FARM --since 2026-05-27T00:00:00Z");
  console.log("  npm run rollback:plan -- --source-id <id> --write");
  console.log("");
  console.log("Filters:");
  console.log("  --source-id ID      Match ledger/source/transaction id.");
  console.log("  --source-type TYPE  Match source/action/reason type.");
  console.log("  --user NAME         Match account/admin/buyer/seller username.");
  console.log("  --world NAME        Match world name.");
  console.log("  --since ISO         Include records at or after this time.");
  console.log("  --until ISO         Include records at or before this time.");
  console.log("  --write             Write plan JSON to integrity_logs/rollback_plans.");
  console.log("  --json              Print the whole JSON plan.");
  console.log("");
  console.log("This tool never changes player, world, inventory, gem, or account data.");
  process.exit(exitCode);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      rows.push({
        unreadable: true,
        file: filePath,
        raw: line.slice(0, 500),
        error: error.message,
      });
    }
  }
  return rows;
}

function recordTime(record) {
  const time = Date.parse(record.at || record.created_at || record.time || "");
  return Number.isFinite(time) ? time : 0;
}

function recordUsers(record) {
  return [
    record.account_username,
    record.actor_username,
    record.admin_username,
    record.target_username,
    record.requester_username,
    record.buyer_username,
    record.owner_username,
    record.seller_username,
  ].map(cleanLower).filter(Boolean);
}

function recordWorld(record) {
  return cleanWorld(record.world || record.target_world || record.world_name || "");
}

function recordSourceValues(record) {
  return [
    record.source_id,
    record.ledger_id,
    record.purchase_id,
    record.transaction_id,
    record.trade_id,
    record.journal_id,
    record.event_id,
    record.job_id,
  ].map(cleanText).filter(Boolean);
}

function recordTypeValues(record) {
  return [
    record.source_type,
    record.reason,
    record.action,
    record.event,
    record.kind,
    record.status,
    record.command,
  ].map(cleanLower).filter(Boolean);
}

function matchesFilters(record, filters) {
  if (record.unreadable) return false;

  const at = recordTime(record);
  if (filters.since && at < filters.since) return false;
  if (filters.until && at > filters.until) return false;

  if (filters.sourceId) {
    const values = recordSourceValues(record);
    const json = JSON.stringify(record);
    if (!values.includes(filters.sourceId) && !json.includes(filters.sourceId)) return false;
  }

  if (filters.sourceType) {
    const values = recordTypeValues(record);
    if (!values.some((value) => value.includes(filters.sourceType))) return false;
  }

  if (filters.user) {
    const users = recordUsers(record);
    if (!users.includes(filters.user)) return false;
  }

  if (filters.world) {
    const world = recordWorld(record);
    if (world !== filters.world) return false;
  }

  return true;
}

function groupKey(parts) {
  return parts.map((part) => cleanText(part).replace(/\|/g, "/")).join("|");
}

function addGroupedDelta(map, key, delta, extra = {}) {
  const current = map.get(key) || { ...extra, quantity_delta: 0, matching_rows: 0 };
  current.quantity_delta += delta;
  current.matching_rows += 1;
  map.set(key, current);
}

function makePlan(filters) {
  const logs = {};
  const matched = {};

  for (const [name, filePath] of Object.entries(LOGS)) {
    logs[name] = readJsonl(filePath);
    matched[name] = logs[name].filter((record) => matchesFilters(record, filters));
  }

  const itemDeltas = new Map();
  for (const row of matched.item) {
    const key = groupKey([row.account_username, row.item_id, row.item_category]);
    addGroupedDelta(itemDeltas, key, toNumber(row.quantity_delta), {
      account_username: row.account_username || "",
      item_id: row.item_id || "",
      item_category: row.item_category || "",
    });
  }

  const gemDeltas = new Map();
  for (const row of matched.gem) {
    const key = groupKey([row.account_username]);
    addGroupedDelta(gemDeltas, key, toNumber(row.quantity_delta), {
      account_username: row.account_username || "",
      item_id: "gem",
      item_category: "currency",
    });
  }

  const itemCorrections = Array.from(itemDeltas.values())
    .filter((entry) => entry.quantity_delta !== 0)
    .map((entry) => ({
      account_username: entry.account_username,
      item_id: entry.item_id,
      item_category: entry.item_category,
      observed_delta: entry.quantity_delta,
      proposed_correction_delta: -entry.quantity_delta,
      matching_rows: entry.matching_rows,
    }));

  const gemCorrections = Array.from(gemDeltas.values())
    .filter((entry) => entry.quantity_delta !== 0)
    .map((entry) => ({
      account_username: entry.account_username,
      observed_delta: entry.quantity_delta,
      proposed_correction_delta: -entry.quantity_delta,
      matching_rows: entry.matching_rows,
      note: "Gem ledger mirrors gem item ledger. Apply only once when building a real rollback.",
    }));

  const warnings = [];
  if (!filters.sourceId && !filters.sourceType && !filters.user && !filters.world && !filters.since && !filters.until) {
    warnings.push("No filters were provided. Refusing to build a broad rollback plan.");
  }
  if (matched.world.length > 0) {
    warnings.push("World changes need snapshot restore or a dedicated block replay tool. This plan lists them but does not reverse blocks.");
  }
  if (matched.trade.length > 0 || matched.vending.length > 0) {
    warnings.push("Trade and vending records may include two-sided balance changes. Review all item corrections before applying any future rollback.");
  }

  return {
    plan_id: `rollback_plan_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    generated_at: new Date().toISOString(),
    filters: {
      source_id: filters.sourceId,
      source_type: filters.sourceType,
      user: filters.user,
      world: filters.world,
      since: filters.sinceRaw,
      until: filters.untilRaw,
    },
    mode: "dry_run",
    warning_count: warnings.length,
    warnings,
    matched_counts: Object.fromEntries(Object.entries(matched).map(([name, rows]) => [name, rows.length])),
    proposed_item_corrections: itemCorrections,
    proposed_gem_corrections: gemCorrections,
    related_records: {
      shop: matched.shop,
      trade: matched.trade,
      vending: matched.vending,
      admin: matched.admin,
      security: matched.security,
      world: matched.world,
    },
  };
}

function printSummary(plan) {
  console.log("PixelMania Rollback Plan");
  console.log("========================");
  console.log(`Plan:      ${plan.plan_id}`);
  console.log(`Generated: ${plan.generated_at}`);
  console.log("Mode:      dry-run only");
  console.log("");

  console.log("Matched rows:");
  for (const [name, count] of Object.entries(plan.matched_counts)) {
    console.log(`  ${name.padEnd(8)} ${count}`);
  }

  if (plan.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of plan.warnings) console.log(`  - ${warning}`);
  }

  console.log("");
  console.log("Proposed item corrections:");
  if (plan.proposed_item_corrections.length === 0) {
    console.log("  None");
  } else {
    for (const entry of plan.proposed_item_corrections) {
      console.log(
        `  ${entry.account_username} | ${entry.item_id} | observed ${entry.observed_delta} | correction ${entry.proposed_correction_delta}`
      );
    }
  }

  console.log("");
  console.log("Proposed gem corrections:");
  if (plan.proposed_gem_corrections.length === 0) {
    console.log("  None");
  } else {
    for (const entry of plan.proposed_gem_corrections) {
      console.log(
        `  ${entry.account_username} | observed ${entry.observed_delta} | correction ${entry.proposed_correction_delta}`
      );
    }
  }
}

function writePlan(plan) {
  fs.mkdirSync(ROLLBACK_PLAN_FOLDER, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(ROLLBACK_PLAN_FOLDER, `${stamp}_${plan.plan_id}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return filePath;
}

function main() {
  if (hasFlag("--help") || hasFlag("-h")) usage(0);

  const sinceRaw = cleanText(getOption("--since", ""));
  const untilRaw = cleanText(getOption("--until", ""));
  const filters = {
    sourceId: cleanText(getOption("--source-id", "")),
    sourceType: cleanLower(getOption("--source-type", "")),
    user: cleanLower(getOption("--user", "")),
    world: cleanWorld(getOption("--world", "")),
    sinceRaw,
    untilRaw,
    since: sinceRaw ? Date.parse(sinceRaw) : 0,
    until: untilRaw ? Date.parse(untilRaw) : 0,
  };

  if (sinceRaw && !Number.isFinite(filters.since)) {
    throw new Error(`Invalid --since date: ${sinceRaw}`);
  }
  if (untilRaw && !Number.isFinite(filters.until)) {
    throw new Error(`Invalid --until date: ${untilRaw}`);
  }

  const hasFilter = Boolean(
    filters.sourceId || filters.sourceType || filters.user || filters.world || filters.since || filters.until
  );
  if (!hasFilter) usage(1);

  const plan = makePlan(filters);
  printSummary(plan);

  if (hasFlag("--write")) {
    const filePath = writePlan(plan);
    console.log("");
    console.log(`Plan written: ${filePath}`);
  }

  if (hasFlag("--json")) {
    console.log("");
    console.log(JSON.stringify(plan, null, 2));
  }
}

try {
  main();
} catch (error) {
  console.error(`Rollback planner failed: ${error.message}`);
  process.exit(1);
}
