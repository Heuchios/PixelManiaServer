"use strict";
const assert = require("node:assert/strict");
const { createServerPhase9RemainingRoutes } = require("../server_phase9_remaining_routes");
const { createServerPhase7Dispatcher } = require("../server_phase7_dispatcher");
const messages = [];
const routes = createServerPhase9RemainingRoutes({
  requireAuthenticated: (_socket, player) => player.authenticated === true,
  cleanWorld: value => String(value || "").trim().toUpperCase(),
  broadcastToWorld: (world, packet) => messages.push({ world, packet }),
});
const dispatcher = createServerPhase7Dispatcher({
  packetContracts: {
    isWorldDropCreatePacket: () => false,
    isWorldDropUpdateRequestPacket: () => false,
    isWorldDropPickupRequestPacket: () => false,
  },
  handlers: { player_emote: routes.handlePlayerEmote },
  applyActionPositionFromPayload: () => assert.fail("Emotes must not change player position"),
  getPlayerCurrentWorldName: player => player.world,
});
const freshPlayer = () => ({ id: "real-id", name: "Real Name", authenticated: true, joined_world: true, world: "START" });
const packet = { type: "player_emote", world: "START", emote: "wave", player_id: "spoof-id", name: "Spoof", x: 999, duration: 999 };
async function dispatch(player, overrides = {}) { return dispatcher.dispatch({}, player, { ...packet, ...overrides }); }
(async () => {
  const player = freshPlayer();
  const result = await dispatch(player);
  assert.equal(result.handled, true);
  assert.equal(result.used_action_position, false);
  assert.deepEqual(messages.pop(), { world: "START", packet: { type: "player_emote", player_id: "real-id", name: "Real Name", world: "START", emote: "wave", sequence: 1 } });
  await dispatch(player, { emote: "laugh" });
  assert.equal(messages.length, 0, "rapid repeats are dropped");
  player.last_emote_at = Date.now() - 1001;
  await dispatch(player, { emote: "sad" });
  assert.equal(messages.pop().packet.sequence, 2);
  for (const emote of ["laugh", "sad", "wave"]) {
    await dispatch(freshPlayer(), { emote });
    assert.equal(messages.pop().packet.emote, emote);
  }
  for (const overrides of [{ emote: "hack" }, { emote: "__proto__" }, { emote: null }, { world: "OTHER" }, { world: null }]) await dispatch(freshPlayer(), overrides);
  await dispatch({ ...freshPlayer(), authenticated: false });
  await dispatch({ ...freshPlayer(), joined_world: false });
  await dispatch({ ...freshPlayer(), world: "" });
  assert.equal(messages.length, 0, "invalid/non-member/unauthenticated emotes never broadcast");
  console.log("[player-emotes] PASS: routing, membership, cooldown, all three gestures, server identity and no position writes");
})().catch(error => { console.error(error); process.exitCode = 1; });
