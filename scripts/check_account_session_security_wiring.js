"use strict";

const fs = require("fs");
const path = require("path");

const backendRootCandidates = [
  process.cwd(),
  path.resolve(__dirname, ".."),
  path.resolve(process.cwd(), "backend"),
];

function readFirst(candidates, required = true) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }
  if (!required) return "";
  throw new Error(`Could not find required file. Checked: ${candidates.join(", ")}`);
}

function fromBackend(filename) {
  return backendRootCandidates.map((root) => path.join(root, filename));
}

function fromRepoRoot(filename) {
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(__dirname, "..", ".."),
  ];
  const expandedRoots = [];
  for (const root of roots) {
    expandedRoots.push(root);
    expandedRoots.push(path.join(root, "pixel-mania"));
  }
  return [...new Set(expandedRoots)].map((root) => path.join(root, filename));
}

const files = {
  server: readFirst(fromBackend("server.js")),
  postgres: readFirst(fromBackend("postgres_store.js")),
  accountAuthRoutes: readFirst([
    ...fromBackend("src/server_account_auth_routes.ts"),
    ...fromBackend("server_account_auth_routes.js"),
  ]),
  accountSessionHelpers: readFirst([
    ...fromBackend("src/server_account_session_helpers.ts"),
    ...fromBackend("server_account_session_helpers.js"),
  ]),
  packageJson: readFirst(fromBackend("package.json")),
  deploy: readFirst(fromBackend("deploy_to_droplet.ps1"), false),
  schema: readFirst(fromBackend("docs/postgres_security_foundation.sql")),
  envExample: readFirst(fromBackend(".env.example"), false),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
};

const accountAuthSource = `${files.server}\n${files.accountAuthRoutes}\n${files.accountSessionHelpers}`;

