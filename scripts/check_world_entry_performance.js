"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const SERVER_ROOT = path.resolve(__dirname, "..");
const CLIENT_ROOT = path.resolve(SERVER_ROOT, "..", "pixel-mania");
const WorldStateHelpers = require(path.join(SERVER_ROOT, "server_world_state_helpers.js"));

const STREAM_OPTIONS = Object.freeze({
  targetPacketBytes: 48 * 1024,
  maxPacketBytes: 64 * 1024,
  maxChunks: 256,
});

function readClientSource(relativePath) {
  return fs.readFileSync(path.join(CLIENT_ROOT, relativePath), "utf8");
}

function readServerSource(relativePath) {
  return fs.readFileSync(path.join(SERVER_ROOT, relativePath), "utf8");
}

function createWorldState(entryCount, suffix = "fixture") {
  const foreground = {};
  const background = {};
  const seeds = [];
  for (let index = 0; index < entryCount; index += 1) {
    const x = index % 200;
    const y = Math.floor(index / 200);
    foreground[`${x},${y}`] = {
      block_type: index % 7 === 0 ? "wooden_platform" : (index % 2 === 0 ? "dirt" : "bedrock"),
      item_id: 100 + (index % 17),
      variant: index % 11,
      block_revision: 5000 + index,
    };
    if (index % 10 === 0) {
      background[`${x},${y}`] = 200 + (index % 5);
    }
    if (index % 40 === 0) {
      seeds.push({
        x,
        y,
        seed_type: "dirt_seed",
        planted_at: "2026-07-26T00:00:00.000Z",
      });
    }
  }

  return {
    type: "world_state",
    world_state_encoding: "grid_dictionary_v1",
    world: `PERF_${suffix}`.toUpperCase(),
    join_request_id: `join-${suffix}`,
    world_revision: 220,
    block_revision: 219,
    cleared: false,
    spawn_x: 10,
    spawn_y: 20,
    foreground,
    background,
    removed_foreground: [],
    removed_background: [],
    seeds,
    interactions: {},
    drops: [],
    world_lock: { is_locked: false },
    area_locks: [],
    generator_links: [],
    oil_refinery_links: [],
    active_event: {},
  };
}

function buildStream(state, snapshotId) {
  return WorldStateHelpers.buildWorldStateStreamPackets(state, {
    ...STREAM_OPTIONS,
    snapshotId,
  });
}

function buildLegacyStream(state, snapshotId) {
  const clonedState = JSON.parse(JSON.stringify(state));
  const result = buildStream(clonedState, snapshotId);
  const packetJson = result.packets.map((packet) => JSON.stringify(packet));
  return {
    ...result,
    packetJson,
    wireBytes: packetJson.reduce((total, raw) => total + Buffer.byteLength(raw), 0),
  };
}

function assemblePackets(rawPackets) {
  const packets = rawPackets.map((packet) => (
    typeof packet === "string" ? JSON.parse(packet) : packet
  ));
  const begin = packets.find((packet) => packet.type === "world_state_stream_begin");
  const end = packets.find((packet) => packet.type === "world_state_stream_end");
  assert.ok(begin, "stream begin packet is required");
  assert.ok(end, "stream end packet is required");
  assert.equal(end.snapshot_id, begin.snapshot_id, "stream IDs must match");
  assert.equal(end.chunk_count, begin.chunk_count, "stream chunk counts must match");

  const chunks = new Map();
  for (const packet of packets) {
    if (packet.type !== "world_state_stream_chunk") continue;
    assert.equal(packet.snapshot_id, begin.snapshot_id, "chunk stream ID must match");
    assert.equal(packet.chunk_count, begin.chunk_count, "chunk count must match begin");
    assert.ok(packet.chunk_index >= 0 && packet.chunk_index < begin.chunk_count, "chunk index must be in range");
    if (!chunks.has(packet.chunk_index)) chunks.set(packet.chunk_index, packet);
  }
  assert.equal(chunks.size, begin.chunk_count, "all unique chunks must arrive before stream end");

  const payload = { ...begin.metadata };
  for (const descriptor of begin.sections) {
    payload[descriptor.name] = descriptor.kind === "array" ? [] : {};
  }
  for (let index = 0; index < begin.chunk_count; index += 1) {
    const packet = chunks.get(index);
    assert.ok(packet, `chunk ${index} is missing`);
    if (packet.section_kind === "array") {
      payload[packet.section].push(...packet.data);
    } else {
      Object.assign(payload[packet.section], packet.data);
    }
  }
  return payload;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function benchmarkBuilder(builder, state, label, iterations) {
  builder(state, `${label}-warmup`);
  if (typeof global.gc === "function") global.gc();
  const baselineHeap = process.memoryUsage().heapUsed;
  let peakHeap = baselineHeap;
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    let result = builder(state, `${label}-${index}`);
    samples.push(performance.now() - startedAt);
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    assert.ok(result.packetJson.length >= 2);
    result = null;
  }
  return {
    median_ms: Number(median(samples).toFixed(3)),
    min_ms: Number(Math.min(...samples).toFixed(3)),
    max_ms: Number(Math.max(...samples).toFixed(3)),
    peak_heap_delta_bytes: Math.max(0, peakHeap - baselineHeap),
  };
}

