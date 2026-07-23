"use strict";

type PacketRecord = Record<string, any>;
type RateLimitConfig = Readonly<{ limit: number; windowMs: number }>;
type RateLimitTable = Record<string, RateLimitConfig | undefined>;

const RATE_LIMIT_NOTIFICATION_COOLDOWN_MS = 3000;

interface ServerEnvConfigLike {
  makeBotRateLimitConfig(
    prefix: string,
    fallbackLimit: unknown,
    fallbackWindowMs: unknown,
    maxLimit?: number
  ): RateLimitConfig;
}

interface MessageRouterHelpersLike {
  buildRateLimitedPayload(bucketKey: unknown, data?: unknown): PacketRecord;
  buildRateLimitSecurityEventDetails(
    scope: unknown,
    bucketKey: unknown,
    limits: RateLimitConfig | undefined,
    result?: PacketRecord,
    data?: unknown,
    player?: PacketRecord | null,
    subject?: unknown
  ): PacketRecord;
  getBotRateLimitAction(messageType: unknown, data?: unknown): string;
  getBotRateLimitDecision(messageType: unknown, data?: unknown): { actionKey: string; bucketKey: string; limits?: RateLimitConfig };
  getMessageRateLimitDecision(messageType: unknown, data?: unknown): { bucketKey: string; limits?: RateLimitConfig };
  isDropPickupRateLimit(data: unknown): boolean;
}

interface RedisStoreLike {
  isReady?(): boolean;
  checkRateLimit?(scope: string, subject: string, limit: number, windowMs: number): Promise<PacketRecord>;
}

interface RateLimitHelperDeps {
  accountKey(value: unknown): string;
  botRateLimitSecurityLogWindowMs: number;
  getSocketAddress(socket: PacketRecord | null | undefined): string;
  logSecurityEvent(socket: PacketRecord, player: PacketRecord | null | undefined, event: string, details: PacketRecord, severity: string): void;
  makeRequestId(data: unknown): string;
  messageRouterHelpers: MessageRouterHelpersLike;
  packetContracts: {
    isWorldBlockUpdatePacket(packet: unknown): boolean;
  };
  playerNetworkStats: PacketRecord;
  redisStore: RedisStoreLike;
  sendDeveloperDenied(socket: PacketRecord, requestId: string, command: string, message: string, extra?: PacketRecord): void;
  sendJson(socket: PacketRecord, payload: PacketRecord): void;
  webSocketOpenState: number;
}

function isRecord(value: unknown): value is PacketRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toRecord(value: unknown): PacketRecord {
  return isRecord(value) ? value : {};
}

function cleanRateLimitConfig(value: RateLimitConfig | undefined, fallback: RateLimitConfig = { limit: 60, windowMs: 1000 }): RateLimitConfig {
  return {
    limit: Math.max(1, Math.trunc(Number(value?.limit) || fallback.limit)),
    windowMs: Math.max(100, Math.trunc(Number(value?.windowMs) || fallback.windowMs)),
  };
}

function fallbackRateLimitConfig(fallbackLimit: unknown, fallbackWindowMs: unknown): RateLimitConfig {
  return Object.freeze({
    limit: Math.max(1, Math.trunc(Number(fallbackLimit) || 1)),
    windowMs: Math.max(100, Math.trunc(Number(fallbackWindowMs) || 1000)),
  });
}

