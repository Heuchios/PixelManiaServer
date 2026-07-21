#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const IdentityHelpers = require("../server_identity_helpers");
const TextHelpers = require("../server_text_helpers");
const VersionHelpers = require("../server_version_helpers");
const AccountHelpers = require("../server_account_helpers");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const helpersBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_helpers_build.js"), "utf8");
const helpersBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-helpers.json"), "utf8"));

const helperModuleNames = [
  "server_identity_helpers",
  "server_text_helpers",
  "server_version_helpers",
  "server_account_helpers",
];

assert.equal(IdentityHelpers.cleanName("  uso  "), "uso");
assert.equal(IdentityHelpers.cleanName("  "), "Guest");
assert.equal(IdentityHelpers.cleanAccountName("  USO  "), "USO");
assert.equal(IdentityHelpers.cleanEmail("  Test@Example.COM "), "test@example.com");
assert.equal(IdentityHelpers.cleanStableIdentityId("x".repeat(200)), "x".repeat(128));
assert.equal(IdentityHelpers.stableIdentityKey("  MixedCase "), "mixedcase");
assert.equal(IdentityHelpers.stableIdentityEquals(" PlayerOne ", "playerone"), true);
assert.equal(IdentityHelpers.stableIdentityEquals("", ""), false);
assert.equal(IdentityHelpers.cleanWorld(" my world!* ", 32), "MY_WORLD");
assert.equal(IdentityHelpers.cleanWorld("!!!", 32), "START");
assert.equal(IdentityHelpers.cleanStaticNetfoxWorld("*", 32), "");
assert.equal(IdentityHelpers.cleanStaticNetfoxWorld("arena 1", 32), "ARENA_1");

assert.equal(TextHelpers.clampInteger("12.9", 1, 10), 10);
assert.equal(TextHelpers.clampInteger("-2", 1, 10), 1);
assert.equal(TextHelpers.clampString("  abcdef  ", 3), "abc");
assert.equal(TextHelpers.safeFileName("Hello World!.json", "data"), "Hello_Worldjson");
assert.equal(TextHelpers.safeFileName("!!!", "data"), "data");
assert.equal(TextHelpers.escapeHtml("<tag attr=\"x\">Tom & 'Sue'</tag>"), "&lt;tag attr=&quot;x&quot;&gt;Tom &amp; &#039;Sue&#039;&lt;/tag&gt;");
assert.equal(TextHelpers.cleanPunishmentReason("  too   much\nspace  ", 500), "too much space");
assert.equal(TextHelpers.cleanPunishmentReason("", 500), "No reason provided.");
assert.equal(TextHelpers.cleanDoorId(" main door!* ", 32), "MAIN_DOOR");
assert.equal(TextHelpers.cleanDoorDestination("  TARGET  ", 6), "TARGET");
assert.equal(TextHelpers.cleanDoorName("Line\r\nBreak", 64), "Line Break");
assert.equal(TextHelpers.cleanDoorPassword("  pass  ", 32), "pass");

assert.equal(VersionHelpers.getClientVersion({ client_version: " 1.2.3 " }), "1.2.3");
assert.deepEqual(VersionHelpers.parseVersionParts("v1.2.3-beta+7"), [1, 2, 3]);
assert.deepEqual(VersionHelpers.parseVersionParts("1.2"), [1, 2, 0]);
assert.equal(VersionHelpers.parseVersionParts(""), null);
assert.equal(VersionHelpers.compareVersions("1.2.4", "1.2.3"), 1);
assert.equal(VersionHelpers.compareVersions("1.2.3", "1.2.3"), 0);
assert.equal(VersionHelpers.compareVersions("1.2.2", "1.2.3"), -1);
assert.equal(VersionHelpers.compareVersions("", "1.2.3"), null);
assert.equal(VersionHelpers.isClientVersionAllowed("1.0.2", "1.0.1"), true);
assert.equal(VersionHelpers.isClientVersionAllowed("1.0.0", "1.0.1"), false);

assert.deepEqual(AccountHelpers.cloneJson({ nested: { value: 1 } }), { nested: { value: 1 } });
assert.equal(AccountHelpers.makeAuditHash({ a: 1 }), crypto.createHash("sha256").update(JSON.stringify({ a: 1 })).digest("hex"));
assert.deepEqual(AccountHelpers.validateUsername("uso", 3, 16), { ok: true, username: "uso" });
assert.deepEqual(AccountHelpers.validateUsername("us", 3, 16), { ok: false, message: "Username must be at least 3 characters." });
assert.deepEqual(AccountHelpers.validateUsername("bad-name", 3, 16), { ok: false, message: "Use letters, numbers, and underscore only." });
assert.deepEqual(AccountHelpers.validateEmail(" TEST@Example.com "), { ok: true, email: "test@example.com" });
assert.deepEqual(AccountHelpers.validateEmail("bad email@example.com"), { ok: false, message: "Email cannot contain spaces." });
assert.deepEqual(AccountHelpers.validatePassword("12345678", 8), { ok: true, password: "12345678" });
assert.deepEqual(AccountHelpers.validatePassword("123", 8), { ok: false, message: "Password must be at least 8 characters." });

assert.equal(
  packageJson.scripts["build:server-helpers"],
  "tsc --project tsconfig.server-helpers.json && node scripts/sync_server_helpers_build.js"
);
assert.equal(
  packageJson.scripts["check:server-helpers"],
  "npm run build:server-helpers && node scripts/check_server_helpers_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-helpers/);
assert.deepEqual(helpersBuildConfig.include, [
  "src/server_identity_helpers.ts",
  "src/server_text_helpers.ts",
  "src/server_version_helpers.ts",
  "src/server_account_helpers.ts",
]);
assert.match(helpersBuildSource, /server_identity_helpers/);
assert.match(serverSource, /require\("\.\/server_identity_helpers"\)/);
assert.match(serverSource, /IdentityHelpers\.cleanWorld/);
assert.match(serverSource, /TextHelpers\.clampString/);
assert.match(serverSource, /VersionHelpers\.compareVersions/);
assert.match(serverSource, /AccountHelpers\.cloneJson/);
assert.match(deploySource, /tsconfig\.server-helpers\.json/);
assert.match(deploySource, /sync_server_helpers_build\.js/);
assert.match(deploySource, /npm run build:server-helpers/);

for (const moduleName of helperModuleNames) {
  const source = fs.readFileSync(path.join(repoRoot, "src", `${moduleName}.ts`), "utf8");
  const generated = fs.readFileSync(path.join(repoRoot, `${moduleName}.js`), "utf8");
  assert.match(source, /export = \{/);
  assert.match(generated, new RegExp(`Generated from src/${moduleName}\\.ts`));
  assert.match(generated, /module\.exports = \{/);
  assert.match(deploySource, new RegExp(`${moduleName}\\.js`));
  assert.match(deploySource, new RegExp(`src/${moduleName}\\.ts`));
}

console.log("[server-helpers] success");
