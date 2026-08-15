// Generated from src/postgres_store.ts. Do not edit by hand.
/// <reference path="../types/pixelmania-contracts.d.ts" />
"use strict";
const fs = require("fs");
const crypto = require("crypto");
const net = require("net");
const path = require("path");
const DropContracts = require("./server_drop_contracts");
const InventoryContracts = require("./server_inventory_contracts");
const PostgresContracts = require("./postgres_store_contracts");
const ItemDatabase = require("./server_item_database");
let PoolClass = null;
try {
    PoolClass = require("pg").Pool;
}
catch {
    PoolClass = null;
}
const INVENTORY_FIELD_CATEGORY = Object.freeze([
    ["inventory", "block"],
    ["seed_inventory", "seed"],
    ["tool_inventory", "tool"],
    ["back_inventory", "back"],
    ["hat_inventory", "hat"],
    ["hair_inventory", "hair"],
    ["eyewear_inventory", "eyewear"],
    ["beard_inventory", "beard"],
    ["shirt_inventory", "shirt"],
    ["pants_inventory", "pants"],
    ["shoes_inventory", "shoes"],
    ["ride_inventory", "ride"],
    ["currency_inventory", "currency"],
    ["material_inventory", "material"],
    ["lure_inventory", "lure"],
    ["fish_inventory", "fish"],
]);
const INVENTORY_FIELD_BY_CATEGORY = new Map(INVENTORY_FIELD_CATEGORY.map(([field, category]) => [category, field]));
const PLAYER_LEVEL_MIN = 1;
const PLAYER_LEVEL_MAX = 100;
const PLAYER_XP_FIRST_LEVEL = 300;
// Column counts for the world-change writers. The single-row and batched writers build
// their placeholder tuples from these, so the column list and the parameter arity can
// never drift apart.
const WORLD_BLOCK_CHANGE_COLUMN_COUNT = 13;
const WORLD_OBJECT_CHANGE_COLUMN_COUNT = 15;
// Postgres caps a statement at 65535 bind parameters. 100 rows x 15 columns = 1500, which
// keeps the batched statement far inside that limit while still collapsing the common
// "hundreds of changes in one save" case into a handful of round trips.
const WORLD_CHANGE_INSERT_BATCH_MAX_ROWS = 100;
// Write-ordering scopes. See PostgresStore.enqueueWrite.
//
// Writes sharing a scope string stay strictly ordered relative to each other, exactly as the
// old single global queue ordered everything. Writes in different scopes may now run
// concurrently (bounded by the pg pool). Anything that does not pass an explicit scope keeps
// using the shared global chain, so this is opt-in per call site.
const POSTGRES_GLOBAL_WRITE_SCOPE = "global";
function postgresWorldWriteScope(worldName) {
    const clean = cleanName(worldName || "");
    return clean === "" ? POSTGRES_GLOBAL_WRITE_SCOPE : `world:${clean.toLowerCase()}`;
}
function postgresPlayerWriteScope(username) {
    const clean = cleanName(username || "");
    return clean === "" ? POSTGRES_GLOBAL_WRITE_SCOPE : `player:${clean.toLowerCase()}`;
}
const POSTGRES_TRANSACTION_MAX_ATTEMPTS = 5;
const POSTGRES_TRANSACTION_RETRY_BASE_DELAY_MS = 75;
const POSTGRES_INIT_MAX_ATTEMPTS = 5;
const POSTGRES_INIT_RETRY_BASE_DELAY_MS = 250;
const POSTGRES_READ_MAX_ATTEMPTS = 5;
const POSTGRES_READ_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_INVENTORY_STACK_LIMIT = ItemDatabase.DEFAULT_STACK_LIMIT || 400;
const MAX_INVENTORY_STACK_LIMIT = ItemDatabase.GEM_CURRENCY_STACK_LIMIT || 100000000000;
const ITEM_INSTANCE_TRACKED_CATEGORIES = new Set(["tool", "back", "hat", "hair", "eyewear", "shirt", "pants", "shoes", "ride"]);
const ITEM_INSTANCE_ACTIVE_STATE = "active";
const ITEM_INSTANCE_RETIRED_STATE = "consumed";
const ITEM_INSTANCE_STATES = new Set(["active", "consumed", "traded", "destroyed", "dropped", "locked"]);
const ITEM_INSTANCE_LOCATIONS = new Set(["inventory", "vending", "trade", "world_drop", "safe", "donation_box", "display", "shop", "admin", "system", "unknown"]);
const ITEM_INSTANCE_EVENT_TYPES = new Set(["created", "reconciled", "owner_changed", "location_changed", "state_changed", "updated", "retired"]);
const ITEM_INSTANCE_RECONCILE_MAX_PER_ITEM = 250;
const ITEM_INSTANCE_VAGUE_CREATION_SOURCES = new Set(["", "system", "unknown", "item_ledger", "inventory_delta", "update"]);
const TRANSACTION_LEDGER_STATUSES = new Set(["success", "failed", "reversed"]);
const INTEGRITY_HASH_ALGORITHM = "sha256:v1";
const MAX_WORLD_DROP_AMOUNT = 2000;
const PUNISHMENT_TYPES = new Set(["ban", "mute", "trade_ban", "world_ban", "lockout"]);
const PUNISHMENT_SCOPES = new Set(["global", "world"]);
const WORLD_OBJECT_CHANGE_DIFF_LIMIT = 500;
const WORLD_OBJECT_CHANGE_ACTIONS = new Set([
    "wooden_entrance_state",
    "door_state",
    "door_move",
    "sign_text",
    "ceiling_lamp_state",
    "world_lock_state",
    "vend_state",
    "vending_list",
    "vending_buy",
    "vending_collect",
    "vending_cancel",
    "vending_break_return",
    "safe_state",
    "safe_deposit",
    "safe_withdraw",
    "safe_break_return",
    "donation_box_state",
    "donation_box_donate",
    "donation_box_retrieve",
    "donation_box_retrieve_all",
    "donation_box_break_return",
    "mailbox_state",
    "bulletin_board_state",
    "display_state",
    "display_deposit",
    "display_withdraw",
    "display_break_return",
    "tackle_box_state",
    "tackle_box_harvest",
    "tackle_box_drop",
    "duck_state",
    "duck_feed",
    "duck_harvest",
    "duck_drop",
    "duck_decay",
    "water_well_harvest",
    "water_well_drop",
    "dice_roll",
    "anti_punch_state",
    "anti_talk_state",
    "anti_gravity_state",
    "theme_machine_state",
    "cctv_state",
]);
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function postgresError(error) {
    if (error instanceof Error)
        return error;
    const normalized = new Error(String(error || "Unknown PostgreSQL error"));
    if (error && typeof error === "object") {
        const details = error;
        for (const field of ["code", "column", "constraint", "detail", "schema", "table"]) {
            const value = cleanName(details[field]);
            if (value !== "")
                normalized[field] = value;
        }
    }
    return normalized;
}
function getErrorMessage(error) {
    return postgresError(error).message;
}
function getErrorCode(error) {
    return cleanName(postgresError(error).code);
}
function isRetryablePostgresError(error) {
    const code = getErrorCode(error);
    if (code === "40P01" || code === "40001" || code === "55P03")
        return true;
    const message = getErrorMessage(error).toLowerCase();
    return message.includes("tuple concurrently updated")
        || message.includes("could not serialize access due to concurrent update");
}
function postgresOperationCanContinue(details) {
    if (typeof details?.shouldContinue !== "function")
        return true;
    try {
        return details.shouldContinue() !== false;
    }
    catch {
        return false;
    }
}
function assertPostgresOperationCanContinue(details) {
    if (postgresOperationCanContinue(details))
        return;
    const error = new Error("PostgreSQL operation aborted because its requester disconnected");
    error.code = "PIXELMANIA_OPERATION_ABORTED";
    throw error;
}
function isPostgresOperationAborted(error) {
    return getErrorCode(error) === "PIXELMANIA_OPERATION_ABORTED";
}
function makeTrackedItemMovementError(result = {}) {
    const reason = cleanName(result.reason || "tracked_item_instance_movement_failed");
    const error = new Error(cleanName(result.message || reason) || "tracked_item_instance_movement_failed");
    error.name = "TrackedItemMovementError";
    error.isTrackedItemMovementError = true;
    error.result = {
        ok: false,
        reason,
        ...toObject(result),
    };
    return error;
}
function resultForTrackedItemMovementError(error, fallbackReason = "tracked_item_instance_movement_failed") {
    const trackedError = error;
    if (trackedError && trackedError.isTrackedItemMovementError) {
        return {
            ok: false,
            reason: fallbackReason,
            ...toObject(trackedError.result),
        };
    }
    return null;
}
function toObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function toInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.trunc(parsed);
}
function cleanName(value) {
    return String(value || "").trim();
}
function normalizeWorldRevision(value) {
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 0)
        return 0;
    return revision;
}
function normalizeWorldPersistenceMetadata(value, worldState = {}) {
    const metadata = toObject(value);
    return {
        require_owner: metadata.require_owner === true,
        server_instance: cleanName(metadata.server_instance || metadata.server_instance_id || ""),
        ownership_token: cleanName(metadata.ownership_token || ""),
        ownership_epoch: normalizeWorldRevision(metadata.ownership_epoch),
        requested_revision: normalizeWorldRevision(metadata.requested_revision ?? worldState.world_revision),
    };
}
function worldStateForPersistenceChecksum(value) {
    const state = clonePlainJson(safeJson(value));
    delete state.saved_at;
    delete state.last_saved_at;
    return state;
}
function worldPersistenceChecksum(value) {
    return jsonChecksum(worldStateForPersistenceChecksum(value));
}
function normalizeDbRole(value) {
    const role = cleanName(value).toLowerCase();
    if (role === "developer")
        return "admin";
    if (role === "mod")
        return "moderator";
    if (role === "player" || role === "moderator" || role === "designer" || role === "admin" || role === "owner")
        return role;
    return "player";
}
function normalizeOptionalTimestamp(value) {
    return PostgresContracts.normalizeOptionalTimestamp(value);
}
function jsonChecksum(value) {
    return PostgresContracts.jsonChecksum(value);
}
function stableNormalizeForHash(value) {
    return PostgresContracts.stableNormalizeForHash(value);
}
function stableJsonStringify(value) {
    return PostgresContracts.stableJsonStringify(value);
}
function integrityHash(value) {
    return PostgresContracts.integrityHash(value);
}
function ledgerNullableId(value) {
    return PostgresContracts.ledgerNullableId(value);
}
function ledgerNullableInteger(value) {
    return PostgresContracts.ledgerNullableInteger(value);
}
function buildTransactionLedgerHashPayload(entry = {}) {
    return PostgresContracts.buildTransactionLedgerHashPayload(entry);
}
function buildTransactionLedgerHash(entry = {}) {
    return PostgresContracts.buildTransactionLedgerHash(entry);
}
function clampStackLimit(value, fallback = DEFAULT_INVENTORY_STACK_LIMIT) {
    return PostgresContracts.clampStackLimit(value, fallback);
}
function getInventoryStackLimitForItem(itemType, fallback = DEFAULT_INVENTORY_STACK_LIMIT) {
    return PostgresContracts.getInventoryStackLimitForItem(itemType, fallback);
}
function resolveItemCategory(itemType, itemCategory = "") {
    return PostgresContracts.resolveItemCategory(itemType, itemCategory);
}
function applyCanonicalInventoryRowsToPlayerState(rawState, inventoryRows = []) {
    const state = { ...toObject(rawState) };
    for (const [field] of INVENTORY_FIELD_CATEGORY) {
        state[field] = {};
    }
    const rows = Array.isArray(inventoryRows) ? inventoryRows : [];
    for (const rawRow of rows) {
        const row = toObject(rawRow);
        const itemType = cleanName(row.item_type || "");
        const itemCategory = resolveItemCategory(itemType, row.item_category || "");
        const inventoryField = INVENTORY_FIELD_BY_CATEGORY.get(itemCategory);
        const amount = Math.max(0, toInt(row.amount, 0));
        if (itemType === "" || !inventoryField || amount <= 0)
            continue;
        state[inventoryField][itemType] = amount;
    }
    state.fish_inventory_unit = "count";
    return state;
}
/**
 * @param {PixelMania.WorldDropPayloadInput | Record<string, unknown>} drop
 * @param {PixelMania.WorldDropPayloadInput | Record<string, unknown>} fallback
 * @returns {PixelMania.NormalizedWorldDropPayload | null}
 */
function normalizeWorldDropPayload(drop = {}, fallback = {}) {
    return PostgresContracts.normalizeWorldDropPayload(drop, fallback);
}
/**
 * @param {PixelMania.WorldDropRowInput | Record<string, unknown>} row
 * @returns {PixelMania.ActiveWorldDropPayload}
 */
function worldDropRowToPayload(row = {}) {
    return PostgresContracts.worldDropRowToPayload(row);
}
function worldLockRowToPayload(row = {}) {
    return PostgresContracts.worldLockRowToPayload(row);
}
function shouldTrackItemInstance(itemType, itemCategory = "") {
    return PostgresContracts.shouldTrackItemInstance(itemType, itemCategory);
}
function normalizeItemInstanceState(value, fallback = ITEM_INSTANCE_ACTIVE_STATE) {
    return PostgresContracts.normalizeItemInstanceState(value, fallback);
}
function normalizeItemInstanceLocation(value, fallback = "inventory") {
    return PostgresContracts.normalizeItemInstanceLocation(value, fallback);
}
function normalizeItemInstanceSource(value, fallback = "system") {
    return PostgresContracts.normalizeItemInstanceSource(value, fallback);
}
function isVagueItemInstanceCreationSource(value) {
    return PostgresContracts.isVagueItemInstanceCreationSource(value);
}
/**
 * Server-authored world drops (block breaks, harvests, server rewards) are minted by
 * the server itself, so their tracked item instances can be safely rebuilt from the
 * authoritative world_drops row when they are missing.
 *
 * Drops that came out of a player's inventory must never be rebuilt: their tracked
 * rows are the player's own PM-ITEM instances moved into 'world_drop', and minting
 * replacements would duplicate real items.
 *
 * @param {unknown} source
 * @param {unknown} action
 * @returns {boolean}
 */
function isServerAuthoredWorldDropOrigin(source, action) {
    const cleanSource = cleanName(source).toLowerCase();
    const cleanAction = cleanName(action).toLowerCase();
    if (cleanSource === "" && cleanAction === "")
        return false;
    if (cleanSource.includes("drop_inventory") || cleanSource.includes("world_item_drop_create"))
        return false;
    if (cleanAction.includes("drop_inventory") || cleanAction.includes("world_item_drop_create"))
        return false;
    if (cleanSource.includes("world_block_break") ||
        cleanSource.includes("world_block_update") ||
        cleanSource.includes("seed_harvest") ||
        cleanSource.includes("server")) {
        return true;
    }
    return cleanAction === "break_drop" || cleanAction === "harvest_drop";
}
function normalizeTransactionLedgerStatus(value, fallback = "success") {
    return PostgresContracts.normalizeTransactionLedgerStatus(value, fallback);
}
function normalizeTransactionLedgerType(entry = {}) {
    return PostgresContracts.normalizeTransactionLedgerType(entry);
}
function normalizeItemInstanceEventType(value, fallback = "updated") {
    return PostgresContracts.normalizeItemInstanceEventType(value, fallback);
}
function generatePublicItemInstanceId() {
    return PostgresContracts.generatePublicItemInstanceId();
}
function extractItemInstanceSource(details, fallback = "system") {
    return PostgresContracts.extractItemInstanceSource(details, fallback);
}
function summarizeItemInstanceEventMetadata(value) {
    return PostgresContracts.summarizeItemInstanceEventMetadata(value);
}
function normalizePunishmentType(value) {
    return PostgresContracts.normalizePunishmentType(value);
}
function normalizePunishmentScope(value) {
    return PostgresContracts.normalizePunishmentScope(value);
}
function normalizePunishmentEndsAt(entry) {
    return PostgresContracts.normalizePunishmentEndsAt(entry);
}
function defaultEmailForUsername(username) {
    return PostgresContracts.defaultEmailForUsername(username);
}
function getXpNeededForLevel(level) {
    return PostgresContracts.getXpNeededForLevel(level);
}
function getCumulativeXpAtLevel(level) {
    return PostgresContracts.getCumulativeXpAtLevel(level);
}
function getPlayerTitleForLevel(level) {
    return PostgresContracts.getPlayerTitleForLevel(level);
}
function normalizeProgressionState(state) {
    return PostgresContracts.normalizeProgressionState(state);
}
function safeJson(value) {
    return PostgresContracts.safeJson(value);
}
function clonePlainJson(value) {
    return PostgresContracts.clonePlainJson(value);
}
function stableJsonForCompare(value) {
    return PostgresContracts.stableJsonForCompare(value);
}
function stableJsonString(value) {
    return PostgresContracts.stableJsonString(value);
}
function normalizeWorldObjectAction(value) {
    return PostgresContracts.normalizeWorldObjectAction(value);
}
function normalizeWorldObjectType(entry = {}) {
    return PostgresContracts.normalizeWorldObjectType(entry);
}
function normalizeWorldObjectId(entry = {}, worldName = "", objectType = "") {
    return PostgresContracts.normalizeWorldObjectId(entry, worldName, objectType);
}
function shouldTreatAsWorldObjectChange(entry = {}) {
    return PostgresContracts.shouldTreatAsWorldObjectChange(entry);
}
function extractWorldObjectJournalMap(worldState = {}, fallbackWorldName = "") {
    return PostgresContracts.extractWorldObjectJournalMap(worldState, fallbackWorldName);
}
function isUuid(value) {
    return PostgresContracts.isUuid(value);
}
function normalizeLedgerSource(value) {
    return PostgresContracts.normalizeLedgerSource(value);
}
function normalizeSecuritySeverity(value) {
    return PostgresContracts.normalizeSecuritySeverity(value);
}
function normalizeIp(value) {
    return PostgresContracts.normalizeIp(value);
}
class PostgresStore {
    /**
     * @param {PixelMania.PostgresStoreOptions} options
     */
    constructor(options = {}) {
        const schema = cleanName(options.schema || "pixelmania");
        this.schema = /^[A-Za-z_][A-Za-z0-9_]*$/.test(schema) ? schema.toLowerCase() : "pixelmania";
        this.enabled = Boolean(options.enabled);
        this.logger = typeof options.logger === "function" ? options.logger : ((...args) => console.warn(...args));
        this.ready = false;
        this.degraded = false;
        this.initialized = false;
        this.progressionReady = false;
        this.pool = null;
        this.bootstrapSqlPath = cleanName(options.bootstrapSqlPath || "");
        this.autoBootstrap = Boolean(options.autoBootstrap);
        this.writeQueue = Promise.resolve();
        this.scopedWriteQueues = new Map();
        this.writeQueueDepth = 0;
        this.maxWriteQueueDepth = Math.max(100, toInt(options.maxWriteQueueDepth, 1000));
        // Diagnostic only: logs when a write's total time (queue wait + exec) crosses this, so we
        // can see whether a slow write is stuck behind other work in the single global FIFO queue
        // (queue_wait_ms) or is itself just a big transaction (exec_ms). 0 disables the log entirely.
        this.slowWriteLogThresholdMs = Math.max(0, toInt(options.slowWriteLogThresholdMs, 250));
        // Per-transaction identity memo. ensurePlayerIdentity costs two upserts, and the write
        // path calls it repeatedly for the SAME actor inside one transaction -- once per world
        // change entry, once per world-lock member per pass, and so on. Scoped strictly to one
        // in-flight transaction on one pooled client, because a ROLLBACK undoes the row creation
        // and the client is then handed straight to an unrelated transaction.
        this.identityCacheByClient = new WeakMap();
        if (!this.enabled)
            return;
        if (!PoolClass) {
            this.enabled = false;
            this.logger("[postgres] disabled because package 'pg' is not installed.");
            return;
        }
        this.pool = new PoolClass({
            connectionString: cleanName(options.connectionString || ""),
            host: cleanName(options.host || ""),
            port: options.port ? toInt(options.port, 5432) : undefined,
            database: cleanName(options.database || ""),
            user: cleanName(options.user || ""),
            password: String(options.password || ""),
            ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
            max: options.poolMax ? toInt(options.poolMax, 10) : 10,
            idleTimeoutMillis: options.idleTimeoutMs ? toInt(options.idleTimeoutMs, 30000) : 30000,
            connectionTimeoutMillis: options.connectTimeoutMs ? toInt(options.connectTimeoutMs, 8000) : 8000,
        });
    }
    isReady() {
        return Boolean(this.enabled && this.pool && this.ready && !this.degraded);
    }
    get db() {
        if (!this.pool) {
            throw new Error("PostgreSQL pool is not available");
        }
        return this.pool;
    }
    table(name) {
        return `"${this.schema}"."${name}"`;
    }
    async queryReadWithRetry(label, query, values = []) {
        const cleanLabel = cleanName(label || "read") || "read";
        for (let attempt = 1; attempt <= POSTGRES_READ_MAX_ATTEMPTS; attempt += 1) {
            try {
                return await this.db.query(query, values);
            }
            catch (error) {
                if (!isRetryablePostgresError(error) || attempt >= POSTGRES_READ_MAX_ATTEMPTS) {
                    throw error;
                }
                const retryDelay = POSTGRES_READ_RETRY_BASE_DELAY_MS * attempt;
                this.logger(`[postgres] ${cleanLabel} attempt ${attempt} hit a transient database conflict; retrying in ${retryDelay}ms.`, getErrorMessage(error));
                await delay(retryDelay);
            }
        }
        throw new Error(`PostgreSQL ${cleanLabel} retry loop exited unexpectedly`);
    }
    async init() {
        if (!this.enabled || !this.pool)
            return;
        if (this.initialized)
            return;
        this.initialized = true;
        for (let attempt = 1; attempt <= POSTGRES_INIT_MAX_ATTEMPTS; attempt += 1) {
            try {
                await this.db.query("SELECT 1");
                if (this.autoBootstrap && this.bootstrapSqlPath !== "") {
                    await this.applyBootstrapSql(this.bootstrapSqlPath);
                }
                const schemaExists = await this.db.query("SELECT to_regnamespace($1) AS oid", [this.schema]);
                if (!schemaExists.rows[0] || !schemaExists.rows[0].oid) {
                    this.degraded = true;
                    this.logger(`[postgres] schema '${this.schema}' is missing. DB mirrors are disabled.`);
                    return;
                }
                const accountsTable = await this.db.query("SELECT to_regclass($1) AS oid", [`${this.schema}.accounts`]);
                if (!accountsTable.rows[0] || !accountsTable.rows[0].oid) {
                    this.degraded = true;
                    this.logger(`[postgres] table '${this.schema}.accounts' is missing. DB mirrors are disabled.`);
                    return;
                }
                try {
                    await this.ensureInventorySchema();
                }
                catch (error) {
                    if (isRetryablePostgresError(error) && attempt < POSTGRES_INIT_MAX_ATTEMPTS) {
                        throw error;
                    }
                    this.degraded = true;
                    this.logger("[postgres] inventory schema upgrade failed. DB mirrors are disabled.", getErrorMessage(error));
                    return;
                }
                try {
                    await this.ensurePersistenceSchema();
                }
                catch (error) {
                    if (isRetryablePostgresError(error) && attempt < POSTGRES_INIT_MAX_ATTEMPTS) {
                        throw error;
                    }
                    this.degraded = true;
                    this.logger("[postgres] persistence schema upgrade failed. DB authority is disabled.", getErrorMessage(error));
                    return;
                }
                try {
                    await this.ensureProgressionSchema();
                }
                catch (error) {
                    if (isRetryablePostgresError(error) && attempt < POSTGRES_INIT_MAX_ATTEMPTS) {
                        throw error;
                    }
                    this.progressionReady = false;
                    this.logger("[postgres] progression schema upgrade failed. Level mirrors are disabled.", getErrorMessage(error));
                }
                this.ready = true;
                this.degraded = false;
                this.logger(`[postgres] connected (schema=${this.schema}).`);
                return;
            }
            catch (error) {
                if (isRetryablePostgresError(error) && attempt < POSTGRES_INIT_MAX_ATTEMPTS) {
                    this.logger(`[postgres] initialization attempt ${attempt} failed; retrying.`, getErrorMessage(error));
                    await delay(POSTGRES_INIT_RETRY_BASE_DELAY_MS * attempt);
                    continue;
                }
                this.degraded = true;
                this.logger("[postgres] initialization failed. DB mirrors are disabled.", getErrorMessage(error));
                return;
            }
        }
    }
    async applyBootstrapSql(sqlPath) {
        const resolved = path.resolve(sqlPath);
        if (!fs.existsSync(resolved)) {
            this.logger(`[postgres] bootstrap SQL not found: ${resolved}`);
            return;
        }
        const sql = String(fs.readFileSync(resolved, "utf8") || "").trim();
        if (sql === "")
            return;
        await this.db.query(sql);
        this.logger(`[postgres] applied bootstrap SQL: ${resolved}`);
    }
    async ensureInventorySchema() {
        const inventoryTable = await this.db.query("SELECT to_regclass($1) AS oid", [`${this.schema}.inventory`]);
        if (!inventoryTable.rows[0] || !inventoryTable.rows[0].oid) {
            throw new Error(`table '${this.schema}.inventory' is missing`);
        }
        await this.db.query(`
      ALTER TABLE ${this.table("inventory")}
        ALTER COLUMN amount TYPE bigint USING amount::bigint,
        ALTER COLUMN stack_limit TYPE bigint USING stack_limit::bigint,
        ALTER COLUMN stack_limit SET DEFAULT 400;
    `);
        await this.db.query(`
      UPDATE ${this.table("inventory")}
         SET stack_limit = 400
       WHERE stack_limit = 200;
    `);
    }
    async ensurePersistenceSchema() {
        const requiredTables = [
            "players",
            "worlds",
            "world_snapshots",
            "world_locks",
            "world_members",
            "world_lock_access",
            "admin_actions",
            "item_instances",
            "punishments",
        ];
        for (const tableName of requiredTables) {
            const tableResult = await this.db.query("SELECT to_regclass($1) AS oid", [`${this.schema}.${tableName}`]);
            if (!tableResult.rows[0] || !tableResult.rows[0].oid) {
                throw new Error(`table '${this.schema}.${tableName}' is missing`);
            }
        }
        await this.db.query(`
      ALTER TABLE ${this.table("accounts")}
        ADD COLUMN IF NOT EXISTS password_salt text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS password_algorithm text NOT NULL DEFAULT 'legacy_scrypt',
        ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
        ADD COLUMN IF NOT EXISTS email_verification_token_hash text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS email_verification_expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS account_state jsonb NOT NULL DEFAULT '{}'::jsonb;

      ALTER TABLE ${this.table("accounts")}
        DROP CONSTRAINT IF EXISTS accounts_role_check,
        ADD CONSTRAINT accounts_role_check CHECK (role IN ('player', 'moderator', 'designer', 'admin', 'owner'));

      ALTER TABLE ${this.table("sessions")}
        ADD COLUMN IF NOT EXISTS refresh_token_hash text,
        ADD COLUMN IF NOT EXISTS refresh_expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS token_family uuid NOT NULL DEFAULT gen_random_uuid(),
        ADD COLUMN IF NOT EXISTS device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS session_mode text NOT NULL DEFAULT 'one_active',
        ADD COLUMN IF NOT EXISTS revoked_reason text,
        ADD COLUMN IF NOT EXISTS rotated_from_session_id uuid;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash
      ON ${this.table("sessions")}(refresh_token_hash)
      WHERE refresh_token_hash IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_sessions_refresh_expires_at
      ON ${this.table("sessions")}(refresh_expires_at);

      CREATE INDEX IF NOT EXISTS idx_sessions_token_family
      ON ${this.table("sessions")}(token_family);

      CREATE TABLE IF NOT EXISTS ${this.table("account_login_attempts")} (
        login_attempt_id bigserial PRIMARY KEY,
        account_id uuid REFERENCES ${this.table("accounts")}(account_id) ON DELETE SET NULL,
        username text NOT NULL DEFAULT '',
        action text NOT NULL DEFAULT 'login',
        success boolean NOT NULL DEFAULT false,
        reason text NOT NULL DEFAULT '',
        ip_address inet,
        user_agent text,
        device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
        request_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_account_login_attempts_username_time
      ON ${this.table("account_login_attempts")}(lower(username), created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_account_login_attempts_ip_time
      ON ${this.table("account_login_attempts")}(ip_address, created_at DESC)
      WHERE ip_address IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ${this.table("account_password_reset_requests")} (
        reset_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES ${this.table("accounts")}(account_id) ON DELETE CASCADE,
        username text NOT NULL DEFAULT '',
        email citext NOT NULL,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        ip_address inet,
        user_agent text,
        device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
        request_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_account_password_reset_requests_account_time
      ON ${this.table("account_password_reset_requests")}(account_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_account_password_reset_requests_token_active
      ON ${this.table("account_password_reset_requests")}(token_hash)
      WHERE used_at IS NULL;

      CREATE TABLE IF NOT EXISTS ${this.table("account_email_change_requests")} (
        email_change_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL REFERENCES ${this.table("accounts")}(account_id) ON DELETE CASCADE,
        username text NOT NULL DEFAULT '',
        old_email citext NOT NULL,
        new_email citext NOT NULL,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        ip_address inet,
        user_agent text,
        device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
        request_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_account_email_change_requests_account_time
      ON ${this.table("account_email_change_requests")}(account_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_account_email_change_requests_token_active
      ON ${this.table("account_email_change_requests")}(token_hash)
      WHERE used_at IS NULL;

      ALTER TABLE ${this.table("players")}
        ADD COLUMN IF NOT EXISTS player_state jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS inventory_hash text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS inventory_hash_algorithm text NOT NULL DEFAULT '${INTEGRITY_HASH_ALGORITHM}',
        ADD COLUMN IF NOT EXISTS inventory_hash_updated_at timestamptz;

      ALTER TABLE ${this.table("worlds")}
        ADD COLUMN IF NOT EXISTS world_state jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS world_revision bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS world_owner_epoch bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS world_owner_token text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS world_owner_instance text NOT NULL DEFAULT '';

      ALTER TABLE ${this.table("world_snapshots")}
        ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'snapshot',
        ADD COLUMN IF NOT EXISTS snapshot_hash text,
        ADD COLUMN IF NOT EXISTS snapshot_hash_algorithm text NOT NULL DEFAULT '${INTEGRITY_HASH_ALGORITHM}';

      ALTER TABLE ${this.table("item_instances")}
        ADD COLUMN IF NOT EXISTS public_item_instance_id text,
        ADD COLUMN IF NOT EXISTS created_by_source text NOT NULL DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS current_location text NOT NULL DEFAULT 'inventory';

      UPDATE ${this.table("item_instances")}
         SET public_item_instance_id = 'PM-ITEM-' || upper(substr(replace(item_instance_id::text, '-', ''), 1, 16))
       WHERE public_item_instance_id IS NULL
          OR public_item_instance_id = '';

      ALTER TABLE ${this.table("item_instances")}
        ALTER COLUMN public_item_instance_id SET NOT NULL,
        ALTER COLUMN public_item_instance_id SET DEFAULT ('PM-ITEM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))),
        ALTER COLUMN created_by_source SET NOT NULL,
        ALTER COLUMN current_location SET NOT NULL;

      ALTER TABLE ${this.table("item_instances")}
        DROP CONSTRAINT IF EXISTS item_instances_current_location_check;

      ALTER TABLE ${this.table("item_instances")}
        ADD CONSTRAINT item_instances_current_location_check CHECK (
          current_location IN (
            'inventory',
            'vending',
            'trade',
            'world_drop',
            'safe',
            'display',
            'shop',
            'admin',
            'system',
            'unknown'
          )
        );

      ALTER TABLE ${this.table("world_locks")}
        DROP CONSTRAINT IF EXISTS world_locks_lock_type_check;

      ALTER TABLE ${this.table("world_locks")}
        ADD CONSTRAINT world_locks_lock_type_check CHECK (lock_type IN ('none', 'world_lock', 'super_world_lock', 'diamond_lock'));

      CREATE TABLE IF NOT EXISTS ${this.table("world_area_locks")} (
        world_area_lock_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        world_id uuid NOT NULL REFERENCES ${this.table("worlds")}(world_id) ON DELETE CASCADE,
        lock_key text NOT NULL,
        lock_type text NOT NULL CHECK (lock_type IN ('small_lock', 'medium_lock', 'big_lock')),
        owner_player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        lock_x integer NOT NULL,
        lock_y integer NOT NULL,
        max_tiles integer NOT NULL CHECK (max_tiles > 0),
        public_build boolean NOT NULL DEFAULT false,
        ignore_empty_space boolean NOT NULL DEFAULT false,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (world_id, lock_key)
      );

      CREATE TABLE IF NOT EXISTS ${this.table("world_area_lock_access")} (
        world_area_lock_id uuid NOT NULL REFERENCES ${this.table("world_area_locks")}(world_area_lock_id) ON DELETE CASCADE,
        player_id uuid NOT NULL REFERENCES ${this.table("players")}(player_id) ON DELETE CASCADE,
        granted_by_player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        role text NOT NULL DEFAULT 'builder' CHECK (role IN ('admin', 'builder', 'visitor')),
        can_build boolean NOT NULL DEFAULT true,
        can_manage_lock boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (world_area_lock_id, player_id)
      );

      CREATE INDEX IF NOT EXISTS world_area_locks_world_idx
      ON ${this.table("world_area_locks")}(world_id);

      CREATE INDEX IF NOT EXISTS world_area_lock_access_player_idx
      ON ${this.table("world_area_lock_access")}(player_id);

      ALTER TABLE ${this.table("world_area_locks")}
        ADD COLUMN IF NOT EXISTS ignore_empty_space boolean NOT NULL DEFAULT false;

      ALTER TABLE ${this.table("world_area_locks")}
        DROP CONSTRAINT IF EXISTS world_area_locks_lock_type_check;

      ALTER TABLE ${this.table("world_area_locks")}
        ADD CONSTRAINT world_area_locks_lock_type_check CHECK (lock_type IN ('small_lock', 'medium_lock', 'big_lock'));

      CREATE TABLE IF NOT EXISTS ${this.table("world_drops")} (
        world_drop_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        world_id uuid NOT NULL REFERENCES ${this.table("worlds")}(world_id) ON DELETE CASCADE,
        drop_id text NOT NULL,
        item_type text NOT NULL,
        item_category text NOT NULL DEFAULT 'block',
        amount bigint NOT NULL CHECK (amount >= 0),
        x double precision NOT NULL DEFAULT 0,
        y double precision NOT NULL DEFAULT 0,
        stack_grid_x integer,
        stack_grid_y integer,
        pickup_delay double precision NOT NULL DEFAULT 0 CHECK (pickup_delay >= 0),
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'picked_up', 'removed', 'expired')),
        picked_by_player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        picked_at timestamptz,
        removed_at timestamptz,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (world_id, drop_id)
      );

      ALTER TABLE ${this.table("world_drops")}
        ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES ${this.table("worlds")}(world_id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS drop_id text,
        ADD COLUMN IF NOT EXISTS item_type text,
        ADD COLUMN IF NOT EXISTS item_category text NOT NULL DEFAULT 'block',
        ADD COLUMN IF NOT EXISTS amount bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS x double precision NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS y double precision NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS stack_grid_x integer,
        ADD COLUMN IF NOT EXISTS stack_grid_y integer,
        ADD COLUMN IF NOT EXISTS pickup_delay double precision NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS picked_by_player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS picked_at timestamptz,
        ADD COLUMN IF NOT EXISTS removed_at timestamptz,
        ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

      ALTER TABLE ${this.table("world_drops")}
        DROP CONSTRAINT IF EXISTS world_drops_status_check;

      ALTER TABLE ${this.table("world_drops")}
        DROP CONSTRAINT IF EXISTS world_drops_amount_check;

      ALTER TABLE ${this.table("world_drops")}
        DROP CONSTRAINT IF EXISTS world_drops_pickup_delay_check;

      ALTER TABLE ${this.table("world_drops")}
        ADD CONSTRAINT world_drops_status_check CHECK (status IN ('active', 'picked_up', 'removed', 'expired'));

      ALTER TABLE ${this.table("world_drops")}
        ADD CONSTRAINT world_drops_amount_check CHECK (amount >= 0) NOT VALID;

      ALTER TABLE ${this.table("world_drops")}
        ADD CONSTRAINT world_drops_pickup_delay_check CHECK (pickup_delay >= 0) NOT VALID;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_world_drops_world_drop_id
      ON ${this.table("world_drops")}(world_id, drop_id);

      CREATE INDEX IF NOT EXISTS idx_world_drops_world_active
      ON ${this.table("world_drops")}(world_id, status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_world_drops_item_active
      ON ${this.table("world_drops")}(item_category, item_type, status);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_item_instances_public_id
      ON ${this.table("item_instances")}(public_item_instance_id);

      CREATE INDEX IF NOT EXISTS idx_item_instances_type_state
      ON ${this.table("item_instances")}(item_category, item_type, state);

      CREATE INDEX IF NOT EXISTS idx_item_instances_location_state
      ON ${this.table("item_instances")}(current_location, state);

      CREATE TABLE IF NOT EXISTS ${this.table("item_instance_events")} (
        item_instance_event_id bigserial PRIMARY KEY,
        item_instance_id uuid NOT NULL REFERENCES ${this.table("item_instances")}(item_instance_id) ON DELETE CASCADE,
        event_type text NOT NULL,
        from_player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        to_player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        from_location text,
        to_location text,
        world_id uuid REFERENCES ${this.table("worlds")}(world_id) ON DELETE SET NULL,
        item_transaction_id bigint REFERENCES ${this.table("item_transactions")}(item_transaction_id) ON DELETE SET NULL,
        correlation_id uuid,
        source text NOT NULL DEFAULT 'system',
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE ${this.table("item_instance_events")}
        ADD COLUMN IF NOT EXISTS item_instance_id uuid REFERENCES ${this.table("item_instances")}(item_instance_id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'updated',
        ADD COLUMN IF NOT EXISTS from_player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS to_player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS from_location text,
        ADD COLUMN IF NOT EXISTS to_location text,
        ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES ${this.table("worlds")}(world_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS item_transaction_id bigint REFERENCES ${this.table("item_transactions")}(item_transaction_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS correlation_id uuid,
        ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'system',
        ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

      ALTER TABLE ${this.table("item_instance_events")}
        DROP CONSTRAINT IF EXISTS item_instance_events_event_type_check;

      ALTER TABLE ${this.table("item_instance_events")}
        ADD CONSTRAINT item_instance_events_event_type_check CHECK (
          event_type IN ('created', 'reconciled', 'owner_changed', 'location_changed', 'state_changed', 'updated', 'retired')
        ) NOT VALID;

      CREATE INDEX IF NOT EXISTS idx_item_instance_events_item_time
      ON ${this.table("item_instance_events")}(item_instance_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_item_instance_events_player_time
      ON ${this.table("item_instance_events")}(to_player_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_item_instance_events_correlation
      ON ${this.table("item_instance_events")}(correlation_id)
      WHERE correlation_id IS NOT NULL;

      ALTER TABLE ${this.table("item_transactions")}
        DROP CONSTRAINT IF EXISTS item_transactions_source_check;

      ALTER TABLE ${this.table("item_transactions")}
        ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES ${this.table("worlds")}(world_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'system',
        ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'update',
        ADD COLUMN IF NOT EXISTS item_type text,
        ADD COLUMN IF NOT EXISTS item_category text,
        ADD COLUMN IF NOT EXISTS delta bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS before_amount bigint,
        ADD COLUMN IF NOT EXISTS after_amount bigint,
        ADD COLUMN IF NOT EXISTS request_id text,
        ADD COLUMN IF NOT EXISTS correlation_id uuid,
        ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

      ALTER TABLE ${this.table("item_transactions")}
        ADD CONSTRAINT item_transactions_source_check CHECK (
          source IN (
            'world_block_break',
            'world_block_place',
            'world_lock_conversion',
            'world_lock_key',
            'world_interaction',
            'drop_pickup',
            'drop_inventory',
            'seed_place',
            'seed_splice',
            'seed_harvest',
            'trade',
            'vending',
            'safe',
            'display',
            'shop',
            'craft',
            'crafting',
            'event',
            'quest',
            'loot_box',
            'reward',
            'world_drop',
            'furnace',
            'fishing',
            'fish_monger',
            'admin',
            'rollback',
            'system'
          )
        );

      CREATE TABLE IF NOT EXISTS ${this.table("gem_ledger")} (
        gem_ledger_id bigserial PRIMARY KEY,
        player_id uuid NOT NULL REFERENCES ${this.table("players")}(player_id) ON DELETE CASCADE,
        delta bigint NOT NULL,
        reason text NOT NULL,
        ref_type text,
        ref_id text,
        before_balance bigint,
        after_balance bigint,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (after_balance IS NULL OR after_balance >= 0)
      );

      ALTER TABLE ${this.table("gem_ledger")}
        ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS delta bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'update',
        ADD COLUMN IF NOT EXISTS ref_type text,
        ADD COLUMN IF NOT EXISTS ref_id text,
        ADD COLUMN IF NOT EXISTS before_balance bigint,
        ADD COLUMN IF NOT EXISTS after_balance bigint,
        ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

      ALTER TABLE ${this.table("gem_ledger")}
        DROP CONSTRAINT IF EXISTS gem_ledger_after_balance_check;

      ALTER TABLE ${this.table("gem_ledger")}
        ADD CONSTRAINT gem_ledger_after_balance_check CHECK (after_balance IS NULL OR after_balance >= 0) NOT VALID;

      CREATE INDEX IF NOT EXISTS idx_gem_ledger_player_time
      ON ${this.table("gem_ledger")}(player_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ${this.table("transaction_ledger")} (
        transaction_ledger_id bigserial PRIMARY KEY,
        transaction_id uuid NOT NULL DEFAULT gen_random_uuid(),
        transaction_type text NOT NULL,
        status text NOT NULL DEFAULT 'success',
        player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        other_player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        world_id uuid REFERENCES ${this.table("worlds")}(world_id) ON DELETE SET NULL,
        item_transaction_id bigint REFERENCES ${this.table("item_transactions")}(item_transaction_id) ON DELETE SET NULL,
        gem_ledger_id bigint REFERENCES ${this.table("gem_ledger")}(gem_ledger_id) ON DELETE SET NULL,
        trade_id uuid REFERENCES ${this.table("trades")}(trade_id) ON DELETE SET NULL,
        vending_transaction_id bigint REFERENCES ${this.table("vending_transactions")}(vending_transaction_id) ON DELETE SET NULL,
        shop_purchase_id bigint REFERENCES ${this.table("shop_purchases")}(shop_purchase_id) ON DELETE SET NULL,
        admin_action_id bigint REFERENCES ${this.table("admin_actions")}(admin_action_id) ON DELETE SET NULL,
        item_instance_id uuid REFERENCES ${this.table("item_instances")}(item_instance_id) ON DELETE SET NULL,
        public_item_instance_id text,
        item_type text,
        item_category text,
        quantity bigint,
        gems_before bigint,
        gems_after bigint,
        inventory_before_hash text,
        inventory_after_hash text,
        transaction_hash text,
        transaction_hash_algorithm text NOT NULL DEFAULT '${INTEGRITY_HASH_ALGORITHM}',
        ip_address inet,
        session_token_hash text,
        user_agent text,
        device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
        request_id text,
        correlation_id uuid,
        source text,
        action text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        server_time timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE ${this.table("transaction_ledger")}
        ADD COLUMN IF NOT EXISTS transaction_id uuid NOT NULL DEFAULT gen_random_uuid(),
        ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'UNKNOWN',
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'success',
        ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS other_player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES ${this.table("worlds")}(world_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS item_transaction_id bigint REFERENCES ${this.table("item_transactions")}(item_transaction_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS gem_ledger_id bigint REFERENCES ${this.table("gem_ledger")}(gem_ledger_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS trade_id uuid REFERENCES ${this.table("trades")}(trade_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS vending_transaction_id bigint REFERENCES ${this.table("vending_transactions")}(vending_transaction_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS shop_purchase_id bigint REFERENCES ${this.table("shop_purchases")}(shop_purchase_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS admin_action_id bigint REFERENCES ${this.table("admin_actions")}(admin_action_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS item_instance_id uuid REFERENCES ${this.table("item_instances")}(item_instance_id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS public_item_instance_id text,
        ADD COLUMN IF NOT EXISTS item_type text,
        ADD COLUMN IF NOT EXISTS item_category text,
        ADD COLUMN IF NOT EXISTS quantity bigint,
        ADD COLUMN IF NOT EXISTS gems_before bigint,
        ADD COLUMN IF NOT EXISTS gems_after bigint,
        ADD COLUMN IF NOT EXISTS inventory_before_hash text,
        ADD COLUMN IF NOT EXISTS inventory_after_hash text,
        ADD COLUMN IF NOT EXISTS transaction_hash text,
        ADD COLUMN IF NOT EXISTS transaction_hash_algorithm text NOT NULL DEFAULT '${INTEGRITY_HASH_ALGORITHM}';

      ALTER TABLE ${this.table("transaction_ledger")}
        ADD COLUMN IF NOT EXISTS ip_address inet,
        ADD COLUMN IF NOT EXISTS session_token_hash text,
        ADD COLUMN IF NOT EXISTS user_agent text,
        ADD COLUMN IF NOT EXISTS device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS request_id text,
        ADD COLUMN IF NOT EXISTS correlation_id uuid,
        ADD COLUMN IF NOT EXISTS source text,
        ADD COLUMN IF NOT EXISTS action text,
        ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS server_time timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

      ALTER TABLE ${this.table("transaction_ledger")}
        DROP CONSTRAINT IF EXISTS transaction_ledger_status_check;

      ALTER TABLE ${this.table("transaction_ledger")}
        ADD CONSTRAINT transaction_ledger_status_check CHECK (status IN ('success', 'failed', 'reversed'));

      CREATE INDEX IF NOT EXISTS idx_transaction_ledger_player_time
      ON ${this.table("transaction_ledger")}(player_id, server_time DESC);

      CREATE INDEX IF NOT EXISTS idx_transaction_ledger_type_time
      ON ${this.table("transaction_ledger")}(transaction_type, server_time DESC);

      CREATE INDEX IF NOT EXISTS idx_transaction_ledger_instance_time
      ON ${this.table("transaction_ledger")}(public_item_instance_id, server_time DESC)
      WHERE public_item_instance_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_transaction_ledger_item_time
      ON ${this.table("transaction_ledger")}(item_category, item_type, server_time DESC)
      WHERE item_type IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_transaction_ledger_request_id
      ON ${this.table("transaction_ledger")}(request_id)
      WHERE request_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_transaction_ledger_correlation_id
      ON ${this.table("transaction_ledger")}(correlation_id)
      WHERE correlation_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_transaction_ledger_hash
      ON ${this.table("transaction_ledger")}(transaction_hash)
      WHERE transaction_hash IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ${this.table("integrity_audit_runs")} (
        integrity_audit_run_id bigserial PRIMARY KEY,
        run_type text NOT NULL DEFAULT 'integrity_hash_audit',
        status text NOT NULL DEFAULT 'success',
        summary jsonb NOT NULL DEFAULT '{}'::jsonb,
        issues jsonb NOT NULL DEFAULT '[]'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_integrity_audit_runs_type_time
      ON ${this.table("integrity_audit_runs")}(run_type, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_integrity_audit_runs_status_time
      ON ${this.table("integrity_audit_runs")}(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS ${this.table("rollback_jobs")} (
        rollback_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        rollback_type text NOT NULL CHECK (rollback_type IN ('player', 'world', 'item', 'transaction')),
        status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'applied', 'failed')),
        actor_username text NOT NULL DEFAULT 'rollback_tool',
        reason text NOT NULL,
        target_username text,
        target_world text,
        target_item_instance_id text,
        target_transaction_id uuid,
        target_transaction_ledger_id bigint,
        since_at timestamptz,
        until_at timestamptz,
        snapshot_version integer,
        dry_run boolean NOT NULL DEFAULT true,
        plan jsonb NOT NULL DEFAULT '{}'::jsonb,
        result jsonb NOT NULL DEFAULT '{}'::jsonb,
        applied_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_rollback_jobs_type_time
      ON ${this.table("rollback_jobs")}(rollback_type, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_rollback_jobs_status_time
      ON ${this.table("rollback_jobs")}(status, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_rollback_jobs_target_user_time
      ON ${this.table("rollback_jobs")}(target_username, created_at DESC)
      WHERE target_username IS NOT NULL;

      CREATE TABLE IF NOT EXISTS ${this.table("world_block_changes")} (
        world_block_change_id bigserial PRIMARY KEY,
        world_id uuid NOT NULL REFERENCES ${this.table("worlds")}(world_id) ON DELETE CASCADE,
        player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        action text NOT NULL CHECK (action IN ('place', 'break', 'hit')),
        reason text,
        layer text NOT NULL CHECK (layer IN ('foreground', 'background')),
        block_x integer NOT NULL,
        block_y integer NOT NULL,
        block_type_before text,
        block_type_after text,
        hit_count integer,
        tx_uuid uuid,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE ${this.table("world_block_changes")}
        ADD COLUMN IF NOT EXISTS reason text,
        ADD COLUMN IF NOT EXISTS block_type_before text,
        ADD COLUMN IF NOT EXISTS block_type_after text,
        ADD COLUMN IF NOT EXISTS hit_count integer,
        ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

      CREATE INDEX IF NOT EXISTS idx_world_block_changes_world_time
      ON ${this.table("world_block_changes")}(world_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_world_block_changes_world_position
      ON ${this.table("world_block_changes")}(world_id, block_x, block_y, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_world_block_changes_player_time
      ON ${this.table("world_block_changes")}(player_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ${this.table("world_object_changes")} (
        world_object_change_id bigserial PRIMARY KEY,
        world_id uuid NOT NULL REFERENCES ${this.table("worlds")}(world_id) ON DELETE CASCADE,
        player_id uuid REFERENCES ${this.table("players")}(player_id) ON DELETE SET NULL,
        object_type text NOT NULL,
        object_id text NOT NULL,
        block_x integer,
        block_y integer,
        action text NOT NULL,
        reason text,
        source_type text,
        source_id text,
        request_id text,
        old_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        new_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE ${this.table("world_object_changes")}
        ADD COLUMN IF NOT EXISTS reason text;

      CREATE INDEX IF NOT EXISTS idx_world_object_changes_world_time
      ON ${this.table("world_object_changes")}(world_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_world_object_changes_object_time
      ON ${this.table("world_object_changes")}(world_id, object_type, object_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_world_object_changes_player_time
      ON ${this.table("world_object_changes")}(player_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ${this.table("world_honor_visits")} (
        world_id uuid NOT NULL REFERENCES ${this.table("worlds")}(world_id) ON DELETE CASCADE,
        visitor_player_id uuid NOT NULL REFERENCES ${this.table("players")}(player_id) ON DELETE CASCADE,
        honor_date date NOT NULL,
        network_hash text NOT NULL DEFAULT '',
        dwell_ms bigint NOT NULL DEFAULT 0 CHECK (dwell_ms >= 0),
        visit_started_at timestamptz NOT NULL,
        visit_ended_at timestamptz NOT NULL,
        qualified_at timestamptz NOT NULL DEFAULT now(),
        source_instance text NOT NULL DEFAULT '',
        PRIMARY KEY (world_id, visitor_player_id, honor_date)
      );

      CREATE INDEX IF NOT EXISTS idx_world_honor_visits_date_world
      ON ${this.table("world_honor_visits")}(honor_date DESC, world_id);

      CREATE INDEX IF NOT EXISTS idx_world_honor_visits_world_date
      ON ${this.table("world_honor_visits")}(world_id, honor_date DESC);

      CREATE INDEX IF NOT EXISTS idx_world_honor_visits_network_date
      ON ${this.table("world_honor_visits")}(world_id, honor_date, network_hash)
      WHERE network_hash <> '';
    `);
    }
    async ensureProgressionSchema() {
        await this.db.query(`
      ALTER TABLE ${this.table("players")}
        ADD COLUMN IF NOT EXISTS player_level integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS player_xp bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS player_xp_needed bigint NOT NULL DEFAULT 300,
        ADD COLUMN IF NOT EXISTS player_total_xp bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS player_title text NOT NULL DEFAULT 'Explorer',
        ADD COLUMN IF NOT EXISTS last_level_up_at timestamptz;

      CREATE TABLE IF NOT EXISTS ${this.table("player_progression_events")} (
        player_progression_event_id bigserial PRIMARY KEY,
        player_id uuid NOT NULL REFERENCES ${this.table("players")}(player_id) ON DELETE CASCADE,
        source text NOT NULL,
        xp_delta bigint NOT NULL CHECK (xp_delta >= 0),
        level_before integer NOT NULL CHECK (level_before BETWEEN 1 AND 100),
        level_after integer NOT NULL CHECK (level_after BETWEEN 1 AND 100),
        xp_before bigint NOT NULL CHECK (xp_before >= 0),
        xp_after bigint NOT NULL CHECK (xp_after >= 0),
        total_xp_after bigint NOT NULL CHECK (total_xp_after >= 0),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_player_progression_events_player_time
      ON ${this.table("player_progression_events")}(player_id, created_at DESC);
    `);
        this.progressionReady = true;
    }
    async close() {
        await this.flushWriteQueue();
        if (!this.pool)
            return;
        try {
            await this.pool.end();
        }
        catch {
            // Ignore shutdown errors.
        }
    }
    // Waits for ALL in-flight writes across every scope, preserving this method's original
    // "everything queued so far has landed" contract now that writes are ordered per scope
    // rather than through one global chain. Used by shutdown and by explicit full-drain callers.
    async flushWriteQueue() {
        try {
            await Promise.allSettled([this.writeQueue, ...Array.from(this.scopedWriteQueues.values())]);
        }
        catch {
            // The queue keeps itself alive after failures; callers handle individual errors.
        }
    }
    // Per-scope write ordering.
    //
    // Previously every write on the entire server went through ONE serial promise chain
    // (this.writeQueue). That guaranteed global write ordering, but it also meant a world join --
    // which must wait for that world's or that player's pending save to land before reading them
    // back -- transitively waited for EVERY unrelated write queued ahead of it. Two independent
    // client captures measured 2378ms and 1831ms between sending join_world and the first server
    // byte, with every measured server stage in single-digit milliseconds; a third measured 258ms.
    // That spread is the signature of queueing behind unrelated work, and it is why joins were
    // inconsistent rather than uniformly slow: it depended on where in the 30s periodic-save
    // cycle (PERIODIC_SAVE_MS -> flushPendingSaves, which enqueues N world saves + M player saves
    // in a single tick) the join happened to land.
    //
    // Writes are now ordered per SCOPE instead of globally. What matters for correctness is that
    // writes to the SAME key stay in order -- two saves of world "TEST", or two saves of player
    // "bob", must not reorder or interleave. Writes to DIFFERENT keys were never ordered against
    // each other in any meaningful sense; they were only serialized as an implementation detail.
    //
    // Safety notes:
    //  - Default scope is still the shared global chain, so every existing call site is unchanged
    //    unless it explicitly opts in. Only world saves and player saves are scoped today.
    //  - Same-scope ordering is identical to before (still one serial chain per scope).
    //  - Concurrency is bounded by the pg pool (max 10), and withTransactionNow already retries
    //    serialization/deadlock failures (40001/40P01) with backoff.
    //  - Different worlds touch different `worlds` rows, so the SELECT ... FOR UPDATE in
    //    upsertWorldState cannot contend across scopes. Paths using pg_advisory_xact_lock stay on
    //    the default global scope and are therefore still fully serialized.
    getWriteQueueTail(scope) {
        if (scope === POSTGRES_GLOBAL_WRITE_SCOPE)
            return this.writeQueue;
        return this.scopedWriteQueues.get(scope) || Promise.resolve();
    }
    setWriteQueueTail(scope, tail) {
        if (scope === POSTGRES_GLOBAL_WRITE_SCOPE) {
            this.writeQueue = tail;
            return;
        }
        this.scopedWriteQueues.set(scope, tail);
        // Drop the entry once this tail settles and nothing newer replaced it, so the map does not
        // grow without bound across every world/player the process ever touches.
        tail.then(() => {
            if (this.scopedWriteQueues.get(scope) === tail)
                this.scopedWriteQueues.delete(scope);
        }, () => {
            if (this.scopedWriteQueues.get(scope) === tail)
                this.scopedWriteQueues.delete(scope);
        });
    }
    enqueueWrite(label, work, scope = POSTGRES_GLOBAL_WRITE_SCOPE) {
        if (!this.isReady())
            return Promise.resolve(null);
        const cleanLabel = cleanName(label || "transaction") || "transaction";
        if (this.writeQueueDepth >= this.maxWriteQueueDepth) {
            const error = new Error(`write queue is full while scheduling ${cleanLabel}`);
            error.code = "POSTGRES_WRITE_QUEUE_FULL";
            return Promise.reject(error);
        }
        const cleanScope = cleanName(scope || POSTGRES_GLOBAL_WRITE_SCOPE) || POSTGRES_GLOBAL_WRITE_SCOPE;
        const queuedAt = Date.now();
        const queueDepthAtEnqueue = this.writeQueueDepth;
        this.writeQueueDepth += 1;
        const run = this.getWriteQueueTail(cleanScope)
            .catch(() => null)
            .then(async () => {
            const startedAt = Date.now();
            try {
                return await work();
            }
            finally {
                this.writeQueueDepth = Math.max(0, this.writeQueueDepth - 1);
                const finishedAt = Date.now();
                const queueWaitMs = startedAt - queuedAt;
                const execMs = finishedAt - startedAt;
                if (this.slowWriteLogThresholdMs > 0 && queueWaitMs + execMs >= this.slowWriteLogThresholdMs) {
                    this.logger(`[postgres] slow write: label=${cleanLabel} scope=${cleanScope} queue_wait_ms=${queueWaitMs} exec_ms=${execMs} queue_depth_at_enqueue=${queueDepthAtEnqueue}`);
                }
            }
        });
        this.setWriteQueueTail(cleanScope, run.then(() => null, () => null));
        return run;
    }
    async withTransaction(work, label = "transaction", scope = POSTGRES_GLOBAL_WRITE_SCOPE) {
        if (!this.isReady())
            return null;
        return this.enqueueWrite(label, () => this.withTransactionNow(work), scope);
    }
    async withTransactionNow(work) {
        if (!this.isReady())
            return null;
        for (let attempt = 1; attempt <= POSTGRES_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
            const client = await this.db.connect();
            let released = false;
            try {
                // Fresh memo per attempt; see endIdentityCache in the finally below.
                this.beginIdentityCache(client);
                await client.query("BEGIN");
                const result = await work(client);
                await client.query("COMMIT");
                return result;
            }
            catch (error) {
                try {
                    await client.query("ROLLBACK");
                }
                catch {
                    // Ignore rollback failures.
                }
                if (isRetryablePostgresError(error) && attempt < POSTGRES_TRANSACTION_MAX_ATTEMPTS) {
                    client.release();
                    released = true;
                    const retryDelay = POSTGRES_TRANSACTION_RETRY_BASE_DELAY_MS * attempt;
                    await delay(retryDelay);
                    continue;
                }
                throw error;
            }
            finally {
                this.endIdentityCache(client);
                if (!released) {
                    client.release();
                }
            }
        }
        return null;
    }
    /**
     * Opens a transaction-scoped identity memo for this client.
     * @param {object} client
     * @returns {void}
     */
    beginIdentityCache(client) {
        this.identityCacheByClient.set(client, { active: true, entries: new Map() });
    }
    /**
     * Closes the memo. Runs in a finally, so it fires on COMMIT, ROLLBACK and retry alike --
     * a rolled-back transaction must never leave a cached identity behind for the next one.
     * @param {object} client
     * @returns {void}
     */
    endIdentityCache(client) {
        this.identityCacheByClient.delete(client);
    }
    runDetached(label, work) {
        if (!this.isReady())
            return;
        Promise.resolve()
            .then(work)
            .catch((error) => {
            this.logger(`[postgres] ${label} failed:`, getErrorMessage(error));
        });
    }
    async ensurePlayerIdentity(client, username, email = "", role = "player", world = "") {
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return null;
        const providedEmail = cleanName(email || "");
        const cleanEmail = providedEmail || defaultEmailForUsername(cleanUsername);
        const cleanRole = normalizeDbRole(role || "player");
        const cleanWorld = cleanName(world || "");
        // Two upserts per call, and the write path calls this repeatedly for the SAME actor
        // inside one transaction: once per world-change entry (insertWorldBlockChange), once per
        // world-lock member in each of mirrorWorldLockState's two passes, and again in
        // mirrorWorldAreaLocksState. A single block break with a handful of changes therefore
        // paid the same two upserts several times over.
        //
        // Memoize on the FULL normalized argument tuple, not just the username: the ON CONFLICT
        // clauses also write email, role and current_world_name, so a later call with different
        // arguments must still execute. An identical repeat inside one transaction is a genuine
        // no-op -- the row exists and the upsert already applied those same values.
        const identityCache = this.identityCacheByClient.get(client);
        const identityCacheKey = identityCache?.active
            ? [cleanUsername, cleanEmail, cleanRole, cleanWorld].join("\u0000")
            : "";
        if (identityCache?.active) {
            const cachedPlayerId = identityCache.entries.get(identityCacheKey);
            if (cachedPlayerId)
                return cachedPlayerId;
        }
        const accountResult = await client.query(`
      INSERT INTO ${this.table("accounts")} (username, email, password_hash, role, is_active, last_login_at)
      VALUES ($1, $2, '', $3, true, now())
      ON CONFLICT (username) DO UPDATE
        SET email = COALESCE(NULLIF($4, ''), ${this.table("accounts")}.email),
            role = COALESCE(NULLIF(EXCLUDED.role, ''), ${this.table("accounts")}.role),
            is_active = true
      RETURNING account_id
      `, [cleanUsername, cleanEmail, cleanRole, providedEmail]);
        if (!accountResult.rows[0])
            return null;
        const accountId = accountResult.rows[0].account_id;
        const playerResult = await client.query(`
      INSERT INTO ${this.table("players")} (account_id, display_name, current_world_name)
      VALUES ($1, $2, NULLIF($3, ''))
      ON CONFLICT (account_id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            current_world_name = COALESCE(NULLIF(EXCLUDED.current_world_name, ''), ${this.table("players")}.current_world_name)
      RETURNING player_id
      `, [accountId, cleanUsername, cleanWorld]);
        const resolvedPlayerId = playerResult.rows[0] ? playerResult.rows[0].player_id : null;
        // Never cache a miss -- a later call may legitimately succeed.
        if (identityCache?.active && resolvedPlayerId) {
            identityCache.entries.set(identityCacheKey, resolvedPlayerId);
        }
        return resolvedPlayerId;
    }
    async ensurePlayerIdentityForExistingAccount(client, username, world = "") {
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return null;
        const cleanWorld = cleanName(world || "");
        const accountResult = await client.query(`
      SELECT account_id
        FROM ${this.table("accounts")}
       WHERE lower(username) = lower($1)
       LIMIT 1
      `, [cleanUsername]);
        const accountId = accountResult.rows[0]?.account_id;
        if (!accountId)
            return null;
        const playerResult = await client.query(`
      INSERT INTO ${this.table("players")} (account_id, display_name, current_world_name)
      VALUES ($1, $2, NULLIF($3, ''))
      ON CONFLICT (account_id) DO UPDATE
        SET display_name = COALESCE(NULLIF(${this.table("players")}.display_name, ''), EXCLUDED.display_name),
            current_world_name = COALESCE(NULLIF(EXCLUDED.current_world_name, ''), ${this.table("players")}.current_world_name)
      RETURNING player_id
      `, [accountId, cleanUsername, cleanWorld]);
        return playerResult.rows[0] ? playerResult.rows[0].player_id : null;
    }
    async lookupPlayerIdByUsername(client, username) {
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return null;
        const result = await client.query(`
      SELECT p.player_id
        FROM ${this.table("players")} p
        JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
       WHERE lower(a.username) = lower($1)
       LIMIT 1
      `, [cleanUsername]);
        return result.rows[0]?.player_id || null;
    }
    async lookupPlayerIdentityByUsername(username) {
        if (!this.isReady())
            return null;
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return null;
        try {
            const result = await this.db.query(`
        SELECT p.player_id,
               a.account_id,
               a.username::text AS username
          FROM ${this.table("players")} p
          JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
         WHERE lower(a.username) = lower($1)
         LIMIT 1
        `, [cleanUsername]);
            const row = result.rows[0];
            if (!row)
                return null;
            return {
                player_id: cleanName(row.player_id || ""),
                account_id: cleanName(row.account_id || ""),
                username: cleanName(row.username || ""),
            };
        }
        catch (error) {
            this.logger("[postgres] player identity lookup failed:", getErrorMessage(error));
            return null;
        }
    }
    async lookupPlayerIdByAccountId(client, accountId) {
        const cleanAccountId = cleanName(accountId);
        if (!isUuid(cleanAccountId))
            return null;
        const result = await client.query(`
      SELECT player_id
        FROM ${this.table("players")}
       WHERE account_id = $1
       LIMIT 1
      `, [cleanAccountId]);
        return result.rows[0]?.player_id || null;
    }
    async lookupAccountIdByPlayerId(client, playerId) {
        const cleanPlayerId = cleanName(playerId);
        if (!isUuid(cleanPlayerId))
            return null;
        const result = await client.query(`
      SELECT account_id
        FROM ${this.table("players")}
       WHERE player_id = $1
       LIMIT 1
      `, [cleanPlayerId]);
        return result.rows[0]?.account_id || null;
    }
    async lookupUsernameByPlayerId(client, playerId) {
        const cleanPlayerId = cleanName(playerId);
        if (!isUuid(cleanPlayerId))
            return "";
        const result = await client.query(`
      SELECT a.username::text AS username
        FROM ${this.table("players")} p
        JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
       WHERE p.player_id = $1
       LIMIT 1
      `, [cleanPlayerId]);
        return cleanName(result.rows[0]?.username || "");
    }
    async claimIdempotency(scope, key, username = "", metadata = {}, options = {}) {
        const cleanScope = cleanName(scope);
        const cleanKey = cleanName(key);
        if (!this.isReady() || cleanScope === "" || cleanKey === "") {
            return { ok: false, duplicate: false };
        }
        const configuredTtlMsRaw = Math.trunc(Number(options?.ttl_ms));
        const configuredTtlMs = Number.isFinite(configuredTtlMsRaw) && configuredTtlMsRaw > 0
            ? Math.max(1_000, configuredTtlMsRaw)
            : 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + configuredTtlMs).toISOString();
        try {
            const result = await this.withTransaction(async (client) => {
                let playerId = null;
                if (cleanName(username) !== "") {
                    playerId = await this.ensurePlayerIdentity(client, username);
                }
                const insert = await client.query(`
          INSERT INTO ${this.table("idempotency_keys")} (scope, key, player_id, metadata, expires_at)
          VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
          ON CONFLICT (scope, key) DO NOTHING
          RETURNING idempotency_key_id
          `, [cleanScope, cleanKey, playerId, JSON.stringify(safeJson(metadata)), expiresAt]);
                return (insert.rowCount ?? 0) > 0;
            });
            return { ok: true, duplicate: !result };
        }
        catch (error) {
            this.logger("[postgres] idempotency write failed:", getErrorMessage(error));
            return { ok: false, duplicate: false };
        }
    }
    async upsertAccountState(client, account, options = {}) {
        const accountData = toObject(account);
        const username = cleanName(accountData.username || accountData.account_username || accountData.name || "");
        if (username === "")
            return null;
        const fallbackEmail = defaultEmailForUsername(username);
        const email = cleanName(accountData.email || "") || fallbackEmail;
        const role = normalizeDbRole(accountData.role || "player");
        const touchLogin = Boolean(options.touchLogin);
        const lastSeenAt = normalizeOptionalTimestamp(accountData.last_seen_at || "");
        const lastLoginAt = touchLogin ? new Date().toISOString() : lastSeenAt;
        const result = await client.query(`
      INSERT INTO ${this.table("accounts")} (
        username,
        email,
        password_salt,
        password_hash,
        password_algorithm,
        role,
        is_active,
        last_login_at,
        created_at,
        updated_at,
        email_verified,
        email_verified_at,
        email_verification_token_hash,
        email_verification_expires_at,
        account_state
      )
      VALUES (
        $1,
        COALESCE(NULLIF($2, ''), $14),
        $3,
        $4,
        $5,
        $6,
        true,
        $7::timestamptz,
        COALESCE($8::timestamptz, now()),
        now(),
        $9,
        $10::timestamptz,
        $11,
        $12::timestamptz,
        $13::jsonb
      )
      ON CONFLICT (username) DO UPDATE
        SET email = COALESCE(NULLIF(EXCLUDED.email::text, ''), ${this.table("accounts")}.email),
            password_salt = CASE
              WHEN EXCLUDED.password_salt <> '' THEN EXCLUDED.password_salt
              ELSE ${this.table("accounts")}.password_salt
            END,
            password_hash = CASE
              WHEN EXCLUDED.password_hash <> '' THEN EXCLUDED.password_hash
              ELSE ${this.table("accounts")}.password_hash
            END,
            password_algorithm = CASE
              WHEN EXCLUDED.password_algorithm <> '' THEN EXCLUDED.password_algorithm
              ELSE ${this.table("accounts")}.password_algorithm
            END,
            role = EXCLUDED.role,
            is_active = true,
            last_login_at = COALESCE(EXCLUDED.last_login_at, ${this.table("accounts")}.last_login_at),
            email_verified = EXCLUDED.email_verified,
            email_verified_at = EXCLUDED.email_verified_at,
            email_verification_token_hash = EXCLUDED.email_verification_token_hash,
            email_verification_expires_at = EXCLUDED.email_verification_expires_at,
            account_state = EXCLUDED.account_state,
            updated_at = now()
      RETURNING account_id
      `, [
            username,
            email,
            cleanName(accountData.password_salt || ""),
            String(accountData.password_hash || ""),
            cleanName(accountData.password_algorithm || (accountData.password_hash ? "legacy_scrypt" : "")),
            role,
            lastLoginAt,
            normalizeOptionalTimestamp(accountData.created_at || ""),
            Boolean(accountData.email_verified),
            normalizeOptionalTimestamp(accountData.email_verified_at || ""),
            cleanName(accountData.email_verification_token_hash || ""),
            normalizeOptionalTimestamp(accountData.email_verification_expires_at || ""),
            JSON.stringify(safeJson({ ...accountData, username, email, role: accountData.role || role })),
            fallbackEmail,
        ]);
        const accountId = result.rows[0]?.account_id || null;
        if (!accountId)
            return null;
        await client.query(`
      INSERT INTO ${this.table("players")} (account_id, display_name, current_world_name, created_at, updated_at)
      VALUES ($1, $2, NULLIF($3, ''), now(), now())
      ON CONFLICT (account_id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            updated_at = now()
      `, [accountId, username, cleanName(accountData.current_world_name || "")]);
        return accountId;
    }
    async saveAccountState(account, options = {}) {
        if (!this.isReady())
            return false;
        try {
            await this.withTransaction(async (client) => {
                await this.upsertAccountState(client, account, options);
            });
            return true;
        }
        catch (error) {
            this.logger("[postgres] account save failed:", getErrorMessage(error));
            return false;
        }
    }
    async saveAccountStates(accountStates = []) {
        if (!this.isReady())
            return false;
        const states = Array.isArray(accountStates) ? accountStates : [];
        if (states.length === 0)
            return true;
        try {
            await this.withTransaction(async (client) => {
                for (const account of states) {
                    await this.upsertAccountState(client, account);
                }
            });
            return true;
        }
        catch (error) {
            this.logger("[postgres] accounts snapshot save failed:", getErrorMessage(error));
            return false;
        }
    }
    async loadAccountStates() {
        if (!this.isReady())
            return [];
        try {
            const result = await this.queryReadWithRetry("account states load", `
        SELECT
          a.account_id::text AS account_id,
          p.player_id::text AS player_id,
          a.username::text AS username,
          a.email::text AS email,
          a.password_salt,
          a.password_hash,
          a.password_algorithm,
          a.role,
          a.email_verified,
          a.email_verified_at,
          a.email_verification_token_hash,
          a.email_verification_expires_at,
          a.account_state,
          a.created_at,
          a.last_login_at,
          s.session_token_hash,
          s.expires_at AS session_token_expires_at,
          s.refresh_token_hash,
          s.refresh_expires_at
        FROM ${this.table("accounts")} a
        LEFT JOIN ${this.table("players")} p ON p.account_id = a.account_id
        LEFT JOIN LATERAL (
          SELECT session_token_hash, expires_at, refresh_token_hash, refresh_expires_at
            FROM ${this.table("sessions")}
           WHERE account_id = a.account_id
             AND revoked_at IS NULL
             AND (
               expires_at > now()
               OR refresh_expires_at > now()
             )
           ORDER BY last_seen_at DESC
           LIMIT 1
        ) s ON true
        WHERE a.is_active = true
        ORDER BY a.created_at ASC
      `);
            return result.rows.map((row) => {
                const accountState = toObject(row.account_state);
                return {
                    ...accountState,
                    account_id: cleanName(accountState.account_id || row.account_id || ""),
                    player_id: cleanName(accountState.player_id || accountState.profile_id || row.player_id || ""),
                    profile_id: cleanName(accountState.profile_id || accountState.player_id || row.player_id || ""),
                    username: cleanName(accountState.username || row.username),
                    email: cleanName(accountState.email || row.email),
                    password_salt: cleanName(accountState.password_salt || row.password_salt || ""),
                    password_hash: String(accountState.password_hash || row.password_hash || ""),
                    password_algorithm: cleanName(accountState.password_algorithm || row.password_algorithm || (accountState.password_hash || row.password_hash ? "legacy_scrypt" : "")),
                    session_token_hash: cleanName(row.session_token_hash || accountState.session_token_hash || ""),
                    session_token_expires_at: cleanName(normalizeOptionalTimestamp(row.session_token_expires_at) || accountState.session_token_expires_at || ""),
                    refresh_token_hash: cleanName(row.refresh_token_hash || accountState.refresh_token_hash || ""),
                    refresh_token_expires_at: cleanName(normalizeOptionalTimestamp(row.refresh_expires_at) || accountState.refresh_token_expires_at || ""),
                    email_verified: Boolean(row.email_verified),
                    email_verified_at: cleanName(normalizeOptionalTimestamp(row.email_verified_at) || accountState.email_verified_at || ""),
                    email_verification_token_hash: cleanName(row.email_verification_token_hash || accountState.email_verification_token_hash || ""),
                    email_verification_expires_at: cleanName(normalizeOptionalTimestamp(row.email_verification_expires_at) || accountState.email_verification_expires_at || ""),
                    role: cleanName(accountState.role || row.role || "player") || "player",
                    created_at: cleanName(accountState.created_at || normalizeOptionalTimestamp(row.created_at) || ""),
                    last_seen_at: cleanName(accountState.last_seen_at || normalizeOptionalTimestamp(row.last_login_at) || ""),
                };
            });
        }
        catch (error) {
            this.logger("[postgres] account load failed after retries:", getErrorMessage(error));
            throw postgresError(error);
        }
    }
    async loadAccountState(username) {
        if (!this.isReady())
            return null;
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return null;
        try {
            const result = await this.db.query(`
        SELECT
          a.account_id::text AS account_id,
          p.player_id::text AS player_id,
          a.username::text AS username,
          a.email::text AS email,
          a.password_salt,
          a.password_hash,
          a.password_algorithm,
          a.role,
          a.email_verified,
          a.email_verified_at,
          a.email_verification_token_hash,
          a.email_verification_expires_at,
          a.account_state,
          a.created_at,
          a.last_login_at,
          s.session_token_hash,
          s.expires_at AS session_token_expires_at,
          s.refresh_token_hash,
          s.refresh_expires_at
        FROM ${this.table("accounts")} a
        LEFT JOIN ${this.table("players")} p ON p.account_id = a.account_id
        LEFT JOIN LATERAL (
          SELECT session_token_hash, expires_at, refresh_token_hash, refresh_expires_at
            FROM ${this.table("sessions")}
           WHERE account_id = a.account_id
             AND revoked_at IS NULL
             AND (
               expires_at > now()
               OR refresh_expires_at > now()
             )
           ORDER BY last_seen_at DESC
           LIMIT 1
        ) s ON true
        WHERE lower(a.username::text) = lower($1)
          AND a.is_active = true
        LIMIT 1
        `, [cleanUsername]);
            const row = result.rows[0];
            if (!row)
                return null;
            const accountState = toObject(row.account_state);
            return {
                ...accountState,
                account_id: cleanName(accountState.account_id || row.account_id || ""),
                player_id: cleanName(accountState.player_id || accountState.profile_id || row.player_id || ""),
                profile_id: cleanName(accountState.profile_id || accountState.player_id || row.player_id || ""),
                username: cleanName(accountState.username || row.username),
                email: cleanName(accountState.email || row.email),
                password_salt: cleanName(accountState.password_salt || row.password_salt || ""),
                password_hash: String(accountState.password_hash || row.password_hash || ""),
                password_algorithm: cleanName(accountState.password_algorithm || row.password_algorithm || (accountState.password_hash || row.password_hash ? "legacy_scrypt" : "")),
                session_token_hash: cleanName(row.session_token_hash || accountState.session_token_hash || ""),
                session_token_expires_at: cleanName(normalizeOptionalTimestamp(row.session_token_expires_at) || accountState.session_token_expires_at || ""),
                refresh_token_hash: cleanName(row.refresh_token_hash || accountState.refresh_token_hash || ""),
                refresh_token_expires_at: cleanName(normalizeOptionalTimestamp(row.refresh_expires_at) || accountState.refresh_token_expires_at || ""),
                email_verified: Boolean(row.email_verified),
                email_verified_at: cleanName(normalizeOptionalTimestamp(row.email_verified_at) || accountState.email_verified_at || ""),
                email_verification_token_hash: cleanName(row.email_verification_token_hash || accountState.email_verification_token_hash || ""),
                email_verification_expires_at: cleanName(normalizeOptionalTimestamp(row.email_verification_expires_at) || accountState.email_verification_expires_at || ""),
                role: cleanName(accountState.role || row.role || "player") || "player",
                created_at: cleanName(accountState.created_at || normalizeOptionalTimestamp(row.created_at) || ""),
                last_seen_at: cleanName(accountState.last_seen_at || normalizeOptionalTimestamp(row.last_login_at) || ""),
            };
        }
        catch (error) {
            this.logger("[postgres] single account load failed:", getErrorMessage(error));
            return null;
        }
    }
    async replaceInventorySnapshot(client, playerId, playerState) {
        if (!playerId)
            return;
        await client.query(`DELETE FROM ${this.table("inventory")} WHERE player_id = $1`, [playerId]);
        // The rows are identical to the previous one-INSERT-per-stack loop -- same filter, same
        // order, same row_version 0 -- but a full inventory now costs a single round trip
        // instead of one per stack, inside a transaction that already holds player row locks.
        const itemTypes = [];
        const itemCategories = [];
        const amounts = [];
        const stackLimits = [];
        for (const [field, fallbackCategory] of INVENTORY_FIELD_CATEGORY) {
            const bucket = toObject(playerState[field]);
            for (const [itemType, rawAmount] of Object.entries(bucket)) {
                const cleanItemType = cleanName(itemType);
                const amount = Math.max(0, toInt(rawAmount, 0));
                if (cleanItemType === "" || amount <= 0)
                    continue;
                itemTypes.push(cleanItemType);
                itemCategories.push(String(fallbackCategory));
                amounts.push(amount);
                stackLimits.push(getInventoryStackLimitForItem(cleanItemType));
            }
        }
        if (itemTypes.length > 0) {
            await client.query(`
        INSERT INTO ${this.table("inventory")} (
          player_id,
          item_type,
          item_category,
          amount,
          stack_limit,
          row_version,
          updated_at
        )
        SELECT $1, item_type, item_category, amount, stack_limit, 0, now()
          FROM UNNEST($2::text[], $3::text[], $4::bigint[], $5::bigint[])
            AS snapshot(item_type, item_category, amount, stack_limit)
        `, [playerId, itemTypes, itemCategories, amounts, stackLimits]);
        }
        await this.updatePlayerInventoryHash(client, playerId);
    }
    async reconcileItemInstancesForInventory(client, playerId, playerState, details = {}) {
        if (!playerId)
            return;
        const reconcileDetails = toObject(details);
        const allowCreateMissing = reconcileDetails.allow_create_missing !== false;
        const allowRetireExtra = reconcileDetails.allow_retire_extra !== false;
        const desiredCounts = new Map();
        for (const [field, fallbackCategory] of INVENTORY_FIELD_CATEGORY) {
            const bucket = toObject(playerState[field]);
            for (const [itemType, rawAmount] of Object.entries(bucket)) {
                const cleanItemType = cleanName(itemType);
                if (cleanItemType === "")
                    continue;
                const itemCategory = resolveItemCategory(cleanItemType, fallbackCategory);
                if (!shouldTrackItemInstance(cleanItemType, itemCategory))
                    continue;
                const amount = Math.max(0, toInt(rawAmount, 0));
                if (amount <= 0)
                    continue;
                const cappedAmount = Math.min(amount, ITEM_INSTANCE_RECONCILE_MAX_PER_ITEM);
                const key = `${cleanItemType}\u0000${itemCategory}`;
                desiredCounts.set(key, (desiredCounts.get(key) || 0) + cappedAmount);
            }
        }
        const activeResult = await client.query(`
      SELECT item_instance_id, item_type, item_category, owner_player_id, world_id, current_location
        FROM ${this.table("item_instances")}
       WHERE owner_player_id = $1
         AND state = 'active'
       ORDER BY created_at ASC
       FOR UPDATE
      `, [playerId]);
        const activeByItem = new Map();
        for (const row of activeResult.rows) {
            const itemType = cleanName(row.item_type);
            const itemCategory = resolveItemCategory(itemType, row.item_category || "");
            if (!shouldTrackItemInstance(itemType, itemCategory))
                continue;
            const key = `${itemType}\u0000${itemCategory}`;
            const itemRows = activeByItem.get(key) || [];
            itemRows.push(row);
            activeByItem.set(key, itemRows);
        }
        const source = extractItemInstanceSource(reconcileDetails, "inventory_snapshot_reconcile");
        const allKeys = new Set([...desiredCounts.keys(), ...activeByItem.keys()]);
        for (const key of allKeys) {
            const [itemType, itemCategory] = key.split("\u0000");
            const desiredAmount = Math.max(0, desiredCounts.get(key) || 0);
            const activeRows = activeByItem.get(key) || [];
            if (allowRetireExtra && activeRows.length > desiredAmount) {
                const retiredRows = activeRows.slice(desiredAmount);
                const retiredIds = retiredRows.map((row) => row.item_instance_id);
                await client.query(`
          UPDATE ${this.table("item_instances")}
             SET state = $2,
                 current_location = 'unknown',
                 metadata = metadata || $3::jsonb,
                 updated_at = now()
           WHERE item_instance_id = ANY($1::uuid[])
          `, [
                    retiredIds,
                    ITEM_INSTANCE_RETIRED_STATE,
                    JSON.stringify({
                        source: "inventory_snapshot_reconcile",
                        details: safeJson(details),
                    }),
                ]);
                for (const row of retiredRows) {
                    await this.recordItemInstanceEvent(client, {
                        item_instance_id: row.item_instance_id,
                        event_type: "retired",
                        from_player_id: row.owner_player_id,
                        to_player_id: row.owner_player_id,
                        from_location: row.current_location || "inventory",
                        to_location: "unknown",
                        world_id: row.world_id,
                        source,
                        metadata: {
                            reason: "inventory_snapshot_reconcile",
                            item_type: cleanName(itemType),
                            item_category: cleanName(itemCategory),
                            details: safeJson(details),
                        },
                    });
                }
            }
            const missingCount = desiredAmount - activeRows.length;
            if (!allowCreateMissing)
                continue;
            for (let i = 0; i < missingCount; i += 1) {
                const publicItemInstanceId = generatePublicItemInstanceId();
                const result = await client.query(`
          INSERT INTO ${this.table("item_instances")} (
            public_item_instance_id,
            item_type,
            item_category,
            owner_player_id,
            state,
            created_by_source,
            current_location,
            metadata,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, 'active', $5, 'inventory', $6::jsonb, now(), now())
          RETURNING item_instance_id, owner_player_id
          `, [
                    publicItemInstanceId,
                    cleanName(itemType),
                    cleanName(itemCategory),
                    playerId,
                    source,
                    JSON.stringify({
                        source: "inventory_snapshot_reconcile",
                        details: safeJson(details),
                    }),
                ]);
                await this.recordItemInstanceEvent(client, {
                    item_instance_id: result.rows[0]?.item_instance_id,
                    event_type: "created",
                    to_player_id: result.rows[0]?.owner_player_id || playerId,
                    to_location: "inventory",
                    source,
                    metadata: {
                        public_item_instance_id: publicItemInstanceId,
                        item_type: cleanName(itemType),
                        item_category: cleanName(itemCategory),
                        reason: "inventory_snapshot_reconcile",
                        details: safeJson(details),
                    },
                });
            }
        }
    }
    async recordItemInstanceEvent(client, entry = {}) {
        const e = toObject(entry);
        const itemInstanceId = cleanName(e.item_instance_id || e.instance_id || "");
        if (!isUuid(itemInstanceId))
            return null;
        const fromPlayerId = isUuid(e.from_player_id) ? cleanName(e.from_player_id) : null;
        const toPlayerId = isUuid(e.to_player_id) ? cleanName(e.to_player_id) : null;
        const worldId = isUuid(e.world_id) ? cleanName(e.world_id) : null;
        const correlationId = isUuid(e.correlation_id) ? cleanName(e.correlation_id) : null;
        const itemTransactionId = toInt(e.item_transaction_id, 0) > 0 ? toInt(e.item_transaction_id, 0) : null;
        await client.query(`
      INSERT INTO ${this.table("item_instance_events")} (
        item_instance_id,
        event_type,
        from_player_id,
        to_player_id,
        from_location,
        to_location,
        world_id,
        item_transaction_id,
        correlation_id,
        source,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7, $8, $9, $10, $11::jsonb, now())
      `, [
            itemInstanceId,
            normalizeItemInstanceEventType(e.event_type || e.type || "updated"),
            fromPlayerId,
            toPlayerId,
            normalizeItemInstanceLocation(e.from_location || "", "unknown"),
            normalizeItemInstanceLocation(e.to_location || "", "unknown"),
            worldId,
            itemTransactionId,
            correlationId,
            normalizeItemInstanceSource(e.source || "system"),
            JSON.stringify(safeJson(e.metadata || e.details || {})),
        ]);
        return { ok: true };
    }
    async getInventorySnapshotHash(client, playerId) {
        if (!isUuid(playerId))
            return null;
        const result = await client.query(`
      SELECT item_type, item_category, amount, stack_limit
        FROM ${this.table("inventory")}
       WHERE player_id = $1
         AND amount <> 0
       ORDER BY item_category ASC, item_type ASC
      `, [playerId]);
        const payload = result.rows.map((row) => ({
            item_type: cleanName(row.item_type || ""),
            item_category: cleanName(row.item_category || ""),
            amount: String(row.amount ?? "0"),
            stack_limit: String(row.stack_limit ?? "0"),
        }));
        return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    }
    async updatePlayerInventoryHash(client, playerId, inventoryHash = null) {
        if (!isUuid(playerId))
            return null;
        const nextHash = cleanName(inventoryHash || "") || await this.getInventorySnapshotHash(client, playerId);
        await client.query(`
      UPDATE ${this.table("players")}
         SET inventory_hash = $2,
             inventory_hash_algorithm = $3,
             inventory_hash_updated_at = now(),
             updated_at = now()
       WHERE player_id = $1
      `, [playerId, nextHash, INTEGRITY_HASH_ALGORITHM]);
        return nextHash;
    }
    async recordTransactionLedger(client, entry = {}) {
        const e = toObject(entry);
        const playerId = isUuid(e.player_id) ? cleanName(e.player_id) : null;
        const itemInstances = Array.isArray(e.item_instances)
            ? e.item_instances.map((item) => toObject(item)).filter((item) => isUuid(item.item_instance_id))
            : [];
        const rowsToWrite = itemInstances.length > 0 ? itemInstances : [null];
        const insertedIds = [];
        const rawIpAddress = cleanName(e.ip_address || e.ip || "");
        const ipAddress = net.isIP(rawIpAddress) ? rawIpAddress : null;
        const transactionType = cleanName(e.transaction_type || e.type || "")
            || normalizeTransactionLedgerType(e);
        const status = normalizeTransactionLedgerStatus(e.status || "success");
        const baseMetadata = safeJson(e.metadata);
        const transactionId = isUuid(e.transaction_id) ? cleanName(e.transaction_id) : crypto.randomUUID();
        const otherPlayerId = isUuid(e.other_player_id) ? cleanName(e.other_player_id) : null;
        const worldId = isUuid(e.world_id) ? cleanName(e.world_id) : null;
        const itemTransactionId = toInt(e.item_transaction_id, 0) > 0 ? toInt(e.item_transaction_id, 0) : null;
        const gemLedgerId = toInt(e.gem_ledger_id, 0) > 0 ? toInt(e.gem_ledger_id, 0) : null;
        const vendingTransactionId = toInt(e.vending_transaction_id, 0) > 0 ? toInt(e.vending_transaction_id, 0) : null;
        const shopPurchaseId = toInt(e.shop_purchase_id, 0) > 0 ? toInt(e.shop_purchase_id, 0) : null;
        const adminActionId = toInt(e.admin_action_id, 0) > 0 ? toInt(e.admin_action_id, 0) : null;
        const tradeId = isUuid(e.trade_id) ? cleanName(e.trade_id) : null;
        const correlationId = isUuid(e.correlation_id) ? cleanName(e.correlation_id) : null;
        const serverTime = normalizeOptionalTimestamp(e.server_time || e.at || "") || new Date().toISOString();
        const hasLedgerContext = playerId
            || otherPlayerId
            || worldId
            || itemInstances.length > 0
            || isUuid(e.item_instance_id)
            || cleanName(e.public_item_instance_id || "") !== ""
            || cleanName(e.item_type || e.item_id || "") !== ""
            || cleanName(e.action || "") !== "";
        if (!hasLedgerContext)
            return [];
        for (const itemInstance of rowsToWrite) {
            const itemInstanceId = itemInstance && isUuid(itemInstance.item_instance_id)
                ? cleanName(itemInstance.item_instance_id)
                : (isUuid(e.item_instance_id) ? cleanName(e.item_instance_id) : null);
            const publicItemInstanceId = itemInstance
                ? cleanName(itemInstance.public_item_instance_id || "")
                : cleanName(e.public_item_instance_id || "");
            const itemType = cleanName(e.item_type || itemInstance?.item_type || "");
            const itemCategory = cleanName(e.item_category || itemInstance?.item_category || "");
            const quantity = itemInstance ? (toInt(e.quantity, 0) < 0 ? -1 : 1) : toInt(e.quantity ?? e.delta ?? 0, 0);
            const metadata = itemInstance
                ? { ...baseMetadata, item_instance: summarizeItemInstanceEventMetadata(itemInstance), public_item_instance_id: publicItemInstanceId }
                : baseMetadata;
            const gemsBefore = Number.isFinite(Number(e.gems_before)) ? Math.trunc(Number(e.gems_before)) : null;
            const gemsAfter = Number.isFinite(Number(e.gems_after)) ? Math.trunc(Number(e.gems_after)) : null;
            const inventoryBeforeHash = cleanName(e.inventory_before_hash || "");
            const inventoryAfterHash = cleanName(e.inventory_after_hash || "");
            const sessionTokenHash = cleanName(e.session_token_hash || "");
            const userAgent = cleanName(e.user_agent || "");
            const deviceInfo = safeJson(e.device_info);
            const requestId = cleanName(e.request_id || "");
            const source = normalizeLedgerSource(e.source || e.source_type || "system");
            const action = cleanName(e.action || "");
            const transactionHash = buildTransactionLedgerHash({
                transaction_id: transactionId,
                transaction_type: transactionType,
                status,
                player_id: playerId,
                other_player_id: otherPlayerId,
                world_id: worldId,
                item_transaction_id: itemTransactionId,
                gem_ledger_id: gemLedgerId,
                trade_id: tradeId,
                vending_transaction_id: vendingTransactionId,
                shop_purchase_id: shopPurchaseId,
                admin_action_id: adminActionId,
                item_instance_id: itemInstanceId,
                public_item_instance_id: publicItemInstanceId,
                item_type: itemType,
                item_category: itemCategory,
                quantity,
                gems_before: gemsBefore,
                gems_after: gemsAfter,
                inventory_before_hash: inventoryBeforeHash,
                inventory_after_hash: inventoryAfterHash,
                ip_address: ipAddress,
                session_token_hash: sessionTokenHash,
                user_agent: userAgent,
                device_info: deviceInfo,
                request_id: requestId,
                correlation_id: correlationId,
                source,
                action,
                metadata,
                server_time: serverTime,
            });
            const result = await client.query(`
        INSERT INTO ${this.table("transaction_ledger")} (
          transaction_id,
          transaction_type,
          status,
          player_id,
          other_player_id,
          world_id,
          item_transaction_id,
          gem_ledger_id,
          trade_id,
          vending_transaction_id,
          shop_purchase_id,
          admin_action_id,
          item_instance_id,
          public_item_instance_id,
          item_type,
          item_category,
          quantity,
          gems_before,
          gems_after,
          inventory_before_hash,
          inventory_after_hash,
          ip_address,
          session_token_hash,
          user_agent,
          device_info,
          request_id,
          correlation_id,
          source,
          action,
          transaction_hash,
          transaction_hash_algorithm,
          metadata,
          server_time,
          created_at
        )
        VALUES (
          COALESCE($1::uuid, gen_random_uuid()),
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          NULLIF($14, ''),
          NULLIF($15, ''),
          NULLIF($16, ''),
          $17,
          $18,
          $19,
          NULLIF($20, ''),
          NULLIF($21, ''),
          $22::inet,
          NULLIF($23, ''),
          NULLIF($24, ''),
          $25::jsonb,
          NULLIF($26, ''),
          $27::uuid,
          NULLIF($28, ''),
          NULLIF($29, ''),
          NULLIF($30, ''),
          $31,
          $32::jsonb,
          $33::timestamptz,
          now()
        )
        RETURNING transaction_ledger_id
        `, [
                transactionId,
                transactionType,
                status,
                playerId,
                otherPlayerId,
                worldId,
                itemTransactionId,
                gemLedgerId,
                tradeId,
                vendingTransactionId,
                shopPurchaseId,
                adminActionId,
                itemInstanceId,
                publicItemInstanceId,
                itemType,
                itemCategory,
                quantity,
                gemsBefore,
                gemsAfter,
                inventoryBeforeHash,
                inventoryAfterHash,
                ipAddress,
                sessionTokenHash,
                userAgent,
                JSON.stringify(deviceInfo),
                requestId,
                correlationId,
                source,
                action,
                transactionHash,
                INTEGRITY_HASH_ALGORITHM,
                JSON.stringify(metadata),
                serverTime,
            ]);
            insertedIds.push(result.rows[0]?.transaction_ledger_id || null);
        }
        return insertedIds.filter((id) => id !== null);
    }
    async recordTransactionLedgerEvent(entry = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const e = toObject(entry);
        const username = cleanName(e.account_username || e.username || e.player_username || "");
        const otherUsername = cleanName(e.other_account_username || e.other_username || "");
        const worldName = cleanName(e.world || e.world_name || "");
        try {
            return await this.withTransaction(async (client) => {
                const playerId = isUuid(e.player_id)
                    ? cleanName(e.player_id)
                    : (username !== "" ? await this.ensurePlayerIdentityForExistingAccount(client, username, worldName) : null);
                const otherPlayerId = isUuid(e.other_player_id)
                    ? cleanName(e.other_player_id)
                    : (otherUsername !== "" ? await this.ensurePlayerIdentityForExistingAccount(client, otherUsername, worldName) : null);
                const worldId = isUuid(e.world_id)
                    ? cleanName(e.world_id)
                    : (worldName !== "" ? await this.ensureWorldIdentity(client, worldName) : null);
                const inventoryHash = playerId ? await this.getInventorySnapshotHash(client, playerId) : null;
                const ids = await this.recordTransactionLedger(client, {
                    ...e,
                    player_id: playerId,
                    other_player_id: otherPlayerId,
                    world_id: worldId,
                    inventory_before_hash: e.inventory_before_hash || inventoryHash || "",
                    inventory_after_hash: e.inventory_after_hash || inventoryHash || "",
                });
                return { ok: ids.length > 0, transaction_ledger_ids: ids };
            });
        }
        catch (error) {
            this.logger("[postgres] transaction ledger event failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async listTransactionLedger(entry = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const e = toObject(entry);
        const username = cleanName(e.username || e.account_username || e.player_username || e.target_username || "");
        const publicItemInstanceId = cleanName(e.public_item_instance_id || e.item_instance_public_id || e.item_instance_id || "");
        const itemType = cleanName(e.item_type || e.item_id || "");
        const transactionType = cleanName(e.transaction_type || e.type || "").toUpperCase();
        const status = cleanName(e.status || "").toLowerCase();
        const limit = Math.min(250, Math.max(1, toInt(e.limit, 100)));
        if (username === "" && publicItemInstanceId === "" && itemType === "" && transactionType === "") {
            return { ok: false, reason: "target_required" };
        }
        const where = [];
        const params = [];
        const addParam = (value) => {
            params.push(value);
            return `$${params.length}`;
        };
        if (username !== "") {
            const p = addParam(username);
            where.push(`(lower(actor_account.username) = lower(${p}) OR lower(other_account.username) = lower(${p}))`);
        }
        if (publicItemInstanceId !== "") {
            if (isUuid(publicItemInstanceId)) {
                where.push(`tl.item_instance_id = ${addParam(publicItemInstanceId)}::uuid`);
            }
            else {
                where.push(`lower(tl.public_item_instance_id) = lower(${addParam(publicItemInstanceId)})`);
            }
        }
        if (itemType !== "") {
            where.push(`tl.item_type = ${addParam(itemType)}`);
        }
        if (transactionType !== "") {
            where.push(`tl.transaction_type = ${addParam(transactionType)}`);
        }
        if (status !== "" && TRANSACTION_LEDGER_STATUSES.has(status)) {
            where.push(`tl.status = ${addParam(status)}`);
        }
        params.push(limit);
        const limitParam = `$${params.length}`;
        try {
            const result = await this.db.query(`
        SELECT tl.transaction_ledger_id,
               tl.transaction_id,
               tl.transaction_type,
               tl.status,
               actor_account.username::text AS username,
               other_account.username::text AS other_username,
               worlds.world_name::text AS world_name,
               tl.item_instance_id,
               tl.public_item_instance_id,
               tl.item_type,
               tl.item_category,
               tl.quantity,
               tl.gems_before,
               tl.gems_after,
               tl.inventory_before_hash,
               tl.inventory_after_hash,
               tl.transaction_hash,
               tl.transaction_hash_algorithm,
               tl.ip_address::text AS ip_address,
               tl.session_token_hash,
               tl.user_agent,
               tl.device_info,
               tl.request_id,
               tl.correlation_id,
               tl.source,
               tl.action,
               tl.metadata,
               tl.server_time,
               tl.created_at
          FROM ${this.table("transaction_ledger")} tl
          LEFT JOIN ${this.table("players")} actor_player ON actor_player.player_id = tl.player_id
          LEFT JOIN ${this.table("accounts")} actor_account ON actor_account.account_id = actor_player.account_id
          LEFT JOIN ${this.table("players")} other_player ON other_player.player_id = tl.other_player_id
          LEFT JOIN ${this.table("accounts")} other_account ON other_account.account_id = other_player.account_id
          LEFT JOIN ${this.table("worlds")} worlds ON worlds.world_id = tl.world_id
         WHERE ${where.join(" AND ")}
         ORDER BY tl.server_time DESC, tl.transaction_ledger_id DESC
         LIMIT ${limitParam}
        `, params);
            return {
                ok: true,
                query: {
                    username,
                    public_item_instance_id: publicItemInstanceId,
                    item_type: itemType,
                    transaction_type: transactionType,
                    status,
                    limit,
                },
                entries: result.rows.map((row) => ({
                    transaction_ledger_id: toInt(row.transaction_ledger_id, 0),
                    transaction_id: cleanName(row.transaction_id || ""),
                    transaction_type: cleanName(row.transaction_type || ""),
                    status: cleanName(row.status || ""),
                    username: cleanName(row.username || ""),
                    other_username: cleanName(row.other_username || ""),
                    world_name: cleanName(row.world_name || ""),
                    item_instance_id: cleanName(row.item_instance_id || ""),
                    public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                    item_type: cleanName(row.item_type || ""),
                    item_category: cleanName(row.item_category || ""),
                    quantity: toInt(row.quantity, 0),
                    gems_before: row.gems_before == null ? null : toInt(row.gems_before, 0),
                    gems_after: row.gems_after == null ? null : toInt(row.gems_after, 0),
                    inventory_before_hash: cleanName(row.inventory_before_hash || ""),
                    inventory_after_hash: cleanName(row.inventory_after_hash || ""),
                    transaction_hash: cleanName(row.transaction_hash || ""),
                    transaction_hash_algorithm: cleanName(row.transaction_hash_algorithm || ""),
                    ip_address: cleanName(row.ip_address || ""),
                    session_token_hash: cleanName(row.session_token_hash || ""),
                    user_agent: cleanName(row.user_agent || ""),
                    device_info: safeJson(row.device_info),
                    request_id: cleanName(row.request_id || ""),
                    correlation_id: cleanName(row.correlation_id || ""),
                    source: cleanName(row.source || ""),
                    action: cleanName(row.action || ""),
                    metadata: safeJson(row.metadata),
                    server_time: normalizeOptionalTimestamp(row.server_time),
                    created_at: normalizeOptionalTimestamp(row.created_at),
                })),
            };
        }
        catch (error) {
            this.logger("[postgres] transaction ledger lookup failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async createItemInstance(entry = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const e = toObject(entry);
        const itemType = cleanName(e.item_type || e.item_id || "");
        const itemCategory = resolveItemCategory(itemType, e.item_category || e.category || "");
        const ownerUsername = cleanName(e.owner_username || e.account_username || e.username || "");
        const worldName = cleanName(e.world || e.world_name || "");
        const state = normalizeItemInstanceState(e.state || ITEM_INSTANCE_ACTIVE_STATE);
        const createdBySource = normalizeItemInstanceSource(e.created_by_source || e.source || e.created_source || toObject(e.metadata).source || "system");
        const currentLocation = normalizeItemInstanceLocation(e.current_location || e.location || "inventory");
        if (itemType === "" || itemCategory === "")
            return { ok: false, reason: "invalid_item" };
        if (!shouldTrackItemInstance(itemType, itemCategory) && !e.force) {
            return { ok: false, reason: "not_instance_tracked" };
        }
        try {
            return await this.withTransaction(async (client) => {
                const ownerPlayerId = ownerUsername !== ""
                    ? await this.lookupPlayerIdByUsername(client, ownerUsername)
                    : null;
                if (ownerUsername !== "" && !ownerPlayerId)
                    return { ok: false, reason: "owner_not_found" };
                const worldId = worldName !== ""
                    ? await this.ensureWorldIdentity(client, worldName)
                    : null;
                const originTransactionId = Number.isFinite(Number(e.origin_transaction_id))
                    ? Math.trunc(Number(e.origin_transaction_id))
                    : null;
                const publicItemInstanceId = cleanName(e.public_item_instance_id || e.item_instance_public_id || "") || generatePublicItemInstanceId();
                const result = await client.query(`
          INSERT INTO ${this.table("item_instances")} (
            public_item_instance_id,
            item_type,
            item_category,
            owner_player_id,
            world_id,
            state,
            created_by_source,
            current_location,
            origin_transaction_id,
            metadata,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now(), now())
          RETURNING item_instance_id, public_item_instance_id
          `, [
                    publicItemInstanceId,
                    itemType,
                    itemCategory,
                    ownerPlayerId,
                    worldId,
                    state,
                    createdBySource,
                    currentLocation,
                    originTransactionId,
                    JSON.stringify(safeJson(e.metadata || e.details || {})),
                ]);
                await this.recordItemInstanceEvent(client, {
                    item_instance_id: result.rows[0]?.item_instance_id,
                    event_type: "created",
                    to_player_id: ownerPlayerId,
                    to_location: currentLocation,
                    world_id: worldId,
                    item_transaction_id: originTransactionId,
                    source: createdBySource,
                    metadata: {
                        public_item_instance_id: cleanName(result.rows[0]?.public_item_instance_id || publicItemInstanceId),
                        item_type: itemType,
                        item_category: itemCategory,
                        state,
                        details: safeJson(e.metadata || e.details || {}),
                    },
                });
                return {
                    ok: true,
                    item_instance_id: cleanName(result.rows[0]?.item_instance_id || ""),
                    public_item_instance_id: cleanName(result.rows[0]?.public_item_instance_id || publicItemInstanceId),
                    item_type: itemType,
                    item_category: itemCategory,
                    state,
                    created_by_source: createdBySource,
                    current_location: currentLocation,
                };
            });
        }
        catch (error) {
            this.logger("[postgres] item instance create failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    mirrorItemInstance(entry = {}) {
        if (!this.isReady())
            return;
        this.runDetached("mirror item instance", async () => {
            await this.createItemInstance(entry);
        });
    }
    async updateItemInstance(entry = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const e = toObject(entry);
        const itemInstanceId = cleanName(e.item_instance_id || e.instance_id || "");
        if (!isUuid(itemInstanceId))
            return { ok: false, reason: "invalid_item_instance_id" };
        const ownerUsername = cleanName(e.owner_username || e.account_username || e.username || "");
        const worldName = cleanName(e.world || e.world_name || "");
        const requestedState = cleanName(e.state || "");
        const requestedLocation = cleanName(e.current_location || e.location || "");
        const source = normalizeItemInstanceSource(e.source || e.updated_by_source || toObject(e.metadata).source || "system");
        try {
            return await this.withTransaction(async (client) => {
                const previousResult = await client.query(`
          SELECT item_instance_id, public_item_instance_id, item_type, item_category, owner_player_id, world_id, state, current_location
            FROM ${this.table("item_instances")}
           WHERE item_instance_id = $1
           FOR UPDATE
          `, [itemInstanceId]);
                const previous = previousResult.rows[0];
                if (!previous)
                    return { ok: false, reason: "item_instance_not_found" };
                const ownerPlayerId = ownerUsername !== ""
                    ? await this.lookupPlayerIdByUsername(client, ownerUsername)
                    : null;
                if (ownerUsername !== "" && !ownerPlayerId)
                    return { ok: false, reason: "owner_not_found" };
                const worldId = worldName !== ""
                    ? await this.ensureWorldIdentity(client, worldName)
                    : null;
                const state = requestedState !== ""
                    ? normalizeItemInstanceState(requestedState, previous.state || ITEM_INSTANCE_ACTIVE_STATE)
                    : normalizeItemInstanceState(previous.state || ITEM_INSTANCE_ACTIVE_STATE);
                const currentLocation = requestedLocation !== ""
                    ? normalizeItemInstanceLocation(requestedLocation, previous.current_location || "inventory")
                    : normalizeItemInstanceLocation(previous.current_location || "inventory");
                const result = await client.query(`
          UPDATE ${this.table("item_instances")}
             SET owner_player_id = COALESCE($2, owner_player_id),
                 world_id = COALESCE($3, world_id),
                 state = $4,
                 current_location = $5,
                 metadata = metadata || $6::jsonb,
                 updated_at = now()
           WHERE item_instance_id = $1
          RETURNING item_instance_id, public_item_instance_id, item_type, item_category, owner_player_id, world_id, state, current_location
          `, [
                    itemInstanceId,
                    ownerPlayerId,
                    worldId,
                    state,
                    currentLocation,
                    JSON.stringify(safeJson(e.metadata || e.details || {})),
                ]);
                const row = result.rows[0];
                if (!row)
                    return { ok: false, reason: "item_instance_not_found" };
                let eventType = "updated";
                if (cleanName(previous.owner_player_id || "") !== cleanName(row.owner_player_id || "")) {
                    eventType = "owner_changed";
                }
                else if (cleanName(previous.current_location || "") !== cleanName(row.current_location || "")) {
                    eventType = "location_changed";
                }
                else if (cleanName(previous.state || "") !== cleanName(row.state || "")) {
                    eventType = "state_changed";
                }
                await this.recordItemInstanceEvent(client, {
                    item_instance_id: row.item_instance_id,
                    event_type: eventType,
                    from_player_id: previous.owner_player_id,
                    to_player_id: row.owner_player_id,
                    from_location: previous.current_location || "unknown",
                    to_location: row.current_location || "unknown",
                    world_id: row.world_id || previous.world_id,
                    source,
                    metadata: {
                        public_item_instance_id: cleanName(row.public_item_instance_id || previous.public_item_instance_id || ""),
                        item_type: cleanName(row.item_type || ""),
                        item_category: cleanName(row.item_category || ""),
                        previous_state: cleanName(previous.state || ""),
                        state: cleanName(row.state || ""),
                        details: safeJson(e.metadata || e.details || {}),
                    },
                });
                return {
                    ok: true,
                    item_instance_id: cleanName(row.item_instance_id || ""),
                    public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                    item_type: cleanName(row.item_type || ""),
                    item_category: cleanName(row.item_category || ""),
                    state: cleanName(row.state || ""),
                    current_location: cleanName(row.current_location || ""),
                };
            });
        }
        catch (error) {
            this.logger("[postgres] item instance update failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async listActiveItemInstances(username, options = {}) {
        if (!this.isReady())
            return [];
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return [];
        const itemType = cleanName(options.item_type || options.item_id || "");
        const itemCategory = resolveItemCategory(itemType, options.item_category || options.category || "");
        const limit = Math.min(500, Math.max(1, toInt(options.limit, 100)));
        try {
            const result = await this.db.query(`
        SELECT ii.item_instance_id,
               ii.public_item_instance_id,
               ii.item_type,
               ii.item_category,
               ii.state,
               ii.created_by_source,
               ii.current_location,
               ii.metadata,
               ii.created_at,
               ii.updated_at
          FROM ${this.table("item_instances")} ii
          JOIN ${this.table("players")} p ON p.player_id = ii.owner_player_id
          JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
         WHERE lower(a.username) = lower($1)
           AND ii.state = 'active'
           AND ($2 = '' OR ii.item_type = $2)
           AND ($3 = '' OR ii.item_category = $3)
         ORDER BY ii.created_at ASC
         LIMIT $4
        `, [cleanUsername, itemType, itemCategory, limit]);
            return result.rows.map((row) => ({
                item_instance_id: cleanName(row.item_instance_id || ""),
                public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                item_type: cleanName(row.item_type || ""),
                item_category: cleanName(row.item_category || ""),
                state: cleanName(row.state || ""),
                created_by_source: cleanName(row.created_by_source || ""),
                current_location: cleanName(row.current_location || ""),
                metadata: toObject(row.metadata),
                created_at: normalizeOptionalTimestamp(row.created_at),
                updated_at: normalizeOptionalTimestamp(row.updated_at),
            }));
        }
        catch (error) {
            this.logger("[postgres] item instance list failed:", getErrorMessage(error));
            return [];
        }
    }
    async listItemInstanceCopies(identifier, options = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanIdentifier = cleanName(identifier);
        if (cleanIdentifier === "")
            return { ok: false, reason: "invalid_item_instance" };
        const limit = Math.min(500, Math.max(1, toInt(options.limit, 100)));
        const lookupByUuid = isUuid(cleanIdentifier);
        const lookupByPublicId = cleanIdentifier.toUpperCase().startsWith("PM-ITEM-");
        let anchor = null;
        let itemType = cleanName(options.item_type || options.item_id || "");
        try {
            if (lookupByUuid || lookupByPublicId) {
                const anchorResult = await this.db.query(`
          SELECT item_instance_id,
                 public_item_instance_id,
                 item_type,
                 item_category
            FROM ${this.table("item_instances")}
           WHERE ${lookupByUuid ? "item_instance_id = $1::uuid" : "lower(public_item_instance_id) = lower($1)"}
           LIMIT 1
          `, [cleanIdentifier]);
                anchor = anchorResult.rows[0] || null;
                itemType = cleanName(anchor?.item_type || "");
            }
            else {
                itemType = cleanIdentifier;
            }
            if (itemType === "")
                return { ok: false, reason: "item_instance_not_found" };
            const result = await this.db.query(`
        WITH public_id_counts AS (
          SELECT public_item_instance_id, count(*)::int AS public_id_count
            FROM ${this.table("item_instances")}
           GROUP BY public_item_instance_id
        )
        SELECT ii.item_instance_id,
               ii.public_item_instance_id,
               ii.item_type,
               ii.item_category,
               ii.owner_player_id,
               owner_account.username::text AS owner_username,
               ii.world_id,
               iw.world_name::text AS world_name,
               ii.state,
               ii.created_by_source,
               ii.current_location,
               ii.metadata,
               ii.created_at,
               ii.updated_at,
               coalesce(pic.public_id_count, 0)::int AS public_id_count
          FROM ${this.table("item_instances")} ii
          LEFT JOIN public_id_counts pic ON pic.public_item_instance_id = ii.public_item_instance_id
          LEFT JOIN ${this.table("players")} owner_player ON owner_player.player_id = ii.owner_player_id
          LEFT JOIN ${this.table("accounts")} owner_account ON owner_account.account_id = owner_player.account_id
          LEFT JOIN ${this.table("worlds")} iw ON iw.world_id = ii.world_id
         WHERE ii.item_type = $1
         ORDER BY
              CASE WHEN ii.state = 'active' THEN 0 ELSE 1 END,
              ii.created_at ASC,
              ii.public_item_instance_id ASC
         LIMIT $2
        `, [itemType, limit]);
            const copies = result.rows.map((row) => ({
                item_instance_id: cleanName(row.item_instance_id || ""),
                public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                item_type: cleanName(row.item_type || ""),
                item_category: cleanName(row.item_category || ""),
                state: cleanName(row.state || ""),
                current_location: cleanName(row.current_location || ""),
                current_owner_username: cleanName(row.owner_username || ""),
                world_name: cleanName(row.world_name || ""),
                created_by_source: cleanName(row.created_by_source || ""),
                metadata: toObject(row.metadata),
                public_id_count: toInt(row.public_id_count, 0),
                possible_duplicate: toInt(row.public_id_count, 0) !== 1,
                created_at: normalizeOptionalTimestamp(row.created_at),
                updated_at: normalizeOptionalTimestamp(row.updated_at),
            }));
            const summary = copies.reduce((acc, row) => {
                acc.total += 1;
                if (row.state === ITEM_INSTANCE_ACTIVE_STATE)
                    acc.active += 1;
                if (row.state === "locked")
                    acc.frozen += 1;
                if (row.state === "destroyed" || row.state === "consumed")
                    acc.retired += 1;
                if (row.possible_duplicate)
                    acc.duplicate_public_ids += 1;
                if (row.current_location === "inventory")
                    acc.inventory += 1;
                if (row.current_location === "vending")
                    acc.vending += 1;
                if (row.current_location === "trade")
                    acc.trade += 1;
                if (row.current_location === "world_drop")
                    acc.world_drop += 1;
                return acc;
            }, {
                total: 0,
                active: 0,
                frozen: 0,
                retired: 0,
                duplicate_public_ids: 0,
                inventory: 0,
                vending: 0,
                trade: 0,
                world_drop: 0,
            });
            return {
                ok: true,
                query: {
                    identifier: cleanIdentifier,
                    item_type: itemType,
                    anchored_public_item_instance_id: cleanName(anchor?.public_item_instance_id || ""),
                },
                summary,
                copies,
            };
        }
        catch (error) {
            this.logger("[postgres] item instance copies lookup failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async getItemInstanceHistory(identifier, options = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanIdentifier = cleanName(identifier);
        if (cleanIdentifier === "")
            return { ok: false, reason: "invalid_item_instance" };
        const limit = Math.min(100, Math.max(1, toInt(options.limit, 40)));
        const lookupByUuid = isUuid(cleanIdentifier);
        try {
            const instanceResult = await this.db.query(`
        SELECT ii.item_instance_id,
               ii.public_item_instance_id,
               ii.item_type,
               ii.item_category,
               ii.owner_player_id,
               owner_account.username::text AS owner_username,
               ii.world_id,
               iw.world_name::text AS world_name,
               ii.state,
               ii.created_by_source,
               ii.current_location,
               ii.metadata,
               ii.created_at,
               ii.updated_at,
               (
                 SELECT count(*)
                   FROM ${this.table("item_instances")} dup
                  WHERE dup.public_item_instance_id = ii.public_item_instance_id
               )::int AS public_id_count
          FROM ${this.table("item_instances")} ii
          LEFT JOIN ${this.table("players")} owner_player ON owner_player.player_id = ii.owner_player_id
          LEFT JOIN ${this.table("accounts")} owner_account ON owner_account.account_id = owner_player.account_id
          LEFT JOIN ${this.table("worlds")} iw ON iw.world_id = ii.world_id
         WHERE ${lookupByUuid ? "ii.item_instance_id = $1::uuid" : "lower(ii.public_item_instance_id) = lower($1)"}
         LIMIT 1
        `, [cleanIdentifier]);
            const row = instanceResult.rows[0];
            if (!row?.item_instance_id)
                return { ok: false, reason: "item_instance_not_found" };
            const eventsResult = await this.db.query(`
        SELECT e.item_instance_event_id,
               e.item_instance_id,
               e.event_type,
               e.from_player_id,
               from_account.username::text AS from_username,
               e.to_player_id,
               to_account.username::text AS to_username,
               e.from_location,
               e.to_location,
               e.world_id,
               ew.world_name::text AS world_name,
               e.item_transaction_id,
               e.correlation_id,
               e.source,
               e.metadata,
               e.created_at
          FROM ${this.table("item_instance_events")} e
          LEFT JOIN ${this.table("players")} from_player ON from_player.player_id = e.from_player_id
          LEFT JOIN ${this.table("accounts")} from_account ON from_account.account_id = from_player.account_id
          LEFT JOIN ${this.table("players")} to_player ON to_player.player_id = e.to_player_id
          LEFT JOIN ${this.table("accounts")} to_account ON to_account.account_id = to_player.account_id
          LEFT JOIN ${this.table("worlds")} ew ON ew.world_id = e.world_id
         WHERE e.item_instance_id = $1
         ORDER BY e.created_at ASC, e.item_instance_event_id ASC
         LIMIT $2
        `, [row.item_instance_id, limit]);
            const events = eventsResult.rows.map((eventRow) => ({
                event_id: toInt(eventRow.item_instance_event_id, 0),
                event_type: cleanName(eventRow.event_type || ""),
                from_username: cleanName(eventRow.from_username || ""),
                to_username: cleanName(eventRow.to_username || ""),
                from_location: cleanName(eventRow.from_location || ""),
                to_location: cleanName(eventRow.to_location || ""),
                world_name: cleanName(eventRow.world_name || ""),
                source: cleanName(eventRow.source || ""),
                item_transaction_id: toInt(eventRow.item_transaction_id, 0),
                correlation_id: cleanName(eventRow.correlation_id || ""),
                metadata: summarizeItemInstanceEventMetadata(eventRow.metadata),
                created_at: normalizeOptionalTimestamp(eventRow.created_at),
            }));
            const originEvent = events.find((event) => event.event_type === "created" || event.event_type === "reconciled") || events[0] || null;
            const source = cleanName(row.created_by_source || originEvent?.source || "unknown");
            const sourceLower = source.toLowerCase();
            const reconstructedSource = sourceLower.includes("reconcile")
                || sourceLower.includes("startup")
                || sourceLower.includes("save_player_state")
                || sourceLower.includes("inventory_snapshot");
            const flags = [];
            const publicIdCount = toInt(row.public_id_count, 0);
            if (publicIdCount !== 1)
                flags.push("duplicate_public_id");
            if (!originEvent)
                flags.push("no_origin_event");
            if (reconstructedSource)
                flags.push("reconstructed_source");
            if (cleanName(row.state || "") === "active" && cleanName(row.current_location || "") === "unknown") {
                flags.push("active_unknown_location");
            }
            const ownerUsername = cleanName(row.owner_username || "");
            const originOwnerUsername = cleanName(originEvent?.to_username || ownerUsername);
            return {
                ok: true,
                item_instance: {
                    item_instance_id: cleanName(row.item_instance_id || ""),
                    public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                    item_type: cleanName(row.item_type || ""),
                    item_category: cleanName(row.item_category || ""),
                    state: cleanName(row.state || ""),
                    current_location: cleanName(row.current_location || ""),
                    current_owner_username: ownerUsername,
                    original_owner_username: originOwnerUsername,
                    world_name: cleanName(row.world_name || ""),
                    created_by_source: source,
                    source_confidence: reconstructedSource ? "reconstructed" : "direct",
                    origin_source: cleanName(originEvent?.source || source),
                    origin_event_type: cleanName(originEvent?.event_type || ""),
                    created_at: normalizeOptionalTimestamp(row.created_at),
                    updated_at: normalizeOptionalTimestamp(row.updated_at),
                },
                integrity: {
                    public_id_count: publicIdCount,
                    event_count: events.length,
                    flags,
                    possible_duplicate: flags.includes("duplicate_public_id"),
                    reconstructed_source: reconstructedSource,
                },
                events,
            };
        }
        catch (error) {
            this.logger("[postgres] item instance history lookup failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async adjustInventoryForItemInstanceModeration(client, entry = {}) {
        const e = toObject(entry);
        const playerId = cleanName(e.player_id || "");
        const itemType = cleanName(e.item_type || "");
        const itemCategory = resolveItemCategory(itemType, e.item_category || "");
        const delta = toInt(e.delta, 0);
        if (!isUuid(playerId) || itemType === "" || itemCategory === "" || delta === 0)
            return null;
        const stackLimit = getInventoryStackLimitForItem(itemType, e.stack_limit || DEFAULT_INVENTORY_STACK_LIMIT);
        const inventoryResult = await client.query(`
      SELECT amount, stack_limit
        FROM ${this.table("inventory")}
       WHERE player_id = $1
         AND item_type = $2
         AND item_category = $3
       FOR UPDATE
      `, [playerId, itemType, itemCategory]);
        const existing = inventoryResult.rows[0];
        const beforeAmount = Math.max(0, toInt(existing?.amount || 0, 0));
        const storedStackLimit = clampStackLimit(existing?.stack_limit || stackLimit, stackLimit);
        const effectiveStackLimit = Math.max(stackLimit, storedStackLimit);
        let afterAmount = beforeAmount + delta;
        if (delta < 0)
            afterAmount = Math.max(0, afterAmount);
        if (delta > 0 && afterAmount > effectiveStackLimit) {
            return {
                ok: false,
                reason: "insufficient_capacity",
                player_id: playerId,
                item_type: itemType,
                item_category: itemCategory,
                before_amount: beforeAmount,
                after_amount: afterAmount,
                stack_limit: effectiveStackLimit,
            };
        }
        if (existing) {
            await client.query(`
        UPDATE ${this.table("inventory")}
           SET amount = $4,
               stack_limit = $5,
               row_version = ${this.table("inventory")}.row_version + 1,
               updated_at = now()
         WHERE player_id = $1
           AND item_type = $2
           AND item_category = $3
        `, [playerId, itemType, itemCategory, afterAmount, effectiveStackLimit]);
        }
        else if (afterAmount > 0) {
            await client.query(`
        INSERT INTO ${this.table("inventory")} (
          player_id,
          item_type,
          item_category,
          amount,
          stack_limit,
          row_version,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 1, now())
        `, [playerId, itemType, itemCategory, afterAmount, effectiveStackLimit]);
        }
        const transactionResult = await client.query(`
      INSERT INTO ${this.table("item_transactions")} (
        player_id,
        world_id,
        source,
        action,
        item_type,
        item_category,
        delta,
        before_amount,
        after_amount,
        request_id,
        metadata,
        created_at
      )
      VALUES ($1, $2, 'admin', $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10::jsonb, now())
      RETURNING item_transaction_id
      `, [
            playerId,
            isUuid(e.world_id) ? cleanName(e.world_id) : null,
            cleanName(e.action || "item_instance_admin") || "item_instance_admin",
            itemType,
            itemCategory,
            delta,
            beforeAmount,
            afterAmount,
            cleanName(e.request_id || ""),
            JSON.stringify(safeJson(e.metadata || e.details || {})),
        ]);
        return {
            ok: true,
            player_id: playerId,
            username: await this.lookupUsernameByPlayerId(client, playerId),
            item_type: itemType,
            item_category: itemCategory,
            delta,
            before_amount: beforeAmount,
            after_amount: afterAmount,
            stack_limit: effectiveStackLimit,
            item_transaction_id: toInt(transactionResult.rows[0]?.item_transaction_id, 0),
        };
    }
    async moderateItemInstance(identifier, action, options = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const itemIdentifier = cleanName(identifier);
        const requestedAction = cleanName(action || options.action || "").toLowerCase().replace(/-/g, "_");
        const actionAliases = {
            delete: "retire",
            remove: "retire",
            destroy: "retire",
            unfreeze: "unfreeze",
            thaw: "unfreeze",
        };
        const normalizedAction = actionAliases[requestedAction] || requestedAction;
        const allowedActions = new Set(["freeze", "unfreeze", "retire", "transfer", "flag"]);
        if (itemIdentifier === "")
            return { ok: false, reason: "invalid_item_instance" };
        if (!allowedActions.has(normalizedAction))
            return { ok: false, reason: "invalid_action" };
        const e = toObject(options);
        const actorUsername = cleanName(e.actor_username || e.admin_username || "");
        const reason = cleanName(e.reason || "") || "admin item moderation";
        const requestId = cleanName(e.request_id || "");
        const lookupByUuid = isUuid(itemIdentifier);
        try {
            return await this.withTransaction(async (client) => {
                const instanceResult = await client.query(`
          SELECT item_instance_id,
                 public_item_instance_id,
                 item_type,
                 item_category,
                 owner_player_id,
                 world_id,
                 state,
                 created_by_source,
                 current_location,
                 metadata,
                 created_at,
                 updated_at
            FROM ${this.table("item_instances")}
           WHERE ${lookupByUuid ? "item_instance_id = $1::uuid" : "lower(public_item_instance_id) = lower($1)"}
           LIMIT 1
           FOR UPDATE
          `, [itemIdentifier]);
                const previous = instanceResult.rows[0];
                if (!previous?.item_instance_id)
                    return { ok: false, reason: "item_instance_not_found" };
                const itemType = cleanName(previous.item_type || "");
                const itemCategory = resolveItemCategory(itemType, previous.item_category || "");
                const previousOwnerId = isUuid(previous.owner_player_id) ? cleanName(previous.owner_player_id) : null;
                const previousState = normalizeItemInstanceState(previous.state || ITEM_INSTANCE_ACTIVE_STATE);
                const previousLocation = normalizeItemInstanceLocation(previous.current_location || "unknown", "unknown");
                const previousOwnerUsername = previousOwnerId ? await this.lookupUsernameByPlayerId(client, previousOwnerId) : "";
                const wasActiveInventory = previousState === ITEM_INSTANCE_ACTIVE_STATE && previousLocation === "inventory";
                const inventoryEffects = [];
                let targetPlayerId = previousOwnerId;
                let targetUsername = previousOwnerUsername;
                let nextState = previousState;
                let nextLocation = previousLocation;
                let eventType = "updated";
                let eventTransactionId = null;
                const moderationMetadata = {
                    anti_dupe_action: normalizedAction,
                    actor_username: actorUsername,
                    reason,
                    request_id: requestId,
                    previous_state: previousState,
                    previous_location: previousLocation,
                    previous_owner_username: previousOwnerUsername,
                };
                const applyInventoryEffect = async (playerId, delta) => {
                    const effect = await this.adjustInventoryForItemInstanceModeration(client, {
                        player_id: playerId,
                        world_id: previous.world_id,
                        item_type: itemType,
                        item_category: itemCategory,
                        delta,
                        action: `item_instance_${normalizedAction}`,
                        request_id: requestId,
                        metadata: {
                            ...moderationMetadata,
                            item_instance_id: cleanName(previous.item_instance_id || ""),
                            public_item_instance_id: cleanName(previous.public_item_instance_id || ""),
                        },
                    });
                    if (!effect)
                        return null;
                    if (!effect.ok)
                        return effect;
                    inventoryEffects.push(effect);
                    if (!eventTransactionId)
                        eventTransactionId = effect.item_transaction_id || null;
                    return effect;
                };
                if (normalizedAction === "freeze") {
                    nextState = "locked";
                    nextLocation = "safe";
                    eventType = "state_changed";
                    if (previousOwnerId && wasActiveInventory) {
                        const effect = await applyInventoryEffect(previousOwnerId, -1);
                        if (effect && !effect.ok)
                            return effect;
                    }
                }
                else if (normalizedAction === "unfreeze") {
                    if (!previousOwnerId)
                        return { ok: false, reason: "owner_required" };
                    nextState = ITEM_INSTANCE_ACTIVE_STATE;
                    nextLocation = "inventory";
                    eventType = "state_changed";
                    if (!wasActiveInventory) {
                        const effect = await applyInventoryEffect(previousOwnerId, 1);
                        if (effect && !effect.ok)
                            return effect;
                    }
                }
                else if (normalizedAction === "retire") {
                    nextState = "destroyed";
                    nextLocation = "unknown";
                    eventType = "retired";
                    if (previousOwnerId && wasActiveInventory) {
                        const effect = await applyInventoryEffect(previousOwnerId, -1);
                        if (effect && !effect.ok)
                            return effect;
                    }
                }
                else if (normalizedAction === "transfer") {
                    targetUsername = cleanName(e.target_username || e.to_username || e.username || "");
                    if (targetUsername === "")
                        return { ok: false, reason: "target_required" };
                    targetPlayerId = await this.lookupPlayerIdByUsername(client, targetUsername);
                    if (!targetPlayerId)
                        return { ok: false, reason: "target_not_found" };
                    targetUsername = await this.lookupUsernameByPlayerId(client, targetPlayerId) || targetUsername;
                    nextState = ITEM_INSTANCE_ACTIVE_STATE;
                    nextLocation = "inventory";
                    eventType = previousOwnerId !== targetPlayerId ? "owner_changed" : "location_changed";
                    moderationMetadata.target_username = targetUsername;
                    if (!wasActiveInventory || previousOwnerId !== targetPlayerId) {
                        const effect = await applyInventoryEffect(targetPlayerId, 1);
                        if (effect && !effect.ok)
                            return effect;
                    }
                    if (previousOwnerId && previousOwnerId !== targetPlayerId && wasActiveInventory) {
                        const effect = await applyInventoryEffect(previousOwnerId, -1);
                        if (effect && !effect.ok)
                            return effect;
                    }
                }
                else if (normalizedAction === "flag") {
                    eventType = "updated";
                    moderationMetadata.flagged = true;
                    moderationMetadata.flagged_at = new Date().toISOString();
                }
                const updateResult = await client.query(`
          UPDATE ${this.table("item_instances")}
             SET owner_player_id = $2,
                 state = $3,
                 current_location = $4,
                 metadata = metadata || $5::jsonb,
                 updated_at = now()
           WHERE item_instance_id = $1
          RETURNING item_instance_id,
                    public_item_instance_id,
                    item_type,
                    item_category,
                    owner_player_id,
                    world_id,
                    state,
                    created_by_source,
                    current_location,
                    metadata,
                    created_at,
                    updated_at
          `, [
                    previous.item_instance_id,
                    targetPlayerId,
                    nextState,
                    nextLocation,
                    JSON.stringify(safeJson({
                        ...moderationMetadata,
                        target_username: targetUsername,
                    })),
                ]);
                const row = updateResult.rows[0];
                if (!row?.item_instance_id)
                    return { ok: false, reason: "item_instance_not_found" };
                await this.recordItemInstanceEvent(client, {
                    item_instance_id: row.item_instance_id,
                    event_type: eventType,
                    from_player_id: previousOwnerId,
                    to_player_id: targetPlayerId,
                    from_location: previousLocation,
                    to_location: nextLocation,
                    world_id: row.world_id || previous.world_id,
                    item_transaction_id: eventTransactionId,
                    source: `admin_${normalizedAction}`,
                    metadata: {
                        public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                        item_type: itemType,
                        item_category: itemCategory,
                        action: normalizedAction,
                        actor_username: actorUsername,
                        reason,
                        target_username: targetUsername,
                        previous_state: previousState,
                        state: nextState,
                        previous_location: previousLocation,
                        current_location: nextLocation,
                    },
                });
                return {
                    ok: true,
                    action: normalizedAction,
                    item_instance: {
                        item_instance_id: cleanName(row.item_instance_id || ""),
                        public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                        item_type: cleanName(row.item_type || ""),
                        item_category: cleanName(row.item_category || ""),
                        state: cleanName(row.state || ""),
                        current_location: cleanName(row.current_location || ""),
                        created_by_source: cleanName(row.created_by_source || ""),
                        current_owner_username: targetUsername,
                        previous_owner_username: previousOwnerUsername,
                        created_at: normalizeOptionalTimestamp(row.created_at),
                        updated_at: normalizeOptionalTimestamp(row.updated_at),
                    },
                    previous: {
                        state: previousState,
                        current_location: previousLocation,
                        owner_username: previousOwnerUsername,
                    },
                    inventory_effects: inventoryEffects,
                };
            });
        }
        catch (error) {
            this.logger("[postgres] item instance moderation failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async auditItemInstances(options = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const limit = Math.min(200, Math.max(1, toInt(options.limit, 50)));
        const issues = [];
        const scannedAt = new Date().toISOString();
        const pushIssue = (issue) => {
            if (issues.length >= limit)
                return;
            issues.push(issue);
        };
        try {
            const duplicateResult = await this.db.query(`
        SELECT public_item_instance_id,
               count(*)::int AS row_count,
               array_agg(item_instance_id::text ORDER BY created_at ASC) AS item_instance_ids
          FROM ${this.table("item_instances")}
         GROUP BY public_item_instance_id
        HAVING count(*) > 1
         ORDER BY row_count DESC, public_item_instance_id ASC
         LIMIT $1
        `, [limit]);
            for (const row of duplicateResult.rows) {
                pushIssue({
                    type: "duplicate_public_id",
                    public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                    row_count: toInt(row.row_count, 0),
                    item_instance_ids: Array.isArray(row.item_instance_ids) ? row.item_instance_ids.map(cleanName) : [],
                    severity: "critical",
                });
            }
            const impossibleResult = await this.db.query(`
        SELECT ii.item_instance_id,
               ii.public_item_instance_id,
               ii.item_type,
               ii.item_category,
               ii.state,
               ii.current_location,
               owner_account.username::text AS owner_username,
               w.world_name::text AS world_name
          FROM ${this.table("item_instances")} ii
          LEFT JOIN ${this.table("players")} owner_player ON owner_player.player_id = ii.owner_player_id
          LEFT JOIN ${this.table("accounts")} owner_account ON owner_account.account_id = owner_player.account_id
          LEFT JOIN ${this.table("worlds")} w ON w.world_id = ii.world_id
         WHERE (ii.state = 'active' AND (ii.owner_player_id IS NULL OR ii.current_location <> 'inventory'))
            OR (ii.state = 'locked' AND ii.current_location NOT IN ('vending', 'safe', 'display'))
            OR (ii.state = 'dropped' AND ii.current_location <> 'world_drop')
            OR (ii.state IN ('consumed', 'destroyed', 'traded') AND ii.current_location = 'inventory')
            OR (ii.owner_player_id IS NULL AND ii.current_location = 'inventory')
         ORDER BY ii.updated_at DESC
         LIMIT $1
        `, [limit]);
            for (const row of impossibleResult.rows) {
                pushIssue({
                    type: "impossible_state",
                    item_instance_id: cleanName(row.item_instance_id || ""),
                    public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                    item_type: cleanName(row.item_type || ""),
                    item_category: cleanName(row.item_category || ""),
                    state: cleanName(row.state || ""),
                    current_location: cleanName(row.current_location || ""),
                    owner_username: cleanName(row.owner_username || ""),
                    world_name: cleanName(row.world_name || ""),
                    severity: "high",
                });
            }
            const inventoryResult = await this.db.query(`
        SELECT inv.player_id,
               a.username::text AS username,
               inv.item_type,
               inv.item_category,
               inv.amount
          FROM ${this.table("inventory")} inv
          JOIN ${this.table("players")} p ON p.player_id = inv.player_id
          JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
         WHERE inv.amount > 0
        `);
            const activeResult = await this.db.query(`
        SELECT owner_player_id AS player_id,
               item_type,
               item_category,
               count(*)::int AS active_count
          FROM ${this.table("item_instances")}
         WHERE state = 'active'
           AND current_location = 'inventory'
           AND owner_player_id IS NOT NULL
         GROUP BY owner_player_id, item_type, item_category
        `);
            const countsByKey = new Map();
            for (const row of activeResult.rows) {
                const itemType = cleanName(row.item_type || "");
                const itemCategory = resolveItemCategory(itemType, row.item_category || "");
                if (!shouldTrackItemInstance(itemType, itemCategory))
                    continue;
                const playerId = cleanName(row.player_id || "");
                countsByKey.set(`${playerId}\u0000${itemType}\u0000${itemCategory}`, {
                    active_count: Math.max(0, toInt(row.active_count, 0)),
                    inventory_amount: 0,
                    username: "",
                    player_id: playerId,
                    item_type: itemType,
                    item_category: itemCategory,
                });
            }
            for (const row of inventoryResult.rows) {
                const itemType = cleanName(row.item_type || "");
                const itemCategory = resolveItemCategory(itemType, row.item_category || "");
                if (!shouldTrackItemInstance(itemType, itemCategory))
                    continue;
                const playerId = cleanName(row.player_id || "");
                const key = `${playerId}\u0000${itemType}\u0000${itemCategory}`;
                const existing = countsByKey.get(key) || {
                    active_count: 0,
                    inventory_amount: 0,
                    username: cleanName(row.username || ""),
                    player_id: playerId,
                    item_type: itemType,
                    item_category: itemCategory,
                };
                existing.inventory_amount = Math.max(0, toInt(row.amount, 0));
                existing.username = cleanName(row.username || existing.username || "");
                countsByKey.set(key, existing);
            }
            for (const entry of countsByKey.values()) {
                if (entry.active_count === entry.inventory_amount)
                    continue;
                pushIssue({
                    type: "inventory_count_mismatch",
                    username: cleanName(entry.username || ""),
                    player_id: cleanName(entry.player_id || ""),
                    item_type: cleanName(entry.item_type || ""),
                    item_category: cleanName(entry.item_category || ""),
                    inventory_amount: Math.max(0, toInt(entry.inventory_amount, 0)),
                    active_instance_count: Math.max(0, toInt(entry.active_count, 0)),
                    difference: Math.max(0, toInt(entry.active_count, 0)) - Math.max(0, toInt(entry.inventory_amount, 0)),
                    severity: "high",
                });
                if (issues.length >= limit)
                    break;
            }
            const summary = {
                duplicate_public_ids: duplicateResult.rowCount ?? 0,
                impossible_states: impossibleResult.rowCount ?? 0,
                inventory_mismatches: issues.filter((issue) => issue.type === "inventory_count_mismatch").length,
                total_issues: issues.length,
                truncated: issues.length >= limit,
            };
            return {
                ok: true,
                scanned_at: scannedAt,
                summary,
                issues,
            };
        }
        catch (error) {
            this.logger("[postgres] item instance audit failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async auditIntegrityHashes(options = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const limit = Math.min(500, Math.max(1, toInt(options.limit, 100)));
        const playerLimit = Math.min(1000, Math.max(1, toInt(options.player_limit, limit)));
        const transactionLimit = Math.min(2000, Math.max(1, toInt(options.transaction_limit, limit)));
        const snapshotLimit = Math.min(1000, Math.max(1, toInt(options.snapshot_limit, limit)));
        const scannedAt = new Date().toISOString();
        const issues = [];
        const pushIssue = (issue) => {
            if (issues.length >= limit)
                return;
            issues.push({
                severity: cleanName(issue.severity || "warning"),
                ...safeJson(issue),
            });
        };
        try {
            const playerResult = await this.db.query(`
        SELECT p.player_id,
               a.username::text AS username,
               p.inventory_hash,
               p.inventory_hash_algorithm,
               p.inventory_hash_updated_at
          FROM ${this.table("players")} p
          JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
         ORDER BY p.updated_at DESC, p.created_at DESC
         LIMIT $1
        `, [playerLimit]);
            let inventoryHashMismatches = 0;
            let missingInventoryHashes = 0;
            for (const row of playerResult.rows) {
                const playerId = cleanName(row.player_id || "");
                const expectedHash = await this.getInventorySnapshotHash(this.db, playerId);
                const storedHash = cleanName(row.inventory_hash || "");
                if (storedHash === "") {
                    missingInventoryHashes += 1;
                    pushIssue({
                        type: "missing_inventory_hash",
                        username: cleanName(row.username || ""),
                        player_id: playerId,
                        expected_inventory_hash: expectedHash,
                        severity: "notice",
                    });
                    continue;
                }
                if (storedHash !== expectedHash) {
                    inventoryHashMismatches += 1;
                    pushIssue({
                        type: "inventory_hash_mismatch",
                        username: cleanName(row.username || ""),
                        player_id: playerId,
                        stored_inventory_hash: storedHash,
                        expected_inventory_hash: expectedHash,
                        inventory_hash_updated_at: normalizeOptionalTimestamp(row.inventory_hash_updated_at),
                        severity: "high",
                    });
                }
            }
            const ledgerResult = await this.db.query(`
        SELECT transaction_ledger_id,
               transaction_id,
               transaction_type,
               status,
               player_id,
               other_player_id,
               world_id,
               item_transaction_id,
               gem_ledger_id,
               trade_id,
               vending_transaction_id,
               shop_purchase_id,
               admin_action_id,
               item_instance_id,
               public_item_instance_id,
               item_type,
               item_category,
               quantity,
               gems_before,
               gems_after,
               inventory_before_hash,
               inventory_after_hash,
               transaction_hash,
               transaction_hash_algorithm,
               ip_address::text AS ip_address,
               session_token_hash,
               user_agent,
               device_info,
               request_id,
               correlation_id,
               source,
               action,
               metadata,
               server_time
          FROM ${this.table("transaction_ledger")}
         ORDER BY server_time DESC, transaction_ledger_id DESC
         LIMIT $1
        `, [transactionLimit]);
            let transactionHashMismatches = 0;
            let missingTransactionHashes = 0;
            for (const row of ledgerResult.rows) {
                const expectedHash = buildTransactionLedgerHash(row);
                const storedHash = cleanName(row.transaction_hash || "");
                if (storedHash === "") {
                    missingTransactionHashes += 1;
                    pushIssue({
                        type: "missing_transaction_hash",
                        transaction_ledger_id: toInt(row.transaction_ledger_id, 0),
                        transaction_id: cleanName(row.transaction_id || ""),
                        transaction_type: cleanName(row.transaction_type || ""),
                        server_time: normalizeOptionalTimestamp(row.server_time),
                        severity: "notice",
                    });
                    continue;
                }
                if (storedHash !== expectedHash) {
                    transactionHashMismatches += 1;
                    pushIssue({
                        type: "transaction_hash_mismatch",
                        transaction_ledger_id: toInt(row.transaction_ledger_id, 0),
                        transaction_id: cleanName(row.transaction_id || ""),
                        transaction_type: cleanName(row.transaction_type || ""),
                        status: cleanName(row.status || ""),
                        stored_transaction_hash: storedHash,
                        expected_transaction_hash: expectedHash,
                        severity: "critical",
                    });
                }
            }
            const snapshotResult = await this.db.query(`
        SELECT ws.world_snapshot_id,
               ws.snapshot_version,
               ws.checksum,
               ws.snapshot_hash,
               ws.snapshot_hash_algorithm,
               ws.storage_uri,
               ws.snapshot_data,
               ws.created_at,
               w.world_name::text AS world_name
          FROM ${this.table("world_snapshots")} ws
          JOIN ${this.table("worlds")} w ON w.world_id = ws.world_id
         ORDER BY ws.created_at DESC, ws.world_snapshot_id DESC
         LIMIT $1
        `, [snapshotLimit]);
            let snapshotHashMismatches = 0;
            let missingSnapshotHashes = 0;
            for (const row of snapshotResult.rows) {
                const snapshotHash = cleanName(row.snapshot_hash || "");
                const checksum = cleanName(row.checksum || "");
                if (snapshotHash === "") {
                    missingSnapshotHashes += 1;
                    pushIssue({
                        type: "missing_world_snapshot_hash",
                        world_name: cleanName(row.world_name || ""),
                        world_snapshot_id: toInt(row.world_snapshot_id, 0),
                        snapshot_version: toInt(row.snapshot_version, 0),
                        checksum,
                        severity: "notice",
                    });
                    continue;
                }
                if (row.snapshot_data) {
                    const expectedSnapshotHash = integrityHash(safeJson(row.snapshot_data));
                    if (snapshotHash !== expectedSnapshotHash) {
                        snapshotHashMismatches += 1;
                        pushIssue({
                            type: "world_snapshot_hash_mismatch",
                            world_name: cleanName(row.world_name || ""),
                            world_snapshot_id: toInt(row.world_snapshot_id, 0),
                            snapshot_version: toInt(row.snapshot_version, 0),
                            stored_snapshot_hash: snapshotHash,
                            expected_snapshot_hash: expectedSnapshotHash,
                            severity: "critical",
                        });
                    }
                }
            }
            const inventoryLedgerResult = await this.db.query(`
        SELECT inv.player_id,
               a.username::text AS username,
               inv.item_type,
               inv.item_category,
               inv.amount,
               COALESCE(SUM(tx.delta), 0)::text AS ledger_delta,
               COUNT(tx.item_transaction_id)::int AS transaction_count
          FROM ${this.table("inventory")} inv
          JOIN ${this.table("players")} p ON p.player_id = inv.player_id
          JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
          LEFT JOIN ${this.table("item_transactions")} tx
            ON tx.player_id = inv.player_id
           AND tx.item_type = inv.item_type
           AND tx.item_category = inv.item_category
         GROUP BY inv.player_id, a.username, inv.item_type, inv.item_category, inv.amount
        HAVING COUNT(tx.item_transaction_id) > 0
           AND inv.amount <> COALESCE(SUM(tx.delta), 0)
         ORDER BY a.username ASC, inv.item_category ASC, inv.item_type ASC
         LIMIT $1
        `, [limit]);
            for (const row of inventoryLedgerResult.rows) {
                pushIssue({
                    type: "inventory_item_ledger_mismatch",
                    username: cleanName(row.username || ""),
                    player_id: cleanName(row.player_id || ""),
                    item_type: cleanName(row.item_type || ""),
                    item_category: cleanName(row.item_category || ""),
                    inventory_amount: ledgerNullableInteger(row.amount),
                    ledger_delta_total: ledgerNullableInteger(row.ledger_delta),
                    transaction_count: toInt(row.transaction_count, 0),
                    legacy_baseline_possible: true,
                    severity: "warning",
                });
            }
            const gemLedgerResult = await this.db.query(`
        SELECT p.player_id,
               a.username::text AS username,
               COALESCE(inv.amount, 0)::text AS gem_balance,
               COALESCE(SUM(gl.delta), 0)::text AS ledger_delta,
               COUNT(gl.gem_ledger_id)::int AS ledger_count
          FROM ${this.table("players")} p
          JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
          LEFT JOIN ${this.table("inventory")} inv
            ON inv.player_id = p.player_id
           AND inv.item_type = 'gem'
           AND inv.item_category = 'currency'
          LEFT JOIN ${this.table("gem_ledger")} gl
            ON gl.player_id = p.player_id
         GROUP BY p.player_id, a.username, inv.amount
        HAVING COUNT(gl.gem_ledger_id) > 0
           AND COALESCE(inv.amount, 0) <> COALESCE(SUM(gl.delta), 0)
         ORDER BY a.username ASC
         LIMIT $1
        `, [limit]);
            for (const row of gemLedgerResult.rows) {
                pushIssue({
                    type: "gem_ledger_balance_mismatch",
                    username: cleanName(row.username || ""),
                    player_id: cleanName(row.player_id || ""),
                    gem_balance: ledgerNullableInteger(row.gem_balance),
                    ledger_delta_total: ledgerNullableInteger(row.ledger_delta),
                    ledger_count: toInt(row.ledger_count, 0),
                    legacy_baseline_possible: true,
                    severity: "warning",
                });
            }
            const vendingCollisionResult = await this.db.query(`
        SELECT vend.public_item_instance_id,
               vend.item_instance_id AS vending_item_instance_id,
               inv.item_instance_id AS inventory_item_instance_id,
               vend.item_type,
               vend.item_category
          FROM ${this.table("item_instances")} vend
          JOIN ${this.table("item_instances")} inv
            ON lower(inv.public_item_instance_id) = lower(vend.public_item_instance_id)
           AND inv.item_instance_id <> vend.item_instance_id
         WHERE vend.current_location = 'vending'
           AND inv.current_location = 'inventory'
         LIMIT $1
        `, [limit]);
            for (const row of vendingCollisionResult.rows) {
                pushIssue({
                    type: "vending_instance_also_in_inventory",
                    public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                    vending_item_instance_id: cleanName(row.vending_item_instance_id || ""),
                    inventory_item_instance_id: cleanName(row.inventory_item_instance_id || ""),
                    item_type: cleanName(row.item_type || ""),
                    item_category: cleanName(row.item_category || ""),
                    severity: "critical",
                });
            }
            const itemAudit = await this.auditItemInstances({ limit });
            if (itemAudit?.ok) {
                for (const issue of itemAudit.issues || []) {
                    pushIssue({
                        ...safeJson(issue),
                        source: "item_instance_audit",
                    });
                }
            }
            else {
                pushIssue({
                    type: "item_instance_audit_failed",
                    reason: cleanName(itemAudit?.reason || "unknown"),
                    severity: "warning",
                });
            }
            const summary = {
                scanned_at: scannedAt,
                players_scanned: playerResult.rowCount ?? 0,
                transaction_rows_scanned: ledgerResult.rowCount ?? 0,
                world_snapshots_scanned: snapshotResult.rowCount ?? 0,
                inventory_hash_mismatches: inventoryHashMismatches,
                missing_inventory_hashes: missingInventoryHashes,
                transaction_hash_mismatches: transactionHashMismatches,
                missing_transaction_hashes: missingTransactionHashes,
                world_snapshot_hash_mismatches: snapshotHashMismatches,
                missing_world_snapshot_hashes: missingSnapshotHashes,
                inventory_item_ledger_mismatches: inventoryLedgerResult.rowCount ?? 0,
                gem_ledger_balance_mismatches: gemLedgerResult.rowCount ?? 0,
                vending_instance_collisions: vendingCollisionResult.rowCount ?? 0,
                item_instance_issues: itemAudit?.ok ? toInt(itemAudit.summary?.total_issues, 0) : null,
                total_issues: issues.length,
                critical_issues: issues.filter((issue) => cleanName(issue.severity) === "critical").length,
                high_issues: issues.filter((issue) => cleanName(issue.severity) === "high").length,
                warnings: issues.filter((issue) => cleanName(issue.severity) === "warning").length,
                notices: issues.filter((issue) => cleanName(issue.severity) === "notice").length,
                truncated: issues.length >= limit,
            };
            const status = summary.critical_issues > 0 || summary.high_issues > 0
                ? "issues_found"
                : "success";
            await this.db.query(`
        INSERT INTO ${this.table("integrity_audit_runs")} (
          run_type,
          status,
          summary,
          issues,
          metadata,
          created_at
        )
        VALUES ('integrity_hash_audit', $1, $2::jsonb, $3::jsonb, $4::jsonb, now())
        `, [
                status,
                JSON.stringify(summary),
                JSON.stringify(issues),
                JSON.stringify(safeJson({
                    limit,
                    player_limit: playerLimit,
                    transaction_limit: transactionLimit,
                    snapshot_limit: snapshotLimit,
                })),
            ]);
            return {
                ok: true,
                scanned_at: scannedAt,
                status,
                summary,
                issues,
            };
        }
        catch (error) {
            this.logger("[postgres] integrity hash audit failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async getAdminMonitoringDashboard(options = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const limit = Math.min(100, Math.max(1, toInt(options.limit, 25)));
        const dupeLimit = Math.min(50, Math.max(1, toInt(options.dupe_limit, Math.min(limit, 20))));
        const windowHours = Math.min(24 * 14, Math.max(1, toInt(options.window_hours, 24)));
        const generatedAt = new Date().toISOString();
        try {
            const [worldCountResult, playerCountResult, topGemGainersResult, topItemGainersResult, suspiciousAccountsResult, latestIntegrityAuditResult, recentSecuritySummaryResult,] = await Promise.all([
                this.db.query(`
          SELECT count(*)::int AS world_count
            FROM ${this.table("worlds")}
          `),
                this.db.query(`
          SELECT count(*)::int AS player_count
            FROM ${this.table("players")}
          `),
                this.db.query(`
          SELECT p.player_id,
                 a.username::text AS username,
                 SUM(gl.delta)::text AS total_gems_gained,
                 COUNT(gl.gem_ledger_id)::int AS event_count,
                 MAX(gl.created_at) AS last_gain_at,
                 array_agg(DISTINCT gl.reason ORDER BY gl.reason) FILTER (WHERE gl.reason IS NOT NULL AND gl.reason <> '') AS reasons
            FROM ${this.table("gem_ledger")} gl
            JOIN ${this.table("players")} p ON p.player_id = gl.player_id
            JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
           WHERE gl.delta > 0
             AND gl.created_at >= now() - ($1::int * interval '1 hour')
           GROUP BY p.player_id, a.username
           ORDER BY SUM(gl.delta) DESC, COUNT(gl.gem_ledger_id) DESC, MAX(gl.created_at) DESC
           LIMIT $2
          `, [windowHours, limit]),
                this.db.query(`
          SELECT p.player_id,
                 a.username::text AS username,
                 tx.item_type,
                 tx.item_category,
                 SUM(tx.delta)::text AS total_items_gained,
                 COUNT(tx.item_transaction_id)::int AS event_count,
                 MAX(tx.created_at) AS last_gain_at,
                 array_agg(DISTINCT tx.source ORDER BY tx.source) FILTER (WHERE tx.source IS NOT NULL AND tx.source <> '') AS sources
            FROM ${this.table("item_transactions")} tx
            JOIN ${this.table("players")} p ON p.player_id = tx.player_id
            JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
           WHERE tx.delta > 0
             AND tx.created_at >= now() - ($1::int * interval '1 hour')
           GROUP BY p.player_id, a.username, tx.item_type, tx.item_category
           ORDER BY SUM(tx.delta) DESC, COUNT(tx.item_transaction_id) DESC, MAX(tx.created_at) DESC
           LIMIT $2
          `, [windowHours, limit]),
                this.db.query(`
          SELECT COALESCE(a.username, player_account.username, '')::text AS username,
                 COALESCE(se.player_id::text, p.player_id::text, '') AS player_id,
                 COUNT(se.security_event_id)::int AS event_count,
                 SUM(CASE WHEN se.severity = 'critical' THEN 1 ELSE 0 END)::int AS critical_count,
                 SUM(CASE WHEN se.severity = 'high' THEN 1 ELSE 0 END)::int AS high_count,
                 SUM(CASE WHEN se.severity = 'medium' THEN 1 ELSE 0 END)::int AS medium_count,
                 MAX(se.created_at) AS last_event_at,
                 array_agg(DISTINCT se.event_type ORDER BY se.event_type) FILTER (WHERE se.event_type IS NOT NULL AND se.event_type <> '') AS event_types
            FROM ${this.table("security_events")} se
            LEFT JOIN ${this.table("accounts")} a ON a.account_id = se.account_id
            LEFT JOIN ${this.table("players")} p ON p.player_id = se.player_id
            LEFT JOIN ${this.table("accounts")} player_account ON player_account.account_id = p.account_id
           WHERE se.created_at >= now() - ($1::int * interval '1 hour')
             AND (
               se.severity IN ('critical', 'high', 'medium')
               OR se.event_type ILIKE '%dupe%'
               OR se.event_type ILIKE '%rate%'
               OR se.event_type ILIKE '%failed%'
               OR se.event_type ILIKE '%denied%'
               OR se.event_type ILIKE '%punishment%'
             )
           GROUP BY COALESCE(a.username, player_account.username, ''), COALESCE(se.player_id::text, p.player_id::text, '')
           ORDER BY critical_count DESC, high_count DESC, medium_count DESC, event_count DESC, MAX(se.created_at) DESC
           LIMIT $2
          `, [windowHours, limit]),
                this.db.query(`
          SELECT run_type,
                 status,
                 summary,
                 issues,
                 created_at
            FROM ${this.table("integrity_audit_runs")}
           ORDER BY created_at DESC
           LIMIT 1
          `),
                this.db.query(`
          SELECT severity,
                 COUNT(*)::int AS event_count
            FROM ${this.table("security_events")}
           WHERE created_at >= now() - ($1::int * interval '1 hour')
           GROUP BY severity
           ORDER BY severity ASC
          `, [windowHours]),
            ]);
            const itemAudit = await this.auditItemInstances({ limit: dupeLimit });
            const latestAuditRow = latestIntegrityAuditResult.rows[0] || null;
            const latestAuditIssues = latestAuditRow && Array.isArray(latestAuditRow.issues)
                ? latestAuditRow.issues
                : [];
            const latestAuditSummary = latestAuditRow ? safeJson(latestAuditRow.summary) : {};
            const criticalIntegrityIssues = latestAuditIssues.filter((issue) => cleanName(issue?.severity) === "critical").length;
            const highIntegrityIssues = latestAuditIssues.filter((issue) => cleanName(issue?.severity) === "high").length;
            const itemAuditIssues = itemAudit?.ok && Array.isArray(itemAudit.issues) ? itemAudit.issues : [];
            const dupeWarnings = itemAuditIssues.map((issue) => ({
                type: cleanName(issue.type || "unknown"),
                severity: cleanName(issue.severity || "warning"),
                username: cleanName(issue.username || ""),
                player_id: cleanName(issue.player_id || ""),
                item_type: cleanName(issue.item_type || ""),
                item_category: cleanName(issue.item_category || ""),
                public_item_instance_id: cleanName(issue.public_item_instance_id || ""),
                item_instance_id: cleanName(issue.item_instance_id || ""),
                state: cleanName(issue.state || ""),
                current_location: cleanName(issue.current_location || ""),
                inventory_amount: ledgerNullableInteger(issue.inventory_amount),
                active_instance_count: ledgerNullableInteger(issue.active_instance_count),
                difference: ledgerNullableInteger(issue.difference),
                row_count: toInt(issue.row_count, 0),
            }));
            return {
                ok: true,
                generated_at: generatedAt,
                window_hours: windowHours,
                limit,
                world_count: toInt(worldCountResult.rows[0]?.world_count, 0),
                player_count: toInt(playerCountResult.rows[0]?.player_count, 0),
                top_gem_gainers: topGemGainersResult.rows.map((row) => ({
                    username: cleanName(row.username || ""),
                    player_id: cleanName(row.player_id || ""),
                    total_gems_gained: ledgerNullableInteger(row.total_gems_gained) || "0",
                    event_count: toInt(row.event_count, 0),
                    last_gain_at: normalizeOptionalTimestamp(row.last_gain_at),
                    reasons: Array.isArray(row.reasons) ? row.reasons.map(cleanName).filter(Boolean).slice(0, 5) : [],
                })),
                top_item_gainers: topItemGainersResult.rows.map((row) => ({
                    username: cleanName(row.username || ""),
                    player_id: cleanName(row.player_id || ""),
                    item_type: cleanName(row.item_type || ""),
                    item_category: cleanName(row.item_category || ""),
                    total_items_gained: ledgerNullableInteger(row.total_items_gained) || "0",
                    event_count: toInt(row.event_count, 0),
                    last_gain_at: normalizeOptionalTimestamp(row.last_gain_at),
                    sources: Array.isArray(row.sources) ? row.sources.map(cleanName).filter(Boolean).slice(0, 5) : [],
                })),
                suspicious_accounts: suspiciousAccountsResult.rows.map((row) => ({
                    username: cleanName(row.username || ""),
                    player_id: cleanName(row.player_id || ""),
                    event_count: toInt(row.event_count, 0),
                    critical_count: toInt(row.critical_count, 0),
                    high_count: toInt(row.high_count, 0),
                    medium_count: toInt(row.medium_count, 0),
                    last_event_at: normalizeOptionalTimestamp(row.last_event_at),
                    event_types: Array.isArray(row.event_types) ? row.event_types.map(cleanName).filter(Boolean).slice(0, 8) : [],
                })),
                recent_security_summary: recentSecuritySummaryResult.rows.map((row) => ({
                    severity: cleanName(row.severity || ""),
                    event_count: toInt(row.event_count, 0),
                })),
                dupe_warnings: dupeWarnings,
                dupe_warning_count: toInt(itemAudit?.summary?.total_issues, itemAuditIssues.length),
                dupe_summary: itemAudit?.ok ? safeJson(itemAudit.summary || {}) : {
                    ok: false,
                    reason: cleanName(itemAudit?.reason || "audit_unavailable"),
                },
                latest_integrity_audit: latestAuditRow ? {
                    run_type: cleanName(latestAuditRow.run_type || ""),
                    status: cleanName(latestAuditRow.status || ""),
                    created_at: normalizeOptionalTimestamp(latestAuditRow.created_at),
                    critical_issues: toInt(latestAuditSummary.critical_issues, criticalIntegrityIssues),
                    high_issues: toInt(latestAuditSummary.high_issues, highIntegrityIssues),
                    warnings: toInt(latestAuditSummary.warnings, 0),
                    notices: toInt(latestAuditSummary.notices, 0),
                    total_issues: toInt(latestAuditSummary.total_issues, latestAuditIssues.length),
                    summary: latestAuditSummary,
                } : {
                    run_type: "",
                    status: "not_run",
                    created_at: null,
                    critical_issues: 0,
                    high_issues: 0,
                    warnings: 0,
                    notices: 0,
                    total_issues: 0,
                    summary: {},
                },
            };
        }
        catch (error) {
            this.logger("[postgres] admin monitoring dashboard failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async reconcileItemInstancesForUsername(username, playerState = null, details = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return { ok: false, reason: "invalid_username" };
        try {
            return await this.withTransaction(async (client) => {
                const result = await client.query(`
          SELECT p.player_id, p.player_state, a.username::text AS username
            FROM ${this.table("players")} p
            JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
           WHERE lower(a.username) = lower($1)
           LIMIT 1
          `, [cleanUsername]);
                const row = result.rows[0];
                if (!row?.player_id)
                    return { ok: false, reason: "player_not_found" };
                let state = toObject(playerState);
                if (Object.keys(state).length <= 0) {
                    state = toObject(row.player_state);
                }
                if (Object.keys(state).length <= 0) {
                    return {
                        ok: true,
                        player_found: true,
                        reconciled: false,
                        reason: "empty_player_state",
                        username: cleanName(row.username || cleanUsername),
                    };
                }
                await this.reconcileItemInstancesForInventory(client, row.player_id, state, {
                    source: "manual_item_instance_reconcile",
                    username: cleanName(row.username || cleanUsername),
                    details: safeJson(details),
                });
                return {
                    ok: true,
                    player_found: true,
                    reconciled: true,
                    username: cleanName(row.username || cleanUsername),
                };
            });
        }
        catch (error) {
            this.logger("[postgres] item instance username reconcile failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async reconcileStoredItemInstancesFromPlayerStates() {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        try {
            const rows = await this.db.query(`
        SELECT p.player_id, a.username::text AS username, p.player_state
          FROM ${this.table("players")} p
          JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
         WHERE p.player_state IS NOT NULL
           AND p.player_state <> '{}'::jsonb
         ORDER BY a.username ASC
        `);
            if ((rows.rowCount ?? 0) <= 0)
                return { ok: true, player_count: 0 };
            let reconciled = 0;
            await this.withTransaction(async (client) => {
                for (const row of rows.rows) {
                    await this.reconcileItemInstancesForInventory(client, row.player_id, toObject(row.player_state), {
                        source: "startup_item_instance_reconcile",
                        username: cleanName(row.username || ""),
                    });
                    reconciled += 1;
                }
            });
            return { ok: true, player_count: reconciled };
        }
        catch (error) {
            this.logger("[postgres] stored item instance reconcile failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async savePlayerState(username, state) {
        if (!this.isReady())
            return false;
        const cleanUsername = cleanName(username || state?.account_username || state?.username || "");
        const playerState = safeJson({ ...toObject(state), account_username: cleanUsername });
        if (cleanUsername === "")
            return false;
        try {
            await this.withTransaction(async (client) => {
                const playerId = await this.ensurePlayerIdentity(client, cleanUsername);
                if (!playerId)
                    return;
                const progression = await this.updatePlayerProgression(client, playerId, playerState);
                await client.query(`
          UPDATE ${this.table("players")}
             SET player_health = $2,
                 player_state = $3::jsonb,
                 updated_at = now()
           WHERE player_id = $1
          `, [
                    playerId,
                    Math.max(0, toInt(playerState.player_health, 100)),
                    JSON.stringify({
                        ...playerState,
                        ...(progression || {}),
                        account_username: cleanUsername,
                    }),
                ]);
                await this.replaceInventorySnapshot(client, playerId, playerState);
                await this.reconcileItemInstancesForInventory(client, playerId, playerState, {
                    source: "save_player_state",
                    username: cleanUsername,
                    allow_create_missing: false,
                    allow_retire_extra: false,
                });
            }, "save player state", postgresPlayerWriteScope(cleanUsername));
            return true;
        }
        catch (error) {
            this.logger("[postgres] player state save failed:", getErrorMessage(error));
            return false;
        }
    }
    async savePlayerStates(playerEntries = []) {
        if (!this.isReady())
            return false;
        const entries = Array.isArray(playerEntries) ? playerEntries : [];
        for (const entry of entries) {
            const parsed = toObject(entry);
            const username = cleanName(parsed.username || parsed.account_username || parsed.state?.account_username || "");
            const state = toObject(parsed.state || parsed.player_data || parsed);
            if (username === "")
                continue;
            await this.savePlayerState(username, state);
        }
        return true;
    }
    async loadPlayerState(username) {
        if (!this.isReady())
            return { ok: false, found: false, reason: "postgres_unavailable" };
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return { ok: false, found: false, reason: "invalid_username" };
        try {
            const result = await this.db.query(`
        SELECT
          p.player_id::text AS player_id,
          a.username::text AS username,
          p.player_health,
          p.player_level,
          p.player_xp,
          p.player_xp_needed,
          p.player_total_xp,
          p.player_title,
          p.last_level_up_at,
          p.player_state
        FROM ${this.table("players")} p
        JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
        WHERE lower(a.username::text) = lower($1)
        LIMIT 1
        `, [cleanUsername]);
            const row = result.rows[0];
            if (!row)
                return { ok: true, found: false, username: cleanUsername };
            const inventoryResult = await this.db.query(`
        SELECT item_type, item_category, amount
          FROM ${this.table("inventory")}
         WHERE player_id = $1::uuid
         ORDER BY item_category ASC, item_type ASC
        `, [row.player_id]);
            const state = applyCanonicalInventoryRowsToPlayerState(row.player_state, inventoryResult.rows);
            return {
                ok: true,
                found: true,
                username: cleanName(row.username || cleanUsername),
                state: {
                    ...state,
                    account_username: cleanName(state.account_username || row.username || cleanUsername),
                    player_health: toInt(state.player_health, toInt(row.player_health, 100)),
                    player_level: toInt(state.player_level, toInt(row.player_level, 1)),
                    player_xp: toInt(state.player_xp, toInt(row.player_xp, 0)),
                    player_xp_needed: toInt(state.player_xp_needed, toInt(row.player_xp_needed, 300)),
                    player_total_xp: toInt(state.player_total_xp, toInt(row.player_total_xp, 0)),
                    player_title: cleanName(state.player_title || row.player_title || "Explorer") || "Explorer",
                    last_level_up_at: cleanName(state.last_level_up_at || normalizeOptionalTimestamp(row.last_level_up_at) || ""),
                },
            };
        }
        catch (error) {
            this.logger("[postgres] single player state load failed:", getErrorMessage(error));
            return { ok: false, found: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async loadPlayerStates() {
        if (!this.isReady())
            return [];
        try {
            const result = await this.queryReadWithRetry("player states load", `
        SELECT
          p.player_id::text AS player_id,
          a.username::text AS username,
          p.player_health,
          p.player_level,
          p.player_xp,
          p.player_xp_needed,
          p.player_total_xp,
          p.player_title,
          p.last_level_up_at,
          p.player_state
        FROM ${this.table("players")} p
        JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
        WHERE p.player_state IS NOT NULL
          AND p.player_state <> '{}'::jsonb
        ORDER BY a.username ASC
      `);
            const playerIds = result.rows
                .map((row) => cleanName(row.player_id || ""))
                .filter((playerId) => playerId !== "");
            const inventoryResult = playerIds.length > 0
                ? await this.queryReadWithRetry("player inventories load", `
          SELECT player_id::text AS player_id, item_type, item_category, amount
            FROM ${this.table("inventory")}
           WHERE player_id = ANY($1::uuid[])
           ORDER BY player_id ASC, item_category ASC, item_type ASC
          `, [playerIds])
                : { rows: [] };
            const inventoryRowsByPlayerId = new Map();
            for (const inventoryRow of inventoryResult.rows) {
                const playerId = cleanName(inventoryRow.player_id || "");
                if (playerId === "")
                    continue;
                const rows = inventoryRowsByPlayerId.get(playerId) || [];
                rows.push(inventoryRow);
                inventoryRowsByPlayerId.set(playerId, rows);
            }
            return result.rows.map((row) => {
                const state = applyCanonicalInventoryRowsToPlayerState(row.player_state, inventoryRowsByPlayerId.get(cleanName(row.player_id || "")) || []);
                return {
                    username: cleanName(row.username),
                    state: {
                        ...state,
                        account_username: cleanName(state.account_username || row.username),
                        player_health: toInt(state.player_health, toInt(row.player_health, 100)),
                        player_level: toInt(state.player_level, toInt(row.player_level, 1)),
                        player_xp: toInt(state.player_xp, toInt(row.player_xp, 0)),
                        player_xp_needed: toInt(state.player_xp_needed, toInt(row.player_xp_needed, 300)),
                        player_total_xp: toInt(state.player_total_xp, toInt(row.player_total_xp, 0)),
                        player_title: cleanName(state.player_title || row.player_title || "Explorer") || "Explorer",
                        last_level_up_at: cleanName(state.last_level_up_at || normalizeOptionalTimestamp(row.last_level_up_at) || ""),
                    },
                };
            });
        }
        catch (error) {
            this.logger("[postgres] player state load failed after retries:", getErrorMessage(error));
            throw postgresError(error);
        }
    }
    async ensureWorldIdentity(client, worldName) {
        const cleanWorldName = cleanName(worldName || "START") || "START";
        const result = await client.query(`
      INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
      VALUES ($1, 100, 70, 1, true, now(), now())
      ON CONFLICT (world_name) DO UPDATE
        SET last_loaded_at = now()
      RETURNING world_id
      `, [cleanWorldName]);
        return result.rows[0]?.world_id || null;
    }
    async recordWorldHonorVisit(entry = {}) {
        if (!this.isReady()) {
            return { ok: false, recorded: false, reason: "postgres_unavailable" };
        }
        const worldName = cleanName(entry.world || entry.world_name || "").toUpperCase();
        const visitorUsername = cleanName(entry.visitor_username || entry.username || "");
        const networkHash = /^[a-f0-9]{64}$/i.test(cleanName(entry.network_hash || ""))
            ? cleanName(entry.network_hash).toLowerCase()
            : "";
        const dwellMs = Math.max(0, toInt(entry.dwell_ms, 0));
        const maxNetworkVisitors = Math.max(0, Math.min(50, toInt(entry.max_network_visitors, 0)));
        const sourceInstance = cleanName(entry.source_instance || "").slice(0, 128);
        const startedMs = Date.parse(cleanName(entry.visit_started_at || ""));
        const endedMs = Date.parse(cleanName(entry.visit_ended_at || ""));
        const visitStartedAt = new Date(Number.isFinite(startedMs) ? startedMs : Date.now() - dwellMs).toISOString();
        const visitEndedAt = new Date(Number.isFinite(endedMs) ? endedMs : Date.now()).toISOString();
        if (worldName === "" || visitorUsername === "") {
            return { ok: false, recorded: false, reason: "invalid_visit" };
        }
        try {
            const result = await this.withTransaction(async (client) => {
                const worldId = await this.ensureWorldIdentity(client, worldName);
                const playerId = await this.ensurePlayerIdentityForExistingAccount(client, visitorUsername, worldName);
                if (!worldId || !playerId) {
                    return { ok: false, recorded: false, reason: "identity_missing" };
                }
                const dateResult = await client.query(`
          SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS honor_date
        `);
                const honorDate = cleanName(dateResult.rows[0]?.honor_date || "");
                if (honorDate === "") {
                    return { ok: false, recorded: false, reason: "honor_date_unavailable" };
                }
                if (networkHash !== "") {
                    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`world_honor:${worldId}:${honorDate}:${networkHash}`]);
                }
                const existingResult = await client.query(`
          SELECT honor_date::text AS honor_date
            FROM ${this.table("world_honor_visits")}
           WHERE world_id = $1
             AND visitor_player_id = $2
             AND honor_date = $3::date
           LIMIT 1
          `, [worldId, playerId, honorDate]);
                if (existingResult.rows[0]) {
                    return {
                        ok: true,
                        recorded: false,
                        duplicate: true,
                        honor_date: honorDate,
                        reason: "already_counted_today",
                    };
                }
                if (networkHash !== "" && maxNetworkVisitors > 0) {
                    const networkResult = await client.query(`
            SELECT COUNT(*)::integer AS visitor_count
              FROM ${this.table("world_honor_visits")}
             WHERE world_id = $1
               AND honor_date = $2::date
               AND network_hash = $3
            `, [worldId, honorDate, networkHash]);
                    const networkVisitorCount = toInt(networkResult.rows[0]?.visitor_count, 0);
                    if (networkVisitorCount >= maxNetworkVisitors) {
                        return {
                            ok: true,
                            recorded: false,
                            network_capped: true,
                            honor_date: honorDate,
                            reason: "network_daily_cap",
                        };
                    }
                }
                const insertResult = await client.query(`
          INSERT INTO ${this.table("world_honor_visits")} (
            world_id,
            visitor_player_id,
            honor_date,
            network_hash,
            dwell_ms,
            visit_started_at,
            visit_ended_at,
            qualified_at,
            source_instance
          )
          VALUES ($1, $2, $3::date, $4, $5, $6::timestamptz, $7::timestamptz, now(), $8)
          ON CONFLICT (world_id, visitor_player_id, honor_date) DO NOTHING
          RETURNING honor_date::text AS honor_date
          `, [
                    worldId,
                    playerId,
                    honorDate,
                    networkHash,
                    dwellMs,
                    visitStartedAt,
                    visitEndedAt,
                    sourceInstance,
                ]);
                return {
                    ok: true,
                    recorded: Boolean(insertResult.rows[0]),
                    duplicate: !insertResult.rows[0],
                    honor_date: honorDate,
                    reason: insertResult.rows[0] ? "" : "already_counted_today",
                };
            });
            return result || { ok: false, recorded: false, reason: "postgres_unavailable" };
        }
        catch (error) {
            this.logger("[postgres] world honor visit record failed:", getErrorMessage(error));
            return { ok: false, recorded: false, reason: "database_error" };
        }
    }
    async getWorldHonorLeaderboard(period, options = {}) {
        if (!this.isReady()) {
            return { ok: false, period: "today", entries: [], reason: "postgres_unavailable" };
        }
        const requestedPeriod = cleanName(period || "today").toLowerCase();
        const normalizedPeriod = requestedPeriod === "yesterday" || requestedPeriod === "overall"
            ? requestedPeriod
            : "today";
        const limit = Math.max(1, Math.min(50, toInt(options.limit, 10)));
        const halfLifeDays = Math.max(1, Math.min(365, toInt(options.half_life_days, 30)));
        const inactivityDays = Math.max(1, Math.min(730, toInt(options.inactivity_days, 60)));
        try {
            let result;
            if (normalizedPeriod === "overall") {
                result = await this.queryReadWithRetry("world honor overall leaderboard", `
          WITH clock AS (
            SELECT (now() AT TIME ZONE 'UTC')::date AS today
          ),
          scores AS (
            SELECT w.world_name::text AS world_name,
                   SUM(
                     POWER(
                       0.5::double precision,
                       GREATEST(0, clock.today - hv.honor_date)::double precision / $1::double precision
                     )
                   ) AS honor_score,
                   COUNT(*)::bigint AS qualified_visitors,
                   MAX(hv.honor_date) AS last_honored_on
              FROM ${this.table("world_honor_visits")} hv
              JOIN ${this.table("worlds")} w
                ON w.world_id = hv.world_id
               AND w.is_active = true
              JOIN ${this.table("world_locks")} wl
                ON wl.world_id = hv.world_id
               AND wl.is_locked = true
              CROSS JOIN clock
             WHERE hv.honor_date >= clock.today - $2::integer
             GROUP BY w.world_name
          ),
          ranked AS (
            SELECT ROW_NUMBER() OVER (
                     ORDER BY honor_score DESC, qualified_visitors DESC, last_honored_on DESC, world_name ASC
                   )::integer AS rank,
                   world_name,
                   honor_score,
                   qualified_visitors,
                   last_honored_on
              FROM scores
          )
          SELECT rank,
                 world_name,
                 honor_score,
                 qualified_visitors,
                 last_honored_on::text AS last_honored_on
            FROM ranked
           ORDER BY rank ASC
           LIMIT $3
          `, [halfLifeDays, inactivityDays, limit]);
            }
            else {
                const dayOffset = normalizedPeriod === "yesterday" ? 1 : 0;
                result = await this.queryReadWithRetry(`world honor ${normalizedPeriod} leaderboard`, `
          WITH clock AS (
            SELECT (now() AT TIME ZONE 'UTC')::date AS today
          ),
          scores AS (
            SELECT w.world_name::text AS world_name,
                   COUNT(*)::double precision AS honor_score,
                   COUNT(*)::bigint AS qualified_visitors,
                   MAX(hv.honor_date) AS last_honored_on
              FROM ${this.table("world_honor_visits")} hv
              JOIN ${this.table("worlds")} w
                ON w.world_id = hv.world_id
               AND w.is_active = true
              JOIN ${this.table("world_locks")} wl
                ON wl.world_id = hv.world_id
               AND wl.is_locked = true
              CROSS JOIN clock
             WHERE hv.honor_date = clock.today - $1::integer
             GROUP BY w.world_name
          ),
          ranked AS (
            SELECT ROW_NUMBER() OVER (
                     ORDER BY honor_score DESC, world_name ASC
                   )::integer AS rank,
                   world_name,
                   honor_score,
                   qualified_visitors,
                   last_honored_on
              FROM scores
          )
          SELECT rank,
                 world_name,
                 honor_score,
                 qualified_visitors,
                 last_honored_on::text AS last_honored_on
            FROM ranked
           ORDER BY rank ASC
           LIMIT $2
          `, [dayOffset, limit]);
            }
            return {
                ok: true,
                period: normalizedPeriod,
                entries: result.rows.map((row) => ({
                    rank: Math.max(1, toInt(row.rank, 1)),
                    world_name: cleanName(row.world_name || "").toUpperCase(),
                    honor_score: Math.max(0, Number(row.honor_score) || 0),
                    qualified_visitors: Math.max(0, toInt(row.qualified_visitors, 0)),
                    last_honored_on: cleanName(row.last_honored_on || ""),
                })),
            };
        }
        catch (error) {
            this.logger(`[postgres] world honor ${normalizedPeriod} leaderboard failed:`, getErrorMessage(error));
            return { ok: false, period: normalizedPeriod, entries: [], reason: "database_error" };
        }
    }
    logWorldPersistence(event, details = {}) {
        const payload = toObject(details);
        this.logger("[world-persistence]", JSON.stringify({
            event: cleanName(event || "world_persistence"),
            world_id: cleanName(payload.world_id || payload.world_name || ""),
            server_instance: cleanName(payload.server_instance || ""),
            ownership_token: cleanName(payload.ownership_token || ""),
            ownership_epoch: normalizeWorldRevision(payload.ownership_epoch),
            loaded_revision: normalizeWorldRevision(payload.loaded_revision),
            mutation_revision: normalizeWorldRevision(payload.mutation_revision),
            requested_save_revision: normalizeWorldRevision(payload.requested_save_revision),
            persisted_revision: normalizeWorldRevision(payload.persisted_revision),
            affected_row_count: Math.max(0, toInt(payload.affected_row_count, 0)),
            save_result: cleanName(payload.save_result || payload.result || "unknown"),
        }));
    }
    /**
     * The PostgreSQL high-water mark for a world's ownership fence.
     *
     * `claimWorldPersistenceOwnership` only accepts an epoch strictly greater than the value
     * stored on the row, and that value is never cleared. The epoch itself is minted by a
     * Redis counter that CAN be lost (TTL expiry, flush, replica failover), and when it is,
     * the counter restarts near 1 while this column still holds the historical maximum -- so
     * every subsequent claim is refused and the world becomes permanently unjoinable.
     *
     * Callers read this on the rejection path only and feed it back to
     * `redisStore.claimWorldRoute` as a floor, which re-seeds the counter above the mark.
     * It is a plain read, deliberately outside the write queue: it must never add latency to
     * the join path or queue behind unrelated writes.
     * @param {PixelMania.WorldName | string} worldName
     * @returns {Promise<number>}
     */
    async getWorldOwnerEpoch(worldName) {
        const cleanWorldName = cleanName(worldName || "");
        if (cleanWorldName === "" || !this.isReady())
            return 0;
        try {
            const result = await this.queryReadWithRetry("world owner epoch load", `SELECT world_owner_epoch FROM ${this.table("worlds")} WHERE world_name = $1`, [cleanWorldName]);
            return normalizeWorldRevision(result.rows[0]?.world_owner_epoch);
        }
        catch (error) {
            this.logger("[postgres] world owner epoch load failed:", getErrorMessage(error));
            return 0;
        }
    }
    async claimWorldPersistenceOwnership(worldName, ownership = {}) {
        if (!this.isReady()) {
            return {
                ok: false,
                reason: "postgres_unavailable",
                world_id: null,
                loaded_revision: 0,
                requested_revision: 0,
                persisted_revision: 0,
                affected_rows: 0,
            };
        }
        const cleanWorldName = cleanName(worldName || "");
        const metadata = normalizeWorldPersistenceMetadata({ ...toObject(ownership), require_owner: true });
        if (cleanWorldName === "" ||
            metadata.server_instance === "" ||
            metadata.ownership_token === "" ||
            metadata.ownership_epoch <= 0) {
            return {
                ok: false,
                reason: "invalid_world_ownership",
                world_id: null,
                loaded_revision: 0,
                requested_revision: 0,
                persisted_revision: 0,
                affected_rows: 0,
            };
        }
        try {
            const result = await this.withTransaction(async (client) => {
                await client.query(`
          INSERT INTO ${this.table("worlds")} (
            world_name,
            width,
            height,
            world_data_version,
            last_saved_at,
            is_active,
            world_checksum,
            world_state,
            world_revision,
            world_owner_epoch,
            world_owner_token,
            world_owner_instance,
            created_at,
            updated_at
          )
          VALUES ($1, 100, 70, 1, now(), true, '', '{}'::jsonb, 0, $2, $3, $4, now(), now())
          ON CONFLICT (world_name) DO NOTHING
          `, [cleanWorldName, metadata.ownership_epoch, metadata.ownership_token, metadata.server_instance]);
                const locked = await client.query(`
          SELECT world_id::text AS world_id,
                 world_revision,
                 world_owner_epoch,
                 world_owner_token,
                 world_owner_instance
            FROM ${this.table("worlds")}
           WHERE world_name = $1
           FOR UPDATE
          `, [cleanWorldName]);
                const row = locked.rows[0];
                const loadedRevision = normalizeWorldRevision(row?.world_revision);
                const currentEpoch = normalizeWorldRevision(row?.world_owner_epoch);
                const currentToken = cleanName(row?.world_owner_token || "");
                const currentInstance = cleanName(row?.world_owner_instance || "");
                const sameOwner = currentEpoch === metadata.ownership_epoch
                    && currentToken === metadata.ownership_token
                    && currentInstance === metadata.server_instance;
                if (!sameOwner && currentEpoch >= metadata.ownership_epoch) {
                    return {
                        ok: false,
                        reason: "world_ownership_fence_rejected",
                        world_id: cleanName(row?.world_id || "") || null,
                        loaded_revision: loadedRevision,
                        requested_revision: loadedRevision,
                        persisted_revision: loadedRevision,
                        affected_rows: 0,
                    };
                }
                let affectedRows = 0;
                if (!sameOwner) {
                    const updated = await client.query(`
            UPDATE ${this.table("worlds")}
               SET world_owner_epoch = $2,
                   world_owner_token = $3,
                   world_owner_instance = $4,
                   updated_at = now()
             WHERE world_name = $1
               AND world_owner_epoch < $2
            RETURNING world_id::text AS world_id, world_revision
            `, [cleanWorldName, metadata.ownership_epoch, metadata.ownership_token, metadata.server_instance]);
                    affectedRows = Math.max(0, toInt(updated.rowCount, 0));
                    if (affectedRows !== 1) {
                        return {
                            ok: false,
                            reason: "world_ownership_fence_race",
                            world_id: cleanName(row?.world_id || "") || null,
                            loaded_revision: loadedRevision,
                            requested_revision: loadedRevision,
                            persisted_revision: loadedRevision,
                            affected_rows: affectedRows,
                        };
                    }
                }
                return {
                    ok: true,
                    reason: "",
                    world_id: cleanName(row?.world_id || "") || null,
                    loaded_revision: loadedRevision,
                    requested_revision: loadedRevision,
                    persisted_revision: loadedRevision,
                    affected_rows: affectedRows,
                    idempotent: sameOwner,
                };
            });
            const claimResult = result || {
                ok: false,
                reason: "world_ownership_claim_failed",
                world_id: null,
                loaded_revision: 0,
                requested_revision: 0,
                persisted_revision: 0,
                affected_rows: 0,
            };
            this.logWorldPersistence("ownership_claim", {
                world_id: cleanWorldName,
                server_instance: metadata.server_instance,
                ownership_token: metadata.ownership_token,
                ownership_epoch: metadata.ownership_epoch,
                loaded_revision: claimResult.loaded_revision,
                requested_save_revision: claimResult.requested_revision,
                persisted_revision: claimResult.persisted_revision,
                affected_row_count: claimResult.affected_rows,
                save_result: claimResult.ok ? (claimResult.idempotent ? "owner_refreshed" : "owner_claimed") : claimResult.reason,
            });
            return claimResult;
        }
        catch (error) {
            this.logWorldPersistence("ownership_claim", {
                world_id: cleanWorldName,
                server_instance: metadata.server_instance,
                ownership_token: metadata.ownership_token,
                ownership_epoch: metadata.ownership_epoch,
                loaded_revision: 0,
                mutation_revision: 0,
                requested_save_revision: 0,
                persisted_revision: 0,
                affected_row_count: 0,
                save_result: "database_error",
            });
            this.logger("[postgres] world ownership claim failed:", getErrorMessage(error));
            return {
                ok: false,
                reason: "database_error",
                world_id: null,
                loaded_revision: 0,
                requested_revision: 0,
                persisted_revision: 0,
                affected_rows: 0,
            };
        }
    }
    async upsertWorldState(client, worldName, worldState, ownership = {}) {
        const cleanWorldName = cleanName(worldName || worldState?.world_name || "START") || "START";
        const state = safeJson({ ...toObject(worldState), world_name: cleanWorldName });
        const metadata = normalizeWorldPersistenceMetadata(ownership, state);
        const requestedRevision = metadata.requested_revision;
        state.world_revision = requestedRevision;
        const checksum = worldPersistenceChecksum(state);
        const locked = await client.query(`
      SELECT world_id::text AS world_id,
             world_revision,
             world_owner_epoch,
             world_owner_token,
             world_owner_instance,
             world_checksum
        FROM ${this.table("worlds")}
       WHERE world_name = $1
       FOR UPDATE
      `, [cleanWorldName]);
        const row = locked.rows[0];
        const persistedRevision = normalizeWorldRevision(row?.world_revision);
        const worldId = cleanName(row?.world_id || "") || null;
        const rowHasOwnershipFence = Boolean(normalizeWorldRevision(row?.world_owner_epoch) > 0
            || cleanName(row?.world_owner_token || "") !== ""
            || cleanName(row?.world_owner_instance || "") !== "");
        if (rowHasOwnershipFence && !metadata.require_owner) {
            const rejected = {
                ok: false,
                reason: "world_ownership_required",
                world_id: worldId,
                loaded_revision: persistedRevision,
                requested_revision: requestedRevision,
                persisted_revision: persistedRevision,
                affected_rows: 0,
            };
            this.logWorldPersistence("save", {
                world_id: cleanWorldName,
                server_instance: metadata.server_instance,
                ownership_token: metadata.ownership_token,
                ownership_epoch: metadata.ownership_epoch,
                loaded_revision: persistedRevision,
                requested_save_revision: requestedRevision,
                persisted_revision: persistedRevision,
                affected_row_count: 0,
                save_result: rejected.reason,
            });
            return rejected;
        }
        if (metadata.require_owner) {
            const ownerMatches = metadata.server_instance !== ""
                && metadata.ownership_token !== ""
                && metadata.ownership_epoch > 0
                && cleanName(row?.world_owner_instance || "") === metadata.server_instance
                && cleanName(row?.world_owner_token || "") === metadata.ownership_token
                && normalizeWorldRevision(row?.world_owner_epoch) === metadata.ownership_epoch;
            if (!ownerMatches) {
                const rejected = {
                    ok: false,
                    reason: "world_ownership_fence_rejected",
                    world_id: worldId,
                    loaded_revision: persistedRevision,
                    requested_revision: requestedRevision,
                    persisted_revision: persistedRevision,
                    affected_rows: 0,
                };
                this.logWorldPersistence("save", {
                    world_id: cleanWorldName,
                    server_instance: metadata.server_instance,
                    ownership_token: metadata.ownership_token,
                    ownership_epoch: metadata.ownership_epoch,
                    loaded_revision: persistedRevision,
                    requested_save_revision: requestedRevision,
                    persisted_revision: persistedRevision,
                    affected_row_count: 0,
                    save_result: rejected.reason,
                });
                return rejected;
            }
        }
        if (row && requestedRevision < persistedRevision) {
            const stale = {
                ok: false,
                reason: "stale_world_revision",
                world_id: worldId,
                loaded_revision: persistedRevision,
                requested_revision: requestedRevision,
                persisted_revision: persistedRevision,
                affected_rows: 0,
            };
            this.logWorldPersistence("save", {
                world_id: cleanWorldName,
                server_instance: metadata.server_instance,
                ownership_token: metadata.ownership_token,
                ownership_epoch: metadata.ownership_epoch,
                loaded_revision: persistedRevision,
                requested_save_revision: requestedRevision,
                persisted_revision: persistedRevision,
                affected_row_count: 0,
                save_result: stale.reason,
            });
            return stale;
        }
        if (row && requestedRevision === persistedRevision) {
            // world_checksum is written in the same statement as world_state on both the INSERT
            // (:world_checksum, $5) and UPDATE (world_checksum = $5) branches below, and nothing
            // else in this file writes worlds.world_state -- so the stored column is by
            // construction the checksum of the stored blob and cannot go stale.
            //
            // Comparing against it lets this path skip transferring and re-hashing the entire
            // world blob (a full jsonb SELECT + parse + stable-key traversal, all synchronous on
            // the event loop) on every world save. This is the idempotent-retry path, which is
            // exactly the hot one when a client re-sends. Legacy rows written before the column
            // was populated fall back to the original comparison, fetching the blob only then --
            // the row is already locked FOR UPDATE above, so the extra read is safe.
            const storedWorldChecksum = cleanName(row.world_checksum || "");
            let sameState;
            if (storedWorldChecksum !== "") {
                sameState = storedWorldChecksum === checksum;
            }
            else {
                const legacyState = await client.query(`SELECT world_state FROM ${this.table("worlds")} WHERE world_name = $1`, [cleanWorldName]);
                sameState = worldPersistenceChecksum(toObject(legacyState.rows[0]?.world_state)) === checksum;
            }
            const equalRevision = {
                ok: sameState,
                reason: sameState ? "" : "world_revision_content_conflict",
                world_id: worldId,
                loaded_revision: persistedRevision,
                requested_revision: requestedRevision,
                persisted_revision: persistedRevision,
                affected_rows: 0,
                idempotent: sameState,
            };
            this.logWorldPersistence("save", {
                world_id: cleanWorldName,
                server_instance: metadata.server_instance,
                ownership_token: metadata.ownership_token,
                ownership_epoch: metadata.ownership_epoch,
                loaded_revision: persistedRevision,
                requested_save_revision: requestedRevision,
                persisted_revision: persistedRevision,
                affected_row_count: 0,
                save_result: sameState ? "idempotent" : equalRevision.reason,
            });
            return equalRevision;
        }
        let result;
        if (!row) {
            result = await client.query(`
        INSERT INTO ${this.table("worlds")} (
          world_name,
          width,
          height,
          world_data_version,
          last_saved_at,
          is_active,
          world_checksum,
          world_state,
          world_revision,
          world_owner_epoch,
          world_owner_token,
          world_owner_instance,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, now(), true, $5, $6::jsonb, $7, $8, $9, $10, now(), now())
        ON CONFLICT (world_name) DO NOTHING
        RETURNING world_id::text AS world_id, world_revision
        `, [
                cleanWorldName,
                Math.max(1, toInt(state.width || state.world_width, 100)),
                Math.max(1, toInt(state.height || state.world_height, 70)),
                Math.max(1, toInt(state.world_state_version || state.world_data_version, 1)),
                checksum,
                JSON.stringify(state),
                requestedRevision,
                metadata.ownership_epoch,
                metadata.ownership_token,
                metadata.server_instance,
            ]);
        }
        else {
            const ownerPredicate = metadata.require_owner
                ? "AND world_owner_epoch = $8 AND world_owner_token = $9 AND world_owner_instance = $10"
                : "";
            result = await client.query(`
        UPDATE ${this.table("worlds")}
           SET width = $2,
               height = $3,
               world_data_version = $4,
               last_saved_at = now(),
               is_active = true,
               world_checksum = $5,
               world_state = $6::jsonb,
               world_revision = $7,
               updated_at = now()
         WHERE world_name = $1
           AND world_revision = $11
           ${ownerPredicate}
        RETURNING world_id::text AS world_id, world_revision
        `, [
                cleanWorldName,
                Math.max(1, toInt(state.width || state.world_width, 100)),
                Math.max(1, toInt(state.height || state.world_height, 70)),
                Math.max(1, toInt(state.world_state_version || state.world_data_version, 1)),
                checksum,
                JSON.stringify(state),
                requestedRevision,
                metadata.ownership_epoch,
                metadata.ownership_token,
                metadata.server_instance,
                persistedRevision,
            ]);
        }
        const affectedRows = Math.max(0, toInt(result.rowCount, 0));
        const savedWorldId = cleanName(result.rows[0]?.world_id || worldId || "") || null;
        const savedRevision = normalizeWorldRevision(result.rows[0]?.world_revision ?? persistedRevision);
        const saved = affectedRows === 1;
        if (saved && savedWorldId) {
            await this.mirrorWorldDropsState(client, savedWorldId, state);
        }
        const saveResult = {
            ok: saved,
            reason: saved ? "" : "world_revision_cas_rejected",
            world_id: savedWorldId,
            loaded_revision: persistedRevision,
            requested_revision: requestedRevision,
            persisted_revision: saved ? requestedRevision : savedRevision,
            affected_rows: affectedRows,
        };
        this.logWorldPersistence("save", {
            world_id: cleanWorldName,
            server_instance: metadata.server_instance,
            ownership_token: metadata.ownership_token,
            ownership_epoch: metadata.ownership_epoch,
            loaded_revision: persistedRevision,
            requested_save_revision: requestedRevision,
            persisted_revision: saveResult.persisted_revision,
            affected_row_count: affectedRows,
            save_result: saved ? "persisted" : saveResult.reason,
        });
        return saveResult;
    }
    /**
     * @param {unknown} client
     * @param {unknown} worldId
     * @param {PixelMania.WorldDropPayloadInput | Record<string, unknown>} drop
     * @param {PixelMania.UpsertWorldDropOptions | Record<string, unknown>} options
     * @returns {Promise<PixelMania.UpsertWorldDropResult>}
     */
    async upsertWorldDropRow(client, worldId, drop = {}, options = {}) {
        if (!worldId)
            return { ok: false, reason: "missing_world" };
        const normalized = normalizeWorldDropPayload(drop, options);
        if (!normalized)
            return { ok: false, reason: "invalid_drop" };
        const mirroredFromWorldState = Boolean(options.mirrored_from_world_state);
        const metadata = {
            ...safeJson(normalized.metadata),
            ...(safeJson(options.metadata)),
            source: cleanName(options.source || ""),
            action: cleanName(options.action || ""),
            source_id: cleanName(options.source_id || ""),
            mirrored_from_world_state: mirroredFromWorldState,
        };
        // The world-state mirror republishes every live drop on every world save, so
        // its metadata must never overwrite the authoritative origin recorded when the
        // drop was first written. The origin decides whether tracked item instances may
        // be rebuilt during pickup, and a mirrored "world_state_mirror" source would
        // erase that provenance.
        if (!mirroredFromWorldState) {
            const originSource = cleanName(options.origin_source || options.source || "");
            if (originSource !== "") {
                metadata.origin_source = originSource;
                metadata.origin_action = cleanName(options.origin_action || options.action || "");
            }
        }
        await client.query(`
      INSERT INTO ${this.table("world_drops")} (
        world_id,
        drop_id,
        item_type,
        item_category,
        amount,
        x,
        y,
        stack_grid_x,
        stack_grid_y,
        pickup_delay,
        status,
        picked_by_player_id,
        picked_at,
        removed_at,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        'active',
        NULL,
        NULL,
        NULL,
        $11::jsonb,
        now(),
        now()
      )
      ON CONFLICT (world_id, drop_id) DO UPDATE
        SET item_type = EXCLUDED.item_type,
            item_category = EXCLUDED.item_category,
            amount = EXCLUDED.amount,
            x = EXCLUDED.x,
            y = EXCLUDED.y,
            stack_grid_x = EXCLUDED.stack_grid_x,
            stack_grid_y = EXCLUDED.stack_grid_y,
            pickup_delay = EXCLUDED.pickup_delay,
            status = 'active',
            picked_by_player_id = NULL,
            picked_at = NULL,
            removed_at = NULL,
            metadata = ${this.table("world_drops")}.metadata || EXCLUDED.metadata,
            updated_at = now()
      `, [
            worldId,
            normalized.drop_id,
            normalized.item_type,
            normalized.item_category,
            normalized.amount,
            normalized.x,
            normalized.y,
            normalized.stack_grid_x,
            normalized.stack_grid_y,
            normalized.pickup_delay,
            JSON.stringify(metadata),
        ]);
        return { ok: true, drop: normalized };
    }
    /**
     * @param {unknown} client
     * @param {unknown} worldId
     * @param {Record<string, unknown>} worldState
     * @returns {Promise<PixelMania.MirrorWorldDropsStateResult>}
     */
    async mirrorWorldDropsState(client, worldId, worldState = {}) {
        if (!worldId)
            return { ok: false, reason: "missing_world" };
        const state = toObject(worldState);
        if (!Object.prototype.hasOwnProperty.call(state, "drops") && !Object.prototype.hasOwnProperty.call(state, "item_drops")) {
            return { ok: true, skipped: true };
        }
        const rawDrops = Array.isArray(state.drops)
            ? state.drops
            : (Array.isArray(state.item_drops) ? state.item_drops : []);
        const activeDropIds = [];
        for (const rawDrop of rawDrops) {
            const upsert = await this.upsertWorldDropRow(client, worldId, rawDrop, {
                source: "world_state_mirror",
                action: "mirror",
                mirrored_from_world_state: true,
            });
            if (upsert.ok && upsert.drop?.drop_id) {
                activeDropIds.push(upsert.drop.drop_id);
            }
        }
        if (activeDropIds.length > 0) {
            await client.query(`
        UPDATE ${this.table("world_drops")}
           SET status = 'removed',
               amount = 0,
               removed_at = COALESCE(removed_at, now()),
               metadata = metadata || $3::jsonb,
               updated_at = now()
         WHERE world_id = $1
           AND status = 'active'
           AND NOT (drop_id = ANY($2::text[]))
        `, [
                worldId,
                activeDropIds,
                JSON.stringify({ source: "world_state_mirror", action: "mirror_removed" }),
            ]);
        }
        else {
            await client.query(`
        UPDATE ${this.table("world_drops")}
           SET status = 'removed',
               amount = 0,
               removed_at = COALESCE(removed_at, now()),
               metadata = metadata || $2::jsonb,
               updated_at = now()
         WHERE world_id = $1
           AND status = 'active'
        `, [
                worldId,
                JSON.stringify({ source: "world_state_mirror", action: "mirror_cleared" }),
            ]);
        }
        return { ok: true, active_drop_count: activeDropIds.length };
    }
    async mirrorWorldLockState(client, worldId, worldState) {
        if (!worldId)
            return;
        const state = toObject(worldState);
        const lock = toObject(state.world_lock);
        const isLocked = Boolean(lock.is_locked);
        const cleanLockType = cleanName(lock.lock_block_type || lock.lock_type || "world_lock").toLowerCase();
        const lockType = isLocked && cleanLockType === "super_world_lock" ? "super_world_lock" : (isLocked ? "world_lock" : "none");
        if (!isLocked) {
            await client.query(`DELETE FROM ${this.table("world_lock_access")} WHERE world_id = $1`, [worldId]);
            await client.query(`DELETE FROM ${this.table("world_members")} WHERE world_id = $1 AND role <> 'owner'`, [worldId]);
        }
        const ownerName = cleanName(lock.owner_username || lock.owner_name || "");
        let ownerPlayerId = isUuid(cleanName(lock.owner_player_id || lock.owner_profile_id || "")) ? cleanName(lock.owner_player_id || lock.owner_profile_id || "") : null;
        let ownerAccountId = isUuid(cleanName(lock.owner_account_id || "")) ? cleanName(lock.owner_account_id || "") : null;
        if (!ownerPlayerId && ownerAccountId) {
            ownerPlayerId = await this.lookupPlayerIdByAccountId(client, ownerAccountId);
        }
        if (!ownerPlayerId && ownerName !== "") {
            ownerPlayerId = await this.ensurePlayerIdentity(client, ownerName);
        }
        if (!ownerAccountId && ownerPlayerId) {
            ownerAccountId = await this.lookupAccountIdByPlayerId(client, ownerPlayerId);
        }
        const lockMetadata = safeJson({
            ...lock,
            owner_name: ownerName || cleanName(lock.owner_name || "").toUpperCase(),
            owner_account_id: ownerAccountId || cleanName(lock.owner_account_id || ""),
            owner_player_id: ownerPlayerId || cleanName(lock.owner_player_id || lock.owner_profile_id || ""),
            owner_profile_id: ownerPlayerId || cleanName(lock.owner_player_id || lock.owner_profile_id || ""),
        });
        const allowedPlayers = Array.isArray(lock.allowed_players) ? lock.allowed_players : [];
        const roles = toObject(lock.player_roles);
        const allowedAccountIdSet = new Set(Array.isArray(lock.allowed_account_ids) ? lock.allowed_account_ids.map((id) => cleanName(id)).filter(Boolean) : []);
        const allowedPlayerIdSet = new Set(Array.isArray(lock.allowed_player_ids) ? lock.allowed_player_ids.map((id) => cleanName(id)).filter(Boolean) : []);
        const rolesByAccountId = toObject(lock.player_roles_by_account_id);
        const rolesByPlayerId = toObject(lock.player_roles_by_player_id);
        const resolvedAllowedIdentities = new Map();
        // ensurePlayerIdentity upserts accounts+players, i.e. it takes exclusive row locks on
        // arbitrary THIRD-PARTY players late in this transaction. Iterating in raw array order
        // means two worlds with overlapping member lists can acquire the same player rows in
        // opposite order -- a genuine ABBA deadlock the moment write concurrency exceeds 1.
        // The app-level inventory mutex does not cover these players (it only covers the acting
        // player), and per-world serialization does not either (different worlds, different
        // keys). Acquire in a deterministic global order instead. Both passes below are keyed
        // upserts with no ordinal semantics, so ordering is unobservable to callers.
        const orderedAllowedPlayers = [...allowedPlayers].sort((left, right) => (cleanName(left).toLowerCase().localeCompare(cleanName(right).toLowerCase())));
        for (const rawName of orderedAllowedPlayers) {
            const memberName = cleanName(rawName);
            if (memberName === "" || (ownerName !== "" && memberName.toLowerCase() === ownerName.toLowerCase()))
                continue;
            const memberPlayerId = await this.ensurePlayerIdentity(client, memberName);
            if (!memberPlayerId)
                continue;
            const memberAccountId = await this.lookupAccountIdByPlayerId(client, memberPlayerId);
            const rawRole = cleanName(roles[memberName] || roles[memberName.toUpperCase()] || "member").toLowerCase();
            const memberRole = rawRole === "admin" || rawRole === "builder" ? rawRole : "member";
            resolvedAllowedIdentities.set(memberName.toLowerCase(), { player_id: memberPlayerId, account_id: memberAccountId, role: memberRole });
            allowedPlayerIdSet.add(memberPlayerId);
            rolesByPlayerId[memberPlayerId] = memberRole;
            if (memberAccountId) {
                allowedAccountIdSet.add(memberAccountId);
                rolesByAccountId[memberAccountId] = memberRole;
            }
        }
        lockMetadata.allowed_account_ids = Array.from(allowedAccountIdSet);
        lockMetadata.allowed_player_ids = Array.from(allowedPlayerIdSet);
        lockMetadata.player_roles_by_account_id = rolesByAccountId;
        lockMetadata.player_roles_by_player_id = rolesByPlayerId;
        await client.query(`
      INSERT INTO ${this.table("world_locks")} (
        world_id,
        lock_type,
        owner_player_id,
        is_locked,
        lock_x,
        lock_y,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
      ON CONFLICT (world_id) DO UPDATE
        SET lock_type = EXCLUDED.lock_type,
            owner_player_id = EXCLUDED.owner_player_id,
            is_locked = EXCLUDED.is_locked,
            lock_x = EXCLUDED.lock_x,
            lock_y = EXCLUDED.lock_y,
            metadata = EXCLUDED.metadata,
            updated_at = now()
      `, [
            worldId,
            lockType,
            ownerPlayerId,
            isLocked,
            Number.isFinite(Number(lock.lock_grid_x)) ? Math.trunc(Number(lock.lock_grid_x)) : null,
            Number.isFinite(Number(lock.lock_grid_y)) ? Math.trunc(Number(lock.lock_grid_y)) : null,
            JSON.stringify(lockMetadata),
        ]);
        if (ownerPlayerId) {
            await client.query(`DELETE FROM ${this.table("world_members")} WHERE world_id = $1 AND role = 'owner' AND player_id <> $2`, [worldId, ownerPlayerId]);
            await client.query(`
        INSERT INTO ${this.table("world_members")} (world_id, player_id, role, granted_by_player_id, created_at)
        VALUES ($1, $2, 'owner', $2, now())
        ON CONFLICT (world_id, player_id) DO UPDATE
          SET role = 'owner',
              granted_by_player_id = EXCLUDED.granted_by_player_id
        `, [worldId, ownerPlayerId]);
        }
        else if (!isLocked) {
            await client.query(`DELETE FROM ${this.table("world_members")} WHERE world_id = $1 AND role = 'owner'`, [worldId]);
        }
        const memberUpsertRows = new Map();
        for (const rawName of orderedAllowedPlayers) {
            const memberName = cleanName(rawName);
            if (memberName === "" || (ownerName !== "" && memberName.toLowerCase() === ownerName.toLowerCase()))
                continue;
            const resolvedMember = resolvedAllowedIdentities.get(memberName.toLowerCase()) || {};
            const memberPlayerId = resolvedMember.player_id || await this.ensurePlayerIdentity(client, memberName);
            if (!memberPlayerId)
                continue;
            const memberRole = resolvedMember.role || "member";
            const canBuild = memberRole === "admin" || memberRole === "builder" || Boolean(lock.public_build);
            const canManage = memberRole === "admin";
            // Collect first, write once. This loop used to issue two upserts PER MEMBER, on every
            // world save -- and a world save happens on every block placement, so a lock with 20
            // allowed players cost 40 sequential round trips per placement while holding the
            // exclusive worlds row lock.
            //
            // Keyed by player_id so a duplicate name in allowed_players collapses to one row:
            // a multi-row INSERT ... ON CONFLICT DO UPDATE errors with "cannot affect row a second
            // time" if the same conflict target appears twice in one statement. Map.set keeps the
            // LAST write, matching the previous statement-per-member last-write-wins behaviour,
            // and preserves the sorted insertion order established above.
            memberUpsertRows.set(memberPlayerId, {
                player_id: memberPlayerId,
                role: memberRole,
                can_build: canBuild,
                can_manage: canManage,
            });
        }
        if (memberUpsertRows.size > 0) {
            const memberRows = [...memberUpsertRows.values()];
            const memberPlayerIds = memberRows.map((entry) => entry.player_id);
            const memberRoles = memberRows.map((entry) => entry.role);
            const memberCanBuild = memberRows.map((entry) => entry.can_build);
            const memberCanManage = memberRows.map((entry) => entry.can_manage);
            await client.query(`
        INSERT INTO ${this.table("world_members")} (world_id, player_id, role, granted_by_player_id, created_at)
        SELECT $1, member.player_id, member.role, $2, now()
          FROM UNNEST($3::uuid[], $4::text[]) AS member(player_id, role)
        ON CONFLICT (world_id, player_id) DO UPDATE
          SET role = EXCLUDED.role,
              granted_by_player_id = EXCLUDED.granted_by_player_id
        `, [worldId, ownerPlayerId, memberPlayerIds, memberRoles]);
            await client.query(`
        INSERT INTO ${this.table("world_lock_access")} (
          world_id,
          player_id,
          granted_by_player_id,
          can_build,
          can_break,
          can_manage_vending,
          can_manage_lock,
          created_at,
          updated_at
        )
        SELECT $1, access.player_id, $2, access.can_build, access.can_build, access.can_manage, access.can_manage, now(), now()
          FROM UNNEST($3::uuid[], $4::boolean[], $5::boolean[]) AS access(player_id, can_build, can_manage)
        ON CONFLICT (world_id, player_id) DO UPDATE
          SET granted_by_player_id = EXCLUDED.granted_by_player_id,
              can_build = EXCLUDED.can_build,
              can_break = EXCLUDED.can_break,
              can_manage_vending = EXCLUDED.can_manage_vending,
              can_manage_lock = EXCLUDED.can_manage_lock,
              updated_at = now()
        `, [worldId, ownerPlayerId, memberPlayerIds, memberCanBuild, memberCanManage]);
        }
    }
    async mirrorWorldAreaLocksState(client, worldId, worldState) {
        if (!worldId)
            return;
        const state = toObject(worldState);
        const rawLocks = Array.isArray(state.area_locks)
            ? state.area_locks
            : (Array.isArray(toObject(state.world_lock).area_locks) ? toObject(state.world_lock).area_locks : []);
        await client.query(`DELETE FROM ${this.table("world_area_locks")} WHERE world_id = $1`, [worldId]);
        for (const rawLock of rawLocks) {
            const lock = toObject(rawLock);
            const lockType = cleanName(lock.lock_type || lock.block_type || "").toLowerCase();
            if (lockType !== "small_lock" && lockType !== "medium_lock" && lockType !== "big_lock")
                continue;
            const lockX = Number.isFinite(Number(lock.lock_grid_x)) ? Math.trunc(Number(lock.lock_grid_x)) : 0;
            const lockY = Number.isFinite(Number(lock.lock_grid_y)) ? Math.trunc(Number(lock.lock_grid_y)) : 0;
            const defaultMaxTiles = lockType === "big_lock" ? 80 : (lockType === "medium_lock" ? 48 : 10);
            const maxTiles = Number.isFinite(Number(lock.max_tiles)) ? Math.max(1, Math.trunc(Number(lock.max_tiles))) : defaultMaxTiles;
            const lockKey = String(lock.lock_id || `${lockType}:${lockX}:${lockY}`).trim().slice(0, 96) || `${lockType}:${lockX}:${lockY}`;
            const ownerName = cleanName(lock.owner_username || lock.owner_name || "");
            let ownerPlayerId = isUuid(cleanName(lock.owner_player_id || lock.owner_profile_id || "")) ? cleanName(lock.owner_player_id || lock.owner_profile_id || "") : null;
            let ownerAccountId = isUuid(cleanName(lock.owner_account_id || "")) ? cleanName(lock.owner_account_id || "") : null;
            if (!ownerPlayerId && ownerAccountId) {
                ownerPlayerId = await this.lookupPlayerIdByAccountId(client, ownerAccountId);
            }
            if (!ownerPlayerId && ownerName !== "") {
                ownerPlayerId = await this.ensurePlayerIdentity(client, ownerName);
            }
            if (!ownerAccountId && ownerPlayerId) {
                ownerAccountId = await this.lookupAccountIdByPlayerId(client, ownerPlayerId);
            }
            const lockMetadata = safeJson({
                ...lock,
                owner_account_id: ownerAccountId || cleanName(lock.owner_account_id || ""),
                owner_player_id: ownerPlayerId || cleanName(lock.owner_player_id || lock.owner_profile_id || ""),
                owner_profile_id: ownerPlayerId || cleanName(lock.owner_player_id || lock.owner_profile_id || ""),
            });
            const inserted = await client.query(`
        INSERT INTO ${this.table("world_area_locks")} (
          world_id,
          lock_key,
          lock_type,
          owner_player_id,
          lock_x,
          lock_y,
          max_tiles,
          public_build,
          ignore_empty_space,
          metadata,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now(),now())
        ON CONFLICT (world_id, lock_key) DO UPDATE
          SET lock_type = EXCLUDED.lock_type,
              owner_player_id = EXCLUDED.owner_player_id,
              lock_x = EXCLUDED.lock_x,
              lock_y = EXCLUDED.lock_y,
              max_tiles = EXCLUDED.max_tiles,
              public_build = EXCLUDED.public_build,
              ignore_empty_space = EXCLUDED.ignore_empty_space,
              metadata = EXCLUDED.metadata,
              updated_at = now()
        RETURNING world_area_lock_id
        `, [worldId, lockKey, lockType, ownerPlayerId, lockX, lockY, maxTiles, lock.public_build === true, lock.ignore_empty_space === true, JSON.stringify(lockMetadata)]);
            const areaLockId = inserted.rows[0]?.world_area_lock_id;
            if (!areaLockId)
                continue;
            const roles = toObject(lock.player_roles);
            const allowedPlayers = Array.isArray(lock.allowed_players) ? lock.allowed_players : [];
            // Same third-party lock-ordering hazard as mirrorWorldLockState above.
            const orderedAreaLockPlayers = [...allowedPlayers].sort((left, right) => (cleanName(left).toLowerCase().localeCompare(cleanName(right).toLowerCase())));
            for (const rawName of orderedAreaLockPlayers) {
                const playerName = cleanName(rawName);
                if (playerName === "")
                    continue;
                const playerId = await this.ensurePlayerIdentity(client, playerName);
                if (!playerId)
                    continue;
                const roleKey = playerName.toUpperCase();
                const rawRole = cleanName(roles[playerName] || roles[roleKey] || "builder").toLowerCase();
                const role = rawRole === "admin" || rawRole === "visitor" ? rawRole : "builder";
                await client.query(`
          INSERT INTO ${this.table("world_area_lock_access")} (
            world_area_lock_id,
            player_id,
            granted_by_player_id,
            role,
            can_build,
            can_manage_lock,
            created_at,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,now(),now())
          ON CONFLICT (world_area_lock_id, player_id) DO UPDATE
            SET granted_by_player_id = EXCLUDED.granted_by_player_id,
                role = EXCLUDED.role,
                can_build = EXCLUDED.can_build,
                can_manage_lock = EXCLUDED.can_manage_lock,
                updated_at = now()
          `, [areaLockId, playerId, ownerPlayerId, role, role === "admin" || role === "builder", role === "admin"]);
            }
        }
    }
    async saveWorldState(worldName, state, ownership = {}) {
        const cleanWorldName = cleanName(worldName || state?.world_name || "START") || "START";
        const metadata = normalizeWorldPersistenceMetadata(ownership, state);
        const requestedRevision = normalizeWorldRevision(state?.world_revision);
        if (!this.isReady()) {
            this.logWorldPersistence("save", {
                world_id: cleanWorldName,
                server_instance: metadata.server_instance,
                ownership_token: metadata.ownership_token,
                ownership_epoch: metadata.ownership_epoch,
                mutation_revision: requestedRevision,
                requested_save_revision: requestedRevision,
                persisted_revision: 0,
                affected_row_count: 0,
                save_result: "postgres_unavailable",
            });
            return false;
        }
        try {
            const result = await this.withTransaction(async (client) => {
                const persisted = await this.upsertWorldState(client, cleanWorldName, state, ownership);
                if (!persisted.ok || !persisted.world_id)
                    return persisted;
                await this.mirrorWorldLockState(client, persisted.world_id, state);
                await this.mirrorWorldAreaLocksState(client, persisted.world_id, state);
                return persisted;
            }, "save world state", postgresWorldWriteScope(cleanWorldName));
            return Boolean(result?.ok);
        }
        catch (error) {
            this.logWorldPersistence("save", {
                world_id: cleanWorldName,
                server_instance: metadata.server_instance,
                ownership_token: metadata.ownership_token,
                ownership_epoch: metadata.ownership_epoch,
                mutation_revision: requestedRevision,
                requested_save_revision: requestedRevision,
                persisted_revision: 0,
                affected_row_count: 0,
                save_result: "database_error",
            });
            this.logger("[postgres] world state save failed:", getErrorMessage(error));
            return false;
        }
    }
    /**
     * @param {unknown} client
     * @param {unknown} worldId
     * @param {PixelMania.WorldChangeEntry | Record<string, unknown>} entry
     * @returns {Promise<PixelMania.PostgresWorldChangeInsertResult>}
     */
    async insertWorldBlockChange(client, worldId, entry = {}) {
        const values = await this.buildWorldBlockChangeRowValues(client, worldId, entry);
        if (!values)
            return null;
        await client.query(this.buildWorldBlockChangeInsertStatement(1), values);
        return { ok: true };
    }
    /**
     * Field mapping for one `world_block_changes` row, split out from the statement so the
     * single-row writer and the batched writer share one definition of what a row means.
     * Resolving the actor identity is the only await here; it is memoized per transaction by
     * `ensurePlayerIdentity`, so a batch of changes by one actor pays for it once.
     * @param {unknown} client
     * @param {unknown} worldId
     * @param {PixelMania.WorldChangeEntry | Record<string, unknown>} entry
     * @returns {Promise<any[] | null>}
     */
    async buildWorldBlockChangeRowValues(client, worldId, entry = {}) {
        if (!worldId)
            return null;
        const e = toObject(entry);
        let playerId = null;
        const actor = cleanName(e.actor_username || "");
        if (actor !== "") {
            playerId = await this.ensurePlayerIdentity(client, actor);
        }
        const action = cleanName(e.action || "");
        const mappedAction = action.includes("place")
            ? "place"
            : action.includes("break")
                ? "break"
                : "hit";
        const reason = cleanName(e.reason || action || mappedAction) || mappedAction;
        const layer = cleanName(e.layer || "").toLowerCase() === "background" ? "background" : "foreground";
        const sourceId = cleanName(e.source_id || "");
        const txUuid = isUuid(sourceId) ? sourceId : null;
        const details = toObject(e.details);
        const blockTypeBefore = cleanName(e.block_type_before
            || e.old_block_type
            || e.old_block_id
            || e.previous_block_type
            || details.block_type_before
            || details.old_block_type
            || details.old_block_id
            || "");
        const blockTypeAfter = cleanName(e.block_type_after
            || e.new_block_type
            || e.new_block_id
            || e.block_type
            || details.block_type_after
            || details.new_block_type
            || details.new_block_id
            || "");
        const rawHitCount = Number(e.hit_count ?? details.hit_count ?? details.damage ?? NaN);
        const hitCount = Number.isFinite(rawHitCount) ? Math.max(0, Math.trunc(rawHitCount)) : null;
        return [
            worldId,
            playerId,
            mappedAction,
            reason,
            layer,
            Number.isFinite(Number(e.x)) ? Math.trunc(Number(e.x)) : 0,
            Number.isFinite(Number(e.y)) ? Math.trunc(Number(e.y)) : 0,
            blockTypeBefore,
            blockTypeAfter,
            hitCount,
            txUuid,
            JSON.stringify({
                source_type: cleanName(e.source_type || ""),
                source_id: sourceId,
                reason,
                request_id: cleanName(e.request_id || ""),
                details: safeJson(e.details),
            }),
            cleanName(e.at || ""),
        ];
    }
    /**
     * @param {number} rowCount
     * @returns {string}
     */
    buildWorldBlockChangeInsertStatement(rowCount) {
        const tuples = [];
        for (let row = 0; row < rowCount; row += 1) {
            const base = row * WORLD_BLOCK_CHANGE_COLUMN_COUNT;
            tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, NULLIF($${base + 4}, ''), $${base + 5}, `
                + `$${base + 6}, $${base + 7}, NULLIF($${base + 8}, ''), NULLIF($${base + 9}, ''), `
                + `$${base + 10}, $${base + 11}::uuid, $${base + 12}::jsonb, `
                + `COALESCE(NULLIF($${base + 13}, '')::timestamptz, now()))`);
        }
        return `
      INSERT INTO ${this.table("world_block_changes")} (
        world_id,
        player_id,
        action,
        reason,
        layer,
        block_x,
        block_y,
        block_type_before,
        block_type_after,
        hit_count,
        tx_uuid,
        metadata,
        created_at
      )
      VALUES ${tuples.join(", ")}
      `;
    }
    isWorldObjectChangeEntry(entry = {}) {
        return shouldTreatAsWorldObjectChange(entry);
    }
    /**
     * @param {unknown} client
     * @param {unknown} worldId
     * @param {PixelMania.WorldChangeEntry | Record<string, unknown>} entry
     * @returns {Promise<PixelMania.PostgresWorldChangeInsertResult>}
     */
    async insertWorldObjectChange(client, worldId, entry = {}) {
        const values = await this.buildWorldObjectChangeRowValues(client, worldId, entry);
        if (!values)
            return null;
        await client.query(this.buildWorldObjectChangeInsertStatement(1), values);
        return { ok: true };
    }
    /**
     * Field mapping for one `world_object_changes` row. See buildWorldBlockChangeRowValues
     * for why the mapping is split from the statement.
     * @param {unknown} client
     * @param {unknown} worldId
     * @param {PixelMania.WorldChangeEntry | Record<string, unknown>} entry
     * @returns {Promise<any[] | null>}
     */
    async buildWorldObjectChangeRowValues(client, worldId, entry = {}) {
        if (!worldId)
            return null;
        const e = toObject(entry);
        let playerId = null;
        const actor = cleanName(e.actor_username || "");
        if (actor !== "") {
            playerId = await this.ensurePlayerIdentity(client, actor);
        }
        const objectType = normalizeWorldObjectType(e);
        const objectId = normalizeWorldObjectId(e, cleanName(e.world || ""), objectType);
        const action = normalizeWorldObjectAction(e.action || e.reason || "update") || "update";
        const reason = cleanName(e.reason || action) || action;
        const sourceType = cleanName(e.source_type || "");
        const sourceId = cleanName(e.source_id || "");
        const requestId = cleanName(e.request_id || "");
        const x = Number.isFinite(Number(e.x)) ? Math.trunc(Number(e.x)) : null;
        const y = Number.isFinite(Number(e.y)) ? Math.trunc(Number(e.y)) : null;
        const oldData = clonePlainJson(e.old_data || e.previous_data || e.before || {});
        const newData = clonePlainJson(e.new_data || e.next_data || e.after || e.state || {});
        return [
            worldId,
            playerId,
            objectType,
            objectId,
            x,
            y,
            action,
            reason,
            sourceType,
            sourceId,
            requestId,
            JSON.stringify(oldData),
            JSON.stringify(newData),
            JSON.stringify({
                block_type: cleanName(e.block_type || ""),
                layer: cleanName(e.layer || ""),
                reason,
                details: safeJson(e.details),
            }),
            cleanName(e.at || ""),
        ];
    }
    /**
     * @param {number} rowCount
     * @returns {string}
     */
    buildWorldObjectChangeInsertStatement(rowCount) {
        const tuples = [];
        for (let row = 0; row < rowCount; row += 1) {
            const base = row * WORLD_OBJECT_CHANGE_COLUMN_COUNT;
            tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, `
                + `$${base + 7}, NULLIF($${base + 8}, ''), NULLIF($${base + 9}, ''), `
                + `NULLIF($${base + 10}, ''), NULLIF($${base + 11}, ''), `
                + `$${base + 12}::jsonb, $${base + 13}::jsonb, $${base + 14}::jsonb, `
                + `COALESCE(NULLIF($${base + 15}, '')::timestamptz, now()))`);
        }
        return `
      INSERT INTO ${this.table("world_object_changes")} (
        world_id,
        player_id,
        object_type,
        object_id,
        block_x,
        block_y,
        action,
        reason,
        source_type,
        source_id,
        request_id,
        old_data,
        new_data,
        metadata,
        created_at
      )
      VALUES ${tuples.join(", ")}
      `;
    }
    /**
     * @param {unknown} client
     * @param {unknown} worldId
     * @param {PixelMania.WorldChangeEntry | Record<string, unknown>} entry
     * @returns {Promise<PixelMania.PostgresWorldChangeInsertResult>}
     */
    async recordWorldChangeEntry(client, worldId, entry = {}) {
        if (this.isWorldObjectChangeEntry(entry)) {
            return this.insertWorldObjectChange(client, worldId, entry);
        }
        return this.insertWorldBlockChange(client, worldId, entry);
    }
    /**
     * @param {unknown} client
     * @param {unknown} worldId
     * @param {PixelMania.TrackedWorldDropChangeEntry | PixelMania.WorldChangeEntry | Record<string, unknown>} change
     * @returns {Promise<void>}
     */
    async recordWorldChangeAndTrackedDrops(client, worldId, change = {}) {
        await this.recordWorldChangeEntry(client, worldId, change);
        await this.recordTrackedDropsForWorldChange(client, worldId, change);
    }
    /**
     * The drop-row and item-instance side effects of one world change, split out from the
     * audit-row insert so the batched writer below can emit every audit row in one statement
     * and then replay only these effects, in the original change order.
     * @param {unknown} client
     * @param {unknown} worldId
     * @param {PixelMania.TrackedWorldDropChangeEntry | PixelMania.WorldChangeEntry | Record<string, unknown>} change
     * @returns {Promise<void>}
     */
    async recordTrackedDropsForWorldChange(client, worldId, change = {}) {
        /** @type {PixelMania.TrackedWorldDropChangeDetails} */
        const changeDetails = toObject(change?.details);
        const dropId = cleanName(changeDetails.drop_id || change?.drop_id || "");
        const changeAction = cleanName(change?.action || "").toLowerCase();
        const detailDropX = Number(changeDetails.x);
        const detailDropY = Number(changeDetails.y);
        const auditDropX = Number(change?.x);
        const auditDropY = Number(change?.y);
        const dropX = Number.isFinite(detailDropX) ? detailDropX : (Number.isFinite(auditDropX) ? auditDropX : 0);
        const dropY = Number.isFinite(detailDropY) ? detailDropY : (Number.isFinite(auditDropY) ? auditDropY : 0);
        if (dropId !== "" &&
            (changeAction === "drop_create" ||
                changeAction === "break_drop" ||
                changeAction === "harvest_drop" ||
                changeAction.includes("drop_create"))) {
            await this.upsertWorldDropRow(client, worldId, {
                drop_id: dropId,
                item_type: cleanName(changeDetails.item_type || change?.item_type || change?.block_type || ""),
                item_category: cleanName(changeDetails.item_category || change?.item_category || "block") || "block",
                amount: Math.max(1, toInt(changeDetails.amount || change?.amount || 1, 1)),
                x: dropX,
                y: dropY,
                stack_grid_x: changeDetails.stack_grid_x,
                stack_grid_y: changeDetails.stack_grid_y,
                pickup_delay: changeDetails.pickup_delay,
            }, {
                source: cleanName(change?.source_type || "") || "world_drop",
                action: changeAction || "drop_create",
                source_id: cleanName(change?.source_id || ""),
                metadata: {
                    details: changeDetails,
                },
            });
        }
        if (this.shouldCreateTrackedWorldDropItemInstancesForChange(change)) {
            await this.createTrackedWorldDropItemInstances(client, {
                world_id: worldId,
                actor_username: change?.actor_username || "",
                source: cleanName(change?.source_type || "") || "world_block_break",
                action: cleanName(change?.action || "") || "break_drop",
                item_type: cleanName(change?.item_type || change?.block_type || ""),
                item_category: cleanName(changeDetails.item_category || change?.item_category || "block") || "block",
                amount: Math.max(1, toInt(changeDetails.amount || change?.amount || 1, 1)),
                drop_id: dropId,
                details: {
                    ...changeDetails,
                    source_id: cleanName(change?.source_id || ""),
                    source_block: cleanName(changeDetails.source_block || ""),
                },
            });
        }
    }
    /**
     * Batched world-change writer.
     *
     * A single authoritative save can carry hundreds of changes, and the per-change writer
     * issued one INSERT per change while holding the exclusive lock on the `worlds` row.
     * Grouping the audit rows by target table collapses that into a handful of statements.
     *
     * Ordering and durability are unchanged: every row still lands inside the SAME
     * transaction as the world state it describes, the per-change drop side effects still
     * run sequentially in the original order after the audit rows are written, and any error
     * still aborts the whole transaction. Rows are built before any statement is issued so a
     * mapping failure cannot leave a partially written batch.
     * @param {unknown} client
     * @param {unknown} worldId
     * @param {Array<PixelMania.WorldChangeEntry | Record<string, unknown>>} changes
     * @returns {Promise<void>}
     */
    async recordWorldChangesAndTrackedDrops(client, worldId, changes = []) {
        const pendingChanges = Array.isArray(changes) ? changes : [];
        if (pendingChanges.length === 0)
            return;
        if (!worldId)
            return;
        if (pendingChanges.length === 1) {
            // One change is the overwhelmingly common case (a single block place or break).
            // Keep it on the single-row path so its statement text stays identical.
            await this.recordWorldChangeAndTrackedDrops(client, worldId, pendingChanges[0]);
            return;
        }
        const blockChangeRows = [];
        const objectChangeRows = [];
        for (const change of pendingChanges) {
            if (this.isWorldObjectChangeEntry(change)) {
                const objectRow = await this.buildWorldObjectChangeRowValues(client, worldId, change);
                if (objectRow)
                    objectChangeRows.push(objectRow);
                continue;
            }
            const blockRow = await this.buildWorldBlockChangeRowValues(client, worldId, change);
            if (blockRow)
                blockChangeRows.push(blockRow);
        }
        for (let offset = 0; offset < blockChangeRows.length; offset += WORLD_CHANGE_INSERT_BATCH_MAX_ROWS) {
            const chunk = blockChangeRows.slice(offset, offset + WORLD_CHANGE_INSERT_BATCH_MAX_ROWS);
            await client.query(this.buildWorldBlockChangeInsertStatement(chunk.length), chunk.flat());
        }
        for (let offset = 0; offset < objectChangeRows.length; offset += WORLD_CHANGE_INSERT_BATCH_MAX_ROWS) {
            const chunk = objectChangeRows.slice(offset, offset + WORLD_CHANGE_INSERT_BATCH_MAX_ROWS);
            await client.query(this.buildWorldObjectChangeInsertStatement(chunk.length), chunk.flat());
        }
        for (const change of pendingChanges) {
            await this.recordTrackedDropsForWorldChange(client, worldId, change);
        }
    }
    async loadWorldStateForUpdate(client, worldName) {
        const cleanWorldName = cleanName(worldName || "");
        if (cleanWorldName === "")
            return {};
        const result = await client.query(`
      SELECT world_state, world_revision
        FROM ${this.table("worlds")}
       WHERE world_name = $1
       FOR UPDATE
      `, [cleanWorldName]);
        const row = result.rows[0];
        const state = toObject(row?.world_state);
        if (row)
            state.world_revision = Math.max(normalizeWorldRevision(state.world_revision), normalizeWorldRevision(row.world_revision));
        return state;
    }
    async loadWorldState(worldName) {
        const cleanWorldName = cleanName(worldName || "");
        if (cleanWorldName === "")
            return { ok: false, found: false, reason: "invalid_world" };
        if (!this.isReady()) {
            this.logWorldPersistence("load", {
                world_id: cleanWorldName,
                loaded_revision: 0,
                persisted_revision: 0,
                affected_row_count: 0,
                save_result: "postgres_unavailable",
            });
            return { ok: false, found: false, reason: "postgres_unavailable" };
        }
        try {
            const result = await this.db.query(`
        SELECT world_name::text AS world_name,
               world_state,
               world_revision,
               world_owner_epoch,
               world_owner_token,
               world_owner_instance,
               updated_at,
               last_saved_at
          FROM ${this.table("worlds")}
         WHERE world_name = $1
           AND is_active = true
           AND world_state IS NOT NULL
           AND world_state <> '{}'::jsonb
         LIMIT 1
        `, [cleanWorldName]);
            const row = result.rows[0];
            if (!row) {
                this.logWorldPersistence("load", {
                    world_id: cleanWorldName,
                    loaded_revision: 0,
                    persisted_revision: 0,
                    affected_row_count: 0,
                    save_result: "world_not_found",
                });
                return { ok: true, found: false, world_name: cleanWorldName };
            }
            const rawWorldState = toObject(row.world_state);
            const state = {
                ...rawWorldState,
                world_name: cleanName(rawWorldState.world_name || row.world_name || cleanWorldName) || cleanWorldName,
                world_revision: Math.max(normalizeWorldRevision(rawWorldState.world_revision), normalizeWorldRevision(row.world_revision)),
            };
            // The world-lock row and the active-drops rows are independent reads on different
            // tables, both only keyed on world_name -- neither depends on the other's result, so
            // they run concurrently instead of back to back. This is the second of the two
            // always-sequential round trips flagged in the world-join latency investigation
            // (item #4): loadWorldState previously issued the main row, then the lock row, then
            // (inside loadActiveWorldDrops) the drops row, one after another. Combined with the
            // EXISTS-check removal above, a cold world load now costs 2 sequential round trips
            // (main row, then this parallel pair) instead of 4.
            const [worldLockResult, activeDrops] = await Promise.all([
                this.db.query(`
          SELECT w.world_name::text AS world_name,
                 wl.lock_type,
                 wl.is_locked,
                 wl.lock_x,
                 wl.lock_y,
                 wl.metadata,
                 p.player_id::text AS owner_player_id,
                 a.account_id::text AS owner_account_id,
                 a.username::text AS owner_username
            FROM ${this.table("world_locks")} wl
            JOIN ${this.table("worlds")} w ON w.world_id = wl.world_id
            LEFT JOIN ${this.table("players")} p ON p.player_id = wl.owner_player_id
            LEFT JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
           WHERE w.world_name = $1
             AND wl.is_locked = true
           ORDER BY wl.updated_at DESC NULLS LAST
           LIMIT 1
          `, [cleanWorldName]),
                this.loadActiveWorldDrops(cleanWorldName),
            ]);
            const normalizedWorldLock = worldLockResult.rows[0] ? worldLockRowToPayload(worldLockResult.rows[0]) : {};
            const savedWorldLock = toObject(state.world_lock);
            if (Object.keys(normalizedWorldLock).length > 0 && (!savedWorldLock.is_locked || cleanName(savedWorldLock.owner_name || "") === "")) {
                state.world_lock = normalizedWorldLock;
            }
            else if (Object.keys(normalizedWorldLock).length > 0 && savedWorldLock.is_locked) {
                state.world_lock = {
                    ...savedWorldLock,
                    owner_account_id: cleanName(savedWorldLock.owner_account_id || normalizedWorldLock.owner_account_id || ""),
                    owner_player_id: cleanName(savedWorldLock.owner_player_id || savedWorldLock.owner_profile_id || normalizedWorldLock.owner_player_id || ""),
                    owner_profile_id: cleanName(savedWorldLock.owner_profile_id || savedWorldLock.owner_player_id || normalizedWorldLock.owner_profile_id || normalizedWorldLock.owner_player_id || ""),
                    allowed_account_ids: Array.isArray(savedWorldLock.allowed_account_ids) && savedWorldLock.allowed_account_ids.length > 0 ? savedWorldLock.allowed_account_ids : (normalizedWorldLock.allowed_account_ids || []),
                    allowed_player_ids: Array.isArray(savedWorldLock.allowed_player_ids) && savedWorldLock.allowed_player_ids.length > 0 ? savedWorldLock.allowed_player_ids : (normalizedWorldLock.allowed_player_ids || []),
                    player_roles_by_account_id: Object.keys(toObject(savedWorldLock.player_roles_by_account_id)).length > 0 ? savedWorldLock.player_roles_by_account_id : (normalizedWorldLock.player_roles_by_account_id || {}),
                    player_roles_by_player_id: Object.keys(toObject(savedWorldLock.player_roles_by_player_id)).length > 0 ? savedWorldLock.player_roles_by_player_id : (normalizedWorldLock.player_roles_by_player_id || {}),
                    trade_key_holder_account_id: cleanName(savedWorldLock.trade_key_holder_account_id || normalizedWorldLock.trade_key_holder_account_id || ""),
                    trade_key_holder_player_id: cleanName(savedWorldLock.trade_key_holder_player_id || savedWorldLock.trade_key_holder_profile_id || normalizedWorldLock.trade_key_holder_player_id || ""),
                    trade_key_holder_profile_id: cleanName(savedWorldLock.trade_key_holder_profile_id || savedWorldLock.trade_key_holder_player_id || normalizedWorldLock.trade_key_holder_profile_id || normalizedWorldLock.trade_key_holder_player_id || ""),
                };
            }
            if (activeDrops?.ok) {
                state.drops = activeDrops.drops || [];
                state.item_drops = state.drops;
            }
            else {
                this.logger("[postgres] active world drops load failed during world state load:", activeDrops?.reason || "unknown");
            }
            const loadedRevision = normalizeWorldRevision(state.world_revision);
            this.logWorldPersistence("load", {
                world_id: cleanWorldName,
                server_instance: cleanName(row.world_owner_instance || ""),
                ownership_token: cleanName(row.world_owner_token || ""),
                ownership_epoch: normalizeWorldRevision(row.world_owner_epoch),
                loaded_revision: loadedRevision,
                persisted_revision: loadedRevision,
                affected_row_count: 1,
                save_result: "loaded",
            });
            return {
                ok: true,
                found: true,
                world_name: cleanWorldName,
                state,
                world_revision: loadedRevision,
                world_owner_epoch: normalizeWorldRevision(row.world_owner_epoch),
                world_owner_token: cleanName(row.world_owner_token || ""),
                world_owner_instance: cleanName(row.world_owner_instance || ""),
                updated_at: normalizeOptionalTimestamp(row.updated_at),
                last_saved_at: normalizeOptionalTimestamp(row.last_saved_at),
            };
        }
        catch (error) {
            this.logWorldPersistence("load", {
                world_id: cleanWorldName,
                loaded_revision: 0,
                persisted_revision: 0,
                affected_row_count: 0,
                save_result: "database_error",
            });
            this.logger("[postgres] single world state load failed:", getErrorMessage(error));
            return { ok: false, found: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    buildWorldObjectChangesFromStateDiff(beforeState = {}, afterState = {}, context = {}) {
        const e = toObject(context);
        const worldName = cleanName(e.world || afterState?.world_name || beforeState?.world_name || "");
        const beforeObjects = extractWorldObjectJournalMap(beforeState, worldName);
        const afterObjects = extractWorldObjectJournalMap(afterState, worldName);
        const keys = new Set([...beforeObjects.keys(), ...afterObjects.keys()]);
        const changes = [];
        for (const key of keys) {
            if (changes.length >= WORLD_OBJECT_CHANGE_DIFF_LIMIT)
                break;
            const beforeObject = beforeObjects.get(key) || null;
            const afterObject = afterObjects.get(key) || null;
            const beforeData = clonePlainJson(beforeObject?.data || {});
            const afterData = clonePlainJson(afterObject?.data || {});
            if (stableJsonString(beforeData) === stableJsonString(afterData))
                continue;
            const anchor = afterObject || beforeObject;
            if (!anchor)
                continue;
            const action = normalizeWorldObjectAction(e.action || "");
            changes.push({
                ...e,
                world: worldName,
                action: action || (beforeObject && afterObject ? "update" : afterObject ? "create" : "remove"),
                object_type: anchor.object_type,
                object_id: anchor.object_id,
                x: anchor.x,
                y: anchor.y,
                old_data: beforeData,
                new_data: afterData,
                details: {
                    ...safeJson(e.details),
                    diff_reason: beforeObject && afterObject ? "updated" : afterObject ? "created" : "removed",
                },
            });
        }
        return changes;
    }
    /**
     * @param {PixelMania.WorldName | string} worldName
     * @param {Record<string, unknown>} state
     * @param {PixelMania.WorldChangeEntry[]} changes
     * @returns {Promise<PixelMania.PostgresSaveWorldStateWithWorldChangesResult>}
     */
    async saveWorldStateWithWorldChanges(worldName, state, changes = [], ownership = {}) {
        const cleanWorldName = cleanName(worldName || state?.world_name || "START") || "START";
        const worldChanges = Array.isArray(changes) ? changes : [];
        const metadata = normalizeWorldPersistenceMetadata(ownership, state);
        const requestedRevision = normalizeWorldRevision(state?.world_revision);
        if (!this.isReady()) {
            this.logWorldPersistence("save_with_changes", {
                world_id: cleanWorldName,
                server_instance: metadata.server_instance,
                ownership_token: metadata.ownership_token,
                ownership_epoch: metadata.ownership_epoch,
                mutation_revision: requestedRevision,
                requested_save_revision: requestedRevision,
                persisted_revision: 0,
                affected_row_count: 0,
                save_result: "postgres_unavailable",
            });
            return { ok: false, reason: "postgres_unavailable" };
        }
        try {
            const result = await this.withTransaction(async (client) => {
                const previousWorldState = await this.loadWorldStateForUpdate(client, cleanWorldName);
                const persisted = await this.upsertWorldState(client, cleanWorldName, state, ownership);
                if (!persisted.ok || !persisted.world_id)
                    return persisted;
                const worldId = persisted.world_id;
                await this.mirrorWorldLockState(client, worldId, state);
                await this.mirrorWorldAreaLocksState(client, worldId, state);
                const hasExplicitObjectChanges = worldChanges.some((change) => this.isWorldObjectChangeEntry(change));
                const inferredObjectChanges = hasExplicitObjectChanges
                    ? []
                    : this.buildWorldObjectChangesFromStateDiff(previousWorldState, state, {
                        ...(toObject(worldChanges[0]) || {}),
                        world: cleanWorldName,
                        source_type: cleanName(worldChanges[0]?.source_type || "world_state_save"),
                        action: cleanName(worldChanges[0]?.action || "world_state_save"),
                    });
                await this.recordWorldChangesAndTrackedDrops(client, worldId, [...worldChanges, ...inferredObjectChanges]);
                return persisted;
            });
            if (!result?.ok) {
                return { ok: false, reason: result?.reason || "world_state_save_failed" };
            }
            return { ok: true, persisted_revision: result.persisted_revision };
        }
        catch (error) {
            this.logWorldPersistence("save_with_changes", {
                world_id: cleanWorldName,
                server_instance: metadata.server_instance,
                ownership_token: metadata.ownership_token,
                ownership_epoch: metadata.ownership_epoch,
                mutation_revision: requestedRevision,
                requested_save_revision: requestedRevision,
                persisted_revision: 0,
                affected_row_count: 0,
                save_result: "database_error",
            });
            this.logger("[postgres] world state/change transaction failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async loadWorldStates() {
        if (!this.isReady())
            return [];
        try {
            const result = await this.queryReadWithRetry("world states load", `
        SELECT world_name::text AS world_name,
               world_state,
               world_revision,
               world_owner_epoch,
               world_owner_token,
               world_owner_instance,
               updated_at,
               last_saved_at
          FROM ${this.table("worlds")}
         WHERE is_active = true
           AND world_state IS NOT NULL
           AND world_state <> '{}'::jsonb
         ORDER BY world_name ASC
      `);
            const worldNames = result.rows.map((row) => cleanName(row.world_name)).filter((worldName) => worldName !== "");
            const activeDropsByWorld = new Map();
            const worldsWithDropRows = new Set();
            const normalizedWorldLocksByWorld = new Map();
            if (worldNames.length > 0) {
                const dropHistoryRows = await this.queryReadWithRetry("world drop history load", `
          SELECT DISTINCT w.world_name::text AS world_name
            FROM ${this.table("world_drops")} wd
            JOIN ${this.table("worlds")} w ON w.world_id = wd.world_id
           WHERE w.world_name = ANY($1::text[])
        `, [worldNames]);
                for (const row of dropHistoryRows.rows) {
                    const worldName = cleanName(row.world_name || "START") || "START";
                    worldsWithDropRows.add(worldName);
                }
                const worldLockRows = await this.queryReadWithRetry("world locks load", `
          SELECT w.world_name::text AS world_name,
                 wl.lock_type,
                 wl.is_locked,
                 wl.lock_x,
                 wl.lock_y,
                 wl.metadata,
                 p.player_id::text AS owner_player_id,
                 a.account_id::text AS owner_account_id,
                 a.username::text AS owner_username
            FROM ${this.table("world_locks")} wl
            JOIN ${this.table("worlds")} w ON w.world_id = wl.world_id
            LEFT JOIN ${this.table("players")} p ON p.player_id = wl.owner_player_id
            LEFT JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
           WHERE w.world_name = ANY($1::text[])
             AND wl.is_locked = true
        `, [worldNames]);
                for (const row of worldLockRows.rows) {
                    const worldName = cleanName(row.world_name || "START") || "START";
                    const lockPayload = worldLockRowToPayload(row);
                    if (Object.keys(lockPayload).length > 0) {
                        normalizedWorldLocksByWorld.set(worldName, lockPayload);
                    }
                }
            }
            if (worldNames.length > 0) {
                const activeDropRows = await this.queryReadWithRetry("active world drops load", `
        SELECT w.world_name::text AS world_name,
               wd.drop_id,
               wd.item_type,
               wd.item_category,
               wd.amount,
               wd.x,
               wd.y,
               wd.stack_grid_x,
               wd.stack_grid_y,
               wd.pickup_delay
          FROM ${this.table("world_drops")} wd
          JOIN ${this.table("worlds")} w ON w.world_id = wd.world_id
         WHERE w.world_name = ANY($1::text[])
           AND wd.status = 'active'
           AND wd.amount > 0
         ORDER BY w.world_name ASC, wd.updated_at ASC, wd.created_at ASC
        `, [worldNames]);
                for (const row of activeDropRows.rows) {
                    const worldName = cleanName(row.world_name || "START") || "START";
                    if (!activeDropsByWorld.has(worldName))
                        activeDropsByWorld.set(worldName, []);
                    activeDropsByWorld.get(worldName).push(worldDropRowToPayload(row));
                }
            }
            return result.rows.map((row) => {
                const worldName = cleanName(row.world_name);
                const state = {
                    ...toObject(row.world_state),
                    world_name: cleanName(toObject(row.world_state).world_name || row.world_name),
                    world_revision: Math.max(normalizeWorldRevision(toObject(row.world_state).world_revision), normalizeWorldRevision(row.world_revision)),
                };
                const normalizedWorldLock = normalizedWorldLocksByWorld.get(worldName) || {};
                const savedWorldLock = toObject(state.world_lock);
                if (Object.keys(normalizedWorldLock).length > 0 && (!savedWorldLock.is_locked || cleanName(savedWorldLock.owner_name || "") === "")) {
                    state.world_lock = normalizedWorldLock;
                }
                else if (Object.keys(normalizedWorldLock).length > 0 && savedWorldLock.is_locked) {
                    state.world_lock = {
                        ...savedWorldLock,
                        owner_account_id: cleanName(savedWorldLock.owner_account_id || normalizedWorldLock.owner_account_id || ""),
                        owner_player_id: cleanName(savedWorldLock.owner_player_id || savedWorldLock.owner_profile_id || normalizedWorldLock.owner_player_id || ""),
                        owner_profile_id: cleanName(savedWorldLock.owner_profile_id || savedWorldLock.owner_player_id || normalizedWorldLock.owner_profile_id || normalizedWorldLock.owner_player_id || ""),
                        allowed_account_ids: Array.isArray(savedWorldLock.allowed_account_ids) && savedWorldLock.allowed_account_ids.length > 0 ? savedWorldLock.allowed_account_ids : (normalizedWorldLock.allowed_account_ids || []),
                        allowed_player_ids: Array.isArray(savedWorldLock.allowed_player_ids) && savedWorldLock.allowed_player_ids.length > 0 ? savedWorldLock.allowed_player_ids : (normalizedWorldLock.allowed_player_ids || []),
                        player_roles_by_account_id: Object.keys(toObject(savedWorldLock.player_roles_by_account_id)).length > 0 ? savedWorldLock.player_roles_by_account_id : (normalizedWorldLock.player_roles_by_account_id || {}),
                        player_roles_by_player_id: Object.keys(toObject(savedWorldLock.player_roles_by_player_id)).length > 0 ? savedWorldLock.player_roles_by_player_id : (normalizedWorldLock.player_roles_by_player_id || {}),
                        trade_key_holder_account_id: cleanName(savedWorldLock.trade_key_holder_account_id || normalizedWorldLock.trade_key_holder_account_id || ""),
                        trade_key_holder_player_id: cleanName(savedWorldLock.trade_key_holder_player_id || savedWorldLock.trade_key_holder_profile_id || normalizedWorldLock.trade_key_holder_player_id || ""),
                        trade_key_holder_profile_id: cleanName(savedWorldLock.trade_key_holder_profile_id || savedWorldLock.trade_key_holder_player_id || normalizedWorldLock.trade_key_holder_profile_id || normalizedWorldLock.trade_key_holder_player_id || ""),
                    };
                }
                if (worldsWithDropRows.has(worldName)) {
                    state.drops = activeDropsByWorld.get(worldName) || [];
                    state.item_drops = state.drops;
                }
                return {
                    world_name: worldName,
                    state,
                    world_revision: normalizeWorldRevision(state.world_revision),
                    world_owner_epoch: normalizeWorldRevision(row.world_owner_epoch),
                    world_owner_token: cleanName(row.world_owner_token || ""),
                    world_owner_instance: cleanName(row.world_owner_instance || ""),
                    updated_at: normalizeOptionalTimestamp(row.updated_at),
                    last_saved_at: normalizeOptionalTimestamp(row.last_saved_at),
                };
            });
        }
        catch (error) {
            this.logger("[postgres] world state load failed after retries:", getErrorMessage(error));
            throw postgresError(error);
        }
    }
    async listOwnedWorldLocks(username, limit = 100, identity = {}) {
        if (!this.isReady())
            return [];
        const ownerName = cleanName(username || "");
        const ownerAccountId = cleanName(identity?.account_id || "");
        const ownerPlayerId = cleanName(identity?.player_id || identity?.profile_id || "");
        if (ownerName === "" && ownerAccountId === "" && ownerPlayerId === "")
            return [];
        const rowLimit = Math.max(1, Math.min(250, toInt(limit, 100)));
        try {
            const result = await this.db.query(`
        SELECT w.world_name::text AS world_name,
               wl.lock_type,
               wl.is_locked,
               wl.lock_x,
               wl.lock_y,
               wl.metadata,
               wl.updated_at,
               p.player_id::text AS owner_player_id,
               a.account_id::text AS owner_account_id,
               a.username::text AS owner_username
          FROM ${this.table("world_locks")} wl
          JOIN ${this.table("worlds")} w ON w.world_id = wl.world_id
          LEFT JOIN ${this.table("players")} p ON p.player_id = wl.owner_player_id
          LEFT JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
         WHERE wl.is_locked = true
           AND (
             (NULLIF($1, '') IS NOT NULL AND lower(COALESCE(a.username::text, '')) = lower($1))
             OR (NULLIF($1, '') IS NOT NULL AND lower(COALESCE(wl.metadata->>'owner_name', '')) = lower($1))
             OR (NULLIF($1, '') IS NOT NULL AND lower(COALESCE(wl.metadata->>'owner_username', '')) = lower($1))
             OR (NULLIF($3, '') IS NOT NULL AND COALESCE(a.account_id::text, wl.metadata->>'owner_account_id', '') = $3)
             OR (NULLIF($4, '') IS NOT NULL AND COALESCE(p.player_id::text, wl.metadata->>'owner_player_id', wl.metadata->>'owner_profile_id', '') = $4)
           )
         ORDER BY wl.updated_at DESC NULLS LAST, w.world_name ASC
         LIMIT $2
        `, [ownerName, rowLimit, ownerAccountId, ownerPlayerId]);
            return result.rows
                .map((row) => {
                const payload = worldLockRowToPayload(row);
                if (Object.keys(payload).length === 0)
                    return null;
                const worldName = cleanName(row.world_name || "").toUpperCase();
                if (worldName === "")
                    return null;
                return {
                    ...payload,
                    world_name: worldName,
                    source_label: "SERVER",
                    updated_at: normalizeOptionalTimestamp(row.updated_at),
                };
            })
                .filter((entry) => entry !== null);
        }
        catch (error) {
            this.logger("[postgres] owned world locks lookup failed:", getErrorMessage(error));
            return [];
        }
    }
    /**
     * @param {PixelMania.WorldName | string} worldName
     * @returns {Promise<PixelMania.LoadActiveWorldDropsResult>}
     */
    async loadActiveWorldDrops(worldName) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable", drops: [] };
        const cleanWorldName = cleanName(worldName || "");
        if (cleanWorldName === "")
            return { ok: false, reason: "invalid_world", drops: [] };
        try {
            // Previously did a separate `SELECT EXISTS(...)` round trip before this query to
            // decide whether it was worth running at all -- but world_drops is indexed on
            // (world_id, status, updated_at DESC) (idx_world_drops_world_active), so the SELECT
            // below is already cheap on a world with zero drops, and paying a guaranteed extra
            // Postgres round trip on every single world load (the vast majority of which do have
            // to run this query anyway) cost more than the rare all-empty case ever saved. See
            // world-join latency investigation, item #4/#7: this was one of two always-sequential
            // round trips inside loadWorldState.
            const result = await this.db.query(`
        SELECT wd.drop_id,
               wd.item_type,
               wd.item_category,
               wd.amount,
               wd.x,
               wd.y,
               wd.stack_grid_x,
               wd.stack_grid_y,
               wd.pickup_delay
          FROM ${this.table("world_drops")} wd
          JOIN ${this.table("worlds")} w ON w.world_id = wd.world_id
         WHERE w.world_name = $1
           AND wd.status = 'active'
           AND wd.amount > 0
         ORDER BY wd.updated_at ASC, wd.created_at ASC
        `, [cleanWorldName]);
            return { ok: true, world_name: cleanWorldName, drops: result.rows.map((row) => worldDropRowToPayload(row)) };
        }
        catch (error) {
            this.logger("[postgres] active world drops load failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error), drops: [] };
        }
    }
    async saveWorldSnapshot(worldName, snapshot, options = {}) {
        if (!this.isReady())
            return false;
        const cleanWorldName = cleanName(worldName || snapshot?.world_name || "START") || "START";
        const storeSnapshotData = options.storeSnapshotData !== false;
        const ownership = normalizeWorldPersistenceMetadata(options.ownership || options, snapshot);
        try {
            const result = await this.withTransaction(async (client) => {
                const canonical = await client.query(`
          SELECT world_id::text AS world_id,
                 world_state,
                 world_revision,
                 world_owner_epoch,
                 world_owner_token,
                 world_owner_instance
            FROM ${this.table("worlds")}
           WHERE world_name = $1
             AND is_active = true
           FOR SHARE
          `, [cleanWorldName]);
                const row = canonical.rows[0];
                if (!row)
                    return { ok: false, reason: "world_not_found", affected_rows: 0, persisted_revision: 0 };
                if (ownership.require_owner &&
                    (ownership.server_instance === "" ||
                        ownership.ownership_token === "" ||
                        ownership.ownership_epoch <= 0 ||
                        cleanName(row.world_owner_instance || "") !== ownership.server_instance ||
                        cleanName(row.world_owner_token || "") !== ownership.ownership_token ||
                        normalizeWorldRevision(row.world_owner_epoch) !== ownership.ownership_epoch)) {
                    return {
                        ok: false,
                        reason: "world_ownership_fence_rejected",
                        affected_rows: 0,
                        persisted_revision: normalizeWorldRevision(row.world_revision),
                    };
                }
                const snapshotData = safeJson(row.world_state);
                snapshotData.world_revision = Math.max(normalizeWorldRevision(snapshotData.world_revision), normalizeWorldRevision(row.world_revision));
                const checksum = worldPersistenceChecksum(snapshotData);
                const snapshotHash = integrityHash(snapshotData);
                const snapshotJson = storeSnapshotData ? JSON.stringify(snapshotData) : null;
                const inserted = await client.query(`
          INSERT INTO ${this.table("world_snapshots")} (
            world_id,
            snapshot_version,
            checksum,
            snapshot_hash,
            snapshot_hash_algorithm,
            storage_uri,
            snapshot_data,
            reason,
            created_by,
            created_at
          )
          SELECT
            $1,
            COALESCE(MAX(snapshot_version), 0) + 1,
            $2,
            $3,
            $4,
            NULLIF($5, ''),
            $6::jsonb,
            COALESCE(NULLIF($7, ''), 'snapshot'),
            COALESCE(NULLIF($8, ''), 'system'),
            now()
          FROM ${this.table("world_snapshots")}
          WHERE world_id = $1
          `, [
                    cleanName(row.world_id),
                    checksum,
                    snapshotHash,
                    INTEGRITY_HASH_ALGORITHM,
                    cleanName(options.storageUri || ""),
                    snapshotJson,
                    cleanName(options.reason || "snapshot"),
                    cleanName(options.createdBy || "system"),
                ]);
                return {
                    ok: Math.max(0, toInt(inserted.rowCount, 0)) === 1,
                    reason: Math.max(0, toInt(inserted.rowCount, 0)) === 1 ? "" : "snapshot_insert_failed",
                    affected_rows: Math.max(0, toInt(inserted.rowCount, 0)),
                    persisted_revision: normalizeWorldRevision(snapshotData.world_revision),
                };
            });
            this.logWorldPersistence("snapshot", {
                world_id: cleanWorldName,
                server_instance: ownership.server_instance,
                ownership_token: ownership.ownership_token,
                ownership_epoch: ownership.ownership_epoch,
                requested_save_revision: normalizeWorldRevision(snapshot?.world_revision),
                persisted_revision: normalizeWorldRevision(result?.persisted_revision),
                affected_row_count: Math.max(0, toInt(result?.affected_rows, 0)),
                save_result: result?.ok ? "snapshot_persisted" : cleanName(result?.reason || "snapshot_failed"),
            });
            return Boolean(result?.ok);
        }
        catch (error) {
            this.logWorldPersistence("snapshot", {
                world_id: cleanWorldName,
                server_instance: ownership.server_instance,
                ownership_token: ownership.ownership_token,
                ownership_epoch: ownership.ownership_epoch,
                requested_save_revision: normalizeWorldRevision(snapshot?.world_revision),
                persisted_revision: 0,
                affected_row_count: 0,
                save_result: "database_error",
            });
            this.logger("[postgres] world snapshot save failed:", getErrorMessage(error));
            return false;
        }
    }
    mirrorAdminAction(entry) {
        if (!this.isReady())
            return;
        const e = toObject(entry);
        this.runDetached("mirror admin action", async () => {
            await this.withTransaction(async (client) => {
                let adminPlayerId = null;
                const adminUsername = cleanName(e.admin_username || e.actor_username || "");
                if (adminUsername !== "") {
                    adminPlayerId = await this.ensurePlayerIdentity(client, adminUsername, "", normalizeDbRole(e.admin_role || "admin"));
                }
                let worldId = null;
                const worldName = cleanName(e.world || e.target_world || e.details?.world || "");
                if (worldName !== "") {
                    const worldResult = await client.query(`
            INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
            VALUES ($1, 100, 70, 1, true, now(), now())
            ON CONFLICT (world_name) DO UPDATE
              SET updated_at = now()
            RETURNING world_id
            `, [worldName]);
                    worldId = worldResult.rows[0]?.world_id || null;
                }
                const targetType = cleanName(e.target_type || (e.target_username ? "player" : (worldName ? "world" : "server"))) || "server";
                const targetId = cleanName(e.target_id || e.target_username || worldName || "");
                await client.query(`
          INSERT INTO ${this.table("admin_actions")} (
            admin_player_id,
            action_type,
            target_type,
            target_id,
            world_id,
            request_id,
            metadata,
            created_at
          )
          VALUES (
            $1,
            COALESCE(NULLIF($2, ''), 'admin_action'),
            $3,
            NULLIF($4, ''),
            $5,
            NULLIF($6, ''),
            $7::jsonb,
            COALESCE($8::timestamptz, now())
          )
          `, [
                    adminPlayerId,
                    cleanName(e.action || "admin_action"),
                    targetType,
                    targetId,
                    worldId,
                    cleanName(e.request_id || ""),
                    JSON.stringify(safeJson(e)),
                    normalizeOptionalTimestamp(e.at || ""),
                ]);
            });
        });
    }
    mirrorAccount(account, options = {}) {
        if (!this.isReady())
            return;
        const accountData = toObject(account);
        const username = cleanName(accountData.username);
        if (username === "")
            return;
        const email = cleanName(accountData.email || "");
        const fallbackEmail = defaultEmailForUsername(username);
        const role = normalizeDbRole(accountData.role || "player");
        const passwordSalt = cleanName(accountData.password_salt || "");
        const passwordHash = String(accountData.password_hash || "");
        const passwordAlgorithm = cleanName(accountData.password_algorithm || (passwordHash ? "legacy_scrypt" : ""));
        const emailVerified = Boolean(accountData.email_verified);
        const createdAt = cleanName(accountData.created_at || "");
        const lastSeenAt = cleanName(accountData.last_seen_at || "");
        const emailVerifiedAt = cleanName(accountData.email_verified_at || "");
        const touchLogin = Boolean(options.touchLogin);
        this.runDetached("mirror account", async () => {
            await this.withTransaction(async (client) => {
                const accountResult = await client.query(`
          INSERT INTO ${this.table("accounts")} (
            username,
            email,
            password_salt,
            password_hash,
            password_algorithm,
            role,
            is_active,
            last_login_at,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            COALESCE(NULLIF($2, ''), $8),
            $3,
            $4,
            $5,
            $6,
            true,
            ${touchLogin ? "now()" : "NULL"},
            COALESCE(NULLIF($7, '')::timestamptz, now()),
            now()
          )
          ON CONFLICT (username) DO UPDATE
            SET email = COALESCE(NULLIF($2, ''), ${this.table("accounts")}.email),
                password_salt = CASE
                  WHEN EXCLUDED.password_salt <> '' THEN EXCLUDED.password_salt
                  ELSE ${this.table("accounts")}.password_salt
                END,
                password_hash = CASE
                  WHEN EXCLUDED.password_hash <> '' THEN EXCLUDED.password_hash
                  ELSE ${this.table("accounts")}.password_hash
                END,
                password_algorithm = CASE
                  WHEN EXCLUDED.password_algorithm <> '' THEN EXCLUDED.password_algorithm
                  ELSE ${this.table("accounts")}.password_algorithm
                END,
                role = EXCLUDED.role,
                is_active = true,
                last_login_at = CASE
                  WHEN ${touchLogin ? "true" : "false"} THEN now()
                  ELSE ${this.table("accounts")}.last_login_at
                END
          RETURNING account_id
          `, [username, email, passwordSalt, passwordHash, passwordAlgorithm, role, createdAt, fallbackEmail]);
                const accountId = accountResult.rows[0]?.account_id;
                if (!accountId)
                    return;
                await client.query(`
          INSERT INTO ${this.table("players")} (account_id, display_name, current_world_name, created_at, updated_at)
          VALUES ($1, $2, NULL, now(), now())
          ON CONFLICT (account_id) DO UPDATE
            SET display_name = EXCLUDED.display_name
          `, [accountId, username]);
                await client.query(`
          UPDATE ${this.table("accounts")}
             SET updated_at = now()
           WHERE account_id = $1
          `, [accountId]);
                await client.query(`
          INSERT INTO ${this.table("security_events")} (
            account_id,
            event_type,
            severity,
            request_id,
            details
          )
          VALUES (
            $1,
            'account_mirror',
            'low',
            '',
            $2::jsonb
          )
          `, [accountId, JSON.stringify({
                        email_verified: emailVerified,
                        email_verified_at: emailVerifiedAt,
                        last_seen_at: lastSeenAt,
                    })]);
            });
        });
    }
    async saveSession(account, details = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const accountData = toObject(account);
        const username = cleanName(accountData.username);
        if (username === "")
            return { ok: false, reason: "invalid_username" };
        const email = cleanName(accountData.email || "") || defaultEmailForUsername(username);
        const role = normalizeDbRole(accountData.role || "player");
        const sessionHash = cleanName(accountData.session_token_hash || "");
        const expiresAt = cleanName(accountData.session_token_expires_at || "");
        const refreshHash = cleanName(accountData.refresh_token_hash || "");
        const refreshExpiresAt = cleanName(accountData.refresh_token_expires_at || "");
        const ipAddress = normalizeIp(details.ip || "");
        const userAgent = cleanName(details.userAgent || "");
        const deviceInfo = safeJson(details.deviceInfo || details.device_info || {});
        const sessionMode = cleanName(details.sessionMode || details.session_mode || "one_active") || "one_active";
        const rotatedFromTokenHash = cleanName(details.rotatedFromTokenHash || details.rotated_from_token_hash || "");
        const concurrent = details.concurrent === true;
        const revokeRotatedToken = details.revokeRotatedToken === true || details.revoke_rotated_token === true;
        const revokeOtherSessions = details.revokeOtherSessions === true || details.revoke_other_sessions === true;
        if (sessionHash === "")
            return { ok: false, reason: "missing_session_hash" };
        try {
            assertPostgresOperationCanContinue(details);
            const runTransaction = (work) => (concurrent ? this.withTransactionNow(work) : this.withTransaction(work));
            await runTransaction(async (client) => {
                assertPostgresOperationCanContinue(details);
                const playerId = await this.ensurePlayerIdentity(client, username, email, role);
                if (!playerId)
                    return;
                assertPostgresOperationCanContinue(details);
                const accountResult = await client.query(`SELECT account_id FROM ${this.table("accounts")} WHERE lower(username::text) = lower($1) LIMIT 1`, [username]);
                const accountId = accountResult.rows[0]?.account_id;
                if (!accountId)
                    return;
                assertPostgresOperationCanContinue(details);
                let rotatedFromSessionId = null;
                let tokenFamily = null;
                if (rotatedFromTokenHash !== "") {
                    const rotatedResult = await client.query(`
            SELECT session_id, token_family
              FROM ${this.table("sessions")}
             WHERE session_token_hash = $1
                OR refresh_token_hash = $1
             LIMIT 1
            `, [rotatedFromTokenHash]);
                    rotatedFromSessionId = rotatedResult.rows[0]?.session_id || null;
                    tokenFamily = rotatedResult.rows[0]?.token_family || null;
                }
                assertPostgresOperationCanContinue(details);
                await client.query(`
          INSERT INTO ${this.table("sessions")} (
            account_id,
            session_token_hash,
            refresh_token_hash,
            ip_address,
            user_agent,
            device_info,
            session_mode,
            token_family,
            rotated_from_session_id,
            issued_at,
            expires_at,
            refresh_expires_at,
            last_seen_at
          )
          VALUES (
            $1,
            $2,
            NULLIF($3, ''),
            NULLIF($4, '')::inet,
            NULLIF($5, ''),
            $6::jsonb,
            NULLIF($7, ''),
            COALESCE($8::uuid, gen_random_uuid()),
            $9::uuid,
            now(),
            COALESCE(NULLIF($10, '')::timestamptz, now() + interval '1 day'),
            COALESCE(NULLIF($11, '')::timestamptz, COALESCE(NULLIF($10, '')::timestamptz, now() + interval '1 day')),
            now()
          )
          ON CONFLICT (session_token_hash) DO UPDATE
            SET expires_at = EXCLUDED.expires_at,
                refresh_token_hash = COALESCE(EXCLUDED.refresh_token_hash, ${this.table("sessions")}.refresh_token_hash),
                refresh_expires_at = COALESCE(EXCLUDED.refresh_expires_at, ${this.table("sessions")}.refresh_expires_at),
                last_seen_at = now(),
                revoked_at = NULL,
                revoked_reason = NULL,
                ip_address = COALESCE(EXCLUDED.ip_address, ${this.table("sessions")}.ip_address),
                user_agent = COALESCE(EXCLUDED.user_agent, ${this.table("sessions")}.user_agent),
                device_info = EXCLUDED.device_info,
                session_mode = COALESCE(EXCLUDED.session_mode, ${this.table("sessions")}.session_mode),
                token_family = COALESCE(EXCLUDED.token_family, ${this.table("sessions")}.token_family),
                rotated_from_session_id = COALESCE(EXCLUDED.rotated_from_session_id, ${this.table("sessions")}.rotated_from_session_id)
          `, [
                    accountId,
                    sessionHash,
                    refreshHash,
                    ipAddress,
                    userAgent,
                    JSON.stringify(deviceInfo),
                    sessionMode,
                    tokenFamily,
                    rotatedFromSessionId,
                    expiresAt,
                    refreshExpiresAt,
                ]);
                assertPostgresOperationCanContinue(details);
                if (revokeRotatedToken
                    && rotatedFromTokenHash !== ""
                    && rotatedFromTokenHash !== sessionHash
                    && rotatedFromTokenHash !== refreshHash) {
                    await client.query(`
            UPDATE ${this.table("sessions")}
               SET revoked_at = now(),
                   revoked_reason = 'rotated'
             WHERE account_id = $1
               AND (
                 session_token_hash = $2
                 OR refresh_token_hash = $2
               )
               AND session_token_hash <> $3
               AND revoked_at IS NULL
            `, [accountId, rotatedFromTokenHash, sessionHash]);
                    assertPostgresOperationCanContinue(details);
                }
                if (revokeOtherSessions) {
                    await client.query(`
            UPDATE ${this.table("sessions")}
               SET revoked_at = now(),
                   revoked_reason = 'one_active_session'
             WHERE account_id = $1
               AND session_token_hash <> $2
               AND revoked_at IS NULL
            `, [accountId, sessionHash]);
                    assertPostgresOperationCanContinue(details);
                }
            });
            return {
                ok: true,
                username,
                session_token_hash: sessionHash,
                refresh_token_hash: refreshHash,
                expires_at: normalizeOptionalTimestamp(expiresAt),
                refresh_expires_at: normalizeOptionalTimestamp(refreshExpiresAt),
            };
        }
        catch (error) {
            if (isPostgresOperationAborted(error)) {
                return { ok: false, reason: "aborted" };
            }
            this.logger("[postgres] session save failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    mirrorSession(account, details = {}) {
        return this.saveSession(account, details);
    }
    async validateSessionToken(username, sessionTokenHash, details = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanUsername = cleanName(username);
        const cleanSessionHash = cleanName(sessionTokenHash);
        if (cleanUsername === "" || cleanSessionHash === "") {
            return { ok: false, reason: "invalid_session" };
        }
        const ipAddress = normalizeIp(details.ip || "");
        const userAgent = cleanName(details.userAgent || "");
        const deviceInfo = safeJson(details.deviceInfo || details.device_info || {});
        const requestedTokenKind = cleanName(details.tokenKind || details.token_kind || "session_or_refresh");
        const concurrent = details.concurrent === true;
        try {
            assertPostgresOperationCanContinue(details);
            const runTransaction = (work) => (concurrent ? this.withTransactionNow(work) : this.withTransaction(work));
            return await runTransaction(async (client) => {
                assertPostgresOperationCanContinue(details);
                const result = await client.query(`
          SELECT
            a.username::text AS username,
            a.email::text AS email,
            a.password_salt,
            a.password_hash,
            a.password_algorithm,
            a.role,
            a.email_verified,
            a.email_verified_at,
            a.email_verification_token_hash,
            a.email_verification_expires_at,
            a.account_state,
            a.created_at,
            a.last_login_at,
            s.session_id,
            s.session_token_hash,
            s.expires_at AS session_token_expires_at,
            s.refresh_token_hash,
            s.refresh_expires_at,
            s.token_family,
            CASE
              WHEN s.session_token_hash = $2 THEN 'session'
              WHEN s.refresh_token_hash = $2 THEN 'refresh'
              ELSE 'unknown'
            END AS matched_token_kind
          FROM ${this.table("sessions")} s
          JOIN ${this.table("accounts")} a ON a.account_id = s.account_id
          WHERE lower(a.username::text) = lower($1)
            AND (
              s.session_token_hash = $2
              OR s.refresh_token_hash = $2
            )
            AND s.revoked_at IS NULL
            AND (
              (s.session_token_hash = $2 AND s.expires_at > now())
              OR (s.refresh_token_hash = $2 AND s.refresh_expires_at > now())
            )
            AND a.is_active = true
          LIMIT 1
          `, [cleanUsername, cleanSessionHash]);
                const row = result.rows[0];
                if (!row)
                    return { ok: false, reason: "invalid_or_expired" };
                if (requestedTokenKind === "refresh" && cleanName(row.matched_token_kind || "") !== "refresh") {
                    return { ok: false, reason: "invalid_refresh_token" };
                }
                assertPostgresOperationCanContinue(details);
                await client.query(`
          UPDATE ${this.table("sessions")}
             SET last_seen_at = now(),
                 ip_address = COALESCE(NULLIF($2, '')::inet, ip_address),
                 user_agent = COALESCE(NULLIF($3, ''), user_agent),
                 device_info = $4::jsonb
           WHERE session_token_hash = $1
              OR refresh_token_hash = $1
          `, [cleanSessionHash, ipAddress, userAgent, JSON.stringify(deviceInfo)]);
                assertPostgresOperationCanContinue(details);
                const accountState = toObject(row.account_state);
                const expiresAt = normalizeOptionalTimestamp(row.session_token_expires_at) || "";
                const refreshExpiresAt = normalizeOptionalTimestamp(row.refresh_expires_at) || "";
                const account = {
                    ...accountState,
                    username: cleanName(accountState.username || row.username),
                    email: cleanName(accountState.email || row.email),
                    password_salt: cleanName(accountState.password_salt || row.password_salt || ""),
                    password_hash: String(accountState.password_hash || row.password_hash || ""),
                    password_algorithm: cleanName(accountState.password_algorithm || row.password_algorithm || (accountState.password_hash || row.password_hash ? "legacy_scrypt" : "")),
                    session_token_hash: cleanName(row.session_token_hash || accountState.session_token_hash || ""),
                    session_token_expires_at: expiresAt,
                    refresh_token_hash: cleanName(row.refresh_token_hash || accountState.refresh_token_hash || ""),
                    refresh_token_expires_at: refreshExpiresAt,
                    email_verified: Boolean(row.email_verified),
                    email_verified_at: cleanName(normalizeOptionalTimestamp(row.email_verified_at) || accountState.email_verified_at || ""),
                    email_verification_token_hash: cleanName(row.email_verification_token_hash || accountState.email_verification_token_hash || ""),
                    email_verification_expires_at: cleanName(normalizeOptionalTimestamp(row.email_verification_expires_at) || accountState.email_verification_expires_at || ""),
                    role: cleanName(accountState.role || row.role || "player") || "player",
                    created_at: cleanName(accountState.created_at || normalizeOptionalTimestamp(row.created_at) || ""),
                    last_seen_at: cleanName(accountState.last_seen_at || normalizeOptionalTimestamp(row.last_login_at) || ""),
                };
                return {
                    ok: true,
                    username: account.username,
                    session_id: cleanName(row.session_id || ""),
                    session_token_hash: cleanName(row.session_token_hash || ""),
                    refresh_token_hash: cleanName(row.refresh_token_hash || ""),
                    matched_token_kind: cleanName(row.matched_token_kind || requestedTokenKind || ""),
                    token_family: cleanName(row.token_family || ""),
                    expires_at: expiresAt,
                    refresh_expires_at: refreshExpiresAt,
                    account,
                };
            });
        }
        catch (error) {
            if (isPostgresOperationAborted(error)) {
                return { ok: false, reason: "aborted" };
            }
            this.logger("[postgres] session validation failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async revokeSessionsForUsername(username, reason = "revoked") {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return { ok: false, reason: "invalid_username" };
        try {
            await this.withTransaction(async (client) => {
                const accountResult = await client.query(`SELECT account_id FROM ${this.table("accounts")} WHERE lower(username::text) = lower($1) LIMIT 1`, [cleanUsername]);
                const accountId = accountResult.rows[0]?.account_id;
                if (!accountId)
                    return;
                await client.query(`
          UPDATE ${this.table("sessions")}
             SET revoked_at = now(),
                 revoked_reason = COALESCE(NULLIF($2, ''), 'revoked')
           WHERE account_id = $1
             AND revoked_at IS NULL
          `, [accountId, cleanName(reason || "revoked")]);
            });
            return { ok: true };
        }
        catch (error) {
            this.logger("[postgres] session revoke failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    revokeSessionsByUsername(username) {
        if (!this.isReady())
            return Promise.resolve({ ok: false, reason: "postgres_unavailable" });
        return this.revokeSessionsForUsername(username);
    }
    async revokeOtherSessionsForUsername(username, keepSessionTokenHash, reason = "one_active_session") {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanUsername = cleanName(username);
        const keepHash = cleanName(keepSessionTokenHash);
        if (cleanUsername === "" || keepHash === "")
            return { ok: false, reason: "invalid_session" };
        try {
            await this.withTransaction(async (client) => {
                const accountResult = await client.query(`SELECT account_id FROM ${this.table("accounts")} WHERE lower(username::text) = lower($1) LIMIT 1`, [cleanUsername]);
                const accountId = accountResult.rows[0]?.account_id;
                if (!accountId)
                    return;
                await client.query(`
          UPDATE ${this.table("sessions")}
             SET revoked_at = now(),
                 revoked_reason = COALESCE(NULLIF($3, ''), 'one_active_session')
           WHERE account_id = $1
             AND session_token_hash <> $2
             AND revoked_at IS NULL
          `, [accountId, keepHash, cleanName(reason || "one_active_session")]);
            });
            return { ok: true };
        }
        catch (error) {
            this.logger("[postgres] other session revoke failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async revokeSessionByTokenHash(sessionTokenHash, reason = "revoked") {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanSessionHash = cleanName(sessionTokenHash);
        if (cleanSessionHash === "")
            return { ok: false, reason: "invalid_session" };
        try {
            await this.db.query(`
        UPDATE ${this.table("sessions")}
           SET revoked_at = now(),
               revoked_reason = COALESCE(NULLIF($2, ''), 'revoked')
         WHERE (
             session_token_hash = $1
             OR refresh_token_hash = $1
           )
           AND revoked_at IS NULL
        `, [cleanSessionHash, cleanName(reason || "revoked")]);
            return { ok: true };
        }
        catch (error) {
            this.logger("[postgres] session token revoke failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async createAccountPasswordResetRequest(entry = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const e = toObject(entry);
        const username = cleanName(e.username || "");
        const email = cleanName(e.email || "");
        const tokenHash = cleanName(e.token_hash || e.tokenHash || "");
        const expiresAt = normalizeOptionalTimestamp(e.expires_at || e.expiresAt || "");
        if (username === "" || email === "" || tokenHash === "" || !expiresAt) {
            return { ok: false, reason: "invalid_request" };
        }
        try {
            return await this.withTransaction(async (client) => {
                const accountResult = await client.query(`SELECT account_id FROM ${this.table("accounts")} WHERE lower(username::text) = lower($1) LIMIT 1`, [username]);
                const accountId = accountResult.rows[0]?.account_id;
                if (!accountId)
                    return { ok: false, reason: "account_not_found" };
                await client.query(`
          UPDATE ${this.table("account_password_reset_requests")}
             SET used_at = now()
           WHERE account_id = $1
             AND used_at IS NULL
          `, [accountId]);
                await client.query(`
          INSERT INTO ${this.table("account_password_reset_requests")} (
            account_id,
            username,
            email,
            token_hash,
            expires_at,
            ip_address,
            user_agent,
            device_info,
            request_id
          )
          VALUES ($1, $2, $3, $4, $5::timestamptz, NULLIF($6, '')::inet, $7, $8::jsonb, NULLIF($9, ''))
          `, [
                    accountId,
                    username,
                    email,
                    tokenHash,
                    expiresAt,
                    normalizeIp(e.ip_address || e.ip || ""),
                    cleanName(e.user_agent || e.userAgent || ""),
                    JSON.stringify(safeJson(e.device_info || e.deviceInfo || {})),
                    cleanName(e.request_id || e.requestId || ""),
                ]);
                return { ok: true };
            });
        }
        catch (error) {
            this.logger("[postgres] password reset request write failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async consumeAccountPasswordResetRequest(tokenHash) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanTokenHash = cleanName(tokenHash);
        if (cleanTokenHash === "")
            return { ok: false, reason: "missing_token" };
        try {
            return await this.withTransaction(async (client) => {
                const result = await client.query(`
          SELECT
            r.reset_request_id,
            r.account_id,
            r.username,
            r.email,
            r.expires_at,
            a.username::text AS account_username,
            a.email::text AS account_email
          FROM ${this.table("account_password_reset_requests")} r
          JOIN ${this.table("accounts")} a ON a.account_id = r.account_id
          WHERE r.token_hash = $1
            AND r.used_at IS NULL
            AND r.expires_at > now()
            AND a.is_active = true
          FOR UPDATE OF r
          LIMIT 1
          `, [cleanTokenHash]);
                const row = result.rows[0];
                if (!row)
                    return { ok: false, reason: "invalid_or_expired" };
                await client.query(`UPDATE ${this.table("account_password_reset_requests")} SET used_at = now() WHERE reset_request_id = $1`, [row.reset_request_id]);
                return {
                    ok: true,
                    username: cleanName(row.account_username || row.username || ""),
                    email: cleanName(row.account_email || row.email || ""),
                    account_id: cleanName(row.account_id || ""),
                };
            });
        }
        catch (error) {
            this.logger("[postgres] password reset request consume failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async consumeAccountEmailVerificationToken(tokenHash) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanTokenHash = cleanName(tokenHash);
        if (cleanTokenHash === "")
            return { ok: false, reason: "missing_token" };
        try {
            return await this.withTransaction(async (client) => {
                const result = await client.query(`
          SELECT
            account_id,
            username::text AS username,
            email::text AS email,
            email_verification_expires_at
          FROM ${this.table("accounts")}
          WHERE email_verification_token_hash = $1
            AND is_active = true
          FOR UPDATE
          LIMIT 1
          `, [cleanTokenHash]);
                const row = result.rows[0];
                if (!row)
                    return { ok: false, reason: "invalid_or_used" };
                const expiresAt = Date.parse(String(row.email_verification_expires_at || ""));
                if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
                    await client.query(`
            UPDATE ${this.table("accounts")}
               SET email_verification_token_hash = '',
                   email_verification_expires_at = NULL,
                   account_state = account_state || $2::jsonb,
                   updated_at = now()
             WHERE account_id = $1
            `, [
                        row.account_id,
                        JSON.stringify({
                            email_verification_token_hash: "",
                            email_verification_expires_at: "",
                        }),
                    ]);
                    return { ok: false, reason: "expired" };
                }
                const verifiedAt = new Date().toISOString();
                await client.query(`
          UPDATE ${this.table("accounts")}
             SET email_verified = true,
                 email_verified_at = $2::timestamptz,
                 email_verification_token_hash = '',
                 email_verification_expires_at = NULL,
                 account_state = account_state || $3::jsonb,
                 updated_at = now()
           WHERE account_id = $1
          `, [
                    row.account_id,
                    verifiedAt,
                    JSON.stringify({
                        email_verified: true,
                        email_verified_at: verifiedAt,
                        email_verification_token_hash: "",
                        email_verification_expires_at: "",
                    }),
                ]);
                await client.query(`
          UPDATE ${this.table("sessions")}
             SET revoked_at = now(),
                 revoked_reason = 'email_verified'
           WHERE account_id = $1
             AND revoked_at IS NULL
          `, [row.account_id]);
                return {
                    ok: true,
                    username: cleanName(row.username || ""),
                    email: cleanName(row.email || ""),
                    account_id: cleanName(row.account_id || ""),
                    email_verified_at: verifiedAt,
                };
            });
        }
        catch (error) {
            this.logger("[postgres] email verification token consume failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async resetAccountPasswordWithToken(tokenHash, passwordData = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanTokenHash = cleanName(tokenHash);
        const salt = cleanName(passwordData.salt || "");
        const hash = String(passwordData.hash || "");
        const algorithm = cleanName(passwordData.algorithm || "");
        if (cleanTokenHash === "")
            return { ok: false, reason: "missing_token" };
        if (salt === "" || hash === "" || algorithm === "") {
            return { ok: false, reason: "invalid_password_hash" };
        }
        try {
            return await this.withTransaction(async (client) => {
                const result = await client.query(`
          SELECT
            r.reset_request_id,
            r.account_id,
            r.username,
            r.email,
            a.username::text AS account_username,
            a.email::text AS account_email
          FROM ${this.table("account_password_reset_requests")} r
          JOIN ${this.table("accounts")} a ON a.account_id = r.account_id
          WHERE r.token_hash = $1
            AND r.used_at IS NULL
            AND r.expires_at > now()
            AND a.is_active = true
          FOR UPDATE OF r, a
          LIMIT 1
          `, [cleanTokenHash]);
                const row = result.rows[0];
                if (!row)
                    return { ok: false, reason: "invalid_or_expired" };
                await client.query(`
          UPDATE ${this.table("accounts")}
             SET password_salt = $2,
                 password_hash = $3,
                 password_algorithm = $4,
                 account_state = account_state || $5::jsonb,
                 updated_at = now()
           WHERE account_id = $1
          `, [
                    row.account_id,
                    salt,
                    hash,
                    algorithm,
                    JSON.stringify({ password_salt: salt, password_hash: hash, password_algorithm: algorithm }),
                ]);
                await client.query(`
          UPDATE ${this.table("sessions")}
             SET revoked_at = now(),
                 revoked_reason = 'password_reset'
           WHERE account_id = $1
             AND revoked_at IS NULL
          `, [row.account_id]);
                await client.query(`UPDATE ${this.table("account_password_reset_requests")} SET used_at = now() WHERE reset_request_id = $1`, [row.reset_request_id]);
                return {
                    ok: true,
                    username: cleanName(row.account_username || row.username || ""),
                    email: cleanName(row.account_email || row.email || ""),
                    account_id: cleanName(row.account_id || ""),
                };
            });
        }
        catch (error) {
            this.logger("[postgres] password reset transaction failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async createAccountEmailChangeRequest(entry = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const e = toObject(entry);
        const username = cleanName(e.username || "");
        const oldEmail = cleanName(e.old_email || e.oldEmail || "");
        const newEmail = cleanName(e.new_email || e.newEmail || "");
        const tokenHash = cleanName(e.token_hash || e.tokenHash || "");
        const expiresAt = normalizeOptionalTimestamp(e.expires_at || e.expiresAt || "");
        if (username === "" || oldEmail === "" || newEmail === "" || tokenHash === "" || !expiresAt) {
            return { ok: false, reason: "invalid_request" };
        }
        try {
            return await this.withTransaction(async (client) => {
                const accountResult = await client.query(`SELECT account_id FROM ${this.table("accounts")} WHERE lower(username::text) = lower($1) LIMIT 1`, [username]);
                const accountId = accountResult.rows[0]?.account_id;
                if (!accountId)
                    return { ok: false, reason: "account_not_found" };
                await client.query(`
          UPDATE ${this.table("account_email_change_requests")}
             SET used_at = now()
           WHERE account_id = $1
             AND used_at IS NULL
          `, [accountId]);
                await client.query(`
          INSERT INTO ${this.table("account_email_change_requests")} (
            account_id,
            username,
            old_email,
            new_email,
            token_hash,
            expires_at,
            ip_address,
            user_agent,
            device_info,
            request_id
          )
          VALUES ($1, $2, $3, $4, $5, $6::timestamptz, NULLIF($7, '')::inet, $8, $9::jsonb, NULLIF($10, ''))
          `, [
                    accountId,
                    username,
                    oldEmail,
                    newEmail,
                    tokenHash,
                    expiresAt,
                    normalizeIp(e.ip_address || e.ip || ""),
                    cleanName(e.user_agent || e.userAgent || ""),
                    JSON.stringify(safeJson(e.device_info || e.deviceInfo || {})),
                    cleanName(e.request_id || e.requestId || ""),
                ]);
                return { ok: true };
            });
        }
        catch (error) {
            this.logger("[postgres] email change request write failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async consumeAccountEmailChangeRequest(tokenHash) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanTokenHash = cleanName(tokenHash);
        if (cleanTokenHash === "")
            return { ok: false, reason: "missing_token" };
        try {
            return await this.withTransaction(async (client) => {
                const result = await client.query(`
          SELECT
            r.email_change_request_id,
            r.account_id,
            r.username,
            r.old_email,
            r.new_email,
            r.expires_at,
            a.username::text AS account_username
          FROM ${this.table("account_email_change_requests")} r
          JOIN ${this.table("accounts")} a ON a.account_id = r.account_id
          WHERE r.token_hash = $1
            AND r.used_at IS NULL
            AND r.expires_at > now()
            AND a.is_active = true
          FOR UPDATE OF r
          LIMIT 1
          `, [cleanTokenHash]);
                const row = result.rows[0];
                if (!row)
                    return { ok: false, reason: "invalid_or_expired" };
                await client.query(`UPDATE ${this.table("account_email_change_requests")} SET used_at = now() WHERE email_change_request_id = $1`, [row.email_change_request_id]);
                return {
                    ok: true,
                    username: cleanName(row.account_username || row.username || ""),
                    old_email: cleanName(row.old_email || ""),
                    new_email: cleanName(row.new_email || ""),
                    account_id: cleanName(row.account_id || ""),
                };
            });
        }
        catch (error) {
            this.logger("[postgres] email change request consume failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async updateAccountPassword(username, passwordData = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanUsername = cleanName(username);
        const salt = cleanName(passwordData.salt || "");
        const hash = String(passwordData.hash || "");
        const algorithm = cleanName(passwordData.algorithm || "");
        if (cleanUsername === "" || salt === "" || hash === "" || algorithm === "") {
            return { ok: false, reason: "invalid_password_hash" };
        }
        try {
            const result = await this.db.query(`
        UPDATE ${this.table("accounts")}
           SET password_salt = $2,
               password_hash = $3,
               password_algorithm = $4,
               account_state = account_state || $5::jsonb,
               updated_at = now()
         WHERE lower(username::text) = lower($1)
           AND is_active = true
        `, [
                cleanUsername,
                salt,
                hash,
                algorithm,
                JSON.stringify({ password_salt: salt, password_hash: hash, password_algorithm: algorithm }),
            ]);
            if ((result.rowCount ?? 0) < 1)
                return { ok: false, reason: "account_not_found" };
            return { ok: true };
        }
        catch (error) {
            this.logger("[postgres] account password update failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async updateAccountEmail(username, newEmail) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const cleanUsername = cleanName(username);
        const cleanEmailValue = cleanName(newEmail);
        if (cleanUsername === "" || cleanEmailValue === "") {
            return { ok: false, reason: "invalid_email" };
        }
        try {
            const result = await this.db.query(`
        UPDATE ${this.table("accounts")}
           SET email = $2,
               email_verified = true,
               email_verified_at = now(),
               email_verification_token_hash = '',
               email_verification_expires_at = NULL,
               account_state = account_state || $3::jsonb,
               updated_at = now()
         WHERE lower(username::text) = lower($1)
           AND is_active = true
        `, [
                cleanUsername,
                cleanEmailValue,
                JSON.stringify({
                    email: cleanEmailValue,
                    email_verified: true,
                    email_verified_at: new Date().toISOString(),
                    email_verification_token_hash: "",
                    email_verification_expires_at: "",
                }),
            ]);
            if ((result.rowCount ?? 0) < 1)
                return { ok: false, reason: "account_not_found" };
            return { ok: true };
        }
        catch (error) {
            if (getErrorCode(error) === "23505") {
                return { ok: false, reason: "email_in_use" };
            }
            this.logger("[postgres] account email update failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    mirrorPlayerWorld(username, worldName) {
        if (!this.isReady())
            return;
        const cleanUsername = cleanName(username);
        const cleanWorld = cleanName(worldName);
        if (cleanUsername === "")
            return;
        this.runDetached("mirror player world", async () => {
            await this.withTransaction(async (client) => {
                const playerId = await this.ensurePlayerIdentity(client, cleanUsername, "", "player", cleanWorld);
                if (!playerId)
                    return;
                await client.query(`
          UPDATE ${this.table("players")}
             SET current_world_name = NULLIF($2, '')
           WHERE player_id = $1
          `, [playerId, cleanWorld]);
            });
        });
    }
    async updatePlayerProgression(client, playerId, state) {
        if (!this.progressionReady || !playerId)
            return null;
        const progression = normalizeProgressionState(state);
        await client.query(`
      UPDATE ${this.table("players")}
         SET player_level = $2,
             player_xp = $3,
             player_xp_needed = $4,
             player_total_xp = $5,
             player_title = $6,
             last_level_up_at = COALESCE(NULLIF($7, '')::timestamptz, last_level_up_at),
             updated_at = now()
       WHERE player_id = $1
      `, [
            playerId,
            progression.player_level,
            progression.player_xp,
            progression.player_xp_needed,
            progression.player_total_xp,
            progression.player_title,
            progression.last_level_up_at,
        ]);
        return progression;
    }
    mirrorPlayerProgression(username, state, event = {}) {
        if (!this.isReady() || !this.progressionReady)
            return;
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return;
        const playerState = toObject(state);
        const progressionEvent = toObject(event);
        this.runDetached("mirror player progression", async () => {
            await this.withTransaction(async (client) => {
                const playerId = await this.ensurePlayerIdentity(client, cleanUsername);
                if (!playerId)
                    return;
                await this.updatePlayerProgression(client, playerId, playerState);
                const xpDelta = Math.max(0, toInt(progressionEvent.xp_gained, 0));
                if (xpDelta <= 0)
                    return;
                await client.query(`
          INSERT INTO ${this.table("player_progression_events")} (
            player_id,
            source,
            xp_delta,
            level_before,
            level_after,
            xp_before,
            xp_after,
            total_xp_after,
            metadata,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
          `, [
                    playerId,
                    cleanName(progressionEvent.source || "system") || "system",
                    xpDelta,
                    Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(progressionEvent.level_before, 1))),
                    Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(progressionEvent.level_after, 1))),
                    Math.max(0, toInt(progressionEvent.xp_before, 0)),
                    Math.max(0, toInt(progressionEvent.xp_after, 0)),
                    Math.max(0, toInt(progressionEvent.total_xp_after, playerState.player_total_xp || 0)),
                    JSON.stringify(safeJson(progressionEvent.details)),
                ]);
            });
        });
    }
    mirrorInventorySnapshot(username, state) {
        if (!this.isReady())
            return;
        const cleanUsername = cleanName(username);
        const playerState = toObject(state);
        if (cleanUsername === "")
            return;
        this.runDetached("mirror inventory snapshot", async () => {
            await this.withTransaction(async (client) => {
                const playerId = await this.ensurePlayerIdentity(client, cleanUsername);
                if (!playerId)
                    return;
                await this.updatePlayerProgression(client, playerId, playerState);
                await client.query(`DELETE FROM ${this.table("inventory")} WHERE player_id = $1`, [playerId]);
                for (const [field, fallbackCategory] of INVENTORY_FIELD_CATEGORY) {
                    const bucket = toObject(playerState[field]);
                    for (const [itemType, rawAmount] of Object.entries(bucket)) {
                        const cleanItemType = cleanName(itemType);
                        const amount = Math.max(0, toInt(rawAmount, 0));
                        if (cleanItemType === "" || amount <= 0)
                            continue;
                        const stackLimit = getInventoryStackLimitForItem(cleanItemType);
                        await client.query(`
              INSERT INTO ${this.table("inventory")} (
                player_id,
                item_type,
                item_category,
                amount,
                stack_limit,
                row_version,
                updated_at
              )
              VALUES ($1, $2, $3, $4, $5, 0, now())
              `, [playerId, cleanItemType, fallbackCategory, amount, stackLimit]);
                    }
                }
                await this.reconcileItemInstancesForInventory(client, playerId, playerState, {
                    source: "mirror_inventory_snapshot",
                    username: cleanUsername,
                    allow_create_missing: false,
                    allow_retire_extra: false,
                });
            });
        });
    }
    getItemInstanceLedgerDestination(source, action, delta) {
        const label = `${cleanName(source)} ${cleanName(action)}`.toLowerCase();
        if (delta >= 0)
            return { state: ITEM_INSTANCE_ACTIVE_STATE, location: "inventory" };
        if (label.includes("spend") || label.includes("purchase") || label.includes("buy_cost")) {
            return { state: ITEM_INSTANCE_RETIRED_STATE, location: "unknown" };
        }
        if (label.includes("vending") || label.includes("vend"))
            return { state: "locked", location: "vending" };
        if (label.includes("trade"))
            return { state: "traded", location: "trade" };
        if (label.includes("safe"))
            return { state: "locked", location: "safe" };
        if (label.includes("donation_box") || label.includes("donation box"))
            return { state: "locked", location: "donation_box" };
        if (label.includes("display"))
            return { state: "locked", location: "display" };
        if (label.includes("drop"))
            return { state: "dropped", location: "world_drop" };
        if (label.includes("trash") || label.includes("destroy"))
            return { state: "destroyed", location: "unknown" };
        return { state: ITEM_INSTANCE_RETIRED_STATE, location: "unknown" };
    }
    /**
     * @param {PixelMania.TrackedWorldDropChangeEntry | PixelMania.WorldChangeEntry | Record<string, unknown>} change
     * @returns {boolean}
     */
    shouldCreateTrackedWorldDropItemInstancesForChange(change = {}) {
        const e = toObject(change);
        /** @type {PixelMania.TrackedWorldDropChangeDetails} */
        const details = toObject(e.details);
        const dropId = cleanName(details.drop_id || e.drop_id || "");
        if (dropId === "")
            return false;
        const source = cleanName(e.source_type || e.source || "").toLowerCase();
        const action = cleanName(e.action || "").toLowerCase();
        // Inventory drops already move exact owned PM-ITEM rows into world_drop.
        // Creating rows again here would mint duplicates for the same drop.
        if (source.includes("drop_inventory") || source.includes("world_item_drop_create"))
            return false;
        if (action.includes("drop_inventory") || action.includes("world_item_drop_create"))
            return false;
        // Server/world-generated drops do not come from a player's owned instance.
        return (source.includes("world_block_break") ||
            source.includes("seed_harvest") ||
            source.includes("server") ||
            action === "break_drop" ||
            action === "harvest_drop" ||
            action === "drop_create");
    }
    async syncItemInstancesForLedger(client, entry = {}) {
        const e = toObject(entry);
        const playerId = cleanName(e.player_id || "");
        const itemType = cleanName(e.item_type || e.item_id || "");
        const itemCategory = resolveItemCategory(itemType, e.item_category || e.category || "");
        if (!isUuid(playerId) || itemType === "" || !shouldTrackItemInstance(itemType, itemCategory)) {
            return { ok: true, tracked: false, created: 0, moved: 0, item_instances: [] };
        }
        const delta = toInt(e.delta || e.quantity_delta || 0, 0);
        const balanceAfter = Math.max(0, toInt(e.after_amount || e.balance_after || 0, 0));
        const strict = Boolean(e.strict_item_instances || e.strict || e.instance_id_first);
        const requestedAmount = Math.max(0, Math.abs(delta));
        const amount = strict ? requestedAmount : Math.min(requestedAmount, ITEM_INSTANCE_RECONCILE_MAX_PER_ITEM);
        if (amount <= 0)
            return { ok: true, tracked: true, created: 0, moved: 0, item_instances: [] };
        const worldId = isUuid(e.world_id) ? cleanName(e.world_id) : null;
        const itemTransactionId = toInt(e.item_transaction_id, 0) > 0 ? toInt(e.item_transaction_id, 0) : null;
        const source = normalizeItemInstanceSource(e.source || e.source_type || "item_ledger");
        const action = cleanName(e.action || e.reason || "");
        const entryDetails = safeJson(e.details);
        const activeCountResult = await client.query(`
      SELECT count(*)::integer AS active_count
        FROM ${this.table("item_instances")}
       WHERE owner_player_id = $1
         AND item_type = $2
         AND item_category = $3
         AND state = 'active'
      `, [playerId, itemType, itemCategory]);
        const activeCount = Math.max(0, toInt(activeCountResult.rows[0]?.active_count, 0));
        if (delta > 0) {
            const label = `${source} ${action}`.toLowerCase();
            const releasePlans = [];
            const addReleasePlan = (location, metadataAction, metadataTransactionId, planAmount, sourceOwnerUsername = "") => {
                const cleanLocation = cleanName(location || "").toLowerCase();
                if (!ITEM_INSTANCE_LOCATIONS.has(cleanLocation))
                    return;
                const cleanAction = cleanName(metadataAction || "");
                const cleanTransactionId = cleanName(metadataTransactionId || "");
                const cleanAmount = Math.max(0, toInt(planAmount, 0));
                if (cleanAmount <= 0)
                    return;
                releasePlans.push({
                    location: cleanLocation,
                    metadata_action: cleanAction,
                    metadata_transaction_id: cleanTransactionId,
                    source_owner_username: cleanName(sourceOwnerUsername || ""),
                    amount: cleanAmount,
                });
            };
            if (strict && label.includes("vend") && label.includes("break_return")) {
                const returnedEntries = Array.isArray(entryDetails.returned_entries) ? entryDetails.returned_entries : [];
                for (const rawReturnedEntry of returnedEntries) {
                    const returnedEntry = toObject(rawReturnedEntry);
                    const returnedItemType = cleanName(returnedEntry.item_id || returnedEntry.item_type || "");
                    const returnedItemCategory = resolveItemCategory(returnedItemType, returnedEntry.item_category || returnedEntry.category || "");
                    const returnedAmount = Math.max(0, toInt(returnedEntry.amount, 0));
                    if (returnedItemType !== itemType || returnedItemCategory !== itemCategory || returnedAmount <= 0)
                        continue;
                    const reasonLabel = cleanName(returnedEntry.reason || "").toLowerCase();
                    const isMachineRecovery = reasonLabel.includes("machine") && reasonLabel.includes("break");
                    const metadataAction = isMachineRecovery ? "" : reasonLabel.includes("pending") || reasonLabel.includes("payment")
                        ? "payment"
                        : "vending_list";
                    addReleasePlan(isMachineRecovery ? "unknown" : "vending", metadataAction, returnedEntry.listing_transaction_id || returnedEntry.source_transaction_id || entryDetails.listing_transaction_id || entryDetails.source_transaction_id || "", returnedAmount);
                }
                const plannedAmount = releasePlans.reduce((total, plan) => total + plan.amount, 0);
                if (plannedAmount < amount) {
                    addReleasePlan("vending", "", "", amount - plannedAmount);
                }
            }
            else if (strict && label.includes("vend") && (label.includes("cancel") || label.includes("collect"))) {
                addReleasePlan("vending", label.includes("collect") ? "payment" : "vending_list", entryDetails.listing_transaction_id || entryDetails.source_transaction_id || "", amount);
            }
            else if (strict && label.includes("safe") && (label.includes("withdraw") || label.includes("break_return"))) {
                addReleasePlan("safe", "safe_deposit", entryDetails.source_transaction_id || "", amount);
            }
            else if (strict && (label.includes("donation_box") || label.includes("donation box")) && (label.includes("retrieve") || label.includes("break_return"))) {
                const returnedEntries = Array.isArray(entryDetails.returned_entries) ? entryDetails.returned_entries : [];
                for (const rawReturnedEntry of returnedEntries) {
                    const returnedEntry = toObject(rawReturnedEntry);
                    const returnedItemType = cleanName(returnedEntry.item_id || returnedEntry.item_type || "");
                    const returnedItemCategory = resolveItemCategory(returnedItemType, returnedEntry.item_category || returnedEntry.category || "");
                    const returnedAmount = Math.max(0, toInt(returnedEntry.amount, 0));
                    if (returnedItemType !== itemType || returnedItemCategory !== itemCategory || returnedAmount <= 0)
                        continue;
                    addReleasePlan("donation_box", "donation_box_donate", returnedEntry.donation_id || returnedEntry.source_transaction_id || "", returnedAmount, returnedEntry.donor_username || returnedEntry.source_owner_username || "");
                }
                if (releasePlans.length === 0 && cleanName(entryDetails.donor_username || "") !== "") {
                    addReleasePlan("donation_box", "donation_box_donate", entryDetails.donation_id || entryDetails.source_transaction_id || "", amount, entryDetails.donor_username || "");
                }
            }
            else if (strict && label.includes("display") && (label.includes("withdraw") || label.includes("break_return"))) {
                const sourceTransactionId = cleanName(entryDetails.source_transaction_id || entryDetails.display_transaction_id || "");
                if (sourceTransactionId !== "") {
                    addReleasePlan("display", "display_deposit", sourceTransactionId, amount);
                }
            }
            if (releasePlans.length > 0) {
                const releasedInstances = [];
                for (const plan of releasePlans) {
                    let lockedOwnerPlayerId = playerId;
                    // Placing an instance-tracked block (e.g. a vending machine) spends it via the
                    // generic "world_block_place" ledger label, which getItemInstanceLedgerDestination()
                    // does not recognize as vending/safe/donation_box/display/etc, so it falls through
                    // to the default bucket: state=RETIRED_STATE, location="unknown". The machine-recovery
                    // release plan built above (isMachineRecovery) uses that same location="unknown" but,
                    // until now, only searched for state="locked" -- so a placed vending machine's own
                    // tracked instance was invisible to its own break-return, and breaking it always
                    // failed with "Tracked item data is missing for vending_machine.". location="unknown"
                    // is only ever produced by that machine-recovery plan (every other release plan uses
                    // "vending"/"safe"/"donation_box"/"display"), so it is safe to widen the search here.
                    const releaseStates = plan.metadata_action === "world_block_place" || plan.location === "unknown"
                        ? ["locked", ITEM_INSTANCE_RETIRED_STATE]
                        : ["locked"];
                    if (plan.source_owner_username !== "") {
                        const sourceOwnerPlayerId = await this.lookupPlayerIdByUsername(client, plan.source_owner_username);
                        if (!sourceOwnerPlayerId) {
                            return {
                                ok: false,
                                tracked: true,
                                reason: "donation_source_owner_not_found",
                                item_type: itemType,
                                item_category: itemCategory,
                                source_owner_username: plan.source_owner_username,
                            };
                        }
                        lockedOwnerPlayerId = sourceOwnerPlayerId;
                    }
                    const lockedRows = await client.query(`
            SELECT item_instance_id, owner_player_id, world_id, state, current_location, public_item_instance_id
              FROM ${this.table("item_instances")}
             WHERE owner_player_id = $1
               AND item_type = $2
               AND item_category = $3
               AND state = ANY($7::text[])
               AND current_location = $4
               AND ($5 = '' OR metadata->>'action' = $5)
               AND (
                 $6 = ''
                 OR metadata->>'transaction_id' = $6
                 OR metadata #>> '{details,transaction_id}' = $6
                 OR metadata #>> '{details,listing_transaction_id}' = $6
                )
              ORDER BY updated_at ASC, created_at ASC
              LIMIT $8
              FOR UPDATE
            `, [
                        lockedOwnerPlayerId,
                        itemType,
                        itemCategory,
                        plan.location,
                        plan.metadata_action,
                        plan.metadata_transaction_id,
                        releaseStates,
                        plan.amount,
                    ]);
                    if ((lockedRows.rowCount ?? 0) < plan.amount) {
                        return {
                            ok: false,
                            tracked: true,
                            reason: "insufficient_locked_item_instances",
                            item_type: itemType,
                            item_category: itemCategory,
                            required_instances: plan.amount,
                            available_instances: lockedRows.rowCount ?? 0,
                            current_location: plan.location,
                            metadata_action: plan.metadata_action,
                        };
                    }
                    for (const row of lockedRows.rows) {
                        await client.query(`
              UPDATE ${this.table("item_instances")}
                 SET state = 'active',
                     current_location = 'inventory',
                     world_id = COALESCE($2, world_id),
                     metadata = metadata || $3::jsonb,
                     owner_player_id = $4,
                     updated_at = now()
               WHERE item_instance_id = $1
              `, [
                            row.item_instance_id,
                            worldId,
                            JSON.stringify({
                                source,
                                action,
                                item_transaction_id: itemTransactionId,
                                balance_after: balanceAfter,
                                released_from: plan.location,
                                release_action: plan.metadata_action,
                                details: safeJson(e.details),
                            }),
                            playerId,
                        ]);
                        releasedInstances.push({
                            item_instance_id: row.item_instance_id,
                            public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                            item_type: itemType,
                            item_category: itemCategory,
                            previous_state: cleanName(row.state || "locked"),
                            state: ITEM_INSTANCE_ACTIVE_STATE,
                            previous_location: cleanName(row.current_location || plan.location),
                            current_location: "inventory",
                            owner_player_id: playerId,
                        });
                        await this.recordItemInstanceEvent(client, {
                            item_instance_id: row.item_instance_id,
                            event_type: row.owner_player_id === playerId ? "state_changed" : "owner_changed",
                            from_player_id: row.owner_player_id,
                            to_player_id: playerId,
                            from_location: row.current_location || plan.location,
                            to_location: "inventory",
                            world_id: worldId || row.world_id,
                            item_transaction_id: itemTransactionId,
                            source,
                            metadata: {
                                public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                                item_type: itemType,
                                item_category: itemCategory,
                                action,
                                previous_state: cleanName(row.state || "locked"),
                                state: ITEM_INSTANCE_ACTIVE_STATE,
                                released_from: plan.location,
                                release_action: plan.metadata_action,
                                balance_after: balanceAfter,
                                details: safeJson(e.details),
                            },
                        });
                    }
                }
                return { ok: true, tracked: true, created: 0, moved: releasedInstances.length, item_instances: releasedInstances };
            }
            const createCount = strict ? amount : Math.min(amount, Math.max(0, balanceAfter - activeCount));
            if (createCount > 0 && strict && isVagueItemInstanceCreationSource(source)) {
                return {
                    ok: false,
                    tracked: true,
                    reason: "missing_item_instance_source",
                    item_type: itemType,
                    item_category: itemCategory,
                    required_instances: createCount,
                    source,
                    action,
                    message: "Tracked item creation requires a clear source label.",
                };
            }
            const createdInstances = [];
            for (let i = 0; i < createCount; i += 1) {
                const publicItemInstanceId = generatePublicItemInstanceId();
                const result = await client.query(`
          INSERT INTO ${this.table("item_instances")} (
            public_item_instance_id,
            item_type,
            item_category,
            owner_player_id,
            world_id,
            state,
            created_by_source,
            current_location,
            origin_transaction_id,
            metadata,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, 'active', $6, 'inventory', $7, $8::jsonb, now(), now())
          RETURNING item_instance_id
          `, [
                    publicItemInstanceId,
                    itemType,
                    itemCategory,
                    playerId,
                    worldId,
                    source,
                    itemTransactionId,
                    JSON.stringify({
                        source,
                        action,
                        item_transaction_id: itemTransactionId,
                        details: safeJson(e.details),
                    }),
                ]);
                const itemInstanceId = result.rows[0]?.item_instance_id || null;
                createdInstances.push({
                    item_instance_id: itemInstanceId,
                    public_item_instance_id: publicItemInstanceId,
                    item_type: itemType,
                    item_category: itemCategory,
                    state: ITEM_INSTANCE_ACTIVE_STATE,
                    current_location: "inventory",
                    owner_player_id: playerId,
                });
                await this.recordItemInstanceEvent(client, {
                    item_instance_id: itemInstanceId,
                    event_type: "created",
                    to_player_id: playerId,
                    to_location: "inventory",
                    world_id: worldId,
                    item_transaction_id: itemTransactionId,
                    source,
                    metadata: {
                        public_item_instance_id: publicItemInstanceId,
                        item_type: itemType,
                        item_category: itemCategory,
                        action,
                        balance_after: balanceAfter,
                        details: safeJson(e.details),
                    },
                });
            }
            return { ok: true, tracked: true, created: createCount, moved: 0, item_instances: createdInstances };
        }
        const movementCount = strict ? amount : Math.min(amount, Math.max(0, activeCount - balanceAfter));
        if (movementCount <= 0)
            return { ok: true, tracked: true, created: 0, moved: 0, item_instances: [] };
        const destination = this.getItemInstanceLedgerDestination(source, action, delta);
        const movesToWorldDrop = destination.location === "world_drop";
        const dropId = cleanName(entryDetails.drop_id || "");
        const activeRows = await client.query(`
      SELECT item_instance_id, owner_player_id, world_id, state, current_location, public_item_instance_id
        FROM ${this.table("item_instances")}
       WHERE owner_player_id = $1
         AND item_type = $2
         AND item_category = $3
         AND state = 'active'
       ORDER BY created_at ASC
       LIMIT $4
       FOR UPDATE
      `, [playerId, itemType, itemCategory, movementCount]);
        if (strict && (activeRows.rowCount ?? 0) < movementCount) {
            return {
                ok: false,
                tracked: true,
                reason: "insufficient_item_instances",
                item_type: itemType,
                item_category: itemCategory,
                required_instances: movementCount,
                available_instances: activeRows.rowCount ?? 0,
            };
        }
        const movedInstances = [];
        for (const row of activeRows.rows) {
            const previousLocation = cleanName(row.current_location || "inventory");
            await client.query(`
        UPDATE ${this.table("item_instances")}
           SET state = $2,
               current_location = $3,
               world_id = COALESCE($4, world_id),
               owner_player_id = CASE WHEN $6::boolean THEN NULL ELSE owner_player_id END,
               metadata = metadata || $5::jsonb,
               updated_at = now()
         WHERE item_instance_id = $1
        `, [
                row.item_instance_id,
                destination.state,
                destination.location,
                worldId,
                JSON.stringify({
                    source,
                    action,
                    drop_id: dropId,
                    item_transaction_id: itemTransactionId,
                    balance_after: balanceAfter,
                    details: safeJson(e.details),
                }),
                movesToWorldDrop,
            ]);
            movedInstances.push({
                item_instance_id: row.item_instance_id,
                public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                item_type: itemType,
                item_category: itemCategory,
                previous_state: cleanName(row.state || ITEM_INSTANCE_ACTIVE_STATE),
                state: destination.state,
                previous_location: previousLocation,
                current_location: destination.location,
                owner_player_id: movesToWorldDrop ? null : row.owner_player_id,
                previous_owner_player_id: row.owner_player_id,
                drop_id: dropId,
            });
            await this.recordItemInstanceEvent(client, {
                item_instance_id: row.item_instance_id,
                event_type: "state_changed",
                from_player_id: row.owner_player_id,
                to_player_id: movesToWorldDrop ? null : row.owner_player_id,
                from_location: previousLocation,
                to_location: destination.location,
                world_id: worldId || row.world_id,
                item_transaction_id: itemTransactionId,
                source,
                metadata: {
                    public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                    item_type: itemType,
                    item_category: itemCategory,
                    action,
                    drop_id: dropId,
                    previous_state: cleanName(row.state || ITEM_INSTANCE_ACTIVE_STATE),
                    state: destination.state,
                    balance_after: balanceAfter,
                    details: safeJson(e.details),
                },
            });
        }
        return { ok: true, tracked: true, created: 0, moved: activeRows.rowCount ?? 0, item_instances: movedInstances };
    }
    async transferTrackedItemInstances(client, entry = {}) {
        const e = toObject(entry);
        const fromPlayerId = cleanName(e.from_player_id || "");
        const toPlayerId = cleanName(e.to_player_id || "");
        const itemType = cleanName(e.item_type || e.item_id || "");
        const itemCategory = resolveItemCategory(itemType, e.item_category || e.category || "");
        if (!isUuid(fromPlayerId) || !isUuid(toPlayerId) || itemType === "" || !shouldTrackItemInstance(itemType, itemCategory)) {
            return { ok: true, tracked: false, transferred: 0, item_instances: [] };
        }
        const strict = Boolean(e.strict_item_instances || e.strict || e.instance_id_first);
        const rawIds = [
            ...(Array.isArray(e.public_item_instance_ids) ? e.public_item_instance_ids : []),
            ...(Array.isArray(e.item_instance_ids) ? e.item_instance_ids : []),
        ];
        const requestedPublicIds = rawIds
            .map((id) => cleanName(id))
            .filter((id) => id !== "");
        const amount = Math.max(requestedPublicIds.length, Math.max(0, toInt(e.amount || e.quantity || 0, 0)));
        if (amount <= 0)
            return { ok: true, tracked: true, transferred: 0, item_instances: [] };
        const worldId = isUuid(e.world_id) ? cleanName(e.world_id) : null;
        const correlationId = isUuid(e.correlation_id) ? cleanName(e.correlation_id) : null;
        const source = normalizeItemInstanceSource(e.source || "transfer");
        const action = cleanName(e.action || "transfer") || "transfer";
        const toState = normalizeItemInstanceState(e.to_state || e.destination_state || ITEM_INSTANCE_ACTIVE_STATE);
        const toLocation = normalizeItemInstanceLocation(e.to_location || e.destination_location || "inventory", "inventory");
        const fromStates = Array.isArray(e.from_states)
            ? e.from_states.map((state) => normalizeItemInstanceState(state, ITEM_INSTANCE_ACTIVE_STATE))
            : [ITEM_INSTANCE_ACTIVE_STATE];
        const fromLocations = Array.isArray(e.from_locations)
            ? e.from_locations.map((location) => normalizeItemInstanceLocation(location, "unknown"))
            : [];
        const fromMetadataAction = cleanName(e.from_metadata_action || e.metadata_action || "");
        const fromMetadataTransactionId = cleanName(e.from_metadata_transaction_id || e.listing_transaction_id || e.source_transaction_id || "");
        const preferredWorldName = cleanName(e.preferred_world_name || e.world_name || "");
        const requirePreferredWorldName = Boolean(e.require_preferred_world_name || e.strict_preferred_world_name);
        const rows = requestedPublicIds.length > 0
            ? await client.query(`
        SELECT item_instance_id, public_item_instance_id, owner_player_id, world_id, state, current_location, metadata
          FROM ${this.table("item_instances")}
         WHERE owner_player_id = $1
           AND item_type = $2
           AND item_category = $3
           AND state = ANY($4::text[])
           AND ($5::text[] = ARRAY[]::text[] OR current_location = ANY($5::text[]))
           AND ($6 = '' OR metadata->>'action' = $6)
           AND (
             $7 = ''
             OR metadata->>'transaction_id' = $7
             OR metadata #>> '{details,transaction_id}' = $7
             OR metadata #>> '{details,listing_transaction_id}' = $7
           )
           AND (
             $8 = ''
             OR $9::boolean = false
             OR lower(COALESCE(metadata #>> '{details,world_name}', metadata->>'world_name', '')) = lower($8)
           )
           AND public_item_instance_id = ANY($10::text[])
         ORDER BY
           CASE
             WHEN $8 <> ''
              AND lower(COALESCE(metadata #>> '{details,world_name}', metadata->>'world_name', '')) = lower($8)
             THEN 0
             ELSE 1
           END,
           created_at ASC
         FOR UPDATE
        `, [fromPlayerId, itemType, itemCategory, fromStates, fromLocations, fromMetadataAction, fromMetadataTransactionId, preferredWorldName, requirePreferredWorldName, requestedPublicIds])
            : await client.query(`
        SELECT item_instance_id, public_item_instance_id, owner_player_id, world_id, state, current_location, metadata
          FROM ${this.table("item_instances")}
         WHERE owner_player_id = $1
           AND item_type = $2
           AND item_category = $3
           AND state = ANY($4::text[])
           AND ($5::text[] = ARRAY[]::text[] OR current_location = ANY($5::text[]))
           AND ($6 = '' OR metadata->>'action' = $6)
           AND (
             $7 = ''
             OR metadata->>'transaction_id' = $7
             OR metadata #>> '{details,transaction_id}' = $7
             OR metadata #>> '{details,listing_transaction_id}' = $7
           )
           AND (
             $8 = ''
             OR $9::boolean = false
             OR lower(COALESCE(metadata #>> '{details,world_name}', metadata->>'world_name', '')) = lower($8)
           )
         ORDER BY
           CASE
             WHEN $8 <> ''
              AND lower(COALESCE(metadata #>> '{details,world_name}', metadata->>'world_name', '')) = lower($8)
             THEN 0
             ELSE 1
           END,
           created_at ASC
         LIMIT $10
         FOR UPDATE
        `, [fromPlayerId, itemType, itemCategory, fromStates, fromLocations, fromMetadataAction, fromMetadataTransactionId, preferredWorldName, requirePreferredWorldName, amount]);
        if ((strict || requestedPublicIds.length > 0) && (rows.rowCount ?? 0) < amount) {
            return {
                ok: false,
                tracked: true,
                reason: "insufficient_item_instances",
                item_type: itemType,
                item_category: itemCategory,
                required_instances: amount,
                available_instances: rows.rowCount ?? 0,
            };
        }
        const transferredInstances = [];
        for (const row of rows.rows) {
            await client.query(`
        UPDATE ${this.table("item_instances")}
           SET owner_player_id = $2,
               world_id = COALESCE($3::uuid, world_id),
               state = $5,
               current_location = $6,
               metadata = metadata || $4::jsonb,
               updated_at = now()
         WHERE item_instance_id = $1
        `, [
                row.item_instance_id,
                toPlayerId,
                worldId,
                JSON.stringify({
                    source,
                    action,
                    correlation_id: correlationId,
                    details: safeJson(e.details),
                }),
                toState,
                toLocation,
            ]);
            transferredInstances.push({
                item_instance_id: row.item_instance_id,
                public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                item_type: itemType,
                item_category: itemCategory,
                from_player_id: fromPlayerId,
                to_player_id: toPlayerId,
                previous_state: cleanName(row.state || ITEM_INSTANCE_ACTIVE_STATE),
                state: toState,
                previous_location: cleanName(row.current_location || "inventory"),
                current_location: toLocation,
                metadata: safeJson(row.metadata),
            });
            await this.recordItemInstanceEvent(client, {
                item_instance_id: row.item_instance_id,
                event_type: "owner_changed",
                from_player_id: fromPlayerId,
                to_player_id: toPlayerId,
                from_location: row.current_location || "inventory",
                to_location: toLocation,
                world_id: worldId || row.world_id,
                correlation_id: correlationId,
                source,
                metadata: {
                    public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                    item_type: itemType,
                    item_category: itemCategory,
                    action,
                    state: toState,
                    details: safeJson(e.details),
                },
            });
        }
        return { ok: true, tracked: true, transferred: rows.rowCount ?? 0, item_instances: transferredInstances };
    }
    async claimTrackedWorldDropItemInstances(client, entry = {}) {
        const e = toObject(entry);
        const toPlayerId = cleanName(e.to_player_id || e.player_id || "");
        const itemType = cleanName(e.item_type || e.item_id || "");
        const itemCategory = resolveItemCategory(itemType, e.item_category || e.category || "");
        if (!isUuid(toPlayerId) || itemType === "" || !shouldTrackItemInstance(itemType, itemCategory)) {
            return { ok: true, tracked: false, claimed: 0, item_instances: [] };
        }
        const amount = Math.max(0, toInt(e.amount || e.quantity || 0, 0));
        if (amount <= 0)
            return { ok: true, tracked: true, claimed: 0, item_instances: [] };
        const worldId = isUuid(e.world_id) ? cleanName(e.world_id) : null;
        const itemTransactionId = toInt(e.item_transaction_id, 0) > 0 ? toInt(e.item_transaction_id, 0) : null;
        const correlationId = isUuid(e.correlation_id) ? cleanName(e.correlation_id) : null;
        const dropId = cleanName(e.drop_id || "");
        const source = normalizeItemInstanceSource(e.source || "world_drop");
        const action = cleanName(e.action || "pickup") || "pickup";
        const rows = await client.query(`
      SELECT item_instance_id, public_item_instance_id, owner_player_id, world_id, state, current_location
        FROM ${this.table("item_instances")}
       WHERE item_type = $1
         AND item_category = $2
         AND state = 'dropped'
         AND current_location = 'world_drop'
         AND ($3::uuid IS NULL OR world_id = $3::uuid)
         AND (
           $4 = ''
           OR metadata->>'drop_id' = $4
           OR metadata #>> '{details,drop_id}' = $4
           OR metadata #>> '{details,details,drop_id}' = $4
         )
       ORDER BY updated_at ASC, created_at ASC
       LIMIT $5
       FOR UPDATE
      `, [itemType, itemCategory, worldId, dropId, amount]);
        if ((rows.rowCount ?? 0) < amount) {
            return {
                ok: false,
                tracked: true,
                reason: "missing_world_drop_item_instances",
                item_type: itemType,
                item_category: itemCategory,
                drop_id: dropId,
                required_instances: amount,
                available_instances: rows.rowCount ?? 0,
            };
        }
        const claimedInstances = [];
        for (const row of rows.rows) {
            await client.query(`
        UPDATE ${this.table("item_instances")}
           SET owner_player_id = $2,
               world_id = COALESCE($3::uuid, world_id),
               state = 'active',
               current_location = 'inventory',
               metadata = metadata || $4::jsonb,
               updated_at = now()
         WHERE item_instance_id = $1
        `, [
                row.item_instance_id,
                toPlayerId,
                worldId,
                JSON.stringify({
                    source,
                    action,
                    drop_id: dropId,
                    item_transaction_id: itemTransactionId,
                    correlation_id: correlationId,
                    details: safeJson(e.details),
                }),
            ]);
            claimedInstances.push({
                item_instance_id: row.item_instance_id,
                public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                item_type: itemType,
                item_category: itemCategory,
                from_player_id: row.owner_player_id,
                to_player_id: toPlayerId,
                previous_state: cleanName(row.state || "dropped"),
                state: ITEM_INSTANCE_ACTIVE_STATE,
                previous_location: cleanName(row.current_location || "world_drop"),
                current_location: "inventory",
            });
            await this.recordItemInstanceEvent(client, {
                item_instance_id: row.item_instance_id,
                event_type: "owner_changed",
                from_player_id: row.owner_player_id,
                to_player_id: toPlayerId,
                from_location: row.current_location || "world_drop",
                to_location: "inventory",
                world_id: worldId || row.world_id,
                item_transaction_id: itemTransactionId,
                correlation_id: correlationId,
                source,
                metadata: {
                    public_item_instance_id: cleanName(row.public_item_instance_id || ""),
                    item_type: itemType,
                    item_category: itemCategory,
                    action,
                    drop_id: dropId,
                    details: safeJson(e.details),
                },
            });
        }
        return { ok: true, tracked: true, claimed: rows.rowCount ?? 0, item_instances: claimedInstances };
    }
    async createTrackedWorldDropItemInstances(client, entry = {}) {
        const e = toObject(entry);
        const itemType = cleanName(e.item_type || e.item_id || "");
        const itemCategory = resolveItemCategory(itemType, e.item_category || e.category || "");
        if (itemType === "" || !shouldTrackItemInstance(itemType, itemCategory)) {
            return { ok: true, tracked: false, created: 0, item_instances: [] };
        }
        const amount = Math.max(0, toInt(e.amount || e.quantity || 0, 0));
        if (amount <= 0)
            return { ok: true, tracked: true, created: 0, item_instances: [] };
        const worldId = isUuid(e.world_id) ? cleanName(e.world_id) : null;
        let actorPlayerId = isUuid(e.actor_player_id || e.player_id) ? cleanName(e.actor_player_id || e.player_id) : null;
        const actorUsername = cleanName(e.actor_username || e.username || "");
        if (!actorPlayerId && actorUsername !== "") {
            actorPlayerId = await this.ensurePlayerIdentity(client, actorUsername);
        }
        const itemTransactionId = toInt(e.item_transaction_id, 0) > 0 ? toInt(e.item_transaction_id, 0) : null;
        const correlationId = isUuid(e.correlation_id) ? cleanName(e.correlation_id) : null;
        const dropId = cleanName(e.drop_id || "");
        const source = normalizeItemInstanceSource(e.source || "world_drop");
        const action = cleanName(e.action || "drop_create") || "drop_create";
        const details = safeJson(e.details);
        const createdInstances = [];
        let createCount = amount;
        if (dropId !== "" && worldId) {
            const existingResult = await client.query(`
        SELECT count(*)::integer AS existing_count
          FROM ${this.table("item_instances")}
         WHERE item_type = $1
           AND item_category = $2
           AND world_id = $3
           AND state = 'dropped'
           AND current_location = 'world_drop'
           AND (
             metadata->>'drop_id' = $4
             OR metadata #>> '{details,drop_id}' = $4
             OR metadata #>> '{details,details,drop_id}' = $4
           )
        `, [itemType, itemCategory, worldId, dropId]);
            createCount = Math.max(0, amount - Math.max(0, toInt(existingResult.rows[0]?.existing_count, 0)));
            if (createCount <= 0) {
                return { ok: true, tracked: true, created: 0, item_instances: [] };
            }
        }
        for (let i = 0; i < createCount; i += 1) {
            const publicItemInstanceId = generatePublicItemInstanceId();
            const result = await client.query(`
        INSERT INTO ${this.table("item_instances")} (
          public_item_instance_id,
          item_type,
          item_category,
          owner_player_id,
          world_id,
          state,
          created_by_source,
          current_location,
          origin_transaction_id,
          metadata,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, NULL, $4, 'dropped', $5, 'world_drop', $6, $7::jsonb, now(), now())
        RETURNING item_instance_id
        `, [
                publicItemInstanceId,
                itemType,
                itemCategory,
                worldId,
                source,
                itemTransactionId,
                JSON.stringify({
                    source,
                    action,
                    drop_id: dropId,
                    item_transaction_id: itemTransactionId,
                    correlation_id: correlationId,
                    details,
                }),
            ]);
            const itemInstanceId = result.rows[0]?.item_instance_id || null;
            createdInstances.push({
                item_instance_id: itemInstanceId,
                public_item_instance_id: publicItemInstanceId,
                item_type: itemType,
                item_category: itemCategory,
                from_player_id: actorPlayerId,
                to_player_id: null,
                state: "dropped",
                current_location: "world_drop",
                drop_id: dropId,
            });
            await this.recordItemInstanceEvent(client, {
                item_instance_id: itemInstanceId,
                event_type: "created",
                from_player_id: actorPlayerId,
                to_location: "world_drop",
                world_id: worldId,
                item_transaction_id: itemTransactionId,
                correlation_id: correlationId,
                source,
                metadata: {
                    public_item_instance_id: publicItemInstanceId,
                    item_type: itemType,
                    item_category: itemCategory,
                    action,
                    drop_id: dropId,
                    details,
                },
            });
        }
        return { ok: true, tracked: true, created: createdInstances.length, item_instances: createdInstances };
    }
    /**
     * @param {PixelMania.PostgresInventoryDeltaTransactionEntry} entry
     * @returns {Promise<PixelMania.PostgresInventoryDeltaTransactionResult>}
     */
    async applyInventoryDeltaTransaction(entry = {}) {
        if (!this.isReady()) {
            return InventoryContracts.buildPostgresInventoryDeltaTransactionFailure({ reason: "postgres_unavailable" });
        }
        const e = toObject(entry);
        const username = cleanName(e.account_username || e.username);
        const rawDeltas = Array.isArray(e.deltas) ? e.deltas : [];
        const worldName = cleanName(e.world || "START") || "START";
        const source = normalizeLedgerSource(e.source || e.source_type || e.action || "system");
        const action = cleanName(e.action || e.reason || "update") || "update";
        const reason = cleanName(e.reason || action) || action;
        const requestId = cleanName(e.request_id || "");
        const correlationId = isUuid(cleanName(e.correlation_id || "")) ? cleanName(e.correlation_id || "") : null;
        const at = cleanName(e.at || "");
        const allowStateRepair = Boolean(e.allow_state_repair);
        const strictItemInstances = e.strict_item_instances !== false;
        const playerState = toObject(e.player_state);
        const metadata = safeJson(e.metadata);
        const worldPersistence = normalizeWorldPersistenceMetadata(metadata.world_persistence, toObject(e.world_state));
        const worldState = toObject(e.world_state);
        const worldChanges = Array.isArray(e.world_changes) ? e.world_changes : [];
        const ipAddress = cleanName(e.ip_address || e.ip || "");
        const userAgent = cleanName(e.user_agent || "");
        const sessionTokenHash = cleanName(e.session_token_hash || "");
        const deviceInfo = safeJson(e.device_info);
        if (username === "") {
            return InventoryContracts.buildPostgresInventoryDeltaTransactionFailure({ reason: "invalid_username" });
        }
        const deltasByKey = new Map();
        for (const rawDelta of rawDeltas) {
            const parsed = toObject(rawDelta);
            const itemType = cleanName(parsed.item_type || parsed.item_id || parsed.item || "");
            const itemCategory = cleanName(parsed.item_category || parsed.category || "block") || "block";
            const delta = toInt(parsed.delta, 0);
            if (itemType === "" || itemCategory === "" || delta === 0)
                continue;
            const key = `${itemType}\u0000${itemCategory}`;
            const existing = deltasByKey.get(key) || {
                item_type: itemType,
                item_category: itemCategory,
                delta: 0,
                stack_limit: getInventoryStackLimitForItem(itemType, parsed.stack_limit || DEFAULT_INVENTORY_STACK_LIMIT),
                expected_before_amount: null,
            };
            existing.delta += delta;
            existing.stack_limit = Math.max(existing.stack_limit, getInventoryStackLimitForItem(itemType, parsed.stack_limit || DEFAULT_INVENTORY_STACK_LIMIT));
            const expectedBeforeRaw = Number(parsed.expected_before_amount);
            if (Number.isFinite(expectedBeforeRaw) && expectedBeforeRaw >= 0 && existing.expected_before_amount === null) {
                existing.expected_before_amount = Math.max(0, toInt(expectedBeforeRaw, 0));
            }
            deltasByKey.set(key, existing);
        }
        const deltas = Array.from(deltasByKey.values()).filter((delta) => Number.isFinite(delta.delta) && delta.delta !== 0);
        if (deltas.length === 0
            && Object.keys(playerState).length === 0
            && Object.keys(worldState).length === 0
            && worldChanges.length === 0) {
            return InventoryContracts.buildPostgresInventoryDeltaTransactionSuccess({ ledgerEntries: [] });
        }
        try {
            return await this.withTransaction(async (client) => {
                const playerId = await this.ensurePlayerIdentity(client, username, cleanName(e.email || ""), cleanName(e.actor_role || "player"), worldName);
                if (!playerId) {
                    return InventoryContracts.buildPostgresInventoryDeltaTransactionFailure({ reason: "player_not_found" });
                }
                const worldResult = await client.query(`
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `, [worldName]);
                let worldId = worldResult.rows[0]?.world_id || null;
                const ledgerEntries = [];
                const transactionLedgerEntries = [];
                const inventoryBeforeHash = await this.getInventorySnapshotHash(client, playerId);
                for (const deltaEntry of deltas) {
                    const itemInventory = await client.query(`
            SELECT amount, stack_limit
              FROM ${this.table("inventory")}
             WHERE player_id = $1
               AND item_type = $2
               AND item_category = $3
             FOR UPDATE
            `, [playerId, deltaEntry.item_type, deltaEntry.item_category]);
                    const existing = itemInventory.rows[0];
                    const storedBeforeAmount = Math.max(0, toInt(existing?.amount || 0, 0));
                    let beforeAmount = storedBeforeAmount;
                    let repairedFromAmount = null;
                    const requestedStackLimit = getInventoryStackLimitForItem(deltaEntry.item_type, deltaEntry.stack_limit);
                    const existingStackLimit = clampStackLimit(existing?.stack_limit || requestedStackLimit, requestedStackLimit);
                    const stackLimit = Math.max(existingStackLimit, requestedStackLimit);
                    if (allowStateRepair &&
                        deltaEntry.expected_before_amount !== null &&
                        storedBeforeAmount !== deltaEntry.expected_before_amount) {
                        repairedFromAmount = storedBeforeAmount;
                        beforeAmount = deltaEntry.expected_before_amount;
                    }
                    const afterAmount = beforeAmount + deltaEntry.delta;
                    if (afterAmount < 0) {
                        return InventoryContracts.buildPostgresInventoryDeltaTransactionFailure({
                            reason: "insufficient_inventory",
                            itemType: deltaEntry.item_type,
                            itemCategory: deltaEntry.item_category,
                            beforeAmount,
                            delta: deltaEntry.delta,
                        });
                    }
                    if (afterAmount > stackLimit) {
                        return InventoryContracts.buildPostgresInventoryDeltaTransactionFailure({
                            reason: "insufficient_capacity",
                            itemType: deltaEntry.item_type,
                            itemCategory: deltaEntry.item_category,
                            beforeAmount,
                            afterAmount,
                            stackLimit,
                        });
                    }
                    if (existing) {
                        await client.query(`
              UPDATE ${this.table("inventory")}
                 SET amount = $4,
                     stack_limit = $5,
                     row_version = ${this.table("inventory")}.row_version + 1,
                     updated_at = now()
               WHERE player_id = $1
                 AND item_type = $2
                 AND item_category = $3
              `, [playerId, deltaEntry.item_type, deltaEntry.item_category, afterAmount, stackLimit]);
                    }
                    else {
                        await client.query(`
              INSERT INTO ${this.table("inventory")} (
                player_id,
                item_type,
                item_category,
                amount,
                stack_limit,
                row_version,
                updated_at
              )
              VALUES ($1, $2, $3, $4, $5, 1, now())
              `, [playerId, deltaEntry.item_type, deltaEntry.item_category, afterAmount, stackLimit]);
                    }
                    const itemTransactionResult = await client.query(`
            INSERT INTO ${this.table("item_transactions")} (
              player_id,
              world_id,
              source,
              action,
              item_type,
              item_category,
              delta,
              before_amount,
              after_amount,
              request_id,
              correlation_id,
              metadata,
              created_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              NULLIF($10, ''),
              $11::uuid,
              $12::jsonb,
              COALESCE(NULLIF($13, '')::timestamptz, now())
            )
            RETURNING item_transaction_id
            `, [
                        playerId,
                        worldId,
                        source,
                        action,
                        deltaEntry.item_type,
                        deltaEntry.item_category,
                        deltaEntry.delta,
                        beforeAmount,
                        afterAmount,
                        requestId,
                        correlationId,
                        JSON.stringify({
                            ...metadata,
                            reason,
                            repaired_inventory_before_amount: repairedFromAmount,
                            expected_before_amount: deltaEntry.expected_before_amount,
                        }),
                        at,
                    ]);
                    const itemTransactionId = itemTransactionResult.rows[0]?.item_transaction_id || null;
                    let gemLedgerId = null;
                    const isGemLedgerRow = deltaEntry.item_type === "gem" || deltaEntry.item_category === "currency";
                    if (isGemLedgerRow) {
                        const gemLedgerResult = await client.query(`
              INSERT INTO ${this.table("gem_ledger")} (
                player_id,
                delta,
                reason,
                ref_type,
                ref_id,
                before_balance,
                after_balance,
                metadata,
                created_at
              )
              VALUES (
                $1,
                $2,
                $3,
                NULLIF($4, ''),
                NULLIF($5, ''),
                $6,
                $7,
                $8::jsonb,
                COALESCE(NULLIF($9, '')::timestamptz, now())
              )
              RETURNING gem_ledger_id
              `, [
                            playerId,
                            deltaEntry.delta,
                            reason,
                            source,
                            requestId || cleanName(e.source_id || ""),
                            beforeAmount,
                            afterAmount,
                            JSON.stringify({
                                ...metadata,
                                item_type: deltaEntry.item_type,
                                item_category: deltaEntry.item_category,
                            }),
                            at,
                        ]);
                        gemLedgerId = gemLedgerResult.rows[0]?.gem_ledger_id || null;
                    }
                    const instanceSyncResult = await this.syncItemInstancesForLedger(client, {
                        player_id: playerId,
                        world_id: worldId,
                        item_transaction_id: itemTransactionId,
                        source,
                        action,
                        item_type: deltaEntry.item_type,
                        item_category: deltaEntry.item_category,
                        delta: deltaEntry.delta,
                        after_amount: afterAmount,
                        details: {
                            ...metadata,
                            reason,
                            request_id: requestId,
                            correlation_id: correlationId,
                            repaired_inventory_before_amount: repairedFromAmount,
                            expected_before_amount: deltaEntry.expected_before_amount,
                        },
                        strict_item_instances: strictItemInstances,
                    });
                    if (!instanceSyncResult.ok) {
                        throw makeTrackedItemMovementError(instanceSyncResult);
                    }
                    transactionLedgerEntries.push({
                        transaction_type: normalizeTransactionLedgerType({
                            source,
                            action,
                            item_type: deltaEntry.item_type,
                            item_category: deltaEntry.item_category,
                            delta: deltaEntry.delta,
                        }),
                        player_id: playerId,
                        world_id: worldId,
                        item_transaction_id: itemTransactionId,
                        gem_ledger_id: gemLedgerId,
                        item_type: deltaEntry.item_type,
                        item_category: deltaEntry.item_category,
                        quantity: deltaEntry.delta,
                        gems_before: isGemLedgerRow ? beforeAmount : null,
                        gems_after: isGemLedgerRow ? afterAmount : null,
                        inventory_before_hash: inventoryBeforeHash,
                        request_id: requestId,
                        correlation_id: correlationId,
                        source,
                        action,
                        ip_address: ipAddress,
                        user_agent: userAgent,
                        session_token_hash: sessionTokenHash,
                        device_info: deviceInfo,
                        item_instances: instanceSyncResult.item_instances || [],
                        at,
                        metadata: {
                            ...metadata,
                            reason,
                            repaired_inventory_before_amount: repairedFromAmount,
                            expected_before_amount: deltaEntry.expected_before_amount,
                        },
                    });
                    ledgerEntries.push(InventoryContracts.buildPostgresInventoryLedgerEntry({
                        itemType: deltaEntry.item_type,
                        itemCategory: deltaEntry.item_category,
                        delta: deltaEntry.delta,
                        beforeAmount,
                        afterAmount,
                        stackLimit,
                    }));
                }
                if (Object.keys(playerState).length > 0) {
                    const progression = await this.updatePlayerProgression(client, playerId, playerState);
                    await client.query(`
            UPDATE ${this.table("players")}
               SET player_health = $2,
                   player_state = $3::jsonb,
                   current_world_name = COALESCE(NULLIF($4, ''), current_world_name),
                   updated_at = now()
             WHERE player_id = $1
            `, [
                        playerId,
                        Math.max(0, toInt(playerState.player_health, 100)),
                        JSON.stringify({
                            ...playerState,
                            ...(progression || {}),
                            account_username: username,
                        }),
                        worldName,
                    ]);
                    await this.reconcileItemInstancesForInventory(client, playerId, playerState, {
                        source: source || "inventory_delta",
                        username,
                        action,
                        allow_create_missing: !strictItemInstances,
                        allow_retire_extra: !strictItemInstances,
                    });
                }
                let previousWorldState = {};
                if (Object.keys(worldState).length > 0) {
                    previousWorldState = await this.loadWorldStateForUpdate(client, worldName);
                    const persisted = await this.upsertWorldState(client, worldName, worldState, worldPersistence);
                    if (!persisted.ok || !persisted.world_id) {
                        const persistenceError = new Error(persisted.reason || "world_state_save_failed");
                        persistenceError.code = "PIXELMANIA_WORLD_PERSISTENCE_REJECTED";
                        persistenceError.world_persistence_result = persisted;
                        throw persistenceError;
                    }
                    worldId = persisted.world_id;
                    await this.mirrorWorldLockState(client, worldId, worldState);
                    await this.mirrorWorldAreaLocksState(client, worldId, worldState);
                }
                const hasExplicitObjectChanges = worldChanges.some((change) => this.isWorldObjectChangeEntry(change));
                const inferredObjectChanges = Object.keys(worldState).length > 0 && !hasExplicitObjectChanges
                    ? this.buildWorldObjectChangesFromStateDiff(previousWorldState, worldState, {
                        actor_username: username,
                        actor_role: cleanName(e.actor_role || "player"),
                        source_type: source,
                        source_id: cleanName(e.source_id || requestId || ""),
                        request_id: requestId,
                        world: worldName,
                        action,
                        at,
                        details: {
                            ...metadata,
                            reason,
                            correlation_id: correlationId,
                        },
                    })
                    : [];
                await this.recordWorldChangesAndTrackedDrops(client, worldId, [...worldChanges, ...inferredObjectChanges]);
                if (transactionLedgerEntries.length > 0) {
                    const inventoryAfterHash = await this.getInventorySnapshotHash(client, playerId);
                    await this.updatePlayerInventoryHash(client, playerId, inventoryAfterHash);
                    for (const transactionLedgerEntry of transactionLedgerEntries) {
                        await this.recordTransactionLedger(client, {
                            ...transactionLedgerEntry,
                            inventory_after_hash: inventoryAfterHash,
                        });
                    }
                }
                return InventoryContracts.buildPostgresInventoryDeltaTransactionSuccess({
                    playerId,
                    worldId,
                    ledgerEntries,
                });
            }, action);
        }
        catch (error) {
            const persistenceResult = error?.world_persistence_result;
            if (persistenceResult) {
                return InventoryContracts.buildPostgresInventoryDeltaTransactionFailure({
                    reason: persistenceResult.reason || "world_state_save_failed",
                });
            }
            const trackedErrorResult = resultForTrackedItemMovementError(error);
            if (trackedErrorResult)
                return trackedErrorResult;
            const pgError = postgresError(error);
            this.logger("[postgres] inventory delta transaction failed:", {
                message: pgError.message,
                code: pgError.code || "",
                constraint: pgError.constraint || "",
                detail: pgError.detail || "",
                source,
                action,
                reason,
                username,
                world: worldName,
                deltas: deltas.map((delta) => ({
                    item_type: delta.item_type,
                    item_category: delta.item_category,
                    delta: delta.delta,
                })),
            });
            return InventoryContracts.buildPostgresInventoryDeltaTransactionFailure({
                reason: "database_error",
                message: getErrorMessage(error),
            });
        }
    }
    mirrorItemLedger(entry) {
        if (!this.isReady())
            return;
        const e = toObject(entry);
        const username = cleanName(e.account_username);
        const itemType = cleanName(e.item_id);
        const itemCategory = cleanName(e.item_category);
        if (username === "" || itemType === "")
            return;
        this.runDetached("mirror item ledger", async () => {
            await this.withTransaction(async (client) => {
                const playerId = await this.ensurePlayerIdentity(client, username, "", cleanName(e.actor_role || "player"), cleanName(e.world || ""));
                if (!playerId)
                    return;
                const worldIdResult = await client.query(`
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `, [cleanName(e.world || "START") || "START"]);
                const worldId = worldIdResult.rows[0]?.world_id || null;
                const itemTransactionResult = await client.query(`
          INSERT INTO ${this.table("item_transactions")} (
            player_id,
            world_id,
            source,
            action,
            item_type,
            item_category,
            delta,
            after_amount,
            request_id,
            metadata,
            created_at
          )
          VALUES (
            $1,
            $2,
            COALESCE(NULLIF($3, ''), 'system'),
            COALESCE(NULLIF($4, ''), 'update'),
            $5,
            $6,
            $7,
            $8,
            NULLIF($9, ''),
            $10::jsonb,
            COALESCE(NULLIF($11, '')::timestamptz, now())
          )
          RETURNING item_transaction_id
          `, [
                    playerId,
                    worldId,
                    normalizeLedgerSource(e.source_type || "system"),
                    cleanName(e.reason || "update"),
                    itemType,
                    itemCategory || "block",
                    toInt(e.quantity_delta, 0),
                    Math.max(0, toInt(e.balance_after, 0)),
                    cleanName(e.source_id || ""),
                    JSON.stringify(safeJson(e.details)),
                    cleanName(e.at || ""),
                ]);
                const itemTransactionId = itemTransactionResult.rows[0]?.item_transaction_id || null;
                await client.query(`
          INSERT INTO ${this.table("inventory")} (
            player_id,
            item_type,
            item_category,
            amount,
            stack_limit,
            row_version,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, 0, now())
          ON CONFLICT (player_id, item_type, item_category) DO UPDATE
            SET amount = EXCLUDED.amount,
                stack_limit = GREATEST(${this.table("inventory")}.stack_limit, EXCLUDED.stack_limit),
                row_version = ${this.table("inventory")}.row_version + 1,
                updated_at = now()
          `, [
                    playerId,
                    itemType,
                    itemCategory || "block",
                    Math.max(0, toInt(e.balance_after, 0)),
                    getInventoryStackLimitForItem(itemType, e.stack_limit || DEFAULT_INVENTORY_STACK_LIMIT),
                ]);
                await this.syncItemInstancesForLedger(client, {
                    player_id: playerId,
                    world_id: worldId,
                    item_transaction_id: itemTransactionId,
                    source: normalizeLedgerSource(e.source_type || "system"),
                    action: cleanName(e.reason || "update"),
                    item_type: itemType,
                    item_category: itemCategory || "block",
                    delta: toInt(e.quantity_delta, 0),
                    after_amount: Math.max(0, toInt(e.balance_after, 0)),
                    details: safeJson(e.details),
                });
            });
        });
    }
    mirrorGemLedger(entry) {
        if (!this.isReady())
            return;
        const e = toObject(entry);
        const username = cleanName(e.account_username);
        if (username === "")
            return;
        this.runDetached("mirror gem ledger", async () => {
            await this.withTransaction(async (client) => {
                const playerId = await this.ensurePlayerIdentity(client, username);
                if (!playerId)
                    return;
                await client.query(`
          INSERT INTO ${this.table("gem_ledger")} (
            player_id,
            delta,
            reason,
            ref_type,
            ref_id,
            after_balance,
            metadata,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3,
            NULLIF($4, ''),
            NULLIF($5, ''),
            $6,
            $7::jsonb,
            COALESCE(NULLIF($8, '')::timestamptz, now())
          )
          `, [
                    playerId,
                    toInt(e.quantity_delta, 0),
                    cleanName(e.reason || "update") || "update",
                    cleanName(e.source_type || ""),
                    cleanName(e.source_id || ""),
                    Math.max(0, toInt(e.balance_after, 0)),
                    JSON.stringify(safeJson(e.details)),
                    cleanName(e.at || ""),
                ]);
            });
        });
    }
    mirrorShopPurchase(entry) {
        if (!this.isReady())
            return;
        const e = toObject(entry);
        const username = cleanName(e.account_username);
        if (username === "")
            return;
        const rewards = Array.isArray(e.rewards) ? e.rewards : [];
        const matchedReward = rewards.find((reward) => cleanName(reward?.item_id || "") === cleanName(e.item_id || ""));
        const itemCategory = cleanName(matchedReward?.item_category || "block") || "block";
        const amount = Math.max(1, toInt(matchedReward?.amount, 1));
        this.runDetached("mirror shop purchase", async () => {
            await this.withTransaction(async (client) => {
                const playerId = await this.ensurePlayerIdentity(client, username);
                if (!playerId)
                    return;
                await client.query(`
          INSERT INTO ${this.table("shop_purchases")} (
            player_id,
            shop_id,
            item_type,
            item_category,
            amount,
            price_currency_type,
            price_amount,
            request_id,
            metadata,
            created_at
          )
          VALUES (
            $1,
            COALESCE(NULLIF($2, ''), 'main_shop'),
            NULLIF($3, ''),
            NULLIF($4, ''),
            $5,
            'gem',
            $6,
            NULLIF($7, ''),
            $8::jsonb,
            COALESCE(NULLIF($9, '')::timestamptz, now())
          )
          `, [
                    playerId,
                    cleanName(e.listing_id || "main_shop"),
                    cleanName(e.item_id || ""),
                    itemCategory,
                    amount,
                    Math.max(0, toInt(e.price_gems, 0)),
                    cleanName(e.purchase_id || ""),
                    JSON.stringify({ rewards }),
                    cleanName(e.at || ""),
                ]);
            });
        });
    }
    mirrorTradeTransaction(entry) {
        if (!this.isReady())
            return;
        const e = toObject(entry);
        const requester = cleanName(e.requester_username);
        const target = cleanName(e.target_username);
        if (requester === "" || target === "")
            return;
        this.runDetached("mirror trade", async () => {
            await this.withTransaction(async (client) => {
                const requesterId = await this.ensurePlayerIdentity(client, requester);
                const targetId = await this.ensurePlayerIdentity(client, target);
                if (!requesterId || !targetId)
                    return;
                const worldName = cleanName(e.world || "START") || "START";
                const worldResult = await client.query(`
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `, [worldName]);
                const worldId = worldResult.rows[0]?.world_id || null;
                const tradeIdCandidate = cleanName(e.trade_id || "");
                const tradeIdUuid = isUuid(tradeIdCandidate) ? tradeIdCandidate : null;
                const tradeResult = await client.query(`
          INSERT INTO ${this.table("trades")} (
            trade_id,
            world_id,
            player_a_id,
            player_b_id,
            initiated_by_player_id,
            status,
            created_at,
            updated_at
          )
          VALUES (
            COALESCE($1::uuid, gen_random_uuid()),
            $2,
            $3,
            $4,
            $3,
            COALESCE(NULLIF($5, ''), 'completed'),
            COALESCE(NULLIF($6, '')::timestamptz, now()),
            now()
          )
          ON CONFLICT (trade_id) DO UPDATE
            SET status = EXCLUDED.status,
                updated_at = now()
          RETURNING trade_id
          `, [
                    tradeIdUuid,
                    worldId,
                    requesterId,
                    targetId,
                    cleanName(e.status || "completed"),
                    cleanName(e.at || ""),
                ]);
                const tradeId = tradeResult.rows[0]?.trade_id;
                if (!tradeId)
                    return;
                await client.query(`DELETE FROM ${this.table("trade_items")} WHERE trade_id = $1`, [tradeId]);
                const requesterOffer = Array.isArray(e.requester_offer) ? e.requester_offer : [];
                const targetOffer = Array.isArray(e.target_offer) ? e.target_offer : [];
                for (let slot = 0; slot < requesterOffer.length; slot += 1) {
                    const item = toObject(requesterOffer[slot]);
                    const itemId = cleanName(item.item_id);
                    if (itemId === "")
                        continue;
                    await client.query(`
            INSERT INTO ${this.table("trade_items")} (
              trade_id,
              from_player_id,
              slot_index,
              item_type,
              item_category,
              amount
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            `, [tradeId, requesterId, slot, itemId, cleanName(item.item_category || "block"), Math.max(1, toInt(item.amount, 1))]);
                }
                for (let slot = 0; slot < targetOffer.length; slot += 1) {
                    const item = toObject(targetOffer[slot]);
                    const itemId = cleanName(item.item_id);
                    if (itemId === "")
                        continue;
                    await client.query(`
            INSERT INTO ${this.table("trade_items")} (
              trade_id,
              from_player_id,
              slot_index,
              item_type,
              item_category,
              amount
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            `, [tradeId, targetId, slot, itemId, cleanName(item.item_category || "block"), Math.max(1, toInt(item.amount, 1))]);
                }
            });
        });
    }
    mirrorVendingTransaction(entry) {
        if (!this.isReady())
            return;
        const e = toObject(entry);
        const owner = cleanName(e.owner_username);
        if (owner === "")
            return;
        this.runDetached("mirror vending", async () => {
            await this.withTransaction(async (client) => {
                const ownerId = await this.ensurePlayerIdentity(client, owner);
                if (!ownerId)
                    return;
                const buyerId = cleanName(e.buyer_username) !== "" ? await this.ensurePlayerIdentity(client, cleanName(e.buyer_username)) : null;
                const worldName = cleanName(e.world || "START") || "START";
                const worldResult = await client.query(`
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `, [worldName]);
                const worldId = worldResult.rows[0]?.world_id;
                if (!worldId)
                    return;
                const amount = Math.max(0, toInt(e.amount, 0));
                const itemId = cleanName(e.item_id || "");
                if (amount <= 0 || itemId === "")
                    return;
                await client.query(`
          INSERT INTO ${this.table("vending_transactions")} (
            world_id,
            vend_owner_player_id,
            buyer_player_id,
            block_x,
            block_y,
            item_type,
            item_category,
            amount,
            price_gems,
            total_gems,
            request_id,
            metadata,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            NULLIF($6, ''),
            NULLIF($7, ''),
            $8,
            $9,
            $10,
            NULLIF($11, ''),
            $12::jsonb,
            COALESCE(NULLIF($13, '')::timestamptz, now())
          )
          `, [
                    worldId,
                    ownerId,
                    buyerId,
                    toInt(e.x, 0),
                    toInt(e.y, 0),
                    itemId,
                    cleanName(e.item_category || "block"),
                    amount,
                    Math.max(0, toInt(e.price_wls, 0)),
                    Math.max(0, toInt(e.price_wls, 0) * amount),
                    cleanName(e.transaction_id || ""),
                    JSON.stringify({
                        action: cleanName(e.action || ""),
                        stock_after: Math.max(0, toInt(e.stock_after, 0)),
                        pending_wls_after: Math.max(0, toInt(e.pending_wls_after, 0)),
                        details: safeJson(e.details),
                    }),
                    cleanName(e.at || ""),
                ]);
            });
        });
    }
    /**
     * @param {PixelMania.PostgresDropPickupTransactionEntry} entry
     * @returns {Promise<PixelMania.PostgresDropPickupResult>}
     */
    async applyDropPickupTransaction(entry = {}) {
        if (!this.isReady()) {
            return DropContracts.buildPostgresDropPickupFailure({ reason: "postgres_unavailable" });
        }
        const e = toObject(entry);
        const username = cleanName(e.account_username);
        const itemType = cleanName(e.item_type);
        const itemCategory = cleanName(e.item_category || "block");
        const amount = toInt(e.amount, 0);
        const expectedBeforeRaw = Number(e.expected_before_amount);
        const hasExpectedBefore = Number.isFinite(expectedBeforeRaw) && expectedBeforeRaw >= 0;
        const expectedBeforeAmount = hasExpectedBefore ? Math.max(0, toInt(expectedBeforeRaw, 0)) : 0;
        const expectedDropBeforeRaw = Number(e.expected_drop_before_amount);
        const hasExpectedDropBefore = Number.isFinite(expectedDropBeforeRaw) && expectedDropBeforeRaw >= 0;
        const expectedDropBeforeAmount = hasExpectedDropBefore
            ? Math.max(0, toInt(expectedDropBeforeRaw, 0))
            : 0;
        const requestedStackLimit = getInventoryStackLimitForItem(itemType, e.stack_limit || DEFAULT_INVENTORY_STACK_LIMIT);
        const allowStateRepair = Boolean(e.allow_state_repair);
        const allowWorldDropRepair = Boolean(e.allow_world_drop_repair);
        const requestId = cleanName(e.request_id);
        const worldName = cleanName(e.world || "START") || "START";
        const dropId = cleanName(e.drop_id || "");
        const sourceId = cleanName(e.source_id || "");
        const at = cleanName(e.at || "");
        const correlationId = isUuid(cleanName(e.correlation_id || "")) ? cleanName(e.correlation_id || "") : null;
        const ipAddress = cleanName(e.ip_address || e.ip || "");
        const userAgent = cleanName(e.user_agent || "");
        const sessionTokenHash = cleanName(e.session_token_hash || "");
        const deviceInfo = safeJson(e.device_info);
        const worldState = toObject(e.world_state);
        const worldChanges = Array.isArray(e.world_changes) ? e.world_changes : [];
        const worldPersistence = normalizeWorldPersistenceMetadata(e.world_persistence, worldState);
        if (username === "" || itemType === "" || amount <= 0 || dropId === "") {
            return DropContracts.buildPostgresDropPickupFailure({ reason: "invalid_payload" });
        }
        try {
            return await this.withTransaction(async (client) => {
                const playerId = await this.ensurePlayerIdentity(client, username);
                if (!playerId)
                    return DropContracts.buildPostgresDropPickupFailure({ reason: "player_not_found" });
                const worldResult = await client.query(`
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `, [worldName]);
                const worldId = worldResult.rows[0]?.world_id || null;
                let worldDropRows = await client.query(`
          SELECT drop_id,
                 item_type,
                 item_category,
                 amount,
                 status,
                 x,
                 y,
                 stack_grid_x,
                 stack_grid_y,
                 pickup_delay,
                 metadata
            FROM ${this.table("world_drops")}
           WHERE world_id = $1
             AND drop_id = $2
           FOR UPDATE
          `, [worldId, dropId]);
                if ((worldDropRows.rowCount ?? 0) === 0 && Boolean(e.allow_world_drop_repair)) {
                    const repairedDropAmount = Math.max(amount, toInt(e.drop_amount || e.drop_before_amount || amount, amount));
                    await this.upsertWorldDropRow(client, worldId, {
                        drop_id: dropId,
                        item_type: itemType,
                        item_category: itemCategory,
                        amount: repairedDropAmount,
                        x: e.drop_x,
                        y: e.drop_y,
                        stack_grid_x: e.stack_grid_x,
                        stack_grid_y: e.stack_grid_y,
                        pickup_delay: e.pickup_delay,
                    }, {
                        source: "drop_pickup_repair",
                        action: "repair_before_pickup",
                        source_id: sourceId,
                        metadata: {
                            request_id: requestId,
                            repaired_from_live_world_state: true,
                        },
                    });
                    worldDropRows = await client.query(`
            SELECT drop_id,
                   item_type,
                   item_category,
                   amount,
                   status,
                   x,
                   y,
                   stack_grid_x,
                   stack_grid_y,
                   pickup_delay,
                   metadata
              FROM ${this.table("world_drops")}
             WHERE world_id = $1
               AND drop_id = $2
             FOR UPDATE
            `, [worldId, dropId]);
                }
                if ((worldDropRows.rowCount ?? 0) === 0) {
                    // The authoritative drop row is absent, not collected. Report that
                    // explicitly so callers keep the live world drop instead of destroying it.
                    return DropContracts.buildPostgresDropPickupFailure({
                        reason: "drop_not_available",
                        drop_id: dropId,
                        drop_status: "missing",
                        available_amount: 0,
                    });
                }
                const worldDrop = worldDropRows.rows[0] || {};
                const dropBeforeAmount = Math.max(0, toInt(worldDrop.amount, 0));
                const dropItemType = cleanName(worldDrop.item_type || "");
                const dropItemCategory = resolveItemCategory(dropItemType, worldDrop.item_category || "");
                const dropRowStatus = cleanName(worldDrop.status || "active") || "active";
                if (dropRowStatus !== "active" || dropBeforeAmount <= 0) {
                    return DropContracts.buildPostgresDropPickupFailure({
                        reason: "drop_not_available",
                        drop_id: dropId,
                        // An 'active' row that is drained to zero was fully collected by someone.
                        drop_status: dropRowStatus === "active" ? "picked_up" : dropRowStatus,
                        available_amount: dropBeforeAmount,
                    });
                }
                if (dropItemType !== itemType || dropItemCategory !== itemCategory) {
                    return DropContracts.buildPostgresDropPickupFailure({
                        reason: "drop_changed",
                        drop_id: dropId,
                        drop_status: dropRowStatus,
                        available_amount: dropBeforeAmount,
                        item_type: dropItemType,
                        item_category: dropItemCategory,
                    });
                }
                if (hasExpectedDropBefore && dropBeforeAmount !== expectedDropBeforeAmount) {
                    return DropContracts.buildPostgresDropPickupFailure({
                        reason: "drop_amount_changed",
                        drop_id: dropId,
                        drop_status: dropRowStatus,
                        available_amount: dropBeforeAmount,
                        requested_amount: amount,
                    });
                }
                if (dropBeforeAmount < amount) {
                    return DropContracts.buildPostgresDropPickupFailure({
                        reason: "drop_amount_changed",
                        drop_id: dropId,
                        drop_status: dropRowStatus,
                        available_amount: dropBeforeAmount,
                        requested_amount: amount,
                    });
                }
                const dropAfterAmount = Math.max(0, dropBeforeAmount - amount);
                const inventoryBeforeHash = await this.getInventorySnapshotHash(client, playerId);
                const itemInventory = await client.query(`
          SELECT amount, stack_limit
            FROM ${this.table("inventory")}
           WHERE player_id = $1
             AND item_type = $2
             AND item_category = $3
           FOR UPDATE
          `, [playerId, itemType, itemCategory]);
                const existing = itemInventory.rows[0];
                const storedBeforeAmount = Math.max(0, toInt(existing?.amount || 0, 0));
                let beforeAmount = storedBeforeAmount;
                let repairedFromAmount = null;
                const existingStackLimit = clampStackLimit(existing?.stack_limit || requestedStackLimit, requestedStackLimit);
                const stackLimit = Math.max(existingStackLimit, requestedStackLimit);
                if (allowStateRepair && hasExpectedBefore && storedBeforeAmount !== expectedBeforeAmount) {
                    repairedFromAmount = storedBeforeAmount;
                    beforeAmount = expectedBeforeAmount;
                }
                const afterAmount = beforeAmount + amount;
                if (!existing && amount > stackLimit) {
                    return DropContracts.buildPostgresDropPickupFailure({ reason: "insufficient_capacity" });
                }
                if (afterAmount > stackLimit) {
                    return DropContracts.buildPostgresDropPickupFailure({ reason: "insufficient_capacity" });
                }
                await client.query(`
          UPDATE ${this.table("world_drops")}
             SET amount = $3::bigint,
                 status = CASE WHEN $3::bigint <= 0 THEN 'picked_up' ELSE 'active' END,
                 picked_by_player_id = CASE WHEN $3::bigint <= 0 THEN $4::uuid ELSE picked_by_player_id END,
                 picked_at = CASE WHEN $3::bigint <= 0 THEN now() ELSE picked_at END,
                 metadata = metadata || $5::jsonb,
                 updated_at = now()
           WHERE world_id = $1
             AND drop_id = $2
          `, [
                    worldId,
                    dropId,
                    dropAfterAmount,
                    playerId,
                    JSON.stringify({
                        source: "drop_pickup",
                        action: "pickup",
                        item_type: itemType,
                        item_category: itemCategory,
                        picked_amount: amount,
                        before_amount: dropBeforeAmount,
                        after_amount: dropAfterAmount,
                        request_id: requestId,
                        source_id: sourceId,
                    }),
                ]);
                if (existing) {
                    await client.query(`
            UPDATE ${this.table("inventory")}
               SET amount = $4,
                   stack_limit = $5,
                   row_version = ${this.table("inventory")}.row_version + 1,
                   updated_at = now()
             WHERE player_id = $1
               AND item_type = $2
               AND item_category = $3
            `, [playerId, itemType, itemCategory, afterAmount, stackLimit]);
                }
                else {
                    await client.query(`
            INSERT INTO ${this.table("inventory")} (
              player_id,
              item_type,
              item_category,
              amount,
              stack_limit,
              row_version,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, 1, now())
            `, [playerId, itemType, itemCategory, afterAmount, stackLimit]);
                }
                const pickupTransactionResult = await client.query(`
          INSERT INTO ${this.table("item_transactions")} (
            player_id,
            world_id,
            source,
            action,
            item_type,
            item_category,
            delta,
            before_amount,
            after_amount,
            request_id,
            correlation_id,
            metadata,
            created_at
          )
          VALUES (
            $1,
            $2,
            'drop_pickup',
            'pickup',
            $3,
            $4,
            $5,
            $6,
            $7,
            NULLIF($8, ''),
            $9::uuid,
            $10::jsonb,
            COALESCE(NULLIF($11, '')::timestamptz, now())
          )
          RETURNING item_transaction_id
          `, [
                    playerId,
                    worldId,
                    itemType,
                    itemCategory || "block",
                    amount,
                    beforeAmount,
                    afterAmount,
                    requestId,
                    correlationId,
                    JSON.stringify({
                        drop_id: dropId,
                        drop_before_amount: dropBeforeAmount,
                        drop_after_amount: dropAfterAmount,
                        repaired_inventory_before_amount: repairedFromAmount,
                        expected_before_amount: hasExpectedBefore ? expectedBeforeAmount : null,
                    }),
                    at,
                ]);
                const pickupTransactionId = pickupTransactionResult.rows[0]?.item_transaction_id || null;
                let gemLedgerId = null;
                const isGemPickup = itemType === "gem" || itemCategory === "currency";
                if (isGemPickup) {
                    const gemLedgerResult = await client.query(`
            INSERT INTO ${this.table("gem_ledger")} (
              player_id,
              delta,
              reason,
              ref_type,
              ref_id,
              before_balance,
              after_balance,
              metadata,
              created_at
            )
            VALUES (
              $1,
              $2,
              'drop_pickup',
              'drop_pickup',
              NULLIF($3, ''),
              $4,
              $5,
              $6::jsonb,
              COALESCE(NULLIF($7, '')::timestamptz, now())
            )
            RETURNING gem_ledger_id
            `, [
                        playerId,
                        amount,
                        dropId || requestId || sourceId,
                        beforeAmount,
                        afterAmount,
                        JSON.stringify({
                            drop_id: dropId,
                            source_id: sourceId,
                            request_id: requestId,
                            drop_before_amount: dropBeforeAmount,
                            drop_after_amount: dropAfterAmount,
                            item_type: itemType,
                            item_category: itemCategory,
                            repaired_inventory_before_amount: repairedFromAmount,
                            expected_before_amount: hasExpectedBefore ? expectedBeforeAmount : null,
                        }),
                        at,
                    ]);
                    gemLedgerId = gemLedgerResult.rows[0]?.gem_ledger_id || null;
                }
                let dropClaimResult = await this.claimTrackedWorldDropItemInstances(client, {
                    to_player_id: playerId,
                    world_id: worldId,
                    item_transaction_id: pickupTransactionId,
                    correlation_id: correlationId,
                    source: "world_drop",
                    action: "pickup",
                    item_type: itemType,
                    item_category: itemCategory || "block",
                    amount,
                    drop_id: dropId,
                    details: {
                        drop_id: dropId,
                        source_id: sourceId,
                        request_id: requestId,
                        drop_before_amount: dropBeforeAmount,
                        drop_after_amount: dropAfterAmount,
                        repaired_inventory_before_amount: repairedFromAmount,
                        expected_before_amount: hasExpectedBefore ? expectedBeforeAmount : null,
                    },
                });
                if (!dropClaimResult.ok && dropClaimResult.reason === "missing_world_drop_item_instances") {
                    // The visible drop exists but its tracked identity does not. Rebuilding is
                    // only safe when the authoritative drop row proves the server minted this
                    // drop AND no instance anywhere still carries this drop id. Anything else is
                    // quarantined: the drop stays in the world and no item is invented.
                    const dropRowMetadata = toObject(worldDrop.metadata);
                    const dropOriginSource = cleanName(dropRowMetadata.origin_source || "");
                    const dropOriginAction = cleanName(dropRowMetadata.origin_action || "");
                    const serverAuthoredDrop = isServerAuthoredWorldDropOrigin(dropOriginSource, dropOriginAction);
                    const orphanedInstanceRows = await client.query(`
            SELECT count(*)::integer AS instance_count
              FROM ${this.table("item_instances")}
             WHERE item_type = $1
               AND item_category = $2
               AND ($3::uuid IS NULL OR world_id = $3::uuid)
               AND (
                 metadata->>'drop_id' = $4
                 OR metadata #>> '{details,drop_id}' = $4
                 OR metadata #>> '{details,details,drop_id}' = $4
               )
            `, [itemType, itemCategory || "block", worldId, dropId]);
                    const knownInstanceCount = Math.max(0, toInt(orphanedInstanceRows.rows[0]?.instance_count, 0));
                    if (!allowWorldDropRepair || !serverAuthoredDrop || knownInstanceCount > 0) {
                        throw makeTrackedItemMovementError({
                            ok: false,
                            tracked: true,
                            reason: "world_drop_item_instances_pending",
                            item_type: itemType,
                            item_category: itemCategory || "block",
                            drop_id: dropId,
                            required_instances: amount,
                            available_instances: toInt(dropClaimResult.available_instances, 0),
                            known_instances: knownInstanceCount,
                            drop_origin_source: dropOriginSource,
                            drop_origin_action: dropOriginAction,
                            server_authored_drop: serverAuthoredDrop,
                            message: "That drop is not ready to collect yet.",
                        });
                    }
                }
                if (!dropClaimResult.ok) {
                    if (allowWorldDropRepair && dropClaimResult.reason === "missing_world_drop_item_instances") {
                        const dropRepairResult = await this.createTrackedWorldDropItemInstances(client, {
                            world_id: worldId,
                            source: "world_drop",
                            action: "pickup_repair",
                            item_type: itemType,
                            item_category: itemCategory || "block",
                            amount,
                            drop_id: dropId,
                            details: {
                                source_id: sourceId,
                                request_id: requestId,
                                drop_id: dropId,
                                drop_before_amount: dropBeforeAmount,
                                drop_after_amount: dropAfterAmount,
                                repaired_inventory_before_amount: repairedFromAmount,
                                expected_before_amount: hasExpectedBefore ? expectedBeforeAmount : null,
                                pickup_repair: true,
                            },
                        });
                        if (!dropRepairResult.ok) {
                            throw makeTrackedItemMovementError(dropRepairResult);
                        }
                        dropClaimResult = await this.claimTrackedWorldDropItemInstances(client, {
                            to_player_id: playerId,
                            world_id: worldId,
                            item_transaction_id: pickupTransactionId,
                            correlation_id: correlationId,
                            source: "world_drop",
                            action: "pickup",
                            item_type: itemType,
                            item_category: itemCategory || "block",
                            amount,
                            drop_id: dropId,
                            details: {
                                drop_id: dropId,
                                source_id: sourceId,
                                request_id: requestId,
                                drop_before_amount: dropBeforeAmount,
                                drop_after_amount: dropAfterAmount,
                                repaired_inventory_before_amount: repairedFromAmount,
                                expected_before_amount: hasExpectedBefore ? expectedBeforeAmount : null,
                            },
                        });
                    }
                }
                if (!dropClaimResult.ok) {
                    throw makeTrackedItemMovementError(dropClaimResult);
                }
                let pickedUpItemInstances = dropClaimResult.item_instances || [];
                if (!dropClaimResult.tracked) {
                    const instanceSyncResult = await this.syncItemInstancesForLedger(client, {
                        player_id: playerId,
                        world_id: worldId,
                        item_transaction_id: pickupTransactionId,
                        source: "drop_pickup",
                        action: "pickup",
                        item_type: itemType,
                        item_category: itemCategory || "block",
                        delta: amount,
                        after_amount: afterAmount,
                        details: {
                            drop_id: dropId,
                            source_id: sourceId,
                            request_id: requestId,
                            drop_before_amount: dropBeforeAmount,
                            drop_after_amount: dropAfterAmount,
                            repaired_inventory_before_amount: repairedFromAmount,
                            expected_before_amount: hasExpectedBefore ? expectedBeforeAmount : null,
                        },
                    });
                    if (!instanceSyncResult.ok) {
                        throw makeTrackedItemMovementError(instanceSyncResult);
                    }
                    pickedUpItemInstances = instanceSyncResult.item_instances || [];
                }
                const inventoryAfterHash = await this.getInventorySnapshotHash(client, playerId);
                await this.updatePlayerInventoryHash(client, playerId, inventoryAfterHash);
                await this.recordTransactionLedger(client, {
                    transaction_type: "ITEM_PICKUP",
                    player_id: playerId,
                    world_id: worldId,
                    item_transaction_id: pickupTransactionId,
                    gem_ledger_id: gemLedgerId,
                    item_type: itemType,
                    item_category: itemCategory || "block",
                    quantity: amount,
                    gems_before: isGemPickup ? beforeAmount : null,
                    gems_after: isGemPickup ? afterAmount : null,
                    inventory_before_hash: inventoryBeforeHash,
                    inventory_after_hash: inventoryAfterHash,
                    request_id: requestId,
                    correlation_id: correlationId,
                    source: "drop_pickup",
                    action: "pickup",
                    ip_address: ipAddress,
                    user_agent: userAgent,
                    session_token_hash: sessionTokenHash,
                    device_info: deviceInfo,
                    item_instances: pickedUpItemInstances,
                    at,
                    metadata: {
                        drop_id: dropId,
                        source_id: sourceId,
                        drop_before_amount: dropBeforeAmount,
                        drop_after_amount: dropAfterAmount,
                        repaired_inventory_before_amount: repairedFromAmount,
                        expected_before_amount: hasExpectedBefore ? expectedBeforeAmount : null,
                    },
                });
                let persistedWorld = null;
                if (Object.keys(worldState).length > 0) {
                    const previousWorldState = await this.loadWorldStateForUpdate(client, worldName);
                    persistedWorld = await this.upsertWorldState(client, worldName, worldState, worldPersistence);
                    if (!persistedWorld.ok || !persistedWorld.world_id) {
                        const persistenceError = new Error(persistedWorld.reason || "world_state_save_failed");
                        persistenceError.code = "PIXELMANIA_WORLD_PERSISTENCE_REJECTED";
                        persistenceError.world_persistence_result = persistedWorld;
                        throw persistenceError;
                    }
                    await this.mirrorWorldLockState(client, persistedWorld.world_id, worldState);
                    await this.mirrorWorldAreaLocksState(client, persistedWorld.world_id, worldState);
                    const hasExplicitObjectChanges = worldChanges.some((change) => this.isWorldObjectChangeEntry(change));
                    const inferredObjectChanges = hasExplicitObjectChanges
                        ? []
                        : this.buildWorldObjectChangesFromStateDiff(previousWorldState, worldState, {
                            actor_username: username,
                            source_type: "world_item_drop_pickup",
                            source_id: sourceId,
                            request_id: requestId,
                            world: worldName,
                            action: "drop_pickup",
                            at,
                        });
                    await this.recordWorldChangesAndTrackedDrops(client, persistedWorld.world_id, [...worldChanges, ...inferredObjectChanges]);
                }
                return DropContracts.buildPostgresDropPickupSuccess({
                    before_amount: beforeAmount,
                    after_amount: afterAmount,
                    item_type: itemType,
                    item_category: itemCategory,
                    repaired_inventory_before_amount: repairedFromAmount,
                    drop_before_amount: dropBeforeAmount,
                    drop_after_amount: dropAfterAmount,
                    item_instances: pickedUpItemInstances,
                    persisted_revision: normalizeWorldRevision(persistedWorld?.persisted_revision),
                });
            });
        }
        catch (error) {
            const persistenceResult = error?.world_persistence_result;
            if (persistenceResult) {
                return DropContracts.buildPostgresDropPickupFailure({
                    reason: persistenceResult.reason || "world_state_save_failed",
                    persisted_revision: persistenceResult.persisted_revision,
                });
            }
            const trackedErrorResult = resultForTrackedItemMovementError(error);
            if (trackedErrorResult) {
                const trackedReason = cleanName(trackedErrorResult.reason || "tracked_item_instance_movement_failed");
                if (trackedReason === "world_drop_item_instances_pending") {
                    // Anomaly, not a normal rejection: the world drop is authoritative but its
                    // tracked identity is unusable. The whole transaction rolled back, so the
                    // drop is still collectible once its tracked rows land or an admin repairs it.
                    this.logger("[postgres] drop_pickup quarantined: tracked drop identity unusable", {
                        username,
                        world: worldName,
                        drop_id: dropId,
                        item_type: itemType,
                        item_category: itemCategory,
                        requested_amount: amount,
                        available_instances: toInt(trackedErrorResult.available_instances, 0),
                        known_instances: toInt(trackedErrorResult.known_instances, 0),
                        drop_origin_source: cleanName(trackedErrorResult.drop_origin_source || ""),
                        drop_origin_action: cleanName(trackedErrorResult.drop_origin_action || ""),
                        server_authored_drop: Boolean(trackedErrorResult.server_authored_drop),
                        request_id: requestId,
                        source_id: sourceId,
                    });
                }
                return DropContracts.buildPostgresDropPickupFailure({
                    reason: trackedReason,
                    drop_id: dropId,
                    // The transaction rolled back: the drop row is untouched and still active.
                    drop_status: "active",
                    item_instances: Array.isArray(trackedErrorResult.item_instances) ? trackedErrorResult.item_instances : [],
                    message: cleanName(trackedErrorResult.message || ""),
                });
            }
            const pgError = postgresError(error);
            this.logger("[postgres] drop_pickup transaction failed:", pgError.message, {
                code: pgError.code || "",
                schema: pgError.schema || "",
                table: pgError.table || "",
                column: pgError.column || "",
                constraint: pgError.constraint || "",
                detail: pgError.detail || "",
                username,
                world: worldName,
                drop_id: dropId,
                item_type: itemType,
                item_category: itemCategory,
                request_id: requestId,
                source_id: sourceId,
            });
            return DropContracts.buildPostgresDropPickupFailure({
                reason: "database_error",
                message: getErrorMessage(error),
            });
        }
    }
    async applyTradeFinalizationTransaction(entry = {}) {
        if (!this.isReady()) {
            return { ok: false, reason: "postgres_unavailable" };
        }
        const e = toObject(entry);
        const requester = cleanName(e.requester_username);
        const target = cleanName(e.target_username);
        const tradeIdRaw = cleanName(e.trade_id || "");
        const tradeIdUuid = isUuid(tradeIdRaw) ? tradeIdRaw : null;
        const worldName = cleanName(e.world || "START") || "START";
        const requestId = cleanName(e.request_id);
        const at = cleanName(e.at || "");
        const allowStateRepair = Boolean(e.allow_state_repair);
        const ipAddress = cleanName(e.ip_address || e.ip || "");
        const userAgent = cleanName(e.user_agent || "");
        const sessionTokenHash = cleanName(e.session_token_hash || "");
        const deviceInfo = safeJson(e.device_info);
        const requesterOffers = Array.isArray(e.requester_offers) ? e.requester_offers : [];
        const targetOffers = Array.isArray(e.target_offers) ? e.target_offers : [];
        if (requester === "" || target === "") {
            return { ok: false, reason: "invalid_payload" };
        }
        const sanitizeOfferEntries = (offerItems) => {
            const result = [];
            const entries = Array.isArray(offerItems) ? offerItems : [];
            for (const item of entries) {
                const parsed = toObject(item);
                const itemType = cleanName(parsed.item_id || "");
                const itemCategory = cleanName(parsed.item_category || "block");
                const amount = toInt(parsed.amount, 0);
                if (itemType === "" || amount <= 0)
                    continue;
                result.push({ item_id: itemType, item_category: itemCategory, amount });
            }
            return result;
        };
        const normalizedRequesterOffers = sanitizeOfferEntries(requesterOffers);
        const normalizedTargetOffers = sanitizeOfferEntries(targetOffers);
        const buildBaselineMap = (baselineItems) => {
            const baseline = new Map();
            const entries = Array.isArray(baselineItems) ? baselineItems : [];
            for (const item of entries) {
                const parsed = toObject(item);
                const itemType = cleanName(parsed.item_id || parsed.item_type || "");
                const itemCategory = cleanName(parsed.item_category || parsed.category || "block");
                if (itemType === "" || itemCategory === "")
                    continue;
                const itemStackLimit = getInventoryStackLimitForItem(itemType, parsed.stack_limit || DEFAULT_INVENTORY_STACK_LIMIT);
                baseline.set(`${itemType}\u0000${itemCategory}`, {
                    amount: Math.max(0, toInt(parsed.amount, 0)),
                    stack_limit: itemStackLimit,
                });
            }
            return baseline;
        };
        const requesterBaseline = buildBaselineMap(e.requester_inventory_baseline);
        const targetBaseline = buildBaselineMap(e.target_inventory_baseline);
        const isWorldLockKeyTradeItem = (item) => {
            const parsed = toObject(item);
            return cleanName(parsed.item_id || parsed.item_type || "") === "world_lock_key";
        };
        const buildDeltaMap = (offerItems, options = {}) => {
            const deltas = new Map();
            for (const item of offerItems) {
                if (options.skipWorldLockKeys === true && isWorldLockKeyTradeItem(item))
                    continue;
                const key = `${item.item_id}\u0000${item.item_category || "block"}`;
                deltas.set(key, (deltas.get(key) || 0) + item.amount);
            }
            return deltas;
        };
        const outgoingRequester = buildDeltaMap(normalizedRequesterOffers);
        const incomingRequester = buildDeltaMap(normalizedTargetOffers, { skipWorldLockKeys: true });
        const outgoingTarget = buildDeltaMap(normalizedTargetOffers);
        const incomingTarget = buildDeltaMap(normalizedRequesterOffers, { skipWorldLockKeys: true });
        const buildNetMap = (negativeDeltas, positiveDeltas) => {
            const net = new Map();
            for (const [key, amount] of negativeDeltas.entries()) {
                net.set(key, (net.get(key) || 0) - Math.max(0, amount));
            }
            for (const [key, amount] of positiveDeltas.entries()) {
                net.set(key, (net.get(key) || 0) + Math.max(0, amount));
            }
            return net;
        };
        const netRequester = buildNetMap(outgoingRequester, incomingRequester);
        const netTarget = buildNetMap(outgoingTarget, incomingTarget);
        const applyInventoryDeltas = async (client, playerId, deltas, baselineMap) => {
            const ledgerEntries = [];
            for (const [key, delta] of deltas.entries()) {
                if (!Number.isFinite(delta) || delta === 0)
                    continue;
                const [itemType, itemCategory] = String(key).split("\u0000");
                const safeItemType = cleanName(itemType);
                const safeCategory = cleanName(itemCategory || "block");
                if (safeItemType === "" || safeCategory === "") {
                    return { ok: false, reason: "invalid_offer_item", item_type: safeItemType, item_category: safeCategory };
                }
                const inventoryResult = await client.query(`
          SELECT amount, stack_limit
            FROM ${this.table("inventory")}
           WHERE player_id = $1
             AND item_type = $2
             AND item_category = $3
           FOR UPDATE
          `, [playerId, safeItemType, safeCategory]);
                const inventoryRow = inventoryResult.rows[0];
                const baselineEntry = baselineMap instanceof Map ? baselineMap.get(`${safeItemType}\u0000${safeCategory}`) : null;
                const storedBeforeAmount = Math.max(0, toInt(inventoryRow?.amount || 0, 0));
                let beforeAmount = storedBeforeAmount;
                let repairedFromAmount = null;
                const itemDefaultStackLimit = getInventoryStackLimitForItem(safeItemType);
                const existingStackLimit = clampStackLimit(inventoryRow?.stack_limit || itemDefaultStackLimit, itemDefaultStackLimit);
                const baselineStackLimit = baselineEntry ? clampStackLimit(baselineEntry.stack_limit, itemDefaultStackLimit) : itemDefaultStackLimit;
                const stackLimit = Math.max(existingStackLimit, baselineStackLimit);
                if (allowStateRepair && baselineEntry) {
                    const expectedBeforeAmount = Math.max(0, toInt(baselineEntry.amount, 0));
                    if (storedBeforeAmount !== expectedBeforeAmount) {
                        repairedFromAmount = storedBeforeAmount;
                        beforeAmount = expectedBeforeAmount;
                    }
                }
                const afterAmount = beforeAmount + delta;
                if (!inventoryRow && delta > 0 && delta > stackLimit) {
                    return {
                        ok: false,
                        reason: "insufficient_capacity",
                        item_type: safeItemType,
                        item_category: safeCategory,
                        player_id: playerId,
                    };
                }
                if (afterAmount < 0) {
                    return {
                        ok: false,
                        reason: "insufficient_inventory",
                        item_type: safeItemType,
                        item_category: safeCategory,
                        player_id: playerId,
                    };
                }
                if (delta > 0 && afterAmount > stackLimit) {
                    return {
                        ok: false,
                        reason: "insufficient_capacity",
                        item_type: safeItemType,
                        item_category: safeCategory,
                        player_id: playerId,
                    };
                }
                if (inventoryRow) {
                    await client.query(`
            UPDATE ${this.table("inventory")}
               SET amount = $4,
                   stack_limit = $5,
                   row_version = ${this.table("inventory")}.row_version + 1,
                   updated_at = now()
             WHERE player_id = $1
               AND item_type = $2
               AND item_category = $3
            `, [playerId, safeItemType, safeCategory, afterAmount, stackLimit]);
                }
                else {
                    await client.query(`
            INSERT INTO ${this.table("inventory")} (
              player_id,
              item_type,
              item_category,
              amount,
              stack_limit,
              row_version,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, 1, now())
            `, [playerId, safeItemType, safeCategory, afterAmount, stackLimit]);
                }
                ledgerEntries.push({
                    item_type: safeItemType,
                    item_category: safeCategory,
                    delta,
                    before_amount: beforeAmount,
                    after_amount: afterAmount,
                    repaired_inventory_before_amount: repairedFromAmount,
                });
            }
            return { ok: true, ledgerEntries };
        };
        try {
            return await this.withTransaction(async (client) => {
                // ensurePlayerIdentity upserts accounts+players and therefore takes exclusive row
                // locks. Acquiring them in caller-supplied order means an A->B trade and a
                // concurrent B->A trade lock the same two rows in opposite order (ABBA). Today the
                // serial write queue plus the sorted app-level inventory mutex
                // (server.ts acquirePlayerInventoryLocks) mask this; do not rely on that alone.
                // Acquire in a stable username order and bind to roles afterwards.
                const tradeIdentityOrder = [
                    { role: "requester", username: requester },
                    { role: "target", username: target },
                ].sort((left, right) => (String(left.username || "").toLowerCase().localeCompare(String(right.username || "").toLowerCase())));
                const tradeIdentityIds = new Map();
                for (const entry of tradeIdentityOrder) {
                    tradeIdentityIds.set(entry.role, await this.ensurePlayerIdentity(client, entry.username));
                }
                const requesterId = tradeIdentityIds.get("requester");
                const targetId = tradeIdentityIds.get("target");
                if (!requesterId || !targetId)
                    return { ok: false, reason: "player_not_found" };
                const worldResult = await client.query(`
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `, [worldName]);
                const worldId = worldResult.rows[0]?.world_id || null;
                const requesterInventoryBeforeHash = await this.getInventorySnapshotHash(client, requesterId);
                const targetInventoryBeforeHash = await this.getInventorySnapshotHash(client, targetId);
                const requesterInventory = await applyInventoryDeltas(client, requesterId, netRequester, requesterBaseline);
                if (!requesterInventory.ok)
                    return requesterInventory;
                const targetInventory = await applyInventoryDeltas(client, targetId, netTarget, targetBaseline);
                if (!targetInventory.ok)
                    return targetInventory;
                const tradeResult = await client.query(`
          INSERT INTO ${this.table("trades")} (
            trade_id,
            world_id,
            player_a_id,
            player_b_id,
            initiated_by_player_id,
            status,
            created_at,
            updated_at
          )
          VALUES (
            COALESCE($1::uuid, gen_random_uuid()),
            $2,
            $3,
            $4,
            $3,
            'completed',
            COALESCE(NULLIF($5, '')::timestamptz, now()),
            now()
          )
          ON CONFLICT (trade_id) DO UPDATE
            SET status = EXCLUDED.status,
                updated_at = now()
          RETURNING trade_id
          `, [
                    tradeIdUuid,
                    worldId,
                    requesterId,
                    targetId,
                    at || new Date().toISOString(),
                ]);
                const tradeId = tradeResult.rows[0]?.trade_id;
                if (!tradeId)
                    return { ok: false, reason: "trade_record_failed" };
                const txTimestamp = new Date().toISOString();
                // NOTE (2026-08-05): a legacy duplicate of the slot-aware loop below used to run
                // here. It inserted EVERY requester offer with a hardcoded slot_index of 0 and
                // swallowed the resulting error with .catch(() => {}).
                //
                // trade_items is PRIMARY KEY (trade_id, from_player_id, slot_index), so the second
                // and subsequent offers raised a duplicate-key error. Catching the JavaScript
                // rejection does NOT undo that in PostgreSQL: an error inside a transaction block
                // aborts the whole transaction, and every later statement fails with "current
                // transaction is aborted" until ROLLBACK. Any trade where the requester offered two
                // or more distinct stacks therefore could not commit, and the duplicate-key code
                // (23505) is not in isRetryablePostgresError, so it surfaced as a failed trade
                // rather than being retried.
                //
                // The loop below already writes the same rows correctly, with real slot indices and
                // an idempotent ON CONFLICT ... DO UPDATE. Removing the legacy loop fixes the abort
                // and also drops one round trip per offered stack.
                for (const [slot, item] of normalizedRequesterOffers.entries()) {
                    await client.query(`
            INSERT INTO ${this.table("trade_items")} (
              trade_id,
              from_player_id,
              slot_index,
              item_type,
              item_category,
              amount
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (trade_id, from_player_id, slot_index) DO UPDATE
              SET item_type = EXCLUDED.item_type,
                  item_category = EXCLUDED.item_category,
                  amount = EXCLUDED.amount
            `, [tradeId, requesterId, slot, item.item_id, item.item_category || "block", item.amount]);
                }
                for (const [slot, item] of normalizedTargetOffers.entries()) {
                    await client.query(`
            INSERT INTO ${this.table("trade_items")} (
              trade_id,
              from_player_id,
              slot_index,
              item_type,
              item_category,
              amount
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (trade_id, from_player_id, slot_index) DO UPDATE
              SET item_type = EXCLUDED.item_type,
                  item_category = EXCLUDED.item_category,
                  amount = EXCLUDED.amount
            `, [tradeId, targetId, slot, item.item_id, item.item_category || "block", item.amount]);
                }
                const trackedInstanceMovements = [];
                for (const item of normalizedRequesterOffers) {
                    const transferResult = await this.transferTrackedItemInstances(client, {
                        from_player_id: requesterId,
                        to_player_id: targetId,
                        world_id: worldId,
                        correlation_id: tradeId,
                        source: "trade",
                        action: "completed",
                        item_type: item.item_id,
                        item_category: item.item_category || "block",
                        amount: item.amount,
                        strict_item_instances: true,
                        to_state: isWorldLockKeyTradeItem(item) ? ITEM_INSTANCE_RETIRED_STATE : ITEM_INSTANCE_ACTIVE_STATE,
                        to_location: isWorldLockKeyTradeItem(item) ? "unknown" : "inventory",
                        preferred_world_name: item.item_id === "world_lock_key" ? worldName : "",
                        require_preferred_world_name: item.item_id === "world_lock_key",
                        details: {
                            trade_id: String(tradeId),
                            from_username: requester,
                            to_username: target,
                            world_name: item.item_id === "world_lock_key" ? worldName : "",
                            consumed_for_world_trade: isWorldLockKeyTradeItem(item),
                        },
                    });
                    if (!transferResult.ok) {
                        throw makeTrackedItemMovementError({ ...transferResult, reason: "trade_missing_item_instances" });
                    }
                    if (transferResult.tracked) {
                        trackedInstanceMovements.push(...(transferResult.item_instances || []));
                    }
                }
                for (const item of normalizedTargetOffers) {
                    const transferResult = await this.transferTrackedItemInstances(client, {
                        from_player_id: targetId,
                        to_player_id: requesterId,
                        world_id: worldId,
                        correlation_id: tradeId,
                        source: "trade",
                        action: "completed",
                        item_type: item.item_id,
                        item_category: item.item_category || "block",
                        amount: item.amount,
                        strict_item_instances: true,
                        to_state: isWorldLockKeyTradeItem(item) ? ITEM_INSTANCE_RETIRED_STATE : ITEM_INSTANCE_ACTIVE_STATE,
                        to_location: isWorldLockKeyTradeItem(item) ? "unknown" : "inventory",
                        preferred_world_name: item.item_id === "world_lock_key" ? worldName : "",
                        require_preferred_world_name: item.item_id === "world_lock_key",
                        details: {
                            trade_id: String(tradeId),
                            from_username: target,
                            to_username: requester,
                            world_name: item.item_id === "world_lock_key" ? worldName : "",
                            consumed_for_world_trade: isWorldLockKeyTradeItem(item),
                        },
                    });
                    if (!transferResult.ok) {
                        throw makeTrackedItemMovementError({ ...transferResult, reason: "trade_missing_item_instances" });
                    }
                    if (transferResult.tracked) {
                        trackedInstanceMovements.push(...(transferResult.item_instances || []));
                    }
                }
                const tradeLedgerContextByEntry = new Map();
                const tradeLedgerEntryKey = (playerId, entry) => `${playerId}\u0000${entry.item_type}\u0000${entry.item_category}\u0000${entry.delta}`;
                const rememberTradeLedgerContext = (playerId, entry, context = {}) => {
                    tradeLedgerContextByEntry.set(tradeLedgerEntryKey(playerId, entry), {
                        ...(tradeLedgerContextByEntry.get(tradeLedgerEntryKey(playerId, entry)) || {}),
                        ...context,
                    });
                };
                const getTradeLedgerContext = (playerId, entry) => tradeLedgerContextByEntry.get(tradeLedgerEntryKey(playerId, entry)) || {};
                const isGemLedgerEntry = (entry) => cleanName(entry?.item_type || "") === "gem" || cleanName(entry?.item_category || "") === "currency";
                const recordTradeGemLedger = async (client, playerId, counterpartyUsername, entry) => {
                    if (!isGemLedgerEntry(entry))
                        return null;
                    const action = entry.delta > 0 ? "trade_receive" : "trade_send";
                    const result = await client.query(`
            INSERT INTO ${this.table("gem_ledger")} (
              player_id,
              delta,
              reason,
              ref_type,
              ref_id,
              before_balance,
              after_balance,
              metadata,
              created_at
            )
            VALUES (
              $1,
              $2,
              $3,
              'trade',
              NULLIF($4, ''),
              $5,
              $6,
              $7::jsonb,
              COALESCE(NULLIF($8, '')::timestamptz, now())
            )
            RETURNING gem_ledger_id
            `, [
                        playerId,
                        entry.delta,
                        action,
                        String(tradeId || requestId || ""),
                        entry.before_amount,
                        entry.after_amount,
                        JSON.stringify({
                            role: entry.delta > 0 ? "receiver" : "sender",
                            counterparty: counterpartyUsername,
                            trade_id: String(tradeId),
                            item_type: entry.item_type,
                            item_category: entry.item_category,
                            repaired_inventory_before_amount: entry.repaired_inventory_before_amount,
                        }),
                        at,
                    ]);
                    return result.rows[0]?.gem_ledger_id || null;
                };
                for (const entry of requesterInventory.ledgerEntries) {
                    let itemTransactionResult = null;
                    if (entry.delta > 0) {
                        itemTransactionResult = await client.query(`
              INSERT INTO ${this.table("item_transactions")} (
                player_id,
                world_id,
                source,
                action,
                item_type,
                item_category,
                delta,
                before_amount,
                after_amount,
                request_id,
                correlation_id,
                metadata,
                created_at
              )
              VALUES (
                $1,
                $2,
                'trade',
                'receive',
                $3,
                $4,
                $5,
                $6,
                $7,
                NULLIF($8, ''),
                $9::uuid,
                $10::jsonb,
                COALESCE(NULLIF($11, '')::timestamptz, now())
              )
              RETURNING item_transaction_id
              `, [
                            requesterId,
                            worldId,
                            entry.item_type,
                            entry.item_category,
                            entry.delta,
                            entry.before_amount,
                            entry.after_amount,
                            requestId,
                            tradeId,
                            JSON.stringify({
                                role: entry.delta > 0 ? "receiver" : "sender",
                                counterparty: target,
                                trade_id: String(tradeId),
                            }),
                            at,
                        ]);
                    }
                    else {
                        itemTransactionResult = await client.query(`
              INSERT INTO ${this.table("item_transactions")} (
                player_id,
                world_id,
                source,
                action,
                item_type,
                item_category,
                delta,
                before_amount,
                after_amount,
                request_id,
                correlation_id,
                metadata,
                created_at
              )
              VALUES (
                $1,
                $2,
                'trade',
                'send',
                $3,
                $4,
                $5,
                $6,
                $7,
                NULLIF($8, ''),
                $9::uuid,
                $10::jsonb,
                COALESCE(NULLIF($11, '')::timestamptz, now())
              )
              RETURNING item_transaction_id
              `, [
                            requesterId,
                            worldId,
                            entry.item_type,
                            entry.item_category,
                            entry.delta,
                            entry.before_amount,
                            entry.after_amount,
                            requestId,
                            tradeId,
                            JSON.stringify({
                                role: entry.delta > 0 ? "receiver" : "sender",
                                counterparty: target,
                                trade_id: String(tradeId),
                            }),
                            at,
                        ]);
                    }
                    const itemTransactionId = itemTransactionResult?.rows?.[0]?.item_transaction_id || null;
                    const gemLedgerId = await recordTradeGemLedger(client, requesterId, target, entry);
                    rememberTradeLedgerContext(requesterId, entry, {
                        item_transaction_id: itemTransactionId,
                        gem_ledger_id: gemLedgerId,
                    });
                }
                for (const entry of targetInventory.ledgerEntries) {
                    let itemTransactionResult = null;
                    if (entry.delta > 0) {
                        itemTransactionResult = await client.query(`
              INSERT INTO ${this.table("item_transactions")} (
                player_id,
                world_id,
                source,
                action,
                item_type,
                item_category,
                delta,
                before_amount,
                after_amount,
                request_id,
                correlation_id,
                metadata,
                created_at
              )
              VALUES (
                $1,
                $2,
                'trade',
                'receive',
                $3,
                $4,
                $5,
                $6,
                $7,
                NULLIF($8, ''),
                $9::uuid,
                $10::jsonb,
                COALESCE(NULLIF($11, '')::timestamptz, now())
              )
              RETURNING item_transaction_id
              `, [
                            targetId,
                            worldId,
                            entry.item_type,
                            entry.item_category,
                            entry.delta,
                            entry.before_amount,
                            entry.after_amount,
                            requestId,
                            tradeId,
                            JSON.stringify({
                                role: entry.delta > 0 ? "receiver" : "sender",
                                counterparty: requester,
                                trade_id: String(tradeId),
                            }),
                            at,
                        ]);
                    }
                    else {
                        itemTransactionResult = await client.query(`
              INSERT INTO ${this.table("item_transactions")} (
                player_id,
                world_id,
                source,
                action,
                item_type,
                item_category,
                delta,
                before_amount,
                after_amount,
                request_id,
                correlation_id,
                metadata,
                created_at
              )
              VALUES (
                $1,
                $2,
                'trade',
                'send',
                $3,
                $4,
                $5,
                $6,
                $7,
                NULLIF($8, ''),
                $9::uuid,
                $10::jsonb,
                COALESCE(NULLIF($11, '')::timestamptz, now())
              )
              RETURNING item_transaction_id
              `, [
                            targetId,
                            worldId,
                            entry.item_type,
                            entry.item_category,
                            entry.delta,
                            entry.before_amount,
                            entry.after_amount,
                            requestId,
                            tradeId,
                            JSON.stringify({
                                role: entry.delta > 0 ? "receiver" : "sender",
                                counterparty: requester,
                                trade_id: String(tradeId),
                            }),
                            at,
                        ]);
                    }
                    const itemTransactionId = itemTransactionResult?.rows?.[0]?.item_transaction_id || null;
                    const gemLedgerId = await recordTradeGemLedger(client, targetId, requester, entry);
                    rememberTradeLedgerContext(targetId, entry, {
                        item_transaction_id: itemTransactionId,
                        gem_ledger_id: gemLedgerId,
                    });
                }
                for (const entry of requesterInventory.ledgerEntries) {
                    if (shouldTrackItemInstance(entry.item_type, entry.item_category))
                        continue;
                    const instanceSyncResult = await this.syncItemInstancesForLedger(client, {
                        player_id: requesterId,
                        world_id: worldId,
                        source: "trade",
                        action: entry.delta > 0 ? "receive" : "send",
                        item_type: entry.item_type,
                        item_category: entry.item_category,
                        delta: entry.delta,
                        after_amount: entry.after_amount,
                        details: {
                            trade_id: String(tradeId),
                            counterparty: target,
                            repaired_inventory_before_amount: entry.repaired_inventory_before_amount,
                        },
                    });
                    if (!instanceSyncResult.ok) {
                        throw makeTrackedItemMovementError(instanceSyncResult);
                    }
                }
                for (const entry of targetInventory.ledgerEntries) {
                    if (shouldTrackItemInstance(entry.item_type, entry.item_category))
                        continue;
                    const instanceSyncResult = await this.syncItemInstancesForLedger(client, {
                        player_id: targetId,
                        world_id: worldId,
                        source: "trade",
                        action: entry.delta > 0 ? "receive" : "send",
                        item_type: entry.item_type,
                        item_category: entry.item_category,
                        delta: entry.delta,
                        after_amount: entry.after_amount,
                        details: {
                            trade_id: String(tradeId),
                            counterparty: requester,
                            repaired_inventory_before_amount: entry.repaired_inventory_before_amount,
                        },
                    });
                    if (!instanceSyncResult.ok) {
                        throw makeTrackedItemMovementError(instanceSyncResult);
                    }
                }
                const requesterInventoryAfterHash = await this.getInventorySnapshotHash(client, requesterId);
                const targetInventoryAfterHash = await this.getInventorySnapshotHash(client, targetId);
                await this.updatePlayerInventoryHash(client, requesterId, requesterInventoryAfterHash);
                await this.updatePlayerInventoryHash(client, targetId, targetInventoryAfterHash);
                const tradeLedgerTransactionId = isUuid(tradeId) ? tradeId : null;
                const instancesForTradeEntry = (playerId, entry) => {
                    if (!shouldTrackItemInstance(entry.item_type, entry.item_category))
                        return [];
                    return trackedInstanceMovements.filter((instance) => {
                        const item = toObject(instance);
                        if (cleanName(item.item_type) !== entry.item_type || cleanName(item.item_category) !== entry.item_category)
                            return false;
                        if (entry.delta > 0)
                            return cleanName(item.to_player_id || "") === playerId;
                        if (entry.delta < 0)
                            return cleanName(item.from_player_id || "") === playerId;
                        return false;
                    });
                };
                for (const entry of requesterInventory.ledgerEntries) {
                    const ledgerContext = getTradeLedgerContext(requesterId, entry);
                    await this.recordTransactionLedger(client, {
                        transaction_id: tradeLedgerTransactionId,
                        transaction_type: "TRADE_COMPLETE",
                        player_id: requesterId,
                        other_player_id: targetId,
                        world_id: worldId,
                        item_transaction_id: ledgerContext.item_transaction_id,
                        gem_ledger_id: ledgerContext.gem_ledger_id,
                        trade_id: tradeId,
                        item_type: entry.item_type,
                        item_category: entry.item_category,
                        quantity: entry.delta,
                        gems_before: isGemLedgerEntry(entry) ? entry.before_amount : null,
                        gems_after: isGemLedgerEntry(entry) ? entry.after_amount : null,
                        inventory_before_hash: requesterInventoryBeforeHash,
                        inventory_after_hash: requesterInventoryAfterHash,
                        request_id: requestId,
                        correlation_id: tradeId,
                        source: "trade",
                        action: entry.delta > 0 ? "receive" : "send",
                        ip_address: ipAddress,
                        user_agent: userAgent,
                        session_token_hash: sessionTokenHash,
                        device_info: deviceInfo,
                        item_instances: instancesForTradeEntry(requesterId, entry),
                        at,
                        metadata: {
                            role: entry.delta > 0 ? "receiver" : "sender",
                            counterparty: target,
                            trade_id: String(tradeId),
                            repaired_inventory_before_amount: entry.repaired_inventory_before_amount,
                        },
                    });
                }
                for (const entry of targetInventory.ledgerEntries) {
                    const ledgerContext = getTradeLedgerContext(targetId, entry);
                    await this.recordTransactionLedger(client, {
                        transaction_id: tradeLedgerTransactionId,
                        transaction_type: "TRADE_COMPLETE",
                        player_id: targetId,
                        other_player_id: requesterId,
                        world_id: worldId,
                        item_transaction_id: ledgerContext.item_transaction_id,
                        gem_ledger_id: ledgerContext.gem_ledger_id,
                        trade_id: tradeId,
                        item_type: entry.item_type,
                        item_category: entry.item_category,
                        quantity: entry.delta,
                        gems_before: isGemLedgerEntry(entry) ? entry.before_amount : null,
                        gems_after: isGemLedgerEntry(entry) ? entry.after_amount : null,
                        inventory_before_hash: targetInventoryBeforeHash,
                        inventory_after_hash: targetInventoryAfterHash,
                        request_id: requestId,
                        correlation_id: tradeId,
                        source: "trade",
                        action: entry.delta > 0 ? "receive" : "send",
                        ip_address: ipAddress,
                        user_agent: userAgent,
                        session_token_hash: sessionTokenHash,
                        device_info: deviceInfo,
                        item_instances: instancesForTradeEntry(targetId, entry),
                        at,
                        metadata: {
                            role: entry.delta > 0 ? "receiver" : "sender",
                            counterparty: requester,
                            trade_id: String(tradeId),
                            repaired_inventory_before_amount: entry.repaired_inventory_before_amount,
                        },
                    });
                }
                return {
                    ok: true,
                    trade_id: tradeId,
                    request_id: requestId,
                    world_id: worldId,
                    requester_id: requesterId,
                    target_id: targetId,
                    request_ledgers: {
                        requester: requesterInventory.ledgerEntries,
                        target: targetInventory.ledgerEntries,
                    },
                    item_instance_movements: trackedInstanceMovements,
                    timestamp: txTimestamp,
                };
            });
        }
        catch (error) {
            const trackedErrorResult = resultForTrackedItemMovementError(error);
            if (trackedErrorResult)
                return trackedErrorResult;
            this.logger("[postgres] trade finalization transaction failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async applyVendBuyTransaction(entry = {}) {
        if (!this.isReady()) {
            return { ok: false, reason: "postgres_unavailable" };
        }
        const e = toObject(entry);
        const worldName = cleanName(e.world || "START") || "START";
        const owner = cleanName(e.owner_username);
        const buyer = cleanName(e.buyer_username);
        const itemType = cleanName(e.item_type);
        const itemCategory = cleanName(e.item_category || "block");
        const amount = toInt(e.amount, 0);
        const priceWls = toInt(e.price_wls, 0);
        const requestId = cleanName(e.request_id);
        const x = toInt(e.x, 0);
        const y = toInt(e.y, 0);
        const at = cleanName(e.at || "");
        const transactionId = cleanName(e.transaction_id || "");
        const listingTransactionId = cleanName(e.listing_id || e.listing_transaction_id || e.source_transaction_id || "");
        const correlationId = isUuid(transactionId) ? transactionId : null;
        const allowStateRepair = Boolean(e.allow_state_repair);
        const ipAddress = cleanName(e.ip_address || e.ip || "");
        const userAgent = cleanName(e.user_agent || "");
        const sessionTokenHash = cleanName(e.session_token_hash || "");
        const deviceInfo = safeJson(e.device_info);
        const worldState = toObject(e.world_state);
        const worldChanges = Array.isArray(e.world_changes) ? e.world_changes : [];
        const worldPersistence = normalizeWorldPersistenceMetadata(e.world_persistence, worldState);
        if (owner === "" || buyer === "" || itemType === "" || amount <= 0 || priceWls <= 0) {
            return { ok: false, reason: "invalid_payload" };
        }
        const buildBaselineMap = (baselineItems) => {
            const baseline = new Map();
            const entries = Array.isArray(baselineItems) ? baselineItems : [];
            for (const item of entries) {
                const parsed = toObject(item);
                const baselineItemType = cleanName(parsed.item_id || parsed.item_type || "");
                const baselineCategory = cleanName(parsed.item_category || parsed.category || "block");
                if (baselineItemType === "" || baselineCategory === "")
                    continue;
                const itemStackLimit = getInventoryStackLimitForItem(baselineItemType, parsed.stack_limit || DEFAULT_INVENTORY_STACK_LIMIT);
                baseline.set(`${baselineItemType}\u0000${baselineCategory}`, {
                    amount: Math.max(0, toInt(parsed.amount, 0)),
                    stack_limit: itemStackLimit,
                });
            }
            return baseline;
        };
        const buyerBaseline = buildBaselineMap(e.buyer_inventory_baseline);
        try {
            return await this.withTransaction(async (client) => {
                // Same ABBA hazard as applyTradeFinalizationTransaction: this locks owner->buyer
                // while trade locks requester->target, so the same two player rows can be acquired
                // in opposite order by two concurrent transactions. Acquire in stable username
                // order and bind to roles afterwards.
                const vendIdentityOrder = [
                    { role: "owner", username: owner },
                    { role: "buyer", username: buyer },
                ].sort((left, right) => (String(left.username || "").toLowerCase().localeCompare(String(right.username || "").toLowerCase())));
                const vendIdentityIds = new Map();
                for (const entry of vendIdentityOrder) {
                    vendIdentityIds.set(entry.role, await this.ensurePlayerIdentity(client, entry.username));
                }
                const ownerId = vendIdentityIds.get("owner");
                const buyerId = vendIdentityIds.get("buyer");
                if (!ownerId || !buyerId)
                    return { ok: false, reason: "player_not_found" };
                const worldResult = await client.query(`
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `, [worldName]);
                const worldId = worldResult.rows[0]?.world_id;
                if (!worldId)
                    return { ok: false, reason: "world_record_failed" };
                const buyerInventoryBeforeHash = await this.getInventorySnapshotHash(client, buyerId);
                const ownerInventoryBeforeHash = await this.getInventorySnapshotHash(client, ownerId);
                const lockRow = await client.query(`
          SELECT amount, stack_limit
            FROM ${this.table("inventory")}
           WHERE player_id = $1
             AND item_type = 'world_lock'
             AND item_category = 'block'
           FOR UPDATE
          `, [buyerId]);
                const lockInventory = lockRow.rows[0];
                const lockBaseline = buyerBaseline.get("world_lock\u0000block");
                const storedBeforeLock = Math.max(0, toInt(lockInventory?.amount || 0, 0));
                let beforeLock = storedBeforeLock;
                let repairedBeforeLock = null;
                const lockDefaultStackLimit = getInventoryStackLimitForItem("world_lock");
                const lockStack = Math.max(clampStackLimit(lockInventory?.stack_limit || lockDefaultStackLimit, lockDefaultStackLimit), lockBaseline ? clampStackLimit(lockBaseline.stack_limit, lockDefaultStackLimit) : lockDefaultStackLimit);
                if (allowStateRepair && lockBaseline) {
                    const expectedBeforeLock = Math.max(0, toInt(lockBaseline.amount, 0));
                    if (storedBeforeLock !== expectedBeforeLock) {
                        repairedBeforeLock = storedBeforeLock;
                        beforeLock = expectedBeforeLock;
                    }
                }
                const afterLock = beforeLock - priceWls;
                if (beforeLock < priceWls || afterLock < 0) {
                    return { ok: false, reason: "insufficient_inventory", item_type: "world_lock", item_category: "block" };
                }
                const itemRow = await client.query(`
          SELECT amount, stack_limit
            FROM ${this.table("inventory")}
           WHERE player_id = $1
             AND item_type = $2
             AND item_category = $3
           FOR UPDATE
          `, [buyerId, itemType, itemCategory]);
                const itemInventory = itemRow.rows[0];
                const itemBaseline = buyerBaseline.get(`${itemType}\u0000${itemCategory}`);
                const storedBeforeItem = Math.max(0, toInt(itemInventory?.amount || 0, 0));
                let beforeItem = storedBeforeItem;
                let repairedBeforeItem = null;
                const itemDefaultStackLimit = getInventoryStackLimitForItem(itemType);
                const itemStack = Math.max(clampStackLimit(itemInventory?.stack_limit || itemDefaultStackLimit, itemDefaultStackLimit), itemBaseline ? clampStackLimit(itemBaseline.stack_limit, itemDefaultStackLimit) : itemDefaultStackLimit);
                if (allowStateRepair && itemBaseline) {
                    const expectedBeforeItem = Math.max(0, toInt(itemBaseline.amount, 0));
                    if (storedBeforeItem !== expectedBeforeItem) {
                        repairedBeforeItem = storedBeforeItem;
                        beforeItem = expectedBeforeItem;
                    }
                }
                const afterItem = beforeItem + amount;
                if (afterItem > itemStack) {
                    return { ok: false, reason: "insufficient_capacity", item_type: itemType, item_category: itemCategory };
                }
                // Validate both inventory legs before writing either one. Returning a
                // normal failure after the first UPDATE would otherwise commit a
                // partial purchase when the transaction callback resolves normally.
                if (lockInventory) {
                    await client.query(`
            UPDATE ${this.table("inventory")}
               SET amount = $2,
                   stack_limit = $3,
                   row_version = ${this.table("inventory")}.row_version + 1,
                   updated_at = now()
             WHERE player_id = $1
               AND item_type = 'world_lock'
               AND item_category = 'block'
            `, [buyerId, afterLock, lockStack]);
                }
                else {
                    await client.query(`
            INSERT INTO ${this.table("inventory")} (
              player_id,
              item_type,
              item_category,
              amount,
              stack_limit,
              row_version,
              updated_at
            )
            VALUES ($1, 'world_lock', 'block', $2, $3, 1, now())
            `, [buyerId, afterLock, lockStack]);
                }
                if (itemInventory) {
                    await client.query(`
            UPDATE ${this.table("inventory")}
               SET amount = $4,
                   stack_limit = $5,
                   row_version = ${this.table("inventory")}.row_version + 1,
                   updated_at = now()
             WHERE player_id = $1
               AND item_type = $2
               AND item_category = $3
            `, [buyerId, itemType, itemCategory, afterItem, itemStack]);
                }
                else {
                    await client.query(`
            INSERT INTO ${this.table("inventory")} (
              player_id,
              item_type,
              item_category,
              amount,
              stack_limit,
              row_version,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, 1, now())
            `, [buyerId, itemType, itemCategory, afterItem, itemStack]);
                }
                const vendingTransactionResult = await client.query(`
          INSERT INTO ${this.table("vending_transactions")} (
            world_id,
            vend_owner_player_id,
            buyer_player_id,
            block_x,
            block_y,
            item_type,
            item_category,
            amount,
            price_gems,
            total_gems,
            request_id,
            metadata,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            NULLIF($6, ''),
            NULLIF($7, ''),
            $8,
            $9,
            $10,
            NULLIF($11, ''),
            $12::jsonb,
            COALESCE(NULLIF($13, '')::timestamptz, now())
          )
          RETURNING vending_transaction_id
          `, [
                    worldId,
                    ownerId,
                    buyerId,
                    x,
                    y,
                    itemType,
                    itemCategory,
                    amount,
                    priceWls,
                    priceWls * amount,
                    transactionId,
                    JSON.stringify({
                        source: "vending_buy",
                        request_id: requestId,
                        transaction_id: transactionId,
                        listing_transaction_id: listingTransactionId,
                    }),
                    at,
                ]);
                const vendingTransactionId = vendingTransactionResult.rows[0]?.vending_transaction_id || null;
                const spendTransactionResult = await client.query(`
          INSERT INTO ${this.table("item_transactions")} (
            player_id,
            world_id,
            source,
            action,
            item_type,
            item_category,
            delta,
            before_amount,
            after_amount,
            request_id,
            correlation_id,
            metadata,
            created_at
          )
          VALUES (
            $1,
            $2,
            'vending',
            'spend',
            'world_lock',
            'block',
            $3,
            $4,
            $5,
            NULLIF($6, ''),
            $7::uuid,
            $8::jsonb,
            COALESCE(NULLIF($9, '')::timestamptz, now())
          )
          RETURNING item_transaction_id
          `, [
                    buyerId,
                    worldId,
                    -priceWls,
                    beforeLock,
                    afterLock,
                    requestId,
                    correlationId,
                    JSON.stringify({
                        kind: "vend_buy",
                        world_x: x,
                        world_y: y,
                        lock_spent: priceWls,
                        transaction_id: transactionId,
                        listing_transaction_id: listingTransactionId,
                        repaired_inventory_before_amount: repairedBeforeLock,
                    }),
                    at,
                ]);
                const spendTransactionId = spendTransactionResult.rows[0]?.item_transaction_id || null;
                let spendInstanceMovementResult = await this.transferTrackedItemInstances(client, {
                    from_player_id: buyerId,
                    to_player_id: ownerId,
                    world_id: worldId,
                    correlation_id: correlationId,
                    source: "vending",
                    action: "payment",
                    item_type: "world_lock",
                    item_category: "block",
                    amount: priceWls,
                    strict_item_instances: true,
                    to_state: "locked",
                    to_location: "vending",
                    from_states: ["active"],
                    from_locations: ["inventory"],
                    details: {
                        kind: "vend_buy",
                        transaction_id: transactionId,
                        listing_transaction_id: listingTransactionId,
                        request_id: requestId,
                        owner_username: owner,
                        buyer_username: buyer,
                        world_x: x,
                        world_y: y,
                        repaired_inventory_before_amount: repairedBeforeLock,
                    },
                });
                if (!spendInstanceMovementResult.ok) {
                    throw makeTrackedItemMovementError({ ...spendInstanceMovementResult, reason: "vending_payment_missing_item_instances" });
                }
                if (!spendInstanceMovementResult.tracked) {
                    spendInstanceMovementResult = await this.syncItemInstancesForLedger(client, {
                        player_id: buyerId,
                        world_id: worldId,
                        item_transaction_id: spendTransactionId,
                        source: "vending",
                        action: "spend",
                        item_type: "world_lock",
                        item_category: "block",
                        delta: -priceWls,
                        after_amount: afterLock,
                        details: {
                            kind: "vend_buy",
                            transaction_id: transactionId,
                            listing_transaction_id: listingTransactionId,
                            world_x: x,
                            world_y: y,
                            repaired_inventory_before_amount: repairedBeforeLock,
                        },
                    });
                    if (!spendInstanceMovementResult.ok) {
                        throw makeTrackedItemMovementError({ ...spendInstanceMovementResult, reason: "vending_payment_missing_item_instances" });
                    }
                }
                const receiveTransactionResult = await client.query(`
          INSERT INTO ${this.table("item_transactions")} (
            player_id,
            world_id,
            source,
            action,
            item_type,
            item_category,
            delta,
            before_amount,
            after_amount,
            request_id,
            correlation_id,
            metadata,
            created_at
          )
          VALUES (
            $1,
            $2,
            'vending',
            'receive',
            $3,
            $4,
            $5,
            $6,
            $7,
            NULLIF($8, ''),
            $9::uuid,
            $10::jsonb,
            COALESCE(NULLIF($11, '')::timestamptz, now())
          )
          RETURNING item_transaction_id
          `, [
                    buyerId,
                    worldId,
                    itemType,
                    itemCategory,
                    amount,
                    beforeItem,
                    afterItem,
                    requestId,
                    correlationId,
                    JSON.stringify({
                        kind: "vend_buy",
                        transaction_id: transactionId,
                        listing_transaction_id: listingTransactionId,
                        item_id: itemType,
                        world_x: x,
                        world_y: y,
                        repaired_inventory_before_amount: repairedBeforeItem,
                    }),
                    at,
                ]);
                const receiveTransactionId = receiveTransactionResult.rows[0]?.item_transaction_id || null;
                const soldItemTransferResult = await this.transferTrackedItemInstances(client, {
                    from_player_id: ownerId,
                    to_player_id: buyerId,
                    world_id: worldId,
                    correlation_id: correlationId,
                    source: "vending",
                    action: "buy",
                    item_type: itemType,
                    item_category: itemCategory,
                    amount,
                    strict_item_instances: true,
                    from_states: ["locked", "active"],
                    from_locations: ["vending", "inventory"],
                    from_metadata_action: "vending_list",
                    from_metadata_transaction_id: listingTransactionId,
                    details: {
                        kind: "vend_buy",
                        transaction_id: transactionId,
                        listing_transaction_id: listingTransactionId,
                        request_id: requestId,
                        owner_username: owner,
                        buyer_username: buyer,
                        world_x: x,
                        world_y: y,
                    },
                });
                if (!soldItemTransferResult.ok) {
                    throw makeTrackedItemMovementError({ ...soldItemTransferResult, reason: "vending_missing_item_instances" });
                }
                if (!soldItemTransferResult.tracked) {
                    const receiveInstanceSyncResult = await this.syncItemInstancesForLedger(client, {
                        player_id: buyerId,
                        world_id: worldId,
                        item_transaction_id: receiveTransactionId,
                        source: "vending",
                        action: "receive",
                        item_type: itemType,
                        item_category: itemCategory,
                        delta: amount,
                        after_amount: afterItem,
                        details: {
                            kind: "vend_buy",
                            transaction_id: transactionId,
                            listing_transaction_id: listingTransactionId,
                            request_id: requestId,
                            owner_username: owner,
                            buyer_username: buyer,
                            world_x: x,
                            world_y: y,
                            repaired_inventory_before_amount: repairedBeforeItem,
                        },
                    });
                    if (!receiveInstanceSyncResult.ok) {
                        throw makeTrackedItemMovementError(receiveInstanceSyncResult);
                    }
                }
                const buyerInventoryAfterHash = await this.getInventorySnapshotHash(client, buyerId);
                const ownerInventoryAfterHash = await this.getInventorySnapshotHash(client, ownerId);
                await this.updatePlayerInventoryHash(client, buyerId, buyerInventoryAfterHash);
                await this.updatePlayerInventoryHash(client, ownerId, ownerInventoryAfterHash);
                await this.recordTransactionLedger(client, {
                    transaction_id: correlationId,
                    transaction_type: "VENDING_BUY",
                    player_id: buyerId,
                    other_player_id: ownerId,
                    world_id: worldId,
                    item_transaction_id: spendTransactionId,
                    vending_transaction_id: vendingTransactionId,
                    item_type: "world_lock",
                    item_category: "block",
                    quantity: -priceWls,
                    inventory_before_hash: buyerInventoryBeforeHash,
                    inventory_after_hash: buyerInventoryAfterHash,
                    request_id: requestId,
                    correlation_id: correlationId,
                    source: "vending",
                    action: "spend",
                    ip_address: ipAddress,
                    user_agent: userAgent,
                    session_token_hash: sessionTokenHash,
                    device_info: deviceInfo,
                    item_instances: spendInstanceMovementResult.item_instances || [],
                    at,
                    metadata: {
                        kind: "vend_buy",
                        role: "buyer_payment",
                        owner_username: owner,
                        buyer_username: buyer,
                        world_x: x,
                        world_y: y,
                        transaction_id: transactionId,
                        listing_transaction_id: listingTransactionId,
                        owner_inventory_before_hash: ownerInventoryBeforeHash,
                        owner_inventory_after_hash: ownerInventoryAfterHash,
                        repaired_inventory_before_amount: repairedBeforeLock,
                    },
                });
                await this.recordTransactionLedger(client, {
                    transaction_id: correlationId,
                    transaction_type: "VENDING_BUY",
                    player_id: buyerId,
                    other_player_id: ownerId,
                    world_id: worldId,
                    item_transaction_id: receiveTransactionId,
                    vending_transaction_id: vendingTransactionId,
                    item_type: itemType,
                    item_category: itemCategory,
                    quantity: amount,
                    inventory_before_hash: buyerInventoryBeforeHash,
                    inventory_after_hash: buyerInventoryAfterHash,
                    request_id: requestId,
                    correlation_id: correlationId,
                    source: "vending",
                    action: "receive",
                    ip_address: ipAddress,
                    user_agent: userAgent,
                    session_token_hash: sessionTokenHash,
                    device_info: deviceInfo,
                    item_instances: soldItemTransferResult.item_instances || [],
                    at,
                    metadata: {
                        kind: "vend_buy",
                        role: "buyer_receive",
                        owner_username: owner,
                        buyer_username: buyer,
                        world_x: x,
                        world_y: y,
                        transaction_id: transactionId,
                        listing_transaction_id: listingTransactionId,
                        owner_inventory_before_hash: ownerInventoryBeforeHash,
                        owner_inventory_after_hash: ownerInventoryAfterHash,
                        repaired_inventory_before_amount: repairedBeforeItem,
                    },
                });
                let persistedWorld = null;
                if (Object.keys(worldState).length > 0) {
                    const previousWorldState = await this.loadWorldStateForUpdate(client, worldName);
                    persistedWorld = await this.upsertWorldState(client, worldName, worldState, worldPersistence);
                    if (!persistedWorld.ok || !persistedWorld.world_id) {
                        const persistenceError = new Error(persistedWorld.reason || "world_state_save_failed");
                        persistenceError.code = "PIXELMANIA_WORLD_PERSISTENCE_REJECTED";
                        persistenceError.world_persistence_result = persistedWorld;
                        throw persistenceError;
                    }
                    await this.mirrorWorldLockState(client, persistedWorld.world_id, worldState);
                    await this.mirrorWorldAreaLocksState(client, persistedWorld.world_id, worldState);
                    const hasExplicitObjectChanges = worldChanges.some((change) => this.isWorldObjectChangeEntry(change));
                    const inferredObjectChanges = hasExplicitObjectChanges
                        ? []
                        : this.buildWorldObjectChangesFromStateDiff(previousWorldState, worldState, {
                            actor_username: buyer,
                            source_type: "vending",
                            source_id: transactionId,
                            request_id: requestId,
                            world: worldName,
                            action: "vending_buy",
                            at,
                        });
                    await this.recordWorldChangesAndTrackedDrops(client, persistedWorld.world_id, [...worldChanges, ...inferredObjectChanges]);
                }
                return {
                    ok: true,
                    buyer: {
                        before_world_lock: beforeLock,
                        after_world_lock: afterLock,
                        before_item: beforeItem,
                        after_item: afterItem,
                        item_type: itemType,
                        item_category: itemCategory,
                    },
                    item_instance_movements: [
                        ...(spendInstanceMovementResult.item_instances || []),
                        ...(soldItemTransferResult.item_instances || []),
                    ],
                    world_id: worldId,
                    persisted_revision: normalizeWorldRevision(persistedWorld?.persisted_revision),
                };
            });
        }
        catch (error) {
            const persistenceResult = error?.world_persistence_result;
            if (persistenceResult) {
                return {
                    ok: false,
                    reason: persistenceResult.reason || "world_state_save_failed",
                    persisted_revision: persistenceResult.persisted_revision,
                };
            }
            const trackedErrorResult = resultForTrackedItemMovementError(error);
            if (trackedErrorResult)
                return trackedErrorResult;
            this.logger("[postgres] vend buy transaction failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async issuePunishment(entry = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const e = toObject(entry);
        const targetUsername = cleanName(e.target_username || e.username || e.player_username || "");
        const issuerUsername = cleanName(e.issued_by_username || e.admin_username || e.actor_username || "");
        const punishmentType = normalizePunishmentType(e.punishment_type || e.type || "");
        const scope = normalizePunishmentScope(e.scope || "");
        const worldName = cleanName(e.world || e.world_name || "");
        const reason = cleanName(e.reason || "") || "No reason provided.";
        const endsAt = normalizePunishmentEndsAt(e);
        if (targetUsername === "")
            return { ok: false, reason: "invalid_target" };
        if (punishmentType === "")
            return { ok: false, reason: "invalid_punishment_type" };
        if (scope === "world" && worldName === "")
            return { ok: false, reason: "world_required" };
        try {
            return await this.withTransaction(async (client) => {
                const playerId = await this.ensurePlayerIdentityForExistingAccount(client, targetUsername);
                if (!playerId)
                    return { ok: false, reason: "player_not_found" };
                const issuedByPlayerId = issuerUsername !== ""
                    ? await this.ensurePlayerIdentityForExistingAccount(client, issuerUsername)
                    : null;
                const worldId = scope === "world"
                    ? await this.ensureWorldIdentity(client, worldName)
                    : null;
                const result = await client.query(`
          INSERT INTO ${this.table("punishments")} (
            player_id,
            issued_by_player_id,
            punishment_type,
            reason,
            scope,
            world_id,
            starts_at,
            ends_at,
            is_active,
            metadata,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            now(),
            $7::timestamptz,
            true,
            $8::jsonb,
            now()
          )
          RETURNING punishment_id
          `, [
                    playerId,
                    issuedByPlayerId,
                    punishmentType,
                    reason,
                    scope,
                    worldId,
                    endsAt,
                    JSON.stringify(safeJson({
                        ...toObject(e.metadata || e.details || {}),
                        target_username: targetUsername,
                        issued_by_username: issuerUsername,
                        world: worldName,
                    })),
                ]);
                return {
                    ok: true,
                    punishment_id: toInt(result.rows[0]?.punishment_id, 0),
                    target_username: targetUsername,
                    punishment_type: punishmentType,
                    scope,
                    world: worldName,
                    ends_at: endsAt,
                };
            });
        }
        catch (error) {
            this.logger("[postgres] punishment issue failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    mirrorPunishment(entry = {}) {
        if (!this.isReady())
            return;
        const e = toObject(entry);
        const action = cleanName(e.action || e.mode || "").toLowerCase();
        this.runDetached("mirror punishment", async () => {
            if (action === "revoke" || action === "remove" || action === "unban" || action === "unmute") {
                await this.revokePunishment(e);
                return;
            }
            await this.issuePunishment(e);
        });
    }
    recordLoginAttempt(entry = {}) {
        if (!this.isReady())
            return;
        const e = toObject(entry);
        this.runDetached("record login attempt", async () => {
            await this.withTransaction(async (client) => {
                const username = cleanName(e.username || e.account_username || "");
                let accountId = null;
                if (username !== "") {
                    const accountResult = await client.query(`SELECT account_id FROM ${this.table("accounts")} WHERE lower(username::text) = lower($1) LIMIT 1`, [username]);
                    accountId = accountResult.rows[0]?.account_id || null;
                }
                await client.query(`
          INSERT INTO ${this.table("account_login_attempts")} (
            account_id,
            username,
            action,
            success,
            reason,
            ip_address,
            user_agent,
            device_info,
            request_id,
            created_at
          )
          VALUES (
            $1,
            COALESCE(NULLIF($2, ''), ''),
            COALESCE(NULLIF($3, ''), 'login'),
            $4,
            COALESCE(NULLIF($5, ''), ''),
            NULLIF($6, '')::inet,
            NULLIF($7, ''),
            $8::jsonb,
            NULLIF($9, ''),
            COALESCE($10::timestamptz, now())
          )
          `, [
                    accountId,
                    username,
                    cleanName(e.action || "login"),
                    Boolean(e.success || e.ok),
                    cleanName(e.reason || ""),
                    normalizeIp(e.ip || e.ip_address || ""),
                    cleanName(e.user_agent || e.userAgent || ""),
                    JSON.stringify(safeJson(e.device_info || e.deviceInfo || {})),
                    cleanName(e.request_id || ""),
                    normalizeOptionalTimestamp(e.at || ""),
                ]);
            });
        });
    }
    async revokePunishment(entry = {}) {
        if (!this.isReady())
            return { ok: false, reason: "postgres_unavailable" };
        const e = toObject(entry);
        const punishmentId = toInt(e.punishment_id, 0);
        const targetUsername = cleanName(e.target_username || e.username || e.player_username || "");
        const punishmentType = normalizePunishmentType(e.punishment_type || e.type || "");
        const scope = normalizePunishmentScope(e.scope || "");
        const worldName = cleanName(e.world || e.world_name || "");
        const revokedBy = cleanName(e.revoked_by_username || e.admin_username || e.actor_username || "");
        if (punishmentId <= 0 && targetUsername === "")
            return { ok: false, reason: "invalid_target" };
        try {
            return await this.withTransaction(async (client) => {
                let playerId = null;
                if (targetUsername !== "") {
                    playerId = await this.lookupPlayerIdByUsername(client, targetUsername);
                    if (!playerId)
                        return { ok: false, reason: "player_not_found" };
                }
                const worldId = worldName !== "" ? await this.ensureWorldIdentity(client, worldName) : null;
                const result = await client.query(`
          UPDATE ${this.table("punishments")}
             SET is_active = false,
                 metadata = metadata || $6::jsonb
           WHERE is_active = true
             AND ($1::bigint <= 0 OR punishment_id = $1::bigint)
             AND ($2::uuid IS NULL OR player_id = $2::uuid)
             AND ($3 = '' OR punishment_type = $3)
             AND ($4 = '' OR scope = $4)
             AND ($5::uuid IS NULL OR world_id = $5::uuid)
          RETURNING punishment_id
          `, [
                    punishmentId,
                    playerId,
                    punishmentType,
                    e.scope === undefined ? "" : scope,
                    worldId,
                    JSON.stringify({
                        revoked_at: new Date().toISOString(),
                        revoked_by_username: revokedBy,
                        revoke_reason: cleanName(e.reason || "") || "revoked",
                    }),
                ]);
                return {
                    ok: true,
                    revoked_count: result.rowCount ?? 0,
                    punishment_ids: result.rows.map((row) => toInt(row.punishment_id, 0)).filter((id) => id > 0),
                };
            });
        }
        catch (error) {
            this.logger("[postgres] punishment revoke failed:", getErrorMessage(error));
            return { ok: false, reason: "database_error", message: getErrorMessage(error) };
        }
    }
    async getActivePunishments(username, options = {}) {
        if (!this.isReady())
            return [];
        const cleanUsername = cleanName(username);
        if (cleanUsername === "")
            return [];
        const punishmentType = normalizePunishmentType(options.punishment_type || options.type || "");
        const scope = options.scope === undefined ? "" : normalizePunishmentScope(options.scope || "");
        const worldName = cleanName(options.world || options.world_name || "");
        try {
            const result = await this.db.query(`
        SELECT
          pu.punishment_id,
          pu.punishment_type,
          pu.reason,
          pu.scope,
          w.world_name,
          pu.starts_at,
          pu.ends_at,
          pu.metadata,
          issuer.display_name AS issued_by_display_name
        FROM ${this.table("punishments")} pu
        JOIN ${this.table("players")} p ON p.player_id = pu.player_id
        JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
        LEFT JOIN ${this.table("players")} issuer ON issuer.player_id = pu.issued_by_player_id
        LEFT JOIN ${this.table("worlds")} w ON w.world_id = pu.world_id
        WHERE a.username = $1
          AND pu.is_active = true
          AND (pu.ends_at IS NULL OR pu.ends_at > now())
          AND ($2 = '' OR pu.punishment_type = $2)
          AND ($3 = '' OR pu.scope = $3)
          AND ($4 = '' OR w.world_name = $4)
        ORDER BY pu.created_at DESC
        `, [cleanUsername, punishmentType, scope, worldName]);
            return result.rows.map((row) => ({
                punishment_id: toInt(row.punishment_id, 0),
                punishment_type: cleanName(row.punishment_type || ""),
                reason: cleanName(row.reason || ""),
                scope: cleanName(row.scope || ""),
                world: cleanName(row.world_name || ""),
                starts_at: normalizeOptionalTimestamp(row.starts_at),
                ends_at: normalizeOptionalTimestamp(row.ends_at),
                issued_by: cleanName(row.issued_by_display_name || ""),
                metadata: toObject(row.metadata),
            }));
        }
        catch (error) {
            this.logger("[postgres] active punishment lookup failed:", getErrorMessage(error));
            return [];
        }
    }
    async hasActivePunishment(username, type, options = {}) {
        const rows = await this.getActivePunishments(username, {
            ...toObject(options),
            punishment_type: type,
        });
        return rows.length > 0;
    }
    mirrorWorldChange(entry) {
        if (!this.isReady())
            return;
        const e = toObject(entry);
        const worldName = cleanName(e.world);
        if (worldName === "")
            return;
        this.runDetached("mirror world change", async () => {
            await this.withTransaction(async (client) => {
                const worldResult = await client.query(`
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_saved_at = now(),
                updated_at = now()
          RETURNING world_id
          `, [worldName]);
                const worldId = worldResult.rows[0]?.world_id;
                if (!worldId)
                    return;
                await this.recordWorldChangeEntry(client, worldId, e);
            });
        });
    }
    mirrorSecurityEvent(entry) {
        if (!this.isReady())
            return;
        const e = toObject(entry);
        this.runDetached("mirror security event", async () => {
            await this.withTransaction(async (client) => {
                let playerId = null;
                let accountId = null;
                const username = cleanName(e.actor_username || "");
                if (username !== "") {
                    playerId = await this.ensurePlayerIdentity(client, username, "", cleanName(e.actor_role || "player"));
                    const accountResult = await client.query(`SELECT account_id FROM ${this.table("accounts")} WHERE username = $1 LIMIT 1`, [username]);
                    accountId = accountResult.rows[0]?.account_id || null;
                }
                let worldId = null;
                const worldName = cleanName(e.world || "");
                if (worldName !== "") {
                    const worldResult = await client.query(`
            INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
            VALUES ($1, 100, 70, 1, true, now(), now())
            ON CONFLICT (world_name) DO UPDATE
              SET updated_at = now()
            RETURNING world_id
            `, [worldName]);
                    worldId = worldResult.rows[0]?.world_id || null;
                }
                await client.query(`
          INSERT INTO ${this.table("security_events")} (
            account_id,
            player_id,
            world_id,
            severity,
            event_type,
            request_id,
            ip_address,
            details,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3,
            COALESCE(NULLIF($4, ''), 'medium'),
            COALESCE(NULLIF($5, ''), 'security_event'),
            NULLIF($6, ''),
            NULLIF($7, '')::inet,
            $8::jsonb,
            COALESCE(NULLIF($9, '')::timestamptz, now())
          )
          `, [
                    accountId,
                    playerId,
                    worldId,
                    normalizeSecuritySeverity(e.severity || "medium"),
                    cleanName(e.event || "security_event"),
                    cleanName(e.request_id || ""),
                    normalizeIp(e.ip || ""),
                    JSON.stringify(safeJson(e.details)),
                    cleanName(e.at || ""),
                ]);
            });
        });
    }
}
PostgresStore.INTEGRITY_HASH_ALGORITHM = INTEGRITY_HASH_ALGORITHM;
PostgresStore.applyCanonicalInventoryRowsToPlayerState = applyCanonicalInventoryRowsToPlayerState;
PostgresStore.buildTransactionLedgerHash = buildTransactionLedgerHash;
PostgresStore.integrityHash = integrityHash;
module.exports = PostgresStore;
