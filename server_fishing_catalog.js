"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INITIAL_REMOVAL_IDS = exports.RETIRED_IDS = exports.VERSION = void 0;
exports.pruneHoldings = pruneHoldings;
exports.migratePlayer = migratePlayer;
// Version 3 replaces the previous fish/lure lineup. Historical audit rows stay intact.
const catalog = require("./fishing_catalog.json");
exports.VERSION = 3;
exports.RETIRED_IDS = catalog.retired_ids;
// Bluegill keeps its name/ID, but its pre-rework holdings are removed once as requested.
exports.INITIAL_REMOVAL_IDS = [...exports.RETIRED_IDS, "bluegill"];
function pruneHoldings(value, initial = false) {
    if (!value || typeof value !== "object")
        return false;
    const retired = new Set(initial ? exports.INITIAL_REMOVAL_IDS : exports.RETIRED_IDS);
    let changed = false;
    const visit = (node) => {
        if (!node || typeof node !== "object")
            return;
        for (const key of Object.keys(node)) {
            if (retired.has(key)) {
                delete node[key];
                changed = true;
            }
        }
        // Container records retain their position/owner; only the retired contents go away.
        if (["item_id", "item_type", "fish_id"].some(key => retired.has(node[key]))) {
            for (const key of ["item_id", "item_type", "fish_id", "item_category", "category", "name", "texture"]) {
                if (key in node)
                    node[key] = "";
            }
            for (const key of ["amount", "stock", "count", "weight", "weight_kg", "amount_per_sale"]) {
                if (key in node)
                    node[key] = 0;
            }
            changed = true;
        }
        for (const key of ["selected_item_type", "selected_lure", "selected_lure_id", "lure_id"]) {
            if (retired.has(node[key])) {
                node[key] = key === "selected_item_type" ? "punch" : "";
                changed = true;
            }
        }
        for (const child of Object.values(node))
            visit(child);
    };
    visit(value);
    return changed;
}
function migratePlayer(state) {
    const initial = Number(state.fishing_catalog_version || 0) < exports.VERSION;
    pruneHoldings(state, initial);
    state.fishing_catalog_version = exports.VERSION;
    if (state.fishing_records && typeof state.fishing_records === "object") {
        state.fishing_records.catalog_version = exports.VERSION;
        if (!state.fishing_records.rarest_catch?.fish_id)
            state.fishing_records.rarest_catch = {};
    }
}
