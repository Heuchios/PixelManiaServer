"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.retireOldLineup = retireOldLineup;
const Catalog = __importStar(require("./server_fishing_catalog"));
const Contracts = require("./postgres_store_contracts");
// Called inside the fish-schema transaction and advisory lock, before legacy migrations.
async function retireOldLineup(store, client) {
    const done = await client.query(`SELECT version FROM ${store.table("fish_weight_migrations")} WHERE version = 3`);
    if (done.rowCount)
        return;
    const ids = Catalog.INITIAL_REMOVAL_IDS;
    const players = await client.query(`SELECT player_id, player_state FROM ${store.table("players")} FOR UPDATE`);
    const holdings = await client.query(`SELECT * FROM ${store.table("inventory")} WHERE item_type=ANY($1::text[]) AND item_category IN ('fish','lure') FOR UPDATE`, [ids]);
    for (const row of holdings.rows) {
        await client.query(`INSERT INTO ${store.table("item_transactions")}
      (player_id,source,action,item_type,item_category,delta,before_amount,after_amount,metadata)
      VALUES ($1,'system','fishing_catalog_v3',$2,$3,$4,$5,0,'{"reason":"retired_fishing_lineup"}'::jsonb)`, [row.player_id, row.item_type, row.item_category, -Number(row.amount), Number(row.amount)]);
        await store.recordTransactionLedger(client, { player_id: row.player_id, source: "system", action: "fishing_catalog_v3",
            transaction_type: "FISHING_CATALOG_RETIREMENT", status: "success", metadata: { item_type: row.item_type, item_category: row.item_category, removed_amount: Number(row.amount) } });
    }
    await client.query(`DELETE FROM ${store.table("inventory")} WHERE item_type=ANY($1::text[]) AND item_category IN ('fish','lure')`, [ids]);
    for (const row of players.rows) {
        const state = row.player_state || {};
        Catalog.migratePlayer(state);
        await client.query(`UPDATE ${store.table("players")} SET player_state=$2::jsonb WHERE player_id=$1`, [row.player_id, JSON.stringify(state)]);
        await store.updatePlayerInventoryHash(client, row.player_id, await store.getInventorySnapshotHash(client, row.player_id));
    }
    const instances = await client.query(`SELECT * FROM ${store.table("item_instances")} WHERE item_type=ANY($1::text[]) AND item_category IN ('fish','lure') AND state NOT IN ('destroyed','consumed') FOR UPDATE`, [ids]);
    for (const row of instances.rows) {
        await client.query(`UPDATE ${store.table("item_instances")} SET state='destroyed',owner_player_id=NULL,current_location='system',updated_at=now() WHERE item_instance_id=$1`, [row.item_instance_id]);
        await store.recordItemInstanceEvent(client, { item_instance_id: row.item_instance_id, event_type: "retired", from_player_id: row.owner_player_id,
            from_location: row.current_location, to_location: "system", world_id: row.world_id, source: "system", metadata: { reason: "fishing_catalog_v3" } });
    }
    const worlds = await client.query(`SELECT world_id,world_state FROM ${store.table("worlds")} WHERE world_state <> '{}'::jsonb FOR UPDATE`);
    for (const row of worlds.rows) {
        const before = JSON.parse(JSON.stringify(row.world_state));
        if (!Catalog.pruneHoldings(row.world_state, true))
            continue;
        const checksum = { ...row.world_state };
        delete checksum.saved_at;
        delete checksum.last_saved_at;
        await client.query(`UPDATE ${store.table("worlds")} SET world_state=$2::jsonb,world_checksum=$3 WHERE world_id=$1`, [row.world_id, JSON.stringify(row.world_state), Contracts.jsonChecksum(checksum)]);
        await store.insertWorldObjectChange(client, row.world_id, { object_type: "fishing_catalog", action: "update", source_type: "system", reason: "fishing_catalog_v3", old_data: before, new_data: row.world_state });
    }
    await client.query(`UPDATE ${store.table("world_drops")} SET status='removed',metadata=metadata || '{"reason":"fishing_catalog_v3"}'::jsonb WHERE item_type=ANY($1::text[]) AND item_category IN ('fish','lure') AND status='active'`, [ids]);
    await client.query(`DELETE FROM ${store.table("fish_market")} WHERE item_id=ANY($1::text[])`, [ids]);
    await client.query(`INSERT INTO ${store.table("fish_weight_migrations")} (version) VALUES (3)`);
}
