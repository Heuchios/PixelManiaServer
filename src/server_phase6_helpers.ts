/// <reference path="../types/pixelmania-contracts.d.ts" />
"use strict";

type PacketRecord = Record<string, unknown>;

interface GridPosition {
  x: number;
  y: number;
}

interface PlayerLike {
  id?: unknown;
  name?: unknown;
  world?: unknown;
  client_version?: unknown;
}

interface DropLike extends PacketRecord {
  drop_id?: unknown;
  id?: unknown;
  item_type?: unknown;
  item_id?: unknown;
  item_category?: unknown;
  category?: unknown;
  is_seed?: unknown;
  amount?: unknown;
  x?: unknown;
  y?: unknown;
  stack_grid_x?: unknown;
  stack_grid_y?: unknown;
  status?: unknown;
}

interface WorldStateLike {
  drops?: Map<unknown, unknown>;
}

interface PacketContractsLike {
  isBulkDropPickupRequested(data: unknown): boolean;
  isDropWorldUpdatePayload(message: unknown): boolean;
  isDropRemoveWorldUpdatePayload(message: unknown): boolean;
}

interface ItemDatabaseLike {
  hasItem(itemType: unknown): boolean;
  isDropableItem(itemType: unknown): boolean;
  canStoreItemInCategory(itemType: unknown, itemCategory: unknown): boolean;
}

interface DeltaEntry {
  item_type: string;
  item_category: string;
  delta: number;
}

interface WorldDensityBatchProfile {
  interval_ms: number;
  max_items: number;
}

interface Phase6HelperConfig {
  packetContracts: PacketContractsLike;
  itemDatabase: ItemDatabaseLike;
  maxDropCreateDistancePixels: number;
  maxDropTileAmount: number;
  maxDropIdLength: number;
  maxBulkDropPickupIds: number;
  maxItemIdLength: number;
  maxItemCategoryLength: number;
  worldUpdateBatchingEnabled: boolean;
  worldUpdateBatchMinClientVersion: string;
  worldUpdateBatchMaxItems: number;
  worldUpdateBatchIntervalMs: number;
  playerPositionBroadcastIntervalMs: number;
  playerPositionBatchMaxItems: number;
  playerPositionIdleHeartbeatMs: number;
  tileSize: number;
  cleanWorld(value: unknown): string;
  cleanName(value: unknown): string;
  clampString(value: unknown, limit?: number): string;
  clampInteger(value: unknown, min: number, max: number): number;
  resolveInventoryCategory(itemType: unknown, requestedCategory?: unknown): string;
  compareVersions(a: unknown, b: unknown): number | null;
  getWorldPopulationCount(worldName: unknown): number;
  getWorldPopulationForBatching(worldName: unknown): number;
  isGridInWorld(x: unknown, y: unknown): boolean;
  isPlayerNearPoint(player: unknown, x: unknown, y: unknown, maxDistancePixels: number): boolean;
  getDropGridFromPosition(position: unknown): GridPosition | null | undefined;
  getDropStackGridFromDrop(drop: unknown): GridPosition | null | undefined;
  isDropGridBlockedByBlock(worldName: unknown, grid: unknown): boolean;
  ensureWorldState(worldName: unknown): WorldStateLike;
  cleanDropIdList(rawIds: unknown, maxIds?: number): string[];
  sendActionRejected(socket: unknown, action: string, message: string, extra?: PacketRecord): boolean | void;
}

function isRecord(value: unknown): value is PacketRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toRecord(value: unknown): PacketRecord {
  return isRecord(value) ? value : {};
}

function asDrop(value: unknown): DropLike {
  return toRecord(value) as DropLike;
}

function getDropsMap(state: WorldStateLike | null | undefined): Map<unknown, unknown> {
  return state?.drops instanceof Map ? state.drops : new Map();
}

function getNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createServerPhase6Helpers(config: Phase6HelperConfig) {
  function validateDropCreateAgainstServerState(socket: unknown, player: unknown, update: unknown): boolean {
    const raw = asDrop(update);
    if (!config.itemDatabase.hasItem(raw.item_type)) {
      config.sendActionRejected(socket, "world_item_drop_create", "That item does not exist on the server.");
      return false;
    }

    if (!config.itemDatabase.isDropableItem(raw.item_type)) {
      config.sendActionRejected(socket, "world_item_drop_create", "That item cannot be dropped.");
      return false;
    }

    if (!config.itemDatabase.canStoreItemInCategory(raw.item_type, raw.item_category)) {
      config.sendActionRejected(socket, "world_item_drop_create", "That item category does not match the server.");
      return false;
    }

    if (!config.isPlayerNearPoint(player, raw.x, raw.y, config.maxDropCreateDistancePixels)) {
      config.sendActionRejected(socket, "world_item_drop_create", "Drop closer to your player.");
      return false;
    }

    const dropGrid = raw.stack_grid_x !== undefined && raw.stack_grid_y !== undefined
      ? { x: Math.trunc(getNumber(raw.stack_grid_x)), y: Math.trunc(getNumber(raw.stack_grid_y)) }
      : config.getDropGridFromPosition(raw);
    if (config.isDropGridBlockedByBlock(raw.world, dropGrid)) {
      config.sendActionRejected(socket, "world_item_drop_create", "Can't drop on a block.");
      return false;
    }

    return true;
  }

  function validateDropUpdateAgainstServerState(socket: unknown, player: unknown, worldName: unknown, update: unknown): boolean {
    const raw = asDrop(update);
    const state = config.ensureWorldState(worldName);
    const drop = asDrop(getDropsMap(state).get(raw.drop_id));
    if (!isRecord(drop) || Object.keys(drop).length === 0) {
      config.sendActionRejected(socket, "world_item_drop_update", "That drop no longer exists.");
      return false;
    }

    if (
      Object.prototype.hasOwnProperty.call(raw, "amount") ||
      Object.prototype.hasOwnProperty.call(raw, "x") ||
      Object.prototype.hasOwnProperty.call(raw, "y")
    ) {
      config.sendActionRejected(socket, "world_item_drop_update", "Drop movement and amounts are server controlled.");
      return false;
    }

    if (!config.isPlayerNearPoint(player, drop.x, drop.y, config.maxDropCreateDistancePixels)) {
      config.sendActionRejected(socket, "world_item_drop_update", "Too far away.");
      return false;
    }

    return true;
  }

  function shouldUseBulkDropPickup(data: unknown = {}): boolean {
    return config.packetContracts.isBulkDropPickupRequested(data);
  }

  function appendSameTileBulkDropIds(targetIds: string[], worldName: unknown, stackGrid: GridPosition | null | undefined): string[] {
    if (!stackGrid || !config.isGridInWorld(stackGrid.x, stackGrid.y)) return targetIds;
    const state = config.ensureWorldState(worldName);
    const seen = new Set(targetIds);
    for (const [candidateKey, candidateRaw] of getDropsMap(state).entries()) {
      const candidateDrop = asDrop(candidateRaw);
      const candidateAmount = config.clampInteger(candidateDrop.amount || 0, 0, config.maxDropTileAmount);
      const candidateStatus = String(candidateDrop.status || "active").trim().toLowerCase();
      if (candidateAmount <= 0 || candidateStatus !== "active") continue;
      const candidateGrid = config.getDropStackGridFromDrop(candidateDrop);
      if (!candidateGrid || candidateGrid.x !== stackGrid.x || candidateGrid.y !== stackGrid.y) continue;
      const candidateDropId = config.clampString(candidateDrop.drop_id || candidateKey || "", config.maxDropIdLength);
      if (candidateDropId === "" || seen.has(candidateDropId)) continue;
      seen.add(candidateDropId);
      targetIds.push(candidateDropId);
      if (targetIds.length >= config.maxBulkDropPickupIds) break;
    }
    return targetIds;
  }

  function makeBulkDropPickupFailure(dropId: unknown, reason: unknown, message: unknown, extra: PacketRecord = {}): PacketRecord {
    return {
      ok: false,
      drop_id: config.clampString(dropId || "", config.maxDropIdLength),
      reason: config.clampString(reason || "failed", 64),
      message: config.clampString(message || "Could not pick up that drop.", 180),
      ...extra,
    };
  }

  function getPreparedDropPickupFailureMessage(plan: unknown): string {
    const raw = toRecord(plan);
    if (!isRecord(plan)) return "That drop is not available.";
    if (raw.reason === "inventory_full") return "Inventory full.";
    if (raw.reason === "inventory_unavailable") return "Could not add that item to your server inventory.";
    if (raw.reason === "too_far") return "Too far away from that drop.";
    if (raw.reason === "wrong_world") return "Join that world before sending actions for it.";
    if (raw.reason === "position_unavailable") return "Player position is not ready.";
    return "That drop is not available.";
  }

  function addBulkPickupDelta(deltaMap: Map<string, DeltaEntry>, itemType: unknown, itemCategory: unknown, amount: unknown): void {
    const cleanType = config.clampString(itemType || "", config.maxItemIdLength);
    const cleanCategory = config.clampString(itemCategory || "", config.maxItemCategoryLength);
    const safeAmount = config.clampInteger(amount || 0, 0, config.maxDropTileAmount);
    if (cleanType === "" || cleanCategory === "" || safeAmount <= 0) return;
    const key = `${cleanCategory}:${cleanType}`;
    if (!deltaMap.has(key)) {
      deltaMap.set(key, { item_type: cleanType, item_category: cleanCategory, delta: 0 });
    }
    const entry = deltaMap.get(key);
    if (entry) entry.delta += safeAmount;
  }

  function makeBulkDropPickupWorldResultPayload(
    worldName: unknown,
    player: PlayerLike,
    dropIds: unknown,
    pickupResults: unknown,
    worldUpdates: unknown,
    successAmount: unknown
  ): PacketRecord & {
    drop_ids: string[];
    removed_drop_ids: string[];
    updated_drops: PixelMania.DropPickupWorldUpdatePayload[];
  } {
    const removedDropIds: string[] = [];
    const updatedDrops: PixelMania.DropPickupWorldUpdatePayload[] = [];
    const seenRemoved = new Set<string>();
    const safeWorld = config.cleanWorld(worldName || "START");
    const updateEntries = Array.isArray(worldUpdates) ? worldUpdates : [];

    for (const entry of updateEntries) {
      const entryRecord = toRecord(entry);
      const payload = isRecord(entryRecord.payload) ? entryRecord.payload : entryRecord;
      if (!isRecord(payload)) continue;
      const dropId = config.clampString(payload.drop_id || "", config.maxDropIdLength);
      if (dropId === "") continue;
      const packetType = String(payload.type || "").trim().toLowerCase();
      const remainingRaw = Number(payload.remaining_amount ?? payload.remaining ?? payload.amount ?? 0);
      const remaining = Number.isFinite(remainingRaw) ? Math.max(0, Math.trunc(remainingRaw)) : 0;
      const removed = payload.removed === true || packetType.includes("remove") || remaining <= 0;
      if (removed) {
        if (!seenRemoved.has(dropId)) {
          seenRemoved.add(dropId);
          removedDropIds.push(dropId);
        }
        continue;
      }
      updatedDrops.push({
        type: "world_item_drop_update",
        world: config.cleanWorld(payload.world || safeWorld),
        drop_id: dropId,
        item_type: config.clampString(payload.item_type || payload.item_id || "", config.maxItemIdLength),
        item_category: config.clampString(payload.item_category || payload.category || "", config.maxItemCategoryLength),
        amount: config.clampInteger(payload.amount ?? payload.remaining ?? remaining, 0, config.maxDropTileAmount),
        remaining,
        remaining_amount: remaining,
        requested_by: player.id as string,
        requested_by_name: config.cleanName(player.name),
      });
    }

    const successfulIds: string[] = [];
    const seenSuccess = new Set<string>();
    const resultEntries = Array.isArray(pickupResults) ? pickupResults : [];
    for (const resultRaw of resultEntries) {
      const result = toRecord(resultRaw);
      if (result.ok !== true) continue;
      const dropId = config.clampString(result.drop_id || "", config.maxDropIdLength);
      if (dropId === "" || seenSuccess.has(dropId)) continue;
      seenSuccess.add(dropId);
      successfulIds.push(dropId);
    }
    const cleanRequestedIds = config.cleanDropIdList(dropIds, config.maxBulkDropPickupIds);
    const allIds = config.cleanDropIdList(successfulIds.length > 0 ? successfulIds : cleanRequestedIds, config.maxBulkDropPickupIds);
    const fallbackDropId = removedDropIds[0] || updatedDrops[0]?.drop_id || allIds[0] || cleanRequestedIds[0] || "";

    return {
      type: "world_item_drop_remove",
      world: safeWorld,
      drop_id: fallbackDropId,
      drop_ids: allIds,
      removed_drop_ids: removedDropIds,
      updated_drops: updatedDrops,
      bulk_pickup: true,
      amount: config.clampInteger(successAmount || 0, 0, config.maxDropTileAmount * config.maxBulkDropPickupIds),
      picked_count: allIds.length,
      pickup_results: resultEntries,
      requested_by: player.id,
      requested_by_name: config.cleanName(player.name),
      _server_inventory_update_applied: true,
      _apply_pickup_inventory: false,
    };
  }

  function clampBatchMaxItems(rawMaxItems: unknown, fallback = 1): number {
    return Math.max(1, Math.max(1, Math.trunc(Number(rawMaxItems || fallback) || fallback)));
  }

  function makeWorldDensityBatchProfile(worldName: unknown, baseIntervalMs: unknown, baseMaxItems: unknown): WorldDensityBatchProfile {
    const population = Math.max(0, config.getWorldPopulationForBatching(worldName));
    const baseInterval = Math.max(0, Math.trunc(Number(baseIntervalMs) || 0));
    const baseMax = clampBatchMaxItems(baseMaxItems, 1);

    if (population <= 1) {
      return {
        interval_ms: 0,
        max_items: Math.max(1, Math.floor(baseMax * 0.5)),
      };
    }

    if (population <= 3) {
      return {
        interval_ms: baseInterval,
        max_items: Math.max(1, Math.floor(baseMax * 0.6)),
      };
    }

    if (population <= 8) {
      return {
        interval_ms: baseInterval,
        max_items: baseMax,
      };
    }

    if (population <= 20) {
      return {
        interval_ms: baseInterval + 4,
        max_items: Math.min(128, Math.floor(baseMax * 1.25)),
      };
    }

    return {
      interval_ms: baseInterval + 8,
      max_items: Math.min(256, Math.floor(baseMax * 1.75)),
    };
  }

  function getAdaptivePlayerPositionBatchProfile(worldName: unknown): WorldDensityBatchProfile {
    return makeWorldDensityBatchProfile(
      worldName,
      config.playerPositionBroadcastIntervalMs,
      config.playerPositionBatchMaxItems
    );
  }

  function getAdaptiveWorldUpdateBatchProfile(worldName: unknown): WorldDensityBatchProfile {
    return makeWorldDensityBatchProfile(
      worldName,
      config.worldUpdateBatchIntervalMs,
      config.worldUpdateBatchMaxItems
    );
  }

  function getPlayerPositionHeartbeatIntervalMs(worldName: unknown): number {
    const population = Math.max(0, config.getWorldPopulationForBatching(worldName));
    const baseHeartbeatMs = Math.max(100, Math.trunc(Number(config.playerPositionIdleHeartbeatMs) || 100));
    if (population <= 1) return baseHeartbeatMs * 10;
    if (population <= 4) return baseHeartbeatMs * 5;
    if (population <= 8) return baseHeartbeatMs * 2;
    return baseHeartbeatMs;
  }

  function buildClientMovementGuidance(worldName: unknown): PacketRecord {
    const cleanWorldName = config.cleanWorld(worldName || "START");
    const heartbeatIntervalMs = Math.max(0, Math.trunc(Number(getPlayerPositionHeartbeatIntervalMs(cleanWorldName)) || 0));
    const positionProfile = getAdaptivePlayerPositionBatchProfile(cleanWorldName) || {};

    return {
      position_heartbeat_interval_ms: heartbeatIntervalMs,
      position_broadcast_interval_ms: Math.max(0, Math.trunc(Number(positionProfile.interval_ms || config.playerPositionBroadcastIntervalMs) || 0)),
      position_batch_max_items: Math.max(1, Math.trunc(Number(positionProfile.max_items || config.playerPositionBatchMaxItems) || config.playerPositionBatchMaxItems)),
      world_population_for_batching: Math.max(0, config.getWorldPopulationForBatching(cleanWorldName)),
      source: "server_dynamic_profile",
      source_version: 1,
    };
  }

  function buildWorldPopulationUpdatePayload(worldName: unknown): PacketRecord {
    const clean = config.cleanWorld(worldName || "START");
    return {
      type: "world_population_update",
      world_counts: {
        [clean]: config.getWorldPopulationCount(clean),
      },
      network_movement_guidance: {
        [clean]: buildClientMovementGuidance(clean),
      },
    };
  }

  function supportsWorldUpdateBatch(player: PlayerLike | null | undefined): boolean {
    if (!config.worldUpdateBatchingEnabled) return false;
    const comparison = config.compareVersions(player?.client_version || "", config.worldUpdateBatchMinClientVersion);
    return comparison !== null && comparison >= 0;
  }

  function isDropWorldUpdatePayload(message: unknown): boolean {
    return config.packetContracts.isDropWorldUpdatePayload(message);
  }

  function isDropRemoveWorldUpdatePayload(message: unknown): boolean {
    return config.packetContracts.isDropRemoveWorldUpdatePayload(message);
  }

  function getDropPublicId(drop: unknown): string {
    const raw = asDrop(drop);
    return config.clampString(raw.drop_id || raw.id || "", config.maxDropIdLength);
  }

  function getDropPublicPosition(drop: unknown): GridPosition | null {
    const raw = asDrop(drop);
    if (!isRecord(raw)) return null;
    const stackGridX = Number(raw.stack_grid_x);
    const stackGridY = Number(raw.stack_grid_y);
    if (Number.isFinite(stackGridX) && Number.isFinite(stackGridY)) {
      return {
        x: stackGridX * config.tileSize,
        y: stackGridY * config.tileSize,
      };
    }

    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  function getSquaredDropDistance(player: unknown, drop: unknown): number | null {
    const rawPlayer = toRecord(player);
    const playerX = Number(rawPlayer.x);
    const playerY = Number(rawPlayer.y);
    const dropPosition = getDropPublicPosition(drop);
    if (!Number.isFinite(playerX) || !Number.isFinite(playerY) || !dropPosition) return null;

    const dx = playerX - dropPosition.x;
    const dy = playerY - dropPosition.y;
    return dx * dx + dy * dy;
  }

  function buildDropCreatePayload(drop: unknown, worldName: unknown): PacketRecord | null {
    const raw = asDrop(drop);
    const cleanDropId = getDropPublicId(raw);
    if (cleanDropId === "") return null;
    return {
      type: "world_item_drop_create",
      world: config.cleanWorld(worldName || raw.world || "START"),
      drop_id: cleanDropId,
      item_type: config.clampString(raw.item_type || raw.item_id || "", config.maxItemIdLength),
      item_category: config.resolveInventoryCategory(raw.item_type || raw.item_id || "", raw.item_category || raw.category || ""),
      is_seed: Boolean(raw.is_seed),
      amount: config.clampInteger(raw.amount || 0, 0, config.maxDropTileAmount),
      x: Number(raw.x || 0),
      y: Number(raw.y || 0),
      stack_grid_x: Number.isFinite(Number(raw.stack_grid_x)) ? Math.trunc(Number(raw.stack_grid_x)) : undefined,
      stack_grid_y: Number.isFinite(Number(raw.stack_grid_y)) ? Math.trunc(Number(raw.stack_grid_y)) : undefined,
      pickup_delay: Math.max(0, Number(raw.pickup_delay || 0)),
    };
  }

  function buildDropInterestCullPayload(drop: unknown, worldName: unknown): PacketRecord | null {
    const raw = asDrop(drop);
    const cleanDropId = getDropPublicId(raw);
    if (cleanDropId === "") return null;
    return {
      type: "world_item_drop_remove",
      world: config.cleanWorld(worldName || raw.world || "START"),
      drop_id: cleanDropId,
      interest_cull: true,
      reason: "out_of_drop_interest",
    };
  }

  return {
    addBulkPickupDelta,
    appendSameTileBulkDropIds,
    buildClientMovementGuidance,
    buildDropCreatePayload,
    buildDropInterestCullPayload,
    buildWorldPopulationUpdatePayload,
    clampBatchMaxItems,
    getAdaptivePlayerPositionBatchProfile,
    getAdaptiveWorldUpdateBatchProfile,
    getDropPublicId,
    getDropPublicPosition,
    getPlayerPositionHeartbeatIntervalMs,
    getPreparedDropPickupFailureMessage,
    getSquaredDropDistance,
    isDropRemoveWorldUpdatePayload,
    isDropWorldUpdatePayload,
    makeBulkDropPickupFailure,
    makeBulkDropPickupWorldResultPayload,
    makeWorldDensityBatchProfile,
    shouldUseBulkDropPickup,
    supportsWorldUpdateBatch,
    validateDropCreateAgainstServerState,
    validateDropUpdateAgainstServerState,
  };
}

export = {
  createServerPhase6Helpers,
};
