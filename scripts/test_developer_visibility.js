"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
const records = [];
const deliveries = [];
const audits = [];
const approvals = [];
const denials = [];
const interest = new Set();
let interestEnabled = true;
let securityAllowed = true;
const context = {
  console, Map, Set, Date, WebSocket: { OPEN: 1 },
  ServerSocketDeliveryHelpers: require("../server_socket_delivery_helpers").createServerSocketDeliveryHelpers({ playerNetworkStats: { movement_backpressure_dropped_items: 0 } }),
  pendingPlayerPositionBroadcasts: new Map(),
  playerNetworkStats: {}, PLAYER_ACTION_INTEREST_MANAGEMENT_ENABLED: true,
  PLAYER_INTEREST_RADIUS_PIXELS: 1000, PLAYER_INTEREST_LEAVE_RADIUS_PIXELS: 1200,
  cleanWorld: value => String(value || "START").trim().toUpperCase(),
  getWorldPlayerRecords: (world, options = {}) => records.filter(row => row.player.joined_world && row.player.world === world && row.player.id !== options.excludePlayerId),
  getSocketByPlayerId: id => records.find(row => row.player.id === id)?.socket,
  isPlayerInterestManagementEnabled: () => interestEnabled,
  isPlayerMarkedInInterest: (receiver, subject) => interest.has(`${receiver}:${subject}`),
  setPlayerInterestVisible: (receiver, subject, visible) => {
    const key = `${receiver}:${subject}`;
    if (visible) interest.add(key); else interest.delete(key);
  },
  buildPublicPlayerPresencePayload: (type, player, world) => ({ type, player_id: player.id, world, x: player.x, y: player.y }),
  sendRawPresenceToSocket: (socket, raw) => deliveries.push({ to: socket.playerId, ...JSON.parse(raw) }),
  deliverPlayerPresencePayload: (socket, payload) => deliveries.push({ to: socket.playerId, ...payload }),
  sendRawJsonToSocket: (socket, raw) => deliveries.push({ to: socket.playerId, ...JSON.parse(raw) }),
  serializeBroadcastPayloadOnce: payload => JSON.stringify(payload),
  getPendingWorldEntryPlayerRecords: () => [],
  requireAuthenticated: (_socket, player) => player.authenticated,
  makeRequestId: data => data.request_id || "visibility-test",
  getDeveloperCommandName: command => command.replace(/^\//, "").split(/\s+/)[0].toLowerCase(),
  canUseAdminCommands: player => ["developer", "admin", "designer"].includes(player.role),
  isAdmin: player => player.authenticated && ["developer", "admin"].includes(player.role),
  getDeveloperSecurityRequirement: () => ({ ok: securityAllowed, message: "Unlock your developer PIN.", reason: "pin_locked", extra: {} }),
  validateAdminCommandConfirmation: () => true,
  consumeAdminCommandCooldown: () => ({ ok: true }),
  logAdminAction: (_socket, _player, action, details, success) => audits.push({ action, details, success }),
  logSecurityEvent: () => {},
  sendDeveloperApproved: (_socket, _id, command, message, extra) => approvals.push({ command, message, ...extra }),
  sendDeveloperDenied: (_socket, _id, command, message) => denials.push({ command, message }),
  splitCommand: command => command.split(/\s+/),
  refreshPlayerFishingPresence: () => {}, getPublicPlayerIdentity: p => ({ name: p.account_username }),
  getPublicPlayerDamageFlash: () => ({}), isGridInWorld: () => true,
  clampInteger: (v, min, max) => Math.max(min, Math.min(max, Math.trunc(Number(v) || 0))),
  clampString: v => String(v || ""), sanitizePlayerVelocity: v => Number(v || 0),
};
for (const name of ["parsePunishmentCommand", "parseItemInstanceAdminCommand", "parseGiveCommand", "parseRemoveCommand", "parseTakeWorldCommand", "parseGiveWorldCommand"]) context[name] = () => null;
vm.createContext(context);
for (const name of ["handleDeveloperCommandRequestUnsafe", "getSquaredPlayerDistance", "shouldReceiverSeeSubject", "buildInterestCullPayload", "broadcastPlayerPresenceToInterestedPlayers", "queuePlayerPresenceToInterestedPlayers", "syncPlayerInterestForReceiver", "publishPlayerPresenceUpdate", "broadcastPlayerActionToInterestedPlayers", "getPlayersInWorld", "broadcastToWorld"]) {
  const head = source.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
  const start = source.indexOf(head), end = source.indexOf("\n}", start) + 2;
  assert.ok(start >= 0 && end > start, `Real generated function exists: ${name}`);
  vm.runInContext(source.slice(start, end), context);
}
function addPlayer(id, role = "player") {
  const player = { id, role, account_username: id, authenticated: true, joined_world: true, world: "START", x: 64, y: 64, invisible_enabled: false, noclip_enabled: false };
  const socket = { playerId: id, readyState: 1 };
  records.push({ playerId: id, player, socket });
  return player;
}
const developer = addPlayer("developer", "developer");
const observer = addPlayer("observer");
const designer = addPlayer("designer", "designer");
function snapshotFor(player) { return context.buildPublicPlayerPresencePayload("player_position", player, player.world); }
async function command(player, name, extra = {}) {
  await context.handleDeveloperCommandRequestUnsafe(context.getSocketByPlayerId(player.id), player, { command: name, ...extra });
}
function assertNoAvatarForOthers() {
  assert.ok(!deliveries.some(packet => packet.player_id === developer.id && packet.to !== developer.id && packet.type !== "player_left"), "Hidden avatar never reaches another client");
}
(async () => {
  for (const rolePlayer of [observer, designer]) {
    for (const name of ["/inv", "/vis"]) {
      const previous = denials.length;
      await command(rolePlayer, name);
      assert.equal(denials.length, previous + 1);
      assert.equal(rolePlayer.invisible_enabled, false);
      assert.equal(audits.at(-1).success, false, "Denied attempts are audited");
    }
  }
  securityAllowed = false;
  await command(developer, "/inv");
  assert.equal(developer.invisible_enabled, false, "Locked developer PIN cannot hide");
  securityAllowed = true;
  for (const enabled of [true, false]) {
    interestEnabled = enabled;
    context.PLAYER_ACTION_INTEREST_MANAGEMENT_ENABLED = enabled;
    context.publishPlayerPresenceUpdate(context.getSocketByPlayerId(developer.id), developer, "START", "player_position", developer.id);
    assert.ok(deliveries.some(packet => packet.to === observer.id && packet.player_id === developer.id));
    deliveries.length = 0;
    developer.noclip_enabled = true;
    context.pendingPlayerPositionBroadcasts.set("START", new Map([[developer.id, { message: "stale" }]]));
    const observerSocket = context.getSocketByPlayerId(observer.id);
    observerSocket._movementDeliveryState = { world: "START", players: new Map([[developer.id, snapshotFor(developer)], [designer.id, snapshotFor(designer)]]), left: new Map() };
    await command(developer, "/inv", { enabled: false, invisible_enabled: false });
    assert.equal(observerSocket._movementDeliveryState.players.has(developer.id), false, "Backpressure cannot resurrect hidden avatar");
    assert.equal(observerSocket._movementDeliveryState.players.has(designer.id), true, "Other players' pending movement is preserved");
    assert.equal(developer.invisible_enabled, true, "Command determines visibility, never client metadata");
    assert.equal(developer.noclip_enabled, true, "Visibility is independent of noclip");
    assert.equal(context.pendingPlayerPositionBroadcasts.get("START").has(developer.id), false);
    assert.ok(deliveries.some(packet => packet.to === observer.id && packet.type === "player_left" && packet.reason === "developer_invisible" && packet.interest_cull));
    assert.ok(!deliveries.some(packet => packet.to === developer.id), "Developer never receives their own hide packet");
    assert.equal(approvals.at(-1).invisible_enabled, true);
    await command(developer, "/inv");
    assert.equal(developer.invisible_enabled, true, "Repeated /inv remains invisible");
    deliveries.length = 0;
    const snapshot = context.buildPublicPlayerPresencePayload("player_position", developer, "START");
    context.broadcastPlayerPresenceToInterestedPlayers(developer, snapshot, developer.id);
    context.queuePlayerPresenceToInterestedPlayers(developer, snapshot, developer.id, new Map(), records);
    context.syncPlayerInterestForReceiver(context.getSocketByPlayerId(observer.id), observer, "START");
    context.broadcastPlayerActionToInterestedPlayers("START", { type: "player_punch", player_id: developer.id }, [developer]);
    assertNoAvatarForOthers();
    for (const receiver of [observer, addPlayer(`late-${enabled}`)]) {
      assert.ok(!context.getPlayersInWorld("START", receiver.id, receiver).some(p => p.player_id === developer.id), "Existing and late join snapshots omit hidden players");
    }
    developer.world = observer.world = "OTHER";
    deliveries.length = 0;
    context.publishPlayerPresenceUpdate(context.getSocketByPlayerId(developer.id), developer, "OTHER", "player_joined", developer.id);
    assertNoAvatarForOthers();
    assert.ok(!context.getPlayersInWorld("OTHER", observer.id, observer).some(p => p.player_id === developer.id), "Invisibility survives a world change on the same session");
    developer.x = 350;
    observerSocket._movementDeliveryState = { world: "OTHER", players: new Map(), left: new Map([[developer.id, { type: "player_left", player_id: developer.id }]]) };
    await command(developer, "/vis");
    assert.equal(observerSocket._movementDeliveryState, undefined, "An old queued cull cannot hide a restored avatar");
    assert.equal(developer.invisible_enabled, false);
    assert.equal(developer.noclip_enabled, true);
    assert.ok(deliveries.some(packet => packet.to === observer.id && packet.player_id === developer.id && packet.type === "player_position" && packet.x === 350), "/vis immediately restores current position");
    assert.equal(approvals.at(-1).invisible_enabled, false);
    await command(developer, "/vis");
    assert.equal(developer.invisible_enabled, false, "Repeated /vis remains visible");
    developer.world = observer.world = "START";
    deliveries.length = 0;
    await command(developer, "/noc");
    await command(developer, "/noc");
    assert.equal(developer.invisible_enabled, false, "Noclip never changes visibility");
    assert.ok(audits.some(row => row.action === "developer_inv" && row.success && row.details.after_invisible_enabled === true));
    assert.ok(audits.some(row => row.action === "developer_vis" && row.success && row.details.after_invisible_enabled === false));
  }
  console.log("[developer-visibility] PASS: developer/PIN authorization, audit, self-visibility, immediate hide/show, noclip independence, direct/batched/late-join/world-change delivery with interest on/off");
})().catch(error => { console.error(error); process.exitCode = 1; });
