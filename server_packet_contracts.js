// Generated from src/server_packet_contracts.ts. Do not edit by hand.
"use strict";
const WORLD_BLOCK_UPDATE_TYPE = "world_block_update";
const PLAYER_POSITION_TYPE = "player_position";
const WORLD_DROP_CREATE_TYPES = Object.freeze(["world_item_drop_create", "world_drop_create"]);
const WORLD_DROP_PICKUP_TYPES = Object.freeze([
    "world_item_drop_pickup",
    "world_drop_pickup",
    "drop_pickup",
]);
const WORLD_DROP_PICKUP_REQUEST_TYPES = Object.freeze([
    "world_item_drop_pickup",
    "world_item_drop_remove",
    "world_drop_pickup",
    "world_drop_remove",
]);
const WORLD_DROP_UPDATE_TYPES = Object.freeze(["world_item_drop_update", "world_drop_update", "drop_updated"]);
const WORLD_DROP_UPDATE_REQUEST_TYPES = Object.freeze(["world_item_drop_update", "world_drop_update"]);
const WORLD_DROP_TRUSTED_POSITION_PICKUP_TYPES = Object.freeze([
    "world_item_drop_pickup",
    "world_drop_pickup",
]);
const WORLD_DROP_REMOVE_UPDATE_TYPES = Object.freeze([
    "world_item_drop_pickup",
    "world_drop_pickup",
    "world_item_drop_remove",
    "world_drop_remove",
    "drop_removed",
]);
const WORLD_DROP_WORLD_UPDATE_TYPES = Object.freeze([
    ...WORLD_DROP_CREATE_TYPES,
    "drop_spawned",
    ...WORLD_DROP_UPDATE_TYPES,
    ...WORLD_DROP_REMOVE_UPDATE_TYPES,
]);
const WORLD_ACTION_PACKET_TYPES = Object.freeze([
    WORLD_BLOCK_UPDATE_TYPE,
    ...WORLD_DROP_CREATE_TYPES,
    ...WORLD_DROP_PICKUP_TYPES,
]);
const WORLD_DROP_IDEMPOTENCY_REQUEST_TYPES = Object.freeze([
    ...WORLD_DROP_CREATE_TYPES,
    ...WORLD_DROP_UPDATE_REQUEST_TYPES,
    ...WORLD_DROP_PICKUP_REQUEST_TYPES,
]);
const PLAYER_POSITION_LEGACY_EQUIPMENT_FIELDS = Object.freeze([
    "equipped_tool",
    "equipped_back",
    "equipped_back_item",
    "equipped_hat_item",
    "equipped_hair_item",
    "equipped_eyewear_item",
    "equipped_shirt_item",
    "equipped_pants_item",
    "equipped_shoes_item",
    "equipped_ride_item",
]);
function isPacketRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function asPacketRecord(value) {
    return isPacketRecord(value) ? value : {};
}
function cleanPacketString(value) {
    return String(value || "").trim();
}
function getPacketType(packet) {
    return cleanPacketString(asPacketRecord(packet).type).toLowerCase();
}
function isWorldActionPacket(packet) {
    return WORLD_ACTION_PACKET_TYPES.includes(getPacketType(packet));
}
function isWorldBlockUpdatePacket(packet) {
    return getPacketType(packet) === WORLD_BLOCK_UPDATE_TYPE;
}
function isWorldDropCreatePacket(packet) {
    return WORLD_DROP_CREATE_TYPES.includes(getPacketType(packet));
}
function isWorldDropPickupPacket(packet) {
    return WORLD_DROP_PICKUP_TYPES.includes(getPacketType(packet));
}
function isWorldDropUpdateRequestPacket(packet) {
    return WORLD_DROP_UPDATE_REQUEST_TYPES.includes(getPacketType(packet));
}
function isWorldDropPickupRequestPacket(packet) {
    return WORLD_DROP_PICKUP_REQUEST_TYPES.includes(getPacketType(packet));
}
function isWorldDropIdempotencyRequestPacket(packet) {
    return WORLD_DROP_IDEMPOTENCY_REQUEST_TYPES.includes(getPacketType(packet));
}
function isPlayerPositionPacket(packet) {
    const data = asPacketRecord(packet);
    if (getPacketType(data) !== PLAYER_POSITION_TYPE)
        return false;
    const x = Number(data.x);
    const y = Number(data.y);
    return Number.isFinite(x) && Number.isFinite(y);
}
function hasPlayerPositionVisualSnapshot(packet) {
    const data = asPacketRecord(packet);
    if (!isPlayerPositionPacket(data))
        return false;
    if (data.equipment_slots && typeof data.equipment_slots === "object" && !Array.isArray(data.equipment_slots))
        return true;
    return PLAYER_POSITION_LEGACY_EQUIPMENT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(data, field));
}
function isWorldDropTrustedPositionAction(action) {
    const type = cleanPacketString(action).toLowerCase();
    return WORLD_DROP_CREATE_TYPES.includes(type) || WORLD_DROP_TRUSTED_POSITION_PICKUP_TYPES.includes(type);
}
function isDropWorldUpdatePayload(packet) {
    return WORLD_DROP_WORLD_UPDATE_TYPES.includes(getPacketType(packet));
}
function isDropRemoveWorldUpdatePayload(packet) {
    return WORLD_DROP_REMOVE_UPDATE_TYPES.includes(getPacketType(packet));
}
function getCanonicalWorldActionType(packet) {
    if (isWorldBlockUpdatePacket(packet))
        return "world_block_update";
    if (isWorldDropCreatePacket(packet))
        return "world_item_drop_create";
    if (isWorldDropPickupPacket(packet))
        return "world_item_drop_pickup";
    return "";
}
function getPacketWorldName(packet) {
    const data = asPacketRecord(packet);
    return cleanPacketString(data.world || data.world_name || data.world_id || data.current_world || data.current_world_id);
}
function hasActionActorPosition(packet) {
    const data = asPacketRecord(packet);
    return Object.prototype.hasOwnProperty.call(data, "actor_x") && Object.prototype.hasOwnProperty.call(data, "actor_y");
}
function getActionActorPosition(packet) {
    const data = asPacketRecord(packet);
    const rawX = hasActionActorPosition(data) ? data.actor_x : data.x;
    const rawY = hasActionActorPosition(data) ? data.actor_y : data.y;
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y))
        return null;
    return {
        x,
        y,
        world: cleanPacketString(data.actor_world || getPacketWorldName(data)),
        facing: data.actor_facing ?? data.facing,
    };
}
function isBulkDropPickupRequested(packet) {
    const data = asPacketRecord(packet);
    if (data.bulk_pickup === true || data.bulk_pickup_same_tile === true)
        return true;
    return Array.isArray(data.drop_ids) && data.drop_ids.length > 1;
}
function isSameTileBulkDropPickupRequested(packet) {
    return asPacketRecord(packet).bulk_pickup_same_tile === true;
}
function getDropPickupIds(packet) {
    const data = asPacketRecord(packet);
    const ids = [];
    const seen = new Set();
    const rawIds = Array.isArray(data.drop_ids) ? data.drop_ids : [];
    const candidates = [data.drop_id, ...rawIds];
    for (const candidate of candidates) {
        const dropId = cleanPacketString(candidate);
        if (dropId === "" || seen.has(dropId))
            continue;
        seen.add(dropId);
        ids.push(dropId);
    }
    return ids;
}
const PacketContracts = {
    PLAYER_POSITION_LEGACY_EQUIPMENT_FIELDS,
    PLAYER_POSITION_TYPE,
    WORLD_ACTION_PACKET_TYPES,
    WORLD_BLOCK_UPDATE_TYPE,
    WORLD_DROP_CREATE_TYPES,
    WORLD_DROP_PICKUP_REQUEST_TYPES,
    WORLD_DROP_IDEMPOTENCY_REQUEST_TYPES,
    WORLD_DROP_REMOVE_UPDATE_TYPES,
    WORLD_DROP_TRUSTED_POSITION_PICKUP_TYPES,
    WORLD_DROP_UPDATE_TYPES,
    WORLD_DROP_UPDATE_REQUEST_TYPES,
    WORLD_DROP_WORLD_UPDATE_TYPES,
    WORLD_DROP_PICKUP_TYPES,
    asPacketRecord,
    cleanPacketString,
    getActionActorPosition,
    getCanonicalWorldActionType,
    getDropPickupIds,
    getPacketType,
    getPacketWorldName,
    hasActionActorPosition,
    hasPlayerPositionVisualSnapshot,
    isBulkDropPickupRequested,
    isDropRemoveWorldUpdatePayload,
    isDropWorldUpdatePayload,
    isPacketRecord,
    isPlayerPositionPacket,
    isSameTileBulkDropPickupRequested,
    isWorldActionPacket,
    isWorldBlockUpdatePacket,
    isWorldDropCreatePacket,
    isWorldDropIdempotencyRequestPacket,
    isWorldDropPickupPacket,
    isWorldDropPickupRequestPacket,
    isWorldDropTrustedPositionAction,
    isWorldDropUpdateRequestPacket,
};
module.exports = PacketContracts;
