"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const backendRoot = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(backendRoot, "server.js"), "utf8");
const worldStateHelperSource = fs.readFileSync(path.join(backendRoot, "server_world_state_helpers.js"), "utf8");
const worldStateHelperTypeScript = fs.readFileSync(
  path.join(backendRoot, "src", "server_world_state_helpers.ts"),
  "utf8"
);

function extractFunction(source, functionName, nextFunctionName) {
  const startToken = `function ${functionName}(`;
  const start = source.indexOf(startToken);
  const boundaryCandidates = [
    source.indexOf(`\nfunction ${nextFunctionName}(`, start),
    source.indexOf(`\nasync function ${nextFunctionName}(`, start),
  ].filter((index) => index >= 0);
  const end = boundaryCandidates.length > 0 ? Math.min(...boundaryCandidates) : -1;
  assert.notEqual(start, -1, `Missing ${functionName}`);
  assert.notEqual(end, -1, `Missing boundary after ${functionName}`);
  return source.slice(start, end);
}

const applyMoveSource = extractFunction(
  serverSource,
  "applyEntranceGateMoveToWorldState",
  "handleEntranceGateMoveUpdate"
);
const createApplyMove = new Function(
  "buildEffectiveForegroundMap",
  "gridKey",
  "clampString",
  "isGridInWorld",
  "cleanWorld",
  "repairEntranceGateState",
  "ENTRANCE_GATE_TYPE",
  `"use strict"; ${applyMoveSource}; return applyEntranceGateMoveToWorldState;`
);

const gridKey = (x, y) => `${x},${y}`;
const effectiveForeground = new Map([
  [gridKey(10, 10), { x: 10, y: 10, block_type: "entrance_gate", source: "generated" }],
  [gridKey(9, 11), { x: 9, y: 11, block_type: "grass", source: "generated" }],
  [gridKey(10, 11), { x: 10, y: 11, block_type: "bedrock", source: "generated" }],
  [gridKey(11, 11), { x: 11, y: 11, block_type: "grass", source: "generated" }],
]);
const applyMove = createApplyMove(
  () => new Map(effectiveForeground),
  gridKey,
  (value) => String(value || ""),
  (x, y) => x >= 0 && x < 100 && y >= 0 && y < 70,
  (value) => String(value || "").trim().toUpperCase(),
  () => null,
  "entrance_gate"
);

const state = {
  foreground: new Map(),
  interactions: new Map(),
  seeds: new Map(),
  removed_foreground: new Map(),
};
const updates = applyMove("GENERATED", state, { x: 10, y: 10 }, { x: 20, y: 20 });

assert.equal(state.foreground.has(gridKey(10, 11)), false);
assert.equal(state.removed_foreground.get(gridKey(10, 11)).block_type, "bedrock");
assert.equal(state.foreground.get(gridKey(20, 21)).block_type, "bedrock");
assert.equal(state.foreground.get(gridKey(20, 20)).block_type, "entrance_gate");
assert.equal(
  updates.some((update) => (
    update.action === "break"
    && update.x === 10
    && update.y === 11
    && update.block_type === "bedrock"
  )),
  true,
  "Generated entrance support must produce a break update"
);
assert.equal(
  updates.some((update) => update.action === "break" && update.x === 9 && update.y === 11),
  false,
  "Ordinary generated terrain beside the support must be preserved"
);

const repairSupportSource = extractFunction(
  serverSource,
  "repairMovedDefaultEntranceGateSupportInState",
  "repairEntranceGateState"
);
const createRepairSupport = new Function(
  "getDefaultEntranceGateSpawnForWorld",
  "gridKey",
  "clampString",
  "isGridInWorld",
  "ENTRANCE_GATE_TYPE",
  `"use strict"; ${repairSupportSource}; return repairMovedDefaultEntranceGateSupportInState;`
);
const repairSupport = createRepairSupport(
  () => ({ grid_x: 10, grid_y: 10 }),
  gridKey,
  (value) => String(value || ""),
  (x, y) => x >= 0 && x < 100 && y >= 0 && y < 70,
  "entrance_gate"
);
const affectedSave = {
  foreground: new Map([[gridKey(20, 20), { x: 20, y: 20, block_type: "entrance_gate" }]]),
  removed_foreground: new Map([
    [gridKey(10, 10), { x: 10, y: 10, block_type: "entrance_gate" }],
  ]),
};
repairSupport(affectedSave, { x: 20, y: 20 }, "GENERATED");
assert.equal(affectedSave.removed_foreground.get(gridKey(10, 11)).block_type, "bedrock");

