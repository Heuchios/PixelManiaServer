"use strict";
// Execute the real target validator, terrain generator and edit overlay without
// starting a server, connecting to PostgreSQL or touching any player's inventory.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
function body(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf("\nfunction ", start + 1);
  assert.ok(end > start, name);
  return source.slice(start, end);
}
const constants = source.split("\n").filter(line =>
  /^const SERVER_(TERRAIN_|BOTTOM_|CAVE_|SHALLOW_|DEEP_|POND_)/.test(line)
).join("\n");
let state, generated;
const rejected = [];
const context = {
  crypto, Map, WORLD_WIDTH: 100, WORLD_HEIGHT: 70, BEDROCK_START_Y: 66,
  TILE_SIZE: 32, MAX_FISHING_CAST_DISTANCE_PIXELS: 128,
  gridKey: (x, y) => `${x},${y}`, cleanWorld: value => String(value).toUpperCase(),
  clampInteger: (value, min, max) => Math.max(min, Math.min(max, Math.trunc(value))),
  ServerLandfillEventModule: { isLandfillWorldName: () => false },
  ensureWorldState: () => state,
  getPlayerValidationPosition: player => ({ ok: true, ...player }),
  getPlayerCurrentWorldName: () => "FREEZE", debugNetfoxAction: () => {},
  buildServerGeneratedForegroundMap: (_name, current) => current.cleared ? new Map() : generated,
  sendInventoryTransactionRejected: (_socket, _data, message) => rejected.push(message),
};
vm.createContext(context);
vm.runInContext(constants + "\n" + source.slice(
  source.indexOf("function makeDeterministicRng("),
  source.indexOf("function serverGenerateSurfaceDecorations(")
) + "\n" + ["buildEffectiveForegroundMap", "getGridCenterPixels", "isPlayerNearPoint", "isPlayerNearGrid", "validateFishingTarget"].map(body).join("\n"), context);

function naturalWorld(name) {
  const { generationSeed, surface } = context.buildServerTerrainSurface(name);
  const map = new Map();
  for (let x = 0; x < context.WORLD_WIDTH; x++) {
    const surfaceY = context.serverSurfaceYAt(surface, x);
    for (let y = surfaceY; y < context.WORLD_HEIGHT; y++) {
      context.serverMapSet(map, x, y, context.serverGeneratedBlockType(name, generationSeed, x, y, surfaceY));
    }
  }
  context.serverGenerateNaturalPonds(map, surface,
    context.makeDeterministicRng(`generated:${name}:${generationSeed}`));
  return map;
}
let checks = 0;
function validate(target, expected, label, player) {
  checks++;
  const nearby = player || { x: target.x * 32 + 16, y: target.y * 32 + 16 };
  assert.equal(context.validateFishingTarget({}, nearby, "FREEZE", target, {}), expected, label);
}
for (const name of ["FREEZE", "FISHING", "START", "POND"]) {
  state = { foreground: new Map(), removed_foreground: new Map() };
  generated = naturalWorld(name);
  const pond = [...generated.values()].find(entry => entry.block_type === "water");
  assert.ok(pond, `${name} should generate a natural pond`);
  validate(pond, true, `${name}: natural water must be fishable without a player placement`);
  const key = context.gridKey(pond.x, pond.y);
  state.removed_foreground.set(key, pond);
  validate(pond, false, "Scooped natural water must stay removed");
  state.foreground.set(key, { ...pond, block_type: "water" });
  validate(pond, true, "Newly poured water must override an old removal");
  state.foreground.set(key, { ...pond, block_type: "ice_block" });
  validate(pond, false, "Frozen water must not remain fishable");
  state.foreground.set(key, { ...pond, block_type: "dirt" });
  validate(pond, false, "Solid player edits must override generated water");
  state.foreground.clear(); state.removed_foreground.clear(); state.cleared = true;
  validate(pond, false, "Cleared worlds must not resurrect natural ponds");
  state.foreground.set(key, { ...pond, block_type: "water" });
  validate(pond, true, "Player water in a cleared world must remain fishable");
  validate(pond, false, "Distance validation must still reject remote casts", { x: -1000, y: -1000 });
}
assert.equal(context.validateFishingTarget({}, {}, "FREEZE", null, {}), false);
console.log(`FISHING_TARGETS_PASS: ${checks + 1} checks; actual generated ponds in FREEZE/FISHING/START/POND, removals, placements, ice, cleared worlds and reach`);
