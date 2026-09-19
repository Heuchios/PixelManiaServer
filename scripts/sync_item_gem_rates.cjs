// Import block-break gem expectations without changing block/seed probabilities.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const client = path.resolve(root, '../pixel-mania');
const audit = JSON.parse(fs.readFileSync(path.join(client, 'docs/item-data-audit.json'), 'utf8'));
const excluded = new Set(JSON.parse(fs.readFileSync(path.join(client, 'docs/item-data-exclusions.json'), 'utf8')).ignored_rows);
const patches = JSON.parse(fs.readFileSync(path.join(root, 'item_data_overrides.json'), 'utf8'));
const db = require('../server_item_database');
const candidates = new Map(), conflicts = [], applied = [];
for (const row of audit.rows) {
  if (excluded.has(row.row) || row.visual_state || !row.resolved_ids) continue;
  const rates = [50, 100, 500, 1000].flatMap((count, i) => {
    const value = String(row.values[12 + i] ?? '').trim();
    return /^\d+(\.\d+)?$/.test(value) ? [Number(value) / count] : [];
  });
  if (!rates.length) continue;
  assert(rates.every(n => Math.abs(n - rates[0]) < 1e-9), `Conflicting bulk columns at row ${row.row}`);
  for (const id of row.resolved_ids) {
    if (db.getItemDefinition(id)?.category !== 'block') continue;
    const entries = candidates.get(id) || [];
    entries.push({ row: row.row, average: rates[0] });
    candidates.set(id, entries);
  }
}
function apply(id, average, rows) {
  const item = db.getItemDefinition(id), patch = patches[id];
  if (!patch || item.break_return_to_inventory || id === 'toxic_waste') return;
  const rules = structuredClone(patch.drop_rules || item.drop_rules || {});
  if (!Array.isArray(rules.fixed_drops) || rules.loot_table || rules.weighted_drops) {
    conflicts.push({ id, rows, reason: 'Existing special reward rules require separate integration' });
    return;
  }
  const otherDrops = rules.fixed_drops.filter(d => d.item_id !== 'gem');
  const gems = [], whole = Math.floor(average), fraction = Number((average - whole).toFixed(10));
  if (whole) gems.push({ item_id: 'gem', item_category: 'currency', amount: whole });
  if (fraction) gems.push({ item_id: 'gem', item_category: 'currency', amount: 1, chance: fraction });
  rules.fixed_drops = [...otherDrops, ...gems];
  rules.gem_range = [0, 0];
  patch.drop_rules = rules;
  patch.authored_drop_rules = true;
  applied.push({ id, average, rows });
}
for (const [id, entries] of candidates) {
  if (entries.some(e => Math.abs(e.average - entries[0].average) > 1e-9)) {
    conflicts.push({ id, entries, reason: 'Duplicate item rows have conflicting averages; unchanged' });
    continue;
  }
  apply(id, entries[0].average, entries.map(e => e.row));
}
// Open/on variants break into the same base item and inherit its gem average.
for (const [id, item] of Object.entries(db.ITEMS)) {
  if (candidates.has(id)) continue;
  const base = applied.find(e => e.id === item.toggle_drop_block);
  if (base) apply(id, base.average, base.rows);
}
for (const file of [path.join(root, 'item_data_overrides.json'), path.join(client, 'Data/items/item_data_overrides.json')])
  fs.writeFileSync(file, JSON.stringify(patches, null, 2) + '\n');
fs.writeFileSync(path.join(client, 'docs/item-gem-rates.json'), JSON.stringify({ interpretation: 'Bulk totals / block count; floor guaranteed plus fractional chance of one extra. Block and seed probabilities unchanged.', applied, conflicts }, null, 2) + '\n');
console.log(JSON.stringify({ updated: applied.length, conflicts }, null, 2));
