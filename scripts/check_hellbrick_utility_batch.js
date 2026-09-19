const assert = require('node:assert/strict');
const db = require('../server_item_database');
const specs = require('./atlas_batch_expected.json');
for (const [id, name, x, y, tier, kind] of specs) {
 const item = db.getItemDefinition(id);
 assert.equal(item.display_name, name);
 assert.deepEqual(item.texture.cell, [x,y]);
 assert.deepEqual(item.inventory_icon.cell, [x,y]);
 assert.equal(item.recipe_tier, tier);
 assert.equal(db.ITEMS[item.seed].grows_into, id);
 assert.equal(item.break_return_to_inventory, false);
 assert.deepEqual(item.drop_rules.fixed_drops.map(d=>d.item_id), [id,id+'_seed','gem']);
 assert.equal(item.solid, kind === 'solid');
 assert.equal(item.place_layer, kind === 'wall' ? 'background' : 'foreground');
}
assert.deepEqual(db.ITEMS.magma_stone.animation_frames.map(f=>f.cell),[[15,38],[16,38],[17,38],[16,38],[15,38]]);
assert.deepEqual(db.ITEMS.hellbrick_platform.platform_variant_atlas_coords,{single:[17,36],left:[18,36],middle:[19,36],right:[20,36]});
assert.equal(db.ITEMS.display_box.display_block,true);
assert.equal(db.ITEMS.yellow_portal.portal_block,true);
assert.ok(db.STATION_RECIPES.crafting_station.some(r=>r.output.item_id==='gem_driller'));
assert.ok(!Object.values(db.SPLICE_RECIPES).includes('gem_driller_seed'));
console.log('Hellbrick/utility server batch: all 14 entries and crafting-only gem driller passed');
