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
const serviceUserMigration = read("migrate_production_to_service_user.ps1");
const deployOpsDashboard = read("deploy_ops_dashboard_readonly.ps1");
const enableOpsRestart = read("enable_ops_dashboard_restart_only.ps1");
const enableOpsControls = read("enable_ops_dashboard_server_controls.ps1");
const gitAttributes = read(".gitattributes");
const rollbackPs = read("rollback_release.ps1");
const rollbackSh = read("scripts/rollback_release.sh");
const activateMainRelease = read("scripts/activate_main_release.sh");
const ecosystem = read("ecosystem.config.js");
const opsEcosystem = read("ecosystem.ops.config.js");
const routeStart = read("scripts/start_route_production_instances.sh");
const snapshotRestoreSmoke = read("scripts/check_world_snapshot_restore_smoke.js");
const runtime = read("src/server_phase11a_runtime.ts");
const releaseClientAwareChecks = [
  read("scripts/check_anti_dupe_locking_wiring.js"),
  read("scripts/check_monitoring_dashboard_wiring.js"),
  read("scripts/check_rollback_wiring.js"),
  read("scripts/check_scale_readiness_wiring.js"),
  read("scripts/check_transaction_ledger_wiring.js"),
];
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
    const normalizedScript = script.replace(/\r\n?/gu, "\n");
    fs.writeFileSync(temporaryScript, `${normalizedScript}\n`, "utf8");
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

