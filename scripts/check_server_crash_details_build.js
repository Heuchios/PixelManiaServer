#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CrashDetails = require("../server_crash_details");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = fs.readFileSync(path.join(repoRoot, "deploy_to_droplet.ps1"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const crashDetailsSource = fs.readFileSync(path.join(repoRoot, "src", "server_crash_details.ts"), "utf8");
const crashDetailsBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_server_crash_details_build.js"), "utf8");
const crashDetailsBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.server-crash-details.json"), "utf8"));
const generatedSource = fs.readFileSync(path.join(repoRoot, "server_crash_details.js"), "utf8");

function namedCrashHelper() {
  return "ignored";
}

assert.equal(CrashDetails.trimCrashText("abcdef", 3), "abc...");
assert.equal(CrashDetails.trimCrashText(null), "");
assert.equal(
  CrashDetails.crashValueToString({ value: 1n, fn: namedCrashHelper }),
  "{\"value\":\"1\",\"fn\":\"[Function namedCrashHelper]\"}"
);
assert.equal(CrashDetails.crashValueToString("plain"), "plain");
assert.equal(CrashDetails.crashValueToString(undefined), "undefined");

const circular = {};
circular.self = circular;
assert.equal(CrashDetails.crashValueToString(circular), "[object Object]");

const codedError = Object.assign(new Error("boom"), { code: "E_TEST", cause: { nested: 1n } });
const codedDetails = CrashDetails.errorToCrashDetails(codedError);
assert.equal(codedDetails.name, "Error");
assert.equal(codedDetails.message, "boom");
assert.match(codedDetails.stack, /Error: boom/);
assert.equal(codedDetails.code, "E_TEST");
assert.equal(codedDetails.cause, "{\"nested\":\"1\"}");

assert.deepEqual(CrashDetails.errorToCrashDetails("oops"), {
  name: "string",
  message: "oops",
  stack: "",
  code: "",
});

assert.equal(
  packageJson.scripts["build:server-crash-details"],
  "tsc --project tsconfig.server-crash-details.json && node scripts/sync_server_crash_details_build.js"
);
assert.equal(
  packageJson.scripts["check:server-crash-details"],
  "npm run build:server-crash-details && node scripts/check_server_crash_details_build.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:server-crash-details/);
assert.deepEqual(crashDetailsBuildConfig.include, ["src/server_crash_details.ts"]);
assert.match(crashDetailsBuildSource, /Generated from src\/server_crash_details\.ts/);
assert.match(crashDetailsSource, /function errorToCrashDetails/);
assert.match(crashDetailsSource, /export = \{/);
assert.match(generatedSource, /Generated from src\/server_crash_details\.ts/);
assert.match(generatedSource, /module\.exports = \{/);
assert.match(serverSource, /require\("\.\/server_crash_details"\)/);
assert.match(serverSource, /CrashDetails\.errorToCrashDetails/);
assert.match(deploySource, /server_crash_details\.js/);
assert.match(deploySource, /src\/server_crash_details\.ts/);
assert.match(deploySource, /tsconfig\.server-crash-details\.json/);
assert.match(deploySource, /sync_server_crash_details_build\.js/);
assert.match(deploySource, /npm run build:server-crash-details/);

console.log("[server-crash-details] success");
