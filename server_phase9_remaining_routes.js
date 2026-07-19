// Generated from src/server_phase9_remaining_routes.ts. Do not edit by hand.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function createServerPhase9RemainingRoutes(deps) {
    const { MAX_CHAT_LENGTH, accountKey, broadcastToAuthenticatedPlayers, broadcastToWorld, cleanName, cleanWorld, getPlayerCurrentWorldName, getServerPhase8PlayerSessionRoutes, handleAccountEmailChangeRequest: handleAccountEmailChangeRequestImpl, handleAccountLogin: handleAccountLoginImpl, handleAccountPasswordResetRequest: handleAccountPasswordResetRequestImpl, handleAccountRegister: handleAccountRegisterImpl, handleAccountTokenLogin: handleAccountTokenLoginImpl, handleBatteryChargerRequest: handleBatteryChargerRequestImpl, handleCustomTrustedPlayerState: handleCustomTrustedPlayerStateImpl, handleCustomTrustedPlayerStateClear: handleCustomTrustedPlayerStateClearImpl, handleDevBackendLogin: handleDevBackendLoginImpl, handleDeveloperCommandRequest: handleDeveloperCommandRequestImpl, handleDeveloperPinUnlock: handleDeveloperPinUnlockImpl, handleDoorEnterRequest: handleDoorEnterRequestImpl, handleFriendListRequest: handleFriendListRequestImpl, handleFriendRequest: handleFriendRequestImpl, handleFriendResponse: handleFriendResponseImpl, handleInventoryTransactionRequest: handleInventoryTransactionRequestImpl, handleInventoryUpgradePurchase: handleInventoryUpgradePurchaseImpl, handleNetfoxSpawnTicketRequest: handleNetfoxSpawnTicketRequestImpl, handleNetfoxTrustedPlayerState: handleNetfoxTrustedPlayerStateImpl, handleOilRefineryRequest: handleOilRefineryRequestImpl, handleOwnedLockedWorldsRequest: handleOwnedLockedWorldsRequestImpl, handlePlayerPunch: handlePlayerPunchImpl, handlePullPlayerRequest: handlePullPlayerRequestImpl, handleTradeCancel: handleTradeCancelImpl, handleTradeConfirm: handleTradeConfirmImpl, handleTradeFinalConfirm: handleTradeFinalConfirmImpl, handleTradeOfferUpdate: handleTradeOfferUpdateImpl, handleTradeRequest: handleTradeRequestImpl, handleTradeResponse: handleTradeResponseImpl, rejectIfMuted, rejectIfTradeBanned, requireAuthenticated, sanitizeAccountState, sendActionRejected, sendJson, shouldBlockPlayerChatByAntiTalk, upsertAccount, } = deps;
    function getContextPlayerId(player, context) {
        return String(context.playerId || player.id || "");
    }
    async function callRoute(route, socket, player, data) {
        return await route(socket, player, data);
    }
    function getPhase8PlayerSessionRoutes() {
        return getServerPhase8PlayerSessionRoutes();
    }
    async function handleLogin(socket, player, data, context) {
        player.name = cleanName(data.name);
        sendJson(socket, {
            type: "login_ok",
            player_id: getContextPlayerId(player, context),
            name: player.name,
            username: player.account_username,
            email: player.account_email,
        });
    }
    async function handleAccountRegister(socket, player, data) {
        return await callRoute(handleAccountRegisterImpl, socket, player, data);
    }
    async function handleAccountLogin(socket, player, data) {
        return await callRoute(handleAccountLoginImpl, socket, player, data);
    }
    async function handleAccountTokenLogin(socket, player, data) {
        return await callRoute(handleAccountTokenLoginImpl, socket, player, data);
    }
    async function handleAccountPasswordResetRequest(socket, player, data) {
        return await callRoute(handleAccountPasswordResetRequestImpl, socket, player, data);
    }
    async function handleAccountEmailChangeRequest(socket, player, data) {
        return await callRoute(handleAccountEmailChangeRequestImpl, socket, player, data);
    }
    async function handleDevBackendLogin(socket, player, data) {
        return await callRoute(handleDevBackendLoginImpl, socket, player, data);
    }
    async function handleAccountStateSave(_socket, player, data) {
        const account = sanitizeAccountState(data);
        if (!account)
            return;
        if (!player.authenticated)
            return;
        if (accountKey(account.username) !== accountKey(player.account_username))
            return;
        upsertAccount(account);
    }
    async function handleNetfoxSpawnTicketRequest(socket, player, data) {
        return await callRoute(handleNetfoxSpawnTicketRequestImpl, socket, player, data);
    }
    async function handleNetfoxTrustedPlayerState(socket, player, data) {
        return await callRoute(handleNetfoxTrustedPlayerStateImpl, socket, player, data);
    }
    async function handleCustomTrustedPlayerState(socket, player, data) {
        return await callRoute(handleCustomTrustedPlayerStateImpl, socket, player, data);
    }
    async function handleCustomTrustedPlayerStateClear(socket, player, data) {
        return await callRoute(handleCustomTrustedPlayerStateClearImpl, socket, player, data);
    }
    async function handleInventoryTransactionRequest(socket, player, data) {
        return await callRoute(handleInventoryTransactionRequestImpl, socket, player, data);
    }
    async function handleInventoryUpgradePurchase(socket, player, data) {
        return await callRoute(handleInventoryUpgradePurchaseImpl, socket, player, data);
    }
    async function handleTradeRequestRoute(socket, player, data) {
        if (await rejectIfTradeBanned(socket, player, data))
            return undefined;
        return await callRoute(handleTradeRequestImpl, socket, player, data);
    }
    async function handleTradeResponseRoute(socket, player, data) {
        if (await rejectIfTradeBanned(socket, player, data))
            return undefined;
        return await callRoute(handleTradeResponseImpl, socket, player, data);
    }
    async function handleFriendListRequestRoute(socket, player, data) {
        return await callRoute(handleFriendListRequestImpl, socket, player, data);
    }
    async function handleFriendRequestRoute(socket, player, data) {
        return await callRoute(handleFriendRequestImpl, socket, player, data);
    }
    async function handleFriendResponseRoute(socket, player, data) {
        return await callRoute(handleFriendResponseImpl, socket, player, data);
    }
    async function handleTradeOfferUpdateRoute(socket, player, data) {
        if (await rejectIfTradeBanned(socket, player, data))
            return undefined;
        return await callRoute(handleTradeOfferUpdateImpl, socket, player, data);
    }
    async function handleTradeConfirmRoute(socket, player, data) {
        if (await rejectIfTradeBanned(socket, player, data))
            return undefined;
        return await callRoute(handleTradeConfirmImpl, socket, player, data);
    }
    async function handleTradeFinalConfirmRoute(socket, player, data) {
        if (await rejectIfTradeBanned(socket, player, data))
            return undefined;
        return await callRoute(handleTradeFinalConfirmImpl, socket, player, data);
    }
    async function handleTradeCancelRoute(socket, player, data) {
        return await callRoute(handleTradeCancelImpl, socket, player, data);
    }
    async function handlePlayerStateRequest(socket, player, data, context) {
        return await getPhase8PlayerSessionRoutes().handlePlayerStateRequest(socket, player, data, context);
    }
    async function handleOwnedLockedWorldsRequestRoute(socket, player, data) {
        return await callRoute(handleOwnedLockedWorldsRequestImpl, socket, player, data);
    }
    async function handlePullPlayerRequestRoute(socket, player, data) {
        return await callRoute(handlePullPlayerRequestImpl, socket, player, data);
    }
    async function handleDoorEnter(socket, player, data) {
        return await callRoute(handleDoorEnterRequestImpl, socket, player, data);
    }
    async function handlePlayerStateSave(socket, player, data, context) {
        return await getPhase8PlayerSessionRoutes().handlePlayerStateSave(socket, player, data, context);
    }
    async function handleJoinWorld(socket, player, data, context) {
        return await getPhase8PlayerSessionRoutes().handleJoinWorld(socket, player, data, context);
    }
    async function handleLeaveWorld(socket, player, data, context) {
        return await getPhase8PlayerSessionRoutes().handleLeaveWorld(socket, player, data, context);
    }
    async function handleChat(socket, player, data, context) {
        if (!requireAuthenticated(socket, player, "chat"))
            return;
        const message = String(data.message || "").trim().slice(0, MAX_CHAT_LENGTH);
        if (message.length === 0)
            return;
        if (await rejectIfMuted(socket, player, "chat"))
            return;
        if (message.toLowerCase().startsWith("/bc ")) {
            const broadcastMessage = message.slice(4).trim().slice(0, MAX_CHAT_LENGTH);
            if (broadcastMessage.length > 0) {
                const broadcastWorld = getPlayerCurrentWorldName(player);
                broadcastToAuthenticatedPlayers({
                    type: "broadcast",
                    player_id: getContextPlayerId(player, context),
                    name: player.name,
                    message: broadcastMessage,
                    world: broadcastWorld,
                    current_world: broadcastWorld,
                });
            }
            return;
        }
        const chatWorld = cleanWorld(player.world || getPlayerCurrentWorldName(player) || "START");
        if (shouldBlockPlayerChatByAntiTalk(player, chatWorld)) {
            sendActionRejected(socket, "chat", "Anti-talk is enabled in this world.", {
                reason: "anti_talk_enabled",
                world: chatWorld,
            });
            return;
        }
        broadcastToWorld(chatWorld, {
            type: "chat",
            player_id: getContextPlayerId(player, context),
            name: player.name,
            message,
            world: chatWorld,
        });
    }
    async function handleBroadcast(socket, player, data, context) {
        if (!requireAuthenticated(socket, player, "broadcast"))
            return;
        const message = String(data.message || "").trim().slice(0, MAX_CHAT_LENGTH);
        if (message.length === 0)
            return;
        if (await rejectIfMuted(socket, player, "broadcast"))
            return;
        const broadcastWorld = getPlayerCurrentWorldName(player);
        broadcastToAuthenticatedPlayers({
            type: "broadcast",
            player_id: getContextPlayerId(player, context),
            name: player.name,
            message,
            world: broadcastWorld,
            current_world: broadcastWorld,
        });
    }
    async function handleDeveloperPinUnlockRoute(socket, player, data) {
        return await callRoute(handleDeveloperPinUnlockImpl, socket, player, data);
    }
    async function handleDeveloperCommandRequestRoute(socket, player, data) {
        return await callRoute(handleDeveloperCommandRequestImpl, socket, player, data);
    }
    async function handleOilRefineryRequestRoute(socket, player, data) {
        return await callRoute(handleOilRefineryRequestImpl, socket, player, data);
    }
    async function handleBatteryChargerRequestRoute(socket, player, data) {
        return await callRoute(handleBatteryChargerRequestImpl, socket, player, data);
    }
    async function handlePlayerPunchRoute(socket, player, data) {
        return await callRoute(handlePlayerPunchImpl, socket, player, data);
    }
    return {
        handleLogin,
        handleAccountRegister,
        handleAccountLogin,
        handleAccountTokenLogin,
        handleAccountPasswordResetRequest,
        handleAccountEmailChangeRequest,
        handleDevBackendLogin,
        handleAccountStateSave,
        handleNetfoxSpawnTicketRequest,
        handleNetfoxTrustedPlayerState,
        handleCustomTrustedPlayerState,
        handleCustomTrustedPlayerStateClear,
        handleInventoryTransactionRequest,
        handleInventoryUpgradePurchase,
        handleTradeRequestRoute,
        handleTradeResponseRoute,
        handleFriendListRequestRoute,
        handleFriendRequestRoute,
        handleFriendResponseRoute,
        handleTradeOfferUpdateRoute,
        handleTradeConfirmRoute,
        handleTradeFinalConfirmRoute,
        handleTradeCancelRoute,
        handlePlayerStateRequest,
        handleOwnedLockedWorldsRequestRoute,
        handlePullPlayerRequestRoute,
        handleDoorEnter,
        handlePlayerStateSave,
        handleJoinWorld,
        handleLeaveWorld,
        handleChat,
        handleBroadcast,
        handleDeveloperPinUnlockRoute,
        handleDeveloperCommandRequestRoute,
        handleOilRefineryRequestRoute,
        handleBatteryChargerRequestRoute,
        handlePlayerPunchRoute,
    };
}
module.exports = {
    createServerPhase9RemainingRoutes,
};
