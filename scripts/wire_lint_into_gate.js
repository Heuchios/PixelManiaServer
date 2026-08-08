#!/usr/bin/env node
// @ts-check
"use strict";

// Promote lint from survey to gate.
//
// The first full survey came back at 0 findings across all 42 files in src/
// (42 files linted, 0 messages), with lint/positive_control.ts confirming the rules
// are live. A linter at zero is the cheapest possible ratchet: it cannot fail today,
// and from here it only fires on regressions.
//
// This prepends `npm run lint` to check:typescript, which is the last link in the
// check:security chain -- so both gates pick it up from one edit.
//
// package.json indentation is detected and preserved, so the diff is one line rather
// than a reformat of all 153 scripts.
//
// Idempotent: running it twice is a no-op.
//
// Usage:
//     node scripts/wire_lint_into_gate.js

const fs = require("node:fs");
const path = require("node:path");

const pkgPath = path.join(__dirname, "..", "package.json");
const raw = fs.readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(raw);

const indentMatch = raw.match(/\n([\t ]+)"/);
const indent = indentMatch ? indentMatch[1] : "  ";

if (!pkg.scripts || !pkg.scripts.lint) {
  throw new Error("scripts.lint is missing -- run setup_and_verify_eslint.ps1 first.");
}
if (!pkg.scripts["check:typescript"]) {
  throw new Error("scripts['check:typescript'] is missing.");
}

if (pkg.scripts["check:typescript"].includes("npm run lint")) {
  console.log("[wire-lint] already wired; nothing to do.");
  process.exit(0);
}

pkg.scripts["check:typescript"] = "npm run lint && " + pkg.scripts["check:typescript"];
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + "\n", "utf8");

console.log("[wire-lint] prepended 'npm run lint' to check:typescript");
console.log("[wire-lint] indent preserved: " + JSON.stringify(indent));
console.log("[wire-lint] verify with: npm run check:security");
