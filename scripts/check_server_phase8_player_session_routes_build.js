#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Phase8RoutesModule = require("../server_phase8_player_session_routes");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_phase8_player_session_routes.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_phase8_player_session_routes.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_phase8_player_session_routes_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-phase8-player-session-routes.json"), "utf8"));

/** @type {unknown[]} */
const sent = [];
/** @type {{ action: string, message: string }[]} */
const rejected = [];
/** @type {string[]} */
const events = [];
/** @type {Map<string, unknown>} */
const savedStates = new Map();
const tradeByPlayerId = new Map();
const activeFishingSessions = new Map();
let persistenceFlushSucceeds = true;
let playerRefreshSucceeds = true;
let worldRevision = 220;
let worldBlockRevision = 219;
let worldEntrySessionSequence = 0;

function record(/** @type {string} */ value) {
  events.push(value);
}

const deps = {
  activeFishingSessions,
  adminInventoryLookupPurpose: "admin_inventory_lookup",
  adminItemInstanceHistoryLookupPurpose: "admin_item_instance_history_lookup",
  adminItemInstanceLookupPurpose: "admin_item_instance_lookup",
  adminMonitoringDashboardPurpose: "admin_monitoring_dashboard",
  adminTransactionLedgerLookupPurpose: "admin_transaction_ledger_lookup",
  postgresStore: {
    mirrorPlayerWorld(/** @type {unknown} */ username, /** @type {unknown} */ world) {
      record(`mirror:${username}:${world}`);
    },
  },
  tradeByPlayerId,
  appendCctvWorldEvent: async (/** @type {unknown} */ world, /** @type {unknown} */ _player, /** @type {string} */ action) => record(`cctv:${action}:${world}`),
  beginWorldHonorVisit: async (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ world) => record(`honor_begin:${world}`),
  broadcastSystemToWorld: (/** @type {unknown} */ world, /** @type {string} */ message) => record(`system:${world}:${message}`),
  broadcastToWorld: (/** @type {unknown} */ world, /** @type {unknown} */ payload) => record(`broadcast:${world}:${payload && typeof payload === "object" ? /** @type {any} */ (payload).type : ""}`),
  broadcastWorldPopulationUpdate: (/** @type {unknown} */ world) => record(`population:${world}`),
  buildClientMovementGuidance: () => ({ interval_ms: 16 }),
  buildNetfoxSpawnTicketPayload: async () => ({ ticket: "netfox" }),
  buildPlayerStateForClient: (/** @type {unknown} */ state, /** @type {unknown} */ options = {}) => ({ state, options }),
  buildPublicPlayerPresencePayload: (/** @type {string} */ type, /** @type {unknown} */ _player, /** @type {unknown} */ world) => ({ type, world }),
  buildPublicPlayerProfilePayload: (/** @type {string} */ username, /** @type {string} */ requestId, /** @type {string} */ purpose) => ({ type: "player_profile", username, request_id: requestId, purpose, created_at: "2026-01-01T00:00:00.000Z", last_seen_at: "now", account: { username, created_at: "2026-01-01T00:00:00.000Z" }, equipment_slots: /** @type {any} */ (savedStates.get(username))?.equipment_slots || {} }),
  cancelActiveTradeForPlayer: (/** @type {string} */ playerId) => record(`cancel_trade:${playerId}`),
  // Landfill join-eligibility guard: a no-op pass-through here since this check exercises the
  // generic join_world flow, not Landfill-specific instance routing (see
  // check_server_landfill_event_build.js for that).
  checkLandfillInstanceJoinEligibility: (/** @type {unknown} */ world, /** @type {unknown} */ username) => {
    record(`landfill_eligibility:${world}:${username}`);
    return { ok: true };
  },
  cleanAccountName: (/** @type {unknown} */ value) => String(value || "").trim().toLowerCase(),
  cleanWorld: (/** @type {unknown} */ value) => String(value || "START").trim().toUpperCase(),
  clampInteger: (/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) => Math.max(min, Math.min(max, Math.trunc(Number(value) || 0))),
  clampString: (/** @type {unknown} */ value, /** @type {number} */ limit = 64) => String(value || "").trim().slice(0, limit),
  clearNetfoxTrustedPlayerState: () => record("clear_netfox"),
  clearPlayerFishingPresence: () => record("clear_fishing"),
  clearPlayerInterestState: (/** @type {string} */ playerId) => record(`clear_interest:${playerId}`),
  clearPlayerWorldEntrySpawnGuard: () => record("clear_world_entry_spawn"),
  clearTrustedMovementBaseline: () => record("clear_trusted"),
  commitWorldAdmissionReservation: async () => record("commit_admission"),
  ensurePlayerState: (/** @type {string} */ username) => savedStates.get(username) || (username.startsWith("offline") ? null : { username, inventory: [] }),
  ensureWritablePlayerState: (/** @type {string} */ username) => savedStates.get(username) || { username, inventory: [] },
  endWorldHonorVisit: async (/** @type {unknown} */ _player, /** @type {unknown} */ world, /** @type {string} */ reason) => record(`honor_end:${world}:${reason}`),
  ensureWorldRouteForAction: async () => ({ ok: true }),
  getEquipmentSlotsFromPlayerState: (/** @type {any} */ state) => state.equipment_slots || {},
  getFriendStatus: () => "none",
  getJoinWorldSpawnForWorld: () => ({ x: 32, y: 64, grid_x: 1, grid_y: 2 }),
  getPlayersInWorld: () => [{ id: "other" }],
  getWorldBlockRevisionForWorld: () => worldBlockRevision,
  getWorldRevision: () => worldRevision,
  flushPendingSessionPersistence: async (/** @type {unknown} */ username, /** @type {unknown} */ world, /** @type {string} */ reason) => {
    record(`flush:${username}:${world}:${reason}`);
    return persistenceFlushSucceeds
      ? { ok: true }
      : { ok: false, reason: "database_error" };
  },
  handleAdminInventoryLookupRequest: () => record("admin_inventory"),
  handleAdminItemInstanceHistoryLookupRequest: async () => record("admin_item_history"),
  handleAdminItemInstanceLookupRequest: async () => record("admin_item"),
  handleAdminMonitoringDashboardRequest: async () => record("admin_monitor"),
  handleAdminTransactionLedgerLookupRequest: async () => record("admin_tx"),
  isNetfoxRealMode: () => false,
  isPlayerOwnAccount: (/** @type {any} */ player, /** @type {string} */ username) => String(player.account_username || "").toLowerCase() === username,
  makeRequestId: (/** @type {any} */ data) => String(data?.request_id || "req-1"),
  mergeClientPlayerStateIntoServerState: (/** @type {string} */ username, /** @type {unknown} */ state) => ({ username, state, equipment_slots: { hand: "wrench" } }),
  notifyOnlineFriendsOfFriendState: (/** @type {unknown} */ username) => record(`friends:${username}`),
  publishPlayerPresenceUpdate: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ world, /** @type {string} */ type) => record(`presence:${type}:${world}`),
  queuePlayerSave: (/** @type {string} */ username) => record(`save:${username}`),
  recordLandfillInstanceJoin: (/** @type {unknown} */ world, /** @type {unknown} */ username) => record(`landfill_join:${world}:${username}`),
  refreshPlayerStateFromPostgres: async (/** @type {unknown} */ username, /** @type {string} */ reason) => {
    record(`refresh_player:${username}:${reason}`);
    if (!playerRefreshSucceeds) return { ok: false, found: false, reason: "database_error" };
    if (reason === "remote_player_profile") {
      savedStates.set(String(username), { username, inventory: [], equipment_slots: { hat: "top_hat" } });
    }
    return { ok: true, found: true };
  },
  refreshWorldStateFromPostgres: async (/** @type {unknown} */ world, /** @type {string} */ reason) => {
    record(`refresh_world:${world}:${reason}`);
    return { ok: true, world };
  },
  refreshWorldDropsFromPostgres: async (/** @type {unknown} */ world) => record(`drops:${world}`),
  rejectIfWorldBanned: async () => false,
  rejectWorldCapacity: () => record("capacity"),
  rejectWorldRouteAdmissionMismatch: () => record("route_mismatch"),
  releaseOwnedWorldRouteIfEmpty: async (/** @type {unknown} */ world) => record(`release_route:${world}`),
  releasePlayerWorldAdmission: async (/** @type {unknown} */ _player, /** @type {string} */ world) => record(`release_admission:${world}`),
  releaseWorldAdmissionReservation: async () => record("release_reservation"),
  removeWorldLockKeysFromPlayerInventory: async () => ({ ok: true }),
  requireAuthenticated: () => true,
  reserveWorldAdmission: async () => ({ ok: true }),
  resetPlayerMovementTracking: () => record("reset_movement"),
  setPlayerWorldEntrySpawnGuard: (/** @type {unknown} */ _player, /** @type {unknown} */ world, /** @type {any} */ spawn) => record(`guard_spawn:${world}:${spawn.x}:${spawn.y}`),
  sanitizeEquipmentSlots: (/** @type {unknown} */ slots) => slots,
  sanitizePlayerState: (/** @type {unknown} */ data) => data,
  sanitizeProfileBio: (/** @type {unknown} */ value) => String(value || "").trim().slice(0, 160),
  seedDropInterestForReceiverFromWorldState: () => record("seed_drop_interest"),
  sendActionRejected: (/** @type {unknown} */ _socket, /** @type {string} */ action, /** @type {string} */ message) => rejected.push({ action, message }),
  sendActiveWorldEventState: (/** @type {unknown} */ _socket, /** @type {unknown} */ world) => record(`events:${world}`),
  sendJson: (/** @type {unknown} */ _socket, /** @type {unknown} */ payload) => sent.push(payload),
  sendWorldStateToSocket: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ world, /** @type {unknown} */ extra) => {
    sent.push({ type: "world_state", world, extra });
    return {
      ok: true,
      streamed: true,
      world_revision: worldRevision,
      block_revision: worldBlockRevision,
    };
  },
  sendWorldPopulationUpdate: (/** @type {unknown} */ _socket, /** @type {unknown} */ world) => record(`send_population:${world}`),
  setPlayerState: (/** @type {string} */ username, /** @type {unknown} */ state) => savedStates.set(username, state),
  syncDropInterestForReceiver: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ world) => record(`sync_drop:${world}`),
  touchLivePresence: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ options = {}) => record(`touch:${Boolean(/** @type {any} */ (options).force)}`),
  updatePlayerWorldIndex: (/** @type {any} */ player) => record(`index:${player.world || ""}`),
  upsertAccount: (/** @type {unknown} */ account) => record(`account:${/** @type {any} */ (account).username}`),
  createWorldEntrySessionId: () => `entry-session-${++worldEntrySessionSequence}`,
};

