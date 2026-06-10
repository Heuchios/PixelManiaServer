"use strict";

const childProcess = require("child_process");
const path = require("path");
const PostgresStore = require("../postgres_store");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

try {
  require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
} catch (_) {
  // dotenv is optional; production env vars are enough on the droplet.
}

function usage(exitCode = 0) {
  console.log([
    "PixelMania explicit crash recovery tool",
    "",
    "This is a safe wrapper around rollback_apply.js world mode.",
    "It reconstructs world state from the newest snapshot before --at, then replays journal rows up to --at.",
    "",
    "Usage:",
    "  npm run world:recover -- --world START",
    "  npm run world:recover -- --world START --at now",
    "  npm run world:recover -- --world START --at \"2026-06-10 03:00:00 UTC\" --safe-only",
    "  npm run world:recover -- --world START --at now --reason \"recover after crash\" --confirm-server-stopped --apply",
    "  npm run world:recover -- --all-worlds --at now --continue-on-error",
    "",
    "Safety:",
    "  Dry-run is the default.",
    "  --apply requires --reason and --confirm-server-stopped.",
    "  Stop PM2/websocket traffic before applying, then restart after reviewing the output.",
    "  --safe-only passes through to rollback_apply.js and replays only known-safe journal source types.",
  ].join("\n"));
  process.exit(exitCode);
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanKey(value) {
  return cleanText(value).replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 120);
}

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function getOptionValues(name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return [];
  const values = [];
  for (let i = index + 1; i < args.length; i += 1) {
    const token = String(args[i] ?? "");
    if (i > index + 1 && token.startsWith("--")) break;
    values.push(token);
  }
  return values;
}

function getOptionText(name, fallback = "") {
  const value = cleanText(getOptionValues(name).join(" "));
  return value === "" ? fallback : value;
}

function normalizeTimestamp(value, name = "timestamp") {
  const raw = cleanText(value);
  if (raw === "" || raw.toLowerCase() === "now") return new Date().toISOString();
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) throw new Error(`${name} must be an ISO-like timestamp or "now".`);
  return new Date(time).toISOString();
}

function resolveConfiguredPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function createStore() {
  return new PostgresStore({
    enabled: String(process.env.POSTGRES_ENABLED || "false").trim().toLowerCase() === "true",
    autoBootstrap: String(process.env.POSTGRES_AUTO_BOOTSTRAP || "false").trim().toLowerCase() === "true",
    bootstrapSqlPath: resolveConfiguredPath(
      process.env.POSTGRES_BOOTSTRAP_SQL_PATH,
      path.join(ROOT, "docs", "postgres_security_foundation.sql")
    ),
    connectionString: cleanText(process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL || ""),
    host: cleanText(process.env.POSTGRES_HOST || ""),
    port: Math.max(1, toInt(process.env.POSTGRES_PORT, 5432)),
    database: cleanText(process.env.POSTGRES_DATABASE || ""),
    user: cleanText(process.env.POSTGRES_USER || ""),
    password: String(process.env.POSTGRES_PASSWORD || ""),
    ssl: String(process.env.POSTGRES_SSL || "false").trim().toLowerCase() === "true",
    schema: cleanText(process.env.POSTGRES_SCHEMA || "pixelmania") || "pixelmania",
    poolMax: 4,
    logger: (...items) => console.warn(...items),
  });
}

async function connectStore() {
  const store = createStore();
  await store.init();
  if (!store.isReady()) {
    await store.close();
    throw new Error("PostgreSQL is not ready. World crash recovery requires PostgreSQL authoritative data.");
  }
  return store;
}

async function listWorldNames() {
  const store = await connectStore();
  try {
    const result = await store.pool.query(
      `
      SELECT world_name::text AS world_name
        FROM ${store.table("worlds")}
       WHERE is_active = true
       ORDER BY lower(world_name::text)
      `
    );
    return result.rows.map((row) => cleanKey(row.world_name).toUpperCase()).filter(Boolean);
  } finally {
    await store.close();
  }
}

function parseJsonOutput(stdout) {
  const raw = cleanText(stdout);
  const start = raw.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(raw.slice(start));
  } catch (_) {
    return null;
  }
}

function runRollbackForWorld(worldName, options) {
  const rollbackArgs = [
    path.join(ROOT, "scripts", "rollback_apply.js"),
    "world",
    "--world",
    worldName,
    "--at",
    options.target_at,
    "--actor",
    options.actor_username,
    "--reason",
    options.reason || "explicit crash recovery dry-run",
  ];

  if (options.safe_only) rollbackArgs.push("--safe-only");
  if (options.apply) rollbackArgs.push("--apply");

  return new Promise((resolve) => {
    childProcess.execFile(process.execPath, rollbackArgs, {
      cwd: ROOT,
      env: process.env,
      maxBuffer: 128 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const parsed = parseJsonOutput(stdout);
      const summary = parsed?.plan || parsed?.result || {};
      resolve({
        world: worldName,
        ok: !error,
        dry_run: !options.apply,
        message: error ? cleanText(stderr || error.message) : "ok",
        selected_snapshot: summary.selected_snapshot || null,
        snapshot_summary: summary.snapshot_summary || null,
        restored_summary: summary.restored_summary || summary.applied_summary || null,
        journal_replay: summary.journal_replay || null,
        rollback_job_id: parsed?.rollback_job_id || null,
        stdout: parsed ? undefined : cleanText(stdout),
        stderr: cleanText(stderr),
      });
    });
  });
}

async function resolveWorldList() {
  const allWorlds = hasFlag("--all-worlds");
  const requestedWorld = cleanKey(getOptionText("--world", getOptionText("--world-name", ""))).toUpperCase();

  if (allWorlds && requestedWorld) {
    throw new Error("Use either --world or --all-worlds, not both.");
  }
  if (allWorlds) {
    const worlds = await listWorldNames();
    if (worlds.length === 0) throw new Error("No active worlds found in PostgreSQL.");
    return worlds;
  }
  if (!requestedWorld) {
    throw new Error("Choose one world with --world START or all worlds with --all-worlds.");
  }
  return [requestedWorld];
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) usage(0);

  const apply = hasFlag("--apply");
  const reason = getOptionText("--reason", "");
  if (apply && reason === "") {
    throw new Error("--apply requires a clear --reason.");
  }
  if (apply && !hasFlag("--confirm-server-stopped")) {
    throw new Error("--apply requires --confirm-server-stopped so active players cannot race the recovery.");
  }

  const options = {
    apply,
    reason,
    target_at: normalizeTimestamp(getOptionText("--at", getOptionText("--to", "now")), "--at"),
    actor_username: getOptionText("--actor", "crash_recovery_tool") || "crash_recovery_tool",
    safe_only: hasFlag("--safe-only"),
  };
  const continueOnError = hasFlag("--continue-on-error");
  const worlds = await resolveWorldList();
  const results = [];

  for (const worldName of worlds) {
    console.error(`[world-recover] ${apply ? "applying" : "planning"} ${worldName} at ${options.target_at}`);
    const result = await runRollbackForWorld(worldName, options);
    results.push(result);
    if (!result.ok && !continueOnError) break;
  }

  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    dry_run: !apply,
    apply,
    target_at: options.target_at,
    safe_only: options.safe_only,
    world_count: worlds.length,
    recovered_count: results.filter((result) => result.ok).length,
    failed_count: failed.length,
    results,
  }, null, 2));

  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`[world-recover] failed: ${error.message}`);
  process.exit(1);
});
