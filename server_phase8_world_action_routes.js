// Generated from src/server_phase8_world_action_routes.ts. Do not edit by hand.
"use strict";
const WORLD_BLOCK_PLACE_INVENTORY_LOCK_WAIT_MS = 650;
const WORLD_BLOCK_PLACE_INVENTORY_LOCK_RETRY_MS = 25;
function createServerPhase8WorldActionRoutes(deps) {
    const { acquirePlayerInventoryLocks, acquireLiveActionLock, applyAreaLockStateForBlockUpdate, applyBlockUpdateToWorldState, applyElectricalGenerationForBlockBreak, applyElectricalLayerUpdateToWorldState, applyPunchToggleInstantDeathPresence, applySeedUpdateToWorldState, applyWorldLockStateForBlockUpdate, awardLandfillKilogramsForBlockBreak, awardPlayerExperience, beginPhase7BlockActionContext, broadcastCctvWorldState, buildInventoryDeltaClientPayloads, buildProgressionPayload, buildPunchToggleInstantDeathTargets, buildWorldObjectChangeEntry, canPlayerBreakOwnVendingMachine, canPlayerBuildAtGrid, canPlayerControlWorldLock, canPlayerViewElectricalLayer, clampInteger, clampString, cleanAccountName, cleanWorld, clearPhase7BlockActionContext, cloneJson, commitPlayerInventoryState, commitWorldStateWithBlockChanges, createBreakDrops, createElectricalBreakDrops, debugActionPositionFlow, debugNetfoxAction, deserializeWorldState, ELECTRICAL_DEVICE_GENERATOR, ELECTRICAL_DEVICE_METAL_PAD, ELECTRICAL_DEVICE_POLE, ELECTRICAL_GENERATOR_ITEM, ELECTRICAL_GENERATOR_MAX_WATTS, ELECTRICAL_MAX_PADS_PER_GENERATOR, ELECTRICAL_MAX_POLE_LINKS_PER_POLE, ELECTRICAL_MAX_POLES_PER_GENERATOR, ELECTRICAL_MAX_TRANSFORMER_LINKS_PER_POLE, ELECTRICAL_POLE_ITEM, ensurePlayerState, ensureWorldState, errorToCrashDetails, findGeneratorLinkedToPad, getAreaLocksJournalData, getAuditActor, getBlockBreakXp, getCrashRuntimeState, getElectricPoleDeviceStateAt, getGeneratorDeviceStateAt, getGeneratorKeysLinkedToPole, getGeneratorLinkedPadKeys, getGeneratorLinkedPoleKeys, getMetalPadDeviceStateAt, getMutableElectricalDeviceStateAt, getPhase7InventoryCount, getPlayerCurrentWorldName, getPlayerValidationPosition, getPoleLinkedPoleKeys, getProgressionMessage, getProgressionXpMessage, getTrustedMovementModeLabel, getUniqueSpecialBlockPlacementLockResource, getWorldBlockActionLockResource, getWorldBlockTypeAt, getWorldObjectJournalData, gridKey, handleFrozenTreasureOpen, hasAntiGravityBlock, hasAntiPunchBlock, hasAntiTalkBlock, hasProgressionPayload, hasSnowRepellentBlock, initializeChickenOnPlace, initializeCowOnPlace, initializeDisplayOwnerOnPlace, initializeDonationBoxOwnerOnPlace, initializeDuckOnPlace, initializeSafeOwnerOnPlace, initializeTackleBoxOnPlace, initializeVendOwnerOnPlace, isAntiGravityBlockType, isAntiPunchBlockType, isAntiTalkBlockType, isAreaLockBlockType, isCctvBlockType, isChickenBlockType, isCowBlockType, isDisplayBlockType, isDonationBoxBlockType, isDuckBlockType, isElectricalDeviceBlockOnLayer, isFishMongerBreakAttempt, isGridInWorld, isLandfillWorldName, isLandfillBuildLocked, isPlayerNearGrid, isPostgresAuthoritativeReady, isSafeBlockType, isSnowRepellentBlockType, isAtmMachineBlockType, isTackleBoxBlockType, isVendBlockType, isWaterBucketScoopBreak, isWaterWellBlockType, isWorldLockBlockType, isWorldLocked, isWorldLockPlacementBlocked, ItemDatabase, logItemLedgerForState, logPhase7ActionResult, logPlayerProgressionAward, logVendingTransaction, logWorldChange, makeAuditId, makeChickenStatePayload, makeCowStatePayload, makeDuckStatePayload, makeElectricalTilePayload, makeGeneratorDataPayload, makeRequestId, makeTackleBoxStatePayload, markElectricalNetworksDirty, MAX_GRID_ACTION_DISTANCE_PIXELS, MAX_ITEM_ID_LENGTH, persistWorldStateAfterInventoryCommit, playerHasElectricToolEquipped, POSTGRES_AUTHORITATIVE, POSTGRES_ENABLED, queueWorldSave, refreshElectricalVisibilityForWorld, rejectIfWorldBanned, releaseLiveActionLock, releasePlayerInventoryLocks, requireAuthenticated, requireBuildPermission, requireSameWorld, sanitizeBlockUpdate, sanitizeElectricalLayerUpdate, sanitizeEquipmentSlots, sanitizeSeedUpdate, sendActionRejected, sendElectricalPayloadToVisiblePlayers, sendElectricalVisibilityRefresh, sendGeneratorPowerPayloadToWorld, sendInventoryTransactionResult, sendJson, sendWorldUpdateToRequesterAndWorld, serializeWorldState, setGeneratorLinkedPadKeys, setGeneratorLinkedPoleKeys, setPoleLinkedPoleKeys, shouldAllowPhase7DevJsonFallback, shouldApplyAreaLockStateForBlockUpdate, shouldApplyWorldLockStateForBlockUpdate, validateBlockUpdateAgainstServerState, validateElectricalLayerUpdateAgainstServerState, validateNetfoxActionCooldown, validateSeedUpdateAgainstServerState, worldBlockActionLocks, worldSpecialBlockActionLocks, worldStates, writeCrashReport, } = deps;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function acquirePlayerInventoryLocksWithWait(usernames, owner, maxWaitMs = WORLD_BLOCK_PLACE_INVENTORY_LOCK_WAIT_MS, retryMs = WORLD_BLOCK_PLACE_INVENTORY_LOCK_RETRY_MS) {
        const deadline = Date.now() + Math.max(0, maxWaitMs);
        let lastLock = null;
        while (true) {
            lastLock = await acquirePlayerInventoryLocks(usernames, owner);
            if (lastLock?.acquired)
                return lastLock;
            if (Date.now() >= deadline)
                return lastLock || { acquired: false, locks: [], blocked_resource: "" };
            await sleep(Math.max(5, retryMs));
        }
    }
    function buildBlockUpdateRejectionDetails(worldName, update, requestId, extra = {}) {
        const x = Math.trunc(Number(update?.x) || 0);
        const y = Math.trunc(Number(update?.y) || 0);
        const details = {
            request_id: requestId,
            action: update?.action || "",
            block_action: update?.action || "",
            world: cleanWorld(worldName),
            layer: update?.layer || "foreground",
            x,
            y,
            target_x: x,
            target_y: y,
            block_type: clampString(update?.block_type || "", MAX_ITEM_ID_LENGTH),
            server_action_id: update?.server_action_id || "",
        };
        for (const [key, value] of Object.entries(extra || {})) {
            if (value !== undefined)
                details[key] = value;
        }
        return details;
    }
    async function handleWorldBlockUpdate(socket, player, data, context) {
        let blockActionLock = null;
        let placementInventoryLock = null;
        let uniqueSpecialBlockPlacementLock = null;
        const releasePlacementInventoryLock = () => {
            if (!placementInventoryLock)
                return;
            releasePlayerInventoryLocks(placementInventoryLock);
            placementInventoryLock = null;
        };
        const releaseUniqueSpecialBlockPlacementLock = () => {
            if (!uniqueSpecialBlockPlacementLock)
                return;
            releaseLiveActionLock(uniqueSpecialBlockPlacementLock);
            uniqueSpecialBlockPlacementLock = null;
        };
        try {
            if (!requireAuthenticated(socket, player, "edit worlds"))
                return;
            const incomingRequestId = makeRequestId(data);
            socket.activeActionRequestId = incomingRequestId;
            const worldName = getPlayerCurrentWorldName(player);
            if (await rejectIfWorldBanned(socket, player, worldName, "world_block_update"))
                return;
            const allowDevJsonFallback = shouldAllowPhase7DevJsonFallback(player, data, {
                world: worldName,
                allow_dev_json_fallback: true,
            });
            if (POSTGRES_ENABLED && POSTGRES_AUTHORITATIVE && !isPostgresAuthoritativeReady() && !allowDevJsonFallback) {
                sendActionRejected(socket, "world_block_update", "PostgreSQL is not ready.", {
                    request_id: incomingRequestId,
                    reason: "postgres_unavailable",
                });
                return;
            }
            const update = sanitizeBlockUpdate(data, worldName);
            if (!update)
                return;
            const requestId = incomingRequestId;
            if (requestId !== "") {
                update.request_id = requestId;
                update.action_id = requestId;
                update.client_action_id = clampString(data.action_id || data.client_action_id || requestId, MAX_ITEM_ID_LENGTH);
            }
            const requestedWorldName = cleanWorld(data.world || data.current_world || data.world_id || worldName);
            if (requestedWorldName !== worldName) {
                const rejectedPosition = getPlayerValidationPosition(player, { action: `world_block_${update.action}`, world: worldName });
                beginPhase7BlockActionContext(socket, player, worldName, update, rejectedPosition);
                sendActionRejected(socket, "world_block_update", "Join that world before editing it.", {
                    reason: "wrong_world",
                    requested_world: requestedWorldName,
                    current_world: worldName,
                    block_type: update.block_type,
                });
                return;
            }
            update.source_tool = clampString(player?.equipment_slots?.hand || update.source_tool || data.source_tool || "");
            update.player_id = String(player?.id || socket?.playerId || "");
            update.username = cleanAccountName(player?.account_username || player?.name || "");
            update.account_username = update.username;
            const actorPosition = getPlayerValidationPosition(player, { action: `world_block_${update.action}`, world: worldName });
            update.actor_x = actorPosition.ok ? actorPosition.x : Number(player?.x || 0);
            update.actor_y = actorPosition.ok ? actorPosition.y : Number(player?.y || 0);
            update.actor_facing = actorPosition.ok ? actorPosition.facing : (Number(player?.facing || 1) < 0 ? -1 : 1);
            beginPhase7BlockActionContext(socket, player, worldName, update, actorPosition);
            const blockActionResource = getWorldBlockActionLockResource(worldName, update);
            blockActionLock = await acquireLiveActionLock(worldBlockActionLocks, "world_block", blockActionResource, player.id);
            if (!blockActionLock.acquired) {
                sendActionRejected(socket, "world_block_update", "That tile is busy. Try again.", {
                    reason: "block_action_busy",
                    block_type: update.block_type,
                    layer: update.layer,
                    x: update.x,
                    y: update.y,
                });
                return;
            }
            if (!validateNetfoxActionCooldown(socket, player, "world_block_update", data))
                return;
            debugNetfoxAction("world block action identity", {
                action: update.action,
                websocket_session_player_id: String(socket?.playerId || ""),
                account_username: cleanAccountName(player?.account_username || player?.name || ""),
                inventory_owner_id: String(player?.id || ""),
                resolved_peer_id: actorPosition.ok ? Number(actorPosition.peer_id || 0) : 0,
                resolved_source: actorPosition.source || "",
                trusted_position: actorPosition.ok ? { x: Math.round(actorPosition.x), y: Math.round(actorPosition.y) } : null,
                target_tile: { x: update.x, y: update.y },
                world: worldName,
                allow_reject_reason: actorPosition.ok ? "trusted_position_ready" : `trusted_position_${actorPosition.reason || "missing"}`,
                age_ms: actorPosition.age_ms,
            });
            if (update.action === "break" || update.action === "hit") {
                debugActionPositionFlow("world_block_update break request start", player, {
                    action: update.action,
                    layer: update.layer,
                    x: update.x,
                    y: update.y,
                    block_type: update.block_type,
                });
            }
            // Landfill races freeze the world until GO. Placing or breaking anything during
            // WAITING_FOR_PLAYERS/COUNTDOWN would let a player bank a head start on terrain, and
            // would let them tunnel out of the shifty-block starting pen before it opens. A no-op
            // for every non-Landfill world and for any Landfill world already racing, so it is safe
            // on the hot path of the most frequent action in the game.
            if (typeof isLandfillBuildLocked === "function" && isLandfillBuildLocked(worldName)) {
                sendActionRejected(socket, "world_block_update", "The race hasn't started yet.", {
                    reason: "landfill_race_not_started",
                    block_type: update.block_type,
                });
                return;
            }
            if (!canPlayerBuildAtGrid(player, worldName, update.x, update.y) &&
                !canPlayerBreakOwnVendingMachine(player, worldName, update) &&
                !isFishMongerBreakAttempt(worldName, update)) {
                sendActionRejected(socket, "world_block_update", "This world is locked.", {
                    reason: "world_locked",
                    block_type: update.block_type,
                });
                return;
            }
            if ((update.action === "break" || update.action === "hit") && isWorldLockBlockType(update.block_type) && isWorldLocked(worldName) && !canPlayerControlWorldLock(player, worldName)) {
                sendActionRejected(socket, "world_block_update", "Only the world lock owner can break the lock.", {
                    reason: "world_lock_owner_required",
                    block_type: update.block_type,
                });
                return;
            }
            if (update.action === "place" && isWorldLockBlockType(update.block_type) && isLandfillWorldName(worldName)) {
                sendActionRejected(socket, "world_block_update", "Landfill worlds cannot be locked.", {
                    reason: "landfill_lock_blocked",
                    block_type: update.block_type,
                });
                return;
            }
            if (update.action === "place" && isWorldLockBlockType(update.block_type) && isWorldLockPlacementBlocked(worldName)) {
                sendActionRejected(socket, "world_block_update", "This world already has a lock.", {
                    reason: "world_lock_exists",
                    block_type: update.block_type,
                });
                return;
            }
            if (update.action === "place" && isAreaLockBlockType(update.block_type) && isLandfillWorldName(worldName)) {
                sendActionRejected(socket, "world_block_update", "Landfill worlds cannot be locked.", {
                    reason: "landfill_lock_blocked",
                    block_type: update.block_type,
                });
                return;
            }
            if (update.action === "place" && isAntiPunchBlockType(update.block_type) && hasAntiPunchBlock(worldName)) {
                sendActionRejected(socket, "world_block_update", "This world already has an Anti-Punch block.", {
                    reason: "anti_punch_exists",
                    block_type: update.block_type,
                });
                return;
            }
            if (update.action === "place" && isAntiTalkBlockType(update.block_type) && hasAntiTalkBlock(worldName)) {
                sendActionRejected(socket, "world_block_update", "This world already has an Anti-Talk block.", {
                    reason: "anti_talk_exists",
                    block_type: update.block_type,
                });
                return;
            }
            if (update.action === "place" && isAntiGravityBlockType(update.block_type) && hasAntiGravityBlock(worldName)) {
                sendActionRejected(socket, "world_block_update", "This world already has an Anti-Gravity block.", {
                    reason: "anti_gravity_exists",
                    block_type: update.block_type,
                });
                return;
            }
            if (update.action === "place" && isSnowRepellentBlockType(update.block_type) && hasSnowRepellentBlock(worldName)) {
                sendActionRejected(socket, "world_block_update", "This world already has a Snow Repellent block.", {
                    reason: "snow_repellent_exists",
                    block_type: update.block_type,
                });
                return;
            }
            const uniqueSpecialBlockPlacementResource = getUniqueSpecialBlockPlacementLockResource(worldName, update.block_type);
            if (update.action === "place" && uniqueSpecialBlockPlacementResource !== "") {
                uniqueSpecialBlockPlacementLock = await acquireLiveActionLock(worldSpecialBlockActionLocks, "unique_special_block_place", uniqueSpecialBlockPlacementResource, player.id);
                if (!uniqueSpecialBlockPlacementLock.acquired) {
                    sendActionRejected(socket, "world_block_update", "That special block is already being placed.", {
                        reason: "special_block_place_busy",
                        block_type: update.block_type,
                    });
                    return;
                }
                if (isAntiPunchBlockType(update.block_type) && hasAntiPunchBlock(worldName)) {
                    releaseUniqueSpecialBlockPlacementLock();
                    sendActionRejected(socket, "world_block_update", "This world already has an Anti-Punch block.", {
                        reason: "anti_punch_exists",
                        block_type: update.block_type,
                    });
                    return;
                }
                if (isAntiTalkBlockType(update.block_type) && hasAntiTalkBlock(worldName)) {
                    releaseUniqueSpecialBlockPlacementLock();
                    sendActionRejected(socket, "world_block_update", "This world already has an Anti-Talk block.", {
                        reason: "anti_talk_exists",
                        block_type: update.block_type,
                    });
                    return;
                }
                if (isAntiGravityBlockType(update.block_type) && hasAntiGravityBlock(worldName)) {
                    releaseUniqueSpecialBlockPlacementLock();
                    sendActionRejected(socket, "world_block_update", "This world already has an Anti-Gravity block.", {
                        reason: "anti_gravity_exists",
                        block_type: update.block_type,
                    });
                    return;
                }
                if (isSnowRepellentBlockType(update.block_type) && hasSnowRepellentBlock(worldName)) {
                    releaseUniqueSpecialBlockPlacementLock();
                    sendActionRejected(socket, "world_block_update", "This world already has a Snow Repellent block.", {
                        reason: "snow_repellent_exists",
                        block_type: update.block_type,
                    });
                    return;
                }
            }
            if (update.action === "place" && isPostgresAuthoritativeReady()) {
                const placementCostForLock = ItemDatabase.getPlacementCost(update.block_type);
                if (placementCostForLock && Number(placementCostForLock.amount) > 0) {
                    const inventoryOwner = cleanAccountName(player?.account_username || player?.name || "");
                    placementInventoryLock = await acquirePlayerInventoryLocksWithWait([inventoryOwner], `world_block_place:${worldName}:${requestId || blockActionResource}`);
                    if (!placementInventoryLock?.acquired) {
                        releaseUniqueSpecialBlockPlacementLock();
                        sendActionRejected(socket, "world_block_update", "Your inventory is busy. Try again.", buildBlockUpdateRejectionDetails(worldName, update, requestId, {
                            reason: "inventory_locked",
                            item_id: placementCostForLock.item_id,
                            item_category: placementCostForLock.item_category,
                            amount: placementCostForLock.amount,
                            blocked_resource: placementInventoryLock?.blocked_resource || "",
                        }));
                        return;
                    }
                }
            }
            const validation = await validateBlockUpdateAgainstServerState(socket, player, worldName, update, requestId, {
                allow_dev_json_fallback: allowDevJsonFallback,
            });
            if (!validation.ok) {
                releaseUniqueSpecialBlockPlacementLock();
                return;
            }
            if (validation.pendingHit) {
                releaseUniqueSpecialBlockPlacementLock();
                logPhase7ActionResult(socket, "ALLOW", "pending_hit", {
                    action: update.action,
                    item: update.block_type,
                });
                sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
                return;
            }
            if (update.action === "break" && update.block_type === "frozen_treasure") {
                releaseUniqueSpecialBlockPlacementLock();
                await handleFrozenTreasureOpen(socket, player, worldName, update, requestId);
                return;
            }
            const blockTransactionId = makeAuditId("block");
            update.server_action_id = blockTransactionId;
            update.movement_mode = getTrustedMovementModeLabel(player, data);
            const blockTypeBefore = getWorldBlockTypeAt(worldName, update.x, update.y, update.layer);
            const previousWorldState = validation.rollbackWorldState || serializeWorldState(worldName);
            const shouldBroadcastWorldLockState = shouldApplyWorldLockStateForBlockUpdate(worldName, update);
            const shouldBroadcastAreaLockState = shouldApplyAreaLockStateForBlockUpdate(worldName, update);
            const electricalDeviceBlockChanged = (update.action === "place" || update.action === "break") &&
                isElectricalDeviceBlockOnLayer(update.block_type, update.layer);
            const areaLockStateBefore = shouldBroadcastAreaLockState ? getAreaLocksJournalData(worldName) : null;
            const electricalGeneration = applyElectricalGenerationForBlockBreak(worldName, update);
            applyBlockUpdateToWorldState(worldName, update);
            const punchToggleKilledPlayers = buildPunchToggleInstantDeathTargets(worldName, update, validation);
            if (electricalGeneration && electricalGeneration.generator) {
                const refreshedGenerator = getMutableElectricalDeviceStateAt(ensureWorldState(worldName), electricalGeneration.generator.x, electricalGeneration.generator.y);
                if (refreshedGenerator) {
                    electricalGeneration.data_update = makeGeneratorDataPayload(worldName, refreshedGenerator, {
                        generated_watts: electricalGeneration.generated_watts,
                        source_x: update.x,
                        source_y: update.y,
                        full: Number(refreshedGenerator.watts || 0) >= Number(refreshedGenerator.max_watts || ELECTRICAL_GENERATOR_MAX_WATTS),
                    });
                    if (electricalGeneration.pulse) {
                        electricalGeneration.pulse.watts = clampInteger(refreshedGenerator.watts || 0, 0, ELECTRICAL_GENERATOR_MAX_WATTS);
                        electricalGeneration.pulse.max_watts = clampInteger(refreshedGenerator.max_watts || ELECTRICAL_GENERATOR_MAX_WATTS, 1, ELECTRICAL_GENERATOR_MAX_WATTS);
                    }
                }
            }
            const worldLockStatePayload = applyWorldLockStateForBlockUpdate(worldName, update, player, shouldBroadcastWorldLockState);
            const areaLockStatePayload = applyAreaLockStateForBlockUpdate(worldName, update, player, shouldBroadcastAreaLockState);
            const placementInteractionPayloads = [];
            const placementInteractionChanges = [];
            if (areaLockStatePayload) {
                placementInteractionPayloads.push(areaLockStatePayload);
                placementInteractionChanges.push(buildWorldObjectChangeEntry(socket, player, worldName, areaLockStatePayload, areaLockStateBefore, getAreaLocksJournalData(worldName), blockTransactionId, {
                    source: "area_lock_block_update",
                }));
            }
            if (update.action === "place" && isVendBlockType(update.block_type)) {
                initializeVendOwnerOnPlace(worldName, update, player);
            }
            if (update.action === "place" && isSafeBlockType(update.block_type)) {
                initializeSafeOwnerOnPlace(worldName, update, player);
            }
            if (update.action === "place" && isDonationBoxBlockType(update.block_type)) {
                initializeDonationBoxOwnerOnPlace(worldName, update, player);
            }
            if (update.action === "place" && isDisplayBlockType(update.block_type)) {
                initializeDisplayOwnerOnPlace(worldName, update, player);
            }
            if (update.action === "place" && (isTackleBoxBlockType(update.block_type) || isWaterWellBlockType(update.block_type) || isAtmMachineBlockType(update.block_type))) {
                const objectBefore = getWorldObjectJournalData(worldName, {
                    action: "tackle_box_state",
                    x: update.x,
                    y: update.y,
                    block_type: update.block_type,
                });
                const tackle = initializeTackleBoxOnPlace(worldName, update);
                const statePayload = makeTackleBoxStatePayload(worldName, update.x, update.y, update.block_type, tackle, "place");
                const objectAfter = getWorldObjectJournalData(worldName, statePayload);
                placementInteractionPayloads.push(statePayload);
                placementInteractionChanges.push(buildWorldObjectChangeEntry(socket, player, worldName, statePayload, objectBefore, objectAfter, blockTransactionId, {
                    tackle_box_action: "place",
                    timed_provider_type: isAtmMachineBlockType(update.block_type) ? "atm_machine" : (isWaterWellBlockType(update.block_type) ? "water_well" : "tackle_box"),
                    next_harvest_at: tackle.next_harvest_at,
                }));
            }
            if (update.action === "place" && isChickenBlockType(update.block_type)) {
                const objectBefore = getWorldObjectJournalData(worldName, {
                    action: "chicken_state",
                    x: update.x,
                    y: update.y,
                    block_type: update.block_type,
                });
                const chicken = initializeChickenOnPlace(worldName, update);
                const statePayload = makeChickenStatePayload(worldName, update.x, update.y, update.block_type, chicken, "place");
                const objectAfter = getWorldObjectJournalData(worldName, statePayload);
                placementInteractionPayloads.push(statePayload);
                placementInteractionChanges.push(buildWorldObjectChangeEntry(socket, player, worldName, statePayload, objectBefore, objectAfter, blockTransactionId, {
                    chicken_action: "place",
                    dies_at: chicken.dies_at,
                }));
            }
            if (update.action === "place" && isCowBlockType(update.block_type)) {
                const objectBefore = getWorldObjectJournalData(worldName, {
                    action: "cow_state",
                    x: update.x,
                    y: update.y,
                    block_type: update.block_type,
                });
                const cow = initializeCowOnPlace(worldName, update);
                const statePayload = makeCowStatePayload(worldName, update.x, update.y, update.block_type, cow, "place");
                const objectAfter = getWorldObjectJournalData(worldName, statePayload);
                placementInteractionPayloads.push(statePayload);
                placementInteractionChanges.push(buildWorldObjectChangeEntry(socket, player, worldName, statePayload, objectBefore, objectAfter, blockTransactionId, {
                    cow_action: "place",
                    dies_at: cow.dies_at,
                }));
            }
            if (update.action === "place" && isDuckBlockType(update.block_type)) {
                const objectBefore = getWorldObjectJournalData(worldName, {
                    action: "duck_state",
                    x: update.x,
                    y: update.y,
                    block_type: update.block_type,
                });
                const duck = initializeDuckOnPlace(worldName, update);
                const statePayload = makeDuckStatePayload(worldName, update.x, update.y, update.block_type, duck, "place");
                const objectAfter = getWorldObjectJournalData(worldName, statePayload);
                placementInteractionPayloads.push(statePayload);
                placementInteractionChanges.push(buildWorldObjectChangeEntry(socket, player, worldName, statePayload, objectBefore, objectAfter, blockTransactionId, {
                    duck_action: "place",
                    dies_at: duck.dies_at,
                }));
            }
            const shouldAwardBreakProgression = update.action === "break" && !isWaterBucketScoopBreak(update);
            const progression = shouldAwardBreakProgression
                ? awardPlayerExperience(player.account_username, getBlockBreakXp(update.block_type, update.layer), "world_block_break", {
                    world: worldName,
                    block_type: update.block_type,
                    layer: update.layer,
                    x: update.x,
                    y: update.y,
                }, validation.playerState || null)
                : { xp_gained: 0, levels_gained: 0, state: validation.playerState || null };
            let requesterPlayerState = Number(progression.xp_gained || 0) > 0 ? progression.state : (validation.playerState || null);
            const requesterProgressionPayload = buildProgressionPayload(progression);
            logPlayerProgressionAward(player, progression);
            if (update.action === "break") {
                // Additive, best-effort: awards Landfill "Kilograms" when this break happens inside
                // a Landfill instance and the block type is a registered trash block. No-ops for
                // every other world/block type. Not awaited so it can't add latency to the break
                // response -- it does its own error logging internally (see
                // server_landfill_event.ts's awardKilogramsForBlockBreak).
                void awardLandfillKilogramsForBlockBreak(worldName, update.username, update.block_type);
            }
            const emittedDrops = createBreakDrops(worldName, update);
            if (update.action === "break") {
                debugActionPositionFlow("world_block_update break request end", player, {
                    layer: update.layer,
                    x: update.x,
                    y: update.y,
                    block_type: update.block_type,
                    emitted_drops: emittedDrops.length,
                });
            }
            const worldChangeEntry = {
                ...getAuditActor(socket, player),
                source_type: "world_block_update",
                source_id: blockTransactionId,
                request_id: requestId,
                world: worldName,
                action: update.action,
                layer: update.layer,
                x: update.x,
                y: update.y,
                block_type: update.block_type,
                block_type_before: blockTypeBefore || (update.action === "break" || update.action === "hit" ? update.block_type : ""),
                block_type_after: update.action === "break" ? "" : update.block_type,
                details: {
                    old_block_id: blockTypeBefore || (update.action === "break" || update.action === "hit" ? update.block_type : ""),
                    new_block_id: update.action === "break" ? "" : update.block_type,
                    actual_layer: update.layer,
                    request_id: requestId,
                    water_bucket_action: update.water_bucket_action || "",
                    toggle_action: update.toggle_action || "",
                    toggle_from_block_type: update.toggle_from_block_type || "",
                    toggle_to_block_type: update.toggle_to_block_type || "",
                    killed_player_ids: Array.isArray(update.kill_player_ids) ? update.kill_player_ids : [],
                },
            };
            const dropWorldChangeEntries = emittedDrops.map((drop) => ({
                ...getAuditActor(socket, player),
                source_type: "world_block_break",
                source_id: blockTransactionId,
                request_id: requestId,
                world: worldName,
                action: "break_drop",
                layer: update.layer,
                x: update.x,
                y: update.y,
                block_type: drop.item_type,
                details: {
                    drop_id: drop.drop_id,
                    item_type: drop.item_type,
                    item_category: drop.item_category,
                    amount: drop.amount,
                    x: drop.x,
                    y: drop.y,
                    stack_grid_x: drop.stack_grid_x,
                    stack_grid_y: drop.stack_grid_y,
                    pickup_delay: drop.pickup_delay,
                    request_id: requestId,
                    source_block: update.block_type,
                },
            }));
            const electricalGenerationChanges = [];
            if (electricalGeneration && Number(electricalGeneration.generated_watts || 0) > 0 && electricalGeneration.generator) {
                const generator = electricalGeneration.generator;
                worldChangeEntry.details.electrical_generation = {
                    generator_x: generator.x,
                    generator_y: generator.y,
                    generated_watts: electricalGeneration.generated_watts,
                    previous_watts: electricalGeneration.previous_watts,
                    next_watts: electricalGeneration.next_watts,
                };
                electricalGenerationChanges.push(buildWorldObjectChangeEntry(socket, player, worldName, {
                    type: "electrical_generation",
                    source_type: "electrical_generation",
                    source_id: blockTransactionId,
                    action: "electrical_generator_watts",
                    object_type: "electrical_generator",
                    object_id: `electrical_generator:${generator.x}:${generator.y}`,
                    world: worldName,
                    x: generator.x,
                    y: generator.y,
                    block_type: ELECTRICAL_GENERATOR_ITEM,
                }, electricalGeneration.generator_before || {}, generator, blockTransactionId, {
                    source_block: update.block_type,
                    source_x: update.x,
                    source_y: update.y,
                    generated_watts: electricalGeneration.generated_watts,
                    previous_watts: electricalGeneration.previous_watts,
                    next_watts: electricalGeneration.next_watts,
                }));
            }
            const validationWorldChanges = Array.isArray(validation.worldChanges) ? validation.worldChanges : [];
            const worldChanges = [worldChangeEntry, ...validationWorldChanges, ...placementInteractionChanges, ...electricalGenerationChanges, ...dropWorldChangeEntries];
            let worldCommit = null;
            let requesterInventoryDeltas = buildInventoryDeltaClientPayloads(validation.inventoryDeltas, requesterPlayerState);
            if (validation.deferred_inventory_commit) {
                const deferred = validation.deferred_inventory_commit;
                const serializedWorld = serializeWorldState(worldName);
                const inventoryCommit = await commitPlayerInventoryState(socket, player, deferred.username, deferred.beforeState, deferred.afterState, {
                    ...(deferred.options || {}),
                    allow_dev_json_fallback: allowDevJsonFallback,
                    world: worldName,
                    world_state: serializedWorld,
                    world_changes: worldChanges,
                    inventory_lock_owner: deferred.options?.inventory_lock_owner || `world_block_place:${worldName}:${requestId || blockTransactionId}`,
                    skip_inventory_lock: placementInventoryLock?.acquired === true || deferred.options?.skip_inventory_lock === true,
                });
                if (!inventoryCommit.ok) {
                    worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
                    releaseUniqueSpecialBlockPlacementLock();
                    const rejectMessage = inventoryCommit.reason === "database_error"
                        ? "PostgreSQL rejected the world update."
                        : (inventoryCommit.message || "PostgreSQL rejected the world update.");
                    sendActionRejected(socket, "world_block_update", rejectMessage, buildBlockUpdateRejectionDetails(worldName, update, requestId, {
                        reason: inventoryCommit.reason || "inventory_commit_failed",
                        block_type: update.block_type,
                    }));
                    return;
                }
                validation.playerState = inventoryCommit.state;
                validation.postgres_committed = inventoryCommit.postgres_committed;
                requesterPlayerState = inventoryCommit.state || requesterPlayerState;
                requesterInventoryDeltas = buildInventoryDeltaClientPayloads(inventoryCommit.deltas, requesterPlayerState);
                persistWorldStateAfterInventoryCommit(worldName, inventoryCommit.postgres_committed, serializedWorld);
                worldCommit = { ok: true, postgres_committed: inventoryCommit.postgres_committed, serialized: serializedWorld };
                releasePlacementInventoryLock();
            }
            else {
                worldCommit = await commitWorldStateWithBlockChanges(worldName, worldChanges, {
                    player,
                    allow_dev_json_fallback: allowDevJsonFallback,
                });
                if (!worldCommit.ok) {
                    worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
                    releaseUniqueSpecialBlockPlacementLock();
                    sendActionRejected(socket, "world_block_update", worldCommit.message || "PostgreSQL rejected the world update.", buildBlockUpdateRejectionDetails(worldName, update, requestId, {
                        reason: worldCommit.reason || "world_commit_failed",
                        block_type: update.block_type,
                    }));
                    return;
                }
            }
            releaseUniqueSpecialBlockPlacementLock();
            applyPunchToggleInstantDeathPresence(punchToggleKilledPlayers, worldName);
            sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
            if (worldLockStatePayload) {
                sendWorldUpdateToRequesterAndWorld(socket, player, worldName, worldLockStatePayload);
            }
            for (const payload of placementInteractionPayloads) {
                sendWorldUpdateToRequesterAndWorld(socket, player, worldName, payload);
            }
            if (worldLockStatePayload || areaLockStatePayload || electricalDeviceBlockChanged) {
                refreshElectricalVisibilityForWorld(worldName);
            }
            for (const drop of emittedDrops) {
                sendWorldUpdateToRequesterAndWorld(socket, player, worldName, drop);
            }
            if (electricalGeneration && electricalGeneration.data_update) {
                sendGeneratorPowerPayloadToWorld(worldName, electricalGeneration.data_update);
            }
            if (electricalGeneration && electricalGeneration.pulse) {
                sendGeneratorPowerPayloadToWorld(worldName, electricalGeneration.pulse);
            }
            if (isCctvBlockType(update.block_type)) {
                broadcastCctvWorldState(worldName);
            }
            logWorldChange(socket, player, worldChangeEntry, { skipPostgres: worldCommit.postgres_committed });
            for (const validationWorldChange of validationWorldChanges) {
                logWorldChange(socket, player, validationWorldChange, { skipPostgres: worldCommit.postgres_committed });
            }
            for (const placementInteractionChange of placementInteractionChanges) {
                logWorldChange(socket, player, placementInteractionChange, { skipPostgres: worldCommit.postgres_committed });
            }
            for (const electricalGenerationChange of electricalGenerationChanges) {
                logWorldChange(socket, player, electricalGenerationChange, { skipPostgres: worldCommit.postgres_committed });
            }
            if (update.action === "place" && validation.playerState) {
                const placementCost = ItemDatabase.getPlacementCost(update.block_type);
                if (placementCost && Number(placementCost.amount) > 0) {
                    logItemLedgerForState(socket, player, player.account_username, validation.playerState, placementCost.item_id, placementCost.item_category, -placementCost.amount, "world_block_place", blockTransactionId, "placement_cost", worldName, {
                        x: update.x,
                        y: update.y,
                        placed_block: update.block_type,
                        layer: update.layer,
                    }, { skipPostgres: validation.postgres_committed });
                }
            }
            for (const dropWorldChangeEntry of dropWorldChangeEntries) {
                logWorldChange(socket, player, dropWorldChangeEntry, { skipPostgres: worldCommit.postgres_committed });
            }
            if (validation.postCommitLogs && typeof validation.postCommitLogs === "object") {
                if (validation.postCommitLogs.vendingTransaction) {
                    logVendingTransaction(socket, player, validation.postCommitLogs.vendingTransaction);
                }
                const committedStateForBreakReturn = validation.playerState || requesterPlayerState || ensurePlayerState(player.account_username);
                const itemLedgerEntries = Array.isArray(validation.postCommitLogs.itemLedgerEntries)
                    ? validation.postCommitLogs.itemLedgerEntries
                    : [];
                for (const entry of itemLedgerEntries) {
                    logItemLedgerForState(socket, player, player.account_username, committedStateForBreakReturn, entry.item_id, entry.item_category, entry.amount, entry.source_type, entry.source_id, entry.reason, worldName, entry.details || {}, {
                        skipPostgres: worldCommit.postgres_committed,
                    });
                }
            }
            const shouldSendRequesterInventoryResult = requesterPlayerState || requesterInventoryDeltas.length > 0 || hasProgressionPayload(requesterProgressionPayload);
            if (shouldSendRequesterInventoryResult) {
                sendInventoryTransactionResult(socket, {
                    ok: true,
                    request_id: requestId,
                    server_action_id: blockTransactionId,
                    action: update.action === "break" ? "world_block_break" : "world_block_place",
                    message: update.action === "break"
                        ? getProgressionMessage(progression, validation.message || getProgressionXpMessage(progression))
                        : getProgressionMessage(progression, validation.message || ""),
                    username: player.account_username,
                    progression: requesterProgressionPayload,
                    inventory_deltas: requesterInventoryDeltas,
                });
            }
            logPhase7ActionResult(socket, "ALLOW", "committed", {
                action: update.action,
                item: update.block_type,
                count: getPhase7InventoryCount(requesterPlayerState || validation.playerState || ensurePlayerState(player.account_username), update.block_type, "block"),
            });
        }
        catch (error) {
            releaseUniqueSpecialBlockPlacementLock();
            const requestId = makeRequestId(data);
            const rawX = Number(data?.x);
            const rawY = Number(data?.y);
            const details = {
                request_id: requestId,
                player_id: String(player?.id || socket?.playerId || ""),
                username: cleanAccountName(player?.account_username || player?.name || ""),
                world: cleanWorld(data?.world || player?.world || "START"),
                action: String(data?.action || ""),
                layer: String(data?.layer || ""),
                x: Number.isFinite(rawX) ? Math.trunc(rawX) : null,
                y: Number.isFinite(rawY) ? Math.trunc(rawY) : null,
                block_type: clampString(data?.block_type || ""),
                error: errorToCrashDetails(error),
                runtime: getCrashRuntimeState(),
            };
            writeCrashReport("world_block_update_exception", details);
            const errorStack = error instanceof Error ? error.stack : "";
            console.warn("[world_block_update_exception]", errorStack || error);
            sendActionRejected(socket, "world_block_update", "Block update failed safely. Check crash_reports.log for details.", {
                request_id: requestId,
                reason: "exception",
                world: details.world,
                action: details.action,
                x: details.x,
                y: details.y,
                block_type: details.block_type,
            });
        }
        finally {
            releasePlacementInventoryLock();
            releaseLiveActionLock(blockActionLock);
            socket.activeActionRequestId = "";
            clearPhase7BlockActionContext(socket);
        }
        return;
    }
    async function handleElectricalLayerUpdate(socket, player, data, context) {
        try {
            if (!requireAuthenticated(socket, player, "edit wiring"))
                return;
            const worldName = getPlayerCurrentWorldName(player);
            if (await rejectIfWorldBanned(socket, player, worldName, "electrical_layer_update"))
                return;
            const allowDevJsonFallback = shouldAllowPhase7DevJsonFallback(player, data, {
                world: worldName,
                allow_dev_json_fallback: true,
            });
            if (POSTGRES_ENABLED && POSTGRES_AUTHORITATIVE && !isPostgresAuthoritativeReady() && !allowDevJsonFallback) {
                sendActionRejected(socket, "electrical_layer_update", "PostgreSQL is not ready.", {
                    reason: "postgres_unavailable",
                });
                return;
            }
            const update = sanitizeElectricalLayerUpdate(data, worldName);
            if (!update)
                return;
            const requestedWorldName = cleanWorld(data.world || data.current_world || data.world_id || worldName);
            if (requestedWorldName !== worldName) {
                sendActionRejected(socket, "electrical_layer_update", "Join that world before editing wiring.", {
                    reason: "wrong_world",
                    requested_world: requestedWorldName,
                    current_world: worldName,
                    block_type: update.block_type,
                });
                return;
            }
            update.player_id = String(player?.id || socket?.playerId || "");
            update.username = cleanAccountName(player?.account_username || player?.name || "");
            update.account_username = update.username;
            const validation = await validateElectricalLayerUpdateAgainstServerState(socket, player, worldName, update, makeRequestId(data), {
                allow_dev_json_fallback: allowDevJsonFallback,
            });
            if (!validation.ok)
                return;
            const electricalTransactionId = makeAuditId("electrical");
            const previousWorldState = serializeWorldState(worldName);
            const objectBefore = validation.previousEntry || cloneJson(ensureWorldState(worldName).electrical.get(gridKey(update.x, update.y)) || {});
            const applyResult = applyElectricalLayerUpdateToWorldState(worldName, update);
            const objectAfter = update.action === "place"
                ? cloneJson(ensureWorldState(worldName).electrical.get(gridKey(update.x, update.y)) || {})
                : {};
            const emittedDrops = update.action === "break"
                ? createElectricalBreakDrops(worldName, update, applyResult.previousEntry)
                : [];
            const objectUpdate = {
                type: "electrical_layer_update",
                source_type: "electrical_layer_update",
                source_id: electricalTransactionId,
                request_id: makeRequestId(data),
                action: update.action === "place" ? "electrical_tile_place" : "electrical_tile_break",
                object_type: "electrical_tile",
                object_id: `electrical:${update.x}:${update.y}`,
                world: worldName,
                x: update.x,
                y: update.y,
                block_type: update.block_type,
            };
            const electricalChangeEntry = buildWorldObjectChangeEntry(socket, player, worldName, objectUpdate, objectBefore, objectAfter, electricalTransactionId, {
                electrical_action: update.action,
                device_type: update.device_type,
                signal_mode: update.signal_mode,
            });
            const worldChanges = [electricalChangeEntry];
            let worldCommit = null;
            let requesterPlayerState = validation.playerState || null;
            let requesterInventoryDeltas = buildInventoryDeltaClientPayloads(validation.inventoryDeltas, requesterPlayerState);
            if (validation.deferred_inventory_commit) {
                const deferred = validation.deferred_inventory_commit;
                const serializedWorld = serializeWorldState(worldName);
                const inventoryCommit = await commitPlayerInventoryState(socket, player, deferred.username, deferred.beforeState, deferred.afterState, {
                    ...(deferred.options || {}),
                    allow_dev_json_fallback: allowDevJsonFallback,
                    world: worldName,
                    world_state: serializedWorld,
                    world_changes: worldChanges,
                });
                if (!inventoryCommit.ok) {
                    worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
                    sendActionRejected(socket, "electrical_layer_update", inventoryCommit.message || "PostgreSQL rejected the wiring update.", {
                        reason: inventoryCommit.reason || "inventory_commit_failed",
                        block_type: update.block_type,
                    });
                    return;
                }
                validation.playerState = inventoryCommit.state;
                validation.postgres_committed = inventoryCommit.postgres_committed;
                requesterPlayerState = inventoryCommit.state || requesterPlayerState;
                requesterInventoryDeltas = buildInventoryDeltaClientPayloads(inventoryCommit.deltas, requesterPlayerState);
                persistWorldStateAfterInventoryCommit(worldName, inventoryCommit.postgres_committed, serializedWorld);
                worldCommit = { ok: true, postgres_committed: inventoryCommit.postgres_committed, serialized: serializedWorld };
            }
            else {
                worldCommit = await commitWorldStateWithBlockChanges(worldName, worldChanges, {
                    player,
                    allow_dev_json_fallback: allowDevJsonFallback,
                });
                if (!worldCommit.ok) {
                    worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
                    sendActionRejected(socket, "electrical_layer_update", worldCommit.message || "PostgreSQL rejected the wiring update.", {
                        reason: worldCommit.reason || "world_commit_failed",
                        block_type: update.block_type,
                    });
                    return;
                }
            }
            const nextEntry = ensureWorldState(worldName).electrical.get(gridKey(update.x, update.y)) || null;
            sendElectricalPayloadToVisiblePlayers(worldName, makeElectricalTilePayload(worldName, update.action, nextEntry, {
                x: update.x,
                y: update.y,
                block_type: update.block_type,
                item_id: update.block_type,
            }));
            for (const drop of emittedDrops) {
                sendWorldUpdateToRequesterAndWorld(socket, player, worldName, drop);
            }
            logWorldChange(socket, player, electricalChangeEntry, { skipPostgres: worldCommit.postgres_committed });
            if (update.action === "place" && requesterPlayerState) {
                logItemLedgerForState(socket, player, player.account_username, requesterPlayerState, update.block_type, "block", -1, "electrical_layer_place", electricalTransactionId, "electrical_placement_cost", worldName, {
                    x: update.x,
                    y: update.y,
                    layer: "electrical",
                }, { skipPostgres: validation.postgres_committed });
                sendInventoryTransactionResult(socket, {
                    ok: true,
                    action: "electrical_layer_place",
                    message: "",
                    username: player.account_username,
                    inventory_deltas: requesterInventoryDeltas,
                });
            }
        }
        catch (error) {
            const requestId = makeRequestId(data);
            writeCrashReport("electrical_layer_update_exception", {
                request_id: requestId,
                player_id: String(player?.id || socket?.playerId || ""),
                username: cleanAccountName(player?.account_username || player?.name || ""),
                world: cleanWorld(data?.world || player?.world || "START"),
                action: String(data?.action || ""),
                x: Number.isFinite(Number(data?.x)) ? Math.trunc(Number(data.x)) : null,
                y: Number.isFinite(Number(data?.y)) ? Math.trunc(Number(data.y)) : null,
                block_type: clampString(data?.block_type || data?.item_id || ""),
                error: errorToCrashDetails(error),
                runtime: getCrashRuntimeState(),
            });
            const errorStack = error instanceof Error ? error.stack : "";
            console.warn("[electrical_layer_update_exception]", errorStack || error);
            sendActionRejected(socket, "electrical_layer_update", "Wiring update failed safely. Check crash_reports.log for details.", {
                request_id: requestId,
                reason: "exception",
            });
        }
        return;
    }
    async function handleRequestWireVisibilityRefresh(socket, player, data, context) {
        if (!requireAuthenticated(socket, player, "refresh wiring visibility"))
            return;
        const worldName = cleanWorld(data.world || player.world || "START");
        if (!requireSameWorld(socket, player, worldName, "refresh wiring visibility there"))
            return;
        if (await rejectIfWorldBanned(socket, player, worldName, "request_wire_visibility_refresh"))
            return;
        if (data.equipment_slots && typeof data.equipment_slots === "object" && !Array.isArray(data.equipment_slots)) {
            player.equipment_slots = sanitizeEquipmentSlots(data.equipment_slots, player.account_username);
        }
        else if (Object.prototype.hasOwnProperty.call(data, "equipped_tool")) {
            player.equipment_slots = sanitizeEquipmentSlots({
                ...(player.equipment_slots || {}),
                hand: data.equipped_tool || "",
            }, player.account_username);
        }
        sendElectricalVisibilityRefresh(socket, player, worldName, { force: true });
        return;
    }
    async function handleRequestOpenGenerator(socket, player, data, context) {
        if (!requireAuthenticated(socket, player, "open transformers"))
            return;
        const worldName = cleanWorld(data.world || player.world || "START");
        if (!requireSameWorld(socket, player, worldName, "open that transformer"))
            return;
        if (await rejectIfWorldBanned(socket, player, worldName, "request_open_generator"))
            return;
        const x = Number(data.x);
        const y = Number(data.y);
        if (!Number.isFinite(x) || !Number.isFinite(y))
            return;
        const gridX = Math.trunc(x);
        const gridY = Math.trunc(y);
        if (!isGridInWorld(gridX, gridY))
            return;
        if (!isPlayerNearGrid(player, gridX, gridY, MAX_GRID_ACTION_DISTANCE_PIXELS, { action: "request_open_generator", world: worldName })) {
            sendActionRejected(socket, "request_open_generator", "Too far away.", {
                reason: "too_far",
                target_x: gridX,
                target_y: gridY,
            });
            return;
        }
        if (!canPlayerViewElectricalLayer(player, worldName)) {
            sendActionRejected(socket, "request_open_generator", "Only players with world access can open transformers.", {
                reason: "electrical_access_denied",
            });
            return;
        }
        const state = ensureWorldState(worldName);
        const generatorEntry = getGeneratorDeviceStateAt(state, gridX, gridY);
        if (!generatorEntry || generatorEntry.device_type !== ELECTRICAL_DEVICE_GENERATOR) {
            sendActionRejected(socket, "request_open_generator", "Transformer missing.", {
                reason: "generator_missing",
            });
            return;
        }
        const payload = makeGeneratorDataPayload(worldName, generatorEntry, {
            opened: true,
        });
        if (payload)
            sendJson(socket, payload);
        return;
    }
    async function handleRequestLinkGeneratorPad(socket, player, data, context) {
        if (!requireAuthenticated(socket, player, "link transformer circuits"))
            return;
        const worldName = cleanWorld(data.world || player.world || "START");
        if (!requireSameWorld(socket, player, worldName, "link that transformer"))
            return;
        if (await rejectIfWorldBanned(socket, player, worldName, "request_link_generator_pad"))
            return;
        const generatorX = Number(data.generator_x);
        const generatorY = Number(data.generator_y);
        const padX = Number(data.pad_x);
        const padY = Number(data.pad_y);
        if (!Number.isFinite(generatorX) || !Number.isFinite(generatorY) || !Number.isFinite(padX) || !Number.isFinite(padY))
            return;
        const gridGeneratorX = Math.trunc(generatorX);
        const gridGeneratorY = Math.trunc(generatorY);
        const gridPadX = Math.trunc(padX);
        const gridPadY = Math.trunc(padY);
        if (!isGridInWorld(gridGeneratorX, gridGeneratorY) || !isGridInWorld(gridPadX, gridPadY))
            return;
        if (!isPlayerNearGrid(player, gridPadX, gridPadY, MAX_GRID_ACTION_DISTANCE_PIXELS, { action: "request_link_generator_pad", world: worldName })) {
            sendActionRejected(socket, "request_link_generator_pad", "Too far away.", {
                reason: "too_far",
                target_x: gridPadX,
                target_y: gridPadY,
            });
            return;
        }
        if (!canPlayerViewElectricalLayer(player, worldName)) {
            sendActionRejected(socket, "request_link_generator_pad", "Only players with world access can link transformers.", {
                reason: "electrical_access_denied",
            });
            return;
        }
        if (!playerHasElectricToolEquipped(player)) {
            sendActionRejected(socket, "request_link_generator_pad", "Equip the Electric Tool to link transformers.", {
                reason: "electric_tool_required",
            });
            return;
        }
        if (!canPlayerBuildAtGrid(player, worldName, gridGeneratorX, gridGeneratorY) || !canPlayerBuildAtGrid(player, worldName, gridPadX, gridPadY)) {
            sendActionRejected(socket, "request_link_generator_pad", "This area is locked.", {
                reason: "area_lock_permission_denied",
            });
            return;
        }
        const state = ensureWorldState(worldName);
        const generatorEntry = getGeneratorDeviceStateAt(state, gridGeneratorX, gridGeneratorY);
        if (!generatorEntry || generatorEntry.device_type !== ELECTRICAL_DEVICE_GENERATOR) {
            sendActionRejected(socket, "request_link_generator_pad", "Transformer missing.", {
                reason: "generator_missing",
            });
            return;
        }
        const padEntry = getMetalPadDeviceStateAt(state, gridPadX, gridPadY);
        if (!padEntry || padEntry.device_type !== ELECTRICAL_DEVICE_METAL_PAD) {
            sendActionRejected(socket, "request_link_generator_pad", "Tap a metal pad to link.", {
                reason: "metal_pad_missing",
            });
            return;
        }
        const generatorKey = gridKey(gridGeneratorX, gridGeneratorY);
        const padKey = gridKey(gridPadX, gridPadY);
        const existingGeneratorKey = findGeneratorLinkedToPad(state, padKey);
        if (existingGeneratorKey !== "" && existingGeneratorKey !== generatorKey) {
            sendActionRejected(socket, "request_link_generator_pad", "That metal pad is already linked to another transformer.", {
                reason: "metal_pad_already_linked",
            });
            return;
        }
        let linkedPadKeys = getGeneratorLinkedPadKeys(generatorEntry);
        if (linkedPadKeys.includes(padKey)) {
            const alreadyPayload = makeGeneratorDataPayload(worldName, generatorEntry, {
                opened: true,
                linked: true,
                pad_x: gridPadX,
                pad_y: gridPadY,
            });
            if (alreadyPayload)
                sendJson(socket, alreadyPayload);
            return;
        }
        if (linkedPadKeys.length >= ELECTRICAL_MAX_PADS_PER_GENERATOR) {
            sendActionRejected(socket, "request_link_generator_pad", "Transformer circuits are full.", {
                reason: "generator_circuits_full",
                linked_pad_count: linkedPadKeys.length,
                linked_pad_capacity: ELECTRICAL_MAX_PADS_PER_GENERATOR,
            });
            return;
        }
        const previousWorldState = serializeWorldState(worldName);
        const generatorBefore = cloneJson(generatorEntry);
        linkedPadKeys = [...linkedPadKeys, padKey];
        setGeneratorLinkedPadKeys(generatorEntry, linkedPadKeys);
        markElectricalNetworksDirty(state);
        const generatorAfter = cloneJson(generatorEntry);
        const linkTransactionId = makeAuditId("electrical_link");
        const linkPayload = makeGeneratorDataPayload(worldName, generatorEntry, {
            opened: true,
            linked: true,
            pad_x: gridPadX,
            pad_y: gridPadY,
        });
        const linkChangeEntry = buildWorldObjectChangeEntry(socket, player, worldName, {
            action: "electrical_generator_link",
            source_type: "electrical_generator_link",
            x: gridGeneratorX,
            y: gridGeneratorY,
            block_type: ELECTRICAL_GENERATOR_ITEM,
        }, generatorBefore, generatorAfter, linkTransactionId, {
            pad_x: gridPadX,
            pad_y: gridPadY,
            linked_pad_count: linkedPadKeys.length,
            linked_pad_capacity: ELECTRICAL_MAX_PADS_PER_GENERATOR,
        });
        const worldCommit = await commitWorldStateWithBlockChanges(worldName, [linkChangeEntry], {
            player,
        });
        if (!worldCommit.ok) {
            worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
            sendActionRejected(socket, "request_link_generator_pad", worldCommit.message || "PostgreSQL rejected the transformer link.", {
                reason: worldCommit.reason || "world_commit_failed",
            });
            return;
        }
        if (linkPayload)
            sendElectricalPayloadToVisiblePlayers(worldName, linkPayload);
        logWorldChange(socket, player, linkChangeEntry, { skipPostgres: worldCommit.postgres_committed });
        return;
    }
    async function handleRequestLinkGeneratorPole(socket, player, data, context) {
        if (!requireAuthenticated(socket, player, "link transformer outputs"))
            return;
        const worldName = cleanWorld(data.world || player.world || "START");
        if (!requireSameWorld(socket, player, worldName, "link that transformer output"))
            return;
        if (await rejectIfWorldBanned(socket, player, worldName, "request_link_generator_pole"))
            return;
        const generatorX = Number(data.generator_x);
        const generatorY = Number(data.generator_y);
        const poleX = Number(data.pole_x);
        const poleY = Number(data.pole_y);
        if (!Number.isFinite(generatorX) || !Number.isFinite(generatorY) || !Number.isFinite(poleX) || !Number.isFinite(poleY))
            return;
        const gridGeneratorX = Math.trunc(generatorX);
        const gridGeneratorY = Math.trunc(generatorY);
        const gridPoleX = Math.trunc(poleX);
        const gridPoleY = Math.trunc(poleY);
        if (!isGridInWorld(gridGeneratorX, gridGeneratorY) || !isGridInWorld(gridPoleX, gridPoleY))
            return;
        if (!isPlayerNearGrid(player, gridPoleX, gridPoleY, MAX_GRID_ACTION_DISTANCE_PIXELS, { action: "request_link_generator_pole", world: worldName })) {
            sendActionRejected(socket, "request_link_generator_pole", "Too far away.", {
                reason: "too_far",
                target_x: gridPoleX,
                target_y: gridPoleY,
            });
            return;
        }
        if (!canPlayerViewElectricalLayer(player, worldName)) {
            sendActionRejected(socket, "request_link_generator_pole", "Only players with world access can link transformer outputs.", {
                reason: "electrical_access_denied",
            });
            return;
        }
        if (!playerHasElectricToolEquipped(player)) {
            sendActionRejected(socket, "request_link_generator_pole", "Equip the Electric Tool to link transformer outputs.", {
                reason: "electric_tool_required",
            });
            return;
        }
        if (!canPlayerBuildAtGrid(player, worldName, gridGeneratorX, gridGeneratorY) || !canPlayerBuildAtGrid(player, worldName, gridPoleX, gridPoleY)) {
            sendActionRejected(socket, "request_link_generator_pole", "This area is locked.", {
                reason: "area_lock_permission_denied",
            });
            return;
        }
        const state = ensureWorldState(worldName);
        const generatorEntry = getGeneratorDeviceStateAt(state, gridGeneratorX, gridGeneratorY);
        if (!generatorEntry || generatorEntry.device_type !== ELECTRICAL_DEVICE_GENERATOR) {
            sendActionRejected(socket, "request_link_generator_pole", "Transformer missing.", {
                reason: "generator_missing",
            });
            return;
        }
        const poleEntry = getElectricPoleDeviceStateAt(state, gridPoleX, gridPoleY);
        if (!poleEntry || poleEntry.device_type !== ELECTRICAL_DEVICE_POLE) {
            sendActionRejected(socket, "request_link_generator_pole", "Tap an electric pole to link.", {
                reason: "electric_pole_missing",
            });
            return;
        }
        const generatorKey = gridKey(gridGeneratorX, gridGeneratorY);
        const poleKey = gridKey(gridPoleX, gridPoleY);
        let linkedPoleKeys = getGeneratorLinkedPoleKeys(generatorEntry);
        if (linkedPoleKeys.includes(poleKey)) {
            const alreadyPayload = makeGeneratorDataPayload(worldName, generatorEntry, {
                opened: true,
                linked: true,
                output_linked: true,
                pole_x: gridPoleX,
                pole_y: gridPoleY,
            });
            if (alreadyPayload)
                sendJson(socket, alreadyPayload);
            return;
        }
        const linkedGeneratorKeys = getGeneratorKeysLinkedToPole(state, poleKey);
        if (linkedGeneratorKeys.length >= ELECTRICAL_MAX_TRANSFORMER_LINKS_PER_POLE) {
            sendActionRejected(socket, "request_link_generator_pole", "That electric pole has too many transformer links.", {
                reason: "electric_pole_transformer_links_full",
                linked_transformer_count: linkedGeneratorKeys.length,
                linked_transformer_capacity: ELECTRICAL_MAX_TRANSFORMER_LINKS_PER_POLE,
            });
            return;
        }
        if (linkedPoleKeys.length >= ELECTRICAL_MAX_POLES_PER_GENERATOR) {
            sendActionRejected(socket, "request_link_generator_pole", "Transformer outputs are full.", {
                reason: "generator_outputs_full",
                linked_pole_count: linkedPoleKeys.length,
                linked_pole_capacity: ELECTRICAL_MAX_POLES_PER_GENERATOR,
            });
            return;
        }
        const previousWorldState = serializeWorldState(worldName);
        const generatorBefore = cloneJson(generatorEntry);
        linkedPoleKeys = [...linkedPoleKeys, poleKey];
        setGeneratorLinkedPoleKeys(generatorEntry, linkedPoleKeys);
        markElectricalNetworksDirty(state);
        const generatorAfter = cloneJson(generatorEntry);
        const linkTransactionId = makeAuditId("electrical_output_link");
        const linkPayload = makeGeneratorDataPayload(worldName, generatorEntry, {
            opened: true,
            linked: true,
            output_linked: true,
            pole_x: gridPoleX,
            pole_y: gridPoleY,
        });
        const linkChangeEntry = buildWorldObjectChangeEntry(socket, player, worldName, {
            action: "electrical_generator_output_link",
            source_type: "electrical_generator_output_link",
            x: gridGeneratorX,
            y: gridGeneratorY,
            block_type: ELECTRICAL_GENERATOR_ITEM,
        }, generatorBefore, generatorAfter, linkTransactionId, {
            pole_x: gridPoleX,
            pole_y: gridPoleY,
            linked_pole_count: linkedPoleKeys.length,
            linked_pole_capacity: ELECTRICAL_MAX_POLES_PER_GENERATOR,
        });
        const worldCommit = await commitWorldStateWithBlockChanges(worldName, [linkChangeEntry], {
            player,
        });
        if (!worldCommit.ok) {
            worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
            sendActionRejected(socket, "request_link_generator_pole", worldCommit.message || "PostgreSQL rejected the transformer output link.", {
                reason: worldCommit.reason || "world_commit_failed",
            });
            return;
        }
        if (linkPayload)
            sendElectricalPayloadToVisiblePlayers(worldName, linkPayload);
        logWorldChange(socket, player, linkChangeEntry, { skipPostgres: worldCommit.postgres_committed });
        return;
    }
    async function handleRequestLinkElectricPoles(socket, player, data, context) {
        if (!requireAuthenticated(socket, player, "link electric poles"))
            return;
        const worldName = cleanWorld(data.world || player.world || "START");
        if (!requireSameWorld(socket, player, worldName, "link those electric poles"))
            return;
        if (await rejectIfWorldBanned(socket, player, worldName, "request_link_electric_poles"))
            return;
        const poleAX = Number(data.pole_a_x);
        const poleAY = Number(data.pole_a_y);
        const poleBX = Number(data.pole_b_x);
        const poleBY = Number(data.pole_b_y);
        if (!Number.isFinite(poleAX) || !Number.isFinite(poleAY) || !Number.isFinite(poleBX) || !Number.isFinite(poleBY))
            return;
        const gridPoleAX = Math.trunc(poleAX);
        const gridPoleAY = Math.trunc(poleAY);
        const gridPoleBX = Math.trunc(poleBX);
        const gridPoleBY = Math.trunc(poleBY);
        if (!isGridInWorld(gridPoleAX, gridPoleAY) || !isGridInWorld(gridPoleBX, gridPoleBY))
            return;
        const poleAKey = gridKey(gridPoleAX, gridPoleAY);
        const poleBKey = gridKey(gridPoleBX, gridPoleBY);
        if (poleAKey === poleBKey) {
            sendActionRejected(socket, "request_link_electric_poles", "Pick another electric pole.", {
                reason: "same_pole",
            });
            return;
        }
        if (!isPlayerNearGrid(player, gridPoleBX, gridPoleBY, MAX_GRID_ACTION_DISTANCE_PIXELS, { action: "request_link_electric_poles", world: worldName })) {
            sendActionRejected(socket, "request_link_electric_poles", "Too far away.", {
                reason: "too_far",
                target_x: gridPoleBX,
                target_y: gridPoleBY,
            });
            return;
        }
        if (!canPlayerViewElectricalLayer(player, worldName)) {
            sendActionRejected(socket, "request_link_electric_poles", "Only players with world access can link electric poles.", {
                reason: "electrical_access_denied",
            });
            return;
        }
        if (!playerHasElectricToolEquipped(player)) {
            sendActionRejected(socket, "request_link_electric_poles", "Equip the Electric Tool to link electric poles.", {
                reason: "electric_tool_required",
            });
            return;
        }
        if (!canPlayerBuildAtGrid(player, worldName, gridPoleAX, gridPoleAY) || !canPlayerBuildAtGrid(player, worldName, gridPoleBX, gridPoleBY)) {
            sendActionRejected(socket, "request_link_electric_poles", "This area is locked.", {
                reason: "area_lock_permission_denied",
            });
            return;
        }
        const state = ensureWorldState(worldName);
        const poleAEntry = getElectricPoleDeviceStateAt(state, gridPoleAX, gridPoleAY);
        const poleBEntry = getElectricPoleDeviceStateAt(state, gridPoleBX, gridPoleBY);
        if (!poleAEntry || poleAEntry.device_type !== ELECTRICAL_DEVICE_POLE || !poleBEntry || poleBEntry.device_type !== ELECTRICAL_DEVICE_POLE) {
            sendActionRejected(socket, "request_link_electric_poles", "Tap another electric pole to link.", {
                reason: "electric_pole_missing",
            });
            return;
        }
        let poleALinks = getPoleLinkedPoleKeys(poleAEntry);
        let poleBLinks = getPoleLinkedPoleKeys(poleBEntry);
        if (poleALinks.includes(poleBKey) || poleBLinks.includes(poleAKey)) {
            sendElectricalVisibilityRefresh(socket, player, worldName, { force: true });
            return;
        }
        if (poleALinks.length >= ELECTRICAL_MAX_POLE_LINKS_PER_POLE || poleBLinks.length >= ELECTRICAL_MAX_POLE_LINKS_PER_POLE) {
            sendActionRejected(socket, "request_link_electric_poles", "That electric pole has too many couplings.", {
                reason: "electric_pole_links_full",
            });
            return;
        }
        const previousWorldState = serializeWorldState(worldName);
        const poleABefore = cloneJson(poleAEntry);
        const poleBBefore = cloneJson(poleBEntry);
        poleALinks = [...poleALinks, poleBKey];
        poleBLinks = [...poleBLinks, poleAKey];
        setPoleLinkedPoleKeys(poleAEntry, poleALinks);
        setPoleLinkedPoleKeys(poleBEntry, poleBLinks);
        markElectricalNetworksDirty(state);
        const poleAAfter = cloneJson(poleAEntry);
        const poleBAfter = cloneJson(poleBEntry);
        const linkTransactionId = makeAuditId("electrical_pole_link");
        const linkChangeEntries = [
            buildWorldObjectChangeEntry(socket, player, worldName, {
                action: "electrical_pole_coupling_link",
                source_type: "electrical_pole_coupling_link",
                x: gridPoleAX,
                y: gridPoleAY,
                block_type: ELECTRICAL_POLE_ITEM,
            }, poleABefore, poleAAfter, linkTransactionId, {
                pole_a_x: gridPoleAX,
                pole_a_y: gridPoleAY,
                pole_b_x: gridPoleBX,
                pole_b_y: gridPoleBY,
            }),
            buildWorldObjectChangeEntry(socket, player, worldName, {
                action: "electrical_pole_coupling_link",
                source_type: "electrical_pole_coupling_link",
                x: gridPoleBX,
                y: gridPoleBY,
                block_type: ELECTRICAL_POLE_ITEM,
            }, poleBBefore, poleBAfter, linkTransactionId, {
                pole_a_x: gridPoleAX,
                pole_a_y: gridPoleAY,
                pole_b_x: gridPoleBX,
                pole_b_y: gridPoleBY,
            }),
        ];
        const worldCommit = await commitWorldStateWithBlockChanges(worldName, linkChangeEntries, {
            player,
        });
        if (!worldCommit.ok) {
            worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
            sendActionRejected(socket, "request_link_electric_poles", worldCommit.message || "PostgreSQL rejected the electric pole link.", {
                reason: worldCommit.reason || "world_commit_failed",
            });
            return;
        }
        refreshElectricalVisibilityForWorld(worldName);
        for (const changeEntry of linkChangeEntries) {
            logWorldChange(socket, player, changeEntry, { skipPostgres: worldCommit.postgres_committed });
        }
        return;
    }
    async function handleWorldSeedUpdate(socket, player, data, context) {
        if (!requireAuthenticated(socket, player, "edit worlds"))
            return;
        const worldName = cleanWorld(data.world || player.world || "START");
        if (!requireSameWorld(socket, player, worldName, "edit that world"))
            return;
        if (await rejectIfWorldBanned(socket, player, worldName, "world_seed_update"))
            return;
        if (!requireBuildPermission(socket, player, worldName, "edit this locked world"))
            return;
        const update = sanitizeSeedUpdate(data, worldName);
        if (!update)
            return;
        const validation = await validateSeedUpdateAgainstServerState(socket, player, worldName, update, makeRequestId(data));
        if (!validation.ok)
            return;
        const seedTransactionId = makeAuditId("seed");
        applySeedUpdateToWorldState(worldName, update);
        queueWorldSave(worldName);
        const requesterInventoryDeltas = validation.playerState
            ? buildInventoryDeltaClientPayloads(validation.inventoryDeltas, validation.playerState)
            : [];
        sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
        logWorldChange(socket, player, {
            source_type: "world_seed_update",
            source_id: seedTransactionId,
            world: worldName,
            action: update.action,
            layer: "seed",
            x: update.x,
            y: update.y,
            block_type: update.seed_type,
            details: {
                seed_type: update.seed_type,
                mutated: Boolean(update.mutated),
            },
        });
        if (update.action === "place" && validation.playerState) {
            logItemLedgerForState(socket, player, player.account_username, validation.playerState, update.seed_type, "seed", -1, "world_seed_place", seedTransactionId, "seed_plant_cost", worldName, {
                x: update.x,
                y: update.y,
            }, { skipPostgres: validation.postgres_committed });
        }
        if (validation.playerState) {
            sendInventoryTransactionResult(socket, {
                ok: true,
                action: "world_seed_place",
                message: "",
                username: player.account_username,
                inventory_deltas: requesterInventoryDeltas,
            });
        }
        return;
    }
    return {
        handleWorldBlockUpdate,
        handleElectricalLayerUpdate,
        handleRequestWireVisibilityRefresh,
        handleRequestOpenGenerator,
        handleRequestLinkGeneratorPad,
        handleRequestLinkGeneratorPole,
        handleRequestLinkElectricPoles,
        handleWorldSeedUpdate,
    };
}
module.exports = {
    createServerPhase8WorldActionRoutes,
};
