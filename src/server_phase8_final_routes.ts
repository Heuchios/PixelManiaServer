"use strict";

export {};

type PacketRecord = Record<string, any>;

interface RouteContext {
  playerId: string;
  routeType?: string;
  usedActionPosition?: boolean;
}

interface Phase8FinalRouteDeps extends Record<string, any> {}

const DROP_PICKUP_INVENTORY_LOCK_WAIT_MS = Math.max(0, Math.trunc(Number(process.env.DROP_PICKUP_INVENTORY_LOCK_WAIT_MS) || 650));
const DROP_PICKUP_INVENTORY_LOCK_RETRY_MS = Math.max(5, Math.trunc(Number(process.env.DROP_PICKUP_INVENTORY_LOCK_RETRY_MS) || 25));

function createServerPhase8FinalRoutes(deps: Phase8FinalRouteDeps) {
  const {
    DropContracts,
    InventoryContracts,
    acceptPlayerMovement,
    accountKey,
    accounts,
    acquireLiveActionLock,
    acquirePlayerInventoryLocks,
    applyDropCreateToWorldState,
    applyDropPickupToWorldState,
    applyDropPickupWorldState,
    applyDropUpdateToWorldState,
    applyInteractionUpdateToWorldState,
    buildInventoryDeltaClientPayloads,
    buildPublicPlayerPresencePayload,
    buildWorldInteractionDetails,
    buildWorldObjectChangeEntry,
    clampInteger,
    cleanAccountName,
    cleanName,
    cleanWorld,
    cloneJson,
    commitPlayerInventoryState,
    commitWorldStateWithBlockChanges,
    debugActionPositionFlow,
    debugNetfoxAction,
    deserializeWorldState,
    enforceStandardMovementForSocket,
    ensureWorldState,
    ensureWritablePlayerState,
    getEquipmentSlotsComparisonKey,
    getActiveThemeMachineDisableUpdates,
    getInventoryCount,
    getInventoryFieldForCategory,
    getPlayerCurrentWorldName,
    getPlayerPositionHeartbeatIntervalMs,
    getPlayerPresenceBroadcastSignature,
    getPostgresInventoryFailureMessage,
    getSocketAddress,
    getSocketDeviceInfo,
    getSocketUserAgent,
    getTrustedMovementModeLabel,
    getWorldObjectJournalData,
    handleBulkDropPickup,
    handleCheckpointActivateUpdate,
    handleChickenStateUpdate,
    handleCowStateUpdate,
    handleDiceRollUpdate,
    handleDoorMoveUpdate,
    handleDuckStateUpdate,
    handleEntranceGateMoveUpdate,
    handleTackleBoxHarvestUpdate,
    handleWorldLockMoveUpdate,
    isPostgresAuthoritativeReady,
    isValidRespawnTeleportPosition,
    logDropPickupInventoryIssue,
    logDropPickupNotAvailable,
    logDropPickupTooFar,
    logItemLedgerForState,
    logWorldChange,
    makeAuditId,
    makeRequestId,
    maybeApplyReciprocalDoorLink,
    persistAuthoritativeWorldState,
    persistPlayerInventoryChange,
    persistWorldStateAfterInventoryCommit,
    playerNetworkStats,
    postgresStore,
    prepareAntiGravityStateUpdate,
    prepareAntiPunchStateUpdate,
    prepareAntiTalkStateUpdate,
    prepareAreaLockStateUpdate,
    prepareBulletinBoardStateUpdate,
    prepareDoorStateUpdate,
    prepareDropPickup,
    prepareEntrancePassUpdate,
    prepareMailboxStateUpdate,
    prepareSpringboardAnimationUpdate,
    prepareThemeMachineStateUpdate,
    prepareToggleBlockStateUpdate,
    prepareWoodenEntranceStateUpdate,
    prepareWorldLockStateUpdate,
    queuePlayerPositionBroadcast,
    queueWorldSave,
    queueWorldUpdateBroadcast,
    refreshElectricalVisibilityForWorld,
    refreshPlayerFishingPresence,
    rejectIfWorldBanned,
    releaseLiveActionLock,
    releasePlayerInventoryLocks,
    removeUnavailableDropFromWorldState,
    requireAuthenticated,
    requireBuildPermission,
    requireBuildPermissionAtGrid,
    requireSameWorld,
    sanitizeDropCreate,
    sanitizeDropPickup,
    sanitizeDropUpdate,
    sanitizeEquipmentSlots,
    sanitizeInteractionUpdate,
    sanitizePlayerAnimationState,
    sanitizePlayerDamageFlash,
    sanitizePlayerPosition,
    sanitizePlayerVelocity,
    sendActionRejected,
    sendElectricalVisibilityRefresh,
    sendInventoryTransactionResult,
    sendWorldUpdateToRequesterAndWorld,
    serializeWorldState,
    shouldUseBulkDropPickup,
    spendItemFromState,
    touchLivePresence,
    tradeByPlayerId,
    usesTrustedMovementPosition,
    validateDropCreateAgainstServerState,
    validateDropUpdateAgainstServerState,
    worldDropActionLocks,
    worldStates,
  } = deps;

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  async function acquirePlayerInventoryLocksWithWait(
    usernames: string[],
    owner: string,
    maxWaitMs: number = DROP_PICKUP_INVENTORY_LOCK_WAIT_MS,
    retryMs: number = DROP_PICKUP_INVENTORY_LOCK_RETRY_MS
  ): Promise<any> {
    const deadline = Date.now() + Math.max(0, maxWaitMs);
    let lastLock: any = null;
    while (true) {
      lastLock = await acquirePlayerInventoryLocks(usernames, owner);
      if (lastLock?.acquired) return lastLock;
      if (Date.now() >= deadline) return lastLock || { acquired: false, locks: [], blocked_resource: "" };
      await sleep(Math.max(5, retryMs));
    }
  }

  async function handleWorldInteractionUpdate(socket: any, player: any, data: PacketRecord, context: RouteContext): Promise<void> {

          if (!requireAuthenticated(socket, player, "edit worlds")) return;

          const worldName = cleanWorld(data.world || player.world || "START");
          if (!requireSameWorld(socket, player, worldName, "edit that world")) return;
          if (await rejectIfWorldBanned(socket, player, worldName, "world_interaction_update")) return;

          const update = sanitizeInteractionUpdate(data, worldName);
          if (!update) return;

          if (update.action === "springboard_animation") {
            if (!prepareSpringboardAnimationUpdate(socket, player, worldName, update)) return;
            queueWorldUpdateBroadcast(worldName, update, player.id);
            touchLivePresence(socket, player);
            return;
          }

          if (update.action === "entrance_pass") {
            if (!prepareEntrancePassUpdate(socket, player, worldName, update)) return;
            queueWorldUpdateBroadcast(worldName, update, player.id);
            touchLivePresence(socket, player);
            return;
          }

          if (update.action === "entrance_gate_move") {
            if (!requireBuildPermission(socket, player, worldName, "move the Entrance Gate")) return;
            await handleEntranceGateMoveUpdate(socket, player, worldName, update, makeRequestId(data));
            return;
          }

          if (update.action === "world_lock_move") {
            await handleWorldLockMoveUpdate(socket, player, worldName, update, makeRequestId(data));
            return;
          }

          if (update.action === "door_move") {
            await handleDoorMoveUpdate(socket, player, worldName, update, makeRequestId(data));
            return;
          }

          if (update.action === "tackle_box_state") {
            if (!requireBuildPermissionAtGrid(socket, player, worldName, update.x, update.y, "world_interaction_update")) return;
            await handleTackleBoxHarvestUpdate(socket, player, worldName, update, makeRequestId(data));
            return;
          }

          if (update.action === "chicken_state") {
            if (!requireBuildPermissionAtGrid(socket, player, worldName, update.x, update.y, "world_interaction_update")) return;
            await handleChickenStateUpdate(socket, player, worldName, update, makeRequestId(data));
            return;
          }

          if (update.action === "cow_state") {
            if (!requireBuildPermissionAtGrid(socket, player, worldName, update.x, update.y, "world_interaction_update")) return;
            await handleCowStateUpdate(socket, player, worldName, update, makeRequestId(data));
            return;
          }

          if (update.action === "duck_state") {
            if (!requireBuildPermissionAtGrid(socket, player, worldName, update.x, update.y, "world_interaction_update")) return;
            await handleDuckStateUpdate(socket, player, worldName, update, makeRequestId(data));
            return;
          }

          if (update.action === "dice_roll") {
            await handleDiceRollUpdate(socket, player, worldName, update, makeRequestId(data));
            return;
          }

          if (update.action === "checkpoint_activate") {
            await handleCheckpointActivateUpdate(socket, player, worldName, update);
            return;
          }

          if (update.action === "anti_punch_state") {
            if (!prepareAntiPunchStateUpdate(socket, player, worldName, update)) return;
          }

          if (update.action === "anti_talk_state") {
            if (!prepareAntiTalkStateUpdate(socket, player, worldName, update)) return;
          }

          if (update.action === "anti_gravity_state") {
            if (!prepareAntiGravityStateUpdate(socket, player, worldName, update)) return;
          }

          if (update.action === "wooden_entrance_state") {
            if (!prepareWoodenEntranceStateUpdate(socket, player, worldName, update)) return;
          } else if (update.action === "door_state") {
            if (!prepareDoorStateUpdate(socket, player, worldName, update)) return;
          } else if (update.action === "ceiling_lamp_state") {
            if (!requireBuildPermission(socket, player, worldName, "toggle this lamp")) return;
            if (!prepareToggleBlockStateUpdate(socket, player, worldName, update, "ceiling_lamp_state")) return;
          } else if (update.action === "theme_machine_state") {
            if (!prepareThemeMachineStateUpdate(socket, player, worldName, update)) return;
          } else if (update.action === "world_lock_state") {
            if (!prepareWorldLockStateUpdate(socket, player, worldName, update)) return;
          } else if (update.action === "area_lock_state") {
            if (!prepareAreaLockStateUpdate(socket, player, worldName, update)) return;
          } else if (update.action === "mailbox_state") {
            if (!prepareMailboxStateUpdate(socket, player, worldName, update)) return;
          } else if (update.action === "bulletin_board_state") {
            if (!prepareBulletinBoardStateUpdate(socket, player, worldName, update)) return;
          } else if (!requireBuildPermission(socket, player, worldName, "edit this locked world")) {
            return;
          }

          if (
            update.action !== "world_lock_state" &&
            update.action !== "area_lock_state" &&
            update.action !== "bulletin_board_state" &&
            update.action !== "theme_machine_state" &&
            Number.isFinite(Number(update.x)) &&
            Number.isFinite(Number(update.y)) &&
            !requireBuildPermissionAtGrid(socket, player, worldName, update.x, update.y, "world_interaction_update")
          ) {
            return;
          }

          const interactionSourceId = makeAuditId("interact");
          const previousWorldState = serializeWorldState(worldName);
          if (update.action === "theme_machine_state" && update.enabled) {
            const interactionUpdates = [...getActiveThemeMachineDisableUpdates(worldName, update), update];
            const worldObjectChangeEntries = [];
            for (const interactionUpdate of interactionUpdates) {
              const objectBefore = getWorldObjectJournalData(worldName, interactionUpdate);
              applyInteractionUpdateToWorldState(worldName, interactionUpdate);
              const objectAfter = getWorldObjectJournalData(worldName, interactionUpdate);
              const interactionDetails = buildWorldInteractionDetails(interactionUpdate);
              worldObjectChangeEntries.push(buildWorldObjectChangeEntry(
                socket,
                player,
                worldName,
                interactionUpdate,
                objectBefore,
                objectAfter,
                interactionSourceId,
                interactionDetails
              ));
            }
            const worldCommit = await commitWorldStateWithBlockChanges(worldName, worldObjectChangeEntries);
            if (!worldCommit.ok) {
              worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
              sendActionRejected(socket, "world_interaction_update", worldCommit.message || "PostgreSQL rejected the world update.");
              return;
            }
            for (const interactionUpdate of interactionUpdates) {
              sendWorldUpdateToRequesterAndWorld(socket, player, worldName, interactionUpdate);
            }
            for (const worldObjectChangeEntry of worldObjectChangeEntries) {
              logWorldChange(socket, player, worldObjectChangeEntry, { skipPostgres: worldCommit.postgres_committed });
            }
            return;
          }

          const objectBefore = getWorldObjectJournalData(worldName, update);
          applyInteractionUpdateToWorldState(worldName, update);
          const objectAfter = getWorldObjectJournalData(worldName, update);
          const interactionDetails = buildWorldInteractionDetails(update);
          const worldObjectChangeEntry = buildWorldObjectChangeEntry(
            socket,
            player,
            worldName,
            update,
            objectBefore,
            objectAfter,
            interactionSourceId,
            interactionDetails
          );
          const worldCommit = await commitWorldStateWithBlockChanges(worldName, [worldObjectChangeEntry]);
          if (!worldCommit.ok) {
            worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
            sendActionRejected(socket, "world_interaction_update", worldCommit.message || "PostgreSQL rejected the world update.");
            return;
          }
          sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
          if (update.action === "world_lock_state" || update.action === "area_lock_state") {
            refreshElectricalVisibilityForWorld(worldName);
          }
          if (update.action === "door_state") {
            await maybeApplyReciprocalDoorLink(socket, player, worldName, update);
          }
          logWorldChange(socket, player, worldObjectChangeEntry, { skipPostgres: worldCommit.postgres_committed });
          return;

  }

  async function handleWorldItemDropCreate(socket: any, player: any, data: PacketRecord, context: RouteContext): Promise<void> {

          if (!requireAuthenticated(socket, player, "edit drops")) return;

          const worldName = cleanWorld(data.world || player.world || "START");
          if (!requireSameWorld(socket, player, worldName, "create drops in that world")) return;
          if (await rejectIfWorldBanned(socket, player, worldName, "world_item_drop_create")) return;
          if (tradeByPlayerId.has(player.id)) {
            sendActionRejected(socket, "world_item_drop_create", "Finish or cancel your trade before dropping items.");
            return;
          }

          const update = sanitizeDropCreate(data, worldName);
          if (!update) return;
          if (!validateDropCreateAgainstServerState(socket, player, update)) return;

          const state = ensureWritablePlayerState(player.account_username);
          if (!state) {
            sendActionRejected(socket, "world_item_drop_create", "Could not load your server inventory.");
            return;
          }

          if (getInventoryCount(state, update.item_type, update.item_category) < update.amount) {
            sendActionRejected(socket, "world_item_drop_create", `Not enough ${update.item_type}.`);
            return;
          }

          const beforeState = cloneJson(state);
          const stagedState = cloneJson(state);
          if (!spendItemFromState(stagedState, update.item_type, update.item_category, update.amount)) {
            sendActionRejected(socket, "world_item_drop_create", "Server inventory changed. Try again.");
            return;
          }

          const requestId = makeRequestId(data);
          const dropTransactionId = makeAuditId("drop");
          update.server_action_id = dropTransactionId;
          applyDropCreateToWorldState(worldName, update);
          const serializedWorld = serializeWorldState(worldName);
          const worldChangeEntry = {
            source_type: "world_item_drop_create",
            source_id: dropTransactionId,
            request_id: requestId,
            world: worldName,
            action: "drop_create",
            x: update.x,
            y: update.y,
            block_type: update.item_type,
            details: {
              drop_id: update.drop_id,
              item_category: update.item_category,
              amount: update.amount,
              stack_grid_x: update.stack_grid_x,
              stack_grid_y: update.stack_grid_y,
              request_id: requestId,
              pickup_delay: update.pickup_delay,
            },
          };
          const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
            source: "drop_inventory",
            action: "world_item_drop_create",
            reason: "drop_from_inventory",
            request_id: requestId,
            world: worldName,
            allow_dev_json_fallback: true,
            metadata: {
              transaction_id: dropTransactionId,
              drop_id: update.drop_id,
              x: update.x,
              y: update.y,
              stack_grid_x: update.stack_grid_x,
              stack_grid_y: update.stack_grid_y,
            },
            world_state: serializedWorld,
            world_changes: [worldChangeEntry],
            failure_message: "Server inventory changed. Try again.",
          });
          if (!commit.ok) {
            ensureWorldState(worldName).drops.delete(update.drop_id);
            sendActionRejected(socket, "world_item_drop_create", commit.message);
            return;
          }

          const requesterInventoryDeltas = buildInventoryDeltaClientPayloads(commit.deltas, commit.state);
          persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
          sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
          logWorldChange(socket, player, worldChangeEntry, { skipPostgres: commit.postgres_committed });
          logItemLedgerForState(socket, player, player.account_username, commit.state, update.item_type, update.item_category, -update.amount, "world_item_drop_create", dropTransactionId, "drop_from_inventory", worldName, {
            drop_id: update.drop_id,
          }, { skipPostgres: commit.postgres_committed });
          sendInventoryTransactionResult(socket, {
            ok: true,
            request_id: requestId,
            server_action_id: dropTransactionId,
            action: "world_item_drop_create",
            message: "",
            username: player.account_username,
            inventory_deltas: requesterInventoryDeltas,
          });
          return;

  }

  async function handleWorldItemDropUpdate(socket: any, player: any, data: PacketRecord, context: RouteContext): Promise<void> {

          if (!requireAuthenticated(socket, player, "edit drops")) return;

          const worldName = cleanWorld(data.world || player.world || "START");
          if (!requireSameWorld(socket, player, worldName, "edit drops in that world")) return;
          if (await rejectIfWorldBanned(socket, player, worldName, "world_item_drop_update")) return;
          if (!requireBuildPermission(socket, player, worldName, "edit drops in this locked world")) return;

          const update = sanitizeDropUpdate(data, worldName);
          if (!update) return;
          if (!validateDropUpdateAgainstServerState(socket, player, worldName, update)) return;

          const requestId = makeRequestId(data);
          const dropTransactionId = makeAuditId("drop");
          update.server_action_id = dropTransactionId;
          applyDropUpdateToWorldState(worldName, update);
          queueWorldSave(worldName);
          sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
          logWorldChange(socket, player, {
            source_type: "world_item_drop_update",
            source_id: dropTransactionId,
            world: worldName,
            action: "drop_update",
            request_id: requestId,
            details: {
              drop_id: update.drop_id,
              request_id: requestId,
            },
          });
          return;

  }

  async function handleWorldItemDropPickup(socket: any, player: any, data: PacketRecord, context: RouteContext): Promise<void> {

          if (!requireAuthenticated(socket, player, "pick up drops")) return;

          const worldName = cleanWorld(data.world || getPlayerCurrentWorldName(player) || player.world || "START");
          if (!requireSameWorld(socket, player, worldName, "pick up drops in that world")) return;
          if (await rejectIfWorldBanned(socket, player, worldName, "world_item_drop_pickup")) return;

          const requestId = makeRequestId(data);
          if (shouldUseBulkDropPickup(data)) {
            await handleBulkDropPickup(socket, player, data, worldName, requestId);
            return;
          }

          const update = sanitizeDropPickup(data, worldName, player);
          if (!update) return;
          debugActionPositionFlow("world_item_drop_pickup request start", player, {
            drop_id: update.drop_id,
          });

          if (!usesTrustedMovementPosition(player) && update.action_position && acceptPlayerMovement(socket, player, update.action_position, { silent: true })) {
            player.x = update.action_position.x;
            player.y = update.action_position.y;
            player.facing = update.action_position.facing;
          }

          const pickupTransactionId = makeAuditId("pickup");
          if (isPostgresAuthoritativeReady()) {
            const rejectPickup = (pickupPlan: any, message: string, extra: Record<string, any> = {}) => {
              sendActionRejected(socket, "world_item_drop_pickup", message, {
                drop_id: update.drop_id,
                world: worldName,
                ...extra,
              });
            };

            let pickupPlan = prepareDropPickup(worldName, player, update);
            const rejectPreparedPickup = (plan: any) => {
              if (plan.reason === "inventory_full") {
                logDropPickupInventoryIssue("inventory_full", player, worldName, update.drop_id, plan);
                rejectPickup(plan, "Inventory full.");
                return true;
              }
              if (plan.reason === "inventory_unavailable") {
                logDropPickupInventoryIssue("inventory_unavailable", player, worldName, update.drop_id, plan);
                rejectPickup(plan, "Could not add that item to your server inventory.");
                return true;
              }
              if (plan.reason === "too_far") {
                logDropPickupTooFar(player, worldName, update.drop_id, plan.drop, update);
                rejectPickup(plan, "Too far away from that drop.");
                return true;
              }
              if (plan.reason === "wrong_world") {
                rejectPickup(plan, "Join that world before sending actions for it.", {
                  reason: "wrong_world",
                  current_world: plan.current_world,
                  requested_world: plan.world,
                });
                return true;
              }
              if (plan.reason === "position_unavailable") {
                rejectPickup(plan, "Player position is not ready.", {
                  reason: "position_unavailable",
                });
                return true;
              }
              logDropPickupNotAvailable(player, worldName, update.drop_id);
              rejectPickup(plan, "That drop is not available.");
              return true;
            };

            if (!pickupPlan.ok) {
              rejectPreparedPickup(pickupPlan);
              return;
            }

            const dropLockKey = `${pickupPlan.world}:${pickupPlan.dropId}`;
            const dropLock = await acquireLiveActionLock(worldDropActionLocks, "drop", dropLockKey, player.id);
            if (!dropLock.acquired) {
              rejectPickup(pickupPlan, "That drop is already being picked up.", {
                reason: "drop_locked",
              });
              return;
            }
            let inventoryLocks = null;

            try {
              pickupPlan = prepareDropPickup(worldName, player, update);
              if (!pickupPlan.ok) {
                rejectPreparedPickup(pickupPlan);
                return;
              }

              inventoryLocks = await acquirePlayerInventoryLocksWithWait([player.account_username], `drop:${dropLockKey}:${pickupTransactionId}`);
              if (!inventoryLocks.acquired) {
                rejectPickup(pickupPlan, "Inventory is busy. Try again.", {
                  reason: "inventory_locked",
                  blocked_resource: inventoryLocks.blocked_resource || "",
                });
                return;
              }

              const sessionAccount = accounts.get(accountKey(player.account_username)) || {};
              const postgresPickup = await postgresStore.applyDropPickupTransaction({
                account_username: player.account_username,
                world: pickupPlan.world,
                drop_id: pickupPlan.dropId,
                item_type: pickupPlan.item_type,
                item_category: pickupPlan.item_category,
                amount: pickupPlan.pickedAmount,
                expected_before_amount: pickupPlan.currentCount,
                stack_limit: pickupPlan.stackLimit,
                allow_state_repair: true,
                allow_world_drop_repair: true,
                request_id: requestId || pickupTransactionId,
                source_id: pickupTransactionId,
                drop_x: pickupPlan.drop.x,
                drop_y: pickupPlan.drop.y,
                stack_grid_x: pickupPlan.drop.stack_grid_x,
                stack_grid_y: pickupPlan.drop.stack_grid_y,
                pickup_delay: pickupPlan.drop.pickup_delay,
                drop_amount: pickupPlan.dropAmount,
                ip_address: getSocketAddress(socket),
                user_agent: getSocketUserAgent(socket, data),
                session_token_hash: cleanAccountName(sessionAccount.session_token_hash || ""),
                device_info: getSocketDeviceInfo(socket, data),
                at: new Date().toISOString(),
              });

              if (!postgresPickup.ok) {
                const postgresPickupReason = DropContracts.getPostgresDropPickupFailureReason(postgresPickup);
                logDropPickupInventoryIssue(postgresPickupReason, player, worldName, update.drop_id, pickupPlan, postgresPickup);
                if (postgresPickupReason === "insufficient_capacity") {
                  rejectPickup(pickupPlan, "Inventory full.", { reason: postgresPickupReason });
                  return;
                }
                // Only PostgreSQL proving the drop was fully collected may delete it
                // from live world state. Every other failure rolled the transaction
                // back, so the item is still in the world and no inventory received
                // it: destroying the drop here would permanently delete the item.
                if (DropContracts.isPostgresDropPickupCollectedFailure(postgresPickup)) {
                  const removal = removeUnavailableDropFromWorldState(pickupPlan.world, pickupPlan.dropId, pickupPlan);
                  if (removal.ok) {
                    sendWorldUpdateToRequesterAndWorld(socket, player, pickupPlan.world, removal.payload);
                    await persistAuthoritativeWorldState(
                      pickupPlan.world,
                      serializeWorldState(pickupPlan.world),
                      "drop_pickup_unavailable_cleanup"
                    );
                  }
                  rejectPickup(pickupPlan, "That drop is not available.", { reason: postgresPickupReason });
                  return;
                }
                rejectPickup(pickupPlan, getPostgresInventoryFailureMessage(postgresPickup, "Could not pick up that item right now."), {
                  reason: postgresPickupReason,
                  drop_status: DropContracts.getPostgresDropPickupDropStatus(postgresPickup),
                  drop_preserved: true,
                  retryable: DropContracts.isPostgresDropPickupRetryableFailure(postgresPickup),
                });
                return;
              }

              const pickupState = pickupPlan.playerState;
              const inventoryField = getInventoryFieldForCategory(pickupPlan.item_category, pickupPlan.item_type);
              if (!pickupState[inventoryField] || typeof pickupState[inventoryField] !== "object" || Array.isArray(pickupState[inventoryField])) {
                pickupState[inventoryField] = {};
              }
              const committedAfterAmountRaw = Number(postgresPickup.after_amount);
              const committedAfterAmount = Number.isFinite(committedAfterAmountRaw)
                ? clampInteger(committedAfterAmountRaw, 0, pickupPlan.stackLimit)
                : clampInteger(pickupPlan.currentCount + pickupPlan.pickedAmount, 0, pickupPlan.stackLimit);
              pickupState[inventoryField][pickupPlan.item_type] = committedAfterAmount;
              persistPlayerInventoryChange(player.account_username, pickupState, { postgresCommitted: true });

              const committedDropAfterAmountRaw = Number(postgresPickup.drop_after_amount);
              pickupPlan.remaining = Number.isFinite(committedDropAfterAmountRaw)
                ? Math.max(0, Math.trunc(committedDropAfterAmountRaw))
                : pickupPlan.remaining;
              const worldApply = applyDropPickupWorldState(pickupPlan.world, pickupPlan);
              const pickupUpdate = worldApply.ok
                ? worldApply.payload
                : removeUnavailableDropFromWorldState(pickupPlan.world, pickupPlan.dropId, pickupPlan).payload || null;
              const postPickupWorldState = serializeWorldState(pickupPlan.world);
              const worldPersistResult = await persistAuthoritativeWorldState(
                pickupPlan.world,
                postPickupWorldState,
                "drop_pickup"
              );
              if (!worldPersistResult.ok) {
                console.warn("[drop_pickup_world_persist_failed]", {
                  world: pickupPlan.world,
                  drop_id: pickupPlan.dropId,
                  pickup_transaction_id: pickupTransactionId,
                  reason: worldPersistResult.reason || "unknown",
                });
              }
              const pickedDrop = {
                ...pickupPlan.drop,
                amount: pickupPlan.pickedAmount,
              };

              logWorldChange(socket, player, {
                source_type: "world_item_drop_pickup",
                source_id: pickupTransactionId,
                request_id: requestId,
                world: pickupPlan.world,
                action: "drop_pickup",
                x: pickedDrop.x,
                y: pickedDrop.y,
                block_type: pickedDrop.item_type,
                details: {
                  drop_id: pickedDrop.drop_id,
                  item_category: pickedDrop.item_category,
                  amount: pickedDrop.amount,
                  request_id: requestId,
                  remaining: pickupPlan.remaining,
                },
              }, { skipPostgres: true });
              logItemLedgerForState(socket, player, player.account_username, pickupState, pickedDrop.item_type, pickedDrop.item_category, pickedDrop.amount, "world_item_drop_pickup", pickupTransactionId, "drop_pickup", pickupPlan.world, {
                drop_id: pickedDrop.drop_id,
              }, { skipPostgres: true });

              const pickupInventoryDelta = buildInventoryDeltaClientPayloads([{
                item_type: pickedDrop.item_type,
                item_category: pickedDrop.item_category,
                delta: pickedDrop.amount,
              }], pickupState);

              sendInventoryTransactionResult(socket, InventoryContracts.buildDropPickupInventoryTransactionResult({
                ok: true,
                request_id: requestId || pickupTransactionId,
                server_action_id: pickupTransactionId,
                world: pickupPlan.world,
                drop_id: pickedDrop.drop_id,
                item_type: pickedDrop.item_type,
                item_category: pickedDrop.item_category,
                amount: pickedDrop.amount,
                remaining: pickupPlan.remaining,
                remaining_amount: pickupPlan.remaining,
                requested_by: player.id,
                requested_by_name: cleanName(player.name),
                message: `Picked up ${pickedDrop.amount} ${pickedDrop.item_type}.`,
                username: player.account_username,
                inventory_delta: pickupInventoryDelta,
                inventory_deltas: pickupInventoryDelta,
                rewards: [InventoryContracts.buildInventoryRewardEntry({
                  itemId: pickedDrop.item_type,
                  itemCategory: pickedDrop.item_category,
                  amount: pickedDrop.amount,
                })],
              }));

              if (pickupUpdate) {
                sendWorldUpdateToRequesterAndWorld(socket, player, pickupPlan.world, pickupUpdate, {
                  username: player.account_username,
                  player_data: pickupState,
                });
              }
              debugActionPositionFlow("world_item_drop_pickup request end", player, {
                drop_id: update.drop_id,
                item_type: pickedDrop.item_type,
                amount: pickedDrop.amount,
              });
              return;
            } finally {
              releasePlayerInventoryLocks(inventoryLocks);
              releaseLiveActionLock(dropLock);
            }
          }

          const pickupResult = applyDropPickupToWorldState(worldName, update, player);
          if (!pickupResult.ok) {
            if (pickupResult.reason === "inventory_full") {
              sendActionRejected(socket, "world_item_drop_pickup", "Inventory full.", {
                drop_id: update.drop_id,
                world: worldName,
              });
              return;
            }
            if (pickupResult.reason === "inventory_unavailable") {
              sendActionRejected(socket, "world_item_drop_pickup", "Could not add that item to your server inventory.", {
                drop_id: update.drop_id,
                world: worldName,
              });
              return;
            }
            if (pickupResult.reason === "too_far") {
              logDropPickupTooFar(player, worldName, update.drop_id, pickupResult.drop, update);
              sendActionRejected(socket, "world_item_drop_pickup", "Too far away from that drop.", {
                drop_id: update.drop_id,
                world: worldName,
              });
              return;
            }
            logDropPickupNotAvailable(player, worldName, update.drop_id);
            sendActionRejected(socket, "world_item_drop_pickup", "That drop is not available.", {
              drop_id: update.drop_id,
              world: worldName,
            });
            return;
          }

          const pickedDrop = pickupResult.drop;
          const pickupState = pickupResult.playerState;
          const pickupUpdate = pickupResult.update;
          persistPlayerInventoryChange(player.account_username, pickupState);
          logWorldChange(socket, player, {
            source_type: "world_item_drop_pickup",
            source_id: pickupTransactionId,
            request_id: requestId,
            world: worldName,
            action: "drop_pickup",
            x: pickedDrop.x,
            y: pickedDrop.y,
            block_type: pickedDrop.item_type,
            details: {
              drop_id: pickedDrop.drop_id,
              item_category: pickedDrop.item_category,
              amount: pickedDrop.amount,
              request_id: requestId,
              remaining: pickupResult.remaining,
            },
          });
          logItemLedgerForState(socket, player, player.account_username, pickupState, pickedDrop.item_type, pickedDrop.item_category, pickedDrop.amount, "world_item_drop_pickup", pickupTransactionId, "drop_pickup", worldName, {
            drop_id: pickedDrop.drop_id,
          });
          const pickupInventoryDelta = buildInventoryDeltaClientPayloads([{
            item_type: pickedDrop.item_type,
            item_category: pickedDrop.item_category,
            delta: pickedDrop.amount,
          }], pickupState);

          sendInventoryTransactionResult(socket, InventoryContracts.buildDropPickupInventoryTransactionResult({
            ok: true,
            request_id: requestId || pickupTransactionId,
            server_action_id: pickupTransactionId,
            world: worldName,
            drop_id: pickedDrop.drop_id,
            item_type: pickedDrop.item_type,
            item_category: pickedDrop.item_category,
            amount: pickedDrop.amount,
            remaining: pickupResult.remaining,
            remaining_amount: pickupResult.remaining,
            requested_by: player.id,
            requested_by_name: cleanName(player.name),
            message: `Picked up ${pickedDrop.amount} ${pickedDrop.item_type}.`,
            username: player.account_username,
            inventory_delta: pickupInventoryDelta,
            inventory_deltas: pickupInventoryDelta,
            rewards: [InventoryContracts.buildInventoryRewardEntry({
              itemId: pickedDrop.item_type,
              itemCategory: pickedDrop.item_category,
              amount: pickedDrop.amount,
            })],
          }));

          queueWorldSave(worldName);
          sendWorldUpdateToRequesterAndWorld(socket, player, worldName, pickupUpdate, {
            username: player.account_username,
            player_data: pickupState,
          });
          debugActionPositionFlow("world_item_drop_pickup request end", player, {
            drop_id: update.drop_id,
            item_type: pickedDrop.item_type,
            amount: pickedDrop.amount,
            });
          return;

  }

  async function handlePlayerPosition(socket: any, player: any, data: PacketRecord, context: RouteContext): Promise<void> {

            if (!requireAuthenticated(socket, player, "move online")) return;
            if (!player.joined_world) return;
            playerNetworkStats.player_position_messages_received += 1;

            player.name = player.account_username || player.name;
            const position = sanitizePlayerPosition(data, player);
            if (!position) return;
            if (!requireSameWorld(socket, player, position.world, "move in that world")) return;
            if (!enforceStandardMovementForSocket(socket, player, "player_position") && usesTrustedMovementPosition(player)) {
              debugNetfoxAction("ignored legacy player_position in trusted movement mode", {
                player_id: String(player?.id || ""),
                username: cleanAccountName(player?.account_username || player?.name || ""),
                world: position.world,
                movement_mode: getTrustedMovementModeLabel(player),
              });
              touchLivePresence(socket, player);
              return;
            }
            const respawnTeleport = isValidRespawnTeleportPosition(player, position, data);
            if (!acceptPlayerMovement(socket, player, position, { respawnTeleport, data })) return;

            const previousEquipmentKey = getEquipmentSlotsComparisonKey(player.equipment_slots || {});
            const previousAnimationState = String(player.animation_state || "idle");
            player.x = position.x;
            player.y = position.y;
            player.facing = position.facing;
            player.animation_state = sanitizePlayerAnimationState(data.animation_state);
            player.velocity_x = sanitizePlayerVelocity(data.velocity_x);
            player.velocity_y = sanitizePlayerVelocity(data.velocity_y);
            player.on_floor = data.on_floor !== false;
            player.in_water = position.in_water === true;
            player.in_lava_fire = position.in_lava_fire === true;
            const damageFlash = sanitizePlayerDamageFlash(data);
            player.damage_flash_expires_at = damageFlash.active ? Date.now() + damageFlash.remaining_ms : 0;
            player.damage_flash_token = damageFlash.token;
            refreshPlayerFishingPresence(player, position.world);

            if (data.equipment_slots && typeof data.equipment_slots === "object" && !Array.isArray(data.equipment_slots)) {
              player.equipment_slots = sanitizeEquipmentSlots(data.equipment_slots, player.account_username);
            } else if (
              Object.prototype.hasOwnProperty.call(data, "equipped_tool")
              || Object.prototype.hasOwnProperty.call(data, "equipped_back")
              || Object.prototype.hasOwnProperty.call(data, "equipped_back_item")
              || Object.prototype.hasOwnProperty.call(data, "equipped_hat_item")
              || Object.prototype.hasOwnProperty.call(data, "equipped_hair_item")
              || Object.prototype.hasOwnProperty.call(data, "equipped_eyewear_item")
              || Object.prototype.hasOwnProperty.call(data, "equipped_shirt_item")
              || Object.prototype.hasOwnProperty.call(data, "equipped_pants_item")
              || Object.prototype.hasOwnProperty.call(data, "equipped_shoes_item")
              || Object.prototype.hasOwnProperty.call(data, "equipped_ride_item")
            ) {
              player.equipment_slots = sanitizeEquipmentSlots({
                hand: data.equipped_tool || "",
                back: data.equipped_back || "",
                hat: data.equipped_hat_item || "",
                hair: data.equipped_hair_item || "",
                eyewear: data.equipped_eyewear_item || "",
                shirt: data.equipped_shirt_item || "",
                pants: data.equipped_pants_item || "",
                shoes: data.equipped_shoes_item || "",
                ride: data.equipped_ride_item || "",
              }, player.account_username);
            }

            const nextEquipmentKey = getEquipmentSlotsComparisonKey(player.equipment_slots || {});
            const animationChanged = previousAnimationState !== String(player.animation_state || "idle");
            const equipmentChanged = previousEquipmentKey !== nextEquipmentKey;
            if (equipmentChanged) {
              console.log("[APPEARANCE][Server] received equipment change", {
                player: player.account_username,
                world: player.world,
                equipment_slots: player.equipment_slots,
              });
            }
            if (animationChanged) {
              console.log("[APPEARANCE][Server] received animation state", {
                player: player.account_username,
                world: player.world,
                animation_state: player.animation_state,
                facing: player.facing,
              });
            }

            const presencePayload = buildPublicPlayerPresencePayload("player_position", player, position.world);
            const nextPresenceSignature = getPlayerPresenceBroadcastSignature(presencePayload);
            const now = Date.now();
            const heartbeatIntervalMs = Number(getPlayerPositionHeartbeatIntervalMs(position.world));
            const isDuplicateSignature = nextPresenceSignature !== "" && player.last_player_position_broadcast_signature === nextPresenceSignature;
            const heartbeatExpired = now - Number(player.last_player_position_broadcast_heartbeat_at || 0) >= heartbeatIntervalMs;
            if (isDuplicateSignature && !heartbeatExpired) {
              playerNetworkStats.duplicated_player_position_heartbeats += 1;
              touchLivePresence(socket, player);
              return;
            }
            playerNetworkStats.accepted_player_position_messages += 1;
            player.last_player_position_broadcast_signature = nextPresenceSignature;
            player.last_player_position_broadcast_heartbeat_at = now;
            queuePlayerPositionBroadcast(player.world, presencePayload, context.playerId);
            if (equipmentChanged) {
              sendElectricalVisibilityRefresh(socket, player, position.world);
            }
            if (equipmentChanged || animationChanged) {
              console.log("[APPEARANCE][Server] broadcast appearance update", {
                player: player.account_username,
                world: player.world,
                animation_state: presencePayload.animation_state,
                equipment_slots: presencePayload.equipment_slots,
              });
            }
            touchLivePresence(socket, player);
            return;

  }

  return {
    handleWorldInteractionUpdate,
    handleWorldItemDropCreate,
    handleWorldItemDropUpdate,
    handleWorldItemDropPickup,
    handlePlayerPosition,
  };
}

module.exports = {
  createServerPhase8FinalRoutes,
};
