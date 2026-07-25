#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AccountSessionHelpersModule = /** @type {{
 *   createServerAccountSessionHelpers: (deps: Record<string, any>) => Record<string, any>;
 *   normalizeSocketAddress: (value: unknown) => string;
 *   resolveTrustedProxyClientAddress: (request: {
 *     headers?: Record<string, unknown>;
 *     socket?: { remoteAddress?: unknown };
 *   } | null | undefined) => string;
 * }} */ (require("../server_account_session_helpers"));

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_account_session_helpers.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_account_session_helpers.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_account_session_helpers_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-account-session-helpers.json"), "utf8"));

assert.equal(AccountSessionHelpersModule.normalizeSocketAddress("::ffff:203.0.113.9"), "203.0.113.9");
assert.equal(AccountSessionHelpersModule.normalizeSocketAddress("not-an-ip"), "");
assert.equal(AccountSessionHelpersModule.resolveTrustedProxyClientAddress({
  socket: { remoteAddress: "198.51.100.7" },
  headers: { "cf-connecting-ip": "203.0.113.10" },
}), "198.51.100.7");
assert.equal(AccountSessionHelpersModule.resolveTrustedProxyClientAddress({
  socket: { remoteAddress: "127.0.0.1" },
  headers: {
    "cf-connecting-ip": "203.0.113.10",
    "x-forwarded-for": "198.51.100.8, 198.51.100.9",
  },
}), "203.0.113.10");
assert.equal(AccountSessionHelpersModule.resolveTrustedProxyClientAddress({
  socket: { remoteAddress: "::1" },
  headers: {
    "cf-connecting-ip": "invalid",
    "x-forwarded-for": "198.51.100.8, 198.51.100.9",
  },
}), "198.51.100.8");
assert.equal(AccountSessionHelpersModule.resolveTrustedProxyClientAddress({
  socket: { remoteAddress: "127.0.0.1" },
  headers: { "x-forwarded-for": "invalid" },
}), "127.0.0.1");

/** @type {Map<string, Record<string, any>>} */
const accounts = new Map();
/** @type {Map<string, Record<string, any>>} */
const localPasswordResetRequests = new Map();
/** @type {Map<string, Record<string, any>>} */
const localEmailChangeRequests = new Map();
/** @type {Map<string, Record<string, any>>} */
const localLoginAttemptBuckets = new Map();
/** @type {Record<string, any[]>} */
const events = {
  accountSaves: [],
  loginAttempts: [],
  revoked: [],
  security: [],
};

function accountKey(/** @type {unknown} */ value) {
  return String(value || "").trim().toLowerCase();
}

function cleanAccountName(/** @type {unknown} */ value) {
  return String(value || "").trim();
}

function cleanEmail(/** @type {unknown} */ value) {
  return String(value || "").trim().toLowerCase();
}

const deps = {
  ACCOUNT_EMAIL_CHANGE_TTL_MS: 60_000,
  ACCOUNT_PASSWORD_RESET_TTL_MS: 60_000,
  EMAIL_VERIFICATION_TTL_MS: 60_000,
  LOGIN_ATTEMPT_LIMIT_ACCOUNT: 2,
  LOGIN_ATTEMPT_LIMIT_IP: 2,
  LOGIN_ATTEMPT_WINDOW_MS: 60_000,
  TOKEN_LOGIN_ATTEMPT_LIMIT_ACCOUNT: 4,
  TOKEN_LOGIN_ATTEMPT_LIMIT_IP: 5,
  MAX_USERNAME_LENGTH: 16,
  MIN_PASSWORD_LENGTH: 8,
  MIN_USERNAME_LENGTH: 3,
  PASSWORD_HASH_ALGORITHM: "scrypt:n=16384,r=8,p=1,keylen=64",
  PASSWORD_SCRYPT_KEYLEN: 64,
  PASSWORD_SCRYPT_N: 16384,
  PASSWORD_SCRYPT_P: 1,
  PASSWORD_SCRYPT_R: 8,
  PUBLIC_BASE_URL: "https://pixelmania.test",
  SESSION_REFRESH_TOKEN_TTL_MS: 120_000,
  SESSION_TOKEN_TTL_MS: 60_000,
  SMTP_FROM: "PixelMania <no-reply@pixelmania.test>",
  SMTP_HOST: "",
  SMTP_PASS: "",
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USER: "",
  accountKey,
  accounts,
  cleanAccountName,
  cleanEmail,
  getSocketAddress: () => "127.0.0.1",
  getSocketDeviceInfo: () => ({ test_device: true }),
  getSocketUserAgent: () => "account-session-helper-test",
  isPostgresAuthoritativeReady: () => false,
  localEmailChangeRequests,
  localLoginAttemptBuckets,
  localPasswordResetRequests,
  logSecurityEvent: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ type, /** @type {unknown} */ details, /** @type {unknown} */ severity) => {
    events.security.push({ type, details, severity });
  },
  makeRequestId: (/** @type {Record<string, any>} */ data) => data.request_id || "request-id",
  postgresStore: {
    recordLoginAttempt: (/** @type {Record<string, any>} */ entry) => events.loginAttempts.push(entry),
    revokeSessionsByUsername: (/** @type {unknown} */ username) => events.revoked.push(username),
    revokeSessionsForUsername: async (/** @type {unknown} */ username, /** @type {unknown} */ reason) => {
      events.revoked.push({ username, reason });
      return { ok: true };
    },
  },
  queueAccountsSave: () => events.accountSaves.push(Date.now()),
  redisStore: {
    isReady: () => false,
  },
  sanitizeAccountState: (/** @type {unknown} */ value) => value && typeof value === "object" && !Array.isArray(value) ? value : null,
};

