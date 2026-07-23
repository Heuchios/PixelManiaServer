// Generated from src/item_atlas_db.ts. Do not edit by hand.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ATLAS_ITEMS_PATHS = [
    process.env.PIXELMANIA_ATLAS_ITEMS_PATH || "",
    process.env.PIXELMANIA_CLIENT_DIR
        ? path.join(process.env.PIXELMANIA_CLIENT_DIR, "Data", "items", "atlas_items.json")
        : "",
    path.join(__dirname, "_client", "Data", "items", "atlas_items.json"),
    path.join(__dirname, "Data", "items", "atlas_items.json"),
    path.join(__dirname, "..", "Data", "items", "atlas_items.json"),
    path.join(__dirname, "..", "pixel-mania", "Data", "items", "atlas_items.json"),
].filter((candidatePath) => candidatePath !== "");
let loaded = false;
let itemsById = new Map();
let idsByKey = new Map();
function cleanItemKey(value) {
    return String(value || "").trim().toLowerCase();
}
function loadAtlasItems() {
    if (loaded)
        return;
    loaded = true;
    itemsById = new Map();
    idsByKey = new Map();
    let parsed = null;
    let loadedPath = "";
    try {
        for (const candidatePath of ATLAS_ITEMS_PATHS) {
            if (!fs.existsSync(candidatePath))
                continue;
            parsed = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
            loadedPath = candidatePath;
            break;
        }
        if (!parsed) {
            throw new Error(`atlas item database not found in: ${ATLAS_ITEMS_PATHS.join(", ")}`);
        }
    }
    catch (error) {
        console.warn("[item_atlas_db] Could not load atlas item database.", {
            paths: ATLAS_ITEMS_PATHS,
            reason: error instanceof Error ? error.message : String(error),
        });
        return;
    }
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const rawItem of items) {
        if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem))
            continue;
        const rawRecord = rawItem;
        const id = Math.trunc(Number(rawRecord.id) || 0);
        if (id <= 0)
            continue;
        const itemKey = cleanItemKey(rawRecord.item_key || rawRecord.key || "");
        const item = Object.freeze({
            ...rawRecord,
            id,
            item_key: itemKey,
            layer: cleanItemKey(rawRecord.layer || "foreground") === "background" ? "background" : "foreground",
            source_id: Math.trunc(Number(rawRecord.source_id) || 0),
            alternative_tile: Math.trunc(Number(rawRecord.alternative_tile) || 0),
        });
        itemsById.set(id, item);
        if (itemKey !== "") {
            idsByKey.set(itemKey, id);
        }
    }
    if (loadedPath !== "") {
        console.log("[item_atlas_db] Loaded atlas item database.", { path: loadedPath, items: itemsById.size });
    }
}
function getItem(itemId) {
    loadAtlasItems();
    const id = Math.trunc(Number(itemId) || 0);
    return itemsById.get(id) || null;
}
function hasItem(itemId) {
    return Boolean(getItem(itemId));
}
function getItemKey(itemId) {
    const item = getItem(itemId);
    return item ? cleanItemKey(item.item_key || "") : "";
}
function getItemIdForKey(itemKey) {
    loadAtlasItems();
    return Number(idsByKey.get(cleanItemKey(itemKey)) || 0);
}
function resolveItemKey(value) {
    const text = String(value || "").trim();
    if (text !== "" && /^-?\d+$/.test(text)) {
        return getItemKey(Number(text));
    }
    return cleanItemKey(text);
}
const ItemAtlasDB = {
    getItem,
    getItemIdForKey,
    getItemKey,
    hasItem,
    resolveItemKey,
};
module.exports = ItemAtlasDB;
