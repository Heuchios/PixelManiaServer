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
  assert.equal(definition?.texture, `res://Assets/items/swords/${itemId}.png`);
  assert.equal(definition?.inventory_icon, `res://Assets/items/swords/${itemId}_icon.png`);
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
