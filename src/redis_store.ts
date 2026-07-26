/// <reference path="../types/pixelmania-contracts.d.ts" />
"use strict";

import crypto = require("node:crypto");

const DEFAULT_SCAN_COUNT = 200;
const HEALTH_CACHE_TTL_MS = 5000;
const LOCK_TTL_SAMPLE_LIMIT = 16;
const RATE_LIMIT_INCREMENT_SCRIPT = [
  "local count = redis.call('INCR', KEYS[1])",
  "local ttl = redis.call('PTTL', KEYS[1])",
  "if count == 1 or ttl < 0 then",
  "  redis.call('PEXPIRE', KEYS[1], ARGV[1])",
  "  ttl = tonumber(ARGV[1])",
  "end",
  "return {count, ttl}",
].join("\n");

type RedisRecord = Record<string, unknown>;
type RedisHealthSnapshot = PixelMania.RedisHealthSnapshot;
type RedisLockResult = PixelMania.RedisLockResult;
type RedisNetfoxMovementRouteDeleteResult = PixelMania.RedisNetfoxMovementRouteDeleteResult;
type RedisNetfoxMovementRouteGetResult = PixelMania.RedisNetfoxMovementRouteGetResult;
type RedisNetfoxMovementRouteSetResult = PixelMania.RedisNetfoxMovementRouteSetResult;
type RedisRateLimitResult = PixelMania.RedisRateLimitResult;
type RedisStoreOptions = PixelMania.RedisStoreOptions;
type RedisWorldAdmissionCountResult = PixelMania.RedisWorldAdmissionCountResult;
type RedisWorldAdmissionReleaseResult = PixelMania.RedisWorldAdmissionReleaseResult;
type RedisWorldAdmissionResult = PixelMania.RedisWorldAdmissionResult;
type RedisWorldRouteReleaseResult = PixelMania.RedisWorldRouteReleaseResult;
type RedisWorldRouteResult = PixelMania.RedisWorldRouteResult;
type RedisScanReply = { cursor: string; keys: string[] };
type RedisClientLike = {
  isOpen?: boolean;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  destroy?: () => void;
  disconnect?: () => Promise<unknown>;
  on(eventName: string, listener: (...args: unknown[]) => void): unknown;
  sendCommand(command: string[]): Promise<unknown>;
};

