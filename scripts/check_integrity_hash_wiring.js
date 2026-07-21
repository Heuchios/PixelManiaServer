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
  postgres: readFirst(fromBackend("postgres_store.js")),
  rollbackApply: readFirst(fromBackend("scripts/rollback_apply.js")),
  auditScript: readFirst(fromBackend("scripts/integrity_hash_audit.js")),
  schema: readFirst(fromBackend("docs/postgres_security_foundation.sql")),
  packageJson: readFirst(fromBackend("package.json")),
  deploy: require("./release_deployment_test_helpers").readDeploymentCoverage(path.resolve(__dirname, "..")),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
};

const checks = [
  {
    name: "bootstrap schema stores integrity hash columns and audit runs",
    ok: files.schema.includes("inventory_hash")
      && files.schema.includes("transaction_hash")
      && files.schema.includes("snapshot_hash")
      && files.schema.includes("integrity_audit_runs"),
  },
  {
    name: "Postgres migrations add integrity hash columns and indexes",
    ok: files.postgres.includes("INTEGRITY_HASH_ALGORITHM")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS inventory_hash")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS transaction_hash")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS snapshot_hash")
      && files.postgres.includes("idx_transaction_ledger_hash")
      && files.postgres.includes("idx_integrity_audit_runs_type_time"),
  },
  {
    name: "transaction ledger rows receive deterministic transaction hashes",
    ok: files.postgres.includes("function buildTransactionLedgerHashPayload")
      && files.postgres.includes("function buildTransactionLedgerHash")
      && files.postgres.includes("transaction_hash_algorithm")
      && files.postgres.includes("PostgresStore.buildTransactionLedgerHash"),
  },
  {
    name: "player inventory hash is refreshed from authoritative inventory rows",
    ok: files.postgres.includes("async updatePlayerInventoryHash")
      && files.postgres.includes("await this.updatePlayerInventoryHash(client, playerId")
      && files.postgres.includes("await this.updatePlayerInventoryHash(client, requesterId")
      && files.postgres.includes("await this.updatePlayerInventoryHash(client, buyerId"),
  },
  {
    name: "world snapshots store stable snapshot_hash",
    ok: files.postgres.includes("const snapshotHash = integrityHash(snapshotData)")
      && files.postgres.includes("snapshot_hash_algorithm")
      && files.postgres.includes("snapshot_hash,"),
  },
  {
    name: "Postgres audit checks stored hashes and economy consistency",
    ok: files.postgres.includes("async auditIntegrityHashes")
      && files.postgres.includes("inventory_hash_mismatch")
      && files.postgres.includes("transaction_hash_mismatch")
      && files.postgres.includes("world_snapshot_hash_mismatch")
      && files.postgres.includes("gem_ledger_balance_mismatch")
      && files.postgres.includes("vending_instance_also_in_inventory"),
  },
  {
    name: "rollback updates hashes after legitimate reversals and inventory corrections",
    ok: files.rollbackApply.includes("PostgresStore.buildTransactionLedgerHash")
      && files.rollbackApply.includes("transaction_hash_algorithm")
      && files.rollbackApply.includes("store.updatePlayerInventoryHash"),
  },
  {
    name: "CLI audit command is available",
    ok: files.auditScript.includes("auditIntegrityHashes")
      && files.auditScript.includes("--fail-on-issues")
      && files.packageJson.includes("\"integrity:hash-audit\"")
      && files.packageJson.includes("\"check:integrity-hashes\""),
  },
  {
    name: "deploy helper ships and verifies integrity hash scripts",
    ok: files.deploy === ""
      || (files.deploy.includes("localIntegrityHashAudit")
      && files.deploy.includes("localIntegrityHashWiringCheck")
      && files.deploy.includes("check:integrity-hashes")),
  },
  {
    name: "project docs mention integrity hash rules and current status",
    ok: files.rules.includes("Integrity Hashes")
      && files.handoff.includes("Integrity hashes are wired"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[integrity-hash-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[integrity-hash-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[integrity-hash-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[integrity-hash-wiring] success");
