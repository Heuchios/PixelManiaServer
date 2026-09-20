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
exports.ensureSchema = ensureSchema;
exports.quotes = quotes;
exports.lockSale = lockSale;
exports.commitLocal = commitLocal;
const Market = __importStar(require("./server_fish_market"));
const ItemDatabase = require("./server_item_database");
const PostgresContracts = require("./postgres_store_contracts");
const localRows = new Map();
async function ensureSchema(store) {
    // A separate schema transaction works during startup, before isReady() is true.
    const client = await store.db.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('pixelmania-fish-kilograms-v1'))");
        await client.query(`CREATE TABLE IF NOT EXISTS ${store.table("fish_market")} (
      item_id text PRIMARY KEY, supply double precision NOT NULL CHECK (supply >= 0),
      updated_ms bigint NOT NULL, revision bigint NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS ${store.table("fish_weight_migrations")} (
      version integer PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS ${store.table("fish_market_receipts")} (
      player_id uuid NOT NULL REFERENCES ${store.table("players")}(player_id), request_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (player_id, request_id));`);
        const migrated = await client.query(`SELECT version FROM ${store.table("fish_weight_migrations")} WHERE version = 1`);
        if (!migrated.rowCount) {
            const players = await client.query(`SELECT DISTINCT player_id FROM ${store.table("inventory")} WHERE item_category = 'fish' AND amount > 0`);
            await client.query(`INSERT INTO ${store.table("item_transactions")}
        (player_id, source, action, item_type, item_category, delta, before_amount, after_amount, metadata)
        SELECT player_id, 'system', 'fish_kilogram_migration', item_type, item_category, amount * 9, amount, amount * 10,
        '{"from_unit":"count","to_unit":"tenths_kg","kg_per_existing_fish":1}'::jsonb
        FROM ${store.table("inventory")} WHERE item_category = 'fish' AND amount > 0`);
            await client.query(`UPDATE ${store.table("inventory")} SET amount = amount * 10,
        stack_limit = GREATEST(20000, amount * 10), row_version = row_version + 1, updated_at = now()
        WHERE item_category = 'fish'`);
            for (const row of players.rows) {
                await store.updatePlayerInventoryHash(client, row.player_id, await store.getInventorySnapshotHash(client, row.player_id));
                await store.recordTransactionLedger(client, { player_id: row.player_id, source: "system",
                    action: "fish_kilogram_migration", transaction_type: "FISH_WEIGHT_MIGRATION", status: "success",
                    metadata: { from_unit: "count", to_unit: Market.UNIT, kg_per_existing_fish: 1 } });
            }
            const isFish = (id) => ItemDatabase.getItemDefinition(id)?.category === "fish";
            const worlds = await client.query(`SELECT world_id, world_state FROM ${store.table("worlds")} WHERE world_state <> '{}'::jsonb FOR UPDATE`);
            for (const row of worlds.rows) {
                const before = JSON.parse(JSON.stringify(row.world_state));
                if (!Market.migrateWorldHoldings(row.world_state, isFish))
                    continue;
                const checksumState = { ...row.world_state };
                delete checksumState.saved_at;
                delete checksumState.last_saved_at;
                await client.query(`UPDATE ${store.table("worlds")} SET world_state = $2::jsonb, world_checksum = $3 WHERE world_id = $1`, [row.world_id, JSON.stringify(row.world_state), PostgresContracts.jsonChecksum(checksumState)]);
                await store.insertWorldObjectChange(client, row.world_id, { object_type: "fish_weight_migration", action: "update",
                    source_type: "system", reason: "fish_kilogram_migration", old_data: before, new_data: row.world_state });
            }
            await client.query(`UPDATE ${store.table("world_drops")} SET amount = amount * 10,
        metadata = metadata || '{"inventory_unit":"tenths_kg","migration":"fish_kilograms_v1"}'::jsonb
        WHERE item_category = 'fish' AND status = 'active'`);
            await client.query(`INSERT INTO ${store.table("fish_weight_migrations")} (version) VALUES (1)`);
        }
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
async function quotes(store, ids, now = Date.now()) {
    const result = {};
    const stored = new Map();
    if (store && ids.length) {
        const validIds = [...new Set(ids)].filter(id => ItemDatabase.getItemDefinition(id)?.category === "fish").sort();
        const targets = validIds.map(id => Market.policy(ItemDatabase.getItemDefinition(id)).target);
        await store.db.query(`INSERT INTO ${store.table("fish_market")} (item_id, supply, updated_ms)
      SELECT id, target, $3 FROM unnest($1::text[], $2::double precision[]) AS seed(id, target)
      ON CONFLICT (item_id) DO NOTHING`, [validIds, targets, now]);
        const query = await store.db.query(`SELECT * FROM ${store.table("fish_market")} WHERE item_id = ANY($1::text[])`, [validIds]);
        for (const row of query.rows)
            stored.set(row.item_id, { ...row, revision: Number(row.revision), updated_ms: Number(row.updated_ms) });
    }
    for (const id of [...new Set(ids)].sort()) {
        const definition = ItemDatabase.getItemDefinition(id);
        if (!definition || definition.category !== "fish" || definition.hidden)
            continue;
        const settings = Market.policy(definition);
        let row;
        if (store) {
            row = stored.get(id);
        }
        else {
            row = localRows.get(id) || { item_id: id, supply: settings.target, updated_ms: now, revision: 0 };
            localRows.set(id, row);
        }
        result[id] = Market.quote(row, settings, now);
    }
    return result;
}
async function lockSale(store, client, metadata, deltas, playerId = "", requestId = "") {
    if (playerId && requestId) {
        const receipt = await client.query(`INSERT INTO ${store.table("fish_market_receipts")} (player_id, request_id)
      VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING request_id`, [playerId, requestId]);
        if (!receipt.rowCount)
            throw new Error("This fish sale was already completed.");
    }
    const lines = metadata.fish_market_sales;
    if (!Array.isArray(lines) || !lines.length)
        throw new Error("Missing fish market sale");
    const seen = new Set();
    for (const line of [...lines].sort((a, b) => a.item_id.localeCompare(b.item_id))) {
        if (seen.has(line.item_id))
            throw new Error("Duplicate fish sale");
        seen.add(line.item_id);
        const query = await client.query(`SELECT * FROM ${store.table("fish_market")} WHERE item_id = $1 FOR UPDATE`, [line.item_id]);
        const row = query.rows[0];
        if (!row || Number(row.revision) !== line.revision)
            throw new Error("Fish market changed. Refresh prices and try again.");
        const definition = ItemDatabase.getItemDefinition(line.item_id);
        if (!definition || definition.category !== "fish" || definition.hidden)
            throw new Error("Invalid fish");
        const price = Market.quote(row, Market.policy(definition), line.quoted_ms);
        if (price.price_cents !== line.price_cents || !deltas.some(d => d.item_type === line.item_id && d.item_category === "fish" && d.delta === -line.amount))
            throw new Error("Invalid fish quote");
        // This write rolls back with inventory, gem ledger, and transaction ledger on any failure.
        await client.query(`UPDATE ${store.table("fish_market")} SET supply = $2, updated_ms = $3, revision = revision + 1 WHERE item_id = $1`, [line.item_id, price.supply + line.amount, line.quoted_ms]);
    }
    if (deltas.filter(d => d.item_category === "fish").length !== lines.length ||
        !deltas.some(d => d.item_type === "gem" && d.item_category === "currency" && d.delta === Market.saleValue(lines)))
        throw new Error("Invalid fish payout");
}
function commitLocal(lines) {
    for (const line of lines)
        localRows.set(line.item_id, {
            item_id: line.item_id, supply: line.supply + line.amount, updated_ms: line.quoted_ms, revision: line.revision + 1,
        });
}
