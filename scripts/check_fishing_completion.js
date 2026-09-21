"use strict";

// Execute the built handler with isolated persistence/network dependencies.
// This never starts a server or touches a player account.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ItemDatabase = require("../server_item_database");
const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const start = source.indexOf("async function handleFishingCompleteTransaction(");
const end = source.indexOf("function isSellableFishItem(", start);
assert.ok(start >= 0 && end > start, "Fishing completion handler was not found");

async function runCase(options = {}) {
  const session = {
    session_id: "session-1", world: "POND", difficulty: options.difficulty || 1,
    expires_at: Date.now() + (options.expired ? -1000 : 60000),
    item_id: "pond_fish", fish_id: "pond_fish", item_category: "fish", lure_id: "worm_lure",
    ...(options.hat ? { item_id: "octopus_hat", fish_id: "", item_category: "hat" } : {}),
  };
  const sessions = new Map(options.missing ? [] : [["player-1", session]]);
  const results = [], rejected = [];
  let commits = 0, awarded = 0, ledger = 0;
  const context = {
    ItemDatabase,
    FishMarket: { catchAmount: () => 10, UNIT: "decikilograms" },
    FishMarketStore: { quotes: async () => ({}) },
    isPostgresAuthoritativeReady: () => false,
    getInventoryCount: () => 0,
    activeFishingSessions: sessions,
    makeRequestId: data => data.request_id,
    sendInventoryTransactionRejected: (_socket, _data, message) => rejected.push(message),
    sendInventoryTransactionResult: (_socket, result) => results.push(result),
    clearPlayerFishingPresence() {}, publishPlayerPresenceUpdate() {},
    rejectIfWorldBanned: async () => Boolean(options.banned),
    ensureWritablePlayerState: () => ({}),
    cloneJson: value => JSON.parse(JSON.stringify(value)),
    clampString: value => String(value || ""),
    resolveInventoryCategory: (_id, category) => category,
    addItemToState: (_state, id, category, amount) => {
      if (options.hat) {
        assert.equal(id, "octopus_hat");
        assert.equal(category, "hat");
        assert.equal(amount, 1);
      }
      awarded++; return !options.full;
    },
    getFishingXp: () => 10,
    grantExperienceToState: () => ({}),
    commitPlayerInventoryState: async (_socket, _player, _name, _before, state) => {
      commits++;
      return { ok: !options.commitFailure, state, deltas: [], postgres_committed: true, message: "Commit rejected" };
    },
    buildInventoryDeltaClientPayloads: () => [],
    logItemLedgerForState: () => { ledger++; },
    buildFishingRewardFxPayload: () => null,
    getProgressionMessage: (_xp, message) => message,
    getFishingRewardFxRarity: () => "common",
    buildProgressionPayload: () => ({}),
    randomChance: () => assert.fail("A winning catch must not be randomly discarded"),
  };
  const handler = vm.runInNewContext(source.slice(start, end) + "\nhandleFishingCompleteTransaction;", context);
  const player = { id: "player-1", account_username: "fixture", world: options.changedWorld ? "OTHER" : "POND" };
  const request = { request_id: "finish-1", session_id: options.wrongSession ? "other-session" : "session-1", success: options.success === undefined ? true : options.success };
  await handler({}, player, request);
  if (options.duplicate) await handler({}, player, request);
  return { results, rejected, commits, awarded, ledger, sessions };
}

(async () => {
  let checks = 0;
  const hat = await runCase({ hat: true, duplicate: true });
  assert.equal(hat.results[0].item_id, "octopus_hat");
  assert.equal(hat.results[0].rewards[0].amount, 1);
  assert.equal(hat.commits, 1);
  assert.equal(hat.ledger, 1);
  assert.equal(hat.awarded, 1);
  assert.equal(hat.rejected.length, 1);
  checks += 6;
  for (let difficulty = 1; difficulty <= 10; difficulty++) {
    const result = await runCase({ difficulty, duplicate: true });
    assert.equal(result.results[0].item_id, "pond_fish");
    assert.equal(result.commits, 1);
    assert.equal(result.ledger, 1);
    assert.equal(result.awarded, 1);
    assert.equal(result.rejected.length, 1, "Repeated completion must not award another item");
    checks += 5;
  }
  for (const success of [false, "true", 1, null]) {
    const result = await runCase({ success });
    assert.equal(result.commits, 0);
    assert.equal(result.results[0].item_id, "");
    checks += 2;
  }
  for (const option of ["expired", "changedWorld", "missing", "wrongSession", "banned", "full"]) {
    const result = await runCase({ [option]: true });
    assert.equal(result.commits, 0, option + " must not commit a reward");
    assert.equal(result.results.length, 0);
    if (option === "wrongSession") assert.equal(result.sessions.size, 1, "A stale cancellation must leave the current session intact");
    checks += 2;
  }
  const failedCommit = await runCase({ commitFailure: true });
  assert.equal(failedCommit.results.length, 0);
  assert.equal(failedCommit.ledger, 0);
  assert.equal(failedCommit.rejected.length, 1);
  console.log(`[fishing-completion] ${checks + 4} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
