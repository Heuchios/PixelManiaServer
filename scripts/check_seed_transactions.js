// Execute the shipped handlers with a controllable durable-commit boundary.
// No network credentials, live worlds, or real player inventories are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
function body(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, name);
  const rest = source.slice(match.index);
  const end = /\n(?:async )?function \w+\(/.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}
const names = ['applyRedTractorGasolineBonus', 'getSeedGrowthRemaining', 'getSeedConfiguredGrowTime', 'isSeedMature', 'registerGrowingTreeBreakHit',
  'serializeSeedForMessage', 'makeServerSeedEntry', 'applySeedUpdateToWorldState', 'getBlockTypeForSeed',
  'runSeedActionLocked', 'speedupSeedGrowthState', 'validateBlockUpdateAgainstServerState', ...['Place', 'Splice', 'Harvest'].flatMap(n => [`handleSeed${n}Transaction`, `handleSeed${n}TransactionLocked`])];
let now = 1_000_000, commitGate = null, failCommit = false, commits = 0;
const world = { foreground: new Map(), seeds: new Map(), drops: new Map() };
const inventory = { alice: { seeds: 40 }, bob: { seeds: 40 } };
const replies = [], broadcasts = [], dropCalls = [], profiles = [];
const locks = new Set();
const context = {
  Date: { now: () => now }, performance, Math, Object, Array, Number, Boolean, String,
  SERVER_SEED_GROW_TIME_SECONDS: 60, GROWING_TREE_BREAK_HITS_REQUIRED: 3, BLOCK_DAMAGE_RESET_MS: 3500,
  growingTreeBreakHits: new WeakMap(), SEED_MUTATION_CHANCE: 0, MATURE_SEED_EXTRA_DROP_CHANCE: 0,
  SEED_MUTATION_REWARD_TABLE: [{ item_id: 'rare', item_category: 'block', min_amount: 2, max_amount: 2 }], SERVER_DROP_PICKUP_DELAY: 1,
  crypto: { randomInt: min => min }, rollWeightedReward: t => t[0], randomChance: () => false,
  ItemDatabase: { hasItem: id => ['dirt_seed', 'grass_seed', 'rare'].includes(id), getItemDefinition: id => ({ category: 'seed', grow_time: 60, grows_into: id.replace('_seed', '') }), getSpliceResult: () => 'grass_seed' },
  runtimeProfiler: { enabled: true, observe: (name, value) => profiles.push({ name, value }) },
  makeRequestId: data => data.request_id, getTransactionWorldName: () => 'TEST',
  requireSameWorld: () => true, rejectIfWorldBanned: async () => false, requireBuildPermission: () => true,
  getTransactionGrid: data => Number.isInteger(data.x) && Number.isInteger(data.y) ? { x: data.x, y: data.y } : null,
  isPlayerNearGrid: () => true, canPlayerBuildAtGrid: () => true,
  getBlockActionReachPixels: () => 96, getWorldLayerMap: state => state.foreground,
  sendActionRejected: (_s, _action, message) => replies.push({ ok: false, message }),
  clampString: x => String(x || ''), resolveInventoryCategory: () => 'seed',
  ensureWorldState: () => world, gridKey: (x, y) => `${x}:${y}`,
  ensureWritablePlayerState: user => inventory[user], cloneJson: x => JSON.parse(JSON.stringify(x)),
  doesStateOwnEquippedItem: state => state.ownsTractor === true,
  spendItemFromState: (state, id) => {
    const field = id === 'gasoline' ? 'gasoline' : 'seeds';
    return state[field] > 0 ? (--state[field], true) : false;
  },
  makeAuditId: () => 'audit',
  worldBlockActionLocks: locks, getWorldBlockActionLockResource: (w, p) => `${w}:foreground:${p.x}:${p.y}`,
  acquireLiveActionLock: async (_set, _scope, key) => {
    if (locks.has(key)) return { acquired: false };
    locks.add(key); return { acquired: true, key };
  },
  releaseLiveActionLock: lock => locks.delete(lock.key),
  commitPlayerInventoryState: async (_socket, _player, user, _before, after, options) => {
    assert.equal(options.world_mutation, true);
    assert.equal(options.world_state, undefined, 'Do not serialize the full world twice');
    if (commitGate) await commitGate;
    if (failCommit) return { ok: false, message: 'simulated database failure' };
    inventory[user] = after; commits++;
    return { ok: true, state: after, deltas: [], postgres_committed: true };
  },
  buildInventoryDeltaClientPayloads: () => [], persistWorldStateAfterInventoryCommit: () => {},
  sendWorldUpdateToRequesterAndWorld: (_s, _p, _w, update) => broadcasts.push(structuredClone(update)),
  sendInventoryTransactionResult: (_s, reply) => replies.push(structuredClone(reply)),
  sendInventoryTransactionRejected: (_s, data, message) => replies.push({ ok: false, request_id: data.request_id, message }),
  logWorldChange: () => {}, logItemLedgerForState: () => {}, getGridCenterPixels: (x, y) => ({ x: x * 32, y: y * 32 }),
  getTreeHarvestDropsForBlock: block => [{ item_id: block, item_category: 'block', amount: 5 }, { item_id: block + '_seed', item_category: 'seed', amount: 2 }],
  createServerDrop: (_w, id, category, amount) => {
    const drop = { drop_id: `d${dropCalls.length}`, item_id: id, item_category: category, amount };
    dropCalls.push(drop); world.drops.set(drop.drop_id, drop); return drop;
  },
  grantExperienceToState: () => ({}), getSeedHarvestXp: () => 0, getProgressionMessage: (_p, m) => m, buildProgressionPayload: p => p,
};
vm.createContext(context);
vm.runInContext(names.map(body).join('\n'), context);
const alice = { id: 'a', account_username: 'alice' }, bob = { id: 'b', account_username: 'bob' };
let request = 0;
const packet = (action, x = 4) => ({ action, request_id: `r${++request}`, x, y: 3, seed_type: 'dirt_seed', mature: true, grow_time: 0, planted_at: 1 });
const place = (x = 4, player = alice) => context.handleSeedPlaceTransaction({}, player, packet('seed_place', x));
const hit = (x = 4, player = alice) => context.handleSeedHarvestTransaction({}, player, packet('seed_harvest', x));
const flush = () => new Promise(resolve => setImmediate(resolve));
async function run() {
  let bonusTotal = 0;
  for (let roll = 0; roll < 100; roll++) {
    context.crypto.randomInt = () => roll;
    const fuelState = { equipped_ride_item: 'red_tractor', ownsTractor: true, gasoline: 1 };
    const drops = [{ item_category: 'block', amount: 1 }, { item_category: 'seed', amount: 20 }, { item_category: 'currency', amount: 10 }];
    assert.equal(context.applyRedTractorGasolineBonus(fuelState, drops, true), true);
    assert.equal(fuelState.gasoline, 0);
    bonusTotal += drops[0].amount;
    assert.equal(drops[1].amount, 23);
    assert.equal(drops[2].amount, 10);
  }
  assert.equal(bonusTotal, 115, 'Small drops average exactly 15% extra');
  context.crypto.randomInt = min => min;
  for (const state of [
    { gasoline: 1 }, { equipped_ride_item: 'red_tractor', gasoline: 1 },
    { equipped_ride_item: 'red_tractor', ownsTractor: true, gasoline: 0 },
  ]) assert.equal(context.applyRedTractorGasolineBonus(state, [], true), false);
  inventory.alice.equipped_ride_item = 'red_tractor';
  inventory.alice.ownsTractor = true;
  inventory.alice.gasoline = 2;
  await place(60);
  await hit(60);
  assert.equal(inventory.alice.gasoline, 2, 'Immature damage spends no gasoline');
  now += 60000;
  const beforeFuelDrops = world.drops.size;
  failCommit = true;
  await hit(60);
  assert.equal(inventory.alice.gasoline, 2);
  assert.equal(world.seeds.has('60:3'), true);
  assert.equal(world.drops.size, beforeFuelDrops, 'Failed harvest rolls back bonus drops and fuel');
  failCommit = false;
  await hit(60);
  assert.equal(inventory.alice.gasoline, 1);
  assert.deepEqual(replies.at(-1).rewards.map(d => d.amount), [6, 3]);
  await hit(60);
  assert.equal(inventory.alice.gasoline, 1, 'Duplicate harvest cannot spend twice');
  inventory.alice.equipped_ride_item = '';
  await place(50);
  const splice = (player = alice) => context.handleSeedSpliceTransaction({}, player, { ...packet('seed_splice', 50), spliced: false });
  failCommit = true;
  await splice();
  assert.equal(world.seeds.get('50:3').spliced, false, 'Failed splice restores eligibility');
  failCommit = false;
  await splice();
  assert.equal(world.seeds.get('50:3').spliced, true);
  const countAfterSplice = inventory.alice.seeds, commitsAfterSplice = commits;
  const saved = JSON.parse(JSON.stringify(context.serializeSeedForMessage(world.seeds.get('50:3'))));
  assert.equal(saved.spliced, true, 'Snapshot preserves splice lock');
  world.seeds.set('50:3', saved);
  await splice();
  assert.equal(replies.at(-1).ok, false, 'Cannot splice twice, even with forged flag');
  assert.equal(inventory.alice.seeds, countAfterSplice, 'Rejected splice spends no seed');
  assert.equal(commits, commitsAfterSplice);
  await splice(bob);
  assert.equal(replies.at(-1).ok, false, 'Splice limit belongs to tree, not player');
  now += 60000;
  await hit(50);
  await place(50);
  await splice();
  assert.equal(replies.at(-1).ok, true, 'Newly planted tree can splice again');
  for (const elapsed of [0, 30000]) {
    await place();
    const seed = world.seeds.get('4:3');
    assert.equal(seed.planted_at, now, 'Server owns planted time');
    assert.equal(seed.max_grow_time, 60, 'Ignore forged client growth duration/maturity');
    const generic = await context.validateBlockUpdateAgainstServerState({}, alice, 'TEST', { action: 'break', layer: 'foreground', x: 4, y: 3, block_type: 'dirt' });
    assert.equal(generic.ok, false, 'Generic block drops cannot bypass the tree handler');
    await context.handleSeedHarvestTransaction({}, alice, { ...packet('seed_harvest'), tree_created_at: seed.tree_created_at - 1 });
    assert.equal(replies.at(-1).ok, false, 'A stale hit cannot destroy a replacement tree');
    now += elapsed;
    const dropsBefore = dropCalls.length, countBefore = inventory.alice.seeds;
    await hit(); assert.equal(broadcasts.at(-1).action, 'hit'); assert.equal(broadcasts.at(-1).hit_count, 1);
    await hit(); assert.equal(replies.at(-1).hit_count, 2);
    await hit(); assert.equal(world.seeds.has('4:3'), false);
    assert.equal(dropCalls.length, dropsBefore, 'Immature destruction cannot generate any drop');
    assert.equal(inventory.alice.seeds, countBefore, 'No immature seed refund');
  }
  await place(); await hit(); now += 3501; await hit();
  assert.equal(replies.at(-1).hit_count, 1, 'Stopped punches reset server damage');
  await hit(); await hit();
  await place(); now += 60000; const d = dropCalls.length;
  await hit();
  assert.deepEqual(dropCalls.slice(d).map(x => [x.item_id, x.amount]), [['dirt', 5], ['dirt_seed', 2]], 'Mature configured drops unchanged');
  await place(); world.seeds.get('4:3').mutated = true; now += 60000;
  await hit(); assert.equal(dropCalls.at(-1).item_id, 'rare'); assert.equal(dropCalls.at(-1).amount, 2);
  const beforeRapid = inventory.alice.seeds;
  for (let x = 10; x < 20; x++) await place(x);
  assert.equal(inventory.alice.seeds, beforeRapid - 10);
  for (let x = 10; x < 20; x++) { await hit(x); await hit(x); await hit(x); }
  assert.equal(inventory.alice.seeds, beforeRapid - 10);
  let release;
  commitGate = new Promise(resolve => { release = resolve; });
  const beforeBroadcast = broadcasts.length, beforeCommit = commits;
  const first = place(30); await flush();
  assert.equal(broadcasts.length, beforeBroadcast, 'No authoritative confirmation before durable commit');
  await place(30, bob); assert.equal(replies.at(-1).ok, false);
  assert.equal(commits, beforeCommit);
  await new Promise(resolve => setTimeout(resolve, 150));
  release(); await first; commitGate = null;
  assert.equal(commits, beforeCommit + 1);
  assert.equal(broadcasts.length, beforeBroadcast + 1);
  await hit(30); await hit(30, bob);
  commitGate = new Promise(resolve => { release = resolve; });
  const finalHit = hit(30); await flush(); await hit(30, bob);
  assert.equal(replies.at(-1).ok, false);
  release(); await finalHit; commitGate = null;
  assert.equal(world.seeds.has('30:3'), false);
  failCommit = true;
  const inventoryBeforeFailure = inventory.alice.seeds;
  await place(40); assert.equal(world.seeds.has('40:3'), false);
  assert.equal(inventory.alice.seeds, inventoryBeforeFailure);
  failCommit = false; await place(40); await hit(40); await hit(40); failCommit = true; await hit(40);
  assert.equal(world.seeds.has('40:3'), true, 'Failed destruction restores the authoritative tree');
  failCommit = false;
  assert.equal(locks.size, 0, 'Every success/rejection releases its lock');
  const speedupTree = world.seeds.get('40:3');
  const identity = speedupTree.tree_created_at;
  context.speedupSeedGrowthState(speedupTree, now, 0);
  assert.equal(speedupTree.tree_created_at, identity);
  assert.equal(context.isSeedMature(speedupTree), true);
  const legacy = require('../server_phase8_world_action_routes').createServerPhase8WorldActionRoutes({
    requireAuthenticated: () => true, sendActionRejected: () => replies.push({ ok: false }),
    handleSeedPlaceTransaction: context.handleSeedPlaceTransaction,
  });
  for (const action of ['remove', 'mature', 'splice']) {
    const size = world.seeds.size;
    await legacy.handleWorldSeedUpdate({}, alice, packet(action, 40), {});
    assert.equal(world.seeds.size, size); assert.equal(replies.at(-1).ok, false);
  }
  await legacy.handleWorldSeedUpdate({}, alice, packet('place', 41), {});
  assert.ok(world.seeds.has('41:3'));
  assert.ok(profiles.some(p => p.name === 'seed_commit_ms:seed_place' && p.value >= 150));
  console.log('SEED_TRANSACTIONS_OK: immediate/halfway no-refund, mature/configured/mutated rewards, damage expiry, rapid planting/breaking, delayed commits, two-player races, rollback, legacy validation.');
  console.log('DELAY_PROBE: artificial 150ms durable commit delays authoritative echo by >=150ms; prediction is required for immediate local feedback.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
