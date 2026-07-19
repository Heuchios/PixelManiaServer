"use strict";

require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PostgresStore = require("../postgres_store");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    if (eq >= 0) {
      args[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[raw] = true;
      continue;
    }
    args[raw] = next;
    i += 1;
  }
  return args;
}

function parseInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function boolArg(value) {
  if (value === true) return true;
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function usage() {
  return `
Usage:
  npm run load:tokens -- --count 1000 --out ./load_tokens.json --confirm-production-load-accounts

Creates disposable verified LoadTest_* accounts in PostgreSQL and writes a token
file for npm run load:staged. This must run on a machine with production DB env.

Useful knobs:
  --count 1000
  --start 1
  --prefix LoadTest_
  --email-domain loadtest.pixelmaniagame.local
  --out ./load_tokens.json
  --password <optional-known-password>
  --keep-existing-sessions
`;
}

function cleanUsername(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);
}

function makeLoadUsername(prefix, number) {
  return cleanUsername(`${prefix}${String(number).padStart(4, "0")}`);
}

function makeTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function makeSecureToken(byteLength = 32) {
  return crypto.randomBytes(Math.max(16, Math.trunc(Number(byteLength) || 32))).toString("hex");
}

function passwordHashAlgorithm() {
  const n = Math.max(16384, Math.trunc(Number(process.env.PASSWORD_SCRYPT_N) || 16384));
  const r = Math.max(8, Math.trunc(Number(process.env.PASSWORD_SCRYPT_R) || 8));
  const p = Math.max(1, Math.trunc(Number(process.env.PASSWORD_SCRYPT_P) || 1));
  const keylen = Math.max(32, Math.trunc(Number(process.env.PASSWORD_SCRYPT_KEYLEN) || 64));
  return { n, r, p, keylen, algorithm: `scrypt:n=${n},r=${r},p=${p},keylen=${keylen}` };
}

function makePasswordHash(password) {
  const parsed = passwordHashAlgorithm();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password || ""), salt, parsed.keylen, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p,
    maxmem: Math.max(64 * 1024 * 1024, 256 * parsed.n * parsed.r),
  }).toString("hex");
  return { salt, hash, algorithm: parsed.algorithm };
}

function makePostgresStore() {
  return new PostgresStore({
    enabled: true,
    autoBootstrap: false,
    connectionString: String(process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL || "").trim(),
    host: String(process.env.POSTGRES_HOST || "").trim(),
    port: parseInteger(process.env.POSTGRES_PORT, 5432, 1, 65535),
    database: String(process.env.POSTGRES_DATABASE || "").trim(),
    user: String(process.env.POSTGRES_USER || "").trim(),
    password: String(process.env.POSTGRES_PASSWORD || ""),
    ssl: boolArg(process.env.POSTGRES_SSL),
    schema: String(process.env.POSTGRES_SCHEMA || "pixelmania").trim() || "pixelmania",
    poolMax: parseInteger(process.env.POSTGRES_POOL_MAX, 10, 1, 100),
    idleTimeoutMs: parseInteger(process.env.POSTGRES_IDLE_TIMEOUT_MS, 30000, 1000),
    connectTimeoutMs: parseInteger(process.env.POSTGRES_CONNECT_TIMEOUT_MS, 8000, 1000),
    maxWriteQueueDepth: parseInteger(process.env.POSTGRES_WRITE_QUEUE_MAX, 1000, 100),
    logger: (...args) => console.warn(...args),
  });
}

async function upsertVerifiedLoadAccount(store, account, metadata) {
  await store.withTransaction(async (client) => {
    const result = await client.query(
      `
      INSERT INTO ${store.table("accounts")} (
        username,
        email,
        password_salt,
        password_hash,
        password_algorithm,
        role,
        is_active,
        last_login_at,
        email_verified,
        email_verified_at,
        email_verification_token_hash,
        email_verification_expires_at,
        account_state,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        'player',
        true,
        now(),
        true,
        now(),
        '',
        NULL,
        $6::jsonb,
        now(),
        now()
      )
      ON CONFLICT (username) DO UPDATE
        SET email = EXCLUDED.email,
            password_salt = EXCLUDED.password_salt,
            password_hash = EXCLUDED.password_hash,
            password_algorithm = EXCLUDED.password_algorithm,
            role = 'player',
            is_active = true,
            last_login_at = now(),
            email_verified = true,
            email_verified_at = COALESCE(${store.table("accounts")}.email_verified_at, now()),
            email_verification_token_hash = '',
            email_verification_expires_at = NULL,
            account_state = ${store.table("accounts")}.account_state || EXCLUDED.account_state,
            updated_at = now()
      RETURNING account_id
      `,
      [
        account.username,
        account.email,
        account.password_salt,
        account.password_hash,
        account.password_algorithm,
        JSON.stringify(metadata),
      ]
    );

    const accountId = result.rows[0]?.account_id;
    if (!accountId) throw new Error(`Could not upsert ${account.username}`);

    await client.query(
      `
      INSERT INTO ${store.table("players")} (account_id, display_name, current_world_name, created_at, updated_at)
      VALUES ($1, $2, NULL, now(), now())
      ON CONFLICT (account_id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            updated_at = now()
      `,
      [accountId, account.username]
    );
  });
}

