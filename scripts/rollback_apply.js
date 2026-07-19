"use strict";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PostgresStore = require("../postgres_store");
const ItemDatabase = require("../server_item_database");

const ROOT = path.resolve(__dirname, "..");

try {
  require("dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
} catch (_) {
  // dotenv is optional for this tool; production env vars are enough.
}

const CATEGORY_FIELD = new Map([
  ["block", "inventory"],
  ["seed", "seed_inventory"],
  ["tool", "tool_inventory"],
  ["back", "back_inventory"],
  ["hat", "hat_inventory"],
  ["hair", "hair_inventory"],
  ["eyewear", "eyewear_inventory"],
  ["shirt", "shirt_inventory"],
  ["pants", "pants_inventory"],
  ["shoes", "shoes_inventory"],
  ["ride", "ride_inventory"],
  ["currency", "currency_inventory"],
  ["material", "material_inventory"],
  ["lure", "lure_inventory"],
  ["fish", "fish_inventory"],
]);

const TRACKED_CATEGORIES = new Set(["tool", "back", "hat", "hair", "eyewear", "shirt", "pants", "shoes", "ride"]);
const DEFAULT_STACK_LIMIT = ItemDatabase.DEFAULT_STACK_LIMIT || 400;
const MAX_STACK_LIMIT = ItemDatabase.GEM_CURRENCY_STACK_LIMIT || 100000000000;
const args = process.argv.slice(2);
const mode = cleanText(args[0] || "help").toLowerCase();
const WORLD_JOURNAL_SAFE_SOURCE_TYPES = ["world_interaction_update", "world_block_update", "world_block_break", "world_seed_update", "world_item_drop_create", "world_item_drop_update", "world_item_drop_pickup", "drop_inventory_item", "safe_transaction", "safe_break_return", "seed_place", "vending", "door_enter", "door_reciprocal_link", "server_event", "world_event", "world_lock", "entrance_gate_move", "world_interaction", "world_object_change", "duck_feed", "duck_harvest", "duck_drop", "duck_decay"];

function usage(exitCode = 0) {
  console.log([
    "PixelMania rollback apply tool",
    "",
    "Usage:",
    "  npm run rollback:apply -- player --user uso --since 2026-06-07T00:00:00Z --reason \"dupe correction\"",
    "  npm run rollback:apply -- player --user uso --since 2026-06-07T00:00:00Z --reason \"dupe correction\" --apply",
    "  npm run rollback:apply -- world --world START --latest --reason \"restore before grief\" --apply",
    "  npm run rollback:apply -- world --world START --at 2026-06-07T00:00:00Z --reason \"restore exact time\" --apply",
    "  npm run rollback:apply -- world --world START --at \"2026-06-07 00:00:00 UTC\" --safe-only --reason \"skip unsafe actions\" --apply",
    "  npm run rollback:apply -- world --world START --snapshot-version 12 --reason \"restore checkpoint\" --apply",
    "  npm run rollback:apply -- item --item-instance PM-ITEM-ABC123 --action retire --reason \"duplicate copy\" --apply",
    "  npm run rollback:apply -- item --item-instance PM-ITEM-ABC123 --action transfer --target uso --reason \"restore owner\" --apply",
    "  npm run rollback:apply -- transaction --ledger-id 123 --reason \"bad admin give\" --apply",
    "  npm run rollback:apply -- transaction --transaction-id 00000000-0000-0000-0000-000000000000 --reason \"bad trade\" --apply",
    "",
    "Modes:",
    "  player       Reverses inventory/gem deltas after --since for one player.",
    "  world        Restores one world from a PostgreSQL/local/Spaces snapshot, optionally replayed to --at.",
    "  item         Freezes, retires, transfers, flags, or unfreezes one PM-ITEM row.",
    "  transaction  Reverses one transaction_ledger row or one transaction_id group.",
    "",
    "Safety:",
    "  Dry-run is the default. Use --apply for real changes.",
    "  --apply requires a non-empty --reason.",
    "  Rare tracked items require exact PM-ITEM rows; missing exact rows block apply.",
    "  Original ledger rows are marked status=reversed with rollback metadata.",
    "  --safe-only (world mode): replay only known-safe journal actions when using --at.",
  ].join("\n"));
  process.exit(exitCode);
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanKey(value) {
  return cleanText(value).replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 120);
}

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeJson(value) {
  const seen = new WeakSet();
  try {
    return JSON.parse(JSON.stringify(value ?? {}, (_key, item) => {
      if (typeof item === "bigint") return item.toString();
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    }));
  } catch (_) {
    return {};
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(cleanText(value));
}

function hasFlag(name) {
  return args.includes(name);
}

function getOption(name, fallback = "") {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function getOptionValues(name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return [];
  const values = [];
  for (let i = index + 1; i < args.length; i += 1) {
    const token = String(args[i] ?? "");
    if (i > index + 1 && token.startsWith("--")) break;
    values.push(token);
  }
  return values;
}

function normalizeTimestampValue(value, name = "timestamp", required = false) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new Error(`${name} is required.`);
    return null;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) throw new Error(`${name} must be an ISO-like timestamp.`);
    return value.toISOString();
  }

  const raw = cleanText(value);
  if (raw === "") {
    if (required) throw new Error(`${name} is required.`);
    return null;
  }
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) throw new Error(`${name} must be an ISO-like timestamp.`);
  return new Date(time).toISOString();
}

function parseTimeOption(name, required = false) {
  const raw = cleanText(getOptionValues(name).join(" "));
  return normalizeTimestampValue(raw, name, required);
}

