"use strict";

type PacketRecord = Record<string, unknown>;

interface SocketLike {
  readyState?: unknown;
  bufferedAmount?: unknown;
  playerId?: unknown;
  _lastBackpressureWarningAt?: unknown;
  _lastPacketWarningAt?: Record<string, number>;
  send(raw: string): void;
}

interface PlayerNetworkStatsLike {
  outbound_packets_attempted: number;
  outbound_bytes_sent: number;
  outbound_oversize_packets: number;
  outbound_backpressure_skips: number;
  outbound_send_failures: number;
}

interface SocketDeliveryConfig {
  websocketOpenState: number;
  maxPacketBytes: number;
  maxBufferedAmount: number;
  playerNetworkStats: PlayerNetworkStatsLike;
  getRawLength(raw: unknown): number;
  normalizePacketTypeName(value: unknown): string;
  recordPacketTypeSize(direction: "outbound", rawMessageType: string, rawBytes: number): void;
  warn(label: string, payload: unknown): void;
}

interface SendDetails extends PacketRecord {
  message_type?: unknown;
}

function isRecord(value: unknown): value is PacketRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanDetails(details: unknown): PacketRecord {
  return isRecord(details) ? details : {};
}

function getErrorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message || error)
    : String(error);
}

function createServerSocketDeliveryHelpers(config: SocketDeliveryConfig) {
  function isSocketOpen(socket: SocketLike | null | undefined): boolean {
    return Boolean(socket && socket.readyState === config.websocketOpenState);
  }

  function getSocketBufferedAmount(socket: SocketLike | null | undefined): number {
    const amount = Number(socket?.bufferedAmount || 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  function shouldLogSocketBackpressure(socket: SocketLike | null | undefined): boolean {
    const now = Date.now();
    const previous = Number(socket?._lastBackpressureWarningAt || 0);
    if (now - previous < 5000) return false;
    if (socket) socket._lastBackpressureWarningAt = now;
    return true;
  }

  function shouldLogSocketPacketWarning(
    socket: SocketLike | null | undefined,
    warningKey: unknown,
    minGapMs = 10000
  ): boolean {
    if (!socket) return false;
    const now = Date.now();
    const map = socket._lastPacketWarningAt || {};
    const key = String(warningKey || "socket_packet").trim() || "socket_packet";
    const previous = Number(map[key] || 0);
    if (now - previous < minGapMs) return false;
    map[key] = now;
    socket._lastPacketWarningAt = map;
    return true;
  }

  function sendRawJsonToSocket(
    socket: SocketLike | null | undefined,
    raw: string,
    context = "send",
    details: SendDetails = {}
  ): boolean {
    if (!isSocketOpen(socket)) return false;
    const rawLength = config.getRawLength(raw);
    const safeDetails = cleanDetails(details);
    const detailsMessageType = String(safeDetails.message_type || "").trim();
    config.recordPacketTypeSize(
      "outbound",
      config.normalizePacketTypeName(detailsMessageType || context || "send"),
      rawLength
    );
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
    } catch (error) {
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

  function sendJson(socket: SocketLike | null | undefined, payload: unknown): void {
    if (!isSocketOpen(socket)) return;
    let raw: string;
    try {
      raw = JSON.stringify(payload);
    } catch (error) {
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

export = {
  createServerSocketDeliveryHelpers,
};
