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
  const explicitClientRoot = String(process.env.PIXELMANIA_CLIENT_DIR || "").trim();
  const roots = [
    explicitClientRoot ? path.resolve(process.cwd(), explicitClientRoot) : "",
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(__dirname, "..", ".."),
  ].filter(Boolean);
  const expandedRoots = [];
  for (const root of roots) {
    expandedRoots.push(root);
    expandedRoots.push(path.join(root, "pixel-mania"));
  }
  return [...new Set(expandedRoots)].map((root) => path.join(root, filename));
}

const files = {
  postgres: readFirst(fromBackend("postgres_store.js")),
  postgresContracts: readFirst(fromBackend("postgres_store_contracts.js"), false),
  rollbackApply: readFirst(fromBackend("scripts/rollback_apply.js")),
  rollbackPlan: readFirst(fromBackend("scripts/rollback_plan.js"), false),
  worldSnapshotTool: readFirst(fromBackend("scripts/world_snapshot_tool.js"), false),
  restoreCheck: readFirst(fromBackend("scripts/postgres_restore_check.sh"), false),
  packageJson: readFirst(fromBackend("package.json")),
  deploy: require("./release_deployment_test_helpers").readDeploymentCoverage(path.resolve(__dirname, "..")),
  schema: readFirst(fromBackend("docs/postgres_security_foundation.sql")),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
  production: readFirst(fromRepoRoot("docs/production_backend_wiring.md"), false),
};

const rollbackJobSchema = (
  files.schema.match(/CREATE TABLE IF NOT EXISTS rollback_jobs \([\s\S]*?\);/) || [""]
)[0];

