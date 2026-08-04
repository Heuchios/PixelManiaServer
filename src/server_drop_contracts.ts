/// <reference path="../types/pixelmania-contracts.d.ts" />
"use strict";

type ActorPosition = PixelMania.ActorPosition;
type SanitizedDropCreate = PixelMania.SanitizedDropCreate;
type SanitizedDropUpdate = PixelMania.SanitizedDropUpdate;
type SanitizedDropPickup = PixelMania.SanitizedDropPickup;
type SanitizedBulkDropPickup = PixelMania.SanitizedBulkDropPickup;
type DropPickupFailure = PixelMania.DropPickupFailure;
type DropPickupWorldApplyFailure = PixelMania.DropPickupWorldApplyFailure;
type DropPickupWorldPayload = PixelMania.DropPickupWorldPayload;
type DropPickupWorldRemovePayload = PixelMania.DropPickupWorldRemovePayload;
type DropPickupWorldUpdatePayload = PixelMania.DropPickupWorldUpdatePayload;
type LegacyDropPickupSuccess = PixelMania.LegacyDropPickupSuccess;
type PreparedDropPickupPlan = PixelMania.PreparedDropPickupPlan;
type PostgresDropPickupFailure = PixelMania.PostgresDropPickupFailure;
type PostgresDropPickupResult = PixelMania.PostgresDropPickupResult;
type PostgresDropPickupSuccess = PixelMania.PostgresDropPickupSuccess;
type ServerDropState = PixelMania.ServerDropState;
type TilePosition = PixelMania.TilePosition;

interface SanitizedDropCreateInput {
  world: string;
  dropId: string;
  itemType: string;
  itemCategory: string;
  isSeed: boolean;
  amount: number;
  x: number;
  y: number;
  stackGrid?: TilePosition | null;
  pickupDelay: number;
}

interface SanitizedDropUpdateInput {
  world: string;
  dropId: string;
  amount?: number;
  x?: number;
  y?: number;
}

interface SanitizedDropPickupInput {
  world: string;
  requestedWorld: string;
  dropId: string;
  playerId: string;
  name: string;
  actionPosition: ActorPosition | null;
}

interface SanitizedBulkDropPickupInput extends SanitizedDropPickupInput {
  dropIds: string[];
}

interface DropPickupFailureInput {
  reason: string;
  drop?: ServerDropState;
  world?: string;
  current_world?: string;
  requested_world?: string;
  position?: Record<string, unknown>;
  validationPosition?: ActorPosition | Record<string, unknown>;
  item_type?: string;
  item_category?: string;
  stackLimit?: number;
  currentCount?: number;
  availableSpace?: number;
  dropAmount?: number;
  pickedAmount?: number;
}

interface DropPickupRemovePayloadInput {
  world: string;
  dropId: string;
  requestedBy: string;
  requestedByName: string;
  reason?: string;
}

interface DropPickupUpdatePayloadInput {
  world: string;
  dropId: string;
  itemType: string;
  itemCategory: string;
  amount: number;
  remaining: number;
  requestedBy: string;
  requestedByName: string;
}

interface PostgresDropPickupFailureInput {
  reason: string;
  drop_id?: string;
  drop_status?: string;
  item_type?: string;
  item_category?: string;
  available_amount?: number;
  requested_amount?: number;
  message?: string;
  item_instances?: Array<Record<string, unknown>>;
  persisted_revision?: number;
}

function buildSanitizedDropCreate(input: SanitizedDropCreateInput): SanitizedDropCreate {
  const stackGrid = input.stackGrid || null;
  return {
    type: "drop_spawned",
    world: input.world,
    drop_id: input.dropId,
    item_type: input.itemType,
    item_category: input.itemCategory,
    is_seed: input.isSeed,
    amount: input.amount,
    x: input.x,
    y: input.y,
    stack_grid_x: stackGrid ? stackGrid.x : undefined,
    stack_grid_y: stackGrid ? stackGrid.y : undefined,
    pickup_delay: input.pickupDelay,
  };
}

function buildSanitizedDropUpdate(input: SanitizedDropUpdateInput): SanitizedDropUpdate {
  const update: SanitizedDropUpdate = {
    type: "world_item_drop_update",
    world: input.world,
    drop_id: input.dropId,
  };

  const amount = Number(input.amount);
  if (Number.isFinite(amount)) update.amount = amount;

  const x = Number(input.x);
  const y = Number(input.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    update.x = x;
    update.y = y;
  }

  return update;
}

