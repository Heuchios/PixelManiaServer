"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const nodemailer = require("nodemailer");
const os = require("os");
const path = require("path");
const WebSocket = require("ws");
const { spawn } = require("child_process");

try {
  require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
} catch (_error) {
  // dotenv is optional for syntax checks and minimal recovery shells.
}

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "ops_dashboard_public");
const HOST = envString("OPS_DASHBOARD_HOST", "127.0.0.1");
const PORT = clampInteger(process.env.OPS_DASHBOARD_PORT || 9090, 1, 65535);
const AUTH_TOKEN = String(process.env.OPS_DASHBOARD_TOKEN || "");
const AUTH_TOKEN_HASH = String(process.env.OPS_DASHBOARD_TOKEN_HASH || "").trim().toLowerCase();
const ADMIN_USERNAME = envString("OPS_DASHBOARD_ADMIN_USERNAME", "admin");
const ADMIN_EMAIL = envString("OPS_DASHBOARD_ADMIN_EMAIL", "");
const ADMIN_PASSWORD_HASH = String(process.env.OPS_DASHBOARD_ADMIN_PASSWORD_HASH || "").trim();
const ACCOUNT_FILE = process.env.OPS_DASHBOARD_ACCOUNT_FILE
  ? path.resolve(process.env.OPS_DASHBOARD_ACCOUNT_FILE)
  : path.join(ROOT_DIR, "ops_dashboard_admin.json");
const SESSION_SECRET = String(process.env.OPS_DASHBOARD_SESSION_SECRET || "").trim();
const SESSION_COOKIE_NAME = "pixelmania_ops_session";
const SESSION_TTL_MS = clampInteger(process.env.OPS_DASHBOARD_SESSION_TTL_HOURS || 12, 1, 168) * 60 * 60 * 1000;
const SESSION_COOKIE_SECURE = envBool("OPS_DASHBOARD_COOKIE_SECURE", false);
const OPS_PUBLIC_BASE_URL = envString("OPS_DASHBOARD_PUBLIC_BASE_URL", `http://127.0.0.1:${PORT}`);
const OPS_EMAIL_VERIFICATION_TTL_MS = clampInteger(process.env.OPS_DASHBOARD_EMAIL_VERIFICATION_TTL_MINUTES || 60, 5, 1440) * 60 * 1000;
const OPS_PASSWORD_RESET_TTL_MS = clampInteger(process.env.OPS_DASHBOARD_PASSWORD_RESET_TTL_MINUTES || 30, 5, 1440) * 60 * 1000;
const OPS_MIN_PASSWORD_LENGTH = clampInteger(process.env.OPS_DASHBOARD_MIN_PASSWORD_LENGTH || 10, 8, 128);
const LOGIN_CODE_ENABLED = envBool("OPS_DASHBOARD_LOGIN_CODE_ENABLED", false);
const LOGIN_CODE_TTL_MS = clampInteger(process.env.OPS_DASHBOARD_LOGIN_CODE_TTL_MINUTES || 10, 2, 60) * 60 * 1000;
const SMTP_HOST = envString("SMTP_HOST", "");
const SMTP_PORT = clampInteger(process.env.SMTP_PORT || 587, 1, 65535);
const SMTP_SECURE = envBool("SMTP_SECURE", false);
const SMTP_USER = envString("SMTP_USER", "");
const SMTP_PASS = String(process.env.SMTP_PASS || "");
const SMTP_FROM = envString("SMTP_FROM", SMTP_USER || "PixelMania Ops <no-reply@pixelmania.local>");
const HEALTH_URL = envString("OPS_DASHBOARD_HEALTH_URL", `http://127.0.0.1:${process.env.PORT || 8080}/health`);
const PM2_APP = envString("OPS_DASHBOARD_PM2_APP", "pixelmania");
const SELF_PM2_APP = envString("OPS_DASHBOARD_SELF_PM2_APP", "pixelmania-ops");
const PM2_ECOSYSTEM = envString("OPS_DASHBOARD_PM2_ECOSYSTEM", "ecosystem.config.js");
const ACTIONS_ENABLED = envBool("OPS_DASHBOARD_ALLOW_CONTROL", false);
const ALLOWED_ACTIONS = parseCsvSet(process.env.OPS_DASHBOARD_ALLOWED_ACTIONS || "restart");
const RESTART_APPS = parsePm2AppList(process.env.OPS_DASHBOARD_RESTART_APPS || `${PM2_APP},pixelmania-a,pixelmania-b`);
const RESTART_COMMAND = envString(
  "OPS_DASHBOARD_RESTART_COMMAND",
  `pm2 startOrReload ${PM2_ECOSYSTEM} --env production --update-env && bash scripts/start_route_production_instances.sh`,
);
const START_COMMAND = envString(
  "OPS_DASHBOARD_START_COMMAND",
  `pm2 startOrReload ${PM2_ECOSYSTEM} --env production --update-env && bash scripts/start_route_production_instances.sh`,
);
const STOP_COMMAND = envString(
  "OPS_DASHBOARD_STOP_COMMAND",
  `for app in ${RESTART_APPS.join(" ")}; do pm2 stop "$app" || true; done; pm2 save`,
);
const ALLOW_STOP_WITH_PLAYERS = envBool("OPS_DASHBOARD_ALLOW_STOP_WITH_PLAYERS", false);
const ALLOW_DEPLOY_WITH_PLAYERS = envBool("OPS_DASHBOARD_ALLOW_DEPLOY_WITH_PLAYERS", false);
const ALLOW_ROLLBACK_WITH_PLAYERS = envBool("OPS_DASHBOARD_ALLOW_ROLLBACK_WITH_PLAYERS", false);
const DEPLOY_COMMAND = String(process.env.OPS_DASHBOARD_DEPLOY_COMMAND || "").trim();
const DEPLOY_CWD = process.env.OPS_DASHBOARD_DEPLOY_CWD ? path.resolve(process.env.OPS_DASHBOARD_DEPLOY_CWD) : ROOT_DIR;
const DEPLOY_REMOTE = envString("OPS_DEPLOY_REMOTE", "origin");
const DEPLOY_BRANCH = envString("OPS_DEPLOY_BRANCH", "main");
const ROLLBACK_COMMAND = String(process.env.OPS_DASHBOARD_ROLLBACK_COMMAND || "").trim();
const ROLLBACK_CWD = process.env.OPS_DASHBOARD_ROLLBACK_CWD ? path.resolve(process.env.OPS_DASHBOARD_ROLLBACK_CWD) : DEPLOY_CWD;
const LOG_FILE = process.env.OPS_DASHBOARD_LOG_FILE ? path.resolve(process.env.OPS_DASHBOARD_LOG_FILE) : "";
const AUDIT_LOG_PATH = process.env.OPS_DASHBOARD_AUDIT_LOG_PATH
  ? path.resolve(process.env.OPS_DASHBOARD_AUDIT_LOG_PATH)
  : path.join(ROOT_DIR, "ops_dashboard_audit.log");
const CONFIRMATION_REQUIRED_ACTIONS = parseCsvSet(process.env.OPS_DASHBOARD_CONFIRM_ACTIONS || "stop,deploy,rollback");
const ROUTE_TARGETS = parseRouteTargets(process.env.OPS_DASHBOARD_ROUTE_TARGETS || [
  "ws-a|pixelmania-a|http://127.0.0.1:18091/health|wss://api.pixelmaniagame.com/ws-a",
  "ws-b|pixelmania-b|http://127.0.0.1:18092/health|wss://api.pixelmaniagame.com/ws-b",
].join(";"));

const MAX_CAPTURE_BYTES = 256 * 1024;
const ACTION_HISTORY_LIMIT = 20;
const DEFAULT_LOG_LINES = clampInteger(process.env.OPS_DASHBOARD_LOG_LINES || 160, 25, 1000);
const CHILD_ENV_SECRET_PREFIXES = ["OPS_DASHBOARD_"];
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
const LOGIN_CODE_ATTEMPT_LIMIT = 5;

let currentAction = null;
const actionHistory = [];
const loginFailures = new Map();
const loginChallenges = new Map();
let adminAccount = null;
let mailTransporter = null;
adminAccount = loadAdminAccount();

if (!isAuthConfigured()) {
  console.error("PixelMania ops dashboard refused to start: set OPS_DASHBOARD_ADMIN_PASSWORD_HASH, OPS_DASHBOARD_TOKEN, or OPS_DASHBOARD_TOKEN_HASH.");
  process.exit(1);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`PixelMania ops dashboard listening on http://${HOST}:${PORT}`);
});

