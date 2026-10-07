// Version 3 replaces the previous fish/lure lineup. Historical audit rows stay intact.
const catalog = require("./fishing_catalog.json");
export const VERSION = 3;
export const RETIRED_IDS: string[] = catalog.retired_ids;
// Bluegill keeps its name/ID, but its pre-rework holdings are removed once as requested.
export const INITIAL_REMOVAL_IDS = [...RETIRED_IDS, "bluegill"];

export function pruneHoldings(value: any, initial = false): boolean {
  if (!value || typeof value !== "object") return false;
  const retired = new Set(initial ? INITIAL_REMOVAL_IDS : RETIRED_IDS);
  let changed = false;
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      if (retired.has(key)) { delete node[key]; changed = true; }
    }
    // Container records retain their position/owner; only the retired contents go away.
    if (["item_id", "item_type", "fish_id"].some(key => retired.has(node[key]))) {
      for (const key of ["item_id", "item_type", "fish_id", "item_category", "category", "name", "texture"]) {
        if (key in node) node[key] = "";
      }
      for (const key of ["amount", "stock", "count", "weight", "weight_kg", "amount_per_sale"]) {
        if (key in node) node[key] = 0;
      }
      changed = true;
    }
    for (const key of ["selected_item_type", "selected_lure", "selected_lure_id", "lure_id"]) {
      if (retired.has(node[key])) { node[key] = key === "selected_item_type" ? "punch" : ""; changed = true; }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return changed;
}

export function migratePlayer(state: Record<string, any>): void {
  const initial = Number(state.fishing_catalog_version || 0) < VERSION;
  pruneHoldings(state, initial);
  state.fishing_catalog_version = VERSION;
  if (state.fishing_records && typeof state.fishing_records === "object") {
    state.fishing_records.catalog_version = VERSION;
    if (!state.fishing_records.rarest_catch?.fish_id) state.fishing_records.rarest_catch = {};
  }
}
