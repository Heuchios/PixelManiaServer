#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const ItemDb = require("../server_item_database");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REMOVED_ITEM_IDS = Object.freeze(["axe", "pickaxe", "shovel", "furnace"]);
const INVENTORY_FIELDS = Array.from(new Set([
  ...Object.values(ItemDb.CATEGORY_TO_FIELD || {}),
  "inventory",
  "seed_inventory",
  "tool_inventory",
  "back_inventory",
  "hat_inventory",
  "hair_inventory",
  "eyewear_inventory",
  "shirt_inventory",
  "pants_inventory",
  "shoes_inventory",
  "ride_inventory",
  "currency_inventory",
  "material_inventory",
  "lure_inventory",
  "fish_inventory",
]));

const args = process.argv.slice(2);
const apply = args.includes("--apply");

function getOption(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cleanId(value) {
  return cleanText(value).toLowerCase();
}

function resolveConfiguredPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

const DATA_FOLDER = resolveConfiguredPath(process.env.PIXELMANIA_DATA_DIR, ROOT);
const PLAYER_SAVE_FOLDER = resolveConfiguredPath(process.env.PLAYER_SAVE_FOLDER, path.join(DATA_FOLDER, "players"));
const WORLD_SAVE_FOLDER = resolveConfiguredPath(process.env.WORLD_SAVE_FOLDER, path.join(DATA_FOLDER, "worlds"));
const INTEGRITY_LOG_FOLDER = resolveConfiguredPath(process.env.INTEGRITY_LOG_FOLDER, path.join(DATA_FOLDER, "integrity_logs"));

const selectedItems = getOption("--items", "")
  .split(",")
  .map(cleanId)
  .filter(Boolean);
const removedItems = new Set(selectedItems.length > 0 ? selectedItems : DEFAULT_REMOVED_ITEM_IDS);
const userFilter = cleanId(getOption("--user", ""));
const worldFilter = cleanId(getOption("--world", ""));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = path.join(INTEGRITY_LOG_FOLDER, "legacy_removed_item_backups", stamp);

const report = {
  mode: apply ? "apply" : "dry-run",
  removed_items: Array.from(removedItems).sort(),
  paths: {
    players: PLAYER_SAVE_FOLDER,
    worlds: WORLD_SAVE_FOLDER,
    backup_root: apply ? backupRoot : "",
  },
  summary: {
    files_changed: 0,
    entries_removed: 0,
    references_replaced: 0,
  },
  files: [],
};

function listJsonFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder)
    .filter((file) => file.toLowerCase().endsWith(".json"))
    .map((file) => path.join(folder, file));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonWithBackup(filePath, data) {
  const relative = path.relative(ROOT, filePath);
  const backupPath = path.join(backupRoot, relative);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(filePath, backupPath);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function isRemovedItem(value) {
  return removedItems.has(cleanId(value));
}

function itemRef(entry) {
  if (!entry || typeof entry !== "object") return "";
  return cleanText(entry.item_id || entry.item_type || entry.id || entry.block_type || entry.type || entry.foreground_item_id);
}

function blockType(entry) {
  if (!entry || typeof entry !== "object") return "";
  return cleanText(entry.block_type || entry.item_id || entry.type || entry.foreground_item_id);
}

function addFileChange(fileChanges, action, detail) {
  fileChanges.push({ action, detail });
}

function removeInventoryKeys(bucket, fileChanges, owner, field) {
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return;
  for (const itemId of Object.keys(bucket)) {
    if (!isRemovedItem(itemId)) continue;
    delete bucket[itemId];
    report.summary.entries_removed += 1;
    addFileChange(fileChanges, "removed_inventory_item", { owner, field, item_id: itemId });
  }
}

function replaceRemovedValue(container, key, replacement, fileChanges, owner) {
  if (!container || typeof container !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(container, key)) return;
  if (!isRemovedItem(container[key])) return;
  container[key] = replacement;
  report.summary.references_replaced += 1;
  addFileChange(fileChanges, "replaced_item_reference", { owner, field: key, replacement });
}

function cleanHotbarArray(hotbar, fileChanges, owner, field) {
  if (!Array.isArray(hotbar)) return;
  for (let index = 0; index < hotbar.length; index += 1) {
    const slot = hotbar[index];
    if (typeof slot === "string") {
      if (isRemovedItem(slot)) {
        hotbar[index] = "punch";
        report.summary.references_replaced += 1;
        addFileChange(fileChanges, "replaced_hotbar_item", { owner, field, index, item_id: slot, replacement: "punch" });
      }
      continue;
    }
    if (!slot || typeof slot !== "object") continue;
    for (const key of ["item_id", "item_type", "id"]) {
      if (!isRemovedItem(slot[key])) continue;
      slot[key] = "punch";
      if (Object.prototype.hasOwnProperty.call(slot, "item_category")) slot.item_category = "tool";
      if (Object.prototype.hasOwnProperty.call(slot, "category")) slot.category = "tool";
      report.summary.references_replaced += 1;
      addFileChange(fileChanges, "replaced_hotbar_item", { owner, field, index, key, replacement: "punch" });
    }
  }
}

function cleanPlayerFile(filePath) {
  const data = readJson(filePath);
  const username = cleanId(data.username || data.name || path.basename(filePath, ".json"));
  if (userFilter && username !== userFilter) return;
  const playerData = data.player_data && typeof data.player_data === "object" ? data.player_data : data;
  const fileChanges = [];

  for (const field of INVENTORY_FIELDS) {
    removeInventoryKeys(playerData[field], fileChanges, username, field);
  }

  cleanHotbarArray(playerData.hotbar, fileChanges, username, "hotbar");
  cleanHotbarArray(playerData.hotbar_items, fileChanges, username, "hotbar_items");

  for (const field of ["selected_item", "selected_item_id", "selected_item_type", "primary_hotbar_tool"]) {
    replaceRemovedValue(playerData, field, "punch", fileChanges, username);
  }
  for (const field of [
    "equipped_tool",
    "equipped_tool_item",
    "tool",
    "hand",
    "equipped_hand",
  ]) {
    replaceRemovedValue(playerData, field, "", fileChanges, username);
  }

  if (fileChanges.length === 0) return;
  report.summary.files_changed += 1;
  report.files.push({ file: filePath, changes: fileChanges });
  if (apply) writeJsonWithBackup(filePath, data);
}

function filterArrayEntries(array, fileChanges, label, predicate) {
  if (!Array.isArray(array)) return array;
  const kept = [];
  for (const entry of array) {
    if (predicate(entry)) {
      report.summary.entries_removed += 1;
      addFileChange(fileChanges, "removed_world_entry", { label, item_id: itemRef(entry) || blockType(entry) });
      continue;
    }
    kept.push(entry);
  }
  return kept;
}

function cleanInteraction(interaction, fileChanges, worldName) {
  if (!interaction || typeof interaction !== "object") return false;
  const action = cleanId(interaction.action || "");
  if (action.includes("furnace") || isRemovedItem(interaction.station_id) || isRemovedItem(interaction.block_type)) {
    return true;
  }

  const listing = interaction.listing && typeof interaction.listing === "object" ? interaction.listing : null;
  if (listing && isRemovedItem(listing.item_id || listing.item_type)) {
    delete interaction.listing;
    for (const key of ["item_id", "item_type", "stock", "amount_per_sale", "price_wls"]) {
      delete interaction[key];
    }
    report.summary.entries_removed += 1;
    addFileChange(fileChanges, "cleared_removed_listing", { world: worldName, item_id: listing.item_id || listing.item_type || "" });
  }

  if (Array.isArray(interaction.slots)) {
    interaction.slots = filterArrayEntries(interaction.slots, fileChanges, "interaction.slots", (slot) => isRemovedItem(itemRef(slot)));
  }
  return false;
}

function cleanWorldFile(filePath) {
  const data = readJson(filePath);
  const worldName = cleanId(data.world_name || path.basename(filePath, ".json"));
  if (worldFilter && worldName !== worldFilter) return;
  const fileChanges = [];

  data.blocks = filterArrayEntries(data.blocks || [], fileChanges, "blocks", (entry) => isRemovedItem(blockType(entry)));
  data.background_blocks = filterArrayEntries(data.background_blocks || [], fileChanges, "background_blocks", (entry) => isRemovedItem(blockType(entry)));
  data.removed_foreground = filterArrayEntries(data.removed_foreground || [], fileChanges, "removed_foreground", (entry) => isRemovedItem(blockType(entry)));
  data.removed_background = filterArrayEntries(data.removed_background || [], fileChanges, "removed_background", (entry) => isRemovedItem(blockType(entry)));
  data.drops = filterArrayEntries(data.drops || [], fileChanges, "drops", (entry) => isRemovedItem(itemRef(entry)));
  data.seeds = filterArrayEntries(data.seeds || [], fileChanges, "seeds", (entry) => isRemovedItem(entry && (entry.seed_type || entry.item_id || entry.block_type)));
  data.interactions = filterArrayEntries(data.interactions || [], fileChanges, "interactions", (entry) => cleanInteraction(entry, fileChanges, worldName));

  if (fileChanges.length === 0) return;
  report.summary.files_changed += 1;
  report.files.push({ file: filePath, changes: fileChanges });
  if (apply) writeJsonWithBackup(filePath, data);
}

function main() {
  for (const filePath of listJsonFiles(PLAYER_SAVE_FOLDER)) {
    cleanPlayerFile(filePath);
  }
  for (const filePath of listJsonFiles(WORLD_SAVE_FOLDER)) {
    cleanWorldFile(filePath);
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`PixelMania removed legacy item cleanup (${report.mode})`);
  console.log(`Items: ${report.removed_items.join(", ")}`);
  console.log(`Files changed: ${report.summary.files_changed}`);
  console.log(`Entries removed: ${report.summary.entries_removed}`);
  console.log(`References replaced: ${report.summary.references_replaced}`);
  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write changes.");
  } else {
    console.log(`Backups: ${backupRoot}`);
  }
  for (const file of report.files.slice(0, 40)) {
    console.log(`- ${file.file} (${file.changes.length} change(s))`);
  }
  if (report.files.length > 40) {
    console.log(`... ${report.files.length - 40} more file(s)`);
  }
}

main();
