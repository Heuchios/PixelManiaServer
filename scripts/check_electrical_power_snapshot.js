"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
const start = source.indexOf("function getGeneratorLinksForClient(");
const end = source.indexOf("\nfunction ", start + 1);
assert.ok(start >= 0 && end > start);
const context = {
  canPlayerSeeElectricalLayer: player => player.allowed,
  getFreshElectricalNetworkCache: () => {},
  ELECTRICAL_DEVICE_GENERATOR: "generator", ELECTRICAL_DEVICE_METAL_PAD: "metal_pad", ELECTRICAL_DEVICE_POLE: "electric_pole",
  isGridInWorld: () => true,
  getGeneratorLinkedPadKeys: () => ["2:0"], getGeneratorLinkedPoleKeys: () => ["3:0"],
  parseGridKey: key => { const [x, y] = key.split(":").map(Number); return { x, y }; },
  getMetalPadDeviceStateAt: () => ({device_type:"metal_pad"}),
  getElectricPoleDeviceStateAt: () => ({device_type:"electric_pole"}), Map, Set,
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const generator = {device_type:"generator", x:0, y:0, watts:200};
const state = {electrical_devices:new Map([["0:0",generator]])};
for (const watts of [200, 0]) {
  generator.watts = watts;
  const links = context.getGeneratorLinksForClient(state, "TEST", {allowed:true});
  assert.equal(links.length, 2);
  assert.ok(links.every(link => link.generator_watts === watts));
}
assert.equal(context.getGeneratorLinksForClient(state, "TEST", {allowed:false}).length, 0);
console.log("ELECTRICAL_POWER_SNAPSHOT_OK: charged/depleted inputs and outputs, visibility permissions");
