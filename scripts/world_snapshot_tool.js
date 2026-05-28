const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

try {
  require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
} catch (_) {
  // dotenv is optional for this tool; server defaults still work without it.
}

function resolveConfiguredPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

const DATA_FOLDER = resolveConfiguredPath(process.env.PIXELMANIA_DATA_DIR, ROOT);
const WORLD_SAVE_FOLDER = resolveConfiguredPath(
  process.env.WORLD_SAVE_FOLDER,
  path.join(DATA_FOLDER, "worlds")
);
const WORLD_SNAPSHOT_FOLDER = resolveConfiguredPath(
  process.env.WORLD_SNAPSHOT_FOLDER,
  path.join(DATA_FOLDER, "world_snapshots")
);
const INTEGRITY_LOG_FOLDER = resolveConfiguredPath(
  process.env.INTEGRITY_LOG_FOLDER,
  path.join(DATA_FOLDER, "integrity_logs")
);
const ROLLBACK_LOG_PATH = resolveConfiguredPath(
  process.env.ROLLBACK_LOG_PATH,
  path.join(INTEGRITY_LOG_FOLDER, "rollback_jobs.log")
);

const args = process.argv.slice(2);
const command = String(args[0] || "help").toLowerCase();

function hasFlag(name) {
  return args.includes(name);
}

