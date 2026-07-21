#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const snapshotTool = path.join(repoRoot, "scripts", "world_snapshot_tool.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-snapshot-restore-"));
const worldFolder = path.join(tempRoot, "worlds");
const snapshotFolder = path.join(tempRoot, "world_snapshots");
const integrityFolder = path.join(tempRoot, "integrity_logs");
const rollbackLog = path.join(integrityFolder, "rollback_jobs.log");
const worldName = "RESTORE_SMOKE";
const worldPath = path.join(worldFolder, `${worldName}.json`);

function runSnapshotTool(args) {
  const result = childProcess.spawnSync(process.execPath, [snapshotTool, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PIXELMANIA_DATA_DIR: tempRoot,
      WORLD_SAVE_FOLDER: worldFolder,
      WORLD_SNAPSHOT_FOLDER: snapshotFolder,
      INTEGRITY_LOG_FOLDER: integrityFolder,
      ROLLBACK_LOG_PATH: rollbackLog,
      POSTGRES_ENABLED: "false",
    },
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `snapshot tool failed (${args.join(" ")}): ${result.stderr || result.stdout}`,
  );
  return result.stdout;
}

function writeWorld(value) {
  fs.mkdirSync(worldFolder, { recursive: true });
  fs.writeFileSync(worldPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

try {
  const baseline = {
    world_name: worldName,
    blocks: [{ x: 4, y: 8, block_type: "dirt" }],
    background_blocks: [],
    seeds: [],
    interactions: {},
    saved_at: "2026-07-20T00:00:00.000Z",
  };
  const changed = {
    ...baseline,
    blocks: [{ x: 4, y: 8, block_type: "stone" }],
    saved_at: "2026-07-20T00:01:00.000Z",
  };

  writeWorld(baseline);
  const createOutput = runSnapshotTool(["create", worldName, "--reason", "restore_smoke"]);
  assert.match(createOutput, /Snapshot created:/u);

  writeWorld(changed);
  const dryRunOutput = runSnapshotTool(["restore", worldName, "--latest"]);
  assert.match(dryRunOutput, /Dry run only/u);
  assert.deepEqual(JSON.parse(fs.readFileSync(worldPath, "utf8")), changed);

  const applyOutput = runSnapshotTool(["restore", worldName, "--latest", "--apply"]);
  assert.match(applyOutput, /Restore applied/u);
  assert.deepEqual(JSON.parse(fs.readFileSync(worldPath, "utf8")), baseline);

  const rollbackRows = fs.readFileSync(rollbackLog, "utf8").trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(rollbackRows.length, 1);
  assert.equal(rollbackRows[0].kind, "world_snapshot_restore");
  assert.equal(rollbackRows[0].target_world, worldName);
  assert.equal(rollbackRows[0].status, "applied");
  assert.ok(rollbackRows[0].backup_path);
  assert.equal(fs.existsSync(rollbackRows[0].backup_path), true);

  console.log("[snapshot-restore] create, dry-run, backup, restore, and audit checks passed");
} finally {
  fs.rmSync(tempRoot, { force: true, recursive: true });
}
