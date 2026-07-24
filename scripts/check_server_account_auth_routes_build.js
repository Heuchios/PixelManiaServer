#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AccountAuthRoutesModule = require("../server_account_auth_routes");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helperSource = fs.readFileSync(path.join(repoRoot, "src", "server_account_auth_routes.ts"), "utf8");
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_account_auth_routes.js"), "utf8");
const syncSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_account_auth_routes_build.js"), "utf8");
const buildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-account-auth-routes.json"), "utf8"));

/** @type {Map<string, Record<string, any>>} */
const accounts = new Map();
/** @type {Map<string, Record<string, any>>} */
const playerStates = new Map();
/** @type {Map<string, Record<string, any>>} */
const localPasswordResetRequests = new Map();
/** @type {Map<string, Record<string, any>>} */
const localEmailChangeRequests = new Map();
/** @type {Record<string, any[]>} */
const events = {
  accountActionOk: [],
  authErrors: [],
  authOk: [],
  friendNotices: [],
  friendStates: [],
  loginAttempts: [],
  mirroredAccounts: [],
  mirroredSessions: [],
  queued: [],
  savedPlayers: [],
  security: [],
  verificationRequired: [],
};

let secureTokenCounter = 0;
let sessionTokenCounter = 0;

function accountKey(/** @type {unknown} */ value) {
  return String(value || "").trim().toLowerCase();
}

function cleanAccountName(/** @type {unknown} */ value) {
  return String(value || "").trim().toLowerCase();
}

function cleanEmail(/** @type {unknown} */ value) {
  return String(value || "").trim().toLowerCase();
}

