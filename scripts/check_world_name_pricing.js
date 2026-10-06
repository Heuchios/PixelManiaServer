"use strict";
const assert = require("node:assert/strict");
const { quoteWorldName, RESERVATION_DURATION_MS, PREMIUM_MULTIPLIERS, PREMIUM_NAME_GROUPS, PRICING_VERSION } = require("../.tsbuild/world-name-pricing/world_name_pricing.js");

for (const [name, expected] of [
  ["A", 500000], ["a", 500000], ["Shop", 750000], ["hello123", 500],
  ["AB", 250000], ["A1", 250000], ["ABC", 50000], ["123", 50000],
  ["ABCD", 25000], ["HELLO", 250000], ["PLANET", 100000],
  ["BUY", 750000], ["SELL", 750000], ["TRADE", 750000], ["MARKET", 750000],
  ["HANGOUT", 250000], ["PARKOUR", 250000], ["PVP", 250000],
  ["GOLD", 100000], ["LOVE", 100000], ["RARE", 100000], ["FARM", 100000], ["FISH", 100000],
  ["OG", 250000], ["VIP", 100000], ["HALLOFFAME", 250000],
  ["FISHING", 250000], ["FISHMARKET", 250000], ["FISHMONGER", 250000],
  ["NEPTUNEROD", 100000], ["VOIDWORMBAIT", 100000], ["ALIENFISH", 100000],
  ["FARMING", 250000], ["SEEDSHOP", 250000], ["CROPMARKET", 250000],
  ["REDTRACTOR", 100000], ["FERTILIZER", 100000], ["FERTILISER", 100000],
  ["EVENTHUB", 250000], ["SNOWSTORM", 250000], ["LANDFILL", 250000],
  ["EGGHUNT", 250000], ["FROZENTREASURE", 100000], ["ICESKATING", 100000],
  ["EXAMPLE", 2500], ["LONGERNAME", 1000], ["SHOP123", 500],
  ["12345678", 500], ["CONSTRUCTOR", 1000], ["Z".repeat(32), 1000],
]) {
  const quote = quoteWorldName(name);
  assert.equal(quote.price_gems, expected, name);
  assert.equal(quote.name, name.toUpperCase());
  assert.equal(quote.reservation_duration_ms, 604800000);
}
for (const invalid of [null, undefined, 123, {}, "", " A", "A ", "A\n", "A-B", "A_B", "SHÖP", "Ａ", "A".repeat(33)]) {
  assert.throws(() => quoteWorldName(invalid), String(invalid));
}
assert.equal(RESERVATION_DURATION_MS, 604800000);
assert.equal(PRICING_VERSION, 3);
assert.ok(Object.isFrozen(PREMIUM_MULTIPLIERS));
assert.ok(Object.keys(PREMIUM_MULTIPLIERS).length >= 1000, "Keep the expanded catalogue covered");
for (const group of PREMIUM_NAME_GROUPS) {
  assert.ok([750000, 250000, 100000].includes(group.price_gems));
  assert.ok(Object.isFrozen(group));
  assert.ok(Object.isFrozen(group.names));
  for (const name of group.names) {
    assert.match(name, /^[A-Z0-9]{1,32}$/);
    assert.ok(quoteWorldName(name).price_gems >= group.price_gems, name);
  }
}
for (const [name, multiplier] of Object.entries(PREMIUM_MULTIPLIERS)) {
  const expectedFloor = name.length === 1 ? 500000 : name.length === 2 ? 250000 : 50000;
  const quote = quoteWorldName(name.toLowerCase());
  assert.equal(quote.name, name);
  assert.equal(quote.price_gems, Math.max(expectedFloor, multiplier * 500), name);
  assert.equal(quote.tier, "premium");
  assert.equal(quote.pricing_version, 3);
  assert.equal(quoteWorldName(`${name}123`).price_gems, 500, `No substring premiums: ${name}`);
}
console.log(`World name pricing: ${Object.keys(PREMIUM_MULTIPLIERS).length} premium names, tiers, exact matching, case folding, short-name floors, and invalid inputs passed.`);
