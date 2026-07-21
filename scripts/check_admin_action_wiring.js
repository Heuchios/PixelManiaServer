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
  server: readFirst(fromBackend("server.js")),
  adminLookupRoutes: readFirst(fromBackend("server_admin_lookup_routes.js")),
  postgres: readFirst(fromBackend("postgres_store.js")),
  packageJson: readFirst(fromBackend("package.json")),
  deploy: require("./release_deployment_test_helpers").readDeploymentCoverage(path.resolve(__dirname, "..")),
  schema: readFirst(fromBackend("docs/postgres_security_foundation.sql")),
  envExample: readFirst(fromBackend(".env.example"), false),
  ecosystem: readFirst(fromBackend("ecosystem.config.js"), false),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
};
const adminLookupSources = `${files.server}\n${files.adminLookupRoutes}`;

const checks = [
  {
    name: "admin_actions table exists with core PostgreSQL audit fields",
    ok: files.schema.includes("CREATE TABLE IF NOT EXISTS admin_actions")
      && files.schema.includes("admin_player_id uuid REFERENCES players")
      && files.schema.includes("action_type text NOT NULL")
      && files.schema.includes("target_type text NOT NULL")
      && files.schema.includes("metadata jsonb NOT NULL DEFAULT '{}'::jsonb"),
  },
  {
    name: "server admin log rows include actor, role, session, network, target, affected item/world, amount, and reason",
    ok: files.server.includes("function logAdminAction(socket, player, action, details = {}, ok = true, message = \"\")")
      && files.server.includes("admin_action_event_id")
      && files.server.includes("admin_id")
      && files.server.includes("admin_role")
      && files.server.includes("session_token_hash")
      && files.server.includes("user_agent")
      && files.server.includes("device_info")
      && files.server.includes("target_type")
      && files.server.includes("target_id")
      && files.server.includes("affected_item_id")
      && files.server.includes("affected_world")
      && files.server.includes("amount:")
      && files.server.includes("reason:"),
  },
  {
    name: "admin log rows mirror into PostgreSQL admin_actions",
    ok: files.server.includes("postgresStore.mirrorAdminAction(entry)")
      && files.postgres.includes("mirrorAdminAction(entry)")
      && files.postgres.includes("INSERT INTO ${this.table(\"admin_actions\")}")
      && files.postgres.includes("JSON.stringify(safeJson(e))"),
  },
  {
    name: "admin/developer and designer commands use the dedicated server-side command capability",
    ok: files.server.includes("function canUseAdminCommands(player)")
      && files.server.includes("return isAdmin(player) || isDesigner(player);")
      && files.server.includes("if (!canUseAdminCommands(player))")
      && files.server.includes("Admin commands are only available to admins, developers, and designers.")
      && files.server.includes("if (isAdmin(player))")
      && files.server.includes("if (!isDeveloperPinUnlocked(player))")
      && files.server.includes("Developer PIN required."),
  },
  {
    name: "designer role persists without inheriting global admin or developer-panel authority",
    ok: /if\s*\(role === "admin" \|\| role === "developer" \|\| role === "designer"\)\s*return role;/.test(files.server)
      && /const DESIGNER_USERNAMES = new Set\(\[\s*"uce",\s*"rayan",/.test(files.server)
      && files.server.includes('return String(role || "").trim().toLowerCase() === "designer";')
      && files.server.includes("function isAdmin(player)")
      && files.server.includes("isDeveloperRole(getAccountRole(player.account_username))")
      && /if\s*\(role === "designer"\)\s*return 75;/.test(files.server)
      && files.postgres.includes('role === "designer"')
      && files.postgres.includes("'player', 'moderator', 'designer', 'admin', 'owner'")
      && files.schema.includes("role IN ('player', 'moderator', 'designer', 'admin', 'owner')")
      && files.envExample.includes("DESIGNER_USERNAMES=")
      && files.ecosystem.includes('DESIGNER_USERNAMES: env("DESIGNER_USERNAMES")'),
  },
  {
    name: "admin give/remove logs inventory before-after hashes and counts",
    ok: files.server.includes("buildInventoryAdminAuditContext")
      && files.server.includes("inventory_before_hash")
      && files.server.includes("inventory_after_hash")
      && files.server.includes("before_count")
      && files.server.includes("after_count")
      && files.server.includes("action: \"admin_give\"")
      && files.server.includes("action: \"admin_remove\""),
  },
  {
    name: "admin world actions log before-after summaries or affected world context",
    ok: files.server.includes("summarizeWorldAuditState")
      && files.server.includes("before_world")
      && files.server.includes("after_world")
      && files.server.includes("before_drop_count")
      && files.server.includes("after_drop_count")
      && files.server.includes("old_block_id")
      && files.server.includes("new_block_id"),
  },
  {
    name: "moderation and item-instance admin actions log target/reason and before-after context",
    ok: files.server.includes("before_active_punishment_ids")
      && files.server.includes("before_item_instance")
      && files.server.includes("after_item_instance")
      && files.server.includes("handleDeveloperPunishmentCommand")
      && files.server.includes("handleDeveloperItemInstanceAdminCommand"),
  },
  {
    name: "admin lookup actions log denied/successful attempts",
    ok: adminLookupSources.includes("admin_inventory_lookup_denied")
      && adminLookupSources.includes("admin_item_instance_lookup_denied")
      && adminLookupSources.includes("admin_transaction_ledger_lookup_denied")
      && adminLookupSources.includes("logAdminAction(socket, player, \"admin_inventory_lookup\"")
      && adminLookupSources.includes("logAdminAction(socket, player, \"admin_transaction_ledger_lookup\""),
  },
  {
    name: "package security check includes admin action wiring check",
    ok: files.packageJson.includes('"check:admin-actions": "node scripts/check_admin_action_wiring.js"')
      && files.packageJson.includes("npm run check:admin-actions"),
  },
  {
    name: "production deploy helper ships and runs admin action wiring check",
    ok: files.deploy.includes("$localAdminActionWiringCheck")
      && files.deploy.includes("node --check scripts/check_admin_action_wiring.js")
      && files.deploy.includes("npm run check:admin-actions"),
  },
  {
    name: "project docs describe admin action logging policy",
    ok: files.rules.includes("Admin Action Logs")
      && files.handoff.includes("Admin Action Logs")
      && files.handoff.includes("check:admin-actions"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[admin-action-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[admin-action-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[admin-action-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[admin-action-wiring] success");
