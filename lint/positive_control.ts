// POSITIVE CONTROL -- NOT PRODUCTION CODE.
//
// Never imported, never built by any tsconfig.<module>.json, never deployed.
// Its only job is to FAIL lint.
//
// Why this exists: this repo builds with typescript@7, which does not expose the
// classic compiler API (`require("typescript").createProgram` is undefined), so
// typescript-eslint runs against its own nested typescript@5.8 instead. If that
// resolution ever breaks, `no-floating-promises` does not error -- it silently
// reports nothing and exits 0. A clean lint run would then be indistinguishable
// from a working one.
//
// So: if `npm run lint` does NOT report no-floating-promises on this file, the
// linter is inert and every other clean result is meaningless. The setup script
// asserts this file is flagged before it trusts any finding count.

async function deliberatelyNeverAwaited(): Promise<void> {
  return;
}

export function positiveControl(): void {
  // This line MUST be reported as @typescript-eslint/no-floating-promises.
  deliberatelyNeverAwaited();
}
