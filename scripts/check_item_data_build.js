#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.item-data.json"), "utf8"));
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_item_data_build.js"), "utf8");
const itemDatabaseSource = fs.readFileSync(path.join(repoRoot, "src", "server_item_database.ts"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "src", "server.ts"), "utf8");
const atlasDbSource = fs.readFileSync(path.join(repoRoot, "src", "item_atlas_db.ts"), "utf8");
const atlasDefinitionSource = fs.readFileSync(path.join(repoRoot, "src", "atlas_item_definition.ts"), "utf8");

const itemDatabase = require("../server_item_database");
const atlasDb = require("../item_atlas_db");
const atlasDefinition = require("../atlas_item_definition");

assert.equal(typeof itemDatabase.getItemDefinition, "function");
assert.equal(typeof itemDatabase.getInventoryFieldForItem, "function");
assert.equal(typeof itemDatabase.getFishingTable, "function");
assert.equal(typeof atlasDb.getItemIdForKey, "function");
assert.equal(typeof atlasDefinition.buildAtlasItemDefinition, "function");

assert.equal(itemDatabase.getItemDefinition("dirt")?.category, "block");
assert.equal(itemDatabase.getInventoryFieldForItem("gem"), "currency_inventory");
assert.equal(itemDatabase.getPlaceLayer("wooden_background"), "background");
assert.equal(itemDatabase.hasItem("axe"), false);
assert.equal(itemDatabase.hasItem("pickaxe"), false);
assert.equal(itemDatabase.hasItem("shovel"), false);
assert.equal(itemDatabase.hasItem("furnace"), false);

const themeMachineCases = [
  { itemId: "night_theme_machine", atlasItemId: 37, theme: "night", cells: [[17, 7], [18, 7]] },
  { itemId: "snow_theme_machine", atlasItemId: 38, theme: "snow", cells: [[17, 8], [18, 8]] },
  { itemId: "city_theme_machine", atlasItemId: 36, theme: "city", cells: [[17, 9], [18, 9]] },
];
for (const themeMachineCase of themeMachineCases) {
  const definition = itemDatabase.getItemDefinition(themeMachineCase.itemId);
  assert.equal(atlasDb.getItemIdForKey(themeMachineCase.itemId), themeMachineCase.atlasItemId);
  assert.deepEqual(
    Array.from(atlasDb.getItem(themeMachineCase.atlasItemId)?.atlas_coords || []),
    themeMachineCase.cells[0],
  );
  assert.equal(definition?.category, "block");
  assert.equal(definition?.rarity, "legendary");
  assert.equal(definition?.instance_tracked, true);
  assert.equal(definition?.block_health, 4);
  assert.equal(definition?.no_collision, true);
  assert.equal(definition?.collidable, false);
  assert.equal(definition?.theme_machine_block, true);
  assert.equal(definition?.theme_machine_theme, themeMachineCase.theme);
  assert.equal(definition?.theme_machine_frame_seconds, 0.45);
  assert.equal(definition?.shop_price, 125000);
  assert.equal(definition?.break_return_to_inventory, true);
  assert.equal(definition?.drop_rules?.seed_chance, 0);
  assert.deepEqual(Array.from(definition?.drop_rules?.gem_range || []), [0, 0]);
  assert.equal(definition?.atlas_item_id, themeMachineCase.atlasItemId);
  assert.equal(definition?.atlas_source_id, 0);
  assert.equal(definition?.source_id ?? definition?.atlas_source_id, 0);
  assert.equal(definition?.alternative_tile, 0);
  assert.deepEqual(Array.from(definition?.atlas_coords || []), themeMachineCase.cells[0]);
  assert.deepEqual(Array.from(definition?.texture?.cell || []), themeMachineCase.cells[0]);
  assert.deepEqual(Array.from(definition?.inventory_icon?.cell || []), themeMachineCase.cells[0]);
  assert.deepEqual(
    definition?.theme_machine_enabled_frames?.map((/** @type {any} */ frame) => Array.from(frame.cell || [])),
    themeMachineCase.cells,
  );
}
assert.match(serverSource, /\["city_theme_machine",\s*\{\s*item_id:\s*"city_theme_machine"[^]*?price:\s*125000\s*\}\]/);
assert.match(serverSource, /new Set\(\["night", "snow", "city"\]\)/);
assert.match(serverSource, /const configuredTheme = sanitizeWorldBackgroundTheme\(definition\.theme_machine_theme \|\| ""\)/);
assert.match(serverSource, /update\.theme = configuredTheme \|\| sanitizeWorldBackgroundTheme\(update\.theme \|\| "night"\) \|\| "night"/);