const routes = /** @type {any} */ (Phase8RoutesModule.createServerPhase8PlayerSessionRoutes(deps));
const socket = {};

(async () => {
  const player = /** @type {any} */ ({ id: "p1", account_username: "uso", account_email: "u@example.com", name: "USO", equipment_slots: { hand: "old" } });
  await routes.handlePlayerStateRequest(socket, player, { type: "player_state_request", username: "uso", purpose: "active_profile" }, { playerId: "p1" });
  assert.equal(sent.length, 1);
  const initialStateResponse = /** @type {any} */ (sent.pop());
  assert.equal(initialStateResponse.type, "player_state");
  assert.equal(initialStateResponse.created_at, "2026-01-01T00:00:00.000Z");
  assert.equal(initialStateResponse.account.created_at, "2026-01-01T00:00:00.000Z");

  tradeByPlayerId.set("p1", {});
  await routes.handlePlayerStateSave(socket, player, { type: "player_state_save", username: "uso" }, { playerId: "p1" });
  assert.deepEqual(rejected.pop(), { action: "player_state_save", message: "Finish or cancel your trade before saving inventory." });
  tradeByPlayerId.delete("p1");

  await routes.handlePlayerStateSave(socket, player, { type: "player_state_save", username: "uso", legacy_client_inventory_import_revision: 3 }, { playerId: "p1" });
  assert.deepEqual(player.equipment_slots, { hand: "wrench" });
  assert.equal(/** @type {any} */ (sent.pop()).type, "player_state");

  await routes.handlePlayerProfileUpdate(socket, player, {
    type: "player_profile_update",
    request_id: "bio-1",
    username: "uso",
    profile_bio: "Building tiny worlds.",
  });
  const profileUpdate = /** @type {any} */ (sent.pop());
  assert.equal(profileUpdate.request_id, "bio-1");
  assert.equal(profileUpdate.purpose, "local_player_profile");
  assert.equal(profileUpdate.created_at, "2026-01-01T00:00:00.000Z");
  assert.equal(profileUpdate.account.created_at, "2026-01-01T00:00:00.000Z");
  assert.equal(/** @type {any} */ (savedStates.get("uso")).profile_bio, "Building tiny worlds.");
  assert.ok(events.includes("save:uso"));
  assert.ok(events.includes("flush:uso::player_profile_update_commit"));

  await routes.handlePlayerStateRequest(socket, { account_username: "admin", name: "admin" }, { type: "player_state_request", username: "uso", purpose: "admin_item_instance_lookup" }, { playerId: "admin" });
  assert.ok(events.includes("admin_item"));

  const remoteProfileEventStart = events.length;
  await routes.handlePlayerStateRequest(socket, { account_username: "viewer", name: "Viewer" }, { type: "player_state_request", username: "offline_target", purpose: "remote_player_profile", request_id: "profile-1" }, { playerId: "viewer" });
  const remoteProfileEvents = events.slice(remoteProfileEventStart);
  assert.ok(remoteProfileEvents.includes("refresh_player:offline_target:remote_player_profile"));
  const remoteProfile = /** @type {any} */ (sent.pop());
  assert.equal(remoteProfile.type, "player_profile");
  assert.equal(remoteProfile.request_id, "profile-1");
  assert.deepEqual(remoteProfile.equipment_slots, { hat: "top_hat" });

  const cachedProfileRefreshCount = events.filter((event) => event === "refresh_player:offline_target:remote_player_profile").length;
  await routes.handlePlayerStateRequest(socket, { account_username: "viewer", name: "Viewer" }, { type: "player_state_request", username: "offline_target", purpose: "remote_player_profile", request_id: "profile-2" }, { playerId: "viewer" });
  assert.equal(events.filter((event) => event === "refresh_player:offline_target:remote_player_profile").length, cachedProfileRefreshCount);
  assert.equal(/** @type {any} */ (sent.pop()).request_id, "profile-2");

  playerRefreshSucceeds = false;
  const sentBeforeFailedProfile = sent.length;
  await routes.handlePlayerStateRequest(socket, { account_username: "viewer", name: "Viewer" }, { type: "player_state_request", username: "offline_failure", purpose: "remote_player_profile", request_id: "profile-3" }, { playerId: "viewer" });
  assert.equal(sent.length, sentBeforeFailedProfile);
  assert.deepEqual(rejected.pop(), { action: "remote_player_profile", message: "Player profile is still loading. Try again." });
  playerRefreshSucceeds = true;

  const joiningPlayer = /** @type {any} */ ({ id: "p2", account_username: "joiner", account_email: "j@example.com", name: "Joiner", world: "", joined_world: false });
  const joinEventStart = events.length;
  await routes.handleJoinWorld(socket, joiningPlayer, {
    type: "join_world",
    world: "test",
    facing: -1,
    join_request_id: "join-test-1",
    world_entry_ready_v1: true,
  }, { playerId: "p2" });
  const joinEvents = events.slice(joinEventStart);
  assert.equal(joiningPlayer.world, "TEST");
  assert.equal(joiningPlayer.joined_world, false);
  assert.equal(joiningPlayer.world_entry_state, "snapshot_sent");
  assert.equal(joiningPlayer.facing, -1);
  assert.ok(joinEvents.includes("guard_spawn:TEST:32:64"));
  assert.ok(!joinEvents.includes("honor_begin:TEST"), "provisional entries must not publish active-world side effects");
  assert.ok(joinEvents.indexOf("refresh_world:TEST:join_world") >= 0);
  assert.ok(joinEvents.indexOf("refresh_player:joiner:join_world") > joinEvents.indexOf("refresh_world:TEST:join_world"));
  const joinOkPayload = /** @type {any} */ (sent.find((payload) => /** @type {any} */ (payload).type === "join_world_ok"));
  const joinWorldStatePayload = /** @type {any} */ (sent.find((payload) => /** @type {any} */ (payload).type === "world_state"));
  assert.equal(joinOkPayload.join_request_id, "join-test-1");
  assert.equal(joinOkPayload.world_entry_session_id, joiningPlayer.world_entry_session_id);
  assert.equal(joinOkPayload.world_entry_requires_ready, true);
  assert.equal(joinWorldStatePayload.extra.join_request_id, "join-test-1");
  assert.equal(joinWorldStatePayload.extra.world_entry_session_id, joiningPlayer.world_entry_session_id);
  assert.equal(joiningPlayer.world_entry_snapshot_queued, true);

  await routes.handleWorldEntryReady(socket, joiningPlayer, {
    type: "world_entry_ready",
    world: "TEST",
    world_entry_session_id: "stale-session",
    world_revision: 220,
    block_revision: 219,
  }, { playerId: "p2" });
  assert.equal(joiningPlayer.joined_world, false);
  assert.equal(/** @type {any} */ (sent.at(-1)).reason, "stale_world_entry_session");

  const worldStateCountBeforeCatchup = sent.filter(
    (/** @type {any} */ payload) => payload.type === "world_state",
  ).length;
  worldRevision = 221;
  worldBlockRevision = 220;
  await routes.handleWorldEntryReady(socket, joiningPlayer, {
    type: "world_entry_ready",
    world: "TEST",
    world_entry_session_id: joiningPlayer.world_entry_session_id,
    world_revision: 220,
    block_revision: 219,
  }, { playerId: "p2" });
  assert.equal(joiningPlayer.joined_world, false);
  assert.equal(joiningPlayer.world_entry_state, "snapshot_sent");
  assert.equal(/** @type {any} */ (sent.at(-1)).type, "world_entry_catchup_wait");
  assert.equal(/** @type {any} */ (sent.at(-1)).block_revision, 220);
  assert.equal(sent.filter(
    (/** @type {any} */ payload) => payload.type === "world_state",
  ).length, worldStateCountBeforeCatchup, "ordinary block drift must not resend the full snapshot");

  const readyEventStart = events.length;
  await routes.handleWorldEntryReady(socket, joiningPlayer, {
    type: "world_entry_ready",
    world: "TEST",
    world_entry_session_id: joiningPlayer.world_entry_session_id,
    world_revision: 221,
    block_revision: 220,
  }, { playerId: "p2" });
  const readyEvents = events.slice(readyEventStart);
  assert.equal(joiningPlayer.joined_world, true);
  assert.equal(joiningPlayer.world_entry_state, "active");
  assert.ok(readyEvents.includes("honor_begin:TEST"));
  assert.equal(/** @type {any} */ (sent.at(-1)).type, "world_entry_active");

  const honorBeginsBeforeDuplicateReady = events.filter((event) => event === "honor_begin:TEST").length;
  await routes.handleWorldEntryReady(socket, joiningPlayer, {
    type: "world_entry_ready",
    world: "TEST",
    world_entry_session_id: joiningPlayer.world_entry_session_id,
    world_revision: 221,
    block_revision: 220,
  }, { playerId: "p2" });
  assert.equal(events.filter((event) => event === "honor_begin:TEST").length, honorBeginsBeforeDuplicateReady);
  assert.equal(/** @type {any} */ (sent.at(-1)).type, "world_entry_active");

  const leaveEventStart = events.length;
  await routes.handleLeaveWorld(socket, joiningPlayer, { type: "leave_world", world: "test" }, { playerId: "p2" });
  const leaveEvents = events.slice(leaveEventStart);
  assert.equal(joiningPlayer.joined_world, false);
  assert.equal(joiningPlayer.world, "");
  assert.ok(leaveEvents.includes("clear_world_entry_spawn"));
  assert.ok(leaveEvents.includes("honor_end:TEST:leave_world"));
  assert.ok(events.includes("release_admission:TEST"));
  assert.ok(leaveEvents.indexOf("flush:joiner:TEST:leave_world") >= 0);
  assert.ok(leaveEvents.indexOf("flush:joiner:TEST:leave_world") < leaveEvents.indexOf("honor_end:TEST:leave_world"));
  assert.ok(leaveEvents.indexOf("honor_end:TEST:leave_world") < leaveEvents.indexOf("release_admission:TEST"));
  assert.ok(leaveEvents.indexOf("flush:joiner:TEST:leave_world") < leaveEvents.indexOf("release_admission:TEST"));
  worldRevision = 220;
  worldBlockRevision = 219;

  const legacyPlayer = /** @type {any} */ ({
    id: "p-legacy",
    account_username: "legacy",
    name: "Legacy",
    world: "",
    joined_world: false,
  });
  const legacySentStart = sent.length;
  await routes.handleJoinWorld(socket, legacyPlayer, {
    type: "join_world",
    world: "legacy",
    join_request_id: "join-legacy-1",
  }, { playerId: "p-legacy" });
  const legacyPayloads = sent.slice(legacySentStart);
  const legacyJoinOk = /** @type {any} */ (legacyPayloads.find(
    (/** @type {any} */ payload) => payload.type === "join_world_ok",
  ));
  assert.equal(legacyJoinOk.world_entry_requires_ready, false);
  assert.equal(legacyPlayer.joined_world, true);
  assert.equal(legacyPlayer.world_entry_state, "active");
  assert.ok(legacyPayloads.some((/** @type {any} */ payload) => payload.type === "world_entry_active"));

  persistenceFlushSucceeds = false;
  const blockedLeavePlayer = /** @type {any} */ ({
    id: "p-blocked",
    account_username: "blocked",
    name: "Blocked",
    world: "KEEP",
    joined_world: true,
  });
  const blockedLeaveEventStart = events.length;
  await routes.handleLeaveWorld(socket, blockedLeavePlayer, { type: "leave_world", world: "keep" }, { playerId: "p-blocked" });
  const blockedLeaveEvents = events.slice(blockedLeaveEventStart);
  assert.equal(blockedLeavePlayer.joined_world, true);
  assert.equal(blockedLeavePlayer.world, "KEEP");
  assert.ok(blockedLeaveEvents.includes("flush:blocked:KEEP:leave_world"));
  assert.ok(!blockedLeaveEvents.includes("release_admission:KEEP"));
  assert.equal(rejected.pop()?.action, "leave_world");
  persistenceFlushSucceeds = true;

  const driftPlayer = /** @type {any} */ ({ id: "p-drift", account_username: "drift", name: "Drift", world: "", joined_world: false });
  await routes.handleJoinWorld(socket, driftPlayer, {
    type: "join_world",
    world: "drift",
    join_request_id: "join-drift-1",
    world_entry_ready_v1: true,
  }, { playerId: "p-drift" });
  const driftSessionId = driftPlayer.world_entry_session_id;
  worldRevision = 221;
  worldBlockRevision = 220;
  const driftReadySentStart = sent.length;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await routes.handleWorldEntryReady(socket, driftPlayer, {
      type: "world_entry_ready",
      world: "DRIFT",
      world_entry_session_id: driftSessionId,
      world_revision: 220,
      block_revision: 219,
    }, { playerId: "p-drift" });
  }
  const driftReadyPayloads = sent.slice(driftReadySentStart);
  assert.equal(
    driftReadyPayloads.filter((/** @type {any} */ payload) => payload.type === "world_entry_catchup_wait").length,
    9,
    "catch-up should retry before falling back to a replacement snapshot",
  );
  const restartPayload = /** @type {any} */ ([...driftReadyPayloads].reverse().find(
    (/** @type {any} */ payload) => payload.type === "world_entry_snapshot_restart",
  ));
  assert.ok(restartPayload, "stalled catch-up must eventually request a bounded snapshot restart");
  assert.equal(restartPayload.reason, "world_entry_catchup_stalled");
  assert.equal(restartPayload.world_entry_session_id, driftSessionId);
  assert.equal(driftPlayer.world_entry_session_id, driftSessionId, "revision restarts must keep the same entry session");
  assert.equal(driftPlayer.joined_world, false);
  assert.equal(driftPlayer.world_entry_revision, 221);
  assert.equal(driftPlayer.world_entry_block_revision, 220);
  await routes.handleWorldEntryReady(socket, driftPlayer, {
    type: "world_entry_ready",
    world: "DRIFT",
    world_entry_session_id: driftSessionId,
    world_revision: 221,
    block_revision: 220,
  }, { playerId: "p-drift" });
  assert.equal(driftPlayer.joined_world, true);
  worldRevision = 220;
  worldBlockRevision = 219;

  const nonBlockDriftPlayer = /** @type {any} */ ({ id: "p-non-block-drift", account_username: "non_block_drift", name: "NonBlockDrift", world: "", joined_world: false });
  await routes.handleJoinWorld(socket, nonBlockDriftPlayer, {
    type: "join_world",
    world: "nonblock",
    join_request_id: "join-non-block-drift-1",
    world_entry_ready_v1: true,
  }, { playerId: "p-non-block-drift" });
  const nonBlockDriftSessionId = nonBlockDriftPlayer.world_entry_session_id;
  const nonBlockDriftReadySentStart = sent.length;
  worldRevision = 221;
  await routes.handleWorldEntryReady(socket, nonBlockDriftPlayer, {
    type: "world_entry_ready",
    world: "NONBLOCK",
    world_entry_session_id: nonBlockDriftSessionId,
    world_revision: 220,
    block_revision: 219,
  }, { playerId: "p-non-block-drift" });
  const nonBlockDriftReadyPayloads = sent.slice(nonBlockDriftReadySentStart);
  assert.equal(nonBlockDriftPlayer.joined_world, true, "non-block revision drift must not starve world activation");
  assert.equal(nonBlockDriftPlayer.world_entry_state, "active");
  assert.ok(nonBlockDriftReadyPayloads.some((/** @type {any} */ payload) => payload.type === "world_entry_active"));
  assert.ok(!nonBlockDriftReadyPayloads.some((/** @type {any} */ payload) => payload.type === "world_entry_snapshot_restart"));
  worldRevision = 220;

  const mismatchedLeavePlayer = /** @type {any} */ ({
    id: "p-mismatch",
    account_username: "mismatch",
    name: "Mismatch",
    world: "ACTUAL",
    joined_world: true,
  });
  const mismatchEventStart = events.length;
  await routes.handleLeaveWorld(socket, mismatchedLeavePlayer, { type: "leave_world", world: "other" }, { playerId: "p-mismatch" });
  const mismatchEvents = events.slice(mismatchEventStart);
  assert.equal(mismatchedLeavePlayer.joined_world, false);
  assert.ok(mismatchEvents.includes("honor_end:ACTUAL:leave_world_state_mismatch"));

  const changingPlayer = /** @type {any} */ ({ id: "p3", account_username: "mover", account_email: "m@example.com", name: "Mover", world: "OLD", joined_world: true });
  const changeEventStart = events.length;
  await routes.handleJoinWorld(socket, changingPlayer, {
    type: "join_world",
    world: "new",
    world_entry_ready_v1: true,
  }, { playerId: "p3" });
  const changeEvents = events.slice(changeEventStart);
  assert.equal(changingPlayer.world, "NEW");
  assert.ok(changeEvents.indexOf("flush:mover:OLD:world_change") >= 0);
  assert.ok(changeEvents.includes("honor_end:OLD:world_change"));
  assert.ok(!changeEvents.includes("honor_begin:NEW"));
  assert.ok(changeEvents.indexOf("flush:mover:OLD:world_change") < changeEvents.indexOf("release_route:OLD"));

  await routes.handleWorldEntryReady(socket, changingPlayer, {
    type: "world_entry_ready",
    world: "NEW",
    world_entry_session_id: changingPlayer.world_entry_session_id,
    world_revision: 220,
    block_revision: 219,
  }, { playerId: "p3" });
  assert.equal(changingPlayer.joined_world, true);
  assert.ok(events.includes("honor_begin:NEW"));

  assert.equal(
    packageJson.scripts["build:server-phase8-player-session-routes"],
    "tsc --project tsconfig.server-phase8-player-session-routes.json && node scripts/sync_server_phase8_player_session_routes_build.js"
  );
  assert.equal(
    packageJson.scripts["check:server-phase8-player-session-routes"],
    "npm run build:server-phase8-player-session-routes && node scripts/check_server_phase8_player_session_routes_build.js"
  );
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-phase8-player-session-routes/);
  assert.deepEqual(buildConfig.include, ["src/server_phase8_player_session_routes.ts"]);
  assert.match(helperSource, /function createServerPhase8PlayerSessionRoutes/);
  assert.match(helperSource, /function handlePlayerStateRequest/);
  assert.match(helperSource, /function handlePlayerProfileUpdate/);
  assert.match(helperSource, /function handleJoinWorld/);
  assert.match(helperSource, /sendWorldStateToSocket/);
  assert.match(helperSource, /flushPendingSessionPersistence/);
  assert.match(helperSource, /refreshPlayerStateFromPostgres/);
  assert.match(helperSource, /beginWorldHonorVisit/);
  assert.match(helperSource, /endWorldHonorVisit/);
  assert.match(generatedSource, /Generated from src\/server_phase8_player_session_routes\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.match(syncSource, /server_phase8_player_session_routes\.js/);
  assert.match(serverSource, /require\("\.\/server_phase8_player_session_routes"\)/);
  assert.match(serverSource, /createServerPhase8PlayerSessionRoutes/);
  assert.match(serverSource, /handlePlayerStateRequest/);
  assert.match(serverSource, /handleJoinWorld/);
  assert.match(serverSource, /sendWorldStateToSocket/);
  assert.match(serverSource, /socket\.inboundMessageQueue/);
  assert.match(serverSource, /function flushPendingSessionPersistence/);
  assert.match(serverSource, /function refreshPlayerStateFromPostgres/);
  assert.match(serverSource, /worldSaveWrites\.set\(clean, write\)/);
  assert.match(serverSource, /playerSaveWrites\.set\(accountKey\(clean\), write\)/);
  assert.match(serverSource, /return worldSaveWrites\.get\(clean\) \|\| null/);
  assert.match(serverSource, /return playerSaveWrites\.get\(key\) \|\| null/);
  assert.match(deploySource, /server_phase8_player_session_routes\.js/);
  assert.match(deploySource, /src\/server_phase8_player_session_routes\.ts/);
  assert.match(deploySource, /tsconfig\.server-phase8-player-session-routes\.json/);
  assert.match(deploySource, /sync_server_phase8_player_session_routes_build\.js/);
  assert.match(deploySource, /check_server_phase8_player_session_routes_build\.js/);
  assert.match(deploySource, /npm run build:server-phase8-player-session-routes/);

  console.log("[server-phase8-player-session-routes] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
