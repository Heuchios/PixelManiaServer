#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server_item_database');
const root = process.env.PIXELMANIA_CLIENT_DIR || path.resolve(__dirname, '../../pixel-mania');
const rows = fs.readFileSync(path.join(root, 'docs/atlas-item-update.tsv'), 'utf8').trim().split(/\r?\n/).slice(1).map(row => row.split('\t'));
const atlas = JSON.parse(fs.readFileSync(path.join(root, 'Data/items/atlas_items.json'), 'utf8')).items;
for (const [id, name, x, y, mode, frameCount] of rows) {
  const item = db.getItemDefinition(id);
  assert.ok(item, id);
  assert.equal(item.category, 'block', id);
  assert.equal(item.display_name, name, id);
  if (mode !== 'keep') {
    const entry = atlas.find(a => a.item_key === id);
    assert.ok(entry, id);
    assert.deepEqual(entry.atlas_coords, [+x, +y], id);
    assert.deepEqual(item.atlas_coords, [+x, +y], id);
    assert.equal(item.collidable, mode === 'solid', id);
    assert.equal(item.no_collision, mode !== 'solid', id);
    assert.equal(item.place_layer, mode === 'wall' ? 'background' : 'foreground', id);
    assert.equal(entry.collision, mode === 'solid', id);
  }
  if (mode === 'return') {
    assert.equal(item.seed, '', id);
    assert.equal(item.break_return_to_inventory, true, id);
    assert.equal(item.break_return_item_id, id);
    assert.deepEqual(item.drop_rules.fixed_drops, [], id);
    assert.deepEqual(item.tree_drop_rules.fixed_drops, [], id);
    assert.deepEqual(item.drop_rules.gem_range, [0, 0], id);
    continue;
  }
  assert.ok(item.seed, id);
  assert.equal(db.getItemDefinition(item.seed)?.grows_into, id);
  assert.equal(db.getItemDefinition(item.seed)?.display_name, name + ' Seed');
  for (const field of ['drop_rules', 'tree_drop_rules']) {
    const rules = item[field];
    assert.ok(rules.fixed_drops.some(d => d.item_id === id && d.item_category === 'block'), id + field);
    assert.ok(rules.seed_chance > 0 || rules.fixed_drops.some(d => d.item_id === item.seed && d.item_category === 'seed'), id + field);
    assert.ok(rules.gem_range?.[1] > 0 || rules.fixed_drops.some(d => d.item_id === 'gem' && d.item_category === 'currency'), id + field);
  }
  if (+frameCount > 1) assert.equal(item.animation_frames.length, +frameCount, id);
}
const recycle = db.getItemDefinition('recycle_bin');
assert.equal(recycle.server_triggered_animation, true);
assert.equal(recycle.animation_trigger, 'on_recycle');
assert.deepEqual(recycle.animation_atlas_coords, [[17, 14], [18, 14]]);
assert.deepEqual(db.getItemDefinition('quest_board').texture.region, [576, 480, 64, 32]);
assert.equal(db.getItemDefinition('oil_refinery').oil_refinery_block, true);
assert.equal(db.getItemDefinition('shifty_block').colour_cycle_block, true);
assert.equal(db.getItemDefinition('entrance_gate').category, 'block');
assert.deepEqual(db.getItemDefinition('spring_leaf').atlas_coords, [4, 3]);
const snapshotPath = process.argv[2];
if (snapshotPath) {
  const verified = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  for (const [id] of rows) {
    assert.ok(verified[id], id);
    for (const field of ['display_name', 'seed', 'drop_rules', 'tree_drop_rules']) {
      assert.deepEqual(db.getItemDefinition(id)[field], verified[id][field], `${id}: client/server ${field}`);
    }
  }
}
console.log(`Atlas item update OK: ${rows.length} names, coordinates, collision/layers, seed mappings, drops and exceptions.`);