function newRollbackId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${crypto.randomBytes(12).toString("hex")}`;
}

function resolveConfiguredPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function getStackLimit(itemType, fallback = DEFAULT_STACK_LIMIT) {
  const cleanItemType = cleanKey(itemType);
  const fallbackLimit = Math.max(1, toInt(fallback, DEFAULT_STACK_LIMIT));
  if (cleanItemType && typeof ItemDatabase.hasItem === "function" && ItemDatabase.hasItem(cleanItemType)) {
    return Math.min(MAX_STACK_LIMIT, Math.max(1, toInt(ItemDatabase.getStackLimit(cleanItemType), fallbackLimit)));
  }
  return Math.min(MAX_STACK_LIMIT, fallbackLimit);
}

function resolveCategory(itemType, itemCategory = "") {
  const cleanItemType = cleanKey(itemType);
  if (cleanItemType && typeof ItemDatabase.resolveItemCategory === "function") {
    const resolved = cleanKey(ItemDatabase.resolveItemCategory(cleanItemType, itemCategory)).toLowerCase();
    if (resolved) return resolved;
  }
  return cleanKey(itemCategory || "block").toLowerCase() || "block";
}

function isTrackedItem(itemType, itemCategory = "") {
  const cleanItemType = cleanKey(itemType);
  if (!cleanItemType) return false;
  const category = resolveCategory(cleanItemType, itemCategory);
  const definition = typeof ItemDatabase.getItemDefinition === "function"
    ? ItemDatabase.getItemDefinition(cleanItemType)
    : null;
  if (definition && definition.instance_tracked === false) return false;
  if (definition && (definition.instance_tracked === true || definition.equipable || cleanText(definition.equipment_slot) !== "")) {
    return true;
  }
  return TRACKED_CATEGORIES.has(category) || getStackLimit(cleanItemType) <= 1;
}

function setPlayerStateItem(playerState, itemType, itemCategory, amount) {
  const category = resolveCategory(itemType, itemCategory);
  const field = CATEGORY_FIELD.get(category) || "inventory";
  const state = toObject(playerState);
  const bucket = toObject(state[field]);
  const cleanItemType = cleanKey(itemType);
  const cleanAmount = Math.max(0, toInt(amount, 0));
  if (cleanItemType === "") return;
  if (cleanAmount > 0) {
    bucket[cleanItemType] = cleanAmount;
  } else {
    delete bucket[cleanItemType];
  }
  state[field] = bucket;
}

function extractWorldState(snapshot) {
  const payload = toObject(snapshot);
  const state = toObject(payload.world_state);
  if (Object.keys(state).length > 0) return state;
  return payload;
}

function summarizeWorldState(state) {
  const worldState = toObject(state);
  return {
    world_name: cleanText(worldState.world_name || ""),
    blocks: Array.isArray(worldState.blocks) ? worldState.blocks.length : 0,
    background_blocks: Array.isArray(worldState.background_blocks) ? worldState.background_blocks.length : 0,
    seeds: Array.isArray(worldState.seeds) ? worldState.seeds.length : 0,
    interactions: Array.isArray(worldState.interactions) ? worldState.interactions.length : 0,
    drops: Array.isArray(worldState.drops) ? worldState.drops.length : 0,
  };
}

function parseGridCoord(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function rollbackGridKey(x, y) {
  return `${x},${y}`;
}

function normalizeWorldArray(value) {
  return Array.isArray(value) ? value.map((entry) => toObject(entry)).filter((entry) => Object.keys(entry).length > 0) : [];
}

function normalizeWorldStateForReplay(state, worldName) {
  const cleanWorldName = cleanKey(worldName || toObject(state).world_name || "START").toUpperCase() || "START";
  const replayState = safeJson(toObject(state));
  replayState.world_state_version = toInt(replayState.world_state_version, 1) || 1;
  replayState.world_name = cleanWorldName;
  replayState.blocks = normalizeWorldArray(replayState.blocks || replayState.foreground);
  replayState.background_blocks = normalizeWorldArray(replayState.background_blocks || replayState.background);
  replayState.removed_foreground = normalizeWorldArray(replayState.removed_foreground);
  replayState.removed_background = normalizeWorldArray(replayState.removed_background);
  replayState.seeds = normalizeWorldArray(replayState.seeds || replayState.planted_seeds);
  replayState.interactions = normalizeWorldArray(replayState.interactions);
  replayState.drops = normalizeWorldArray(replayState.drops || replayState.item_drops);
  replayState.world_lock = toObject(replayState.world_lock);
  replayState.saved_at = new Date().toISOString();
  return replayState;
}

function sortWorldGridRows(rows) {
  return normalizeWorldArray(rows).sort((left, right) => {
    const leftY = parseGridCoord(left.y) ?? 0;
    const rightY = parseGridCoord(right.y) ?? 0;
    if (leftY !== rightY) return leftY - rightY;
    const leftX = parseGridCoord(left.x) ?? 0;
    const rightX = parseGridCoord(right.x) ?? 0;
    return leftX - rightX;
  });
}

function setGridArrayEntry(state, fieldName, x, y, entry) {
  if (x === null || y === null) return false;
  const rows = normalizeWorldArray(state[fieldName]);
  const key = rollbackGridKey(x, y);
  const nextRows = [];
  for (const row of rows) {
    const rowX = parseGridCoord(row.x);
    const rowY = parseGridCoord(row.y);
    if (rowX === null || rowY === null) continue;
    if (rollbackGridKey(rowX, rowY) === key) continue;
    nextRows.push(row);
  }
  nextRows.push({ ...safeJson(entry), x, y });
  state[fieldName] = sortWorldGridRows(nextRows);
  return true;
}

function deleteGridArrayEntry(state, fieldName, x, y) {
  if (x === null || y === null) return false;
  const key = rollbackGridKey(x, y);
  const beforeRows = normalizeWorldArray(state[fieldName]);
  const afterRows = beforeRows.filter((row) => {
    const rowX = parseGridCoord(row.x);
    const rowY = parseGridCoord(row.y);
    return rowX === null || rowY === null || rollbackGridKey(rowX, rowY) !== key;
  });
  state[fieldName] = sortWorldGridRows(afterRows);
  return afterRows.length !== beforeRows.length;
}

function getGridArrayEntry(state, fieldName, x, y) {
  if (x === null || y === null) return null;
  const key = rollbackGridKey(x, y);
  return normalizeWorldArray(state[fieldName]).find((row) => {
    const rowX = parseGridCoord(row.x);
    const rowY = parseGridCoord(row.y);
    return rowX !== null && rowY !== null && rollbackGridKey(rowX, rowY) === key;
  }) || null;
}

function normalizeReplayLayer(layer) {
  return cleanKey(layer).toLowerCase() === "background" ? "background" : "foreground";
}

function getReplayBlockField(layer) {
  return normalizeReplayLayer(layer) === "background" ? "background_blocks" : "blocks";
}

function removeReplayInteractionExtras(state, x, y) {
  const block = getGridArrayEntry(state, "blocks", x, y);
  if (!block) return;
  delete block.entrance_locked;
  delete block.sign_text;
  delete block.toggle_on;
  delete block.door_id;
  delete block.door_name;
  delete block.name;
  delete block.door_destination;
  delete block.door_target_world;
  delete block.door_target_id;
  setGridArrayEntry(state, "blocks", x, y, block);
}

function syncReplayInteractionToBlock(state, x, y, data = {}) {
  const block = getGridArrayEntry(state, "blocks", x, y);
  if (!block) return;
  const entry = { ...block };
  const action = cleanKey(data.action).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(data, "locked")) {
    entry.entrance_locked = Boolean(data.locked);
  }
  if (Object.prototype.hasOwnProperty.call(data, "text")) {
    entry.sign_text = cleanText(data.text).slice(0, 500);
  }
  if (Object.prototype.hasOwnProperty.call(data, "on")) {
    entry.toggle_on = Boolean(data.on);
  }
  if (action === "door_state") {
    if (data.door_id) entry.door_id = cleanKey(data.door_id);
    if (Object.prototype.hasOwnProperty.call(data, "door_name") || Object.prototype.hasOwnProperty.call(data, "name")) entry.door_name = cleanText(data.door_name || data.name).slice(0, 64);
    if (data.destination || data.door_destination) entry.door_destination = cleanText(data.destination || data.door_destination).slice(0, 200);
    if (data.target_world || data.door_target_world) entry.door_target_world = cleanKey(data.target_world || data.door_target_world).toUpperCase();
    if (data.target_door_id || data.door_target_id) entry.door_target_id = cleanKey(data.target_door_id || data.door_target_id);
  }
  setGridArrayEntry(state, "blocks", x, y, entry);
}

function replayBlockChange(state, row = {}) {
  const x = parseGridCoord(row.block_x);
  const y = parseGridCoord(row.block_y);
  if (x === null || y === null) return false;
  const fieldName = getReplayBlockField(row.layer);
  const action = cleanKey(row.action).toLowerCase();
  const afterType = cleanKey(row.block_type_after || "");
  const legacyType = cleanKey(row.block_type || toObject(row.metadata).block_type_after || toObject(row.metadata).block_type || "");

  if (afterType) {
    return setGridArrayEntry(state, fieldName, x, y, { block_type: afterType });
  }
  if ((action === "place" || action === "hit") && legacyType) {
    return setGridArrayEntry(state, fieldName, x, y, { block_type: legacyType });
  }
  const deleted = deleteGridArrayEntry(state, fieldName, x, y);
  if (fieldName === "blocks") {
    deleteGridArrayEntry(state, "interactions", x, y);
  }
  return deleted;
}

function replayObjectChange(state, row = {}, worldName = "") {
  const objectType = cleanKey(row.object_type).toLowerCase();
  const action = cleanKey(row.action).toLowerCase();
  const oldData = toObject(row.old_data);
  const newData = toObject(row.new_data);

  if (objectType === "world_lock" || action === "world_lock_state") {
    state.world_lock = safeJson(newData);
    return true;
  }

  const x = parseGridCoord(newData.x ?? row.block_x ?? oldData.x);
  const y = parseGridCoord(newData.y ?? row.block_y ?? oldData.y);
  if (x === null || y === null) return false;

  const deleteActions = ["delete", "remove", "clear", "break", "destroy", "reset"];
  const shouldDelete = Object.keys(newData).length === 0 || deleteActions.some((word) => action.includes(word));
  if (shouldDelete) {
    deleteGridArrayEntry(state, "interactions", x, y);
    removeReplayInteractionExtras(state, x, y);
    return true;
  }

  const interaction = {
    ...safeJson(newData),
    x,
    y,
    world: cleanKey(newData.world || worldName || state.world_name || "").toUpperCase(),
  };
  if (!interaction.action && action) interaction.action = action;
  setGridArrayEntry(state, "interactions", x, y, interaction);
  syncReplayInteractionToBlock(state, x, y, interaction);
  return true;
}

async function loadWorldJournalReplayRows(store, worldId, fromAt, toAt, safeOnly = false) {
  if (!worldId || !fromAt || !toAt) {
    return { block_changes: [], object_changes: [] };
  }
  const safeSourceTypes = WORLD_JOURNAL_SAFE_SOURCE_TYPES.map((value) => String(value || ""));
  const useSafeFilter = Boolean(safeOnly) && safeSourceTypes.length > 0;
  const filterCondition = useSafeFilter
    ? `AND COALESCE(metadata->>'source_type', '') = ANY($4::text[])`
    : "";
  const filterConditionObject = useSafeFilter
    ? `AND COALESCE(source_type, metadata->>'source_type', '') = ANY($4::text[])`
    : "";
  const queryArgs = useSafeFilter ? [worldId, fromAt, toAt, safeSourceTypes] : [worldId, fromAt, toAt];

  const blockResult = await store.pool.query(
    `
    SELECT world_block_change_id,
           action,
           reason,
           layer,
           block_x,
           block_y,
           block_type_before,
           block_type_after,
           hit_count,
           metadata,
           created_at
      FROM ${store.table("world_block_changes")}
    WHERE world_id = $1
       AND created_at > $2::timestamptz
       AND created_at <= $3::timestamptz
       ${filterCondition || "AND COALESCE(metadata->>'source_type', '') <> 'rollback'"}
     ORDER BY created_at ASC, world_block_change_id ASC
    `,
    queryArgs
  );

  const objectResult = await store.pool.query(
    `
    SELECT world_object_change_id,
           object_type,
           object_id,
           block_x,
           block_y,
           action,
           reason,
           source_type,
           source_id,
           request_id,
           old_data,
           new_data,
           metadata,
           created_at
      FROM ${store.table("world_object_changes")}
    WHERE world_id = $1
       AND created_at > $2::timestamptz
       AND created_at <= $3::timestamptz
       ${filterConditionObject || "AND COALESCE(source_type, '') <> 'rollback'"}
     ORDER BY created_at ASC, world_object_change_id ASC
    `,
    queryArgs
  );

  return {
    block_changes: blockResult.rows,
    object_changes: objectResult.rows,
  };
}

function replayWorldJournal(snapshotState, worldName, replayRows) {
  const state = normalizeWorldStateForReplay(snapshotState, worldName);
  let blockApplied = 0;
  let objectApplied = 0;

  const changes = [
    ...normalizeWorldArray(replayRows.block_changes).map((row) => ({ kind: "block", row })),
    ...normalizeWorldArray(replayRows.object_changes).map((row) => ({ kind: "object", row })),
  ].sort((left, right) => {
    const leftTime = Date.parse(left.row.created_at || "");
    const rightTime = Date.parse(right.row.created_at || "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    if (left.kind !== right.kind) return left.kind === "block" ? -1 : 1;
    const leftId = toInt(left.row.world_block_change_id || left.row.world_object_change_id, 0);
    const rightId = toInt(right.row.world_block_change_id || right.row.world_object_change_id, 0);
    return leftId - rightId;
  });

  for (const change of changes) {
    if (change.kind === "block" && replayBlockChange(state, change.row)) blockApplied += 1;
    if (change.kind === "object" && replayObjectChange(state, change.row, worldName)) objectApplied += 1;
  }

  return {
    state,
    summary: {
      block_changes: replayRows.block_changes.length,
      object_changes: replayRows.object_changes.length,
      block_changes_applied: blockApplied,
      object_changes_applied: objectApplied,
      result_world_summary: summarizeWorldState(state),
    },
  };
}

function createStore() {
  return new PostgresStore({
    enabled: String(process.env.POSTGRES_ENABLED || "false").trim().toLowerCase() === "true",
    autoBootstrap: String(process.env.POSTGRES_AUTO_BOOTSTRAP || "false").trim().toLowerCase() === "true",
    bootstrapSqlPath: resolveConfiguredPath(
      process.env.POSTGRES_BOOTSTRAP_SQL_PATH,
      path.join(ROOT, "docs", "postgres_security_foundation.sql")
    ),
    connectionString: cleanText(process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL || ""),
    host: cleanText(process.env.POSTGRES_HOST || ""),
    port: Math.max(1, toInt(process.env.POSTGRES_PORT, 5432)),
    database: cleanText(process.env.POSTGRES_DATABASE || ""),
    user: cleanText(process.env.POSTGRES_USER || ""),
    password: String(process.env.POSTGRES_PASSWORD || ""),
    ssl: String(process.env.POSTGRES_SSL || "false").trim().toLowerCase() === "true",
    schema: cleanText(process.env.POSTGRES_SCHEMA || "pixelmania") || "pixelmania",
    poolMax: 4,
    logger: (...items) => console.warn(...items),
  });
}

async function connectStore() {
  const store = createStore();
  await store.init();
  if (!store.isReady()) {
    await store.close();
    throw new Error("PostgreSQL is not ready. Rollback apply requires PostgreSQL authoritative data.");
  }
  return store;
}

async function loadPlayerRecord(client, store, cache, identity) {
  const key = identity.player_id || `user:${cleanText(identity.username).toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  const byPlayerId = isUuid(identity.player_id || "");
  const result = await client.query(
    `
    SELECT p.player_id,
           a.username::text AS username,
           p.player_health,
           p.player_state
      FROM ${store.table("players")} p
      JOIN ${store.table("accounts")} a ON a.account_id = p.account_id
     WHERE ${byPlayerId ? "p.player_id = $1::uuid" : "lower(a.username) = lower($1)"}
     LIMIT 1
     FOR UPDATE
    `,
    [byPlayerId ? identity.player_id : identity.username]
  );
  const row = result.rows[0];
  if (!row?.player_id) return null;
  const record = {
    player_id: row.player_id,
    username: cleanText(row.username),
    player_health: Math.max(0, toInt(row.player_health, 100)),
    state: {
      ...toObject(row.player_state),
      account_username: cleanText(toObject(row.player_state).account_username || row.username),
    },
    dirty: false,
  };
  cache.set(record.player_id, record);
  cache.set(`user:${record.username.toLowerCase()}`, record);
  return record;
}

