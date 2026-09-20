// Fish inventory quantities are integer tenths of a kilogram, including on the wire.
// Rates are integer hundredths of a gem/kg; gems are rounded once per sale.
export const UNIT = "tenths_kg";
export const STACK_LIMIT = 20000;
export type Policy = { base: number; min: number; max: number; target: number; halfLife: number };
export type MarketRow = { item_id: string; supply: number; updated_ms: number; revision: number };
export type Quote = MarketRow & { price_cents: number; min_price_cents: number; max_price_cents: number; quoted_ms: number };

export function policy(definition: Record<string, any>): Policy {
  const base = Math.max(1, Math.round(Number(definition.fish_base_price_kg || definition.sell_value || 2) * 100));
  return {
    base,
    min: Math.max(1, Math.round(Number(definition.fish_min_price_kg || base / 200) * 100)),
    max: Math.max(base, Math.round(Number(definition.fish_max_price_kg || base / 50) * 100)),
    target: Math.max(1, Number(definition.fish_market_target_kg || 1000) * 10),
    halfLife: Math.max(60, Number(definition.fish_market_half_life_seconds || 3600)) * 1000,
  };
}

export function quote(row: MarketRow, settings: Policy, now = Date.now()): Quote {
  const supply = Math.max(0, Number(row.supply)) * Math.pow(0.5, Math.max(0, now - Number(row.updated_ms)) / settings.halfLife);
  const price = Math.round(settings.base * 2 / (1 + supply / settings.target));
  return { ...row, supply, quoted_ms: now, price_cents: Math.max(settings.min, Math.min(settings.max, price)),
    min_price_cents: settings.min, max_price_cents: settings.max };
}

export function saleValue(lines: Array<{ amount: number; price_cents: number }>): number {
  let total = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0 || !Number.isSafeInteger(line.price_cents) || line.price_cents <= 0) throw new Error("Invalid fish sale");
    total += line.amount * line.price_cents;
  }
  if (!Number.isSafeInteger(total)) throw new Error("Fish sale exceeds safe value");
  return Math.ceil(total / 1000);
}

export function catchAmount(random: () => number = Math.random): number {
  // Cubic distribution makes heavy catches less frequent, with inclusive 0.1–150 kg bounds.
  return Math.min(1500, 1 + Math.floor(Math.pow(Math.max(0, Math.min(1, random())), 3) * 1500));
}

export function kgToUnits(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const units = Math.round(value * 10);
  return units > 0 && units <= STACK_LIMIT && Math.abs(value * 10 - units) < 1e-7 ? units : 0;
}

export function migratePlayer(state: Record<string, any>): Record<string, any> {
  if (state.fish_inventory_unit === UNIT) return state;
  const inventory = state.fish_inventory || {};
  for (const id of Object.keys(inventory)) {
    const count = Number(inventory[id]);
    inventory[id] = Number.isFinite(count) ? Math.max(0, Math.round(count * 10)) : 0;
  }
  state.fish_inventory = inventory;
  state.fish_inventory_unit = UNIT;
  return state;
}

// Current world containers store the same item records as drops and vending listings.
// Historical audit/snapshot records are deliberately left in their original units.
export function migrateWorldHoldings(value: any, isFish: (id: string) => boolean): boolean {
  if (!value || typeof value !== "object") return false;
  let changed = false;
  if (!Array.isArray(value)) {
    const id = String(value.item_id || value.item_type || "");
    if (isFish(id) && value.inventory_unit !== UNIT) {
      for (const key of ["amount", "stock", "amount_per_sale"]) {
        if (Number.isFinite(Number(value[key])) && Number(value[key]) > 0) {
          value[key] = Math.round(Number(value[key]) * 10);
          changed = true;
        }
      }
      if (changed) value.inventory_unit = UNIT;
    }
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") changed = migrateWorldHoldings(child, isFish) || changed;
  }
  return changed;
}
