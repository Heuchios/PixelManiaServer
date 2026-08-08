#!/usr/bin/env node
// @ts-check
"use strict";

// Guards the per-module TypeScript project layout.
//
// The 37 build projects used to be hand-copied siblings of ./tsconfig.json rather
// than children of it, and they had already drifted: 12 of them silently set
// `useUnknownInCatchVariables: false`, so every `catch (error)` in those modules
// typed `error` as `any` while the same files were checked with `unknown` by
// `check:types`. Consolidating them onto the base removed that drift, but a
// consolidated layout has a new failure mode: a project can now inherit LESS
// checking than it looks like it has, and a build that checks nothing still exits 0.
//
// So this asserts the resolved configuration, not the file text:
//   * every project extends the base and overrides only the keys listed below,
//   * every strict-family option resolves to true in every project,
//   * the emit-shape options are identical across projects, so no project can
//     quietly change what the generated .js looks like,
//   * every src/*.ts is owned by exactly one build project, so a new module
//     cannot land with no typecheck and no build script,
//   * the project-reference graph matches the real import graph, so a new
//     cross-project import cannot silently recompile its dependency's source,
//   * every build command pinned as literal text inside a check_*.js still matches
//     package.json, so editing a build script cannot break a guard minutes later.
//
// SERVER-ENTRY IS DELIBERATELY EXEMPT FROM REFERENCES.
// src/server.ts pulls all 39 modules in via `import X = require("./y")`, which makes
// the server-entry compile a whole-program check over ~40k lines of dependency source.
// Switching it to project references would replace that with .d.ts reads -- and
// skipLibCheck: true would then skip those too. That is a REDUCTION in checking
// disguised as a build optimisation. The exemption is pinned here so it stays a
// visible decision, and so no other project can quietly acquire the same gap.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { STRICT_FAMILY_OPTIONS, effectiveStrictness, resolveTsconfig } = require("./tsconfig_effective");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

// Options a per-module project is allowed to set locally. Anything else belongs
// in ./tsconfig.json so it applies everywhere.
const ALWAYS_LOCAL_OPTIONS = ["noEmit", "outDir", "rootDir"];

// Enabled in the base but NOT implied by `strict`, so `effectiveStrictness` cannot see
// them. Only src/postgres_store.ts had these until they were promoted -- probes measured
// 0 errors across every other file, including src/server.ts, so the promotion was free.
// They must never silently regress to one project's private setting again.
const REQUIRED_NON_STRICT_OPTIONS = [
  "noFallthroughCasesInSwitch",
  "noImplicitReturns",
];

// Options that decide the shape of the emitted JavaScript. Every project must
// agree on these, or one module's generated .js stops matching the others and
// deploy_to_droplet.ps1's rebuild-and-diff check starts failing intermittently.
const EMIT_SHAPE_OPTIONS = [
  "esModuleInterop",
  "forceConsistentCasingInFileNames",
  "module",
  "resolveJsonModule",
  "target",
];

/**
 * @typedef {object} ProjectPin
 * @property {string[]} include
 * @property {string} outDir
 * @property {Record<string, any>} localOptions
 * @property {string[]} references project names this one reads .d.ts from
 * @property {string[]} [inlineDependencies] project names whose SOURCE this one compiles
 * @property {boolean} [referencesExempt] see the SERVER-ENTRY note below
 */

