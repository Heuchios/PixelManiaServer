#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/** @type {any} */
const BotRateLimitHelpersModule = require("../server_bot_rate_limit_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_bot_rate_limit_helpers.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_bot_rate_limit_helpers.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_bot_rate_limit_helpers_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-bot-rate-limit-helpers.json"), "utf8"));

const fakeEnvConfig = {
  makeBotRateLimitConfig(/** @type {string} */ prefix, /** @type {unknown} */ fallbackLimit, /** @type {unknown} */ fallbackWindowMs) {
    if (prefix === "BOT_CHAT_MESSAGE") return Object.freeze({ limit: 2, windowMs: 500 });
    return Object.freeze({
      limit: Math.trunc(Number(fallbackLimit) || 1),
      windowMs: Math.trunc(Number(fallbackWindowMs) || 1000),
    });
  },
};

const tables = BotRateLimitHelpersModule.createServerBotRateLimitTables({
  serverEnvConfig: fakeEnvConfig,
  env: { BOT_RATE_LIMIT_SECURITY_LOG_WINDOW_MS: "2500" },
});

assert.equal(tables.botRateLimits.block_place.limit, 75);
assert.equal(tables.botRateLimits.chat_message.limit, 2);
assert.equal(tables.messageRateLimits.chat.limit, 2);
assert.equal(tables.inventoryTransactionActionRateLimits.seed_place.limit, 60);
assert.deepEqual(tables.messageRateLimits.inventory_transaction_request, { limit: 150, windowMs: 5000 });
assert.deepEqual(tables.messageRateLimits.broadcast, { limit: 70, windowMs: 10000 });
assert.deepEqual(tables.messageRateLimits.world_block_update, { limit: 75, windowMs: 1000 });
assert.equal(tables.botRateLimitSecurityLogWindowMs, 2500);
assert.equal(Object.isFrozen(tables.botRateLimits), true);

/** @type {Array<any>} */
const sentPayloads = [];
/** @type {Array<any>} */
const deniedPayloads = [];
/** @type {Array<any>} */
const securityEvents = [];
const playerNetworkStats = {
  bot_rate_limit_rejections: 0,
  message_rate_limit_rejections: 0,
};

const messageRouterHelpers = {
  buildRateLimitedPayload: (/** @type {unknown} */ bucketKey, /** @type {unknown} */ data) => ({
    type: "rate_limited",
    action: String(bucketKey || ""),
    request_id: String((/** @type {Record<string, any>} */ (data && typeof data === "object" && !Array.isArray(data) ? data : {})).request_id || ""),
  }),
  buildRateLimitSecurityEventDetails: (
    /** @type {unknown} */ scope,
    /** @type {unknown} */ bucketKey,
    /** @type {{ limit: number, windowMs: number }} */ limits,
    /** @type {Record<string, any>} */ result,
    /** @type {unknown} */ _data,
    /** @type {unknown} */ _player,
    /** @type {unknown} */ subject
  ) => ({
    scope,
    bucket: bucketKey,
    limit: limits.limit,
    observed_count: Number(result.count || 0),
    subject,
  }),
  getBotRateLimitAction: (/** @type {unknown} */ messageType, /** @type {unknown} */ data) => {
    const action = String((/** @type {Record<string, any>} */ (data && typeof data === "object" && !Array.isArray(data) ? data : {})).action || "");
    if (String(messageType) === "world_block_update" && action === "place") return "block_place";
    if (String(messageType) === "chat") return "chat_message";
    return "";
  },
  getBotRateLimitDecision: (/** @type {unknown} */ messageType, /** @type {unknown} */ data) => {
    const actionKey = messageRouterHelpers.getBotRateLimitAction(messageType, data);
    return actionKey === ""
      ? { actionKey: "", bucketKey: "", limits: { limit: 60, windowMs: 1000 } }
      : { actionKey, bucketKey: actionKey, limits: { limit: 1, windowMs: 1000 } };
  },
  getMessageRateLimitDecision: (/** @type {unknown} */ messageType) => ({
    bucketKey: String(messageType || "unknown"),
    limits: { limit: 1, windowMs: 1000 },
  }),
  isDropPickupRateLimit: () => false,
};

const deps = {
  accountKey: (/** @type {unknown} */ value) => String(value || "").trim().toLowerCase(),
  botRateLimitSecurityLogWindowMs: 1000,
  getSocketAddress: () => "127.0.0.1",
  logSecurityEvent: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ event, /** @type {unknown} */ details, /** @type {unknown} */ severity) => {
    securityEvents.push({ event, details, severity });
  },
  makeRequestId: (/** @type {Record<string, any>} */ data) => String(data.request_id || ""),
  messageRouterHelpers,
  packetContracts: {
    isWorldBlockUpdatePacket: (/** @type {unknown} */ data) => Boolean((/** @type {Record<string, any>} */ (data && typeof data === "object" && !Array.isArray(data) ? data : {})).type === "world_block_update"),
  },
  playerNetworkStats,
  redisStore: {
    isReady: () => false,
  },
  sendDeveloperDenied: (/** @type {unknown} */ _socket, /** @type {unknown} */ requestId, /** @type {unknown} */ command, /** @type {unknown} */ message, /** @type {unknown} */ extra) => {
    deniedPayloads.push({ requestId, command, message, extra });
  },
  sendJson: (/** @type {unknown} */ _socket, /** @type {unknown} */ payload) => {
    sentPayloads.push(payload);
  },
  webSocketOpenState: 1,
};

