// Generated from src/server_inventory_economy_routes.ts. Do not edit by hand.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function createServerInventoryEconomyRoutes(deps) {
    const { BASIC_ITEMS_PACK_TABLE, HAIR_PACK_TABLE, INVENTORY_MAX_SLOT_COUNT, INVENTORY_SLOT_UPGRADE_STEP, ItemDatabase, LURE_PACK_TABLE, MAX_SHOP_PRICE, PRESTIGE_COLOURED_BLOCK_PACK_TABLE, SHOP_CATALOG, addItemToState, buildInventoryDeltaClientPayloads, buildInventoryUpgradePreview, buildPlayerStateForClient, clampInteger, clampString, cleanAccountName, cloneJson, combineRewardEntries, commitPlayerInventoryState, ensureWritablePlayerState, getInventoryCount, handleDisplayTransaction, handleDropInventoryItemTransaction, handleFishMongerTransaction, handleFishingCompleteTransaction, handleFishingStartTransaction, handleSafeTransaction, handleSeedHarvestTransaction, handleSeedPlaceTransaction, handleSeedSpliceTransaction, handleStationRecipeTransaction, handleTrashInventoryItemTransaction, handleVendingTransaction, handleWorldLockConversionTransaction, handleWorldLockGetKeyTransaction, logItemLedgerForState, logRewardLedgers, logShopPurchase, makeAuditId, makeRequestId, requireAuthenticated, resolveInventorySlotCount, rollWeightedReward, sendInventoryTransactionRejected, sendInventoryTransactionResult, sendSystemChatToPlayer, spendItemFromState, tradeByPlayerId, } = deps;
    const delegatedInventoryActions = new Map([
        ["vend_get_state", handleVendingTransaction],
        ["vend_set_listing", handleVendingTransaction],
        ["vend_buy", handleVendingTransaction],
        ["vend_collect", handleVendingTransaction],
        ["vend_cancel", handleVendingTransaction],
        ["safe_get_state", handleSafeTransaction],
        ["safe_deposit", handleSafeTransaction],
        ["safe_withdraw", handleSafeTransaction],
        ["display_get_state", handleDisplayTransaction],
        ["display_deposit", handleDisplayTransaction],
        ["display_withdraw", handleDisplayTransaction],
        ["craft_recipe", handleStationRecipeTransaction],
        ["furnace_recipe", handleStationRecipeTransaction],
        ["fishing_start", handleFishingStartTransaction],
        ["fishing_complete", handleFishingCompleteTransaction],
        ["fish_monger_sell", handleFishMongerTransaction],
        ["fish_monger_sell_all", handleFishMongerTransaction],
        ["drop_inventory_item", handleDropInventoryItemTransaction],
        ["trash_inventory_item", handleTrashInventoryItemTransaction],
        ["convert_world_lock", handleWorldLockConversionTransaction],
        ["world_lock_get_key", handleWorldLockGetKeyTransaction],
        ["seed_place", handleSeedPlaceTransaction],
        ["seed_splice", handleSeedSpliceTransaction],
        ["seed_harvest", handleSeedHarvestTransaction],
    ]);
    function getPackRewardTable(itemId) {
        if (itemId === "lure_pack")
            return LURE_PACK_TABLE;
        if (itemId === "basic_items_pack")
            return BASIC_ITEMS_PACK_TABLE;
        if (itemId === "hairpack")
            return HAIR_PACK_TABLE;
        if (itemId === "prestige_coloured_block_pack")
            return PRESTIGE_COLOURED_BLOCK_PACK_TABLE;
        return null;
    }
    function getShopPurchaseMessage(itemId, listing) {
        if (itemId === "lure_pack")
            return "Purchased and opened Lure Pack.";
        if (itemId === "basic_items_pack")
            return "Purchased and opened Basic Items Pack.";
        if (itemId === "hairpack")
            return "Purchased and opened Hair Pack.";
        if (itemId === "prestige_coloured_block_pack")
            return "Purchased and opened Prestige Coloured Block Pack.";
        return `Purchased ${listing.item_id}.`;
    }
    async function handleInventoryTransactionRequest(socket, player, data) {
        if (!requireAuthenticated(socket, player, "change inventory"))
            return;
        const action = String(data.action || "").trim();
        if (action === "shop_buy") {
            await handleShopBuyTransaction(socket, player, data);
            return;
        }
        const handler = delegatedInventoryActions.get(action);
        if (handler) {
            await handler(socket, player, data);
            return;
        }
        sendInventoryTransactionRejected(socket, data, "Unknown inventory transaction.");
    }
    async function handleInventoryUpgradePurchase(socket, player, data = {}) {
        if (!requireAuthenticated(socket, player, "upgrade inventory"))
            return;
        const requestId = makeRequestId(data);
        if (tradeByPlayerId.has(player?.id || socket?.playerId || "")) {
            sendInventoryTransactionResult(socket, {
                ok: false,
                request_id: requestId,
                action: "inventory_slot_upgrade",
                message: "Finish or cancel your trade before upgrading inventory.",
            });
            return;
        }
        const username = cleanAccountName(player?.account_username || player?.name || "");
        if (username === "")
            return;
        const state = ensureWritablePlayerState(username);
        if (!state) {
            sendInventoryTransactionResult(socket, {
                ok: false,
                request_id: requestId,
                action: "inventory_slot_upgrade",
                message: "Could not load your server inventory.",
            });
            return;
        }
        state.inventory_slot_count = resolveInventorySlotCount(state);
        const currentSlots = state.inventory_slot_count;
        const preview = buildInventoryUpgradePreview(currentSlots);
        if (currentSlots >= INVENTORY_MAX_SLOT_COUNT || preview.cost <= 0) {
            sendInventoryTransactionResult(socket, {
                ok: false,
                request_id: requestId,
                action: "inventory_slot_upgrade",
                message: "Inventory is already fully upgraded.",
                username,
                player_data: buildPlayerStateForClient(state),
                ...preview,
            });
            return;
        }
        const gemBalance = getInventoryCount(state, "gem", "currency");
        if (gemBalance < preview.cost) {
            sendSystemChatToPlayer(socket, player, "you dont have enough gems for this purchase.");
            sendInventoryTransactionResult(socket, {
                ok: false,
                request_id: requestId,
                action: "inventory_slot_upgrade",
                message: "",
                reason: "insufficient_gems",
                username,
                ...preview,
            });
            return;
        }
        const beforeState = cloneJson(state);
        const stagedState = cloneJson(state);
        stagedState.inventory_slot_count = preview.next_slots;
        if (!spendItemFromState(stagedState, "gem", "currency", preview.cost)) {
            sendSystemChatToPlayer(socket, player, "you dont have enough gems for this purchase.");
            sendInventoryTransactionResult(socket, {
                ok: false,
                request_id: requestId,
                action: "inventory_slot_upgrade",
                message: "",
                reason: "insufficient_gems",
                username,
                ...preview,
            });
            return;
        }
        const purchaseId = makeAuditId("inventory_slot_upgrade");
        const commit = await commitPlayerInventoryState(socket, player, username, beforeState, stagedState, {
            source: "inventory_upgrade",
            action: "inventory_slot_upgrade",
            reason: "inventory_slot_upgrade",
            request_id: requestId,
            world: player.world || "START",
            metadata: {
                purchase_id: purchaseId,
                current_slots: currentSlots,
                next_slots: preview.next_slots,
                cost_gems: preview.cost,
            },
            failure_message: "Inventory upgrade changed. Try again.",
        });
        if (!commit.ok) {
            sendInventoryTransactionResult(socket, {
                ok: false,
                request_id: requestId,
                action: "inventory_slot_upgrade",
                message: commit.message || "Inventory upgrade changed. Try again.",
                username,
                ...preview,
            });
            return;
        }
        const committedState = commit.state;
        committedState.inventory_slot_count = resolveInventorySlotCount(committedState);
        const nextPreview = buildInventoryUpgradePreview(committedState.inventory_slot_count);
        logItemLedgerForState(socket, player, username, committedState, "gem", "currency", -preview.cost, "inventory_upgrade", purchaseId, "inventory_slot_upgrade", player.world, { current_slots: currentSlots, next_slots: committedState.inventory_slot_count }, { skipPostgres: commit.postgres_committed });
        sendInventoryTransactionResult(socket, {
            ok: true,
            request_id: requestId,
            action: "inventory_slot_upgrade",
            message: `Inventory upgraded to ${committedState.inventory_slot_count} slots.`,
            username,
            player_data: buildPlayerStateForClient(committedState),
            inventory_slot_count: committedState.inventory_slot_count,
            current_slots: committedState.inventory_slot_count,
            next_inventory_slot_count: nextPreview.next_slots,
            next_slots: nextPreview.next_slots,
            inventory_upgrade_cost: nextPreview.cost,
            cost: nextPreview.cost,
            spent_gems: preview.cost,
            max_slots: INVENTORY_MAX_SLOT_COUNT,
            step: INVENTORY_SLOT_UPGRADE_STEP,
        });
    }
    async function handleShopBuyTransaction(socket, player, data) {
        const requestId = makeRequestId(data);
        const itemId = clampString(data.item_id || data.item || "");
        const listing = SHOP_CATALOG.get(itemId);
        if (!listing) {
            sendInventoryTransactionRejected(socket, data, "Shop item is not sold by the server.");
            return;
        }
        if (!ItemDatabase.hasItem(listing.item_id)
            || !ItemDatabase.canStoreItemInCategory(listing.item_id, listing.item_category)) {
            sendInventoryTransactionRejected(socket, data, "Shop item is not valid on the server.");
            return;
        }
        const packRewardTable = getPackRewardTable(itemId);
        if (packRewardTable) {
            const rewardTableValid = packRewardTable.every((reward) => (ItemDatabase.hasItem(reward.item_id)
                && ItemDatabase.canStoreItemInCategory(reward.item_id, reward.item_category)));
            if (!rewardTableValid) {
                sendInventoryTransactionRejected(socket, data, "Shop pack rewards are not configured.");
                return;
            }
        }
        const requestedAmount = clampInteger(data.amount || listing.amount, 1, ItemDatabase.getStackLimit(listing.item_id));
        const requestedPrice = clampInteger(data.price || listing.price, 0, MAX_SHOP_PRICE);
        if (requestedAmount !== listing.amount || requestedPrice !== listing.price) {
            sendInventoryTransactionRejected(socket, data, "Shop price changed. Reopen the shop.");
            return;
        }
        const username = player.account_username;
        const state = ensureWritablePlayerState(username);
        if (!state) {
            sendInventoryTransactionRejected(socket, data, "Could not load your server inventory.");
            return;
        }
        const beforeState = cloneJson(state);
        const stagedState = cloneJson(state);
        if (!spendItemFromState(stagedState, "gem", "currency", listing.price)) {
            sendInventoryTransactionRejected(socket, data, "Not enough gems.");
            return;
        }
        const rewards = [];
        if (packRewardTable) {
            for (let index = 0; index < listing.pack_size * listing.amount; index += 1) {
                const reward = rollWeightedReward(packRewardTable);
                addItemToState(stagedState, reward.item_id, reward.item_category, 1);
                rewards.push({
                    item_id: reward.item_id,
                    item_category: reward.item_category,
                    amount: 1,
                });
            }
        }
        else {
            addItemToState(stagedState, listing.item_id, listing.item_category, listing.amount);
            rewards.push({
                item_id: listing.item_id,
                item_category: listing.item_category,
                amount: listing.amount,
            });
        }
        const purchaseId = makeAuditId("shop");
        const commit = await commitPlayerInventoryState(socket, player, username, beforeState, stagedState, {
            source: "shop",
            action: "shop_purchase",
            reason: "shop_buy",
            request_id: requestId,
            world: player.world || "START",
            metadata: { listing_id: itemId, purchase_id: purchaseId },
            failure_message: "Shop inventory changed. Try again.",
        });
        if (!commit.ok) {
            sendInventoryTransactionRejected(socket, data, commit.message);
            return;
        }
        const committedState = commit.state;
        const inventoryDeltas = buildInventoryDeltaClientPayloads(commit.deltas, committedState);
        const combinedRewards = combineRewardEntries(rewards);
        const gemBalanceAfter = getInventoryCount(committedState, "gem", "currency");
        logShopPurchase(socket, player, {
            purchase_id: purchaseId,
            account_username: username,
            listing_id: itemId,
            item_id: listing.item_id,
            price_gems: listing.price,
            rewards: combinedRewards,
            gem_balance_after: gemBalanceAfter,
        });
        logItemLedgerForState(socket, player, username, committedState, "gem", "currency", -listing.price, "shop_purchase", purchaseId, "shop_price", player.world, { listing_id: itemId }, { skipPostgres: commit.postgres_committed });
        logRewardLedgers(socket, player, username, committedState, combinedRewards, "shop_purchase", purchaseId, "shop_reward", player.world, { listing_id: itemId }, { skipPostgres: commit.postgres_committed });
        sendInventoryTransactionResult(socket, {
            ok: true,
            request_id: requestId,
            action: "shop_buy",
            item_id: itemId,
            message: getShopPurchaseMessage(itemId, listing),
            username,
            rewards: combinedRewards,
            inventory_deltas: inventoryDeltas,
        });
    }
    return {
        getPackRewardTable,
        getShopPurchaseMessage,
        handleInventoryTransactionRequest,
        handleInventoryUpgradePurchase,
        handleShopBuyTransaction,
    };
}
module.exports = {
    createServerInventoryEconomyRoutes,
};
