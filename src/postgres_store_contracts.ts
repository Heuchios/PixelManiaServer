/// <reference path="../types/pixelmania-contracts.d.ts" />
"use strict";

import crypto = require("node:crypto");
import net = require("node:net");

import ItemDatabase = require("./server_item_database");

type PostgresRecord = Record<string, unknown>;

const INTEGRITY_HASH_ALGORITHM = "sha256:v1";
const MAX_WORLD_DROP_AMOUNT = 2000;
const DEFAULT_INVENTORY_STACK_LIMIT = ItemDatabase.DEFAULT_STACK_LIMIT || 400;
const MAX_INVENTORY_STACK_LIMIT = ItemDatabase.GEM_CURRENCY_STACK_LIMIT || 100000000000;
const ITEM_INSTANCE_TRACKED_CATEGORIES = new Set(["tool", "back", "hat", "hair", "eyewear", "shirt", "pants", "shoes", "ride"]);
const ITEM_INSTANCE_ACTIVE_STATE = "active";
const ITEM_INSTANCE_STATES = new Set(["active", "consumed", "traded", "destroyed", "dropped", "locked"]);
const ITEM_INSTANCE_LOCATIONS = new Set(["inventory", "vending", "trade", "world_drop", "safe", "display", "shop", "admin", "system", "unknown"]);
const ITEM_INSTANCE_VAGUE_CREATION_SOURCES = new Set(["", "system", "unknown", "item_ledger", "inventory_delta", "update"]);
const ITEM_INSTANCE_EVENT_TYPES = new Set(["created", "reconciled", "owner_changed", "location_changed", "state_changed", "updated", "retired"]);
const PUNISHMENT_TYPES = new Set(["ban", "mute", "trade_ban", "world_ban", "lockout"]);
const PUNISHMENT_SCOPES = new Set(["global", "world"]);
const PLAYER_LEVEL_MIN = 1;
const PLAYER_LEVEL_MAX = 100;
const PLAYER_XP_FIRST_LEVEL = 300;
const TRANSACTION_LEDGER_STATUSES = new Set(["success", "failed", "reversed"]);
const WORLD_OBJECT_CHANGE_ACTIONS = new Set([
  "wooden_entrance_state",
  "door_state",
  "door_move",
  "sign_text",
  "ceiling_lamp_state",
  "world_lock_state",
  "vend_state",
  "vending_list",
  "vending_buy",
  "vending_collect",
  "vending_cancel",
  "vending_break_return",
  "safe_state",
  "safe_deposit",
  "safe_withdraw",
  "safe_break_return",
  "mailbox_state",
  "bulletin_board_state",
  "display_state",
  "display_deposit",
  "display_withdraw",
  "display_break_return",
  "water_well_state",
  "water_well_collect",
  "tackle_box_state",
  "fish_tank_state",
  "duck_feeder_state",
  "dice_roll",
  "anti_punch_state",
  "anti_talk_state",
  "anti_gravity_state",
  "theme_machine_state",
  "cctv_state",
]);

function toObject(value: unknown): PostgresRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PostgresRecord : {};
}

function toInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function cleanName(value: unknown): string {
  return String(value || "").trim();
}

function safeJson(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null) return {};
  if (typeof value !== "object") return { value };
  if (Array.isArray(value)) return { items: value };
  return value as Record<string, unknown>;
}

function clonePlainJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value === undefined ? {} : value));
  } catch {
    return safeJson(value);
  }
}

function stableNormalizeForHash(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return normalizeOptionalTimestamp(value) || value.toISOString();
  if (Array.isArray(value)) return value.map((item) => stableNormalizeForHash(item));
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      normalized[key] = stableNormalizeForHash(source[key]);
    }
    return normalized;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function stableJsonForCompare(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonForCompare(item));
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = stableJsonForCompare(source[key]);
    }
    return result;
  }
  return value;
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(stableNormalizeForHash(value)) ?? "null";
}

function stableJsonString(value: unknown): string {
  return JSON.stringify(stableJsonForCompare(value === undefined ? {} : value)) ?? "null";
}