let createClient: null | ((options: Record<string, unknown>) => RedisClientLike) = null;
try {
  ({ createClient } = require("redis") as { createClient: typeof createClient });
} catch {
  createClient = null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function clean(value: unknown): string {
  return String(value || "").trim();
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function toInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function safeKeyPart(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .slice(0, 160) || "unknown";
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error ? String(error.message || "") : String(error || "");
}

class RedisStore {
  enabled: boolean;
  url: string;
  keyPrefix: string;
  logger: (...args: unknown[]) => void;
  connectTimeoutMs: number;
  client: RedisClientLike | null;
  ready: boolean;
  lastErrorLogAt: number;
  healthCache: { value: RedisHealthSnapshot | null; expiresAtMs: number };

  /**
   * @param {RedisStoreOptions} options
   */
  constructor(options: RedisStoreOptions = {}) {
    this.enabled = Boolean(options.enabled);
    this.url = clean(options.url || "redis://127.0.0.1:6379");
    this.keyPrefix = safeKeyPart(options.keyPrefix || "pixelmania");
    /** @type {(...args: unknown[]) => void} */
    this.logger = typeof options.logger === "function" ? options.logger : ((...args: unknown[]) => console.warn(...args));
    this.connectTimeoutMs = Math.max(250, toInt(options.connectTimeoutMs, 1500));
    /** @type {any} */
    this.client = null;
    this.ready = false;
    this.lastErrorLogAt = 0;
    /** @type {{ value: RedisHealthSnapshot | null, expiresAtMs: number }} */
    this.healthCache = { value: null, expiresAtMs: 0 };
  }

  isReady(): boolean {
    return Boolean(this.enabled && this.client && this.ready);
  }

  /**
   * @param {...unknown} parts
   * @returns {string}
   */
  key(...parts: unknown[]): string {
    return [this.keyPrefix, ...parts.map(safeKeyPart)].join(":");
  }

  /**
   * @param {...unknown} parts
   * @returns {string}
   */
  pattern(...parts: unknown[]): string {
    return [this.keyPrefix, ...parts.map((part) => clean(part) === "*" ? "*" : safeKeyPart(part))].join(":");
  }

  /**
   * @param {string} label
   * @param {unknown} error
   * @returns {void}
   */
  logFailure(label: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt < 10000) return;
    this.lastErrorLogAt = now;
    this.logger(`[redis] ${label} failed:`, errorMessage(error));
  }

  /**
   * @param {unknown} reply
   * @returns {{ cursor: string, keys: string[] } | null}
   */
  _parseScanReply(reply: unknown): RedisScanReply | null {
    if (!Array.isArray(reply) || reply.length < 2) return null;

    const nextCursor = String(reply[0] || "0");
    const rawKeys = Array.isArray(reply[1]) ? reply[1] : [];
    const keys: string[] = [];

    for (const key of rawKeys) {
      if (key === undefined || key === null) continue;
      keys.push(String(key));
    }

    return { cursor: nextCursor, keys };
  }

  /**
   * @param {string} pattern
   * @param {number} maxKeys
   * @returns {Promise<string[]>}
   */
  async _scanKeys(pattern: string, maxKeys = 0): Promise<string[]> {
    if (!this.isReady()) return [];

    const keys: string[] = [];
    const max = Math.max(0, Math.trunc(maxKeys));
    let cursor = "0";

    do {
      const reply = await this.client!.sendCommand([
        "SCAN",
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        String(DEFAULT_SCAN_COUNT),
      ]);
      const parsed = this._parseScanReply(reply);
      if (!parsed) break;

      for (const key of parsed.keys) {
        keys.push(key);
        if (max > 0 && keys.length >= max) {
          return keys;
        }
      }

      cursor = parsed.cursor;
    } while (cursor !== "0");

    return keys;
  }

  /**
   * @param {string} pattern
   * @returns {Promise<number>}
   */
  async _countKeys(pattern: string): Promise<number> {
    if (!this.isReady()) return 0;

    let cursor = "0";
    let count = 0;

    do {
      const reply = await this.client!.sendCommand([
        "SCAN",
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        String(DEFAULT_SCAN_COUNT),
      ]);
      const parsed = this._parseScanReply(reply);
      if (!parsed) break;

      count += parsed.keys.length;
      cursor = parsed.cursor;
    } while (cursor !== "0");

    return count;
  }

  /**
   * @param {number[]} ttlValues
   * @returns {RedisHealthSnapshot["lock_ttl_ms"]}
   */
  _summarizeTtls(ttlValues: number[]): RedisHealthSnapshot["lock_ttl_ms"] {
    const valid = ttlValues.filter((value) => Number.isFinite(value) && value >= 0);
    if (!valid.length) {
      return {
        sample_size: ttlValues.length,
        min_ttl_ms: null,
        max_ttl_ms: null,
        avg_ttl_ms: null,
        stale_count: ttlValues.filter((value) => value < 0).length,
        near_expiry_count: 0,
      };
    }

    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const avg = Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
    const nearExpiryCount = valid.filter((value) => value <= 1000).length;

    return {
      sample_size: ttlValues.length,
      min_ttl_ms: min,
      max_ttl_ms: max,
      avg_ttl_ms: avg,
      stale_count: ttlValues.filter((value) => value < 0).length,
      near_expiry_count: nearExpiryCount,
    };
  }

  /**
   * @returns {Promise<RedisHealthSnapshot>}
   */
  async getHealthSnapshot(): Promise<RedisHealthSnapshot> {
    const now = Date.now();
    if (this.healthCache.value && this.healthCache.expiresAtMs > now) {
      return this.healthCache.value;
    }

    if (!this.isReady()) {
      const snapshot = {
        enabled: Boolean(this.enabled),
        ready: false,
        key_prefix: this.keyPrefix,
        key_counts: {
          locks: 0,
          presence: 0,
          active_sessions: 0,
          world_admissions: 0,
          world_routes: 0,
          netfox_movement_routes: 0,
        },
        lock_ttl_ms: {
          sample_size: 0,
          min_ttl_ms: null,
          max_ttl_ms: null,
          avg_ttl_ms: null,
          stale_count: 0,
          near_expiry_count: 0,
        },
      };
      return snapshot;
    }

    try {
      const [lockCount, presenceCount, activeSessionCount, worldAdmissionCount, worldRouteCount, netfoxMovementRouteCount, lockKeySamples] = await Promise.all([
        this._countKeys(this.pattern("lock", "*", "*")),
        this._countKeys(this.pattern("presence", "*")),
        this._countKeys(this.pattern("active_session", "*")),
        this._countKeys(this.pattern("world_admission", "*")),
        this._countKeys(this.pattern("world_route_owner", "*")),
        this._countKeys(this.pattern("netfox_movement_route", "*")),
        this._scanKeys(this.pattern("lock", "*", "*"), LOCK_TTL_SAMPLE_LIMIT),
      ]);

      const ttlSamples = (await Promise.all(lockKeySamples.map((key) => this.client!.sendCommand(["PTTL", key]))))
        .map((value) => Number(value));

      const snapshot = {
        enabled: true,
        ready: true,
        key_prefix: this.keyPrefix,
        key_counts: {
          locks: lockCount,
          presence: presenceCount,
          active_sessions: activeSessionCount,
          world_admissions: worldAdmissionCount,
          world_routes: worldRouteCount,
          netfox_movement_routes: netfoxMovementRouteCount,
        },
        lock_ttl_ms: this._summarizeTtls(ttlSamples),
      };

      this.healthCache = {
        value: snapshot,
        expiresAtMs: now + HEALTH_CACHE_TTL_MS,
      };

      return snapshot;
    } catch (error) {
      this.logFailure("health snapshot", error);
      /** @type {RedisHealthSnapshot} */
      const fallbackSnapshot = {
          enabled: true,
          ready: this.ready,
          key_prefix: this.keyPrefix,
          error: errorMessage(error) || "failed to collect redis health",
          key_counts: {
            locks: 0,
            presence: 0,
            active_sessions: 0,
            world_admissions: 0,
            world_routes: 0,
            netfox_movement_routes: 0,
          },
          lock_ttl_ms: {
            sample_size: 0,
            min_ttl_ms: null,
            max_ttl_ms: null,
            avg_ttl_ms: null,
            stale_count: 0,
            near_expiry_count: 0,
          },
        };
      this.healthCache = {
        value: fallbackSnapshot,
        expiresAtMs: now + HEALTH_CACHE_TTL_MS,
      };
      return fallbackSnapshot;
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async init(): Promise<void> {
    if (!this.enabled) return;
    if (!createClient) {
      this.enabled = false;
      this.logger("[redis] disabled because package 'redis' is not installed.");
      return;
    }

    this.client = createClient({
      url: this.url,
      socket: {
        reconnectStrategy: (retries: number) => Math.min(500 + retries * 250, 5000),
      },
    });

    this.client!.on("ready", () => {
      this.ready = true;
    });
    this.client!.on("end", () => {
      this.ready = false;
    });
    this.client!.on("error", (error: unknown) => {
      this.ready = false;
      this.logFailure("client", error);
    });

    let connectPromise: Promise<unknown> | null = null;
    try {
      connectPromise = this.client!.connect();
      await Promise.race([
        connectPromise,
        delay(this.connectTimeoutMs).then(() => {
          throw new Error(`connect timeout after ${this.connectTimeoutMs}ms`);
        }),
      ]);
      await this.client!.sendCommand(["PING"]);
      this.ready = true;
      this.logger("[redis] connected.");
    } catch (error) {
      if (connectPromise) connectPromise.catch(() => null);
      this.ready = false;
      try {
        if (this.client && typeof this.client!.destroy === "function") {
          this.client!.destroy();
        } else if (this.client && typeof this.client!.disconnect === "function") {
          this.client!.disconnect().catch(() => null);
        }
      } catch {
        // Ignore cleanup errors after a failed Redis connect.
      }
      this.client = null;
      this.logFailure("initialization", error);
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async close(): Promise<void> {
    if (!this.client) return;
    try {
      if (this.client!.isOpen) {
        await this.client!.quit();
      }
    } catch {
      // Ignore shutdown errors.
    } finally {
      this.healthCache = { value: null, expiresAtMs: 0 };
      this.ready = false;
    }
  }

  /**
   * @param {string} scope
   * @param {string} subject
   * @param {number} limit
   * @param {number} windowMs
   * @returns {Promise<RedisRateLimitResult>}
   */
  async checkRateLimit(scope: string, subject: string, limit: number, windowMs: number): Promise<RedisRateLimitResult> {
    if (!this.isReady()) {
      return { allowed: true, fallback: true, count: 0, resetInMs: windowMs };
    }

    const safeLimit = Math.max(1, toInt(limit, 1));
    const safeWindowMs = Math.max(100, toInt(windowMs, 1000));
    const key = this.key("rate", scope, subject);

    try {
      const result = await this.client!.sendCommand([
        "EVAL",
        RATE_LIMIT_INCREMENT_SCRIPT,
        "1",
        key,
        String(safeWindowMs),
      ]);
      const values = Array.isArray(result) ? result : [];
      const count = Math.max(0, toInt(values[0], 0));
      const ttl = toInt(values[1], safeWindowMs);
      return {
        allowed: count <= safeLimit,
        fallback: false,
        count,
        resetInMs: Math.max(0, ttl),
      };
    } catch (error) {
      this.logFailure("rate limit", error);
      return { allowed: true, fallback: true, count: 0, resetInMs: safeWindowMs };
    }
  }

  /**
   * @param {string} scope
   * @param {string} resource
   * @param {number} ttlMs
   * @param {string} owner
   * @returns {Promise<RedisLockResult>}
   */
  async acquireLock(scope: string, resource: string, ttlMs: number, owner = ""): Promise<RedisLockResult> {
    if (!this.isReady()) {
      return { acquired: true, fallback: true, key: "", token: "" };
    }

    const safeTtlMs = Math.max(250, toInt(ttlMs, 5000));
    const key = this.key("lock", scope, resource);
    const token = clean(owner) || crypto.randomUUID();

    try {
      const result = await this.client!.sendCommand(["SET", key, token, "PX", String(safeTtlMs), "NX"]);
      return {
        acquired: result === "OK",
        fallback: false,
        key,
        token,
      };
    } catch (error) {
      this.logFailure("lock acquire", error);
      return { acquired: true, fallback: true, key: "", token: "" };
    }
  }

  /**
   * @param {RedisLockResult | null | undefined} lock
   * @returns {Promise<void>}
   */
  async releaseLock(lock: RedisLockResult | null | undefined): Promise<void> {
    if (!this.isReady() || !lock || lock.fallback || !lock.key || !lock.token) return;

    try {
      await this.client!.sendCommand([
        "EVAL",
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        "1",
        lock.key,
        lock.token,
      ]);
    } catch (error) {
      this.logFailure("lock release", error);
    }
  }

  /**
   * @param {string} worldName
   * @param {string} playerId
   * @param {number} maxPlayers
   * @param {number} ttlMs
   * @returns {Promise<RedisWorldAdmissionResult>}
   */
  async reserveWorldAdmission(worldName: string, playerId: string, maxPlayers: number, ttlMs: number): Promise<RedisWorldAdmissionResult> {
    if (!this.isReady()) {
      return { ok: true, fallback: true, count: 0, key: "" };
    }

    const cleanWorldName = clean(worldName);
    const cleanPlayerId = clean(playerId);
    if (cleanWorldName === "" || cleanPlayerId === "") {
      return { ok: false, fallback: false, count: 0, key: "", reason: "invalid_world_admission" };
    }

    const safeMaxPlayers = Math.max(1, toInt(maxPlayers, 50));
    const safeTtlMs = Math.max(10000, toInt(ttlMs, 45000));
    const now = Date.now();
    const key = this.key("world_admission", cleanWorldName);

    try {
      const reply = await this.client!.sendCommand([
        "EVAL",
        [
          "local key = KEYS[1]",
          "local player_id = ARGV[1]",
          "local now_ms = tonumber(ARGV[2])",
          "local ttl_ms = tonumber(ARGV[3])",
          "local max_players = tonumber(ARGV[4])",
          "redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms)",
          "local existing = redis.call('ZSCORE', key, player_id)",
          "if existing then",
          "  redis.call('ZADD', key, now_ms + ttl_ms, player_id)",
          "  redis.call('PEXPIRE', key, ttl_ms)",
          "  return {1, redis.call('ZCARD', key)}",
          "end",
          "local count = redis.call('ZCARD', key)",
          "if count >= max_players then",
          "  return {0, count}",
          "end",
          "redis.call('ZADD', key, now_ms + ttl_ms, player_id)",
          "redis.call('PEXPIRE', key, ttl_ms)",
          "return {1, count + 1}",
        ].join("\n"),
        "1",
        key,
        cleanPlayerId,
        String(now),
        String(safeTtlMs),
        String(safeMaxPlayers),
      ]);
      const values = Array.isArray(reply) ? reply : [];
      const ok = toInt(values[0], 0) === 1;
      const count = Math.max(0, toInt(values[1], 0));
      return {
        ok,
        fallback: false,
        count,
        key,
        reason: ok ? "" : "world_full",
      };
    } catch (error) {
      this.logFailure("world admission reserve", error);
      return { ok: true, fallback: true, count: 0, key: "" };
    }
  }

  /**
   * @param {string} worldName
   * @param {string} playerId
   * @param {number} maxPlayers
   * @param {number} ttlMs
   * @returns {Promise<RedisWorldAdmissionResult>}
   */
  async refreshWorldAdmission(worldName: string, playerId: string, maxPlayers: number, ttlMs: number): Promise<RedisWorldAdmissionResult> {
    return this.reserveWorldAdmission(worldName, playerId, maxPlayers, ttlMs);
  }

  /**
   * @param {string} worldName
   * @param {string} playerId
   * @returns {Promise<RedisWorldAdmissionReleaseResult>}
   */
  async releaseWorldAdmission(worldName: string, playerId: string): Promise<RedisWorldAdmissionReleaseResult> {
    if (!this.isReady()) return { released: false, fallback: true, count: 0 };

    const cleanWorldName = clean(worldName);
    const cleanPlayerId = clean(playerId);
    if (cleanWorldName === "" || cleanPlayerId === "") {
      return { released: false, fallback: false, count: 0 };
    }

    const key = this.key("world_admission", cleanWorldName);
    try {
      const reply = await this.client!.sendCommand([
        "EVAL",
        [
          "local key = KEYS[1]",
          "local player_id = ARGV[1]",
          "redis.call('ZREM', key, player_id)",
          "local count = redis.call('ZCARD', key)",
          "if count == 0 then redis.call('DEL', key) end",
          "return count",
        ].join("\n"),
        "1",
        key,
        cleanPlayerId,
      ]);
      return { released: true, fallback: false, count: Math.max(0, toInt(reply, 0)) };
    } catch (error) {
      this.logFailure("world admission release", error);
      return { released: false, fallback: true, count: 0 };
    }
  }

  /**
   * @param {string} worldName
   * @returns {Promise<RedisWorldAdmissionCountResult>}
   */
  async getWorldAdmissionCount(worldName: string): Promise<RedisWorldAdmissionCountResult> {
    if (!this.isReady()) return { ok: false, fallback: true, count: 0 };

    const cleanWorldName = clean(worldName);
    if (cleanWorldName === "") return { ok: false, fallback: false, count: 0 };

    const now = Date.now();
    const key = this.key("world_admission", cleanWorldName);
    try {
      const reply = await this.client!.sendCommand([
        "EVAL",
        "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); return redis.call('ZCARD', KEYS[1])",
        "1",
        key,
        String(now),
      ]);
      return { ok: true, fallback: false, count: Math.max(0, toInt(reply, 0)) };
    } catch (error) {
      this.logFailure("world admission count", error);
      return { ok: false, fallback: true, count: 0 };
    }
  }

  /**
   * @param {string} worldName
   * @param {string} instanceId
   * @param {string} wsUrl
   * @param {number} ttlMs
   * @returns {Promise<RedisWorldRouteResult>}
   */
  async claimWorldRoute(worldName: string, instanceId: string, wsUrl: string, ttlMs: number, claimantId = ""): Promise<RedisWorldRouteResult> {
    const cleanClaimantId = clean(claimantId) || `${clean(instanceId)}:local`;
    if (!this.isReady()) {
      return {
        ok: true,
        fallback: true,
        world: clean(worldName),
        owner_instance_id: clean(instanceId),
        ws_url: clean(wsUrl),
        ownership_token: `${cleanClaimantId}:0`,
        ownership_epoch: 0,
      };
    }

    const cleanWorldName = clean(worldName);
    const cleanInstanceId = clean(instanceId);
    const cleanWsUrl = clean(wsUrl);
    if (cleanWorldName === "" || cleanInstanceId === "") {
      return { ok: false, fallback: false, reason: "invalid_world_route", world: cleanWorldName };
    }

    const safeTtlMs = Math.max(10000, toInt(ttlMs, 45000));
    const ownerKey = this.key("world_route_owner", cleanWorldName);
    const targetKey = this.key("world_route_target", cleanWorldName);
    const tokenKey = this.key("world_route_token", cleanWorldName);
    const epochKey = this.key("world_route_epoch", cleanWorldName);

    try {
      const reply = await this.client!.sendCommand([
        "EVAL",
        [
          "local owner_key = KEYS[1]",
          "local target_key = KEYS[2]",
          "local token_key = KEYS[3]",
          "local epoch_key = KEYS[4]",
          "local instance_id = ARGV[1]",
          "local ws_url = ARGV[2]",
          "local ttl_ms = tonumber(ARGV[3])",
          "local claimant_id = ARGV[4]",
          "local current_owner = redis.call('GET', owner_key)",
          "local current_token = redis.call('GET', token_key)",
          "if current_owner and current_owner ~= instance_id then",
          "  return {0, current_owner, redis.call('GET', target_key) or '', current_token or '', redis.call('GET', epoch_key) or '0'}",
          "end",
          "if current_owner and current_token and string.sub(current_token, 1, string.len(claimant_id) + 1) ~= claimant_id .. ':' then",
          "  return {0, current_owner, redis.call('GET', target_key) or '', current_token, redis.call('GET', epoch_key) or '0'}",
          "end",
          "if current_owner and not current_token then",
          "  local next_epoch = redis.call('INCR', epoch_key)",
          "  current_token = claimant_id .. ':' .. tostring(next_epoch)",
          "end",
          "if not current_owner then",
          "  local next_epoch = redis.call('INCR', epoch_key)",
          "  current_token = claimant_id .. ':' .. tostring(next_epoch)",
          "end",
          "redis.call('SET', owner_key, instance_id, 'PX', ttl_ms)",
          "redis.call('SET', target_key, ws_url, 'PX', ttl_ms)",
          "redis.call('SET', token_key, current_token, 'PX', ttl_ms)",
          "return {1, instance_id, ws_url, current_token, redis.call('GET', epoch_key) or '0'}",
        ].join("\n"),
        "4",
        ownerKey,
        targetKey,
        tokenKey,
        epochKey,
        cleanInstanceId,
        cleanWsUrl,
        String(safeTtlMs),
        cleanClaimantId,
      ]);

      const values = Array.isArray(reply) ? reply : [];
      const ok = toInt(values[0], 0) === 1;
      const ownerInstanceId = clean(values[1] || "");
      const routeWsUrl = clean(values[2] || "");
      const ownershipToken = clean(values[3] || "");
      const ownershipEpoch = Math.max(0, toInt(values[4], 0));
      return {
        ok,
        fallback: false,
        reason: ok ? "" : "world_route_conflict",
        world: cleanWorldName,
        owner_instance_id: ownerInstanceId,
        ws_url: routeWsUrl,
        owner_key: ownerKey,
        target_key: targetKey,
        ownership_token: ownershipToken,
        ownership_epoch: ownershipEpoch,
        token_key: tokenKey,
        epoch_key: epochKey,
      };
    } catch (error) {
      this.logFailure("world route claim", error);
      return {
        ok: false,
        fallback: true,
        reason: "redis_error",
        world: cleanWorldName,
        owner_instance_id: "",
        ws_url: "",
      };
    }
  }

  /**
   * @param {string} worldName
   * @param {string} instanceId
   * @param {string} wsUrl
   * @param {number} ttlMs
   * @returns {Promise<RedisWorldRouteResult>}
   */
  async refreshWorldRoute(worldName: string, instanceId: string, wsUrl: string, ttlMs: number, claimantId = ""): Promise<RedisWorldRouteResult> {
    return this.claimWorldRoute(worldName, instanceId, wsUrl, ttlMs, claimantId);
  }

  /**
   * @param {string} worldName
   * @returns {Promise<RedisWorldRouteResult>}
   */
  async getWorldRoute(worldName: string): Promise<RedisWorldRouteResult> {
    if (!this.isReady()) return { ok: false, fallback: true, world: clean(worldName), owner_instance_id: "", ws_url: "" };

    const cleanWorldName = clean(worldName);
    if (cleanWorldName === "") return { ok: false, fallback: false, reason: "invalid_world_route", world: cleanWorldName };

    const ownerKey = this.key("world_route_owner", cleanWorldName);
    const targetKey = this.key("world_route_target", cleanWorldName);
    const tokenKey = this.key("world_route_token", cleanWorldName);
    const epochKey = this.key("world_route_epoch", cleanWorldName);
    try {
      const [ownerInstanceId, routeWsUrl, ownershipToken, ownershipEpoch] = await Promise.all([
        this.client!.sendCommand(["GET", ownerKey]),
        this.client!.sendCommand(["GET", targetKey]),
        this.client!.sendCommand(["GET", tokenKey]),
        this.client!.sendCommand(["GET", epochKey]),
      ]);
      const owner = clean(ownerInstanceId || "");
      return {
        ok: owner !== "",
        fallback: false,
        reason: owner === "" ? "not_found" : "",
        world: cleanWorldName,
        owner_instance_id: owner,
        ws_url: clean(routeWsUrl || ""),
        ownership_token: clean(ownershipToken || ""),
        ownership_epoch: Math.max(0, toInt(ownershipEpoch, 0)),
        owner_key: ownerKey,
        target_key: targetKey,
        token_key: tokenKey,
        epoch_key: epochKey,
      };
    } catch (error) {
      this.logFailure("world route get", error);
      return { ok: false, fallback: true, reason: "redis_error", world: cleanWorldName, owner_instance_id: "", ws_url: "" };
    }
  }

  /**
   * @param {string} worldName
   * @param {string} instanceId
   * @returns {Promise<RedisWorldRouteReleaseResult>}
   */
  async releaseWorldRoute(worldName: string, instanceId: string, ownershipToken = ""): Promise<RedisWorldRouteReleaseResult> {
    if (!this.isReady()) return { released: false, fallback: true };

    const cleanWorldName = clean(worldName);
    const cleanInstanceId = clean(instanceId);
    const cleanOwnershipToken = clean(ownershipToken);
    if (cleanWorldName === "" || cleanInstanceId === "" || cleanOwnershipToken === "") {
      return { released: false, fallback: false, reason: "invalid_world_route_release" };
    }

    const ownerKey = this.key("world_route_owner", cleanWorldName);
    const targetKey = this.key("world_route_target", cleanWorldName);
    const tokenKey = this.key("world_route_token", cleanWorldName);
    try {
      const reply = await this.client!.sendCommand([
        "EVAL",
        [
          "if redis.call('GET', KEYS[1]) == ARGV[1] and redis.call('GET', KEYS[3]) == ARGV[2] then",
          "  return redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])",
          "end",
          "return 0",
        ].join("\n"),
        "3",
        ownerKey,
        targetKey,
        tokenKey,
        cleanInstanceId,
        cleanOwnershipToken,
      ]);
      return { released: toInt(reply, 0) > 0, fallback: false };
    } catch (error) {
      this.logFailure("world route release", error);
      return { released: false, fallback: true };
    }
  }

  /**
   * @param {string} worldName
   * @param {RedisRecord} route
   * @param {number} ttlMs
   * @returns {Promise<RedisNetfoxMovementRouteSetResult>}
   */
  async setNetfoxMovementRoute(worldName: string, route: RedisRecord, ttlMs: number): Promise<RedisNetfoxMovementRouteSetResult> {
    const cleanWorldName = clean(worldName);
    if (!this.isReady()) {
      return { ok: true, fallback: true, world: cleanWorldName };
    }
    if (cleanWorldName === "" || !route || typeof route !== "object" || Array.isArray(route)) {
      return { ok: false, fallback: false, reason: "invalid_netfox_movement_route", world: cleanWorldName };
    }

    const safeTtlMs = Math.max(5000, toInt(ttlMs, 45000));
    const key = this.key("netfox_movement_route", cleanWorldName);
    const payload = {
      ...route,
      world: cleanWorldName,
      world_id: cleanWorldName,
    };

    try {
      await this.client!.sendCommand(["SET", key, JSON.stringify(payload), "PX", String(safeTtlMs)]);
      return { ok: true, fallback: false, world: cleanWorldName, key };
    } catch (error) {
      this.logFailure("netfox movement route set", error);
      return { ok: false, fallback: true, reason: "redis_error", world: cleanWorldName };
    }
  }

  /**
   * @param {string} worldName
   * @returns {Promise<RedisNetfoxMovementRouteGetResult>}
   */
  async getNetfoxMovementRoute(worldName: string): Promise<RedisNetfoxMovementRouteGetResult> {
    const cleanWorldName = clean(worldName);
    if (!this.isReady()) {
      return { ok: false, fallback: true, reason: "redis_unavailable", world: cleanWorldName, route: null };
    }
    if (cleanWorldName === "") {
      return { ok: false, fallback: false, reason: "invalid_netfox_movement_route", world: cleanWorldName, route: null };
    }

    const key = this.key("netfox_movement_route", cleanWorldName);
    try {
      const raw = await this.client!.sendCommand(["GET", key]);
      if (!raw) {
        return { ok: false, fallback: false, reason: "not_found", world: cleanWorldName, route: null };
      }

      let route: RedisRecord | null = null;
      try {
        route = JSON.parse(String(raw));
      } catch (_error) {
        await this.client!.sendCommand(["DEL", key]);
        return { ok: false, fallback: false, reason: "invalid_json", world: cleanWorldName, route: null };
      }

      if (!route || typeof route !== "object" || Array.isArray(route)) {
        await this.client!.sendCommand(["DEL", key]);
        return { ok: false, fallback: false, reason: "invalid_payload", world: cleanWorldName, route: null };
      }

      return {
        ok: true,
        fallback: false,
        world: cleanWorldName,
        route: { ...route, world: cleanWorldName, world_id: cleanWorldName },
      };
    } catch (error) {
      this.logFailure("netfox movement route get", error);
      return { ok: false, fallback: true, reason: "redis_error", world: cleanWorldName, route: null };
    }
  }

  /**
   * @param {string} worldName
   * @returns {Promise<RedisNetfoxMovementRouteDeleteResult>}
   */
  async deleteNetfoxMovementRoute(worldName: string): Promise<RedisNetfoxMovementRouteDeleteResult> {
    const cleanWorldName = clean(worldName);
    if (!this.isReady() || cleanWorldName === "") return { deleted: false, fallback: !this.isReady() };

    try {
      const deleted = await this.client!.sendCommand(["DEL", this.key("netfox_movement_route", cleanWorldName)]);
      return { deleted: toInt(deleted, 0) > 0, fallback: false };
    } catch (error) {
      this.logFailure("netfox movement route delete", error);
      return { deleted: false, fallback: true };
    }
  }

  /**
   * @param {string} username
   * @param {string} playerId
   * @param {number} ttlMs
   * @returns {Promise<boolean>}
   */
  async setActiveSession(username: string, playerId: string, ttlMs: number): Promise<boolean> {
    if (!this.isReady()) return false;
    const cleanUsername = clean(username);
    const cleanPlayerId = clean(playerId);
    if (cleanUsername === "" || cleanPlayerId === "") return false;

    try {
      await this.client!.sendCommand([
        "SET",
        this.key("active_session", cleanUsername),
        cleanPlayerId,
        "PX",
        String(Math.max(1000, toInt(ttlMs, 60000))),
      ]);
      return true;
    } catch (error) {
      this.logFailure("active session set", error);
      return false;
    }
  }

  /**
   * @param {string} username
   * @param {string} playerId
   * @returns {Promise<void>}
   */
  async clearActiveSession(username: string, playerId = ""): Promise<void> {
    if (!this.isReady()) return;
    const cleanUsername = clean(username);
    if (cleanUsername === "") return;
    const key = this.key("active_session", cleanUsername);
    const expectedPlayerId = clean(playerId);

    try {
      if (expectedPlayerId === "") {
        await this.client!.sendCommand(["DEL", key]);
        return;
      }

      await this.client!.sendCommand([
        "EVAL",
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        "1",
        key,
        expectedPlayerId,
      ]);
    } catch (error) {
      this.logFailure("active session clear", error);
    }
  }

  /**
   * @param {string} username
   * @param {RedisRecord} presence
   * @param {number} ttlMs
   * @returns {Promise<boolean>}
   */
  async setPresence(username: string, presence: RedisRecord, ttlMs: number): Promise<boolean> {
    if (!this.isReady()) return false;
    const cleanUsername = clean(username);
    if (cleanUsername === "") return false;

    try {
      await this.client!.sendCommand([
        "SET",
        this.key("presence", cleanUsername),
        JSON.stringify(presence && typeof presence === "object" && !Array.isArray(presence) ? presence : {}),
        "PX",
        String(Math.max(1000, toInt(ttlMs, 45000))),
      ]);
      return true;
    } catch (error) {
      this.logFailure("presence set", error);
      return false;
    }
  }

  /**
   * Returns current presence records across every websocket route sharing this
   * Redis key prefix. Expired records are omitted by Redis automatically.
   *
   * @param {number} maxEntries
   * @returns {Promise<RedisRecord[]>}
   */
  async listPresence(maxEntries = 5000): Promise<RedisRecord[]> {
    if (!this.isReady()) return [];

    const limit = Math.max(1, Math.min(10000, toInt(maxEntries, 5000)));
    try {
      const keys = await this._scanKeys(this.pattern("presence", "*"), limit);
      if (keys.length === 0) return [];

      const records: RedisRecord[] = [];
      const batchSize = 250;
      for (let offset = 0; offset < keys.length; offset += batchSize) {
        const batch = keys.slice(offset, offset + batchSize);
        const reply = await this.client!.sendCommand(["MGET", ...batch]);
        if (!Array.isArray(reply)) continue;

        for (const rawValue of reply) {
          if (rawValue === undefined || rawValue === null) continue;
          try {
            const parsed: unknown = JSON.parse(String(rawValue));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              records.push(parsed as RedisRecord);
            }
          } catch {
            // Ignore malformed or partially replaced presence records.
          }
        }
      }
      return records;
    } catch (error) {
      this.logFailure("presence list", error);
      return [];
    }
  }

  /**
   * @param {string} username
   * @returns {Promise<void>}
   */
  async clearPresence(username: string): Promise<void> {
    if (!this.isReady()) return;
    const cleanUsername = clean(username);
    if (cleanUsername === "") return;

    try {
      await this.client!.sendCommand(["DEL", this.key("presence", cleanUsername)]);
    } catch (error) {
      this.logFailure("presence clear", error);
    }
  }
}

export = RedisStore;
