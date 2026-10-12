"use strict";

const assert = require("node:assert/strict");
const { createServerSocketDeliveryHelpers } = require("../server_socket_delivery_helpers");

// Count work deterministically: timing assertions vary between developer PCs.
class ObservedMap extends Map {
  visited = 0;
  *entries() {
    for (const entry of super.entries()) {
      this.visited += 1;
      yield entry;
    }
  }
  [Symbol.iterator]() { return this.entries(); }
}

const stats = new Proxy({}, {
  get: (target, key) => target[key] || 0,
  set: (target, key, value) => { target[key] = value; return true; },
});
const helpers = createServerSocketDeliveryHelpers({
  websocketOpenState: 1, maxPacketBytes: 65536, maxBufferedAmount: 4096,
  movementMaxBufferedAmount: 256, movementResumeBufferedAmount: 64,
  movementRetryMs: 60000, playerNetworkStats: stats,
  getRawLength: raw => Buffer.byteLength(raw), normalizePacketTypeName: String,
  recordPacketTypeSize() {}, warn() {},
});
const socket = {
  readyState: 1, bufferedAmount: 512, sent: [],
  send(raw) {
    this.sent.push(JSON.parse(raw));
    if (this.sent.length === 2) this.bufferedAmount = 512;
  },
};
const players = Array.from({ length: 2000 }, (_, i) => ({ player_id: `p${i}`, x: i + 0.125 }));
const left = Array.from({ length: 131 }, (_, i) => ({ player_id: `left${i}`, reason: "out_of_interest" }));
helpers.sendPlayerPositionBatch(socket, { type: "player_position_batch", world: "TEST", players, left }, 17);
const pending = socket._movementDeliveryState;
pending.players = new ObservedMap(pending.players);
pending.left = new ObservedMap(pending.left);
// Constructor iteration happens before the fixture's counter is initialized.
socket.bufferedAmount = 0;
assert.equal(helpers.flushPendingPlayerPositionBatch(socket), false);
assert.equal(socket.sent.length, 2, "Stop draining as soon as backpressure returns");
assert.equal(pending.players.size, 1966);
assert.equal(pending.left.visited, 0, "Full player packets must not traverse waiting departures");
socket.bufferedAmount = 0;
assert.equal(helpers.flushPendingPlayerPositionBatch(socket), true);
assert.equal(socket._movementDeliveryState, undefined);
assert.deepEqual(socket.sent.flatMap(packet => packet.players || []), players);
assert.deepEqual(socket.sent.flatMap(packet => packet.left || []), left);
assert(socket.sent.every(packet => (packet.players?.length || 0) + (packet.left?.length || 0) <= 17));
const visits = pending.players.visited + pending.left.visited;
assert(visits <= players.length + left.length + socket.sent.length * 2,
  "Recovery work must grow linearly with queued entries, not entries times packets");
console.log("MOVEMENT_QUEUE_DRAIN_OK", JSON.stringify({ entries: players.length + left.length, packets: socket.sent.length, entries_visited: visits }));
