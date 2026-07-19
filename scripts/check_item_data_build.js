#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.item-data.json"), "utf8"));
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_item_data_build.js"), "utf8");
const itemDatabaseSource = fs.readFileSync(path.join(repoRoot, "src", "server_item_database.ts"), "utf8");
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

assert.match(deploySource, /src\/server_item_database\.ts/);
assert.match(deploySource, /src\/item_atlas_db\.ts/);
assert.match(deploySource, /src\/atlas_item_definition\.ts/);
assert.match(deploySource, /tsconfig\.item-data\.json/);
assert.match(deploySource, /sync_item_data_build\.js/);
assert.match(deploySource, /npm run build:item-data/);

console.log("[item-data] success");
