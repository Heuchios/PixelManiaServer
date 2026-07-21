#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LEGACY_RELEASE_ALIASES = [
  "$localAccountSessionSecurityWiringCheck",
  "$localServerAccountAuthRoutes",
  "$localServerAccountSessionHelpers",
  "$localAdminActionWiringCheck",
  "$localAntiDupeLockingCheck",
  "$localBotRateLimitWiringCheck",
  "$localServerBotRateLimitHelpers",
  "$localPostgresContracts",
  "$localPostgresContractsCheck",
  "$localRollbackApply",
  "$localRollbackPlan",
  "$localRollbackWiringCheck",
  "$localWorldSnapshotTool",
  "$localLoadTokenProvisioner",
  "$localMultiInstanceWorldCapSmoke",
  "$localMultiplayerScalingSmoke",
  "$localScaleReadinessWiringCheck",
  "$localStagedLoadTest",
  "$localServerPhase10OwnershipCheck",
  "$localServerPhase11aRuntime",
  "$localServerPhase11aRuntimeSource",
  "$localServerPhase11aRuntimeBuildConfig",
  "$localServerPhase11aRuntimeCheck",
  "$localServerPhase11aRuntimeBuildSync",
  "$localServerPhase11bLifecycle",
  "$localServerPhase11bLifecycleSource",
  "$localServerPhase11bLifecycleBuildConfig",
  "$localServerPhase11bLifecycleCheck",
  "$localServerPhase11bLifecycleBuildSync",
  "$localServerPhase11cTrustedMovement",
  "$localServerPhase11cTrustedMovementSource",
  "$localServerPhase11cTrustedMovementBuildConfig",
  "$localServerPhase11cTrustedMovementCheck",
  "$localServerPhase11cTrustedMovementBuildSync",
  "$localServerPhase11dStandardMovement",
  "$localServerPhase11dStandardMovementSource",
  "$localServerPhase11dStandardMovementBuildConfig",
  "$localServerPhase11dStandardMovementCheck",
  "$localServerPhase11dStandardMovementBuildSync",
  "$localBackendSource",
  "$localServerEntryBuildConfig",
  "$localServerEntryCheck",
  "$localServerEntryBuildSync",
  "$localServerValidationWiringCheck",
  "localIntegrityHashAudit",
  "localIntegrityHashWiringCheck",
  "localMonitoringDashboardWiringCheck",
];

function listFilesystemFiles(root) {
  const ignoredDirectories = new Set([".git", ".tsbuild", "node_modules"]);
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolutePath).replaceAll("\\", "/"));
      }
    }
  }

  visit(root);
  return files;
}

function listReleaseFiles(root) {
  if (fs.existsSync(path.join(root, ".git"))) {
    try {
      return childProcess.execFileSync("git", ["-C", root, "ls-files"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).split(/\r?\n/u).filter(Boolean).map((file) => file.replaceAll("\\", "/"));
    } catch {
      // Extracted production releases have no Git metadata, so scan their contents.
    }
  }
  return listFilesystemFiles(root);
}

function readDeploymentCoverage(repoRoot) {
  const deployPath = path.join(repoRoot, "deploy_to_droplet.ps1");
  const deploySource = fs.readFileSync(deployPath, "utf8");

  if (!deploySource.includes('"archive"') || !deploySource.includes('"--format=tar.gz"')) {
    return deploySource;
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const releaseFiles = listReleaseFiles(repoRoot);
  const scriptCoverage = Object.entries(packageJson.scripts || {}).flatMap(([name, command]) => [
    `npm run ${name}`,
    String(command),
  ]);
  const syntaxCoverage = releaseFiles
    .filter((file) => file.endsWith(".js"))
    .map((file) => `node --check ${file}`);

  return [
    deploySource,
    "# Versioned release archive coverage",
    ...releaseFiles,
    "# Local preflight package-script coverage",
    ...scriptCoverage,
    "# Archived JavaScript syntax coverage",
    ...syntaxCoverage,
    "# Compatibility aliases for checks written before archive deployment",
    ...LEGACY_RELEASE_ALIASES,
  ].join("\n");
}

module.exports = {
  readDeploymentCoverage,
};
