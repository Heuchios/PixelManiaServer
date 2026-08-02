// Generated from src/server_phase11d_standard_movement.ts. Do not edit by hand.
"use strict";
function createServerPhase11dStandardMovement(deps) {
    const { LAVA_REBOUND_MOVE_EXTRA_PIXELS, MAX_DAMAGE_FLASH_MS, MAX_MOVE_ACCEL_PIXELS_PER_SECOND2, MAX_MOVE_PIXELS_PER_SECOND, MAX_MOVE_VELOCITY_DELTA_EXTRA, MOVEMENT_CORRECTION_SMOOTH_MS, MOVEMENT_CORRECTION_SNAP_DISTANCE, MOVEMENT_DISTANCE_GRACE_PIXELS, MOVEMENT_MAX_ELAPSED_SECONDS, TILE_SIZE, activeFishingSessions, checkPlayerWorldEntrySpawnGuard, cleanAccountName, cleanWorld, clampInteger, clampString, clearPlayerWorldEntrySpawnGuard, debugNetfoxAction, ensureWorldState, getDefaultEntranceGateSpawnForWorld, getEntranceGateSpawnForWorld, getGridCenterPixels, getMovementCollisionAtPosition, getPublicPlayerIdentity, gridKey, isAdmin, isCheckpointBlockType, isGridInWorld, isMovementNearLavaRebound, isPositionInWorldBounds, playerNetworkStats, sendActionRejected, } = deps;
    const nowMs = typeof deps.nowMs === "function" ? deps.nowMs : () => Date.now();
    const MOVEMENT_SEQUENCE_MAX = 2147483647;
    const MOVEMENT_SEQUENCE_WRAP_WINDOW = 1073741824;
    const hardSnapCorrectionReasons = new Set([
        "movement_blocked",
        "outside_world_bounds",
        "invalid_position",
        "world_entry_position_pending",
    ]);
    function sanitizeMovementSequence(data) {
        const raw = data?.movement_sequence ?? data?.sequence ?? data?.seq ?? data?.input_sequence;
        const sequence = Math.trunc(Number(raw) || 0);
        if (!Number.isFinite(sequence) || sequence <= 0)
            return 0;
        return Math.min(sequence, MOVEMENT_SEQUENCE_MAX);
    }
    function isMovementSequenceNewer(sequence, previousSequence) {
        const safePrevious = Math.max(0, Math.trunc(Number(previousSequence) || 0));
        const safeSequence = Math.max(0, Math.trunc(Number(sequence) || 0));
        if (safeSequence <= 0 || safePrevious <= 0)
            return false;
        if (safeSequence > safePrevious)
            return true;
        if (safePrevious > MOVEMENT_SEQUENCE_MAX - MOVEMENT_SEQUENCE_WRAP_WINDOW && safeSequence <= MOVEMENT_SEQUENCE_WRAP_WINDOW) {
            return true;
        }
        return false;
    }
    function sanitizeMovementClientTimeMsec(data) {
        const raw = data?.client_time_msec
            ?? data?.client_timestamp_msec
            ?? data?.sent_at_msec
            ?? data?.timestamp_msec
            ?? data?.packet_time_msec
            ?? data?.timestamp;
        const time = Math.trunc(Number(raw) || 0);
        if (!Number.isFinite(time) || time <= 0)
            return 0;
        return Math.min(time, Number.MAX_SAFE_INTEGER);
    }
    function commitAcceptedMovementTiming(player, data, now) {
        if (!player)
            return;
        const sequence = sanitizeMovementSequence(data);
        const clientTimeMsec = sanitizeMovementClientTimeMsec(data);
        player.last_position_at = now;
        player.movement_server_time_msec = now;
        player.chat_typing = data?.chat_typing === true;
        if (sequence > 0)
            player.movement_sequence = sequence;
        if (clientTimeMsec > 0)
            player.movement_client_time_msec = clientTimeMsec;
    }
    function sanitizePlayerVelocity(value) {
        const velocity = Number(value);
        if (!Number.isFinite(velocity))
            return 0;
        return Math.max(-2000, Math.min(2000, velocity));
    }
    function sanitizePlayerAnimationState(value) {
        const clean = String(value || "").trim().toLowerCase();
        if (["idle", "walk", "jump", "fall", "punch", "hurt", "dead", "dead_spirit"].includes(clean)) {
            return clean;
        }
        return "idle";
    }
    function sanitizePlayerPosition(data, player) {
        const x = Number(data?.x);
        const y = Number(data?.y);
        if (!isPositionInWorldBounds(x, y))
            return null;
        return {
            x,
            y,
            facing: Number(data?.facing) < 0 ? -1 : 1,
            world: cleanWorld(data?.world || player?.world || "START"),
            in_water: data?.in_water === true,
            in_lava_fire: data?.in_lava_fire === true,
        };
    }
    function sanitizePlayerDamageFlash(data) {
        const remainingMs = clampInteger(data?.damage_flash_remaining_ms || 0, 0, MAX_DAMAGE_FLASH_MS);
        const token = clampInteger(data?.damage_flash_token || 0, 0, 2147483647);
        return {
            active: data?.damage_flash_active === true && remainingMs > 0,
            remaining_ms: remainingMs,
            token,
        };
    }
    function getPublicPlayerDamageFlash(player) {
        const expiresAt = Number(player?.damage_flash_expires_at || 0);
        const remainingMs = Math.max(0, Math.min(MAX_DAMAGE_FLASH_MS, Math.trunc(expiresAt - nowMs())));
        return {
            damage_flash_active: remainingMs > 0,
            damage_flash_remaining_ms: remainingMs,
            damage_flash_token: clampInteger(player?.damage_flash_token || 0, 0, 2147483647),
        };
    }
    function clearPlayerFishingPresence(player) {
        if (!player)
            return;
        player.fishing_active = false;
        player.fishing_target_x = -1;
        player.fishing_target_y = -1;
        player.fishing_lure_id = "";
        player.fishing_rod_id = "";
    }
    function applyPlayerFishingPresenceFromSession(player, session) {
        if (!player || !session) {
            clearPlayerFishingPresence(player);
            return false;
        }
        const targetX = Math.trunc(Number(session.target_x));
        const targetY = Math.trunc(Number(session.target_y));
        if (!isGridInWorld(targetX, targetY)) {
            clearPlayerFishingPresence(player);
            return false;
        }
        player.fishing_active = true;
        player.fishing_target_x = targetX;
        player.fishing_target_y = targetY;
        player.fishing_lure_id = clampString(session.lure_id || "");
        player.fishing_rod_id = clampString(session.rod_id || "");
        return true;
    }
    function refreshPlayerFishingPresence(player, worldName = "") {
        if (!player)
            return false;
        const session = activeFishingSessions.get(player.id);
        const clean = cleanWorld(worldName || player.world || "START");
        if (!session || session.world !== clean || nowMs() > Number(session.expires_at || 0)) {
            clearPlayerFishingPresence(player);
            return false;
        }
        return applyPlayerFishingPresenceFromSession(player, session);
    }
    function isValidRespawnTeleportPosition(player, position, data) {
        const reason = clampString(data?.position_reason || "").toLowerCase();
        if (data?.respawn_teleport !== true && reason !== "respawn")
            return false;
        const worldName = cleanWorld(position?.world || player?.world || "");
        if (worldName === "" || worldName !== cleanWorld(player?.world || ""))
            return false;
        const spawn = getEntranceGateSpawnForWorld(worldName)
            || getDefaultEntranceGateSpawnForWorld(worldName);
        if (!spawn)
            return false;
        const distance = Math.hypot(Number(position?.x) - Number(spawn.x), Number(position?.y) - Number(spawn.y));
        if (Number.isFinite(distance) && distance <= TILE_SIZE * 1.5)
            return true;
        const checkpoint = player?.respawn_checkpoint;
        if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint))
            return false;
        const checkpointWorld = cleanWorld(checkpoint.world || "");
        const checkpointX = Math.trunc(Number(checkpoint.x));
        const checkpointY = Math.trunc(Number(checkpoint.y));
        if (checkpointWorld !== worldName
            || !isGridInWorld(checkpointX, checkpointY)) {
            return false;
        }
        const state = ensureWorldState(worldName);
        const block = state?.foreground?.get?.(gridKey(checkpointX, checkpointY));
        if (!block || !isCheckpointBlockType(block.block_type))
            return false;
        const checkpointSpawn = getGridCenterPixels(checkpointX, checkpointY);
        const checkpointDistance = Math.hypot(Number(position?.x) - Number(checkpointSpawn.x), Number(position?.y) - Number(checkpointSpawn.y));
        return Number.isFinite(checkpointDistance)
            && checkpointDistance <= TILE_SIZE * 1.5;
    }
    function sendPlayerPositionCorrection(socket, player, position, reason, details = {}) {
        if (!socket || !player)
            return;
        const rejectedX = Number(position?.x);
        const rejectedY = Number(position?.y);
        const serverX = Number(player.x || 0);
        const serverY = Number(player.y || 0);
        const distance = Number.isFinite(rejectedX) && Number.isFinite(rejectedY)
            ? Math.hypot(rejectedX - serverX, rejectedY - serverY)
            : 0;
        const snap = hardSnapCorrectionReasons.has(reason)
            || distance >= MOVEMENT_CORRECTION_SNAP_DISTANCE;
        playerNetworkStats.corrected_player_position_messages += 1;
        sendActionRejected(socket, "player_position", "Server corrected your position.", {
            reason,
            position_correction: true,
            correction_reason: reason,
            correction_snap: snap,
            correction_smoothing_ms: snap ? 0 : MOVEMENT_CORRECTION_SMOOTH_MS,
            server_x: serverX,
            server_y: serverY,
            server_facing: Number(player.facing || 1) < 0 ? -1 : 1,
            server_world: cleanWorld(player.world || position?.world || "START"),
            server_velocity_x: sanitizePlayerVelocity(player.velocity_x || 0),
            server_velocity_y: sanitizePlayerVelocity(player.velocity_y || 0),
            server_on_floor: player.on_floor !== false,
            server_in_water: player.in_water === true,
            server_in_lava_fire: player.in_lava_fire === true,
            server_time_msec: nowMs(),
            accepted_sequence: Math.max(0, Math.trunc(Number(player.movement_sequence) || 0)),
            accepted_client_time_msec: Math.max(0, Math.trunc(Number(player.movement_client_time_msec) || 0)),
            rejected_sequence: sanitizeMovementSequence(details.data || {}),
            rejected_client_time_msec: sanitizeMovementClientTimeMsec(details.data || {}),
            distance: Math.round(distance),
            ...(details.extra && typeof details.extra === "object" && !Array.isArray(details.extra)
                ? details.extra
                : {}),
        });
    }
    function acceptPlayerMovement(socket, player, position, options = {}) {
        const silent = Boolean(options.silent);
        const respawnTeleport = Boolean(options.respawnTeleport);
        const now = nowMs();
        const data = options.data && typeof options.data === "object" && !Array.isArray(options.data)
            ? options.data
            : {};
        const lastAt = Number(player.last_position_at || 0);
        const sequence = sanitizeMovementSequence(data);
        const clientTimeMsec = sanitizeMovementClientTimeMsec(data);
        if (sequence > 0) {
            const lastSequence = Math.max(0, Math.trunc(Number(player.movement_sequence) || 0));
            if (lastSequence > 0 && !isMovementSequenceNewer(sequence, lastSequence)) {
                playerNetworkStats.stale_player_position_messages += 1;
                playerNetworkStats.rejected_player_position_messages += 1;
                if (!silent) {
                    debugNetfoxAction("ignored stale websocket movement sequence", {
                        player_id: String(player?.id || ""),
                        username: cleanAccountName(player?.account_username || player?.name || ""),
                        world: cleanWorld(position?.world || player?.world || "START"),
                        sequence,
                        last_sequence: lastSequence,
                    });
                }
                return false;
            }
        }
        else if (clientTimeMsec > 0) {
            const lastClientTime = Math.max(0, Math.trunc(Number(player.movement_client_time_msec) || 0));
            if (lastClientTime > 0 && clientTimeMsec <= lastClientTime) {
                playerNetworkStats.stale_player_position_messages += 1;
                playerNetworkStats.rejected_player_position_messages += 1;
                return false;
            }
        }
        if (!isPositionInWorldBounds(Number(position?.x), Number(position?.y))) {
            playerNetworkStats.rejected_player_position_messages += 1;
            if (!silent) {
                sendPlayerPositionCorrection(socket, player, position, "outside_world_bounds", { data });
            }
            return false;
        }
        const worldEntrySpawnCheck = checkPlayerWorldEntrySpawnGuard(player, position, now);
        if (worldEntrySpawnCheck.active) {
            if (!worldEntrySpawnCheck.accepted) {
                playerNetworkStats.rejected_player_position_messages += 1;
                if (!silent) {
                    sendPlayerPositionCorrection(socket, player, position, "world_entry_position_pending", { data });
                }
                return false;
            }
            clearPlayerWorldEntrySpawnGuard(player);
            commitAcceptedMovementTiming(player, data, now);
            return true;
        }
        if (respawnTeleport) {
            commitAcceptedMovementTiming(player, data, now);
            return true;
        }
        if (!lastAt || (isAdmin(player) && player.noclip_enabled)) {
            commitAcceptedMovementTiming(player, data, now);
            return true;
        }
        const elapsedSeconds = Math.max(Math.min((now - lastAt) / 1000, MOVEMENT_MAX_ELAPSED_SECONDS), 0.016);
        const reportedVelocityX = sanitizePlayerVelocity(data.velocity_x);
        const reportedVelocityY = sanitizePlayerVelocity(data.velocity_y);
        const reportedSpeed = Math.hypot(reportedVelocityX, reportedVelocityY);
        const expectedSpeed = Math.max(MAX_MOVE_PIXELS_PER_SECOND, reportedSpeed);
        let maxDistance = expectedSpeed * elapsedSeconds + MOVEMENT_DISTANCE_GRACE_PIXELS;
        const distance = Math.hypot(position.x - player.x, position.y - player.y);
        if (distance > maxDistance && isMovementNearLavaRebound(player, position)) {
            maxDistance += LAVA_REBOUND_MOVE_EXTRA_PIXELS;
        }
        if (distance > maxDistance) {
            playerNetworkStats.rejected_player_position_messages += 1;
            if (!silent) {
                sendPlayerPositionCorrection(socket, player, position, "movement_too_fast", {
                    data,
                    extra: {
                        max_distance: Math.round(maxDistance),
                    },
                });
            }
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(data, "velocity_x")
            || Object.prototype.hasOwnProperty.call(data, "velocity_y")) {
            const previousVelocityX = sanitizePlayerVelocity(player.velocity_x || 0);
            const previousVelocityY = sanitizePlayerVelocity(player.velocity_y || 0);
            const velocityDelta = Math.hypot(reportedVelocityX - previousVelocityX, reportedVelocityY - previousVelocityY);
            const maxVelocityDelta = MAX_MOVE_ACCEL_PIXELS_PER_SECOND2 * elapsedSeconds
                + MAX_MOVE_VELOCITY_DELTA_EXTRA;
            if (velocityDelta > maxVelocityDelta) {
                playerNetworkStats.rejected_player_position_messages += 1;
                if (!silent) {
                    sendPlayerPositionCorrection(socket, player, position, "movement_acceleration_too_high", {
                        data,
                        extra: {
                            velocity_delta: Math.round(velocityDelta),
                            max_velocity_delta: Math.round(maxVelocityDelta),
                        },
                    });
                }
                return false;
            }
        }
        const collision = getMovementCollisionAtPosition(position.world || player.world || "START", position);
        if (collision) {
            playerNetworkStats.rejected_player_position_messages += 1;
            if (!silent) {
                sendPlayerPositionCorrection(socket, player, position, "movement_blocked", {
                    data,
                    extra: collision,
                });
            }
            return false;
        }
        commitAcceptedMovementTiming(player, data, now);
        return true;
    }
    function buildPublicPlayerPresencePayload(type, player, worldName = "") {
        if (player)
            refreshPlayerFishingPresence(player, worldName || player.world || "");
        const now = nowMs();
        const equipmentSlots = player?.equipment_slots || {};
        const fishingTargetX = Number.isInteger(player?.fishing_target_x)
            ? player?.fishing_target_x
            : -1;
        const fishingTargetY = Number.isInteger(player?.fishing_target_y)
            ? player?.fishing_target_y
            : -1;
        const fishingActive = player?.fishing_active === true
            && isGridInWorld(fishingTargetX, fishingTargetY);
        const damageFlash = getPublicPlayerDamageFlash(player);
        const identity = getPublicPlayerIdentity(player);
        return {
            type,
            player_id: String(player?.id || ""),
            ...(identity && typeof identity === "object" && !Array.isArray(identity) ? identity : {}),
            x: Number(player?.x || 0),
            y: Number(player?.y || 0),
            facing: Number(player?.facing || 1),
            world: String(worldName || player?.world || ""),
            animation_state: String(player?.animation_state || "idle"),
            movement_sequence: Math.max(0, Math.trunc(Number(player?.movement_sequence) || 0)),
            server_time_msec: Math.max(0, Math.trunc(Number(player?.movement_server_time_msec) || now)),
            velocity_x: sanitizePlayerVelocity(player?.velocity_x || 0),
            velocity_y: sanitizePlayerVelocity(player?.velocity_y || 0),
            on_floor: player?.on_floor !== false,
            in_water: player?.in_water === true,
            in_lava_fire: player?.in_lava_fire === true,
            ...damageFlash,
            fishing_active: fishingActive,
            fishing_target_x: fishingActive ? fishingTargetX : -1,
            fishing_target_y: fishingActive ? fishingTargetY : -1,
            fishing_lure_id: fishingActive ? clampString(player?.fishing_lure_id || "") : "",
            fishing_rod_id: fishingActive ? clampString(player?.fishing_rod_id || "") : "",
            chat_typing: player?.chat_typing === true,
            equipment_slots: equipmentSlots,
            equipped_tool: clampString(equipmentSlots.hand || ""),
            equipped_back_item: clampString(equipmentSlots.back || ""),
            equipped_back: clampString(equipmentSlots.back || ""),
            equipped_hat_item: clampString(equipmentSlots.hat || ""),
            equipped_hair_item: clampString(equipmentSlots.hair || ""),
            equipped_eyewear_item: clampString(equipmentSlots.eyewear || ""),
            equipped_shirt_item: clampString(equipmentSlots.shirt || ""),
            equipped_pants_item: clampString(equipmentSlots.pants || ""),
            equipped_shoes_item: clampString(equipmentSlots.shoes || ""),
            equipped_ride_item: clampString(equipmentSlots.ride || ""),
        };
    }
    function getPlayerPresenceBroadcastSignature(payload = {}) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
            return "";
        return JSON.stringify({
            player_id: String(payload.player_id || ""),
            world: String(payload.world || ""),
            x: Number(payload.x || 0),
            y: Number(payload.y || 0),
            facing: Number(payload.facing || 1),
            animation_state: String(payload.animation_state || "idle"),
            velocity_x: sanitizePlayerVelocity(payload.velocity_x || 0),
            velocity_y: sanitizePlayerVelocity(payload.velocity_y || 0),
            on_floor: payload.on_floor === true,
            in_water: payload.in_water === true,
            in_lava_fire: payload.in_lava_fire === true,
            chat_typing: payload.chat_typing === true,
            damage_flash_active: payload.damage_flash_active === true,
            damage_flash_remaining_ms: clampInteger(payload.damage_flash_remaining_ms || 0, 0, MAX_DAMAGE_FLASH_MS),
            damage_flash_token: clampInteger(payload.damage_flash_token || 0, 0, 2147483647),
            fishing_active: payload.fishing_active === true,
            fishing_target_x: Number.isFinite(Number(payload.fishing_target_x))
                ? Math.trunc(Number(payload.fishing_target_x))
                : -1,
            fishing_target_y: Number.isFinite(Number(payload.fishing_target_y))
                ? Math.trunc(Number(payload.fishing_target_y))
                : -1,
            fishing_lure_id: clampString(payload.fishing_lure_id || ""),
            fishing_rod_id: clampString(payload.fishing_rod_id || ""),
            equipped_tool: clampString(payload.equipped_tool || ""),
            equipped_back_item: clampString(payload.equipped_back_item || ""),
            equipped_hat_item: clampString(payload.equipped_hat_item || ""),
            equipped_hair_item: clampString(payload.equipped_hair_item || ""),
            equipped_eyewear_item: clampString(payload.equipped_eyewear_item || ""),
            equipped_shirt_item: clampString(payload.equipped_shirt_item || ""),
            equipped_pants_item: clampString(payload.equipped_pants_item || ""),
            equipped_shoes_item: clampString(payload.equipped_shoes_item || ""),
            equipped_ride_item: clampString(payload.equipped_ride_item || ""),
        });
    }
    return {
        acceptPlayerMovement,
        applyPlayerFishingPresenceFromSession,
        buildPublicPlayerPresencePayload,
        clearPlayerFishingPresence,
        commitAcceptedMovementTiming,
        getPlayerPresenceBroadcastSignature,
        getPublicPlayerDamageFlash,
        isValidRespawnTeleportPosition,
        refreshPlayerFishingPresence,
        sanitizeMovementClientTimeMsec,
        sanitizeMovementSequence,
        sanitizePlayerAnimationState,
        sanitizePlayerDamageFlash,
        sanitizePlayerPosition,
        sanitizePlayerVelocity,
        sendPlayerPositionCorrection,
    };
}
module.exports = {
    createServerPhase11dStandardMovement,
};