assert.match(worldStateHelperSource, /repairEntranceGateState\(state, worldName\)/);
assert.match(worldStateHelperTypeScript, /repairEntranceGateState\(state, worldName\)/);
assert.match(
  serverSource,
  /const oldGate = findEntranceGateInBlockMap\(buildEffectiveForegroundMap\(worldName, state\)\)/
);

const generationVersionSource = extractFunction(
  serverSource,
  "getWorldGenerationVersion",
  "getGeneratedEntranceGateGridY"
);
const generatedGateGridYSource = extractFunction(
  serverSource,
  "getGeneratedEntranceGateGridY",
  "getDefaultEntranceGateSpawnForWorld"
);
const createGeneratedGateGridY = new Function(
  "clampInteger",
  "LEGACY_WORLD_GENERATION_VERSION",
  "CURRENT_WORLD_GENERATION_VERSION",
  "LOWERED_ENTRANCE_GATE_GENERATION_VERSION",
  "WORLD_HEIGHT",
  `"use strict"; ${generationVersionSource}; ${generatedGateGridYSource}; return getGeneratedEntranceGateGridY;`
);
const generatedGateGridY = createGeneratedGateGridY(
  (value, min, max) => Math.max(min, Math.min(max, Math.trunc(Number(value) || 0))),
  1,
  2,
  2,
  70
);

assert.equal(generatedGateGridY(25, { world_generation_version: 1 }), 24);
assert.equal(generatedGateGridY(25, { world_generation_version: 2 }), 25);
assert.equal(generatedGateGridY(25, {}), 24);

const applyGeneratedGateSource = extractFunction(
  serverSource,
  "applyServerDefaultEntranceGateToGeneratedMaps",
  "buildServerGeneratedWorldMaps"
);
const createApplyGeneratedGate = new Function(
  "clampInteger",
  "WORLD_WIDTH",
  "WORLD_HEIGHT",
  "BEDROCK_START_Y",
  "serverSurfaceYAt",
  "getGeneratedEntranceGateGridY",
  "findEntranceGateInState",
  "isGridInWorld",
  "gridKey",
  "serverMapSet",
  "serverMapClear",
  "ensureEntranceGateSupportInState",
  "cleanupLegacyEntranceGateSupportInState",
  "ENTRANCE_GATE_TYPE",
  `"use strict"; ${applyGeneratedGateSource}; return applyServerDefaultEntranceGateToGeneratedMaps;`
);
const setGeneratedCell = (map, x, y, blockType) => {
  map.set(gridKey(x, y), { x, y, block_type: blockType });
};
const applyGeneratedGate = createApplyGeneratedGate(
  (value, min, max) => Math.max(min, Math.min(max, Math.trunc(Number(value) || 0))),
  100,
  70,
  66,
  () => 25,
  generatedGateGridY,
  () => null,
  (x, y) => x >= 0 && x < 100 && y >= 0 && y < 70,
  gridKey,
  setGeneratedCell,
  (map, x, y) => map?.delete(gridKey(x, y)),
  (targetState, gate) => setGeneratedCell(targetState.foreground, gate.x, gate.y + 1, "bedrock"),
  () => {},
  "entrance_gate"
);

const currentGeneratedForeground = new Map();
const currentGeneratedBackground = new Map();
applyGeneratedGate(
  "NEW_WORLD",
  { world_generation_version: 2 },
  currentGeneratedForeground,
  currentGeneratedBackground,
  []
);
assert.equal(currentGeneratedForeground.get(gridKey(50, 25)).block_type, "entrance_gate");
assert.equal(currentGeneratedForeground.get(gridKey(50, 26)).block_type, "bedrock");
assert.equal(currentGeneratedForeground.has(gridKey(50, 24)), false);

const legacyGeneratedForeground = new Map();
applyGeneratedGate(
  "OLD_WORLD",
  { world_generation_version: 1 },
  legacyGeneratedForeground,
  new Map(),
  []
);
assert.equal(legacyGeneratedForeground.get(gridKey(50, 24)).block_type, "entrance_gate");
assert.equal(legacyGeneratedForeground.get(gridKey(50, 25)).block_type, "bedrock");

assert.match(
  serverSource,
  /getDefaultEntranceGateSpawnForWorld\(worldName, state\)/
);
assert.match(
  serverSource,
  /const gateY = getGeneratedEntranceGateGridY\(surfaceY, state\)/
);
for (const helperSource of [worldStateHelperSource, worldStateHelperTypeScript]) {
  assert.match(helperSource, /world_generation_version:\s*currentWorldGenerationVersion/);
  assert.match(helperSource, /data\.world_generation_version\s*\|\|\s*legacyWorldGenerationVersion/);
  assert.match(helperSource, /state\.world_generation_version\s*\|\|\s*legacyWorldGenerationVersion/);
}

console.log("[entrance-gate-move-fix] success");
