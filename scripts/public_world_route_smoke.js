"use strict";

const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

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
  npm run smoke:world-route:public -- --owner-url wss://api.pixelmaniagame.com/staging-ws-a --other-url wss://api.pixelmaniagame.com/staging-ws-b
  npm run smoke:world-route:public -- --owner-url wss://api.pixelmaniagame.com/ws-a --other-url wss://api.pixelmaniagame.com/ws-b --owner-instance-id pixelmania-a --token-file ./load_tokens.json --follow-redirect

Connects to two public WebSocket routes, joins a world through the owner route,
then verifies the other route rejects with world_route_redirect pointing back to
the owner route. Without --token-file, the target route instances must allow
dev_backend_login. With --token-file, the smoke uses production account tokens.

Useful knobs:
  --owner-url wss://api.pixelmaniagame.com/staging-ws-a
  --other-url wss://api.pixelmaniagame.com/staging-ws-b
  --owner-instance-id route-stage-a
  --token-file ./load_tokens.json
  --token-out-file ./load_tokens.next.json
  --world PUBLIC_ROUTE_SMOKE
  --follow-redirect
  --insecure
`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function readTokenAccounts(tokenFile) {
  if (!tokenFile) return [];
  const fullPath = path.resolve(tokenFile);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Token file not found: ${fullPath}`);
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
  console.log(`[public-route-smoke] wrote rotated token pool: ${fullPath}`);
}

function send(ws, clientVersion, payload) {
  ws.send(JSON.stringify({
    client_version: clientVersion,
    message_id: `${payload.type}-${Date.now()}-${Math.random()}`,
    ...payload,
  }));
}

