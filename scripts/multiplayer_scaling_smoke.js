"use strict";

const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const RedisStore = require("../redis_store");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    if (eq >= 0) {
      args[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[raw] = true;
      continue;
    }
    args[raw] = next;
    index += 1;
  }
  return args;
}

function boolArg(value) {
  if (value === true) return true;
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage() {
  return `
Usage:
  npm run test:multiplayer-scaling
  npm run test:multiplayer-scaling:fast
  npm run test:multiplayer-scaling:redis -- --redis-url redis://127.0.0.1:6379

Runs the multiplayer scale checks built so far:
  - syntax checks for backend scale-critical scripts
  - scale-readiness wiring gate
  - optional full security gate
  - single-instance local smoke for cap, world index, route ownership, and chat isolation
  - Redis multi-instance world-cap smoke when Redis is reachable
  - Redis route-owner conflict/redirect smoke when Redis is reachable

Useful knobs:
  --redis-url redis://127.0.0.1:6379
  --redis-connect-timeout-ms 1500
  --require-redis            Fail instead of skipping Redis smokes.
  --skip-security            Skip npm run check:security for a faster local pass.
  --keep-logs                Keep temporary server data/log folders.
`;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npmRunInvocation(args) {
  const npmExecPath = String(process.env.npm_execpath || "").trim();
  if (npmExecPath && npmExecPath.toLowerCase().endsWith(".js") && fs.existsSync(npmExecPath)) {
    return { command: process.execPath, args: [npmExecPath, ...args], shell: false };
  }
  return {
    command: npmCommand(),
    args,
    shell: process.platform === "win32",
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: options.stdio || "inherit",
      shell: options.shell === true,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function runNpm(args, options = {}) {
  const invocation = npmRunInvocation(args);
  await runCommand(invocation.command, invocation.args, {
    ...options,
    shell: invocation.shell,
  });
}

function getJson(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function getFreePorts(count) {
  const ports = [];
  while (ports.length < count) {
    const port = await getFreePort();
    if (!ports.includes(port)) ports.push(port);
  }
  return ports;
}

function appendLog(buffer, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
  buffer.push(text);
  while (buffer.join("").length > 48_000 && buffer.length > 1) buffer.shift();
}

function makeServerEnv(options, overrides = {}) {
  return {
    ...process.env,
    HOST: "127.0.0.1",
    ENVIRONMENT: "development",
    NODE_ENV: "development",
    PIXELMANIA_ALLOW_DEV_TOOLS: "true",
    PIXELMANIA_ENABLE_DEV_BACKEND_LOGIN: "true",
    DATABASE_URL: "",
    POSTGRES_URL: "",
    DISABLE_POSTGRES: "true",
    PIXELMANIA_DISABLE_POSTGRES: "true",
    POSTGRES_ENABLED: "false",
    MIN_CLIENT_VERSION: "0.0.0",
    SMTP_HOST: "",
    ...overrides,
    PIXELMANIA_DATA_DIR: overrides.PIXELMANIA_DATA_DIR || options.tempRoot,
  };
}

function spawnServer(options, label, port, envOverrides) {
  const dataDir = path.join(options.tempRoot, label);
  fs.mkdirSync(dataDir, { recursive: true });
  const log = [];
  const env = makeServerEnv(options, {
    PORT: String(port),
    PIXELMANIA_DATA_DIR: dataDir,
    ...envOverrides,
  });
  const child = spawn(process.execPath, [options.serverPath], {
    cwd: options.backendRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => appendLog(log, chunk));
  child.stderr.on("data", (chunk) => appendLog(log, chunk));
  return {
    label,
    port,
    dataDir,
    child,
    log,
    healthUrl: `http://127.0.0.1:${port}/health`,
    wsUrl: `ws://127.0.0.1:${port}`,
  };
}

async function stopServer(server) {
  if (!server || !server.child || server.child.exitCode !== null) return;
  server.child.kill();
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    wait(3000).then(() => {
      if (server.child.exitCode === null) server.child.kill("SIGKILL");
    }),
  ]);
}

async function waitForServer(server, options = {}) {
  const deadline = Date.now() + (options.timeoutMs || 15000);
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`${server.label} exited early with code ${server.child.exitCode}\n${server.log.join("")}`);
    }
    const health = await getJson(server.healthUrl, 1000);
    if (health && health.ok) {
      if (options.requireRedis && health.persistence?.redis_ready !== true) {
        await wait(250);
        continue;
      }
      if (options.requireRouteFeature && health.features?.world_route_ownership !== true) {
        await wait(250);
        continue;
      }
      return health;
    }
    await wait(250);
  }
  throw new Error(`${server.label} did not become healthy\n${server.log.join("")}`);
}

function send(ws, clientVersion, payload) {
  ws.send(JSON.stringify({
    client_version: clientVersion,
    message_id: `${payload.type}-${Date.now()}-${Math.random()}`,
    ...payload,
  }));
}

function createClient(wsUrl, username, options) {
  const clientVersion = options.clientVersion || "999.0.0";
  const messages = [];
  const waiters = [];
  let ws = null;

  function checkWaiters(message) {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      let matched = false;
      try {
        matched = waiter.predicate(message);
      } catch (error) {
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.reject(error);
        continue;
      }
      if (!matched) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  const client = {
    username,
    messages,
    send(payload) {
      send(ws, clientVersion, payload);
    },
    waitFor(predicate, label, timeoutMs = options.clientTimeoutMs || 8000) {
      for (const message of messages) {
        if (predicate(message)) return Promise.resolve(message);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.timer === timer);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(`${username} timed out waiting for ${label}`));
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timer });
      });
    },
    async joinWorld(world) {
      this.send({ type: "join_world", world, facing: 1 });
      const response = await this.waitFor((message) => {
        if (message.type === "join_world_ok" && message.world === world) return true;
        return message.type === "action_rejected" &&
          (message.reason === "world_full" || message.reason === "world_route_redirect" || message.reason === "world_route_unavailable");
      }, `join ${world}`);
      if (response.type === "join_world_ok") return { ok: true, response };
      return { ok: false, reason: response.reason, response };
    },
    close() {
      try {
        if (ws) ws.close();
      } catch (_error) {
        // Ignore client close errors during smoke cleanup.
      }
    },
  };

  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl, {
      perMessageDeflate: false,
      handshakeTimeout: options.handshakeTimeoutMs || 5000,
    });
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error(`${username} timed out during login`));
    }, options.clientTimeoutMs || 8000);
    ws.on("open", () => {
      send(ws, clientVersion, {
        type: "dev_backend_login",
        username,
        world: "SMOKE_LOBBY",
      });
    });
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch (_error) {
        return;
      }
      messages.push(message);
      while (messages.length > 200) messages.shift();
      checkWaiters(message);
      if (message.type === "account_auth_ok") {
        clearTimeout(timeout);
        resolve(client);
        return;
      }
      if (message.type === "account_auth_error" || message.type === "auth_required") {
        clearTimeout(timeout);
        client.close();
        reject(new Error(`${username} auth failed: ${JSON.stringify(message)}`));
      }
    });
    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function preflightRedis(options) {
  const store = new RedisStore({
    enabled: true,
    url: options.redisUrl,
    keyPrefix: `pixelmania_preflight_${Date.now()}`,
    connectTimeoutMs: options.redisConnectTimeoutMs,
    logger: (...args) => console.warn(...args),
  });
  try {
    await store.init();
    if (!store.isReady()) return false;
    await store.close();
    return true;
  } catch (_error) {
    await store.close();
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sampleWorldCount(health, worldName, sectionName) {
  const section = sectionName === "route" ? health.persistence?.world_route : health.persistence?.world_index;
  const key = sectionName === "route" ? "sample_owned_worlds" : "sample_worlds";
  const sample = Array.isArray(section?.[key]) ? section[key] : [];
  const entry = sample.find((item) => item.world === worldName);
  return entry ? Number(entry.players || 0) : -1;
}

async function runSyntaxChecks(options) {
  console.log("[multiplayer-smoke] syntax checks");
  const files = [
    "server.js",
    "redis_store.js",
    "ecosystem.config.js",
    "scripts/check_scale_readiness_wiring.js",
    "scripts/multi_instance_world_cap_smoke.js",
    "scripts/multiplayer_scaling_smoke.js",
  ];
  for (const file of files) {
    await runCommand(process.execPath, ["--check", path.join(options.backendRoot, file)], { cwd: options.backendRoot });
  }
}

async function runStaticGates(options) {
  console.log("[multiplayer-smoke] scale readiness gate");
  await runNpm(["run", "check:scale-readiness"], { cwd: options.backendRoot });
  if (!options.skipSecurity) {
    console.log("[multiplayer-smoke] security gate");
    await runNpm(["run", "check:security"], { cwd: options.backendRoot });
  }
}

async function runLocalSingleInstanceSmoke(options) {
  console.log("[multiplayer-smoke] local single-instance cap/index/route/chat smoke");
  const [port] = await getFreePorts(1);
  const world = "LOCAL_SCALE_SMOKE";
  const otherWorld = "LOCAL_OTHER_SMOKE";
  const marker = `same-world-${Date.now()}`;
  const server = spawnServer(options, "local-single", port, {
    MAX_PLAYERS_PER_WORLD: "2",
    REDIS_ENABLED: "false",
    WORLD_ROUTE_ENFORCEMENT_ENABLED: "true",
    SERVER_INSTANCE_ID: "local-scale-smoke",
    SERVER_INSTANCE_WS_URL: `ws://127.0.0.1:${port}`,
  });
  const clients = [];
  let routeOwnershipToken = "";
  try {
    const health = await waitForServer(server, { requireRouteFeature: true });
    assert(health.features?.max_players_per_world === 2, "health did not expose max_players_per_world=2");
    assert(health.features?.world_player_index === true, "health did not expose world_player_index");
    assert(health.features?.world_route_ownership === true, "health did not expose world_route_ownership");
    assert(health.features?.world_route_enforcement === true, "health did not expose enabled route enforcement");

    const alpha = await createClient(server.wsUrl, "LocalScaleA", options);
    const beta = await createClient(server.wsUrl, "LocalScaleB", options);
    const gamma = await createClient(server.wsUrl, "LocalScaleC", options);
    const delta = await createClient(server.wsUrl, "LocalScaleD", options);
    clients.push(alpha, beta, gamma, delta);

    assert((await alpha.joinWorld(world)).ok, "first local client could not join capped world");
    assert((await beta.joinWorld(world)).ok, "second local client could not join capped world");
    assert((await gamma.joinWorld(otherWorld)).ok, "other-world local client could not join");
    const rejected = await delta.joinWorld(world);
    assert(!rejected.ok && rejected.reason === "world_full", `expected world_full rejection, got ${JSON.stringify(rejected.response)}`);

    alpha.send({ type: "chat", message: marker });
    await beta.waitFor((message) => message.type === "chat" && message.message === marker && message.world === world, "same-world chat");
    await wait(500);
    assert(!gamma.messages.some((message) => message.type === "chat" && message.message === marker), "chat leaked to another world");

    const healthAfter = await getJson(server.healthUrl, 1000);
    assert(sampleWorldCount(healthAfter, world, "index") === 2, "world index did not report 2 players in capped world");
    assert(sampleWorldCount(healthAfter, otherWorld, "index") === 1, "world index did not report 1 player in other world");
    assert(sampleWorldCount(healthAfter, world, "route") === 2, "world route health did not report owned capped world");
    assert(healthAfter.persistence?.world_route?.instance_id === "local-scale-smoke", "world route health did not expose instance id");
  } finally {
    for (const client of clients) client.close();
    await wait(500);
    await stopServer(server);
  }
}

async function runRedisWorldCapSmoke(options) {
  console.log("[multiplayer-smoke] Redis multi-instance world-cap smoke");
  const [portA, portB] = await getFreePorts(2);
  await runCommand(process.execPath, [
    path.join(options.backendRoot, "scripts", "multi_instance_world_cap_smoke.js"),
    "--redis-url",
    options.redisUrl,
    "--redis-connect-timeout-ms",
    String(options.redisConnectTimeoutMs),
    "--redis-key-prefix",
    `pixelmania_all_smoke_cap_${Date.now()}`,
    "--cap",
    "2",
    "--ports",
    `${portA},${portB}`,
    "--world",
    `ALL_SCALE_CAP_${Date.now()}`,
  ], { cwd: options.backendRoot });
}

async function runRedisRouteConflictSmoke(options) {
  console.log("[multiplayer-smoke] Redis world-route conflict/redirect smoke");
  const [portA, portB] = await getFreePorts(2);
  const world = `ROUTE_CONFLICT_${Date.now()}`;
  const redisKeyPrefix = `pixelmania_all_smoke_route_${Date.now()}`;
  const store = new RedisStore({
    enabled: true,
    url: options.redisUrl,
    keyPrefix: redisKeyPrefix,
    connectTimeoutMs: options.redisConnectTimeoutMs,
    logger: (...args) => console.warn(...args),
  });
  const serverA = spawnServer(options, "route-owner-a", portA, {
    MAX_PLAYERS_PER_WORLD: "50",
    REDIS_ENABLED: "true",
    REDIS_URL: options.redisUrl,
    REDIS_KEY_PREFIX: redisKeyPrefix,
    REDIS_CONNECT_TIMEOUT_MS: String(options.redisConnectTimeoutMs),
    WORLD_ROUTE_ENFORCEMENT_ENABLED: "true",
    SERVER_INSTANCE_ID: "route-smoke-a",
    SERVER_INSTANCE_WS_URL: `ws://127.0.0.1:${portA}`,
  });
  const serverB = spawnServer(options, "route-owner-b", portB, {
    MAX_PLAYERS_PER_WORLD: "50",
    REDIS_ENABLED: "true",
    REDIS_URL: options.redisUrl,
    REDIS_KEY_PREFIX: redisKeyPrefix,
    REDIS_CONNECT_TIMEOUT_MS: String(options.redisConnectTimeoutMs),
    WORLD_ROUTE_ENFORCEMENT_ENABLED: "true",
    SERVER_INSTANCE_ID: "route-smoke-b",
    SERVER_INSTANCE_WS_URL: `ws://127.0.0.1:${portB}`,
  });
  const clients = [];
  try {
    await store.init();
    assert(store.isReady(), "Redis route smoke store did not connect");
    await waitForServer(serverA, { requireRedis: true, requireRouteFeature: true });
    await waitForServer(serverB, { requireRedis: true, requireRouteFeature: true });

    const ownerClient = await createClient(serverA.wsUrl, "RouteOwnerA", options);
    const redirectedClient = await createClient(serverB.wsUrl, "RouteOwnerB", options);
    clients.push(ownerClient, redirectedClient);

    assert((await ownerClient.joinWorld(world)).ok, "owner server client could not join route smoke world");
    const route = await store.getWorldRoute(world);
    assert(route.ok, "Redis did not report a route owner");
    assert(route.owner_instance_id === "route-smoke-a", `expected route-smoke-a owner, got ${JSON.stringify(route)}`);
    routeOwnershipToken = String(route.ownership_token || "");
    assert(routeOwnershipToken !== "", "Redis route did not expose an ownership fence token");

    const rejected = await redirectedClient.joinWorld(world);
    assert(!rejected.ok && rejected.reason === "world_route_redirect", `expected world_route_redirect, got ${JSON.stringify(rejected.response)}`);
    assert(rejected.response.owner_instance_id === "route-smoke-a", "redirect did not include owner instance");
    assert(rejected.response.redirect_ws_url === `ws://127.0.0.1:${portA}`, "redirect did not include owner ws url");
    assert(redirectedClient.messages.some((message) => message.type === "world_route_redirect" && message.world === world), "world_route_redirect payload was not sent before rejection");
  } finally {
    for (const client of clients) client.close();
    await wait(500);
    if (store.isReady() && routeOwnershipToken !== "") {
      await store.releaseWorldRoute(world, "route-smoke-a", routeOwnershipToken);
    }
    await store.close();
    await stopServer(serverA);
    await stopServer(serverB);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  const cwd = process.cwd();
  const backendRoot = fs.existsSync(path.join(cwd, "server.js")) ? cwd : path.resolve(__dirname, "..");
  const options = {
    backendRoot,
    serverPath: path.join(backendRoot, "server.js"),
    redisUrl: String(args["redis-url"] || process.env.REDIS_URL || "redis://127.0.0.1:6379").trim(),
    redisConnectTimeoutMs: parseInteger(args["redis-connect-timeout-ms"], 1500, 250, 30000),
    requireRedis: boolArg(args["require-redis"]),
    skipSecurity: boolArg(args["skip-security"]),
    keepLogs: boolArg(args["keep-logs"]),
    clientVersion: String(args["client-version"] || "999.0.0").trim(),
    clientTimeoutMs: parseInteger(args["client-timeout-ms"], 8000, 1000, 60000),
    handshakeTimeoutMs: parseInteger(args["handshake-timeout-ms"], 5000, 1000, 60000),
    tempRoot: fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-multiplayer-smoke-")),
  };

  const summary = {
    syntax: "pending",
    static_gates: "pending",
    local_single_instance: "pending",
    redis_world_cap: "pending",
    redis_route_conflict: "pending",
  };

  try {
    await runSyntaxChecks(options);
    summary.syntax = "ok";

    await runStaticGates(options);
    summary.static_gates = options.skipSecurity ? "ok (security skipped)" : "ok";

    await runLocalSingleInstanceSmoke(options);
    summary.local_single_instance = "ok";

    const redisAvailable = await preflightRedis(options);
    if (!redisAvailable) {
      if (options.requireRedis) {
        throw new Error(`Redis is not reachable at ${options.redisUrl}`);
      }
      summary.redis_world_cap = "skipped (Redis unavailable)";
      summary.redis_route_conflict = "skipped (Redis unavailable)";
    } else {
      await runRedisWorldCapSmoke(options);
      summary.redis_world_cap = "ok";
      await runRedisRouteConflictSmoke(options);
      summary.redis_route_conflict = "ok";
    }

    console.log("[multiplayer-smoke] summary");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (!options.keepLogs) {
      fs.rmSync(options.tempRoot, { recursive: true, force: true });
    } else {
      console.log(`[multiplayer-smoke] kept temp data at ${options.tempRoot}`);
    }
  }
}

main().catch((error) => {
  console.error(`[multiplayer-smoke] failed: ${error.stack || error.message}`);
  process.exit(1);
});
