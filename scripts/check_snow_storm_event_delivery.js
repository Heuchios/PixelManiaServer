#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function compileSourceFunction(functionSource, functionName, dependencies = {}) {
  const dependencyNames = Object.keys(dependencies);
  const dependencyValues = Object.values(dependencies);
  return new Function(
    ...dependencyNames,
    `"use strict"; ${functionSource}; return ${functionName};`
  )(...dependencyValues);
}

const startEventSource = sourceBetween(
  serverSource,
  "async function startSnowStormEvent",
  "async function endSnowStormEvent"
);
const endEventSource = sourceBetween(
  serverSource,
  "async function endSnowStormEvent",
  "async function handleFrozenTreasureOpen"
);

assert.match(
  serverSource,
  /const SNOW_STORM_EVENT_TILE_BATCH_SIZE = [^\r\n]*\|\| 250\)/
);
assert.match(
  serverSource,
  /const SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS = [^\r\n]* : 0\)\)\);/
);
assert.match(startEventSource, /const effectiveMap = buildEffectiveForegroundMap\(clean, state\)/);
assert.doesNotMatch(startEventSource, /buildPersistedForegroundEventMap/);
assert.match(startEventSource, /await broadcastEventTileUpdates\(clean, eventId, "start", updates\)/);
assert.match(endEventSource, /block_type: tile\.original_block_id/);
assert.match(endEventSource, /broadcastToWorld\(clean, buildWorldEventEndedMessage\(clean, eventId, endedAt\)\)/);
assert.match(endEventSource, /await broadcastEventTileUpdates\(clean, eventId, "end", updates\)/);
assert.doesNotMatch(endEventSource, /buildWorldStateMessage/);
assert.doesNotMatch(endEventSource, /needsWorldStateRefresh/);
assert.doesNotMatch(endEventSource, /world_state_reason/);

const getBlockTypeAtSource = sourceBetween(
  serverSource,
  "function getSnowStormBlockTypeAt",
  "function getSnowStormDirtEventBlock"
);
const getDirtEventBlockSource = sourceBetween(
  serverSource,
  "function getSnowStormDirtEventBlock",
  "function isSnowStormTopLeaf"
);
const getEventBlockForOriginalSource = sourceBetween(
  serverSource,
  "function getSnowStormEventBlockForOriginal",
  "function getSnowStormBlockTypeAt"
);
const gridKey = (x, y) => `${Math.trunc(Number(x) || 0)},${Math.trunc(Number(y) || 0)}`;
const clampString = (value) => String(value || "").trim();
const isGridInWorld = (x, y) => x >= 0 && x < 100 && y >= 0 && y < 70;
const getSnowStormBlockTypeAt = compileSourceFunction(
  getBlockTypeAtSource,
  "getSnowStormBlockTypeAt",
  { isGridInWorld, gridKey, clampString }
);
const getSnowStormDirtEventBlock = compileSourceFunction(
  getDirtEventBlockSource,
  "getSnowStormDirtEventBlock",
  { getSnowStormBlockTypeAt }
);
const getSnowStormEventBlockForOriginal = compileSourceFunction(
  getEventBlockForOriginalSource,
  "getSnowStormEventBlockForOriginal",
  {
    getSnowStormDirtEventBlock,
    getSnowStormIceEventBlock: () => "ice_block",
    isSnowStormTopLeaf: () => false,
  }
);

const generatedForeground = new Map([
  [gridKey(10, 20), { x: 10, y: 20, block_type: "dirt", source: "generated" }],
  [gridKey(10, 21), { x: 10, y: 21, block_type: "dirt", source: "generated" }],
  [gridKey(10, 22), { x: 10, y: 22, block_type: "dirt", source: "generated" }],
  [gridKey(11, 20), { x: 11, y: 20, block_type: "grass", source: "generated" }],
]);

assert.equal(getSnowStormDirtEventBlock(generatedForeground, 10, 20), "snow_block");
assert.equal(getSnowStormDirtEventBlock(generatedForeground, 10, 21), "snow_dirt");
assert.equal(getSnowStormDirtEventBlock(generatedForeground, 10, 22), "");