const checks = [
  {
    name: "rollback_jobs table and indexes exist in bootstrap schema",
    ok: rollbackJobSchema.includes("rollback_type text NOT NULL")
      && rollbackJobSchema.includes("'player', 'world', 'item', 'transaction'")
      && rollbackJobSchema.includes("target_transaction_ledger_id bigint")
      && files.schema.includes("idx_rollback_jobs_type_time")
      && files.schema.includes("idx_rollback_jobs_status_time"),
  },
  {
    name: "startup migration creates rollback_jobs table and source=rollback item transactions",
    ok: files.postgres.includes('CREATE TABLE IF NOT EXISTS ${this.table("rollback_jobs")}')
      && files.postgres.includes("idx_rollback_jobs_type_time")
      && files.postgres.includes("'rollback'")
      && (files.postgres.includes("if (source === \"rollback\")")
        || files.postgresContracts.includes("if (source === \"rollback\")")),
  },
  {
    name: "rollback apply tool exposes player, world, item, and transaction modes",
    ok: files.rollbackApply.includes("PixelMania rollback apply tool")
      && files.rollbackApply.includes('rollback_type: "player"')
      && files.rollbackApply.includes('rollback_type: "world"')
      && files.rollbackApply.includes('rollback_type: "item"')
      && files.rollbackApply.includes('rollback_type: "transaction"')
      && files.rollbackApply.includes("Dry-run is the default")
      && files.rollbackApply.includes("--apply requires a non-empty --reason"),
  },
  {
    name: "player rollback reverses inventory/gems and marks original ledger rows reversed",
    ok: files.rollbackApply.includes("async function buildPlayerPlan")
      && files.rollbackApply.includes("async function applyPlayerPlan")
      && files.rollbackApply.includes("player_time_rollback")
      && files.rollbackApply.includes('transaction_type: "ROLLBACK_PLAYER"')
      && files.rollbackApply.includes("markTransactionLedgerRowsReversed"),
  },
  {
    name: "world rollback restores snapshots and leaves rollback journal evidence",
    ok: files.rollbackApply.includes("async function buildWorldPlan")
      && files.rollbackApply.includes("async function applyWorldPlan")
      && files.rollbackApply.includes('INSERT INTO ${store.table("world_snapshots")}')
      && files.rollbackApply.includes("await store.upsertWorldState")
      && files.rollbackApply.includes('INSERT INTO ${store.table("world_object_changes")}')
      && files.rollbackApply.includes("rollback_snapshot_restore")
      && files.rollbackApply.includes("ROLLBACK_WORLD_SNAPSHOT")
      && files.rollbackApply.includes("const rollbackTransactionType"),
  },
  {
    name: "world rollback supports exact timestamp recovery through journal replay",
    ok: files.rollbackApply.includes("--at 2026-06-07T00:00:00Z")
      && files.rollbackApply.includes("async function loadWorldJournalReplayRows")
      && files.rollbackApply.includes("function replayWorldJournal")
      && files.rollbackApply.includes("rollback_journal_replay_restore")
      && files.rollbackApply.includes("ROLLBACK_WORLD_JOURNAL_REPLAY")
      && files.rollbackApply.includes("target_at"),
  },
  {
    name: "world rollback normalizes PostgreSQL snapshot timestamps before SQL filters",
    ok: files.rollbackApply.includes("function normalizeTimestampValue")
      && files.rollbackApply.includes("created_at: normalizeTimestampValue(row.created_at")
      && files.rollbackApply.includes("const ledgerCutoffAt = plan.target_at || plan.selected_snapshot.created_at || null")
      && files.rollbackApply.includes("[currentWorld.world_id, ledgerCutoffAt]"),
  },
  {
    name: "item rollback moves exact PM-ITEM rows and writes rollback ledger rows",
    ok: files.rollbackApply.includes("async function buildItemPlan")
      && files.rollbackApply.includes("async function applyItemPlan")
      && files.rollbackApply.includes("async function moveItemInstance")
      && files.rollbackApply.includes('transaction_type: "ROLLBACK_ITEM"')
      && files.rollbackApply.includes('source: "rollback"')
      && files.rollbackApply.includes("rollback_applied: true"),
  },
  {
    name: "transaction reversal applies inverse deltas and reverses originals",
    ok: files.rollbackApply.includes("async function buildTransactionPlan")
      && files.rollbackApply.includes("async function applyTransactionPlan")
      && files.rollbackApply.includes("transaction_reversal")
      && files.rollbackApply.includes('transaction_type: "ROLLBACK_TRANSACTION_REVERSE"')
      && files.rollbackApply.includes("UPDATE ${store.table(\"transaction_ledger\")}")
      && files.rollbackApply.includes("status = 'reversed'"),
  },
  {
    name: "rollback corrections carry explicit admin correction metadata",
    ok: files.rollbackApply.includes("admin_corrected: true")
      && files.rollbackApply.includes("rollback_applied: true")
      && files.rules.includes("admin_corrected")
      && files.handoff.includes("admin_corrected")
      && files.production.includes("admin_corrected"),
  },
  {
    name: "world snapshot restore tool still writes reversed rollback ledger rows",
    ok: files.worldSnapshotTool.includes("async function recordRollbackLedger")
      && files.worldSnapshotTool.includes('transaction_type: "ROLLBACK_RESTORE"')
      && files.worldSnapshotTool.includes('status: "reversed"')
      && files.worldSnapshotTool.includes('source: "rollback"')
      && files.worldSnapshotTool.includes("admin_corrected: true"),
  },
  {
    name: "package scripts include rollback apply and rollback check",
    ok: files.packageJson.includes('"rollback:apply": "node scripts/rollback_apply.js"')
      && files.packageJson.includes('"check:rollback": "node scripts/check_rollback_wiring.js"')
      && files.packageJson.includes("npm run check:rollback"),
  },
  {
    name: "production deploy helper ships rollback scripts and runs rollback check",
    ok: files.deploy.includes("$localRollbackApply")
      && files.deploy.includes("$localRollbackPlan")
      && files.deploy.includes("$localWorldSnapshotTool")
      && files.deploy.includes("$localRollbackWiringCheck")
      && files.deploy.includes("node --check scripts/rollback_apply.js")
      && files.deploy.includes("npm run check:rollback"),
  },
  {
    name: "restore check includes rollback_jobs count",
    ok: files.restoreCheck.includes("rollback_jobs="),
  },
  {
    name: "project docs describe rollback policy and current status",
    ok: files.rules.includes("Rollback System")
      && files.rules.includes("rollback_jobs")
      && files.handoff.includes("Rollback System")
      && files.handoff.includes("rollback:apply")
      && files.production.includes("Rollback tooling"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[rollback-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[rollback-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[rollback-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[rollback-wiring] success");
