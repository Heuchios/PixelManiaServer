const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

try {
  require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
} catch (_) {
  // dotenv is optional for this offline report tool.
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
const REPORT_FOLDER = path.join(INTEGRITY_LOG_FOLDER, "admin_integrity_reports");

const LOGS = {
  admin: ADMIN_LOG_PATH,
  security: path.join(INTEGRITY_LOG_FOLDER, "security_events.log"),
  item: path.join(INTEGRITY_LOG_FOLDER, "item_ledger.log"),
  gem: path.join(INTEGRITY_LOG_FOLDER, "gem_ledger.log"),
  shop: path.join(INTEGRITY_LOG_FOLDER, "shop_purchases.log"),
  trade: path.join(INTEGRITY_LOG_FOLDER, "trade_transactions.log"),
  vending: path.join(INTEGRITY_LOG_FOLDER, "vending_transactions.log"),
  world: path.join(INTEGRITY_LOG_FOLDER, "world_change_journal.log"),
  rollback: path.join(INTEGRITY_LOG_FOLDER, "rollback_jobs.log"),
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
  return String(value || "").replace(/\s+/g, " ").trim();
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

function signed(value) {
  const number = Math.trunc(toNumber(value));
  return number > 0 ? `+${number}` : String(number);
}

function timeStamp(record) {
  return cleanText(record.at || record.created_at || record.time);
}

function parseTime(record) {
  const parsed = Date.parse(timeStamp(record));
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeShort(record) {
  const stamp = timeStamp(record);
  if (stamp.length >= 19) return stamp.slice(0, 19).replace("T", " ");
  return stamp || "unknown time";
}

function short(value, width) {
  const text = cleanText(value);
  if (text.length <= width) return text.padEnd(width, " ");
  return `${text.slice(0, Math.max(0, width - 3))}...`;
}

function plural(value, word) {
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

function usage(exitCode = 0) {
  console.log("PixelMania admin integrity report");
  console.log("");
  console.log("Usage:");
  console.log("  npm run integrity:admin-report");
  console.log("  npm run integrity:admin-report -- --hours 6");
  console.log("  npm run integrity:admin-report -- --user uso --limit 20");
  console.log("  npm run integrity:admin-report -- --world FARM --write");
  console.log("");
  console.log("Filters:");
  console.log("  --hours N              Look back this many hours. Default 24.");
  console.log("  --since ISO            Include records at or after this time.");
  console.log("  --until ISO            Include records at or before this time.");
  console.log("  --user NAME            Match actor/account/target username.");
  console.log("  --world NAME           Match world name.");
  console.log("  --limit N              Rows per section. Default 12.");
  console.log("  --max-lines N          Max tail lines per log. Default 20000.");
  console.log("  --item-threshold N     Flag item deltas at/above this amount. Default 100.");
  console.log("  --gem-threshold N      Flag gem deltas at/above this amount. Default 1000.");
  console.log("  --write                Save JSON report to integrity_logs/admin_integrity_reports.");
  console.log("  --json                 Print full JSON report after the readable summary.");
  console.log("");
  console.log("This tool is read-only. It never changes accounts, worlds, inventory, gems, or logs.");
  process.exit(exitCode);
}

function readLastLines(filePath, desiredLines) {
  if (!fs.existsSync(filePath)) return [];
  const stats = fs.statSync(filePath);
  if (stats.size === 0) return [];

  const fd = fs.openSync(filePath, "r");
  const chunks = [];
  const chunkSize = 128 * 1024;
  let position = stats.size;
  let newlineCount = 0;

  try {
    while (position > 0 && newlineCount <= desiredLines) {
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

  const lines = Buffer.concat(chunks)
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  return lines.slice(-desiredLines);
}

function readLogRecords(filePath, maxLines) {
  const rows = [];
  const malformed = [];
  const lines = readLastLines(filePath, maxLines);

  for (let i = 0; i < lines.length; i += 1) {
    try {
      rows.push(JSON.parse(lines[i]));
    } catch (error) {
      malformed.push({
        line_from_tail: i + 1,
        error: error.message,
        sample: lines[i].slice(0, 160),
      });
    }
  }

  return {
    exists: fs.existsSync(filePath),
    file_path: filePath,
    rows,
    malformed,
  };
}

function recordUsers(record) {
  return [
    record.actor_username,
    record.account_username,
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

function matchesFilters(record, filters) {
  const at = parseTime(record);
  if (filters.since && at < filters.since) return false;
  if (filters.until && at > filters.until) return false;

  if (filters.user && !recordUsers(record).includes(filters.user)) return false;
  if (filters.world && recordWorld(record) !== filters.world) return false;
  return true;
}

function newestFirst(rows) {
  return [...rows].sort((a, b) => parseTime(b) - parseTime(a));
}

function topEntries(map, limit) {
  return Array.from(map.values())
    .sort((a, b) => Math.abs(b.total_delta || b.count || 0) - Math.abs(a.total_delta || a.count || 0))
    .slice(0, limit);
}

function addCounter(map, key, base, delta = 1) {
  const current = map.get(key) || { ...base, count: 0, total_delta: 0 };
  current.count += 1;
  current.total_delta += delta;
  map.set(key, current);
}

function sourceKey(record) {
  return cleanText(record.source_id || record.purchase_id || record.transaction_id || record.trade_id || record.journal_id || record.event_id);
}

function summarizeItemRows(rows, thresholds, limit) {
  const bigChanges = [];
  const byAccount = new Map();
  const bySource = new Map();

  for (const row of rows) {
    const delta = toNumber(row.quantity_delta);
    if (Math.abs(delta) >= thresholds.item) bigChanges.push(row);

    const account = cleanLower(row.account_username || "unknown");
    addCounter(byAccount, account, { account_username: row.account_username || "unknown" }, Math.abs(delta));

    const source = sourceKey(row);
    if (source) {
      addCounter(bySource, source, {
        source_id: source,
        source_type: row.source_type || row.reason || "",
        account_username: row.account_username || "",
      }, Math.abs(delta));
    }
  }

  return {
    count: rows.length,
    big_changes: newestFirst(bigChanges).slice(0, limit),
    busiest_accounts: topEntries(byAccount, limit),
    busiest_sources: topEntries(bySource, limit),
  };
}

function summarizeGemRows(rows, thresholds, limit) {
  const bigChanges = [];
  const byAccount = new Map();

  for (const row of rows) {
    const delta = toNumber(row.quantity_delta);
    if (Math.abs(delta) >= thresholds.gem) bigChanges.push(row);
    const account = cleanLower(row.account_username || "unknown");
    addCounter(byAccount, account, { account_username: row.account_username || "unknown" }, Math.abs(delta));
  }

  return {
    count: rows.length,
    big_changes: newestFirst(bigChanges).slice(0, limit),
    busiest_accounts: topEntries(byAccount, limit),
  };
}

function summarizeAdminRows(rows, limit) {
  const denied = rows.filter((row) => row.ok === false || cleanLower(row.status).includes("denied"));
  const dangerousWords = ["give", "remove", "ban", "kick", "mute", "clear", "reset", "rollback", "teleport", "warp", "gem"];
  const powerful = rows.filter((row) => {
    const text = `${row.action || ""} ${row.command || ""} ${row.message || ""}`.toLowerCase();
    return dangerousWords.some((word) => text.includes(word));
  });

  return {
    count: rows.length,
    recent: newestFirst(rows).slice(0, limit),
    denied: newestFirst(denied).slice(0, limit),
    powerful: newestFirst(powerful).slice(0, limit),
  };
}

function summarizeSecurityRows(rows, limit) {
  const highRisk = rows.filter((row) => {
    const severity = cleanLower(row.severity);
    const text = `${row.event || ""} ${row.reason || ""} ${JSON.stringify(row.details || {})}`.toLowerCase();
    return severity === "error" || severity === "critical" || severity === "warning" || text.includes("denied") || text.includes("invalid");
  });

  return {
    count: rows.length,
    recent: newestFirst(rows).slice(0, limit),
    high_risk: newestFirst(highRisk).slice(0, limit),
  };
}

function summarizeWorldRows(rows, limit) {
  const byWorld = new Map();
  const lockChanges = [];
  const storageChanges = [];
  const riskyBlocks = new Set(["world_lock", "safe", "vend_empty", "vend_pending", "vend_sold"]);

  for (const row of rows) {
    const world = recordWorld(row) || "UNKNOWN";
    addCounter(byWorld, world, { world }, 1);

    const block = cleanLower(row.block_type || (row.details && row.details.block_type));
    const action = cleanLower(row.action);
    if (block === "world_lock" || action.includes("world_lock")) lockChanges.push(row);
    if (riskyBlocks.has(block)) storageChanges.push(row);
  }

  return {
    count: rows.length,
    busiest_worlds: topEntries(byWorld, limit),
    world_lock_changes: newestFirst(lockChanges).slice(0, limit),
    storage_block_changes: newestFirst(storageChanges).slice(0, limit),
  };
}

function summarizeTransactions(rows, limit) {
  return {
    count: rows.length,
    recent: newestFirst(rows).slice(0, limit),
  };
}

function makeRollbackCandidates(report, limit) {
  const candidates = [];

  for (const row of report.sections.item.big_changes) {
    candidates.push({
      priority: Math.abs(toNumber(row.quantity_delta)),
      reason: "large_item_delta",
      user: row.account_username || "",
      item_id: row.item_id || "",
      delta: toNumber(row.quantity_delta),
      source_type: row.source_type || "",
      source_id: sourceKey(row),
      command: `npm run rollback:plan -- --source-id ${sourceKey(row) || "<source_id>"}`,
    });
  }

  for (const row of report.sections.gem.big_changes) {
    candidates.push({
      priority: Math.abs(toNumber(row.quantity_delta)),
      reason: "large_gem_delta",
      user: row.account_username || "",
      delta: toNumber(row.quantity_delta),
      source_type: row.source_type || "",
      source_id: sourceKey(row),
      command: `npm run rollback:plan -- --source-id ${sourceKey(row) || "<source_id>"}`,
    });
  }

  for (const row of report.sections.admin.powerful) {
    candidates.push({
      priority: 1,
      reason: "admin_action_review",
      user: row.target_username || row.account_username || "",
      admin: row.admin_username || row.actor_username || "",
      action: row.action || row.command || "",
      source_id: sourceKey(row),
      command: row.target_username
        ? `npm run rollback:plan -- --user ${row.target_username}`
        : "Review admin action row before planning rollback.",
    });
  }

  return candidates
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

function makeReport(filters, options) {
  const loaded = {};
  const filtered = {};
  const missingLogs = [];
  const malformedLogs = [];

  for (const [name, filePath] of Object.entries(LOGS)) {
    loaded[name] = readLogRecords(filePath, options.maxLines);
    if (!loaded[name].exists) missingLogs.push({ log: name, file_path: filePath });
    for (const malformed of loaded[name].malformed) {
      malformedLogs.push({ log: name, file_path: filePath, ...malformed });
    }
    filtered[name] = loaded[name].rows.filter((row) => matchesFilters(row, filters));
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: "read_only",
    paths: {
      data_folder: DATA_FOLDER,
      integrity_logs: INTEGRITY_LOG_FOLDER,
      admin_log: ADMIN_LOG_PATH,
    },
    filters: {
      user: filters.user,
      world: filters.world,
      since: filters.sinceRaw,
      until: filters.untilRaw,
    },
    options,
    log_status: {
      missing: missingLogs,
      malformed: malformedLogs,
      scanned_tail_lines_per_log: options.maxLines,
    },
    counts: Object.fromEntries(Object.entries(filtered).map(([name, rows]) => [name, rows.length])),
    sections: {
      admin: summarizeAdminRows(filtered.admin, options.limit),
      security: summarizeSecurityRows(filtered.security, options.limit),
      item: summarizeItemRows(filtered.item, options, options.limit),
      gem: summarizeGemRows(filtered.gem, options, options.limit),
      shop: summarizeTransactions(filtered.shop, options.limit),
      trade: summarizeTransactions(filtered.trade, options.limit),
      vending: summarizeTransactions(filtered.vending, options.limit),
      world: summarizeWorldRows(filtered.world, options.limit),
      rollback: summarizeTransactions(filtered.rollback, options.limit),
    },
  };

  report.rollback_candidates = makeRollbackCandidates(report, options.limit);
  return report;
}

function printSection(title) {
  console.log("");
  console.log(title);
  console.log("-".repeat(title.length));
}

function printRows(rows, formatter, emptyMessage = "None") {
  if (!rows || rows.length === 0) {
    console.log(`  ${emptyMessage}`);
    return;
  }
  for (const row of rows) console.log(`  ${formatter(row)}`);
}

function formatAdmin(row) {
  return `${timeShort(row)} | ${short(row.admin_username || row.actor_username, 12)} | ${short(row.action || row.command, 24)} | ${cleanText(row.message || row.target_username || "")}`;
}

function formatSecurity(row) {
  return `${timeShort(row)} | ${short(row.severity || "notice", 8)} | ${short(row.actor_username, 12)} | ${short(row.event, 28)} | ${cleanText(JSON.stringify(row.details || {})).slice(0, 90)}`;
}

function formatItem(row) {
  return `${timeShort(row)} | ${short(row.account_username, 12)} | ${short(row.item_id, 18)} | ${short(signed(row.quantity_delta), 8)} | ${short(row.source_type, 20)} | ${sourceKey(row)}`;
}

function formatGem(row) {
  return `${timeShort(row)} | ${short(row.account_username, 12)} | ${short(signed(row.quantity_delta), 8)} | balance ${short(row.balance_after, 10)} | ${short(row.source_type, 20)} | ${sourceKey(row)}`;
}

function formatWorld(row) {
  const xy = row.x !== undefined && row.y !== undefined ? `${row.x},${row.y}` : "";
  return `${timeShort(row)} | ${short(row.actor_username, 12)} | ${short(row.world, 10)} | ${short(row.action, 22)} | ${short(xy, 8)} | ${short(row.block_type, 18)}`;
}

function formatCandidate(row) {
  return `${short(row.reason, 20)} | ${short(row.user || row.admin, 12)} | ${short(row.item_id || row.action || row.source_type, 18)} | ${short(row.delta === undefined ? "" : signed(row.delta), 8)} | ${row.command}`;
}

function printHumanReport(report, reportPath = "") {
  console.log("PixelMania Admin Integrity Report");
  console.log("=================================");
  console.log(`Generated: ${report.generated_at}`);
  console.log(`Mode:      ${report.mode}`);
  console.log(`Window:    ${report.filters.since || "beginning of scanned log"} -> ${report.filters.until || "now"}`);
  if (report.filters.user) console.log(`User:      ${report.filters.user}`);
  if (report.filters.world) console.log(`World:     ${report.filters.world}`);
  if (reportPath) console.log(`Saved:     ${reportPath}`);
  console.log("");
  console.log("Counts:");
  for (const [name, count] of Object.entries(report.counts)) {
    console.log(`  ${name.padEnd(8)} ${count}`);
  }

  if (report.log_status.missing.length > 0) {
    printSection("Missing Logs");
    for (const row of report.log_status.missing) {
      console.log(`  ${row.log}: ${row.file_path}`);
    }
  }

  if (report.log_status.malformed.length > 0) {
    printSection("Malformed Log Rows");
    for (const row of report.log_status.malformed.slice(0, report.options.limit)) {
      console.log(`  ${row.log}: ${row.error}`);
    }
  }

  printSection("Recent Admin Actions");
  printRows(report.sections.admin.recent, formatAdmin);

  printSection("Powerful Admin Actions");
  printRows(report.sections.admin.powerful, formatAdmin);

  printSection("Security Events To Review");
  printRows(report.sections.security.high_risk, formatSecurity);

  printSection(`Large Item Changes (${report.options.item}+)`);
  printRows(report.sections.item.big_changes, formatItem);

  printSection(`Large Gem Changes (${report.options.gem}+)`);
  printRows(report.sections.gem.big_changes, formatGem);

  printSection("World Lock / Storage Changes");
  printRows([...report.sections.world.world_lock_changes, ...report.sections.world.storage_block_changes].slice(0, report.options.limit), formatWorld);

  printSection("Rollback Candidates");
  printRows(report.rollback_candidates, formatCandidate, "No obvious rollback candidates in this window.");

  printSection("Suggested Next Commands");
  console.log("  npm run logs:admin -- --limit 20");
  console.log("  npm run logs:security -- --limit 20");
  console.log("  npm run rollback:plan -- --source-id <source_id> --write");
  console.log("  npm run integrity:scan -- --strict");
}

function writeReport(report) {
  fs.mkdirSync(REPORT_FOLDER, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(REPORT_FOLDER, `${stamp}_admin_integrity_report.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return filePath;
}

function main() {
  if (hasFlag("--help") || hasFlag("-h")) usage(0);

  const hours = toNumber(getOption("--hours", "24"), 24);
  const sinceRaw = cleanText(getOption("--since", ""));
  const untilRaw = cleanText(getOption("--until", ""));
  const since = sinceRaw ? Date.parse(sinceRaw) : Date.now() - Math.max(0, hours) * 60 * 60 * 1000;
  const until = untilRaw ? Date.parse(untilRaw) : 0;

  if (!Number.isFinite(since)) throw new Error(`Invalid --since date: ${sinceRaw}`);
  if (untilRaw && !Number.isFinite(until)) throw new Error(`Invalid --until date: ${untilRaw}`);

  const filters = {
    user: cleanLower(getOption("--user", "")),
    world: cleanWorld(getOption("--world", "")),
    since,
    until,
    sinceRaw: sinceRaw || new Date(since).toISOString(),
    untilRaw,
  };
  const options = {
    limit: Math.max(1, Math.min(100, Math.trunc(toNumber(getOption("--limit", "12"), 12)))),
    maxLines: Math.max(100, Math.min(250000, Math.trunc(toNumber(getOption("--max-lines", "20000"), 20000)))),
    item: Math.max(1, Math.trunc(toNumber(getOption("--item-threshold", "100"), 100))),
    gem: Math.max(1, Math.trunc(toNumber(getOption("--gem-threshold", "1000"), 1000))),
  };

  const report = makeReport(filters, options);
  const reportPath = hasFlag("--write") ? writeReport(report) : "";
  printHumanReport(report, reportPath);

  if (hasFlag("--json")) {
    console.log("");
    console.log(JSON.stringify(report, null, 2));
  }
}

try {
  main();
} catch (error) {
  console.error(`Admin integrity report failed: ${error.message}`);
  process.exit(1);
}
