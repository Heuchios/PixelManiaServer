/// <reference path="../types/pixelmania-contracts.d.ts" />
"use strict";

type DropPickupInventoryTransactionResult = PixelMania.DropPickupInventoryTransactionResult;
type DropPickupWorldUpdatePayload = PixelMania.DropPickupWorldUpdatePayload;
type DeferredInventoryCommit = PixelMania.DeferredInventoryCommit;
type InventoryCommitFailure = PixelMania.InventoryCommitFailure;
type InventoryCommitOptions = PixelMania.InventoryCommitOptions;
type InventoryCommitSuccess = PixelMania.InventoryCommitSuccess;
type InventoryDeltaClientPayload = PixelMania.InventoryDeltaClientPayload;
type InventoryDeltaSource = PixelMania.InventoryDeltaSource;
type InventoryRewardEntry = PixelMania.InventoryRewardEntry;
type InventoryTransactionResultResponse = PixelMania.InventoryTransactionResultResponse;
type PostgresInventoryDeltaTransactionEntry = PixelMania.PostgresInventoryDeltaTransactionEntry;
type PostgresInventoryDeltaTransactionFailure = PixelMania.PostgresInventoryDeltaTransactionFailure;
type PostgresInventoryDeltaTransactionSuccess = PixelMania.PostgresInventoryDeltaTransactionSuccess;
type PostgresInventoryLedgerEntry = PixelMania.PostgresInventoryLedgerEntry;
type RuntimePlayerState = PixelMania.RuntimePlayerState;

interface InventoryDeltaClientPayloadInput {
  itemType: string;
  itemCategory: string;
  delta: number;
  stackLimit: number;
  afterCount?: number;
}

interface InventoryDeltaSourceInput {
  itemType: string;
  itemCategory: string;
  delta: number;
  expectedBeforeAmount?: number;
  stackLimit?: number;
}

interface InventoryCommitSuccessInput {
  state: RuntimePlayerState;
  postgresCommitted: boolean;
  deltas: InventoryDeltaSource[];
  equipmentChanged?: boolean;
}

interface InventoryCommitFailureInput {
  reason?: string;
  message: string;
}

interface DeferredInventoryCommitInput {
  username: string;
  beforeState: RuntimePlayerState;
  afterState: RuntimePlayerState;
  options: InventoryCommitOptions;
}

interface PostgresInventoryDeltaTransactionEntryInput {
  accountUsername: string;
  username?: string;
  email?: string;
  actorRole?: string;
  world: string;
  source: string;
  sourceType?: string;
  action: string;
  reason: string;
  requestId: string;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress: string;
  ip?: string;
  userAgent: string;
  sessionTokenHash: string;
  deviceInfo?: Record<string, unknown>;
  deltas: InventoryDeltaSource[];
  playerState?: RuntimePlayerState | Record<string, unknown>;
  worldState?: Record<string, unknown>;
  worldChanges?: Array<Record<string, unknown>>;
  allowStateRepair?: boolean;
  strictItemInstances?: boolean;
  at: string;
}

interface PostgresInventoryLedgerEntryInput {
  itemType: string;
  itemCategory: string;
  delta: number;
  beforeAmount: number;
  afterAmount: number;
  stackLimit: number;
}

interface PostgresInventoryDeltaTransactionSuccessInput {
  playerId?: string | null;
  worldId?: string | null;
  ledgerEntries: PostgresInventoryLedgerEntry[];
}

interface PostgresInventoryDeltaTransactionFailureInput {
  reason: string;
  message?: string;
  itemType?: string;
  itemCategory?: string;
  beforeAmount?: number;
  afterAmount?: number;
  delta?: number;
  stackLimit?: number;
}

interface InventoryRewardEntryInput {
  itemId: string;
  itemCategory: string;
  amount: number;
}