function checkMainActivationBehavior() {
  if (process.platform === "win32") {
    console.log("[release-deploy] skip: main PM2 release activation behavior (runs during remote Linux validation)");
    return;
  }
  const bash = findBash();
  if (!bash) {
    console.log("[release-deploy] skip: main PM2 release activation behavior (bash unavailable)");
    return;
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-pm2-activation-check-"));
  const fakeBin = path.join(temporaryDirectory, "bin");
  const releaseDirectory = path.join(temporaryDirectory, "current");
  const fakePm2State = path.join(temporaryDirectory, "pm2-script-path");
  const fakePm2 = path.join(fakeBin, "pm2");
  try {
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(releaseDirectory, { recursive: true });
    fs.writeFileSync(path.join(releaseDirectory, "ecosystem.config.js"), "module.exports = { apps: [] };\n", "utf8");
    fs.writeFileSync(path.join(releaseDirectory, "server.js"), "\"use strict\";\n", "utf8");
    fs.writeFileSync(fakePm2State, "/legacy/PixelManiaServer/server.js", "utf8");
    fs.writeFileSync(fakePm2, `#!/usr/bin/env bash
set -Eeuo pipefail
case "\${1:-}" in
  ping)
    exit 0
    ;;
  jlist)
    script_path="$(cat "$FAKE_PM2_STATE" 2>/dev/null || true)"
    node -e 'process.stdout.write(JSON.stringify([{name:"pixelmania",pm2_env:{pm_exec_path:process.argv[1]}}]))' "$script_path"
    ;;
  delete)
    : > "$FAKE_PM2_STATE"
    ;;
  startOrReload)
    printf '%s/server.js' "$PIXELMANIA_BACKEND_ROOT" > "$FAKE_PM2_STATE"
    ;;
  *)
    exit 2
    ;;
esac
`, "utf8");
    fs.chmodSync(fakePm2, 0o755);

    const environment = {
      ...process.env,
      FAKE_PM2_STATE: fakePm2State,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
    };
    const activationScript = path.join(root, "scripts", "activate_main_release.sh");
    const first = childProcess.spawnSync(bash, [activationScript, releaseDirectory], {
      encoding: "utf8",
      env: environment,
    });
    assertCheck(
      first.status === 0
        && first.stdout.includes("Recreating pixelmania")
        && fs.readFileSync(fakePm2State, "utf8") === path.join(releaseDirectory, "server.js"),
      `main PM2 activation adopts the versioned release${first.stderr ? `: ${first.stderr.trim()}` : ""}`,
    );

    const second = childProcess.spawnSync(bash, [activationScript, releaseDirectory], {
      encoding: "utf8",
      env: environment,
    });
    assertCheck(
      second.status === 0 && !second.stdout.includes("Recreating pixelmania"),
      `subsequent main PM2 activation reloads in place${second.stderr ? `: ${second.stderr.trim()}` : ""}`,
    );
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

assertCheck(deploy.includes("git\" -Arguments @") && deploy.includes("archive\", \"--worktree-attributes\", \"--format=tar.gz"), "deploy packages the exact Git commit with repository attributes");
assertCheck(/^\*\.sh\s+text\s+eol=lf\s*$/mu.test(gitAttributes), "Git exports shell scripts with LF line endings");
assertCheck(/^\*\.ps1\s+text\s+eol=lf\s*$/mu.test(gitAttributes), "Git exports PowerShell scripts with LF line endings");
assertCheck(deploy.includes("Assert-ArchiveScriptsUseLf") && deploy.includes("Backend archive contains CRLF scripts"), "deploy rejects CRLF scripts in the packaged archive");
assertCheck(deploymentTestHelpers.includes("readDeploymentCoverage") && deploy.includes("--worktree-attributes"), "release checks use the same attributed archive model as deployment");
assertCheck(deploy.includes("Assert-CleanBackendCommit"), "deploy refuses a dirty backend worktree");
assertCheck(
  deploy.indexOf("Assert-CleanBackendCommit\nInvoke-LocalDeployPreflight") >= 0
    && deploy.includes("Assert-LocalPreflightPreservedBackendCommit"),
  "deploy proves a clean commit before preflight and rejects real generated drift",
);
assertCheck(
  deploy.includes('@("-c", "core.safecrlf=false", "diff", "--name-only", "HEAD", "--")'),
  "post-preflight drift detection ignores Windows line-ending diagnostics while retaining path checks",
);
assertCheck(deploy.includes("& npm run check:security"), "normal deploy runs the complete local security preflight");
assertCheck(deploy.includes("Get-FileHash") && deploy.includes("sha256sum -c"), "release archives are SHA-256 verified remotely");
assertCheck(deploy.includes('RELEASE_DIR="$BASE_DIR/releases/$RELEASE_ID"'), "deploy prepares immutable versioned release directories");
assertCheck(deploy.includes("atomic_link") && deploy.includes('atomic_link "$RELEASE_DIR" "$CURRENT_LINK"'), "current release activation uses an atomic pointer switch");
assertCheck(deploy.includes("npm ci --omit=dev") && !deploy.includes("npm install --omit=dev"), "production dependencies use deterministic npm ci");
assertCheck(deploy.includes("rollback_release.sh\" --yes") && deploy.includes("Activation failed; restoring the previous release"), "failed activation invokes automatic rollback");
assertCheck(deploy.includes("Expected public release_id") && runtime.includes("release_id: String(process.env.PIXELMANIA_RELEASE_ID"), "health verification proves the active release ID");
assertCheck(
  deploy.includes('install -m 0755 scripts/activate_main_release.sh "$BASE_DIR/bin/activate_main_release.sh"')
    && deploy.includes('"$BASE_DIR/bin/activate_main_release.sh" "$CURRENT_LINK"')
    && rollbackSh.includes('"$BASE_DIR/bin/activate_main_release.sh" "$CURRENT_LINK"'),
  "deploy and rollback share the main PM2 release activator",
);
assertCheck(
  activateMainRelease.includes("pm_exec_path")
    && activateMainRelease.includes("pm2 ping >/dev/null 2>&1")
    && activateMainRelease.includes('pm2 delete "$APP_NAME"')
    && activateMainRelease.includes("script_matches_release")
    && activateMainRelease.includes("PIXELMANIA_BACKEND_ROOT"),
  "main PM2 activation replaces legacy paths and verifies the selected release",
);
assertCheck(
  deploy.includes('release_health_body="$(mktemp)"')
    && deploy.includes('release_health_error="$(mktemp)"')
    && rollbackSh.includes('health_body="$(mktemp)"')
    && rollbackSh.includes('health_error="$(mktemp)"')
    && !deploy.includes("/tmp/pixelmania-release-health")
    && !rollbackSh.includes("/tmp/pixelmania-rollback-health"),
  "deploy and rollback health probes use private temporary files",
);
assertCheck(!/^\s*&\s*scp\b/m.test(deploy), "legacy file-by-file SCP commands are absent");
assertCheck((deploy.match(/Send-ReleaseArtifact -LocalPath/g) || []).length === 3, "deployment uploads only backend, client, and manifest artifacts");
assertCheck(
  deploy.includes('"Scripts/drop_manager.gd"')
    && deploy.includes('"docs/production_backend_wiring.md"')
    && deploy.includes('"docs/scale_readiness_10k.md"'),
  "client release carries gameplay, security, and scale-readiness evidence",
);
assertCheck(
  releaseClientAwareChecks.every((source) => source.includes("process.env.PIXELMANIA_CLIENT_DIR"))
    && deploy.includes('export PIXELMANIA_CLIENT_DIR="$RELEASE_DIR/_client"'),
  "client-dependent validation resolves evidence from the isolated release",
);

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
  // Each environment polls its OWN Node listener during activation; the port comes from
  // deploy_to_droplet.ps1's -LocalHealthPort. Production is 8080, staging 8180.
  .replaceAll("__LOCAL_HEALTH_URL__", "http://127.0.0.1:8080/health")
  .replaceAll("__RELEASE_ENV_CONTENT__", "PIXELMANIA_RELEASE_ID='release-test'\nPIXELMANIA_RELEASE_ROOT=\"$BASE_DIR\"");
const serviceUserMigrationCommand = extractHereString(serviceUserMigration, "serviceUserRemoteCommand")
  .replaceAll("__REMOTE_DIR__", "PixelManiaServer")
  .replaceAll("__SERVICE_USER__", "pixelmania")
  .replaceAll("__AUTHORIZED_KEY_B64__", Buffer.from("ssh-ed25519 test pixelmania-deploy").toString("base64"))
  .replaceAll("__SNAPSHOT_INTERVAL_MINUTES__", "60")
  .replaceAll("__SNAPSHOT_MAX_WORLDS_PER_CYCLE__", "5")
  .replaceAll("__ALLOW_ACTIVE_PLAYERS__", "0");
assertCheck(!/__[_A-Z0-9]+__/u.test(`${initializeRemote}\n${remoteCommand}`), "remote Bash templates have no unresolved placeholders");
assertCheck(!/__[_A-Z0-9]+__/u.test(serviceUserMigrationCommand), "service-user migration Bash template has no unresolved placeholders");
checkBashSyntax(initializeRemote, "remote initialization");
checkBashSyntax(remoteCommand, "remote release activation");
checkBashSyntax(serviceUserMigrationCommand, "service-user migration");
checkBashSyntax(activateMainRelease, "main PM2 release activation");
checkMainActivationBehavior();

assertCheck(rollbackSh.includes('swap_release_links "$previous_target" "$current_target"'), "rollback atomically swaps current and previous pointers");
assertCheck(rollbackSh.includes("Rollback target failed health; restoring the original release"), "rollback restores the original pointer if recovery health fails");
assertCheck(rollbackSh.includes('active_release" = "$expected_release'), "rollback health must match the target release ID");
assertCheck(rollbackSh.includes("pm2 startOrReload ecosystem.config.js"), "rollback reloads the authoritative PM2 app");
assertCheck(rollbackPs.includes("bin/rollback_release.sh") && rollbackPs.includes("--status"), "Windows rollback wrapper supports rollback and status");

assertCheck(
  ecosystem.includes('env("PIXELMANIA_BACKEND_ROOT", __dirname)')
    && ecosystem.includes("cwd: backendRoot")
    && ecosystem.includes("PIXELMANIA_RELEASE_ID"),
  "main PM2 config follows the active release pointer",
);
assertCheck(
  opsEcosystem.includes("stateRoot")
    && opsEcosystem.includes("rollback_release.sh")
    && opsEcosystem.includes("OPS_DASHBOARD_DEPLOY_COMMAND: releaseRoot")
    && opsEcosystem.includes("OPS_DASHBOARD_ROLLBACK_COMMAND: releaseRoot"),
  "ops state remains shared and release mode blocks legacy deploy and rollback overrides",
);
assertCheck(routeStart.includes("PIXELMANIA_BACKEND_ROOT") && routeStart.includes("cwd: root"), "route PM2 apps follow the active backend release");
assertCheck(
  [deploy, rollbackPs, deployOpsDashboard, enableOpsRestart, enableOpsControls]
    .every((source) => /\[string\]\$RemoteUser\s*=\s*"pixelmania"/u.test(source)),
  "production operation wrappers default to the dedicated pixelmania account",
);
assertCheck(
  serviceUserMigration.includes("useradd --create-home")
    && /run_service\(\) \{[\s\S]*?cd "\$SERVICE_HOME"[\s\S]*?runuser -u "\$SERVICE_USER"/u.test(serviceUserMigration)
    && serviceUserMigration.includes("pm2 startup systemd")
    && serviceUserMigration.includes("restore_root_processes")
    && serviceUserMigration.includes("active_sessions")
    && serviceUserMigration.includes("indexed_players")
    && serviceUserMigration.includes("/var/lib/pixelmania-route-production")
    && serviceUserMigration.includes("/root/.aws")
    && serviceUserMigration.includes('chown "$SERVICE_USER:$SERVICE_GROUP" "$smoke_root"')
    && serviceUserMigration.includes('chmod 0750 "$smoke_root"')
    && serviceUserMigration.includes("run_service pm2 ping >/dev/null 2>&1")
    && /systemctl disable --now "pm2-\$\{SERVICE_USER\}\.service"[\s\S]*?run_service pm2 delete[\s\S]*?run_service pm2 kill[\s\S]*?root_pm2 restart/u.test(serviceUserMigration)
    && /run_service pm2 save\s+run_service pm2 kill\s+systemctl reset-failed/u.test(serviceUserMigration)
    && (serviceUserMigration.match(/wait_for_release_health "\$expected_release"/gu) || []).length === 2
    && serviceUserMigration.includes("world_snapshot_tool.js"),
  "service-user migration preserves credentials and data, refuses active traffic, tests restores, and can recover root PM2",
);
assertCheck(
  snapshotRestoreSmoke.includes("Dry run only")
    && snapshotRestoreSmoke.includes("--apply")
    && snapshotRestoreSmoke.includes("rollback_jobs.log")
    && packageJson.scripts["check:snapshot-restore"] === "node scripts/check_world_snapshot_restore_smoke.js"
    && String(packageJson.scripts["check:security"] || "").includes("check:snapshot-restore"),
  "security preflight proves isolated snapshot create and restore behavior",
);
assertCheck(
  deploymentTestHelpers.includes("readDeploymentCoverage")
    && deploymentTestHelpers.includes("git\", [\"-C\", root, \"ls-files\"")
    && deploymentTestHelpers.includes("deploySource.includes('\"archive\"')")
    && deploymentTestHelpers.includes("deploySource.includes('\"--format=tar.gz\"')"),
  "legacy module checks evaluate committed archive coverage",
);
assertCheck(packageJson.scripts && packageJson.scripts["check:release-deploy"] === "node scripts/check_release_deployment_wiring.js", "package exposes the release deployment gate");
assertCheck(String(packageJson.scripts["check:security"] || "").includes("check:release-deploy"), "security gate includes release deployment wiring");

console.log("[release-deploy] success");
