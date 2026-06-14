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
  postgres: readFirst(fromBackend("postgres_store.js")),
  packageJson: readFirst(fromBackend("package.json")),
  deploy: readFirst(fromBackend("deploy_to_droplet.ps1"), false),
  developerPanel: readFirst(fromRepoRoot("Scripts/developer_panel_ui.gd")),
  networkManager: readFirst(fromRepoRoot("Scripts/network_manager.gd")),
  world: readFirst(fromRepoRoot("Scripts/world.gd")),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
};

const checks = [
  {
    name: "server exposes admin monitoring dashboard request purpose",
    ok: files.server.includes("ADMIN_MONITORING_DASHBOARD_PURPOSE")
      && files.server.includes("handleAdminMonitoringDashboardRequest")
      && files.server.includes("buildAdminMonitoringRuntimeSnapshot"),
  },
  {
    name: "server dashboard is admin/PIN gated and audited",
    ok: files.server.includes("admin_monitoring_dashboard_denied")
      && files.server.includes("getDeveloperSecurityRequirement(player)")
      && files.server.includes("logAdminAction(socket, player, \"admin_monitoring_dashboard\""),
  },
  {
    name: "server has loop health metrics for TPS/tick dashboard cards",
    ok: files.server.includes("SERVER_TICK_MONITOR_INTERVAL_MS")
      && files.server.includes("startServerTickMonitor")
      && files.server.includes("getServerTickSnapshot"),
  },
  {
    name: "Postgres aggregates monitoring dashboard data",
    ok: files.postgres.includes("async getAdminMonitoringDashboard")
      && files.postgres.includes("top_gem_gainers")
      && files.postgres.includes("top_item_gainers")
      && files.postgres.includes("suspicious_accounts")
      && files.postgres.includes("dupe_warnings")
      && files.postgres.includes("latest_integrity_audit"),
  },
  {
    name: "developer panel has Monitor tab and renderer",
    ok: files.developerPanel.includes("MONITORING_DASHBOARD_PURPOSE")
      && files.developerPanel.includes("\"monitor\"")
      && files.developerPanel.includes("build_monitoring_tab")
      && files.developerPanel.includes("request_monitoring_dashboard")
      && files.developerPanel.includes("render_monitoring_dashboard"),
  },
  {
    name: "client routes monitoring player_state lookup responses",
    ok: files.networkManager.includes("window_hours")
      && files.networkManager.includes("admin_monitoring_dashboard")
      && files.world.includes("admin_monitoring_dashboard"),
  },
  {
    name: "package and deploy helper include monitoring dashboard check",
    ok: files.packageJson.includes("\"check:monitoring-dashboard\"")
      && files.packageJson.includes("check_monitoring_dashboard_wiring.js")
      && (files.deploy === "" || (
        files.deploy.includes("localMonitoringDashboardWiringCheck")
        && files.deploy.includes("check:monitoring-dashboard")
      )),
  },
  {
    name: "project docs mention monitoring dashboard policy/status",
    ok: files.rules.includes("Monitoring Dashboard")
      && files.handoff.includes("Monitoring dashboard"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[monitoring-dashboard-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[monitoring-dashboard-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[monitoring-dashboard-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[monitoring-dashboard-wiring] success");
