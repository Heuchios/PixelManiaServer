# World taxes

`WORLD_TAX_ENABLED=true` activates account-wide weekly taxes. Requires world name
claims on every shard. Defaults off; staging activation is separate from deployment.
Once activated, the flag must stay on so ownership changes cannot escape accounting.
Do not roll back to a pre-tax binary after activation without a billing migration.

## Rules

- Three worlds per account are free. Each additional world costs 500 gems weekly.
- Each account's week uses its highest number of extra owned worlds during that
  week. A transfer can lower the following week's bill, but cannot erase the
  current week's charge. Each account receives its own allowance.
- Existing owners start a fresh week at activation. New owners start when first
  tracked. No retroactive charges. First bill is due seven days later.
- Bills receive seven days of grace after becoming due. Once any bill is overdue,
  new ownership (including transfers), name reservations and permanent name claims
  are blocked until overdue bills are paid. Current gameplay remains available.
- Manual PAY in Profile > TAXES pays all due bills with confirmation. No automatic
  gem deductions, interest, late fees, world deletion or loss of permanent names.
- All owned worlds count, including generated names and unpaid name reservations.
  Removing an unpaid world's physical lock releases its durable owner and lowers
  that account's current count. The week's peak and accrued bills remain intact.
  Paid names retain ownership after lock removal; renaming never changes ownership.
  Shared access/admin rights are not ownership. System worlds are excluded.
- Separate accounts can each use an allowance; this does not prevent alt-account
  hoarding. A transfer within one week can result in charges to both owners if
  both exceed their own allowances.

## Persistence and concurrency

`server_world_taxes.ts` maintains PostgreSQL activation, account periods and peak
counts, weekly bills and unique account/request payment receipts. Account-wide tax
coordination uses a PostgreSQL transaction advisory lock. The world ownership mirror
settles the prior count before changing ownership and updates both accounts after
the change in the same transaction. Overdue acquisition checks are in that mirror,
not merely in the UI. Name reserve and claim paths also check overdue tax.

World-key trades also check the recipient inside the inventory transaction. A
durable, single-use transfer permit commits with the trade and is consumed by
the ownership mirror. This honors an already paid purchase if a grace deadline
passes between trade completion and the world save; an overdue buyer cannot
create a new permit. Unrelated ownership changes cannot consume that permit.

Bills materialize lazily on status, payment or ownership/name mutations, using
PostgreSQL time. Offline accounts accrue every complete week using the persisted
ownership count; checking twice does not create duplicate bills. There is no timer
whose restart resets charges. The UI shows UTC due/grace dates and recent payments.

Payment uses the existing authoritative inventory transaction, gem ledger and
transaction ledger. Amount, account and debit are validated again inside that
transaction. Bill clearance and a durable request receipt commit with the debit.
Repeated or old request IDs cannot pay another bill later. Failed requests use
the existing audited inventory rejection path. Debts stay with the liable account.

## Verification / staging rollout

- `node scripts/test_world_tax_postgres.js` uses isolated PGlite; set
  `WORLD_NAME_TEST_PGLITE_PATH` to its installed package path if needed.
- It covers activation/restart, allowance, peak counts, transfers, lock removal,
  overdue ownership and reservation guards, offline accrual, insufficient funds,
  forged prices, atomic rollback, concurrent payment, replay and both ledgers.
- Run the same suite against real PostgreSQL in a disposable staging schema to
  exercise transaction locking. Never modify player bills to simulate dates.
- Client: `tests/world_tax_panel_test.gd`, `tests/player_profile_scene_test.gd`,
  `tests/world_name_request_test.gd`. Render at desktop and mobile sizes.
- Run the full security gate, deploy the matching client/backend, back up staging,
  then enable the flag and restart staging. Verify activation counts, zero initial
  debt, next due dates and public health before announcing availability.

Production activation and multi-shard rollout are separate work, not authorized
by the staging implementation. Back up before activation; all shards must switch
together to prevent old code accepting ownership changes without tax accounting.
