// PixelManiaServer - type-aware lint, deliberately minimal.
//
// Scope: two rules, both of which need type information and neither of which
// TypeScript itself can enforce.
//
//   no-floating-promises  A promise that is never awaited, returned, or .catch()ed.
//                         On a server-authoritative game this is how a saveWorldState
//                         or a broadcast silently drops work with no error anywhere.
//   await-thenable        `await` on a non-promise (usually a forgotten call).
//
// No style rules, no naming conventions, no preset. `tseslint.configs.base` supplies
// the parser and plugin WITHOUT enabling any recommended set, so the only findings
// are the two above. Adding more rules later is a deliberate act, not a default.
//
// WHY THIS FILE LIVES IN lint/ RATHER THAN THE REPO ROOT
// -----------------------------------------------------
// The server builds with typescript@7, which removed the classic compiler API that
// typescript-eslint drives (`require("typescript").createProgram` -> undefined).
// typescript-eslint refuses to load against it outright: "does not support TS 7.0".
// TypeScript 6.0 is the last release carrying that API, and it satisfies
// typescript-eslint's peer range (>=4.8.4 <6.1.0).
//
// A root-level npm override could not fix this -- peer dependencies hoist to the
// root, so the nested copy was never created. Instead lint/ is its own npm project:
// module resolution finds lint/node_modules/typescript@6 for the linter, while the
// server's tsc keeps using typescript@7.0.2 from the parent node_modules. Neither
// toolchain can disturb the other.
//
// Two consequences of living here:
//   * `import tseslint` resolves relative to THIS file -> lint/node_modules. Correct.
//   * ESLint is invoked from the repo root with `--config lint/eslint.config.mjs`,
//     which makes the base path the cwd (repo root), so the `files` patterns below
//     are repo-relative rather than lint-relative. That is documented ESLint
//     behaviour for --config, and it is why "src/**/*.ts" works from here.
//
// Type info comes from ../tsconfig.eslint.json, NOT ../tsconfig.json -- the root
// config EXCLUDES src/server.ts and src/postgres_store.ts, which would silently
// leave the two largest files unlinted.

import path from "node:path";
import tseslint from "typescript-eslint";

const repoRoot = path.resolve(import.meta.dirname, "..");

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "lint/node_modules/**",
      ".tsbuild/**",
      "staging/**",
      "ops_dashboard_public/**",
      "worlds/**",
      "players/**",
      "world_snapshots/**",
      "integrity_logs/**",
      // Generated CommonJS output lives at the repo root next to its source.
      // src/*.ts is the source of truth; linting the emit would double every finding.
      "*.js",
      "scripts/**",
    ],
  },
  {
    files: ["src/**/*.ts", "lint/positive_control.ts"],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: repoRoot,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          // A bare `void somePromise()` is an explicit "I know, and I mean it".
          ignoreVoid: true,
          ignoreIIFE: false,
        },
      ],
      "@typescript-eslint/await-thenable": "error",
    },
  },
);