async function handleRequest(request, response) {
  const url = parseRequestUrl(request);
  if (!url) {
    sendJson(response, 400, { ok: false, error: "Bad request." });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = await readJsonBody(request, 16 * 1024);
    const result = await handleLogin(request, response, body);
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/login/verify-code") {
    const body = await readJsonBody(request, 16 * 1024);
    const result = handleLoginCodeVerify(request, response, body);
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    handleLogout(request, response);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/account/reset-request") {
    const body = await readJsonBody(request, 16 * 1024);
    const result = await handlePasswordResetRequest(request, body);
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/account/reset-password") {
    const body = await readJsonBody(request, 16 * 1024);
    const result = await handlePasswordReset(request, response, body);
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === "GET" && url.pathname === "/verify-ops-email") {
    const result = handleVerifyEmailLink(String(url.searchParams.get("token") || ""));
    response.setHeader("Set-Cookie", buildExpiredSessionCookie());
    sendHtml(response, result.status, "PixelMania Ops", result.message);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    if (!requireAuth(request, response)) return;
    const account = getAdminAccount();
    sendJson(response, 200, {
      ok: true,
      email: account.email,
      email_verified: Boolean(account.email_verified),
      auth_mode: request.opsAuth?.mode || "unknown",
      session_expires_at: request.opsAuth?.expires_at || "",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/account") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, buildAccountSnapshot(request.opsAuth));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/account/send-verification") {
    if (!requireAuth(request, response)) return;
    const result = await handleSendVerification(request);
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/account/email") {
    if (!requireAuth(request, response)) return;
    const body = await readJsonBody(request, 16 * 1024);
    const result = await handleChangeEmail(request, body);
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/account/password") {
    if (!requireAuth(request, response)) return;
    const body = await readJsonBody(request, 16 * 1024);
    const result = await handleChangePassword(request, response, body);
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/account/logout-all") {
    if (!requireAuth(request, response)) return;
    const result = handleLogoutAll(request, response);
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, await buildStatusSnapshot());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/deploy-status") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, await buildDeployStatusSnapshot());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/resources") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, await buildResourcesSnapshot());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/logs") {
    if (!requireAuth(request, response)) return;
    const lines = clampInteger(url.searchParams.get("lines") || DEFAULT_LOG_LINES, 25, 1000);
    const target = String(url.searchParams.get("target") || "main");
    sendJson(response, 200, await buildLogsSnapshot(lines, target));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/debug-report") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, await buildDebugReport());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/incident-snapshot") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, await buildIncidentSnapshot());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/database-health") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, await buildDatabaseHealthSnapshot());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/route-tests") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, await buildRouteTestSnapshot());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/actions") {
    if (!requireAuth(request, response)) return;
    sendJson(response, 200, {
      ok: true,
      current_action: currentAction,
      history: actionHistory,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/audit-log") {
    if (!requireAuth(request, response)) return;
    const limit = clampInteger(url.searchParams.get("limit") || 30, 5, 100);
    sendJson(response, 200, await buildAuditLogSnapshot(limit));
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/actions/")) {
    if (!requireAuth(request, response)) return;
    const action = url.pathname.slice("/api/actions/".length).trim().toLowerCase();
    const body = await readJsonBody(request, 16 * 1024);
    const result = await startAction(action, request, body);
    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  serveStatic(url.pathname, response, request.method === "HEAD");
}

async function startAction(action, request, body = {}) {
  const commandSpec = getActionCommand(action);
  if (!commandSpec) {
    return { status: 404, body: { ok: false, error: "Unknown action." } };
  }
  if (!ACTIONS_ENABLED) {
    return {
      status: 403,
      body: {
        ok: false,
        error: "Control actions are disabled. Set OPS_DASHBOARD_ALLOW_CONTROL=true to enable them.",
      },
    };
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return {
      status: 403,
      body: {
        ok: false,
        error: `${action} is not enabled on this dashboard.`,
        allowed_actions: Array.from(ALLOWED_ACTIONS.values()).sort(),
      },
    };
  }
  if (action === "deploy" && !DEPLOY_COMMAND) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "Deploy is not configured. Set OPS_DASHBOARD_DEPLOY_COMMAND to enable it.",
      },
    };
  }
  if (action === "rollback" && !ROLLBACK_COMMAND) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "Rollback is not configured. Set OPS_DASHBOARD_ROLLBACK_COMMAND to enable it.",
      },
    };
  }
  const requiredConfirmation = getRequiredConfirmation(action);
  if (requiredConfirmation && String(body.confirmation || "").trim() !== requiredConfirmation) {
    return {
      status: 412,
      body: {
        ok: false,
        error: `Type ${requiredConfirmation} to confirm ${action}.`,
        confirmation_required: true,
        confirmation: requiredConfirmation,
      },
    };
  }
  if (currentAction) {
    return {
      status: 409,
      body: {
        ok: false,
        error: `${currentAction.action} is already running.`,
        current_action: currentAction,
      },
    };
  }
  const guardedPlayerAction = (action === "stop" && !ALLOW_STOP_WITH_PLAYERS)
    || (action === "deploy" && !ALLOW_DEPLOY_WITH_PLAYERS)
    || (action === "rollback" && !ALLOW_ROLLBACK_WITH_PLAYERS);
  if (guardedPlayerAction) {
    const activePlayers = await getActivePlayerSnapshot();
    if (activePlayers.total > 0) {
      return {
        status: 409,
        body: {
          ok: false,
          error: `${capitalizeAction(action)} blocked: ${activePlayers.total} player${activePlayers.total === 1 ? "" : "s"} online.`,
          players_online: activePlayers.total,
          player_sources: activePlayers.sources,
        },
      };
    }
  }

  const now = new Date().toISOString();
  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  currentAction = {
    id,
    action,
    label: commandSpec.label,
    status: "running",
    started_at: now,
    finished_at: "",
    ok: false,
    code: null,
    timed_out: false,
    stdout: "",
    stderr: "",
  };
  appendAudit("action_started", {
    id,
    action,
    remote: getRemoteAddress(request),
  });

  runCommandSpec(commandSpec).then((result) => {
    const finished = {
      ...currentAction,
      status: result.ok ? "succeeded" : "failed",
      finished_at: new Date().toISOString(),
      ok: Boolean(result.ok),
      code: result.code,
      timed_out: Boolean(result.timedOut),
      stdout: result.stdout,
      stderr: result.stderr,
    };
    actionHistory.unshift(finished);
    actionHistory.splice(ACTION_HISTORY_LIMIT);
    appendAudit("action_finished", {
      id,
      action,
      ok: finished.ok,
      code: finished.code,
      timed_out: finished.timed_out,
    });
    currentAction = null;
  }).catch((error) => {
    const failed = {
      ...currentAction,
      status: "failed",
      finished_at: new Date().toISOString(),
      ok: false,
      code: null,
      timed_out: false,
      stdout: "",
      stderr: error && error.message ? error.message : String(error),
    };
    actionHistory.unshift(failed);
    actionHistory.splice(ACTION_HISTORY_LIMIT);
    appendAudit("action_error", { id, action, error: failed.stderr });
    currentAction = null;
  });

  return {
    status: 202,
    body: {
      ok: true,
      current_action: currentAction,
    },
  };
}

function getActionCommand(action) {
  if (action === "restart") {
    return {
      label: `Restart ${RESTART_APPS.join(", ")}`,
      shellCommand: RESTART_COMMAND,
      timeoutMs: 180_000,
    };
  }
  if (action === "reload") {
    return {
      label: `Reload ${PM2_APP}`,
      command: "pm2",
      args: ["reload", PM2_APP, "--update-env"],
      timeoutMs: 90_000,
    };
  }
  if (action === "start") {
    return {
      label: `Start ${RESTART_APPS.join(", ")}`,
      shellCommand: START_COMMAND,
      timeoutMs: 180_000,
    };
  }
  if (action === "stop") {
    return {
      label: `Stop ${RESTART_APPS.join(", ")}`,
      shellCommand: STOP_COMMAND,
      timeoutMs: 90_000,
    };
  }
  if (action === "deploy") {
    return {
      label: "Deploy",
      shellCommand: DEPLOY_COMMAND,
      cwd: DEPLOY_CWD,
      timeoutMs: 15 * 60_000,
    };
  }
  if (action === "rollback") {
    return {
      label: "Rollback",
      shellCommand: ROLLBACK_COMMAND,
      cwd: ROLLBACK_CWD,
      timeoutMs: 15 * 60_000,
    };
  }
  return null;
}

async function buildStatusSnapshot() {
  const [pm2Result, healthResult, routeResults] = await Promise.all([
    getPm2Snapshot(PM2_APP),
    fetchJson(HEALTH_URL, 5000),
    Promise.all(ROUTE_TARGETS.map((target) => getRouteTargetSnapshot(target))),
  ]);
  const selectedProcess = pm2Result.process || null;
  return {
    ok: true,
    dashboard: {
      now: new Date().toISOString(),
      host: os.hostname(),
      control_enabled: ACTIONS_ENABLED,
      deploy_enabled: Boolean(DEPLOY_COMMAND),
      rollback_enabled: Boolean(ROLLBACK_COMMAND),
      allowed_actions: Array.from(ALLOWED_ACTIONS.values()).sort(),
      confirmation_required_actions: Array.from(CONFIRMATION_REQUIRED_ACTIONS.values()).sort(),
      restart_apps: RESTART_APPS,
      restart_command_configured: Boolean(RESTART_COMMAND),
      start_command_configured: Boolean(START_COMMAND),
      stop_command_configured: Boolean(STOP_COMMAND),
      stop_player_guard_enabled: !ALLOW_STOP_WITH_PLAYERS,
      deploy_player_guard_enabled: !ALLOW_DEPLOY_WITH_PLAYERS,
      rollback_player_guard_enabled: !ALLOW_ROLLBACK_WITH_PLAYERS,
      route_targets: ROUTE_TARGETS.map((target) => ({
        label: target.label,
        pm2_app: target.pm2_app,
        health_url: target.health_url,
        ws_url: target.ws_url,
      })),
      pm2_app: PM2_APP,
      health_url: HEALTH_URL,
      busy: Boolean(currentAction),
    },
    summary: buildSummary(selectedProcess, healthResult),
    process: selectedProcess,
    pm2: {
      ok: pm2Result.ok,
      error: pm2Result.error,
    },
    health: healthResult,
    routes: routeResults,
    current_action: currentAction,
    last_action: actionHistory[0] || null,
  };
}

async function buildDebugReport() {
  const [status, errorLogs] = await Promise.all([
    buildStatusSnapshot(),
    buildErrorLogsSnapshot(120),
  ]);
  const summary = status.summary || {};
  const routes = Array.isArray(status.routes) ? status.routes : [];
  const worlds = getOnlineWorldRows(summary, routes);
  const mainPlayers = Math.max(0, nullableNumber(summary.players_online) || 0);
  const routePlayers = routes.reduce((sum, route) => sum + Math.max(0, nullableNumber(route.players_online) || 0), 0);
  const mainWorlds = Math.max(0, nullableNumber(summary.worlds_loaded) || 0);
  const routeWorlds = routes.reduce((sum, route) => sum + Math.max(0, nullableNumber(route.worlds_loaded) || 0), 0);
  const recentErrors = String(errorLogs.text || "").trim() || "no recent errors/warnings";
  const lines = [
    "PixelMania Debug Report",
    `generated: ${status.dashboard.now}`,
    `host: ${status.dashboard.host}`,
    "",
    "== Summary ==",
    `main: ${summary.online ? "online" : "offline"} (${summary.process_status || "unknown"})`,
    `players: ${mainPlayers + routePlayers}${summary.max_players_per_world ? ` / ${summary.max_players_per_world}` : ""}`,
    `worlds: ${mainWorlds + routeWorlds}`,
    `memory: ${formatBytesForReport(summary.memory_bytes)}`,
    `database: ${summary.database || "unknown"}`,
    `redis: ${summary.redis_ready ? "ready" : "off"}`,
    `tick: ${Number.isFinite(Number(summary.tps)) ? `${Number(summary.tps).toFixed(1)} TPS` : "unknown"}`,
    `controls: ${(status.dashboard.allowed_actions || []).join(", ") || "none"}${status.dashboard.busy ? " (busy)" : ""}`,
    "",
    "== Routes ==",
    ...routes.map((route) => [
      `${route.label || route.pm2_app || "route"}: ${route.ok ? "online" : "offline"}`,
      `  pm2=${route.pm2_status || "unknown"} health=${route.health_ok ? "ok" : "fail"} players=${formatReportNumber(route.players_online)} worlds=${formatReportNumber(route.worlds_loaded)}`,
      `  postgres=${route.postgres_ready ? "ready" : "off"} redis=${route.redis_ready ? "ready" : "off"} memory=${formatBytesForReport(route.memory_bytes)}`,
    ].join("\n")),
    routes.length ? "" : "no route targets",
    "== Online Worlds ==",
    ...(worlds.length ? worlds.map((world) => `${world.world}: ${world.players} player${world.players === 1 ? "" : "s"} (${world.sources.join(" + ")})`) : ["no worlds online"]),
    "",
    "== Last Action ==",
    formatActionForReport(status.current_action || status.last_action),
    "",
    "== Recent Errors / Warnings ==",
    recentErrors,
  ];
  return {
    ok: true,
    generated_at: status.dashboard.now,
    text: lines.join("\n"),
  };
}

