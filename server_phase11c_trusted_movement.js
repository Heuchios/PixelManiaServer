// Generated from src/server_phase11c_trusted_movement.ts. Do not edit by hand.
"use strict";
function createServerPhase11cTrustedMovement(deps) {
    const { ACTION_RATE_LIMIT_MS, CUSTOM_TRUSTED_PLAYER_STATE_ENABLED, LAVA_REBOUND_MOVE_EXTRA_PIXELS, MAX_MOVE_PIXELS_PER_SECOND, MAX_TRUSTED_POSITION_AGE_MS, MAX_TRUSTED_POSITION_AGE_MS_COMBAT, MAX_TRUSTED_POSITION_AGE_MS_WORLD_ACTION, MOVEMENT_MODE_CUSTOM_AUTHORITATIVE, MOVEMENT_MODE_NETFOX_REAL, MOVEMENT_MODE_WEBSOCKET, NETFOX_ACTION_DEBUG, NETFOX_MOVEMENT_ENABLED, NETFOX_TRUSTED_PLAYER_STATE_ENABLED, NETFOX_TRUSTED_POSITION_DEBUG, PacketContracts, TRUSTED_MOVEMENT_ALLOWLIST, TRUSTED_MOVEMENT_ALLOWLIST_ENABLED, TRUSTED_MOVEMENT_BASELINE_RESET_MS, TRUSTED_MOVEMENT_EXTRA_PIXELS, TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD, TRUSTED_MOVEMENT_SOFT_RESYNC_PIXELS, TRUSTED_MOVEMENT_SPEED_MULTIPLIER, WORLD_ENTRY_SPAWN_GUARD_MS, WORLD_ENTRY_SPAWN_TOLERANCE_PIXELS, cleanAccountName, cleanWorld, clampString, getMovementCollisionAtPosition, isAdmin, isMovementNearLavaRebound, isPositionInWorldBounds, isValidRespawnTeleportPosition, logSecurityEvent, normalizePhase7Reason, requireAuthenticated, requireSameWorld, sanitizeActionPositionPayload, sanitizePlayerPosition, sanitizePlayerVelocity, sendActionRejected, touchLivePresence, } = deps;
    const logger = deps.logger || console;
    const nowMs = typeof deps.nowMs === "function" ? deps.nowMs : () => Date.now();
    const netfoxPlayerStateRegistry = new Map();
    const netfoxPlayerStateRegistryByProfile = new Map();
    const netfoxPlayerStateRegistryByPeer = new Map();
    const netfoxPlayerStateRegistryBySession = new Map();
    const phase7TrustedPositionLoggedKeys = new Set();
    const phase7TrustedPositionLastLogMs = new Map();
    function getPlayerCurrentWorldName(player) {
        if (!player)
            return "START";
        return cleanWorld(player.current_world_id || player.current_world || player.world || "START");
    }
    function sanitizeMovementMode(value, fallback = MOVEMENT_MODE_WEBSOCKET) {
        const clean = String(value || "").trim().toUpperCase();
        if (clean === MOVEMENT_MODE_NETFOX_REAL)
            return MOVEMENT_MODE_NETFOX_REAL;
        if (clean === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE
            || clean === "CUSTOM_MOVEMENT"
            || clean === "CUSTOM_ENET") {
            return MOVEMENT_MODE_CUSTOM_AUTHORITATIVE;
        }
        if (clean === MOVEMENT_MODE_WEBSOCKET)
            return MOVEMENT_MODE_WEBSOCKET;
        return isTrustedMovementModeName(fallback)
            ? sanitizeMovementMode(fallback, MOVEMENT_MODE_WEBSOCKET)
            : MOVEMENT_MODE_WEBSOCKET;
    }
    function updatePlayerMovementModeFromPayload(player, data = {}) {
        if (!player || !data || typeof data !== "object" || Array.isArray(data))
            return;
        const rawMode = data.movement_mode || data.movementMode || data.mode || "";
        if (String(rawMode || "").trim() === "")
            return;
        player.movement_mode = sanitizeMovementMode(rawMode, player.movement_mode || MOVEMENT_MODE_WEBSOCKET);
    }
    function isNetfoxRealMode(player, _data = null) {
        return sanitizeMovementMode(player?.movement_mode || MOVEMENT_MODE_WEBSOCKET)
            === MOVEMENT_MODE_NETFOX_REAL;
    }
    function isCustomAuthoritativeMode(player, _data = null) {
        return sanitizeMovementMode(player?.movement_mode || MOVEMENT_MODE_WEBSOCKET)
            === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE;
    }
    function isTrustedMovementModeName(value) {
        const mode = String(value || "").trim().toUpperCase();
        return mode === MOVEMENT_MODE_NETFOX_REAL
            || mode === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE
            || mode === "CUSTOM_MOVEMENT"
            || mode === "CUSTOM_ENET";
    }
    function isPlayerTrustedMovementModeAllowed(player, movementMode) {
        const cleanMode = sanitizeMovementMode(movementMode, MOVEMENT_MODE_WEBSOCKET);
        if (!isTrustedMovementModeName(cleanMode))
            return false;
        if (!TRUSTED_MOVEMENT_ALLOWLIST_ENABLED)
            return false;
        if (!(TRUSTED_MOVEMENT_ALLOWLIST instanceof Set) || TRUSTED_MOVEMENT_ALLOWLIST.size === 0) {
            return false;
        }
        const username = String(player?.account_username || player?.name || "").trim().toLowerCase();
        if (username === "")
            return false;
        return TRUSTED_MOVEMENT_ALLOWLIST.has(username);
    }
    function usesTrustedMovementPosition(player) {
        return isNetfoxRealMode(player) || isCustomAuthoritativeMode(player);
    }
    function isTrustedMovementModeEnabled(mode, player = null) {
        const cleanMode = sanitizeMovementMode(mode, MOVEMENT_MODE_WEBSOCKET);
        if (cleanMode === MOVEMENT_MODE_NETFOX_REAL) {
            if (!NETFOX_MOVEMENT_ENABLED || !NETFOX_TRUSTED_PLAYER_STATE_ENABLED)
                return false;
        }
        else if (cleanMode === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE) {
            if (!CUSTOM_TRUSTED_PLAYER_STATE_ENABLED)
                return false;
        }
        else {
            return false;
        }
        return isPlayerTrustedMovementModeAllowed(player, cleanMode);
    }
    function getTrustedMovementModeRejectionReason(player, movementMode) {
        const cleanMode = sanitizeMovementMode(movementMode, MOVEMENT_MODE_WEBSOCKET);
        if (!isTrustedMovementModeName(cleanMode))
            return "trusted_movement_mode_disabled";
        if (cleanMode === MOVEMENT_MODE_NETFOX_REAL
            && (!NETFOX_MOVEMENT_ENABLED || !NETFOX_TRUSTED_PLAYER_STATE_ENABLED)) {
            return "trusted_movement_mode_disabled";
        }
        if (cleanMode === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE
            && !CUSTOM_TRUSTED_PLAYER_STATE_ENABLED) {
            return "trusted_movement_mode_disabled";
        }
        if (!TRUSTED_MOVEMENT_ALLOWLIST_ENABLED)
            return "trusted_movement_allowlist_disabled";
        if (!(TRUSTED_MOVEMENT_ALLOWLIST instanceof Set) || TRUSTED_MOVEMENT_ALLOWLIST.size === 0) {
            return "trusted_movement_allowlist_empty";
        }
        if (!isPlayerTrustedMovementModeAllowed(player, cleanMode)) {
            return "trusted_movement_not_allowlisted";
        }
        return false;
    }
    function getTrustedMovementModeLabel(player, data = null) {
        if (isCustomAuthoritativeMode(player, data))
            return MOVEMENT_MODE_CUSTOM_AUTHORITATIVE;
        if (isNetfoxRealMode(player, data))
            return MOVEMENT_MODE_NETFOX_REAL;
        return sanitizeMovementMode(player?.movement_mode || MOVEMENT_MODE_WEBSOCKET);
    }
    function getTrustedMovementSourceLabel(mode) {
        return sanitizeMovementMode(mode) === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE
            ? "custom_movement_server"
            : "netfox";
    }
    function getNetfoxStateKey(player) {
        return normalizeNetfoxProfileKey(player?.id || "");
    }
    function normalizeNetfoxProfileKey(value) {
        return String(value || "").trim();
    }
    function normalizeNetfoxPeerKey(value) {
        const peerId = Math.max(0, Math.trunc(Number(value) || 0));
        return peerId > 0 ? String(peerId) : "";
    }
    function normalizeOptionalNetfoxWorld(value) {
        const raw = String(value || "").trim();
        return raw === "" ? "" : cleanWorld(raw);
    }
    function clearNetfoxTrustedPlayerStateByKey(key) {
        const cleanKey = normalizeNetfoxProfileKey(key);
        if (cleanKey === "")
            return;
        const existingState = netfoxPlayerStateRegistry.get(cleanKey);
        netfoxPlayerStateRegistry.delete(cleanKey);
        if (!existingState)
            return;
        const profileKey = normalizeNetfoxProfileKey(existingState.game_player_id || existingState.player_id || cleanKey);
        if (profileKey !== "") {
            const indexedByProfile = netfoxPlayerStateRegistryByProfile.get(profileKey);
            if (!indexedByProfile || indexedByProfile.state_key === cleanKey) {
                netfoxPlayerStateRegistryByProfile.delete(profileKey);
            }
        }
        const peerKey = normalizeNetfoxPeerKey(existingState.peer_id);
        if (peerKey !== "") {
            const indexedByPeer = netfoxPlayerStateRegistryByPeer.get(peerKey);
            if (!indexedByPeer || indexedByPeer.state_key === cleanKey) {
                netfoxPlayerStateRegistryByPeer.delete(peerKey);
            }
        }
        const sessionKey = normalizeNetfoxProfileKey(existingState.session_id || "");
        if (sessionKey !== "") {
            const indexedBySession = netfoxPlayerStateRegistryBySession.get(sessionKey);
            if (!indexedBySession || indexedBySession.state_key === cleanKey) {
                netfoxPlayerStateRegistryBySession.delete(sessionKey);
            }
        }
    }
    function clearNetfoxTrustedPlayerState(player) {
        clearNetfoxTrustedPlayerStateByKey(getNetfoxStateKey(player));
    }
    function logPhase7TrustedPosition(state, reason = "update") {
        if (!state)
            return;
        const profileKey = normalizeNetfoxProfileKey(state.game_player_id || state.player_id || state.state_key || "");
        const peerKey = normalizeNetfoxPeerKey(state.peer_id);
        const worldName = cleanWorld(state.world || "");
        const logKey = `${profileKey}|${peerKey}|${worldName}`;
        if (profileKey === "" || peerKey === "")
            return;
        if (!NETFOX_TRUSTED_POSITION_DEBUG && phase7TrustedPositionLoggedKeys.has(logKey))
            return;
        if (NETFOX_TRUSTED_POSITION_DEBUG) {
            const now = nowMs();
            const lastLogMs = Number(phase7TrustedPositionLastLogMs.get(logKey) || 0);
            if (lastLogMs > 0 && now - lastLogMs < 1000)
                return;
            phase7TrustedPositionLastLogMs.set(logKey, now);
        }
        phase7TrustedPositionLoggedKeys.add(logKey);
        const ageMs = Math.max(0, Math.trunc(nowMs() - Number(state.updated_at || 0)));
        logger.log(`[Phase7TrustedPosition] profile=${profileKey} peer=${Number(peerKey)} `
            + `pos=(${Math.round(Number(state.x) || 0)},${Math.round(Number(state.y) || 0)}) `
            + `age_ms=${ageMs} world=${worldName} `
            + `username=${cleanAccountName(state.account_username || "")} reason=${reason}`);
    }
    function indexNetfoxTrustedPlayerState(player, state) {
        const stateKey = getNetfoxStateKey(player);
        if (stateKey === "")
            return;
        clearNetfoxTrustedPlayerStateByKey(stateKey);
        const profileKey = normalizeNetfoxProfileKey(state.game_player_id || state.player_id || stateKey);
        const peerKey = normalizeNetfoxPeerKey(state.peer_id);
        const sessionKey = normalizeNetfoxProfileKey(state.session_id || "");
        const indexedState = {
            ...state,
            state_key: stateKey,
            game_player_id: profileKey || stateKey,
            peer_id: peerKey === "" ? 0 : Number(peerKey),
        };
        netfoxPlayerStateRegistry.set(stateKey, indexedState);
        if (profileKey !== "")
            netfoxPlayerStateRegistryByProfile.set(profileKey, indexedState);
        if (peerKey !== "")
            netfoxPlayerStateRegistryByPeer.set(peerKey, indexedState);
        if (sessionKey !== "")
            netfoxPlayerStateRegistryBySession.set(sessionKey, indexedState);
        logPhase7TrustedPosition(indexedState, "update");
    }
    function debugNetfoxAction(message, details = {}) {
        if (!NETFOX_ACTION_DEBUG)
            return;
        logger.log("[NETFOX_ACTION]", message, details);
    }
    function enforceStandardMovementForSocket(socket, player, context = "movement") {
        const cleanMode = getTrustedMovementModeLabel(player);
        if (!isTrustedMovementModeName(cleanMode))
            return true;
        if (isTrustedMovementModeEnabled(cleanMode, player))
            return false;
        const now = nowMs();
        const reason = getTrustedMovementModeRejectionReason(player, cleanMode)
            || "trusted_movement_not_allowed";
        const allowlisted = isPlayerTrustedMovementModeAllowed(player, cleanMode);
        const username = cleanAccountName(player?.account_username || player?.name || "");
        const world = cleanWorld(player?.world || "START");
        player.movement_mode = MOVEMENT_MODE_WEBSOCKET;
        player.custom_peer_id = 0;
        player.custom_player_node_path = "";
        clearNetfoxTrustedPlayerState(player);
        clearTrustedMovementBaseline(player);
        if (now - Number(player.last_trusted_movement_enforced_at || 0) >= 5000) {
            player.last_trusted_movement_enforced_at = now;
            logSecurityEvent(socket, player, "trusted_movement_auto_demoted", {
                action: context,
                reason,
                previous_mode: cleanMode,
                movement_mode: MOVEMENT_MODE_WEBSOCKET,
                allowlist_enabled: TRUSTED_MOVEMENT_ALLOWLIST_ENABLED,
                allowlist_match: allowlisted,
                allowlist_count: TRUSTED_MOVEMENT_ALLOWLIST instanceof Set
                    ? TRUSTED_MOVEMENT_ALLOWLIST.size
                    : 0,
                world,
                username,
            }, "warning");
            logger.warn("[trusted_movement_auto_demoted]", {
                player_id: String(player?.id || ""),
                username,
                world,
                action: context,
                previous_mode: cleanMode,
                reason,
            });
        }
        sendActionRejected(socket, "movement_mode", "That movement mode is no longer enabled on this server.", {
            reason,
            previous_mode: cleanMode,
            action: context,
            world,
            fallback_mode: MOVEMENT_MODE_WEBSOCKET,
        });
        return true;
    }
    function rejectTrustedMovementMode(socket, player, movementMode, authAction, reason) {
        const cleanMode = sanitizeMovementMode(movementMode, MOVEMENT_MODE_WEBSOCKET);
        const allowlisted = isPlayerTrustedMovementModeAllowed(player, cleanMode);
        logSecurityEvent(socket, player, "trusted_movement_rejected", {
            action: authAction,
            reason,
            movement_mode: cleanMode,
            allowlist_enabled: TRUSTED_MOVEMENT_ALLOWLIST_ENABLED,
            allowlist_match: allowlisted,
            movement_mode_enabled: isTrustedMovementModeEnabled(cleanMode, player),
            allowlist_count: TRUSTED_MOVEMENT_ALLOWLIST instanceof Set
                ? TRUSTED_MOVEMENT_ALLOWLIST.size
                : 0,
        }, "warning");
        logger.warn("[trusted_movement_rejected]", {
            player_id: String(player?.id || ""),
            username: cleanAccountName(player?.account_username || player?.name || ""),
            world: cleanWorld(player?.world || "START"),
            movement_mode: cleanMode,
            action: authAction,
            reason,
        });
        sendActionRejected(socket, authAction, "That movement mode is not enabled on this server.", { reason, movement_mode: cleanMode });
    }
    function clearTrustedMovementBaseline(player) {
        if (!player)
            return;
        player.trusted_movement_baseline = null;
    }
    function getTrustedMovementBaseline(player) {
        const baseline = player?.trusted_movement_baseline;
        if (!baseline || typeof baseline !== "object" || Array.isArray(baseline))
            return null;
        const x = Number(baseline.x);
        const y = Number(baseline.y);
        const updatedAt = Number(baseline.updated_at);
        if (![x, y, updatedAt].every(Number.isFinite) || updatedAt <= 0)
            return null;
        return {
            x,
            y,
            world: cleanWorld(baseline.world || player?.world || "START"),
            peer_id: Math.max(0, Math.trunc(Number(baseline.peer_id) || 0)),
            tick: Math.max(0, Math.trunc(Number(baseline.tick) || 0)),
            updated_at: updatedAt,
            movement_mode: sanitizeMovementMode(baseline.movement_mode || player?.movement_mode || MOVEMENT_MODE_WEBSOCKET),
        };
    }
    function commitTrustedMovementBaseline(player, position, details = {}) {
        if (!player || !position)
            return;
        const now = Number.isFinite(Number(details.now)) ? Number(details.now) : nowMs();
        const peerId = Math.max(0, Math.trunc(Number(details.peer_id ?? details.peerId) || 0));
        const tick = Math.max(0, Math.trunc(Number(details.tick) || 0));
        const movementMode = sanitizeMovementMode(details.movement_mode
            || details.movementMode
            || player.movement_mode
            || MOVEMENT_MODE_WEBSOCKET);
        player.trusted_movement_baseline = {
            x: Number(position.x),
            y: Number(position.y),
            world: cleanWorld(position.world || getPlayerCurrentWorldName(player)),
            peer_id: peerId,
            tick,
            updated_at: now,
            movement_mode: movementMode,
        };
        player.last_position_at = now;
    }
    function clearPlayerWorldEntrySpawnGuard(player) {
        if (!player)
            return;
        delete player.world_entry_spawn_guard;
    }
    function setPlayerWorldEntrySpawnGuard(player, worldName, spawn, now = nowMs()) {
        clearPlayerWorldEntrySpawnGuard(player);
        if (!player || !spawn)
            return null;
        const world = cleanWorld(worldName || player.world || "");
        const x = Number(spawn.x);
        const y = Number(spawn.y);
        if (world === "" || !isPositionInWorldBounds(x, y))
            return null;
        const guard = {
            world,
            x,
            y,
            expires_at: now + WORLD_ENTRY_SPAWN_GUARD_MS,
        };
        player.world_entry_spawn_guard = guard;
        return guard;
    }
    function getPlayerWorldEntrySpawnGuard(player, worldName, now = nowMs()) {
        const guard = player?.world_entry_spawn_guard;
        if (!guard || typeof guard !== "object" || Array.isArray(guard))
            return null;
        const expectedWorld = cleanWorld(worldName || player?.world || "");
        const guardWorld = cleanWorld(guard.world || "");
        const x = Number(guard.x);
        const y = Number(guard.y);
        const expiresAt = Number(guard.expires_at);
        if (expectedWorld === ""
            || guardWorld !== expectedWorld
            || !isPositionInWorldBounds(x, y)
            || !Number.isFinite(expiresAt)
            || now > expiresAt) {
            clearPlayerWorldEntrySpawnGuard(player);
            return null;
        }
        return { world: guardWorld, x, y, expires_at: expiresAt };
    }
    function checkPlayerWorldEntrySpawnGuard(player, position, now = nowMs()) {
        const guard = getPlayerWorldEntrySpawnGuard(player, position?.world, now);
        if (!guard)
            return { active: false, accepted: false, distance: null, guard: null };
        const distance = Math.hypot(Number(position?.x) - guard.x, Number(position?.y) - guard.y);
        return {
            active: true,
            accepted: Number.isFinite(distance) && distance <= WORLD_ENTRY_SPAWN_TOLERANCE_PIXELS,
            distance: Number.isFinite(distance) ? distance : null,
            guard,
        };
    }
    function getTrustedMovementBaselineResetReason(player, position, data, movementMode, baseline, details = {}) {
        if (isAdmin(player) && player.noclip_enabled)
            return "admin_noclip";
        if (isValidRespawnTeleportPosition(player, position, data))
            return "respawn_teleport";
        if (!baseline)
            return "first_state";
        const now = Number.isFinite(Number(details.now)) ? Number(details.now) : nowMs();
        const peerId = Math.max(0, Math.trunc(Number(details.peer_id ?? details.peerId) || 0));
        const tick = Math.max(0, Math.trunc(Number(details.tick) || 0));
        const worldName = cleanWorld(position?.world || getPlayerCurrentWorldName(player));
        const baselineWorld = cleanWorld(baseline.world || "");
        if (baselineWorld !== worldName)
            return "world_changed";
        const baselineMode = sanitizeMovementMode(baseline.movement_mode || player?.movement_mode || MOVEMENT_MODE_WEBSOCKET);
        if (baselineMode !== movementMode)
            return "mode_changed";
        const baselinePeerId = Math.max(0, Math.trunc(Number(baseline.peer_id) || 0));
        if (peerId > 0 && baselinePeerId > 0 && peerId !== baselinePeerId)
            return "peer_changed";
        const baselineTick = Math.max(0, Math.trunc(Number(baseline.tick) || 0));
        if (tick > 0 && baselineTick > 0 && tick < baselineTick)
            return "tick_reset";
        const ageMs = now - Number(baseline.updated_at || 0);
        if (!Number.isFinite(ageMs) || ageMs > TRUSTED_MOVEMENT_BASELINE_RESET_MS) {
            return "stale_baseline";
        }
        return "";
    }
    function acceptTrustedMovementState(socket, player, position, data, movementMode, options = {}) {
        const now = Number.isFinite(Number(options.now)) ? Number(options.now) : nowMs();
        const peerId = Math.max(0, Math.trunc(Number(options.peer_id ?? options.peerId ?? data?.peer_id) || 0));
        const tick = Math.max(0, Math.trunc(Number(options.tick ?? data?.tick) || 0));
        const cleanMovementMode = sanitizeMovementMode(movementMode, MOVEMENT_MODE_WEBSOCKET);
        const worldEntrySpawnCheck = checkPlayerWorldEntrySpawnGuard(player, position, now);
        if (worldEntrySpawnCheck.active) {
            if (!worldEntrySpawnCheck.accepted) {
                return {
                    ok: false,
                    reason: "world_entry_position_pending",
                    distance: worldEntrySpawnCheck.distance,
                    max_distance: WORLD_ENTRY_SPAWN_TOLERANCE_PIXELS,
                    soft_resync_limit: WORLD_ENTRY_SPAWN_TOLERANCE_PIXELS,
                    now,
                };
            }
            clearPlayerWorldEntrySpawnGuard(player);
            commitTrustedMovementBaseline(player, position, {
                now,
                peer_id: peerId,
                tick,
                movement_mode: cleanMovementMode,
            });
            return { ok: true, reason: "world_entry_spawn", reset: true, now };
        }
        const baseline = getTrustedMovementBaseline(player);
        const resetReason = getTrustedMovementBaselineResetReason(player, position, data, cleanMovementMode, baseline, { now, peer_id: peerId, tick });
        if (resetReason !== "") {
            commitTrustedMovementBaseline(player, position, {
                now,
                peer_id: peerId,
                tick,
                movement_mode: cleanMovementMode,
            });
            debugNetfoxAction("trusted movement baseline reset", {
                player_id: String(player?.id || ""),
                username: cleanAccountName(player?.account_username || player?.name || ""),
                world: cleanWorld(position?.world || getPlayerCurrentWorldName(player)),
                movement_mode: cleanMovementMode,
                peer_id: peerId,
                tick,
                reason: resetReason,
            });
            return { ok: true, reason: resetReason, reset: true, now };
        }
        const elapsedSeconds = Math.max((now - Number(baseline?.updated_at || 0)) / 1000, 0.016);
        const distance = Math.hypot(Number(position.x) - Number(baseline?.x), Number(position.y) - Number(baseline?.y));
        const velocitySpeed = Math.hypot(sanitizePlayerVelocity(data?.velocity_x), sanitizePlayerVelocity(data?.velocity_y));
        const expectedSpeed = Math.max(MAX_MOVE_PIXELS_PER_SECOND, velocitySpeed);
        let maxDistance = expectedSpeed * elapsedSeconds * TRUSTED_MOVEMENT_SPEED_MULTIPLIER
            + TRUSTED_MOVEMENT_EXTRA_PIXELS;
        if (distance > maxDistance && isMovementNearLavaRebound(player, position)) {
            maxDistance += LAVA_REBOUND_MOVE_EXTRA_PIXELS;
        }
        const softResyncLimit = Math.max(maxDistance, TRUSTED_MOVEMENT_SOFT_RESYNC_PIXELS);
        if (!Number.isFinite(distance) || distance > softResyncLimit) {
            return {
                ok: false,
                reason: "trusted_movement_too_fast",
                distance: Number.isFinite(distance) ? distance : null,
                max_distance: Number.isFinite(maxDistance) ? maxDistance : null,
                soft_resync_limit: Number.isFinite(softResyncLimit) ? softResyncLimit : null,
                now,
            };
        }
        const trustedCollision = getMovementCollisionAtPosition(position.world || player?.world || "START", position);
        if (trustedCollision) {
            return {
                ok: false,
                reason: "trusted_movement_blocked",
                distance: Number.isFinite(distance) ? distance : null,
                max_distance: Number.isFinite(maxDistance) ? maxDistance : null,
                soft_resync_limit: Number.isFinite(softResyncLimit) ? softResyncLimit : null,
                collision: trustedCollision,
                now,
            };
        }
        const softResync = distance > maxDistance;
        commitTrustedMovementBaseline(player, position, {
            now,
            peer_id: peerId,
            tick,
            movement_mode: cleanMovementMode,
        });
        if (softResync) {
            debugNetfoxAction("trusted movement soft resync", {
                player_id: String(player?.id || ""),
                username: cleanAccountName(player?.account_username || player?.name || ""),
                world: cleanWorld(position?.world || getPlayerCurrentWorldName(player)),
                movement_mode: cleanMovementMode,
                distance: Math.round(distance),
                max_distance: Math.round(maxDistance),
                peer_id: peerId,
                tick,
            });
        }
        return {
            ok: true,
            reason: softResync ? "soft_resync" : "accepted",
            reset: softResync,
            distance,
            max_distance: maxDistance,
            now,
        };
    }
    function getTrustedPositionMaxAgeMs(action = "") {
        const normalizedAction = String(action || "").trim().toLowerCase();
        if (normalizedAction === "player_punch" || normalizedAction === "player_punch_target") {
            return MAX_TRUSTED_POSITION_AGE_MS_COMBAT;
        }
        if (normalizedAction.startsWith("world_block_")
            || normalizedAction === "world_interaction_update"
            || normalizedAction === "world_seed_update"
            || PacketContracts.isWorldDropTrustedPositionAction(normalizedAction)
            || normalizedAction === "door_enter") {
            return MAX_TRUSTED_POSITION_AGE_MS_WORLD_ACTION;
        }
        return MAX_TRUSTED_POSITION_AGE_MS;
    }
    function validateNetfoxTrustedPositionState(state, options = {}) {
        const action = String(options.action || "action");
        const expectedWorld = normalizeOptionalNetfoxWorld(options.world || "");
        const maxAgeMs = Math.max(50, Math.trunc(Number(getTrustedPositionMaxAgeMs(action)) || MAX_TRUSTED_POSITION_AGE_MS));
        if (!state || state.connected !== true || !isTrustedMovementModeName(state.movement_mode)) {
            return {
                ok: false,
                reason: "missing",
                action,
                expected_world: expectedWorld,
                max_age_ms: Number.isFinite(maxAgeMs)
                    ? Math.max(50, Math.trunc(maxAgeMs))
                    : MAX_TRUSTED_POSITION_AGE_MS,
            };
        }
        const ageMs = nowMs() - Number(state.updated_at || 0);
        if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) {
            return {
                ok: false,
                reason: "stale",
                action,
                expected_world: expectedWorld,
                age_ms: Number.isFinite(ageMs) ? Math.max(0, Math.trunc(ageMs)) : -1,
                max_age_ms: Number.isFinite(maxAgeMs)
                    ? Math.max(50, Math.trunc(maxAgeMs))
                    : MAX_TRUSTED_POSITION_AGE_MS,
            };
        }
        const stateWorld = cleanWorld(state.world || "");
        if (expectedWorld !== "" && stateWorld !== expectedWorld) {
            return {
                ok: false,
                reason: "wrong_world",
                action,
                expected_world: expectedWorld,
                state_world: stateWorld,
                max_age_ms: Number.isFinite(maxAgeMs)
                    ? Math.max(50, Math.trunc(maxAgeMs))
                    : MAX_TRUSTED_POSITION_AGE_MS,
            };
        }
        const x = Number(state.x);
        const y = Number(state.y);
        if (!isPositionInWorldBounds(x, y)) {
            return {
                ok: false,
                reason: "invalid_position",
                action,
                expected_world: expectedWorld,
                max_age_ms: Number.isFinite(maxAgeMs)
                    ? Math.max(50, Math.trunc(maxAgeMs))
                    : MAX_TRUSTED_POSITION_AGE_MS,
            };
        }
        return {
            ok: true,
            source: getTrustedMovementSourceLabel(state.movement_mode),
            action,
            movement_mode: sanitizeMovementMode(state.movement_mode),
            player_id: normalizeNetfoxProfileKey(state.player_id || state.state_key || ""),
            game_player_id: normalizeNetfoxProfileKey(state.game_player_id || state.player_id || state.state_key || ""),
            profile_id: normalizeNetfoxProfileKey(state.profile_id || ""),
            account_id: normalizeNetfoxProfileKey(state.account_id || ""),
            session_id: normalizeNetfoxProfileKey(state.session_id || ""),
            username: cleanAccountName(state.account_username || ""),
            peer_id: Number(state.peer_id || 0),
            player_node_path: clampString(state.player_node_path || ""),
            world: stateWorld,
            x,
            y,
            velocity_x: sanitizePlayerVelocity(state.velocity_x || 0),
            velocity_y: sanitizePlayerVelocity(state.velocity_y || 0),
            facing: Number(state.facing) < 0 ? -1 : 1,
            tick: Number(state.tick || 0),
            max_age_ms: Number.isFinite(maxAgeMs)
                ? Math.max(50, Math.trunc(maxAgeMs))
                : MAX_TRUSTED_POSITION_AGE_MS,
            age_ms: Math.max(0, Math.trunc(ageMs)),
        };
    }
    function get_trusted_position_for_profile(gamePlayerId, options = {}) {
        const profileKey = normalizeNetfoxProfileKey(gamePlayerId);
        const expectedWorld = normalizeOptionalNetfoxWorld(options.world || "");
        if (profileKey === "") {
            return {
                ok: false,
                reason: "missing_profile",
                action: String(options.action || "action"),
                expected_world: expectedWorld,
            };
        }
        return validateNetfoxTrustedPositionState(netfoxPlayerStateRegistryByProfile.get(profileKey), options);
    }
    function get_trusted_position_for_peer(peerId, options = {}) {
        const peerKey = normalizeNetfoxPeerKey(peerId);
        const expectedWorld = normalizeOptionalNetfoxWorld(options.world || "");
        if (peerKey === "") {
            return {
                ok: false,
                reason: "missing_peer",
                action: String(options.action || "action"),
                expected_world: expectedWorld,
            };
        }
        return validateNetfoxTrustedPositionState(netfoxPlayerStateRegistryByPeer.get(peerKey), options);
    }
    function get_trusted_position_for_session(sessionId, options = {}) {
        const sessionKey = normalizeNetfoxProfileKey(sessionId);
        const expectedWorld = normalizeOptionalNetfoxWorld(options.world || "");
        if (sessionKey === "") {
            return {
                ok: false,
                reason: "missing_session",
                action: String(options.action || "action"),
                expected_world: expectedWorld,
            };
        }
        return validateNetfoxTrustedPositionState(netfoxPlayerStateRegistryBySession.get(sessionKey), options);
    }
    function get_netfox_peer_for_profile(gamePlayerId, options = {}) {
        const trusted = get_trusted_position_for_profile(gamePlayerId, {
            ...options,
            action: options.action || "peer_lookup",
        });
        if (!trusted.ok)
            return trusted;
        return {
            ok: true,
            profile: trusted.game_player_id || trusted.player_id,
            peer_id: trusted.peer_id,
            world: trusted.world,
            age_ms: trusted.age_ms,
        };
    }
    function getNetfoxTrustedPlayerState(player, options = {}) {
        const key = getNetfoxStateKey(player);
        const expectedWorld = cleanWorld(options.world || getPlayerCurrentWorldName(player));
        if (key === "") {
            return {
                ok: false,
                reason: "missing_player",
                action: String(options.action || "action"),
                expected_world: expectedWorld,
            };
        }
        return get_trusted_position_for_profile(key, { ...options, world: expectedWorld });
    }
    function getPlayerValidationPosition(player, options = {}) {
        const worldName = cleanWorld(options.world || getPlayerCurrentWorldName(player));
        if (usesTrustedMovementPosition(player)) {
            return getNetfoxTrustedPlayerState(player, {
                action: options.action || "validation",
                world: worldName,
            });
        }
        const x = Number(player?.x);
        const y = Number(player?.y);
        if (!isPositionInWorldBounds(x, y)) {
            return {
                ok: false,
                reason: "invalid_position",
                source: "websocket",
                action: String(options.action || "validation"),
                world: worldName,
            };
        }
        return {
            ok: true,
            source: "websocket",
            action: String(options.action || "validation"),
            player_id: String(player?.id || ""),
            peer_id: 0,
            world: worldName,
            x,
            y,
            velocity_x: sanitizePlayerVelocity(player?.velocity_x || 0),
            velocity_y: sanitizePlayerVelocity(player?.velocity_y || 0),
            facing: Number(player?.facing || 1) < 0 ? -1 : 1,
            age_ms: 0,
        };
    }
    function rejectMissingTrustedPosition(socket, action, player, result, extra = {}) {
        const reason = String(result?.reason || "missing");
        const movementMode = getTrustedMovementModeLabel(player);
        const isCustom = movementMode === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE;
        const world = cleanWorld(extra.world || result?.expected_world || getPlayerCurrentWorldName(player));
        const maxAgeMs = Number.isFinite(Number(result?.max_age_ms))
            ? Math.max(50, Math.trunc(Number(result.max_age_ms)))
            : null;
        const message = reason === "stale"
            ? (isCustom
                ? "Your custom movement position is stale. Try again."
                : "Your Netfox position is stale. Try again.")
            : (isCustom
                ? "Your custom movement position is not ready yet."
                : "Your Netfox position is not ready yet.");
        let payloadReason = `${isCustom ? "custom_position" : "netfox_position"}_${reason}`;
        if (isCustom && reason === "stale") {
            payloadReason = "stale_position";
        }
        else if (isCustom && reason === "wrong_world") {
            payloadReason = "player_not_in_world";
        }
        sendActionRejected(socket, action, message, {
            reason: payloadReason,
            movement_mode: movementMode,
            player_id: String(player?.id || ""),
            world,
            age_ms: result?.age_ms,
            max_age_ms: maxAgeMs,
            ...extra,
        });
        if (reason !== "missing") {
            logSecurityEvent(socket, player, isCustom ? "custom_trusted_position_reject" : "netfox_trusted_position_reject", {
                action: String(action || ""),
                player_id: String(player?.id || ""),
                account_username: cleanAccountName(player?.account_username || player?.name || ""),
                movement_mode: movementMode,
                expected_world: cleanWorld(result?.expected_world || ""),
                state_world: cleanWorld(extra.world || getPlayerCurrentWorldName(player)),
                actual_world: world,
                trust_reason: reason,
                threshold_ms: maxAgeMs,
                age_ms: Number.isFinite(Number(result?.age_ms))
                    ? Math.max(0, Math.trunc(Number(result?.age_ms)))
                    : null,
                payload_reason: payloadReason,
                ...extra,
            }, "warning");
        }
    }
    function validateNetfoxActionCooldown(socket, player, action, data = null) {
        if (!usesTrustedMovementPosition(player))
            return true;
        if (ACTION_RATE_LIMIT_MS <= 0 || isAdmin(player))
            return true;
        if (!(player.last_action_at_by_type instanceof Map)) {
            player.last_action_at_by_type = new Map();
        }
        const key = String(action || "action");
        const now = nowMs();
        const lastAt = Number(player.last_action_at_by_type.get(key) || 0);
        if (lastAt > 0 && now - lastAt < ACTION_RATE_LIMIT_MS) {
            sendActionRejected(socket, key, "Slow down a little.", {
                reason: "rate_limited",
                movement_mode: getTrustedMovementModeLabel(player, data),
                cooldown_ms: ACTION_RATE_LIMIT_MS,
            });
            return false;
        }
        player.last_action_at_by_type.set(key, now);
        return true;
    }
    function handleTrustedMovementPlayerStateClear(socket, player, data, movementMode, authAction) {
        if (!requireAuthenticated(socket, player, authAction))
            return;
        const cleanMovementMode = sanitizeMovementMode(movementMode, MOVEMENT_MODE_WEBSOCKET);
        if (!isTrustedMovementModeName(cleanMovementMode))
            return;
        const rejectionReason = getTrustedMovementModeRejectionReason(player, cleanMovementMode);
        if (rejectionReason) {
            rejectTrustedMovementMode(socket, player, cleanMovementMode, authAction, rejectionReason);
            return;
        }
        if (TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD && !player.joined_world) {
            rejectTrustedMovementMode(socket, player, cleanMovementMode, authAction, "trusted_movement_world_not_joined");
            return;
        }
        updatePlayerMovementModeFromPayload(player, { movement_mode: cleanMovementMode });
        const oldState = netfoxPlayerStateRegistry.get(getNetfoxStateKey(player));
        clearNetfoxTrustedPlayerState(player);
        clearTrustedMovementBaseline(player);
        if (cleanMovementMode === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE) {
            player.custom_peer_id = 0;
            player.custom_player_node_path = "";
        }
        const peerId = Math.max(0, Math.trunc(Number(data.peer_id || oldState?.peer_id || 0)));
        const worldName = cleanWorld(data.world || oldState?.world || getPlayerCurrentWorldName(player));
        const reason = normalizePhase7Reason(data.reason || "clear");
        logger.log(`[PhaseI] trusted_position_cleared `
            + `username=${cleanAccountName(player?.account_username || player?.name || "")} `
            + `profile=${getNetfoxStateKey(player)} world=${worldName} peer=${peerId} `
            + `reason=${reason} movement_mode=${cleanMovementMode}`);
        logSecurityEvent(socket, player, "trusted_movement_mode_cleared", {
            reason: "clear",
            movement_mode: cleanMovementMode,
            world: worldName,
            peer_id: peerId,
        }, "info");
        touchLivePresence(socket, player);
    }
    function handleTrustedMovementPlayerState(socket, player, data, movementMode, authAction) {
        if (!requireAuthenticated(socket, player, authAction))
            return;
        const cleanMovementMode = sanitizeMovementMode(movementMode, MOVEMENT_MODE_WEBSOCKET);
        if (!isTrustedMovementModeName(cleanMovementMode))
            return;
        const rejectionReason = getTrustedMovementModeRejectionReason(player, cleanMovementMode);
        if (rejectionReason) {
            rejectTrustedMovementMode(socket, player, cleanMovementMode, authAction, rejectionReason);
            return;
        }
        if (TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD && !player.joined_world) {
            rejectTrustedMovementMode(socket, player, cleanMovementMode, authAction, "trusted_movement_world_not_joined");
            return;
        }
        // Captured before the update so the audit log below can fire only on a real transition.
        const previousMovementMode = String(player.movement_mode || "");
        updatePlayerMovementModeFromPayload(player, { movement_mode: cleanMovementMode });
        const position = sanitizePlayerPosition({
            x: data.x,
            y: data.y,
            facing: data.facing_dir ?? data.facing,
            world: data.world || player.world || "START",
            in_water: data.in_water === true,
            in_lava_fire: data.in_lava_fire === true,
        }, player);
        if (!position) {
            debugNetfoxAction("rejected trusted state: invalid position", {
                player_id: String(player?.id || ""),
                world: cleanWorld(data?.world || player?.world || "START"),
                movement_mode: cleanMovementMode,
            });
            return;
        }
        if (!requireSameWorld(socket, player, position.world, authAction))
            return;
        const peerId = Math.max(0, Math.trunc(Number(data.peer_id) || 0));
        const tick = Math.max(0, Math.trunc(Number(data.tick) || 0));
        const movementCheck = acceptTrustedMovementState(socket, player, position, data, cleanMovementMode, { peer_id: peerId, tick });
        if (!movementCheck.ok) {
            debugNetfoxAction("rejected trusted state: movement sanity check failed", {
                player_id: String(player?.id || ""),
                username: cleanAccountName(player?.account_username || player?.name || ""),
                world: position.world,
                movement_mode: cleanMovementMode,
                x: Math.round(Number(position.x) || 0),
                y: Math.round(Number(position.y) || 0),
                reason: movementCheck.reason,
                distance: movementCheck.distance == null
                    ? null
                    : Math.round(Number(movementCheck.distance) || 0),
                max_distance: movementCheck.max_distance == null
                    ? null
                    : Math.round(Number(movementCheck.max_distance) || 0),
                soft_resync_limit: movementCheck.soft_resync_limit == null
                    ? null
                    : Math.round(Number(movementCheck.soft_resync_limit) || 0),
            });
            return;
        }
        const now = Number(movementCheck.now || nowMs());
        const backendProfileId = getNetfoxStateKey(player);
        const playerNodePath = clampString(data.player_node_path || data.node_path || data.custom_player_node_path || "");
        const state = {
            player_id: backendProfileId,
            game_player_id: backendProfileId,
            account_id: cleanAccountName(player.account_id || ""),
            profile_id: cleanAccountName(player.profile_id || ""),
            session_id: String(socket?.playerId || player?.id || ""),
            account_username: cleanAccountName(player.account_username || player.name || ""),
            peer_id: peerId,
            player_node_path: playerNodePath,
            world: cleanWorld(position.world),
            x: position.x,
            y: position.y,
            velocity_x: sanitizePlayerVelocity(data.velocity_x),
            velocity_y: sanitizePlayerVelocity(data.velocity_y),
            facing: position.facing,
            tick,
            updated_at: now,
            connected: true,
            movement_mode: cleanMovementMode,
        };
        indexNetfoxTrustedPlayerState(player, state);
        player.netfox_peer_id = peerId;
        player.custom_peer_id = cleanMovementMode === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE
            ? peerId
            : Number(player.custom_peer_id || 0);
        player.custom_player_node_path = cleanMovementMode === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE
            ? playerNodePath
            : String(player.custom_player_node_path || "");
        player.x = state.x;
        player.y = state.y;
        player.facing = state.facing;
        player.velocity_x = state.velocity_x;
        player.velocity_y = state.velocity_y;
        player.in_water = position.in_water === true;
        player.in_lava_fire = position.in_lava_fire === true;
        // This used to run on EVERY accepted trusted-movement packet. logSecurityEvent does a
        // blocking mkdirSync, a crypto.randomBytes, a JSON.stringify + file append, AND
        // postgresStore.mirrorSecurityEvent, which opens a transaction of ~5-6 statements. At
        // 500 players sending 20Hz that is ~10k blocking syscalls and ~50k SQL statements per
        // second for a field that almost never changes. Emit it only on an actual mode
        // transition; steady-state position updates are not a security event.
        if (previousMovementMode !== cleanMovementMode) {
            logSecurityEvent(socket, player, "trusted_movement_mode_set", {
                reason: "state_update",
                movement_mode: cleanMovementMode,
                world: state.world,
                peer_id: peerId,
                tick,
            }, "info");
        }
        debugNetfoxAction("trusted state updated", {
            player_id: state.player_id,
            peer_id: state.peer_id,
            username: state.account_username,
            world: state.world,
            x: Math.round(state.x),
            y: Math.round(state.y),
            facing: state.facing,
            tick: state.tick,
            movement_mode: cleanMovementMode,
            player_node_path: playerNodePath,
        });
        touchLivePresence(socket, player);
    }
    function handleNetfoxTrustedPlayerState(socket, player, data) {
        handleTrustedMovementPlayerState(socket, player, data, MOVEMENT_MODE_NETFOX_REAL, "sync Netfox movement");
    }
    function handleCustomTrustedPlayerState(socket, player, data) {
        handleTrustedMovementPlayerState(socket, player, data, MOVEMENT_MODE_CUSTOM_AUTHORITATIVE, "sync custom movement");
    }
    function handleCustomTrustedPlayerStateClear(socket, player, data) {
        handleTrustedMovementPlayerStateClear(socket, player, data, MOVEMENT_MODE_CUSTOM_AUTHORITATIVE, "clear custom movement");
    }
    function applyTrustedActionPositionFromPayload(socket, player, data, fallbackWorld = "") {
        if (!player || !player.authenticated)
            return false;
        if (!usesTrustedMovementPosition(player))
            return false;
        const movementMode = getTrustedMovementModeLabel(player, data);
        if (getTrustedMovementModeRejectionReason(player, movementMode))
            return false;
        if (TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD && !player.joined_world)
            return false;
        const position = sanitizeActionPositionPayload(data, player, fallbackWorld);
        if (!position)
            return false;
        const peerId = Math.max(0, Math.trunc(Number(data.actor_peer_id
            ?? data.player_peer_id
            ?? data.peer_id
            ?? (movementMode === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE
                ? player.custom_peer_id
                : player.netfox_peer_id)
            ?? 0) || 0));
        const tick = Math.max(0, Math.trunc(Number(data.actor_tick ?? data.player_tick ?? data.tick ?? 0) || 0));
        const movementData = {
            ...data,
            velocity_x: data.actor_velocity_x ?? data.player_velocity_x ?? data.velocity_x ?? 0,
            velocity_y: data.actor_velocity_y ?? data.player_velocity_y ?? data.velocity_y ?? 0,
        };
        const movementCheck = acceptTrustedMovementState(socket, player, position, movementData, movementMode, { peer_id: peerId, tick });
        if (!movementCheck.ok) {
            debugNetfoxAction("rejected trusted action position: movement sanity check failed", {
                player_id: String(player?.id || ""),
                username: cleanAccountName(player?.account_username || player?.name || ""),
                action: String(data?.type || data?.action || "action_position"),
                world: position.world,
                movement_mode: movementMode,
                x: Math.round(Number(position.x) || 0),
                y: Math.round(Number(position.y) || 0),
                reason: movementCheck.reason,
                distance: movementCheck.distance == null
                    ? null
                    : Math.round(Number(movementCheck.distance) || 0),
                max_distance: movementCheck.max_distance == null
                    ? null
                    : Math.round(Number(movementCheck.max_distance) || 0),
                soft_resync_limit: movementCheck.soft_resync_limit == null
                    ? null
                    : Math.round(Number(movementCheck.soft_resync_limit) || 0),
            });
            return false;
        }
        const now = Number(movementCheck.now || nowMs());
        const backendProfileId = getNetfoxStateKey(player);
        const playerNodePath = clampString(data.actor_player_node_path
            || data.player_node_path
            || data.node_path
            || data.custom_player_node_path
            || "");
        const state = {
            player_id: backendProfileId,
            game_player_id: backendProfileId,
            account_id: cleanAccountName(player.account_id || ""),
            profile_id: cleanAccountName(player.profile_id || ""),
            session_id: String(socket?.playerId || player?.id || ""),
            account_username: cleanAccountName(player.account_username || player.name || ""),
            peer_id: peerId,
            player_node_path: playerNodePath,
            world: cleanWorld(position.world),
            x: position.x,
            y: position.y,
            velocity_x: sanitizePlayerVelocity(movementData.velocity_x),
            velocity_y: sanitizePlayerVelocity(movementData.velocity_y),
            facing: position.facing,
            tick,
            updated_at: now,
            connected: true,
            movement_mode: movementMode,
        };
        indexNetfoxTrustedPlayerState(player, state);
        player.netfox_peer_id = movementMode === MOVEMENT_MODE_NETFOX_REAL
            ? peerId
            : Number(player.netfox_peer_id || 0);
        player.custom_peer_id = movementMode === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE
            ? peerId
            : Number(player.custom_peer_id || 0);
        player.custom_player_node_path = movementMode === MOVEMENT_MODE_CUSTOM_AUTHORITATIVE
            ? playerNodePath
            : String(player.custom_player_node_path || "");
        player.x = state.x;
        player.y = state.y;
        player.facing = state.facing;
        player.velocity_x = state.velocity_x;
        player.velocity_y = state.velocity_y;
        player.in_water = position.in_water === true;
        player.in_lava_fire = position.in_lava_fire === true;
        return true;
    }
    function resetPlayerMovementTracking(player, now = nowMs()) {
        if (!player)
            return;
        clearPlayerWorldEntrySpawnGuard(player);
        player.last_position_at = now;
        player.movement_sequence = 0;
        player.movement_client_time_msec = 0;
        player.movement_server_time_msec = now;
    }
    function getRegistryStats() {
        return {
            state_count: netfoxPlayerStateRegistry.size,
            profile_count: netfoxPlayerStateRegistryByProfile.size,
            peer_count: netfoxPlayerStateRegistryByPeer.size,
            session_count: netfoxPlayerStateRegistryBySession.size,
        };
    }
    return {
        acceptTrustedMovementState,
        applyTrustedActionPositionFromPayload,
        checkPlayerWorldEntrySpawnGuard,
        clearNetfoxTrustedPlayerState,
        clearNetfoxTrustedPlayerStateByKey,
        clearPlayerWorldEntrySpawnGuard,
        clearTrustedMovementBaseline,
        commitTrustedMovementBaseline,
        debugNetfoxAction,
        enforceStandardMovementForSocket,
        get_netfox_peer_for_profile,
        get_trusted_position_for_peer,
        get_trusted_position_for_profile,
        get_trusted_position_for_session,
        getNetfoxStateKey,
        getNetfoxTrustedPlayerState,
        getPlayerValidationPosition,
        getPlayerWorldEntrySpawnGuard,
        getRegistryStats,
        getTrustedMovementBaseline,
        getTrustedMovementBaselineResetReason,
        getTrustedMovementModeLabel,
        getTrustedMovementModeRejectionReason,
        getTrustedMovementSourceLabel,
        getTrustedPositionMaxAgeMs,
        handleCustomTrustedPlayerState,
        handleCustomTrustedPlayerStateClear,
        handleNetfoxTrustedPlayerState,
        handleTrustedMovementPlayerState,
        handleTrustedMovementPlayerStateClear,
        indexNetfoxTrustedPlayerState,
        isCustomAuthoritativeMode,
        isNetfoxRealMode,
        isPlayerTrustedMovementModeAllowed,
        isTrustedMovementModeEnabled,
        isTrustedMovementModeName,
        logPhase7TrustedPosition,
        normalizeNetfoxPeerKey,
        normalizeNetfoxProfileKey,
        normalizeOptionalNetfoxWorld,
        rejectMissingTrustedPosition,
        rejectTrustedMovementMode,
        resetPlayerMovementTracking,
        sanitizeMovementMode,
        setPlayerWorldEntrySpawnGuard,
        updatePlayerMovementModeFromPayload,
        usesTrustedMovementPosition,
        validateNetfoxActionCooldown,
        validateNetfoxTrustedPositionState,
    };
}
module.exports = {
    createServerPhase11cTrustedMovement,
};
