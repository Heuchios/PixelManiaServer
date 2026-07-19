// Generated from src/server_env_config.ts. Do not edit by hand.
"use strict";
const MIN_RATE_WINDOW_MS = 100;
const MAX_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
function readPositiveIntEnv(name, fallback, min = 1, max = 100000, env = process.env) {
    const parsed = Math.trunc(Number(env[name]));
    const fallbackValue = Math.trunc(Number(fallback) || min);
    const value = Number.isFinite(parsed) ? parsed : fallbackValue;
    return Math.max(min, Math.min(max, value));
}
function readRateWindowMsEnv(msName, secondsName, fallbackMs, env = process.env) {
    const parsedMs = Math.trunc(Number(env[msName]));
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
        return Math.max(MIN_RATE_WINDOW_MS, Math.min(MAX_RATE_WINDOW_MS, parsedMs));
    }
    const parsedSeconds = Math.trunc(Number(env[secondsName]));
    if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
        return Math.max(MIN_RATE_WINDOW_MS, Math.min(MAX_RATE_WINDOW_MS, parsedSeconds * 1000));
    }
    return Math.max(MIN_RATE_WINDOW_MS, Math.min(MAX_RATE_WINDOW_MS, Math.trunc(Number(fallbackMs) || 1000)));
}
function makeBotRateLimitConfig(prefix, fallbackLimit, fallbackWindowMs, maxLimit = 100000, env = process.env) {
    return Object.freeze({
        limit: readPositiveIntEnv(`${prefix}_LIMIT`, fallbackLimit, 1, maxLimit, env),
        windowMs: readRateWindowMsEnv(`${prefix}_WINDOW_MS`, `${prefix}_WINDOW_SECONDS`, fallbackWindowMs, env),
    });
}
module.exports = {
    makeBotRateLimitConfig,
    readPositiveIntEnv,
    readRateWindowMsEnv,
};
