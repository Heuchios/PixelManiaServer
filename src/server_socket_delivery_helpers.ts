"use strict";

type PacketRecord = Record<string, unknown>;

interface MovementDeliveryState {
  world: string;
  players: Map<string, PacketRecord>;
  left: Map<string, PacketRecord>;
  maxItems: number;
  sequence: number;
  retryTimer?: ReturnType<typeof setTimeout>;
}

interface SocketLike {
  readyState?: unknown;
  bufferedAmount?: unknown;
  playerId?: unknown;
  _lastBackpressureWarningAt?: unknown;
  _lastPacketWarningAt?: Record<string, number>;
  _movementDeliveryState?: MovementDeliveryState;
  send(raw: string): void;
}

interface PlayerNetworkStatsLike {
  outbound_packets_attempted: number;
  outbound_bytes_sent: number;
  outbound_oversize_packets: number;
  outbound_backpressure_skips: number;
  outbound_send_failures: number;
  batch_presence_packets_sent: number;
  batch_player_items_sent: number;
  batch_left_items_sent: number;
  interest_culls_sent: number;
  movement_backpressure_queued_batches: number;
  movement_backpressure_coalesced_batches: number;
  movement_backpressure_replaced_items: number;
  movement_backpressure_flushes: number;
  movement_backpressure_dropped_items: number;
}

interface SocketDeliveryConfig {
  websocketOpenState: number;
  maxPacketBytes: number;
  maxBufferedAmount: number;
  movementMaxBufferedAmount: number;
  movementResumeBufferedAmount: number;
  movementRetryMs: number;
  playerNetworkStats: PlayerNetworkStatsLike;
  getRawLength(raw: unknown): number;
  normalizePacketTypeName(value: unknown): string;
  recordPacketTypeSize(direction: "outbound", rawMessageType: string, rawBytes: number): void;
  warn(label: string, payload: unknown): void;
}

interface SendDetails extends PacketRecord {
  message_type?: unknown;
}

interface PlayerPositionBatchPayload extends PacketRecord {
  type?: unknown;
  world?: unknown;
  players?: unknown;
  left?: unknown;
}

function isRecord(value: unknown): value is PacketRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanDetails(details: unknown): PacketRecord {
  return isRecord(details) ? details : {};
}