function createLoadCoalescer(loader) {
  const inFlight = new Map();
  return async (world) => {
    const key = String(world).trim().toUpperCase();
    const existing = inFlight.get(key);
    if (existing) return { ...(await existing), coalesced: true };
    const promise = loader(key);
    inFlight.set(key, promise);
    try {
      return { ...(await promise), coalesced: false };
    } finally {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    }
  };
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const results = [];
  const run = async (name, test) => {
    await test();
    results.push(name);
  };

  const smallState = createWorldState(120, "small");
  const largeState = createWorldState(14000, "large");
  const largeStream = buildStream(largeState, "snapshot-large");
  const networkSource = readClientSource("Scripts/network_manager.gd");
  const syncSource = readClientSource("Scripts/world_state_sync_manager.gd");
  const blockSource = readClientSource("Scripts/block_manager.gd");
  const loadingSource = readClientSource("Scripts/world_loading_ui_manager.gd");
  const serverSource = readServerSource("src/server.ts");
  const routeSource = readServerSource("src/server_phase8_player_session_routes.ts");
  const helperSource = readServerSource("src/server_world_state_helpers.ts");

  await run("01 cold small world", async () => {
    const stream = buildStream(smallState, "cold-small");
    assert.deepEqual(assemblePackets(stream.packetJson), smallState);
  });

  await run("02 cold large world", async () => {
    assert.deepEqual(assemblePackets(largeStream.packetJson), largeState);
    assert.ok(largeStream.chunkCount > 1);
  });

  await run("03 warm repeat entry", async () => {
    const first = buildStream(smallState, "warm-repeat");
    const second = buildStream(smallState, "warm-repeat");
    assert.deepEqual(second.packetJson, first.packetJson);
  });

  await run("04 concurrent same-world entry", async () => {
    let loads = 0;
    const coalescedLoad = createLoadCoalescer(async (world) => {
      loads += 1;
      await delay(5);
      return { ok: true, world };
    });
    const [first, second] = await Promise.all([coalescedLoad("TEST"), coalescedLoad("test")]);
    assert.equal(loads, 1);
    assert.equal(first.world, "TEST");
    assert.equal(second.world, "TEST");
    assert.notEqual(first.coalesced, second.coalesced);
  });

  await run("05 concurrent different-world entry", async () => {
    let loads = 0;
    const coalescedLoad = createLoadCoalescer(async (world) => {
      loads += 1;
      await delay(2);
      return { ok: true, world };
    });
    const values = await Promise.all([coalescedLoad("A"), coalescedLoad("B")]);
    assert.equal(loads, 2);
    assert.deepEqual(values.map((entry) => entry.world).sort(), ["A", "B"]);
  });

  await run("06 high-latency stream transfer", async () => {
    const delayedPackets = [];
    for (const packet of buildStream(smallState, "latency").packetJson) {
      await delay(1);
      delayedPackets.push(packet);
    }
    assert.deepEqual(assemblePackets(delayedPackets), smallState);
  });

  await run("07 reordered chunks", async () => {
    const stream = buildStream(largeState, "reordered");
    const begin = stream.packets[0];
    const end = stream.packets.at(-1);
    const chunks = stream.packets.slice(1, -1).reverse();
    assert.deepEqual(assemblePackets([begin, ...chunks, end]), largeState);
  });

  await run("08 missing chunk", async () => {
    const stream = buildStream(largeState, "missing");
    const incomplete = stream.packets.filter((packet) => packet.chunk_index !== 0);
    assert.throws(() => assemblePackets(incomplete), /all unique chunks|missing/);
  });

  await run("09 duplicate chunk", async () => {
    const stream = buildStream(largeState, "duplicate");
    const duplicate = stream.packets.find((packet) => packet.type === "world_state_stream_chunk");
    assert.ok(duplicate);
    assert.deepEqual(assemblePackets([...stream.packets.slice(0, -1), duplicate, stream.packets.at(-1)]), largeState);
  });

  await run("10 disconnect during load", async () => {
    assert.match(networkSource, /pending_world_state_stream\.clear\(\)/);
    assert.match(networkSource, /cancel_world_entry_profile\("join_request_canceled"\)/);
    assert.match(networkSource, /_fail_pending_world_state_stream\("timeout"\)/);
  });

  await run("11 immediate reconnect resets old stream", async () => {
    const first = buildStream(smallState, "old-stream");
    const secondState = createWorldState(121, "new-stream");
    const second = buildStream(secondState, "new-stream");
    assert.notEqual(first.packets[0].snapshot_id, second.packets[0].snapshot_id);
    assert.deepEqual(assemblePackets(second.packetJson), secondState);
    assert.match(networkSource, /func send_join_world[\s\S]*?pending_world_state_stream\.clear\(\)/);
  });

  await run("12 stale snapshot revision", async () => {
    assert.match(syncSource, /incoming_block_revision < latest_block_revision/);
    assert.match(syncSource, /ignored stale world block snapshot/);
    assert.match(serverSource, /world_revision: getWorldRevision\(clean\)/);
  });

  await run("13 block updates during loading", async () => {
    assert.match(networkSource, /if is_world_state_apply_in_progress\(\):\s*\n\s*return/);
    assert.match(networkSource, /while socket\.get_available_packet_count\(\) > 0/);
    assert.match(syncSource, /world\.applying_network_world_update = true/);
    assert.match(syncSource, /_should_ignore_stale_block_update/);
  });

  await run("14 collision and lock readiness", async () => {
    const collisionIndex = syncSource.indexOf('notify_world_collision_snapshot_rebuilt("world-state-rebuild-complete")');
    const finishIndex = syncSource.indexOf("finish_world_entry_after_load", collisionIndex);
    assert.ok(collisionIndex >= 0 && finishIndex > collisionIndex, "collision readiness must precede player unlock");
    assert.match(loadingSource, /is_world_ready_for_player\(\)/);
    assert.match(blockSource, /finalize_world_load_block_variants/);
    assert.match(blockSource, /refresh_streaming_now/);
  });

  await run("15 minimum valid payload", async () => {
    const minimumState = {
      type: "world_state",
      world: "MINIMUM",
      join_request_id: "minimum",
      world_revision: 1,
      block_revision: 1,
      foreground: {},
      background: {},
    };
    const stream = buildStream(minimumState, "minimum");
    assert.deepEqual(assemblePackets(stream.packetJson), minimumState);
    assert.ok(stream.wireBytes > 0);
  });

  await run("16 maximum production-shaped payload", async () => {
    assert.ok(largeStream.snapshotBytes < 2 * 1024 * 1024, "fixture must fit the client assembled snapshot cap");
    assert.ok(largeStream.wireBytes < 4 * 1024 * 1024, "fixture must fit the client wire cap");
    assert.ok(largeStream.packetJson.every((raw) => Buffer.byteLength(raw) <= 64 * 1024));
    assert.equal(largeStream.wireBytes, largeStream.packetJson.reduce((total, raw) => total + Buffer.byteLength(raw), 0));
  });

  await run("17 desktop frame-budget and profiling contract", async () => {
    assert.match(syncSource, /WORLD_STATE_APPLY_BATCH_SIZE := 512/);
    assert.match(syncSource, /await world\.get_tree\(\)\.process_frame/);
    assert.match(syncSource, /client_first_built_frame/);
    assert.match(networkSource, /client_controls_enabled/);
    assert.match(networkSource, /max_frame_delta_ms/);
    assert.match(networkSource, /frame_stall_count/);
    assert.match(loadingSource, /client_world_revealed/);
    assert.match(routeSource, /WORLD_ENTRY_PROFILE_ENABLED/);
    assert.match(routeSource, /process\.env\.NODE_ENV !== "production"/);
    assert.match(routeSource, /peak_heap_bytes/);
  });

  await run("18 mobile frame-budget and progress contract", async () => {
    assert.match(syncSource, /_update_world_build_progress\(build_entry_applied, build_entry_total\)/);
    assert.match(networkSource, /Loading world data " \+ str\(percent\) \+ "%"/);
    assert.match(networkSource, /MAX_SERVER_PACKET_PROCESS_USEC/);
    assert.match(networkSource, /MAX_WORLD_STATE_STREAM_WIRE_BYTES := 4 \* 1024 \* 1024/);
  });

  assert.doesNotMatch(helperSource, /JSON\.parse\(serializedState\)/, "stream builder must not clone the entire snapshot");
  assert.doesNotMatch(networkSource, /JSON\.stringify\(chunk_data\)/, "client must not stringify every parsed chunk");
  assert.doesNotMatch(networkSource, /chunk_data\.duplicate\(true\)/, "client must not deep-copy every parsed chunk");
  assert.match(serverSource, /worldStateRefreshesInFlight/);
  assert.match(serverSource, /stream\.packetJson/);
  assert.match(routeSource, /Promise\.all\(\[/);

  const benchmarkStates = [
    { count: 1000, state: createWorldState(1000, "bench-1000"), iterations: 7 },
    { count: 6000, state: createWorldState(6000, "bench-6000"), iterations: 5 },
    { count: 14000, state: largeState, iterations: 3 },
  ];
  const benchmarks = benchmarkStates.map(({ count, state, iterations }) => ({
    entries: count,
    legacy: benchmarkBuilder(buildLegacyStream, state, `legacy-${count}`, iterations),
    optimized: benchmarkBuilder(buildStream, state, `optimized-${count}`, iterations),
  }));

  console.log("[world-entry-performance]", JSON.stringify({
    tests_passed: results.length,
    tests: results,
    large_snapshot_bytes: largeStream.snapshotBytes,
    large_wire_bytes: largeStream.wireBytes,
    large_chunks: largeStream.chunkCount,
    benchmarks,
  }, null, 2));
  console.log(`[world-entry-performance] success (${results.length} scenarios)`);
}

main().catch((error) => {
  console.error("[world-entry-performance] failed", error);
  process.exitCode = 1;
});