async function buildIncidentSnapshot() {
  const generatedAt = new Date().toISOString();
  const [status, resources, deploy, database, routeTests, audit, errorLogs, mainLogs, routeLogs] = await Promise.all([
    buildStatusSnapshot(),
    buildResourcesSnapshot(),
    buildDeployStatusSnapshot(),
    buildDatabaseHealthSnapshot(),
    buildRouteTestSnapshot(),
    buildAuditLogSnapshot(15),
    buildErrorLogsSnapshot(180),
    buildLogsSnapshot(100, "main"),
    Promise.all(ROUTE_TARGETS.map((target) => buildLogsSnapshot(80, target.label))),
  ]);
  const logs = [mainLogs, ...routeLogs].map((entry) => ({
    target: entry.target,
    label: entry.label,
    ok: entry.ok,
    source: entry.source,
    text: entry.text,
    error: entry.error,
  }));
  const bundle = {
    generated_at: generatedAt,
    status,
    resources,
    deploy,
    database,
    route_tests: routeTests,
    audit,
    errors: {
      ok: errorLogs.ok,
      text: errorLogs.text,
      issue_count: countIssueLines(errorLogs.text),
      source: errorLogs.source,
    },
    logs,
  };
  return {
    ok: true,
    generated_at: generatedAt,
    text: formatIncidentSnapshotText(bundle),
    bundle,
  };
}

async function buildDatabaseHealthSnapshot() {
  const targets = [{
    label: "main",
    pm2_app: PM2_APP,
    health_url: HEALTH_URL,
  }, ...ROUTE_TARGETS.map((target) => ({
    label: target.label,
    pm2_app: target.pm2_app,
    health_url: target.health_url,
  }))];
  const checks = await Promise.all(targets.map(async (target) => {
    const health = await fetchJson(target.health_url, 5000);
    return buildPersistenceCheck(target, health);
  }));
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    all_ready: checks.every((check) => check.health_ok && check.postgres_ready && check.redis_ready),
    checks,
  };
}

async function buildRouteTestSnapshot() {
  const results = await Promise.all(ROUTE_TARGETS.map(async (target) => {
    const ws = await testWebSocketRoute(target.ws_url, 6000);
    const health = await fetchJson(target.health_url, 5000);
    return {
      label: target.label,
      pm2_app: target.pm2_app,
      ws_url: target.ws_url,
      health_url: target.health_url,
      ok: Boolean(ws.ok && health.ok),
      websocket: ws,
      health: {
        ok: Boolean(health.ok),
        status: health.status,
        latency_ms: nullableNumber(health.duration_ms),
        error: health.error || "",
      },
    };
  }));
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    all_ready: results.every((result) => result.ok),
    results,
  };
}

async function buildDeployStatusSnapshot() {
  const [status, git] = await Promise.all([
    buildStatusSnapshot(),
    getDeployGitStatus(),
  ]);
  const summary = status.summary || {};
  const routes = Array.isArray(status.routes) ? status.routes : [];
  const mainPlayers = Math.max(0, nullableNumber(summary.players_online) || 0);
  const routePlayers = routes.reduce((sum, route) => sum + Math.max(0, nullableNumber(route.players_online) || 0), 0);
  const playersOnline = mainPlayers + routePlayers;
  const healthChecks = buildDeployHealthChecks(summary, routes);
  const deployAction = findDeployAction();
  const rollbackAction = findRollbackAction();
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    git,
    safety: {
      control_enabled: Boolean(status.dashboard.control_enabled),
      deploy_enabled: Boolean(status.dashboard.deploy_enabled),
      rollback_enabled: Boolean(status.dashboard.rollback_enabled),
      deploy_guard_enabled: Boolean(status.dashboard.deploy_player_guard_enabled),
      rollback_guard_enabled: Boolean(status.dashboard.rollback_player_guard_enabled),
      players_online: playersOnline,
      blocked_by_players: Boolean(status.dashboard.deploy_player_guard_enabled && playersOnline > 0),
      rollback_blocked_by_players: Boolean(status.dashboard.rollback_player_guard_enabled && playersOnline > 0),
      busy: Boolean(status.dashboard.busy),
      current_action: status.current_action,
      last_deploy: deployAction,
      last_rollback: rollbackAction,
    },
    health: {
      all_ready: healthChecks.every((check) => check.ok),
      checks: healthChecks,
    },
  };
}

async function buildResourcesSnapshot() {
  const [disk, pm2Map] = await Promise.all([
    getDiskSnapshot(),
    getPm2ProcessMap(),
  ]);
  const processTargets = [{
    label: "main",
    pm2_app: PM2_APP,
  }, ...ROUTE_TARGETS.map((target) => ({
    label: target.label || target.pm2_app,
    pm2_app: target.pm2_app,
  })), {
    label: "ops",
    pm2_app: SELF_PM2_APP,
  }];
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    host: getHostResourceSnapshot(disk),
    processes: processTargets.map((target) => {
      const processSnapshot = pm2Map.get(target.pm2_app) || null;
      const env = processSnapshot && processSnapshot.pm2_env ? processSnapshot.pm2_env : {};
      return {
        label: target.label,
        pm2_app: target.pm2_app,
        found: Boolean(processSnapshot),
        status: String(env.status || "missing").toLowerCase(),
        pid: nullableNumber(processSnapshot?.pid),
        memory_bytes: nullableNumber(processSnapshot?.monit?.memory),
        cpu_percent: nullableNumber(processSnapshot?.monit?.cpu),
        restarts: nullableNumber(env.restart_time),
        uptime_ms: nullableNumber(env.pm_uptime) ? Math.max(0, Date.now() - Number(env.pm_uptime)) : null,
      };
    }),
  };
}

async function buildAuditLogSnapshot(limit) {
  const tail = await readFileTail(AUDIT_LOG_PATH, Math.max(200, limit * 4));
  if (!tail.ok) {
    return {
      ok: false,
      source: AUDIT_LOG_PATH,
      entries: [],
      error: tail.error,
    };
  }

  const events = parseAuditEvents(tail.text);
  const records = collapseAuditEvents(events)
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))
    .slice(0, limit);
  return {
    ok: true,
    source: AUDIT_LOG_PATH,
    entries: records,
    error: "",
  };
}

async function getActivePlayerSnapshot() {
  const [mainHealth, routeResults] = await Promise.all([
    fetchJson(HEALTH_URL, 5000),
    Promise.all(ROUTE_TARGETS.map((target) => getRouteTargetSnapshot(target))),
  ]);
  const sources = [];
  const mainPlayers = getHealthPlayerCount(mainHealth);
  if (mainPlayers > 0) {
    sources.push({ label: PM2_APP, players_online: mainPlayers });
  }
  for (const route of routeResults) {
    const routePlayers = nullableNumber(route.players_online);
    if (routePlayers > 0) {
      sources.push({ label: route.label || route.pm2_app, players_online: routePlayers });
    }
  }
  return {
    total: sources.reduce((sum, source) => sum + source.players_online, 0),
    sources,
  };
}

function getHealthPlayerCount(healthResult) {
  if (!healthResult || !healthResult.ok || !healthResult.payload) return 0;
  const persistence = healthResult.payload.persistence || {};
  const worldIndex = persistence.world_index || {};
  return Math.max(0, nullableNumber(worldIndex.indexed_player_count) || 0);
}

function capitalizeAction(action) {
  const clean = String(action || "").trim().toLowerCase();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Action";
}

async function getRouteTargetSnapshot(target) {
  const [pm2Result, healthResult] = await Promise.all([
    getPm2Snapshot(target.pm2_app),
    fetchJson(target.health_url, 5000),
  ]);
  const processSnapshot = pm2Result.process || null;
  const healthPayload = healthResult && healthResult.ok ? healthResult.payload || {} : {};
  const persistence = healthPayload.persistence || {};
  const worldIndex = persistence.world_index || {};
  const pm2Status = String(processSnapshot?.pm2_env?.status || "unknown").toLowerCase();
  return {
    label: target.label,
    pm2_app: target.pm2_app,
    ws_url: target.ws_url,
    health_url: target.health_url,
    ok: Boolean((healthResult && healthResult.ok && healthPayload.ok !== false) || pm2Status === "online"),
    pm2_status: pm2Status,
    health_ok: Boolean(healthResult && healthResult.ok && healthPayload.ok !== false),
    health_error: healthResult && healthResult.error ? healthResult.error : "",
    players_online: nullableNumber(worldIndex.indexed_player_count),
    worlds_loaded: nullableNumber(worldIndex.active_world_count),
    sample_worlds: Array.isArray(worldIndex.sample_worlds) ? worldIndex.sample_worlds : [],
    postgres_ready: Boolean(persistence.postgres_ready),
    redis_ready: Boolean(persistence.redis_ready),
    memory_bytes: nullableNumber(processSnapshot?.monit?.memory),
    cpu_percent: nullableNumber(processSnapshot?.monit?.cpu),
  };
}

function buildPersistenceCheck(target, healthResult) {
  const payload = healthResult && healthResult.ok ? healthResult.payload || {} : {};
  const persistence = payload.persistence || {};
  const redisStats = persistence.redis_stats || {};
  const serverTick = persistence.server_tick || {};
  const worldIndex = persistence.world_index || {};
  const queue = persistence.persistence_queue || {};
  return {
    label: target.label,
    pm2_app: target.pm2_app,
    health_url: target.health_url,
    health_ok: Boolean(healthResult && healthResult.ok && payload.ok !== false),
    health_status: nullableNumber(healthResult?.status),
    health_latency_ms: nullableNumber(healthResult?.duration_ms),
    health_error: healthResult?.error || "",
    postgres_ready: Boolean(persistence.postgres_ready),
    postgres_authoritative: Boolean(persistence.postgres_authoritative),
    redis_ready: Boolean(persistence.redis_ready),
    redis_enabled: Boolean(redisStats.enabled),
    redis_key_prefix: String(redisStats.key_prefix || ""),
    redis_key_counts: redisStats.key_counts && typeof redisStats.key_counts === "object" ? redisStats.key_counts : {},
    active_world_count: nullableNumber(worldIndex.active_world_count),
    indexed_player_count: nullableNumber(worldIndex.indexed_player_count),
    pending_persistence_writes: nullableNumber(queue.pending_persistence_writes),
    pending_world_save_timers: nullableNumber(queue.pending_world_save_timers),
    pending_world_json_backups: nullableNumber(queue.pending_world_json_backups),
    tps: nullableNumber(serverTick.tps),
    event_loop_lag_ms: nullableNumber(serverTick.event_loop_lag_ms),
    max_event_loop_lag_ms: nullableNumber(serverTick.max_event_loop_lag_ms),
  };
}

function testWebSocketRoute(wsUrl, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let parsed;
    try {
      parsed = new URL(wsUrl);
    } catch (error) {
      resolve({
        ok: false,
        status: "invalid",
        latency_ms: Date.now() - startedAt,
        error: error.message,
      });
      return;
    }
    if (!["ws:", "wss:"].includes(parsed.protocol)) {
      resolve({
        ok: false,
        status: "invalid",
        latency_ms: Date.now() - startedAt,
        error: "Route URL is not a websocket URL.",
      });
      return;
    }

    let settled = false;
    let ws;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (ws) ws.close();
      } catch (_error) {
        // The socket may already be closed after a failed handshake.
      }
      resolve({
        ...payload,
        latency_ms: Date.now() - startedAt,
      });
    };
    const timer = setTimeout(() => {
      finish({
        ok: false,
        status: "timeout",
        error: "WebSocket route timed out.",
      });
    }, timeoutMs);
    try {
      ws = new WebSocket(parsed.toString(), {
        handshakeTimeout: timeoutMs,
        perMessageDeflate: false,
      });
    } catch (error) {
      finish({
        ok: false,
        status: "error",
        error: error && error.message ? error.message : String(error),
      });
      return;
    }
    ws.once("open", () => {
      finish({
        ok: true,
        status: "open",
        error: "",
      });
    });
    ws.once("error", (error) => {
      finish({
        ok: false,
        status: "error",
        error: error && error.message ? error.message : String(error),
      });
    });
    ws.once("unexpected-response", (_request, response) => {
      finish({
        ok: false,
        status: `http ${response.statusCode || 0}`,
        error: "Unexpected websocket response.",
      });
    });
    ws.once("close", (code, reason) => {
      finish({
        ok: false,
        status: `closed ${code || 0}`,
        error: reason ? reason.toString("utf8") : "WebSocket closed before opening.",
      });
    });
  });
}