function buildSanitizedDropPickup(input: SanitizedDropPickupInput): SanitizedDropPickup {
  return {
    type: "world_item_drop_pickup",
    world: input.world,
    requested_world: input.requestedWorld,
    drop_id: input.dropId,
    player_id: input.playerId,
    name: input.name,
    action_position: input.actionPosition,
  };
}

function buildSanitizedBulkDropPickup(input: SanitizedBulkDropPickupInput): SanitizedBulkDropPickup {
  return {
    ...buildSanitizedDropPickup(input),
    bulk_pickup: true,
    drop_ids: input.dropIds,
  };
}

function buildDropPickupFailure(input: DropPickupFailureInput): DropPickupFailure {
  const result: DropPickupFailure = {
    ok: false,
    reason: input.reason,
  };

  if (Object.prototype.hasOwnProperty.call(input, "drop")) result.drop = input.drop;
  if (Object.prototype.hasOwnProperty.call(input, "world")) result.world = input.world;
  if (Object.prototype.hasOwnProperty.call(input, "current_world")) result.current_world = input.current_world;
  if (Object.prototype.hasOwnProperty.call(input, "requested_world")) result.requested_world = input.requested_world;
  if (Object.prototype.hasOwnProperty.call(input, "position")) result.position = input.position;
  if (Object.prototype.hasOwnProperty.call(input, "validationPosition")) result.validationPosition = input.validationPosition;
  if (Object.prototype.hasOwnProperty.call(input, "item_type")) result.item_type = input.item_type;
  if (Object.prototype.hasOwnProperty.call(input, "item_category")) result.item_category = input.item_category;
  if (Object.prototype.hasOwnProperty.call(input, "stackLimit")) result.stackLimit = input.stackLimit;
  if (Object.prototype.hasOwnProperty.call(input, "currentCount")) result.currentCount = input.currentCount;
  if (Object.prototype.hasOwnProperty.call(input, "availableSpace")) result.availableSpace = input.availableSpace;
  if (Object.prototype.hasOwnProperty.call(input, "dropAmount")) result.dropAmount = input.dropAmount;
  if (Object.prototype.hasOwnProperty.call(input, "pickedAmount")) result.pickedAmount = input.pickedAmount;

  return result;
}

function buildPreparedDropPickupPlan(input: Omit<PreparedDropPickupPlan, "ok">): PreparedDropPickupPlan {
  return {
    ok: true,
    ...input,
  };
}

function buildDropPickupRemovePayload(input: DropPickupRemovePayloadInput): DropPickupWorldRemovePayload {
  const payload: DropPickupWorldRemovePayload = {
    type: "world_item_drop_remove",
    world: input.world,
    drop_id: input.dropId,
    remaining: 0,
    removed: true,
    requested_by: input.requestedBy,
    requested_by_name: input.requestedByName,
  };
  if (input.reason) payload.reason = input.reason;
  return payload;
}

function buildDropPickupUpdatePayload(input: DropPickupUpdatePayloadInput): DropPickupWorldUpdatePayload {
  return {
    type: "world_item_drop_update",
    world: input.world,
    drop_id: input.dropId,
    item_type: input.itemType,
    item_category: input.itemCategory,
    amount: input.amount,
    remaining: input.remaining,
    requested_by: input.requestedBy,
    requested_by_name: input.requestedByName,
  };
}

function buildDropPickupWorldApplySuccess(payload: DropPickupWorldPayload): PixelMania.DropPickupWorldApplySuccess {
  return {
    ok: true,
    payload,
  };
}

function buildDropPickupWorldApplyFailure(reason: string): DropPickupWorldApplyFailure {
  return {
    ok: false,
    reason,
  };
}

function buildLegacyDropPickupSuccess(input: Omit<LegacyDropPickupSuccess, "ok">): LegacyDropPickupSuccess {
  return {
    ok: true,
    ...input,
  };
}

