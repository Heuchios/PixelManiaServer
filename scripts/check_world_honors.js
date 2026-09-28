#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const start = source.indexOf("function getWorldHonorPlayerId(");
const end = source.indexOf("function serializeTradeSlots(", start);
assert.ok(start > 0 && end > start);

function harness() {
  const state = { now: 100000, locked: true, role: "", level: 1, fail: false, pending: null };
  const messages = [], visits = [], timers = [];
  const boards = {
    today: [{ rank: 1, world_name: "SHOP", honor_score: 2, qualified_visitors: 2 }],
    yesterday: [{ rank: 2, world_name: "SHOP", honor_score: 3, qualified_visitors: 3 }],
    overall: [{ rank: 3, world_name: "SHOP", honor_score: 4.5, qualified_visitors: 6 }],
  };
  const deps = {
    WORLD_HONORS_ENABLED: true, WORLD_HONOR_MIN_PLAYER_LEVEL: 1,
    WORLD_HONOR_MIN_DWELL_MS: 60000, WORLD_HONOR_NETWORK_HASH_SECRET: "",
    WORLD_HONOR_MAX_ACCOUNTS_PER_NETWORK_PER_WORLD_DAY: 3,
    WORLD_HONOR_TOP_LIMIT: 10, WORLD_HONOR_OVERALL_HALF_LIFE_DAYS: 30,
    WORLD_HONOR_INACTIVE_DAYS: 60, WORLD_HONOR_LEADERBOARD_CACHE_MS: 30000,
    WORLD_HONOR_TOP_COMMAND_COOLDOWN_MS: 1500, SERVER_INSTANCE_ID: "test",
    activeWorldHonorVisits: new Map(), worldHonorLeaderboardCache: new Map(),
    worldHonorTopCommandCooldowns: new Map(),
    Date: class extends Date { static now() { return state.now; } },
    setTimeout: (fn, delay) => { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { timer.cancelled = true; },
    cleanAccountName: (name) => String(name).trim(),
    cleanWorld: (name) => String(name).trim().toUpperCase(),
    ensurePlayerState: () => ({ player_level: state.level }),
    ensureWorldState: () => ({}),
    getEffectiveWorldLockStateInState: () => ({ is_locked: state.locked }),
    getWorldLockRoleForPlayer: () => state.role,
    getErrorMessage: (error) => error.message,
    console: { log() {}, warn() {} },
    sendSystemChatToPlayer: (_socket, player, message) => messages.push({ world: player.world, message }),
    postgresStore: {
      isReady: () => true,
      recordWorldHonorVisit: async (entry) => {
        visits.push(entry);
        return state.fail ? { ok: false } : { ok: true, recorded: true, honor_date: "2026-09-28" };
      },
      getWorldHonorLeaderboard: async (period) => {
        if (state.pending) await state.pending;
        return state.fail ? { ok: false } : { ok: true, entries: boards[period] };
      },
    },
  };
  const api = new Function(...Object.keys(deps), `${source.slice(start, end)}
    return {beginWorldHonorVisit,endWorldHonorVisit,handleWorldHonorTopCommand};`)(...Object.values(deps));
  const player = { id: "socket1", account_username: "visitor", authenticated: true, joined_world: true, world: "SHOP" };
  return { ...api, deps, state, messages, visits, timers, player };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function main() {
  const h = harness();
  await h.beginWorldHonorVisit({}, h.player, "SHOP");
  await flush();
  assert.equal(h.visits.length, 0);
  assert.equal(h.timers[0].delay, 60000);
  assert.match(h.messages[0].message, /Today #1 \| Yesterday #2 \| Overall #3/);
  await h.beginWorldHonorVisit({}, h.player, "SHOP");
  await flush();
  assert.equal(h.messages.length, 1, "Duplicate begin must not repeat the notice");
  h.state.now += 60000;
  h.timers[0].fn();
  await flush();
  assert.equal(h.visits.length, 1, "Dwell timer must record a qualified visit");
  assert.equal(h.visits[0].visitor_username, "visitor");
  await h.endWorldHonorVisit(h.player, "SHOP", "leave_world");
  assert.equal(h.visits.length, 1, "Leaving after qualification must not double count");

  for (const role of ["owner", "admin", "member"]) {
    const own = harness(); own.state.role = role;
    await own.beginWorldHonorVisit({}, own.player, "SHOP"); await flush();
    assert.equal(own.timers.length, 0, `${role} must not earn self honors`);
    assert.equal(own.messages.length, 1, `${role} must still see honors`);
  }
  const short = harness();
  await short.beginWorldHonorVisit({}, short.player, "SHOP");
  short.state.now += 59999;
  await short.endWorldHonorVisit(short.player, "SHOP", "disconnect");
  assert.equal(short.visits.length, 0);
  assert.equal(short.timers[0].cancelled, true);
  const unlocked = harness(); unlocked.state.locked = false;
  await unlocked.beginWorldHonorVisit({}, unlocked.player, "SHOP");
  assert.equal(unlocked.timers.length, 0, "Unlocked worlds cannot earn honors");
  const retry = harness();
  await retry.beginWorldHonorVisit({}, retry.player, "SHOP"); await flush();
  retry.state.now += 60000; retry.state.fail = true; retry.timers[0].fn(); await flush();
  assert.equal(retry.timers[1].delay, 30000, "Temporary DB errors retry qualification");
  retry.state.fail = false; retry.state.now += 30000; retry.timers[1].fn(); await flush();
  assert.equal(retry.visits.length, 2);

  const empty = harness(); empty.player.world = "UNRANKED";
  await empty.beginWorldHonorVisit({}, empty.player, "UNRANKED"); await flush();
  assert.match(empty.messages[0].message, /No top 10 rankings yet/);
  const failed = harness(); failed.state.fail = true;
  await failed.beginWorldHonorVisit({}, failed.player, "SHOP"); await flush();
  assert.match(failed.messages[0].message, /temporarily unavailable/);
  for (const leaving of ["warp", "disconnect", "reenter"]) {
    const late = harness(); let release;
    late.state.pending = new Promise((resolve) => { release = resolve; });
    await late.beginWorldHonorVisit({}, late.player, "SHOP");
    await late.endWorldHonorVisit(late.player, "SHOP", leaving);
    if (leaving === "warp") late.player.world = "OTHER";
    if (leaving === "disconnect") late.player.disconnected = true;
    if (leaving === "reenter") await late.beginWorldHonorVisit({}, late.player, "SHOP");
    release(); await flush();
    assert.equal(late.messages.length, leaving === "reenter" ? 1 : 0, `Suppress stale ${leaving} notices`);
  }
  const command = harness();
  await command.handleWorldHonorTopCommand({}, command.player, "/honors overall");
  assert.match(command.messages[0].message, /Overall/);
  assert.match(command.messages[1].message, /#3 SHOP/);
  await command.handleWorldHonorTopCommand({}, command.player, "/top today");
  assert.match(command.messages.at(-1).message, /wait a moment/);
  command.state.now += 1500;
  await command.handleWorldHonorTopCommand({}, command.player, "/top yesterday");
  assert.match(command.messages.at(-1).message, /#2 SHOP/);
  console.log("[world-honors] dwell, eligibility, retries, lifecycle, entry chat, stale notices, and commands passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
