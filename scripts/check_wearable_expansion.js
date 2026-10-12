#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = require('../server_item_database');
const groups = {
  shirt: 'scrub_top space_suit void_shirt coveralls white_skirt purple_skirt black_skirt red_skirt wizards_robe purple_dress black_coat',
  pants: 'scrub_bottoms space_pants void_pants',
  beard: 'scrub_mask duck_beak cat_face_mask rat_face_mask clown_nose cigar floral_circlet horse_mask welding_mask space_mask skull_mask burning_skull sack_mask bag_on_the_head',
  hat: 'red_headphones meowphones',
  eyewear: 'eye_patch void_visor',
  shoes: 'golden_shoes green_sneakers basic_yellow_shoes white_shoes diamond_shoes slippers black_slippers bunny_slippers duck_slippers green_slippers grey_sneakers void_slippers',
};
const animated = {clown_nose:2,cigar:3,red_headphones:3,meowphones:3,void_visor:4,horse_mask:2,burning_skull:4};
const client = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : null;
let count = 0;
for (const [slot, ids] of Object.entries(groups)) {
  for (const id of ids.split(' ')) {
    const item = db.getItemDefinition(id);
    assert.ok(item, id);
    assert.equal(item.category, slot, id);
    assert.equal(item.equipment_slot, slot, id);
    for (const flag of ['equipable','instance_tracked','tradeable','dropable','admin_grantable']) assert.equal(item[flag], true, `${id}: ${flag}`);
    assert.equal(item.starting_count, 0, id);
    assert.equal(item.hidden, false, id);
    assert.ok(item.inventory_icon && item.texture, id);
    if (slot !== 'shoes') assert.notEqual(item.texture, item.inventory_icon, `${id}: separate preview`);
    if (slot === 'beard') assert.equal(item.display_category, 'Mask', id);
    if (slot === 'pants') assert.ok(item.pants_follow_feet && item.left_pants_texture && item.right_pants_texture, id);
    if (slot === 'shoes') {
      assert.equal(item.texture, item.inventory_icon, id);
      assert.notEqual(item.left_shoe_texture, item.right_shoe_texture, id);
    }
    if (animated[id]) {
      const animation = item[slot + '_animations'].idle;
      assert.equal(animation.frames.length, animated[id], id);
      assert.equal(animation.loop, true, id);
      assert.equal(animation.fps, 6, id);
    }
    if (client) {
      assert.ok(client[id], `${id}: client exists`);
      for (const [key, value] of Object.entries(client[id])) {
        if (key !== 'order') assert.deepEqual(item[key], value, `${id}: client/server ${key}`);
      }
    }
    count++;
  }
}
assert.equal(count, 44);
assert.equal(db.getItemDefinition('flaming_skull').category, 'hat', 'Keep existing owned skull hats valid');
assert.equal(db.getItemDefinition('basic_yellow_shoes').display_name, 'Yellow Shoes');
assert.equal(db.getItemDefinition('wizards_robe').display_name, "Wizard's Robe");
console.log(`WEARABLE_EXPANSION_OK: ${count} items; equipment, economy flags, masks, split parts, animation counts${client ? ', complete client/server parity' : ''}`);
