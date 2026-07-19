#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PacketContracts = require("../server_packet_contracts");
const MessageRouterHelpersModule = require("../server_message_router_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_message_router_helpers.ts"), "utf8");
const botRateLimitHelperSource = fs.readFileSync(path.join(repoRoot, "src", "server_bot_rate_limit_helpers.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_message_router_helpers.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_message_router_helpers_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-message-router-helpers.json"), "utf8"));

/** @type {any} */
const helpers = MessageRouterHelpersModule.createServerMessageRouterHelpers({
  packetContracts: PacketContracts,
  messageRateLimits: {
    chat: { limit: 3, windowMs: 1000 },
    inventory_transaction_request: { limit: 12, windowMs: 5000 },
    world_block_update: { limit: 35, windowMs: 1000 },
  },
  inventoryTransactionActionRateLimits: {
    seed_place: { limit: 35, windowMs: 1000 },
  },
  botRateLimits: {
    block_place: { limit: 20, windowMs: 1000 },
    block_break: { limit: 16, windowMs: 1000 },
    pickup_attempt: { limit: 12, windowMs: 1000 },
    chat_message: { limit: 3, windowMs: 1000 },
    trade_request: { limit: 20, windowMs: 60000 },
    world_join: { limit: 20, windowMs: 60000 },
    vending_purchase: { limit: 5, windowMs: 1000 },
  },
  defaultMessageRateLimit: { limit: 60, windowMs: 1000 },
  idempotencyTtlMs: 10000,
  idempotencyTtlMsCritical: 2500,
  idempotencyTtlMsWorldAction: 1200,
  idempotencyTtlMsCombat: 600,
  maxItemIdLength: 64,
  maxDropIdLength: 96,
  maxBulkDropPickupIds: 48,
  normalizePacketTypeName(/** @type {unknown} */ value) {
    return String(value || "unknown").trim().toLowerCase() || "unknown";
  },
  cleanAccountName(/** @type {unknown} */ value) {
    return String(value || "").trim();
  },
  cleanWorld(/** @type {unknown} */ value) {
    const clean = String(value || "START").trim().toUpperCase().replace(/\s+/g, "_");
    return clean.replace(/[^A-Z0-9_-]/g, "").slice(0, 32) || "START";
  },
  clampString(/** @type {unknown} */ value, /** @type {number | undefined} */ limit = 64) {
    return String(value || "").trim().slice(0, limit);
  },
  cleanDropIdList(/** @type {unknown} */ rawIds, /** @type {number | undefined} */ maxIds = 48) {
    const ids = [];
    const seen = new Set();
    for (const rawId of Array.isArray(rawIds) ? rawIds : []) {
      const id = String(rawId || "").trim().slice(0, 96);
      if (id === "" || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= maxIds) break;
    }
    return ids;
  },
});

