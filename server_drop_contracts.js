// Generated from src/server_drop_contracts.ts. Do not edit by hand.
/// <reference path="../types/pixelmania-contracts.d.ts" />
"use strict";
function buildSanitizedDropCreate(input) {
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
function buildSanitizedDropUpdate(input) {
    const update = {
        type: "world_item_drop_update",
        world: input.world,
        drop_id: input.dropId,
    };
    const amount = Number(input.amount);
    if (Number.isFinite(amount))
        update.amount = amount;
    const x = Number(input.x);
    const y = Number(input.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
        update.x = x;
        update.y = y;
    }
    return update;
}
function buildSanitizedDropPickup(input) {
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
function buildSanitizedBulkDropPickup(input) {
    return {
        ...buildSanitizedDropPickup(input),
        bulk_pickup: true,
        drop_ids: input.dropIds,
    };
}
function buildDropPickupFailure(input) {
    const result = {
        ok: false,
        reason: input.reason,
    };
    if (Object.prototype.hasOwnProperty.call(input, "drop"))
        result.drop = input.drop;
    if (Object.prototype.hasOwnProperty.call(input, "world"))
        result.world = input.world;
    if (Object.prototype.hasOwnProperty.call(input, "current_world"))
        result.current_world = input.current_world;
    if (Object.prototype.hasOwnProperty.call(input, "requested_world"))
        result.requested_world = input.requested_world;
    if (Object.prototype.hasOwnProperty.call(input, "position"))
        result.position = input.position;
    if (Object.prototype.hasOwnProperty.call(input, "validationPosition"))
        result.validationPosition = input.validationPosition;
    if (Object.prototype.hasOwnProperty.call(input, "item_type"))
        result.item_type = input.item_type;
    if (Object.prototype.hasOwnProperty.call(input, "item_category"))
        result.item_category = input.item_category;
    if (Object.prototype.hasOwnProperty.call(input, "stackLimit"))
        result.stackLimit = input.stackLimit;
    if (Object.prototype.hasOwnProperty.call(input, "currentCount"))
        result.currentCount = input.currentCount;
    if (Object.prototype.hasOwnProperty.call(input, "availableSpace"))
        result.availableSpace = input.availableSpace;
    if (Object.prototype.hasOwnProperty.call(input, "dropAmount"))
        result.dropAmount = input.dropAmount;
    if (Object.prototype.hasOwnProperty.call(input, "pickedAmount"))
        result.pickedAmount = input.pickedAmount;
    return result;
}
function buildPreparedDropPickupPlan(input) {
    return {
        ok: true,
        ...input,
    };
}
function buildDropPickupRemovePayload(input) {
    const payload = {
        type: "world_item_drop_remove",
        world: input.world,
        drop_id: input.dropId,
        remaining: 0,
        removed: true,
        requested_by: input.requestedBy,
        requested_by_name: input.requestedByName,
    };
    if (input.reason)
        payload.reason = input.reason;
    return payload;
}
function buildDropPickupUpdatePayload(input) {
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
function buildDropPickupWorldApplySuccess(payload) {
    return {
        ok: true,
        payload,
    };
}
function buildDropPickupWorldApplyFailure(reason) {
    return {
        ok: false,
        reason,
    };
}
function buildLegacyDropPickupSuccess(input) {
    return {
        ok: true,
        ...input,
    };
}
function buildPostgresDropPickupFailure(input) {
    const result = {
        ok: false,
        reason: input.reason,
    };
    if (Object.prototype.hasOwnProperty.call(input, "drop_id"))
        result.drop_id = input.drop_id;
    if (Object.prototype.hasOwnProperty.call(input, "item_type"))
        result.item_type = input.item_type;
    if (Object.prototype.hasOwnProperty.call(input, "item_category"))
        result.item_category = input.item_category;
    if (Object.prototype.hasOwnProperty.call(input, "available_amount"))
        result.available_amount = input.available_amount;
    if (Object.prototype.hasOwnProperty.call(input, "requested_amount"))
        result.requested_amount = input.requested_amount;
    if (Object.prototype.hasOwnProperty.call(input, "message"))
        result.message = input.message;
    if (Object.prototype.hasOwnProperty.call(input, "item_instances"))
        result.item_instances = input.item_instances;
    return result;
}
function buildPostgresDropPickupSuccess(input) {
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
    };
}
function getPostgresDropPickupFailureReason(result, fallback = "postgres_rejected") {
    if (result && typeof result === "object" && !Array.isArray(result) && "reason" in result) {
        const reason = result.reason;
        return String(reason || fallback);
    }
    return fallback;
}
function isPostgresDropPickupUnavailableFailure(result) {
    if (!result || result.ok !== false)
        return false;
    const reason = getPostgresDropPickupFailureReason(result, "");
    return reason === "drop_not_available" || reason === "drop_changed" || reason === "drop_amount_changed";
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
    getPostgresDropPickupFailureReason,
    isPostgresDropPickupUnavailableFailure,
};
module.exports = DropContracts;
