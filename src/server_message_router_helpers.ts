"use strict";

type PacketRecord = Record<string, unknown>;
type RateLimitConfig = { limit: number; windowMs: number };
type RateLimitTable = Record<string, RateLimitConfig | undefined>;
type CanonicalWorldActionType = "" | "world_block_update" | "world_item_drop_create" | "world_item_drop_pickup";

interface PacketContractsLike {
  cleanPacketString(value: unknown): string;
  getPacketType(packet: unknown): string;
  getCanonicalWorldActionType(packet: unknown): CanonicalWorldActionType;
  isWorldBlockUpdatePacket(packet: unknown): boolean;
  isWorldDropIdempotencyRequestPacket(packet: unknown): boolean;
}

interface MessageRouterConfig {
  packetContracts: PacketContractsLike;
  messageRateLimits: RateLimitTable;
  inventoryTransactionActionRateLimits: RateLimitTable;
  botRateLimits: RateLimitTable;
  defaultMessageRateLimit: RateLimitConfig;
  idempotencyTtlMs: number;
  idempotencyTtlMsCritical: number;
  idempotencyTtlMsWorldAction: number;
  idempotencyTtlMsCombat: number;
  maxItemIdLength: number;
  maxDropIdLength: number;
  maxBulkDropPickupIds: number;
  normalizePacketTypeName(rawType: unknown): string;
  cleanAccountName(value: unknown): string;
  cleanWorld(value: unknown): string;
  clampString(value: unknown, limit?: number): string;
  cleanDropIdList(rawIds: unknown, maxIds?: number): string[];
}

interface PlayerLike {
  account_username?: unknown;
  world?: unknown;
}

interface RateLimitDecision {
  bucketKey: string;
  limits: RateLimitConfig;
}

interface BotRateLimitDecision extends RateLimitDecision {
  actionKey: string;
}

interface RateLimitResultLike {
  count?: unknown;
  resetInMs?: unknown;
  fallback?: unknown;
}

function isRecord(value: unknown): value is PacketRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toRecord(value: unknown): PacketRecord {
  return isRecord(value) ? value : {};
}

function cleanRateLimitConfig(value: RateLimitConfig | undefined, fallback: RateLimitConfig): RateLimitConfig {
  return {
    limit: Math.max(1, Math.trunc(Number(value?.limit) || fallback.limit)),
    windowMs: Math.max(100, Math.trunc(Number(value?.windowMs) || fallback.windowMs)),
  };
}

