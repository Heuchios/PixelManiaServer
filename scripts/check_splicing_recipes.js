#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server_item_database');
const clientDir = process.env.PIXELMANIA_CLIENT_DIR || path.resolve(__dirname, '../../pixel-mania');
const rows = JSON.parse(fs.readFileSync(path.join(clientDir, 'docs/splicing-recipe-status.json'), 'utf8'));
const sheet = JSON.parse(fs.readFileSync(path.join(clientDir, 'docs/live-recipe-sheet.json'), 'utf8'));
const crafting = JSON.parse(fs.readFileSync(path.join(clientDir, 'docs/live-crafting-recipes.json'), 'utf8'));
const client = fs.readFileSync(path.join(clientDir, 'Scripts/item_database.gd'), 'utf8');
const recipeBody = client.match(/const SPLICE_RECIPES = \{([\s\S]*?)\n\}/)[1];
const pairs = [...recipeBody.matchAll(/"([^"]+)": "([^"]+)"/g)].map(m => [m[1], m[2]]);
assert.equal(new Set(pairs.map(p => p[0])).size, pairs.length, 'Duplicate client ingredient pair');
assert.equal(new Set(pairs.map(p => p[1])).size, pairs.length, 'Multiple recipes produce the same seed');
for (const filename of ['src/server_item_database.ts', 'server_item_database.js']) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', filename), 'utf8');
  const body = source.match(/const SPLICE_RECIPES[^=]*= Object.freeze\(\{([\s\S]*?)\n\s*\}\);/)[1];
  const sourcePairs = [...body.matchAll(/"([^"]+)": "([^"]+)"/g)].map(m => [m[1], m[2]]);
  const canonical = sourcePairs.map(([key]) => key.split('+').sort().join('+'));
  assert.equal(new Set(canonical).size, sourcePairs.length, `${filename}: duplicate or reversed ingredient pair`);
  assert.deepEqual(Object.fromEntries(sourcePairs), db.SPLICE_RECIPES, filename);
}
assert.deepEqual(Object.fromEntries(pairs), db.SPLICE_RECIPES, 'Client/server recipe parity');
for (const [key, output] of pairs) {
  const [a, b] = key.split('+');
  assert.equal(key, db.getSpliceKey(a, b), 'Canonical ingredient order');
  assert.equal(db.getSpliceResult(a, b), output);
  assert.equal(db.getSpliceResult(b, a), output, 'Reverse ingredient order');
  for (const seed of [a, b, output]) {
    assert.equal(db.ITEMS[seed]?.category, 'seed', seed);
    const block = db.ITEMS[seed].grows_into;
    assert.equal(db.getItemDefinition(block)?.seed, seed, `Seed/block round trip: ${seed}`);
  }
}
for (const row of rows.filter(r => r.status === 'active')) {
  assert.equal(db.getSpliceResult(...row.seeds.slice(0, 2)), row.seeds[2], row.names.join(' + '));
  row.ids.forEach((id, i) => assert.equal(db.getItemDefinition(id).seed, row.seeds[i], id));
}
assert.equal(pairs.length, rows.filter(r => r.status === 'active').length, 'No unlisted splicing recipes');
assert.equal(db.STATION_RECIPES.furnace.length, 0, 'No unlisted furnace recipes');
assert.equal(rows.length, sheet.rows.length, 'Every live sheet row was audited');
assert.equal(new Set(rows.map(r => r.row)).size, rows.length, 'Duplicate audit rows');
for (const source of sheet.rows) {
  const row = rows.find(r => r.row === source.row);
  assert.deepEqual(row.names, source.names, `Sheet row ${source.row}`);
  assert.equal(row.method, source.crafting ? 'crafting' : 'splicing');
  const outputId = row.ids[2];
  if (outputId && db.getItemDefinition(outputId)) {
    assert.equal(db.RECIPE_TIERS[outputId], Number(source.tier), `Authored tier: row ${row.row}`);
    assert.equal(db.getItemDefinition(outputId).recipe_tier, Number(source.tier), `Runtime tier: row ${row.row}`);
    const seedId = db.getItemDefinition(outputId).seed;
    if (seedId) assert.equal(db.getItemDefinition(seedId).recipe_tier, Number(source.tier), seedId);
  }
  if (source.crafting) {
    const outputSeed = row.ids[2] && db.getItemDefinition(row.ids[2])?.seed;
    assert.ok(!outputSeed || !Object.values(db.SPLICE_RECIPES).includes(outputSeed), `Red row ${row.row} leaked into splicing`);
  }
  if (row.status === 'crafting_active') {
    const recipe = db.getStationRecipe('crafting_station', row.recipe_id);
    assert.ok(recipe, `Crafting row ${row.row}`);
    assert.equal(recipe.output.item_id, row.ids[2]);
    assert.deepEqual(recipe.cost.map(c => c.item_id), row.ids.slice(0, 2));
  }
}
assert.deepEqual(db.STATION_RECIPES.crafting_station, crafting, 'Crafting/server manifest parity');
assert.equal(new Set(crafting.map(r => r.output.item_id)).size, crafting.length, 'Duplicate crafting output');
for (const recipe of crafting) {
  for (const entry of [recipe.output, ...recipe.cost]) {
    assert.equal(db.getItemDefinition(entry.item_id)?.category, entry.category);
    assert.ok(Number.isSafeInteger(entry.amount) && entry.amount > 0);
  }
}
assert.equal(db.getSpliceResult('unknown_seed', 'dirt_seed'), '');
assert.equal(db.getSpliceResult('dirt_seed', 'dirt_seed'), '');
assert.equal(db.ITEMS.glowing_dirt.seed, '', 'Unrelated seedless blocks stay seedless');
require('./check_seed_growth_duration');
const harvest = JSON.parse(fs.readFileSync(path.join(clientDir, 'docs/splice-harvest-times.json'), 'utf8'));
assert.equal(harvest.rows.length, rows.length, 'Every sheet duration captured');
for (const row of harvest.rows) {
  if (!row.seed_id) continue;
  assert.equal(db.ITEMS[row.seed_id].grow_time, row.seconds, row.name);
  assert.equal(db.ITEMS[row.seed_id].max_grow_time, row.seconds, row.name);
}
for (const output of Object.values(db.SPLICE_RECIPES)) {
  assert.ok(harvest.rows.some(row => row.seed_id === output), `Missing duration: ${output}`);
}
console.log(`Recipes OK: ${rows.length} sheet rows audited; ${pairs.length} splicing; ${crafting.length} crafting; unique pairs/outputs, red-row separation and server parity verified.`);
