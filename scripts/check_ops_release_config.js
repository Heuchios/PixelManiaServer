"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-ops-config-"));
const source = path.join(repo, "ecosystem.ops.config.js");
function loadConfig(directory) {
  const env = { ...process.env, NODE_PATH: path.join(repo, "node_modules") };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PIXELMANIA_") || key.startsWith("OPS_DASHBOARD_")) delete env[key];
  }
  return JSON.parse(execFileSync(process.execPath, ["-e",
    "console.log(JSON.stringify(require(process.argv[1]).apps[0]))", path.join(directory, "ecosystem.ops.config.js")],
  { env, encoding: "utf8", windowsHide: true }));
}
try {
  const release = path.join(fixture, "releases", "test-release");
  fs.mkdirSync(release, { recursive: true });
  fs.copyFileSync(source, path.join(release, "ecosystem.ops.config.js"));
  fs.writeFileSync(path.join(release, ".release-env"),
    `PIXELMANIA_RELEASE_ROOT='${fixture}'\nPIXELMANIA_RELEASE_ID='test-release'\n`);
  fs.writeFileSync(path.join(release, ".env"), "OPS_DASHBOARD_COOKIE_SECURE=true\n");
  const app = loadConfig(release);
  assert.equal(app.script, path.join(release, "ops_dashboard_server.js"));
  assert.equal(app.env.OPS_DASHBOARD_ACCOUNT_FILE, path.join(fixture, "shared", "ops_dashboard_admin.json"));
  assert.equal(app.env.OPS_DASHBOARD_AUDIT_LOG_PATH, path.join(fixture, "shared", "ops_dashboard_audit.log"));
  assert.equal(app.env.PIXELMANIA_RELEASE_ROOT, fixture);
  assert.equal(app.env.PIXELMANIA_RELEASE_ID, "test-release");
  assert.equal(app.env.OPS_DASHBOARD_COOKIE_SECURE, "true");
  assert.equal(app.env.OPS_DASHBOARD_DEPLOY_COMMAND, "");
  assert.equal(app.env.OPS_DASHBOARD_DEPLOY_CWD, path.join(fixture, "current"));
  assert.ok(app.env.OPS_DASHBOARD_ROLLBACK_COMMAND.includes(path.join(fixture, "bin", "rollback_release.sh")));

  const checkout = path.join(fixture, "checkout");
  fs.mkdirSync(checkout);
  fs.copyFileSync(source, path.join(checkout, "ecosystem.ops.config.js"));
  const legacy = loadConfig(checkout);
  assert.equal(legacy.env.OPS_DASHBOARD_ACCOUNT_FILE, path.join(checkout, "ops_dashboard_admin.json"));
  assert.equal(legacy.env.PIXELMANIA_RELEASE_ROOT, "");
  assert.equal(legacy.env.OPS_DASHBOARD_DEPLOY_COMMAND, "bash scripts/ops_dashboard_git_deploy.sh");
  console.log("OPS_RELEASE_CONFIG_PASS: manual reload retains shared account, audit log and release controls; checkout defaults preserved");
} finally {
  assert.equal(path.dirname(fs.realpathSync(fixture)), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(fixture).startsWith("pixelmania-ops-config-"));
  fs.rmSync(fixture, { recursive: true, force: true });
}