async function provisionOne(store, options, index) {
  const number = options.start + index;
  const username = makeLoadUsername(options.prefix, number);
  if (username.length < 3) throw new Error(`Invalid generated username for ${number}`);

  const email = `${username.toLowerCase()}@${options.emailDomain}`;
  const password = options.password || makeSecureToken(18);
  const passwordHash = makePasswordHash(password);
  const sessionToken = makeSecureToken(32);
  const refreshToken = makeSecureToken(48);
  const now = Date.now();
  const account = {
    username,
    email,
    password_salt: passwordHash.salt,
    password_hash: passwordHash.hash,
    password_algorithm: passwordHash.algorithm,
    role: "player",
    email_verified: true,
    email_verified_at: new Date(now).toISOString(),
    session_token_hash: makeTokenHash(sessionToken),
    session_token_expires_at: new Date(now + options.sessionTtlMs).toISOString(),
    refresh_token_hash: makeTokenHash(refreshToken),
    refresh_token_expires_at: new Date(now + options.refreshTtlMs).toISOString(),
    last_seen_at: new Date(now).toISOString(),
  };

  const metadata = {
    load_test: true,
    provisioned_by: "scripts/provision_load_tokens.js",
    provisioned_at: new Date(now).toISOString(),
    batch: options.batchId,
    index: number,
  };

  await upsertVerifiedLoadAccount(store, account, metadata);

  if (options.revokeExistingSessions) {
    await store.revokeSessionsForUsername(username, "load_test_token_rotation");
  }

  const sessionResult = await store.saveSession(account, {
    userAgent: "PixelMania staged load token provisioner",
    deviceInfo: metadata,
    sessionMode: "load_test",
  });
  if (!sessionResult.ok) {
    throw new Error(`Could not save session for ${username}: ${sessionResult.reason || sessionResult.message || "unknown"}`);
  }

  return {
    username,
    session_token: sessionToken,
    refresh_token: refreshToken,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  if (!boolArg(args["confirm-production-load-accounts"])) {
    console.error(usage());
    throw new Error("Refusing to create durable load-test accounts without --confirm-production-load-accounts.");
  }

  const count = parseInteger(args.count || process.env.PIXELMANIA_LOAD_TOKEN_COUNT, 1000, 1, 10000);
  const start = parseInteger(args.start || process.env.PIXELMANIA_LOAD_TOKEN_START, 1, 1, 999999);
  const prefix = cleanUsername(args.prefix || process.env.PIXELMANIA_LOAD_TOKEN_PREFIX || "LoadTest_");
  const emailDomain = String(args["email-domain"] || process.env.PIXELMANIA_LOAD_TOKEN_EMAIL_DOMAIN || "loadtest.pixelmaniagame.local")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "");
  const outFile = path.resolve(String(args.out || process.env.PIXELMANIA_LOAD_TOKEN_OUT || "load_tokens.json"));
  const password = args.password ? String(args.password) : "";
  const sessionTtlMs = Math.max(15 * 60 * 1000, parseInteger(process.env.SESSION_TOKEN_TTL_MINUTES, 1440, 15) * 60 * 1000);
  const refreshTtlMs = Math.max(sessionTtlMs, parseInteger(process.env.SESSION_REFRESH_TOKEN_TTL_MINUTES, 30 * 24 * 60, 15) * 60 * 1000);
  const batchId = `load-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const revokeExistingSessions = !boolArg(args["keep-existing-sessions"]);

  const sampleLastUsername = makeLoadUsername(prefix, start + count - 1);
  if (prefix === "" || sampleLastUsername.length > 16) {
    throw new Error(`Generated usernames must be 16 chars or less. prefix=${prefix} sample=${sampleLastUsername}`);
  }
  if (emailDomain === "" || emailDomain.includes(" ") || !emailDomain.includes(".")) {
    throw new Error(`Invalid --email-domain: ${emailDomain}`);
  }

  const store = makePostgresStore();
  await store.init();
  if (!store.isReady()) {
    throw new Error("PostgreSQL is not ready. Run this on the server/droplet with production DB environment loaded.");
  }

  const accounts = [];
  console.log(`[load:tokens] provisioning ${count} verified disposable accounts (${makeLoadUsername(prefix, start)}..${sampleLastUsername})`);
  for (let index = 0; index < count; index += 1) {
    accounts.push(await provisionOne(store, {
      start,
      prefix,
      emailDomain,
      password,
      sessionTtlMs,
      refreshTtlMs,
      batchId,
      revokeExistingSessions,
    }, index));
    if ((index + 1) % 50 === 0 || index + 1 === count) {
      console.log(`[load:tokens] ${index + 1}/${count}`);
    }
  }

  fs.writeFileSync(outFile, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    count: accounts.length,
    prefix,
    email_domain: emailDomain,
    accounts,
  }, null, 2)}\n`, "utf8");
  console.log(`[load:tokens] wrote ${accounts.length} accounts to ${outFile}`);

  if (store.pool) await store.pool.end();
}

main().catch(async (error) => {
  console.error(`[load:tokens] failed: ${error.message}`);
  process.exit(1);
});
