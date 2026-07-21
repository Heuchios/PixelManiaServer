#!/usr/bin/env node
// @ts-check
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const InventoryContracts = require("../server_inventory_contracts");

const repoRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const deploySource = require("./release_deployment_test_helpers").readDeploymentCoverage(repoRoot);
const inventoryContractsSource = fs.readFileSync(path.join(repoRoot, "src", "server_inventory_contracts.ts"), "utf8");
const inventoryContractsBuildSource = fs.readFileSync(path.join(repoRoot, "scripts", "sync_inventory_contracts_build.js"), "utf8");
const inventoryContractsBuildConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, "tsconfig.inventory-contracts.json"), "utf8"));
const typeContracts = fs.readFileSync(path.join(repoRoot, "types", "pixelmania-contracts.d.ts"), "utf8");
const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
const tradeRoutesSource = fs.readFileSync(path.join(repoRoot, "src", "server_trade_routes.ts"), "utf8");
const postgresSource = fs.readFileSync(path.join(repoRoot, "postgres_store.js"), "utf8");

assert.match(typeContracts, /interface InventoryCommitOptions \{/);
for (const field of [
  "action",
  "reason",
  "source",
  "source_type",
  "world",
  "request_id",
  "correlation_id",
  "metadata",
  "world_state",
  "world_changes",
  "allow_state_repair",
  "allow_dev_json_fallback",
  "failure_message",
  "skip_inventory_lock",
  "inventory_lock_owner",
  "ip_address",
  "user_agent",
  "session_token_hash",
  "device_info",
]) {
  assert.match(typeContracts, new RegExp(`${field}\\?:`));
}
assert.match(serverSource, /@param \{PixelMania\.InventoryCommitOptions\} options/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.InventoryCommitResult>\}/);

