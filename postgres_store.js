"use strict";

const fs = require("fs");
const crypto = require("crypto");
const net = require("net");
const path = require("path");
const ItemDatabase = require("./server_item_database");

let PoolClass = null;
try {
  ({ Pool: PoolClass } = require("pg"));
} catch {
  PoolClass = null;
}

const INVENTORY_FIELD_CATEGORY = Object.freeze([
  ["inventory", "block"],
  ["seed_inventory", "seed"],
  ["tool_inventory", "tool"],
  ["back_inventory", "back"],
  ["hair_inventory", "hair"],
  ["shirt_inventory", "shirt"],
  ["pants_inventory", "pants"],
  ["shoes_inventory", "shoes"],
  ["currency_inventory", "currency"],
  ["material_inventory", "material"],
  ["lure_inventory", "lure"],
  ["fish_inventory", "fish"],
]);

const PLAYER_LEVEL_MIN = 1;
const PLAYER_LEVEL_MAX = 100;
const PLAYER_XP_FIRST_LEVEL = 300;
const POSTGRES_TRANSACTION_MAX_ATTEMPTS = 5;
const POSTGRES_TRANSACTION_RETRY_BASE_DELAY_MS = 75;
const DEFAULT_INVENTORY_STACK_LIMIT = ItemDatabase.DEFAULT_STACK_LIMIT || 200;
const MAX_INVENTORY_STACK_LIMIT = ItemDatabase.GEM_CURRENCY_STACK_LIMIT || 100000000000;
const ITEM_INSTANCE_TRACKED_CATEGORIES = new Set(["tool", "back", "hair", "shirt", "pants", "shoes"]);
const ITEM_INSTANCE_ACTIVE_STATE = "active";
const ITEM_INSTANCE_RETIRED_STATE = "consumed";
const ITEM_INSTANCE_STATES = new Set(["active", "consumed", "traded", "destroyed", "dropped", "locked"]);
const ITEM_INSTANCE_RECONCILE_MAX_PER_ITEM = 250;
const PUNISHMENT_TYPES = new Set(["ban", "mute", "trade_ban", "world_ban", "lockout"]);
const PUNISHMENT_SCOPES = new Set(["global", "world"]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryablePostgresError(error) {
  const code = String(error?.code || "");
  return code === "40P01" || code === "40001" || code === "55P03";
}

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function cleanName(value) {
  return String(value || "").trim();
}

function normalizeDbRole(value) {
  const role = cleanName(value).toLowerCase();
  if (role === "developer") return "admin";
  if (role === "mod") return "moderator";
  if (role === "player" || role === "moderator" || role === "admin" || role === "owner") return role;
  return "player";
}

function normalizeOptionalTimestamp(value) {
  const raw = cleanName(value);
  if (raw === "") return null;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function jsonChecksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex");
}

function clampStackLimit(value, fallback = DEFAULT_INVENTORY_STACK_LIMIT) {
  const fallbackLimit = Math.max(1, toInt(fallback, DEFAULT_INVENTORY_STACK_LIMIT));
  return Math.min(MAX_INVENTORY_STACK_LIMIT, Math.max(1, toInt(value, fallbackLimit)));
}

function getInventoryStackLimitForItem(itemType, fallback = DEFAULT_INVENTORY_STACK_LIMIT) {
  const cleanItemType = cleanName(itemType);
  if (cleanItemType !== "" && ItemDatabase.hasItem(cleanItemType)) {
    return clampStackLimit(ItemDatabase.getStackLimit(cleanItemType), fallback);
  }
  return clampStackLimit(fallback);
}

function resolveItemCategory(itemType, itemCategory = "") {
  const cleanItemType = cleanName(itemType);
  if (cleanItemType !== "" && typeof ItemDatabase.resolveItemCategory === "function") {
    const resolved = cleanName(ItemDatabase.resolveItemCategory(cleanItemType, itemCategory));
    if (resolved !== "") return resolved;
  }
  return cleanName(itemCategory || "block").toLowerCase();
}

function shouldTrackItemInstance(itemType, itemCategory = "") {
  const cleanItemType = cleanName(itemType);
  if (cleanItemType === "") return false;

  const resolvedCategory = resolveItemCategory(cleanItemType, itemCategory);
  const definition = typeof ItemDatabase.getItemDefinition === "function"
    ? ItemDatabase.getItemDefinition(cleanItemType)
    : null;
  if (definition && definition.instance_tracked === false) return false;
  if (definition && (definition.instance_tracked === true || definition.equipable || cleanName(definition.equipment_slot) !== "")) return true;
  if (ITEM_INSTANCE_TRACKED_CATEGORIES.has(resolvedCategory)) return true;
  return getInventoryStackLimitForItem(cleanItemType) <= 1;
}

function normalizeItemInstanceState(value, fallback = ITEM_INSTANCE_ACTIVE_STATE) {
  const clean = cleanName(value).toLowerCase();
  if (ITEM_INSTANCE_STATES.has(clean)) return clean;
  return ITEM_INSTANCE_STATES.has(fallback) ? fallback : ITEM_INSTANCE_ACTIVE_STATE;
}

function normalizePunishmentType(value) {
  const clean = cleanName(value).toLowerCase();
  return PUNISHMENT_TYPES.has(clean) ? clean : "";
}

function normalizePunishmentScope(value) {
  const clean = cleanName(value).toLowerCase();
  return PUNISHMENT_SCOPES.has(clean) ? clean : "global";
}

function normalizePunishmentEndsAt(entry) {
  const e = toObject(entry);
  const explicitEndsAt = normalizeOptionalTimestamp(e.ends_at || e.expires_at || e.until || "");
  if (explicitEndsAt) return explicitEndsAt;

  const durationMinutes = toInt(e.duration_minutes || e.minutes || 0, 0);
  if (durationMinutes > 0) {
    return new Date(Date.now() + (durationMinutes * 60000)).toISOString();
  }
  return null;
}

function defaultEmailForUsername(username) {
  const base = cleanName(username).toLowerCase().replace(/[^a-z0-9_]/g, "");
  return `${base || "player"}@pixelmania.local`;
}

function getXpNeededForLevel(level) {
  const safeLevel = Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(level, PLAYER_LEVEL_MIN)));
  if (safeLevel >= PLAYER_LEVEL_MAX) return 0;

  const levelIndex = safeLevel - PLAYER_LEVEL_MIN;
  return PLAYER_XP_FIRST_LEVEL + (levelIndex * 120) + Math.floor(Math.pow(levelIndex, 1.6) * 42);
}

function getCumulativeXpAtLevel(level) {
  const safeLevel = Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(level, PLAYER_LEVEL_MIN)));
  let total = 0;
  for (let currentLevel = PLAYER_LEVEL_MIN; currentLevel < safeLevel; currentLevel += 1) {
    total += getXpNeededForLevel(currentLevel);
  }
  return total;
}

function getPlayerTitleForLevel(level) {
  const safeLevel = Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(level, PLAYER_LEVEL_MIN)));
  if (safeLevel >= 100) return "Pixel Legend";
  if (safeLevel >= 80) return "Worldsmith";
  if (safeLevel >= 60) return "Architect";
  if (safeLevel >= 40) return "Trailblazer";
  if (safeLevel >= 25) return "Crafter";
  if (safeLevel >= 10) return "Builder";
  return "Explorer";
}

function normalizeProgressionState(state) {
  const source = toObject(state);
  let level = Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(source.player_level || source.level, PLAYER_LEVEL_MIN)));
  let xp = Math.max(0, toInt(source.player_xp || source.xp, 0));
  let totalXp = Math.max(0, toInt(source.player_total_xp || source.total_xp, 0));

  if (totalXp <= 0 && (level > PLAYER_LEVEL_MIN || xp > 0)) {
    totalXp = getCumulativeXpAtLevel(level) + xp;
  }

  while (level < PLAYER_LEVEL_MAX) {
    const needed = getXpNeededForLevel(level);
    if (needed <= 0 || xp < needed) break;
    xp -= needed;
    level += 1;
  }

  if (level >= PLAYER_LEVEL_MAX) {
    level = PLAYER_LEVEL_MAX;
    xp = 0;
  }

  return {
    player_level: level,
    player_xp: xp,
    player_xp_needed: getXpNeededForLevel(level),
    player_total_xp: totalXp,
    player_title: cleanName(source.player_title || getPlayerTitleForLevel(level)) || getPlayerTitleForLevel(level),
    last_level_up_at: cleanName(source.last_level_up_at || ""),
  };
}

function safeJson(value) {
  if (value === undefined) return {};
  if (value === null) return {};
  if (typeof value !== "object") {
    return { value };
  }
  if (Array.isArray(value)) {
    return { items: value };
  }
  return value;
}

function isUuid(value) {
  const clean = cleanName(value);
  if (clean === "") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean);
}

function normalizeLedgerSource(value) {
  const raw = cleanName(value).toLowerCase();
  if (raw.includes("trade")) return "trade";
  if (raw.includes("vending") || raw.includes("vend")) return "vending";
  if (raw.includes("shop")) return "shop";
  if (raw.includes("seed_place")) return "seed_place";
  if (raw.includes("seed_splice")) return "seed_splice";
  if (raw.includes("seed_harvest")) return "seed_harvest";
  if (raw.includes("drop_pickup")) return "drop_pickup";
  if (raw.includes("drop_create") || raw.includes("drop_from_inventory") || raw.includes("drop_inventory")) return "drop_inventory";
  if (raw.includes("furnace")) return "furnace";
  if (raw.includes("craft")) return "craft";
  if (raw.includes("fishing")) return "fishing";
  if (raw.includes("fish_monger")) return "fish_monger";
  if (raw.includes("admin")) return "admin";
  if (raw.includes("world_block_break")) return "world_block_break";
  return "system";
}

function normalizeSecuritySeverity(value) {
  const raw = cleanName(value).toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "critical") return raw;
  if (raw === "info" || raw === "notice" || raw === "debug") return "low";
  if (raw === "warn" || raw === "warning") return "medium";
  if (raw === "error") return "high";
  return "medium";
}

function normalizeIp(value) {
  const clean = cleanName(value);
  return net.isIP(clean) ? clean : "";
}

class PostgresStore {
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
    this.writeQueueDepth = 0;
    this.maxWriteQueueDepth = Math.max(100, toInt(options.maxWriteQueueDepth, 1000));

    if (!this.enabled) return;
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

  table(name) {
    return `"${this.schema}"."${name}"`;
  }

