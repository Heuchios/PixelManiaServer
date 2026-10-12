"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Rewards = require("../server_daily_rewards");

const counts = new Map();
assert.equal(Rewards.TOTAL_WEIGHT, 1000);
for (let roll = 0; roll < 1000; roll++) {
  const reward = Rewards.chooseReward(roll);
  counts.set(reward.gems, (counts.get(reward.gems) || 0) + 1);
}
assert.deepEqual([...counts], [[250,795],[1000,200],[5000,5]]);
for (const bad of [-1, 1000, 1.5, NaN, Infinity]) assert.throws(() => Rewards.chooseReward(bad));

const source = fs.readFileSync(require.resolve("../server.js"), "utf8");
const start = source.indexOf("async function handleInventoryTransactionRequest(");
const end = source.indexOf("\nasync function handleQuestRequest(", start);
async function route(options = {}) {
  let applied = 0, released = 0, failedLedgers = 0, response, rejection;
  const player = { authenticated: true, account_username: "daily-test", world: "START" };
  const context = { requireAuthenticated: () => options.auth !== false, makeRequestId: () => "daily-test-1",
    cleanWorld: s => s, acquirePlayerInventoryLocks: async () => ({acquired: options.lock !== false}),
    releasePlayerInventoryLocks: () => released++,
    flushPendingSessionPersistence: async () => { if (options.changeSession) player.authenticated = false; return {ok: options.flush !== false}; },
    postgresStore: {}, getSocketAddress: () => "127.0.0.1", queueFailedTransactionLedger: () => failedLedgers++,
    DailyRewards: {apply: async (_store, entry) => { applied++; assert.equal(entry.username, "daily-test"); assert.equal(entry.reward_day, 42);
      if (options.throw) throw new Error("injected failure");
      return {ok:options.resultFailure !== true,daily_reward:{reward:{gems:250}}}; }},
    refreshPlayerStateFromPostgres: async () => ({ok:true,state:{gems:250}}), buildPlayerStateForClient: s => s,
    sendInventoryTransactionResult: (_socket, data) => response = data,
    sendInventoryTransactionRejected: (_socket, _data, message) => rejection = message,
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  const call = () => context.handleInventoryTransactionRequest({}, player, {action: options.action || "daily_reward_claim", reward_day:42,
    world:options.world || "START", username:"spoofed", gems:999999});
  if (options.throw) await assert.rejects(call); else await call();
  return {applied,released,failedLedgers,response,rejection};
}
(async () => {
  const normal = await route(); assert.equal(normal.applied,1); assert.equal(normal.released,1); assert.equal(normal.response.player_data.gems,250);
  for (const options of [{auth:false},{lock:false},{flush:false},{changeSession:true},{world:"OTHER"},{action:"daily_reward_hack"}])
    assert.equal((await route(options)).applied,0);
  assert.equal((await route({throw:true})).released,1);
  assert.equal((await route({resultFailure:true})).failedLedgers,1);
  assert.equal((await route({resultFailure:true,action:"daily_reward_status"})).failedLedgers,0);
  console.log("DAILY_REWARDS_ROUTE_PASS: odds boundaries, authentication, world, live lock, session revalidation, spoofed reward ignored, release on exception");
})().catch(error => {console.error(error);process.exitCode=1;});
