"use strict";

export {};

type PacketRecord = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;

interface PlayerRecord extends PacketRecord {
  account_username?: unknown;
  account_email?: unknown;
  animation_state?: unknown;
  current_world?: unknown;
  current_world_id?: unknown;
  equipment_slots?: unknown;
  facing?: unknown;
  joined_world?: unknown;
  name?: unknown;
  on_floor?: unknown;
  velocity_x?: unknown;
  velocity_y?: unknown;
  world?: unknown;
  x?: unknown;
  y?: unknown;
}

interface RouteContext {
  playerId: string;
}

interface MapLike {
  has(key: unknown): boolean;
  delete(key: unknown): boolean;
}

interface PostgresStoreLike {
  mirrorPlayerWorld(username: unknown, world: unknown): unknown;
}

interface Phase8PlayerSessionDeps {
  activeFishingSessions: MapLike;
  adminInventoryLookupPurpose: string;
  adminItemInstanceHistoryLookupPurpose: string;
  adminItemInstanceLookupPurpose: string;
  adminMonitoringDashboardPurpose: string;
  adminTransactionLedgerLookupPurpose: string;
  postgresStore: PostgresStoreLike;
  tradeByPlayerId: MapLike;

  appendCctvWorldEvent(worldName: unknown, player: PlayerRecord, action: string, details?: PacketRecord): Promise<unknown>;
  beginWorldHonorVisit(socket: unknown, player: PlayerRecord, worldName: unknown): Promise<unknown>;
  broadcastSystemToWorld(worldName: unknown, message: string, excludePlayerId?: unknown): unknown;
  broadcastToWorld(worldName: unknown, payload: unknown, excludePlayerId?: unknown): unknown;
  broadcastWorldPopulationUpdate(worldName: unknown): unknown;
  buildClientMovementGuidance(worldName: unknown): unknown;
  buildNetfoxSpawnTicketPayload(player: PlayerRecord, worldName: unknown, options?: PacketRecord): Promise<unknown>;
  buildPlayerStateForClient(state: unknown, options?: PacketRecord): unknown;
  buildPublicPlayerPresencePayload(type: string, player: PlayerRecord, worldName: unknown): unknown;
  buildPublicPlayerProfilePayload(username: string, requestId: string, purpose: string): unknown;
  cancelActiveTradeForPlayer(playerId: string, reason: string): unknown;
  cleanAccountName(value: unknown): string;
  cleanWorld(value: unknown): string;
  clampInteger(value: unknown, min: number, max: number): number;
  clampString(value: unknown, limit?: number): string;
  clearNetfoxTrustedPlayerState(player: PlayerRecord): unknown;
  clearPlayerFishingPresence(player: PlayerRecord): unknown;
  clearPlayerInterestState(playerId: string): unknown;
  clearPlayerWorldEntrySpawnGuard(player: PlayerRecord): unknown;
  clearTrustedMovementBaseline(player: PlayerRecord): unknown;
  commitWorldAdmissionReservation(admission: unknown, player: PlayerRecord, oldWorld: unknown): Promise<unknown>;
  ensurePlayerState(username: string): unknown;
  endWorldHonorVisit(player: PlayerRecord, worldName: unknown, reason: string): Promise<unknown>;
  ensureWorldRouteForAction(socket: unknown, player: PlayerRecord, worldName: string, action: string): Promise<unknown>;
  getEquipmentSlotsFromPlayerState(state: unknown): unknown;
  getFriendStatus(username: unknown, friendUsername: string): unknown;
  getJoinWorldSpawnForWorld(worldName: unknown): unknown;
  getPlayersInWorld(worldName: unknown, excludePlayerId: string, player: PlayerRecord): unknown;
  flushPendingSessionPersistence(username: unknown, worldName: unknown, reason: string): Promise<unknown>;
  handleAdminInventoryLookupRequest(socket: unknown, player: PlayerRecord, data: PacketRecord, username: string, requestId: string, purpose: string): MaybePromise<unknown>;
  handleAdminItemInstanceHistoryLookupRequest(socket: unknown, player: PlayerRecord, data: PacketRecord, username: string, requestId: string, purpose: string): Promise<unknown>;
  handleAdminItemInstanceLookupRequest(socket: unknown, player: PlayerRecord, data: PacketRecord, username: string, requestId: string, purpose: string): Promise<unknown>;
  handleAdminMonitoringDashboardRequest(socket: unknown, player: PlayerRecord, data: PacketRecord, username: string, requestId: string, purpose: string): Promise<unknown>;
  handleAdminTransactionLedgerLookupRequest(socket: unknown, player: PlayerRecord, data: PacketRecord, username: string, requestId: string, purpose: string): Promise<unknown>;
  isNetfoxRealMode(player: PlayerRecord, data: PacketRecord): boolean;
  isPlayerOwnAccount(player: PlayerRecord, username: string): boolean;
  makeRequestId(data: PacketRecord): string;
  mergeClientPlayerStateIntoServerState(username: string, state: unknown, options?: PacketRecord): unknown;
  notifyOnlineFriendsOfFriendState(username: unknown): unknown;
  publishPlayerPresenceUpdate(socket: unknown, player: PlayerRecord, worldName: unknown, type: string, excludePlayerId?: unknown): unknown;
  queuePlayerSave(username: string): unknown;
  refreshPlayerStateFromPostgres(username: unknown, reason: string): Promise<unknown>;
  refreshWorldStateFromPostgres(worldName: unknown, reason: string): Promise<unknown>;
  refreshWorldDropsFromPostgres(worldName: unknown, reason: string): Promise<unknown>;
  rejectIfWorldBanned(socket: unknown, player: PlayerRecord, worldName: string, action: string): Promise<boolean>;
  rejectWorldCapacity(socket: unknown, action: string, worldName: string, playerId: string, extra?: PacketRecord): unknown;
  rejectWorldRouteAdmissionMismatch(socket: unknown, player: PlayerRecord, action: string, worldName: string, admission: unknown): unknown;
  releaseOwnedWorldRouteIfEmpty(worldName: unknown): Promise<unknown>;
  releasePlayerWorldAdmission(player: PlayerRecord, worldName: string): Promise<unknown>;
  releaseWorldAdmissionReservation(admission: unknown): Promise<unknown>;
  removeWorldLockKeysFromPlayerInventory(socket: unknown, player: PlayerRecord, worldName: unknown, reason: string, options?: PacketRecord): Promise<unknown>;
  requireAuthenticated(socket: unknown, player: PlayerRecord, action: string): boolean;
  reserveWorldAdmission(player: PlayerRecord, worldName: string, action: string): Promise<unknown>;
  resetPlayerMovementTracking(player: PlayerRecord): unknown;
  setPlayerWorldEntrySpawnGuard(player: PlayerRecord, worldName: unknown, spawn: unknown): unknown;
  sanitizeEquipmentSlots(slots: unknown, username: string, state?: unknown): unknown;
  sanitizePlayerState(data: PacketRecord, username: string): unknown;
  seedDropInterestForReceiverFromWorldState(player: PlayerRecord, worldName: unknown): unknown;
  sendActionRejected(socket: unknown, action: string, message: string, extra?: PacketRecord): unknown;
  sendActiveWorldEventState(socket: unknown, worldName: unknown): unknown;
  sendJson(socket: unknown, payload: unknown): unknown;
  sendWorldStateToSocket(socket: unknown, player: PlayerRecord, worldName: unknown, extraMessageData?: PacketRecord): unknown;
  sendWorldPopulationUpdate(socket: unknown, worldName: unknown): unknown;
  setPlayerState(username: string, state: unknown): unknown;
  syncDropInterestForReceiver(socket: unknown, player: PlayerRecord, worldName: unknown, force?: boolean): unknown;
  touchLivePresence(socket: unknown, player: PlayerRecord, options?: PacketRecord): unknown;
  updatePlayerWorldIndex(player: PlayerRecord): unknown;
  upsertAccount(account: PacketRecord): unknown;
}

