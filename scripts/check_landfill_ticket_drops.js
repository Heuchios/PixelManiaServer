"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
const names = ["createBreakDrops", "isWaterBucketScoopBreak"];
const code = names.map(name => {
  const match = source.match(new RegExp(`function ${name}\\([^]*?^}`, "m"));
  assert.ok(match, name);
  return match[0];
}).join("\n");
let roll = 0, rolls = 0, normalDrops = [], eventActive = true;
const context = {
  getServerCalendarEventScheduler: () => ({ isEventActive: key => { assert.equal(key, "landfill"); return eventActive; } }),
  Math: { random: () => { rolls++; return roll; } },
  WATER_BLOCK_TYPE: "water", SERVER_DROP_PICKUP_DELAY: 1,
  ItemDatabase: { getItemDefinition: id => id === "invalid" ? null : { category: "block" } },
  getGridCenterPixels: () => ({ x: 16, y: 16 }),
  getBreakDropsForBlock: () => normalDrops.map(d => ({ ...d })),
  createServerDrop: (world, item_id, item_category, amount) => ({ world, item_id, item_category, amount }),
};
vm.createContext(context); vm.runInContext(code, context);
const update = { action: "break", block_type: "dirt", layer: "foreground", x: 0, y: 0 };
const drops = patch => context.createBreakDrops("TEST", { ...update, ...patch });
for (const sample of [0, 0.019999, 0.02, 0.999999]) {
  roll = sample;
  assert.equal(drops().filter(d => d.item_id === "landfill_ticket").length, sample < 0.02 ? 1 : 0);
}
roll = 0;
normalDrops = [{ item_id: "dirt_seed", item_category: "seed", amount: 1 }];
assert.equal(drops().length, 2, "ticket adds to existing block drops");
assert.equal(drops({ layer: "background" }).at(-1).item_id, "landfill_ticket");
normalDrops = [];
assert.equal(drops({ block_type: "vending_machine" })[0].amount, 1, "direct-return blocks can drop one ticket");
for (const patch of [{action:"hit"},{action:"place"},{block_type:""},{block_type:"invalid"},{block_type:"water",water_bucket_action:"scoop"}]) {
  const before = rolls;
  assert.equal(drops(patch).length, 0);
  assert.equal(rolls, before, "non-break actions must not roll");
}
let tickets = 0;
for (let i = 0; i < 5000; i++) { roll = i / 5000; tickets += drops().length; }
assert.equal(tickets, 100, "exactly 2% of the random range awards a ticket");
eventActive = false;
roll = 0;
normalDrops = [{ item_id: "dirt_seed", item_category: "seed", amount: 1 }];
const beforeClosedRolls = rolls;
for (const layer of ["foreground", "background"]) {
  const closedDrops = drops({ layer });
  assert.equal(closedDrops.length, 1, "normal drops remain available outside the event");
  assert.equal(closedDrops[0].item_id, "dirt_seed");
}
assert.equal(rolls, beforeClosedRolls, "inactive event must not roll for a ticket");
eventActive = true;
assert.equal(drops().at(-1).item_id, "landfill_ticket", "drops resume when the event goes live");
eventActive = false;
assert.equal(drops().length, 1, "drops stop again when the event closes");
console.log("Landfill ticket drops: live-event gating, 2% threshold, additive loot, foreground/background, and no hit/scoop rolls passed.");