for (const contract of [
  "InventorySpendCost",
  "DeferredInventoryCommit",
  "SpendServerInventoryCostOptions",
  "SpendServerInventoryCostSuccess",
  "SpendServerInventoryCostFailure",
  "SpendServerInventoryCostResult",
  "WorldInventoryValidationSuccess",
  "WorldInventoryValidationFailure",
  "WorldInventoryValidationResult",
  "WorldStateCommitSuccess",
  "WorldStateCommitFailure",
  "WorldStateCommitResult",
  "WorldStateCommitOptions",
  "CommitWorldStateWithBlockChangesOptions",
  "CommitWorldStateWithBlockChangesSuccess",
  "CommitWorldStateWithBlockChangesFailure",
  "CommitWorldStateWithBlockChangesResult",
  "PostgresSaveWorldStateWithWorldChangesSuccess",
  "PostgresSaveWorldStateWithWorldChangesFailure",
  "PostgresSaveWorldStateWithWorldChangesResult",
  "PostgresWorldChangeInsertSuccess",
  "PostgresWorldChangeInsertResult",
  "WorldDropPayloadInput",
  "NormalizedWorldDropPayload",
  "WorldDropRowInput",
  "RuntimeWorldDrop",
  "RuntimeWorldDropMap",
  "RuntimeWorldState",
  "ActiveWorldDropPayload",
  "RuntimeWorldDropCreateInput",
  "RuntimeWorldDropUpdateInput",
  "LoadActiveWorldDropsSuccess",
  "LoadActiveWorldDropsSkipped",
  "LoadActiveWorldDropsFailure",
  "LoadActiveWorldDropsResult",
  "RefreshWorldDropsFromPostgresSuccess",
  "RefreshWorldDropsFromPostgresSkipped",
  "RefreshWorldDropsFromPostgresFailure",
  "RefreshWorldDropsFromPostgresResult",
  "UpsertWorldDropOptions",
  "UpsertWorldDropSuccess",
  "UpsertWorldDropFailure",
  "UpsertWorldDropResult",
  "MirrorWorldDropsStateSuccess",
  "MirrorWorldDropsStateSkipped",
  "MirrorWorldDropsStateFailure",
  "MirrorWorldDropsStateResult",
  "TrackedWorldDropChangeDetails",
  "WorldChangeEntryBase",
  "WorldBlockChangeEntry",
  "WorldObjectChangeEntry",
  "TrackedWorldDropChangeEntry",
  "WorldChangeEntry",
  "TradeOfferItem",
  "TradeOfferSlot",
  "TradeOfferSlots",
  "TradeOfferParseResult",
  "TradeActionValidationSuccess",
  "TradeActionValidationFailure",
  "TradeActionValidationResult",
  "ActiveTradeState",
  "TradeParticipantRecord",
  "TradeInventoryValidationSuccess",
  "TradeInventoryValidationFailure",
  "TradeInventoryValidationResult",
  "WorldLockBlockEntry",
  "WorldLockState",
  "WorldLockKeyTradeCandidateSuccess",
  "WorldLockKeyTradeCandidateFailure",
  "WorldLockKeyTradeCandidateResult",
  "WorldLockKeyTradeTransfer",
  "TradeWorldLockKeyTransfersSuccess",
  "TradeWorldLockKeyTransfersFailure",
  "TradeWorldLockKeyTransfersResult",
  "ItemInstanceMovement",
  "WorldLockKeyOwnershipTransferEntry",
  "WorldLockKeyOwnershipTransferSuccess",
  "WorldLockKeyOwnershipTransferFailure",
  "WorldLockKeyOwnershipTransferResult",
  "WorldLockStatePayload",
  "OwnedWorldLockEntry",
  "VendListing",
  "VendLogEntry",
  "VendState",
  "VendClientState",
  "SafeSlot",
  "SafeState",
  "SafeClientState",
  "MailboxMessage",
  "MailboxState",
  "MailboxClientState",
  "BulletinBoardMessage",
  "BulletinBoardState",
  "BulletinBoardClientState",
  "WorldInteractionUpdateInput",
  "CheckpointActivatePayload",
  "ToggleWorldInteractionState",
  "ToggleWorldInteractionPayload",
  "AdminTwoFactorResult",
  "DeveloperSecurityRequirementSuccess",
  "DeveloperSecurityRequirementFailure",
  "DeveloperSecurityRequirementResult",
  "AdminCommandCooldownResult",
  "AdminActionTarget",
  "DeveloperInventoryCommand",
  "PunishmentDurationParseResult",
  "PublicPunishmentPayload",
  "ParsedPunishmentCommand",
  "ParsedItemInstanceAdminCommand",
  "NetfoxMovementRoute",
  "NetfoxMovementRouteStats",
  "NetfoxTicketIdentity",
  "NetfoxSpawnTicketRoute",
  "NetfoxSpawnTicketParseSuccess",
  "NetfoxSpawnTicketParseFailure",
  "NetfoxSpawnTicketParseResult",
  "NetfoxSpawnTicketVerifySuccess",
  "NetfoxSpawnTicketVerifyResult",
  "WorldRouteClaimResult",
  "WorldRouteActionResult",
  "WorldDensityBatchProfile",
  "ClientMovementGuidance",
  "WorldAdmissionReservation",
  "WorldPopulationUpdatePayload",
  "DropPickupWorldResolveInput",
  "DropPickupUpdateInput",
  "DropPickupWorldLookupResult",
  "DropPickupWorldResultInput",
  "BulkDropPickupResultEntry",
  "BulkDropPickupWorldUpdateEntry",
  "BulkDropPickupWorldResultPayload",
]) {
  assert.match(typeContracts, new RegExp(`(?:interface|type) ${contract}\\b`));
}
for (const field of [
  "item_id",
  "item_category",
  "amount",
  "defer_commit",
  "deferred_inventory_commit",
  "inventoryDeltas",
  "rollbackWorldState",
  "worldChanges",
  "postCommitLogs",
  "postgres_committed",
  "serialized",
  "queued",
  "block_type_before",
  "block_type_after",
  "old_data",
  "new_data",
  "object_type",
  "object_id",
  "source_block",
  "stack_grid_x",
  "stack_grid_y",
  "pickup_delay",
  "mirrored_from_world_state",
  "active_drop_count",
  "skipped",
  "is_seed",
  "drop_count",
  "publicDropId",
  "drop_ids",
  "removed_drop_ids",
  "pickup_results",
  "_server_inventory_update_applied",
  "_apply_pickup_inventory",
  "slotIndex",
  "offersA",
  "offersB",
  "requester_id",
  "target_id",
  "lock_block",
  "lock_before",
  "applied",
  "listing_id",
  "amount_per_sale",
  "price_wls",
  "pending_wls",
  "max_slots",
  "can_manage",
  "trade_key_holder",
  "lock_grid_x",
  "lock_grid_y",
  "world_name",
  "source_label",
  "messages",
  "capacity",
  "can_empty",
  "can_clear",
  "active",
  "enabled",
  "retry_ms",
  "target_type",
  "targetUsername",
  "punishment_type",
  "durationMinutes",
  "itemInstanceId",
  "max_clients",
  "server_instance_id",
  "registered_routes",
  "ticket_expires_at_ms",
  "route_source",
  "peer_id",
  "position_heartbeat_interval_ms",
  "position_batch_max_items",
  "network_movement_guidance",
  "redis_reserved",
  "local_reserved",
]) {
  assert.match(typeContracts, new RegExp(`${field}\\??:`));
}
assert.match(typeContracts, /interface BulkDropPickupWorldResultPayload[\s\S]*?_server_inventory_update_applied: true;[\s\S]*?_apply_pickup_inventory: false;/);
assert.match(typeContracts, /interface WorldLockState[\s\S]*?trade_key_holder\?: string;[\s\S]*?trade_key_public_item_instance_id\?: string;/);
assert.match(typeContracts, /reason: "missing_world" \| "invalid_drop" \| string/);
assert.match(typeContracts, /reason: "no_world_drop_rows" \| string/);
assert.match(serverSource, /@param \{PixelMania\.InventorySpendCost \| null \| undefined\} cost/);
assert.match(serverSource, /@param \{PixelMania\.SpendServerInventoryCostOptions\} options/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.SpendServerInventoryCostResult>\}/);
for (const functionName of [
  "prepareSafeBreakInventoryReturn",
  "prepareDisplayBreakInventoryReturn",
  "prepareWaterBucketScoopInventoryReturn",
  "prepareVendBreakInventoryReturn",
  "validateBlockUpdateAgainstServerState",
  "validateElectricalLayerUpdateAgainstServerState",
]) {
  const pattern = new RegExp(`@returns \\{Promise<PixelMania\\.WorldInventoryValidationResult>\\}[\\s\\S]*?async function ${functionName}\\b`);
  assert.match(serverSource, pattern);
}
for (const functionName of [
  "persistAuthoritativeWorldState",
  "commitWorldEventStateOnly",
]) {
  const pattern = new RegExp(`@returns \\{Promise<PixelMania\\.WorldStateCommitResult>\\}[\\s\\S]*?async function ${functionName}\\b`);
  assert.match(serverSource, pattern);
}
assert.match(serverSource, /@param \{PixelMania\.CommitWorldStateWithBlockChangesOptions\} options[\s\S]*?async function commitWorldStateWithBlockChanges\b/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.CommitWorldStateWithBlockChangesResult>\}[\s\S]*?async function commitWorldStateWithBlockChanges\b/);
assert.match(postgresSource, /@param \{PixelMania\.WorldChangeEntry\[\]\} changes[\s\S]*?async saveWorldStateWithWorldChanges\b/);
assert.match(postgresSource, /@returns \{Promise<PixelMania\.PostgresSaveWorldStateWithWorldChangesResult>\}[\s\S]*?async saveWorldStateWithWorldChanges\b/);
for (const functionName of [
  "insertWorldBlockChange",
  "insertWorldObjectChange",
  "recordWorldChangeEntry",
]) {
  assert.match(postgresSource, new RegExp(`@returns \\{Promise<PixelMania\\.PostgresWorldChangeInsertResult>\\}[\\s\\S]*?async ${functionName}\\b`));
}
assert.match(postgresSource, /@returns \{Promise<void>\}[\s\S]*?async recordWorldChangeAndTrackedDrops\b/);
assert.match(postgresSource, /@param \{PixelMania\.TrackedWorldDropChangeEntry \| PixelMania\.WorldChangeEntry \| Record<string, unknown>\} change[\s\S]*?async recordWorldChangeAndTrackedDrops\b/);
assert.match(postgresSource, /@type \{PixelMania\.TrackedWorldDropChangeDetails\}[\s\S]*?const changeDetails = toObject\(change\?\.details\)/);
assert.match(postgresSource, /@param \{PixelMania\.TrackedWorldDropChangeEntry \| PixelMania\.WorldChangeEntry \| Record<string, unknown>\} change[\s\S]*?shouldCreateTrackedWorldDropItemInstancesForChange\b/);
assert.match(postgresSource, /@returns \{PixelMania\.NormalizedWorldDropPayload \| null\}[\s\S]*?function normalizeWorldDropPayload\b/);
assert.match(postgresSource, /@param \{PixelMania\.WorldDropPayloadInput \| Record<string, unknown>\} drop[\s\S]*?async upsertWorldDropRow\b/);
assert.match(postgresSource, /@param \{PixelMania\.UpsertWorldDropOptions \| Record<string, unknown>\} options[\s\S]*?async upsertWorldDropRow\b/);
assert.match(postgresSource, /@returns \{Promise<PixelMania\.UpsertWorldDropResult>\}[\s\S]*?async upsertWorldDropRow\b/);
assert.match(postgresSource, /@returns \{Promise<PixelMania\.MirrorWorldDropsStateResult>\}[\s\S]*?async mirrorWorldDropsState\b/);
assert.match(postgresSource, /@returns \{PixelMania\.ActiveWorldDropPayload\}[\s\S]*?function worldDropRowToPayload\b/);
assert.match(postgresSource, /@returns \{Promise<PixelMania\.LoadActiveWorldDropsResult>\}[\s\S]*?async loadActiveWorldDrops\b/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.RefreshWorldDropsFromPostgresResult>\}[\s\S]*?async function refreshWorldDropsFromPostgres\b/);
assert.match(serverSource, /@param \{PixelMania\.RuntimeWorldDropMap\} target[\s\S]*?function loadDropsIntoMap\b/);
assert.match(serverSource, /@returns \{void\}[\s\S]*?function loadDropsIntoMap\b/);
assert.match(serverSource, /@param \{PixelMania\.RuntimeWorldDropCreateInput\} update[\s\S]*?function applyDropCreateToWorldState\b/);
assert.match(serverSource, /@returns \{void\}[\s\S]*?function applyDropCreateToWorldState\b/);
assert.match(serverSource, /@param \{PixelMania\.RuntimeWorldDropUpdateInput\} update[\s\S]*?function applyDropUpdateToWorldState\b/);
assert.match(serverSource, /@returns \{void\}[\s\S]*?function applyDropUpdateToWorldState\b/);
assert.match(serverSource, /@returns \{PixelMania\.SanitizedDropCreate \| null\}[\s\S]*?function createServerDrop\b/);
assert.match(serverSource, /@returns \{PixelMania\.SanitizedDropCreate \| null\}[\s\S]*?function sanitizeDropCreate\b/);
assert.match(serverSource, /@returns \{PixelMania\.SanitizedDropUpdate \| null\}[\s\S]*?function sanitizeDropUpdate\b/);
assert.match(serverSource, /@returns \{PixelMania\.SanitizedDropPickup \| null\}[\s\S]*?function sanitizeDropPickup\b/);
assert.match(serverSource, /@returns \{PixelMania\.SanitizedBulkDropPickup \| null\}[\s\S]*?function sanitizeBulkDropPickup\b/);
assert.match(serverSource, /@param \{PixelMania\.BulkDropPickupResultEntry\[\]\} pickupResults[\s\S]*?function makeBulkDropPickupWorldResultPayload\b/);
assert.match(serverSource, /@param \{PixelMania\.BulkDropPickupWorldUpdateEntry\[\]\} worldUpdates[\s\S]*?function makeBulkDropPickupWorldResultPayload\b/);
assert.match(serverSource, /@returns \{PixelMania\.BulkDropPickupWorldResultPayload\}[\s\S]*?function makeBulkDropPickupWorldResultPayload\b/);
assert.match(serverSource, /@returns \{void\}[\s\S]*?function sendBulkDropPickupWorldResult\b/);
assert.match(serverSource, /@param \{PixelMania\.SanitizedBulkDropPickup\} bulkUpdate[\s\S]*?function handleLegacyBulkDropPickup\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldName\}[\s\S]*?function resolveDropPickupWorldName\b/);
assert.match(serverSource, /@returns \{PixelMania\.LegacyDropPickupResult\}[\s\S]*?function applyDropPickupToWorldState\b/);
assert.match(serverSource, /@returns \{PixelMania\.PreparedDropPickupResult\}[\s\S]*?function prepareDropPickup\b/);
assert.match(serverSource, /@param \{PixelMania\.PreparedDropPickupPlan \| null \| undefined\} pickupPlan[\s\S]*?function applyDropPickupWorldState\b/);
assert.match(serverSource, /@returns \{PixelMania\.DropPickupWorldApplyResult\}[\s\S]*?function applyDropPickupWorldState\b/);
assert.match(serverSource, /@param \{PixelMania\.PreparedDropPickupPlan \| null\} pickupPlan[\s\S]*?function removeUnavailableDropFromWorldState\b/);
assert.match(serverSource, /@returns \{PixelMania\.DropPickupWorldApplyResult\}[\s\S]*?function removeUnavailableDropFromWorldState\b/);
assert.match(serverSource, /@returns \{PixelMania\.DropPickupWorldLookupResult\}[\s\S]*?function findDropForPickup\b/);
assert.match(tradeRoutesSource, /function sanitizeTradeOfferItem\(data: PacketRecord\): PacketRecord \| null/);
assert.match(tradeRoutesSource, /function getTradeOfferTotals\(slots: PacketRecord\[\],[\s\S]*?\): PacketRecord\[\]/);
assert.match(tradeRoutesSource, /function canOfferTradeItems\(username: string, slots: PacketRecord\[\],[\s\S]*?\): PacketRecord/);
assert.match(serverSource, /@returns \{PixelMania\.WorldLockKeyTradeCandidateResult\}[\s\S]*?function validateWorldLockKeyTradeCandidate\b/);
assert.match(serverSource, /@returns \{PixelMania\.TradeWorldLockKeyTransfersResult\}[\s\S]*?function validateTradeWorldLockKeyTransfers\b/);
assert.match(serverSource, /@returns \{PixelMania\.ItemInstanceMovement \| null\}[\s\S]*?function getWorldLockKeyMovementForTransfer\b/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.WorldLockKeyOwnershipTransferResult>\}[\s\S]*?async function applyWorldLockKeyTradeOwnershipTransfers\b/);
assert.match(serverSource, /@returns \{PixelMania\.TradeInventoryValidationResult\}[\s\S]*?function validateFullTradeInventory\b/);
assert.match(serverSource, /@returns \{Promise<void>\}[\s\S]*?async function executeTrade\b/);
assert.match(serverSource, /@returns \{PixelMania\.VendState\}[\s\S]*?function makeEmptyVendState\b/);
assert.match(serverSource, /@returns \{PixelMania\.VendListing \| null\}[\s\S]*?function sanitizeVendListing\b/);
assert.match(serverSource, /@returns \{PixelMania\.VendLogEntry \| null\}[\s\S]*?function sanitizeVendLogEntry\b/);
assert.match(serverSource, /@returns \{PixelMania\.VendState\}[\s\S]*?function sanitizeVendState\b/);
assert.match(serverSource, /@returns \{PixelMania\.VendClientState\}[\s\S]*?function serializeVendStateForClient\b/);
assert.match(serverSource, /@returns \{PixelMania\.VendState\}[\s\S]*?function getVendStateAt\b/);
assert.match(serverSource, /@returns \{PixelMania\.VendState\}[\s\S]*?function setVendStateAt\b/);
assert.match(serverSource, /@returns \{PixelMania\.SafeState\}[\s\S]*?function makeEmptySafeState\b/);
assert.match(serverSource, /@returns \{PixelMania\.SafeSlot \| null\}[\s\S]*?function sanitizeSafeSlot\b/);
assert.match(serverSource, /@returns \{PixelMania\.SafeState\}[\s\S]*?function sanitizeSafeState\b/);
assert.match(serverSource, /@returns \{PixelMania\.SafeClientState\}[\s\S]*?function serializeSafeStateForClient\b/);
assert.match(serverSource, /@returns \{PixelMania\.SafeState\}[\s\S]*?function getSafeStateAt\b/);
assert.match(serverSource, /@returns \{PixelMania\.SafeState\}[\s\S]*?function setSafeStateAt\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldLockBlockEntry \| null\}[\s\S]*?function getWorldLockBlockEntry\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldLockState\}[\s\S]*?function getEffectiveWorldLockStateInState\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldLockState\}[\s\S]*?function makeWorldLockStateForPlacement\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldLockStatePayload\}[\s\S]*?function makeWorldLockStatePayload\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldLockStatePayload \| null\}[\s\S]*?function applyWorldLockStateForBlockUpdate\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldLockState\}[\s\S]*?function sanitizeWorldLockState\b/);
assert.match(serverSource, /@returns \{PixelMania\.OwnedWorldLockEntry \| null\}[\s\S]*?function makeOwnedWorldLockEntry\b/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.OwnedWorldLockEntry\[\]>\}[\s\S]*?async function listOwnedWorldLocksForAccount\b/);
assert.match(serverSource, /@returns \{PixelMania\.MailboxState\}[\s\S]*?function makeEmptyMailboxState\b/);
assert.match(serverSource, /@returns \{PixelMania\.MailboxMessage \| null\}[\s\S]*?function sanitizeMailboxMessage\b/);
assert.match(serverSource, /@returns \{PixelMania\.MailboxState\}[\s\S]*?function sanitizeMailboxState\b/);
assert.match(serverSource, /@returns \{PixelMania\.MailboxClientState\}[\s\S]*?function serializeMailboxStateForClient\b/);
assert.match(serverSource, /@returns \{boolean\}[\s\S]*?function prepareMailboxStateUpdate\b/);
assert.match(serverSource, /@returns \{PixelMania\.BulletinBoardState\}[\s\S]*?function makeEmptyBulletinBoardState\b/);
assert.match(serverSource, /@returns \{PixelMania\.BulletinBoardMessage \| null\}[\s\S]*?function sanitizeBulletinBoardMessage\b/);
assert.match(serverSource, /@returns \{PixelMania\.BulletinBoardState\}[\s\S]*?function sanitizeBulletinBoardState\b/);
assert.match(serverSource, /@returns \{PixelMania\.BulletinBoardClientState\}[\s\S]*?function serializeBulletinBoardStateForClient\b/);
assert.match(serverSource, /@returns \{boolean\}[\s\S]*?function prepareBulletinBoardStateUpdate\b/);
assert.match(serverSource, /@returns \{PixelMania\.CheckpointActivatePayload\}[\s\S]*?function makeCheckpointActivatePayload\b/);
assert.match(serverSource, /@returns \{Promise<boolean>\}[\s\S]*?async function handleCheckpointActivateUpdate\b/);
assert.match(serverSource, /@returns \{PixelMania\.ToggleWorldInteractionPayload\}[\s\S]*?function makeAntiPunchStatePayload\b/);
assert.match(serverSource, /@returns \{PixelMania\.ToggleWorldInteractionState\}[\s\S]*?function sanitizeAntiPunchState\b/);
assert.match(serverSource, /@returns \{PixelMania\.ToggleWorldInteractionPayload\}[\s\S]*?function makeAntiTalkStatePayload\b/);
assert.match(serverSource, /@returns \{PixelMania\.ToggleWorldInteractionState\}[\s\S]*?function sanitizeAntiTalkState\b/);
assert.match(serverSource, /@returns \{PixelMania\.ToggleWorldInteractionPayload\}[\s\S]*?function makeAntiGravityStatePayload\b/);
assert.match(serverSource, /@returns \{PixelMania\.ToggleWorldInteractionState\}[\s\S]*?function sanitizeAntiGravityState\b/);
assert.match(serverSource, /@returns \{PixelMania\.AdminTwoFactorResult\}[\s\S]*?function verifyAdminTwoFactorCode\b/);
assert.match(serverSource, /@returns \{PixelMania\.DeveloperSecurityRequirementResult\}[\s\S]*?function getDeveloperSecurityRequirement\b/);
assert.match(serverSource, /@returns \{PixelMania\.AdminCommandCooldownResult\}[\s\S]*?function consumeAdminCommandCooldown\b/);
assert.match(serverSource, /@returns \{PixelMania\.PunishmentDurationParseResult\}[\s\S]*?function parsePunishmentDurationToken\b/);
assert.match(serverSource, /@returns \{PixelMania\.PublicPunishmentPayload\}[\s\S]*?function publicPunishmentPayload\b/);
assert.match(serverSource, /@returns \{PixelMania\.DeveloperInventoryCommand \| null\}[\s\S]*?function parseGiveCommand\b/);
assert.match(serverSource, /@returns \{PixelMania\.DeveloperInventoryCommand \| null\}[\s\S]*?function parseRemoveCommand\b/);
assert.match(serverSource, /@returns \{PixelMania\.AdminActionTarget\}[\s\S]*?function inferAdminActionTarget\b/);
assert.match(serverSource, /@returns \{PixelMania\.ParsedPunishmentCommand \| null\}[\s\S]*?function parsePunishmentCommand\b/);
assert.match(serverSource, /@returns \{PixelMania\.ParsedItemInstanceAdminCommand \| null\}[\s\S]*?function parseItemInstanceAdminCommand\b/);
assert.match(serverSource, /@returns \{PixelMania\.NetfoxSpawnTicketParseResult\}[\s\S]*?function parseNetfoxSpawnTicket\b/);
assert.match(serverSource, /@returns \{PixelMania\.NetfoxTicketIdentity\}[\s\S]*?function getNetfoxTicketIdentityFromPlayer\b/);
assert.match(serverSource, /@returns \{PixelMania\.NetfoxMovementRoute \| null\}[\s\S]*?function normalizeNetfoxMovementRouteForBackend\b/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.NetfoxMovementRoute>\}[\s\S]*?async function registerNetfoxMovementRoute\b/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.NetfoxMovementRoute \| null>\}[\s\S]*?async function getNetfoxMovementRouteForWorld\b/);
assert.match(serverSource, /@returns \{PixelMania\.NetfoxMovementRouteStats\}[\s\S]*?function getNetfoxMovementRouteStats\b/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.NetfoxSpawnTicketRoute>\}[\s\S]*?async function buildNetfoxSpawnTicketPayload\b/);
assert.match(serverSource, /@returns \{PixelMania\.NetfoxSpawnTicketVerifyResult\}[\s\S]*?function verifyNetfoxSpawnTicketPayload\b/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.WorldRouteClaimResult>\}[\s\S]*?async function claimWorldRouteForCurrentInstance\b/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.WorldRouteActionResult>\}[\s\S]*?async function ensureWorldRouteForAction\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldDensityBatchProfile\}[\s\S]*?function makeWorldDensityBatchProfile\b/);
assert.match(serverSource, /@returns \{PixelMania\.ClientMovementGuidance\}[\s\S]*?function buildClientMovementGuidance\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldAdmissionReservation\}[\s\S]*?function reserveLocalWorldAdmission\b/);
assert.match(serverSource, /@returns \{Promise<PixelMania\.WorldAdmissionReservation>\}[\s\S]*?async function reserveWorldAdmission\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldPopulationUpdatePayload\}[\s\S]*?function buildWorldPopulationUpdatePayload\b/);
assert.match(serverSource, /@returns \{PixelMania\.WorldObjectChangeEntry\}[\s\S]*?function buildWorldObjectChangeEntry\b/);
assert.match(serverSource, /@param \{PixelMania\.WorldChangeEntry\[\]\} changes[\s\S]*?async function commitWorldStateWithBlockChanges\b/);
assert.match(serverSource, /@param \{PixelMania\.WorldChangeEntry \| Record<string, unknown>\} entry[\s\S]*?function logWorldChange\b/);

