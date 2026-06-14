"use strict";

const path = require("path");
const PostgresStore = require("../postgres_store");

const ROOT = path.resolve(__dirname, "..");

try {
  require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
} catch (_) {
  // dotenv is optional; production env vars are enough.
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function resolveConfiguredPath(value, fallback) {
  const clean = cleanText(value);
  if (!clean) return fallback;
  return path.isAbsolute(clean) ? clean : path.resolve(ROOT, clean);
}

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return fallback;
  return cleanText(process.argv[index + 1]);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function createStore() {
  return new PostgresStore({
    enabled: true,
    autoBootstrap: String(process.env.POSTGRES_AUTO_BOOTSTRAP || "false").trim().toLowerCase() === "true",
    bootstrapSqlPath: resolveConfiguredPath(
      process.env.POSTGRES_BOOTSTRAP_SQL_PATH,
      path.join(ROOT, "docs", "postgres_security_foundation.sql")
    ),
    connectionString: String(process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL || "").trim(),
    host: String(process.env.POSTGRES_HOST || "").trim(),
    port: Math.max(1, Math.trunc(Number(process.env.POSTGRES_PORT) || 5432)),
    database: String(process.env.POSTGRES_DATABASE || "").trim(),
    user: String(process.env.POSTGRES_USER || "").trim(),
    password: String(process.env.POSTGRES_PASSWORD || ""),
    ssl: String(process.env.POSTGRES_SSL || "false").trim().toLowerCase() === "true",
    schema: String(process.env.POSTGRES_SCHEMA || "pixelmania").trim() || "pixelmania",
    poolMax: Math.max(1, Math.trunc(Number(process.env.POSTGRES_AUDIT_POOL_MAX) || 2)),
    idleTimeoutMs: Math.max(1000, Math.trunc(Number(process.env.POSTGRES_IDLE_TIMEOUT_MS) || 30000)),
    connectTimeoutMs: Math.max(1000, Math.trunc(Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS) || 8000)),
    logger: (...args) => console.warn(...args),
  });
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log([
      "PixelMania integrity hash audit",
      "",
      "Usage:",
      "  npm run integrity:hash-audit",
      "  npm run integrity:hash-audit -- --limit 200",
      "  npm run integrity:hash-audit -- --json",
      "  npm run integrity:hash-audit -- --fail-on-issues",
      "",
      "Checks:",
      "  player inventory_hash matches current inventory rows",
      "  transaction_ledger.transaction_hash matches row payload",
      "  world_snapshots.snapshot_hash matches inline snapshot JSON when present",
      "  inventory count has ledger evidence",
      "  gem balance has gem ledger evidence",
      "  rare item ownership/location is unique and sane",
      "  vending items are not also in inventory",
    ].join("\n"));
    return;
  }

  const limit = Math.min(500, Math.max(1, toInt(readArg("--limit", "100"), 100)));
  const outputJson = hasFlag("--json");
  const failOnIssues = hasFlag("--fail-on-issues");
  const store = createStore();

  try {
    await store.init();
    if (!store.isReady()) {
      throw new Error("PostgreSQL is not ready.");
    }

    const result = await store.auditIntegrityHashes({ limit });
    if (outputJson) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      console.log(`[integrity-hash-audit] status=${result.status}`);
      console.log(`[integrity-hash-audit] scanned_at=${result.scanned_at}`);
      console.log(`[integrity-hash-audit] summary=${JSON.stringify(result.summary)}`);
      const preview = (result.issues || []).slice(0, 20);
      for (const issue of preview) {
        console.log(`[integrity-hash-audit] issue=${JSON.stringify(issue)}`);
      }
      if ((result.issues || []).length > preview.length) {
        console.log(`[integrity-hash-audit] issue_preview_truncated=${(result.issues || []).length - preview.length}`);
      }
    } else {
      throw new Error(result.message || result.reason || "audit failed");
    }

    const criticalOrHigh = toInt(result.summary?.critical_issues, 0) + toInt(result.summary?.high_issues, 0);
    if (failOnIssues && criticalOrHigh > 0) {
      process.exitCode = 2;
    }
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(`[integrity-hash-audit] failed: ${error.message}`);
  process.exit(1);
});
