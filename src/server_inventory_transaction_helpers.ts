"use strict";

type JsonRecord = Record<string, unknown>;
type InventoryDelta = JsonRecord;
type InventoryReward = JsonRecord;

interface ItemDatabaseLike {
  CATEGORY_TO_FIELD?: Record<string, string>;
  FIELD_TO_CATEGORY?: Record<string, string>;
  hasItem(itemId: string): boolean;
  canStoreItemInCategory(itemId: string, category: string): boolean;
  getStackLimit(itemId: string): number;
}

interface InventoryContractsLike {
  buildInventoryDeltaSource(input: {
    itemType: string;
    itemCategory: string;
    delta: number;
    expectedBeforeAmount?: number;
    stackLimit?: number;
  }): InventoryDelta;
  buildInventoryDeltaClientPayload(input: {
    itemType: string;
    itemCategory: string;
    delta: number;
    stackLimit: number;
    afterCount?: number;
  }): JsonRecord;
  buildInventoryTransactionResultResponse(payload: unknown, username: string): JsonRecord;
}

interface InventoryTransactionHelpersConfig {
  itemDatabase: ItemDatabaseLike;
  inventoryContracts: InventoryContractsLike;
  cleanAccountName(value: unknown): string;
  clampInteger(value: unknown, min: number, max: number): number;
  clampString(value: unknown, limit?: number): string;
  resolveInventoryCategory(itemId: string, requestedCategory?: unknown): string;
  getInventoryCount(state: unknown, itemId: string, itemCategory: string): number;
  makeRequestId(data: unknown): string;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function createServerInventoryTransactionHelpers(config: InventoryTransactionHelpersConfig) {
  const itemDatabase = config.itemDatabase;
  const inventoryContracts = config.inventoryContracts;

  function buildInventoryDeltasBetweenStates(beforeState: unknown, afterState: unknown): InventoryDelta[] {
    const deltas: InventoryDelta[] = [];
    const seen = new Set<string>();
    const fields = Object.values(itemDatabase.CATEGORY_TO_FIELD || {});

    for (const field of fields) {
      const beforeInventory = isRecord(beforeState) && isRecord(beforeState[field]) ? beforeState[field] as JsonRecord : {};
      const afterInventory = isRecord(afterState) && isRecord(afterState[field]) ? afterState[field] as JsonRecord : {};
      for (const itemId of Object.keys(beforeInventory).concat(Object.keys(afterInventory))) {
        const cleanItemId = config.clampString(itemId || "");
        const seenKey = `${field}\u0000${cleanItemId}`;
        if (cleanItemId === "" || seen.has(seenKey)) continue;
        seen.add(seenKey);
        if (!itemDatabase.hasItem(cleanItemId)) continue;

        const fallbackCategory = itemDatabase.FIELD_TO_CATEGORY?.[field] || config.resolveInventoryCategory(cleanItemId);
        const itemCategory = config.resolveInventoryCategory(cleanItemId, fallbackCategory);
        if (!itemDatabase.canStoreItemInCategory(cleanItemId, itemCategory)) continue;

        const beforeAmount = config.getInventoryCount(beforeState, cleanItemId, itemCategory);
        const afterAmount = config.getInventoryCount(afterState, cleanItemId, itemCategory);
        const delta = afterAmount - beforeAmount;
        if (delta === 0) continue;

        deltas.push(inventoryContracts.buildInventoryDeltaSource({
          itemType: cleanItemId,
          itemCategory,
          delta,
          expectedBeforeAmount: beforeAmount,
          stackLimit: itemDatabase.getStackLimit(cleanItemId),
        }));
      }
    }

    return deltas;
  }

  function buildInventoryDeltaClientPayloads(deltas: unknown = [], state: unknown = null): JsonRecord[] {
    if (!Array.isArray(deltas) || deltas.length === 0) return [];

    const payloads: JsonRecord[] = [];
    const seen = new Set<string>();
    for (const rawDelta of deltas) {
      if (!isRecord(rawDelta)) continue;

      const itemType = config.clampString(rawDelta.item_type || rawDelta.item_id || "");
      if (itemType === "" || !itemDatabase.hasItem(itemType)) continue;

      const itemCategory = config.resolveInventoryCategory(itemType, rawDelta.item_category || rawDelta.category || "");
      if (!itemDatabase.canStoreItemInCategory(itemType, itemCategory)) continue;

      const stackLimit = itemDatabase.getStackLimit(itemType);
      const delta = config.clampInteger(rawDelta.delta || 0, -stackLimit, stackLimit);
      if (delta === 0) continue;

      const key = `${itemCategory}\u0000${itemType}`;
      if (seen.has(key)) continue;
      seen.add(key);

      payloads.push(inventoryContracts.buildInventoryDeltaClientPayload({
        itemType,
        itemCategory,
        delta,
        stackLimit,
        afterCount: isRecord(state) ? config.getInventoryCount(state, itemType, itemCategory) : undefined,
      }));
    }

    return payloads;
  }

  function combineRewardEntries(rewards: unknown): InventoryReward[] {
    const combined = new Map<string, InventoryReward>();
    for (const rawReward of Array.isArray(rewards) ? rewards : []) {
      if (!isRecord(rawReward)) continue;
      const itemId = config.clampString(rawReward.item_id || "");
      if (itemId === "" || !itemDatabase.hasItem(itemId)) continue;
      const itemCategory = config.resolveInventoryCategory(itemId, rawReward.item_category || rawReward.category || "");
      if (!itemDatabase.canStoreItemInCategory(itemId, itemCategory)) continue;
      const amount = config.clampInteger(rawReward.amount || 0, 0, itemDatabase.getStackLimit(itemId));
      if (amount <= 0) continue;
      const key = `${itemCategory}:${itemId}`;
      const existing = combined.get(key) || { item_id: itemId, item_category: itemCategory, amount: 0 };
      existing.amount = config.clampInteger(Number(existing.amount || 0) + amount, 0, itemDatabase.getStackLimit(itemId));
      combined.set(key, existing);
    }
    return Array.from(combined.values());
  }

  function getPostgresInventoryFailureMessage(result: unknown, fallback = "Server inventory changed. Try again."): string {
    const raw = toRecord(result);
    const reason = String(raw.reason || "");
    if (reason === "postgres_unavailable") return "PostgreSQL is not ready.";
    if (reason === "insufficient_inventory") {
      const item = config.clampString(raw.item_type || "that item");
      return `Not enough ${item}.`;
    }
    if (reason === "insufficient_capacity") {
      const item = config.clampString(raw.item_type || "that item");
      return `Your inventory cannot hold ${item}.`;
    }
    if (reason === "world_drop_item_instances_pending") {
      // The drop is still in the world and was not consumed. Tell the player to
      // retry rather than implying their item is gone.
      const item = config.clampString(raw.item_type || "that item");
      return `${item} is not ready to collect yet. It is still in the world - try again in a moment.`;
    }
    if (
      reason === "insufficient_item_instances" ||
      reason === "insufficient_locked_item_instances" ||
      reason === "missing_world_drop_item_instances" ||
      reason === "missing_item_instance_source" ||
      reason === "trade_missing_item_instances" ||
      reason === "vending_missing_item_instances" ||
      reason === "vending_payment_missing_item_instances"
    ) {
      const item = config.clampString(raw.item_type || "that item");
      return `Tracked item data is missing for ${item}.`;
    }
    if (reason === "player_not_found" || reason === "invalid_username") return "Could not load your server inventory.";
    if (reason === "database_error") return "PostgreSQL rejected the inventory update.";
    return fallback;
  }

  function buildInventoryTransactionResultResponse(payload: unknown): JsonRecord {
    const raw = toRecord(payload);
    const username = config.cleanAccountName(raw.username || "");
    const response = inventoryContracts.buildInventoryTransactionResultResponse(raw, username);
    if (
      !isRecord(response.player_data) ||
      Object.keys(response.player_data).length === 0
    ) {
      delete response.player_data;
    }
    return response;
  }

  function buildInventoryTransactionRejectedPayload(data: unknown, message: unknown): JsonRecord {
    const raw = toRecord(data);
    const payload: JsonRecord = {
      ok: false,
      request_id: config.makeRequestId(raw),
      action: String(raw.action || ""),
      message: String(message || ""),
    };

    const rejectedWorld = String(raw.world || "").trim();
    if (rejectedWorld !== "") {
      payload.world = rejectedWorld;
    }

    const x = Number(raw.x);
    const y = Number(raw.y);
    if (Number.isFinite(x)) {
      payload.x = Math.trunc(x);
    }
    if (Number.isFinite(y)) {
      payload.y = Math.trunc(y);
    }

    const seedType = String(raw.seed_type || "").trim();
    if (seedType !== "") {
      payload.seed_type = seedType;
    }
    payload.mature = Boolean(raw.mature);
    payload.mutated = Boolean(raw.mutated);

    return payload;
  }

  return {
    buildInventoryDeltaClientPayloads,
    buildInventoryDeltasBetweenStates,
    buildInventoryTransactionRejectedPayload,
    buildInventoryTransactionResultResponse,
    combineRewardEntries,
    getPostgresInventoryFailureMessage,
  };
}

export = {
  createServerInventoryTransactionHelpers,
};
