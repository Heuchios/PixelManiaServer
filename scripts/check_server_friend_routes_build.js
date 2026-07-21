#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FriendRoutesModule = require("../server_friend_routes");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_friend_routes.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_friend_routes.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_friend_routes_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-friend-routes.json"), "utf8"));

/** @type {Map<string, Record<string, any>>} */
const accounts = new Map([
  ["alice", { username: "Alice", friends: [], friend_requests_in: ["Carol"], friend_requests_out: [], last_seen_at: "2026-07-18T00:00:00.000Z" }],
  ["bob", { username: "Bob", friends: [], friend_requests_in: [], friend_requests_out: [], last_seen_at: "2026-07-18T00:01:00.000Z" }],
  ["carol", { username: "Carol", friends: [], friend_requests_in: [], friend_requests_out: ["Alice"], last_seen_at: "2026-07-18T00:02:00.000Z" }],
]);
/** @type {Map<string, { socket: Record<string, any>, player: Record<string, any> }>} */
const onlinePlayers = new Map();
/** @type {{ socket: unknown, payload: Record<string, any> }[]} */
const messages = [];
let accountSaveCount = 0;

function accountKey(/** @type {unknown} */ value) {
  return String(value || "").trim().toLowerCase();
}

function cleanAccountName(/** @type {unknown} */ value) {
  return String(value || "").trim();
}

function makeRequestId(/** @type {Record<string, any>} */ data) {
  return String(data.request_id || "req-test");
}

function sendJson(/** @type {unknown} */ socket, /** @type {unknown} */ payload) {
  assert.ok(payload && typeof payload === "object");
  messages.push({ socket, payload: /** @type {Record<string, any>} */ (payload) });
}

function lastPayload() {
  const record = messages.at(-1);
  assert.ok(record);
  return record.payload;
}

const aliceSocket = { socket_id: "alice-socket" };
const bobSocket = { socket_id: "bob-socket" };
const alicePlayer = { authenticated: true, account_username: "Alice", id: "p-alice", world: "START" };
const bobPlayer = { authenticated: true, account_username: "Bob", id: "p-bob", world: "START" };
onlinePlayers.set("alice", { socket: aliceSocket, player: alicePlayer });
onlinePlayers.set("bob", { socket: bobSocket, player: bobPlayer });

const deps = {
  accountKey,
  accounts,
  cleanAccountName,
  findOnlinePlayerByUsername: (/** @type {unknown} */ username) => onlinePlayers.get(accountKey(username)) || null,
  makeRequestId,
  queueAccountsSave: () => { accountSaveCount += 1; },
  requireAuthenticated: (/** @type {unknown} */ _socket, /** @type {Record<string, any>} */ player) => Boolean(player.authenticated),
  sendJson,
};

const routes = FriendRoutesModule.createServerFriendRoutes(deps);

assert.equal(typeof routes.handleFriendListRequest, "function");
assert.equal(typeof routes.handleFriendRequest, "function");
assert.equal(typeof routes.handleFriendResponse, "function");
assert.deepEqual(routes.sanitizeAccountNameArray(["Alice", " alice ", "", "Bob"], 10), ["Alice", "Bob"]);

routes.handleFriendListRequest(aliceSocket, alicePlayer, { request_id: "list-1" });
assert.equal(lastPayload().type, "friend_state");
assert.equal(lastPayload().ok, true);
assert.equal(lastPayload().pending_incoming[0].username, "Carol");

routes.handleFriendRequest(aliceSocket, alicePlayer, { target_username: "Bob", request_id: "friend-1" });
assert.equal(routes.getFriendStatus("Alice", "Bob"), "outgoing");
assert.equal(routes.getFriendStatus("Bob", "Alice"), "incoming");
assert.equal(accountSaveCount, 1);
assert.equal(lastPayload().type, "friend_state");

routes.handleFriendResponse(bobSocket, bobPlayer, { from_username: "Alice", accepted: true, request_id: "friend-accept" });
assert.equal(routes.getFriendStatus("Alice", "Bob"), "friends");
assert.equal(routes.getFriendStatus("Bob", "Alice"), "friends");
assert.equal(accountSaveCount, 2);
assert.equal(messages.some((entry) => entry.socket === aliceSocket && entry.payload.type === "friend_request_accepted"), true);

routes.handleFriendRequest(aliceSocket, alicePlayer, { target_username: "Alice", request_id: "self" });
assert.equal(lastPayload().type, "friend_error");
assert.equal(lastPayload().message, "You cannot add yourself.");

messages.length = 0;
routes.notifyOnlineFriendsOfFriendState("Alice");
assert.equal(messages.some((entry) => entry.socket === bobSocket && entry.payload.type === "friend_state"), true);

assert.equal(
  packageJson.scripts["build:server-friend-routes"],
  "tsc --project tsconfig.server-friend-routes.json && node scripts/sync_server_friend_routes_build.js"
);
assert.equal(
  packageJson.scripts["check:server-friend-routes"],
  "npm run build:server-friend-routes && node scripts/check_server_friend_routes_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-friend-routes/);
assert.deepEqual(buildConfig.include, ["src/server_friend_routes.ts"]);
assert.match(helperSource, /function createServerFriendRoutes/);
assert.match(helperSource, /handleFriendResponse/);
assert.match(generatedSource, /Generated from src\/server_friend_routes\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(syncSource, /server_friend_routes\.js/);
assert.match(serverSource, /require\("\.\/server_friend_routes"\)/);
assert.match(serverSource, /createServerFriendRoutes/);
assert.match(serverSource, /getServerFriendRoutes\(\)\.handleFriendRequest/);
assert.match(serverSource, /getServerFriendRoutes\(\)\.getFriendStatus/);
assert.match(deploySource, /server_friend_routes\.js/);
assert.match(deploySource, /src\/server_friend_routes\.ts/);
assert.match(deploySource, /tsconfig\.server-friend-routes\.json/);
assert.match(deploySource, /check_server_friend_routes_build\.js/);
assert.match(deploySource, /sync_server_friend_routes_build\.js/);
assert.match(deploySource, /npm run build:server-friend-routes/);

console.log("[server-friend-routes] success");
