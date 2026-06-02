"use strict";

const crypto = require("crypto");

const DEFAULT_SCAN_COUNT = 200;
const HEALTH_CACHE_TTL_MS = 5000;
const LOCK_TTL_SAMPLE_LIMIT = 16;

let createClient = null;
try {
  ({ createClient } = require("redis"));
} catch {
  createClient = null;
}

function clean(value) {
  return String(value || "").trim();
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeKeyPart(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .slice(0, 160) || "unknown";
}

class RedisStore {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.url = clean(options.url || "redis://127.0.0.1:6379");
    this.keyPrefix = safeKeyPart(options.keyPrefix || "pixelmania");
    this.logger = typeof options.logger === "function" ? options.logger : ((...args) => console.warn(...args));
    this.connectTimeoutMs = Math.max(250, toInt(options.connectTimeoutMs, 1500));
    this.client = null;
    this.ready = false;
    this.lastErrorLogAt = 0;
    this.healthCache = { value: null, expiresAtMs: 0 };
  }

  isReady() {
    return Boolean(this.enabled && this.client && this.ready);
  }

  key(...parts) {
    return [this.keyPrefix, ...parts.map(safeKeyPart)].join(":");
  }

  logFailure(label, error) {
    const now = Date.now();
    if (now - this.lastErrorLogAt < 10000) return;
    this.lastErrorLogAt = now;
    this.logger(`[redis] ${label} failed:`, error.message);
  }

  _parseScanReply(reply) {
    if (!Array.isArray(reply) || reply.length < 2) return null;

    const nextCursor = String(reply[0] || "0");
    const rawKeys = Array.isArray(reply[1]) ? reply[1] : [];
    const keys = [];

    for (const key of rawKeys) {
      if (key === undefined || key === null) continue;
      keys.push(String(key));
    }

    return { cursor: nextCursor, keys };
  }

  async _scanKeys(pattern, maxKeys = 0) {
    if (!this.isReady()) return [];

    const keys = [];
    const max = Math.max(0, Math.trunc(maxKeys));
    let cursor = "0";

    do {
      const reply = await this.client.sendCommand([
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

  async _countKeys(pattern) {
    if (!this.isReady()) return 0;

    let cursor = "0";
    let count = 0;

    do {
      const reply = await this.client.sendCommand([
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

  _summarizeTtls(ttlValues) {
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

  async getHealthSnapshot() {
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
      const [lockCount, presenceCount, activeSessionCount, lockKeySamples] = await Promise.all([
        this._countKeys(this.key("lock", "*", "*")),
        this._countKeys(this.key("presence", "*")),
        this._countKeys(this.key("active_session", "*")),
        this._scanKeys(this.key("lock", "*", "*"), LOCK_TTL_SAMPLE_LIMIT),
      ]);

      const ttlSamples = (await Promise.all(lockKeySamples.map((key) => this.client.sendCommand(["PTTL", key]))))
        .map((value) => Number(value));

      const snapshot = {
        enabled: true,
        ready: true,
        key_prefix: this.keyPrefix,
        key_counts: {
          locks: lockCount,
          presence: presenceCount,
          active_sessions: activeSessionCount,
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
      this.healthCache = {
        value: {
          enabled: true,
          ready: this.ready,
          key_prefix: this.keyPrefix,
          error: String(error && error.message ? error.message : "failed to collect redis health"),
          key_counts: {
            locks: 0,
            presence: 0,
            active_sessions: 0,
          },
          lock_ttl_ms: {
            sample_size: 0,
            min_ttl_ms: null,
            max_ttl_ms: null,
            avg_ttl_ms: null,
            stale_count: 0,
            near_expiry_count: 0,
          },
        },
        expiresAtMs: now + HEALTH_CACHE_TTL_MS,
      };
      return this.healthCache.value;
    }
  }

  async init() {
    if (!this.enabled) return;
    if (!createClient) {
      this.enabled = false;
      this.logger("[redis] disabled because package 'redis' is not installed.");
      return;
    }

    this.client = createClient({
      url: this.url,
      socket: {
        reconnectStrategy: (retries) => Math.min(500 + retries * 250, 5000),
      },
    });

    this.client.on("ready", () => {
      this.ready = true;
    });
    this.client.on("end", () => {
      this.ready = false;
    });
    this.client.on("error", (error) => {
      this.ready = false;
      this.logFailure("client", error);
    });

    let connectPromise = null;
    try {
      connectPromise = this.client.connect();
      await Promise.race([
        connectPromise,
        delay(this.connectTimeoutMs).then(() => {
          throw new Error(`connect timeout after ${this.connectTimeoutMs}ms`);
        }),
      ]);
      await this.client.sendCommand(["PING"]);
      this.ready = true;
      this.logger("[redis] connected.");
    } catch (error) {
      if (connectPromise) connectPromise.catch(() => null);
      this.ready = false;
      try {
        if (this.client && typeof this.client.destroy === "function") {
          this.client.destroy();
        } else if (this.client && typeof this.client.disconnect === "function") {
          this.client.disconnect().catch(() => null);
        }
      } catch {
        // Ignore cleanup errors after a failed Redis connect.
      }
      this.client = null;
      this.logFailure("initialization", error);
    }
  }

  async close() {
    if (!this.client) return;
    try {
      if (this.client.isOpen) {
        await this.client.quit();
      }
    } catch {
      // Ignore shutdown errors.
    } finally {
      this.healthCache = { value: null, expiresAtMs: 0 };
      this.ready = false;
    }
  }

  async checkRateLimit(scope, subject, limit, windowMs) {
    if (!this.isReady()) {
      return { allowed: true, fallback: true, count: 0, resetInMs: windowMs };
    }

    const safeLimit = Math.max(1, toInt(limit, 1));
    const safeWindowMs = Math.max(100, toInt(windowMs, 1000));
    const key = this.key("rate", scope, subject);

    try {
      const count = Math.max(0, toInt(await this.client.sendCommand(["INCR", key]), 0));
      let ttl = toInt(await this.client.sendCommand(["PTTL", key]), -1);
      if (count === 1 || ttl < 0) {
        await this.client.sendCommand(["PEXPIRE", key, String(safeWindowMs)]);
        ttl = safeWindowMs;
      }
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

  async acquireLock(scope, resource, ttlMs, owner = "") {
    if (!this.isReady()) {
      return { acquired: true, fallback: true, key: "", token: "" };
    }

    const safeTtlMs = Math.max(250, toInt(ttlMs, 5000));
    const key = this.key("lock", scope, resource);
    const token = clean(owner) || crypto.randomUUID();

    try {
      const result = await this.client.sendCommand(["SET", key, token, "PX", String(safeTtlMs), "NX"]);
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

  async releaseLock(lock) {
    if (!this.isReady() || !lock || lock.fallback || !lock.key || !lock.token) return;

    try {
      await this.client.sendCommand([
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

  async setActiveSession(username, playerId, ttlMs) {
    if (!this.isReady()) return false;
    const cleanUsername = clean(username);
    const cleanPlayerId = clean(playerId);
    if (cleanUsername === "" || cleanPlayerId === "") return false;

    try {
      await this.client.sendCommand([
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

  async clearActiveSession(username, playerId = "") {
    if (!this.isReady()) return;
    const cleanUsername = clean(username);
    if (cleanUsername === "") return;
    const key = this.key("active_session", cleanUsername);
    const expectedPlayerId = clean(playerId);

    try {
      if (expectedPlayerId === "") {
        await this.client.sendCommand(["DEL", key]);
        return;
      }

      await this.client.sendCommand([
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

  async setPresence(username, presence, ttlMs) {
    if (!this.isReady()) return false;
    const cleanUsername = clean(username);
    if (cleanUsername === "") return false;

    try {
      await this.client.sendCommand([
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

  async clearPresence(username) {
    if (!this.isReady()) return;
    const cleanUsername = clean(username);
    if (cleanUsername === "") return;

    try {
      await this.client.sendCommand(["DEL", this.key("presence", cleanUsername)]);
    } catch (error) {
      this.logFailure("presence clear", error);
    }
  }
}

module.exports = RedisStore;
