#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../server_item_database');
const clientDir = process.env.PIXELMANIA_CLIENT_DIR || path.resolve(__dirname, '../../pixel-mania');
const rows = JSON.parse(fs.readFileSync(path.join(clientDir, 'docs/splicing-recipe-status.json'), 'utf8'));
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
assert.equal(db.getSpliceResult('unknown_seed', 'dirt_seed'), '');
assert.equal(db.getSpliceResult('dirt_seed', 'dirt_seed'), '');
assert.equal(db.ITEMS.glowing_dirt.seed, '', 'Unrelated seedless blocks stay seedless');
console.log(`Splicing OK: ${rows.filter(r => r.status === 'active').length} chart recipes; ${pairs.length} total; all seeds, reverse pairs and client/server parity verified.`);
