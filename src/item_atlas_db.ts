"use strict";

import fs = require("node:fs");
import path = require("node:path");

type AtlasRawItem = Record<string, unknown> & {
  id?: unknown;
  item_key?: unknown;
  key?: unknown;
  layer?: unknown;
  source_id?: unknown;
  alternative_tile?: unknown;
};

type AtlasItem = Readonly<AtlasRawItem & {
  id: number;
  item_key: string;
  layer: "foreground" | "background";
  source_id: number;
  alternative_tile: number;
}>;

const ATLAS_ITEMS_PATHS: string[] = [
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
let itemsById = new Map<number, AtlasItem>();
let idsByKey = new Map<string, number>();

function cleanItemKey(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function loadAtlasItems(): void {
  if (loaded) return;
  loaded = true;
  itemsById = new Map<number, AtlasItem>();
  idsByKey = new Map<string, number>();

  let parsed: { items?: unknown[] } | null = null;
  let loadedPath = "";
  try {
    for (const candidatePath of ATLAS_ITEMS_PATHS) {
      if (!fs.existsSync(candidatePath)) continue;
      parsed = JSON.parse(fs.readFileSync(candidatePath, "utf8")) as { items?: unknown[] };
      loadedPath = candidatePath;
      break;
    }
    if (!parsed) {
      throw new Error(`atlas item database not found in: ${ATLAS_ITEMS_PATHS.join(", ")}`);
    }
  } catch (error) {
    console.warn("[item_atlas_db] Could not load atlas item database.", {
      paths: ATLAS_ITEMS_PATHS,
      reason: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
    const rawRecord = rawItem as AtlasRawItem;
    const id = Math.trunc(Number(rawRecord.id) || 0);
    if (id <= 0) continue;
    const itemKey = cleanItemKey(rawRecord.item_key || rawRecord.key || "");
    const item = Object.freeze({
      ...rawRecord,
      id,
      item_key: itemKey,
      layer: cleanItemKey(rawRecord.layer || "foreground") === "background" ? "background" as const : "foreground" as const,
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

function getItem(itemId: unknown): AtlasItem | null {
  loadAtlasItems();
  const id = Math.trunc(Number(itemId) || 0);
  return itemsById.get(id) || null;
}

function hasItem(itemId: unknown): boolean {
  return Boolean(getItem(itemId));
}

function getItemKey(itemId: unknown): string {
  const item = getItem(itemId);
  return item ? cleanItemKey(item.item_key || "") : "";
}

function getItemIdForKey(itemKey: unknown): number {
  loadAtlasItems();
  return Number(idsByKey.get(cleanItemKey(itemKey)) || 0);
}

function resolveItemKey(value: unknown): string {
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

export = ItemAtlasDB;
