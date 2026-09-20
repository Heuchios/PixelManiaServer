const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
function extract(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0);
  const rest = source.slice(start);
  const end = rest.search(/\n(?:async )?function \w+\(/);
  return end < 0 ? rest : rest.slice(0, end);
}
async function run(existing, amount, failCommit = false) {
  let inventory = { count: 400 }, commits = 0, created = 0;
  const world = { drops: new Map(existing.map((count, i) => [String(i), { amount: count, x: 1, y: 2 }])) };
  const replies = [];
  const ctx = {
    MAX_DROP_TILE_AMOUNT: 2000, MAX_DROP_CREATE_DISTANCE_PIXELS: 200, SERVER_DROP_PICKUP_DELAY: 1,
    makeRequestId: () => 'test', getTransactionWorldName: () => 'TEST', requireSameWorld: () => true,
    rejectIfWorldBanned: async () => false, tradeByPlayerId: new Map(),
    ItemDatabase: { hasItem: () => true, isDropableItem: () => true, canStoreItemInCategory: () => true, getStackLimit: () => 400 },
    clampString: String, clampInteger: (n, min, max) => Math.max(min, Math.min(max, Math.trunc(n))),
    resolveInventoryCategory: () => 'block', getTransactionDropPosition: () => ({ x: 32, y: 64 }),
    isPositionInWorldBounds: () => true, isPlayerNearPoint: () => true,
    getTransactionDropGrid: () => ({ x: 1, y: 2 }), isDropGridBlockedByBlock: () => false,
    isGridInWorld: () => true, ensureWorldState: () => world, getDropStackGridFromDrop: d => d,
    ensureWritablePlayerState: () => inventory, getInventoryCount: s => s.count,
    cloneJson: s => ({ ...s }), spendItemFromState: (s, _i, _c, n) => { s.count -= n; return true; },
    createServerDrop: (_w, _i, _c, n) => { created++; const d = { drop_id: 'new', amount: n, x: 1, y: 2 }; world.drops.set('new', d); return d; },
    makeAuditId: () => 'audit', serializeWorldState: () => ({}),
    commitPlayerInventoryState: async (_s, _p, _u, _b, staged) => { commits++; if(failCommit) return { ok: false, message: 'failed' }; inventory = staged; return { ok: true, state: staged, deltas: [] }; },
    sendInventoryTransactionRejected: (_s, _d, message) => replies.push({ ok: false, message }),
    sendInventoryTransactionResult: (_s, payload) => replies.push(payload),
    buildInventoryDeltaClientPayloads: () => [], persistWorldStateAfterInventoryCommit: () => {},
    sendWorldUpdateToRequesterAndWorld: () => {}, logWorldChange: () => {}, logItemLedgerForState: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(extract('getDropTotalAmountOnTile') + '\n' + extract('handleDropInventoryItemTransaction'), ctx);
  await ctx.handleDropInventoryItemTransaction({}, { id: 'player', account_username: 'test' }, { item_id: 'dirt', amount });
  const accepted = existing.reduce((a,b)=>a+b,0) + amount <= 2000;
  assert.equal(commits, accepted ? 1 : 0);
  assert.equal(created, accepted ? 1 : 0);
  assert.equal(inventory.count, accepted && !failCommit ? 400 - amount : 400);
  assert.equal(world.drops.has('new'), accepted && !failCommit);
  assert.equal(replies[0].ok, accepted && !failCommit);
  const total = inventory.count + [...world.drops.values()].reduce((sum, d) => sum + d.amount, 0);
  assert.equal(total, 400 + existing.reduce((a,b)=>a+b,0), 'inventory + world count must be conserved');
}
(async () => {
  for (const [existing, amount] of [[[2000],1], [[1900],200], [[1600],400], [[1000,1000],400], [[2400],1], [[],400]]) await run(existing, amount);
  await run([1600], 400, true);
  console.log('[drop-tile-capacity] full/partial/exact/mixed/overflow/rollback conservation checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