const checks = [
  {
    name: "accounts store explicit password algorithm metadata",
    ok: files.schema.includes("password_algorithm text NOT NULL DEFAULT 'legacy_scrypt'")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS password_algorithm")
      && files.server.includes("PASSWORD_HASH_ALGORITHM")
      && files.accountSessionHelpers.includes("parsePasswordHashAlgorithm")
      && files.accountSessionHelpers.includes("crypto.scryptSync"),
  },
  {
    name: "sessions support refresh token rotation, device tracking, and revoke reasons",
    ok: files.schema.includes("refresh_token_hash")
      && files.schema.includes("refresh_expires_at")
      && files.schema.includes("device_info jsonb")
      && files.schema.includes("revoked_reason")
      && files.postgres.includes("rotatedFromTokenHash")
      && files.postgres.includes("revokeOtherSessionsForUsername")
      && files.accountSessionHelpers.includes("issueSessionTokens")
      && accountAuthSource.includes("refresh_token"),
  },
  {
    name: "token login accepts refresh tokens and rotates old tokens",
    ok: accountAuthSource.includes("data.refresh_token || data.session_token")
      && accountAuthSource.includes("usingRefreshToken")
      && accountAuthSource.includes("revokeSessionByTokenHash(tokenHash, \"rotated\")")
      && accountAuthSource.includes("recordLoginAttempt(socket, player, account.username, usingRefreshToken ? \"refresh_token_login\" : \"token_login\", true"),
  },
  {
    name: "login attempts are rate-limited and stored durably",
    ok: files.schema.includes("CREATE TABLE IF NOT EXISTS account_login_attempts")
      && files.postgres.includes("recordLoginAttempt(entry = {})")
      && files.accountSessionHelpers.includes("checkLoginAttemptAllowed")
      && files.server.includes("LOGIN_ATTEMPT_LIMIT_ACCOUNT")
      && accountAuthSource.includes("recordLoginAttempt(socket, player, username, \"login\", false"),
  },
  {
    name: "account/auth route bodies are TypeScript-owned",
    ok: files.accountAuthRoutes.includes("createServerAccountAuthRoutes")
      && files.accountAuthRoutes.includes("async function handleAccountRegister")
      && files.accountAuthRoutes.includes("async function handleAccountTokenLogin")
      && files.server.includes("getServerAccountAuthRoutes().handleAccountRegister")
      && files.server.includes("getServerAccountAuthRoutes().handleAccountTokenLogin")
      && !/function ensureDevBackendAccount\(username\) \{\s+const usernameValidation = validateUsername/.test(files.server),
  },
  {
    name: "account/session helper bodies are TypeScript-owned",
    ok: files.accountSessionHelpers.includes("createServerAccountSessionHelpers")
      && files.accountSessionHelpers.includes("function makePasswordHash")
      && files.accountSessionHelpers.includes("function issueSessionTokens")
      && files.accountSessionHelpers.includes("async function applyPasswordResetToken")
      && files.accountSessionHelpers.includes("async function checkLoginAttemptAllowed")
      && files.server.includes("getServerAccountSessionHelpers().makePasswordHash")
      && files.server.includes("getServerAccountSessionHelpers().issueSessionTokens")
      && files.server.includes("getServerAccountSessionHelpers().applyPasswordResetToken")
      && files.server.includes("getServerAccountSessionHelpers().checkLoginAttemptAllowed")
      && !/function issueSessionTokens\(account\) \{\s+const sessionToken/.test(files.server)
      && !/async function applyPasswordResetToken\(token, password\) \{\s+const passwordValidation/.test(files.server),
  },
  {
    name: "admin 2FA is wired through TOTP verification",
    ok: files.server.includes("ADMIN_2FA_REQUIRED")
      && files.server.includes("base32ToBuffer")
      && files.server.includes("makeTotpCode")
      && files.server.includes("verifyAdminTwoFactorCode")
      && files.server.includes("admin_2fa_verified_until")
      && files.server.includes("admin_2fa_unlock"),
  },
  {
    name: "admin commands require combined security, confirmation, cooldown, and audit",
    ok: files.server.includes("getDeveloperSecurityRequirement")
      && files.server.includes("validateAdminCommandConfirmation")
      && files.server.includes("consumeAdminCommandCooldown")
      && files.server.includes("ADMIN_COMMAND_CONFIRMATION_REQUIRED")
      && files.server.includes("ADMIN_COMMAND_COOLDOWN_MS")
      && files.server.includes("developer_command_denied"),
  },
  {
    name: "env example exposes safe toggles without secrets",
    ok: files.envExample.includes("SESSION_REFRESH_TOKEN_TTL_MINUTES")
      && files.envExample.includes("ACCOUNT_ONE_ACTIVE_SESSION")
      && files.envExample.includes("ADMIN_2FA_REQUIRED=false")
      && files.envExample.includes("ADMIN_COMMAND_CONFIRMATION_REQUIRED=false"),
  },
  {
    name: "package security check includes account/session security check",
    ok: files.packageJson.includes('"check:account-security": "node scripts/check_account_session_security_wiring.js"')
      && files.packageJson.includes('"check:server-account-auth-routes": "npm run build:server-account-auth-routes && node scripts/check_server_account_auth_routes_build.js"')
      && files.packageJson.includes('"check:server-account-session-helpers": "npm run build:server-account-session-helpers && node scripts/check_server_account_session_helpers_build.js"')
      && files.packageJson.includes("npm run check:server-account-auth-routes")
      && files.packageJson.includes("npm run check:server-account-session-helpers")
      && files.packageJson.includes("npm run check:account-security"),
  },
  {
    name: "deploy helper ships and runs account/session security check",
    ok: files.deploy.includes("$localAccountSessionSecurityWiringCheck")
      && files.deploy.includes("$localServerAccountAuthRoutes")
      && files.deploy.includes("$localServerAccountSessionHelpers")
      && files.deploy.includes("node --check scripts/check_account_session_security_wiring.js")
      && files.deploy.includes("node --check scripts/check_server_account_auth_routes_build.js")
      && files.deploy.includes("node --check scripts/check_server_account_session_helpers_build.js")
      && files.deploy.includes("npm run build:server-account-auth-routes")
      && files.deploy.includes("npm run build:server-account-session-helpers")
      && files.deploy.includes("npm run check:account-security"),
  },
  {
    name: "project docs describe account/session security policy",
    ok: files.rules.includes("Account / Session Security")
      && files.handoff.includes("Account / Session Security")
      && files.handoff.includes("check:account-security"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`[account-security-wiring] ok: ${check.name}`);
  } else {
    failed += 1;
    console.error(`[account-security-wiring] fail: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`[account-security-wiring] failed ${failed} check(s).`);
  process.exit(1);
}

console.log("[account-security-wiring] success");
