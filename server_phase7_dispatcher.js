// Generated from src/server_phase7_dispatcher.ts. Do not edit by hand.
"use strict";
const EARLY_HANDLER_ROUTE_TYPES = Object.freeze([
    "login",
    "account_register",
    "account_login",
    "account_token_login",
    "account_password_reset_request",
    "account_email_change_request",
    "dev_backend_login",
    "account_state_save",
    "netfox_spawn_ticket_request",
    "netfox_trusted_player_state",
    "custom_trusted_player_state",
    "custom_trusted_player_state_clear",
]);
const POST_ACTION_HANDLER_ROUTE_TYPES = Object.freeze([
    "inventory_transaction_request",
    "inventory_upgrade_purchase",
    "trade_request",
    "trade_response",
    "friend_list_request",
    "friend_request",
    "friend_response",
    "trade_offer_update",
    "trade_confirm",
    "trade_final_confirm",
    "trade_cancel",
    "player_state_request",
    "player_profile_update",
    "owned_locked_worlds_request",
    "pull_player_request",
    "door_enter",
    "player_state_save",
    "join_world",
    "leave_world",
    "chat",
    "broadcast",
    "developer_pin_unlock",
    "developer_command_request",
    "oil_refinery_request",
    "battery_charger_request",
    "player_punch",
    "iap_create_stripe_checkout_request",
    "iap_submit_google_play_purchase_request",
    "landfill_status_request",
    "landfill_race_state_request",
    "landfill_join_request",
    "landfill_leaderboard_request",
    "landfill_claim_prize_request",
]);
const DIRECT_HANDLER_ROUTE_TYPES = Object.freeze([
    "world_entry_ready",
    "world_block_update",
    "world_block_reconcile_request",
    "electrical_layer_update",
    "request_wire_visibility_refresh",
    "request_open_generator",
    "request_link_generator_pad",
    "request_link_generator_pole",
    "request_link_electric_poles",
    "world_population_request",
    "world_seed_update",
    "world_interaction_update",
    "world_item_drop_create",
    "world_item_drop_update",
    "world_item_drop_pickup",
    "player_position",
]);
const FALLBACK_ROUTE_TYPES = Object.freeze([]);
const HANDLED_ROUTE_TYPES = Object.freeze([
    ...EARLY_HANDLER_ROUTE_TYPES,
    ...POST_ACTION_HANDLER_ROUTE_TYPES,
    ...DIRECT_HANDLER_ROUTE_TYPES,
]);
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function toRecord(value) {
    return isRecord(value) ? value : {};
}
function cleanRouteType(value) {
    return String(value || "").trim();
}
function toRouteSet(values, fallback) {
    const result = new Set(fallback);
    if (!values)
        return result;
    for (const value of values) {
        const routeType = cleanRouteType(value);
        if (routeType)
            result.add(routeType);
    }
    return result;
}
function safePacketMatch(match, packet) {
    try {
        return match(packet) === true;
    }
    catch {
        return false;
    }
}
function getPhase7DropRouteType(data, packetContracts) {
    if (safePacketMatch(packetContracts.isWorldDropCreatePacket.bind(packetContracts), data)) {
        return "world_item_drop_create";
    }
    if (safePacketMatch(packetContracts.isWorldDropUpdateRequestPacket.bind(packetContracts), data)) {
        return "world_item_drop_update";
    }
    if (safePacketMatch(packetContracts.isWorldDropPickupRequestPacket.bind(packetContracts), data)) {
        return "world_item_drop_pickup";
    }
    return "";
}
function getPhase7RouteType(data, packetContracts) {
    const packet = toRecord(data);
    const dropRouteType = getPhase7DropRouteType(packet, packetContracts);
    if (dropRouteType)
        return dropRouteType;
    return cleanRouteType(packet.type);
}
function getActionPositionWorld(config, player, data) {
    if (data.world !== undefined && data.world !== null && cleanRouteType(data.world) !== "") {
        return data.world;
    }
    return config.getPlayerCurrentWorldName(player);
}
function createDispatchResult(routeType, mode, handled, usedActionPosition) {
    return {
        handled,
        route_type: routeType,
        mode,
        phase: "phase7",
        used_action_position: usedActionPosition,
    };
}
function createServerPhase7Dispatcher(config) {
    const fallbackRoutes = toRouteSet(config.fallbackRoutes, FALLBACK_ROUTE_TYPES);
    const postActionPositionRoutes = toRouteSet(config.postActionPositionRoutes, POST_ACTION_HANDLER_ROUTE_TYPES);
    function getRouteMode(routeType) {
        const cleanedRouteType = cleanRouteType(routeType);
        if (!cleanedRouteType)
            return "unknown";
        if (typeof config.handlers[cleanedRouteType] === "function")
            return "handler";
        if (fallbackRoutes.has(cleanedRouteType))
            return "fallback";
        return "unknown";
    }
    function isPostActionPositionRoute(routeType) {
        return postActionPositionRoutes.has(cleanRouteType(routeType));
    }
    async function dispatch(socket, playerRaw, dataRaw, requestContext = {}) {
        const player = toRecord(playerRaw);
        const data = toRecord(dataRaw);
        const routeType = getPhase7RouteType(data, config.packetContracts);
        const mode = getRouteMode(routeType);
        if (mode !== "handler") {
            if (mode === "fallback" && config.onFallbackRoute) {
                config.onFallbackRoute(routeType, data);
            }
            return createDispatchResult(routeType, mode, false, false);
        }
        let usedActionPosition = false;
        if (isPostActionPositionRoute(routeType)) {
            config.applyActionPositionFromPayload(socket, player, data, getActionPositionWorld(config, player, data));
            usedActionPosition = true;
        }
        await config.handlers[routeType](socket, player, data, {
            playerId: cleanRouteType(requestContext.playerId || player.id || ""),
            routeType,
            usedActionPosition,
        });
        return createDispatchResult(routeType, mode, true, usedActionPosition);
    }
    function getRouteCatalog() {
        return {
            handled_routes: [...HANDLED_ROUTE_TYPES],
            fallback_routes: [...fallbackRoutes],
            post_action_position_routes: [...postActionPositionRoutes],
        };
    }
    return {
        dispatch,
        getRouteMode,
        getRouteCatalog,
        isPostActionPositionRoute,
    };
}
module.exports = {
    createServerPhase7Dispatcher,
    getPhase7RouteType,
    HANDLED_ROUTE_TYPES,
    FALLBACK_ROUTE_TYPES,
    POST_ACTION_HANDLER_ROUTE_TYPES,
    DIRECT_HANDLER_ROUTE_TYPES,
};
