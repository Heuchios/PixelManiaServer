#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TradeRoutesModule = require("../server_trade_routes");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_trade_routes.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_trade_routes.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_trade_routes_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-trade-routes.json"), "utf8"));

/** @type {Map<string, Record<string, any>>} */
const activeTrades = new Map();
/** @type {Map<string, string>} */
const tradeByPlayerId = new Map();
/** @type {Map<string, { socket: Record<string, any>, player: Record<string, any> }>} */
const playersById = new Map();
/** @type {Map<string, { socket: Record<string, any>, player: Record<string, any> }>} */
const playersByAccount = new Map();
/** @type {{ socket: unknown, payload: Record<string, any> }[]} */
const messages = [];
let tradeSequence = 0;
let executedTradeCount = 0;

const aliceSocket = { socket_id: "alice-socket" };
const bobSocket = { socket_id: "bob-socket" };
const alicePlayer = { authenticated: true, account_username: "Alice", id: "p-alice", world: "START", x: 10, y: 10 };
const bobPlayer = { authenticated: true, account_username: "Bob", id: "p-bob", world: "START", x: 20, y: 20 };

playersById.set(alicePlayer.id, { socket: aliceSocket, player: alicePlayer });
playersById.set(bobPlayer.id, { socket: bobSocket, player: bobPlayer });
playersByAccount.set("alice", { socket: aliceSocket, player: alicePlayer });
playersByAccount.set("bob", { socket: bobSocket, player: bobPlayer });

const playerStates = new Map([
  ["alice", { inventory: { apple: 5 } }],
  ["bob", { inventory: {} }],
]);

const ItemDatabase = {
  hasItem: (/** @type {unknown} */ itemId) => ["apple", "gem"].includes(String(itemId || "")),
  isTradeableItem: (/** @type {unknown} */ itemId) => String(itemId || "") !== "gem",
  canStoreItemInCategory: (/** @type {unknown} */ itemId, /** @type {unknown} */ category) => String(itemId || "") !== "" && String(category || "") !== "",
  getStackLimit: () => 200,
};

function accountKey(/** @type {unknown} */ value) {
  return String(value || "").trim().toLowerCase();
}

function cleanAccountName(/** @type {unknown} */ value) {
  return String(value || "").trim();
}

