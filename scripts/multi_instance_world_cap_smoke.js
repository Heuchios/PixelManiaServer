"use strict";

const fs = require("fs");
const http = require("http");
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

function usage() {
  return `
Usage:
  npm run smoke:world-cap:multi -- --redis-url redis://127.0.0.1:6379 --cap 2 --ports 18570,18571

Starts two local PixelMania backend processes that share the same Redis URL and
then connects cap + 1 dev-login clients to one world across both processes.
The test passes only when Redis enforces one shared MAX_PLAYERS_PER_WORLD cap.

Useful knobs:
  --redis-url redis://127.0.0.1:6379
  --redis-key-prefix pixelmania_smoke
  --cap 2
  --ports 18570,18571
  --world MULTI_INSTANCE_CAP_SMOKE
  --allow-skip              Exit 0 if Redis is unavailable. Useful on dev PCs.
  --keep-logs               Keep temporary server logs/data after completion.
`;
}

function getJson(url, timeoutMs = 3000) {
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(ws, clientVersion, payload) {
  ws.send(JSON.stringify({
    client_version: clientVersion,
    message_id: `${payload.type}-${Date.now()}-${Math.random()}`,
    ...payload,
  }));
}

async function preflightRedis(options) {
  const store = new RedisStore({
    enabled: true,
    url: options.redisUrl,
    keyPrefix: options.redisKeyPrefix,
    connectTimeoutMs: options.redisConnectTimeoutMs,
    logger: (...args) => console.warn(...args),
  });
  try {
    await store.init();
    if (!store.isReady()) return { ok: false, store: null };
    return { ok: true, store };
  } catch (_error) {
    await store.close();
    return { ok: false, store: null };
  }
}

function appendLog(buffer, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
  buffer.push(text);
  while (buffer.join("").length > 32_000 && buffer.length > 1) buffer.shift();
}

function spawnServer(options, port, index) {
  const dataDir = path.join(options.tempRoot, `server-${index}`);
  fs.mkdirSync(dataDir, { recursive: true });
  const log = [];
  const env = {
    ...process.env,
    PORT: String(port),
    ENVIRONMENT: "development",
    NODE_ENV: "development",
    PIXELMANIA_ALLOW_DEV_TOOLS: "true",
    PIXELMANIA_ENABLE_DEV_BACKEND_LOGIN: "true",
    PIXELMANIA_DATA_DIR: dataDir,
    MAX_PLAYERS_PER_WORLD: String(options.cap),
    WORLD_ADMISSION_TTL_MS: String(options.worldAdmissionTtlMs),
    REDIS_ENABLED: "true",
    REDIS_URL: options.redisUrl,
    REDIS_KEY_PREFIX: options.redisKeyPrefix,
    REDIS_CONNECT_TIMEOUT_MS: String(options.redisConnectTimeoutMs),
    DATABASE_URL: "",
    POSTGRES_URL: "",
    DISABLE_POSTGRES: "true",
    PIXELMANIA_DISABLE_POSTGRES: "true",
    MIN_CLIENT_VERSION: "0.0.0",
  };
  const child = spawn(process.execPath, [options.serverPath], {
    cwd: options.backendRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => appendLog(log, chunk));
  child.stderr.on("data", (chunk) => appendLog(log, chunk));
  return {
    index,
    port,
    dataDir,
    child,
    log,
    healthUrl: `http://127.0.0.1:${port}/health`,
    wsUrl: `ws://127.0.0.1:${port}`,
  };
}

async function waitForServer(server, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`server ${server.index} exited early with code ${server.child.exitCode}\n${server.log.join("")}`);
    }
    const health = await getJson(server.healthUrl, 1000);
    if (health && health.ok && health.persistence?.redis_ready === true && health.features?.redis_world_admission === true) {
      return health;
    }
    await wait(250);
  }
  throw new Error(`server ${server.index} did not become healthy with Redis\n${server.log.join("")}`);
}