  async init() {
    if (!this.enabled || !this.pool) return;
    if (this.initialized) return;
    this.initialized = true;

    try {
      await this.pool.query("SELECT 1");
      if (this.autoBootstrap && this.bootstrapSqlPath !== "") {
        await this.applyBootstrapSql(this.bootstrapSqlPath);
      }
      const schemaExists = await this.pool.query("SELECT to_regnamespace($1) AS oid", [this.schema]);
      if (!schemaExists.rows[0] || !schemaExists.rows[0].oid) {
        this.degraded = true;
        this.logger(`[postgres] schema '${this.schema}' is missing. DB mirrors are disabled.`);
        return;
      }
      const accountsTable = await this.pool.query("SELECT to_regclass($1) AS oid", [`${this.schema}.accounts`]);
      if (!accountsTable.rows[0] || !accountsTable.rows[0].oid) {
        this.degraded = true;
        this.logger(`[postgres] table '${this.schema}.accounts' is missing. DB mirrors are disabled.`);
        return;
      }
      try {
        await this.ensureInventorySchema();
      } catch (error) {
        this.degraded = true;
        this.logger("[postgres] inventory schema upgrade failed. DB mirrors are disabled.", error.message);
        return;
      }
      try {
        await this.ensurePersistenceSchema();
      } catch (error) {
        this.degraded = true;
        this.logger("[postgres] persistence schema upgrade failed. DB authority is disabled.", error.message);
        return;
      }
      try {
        await this.ensureProgressionSchema();
      } catch (error) {
        this.progressionReady = false;
        this.logger("[postgres] progression schema upgrade failed. Level mirrors are disabled.", error.message);
      }
      this.ready = true;
      this.logger(`[postgres] connected (schema=${this.schema}).`);
    } catch (error) {
      this.degraded = true;
      this.logger("[postgres] initialization failed. DB mirrors are disabled.", error.message);
    }
  }

  async applyBootstrapSql(sqlPath) {
    const resolved = path.resolve(sqlPath);
    if (!fs.existsSync(resolved)) {
      this.logger(`[postgres] bootstrap SQL not found: ${resolved}`);
      return;
    }
    const sql = String(fs.readFileSync(resolved, "utf8") || "").trim();
    if (sql === "") return;
    await this.pool.query(sql);
    this.logger(`[postgres] applied bootstrap SQL: ${resolved}`);
  }

  async ensureInventorySchema() {
    const inventoryTable = await this.pool.query("SELECT to_regclass($1) AS oid", [`${this.schema}.inventory`]);
    if (!inventoryTable.rows[0] || !inventoryTable.rows[0].oid) {
      throw new Error(`table '${this.schema}.inventory' is missing`);
    }

    await this.pool.query(`
      ALTER TABLE ${this.table("inventory")}
        ALTER COLUMN amount TYPE bigint USING amount::bigint,
        ALTER COLUMN stack_limit TYPE bigint USING stack_limit::bigint,
        ALTER COLUMN stack_limit SET DEFAULT 200;
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
      const tableResult = await this.pool.query("SELECT to_regclass($1) AS oid", [`${this.schema}.${tableName}`]);
      if (!tableResult.rows[0] || !tableResult.rows[0].oid) {
        throw new Error(`table '${this.schema}.${tableName}' is missing`);
      }
    }

    await this.pool.query(`
      ALTER TABLE ${this.table("accounts")}
        ADD COLUMN IF NOT EXISTS password_salt text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
        ADD COLUMN IF NOT EXISTS email_verification_token_hash text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS email_verification_expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS account_state jsonb NOT NULL DEFAULT '{}'::jsonb;

      ALTER TABLE ${this.table("players")}
        ADD COLUMN IF NOT EXISTS player_state jsonb NOT NULL DEFAULT '{}'::jsonb;

      ALTER TABLE ${this.table("worlds")}
        ADD COLUMN IF NOT EXISTS world_state jsonb NOT NULL DEFAULT '{}'::jsonb;

      ALTER TABLE ${this.table("world_snapshots")}
        ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'snapshot';
    `);
  }

  async ensureProgressionSchema() {
    await this.pool.query(`
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
    if (!this.pool) return;
    try {
      await this.pool.end();
    } catch {
      // Ignore shutdown errors.
    }
  }

  async flushWriteQueue() {
    try {
      await this.writeQueue;
    } catch {
      // The queue keeps itself alive after failures; callers handle individual errors.
    }
  }

  enqueueWrite(label, work) {
    if (!this.isReady()) return Promise.resolve(null);
    const cleanLabel = cleanName(label || "transaction") || "transaction";
    if (this.writeQueueDepth >= this.maxWriteQueueDepth) {
      const error = new Error(`write queue is full while scheduling ${cleanLabel}`);
      error.code = "POSTGRES_WRITE_QUEUE_FULL";
      return Promise.reject(error);
    }

    this.writeQueueDepth += 1;
    const run = this.writeQueue
      .catch(() => null)
      .then(async () => {
        try {
          return await work();
        } finally {
          this.writeQueueDepth = Math.max(0, this.writeQueueDepth - 1);
        }
      });
    this.writeQueue = run.then(() => null, () => null);
    return run;
  }

  async withTransaction(work) {
    if (!this.isReady()) return null;
    return this.enqueueWrite("transaction", () => this.withTransactionNow(work));
  }

  async withTransactionNow(work) {
    if (!this.isReady()) return null;

    for (let attempt = 1; attempt <= POSTGRES_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      const client = await this.pool.connect();
      let released = false;
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
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
      } finally {
        if (!released) {
          client.release();
        }
      }
    }

    return null;
  }

  runDetached(label, work) {
    if (!this.isReady()) return;
    Promise.resolve()
      .then(work)
      .catch((error) => {
        this.logger(`[postgres] ${label} failed:`, error.message);
      });
  }

  async ensurePlayerIdentity(client, username, email = "", role = "player", world = "") {
    const cleanUsername = cleanName(username);
    if (cleanUsername === "") return null;
    const providedEmail = cleanName(email || "");
    const cleanEmail = providedEmail || defaultEmailForUsername(cleanUsername);
    const cleanRole = normalizeDbRole(role || "player");
    const cleanWorld = cleanName(world || "");

    const accountResult = await client.query(
      `
      INSERT INTO ${this.table("accounts")} (username, email, password_hash, role, is_active, last_login_at)
      VALUES ($1, $2, '', $3, true, now())
      ON CONFLICT (username) DO UPDATE
        SET email = COALESCE(NULLIF($4, ''), ${this.table("accounts")}.email),
            role = COALESCE(NULLIF(EXCLUDED.role, ''), ${this.table("accounts")}.role),
            is_active = true
      RETURNING account_id
      `,
      [cleanUsername, cleanEmail, cleanRole, providedEmail]
    );
    if (!accountResult.rows[0]) return null;
    const accountId = accountResult.rows[0].account_id;

    const playerResult = await client.query(
      `
      INSERT INTO ${this.table("players")} (account_id, display_name, current_world_name)
      VALUES ($1, $2, NULLIF($3, ''))
      ON CONFLICT (account_id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            current_world_name = COALESCE(NULLIF(EXCLUDED.current_world_name, ''), ${this.table("players")}.current_world_name)
      RETURNING player_id
      `,
      [accountId, cleanUsername, cleanWorld]
    );
    return playerResult.rows[0] ? playerResult.rows[0].player_id : null;
  }

  async lookupPlayerIdByUsername(client, username) {
    const cleanUsername = cleanName(username);
    if (cleanUsername === "") return null;
    const result = await client.query(
      `
      SELECT p.player_id
        FROM ${this.table("players")} p
        JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
       WHERE lower(a.username) = lower($1)
       LIMIT 1
      `,
      [cleanUsername]
    );
    return result.rows[0]?.player_id || null;
  }

  async claimIdempotency(scope, key, username = "", metadata = {}) {
    const cleanScope = cleanName(scope);
    const cleanKey = cleanName(key);
    if (!this.isReady() || cleanScope === "" || cleanKey === "") {
      return { ok: false, duplicate: false };
    }

    try {
      const result = await this.withTransaction(async (client) => {
        let playerId = null;
        if (cleanName(username) !== "") {
          playerId = await this.ensurePlayerIdentity(client, username);
        }
        const insert = await client.query(
          `
          INSERT INTO ${this.table("idempotency_keys")} (scope, key, player_id, metadata, expires_at)
          VALUES ($1, $2, $3, $4::jsonb, now() + interval '1 day')
          ON CONFLICT (scope, key) DO NOTHING
          RETURNING idempotency_key_id
          `,
          [cleanScope, cleanKey, playerId, JSON.stringify(safeJson(metadata))]
        );
        return insert.rowCount > 0;
      });
      return { ok: true, duplicate: !result };
    } catch (error) {
      this.logger("[postgres] idempotency write failed:", error.message);
      return { ok: false, duplicate: false };
    }
  }

  async upsertAccountState(client, account, options = {}) {
    const accountData = toObject(account);
    const username = cleanName(accountData.username || accountData.account_username || accountData.name || "");
    if (username === "") return null;

    const fallbackEmail = defaultEmailForUsername(username);
    const email = cleanName(accountData.email || "") || fallbackEmail;
    const role = normalizeDbRole(accountData.role || "player");
    const touchLogin = Boolean(options.touchLogin);
    const lastSeenAt = normalizeOptionalTimestamp(accountData.last_seen_at || "");
    const lastLoginAt = touchLogin ? new Date().toISOString() : lastSeenAt;

    const result = await client.query(
      `
      INSERT INTO ${this.table("accounts")} (
        username,
        email,
        password_salt,
        password_hash,
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
        COALESCE(NULLIF($2, ''), $13),
        $3,
        $4,
        $5,
        true,
        $6::timestamptz,
        COALESCE($7::timestamptz, now()),
        now(),
        $8,
        $9::timestamptz,
        $10,
        $11::timestamptz,
        $12::jsonb
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
      `,
      [
        username,
        email,
        cleanName(accountData.password_salt || ""),
        String(accountData.password_hash || ""),
        role,
        lastLoginAt,
        normalizeOptionalTimestamp(accountData.created_at || ""),
        Boolean(accountData.email_verified),
        normalizeOptionalTimestamp(accountData.email_verified_at || ""),
        cleanName(accountData.email_verification_token_hash || ""),
        normalizeOptionalTimestamp(accountData.email_verification_expires_at || ""),
        JSON.stringify(safeJson({ ...accountData, username, email, role: accountData.role || role })),
        fallbackEmail,
      ]
    );

    const accountId = result.rows[0]?.account_id || null;
    if (!accountId) return null;

    await client.query(
      `
      INSERT INTO ${this.table("players")} (account_id, display_name, current_world_name, created_at, updated_at)
      VALUES ($1, $2, NULLIF($3, ''), now(), now())
      ON CONFLICT (account_id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            updated_at = now()
      `,
      [accountId, username, cleanName(accountData.current_world_name || "")]
    );

    return accountId;
  }