function createServerBotRateLimitTables(deps: { serverEnvConfig?: ServerEnvConfigLike; env?: NodeJS.ProcessEnv | Record<string, string | undefined> } = {}) {
  const makeBotRateLimitConfig = (
    prefix: string,
    fallbackLimit: unknown,
    fallbackWindowMs: unknown,
    maxLimit = 100000
  ): RateLimitConfig => {
    if (typeof deps.serverEnvConfig?.makeBotRateLimitConfig === "function") {
      return deps.serverEnvConfig.makeBotRateLimitConfig(prefix, fallbackLimit, fallbackWindowMs, maxLimit);
    }
    return fallbackRateLimitConfig(fallbackLimit, fallbackWindowMs);
  };

  const botRateLimits: RateLimitTable = Object.freeze({
    block_place: makeBotRateLimitConfig("BOT_BLOCK_PLACE", 75, 1000),
    block_break: makeBotRateLimitConfig("BOT_BLOCK_BREAK", 75, 1000),
    pickup_attempt: makeBotRateLimitConfig("BOT_PICKUP_ATTEMPT", 30, 1000),
    chat_message: makeBotRateLimitConfig("BOT_CHAT_MESSAGE", 20, 1000),
    player_punch: makeBotRateLimitConfig("BOT_PLAYER_PUNCH", 20, 1000),
    trade_request: makeBotRateLimitConfig("BOT_TRADE_REQUEST", 120, 60 * 1000),
    world_join: makeBotRateLimitConfig("BOT_WORLD_JOIN", 120, 60 * 1000),
    vending_purchase: makeBotRateLimitConfig("BOT_VENDING_PURCHASE", 50, 1000),
  });

  const inventoryTransactionActionRateLimits: RateLimitTable = Object.freeze({
    seed_place: makeBotRateLimitConfig("INVENTORY_SEED_PLACE", 60, 1000),
    seed_splice: makeBotRateLimitConfig("INVENTORY_SEED_SPLICE", 60, 1000),
    seed_harvest: makeBotRateLimitConfig("INVENTORY_SEED_HARVEST", 50, 1000),
    donation_box_donate: makeBotRateLimitConfig("INVENTORY_DONATION_BOX_DONATE", 12, 1000),
    donation_box_retrieve: makeBotRateLimitConfig("INVENTORY_DONATION_BOX_RETRIEVE", 12, 1000),
    donation_box_retrieve_all: makeBotRateLimitConfig("INVENTORY_DONATION_BOX_RETRIEVE_ALL", 4, 1000),
  });

  const messageRateLimits: RateLimitTable = {
    login: { limit: 10, windowMs: 10000 },
    account_register: { limit: 6, windowMs: 15000 },
    account_login: { limit: 8, windowMs: 15000 },
    account_token_login: { limit: 8, windowMs: 15000 },
    account_password_reset_request: { limit: 4, windowMs: 60000 },
    account_email_change_request: { limit: 4, windowMs: 60000 },
    // Gameplay limits include headroom for adjacent one-second client buckets.
    account_state_save: { limit: 30, windowMs: 10000 },
    inventory_transaction_request: { limit: 150, windowMs: 5000 },
    trade_request: { limit: 100, windowMs: 5000 },
    trade_response: { limit: 100, windowMs: 5000 },
    trade_offer_update: { limit: 120, windowMs: 5000 },
    trade_confirm: { limit: 100, windowMs: 5000 },
    trade_final_confirm: { limit: 100, windowMs: 5000 },
    trade_cancel: { limit: 100, windowMs: 5000 },
    friend_list_request: { limit: 60, windowMs: 5000 },
    friend_request: { limit: 60, windowMs: 5000 },
    friend_response: { limit: 60, windowMs: 5000 },
    player_state_request: { limit: 30, windowMs: 10000 },
    pull_player_request: { limit: 45, windowMs: 5000 },
    player_state_save: { limit: 30, windowMs: 10000 },
    inventory_upgrade_purchase: { limit: 30, windowMs: 5000 },
    join_world: { limit: 40, windowMs: 10000 },
    leave_world: { limit: 60, windowMs: 10000 },
    chat: botRateLimits.chat_message,
    broadcast: { limit: 70, windowMs: 10000 },
    developer_pin_unlock: { limit: 5, windowMs: 15000 },
    developer_command_request: { limit: 60, windowMs: 5000 },
    world_block_update: { limit: 75, windowMs: 1000 },
    electrical_layer_update: { limit: 75, windowMs: 1000 },
    request_open_generator: { limit: 50, windowMs: 1000 },
    request_link_generator_pad: { limit: 50, windowMs: 1000 },
    request_link_generator_pole: { limit: 50, windowMs: 1000 },
    request_link_electric_poles: { limit: 50, windowMs: 1000 },
    oil_refinery_request: { limit: 50, windowMs: 1000 },
    battery_charger_request: { limit: 50, windowMs: 1000 },
    request_wire_visibility_refresh: { limit: 50, windowMs: 1000 },
    world_seed_update: { limit: 50, windowMs: 1000 },
    world_interaction_update: { limit: 50, windowMs: 1000 },
    door_enter: { limit: 50, windowMs: 1000 },
    netfox_spawn_ticket_request: { limit: 30, windowMs: 10000 },
    netfox_trusted_player_state: { limit: 50, windowMs: 1000 },
    custom_trusted_player_state: { limit: 50, windowMs: 1000 },
    world_item_drop_create: { limit: 60, windowMs: 1000 },
    world_drop_create: { limit: 60, windowMs: 1000 },
    world_item_drop_update: { limit: 80, windowMs: 1000 },
    world_drop_update: { limit: 80, windowMs: 1000 },
    world_item_drop_pickup: botRateLimits.pickup_attempt,
    world_item_drop_remove: { limit: 80, windowMs: 1000 },
    world_drop_pickup: botRateLimits.pickup_attempt,
    world_drop_remove: { limit: 80, windowMs: 1000 },
    player_position: { limit: 150, windowMs: 1000 },
    player_punch: botRateLimits.player_punch,
  };

  const env = deps.env || process.env;
  return Object.freeze({
    botRateLimitSecurityLogWindowMs: Math.max(1000, Math.trunc(Number(env.BOT_RATE_LIMIT_SECURITY_LOG_WINDOW_MS) || 5000)),
    botRateLimits,
    inventoryTransactionActionRateLimits,
    messageRateLimits,
  });
}

