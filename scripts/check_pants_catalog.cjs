const assert = require('node:assert/strict');
const items = require('../server_item_database');
const { createPlayerStateHelpers } = require('../server_player_state_helpers');

const expectedNames = {
  basic_black_pants: 'Black Shorts',
  basic_light_gray_pants: 'White Shorts',
  basic_navy_pants: 'Blue Pants',
  basic_brown_pants: 'Brown Pants',
  basic_green_pants: 'Green Pants',
  basic_pink_pants: 'Pink Pants',
  black_dress_pants: 'Black Dress Pants',
  blue_dress_pants: 'Blue Dress Pants',
  police_pants: 'Police Pants',
};
const helpers = createPlayerStateHelpers({
  itemDatabase: items,
  cleanAccountName: value => String(value || '').trim(),
  clampString: value => String(value || '').trim(),
  clampInteger: (value, min, max) => Math.min(max, Math.max(min, Math.trunc(Number(value) || 0))),
  maxPlayerInventoryKeys: 500,
});

for (const [id, name] of Object.entries(expectedNames)) {
  const item = items.getItemDefinition(id);
  assert.equal(item.display_name, name);
  assert.equal(item.equipment_slot, 'pants');
  assert.equal(item.left_pants_texture, `${id}_left_leg`);
  assert.equal(item.right_pants_texture, `${id}_right_leg`);
  assert.equal(item.pants_follow_feet, true);
  assert.equal(helpers.isItemAllowedInEquipmentSlot(id, 'pants'), true);
}
assert.equal(items.hasItem('purple_pants'), false);
assert.equal(items.getItemDefinition('purple_pants'), null);
assert.equal(items.isGrantableItem('purple_pants'), false);
assert.equal(helpers.isItemAllowedInEquipmentSlot('purple_pants', 'pants'), false);
assert.equal(helpers.normalizeInventoryAmountEntry({ item_id: 'purple_pants', item_category: 'pants', amount: 1 }), null);
assert.deepEqual(
  helpers.sanitizeCountDictionary({ purple_pants: 1, basic_light_gray_pants: 2, basic_navy_pants: 3 }, 500, 'pants'),
  { basic_light_gray_pants: 2, basic_navy_pants: 3 },
);
console.log('[pants-catalog] names, split textures, retained ownership and retired item validation passed');