function formatIncidentSnapshotText(bundle) {
  const status = bundle.status || {};
  const summary = status.summary || {};
  const database = bundle.database || {};
  const routeTests = bundle.route_tests || {};
  const resources = bundle.resources || {};
  const host = resources.host || {};
  const deploy = bundle.deploy || {};
  const git = deploy.git || {};
  const errors = bundle.errors || {};
  const checks = Array.isArray(database.checks) ? database.checks : [];
  const routes = Array.isArray(routeTests.results) ? routeTests.results : [];
  const audit = Array.isArray(bundle.audit?.entries) ? bundle.audit.entries : [];
  return [
    "PixelMania Incident Snapshot",
    `generated: ${bundle.generated_at}`,
    `host: ${status.dashboard?.host || host.hostname || os.hostname()}`,
    "",
    "== Summary ==",
    `online: ${summary.online ? "yes" : "no"}`,
    `players: ${formatReportNumber(getIncidentTotalPlayers(status))}`,
    `worlds: ${formatReportNumber(getIncidentTotalWorlds(status))}`,
    `memory: ${formatBytesForReport(summary.memory_bytes)}`,
    `cpu: ${formatReportNumber(summary.cpu_percent)}%`,
    `tick: ${Number.isFinite(Number(summary.tps)) ? `${Number(summary.tps).toFixed(1)} TPS` : "unknown"}`,
    `event loop lag: ${formatReportNumber(summary.event_loop_lag_ms)} ms`,
    "",
    "== Database / Redis ==",
    ...(checks.length ? checks.map((check) => [
      `${check.label}: health=${check.health_ok ? "ok" : "fail"} ${formatReportNumber(check.health_latency_ms)}ms`,
      `  postgres=${check.postgres_ready ? "ready" : "off"} authoritative=${check.postgres_authoritative ? "yes" : "no"} redis=${check.redis_ready ? "ready" : "off"}`,
      `  players=${formatReportNumber(check.indexed_player_count)} worlds=${formatReportNumber(check.active_world_count)} pending_writes=${formatReportNumber(check.pending_persistence_writes)}`,
    ].join("\n")) : ["no database checks"]),
    "",
    "== WebSocket Route Tests ==",
    ...(routes.length ? routes.map((route) => [
      `${route.label}: ${route.ok ? "ok" : "fail"}`,
      `  ws=${route.websocket?.status || "unknown"} ${formatReportNumber(route.websocket?.latency_ms)}ms ${route.websocket?.error || ""}`.trimEnd(),
      `  health=${route.health?.ok ? "ok" : "fail"} ${formatReportNumber(route.health?.latency_ms)}ms`,
    ].join("\n")) : ["no routes configured"]),
    "",
    "== Deploy ==",
    `current: ${git.current?.short || "--"} ${git.current?.subject || ""}`.trimEnd(),
    `remote: ${git.remote?.short || "--"} ${git.remote?.subject || ""}`.trimEnd(),
    `rollback: ${git.rollback_target?.short || "--"} ${git.rollback_target?.subject || ""}`.trimEnd(),
    `guard: ${deploy.safety?.players_online || 0} players online`,
    "",
    "== Recent Audit ==",
    ...(audit.length ? audit.slice(0, 8).map((entry) => `${entry.updated_at || entry.started_at || "--"} ${entry.action || "action"} ${entry.status || "unknown"}`) : ["no audit entries"]),
    "",
    "== Recent Issues ==",
    `issue lines: ${formatReportNumber(errors.issue_count)}`,
    String(errors.text || "no recent errors/warnings").trim(),
  ].join("\n");
}

function getIncidentTotalPlayers(status) {
  const summary = status.summary || {};
  const routes = Array.isArray(status.routes) ? status.routes : [];
  return Math.max(0, nullableNumber(summary.players_online) || 0)
    + routes.reduce((sum, route) => sum + Math.max(0, nullableNumber(route.players_online) || 0), 0);
}

function getIncidentTotalWorlds(status) {
  const summary = status.summary || {};
  const routes = Array.isArray(status.routes) ? status.routes : [];
  return Math.max(0, nullableNumber(summary.worlds_loaded) || 0)
    + routes.reduce((sum, route) => sum + Math.max(0, nullableNumber(route.worlds_loaded) || 0), 0);
}

function countIssueLines(text) {
  return filterIssueLines(text)
    .filter((line) => line && !line.startsWith("==") && !/^no recent errors\/warnings$/i.test(line))
    .length;
}

function buildSummary(pm2Process, healthResult) {
  const health = healthResult && healthResult.ok ? healthResult.payload || {} : {};
  const persistence = health.persistence || {};
  const worldIndex = persistence.world_index || {};
  const serverTick = persistence.server_tick || {};
  const playerNetwork = persistence.player_network || {};
  const worldNetwork = persistence.world_network || {};
  const pm2Env = pm2Process && pm2Process.pm2_env ? pm2Process.pm2_env : {};
  const pm2Status = String(pm2Env.status || "").toLowerCase();
  const healthOnline = Boolean(healthResult && healthResult.ok && health.ok !== false);
  const processOnline = pm2Status === "online" || pm2Status === "launching";
  const uptimeMs = Number(pm2Env.pm_uptime || 0) > 0 ? Date.now() - Number(pm2Env.pm_uptime) : 0;

  return {
    online: Boolean(healthOnline || processOnline),
    process_status: pm2Status || "unknown",
    uptime_ms: Math.max(0, Math.trunc(uptimeMs || 0)),
    memory_bytes: Number(pm2Process?.monit?.memory || 0),
    cpu_percent: Number(pm2Process?.monit?.cpu || 0),
    players_online: nullableNumber(worldIndex.indexed_player_count),
    max_players_per_world: nullableNumber(health.features?.max_players_per_world),
    worlds_loaded: nullableNumber(worldIndex.active_world_count),
    largest_world_population: nullableNumber(worldIndex.largest_world_population),
    database: persistence.postgres_ready ? "Postgres" : "offline",
    postgres_ready: Boolean(persistence.postgres_ready),
    postgres_authoritative: Boolean(persistence.postgres_authoritative),
    redis_ready: Boolean(persistence.redis_ready),
    tps: nullableNumber(serverTick.tps),
    event_loop_lag_ms: nullableNumber(serverTick.event_loop_lag_ms),
    inbound_bytes_received: nullableNumber(playerNetwork.inbound_bytes_received),
    outbound_bytes_sent: nullableNumber(playerNetwork.outbound_bytes_sent),
    pending_world_updates: nullableNumber(worldNetwork.pending_world_updates),
    sample_worlds: Array.isArray(worldIndex.sample_worlds) ? worldIndex.sample_worlds : [],
  };
}

async function buildLogsSnapshot(lines, targetId = "main") {
  const cleanTargetId = normalizeLogTargetId(targetId);
  if (cleanTargetId === "errors") {
    return buildErrorLogsSnapshot(lines);
  }

  const target = getLogTarget(cleanTargetId);
  if (!target) {
    return {
      ok: false,
      target: cleanTargetId,
      label: cleanTargetId || "unknown",
      source: "",
      text: "",
      error: `Unknown log target: ${targetId}`,
      current_action: currentAction,
      history: actionHistory,
    };
  }

  const logs = await readTargetLogs(target, lines);
  return {
    ok: logs.ok,
    target: target.id,
    label: target.label,
    source: logs.source,
    text: logs.text,
    error: logs.ok ? "" : logs.error,
    current_action: currentAction,
    history: actionHistory,
  };
}

async function buildErrorLogsSnapshot(lines) {
  const targets = getLogTargets();
  const results = await Promise.all(targets.map(async (target) => ({
    target,
    logs: await readTargetLogs(target, lines),
  })));

  const sections = results.map(({ target, logs }) => {
    if (!logs.ok) {
      return `== ${target.label} ==\nCould not read logs: ${logs.error || "unknown error"}`;
    }
    const issues = filterIssueLines(logs.text);
    return `== ${target.label} ==\n${issues.length ? issues.join("\n") : "no recent errors/warnings"}`;
  });

  return {
    ok: results.some((result) => result.logs.ok),
    target: "errors",
    label: "errors",
    source: targets.map((target) => target.pm2_app || target.log_file || target.id).join(", "),
    text: sections.join("\n\n").trim(),
    error: "",
    current_action: currentAction,
    history: actionHistory,
  };
}

async function readTargetLogs(target, lines) {
  if (target.log_file) {
    const tail = await readFileTail(target.log_file, lines);
    return {
      ok: tail.ok,
      source: target.log_file,
      text: tail.text,
      error: tail.error,
    };
  }

  const result = await runProcess("pm2", ["logs", target.pm2_app, "--nostream", "--lines", String(lines), "--raw"], {
    timeoutMs: 10_000,
  });
  return {
    ok: result.ok,
    source: `pm2 logs ${target.pm2_app}`,
    text: cleanPm2LogText(stripAnsi(`${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`)),
    error: result.ok ? "" : "Could not read PM2 logs.",
  };
}

function getLogTargets() {
  const targets = [{
    id: "main",
    label: "main",
    pm2_app: PM2_APP,
    log_file: LOG_FILE,
  }];
  for (const route of ROUTE_TARGETS) {
    const label = String(route.label || route.pm2_app || "").trim();
    const id = normalizeLogTargetId(label || route.pm2_app);
    if (!id) continue;
    targets.push({
      id,
      label: label || id,
      pm2_app: route.pm2_app,
      log_file: "",
    });
  }
  return targets;
}

function getLogTarget(targetId) {
  const cleanTargetId = normalizeLogTargetId(targetId);
  return getLogTargets().find((target) => target.id === cleanTargetId) || null;
}

function normalizeLogTargetId(targetId) {
  return String(targetId || "").trim().toLowerCase();
}

function filterIssueLines(text) {
  const issuePattern = /\b(error|warn|warning|failed|failure|exception|rejected|rejection|fatal|crash|timeout|timed out|trace)\b/i;
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => issuePattern.test(line))
    .slice(-200);
}

function cleanPm2LogText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("[TAILING] Tailing last "))
    .join("\n")
    .trim();
}

