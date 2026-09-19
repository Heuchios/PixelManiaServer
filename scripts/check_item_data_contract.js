const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const db = require('../server_item_database');
const patches = require('../item_data_overrides.json');
const client = JSON.parse(fs.readFileSync(path.join(__dirname, '../../pixel-mania/Data/items/item_data_overrides.json'), 'utf8'));
assert.deepEqual(patches, client, 'Client/server ITEM DATA parity');
for (const [id, patch] of Object.entries(patches)) {
  const actual = db.getItemDefinition(id);
  assert.ok(actual, id);
  for (const [key, expected] of Object.entries(patch)) assert.deepEqual(actual[key], expected, `${id}.${key}`);
}
assert.equal(db.getBlockHealth('stone'), 5);
assert.equal(db.getItemDefinition('apple').solid, true);
assert.equal(db.getItemDefinition('wood_platform').platform_collision, true);
assert.equal(db.getItemDefinition('metal_gate').instant_death, true);
assert.equal(db.getItemDefinition('bomb').instant_death, true);
assert.equal(db.getItemDefinition('lava').lava_rebound, true);
const audit = JSON.parse(fs.readFileSync(path.join(__dirname, '../../pixel-mania/docs/item-data-audit.json'), 'utf8'));
for (const row of audit.rows) {
  if (!row.resolved_ids || row.visual_state) continue;
  for (const id of row.resolved_ids) {
    const item = db.getItemDefinition(id), values = row.values;
    if (/^\d+$/.test(values[6] || '')) assert.equal(item.block_health, Number(values[6]), `${row.name} hitpoints`);
    if (/^\d+$/.test(values[5] || '')) assert.equal(item.recipe_tier, Number(values[5]), `${row.name} tier`);
    if (values[3] === 'BOTH') assert.equal(item.platform_collision, true, row.name);
    if (values[3] === 'NON SOLID' && item.category === 'block') assert.equal(item.no_collision, true, row.name);
    if (values[9] === 'BACK TO INV' && item.category === 'block') assert.equal(item.break_return_to_inventory, true, row.name);
    if (values[9] === 'BLOCK' && item.category === 'block') assert.ok(!item.drop_rules.fixed_drops.some(x => x.item_category === 'seed'), row.name);
  }
}
console.log(`ITEM DATA: ${Object.keys(patches).length} server overrides and client parity verified`);
require('./check_toxic_waste_spread');