function createClient(wsUrl, auth, options) {
  const username = String(auth?.username || "").trim();
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
    wsUrl,
    messages,
    send(payload) {
      send(ws, options.clientVersion, payload);
    },
    waitFor(predicate, label, timeoutMs = options.clientTimeoutMs) {
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
          ["world_route_redirect", "world_route_unavailable", "world_full"].includes(message.reason);
      }, `join ${world}`);
      if (response.type === "join_world_ok") return { ok: true, response };
      return { ok: false, reason: response.reason, response };
    },
    close() {
      try {
        if (ws) ws.close();
      } catch (_error) {
        // Ignore cleanup close errors.
      }
    },
  };

  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl, {
      perMessageDeflate: false,
      handshakeTimeout: options.handshakeTimeoutMs,
      rejectUnauthorized: !options.insecure,
    });
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error(`${username} timed out during login to ${wsUrl}`));
    }, options.clientTimeoutMs);
    ws.on("open", () => {
      if (options.devLogin) {
        send(ws, options.clientVersion, {
          type: "dev_backend_login",
          username,
          world: "PUBLIC_ROUTE_LOBBY",
        });
        return;
      }

      const payload = {
        type: "account_token_login",
        username,
      };
      if (auth.refresh_token) {
        payload.refresh_token = auth.refresh_token;
      } else {
        payload.session_token = auth.session_token;
      }
      send(ws, options.clientVersion, payload);
    });
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch (_error) {
        return;
      }
      messages.push(message);
      while (messages.length > 300) messages.shift();
      checkWaiters(message);
      if (message.type === "account_auth_ok") {
        if (!options.devLogin) {
          auth.session_token = String(message.session_token || auth.session_token || "");
          auth.refresh_token = String(message.refresh_token || auth.refresh_token || "");
        }
        clearTimeout(timeout);
        resolve(client);
        return;
      }
      if (message.type === "account_auth_error" || message.type === "auth_required") {
        clearTimeout(timeout);
        client.close();
        reject(new Error(`${username} auth failed at ${wsUrl}: ${JSON.stringify(message)}`));
      }
    });
    ws.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  const ownerUrl = normalizeUrl(args["owner-url"] || "wss://api.pixelmaniagame.com/staging-ws-a");
  const otherUrl = normalizeUrl(args["other-url"] || "wss://api.pixelmaniagame.com/staging-ws-b");
  const tokenFile = args["token-file"] ? String(args["token-file"]) : "";
  const tokenAccounts = readTokenAccounts(tokenFile);
  const options = {
    ownerUrl,
    otherUrl,
    expectedOwnerInstanceId: String(args["owner-instance-id"] || "route-stage-a").trim(),
    world: String(args.world || `PUBLIC_ROUTE_${Date.now()}`).trim().toUpperCase().replace(/\s+/g, "_"),
    followRedirect: boolArg(args["follow-redirect"]),
    insecure: boolArg(args.insecure),
    clientVersion: String(args["client-version"] || "999.0.0").trim(),
    clientTimeoutMs: parseInteger(args["client-timeout-ms"], 10000, 1000, 60000),
    handshakeTimeoutMs: parseInteger(args["handshake-timeout-ms"], 7000, 1000, 60000),
    devLogin: tokenAccounts.length === 0,
    tokenOutFile: args["token-out-file"]
      ? String(args["token-out-file"])
      : (tokenFile ? `${tokenFile.replace(/\.json$/i, "")}.next.json` : ""),
  };

  assert(ownerUrl.startsWith("ws://") || ownerUrl.startsWith("wss://"), "--owner-url must be a WebSocket URL");
  assert(otherUrl.startsWith("ws://") || otherUrl.startsWith("wss://"), "--other-url must be a WebSocket URL");
  assert(ownerUrl !== otherUrl, "--owner-url and --other-url must be different routes");
  if (!options.devLogin) {
    const minimumTokens = options.followRedirect ? 3 : 2;
    assert(tokenAccounts.length >= minimumTokens, `--token-file needs at least ${minimumTokens} account token rows`);
  }

  const clients = [];
  try {
    const stamp = Date.now();
    const ownerAuth = options.devLogin ? { username: `RouteA${stamp}`.slice(0, 16) } : tokenAccounts[0];
    const owner = await createClient(ownerUrl, ownerAuth, options);
    clients.push(owner);
    const ownerJoin = await owner.joinWorld(options.world);
    assert(ownerJoin.ok, `owner route could not join ${options.world}: ${JSON.stringify(ownerJoin.response)}`);

    const otherAuth = options.devLogin ? { username: `RouteB${stamp}`.slice(0, 16) } : tokenAccounts[1];
    const other = await createClient(otherUrl, otherAuth, options);
    clients.push(other);
    const rejected = await other.joinWorld(options.world);
    assert(!rejected.ok, `other route unexpectedly joined owned world through ${otherUrl}`);
    assert(rejected.reason === "world_route_redirect", `expected world_route_redirect, got ${JSON.stringify(rejected.response)}`);
    assert(normalizeUrl(rejected.response.redirect_ws_url) === ownerUrl, `expected redirect ${ownerUrl}, got ${rejected.response.redirect_ws_url}`);
    if (options.expectedOwnerInstanceId) {
      assert(rejected.response.owner_instance_id === options.expectedOwnerInstanceId, `expected owner ${options.expectedOwnerInstanceId}, got ${rejected.response.owner_instance_id}`);
    }
    assert(other.messages.some((message) => message.type === "world_route_redirect" && message.world === options.world), "world_route_redirect payload was not emitted before rejection");

    let followJoin = null;
    if (options.followRedirect) {
      const followerAuth = options.devLogin ? { username: `RouteC${stamp}`.slice(0, 16) } : tokenAccounts[2];
      const follower = await createClient(rejected.response.redirect_ws_url, followerAuth, options);
      clients.push(follower);
      followJoin = await follower.joinWorld(options.world);
      assert(followJoin.ok, `redirect follow could not join owner route: ${JSON.stringify(followJoin.response)}`);
    }

    await wait(250);
    console.log(JSON.stringify({
      ok: true,
      world: options.world,
      owner_url: ownerUrl,
      other_url: otherUrl,
      owner_join: ownerJoin.ok,
      redirect_reason: rejected.reason,
      redirect_ws_url: rejected.response.redirect_ws_url,
      owner_instance_id: rejected.response.owner_instance_id,
      followed_redirect: Boolean(followJoin?.ok),
      auth_mode: options.devLogin ? "dev_backend_login" : "account_token_login",
    }, null, 2));
  } finally {
    if (!options.devLogin) writeTokenAccounts(options.tokenOutFile, tokenAccounts);
    for (const client of clients) client.close();
  }
}

main().catch((error) => {
  console.error(`[public-route-smoke] failed: ${error.stack || error.message}`);
  process.exit(1);
});
