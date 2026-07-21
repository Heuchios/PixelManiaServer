#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Phase9RemainingRoutesModule = require("../server_phase9_remaining_routes");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const dispatcherSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase7_dispatcher.ts"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase9_remaining_routes.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_phase9_remaining_routes.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_phase9_remaining_routes_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-phase9-remaining-routes.json"), "utf8"));

/** @type {string[]} */
const calls = [];
/** @type {unknown[]} */
const sent = [];
/** @type {unknown[]} */
const worldBroadcasts = [];
/** @type {unknown[]} */
const authBroadcasts = [];
/** @type {unknown[]} */
const rejected = [];
/** @type {unknown[]} */
const savedAccounts = [];

function record(/** @type {string} */ event) {
  calls.push(event);
}

const deps = {
  MAX_CHAT_LENGTH: 220,
  accountKey: (/** @type {unknown} */ value) => String(value || "").trim().toLowerCase(),
  broadcastToAuthenticatedPlayers: (/** @type {unknown} */ payload) => authBroadcasts.push(payload),
  broadcastToWorld: (/** @type {unknown} */ world, /** @type {unknown} */ payload) => worldBroadcasts.push({ world, payload }),
  cleanName: (/** @type {unknown} */ value) => String(value || "").trim(),
  cleanWorld: (/** @type {unknown} */ value) => String(value || "START").trim().toUpperCase(),
  getPlayerCurrentWorldName: () => "START",
  getServerPhase8PlayerSessionRoutes: () => ({
    handlePlayerStateRequest: () => record("player_state_request"),
    handlePlayerStateSave: () => record("player_state_save"),
    handleJoinWorld: () => record("join_world"),
    handleLeaveWorld: () => record("leave_world"),
  }),
  handleAccountEmailChangeRequest: () => record("account_email_change_request"),
  handleAccountLogin: () => record("account_login"),
  handleAccountPasswordResetRequest: () => record("account_password_reset_request"),
  handleAccountRegister: () => record("account_register"),
  handleAccountTokenLogin: () => record("account_token_login"),
  handleBatteryChargerRequest: () => record("battery_charger_request"),
  handleCustomTrustedPlayerState: () => record("custom_trusted_player_state"),
  handleCustomTrustedPlayerStateClear: () => record("custom_trusted_player_state_clear"),
  handleDevBackendLogin: () => record("dev_backend_login"),
  handleDeveloperCommandRequest: () => record("developer_command_request"),
  handleDeveloperPinUnlock: () => record("developer_pin_unlock"),
  handleDoorEnterRequest: () => record("door_enter"),
  handleFriendListRequest: () => record("friend_list_request"),
  handleFriendRequest: () => record("friend_request"),
  handleFriendResponse: () => record("friend_response"),
  handleInventoryTransactionRequest: () => record("inventory_transaction_request"),
  handleInventoryUpgradePurchase: () => record("inventory_upgrade_purchase"),
  handleNetfoxSpawnTicketRequest: () => record("netfox_spawn_ticket_request"),
  handleNetfoxTrustedPlayerState: () => record("netfox_trusted_player_state"),
  handleOilRefineryRequest: () => record("oil_refinery_request"),
  handleOwnedLockedWorldsRequest: () => record("owned_locked_worlds_request"),
  handlePlayerPunch: () => record("player_punch"),
  handlePullPlayerRequest: () => record("pull_player_request"),
  handleTradeCancel: () => record("trade_cancel"),
  handleTradeConfirm: () => record("trade_confirm"),
  handleTradeFinalConfirm: () => record("trade_final_confirm"),
  handleTradeOfferUpdate: () => record("trade_offer_update"),
  handleTradeRequest: () => record("trade_request"),
  handleTradeResponse: () => record("trade_response"),
  rejectIfMuted: async () => false,
  rejectIfTradeBanned: async (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {Record<string, unknown>} */ data) => data.trade_banned === true,
  requireAuthenticated: () => true,
  sanitizeAccountState: (/** @type {Record<string, unknown>} */ data) => data.username ? { username: data.username } : null,
  sendActionRejected: (/** @type {unknown} */ _socket, /** @type {unknown} */ action, /** @type {unknown} */ message, /** @type {unknown} */ extra) => rejected.push({ action, message, extra }),
  sendJson: (/** @type {unknown} */ _socket, /** @type {unknown} */ payload) => sent.push(payload),
  shouldBlockPlayerChatByAntiTalk: (/** @type {unknown} */ _player, /** @type {unknown} */ world) => world === "LOCKED",
  upsertAccount: (/** @type {unknown} */ account) => savedAccounts.push(account),
};