const sourceDelta = InventoryContracts.buildInventoryDeltaSource({
  itemType: "dirt",
  itemCategory: "block",
  delta: -2,
  expectedBeforeAmount: 9,
  stackLimit: 200,
});

assert.deepEqual(sourceDelta, {
  item_type: "dirt",
  item_category: "block",
  delta: -2,
  expected_before_amount: 9,
  stack_limit: 200,
});

assert.deepEqual(InventoryContracts.buildInventoryCommitSuccess({
  state: { inventory: { dirt: 7 } },
  postgresCommitted: true,
  deltas: [sourceDelta],
  equipmentChanged: false,
}), {
  ok: true,
  state: { inventory: { dirt: 7 } },
  postgres_committed: true,
  deltas: [sourceDelta],
  equipment_changed: false,
});

assert.deepEqual(InventoryContracts.buildInventoryCommitFailure({
  reason: "inventory_locked",
  message: "Your inventory is busy. Try again.",
}), {
  ok: false,
  reason: "inventory_locked",
  message: "Your inventory is busy. Try again.",
});

const deferredCommit = InventoryContracts.buildDeferredInventoryCommit({
  username: "hasan",
  beforeState: { inventory: { dirt: 9 } },
  afterState: { inventory: { dirt: 7 } },
  options: {
    source: "world_block_place",
    action: "world_block_place",
    reason: "placement_cost",
    request_id: "place-1",
    world: "START",
    allow_dev_json_fallback: true,
    metadata: { x: 10, y: 12 },
    failure_message: "Server inventory changed. Try again.",
  },
});

