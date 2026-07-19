// Generated from src/server_socket_delivery_helpers.ts. Do not edit by hand.
"use strict";
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function cleanDetails(details) {
    return isRecord(details) ? details : {};
}
function getErrorMessage(error) {
    return error && typeof error === "object" && "message" in error
        ? String(error.message || error)
        : String(error);
}
function createServerSocketDeliveryHelpers(config) {
    function isSocketOpen(socket) {
        return Boolean(socket && socket.readyState === config.websocketOpenState);
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
            config.playerNetworkStats.outbound_backpressure_skips += 1;
            if (shouldLogSocketBackpressure(socket)) {
                config.warn("[socket_backpressure_skip]", {
                    context,
                    player_id: String(socket?.playerId || ""),
                    buffered_amount: bufferedAmount,
                    limit: config.maxBufferedAmount,
                    ...safeDetails,
                });
            }
            return false;
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
            return;
        let raw;
        try {
            raw = JSON.stringify(payload);
        }
        catch (error) {
            config.warn("[socket_serialize_error]", getErrorMessage(error));
            return;
        }
        sendRawJsonToSocket(socket, raw, "direct_send", {
            message_type: isRecord(payload) ? String(payload.type || "") : "",
        });
    }
    return {
        getSocketBufferedAmount,
        sendJson,
        sendRawJsonToSocket,
        shouldLogSocketBackpressure,
        shouldLogSocketPacketWarning,
    };
}
module.exports = {
    createServerSocketDeliveryHelpers,
};
