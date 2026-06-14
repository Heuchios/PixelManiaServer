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
  packageJson: readFirst(fromBackend("package.json")),
  deploy: readFirst(fromBackend("deploy_to_droplet.ps1"), false),
  envExample: readFirst(fromBackend(".env.example"), false),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
};

const checks = [
  {
    name: "server has named bot/rate-limit configuration for checklist item 12",
    ok: files.server.includes("const BOT_RATE_LIMITS = Object.freeze")
      && files.server.includes('makeBotRateLimitConfig("BOT_BLOCK_PLACE"')
      && files.server.includes('makeBotRateLimitConfig("BOT_BLOCK_BREAK"')
      && files.server.includes('makeBotRateLimitConfig("BOT_PICKUP_ATTEMPT"')
      && files.server.includes('makeBotRateLimitConfig("BOT_CHAT_MESSAGE"')
      && files.server.includes('makeBotRateLimitConfig("BOT_TRADE_REQUEST"')
      && files.server.includes('makeBotRateLimitConfig("BOT_WORLD_JOIN"')
      && files.server.includes('makeBotRateLimitConfig("BOT_VENDING_PURCHASE"'),
  },
  {
    name: "message path applies both broad message limits and action-specific bot limits",
    ok: files.server.includes("checkMessageRateLimit(socket, player, String(data.type || \"unknown\"), data)")
      && files.server.includes("checkBotActionRateLimit(socket, player, String(data.type || \"unknown\"), data)")
      && files.server.includes("consumeScopedRateLimit(socket, player, \"bot\""),
  },
  {
    name: "block place and block break/hit are limited separately",
    ok: files.server.includes('if (type === "world_block_update")')
      && files.server.includes('if (action === "place") return "block_place"')
      && files.server.includes('if (action === "break" || action === "hit") return "block_break"'),
  },
  {
    name: "pickup, chat, trade, world join, and vending purchase limits are wired",
    ok: files.server.includes('return "pickup_attempt"')
      && files.server.includes('return "chat_message"')
      && files.server.includes('return "trade_request"')
      && files.server.includes('return "world_join"')
      && files.server.includes('action === "vend_buy") return "vending_purchase"'),
  },
  {
    name: "limits use Redis when available and local socket buckets as fallback",
    ok: files.server.includes("redisStore.checkRateLimit")
      && files.server.includes("socket.rateLimits")
      && files.server.includes("localBucketKey = `${cleanScope}:${cleanBucketKey}`"),
  },
  {
    name: "rate-limit blocks are visible to clients and mirrored into security events",
    ok: files.server.includes("type: \"rate_limited\"")
      && files.server.includes("logRateLimitSecurityEvent")
      && files.server.includes("rate_limit_exceeded")
      && files.server.includes("BOT_RATE_LIMIT_SECURITY_LOG_WINDOW_MS"),
  },
  {
    name: "login attempt IP/account throttling remains wired",
    ok: files.server.includes("LOGIN_ATTEMPT_LIMIT_IP")
      && files.server.includes("LOGIN_ATTEMPT_LIMIT_ACCOUNT")
      && files.server.includes("checkLoginAttemptAllowed")
      && files.server.includes("auth:login:ip"),
  },
  {
    name: "env example exposes bot/rate-limit knobs",
    ok: files.envExample.includes("BOT_BLOCK_PLACE_LIMIT")
      && files.envExample.includes("BOT_BLOCK_BREAK_LIMIT")
      && files.envExample.includes("BOT_PICKUP_ATTEMPT_LIMIT")
      && files.envExample.includes("BOT_CHAT_MESSAGE_LIMIT")
      && files.envExample.includes("BOT_TRADE_REQUEST_LIMIT")
      && files.envExample.includes("BOT_WORLD_JOIN_LIMIT")
      && files.envExample.includes("BOT_VENDING_PURCHASE_LIMIT"),
  },
  {
    name: "package security check includes bot/rate-limit wiring check",
    ok: files.packageJson.includes('"check:bot-rate-limits": "node scripts/check_bot_rate_limit_wiring.js"')
      && files.packageJson.includes("npm run check:bot-rate-limits"),
  },
  {
    name: "deploy helper ships and runs bot/rate-limit wiring check",
    ok: files.deploy.includes("$localBotRateLimitWiringCheck")
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
