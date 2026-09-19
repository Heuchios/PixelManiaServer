// Generated from src/server_socket_delivery_helpers.ts. Do not edit by hand.
"use strict";
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function cleanDetails(details) {
    return isRecord(details) ? details : {};
}
function cleanPacketArray(value) {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}
function getErrorMessage(error) {
    return error && typeof error === "object" && "message" in error
        ? String(error.message || error)
        : String(error);
}
// Packet types that are safe to discard when a socket is backpressured, because the very
// next tick re-sends the full current value. Presence batches also keep their own
// coalescing retry queue (see flushPendingPlayerPositionBatch). Every other packet carries
// state the client cannot rebuild on its own -- authoritative block/seed placements,
// inventory deltas, action rejections -- so it must never be dropped silently.
const DEFAULT_DROPPABLE_PACKET_TYPES = ["player_position_batch"];
const EQUIPMENT_ALIASES = ["equipped_tool", "equipped_back_item", "equipped_back", "equipped_hat_item",
    "equipped_hair_item", "equipped_eyewear_item", "equipped_beard_item", "equipped_body_accessory_item",
    "equipped_shirt_item", "equipped_pants_item", "equipped_shoes_item", "equipped_ride_item"];
// Batch-capable clients already read equipment_slots preferentially. Keep a full
// snapshot on EVERY tick (including empty slots/unequips); remove only its legacy
// duplicate aliases. This needs no receiver cache and survives backpressure.
function compactMovementBatch(payload) {
    if (!Array.isArray(payload.players))
        return payload;
    return { ...payload, players: payload.players.map((item) => {
            if (!isRecord(item) || !isRecord(item.equipment_slots))
                return item;
            const compact = { ...item };
            for (const key of EQUIPMENT_ALIASES)
                delete compact[key];
            return compact;
        }) };
}
// Stateless column encoding: every row is still a complete authoritative
// presence snapshot. No receiver baseline, delta cache or precision loss.
function encodeMovementColumns(payload) {
    const players = payload.players;
    if (!Array.isArray(players) || players.length < 3 || players.length > 128 || !isRecord(players[0]))
        return payload;
    const fields = Object.keys(players[0]);
    if (fields.length === 0 || fields.length > 64 || fields.some(key => key.length > 64))
        return payload;
    const rows = [];
    for (const player of players) {
        if (!isRecord(player))
            return payload;
        const keys = Object.keys(player);
        // Keep heterogeneous/legacy payloads intact, including absent-vs-null fields.
        if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index]))
            return payload;
        const row = fields.map(key => player[key]);
        if (row.some(value => value === undefined || typeof value === "function" || typeof value === "symbol"))
            return payload;
        rows.push(row);
    }
    const encoded = { ...payload, player_fields: fields, player_rows: rows };
    delete encoded.players;
    return encoded;
}
function createServerSocketDeliveryHelpers(config) {
    const droppablePacketTypes = new Set((Array.isArray(config.droppablePacketTypes) && config.droppablePacketTypes.length > 0
        ? config.droppablePacketTypes
        : DEFAULT_DROPPABLE_PACKET_TYPES)
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => value !== ""));
    // Always strictly above the soft limit: if the two collapsed together, the first
    // authoritative packet past the soft limit would disconnect the client instead of being
    // queued, turning a brief stall into a dropped connection.
    const criticalMaxBufferedAmount = Math.max(config.maxBufferedAmount * 2, Math.trunc(Number(config.criticalMaxBufferedAmount) || 0) || config.maxBufferedAmount * 4);
    function isDroppablePacketType(messageType) {
        const key = String(messageType || "").trim().toLowerCase();
        if (key === "")
            return false;
        return droppablePacketTypes.has(key);
    }
    function isSocketOpen(socket) {
        return Boolean(socket && socket.readyState === config.websocketOpenState);
    }
    // A socket this far behind is not draining at all. Queueing more authoritative state
    // would grow without bound, so drop the connection instead: the client reconnects and
    // re-enters the world, which resyncs world state and inventory from PostgreSQL. That is
    // recoverable; a silently discarded placement echo is not.
    function disconnectBackpressuredSocket(socket) {
        if (!socket || socket._backpressureDisconnected === true)
            return;
        socket._backpressureDisconnected = true;
        config.playerNetworkStats.outbound_backpressure_disconnects += 1;
        try {
            if (typeof socket.terminate === "function")
                socket.terminate();
            else if (typeof socket.close === "function")
                socket.close(1013, "backpressure");
        }
        catch (error) {
            config.warn("[socket_backpressure_close_error]", {
                player_id: String(socket?.playerId || ""),
                message: getErrorMessage(error),
            });
        }
    }
    function getSocketBufferedAmount(socket) {
        const amount = Number(socket?.bufferedAmount || 0);
        return Number.isFinite(amount) ? amount : 0;
    }
    function shouldLogSocketBackpressure(socket) {
        const now = Date.now();
        const previous = Number(socket?._lastBackpressureWarningAt || 0);
        if (now - previous < 5000)
            return false;
        if (socket)
            socket._lastBackpressureWarningAt = now;
        return true;
    }
    function shouldLogSocketPacketWarning(socket, warningKey, minGapMs = 10000) {
        if (!socket)
            return false;
        const now = Date.now();
        const map = socket._lastPacketWarningAt || {};
        const key = String(warningKey || "socket_packet").trim() || "socket_packet";
        const previous = Number(map[key] || 0);
        if (now - previous < minGapMs)
            return false;
        map[key] = now;
        socket._lastPacketWarningAt = map;
        return true;
    }
    function sendRawJsonToSocket(socket, raw, context = "send", details = {}) {
        if (!isSocketOpen(socket))
            return false;
        const rawLength = config.getRawLength(raw);
        const safeDetails = cleanDetails(details);
        const detailsMessageType = String(safeDetails.message_type || "").trim();
        config.recordPacketTypeSize("outbound", config.normalizePacketTypeName(detailsMessageType || context || "send"), rawLength);
        config.playerNetworkStats.outbound_packets_attempted += 1;
        config.playerNetworkStats.outbound_bytes_sent += Math.max(0, Math.trunc(rawLength || 0));
        if (rawLength > config.maxPacketBytes) {
            config.playerNetworkStats.outbound_oversize_packets += 1;
            if (shouldLogSocketPacketWarning(socket, "outbound_oversize")) {
                config.warn("[socket_oversize_send]", {
                    context,
                    player_id: String(socket?.playerId || ""),
                    packet_bytes: rawLength,
                    max_packet_bytes: config.maxPacketBytes,
                    ...safeDetails,
                });
            }
        }
        const bufferedAmount = getSocketBufferedAmount(socket);
        if (bufferedAmount > config.maxBufferedAmount) {
            const messageType = config.normalizePacketTypeName(detailsMessageType || context || "send");
            if (isDroppablePacketType(messageType)) {
                config.playerNetworkStats.outbound_backpressure_skips += 1;
                if (shouldLogSocketBackpressure(socket)) {
                    config.warn("[socket_backpressure_skip]", {
                        context,
                        message_type: messageType,
                        player_id: String(socket?.playerId || ""),
                        buffered_amount: bufferedAmount,
                        limit: config.maxBufferedAmount,
                        ...safeDetails,
                    });
                }
                return false;
            }
            if (bufferedAmount > criticalMaxBufferedAmount) {
                config.warn("[socket_backpressure_disconnect]", {
                    context,
                    message_type: messageType,
                    player_id: String(socket?.playerId || ""),
                    buffered_amount: bufferedAmount,
                    limit: criticalMaxBufferedAmount,
                    ...safeDetails,
                });
                disconnectBackpressuredSocket(socket);
                return false;
            }
            // Hand it to the WebSocket layer anyway: it queues in order and delivers once the
            // client drains. Dropping it here is what left clients charged for a block or seed
            // that never appeared on their screen.
            config.playerNetworkStats.outbound_backpressure_forced += 1;
            if (shouldLogSocketBackpressure(socket)) {
                config.warn("[socket_backpressure_queued]", {
                    context,
                    message_type: messageType,
                    player_id: String(socket?.playerId || ""),
                    buffered_amount: bufferedAmount,
                    limit: config.maxBufferedAmount,
                    hard_limit: criticalMaxBufferedAmount,
                    ...safeDetails,
                });
            }
        }
        try {
            socket?.send(raw);
            return true;
        }
        catch (error) {
            config.playerNetworkStats.outbound_send_failures += 1;
            config.warn("[socket_send_error]", {
                context,
                player_id: String(socket?.playerId || ""),
                message: getErrorMessage(error),
                ...safeDetails,
            });
            return false;
        }
    }
    function sendJson(socket, payload) {
        if (!isSocketOpen(socket))
            return false;
        let raw;
        try {
            raw = JSON.stringify(socket?.movementBatchColumns === true && isRecord(payload) && payload.type === "player_position_batch"
                ? encodeMovementColumns(payload) : payload);
        }
        catch (error) {
            config.warn("[socket_serialize_error]", getErrorMessage(error));
            return false;
        }
        return sendRawJsonToSocket(socket, raw, "direct_send", {
            message_type: isRecord(payload) ? String(payload.type || "") : "",
        });
    }
    function getPresenceItemKey(state, item, prefix) {
        const stableKey = String(item.player_id || item.id || item.account_username || "").trim();
        if (stableKey !== "")
            return stableKey;
        state.sequence += 1;
        return `${prefix}:anonymous:${state.sequence}`;
    }
    function countMovementItems(state) {
        return state.players.size + state.left.size;
    }
    function removeMovementState(socket, countDropped) {
        const state = socket._movementDeliveryState;
        if (!state)
            return;
        if (state.retryTimer)
            clearTimeout(state.retryTimer);
        if (countDropped) {
            config.playerNetworkStats.movement_backpressure_dropped_items += countMovementItems(state);
        }
        delete socket._movementDeliveryState;
    }
    function clearPlayerPositionDeliveryState(socket) {
        if (socket)
            removeMovementState(socket, true);
    }
    function getOrCreateMovementState(socket, payload, maxItems) {
        const world = String(payload.world || "").trim();
        const existing = socket._movementDeliveryState;
        if (existing && existing.world === world) {
            existing.maxItems = maxItems;
            return existing;
        }
        if (existing)
            removeMovementState(socket, true);
        const state = {
            world,
            players: new Map(),
            left: new Map(),
            maxItems,
            sequence: 0,
        };
        socket._movementDeliveryState = state;
        return state;
    }
    function mergeMovementBatch(state, payload) {
        let replacedItems = 0;
        for (const item of cleanPacketArray(payload.players)) {
            const key = getPresenceItemKey(state, item, "player");
            if (state.players.has(key))
                replacedItems += 1;
            if (state.left.delete(key))
                replacedItems += 1;
            state.players.set(key, item);
        }
        for (const item of cleanPacketArray(payload.left)) {
            const key = getPresenceItemKey(state, item, "left");
            if (state.left.has(key))
                replacedItems += 1;
            if (state.players.delete(key))
                replacedItems += 1;
            state.left.set(key, item);
        }
        return replacedItems;
    }
    function recordMovementBatchSent(payload) {
        const players = cleanPacketArray(payload.players);
        const left = cleanPacketArray(payload.left);
        config.playerNetworkStats.batch_presence_packets_sent += 1;
        config.playerNetworkStats.batch_player_items_sent += players.length;
        config.playerNetworkStats.batch_left_items_sent += left.length;
        config.playerNetworkStats.interest_culls_sent += left.length;
    }
    function scheduleMovementFlush(socket) {
        const state = socket._movementDeliveryState;
        if (!state || state.retryTimer)
            return;
        state.retryTimer = setTimeout(() => {
            if (socket._movementDeliveryState)
                socket._movementDeliveryState.retryTimer = undefined;
            flushPendingPlayerPositionBatch(socket);
        }, Math.max(1, Math.trunc(config.movementRetryMs)));
        if (typeof state.retryTimer.unref === "function")
            state.retryTimer.unref();
    }
    function flushPendingPlayerPositionBatch(socket) {
        if (!socket)
            return false;
        const state = socket._movementDeliveryState;
        if (!state)
            return true;
        if (!isSocketOpen(socket)) {
            removeMovementState(socket, true);
            return false;
        }
        if (getSocketBufferedAmount(socket) > config.movementResumeBufferedAmount) {
            scheduleMovementFlush(socket);
            return false;
        }
        let sentPackets = 0;
        while (countMovementItems(state) > 0) {
            if (sentPackets > 0 && getSocketBufferedAmount(socket) > config.movementMaxBufferedAmount) {
                scheduleMovementFlush(socket);
                break;
            }
            const playerEntries = Array.from(state.players.entries()).slice(0, state.maxItems);
            const remainingSlots = Math.max(0, state.maxItems - playerEntries.length);
            const leftEntries = Array.from(state.left.entries()).slice(0, remainingSlots);
            const payload = {
                type: "player_position_batch",
                world: state.world,
            };
            if (playerEntries.length > 0)
                payload.players = playerEntries.map(([, item]) => item);
            if (leftEntries.length > 0)
                payload.left = leftEntries.map(([, item]) => item);
            if (!sendJson(socket, payload)) {
                if (isSocketOpen(socket) && getSocketBufferedAmount(socket) > config.movementResumeBufferedAmount) {
                    scheduleMovementFlush(socket);
                }
                else {
                    removeMovementState(socket, true);
                }
                return false;
            }
            for (const [key] of playerEntries)
                state.players.delete(key);
            for (const [key] of leftEntries)
                state.left.delete(key);
            recordMovementBatchSent(payload);
            sentPackets += 1;
        }
        if (countMovementItems(state) === 0)
            removeMovementState(socket, false);
        if (sentPackets > 0)
            config.playerNetworkStats.movement_backpressure_flushes += 1;
        return countMovementItems(state) === 0;
    }
    function sendPlayerPositionBatch(socket, payload, rawMaxItems) {
        if (!socket || !isSocketOpen(socket))
            return false;
        payload = compactMovementBatch(payload);
        const players = cleanPacketArray(payload.players);
        const left = cleanPacketArray(payload.left);
        if (players.length === 0 && left.length === 0)
            return false;
        const maxItems = Math.max(1, Math.trunc(Number(rawMaxItems) || 1));
        const existing = socket._movementDeliveryState;
        if (!existing && getSocketBufferedAmount(socket) <= config.movementMaxBufferedAmount) {
            const sent = sendJson(socket, payload);
            if (sent)
                recordMovementBatchSent(payload);
            return sent;
        }
        const hadPending = Boolean(existing && countMovementItems(existing) > 0);
        const state = getOrCreateMovementState(socket, payload, maxItems);
        const replacedItems = mergeMovementBatch(state, payload);
        config.playerNetworkStats.movement_backpressure_queued_batches += 1;
        if (hadPending)
            config.playerNetworkStats.movement_backpressure_coalesced_batches += 1;
        config.playerNetworkStats.movement_backpressure_replaced_items += replacedItems;
        if (getSocketBufferedAmount(socket) <= config.movementResumeBufferedAmount) {
            return flushPendingPlayerPositionBatch(socket);
        }
        scheduleMovementFlush(socket);
        return true;
    }
    return {
        clearPlayerPositionDeliveryState,
        flushPendingPlayerPositionBatch,
        getSocketBufferedAmount,
        sendJson,
        sendPlayerPositionBatch,
        sendRawJsonToSocket,
        shouldLogSocketBackpressure,
        shouldLogSocketPacketWarning,
    };
}
module.exports = {
    compactMovementBatch,
    encodeMovementColumns,
    createServerSocketDeliveryHelpers,
};
