const assert = require('node:assert/strict');
const { planToxicWasteSpread } = require('../toxic_waste_spread');
const db = require('../server_item_database');
const blocked = new Set(['8,8', '9,9', '10,10']);
const canPlace = (x, y) => x >= 0 && y >= 0 && !blocked.has(`${x},${y}`);
for (const random of [() => 0, () => 0.5, () => 0.999]) {
  const result = planToxicWasteSpread(10, 10, canPlace, random);
  assert.equal(result.length, 20);
  assert.equal(new Set(result.map(p => `${p.x},${p.y}`)).size, 20);
  for (const p of result) {
    assert.ok(p.x >= 5 && p.x < 15 && p.y >= 5 && p.y < 15);
    assert.ok(canPlace(p.x, p.y));
  }
}
assert.deepEqual(planToxicWasteSpread(0, 0, () => false), []);
const waste = db.getItemDefinition('toxic_waste');
assert.equal(waste.category, 'block');
assert.equal(waste.solid, true);
assert.equal(waste.lava_rebound, true);
assert.equal(waste.block_health, 1);
assert.deepEqual(waste.drop_rules.fixed_drops, []);
assert.equal(waste.break_return_to_inventory, false);
console.log('Toxic Waste: bounded unique spread, occupied cells protected, solid, contact damage, no drops');
