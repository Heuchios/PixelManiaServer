"use strict";


type PacketRecord = Record<string, any>;
type MaybePromise<T> = T | Promise<T>;

interface TradeRoutesDeps extends Record<string, any> {}

function createServerTradeRoutes(deps: TradeRoutesDeps) {
  const {
    ItemDatabase,
    MAX_ITEM_STACK,
    PUNISHMENT_SCOPE_GLOBAL,
    TRADE_SLOT_COUNT,
    accountKey,
    activeTrades,
    arePlayersCloseEnoughForTrade,
    cancelTrade,
    cleanAccountName,
    clampInteger,
    clampString,
    cryptoRandomUUID,
    ensureWritablePlayerState,
    executeTrade,
    findOnlinePlayerByPlayerId,
    findOnlinePlayerByUsername,
    formatPunishmentBlockMessage,
    getBlockingPunishment,
    getInventoryCount,
    getTradeParticipantRecord,
    getTradePartyIds,
    isTradeParticipant,
    logSecurityEvent,
    makeTradeSlots,
    requireAuthenticated,
    resolveInventoryCategory,
    sendJson,
    sendPunishmentNotice,
    sendTradeChat,
    sendTradeError,
    sendTradeState,
    tradeByPlayerId,
  } = deps;

  function getCurrentTrade(player: PacketRecord, data: PacketRecord): PacketRecord | null {
    const tradeId = String(data.trade_id || tradeByPlayerId.get(player.id) || "");
    return tradeId ? activeTrades.get(tradeId) || null : null;
  }

  async function handleTradeRequest(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<void> {
    if (!requireAuthenticated(socket, player, "trade")) return;

    if (tradeByPlayerId.has(player.id)) {
      sendTradeError(socket, data, "Finish your current trade first.");
      return;
    }

    const targetPlayerId = String(data.target_player_id || data.player_id || "").trim();
    const targetUsername = cleanAccountName(data.target_username || data.username || "");
    let targetRecord = targetPlayerId !== "" ? findOnlinePlayerByPlayerId(targetPlayerId) : null;

    if (!targetRecord && targetUsername !== "") {
      targetRecord = findOnlinePlayerByUsername(targetUsername);
    }

    if (!targetRecord || !targetRecord.player.authenticated) {
      sendTradeError(socket, data, "That player is not online.");
      return;
    }

    const target = targetRecord.player;
    if (target.id === player.id || accountKey(target.account_username) === accountKey(player.account_username)) {
      sendTradeError(socket, data, "You cannot trade with yourself.");
      return;
    }

    if (tradeByPlayerId.has(target.id)) {
      sendTradeError(socket, data, "That player is already trading.");
      return;
    }

    if (!arePlayersCloseEnoughForTrade(player, target)) {
      sendTradeError(socket, data, "Move closer to that player to trade.");
      return;
    }

    const targetPunishment = await getBlockingPunishment(target.account_username, ["trade_ban"], {
      scope: PUNISHMENT_SCOPE_GLOBAL,
    });
    if (targetPunishment) {
      sendTradeError(socket, data, `${target.account_username} cannot trade right now.`);
      sendPunishmentNotice(targetRecord.socket, target, formatPunishmentBlockMessage("trade", targetPunishment), targetPunishment);
      logSecurityEvent(socket, player, "punishment_blocked_trade_target", {
        target_username: target.account_username,
        punishment_type: "trade_ban",
        punishment_id: targetPunishment.punishment_id,
      }, "warning");
      return;
    }

    const tradeId = cryptoRandomUUID();
    const trade: PacketRecord = {
      id: tradeId,
      status: "pending",
      world: player.world,
      requester_id: player.id,
      requester_username: player.account_username,
      target_id: target.id,
      target_username: target.account_username,
      offers: {},
      accepted: {},
      final_accepted: {},
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    trade.offers[player.id] = makeTradeSlots();
    trade.offers[target.id] = makeTradeSlots();
    trade.accepted[player.id] = false;
    trade.accepted[target.id] = false;
    trade.final_accepted[player.id] = false;
    trade.final_accepted[target.id] = false;

    activeTrades.set(tradeId, trade);
    tradeByPlayerId.set(player.id, tradeId);
    tradeByPlayerId.set(target.id, tradeId);

    sendTradeChat(target.id, `${player.account_username} wants to trade with you.`);
    sendTradeChat(player.id, `Trade request sent to ${target.account_username}.`);
    sendJson(targetRecord.socket, {
      type: "trade_request_received",
      trade_id: trade.id,
      requester_player_id: trade.requester_id,
      requester_username: trade.requester_username,
      target_player_id: trade.target_id,
      target_username: trade.target_username,
      world: trade.world,
      message: `${trade.requester_username} wants to trade. Type /trade ${trade.requester_username} or wrench that player to accept.`,
    });
    sendJson(socket, {
      type: "trade_request_sent",
      trade_id: trade.id,
      requester_player_id: trade.requester_id,
      requester_username: trade.requester_username,
      target_player_id: trade.target_id,
      target_username: trade.target_username,
      world: trade.world,
      message: `Trade request sent to ${trade.target_username}.`,
    });
  }

  function findTradeForResponse(player: PacketRecord, data: PacketRecord): PacketRecord | null {
    const explicitTradeId = String(data.trade_id || "").trim();
    if (explicitTradeId !== "") return activeTrades.get(explicitTradeId) || null;

    const requesterUsername = cleanAccountName(data.requester_username || data.target_username || data.username || "");
    if (requesterUsername !== "") {
      for (const trade of activeTrades.values()) {
        if (trade.status !== "pending") continue;
        if (trade.target_id !== player.id) continue;
        if (accountKey(trade.requester_username) !== accountKey(requesterUsername)) continue;
        return trade;
      }
    }

    const tradeId = tradeByPlayerId.get(player.id);
    return tradeId ? activeTrades.get(tradeId) || null : null;
  }

  function handleTradeResponse(socket: unknown, player: PacketRecord, data: PacketRecord): void {
    if (!requireAuthenticated(socket, player, "trade")) return;

    const trade = findTradeForResponse(player, data);
    if (!trade || !isTradeParticipant(trade, player.id)) {
      sendTradeError(socket, data, "Trade not found.");
      return;
    }

    if (trade.status !== "pending") {
      sendTradeError(socket, data, "That trade request is no longer pending.");
      return;
    }

    if (player.id !== trade.target_id) {
      sendTradeError(socket, data, "Only the requested player can accept this trade.");
      return;
    }

    const accepted = Boolean(data.accepted);
    if (!accepted) {
      cancelTrade(trade, `${player.account_username} declined the trade.`);
      return;
    }

    const requesterRecord = getTradeParticipantRecord(trade.requester_id);
    if (!requesterRecord || requesterRecord.player.world !== player.world) {
      cancelTrade(trade, "Trade canceled because a player is no longer available.");
      return;
    }

    trade.status = "active";
    trade.updated_at = Date.now();
    sendTradeState(trade, "Trade started.");
  }

  function sanitizeTradeOfferItem(data: PacketRecord): PacketRecord | null {
    const slotIndex = clampInteger(data.slot_index, 0, TRADE_SLOT_COUNT - 1);
    const amount = clampInteger(data.amount || 0, 0, MAX_ITEM_STACK);
    if (amount <= 0) {
      return { slotIndex, item: null };
    }

    const itemId = clampString(data.item_id || data.item_type || data.item || "");
    if (itemId === "" || itemId === "punch") return null;
    if (!ItemDatabase.hasItem(itemId)) return null;
    if (!ItemDatabase.isTradeableItem(itemId)) return null;

    const itemCategory = resolveInventoryCategory(itemId, data.item_category || data.category || "");
    if (itemId === "" || itemCategory === "" || itemId === "punch") return null;
    if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) return null;

    return {
      slotIndex,
      item: {
        item_id: itemId,
        item_category: itemCategory,
        amount: clampInteger(amount, 1, ItemDatabase.getStackLimit(itemId)),
      },
    };
  }

  function getTradeOfferTotals(slots: PacketRecord[], overrideSlot = -1, overrideItem: PacketRecord | null = null): PacketRecord[] {
    const totals = new Map<string, PacketRecord>();

    for (let i = 0; i < TRADE_SLOT_COUNT; i += 1) {
      const item = i === overrideSlot ? overrideItem : slots[i];
      if (!item) continue;

      const itemId = clampString(item.item_id || "");
      if (!ItemDatabase.hasItem(itemId)) continue;
      const itemCategory = resolveInventoryCategory(itemId, item.item_category || "");
      const amount = clampInteger(item.amount || 0, 0, ItemDatabase.getStackLimit(itemId));
      if (itemId === "" || itemCategory === "" || amount <= 0) continue;
      if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) continue;

      const key = `${itemCategory}:${itemId}`;
      const existing = totals.get(key) || { item_id: itemId, item_category: itemCategory, amount: 0 };
      existing.amount = clampInteger(existing.amount + amount, 0, ItemDatabase.getStackLimit(itemId));
      totals.set(key, existing);
    }

    return Array.from(totals.values());
  }

  function canOfferTradeItems(username: string, slots: PacketRecord[], overrideSlot = -1, overrideItem: PacketRecord | null = null): PacketRecord {
    const state = ensureWritablePlayerState(username);
    if (!state) return { ok: false, message: "Could not load server inventory." };

    const totals = getTradeOfferTotals(slots, overrideSlot, overrideItem);
    for (const item of totals) {
      if (!ItemDatabase.isTradeableItem(item.item_id)) {
        return { ok: false, message: `${item.item_id} cannot be traded.` };
      }

      if (getInventoryCount(state, item.item_id, item.item_category) < item.amount) {
        return { ok: false, message: `Not enough ${item.item_id}.` };
      }
    }

    return { ok: true };
  }

  function resetTradeApprovals(trade: PacketRecord): void {
    for (const playerId of getTradePartyIds(trade)) {
      trade.accepted[playerId] = false;
      trade.final_accepted[playerId] = false;
    }
  }

  function handleTradeOfferUpdate(socket: unknown, player: PacketRecord, data: PacketRecord): void {
    if (!requireAuthenticated(socket, player, "trade")) return;

    const trade = getCurrentTrade(player, data);
    if (!trade || !isTradeParticipant(trade, player.id)) {
      sendTradeError(socket, data, "Trade not found.");
      return;
    }

    if (trade.status !== "active") {
      sendTradeError(socket, data, "You cannot change items during final confirmation.");
      return;
    }

    const parsed = sanitizeTradeOfferItem(data);
    if (!parsed) {
      sendTradeError(socket, data, "Invalid trade item.");
      return;
    }

    const offerSlots = trade.offers[player.id] || makeTradeSlots();
    const validation = canOfferTradeItems(player.account_username, offerSlots, parsed.slotIndex, parsed.item);
    if (!validation.ok) {
      sendTradeError(socket, data, validation.message);
      return;
    }

    offerSlots[parsed.slotIndex] = parsed.item;
    trade.offers[player.id] = offerSlots;
    resetTradeApprovals(trade);
    trade.updated_at = Date.now();
    sendTradeState(trade, "Trade offer updated.");
  }

  function handleTradeConfirm(socket: unknown, player: PacketRecord, data: PacketRecord): void {
    if (!requireAuthenticated(socket, player, "trade")) return;

    const trade = getCurrentTrade(player, data);
    if (!trade || !isTradeParticipant(trade, player.id)) {
      sendTradeError(socket, data, "Trade not found.");
      return;
    }

    if (trade.status !== "active") {
      sendTradeError(socket, data, "Trade is not ready for confirmation.");
      return;
    }

    const validation = canOfferTradeItems(player.account_username, trade.offers[player.id] || makeTradeSlots());
    if (!validation.ok) {
      sendTradeError(socket, data, validation.message);
      return;
    }

    trade.accepted[player.id] = true;
    trade.updated_at = Date.now();

    if (getTradePartyIds(trade).every((playerId: string) => Boolean(trade.accepted[playerId]))) {
      trade.status = "final_pending";
      for (const playerId of getTradePartyIds(trade)) {
        trade.final_accepted[playerId] = false;
      }
      sendTradeState(trade, "Final confirmation required.");
      return;
    }

    sendTradeState(trade, `${player.account_username} accepted the trade.`);
  }

  async function handleTradeFinalConfirm(socket: unknown, player: PacketRecord, data: PacketRecord): Promise<void> {
    if (!requireAuthenticated(socket, player, "trade")) return;

    const trade = getCurrentTrade(player, data);
    if (!trade || !isTradeParticipant(trade, player.id)) {
      sendTradeError(socket, data, "Trade not found.");
      return;
    }

    if (trade.status !== "final_pending") {
      sendTradeError(socket, data, "Final confirmation is not ready.");
      return;
    }

    trade.final_accepted[player.id] = true;
    trade.updated_at = Date.now();

    if (getTradePartyIds(trade).every((playerId: string) => Boolean(trade.final_accepted[playerId]))) {
      await executeTrade(trade);
      return;
    }

    sendTradeState(trade, `${player.account_username} final-confirmed the trade.`);
  }

  function handleTradeCancel(socket: unknown, player: PacketRecord, data: PacketRecord): void {
    if (!requireAuthenticated(socket, player, "trade")) return;

    const trade = getCurrentTrade(player, data);
    if (!trade || !isTradeParticipant(trade, player.id)) {
      sendTradeError(socket, data, "Trade not found.");
      return;
    }

    cancelTrade(trade, `${player.account_username} canceled the trade.`);
  }

  async function callTradeRoute(
    route: (socket: unknown, player: PacketRecord, data: PacketRecord) => MaybePromise<unknown>,
    socket: unknown,
    player: PacketRecord,
    data: PacketRecord,
  ): Promise<unknown> {
    return await route(socket, player, data);
  }

  return {
    canOfferTradeItems,
    callTradeRoute,
    findTradeForResponse,
    getTradeOfferTotals,
    handleTradeCancel,
    handleTradeConfirm,
    handleTradeFinalConfirm,
    handleTradeOfferUpdate,
    handleTradeRequest,
    handleTradeResponse,
    resetTradeApprovals,
    sanitizeTradeOfferItem,
  };
}

export = {
  createServerTradeRoutes,
};
