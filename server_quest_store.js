// Generated from src/server_quest_store.ts. Do not edit by hand.
"use strict";
const Engine = require("./server_quest_engine");
async function ensureSchema(store) {
    await store.db.query(`
 CREATE TABLE IF NOT EXISTS ${store.table("quest_accounts")} (
   player_id uuid PRIMARY KEY REFERENCES ${store.table("players")}(player_id),
   state jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS ${store.table("quest_receipts")} (
   player_id uuid NOT NULL REFERENCES ${store.table("players")}(player_id),
   receipt_id text NOT NULL, request_id text NOT NULL, reward_day bigint,
   gems integer NOT NULL DEFAULT 0, stamps integer NOT NULL DEFAULT 0,
   stamps_before integer NOT NULL, stamps_after integer NOT NULL,
   receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(player_id, receipt_id)
 );
 CREATE INDEX IF NOT EXISTS quest_receipts_time ON ${store.table("quest_receipts")}(created_at);
 `);
}
async function apply(store, entry) {
    if (!store.isReady() || !store.questReady)
        return { ok: false, message: "The Dispatch is unavailable. Your rewards are safe; please try again later." };
    const username = String(entry.username || "").trim();
    if (!username)
        return { ok: false, message: "Sign in to use the Dispatch." };
    try {
        const result = await store.withTransaction(async (client) => {
            const playerId = await store.ensurePlayerIdentity(client, username, "", "player", entry.world);
            if (!playerId)
                throw new Error("Player not found.");
            await client.query(`INSERT INTO ${store.table("quest_accounts")} (player_id) VALUES($1) ON CONFLICT DO NOTHING`, [playerId]);
            const saved = await client.query(`SELECT state FROM ${store.table("quest_accounts")} WHERE player_id=$1 FOR UPDATE`, [playerId]);
            const before = saved.rows[0].state;
            const changed = Engine.transition(before, entry.action, entry.payload, Date.now(), username.toLowerCase());
            let gemsBefore = null, gemsAfter = null, gemLedgerId = null, itemTransactionId = null;
            const inventoryBeforeHash = changed.gemDelta ? await store.getInventorySnapshotHash(client, playerId) : null;
            if (changed.gemDelta) {
                // Same canonical inventory row and locks used by normal gem transactions.
                await client.query(`INSERT INTO ${store.table("inventory")} (player_id,item_type,item_category,amount,stack_limit) VALUES($1,'gem','currency',0,2147483647) ON CONFLICT (player_id,item_type,item_category) DO NOTHING`, [playerId]);
                const balance = await client.query(`SELECT amount,stack_limit FROM ${store.table("inventory")} WHERE player_id=$1 AND item_type='gem' AND item_category='currency' FOR UPDATE`, [playerId]);
                gemsBefore = Number(balance.rows[0].amount);
                gemsAfter = gemsBefore + changed.gemDelta;
                if (gemsAfter === null || !Number.isSafeInteger(gemsAfter) || gemsAfter < 0 || gemsAfter > Number(balance.rows[0].stack_limit))
                    throw new Error("Gem balance cannot accept this reward yet. Your letter is still ready.");
                await client.query(`UPDATE ${store.table("inventory")} SET amount=$2,row_version=row_version+1,updated_at=now() WHERE player_id=$1 AND item_type='gem' AND item_category='currency'`, [playerId, gemsAfter]);
                const item = await client.query(`INSERT INTO ${store.table("item_transactions")} (player_id,source,action,item_type,item_category,delta,before_amount,after_amount,request_id,metadata) VALUES($1,'quest','quest_reward','gem','currency',$2,$3,$4,$5,$6::jsonb) RETURNING item_transaction_id`, [playerId, changed.gemDelta, gemsBefore, gemsAfter, entry.request_id, JSON.stringify({ receipts: changed.receipts.map((r) => r.id) })]);
                itemTransactionId = item.rows[0].item_transaction_id;
                const ledger = await client.query(`INSERT INTO ${store.table("gem_ledger")} (player_id,delta,reason,ref_type,ref_id,before_balance,after_balance,metadata) VALUES($1,$2,'quest_reward','quest',$3,$4,$5,$6::jsonb) RETURNING gem_ledger_id`, [playerId, changed.gemDelta, entry.request_id, gemsBefore, gemsAfter, JSON.stringify({ receipts: changed.receipts.map((r) => r.id) })]);
                gemLedgerId = ledger.rows[0].gem_ledger_id;
            }
            let stamps = Number(before.stamps || 0);
            for (const receipt of changed.receipts) {
                const after = stamps + receipt.stamps;
                // Unique receipt is the durable cross-restart and cross-server reward guard.
                await client.query(`INSERT INTO ${store.table("quest_receipts")} (player_id,receipt_id,request_id,reward_day,gems,stamps,stamps_before,stamps_after,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [playerId, receipt.id, entry.request_id, receipt.day ?? null, receipt.gems, receipt.stamps, stamps, after, JSON.stringify(receipt)]);
                stamps = after;
            }
            if (changed.receipts.length) {
                const inventoryAfterHash = changed.gemDelta ? await store.updatePlayerInventoryHash(client, playerId) : null;
                await store.recordTransactionLedger(client, { transaction_type: changed.gemDelta ? "QUEST_REWARD" : "QUEST_COSMETIC", player_id: playerId,
                    source: "quest", action: entry.action, status: "success", item_type: changed.gemDelta ? "gem" : "dispatch_stamps", item_category: "currency",
                    quantity: changed.gemDelta || changed.receipts.reduce((n, r) => n + r.stamps, 0), gems_before: gemsBefore, gems_after: gemsAfter,
                    gem_ledger_id: gemLedgerId, item_transaction_id: itemTransactionId, request_id: entry.request_id,
                    ip_address: entry.ip_address, user_agent: entry.user_agent,
                    inventory_before_hash: inventoryBeforeHash, inventory_after_hash: inventoryAfterHash,
                    metadata: { receipts: changed.receipts, stamps_before: before.stamps || 0, stamps_after: changed.state.stamps } });
            }
            await client.query(`UPDATE ${store.table("quest_accounts")} SET state=$2::jsonb,updated_at=now() WHERE player_id=$1`, [playerId, JSON.stringify(changed.state)]);
            return { ok: true, board: changed.board, message: changed.message, receipts: changed.receipts, gems: gemsAfter };
        }, "quest_operation", `quest:${username.toLowerCase()}`);
        return result || { ok: false, message: "The Dispatch could not save your letter. Please try again." };
    }
    catch (error) {
        // withTransaction rolls back on every thrown failure, including reward capacity.
        return { ok: false, message: error?.code ? "The Dispatch could not save your letter. Please refresh and try again." : String(error?.message || "Quest request failed.") };
    }
}
module.exports = { ensureSchema, apply };