assert.equal(helpers.getRawLength(Buffer.from("abc")), 3);
assert.equal(helpers.getRawLength("abcd"), 4);
assert.equal(helpers.getInboundMessageType({ type: " Chat " }), "chat");
assert.equal(helpers.getInboundMessageType(null), "invalid");
assert.equal(helpers.makeRequestId({ request_id: " req-1 " }), "req-1");
assert.equal(helpers.makeRequestId({ action_id: " act-1 " }), "act-1");
assert.equal(helpers.makeMessageIdempotencyScope({
  type: "world_block_update",
  action: "place",
  world: "start",
  layer: "foreground",
  x: 3,
  y: 4,
}), "world_block_update:place:start:foreground:3:4");
assert.equal(helpers.makeMessageIdempotencyScope({
  type: "world_item_drop_pickup",
  drop_id: "drop-1",
}), "world_item_drop_pickup:drop-1");
assert.equal(helpers.makeMessageIdempotencyKey(
  { account_username: "uso", world: "START" },
  { request_id: "abc", world: "test" },
  "world_block_update:place:test:foreground:1:2"
), "uso:world_block_update:place:test:foreground:1:2:TEST:abc");
assert.equal(helpers.getMessageIdempotencyTTLMs({ type: "player_punch", request_id: "hit", target_player_id: "p2" }), 600);
assert.equal(helpers.getMessageIdempotencyTTLMs({ type: "trade_confirm", request_id: "t1" }), 2500);
assert.equal(helpers.getMessageIdempotencyTTLMs({ type: "world_item_drop_create", request_id: "d1" }), 1200);
assert.deepEqual(helpers.getMessageRateLimitDecision("inventory_transaction_request", { action: "seed_place" }), {
  bucketKey: "inventory_transaction_request:seed_place",
  limits: { limit: 35, windowMs: 1000 },
});
assert.deepEqual(helpers.getMessageRateLimitDecision("missing_type", {}), {
  bucketKey: "missing_type",
  limits: { limit: 60, windowMs: 1000 },
});
assert.equal(helpers.getBotRateLimitAction("world_block_update", { action: "place" }), "block_place");
assert.equal(helpers.getBotRateLimitAction("world_block_update", { action: "hit" }), "block_break");
assert.equal(helpers.getBotRateLimitAction("world_item_drop_pickup", {}), "pickup_attempt");
assert.equal(helpers.getBotRateLimitAction("chat", {}), "chat_message");
assert.equal(helpers.getBotRateLimitAction("trade_request", {}), "trade_request");
assert.equal(helpers.getBotRateLimitAction("join_world", {}), "world_join");
assert.equal(helpers.getBotRateLimitAction("inventory_transaction_request", { action: "vend_buy" }), "vending_purchase");
assert.deepEqual(helpers.getBotRateLimitDecision("chat", {}), {
  actionKey: "chat_message",
  bucketKey: "chat_message",
  limits: { limit: 3, windowMs: 1000 },
});
assert.deepEqual(helpers.buildRateLimitedPayload("world_block_update", {
  type: "world_block_update",
  request_id: "r1",
  world: "test",
  layer: "background",
  x: 2,
  y: 3,
  block_type: "dirt",
  action: "place",
}), {
  type: "rate_limited",
  action: "world_block_update",
  message: "Slow down a little.",
  reason: "rate_limited",
  rate_limit_bucket: "world_block_update",
  request_id: "r1",
  action_id: "r1",
  world: "TEST",
  layer: "background",
  x: 2,
  y: 3,
  target_x: 2,
  target_y: 3,
  block_type: "dirt",
  block_action: "place",
});
assert.deepEqual(helpers.buildRateLimitedPayload("pickup_attempt", {
  type: "world_item_drop_pickup",
  request_id: "p1",
  world: "test",
  drop_id: "drop-1",
  drop_ids: ["drop-1", "drop-2"],
}), {
  type: "rate_limited",
  action: "world_item_drop_pickup",
  message: "Slow down a little.",
  reason: "rate_limited",
  rate_limit_bucket: "pickup_attempt",
  request_id: "p1",
  action_id: "p1",
  world: "TEST",
  drop_id: "drop-1",
  drop_ids: ["drop-1", "drop-2"],
});
assert.deepEqual(helpers.buildRateLimitSecurityEventDetails(
  "bot",
  "chat_message",
  { limit: 3, windowMs: 1000 },
  { count: 4, resetInMs: 900, fallback: true },
  { type: "chat", action: "say", request_id: "chat-1", world: "test" },
  { world: "START" },
  "account:uso"
), {
  scope: "bot",
  bucket: "chat_message",
  message_type: "chat",
  action: "say",
  request_id: "chat-1",
  world: "TEST",
  limit: 3,
  window_ms: 1000,
  observed_count: 4,
  retry_ms: 900,
  redis_fallback: true,
  subject: "account:uso",
});
assert.equal(helpers.shouldRecordFailedTransactionLedgerAction("world_block_update"), true);
assert.equal(helpers.failedTransactionLedgerTypeForAction("world_item_drop_pickup"), "ITEM_PICKUP");
assert.equal(helpers.failedTransactionLedgerSourceForAction("world_item_drop_create"), "drop_inventory");

assert.equal(
  packageJson.scripts["build:server-message-router-helpers"],
  "tsc --project tsconfig.server-message-router-helpers.json && node scripts/sync_server_message_router_helpers_build.js"
);
assert.equal(
  packageJson.scripts["check:server-message-router-helpers"],
  "npm run build:server-message-router-helpers && node scripts/check_server_message_router_helpers_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-message-router-helpers/);
assert.deepEqual(buildConfig.include, ["src/server_message_router_helpers.ts"]);
assert.match(helperSource, /function createServerMessageRouterHelpers/);
assert.match(helperSource, /function makeMessageIdempotencyScope/);
assert.match(helperSource, /function getBotRateLimitAction/);
assert.match(generatedSource, /Generated from src\/server_message_router_helpers\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(syncSource, /server_message_router_helpers\.js/);
assert.match(serverSource, /require\("\.\/server_message_router_helpers"\)/);
assert.match(botRateLimitHelperSource, /messageRouterHelpers\.getMessageRateLimitDecision/);
assert.match(botRateLimitHelperSource, /messageRouterHelpers\.getBotRateLimitDecision/);
assert.match(serverSource, /ServerMessageRouterHelpers\.makeMessageIdempotencyScope/);
assert.match(deploySource, /server_message_router_helpers\.js/);
assert.match(deploySource, /src\/server_message_router_helpers\.ts/);
assert.match(deploySource, /tsconfig\.server-message-router-helpers\.json/);
assert.match(deploySource, /sync_server_message_router_helpers_build\.js/);
assert.match(deploySource, /check_server_message_router_helpers_build\.js/);
assert.match(deploySource, /npm run build:server-message-router-helpers/);

console.log("[server-message-router-helpers] success");