async function runGeneratedTerrainRegression() {
  const eventState = {
    foreground: new Map(),
    removed_foreground: new Map(),
    interactions: new Map(),
    seeds: new Map(),
    active_event_type: "",
    event_id: "",
    event_started_at: "",
    event_ends_at: "",
    event_changed_tiles: [],
  };
  const worldEventActionLocks = new Set();
  const worldStates = new Map();
  const startBroadcastUpdates = [];
  const startSnowStormEvent = compileSourceFunction(
    startEventSource,
    "startSnowStormEvent",
    {
      cleanWorld: (value) => String(value || "").trim().toUpperCase(),
      SNOW_STORM_EVENT_TYPE: "snow_storm",
      worldEventActionLocks,
      ensureWorldState: () => eventState,
      hasActiveSnowStormEvent: () => false,
      hasSnowRepellentBlock: () => false,
      serializeWorldState: () => ({}),
      makeAuditId: () => "snow_storm_generated_test",
      SNOW_STORM_EVENT_DURATION_MS: 600000,
      SNOW_STORM_MAX_CHANGED_TILES: 7000,
      buildEffectiveForegroundMap: () => new Map(
        Array.from(generatedForeground.entries(), ([key, entry]) => [key, { ...entry }])
      ),
      clampString,
      getSnowStormEventBlockForOriginal,
      gridKey,
      makeDeterministicRng: () => () => 1,
      SNOW_STORM_PILE_OF_SNOW_CHANCE: 0,
      canSpawnSnowStormPileAt: () => false,
      getSnowStormIceEventBlock: () => "ice_block",
      commitWorldEventStateOnly: async () => ({ ok: true }),
      worldStates,
      deserializeWorldState: () => eventState,
      scheduleWorldEventEnd: () => {},
      broadcastToWorld: () => {},
      buildWorldEventStartedMessage: () => ({}),
      broadcastEventSystemMessage: () => {},
      SNOW_STORM_SYSTEM_MESSAGE: "Snow Storm",
      broadcastEventTileUpdates: async (_world, _eventId, _phase, updates) => {
        startBroadcastUpdates.push(...updates);
      },
    }
  );

  const startResult = await startSnowStormEvent("GENERATED", { reason: "regression" });
  assert.equal(startResult.ok, true);
  assert.equal(startResult.changed_tiles, 3);
  assert.equal(eventState.foreground.get(gridKey(10, 20)).block_type, "snow_block");
  assert.equal(eventState.foreground.get(gridKey(10, 21)).block_type, "snow_dirt");
  assert.equal(eventState.foreground.has(gridKey(10, 22)), false);
  assert.equal(eventState.foreground.get(gridKey(11, 20)).block_type, "frozen_grass");
  assert.equal(eventState.event_changed_tiles.length, 3);
  assert.equal(eventState.event_changed_tiles.every((tile) => tile.source === "generated"), true);
  assert.equal(startBroadcastUpdates.length, 3);

  const endBroadcastUpdates = [];
  const endSnowStormEvent = compileSourceFunction(
    endEventSource,
    "endSnowStormEvent",
    {
      cleanWorld: (value) => String(value || "").trim().toUpperCase(),
      SNOW_STORM_EVENT_TYPE: "snow_storm",
      worldEventActionLocks,
      ensureWorldState: () => eventState,
      serializeWorldState: () => ({}),
      worldEventTimers: new Map(),
      clearWorldEventCountdownTimers: () => {},
      normalizeWorldEventTileEntry: (tile) => tile,
      gridKey,
      clampString,
      clearWorldEventState: (state) => {
        state.active_event_type = "";
        state.event_id = "";
        state.event_started_at = "";
        state.event_ends_at = "";
        state.event_changed_tiles = [];
      },
      commitWorldEventStateOnly: async () => ({ ok: true }),
      worldStates,
      deserializeWorldState: () => eventState,
      scheduleWorldEventEnd: () => {},
      broadcastToWorld: () => {},
      buildWorldEventEndedMessage: () => ({}),
      broadcastEventTileUpdates: async (_world, _eventId, _phase, updates) => {
        endBroadcastUpdates.push(...updates);
      },
    }
  );

  const endResult = await endSnowStormEvent("GENERATED", { reason: "regression" });
  assert.equal(endResult.ok, true);
  assert.equal(endResult.stats.removed_generated_overrides, 3);
  assert.equal(eventState.foreground.size, 0);
  assert.equal(eventState.active_event_type, "");
  assert.equal(eventState.event_changed_tiles.length, 0);
  assert.equal(endBroadcastUpdates.length, 3);
  assert.equal(
    endBroadcastUpdates.some((update) => update.x === 10 && update.y === 20 && update.block_type === "dirt"),
    true
  );
}

runGeneratedTerrainRegression()
  .then(() => {
    console.log("[snow-storm-event-delivery] success");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