assert.deepEqual(deferredCommit, {
  username: "hasan",
  beforeState: { inventory: { dirt: 9 } },
  afterState: { inventory: { dirt: 7 } },
  options: {
    source: "world_block_place",
    action: "world_block_place",
    reason: "placement_cost",
    request_id: "place-1",
    world: "START",
    allow_dev_json_fallback: true,
    metadata: { x: 10, y: 12 },
    failure_message: "Server inventory changed. Try again.",
  },
});

assert.deepEqual(InventoryContracts.buildPostgresInventoryDeltaTransactionEntry({
  accountUsername: "hasan",
  world: "START",
  source: "shop_buy",
  action: "buy",
  reason: "buy",
  requestId: "request-1",
  correlationId: "correlation-1",
  metadata: { shop_id: "main" },
  ipAddress: "127.0.0.1",
  userAgent: "PixelManiaClient",
  sessionTokenHash: "session-hash",
  deviceInfo: { platform: "desktop" },
  deltas: [sourceDelta],
  playerState: { inventory: { dirt: 7 } },
  worldState: { world_name: "START" },
  worldChanges: [{ action: "shop_buy" }],
  allowStateRepair: true,
  strictItemInstances: false,
  at: "2026-07-15T00:00:00.000Z",
}), {
  account_username: "hasan",
  world: "START",
  source: "shop_buy",
  action: "buy",
  reason: "buy",
  request_id: "request-1",
  correlation_id: "correlation-1",
  metadata: { shop_id: "main" },
  ip_address: "127.0.0.1",
  user_agent: "PixelManiaClient",
  session_token_hash: "session-hash",
  device_info: { platform: "desktop" },
  deltas: [sourceDelta],
  player_state: { inventory: { dirt: 7 } },
  world_state: { world_name: "START" },
  world_changes: [{ action: "shop_buy" }],
  allow_state_repair: true,
  strict_item_instances: false,
  at: "2026-07-15T00:00:00.000Z",
});