function buildPostgresDropPickupFailure(input: PostgresDropPickupFailureInput): PostgresDropPickupFailure {
  const result: PostgresDropPickupFailure = {
    ok: false,
    reason: input.reason,
  };

  if (Object.prototype.hasOwnProperty.call(input, "drop_id")) result.drop_id = input.drop_id;
  if (Object.prototype.hasOwnProperty.call(input, "drop_status")) result.drop_status = input.drop_status;
  if (Object.prototype.hasOwnProperty.call(input, "item_type")) result.item_type = input.item_type;
  if (Object.prototype.hasOwnProperty.call(input, "item_category")) result.item_category = input.item_category;
  if (Object.prototype.hasOwnProperty.call(input, "available_amount")) result.available_amount = input.available_amount;
  if (Object.prototype.hasOwnProperty.call(input, "requested_amount")) result.requested_amount = input.requested_amount;
  if (Object.prototype.hasOwnProperty.call(input, "message")) result.message = input.message;
  if (Object.prototype.hasOwnProperty.call(input, "item_instances")) result.item_instances = input.item_instances;
  if (Object.prototype.hasOwnProperty.call(input, "persisted_revision")) result.persisted_revision = input.persisted_revision;

  return result;
}

function buildPostgresDropPickupSuccess(input: Omit<PostgresDropPickupSuccess, "ok">): PostgresDropPickupSuccess {
  return {
    ok: true,
    before_amount: input.before_amount,
    after_amount: input.after_amount,
    item_type: input.item_type,
    item_category: input.item_category,
    repaired_inventory_before_amount: input.repaired_inventory_before_amount,
    drop_before_amount: input.drop_before_amount,
    drop_after_amount: input.drop_after_amount,
    item_instances: input.item_instances,
    persisted_revision: input.persisted_revision,
  };
}

function getPostgresDropPickupFailureReason(result: unknown, fallback = "postgres_rejected"): string {
  if (result && typeof result === "object" && !Array.isArray(result) && "reason" in result) {
    const reason = (result as { reason?: unknown }).reason;
    return String(reason || fallback);
  }
  return fallback;
}

function isPostgresDropPickupUnavailableFailure(result: PostgresDropPickupResult | { ok?: unknown; reason?: unknown }): boolean {
  if (!result || result.ok !== false) return false;
  const reason = getPostgresDropPickupFailureReason(result, "");
  return reason === "drop_not_available" || reason === "drop_changed" || reason === "drop_amount_changed";
}

function getPostgresDropPickupDropStatus(
  result: PostgresDropPickupResult | { ok?: unknown; drop_status?: unknown }
): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const status = (result as { drop_status?: unknown }).drop_status;
  return String(status || "").trim().toLowerCase();
}

/**
 * True only when PostgreSQL proved the drop was fully collected (by this player or
 * another one). This is the ONLY rejection that may remove the drop from live world
 * state: every other failure leaves an item sitting in the world that no inventory
 * ever received, so destroying it would permanently delete the item.
 */
function isPostgresDropPickupCollectedFailure(
  result: PostgresDropPickupResult | { ok?: unknown; reason?: unknown; drop_status?: unknown }
): boolean {
  if (!result || result.ok !== false) return false;
  if (getPostgresDropPickupFailureReason(result, "") !== "drop_not_available") return false;
  return getPostgresDropPickupDropStatus(result) === "picked_up";
}

/**
 * True when the authoritative drop row still exists and still holds items, so the
 * drop must be preserved and the player may simply retry.
 */
function isPostgresDropPickupRetryableFailure(
  result: PostgresDropPickupResult | { ok?: unknown; reason?: unknown; drop_status?: unknown }
): boolean {
  if (!result || result.ok !== false) return false;
  if (isPostgresDropPickupCollectedFailure(result)) return false;
  const reason = getPostgresDropPickupFailureReason(result, "");
  if (reason === "drop_changed" || reason === "drop_amount_changed") return true;
  if (reason === "world_drop_item_instances_pending") return true;
  return getPostgresDropPickupDropStatus(result) === "active";
}

const DropContracts = {
  buildDropPickupFailure,
  buildDropPickupRemovePayload,
  buildDropPickupUpdatePayload,
  buildDropPickupWorldApplyFailure,
  buildDropPickupWorldApplySuccess,
  buildLegacyDropPickupSuccess,
  buildPostgresDropPickupFailure,
  buildPostgresDropPickupSuccess,
  buildPreparedDropPickupPlan,
  buildSanitizedBulkDropPickup,
  buildSanitizedDropCreate,
  buildSanitizedDropPickup,
  buildSanitizedDropUpdate,
  getPostgresDropPickupDropStatus,
  getPostgresDropPickupFailureReason,
  isPostgresDropPickupCollectedFailure,
  isPostgresDropPickupRetryableFailure,
  isPostgresDropPickupUnavailableFailure,
};

export = DropContracts;
