// Generate the shop disclosure from the same tables used by purchases.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/server.ts'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/server_inventory_economy_routes.ts'), 'utf8');
const catalogMatch = source.match(/const SHOP_CATALOG[^=]*= new Map[^\n]*\(\[([\s\S]*?)\n\]\);/);
assert(catalogMatch, 'Shop catalog must be readable');
const catalog = new Map(vm.runInNewContext('[' + catalogMatch[1] + ']'));
const packs = {};
for (const match of routes.matchAll(/if \(itemId === "([^"]+)"\) return ([A-Z_]+_TABLE);/g)) {
  const [, id, tableName] = match;
  const matchTable = source.match(new RegExp('const ' + tableName + '[^=]*= (\\[[\\s\\S]*?\\n\\]);'));
  assert(matchTable, `Missing ${tableName}`);
  const table = vm.runInNewContext(matchTable[1]);
  const listing = catalog.get(id);
  assert(listing && listing.pack_size > 0, `Missing pack listing: ${id}`);
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  assert(total > 0 && table.every(entry => entry.weight > 0), `Invalid weights: ${id}`);
  packs[id] = {
    draws: listing.pack_size * listing.amount,
    rewards: table.map(entry => ({item_id:entry.item_id, category:entry.item_category, chance:entry.weight / total})),
  };
}
assert(Object.keys(packs).length > 0);
const target = path.join(process.env.PIXELMANIA_CLIENT_ROOT || path.resolve(root, '../pixel-mania'), 'Scripts/ui/shop_pack_loot_data.gd');
const output = '# Generated from server shop reward tables. Run scripts/sync_shop_pack_loot.cjs to update.\nextends RefCounted\n\nconst PACKS = ' + JSON.stringify(packs, null, 2) + '\n';
if (process.argv.includes('--check')) {
  assert.equal(fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n'), output, 'Shop odds are stale; run node scripts/sync_shop_pack_loot.cjs');
  console.log(`SHOP_PACK_LOOT_OK: ${Object.keys(packs).length} packs match server rewards and draw counts`);
} else {
  fs.writeFileSync(target, output);
  console.log(`Generated ${target}`);
}
