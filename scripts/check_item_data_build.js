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
