const assert = require('node:assert/strict');
const db = require('../server_item_database');
const report = require('../../pixel-mania/docs/item-gem-rates.json');
for (const { id, average } of report.applied) {
  const drops = db.getItemDefinition(id).drop_rules.fixed_drops.filter(d => d.item_id === 'gem');
  assert(drops.every(d => Number.isInteger(d.amount) && d.amount > 0), `${id}: integer currency`);
  const expected = drops.reduce((n, d) => n + d.amount * (d.chance ?? 1), 0);
  assert(Math.abs(expected - average) < 1e-9, `${id}: expected ${average}, got ${expected}`);
  // Deterministic stratified rolls verify actual payout distribution to 0.001 gem.
  let total = 0;
  for (let i = 0; i < 1000; i++) {
    for (const d of drops) if ((i + 0.5) / 1000 < (d.chance ?? 1)) total += d.amount;
  }
  assert(Math.abs(total / 1000 - average) < 0.001, `${id}: payout distribution`);
}
assert.equal(report.applied.find(r => r.id === 'stone').average, 0.2);
assert(!report.applied.some(r => r.id === 'toxic_waste'));
assert.deepEqual(db.getItemDefinition('toxic_waste').drop_rules.fixed_drops, []);
console.log(`Verified integer payouts and spreadsheet averages for ${report.applied.length} item states`);
