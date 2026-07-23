// Generated from src/server_world_interaction_payload_helpers.ts. Do not edit by hand.
"use strict";
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function copyRecord(value) {
    return isRecord(value) ? { ...value } : {};
}
function getRecordState(payload) {
    return isRecord(payload.state) ? payload.state : payload;
}
function getInteger(value) {
    return Math.trunc(Number(value) || 0);
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function getMapValue(map, key) {
    return map instanceof Map ? map.get(key) : undefined;
}
function createServerWorldInteractionPayloadHelpers(config) {
    function sanitizeTackleBoxPayloadForClient(payload = {}, worldName = "") {
        const safePayload = copyRecord(payload);
        const rawState = getRecordState(safePayload);
        const x = getInteger(safePayload.x ?? rawState.x);
        const y = getInteger(safePayload.y ?? rawState.y);
        const cleanTackle = config.sanitizeTackleBoxState(rawState, safePayload.world || rawState.world || worldName, x, y);
        const safe = {
            action: "tackle_box_state",
            world: config.cleanWorld(safePayload.world || cleanTackle.world || worldName),
            x: cleanTackle.x,
            y: cleanTackle.y,
            next_harvest_at_ms: cleanTackle.next_harvest_at_ms,
            cooldown_ms: cleanTackle.cooldown_ms,
        };
        const messageType = config.clampString(safePayload.type || "");
        if (messageType !== "")
            safe.type = messageType;
        const operation = config.clampString(safePayload.operation || "");
        if (operation !== "")
            safe.operation = operation;
        const blockType = config.clampString(safePayload.block_type || rawState.block_type || "");
        if (blockType !== "")
            safe.block_type = blockType;
        return safe;
    }
    function sanitizeAnimalPayloadForClient(payload, worldName, action, fallbackBlockType, sanitizeState, serializeState) {
        const safePayload = copyRecord(payload);
        const rawState = getRecordState(safePayload);
        const x = getInteger(safePayload.x ?? rawState.x);
        const y = getInteger(safePayload.y ?? rawState.y);
        const cleanState = sanitizeState(rawState, safePayload.world || rawState.world || worldName, x, y);
        const safe = serializeState(cleanState);
        safe.type = config.clampString(safePayload.type || "world_interaction_update") || "world_interaction_update";
        safe.world = config.cleanWorld(safePayload.world || safe.world || worldName);
        safe.block_type = config.clampString(safePayload.block_type || fallbackBlockType);
        safe.action = action;
        const operation = config.clampString(safePayload.operation || "");
        if (operation !== "")
            safe.operation = operation;
        return safe;
    }
    function sanitizeChickenPayloadForClient(payload = {}, worldName = "") {
        return sanitizeAnimalPayloadForClient(payload, worldName, "chicken_state", config.chickenBlockType, config.sanitizeChickenState, config.serializeChickenStateForClient);
    }
    function sanitizeCowPayloadForClient(payload = {}, worldName = "") {
        return sanitizeAnimalPayloadForClient(payload, worldName, "cow_state", config.cowBlockType, config.sanitizeCowState, config.serializeCowStateForClient);
    }
    function sanitizeDuckPayloadForClient(payload = {}, worldName = "") {
        return sanitizeAnimalPayloadForClient(payload, worldName, "duck_state", config.duckBlockType, config.sanitizeDuckState, config.serializeDuckStateForClient);
    }
    function sanitizeBulletinBoardPayloadForClient(payload = {}, worldName = "", receiverPlayer = null) {
        const safePayload = copyRecord(payload);
        const rawState = getRecordState(safePayload);
        const x = getInteger(safePayload.x ?? rawState.x);
        const y = getInteger(safePayload.y ?? rawState.y);
        const cleanBoard = config.sanitizeBulletinBoardState(rawState, safePayload.world || rawState.world || worldName, x, y);
        const safe = config.serializeBulletinBoardStateForClient(cleanBoard, receiverPlayer);
        safe.type = config.clampString(safePayload.type || "world_interaction_update") || "world_interaction_update";
        safe.operation = config.clampString(safePayload.operation || "").toLowerCase();
        return safe;
    }
    function sanitizeDonationBoxPayloadForClient(payload = {}, worldName = "", receiverPlayer = null) {
        const safePayload = copyRecord(payload);
        const rawState = getRecordState(safePayload);
        const safe = config.serializeDonationBoxStateForClient(rawState, receiverPlayer);
        safe.type = config.clampString(safePayload.type || "world_interaction_update") || "world_interaction_update";
        safe.world = config.cleanWorld(safePayload.world || safe.world || worldName);
        return safe;
    }
    function sanitizeOilRefineryPayloadForClient(safe, worldName) {
        const oilPayload = config.makeOilRefineryStatePayload(worldName || safe.world || "START", safe);
        const operation = config.clampString(safe.operation || "").toLowerCase();
        if (operation !== "")
            oilPayload.operation = operation;
        if (hasOwn(safe, "opened"))
            oilPayload.opened = Boolean(safe.opened);
        if (hasOwn(safe, "collected_count")) {
            oilPayload.collected_count = config.clampInteger(safe.collected_count || 0, 0, config.oilRefineryOutputCapacity);
        }
        if (hasOwn(safe, "added_battery_count")) {
            oilPayload.added_battery_count = config.clampInteger(safe.added_battery_count || 0, 0, config.oilRefineryBatteryInputCapacity);
        }
        return oilPayload;
    }
    function sanitizeBatteryChargerPayloadForClient(safe, worldName) {
        const chargerPayload = config.makeBatteryChargerStatePayload(worldName || safe.world || "START", safe);
        const operation = config.clampString(safe.operation || "").toLowerCase();
        if (operation !== "")
            chargerPayload.operation = operation;
        if (hasOwn(safe, "opened"))
            chargerPayload.opened = Boolean(safe.opened);
        if (hasOwn(safe, "collected_count")) {
            chargerPayload.collected_count = config.clampInteger(safe.collected_count || 0, 0, config.batteryChargerOutputCapacity);
        }
        return chargerPayload;
    }
    function sanitizeDoorPayloadForClient(safe, worldName) {
        const state = config.ensureWorldState(worldName || safe.world || "START");
        const x = getInteger(safe.x);
        const y = getInteger(safe.y);
        const key = config.gridKey(x, y);
        const stateRecord = isRecord(state) ? state : {};
        const block = getMapValue(stateRecord.foreground, key);
        const blockRecord = isRecord(block) ? block : {};
        const interaction = getMapValue(stateRecord.interactions, key);
        const interactionRecord = isRecord(interaction) ? interaction : {};
        const blockType = config.clampString(safe.block_type || blockRecord.block_type || "");
        const configuredPassword = config.cleanDoorPassword(safe.password ||
            safe.door_password ||
            interactionRecord.password ||
            interactionRecord.door_password ||
            blockRecord.door_password ||
            "");
        delete safe.password;
        delete safe.door_password;
        delete safe.password_changed;
        if (config.isPasswordDoorBlockType(blockType)) {
            safe.password_configured = hasOwn(safe, "password_configured")
                ? Boolean(safe.password_configured)
                : configuredPassword !== "";
        }
        else {
            delete safe.password_configured;
        }
        return safe;
    }
    function sanitizeWorldInteractionPayloadForClient(payload = {}, worldName = "", receiverPlayer = null) {
        const safe = copyRecord(payload);
        const action = String(safe.action || "").trim();
        if (action === "tackle_box_state")
            return sanitizeTackleBoxPayloadForClient(safe, worldName);
        if (action === "chicken_state")
            return sanitizeChickenPayloadForClient(safe, worldName);
        if (action === "cow_state")
            return sanitizeCowPayloadForClient(safe, worldName);
        if (action === "duck_state")
            return sanitizeDuckPayloadForClient(safe, worldName);
        if (action === "bulletin_board_state") {
            return sanitizeBulletinBoardPayloadForClient(safe, worldName, receiverPlayer);
        }
        if (action === "donation_box_state") {
            return sanitizeDonationBoxPayloadForClient(safe, worldName, receiverPlayer);
        }
        if (action === "oil_refinery_state")
            return sanitizeOilRefineryPayloadForClient(safe, worldName);
        if (action === "battery_charger_state")
            return sanitizeBatteryChargerPayloadForClient(safe, worldName);
        if (action !== "door_state")
            return safe;
        return sanitizeDoorPayloadForClient(safe, worldName);
    }
    return {
        sanitizeBulletinBoardPayloadForClient,
        sanitizeChickenPayloadForClient,
        sanitizeCowPayloadForClient,
        sanitizeDuckPayloadForClient,
        sanitizeDonationBoxPayloadForClient,
        sanitizeTackleBoxPayloadForClient,
        sanitizeWorldInteractionPayloadForClient,
    };
}
module.exports = {
    createServerWorldInteractionPayloadHelpers,
};
