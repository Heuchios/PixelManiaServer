"use strict";

const crypto = require("crypto");

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
    this.client = null;
    this.ready = false;
    this.lastErrorLogAt = 0;
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

    try {
      await this.client.connect();
      await this.client.sendCommand(["PING"]);
      this.ready = true;
      this.logger("[redis] connected.");
    } catch (error) {
      this.ready = false;
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