async function saveDirtyPlayerRecords(client, store, cache) {
  const saved = new Set();
  for (const record of cache.values()) {
    if (!record?.dirty || saved.has(record.player_id)) continue;
    saved.add(record.player_id);
    await client.query(
      `
      UPDATE ${store.table("players")}
         SET player_health = $2,
             player_state = $3::jsonb,
             updated_at = now()
       WHERE player_id = $1
      `,
      [
        record.player_id,
        Math.max(0, toInt(record.state.player_health, record.player_health)),
        JSON.stringify({
          ...safeJson(record.state),
          account_username: record.username,
        }),
      ]
    );
  }
}

async function applyInventoryDelta(client, store, playerCache, entry) {
  const player = await loadPlayerRecord(client, store, playerCache, { player_id: entry.player_id, username: entry.username });
  if (!player) throw new Error(`Player not found while applying rollback: ${entry.username || entry.player_id}`);

  const itemType = cleanKey(entry.item_type);
  const itemCategory = resolveCategory(itemType, entry.item_category);
  const delta = toInt(entry.delta, 0);
  if (!itemType || !itemCategory || delta === 0) return null;

  const stackLimit = getStackLimit(itemType, entry.stack_limit || DEFAULT_STACK_LIMIT);
  const inventoryBeforeHash = await store.getInventorySnapshotHash(client, player.player_id);
  const currentResult = await client.query(
    `
    SELECT amount, stack_limit
      FROM ${store.table("inventory")}
     WHERE player_id = $1
       AND item_type = $2
       AND item_category = $3
     FOR UPDATE
    `,
    [player.player_id, itemType, itemCategory]
  );
  const existing = currentResult.rows[0];
  const beforeAmount = Math.max(0, toInt(existing?.amount, 0));
  const afterAmount = beforeAmount + delta;
  if (afterAmount < 0) {
    throw new Error(`Rollback would make ${player.username} ${itemType}/${itemCategory} negative (${beforeAmount} + ${delta}).`);
  }
  const effectiveStackLimit = Math.max(stackLimit, toInt(existing?.stack_limit, stackLimit), afterAmount);

  if (existing) {
    await client.query(
      `
      UPDATE ${store.table("inventory")}
         SET amount = $4,
             stack_limit = $5,
             row_version = ${store.table("inventory")}.row_version + 1,
             updated_at = now()
       WHERE player_id = $1
         AND item_type = $2
         AND item_category = $3
      `,
      [player.player_id, itemType, itemCategory, afterAmount, effectiveStackLimit]
    );
  } else {
    await client.query(
      `
      INSERT INTO ${store.table("inventory")} (
        player_id,
        item_type,
        item_category,
        amount,
        stack_limit,
        row_version,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 1, now())
      `,
      [player.player_id, itemType, itemCategory, afterAmount, effectiveStackLimit]
    );
  }

  setPlayerStateItem(player.state, itemType, itemCategory, afterAmount);
  player.dirty = true;

  const itemTransactionResult = await client.query(
    `
    INSERT INTO ${store.table("item_transactions")} (
      player_id,
      world_id,
      source,
      action,
      item_type,
      item_category,
      delta,
      before_amount,
      after_amount,
      request_id,
      metadata,
      created_at
    )
    VALUES ($1, $2, 'rollback', $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10::jsonb, now())
    RETURNING item_transaction_id
    `,
    [
      player.player_id,
      entry.world_id || null,
      cleanKey(entry.action || "rollback_apply"),
      itemType,
      itemCategory,
      delta,
      beforeAmount,
      afterAmount,
      cleanText(entry.request_id || ""),
      JSON.stringify(safeJson(entry.metadata)),
    ]
  );
  const itemTransactionId = itemTransactionResult.rows[0]?.item_transaction_id || null;

  let gemLedgerId = null;
  const isGem = itemType === "gem" || itemCategory === "currency";
  if (isGem) {
    const gemResult = await client.query(
      `
      INSERT INTO ${store.table("gem_ledger")} (
        player_id,
        delta,
        reason,
        ref_type,
        ref_id,
        before_balance,
        after_balance,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, 'rollback', NULLIF($4, ''), $5, $6, $7::jsonb, now())
      RETURNING gem_ledger_id
      `,
      [
        player.player_id,
        delta,
        cleanText(entry.reason || "rollback"),
        cleanText(entry.request_id || ""),
        beforeAmount,
        afterAmount,
        JSON.stringify({
          ...safeJson(entry.metadata),
          item_type: itemType,
          item_category: itemCategory,
        }),
      ]
    );
    gemLedgerId = gemResult.rows[0]?.gem_ledger_id || null;
  }

  const inventoryAfterHash = await store.getInventorySnapshotHash(client, player.player_id);
  if (typeof store.updatePlayerInventoryHash === "function") {
    await store.updatePlayerInventoryHash(client, player.player_id, inventoryAfterHash);
  }

  return {
    player,
    item_transaction_id: itemTransactionId,
    gem_ledger_id: gemLedgerId,
    item_type: itemType,
    item_category: itemCategory,
    delta,
    before_amount: beforeAmount,
    after_amount: afterAmount,
    inventory_before_hash: inventoryBeforeHash,
    inventory_after_hash: inventoryAfterHash,
    gems_before: isGem ? beforeAmount : null,
    gems_after: isGem ? afterAmount : null,
  };
}

