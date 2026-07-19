"use strict";

type PacketTypeStatsBucket = {
  count: number;
  sum_bytes: number;
  min_bytes: number;
  max_bytes: number;
  samples: number[];
};

type PacketTypeStatsSnapshot = {
  count: number;
  avg_bytes: number;
  p95_bytes: number;
  min_bytes: number;
  max_bytes: number;
  sample_count: number;
};

type PacketTypeStatsMap = Record<string, PacketTypeStatsBucket>;

type ServerTickStats = {
  enabled: boolean;
  started_at: string;
  last_sample_at: string;
  interval_ms: number;
  sample_count: number;
  tps: number;
  tick_time_ms: number;
  avg_tick_time_ms: number;
  max_tick_time_ms: number;
  event_loop_lag_ms: number;
  max_event_loop_lag_ms: number;
};

function clampInteger(value: unknown, min: number, max: number): number {
  const parsed = Math.trunc(Number(value) || 0);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function createServerTickStats(intervalMs: unknown): ServerTickStats {
  return {
    enabled: false,
    started_at: "",
    last_sample_at: "",
    interval_ms: clampInteger(intervalMs, 100, 60_000),
    sample_count: 0,
    tps: 0,
    tick_time_ms: 0,
    avg_tick_time_ms: 0,
    max_tick_time_ms: 0,
    event_loop_lag_ms: 0,
    max_event_loop_lag_ms: 0,
  };
}

function getServerTickSnapshot(stats: Partial<ServerTickStats> | null | undefined, options: { intervalMs?: unknown } = {}) {
  const source = stats || {};
  return {
    enabled: Boolean(source.enabled),
    started_at: source.started_at || "",
    last_sample_at: source.last_sample_at || "",
    interval_ms: clampInteger(source.interval_ms || options.intervalMs, 100, 60_000),
    sample_count: clampInteger(source.sample_count || 0, 0, Number.MAX_SAFE_INTEGER),
    tps: Number(source.tps || 0),
    tick_time_ms: Number(source.tick_time_ms || 0),
    avg_tick_time_ms: Number(source.avg_tick_time_ms || 0),
    max_tick_time_ms: Number(source.max_tick_time_ms || 0),
    event_loop_lag_ms: Number(source.event_loop_lag_ms || 0),
    max_event_loop_lag_ms: Number(source.max_event_loop_lag_ms || 0),
  };
}

function applyServerTickSample(
  stats: ServerTickStats,
  elapsedMs: unknown,
  intervalMs: unknown,
  nowIso = new Date().toISOString()
): ServerTickStats {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const interval = clampInteger(intervalMs, 100, 60_000);
  const lagMs = Math.max(0, elapsed - interval);
  const sampleCount = clampInteger(Number(stats.sample_count || 0) + 1, 1, Number.MAX_SAFE_INTEGER);
  const previousAverage = Number(stats.avg_tick_time_ms || 0);

  stats.last_sample_at = nowIso;
  stats.sample_count = sampleCount;
  stats.tick_time_ms = Number(elapsed.toFixed(2));
  stats.event_loop_lag_ms = Number(lagMs.toFixed(2));
  stats.tps = elapsed > 0 ? Number((1000 / elapsed).toFixed(2)) : 0;
  stats.avg_tick_time_ms = Number((((previousAverage * (sampleCount - 1)) + elapsed) / sampleCount).toFixed(2));
  stats.max_tick_time_ms = Number(Math.max(stats.max_tick_time_ms || 0, elapsed).toFixed(2));
  stats.max_event_loop_lag_ms = Number(Math.max(stats.max_event_loop_lag_ms || 0, lagMs).toFixed(2));
  return stats;
}

function createPacketTypeSizeStatsBucket(): PacketTypeStatsBucket {
  return {
    count: 0,
    sum_bytes: 0,
    min_bytes: 0,
    max_bytes: 0,
    samples: [],
  };
}

function normalizePacketTypeName(rawType: unknown): string {
  const safeType = String(rawType || "").trim().toLowerCase();
  return safeType === "" ? "unknown" : safeType;
}

function clampPacketTypeByteSamples(samples: unknown, sampleLimit: unknown): number[] {
  const limit = clampInteger(sampleLimit, 1, Number.MAX_SAFE_INTEGER);
  const values = Array.isArray(samples)
    ? samples.map((value) => Math.max(0, Math.trunc(Number(value) || 0))).filter((value) => Number.isFinite(value))
    : [];
  if (values.length <= limit) return values.slice();
  return values.slice(values.length - limit);
}

function recordPacketTypeSize(target: PacketTypeStatsMap, rawMessageType: unknown, rawBytes: unknown, sampleLimit: unknown): void {
  const bytes = Math.max(0, Math.trunc(Number(rawBytes || 0)));
  if (!Number.isFinite(bytes) || bytes < 0) return;
  if (!target || typeof target !== "object") return;

  const messageType = normalizePacketTypeName(rawMessageType);
  let bucket = target[messageType];
  if (!bucket || typeof bucket !== "object") {
    bucket = createPacketTypeSizeStatsBucket();
    target[messageType] = bucket;
  }

  const currentCount = Number(bucket.count || 0) + 1;
  const currentSum = Number(bucket.sum_bytes || 0) + bytes;
  const currentMax = Math.max(0, Number(bucket.max_bytes || 0));
  const currentMin = Number(bucket.min_bytes || 0);
  const samples = clampPacketTypeByteSamples(bucket.samples, sampleLimit);
  samples.push(bytes);

  bucket.count = currentCount;
  bucket.sum_bytes = currentSum;
  bucket.max_bytes = Math.max(currentMax, bytes);
  bucket.min_bytes = currentMin === 0 ? bytes : Math.min(currentMin, bytes);
  bucket.samples = samples;
}

function computePercentileFromSamples(samples: unknown, percentile = 95): number {
  if (!Array.isArray(samples) || samples.length === 0) return 0;
  const cleanSamples = samples
    .map((value) => Math.max(0, Math.trunc(Number(value) || 0)))
    .filter((value) => Number.isFinite(value));
  if (cleanSamples.length === 0) return 0;
  cleanSamples.sort((left, right) => left - right);
  if (percentile <= 0) return cleanSamples[0];
  if (percentile >= 100) return cleanSamples[cleanSamples.length - 1];

  const index = Math.min(cleanSamples.length - 1, Math.max(0, Math.ceil((percentile / 100) * cleanSamples.length) - 1));
  return cleanSamples[index];
}

function getPacketTypeSizeStatsSnapshot(source: unknown): Record<string, PacketTypeStatsSnapshot> {
  const result: Record<string, PacketTypeStatsSnapshot> = {};
  if (!source || typeof source !== "object") return result;

  for (const [messageType, rawBucket] of Object.entries(source as Record<string, Partial<PacketTypeStatsBucket>>)) {
    const bucket = rawBucket || {};
    const count = Number(bucket.count || 0);
    const sumBytes = Number(bucket.sum_bytes || 0);
    const samples = Array.isArray(bucket.samples) ? bucket.samples.slice(0) : [];
    const avgBytes = count > 0 ? sumBytes / count : 0;
    const p95Bytes = computePercentileFromSamples(samples, 95);
    const minBytes = count > 0 ? Math.max(0, Math.trunc(Number(bucket.min_bytes || 0))) : 0;
    result[messageType] = {
      count,
      avg_bytes: Number(avgBytes || 0),
      p95_bytes: Math.max(0, Math.trunc(Number(p95Bytes || 0))),
      min_bytes: minBytes,
      max_bytes: Math.max(0, Math.trunc(Number(bucket.max_bytes || 0))),
      sample_count: samples.length,
    };
  }

  return result;
}

export = {
  applyServerTickSample,
  clampPacketTypeByteSamples,
  computePercentileFromSamples,
  createPacketTypeSizeStatsBucket,
  createServerTickStats,
  getPacketTypeSizeStatsSnapshot,
  getServerTickSnapshot,
  normalizePacketTypeName,
  recordPacketTypeSize,
};
