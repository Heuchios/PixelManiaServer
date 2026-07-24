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
  messageRouter: readFirst(fromBackend("src/server_message_router_helpers.ts")),
  botRateLimitHelpers: readFirst([
    ...fromBackend("src/server_bot_rate_limit_helpers.ts"),
    ...fromBackend("server_bot_rate_limit_helpers.js"),
  ]),
  accountSessionHelpers: readFirst([
    ...fromBackend("src/server_account_session_helpers.ts"),
    ...fromBackend("server_account_session_helpers.js"),
  ]),
  packageJson: readFirst(fromBackend("package.json")),
  deploy: require("./release_deployment_test_helpers").readDeploymentCoverage(path.resolve(__dirname, "..")),
  envExample: readFirst(fromBackend(".env.example"), false),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
};

const checks = [
  {
    name: "server has named bot/rate-limit configuration for checklist item 12",
    ok: files.server.includes("ServerBotRateLimitHelpersModule.createServerBotRateLimitTables")
      && files.server.includes("const BOT_RATE_LIMITS = ServerBotRateLimitTables.botRateLimits")
      && files.botRateLimitHelpers.includes("createServerBotRateLimitTables")
      && files.botRateLimitHelpers.includes('makeBotRateLimitConfig("BOT_BLOCK_PLACE"')
      && files.botRateLimitHelpers.includes('makeBotRateLimitConfig("BOT_BLOCK_BREAK"')
      && files.botRateLimitHelpers.includes('makeBotRateLimitConfig("BOT_PICKUP_ATTEMPT"')
      && files.botRateLimitHelpers.includes('makeBotRateLimitConfig("BOT_CHAT_MESSAGE"')
      && files.botRateLimitHelpers.includes('makeBotRateLimitConfig("BOT_PLAYER_PUNCH"')
      && files.botRateLimitHelpers.includes('makeBotRateLimitConfig("BOT_TRADE_REQUEST"')
      && files.botRateLimitHelpers.includes('makeBotRateLimitConfig("BOT_WORLD_JOIN"')
      && files.botRateLimitHelpers.includes('makeBotRateLimitConfig("BOT_VENDING_PURCHASE"'),
  },
  {
    name: "message path applies both broad message limits and action-specific bot limits",
    ok: files.server.includes("checkMessageRateLimit(socket, player, String(data.type || \"unknown\"), data)")
      && files.server.includes("checkBotActionRateLimit(socket, player, String(data.type || \"unknown\"), data)")
      && files.server.includes("getServerBotRateLimitHelpers().checkMessageRateLimit")
      && files.server.includes("getServerBotRateLimitHelpers().checkBotActionRateLimit")
      && files.botRateLimitHelpers.includes("consumeScopedRateLimit(socket, player, \"bot\"")
      && files.botRateLimitHelpers.includes("messageRouterHelpers.getMessageRateLimitDecision")
      && files.botRateLimitHelpers.includes("messageRouterHelpers.getBotRateLimitDecision"),
  },
  {
    name: "block place and block break/hit are limited separately",
    ok: files.messageRouter.includes('if (action === "place") return "block_place"')
      && files.messageRouter.includes('if (action === "break" || action === "hit") return "block_break"'),
  },
  {
    name: "pickup, chat, trade, world join, and vending purchase limits are wired",
    ok: files.messageRouter.includes('return "pickup_attempt"')
      && files.messageRouter.includes('return "chat_message"')
      && files.messageRouter.includes('return "trade_request"')
      && files.messageRouter.includes('return "world_join"')
      && files.messageRouter.includes('action === "vend_buy") return "vending_purchase"'),
  },
  {
    name: "limits use Redis when available and local socket buckets as fallback",
    ok: files.botRateLimitHelpers.includes("redisStore.checkRateLimit")
      && files.botRateLimitHelpers.includes('ensureSocketMap(socket, "rateLimits")')
      && files.botRateLimitHelpers.includes("localBucketKey = `${cleanScope}:${cleanBucketKey}`"),
  },
  {
    name: "high-frequency player movement uses an intentional burst-tolerant per-socket bucket",
    ok: files.botRateLimitHelpers.includes('decision.bucketKey === "player_position" ? { store: "socket", burstMultiplier: 2 } : {}')
      && files.botRateLimitHelpers.includes('const socketStore = options.store === "socket"')
      && files.botRateLimitHelpers.includes('store: "socket_token_bucket"')
      && files.botRateLimitHelpers.includes("if (!socketStore && typeof deps.redisStore"),
  },
  {
    name: "rate-limit blocks are visible to clients and mirrored into security events",
    ok: files.messageRouter.includes("type: \"rate_limited\"")
      && files.botRateLimitHelpers.includes("logRateLimitSecurityEvent")
      && files.botRateLimitHelpers.includes("rate_limit_exceeded")
      && files.server.includes("BOT_RATE_LIMIT_SECURITY_LOG_WINDOW_MS"),
  },
  {
    name: "password and token login IP/account throttling remain separated",
    ok: files.server.includes("LOGIN_ATTEMPT_LIMIT_IP")
      && files.server.includes("LOGIN_ATTEMPT_LIMIT_ACCOUNT")
      && files.server.includes("TOKEN_LOGIN_ATTEMPT_LIMIT_IP")
      && files.server.includes("TOKEN_LOGIN_ATTEMPT_LIMIT_ACCOUNT")
      && files.server.includes("checkLoginAttemptAllowed")
      && files.accountSessionHelpers.includes("isTokenLogin")
      && files.accountSessionHelpers.includes("\"auth:token\" : \"auth:login\"")
      && files.accountSessionHelpers.includes("`${scopePrefix}:ip`")
      && files.accountSessionHelpers.includes("`${scopePrefix}:account`"),
  },
  {
    name: "env example exposes bot/rate-limit knobs",
    ok: files.envExample.includes("BOT_BLOCK_PLACE_LIMIT")
      && files.envExample.includes("BOT_BLOCK_BREAK_LIMIT")
      && files.envExample.includes("BOT_PICKUP_ATTEMPT_LIMIT")
      && files.envExample.includes("BOT_CHAT_MESSAGE_LIMIT")
      && files.envExample.includes("BOT_PLAYER_PUNCH_LIMIT")
      && files.envExample.includes("BOT_TRADE_REQUEST_LIMIT")
      && files.envExample.includes("BOT_WORLD_JOIN_LIMIT")
      && files.envExample.includes("BOT_VENDING_PURCHASE_LIMIT"),
  },
  {
    name: "package security check includes bot/rate-limit wiring check",
    ok: files.packageJson.includes('"check:bot-rate-limits": "node scripts/check_bot_rate_limit_wiring.js"')
      && files.packageJson.includes("npm run check:server-bot-rate-limit-helpers")
      && files.packageJson.includes("npm run check:bot-rate-limits"),
  },
  {
    name: "deploy helper ships and runs bot/rate-limit wiring check",
    ok: files.deploy.includes("$localBotRateLimitWiringCheck")
      && files.deploy.includes("$localServerBotRateLimitHelpers")
      && files.deploy.includes("node --check scripts/check_server_bot_rate_limit_helpers_build.js")
      && files.deploy.includes("npm run build:server-bot-rate-limit-helpers")
      && files.deploy.includes("node --check scripts/check_bot_rate_limit_wiring.js")
      && files.deploy.includes("npm run check:bot-rate-limits"),
  },
  {
    name: "project docs describe bot/rate-limit policy and handoff status",
    ok: files.rules.includes("Bot / Rate-Limit Protection")
      && files.handoff.includes("Bot / Rate-Limit Protection")
      && files.handoff.includes("check:bot-rate-limits"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[bot-rate-limit-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[bot-rate-limit-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[bot-rate-limit-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[bot-rate-limit-wiring] success");
