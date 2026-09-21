"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ItemDatabase = require("../server_item_database");
const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const start = source.indexOf("function rollFishingReward(");
const end = source.indexOf("function getFishingRewardFxRarity(", start);
assert.ok(start >= 0 && end > start);
let roll = 0;
let normalRolls = 0;
const handler = vm.runInNewContext(source.slice(start, end) + "\nrollFishingReward;", {
  ItemDatabase,
  crypto: { randomInt: (min, max) => {
    assert.equal(min, 0);
    assert.equal(max, 1000);
    return roll;
  } },
  clampString: value => String(value || ""),
  clampInteger: (value, min, max) => Math.min(max, Math.max(min, Number(value))),
  resolveInventoryCategory: id => ItemDatabase.getItemDefinition(id).category,
  rollWeightedReward: table => { normalRolls++; return table[0]; },
});
const hat = ItemDatabase.getItemDefinition("octopus_hat");
assert.equal(hat.category, "hat");
assert.equal(hat.equipment_slot, "hat");
assert.equal(hat.instance_tracked, true);
assert.equal(hat.equipable, true);
const rods = Object.keys(ItemDatabase.ITEMS).filter(id => ItemDatabase.isFishingRodItem(id));
const lures = Object.keys(ItemDatabase.ITEMS).filter(id => ItemDatabase.getItemDefinition(id).category === "lure");
assert.ok(rods.length > 0 && lures.includes("magnet_lure"));
let combinations = 0;
for (const rod of rods) {
  for (const lure of lures) {
    let hats = 0;
    const before = normalRolls;
    for (roll = 0; roll < 1000; roll++) {
      const reward = handler(lure, rod);
      assert.ok(reward);
      if (reward.item_id === "octopus_hat") {
        hats++;
        assert.equal(reward.item_category, "hat");
        assert.equal(reward.fish_id, "");
      }
    }
    assert.equal(hats, 1, `${rod}/${lure}: exactly 0.1%`);
    assert.equal(normalRolls - before, 999, "Other rolls use the existing reward table");
    combinations++;
  }
}
console.log(`[octopus-hat] Exact 0.1% roll verified for ${combinations} rod/lure combinations`);