const postgresLedgerEntry = InventoryContracts.buildPostgresInventoryLedgerEntry({
  itemType: "gem",
  itemCategory: "currency",
  delta: 15,
  beforeAmount: 20,
  afterAmount: 35,
  stackLimit: 100000000000,
});

assert.deepEqual(postgresLedgerEntry, {
  item_type: "gem",
  item_category: "currency",
  delta: 15,
  before_amount: 20,
  after_amount: 35,
  stack_limit: 100000000000,
});

assert.deepEqual(InventoryContracts.buildPostgresInventoryDeltaTransactionSuccess({
  playerId: "player-1",
  worldId: "world-1",
  ledgerEntries: [postgresLedgerEntry],
}), {
  ok: true,
  player_id: "player-1",
  world_id: "world-1",
  ledger_entries: [postgresLedgerEntry],
});

assert.deepEqual(InventoryContracts.buildPostgresInventoryDeltaTransactionFailure({
  reason: "insufficient_inventory",
  itemType: "dirt",
  itemCategory: "block",
  beforeAmount: 1,
  delta: -2,
}), {
  ok: false,
  reason: "insufficient_inventory",
  item_type: "dirt",
  item_category: "block",
  before_amount: 1,
  delta: -2,
});

const delta = InventoryContracts.buildInventoryDeltaClientPayload({
  itemType: "dirt",
  itemCategory: "block",
  delta: 3,
  stackLimit: 200,
  afterCount: 7,
});

