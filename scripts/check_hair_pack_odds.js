// Exercise every possible integer roll through the compiled production sampler.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const runtime = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src/server.ts'), 'utf8');
const tablePattern = /const HAIR_PACK_TABLE[^=]*= (\[[\s\S]*?\n\]);/;
const table = vm.runInNewContext(runtime.match(tablePattern)[1]);
assert.equal(JSON.stringify(table), JSON.stringify(vm.runInNewContext(source.match(tablePattern)[1])), 'Runtime and TypeScript Hair Pack tables must match');
assert.equal(table.length, 18);
assert.equal(new Set(table.map(entry => entry.item_id)).size, table.length);
const total = table.reduce((sum, entry) => sum + entry.weight, 0);
assert(table.every(entry => Number.isInteger(entry.weight) && entry.weight > 0 && entry.item_category === 'hair'));
const samplerSource = runtime.match(/function rollWeightedReward\(table\) \{[\s\S]*?\n\}/)[0];
let currentRoll = 1;
const sample = vm.runInNewContext(`(${samplerSource})`, {
  crypto: { randomInt(min, max) {
    assert.equal(min, 1);
    assert.equal(max, total + 1);
    return currentRoll;
  } },
});
const counts = new Map();
for (; currentRoll <= total; currentRoll++) {
  const id = sample(table).item_id;
  counts.set(id, (counts.get(id) || 0) + 1);
}
assert.equal(counts.size, table.length, 'Every listed hair must be reachable');
for (const id of ['flaming_hair', 'frosty_hair', 'supernova_hair']) {
  assert.equal(counts.get(id) * 100, total, `${id} must have an exact 1% chance`);
}
assert.equal(counts.get('baby_hair') * 1000, total, 'Baby Hair must retain 0.1%');
for (const entry of table) assert.equal(counts.get(entry.item_id), entry.weight, `${entry.item_id}: sampler interval`);
const common = table.filter(entry => !['flaming_hair', 'frosty_hair', 'supernova_hair', 'baby_hair'].includes(entry.item_id));
assert.equal(common.length, 14);
assert(common.every(entry => entry.weight === common[0].weight), 'Other hairs split the remainder evenly');
console.log(`HAIR_PACK_ODDS_OK: ${total} exhaustive rolls; Flaming/Frosty/Supernova 1% each, Baby Hair 0.1%, 14 equal common rewards`);
