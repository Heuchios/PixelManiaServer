#!/usr/bin/env node
// @ts-check
"use strict";

// Asserts the type-aware linter is actually alive.
//
// typescript-eslint refuses to load against typescript@7, so it runs against the
// separate typescript@6 copy in lint/node_modules. When that resolution breaks, the
// failure is silent: no-floating-promises reports nothing and ESLint exits 0, which
// is indistinguishable from clean code. lint/positive_control.ts carries one
// deliberate floating promise so there is always something the linter MUST find.
//
// This used to be checked by passing that file to `npm run lint` directly -- but a
// file whose job is to produce an error makes `npm run lint` exit 1 forever, and
// once lint was prepended to check:typescript that made check:security permanently
// red. The two jobs are opposites and need separate scripts:
//
//   npm run lint                   lints src/, must find NOTHING   (exit 0)
//   npm run lint:positive-control  lints the control, must find IT (exit 0 here)
//
// So this runs ESLint itself, reads the JSON report rather than the exit code, and
// fails when the expected finding is ABSENT.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const controlRelativePath = "lint/positive_control.ts";
const controlPath = path.join(repoRoot, controlRelativePath);
const eslintBin = path.join(repoRoot, "lint", "node_modules", "eslint", "bin", "eslint.js");
const eslintConfig = "lint/eslint.config.mjs";
const expectedRuleId = "@typescript-eslint/no-floating-promises";

assert.ok(
  fs.existsSync(controlPath),
  `${controlRelativePath} is missing. It is the only proof the linter is not silently inert -- restore it rather than deleting this check.`,
);
assert.ok(
  fs.existsSync(eslintBin),
  `Missing ${path.relative(repoRoot, eslintBin)}. Run: npm install --prefix lint`,
);

// Derive the expected line from the source so editing the file's header comment
// does not break this check.
const controlSource = fs.readFileSync(controlPath, "utf8");
const controlLines = controlSource.split(/\r?\n/u);
const expectedLineIndex = controlLines.findIndex((line) => /^\s*deliberatelyNeverAwaited\(\);\s*$/u.test(line));
assert.notEqual(
  expectedLineIndex,
  -1,
  `${controlRelativePath} no longer contains the unawaited 'deliberatelyNeverAwaited();' call, so it can no longer prove anything.`,
);
const expectedLine = expectedLineIndex + 1;

const result = childProcess.spawnSync(
  process.execPath,
  [eslintBin, "--config", eslintConfig, "--format", "json", controlRelativePath],
  { cwd: repoRoot, encoding: "utf8" },
);

if (result.error) {
  throw result.error;
}

// ESLint exits 1 whenever it reports an error, which is the expected outcome here,
// so the exit code says nothing useful. Exit codes above 1 mean ESLint itself failed.
if (result.status !== 0 && result.status !== 1) {
  throw new Error(
    `ESLint failed to run (exit ${result.status}). This is a toolchain failure, not a lint finding.\n${result.stderr || ""}`,
  );
}

/** @type {{ filePath: string, messages: { ruleId: string | null, severity: number, line: number, message: string }[] }[]} */
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  throw new Error(
    `Could not parse the ESLint JSON report. ESLint probably crashed before producing output.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

assert.equal(report.length, 1, `Expected one linted file, got ${report.length}`);

const messages = report[0].messages;
const floatingPromiseFindings = messages.filter((message) => message.ruleId === expectedRuleId);

assert.notEqual(
  floatingPromiseFindings.length,
  0,
  `THE LINTER IS INERT. ${controlRelativePath} contains a deliberate floating promise and ${expectedRuleId} did not fire.
Every other clean lint result is meaningless until this is fixed.
Most likely cause: typescript-eslint stopped resolving lint/node_modules/typescript@6.
Check with: node -e "console.log(require('./lint/node_modules/typescript').version)"
All messages reported: ${JSON.stringify(messages, null, 2)}`,
);

assert.equal(
  floatingPromiseFindings.length,
  1,
  `Expected exactly one ${expectedRuleId} finding, got ${floatingPromiseFindings.length}: ${JSON.stringify(floatingPromiseFindings, null, 2)}`,
);

const finding = floatingPromiseFindings[0];
assert.equal(finding.severity, 2, `${expectedRuleId} must be an error, not a warning (severity ${finding.severity})`);
assert.equal(
  finding.line,
  expectedLine,
  `${expectedRuleId} fired on line ${finding.line}, expected line ${expectedLine}. Did the control file change shape?`,
);

// Anything else on this file would mean the rule set drifted beyond the two rules
// this toolchain deliberately enables.
const unexpected = messages.filter((message) => message.ruleId !== expectedRuleId);
assert.deepEqual(
  unexpected,
  [],
  `Unexpected findings on the positive control: ${JSON.stringify(unexpected, null, 2)}`,
);

console.log(`[lint-positive-control] ${expectedRuleId} fired on ${controlRelativePath}:${expectedLine}`);
console.log("[lint-positive-control] the type-aware linter is live");