/** @type {Record<string, ProjectPin>} */
const PROJECTS = {
  "drop-contracts": {
    include: ["src/server_drop_contracts.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "inventory-contracts": {
    include: ["src/server_inventory_contracts.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "item-data": {
    include: ["src/atlas_item_definition.ts","src/item_atlas_db.ts","src/server_item_database.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "packet-contracts": {
    include: ["src/server_packet_contracts.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "postgres-contracts": {
    include: ["src/postgres_store_contracts.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
    inlineDependencies: ["item-data"],
  },
  "postgres-store": {
    include: ["src/postgres_store.ts"],
    outDir: ".tsbuild",
    localOptions: {"allowJs":false},
    references: [],
    inlineDependencies: ["drop-contracts", "inventory-contracts", "postgres-contracts", "item-data"],
  },
  "redis-store": {
    include: ["src/redis_store.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-account-auth-routes": {
    include: ["src/server_account_auth_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-account-session-helpers": {
    include: ["src/server_account_session_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
    inlineDependencies: ["server-helpers"],
  },
  "server-admin-lookup-routes": {
    include: ["src/server_admin_lookup_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-bot-rate-limit-helpers": {
    include: ["src/server_bot_rate_limit_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-crash-details": {
    include: ["src/server_crash_details.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-entry": {
    include: ["src/server.ts"],
    outDir: ".tsbuild/server-entry",
    localOptions: {"noEmitOnError":true,"moduleDetection":"force"},
    references: [],
    referencesExempt: true,
  },
  "server-env-config": {
    include: ["src/server_env_config.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-friend-routes": {
    include: ["src/server_friend_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-helpers": {
    include: ["src/server_identity_helpers.ts","src/server_text_helpers.ts","src/server_version_helpers.ts","src/server_account_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-inventory-economy-routes": {
    include: ["src/server_inventory_economy_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-inventory-transaction-helpers": {
    include: ["src/server_inventory_transaction_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-message-router-helpers": {
    include: ["src/server_message_router_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-persistence-helpers": {
    include: ["src/server_persistence_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-phase11a-runtime": {
    include: ["src/server_phase11a_runtime.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-phase11b-lifecycle": {
    include: ["src/server_phase11b_lifecycle.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-phase11c-trusted-movement": {
    include: ["src/server_phase11c_trusted_movement.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-phase11d-standard-movement": {
    include: ["src/server_phase11d_standard_movement.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-phase6-helpers": {
    include: ["src/server_phase6_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-phase7-dispatcher": {
    include: ["src/server_phase7_dispatcher.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-phase8-final-routes": {
    include: ["src/server_phase8_final_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-phase8-player-session-routes": {
    include: ["src/server_phase8_player_session_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-phase8-world-action-routes": {
    include: ["src/server_phase8_world_action_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-phase9-remaining-routes": {
    include: ["src/server_phase9_remaining_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-player-state-helpers": {
    include: ["src/server_player_state_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-punishment-helpers": {
    include: ["src/server_punishment_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-runtime-stats": {
    include: ["src/server_runtime_stats.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-socket-delivery-helpers": {
    include: ["src/server_socket_delivery_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-trade-routes": {
    include: ["src/server_trade_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-world-interaction-payload-helpers": {
    include: ["src/server_world_interaction_payload_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
  "server-world-state-helpers": {
    include: ["src/server_world_state_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
    references: [],
  },
};

/** @param {string} projectName */
function configNameFor(projectName) {
  return `tsconfig.${projectName}.json`;
}

const baseConfigPath = path.join(repoRoot, "tsconfig.json");
const base = resolveTsconfig(baseConfigPath);

// ---------------------------------------------------------------------------
// The base project.
// ---------------------------------------------------------------------------

assert.equal(base.extendsChain.length, 0, "tsconfig.json must be the root of the extends chain");
assert.equal(base.compilerOptions.strict, true, "tsconfig.json must set strict: true");
assert.equal(base.compilerOptions.noEmit, true, "tsconfig.json must not emit");
for (const option of STRICT_FAMILY_OPTIONS) {
  assert.notEqual(
    base.compilerOptions[option],
    false,
    `tsconfig.json must not weaken ${option}; every project inherits it`,
  );
}
for (const option of REQUIRED_NON_STRICT_OPTIONS) {
  assert.equal(
    base.compilerOptions[option],
    true,
    `tsconfig.json must set ${option}: true -- it is not implied by strict, so nothing else enforces it`,
  );
}
// src/server.ts and src/postgres_store.ts are checked by their own strict
// projects, so the base leaves them out. tsconfig.server-entry.json and
// tsconfig.postgres-store.json therefore have to clear `exclude` to see them,
// which is why every project below pins "exclude": [].
for (const excluded of ["src/server.ts", "src/postgres_store.ts"]) {
  assert.ok(
    (base.exclude || []).includes(excluded),
    `tsconfig.json must exclude ${excluded} (it is owned by a dedicated project)`,
  );
}

// ---------------------------------------------------------------------------
// No unregistered project configs.
// ---------------------------------------------------------------------------

const rootConfigFiles = fs
  .readdirSync(repoRoot)
  .filter((entry) => /^tsconfig\..*\.json$/u.test(entry))
  .sort();
const expectedConfigFiles = ["tsconfig.eslint.json", ...Object.keys(PROJECTS).map(configNameFor)].sort();
assert.deepEqual(
  rootConfigFiles,
  expectedConfigFiles,
  "every tsconfig.*.json must be registered in check_tsconfig_projects.js (add the project or delete the file)",
);

// ---------------------------------------------------------------------------
// Each build project.
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const sourceOwner = {};

for (const [projectName, pin] of Object.entries(PROJECTS)) {
  const configName = configNameFor(projectName);
  const resolved = resolveTsconfig(path.join(repoRoot, configName));
  const local = JSON.parse(fs.readFileSync(path.join(repoRoot, configName), "utf8"));

  assert.deepEqual(
    resolved.extendsChain,
    ["./tsconfig.json"],
    `${configName} must extend ./tsconfig.json directly, not restate the base options`,
  );

  const allowedLocalKeys = [...ALWAYS_LOCAL_OPTIONS, ...Object.keys(pin.localOptions)].sort();
  assert.deepEqual(
    Object.keys(local.compilerOptions || {}).sort(),
    allowedLocalKeys,
    `${configName} may only set ${allowedLocalKeys.join(", ")} locally`,
  );
  for (const [option, expected] of Object.entries(pin.localOptions)) {
    assert.deepEqual(
      local.compilerOptions[option],
      expected,
      `${configName} must keep ${option} = ${JSON.stringify(expected)}`,
    );
  }

  assert.equal(local.compilerOptions.noEmit, false, `${configName} must emit`);
  assert.equal(local.compilerOptions.outDir, pin.outDir, `${configName} must emit to ${pin.outDir}`);
  assert.equal(local.compilerOptions.rootDir, "src", `${configName} must use rootDir src`);
  assert.deepEqual(local.include, pin.include, `${configName} include drifted from the pinned file list`);
  assert.deepEqual(
    local.exclude,
    [],
    `${configName} must clear the base exclude list; its include is an explicit file list`,
  );

  // The point of the whole exercise: no project may check less than the base.
  const strictness = effectiveStrictness(resolved.compilerOptions);
  for (const [option, value] of Object.entries(strictness)) {
    assert.equal(value, true, `${configName} resolves ${option} to ${value}, which checks less than the base`);
  }

  for (const option of REQUIRED_NON_STRICT_OPTIONS) {
    assert.equal(
      resolved.compilerOptions[option],
      true,
      `${configName} resolves ${option} to ${resolved.compilerOptions[option]}, which checks less than the base`,
    );
  }

  for (const option of EMIT_SHAPE_OPTIONS) {
    assert.deepEqual(
      resolved.compilerOptions[option],
      base.compilerOptions[option],
      `${configName} changes ${option}, which changes the shape of the generated JavaScript`,
    );
  }

  // Build and check wiring, so a project cannot exist without being run.
  const buildScript = packageJson.scripts?.[`build:${projectName}`];
  const checkScript = packageJson.scripts?.[`check:${projectName}`];
  assert.ok(buildScript, `package.json must define build:${projectName}`);
  assert.ok(checkScript, `package.json must define check:${projectName}`);
  assert.ok(buildScript.includes(configName), `build:${projectName} must compile ${configName}`);
  assert.ok(
    checkScript.includes(`npm run build:${projectName}`),
    `check:${projectName} must build before it checks`,
  );
  assert.ok(
    packageJson.scripts?.["check:typescript"]?.includes(`npm run check:${projectName}`),
    `check:typescript must run check:${projectName}`,
  );

  assert.deepEqual(
    (local.references || []).map((/** @type {{ path: string }} */ reference) => reference.path),
    pin.references.map((/** @type {string} */ name) => `./${configNameFor(name)}`),
    `${configName} references drifted from the pinned list`,
  );

  // composite forces declaration: true. Setting it false is an error tsc reports as
  // "Composite projects may not disable declaration emit", and setting it false on a
  // NON-composite project would break any future reference to it.
  assert.notEqual(
    resolved.compilerOptions.declaration,
    false,
    `${configName} sets declaration: false, which blocks composite and project references`,
  );

  // A project with references MUST be built with `tsc --build`. With `tsc --project`,
  // tsc does not build the referenced projects and fails with TS6305 ("output file has
  // not been built from source file") -- or worse, silently reads a stale .d.ts.
  if (pin.references.length > 0) {
    assert.ok(
      buildScript.includes("tsc --build"),
      `build:${projectName} has references, so it must use "tsc --build" rather than "tsc --project"`,
    );
  } else {
    assert.ok(
      buildScript.includes("tsc --project"),
      `build:${projectName} has no references, so it should stay on "tsc --project"`,
    );
  }

  for (const included of pin.include) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, included)),
      `${configName} includes ${included}, which does not exist`,
    );
    assert.ok(
      !sourceOwner[included],
      `${included} is compiled by both ${sourceOwner[included]} and ${configName}; two projects emitting one file race on .tsbuild`,
    );
    sourceOwner[included] = configName;
  }
}

// ---------------------------------------------------------------------------
// Every source file is owned.
// ---------------------------------------------------------------------------

const sourceFiles = fs
  .readdirSync(path.join(repoRoot, "src"))
  .filter((entry) => entry.endsWith(".ts"))
  .map((entry) => `src/${entry}`)
  .sort();
const unowned = sourceFiles.filter((file) => !sourceOwner[file]);
assert.deepEqual(
  unowned,
  [],
  `these src modules have no build project, so they are never compiled or synced: ${unowned.join(", ")}`,
);

// ---------------------------------------------------------------------------
// The project-reference graph must match the real import graph.
// ---------------------------------------------------------------------------

// Only projects that are actually referenced need composite -- it forces declaration
// emit, so turning it on where nothing consumes the .d.ts is pure cost.
const referencedProjects = new Set(Object.values(PROJECTS).flatMap((pin) => pin.references));

for (const [projectName, pin] of Object.entries(PROJECTS)) {
  const isComposite = pin.localOptions.composite === true;

  if (referencedProjects.has(projectName)) {
    assert.ok(
      isComposite,
      `${configNameFor(projectName)} is referenced by another project, so it MUST set composite: true (tsc reports TS6306 otherwise)`,
    );
  } else {
    assert.ok(
      !isComposite,
      `${configNameFor(projectName)} sets composite: true but nothing references it -- that pays declaration-emit cost for nothing`,
    );
  }

  // A --build root needs somewhere to record up-to-date state. composite implies
  // incremental; a non-composite reference root has to say so.
  if (pin.references.length > 0 && !isComposite) {
    assert.equal(
      pin.localOptions.incremental,
      true,
      `${configNameFor(projectName)} is a --build root without composite, so it needs incremental: true`,
    );
  }

  for (const reference of pin.references) {
    assert.ok(
      PROJECTS[reference],
      `${configNameFor(projectName)} references unknown project "${reference}"`,
    );
    assert.notEqual(reference, projectName, `${configNameFor(projectName)} references itself`);
  }
}

// tsc resolves a shared outDir fine, but two projects writing one .tsbuildinfo would
// corrupt each other's up-to-date state and could skip a rebuild that was needed.
/** @type {Record<string, string>} */
const buildInfoOwner = {};
for (const [projectName, pin] of Object.entries(PROJECTS)) {
  const buildInfo = pin.localOptions.tsBuildInfoFile;
  if (!buildInfo) {
    continue;
  }
  assert.ok(
    !buildInfoOwner[buildInfo],
    `${buildInfo} is claimed by both ${buildInfoOwner[buildInfo]} and ${projectName}`,
  );
  buildInfoOwner[buildInfo] = projectName;
}

// Acyclic: tsc rejects a cycle (TS6202), but it rejects it with a message that does
// not name the edge that closed the loop, so catch it here instead.
for (const start of Object.keys(PROJECTS)) {
  /** @type {string[]} */
  const stack = [start];
  /** @type {Set<string>} */
  const seen = new Set();
  while (stack.length > 0) {
    const current = /** @type {string} */ (stack.pop());
    for (const next of PROJECTS[current].references) {
      assert.notEqual(next, start, `Project reference cycle involving ${start} -> ... -> ${next}`);
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
}

// Every cross-project TYPE-LEVEL import must be backed by a reference. Without this,
// adding one import to a module silently pulls its dependency's SOURCE into a second
// project, where it gets compiled again -- possibly under different options.
//
// CRITICAL: only `import X = require("./y")` and `from "./y"` count. A bare
// `const X = require("./y")` is NOT an import -- it is a call on Node's `require`,
// typed `any` by @types/node, and tsc never adds the target module to the program.
// An earlier version of this guard matched both forms, "proved" that postgres-store
// needed four project references, and those references turned out to be completely
// inert: --listFiles showed 200 files in postgres-store's program with
// server_item_database present in neither source nor .d.ts form.
const TYPE_IMPORT_PATTERN = /(?:\bimport\s+[A-Za-z0-9_$]+\s*=\s*require\(|\bfrom\s+)\s*"(\.\/[A-Za-z0-9_.-]+)"/gu;

for (const [projectName, pin] of Object.entries(PROJECTS)) {
  /** @type {Set<string>} */
  const importedProjects = new Set();

  for (const included of pin.include) {
    const source = fs.readFileSync(path.join(repoRoot, included), "utf8");
    for (const match of source.matchAll(TYPE_IMPORT_PATTERN)) {
      const target = `src/${match[1].replace(/^\.\//u, "")}.ts`;
      const owner = sourceOwner[target];
      if (!owner) {
        continue;
      }
      const ownerProject = owner.replace(/^tsconfig\./u, "").replace(/\.json$/u, "");
      if (ownerProject !== projectName) {
        importedProjects.add(ownerProject);
      }
    }
  }

  if (pin.referencesExempt) {
    // server-entry: compiling dependency SOURCE is the point, for all 39. See the
    // header note. It needs no per-dependency pin because the answer is always inline.
    assert.equal(
      pin.references.length,
      0,
      `${configNameFor(projectName)} is marked referencesExempt, so it must have no references`,
    );
    assert.equal(
      (pin.inlineDependencies || []).length,
      0,
      `${configNameFor(projectName)} is referencesExempt, which already means every dependency is inline`,
    );
    continue;
  }

  // Two legitimate ways to satisfy a cross-project type import, and the choice must be
  // deliberate rather than accidental:
  //   references         -- read the dependency's emitted .d.ts. Faster; needs composite.
  //   inlineDependencies -- compile the dependency's SOURCE into this program. Slower,
  //                         but checks more, which is why server-entry does it for all 39.
  const inlineDependencies = pin.inlineDependencies || [];
  const missing = [...importedProjects]
    .filter((name) => !pin.references.includes(name) && !inlineDependencies.includes(name))
    .sort();
  assert.deepEqual(
    missing,
    [],
    `${configNameFor(projectName)} type-imports from ${missing.join(", ")} without pinning how. Add ${missing.length === 1 ? "it" : "them"} to references (reads .d.ts, needs composite on the target) or to inlineDependencies (compiles the source here).`,
  );

  const unusedReferences = pin.references.filter((name) => !importedProjects.has(name)).sort();
  assert.deepEqual(
    unusedReferences,
    [],
    `${configNameFor(projectName)} references ${unusedReferences.join(", ")} but type-imports nothing from ${unusedReferences.length === 1 ? "it" : "them"}`,
  );

  const unusedInline = inlineDependencies.filter((name) => !importedProjects.has(name)).sort();
  assert.deepEqual(
    unusedInline,
    [],
    `${configNameFor(projectName)} lists ${unusedInline.join(", ")} as an inline dependency but type-imports nothing from ${unusedInline.length === 1 ? "it" : "them"}`,
  );
}

// ---------------------------------------------------------------------------
// The runtime-require ledger: dependencies tsc cannot see.
// ---------------------------------------------------------------------------

// `const X = require("./y")` compiles and runs fine, but tsc types X as `any` and
// never loads ./y, so NOTHING about that boundary is checked. server.ts had 39 of
// these; converting them to `import X = require(...)` surfaced 118 errors and three
// real bugs. These 10 are what is left, and they are the reason the cross-project
// reference graph is currently empty.
//
// Pinned so the set can only change deliberately:
//   * a NEW entry means a fresh unchecked boundary was introduced -- convert it to
//     `import X = require(...)` instead,
//   * a REMOVED entry means one was fixed -- delete it here, and check whether that
//     project now needs a reference (the assertion above will say so).
const KNOWN_RUNTIME_REQUIRES = [
  "src/atlas_item_definition.ts -> ./item_atlas_db",
  "src/server_item_database.ts -> ./atlas_item_definition",
];

const RUNTIME_REQUIRE_PATTERN = /require\(\s*"(\.\/[A-Za-z0-9_.-]+)"/gu;
const TYPE_IMPORT_LINE_PATTERN = /\bimport\s+[A-Za-z0-9_$]+\s*=\s*require\(/u;

/** @type {string[]} */
const runtimeRequires = [];
for (const sourceFile of sourceFiles) {
  const source = fs.readFileSync(path.join(repoRoot, sourceFile), "utf8");
  for (const line of source.split(/\r?\n/u)) {
    if (TYPE_IMPORT_LINE_PATTERN.test(line)) {
      continue;
    }
    for (const match of line.matchAll(RUNTIME_REQUIRE_PATTERN)) {
      runtimeRequires.push(`${sourceFile} -> ${match[1]}`);
    }
  }
}
runtimeRequires.sort();

assert.deepEqual(
  runtimeRequires,
  KNOWN_RUNTIME_REQUIRES,
  `the set of runtime-only requires changed.\n  found:\n    ${runtimeRequires.join("\n    ")}\n  pinned:\n    ${KNOWN_RUNTIME_REQUIRES.join("\n    ")}\n` +
    "  A runtime require is invisible to tsc: the imported value is `any` and the target\n" +
    "  module is never type-checked against its consumer. Prefer converting it to\n" +
    "  `import X = require(\"./y\")`. If you did convert one, remove it from the pin.",
);

// Exactly one project may skip references, and it must be server-entry.
const exempt = Object.entries(PROJECTS).filter(([, pin]) => pin.referencesExempt).map(([name]) => name);
assert.deepEqual(
  exempt,
  ["server-entry"],
  "only server-entry may be exempt from project references -- see the header note on why",
);

// ---------------------------------------------------------------------------
// No check script may pin a build command that package.json no longer uses.
// ---------------------------------------------------------------------------

// 26 of the check_*.js scripts assert the EXACT text of their project's build
// command, so changing one build script in package.json silently breaks a guard
// several minutes into check:security. That is how switching three projects to
// `tsc --build` broke check_postgres_contracts.js.
//
// This finds every such pin by pattern and compares it to the real value, so the
// mismatch fails here -- in the first second of the chain -- naming both sides.
const BUILD_COMMAND_PIN_PATTERN = /"(tsc --(?:project|build) tsconfig\.([A-Za-z0-9-]+)\.json && node scripts\/[A-Za-z0-9_]+\.js)"/gu;

const scriptsDirectory = path.join(repoRoot, "scripts");
/** @type {string[]} */
const pinMismatches = [];
let pinCount = 0;

for (const entry of fs.readdirSync(scriptsDirectory)) {
  if (!entry.endsWith(".js")) {
    continue;
  }
  const source = fs.readFileSync(path.join(scriptsDirectory, entry), "utf8");
  for (const match of source.matchAll(BUILD_COMMAND_PIN_PATTERN)) {
    const [, pinnedCommand, projectName] = match;
    if (!PROJECTS[projectName]) {
      continue;
    }
    pinCount += 1;
    const actual = packageJson.scripts?.[`build:${projectName}`];
    if (actual !== pinnedCommand) {
      pinMismatches.push(
        `scripts/${entry} pins build:${projectName} as\n    ${pinnedCommand}\n  but package.json says\n    ${actual}`,
      );
    }
  }
}

assert.deepEqual(
  pinMismatches,
  [],
  `check scripts pin build commands that no longer match package.json:\n  ${pinMismatches.join("\n  ")}`,
);

// ---------------------------------------------------------------------------
// The lint project, which must keep seeing the two largest files.
// ---------------------------------------------------------------------------

const lintProject = resolveTsconfig(path.join(repoRoot, "tsconfig.eslint.json"));
assert.deepEqual(
  lintProject.extendsChain,
  ["./tsconfig.json"],
  "tsconfig.eslint.json must extend ./tsconfig.json",
);
assert.ok(
  (lintProject.include || []).includes("src/**/*.ts"),
  "tsconfig.eslint.json must cover all of src/ -- the base excludes the two largest files",
);
// check:lint-positive-control runs a TYPE-AWARE rule on this file, which requires it
// to be part of a tsconfig program. Drop it here and that check fails to run at all.
assert.ok(
  (lintProject.include || []).includes("lint/positive_control.ts"),
  "tsconfig.eslint.json must include lint/positive_control.ts, or lint:positive-control cannot type-check it",
);
assert.deepEqual(
  lintProject.exclude,
  ["node_modules", ".tsbuild"],
  "tsconfig.eslint.json must not exclude any source file from type-aware linting",
);
const lintStrictness = effectiveStrictness(lintProject.compilerOptions);
for (const [option, value] of Object.entries(lintStrictness)) {
  assert.equal(value, true, `tsconfig.eslint.json resolves ${option} to ${value}`);
}

console.log(`[tsconfig-projects] ${Object.keys(PROJECTS).length} projects extend the base`);
console.log(`[tsconfig-projects] ${sourceFiles.length} src modules, each owned by exactly one project`);
console.log(
  `[tsconfig-projects] ${referencedProjects.size} composite projects, ` +
    `${Object.values(PROJECTS).reduce((total, pin) => total + pin.references.length, 0)} reference edges, ` +
    `${Object.values(PROJECTS).reduce((total, pin) => total + (pin.inlineDependencies || []).length, 0)} inline dependencies ` +
    "(type-level import graph fully covered)",
);
console.log(
  `[tsconfig-projects] ${runtimeRequires.length} runtime-only requires still invisible to tsc ` +
    "(see KNOWN_RUNTIME_REQUIRES)",
);
console.log(`[tsconfig-projects] ${pinCount} build-command pins in check scripts all match package.json`);
console.log("[tsconfig-projects] success");
