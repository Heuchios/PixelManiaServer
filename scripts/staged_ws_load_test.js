"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const WebSocket = require("ws");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    if (eq >= 0) {
      args[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[raw] = true;
      continue;
    }
    args[raw] = next;
    i += 1;
  }
  return args;
}

function parseInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseDurationMs(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") return Math.max(0, Math.trunc(value));
  const clean = String(value).trim().toLowerCase();
  const match = clean.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallback;
  const unit = match[2] || "ms";
  if (unit === "m") return Math.max(0, Math.trunc(amount * 60_000));
  if (unit === "s") return Math.max(0, Math.trunc(amount * 1_000));
  return Math.max(0, Math.trunc(amount));
}

function boolArg(value) {
  if (value === true) return true;
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function usage() {
  return `
Usage:
  npm run load:staged -- --url ws://127.0.0.1:8080 --dev-login --clients 100 --step 25 --step-ms 30s --hold-ms 2m --world LOAD_TEST
  npm run load:staged -- --urls wss://api.pixelmaniagame.com/ws-a,wss://api.pixelmaniagame.com/ws-b --worlds LOAD_A,LOAD_B --token-file ./load_tokens.json --clients 250 --step 25 --step-ms 30s --hold-ms 5m

Auth modes:
  --dev-login                 Local/staging only. Requires server dev backend login to be enabled.
  --token-file <file.json>    Production-style test accounts. Supports an array or { "accounts": [...] }.

Token file rows:
  { "username": "load001", "session_token": "...", "refresh_token": "..." }

Useful knobs:
  --url <url>                 Single-route mode.
  --world <name>              Single-route world.
  --urls <url-a,url-b>        Multi-route mode. Clients are assigned round-robin.
  --worlds <world-a,world-b>  Required with --urls. Worlds must be distinct so route ownership does not redirect.
  --health-url <url>          Defaults to /health in single-route mode; disabled by default in multi-route mode.
  --token-out-file <file>     Defaults to <token-file>.next.json.
  --token-offset 0            Start assigning clients at this token row.
  --client-version 1.0.3
  --rate 10                   Position messages per joined client per second.
  --radius 3                  Movement radius in pixels. Keeps the first update inside the 4px world-entry guard.
  --max-rejections 0          Maximum accepted action rejections before the stage fails.
  --max-rate-limited 0        Maximum accepted rate_limited responses before the stage fails.
  --stats-ms 5000
`;
}

function deriveHealthUrl(wsUrl) {
  try {
    const parsed = new URL(wsUrl);
    parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    parsed.pathname = "/health";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

function readTokenAccounts(tokenFile) {
  if (!tokenFile) return [];
  const fullPath = path.resolve(tokenFile);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Token file not found: ${fullPath}. Use --dev-login for local/staging, or create this JSON file with disposable verified test account tokens.`);
  }
  const raw = fs.readFileSync(fullPath, "utf8");
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.accounts) ? parsed.accounts : []);
  return rows.map((row, index) => ({
    index,
    username: String(row.username || row.account_username || row.name || "").trim(),
    session_token: String(row.session_token || row.token || "").trim(),
    refresh_token: String(row.refresh_token || "").trim(),
  })).filter((row) => row.username !== "" && (row.session_token !== "" || row.refresh_token !== ""));
}

function writeTokenAccounts(tokenOutFile, accounts) {
  if (!tokenOutFile || !Array.isArray(accounts) || accounts.length === 0) return;
  const fullPath = path.resolve(tokenOutFile);
  fs.writeFileSync(fullPath, `${JSON.stringify({ accounts }, null, 2)}\n`, "utf8");
  console.log(`[load] wrote rotated token pool: ${fullPath}`);
}

function getJson(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      resolve(null);
      return;
    }
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.get(parsed, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 512 * 1024) request.destroy();
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (_error) {
          resolve(null);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.on("error", () => resolve(null));
  });
}

function makeRequestId(prefix, index) {
  return `${prefix}-${index}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

class LoadClient {
  constructor(runner, index, tokenRow = null) {
    this.runner = runner;
    this.index = index;
    this.tokenRow = tokenRow;
    this.routeIndex = index % runner.routes.length;
    this.route = runner.routes[this.routeIndex];
    this.routeClientIndex = Math.floor(index / runner.routes.length);
    this.routeUrl = this.route.url;
    this.world = this.route.world;
    this.username = tokenRow?.username || `${runner.usernamePrefix}${String(index + 1).padStart(5, "0")}`;
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.joined = false;
    this.spawnX = runner.spawnX + (this.routeClientIndex % runner.spawnColumns) * runner.spawnSpacing;
    this.spawnY = runner.spawnY + Math.floor(this.routeClientIndex / runner.spawnColumns) * runner.spawnSpacing;
    this.facing = 1;
    this.movementTimer = null;
    this.openedAt = 0;
    this.messagesReceived = 0;
    this.bytesReceived = 0;
    this.bytesSent = 0;
    this.authErrorCount = 0;
    this.updateRequiredCount = 0;
    this.rejectionCount = 0;
    this.rateLimitedCount = 0;
    this.routeRedirectCount = 0;
    this.abnormalCloseCount = 0;
    this.socketErrorCount = 0;
  }

  connect() {
    const ws = new WebSocket(this.routeUrl, {
      perMessageDeflate: false,
      handshakeTimeout: this.runner.handshakeTimeoutMs,
    });
    this.ws = ws;

    ws.on("open", () => {
      this.connected = true;
      this.openedAt = Date.now();
      this.runner.stats.opened += 1;
      this.sendAuth();
    });

    ws.on("message", (raw) => {
      this.messagesReceived += 1;
      this.runner.stats.messagesReceived += 1;
      const rawText = raw.toString();
      const messageBytes = Buffer.byteLength(rawText);
      this.bytesReceived += messageBytes;
      this.runner.stats.bytesReceived += messageBytes;
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (_error) {
        return;
      }
      this.handleMessage(data, messageBytes);
    });

    ws.on("close", (code, reason) => {
      const closePhase = this.joined
        ? "joined"
        : (this.authenticated ? "authenticated" : (this.connected ? "connected" : "opening"));
      const intentional = this.runner.shuttingDown && Number(code) === 1000;
      this.connected = false;
      this.joined = false;
      this.runner.stats.closed += 1;
      if (!intentional) this.abnormalCloseCount += 1;
      const reasonText = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || "");
      this.runner.recordClose(code, reasonText, {
        closePhase,
        intentional,
        lifetimeMs: this.openedAt > 0 ? Date.now() - this.openedAt : 0,
      });
      this.stopMovement();
    });

    ws.on("error", (error) => {
      this.runner.stats.errors += 1;
      this.socketErrorCount += 1;
      this.runner.recordSocketError(error.message || "socket_error");
      if (this.runner.verbose) {
        console.warn(`[client ${this.index} route=${this.routeIndex}] socket error: ${error.message}`);
      }
    });
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const outgoing = {
      ...payload,
      client_version: this.runner.clientVersion,
      client_platform: "load_test",
    };
    const raw = JSON.stringify(outgoing);
    this.ws.send(raw);
    this.bytesSent += Buffer.byteLength(raw);
    this.runner.stats.bytesSent += Buffer.byteLength(raw);
    this.runner.stats.messagesSent += 1;
    return true;
  }

  sendAuth() {
    if (this.runner.devLogin) {
      this.send({
        type: "dev_backend_login",
        request_id: makeRequestId("dev-login", this.index),
        username: this.username,
        world: this.world,
        movement_mode: "WEBSOCKET",
        dev_login: true,
      });
      return;
    }

    const payload = {
      type: "account_token_login",
      request_id: makeRequestId("token-login", this.index),
      username: this.username,
    };
    if (this.tokenRow.refresh_token) {
      payload.refresh_token = this.tokenRow.refresh_token;
    } else {
      payload.session_token = this.tokenRow.session_token;
    }
    this.send(payload);
  }

  handleMessage(data, messageBytes = 0) {
    const type = String(data.type || "");
    if (type === "account_auth_ok" && data.ok !== false) {
      this.authenticated = true;
      this.runner.stats.authenticated += 1;
      if (this.tokenRow) {
        this.tokenRow.session_token = String(data.session_token || this.tokenRow.session_token || "");
        this.tokenRow.refresh_token = String(data.refresh_token || this.tokenRow.refresh_token || "");
      }
      this.send({
        type: "join_world",
        request_id: makeRequestId("join", this.index),
        username: this.username,
        session_token: this.tokenRow?.session_token || String(data.session_token || ""),
        world: this.world,
      });
      return;
    }

    if (type === "account_auth_error") {
      this.runner.stats.authErrors += 1;
      this.authErrorCount += 1;
      this.runner.recordAuthError(data.reason || data.message || "auth_error");
      if (this.runner.verbose) {
        const source = this.tokenRow ? ` tokenRow=${this.tokenRow.index} username=${this.username}` : ` username=${this.username}`;
        console.warn(`[client ${this.index} route=${this.routeIndex}] auth error:${source} message=${data.message || "unknown"} reason=${data.reason || "unknown"}`);
      }
      this.close();
      return;
    }

    if (type === "client_update_required") {
      this.runner.stats.updateRequired += 1;
      this.updateRequiredCount += 1;
      console.warn(`[client ${this.index} route=${this.routeIndex}] update required: ${data.message || ""}`);
      this.close();
      return;
    }

    if (type === "join_world_ok") {
      this.joined = true;
      this.runner.stats.joined += 1;
      const sx = Number(data.spawn_x);
      const sy = Number(data.spawn_y);
      if (Number.isFinite(sx)) this.spawnX = sx;
      if (Number.isFinite(sy)) this.spawnY = sy;
      this.startMovement();
      return;
    }

    if (type === "world_state") {
      this.runner.stats.worldStates += 1;
      this.runner.stats.worldStateBytesTotal += Math.max(0, Math.trunc(Number(messageBytes) || 0));
      this.runner.stats.worldStateBytesMax = Math.max(
        this.runner.stats.worldStateBytesMax,
        Math.max(0, Math.trunc(Number(messageBytes) || 0)),
      );
      if (String(data.world_state_encoding || "") === "grid_dictionary_v1") {
        this.runner.stats.worldStateCompact += 1;
      }
      return;
    }

    if (type === "player_position_batch") {
      this.runner.stats.positionBatches += 1;
      this.runner.stats.positionItems += Array.isArray(data.players) ? data.players.length : 0;
      this.runner.stats.leftItems += Array.isArray(data.left) ? data.left.length : 0;
      return;
    }

    if (type === "player_position" || type === "player_joined") {
      this.runner.stats.positionItems += 1;
      return;
    }

    if (type === "world_route_redirect") {
      this.runner.stats.routeRedirects += 1;
      this.routeRedirectCount += 1;
      this.runner.recordRouteRedirect(data.redirect_ws_url || data.owner_instance_id || "unknown");
      if (this.runner.verbose) {
        console.warn(
          `[client ${this.index} route=${this.routeIndex}] unexpected world route redirect:`
          + ` world=${this.world} target=${data.redirect_ws_url || "unknown"}`,
        );
      }
      this.close("route_redirect");
      return;
    }

    if (type === "action_rejected") {
      this.runner.stats.rejections += 1;
      this.rejectionCount += 1;
      if (data.position_correction) this.runner.stats.positionCorrections += 1;
      this.runner.recordRejection(data.reason || data.message || data.code || "action_rejected");
      if (this.runner.verbose) {
        console.warn(
          `[client ${this.index} route=${this.routeIndex}] action rejected: reason=${data.reason || ""}`
          + ` message=${data.message || ""} correction=${Boolean(data.position_correction)}`,
        );
      }
      return;
    }

    if (type === "rate_limited") {
      this.runner.stats.rateLimited += 1;
      this.rateLimitedCount += 1;
      this.runner.recordRateLimited(data.action || data.bucket || data.reason || "unknown");
      if (this.runner.verbose) {
        console.warn(`[client ${this.index} route=${this.routeIndex}] rate limited: bucket=${data.action || data.bucket || "unknown"}`);
      }
      return;
    }
  }

  startMovement() {
    if (this.movementTimer || !this.joined) return;
    const intervalMs = Math.max(20, Math.trunc(1000 / Math.max(1, this.runner.rate)));
    this.movementTimer = setInterval(() => this.sendPosition(), intervalMs);
    if (typeof this.movementTimer.unref === "function") this.movementTimer.unref();
    this.sendPosition();
  }

  sendPosition() {
    if (!this.joined || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const elapsed = (Date.now() - this.runner.startedAt) / 1000;
    const phase = elapsed * this.runner.angularSpeed + this.index * 0.137;
    const x = this.spawnX + Math.cos(phase) * this.runner.radius;
    const y = this.spawnY + Math.sin(phase * 0.7) * this.runner.radius * 0.25;
    this.facing = Math.sin(phase) >= 0 ? 1 : -1;
    this.send({
      type: "player_position",
      name: this.username,
      username: this.username,
      session_token: this.tokenRow?.session_token || "",
      x,
      y,
      facing: this.facing,
      world: this.world,
      animation_state: "walk",
      velocity_x: -Math.sin(phase) * this.runner.radius * this.runner.angularSpeed,
      velocity_y: 0,
      on_floor: true,
      in_water: false,
      in_lava_fire: false,
      equipment_slots: {},
      equipped_tool: "",
      equipped_back_item: "",
      equipped_back: "",
      equipped_hat_item: "",
      equipped_hair_item: "",
      equipped_eyewear_item: "",
      equipped_shirt_item: "",
      equipped_pants_item: "",
      equipped_shoes_item: "",
      equipped_ride_item: "",
    });
    this.runner.stats.positionSent += 1;
  }

  stopMovement() {
    if (this.movementTimer) clearInterval(this.movementTimer);
    this.movementTimer = null;
  }

  close(reason = "load_complete") {
    this.stopMovement();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close(1000, reason);
  }
}

class LoadRunner {
  constructor(options) {
    this.routes = options.routes;
    this.url = this.routes[0].url;
    this.healthUrl = options.healthUrl;
    this.world = this.routes[0].world;
    this.clientVersion = options.clientVersion;
    this.clientsTarget = options.clientsTarget;
    this.step = options.step;
    this.stepMs = options.stepMs;
    this.holdMs = options.holdMs;
    this.rate = options.rate;
    this.radius = options.radius;
    this.maxRejections = options.maxRejections;
    this.maxRateLimited = options.maxRateLimited;
    this.angularSpeed = options.angularSpeed;
    this.statsMs = options.statsMs;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs;
    this.devLogin = options.devLogin;
    this.verbose = options.verbose;
    this.usernamePrefix = options.usernamePrefix;
    this.spawnX = options.spawnX;
    this.spawnY = options.spawnY;
    this.spawnColumns = options.spawnColumns;
    this.spawnSpacing = options.spawnSpacing;
    this.tokenAccounts = options.tokenAccounts;
    this.tokenOffset = options.tokenOffset;
    this.tokenOutFile = options.tokenOutFile;
    this.clients = [];
    this.startedAt = Date.now();
    this.lastStats = null;
    this.lastHealth = null;
    this.healthBaseline = null;
    this.statsTimer = null;
    this.shuttingDown = false;
    this.closeReasons = new Map();
    this.closePhases = new Map();
    this.authErrorReasons = new Map();
    this.rejectionReasons = new Map();
    this.rateLimitedBuckets = new Map();
    this.routeRedirectTargets = new Map();
    this.socketErrors = new Map();
    this.stats = {
      opened: 0,
      authenticated: 0,
      joined: 0,
      closed: 0,
      errors: 0,
      authErrors: 0,
      updateRequired: 0,
      rejections: 0,
      rateLimited: 0,
      routeRedirects: 0,
      abnormalCloses: 0,
      positionCorrections: 0,
      messagesSent: 0,
      messagesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      positionSent: 0,
      positionBatches: 0,
      positionItems: 0,
      leftItems: 0,
      worldStates: 0,
      worldStateCompact: 0,
      worldStateBytesTotal: 0,
      worldStateBytesMax: 0,
    };
  }

  recordClose(code, reason, details = {}) {
    const cleanCode = Math.trunc(Number(code) || 0);
    const cleanReason = String(reason || "").trim();
    const key = cleanReason === "" ? String(cleanCode) : `${cleanCode}:${cleanReason}`;
    this.incrementSummary(this.closeReasons, key);
    if (!details.intentional) {
      this.stats.abnormalCloses += 1;
      const phase = String(details.closePhase || "unknown");
      const lifetimeBucket = Number(details.lifetimeMs || 0) < 10_000 ? "<10s" : ">=10s";
      this.incrementSummary(this.closePhases, `${phase}:${lifetimeBucket}`);
    }
  }

  recordAuthError(reason) {
    this.incrementSummary(this.authErrorReasons, String(reason || "auth_error").trim() || "auth_error");
  }

  recordRejection(reason) {
    this.incrementSummary(this.rejectionReasons, String(reason || "action_rejected").trim() || "action_rejected");
  }

  recordRateLimited(bucket) {
    this.incrementSummary(this.rateLimitedBuckets, String(bucket || "unknown").trim() || "unknown");
  }

  recordRouteRedirect(target) {
    this.incrementSummary(this.routeRedirectTargets, String(target || "unknown").trim() || "unknown");
  }

  recordSocketError(message) {
    this.incrementSummary(this.socketErrors, String(message || "socket_error").trim() || "socket_error");
  }

  incrementSummary(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
  }

  formatSummary(map, limit = 2) {
    if (!map || map.size === 0) return "";
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, count]) => `${key}x${count}`)
      .join(",");
  }

  formatCounterDelta(current, baseline, limit = 3) {
    const currentRecord = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    const baselineRecord = baseline && typeof baseline === "object" && !Array.isArray(baseline) ? baseline : {};
    const deltas = new Map();
    for (const [key, rawValue] of Object.entries(currentRecord)) {
      const delta = Math.max(0, Number(rawValue || 0) - Number(baselineRecord[key] || 0));
      if (delta > 0) deltas.set(key, delta);
    }
    return this.formatSummary(deltas, limit);
  }

  getRouteTarget(routeIndex) {
    return Math.floor((this.clientsTarget + this.routes.length - 1 - routeIndex) / this.routes.length);
  }

  getRouteSummaries() {
    return this.routes.map((route, routeIndex) => {
      const clients = this.clients.filter((client) => client.routeIndex === routeIndex);
      return {
        routeIndex,
        url: route.url,
        world: route.world,
        target: this.getRouteTarget(routeIndex),
        opened: clients.filter((client) => client.openedAt > 0).length,
        authenticated: clients.filter((client) => client.authenticated).length,
        joined: clients.filter((client) => client.joined).length,
        active: clients.filter((client) => client.ws && client.ws.readyState === WebSocket.OPEN).length,
        authErrors: clients.reduce((sum, client) => sum + client.authErrorCount, 0),
        updateRequired: clients.reduce((sum, client) => sum + client.updateRequiredCount, 0),
        rejections: clients.reduce((sum, client) => sum + client.rejectionCount, 0),
        rateLimited: clients.reduce((sum, client) => sum + client.rateLimitedCount, 0),
        routeRedirects: clients.reduce((sum, client) => sum + client.routeRedirectCount, 0),
        abnormalCloses: clients.reduce((sum, client) => sum + client.abnormalCloseCount, 0),
        socketErrors: clients.reduce((sum, client) => sum + client.socketErrorCount, 0),
      };
    });
  }

  formatRouteProgress(routeSummaries = this.getRouteSummaries()) {
    return routeSummaries
      .map((summary) => (
        `r${summary.routeIndex}`
        + `[active=${summary.active}/${summary.target}`
        + ` auth=${summary.authenticated}/${summary.target}`
        + ` joined=${summary.joined}/${summary.target}`
        + ` redirect=${summary.routeRedirects}]`
      ))
      .join(" ");
  }

  async run() {
    console.log("[load] staged PixelMania WebSocket load test");
    console.log(`[load] routes=${this.routes.length} health=${this.healthUrl || "(disabled)"} clients=${this.clientsTarget} step=${this.step} stepMs=${this.stepMs} holdMs=${this.holdMs} rate=${this.rate}/s`);
    this.routes.forEach((route, routeIndex) => {
      console.log(`[load] route[${routeIndex}] url=${route.url} world=${route.world} target=${this.getRouteTarget(routeIndex)}`);
    });
    if (!this.devLogin) {
      const firstToken = this.tokenAccounts[this.tokenOffset];
      const lastToken = this.tokenAccounts[this.tokenOffset + this.clientsTarget - 1];
      console.log(`[load] token rows offset=${this.tokenOffset} first=${firstToken?.username || "(missing)"} last=${lastToken?.username || "(missing)"}`);
    }
    this.startedAt = Date.now();
    if (this.healthUrl) {
      this.healthBaseline = await getJson(this.healthUrl);
    }
    this.statsTimer = setInterval(() => this.printStats(), this.statsMs);
    if (typeof this.statsTimer.unref === "function") this.statsTimer.unref();

    let launched = 0;
    while (launched < this.clientsTarget) {
      const batchSize = Math.min(this.step, this.clientsTarget - launched);
      for (let i = 0; i < batchSize; i += 1) {
        const index = launched + i;
        const tokenRow = this.tokenAccounts[this.tokenOffset + index] || null;
        const client = new LoadClient(this, index, tokenRow);
        this.clients.push(client);
        client.connect();
      }
      launched += batchSize;
      console.log(`[load] launched ${launched}/${this.clientsTarget}`);
      if (launched < this.clientsTarget) {
        await wait(this.stepMs);
      }
    }

    await wait(this.holdMs);
    await this.printStats(true);
    const routeSummaries = this.getRouteSummaries();
    const activeAtEnd = routeSummaries.reduce((sum, summary) => sum + summary.active, 0);
    const joinedAtEnd = routeSummaries.reduce((sum, summary) => sum + summary.joined, 0);
    const routesHealthy = routeSummaries.every((summary) => (
      summary.active === summary.target
      && summary.authenticated === summary.target
      && summary.joined === summary.target
      && summary.authErrors === 0
      && summary.updateRequired === 0
      && summary.socketErrors === 0
      && summary.abnormalCloses === 0
      && summary.routeRedirects === 0
    ));
    const result = {
      ok: routesHealthy
        && activeAtEnd === this.clientsTarget
        && joinedAtEnd === this.clientsTarget
        && this.stats.authenticated === this.clientsTarget
        && this.stats.authErrors === 0
        && this.stats.updateRequired === 0
        && this.stats.errors === 0
        && this.stats.rejections <= this.maxRejections
        && this.stats.rateLimited <= this.maxRateLimited
        && this.stats.routeRedirects === 0
        && this.stats.abnormalCloses === 0,
      activeAtEnd,
      joinedAtEnd,
      routeSummaries,
    };
    for (const summary of routeSummaries) {
      console.log(
        `[load] route[${summary.routeIndex}] final`
        + ` active=${summary.active}/${summary.target}`
        + ` auth=${summary.authenticated}/${summary.target}`
        + ` joined=${summary.joined}/${summary.target}`
        + ` errors=${summary.socketErrors}`
        + ` abnormalCloses=${summary.abnormalCloses}`
        + ` rejections=${summary.rejections}`
        + ` rateLimited=${summary.rateLimited}`
        + ` redirects=${summary.routeRedirects}`,
      );
    }
    this.shutdown();
    await wait(1000);
    writeTokenAccounts(this.tokenOutFile, this.tokenAccounts);
    return result;
  }

  async printStats(final = false) {
    const now = Date.now();
    if (!this.lastStats) {
      this.lastStats = { at: now, ...this.stats };
    }

    const elapsedSec = Math.max((now - this.startedAt) / 1000, 0.001);
    const windowSec = Math.max((now - this.lastStats.at) / 1000, 0.001);
    const sentRate = (this.stats.positionSent - this.lastStats.positionSent) / windowSec;
    const rxRate = (this.stats.messagesReceived - this.lastStats.messagesReceived) / windowSec;
    const active = this.clients.filter((client) => client.ws && client.ws.readyState === WebSocket.OPEN).length;
    const joined = this.clients.filter((client) => client.joined).length;

    if (this.healthUrl && (final || !this.lastHealth || now - this.lastHealth.at >= this.statsMs)) {
      this.lastHealth = { at: now, payload: await getJson(this.healthUrl) };
    }

    const health = this.lastHealth?.payload || {};
    const persistence = health.persistence || {};
    const baselinePersistence = this.healthBaseline?.persistence || {};
    const playerNetwork = persistence.player_network || health.player_network || {};
    const baselinePlayerNetwork = baselinePersistence.player_network || this.healthBaseline?.player_network || {};
    const worldNetwork = persistence.world_network || health.world_network || {};
    const tick = persistence.server_tick || health.server_tick || {};
    const tickLag = tick.max_lag_ms !== undefined
      ? ` tickMax=${tick.max_lag_ms}ms`
      : (tick.last_lag_ms !== undefined ? ` tickLag=${tick.last_lag_ms}ms` : "");
    const pending = playerNetwork.pending_position_updates !== undefined
      ? ` pendingPos=${playerNetwork.pending_position_updates}`
      : "";
    const worldPending = worldNetwork.pending_world_updates !== undefined
      ? ` pendingWorld=${worldNetwork.pending_world_updates}`
      : "";
    const closeSummary = this.formatSummary(this.closeReasons);
    const authErrorSummary = this.formatSummary(this.authErrorReasons);
    const rejectionSummary = this.formatSummary(this.rejectionReasons);
    const rateLimitedSummary = this.formatSummary(this.rateLimitedBuckets, 3);
    const routeRedirectSummary = this.formatSummary(this.routeRedirectTargets, 2);
    const closePhaseSummary = this.formatSummary(this.closePhases, 3);
    const socketErrorSummary = this.formatSummary(this.socketErrors, 1);
    const serverRateLimitSummary = this.formatCounterDelta(
      playerNetwork.rate_limit_rejections_by_bucket,
      baselinePlayerNetwork.rate_limit_rejections_by_bucket,
      3,
    );
    const worldStateAverageBytes = this.stats.worldStates > 0
      ? Math.round(this.stats.worldStateBytesTotal / this.stats.worldStates)
      : 0;

    console.log(
      `[load] ${final ? "final " : ""}t=${elapsedSec.toFixed(1)}s active=${active} auth=${this.stats.authenticated} joined=${joined}` +
      ` posOut=${this.stats.positionSent} posRate=${sentRate.toFixed(1)}/s rxRate=${rxRate.toFixed(1)}/s` +
      ` batches=${this.stats.positionBatches} rejections=${this.stats.rejections} rateLimited=${this.stats.rateLimited}` +
      ` redirects=${this.stats.routeRedirects} corrections=${this.stats.positionCorrections}` +
      ` worldStates=${this.stats.worldStates} compact=${this.stats.worldStateCompact}` +
      ` worldStateAvg=${worldStateAverageBytes}B worldStateMax=${this.stats.worldStateBytesMax}B` +
      ` errors=${this.stats.errors} authErrors=${this.stats.authErrors}` +
      `${closeSummary ? ` close=${closeSummary}` : ""}` +
      `${closePhaseSummary ? ` unexpectedClose=${closePhaseSummary}` : ""}` +
      `${authErrorSummary ? ` authReason=${authErrorSummary}` : ""}` +
      `${rejectionSummary ? ` rejectReason=${rejectionSummary}` : ""}` +
      `${rateLimitedSummary ? ` rateBucket=${rateLimitedSummary}` : ""}` +
      `${routeRedirectSummary ? ` redirectTarget=${routeRedirectSummary}` : ""}` +
      `${serverRateLimitSummary ? ` serverRateDelta=${serverRateLimitSummary}` : ""}` +
      `${socketErrorSummary ? ` socketError=${socketErrorSummary}` : ""}` +
      `${tickLag}${pending}${worldPending}` +
      ` routes=${this.formatRouteProgress()}`
    );

    this.lastStats = { at: now, ...this.stats };
  }

  shutdown() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.shuttingDown = true;
    for (const client of this.clients) client.close();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  const configuredUrls = args.urls || process.env.PIXELMANIA_LOAD_WS_URLS;
  const singleUrl = String(args.url || process.env.PIXELMANIA_LOAD_WS_URL || "ws://127.0.0.1:8080").trim();
  const urls = configuredUrls ? parseCsvList(configuredUrls) : [singleUrl];
  if (urls.length === 0) {
    throw new Error("At least one WebSocket URL is required. Use --url for one route or --urls for multiple routes.");
  }
  for (const routeUrl of urls) {
    let parsedUrl;
    try {
      parsedUrl = new URL(routeUrl);
    } catch (_error) {
      throw new Error(`Invalid WebSocket URL: ${routeUrl}`);
    }
    if (!["ws:", "wss:"].includes(parsedUrl.protocol)) {
      throw new Error(`WebSocket URL must use ws:// or wss://: ${routeUrl}`);
    }
  }
  if (urls.length > 1 && new Set(urls).size !== urls.length) {
    throw new Error("Multi-route load tests require distinct values in --urls.");
  }

  const configuredWorlds = args.worlds || process.env.PIXELMANIA_LOAD_WORLDS;
  const singleWorld = String(args.world || process.env.PIXELMANIA_LOAD_WORLD || "LOAD_TEST").trim().toUpperCase();
  const worlds = (configuredWorlds ? parseCsvList(configuredWorlds) : [singleWorld])
    .map((world) => world.toUpperCase());
  if (worlds.length !== urls.length) {
    throw new Error(`Route/world mismatch: received ${urls.length} URL(s) and ${worlds.length} world(s). Provide one distinct --worlds entry for every --urls entry.`);
  }
  if (worlds.some((world) => world === "")) {
    throw new Error("Load-test world names must not be empty.");
  }
  if (urls.length > 1 && new Set(worlds).size !== worlds.length) {
    throw new Error("Multi-route load tests require distinct worlds so Redis world ownership does not redirect clients between workers.");
  }

  const routes = urls.map((routeUrl, routeIndex) => ({
    url: routeUrl,
    world: worlds[routeIndex],
  }));
  const devLogin = boolArg(args["dev-login"] || process.env.PIXELMANIA_LOAD_DEV_LOGIN);
  const tokenFile = args["token-file"] ? String(args["token-file"]) : "";
  const tokenAccounts = readTokenAccounts(tokenFile);
  const likelyLive = urls.some((routeUrl) => /api\.pixelmaniagame\.com/i.test(routeUrl));

  if (devLogin && likelyLive && !boolArg(args["allow-live-dev-login"])) {
    throw new Error("Refusing --dev-login against api.pixelmaniagame.com. Use staging/local dev login, or pass a production-style --token-file with disposable test accounts.");
  }

  if (!devLogin && tokenAccounts.length === 0) {
    console.error(usage());
    throw new Error("Choose exactly one auth path: --dev-login for local/staging, or --token-file for production-style test accounts.");
  }

  const clients = parseInteger(args.clients || process.env.PIXELMANIA_LOAD_CLIENTS, 100, 1, 100_000);
  const tokenOffset = parseInteger(args["token-offset"] || process.env.PIXELMANIA_LOAD_TOKEN_OFFSET, 0, 0, 100_000);
  if (!devLogin && tokenAccounts.length - tokenOffset < clients) {
    throw new Error(`Token file has ${tokenAccounts.length} account(s), offset=${tokenOffset}, but --clients=${clients}.`);
  }

  const tokenOutFile = args["token-out-file"]
    ? String(args["token-out-file"])
    : (tokenFile ? `${tokenFile.replace(/\.json$/i, "")}.next.json` : "");
  const explicitHealthUrl = args["health-url"] || process.env.PIXELMANIA_LOAD_HEALTH_URL;
  const healthUrl = explicitHealthUrl
    ? String(explicitHealthUrl).trim()
    : (routes.length === 1 ? deriveHealthUrl(routes[0].url) : "");

  const runner = new LoadRunner({
    routes,
    healthUrl,
    clientVersion: String(args["client-version"] || process.env.PIXELMANIA_LOAD_CLIENT_VERSION || "1.0.3"),
    clientsTarget: clients,
    step: parseInteger(args.step || process.env.PIXELMANIA_LOAD_STEP, 25, 1, clients),
    stepMs: parseDurationMs(args["step-ms"] || process.env.PIXELMANIA_LOAD_STEP_MS, 30_000),
    holdMs: parseDurationMs(args["hold-ms"] || process.env.PIXELMANIA_LOAD_HOLD_MS, 120_000),
    rate: parseInteger(args.rate || process.env.PIXELMANIA_LOAD_RATE, 10, 1, 120),
    radius: parseInteger(args.radius || process.env.PIXELMANIA_LOAD_RADIUS, 3, 0, 1024),
    maxRejections: parseInteger(args["max-rejections"] || process.env.PIXELMANIA_LOAD_MAX_REJECTIONS, 0, 0, 1_000_000),
    maxRateLimited: parseInteger(args["max-rate-limited"] || process.env.PIXELMANIA_LOAD_MAX_RATE_LIMITED, 0, 0, 1_000_000),
    angularSpeed: Number.isFinite(Number(args["angular-speed"] || process.env.PIXELMANIA_LOAD_ANGULAR_SPEED))
      ? Number(args["angular-speed"] || process.env.PIXELMANIA_LOAD_ANGULAR_SPEED)
      : 0.35,
    statsMs: parseDurationMs(args["stats-ms"] || process.env.PIXELMANIA_LOAD_STATS_MS, 5_000),
    handshakeTimeoutMs: parseDurationMs(args["handshake-timeout-ms"] || process.env.PIXELMANIA_LOAD_HANDSHAKE_TIMEOUT_MS, 10_000),
    devLogin,
    verbose: boolArg(args.verbose || process.env.PIXELMANIA_LOAD_VERBOSE),
    usernamePrefix: String(args["username-prefix"] || process.env.PIXELMANIA_LOAD_USERNAME_PREFIX || "LoadTest_"),
    spawnX: parseInteger(args["spawn-x"] || process.env.PIXELMANIA_LOAD_SPAWN_X, 320, -1_000_000, 1_000_000),
    spawnY: parseInteger(args["spawn-y"] || process.env.PIXELMANIA_LOAD_SPAWN_Y, 352, -1_000_000, 1_000_000),
    spawnColumns: parseInteger(args["spawn-columns"] || process.env.PIXELMANIA_LOAD_SPAWN_COLUMNS, 50, 1, 10_000),
    spawnSpacing: parseInteger(args["spawn-spacing"] || process.env.PIXELMANIA_LOAD_SPAWN_SPACING, 8, 0, 512),
    tokenAccounts,
    tokenOffset,
    tokenOutFile,
  });

  const result = await runner.run();
  if (!result.ok) {
    const routeVerdict = runner.formatRouteProgress(result.routeSummaries);
    throw new Error(
      `Load stage did not remain healthy: active=${result.activeAtEnd}/${clients}`
      + ` joined=${result.joinedAtEnd}/${clients}`
      + ` authenticated=${runner.stats.authenticated}/${clients}`
      + ` authErrors=${runner.stats.authErrors}`
      + ` updateRequired=${runner.stats.updateRequired}`
      + ` socketErrors=${runner.stats.errors}`
      + ` unexpectedCloses=${runner.stats.abnormalCloses}`
      + ` rejections=${runner.stats.rejections}/${runner.maxRejections}`
      + ` rateLimited=${runner.stats.rateLimited}/${runner.maxRateLimited}`
      + ` redirects=${runner.stats.routeRedirects}`
      + ` routes=${routeVerdict}`,
    );
  }
}

main().catch((error) => {
  console.error(`[load] failed: ${error.message}`);
  process.exit(1);
});
