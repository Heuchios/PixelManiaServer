#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ItemDatabase = require("../server_item_database");

const repoRoot = path.join(__dirname, "..");
const clientRoot = process.env.PIXELMANIA_CLIENT_DIR
  ? path.resolve(process.env.PIXELMANIA_CLIENT_DIR)
  : path.join(repoRoot, "..", "pixel-mania");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const clientItemSource = fs.readFileSync(path.join(clientRoot, "Scripts", "item_database.gd"), "utf8");
const blockManagerSource = fs.readFileSync(path.join(clientRoot, "Scripts", "block_manager.gd"), "utf8");

const expectedReturns = new Map([
  ["vend_empty", "vend_empty"],
  ["vend_pending", "vend_empty"],
  ["vend_sold", "vend_empty"],
  ["anti_punch", "anti_punch"],
  ["anti_talk", "anti_talk"],
  ["anti_gravity", "anti_gravity"],
  ["night_theme_machine", "night_theme_machine"],
  ["snow_theme_machine", "snow_theme_machine"],
  ["fish_monger", "fish_monger"],
]);

function extractClientItemEntry(itemId) {
  const marker = `"${itemId}":`;
  const markerIndex = clientItemSource.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Client item definition is missing: ${itemId}`);

  const openIndex = clientItemSource.indexOf("{", markerIndex + marker.length);
  assert.notEqual(openIndex, -1, `Client item definition has no dictionary: ${itemId}`);

  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < clientItemSource.length; index += 1) {
    const character = clientItemSource[index];

    if (quote !== "") {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }

    if (character === "#") {
      const lineEnd = clientItemSource.indexOf("\n", index);
      index = lineEnd < 0 ? clientItemSource.length : lineEnd;
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return clientItemSource.slice(openIndex, index + 1);
      }
    }
  }

  throw new Error(`Client item definition is unterminated: ${itemId}`);
}

for (const [itemId, expectedReturnItemId] of expectedReturns) {
  const definition = ItemDatabase.getItemDefinition(itemId);
  assert.ok(definition, `Server item definition is missing: ${itemId}`);
  assert.equal(definition.break_return_to_inventory, true, `${itemId} must return directly to inventory`);
  assert.equal(
    String(definition.break_return_item_id || itemId),
    expectedReturnItemId,
    `${itemId} returns the wrong item`
  );
  assert.equal(Number(definition.drop_rules?.seed_chance), 0, `${itemId} must not drop a seed`);
  assert.deepEqual(Array.from(definition.drop_rules?.gem_range || []), [0, 0], `${itemId} must not drop gems`);
  assert.equal(Array.isArray(definition.drop_rules?.fixed_drops), false, `${itemId} must not create fixed world drops`);
  assert.notEqual(definition.drops_self, true, `${itemId} must not use the generic self-drop path`);

  const clientEntry = extractClientItemEntry(itemId);
  assert.match(clientEntry, /"break_return_to_inventory"\s*:\s*true/, `${itemId} is missing the client recovery flag`);
  if (itemId.startsWith("vend_")) {
    assert.match(clientEntry, /"break_return_item_id"\s*:\s*"vend_empty"/, `${itemId} must normalize to vend_empty`);
  }
}

const suppressIndex = serverSource.search(
  /if\s*\(getDirectBreakInventoryReturn\(itemId\)\)\s*return \[\];/,
);
const configuredDropIndex = serverSource.indexOf("const configuredDrops = getConfiguredDropsFromRules(rules);", suppressIndex);
assert.notEqual(suppressIndex, -1, "Server break drops do not suppress direct inventory returns");
assert.ok(configuredDropIndex > suppressIndex, "Direct inventory return suppression must run before configured drop rules");
assert.match(serverSource, /async function prepareDirectBlockBreakInventoryReturn\(/);
assert.match(serverSource, /const machineReturn = getDirectBreakInventoryReturn\(update\.block_type\);/);
assert.match(serverSource, /reason:\s*"vending_machine_break_recovery"/);
assert.match(blockManagerSource, /func return_broken_block_directly_to_inventory\(/);
assert.match(blockManagerSource, /elif not world\.try_drop_fixed_break_drops/);

console.log(`[machine-break-return] verified ${expectedReturns.size} recoverable machine states`);