async function getDeployGitStatus() {
  const base = {
    ok: false,
    cwd: DEPLOY_CWD,
    remote: DEPLOY_REMOTE,
    branch: DEPLOY_BRANCH,
    current_commit: "",
    current_short: "",
    current_subject: "",
    remote_commit: "",
    remote_short: "",
    remote_subject: "",
    rollback_commit: "",
    rollback_short: "",
    rollback_subject: "",
    rollback_available: false,
    rollback_error: "",
    up_to_date: false,
    ahead: null,
    behind: null,
    dirty: false,
    dirty_count: 0,
    tracked_dirty_count: 0,
    untracked_count: 0,
    tracked_dirty_files: [],
    untracked_files: [],
    deploy_blocking_dirty: false,
    status: "",
    error: "",
  };

  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], 5000);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return {
      ...base,
      error: inside.stderr || inside.stdout || `${DEPLOY_CWD} is not a git checkout.`,
    };
  }

  const fetchResult = await runGit(["fetch", "--quiet", DEPLOY_REMOTE, DEPLOY_BRANCH], 20_000);
  const [currentCommit, currentSubject, remoteCommit, remoteSubject, rollbackCommit, rollbackSubject, countResult, dirtyResult] = await Promise.all([
    runGit(["rev-parse", "HEAD"], 5000),
    runGit(["show", "-s", "--format=%s", "HEAD"], 5000),
    runGit(["rev-parse", `${DEPLOY_REMOTE}/${DEPLOY_BRANCH}`], 5000),
    runGit(["show", "-s", "--format=%s", `${DEPLOY_REMOTE}/${DEPLOY_BRANCH}`], 5000),
    runGit(["rev-parse", "HEAD~1"], 5000),
    runGit(["show", "-s", "--format=%s", "HEAD~1"], 5000),
    runGit(["rev-list", "--left-right", "--count", `HEAD...${DEPLOY_REMOTE}/${DEPLOY_BRANCH}`], 5000),
    runGit(["status", "--short"], 5000),
  ]);

  const currentHash = currentCommit.ok ? currentCommit.stdout.trim() : "";
  const remoteHash = remoteCommit.ok ? remoteCommit.stdout.trim() : "";
  const rollbackHash = rollbackCommit.ok ? rollbackCommit.stdout.trim() : "";
  const counts = countResult.ok ? countResult.stdout.trim().split(/\s+/).map((value) => Number(value)) : [];
  const ahead = Number.isFinite(counts[0]) ? counts[0] : null;
  const behind = Number.isFinite(counts[1]) ? counts[1] : null;
  const statusLines = dirtyResult.ok && dirtyResult.stdout ? dirtyResult.stdout.split(/\r?\n/).filter(Boolean) : [];
  const dirtySummary = summarizeGitStatusLines(statusLines);

  return {
    ...base,
    ok: Boolean(currentHash && remoteHash && fetchResult.ok),
    current_commit: currentHash,
    current_short: currentHash.slice(0, 7),
    current_subject: currentSubject.ok ? currentSubject.stdout.trim() : "",
    remote_commit: remoteHash,
    remote_short: remoteHash.slice(0, 7),
    remote_subject: remoteSubject.ok ? remoteSubject.stdout.trim() : "",
    rollback_commit: rollbackHash,
    rollback_short: rollbackHash.slice(0, 7),
    rollback_subject: rollbackSubject.ok ? rollbackSubject.stdout.trim() : "",
    rollback_available: Boolean(rollbackHash),
    rollback_error: rollbackCommit.ok ? "" : (rollbackCommit.stderr || rollbackCommit.stdout || "No previous commit available."),
    up_to_date: Boolean(currentHash && remoteHash && currentHash === remoteHash),
    ahead,
    behind,
    dirty: statusLines.length > 0,
    dirty_count: statusLines.length,
    tracked_dirty_count: dirtySummary.trackedDirtyFiles.length,
    untracked_count: dirtySummary.untrackedFiles.length,
    tracked_dirty_files: dirtySummary.trackedDirtyFiles.slice(0, 12),
    untracked_files: dirtySummary.untrackedFiles.slice(0, 12),
    deploy_blocking_dirty: dirtySummary.trackedDirtyFiles.length > 0,
    status: statusLines.slice(0, 20).join("\n"),
    error: fetchResult.ok ? "" : (fetchResult.stderr || fetchResult.stdout || "git fetch failed"),
  };
}

function runGit(args, timeoutMs) {
  return runProcess("git", args, {
    cwd: DEPLOY_CWD,
    timeoutMs,
  });
}

function buildDeployHealthChecks(summary, routes) {
  const checks = [{
    label: "main",
    ok: Boolean(summary.online && summary.postgres_ready && summary.redis_ready),
    detail: `${summary.process_status || "unknown"} · postgres ${summary.postgres_ready ? "ready" : "off"} · redis ${summary.redis_ready ? "ready" : "off"}`,
  }];
  for (const route of routes) {
    checks.push({
      label: route.label || route.pm2_app || "route",
      ok: Boolean(route.ok && route.health_ok && route.postgres_ready && route.redis_ready),
      detail: `${route.pm2_status || "unknown"} · health ${route.health_ok ? "ok" : "fail"} · postgres ${route.postgres_ready ? "ready" : "off"} · redis ${route.redis_ready ? "ready" : "off"}`,
    });
  }
  checks.push({
    label: "Postgres",
    ok: Boolean(summary.postgres_ready && routes.every((route) => route.postgres_ready)),
    detail: "main + routes",
  });
  checks.push({
    label: "Redis",
    ok: Boolean(summary.redis_ready && routes.every((route) => route.redis_ready)),
    detail: "main + routes",
  });
  return checks;
}

function summarizeGitStatusLines(lines) {
  const trackedDirtyFiles = [];
  const untrackedFiles = [];
  for (const line of lines) {
    const status = String(line || "").slice(0, 2);
    const file = String(line || "").slice(3).trim();
    if (!file) continue;
    if (status === "??") {
      untrackedFiles.push(file);
    } else if (status !== "!!") {
      trackedDirtyFiles.push(file);
    }
  }
  return { trackedDirtyFiles, untrackedFiles };
}

function getHostResourceSnapshot(disk) {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = Math.max(0, totalMemory - freeMemory);
  const cpuCount = Math.max(1, os.cpus().length);
  const loadAverage = os.loadavg();
  const oneMinuteLoad = Number(loadAverage[0] || 0);
  const cpuPercentEstimate = Math.max(0, Math.min(100, (oneMinuteLoad / cpuCount) * 100));
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpu_count: cpuCount,
    load_average_1m: oneMinuteLoad,
    cpu_percent_estimate: cpuPercentEstimate,
    memory_total_bytes: totalMemory,
    memory_free_bytes: freeMemory,
    memory_used_bytes: usedMemory,
    memory_percent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : null,
    uptime_seconds: os.uptime(),
    disk,
  };
}

async function getDiskSnapshot() {
  const result = await runProcess("df", ["-Pk", ROOT_DIR], { timeoutMs: 5000 });
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr || result.stdout || "df failed",
    };
  }
  const lines = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  const parts = lines.length >= 2 ? lines[1].trim().split(/\s+/) : [];
  if (parts.length < 6) {
    return {
      ok: false,
      error: "Could not parse df output.",
    };
  }
  const blocks = Number(parts[1]);
  const used = Number(parts[2]);
  const available = Number(parts[3]);
  const percent = Number(String(parts[4]).replace("%", ""));
  return {
    ok: true,
    filesystem: parts[0],
    mount: parts.slice(5).join(" "),
    size_bytes: Number.isFinite(blocks) ? blocks * 1024 : null,
    used_bytes: Number.isFinite(used) ? used * 1024 : null,
    available_bytes: Number.isFinite(available) ? available * 1024 : null,
    used_percent: Number.isFinite(percent) ? percent : null,
  };
}

async function getPm2ProcessMap() {
  const result = await runProcess("pm2", ["jlist"], { timeoutMs: 8000 });
  const map = new Map();
  if (!result.ok) return map;
  try {
    const apps = JSON.parse(result.stdout || "[]");
    if (!Array.isArray(apps)) return map;
    for (const app of apps) {
      const name = String(app?.name || "");
      if (name) map.set(name, sanitizePm2Process(app));
    }
  } catch (_error) {
    return new Map();
  }
  return map;
}

function findDeployAction() {
  if (currentAction && currentAction.action === "deploy") return currentAction;
  return actionHistory.find((action) => action && action.action === "deploy") || null;
}

function findRollbackAction() {
  if (currentAction && currentAction.action === "rollback") return currentAction;
  return actionHistory.find((action) => action && action.action === "rollback") || null;
}

function parseAuditEvents(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return null;
      }
    })
    .filter((entry) => entry && typeof entry === "object");
}

function collapseAuditEvents(events) {
  const byId = new Map();
  for (const entry of events) {
    const id = String(entry.id || "").trim();
    if (!id) continue;
    const existing = byId.get(id) || {
      id,
      action: String(entry.action || "action"),
      remote: "",
      started_at: "",
      finished_at: "",
      updated_at: "",
      status: "unknown",
      ok: null,
      code: null,
      timed_out: false,
      error: "",
    };
    existing.action = String(entry.action || existing.action || "action");
    existing.updated_at = String(entry.at || existing.updated_at || "");
    if (entry.remote) existing.remote = String(entry.remote);
    if (entry.event === "action_started") {
      existing.started_at = String(entry.at || "");
      existing.status = "running";
      existing.ok = null;
    } else if (entry.event === "action_finished") {
      existing.finished_at = String(entry.at || "");
      existing.status = entry.ok ? "succeeded" : "failed";
      existing.ok = Boolean(entry.ok);
      existing.code = entry.code === null || entry.code === undefined ? null : nullableNumber(entry.code);
      existing.timed_out = Boolean(entry.timed_out);
    } else if (entry.event === "action_error") {
      existing.finished_at = String(entry.at || "");
      existing.status = "failed";
      existing.ok = false;
      existing.error = String(entry.error || "");
    }
    byId.set(id, existing);
  }
  return Array.from(byId.values());
}

function getOnlineWorldRows(summary, routes) {
  const worldsByName = new Map();
  addWorldRowsForReport(worldsByName, "main", summary.sample_worlds || []);
  for (const route of routes) {
    addWorldRowsForReport(worldsByName, route.label || route.pm2_app || "route", route.sample_worlds || []);
  }
  return Array.from(worldsByName.values()).sort((left, right) => {
    const playerCompare = Number(right.players || 0) - Number(left.players || 0);
    if (playerCompare !== 0) return playerCompare;
    return String(left.world || "").localeCompare(String(right.world || ""));
  });
}

function addWorldRowsForReport(worldsByName, source, worlds) {
  if (!Array.isArray(worlds)) return;
  for (const world of worlds) {
    const worldName = String(world && world.world ? world.world : "unknown").trim() || "unknown";
    const players = Math.max(0, nullableNumber(world && world.players) || 0);
    const existing = worldsByName.get(worldName) || {
      world: worldName,
      players: 0,
      sources: [],
    };
    existing.players += players;
    if (!existing.sources.includes(source)) {
      existing.sources.push(source);
    }
    worldsByName.set(worldName, existing);
  }
}

function formatActionForReport(action) {
  if (!action) return "none";
  return [
    `${action.label || action.action || "action"}: ${action.status || "unknown"}`,
    action.started_at ? `started=${action.started_at}` : "",
    action.finished_at ? `finished=${action.finished_at}` : "",
    action.code !== null && action.code !== undefined ? `exit_code=${action.code}` : "",
  ].filter(Boolean).join("\n");
}

function formatReportNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "unknown";
}

