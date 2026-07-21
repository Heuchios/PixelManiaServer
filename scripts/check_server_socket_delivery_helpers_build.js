#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SocketDeliveryHelpersModule = require("../server_socket_delivery_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_socket_delivery_helpers.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_socket_delivery_helpers.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_socket_delivery_helpers_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-socket-delivery-helpers.json"), "utf8"));

const OPEN = 1;
const stats = {
  outbound_packets_attempted: 0,
  outbound_bytes_sent: 0,
  outbound_oversize_packets: 0,
  outbound_backpressure_skips: 0,
  outbound_send_failures: 0,
};
/** @type {{ direction: "outbound", rawMessageType: string, rawBytes: number }[]} */
const packetStats = [];
/** @type {{ label: string, payload: any }[]} */
const warnings = [];

/** @type {any} */
const helpers = SocketDeliveryHelpersModule.createServerSocketDeliveryHelpers({
  websocketOpenState: OPEN,
  maxPacketBytes: 64,
  maxBufferedAmount: 32,
  playerNetworkStats: stats,
  getRawLength(/** @type {unknown} */ raw) {
    return Buffer.byteLength(String(raw || ""), "utf8");
  },
  normalizePacketTypeName(/** @type {unknown} */ value) {
    return String(value || "unknown").trim().toLowerCase() || "unknown";
  },
  recordPacketTypeSize(/** @type {"outbound"} */ direction, /** @type {string} */ rawMessageType, /** @type {number} */ rawBytes) {
    packetStats.push({ direction, rawMessageType, rawBytes });
  },
  warn(/** @type {string} */ label, /** @type {unknown} */ payload) {
    warnings.push({ label, payload });
  },
});

/** @returns {any} */
function makeSocket(/** @type {Partial<any>} */ overrides = {}) {
  return {
    readyState: OPEN,
    bufferedAmount: 0,
    playerId: "p1",
    sent: /** @type {string[]} */ ([]),
    send(/** @type {string} */ raw) {
      this.sent.push(raw);
    },
    ...overrides,
  };
}

/** @returns {{ label: string, payload: any }} */
function lastWarning() {
  const value = warnings.at(-1);
  assert.ok(value);
  return value;
}

const socket = makeSocket();
helpers.sendJson(socket, { type: "hello", ok: true });
assert.equal(socket.sent.length, 1);
assert.equal(JSON.parse(socket.sent[0]).type, "hello");
assert.equal(stats.outbound_packets_attempted, 1);
assert.equal(stats.outbound_bytes_sent, Buffer.byteLength(socket.sent[0], "utf8"));
assert.deepEqual(packetStats[0], {
  direction: "outbound",
  rawMessageType: "hello",
  rawBytes: Buffer.byteLength(socket.sent[0], "utf8"),
});

const closedSocket = makeSocket({ readyState: 3 });
helpers.sendJson(closedSocket, { type: "closed" });
assert.equal(closedSocket.sent.length, 0);

const circular = {};
circular.self = circular;
helpers.sendJson(socket, circular);
assert.equal(lastWarning().label, "[socket_serialize_error]");

const oversizedSocket = makeSocket();
assert.equal(helpers.sendRawJsonToSocket(oversizedSocket, "x".repeat(80), "bulk", { message_type: "Batch" }), true);
assert.equal(oversizedSocket.sent.length, 1);
assert.equal(stats.outbound_oversize_packets, 1);
assert.equal(lastWarning().label, "[socket_oversize_send]");
assert.equal(lastWarning().payload.max_packet_bytes, 64);

const bufferedSocket = makeSocket({ bufferedAmount: 64 });
assert.equal(helpers.sendRawJsonToSocket(bufferedSocket, "small", "world_broadcast", { message_type: "world_update" }), false);
assert.equal(bufferedSocket.sent.length, 0);
assert.equal(stats.outbound_backpressure_skips, 1);
assert.equal(lastWarning().label, "[socket_backpressure_skip]");

const failingSocket = makeSocket({
  send() {
    throw new Error("boom");
  },
});
assert.equal(helpers.sendRawJsonToSocket(failingSocket, "small", "direct_send", { message_type: "chat" }), false);
assert.equal(stats.outbound_send_failures, 1);
assert.equal(lastWarning().label, "[socket_send_error]");
assert.match(String(lastWarning().payload.message), /boom/);

assert.equal(helpers.getSocketBufferedAmount({ bufferedAmount: "44" }), 44);
assert.equal(helpers.getSocketBufferedAmount({ bufferedAmount: Number.NaN }), 0);

const warningSocket = makeSocket();
assert.equal(helpers.shouldLogSocketPacketWarning(warningSocket, "same", 10000), true);
assert.equal(helpers.shouldLogSocketPacketWarning(warningSocket, "same", 10000), false);
assert.equal(helpers.shouldLogSocketBackpressure(warningSocket), true);
assert.equal(helpers.shouldLogSocketBackpressure(warningSocket), false);

assert.equal(
  packageJson.scripts["build:server-socket-delivery-helpers"],
  "tsc --project tsconfig.server-socket-delivery-helpers.json && node scripts/sync_server_socket_delivery_helpers_build.js"
);
assert.equal(
  packageJson.scripts["check:server-socket-delivery-helpers"],
  "npm run build:server-socket-delivery-helpers && node scripts/check_server_socket_delivery_helpers_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-socket-delivery-helpers/);
assert.deepEqual(buildConfig.include, ["src/server_socket_delivery_helpers.ts"]);
assert.match(helperSource, /function createServerSocketDeliveryHelpers/);
assert.match(helperSource, /function sendRawJsonToSocket/);
assert.match(generatedSource, /Generated from src\/server_socket_delivery_helpers\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(syncSource, /server_socket_delivery_helpers\.js/);
assert.match(serverSource, /require\("\.\/server_socket_delivery_helpers"\)/);
assert.match(serverSource, /ServerSocketDeliveryHelpers\.sendJson/);
assert.match(serverSource, /ServerSocketDeliveryHelpers\.sendRawJsonToSocket/);
assert.match(deploySource, /server_socket_delivery_helpers\.js/);
assert.match(deploySource, /src\/server_socket_delivery_helpers\.ts/);
assert.match(deploySource, /tsconfig\.server-socket-delivery-helpers\.json/);
assert.match(deploySource, /sync_server_socket_delivery_helpers_build\.js/);
assert.match(deploySource, /check_server_socket_delivery_helpers_build\.js/);
assert.match(deploySource, /npm run build:server-socket-delivery-helpers/);

console.log("[server-socket-delivery-helpers] success");