function createServerMessageRouterHelpers(config: MessageRouterConfig) {
  const packetContracts = config.packetContracts;
  const defaultMessageRateLimit = cleanRateLimitConfig(config.defaultMessageRateLimit, { limit: 60, windowMs: 1000 });

  function getRawLength(raw: unknown): number {
    if (Buffer.isBuffer(raw)) return raw.length;
    return Buffer.byteLength(String(raw || ""), "utf8");
  }

  function getInboundMessageType(data: unknown): string {
    return isRecord(data) ? config.normalizePacketTypeName(data.type) : "invalid";
  }

  function makeRequestId(data: unknown): string {
    const raw = toRecord(data);
    const requestId = String(raw.request_id || "").trim();
    if (requestId !== "") return config.clampString(requestId, config.maxItemIdLength);
    const actionId = String(raw.action_id || raw.client_action_id || "").trim();
    return actionId === "" ? "" : config.clampString(actionId, config.maxItemIdLength);
  }

  function makeMessageIdempotencyScope(data: unknown): string {
    const raw = toRecord(data);
    const type = String(raw.type || "").trim();
    if (type === "") return "";

    if (type === "player_punch") {
      const target = config.clampString(raw.target_player_id || raw.target_id || raw.target_username || "");
      const world = config.clampString(raw.world || raw.target_world || "");
      return `player_punch:${target || "unknown"}:${world || "unknown"}`;
    }

    if (type === "inventory_transaction_request") {
      const action = String(raw.action || "").trim().toLowerCase() || "unknown";
      return `${type}:${action}`;
    }

    if (type === "inventory_upgrade_purchase") {
      return type;
    }

    if (type === "world_seed_update" || type === "world_interaction_update") {
      const action = String(raw.action || "").trim().toLowerCase() || "unknown";
      const world = config.clampString(raw.world || raw.current_world || raw.target_world || "");
      const x = Math.trunc(Number(raw.x) || 0);
      const y = Math.trunc(Number(raw.y) || 0);
      return `${type}:${action}:${world || "unknown"}:${x}:${y}`;
    }

    if (type === "world_block_update") {
      const action = String(raw.action || "").trim().toLowerCase() || "unknown";
      const world = config.clampString(raw.world || raw.current_world || "");
      const x = Math.trunc(Number(raw.x) || 0);
      const y = Math.trunc(Number(raw.y) || 0);
      const layer = config.clampString(raw.layer || "foreground");
      return `${type}:${action}:${world || "unknown"}:${layer}:${x}:${y}`;
    }

    if (packetContracts.isWorldDropIdempotencyRequestPacket(raw)) {
      const dropId = config.clampString(raw.drop_id || raw.dropId || "");
      if (dropId !== "") return `${type}:${dropId}`;

      const world = config.clampString(raw.world || raw.current_world || "");
      const x = Math.trunc(Number(raw.x) || 0);
      const y = Math.trunc(Number(raw.y) || 0);
      const item = config.clampString(raw.item_id || raw.item || "");
      return `${type}:${world || "unknown"}:${x}:${y}:${item || "unknown"}`;
    }

    if (
      type === "trade_request" ||
      type === "trade_response" ||
      type === "trade_offer_update" ||
      type === "trade_confirm" ||
      type === "trade_final_confirm" ||
      type === "trade_cancel"
    ) {
      return type;
    }

    if (
      type === "account_register" ||
      type === "account_login" ||
      type === "account_token_login" ||
      type === "account_password_reset_request" ||
      type === "account_email_change_request" ||
      type === "dev_backend_login"
    ) {
      return type;
    }

    if (type === "pull_player_request") {
      return type;
    }

    if (type === "door_enter") {
      const world = config.clampString(raw.world || raw.target_world || "");
      return `${type}:${world || "unknown"}`;
    }

    return "";
  }

  function makeMessageIdempotencyKey(player: PlayerLike | null | undefined, data: unknown, scope: unknown): string {
    const raw = toRecord(data);
    const requestId = makeRequestId(raw);
    if (requestId === "") return "";

    const username = config.cleanAccountName(player?.account_username || raw.username || raw.account_username || "");
    if (username === "") return "";

    const worldName = config.cleanWorld(raw.world || player?.world || "START");
    return `${username}:${String(scope || "")}:${worldName}:${requestId}`;
  }

  function getMessageIdempotencyTTLMs(data: unknown = {}): number {
    const raw = toRecord(data);
    const normalizedScope = String(makeMessageIdempotencyScope(raw) || "").trim();
    const normalizedType = String(raw.type || "").trim().toLowerCase();

    if (normalizedScope.startsWith("player_punch:")) {
      return config.idempotencyTtlMsCombat;
    }

    if (
      normalizedScope.startsWith("world_block_update:") ||
      normalizedScope.startsWith("world_seed_update:") ||
      normalizedScope.startsWith("world_interaction_update:") ||
      normalizedScope.startsWith("world_item_drop_") ||
      normalizedScope.startsWith("world_drop_")
    ) {
      return config.idempotencyTtlMsWorldAction;
    }

    if (
      normalizedType === "trade_request" ||
      normalizedType === "trade_response" ||
      normalizedType === "trade_offer_update" ||
      normalizedType === "trade_confirm" ||
      normalizedType === "trade_final_confirm" ||
      normalizedType === "trade_cancel"
    ) {
      return config.idempotencyTtlMsCritical;
    }

    if (normalizedScope.startsWith("inventory_transaction_request:") || normalizedType === "inventory_upgrade_purchase") {
      return config.idempotencyTtlMsWorldAction;
    }

    return config.idempotencyTtlMs;
  }

  function buildIdempotencyClaimMetadata(data: unknown, player: PlayerLike | null | undefined): PacketRecord {
    const raw = toRecord(data);
    return {
      type: String(raw.type || ""),
      action: String(raw.action || ""),
      request_id: makeRequestId(raw),
      action_id: String(raw.action_id || ""),
      client_action_id: String(raw.client_action_id || ""),
      world: config.cleanWorld(raw.world || player?.world || "START"),
      trade_id: String(raw.trade_id || ""),
      drop_id: String(raw.drop_id || ""),
    };
  }

  function getMessageRateLimitDecision(messageType: unknown, data: unknown = null): RateLimitDecision {
    const bucketKey = String(messageType || "unknown").trim().toLowerCase() || "unknown";
    const raw = toRecord(data);
    const cleanAction = String(raw.action || "").trim().toLowerCase();
    if (bucketKey === "inventory_transaction_request" && cleanAction !== "") {
      const actionLimits = config.inventoryTransactionActionRateLimits[cleanAction];
      if (actionLimits) {
        return {
          bucketKey: `${bucketKey}:${cleanAction}`,
          limits: cleanRateLimitConfig(actionLimits, defaultMessageRateLimit),
        };
      }
    }
    return {
      bucketKey,
      limits: cleanRateLimitConfig(config.messageRateLimits[bucketKey], defaultMessageRateLimit),
    };
  }

  function getBotRateLimitAction(messageType: unknown, data: unknown = {}): string {
    const raw = toRecord(data);
    const type = packetContracts.cleanPacketString(messageType).toLowerCase();
    const action = String(raw.action || "").trim().toLowerCase();

    if (packetContracts.isWorldBlockUpdatePacket({ type })) {
      if (action === "place") return "block_place";
      if (action === "break" || action === "hit") return "block_break";
      return "";
    }

    if (type === "world_item_drop_pickup" || type === "world_drop_pickup") return "pickup_attempt";
    if (type === "chat") return "chat_message";
    if (type === "player_punch") return "player_punch";
    if (type === "trade_request") return "trade_request";
    if (type === "join_world") return "world_join";
    if (type === "inventory_transaction_request" && action === "vend_buy") return "vending_purchase";

    return "";
  }

  function getBotRateLimitDecision(messageType: unknown, data: unknown = null): BotRateLimitDecision {
    const actionKey = getBotRateLimitAction(messageType, data || {});
    if (actionKey === "") {
      return { actionKey: "", bucketKey: "", limits: defaultMessageRateLimit };
    }
    return {
      actionKey,
      bucketKey: actionKey,
      limits: cleanRateLimitConfig(config.botRateLimits[actionKey], defaultMessageRateLimit),
    };
  }

  function isDropPickupRateLimit(data: unknown): boolean {
    if (!isRecord(data)) return false;
    const normalizedType = packetContracts.getPacketType(data);
    return normalizedType === "world_item_drop_pickup" || normalizedType === "world_drop_pickup";
  }

  function buildRateLimitedPayload(bucketKey: unknown, data: unknown = null): PacketRecord {
    const cleanBucketKey = String(bucketKey || "").trim().toLowerCase();
    const raw = toRecord(data);
    const payload: PacketRecord = {
      type: "rate_limited",
      action: cleanBucketKey,
      message: "Slow down a little.",
    };
    const isWorldBlockRateLimit = packetContracts.isWorldBlockUpdatePacket(raw);
    const isDropPickup = isDropPickupRateLimit(raw);

    if ((cleanBucketKey === "world_block_update" || isWorldBlockRateLimit) && isRecord(data)) {
      const requestId = makeRequestId(raw);
      payload.action = "world_block_update";
      payload.reason = "rate_limited";
      payload.rate_limit_bucket = cleanBucketKey;
      if (requestId !== "") {
        payload.request_id = requestId;
        payload.action_id = requestId;
      }
      payload.world = config.cleanWorld(raw.world || raw.current_world || raw.world_id || "");
      payload.layer = String(raw.layer || "foreground").trim().toLowerCase() === "background" ? "background" : "foreground";
      payload.x = Math.trunc(Number(raw.x) || 0);
      payload.y = Math.trunc(Number(raw.y) || 0);
      payload.target_x = payload.x;
      payload.target_y = payload.y;
      payload.block_type = config.clampString(raw.block_type || raw.item_id || "");
      payload.block_action = config.clampString(raw.action || "");
    } else if (isDropPickup) {
      const requestId = makeRequestId(raw);
      payload.action = "world_item_drop_pickup";
      payload.reason = "rate_limited";
      payload.rate_limit_bucket = cleanBucketKey;
      if (requestId !== "") {
        payload.request_id = requestId;
        payload.action_id = requestId;
      }
      payload.world = config.cleanWorld(raw.world || raw.current_world || raw.world_id || "");
      payload.drop_id = config.clampString(raw.drop_id || "", config.maxDropIdLength);
      if (Array.isArray(raw.drop_ids)) {
        payload.drop_ids = config.cleanDropIdList(raw.drop_ids, config.maxBulkDropPickupIds);
      }
    }

    return payload;
  }

  function buildRateLimitSecurityEventDetails(
    scope: unknown,
    bucketKey: unknown,
    limits: RateLimitConfig | undefined,
    result: RateLimitResultLike = {},
    data: unknown = null,
    player: PlayerLike | null | undefined = null,
    subject: unknown = ""
  ): PacketRecord {
    const raw = toRecord(data);
    const safeLimits = cleanRateLimitConfig(limits, defaultMessageRateLimit);
    return {
      scope: String(scope || "message"),
      bucket: String(bucketKey || "unknown"),
      message_type: String(raw.type || ""),
      action: String(raw.action || ""),
      request_id: makeRequestId(raw),
      world: config.cleanWorld(raw.world || player?.world || ""),
      limit: safeLimits.limit,
      window_ms: safeLimits.windowMs,
      observed_count: Number(result?.count || 0),
      retry_ms: Math.max(0, Math.trunc(Number(result?.resetInMs) || 0)),
      redis_fallback: Boolean(result?.fallback),
      subject: String(subject || ""),
    };
  }

  function shouldRecordFailedTransactionLedgerAction(action: unknown): boolean {
    const normalized = config.cleanAccountName(action || "").toLowerCase();
    if (normalized === "") return false;
    const worldActionType = packetContracts.getCanonicalWorldActionType({ type: normalized });
    if (worldActionType !== "") return true;
    if (normalized === "inventory_transaction_request") return true;
    if (normalized === "world_seed_update") return true;
    if (normalized === "world_interaction_update") return true;
    if (normalized === "world_item_drop_update") return true;
    if (normalized.startsWith("trade")) return true;
    if (normalized.startsWith("vend") || normalized.startsWith("vending")) return true;
    if (normalized.includes("shop_purchase")) return true;
    return false;
  }

  function failedTransactionLedgerTypeForAction(action: unknown): string {
    const normalized = config.cleanAccountName(action || "").toLowerCase();
    const worldActionType = packetContracts.getCanonicalWorldActionType({ type: normalized });
    if (worldActionType === "world_item_drop_create") return "ITEM_DROP";
    if (worldActionType === "world_item_drop_pickup") return "ITEM_PICKUP";
    if (worldActionType === "world_block_update") return "WORLD_BLOCK_UPDATE_FAILED";
    if (normalized.startsWith("trade")) return "TRADE_FAILED";
    if (normalized.startsWith("vend") || normalized.startsWith("vending")) return "VENDING_FAILED";
    if (normalized === "inventory_transaction_request") return "INVENTORY_TRANSACTION_FAILED";
    if (normalized === "world_seed_update") return "WORLD_SEED_UPDATE_FAILED";
    if (normalized === "world_interaction_update") return "WORLD_INTERACTION_FAILED";
    if (normalized.includes("shop_purchase")) return "SHOP_PURCHASE";
    return "VALUABLE_ACTION_FAILED";
  }

  function failedTransactionLedgerSourceForAction(action: unknown): string {
    const normalized = config.cleanAccountName(action || "").toLowerCase();
    const worldActionType = packetContracts.getCanonicalWorldActionType({ type: normalized });
    if (worldActionType === "world_item_drop_pickup") return "drop_pickup";
    if (worldActionType === "world_item_drop_create") return "drop_inventory";
    if (worldActionType === "world_block_update") return "world_block_place";
    if (normalized.startsWith("trade")) return "trade";
    if (normalized.startsWith("vend") || normalized.startsWith("vending")) return "vending";
    if (normalized.includes("pickup")) return "drop_pickup";
    if (normalized.includes("drop")) return "drop_inventory";
    if (normalized.includes("seed")) return "seed_place";
    if (normalized.includes("shop")) return "shop";
    if (normalized.includes("interaction")) return "world_interaction";
    if (normalized.includes("block")) return "world_block_place";
    return "system";
  }

  return {
    buildIdempotencyClaimMetadata,
    buildRateLimitedPayload,
    buildRateLimitSecurityEventDetails,
    failedTransactionLedgerSourceForAction,
    failedTransactionLedgerTypeForAction,
    getBotRateLimitAction,
    getBotRateLimitDecision,
    getInboundMessageType,
    getMessageIdempotencyTTLMs,
    getMessageRateLimitDecision,
    getRawLength,
    isDropPickupRateLimit,
    makeMessageIdempotencyKey,
    makeMessageIdempotencyScope,
    makeRequestId,
    shouldRecordFailedTransactionLedgerAction,
  };
}

export = {
  createServerMessageRouterHelpers,
};
