"use strict";

const fs = require("fs");
const net = require("net");
const path = require("path");

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
  ["shirt_inventory", "shirt"],
  ["pants_inventory", "pants"],
  ["currency_inventory", "currency"],
  ["material_inventory", "material"],
  ["lure_inventory", "lure"],
  ["fish_inventory", "fish"],
]);

const PLAYER_LEVEL_MIN = 1;
const PLAYER_LEVEL_MAX = 100;
const PLAYER_XP_FIRST_LEVEL = 100;
const POSTGRES_TRANSACTION_MAX_ATTEMPTS = 3;
const POSTGRES_TRANSACTION_RETRY_BASE_DELAY_MS = 35;

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

function defaultEmailForUsername(username) {
  const base = cleanName(username).toLowerCase().replace(/[^a-z0-9_]/g, "");
  return `${base || "player"}@pixelmania.local`;
}

function getXpNeededForLevel(level) {
  const safeLevel = Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(level, PLAYER_LEVEL_MIN)));
  if (safeLevel >= PLAYER_LEVEL_MAX) return 0;

  const levelIndex = safeLevel - PLAYER_LEVEL_MIN;
  return PLAYER_XP_FIRST_LEVEL + (levelIndex * 45) + Math.floor(Math.pow(levelIndex, 1.45) * 18);
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

  async ensureProgressionSchema() {
    await this.pool.query(`
      ALTER TABLE ${this.table("players")}
        ADD COLUMN IF NOT EXISTS player_level integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS player_xp bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS player_xp_needed bigint NOT NULL DEFAULT 100,
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
    if (!this.pool) return;
    try {
      await this.pool.end();
    } catch {
      // Ignore shutdown errors.
    }
  }

  async withTransaction(work) {
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
    const cleanRole = cleanName(role || "player") || "player";
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

  mirrorAccount(account, options = {}) {
    if (!this.isReady()) return;
    const accountData = toObject(account);
    const username = cleanName(accountData.username);
    if (username === "") return;

    const email = cleanName(accountData.email || "");
    const fallbackEmail = defaultEmailForUsername(username);
    const role = cleanName(accountData.role || "player") || "player";
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

  mirrorSession(account, details = {}) {
    if (!this.isReady()) return;
    const accountData = toObject(account);
    const username = cleanName(accountData.username);
    if (username === "") return;

    const email = cleanName(accountData.email || "") || defaultEmailForUsername(username);
    const role = cleanName(accountData.role || "player") || "player";
    const sessionHash = cleanName(accountData.session_token_hash || "");
    const expiresAt = cleanName(accountData.session_token_expires_at || "");
    const ipAddress = normalizeIp(details.ip || "");
    const userAgent = cleanName(details.userAgent || "");

    this.runDetached("mirror session", async () => {
      await this.withTransaction(async (client) => {
        const playerId = await this.ensurePlayerIdentity(client, username, email, role);
        if (!playerId || sessionHash === "") return;

        const accountResult = await client.query(
          `SELECT account_id FROM ${this.table("accounts")} WHERE username = $1 LIMIT 1`,
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
    });
  }

  revokeSessionsByUsername(username) {
    if (!this.isReady()) return;
    const cleanUsername = cleanName(username);
    if (cleanUsername === "") return;

    this.runDetached("revoke sessions", async () => {
      await this.withTransaction(async (client) => {
        const accountResult = await client.query(
          `SELECT account_id FROM ${this.table("accounts")} WHERE username = $1 LIMIT 1`,
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
    });
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
            const amount = Math.max(0, toInt(rawAmount, 0));
            if (amount <= 0) continue;
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
              VALUES ($1, $2, $3, $4, 200, 0, now())
              `,
              [playerId, cleanName(itemType), fallbackCategory, amount]
            );
          }
        }
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
          VALUES ($1, $2, $3, $4, 200, 0, now())
          ON CONFLICT (player_id, item_type, item_category) DO UPDATE
            SET amount = EXCLUDED.amount,
                row_version = ${this.table("inventory")}.row_version + 1,
                updated_at = now()
          `,
          [playerId, itemType, itemCategory || "block", Math.max(0, toInt(e.balance_after, 0))]
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
    const requestedStackLimit = Math.min(2147483647, Math.max(1, toInt(e.stack_limit || 200, 200)));
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
        const existingStackLimit = Math.max(1, toInt(existing?.stack_limit || requestedStackLimit, requestedStackLimit));
        const stackLimit = Math.min(2147483647, Math.max(existingStackLimit, requestedStackLimit));
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
        baseline.set(`${itemType}\u0000${itemCategory}`, {
          amount: Math.max(0, toInt(parsed.amount, 0)),
          stack_limit: Math.min(2147483647, Math.max(1, toInt(parsed.stack_limit || 200, 200))),
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
        const existingStackLimit = Math.max(1, toInt(inventoryRow?.stack_limit || 200, 200));
        const baselineStackLimit = baselineEntry ? Math.max(1, toInt(baselineEntry.stack_limit || 200, 200)) : 200;
        const stackLimit = Math.min(2147483647, Math.max(existingStackLimit, baselineStackLimit));
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
        baseline.set(`${baselineItemType}\u0000${baselineCategory}`, {
          amount: Math.max(0, toInt(parsed.amount, 0)),
          stack_limit: Math.min(2147483647, Math.max(1, toInt(parsed.stack_limit || 200, 200))),
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
        const lockStack = Math.min(2147483647, Math.max(
          Math.max(1, toInt(lockInventory?.stack_limit || 200, 200)),
          lockBaseline ? Math.max(1, toInt(lockBaseline.stack_limit || 200, 200)) : 200
        ));
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
        const itemStack = Math.min(2147483647, Math.max(
          Math.max(1, toInt(itemInventory?.stack_limit || 200, 200)),
          itemBaseline ? Math.max(1, toInt(itemBaseline.stack_limit || 200, 200)) : 200
        ));
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