function getOption(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function cleanWorld(value) {
  const clean = String(value || "START").trim().toUpperCase().replace(/\s+/g, "_");
  const safe = clean.replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  return safe.length > 0 ? safe : "START";
}

function safeFileName(value, fallback = "data") {
  const clean = String(value || fallback).trim().replace(/\s+/g, "_");
  const safe = clean.replace(/[^a-zA-Z0-9_-]/g, "");
  return safe.length > 0 ? safe : fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function appendJsonl(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function usage(exitCode = 0) {
  const text = [
    "PixelMania world snapshot tool",
    "",
    "Usage:",
    "  npm run snapshots -- create WORLD [--reason manual_checkpoint]",
    "  npm run snapshots -- list [WORLD] [--limit 10]",
    "  npm run snapshots -- show WORLD --latest",
    "  npm run snapshots -- show WORLD --file <snapshot.json>",
    "  npm run snapshots -- restore WORLD --latest",
    "  npm run snapshots -- restore WORLD --file <snapshot.json>",
    "  npm run snapshots -- restore WORLD --latest --apply",
    "",
    "Notes:",
    "  create writes a restore point for the current saved world JSON.",
    "  restore is dry-run by default. Add --apply to write the world JSON.",
    "  --apply backs up the current world save before restoring.",
    "  --apply also writes rollback_jobs.log so restores are auditable.",
    "  Restart or reload the server after applying a restore.",
    "",
    `World save folder: ${WORLD_SAVE_FOLDER}`,
    `Snapshot folder: ${WORLD_SNAPSHOT_FOLDER}`,
  ].join("\n");
  console.log(text);
  process.exit(exitCode);
}

function snapshotDirFor(worldName) {
  return path.join(WORLD_SNAPSHOT_FOLDER, safeFileName(cleanWorld(worldName), "START"));
}

function summarizeSnapshot(filePath) {
  const snapshot = readJson(filePath);
  const state = snapshot.world_state || snapshot;
  return {
    file: filePath,
    snapshot_id: String(snapshot.snapshot_id || ""),
    created_at: String(snapshot.created_at || state.saved_at || ""),
    reason: String(snapshot.reason || "snapshot"),
    world_name: String(state.world_name || ""),
    block_count: Array.isArray(state.blocks) ? state.blocks.length : 0,
    background_count: Array.isArray(state.background_blocks) ? state.background_blocks.length : 0,
    seed_count: Array.isArray(state.seeds) ? state.seeds.length : 0,
    interaction_count: Array.isArray(state.interactions) ? state.interactions.length : 0,
    drop_count: Array.isArray(state.drops) ? state.drops.length : 0,
  };
}

function listSnapshots(worldName = "") {
  const worlds = [];
  if (worldName) {
    worlds.push(cleanWorld(worldName));
  } else if (fs.existsSync(WORLD_SNAPSHOT_FOLDER)) {
    for (const entry of fs.readdirSync(WORLD_SNAPSHOT_FOLDER, { withFileTypes: true })) {
      if (entry.isDirectory()) worlds.push(entry.name);
    }
  }

  const rows = [];
  for (const world of worlds) {
    const dir = snapshotDirFor(world);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const filePath = path.join(dir, entry.name);
      try {
        rows.push(summarizeSnapshot(filePath));
      } catch (error) {
        rows.push({
          file: filePath,
          snapshot_id: "",
          created_at: "",
          reason: `unreadable: ${error.message}`,
          world_name: world,
          block_count: 0,
          background_count: 0,
          seed_count: 0,
          interaction_count: 0,
          drop_count: 0,
        });
      }
    }
  }

  return rows.sort((a, b) => {
    const at = Date.parse(a.created_at) || 0;
    const bt = Date.parse(b.created_at) || 0;
    return bt - at || String(b.file).localeCompare(String(a.file));
  });
}

function findSnapshot(worldName) {
  const explicit = getOption("--file", "");
  if (explicit) {
    const filePath = path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Snapshot file does not exist: ${filePath}`);
    }
    return summarizeSnapshot(filePath);
  }

  if (hasFlag("--latest")) {
    const rows = listSnapshots(worldName);
    if (rows.length === 0) {
      throw new Error(`No snapshots found for world ${cleanWorld(worldName)}.`);
    }
    return rows[0];
  }

  throw new Error("Choose a snapshot with --latest or --file <snapshot.json>.");
}

function assertWorldState(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Snapshot does not contain a world state object.");
  }
  if (!Array.isArray(value.blocks)) {
    throw new Error("Snapshot world state is missing blocks[].");
  }
  return value;
}

function printRows(rows, limit) {
  if (rows.length === 0) {
    console.log("No snapshots found.");
    return;
  }

  const limited = rows.slice(0, limit);
  for (const row of limited) {
    console.log(
      [
        row.created_at || "(no date)",
        row.world_name || "(unknown world)",
        row.reason,
        `blocks=${row.block_count}`,
        `seeds=${row.seed_count}`,
        `interactions=${row.interaction_count}`,
        `drops=${row.drop_count}`,
        row.file,
      ].join(" | ")
    );
  }
  if (rows.length > limited.length) {
    console.log(`Showing ${limited.length} of ${rows.length}. Use --limit ${rows.length} to see all.`);
  }
}

function showSnapshot() {
  const worldName = cleanWorld(args[1] || getOption("--world", "START"));
  const selected = findSnapshot(worldName);
  console.log(JSON.stringify(selected, null, 2));
}

function createSnapshot() {
  const worldName = cleanWorld(args[1] || getOption("--world", ""));
  if (!worldName) usage(1);

  const targetPath = path.join(WORLD_SAVE_FOLDER, `${worldName}.json`);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`World save does not exist: ${targetPath}`);
  }

  const currentState = assertWorldState(readJson(targetPath));
  const targetWorld = cleanWorld(currentState.world_name || worldName);
  const reason = String(getOption("--reason", "manual_checkpoint")).trim() || "manual_checkpoint";
  const stamp = new Date().toISOString();
  const fileStamp = stamp.replace(/[:.]/g, "-");
  const snapshotDir = snapshotDirFor(targetWorld);
  const snapshotPath = path.join(snapshotDir, `${fileStamp}_${safeFileName(reason, "manual_checkpoint")}.json`);

  const snapshot = {
    snapshot_id: `manual_snapshot_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    created_at: stamp,
    reason,
    actor: {
      source: "world_snapshot_tool",
      username: process.env.USER || process.env.USERNAME || "server_tool",
    },
    details: {
      source_path: targetPath,
    },
    world_state: currentState,
  };

  writeJsonAtomic(snapshotPath, snapshot);

  const summary = summarizeSnapshot(snapshotPath);
  console.log(`Snapshot created: ${snapshotPath}`);
  console.log(`World:    ${summary.world_name || targetWorld}`);
  console.log(`Reason:   ${summary.reason}`);
  console.log(`Blocks:   ${summary.block_count}`);
  console.log(`Seeds:    ${summary.seed_count}`);
  console.log(`Interact: ${summary.interaction_count}`);
  console.log(`Drops:    ${summary.drop_count}`);
}

function restoreSnapshot() {
  const worldName = cleanWorld(args[1] || getOption("--world", ""));
  if (!worldName) usage(1);

  const selected = findSnapshot(worldName);
  const snapshot = readJson(selected.file);
  const worldState = assertWorldState(snapshot.world_state || snapshot);
  const targetWorld = cleanWorld(worldState.world_name || worldName);
  const targetPath = path.join(WORLD_SAVE_FOLDER, `${targetWorld}.json`);
  const apply = hasFlag("--apply");

  console.log(`Snapshot: ${selected.file}`);
  console.log(`Target:   ${targetPath}`);
  console.log(`World:    ${targetWorld}`);
  console.log(`Reason:   ${selected.reason}`);
  console.log(`Blocks:   ${selected.block_count}`);
  console.log(`Seeds:    ${selected.seed_count}`);
  console.log(`Interact: ${selected.interaction_count}`);

  if (!apply) {
    console.log("");
    console.log("Dry run only. Add --apply to restore this snapshot.");
    return;
  }

  let backupPath = "";
  if (fs.existsSync(targetPath)) {
    const currentState = readJson(targetPath);
    const backupDir = snapshotDirFor(targetWorld);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = path.join(backupDir, `${stamp}_before_manual_restore.json`);
    writeJsonAtomic(backupPath, {
      snapshot_id: `manual_backup_${Date.now()}`,
      created_at: new Date().toISOString(),
      reason: "before_manual_restore",
      actor: { source: "world_snapshot_tool" },
      details: { restore_source: selected.file },
      world_state: currentState,
    });
    console.log(`Backed up current world first: ${backupPath}`);
  }

  writeJsonAtomic(targetPath, worldState);
  appendJsonl(ROLLBACK_LOG_PATH, {
    job_id: `rollback_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    status: "applied",
    kind: "world_snapshot_restore",
    target_world: targetWorld,
    actor_username: process.env.USER || process.env.USERNAME || "server_tool",
    reason: "manual_snapshot_restore",
    source_snapshot: selected.file,
    target_path: targetPath,
    backup_path: backupPath,
    details: {
      snapshot_id: selected.snapshot_id,
      snapshot_reason: selected.reason,
      blocks: selected.block_count,
      background_blocks: selected.background_count,
      seeds: selected.seed_count,
      interactions: selected.interaction_count,
      drops: selected.drop_count,
    },
  });
  console.log(`Rollback log written: ${ROLLBACK_LOG_PATH}`);
  console.log("Restore applied. Restart or reload the PixelMania server before testing the world.");
}

async function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    usage(0);
  }

  if (command === "list") {
    const worldName = args[1] && !args[1].startsWith("--") ? args[1] : "";
    const limit = Math.max(1, Number(getOption("--limit", "20")) || 20);
    printRows(listSnapshots(worldName), limit);
    return;
  }

  if (command === "create") {
    createSnapshot();
    return;
  }

  if (command === "show") {
    showSnapshot();
    return;
  }

  if (command === "restore") {
    restoreSnapshot();
    return;
  }

  usage(1);
}

main().catch((error) => {
  console.error(`Snapshot tool failed: ${error.message}`);
  process.exit(1);
});
