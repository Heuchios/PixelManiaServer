"use strict";

type EnvMap = NodeJS.ProcessEnv | Record<string, string | undefined>;

type RateLimitConfig = Readonly<{
  limit: number;
  windowMs: number;
}>;

const MIN_RATE_WINDOW_MS = 100;
const MAX_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function readPositiveIntEnv(
  name: string,
  fallback: unknown,
  min = 1,
  max = 100000,
  env: EnvMap = process.env
): number {
  const parsed = Math.trunc(Number(env[name]));
  const fallbackValue = Math.trunc(Number(fallback) || min);
  const value = Number.isFinite(parsed) ? parsed : fallbackValue;
  return Math.max(min, Math.min(max, value));
}

function readRateWindowMsEnv(
  msName: string,
  secondsName: string,
  fallbackMs: unknown,
  env: EnvMap = process.env
): number {
  const parsedMs = Math.trunc(Number(env[msName]));
  if (Number.isFinite(parsedMs) && parsedMs > 0) {
    return Math.max(MIN_RATE_WINDOW_MS, Math.min(MAX_RATE_WINDOW_MS, parsedMs));
  }

  const parsedSeconds = Math.trunc(Number(env[secondsName]));
  if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
    return Math.max(MIN_RATE_WINDOW_MS, Math.min(MAX_RATE_WINDOW_MS, parsedSeconds * 1000));
  }

  return Math.max(
    MIN_RATE_WINDOW_MS,
    Math.min(MAX_RATE_WINDOW_MS, Math.trunc(Number(fallbackMs) || 1000))
  );
}

function makeBotRateLimitConfig(
  prefix: string,
  fallbackLimit: unknown,
  fallbackWindowMs: unknown,
  maxLimit = 100000,
  env: EnvMap = process.env
): RateLimitConfig {
  return Object.freeze({
    limit: readPositiveIntEnv(`${prefix}_LIMIT`, fallbackLimit, 1, maxLimit, env),
    windowMs: readRateWindowMsEnv(`${prefix}_WINDOW_MS`, `${prefix}_WINDOW_SECONDS`, fallbackWindowMs, env),
  });
}

export = {
  makeBotRateLimitConfig,
  readPositiveIntEnv,
  readRateWindowMsEnv,
};
