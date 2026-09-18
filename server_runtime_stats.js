// Generated from src/server_runtime_stats.ts. Do not edit by hand.
"use strict";
const node_perf_hooks_1 = require("node:perf_hooks");
function clampInteger(value, min, max) {
    const parsed = Math.trunc(Number(value) || 0);
    if (!Number.isFinite(parsed))
        return min;
    return Math.max(min, Math.min(max, parsed));
}
function createServerTickStats(intervalMs) {
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
function getServerTickSnapshot(stats, options = {}) {
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
function applyServerTickSample(stats, elapsedMs, intervalMs, nowIso = new Date().toISOString()) {
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
function createPacketTypeSizeStatsBucket() {
    return {
        count: 0,
        sum_bytes: 0,
        min_bytes: 0,
        max_bytes: 0,
        samples: [],
        sample_cursor: 0,
    };
}
function normalizePacketTypeName(rawType) {
    const safeType = String(rawType || "").trim().toLowerCase();
    return safeType === "" ? "unknown" : safeType;
}
function clampPacketTypeByteSamples(samples, sampleLimit) {
    const limit = clampInteger(sampleLimit, 1, Number.MAX_SAFE_INTEGER);
    const values = Array.isArray(samples)
        ? samples.map((value) => Math.max(0, Math.trunc(Number(value) || 0))).filter((value) => Number.isFinite(value))
        : [];
    if (values.length <= limit)
        return values.slice();
    return values.slice(values.length - limit);
}
// Normalizes a bucket that predates the ring buffer (or whose sampleLimit shrank) so the
// in-place writer below can assume `samples.length <= capacity` and a valid cursor.
function reconcilePacketTypeSampleWindow(bucket, capacity) {
    const existing = bucket.samples;
    if (!Array.isArray(existing)) {
        const fresh = [];
        bucket.samples = fresh;
        bucket.sample_cursor = 0;
        return fresh;
    }
    let samples = bucket.samples;
    if (samples.length > capacity) {
        samples = samples.slice(samples.length - capacity);
        bucket.samples = samples;
        bucket.sample_cursor = 0;
        return samples;
    }
    const cursor = Number(bucket.sample_cursor);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor >= capacity)
        bucket.sample_cursor = 0;
    return samples;
}
function recordPacketTypeSize(target, rawMessageType, rawBytes, sampleLimit) {
    const bytes = Math.max(0, Math.trunc(Number(rawBytes || 0)));
    if (!Number.isFinite(bytes) || bytes < 0)
        return;
    if (!target || typeof target !== "object")
        return;
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
    // This runs on EVERY inbound and outbound packet. The previous implementation rebuilt
    // the whole sample window with map+filter+slice per call (three fresh arrays of up to
    // `sampleLimit` elements), which at 500 players was one of the largest single sources
    // of GC pressure on the server. Write in place instead; `bytes` is already sanitized
    // above and every reader re-sanitizes, so the stored values are identical.
    // Capacity is sampleLimit + 1, not sampleLimit. The original implementation trimmed to
    // the last `sampleLimit` values at the START of a call and then pushed, so the stored
    // window was always the most recent sampleLimit + 1 samples. check_server_runtime_stats
    // pins that behaviour (sample_count 3 at sampleLimit 2), and matching it keeps this a
    // pure allocation fix with no observable change.
    const limit = clampInteger(sampleLimit, 1, Number.MAX_SAFE_INTEGER);
    const capacity = limit + 1;
    const samples = reconcilePacketTypeSampleWindow(bucket, capacity);
    if (samples.length < capacity) {
        samples.push(bytes);
        bucket.sample_cursor = samples.length % capacity;
    }
    else {
        const cursor = bucket.sample_cursor;
        samples[cursor] = bytes;
        bucket.sample_cursor = (cursor + 1) % capacity;
    }
    bucket.count = currentCount;
    bucket.sum_bytes = currentSum;
    bucket.max_bytes = Math.max(currentMax, bytes);
    bucket.min_bytes = currentMin === 0 ? bytes : Math.min(currentMin, bytes);
}
function computePercentileFromSamples(samples, percentile = 95) {
    if (!Array.isArray(samples) || samples.length === 0)
        return 0;
    const cleanSamples = samples
        .map((value) => Math.max(0, Math.trunc(Number(value) || 0)))
        .filter((value) => Number.isFinite(value));
    if (cleanSamples.length === 0)
        return 0;
    cleanSamples.sort((left, right) => left - right);
    if (percentile <= 0)
        return cleanSamples[0];
    if (percentile >= 100)
        return cleanSamples[cleanSamples.length - 1];
    const index = Math.min(cleanSamples.length - 1, Math.max(0, Math.ceil((percentile / 100) * cleanSamples.length) - 1));
    return cleanSamples[index];
}
function getPacketTypeSizeStatsSnapshot(source) {
    const result = {};
    if (!source || typeof source !== "object")
        return result;
    for (const [messageType, rawBucket] of Object.entries(source)) {
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
const VIOLATION_MAX_TRACKED_SUBJECTS = 500;
const VIOLATION_EVICT_LOW_WATER = 400;
const VIOLATION_STALE_MS = 30 * 60 * 1000;
const VIOLATION_MAX_LABELS_PER_SUBJECT = 24;
const VIOLATION_SNAPSHOT_TOP_N = 20;
// `Number(x) || Date.now()` would silently reject a caller-supplied timestamp of
// 0, because 0 is falsy. Tests and replay tooling legitimately pass 0, so the
// check has to be for finiteness rather than truthiness.
function resolveViolationNow(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : Date.now();
}
function getViolationSubjectKind(subject) {
    const clean = String(subject || "").trim().toLowerCase();
    const separator = clean.indexOf(":");
    if (separator <= 0)
        return "unknown";
    const kind = clean.slice(0, separator);
    return kind === "account" || kind === "ip" || kind === "socket" ? kind : "unknown";
}
function ensureSubjectViolationLedger(target) {
    const existing = target.violation_ledger;
    if (existing && typeof existing === "object" && existing.subjects && typeof existing.subjects === "object") {
        return existing;
    }
    const ledger = { next_id: 1, subjects: {} };
    target.violation_ledger = ledger;
    return ledger;
}
function pruneSubjectViolationLedger(ledger, now) {
    const subjects = ledger.subjects;
    for (const key of Object.keys(subjects)) {
        if (now - subjects[key].last_at >= VIOLATION_STALE_MS)
            delete subjects[key];
    }
    const keys = Object.keys(subjects);
    if (keys.length <= VIOLATION_MAX_TRACKED_SUBJECTS)
        return;
    // Evict past the cap down to the low-water mark, oldest activity first, so a
    // flood of one-off subjects cannot grow this without bound.
    keys.sort((a, b) => subjects[a].last_at - subjects[b].last_at);
    const removeCount = keys.length - VIOLATION_EVICT_LOW_WATER;
    for (let i = 0; i < removeCount; i += 1)
        delete subjects[keys[i]];
}
// Records one violation against `subject` (the rate limiter's "account:name" /
// "ip:1.2.3.4" / "socket:id" form) and returns the updated entry, so the caller
// can decide whether the running total is worth a security log line.
function recordSubjectViolation(target, subject, label, options = {}) {
    if (!target || typeof target !== "object")
        return null;
    const cleanSubject = String(subject || "").trim();
    if (cleanSubject === "")
        return null;
    const cleanLabel = String(label || "unknown").trim().toLowerCase() || "unknown";
    const now = resolveViolationNow(options.now);
    const ledger = ensureSubjectViolationLedger(target);
    let entry = ledger.subjects[cleanSubject];
    if (!entry) {
        pruneSubjectViolationLedger(ledger, now);
        entry = {
            id: `s${ledger.next_id}`,
            subject_kind: getViolationSubjectKind(cleanSubject),
            total: 0,
            by_label: {},
            first_at: now,
            last_at: now,
        };
        ledger.next_id += 1;
        ledger.subjects[cleanSubject] = entry;
    }
    entry.total += 1;
    entry.last_at = now;
    // A misbehaving client can invent bucket names, so cap the label fan-out per
    // subject; the total still counts every violation.
    if (entry.by_label[cleanLabel] !== undefined
        || Object.keys(entry.by_label).length < VIOLATION_MAX_LABELS_PER_SUBJECT) {
        entry.by_label[cleanLabel] = Number(entry.by_label[cleanLabel] || 0) + 1;
    }
    return entry;
}
function getSubjectViolationSnapshot(target, options = {}) {
    const empty = { tracked_subjects: 0, total: 0, by_kind: {}, by_label: {}, top: [] };
    if (!target || typeof target !== "object")
        return empty;
    const ledger = target.violation_ledger;
    if (!ledger || typeof ledger !== "object" || !ledger.subjects)
        return empty;
    const now = resolveViolationNow(options.now);
    pruneSubjectViolationLedger(ledger, now);
    const topN = clampInteger(options.topN ?? VIOLATION_SNAPSHOT_TOP_N, 1, 100);
    const subjects = ledger.subjects;
    const entries = Object.values(subjects);
    const byKind = {};
    const byLabel = {};
    let total = 0;
    for (const entry of entries) {
        total += entry.total;
        byKind[entry.subject_kind] = Number(byKind[entry.subject_kind] || 0) + entry.total;
        for (const [label, count] of Object.entries(entry.by_label)) {
            byLabel[label] = Number(byLabel[label] || 0) + count;
        }
    }
    entries.sort((a, b) => b.total - a.total);
    const top = entries.slice(0, topN).map((entry) => ({
        // Opaque and process-stable on purpose -- see the note above the types.
        id: entry.id,
        subject_kind: entry.subject_kind,
        total: entry.total,
        by_label: { ...entry.by_label },
        first_seen_ms_ago: Math.max(0, now - entry.first_at),
        last_seen_ms_ago: Math.max(0, now - entry.last_at),
    }));
    return { tracked_subjects: entries.length, total, by_kind: byKind, by_label: byLabel, top };
}
// Optional, bounded runtime histograms. Names are capped because packet types are untrusted.
function createRuntimeProfiler(enabled) {
    const buckets = new Map();
    if (enabled) {
        const gcObserver = new node_perf_hooks_1.PerformanceObserver(list => {
            for (const entry of list.getEntries())
                observe("gc_ms", entry.duration);
        });
        gcObserver.observe({ entryTypes: ["gc"] });
    }
    function observe(name, value) {
        if (!enabled || !Number.isFinite(value))
            return;
        const key = name.slice(0, 96);
        if (!buckets.has(key) && buckets.size >= 128)
            return;
        const bucket = buckets.get(key) || { count: 0, total: 0, max: 0, recent: [] };
        bucket.recent[bucket.count % 512] = value;
        bucket.count += 1;
        bucket.total += value;
        bucket.max = Math.max(bucket.max, value);
        buckets.set(key, bucket);
    }
    function snapshot() {
        const result = {};
        for (const [key, bucket] of buckets) {
            const sorted = bucket.recent.slice().sort((a, b) => a - b);
            result[key] = { count: bucket.count, mean: bucket.total / bucket.count, max: bucket.max,
                p95_recent: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0 };
        }
        buckets.clear();
        return result;
    }
    return { enabled, observe, snapshot };
}
module.exports = {
    createRuntimeProfiler,
    applyServerTickSample,
    clampPacketTypeByteSamples,
    computePercentileFromSamples,
    createPacketTypeSizeStatsBucket,
    createServerTickStats,
    getPacketTypeSizeStatsSnapshot,
    getServerTickSnapshot,
    getSubjectViolationSnapshot,
    getViolationSubjectKind,
    normalizePacketTypeName,
    recordPacketTypeSize,
    recordSubjectViolation,
};
