"use strict";

// Pure planner: up to 20 random empty cells inside a 10x10 square.
// The caller applies these in the barrel-break world transaction.
function planToxicWasteSpread(x, y, canPlace, random = Math.random) {
  const candidates = [];
  for (let dy = -5; dy < 5; dy += 1) {
    for (let dx = -5; dx < 5; dx += 1) {
      if (canPlace(x + dx, y + dy)) candidates.push({ x: x + dx, y: y + dy });
    }
  }
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, 20);
}
module.exports = { planToxicWasteSpread };
