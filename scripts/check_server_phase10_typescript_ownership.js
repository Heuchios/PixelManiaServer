#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");

/**
 * @typedef {object} Phase10Module
 * @property {string} label
 * @property {string} baseName
 * @property {string} scriptName
 * @property {string} configName
 * @property {string} factoryName
 * @property {string} getterName
 * @property {string[]} wrappers
 */

/** @type {Phase10Module[]} */
const modules = [
  {
    label: "account auth routes",
    baseName: "server_account_auth_routes",
    scriptName: "server-account-auth-routes",
    configName: "tsconfig.server-account-auth-routes.json",
    factoryName: "createServerAccountAuthRoutes",
    getterName: "getServerAccountAuthRoutes",
    wrappers: [
      "handleAccountRegister",
      "handleAccountPasswordResetRequest",
      "handleAccountEmailChangeRequest",
      "ensureDevBackendAccount",
      "ensureDevBackendPlayerState",
      "handleDevBackendLogin",
      "handleAccountLogin",
      "handleAccountTokenLogin",
    ],
  },
  {
    label: "account session helpers",
    baseName: "server_account_session_helpers",
    scriptName: "server-account-session-helpers",
    configName: "tsconfig.server-account-session-helpers.json",
    factoryName: "createServerAccountSessionHelpers",
    getterName: "getServerAccountSessionHelpers",
    wrappers: [
      "validateUsername",
      "validateEmail",
      "validatePassword",
      "parsePasswordHashAlgorithm",
      "makePasswordHash",
      "verifyPassword",
      "makeTokenHash",
      "makeSecureToken",
      "issueSessionToken",
      "issueSessionTokens",
      "clearSessionToken",
      "isSessionTokenValid",
      "isAccountEmailVerified",
      "makeEmailVerificationToken",
      "makeEmailVerificationUrl",
      "makePasswordResetUrl",
      "makeEmailChangeUrl",
      "hasActiveEmailVerificationToken",
      "getMailTransporter",
      "sendVerificationEmail",
      "queueVerificationEmail",
      "sendPasswordResetEmail",
      "queuePasswordResetEmail",
      "sendEmailChangeEmail",
      "queueEmailChangeEmail",
      "verifyEmailToken",
      "consumePasswordResetToken",
      "applyPasswordResetToken",
      "confirmEmailChangeToken",
      "hasPassword",
      "findAccountByEmail",
      "getLoginAttemptSubject",
      "consumeLocalLoginAttempt",
      "checkLoginAttemptAllowed",
      "recordLoginAttempt",
      "isRefreshTokenValid",
    ],
  },
  {
    label: "admin lookup routes",
    baseName: "server_admin_lookup_routes",
    scriptName: "server-admin-lookup-routes",
    configName: "tsconfig.server-admin-lookup-routes.json",
    factoryName: "createServerAdminLookupRoutes",
    getterName: "getServerAdminLookupRoutes",
    wrappers: [
      "buildAdminInventoryLookupPlayerData",
      "buildAdminMonitoringOnlinePlayers",
      "buildAdminMonitoringWorldRows",
      "buildAdminMonitoringRuntimeSnapshot",
      "buildAdminItemInstanceLookupRows",
      "buildAdminTransactionLedgerLookupRows",
      "handleAdminInventoryLookupRequest",
      "handleAdminItemInstanceLookupRequest",
      "handleAdminItemInstanceHistoryLookupRequest",
      "handleAdminTransactionLedgerLookupRequest",
      "handleAdminMonitoringDashboardRequest",
    ],
  },
  {
    label: "friend routes",
    baseName: "server_friend_routes",
    scriptName: "server-friend-routes",
    configName: "tsconfig.server-friend-routes.json",
    factoryName: "createServerFriendRoutes",
    getterName: "getServerFriendRoutes",
    wrappers: [
      "sanitizeAccountNameArray",
      "ensureFriendFields",
      "accountNameArrayHas",
      "addAccountName",
      "removeAccountName",
      "getAccountDisplayUsername",
      "getFriendAccount",
      "buildFriendEntry",
      "getFriendStatus",
      "buildFriendStatePayload",
      "sendFriendState",
      "sendFriendError",
      "handleFriendListRequest",
      "handleFriendRequest",
      "handleFriendResponse",
      "notifyOnlineFriendsOfFriendState",
    ],
  },
  {
    label: "trade routes",
    baseName: "server_trade_routes",
    scriptName: "server-trade-routes",
    configName: "tsconfig.server-trade-routes.json",
    factoryName: "createServerTradeRoutes",
    getterName: "getServerTradeRoutes",
    wrappers: [
      "handleTradeRequest",
      "handleTradeResponse",
      "findTradeForResponse",
      "sanitizeTradeOfferItem",
      "getTradeOfferTotals",
      "canOfferTradeItems",
      "resetTradeApprovals",
      "handleTradeOfferUpdate",
      "handleTradeConfirm",
      "handleTradeFinalConfirm",
      "handleTradeCancel",
    ],
  },
  {
    label: "inventory economy routes",
    baseName: "server_inventory_economy_routes",
    scriptName: "server-inventory-economy-routes",
    configName: "tsconfig.server-inventory-economy-routes.json",
    factoryName: "createServerInventoryEconomyRoutes",
    getterName: "getServerInventoryEconomyRoutes",
    wrappers: [
      "handleInventoryTransactionRequest",
      "handleInventoryUpgradePurchase",
      "handleShopBuyTransaction",
    ],
  },
];

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} filename
 * @returns {string}
 */
function readRequired(filename) {
  const filePath = path.join(repoRoot, filename);
  assert.ok(fs.existsSync(filePath), `Missing Phase 10 artifact: ${filename}`);
  return fs.readFileSync(filePath, "utf8");
}