  async saveAccountState(account, options = {}) {
    if (!this.isReady()) return false;
    try {
      await this.withTransaction(async (client) => {
        await this.upsertAccountState(client, account, options);
      });
      return true;
    } catch (error) {
      this.logger("[postgres] account save failed:", error.message);
      return false;
    }
  }

  async saveAccountStates(accountStates = []) {
    if (!this.isReady()) return false;
    const states = Array.isArray(accountStates) ? accountStates : [];
    if (states.length === 0) return true;

    try {
      await this.withTransaction(async (client) => {
        for (const account of states) {
          await this.upsertAccountState(client, account);
        }
      });
      return true;
    } catch (error) {
      this.logger("[postgres] accounts snapshot save failed:", error.message);
      return false;
    }
  }

  async loadAccountStates() {
    if (!this.isReady()) return [];

    try {
      const result = await this.pool.query(`
        SELECT
          a.username::text AS username,
          a.email::text AS email,
          a.password_salt,
          a.password_hash,
          a.role,
          a.email_verified,
          a.email_verified_at,
          a.email_verification_token_hash,
          a.email_verification_expires_at,
          a.account_state,
          a.created_at,
          a.last_login_at,
          s.session_token_hash,
          s.expires_at AS session_token_expires_at
        FROM ${this.table("accounts")} a
        LEFT JOIN LATERAL (
          SELECT session_token_hash, expires_at
            FROM ${this.table("sessions")}
           WHERE account_id = a.account_id
             AND revoked_at IS NULL
             AND expires_at > now()
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
          username: cleanName(accountState.username || row.username),
          email: cleanName(accountState.email || row.email),
          password_salt: cleanName(accountState.password_salt || row.password_salt || ""),
          password_hash: String(accountState.password_hash || row.password_hash || ""),
          session_token_hash: cleanName(row.session_token_hash || accountState.session_token_hash || ""),
          session_token_expires_at: cleanName(normalizeOptionalTimestamp(row.session_token_expires_at) || accountState.session_token_expires_at || ""),
          email_verified: Boolean(row.email_verified),
          email_verified_at: cleanName(normalizeOptionalTimestamp(row.email_verified_at) || accountState.email_verified_at || ""),
          email_verification_token_hash: cleanName(row.email_verification_token_hash || accountState.email_verification_token_hash || ""),
          email_verification_expires_at: cleanName(normalizeOptionalTimestamp(row.email_verification_expires_at) || accountState.email_verification_expires_at || ""),
          role: cleanName(accountState.role || row.role || "player") || "player",
          created_at: cleanName(accountState.created_at || normalizeOptionalTimestamp(row.created_at) || ""),
          last_seen_at: cleanName(accountState.last_seen_at || normalizeOptionalTimestamp(row.last_login_at) || ""),
        };
      });
    } catch (error) {
      this.logger("[postgres] account load failed:", error.message);
      return [];
    }
  }

  async replaceInventorySnapshot(client, playerId, playerState) {
    if (!playerId) return;

    await client.query(
      `DELETE FROM ${this.table("inventory")} WHERE player_id = $1`,
      [playerId]
    );

    for (const [field, fallbackCategory] of INVENTORY_FIELD_CATEGORY) {
      const bucket = toObject(playerState[field]);
      for (const [itemType, rawAmount] of Object.entries(bucket)) {
        const cleanItemType = cleanName(itemType);
        const amount = Math.max(0, toInt(rawAmount, 0));
        if (cleanItemType === "" || amount <= 0) continue;
        const stackLimit = getInventoryStackLimitForItem(cleanItemType);
        await client.query(
          `
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
          `,
          [playerId, cleanItemType, fallbackCategory, amount, stackLimit]
        );
      }
    }
  }

  async reconcileItemInstancesForInventory(client, playerId, playerState, details = {}) {
    if (!playerId) return;

    const desiredCounts = new Map();
    for (const [field, fallbackCategory] of INVENTORY_FIELD_CATEGORY) {
      const bucket = toObject(playerState[field]);
      for (const [itemType, rawAmount] of Object.entries(bucket)) {
        const cleanItemType = cleanName(itemType);
        if (cleanItemType === "") continue;
        const itemCategory = resolveItemCategory(cleanItemType, fallbackCategory);
        if (!shouldTrackItemInstance(cleanItemType, itemCategory)) continue;
        const amount = Math.max(0, toInt(rawAmount, 0));
        if (amount <= 0) continue;
        const cappedAmount = Math.min(amount, ITEM_INSTANCE_RECONCILE_MAX_PER_ITEM);
        const key = `${cleanItemType}\u0000${itemCategory}`;
        desiredCounts.set(key, (desiredCounts.get(key) || 0) + cappedAmount);
      }
    }

    const activeResult = await client.query(
      `
      SELECT item_instance_id, item_type, item_category
        FROM ${this.table("item_instances")}
       WHERE owner_player_id = $1
         AND state = 'active'
       ORDER BY created_at ASC
       FOR UPDATE
      `,
      [playerId]
    );

    const activeByItem = new Map();
    for (const row of activeResult.rows) {
      const itemType = cleanName(row.item_type);
      const itemCategory = resolveItemCategory(itemType, row.item_category || "");
      if (!shouldTrackItemInstance(itemType, itemCategory)) continue;
      const key = `${itemType}\u0000${itemCategory}`;
      if (!activeByItem.has(key)) activeByItem.set(key, []);
      activeByItem.get(key).push(row.item_instance_id);
    }

    const allKeys = new Set([...desiredCounts.keys(), ...activeByItem.keys()]);
    for (const key of allKeys) {
      const [itemType, itemCategory] = key.split("\u0000");
      const desiredAmount = Math.max(0, desiredCounts.get(key) || 0);
      const activeIds = activeByItem.get(key) || [];

      if (activeIds.length > desiredAmount) {
        const retiredIds = activeIds.slice(desiredAmount);
        await client.query(
          `
          UPDATE ${this.table("item_instances")}
             SET state = $2,
                 metadata = metadata || $3::jsonb,
                 updated_at = now()
           WHERE item_instance_id = ANY($1::uuid[])
          `,
          [
            retiredIds,
            ITEM_INSTANCE_RETIRED_STATE,
            JSON.stringify({
              source: "inventory_snapshot_reconcile",
              details: safeJson(details),
            }),
          ]
        );
      }

      const missingCount = desiredAmount - activeIds.length;
      for (let i = 0; i < missingCount; i += 1) {
        await client.query(
          `
          INSERT INTO ${this.table("item_instances")} (
            item_type,
            item_category,
            owner_player_id,
            state,
            metadata,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 'active', $4::jsonb, now(), now())
          `,
          [
            cleanName(itemType),
            cleanName(itemCategory),
            playerId,
            JSON.stringify({
              source: "inventory_snapshot_reconcile",
              details: safeJson(details),
            }),
          ]
        );
      }
    }
  }

  async createItemInstance(entry = {}) {
    if (!this.isReady()) return { ok: false, reason: "postgres_unavailable" };
    const e = toObject(entry);
    const itemType = cleanName(e.item_type || e.item_id || "");
    const itemCategory = resolveItemCategory(itemType, e.item_category || e.category || "");
    const ownerUsername = cleanName(e.owner_username || e.account_username || e.username || "");
    const worldName = cleanName(e.world || e.world_name || "");
    const state = normalizeItemInstanceState(e.state || ITEM_INSTANCE_ACTIVE_STATE);
    if (itemType === "" || itemCategory === "") return { ok: false, reason: "invalid_item" };
    if (!shouldTrackItemInstance(itemType, itemCategory) && !e.force) {
      return { ok: false, reason: "not_instance_tracked" };
    }

    try {
      return await this.withTransaction(async (client) => {
        const ownerPlayerId = ownerUsername !== ""
          ? await this.lookupPlayerIdByUsername(client, ownerUsername)
          : null;
        if (ownerUsername !== "" && !ownerPlayerId) return { ok: false, reason: "owner_not_found" };
        const worldId = worldName !== ""
          ? await this.ensureWorldIdentity(client, worldName)
          : null;
        const originTransactionId = Number.isFinite(Number(e.origin_transaction_id))
          ? Math.trunc(Number(e.origin_transaction_id))
          : null;

        const result = await client.query(
          `
          INSERT INTO ${this.table("item_instances")} (
            item_type,
            item_category,
            owner_player_id,
            world_id,
            state,
            origin_transaction_id,
            metadata,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
          RETURNING item_instance_id
          `,
          [
            itemType,
            itemCategory,
            ownerPlayerId,
            worldId,
            state,
            originTransactionId,
            JSON.stringify(safeJson(e.metadata || e.details || {})),
          ]
        );

        return {
          ok: true,
          item_instance_id: cleanName(result.rows[0]?.item_instance_id || ""),
          item_type: itemType,
          item_category: itemCategory,
          state,
        };
      });
    } catch (error) {
      this.logger("[postgres] item instance create failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  mirrorItemInstance(entry = {}) {
    if (!this.isReady()) return;
    this.runDetached("mirror item instance", async () => {
      await this.createItemInstance(entry);
    });
  }

  async updateItemInstance(entry = {}) {
    if (!this.isReady()) return { ok: false, reason: "postgres_unavailable" };
    const e = toObject(entry);
    const itemInstanceId = cleanName(e.item_instance_id || e.instance_id || "");
    if (!isUuid(itemInstanceId)) return { ok: false, reason: "invalid_item_instance_id" };

    const ownerUsername = cleanName(e.owner_username || e.account_username || e.username || "");
    const worldName = cleanName(e.world || e.world_name || "");
    const state = normalizeItemInstanceState(e.state || ITEM_INSTANCE_ACTIVE_STATE);

    try {
      return await this.withTransaction(async (client) => {
        const ownerPlayerId = ownerUsername !== ""
          ? await this.lookupPlayerIdByUsername(client, ownerUsername)
          : null;
        if (ownerUsername !== "" && !ownerPlayerId) return { ok: false, reason: "owner_not_found" };
        const worldId = worldName !== ""
          ? await this.ensureWorldIdentity(client, worldName)
          : null;

        const result = await client.query(
          `
          UPDATE ${this.table("item_instances")}
             SET owner_player_id = COALESCE($2, owner_player_id),
                 world_id = COALESCE($3, world_id),
                 state = $4,
                 metadata = metadata || $5::jsonb,
                 updated_at = now()
           WHERE item_instance_id = $1
          RETURNING item_instance_id, item_type, item_category, state
          `,
          [
            itemInstanceId,
            ownerPlayerId,
            worldId,
            state,
            JSON.stringify(safeJson(e.metadata || e.details || {})),
          ]
        );

        const row = result.rows[0];
        if (!row) return { ok: false, reason: "item_instance_not_found" };
        return {
          ok: true,
          item_instance_id: cleanName(row.item_instance_id || ""),
          item_type: cleanName(row.item_type || ""),
          item_category: cleanName(row.item_category || ""),
          state: cleanName(row.state || ""),
        };
      });
    } catch (error) {
      this.logger("[postgres] item instance update failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  async listActiveItemInstances(username, options = {}) {
    if (!this.isReady()) return [];
    const cleanUsername = cleanName(username);
    if (cleanUsername === "") return [];
    const itemType = cleanName(options.item_type || options.item_id || "");
    const itemCategory = resolveItemCategory(itemType, options.item_category || options.category || "");
    const limit = Math.min(500, Math.max(1, toInt(options.limit, 100)));

    try {
      const result = await this.pool.query(
        `
        SELECT ii.item_instance_id, ii.item_type, ii.item_category, ii.state, ii.metadata, ii.created_at, ii.updated_at
          FROM ${this.table("item_instances")} ii
          JOIN ${this.table("players")} p ON p.player_id = ii.owner_player_id
          JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
         WHERE lower(a.username) = lower($1)
           AND ii.state = 'active'
           AND ($2 = '' OR ii.item_type = $2)
           AND ($3 = '' OR ii.item_category = $3)
         ORDER BY ii.created_at ASC
         LIMIT $4
        `,
        [cleanUsername, itemType, itemCategory, limit]
      );

      return result.rows.map((row) => ({
        item_instance_id: cleanName(row.item_instance_id || ""),
        item_type: cleanName(row.item_type || ""),
        item_category: cleanName(row.item_category || ""),
        state: cleanName(row.state || ""),
        metadata: toObject(row.metadata),
        created_at: normalizeOptionalTimestamp(row.created_at),
        updated_at: normalizeOptionalTimestamp(row.updated_at),
      }));
    } catch (error) {
      this.logger("[postgres] item instance list failed:", error.message);
      return [];
    }
  }

  async reconcileItemInstancesForUsername(username, playerState = null, details = {}) {
    if (!this.isReady()) return { ok: false, reason: "postgres_unavailable" };
    const cleanUsername = cleanName(username);
    if (cleanUsername === "") return { ok: false, reason: "invalid_username" };

    try {
      return await this.withTransaction(async (client) => {
        const result = await client.query(
          `
          SELECT p.player_id, p.player_state, a.username::text AS username
            FROM ${this.table("players")} p
            JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
           WHERE lower(a.username) = lower($1)
           LIMIT 1
          `,
          [cleanUsername]
        );

        const row = result.rows[0];
        if (!row?.player_id) return { ok: false, reason: "player_not_found" };

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
    } catch (error) {
      this.logger("[postgres] item instance username reconcile failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  async reconcileStoredItemInstancesFromPlayerStates() {
    if (!this.isReady()) return { ok: false, reason: "postgres_unavailable" };

    try {
      const rows = await this.pool.query(
        `
        SELECT p.player_id, a.username::text AS username, p.player_state
          FROM ${this.table("players")} p
          JOIN ${this.table("accounts")} a ON a.account_id = p.account_id
         WHERE p.player_state IS NOT NULL
           AND p.player_state <> '{}'::jsonb
         ORDER BY a.username ASC
        `
      );

      if (rows.rowCount <= 0) return { ok: true, player_count: 0 };

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
    } catch (error) {
      this.logger("[postgres] stored item instance reconcile failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  async savePlayerState(username, state) {
    if (!this.isReady()) return false;
    const cleanUsername = cleanName(username || state?.account_username || state?.username || "");
    const playerState = safeJson({ ...toObject(state), account_username: cleanUsername });
    if (cleanUsername === "") return false;

    try {
      await this.withTransaction(async (client) => {
        const playerId = await this.ensurePlayerIdentity(client, cleanUsername);
        if (!playerId) return;

        const progression = await this.updatePlayerProgression(client, playerId, playerState);
        await client.query(
          `
          UPDATE ${this.table("players")}
             SET player_health = $2,
                 player_state = $3::jsonb,
                 updated_at = now()
           WHERE player_id = $1
          `,
          [
            playerId,
            Math.max(0, toInt(playerState.player_health, 100)),
            JSON.stringify({
              ...playerState,
              ...(progression || {}),
              account_username: cleanUsername,
            }),
          ]
        );

        await this.replaceInventorySnapshot(client, playerId, playerState);
        await this.reconcileItemInstancesForInventory(client, playerId, playerState, {
          source: "save_player_state",
          username: cleanUsername,
        });
      });
      return true;
    } catch (error) {
      this.logger("[postgres] player state save failed:", error.message);
      return false;
    }
  }

  async savePlayerStates(playerEntries = []) {
    if (!this.isReady()) return false;
    const entries = Array.isArray(playerEntries) ? playerEntries : [];
    for (const entry of entries) {
      const parsed = toObject(entry);
      const username = cleanName(parsed.username || parsed.account_username || parsed.state?.account_username || "");
      const state = toObject(parsed.state || parsed.player_data || parsed);
      if (username === "") continue;
      await this.savePlayerState(username, state);
    }
    return true;
  }

  async loadPlayerStates() {
    if (!this.isReady()) return [];

    try {
      const result = await this.pool.query(`
        SELECT
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

      return result.rows.map((row) => {
        const state = toObject(row.player_state);
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
    } catch (error) {
      this.logger("[postgres] player state load failed:", error.message);
      return [];
    }
  }

  async ensureWorldIdentity(client, worldName) {
    const cleanWorldName = cleanName(worldName || "START") || "START";
    const result = await client.query(
      `
      INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
      VALUES ($1, 100, 70, 1, true, now(), now())
      ON CONFLICT (world_name) DO UPDATE
        SET last_loaded_at = now()
      RETURNING world_id
      `,
      [cleanWorldName]
    );
    return result.rows[0]?.world_id || null;
  }

  async upsertWorldState(client, worldName, worldState) {
    const cleanWorldName = cleanName(worldName || worldState?.world_name || "START") || "START";
    const state = safeJson({ ...toObject(worldState), world_name: cleanWorldName });
    const checksum = jsonChecksum(state);

    const result = await client.query(
      `
      INSERT INTO ${this.table("worlds")} (
        world_name,
        width,
        height,
        world_data_version,
        last_saved_at,
        is_active,
        world_checksum,
        world_state,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, now(), true, $5, $6::jsonb, now(), now())
      ON CONFLICT (world_name) DO UPDATE
        SET width = EXCLUDED.width,
            height = EXCLUDED.height,
            world_data_version = EXCLUDED.world_data_version,
            last_saved_at = now(),
            is_active = true,
            world_checksum = EXCLUDED.world_checksum,
            world_state = EXCLUDED.world_state,
            updated_at = now()
      RETURNING world_id
      `,
      [
        cleanWorldName,
        Math.max(1, toInt(state.width || state.world_width, 100)),
        Math.max(1, toInt(state.height || state.world_height, 70)),
        Math.max(1, toInt(state.world_state_version || state.world_data_version, 1)),
        checksum,
        JSON.stringify(state),
      ]
    );

    return result.rows[0]?.world_id || null;
  }

  async mirrorWorldLockState(client, worldId, worldState) {
    if (!worldId) return;
    const state = toObject(worldState);
    const lock = toObject(state.world_lock);
    const isLocked = Boolean(lock.is_locked);

    if (!isLocked) {
      await client.query(`DELETE FROM ${this.table("world_lock_access")} WHERE world_id = $1`, [worldId]);
      await client.query(`DELETE FROM ${this.table("world_members")} WHERE world_id = $1 AND role <> 'owner'`, [worldId]);
    }

    const ownerName = cleanName(lock.owner_username || lock.owner_name || "");
    let ownerPlayerId = null;
    if (ownerName !== "") {
      ownerPlayerId = await this.ensurePlayerIdentity(client, ownerName);
    }

    await client.query(
      `
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
      `,
      [
        worldId,
        isLocked ? "world_lock" : "none",
        ownerPlayerId,
        isLocked,
        Number.isFinite(Number(lock.lock_grid_x)) ? Math.trunc(Number(lock.lock_grid_x)) : null,
        Number.isFinite(Number(lock.lock_grid_y)) ? Math.trunc(Number(lock.lock_grid_y)) : null,
        JSON.stringify(safeJson(lock)),
      ]
    );

    if (ownerPlayerId) {
      await client.query(
        `
        INSERT INTO ${this.table("world_members")} (world_id, player_id, role, granted_by_player_id, created_at)
        VALUES ($1, $2, 'owner', $2, now())
        ON CONFLICT (world_id, player_id) DO UPDATE
          SET role = 'owner',
              granted_by_player_id = EXCLUDED.granted_by_player_id
        `,
        [worldId, ownerPlayerId]
      );
    }

    const allowedPlayers = Array.isArray(lock.allowed_players) ? lock.allowed_players : [];
    const roles = toObject(lock.player_roles);
    for (const rawName of allowedPlayers) {
      const memberName = cleanName(rawName);
      if (memberName === "" || (ownerName !== "" && memberName.toLowerCase() === ownerName.toLowerCase())) continue;
      const memberPlayerId = await this.ensurePlayerIdentity(client, memberName);
      if (!memberPlayerId) continue;

      const rawRole = cleanName(roles[memberName] || roles[memberName.toUpperCase()] || "member").toLowerCase();
      const memberRole = rawRole === "admin" || rawRole === "builder" ? rawRole : "member";
      const canBuild = memberRole === "admin" || memberRole === "builder" || Boolean(lock.public_build);
      const canManage = memberRole === "admin";

      await client.query(
        `
        INSERT INTO ${this.table("world_members")} (world_id, player_id, role, granted_by_player_id, created_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (world_id, player_id) DO UPDATE
          SET role = EXCLUDED.role,
              granted_by_player_id = EXCLUDED.granted_by_player_id
        `,
        [worldId, memberPlayerId, memberRole, ownerPlayerId]
      );

      await client.query(
        `
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
        VALUES ($1, $2, $3, $4, $4, $5, $5, now(), now())
        ON CONFLICT (world_id, player_id) DO UPDATE
          SET granted_by_player_id = EXCLUDED.granted_by_player_id,
              can_build = EXCLUDED.can_build,
              can_break = EXCLUDED.can_break,
              can_manage_vending = EXCLUDED.can_manage_vending,
              can_manage_lock = EXCLUDED.can_manage_lock,
              updated_at = now()
        `,
        [worldId, memberPlayerId, ownerPlayerId, canBuild, canManage]
      );
    }
  }

  async saveWorldState(worldName, state) {
    if (!this.isReady()) return false;
    const cleanWorldName = cleanName(worldName || state?.world_name || "START") || "START";

    try {
      await this.withTransaction(async (client) => {
        const worldId = await this.upsertWorldState(client, cleanWorldName, state);
        await this.mirrorWorldLockState(client, worldId, state);
      });
      return true;
    } catch (error) {
      this.logger("[postgres] world state save failed:", error.message);
      return false;
    }
  }

  async loadWorldStates() {
    if (!this.isReady()) return [];

    try {
      const result = await this.pool.query(`
        SELECT world_name::text AS world_name, world_state, updated_at, last_saved_at
          FROM ${this.table("worlds")}
         WHERE is_active = true
           AND world_state IS NOT NULL
           AND world_state <> '{}'::jsonb
         ORDER BY world_name ASC
      `);

      return result.rows.map((row) => ({
        world_name: cleanName(row.world_name),
        state: {
          ...toObject(row.world_state),
          world_name: cleanName(toObject(row.world_state).world_name || row.world_name),
        },
        updated_at: normalizeOptionalTimestamp(row.updated_at),
        last_saved_at: normalizeOptionalTimestamp(row.last_saved_at),
      }));
    } catch (error) {
      this.logger("[postgres] world state load failed:", error.message);
      return [];
    }
  }

  async saveWorldSnapshot(worldName, snapshot, options = {}) {
    if (!this.isReady()) return false;
    const cleanWorldName = cleanName(worldName || snapshot?.world_name || "START") || "START";
    const snapshotData = safeJson(snapshot);
    const checksum = jsonChecksum(snapshotData);
    const storeSnapshotData = options.storeSnapshotData !== false;
    const snapshotJson = storeSnapshotData ? JSON.stringify(snapshotData) : null;

    try {
      await this.withTransaction(async (client) => {
        const worldId = await this.upsertWorldState(client, cleanWorldName, snapshotData);
        if (!worldId) return;

        await client.query(
          `
          INSERT INTO ${this.table("world_snapshots")} (
            world_id,
            snapshot_version,
            checksum,
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
            NULLIF($3, ''),
            $4::jsonb,
            COALESCE(NULLIF($5, ''), 'snapshot'),
            COALESCE(NULLIF($6, ''), 'system'),
            now()
          FROM ${this.table("world_snapshots")}
          WHERE world_id = $1
          `,
          [
            worldId,
            checksum,
            cleanName(options.storageUri || ""),
            snapshotJson,
            cleanName(options.reason || "snapshot"),
            cleanName(options.createdBy || "system"),
          ]
        );
      });
      return true;
    } catch (error) {
      this.logger("[postgres] world snapshot save failed:", error.message);
      return false;
    }
  }

  mirrorAdminAction(entry) {
    if (!this.isReady()) return;
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
          const worldResult = await client.query(
            `
            INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
            VALUES ($1, 100, 70, 1, true, now(), now())
            ON CONFLICT (world_name) DO UPDATE
              SET updated_at = now()
            RETURNING world_id
            `,
            [worldName]
          );
          worldId = worldResult.rows[0]?.world_id || null;
        }

        const targetType = cleanName(e.target_type || (e.target_username ? "player" : (worldName ? "world" : "server"))) || "server";
        const targetId = cleanName(e.target_id || e.target_username || worldName || "");

        await client.query(
          `
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
          `,
          [
            adminPlayerId,
            cleanName(e.action || "admin_action"),
            targetType,
            targetId,
            worldId,
            cleanName(e.request_id || ""),
            JSON.stringify(safeJson(e)),
            normalizeOptionalTimestamp(e.at || ""),
          ]
        );
      });
    });
  }

  mirrorAccount(account, options = {}) {
    if (!this.isReady()) return;
    const accountData = toObject(account);
    const username = cleanName(accountData.username);
    if (username === "") return;

    const email = cleanName(accountData.email || "");
    const fallbackEmail = defaultEmailForUsername(username);
    const role = normalizeDbRole(accountData.role || "player");
    const passwordHash = String(accountData.password_hash || "");
    const emailVerified = Boolean(accountData.email_verified);
    const createdAt = cleanName(accountData.created_at || "");
    const lastSeenAt = cleanName(accountData.last_seen_at || "");
    const emailVerifiedAt = cleanName(accountData.email_verified_at || "");
    const touchLogin = Boolean(options.touchLogin);

    this.runDetached("mirror account", async () => {
      await this.withTransaction(async (client) => {
        const accountResult = await client.query(
          `
          INSERT INTO ${this.table("accounts")} (
            username,
            email,
            password_hash,
            role,
            is_active,
            last_login_at,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            COALESCE(NULLIF($2, ''), $6),
            $3,
            $4,
            true,
            ${touchLogin ? "now()" : "NULL"},
            COALESCE(NULLIF($5, '')::timestamptz, now()),
            now()
          )
          ON CONFLICT (username) DO UPDATE
            SET email = COALESCE(NULLIF($2, ''), ${this.table("accounts")}.email),
                password_hash = CASE
                  WHEN EXCLUDED.password_hash <> '' THEN EXCLUDED.password_hash
                  ELSE ${this.table("accounts")}.password_hash
                END,
                role = EXCLUDED.role,
                is_active = true,
                last_login_at = CASE
                  WHEN ${touchLogin ? "true" : "false"} THEN now()
                  ELSE ${this.table("accounts")}.last_login_at
                END
          RETURNING account_id
          `,
          [username, email, passwordHash, role, createdAt, fallbackEmail]
        );

        const accountId = accountResult.rows[0]?.account_id;
        if (!accountId) return;
        await client.query(
          `
          INSERT INTO ${this.table("players")} (account_id, display_name, current_world_name, created_at, updated_at)
          VALUES ($1, $2, NULL, now(), now())
          ON CONFLICT (account_id) DO UPDATE
            SET display_name = EXCLUDED.display_name
          `,
          [accountId, username]
        );
        await client.query(
          `
          UPDATE ${this.table("accounts")}
             SET updated_at = now()
           WHERE account_id = $1
          `,
          [accountId]
        );
        await client.query(
          `
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
          `,
          [accountId, JSON.stringify({
            email_verified: emailVerified,
            email_verified_at: emailVerifiedAt,
            last_seen_at: lastSeenAt,
          })]
        );
      });
    });
  }

  async saveSession(account, details = {}) {
    if (!this.isReady()) return { ok: false, reason: "postgres_unavailable" };
    const accountData = toObject(account);
    const username = cleanName(accountData.username);
    if (username === "") return { ok: false, reason: "invalid_username" };

    const email = cleanName(accountData.email || "") || defaultEmailForUsername(username);
    const role = normalizeDbRole(accountData.role || "player");
    const sessionHash = cleanName(accountData.session_token_hash || "");
    const expiresAt = cleanName(accountData.session_token_expires_at || "");
    const ipAddress = normalizeIp(details.ip || "");
    const userAgent = cleanName(details.userAgent || "");
    if (sessionHash === "") return { ok: false, reason: "missing_session_hash" };

    try {
      await this.withTransaction(async (client) => {
        const playerId = await this.ensurePlayerIdentity(client, username, email, role);
        if (!playerId) return;

        const accountResult = await client.query(
          `SELECT account_id FROM ${this.table("accounts")} WHERE lower(username::text) = lower($1) LIMIT 1`,
          [username]
        );
        const accountId = accountResult.rows[0]?.account_id;
        if (!accountId) return;

        await client.query(
          `
          INSERT INTO ${this.table("sessions")} (
            account_id,
            session_token_hash,
            ip_address,
            user_agent,
            issued_at,
            expires_at,
            last_seen_at
          )
          VALUES (
            $1,
            $2,
            NULLIF($3, '')::inet,
            NULLIF($4, ''),
            now(),
            COALESCE(NULLIF($5, '')::timestamptz, now() + interval '1 day'),
            now()
          )
          ON CONFLICT (session_token_hash) DO UPDATE
            SET expires_at = EXCLUDED.expires_at,
                last_seen_at = now(),
                revoked_at = NULL,
                ip_address = COALESCE(EXCLUDED.ip_address, ${this.table("sessions")}.ip_address),
                user_agent = COALESCE(EXCLUDED.user_agent, ${this.table("sessions")}.user_agent)
          `,
          [accountId, sessionHash, ipAddress, userAgent, expiresAt]
        );
      });

      return {
        ok: true,
        username,
        session_token_hash: sessionHash,
        expires_at: normalizeOptionalTimestamp(expiresAt),
      };
    } catch (error) {
      this.logger("[postgres] session save failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  mirrorSession(account, details = {}) {
    return this.saveSession(account, details);
  }

  async validateSessionToken(username, sessionTokenHash, details = {}) {
    if (!this.isReady()) return { ok: false, reason: "postgres_unavailable" };
    const cleanUsername = cleanName(username);
    const cleanSessionHash = cleanName(sessionTokenHash);
    if (cleanUsername === "" || cleanSessionHash === "") {
      return { ok: false, reason: "invalid_session" };
    }

    const ipAddress = normalizeIp(details.ip || "");
    const userAgent = cleanName(details.userAgent || "");

    try {
      return await this.withTransaction(async (client) => {
        const result = await client.query(
          `
          SELECT
            a.username::text AS username,
            a.email::text AS email,
            a.password_salt,
            a.password_hash,
            a.role,
            a.email_verified,
            a.email_verified_at,
            a.email_verification_token_hash,
            a.email_verification_expires_at,
            a.account_state,
            a.created_at,
            a.last_login_at,
            s.session_token_hash,
            s.expires_at AS session_token_expires_at
          FROM ${this.table("sessions")} s
          JOIN ${this.table("accounts")} a ON a.account_id = s.account_id
          WHERE lower(a.username::text) = lower($1)
            AND s.session_token_hash = $2
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
            AND a.is_active = true
          LIMIT 1
          `,
          [cleanUsername, cleanSessionHash]
        );

        const row = result.rows[0];
        if (!row) return { ok: false, reason: "invalid_or_expired" };

        await client.query(
          `
          UPDATE ${this.table("sessions")}
             SET last_seen_at = now(),
                 ip_address = COALESCE(NULLIF($2, '')::inet, ip_address),
                 user_agent = COALESCE(NULLIF($3, ''), user_agent)
           WHERE session_token_hash = $1
          `,
          [cleanSessionHash, ipAddress, userAgent]
        );

        const accountState = toObject(row.account_state);
        const expiresAt = normalizeOptionalTimestamp(row.session_token_expires_at) || "";
        const account = {
          ...accountState,
          username: cleanName(accountState.username || row.username),
          email: cleanName(accountState.email || row.email),
          password_salt: cleanName(accountState.password_salt || row.password_salt || ""),
          password_hash: String(accountState.password_hash || row.password_hash || ""),
          session_token_hash: cleanSessionHash,
          session_token_expires_at: expiresAt,
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
          session_token_hash: cleanSessionHash,
          expires_at: expiresAt,
          account,
        };
      });
    } catch (error) {
      this.logger("[postgres] session validation failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  async revokeSessionsForUsername(username) {
    if (!this.isReady()) return { ok: false, reason: "postgres_unavailable" };
    const cleanUsername = cleanName(username);
    if (cleanUsername === "") return { ok: false, reason: "invalid_username" };

    try {
      await this.withTransaction(async (client) => {
        const accountResult = await client.query(
          `SELECT account_id FROM ${this.table("accounts")} WHERE lower(username::text) = lower($1) LIMIT 1`,
          [cleanUsername]
        );
        const accountId = accountResult.rows[0]?.account_id;
        if (!accountId) return;
        await client.query(
          `
          UPDATE ${this.table("sessions")}
             SET revoked_at = now()
           WHERE account_id = $1
             AND revoked_at IS NULL
          `,
          [accountId]
        );
      });
      return { ok: true };
    } catch (error) {
      this.logger("[postgres] session revoke failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  revokeSessionsByUsername(username) {
    if (!this.isReady()) return Promise.resolve({ ok: false, reason: "postgres_unavailable" });
    return this.revokeSessionsForUsername(username);
  }

  async revokeSessionByTokenHash(sessionTokenHash) {
    if (!this.isReady()) return { ok: false, reason: "postgres_unavailable" };
    const cleanSessionHash = cleanName(sessionTokenHash);
    if (cleanSessionHash === "") return { ok: false, reason: "invalid_session" };

    try {
      await this.pool.query(
        `
        UPDATE ${this.table("sessions")}
           SET revoked_at = now()
         WHERE session_token_hash = $1
           AND revoked_at IS NULL
        `,
        [cleanSessionHash]
      );
      return { ok: true };
    } catch (error) {
      this.logger("[postgres] session token revoke failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  mirrorPlayerWorld(username, worldName) {
    if (!this.isReady()) return;
    const cleanUsername = cleanName(username);
    const cleanWorld = cleanName(worldName);
    if (cleanUsername === "") return;

    this.runDetached("mirror player world", async () => {
      await this.withTransaction(async (client) => {
        const playerId = await this.ensurePlayerIdentity(client, cleanUsername, "", "player", cleanWorld);
        if (!playerId) return;
        await client.query(
          `
          UPDATE ${this.table("players")}
             SET current_world_name = NULLIF($2, '')
           WHERE player_id = $1
          `,
          [playerId, cleanWorld]
        );
      });
    });
  }

  async updatePlayerProgression(client, playerId, state) {
    if (!this.progressionReady || !playerId) return null;
    const progression = normalizeProgressionState(state);
    await client.query(
      `
      UPDATE ${this.table("players")}
         SET player_level = $2,
             player_xp = $3,
             player_xp_needed = $4,
             player_total_xp = $5,
             player_title = $6,
             last_level_up_at = COALESCE(NULLIF($7, '')::timestamptz, last_level_up_at),
             updated_at = now()
       WHERE player_id = $1
      `,
      [
        playerId,
        progression.player_level,
        progression.player_xp,
        progression.player_xp_needed,
        progression.player_total_xp,
        progression.player_title,
        progression.last_level_up_at,
      ]
    );
    return progression;
  }

  mirrorPlayerProgression(username, state, event = {}) {
    if (!this.isReady() || !this.progressionReady) return;
    const cleanUsername = cleanName(username);
    if (cleanUsername === "") return;
    const playerState = toObject(state);
    const progressionEvent = toObject(event);

    this.runDetached("mirror player progression", async () => {
      await this.withTransaction(async (client) => {
        const playerId = await this.ensurePlayerIdentity(client, cleanUsername);
        if (!playerId) return;
        await this.updatePlayerProgression(client, playerId, playerState);

        const xpDelta = Math.max(0, toInt(progressionEvent.xp_gained, 0));
        if (xpDelta <= 0) return;

        await client.query(
          `
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
          `,
          [
            playerId,
            cleanName(progressionEvent.source || "system") || "system",
            xpDelta,
            Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(progressionEvent.level_before, 1))),
            Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(progressionEvent.level_after, 1))),
            Math.max(0, toInt(progressionEvent.xp_before, 0)),
            Math.max(0, toInt(progressionEvent.xp_after, 0)),
            Math.max(0, toInt(progressionEvent.total_xp_after, playerState.player_total_xp || 0)),
            JSON.stringify(safeJson(progressionEvent.details)),
          ]
        );
      });
    });
  }

  mirrorInventorySnapshot(username, state) {
    if (!this.isReady()) return;
    const cleanUsername = cleanName(username);
    const playerState = toObject(state);
    if (cleanUsername === "") return;

    this.runDetached("mirror inventory snapshot", async () => {
      await this.withTransaction(async (client) => {
        const playerId = await this.ensurePlayerIdentity(client, cleanUsername);
        if (!playerId) return;

        await this.updatePlayerProgression(client, playerId, playerState);

        await client.query(
          `DELETE FROM ${this.table("inventory")} WHERE player_id = $1`,
          [playerId]
        );

        for (const [field, fallbackCategory] of INVENTORY_FIELD_CATEGORY) {
          const bucket = toObject(playerState[field]);
          for (const [itemType, rawAmount] of Object.entries(bucket)) {
            const cleanItemType = cleanName(itemType);
            const amount = Math.max(0, toInt(rawAmount, 0));
            if (cleanItemType === "" || amount <= 0) continue;
            const stackLimit = getInventoryStackLimitForItem(cleanItemType);
            await client.query(
              `
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
              `,
            [playerId, cleanItemType, fallbackCategory, amount, stackLimit]
            );
          }
        }

        await this.reconcileItemInstancesForInventory(client, playerId, playerState, {
          source: "mirror_inventory_snapshot",
          username: cleanUsername,
        });
      });
    });
  }

  mirrorItemLedger(entry) {
    if (!this.isReady()) return;
    const e = toObject(entry);
    const username = cleanName(e.account_username);
    const itemType = cleanName(e.item_id);
    const itemCategory = cleanName(e.item_category);
    if (username === "" || itemType === "") return;

    this.runDetached("mirror item ledger", async () => {
      await this.withTransaction(async (client) => {
        const playerId = await this.ensurePlayerIdentity(client, username, "", cleanName(e.actor_role || "player"), cleanName(e.world || ""));
        if (!playerId) return;

        const worldIdResult = await client.query(
          `
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `,
          [cleanName(e.world || "START") || "START"]
        );
        const worldId = worldIdResult.rows[0]?.world_id || null;

        await client.query(
          `
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
          `,
          [
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
          ]
        );

        await client.query(
          `
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
          `,
          [
            playerId,
            itemType,
            itemCategory || "block",
            Math.max(0, toInt(e.balance_after, 0)),
            getInventoryStackLimitForItem(itemType, e.stack_limit || DEFAULT_INVENTORY_STACK_LIMIT),
          ]
        );
      });
    });
  }

  mirrorGemLedger(entry) {
    if (!this.isReady()) return;
    const e = toObject(entry);
    const username = cleanName(e.account_username);
    if (username === "") return;

    this.runDetached("mirror gem ledger", async () => {
      await this.withTransaction(async (client) => {
        const playerId = await this.ensurePlayerIdentity(client, username);
        if (!playerId) return;
        await client.query(
          `
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
          `,
          [
            playerId,
            toInt(e.quantity_delta, 0),
            cleanName(e.reason || "update") || "update",
            cleanName(e.source_type || ""),
            cleanName(e.source_id || ""),
            Math.max(0, toInt(e.balance_after, 0)),
            JSON.stringify(safeJson(e.details)),
            cleanName(e.at || ""),
          ]
        );
      });
    });
  }

  mirrorShopPurchase(entry) {
    if (!this.isReady()) return;
    const e = toObject(entry);
    const username = cleanName(e.account_username);
    if (username === "") return;
    const rewards = Array.isArray(e.rewards) ? e.rewards : [];
    const matchedReward = rewards.find((reward) => cleanName(reward?.item_id || "") === cleanName(e.item_id || ""));
    const itemCategory = cleanName(matchedReward?.item_category || "block") || "block";
    const amount = Math.max(1, toInt(matchedReward?.amount, 1));

    this.runDetached("mirror shop purchase", async () => {
      await this.withTransaction(async (client) => {
        const playerId = await this.ensurePlayerIdentity(client, username);
        if (!playerId) return;
        await client.query(
          `
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
          `,
          [
            playerId,
            cleanName(e.listing_id || "main_shop"),
            cleanName(e.item_id || ""),
            itemCategory,
            amount,
            Math.max(0, toInt(e.price_gems, 0)),
            cleanName(e.purchase_id || ""),
            JSON.stringify({ rewards }),
            cleanName(e.at || ""),
          ]
        );
      });
    });
  }

  mirrorTradeTransaction(entry) {
    if (!this.isReady()) return;
    const e = toObject(entry);
    const requester = cleanName(e.requester_username);
    const target = cleanName(e.target_username);
    if (requester === "" || target === "") return;

    this.runDetached("mirror trade", async () => {
      await this.withTransaction(async (client) => {
        const requesterId = await this.ensurePlayerIdentity(client, requester);
        const targetId = await this.ensurePlayerIdentity(client, target);
        if (!requesterId || !targetId) return;

        const worldName = cleanName(e.world || "START") || "START";
        const worldResult = await client.query(
          `
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `,
          [worldName]
        );
        const worldId = worldResult.rows[0]?.world_id || null;

        const tradeIdCandidate = cleanName(e.trade_id || "");
        const tradeIdUuid = isUuid(tradeIdCandidate) ? tradeIdCandidate : null;
        const tradeResult = await client.query(
          `
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
          `,
          [
            tradeIdUuid,
            worldId,
            requesterId,
            targetId,
            cleanName(e.status || "completed"),
            cleanName(e.at || ""),
          ]
        );
        const tradeId = tradeResult.rows[0]?.trade_id;
        if (!tradeId) return;

        await client.query(
          `DELETE FROM ${this.table("trade_items")} WHERE trade_id = $1`,
          [tradeId]
        );

        const requesterOffer = Array.isArray(e.requester_offer) ? e.requester_offer : [];
        const targetOffer = Array.isArray(e.target_offer) ? e.target_offer : [];
        for (let slot = 0; slot < requesterOffer.length; slot += 1) {
          const item = toObject(requesterOffer[slot]);
          const itemId = cleanName(item.item_id);
          if (itemId === "") continue;
          await client.query(
            `
            INSERT INTO ${this.table("trade_items")} (
              trade_id,
              from_player_id,
              slot_index,
              item_type,
              item_category,
              amount
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [tradeId, requesterId, slot, itemId, cleanName(item.item_category || "block"), Math.max(1, toInt(item.amount, 1))]
          );
        }
        for (let slot = 0; slot < targetOffer.length; slot += 1) {
          const item = toObject(targetOffer[slot]);
          const itemId = cleanName(item.item_id);
          if (itemId === "") continue;
          await client.query(
            `
            INSERT INTO ${this.table("trade_items")} (
              trade_id,
              from_player_id,
              slot_index,
              item_type,
              item_category,
              amount
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [tradeId, targetId, slot, itemId, cleanName(item.item_category || "block"), Math.max(1, toInt(item.amount, 1))]
          );
        }
      });
    });
  }

  mirrorVendingTransaction(entry) {
    if (!this.isReady()) return;
    const e = toObject(entry);
    const owner = cleanName(e.owner_username);
    if (owner === "") return;

    this.runDetached("mirror vending", async () => {
      await this.withTransaction(async (client) => {
        const ownerId = await this.ensurePlayerIdentity(client, owner);
        if (!ownerId) return;
        const buyerId = cleanName(e.buyer_username) !== "" ? await this.ensurePlayerIdentity(client, cleanName(e.buyer_username)) : null;
        const worldName = cleanName(e.world || "START") || "START";
        const worldResult = await client.query(
          `
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `,
          [worldName]
        );
        const worldId = worldResult.rows[0]?.world_id;
        if (!worldId) return;
        const amount = Math.max(0, toInt(e.amount, 0));
        const itemId = cleanName(e.item_id || "");
        if (amount <= 0 || itemId === "") return;

        await client.query(
          `
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
          `,
          [
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
          ]
        );
      });
    });
  }

  async applyDropPickupTransaction(entry = {}) {
    if (!this.isReady()) {
      return { ok: false, reason: "postgres_unavailable" };
    }

    const e = toObject(entry);
    const username = cleanName(e.account_username);
    const itemType = cleanName(e.item_type);
    const itemCategory = cleanName(e.item_category || "block");
    const amount = toInt(e.amount, 0);
    const expectedBeforeRaw = Number(e.expected_before_amount);
    const hasExpectedBefore = Number.isFinite(expectedBeforeRaw) && expectedBeforeRaw >= 0;
    const expectedBeforeAmount = hasExpectedBefore ? Math.max(0, toInt(expectedBeforeRaw, 0)) : 0;
    const requestedStackLimit = getInventoryStackLimitForItem(itemType, e.stack_limit || DEFAULT_INVENTORY_STACK_LIMIT);
    const allowStateRepair = Boolean(e.allow_state_repair);
    const requestId = cleanName(e.request_id);
    const worldName = cleanName(e.world || "START") || "START";
    const dropId = cleanName(e.drop_id || "");
    const sourceId = cleanName(e.source_id || "");
    const at = cleanName(e.at || "");
    const correlationId = isUuid(cleanName(e.correlation_id || "")) ? cleanName(e.correlation_id || "") : null;

    if (username === "" || itemType === "" || amount <= 0) {
      return { ok: false, reason: "invalid_payload" };
    }

    try {
      return await this.withTransaction(async (client) => {
        const playerId = await this.ensurePlayerIdentity(client, username);
        if (!playerId) return { ok: false, reason: "player_not_found" };

        const worldResult = await client.query(
          `
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `,
          [worldName]
        );
        const worldId = worldResult.rows[0]?.world_id || null;

        const itemInventory = await client.query(
          `
          SELECT amount, stack_limit
            FROM ${this.table("inventory")}
           WHERE player_id = $1
             AND item_type = $2
             AND item_category = $3
           FOR UPDATE
          `,
          [playerId, itemType, itemCategory]
        );
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
          return { ok: false, reason: "insufficient_capacity" };
        }
        if (afterAmount > stackLimit) {
          return { ok: false, reason: "insufficient_capacity" };
        }

        if (existing) {
          await client.query(
            `
            UPDATE ${this.table("inventory")}
               SET amount = $4,
                   stack_limit = $5,
                   row_version = ${this.table("inventory")}.row_version + 1,
                   updated_at = now()
             WHERE player_id = $1
               AND item_type = $2
               AND item_category = $3
            `,
            [playerId, itemType, itemCategory, afterAmount, stackLimit]
          );
        } else {
          await client.query(
            `
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
            `,
            [playerId, itemType, itemCategory, afterAmount, stackLimit]
          );
        }

        await client.query(
          `
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
          `,
          [
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
              repaired_inventory_before_amount: repairedFromAmount,
              expected_before_amount: hasExpectedBefore ? expectedBeforeAmount : null,
            }),
            at,
          ]
        );

        return {
          ok: true,
          before_amount: beforeAmount,
          after_amount: afterAmount,
          item_type: itemType,
          item_category: itemCategory,
          repaired_inventory_before_amount: repairedFromAmount,
        };
      });
    } catch (error) {
      this.logger("[postgres] drop_pickup transaction failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
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

    const requesterOffers = Array.isArray(e.requester_offers) ? e.requester_offers : [];
    const targetOffers = Array.isArray(e.target_offers) ? e.target_offers : [];
    if (requester === "" || target === "") {
      return { ok: false, reason: "invalid_payload" };
    }

    const sanitizeOfferEntries = (offerItems) => {
      const result = [];
      for (const item of offerItems) {
        const parsed = toObject(item);
        const itemType = cleanName(parsed.item_id || "");
        const itemCategory = cleanName(parsed.item_category || "block");
        const amount = toInt(parsed.amount, 0);
        if (itemType === "" || amount <= 0) continue;
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
        if (itemType === "" || itemCategory === "") continue;
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

    const buildDeltaMap = (offerItems) => {
      const deltas = new Map();
      for (const item of offerItems) {
        const key = `${item.item_id}\u0000${item.item_category || "block"}`;
        deltas.set(key, (deltas.get(key) || 0) + item.amount);
      }
      return deltas;
    };

    const outgoingRequester = buildDeltaMap(normalizedRequesterOffers);
    const incomingRequester = buildDeltaMap(normalizedTargetOffers);
    const outgoingTarget = buildDeltaMap(normalizedTargetOffers);
    const incomingTarget = buildDeltaMap(normalizedRequesterOffers);

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
        if (!Number.isFinite(delta) || delta === 0) continue;
        const [itemType, itemCategory] = String(key).split("\u0000");
        const safeItemType = cleanName(itemType);
        const safeCategory = cleanName(itemCategory || "block");
        if (safeItemType === "" || safeCategory === "") {
          return { ok: false, reason: "invalid_offer_item", item_type: safeItemType, item_category: safeCategory };
        }

        const inventoryResult = await client.query(
          `
          SELECT amount, stack_limit
            FROM ${this.table("inventory")}
           WHERE player_id = $1
             AND item_type = $2
             AND item_category = $3
           FOR UPDATE
          `,
          [playerId, safeItemType, safeCategory]
        );

        const inventoryRow = inventoryResult.rows[0];
        const baselineEntry = baselineMap instanceof Map ? baselineMap.get(`${safeItemType}\u0000${safeCategory}`) : null;
        const storedBeforeAmount = Math.max(0, toInt(inventoryRow?.amount || 0, 0));
        let beforeAmount = storedBeforeAmount;
        let repairedFromAmount = null;
        const itemDefaultStackLimit = getInventoryStackLimitForItem(safeItemType);
        const existingStackLimit = clampStackLimit(inventoryRow?.stack_limit || itemDefaultStackLimit, itemDefaultStackLimit);
        const baselineStackLimit = baselineEntry ? clampStackLimit(baselineEntry.stack_limit, itemDefaultStackLimit) : itemDefaultStackLimit;
        const stackLimit = Math.max(existingStackLimit, baselineStackLimit);
        if (baselineEntry) {
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
          await client.query(
            `
            UPDATE ${this.table("inventory")}
               SET amount = $4,
                   stack_limit = $5,
                   row_version = ${this.table("inventory")}.row_version + 1,
                   updated_at = now()
             WHERE player_id = $1
               AND item_type = $2
               AND item_category = $3
            `,
            [playerId, safeItemType, safeCategory, afterAmount, stackLimit]
          );
        } else {
          await client.query(
            `
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
            `,
            [playerId, safeItemType, safeCategory, afterAmount, stackLimit]
          );
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
        const requesterId = await this.ensurePlayerIdentity(client, requester);
        const targetId = await this.ensurePlayerIdentity(client, target);
        if (!requesterId || !targetId) return { ok: false, reason: "player_not_found" };

        const worldResult = await client.query(
          `
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `,
          [worldName]
        );
        const worldId = worldResult.rows[0]?.world_id || null;

        const requesterInventory = await applyInventoryDeltas(client, requesterId, netRequester, requesterBaseline);
        if (!requesterInventory || requesterInventory.ok === false) return requesterInventory;
        const targetInventory = await applyInventoryDeltas(client, targetId, netTarget, targetBaseline);
        if (!targetInventory || targetInventory.ok === false) return targetInventory;

        const tradeResult = await client.query(
          `
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
          `,
          [
            tradeIdUuid,
            worldId,
            requesterId,
            targetId,
            at || new Date().toISOString(),
          ]
        );

        const tradeId = tradeResult.rows[0]?.trade_id;
        if (!tradeId) return { ok: false, reason: "trade_record_failed" };

        const txTimestamp = new Date().toISOString();
        for (const item of normalizedRequesterOffers) {
          await client.query(
            `
            INSERT INTO ${this.table("trade_items")} (
              trade_id,
              from_player_id,
              slot_index,
              item_type,
              item_category,
              amount
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [tradeId, requesterId, 0, item.item_id, item.item_category || "block", item.amount]
          ).catch(() => {});
        }

        for (const [slot, item] of normalizedRequesterOffers.entries()) {
          await client.query(
            `
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
            `,
            [tradeId, requesterId, slot, item.item_id, item.item_category || "block", item.amount]
          );
        }

        for (const [slot, item] of normalizedTargetOffers.entries()) {
          await client.query(
            `
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
            `,
            [tradeId, targetId, slot, item.item_id, item.item_category || "block", item.amount]
          );
        }

        for (const entry of requesterInventory.ledgerEntries) {
          if (entry.delta > 0) {
            await client.query(
              `
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
              `,
              [
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
              ]
            );
          } else {
            await client.query(
              `
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
              `,
              [
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
              ]
            );
          }
        }

        for (const entry of targetInventory.ledgerEntries) {
          if (entry.delta > 0) {
            await client.query(
              `
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
              `,
              [
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
              ]
            );
          } else {
            await client.query(
              `
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
              `,
              [
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
              ]
            );
          }
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
          timestamp: txTimestamp,
        };
      });
    } catch (error) {
      this.logger("[postgres] trade finalization transaction failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
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
    const correlationId = isUuid(transactionId) ? transactionId : null;

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
        if (baselineItemType === "" || baselineCategory === "") continue;
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
        const ownerId = await this.ensurePlayerIdentity(client, owner);
        const buyerId = await this.ensurePlayerIdentity(client, buyer);
        if (!ownerId || !buyerId) return { ok: false, reason: "player_not_found" };

        const worldResult = await client.query(
          `
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_loaded_at = now()
          RETURNING world_id
          `,
          [worldName]
        );
        const worldId = worldResult.rows[0]?.world_id;
        if (!worldId) return { ok: false, reason: "world_record_failed" };

        const lockRow = await client.query(
          `
          SELECT amount, stack_limit
            FROM ${this.table("inventory")}
           WHERE player_id = $1
             AND item_type = 'world_lock'
             AND item_category = 'block'
           FOR UPDATE
          `,
          [buyerId]
        );
        const lockInventory = lockRow.rows[0];
        const lockBaseline = buyerBaseline.get("world_lock\u0000block");
        const storedBeforeLock = Math.max(0, toInt(lockInventory?.amount || 0, 0));
        let beforeLock = storedBeforeLock;
        let repairedBeforeLock = null;
        const lockDefaultStackLimit = getInventoryStackLimitForItem("world_lock");
        const lockStack = Math.max(
          clampStackLimit(lockInventory?.stack_limit || lockDefaultStackLimit, lockDefaultStackLimit),
          lockBaseline ? clampStackLimit(lockBaseline.stack_limit, lockDefaultStackLimit) : lockDefaultStackLimit
        );
        if (lockBaseline) {
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
        if (lockInventory) {
          await client.query(
            `
            UPDATE ${this.table("inventory")}
               SET amount = $2,
                   stack_limit = $3,
                   row_version = ${this.table("inventory")}.row_version + 1,
                   updated_at = now()
             WHERE player_id = $1
               AND item_type = 'world_lock'
               AND item_category = 'block'
            `,
            [buyerId, afterLock, lockStack]
          );
        } else {
          await client.query(
            `
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
            `,
            [buyerId, afterLock, lockStack]
          );
        }

        const itemRow = await client.query(
          `
          SELECT amount, stack_limit
            FROM ${this.table("inventory")}
           WHERE player_id = $1
             AND item_type = $2
             AND item_category = $3
           FOR UPDATE
          `,
          [buyerId, itemType, itemCategory]
        );
        const itemInventory = itemRow.rows[0];
        const itemBaseline = buyerBaseline.get(`${itemType}\u0000${itemCategory}`);
        const storedBeforeItem = Math.max(0, toInt(itemInventory?.amount || 0, 0));
        let beforeItem = storedBeforeItem;
        let repairedBeforeItem = null;
        const itemDefaultStackLimit = getInventoryStackLimitForItem(itemType);
        const itemStack = Math.max(
          clampStackLimit(itemInventory?.stack_limit || itemDefaultStackLimit, itemDefaultStackLimit),
          itemBaseline ? clampStackLimit(itemBaseline.stack_limit, itemDefaultStackLimit) : itemDefaultStackLimit
        );
        if (itemBaseline) {
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

        if (itemInventory) {
          await client.query(
            `
            UPDATE ${this.table("inventory")}
               SET amount = $4,
                   stack_limit = $5,
                   row_version = ${this.table("inventory")}.row_version + 1,
                   updated_at = now()
             WHERE player_id = $1
               AND item_type = $2
               AND item_category = $3
            `,
            [buyerId, itemType, itemCategory, afterItem, itemStack]
          );
        } else {
          await client.query(
            `
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
            `,
            [buyerId, itemType, itemCategory, afterItem, itemStack]
          );
        }

        await client.query(
          `
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
          `,
          [
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
            }),
            at,
          ]
        );

        await client.query(
          `
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
          `,
          [
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
              repaired_inventory_before_amount: repairedBeforeLock,
            }),
            at,
          ]
        );

        await client.query(
          `
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
          `,
          [
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
              item_id: itemType,
              world_x: x,
              world_y: y,
              repaired_inventory_before_amount: repairedBeforeItem,
            }),
            at,
          ]
        );

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
          world_id: worldId,
        };
      });
    } catch (error) {
      this.logger("[postgres] vend buy transaction failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  async issuePunishment(entry = {}) {
    if (!this.isReady()) return { ok: false, reason: "postgres_unavailable" };
    const e = toObject(entry);
    const targetUsername = cleanName(e.target_username || e.username || e.player_username || "");
    const issuerUsername = cleanName(e.issued_by_username || e.admin_username || e.actor_username || "");
    const punishmentType = normalizePunishmentType(e.punishment_type || e.type || "");
    const scope = normalizePunishmentScope(e.scope || "");
    const worldName = cleanName(e.world || e.world_name || "");
    const reason = cleanName(e.reason || "") || "No reason provided.";
    const endsAt = normalizePunishmentEndsAt(e);

    if (targetUsername === "") return { ok: false, reason: "invalid_target" };
    if (punishmentType === "") return { ok: false, reason: "invalid_punishment_type" };
    if (scope === "world" && worldName === "") return { ok: false, reason: "world_required" };

    try {
      return await this.withTransaction(async (client) => {
        const playerId = await this.lookupPlayerIdByUsername(client, targetUsername);
        if (!playerId) return { ok: false, reason: "player_not_found" };
        const issuedByPlayerId = issuerUsername !== ""
          ? await this.lookupPlayerIdByUsername(client, issuerUsername)
          : null;
        const worldId = scope === "world"
          ? await this.ensureWorldIdentity(client, worldName)
          : null;

        const result = await client.query(
          `
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
          `,
          [
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
          ]
        );

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
    } catch (error) {
      this.logger("[postgres] punishment issue failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  mirrorPunishment(entry = {}) {
    if (!this.isReady()) return;
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

  async revokePunishment(entry = {}) {
    if (!this.isReady()) return { ok: false, reason: "postgres_unavailable" };
    const e = toObject(entry);
    const punishmentId = toInt(e.punishment_id, 0);
    const targetUsername = cleanName(e.target_username || e.username || e.player_username || "");
    const punishmentType = normalizePunishmentType(e.punishment_type || e.type || "");
    const scope = normalizePunishmentScope(e.scope || "");
    const worldName = cleanName(e.world || e.world_name || "");
    const revokedBy = cleanName(e.revoked_by_username || e.admin_username || e.actor_username || "");

    if (punishmentId <= 0 && targetUsername === "") return { ok: false, reason: "invalid_target" };

    try {
      return await this.withTransaction(async (client) => {
        let playerId = null;
        if (targetUsername !== "") {
          playerId = await this.lookupPlayerIdByUsername(client, targetUsername);
          if (!playerId) return { ok: false, reason: "player_not_found" };
        }
        const worldId = worldName !== "" ? await this.ensureWorldIdentity(client, worldName) : null;
        const result = await client.query(
          `
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
          `,
          [
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
          ]
        );

        return {
          ok: true,
          revoked_count: result.rowCount,
          punishment_ids: result.rows.map((row) => toInt(row.punishment_id, 0)).filter((id) => id > 0),
        };
      });
    } catch (error) {
      this.logger("[postgres] punishment revoke failed:", error.message);
      return { ok: false, reason: "database_error", message: error.message };
    }
  }

  async getActivePunishments(username, options = {}) {
    if (!this.isReady()) return [];
    const cleanUsername = cleanName(username);
    if (cleanUsername === "") return [];
    const punishmentType = normalizePunishmentType(options.punishment_type || options.type || "");
    const scope = options.scope === undefined ? "" : normalizePunishmentScope(options.scope || "");
    const worldName = cleanName(options.world || options.world_name || "");

    try {
      const result = await this.pool.query(
        `
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
        `,
        [cleanUsername, punishmentType, scope, worldName]
      );

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
    } catch (error) {
      this.logger("[postgres] active punishment lookup failed:", error.message);
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
    if (!this.isReady()) return;
    const e = toObject(entry);
    const worldName = cleanName(e.world);
    if (worldName === "") return;

    this.runDetached("mirror world change", async () => {
      await this.withTransaction(async (client) => {
        const worldResult = await client.query(
          `
          INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
          VALUES ($1, 100, 70, 1, true, now(), now())
          ON CONFLICT (world_name) DO UPDATE
            SET last_saved_at = now(),
                updated_at = now()
          RETURNING world_id
          `,
          [worldName]
        );
        const worldId = worldResult.rows[0]?.world_id;
        if (!worldId) return;

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
        const layer = cleanName(e.layer || "").toLowerCase() === "background" ? "background" : "foreground";
        const sourceId = cleanName(e.source_id || "");
        const txUuid = isUuid(sourceId) ? sourceId : null;

        await client.query(
          `
          INSERT INTO ${this.table("world_block_changes")} (
            world_id,
            player_id,
            action,
            layer,
            block_x,
            block_y,
            block_type_after,
            tx_uuid,
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
            NULLIF($7, ''),
            $8::uuid,
            $9::jsonb,
            COALESCE(NULLIF($10, '')::timestamptz, now())
          )
          `,
          [
            worldId,
            playerId,
            mappedAction,
            layer,
            Number.isFinite(Number(e.x)) ? Math.trunc(Number(e.x)) : 0,
            Number.isFinite(Number(e.y)) ? Math.trunc(Number(e.y)) : 0,
            cleanName(e.block_type || ""),
            txUuid,
            JSON.stringify({
              source_type: cleanName(e.source_type || ""),
              details: safeJson(e.details),
            }),
            cleanName(e.at || ""),
          ]
        );
      });
    });
  }

  mirrorSecurityEvent(entry) {
    if (!this.isReady()) return;
    const e = toObject(entry);

    this.runDetached("mirror security event", async () => {
      await this.withTransaction(async (client) => {
        let playerId = null;
        let accountId = null;
        const username = cleanName(e.actor_username || "");
        if (username !== "") {
          playerId = await this.ensurePlayerIdentity(client, username, "", cleanName(e.actor_role || "player"));
          const accountResult = await client.query(
            `SELECT account_id FROM ${this.table("accounts")} WHERE username = $1 LIMIT 1`,
            [username]
          );
          accountId = accountResult.rows[0]?.account_id || null;
        }

        let worldId = null;
        const worldName = cleanName(e.world || "");
        if (worldName !== "") {
          const worldResult = await client.query(
            `
            INSERT INTO ${this.table("worlds")} (world_name, width, height, world_data_version, is_active, created_at, updated_at)
            VALUES ($1, 100, 70, 1, true, now(), now())
            ON CONFLICT (world_name) DO UPDATE
              SET updated_at = now()
            RETURNING world_id
            `,
            [worldName]
          );
          worldId = worldResult.rows[0]?.world_id || null;
        }

        await client.query(
          `
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
          `,
          [
            accountId,
            playerId,
            worldId,
            normalizeSecuritySeverity(e.severity || "medium"),
            cleanName(e.event || "security_event"),
            cleanName(e.request_id || ""),
            normalizeIp(e.ip || ""),
            JSON.stringify(safeJson(e.details)),
            cleanName(e.at || ""),
          ]
        );
      });
    });
  }
}

module.exports = PostgresStore;