function isRecord(value: unknown): value is PacketRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toRecord(value: unknown): PacketRecord {
  return isRecord(value) ? value : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function createServerPhase8PlayerSessionRoutes(deps: Phase8PlayerSessionDeps) {
  function syncJoinWorldDropsToReceiver(socket: unknown, player: PlayerRecord, worldName: unknown): void {
    const cleanWorldName = deps.cleanWorld(worldName || player.world || "START");
    if (deps.cleanWorld(player.world || "") !== cleanWorldName) return;

    deps.seedDropInterestForReceiverFromWorldState(player, cleanWorldName);
    deps.syncDropInterestForReceiver(socket, player, cleanWorldName, true);
  }

  function refreshJoinWorldDropsAfterState(socket: unknown, player: PlayerRecord, worldName: unknown): void {
    const cleanWorldName = deps.cleanWorld(worldName || player.world || "START");
    void deps.refreshWorldDropsFromPostgres(cleanWorldName, "join_world").then(() => {
      syncJoinWorldDropsToReceiver(socket, player, cleanWorldName);
    }).catch((error) => {
      console.warn("[drops] join_world refresh failed:", errorMessage(error));
      syncJoinWorldDropsToReceiver(socket, player, cleanWorldName);
    });
  }

  async function handlePlayerStateRequest(socket: unknown, player: PlayerRecord, data: PacketRecord): Promise<void> {
    if (!deps.requireAuthenticated(socket, player, "load player data")) return;

    const requestId = deps.makeRequestId(data);
    const username = deps.cleanAccountName(data.username || data.requested_username || data.target_username || player.account_username || player.name);
    if (username === "") return;
    const purpose = deps.clampString(data.purpose || "").toLowerCase();
    if (purpose === deps.adminInventoryLookupPurpose) {
      await deps.handleAdminInventoryLookupRequest(socket, player, data, username, requestId, purpose);
      return;
    }
    if (purpose === deps.adminItemInstanceLookupPurpose) {
      await deps.handleAdminItemInstanceLookupRequest(socket, player, data, username, requestId, purpose);
      return;
    }
    if (purpose === deps.adminItemInstanceHistoryLookupPurpose) {
      await deps.handleAdminItemInstanceHistoryLookupRequest(socket, player, data, username, requestId, purpose);
      return;
    }
    if (purpose === deps.adminTransactionLedgerLookupPurpose) {
      await deps.handleAdminTransactionLedgerLookupRequest(socket, player, data, username, requestId, purpose);
      return;
    }
    if (purpose === deps.adminMonitoringDashboardPurpose) {
      await deps.handleAdminMonitoringDashboardRequest(socket, player, data, username, requestId, purpose);
      return;
    }
    if (!deps.isPlayerOwnAccount(player, username)) {
      if (purpose === "world_lock_access_check" || purpose === "remote_player_profile") {
        const publicProfile = toRecord(deps.buildPublicPlayerProfilePayload(username, requestId, purpose));
        publicProfile.friend_status = deps.getFriendStatus(player.account_username, username);
        deps.sendJson(socket, publicProfile);
      }
      return;
    }

    const playerRefresh = toRecord(await deps.refreshPlayerStateFromPostgres(username, "player_state_request"));
    if (!playerRefresh.ok) {
      deps.sendActionRejected(socket, "player_state_request", "Player data is still loading. Try again.", {
        reason: playerRefresh.reason || "player_state_refresh_failed",
      });
      return;
    }

    const state = deps.ensurePlayerState(username);
    const publicProfile = toRecord(deps.buildPublicPlayerProfilePayload(username, requestId, purpose));
    const playerData = state
      ? deps.buildPlayerStateForClient(state, { selectFirstHotbarSlot: purpose === "active_profile" })
      : {};
    deps.sendJson(socket, {
      type: "player_state",
      request_id: requestId,
      purpose,
      found: state !== null,
      username,
      online: true,
      world: player.world || "",
      current_world: player.world || "",
      last_seen_at: publicProfile.last_seen_at || "",
      friend_status: deps.getFriendStatus(player.account_username, username),
      account: publicProfile.account || { username },
      equipment_slots: player.equipment_slots || {},
      player_data: playerData,
    });
  }

  async function handlePlayerStateSave(socket: unknown, player: PlayerRecord, data: PacketRecord, context: RouteContext): Promise<void> {
    if (!deps.requireAuthenticated(socket, player, "save player data")) return;

    if (deps.tradeByPlayerId.has(context.playerId)) {
      deps.sendActionRejected(socket, "player_state_save", "Finish or cancel your trade before saving inventory.");
      return;
    }

    const username = deps.cleanAccountName(data.username || player.account_username || player.name);
    if (username === "") return;
    if (!deps.isPlayerOwnAccount(player, username)) return;

    const playerRefresh = toRecord(await deps.refreshPlayerStateFromPostgres(username, "player_state_save"));
    if (!playerRefresh.ok) {
      deps.sendActionRejected(socket, "player_state_save", "Player data is still loading. Try again.", {
        reason: playerRefresh.reason || "player_state_refresh_failed",
      });
      return;
    }

    const state = deps.sanitizePlayerState(data, username);
    if (!state) return;
    const serverState = deps.mergeClientPlayerStateIntoServerState(username, state, {
      legacyImportRequested: Boolean(data.legacy_client_inventory_import),
      legacyImportRevision: deps.clampInteger(data.legacy_client_inventory_import_revision || 1, 1, 1000),
    });
    if (!serverState) return;

    deps.upsertAccount({
      username,
      email: player.account_email,
    });
    deps.setPlayerState(username, serverState);
    player.equipment_slots = deps.sanitizeEquipmentSlots(deps.getEquipmentSlotsFromPlayerState(serverState), username, serverState);
    deps.queuePlayerSave(username);
    deps.sendJson(socket, {
      type: "player_state",
      found: true,
      username,
      player_data: serverState,
    });
  }

  async function handleJoinWorld(socket: unknown, player: PlayerRecord, data: PacketRecord, context: RouteContext): Promise<void> {
    if (!deps.requireAuthenticated(socket, player, "join worlds")) return;

    const oldWorld = player.world;
    const newWorld = deps.cleanWorld(data.world);
    const joinRequestId = deps.clampString(data.join_request_id || data.request_id || "", 128);
    if (await deps.rejectIfWorldBanned(socket, player, newWorld, "join_world")) return;
    const routeCheck = toRecord(await deps.ensureWorldRouteForAction(socket, player, newWorld, "join_world"));
    if (!routeCheck.ok) return;
    const admission = await deps.reserveWorldAdmission(player, newWorld, "join_world");
    const admissionRecord = toRecord(admission);
    if (!admissionRecord.ok) {
      if (admissionRecord.reason === "world_route_admission_mismatch") {
        deps.rejectWorldRouteAdmissionMismatch(socket, player, "join_world", newWorld, admission);
        return;
      }
      deps.rejectWorldCapacity(socket, "join_world", newWorld, context.playerId, {
        current_players: admissionRecord.current_players,
        join_request_id: joinRequestId,
      });
      return;
    }

    let admissionCommitted = false;
    try {
      const worldRefresh = toRecord(await deps.refreshWorldStateFromPostgres(newWorld, "join_world"));
      if (!worldRefresh.ok) {
        deps.sendActionRejected(socket, "join_world", "World data is still loading. Try again.", {
          reason: worldRefresh.reason || "world_state_refresh_failed",
          world: newWorld,
          join_request_id: joinRequestId,
        });
        deps.releaseOwnedWorldRouteIfEmpty(newWorld).catch((error) => {
          console.warn("[redis] world route join refresh cleanup failed:", errorMessage(error));
        });
        return;
      }

      const playerRefresh = toRecord(await deps.refreshPlayerStateFromPostgres(player.account_username, "join_world"));
      if (!playerRefresh.ok) {
        deps.sendActionRejected(socket, "join_world", "Player data is still loading. Try again.", {
          reason: playerRefresh.reason || "player_state_refresh_failed",
          world: newWorld,
          join_request_id: joinRequestId,
        });
        return;
      }

      if (oldWorld && oldWorld !== newWorld) {
        deps.cancelActiveTradeForPlayer(context.playerId, "Trade canceled because a player changed worlds.");
        deps.activeFishingSessions.delete(context.playerId);
        deps.clearPlayerFishingPresence(player);
        const keyCleanup = toRecord(await deps.removeWorldLockKeysFromPlayerInventory(socket, player, oldWorld, "world_change"));
        if (!keyCleanup.ok) {
          deps.sendActionRejected(socket, "join_world", String(keyCleanup.message || "Could not remove your World Lock Key. Try again."), {
            reason: keyCleanup.reason || "world_lock_key_cleanup_failed",
            world: oldWorld,
            join_request_id: joinRequestId,
          });
          return;
        }
        const transitionFlush = toRecord(await deps.flushPendingSessionPersistence(
          player.account_username,
          oldWorld,
          "world_change"
        ));
        if (!transitionFlush.ok) {
          deps.sendActionRejected(socket, "join_world", "Could not safely save your current world. Try again.", {
            reason: transitionFlush.reason || "persistence_flush_failed",
            world: oldWorld,
            join_request_id: joinRequestId,
          });
          return;
        }
      }

      if (player.joined_world && oldWorld && oldWorld !== newWorld) {
        await deps.endWorldHonorVisit(player, oldWorld, "world_change");
        await deps.appendCctvWorldEvent(oldWorld, player, "leave", { reason: "world_change" });
        deps.broadcastSystemToWorld(oldWorld, `${player.name} left ${oldWorld}`, context.playerId);
        deps.broadcastToWorld(oldWorld, deps.buildPublicPlayerPresencePayload("player_left", player, oldWorld), context.playerId);
        deps.clearPlayerInterestState(context.playerId);
      }

      player.world = newWorld;
      player.current_world = newWorld;
      player.current_world_id = newWorld;
      player.joined_world = true;
      deps.updatePlayerWorldIndex(player);
      await deps.commitWorldAdmissionReservation(admission, player, oldWorld);
      admissionCommitted = true;
      deps.resetPlayerMovementTracking(player);
      deps.clearNetfoxTrustedPlayerState(player);
      deps.clearTrustedMovementBaseline(player);
      const joinSpawn = toRecord(deps.getJoinWorldSpawnForWorld(player.world));
      player.x = joinSpawn.x;
      player.y = joinSpawn.y;
      deps.setPlayerWorldEntrySpawnGuard(player, player.world, joinSpawn);
      player.velocity_x = 0;
      player.velocity_y = 0;
      player.animation_state = "idle";
      player.on_floor = true;
      player.facing = Number(data.facing) < 0 ? -1 : 1;
      deps.postgresStore.mirrorPlayerWorld(player.account_username, player.world);
      await deps.appendCctvWorldEvent(player.world, player, "enter", { reason: "join_world" });

      const existingPlayers = deps.getPlayersInWorld(player.world, context.playerId, player);
      console.log("[APPEARANCE][Server] sending world appearance snapshot", {
        player: player.account_username,
        world: player.world,
        existing_players: Array.isArray(existingPlayers) ? existingPlayers.length : 0,
      });

      const joinWorldPayload: PacketRecord = {
        type: "join_world_ok",
        world: player.world,
        players: existingPlayers,
        username: player.account_username,
        player_data: deps.buildPlayerStateForClient(deps.ensurePlayerState(String(player.account_username || "")) || {}),
        spawn_x: joinSpawn.x,
        spawn_y: joinSpawn.y,
        spawn_grid_x: joinSpawn.grid_x,
        spawn_grid_y: joinSpawn.grid_y,
        spawn_at_entrance_gate: true,
        network_movement_guidance: deps.buildClientMovementGuidance(player.world),
        join_request_id: joinRequestId,
      };
      if (deps.isNetfoxRealMode(player, data)) {
        joinWorldPayload.netfox_route = await deps.buildNetfoxSpawnTicketPayload(player, player.world, {
          websocket_player_id: context.playerId,
        });
      }
      deps.sendJson(socket, joinWorldPayload);
      deps.sendWorldPopulationUpdate(socket, player.world);

      deps.sendWorldStateToSocket(socket, player, player.world, {
        receiver_player: player,
        respawn_player: true,
        force_player_position: true,
        world_state_reason: "join_world",
        spawn_x: joinSpawn.x,
        spawn_y: joinSpawn.y,
        spawn_grid_x: joinSpawn.grid_x,
        spawn_grid_y: joinSpawn.grid_y,
        spawn_at_entrance_gate: true,
        portal_spawn_x: joinSpawn.x,
        portal_spawn_y: joinSpawn.y,
        x: joinSpawn.x,
        y: joinSpawn.y,
        join_request_id: joinRequestId,
      });
      refreshJoinWorldDropsAfterState(socket, player, player.world);
      deps.sendActiveWorldEventState(socket, player.world);
      await deps.beginWorldHonorVisit(socket, player, player.world);

      deps.publishPlayerPresenceUpdate(socket, player, player.world, "player_joined", context.playerId);

      deps.broadcastSystemToWorld(player.world, `${player.name} joined ${player.world}`, context.playerId);
      deps.broadcastWorldPopulationUpdate(player.world);
      if (oldWorld && oldWorld !== player.world) {
        deps.broadcastWorldPopulationUpdate(oldWorld);
        deps.releaseOwnedWorldRouteIfEmpty(oldWorld).catch((error) => {
          console.warn("[redis] world route join cleanup failed:", errorMessage(error));
        });
      }
      deps.touchLivePresence(socket, player, { force: true });
      deps.notifyOnlineFriendsOfFriendState(player.account_username);
    } finally {
      if (!admissionCommitted) {
        await deps.releaseWorldAdmissionReservation(admission);
      }
    }
  }

  async function handleLeaveWorld(socket: unknown, player: PlayerRecord, data: PacketRecord, context: RouteContext): Promise<void> {
    if (!deps.requireAuthenticated(socket, player, "leave worlds")) return;

    const requestedWorld = deps.cleanWorld(data.world || player.world || "");
    const currentWorld = deps.cleanWorld(player.world || "");
    if (!player.joined_world || !currentWorld || (requestedWorld && requestedWorld !== currentWorld)) {
      if (player.joined_world && player.world) {
        await deps.endWorldHonorVisit(player, player.world, "leave_world_state_mismatch");
      }
      player.joined_world = false;
      deps.clearPlayerWorldEntrySpawnGuard(player);
      deps.updatePlayerWorldIndex(player);
      return;
    }

    deps.cancelActiveTradeForPlayer(context.playerId, "Trade canceled because a player left the world.");
    deps.activeFishingSessions.delete(context.playerId);
    deps.clearPlayerFishingPresence(player);
    const keyCleanup = toRecord(await deps.removeWorldLockKeysFromPlayerInventory(socket, player, currentWorld, "leave_world"));
    if (!keyCleanup.ok) {
      deps.sendActionRejected(socket, "leave_world", String(keyCleanup.message || "Could not remove your World Lock Key. Try again."), {
        reason: keyCleanup.reason || "world_lock_key_cleanup_failed",
        world: currentWorld,
      });
      return;
    }
    const transitionFlush = toRecord(await deps.flushPendingSessionPersistence(
      player.account_username,
      currentWorld,
      "leave_world"
    ));
    if (!transitionFlush.ok) {
      deps.sendActionRejected(socket, "leave_world", "Could not safely save your world. Try again.", {
        reason: transitionFlush.reason || "persistence_flush_failed",
        world: currentWorld,
      });
      return;
    }
    await deps.endWorldHonorVisit(player, currentWorld, "leave_world");
    await deps.appendCctvWorldEvent(currentWorld, player, "leave", { reason: "leave_world" });
    deps.broadcastToWorld(currentWorld, deps.buildPublicPlayerPresencePayload("player_left", player, currentWorld), context.playerId);
    deps.broadcastSystemToWorld(currentWorld, `${player.name} left ${currentWorld}`, context.playerId);
    player.joined_world = false;
    player.world = "";
    player.current_world = "";
    player.current_world_id = "";
    deps.clearPlayerWorldEntrySpawnGuard(player);
    deps.updatePlayerWorldIndex(player);
    await deps.releasePlayerWorldAdmission(player, currentWorld);
    deps.clearNetfoxTrustedPlayerState(player);
    deps.clearPlayerInterestState(context.playerId);
    deps.broadcastWorldPopulationUpdate(currentWorld);
    deps.releaseOwnedWorldRouteIfEmpty(currentWorld).catch((error) => {
      console.warn("[redis] world route leave cleanup failed:", errorMessage(error));
    });
    deps.touchLivePresence(socket, player, { force: true });
  }

  return {
    handlePlayerStateRequest,
    handlePlayerStateSave,
    handleJoinWorld,
    handleLeaveWorld,
  };
}

module.exports = {
  createServerPhase8PlayerSessionRoutes,
};