function formatBytesForReport(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "unknown";
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let current = number;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current >= 10 ? current.toFixed(0) : current.toFixed(1)} ${units[unitIndex]}`;
}

async function getPm2Snapshot(appName = PM2_APP) {
  const result = await runProcess("pm2", ["jlist"], { timeoutMs: 8000 });
  if (!result.ok) {
    return {
      ok: false,
      error: stripAnsi(result.stderr || result.stdout || "pm2 jlist failed"),
      process: null,
    };
  }

  try {
    const apps = JSON.parse(result.stdout || "[]");
    const match = Array.isArray(apps)
      ? apps.find((app) => String(app?.name || "") === appName) || null
      : null;
    return {
      ok: true,
      error: match ? "" : `PM2 app ${appName} was not found.`,
      process: match ? sanitizePm2Process(match) : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error),
      process: null,
    };
  }
}

function getRequiredConfirmation(action) {
  const cleanAction = String(action || "").trim().toLowerCase();
  return CONFIRMATION_REQUIRED_ACTIONS.has(cleanAction) ? cleanAction.toUpperCase() : "";
}

function sanitizePm2Process(app) {
  const env = app.pm2_env || {};
  return {
    name: String(app.name || ""),
    pid: nullableNumber(app.pid),
    pm_id: nullableNumber(app.pm_id),
    monit: {
      memory: nullableNumber(app.monit?.memory),
      cpu: nullableNumber(app.monit?.cpu),
    },
    pm2_env: {
      status: String(env.status || ""),
      pm_uptime: nullableNumber(env.pm_uptime),
      restart_time: nullableNumber(env.restart_time),
      unstable_restarts: nullableNumber(env.unstable_restarts),
      exec_mode: String(env.exec_mode || ""),
      node_version: String(env.node_version || ""),
    },
  };
}

function runCommandSpec(spec) {
  if (spec.shellCommand) {
    return runProcess(spec.shellCommand, [], {
      cwd: spec.cwd || ROOT_DIR,
      shell: true,
      timeoutMs: spec.timeoutMs || 60_000,
    });
  }
  return runProcess(spec.command, spec.args || [], {
    cwd: spec.cwd || ROOT_DIR,
    timeoutMs: spec.timeoutMs || 60_000,
  });
}

function runProcess(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const timeoutMs = Math.max(1000, Math.trunc(Number(options.timeoutMs) || 60_000));
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT_DIR,
      env: options.env || buildChildEnv(),
      shell: options.shell === true || process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 1000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        timedOut,
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(error && error.message ? error.message : String(error)),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        timedOut,
        stdout: stripAnsi(stdout).trim(),
        stderr: stripAnsi(stderr).trim(),
      });
    });
  });
}

function appendLimited(existing, chunk) {
  const next = existing + chunk.toString("utf8");
  if (next.length <= MAX_CAPTURE_BYTES) return next;
  return next.slice(next.length - MAX_CAPTURE_BYTES);
}

function buildChildEnv() {
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (CHILD_ENV_SECRET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete childEnv[key];
    }
  }
  return childEnv;
}

function fetchJson(targetUrl, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (error) {
      resolve({ ok: false, status: 0, duration_ms: Date.now() - startedAt, error: error.message, payload: null });
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const request = client.get(parsed, {
      timeout: timeoutMs,
      headers: { Accept: "application/json" },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body = appendLimited(body, chunk);
      });
      response.on("end", () => {
        try {
          const payload = JSON.parse(body || "{}");
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            duration_ms: Date.now() - startedAt,
            error: "",
            payload,
          });
        } catch (error) {
          resolve({
            ok: false,
            status: response.statusCode,
            duration_ms: Date.now() - startedAt,
            error: error && error.message ? error.message : String(error),
            payload: null,
          });
        }
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("Health request timed out."));
    });
    request.on("error", (error) => {
      resolve({
        ok: false,
        status: 0,
        duration_ms: Date.now() - startedAt,
        error: error && error.message ? error.message : String(error),
        payload: null,
      });
    });
  });
}

async function readFileTail(filePath, lines) {
  try {
    const stats = await fs.promises.stat(filePath);
    const bytesToRead = Math.min(stats.size, 256 * 1024);
    const handle = await fs.promises.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, Math.max(0, stats.size - bytesToRead));
      const text = buffer.toString("utf8").split(/\r?\n/).slice(-lines).join("\n");
      return { ok: true, text, error: "" };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return {
      ok: false,
      text: "",
      error: error && error.message ? error.message : String(error),
    };
  }
}

function serveStatic(pathname, response, headOnly) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(cleanPath);
  const fullPath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { ok: false, error: "Forbidden." });
    return;
  }

  fs.readFile(fullPath, (error, content) => {
    if (error) {
      sendJson(response, 404, { ok: false, error: "Not found." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": getMimeType(fullPath),
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    if (!headOnly) response.end(content);
    else response.end();
  });
}

function requireAuth(request, response) {
  const authInfo = getAuthInfo(request);
  if (authInfo.ok) {
    request.opsAuth = authInfo;
    return true;
  }
  sendJson(response, 401, { ok: false, error: "Unauthorized." });
  return false;
}

async function handleLogin(request, response, body) {
  const remote = getRemoteAddress(request) || "unknown";
  const rateLimit = getLoginRateLimit(remote);
  if (rateLimit.locked) {
    return {
      status: 429,
      body: {
        ok: false,
        error: `Too many failed logins. Try again in ${Math.ceil(rateLimit.remainingMs / 1000)} seconds.`,
      },
    };
  }

  const email = normalizeEmail(body.email || body.username || "");
  const password = String(body.password || "");
  const account = getAdminAccount();
  if (!isPasswordAuthConfigured()) {
    return {
      status: 503,
      body: {
        ok: false,
        error: "Password login is not configured.",
      },
    };
  }

  const ok = safeCompareText(email, account.email) && verifyPassword(password, account.password_hash);
  if (!ok) {
    recordLoginFailure(remote);
    appendAudit("login_failed", {
      action: "login",
      remote,
      email: email || "(blank)",
    });
    return {
      status: 401,
      body: {
        ok: false,
        error: "Invalid username or password.",
      },
    };
  }

  clearLoginFailure(remote);
  if (shouldRequireLoginCode(account)) {
    const challenge = createLoginCodeChallenge(account, request);
    const mail = sendLoginCode(account, challenge).catch((error) => ({
      sent: false,
      error: error && error.message ? error.message : String(error),
    }));
    const mailResult = await mail;
    appendAudit("login_code_sent", {
      action: "login",
      remote,
      email: account.email,
      mail_sent: mailResult.sent,
    });
    return {
      status: 202,
      body: {
        ok: true,
        code_required: true,
        challenge_id: challenge.id,
        email_hint: maskEmail(account.email),
        expires_at: challenge.expires_at,
        mail_sent: mailResult.sent,
        message: mailResult.sent ? "Login code sent." : "Login code was written to the ops logs.",
      },
    };
  }

  const session = createAccountSession(account, request);
  saveAdminAccount(account);
  response.setHeader("Set-Cookie", buildSessionCookie(account, session));
  appendAudit("login_succeeded", {
    action: "login",
    remote,
    email: account.email,
  });
  return {
    status: 200,
    body: {
      ok: true,
      email: account.email,
      email_verified: Boolean(account.email_verified),
      expires_at: session.expires_at,
    },
  };
}

function handleLoginCodeVerify(request, response, body) {
  cleanupLoginChallenges();
  const remote = getRemoteAddress(request) || "unknown";
  const challengeId = String(body.challenge_id || "").trim();
  const code = String(body.code || "").replace(/\s+/g, "");
  const challenge = loginChallenges.get(challengeId);
  const account = getAdminAccount();
  if (!challenge || !code) {
    return { status: 400, body: { ok: false, error: "Login code is invalid or expired." } };
  }
  if (Date.parse(challenge.expires_at) <= Date.now()) {
    loginChallenges.delete(challengeId);
    return { status: 400, body: { ok: false, error: "Login code expired." } };
  }
  if (!safeCompareText(challenge.email, account.email)) {
    loginChallenges.delete(challengeId);
    return { status: 400, body: { ok: false, error: "Login code is invalid or expired." } };
  }
  const expected = challenge.code_hash;
  const actual = hashToken(`${challengeId}:${code}`);
  if (!safeEqualHex(actual, expected)) {
    challenge.attempts += 1;
    if (challenge.attempts >= LOGIN_CODE_ATTEMPT_LIMIT) {
      loginChallenges.delete(challengeId);
    } else {
      loginChallenges.set(challengeId, challenge);
    }
    appendAudit("login_code_failed", {
      action: "login",
      remote,
      email: account.email,
    });
    return { status: 401, body: { ok: false, error: "Login code is wrong." } };
  }

  loginChallenges.delete(challengeId);
  clearLoginFailure(remote);
  const session = createAccountSession(account, request);
  saveAdminAccount(account);
  response.setHeader("Set-Cookie", buildSessionCookie(account, session));
  appendAudit("login_succeeded", {
    action: "login",
    remote,
    email: account.email,
    login_code: true,
  });
  return {
    status: 200,
    body: {
      ok: true,
      email: account.email,
      email_verified: Boolean(account.email_verified),
      expires_at: session.expires_at,
    },
  };
}

function shouldRequireLoginCode(account) {
  return Boolean(LOGIN_CODE_ENABLED && account && account.email_verified && isValidEmail(account.email));
}

function createLoginCodeChallenge(account, request) {
  cleanupLoginChallenges();
  const id = crypto.randomBytes(18).toString("base64url");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MS).toISOString();
  loginChallenges.set(id, {
    id,
    email: account.email,
    code_hash: hashToken(`${id}:${code}`),
    expires_at: expiresAt,
    attempts: 0,
    remote: getRemoteAddress(request),
    created_at: new Date().toISOString(),
  });
  return {
    id,
    code,
    expires_at: expiresAt,
  };
}

async function sendLoginCode(account, challenge) {
  return sendOpsMail({
    to: account.email,
    subject: "PixelMania Ops login code",
    text: `Your PixelMania Ops login code is ${challenge.code}.\n\nThis code expires at ${challenge.expires_at}.`,
    html: `<p>Your PixelMania Ops login code is <strong>${escapeHtml(challenge.code)}</strong>.</p><p>This code expires soon.</p>`,
    fallbackLog: `PixelMania Ops login code for ${account.email}: ${challenge.code} (expires ${challenge.expires_at})`,
  });
}

function cleanupLoginChallenges() {
  const now = Date.now();
  for (const [id, challenge] of loginChallenges.entries()) {
    if (Date.parse(challenge.expires_at || "") <= now) {
      loginChallenges.delete(id);
    }
  }
}

function maskEmail(email) {
  const clean = String(email || "");
  const at = clean.indexOf("@");
  if (at <= 1) return clean ? "***" : "";
  const name = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  return `${name.slice(0, 1)}${"*".repeat(Math.max(2, name.length - 1))}@${domain}`;
}

function handleLogout(request, response) {
  const authInfo = getAuthInfo(request);
  if (authInfo.ok && authInfo.session_id_hash) {
    const account = getAdminAccount();
    delete account.sessions[authInfo.session_id_hash];
    saveAdminAccount(account);
  }
  response.setHeader("Set-Cookie", buildExpiredSessionCookie());
}

function buildAccountSnapshot(authInfo = {}) {
  const account = getAdminAccount();
  return {
    ok: true,
    account: getPublicAccount(account),
    session: {
      auth_mode: authInfo.mode || "unknown",
      expires_at: authInfo.expires_at || "",
      active_sessions: Object.keys(account.sessions || {}).length,
    },
    mail: {
      configured: Boolean(SMTP_HOST),
      from: SMTP_FROM,
      public_base_url: OPS_PUBLIC_BASE_URL,
    },
    login_code: {
      enabled: Boolean(LOGIN_CODE_ENABLED),
      available: shouldRequireLoginCode(account),
      ttl_minutes: Math.round(LOGIN_CODE_TTL_MS / 60000),
      pending_challenges: loginChallenges.size,
    },
  };
}

async function handleSendVerification(request) {
  const account = getAdminAccount();
  if (!isValidEmail(account.email)) {
    return { status: 400, body: { ok: false, error: "Set a valid email before sending verification." } };
  }
  const token = setEmailVerificationToken(account, account.email, "verify_current");
  saveAdminAccount(account);
  const link = makeOpsUrl("/verify-ops-email", { token });
  const mail = await sendOpsMail({
    to: account.email,
    subject: "Verify your PixelMania Ops email",
    text: `Open this link to verify your PixelMania Ops email:\n\n${link}\n\nThis link expires soon.`,
    html: `<p>Open this link to verify your PixelMania Ops email:</p><p><a href="${escapeHtml(link)}">Verify PixelMania Ops Email</a></p><p>This link expires soon.</p>`,
    fallbackLog: `PixelMania Ops email verification link for ${account.email}: ${link}`,
  });
  return {
    status: 200,
    body: {
      ok: true,
      message: mail.sent ? "Verification email sent." : "Verification link was written to the ops logs because SMTP is not configured.",
      mail_sent: mail.sent,
      account: getPublicAccount(account),
    },
  };
}

async function handleChangeEmail(request, body) {
  const account = getAdminAccount();
  const newEmail = normalizeEmail(body.email || body.new_email || "");
  const password = String(body.password || "");
  if (!isValidEmail(newEmail)) {
    return { status: 400, body: { ok: false, error: "Enter a valid email address." } };
  }
  if (safeCompareText(newEmail, account.email)) {
    return { status: 400, body: { ok: false, error: "That email is already on this account." } };
  }
  if (!verifyPassword(password, account.password_hash)) {
    return { status: 401, body: { ok: false, error: "Current password is wrong." } };
  }
  const token = setEmailVerificationToken(account, newEmail, "change_email");
  saveAdminAccount(account);
  const link = makeOpsUrl("/verify-ops-email", { token });
  const mail = await sendOpsMail({
    to: newEmail,
    subject: "Confirm your PixelMania Ops email change",
    text: `Open this link to confirm your PixelMania Ops email change:\n\n${link}\n\nThis link expires soon.`,
    html: `<p>Open this link to confirm your PixelMania Ops email change:</p><p><a href="${escapeHtml(link)}">Confirm PixelMania Ops Email</a></p><p>This link expires soon.</p>`,
    fallbackLog: `PixelMania Ops email change link for ${newEmail}: ${link}`,
  });
  appendAudit("account_email_change_requested", {
    action: "account",
    remote: getRemoteAddress(request),
    email: account.email,
    pending_email: newEmail,
  });
  return {
    status: 200,
    body: {
      ok: true,
      message: mail.sent ? "Confirmation email sent to the new address." : "Confirmation link was written to the ops logs because SMTP is not configured.",
      mail_sent: mail.sent,
      account: getPublicAccount(account),
    },
  };
}

async function handleChangePassword(request, response, body) {
  const account = getAdminAccount();
  const currentPassword = String(body.current_password || "");
  const newPassword = String(body.new_password || "");
  if (!verifyPassword(currentPassword, account.password_hash)) {
    return { status: 401, body: { ok: false, error: "Current password is wrong." } };
  }
  const passwordCheck = validateOpsPassword(newPassword);
  if (!passwordCheck.ok) {
    return { status: 400, body: { ok: false, error: passwordCheck.error } };
  }
  account.password_hash = makePasswordHash(newPassword);
  account.session_version += 1;
  account.sessions = {};
  const session = createAccountSession(account, request);
  saveAdminAccount(account);
  response.setHeader("Set-Cookie", buildSessionCookie(account, session));
  appendAudit("account_password_changed", {
    action: "account",
    remote: getRemoteAddress(request),
    email: account.email,
  });
  return {
    status: 200,
    body: {
      ok: true,
      message: "Password changed. Other sessions were signed out.",
      account: getPublicAccount(account),
    },
  };
}

async function handlePasswordResetRequest(request, body) {
  const email = normalizeEmail(body.email || "");
  const account = getAdminAccount();
  const generic = {
    status: 200,
    body: {
      ok: true,
      message: "If that verified email exists, a reset link was sent.",
    },
  };
  if (!isValidEmail(email) || !safeCompareText(email, account.email) || !account.email_verified) {
    return generic;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  account.password_reset = {
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + OPS_PASSWORD_RESET_TTL_MS).toISOString(),
  };
  saveAdminAccount(account);
  const link = makeOpsUrl("/", { reset: token });
  const mail = await sendOpsMail({
    to: account.email,
    subject: "Reset your PixelMania Ops password",
    text: `Open this link to reset your PixelMania Ops password:\n\n${link}\n\nThis link expires soon.`,
    html: `<p>Open this link to reset your PixelMania Ops password:</p><p><a href="${escapeHtml(link)}">Reset PixelMania Ops Password</a></p><p>This link expires soon.</p>`,
    fallbackLog: `PixelMania Ops password reset link for ${account.email}: ${link}`,
  });
  appendAudit("password_reset_requested", {
    action: "account",
    remote: getRemoteAddress(request),
    email: account.email,
    mail_sent: mail.sent,
  });
  return generic;
}

async function handlePasswordReset(request, response, body) {
  const token = String(body.token || "").trim();
  const newPassword = String(body.new_password || body.password || "");
  const account = getAdminAccount();
  const reset = account.password_reset || {};
  if (!token || !reset.token_hash || !safeEqualHex(hashToken(token), reset.token_hash)) {
    return { status: 400, body: { ok: false, error: "That reset link is invalid or has already been used." } };
  }
  if (Date.parse(String(reset.expires_at || "")) <= Date.now()) {
    account.password_reset = {};
    saveAdminAccount(account);
    return { status: 400, body: { ok: false, error: "That reset link expired." } };
  }
  const passwordCheck = validateOpsPassword(newPassword);
  if (!passwordCheck.ok) {
    return { status: 400, body: { ok: false, error: passwordCheck.error } };
  }
  account.password_hash = makePasswordHash(newPassword);
  account.password_reset = {};
  account.session_version += 1;
  account.sessions = {};
  const session = createAccountSession(account, request);
  saveAdminAccount(account);
  response.setHeader("Set-Cookie", buildSessionCookie(account, session));
  appendAudit("password_reset_completed", {
    action: "account",
    remote: getRemoteAddress(request),
    email: account.email,
  });
  return {
    status: 200,
    body: {
      ok: true,
      message: "Password reset. You are signed in.",
      account: getPublicAccount(account),
    },
  };
}

function handleVerifyEmailLink(token) {
  const account = getAdminAccount();
  const verification = account.email_verification || {};
  if (!token || !verification.token_hash || !safeEqualHex(hashToken(token), verification.token_hash)) {
    return { status: 400, message: "That verification link is invalid or has already been used." };
  }
  if (Date.parse(String(verification.expires_at || "")) <= Date.now()) {
    account.email_verification = {};
    saveAdminAccount(account);
    return { status: 400, message: "That verification link expired. Sign in and send a new one." };
  }
  const email = normalizeEmail(verification.email || account.email);
  account.email = email;
  account.email_verified = true;
  account.email_verified_at = new Date().toISOString();
  account.pending_email = "";
  account.email_verification = {};
  account.session_version += 1;
  account.sessions = {};
  saveAdminAccount(account);
  appendAudit("email_verified", {
    action: "account",
    email,
    purpose: verification.purpose || "verify",
  });
  return {
    status: 200,
    message: "Email verified. Return to the PixelMania Ops dashboard and sign in again.",
  };
}

function handleLogoutAll(request, response) {
  const account = getAdminAccount();
  account.session_version += 1;
  account.sessions = {};
  saveAdminAccount(account);
  response.setHeader("Set-Cookie", buildExpiredSessionCookie());
  appendAudit("all_sessions_revoked", {
    action: "account",
    remote: getRemoteAddress(request),
    email: account.email,
  });
  return {
    status: 200,
    body: {
      ok: true,
      message: "All sessions were signed out.",
    },
  };
}

function getAuthInfo(request) {
  const session = verifySessionCookie(getSessionCookie(request), request);
  if (session.ok) {
    return {
      ok: true,
      mode: "session",
      email: session.email,
      session_id_hash: session.session_id_hash,
      expires_at: session.expires_at,
    };
  }

  if (isLegacyTokenAuthorized(request)) {
    return {
      ok: true,
      mode: "legacy-token",
      email: getAdminAccount().email,
    };
  }

  return {
    ok: false,
    mode: "none",
    username: "",
  };
}

function isLegacyTokenAuthorized(request) {
  if (!isLegacyTokenAuthConfigured()) return false;
  const token = getRequestToken(request);
  if (!token) return false;
  if (AUTH_TOKEN_HASH) {
    return safeEqualHex(hashToken(token), AUTH_TOKEN_HASH);
  }
  return safeEqualHex(hashToken(token), hashToken(AUTH_TOKEN));
}

function getRequestToken(request) {
  const authorization = String(request.headers.authorization || "");
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return bearerMatch[1].trim();
  return String(request.headers["x-ops-token"] || "").trim();
}

function isAuthConfigured() {
  return isPasswordAuthConfigured() || isLegacyTokenAuthConfigured();
}

function isPasswordAuthConfigured() {
  const account = getAdminAccount();
  return account.email.trim() !== "" && parsePasswordHash(account.password_hash) !== null;
}

function isLegacyTokenAuthConfigured() {
  return AUTH_TOKEN.trim() !== "" || /^[a-f0-9]{64}$/.test(AUTH_TOKEN_HASH);
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function safeEqualHex(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "hex");
  const rightBuffer = Buffer.from(String(right || ""), "hex");
  return safeEqualBuffer(leftBuffer, rightBuffer);
}

function safeEqualBuffer(leftBuffer, rightBuffer) {
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function safeCompareText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return safeEqualBuffer(leftBuffer, rightBuffer);
}

function parsePasswordHash(value) {
  const parts = String(value || "").trim().split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const hashHex = parts[5];
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (n < 4096 || n > 1048576 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  if (!/^[A-Za-z0-9_-]{16,}$/.test(salt)) return null;
  if (!/^[a-f0-9]{64,256}$/i.test(hashHex) || hashHex.length % 2 !== 0) return null;
  return {
    n,
    r,
    p,
    salt,
    hashHex: hashHex.toLowerCase(),
  };
}

function verifyPassword(password, storedHash) {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;
  try {
    const expected = Buffer.from(parsed.hashHex, "hex");
    const salt = Buffer.from(parsed.salt, "base64url");
    const actual = crypto.scryptSync(String(password || ""), salt, expected.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: 128 * 1024 * 1024,
    });
    return safeEqualBuffer(actual, expected);
  } catch (_error) {
    return false;
  }
}

function createAccountSession(account, request) {
  cleanupExpiredSessions(account);
  const sessionId = crypto.randomBytes(32).toString("base64url");
  const sessionIdHash = hashToken(sessionId);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const now = new Date().toISOString();
  account.sessions[sessionIdHash] = {
    created_at: now,
    last_seen_at: now,
    expires_at: expiresAt,
    remote: getRemoteAddress(request),
    user_agent: String(request.headers["user-agent"] || "").slice(0, 180),
  };
  return {
    id: sessionId,
    id_hash: sessionIdHash,
    expires_at: expiresAt,
  };
}

function buildSessionCookie(account, session) {
  const payload = Buffer.from(JSON.stringify({
    e: account.email,
    sid: session.id,
    exp: Date.parse(session.expires_at),
    v: account.session_version,
  }), "utf8").toString("base64url");
  const signature = signSessionPayload(payload);
  return [
    `${SESSION_COOKIE_NAME}=${payload}.${signature}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    SESSION_COOKIE_SECURE ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function buildExpiredSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    SESSION_COOKIE_SECURE ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function verifySessionCookie(cookieValue, request) {
  const [payload, signature] = String(cookieValue || "").split(".");
  if (!payload || !signature) return { ok: false, username: "" };
  if (!safeEqualHex(signSessionPayload(payload), signature)) return { ok: false, username: "" };
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const email = normalizeEmail(session.e || "");
    const sessionId = String(session.sid || "");
    const sessionVersion = Number(session.v || 0);
    const expiresAt = Number(session.exp || 0);
    const account = getAdminAccount();
    if (!safeCompareText(email, account.email)) return { ok: false, email: "" };
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false, email: "" };
    if (sessionVersion !== account.session_version) return { ok: false, email: "" };
    const sessionIdHash = hashToken(sessionId);
    const storedSession = account.sessions[sessionIdHash];
    if (!storedSession) return { ok: false, email: "" };
    if (Date.parse(String(storedSession.expires_at || "")) <= Date.now()) {
      delete account.sessions[sessionIdHash];
      saveAdminAccount(account);
      return { ok: false, email: "" };
    }
    const lastSeen = Date.parse(String(storedSession.last_seen_at || ""));
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 60_000) {
      storedSession.last_seen_at = new Date().toISOString();
      storedSession.remote = getRemoteAddress(request);
      saveAdminAccount(account);
    }
    return {
      ok: true,
      email,
      session_id_hash: sessionIdHash,
      expires_at: storedSession.expires_at,
    };
  } catch (_error) {
    return { ok: false, email: "" };
  }
}