function cleanPacketArray(value: unknown): PacketRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
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

  function sendJson(socket: SocketLike | null | undefined, payload: unknown): boolean {
    if (!isSocketOpen(socket)) return false;
    let raw: string;
    try {
      raw = JSON.stringify(payload);
    } catch (error) {
      config.warn("[socket_serialize_error]", getErrorMessage(error));
      return false;
    }
    return sendRawJsonToSocket(socket, raw, "direct_send", {
      message_type: isRecord(payload) ? String(payload.type || "") : "",
    });
  }

  function getPresenceItemKey(
    state: MovementDeliveryState,
    item: PacketRecord,
    prefix: "player" | "left"
  ): string {
    const stableKey = String(item.player_id || item.id || item.account_username || "").trim();
    if (stableKey !== "") return stableKey;
    state.sequence += 1;
    return `${prefix}:anonymous:${state.sequence}`;
  }

  function countMovementItems(state: MovementDeliveryState): number {
    return state.players.size + state.left.size;
  }

  function removeMovementState(socket: SocketLike, countDropped: boolean): void {
    const state = socket._movementDeliveryState;
    if (!state) return;
    if (state.retryTimer) clearTimeout(state.retryTimer);
    if (countDropped) {
      config.playerNetworkStats.movement_backpressure_dropped_items += countMovementItems(state);
    }
    delete socket._movementDeliveryState;
  }

  function clearPlayerPositionDeliveryState(socket: SocketLike | null | undefined): void {
    if (socket) removeMovementState(socket, true);
  }

  function getOrCreateMovementState(
    socket: SocketLike,
    payload: PlayerPositionBatchPayload,
    maxItems: number
  ): MovementDeliveryState {
    const world = String(payload.world || "").trim();
    const existing = socket._movementDeliveryState;
    if (existing && existing.world === world) {
      existing.maxItems = maxItems;
      return existing;
    }
    if (existing) removeMovementState(socket, true);
    const state: MovementDeliveryState = {
      world,
      players: new Map(),
      left: new Map(),
      maxItems,
      sequence: 0,
    };
    socket._movementDeliveryState = state;
    return state;
  }

  function mergeMovementBatch(state: MovementDeliveryState, payload: PlayerPositionBatchPayload): number {
    let replacedItems = 0;
    for (const item of cleanPacketArray(payload.players)) {
      const key = getPresenceItemKey(state, item, "player");
      if (state.players.has(key)) replacedItems += 1;
      if (state.left.delete(key)) replacedItems += 1;
      state.players.set(key, item);
    }
    for (const item of cleanPacketArray(payload.left)) {
      const key = getPresenceItemKey(state, item, "left");
      if (state.left.has(key)) replacedItems += 1;
      if (state.players.delete(key)) replacedItems += 1;
      state.left.set(key, item);
    }
    return replacedItems;
  }

  function recordMovementBatchSent(payload: PlayerPositionBatchPayload): void {
    const players = cleanPacketArray(payload.players);
    const left = cleanPacketArray(payload.left);
    config.playerNetworkStats.batch_presence_packets_sent += 1;
    config.playerNetworkStats.batch_player_items_sent += players.length;
    config.playerNetworkStats.batch_left_items_sent += left.length;
    config.playerNetworkStats.interest_culls_sent += left.length;
  }

  function scheduleMovementFlush(socket: SocketLike): void {
    const state = socket._movementDeliveryState;
    if (!state || state.retryTimer) return;
    state.retryTimer = setTimeout(() => {
      if (socket._movementDeliveryState) socket._movementDeliveryState.retryTimer = undefined;
      flushPendingPlayerPositionBatch(socket);
    }, Math.max(1, Math.trunc(config.movementRetryMs)));
    if (typeof state.retryTimer.unref === "function") state.retryTimer.unref();
  }

  function flushPendingPlayerPositionBatch(socket: SocketLike | null | undefined): boolean {
    if (!socket) return false;
    const state = socket._movementDeliveryState;
    if (!state) return true;
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
      const payload: PlayerPositionBatchPayload = {
        type: "player_position_batch",
        world: state.world,
      };
      if (playerEntries.length > 0) payload.players = playerEntries.map(([, item]) => item);
      if (leftEntries.length > 0) payload.left = leftEntries.map(([, item]) => item);

      if (!sendJson(socket, payload)) {
        if (isSocketOpen(socket) && getSocketBufferedAmount(socket) > config.movementResumeBufferedAmount) {
          scheduleMovementFlush(socket);
        } else {
          removeMovementState(socket, true);
        }
        return false;
      }

      for (const [key] of playerEntries) state.players.delete(key);
      for (const [key] of leftEntries) state.left.delete(key);
      recordMovementBatchSent(payload);
      sentPackets += 1;
    }

    if (countMovementItems(state) === 0) removeMovementState(socket, false);
    if (sentPackets > 0) config.playerNetworkStats.movement_backpressure_flushes += 1;
    return countMovementItems(state) === 0;
  }

  function sendPlayerPositionBatch(
    socket: SocketLike | null | undefined,
    payload: PlayerPositionBatchPayload,
    rawMaxItems: number
  ): boolean {
    if (!socket || !isSocketOpen(socket)) return false;
    const players = cleanPacketArray(payload.players);
    const left = cleanPacketArray(payload.left);
    if (players.length === 0 && left.length === 0) return false;
    const maxItems = Math.max(1, Math.trunc(Number(rawMaxItems) || 1));
    const existing = socket._movementDeliveryState;

    if (!existing && getSocketBufferedAmount(socket) <= config.movementMaxBufferedAmount) {
      const sent = sendJson(socket, payload);
      if (sent) recordMovementBatchSent(payload);
      return sent;
    }

    const hadPending = Boolean(existing && countMovementItems(existing) > 0);
    const state = getOrCreateMovementState(socket, payload, maxItems);
    const replacedItems = mergeMovementBatch(state, payload);
    config.playerNetworkStats.movement_backpressure_queued_batches += 1;
    if (hadPending) config.playerNetworkStats.movement_backpressure_coalesced_batches += 1;
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

export = {
  createServerSocketDeliveryHelpers,
};