function connectAndJoin(server, clientIndex, options) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(server.wsUrl, {
      perMessageDeflate: false,
      handshakeTimeout: options.handshakeTimeoutMs,
    });
    const timeout = setTimeout(() => {
      try { ws.close(); } catch (_error) {}
      reject(new Error(`client ${clientIndex} timed out on server ${server.index}`));
    }, options.clientTimeoutMs);

    ws.on("open", () => {
      send(ws, options.clientVersion, {
        type: "dev_backend_login",
        username: `${options.usernamePrefix}${clientIndex}`,
        world: "SMOKE_LOBBY",
      });
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch (_error) {
        return;
      }
      if (msg.type === "account_auth_ok") {
        send(ws, options.clientVersion, { type: "join_world", world: options.world, facing: 1 });
        return;
      }
      if (msg.type === "join_world_ok" && msg.world === options.world) {
        clearTimeout(timeout);
        resolve({ index: clientIndex, server: server.index, outcome: "joined", ws });
        return;
      }
      if (msg.type === "action_rejected" && msg.reason === "world_full") {
        clearTimeout(timeout);
        try { ws.close(); } catch (_error) {}
        resolve({
          index: clientIndex,
          server: server.index,
          outcome: "rejected",
          reason: msg.reason,
          current_players: msg.current_players,
          max_players: msg.max_players,
        });
        return;
      }
      if (msg.type === "account_auth_error" || msg.type === "auth_required") {
        clearTimeout(timeout);
        try { ws.close(); } catch (_error) {}
        reject(new Error(`client ${clientIndex} auth failed: ${JSON.stringify(msg)}`));
      }
    });
    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  const backendRoot = path.resolve(__dirname, "..");
  const ports = String(args.ports || "18570,18571").split(",").map((value) => parseInteger(value, 0, 1, 65535)).filter(Boolean);
  const options = {
    backendRoot,
    serverPath: path.join(backendRoot, "server.js"),
    redisUrl: String(args["redis-url"] || process.env.REDIS_URL || "redis://127.0.0.1:6379").trim(),
    redisKeyPrefix: String(args["redis-key-prefix"] || `pixelmania_world_cap_smoke_${Date.now()}`).trim(),
    redisConnectTimeoutMs: parseInteger(args["redis-connect-timeout-ms"], 1500, 250, 30000),
    cap: parseInteger(args.cap, 2, 1, 50),
    ports: ports.length >= 2 ? ports.slice(0, 2) : [18570, 18571],
    world: String(args.world || "MULTI_INSTANCE_CAP_SMOKE").trim().toUpperCase().replace(/\s+/g, "_"),
    usernamePrefix: String(args["username-prefix"] || "MultiCapSmoke").trim().replace(/[^A-Za-z0-9_]/g, "").slice(0, 12) || "MultiCap",
    clientVersion: String(args["client-version"] || "999.0.0").trim(),
    worldAdmissionTtlMs: parseInteger(args["world-admission-ttl-ms"], 45000, 10000, 600000),
    serverStartTimeoutMs: parseInteger(args["server-start-timeout-ms"], 15000, 1000, 120000),
    clientTimeoutMs: parseInteger(args["client-timeout-ms"], 8000, 1000, 60000),
    handshakeTimeoutMs: parseInteger(args["handshake-timeout-ms"], 5000, 1000, 60000),
    allowSkip: boolArg(args["allow-skip"]),
    keepLogs: boolArg(args["keep-logs"]),
    tempRoot: fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-world-cap-smoke-")),
  };

  const preflight = await preflightRedis(options);
  if (!preflight.ok) {
    const message = `[world-cap-smoke] Redis is not reachable at ${options.redisUrl}`;
    fs.rmSync(options.tempRoot, { recursive: true, force: true });
    if (options.allowSkip) {
      console.log(`${message}; skipped because --allow-skip was provided.`);
      return;
    }
    throw new Error(`${message}. Start Redis or rerun with --allow-skip on local dev machines.`);
  }

  const servers = [];
  const joinedSockets = [];
  let redisStore = preflight.store;
  try {
    await redisStore.releaseWorldAdmission(options.world, `${options.usernamePrefix}cleanup`);
    servers.push(spawnServer(options, options.ports[0], 1));
    servers.push(spawnServer(options, options.ports[1], 2));
    const health = [];
    for (const server of servers) {
      health.push(await waitForServer(server, options.serverStartTimeoutMs));
    }

    const results = [];
    for (let index = 1; index <= options.cap + 1; index += 1) {
      const server = servers[(index - 1) % servers.length];
      const result = await connectAndJoin(server, index, options);
      results.push(result);
      if (result.ws) joinedSockets.push(result.ws);
    }

    const joined = results.filter((result) => result.outcome === "joined");
    const rejected = results.filter((result) => result.outcome === "rejected");
    const redisCount = await redisStore.getWorldAdmissionCount(options.world);
    const summary = {
      cap: options.cap,
      world: options.world,
      ports: options.ports,
      redis_key_prefix: options.redisKeyPrefix,
      joined: joined.length,
      rejected: rejected.length,
      redis_world_admission_count: redisCount.count,
      health: health.map((item) => ({
        redis_ready: item.persistence?.redis_ready === true,
        redis_world_admission: item.features?.redis_world_admission === true,
        max_players_per_world: item.features?.max_players_per_world,
        world_admission_ttl_ms: item.features?.world_admission_ttl_ms,
      })),
      results: results.map(({ ws, ...rest }) => rest),
    };
    console.log(JSON.stringify(summary, null, 2));

    if (joined.length !== options.cap || rejected.length !== 1 || rejected[0]?.reason !== "world_full") {
      throw new Error("expected cap joined clients and one world_full rejection across both backend instances");
    }
    if (!redisCount.ok || redisCount.count !== options.cap) {
      throw new Error(`expected Redis world admission count ${options.cap}, got ${redisCount.count}`);
    }
  } finally {
    for (const ws of joinedSockets) {
      try { ws.close(); } catch (_error) {}
    }
    await wait(500);
    if (redisStore) {
      for (let index = 1; index <= options.cap + 1; index += 1) {
        await redisStore.releaseWorldAdmission(options.world, `${options.usernamePrefix}${index}`);
      }
      await redisStore.close();
      redisStore = null;
    }
    for (const server of servers) {
      await stopServer(server);
    }
    if (!options.keepLogs) {
      fs.rmSync(options.tempRoot, { recursive: true, force: true });
    } else {
      console.log(`[world-cap-smoke] kept logs and temp data at ${options.tempRoot}`);
    }
  }
}

main().catch((error) => {
  console.error(`[world-cap-smoke] failed: ${error.message}`);
  process.exit(1);
});
