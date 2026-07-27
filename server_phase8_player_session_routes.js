// Generated from src/server_phase8_player_session_routes.ts. Do not edit by hand.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function toRecord(value) {
    return isRecord(value) ? value : {};
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || "unknown error");
}
const WORLD_ENTRY_PROFILE_ENABLED = process.env.NODE_ENV !== "production"
    && ["1", "true", "yes", "on"].includes(String(process.env.WORLD_ENTRY_PROFILE || "").trim().toLowerCase());
const WORLD_ENTRY_PROFILE_SERVER_INSTANCE = String(process.env.SERVER_INSTANCE_ID || process.env.INSTANCE_ID || process.env.NODE_APP_INSTANCE || "development").trim().slice(0, 128);
function worldEntryElapsedMs(startedAt, endedAt = process.hrtime.bigint()) {
    return Math.round((Number(endedAt - startedAt) / 1_000_000) * 1000) / 1000;
}
function beginWorldEntryServerProfile(worldId, requestId) {
    if (!WORLD_ENTRY_PROFILE_ENABLED)
        return null;
    const now = process.hrtime.bigint();
    const heapBytes = Math.max(0, Math.trunc(process.memoryUsage().heapUsed));
    return {
        worldId,
        requestId,
        startedAt: now,
        lastStageAt: now,
        baselineHeapBytes: heapBytes,
        peakHeapBytes: heapBytes,
    };
}
function recordWorldEntryServerStage(profile, stage, details = {}) {
    if (!profile)
        return;
    const now = process.hrtime.bigint();
    const heapBytes = Math.max(0, Math.trunc(process.memoryUsage().heapUsed));
    profile.peakHeapBytes = Math.max(profile.peakHeapBytes, heapBytes);
    console.log("[world-entry-server]", JSON.stringify({
        event: "world_entry_stage",
        stage,
        world_id: profile.worldId,
        server_instance: WORLD_ENTRY_PROFILE_SERVER_INSTANCE,
        request_id: profile.requestId,
        stage_ms: worldEntryElapsedMs(profile.lastStageAt, now),
        total_ms: worldEntryElapsedMs(profile.startedAt, now),
        heap_bytes: heapBytes,
        peak_heap_bytes: profile.peakHeapBytes,
        heap_delta_bytes: heapBytes - profile.baselineHeapBytes,
        ...details,
    }));
    profile.lastStageAt = now;
}
function createServerPhase8PlayerSessionRoutes(deps) {
    function syncJoinWorldDropsToReceiver(socket, player, worldName) {
        const cleanWorldName = deps.cleanWorld(worldName || player.world || "START");
        if (deps.cleanWorld(player.world || "") !== cleanWorldName)
            return;
        deps.seedDropInterestForReceiverFromWorldState(player, cleanWorldName);
        deps.syncDropInterestForReceiver(socket, player, cleanWorldName, true);
    }
    function refreshJoinWorldDropsAfterState(socket, player, worldName) {
        const cleanWorldName = deps.cleanWorld(worldName || player.world || "START");
        void deps.refreshWorldDropsFromPostgres(cleanWorldName, "join_world").then(() => {
            syncJoinWorldDropsToReceiver(socket, player, cleanWorldName);
        }).catch((error) => {
            console.warn("[drops] join_world refresh failed:", errorMessage(error));
            syncJoinWorldDropsToReceiver(socket, player, cleanWorldName);
        });
    }
    async function handlePlayerStateRequest(socket, player, data) {
        if (!deps.requireAuthenticated(socket, player, "load player data"))
            return;
        const requestId = deps.makeRequestId(data);
        const username = deps.cleanAccountName(data.username || data.requested_username || data.target_username || player.account_username || player.name);
        if (username === "")
            return;
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
                if (purpose === "remote_player_profile" && deps.ensurePlayerState(username) === null) {
                    const targetRefresh = toRecord(await deps.refreshPlayerStateFromPostgres(username, "remote_player_profile"));
                    if (!targetRefresh.ok) {
                        deps.sendActionRejected(socket, "remote_player_profile", "Player profile is still loading. Try again.", {
                            reason: targetRefresh.reason || "player_profile_refresh_failed",
                        });
                        return;
                    }
                }
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
            created_at: publicProfile.created_at || "",
            last_seen_at: publicProfile.last_seen_at || "",
            friend_status: deps.getFriendStatus(player.account_username, username),
            account: publicProfile.account || { username },
            equipment_slots: player.equipment_slots || {},
            player_data: playerData,
        });
    }
    async function handlePlayerStateSave(socket, player, data, context) {
        if (!deps.requireAuthenticated(socket, player, "save player data"))
            return;
        if (deps.tradeByPlayerId.has(context.playerId)) {
            deps.sendActionRejected(socket, "player_state_save", "Finish or cancel your trade before saving inventory.");
            return;
        }
        const username = deps.cleanAccountName(data.username || player.account_username || player.name);
        if (username === "")
            return;
        if (!deps.isPlayerOwnAccount(player, username))
            return;
        const playerRefresh = toRecord(await deps.refreshPlayerStateFromPostgres(username, "player_state_save"));
        if (!playerRefresh.ok) {
            deps.sendActionRejected(socket, "player_state_save", "Player data is still loading. Try again.", {
                reason: playerRefresh.reason || "player_state_refresh_failed",
            });
            return;
        }
        const state = deps.sanitizePlayerState(data, username);
        if (!state)
            return;
        const serverState = deps.mergeClientPlayerStateIntoServerState(username, state, {
            legacyImportRequested: Boolean(data.legacy_client_inventory_import),
            legacyImportRevision: deps.clampInteger(data.legacy_client_inventory_import_revision || 1, 1, 1000),
        });
        if (!serverState)
            return;
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
    async function handlePlayerProfileUpdate(socket, player, data) {
        if (!deps.requireAuthenticated(socket, player, "update player profile"))
            return;
        const requestId = deps.makeRequestId(data);
        const username = deps.cleanAccountName(data.username || player.account_username || player.name);
        if (username === "" || !deps.isPlayerOwnAccount(player, username)) {
            deps.sendActionRejected(socket, "player_profile_update", "You can only edit your own profile.", {
                request_id: requestId,
                reason: "profile_owner_required",
            });
            return;
        }
        const playerRefresh = toRecord(await deps.refreshPlayerStateFromPostgres(username, "player_profile_update"));
        if (!playerRefresh.ok) {
            deps.sendActionRejected(socket, "player_profile_update", "Profile data is still loading. Try again.", {
                request_id: requestId,
                reason: playerRefresh.reason || "player_state_refresh_failed",
            });
            return;
        }
        const state = toRecord(deps.ensureWritablePlayerState(username));
        if (!Object.keys(state).length) {
            deps.sendActionRejected(socket, "player_profile_update", "Could not load your profile.", {
                request_id: requestId,
                reason: "player_state_unavailable",
            });
            return;
        }
        state.profile_bio = deps.sanitizeProfileBio(data.profile_bio);
        state.saved_at = new Date().toISOString();
        deps.setPlayerState(username, state);
        deps.queuePlayerSave(username);
        const persistence = toRecord(await deps.flushPendingSessionPersistence(username, "", "player_profile_update_commit"));
        if (!persistence.ok) {
            deps.sendActionRejected(socket, "player_profile_update", "Could not save your profile. Try again.", {
                request_id: requestId,
                reason: persistence.reason || "profile_persistence_failed",
            });
            return;
        }
        const publicProfile = toRecord(deps.buildPublicPlayerProfilePayload(username, requestId, "local_player_profile"));
        publicProfile.ok = true;
        publicProfile.message = "Profile saved.";
        deps.sendJson(socket, publicProfile);
    }
    async function handleJoinWorld(socket, player, data, context) {
        if (!deps.requireAuthenticated(socket, player, "join worlds"))
            return;
        const oldWorld = player.world;
        const newWorld = deps.cleanWorld(data.world);
        const joinRequestId = deps.clampString(data.join_request_id || data.request_id || "", 128);
        const worldEntryProfile = beginWorldEntryServerProfile(newWorld, joinRequestId);
        recordWorldEntryServerStage(worldEntryProfile, "request_validated");
        if (await deps.rejectIfWorldBanned(socket, player, newWorld, "join_world")) {
            recordWorldEntryServerStage(worldEntryProfile, "rejected", { reason: "world_banned" });
            return;
        }
        recordWorldEntryServerStage(worldEntryProfile, "ban_check_complete");
        const routeCheck = toRecord(await deps.ensureWorldRouteForAction(socket, player, newWorld, "join_world"));
        recordWorldEntryServerStage(worldEntryProfile, "route_lookup_complete", {
            route_ok: routeCheck.ok === true,
            route_cache_hit: routeCheck.cache_hit === true,
            route_reason: String(routeCheck.reason || ""),
        });
        if (!routeCheck.ok)
            return;
        const admission = await deps.reserveWorldAdmission(player, newWorld, "join_world");
        const admissionRecord = toRecord(admission);
        recordWorldEntryServerStage(worldEntryProfile, "admission_complete", {
            admission_ok: admissionRecord.ok === true,
            admission_reason: String(admissionRecord.reason || ""),
        });
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
            const refreshStartedAt = process.hrtime.bigint();
            const [worldRefreshValue, playerRefreshValue] = await Promise.all([
                deps.refreshWorldStateFromPostgres(newWorld, "join_world"),
                deps.refreshPlayerStateFromPostgres(player.account_username, "join_world"),
            ]);
            const worldRefresh = toRecord(worldRefreshValue);
            const playerRefresh = toRecord(playerRefreshValue);
            recordWorldEntryServerStage(worldEntryProfile, "authoritative_reads_complete", {
                parallel_read_ms: worldEntryElapsedMs(refreshStartedAt),
                world_source: String(worldRefresh.source || worldRefresh.reason || "unknown"),
                world_coalesced: worldRefresh.coalesced === true,
                world_revision: Number(worldRefresh.world_revision || 0),
                world_timings: toRecord(worldRefresh.timings),
                player_found: playerRefresh.found === true,
                player_timings: toRecord(playerRefresh.timings),
            });
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
            if (!playerRefresh.ok) {
                deps.sendActionRejected(socket, "join_world", "Player data is still loading. Try again.", {
                    reason: playerRefresh.reason || "player_state_refresh_failed",
                    world: newWorld,
                    join_request_id: joinRequestId,
                });
                return;
            }
            if (oldWorld && oldWorld !== newWorld) {
                const transitionStartedAt = process.hrtime.bigint();
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
                const transitionFlush = toRecord(await deps.flushPendingSessionPersistence(player.account_username, oldWorld, "world_change"));
                if (!transitionFlush.ok) {
                    deps.sendActionRejected(socket, "join_world", "Could not safely save your current world. Try again.", {
                        reason: transitionFlush.reason || "persistence_flush_failed",
                        world: oldWorld,
                        join_request_id: joinRequestId,
                    });
                    return;
                }
                recordWorldEntryServerStage(worldEntryProfile, "previous_world_persisted", {
                    transition_ms: worldEntryElapsedMs(transitionStartedAt),
                });
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
            recordWorldEntryServerStage(worldEntryProfile, "world_initialized", {
                spawn_grid_x: Number(joinSpawn.grid_x || 0),
                spawn_grid_y: Number(joinSpawn.grid_y || 0),
            });
            const existingPlayers = deps.getPlayersInWorld(player.world, context.playerId, player);
            console.log("[APPEARANCE][Server] sending world appearance snapshot", {
                player: player.account_username,
                world: player.world,
                existing_players: Array.isArray(existingPlayers) ? existingPlayers.length : 0,
            });
            const joinWorldPayload = {
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
            recordWorldEntryServerStage(worldEntryProfile, "join_ack_queued");
            const worldStateDelivery = toRecord(deps.sendWorldStateToSocket(socket, player, player.world, {
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
            }));
            recordWorldEntryServerStage(worldEntryProfile, "world_state_queued", {
                streamed: worldStateDelivery.streamed === true,
                delivery_ok: worldStateDelivery.ok === true,
                payload_build_ms: Number(worldStateDelivery.payload_build_ms || 0),
                stream_build_ms: Number(worldStateDelivery.stream_build_ms || 0),
                serialization_ms: Number(worldStateDelivery.serialization_ms || 0),
                compression: String(worldStateDelivery.compression || "none"),
                compression_ms: Number(worldStateDelivery.compression_ms || 0),
                queue_ms: Number(worldStateDelivery.queue_ms || 0),
                snapshot_bytes: Number(worldStateDelivery.snapshot_bytes || 0),
                wire_bytes: Number(worldStateDelivery.wire_bytes || 0),
                chunk_count: Number(worldStateDelivery.chunk_count || 0),
                section_count: Number(worldStateDelivery.section_count || 0),
                world_revision: Number(worldStateDelivery.world_revision || 0),
                block_revision: Number(worldStateDelivery.block_revision || 0),
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
            recordWorldEntryServerStage(worldEntryProfile, "server_join_complete");
        }
        finally {
            if (!admissionCommitted) {
                await deps.releaseWorldAdmissionReservation(admission);
                recordWorldEntryServerStage(worldEntryProfile, "admission_released");
            }
        }
    }
    async function handleLeaveWorld(socket, player, data, context) {
        if (!deps.requireAuthenticated(socket, player, "leave worlds"))
            return;
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
        const transitionFlush = toRecord(await deps.flushPendingSessionPersistence(player.account_username, currentWorld, "leave_world"));
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
        handlePlayerProfileUpdate,
        handleJoinWorld,
        handleLeaveWorld,
    };
}
module.exports = {
    createServerPhase8PlayerSessionRoutes,
};