function signSessionPayload(payload) {
  return crypto.createHmac("sha256", getSessionSecret()).update(String(payload || ""), "utf8").digest("hex");
}

function getSessionSecret() {
  const source = SESSION_SECRET
    || getAdminAccount().password_hash
    || AUTH_TOKEN_HASH
    || hashToken(AUTH_TOKEN);
  return crypto.createHash("sha256").update(`pixelmania-ops-session:${source}`, "utf8").digest();
}

function getSessionCookie(request) {
  const cookies = parseCookieHeader(request.headers.cookie || "");
  return cookies[SESSION_COOKIE_NAME] || "";
}

function parseCookieHeader(cookieHeader) {
  const cookies = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function getLoginRateLimit(remote) {
  const key = String(remote || "unknown");
  const entry = loginFailures.get(key);
  if (!entry || !entry.lockedUntil || entry.lockedUntil <= Date.now()) {
    return { locked: false, remainingMs: 0 };
  }
  return {
    locked: true,
    remainingMs: entry.lockedUntil - Date.now(),
  };
}

function recordLoginFailure(remote) {
  const key = String(remote || "unknown");
  const current = loginFailures.get(key) || { count: 0, lockedUntil: 0 };
  const count = current.count + 1;
  loginFailures.set(key, {
    count,
    lockedUntil: count >= LOGIN_FAILURE_LIMIT ? Date.now() + LOGIN_LOCK_MS : 0,
  });
}

function clearLoginFailure(remote) {
  loginFailures.delete(String(remote || "unknown"));
}

function loadAdminAccount() {
  const fallback = createFallbackAdminAccount();
  try {
    if (fs.existsSync(ACCOUNT_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf8"));
      const normalized = normalizeAdminAccount(parsed, fallback);
      saveAdminAccount(normalized);
      return normalized;
    }
  } catch (error) {
    console.warn(`Could not read ops dashboard account file ${ACCOUNT_FILE}: ${error.message}`);
  }
  saveAdminAccount(fallback);
  return fallback;
}

function getAdminAccount() {
  adminAccount = normalizeAdminAccount(adminAccount || {}, createFallbackAdminAccount());
  cleanupExpiredSessions(adminAccount);
  return adminAccount;
}

function saveAdminAccount(account) {
  adminAccount = normalizeAdminAccount(account, createFallbackAdminAccount());
  cleanupExpiredSessions(adminAccount);
  const directory = path.dirname(ACCOUNT_FILE);
  fs.mkdirSync(directory, { recursive: true });
  const tmpPath = `${ACCOUNT_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(adminAccount, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, ACCOUNT_FILE);
}

function createFallbackAdminAccount() {
  const email = normalizeEmail(ADMIN_EMAIL || ADMIN_USERNAME);
  const now = new Date().toISOString();
  return {
    version: 1,
    id: "ops-admin",
    email,
    email_verified: false,
    email_verified_at: "",
    password_hash: ADMIN_PASSWORD_HASH,
    session_version: 1,
    sessions: {},
    pending_email: "",
    email_verification: {},
    password_reset: {},
    created_at: now,
    updated_at: now,
  };
}

function normalizeAdminAccount(raw, fallback) {
  const now = new Date().toISOString();
  const fallbackEmail = normalizeEmail(fallback.email || "");
  const fallbackPasswordHash = String(fallback.password_hash || "");
  const email = normalizeEmail(raw.email || fallbackEmail);
  return {
    version: 1,
    id: String(raw.id || "ops-admin"),
    email,
    email_verified: Boolean(raw.email_verified),
    email_verified_at: String(raw.email_verified_at || ""),
    password_hash: String(raw.password_hash || fallbackPasswordHash),
    session_version: Math.max(1, Math.trunc(Number(raw.session_version) || 1)),
    sessions: raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {},
    pending_email: normalizeEmail(raw.pending_email || ""),
    email_verification: raw.email_verification && typeof raw.email_verification === "object" ? raw.email_verification : {},
    password_reset: raw.password_reset && typeof raw.password_reset === "object" ? raw.password_reset : {},
    created_at: String(raw.created_at || now),
    updated_at: now,
  };
}

function cleanupExpiredSessions(account) {
  const sessions = account.sessions && typeof account.sessions === "object" ? account.sessions : {};
  const now = Date.now();
  for (const [sessionHash, session] of Object.entries(sessions)) {
    if (Date.parse(String(session?.expires_at || "")) <= now) {
      delete sessions[sessionHash];
    }
  }
  account.sessions = sessions;
}

function getPublicAccount(account) {
  return {
    email: account.email,
    email_verified: Boolean(account.email_verified),
    email_verified_at: account.email_verified_at || "",
    pending_email: account.pending_email || "",
    has_pending_verification: Boolean(account.email_verification && account.email_verification.token_hash),
    verification_expires_at: account.email_verification?.expires_at || "",
    session_version: account.session_version,
  };
}

function setEmailVerificationToken(account, email, purpose) {
  const token = crypto.randomBytes(32).toString("base64url");
  account.pending_email = purpose === "change_email" ? normalizeEmail(email) : "";
  account.email_verification = {
    token_hash: hashToken(token),
    email: normalizeEmail(email),
    purpose,
    expires_at: new Date(Date.now() + OPS_EMAIL_VERIFICATION_TTL_MS).toISOString(),
  };
  return token;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function validateOpsPassword(password) {
  if (String(password || "").length < OPS_MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${OPS_MIN_PASSWORD_LENGTH} characters.` };
  }
  return { ok: true, error: "" };
}