const atmMachineDefinition = itemDatabase.getItemDefinition("atm_machine");
assert.equal(atlasDb.getItemIdForKey("atm_machine"), 39);
assert.deepEqual(Array.from(atlasDb.getItem(39)?.atlas_coords || []), [5, 16]);
assert.equal(atmMachineDefinition?.category, "block");
assert.equal(atmMachineDefinition?.rarity, "epic");
assert.equal(atmMachineDefinition?.instance_tracked, true);
assert.equal(atmMachineDefinition?.block_health, 4);
assert.equal(atmMachineDefinition?.no_collision, true);
assert.equal(atmMachineDefinition?.collidable, false);
assert.equal(atmMachineDefinition?.atm_machine_block, true);
assert.equal(atmMachineDefinition?.atm_machine_cooldown_seconds, 43200);
assert.equal(atmMachineDefinition?.atm_machine_reward_item_id, "gem");
assert.equal(atmMachineDefinition?.atm_machine_reward_item_category, "currency");
assert.deepEqual(Array.from(atmMachineDefinition?.atm_machine_reward_amount_range || []), [1, 100]);
assert.deepEqual(Array.from(atmMachineDefinition?.atm_machine_ready_atlas_coords || []), [5, 16]);
assert.deepEqual(Array.from(atmMachineDefinition?.atm_machine_producing_atlas_coords || []), [6, 16]);
assert.equal(atmMachineDefinition?.shop_price, 12500);
assert.equal(atmMachineDefinition?.break_return_to_inventory, true);
assert.equal(atmMachineDefinition?.drop_rules?.seed_chance, 0);
assert.deepEqual(Array.from(atmMachineDefinition?.drop_rules?.gem_range || []), [0, 0]);
assert.equal(atmMachineDefinition?.atlas_item_id, 39);
assert.equal(atmMachineDefinition?.atlas_source_id, 0);
assert.equal(atmMachineDefinition?.source_id ?? atmMachineDefinition?.atlas_source_id, 0);
assert.equal(atmMachineDefinition?.alternative_tile, 0);
assert.deepEqual(Array.from(atmMachineDefinition?.atlas_coords || []), [5, 16]);
assert.deepEqual(Array.from(atmMachineDefinition?.texture?.cell || []), [5, 16]);
assert.deepEqual(Array.from(atmMachineDefinition?.inventory_icon?.cell || []), [5, 16]);
assert.match(serverSource, /\["atm_machine",\s*\{\s*item_id:\s*"atm_machine"[^]*?price:\s*12500\s*\}\]/);
assert.match(serverSource, /const ATM_MACHINE_COOLDOWN_MS = 12 \* 60 \* 60 \* 1000/);
assert.match(serverSource, /function isAtmMachineBlockType\(blockType/);
assert.match(serverSource, /action:\s*"atm_machine_harvest"/);
assert.match(serverSource, /source:\s*"atm_machine"/);
assert.match(serverSource, /world_changes:\s*\[objectChange\]/);
assert.match(serverSource, /ATM Machine produced \$\{committedAtmReward\.amount\} gems\./);
assert.match(atlasDefinitionSource, /"atm_machine_block"/);
assert.match(atlasDefinitionSource, /"atm_machine_reward_amount_range"/);
assert.equal(atlasDefinition.ATLAS_PASSTHROUGH_KEYS.includes("seed"), true);

/**
 * @param {any} definition
 * @param {string} itemId
 */
function fixedDrop(definition, itemId) {
  return (definition?.drop_rules?.fixed_drops || []).find((/** @type {any} */ drop) => drop.item_id === itemId);
}

/**
 * @param {any} definition
 * @param {string} itemId
 */
function treeDrop(definition, itemId) {
  return (definition?.tree_drop_rules?.fixed_drops || []).find((/** @type {any} */ drop) => drop.item_id === itemId);
}

/**
 * @param {{ itemId: string, atlasItemId: number, cell: number[], layer: string, health: number, rarity: string }} blockCase
 */
function assertAtlasBlockDefinition(blockCase) {
  const definition = itemDatabase.getItemDefinition(blockCase.itemId);
  const seedId = `${blockCase.itemId}_seed`;
  assert.equal(atlasDb.getItemIdForKey(blockCase.itemId), blockCase.atlasItemId);
  assert.deepEqual(Array.from(atlasDb.getItem(blockCase.atlasItemId)?.atlas_coords || []), blockCase.cell);
  assert.equal(definition?.category, "block");
  assert.equal(definition?.rarity, blockCase.rarity);
  assert.equal(definition?.block_health, blockCase.health);
  assert.equal(definition?.seed, seedId);
  assert.equal(definition?.atlas_item_id, blockCase.atlasItemId);
  assert.deepEqual(Array.from(definition?.atlas_coords || []), blockCase.cell);
  assert.deepEqual(Array.from(definition?.texture?.cell || []), blockCase.cell);
  assert.deepEqual(Array.from(definition?.inventory_icon?.cell || []), blockCase.cell);
  assert.equal(itemDatabase.getPlaceLayer(blockCase.itemId), blockCase.layer);
  if (blockCase.layer === "background") {
    assert.equal(definition?.background_block, true);
    assert.equal(definition?.no_collision, true);
    assert.equal(definition?.collidable, false);
  } else {
    assert.equal(definition?.no_collision, false);
    assert.equal(definition?.collidable, true);
  }

  const seedDefinition = itemDatabase.getItemDefinition(seedId);
  assert.equal(seedDefinition?.category, "seed");
  assert.equal(seedDefinition?.grows_into, blockCase.itemId);
}

const brickBlockCases = [
  { itemId: "red_brick", atlasItemId: 40, cell: [17, 5], layer: "foreground", health: 5, rarity: "uncommon" },
  { itemId: "stone_brick", atlasItemId: 41, cell: [18, 5], layer: "foreground", health: 5, rarity: "uncommon" },
  { itemId: "green_brick", atlasItemId: 42, cell: [19, 5], layer: "foreground", health: 5, rarity: "uncommon" },
  { itemId: "green_moss_brick", atlasItemId: 43, cell: [20, 5], layer: "foreground", health: 5, rarity: "uncommon" },
  { itemId: "red_brick_wall", atlasItemId: 44, cell: [17, 6], layer: "background", health: 3, rarity: "uncommon" },
  { itemId: "stone_brick_wall", atlasItemId: 45, cell: [18, 6], layer: "background", health: 3, rarity: "uncommon" },
  { itemId: "green_brick_wall", atlasItemId: 46, cell: [19, 6], layer: "background", health: 3, rarity: "uncommon" },
  { itemId: "green_moss_brick_wall", atlasItemId: 47, cell: [20, 6], layer: "background", health: 3, rarity: "uncommon" },
];
for (const blockCase of brickBlockCases) {
  assertAtlasBlockDefinition(blockCase);
  const definition = itemDatabase.getItemDefinition(blockCase.itemId);
  const seedId = `${blockCase.itemId}_seed`;
  assert.deepEqual(fixedDrop(definition, blockCase.itemId), {
    item_id: blockCase.itemId,
    item_category: "block",
    amount: 1,
    chance: 0.45,
  });
  assert.deepEqual(fixedDrop(definition, seedId), {
    item_id: seedId,
    item_category: "seed",
    amount: 1,
    chance: 0.08,
  });
  assert.deepEqual(Array.from(fixedDrop(definition, "gem")?.amount_range || []), [1, 5]);
  assert.deepEqual(Array.from(treeDrop(definition, blockCase.itemId)?.amount_range || []), [1, 4]);
  assert.deepEqual(Array.from(treeDrop(definition, seedId)?.amount_range || []), [0, 4]);
}

const gemBlockCases = [
  { itemId: "gold_block", atlasItemId: 48, cell: [21, 5], layer: "foreground", health: 6, rarity: "epic" },
  { itemId: "emerald_block", atlasItemId: 49, cell: [22, 5], layer: "foreground", health: 6, rarity: "epic" },
  { itemId: "ruby_block", atlasItemId: 50, cell: [23, 5], layer: "foreground", health: 6, rarity: "epic" },
  { itemId: "diamond_block", atlasItemId: 51, cell: [24, 5], layer: "foreground", health: 6, rarity: "epic" },
  { itemId: "amethyst_block", atlasItemId: 52, cell: [25, 5], layer: "foreground", health: 6, rarity: "epic" },
];
for (const blockCase of gemBlockCases) {
  assertAtlasBlockDefinition(blockCase);
  const definition = itemDatabase.getItemDefinition(blockCase.itemId);
  const seedId = `${blockCase.itemId}_seed`;
  assert.deepEqual(Array.from(fixedDrop(definition, blockCase.itemId)?.amount_range || []), [0, 3]);
  assert.equal(fixedDrop(definition, blockCase.itemId)?.chance, undefined);
  assert.deepEqual(Array.from(fixedDrop(definition, seedId)?.amount_range || []), [0, 1]);
  assert.equal(fixedDrop(definition, seedId)?.chance, undefined);
  assert.deepEqual(Array.from(fixedDrop(definition, "gem")?.amount_range || []), [20, 60]);
  assert.deepEqual(Array.from(treeDrop(definition, blockCase.itemId)?.amount_range || []), [0, 3]);
  assert.deepEqual(Array.from(treeDrop(definition, seedId)?.amount_range || []), [0, 1]);
}

const streetLampDefinition = itemDatabase.getItemDefinition("street_lamp");
assert.equal(atlasDb.getItemIdForKey("street_lamp"), 53);
assert.deepEqual(Array.from(atlasDb.getItem(53)?.atlas_coords || []), [16, 31]);
assert.equal(streetLampDefinition?.category, "block");
assert.equal(streetLampDefinition?.rarity, "uncommon");
assert.equal(streetLampDefinition?.block_health, 3);
assert.equal(streetLampDefinition?.seed, "street_lamp_seed");
assert.equal(streetLampDefinition?.atlas_item_id, 53);
assert.deepEqual(Array.from(streetLampDefinition?.atlas_coords || []), [16, 31]);
assert.deepEqual(Array.from(streetLampDefinition?.texture?.cell || []), [16, 31]);
assert.deepEqual(Array.from(streetLampDefinition?.inventory_icon?.cell || []), [16, 31]);
assert.equal(itemDatabase.getPlaceLayer("street_lamp"), "foreground");
assert.equal(streetLampDefinition?.no_collision, true);
assert.equal(streetLampDefinition?.collidable, false);
assert.equal(streetLampDefinition?.solid, false);
assert.equal(streetLampDefinition?.collision_type, "none");
assert.equal(streetLampDefinition?.foreground_over_player, false);
assert.deepEqual(streetLampDefinition?.vertical_variant_atlas_coords, {
  single: [16, 31],
  top: [15, 29],
  middle: [15, 30],
  bottom: [15, 31],
});
assert.deepEqual(Array.from(fixedDrop(streetLampDefinition, "street_lamp")?.amount_range || []), [1, 3]);
assert.deepEqual(Array.from(fixedDrop(streetLampDefinition, "street_lamp_seed")?.amount_range || []), [0, 2]);
assert.deepEqual(Array.from(fixedDrop(streetLampDefinition, "gem")?.amount_range || []), [0, 5]);
assert.deepEqual(Array.from(treeDrop(streetLampDefinition, "street_lamp")?.amount_range || []), [1, 3]);
assert.deepEqual(Array.from(treeDrop(streetLampDefinition, "street_lamp_seed")?.amount_range || []), [0, 2]);
assert.deepEqual(Array.from(treeDrop(streetLampDefinition, "gem")?.amount_range || []), [0, 5]);
assert.equal(itemDatabase.getItemDefinition("street_lamp_seed")?.category, "seed");
assert.equal(itemDatabase.getItemDefinition("street_lamp_seed")?.grows_into, "street_lamp");

const fireEscapeDefinition = itemDatabase.getItemDefinition("fire_escape");
assert.equal(atlasDb.getItemIdForKey("fire_escape"), 54);
assert.deepEqual(Array.from(atlasDb.getItem(54)?.atlas_coords || []), [16, 29]);
assert.equal(fireEscapeDefinition?.category, "block");
assert.equal(fireEscapeDefinition?.rarity, "uncommon");
assert.equal(fireEscapeDefinition?.block_health, 3);
assert.equal(fireEscapeDefinition?.seed, "");
assert.equal(fireEscapeDefinition?.atlas_item_id, 54);
assert.deepEqual(Array.from(fireEscapeDefinition?.atlas_coords || []), [16, 29]);
assert.deepEqual(Array.from(fireEscapeDefinition?.texture?.cell || []), [16, 29]);
assert.deepEqual(Array.from(fireEscapeDefinition?.inventory_icon?.cell || []), [16, 29]);
assert.equal(itemDatabase.getPlaceLayer("fire_escape"), "foreground");
assert.equal(fireEscapeDefinition?.platform_collision, true);
assert.deepEqual(fireEscapeDefinition?.connected_variant_atlas_coords, {
  single: [16, 29],
  left: [17, 29],
  horizontal_middle: [18, 29],
  right: [19, 29],
  top: [16, 30],
  vertical_middle: [16, 30],
  bottom: [16, 29],
  top_left_corner: [17, 30],
  top_right_corner: [19, 30],
  bottom_left_corner: [17, 29],
  bottom_right_corner: [19, 29],
  middle: [18, 30],
  tile_top_left_corner: [17, 30],
  tile_top_middle: [18, 30],
  tile_top_right_corner: [19, 30],
  tile_middle_left: [17, 30],
  tile_middle_middle: [18, 30],
  tile_middle_right: [19, 30],
  tile_bottom_left_corner: [17, 29],
  tile_bottom_middle: [18, 29],
  tile_bottom_right_corner: [19, 29],
});
assert.deepEqual(fixedDrop(fireEscapeDefinition, "fire_escape"), {
  item_id: "fire_escape",
  item_category: "block",
  amount: 1,
});

const cityFenceDefinition = itemDatabase.getItemDefinition("city_fence");
assert.equal(atlasDb.getItemIdForKey("city_fence"), 55);
assert.deepEqual(Array.from(atlasDb.getItem(55)?.atlas_coords || []), [20, 29]);
assert.equal(cityFenceDefinition?.category, "block");
assert.equal(cityFenceDefinition?.rarity, "uncommon");
assert.equal(cityFenceDefinition?.block_health, 3);
assert.equal(cityFenceDefinition?.seed, "");
assert.equal(cityFenceDefinition?.atlas_item_id, 55);
assert.deepEqual(Array.from(cityFenceDefinition?.atlas_coords || []), [20, 29]);
assert.deepEqual(Array.from(cityFenceDefinition?.texture?.cell || []), [20, 29]);
assert.deepEqual(Array.from(cityFenceDefinition?.inventory_icon?.cell || []), [20, 29]);
assert.equal(itemDatabase.getPlaceLayer("city_fence"), "foreground");
assert.equal(cityFenceDefinition?.no_collision, true);
assert.equal(cityFenceDefinition?.collidable, false);
assert.equal(cityFenceDefinition?.foreground_over_player, true);
assert.deepEqual(fixedDrop(cityFenceDefinition, "city_fence"), {
  item_id: "city_fence",
  item_category: "block",
  amount: 1,
});

const fireHydrantDefinition = itemDatabase.getItemDefinition("fire_hydrant");
assert.equal(atlasDb.getItemIdForKey("fire_hydrant"), 56);
assert.deepEqual(Array.from(atlasDb.getItem(56)?.atlas_coords || []), [17, 31]);
assert.equal(fireHydrantDefinition?.category, "block");
assert.equal(fireHydrantDefinition?.rarity, "uncommon");
assert.equal(fireHydrantDefinition?.block_health, 2);
assert.equal(fireHydrantDefinition?.seed, "");
assert.equal(fireHydrantDefinition?.atlas_item_id, 56);
assert.deepEqual(Array.from(fireHydrantDefinition?.atlas_coords || []), [17, 31]);
assert.deepEqual(Array.from(fireHydrantDefinition?.texture?.cell || []), [17, 31]);
assert.deepEqual(Array.from(fireHydrantDefinition?.inventory_icon?.cell || []), [17, 31]);
assert.equal(itemDatabase.getPlaceLayer("fire_hydrant"), "foreground");
assert.equal(fireHydrantDefinition?.collidable, true);
assert.equal(fireHydrantDefinition?.springboard, true);
assert.equal(fireHydrantDefinition?.springboard_velocity, -420);
assert.deepEqual(fireHydrantDefinition?.springboard_animation_atlas_frames, [
  [17, 31],
  [18, 31],
]);
assert.equal(fireHydrantDefinition?.springboard_animation_frame_seconds, 0.22);
assert.equal(fireHydrantDefinition?.springboard_water_splash, true);
assert.deepEqual(fixedDrop(fireHydrantDefinition, "fire_hydrant"), {
  item_id: "fire_hydrant",
  item_category: "block",
  amount: 1,
});

const shiftBlockDefinition = itemDatabase.getItemDefinition("shift_block");
assert.equal(atlasDb.getItemIdForKey("shift_block"), 57);
assert.deepEqual(Array.from(atlasDb.getItem(57)?.atlas_coords || []), [10, 8]);
assert.equal(shiftBlockDefinition?.category, "block");
assert.equal(shiftBlockDefinition?.rarity, "rare");
assert.equal(shiftBlockDefinition?.block_health, 3);
assert.equal(shiftBlockDefinition?.seed, "");
assert.equal(shiftBlockDefinition?.atlas_item_id, 57);
assert.deepEqual(Array.from(shiftBlockDefinition?.atlas_coords || []), [10, 8]);
assert.deepEqual(Array.from(shiftBlockDefinition?.texture?.cell || []), [10, 8]);
assert.deepEqual(Array.from(shiftBlockDefinition?.inventory_icon?.cell || []), [10, 8]);
assert.equal(itemDatabase.getPlaceLayer("shift_block"), "foreground");
assert.equal(shiftBlockDefinition?.collidable, true);
assert.equal(shiftBlockDefinition?.colour_cycle_block, true);
assert.equal(shiftBlockDefinition?.colour_cycle_speed, 0.08);
assert.equal(shiftBlockDefinition?.colour_cycle_saturation, 0.85);
assert.equal(shiftBlockDefinition?.colour_cycle_value, 1.0);
assert.deepEqual(fixedDrop(shiftBlockDefinition, "shift_block"), {
  item_id: "shift_block",
  item_category: "block",
  amount: 1,
});

const pillarDefinition = itemDatabase.getItemDefinition("pillar");
assert.equal(atlasDb.getItemIdForKey("pillar"), 58);
assert.deepEqual(Array.from(atlasDb.getItem(58)?.atlas_coords || []), [15, 19]);
assert.equal(pillarDefinition?.category, "block");
assert.equal(pillarDefinition?.block_health, 2);
assert.equal(pillarDefinition?.atlas_item_id, 58);
assert.deepEqual(Array.from(pillarDefinition?.atlas_coords || []), [15, 19]);
assert.equal(itemDatabase.getPlaceLayer("pillar"), "foreground");
assert.equal(pillarDefinition?.collidable, true);
assert.deepEqual(pillarDefinition?.vertical_variant_atlas_coords, {
  single: [15, 19],
  top: [15, 20],
  middle: [15, 21],
  bottom: [15, 22],
});
for (const legacyPillarId of ["pillar_top", "pillar_middle", "pillar_bottom"]) {
  const legacyDefinition = itemDatabase.getItemDefinition(legacyPillarId);
  assert.equal(legacyDefinition?.admin_grantable, false);
}

const royalDoorDefinition = itemDatabase.getItemDefinition("royal_door");
assert.equal(atlasDb.getItemIdForKey("royal_door"), 59);
assert.deepEqual(Array.from(atlasDb.getItem(59)?.atlas_coords || []), [16, 22]);
assert.equal(royalDoorDefinition?.category, "block");
assert.equal(royalDoorDefinition?.door_block, true);
assert.equal(royalDoorDefinition?.no_collision, true);
assert.equal(royalDoorDefinition?.collidable, false);
assert.deepEqual(fixedDrop(royalDoorDefinition, "royal_door"), {
  item_id: "royal_door",
  item_category: "block",
  amount: 1,
});
assert.deepEqual(Array.from(fixedDrop(royalDoorDefinition, "royal_door_seed")?.amount_range || []), [0, 2]);
assert.deepEqual(Array.from(fixedDrop(royalDoorDefinition, "gem")?.amount_range || []), [0, 5]);

const royalEntranceDefinition = itemDatabase.getItemDefinition("royal_entrance");
assert.equal(atlasDb.getItemIdForKey("royal_entrance"), 60);
assert.deepEqual(Array.from(atlasDb.getItem(60)?.atlas_coords || []), [18, 22]);
assert.equal(royalEntranceDefinition?.category, "block");
assert.equal(royalEntranceDefinition?.entrance_block, true);
assert.equal(royalEntranceDefinition?.entrance_animation_frame_seconds, 0.08);
assert.equal(royalEntranceDefinition?.no_collision, true);
assert.equal(royalEntranceDefinition?.collidable, false);
assert.deepEqual(
  royalEntranceDefinition?.animation_frames?.map((/** @type {any} */ frame) => Array.from(frame || [])),
  [[18, 22], [19, 22], [20, 22]],
);
assert.deepEqual(Array.from(fixedDrop(royalEntranceDefinition, "royal_entrance_seed")?.amount_range || []), [0, 2]);
assert.deepEqual(Array.from(fixedDrop(royalEntranceDefinition, "gem")?.amount_range || []), [0, 5]);

const lampDefinition = itemDatabase.getItemDefinition("lamp");
const lampActiveDefinition = itemDatabase.getItemDefinition("lamp_active");
assert.equal(atlasDb.getItemIdForKey("lamp"), 61);
assert.equal(atlasDb.getItemIdForKey("lamp_active"), 62);
assert.deepEqual(Array.from(atlasDb.getItem(61)?.atlas_coords || []), [16, 20]);
assert.deepEqual(Array.from(atlasDb.getItem(62)?.atlas_coords || []), [17, 20]);
for (const definition of [lampDefinition, lampActiveDefinition]) {
  assert.equal(definition?.category, "block");
  assert.equal(definition?.punch_toggle_block, true);
  assert.equal(definition?.toggle_active_block, "lamp_active");
  assert.equal(definition?.toggle_inactive_block, "lamp");
  assert.equal(definition?.toggle_drop_block, "lamp");
  assert.equal(definition?.no_collision, true);
  assert.equal(definition?.collidable, false);
}
assert.equal(lampActiveDefinition?.hidden, true);
assert.equal(lampActiveDefinition?.admin_grantable, false);
assert.deepEqual(Array.from(fixedDrop(lampDefinition, "lamp_seed")?.amount_range || []), [0, 2]);
assert.deepEqual(Array.from(fixedDrop(lampDefinition, "gem")?.amount_range || []), [0, 5]);

const royalWindowDefinition = itemDatabase.getItemDefinition("royal_window");
assert.equal(atlasDb.getItemIdForKey("royal_window"), 63);
assert.deepEqual(Array.from(atlasDb.getItem(63)?.atlas_coords || []), [21, 22]);
assert.equal(royalWindowDefinition?.category, "block");
assert.equal(royalWindowDefinition?.no_collision, true);
assert.equal(royalWindowDefinition?.collidable, false);
assert.deepEqual(Array.from(fixedDrop(royalWindowDefinition, "royal_window_seed")?.amount_range || []), [0, 2]);
assert.deepEqual(Array.from(fixedDrop(royalWindowDefinition, "gem")?.amount_range || []), [0, 5]);

const curtainBlockCases = [
  { itemId: "purple_curtains", atlasItemId: 67, cell: [22, 22], seedId: "purple_curtains_seed" },
  { itemId: "pink_curtains", atlasItemId: 68, cell: [23, 22], seedId: "pink_curtains_seed" },
];
for (const curtainCase of curtainBlockCases) {
  const definition = itemDatabase.getItemDefinition(curtainCase.itemId);
  assert.equal(atlasDb.getItemIdForKey(curtainCase.itemId), curtainCase.atlasItemId);
  assert.deepEqual(Array.from(atlasDb.getItem(curtainCase.atlasItemId)?.atlas_coords || []), curtainCase.cell);
  assert.equal(definition?.category, "block");
  assert.equal(definition?.rarity, "uncommon");
  assert.equal(definition?.block_health, 3);
  assert.equal(definition?.seed, curtainCase.seedId);
  assert.equal(definition?.atlas_item_id, curtainCase.atlasItemId);
  assert.deepEqual(Array.from(definition?.atlas_coords || []), curtainCase.cell);
  assert.equal(itemDatabase.getPlaceLayer(curtainCase.itemId), "foreground");
  assert.equal(definition?.no_collision, true);
  assert.equal(definition?.collidable, false);
  assert.deepEqual(fixedDrop(definition, curtainCase.itemId), {
    item_id: curtainCase.itemId,
    item_category: "block",
    amount: 1,
  });
  assert.deepEqual(Array.from(fixedDrop(definition, curtainCase.seedId)?.amount_range || []), [0, 2]);
  assert.deepEqual(Array.from(fixedDrop(definition, "gem")?.amount_range || []), [0, 5]);
  assert.deepEqual(Array.from(treeDrop(definition, curtainCase.itemId)?.amount_range || []), [1, 3]);
  assert.deepEqual(Array.from(treeDrop(definition, curtainCase.seedId)?.amount_range || []), [0, 3]);
  assert.deepEqual(Array.from(treeDrop(definition, "gem")?.amount_range || []), [0, 5]);
}

const couchBlockCases = [
  {
    itemId: "blue_couch",
    atlasItemId: 69,
    cell: [19, 21],
    seedId: "blue_couch_seed",
    variants: {
      single: [19, 21],
      left: [16, 21],
      horizontal_middle: [17, 21],
      middle: [17, 21],
      right: [18, 21],
    },
  },
  {
    itemId: "green_couch",
    atlasItemId: 70,
    cell: [23, 21],
    seedId: "green_couch_seed",
    variants: {
      single: [23, 21],
      left: [20, 21],
      horizontal_middle: [21, 21],
      middle: [21, 21],
      right: [22, 21],
    },
  },
];
for (const couchCase of couchBlockCases) {
  const definition = itemDatabase.getItemDefinition(couchCase.itemId);
  assert.equal(atlasDb.getItemIdForKey(couchCase.itemId), couchCase.atlasItemId);
  assert.deepEqual(Array.from(atlasDb.getItem(couchCase.atlasItemId)?.atlas_coords || []), couchCase.cell);
  assert.equal(definition?.category, "block");
  assert.equal(definition?.rarity, "uncommon");
  assert.equal(definition?.block_health, 3);
  assert.equal(definition?.seed, couchCase.seedId);
  assert.equal(definition?.atlas_item_id, couchCase.atlasItemId);
  assert.deepEqual(Array.from(definition?.atlas_coords || []), couchCase.cell);
  assert.equal(itemDatabase.getPlaceLayer(couchCase.itemId), "foreground");
  assert.equal(definition?.no_collision, true);
  assert.equal(definition?.collidable, false);
  assert.deepEqual(definition?.connected_variant_atlas_coords, couchCase.variants);
  assert.deepEqual(fixedDrop(definition, couchCase.itemId), {
    item_id: couchCase.itemId,
    item_category: "block",
    amount: 1,
  });
  assert.deepEqual(Array.from(fixedDrop(definition, couchCase.seedId)?.amount_range || []), [0, 2]);
  assert.deepEqual(Array.from(fixedDrop(definition, "gem")?.amount_range || []), [0, 5]);
  assert.deepEqual(Array.from(treeDrop(definition, couchCase.itemId)?.amount_range || []), [1, 3]);
  assert.deepEqual(Array.from(treeDrop(definition, couchCase.seedId)?.amount_range || []), [0, 3]);
  assert.deepEqual(Array.from(treeDrop(definition, "gem")?.amount_range || []), [0, 5]);
}

const fishBowlDefinition = itemDatabase.getItemDefinition("fish_bowl");
assert.equal(atlasDb.getItemIdForKey("fish_bowl"), 64);
assert.deepEqual(Array.from(atlasDb.getItem(64)?.atlas_coords || []), [18, 20]);
assert.equal(fishBowlDefinition?.category, "block");
assert.equal(fishBowlDefinition?.animated, true);
assert.equal(fishBowlDefinition?.animation_frame_seconds, 0.35);
assert.deepEqual(
  fishBowlDefinition?.animation_frames?.map((/** @type {any} */ frame) => Array.from(frame || [])),
  [[18, 20], [19, 20]],
);
assert.deepEqual(Array.from(fixedDrop(fishBowlDefinition, "fish_bowl_seed")?.amount_range || []), [0, 2]);
assert.deepEqual(Array.from(fixedDrop(fishBowlDefinition, "gem")?.amount_range || []), [0, 5]);

const tvDefinition = itemDatabase.getItemDefinition("tv");
const tvActiveDefinition = itemDatabase.getItemDefinition("tv_active");
assert.equal(atlasDb.getItemIdForKey("tv"), 65);
assert.equal(atlasDb.getItemIdForKey("tv_active"), 66);
assert.deepEqual(Array.from(atlasDb.getItem(65)?.atlas_coords || []), [20, 20]);
assert.deepEqual(Array.from(atlasDb.getItem(66)?.atlas_coords || []), [21, 20]);
for (const definition of [tvDefinition, tvActiveDefinition]) {
  assert.equal(definition?.category, "block");
  assert.equal(definition?.punch_toggle_block, true);
  assert.equal(definition?.toggle_active_block, "tv_active");
  assert.equal(definition?.toggle_inactive_block, "tv");
  assert.equal(definition?.toggle_drop_block, "tv");
  assert.equal(definition?.no_collision, true);
  assert.equal(definition?.collidable, false);
}
assert.equal(tvActiveDefinition?.hidden, true);
assert.equal(tvActiveDefinition?.admin_grantable, false);
assert.equal(tvActiveDefinition?.animated, true);
assert.equal(tvActiveDefinition?.animation_frame_seconds, 0.18);
assert.deepEqual(
  tvActiveDefinition?.animation_frames?.map((/** @type {any} */ frame) => Array.from(frame || [])),
  [[21, 20], [22, 20], [23, 20], [24, 20]],
);
assert.deepEqual(Array.from(fixedDrop(tvDefinition, "tv_seed")?.amount_range || []), [0, 2]);
assert.deepEqual(Array.from(fixedDrop(tvDefinition, "gem")?.amount_range || []), [0, 5]);

for (const [seedId, growsInto] of [
  ["royal_door_seed", "royal_door"],
  ["royal_entrance_seed", "royal_entrance"],
  ["lamp_seed", "lamp"],
  ["royal_window_seed", "royal_window"],
  ["fish_bowl_seed", "fish_bowl"],
  ["tv_seed", "tv"],
  ["purple_curtains_seed", "purple_curtains"],
  ["pink_curtains_seed", "pink_curtains"],
  ["blue_couch_seed", "blue_couch"],
  ["green_couch_seed", "green_couch"],
]) {
  const seedDefinition = itemDatabase.getItemDefinition(seedId);
  assert.equal(seedDefinition?.category, "seed");
  assert.equal(seedDefinition?.grows_into, growsInto);
}
assert.equal(atlasDefinition.ATLAS_PASSTHROUGH_KEYS.includes("entrance_block"), true);
assert.equal(atlasDefinition.ATLAS_PASSTHROUGH_KEYS.includes("entrance_animation_frame_seconds"), true);

const pickaxeItemIds = [
  "stone_pickaxe",
  "golden_pickaxe",
  "emerald_pickaxe",
  "diamond_pickaxe",
  "neptune_pickaxe",
  "void_pickaxe",
];
for (const itemId of pickaxeItemIds) {
  const definition = itemDatabase.getItemDefinition(itemId);
  assert.equal(definition?.category, "tool");
  assert.equal(definition?.equipment_slot, "hand");
  assert.equal(definition?.hand_item, true);
  assert.equal(definition?.instance_tracked, true);
  assert.equal(definition?.texture, `${itemId}_1`);
  assert.equal(definition?.inventory_icon, `${itemId}_icon`);
  assert.equal(itemDatabase.getBreakPower(itemId, "world_lock"), 1);
}

assert.equal(itemDatabase.getBreakHitReduction("void_pickaxe"), 1);
assert.equal(itemDatabase.getRequiredBreakDamage("void_pickaxe", "world_lock"), 7);
assert.equal(itemDatabase.getRequiredBreakDamage("void_pickaxe", "dirt"), 2);
assert.equal(itemDatabase.getRequiredBreakDamage("void_pickaxe", "electric_wire"), 1);
for (const itemId of pickaxeItemIds.filter((candidate) => candidate !== "void_pickaxe")) {
  assert.equal(itemDatabase.getBreakHitReduction(itemId), 0);
  assert.equal(
    itemDatabase.getRequiredBreakDamage(itemId, "world_lock"),
    itemDatabase.getBlockHealth("world_lock"),
  );
}
assert.equal(itemDatabase.getRequiredBreakDamage("void_saber", "world_lock"), 8);
assert.match(serverSource, /const requiredDamage = ItemDatabase\.getRequiredBreakDamage\(handItem, update\.block_type\)/);

assert.equal(
  packageJson.scripts["build:item-data"],
  "tsc --project tsconfig.item-data.json && node scripts/sync_item_data_build.js"
);
assert.equal(packageJson.scripts["check:item-data"], "npm run build:item-data && node scripts/check_item_data_build.js");
assert.match(packageJson.scripts["check:typescript"], /npm run check:item-data/);

assert.deepEqual(buildConfig.include, [
  "src/atlas_item_definition.ts",
  "src/item_atlas_db.ts",
  "src/server_item_database.ts",
]);

assert.match(syncSource, /Generated from src\/\$\{moduleName\}\.ts/);
assert.match(itemDatabaseSource, /export = ServerItemDatabase/);
assert.match(atlasDbSource, /export = ItemAtlasDB/);
assert.match(atlasDefinitionSource, /export = AtlasItemDefinition/);
assert.match(atlasDbSource, /process\.env\.PIXELMANIA_CLIENT_DIR/);
assert.match(atlasDbSource, /path\.join\(__dirname, "_client", "Data", "items", "atlas_items\.json"\)/);

const isolatedReleaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixelmania-item-atlas-release-"));
try {
  const isolatedAtlasLoader = path.join(isolatedReleaseRoot, "item_atlas_db.js");
  const isolatedAtlasPath = path.join(isolatedReleaseRoot, "_client", "Data", "items", "atlas_items.json");
  fs.mkdirSync(path.dirname(isolatedAtlasPath), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "item_atlas_db.js"), isolatedAtlasLoader);
  fs.writeFileSync(
    isolatedAtlasPath,
    JSON.stringify({ items: [{ id: 35, item_key: "donation_box", layer: "foreground" }] }),
    "utf8",
  );
  const isolatedAtlasDb = require(isolatedAtlasLoader);
  assert.equal(isolatedAtlasDb.getItemIdForKey("donation_box"), 35);
  assert.equal(isolatedAtlasDb.getItemKey(35), "donation_box");
} finally {
  fs.rmSync(isolatedReleaseRoot, { force: true, recursive: true });
}

assert.match(deploySource, /src\/server_item_database\.ts/);
assert.match(deploySource, /src\/item_atlas_db\.ts/);
assert.match(deploySource, /src\/atlas_item_definition\.ts/);
assert.match(deploySource, /tsconfig\.item-data\.json/);
assert.match(deploySource, /sync_item_data_build\.js/);
assert.match(deploySource, /npm run build:item-data/);

console.log("[item-data] success");
