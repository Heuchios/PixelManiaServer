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
//     cannot land with no typecheck and no build script.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { STRICT_FAMILY_OPTIONS, effectiveStrictness, resolveTsconfig } = require("./tsconfig_effective");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

// Options a per-module project is allowed to set locally. Anything else belongs
// in ./tsconfig.json so it applies everywhere.
const ALWAYS_LOCAL_OPTIONS = ["noEmit", "outDir", "rootDir"];

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
 */

/** @type {Record<string, ProjectPin>} */
const PROJECTS = {
  "drop-contracts": {
    include: ["src/server_drop_contracts.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "inventory-contracts": {
    include: ["src/server_inventory_contracts.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "item-data": {
    include: ["src/atlas_item_definition.ts","src/item_atlas_db.ts","src/server_item_database.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "packet-contracts": {
    include: ["src/server_packet_contracts.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "postgres-contracts": {
    include: ["src/postgres_store_contracts.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "postgres-store": {
    include: ["src/postgres_store.ts"],
    outDir: ".tsbuild",
    localOptions: {"allowJs":false,"noFallthroughCasesInSwitch":true,"noImplicitReturns":true},
  },
  "redis-store": {
    include: ["src/redis_store.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-account-auth-routes": {
    include: ["src/server_account_auth_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-account-session-helpers": {
    include: ["src/server_account_session_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-admin-lookup-routes": {
    include: ["src/server_admin_lookup_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-bot-rate-limit-helpers": {
    include: ["src/server_bot_rate_limit_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-crash-details": {
    include: ["src/server_crash_details.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-entry": {
    include: ["src/server.ts"],
    outDir: ".tsbuild/server-entry",
    localOptions: {"noEmitOnError":true,"moduleDetection":"force"},
  },
  "server-env-config": {
    include: ["src/server_env_config.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-friend-routes": {
    include: ["src/server_friend_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-helpers": {
    include: ["src/server_identity_helpers.ts","src/server_text_helpers.ts","src/server_version_helpers.ts","src/server_account_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-inventory-economy-routes": {
    include: ["src/server_inventory_economy_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-inventory-transaction-helpers": {
    include: ["src/server_inventory_transaction_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-message-router-helpers": {
    include: ["src/server_message_router_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-persistence-helpers": {
    include: ["src/server_persistence_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-phase11a-runtime": {
    include: ["src/server_phase11a_runtime.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-phase11b-lifecycle": {
    include: ["src/server_phase11b_lifecycle.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-phase11c-trusted-movement": {
    include: ["src/server_phase11c_trusted_movement.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-phase11d-standard-movement": {
    include: ["src/server_phase11d_standard_movement.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-phase6-helpers": {
    include: ["src/server_phase6_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-phase7-dispatcher": {
    include: ["src/server_phase7_dispatcher.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-phase8-final-routes": {
    include: ["src/server_phase8_final_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-phase8-player-session-routes": {
    include: ["src/server_phase8_player_session_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-phase8-world-action-routes": {
    include: ["src/server_phase8_world_action_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-phase9-remaining-routes": {
    include: ["src/server_phase9_remaining_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-player-state-helpers": {
    include: ["src/server_player_state_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-punishment-helpers": {
    include: ["src/server_punishment_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-runtime-stats": {
    include: ["src/server_runtime_stats.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-socket-delivery-helpers": {
    include: ["src/server_socket_delivery_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-trade-routes": {
    include: ["src/server_trade_routes.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-world-interaction-payload-helpers": {
    include: ["src/server_world_interaction_payload_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
  },
  "server-world-state-helpers": {
    include: ["src/server_world_state_helpers.ts"],
    outDir: ".tsbuild",
    localOptions: {},
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
console.log("[tsconfig-projects] success");
