# Kilogram fishing and the global Fish Monger

Fish inventory and inventory transaction quantities use integer **tenths of a kilogram** (`fish_inventory_unit: "tenths_kg"`). Thus 57 units means 5.7 kg and the stack limit is 20,000 units (2,000 kg). Fish Monger sale requests explicitly send `weight_kg`; other inventory transfers retain integer inventory units. Do not interpret raw fish inventory quantities as kilograms or individual fish.

The server rolls each catch in 0.1 kg increments, from 0.1 to 150 kg inclusive. A cubic distribution makes large catches less common. A catch that cannot fit is rejected without partially adding it. Existing inventory counts migrate once at **one old fish = 1 kg**, with item-transaction evidence, a transaction-ledger entry and refreshed inventory hashes. Current PostgreSQL world containers, vending stock/bundle sizes and active drops also convert; world changes are journaled. Local player saves use the same version marker to avoid converting twice.

Each fish's settings are in `item_data_overrides.json` and the matching client `Data/items/item_data_overrides.json`:

- `fish_base_price_kg`, `fish_min_price_kg`, `fish_max_price_kg`
- `fish_market_target_kg` (default 1,000 kg)
- `fish_market_half_life_seconds` (default one hour)

Fish prices are balanced for weight, with a **250-gem ceiling for any single 150 kg catch** at the highest market rate. Pond Fish starts at **0.10 gems/kg**, bounded at **0.05–0.20 gems/kg** (maximum 30 gems for 150 kg). Kraken is the most valuable catch: **0.83 gems/kg**, bounded at **0.42–1.66 gems/kg** (maximum 249 gems for 150 kg). Rates use two decimal places, so 1.66 is the highest rate that stays below the ceiling. Other species fall between these values; their bounds are approximately 50% and 200% of their base rate, rounded to hundredths. The ceiling applies to one maximum-weight catch; selling multiple catches together can pay more.

The market starts at the base rate. Each successful sale adds its weight to recent supply; that supply decays with the configured half-life. The rate is `2 × base / (1 + recent_supply / target)`, clamped to the configured range and represented in hundredths of a gem/kg. High supply lowers the rate; lower supply raises it. Only committed sales count. Merely requesting prices, rejected requests, and failed transactions have no supply effect.

All worlds and server instances use the same PostgreSQL `fish_market` rows. Row locks and revisions prevent simultaneous sellers from overwriting supply. Supply, inventory removal, gem payment, sale receipt, and economy ledgers commit in the same database transaction. Replayed sale request IDs cannot charge the player twice. PostgreSQL-unavailable production servers reject sales. The in-memory market is only a local development fallback.

Payout is `ceil(sum(weight_units × price_cents) / 1000)`. Round once for the entire sale, including Sell All. For example, 5.7 kg at 2 gems/kg pays 12 gems. Always rounding up allows small separate sales to earn more than selling their combined weight; this deliberately follows the requested rounding rule.

The client fetches prices when opening the Monger and every 15 seconds while open. Displayed values are estimates. A sale locks the shared market rows, calculates the current rate, then commits that exact payout and supply together with inventory and ledgers. Changed quotes and competing sellers do not reject the sale; queued sellers receive the rate after earlier sales. Refreshing preserves the selected sale weight. Rate tooltips show the configured range.

Each sized species now uses its existing `_large` item ID and artwork, with a display name such as **Pond Fish**. Small and medium IDs (and the old generic Pond Fish ID) remain hidden migration aliases and are excluded from catches and the collection. Migration version 2 combines their inventory weights, renames stored world holdings/drops and combines market supply. It records inventory transfers and updates hashes atomically. Combined holdings above 2,000 kg abort the migration rather than lose fish; resolve such holdings before production rollout. Local collection records combine catch counts and preserve the largest weight and best value.

Catch responses include exact kilogram weight, integer reward units and a current market quote. The catch card preserves decimal rates and can recover weight from the authoritative reward/delta if the explicit weight field is missing. Price requests time out and retry, and rejected or missing quotes display an unavailable status instead of loading forever.

## Release and verification

This is a coordinated client/server change. Stop old backend writers before the first PostgreSQL migration and require the updated client when publishing it. Do not run old count-based clients or server processes against the converted inventory. Back up PostgreSQL first; rolling back the server alone does not reverse unit conversion. Historical ledger quantities retain their original units; the migration entries mark the transition.

Run `npm run check:fish-market`, the existing server validation/anti-dupe/ledger checks, and the client `tests/fish_kilograms_test.gd` and `tests/run_fishing_tests.ps1`. The Node test executes the actual sale handler with controlled inventory and exercises pricing, exact rounding, bounds, invalid requests, insufficient inventory, full gem balances, and competing market revisions. A real PostgreSQL staging run is required before release to verify schema migration, cross-process concurrency, rollback and restart persistence.
