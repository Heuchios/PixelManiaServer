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
  return [
    path.resolve(process.cwd(), filename),
    path.resolve(process.cwd(), "..", filename),
    path.resolve(__dirname, "..", "..", filename),
  ];
}

const files = {
  postgres: readFirst(fromBackend("postgres_store.js")),
  server: readFirst(fromBackend("server.js")),
  schema: readFirst(fromBackend("docs/postgres_security_foundation.sql")),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
};

if (files.rules === "") {
  console.warn("[gem-ledger-wiring] warn: backend_persistence_rules.md was not found; code checks will still run.");
}

const checks = [
  {
    name: "gem_ledger table exists with before/after balances",
    ok: files.schema.includes("CREATE TABLE IF NOT EXISTS gem_ledger")
      && files.schema.includes("before_balance bigint")
      && files.schema.includes("after_balance bigint")
      && files.schema.includes("idx_gem_ledger_player_time"),
  },
  {
    name: "transaction_ledger can link gem ledger rows",
    ok: files.schema.includes("gem_ledger_id bigint REFERENCES gem_ledger")
      && files.postgres.includes("gem_ledger_id bigint REFERENCES ${this.table(\"gem_ledger\")}")
      && files.postgres.includes("const gemLedgerId = toInt(e.gem_ledger_id"),
  },
  {
    name: "generic inventory commits write gem ledger rows",
    ok: files.postgres.includes("const isGemLedgerRow = deltaEntry.item_type === \"gem\" || deltaEntry.item_category === \"currency\"")
      && files.postgres.includes("INSERT INTO ${this.table(\"gem_ledger\")}")
      && files.postgres.includes("gem_ledger_id: gemLedgerId")
      && files.postgres.includes("gems_before: isGemLedgerRow ? beforeAmount : null")
      && files.postgres.includes("gems_after: isGemLedgerRow ? afterAmount : null"),
  },
  {
    name: "drop pickup writes gem ledger rows for gem/currency drops",
    ok: files.postgres.includes("const isGemPickup = itemType === \"gem\" || itemCategory === \"currency\"")
      && files.postgres.includes("'drop_pickup',")
      && files.postgres.includes("gem_ledger_id: gemLedgerId")
      && files.postgres.includes("gems_before: isGemPickup ? beforeAmount : null")
      && files.postgres.includes("gems_after: isGemPickup ? afterAmount : null"),
  },
  {
    name: "trade finalization writes gem ledger rows for gem sends/receives",
    ok: files.postgres.includes("const recordTradeGemLedger = async")
      && files.postgres.includes("trade_receive")
      && files.postgres.includes("trade_send")
      && files.postgres.includes("gem_ledger_id: ledgerContext.gem_ledger_id")
      && files.postgres.includes("gems_before: isGemLedgerEntry(entry) ? entry.before_amount : null")
      && files.postgres.includes("gems_after: isGemLedgerEntry(entry) ? entry.after_amount : null"),
  },
  {
    name: "server gem sources use authoritative commit or custom Postgres transactions",
    ok: files.server.includes('source: "shop"')
      && files.server.includes('source: "fish_monger"')
      && files.server.includes('source: stationId === "furnace" ? "furnace" : "craft"')
      && files.server.includes('source: "fishing"')
      && files.server.includes('source: "admin"')
      && files.server.includes("applyDropPickupTransaction({")
      && files.server.includes("applyTradeFinalizationTransaction({"),
  },
  {
    name: "legacy JSON gem ledger mirror still mirrors to Postgres when needed",
    ok: files.server.includes("function logGemLedger")
      && files.server.includes("postgresStore.mirrorGemLedger(ledgerEntry)")
      && files.postgres.includes("mirrorGemLedger(entry)")
      && files.postgres.includes("INSERT INTO ${this.table(\"gem_ledger\")"),
  },
  {
    name: "project rules require explainable gem movement",
    ok: files.rules === ""
      || (files.rules.includes("Every gem balance change must write")
      && files.rules.includes("Gems must not be changed silently")
      && files.rules.includes("`gem_ledger` row")),
  },
  {
    name: "handoff documents gem ledger coverage",
    ok: files.handoff === ""
      || (files.handoff.includes("## Gem Ledger")
      && files.handoff.includes("trade gem sends/receives")
      && files.handoff.includes("drop pickup gem rewards")),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[gem-ledger-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[gem-ledger-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[gem-ledger-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[gem-ledger-wiring] success");