async function moveItemInstance(client, store, entry) {
  const identifier = cleanText(entry.item_instance_id || entry.public_item_instance_id || "");
  if (!identifier) throw new Error("Missing item instance identifier.");
  const lookupByUuid = isUuid(identifier);
  const result = await client.query(
    `
    SELECT item_instance_id,
           public_item_instance_id,
           item_type,
           item_category,
           owner_player_id,
           world_id,
           state,
           current_location,
           metadata
      FROM ${store.table("item_instances")}
     WHERE ${lookupByUuid ? "item_instance_id = $1::uuid" : "lower(public_item_instance_id) = lower($1)"}
     LIMIT 1
     FOR UPDATE
    `,
    [identifier]
  );
  const previous = result.rows[0];
  if (!previous?.item_instance_id) throw new Error(`Item instance not found: ${identifier}`);

  const nextOwnerId = entry.owner_player_id === undefined ? previous.owner_player_id : entry.owner_player_id;
  const nextWorldId = entry.world_id === undefined ? previous.world_id : entry.world_id;
  const nextState = cleanKey(entry.state || previous.state || "active").toLowerCase();
  const nextLocation = cleanKey(entry.current_location || previous.current_location || "inventory").toLowerCase();
  const metadata = {
    ...safeJson(entry.metadata),
    rollback_applied: true,
    admin_corrected: true,
    rollback_job_id: cleanText(entry.rollback_job_id || ""),
    rollback_reason: cleanText(entry.reason || ""),
    previous_state: cleanText(previous.state || ""),
    previous_location: cleanText(previous.current_location || ""),
    previous_owner_player_id: cleanText(previous.owner_player_id || ""),
  };

  const updateResult = await client.query(
    `
    UPDATE ${store.table("item_instances")}
       SET owner_player_id = $2,
           world_id = $3,
           state = $4,
           current_location = $5,
           metadata = metadata || $6::jsonb,
           updated_at = now()
     WHERE item_instance_id = $1
    RETURNING item_instance_id,
              public_item_instance_id,
              item_type,
              item_category,
              owner_player_id,
              world_id,
              state,
              current_location,
              created_by_source,
              metadata,
              created_at,
              updated_at
    `,
    [
      previous.item_instance_id,
      nextOwnerId || null,
      nextWorldId || null,
      nextState || "active",
      nextLocation || "inventory",
      JSON.stringify(metadata),
    ]
  );

  const row = updateResult.rows[0];
  await store.recordItemInstanceEvent(client, {
    item_instance_id: row.item_instance_id,
    event_type: entry.event_type || "updated",
    from_player_id: previous.owner_player_id,
    to_player_id: nextOwnerId || null,
    from_location: previous.current_location || "unknown",
    to_location: nextLocation || "unknown",
    world_id: nextWorldId || previous.world_id || null,
    item_transaction_id: entry.item_transaction_id || null,
    source: "rollback",
    metadata: {
      ...metadata,
      public_item_instance_id: cleanText(row.public_item_instance_id || ""),
      item_type: cleanText(row.item_type || ""),
      item_category: cleanText(row.item_category || ""),
      action: cleanText(entry.action || "rollback_item_move"),
    },
  });

  return {
    item_instance_id: row.item_instance_id,
    public_item_instance_id: cleanText(row.public_item_instance_id || ""),
    item_type: cleanText(row.item_type || ""),
    item_category: cleanText(row.item_category || ""),
    state: cleanText(row.state || ""),
    current_location: cleanText(row.current_location || ""),
    previous_state: cleanText(previous.state || ""),
    previous_location: cleanText(previous.current_location || ""),
    previous_owner_player_id: cleanText(previous.owner_player_id || ""),
    owner_player_id: cleanText(row.owner_player_id || ""),
  };
}

async function markTransactionLedgerRowsReversed(client, store, ids, metadata) {
  const ledgerIds = Array.from(new Set((ids || []).map((id) => toInt(id, 0)).filter((id) => id > 0)));
  if (ledgerIds.length === 0) return 0;
  const metadataPatch = {
    ...safeJson(metadata),
    rollback_applied: true,
    admin_corrected: true,
    reversed_at: new Date().toISOString(),
  };
  const result = await client.query(
    `
    UPDATE ${store.table("transaction_ledger")}
       SET status = 'reversed',
           metadata = metadata || $2::jsonb
     WHERE transaction_ledger_id = ANY($1::bigint[])
       AND status <> 'reversed'
     RETURNING transaction_ledger_id,
               transaction_id,
               transaction_type,
               status,
               player_id,
               other_player_id,
               world_id,
               item_transaction_id,
               gem_ledger_id,
               trade_id,
               vending_transaction_id,
               shop_purchase_id,
               admin_action_id,
               item_instance_id,
               public_item_instance_id,
               item_type,
               item_category,
               quantity,
               gems_before,
               gems_after,
               inventory_before_hash,
               inventory_after_hash,
               ip_address::text AS ip_address,
               session_token_hash,
               user_agent,
               device_info,
               request_id,
               correlation_id,
               source,
               action,
               metadata,
               server_time
    `,
    [
      ledgerIds,
      JSON.stringify(metadataPatch),
    ]
  );
  if (typeof PostgresStore.buildTransactionLedgerHash === "function") {
    for (const row of result.rows || []) {
      const transactionHash = PostgresStore.buildTransactionLedgerHash(row);
      await client.query(
        `
        UPDATE ${store.table("transaction_ledger")}
           SET transaction_hash = $2,
               transaction_hash_algorithm = $3
         WHERE transaction_ledger_id = $1
        `,
        [
          row.transaction_ledger_id,
          transactionHash,
          PostgresStore.INTEGRITY_HASH_ALGORITHM || "sha256:v1",
        ]
      );
    }
  }
  return result.rowCount || 0;
}

async function insertRollbackJob(store, plan, options) {
  return store.withTransaction(async (client) => {
    const result = await client.query(
      `
      INSERT INTO ${store.table("rollback_jobs")} (
        rollback_type,
        status,
        actor_username,
        reason,
        target_username,
        target_world,
        target_item_instance_id,
        target_transaction_id,
        target_transaction_ledger_id,
        since_at,
        until_at,
        snapshot_version,
        dry_run,
        plan,
        result,
        applied_at
      )
      VALUES (
        $1,
        'planned',
        $2,
        $3,
        NULLIF($4, ''),
        NULLIF($5, ''),
        NULLIF($6, ''),
        $7::uuid,
        $8,
        $9::timestamptz,
        $10::timestamptz,
        $11,
        false,
        $12::jsonb,
        '{}'::jsonb,
        NULL
      )
      RETURNING rollback_job_id
      `,
      [
        options.rollback_type,
        options.actor_username,
        options.reason,
        options.target_username || "",
        options.target_world || "",
        options.target_item_instance_id || "",
        options.target_transaction_id || null,
        options.target_transaction_ledger_id || null,
        options.since_at || null,
        options.until_at || null,
        options.snapshot_version || null,
        JSON.stringify(safeJson(plan)),
      ]
    );
    return result.rows[0]?.rollback_job_id || null;
  });
}

async function updateRollbackJob(store, jobId, status, result) {
  if (!jobId) return;
  const cleanResult = {
    ...safeJson(result),
    rollback_applied: status === "applied",
    admin_corrected: status === "applied",
  };
  await store.withTransaction(async (client) => {
    await client.query(
      `
      UPDATE ${store.table("rollback_jobs")}
         SET status = $2,
             result = $3::jsonb,
             applied_at = CASE WHEN $2 = 'applied' THEN now() ELSE applied_at END
      WHERE rollback_job_id = $1
      `,
      [jobId, status, JSON.stringify(cleanResult)]
    );
  });
}