const routes = /** @type {any} */ (Phase9RemainingRoutesModule.createServerPhase9RemainingRoutes(deps));
const socket = {};
const player = {
  id: "p1",
  account_username: "uso",
  account_email: "uso@example.test",
  authenticated: true,
  name: "USO",
  world: "START",
};

(async () => {
  await routes.handleLogin(socket, player, { name: "New Name" }, { playerId: "p1" });
  assert.deepEqual(sent.pop(), {
    type: "login_ok",
    player_id: "p1",
    name: "New Name",
    username: "uso",
    email: "uso@example.test",
  });

  await routes.handleAccountStateSave(socket, player, { username: "USO" });
  assert.deepEqual(savedAccounts.pop(), { username: "USO" });
  await routes.handleAccountStateSave(socket, { ...player, authenticated: false }, { username: "uso" });
  assert.equal(savedAccounts.length, 0);

  await routes.handleTradeRequestRoute(socket, player, { trade_banned: true });
  assert.ok(!calls.includes("trade_request"));
  await routes.handleTradeRequestRoute(socket, player, {});
  assert.ok(calls.includes("trade_request"));

  await routes.handleChat(socket, player, { message: "/bc hello team" }, { playerId: "p1" });
  assert.deepEqual(authBroadcasts.pop(), {
    type: "broadcast",
    player_id: "p1",
    name: "New Name",
    message: "hello team",
    world: "START",
    current_world: "START",
  });

  await routes.handleChat(socket, { ...player, world: "locked" }, { message: "blocked" }, { playerId: "p1" });
  assert.deepEqual(rejected.pop(), {
    action: "chat",
    message: "Anti-talk is enabled in this world.",
    extra: { reason: "anti_talk_enabled", world: "LOCKED" },
  });

  await routes.handleBroadcast(socket, player, { message: "global" }, { playerId: "p1" });
  const lastBroadcast = /** @type {{ message?: unknown }} */ (authBroadcasts.pop());
  assert.equal(lastBroadcast.message, "global");

  await routes.handleJoinWorld(socket, player, {}, { playerId: "p1" });
  await routes.handlePlayerStateRequest(socket, player, {}, { playerId: "p1" });
  await routes.handleOilRefineryRequestRoute(socket, player, {});
  await routes.handleBatteryChargerRequestRoute(socket, player, {});
  await routes.handlePlayerPunchRoute(socket, player, {});
  assert.ok(calls.includes("join_world"));
  assert.ok(calls.includes("player_state_request"));
  assert.ok(calls.includes("oil_refinery_request"));
  assert.ok(calls.includes("battery_charger_request"));
  assert.ok(calls.includes("player_punch"));

  assert.match(helperSource, /function createServerPhase9RemainingRoutes/);
  assert.match(helperSource, /function handleLogin/);
  assert.match(helperSource, /function handleTradeFinalConfirmRoute/);
  assert.match(helperSource, /function handleChat/);
  assert.match(helperSource, /function handlePlayerPunchRoute/);
  assert.match(generatedSource, /Generated from src\/server_phase9_remaining_routes\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.deepEqual(buildConfig.include, ["src/server_phase9_remaining_routes.ts"]);
  assert.match(syncSource, /server_phase9_remaining_routes\.js/);
  assert.match(serverSource, /require\("\.\/server_phase9_remaining_routes"\)/);
  assert.match(serverSource, /createServerPhase9RemainingRoutes/);
  assert.match(serverSource, /handleTradeFinalConfirmRoute/);
  assert.match(serverSource, /handlePlayerPunchRoute/);
  assert.doesNotMatch(serverSource, /async function runLegacyPhase8Route/);
  assert.doesNotMatch(serverSource, /legacyRouteHandler: runLegacyPhase8Route/);
  assert.match(dispatcherSource, /const FALLBACK_ROUTE_TYPES = Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(dispatcherSource, /legacyRouteHandler/);
  assert.doesNotMatch(dispatcherSource, /legacy_handler/);
  assert.doesNotMatch(dispatcherSource, /phase8_legacy_routes/);
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-phase9-remaining-routes/);
  assert.match(deploySource, /server_phase9_remaining_routes\.js/);
  assert.match(deploySource, /src\/server_phase9_remaining_routes\.ts/);
  assert.match(deploySource, /tsconfig\.server-phase9-remaining-routes\.json/);
  assert.match(deploySource, /check_server_phase9_remaining_routes_build\.js/);
  assert.match(deploySource, /sync_server_phase9_remaining_routes_build\.js/);
  assert.match(deploySource, /npm run build:server-phase9-remaining-routes/);

  console.log("[server-phase9-remaining-routes] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
