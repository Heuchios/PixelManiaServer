"use strict";

export {};

type PacketRecord = Record<string, any>;
type MaybePromise<T> = T | Promise<T>;

interface RouteContext {
  playerId?: string;
  routeType?: string;
  usedActionPosition?: boolean;
}

interface Phase9RemainingRouteDeps extends Record<string, any> {}

function createServerPhase9RemainingRoutes(deps: Phase9RemainingRouteDeps) {
  const {
    MAX_CHAT_LENGTH,
    accountKey,
    broadcastToAuthenticatedPlayers,
    broadcastToWorld,
    cleanName,
    cleanWorld,
    getPlayerCurrentWorldName,
    getServerPhase8PlayerSessionRoutes,
    handleAccountEmailChangeRequest: handleAccountEmailChangeRequestImpl,
    handleAccountLogin: handleAccountLoginImpl,
    handleAccountPasswordResetRequest: handleAccountPasswordResetRequestImpl,
    handleAccountRegister: handleAccountRegisterImpl,
    handleAccountTokenLogin: handleAccountTokenLoginImpl,
    handleBatteryChargerRequest: handleBatteryChargerRequestImpl,
    handleCustomTrustedPlayerState: handleCustomTrustedPlayerStateImpl,
    handleCustomTrustedPlayerStateClear: handleCustomTrustedPlayerStateClearImpl,
    handleDevBackendLogin: handleDevBackendLoginImpl,
    handleDeveloperCommandRequest: handleDeveloperCommandRequestImpl,
    handleDeveloperPinUnlock: handleDeveloperPinUnlockImpl,
    handleDoorEnterRequest: handleDoorEnterRequestImpl,
    handleFriendListRequest: handleFriendListRequestImpl,
    handleFriendRequest: handleFriendRequestImpl,
    handleFriendResponse: handleFriendResponseImpl,
    handleInventoryTransactionRequest: handleInventoryTransactionRequestImpl,
    handleInventoryUpgradePurchase: handleInventoryUpgradePurchaseImpl,
    handleNetfoxSpawnTicketRequest: handleNetfoxSpawnTicketRequestImpl,
    handleNetfoxTrustedPlayerState: handleNetfoxTrustedPlayerStateImpl,
    handleOilRefineryRequest: handleOilRefineryRequestImpl,
    handleOwnedLockedWorldsRequest: handleOwnedLockedWorldsRequestImpl,
    handlePlayerPunch: handlePlayerPunchImpl,
    handlePullPlayerRequest: handlePullPlayerRequestImpl,
    handleTradeCancel: handleTradeCancelImpl,
    handleTradeConfirm: handleTradeConfirmImpl,
    handleTradeFinalConfirm: handleTradeFinalConfirmImpl,
    handleTradeOfferUpdate: handleTradeOfferUpdateImpl,
    handleTradeRequest: handleTradeRequestImpl,
    handleTradeResponse: handleTradeResponseImpl,
    handleWorldHonorTopCommand: handleWorldHonorTopCommandImpl,
    rejectIfMuted,
    rejectIfTradeBanned,
    requireAuthenticated,
    sanitizeAccountState,
    sendActionRejected,
    sendJson,
    shouldBlockPlayerChatByAntiTalk,
    upsertAccount,
  } = deps;

  function getContextPlayerId(player: PacketRecord, context: RouteContext): string {
    return String(context.playerId || player.id || "");
  }

  async function callRoute(
    route: (socket: unknown, player: PacketRecord, data: PacketRecord) => MaybePromise<unknown>,
    socket: unknown,
    player: PacketRecord,
    data: PacketRecord,
  ): Promise<unknown> {
    return await route(socket, player, data);
  }

  function getPhase8PlayerSessionRoutes(): PacketRecord {
    return getServerPhase8PlayerSessionRoutes();
  }

  async function handleLogin(socket: unknown, player: PacketRecord, data: PacketRecord, context: RouteContext): Promise<void> {
    player.name = cleanName(data.name);

    sendJson(socket, {
      type: "login_ok",
      player_id: getContextPlayerId(player, context),
      name: player.name,
      username: player.account_username,
      email: player.account_email,
    });
  }

  async function handleAccountRegister(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleAccountRegisterImpl, socket, player, data);
  }

  async function handleAccountLogin(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleAccountLoginImpl, socket, player, data);
  }

  async function handleAccountTokenLogin(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleAccountTokenLoginImpl, socket, player, data);
  }

  async function handleAccountPasswordResetRequest(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleAccountPasswordResetRequestImpl, socket, player, data);
  }

  async function handleAccountEmailChangeRequest(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleAccountEmailChangeRequestImpl, socket, player, data);
  }

  async function handleDevBackendLogin(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleDevBackendLoginImpl, socket, player, data);
  }

  async function handleAccountStateSave(_socket: unknown, player: PacketRecord, data: PacketRecord): Promise<void> {
    const account = sanitizeAccountState(data);
    if (!account) return;
    if (!player.authenticated) return;
    if (accountKey(account.username) !== accountKey(player.account_username)) return;

    upsertAccount(account);
  }

  async function handleNetfoxSpawnTicketRequest(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleNetfoxSpawnTicketRequestImpl, socket, player, data);
  }

  async function handleNetfoxTrustedPlayerState(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleNetfoxTrustedPlayerStateImpl, socket, player, data);
  }

  async function handleCustomTrustedPlayerState(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleCustomTrustedPlayerStateImpl, socket, player, data);
  }

  async function handleCustomTrustedPlayerStateClear(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleCustomTrustedPlayerStateClearImpl, socket, player, data);
  }

  async function handleInventoryTransactionRequest(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleInventoryTransactionRequestImpl, socket, player, data);
  }

  async function handleInventoryUpgradePurchase(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleInventoryUpgradePurchaseImpl, socket, player, data);
  }

  async function handleTradeRequestRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    if (await rejectIfTradeBanned(socket, player, data)) return undefined;
    return await callRoute(handleTradeRequestImpl, socket, player, data);
  }

  async function handleTradeResponseRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    if (await rejectIfTradeBanned(socket, player, data)) return undefined;
    return await callRoute(handleTradeResponseImpl, socket, player, data);
  }

  async function handleFriendListRequestRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleFriendListRequestImpl, socket, player, data);
  }

  async function handleFriendRequestRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleFriendRequestImpl, socket, player, data);
  }

  async function handleFriendResponseRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleFriendResponseImpl, socket, player, data);
  }

  async function handleTradeOfferUpdateRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    if (await rejectIfTradeBanned(socket, player, data)) return undefined;
    return await callRoute(handleTradeOfferUpdateImpl, socket, player, data);
  }

  async function handleTradeConfirmRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    if (await rejectIfTradeBanned(socket, player, data)) return undefined;
    return await callRoute(handleTradeConfirmImpl, socket, player, data);
  }

  async function handleTradeFinalConfirmRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    if (await rejectIfTradeBanned(socket, player, data)) return undefined;
    return await callRoute(handleTradeFinalConfirmImpl, socket, player, data);
  }

  async function handleTradeCancelRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleTradeCancelImpl, socket, player, data);
  }

  async function handlePlayerStateRequest(socket: unknown, player: PacketRecord, data: PacketRecord, context: RouteContext): Promise<unknown> {
    return await getPhase8PlayerSessionRoutes().handlePlayerStateRequest(socket, player, data, context);
  }

  async function handleOwnedLockedWorldsRequestRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleOwnedLockedWorldsRequestImpl, socket, player, data);
  }

  async function handlePullPlayerRequestRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handlePullPlayerRequestImpl, socket, player, data);
  }

  async function handleDoorEnter(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleDoorEnterRequestImpl, socket, player, data);
  }

  async function handlePlayerStateSave(socket: unknown, player: PacketRecord, data: PacketRecord, context: RouteContext): Promise<unknown> {
    return await getPhase8PlayerSessionRoutes().handlePlayerStateSave(socket, player, data, context);
  }

  async function handleJoinWorld(socket: unknown, player: PacketRecord, data: PacketRecord, context: RouteContext): Promise<unknown> {
    return await getPhase8PlayerSessionRoutes().handleJoinWorld(socket, player, data, context);
  }

  async function handleLeaveWorld(socket: unknown, player: PacketRecord, data: PacketRecord, context: RouteContext): Promise<unknown> {
    return await getPhase8PlayerSessionRoutes().handleLeaveWorld(socket, player, data, context);
  }

  async function handleChat(socket: unknown, player: PacketRecord, data: PacketRecord, context: RouteContext): Promise<void> {
    if (!requireAuthenticated(socket, player, "chat")) return;

    const message = String(data.message || "").trim().slice(0, MAX_CHAT_LENGTH);
    if (message.length === 0) return;
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage === "/top" ||
      lowerMessage.startsWith("/top ") ||
      lowerMessage === "/honors" ||
      lowerMessage.startsWith("/honors ")
    ) {
      await handleWorldHonorTopCommandImpl(socket, player, message);
      return;
    }
    if (await rejectIfMuted(socket, player, "chat")) return;

    if (lowerMessage.startsWith("/bc ")) {
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

  async function handleBroadcast(socket: unknown, player: PacketRecord, data: PacketRecord, context: RouteContext): Promise<void> {
    if (!requireAuthenticated(socket, player, "broadcast")) return;

    const message = String(data.message || "").trim().slice(0, MAX_CHAT_LENGTH);
    if (message.length === 0) return;
    if (await rejectIfMuted(socket, player, "broadcast")) return;

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

  async function handleDeveloperPinUnlockRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleDeveloperPinUnlockImpl, socket, player, data);
  }

  async function handleDeveloperCommandRequestRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleDeveloperCommandRequestImpl, socket, player, data);
  }

  async function handleOilRefineryRequestRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleOilRefineryRequestImpl, socket, player, data);
  }

  async function handleBatteryChargerRequestRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
    return await callRoute(handleBatteryChargerRequestImpl, socket, player, data);
  }

  async function handlePlayerPunchRoute(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<unknown> {
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