assert.deepEqual(delta, {
  item_type: "dirt",
  item_category: "block",
  delta: 3,
  stack_limit: 200,
  after_count: 7,
});

const reward = InventoryContracts.buildInventoryRewardEntry({
  itemId: "dirt",
  itemCategory: "block",
  amount: 3,
});

assert.deepEqual(reward, {
  item_id: "dirt",
  item_category: "block",
  amount: 3,
});

/** @type {any} */
const pickupResult = InventoryContracts.buildDropPickupInventoryTransactionResult({
  ok: true,
  request_id: "request-1",
  server_action_id: "pickup-1",
  world: "START",
  drop_id: "drop-1",
  item_type: "dirt",
  item_category: "block",
  amount: 3,
  remaining: 0,
  remaining_amount: 0,
  requested_by: "player-1",
  requested_by_name: "Hasan",
  message: "Picked up 3 dirt.",
  username: "hasan",
  inventory_delta: [delta],
  inventory_deltas: [delta],
  rewards: [reward],
});

assert.equal(pickupResult.type, undefined);
assert.equal(pickupResult.action, "drop_pickup");
assert.equal(pickupResult.source_type, "world_item_drop_pickup");
assert.equal(pickupResult._server_inventory_update_applied, true);
assert.equal(pickupResult._apply_pickup_inventory, false);
assert.deepEqual(pickupResult.inventory_delta, [delta]);
assert.deepEqual(pickupResult.inventory_deltas, [delta]);
assert.deepEqual(pickupResult.rewards, [reward]);