function clampInteger(/** @type {unknown} */ value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function clampString(/** @type {unknown} */ value) {
  return String(value || "").trim();
}

function makeTradeSlots() {
  return Array.from({ length: 4 }, () => null);
}

function getTradePartyIds(/** @type {Record<string, any>} */ trade) {
  return [trade.requester_id, trade.target_id];
}

function getTradeParticipantRecord(/** @type {unknown} */ playerId) {
  return playersById.get(String(playerId || "")) || null;
}

function isTradeParticipant(/** @type {Record<string, any>} */ trade, /** @type {unknown} */ playerId) {
  return Boolean(trade && (trade.requester_id === playerId || trade.target_id === playerId));
}

function sendJson(/** @type {unknown} */ socket, /** @type {unknown} */ payload) {
  assert.ok(payload && typeof payload === "object");
  messages.push({ socket, payload: /** @type {Record<string, any>} */ (payload) });
}

function sendTradeError(/** @type {unknown} */ socket, /** @type {Record<string, any>} */ data, /** @type {string} */ message) {
  sendJson(socket, {
    type: "trade_error",
    trade_id: String(data.trade_id || ""),
    message,
  });
}

function sendTradeChat(/** @type {unknown} */ playerId, /** @type {string} */ message) {
  const record = getTradeParticipantRecord(playerId);
  if (!record) return;
  sendJson(record.socket, {
    type: "chat",
    player_id: "system",
    name: "System",
    message,
    world: record.player.world,
  });
}

function sendTradeState(/** @type {Record<string, any>} */ trade, /** @type {string} */ message = "") {
  for (const playerId of getTradePartyIds(trade)) {
    const record = getTradeParticipantRecord(playerId);
    if (!record) continue;
    sendJson(record.socket, {
      type: "trade_state",
      trade_id: trade.id,
      status: trade.status,
      message,
    });
  }
}

function cancelTrade(/** @type {Record<string, any>} */ trade, /** @type {string} */ message = "Trade canceled.") {
  for (const playerId of getTradePartyIds(trade)) {
    const record = getTradeParticipantRecord(playerId);
    if (record) {
      sendJson(record.socket, {
        type: "trade_canceled",
        trade_id: trade.id,
        message,
      });
    }
  }
  activeTrades.delete(trade.id);
  tradeByPlayerId.delete(trade.requester_id);
  tradeByPlayerId.delete(trade.target_id);
}

function clearTrade(/** @type {Record<string, any>} */ trade) {
  activeTrades.delete(trade.id);
  tradeByPlayerId.delete(trade.requester_id);
  tradeByPlayerId.delete(trade.target_id);
}

function lastPayload() {
  const record = messages.at(-1);
  assert.ok(record);
  return record.payload;
}

const deps = {
  ItemDatabase,
  MAX_ITEM_STACK: 999,
  PUNISHMENT_SCOPE_GLOBAL: "global",
  TRADE_SLOT_COUNT: 4,
  accountKey,
  activeTrades,
  arePlayersCloseEnoughForTrade: () => true,
  cancelTrade,
  cleanAccountName,
  clampInteger,
  clampString,
  cryptoRandomUUID: () => `trade-${++tradeSequence}`,
  ensureWritablePlayerState: (/** @type {unknown} */ username) => playerStates.get(accountKey(username)) || null,
  executeTrade: async (/** @type {Record<string, any>} */ trade) => {
    executedTradeCount += 1;
    clearTrade(trade);
  },
  findOnlinePlayerByPlayerId: (/** @type {unknown} */ playerId) => playersById.get(String(playerId || "")) || null,
  findOnlinePlayerByUsername: (/** @type {unknown} */ username) => playersByAccount.get(accountKey(username)) || null,
  formatPunishmentBlockMessage: () => "Trade blocked.",
  getBlockingPunishment: async () => null,
  getInventoryCount: (/** @type {Record<string, any>} */ state, /** @type {unknown} */ itemId, /** @type {unknown} */ category) => {
    return Number(state[String(category || "")]?.[String(itemId || "")] || state.inventory?.[String(itemId || "")] || 0);
  },
  getTradeParticipantRecord,
  getTradePartyIds,
  isTradeParticipant,
  logSecurityEvent: () => {},
  makeTradeSlots,
  requireAuthenticated: (/** @type {unknown} */ _socket, /** @type {Record<string, any>} */ player) => Boolean(player.authenticated),
  resolveInventoryCategory: (/** @type {unknown} */ _itemId, /** @type {unknown} */ category) => String(category || "inventory"),
  sendJson,
  sendPunishmentNotice: () => {},
  sendTradeChat,
  sendTradeError,
  sendTradeState,
  tradeByPlayerId,
};

const routes = TradeRoutesModule.createServerTradeRoutes(deps);

assert.equal(typeof routes.handleTradeRequest, "function");
assert.equal(typeof routes.handleTradeResponse, "function");
assert.equal(typeof routes.handleTradeOfferUpdate, "function");
assert.equal(typeof routes.handleTradeFinalConfirm, "function");

(async () => {
  await routes.handleTradeRequest(aliceSocket, alicePlayer, { target_username: "Bob" });
  assert.equal(activeTrades.size, 1);
  assert.equal(tradeByPlayerId.get(alicePlayer.id), "trade-1");
  assert.equal(tradeByPlayerId.get(bobPlayer.id), "trade-1");
  assert.equal(messages.some((entry) => entry.socket === bobSocket && entry.payload.type === "trade_request_received"), true);

  const trade = activeTrades.get("trade-1");
  assert.ok(trade);
  routes.handleTradeResponse(bobSocket, bobPlayer, { trade_id: trade.id, accepted: true });
  assert.equal(trade.status, "active");
  assert.equal(lastPayload().type, "trade_state");

  routes.handleTradeOfferUpdate(aliceSocket, alicePlayer, {
    trade_id: trade.id,
    slot_index: 0,
    item_id: "apple",
    item_category: "inventory",
    amount: 2,
  });
  assert.equal(trade.offers[alicePlayer.id][0].item_id, "apple");
  assert.equal(trade.offers[alicePlayer.id][0].amount, 2);

  routes.handleTradeConfirm(aliceSocket, alicePlayer, { trade_id: trade.id });
  assert.equal(trade.status, "active");
  routes.handleTradeConfirm(bobSocket, bobPlayer, { trade_id: trade.id });
  assert.equal(trade.status, "final_pending");

  await routes.handleTradeFinalConfirm(aliceSocket, alicePlayer, { trade_id: trade.id });
  assert.equal(executedTradeCount, 0);
  await routes.handleTradeFinalConfirm(bobSocket, bobPlayer, { trade_id: trade.id });
  assert.equal(executedTradeCount, 1);
  assert.equal(activeTrades.size, 0);
  assert.equal(tradeByPlayerId.size, 0);

  await routes.handleTradeRequest(aliceSocket, alicePlayer, { target_username: "Bob" });
  assert.equal(activeTrades.size, 1);
  routes.handleTradeCancel(aliceSocket, alicePlayer, {});
  assert.equal(activeTrades.size, 0);
  assert.equal(lastPayload().type, "trade_canceled");

  routes.handleTradeRequest(aliceSocket, alicePlayer, { target_username: "Alice" });
  assert.equal(lastPayload().type, "trade_error");
  assert.equal(lastPayload().message, "You cannot trade with yourself.");

  assert.equal(
    packageJson.scripts["build:server-trade-routes"],
    "tsc --project tsconfig.server-trade-routes.json && node scripts/sync_server_trade_routes_build.js"
  );
  assert.equal(
    packageJson.scripts["check:server-trade-routes"],
    "npm run build:server-trade-routes && node scripts/check_server_trade_routes_build.js"
  );
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-trade-routes/);
  assert.deepEqual(buildConfig.include, ["src/server_trade_routes.ts"]);
  assert.match(helperSource, /function createServerTradeRoutes/);
  assert.match(helperSource, /handleTradeFinalConfirm/);
  assert.match(helperSource, /await executeTrade\(trade\)/);
  assert.match(generatedSource, /Generated from src\/server_trade_routes\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.match(syncSource, /server_trade_routes\.js/);
  assert.match(serverSource, /require\("\.\/server_trade_routes"\)/);
  assert.match(serverSource, /createServerTradeRoutes/);
  assert.match(serverSource, /getServerTradeRoutes\(\)\.handleTradeRequest/);
  assert.match(serverSource, /getServerTradeRoutes\(\)\.handleTradeFinalConfirm/);
  assert.match(deploySource, /server_trade_routes\.js/);
  assert.match(deploySource, /src\/server_trade_routes\.ts/);
  assert.match(deploySource, /tsconfig\.server-trade-routes\.json/);
  assert.match(deploySource, /check_server_trade_routes_build\.js/);
  assert.match(deploySource, /sync_server_trade_routes_build\.js/);
  assert.match(deploySource, /npm run build:server-trade-routes/);

  console.log("[server-trade-routes] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
