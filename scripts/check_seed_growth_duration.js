const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ItemDatabase = require('../server_item_database');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const start = server.indexOf('function getSeedConfiguredGrowTime(');
const finish = server.indexOf('\nfunction ', start + 1);
assert.ok(start >= 0 && finish > start);
const getDuration = vm.runInNewContext(
  `${server.slice(start, finish)}; getSeedConfiguredGrowTime`,
  { ItemDatabase, SERVER_SEED_GROW_TIME_SECONDS: 150 },
);
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '../../pixel-mania/docs/splice-harvest-times.json'), 'utf8')).rows;
for (const row of rows) {
  if (row.seed_id) assert.equal(getDuration(row.seed_id), row.seconds, row.name);
}
assert.equal(getDuration('oil_refinery_seed'), 7 * 86400);
assert.equal(getDuration('colored_block_maker_seed'), 7 * 86400);
assert.equal(getDuration('missing_seed'), 150);
console.log('Server growth lookup matches all spreadsheet seeds, including multi-day timers.');