/** @type {any} */
const bulkResult = InventoryContracts.buildDropPickupInventoryTransactionResult({
  ok: true,
  request_id: "bulk-1",
  bulk_pickup: true,
  world: "START",
  drop_id: "drop-1",
  drop_ids: ["drop-1", "drop-2"],
  removed_drop_ids: ["drop-1"],
  updated_drops: [{
    type: "world_item_drop_update",
    world: "START",
    drop_id: "drop-2",
    item_type: "dirt",
    item_category: "block",
    amount: 1,
    remaining: 1,
    requested_by: "player-1",
    requested_by_name: "Hasan",
  }],
  pickup_results: [{ ok: true, drop_id: "drop-1" }],
  amount: 4,
  requested_by: "player-1",
  requested_by_name: "Hasan",
  message: "Picked up 4 items.",
  username: "hasan",
  inventory_delta: [delta],
  inventory_deltas: [delta],
  rewards: [reward],
});

assert.equal(bulkResult.bulk_pickup, true);
assert.deepEqual(bulkResult.drop_ids, ["drop-1", "drop-2"]);
assert.deepEqual(bulkResult.removed_drop_ids, ["drop-1"]);
assert.equal(bulkResult.updated_drops?.[0]?.type, "world_item_drop_update");

const response = InventoryContracts.buildInventoryTransactionResultResponse({
  ok: 1,
  request_id: 123,
  action: "drop_pickup",
  message: "Picked up 3 dirt.",
  username: "ignored-before-cleaning",
  rewards: [reward],
  player_data: { inventory: { dirt: 7 } },
  inventory_delta: [delta],
}, "hasan");