function makePasswordHash(password) {
  const n = 16384;
  const r = 8;
  const p = 1;
  const keyLength = 64;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password || ""), salt, keyLength, {
    N: n,
    r,
    p,
    maxmem: 128 * 1024 * 1024,
  }).toString("hex");
  return `scrypt:${n}:${r}:${p}:${salt.toString("base64url")}:${hash}`;
}

function makeOpsUrl(pathname, params = {}) {
  const base = new URL(OPS_PUBLIC_BASE_URL);
  base.pathname = pathname;
  base.search = "";
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      base.searchParams.set(key, String(value));
    }
  }
  return base.toString();
}

async function sendOpsMail({ to, subject, text, html, fallbackLog }) {
  if (!SMTP_HOST) {
    console.warn(fallbackLog || text || subject);
    return { sent: false, error: "SMTP is not configured." };
  }
  try {
    const transporter = getMailTransporter();
    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
      html,
    });
    return { sent: true, error: "" };
  } catch (error) {
    console.warn(`Could not send ops dashboard email to ${to}: ${error.message}`);
    if (fallbackLog) console.warn(fallbackLog);
    return { sent: false, error: error.message };
  }
}

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  const options = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
  };
  if (SMTP_USER !== "" || SMTP_PASS !== "") {
    options.auth = {
      user: SMTP_USER,
      pass: SMTP_PASS,
    };
  }
  mailTransporter = nodemailer.createTransport(options);
  return mailTransporter;
}

function sendHtml(response, status, title, message) {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #141412; color: #f4f1ea; font-family: system-ui, sans-serif; }
    main { width: min(460px, calc(100vw - 32px)); padding: 28px; border: 1px solid #42403a; border-radius: 8px; background: #201f1b; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { margin: 0 0 18px; color: #a9a49a; font-weight: 700; line-height: 1.45; }
    a { color: #62a7ff; font-weight: 800; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">Back to dashboard</a>
  </main>
</body>
</html>`;
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  response.end(html);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  response.end(JSON.stringify(payload));
}

function parseRequestUrl(request) {
  try {
    return new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  } catch (_error) {
    return null;
  }
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (body.trim() === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (_error) {
        resolve({});
      }
    });
    request.on("error", reject);
  });
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function appendAudit(event, payload) {
  const line = `${JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...payload,
  })}\n`;
  fs.promises.appendFile(AUDIT_LOG_PATH, line).catch(() => {});
}

function getRemoteAddress(request) {
  return String(request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "").split(",")[0].trim();
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampInteger(value, min, max) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function envString(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === null || String(value).trim() === "" ? fallback : String(value).trim();
}

function envBool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseCsvSet(value) {
  return new Set(String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean));
}

function parsePm2AppList(value) {
  const apps = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[A-Za-z0-9_.:-]+$/.test(item));
  return apps.length > 0 ? apps : [PM2_APP];
}

function parseRouteTargets(value) {
  return String(value || "")
    .split(";")
    .map((rawTarget) => {
      const [rawLabel, rawPm2App, rawHealthUrl, rawWsUrl] = rawTarget.split("|").map((part) => String(part || "").trim());
      return {
        label: rawLabel,
        pm2_app: rawPm2App,
        health_url: rawHealthUrl,
        ws_url: rawWsUrl,
      };
    })
    .filter((target) => target.label && target.pm2_app && target.health_url);
}