const deps = {
  ACCOUNT_EMAIL_CHANGE_TTL_MS: 60_000,
  ACCOUNT_ONE_ACTIVE_SESSION: true,
  ACCOUNT_PASSWORD_RESET_TTL_MS: 60_000,
  DEV_BACKEND_LOGIN_ALLOWED: true,
  POSTGRES_AUTHORITATIVE: false,
  POSTGRES_ENABLED: false,
  PUNISHMENT_SCOPE_GLOBAL: "global",
  accountKey,
  accounts,
  activatePlayerAccount: (/** @type {unknown} */ _socket, /** @type {Record<string, any>} */ player, /** @type {Record<string, any>} */ account) => {
    player.authenticated = true;
    player.account_username = account.username;
    events.authOk.push({ activation: account.username });
    return { ok: true };
  },
  checkLoginAttemptAllowed: async () => ({ ok: true }),
  clampString: (/** @type {unknown} */ value) => String(value || "").trim(),
  cleanAccountName,
  cleanEmail,
  cleanWorld: (/** @type {unknown} */ value) => String(value || "START").trim().toUpperCase(),
  createDefaultPlayerState: (/** @type {unknown} */ username) => ({
    account_username: cleanAccountName(username),
    inventory: {},
    tool_inventory: {},
  }),
  ensurePlayerState: (/** @type {unknown} */ username) => playerStates.get(accountKey(username)) || null,
  findAccountByEmail: (/** @type {unknown} */ email) => {
    const clean = cleanEmail(email);
    for (const account of accounts.values()) {
      if (cleanEmail(account.email) === clean) return account;
    }
    return null;
  },
  formatPunishmentBlockMessage: () => "blocked",
  getAccountRole: () => "player",
  getBlockingPunishment: async () => null,
  getSocketAddress: () => "127.0.0.1",
  getSocketDeviceInfo: () => ({ test_device: true }),
  getSocketUserAgent: () => "account-auth-route-test",
  hasActiveEmailVerificationToken: () => false,
  hasPassword: (/** @type {Record<string, any> | null | undefined} */ account) => Boolean(account?.password_hash),
  isAccountEmailVerified: (/** @type {Record<string, any> | null | undefined} */ account) => account?.email_verified === true,
  isPostgresAuthoritativeReady: () => false,
  isRefreshTokenValid: (/** @type {Record<string, any> | null | undefined} */ account, /** @type {unknown} */ token) => account?.refresh_token_hash === `hash:${String(token || "").trim()}`,
  isSessionTokenValid: (/** @type {Record<string, any> | null | undefined} */ account, /** @type {unknown} */ token) => account?.session_token_hash === `hash:${String(token || "").trim()}`,
  issueSessionTokens: (/** @type {Record<string, any>} */ account) => {
    sessionTokenCounter += 1;
    const sessionToken = `session-${sessionTokenCounter}`;
    const refreshToken = `refresh-${sessionTokenCounter}`;
    account.session_token_hash = `hash:${sessionToken}`;
    account.session_token_expires_at = "2099-01-01T00:00:00.000Z";
    account.refresh_token_hash = `hash:${refreshToken}`;
    account.refresh_token_expires_at = "2099-01-02T00:00:00.000Z";
    return { sessionToken, refreshToken };
  },
  localEmailChangeRequests,
  localPasswordResetRequests,
  logSecurityEvent: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ type, /** @type {unknown} */ details, /** @type {unknown} */ severity) => events.security.push({ type, details, severity }),
  makeEmailVerificationToken: (/** @type {Record<string, any>} */ account) => {
    account.email_verification_token_hash = "hash:verify-token";
    account.email_verification_expires_at = "2099-01-01T00:00:00.000Z";
    return "verify-token";
  },
  makePasswordHash: (/** @type {unknown} */ password) => ({
    salt: "salt",
    hash: `password:${String(password)}`,
    algorithm: "scrypt:n=16384,r=8,p=1,keylen=64",
  }),
  makeRequestId: (/** @type {Record<string, any>} */ data) => data.request_id || "request-id",
  makeSecureToken: () => {
    secureTokenCounter += 1;
    return `secure-${secureTokenCounter}`;
  },
  makeTokenHash: (/** @type {unknown} */ token) => `hash:${String(token || "").trim()}`,
  notifyOnlineFriendsOfFriendState: (/** @type {unknown} */ username) => events.friendNotices.push(username),
  normalizePlayerHotbarState: (/** @type {Record<string, any>} */ state) => state,
  playerStates,
  postgresStore: {
    createAccountEmailChangeRequest: async () => ({ ok: true }),
    createAccountPasswordResetRequest: async () => ({ ok: true }),
    mirrorAccount: (/** @type {Record<string, any>} */ account, /** @type {unknown} */ options) => events.mirroredAccounts.push({ username: account.username, options }),
    mirrorSession: (/** @type {Record<string, any>} */ account, /** @type {unknown} */ options) => events.mirroredSessions.push({ username: account.username, options }),
    revokeOtherSessionsForUsername: async () => ({ ok: true }),
    revokeSessionByTokenHash: async () => ({ ok: true }),
    revokeSessionsForUsername: async () => ({ ok: true }),
    saveAccountState: async () => true,
    saveSession: async () => ({ ok: true }),
    validateSessionToken: async () => ({ ok: false }),
  },
  publicPunishmentPayload: (/** @type {unknown} */ punishment) => punishment,
  queueAccountsSave: () => events.queued.push("accounts"),
  queueEmailChangeEmail: (/** @type {Record<string, any>} */ account, /** @type {unknown} */ newEmail, /** @type {unknown} */ token) => events.queued.push(`email_change:${account.username}:${newEmail}:${token}`),
  queuePasswordResetEmail: (/** @type {Record<string, any>} */ account, /** @type {unknown} */ token) => events.queued.push(`password_reset:${account.username}:${token}`),
  queueVerificationEmail: (/** @type {Record<string, any>} */ account, /** @type {unknown} */ token) => events.queued.push(`verification:${account.username}:${token}`),
  recordLoginAttempt: (/** @type {unknown} */ _socket, /** @type {unknown} */ _player, /** @type {unknown} */ username, /** @type {unknown} */ action, /** @type {unknown} */ ok, /** @type {unknown} */ reason) => events.loginAttempts.push({ username, action, ok, reason }),
  refreshAccountFromPostgres: async () => null,
  sanitizeAccountNameArray: (/** @type {unknown} */ value) => Array.isArray(value) ? value.map((entry) => cleanAccountName(entry)).filter(Boolean) : [],
  sanitizeAccountState: (/** @type {unknown} */ value) => value && typeof value === "object" && !Array.isArray(value) ? value : null,
  sanitizeMovementMode: (/** @type {unknown} */ value) => String(value || ""),
  savePlayerState: (/** @type {unknown} */ username) => events.savedPlayers.push(username),
  sendAccountActionOk: (/** @type {unknown} */ _socket, /** @type {unknown} */ requestId, /** @type {unknown} */ action, /** @type {unknown} */ message, /** @type {unknown} */ extra) => events.accountActionOk.push({ requestId, action, message, extra }),
  sendAuthError: (/** @type {unknown} */ _socket, /** @type {unknown} */ requestId, /** @type {unknown} */ action, /** @type {unknown} */ message, /** @type {unknown} */ extra) => events.authErrors.push({ requestId, action, message, extra }),
  sendAuthOk: (/** @type {unknown} */ _socket, /** @type {unknown} */ requestId, /** @type {unknown} */ action, /** @type {Record<string, any>} */ account, /** @type {Record<string, any>} */ tokens) => events.authOk.push({ requestId, action, username: account.username, tokens }),
  sendFriendState: (/** @type {unknown} */ _socket, /** @type {unknown} */ username, /** @type {unknown} */ requestId) => events.friendStates.push({ username, requestId }),
  sendVerificationRequired: (/** @type {unknown} */ _socket, /** @type {unknown} */ requestId, /** @type {unknown} */ action, /** @type {Record<string, any>} */ account, /** @type {unknown} */ message) => events.verificationRequired.push({ requestId, action, username: account.username, message }),
  updatePlayerWorldIndex: (/** @type {Record<string, any>} */ player) => {
    player.world_index_updated = true;
  },
  validateEmail: (/** @type {unknown} */ value) => {
    const email = cleanEmail(value);
    return email.includes("@") ? { ok: true, email } : { ok: false, message: "Invalid email." };
  },
  validatePassword: (/** @type {unknown} */ value) => {
    const password = String(value || "");
    return password.length >= 8 ? { ok: true, password } : { ok: false, message: "Invalid password." };
  },
  validateUsername: (/** @type {unknown} */ value) => {
    const username = cleanAccountName(value);
    return username !== "" ? { ok: true, username } : { ok: false, message: "Invalid username." };
  },
  verifyPassword: (/** @type {Record<string, any>} */ account, /** @type {unknown} */ password) => account.password_hash === `password:${String(password)}`,
};