const helpers = /** @type {any} */ (AccountSessionHelpersModule.createServerAccountSessionHelpers(deps));

(async () => {
  const usernameValidation = helpers.validateUsername("USO_1");
  assert.equal(usernameValidation.ok, true);
  assert.equal(usernameValidation.username, "USO_1");
  assert.equal(helpers.validateUsername("x").ok, false);
  assert.equal(helpers.validateEmail("Uso@Example.Test").email, "uso@example.test");
  assert.equal(helpers.validatePassword("password123").password, "password123");

  const legacyAlgorithm = helpers.parsePasswordHashAlgorithm("legacy_scrypt");
  assert.equal(legacyAlgorithm.algorithm, "legacy_scrypt");
  const passwordHash = helpers.makePasswordHash("password123");
  /** @type {Record<string, any>} */
  const account = {
    username: "USO",
    email: "uso@example.test",
    password_salt: passwordHash.salt,
    password_hash: passwordHash.hash,
    password_algorithm: passwordHash.algorithm,
    email_verified: false,
  };
  accounts.set("uso", account);
  assert.equal(helpers.hasPassword(account), true);
  assert.equal(helpers.verifyPassword(account, "password123"), true);
  assert.equal(helpers.verifyPassword(account, "wrong-password"), false);

  const tokens = helpers.issueSessionTokens(account);
  assert.equal(helpers.isSessionTokenValid(account, tokens.sessionToken), true);
  assert.equal(helpers.isRefreshTokenValid(account, tokens.refreshToken), true);
  assert.equal(typeof account.session_token_hash, "string");
  assert.equal(typeof account.refresh_token_hash, "string");
  assert.equal(events.accountSaves.length, 1);

  const authoritativeAccountSaves = [];
  const authoritativeHelpers = /** @type {any} */ (AccountSessionHelpersModule.createServerAccountSessionHelpers({
    ...deps,
    isPostgresAuthoritativeReady: () => true,
    queueAccountsSave: () => authoritativeAccountSaves.push(Date.now()),
  }));
  const authoritativeAccount = {
    username: "AuthoritativeSession",
    email: "authoritative-session@example.test",
  };
  authoritativeHelpers.issueSessionTokens(authoritativeAccount);
  authoritativeHelpers.clearSessionToken(authoritativeAccount);
  assert.equal(authoritativeAccountSaves.length, 0);

  const verificationToken = helpers.makeEmailVerificationToken(account);
  assert.equal(helpers.hasActiveEmailVerificationToken(account), true);
  assert.match(helpers.makeEmailVerificationUrl(verificationToken), /^https:\/\/pixelmania\.test\/verify-email\?token=/);
  const verificationResult = await helpers.verifyEmailToken(verificationToken);
  assert.equal(verificationResult.ok, true);
  assert.equal(account.email_verified, true);
  assert.equal(account.email_verification_token_hash, "");

  const resetToken = "reset-token";
  localPasswordResetRequests.set(helpers.makeTokenHash(resetToken), {
    username: "USO",
    email: "uso@example.test",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    used: false,
  });
  const resetResult = await helpers.applyPasswordResetToken(resetToken, "newpassword123");
  assert.equal(resetResult.ok, true);
  assert.equal(helpers.verifyPassword(account, "newpassword123"), true);

  const changeToken = "change-token";
  localEmailChangeRequests.set(helpers.makeTokenHash(changeToken), {
    username: "USO",
    old_email: "uso@example.test",
    new_email: "new@example.test",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    used: false,
  });
  const changeResult = await helpers.confirmEmailChangeToken(changeToken);
  assert.equal(changeResult.ok, true);
  assert.equal(account.email, "new@example.test");
  assert.equal(helpers.findAccountByEmail("New@Example.Test").username, "USO");

  const socket = { playerId: "p1" };
  assert.equal((await helpers.checkLoginAttemptAllowed(socket, "USO", "login")).ok, true);
  assert.equal((await helpers.checkLoginAttemptAllowed(socket, "USO", "login")).ok, true);
  const blocked = await helpers.checkLoginAttemptAllowed(socket, "USO", "login");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retry_after_seconds >= 1, true);

  assert.equal((await helpers.checkLoginAttemptAllowed(socket, "USO", "refresh_token_login")).ok, true);
  assert.equal((await helpers.checkLoginAttemptAllowed(socket, "USO", "refresh_token_login")).ok, true);
  assert.equal((await helpers.checkLoginAttemptAllowed(socket, "USO", "refresh_token_login")).ok, true);
  assert.equal((await helpers.checkLoginAttemptAllowed(socket, "USO", "refresh_token_login")).ok, true);
  const blockedRefresh = await helpers.checkLoginAttemptAllowed(socket, "USO", "refresh_token_login");
  assert.equal(blockedRefresh.ok, false);

  helpers.recordLoginAttempt(socket, { id: "p1" }, "USO", "login", false, "password_mismatch", {
    request_id: "login-1",
  });
  assert.equal(events.security.at(-1).type, "account_login_failed");
  assert.equal(events.loginAttempts.at(-1).success, false);
  assert.equal(events.loginAttempts.at(-1).request_id, "login-1");

  assert.match(helperSource, /function createServerAccountSessionHelpers/);
  assert.match(helperSource, /function makePasswordHash/);
  assert.match(helperSource, /function issueSessionTokens/);
  assert.match(helperSource, /function queueSessionFallbackSave/);
  assert.match(helperSource, /if \(!isPostgresAuthoritativeReady\(\)\)/);
  assert.match(helperSource, /async function applyPasswordResetToken/);
  assert.match(helperSource, /async function confirmEmailChangeToken/);
  assert.match(helperSource, /async function checkLoginAttemptAllowed/);
  assert.match(helperSource, /function resolveTrustedProxyClientAddress/);
  assert.match(generatedSource, /Generated from src\/server_account_session_helpers\.ts/);
  assert.match(generatedSource, /resolveTrustedProxyClientAddress/);
  assert.match(generatedSource, /module\.exports = /);
  assert.deepEqual(buildConfig.include, ["src/server_account_session_helpers.ts"]);
  assert.match(syncSource, /server_account_session_helpers\.js/);
  assert.match(serverSource, /require\("\.\/server_account_session_helpers"\)/);
  assert.match(serverSource, /createServerAccountSessionHelpers/);
  assert.match(serverSource, /getServerAccountSessionHelpers\(\)\.makePasswordHash/);
  assert.match(serverSource, /getServerAccountSessionHelpers\(\)\.issueSessionTokens/);
  assert.match(serverSource, /getServerAccountSessionHelpers\(\)\.applyPasswordResetToken/);
  assert.match(serverSource, /getServerAccountSessionHelpers\(\)\.checkLoginAttemptAllowed/);
  assert.match(serverSource, /resolveTrustedProxyClientAddress\(request\)/);
  assert.match(serverSource, /normalizeSocketAddress\(/);
  assert.doesNotMatch(serverSource, /socket\.remoteAddress = String\(request\?\.socket\?\.remoteAddress/);
  assert.doesNotMatch(serverSource, /function parsePasswordHashAlgorithm\(algorithm = ""\) \{\s+const raw = String\(algorithm/);
  assert.doesNotMatch(serverSource, /function issueSessionTokens\(account\) \{\s+const sessionToken/);
  assert.doesNotMatch(serverSource, /async function applyPasswordResetToken\(token, password\) \{\s+const passwordValidation/);
  assert.doesNotMatch(serverSource, /function recordLoginAttempt\(socket, player, username, action, ok, reason, data = \{\}\) \{\s+const details =/);
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-account-session-helpers/);
  assert.match(deploySource, /server_account_session_helpers\.js/);
  assert.match(deploySource, /src\/server_account_session_helpers\.ts/);
  assert.match(deploySource, /tsconfig\.server-account-session-helpers\.json/);
  assert.match(deploySource, /check_server_account_session_helpers_build\.js/);
  assert.match(deploySource, /sync_server_account_session_helpers_build\.js/);
  assert.match(deploySource, /npm run build:server-account-session-helpers/);

  console.log("[server-account-session-helpers] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
