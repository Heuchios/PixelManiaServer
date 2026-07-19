// Generated from src/server_inventory_contracts.ts. Do not edit by hand.
/// <reference path="../types/pixelmania-contracts.d.ts" />
"use strict";
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function buildInventoryDeltaSource(input) {
    const source = {
        item_type: input.itemType,
        item_category: input.itemCategory,
        delta: input.delta,
    };
    if (Number.isFinite(Number(input.expectedBeforeAmount))) {
        source.expected_before_amount = Number(input.expectedBeforeAmount);
    }
    if (Number.isFinite(Number(input.stackLimit))) {
        source.stack_limit = Number(input.stackLimit);
    }
    return source;
}
function buildInventoryCommitSuccess(input) {
    const result = {
        ok: true,
        state: input.state,
        postgres_committed: input.postgresCommitted,
        deltas: input.deltas,
    };
    if (typeof input.equipmentChanged === "boolean") {
        result.equipment_changed = input.equipmentChanged;
    }
    return result;
}
function buildInventoryCommitFailure(input) {
    const result = {
        ok: false,
        message: input.message,
    };
    if (input.reason)
        result.reason = input.reason;
    return result;
}
function buildDeferredInventoryCommit(input) {
    return {
        username: input.username,
        beforeState: input.beforeState,
        afterState: input.afterState,
        options: isRecord(input.options) ? input.options : {},
    };
}
function buildPostgresInventoryDeltaTransactionEntry(input) {
    const entry = {
        account_username: input.accountUsername,
        world: input.world,
        source: input.source,
        action: input.action,
        reason: input.reason,
        request_id: input.requestId,
        correlation_id: input.correlationId || "",
        metadata: isRecord(input.metadata) ? input.metadata : {},
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
        session_token_hash: input.sessionTokenHash,
        device_info: isRecord(input.deviceInfo) ? input.deviceInfo : {},
        deltas: input.deltas,
        player_state: isRecord(input.playerState) ? input.playerState : {},
        world_state: isRecord(input.worldState) ? input.worldState : {},
        world_changes: Array.isArray(input.worldChanges) ? input.worldChanges : [],
        allow_state_repair: input.allowStateRepair === true,
        at: input.at,
    };
    if (input.username)
        entry.username = input.username;
    if (input.email)
        entry.email = input.email;
    if (input.actorRole)
        entry.actor_role = input.actorRole;
    if (input.sourceType)
        entry.source_type = input.sourceType;
    if (input.ip)
        entry.ip = input.ip;
    if (typeof input.strictItemInstances === "boolean") {
        entry.strict_item_instances = input.strictItemInstances;
    }
    return entry;
}
function buildPostgresInventoryLedgerEntry(input) {
    return {
        item_type: input.itemType,
        item_category: input.itemCategory,
        delta: input.delta,
        before_amount: input.beforeAmount,
        after_amount: input.afterAmount,
        stack_limit: input.stackLimit,
    };
}
function buildPostgresInventoryDeltaTransactionSuccess(input) {
    const result = {
        ok: true,
        ledger_entries: input.ledgerEntries,
    };
    if (Object.prototype.hasOwnProperty.call(input, "playerId"))
        result.player_id = input.playerId;
    if (Object.prototype.hasOwnProperty.call(input, "worldId"))
        result.world_id = input.worldId;
    return result;
}
function buildPostgresInventoryDeltaTransactionFailure(input) {
    const result = {
        ok: false,
        reason: input.reason,
    };
    if (Object.prototype.hasOwnProperty.call(input, "message"))
        result.message = input.message;
    if (Object.prototype.hasOwnProperty.call(input, "itemType"))
        result.item_type = input.itemType;
    if (Object.prototype.hasOwnProperty.call(input, "itemCategory"))
        result.item_category = input.itemCategory;
    if (Object.prototype.hasOwnProperty.call(input, "beforeAmount"))
        result.before_amount = input.beforeAmount;
    if (Object.prototype.hasOwnProperty.call(input, "afterAmount"))
        result.after_amount = input.afterAmount;
    if (Object.prototype.hasOwnProperty.call(input, "delta"))
        result.delta = input.delta;
    if (Object.prototype.hasOwnProperty.call(input, "stackLimit"))
        result.stack_limit = input.stackLimit;
    return result;
}
function buildInventoryDeltaClientPayload(input) {
    const payload = {
        item_type: input.itemType,
        item_category: input.itemCategory,
        delta: input.delta,
        stack_limit: input.stackLimit,
    };
    if (Number.isFinite(Number(input.afterCount))) {
        payload.after_count = Number(input.afterCount);
    }
    return payload;
}
function buildInventoryRewardEntry(input) {
    return {
        item_id: input.itemId,
        item_category: input.itemCategory,
        amount: input.amount,
    };
}
function buildDropPickupInventoryTransactionResult(input) {
    const result = {
        ok: true,
        request_id: input.request_id,
        action: "drop_pickup",
        source_type: "world_item_drop_pickup",
        world: input.world,
        drop_id: input.drop_id,
        amount: input.amount,
        requested_by: input.requested_by,
        requested_by_name: input.requested_by_name,
        message: input.message,
        username: input.username,
        inventory_delta: input.inventory_delta,
        inventory_deltas: input.inventory_deltas,
        rewards: input.rewards,
        _server_inventory_update_applied: true,
        _apply_pickup_inventory: false,
    };
    if (input.server_action_id)
        result.server_action_id = input.server_action_id;
    if (input.bulk_pickup === true)
        result.bulk_pickup = true;
    if (input.drop_ids)
        result.drop_ids = input.drop_ids;
    if (input.removed_drop_ids)
        result.removed_drop_ids = input.removed_drop_ids;
    if (input.updated_drops)
        result.updated_drops = input.updated_drops;
    if (input.pickup_results)
        result.pickup_results = input.pickup_results;
    if (input.item_type)
        result.item_type = input.item_type;
    if (input.item_category)
        result.item_category = input.item_category;
    if (Number.isFinite(Number(input.remaining)))
        result.remaining = Number(input.remaining);
    if (Number.isFinite(Number(input.remaining_amount)))
        result.remaining_amount = Number(input.remaining_amount);
    return result;
}
function buildInventoryTransactionResultResponse(payload, username) {
    const safePayload = isRecord(payload) ? payload : {};
    const response = {
        ...safePayload,
        type: "inventory_transaction_result",
        ok: Boolean(safePayload.ok),
        request_id: String(safePayload.request_id || ""),
        action: String(safePayload.action || ""),
        message: String(safePayload.message || ""),
        username,
        rewards: Array.isArray(safePayload.rewards) ? safePayload.rewards : [],
    };
    const playerData = safePayload.player_data;
    if (isRecord(playerData) && Object.keys(playerData).length > 0) {
        response.player_data = playerData;
    }
    else {
        delete response.player_data;
    }
    return response;
}
const InventoryContracts = {
    buildDeferredInventoryCommit,
    buildDropPickupInventoryTransactionResult,
    buildInventoryCommitFailure,
    buildInventoryCommitSuccess,
    buildInventoryDeltaClientPayload,
    buildInventoryDeltaSource,
    buildInventoryTransactionResultResponse,
    buildInventoryRewardEntry,
    buildPostgresInventoryDeltaTransactionEntry,
    buildPostgresInventoryDeltaTransactionFailure,
    buildPostgresInventoryDeltaTransactionSuccess,
    buildPostgresInventoryLedgerEntry,
};
module.exports = InventoryContracts;
