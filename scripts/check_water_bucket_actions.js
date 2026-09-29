const assert = require('node:assert/strict');
const fs = require('node:fs');
const ItemDatabase = require('../server_item_database');
const InventoryContracts = require('../server_inventory_contracts');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const start = source.indexOf('async function prepareWaterBucketScoopInventoryReturn(');
assert(start > 0);
const end = source.indexOf('\n}', start) + 2;
const state = {material_inventory: {water_bucket: 2}, inventory: {water_bucket: 99}};
const rejected = [];
const deps = {
  WATER_BUCKET_ITEM_TYPE: 'water_bucket', WATER_BLOCK_TYPE: 'water', InventoryContracts,
  cleanAccountName: s => s, ensureWritablePlayerState: () => state, cloneJson: structuredClone,
  getInventoryCount: (s,id,cat) => { assert.equal(cat,'material'); return s.material_inventory[id] || 0; },
  canAddItemToState: (s,id,cat,n) => { assert.equal(cat,'material'); return (s.material_inventory[id] || 0) + n <= 400; },
  addItemToState: (s,id,cat,n) => { assert.equal(cat,'material'); s.material_inventory[id] += n; return true; },
  sendActionRejected: (_s,_a,_m,extra) => rejected.push(extra.reason),
  isPostgresAuthoritativeReady: () => true,
  buildInventoryDeltasBetweenStates: (before,after) => [{item_type:'water_bucket',item_category:'material',delta:after.material_inventory.water_bucket-before.material_inventory.water_bucket}],
};
const scoop = new Function(...Object.keys(deps), `${source.slice(start,end)}; return prepareWaterBucketScoopInventoryReturn;`)(...Object.values(deps));
async function main() {
  assert.deepEqual(ItemDatabase.getPlacementCost('water'), {item_id:'water_bucket',item_category:'material',amount:1});
  const result = await scoop({}, {account_username:'bucket'}, 'TEST', {x:1,y:2,layer:'foreground',block_type:'water',water_bucket_action:'scoop'}, 'scoop');
  assert(result.ok && result.deferred_inventory_commit, 'Scoop defers the award to the atomic world/inventory commit');
  assert.equal(result.playerState.material_inventory.water_bucket, 3);
  assert.equal(state.material_inventory.water_bucket, 2);
  state.material_inventory.water_bucket = 0;
  assert.equal((await scoop({}, {account_username:'bucket'}, 'TEST', {block_type:'water'}, 'empty')).ok,false);
  assert.equal(rejected.pop(),'water_bucket_required');
  state.material_inventory.water_bucket = 400;
  assert.equal((await scoop({}, {account_username:'bucket'}, 'TEST', {block_type:'water'}, 'full')).ok,false);
  assert.equal(rejected.pop(),'inventory_full');
  console.log('WATER_BUCKET_SERVER_PASS');
}
main().catch(error => { console.error(error); process.exitCode=1; });
