"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../server.js"), "utf8");

async function check(kind, title) {
  const name = `handle${title}Request`;
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0);
  const next = /\n(?:async )?function /g;
  next.lastIndex = start + 1;
  const end = next.exec(source).index;
  const state = { machine: { linked_pole_key: "", running: true, output_count: 0 } };
  const rejected = [];
  const commits = [];
  const context = {
    requireAuthenticated: () => true, requireSameWorld: () => true,
    rejectIfWorldBanned: async () => false,
    cleanWorld: value => value, clampString: value => String(value || ""),
    isGridInWorld: () => true, isPlayerNearGrid: () => true,
    canPlayerBuildAtGrid: () => true, canPlayerViewElectricalLayer: () => true,
    playerHasElectricToolEquipped: (player, disconnect) => player.tool === (disconnect ? "wire_cutter" : "electric_tool"),
    ensureWorldState: () => state, serializeWorldState: () => structuredClone(state),
    cloneJson: value => structuredClone(value), makeRequestId: () => "request",
    gridKey: (x, y) => `${x},${y}`,
    getElectricPoleDeviceStateAt: () => ({ device_type: "electric_pole" }),
    sendActionRejected: (_socket, _action, _message, data) => rejected.push(data.reason),
    makeAuditId: () => "audit", buildWorldObjectChangeEntry: (...args) => args,
    commitWorldStateWithBlockChanges: async (_world, changes) => { commits.push(changes); return { ok: true }; },
    sendWorldUpdateToRequesterAndWorld: () => {}, refreshElectricalVisibilityForWorld: () => {}, logWorldChange: () => {},
    MAX_GRID_ACTION_DISTANCE_PIXELS: 200, ELECTRICAL_DEVICE_POLE: "electric_pole",
    OIL_REFINERY_BATTERY_ITEM_ID: "battery", OIL_REFINERY_BATTERY_ITEM_CATEGORY: "material",
    OIL_REFINERY_BLOCK_TYPE: "oil_refinery", OIL_REFINERY_OUTPUT_CAPACITY: 200,
    BATTERY_CHARGER_OUTPUT_ITEM_ID: "battery", BATTERY_CHARGER_OUTPUT_CATEGORY: "material",
    BATTERY_CHARGER_BLOCK_TYPE: "battery_charger", BATTERY_CHARGER_OUTPUT_CAPACITY: 200,
  };
  context[`get${title}BlockAt`] = () => ({ block_type: kind });
  context[`get${title}StateAt`] = () => state.machine;
  context[`set${title}State`] = (_state, _world, machine) => (state.machine = machine);
  context[`make${title}StatePayload`] = (_world, machine) => structuredClone(machine);
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const request = (pole, disconnect = false) => context[name]({}, { world: "TEST", tool: disconnect ? "wire_cutter" : "electric_tool" }, {
    world: "TEST", x: 1, y: 1, operation: "link_pole", pole_x: pole, pole_y: 2, disconnect,
  });
  await request(2);
  assert.equal(state.machine.linked_pole_key, "2,2");
  assert.equal(commits.length, 1);
  const connected = structuredClone(state.machine);
  await request(3);
  await request(2);
  assert.deepEqual(rejected, ["machine_input_occupied", "machine_input_occupied"]);
  assert.deepEqual(state.machine, connected, "Rejected connections must not alter the machine or its current wire");
  assert.equal(commits.length, 1, "Rejected connections must not reach persistence");
  await request(3, true);
  assert.equal(rejected.at(-1), "link_changed");
  assert.equal(state.machine.linked_pole_key, "2,2");
  await request(2, true);
  assert.equal(state.machine.linked_pole_key, "");
  await request(3);
  assert.equal(state.machine.linked_pole_key, "3,2");
  await request(3, true);
  const before = commits.length;
  await Promise.all([request(4), request(5)]);
  assert.equal(commits.length, before + 1, "Competing requests must only commit one connection");
  assert.equal(state.machine.linked_pole_key, "4,2");
  assert.equal(rejected.at(-1), "machine_input_occupied");
  console.log(`${kind}: first link, duplicate/second link, stale cut, cut/reconnect, competing requests OK`);
}
Promise.resolve().then(async () => {
  await check("oil_refinery", "OilRefinery");
  await check("battery_charger", "BatteryCharger");
}).catch(error => { console.error(error); process.exitCode = 1; });
