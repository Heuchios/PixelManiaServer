const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const db = require('../server_item_database');
const client = process.env.PIXELMANIA_CLIENT_DIR || path.resolve(__dirname, '../../pixel-mania');
const manifest = JSON.parse(fs.readFileSync(path.join(client, 'docs/furniture-atlas-update.json'), 'utf8'));
for (const row of manifest.items) {
  const item = db.getItemDefinition(row.id);
  assert.equal(item.display_name, row.name, row.id);
  assert.deepEqual(item.atlas_coords, [row.x, row.y], row.id);
  assert.equal(item.solid, ['solid', 'entrance'].includes(row.mode), row.id);
  assert.equal(item.platform_collision, row.mode === 'platform', row.id);
  assert.equal(item.place_layer, row.mode === 'wall' ? 'background' : 'foreground', row.id);
  assert.equal(db.getItemDefinition(item.seed).grows_into, row.id, row.id);
  assert.equal(db.getItemDefinition(item.seed).display_name, row.name + ' Seed', row.id);
  for (const rules of [item.drop_rules, item.tree_drop_rules]) {
    assert.ok(rules.fixed_drops.some(d => d.item_id === row.id), row.id);
    assert.ok(rules.fixed_drops.some(d => d.item_id === item.seed), row.id);
    assert.ok(rules.fixed_drops.some(d => d.item_id === 'gem'), row.id);
  }
}
// Execute the production toggle/damage-identity helpers, not a copy of their logic.
const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const helpers = source.slice(source.indexOf('function getPunchToggleBlockDefinition('), source.indexOf('function getWorldBlockActionLockResource('));
const ctx = { ItemDatabase: db, ItemAtlasDB: {}, clampString: x => String(x || ''), cleanWorld: x => x };
vm.createContext(ctx);
vm.runInContext(helpers, ctx);
for (const [id, item] of Object.entries(manifest.updates)) {
  if (!item.toggle_active_block || item.hidden) continue;
  const active = item.toggle_active_block;
  assert.equal(ctx.getPunchToggleNextBlockType(id), active, id);
  assert.equal(ctx.getPunchToggleNextBlockType(active), item.punch_open_only ? '' : id, id);
  assert.equal(ctx.getBlockDamageIdentityBlockType(active), id, id);
  assert.deepEqual(db.getItemDefinition(active).drop_rules, db.getItemDefinition(id).drop_rules, id);
  assert.equal(db.getItemDefinition(active).seed, '', id);
  assert.equal(db.getItemDefinition(active).placeable, false, id);
}
assert.deepEqual(db.getItemDefinition('fireplace_on').animation_atlas_coords, [[18,23],[19,23],[20,23],[19,23],[18,23]]);
for (const id of ['rubber_duck', 'fan']) assert.equal(db.getItemDefinition(id).animation_trigger, 'on_punch');
console.log(`Furniture atlas OK: ${manifest.items.length} items; drops, seeds, collision and production toggle helpers verified.`);