async function buildPlayerPlan(store, options) {
  const sinceAt = parseTimeOption("--since", true);
  const untilAt = parseTimeOption("--until", false) || new Date().toISOString();
  const username = cleanText(getOption("--user", getOption("--username", "")));
  if (!username) throw new Error("--user is required for player rollback.");

  const playerResult = await store.pool.query(
    `
    SELECT p.player_id, a.username::text AS username
      FROM ${store.table("players")} p
      JOIN ${store.table("accounts")} a ON a.account_id = p.account_id
     WHERE lower(a.username) = lower($1)
     LIMIT 1
    `,
    [username]
  );
  const player = playerResult.rows[0];
  if (!player?.player_id) throw new Error(`Player not found: ${username}`);

  const itemResult = await store.pool.query(
    `
    SELECT item_type,
           item_category,
           COALESCE(sum(delta), 0)::bigint AS delta_after,
           count(*)::integer AS row_count
      FROM ${store.table("item_transactions")}
     WHERE player_id = $1
       AND created_at >= $2::timestamptz
       AND created_at < $3::timestamptz
       AND source <> 'rollback'
     GROUP BY item_type, item_category
     ORDER BY item_category, item_type
    `,
    [player.player_id, sinceAt, untilAt]
  );

  const gemResult = await store.pool.query(
    `
    SELECT COALESCE(sum(delta), 0)::bigint AS delta_after,
           count(*)::integer AS row_count
      FROM ${store.table("gem_ledger")}
     WHERE player_id = $1
       AND created_at >= $2::timestamptz
       AND created_at < $3::timestamptz
       AND NOT (metadata ? 'rollback_job_id')
    `,
    [player.player_id, sinceAt, untilAt]
  );

  const ledgerResult = await store.pool.query(
    `
    SELECT transaction_ledger_id
      FROM ${store.table("transaction_ledger")}
     WHERE player_id = $1
       AND server_time >= $2::timestamptz
       AND server_time < $3::timestamptz
       AND status <> 'reversed'
       AND COALESCE(source, '') <> 'rollback'
     ORDER BY server_time ASC, transaction_ledger_id ASC
    `,
    [player.player_id, sinceAt, untilAt]
  );

  const deltasByKey = new Map();
  for (const row of itemResult.rows) {
    const itemType = cleanKey(row.item_type || "");
    if (!itemType) continue;
    const itemCategory = resolveCategory(itemType, row.item_category || "block");
    const inverseDelta = -toInt(row.delta_after, 0);
    if (inverseDelta === 0) continue;
    deltasByKey.set(`${itemType}\u0000${itemCategory}`, {
      item_type: itemType,
      item_category: itemCategory,
      delta: inverseDelta,
      source_rows: toInt(row.row_count, 0),
      tracked: isTrackedItem(itemType, itemCategory),
      item_instances: [],
    });
  }

  const gemDeltaAfter = toInt(gemResult.rows[0]?.delta_after, 0);
  const gemKey = "gem\u0000currency";
  if (gemDeltaAfter !== 0 && !deltasByKey.has(gemKey)) {
    deltasByKey.set(gemKey, {
      item_type: "gem",
      item_category: "currency",
      delta: -gemDeltaAfter,
      source_rows: toInt(gemResult.rows[0]?.row_count, 0),
      tracked: false,
      item_instances: [],
      source: "gem_ledger",
    });
  }

  const blockingIssues = [];
  const deltas = Array.from(deltasByKey.values());
  for (const delta of deltas) {
    if (!delta.tracked) continue;
    const amount = Math.abs(delta.delta);
    if (amount <= 0) continue;
    const selector = delta.delta < 0
      ? `
        owner_player_id = $1
        AND item_type = $2
        AND item_category = $3
        AND state = 'active'
        AND current_location = 'inventory'
      `
      : `
        owner_player_id = $1
        AND item_type = $2
        AND item_category = $3
        AND NOT (state = 'active' AND current_location = 'inventory')
        AND updated_at >= $4::timestamptz
      `;
    const params = delta.delta < 0
      ? [player.player_id, delta.item_type, delta.item_category, amount]
      : [player.player_id, delta.item_type, delta.item_category, sinceAt, amount];
    const query = delta.delta < 0
      ? `
        SELECT item_instance_id, public_item_instance_id, state, current_location, updated_at
          FROM ${store.table("item_instances")}
         WHERE ${selector}
         ORDER BY updated_at DESC
         LIMIT $4
      `
      : `
        SELECT item_instance_id, public_item_instance_id, state, current_location, updated_at
          FROM ${store.table("item_instances")}
         WHERE ${selector}
         ORDER BY updated_at DESC
         LIMIT $5
      `;
    const instanceResult = await store.pool.query(query, params);
    delta.item_instances = instanceResult.rows.map((row) => ({
      item_instance_id: row.item_instance_id,
      public_item_instance_id: cleanText(row.public_item_instance_id || ""),
      state: cleanText(row.state || ""),
      current_location: cleanText(row.current_location || ""),
    }));
    if (delta.item_instances.length < amount) {
      blockingIssues.push({
        type: "missing_exact_item_instances",
        item_type: delta.item_type,
        item_category: delta.item_category,
        needed: amount,
        found: delta.item_instances.length,
        direction: delta.delta < 0 ? "remove_from_inventory" : "restore_to_inventory",
      });
    }
  }

  return {
    rollback_type: "player",
    dry_run: !options.apply,
    target_username: cleanText(player.username || username),
    player_id: player.player_id,
    since_at: sinceAt,
    until_at: untilAt,
    reason: options.reason,
    actor_username: options.actor_username,
    inverse_deltas: deltas,
    transaction_ledger_ids_to_mark_reversed: ledgerResult.rows.map((row) => toInt(row.transaction_ledger_id, 0)).filter(Boolean),
    source_counts: {
      item_transaction_groups: itemResult.rows.length,
      gem_ledger_rows: toInt(gemResult.rows[0]?.row_count, 0),
      transaction_ledger_rows: ledgerResult.rows.length,
    },
    blocking_issues: blockingIssues,
  };
}

async function applyPlayerPlan(store, plan, options, jobId) {
  return store.withTransaction(async (client) => {
    const playerCache = new Map();
    const worldId = null;
    const applied = [];
    for (const delta of plan.inverse_deltas) {
      const entry = await applyInventoryDelta(client, store, playerCache, {
        player_id: plan.player_id,
        username: plan.target_username,
        world_id: worldId,
        item_type: delta.item_type,
        item_category: delta.item_category,
        delta: delta.delta,
        action: "player_time_rollback",
        request_id: jobId,
        reason: options.reason,
        metadata: {
          rollback_job_id: jobId,
          rollback_type: "player",
          admin_corrected: true,
          since_at: plan.since_at,
          until_at: plan.until_at,
          source_rows: delta.source_rows,
        },
      });
      if (!entry) continue;

      const movedInstances = [];
      if (delta.tracked) {
        const targetState = delta.delta < 0 ? "destroyed" : "active";
        const targetLocation = delta.delta < 0 ? "unknown" : "inventory";
        for (const instance of delta.item_instances) {
          const moved = await moveItemInstance(client, store, {
            item_instance_id: instance.item_instance_id,
            owner_player_id: plan.player_id,
            world_id: null,
            state: targetState,
            current_location: targetLocation,
            event_type: delta.delta < 0 ? "retired" : "state_changed",
            action: "player_time_rollback",
            item_transaction_id: entry.item_transaction_id,
            rollback_job_id: jobId,
            reason: options.reason,
            metadata: {
              rollback_type: "player",
              admin_corrected: true,
              since_at: plan.since_at,
              until_at: plan.until_at,
              inventory_delta: delta.delta,
            },
          });
          movedInstances.push(moved);
        }
      }

      await store.recordTransactionLedger(client, {
        transaction_type: "ROLLBACK_PLAYER",
        status: "reversed",
        player_id: plan.player_id,
        item_transaction_id: entry.item_transaction_id,
        gem_ledger_id: entry.gem_ledger_id,
        item_type: entry.item_type,
        item_category: entry.item_category,
        quantity: entry.delta,
        gems_before: entry.gems_before,
        gems_after: entry.gems_after,
        inventory_before_hash: entry.inventory_before_hash,
        inventory_after_hash: entry.inventory_after_hash,
        request_id: jobId,
        source: "rollback",
        action: "player_time_rollback",
        item_instances: movedInstances,
        metadata: {
          rollback_job_id: jobId,
          rollback_applied: true,
          admin_corrected: true,
          rollback_reason: options.reason,
          since_at: plan.since_at,
          until_at: plan.until_at,
        },
      });

      applied.push({
        item_type: entry.item_type,
        item_category: entry.item_category,
        delta: entry.delta,
        before_amount: entry.before_amount,
        after_amount: entry.after_amount,
        item_instances: movedInstances.map((item) => item.public_item_instance_id),
      });
    }

    await saveDirtyPlayerRecords(client, store, playerCache);
    const reversedRows = await markTransactionLedgerRowsReversed(
      client,
      store,
      plan.transaction_ledger_ids_to_mark_reversed,
      {
        rollback_job_id: jobId,
        rollback_type: "player",
        admin_corrected: true,
        rollback_reason: options.reason,
      }
    );
    return { ok: true, applied, reversed_transaction_ledger_rows: reversedRows };
  });
}

