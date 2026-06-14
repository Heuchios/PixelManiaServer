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
  packageJson: readFirst(fromBackend("package.json")),
  deploy: readFirst(fromBackend("deploy_to_droplet.ps1"), false),
  schema: readFirst(fromBackend("docs/postgres_security_foundation.sql")),
  envExample: readFirst(fromBackend(".env.example"), false),
  rules: readFirst(fromRepoRoot("docs/backend_persistence_rules.md"), false),
  handoff: readFirst(fromRepoRoot("docs/codex_handoff_status.md"), false),
};

const checks = [
  {
    name: "accounts store explicit password algorithm metadata",
    ok: files.schema.includes("password_algorithm text NOT NULL DEFAULT 'legacy_scrypt'")
      && files.postgres.includes("ADD COLUMN IF NOT EXISTS password_algorithm")
      && files.server.includes("PASSWORD_HASH_ALGORITHM")
      && files.server.includes("parsePasswordHashAlgorithm")
      && files.server.includes("crypto.scryptSync"),
  },
  {
    name: "sessions support refresh token rotation, device tracking, and revoke reasons",
    ok: files.schema.includes("refresh_token_hash")
      && files.schema.includes("refresh_expires_at")
      && files.schema.includes("device_info jsonb")
      && files.schema.includes("revoked_reason")
      && files.postgres.includes("rotatedFromTokenHash")
      && files.postgres.includes("revokeOtherSessionsForUsername")
      && files.server.includes("issueSessionTokens")
      && files.server.includes("refresh_token"),
  },
  {
    name: "token login accepts refresh tokens and rotates old tokens",
    ok: files.server.includes("data.refresh_token || data.session_token")
      && files.server.includes("usingRefreshToken")
      && files.server.includes("revokeSessionByTokenHash(tokenHash, \"rotated\")")
      && files.server.includes("recordLoginAttempt(socket, player, account.username, usingRefreshToken ? \"refresh_token_login\" : \"token_login\", true"),
  },
  {
    name: "login attempts are rate-limited and stored durably",
    ok: files.schema.includes("CREATE TABLE IF NOT EXISTS account_login_attempts")
      && files.postgres.includes("recordLoginAttempt(entry = {})")
      && files.server.includes("checkLoginAttemptAllowed")
      && files.server.includes("LOGIN_ATTEMPT_LIMIT_ACCOUNT")
      && files.server.includes("recordLoginAttempt(socket, player, username, \"login\", false"),
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
      && files.packageJson.includes("npm run check:account-security"),
  },
  {
    name: "deploy helper ships and runs account/session security check",
    ok: files.deploy.includes("$localAccountSessionSecurityWiringCheck")
      && files.deploy.includes("node --check scripts/check_account_session_security_wiring.js")
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