assert.equal(response.type, "inventory_transaction_result");
assert.equal(response.ok, true);
assert.equal(response.request_id, "123");
assert.equal(response.action, "drop_pickup");
assert.equal(response.message, "Picked up 3 dirt.");
assert.equal(response.username, "hasan");
assert.deepEqual(response.rewards, [reward]);
assert.deepEqual(response.player_data, { inventory: { dirt: 7 } });
assert.deepEqual(response.inventory_delta, [delta]);

const emptyPlayerDataResponse = InventoryContracts.buildInventoryTransactionResultResponse({
  ok: false,
  request_id: "",
  action: "drop_pickup",
  message: "Nope.",
  rewards: "not-an-array",
  player_data: {},
}, "hasan");

assert.equal(emptyPlayerDataResponse.ok, false);
assert.deepEqual(emptyPlayerDataResponse.rewards, []);
assert.equal(Object.prototype.hasOwnProperty.call(emptyPlayerDataResponse, "player_data"), false);

assert.equal(
  packageJson.scripts["build:inventory-contracts"],
  "tsc --project tsconfig.inventory-contracts.json && node scripts/sync_inventory_contracts_build.js"
);
assert.equal(
  packageJson.scripts["check:inventory-contracts"],
  "npm run build:inventory-contracts && node scripts/check_inventory_contracts.js"
);
assert.match(packageJson.scripts["check:typescript"], /npm run check:inventory-contracts/);
assert.match(deploySource, /npm run build:inventory-contracts/);
assert.match(deploySource, /src\/server_inventory_contracts\.ts/);
assert.match(deploySource, /tsconfig\.inventory-contracts\.json/);
assert.match(deploySource, /sync_inventory_contracts_build\.js/);
assert.match(inventoryContractsSource, /type InventoryCommitSuccess = PixelMania\.InventoryCommitSuccess/);
assert.match(inventoryContractsSource, /export = InventoryContracts/);
assert.deepEqual(inventoryContractsBuildConfig.include, ["src/server_inventory_contracts.ts"]);
assert.match(inventoryContractsBuildSource, /Generated from src\/server_inventory_contracts\.ts/);

console.log("[inventory-contracts] success");