async function readSnapshotFromS3(storageUri) {
  const endpoint = cleanText(process.env.WORLD_SNAPSHOT_SPACES_ENDPOINT || process.env.PIXELMANIA_POSTGRES_OFFSITE_ENDPOINT || "");
  const awsArgs = [];
  if (endpoint) awsArgs.push("--endpoint-url", endpoint);
  awsArgs.push("s3", "cp", storageUri, "-");
  return new Promise((resolve, reject) => {
    childProcess.execFile("aws", awsArgs, {
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        AWS_REQUEST_CHECKSUM_CALCULATION: process.env.AWS_REQUEST_CHECKSUM_CALCULATION || "when_required",
        AWS_RESPONSE_CHECKSUM_VALIDATION: process.env.AWS_RESPONSE_CHECKSUM_VALIDATION || "when_required",
        AWS_EC2_METADATA_DISABLED: process.env.AWS_EC2_METADATA_DISABLED || "true",
      },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(cleanText(stderr || error.message)));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

async function buildWorldPlan(store, options) {
  const worldName = cleanKey(getOption("--world", "START")).toUpperCase() || "START";
  const explicitFile = cleanText(getOption("--file", ""));
  const targetAt = parseTimeOption("--at", false)
    || parseTimeOption("--to", false)
    || parseTimeOption("--target-time", false);
  let selected = null;
  let snapshotPayload = null;

  if (explicitFile) {
    const filePath = path.isAbsolute(explicitFile) ? explicitFile : path.resolve(process.cwd(), explicitFile);
    if (!fs.existsSync(filePath)) throw new Error(`Snapshot file does not exist: ${filePath}`);
    snapshotPayload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    selected = { source: "file", file: filePath, snapshot_version: null, storage_uri: filePath, created_at: null };
  } else {
    const snapshotId = toInt(getOption("--snapshot-id", ""), 0);
    const snapshotVersion = toInt(getOption("--snapshot-version", ""), 0);
    const latest = hasFlag("--latest") || (snapshotId <= 0 && snapshotVersion <= 0);
    const params = [worldName];
    const predicates = [];
    if (snapshotId > 0) {
      params.push(snapshotId);
      predicates.push(`AND ws.world_snapshot_id = $${params.length}`);
    } else if (snapshotVersion > 0) {
      params.push(snapshotVersion);
      predicates.push(`AND ws.snapshot_version = $${params.length}`);
    } else if (targetAt) {
      params.push(targetAt);
      predicates.push(`AND ws.created_at <= $${params.length}::timestamptz`);
    }
    const result = await store.pool.query(
      `
      SELECT w.world_id,
             w.world_name::text AS world_name,
             w.world_state AS current_world_state,
             ws.world_snapshot_id,
             ws.snapshot_version,
             ws.snapshot_data,
             ws.storage_uri,
             ws.checksum,
             ws.reason AS snapshot_reason,
             ws.created_by,
             ws.created_at
        FROM ${store.table("worlds")} w
        JOIN ${store.table("world_snapshots")} ws ON ws.world_id = w.world_id
       WHERE lower(w.world_name) = lower($1)
         ${predicates.join("\n         ")}
       ORDER BY ${latest ? "ws.created_at DESC, ws.snapshot_version DESC" : "ws.snapshot_version DESC"}
       LIMIT 1
      `,
      params
    );
    const row = result.rows[0];
    if (!row?.world_snapshot_id) throw new Error(`No snapshot found for world ${worldName}.`);
    selected = {
      source: "postgres",
      world_id: row.world_id,
      world_name: cleanText(row.world_name),
      world_snapshot_id: toInt(row.world_snapshot_id, 0),
      snapshot_version: toInt(row.snapshot_version, 0),
      storage_uri: cleanText(row.storage_uri || ""),
      checksum: cleanText(row.checksum || ""),
      snapshot_reason: cleanText(row.snapshot_reason || ""),
      created_by: cleanText(row.created_by || ""),
      created_at: normalizeTimestampValue(row.created_at, "snapshot created_at", false),
      current_world_state: toObject(row.current_world_state),
    };
    snapshotPayload = toObject(row.snapshot_data);
    if (Object.keys(snapshotPayload).length === 0 && selected.storage_uri.startsWith("s3://")) {
      snapshotPayload = await readSnapshotFromS3(selected.storage_uri);
    } else if (Object.keys(snapshotPayload).length === 0 && selected.storage_uri && fs.existsSync(selected.storage_uri)) {
      snapshotPayload = JSON.parse(fs.readFileSync(selected.storage_uri, "utf8"));
    }
  }

  const snapshotState = extractWorldState(snapshotPayload);
  if (!Array.isArray(snapshotState.blocks)) {
    throw new Error("Selected snapshot is missing a world_state.blocks array.");
  }

  let restoredState = normalizeWorldStateForReplay(snapshotState, worldName);
  let journalReplay = {
    enabled: false,
    from: null,
    to: targetAt || null,
    block_changes: 0,
    object_changes: 0,
    block_changes_applied: 0,
    object_changes_applied: 0,
    result_world_summary: summarizeWorldState(restoredState),
  };

  const safeOnly = Boolean(options.safe_only);
  if (targetAt) {
    if (!selected.created_at || !selected.world_id) {
      throw new Error("--at requires a PostgreSQL snapshot with created_at metadata.");
    }
    const snapshotTime = Date.parse(selected.created_at);
    const targetTime = Date.parse(targetAt);
    if (!Number.isFinite(snapshotTime) || !Number.isFinite(targetTime)) {
      throw new Error("Snapshot and target timestamps must be valid.");
    }
    if (snapshotTime > targetTime) {
      throw new Error(`Selected snapshot ${selected.snapshot_version || selected.world_snapshot_id} was created after --at.`);
    }
    const replayRows = await loadWorldJournalReplayRows(store, selected.world_id, selected.created_at, targetAt, safeOnly);
    const replay = replayWorldJournal(snapshotState, worldName, replayRows);
    restoredState = replay.state;
    journalReplay = {
      enabled: true,
      from: selected.created_at,
      to: targetAt,
      safe_only: safeOnly,
      ...replay.summary,
    };
  }

  return {
    rollback_type: "world",
    dry_run: !options.apply,
    target_world: worldName,
    reason: options.reason,
    actor_username: options.actor_username,
    selected_snapshot: selected,
    snapshot_summary: summarizeWorldState(snapshotState),
    restored_summary: summarizeWorldState(restoredState),
    target_at: targetAt || null,
    since_at: targetAt ? selected.created_at : null,
    until_at: targetAt || null,
    journal_replay: journalReplay,
    blocking_issues: [],
    snapshot_state: restoredState,
  };
}

async function applyWorldPlan(store, plan, options, jobId) {
  return store.withTransaction(async (client) => {
    const worldResult = await client.query(
      `
      SELECT world_id, world_name::text AS world_name, world_state
        FROM ${store.table("worlds")}
       WHERE lower(world_name) = lower($1)
       LIMIT 1
       FOR UPDATE
      `,
      [plan.target_world]
    );
    const currentWorld = worldResult.rows[0];
    if (!currentWorld?.world_id) throw new Error(`World not found: ${plan.target_world}`);
    const currentState = toObject(currentWorld.world_state);

    await client.query(
      `
      INSERT INTO ${store.table("world_snapshots")} (
        world_id,
        snapshot_version,
        checksum,
        storage_uri,
        snapshot_data,
        reason,
        created_by,
        created_at
      )
      SELECT
        $1,
        COALESCE(MAX(snapshot_version), 0) + 1,
        $2,
        NULL,
        $3::jsonb,
        'before_rollback_restore',
        $4,
        now()
      FROM ${store.table("world_snapshots")}
      WHERE world_id = $1
      `,
      [
        currentWorld.world_id,
        crypto.createHash("sha256").update(JSON.stringify(currentState || {})).digest("hex"),
        JSON.stringify(currentState || {}),
        options.actor_username,
      ]
    );

    const restoredState = {
      ...safeJson(plan.snapshot_state),
      world_name: cleanText(plan.snapshot_state.world_name || currentWorld.world_name || plan.target_world),
    };
    const rollbackAction = plan.journal_replay?.enabled ? "rollback_journal_replay_restore" : "rollback_snapshot_restore";
    const rollbackTransactionType = plan.journal_replay?.enabled ? "ROLLBACK_WORLD_JOURNAL_REPLAY" : "ROLLBACK_WORLD_SNAPSHOT";
    await store.upsertWorldState(client, plan.target_world, restoredState);
    await store.mirrorWorldLockState(client, currentWorld.world_id, restoredState);

    await client.query(
      `
      INSERT INTO ${store.table("world_object_changes")} (
        world_id,
        object_type,
        object_id,
        action,
        reason,
        source_type,
        source_id,
        old_data,
        new_data,
        metadata,
        created_at
      )
      VALUES ($1, 'world_snapshot', $2, $3, $4, 'rollback', $5, $6::jsonb, $7::jsonb, $8::jsonb, now())
      `,
      [
        currentWorld.world_id,
        plan.target_world,
        rollbackAction,
        options.reason,
        jobId,
        JSON.stringify(summarizeWorldState(currentState)),
        JSON.stringify(summarizeWorldState(restoredState)),
        JSON.stringify({
          rollback_job_id: jobId,
          rollback_applied: true,
          admin_corrected: true,
          selected_snapshot: plan.selected_snapshot,
          target_at: plan.target_at || null,
          journal_replay: plan.journal_replay || {},
        }),
      ]
    );

    const ledgerCutoffAt = plan.target_at || plan.selected_snapshot.created_at || null;
    const ledgerResult = await client.query(
      `
      SELECT transaction_ledger_id
        FROM ${store.table("transaction_ledger")}
       WHERE world_id = $1
         AND status <> 'reversed'
         AND COALESCE(source, '') <> 'rollback'
         AND ($2::timestamptz IS NULL OR server_time >= $2::timestamptz)
      `,
      [currentWorld.world_id, ledgerCutoffAt]
    );
    const reversedRows = await markTransactionLedgerRowsReversed(
      client,
      store,
      ledgerResult.rows.map((row) => row.transaction_ledger_id),
      {
        rollback_job_id: jobId,
        rollback_type: "world",
        admin_corrected: true,
        rollback_reason: options.reason,
        selected_snapshot: plan.selected_snapshot,
        target_at: plan.target_at || null,
        journal_replay: plan.journal_replay || {},
      }
    );

    await store.recordTransactionLedger(client, {
      transaction_type: rollbackTransactionType,
      status: "reversed",
      world_id: currentWorld.world_id,
      quantity: 0,
      request_id: jobId,
      source: "rollback",
      action: plan.journal_replay?.enabled ? "world_journal_replay_restore" : "world_snapshot_restore",
      metadata: {
        rollback_job_id: jobId,
        rollback_applied: true,
        admin_corrected: true,
        rollback_reason: options.reason,
        target_world: plan.target_world,
        selected_snapshot: plan.selected_snapshot,
        target_at: plan.target_at || null,
        journal_replay: plan.journal_replay || {},
        snapshot_summary: plan.snapshot_summary,
        restored_summary: plan.restored_summary || summarizeWorldState(restoredState),
        current_summary: summarizeWorldState(currentState),
      },
    });

    return {
      ok: true,
      target_world: plan.target_world,
      snapshot_summary: plan.snapshot_summary,
      restored_summary: plan.restored_summary || summarizeWorldState(restoredState),
      target_at: plan.target_at || null,
      journal_replay: plan.journal_replay || {},
      reversed_transaction_ledger_rows: reversedRows,
    };
  });
}

async function buildItemPlan(store, options) {
  const identifier = cleanText(getOption("--item-instance", getOption("--instance", "")));
  const action = cleanKey(getOption("--action", "retire")).toLowerCase();
  const allowed = new Set(["retire", "freeze", "unfreeze", "transfer", "flag"]);
  if (!identifier) throw new Error("--item-instance is required for item rollback.");
  if (!allowed.has(action)) throw new Error("--action must be retire, freeze, unfreeze, transfer, or flag.");
  const targetUsername = cleanText(getOption("--target", getOption("--target-user", "")));
  if (action === "transfer" && !targetUsername) throw new Error("--target is required for transfer.");

  const history = await store.getItemInstanceHistory(identifier, { limit: 80 });
  if (!history?.ok) throw new Error(`Item lookup failed: ${history?.reason || "unknown"}`);

  return {
    rollback_type: "item",
    dry_run: !options.apply,
    action,
    target_username: targetUsername,
    target_item_instance_id: identifier,
    reason: options.reason,
    actor_username: options.actor_username,
    item_instance: history.item_instance,
    events: history.events,
    blocking_issues: [],
  };
}

async function applyItemPlan(store, plan, options, jobId) {
  return store.withTransaction(async (client) => {
    const playerCache = new Map();
    const identifier = plan.item_instance.item_instance_id || plan.target_item_instance_id;
    const lookupResult = await client.query(
      `
      SELECT ii.item_instance_id,
             ii.public_item_instance_id,
             ii.item_type,
             ii.item_category,
             ii.owner_player_id,
             ii.world_id,
             ii.state,
             ii.current_location,
             owner_account.username::text AS owner_username
        FROM ${store.table("item_instances")} ii
        LEFT JOIN ${store.table("players")} owner_player ON owner_player.player_id = ii.owner_player_id
        LEFT JOIN ${store.table("accounts")} owner_account ON owner_account.account_id = owner_player.account_id
       WHERE ${isUuid(identifier) ? "ii.item_instance_id = $1::uuid" : "lower(ii.public_item_instance_id) = lower($1)"}
       LIMIT 1
       FOR UPDATE
      `,
      [identifier]
    );
    const row = lookupResult.rows[0];
    if (!row?.item_instance_id) throw new Error(`Item instance not found: ${identifier}`);

    let nextOwnerId = row.owner_player_id || null;
    let nextState = cleanText(row.state || "active");
    let nextLocation = cleanText(row.current_location || "inventory");
    let inventoryDelta = 0;
    let inventoryPlayerId = row.owner_player_id || null;
    const inventoryEffects = [];

    if (plan.action === "retire") {
      if (row.state === "active" && row.current_location === "inventory" && row.owner_player_id) inventoryDelta = -1;
      nextState = "destroyed";
      nextLocation = "unknown";
    } else if (plan.action === "freeze") {
      if (row.state === "active" && row.current_location === "inventory" && row.owner_player_id) inventoryDelta = -1;
      nextState = "locked";
      nextLocation = "safe";
    } else if (plan.action === "unfreeze") {
      if (!row.owner_player_id) throw new Error("Cannot unfreeze without an owner.");
      if (!(row.state === "active" && row.current_location === "inventory")) inventoryDelta = 1;
      nextState = "active";
      nextLocation = "inventory";
    } else if (plan.action === "transfer") {
      const target = await loadPlayerRecord(client, store, playerCache, { username: plan.target_username });
      if (!target) throw new Error(`Transfer target not found: ${plan.target_username}`);
      if (row.owner_player_id && row.owner_player_id !== target.player_id && row.state === "active" && row.current_location === "inventory") {
        const previousOwnerEffect = await applyInventoryDelta(client, store, playerCache, {
          player_id: row.owner_player_id,
          item_type: row.item_type,
          item_category: row.item_category,
          delta: -1,
          action: "item_rollback_transfer",
          request_id: jobId,
          reason: options.reason,
          metadata: { rollback_job_id: jobId, public_item_instance_id: row.public_item_instance_id },
        });
        if (previousOwnerEffect) inventoryEffects.push(previousOwnerEffect);
      }
      const targetOwnerEffect = await applyInventoryDelta(client, store, playerCache, {
        player_id: target.player_id,
        item_type: row.item_type,
        item_category: row.item_category,
        delta: 1,
        action: "item_rollback_transfer",
        request_id: jobId,
        reason: options.reason,
          metadata: { rollback_job_id: jobId, public_item_instance_id: row.public_item_instance_id },
      });
      if (targetOwnerEffect) inventoryEffects.push(targetOwnerEffect);
      nextOwnerId = target.player_id;
      nextState = "active";
      nextLocation = "inventory";
      inventoryPlayerId = null;
    }

    let inventoryEffect = null;
    if (inventoryDelta !== 0 && inventoryPlayerId) {
      inventoryEffect = await applyInventoryDelta(client, store, playerCache, {
        player_id: inventoryPlayerId,
        item_type: row.item_type,
        item_category: row.item_category,
        delta: inventoryDelta,
        action: `item_rollback_${plan.action}`,
        request_id: jobId,
        reason: options.reason,
        metadata: { rollback_job_id: jobId, public_item_instance_id: row.public_item_instance_id },
      });
      if (inventoryEffect) inventoryEffects.push(inventoryEffect);
    }

    const moved = await moveItemInstance(client, store, {
      item_instance_id: row.item_instance_id,
      owner_player_id: nextOwnerId,
      world_id: row.world_id || null,
      state: nextState,
      current_location: nextLocation,
      event_type: plan.action === "retire" ? "retired" : "updated",
      action: `item_rollback_${plan.action}`,
      item_transaction_id: inventoryEffects[0]?.item_transaction_id || null,
      rollback_job_id: jobId,
      reason: options.reason,
      metadata: {
        rollback_type: "item",
        admin_corrected: true,
        target_username: plan.target_username || "",
      },
    });

    const ledgerEffects = inventoryEffects.length > 0
      ? inventoryEffects
      : [{
        player: { player_id: nextOwnerId || row.owner_player_id || null },
        item_transaction_id: null,
        gem_ledger_id: null,
        item_type: row.item_type,
        item_category: row.item_category,
        delta: 0,
        gems_before: null,
        gems_after: null,
        inventory_before_hash: nextOwnerId ? await store.getInventorySnapshotHash(client, nextOwnerId) : null,
        inventory_after_hash: nextOwnerId ? await store.getInventorySnapshotHash(client, nextOwnerId) : null,
      }];

    for (const effect of ledgerEffects) {
      await store.recordTransactionLedger(client, {
        transaction_type: "ROLLBACK_ITEM",
        status: "reversed",
        player_id: effect.player?.player_id || null,
        item_transaction_id: effect.item_transaction_id,
        gem_ledger_id: effect.gem_ledger_id,
        item_type: effect.item_type,
        item_category: effect.item_category,
        quantity: effect.delta,
        gems_before: effect.gems_before,
        gems_after: effect.gems_after,
        inventory_before_hash: effect.inventory_before_hash,
        inventory_after_hash: effect.inventory_after_hash,
        request_id: jobId,
        source: "rollback",
        action: `item_rollback_${plan.action}`,
        item_instances: [moved],
        metadata: {
          rollback_job_id: jobId,
          rollback_applied: true,
          admin_corrected: true,
          rollback_reason: options.reason,
        },
      });
    }

    await saveDirtyPlayerRecords(client, store, playerCache);
    return { ok: true, action: plan.action, item_instance: moved };
  });
}

async function buildTransactionPlan(store, options) {
  const ledgerId = toInt(getOption("--ledger-id", ""), 0);
  const transactionId = cleanText(getOption("--transaction-id", ""));
  if (ledgerId <= 0 && !isUuid(transactionId)) {
    throw new Error("Use --ledger-id <id> or --transaction-id <uuid> for transaction rollback.");
  }
  const params = ledgerId > 0 ? [ledgerId] : [transactionId];
  const result = await store.pool.query(
    `
    SELECT tl.transaction_ledger_id,
           tl.transaction_id,
           tl.transaction_type,
           tl.status,
           tl.player_id,
           player_account.username::text AS username,
           tl.other_player_id,
           other_account.username::text AS other_username,
           tl.world_id,
           w.world_name::text AS world_name,
           tl.item_instance_id,
           tl.public_item_instance_id,
           tl.item_type,
           tl.item_category,
           tl.quantity,
           tl.gems_before,
           tl.gems_after,
           tl.source,
           tl.action,
           tl.metadata,
           tl.server_time
      FROM ${store.table("transaction_ledger")} tl
      LEFT JOIN ${store.table("players")} player_row ON player_row.player_id = tl.player_id
      LEFT JOIN ${store.table("accounts")} player_account ON player_account.account_id = player_row.account_id
      LEFT JOIN ${store.table("players")} other_row ON other_row.player_id = tl.other_player_id
      LEFT JOIN ${store.table("accounts")} other_account ON other_account.account_id = other_row.account_id
      LEFT JOIN ${store.table("worlds")} w ON w.world_id = tl.world_id
     WHERE ${ledgerId > 0 ? "tl.transaction_ledger_id = $1" : "tl.transaction_id = $1::uuid"}
       AND tl.status <> 'reversed'
       AND COALESCE(tl.source, '') <> 'rollback'
     ORDER BY tl.server_time ASC, tl.transaction_ledger_id ASC
    `,
    params
  );
  if (result.rows.length === 0) throw new Error("No reversible transaction ledger rows found.");

  const corrections = [];
  const instanceGroups = new Map();
  for (const row of result.rows) {
    const itemType = cleanKey(row.item_type || "");
    const itemCategory = resolveCategory(itemType, row.item_category || "block");
    const quantity = toInt(row.quantity, 0);
    if (!itemType || quantity === 0 || !row.player_id) continue;
    if (row.item_instance_id) {
      const key = cleanText(row.item_instance_id);
      const group = instanceGroups.get(key) || {
        item_instance_id: row.item_instance_id,
        public_item_instance_id: cleanText(row.public_item_instance_id || ""),
        item_type: itemType,
        item_category: itemCategory,
        positive: null,
        negative: null,
        rows: [],
      };
      if (quantity > 0 && !group.positive) group.positive = row;
      if (quantity < 0 && !group.negative) group.negative = row;
      group.rows.push(row);
      instanceGroups.set(key, group);
    } else {
      corrections.push({
        player_id: row.player_id,
        username: cleanText(row.username || ""),
        world_id: row.world_id || null,
        item_type: itemType,
        item_category: itemCategory,
        delta: -quantity,
        source_ledger_ids: [toInt(row.transaction_ledger_id, 0)],
        tracked: false,
        item_instances: [],
      });
    }
  }

  for (const group of instanceGroups.values()) {
    const fromRow = group.positive;
    const toRow = group.negative;
    if (fromRow?.player_id && (!toRow?.player_id || fromRow.player_id !== toRow.player_id)) {
      corrections.push({
        player_id: fromRow.player_id,
        username: cleanText(fromRow.username || ""),
        world_id: fromRow.world_id || null,
        item_type: group.item_type,
        item_category: group.item_category,
        delta: -1,
        source_ledger_ids: group.rows.map((row) => toInt(row.transaction_ledger_id, 0)).filter(Boolean),
        tracked: true,
        item_instances: [{ item_instance_id: group.item_instance_id, public_item_instance_id: group.public_item_instance_id }],
        instance_target: "remove_from_current_owner",
      });
    }
    if (toRow?.player_id) {
      corrections.push({
        player_id: toRow.player_id,
        username: cleanText(toRow.username || ""),
        world_id: toRow.world_id || null,
        item_type: group.item_type,
        item_category: group.item_category,
        delta: 1,
        source_ledger_ids: group.rows.map((row) => toInt(row.transaction_ledger_id, 0)).filter(Boolean),
        tracked: true,
        item_instances: [{ item_instance_id: group.item_instance_id, public_item_instance_id: group.public_item_instance_id }],
        instance_target: "restore_to_original_owner",
      });
    }
  }

  const mergedCorrections = new Map();
  for (const correction of corrections) {
    if (correction.tracked) {
      mergedCorrections.set(`${correction.player_id}\u0000${correction.delta}\u0000${correction.item_instances[0]?.item_instance_id}`, correction);
      continue;
    }
    const key = `${correction.player_id}\u0000${correction.item_type}\u0000${correction.item_category}`;
    const existing = mergedCorrections.get(key) || { ...correction, delta: 0, source_ledger_ids: [] };
    existing.delta += correction.delta;
    existing.source_ledger_ids.push(...correction.source_ledger_ids);
    mergedCorrections.set(key, existing);
  }

  const finalCorrections = Array.from(mergedCorrections.values()).filter((correction) => correction.delta !== 0);
  return {
    rollback_type: "transaction",
    dry_run: !options.apply,
    reason: options.reason,
    actor_username: options.actor_username,
    target_transaction_id: transactionId || cleanText(result.rows[0]?.transaction_id || ""),
    target_transaction_ledger_id: ledgerId || null,
    original_rows: result.rows.map((row) => ({
      transaction_ledger_id: toInt(row.transaction_ledger_id, 0),
      transaction_id: cleanText(row.transaction_id || ""),
      transaction_type: cleanText(row.transaction_type || ""),
      username: cleanText(row.username || ""),
      item_type: cleanText(row.item_type || ""),
      item_category: cleanText(row.item_category || ""),
      quantity: toInt(row.quantity, 0),
      public_item_instance_id: cleanText(row.public_item_instance_id || ""),
      server_time: normalizeTimestampValue(row.server_time, "transaction server_time", false) || "",
    })),
    corrections: finalCorrections,
    transaction_ledger_ids_to_mark_reversed: result.rows.map((row) => toInt(row.transaction_ledger_id, 0)).filter(Boolean),
    blocking_issues: [],
  };
}

async function applyTransactionPlan(store, plan, options, jobId) {
  return store.withTransaction(async (client) => {
    const playerCache = new Map();
    const applied = [];
    for (const correction of plan.corrections) {
      const entry = await applyInventoryDelta(client, store, playerCache, {
        player_id: correction.player_id,
        username: correction.username,
        world_id: correction.world_id || null,
        item_type: correction.item_type,
        item_category: correction.item_category,
        delta: correction.delta,
        action: "transaction_reversal",
        request_id: jobId,
        reason: options.reason,
        metadata: {
          rollback_job_id: jobId,
          rollback_type: "transaction",
          admin_corrected: true,
          source_ledger_ids: correction.source_ledger_ids,
        },
      });
      if (!entry) continue;

      const movedInstances = [];
      if (correction.tracked) {
        const instance = correction.item_instances[0];
        const targetState = correction.delta > 0 ? "active" : "destroyed";
        const targetLocation = correction.delta > 0 ? "inventory" : "unknown";
        const moved = await moveItemInstance(client, store, {
          item_instance_id: instance.item_instance_id,
          owner_player_id: correction.player_id,
          world_id: correction.world_id || null,
          state: targetState,
          current_location: targetLocation,
          event_type: correction.delta > 0 ? "owner_changed" : "retired",
          action: "transaction_reversal",
          item_transaction_id: entry.item_transaction_id,
          rollback_job_id: jobId,
          reason: options.reason,
          metadata: {
            rollback_type: "transaction",
            admin_corrected: true,
            source_ledger_ids: correction.source_ledger_ids,
            instance_target: correction.instance_target,
          },
        });
        movedInstances.push(moved);
      }

      await store.recordTransactionLedger(client, {
        transaction_type: "ROLLBACK_TRANSACTION_REVERSE",
        status: "reversed",
        player_id: correction.player_id,
        world_id: correction.world_id || null,
        item_transaction_id: entry.item_transaction_id,
        gem_ledger_id: entry.gem_ledger_id,
        item_type: correction.item_type,
        item_category: correction.item_category,
        quantity: correction.delta,
        gems_before: entry.gems_before,
        gems_after: entry.gems_after,
        inventory_before_hash: entry.inventory_before_hash,
        inventory_after_hash: entry.inventory_after_hash,
        request_id: jobId,
        source: "rollback",
        action: "transaction_reversal",
        item_instances: movedInstances,
        metadata: {
          rollback_job_id: jobId,
          rollback_applied: true,
          admin_corrected: true,
          rollback_reason: options.reason,
          source_ledger_ids: correction.source_ledger_ids,
          target_transaction_id: plan.target_transaction_id,
        },
      });

      applied.push({
        username: correction.username,
        item_type: correction.item_type,
        item_category: correction.item_category,
        delta: correction.delta,
        before_amount: entry.before_amount,
        after_amount: entry.after_amount,
        item_instances: movedInstances.map((item) => item.public_item_instance_id),
      });
    }

    await saveDirtyPlayerRecords(client, store, playerCache);
    const reversedRows = await markTransactionLedgerRowsReversed(
      client,
      store,
      plan.transaction_ledger_ids_to_mark_reversed,
      {
        rollback_job_id: jobId,
        rollback_type: "transaction",
        admin_corrected: true,
        rollback_reason: options.reason,
      }
    );
    return { ok: true, applied, reversed_transaction_ledger_rows: reversedRows };
  });
}

function assertApplyIsAllowed(options, plan) {
  if (!options.apply) return;
  if (!options.reason) throw new Error("--apply requires --reason.");
  if (Array.isArray(plan.blocking_issues) && plan.blocking_issues.length > 0) {
    throw new Error(`Rollback has ${plan.blocking_issues.length} blocking issue(s). Run dry-run and fix them first.`);
  }
}

async function runHandler(store, rollbackType, buildPlan, applyPlan, options) {
  const plan = await buildPlan(store, options);
  assertApplyIsAllowed(options, plan);

  if (!options.apply) {
    console.log(JSON.stringify({ ok: true, dry_run: true, plan }, null, 2));
    return;
  }

  const jobId = await insertRollbackJob(store, plan, {
    rollback_type: rollbackType,
    actor_username: options.actor_username,
    reason: options.reason,
    target_username: plan.target_username || "",
    target_world: plan.target_world || "",
    target_item_instance_id: plan.target_item_instance_id || "",
    target_transaction_id: isUuid(plan.target_transaction_id || "") ? plan.target_transaction_id : null,
    target_transaction_ledger_id: plan.target_transaction_ledger_id || null,
    since_at: plan.since_at || null,
    until_at: plan.until_at || null,
    snapshot_version: plan.selected_snapshot?.snapshot_version || null,
  });

  try {
    const result = await applyPlan(store, plan, options, jobId);
    await updateRollbackJob(store, jobId, "applied", result);
    console.log(JSON.stringify({ ok: true, dry_run: false, rollback_job_id: jobId, result }, null, 2));
  } catch (error) {
    await updateRollbackJob(store, jobId, "failed", { ok: false, message: error.message });
    throw error;
  }
}

async function main() {
  if (mode === "help" || mode === "--help" || mode === "-h") usage(0);
  const apply = hasFlag("--apply");
  const reason = cleanText(getOption("--reason", ""));
  const actorUsername = cleanText(getOption("--actor", process.env.USER || process.env.USERNAME || "rollback_tool")) || "rollback_tool";
  const options = {
    apply,
    reason,
    actor_username: actorUsername,
    safe_only: hasFlag("--safe-only"),
  };

  const store = await connectStore();
  try {
    if (mode === "player") {
      await runHandler(store, "player", buildPlayerPlan, applyPlayerPlan, options);
    } else if (mode === "world") {
      await runHandler(store, "world", buildWorldPlan, applyWorldPlan, options);
    } else if (mode === "item") {
      await runHandler(store, "item", buildItemPlan, applyItemPlan, options);
    } else if (mode === "transaction") {
      await runHandler(store, "transaction", buildTransactionPlan, applyTransactionPlan, options);
    } else {
      usage(1);
    }
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(`[rollback] failed: ${error.message}`);
  process.exit(1);
});
