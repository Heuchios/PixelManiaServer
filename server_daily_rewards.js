"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOTAL_WEIGHT = exports.REWARDS = exports.DAY_MS = void 0;
exports.chooseReward = chooseReward;
exports.ensureSchema = ensureSchema;
exports.apply = apply;
const node_crypto_1 = require("node:crypto");
exports.DAY_MS = 86400000;
exports.REWARDS = Object.freeze([
    { id: "gems_250", name: "250 GEMS", gems: 250, weight: 795, rarity: "COMMON" },
    { id: "gems_1000", name: "1,000 GEMS", gems: 1000, weight: 200, rarity: "RARE" },
    { id: "gems_5000", name: "5,000 GEMS", gems: 5000, weight: 5, rarity: "JACKPOT" },
]);
exports.TOTAL_WEIGHT = exports.REWARDS.reduce((sum, reward) => sum + reward.weight, 0);
function chooseReward(roll = (0, node_crypto_1.randomInt)(exports.TOTAL_WEIGHT)) {
    if (!Number.isInteger(roll) || roll < 0 || roll >= exports.TOTAL_WEIGHT)
        throw new Error("Invalid reward roll");
    let cumulative = 0;
    for (const reward of exports.REWARDS) {
        cumulative += reward.weight;
        if (roll < cumulative)
            return { ...reward };
    }
    throw new Error("Invalid daily reward configuration");
}
async function ensureSchema(store) {
    const client = await store.db.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('pixelmania-daily-rewards-v1'))");
        await client.query(`CREATE TABLE IF NOT EXISTS ${store.table("daily_reward_receipts")} (
      player_id uuid NOT NULL REFERENCES ${store.table("players")}(player_id),
      reward_day bigint NOT NULL, request_id text NOT NULL, reward jsonb NOT NULL,
      gems integer NOT NULL CHECK(gems > 0), created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(player_id, reward_day)
    )`);
        await client.query("COMMIT");
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
// The client sends only an action and the day it was offered. Clock, odds, reward,
// balance and durable claim guard all come from the server/database.
async function apply(store, entry) {
    if (!store.isReady() || !store.dailyRewardsReady)
        return { ok: false, message: "Daily rewards are temporarily unavailable. Please try again later." };
    if (!["daily_reward_status", "daily_reward_claim"].includes(entry.action))
        return { ok: false, message: "Unknown daily reward action." };
    const username = String(entry.username || "").trim();
    if (!username)
        return { ok: false, message: "Sign in to claim your daily reward." };
    try {
        const result = await store.withTransaction(async (client) => {
            const playerId = await store.ensurePlayerIdentity(client, username, "", "player", entry.world);
            if (!playerId)
                throw new Error("Player not found.");
            // Serializes claims across routes/processes as well as the outer live lock.
            await client.query(`SELECT player_id FROM ${store.table("players")} WHERE player_id=$1 FOR UPDATE`, [playerId]);
            const clock = await client.query("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms");
            const now = Number(clock.rows[0].now_ms);
            const day = Math.floor(now / exports.DAY_MS);
            const snapshot = { day, server_time: now, reset_at: (day + 1) * exports.DAY_MS,
                rewards: exports.REWARDS.map(reward => ({ ...reward, chance: reward.weight * 100 / exports.TOTAL_WEIGHT })), can_claim: true, reward: null };
            const saved = await client.query(`SELECT reward FROM ${store.table("daily_reward_receipts")} WHERE player_id=$1 AND reward_day=$2`, [playerId, day]);
            if (saved.rows.length) {
                snapshot.can_claim = false;
                snapshot.reward = saved.rows[0].reward;
            }
            if (entry.action === "daily_reward_status")
                return { ok: true, daily_reward: snapshot };
            // A delayed retry from yesterday must never silently consume today's box.
            if (!Number.isSafeInteger(entry.reward_day) || entry.reward_day !== day)
                return { ok: false, message: "A new daily box is ready. Please open it again.", daily_reward: snapshot };
            if (saved.rows.length)
                return { ok: true, already_claimed: true, daily_reward: snapshot,
                    message: "Today's reward is already in your inventory." };
            const reward = chooseReward();
            const beforeHash = await store.getInventorySnapshotHash(client, playerId);
            await client.query(`INSERT INTO ${store.table("inventory")} (player_id,item_type,item_category,amount,stack_limit)
        VALUES($1,'gem','currency',0,2147483647) ON CONFLICT (player_id,item_type,item_category) DO NOTHING`, [playerId]);
            const balance = await client.query(`SELECT amount,stack_limit FROM ${store.table("inventory")}
        WHERE player_id=$1 AND item_type='gem' AND item_category='currency' FOR UPDATE`, [playerId]);
            const before = Number(balance.rows[0].amount), after = before + reward.gems;
            if (!Number.isSafeInteger(after) || after > Number(balance.rows[0].stack_limit))
                throw new Error("Your gem balance is full. Your daily box is still available.");
            const metadata = { reward_day: day, reward_id: reward.id, reward, request_id: entry.request_id };
            await client.query(`UPDATE ${store.table("inventory")} SET amount=$2,row_version=row_version+1,updated_at=now()
        WHERE player_id=$1 AND item_type='gem' AND item_category='currency'`, [playerId, after]);
            const item = await client.query(`INSERT INTO ${store.table("item_transactions")}
        (player_id,source,action,item_type,item_category,delta,before_amount,after_amount,request_id,metadata)
        VALUES($1,'reward','daily_reward_claim','gem','currency',$2,$3,$4,$5,$6::jsonb) RETURNING item_transaction_id`, [playerId, reward.gems, before, after, entry.request_id, JSON.stringify(metadata)]);
            const ledger = await client.query(`INSERT INTO ${store.table("gem_ledger")}
        (player_id,delta,reason,ref_type,ref_id,before_balance,after_balance,metadata)
        VALUES($1,$2,'daily_reward','daily_reward',$3,$4,$5,$6::jsonb) RETURNING gem_ledger_id`, [playerId, reward.gems, `${playerId}:${day}`, before, after, JSON.stringify(metadata)]);
            await client.query(`INSERT INTO ${store.table("daily_reward_receipts")} (player_id,reward_day,request_id,reward,gems)
        VALUES($1,$2,$3,$4::jsonb,$5)`, [playerId, day, entry.request_id, JSON.stringify(reward), reward.gems]);
            const afterHash = await store.updatePlayerInventoryHash(client, playerId);
            await store.recordTransactionLedger(client, { transaction_type: "DAILY_REWARD", player_id: playerId,
                source: "reward", action: entry.action, status: "success", item_type: "gem", item_category: "currency",
                quantity: reward.gems, gems_before: before, gems_after: after,
                gem_ledger_id: ledger.rows[0].gem_ledger_id, item_transaction_id: item.rows[0].item_transaction_id,
                request_id: entry.request_id, ip_address: entry.ip_address, user_agent: entry.user_agent,
                inventory_before_hash: beforeHash, inventory_after_hash: afterHash, metadata });
            return { ok: true, already_claimed: false, message: `You won ${reward.name}!`,
                daily_reward: { ...snapshot, can_claim: false, reward } };
        }, "daily_reward", `daily:${username.toLowerCase()}`);
        return result || { ok: false, message: "Daily rewards are temporarily unavailable. Please try again later." };
    }
    catch (error) {
        if (error?.code)
            store.logger("[daily-rewards] claim failed", { code: error.code });
        return { ok: false, message: error?.code ? "Could not save your reward. Please try again." : String(error?.message || "Daily reward failed.") };
    }
}