/**
 * @param {string} functionName
 * @param {string} getterName
 * @returns {void}
 */
function assertThinServerWrapper(functionName, getterName) {
  const escapedFunction = escapeRegExp(functionName);
  const declarationPattern = new RegExp(`(?:async\\s+)?function\\s+${escapedFunction}\\s*\\(`, "g");
  const declarations = serverSource.match(declarationPattern) || [];
  assert.equal(
    declarations.length,
    1,
    `${functionName} must have exactly one server.js bridge declaration`,
  );
  const delegationPattern = new RegExp(
    `return\\s+(?:await\\s+)?${escapeRegExp(getterName)}\\(\\)\\.${escapedFunction}\\(`,
  );
  assert.match(
    serverSource,
    delegationPattern,
    `${functionName} must delegate to ${getterName}`,
  );
}

for (const moduleEntry of modules) {
  const sourceName = `src/${moduleEntry.baseName}.ts`;
  const generatedName = `${moduleEntry.baseName}.js`;
  const checkName = `scripts/check_${moduleEntry.baseName}_build.js`;
  const syncName = `scripts/sync_${moduleEntry.baseName}_build.js`;
  const source = readRequired(sourceName);
  const generated = readRequired(generatedName);
  const configSource = readRequired(moduleEntry.configName);
  const checkSource = readRequired(checkName);
  const syncSource = readRequired(syncName);

  assert.ok(configSource.includes(sourceName), `${moduleEntry.configName} must compile ${sourceName}`);
  assert.ok(source.includes(`function ${moduleEntry.factoryName}(`), `${sourceName} must own ${moduleEntry.factoryName}`);
  assert.ok(generated.startsWith(`// Generated from ${sourceName}. Do not edit by hand.`));
  assert.ok(generated.includes(`function ${moduleEntry.factoryName}(`));
  assert.ok(syncSource.includes(sourceName));
  assert.ok(syncSource.includes(generatedName));
  assert.ok(checkSource.includes(sourceName));
  assert.ok(checkSource.includes(generatedName));

  const buildScript = packageJson.scripts?.[`build:${moduleEntry.scriptName}`] || "";
  const checkScript = packageJson.scripts?.[`check:${moduleEntry.scriptName}`] || "";
  assert.ok(buildScript.includes(moduleEntry.configName));
  assert.ok(buildScript.includes(path.basename(syncName)));
  assert.ok(checkScript.includes(`npm run build:${moduleEntry.scriptName}`));
  assert.ok(checkScript.includes(path.basename(checkName)));
  assert.ok(packageJson.scripts?.["check:typescript"]?.includes(`npm run check:${moduleEntry.scriptName}`));

  assert.ok(serverSource.includes(`require("./${moduleEntry.baseName}")`));
  assert.ok(serverSource.includes(`.${moduleEntry.factoryName}({`));
  assert.ok(deploySource.includes(path.basename(checkName)));
  assert.ok(deploySource.includes(path.basename(syncName)));

  for (const wrapper of moduleEntry.wrappers) {
    assertThinServerWrapper(wrapper, moduleEntry.getterName);
    assert.ok(source.includes(wrapper), `${sourceName} must own ${wrapper}`);
    assert.ok(generated.includes(wrapper), `${generatedName} must export ${wrapper}`);
  }

  console.log(`[server-phase10-ownership] ok: ${moduleEntry.label}`);
}

for (const deadFunction of [
  "sendAdminInventoryLookupFailure",
  "sendAdminItemInstanceLookupFailure",
  "sendAdminItemInstanceHistoryLookupFailure",
  "sendAdminTransactionLedgerLookupFailure",
  "sendAdminMonitoringDashboardFailure",
]) {
  assert.doesNotMatch(
    serverSource,
    new RegExp(`function\\s+${escapeRegExp(deadFunction)}\\s*\\(`),
    `${deadFunction} must not remain in server.js`,
  );
}

const adminSource = readRequired("src/server_admin_lookup_routes.ts");
const generatedAdminSource = readRequired("server_admin_lookup_routes.js");
for (const marker of [
  "admin_inventory_lookup_denied",
  "admin_item_instance_lookup_denied",
  "admin_item_instance_history_lookup_denied",
  "admin_transaction_ledger_lookup_denied",
  "admin_monitoring_dashboard_denied",
]) {
  assert.ok(!serverSource.includes(marker), `${marker} must be owned outside server.js`);
  assert.ok(adminSource.includes(marker), `${marker} must remain in the TypeScript owner`);
  assert.ok(generatedAdminSource.includes(marker), `${marker} must remain in the generated owner`);
}

for (const securityBoundary of [
  "validateWorldLockKeyTradeCandidate",
  "validateTradeWorldLockKeyTransfers",
  "applyWorldLockKeyTradeOwnershipTransfers",
  "validateFullTradeInventory",
  "executeTrade",
]) {
  assert.match(
    serverSource,
    new RegExp(`(?:async\\s+)?function\\s+${securityBoundary}\\s*\\(`),
    `${securityBoundary} must remain wired during the TypeScript transition`,
  );
}

assert.equal(
  packageJson.scripts?.["check:server-phase10-ownership"],
  "node scripts/check_server_phase10_typescript_ownership.js",
);
assert.ok(packageJson.scripts?.["check:typescript"]?.includes("npm run check:server-phase10-ownership"));
assert.ok(packageJson.scripts?.["check:security"]?.includes("npm run check:typescript"));
assert.ok(deploySource.includes("$localServerPhase10OwnershipCheck"));
assert.ok(deploySource.includes("node --check scripts/check_server_phase10_typescript_ownership.js"));
assert.ok(deploySource.includes("npm run check:server-phase10-ownership"));

console.log("[server-phase10-ownership] success");