const routes = /** @type {any} */ (AccountAuthRoutesModule.createServerAccountAuthRoutes(deps));
const socket = {};

(async () => {
  await routes.handleAccountRegister(socket, { id: "p-register" }, {
    request_id: "register-1",
    username: "USO",
    email: "Uso@Example.Test",
    password: "password123",
  });
  assert.equal(accounts.has("uso"), true);
  assert.equal(events.verificationRequired.at(-1).action, "register");
  assert.equal(events.queued.includes("verification:uso:verify-token"), true);
  assert.equal(events.mirroredAccounts.at(-1).username, "uso");

  const account = accounts.get("uso");
  assert.ok(account);
  account.email_verified = true;
  account.email_verified_at = "2099-01-01T00:00:00.000Z";

  await routes.handleAccountRegister(socket, { id: "p-register-duplicate" }, {
    request_id: "register-duplicate",
    username: "uso",
    email: "uso@example.test",
    password: "password123",
  });
  assert.equal(events.authErrors.at(-1).message, "Username is already registered.");

  await routes.handleAccountPasswordResetRequest(socket, { id: "p-reset" }, {
    request_id: "reset-missing",
    username: "missing",
    email: "missing@example.test",
  });
  assert.equal(events.accountActionOk.at(-1).action, "password_reset_request");
  assert.equal(events.accountActionOk.at(-1).message, "If that account matches, I sent a password reset email.");
  assert.ok(events.loginAttempts.some((entry) => entry.action === "password_reset_request" && entry.reason === "account_or_email_mismatch"));

  await routes.handleAccountEmailChangeRequest(socket, { id: "p-email" }, {
    request_id: "email-change",
    username: "uso",
    email: "new@example.test",
    password: "password123",
  });
  assert.equal(localEmailChangeRequests.size, 1);
  assert.equal(events.accountActionOk.at(-1).action, "email_change_request");
  assert.equal(events.queued.some((entry) => String(entry).startsWith("email_change:uso:new@example.test:")), true);
  assert.ok(events.security.some((entry) => entry.type === "account_email_change_requested"));

  await routes.handleAccountLogin(socket, { id: "p-login" }, {
    request_id: "login-1",
    username: "uso",
    email: "uso@example.test",
    password: "password123",
  });
  assert.equal(events.authOk.at(-1).action, "login");
  assert.equal(events.authOk.at(-1).tokens.refreshToken, "refresh-1");
  assert.ok(events.loginAttempts.some((entry) => entry.action === "login" && entry.ok === true));

  await routes.handleAccountTokenLogin(socket, { id: "p-token" }, {
    request_id: "token-1",
    username: "uso",
    refresh_token: "refresh-1",
  });
  assert.equal(events.authOk.at(-1).action, "token_login");
  assert.equal(events.authOk.at(-1).tokens.refreshToken, "refresh-2");
  assert.ok(events.loginAttempts.some((entry) => entry.action === "refresh_token_login" && entry.ok === true));

  const authoritativeAccount = {
    ...account,
    username: "typed",
    email: "typed@example.test",
    email_verified: true,
    session_token_hash: "hash:authoritative-session",
    session_token_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_token_hash: "hash:authoritative-refresh",
    refresh_token_expires_at: "2099-01-02T00:00:00.000Z",
  };
  const authoritativeAccounts = new Map([["typed", authoritativeAccount]]);
  /** @type {Record<string, any>[]} */
  const authoritativeSaveOptions = [];
  let legacyRevokeCalls = 0;
  const authoritativeMirrorCountBefore = events.mirroredAccounts.length;
  const authoritativeRoutes = AccountAuthRoutesModule.createServerAccountAuthRoutes({
    ...deps,
    accounts: authoritativeAccounts,
    isPostgresAuthoritativeReady: () => true,
    postgresStore: {
      ...deps.postgresStore,
      validateSessionToken: async () => ({
        ok: true,
        account_id: "f0fe9c8d-f024-4c7d-9cab-cb4cf6f8e247",
        player_id: "a9c73de5-9418-4a94-a47b-f0bfc1a8dbce",
        session_id: "7634c622-78e7-48ec-a6e6-ae49eb111a13",
        token_family: "5cac9292-da2f-4859-a828-fc278a16a06d",
        account: { ...authoritativeAccount },
        session_token_hash: authoritativeAccount.session_token_hash,
        refresh_token_hash: authoritativeAccount.refresh_token_hash,
        expires_at: authoritativeAccount.session_token_expires_at,
        refresh_expires_at: authoritativeAccount.refresh_token_expires_at,
      }),
      saveSession: async (/** @type {Record<string, any>} */ _account, /** @type {Record<string, any>} */ options) => {
        authoritativeSaveOptions.push(options);
        return { ok: true };
      },
      revokeOtherSessionsForUsername: async () => {
        legacyRevokeCalls += 1;
        return { ok: true };
      },
      revokeSessionByTokenHash: async () => {
        legacyRevokeCalls += 1;
        return { ok: true };
      },
    },
  });
  const authoritativeSocket = { readyState: 1 };
  await authoritativeRoutes.handleAccountTokenLogin(authoritativeSocket, { id: "p-authoritative" }, {
    request_id: "token-authoritative",
    username: "typed",
    refresh_token: "authoritative-refresh",
  });
  assert.equal(events.authOk.at(-1).username, "typed");
  const savedOptions = authoritativeSaveOptions.at(-1);
  assert.ok(savedOptions);
  assert.equal(savedOptions.concurrent, true);
  assert.equal(savedOptions.revokeRotatedToken, true);
  assert.equal(savedOptions.revokeOtherSessions, true);
  assert.equal(savedOptions.accountId, "f0fe9c8d-f024-4c7d-9cab-cb4cf6f8e247");
  assert.equal(savedOptions.rotatedFromSessionId, "7634c622-78e7-48ec-a6e6-ae49eb111a13");
  assert.equal(savedOptions.tokenFamily, "5cac9292-da2f-4859-a828-fc278a16a06d");
  assert.equal(savedOptions.touchLogin, true);
  assert.equal(savedOptions.shouldContinue(), true);
  assert.equal(legacyRevokeCalls, 0);
  assert.equal(events.mirroredAccounts.length, authoritativeMirrorCountBefore);

  let disconnectedIssueCalls = 0;
  let disconnectedSaveCalls = 0;
  const disconnectedSocket = { readyState: 1 };
  const authOkBeforeDisconnect = events.authOk.length;
  const authErrorsBeforeDisconnect = events.authErrors.length;
  const disconnectedRoutes = AccountAuthRoutesModule.createServerAccountAuthRoutes({
    ...deps,
    accounts: new Map([["typed", { ...authoritativeAccount }]]),
    isPostgresAuthoritativeReady: () => true,
    issueSessionTokens: () => {
      disconnectedIssueCalls += 1;
      return { sessionToken: "unused", refreshToken: "unused" };
    },
    postgresStore: {
      ...deps.postgresStore,
      validateSessionToken: async () => {
        disconnectedSocket.readyState = 3;
        return {
          ok: true,
          account: { ...authoritativeAccount },
          session_token_hash: authoritativeAccount.session_token_hash,
          refresh_token_hash: authoritativeAccount.refresh_token_hash,
        };
      },
      saveSession: async () => {
        disconnectedSaveCalls += 1;
        return { ok: true };
      },
    },
  });
  await disconnectedRoutes.handleAccountTokenLogin(disconnectedSocket, { id: "p-disconnected" }, {
    request_id: "token-disconnected",
    username: "typed",
    refresh_token: "authoritative-refresh",
  });
  assert.equal(disconnectedIssueCalls, 0);
  assert.equal(disconnectedSaveCalls, 0);
  assert.equal(events.authOk.length, authOkBeforeDisconnect);
  assert.equal(events.authErrors.length, authErrorsBeforeDisconnect);

  const devPlayer = /** @type {Record<string, any>} */ ({ id: "p-dev" });
  await routes.handleDevBackendLogin(socket, devPlayer, {
    request_id: "dev-1",
    username: "builder",
    world: "netfox_test",
    movement_mode: "trusted",
  });
  assert.equal(events.authOk.at(-1).action, "dev_backend_login");
  assert.equal(devPlayer.world, "NETFOX_TEST");
  assert.equal(playerStates.has("builder"), true);
  assert.equal(events.savedPlayers.includes("builder"), true);
  assert.equal(events.friendNotices.includes("builder"), true);

  assert.match(helperSource, /function createServerAccountAuthRoutes/);
  assert.match(helperSource, /async function handleAccountRegister/);
  assert.match(helperSource, /async function handleAccountTokenLogin/);
  assert.match(helperSource, /data\.refresh_token \|\| data\.session_token/);
  assert.match(helperSource, /function isAuthSocketOpen/);
  assert.match(helperSource, /token_login_session_rotation/);
  assert.match(helperSource, /revokeRotatedToken: true/);
  assert.match(helperSource, /rotatedFromSessionId: validatedSessionId/);
  assert.match(helperSource, /accountId: validatedAccountId \|\| account\.account_id/);
  assert.match(helperSource, /touchLogin: true/);
  assert.match(helperSource, /shouldContinue: \(\) => isAuthSocketOpen\(socket\)/);
  assert.match(helperSource, /Backend dev login authenticated/);
  assert.match(generatedSource, /Generated from src\/server_account_auth_routes\.ts/);
  assert.match(generatedSource, /module\.exports = \{/);
  assert.deepEqual(buildConfig.include, ["src/server_account_auth_routes.ts"]);
  assert.match(syncSource, /server_account_auth_routes\.js/);
  assert.match(serverSource, /require\("\.\/server_account_auth_routes"\)/);
  assert.match(serverSource, /createServerAccountAuthRoutes/);
  assert.match(serverSource, /return await getServerAccountAuthRoutes\(\)\.handleAccountRegister/);
  assert.match(serverSource, /return await getServerAccountAuthRoutes\(\)\.handleAccountTokenLogin/);
  assert.doesNotMatch(serverSource, /function ensureDevBackendAccount\(username\) \{\s+const usernameValidation = validateUsername/);
  assert.match(packageJson.scripts["check:typescript"], /npm run check:server-account-auth-routes/);
  assert.match(deploySource, /server_account_auth_routes\.js/);
  assert.match(deploySource, /src\/server_account_auth_routes\.ts/);
  assert.match(deploySource, /tsconfig\.server-account-auth-routes\.json/);
  assert.match(deploySource, /check_server_account_auth_routes_build\.js/);
  assert.match(deploySource, /sync_server_account_auth_routes_build\.js/);
  assert.match(deploySource, /npm run build:server-account-auth-routes/);

  console.log("[server-account-auth-routes] success");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