interface DropPickupInventoryTransactionResultInput {
  ok: true;
  request_id: string;
  server_action_id?: string;
  bulk_pickup?: boolean;
  world: string;
  drop_id: string;
  drop_ids?: string[];
  removed_drop_ids?: string[];
  updated_drops?: DropPickupWorldUpdatePayload[];
  pickup_results?: Array<Record<string, unknown>>;
  item_type?: string;
  item_category?: string;
  amount: number;
  remaining?: number;
  remaining_amount?: number;
  requested_by: string;
  requested_by_name: string;
  message: string;
  username: string;
  inventory_delta: InventoryDeltaClientPayload[];
  inventory_deltas: InventoryDeltaClientPayload[];
  rewards: InventoryRewardEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function buildInventoryDeltaSource(input: InventoryDeltaSourceInput): InventoryDeltaSource {
  const source: InventoryDeltaSource = {
    item_type: input.itemType,
    item_category: input.itemCategory,
    delta: input.delta,
  };
  if (Number.isFinite(Number(input.expectedBeforeAmount))) {
    source.expected_before_amount = Number(input.expectedBeforeAmount);
  }
  if (Number.isFinite(Number(input.stackLimit))) {
    source.stack_limit = Number(input.stackLimit);
  }
  return source;
}

function buildInventoryCommitSuccess(input: InventoryCommitSuccessInput): InventoryCommitSuccess {
  const result: InventoryCommitSuccess = {
    ok: true,
    state: input.state,
    postgres_committed: input.postgresCommitted,
    deltas: input.deltas,
  };
  if (typeof input.equipmentChanged === "boolean") {
    result.equipment_changed = input.equipmentChanged;
  }
  return result;
}

function buildInventoryCommitFailure(input: InventoryCommitFailureInput): InventoryCommitFailure {
  const result: InventoryCommitFailure = {
    ok: false,
    message: input.message,
  };
  if (input.reason) result.reason = input.reason;
  return result;
}

function buildDeferredInventoryCommit(input: DeferredInventoryCommitInput): DeferredInventoryCommit {
  return {
    username: input.username,
    beforeState: input.beforeState,
    afterState: input.afterState,
    options: isRecord(input.options) ? (input.options as InventoryCommitOptions) : {},
  };
}

function buildPostgresInventoryDeltaTransactionEntry(
  input: PostgresInventoryDeltaTransactionEntryInput
): PostgresInventoryDeltaTransactionEntry {
  const entry: PostgresInventoryDeltaTransactionEntry = {
    account_username: input.accountUsername,
    world: input.world,
    source: input.source,
    action: input.action,
    reason: input.reason,
    request_id: input.requestId,
    correlation_id: input.correlationId || "",
    metadata: isRecord(input.metadata) ? input.metadata : {},
    ip_address: input.ipAddress,
    user_agent: input.userAgent,
    session_token_hash: input.sessionTokenHash,
    device_info: isRecord(input.deviceInfo) ? input.deviceInfo : {},
    deltas: input.deltas,
    player_state: isRecord(input.playerState) ? input.playerState : {},
    world_state: isRecord(input.worldState) ? input.worldState : {},
    world_changes: Array.isArray(input.worldChanges) ? input.worldChanges : [],
    allow_state_repair: input.allowStateRepair === true,
    at: input.at,
  };

  if (input.username) entry.username = input.username;
  if (input.email) entry.email = input.email;
  if (input.actorRole) entry.actor_role = input.actorRole;
  if (input.sourceType) entry.source_type = input.sourceType;
  if (input.ip) entry.ip = input.ip;
  if (typeof input.strictItemInstances === "boolean") {
    entry.strict_item_instances = input.strictItemInstances;
  }

  return entry;
}

function buildPostgresInventoryLedgerEntry(input: PostgresInventoryLedgerEntryInput): PostgresInventoryLedgerEntry {
  return {
    item_type: input.itemType,
    item_category: input.itemCategory,
    delta: input.delta,
    before_amount: input.beforeAmount,
    after_amount: input.afterAmount,
    stack_limit: input.stackLimit,
  };
}

function buildPostgresInventoryDeltaTransactionSuccess(
  input: PostgresInventoryDeltaTransactionSuccessInput
): PostgresInventoryDeltaTransactionSuccess {
  const result: PostgresInventoryDeltaTransactionSuccess = {
    ok: true,
    ledger_entries: input.ledgerEntries,
  };
  if (Object.prototype.hasOwnProperty.call(input, "playerId")) result.player_id = input.playerId;
  if (Object.prototype.hasOwnProperty.call(input, "worldId")) result.world_id = input.worldId;
  return result;
}

function buildPostgresInventoryDeltaTransactionFailure(
  input: PostgresInventoryDeltaTransactionFailureInput
): PostgresInventoryDeltaTransactionFailure {
  const result: PostgresInventoryDeltaTransactionFailure = {
    ok: false,
    reason: input.reason,
  };
  if (Object.prototype.hasOwnProperty.call(input, "message")) result.message = input.message;
  if (Object.prototype.hasOwnProperty.call(input, "itemType")) result.item_type = input.itemType;
  if (Object.prototype.hasOwnProperty.call(input, "itemCategory")) result.item_category = input.itemCategory;
  if (Object.prototype.hasOwnProperty.call(input, "beforeAmount")) result.before_amount = input.beforeAmount;
  if (Object.prototype.hasOwnProperty.call(input, "afterAmount")) result.after_amount = input.afterAmount;
  if (Object.prototype.hasOwnProperty.call(input, "delta")) result.delta = input.delta;
  if (Object.prototype.hasOwnProperty.call(input, "stackLimit")) result.stack_limit = input.stackLimit;
  return result;
}

function buildInventoryDeltaClientPayload(input: InventoryDeltaClientPayloadInput): InventoryDeltaClientPayload {
  const payload: InventoryDeltaClientPayload = {
    item_type: input.itemType,
    item_category: input.itemCategory,
    delta: input.delta,
    stack_limit: input.stackLimit,
  };
  if (Number.isFinite(Number(input.afterCount))) {
    payload.after_count = Number(input.afterCount);
  }
  return payload;
}

function buildInventoryRewardEntry(input: InventoryRewardEntryInput): InventoryRewardEntry {
  return {
    item_id: input.itemId,
    item_category: input.itemCategory,
    amount: input.amount,
  };
}

function buildDropPickupInventoryTransactionResult(
  input: DropPickupInventoryTransactionResultInput
): DropPickupInventoryTransactionResult {
  const result: DropPickupInventoryTransactionResult = {
    ok: true,
    request_id: input.request_id,
    action: "drop_pickup",
    source_type: "world_item_drop_pickup",
    world: input.world,
    drop_id: input.drop_id,
    amount: input.amount,
    requested_by: input.requested_by,
    requested_by_name: input.requested_by_name,
    message: input.message,
    username: input.username,
    inventory_delta: input.inventory_delta,
    inventory_deltas: input.inventory_deltas,
    rewards: input.rewards,
    _server_inventory_update_applied: true,
    _apply_pickup_inventory: false,
  };

  if (input.server_action_id) result.server_action_id = input.server_action_id;
  if (input.bulk_pickup === true) result.bulk_pickup = true;
  if (input.drop_ids) result.drop_ids = input.drop_ids;
  if (input.removed_drop_ids) result.removed_drop_ids = input.removed_drop_ids;
  if (input.updated_drops) result.updated_drops = input.updated_drops;
  if (input.pickup_results) result.pickup_results = input.pickup_results;
  if (input.item_type) result.item_type = input.item_type;
  if (input.item_category) result.item_category = input.item_category;
  if (Number.isFinite(Number(input.remaining))) result.remaining = Number(input.remaining);
  if (Number.isFinite(Number(input.remaining_amount))) result.remaining_amount = Number(input.remaining_amount);

  return result;
}

function buildInventoryTransactionResultResponse(payload: unknown, username: string): InventoryTransactionResultResponse {
  const safePayload = isRecord(payload) ? payload : {};
  const response: InventoryTransactionResultResponse = {
    ...safePayload,
    type: "inventory_transaction_result",
    ok: Boolean(safePayload.ok),
    request_id: String(safePayload.request_id || ""),
    action: String(safePayload.action || ""),
    message: String(safePayload.message || ""),
    username,
    rewards: Array.isArray(safePayload.rewards) ? safePayload.rewards : [],
  };

  const playerData = safePayload.player_data;
  if (isRecord(playerData) && Object.keys(playerData).length > 0) {
    response.player_data = playerData;
  } else {
    delete response.player_data;
  }

  return response;
}

const InventoryContracts = {
  buildDeferredInventoryCommit,
  buildDropPickupInventoryTransactionResult,
  buildInventoryCommitFailure,
  buildInventoryCommitSuccess,
  buildInventoryDeltaClientPayload,
  buildInventoryDeltaSource,
  buildInventoryTransactionResultResponse,
  buildInventoryRewardEntry,
  buildPostgresInventoryDeltaTransactionEntry,
  buildPostgresInventoryDeltaTransactionFailure,
  buildPostgresInventoryDeltaTransactionSuccess,
  buildPostgresInventoryLedgerEntry,
};

export = InventoryContracts;