/** @type {any} */
const helpers = BotRateLimitHelpersModule.createServerBotRateLimitHelpers(deps);

(async () => {
  const socket = { playerId: "p1", readyState: 1 };
  const player = { account_username: "USO" };

  assert.equal(helpers.getRateLimitSubject(socket, player), "account:uso");
  assert.equal(await helpers.checkMessageRateLimit(socket, player, "chat", { type: "chat", request_id: "m1" }), true);
  assert.equal(await helpers.checkMessageRateLimit(socket, player, "chat", { type: "chat", request_id: "m2" }), false);
  assert.equal(playerNetworkStats.message_rate_limit_rejections, 1);
  assert.equal(sentPayloads.at(-1).type, "rate_limited");

  assert.equal(helpers.getBotRateLimitAction("world_block_update", { action: "place" }), "block_place");
  assert.equal(await helpers.checkBotActionRateLimit(socket, player, "chat", { type: "chat", request_id: "b1" }), true);
  assert.equal(await helpers.checkBotActionRateLimit(socket, player, "chat", { type: "chat", request_id: "b2" }), false);
  assert.equal(playerNetworkStats.bot_rate_limit_rejections, 1);
  assert.equal(securityEvents.at(-1).event, "rate_limit_exceeded");
  assert.equal(securityEvents.at(-1).severity, "warning");

  const notificationCountBefore = sentPayloads.length;
  helpers.notifyRateLimited(socket, "inventory_transaction_request", { request_id: "inventory-1" });
  helpers.notifyRateLimited(socket, "inventory_transaction_request", { request_id: "inventory-2" });
  assert.equal(sentPayloads.length, notificationCountBefore + 1);

  helpers.notifyRateLimited(socket, "developer_command_request", { request_id: "dev-1", command: "give" });
  assert.equal(deniedPayloads.at(-1).requestId, "dev-1");
  assert.equal(deniedPayloads.at(-1).extra.reason, "rate_limited");

  const redisHelpers = BotRateLimitHelpersModule.createServerBotRateLimitHelpers({
    ...deps,
    redisStore: {
      isReady: () => true,
      checkRateLimit: async () => ({ allowed: false, count: 7, resetInMs: 700 }),
    },
  });
  assert.equal(await redisHelpers.consumeScopedRateLimit({ playerId: "p2", readyState: 1 }, { account_username: "" }, "bot", "chat_message", { limit: 1, windowMs: 1000 }, { type: "chat" }, { logSecurityEvent: true }), false);
  assert.equal(playerNetworkStats.bot_rate_limit_rejections, 2);

  assert.match(helperSource, /function createServerBotRateLimitTables/);
  assert.match(helperSource, /makeBotRateLimitConfig\("BOT_BLOCK_PLACE"/);
  assert.match(helperSource, /RATE_LIMIT_NOTIFICATION_COOLDOWN_MS = 3000/);
  assert.match(helperSource, /function createServerBotRateLimitHelpers/);
  assert.match(helperSource, /async function consumeScopedRateLimit/);
  assert.match(helperSource, /messageRouterHelpers\.getMessageRateLimitDecision/);
  assert.match(helperSource, /messageRouterHelpers\.getBotRateLimitDecision/);
  assert.match(generatedSource, /Generated from src\/server_bot_rate_limit_helpers\.ts/);
  assert.match(generatedSource, /module\.exports = /);
  assert.deepEqual(buildConfig.include, ["src/server_bot_rate_limit_helpers.ts"]);
  assert.match(syncSource, /server_bot_rate_limit_helpers\.js/);
  assert.match(serverSource, /require\("\.\/server_bot_rate_limit_helpers"\)/);
  assert.match(serverSource, /createServerBotRateLimitTables/);
  assert.match(serverSource, /createServerBotRateLimitHelpers/);
  assert.match(serverSource, /ACTION_RATE_LIMIT_MS[^;\n]*\|\| 25\)/);
  assert.match(serverSource, /MIN_BLOCK_BREAK_INTERVAL_MS[^;\n]*\|\| 75\)/);
  assert.match(serverSource, /MIN_BLOCK_PLACE_INTERVAL_MS[^;\n]*\|\| 75\)/);
  assert.match(serverSource, /getServerBotRateLimitHelpers\(\)\.checkMessageRateLimit/);
  assert.match(serverSource, /getServerBotRateLimitHelpers\(\)\.checkBotActionRateLimit/);
  assert.doesNotMatch(serverSource, /async function consumeScopedRateLimit\(socket, player, scope, bucketKey, limits, data = null, options = \{\}\) \{\s+const safeLimits/);
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-bot-rate-limit-helpers/);
  assert.match(deploySource, /server_bot_rate_limit_helpers\.js/);
  assert.match(deploySource, /src\/server_bot_rate_limit_helpers\.ts/);
  assert.match(deploySource, /tsconfig\.server-bot-rate-limit-helpers\.json/);
  assert.match(deploySource, /check_server_bot_rate_limit_helpers_build\.js/);
  assert.match(deploySource, /sync_server_bot_rate_limit_helpers_build\.js/);
  assert.match(deploySource, /npm run build:server-bot-rate-limit-helpers/);

  console.log("[server-bot-rate-limit-helpers] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
