#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertCheck(condition, message) {
  if (!condition) {
    throw new Error(`[release-deploy] ${message}`);
  }
  console.log(`[release-deploy] ok: ${message}`);
}

const deploy = read("deploy_to_droplet.ps1");
const rollbackPs = read("rollback_release.ps1");
const rollbackSh = read("scripts/rollback_release.sh");
const ecosystem = read("ecosystem.config.js");
const opsEcosystem = read("ecosystem.ops.config.js");
const routeStart = read("scripts/start_route_production_instances.sh");
const runtime = read("src/server_phase11a_runtime.ts");
const deploymentTestHelpers = read("scripts/release_deployment_test_helpers.js");
const packageJson = JSON.parse(read("package.json"));

function extractHereString(source, variableName) {
  const pattern = new RegExp(`\\$${variableName}\\s*=\\s*@'\\r?\\n([\\s\\S]*?)\\r?\\n'@`, "u");
  const match = source.match(pattern);
  assertCheck(Boolean(match), `${variableName} Bash program is extractable`);
  return match[1];
}

function findBash() {
  if (process.platform !== "win32") {
    return "bash";
  }
  const candidates = [
    process.env.GIT_BASH_PATH,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function checkBashSyntax(script, description) {
  const bash = findBash();
  if (!bash) {
    console.log(`[release-deploy] skip: ${description} Bash syntax (bash unavailable)`);
    return;
  }
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-release-check-"));
  const temporaryScript = path.join(temporaryDirectory, "check.sh");
  try {
    fs.writeFileSync(temporaryScript, `${script}\n`, "utf8");
    const result = childProcess.spawnSync(bash, ["-n", temporaryScript], {
      encoding: "utf8",
      windowsHide: true,
    });
    assertCheck(
      result.status === 0,
      `${description} passes bash -n${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

assertCheck(deploy.includes("git\" -Arguments @") && deploy.includes("archive\", \"--format=tar.gz"), "deploy packages the exact Git commit");
assertCheck(deploy.includes("Assert-CleanBackendCommit"), "deploy refuses a dirty backend worktree");
assertCheck(deploy.includes("& npm run check:security"), "normal deploy runs the complete local security preflight");
assertCheck(deploy.includes("Get-FileHash") && deploy.includes("sha256sum -c"), "release archives are SHA-256 verified remotely");
assertCheck(deploy.includes('RELEASE_DIR="$BASE_DIR/releases/$RELEASE_ID"'), "deploy prepares immutable versioned release directories");
assertCheck(deploy.includes("atomic_link") && deploy.includes('atomic_link "$RELEASE_DIR" "$CURRENT_LINK"'), "current release activation uses an atomic pointer switch");
assertCheck(deploy.includes("npm ci --omit=dev") && !deploy.includes("npm install --omit=dev"), "production dependencies use deterministic npm ci");
assertCheck(deploy.includes("rollback_release.sh\" --yes") && deploy.includes("Activation failed; restoring the previous release"), "failed activation invokes automatic rollback");
assertCheck(deploy.includes("Expected public release_id") && runtime.includes("release_id: String(process.env.PIXELMANIA_RELEASE_ID"), "health verification proves the active release ID");
assertCheck(!/^\s*&\s*scp\b/m.test(deploy), "legacy file-by-file SCP commands are absent");
assertCheck((deploy.match(/Send-ReleaseArtifact -LocalPath/g) || []).length === 3, "deployment uploads only backend, client, and manifest artifacts");

const initializeRemote = extractHereString(deploy, "initializeRemote")
  .replaceAll("__REMOTE_DIR__", "PixelManiaServer");
const remoteCommand = extractHereString(deploy, "remoteCommand")
  .replaceAll("__REMOTE_DIR__", "PixelManiaServer")
  .replaceAll("__RELEASE_ID__", "release-test")
  .replaceAll("__BACKEND_ARCHIVE__", "backend.tar.gz")
  .replaceAll("__CLIENT_ARCHIVE__", "client.tar.gz")
  .replaceAll("__MANIFEST_FILE__", "release.json")
  .replaceAll("__BACKEND_SHA256__", "a".repeat(64))
  .replaceAll("__CLIENT_SHA256__", "b".repeat(64))
  .replaceAll("__RUN_REMOTE_FULL_CHECKS__", "0")
  .replaceAll("__RELEASE_ENV_CONTENT__", "PIXELMANIA_RELEASE_ID='release-test'\nPIXELMANIA_RELEASE_ROOT=\"$BASE_DIR\"");
assertCheck(!/__[_A-Z0-9]+__/u.test(`${initializeRemote}\n${remoteCommand}`), "remote Bash templates have no unresolved placeholders");
checkBashSyntax(initializeRemote, "remote initialization");
checkBashSyntax(remoteCommand, "remote release activation");

assertCheck(rollbackSh.includes('swap_release_links "$previous_target" "$current_target"'), "rollback atomically swaps current and previous pointers");
assertCheck(rollbackSh.includes("Rollback target failed health; restoring the original release"), "rollback restores the original pointer if recovery health fails");
assertCheck(rollbackSh.includes('active_release" = "$expected_release'), "rollback health must match the target release ID");
assertCheck(rollbackSh.includes("pm2 startOrReload ecosystem.config.js"), "rollback reloads the authoritative PM2 app");
assertCheck(rollbackPs.includes("bin/rollback_release.sh") && rollbackPs.includes("--status"), "Windows rollback wrapper supports rollback and status");

assertCheck(ecosystem.includes("cwd: __dirname") && ecosystem.includes("PIXELMANIA_RELEASE_ID"), "main PM2 config is release-directory aware");
assertCheck(
  opsEcosystem.includes("stateRoot")
    && opsEcosystem.includes("rollback_release.sh")
    && opsEcosystem.includes("OPS_DASHBOARD_DEPLOY_COMMAND: releaseRoot")
    && opsEcosystem.includes("OPS_DASHBOARD_ROLLBACK_COMMAND: releaseRoot"),
  "ops state remains shared and release mode blocks legacy deploy and rollback overrides",
);
assertCheck(routeStart.includes("PIXELMANIA_BACKEND_ROOT") && routeStart.includes("cwd: root"), "route PM2 apps follow the active backend release");
assertCheck(deploymentTestHelpers.includes("readDeploymentCoverage") && deploymentTestHelpers.includes("git\", [\"-C\", root, \"ls-files\""), "legacy module checks evaluate committed archive coverage");
assertCheck(packageJson.scripts && packageJson.scripts["check:release-deploy"] === "node scripts/check_release_deployment_wiring.js", "package exposes the release deployment gate");
assertCheck(String(packageJson.scripts["check:security"] || "").includes("check:release-deploy"), "security gate includes release deployment wiring");

console.log("[release-deploy] success");
