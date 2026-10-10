"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
const start = source.indexOf("async function handleFishingStartTransaction(");
const end = source.indexOf("async function handleFishingCompleteTransaction(", start);
assert.ok(start >= 0 && end > start);

async function runCase(options = {}) {
  const previous = { session_id: "lost-reply", world: "POND", expires_at: Date.now() + (options.expired ? -1000 : 60000) };
  const sessions = new Map(options.existing ? [["angler", previous]] : []);
  const results = [], rejected = [], presence = [];
  let spends = 0, commits = 0, ledger = 0;
  const context = {
    activeFishingSessions: sessions, makeRequestId: d => d.request_id,
    getTransactionWorldName: p => p.world, requireSameWorld: () => true,
    rejectIfWorldBanned: async () => false,
    clearPlayerFishingPresence: () => presence.push("clear"),
    publishPlayerPresenceUpdate: () => presence.push("publish"),
    applyPlayerFishingPresenceFromSession: () => presence.push("start"),
    sendInventoryTransactionRejected: (_s, _d, message) => rejected.push(message),
    sendInventoryTransactionResult: (_s, result) => results.push(result),
    getFishingGrid: () => ({ x: 2, y: 1 }), validateFishingTarget: () => !options.invalidTarget,
    clampString: String, ItemDatabase: { getItemDefinition: () => ({ category: "lure" }) },
    ensureWritablePlayerState: () => ({ lure_inventory: { bait: 3 } }),
    resolveFishingRodForTransaction: () => "bamboo_fishing_rod",
    cloneJson: value => structuredClone(value),
    spendItemFromState: state => { spends++;state.lure_inventory.bait--;return true; },
    rollFishingReward: () => ({ item_id: "guppy", fish_id: "guppy", item_category: "fish", difficulty: 1 }),
    crypto: { randomUUID: () => "new-cast" }, FISHING_SESSION_TTL_MS: 90000,
    commitPlayerInventoryState: async (_s, _p, _u, _before, state) => {
      commits++;return { ok: !options.commitFailure, state, deltas: [], postgres_committed: true, message: "commit rejected" };
    },
    buildInventoryDeltaClientPayloads: () => [], logItemLedgerForState: () => { ledger++; },
  };
  const handler = vm.runInNewContext(source.slice(start, end) + "\nhandleFishingStartTransaction;", context);
  const player = { id: "angler", account_username: "fixture", world: "POND" };
  await handler({}, player, { request_id: "retry-cast", lure_id: "bait" });
  return { sessions, results, rejected, presence, spends, commits, ledger };
}

(async () => {
  const live = await runCase({ existing: true });
  assert.equal(live.commits, 0);assert.equal(live.spends, 0);
  assert.equal(live.sessions.get("angler").session_id, "lost-reply");
  assert.equal(live.rejected[0], "Finish your current cast first.");
  const expired = await runCase({ existing: true, expired: true });
  assert.equal(expired.results.length, 1, "Expired cast must not block fishing until reconnect");
  assert.equal(expired.results[0].session_id, "new-cast");
  assert.equal(expired.commits, 1);assert.equal(expired.spends, 1);assert.equal(expired.ledger, 1);
  assert.equal(expired.sessions.get("angler").session_id, "new-cast");
  assert.ok(expired.presence.includes("clear"));
  const invalid = await runCase({ existing: true, expired: true, invalidTarget: true });
  assert.equal(invalid.sessions.size, 0);assert.equal(invalid.spends, 0);assert.equal(invalid.commits, 0);
  const failed = await runCase({ existing: true, expired: true, commitFailure: true });
  assert.equal(failed.sessions.size, 0);assert.equal(failed.results.length, 0);assert.equal(failed.ledger, 0);
  const fresh = await runCase();
  assert.equal(fresh.commits, 1);assert.equal(fresh.results.length, 1);
  console.log("FISHING_START_RECOVERY_PASS: expired cast recovery, live-session protection, target validation, single bait charge and commit failure");
})().catch(e => { console.error(e);process.exitCode = 1; });