function createServerBotRateLimitHelpers(deps: RateLimitHelperDeps) {
  const defaultRateLimit: RateLimitConfig = { limit: 60, windowMs: 1000 };

  function ensureSocketMap(socket: PacketRecord, key: "rateLimits" | "rateLimitWarnings" | "rateLimitSecurityWarnings"): Map<string, any> {
    if (!(socket[key] instanceof Map)) {
      socket[key] = new Map<string, any>();
    }
    return socket[key];
  }

  function getRateLimitSubject(socket: PacketRecord | null | undefined, player: PacketRecord | null | undefined): string {
    const username = deps.accountKey(player?.account_username || "");
    if (username !== "") return `account:${username}`;

    const ip = deps.getSocketAddress(socket);
    if (ip !== "") return `ip:${ip}`;

    return `socket:${socket?.playerId || "unknown"}`;
  }

  function notifyRateLimited(socket: PacketRecord, bucketKey: unknown, data: unknown = null): void {
    const cleanBucketKey = String(bucketKey || "unknown").trim().toLowerCase() || "unknown";
    const raw = toRecord(data);
    const now = Date.now();

    if (cleanBucketKey === "developer_command_request") {
      deps.sendDeveloperDenied(
        socket,
        deps.makeRequestId(raw),
        String(raw.command || "").trim(),
        "Developer command rate limited. Slow down a little.",
        { reason: "rate_limited" }
      );
      return;
    }

    const isWorldBlockRateLimit = deps.packetContracts.isWorldBlockUpdatePacket(raw);
    const isDropPickupRateLimit = deps.messageRouterHelpers.isDropPickupRateLimit(raw);
    const warnings = ensureSocketMap(socket, "rateLimitWarnings");
    const lastWarnedAt = Number(warnings.get(cleanBucketKey) || 0);
    if (socket.readyState !== deps.webSocketOpenState) return;
    if (!isWorldBlockRateLimit && !isDropPickupRateLimit && now - lastWarnedAt <= RATE_LIMIT_NOTIFICATION_COOLDOWN_MS) return;

    warnings.set(cleanBucketKey, now);
    deps.sendJson(socket, deps.messageRouterHelpers.buildRateLimitedPayload(cleanBucketKey, raw));
  }

  function logRateLimitSecurityEvent(
    socket: PacketRecord,
    player: PacketRecord | null | undefined,
    scope: unknown,
    bucketKey: unknown,
    limits: RateLimitConfig | undefined,
    result: PacketRecord = {},
    data: unknown = null
  ): void {
    const cleanScope = String(scope || "message").trim().toLowerCase() || "message";
    const cleanBucketKey = String(bucketKey || "unknown").trim().toLowerCase() || "unknown";
    const now = Date.now();
    const key = `${cleanScope}:${cleanBucketKey}`;
    const warnings = ensureSocketMap(socket, "rateLimitSecurityWarnings");
    const lastLoggedAt = Number(warnings.get(key) || 0);
    if (now - lastLoggedAt < Math.max(1000, Math.trunc(Number(deps.botRateLimitSecurityLogWindowMs) || 5000))) return;

    warnings.set(key, now);
    deps.logSecurityEvent(
      socket,
      player,
      "rate_limit_exceeded",
      deps.messageRouterHelpers.buildRateLimitSecurityEventDetails(
        cleanScope,
        cleanBucketKey,
        limits,
        result,
        data,
        player,
        getRateLimitSubject(socket, player)
      ),
      cleanScope === "bot" ? "warning" : "info"
    );
  }

  async function consumeScopedRateLimit(
    socket: PacketRecord,
    player: PacketRecord | null | undefined,
    scope: unknown,
    bucketKey: unknown,
    limits: RateLimitConfig | undefined,
    data: unknown = null,
    options: PacketRecord = {}
  ): Promise<boolean> {
    const safeLimits = cleanRateLimitConfig(limits, defaultRateLimit);
    const cleanScope = String(scope || "message").trim().toLowerCase() || "message";
    const cleanBucketKey = String(bucketKey || "unknown").trim().toLowerCase() || "unknown";

    if (typeof deps.redisStore?.isReady === "function" && deps.redisStore.isReady() && typeof deps.redisStore.checkRateLimit === "function") {
      const subject = getRateLimitSubject(socket, player);
      const result = await deps.redisStore.checkRateLimit(`${cleanScope}:${cleanBucketKey}`, subject, safeLimits.limit, safeLimits.windowMs);
      if (result.allowed) {
        return true;
      }

      recordRateLimitRejection(cleanScope);
      notifyRateLimited(socket, cleanBucketKey, data);
      if (options.logSecurityEvent) {
        logRateLimitSecurityEvent(socket, player, cleanScope, cleanBucketKey, safeLimits, result, data);
      }
      return false;
    }

    const now = Date.now();
    const localBucketKey = `${cleanScope}:${cleanBucketKey}`;
    const rateLimits = ensureSocketMap(socket, "rateLimits");
    const bucket = rateLimits.get(localBucketKey) || {
      count: 0,
      resetAt: now + safeLimits.windowMs,
    };

    if (now >= Number(bucket.resetAt || 0)) {
      bucket.count = 0;
      bucket.resetAt = now + safeLimits.windowMs;
    }

    bucket.count = Math.trunc(Number(bucket.count) || 0) + 1;
    rateLimits.set(localBucketKey, bucket);

    if (bucket.count <= safeLimits.limit) {
      return true;
    }

    recordRateLimitRejection(cleanScope);
    notifyRateLimited(socket, cleanBucketKey, data);
    if (options.logSecurityEvent) {
      logRateLimitSecurityEvent(socket, player, cleanScope, cleanBucketKey, safeLimits, {
        allowed: false,
        fallback: true,
        count: bucket.count,
        resetInMs: Math.max(0, Number(bucket.resetAt || now) - now),
      }, data);
    }
    return false;
  }

  function recordRateLimitRejection(scope: string): void {
    const key = scope === "bot" ? "bot_rate_limit_rejections" : "message_rate_limit_rejections";
    deps.playerNetworkStats[key] = Number(deps.playerNetworkStats[key] || 0) + 1;
  }

  async function checkMessageRateLimit(socket: PacketRecord, player: PacketRecord | null | undefined, messageType: unknown, data: unknown = null): Promise<boolean> {
    const decision = deps.messageRouterHelpers.getMessageRateLimitDecision(messageType, data);
    return consumeScopedRateLimit(socket, player, "message", decision.bucketKey, decision.limits, data);
  }

  function getBotRateLimitAction(messageType: unknown, data: unknown = {}): string {
    return deps.messageRouterHelpers.getBotRateLimitAction(messageType, data);
  }

  async function checkBotActionRateLimit(socket: PacketRecord, player: PacketRecord | null | undefined, messageType: unknown, data: unknown = null): Promise<boolean> {
    const decision = deps.messageRouterHelpers.getBotRateLimitDecision(messageType, data || {});
    if (decision.actionKey === "") return true;
    if (!decision.limits) return true;
    return consumeScopedRateLimit(socket, player, "bot", decision.actionKey, decision.limits, data, {
      logSecurityEvent: true,
    });
  }

  return {
    checkBotActionRateLimit,
    checkMessageRateLimit,
    consumeScopedRateLimit,
    getBotRateLimitAction,
    getRateLimitSubject,
    logRateLimitSecurityEvent,
    notifyRateLimited,
  };
}

export = {
  createServerBotRateLimitHelpers,
  createServerBotRateLimitTables,
};
