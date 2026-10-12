# Item names in gameplay messages

Prepared on 2026-10-12 for the pending production release; not deployed by this
change.

Display withdrawal previously inserted the stored ID directly into its text,
for example `Took blue_tang.`. Gameplay messages now use
`ItemDatabase.getItemDisplayName`, which resolves the catalog's display name
and legacy aliases, with a readable fallback for an unknown item. The reported
message is now `Took Blue Tang.`. Catalog names also apply to display deposits,
safe and donation storage, pickups/drops/trashing, shop purchases, crafting,
fishing, planting, trade validation, inventory failures, and item grants.

Only presentation strings change. Inventory IDs, quantities, persistence,
tracking, ledger metadata and transaction validation remain unchanged. Newly
added catalog items automatically use their configured display name. Technical
item IDs remain available in administrative tracking diagnostics.

Validation:

- The actual generated display-withdrawal handler was executed locally with
  isolated persistence: it returned `Took Blue Tang.`, preserved the
  `blue_tang` inventory delta and ledger identity, and released its action lock.
- All 701 catalog entries with a configured display name matched the shared
  lookup. Custom names and unknown-item fallback were checked.
- Existing item-data, inventory economy, transaction helper, trade, pickup,
  seed, machine-return and world-item checks passed. Isolated test fixtures
  now expose the new catalog lookup.
- Full `npm run check:security` passed, including the dependency audit and
  TypeScript/build checks. Log: `D:/Pixelmania/work/item-display-names-security.log`.

This is a server change; the existing client renders the corrected message
without a client rebuild. Include it in the pending combined release rather
than deploying the older backend candidate recorded for the original 1.2.25
build. The Android distribution decision and coordinated version minimums from
that release remain pending.
