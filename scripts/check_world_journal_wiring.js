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
  serverPhase8WorldActionRoutes: readFirst(fromBackend("server_phase8_world_action_routes.js"), false),
  serverPhase8FinalRoutes: readFirst(fromBackend("server_phase8_final_routes.js"), false),
  schema: readFirst(fromBackend("docs/postgres_security_foundation.sql")),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
};
files.serverRouteSources = [
  files.server,
  files.serverPhase8WorldActionRoutes,
  files.serverPhase8FinalRoutes,
].join("\n");

const worldBlockSchema = (
  files.schema.match(/CREATE TABLE IF NOT EXISTS world_block_changes \([\s\S]*?\);/) || [""]
)[0];
const worldObjectSchema = (
  files.schema.match(/CREATE TABLE IF NOT EXISTS world_object_changes \([\s\S]*?\);/) || [""]
)[0];

const checks = [
  {
    name: "world_block_changes records before and after block values",
    ok: worldBlockSchema.includes("block_type_before text")
      && worldBlockSchema.includes("block_type_after text")
      && worldBlockSchema.includes("reason text")
      && files.postgres.includes("block_type_before")
      && files.postgres.includes("block_type_after"),
  },
  {
    name: "world_object_changes table and indexes exist",
    ok: worldObjectSchema.includes("old_data jsonb")
      && worldObjectSchema.includes("new_data jsonb")
      && worldObjectSchema.includes("reason text")
      && files.schema.includes("idx_world_object_changes_object_time")
      && files.postgres.includes('CREATE TABLE IF NOT EXISTS ${this.table("world_object_changes")}'),
  },
  {
    name: "Postgres routes block and object journal entries separately",
    ok: files.postgres.includes("async insertWorldObjectChange")
      && files.postgres.includes("async recordWorldChangeEntry")
      && files.postgres.includes("buildWorldObjectChangesFromStateDiff")
      && files.postgres.includes("shouldTreatAsWorldObjectChange"),
  },
  {
    name: "world-state saves infer object old/new diffs",
    ok: files.postgres.includes("loadWorldStateForUpdate")
      && files.postgres.includes("previousWorldState")
      && files.postgres.includes("inferredObjectChanges")
      && files.postgres.includes("recordWorldChangeAndTrackedDrops"),
  },
  {
    name: "server block updates send old/new block IDs",
    ok: files.serverRouteSources.includes("getWorldBlockTypeAt")
      && files.serverRouteSources.includes("block_type_before: blockTypeBefore")
      && files.serverRouteSources.includes("block_type_after: update.action === \"break\" ? \"\" : update.block_type"),
  },
  {
    name: "server interaction updates commit object journal rows",
    ok: files.serverRouteSources.includes("buildWorldObjectChangeEntry")
      && files.serverRouteSources.includes("const objectBefore = getWorldObjectJournalData(worldName, update)")
      && files.serverRouteSources.includes("const objectAfter = getWorldObjectJournalData(worldName, update)")
      && files.serverRouteSources.includes("await commitWorldStateWithBlockChanges(worldName, [worldObjectChangeEntry])"),
  },
  {
    name: "linked doors and vending buys write object journals",
    ok: files.server.includes("async function maybeApplyReciprocalDoorLink")
      && files.server.includes("door_reciprocal_link")
      && files.server.includes("action: \"vending_buy\"")
      && files.server.includes("world_changes: [worldChange]")
      && files.server.includes("world_persistence: ownership")
      && files.postgres.includes("recordWorldChangeAndTrackedDrops(client, persistedWorld.world_id, change)"),
  },
  {
    name: "JSON mirror carries object old/new details",
    ok: files.server.includes("object_type: clampString(entry.object_type")
      && files.server.includes("old_data: cloneJson(entry.old_data")
      && files.server.includes("new_data: cloneJson(entry.new_data"),
  },
  {
    name: "project docs mention world change journal",
    ok: files.rules.includes("World Change Journal")
      && files.rules.includes("world_object_changes")
      && files.handoff.includes("World Change Journal")
      && files.handoff.includes("world_object_changes"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[world-journal-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[world-journal-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[world-journal-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[world-journal-wiring] success");
