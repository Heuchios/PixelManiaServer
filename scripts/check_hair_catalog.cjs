const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const items = require('../server_item_database');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '../../pixel-mania/Scripts/item_database.gd'), 'utf8');
const table = vm.runInNewContext(server.match(/const HAIR_PACK_TABLE = (\[[\s\S]*?\n\]);/)[1]);
const clientTable = JSON.parse(client.match(/const HAIR_PACK_REWARDS = (\[[\s\S]*?\n\])/)[1]);
assert.equal(table.length, 12);
assert.equal(table.reduce((sum, entry) => sum + entry.weight, 0), table.find(entry => entry.item_id === 'baby_hair').weight * 1000);
assert.deepEqual(Array.from(table, entry => ({item_id: entry.item_id, weight: entry.weight})), clientTable);
assert.deepEqual(Array.from(table, entry => entry.item_id), items.getItemDefinition('hairpack').pack_rewards);
for (const entry of table) assert.equal(items.getItemDefinition(entry.item_id).equipment_slot, 'hair');
for (const id of ['blonde_afro','brown_afro','pink_afro','red_afro','short_black_hair','short_blonde_hair','short_bron_hair','short_pink_hair','short_red_hair','long_black_hair','long_blonde_hair','long_grey_hair','long_pink_hair','long_red_hair']) {
  assert.equal(items.hasItem(id), false);
  assert.equal(client.includes('"' + id + '"'), false);
}
console.log('[hair-catalog] Retired items absent, client/server rewards match, Baby Hair remains 0.1%');