function integrityHash(value: unknown): string {
  return crypto.createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

function jsonChecksum(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex");
}

function ledgerNullableId(value: unknown): string | null {
  const clean = cleanName(value);
  return clean === "" ? null : clean;
}

function ledgerNullableInteger(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : cleanName(value);
}

function normalizeTransactionLedgerStatus(value: unknown, fallback = "success"): string {
  const clean = cleanName(value).toLowerCase();
  if (TRANSACTION_LEDGER_STATUSES.has(clean)) return clean;
  return TRANSACTION_LEDGER_STATUSES.has(fallback) ? fallback : "success";
}

function normalizeOptionalTimestamp(value: unknown): string | null {
  const raw = cleanName(value);
  if (raw === "") return null;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function buildTransactionLedgerHashPayload(entry: Record<string, unknown> = {}): Record<string, unknown> {
  const e = toObject(entry);
  return {
    algorithm: INTEGRITY_HASH_ALGORITHM,
    transaction_id: ledgerNullableId(e.transaction_id),
    transaction_type: cleanName(e.transaction_type || ""),
    status: normalizeTransactionLedgerStatus(e.status || "success"),
    player_id: ledgerNullableId(e.player_id),
    other_player_id: ledgerNullableId(e.other_player_id),
    world_id: ledgerNullableId(e.world_id),
    item_transaction_id: ledgerNullableInteger(e.item_transaction_id),
    gem_ledger_id: ledgerNullableInteger(e.gem_ledger_id),
    trade_id: ledgerNullableId(e.trade_id),
    vending_transaction_id: ledgerNullableInteger(e.vending_transaction_id),
    shop_purchase_id: ledgerNullableInteger(e.shop_purchase_id),
    admin_action_id: ledgerNullableInteger(e.admin_action_id),
    item_instance_id: ledgerNullableId(e.item_instance_id),
    public_item_instance_id: ledgerNullableId(e.public_item_instance_id),
    item_type: ledgerNullableId(e.item_type),
    item_category: ledgerNullableId(e.item_category),
    quantity: ledgerNullableInteger(e.quantity),
    gems_before: ledgerNullableInteger(e.gems_before),
    gems_after: ledgerNullableInteger(e.gems_after),
    inventory_before_hash: ledgerNullableId(e.inventory_before_hash),
    inventory_after_hash: ledgerNullableId(e.inventory_after_hash),
    ip_address: ledgerNullableId(e.ip_address),
    session_token_hash: ledgerNullableId(e.session_token_hash),
    user_agent: ledgerNullableId(e.user_agent),
    device_info: stableNormalizeForHash(toObject(e.device_info)),
    request_id: ledgerNullableId(e.request_id),
    correlation_id: ledgerNullableId(e.correlation_id),
    source: ledgerNullableId(e.source),
    action: ledgerNullableId(e.action),
    metadata: stableNormalizeForHash(toObject(e.metadata)),
    server_time: normalizeOptionalTimestamp(e.server_time) || ledgerNullableId(e.server_time),
  };
}

function buildTransactionLedgerHash(entry: Record<string, unknown> = {}): string {
  return integrityHash(buildTransactionLedgerHashPayload(entry));
}

function clampStackLimit(value: unknown, fallback = DEFAULT_INVENTORY_STACK_LIMIT): number {
  const fallbackLimit = Math.max(1, toInt(fallback, DEFAULT_INVENTORY_STACK_LIMIT));
  return Math.min(MAX_INVENTORY_STACK_LIMIT, Math.max(1, toInt(value, fallbackLimit)));
}

function resolveItemCategory(itemType: unknown, itemCategory: unknown = ""): string {
  const cleanItemType = cleanName(itemType);
  if (cleanItemType !== "" && typeof ItemDatabase.resolveItemCategory === "function") {
    const resolved = cleanName(ItemDatabase.resolveItemCategory(cleanItemType, itemCategory));
    if (resolved !== "") return resolved;
  }
  return cleanName(itemCategory || "block").toLowerCase();
}

function getInventoryStackLimitForItem(itemType: unknown, fallback = DEFAULT_INVENTORY_STACK_LIMIT): number {
  const cleanItemType = cleanName(itemType);
  if (cleanItemType !== "" && ItemDatabase.hasItem(cleanItemType)) {
    return clampStackLimit(ItemDatabase.getStackLimit(cleanItemType), fallback);
  }
  return clampStackLimit(fallback);
}

function shouldTrackItemInstance(itemType: unknown, itemCategory: unknown = ""): boolean {
  const cleanItemType = cleanName(itemType);
  if (cleanItemType === "") return false;

  const resolvedCategory = resolveItemCategory(cleanItemType, itemCategory);
  const definition = typeof ItemDatabase.getItemDefinition === "function"
    ? ItemDatabase.getItemDefinition(cleanItemType)
    : null;
  if (definition && definition.instance_tracked === false) return false;
  if (definition && (definition.instance_tracked === true || definition.equipable || cleanName(definition.equipment_slot) !== "")) return true;
  if (ITEM_INSTANCE_TRACKED_CATEGORIES.has(resolvedCategory)) return true;
  return getInventoryStackLimitForItem(cleanItemType) <= 1;
}

function normalizeItemInstanceState(value: unknown, fallback = ITEM_INSTANCE_ACTIVE_STATE): string {
  const clean = cleanName(value).toLowerCase();
  if (ITEM_INSTANCE_STATES.has(clean)) return clean;
  return ITEM_INSTANCE_STATES.has(fallback) ? fallback : ITEM_INSTANCE_ACTIVE_STATE;
}

function normalizeItemInstanceLocation(value: unknown, fallback = "inventory"): string {
  const clean = cleanName(value).toLowerCase();
  if (ITEM_INSTANCE_LOCATIONS.has(clean)) return clean;
  return ITEM_INSTANCE_LOCATIONS.has(fallback) ? fallback : "inventory";
}

function normalizeItemInstanceSource(value: unknown, fallback = "system"): string {
  const clean = cleanName(value).toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "");
  return (clean || fallback).slice(0, 80);
}

function isVagueItemInstanceCreationSource(value: unknown): boolean {
  return ITEM_INSTANCE_VAGUE_CREATION_SOURCES.has(normalizeItemInstanceSource(value, ""));
}

function normalizeTransactionLedgerType(entry: unknown = {}): string {
  const e = toObject(entry);
  const source = normalizeLedgerSource(e.source || e.source_type || "");
  const action = cleanName(e.action || "").toLowerCase();
  const itemType = cleanName(e.item_type || e.item_id || "").toLowerCase();
  const itemCategory = cleanName(e.item_category || e.category || "").toLowerCase();
  const delta = toInt(e.delta ?? e.quantity ?? e.amount ?? 0, 0);

  if (source === "shop") return "SHOP_PURCHASE";
  if (source === "trade") return "TRADE_COMPLETE";
  if (source === "vending") {
    if (action.includes("buy") || action.includes("spend") || action.includes("receive") || action.includes("payment")) return "VENDING_BUY";
    if (action.includes("list")) return "VENDING_LIST";
    if (action.includes("cancel")) return "VENDING_CANCEL";
    if (action.includes("collect")) return "VENDING_COLLECT";
    return "VENDING_TRANSACTION";
  }
  if (source === "admin") {
    if (action.includes("remove") || delta < 0) return "ADMIN_REMOVE_ITEM";
    if (action.includes("give") || delta > 0) return "ADMIN_GIVE_ITEM";
    return "ADMIN_ITEM_ACTION";
  }
  if (source === "craft" || source === "crafting") return delta >= 0 ? "CRAFT_OUTPUT" : "CRAFT_INPUT";
  if (source === "furnace") return delta >= 0 ? "FURNACE_OUTPUT" : "FURNACE_INPUT";
  if (source === "fishing" || source === "fish_monger") return delta >= 0 ? "FISHING_REWARD" : "FISHING_COST";
  if (source === "drop_inventory") return "ITEM_DROP";
  if (source === "drop_pickup" || source === "world_drop") return "ITEM_PICKUP";
  if (source === "world_block_place") {
    if (itemType === "world_lock" || itemType.endsWith("_lock") || itemCategory === "lock") return "WORLD_LOCK_PLACE";
    return "WORLD_BLOCK_PLACE";
  }
  if (source === "world_lock_key") return delta >= 0 ? "WORLD_LOCK_KEY_ISSUE" : "WORLD_LOCK_KEY_CONSUME";
  if (source === "world_block_break") return "WORLD_BLOCK_BREAK";
  if (source === "safe") {
    if (action.includes("deposit") || delta < 0) return "SAFE_DEPOSIT";
    if (action.includes("withdraw") || delta > 0) return "SAFE_WITHDRAW";
    return "SAFE_TRANSACTION";
  }
  if (source === "display") {
    if (action.includes("deposit") || delta < 0) return "DISPLAY_DEPOSIT";
    if (action.includes("withdraw") || delta > 0) return "DISPLAY_WITHDRAW";
    return "DISPLAY_TRANSACTION";
  }
  if (source === "event") return "EVENT_REWARD";
  if (source === "quest") return "QUEST_REWARD";
  if (source === "loot_box") return "LOOT_BOX_REWARD";
  if (source === "reward") return "REWARD";
  if (source === "rollback") {
    if (action.includes("restore")) return "ROLLBACK_RESTORE";
    if (action.includes("remove")) return "ROLLBACK_REMOVE";
    if (action.includes("apply")) return "ROLLBACK_APPLY";
    return "ROLLBACK_EVENT";
  }
  return "INVENTORY_DELTA";
}

function normalizeItemInstanceEventType(value: unknown, fallback = "updated"): string {
  const clean = cleanName(value).toLowerCase();
  if (ITEM_INSTANCE_EVENT_TYPES.has(clean)) return clean;
  return ITEM_INSTANCE_EVENT_TYPES.has(fallback) ? fallback : "updated";
}

function generatePublicItemInstanceId(): string {
  return `PM-ITEM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
}

function extractItemInstanceSource(details: unknown, fallback = "system"): string {
  const outer = toObject(details);
  const inner = toObject(outer.details);
  return normalizeItemInstanceSource(outer.source || inner.source || fallback, fallback);
}

function summarizeItemInstanceEventMetadata(value: unknown): Record<string, string> {
  const metadata = toObject(value);
  const summary: Record<string, string> = {};
  for (const key of [
    "reason",
    "source",
    "action",
    "actor_username",
    "username",
    "target_username",
    "request_id",
    "transaction_id",
    "item_type",
    "item_category",
    "world",
    "previous_state",
    "state",
  ]) {
    const clean = cleanName(metadata[key] || "");
    if (clean !== "") summary[key] = clean.slice(0, 160);
  }
  return summary;
}

function normalizeWorldDropPayload(
  drop: PixelMania.WorldDropPayloadInput | Record<string, unknown> = {},
  fallback: PixelMania.WorldDropPayloadInput | Record<string, unknown> = {}
): PixelMania.NormalizedWorldDropPayload | null {
  const raw = toObject(drop);
  const fb = toObject(fallback);
  const dropId = cleanName(raw.drop_id || raw.id || fb.drop_id || "");
  const itemType = cleanName(raw.item_type || raw.item_id || raw.block_type || fb.item_type || fb.item_id || "");
  if (dropId === "" || itemType === "" || !ItemDatabase.hasItem(itemType)) return null;

  const itemCategory = resolveItemCategory(itemType, raw.item_category || raw.category || fb.item_category || fb.category || "");
  const amount = Math.max(0, Math.min(MAX_WORLD_DROP_AMOUNT, toInt(raw.amount ?? raw.quantity ?? fb.amount ?? 0, 0)));
  if (amount <= 0) return null;

  const x = Number(raw.x ?? fb.x ?? 0);
  const y = Number(raw.y ?? fb.y ?? 0);
  const stackGridXRaw = Number(raw.stack_grid_x ?? raw.grid_x ?? fb.stack_grid_x);
  const stackGridYRaw = Number(raw.stack_grid_y ?? raw.grid_y ?? fb.stack_grid_y);
  const pickupDelayRaw = Number(raw.pickup_delay ?? fb.pickup_delay ?? 0);

  return {
    drop_id: dropId,
    item_type: itemType,
    item_category: itemCategory || "block",
    amount,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    stack_grid_x: Number.isFinite(stackGridXRaw) ? Math.trunc(stackGridXRaw) : null,
    stack_grid_y: Number.isFinite(stackGridYRaw) ? Math.trunc(stackGridYRaw) : null,
    pickup_delay: Number.isFinite(pickupDelayRaw) ? Math.max(0, pickupDelayRaw) : 0,
    metadata: safeJson(raw.metadata || fb.metadata || {}),
  };
}

function worldDropRowToPayload(row: PixelMania.WorldDropRowInput | Record<string, unknown> = {}): PixelMania.ActiveWorldDropPayload {
  const data = toObject(row);
  const itemType = cleanName(data.item_type || "");
  const itemCategory = resolveItemCategory(itemType, data.item_category || "block");
  const payload: PixelMania.ActiveWorldDropPayload = {
    drop_id: cleanName(data.drop_id || ""),
    item_type: itemType,
    item_category: itemCategory || "block",
    is_seed: (itemCategory || "block") === "seed",
    amount: Math.max(0, Math.min(MAX_WORLD_DROP_AMOUNT, toInt(data.amount, 0))),
    x: Number.isFinite(Number(data.x)) ? Number(data.x) : 0,
    y: Number.isFinite(Number(data.y)) ? Number(data.y) : 0,
    pickup_delay: Number.isFinite(Number(data.pickup_delay)) ? Math.max(0, Number(data.pickup_delay)) : 0,
  };

  if (data.stack_grid_x !== null && data.stack_grid_x !== undefined) {
    payload.stack_grid_x = Math.trunc(Number(data.stack_grid_x) || 0);
  }
  if (data.stack_grid_y !== null && data.stack_grid_y !== undefined) {
    payload.stack_grid_y = Math.trunc(Number(data.stack_grid_y) || 0);
  }
  return payload;
}

function worldLockRowToPayload(row: PixelMania.WorldLockState | Record<string, unknown> = {}): PixelMania.WorldLockState {
  const data = toObject(row);
  const metadata = safeJson(data.metadata || {});
  const isLocked = Boolean(data.is_locked);
  const cleanLockType = cleanName(metadata.lock_block_type || metadata.lock_type || data.lock_type || "").toLowerCase();
  if (!isLocked || cleanLockType === "" || cleanLockType === "none") return {};

  const ownerName = cleanName(metadata.owner_name || metadata.owner_username || data.owner_username || "").toUpperCase();
  if (ownerName === "") return {};
  const ownerPlayerId = cleanName(metadata.owner_player_id || metadata.owner_profile_id || data.owner_player_id || "");
  const ownerAccountId = cleanName(metadata.owner_account_id || data.owner_account_id || "");

  const lockType = cleanLockType === "super_world_lock" ? "super_world_lock" : "world_lock";
  const rawLockX = Number.isFinite(Number(metadata.lock_grid_x)) ? Number(metadata.lock_grid_x) : Number(data.lock_x);
  const rawLockY = Number.isFinite(Number(metadata.lock_grid_y)) ? Number(metadata.lock_grid_y) : Number(data.lock_y);
  const lockX = Number.isFinite(rawLockX) ? Math.trunc(rawLockX) : 999999;
  const lockY = Number.isFinite(rawLockY) ? Math.trunc(rawLockY) : 999999;
  const allowedPlayers: string[] = Array.isArray(metadata.allowed_players) ? metadata.allowed_players : [];
  const allowedAccountIds: string[] = Array.isArray(metadata.allowed_account_ids) ? metadata.allowed_account_ids : [];
  const allowedPlayerIds: string[] = Array.isArray(metadata.allowed_player_ids) ? metadata.allowed_player_ids : [];
  const playerRoles = toObject(metadata.player_roles) as Record<string, string>;
  const playerRolesByAccountId = toObject(metadata.player_roles_by_account_id) as Record<string, string>;
  const playerRolesByPlayerId = toObject(metadata.player_roles_by_player_id) as Record<string, string>;

  return {
    is_locked: true,
    owner_name: ownerName,
    owner_account_id: ownerAccountId,
    owner_player_id: ownerPlayerId,
    owner_profile_id: ownerPlayerId,
    lock_block_type: lockType,
    lock_type: lockType,
    lock_grid_x: lockX,
    lock_grid_y: lockY,
    allowed_players: allowedPlayers,
    allowed_account_ids: allowedAccountIds,
    allowed_player_ids: allowedPlayerIds,
    player_roles: playerRoles,
    player_roles_by_account_id: playerRolesByAccountId,
    player_roles_by_player_id: playerRolesByPlayerId,
    public_build: Boolean(metadata.public_build),
    trusted_builder_slot_limit: Math.max(0, Math.min(50, toInt(metadata.trusted_builder_slot_limit, 6))),
    trade_key_holder: cleanName(metadata.trade_key_holder || metadata.key_holder || "").toUpperCase(),
    trade_key_holder_account_id: cleanName(metadata.trade_key_holder_account_id || metadata.key_holder_account_id || ""),
    trade_key_holder_player_id: cleanName(metadata.trade_key_holder_player_id || metadata.trade_key_holder_profile_id || metadata.key_holder_player_id || ""),
    trade_key_holder_profile_id: cleanName(metadata.trade_key_holder_player_id || metadata.trade_key_holder_profile_id || metadata.key_holder_player_id || ""),
    trade_key_issued_at: cleanName(metadata.trade_key_issued_at || ""),
    trade_key_last_trade_id: cleanName(metadata.trade_key_last_trade_id || ""),
    trade_key_public_item_instance_id: cleanName(metadata.trade_key_public_item_instance_id || metadata.key_public_item_instance_id || ""),
  };
}

function normalizePunishmentType(value: unknown): string {
  const clean = cleanName(value).toLowerCase();
  return PUNISHMENT_TYPES.has(clean) ? clean : "";
}

function normalizePunishmentScope(value: unknown): string {
  const clean = cleanName(value).toLowerCase();
  return PUNISHMENT_SCOPES.has(clean) ? clean : "global";
}

function normalizePunishmentEndsAt(entry: unknown): string | null {
  const e = toObject(entry);
  const explicitEndsAt = normalizeOptionalTimestamp(e.ends_at || e.expires_at || e.until || "");
  if (explicitEndsAt) return explicitEndsAt;

  const durationMinutes = toInt(e.duration_minutes || e.minutes || 0, 0);
  if (durationMinutes > 0) {
    return new Date(Date.now() + (durationMinutes * 60000)).toISOString();
  }
  return null;
}

function defaultEmailForUsername(username: unknown): string {
  const base = cleanName(username).toLowerCase().replace(/[^a-z0-9_]/g, "");
  return `${base || "player"}@pixelmania.local`;
}

function getXpNeededForLevel(level: unknown): number {
  const safeLevel = Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(level, PLAYER_LEVEL_MIN)));
  if (safeLevel >= PLAYER_LEVEL_MAX) return 0;

  const levelIndex = safeLevel - PLAYER_LEVEL_MIN;
  return PLAYER_XP_FIRST_LEVEL + (levelIndex * 120) + Math.floor(Math.pow(levelIndex, 1.6) * 42);
}

function getCumulativeXpAtLevel(level: unknown): number {
  const safeLevel = Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(level, PLAYER_LEVEL_MIN)));
  let total = 0;
  for (let currentLevel = PLAYER_LEVEL_MIN; currentLevel < safeLevel; currentLevel += 1) {
    total += getXpNeededForLevel(currentLevel);
  }
  return total;
}

function getPlayerTitleForLevel(level: unknown): string {
  const safeLevel = Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(level, PLAYER_LEVEL_MIN)));
  if (safeLevel >= 100) return "Pixel Legend";
  if (safeLevel >= 80) return "Worldsmith";
  if (safeLevel >= 60) return "Architect";
  if (safeLevel >= 40) return "Trailblazer";
  if (safeLevel >= 25) return "Crafter";
  if (safeLevel >= 10) return "Builder";
  return "Explorer";
}

function normalizeProgressionState(state: unknown): Record<string, unknown> {
  const source = toObject(state);
  let level = Math.min(PLAYER_LEVEL_MAX, Math.max(PLAYER_LEVEL_MIN, toInt(source.player_level || source.level, PLAYER_LEVEL_MIN)));
  let xp = Math.max(0, toInt(source.player_xp || source.xp, 0));
  let totalXp = Math.max(0, toInt(source.player_total_xp || source.total_xp, 0));

  if (totalXp <= 0 && (level > PLAYER_LEVEL_MIN || xp > 0)) {
    totalXp = getCumulativeXpAtLevel(level) + xp;
  }

  while (level < PLAYER_LEVEL_MAX) {
    const needed = getXpNeededForLevel(level);
    if (needed <= 0 || xp < needed) break;
    xp -= needed;
    level += 1;
  }

  if (level >= PLAYER_LEVEL_MAX) {
    level = PLAYER_LEVEL_MAX;
    xp = 0;
  }

  return {
    player_level: level,
    player_xp: xp,
    player_xp_needed: getXpNeededForLevel(level),
    player_total_xp: totalXp,
    player_title: cleanName(source.player_title || getPlayerTitleForLevel(level)) || getPlayerTitleForLevel(level),
    last_level_up_at: cleanName(source.last_level_up_at || ""),
  };
}

function normalizeWorldObjectAction(value: unknown): string {
  return cleanName(value).toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

function normalizeWorldObjectType(entry: unknown = {}): string {
  const e = toObject(entry);
  const explicit = normalizeWorldObjectAction(e.object_type || e.type || "");
  if (explicit !== "" && explicit !== "world_interaction_update") return explicit;

  const action = normalizeWorldObjectAction(e.action || "");
  if (action.includes("vend")) return "vending";
  if (action.includes("safe")) return "safe";
  if (action.includes("mailbox")) return "mailbox";
  if (action.includes("bulletin_board")) return "bulletin_board";
  if (action.includes("display")) return "display";
  if (action.includes("water_well")) return "water_well";
  if (action.includes("tackle_box")) return "tackle_box";
  if (action.includes("duck")) return "duck";
  if (action.includes("dice")) return "dice";
  if (action.includes("anti_punch")) return "anti_punch";
  if (action.includes("anti_talk")) return "anti_talk";
  if (action.includes("anti_gravity")) return "anti_gravity";
  if (action.includes("theme_machine")) return "theme_machine";
  if (action.includes("cctv")) return "cctv";
  if (action === "world_lock_state" || action.includes("world_lock")) return "world_lock";
  if (action === "sign_text" || action.includes("sign")) return "sign";
  if (action === "door_state" || action.includes("door")) return "door";
  if (action === "wooden_entrance_state" || action.includes("entrance")) return "wooden_entrance";
  if (action.includes("lamp") || action.includes("toggle")) return "toggle";
  return "interaction";
}

function normalizeWorldObjectId(entry: unknown = {}, worldName: unknown = "", objectType: unknown = ""): string {
  const e = toObject(entry);
  const explicit = cleanName(e.object_id || e.id || "");
  if (explicit !== "") return explicit.slice(0, 160);

  const details = toObject(e.details);
  const doorId = cleanName(e.door_id || details.door_id || "");
  if (doorId !== "") return `door:${doorId}`.slice(0, 160);

  const cleanObjectType = normalizeWorldObjectAction(objectType) || normalizeWorldObjectType(e);
  if (cleanObjectType === "world_lock") {
    const world = cleanName(e.world || worldName || "");
    return `${world || "world"}:world_lock`.slice(0, 160);
  }

  const x = Number.isFinite(Number(e.x)) ? Math.trunc(Number(e.x)) : null;
  const y = Number.isFinite(Number(e.y)) ? Math.trunc(Number(e.y)) : null;
  if (x !== null && y !== null) return `${cleanObjectType}:${x}:${y}`.slice(0, 160);
  return `${cleanObjectType}:unknown`.slice(0, 160);
}

function shouldTreatAsWorldObjectChange(entry: unknown = {}): boolean {
  const e = toObject(entry);
  if (cleanName(e.object_type || e.object_id || "") !== "") return true;
  if (Object.keys(toObject(e.old_data)).length > 0 || Object.keys(toObject(e.new_data)).length > 0) return true;
  const action = normalizeWorldObjectAction(e.action || "");
  return WORLD_OBJECT_CHANGE_ACTIONS.has(action);
}

function extractWorldObjectJournalMap(
  worldState: unknown = {},
  fallbackWorldName: unknown = ""
): Map<string, Record<string, unknown>> {
  const state = toObject(worldState);
  const cleanWorldName = cleanName(state.world_name || fallbackWorldName || "");
  const entries = new Map<string, Record<string, unknown>>();

  const worldLock = toObject(state.world_lock);
  if (Object.keys(worldLock).length > 0) {
    const key = `world_lock:${cleanWorldName || "world"}`;
    entries.set(key, {
      object_type: "world_lock",
      object_id: `${cleanWorldName || "world"}:world_lock`,
      x: Number.isFinite(Number(worldLock.lock_grid_x)) ? Math.trunc(Number(worldLock.lock_grid_x)) : null,
      y: Number.isFinite(Number(worldLock.lock_grid_y)) ? Math.trunc(Number(worldLock.lock_grid_y)) : null,
      data: clonePlainJson(worldLock),
    });
  }

  const interactions = Array.isArray(state.interactions) ? state.interactions : [];
  for (const rawInteraction of interactions) {
    const interaction = toObject(rawInteraction);
    const action = normalizeWorldObjectAction(interaction.action || "");
    if (!WORLD_OBJECT_CHANGE_ACTIONS.has(action)) continue;

    const objectType = normalizeWorldObjectType(interaction);
    const objectId = normalizeWorldObjectId(interaction, cleanWorldName, objectType);
    const key = `${objectType}:${objectId}`;
    entries.set(key, {
      object_type: objectType,
      object_id: objectId,
      x: Number.isFinite(Number(interaction.x)) ? Math.trunc(Number(interaction.x)) : null,
      y: Number.isFinite(Number(interaction.y)) ? Math.trunc(Number(interaction.y)) : null,
      data: clonePlainJson(interaction),
    });
  }

  return entries;
}

function isUuid(value: unknown): boolean {
  const clean = cleanName(value);
  if (clean === "") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean);
}

function normalizeLedgerSource(value: unknown): string {
  const raw = cleanName(value).toLowerCase();
  if (raw.includes("trade")) return "trade";
  if (raw.includes("vending") || raw.includes("vend")) return "vending";
  if (raw.includes("world_drop")) return "world_drop";
  if (raw.includes("safe")) return "safe";
  if (raw.includes("display")) return "display";
  if (raw.includes("shop")) return "shop";
  if (raw.includes("event")) return "event";
  if (raw.includes("quest")) return "quest";
  if (raw.includes("crafting") || raw.includes("craft")) return "crafting";
  if (raw.includes("loot_box") || raw.includes("lootbox")) return "loot_box";
  if (raw.includes("reward")) return "reward";
  if (raw.includes("seed_place")) return "seed_place";
  if (raw.includes("seed_splice")) return "seed_splice";
  if (raw.includes("seed_harvest")) return "seed_harvest";
  if (raw.includes("drop_pickup")) return "drop_pickup";
  if (raw.includes("drop_create") || raw.includes("drop_from_inventory") || raw.includes("drop_inventory")) return "drop_inventory";
  if (raw.includes("furnace")) return "furnace";
  if (raw.includes("fishing")) return "fishing";
  if (raw.includes("fish_monger")) return "fish_monger";
  if (raw.includes("admin") || raw.includes("developer")) return "admin";
  if (raw.includes("rollback")) return "rollback";
  if (raw.includes("world_block_break")) return "world_block_break";
  if (raw.includes("world_block_place")) return "world_block_place";
  if (raw.includes("world_lock_conversion") || raw.includes("convert_world_lock")) return "world_lock_conversion";
  if (raw.includes("world_lock_key") || raw.includes("world_key")) return "world_lock_key";
  if (raw.includes("entrance")) return "world_interaction";
  if (raw.includes("world_interaction")) return "world_interaction";
  return "system";
}

function normalizeSecuritySeverity(value: unknown): string {
  const raw = cleanName(value).toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "critical") return raw;
  if (raw === "info" || raw === "notice" || raw === "debug") return "low";
  if (raw === "warn" || raw === "warning") return "medium";
  if (raw === "error") return "high";
  return "medium";
}

function normalizeIp(value: unknown): string {
  const clean = cleanName(value);
  return net.isIP(clean) ? clean : "";
}

const PostgresContracts = {
  buildTransactionLedgerHash,
  buildTransactionLedgerHashPayload,
  clampStackLimit,
  clonePlainJson,
  defaultEmailForUsername,
  extractItemInstanceSource,
  extractWorldObjectJournalMap,
  generatePublicItemInstanceId,
  getCumulativeXpAtLevel,
  getInventoryStackLimitForItem,
  getPlayerTitleForLevel,
  getXpNeededForLevel,
  integrityHash,
  isUuid,
  isVagueItemInstanceCreationSource,
  jsonChecksum,
  ledgerNullableId,
  ledgerNullableInteger,
  normalizeIp,
  normalizeItemInstanceEventType,
  normalizeItemInstanceLocation,
  normalizeItemInstanceSource,
  normalizeItemInstanceState,
  normalizeLedgerSource,
  normalizeOptionalTimestamp,
  normalizeProgressionState,
  normalizePunishmentEndsAt,
  normalizePunishmentScope,
  normalizePunishmentType,
  normalizeSecuritySeverity,
  normalizeTransactionLedgerStatus,
  normalizeTransactionLedgerType,
  normalizeWorldObjectAction,
  normalizeWorldDropPayload,
  normalizeWorldObjectId,
  normalizeWorldObjectType,
  resolveItemCategory,
  safeJson,
  shouldTrackItemInstance,
  shouldTreatAsWorldObjectChange,
  stableJsonForCompare,
  stableJsonString,
  stableJsonStringify,
  stableNormalizeForHash,
  summarizeItemInstanceEventMetadata,
  worldDropRowToPayload,
  worldLockRowToPayload,
};

export = PostgresContracts;
