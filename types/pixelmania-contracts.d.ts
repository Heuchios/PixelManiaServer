declare namespace PixelMania {
  type AccountId = string;
  type Direction = "left" | "right" | "up" | "down";
  type ItemId = string;
  type PlayerId = string;
  type ProfileId = string;
  type RequestId = string;
  type TileCoord = number;
  type WorldName = string;
  type WorldBlockAction = "place" | "break" | "hit";
  type WorldBlockLayer = "foreground" | "background";

  interface TilePosition {
    x: TileCoord;
    y: TileCoord;
  }

  interface ActorPosition extends TilePosition {
    world?: WorldName;
    facing?: Direction | string;
  }

  interface InventorySlot {
    item_id: ItemId;
    count: number;
    instance_id?: string | null;
    metadata?: Record<string, unknown>;
  }

  type InventoryMap = Record<ItemId, InventorySlot | number>;

  interface EquipmentSlots {
    back?: ItemId | null;
    face?: ItemId | null;
    hair?: ItemId | null;
    hand?: ItemId | null;
    neck?: ItemId | null;
    pants?: ItemId | null;
    shirt?: ItemId | null;
    shoes?: ItemId | null;
    [slot: string]: ItemId | null | undefined;
  }

  interface PlayerIdentity {
    account_id?: AccountId | null;
    player_id?: PlayerId | null;
    profile_id?: ProfileId | null;
    username?: string;
  }

  interface PlayerState extends PlayerIdentity {
    current_world?: WorldName;
    inventory?: InventoryMap;
    equipment_slots?: EquipmentSlots;
    x?: number;
    y?: number;
  }

  interface WorldBlock {
    block_id?: ItemId | null;
    foreground?: ItemId | null;
    background?: ItemId | null;
    metadata?: Record<string, unknown>;
  }

  interface WorldDrop extends TilePosition {
    drop_id: string;
    item_id: ItemId;
    count: number;
    instance_id?: string | null;
    metadata?: Record<string, unknown>;
    owner_account_id?: AccountId | null;
    owner_player_id?: PlayerId | null;
  }

  interface InventoryDelta {
    item_id: ItemId;
    count_delta: number;
    new_count?: number;
    reason?: string;
  }

  interface InventoryDeltaClientPayload {
    item_type: ItemId;
    item_category: string;
    delta: number;
    stack_limit: number;
    after_count?: number;
  }

  interface InventoryRewardEntry {
    item_id: ItemId;
    item_category: string;
    amount: number;
  }

  interface InventoryDeltaSource {
    item_type: ItemId;
    item_category: string;
    delta: number;
    expected_before_amount?: number;
    stack_limit?: number;
  }

  interface PostgresInventoryDeltaTransactionEntry {
    account_username?: string;
    username?: string;
    email?: string;
    actor_role?: string;
    world?: WorldName;
    source?: string;
    source_type?: string;
    action?: string;
    reason?: string;
    request_id?: RequestId | string;
    correlation_id?: string | null;
    metadata?: Record<string, unknown>;
    ip_address?: string;
    ip?: string;
    user_agent?: string;
    session_token_hash?: string;
    device_info?: Record<string, unknown>;
    deltas?: InventoryDeltaSource[];
    player_state?: RuntimePlayerState | Record<string, unknown>;
    world_state?: Record<string, unknown>;
    world_changes?: Array<Record<string, unknown>>;
    allow_state_repair?: boolean;
    strict_item_instances?: boolean;
    at?: string;
  }

  interface InventoryCommitSuccess {
    ok: true;
    state: RuntimePlayerState;
    postgres_committed: boolean;
    deltas: InventoryDeltaSource[];
    equipment_changed?: boolean;
  }

  interface InventoryCommitFailure {
    ok: false;
    reason?: string;
    message: string;
  }

  type InventoryCommitResult = InventoryCommitSuccess | InventoryCommitFailure;

  interface InventoryCommitOptions {
    action?: string;
    reason?: string;
    source?: string;
    source_type?: string;
    world?: WorldName;
    request_id?: RequestId | string;
    correlation_id?: string | null;
    metadata?: Record<string, unknown>;
    world_state?: Record<string, unknown>;
    world_changes?: Array<Record<string, unknown>>;
    allow_state_repair?: boolean;
    allow_dev_json_fallback?: boolean;
    failure_message?: string;
    skip_inventory_lock?: boolean;
    inventory_lock_owner?: string;
    ip_address?: string;
    user_agent?: string;
    session_token_hash?: string;
    device_info?: Record<string, unknown>;
    [key: string]: unknown;
  }

  interface InventorySpendCost {
    item_id: ItemId;
    item_category: string;
    amount: number;
  }

  interface DeferredInventoryCommit {
    username: string;
    beforeState: RuntimePlayerState;
    afterState: RuntimePlayerState;
    options: InventoryCommitOptions;
  }

  interface SpendServerInventoryCostOptions extends InventoryCommitOptions {
    socket?: unknown;
    player?: Record<string, any> | null;
    defer_commit?: boolean;
  }

  interface SpendServerInventoryCostSuccess {
    ok: true;
    state: RuntimePlayerState | null;
    postgres_committed?: boolean;
    deltas?: InventoryDeltaSource[];
    deferred_inventory_commit?: DeferredInventoryCommit;
  }

  interface SpendServerInventoryCostFailure {
    ok: false;
    reason: string;
    message: string;
  }

  type SpendServerInventoryCostResult =
    | SpendServerInventoryCostSuccess
    | SpendServerInventoryCostFailure;

  interface WorldInventoryValidationSuccess {
    ok: true;
    playerState?: RuntimePlayerState | null;
    postgres_committed?: boolean;
    inventoryDeltas?: InventoryDeltaSource[];
    deferred_inventory_commit?: DeferredInventoryCommit | null;
    rollbackWorldState?: Record<string, unknown> | null;
    worldChanges?: Array<Record<string, unknown>>;
    postCommitLogs?: Record<string, unknown> | null;
    message?: string;
    pendingHit?: boolean;
    toggledBlock?: boolean;
    toggle_from_block_type?: ItemId;
    toggle_to_block_type?: ItemId;
    toggled_to_solid?: boolean;
    previousEntry?: Record<string, unknown> | null;
    [key: string]: unknown;
  }

  interface WorldInventoryValidationFailure {
    ok: false;
    reason?: string;
    message?: string;
    [key: string]: unknown;
  }

  type WorldInventoryValidationResult =
    | WorldInventoryValidationSuccess
    | WorldInventoryValidationFailure;

  interface WorldStateCommitSuccess {
    ok: true;
    postgres_committed: boolean;
    serialized?: Record<string, unknown>;
    queued?: boolean;
  }

  interface WorldStateCommitFailure {
    ok: false;
    reason: string;
    message?: string;
  }

  type WorldStateCommitResult =
    | WorldStateCommitSuccess
    | WorldStateCommitFailure;

  interface WorldStateCommitOptions {
    player?: Record<string, any> | null;
    allow_dev_json_fallback?: boolean;
    [key: string]: unknown;
  }

  interface CommitWorldStateWithBlockChangesOptions extends WorldStateCommitOptions {
    player?: Record<string, any> | null;
    allow_dev_json_fallback?: boolean;
  }

  interface CommitWorldStateWithBlockChangesSuccess extends WorldStateCommitSuccess {
    ok: true;
    postgres_committed: boolean;
    serialized: Record<string, unknown>;
  }

  interface CommitWorldStateWithBlockChangesFailure extends WorldStateCommitFailure {
    ok: false;
    reason: "postgres_failed" | "postgres_unavailable" | string;
    message: string;
  }

  type CommitWorldStateWithBlockChangesResult =
    | CommitWorldStateWithBlockChangesSuccess
    | CommitWorldStateWithBlockChangesFailure;

  interface PostgresSaveWorldStateWithWorldChangesSuccess {
    ok: true;
  }

  interface PostgresSaveWorldStateWithWorldChangesFailure {
    ok: false;
    reason: "postgres_unavailable" | "database_error" | string;
    message?: string;
  }

  type PostgresSaveWorldStateWithWorldChangesResult =
    | PostgresSaveWorldStateWithWorldChangesSuccess
    | PostgresSaveWorldStateWithWorldChangesFailure;

  interface PostgresWorldChangeInsertSuccess {
    ok: true;
  }

  type PostgresWorldChangeInsertResult =
    | PostgresWorldChangeInsertSuccess
    | null;

  interface WorldDropPayloadInput extends Record<string, unknown> {
    drop_id?: string;
    id?: string;
    item_type?: ItemId | string;
    item_id?: ItemId | string;
    block_type?: ItemId | string;
    item_category?: string;
    category?: string;
    amount?: number;
    quantity?: number;
    x?: number;
    y?: number;
    stack_grid_x?: TileCoord | null;
    stack_grid_y?: TileCoord | null;
    grid_x?: TileCoord | null;
    grid_y?: TileCoord | null;
    pickup_delay?: number;
    metadata?: Record<string, unknown>;
  }

  interface NormalizedWorldDropPayload {
    drop_id: string;
    item_type: ItemId | string;
    item_category: string;
    amount: number;
    x: number;
    y: number;
    stack_grid_x: TileCoord | null;
    stack_grid_y: TileCoord | null;
    pickup_delay: number;
    metadata: Record<string, unknown>;
  }

  interface WorldDropRowInput extends Record<string, unknown> {
    drop_id?: string;
    item_type?: ItemId | string;
    item_category?: string;
    amount?: number;
    x?: number;
    y?: number;
    stack_grid_x?: TileCoord | null;
    stack_grid_y?: TileCoord | null;
    pickup_delay?: number;
  }

  interface RuntimeWorldDrop extends TilePosition {
    drop_id: string;
    item_type: ItemId | string;
    item_category: string;
    is_seed: boolean;
    amount: number;
    pickup_delay: number;
    stack_grid_x?: TileCoord;
    stack_grid_y?: TileCoord;
  }

  type RuntimeWorldDropMap = Map<string, RuntimeWorldDrop>;

  interface RuntimeWorldState {
    drops: RuntimeWorldDropMap;
    [key: string]: unknown;
  }

  interface ActiveWorldDropPayload extends RuntimeWorldDrop {}

  type RuntimeWorldDropCreateInput =
    | RuntimeWorldDrop
    | ActiveWorldDropPayload
    | SanitizedDropCreate;

  interface RuntimeWorldDropUpdateInput {
    drop_id: string;
    amount?: number;
    x?: number;
    y?: number;
  }

  interface LoadActiveWorldDropsSuccess {
    ok: true;
    world_name: WorldName;
    drops: ActiveWorldDropPayload[];
    skipped?: false;
  }

  interface LoadActiveWorldDropsSkipped {
    ok: true;
    world_name: WorldName;
    skipped: true;
    reason: "no_world_drop_rows" | string;
    drops: [];
  }

  interface LoadActiveWorldDropsFailure {
    ok: false;
    reason: "postgres_unavailable" | "invalid_world" | "database_error" | string;
    message?: string;
    drops: [];
  }

  type LoadActiveWorldDropsResult =
    | LoadActiveWorldDropsSuccess
    | LoadActiveWorldDropsSkipped
    | LoadActiveWorldDropsFailure;

  interface RefreshWorldDropsFromPostgresSuccess {
    ok: true;
    drop_count: number;
  }

  interface RefreshWorldDropsFromPostgresSkipped {
    ok: true;
    skipped: true;
    reason: "postgres_unavailable" | "unsupported" | "no_world_drop_rows" | string;
  }

  interface RefreshWorldDropsFromPostgresFailure {
    ok: false;
    reason: "database_error" | string;
  }

  type RefreshWorldDropsFromPostgresResult =
    | RefreshWorldDropsFromPostgresSuccess
    | RefreshWorldDropsFromPostgresSkipped
    | RefreshWorldDropsFromPostgresFailure;

  interface UpsertWorldDropOptions extends WorldDropPayloadInput {
    source?: string;
    action?: string;
    source_id?: string;
    mirrored_from_world_state?: boolean;
  }

  interface UpsertWorldDropSuccess {
    ok: true;
    drop: NormalizedWorldDropPayload;
  }

  interface UpsertWorldDropFailure {
    ok: false;
    reason: "missing_world" | "invalid_drop" | string;
  }

  type UpsertWorldDropResult =
    | UpsertWorldDropSuccess
    | UpsertWorldDropFailure;

  interface MirrorWorldDropsStateSuccess {
    ok: true;
    active_drop_count: number;
  }

  interface MirrorWorldDropsStateSkipped {
    ok: true;
    skipped: true;
  }

  interface MirrorWorldDropsStateFailure {
    ok: false;
    reason: "missing_world" | string;
  }

  type MirrorWorldDropsStateResult =
    | MirrorWorldDropsStateSuccess
    | MirrorWorldDropsStateSkipped
    | MirrorWorldDropsStateFailure;

  interface TrackedWorldDropChangeDetails extends Record<string, unknown> {
    drop_id?: string;
    item_type?: ItemId | string;
    item_category?: string;
    amount?: number;
    request_id?: RequestId | string;
    source_block?: ItemId | string;
    stack_grid_x?: TileCoord;
    stack_grid_y?: TileCoord;
    pickup_delay?: number;
  }

  interface WorldChangeEntryBase {
    journal_id?: string;
    at?: string;
    source_type?: string;
    source_id?: string;
    request_id?: RequestId | string;
    world?: WorldName;
    action?: string;
    layer?: string;
    x?: TileCoord | null;
    y?: TileCoord | null;
    block_type?: ItemId | string;
    account_username?: string;
    player_id?: PlayerId | string;
    details?: Record<string, unknown>;
    skip_postgres?: boolean;
    [key: string]: unknown;
  }

  interface WorldBlockChangeEntry extends WorldChangeEntryBase {
    block_type_before?: ItemId | string;
    block_type_after?: ItemId | string;
  }

  interface WorldObjectChangeEntry extends WorldChangeEntryBase {
    layer: "object";
    object_type: string;
    object_id: string;
    old_data: Record<string, unknown>;
    new_data: Record<string, unknown>;
  }

  interface TrackedWorldDropChangeEntry extends WorldChangeEntryBase {
    drop_id?: string;
    item_type?: ItemId | string;
    item_category?: string;
    amount?: number;
    actor_username?: string;
    source?: string;
    details?: TrackedWorldDropChangeDetails;
  }

  type WorldChangeEntry =
    | WorldBlockChangeEntry
    | WorldObjectChangeEntry
    | TrackedWorldDropChangeEntry;

  interface PostgresInventoryLedgerEntry {
    item_type: ItemId;
    item_category: string;
    delta: number;
    before_amount: number;
    after_amount: number;
    stack_limit: number;
  }

  interface PostgresInventoryDeltaTransactionSuccess {
    ok: true;
    player_id?: PlayerId | null;
    world_id?: string | null;
    ledger_entries: PostgresInventoryLedgerEntry[];
  }

  interface PostgresInventoryDeltaTransactionFailure {
    ok: false;
    reason: string;
    message?: string;
    item_type?: ItemId;
    item_category?: string;
    before_amount?: number;
    after_amount?: number;
    delta?: number;
    stack_limit?: number;
  }

  type PostgresInventoryDeltaTransactionResult =
    | PostgresInventoryDeltaTransactionSuccess
    | PostgresInventoryDeltaTransactionFailure;

  interface TradeOfferItem {
    item_id: ItemId;
    item_category: string;
    amount: number;
  }

  type TradeOfferSlot = TradeOfferItem | null;
  type TradeOfferSlots = TradeOfferSlot[];

  interface TradeOfferParseResult {
    slotIndex: number;
    item: TradeOfferSlot;
  }

  interface TradeActionValidationSuccess {
    ok: true;
  }

  interface TradeActionValidationFailure {
    ok: false;
    message: string;
    [key: string]: unknown;
  }

  type TradeActionValidationResult =
    | TradeActionValidationSuccess
    | TradeActionValidationFailure;

  interface ActiveTradeState {
    id: string;
    status: string;
    requester_id: PlayerId | string;
    target_id: PlayerId | string;
    requester_username: string;
    target_username: string;
    world?: WorldName;
    offers: Record<string, TradeOfferSlots>;
    accepted: Record<string, boolean>;
    final_accepted: Record<string, boolean>;
    updated_at?: number;
    _finalizing?: boolean;
    [key: string]: unknown;
  }

  interface TradeParticipantRecord {
    socket?: unknown;
    player: RuntimePlayer;
    [key: string]: unknown;
  }

  interface TradeInventoryValidationSuccess {
    ok: true;
    offersA: TradeOfferItem[];
    offersB: TradeOfferItem[];
  }

  interface TradeInventoryValidationFailure {
    ok: false;
    message: string;
  }

  type TradeInventoryValidationResult =
    | TradeInventoryValidationSuccess
    | TradeInventoryValidationFailure;

  interface WorldLockBlockEntry extends TilePosition {
    block_type: ItemId | string;
  }

  interface WorldLockState {
    is_locked?: boolean;
    lock_block_type?: ItemId | string;
    lock_type?: ItemId | string;
    lock_grid_x?: TileCoord;
    lock_grid_y?: TileCoord;
    owner_account_id?: AccountId | null;
    owner_player_id?: PlayerId | null;
    owner_profile_id?: ProfileId | null;
    owner_name?: string | null;
    owner_username?: string | null;
    allowed_players?: string[];
    allowed_account_ids?: AccountId[];
    allowed_player_ids?: PlayerId[];
    player_roles?: Record<string, string>;
    player_roles_by_account_id?: Record<AccountId, string>;
    player_roles_by_player_id?: Record<PlayerId, string>;
    public_build?: boolean;
    trusted_builder_slot_limit?: number;
    trade_key_holder?: string;
    trade_key_holder_account_id?: AccountId | string;
    trade_key_holder_player_id?: PlayerId | string;
    trade_key_holder_profile_id?: ProfileId | string;
    trade_key_issued_at?: string;
    trade_key_last_trade_id?: string;
    trade_key_public_item_instance_id?: string;
    [key: string]: unknown;
  }

  interface WorldLockKeyTradeCandidateSuccess {
    ok: true;
    lock: WorldLockState;
    lock_block: WorldLockBlockEntry;
  }

  interface WorldLockKeyTradeCandidateFailure {
    ok: false;
    message: string;
    owner_message?: boolean;
  }

  type WorldLockKeyTradeCandidateResult =
    | WorldLockKeyTradeCandidateSuccess
    | WorldLockKeyTradeCandidateFailure;

  interface WorldLockKeyTradeTransfer extends Record<string, unknown> {
    from_player_id: PlayerId | string;
    to_player_id: PlayerId | string;
    from_username: string;
    to_username: string;
    from_player?: RuntimePlayer | null;
    to_player?: RuntimePlayer | null;
    world: WorldName;
    lock_before: WorldLockState;
    lock_block: WorldLockBlockEntry;
  }

  interface TradeWorldLockKeyTransfersSuccess {
    ok: true;
    transfers: WorldLockKeyTradeTransfer[];
  }

  interface TradeWorldLockKeyTransfersFailure {
    ok: false;
    message: string;
    owner_message?: boolean;
    owner_player_id?: PlayerId | string;
  }

  type TradeWorldLockKeyTransfersResult =
    | TradeWorldLockKeyTransfersSuccess
    | TradeWorldLockKeyTransfersFailure;

  interface ItemInstanceMovement extends Record<string, unknown> {
    item_type?: ItemId | string;
    item_id?: ItemId | string;
    item_category?: string;
    from_player_id?: PlayerId | string;
    to_player_id?: PlayerId | string;
    public_item_instance_id?: string;
    metadata?: Record<string, unknown>;
  }

  interface WorldLockKeyOwnershipTransferEntry {
    world: WorldName;
    from_username: string;
    to_username: string;
  }

  interface WorldLockKeyOwnershipTransferSuccess {
    ok: true;
    applied: WorldLockKeyOwnershipTransferEntry[];
  }

  interface WorldLockKeyOwnershipTransferFailure {
    ok: false;
    reason: string;
    message: string;
    applied: WorldLockKeyOwnershipTransferEntry[];
  }

  type WorldLockKeyOwnershipTransferResult =
    | WorldLockKeyOwnershipTransferSuccess
    | WorldLockKeyOwnershipTransferFailure;

  interface WorldLockStatePayload {
    type: "world_interaction_update";
    world: WorldName;
    action: "world_lock_state";
    state: WorldLockState;
  }

  interface OwnedWorldLockEntry {
    world_name: WorldName;
    owner_name: string;
    owner_account_id: AccountId | string;
    owner_player_id: PlayerId | string;
    owner_profile_id: ProfileId | string;
    lock_grid_x: TileCoord;
    lock_grid_y: TileCoord;
    lock_block_type: ItemId | string;
    lock_type: ItemId | string;
    access_count: number;
    public_build: boolean;
    trusted_builder_slot_limit: number;
    source_label: string;
    is_locked: true;
  }

  interface VendListing {
    listing_id?: string;
    transaction_id?: string;
    item_id: ItemId;
    item_category: string;
    stock: number;
    amount_per_sale: number;
    price_wls: number;
    created_at: string;
  }

  interface VendLogEntry {
    buyer_username: string;
    item_id: ItemId;
    item_category: string;
    amount: number;
    price_wls: number;
    date: string;
  }

  interface VendState extends TilePosition {
    action: "vend_state";
    world: WorldName;
    owner_username: string;
    owner_name: string;
    listing: VendListing | null;
    pending_wls: number;
    logs: VendLogEntry[];
    updated_at: string;
    status?: "empty" | "listed" | "sold" | string;
    [key: string]: unknown;
  }

  interface VendClientState extends TilePosition {
    action: "vend_state";
    world: WorldName;
    owner_username: string;
    owner_name: string;
    listing: VendListing | Record<string, never>;
    pending_wls: number;
    logs: VendLogEntry[];
    status: "empty" | "listed" | "sold" | string;
    can_manage: boolean;
  }

  interface SafeSlot {
    item_id: ItemId;
    item_category: string;
    amount: number;
  }

  interface SafeState extends TilePosition {
    action: "safe_state";
    world: WorldName;
    owner_username: string;
    owner_name: string;
    slots: SafeSlot[];
    updated_at: string;
    [key: string]: unknown;
  }

  interface SafeClientState extends TilePosition {
    action: "safe_state";
    world: WorldName;
    owner_username: string;
    owner_name: string;
    slots: SafeSlot[];
    max_slots: number;
    can_manage: boolean;
  }

  interface DonationBoxEntry {
    donation_id: string;
    donor_username: string;
    donor_name: string;
    donor_account_id: string;
    donor_player_id: string;
    item_id: ItemId;
    item_category: string;
    amount: number;
    donated_at: string;
  }

  interface DonationBoxState extends TilePosition {
    action: "donation_box_state";
    world: WorldName;
    owner_username: string;
    owner_name: string;
    owner_account_id: string;
    owner_player_id: string;
    donations: DonationBoxEntry[];
    updated_at: string;
    [key: string]: unknown;
  }

  interface DonationBoxClientState extends TilePosition {
    action: "donation_box_state";
    world: WorldName;
    owner_username: string;
    owner_name: string;
    donations: DonationBoxEntry[];
    donation_count: number;
    max_donations: number;
    has_donations: boolean;
    can_manage: boolean;
    can_donate: boolean;
  }

  interface MailboxMessage {
    from: string;
    message: string;
    sent_at: string;
  }

  interface MailboxState extends TilePosition {
    action: "mailbox_state";
    world: WorldName;
    messages: MailboxMessage[];
    updated_at: string;
  }

  interface MailboxClientState extends TilePosition {
    action: "mailbox_state";
    world: WorldName;
    messages: MailboxMessage[];
    capacity: number;
    can_empty: boolean;
    can_manage: boolean;
  }

  interface BulletinBoardMessage {
    player_name: string;
    username: string;
    message: string;
    posted_at: string;
  }

  interface BulletinBoardState extends TilePosition {
    action: "bulletin_board_state";
    world: WorldName;
    messages: BulletinBoardMessage[];
    updated_at: string;
  }

  interface BulletinBoardClientState extends TilePosition {
    action: "bulletin_board_state";
    world: WorldName;
    messages: BulletinBoardMessage[];
    capacity: number;
    can_clear: boolean;
    can_manage: boolean;
    updated_at: string;
  }

  interface WorldInteractionUpdateInput extends TilePosition, Record<string, unknown> {
    action: string;
    world?: WorldName;
    block_type?: ItemId | string;
    operation?: string;
    message?: string;
    state?: Record<string, unknown>;
    enabled?: boolean;
  }

  interface CheckpointActivatePayload extends TilePosition {
    type: "world_interaction_update";
    world: WorldName;
    action: "checkpoint_activate";
    block_type: ItemId | string;
    active: true;
  }

  interface ToggleWorldInteractionState extends TilePosition {
    action: "anti_punch_state" | "anti_talk_state" | "anti_gravity_state";
    world: WorldName;
    block_type: ItemId | string;
    enabled: boolean;
  }

  interface ToggleWorldInteractionPayload extends ToggleWorldInteractionState {
    type: "world_interaction_update";
  }

  interface AdminTwoFactorResult {
    ok: boolean;
    required: boolean;
    reason?: string;
  }

  interface DeveloperSecurityRequirementSuccess {
    ok: true;
  }

  interface DeveloperSecurityRequirementFailure {
    ok: false;
    message: string;
    reason: "developer_pin_required" | "admin_2fa_required" | string;
    extra: Record<string, unknown>;
  }

  type DeveloperSecurityRequirementResult =
    | DeveloperSecurityRequirementSuccess
    | DeveloperSecurityRequirementFailure;

  interface AdminCommandCooldownResult {
    ok: boolean;
    retry_ms?: number;
  }

  interface AdminActionTarget {
    target_type: string;
    target_id: string;
    target_username: string;
    target_world: WorldName | string;
  }

  interface DeveloperInventoryCommand {
    targetUsername: string;
    itemId: ItemId;
    itemCategory: string;
    amount: number;
  }

  interface PunishmentDurationParseResult {
    ok: boolean;
    consumed: boolean;
    durationMinutes: number;
    label: string;
  }

  interface PublicPunishmentPayload {
    punishment_id: number;
    punishment_type: string;
    scope: string;
    world: WorldName | string;
    reason: string;
    starts_at: string;
    ends_at: string;
    issued_by: string;
  }

  interface ParsedPunishmentCommand {
    mode: "issue" | "revoke" | "list";
    targetUsername: string;
    punishmentType: string;
    scope?: string;
    world?: WorldName | string;
    durationMinutes?: number;
    durationLabel?: string;
    reason?: string;
  }

  interface ParsedItemInstanceAdminCommand {
    mode: "audit" | "copies" | "moderate";
    action?: "freeze" | "unfreeze" | "retire" | "transfer" | "flag" | string;
    itemInstanceId?: string;
    targetUsername?: string;
    reason?: string;
    limit?: number;
  }

  interface NetfoxMovementRoute {
    world: WorldName;
    world_id: WorldName;
    host: string;
    port: number;
    max_clients: number;
    server_instance_id: string;
    registered_at_ms: number;
    registered_at: string;
    expires_at_ms: number;
    expires_at: string;
    source: string;
    [key: string]: unknown;
  }

  interface NetfoxMovementRouteStats {
    registered_worlds: number;
    route_ttl_ms: number;
    static_fallback_enabled: boolean;
    static_world: WorldName | "*" | string;
    registered_routes: Record<WorldName, Record<string, unknown>>;
  }

  interface NetfoxTicketIdentity {
    world: WorldName;
    world_id: WorldName;
    username: string;
    account_username: string;
    display_name: string;
    websocket_player_id: string;
    game_player_id: string;
    account_id: string;
    profile_id: string;
  }

  interface NetfoxSpawnTicketRoute {
    enabled: boolean;
    world: WorldName;
    world_id: WorldName;
    host: string;
    port: number;
    max_clients: number;
    route_source: string;
    route_expires_at_ms: number;
    route_expires_at: string;
    ticket_required: true;
    ticket_configured: boolean;
    ticket_ttl_ms: number;
    ticket_expires_at_ms: number;
    ticket_expires_at: string;
    server_instance_id: string;
    ticket: string;
    reason: string;
    message: string;
  }

  interface NetfoxSpawnTicketParseSuccess {
    ok: true;
    payload: Record<string, unknown>;
  }

  interface NetfoxSpawnTicketParseFailure {
    ok: false;
    reason: string;
    error: string;
    status: number;
  }

  type NetfoxSpawnTicketParseResult =
    | NetfoxSpawnTicketParseSuccess
    | NetfoxSpawnTicketParseFailure;

  interface NetfoxSpawnTicketVerifySuccess {
    ok: true;
    world: WorldName;
    peer_id: number;
    identity: Record<string, unknown>;
  }

  type NetfoxSpawnTicketVerifyResult =
    | NetfoxSpawnTicketVerifySuccess
    | NetfoxSpawnTicketParseFailure;

  interface WorldRouteClaimResult extends Record<string, unknown> {
    ok: boolean;
    fallback?: boolean;
    reason?: string;
    world?: WorldName;
    owner_instance_id?: string;
    ws_url?: string;
  }

  interface WorldRouteActionResult extends Record<string, unknown> {
    ok: boolean;
    reason?: string;
    world?: WorldName;
    route?: WorldRouteClaimResult;
  }

  interface WorldDensityBatchProfile {
    interval_ms: number;
    max_items: number;
  }

  interface ClientMovementGuidance {
    position_heartbeat_interval_ms: number;
    position_broadcast_interval_ms: number;
    position_batch_max_items: number;
    world_population_for_batching: number;
    source: string;
    source_version: number;
  }

  interface WorldAdmissionReservation extends Record<string, unknown> {
    ok: boolean;
    reserved?: boolean;
    local_reserved?: boolean;
    redis_reserved?: boolean;
    fallback?: boolean;
    committed?: boolean;
    reason?: string;
    route_reason?: string;
    world?: WorldName;
    player_id?: PlayerId | string;
    current_players?: number;
    owner_instance_id?: string;
    ws_url?: string;
  }

  interface RedisStoreOptions {
    enabled?: boolean;
    url?: string;
    keyPrefix?: string;
    logger?: (...args: unknown[]) => void;
    connectTimeoutMs?: number;
  }

  interface PostgresStoreOptions {
    enabled?: boolean;
    schema?: string;
    logger?: (...args: unknown[]) => void;
    bootstrapSqlPath?: string;
    autoBootstrap?: boolean;
    maxWriteQueueDepth?: number;
    connectionString?: string;
    host?: string;
    port?: number | string;
    database?: string;
    user?: string;
    password?: string;
    ssl?: boolean;
    poolMax?: number;
    idleTimeoutMs?: number;
    connectTimeoutMs?: number;
  }

  interface RedisHealthSnapshot {
    enabled: boolean;
    ready: boolean;
    key_prefix: string;
    error?: string;
    key_counts: {
      locks: number;
      presence: number;
      active_sessions: number;
      world_admissions: number;
      world_routes: number;
      netfox_movement_routes: number;
    };
    lock_ttl_ms: {
      sample_size: number;
      min_ttl_ms: number | null;
      max_ttl_ms: number | null;
      avg_ttl_ms: number | null;
      stale_count: number;
      near_expiry_count: number;
    };
  }

  interface RedisRateLimitResult {
    allowed: boolean;
    fallback: boolean;
    count: number;
    resetInMs: number;
  }

  interface RedisLockResult {
    acquired: boolean;
    fallback: boolean;
    key: string;
    token: string;
  }

  interface RedisWorldAdmissionResult {
    ok: boolean;
    fallback: boolean;
    count: number;
    key: string;
    reason?: string;
  }

  interface RedisWorldAdmissionReleaseResult {
    released: boolean;
    fallback: boolean;
    count: number;
  }

  interface RedisWorldAdmissionCountResult {
    ok: boolean;
    fallback: boolean;
    count: number;
  }

  interface RedisWorldRouteResult extends WorldRouteClaimResult {
    ok: boolean;
    fallback: boolean;
    world: WorldName | string;
    reason?: string;
    owner_instance_id?: string;
    ws_url?: string;
    owner_key?: string;
    target_key?: string;
  }

  interface RedisWorldRouteReleaseResult {
    released: boolean;
    fallback: boolean;
  }

  interface RedisNetfoxMovementRouteSetResult {
    ok: boolean;
    fallback: boolean;
    world: WorldName | string;
    key?: string;
    reason?: string;
  }

  interface RedisNetfoxMovementRouteGetResult {
    ok: boolean;
    fallback: boolean;
    reason?: string;
    world: WorldName | string;
    route: NetfoxMovementRoute | Record<string, unknown> | null;
  }

  interface RedisNetfoxMovementRouteDeleteResult {
    deleted: boolean;
    fallback: boolean;
  }

  interface WorldPopulationUpdatePayload {
    type: "world_population_update";
    world_counts: Record<WorldName, number>;
    network_movement_guidance: Record<WorldName, ClientMovementGuidance>;
  }

  interface ClientMessageBase {
    type: string;
    action_id?: RequestId;
    request_id?: RequestId;
  }

  interface WorldScopedClientMessage extends ClientMessageBase {
    world?: WorldName;
    current_world?: WorldName;
    current_world_id?: WorldName;
    world_id?: WorldName;
    world_name?: WorldName;
    actor_x?: number;
    actor_y?: number;
    actor_world?: WorldName;
    actor_facing?: Direction | string;
    facing?: Direction | number | string;
    x?: number;
    y?: number;
  }

  interface WorldBlockUpdateMessage extends WorldScopedClientMessage {
    type: "world_block_update";
    action: WorldBlockAction | string;
    layer?: WorldBlockLayer | string;
    block_type?: ItemId;
    block_id?: ItemId | null;
    foreground?: ItemId | null;
    background?: ItemId | null;
    item_id?: number | ItemId | null;
    metadata?: Record<string, unknown>;
    source_tool?: ItemId;
    water_bucket_action?: "pour" | "scoop" | string;
  }

  interface WorldItemDropCreateMessage extends WorldScopedClientMessage {
    type: "world_item_drop_create" | "world_drop_create";
    amount?: number;
    count?: number;
    drop_id?: string;
    instance_id?: string | null;
    is_seed?: boolean;
    item_category?: string;
    item_id?: ItemId;
    item_type?: ItemId;
    metadata?: Record<string, unknown>;
    pickup_delay?: number;
    stack_grid_x?: TileCoord;
    stack_grid_y?: TileCoord;
  }

  interface WorldItemDropPickupMessage extends WorldScopedClientMessage {
    type: "world_item_drop_pickup" | "world_drop_pickup" | "drop_pickup";
    amount?: number;
    drop_id?: string;
    drop_ids?: string[];
    item_category?: string;
    item_id?: ItemId;
    item_type?: ItemId;
    bulk_pickup?: boolean;
    bulk_pickup_same_tile?: boolean;
    pickups?: Array<Record<string, unknown>>;
    stack_grid_x?: TileCoord;
    stack_grid_y?: TileCoord;
  }

  interface PlayerPositionMessage extends WorldScopedClientMessage {
    type: "player_position";
    name?: string;
    animation_state?: "idle" | "walk" | "run" | "jump" | "fall" | string;
    chat_typing?: boolean;
    client_time_msec?: number;
    client_timestamp_msec?: number;
    damage_flash_active?: boolean;
    damage_flash_remaining_ms?: number;
    damage_flash_token?: number;
    equipment_slots?: EquipmentSlots;
    equipped_back?: ItemId | string;
    equipped_back_item?: ItemId | string;
    equipped_eyewear_item?: ItemId | string;
    equipped_hair_item?: ItemId | string;
    equipped_hat_item?: ItemId | string;
    equipped_pants_item?: ItemId | string;
    equipped_ride_item?: ItemId | string;
    equipped_shirt_item?: ItemId | string;
    equipped_shoes_item?: ItemId | string;
    equipped_tool?: ItemId | string;
    fishing_active?: boolean;
    fishing_lure_id?: string;
    fishing_rod_id?: string;
    fishing_target_x?: number;
    fishing_target_y?: number;
    in_lava_fire?: boolean;
    in_water?: boolean;
    input_sequence?: number;
    movement_sequence?: number;
    on_floor?: boolean;
    packet_time_msec?: number;
    seq?: number;
    sequence?: number;
    sent_at_msec?: number;
    timestamp?: number;
    timestamp_msec?: number;
    velocity_x?: number;
    velocity_y?: number;
    visual_sync?: boolean;
  }

  interface SanitizedDropCreate extends TilePosition {
    type: "drop_spawned";
    world: WorldName;
    drop_id: string;
    item_type: ItemId;
    item_category: string;
    is_seed: boolean;
    amount: number;
    stack_grid_x?: TileCoord;
    stack_grid_y?: TileCoord;
    pickup_delay: number;
  }

  interface SanitizedDropUpdate {
    type: "world_item_drop_update";
    world: WorldName;
    drop_id: string;
    amount?: number;
    x?: number;
    y?: number;
  }

  interface SanitizedDropPickup {
    type: "world_item_drop_pickup";
    world: WorldName;
    requested_world: WorldName;
    drop_id: string;
    player_id: PlayerId;
    name: string;
    action_position: ActorPosition | null;
  }

  interface SanitizedBulkDropPickup extends SanitizedDropPickup {
    bulk_pickup: true;
    drop_ids: string[];
  }

  interface DropPickupWorldResolveInput {
    drop_id?: string;
    requested_world?: WorldName | string;
  }

  interface DropPickupUpdateInput extends Record<string, unknown> {
    drop_id?: string;
    requested_world?: WorldName | string;
    action_position?: ActorPosition | null;
    validation_position?: ActorPosition | Record<string, unknown> | null;
    validationPosition?: ActorPosition | Record<string, unknown> | null;
  }

  interface RuntimePlayer extends PlayerState {
    id: PlayerId;
    account_username?: string;
    name?: string;
    world?: WorldName;
    [key: string]: unknown;
  }

  type RuntimePlayerState = Record<string, any>;

  interface ServerDropState extends TilePosition {
    drop_id?: string;
    item_type?: ItemId;
    item_category?: string;
    amount?: number;
    is_seed?: boolean;
    pickup_delay?: number;
    stack_grid_x?: TileCoord;
    stack_grid_y?: TileCoord;
    status?: string;
    [key: string]: unknown;
  }

  type DropPickupFailureReason =
    | "drop_locked"
    | "drop_not_available"
    | "drop_changed"
    | "drop_amount_changed"
    | "inventory_full"
    | "inventory_locked"
    | "inventory_unavailable"
    | "not_available"
    | "position_unavailable"
    | "postgres_rejected"
    | "too_far"
    | "wrong_world"
    | string;

  interface DropPickupFailure {
    ok: false;
    reason: DropPickupFailureReason;
    drop?: ServerDropState;
    world?: WorldName;
    current_world?: WorldName;
    requested_world?: WorldName;
    position?: Record<string, unknown>;
    validationPosition?: ActorPosition | Record<string, unknown>;
    item_type?: ItemId;
    item_category?: string;
    stackLimit?: number;
    currentCount?: number;
    availableSpace?: number;
    dropAmount?: number;
    pickedAmount?: number;
    [key: string]: unknown;
  }

  interface PreparedDropPickupPlan {
    ok: true;
    player: RuntimePlayer;
    world: WorldName;
    dropId: string;
    dropStateKey: string;
    drop: ServerDropState & {
      drop_id: string;
      item_type: ItemId;
      item_category: string;
    };
    playerState: RuntimePlayerState;
    item_type: ItemId;
    item_category: string;
    validationPosition: ActorPosition & { ok: true };
    dropAmount: number;
    pickedAmount: number;
    stackLimit: number;
    currentCount: number;
    availableSpace: number;
    remaining: number;
  }

  type PreparedDropPickupResult = PreparedDropPickupPlan | DropPickupFailure;

  interface DropPickupWorldLookupResult {
    state: RuntimeWorldState;
    drop: RuntimeWorldDrop | null;
    key: string;
    publicDropId: string;
    world: WorldName;
  }

  interface DropPickupWorldRemovePayload {
    type: "world_item_drop_remove";
    world: WorldName;
    drop_id: string;
    remaining: number;
    removed: true;
    requested_by: PlayerId | string;
    requested_by_name: string;
    reason?: string;
  }

  interface DropPickupWorldUpdatePayload {
    type: "world_item_drop_update";
    world: WorldName;
    drop_id: string;
    item_type: ItemId;
    item_category: string;
    amount: number;
    remaining: number;
    requested_by: PlayerId | string;
    requested_by_name: string;
  }

  type DropPickupWorldPayload = DropPickupWorldRemovePayload | DropPickupWorldUpdatePayload;

  interface DropPickupWorldApplySuccess {
    ok: true;
    payload: DropPickupWorldPayload;
  }

  interface DropPickupWorldApplyFailure {
    ok: false;
    reason: DropPickupFailureReason;
  }

  type DropPickupWorldApplyResult = DropPickupWorldApplySuccess | DropPickupWorldApplyFailure;

  interface LegacyDropPickupSuccess {
    ok: true;
    drop: ServerDropState & {
      drop_id: string;
      item_type: ItemId;
      item_category: string;
      amount: number;
    };
    playerState: RuntimePlayerState;
    update: DropPickupWorldPayload;
    remaining: number;
  }

  type LegacyDropPickupResult = LegacyDropPickupSuccess | DropPickupFailure;

  interface DropPickupWorldResultInput extends Record<string, unknown> {
    payload?: DropPickupWorldPayload;
    type?: string;
    world?: WorldName;
    drop_id?: string;
    item_type?: ItemId;
    item_id?: ItemId;
    item_category?: string;
    category?: string;
    amount?: number;
    remaining?: number;
    remaining_amount?: number;
    removed?: boolean;
  }

  interface BulkDropPickupResultEntry extends Record<string, unknown> {
    ok: boolean;
    drop_id?: string;
    item_type?: ItemId;
    item_category?: string;
    amount?: number;
    remaining?: number;
    remaining_amount?: number;
    removed?: boolean;
    reason?: DropPickupFailureReason;
    message?: string;
    requested_by?: PlayerId | string;
    requested_by_name?: string;
  }

  interface BulkDropPickupWorldUpdateEntry extends Record<string, unknown> {
    world?: WorldName;
    payload?: DropPickupWorldPayload | DropPickupWorldResultInput;
  }

  interface BulkDropPickupWorldResultPayload {
    type: "world_item_drop_remove";
    world: WorldName;
    drop_id: string;
    drop_ids: string[];
    removed_drop_ids: string[];
    updated_drops: DropPickupWorldUpdatePayload[];
    bulk_pickup: true;
    amount: number;
    picked_count: number;
    pickup_results: BulkDropPickupResultEntry[];
    requested_by: PlayerId | string;
    requested_by_name: string;
    _server_inventory_update_applied: true;
    _apply_pickup_inventory: false;
  }

  type TrackedItemInstanceSnapshot = Record<string, unknown>;

  interface PostgresDropPickupTransactionEntry {
    account_username?: string;
    world?: WorldName;
    drop_id?: string;
    item_type?: ItemId;
    item_category?: string;
    amount?: number;
    expected_before_amount?: number;
    stack_limit?: number;
    allow_state_repair?: boolean;
    allow_world_drop_repair?: boolean;
    request_id?: RequestId | string;
    source_id?: string;
    drop_x?: number;
    drop_y?: number;
    stack_grid_x?: TileCoord;
    stack_grid_y?: TileCoord;
    pickup_delay?: number;
    drop_amount?: number;
    drop_before_amount?: number;
    correlation_id?: string | null;
    ip_address?: string;
    ip?: string;
    user_agent?: string;
    session_token_hash?: string;
    device_info?: Record<string, unknown>;
    at?: string;
  }

  interface PostgresDropPickupSuccess {
    ok: true;
    before_amount: number;
    after_amount: number;
    item_type: ItemId;
    item_category: string;
    repaired_inventory_before_amount: number | null;
    drop_before_amount: number;
    drop_after_amount: number;
    item_instances: TrackedItemInstanceSnapshot[];
  }

  interface PostgresDropPickupFailure {
    ok: false;
    reason: DropPickupFailureReason
      | "database_error"
      | "invalid_payload"
      | "player_not_found"
      | "postgres_unavailable"
      | "tracked_item_instance_movement_failed";
    drop_id?: string;
    item_type?: ItemId;
    item_category?: string;
    available_amount?: number;
    requested_amount?: number;
    message?: string;
    item_instances?: TrackedItemInstanceSnapshot[];
    [key: string]: unknown;
  }

  type PostgresDropPickupResult = PostgresDropPickupSuccess | PostgresDropPickupFailure;

  interface DropPickupInventoryTransactionResult {
    ok: true;
    request_id: RequestId | string;
    server_action_id?: string;
    action: "drop_pickup";
    source_type: "world_item_drop_pickup";
    bulk_pickup?: boolean;
    world: WorldName;
    drop_id: string;
    drop_ids?: string[];
    removed_drop_ids?: string[];
    updated_drops?: DropPickupWorldUpdatePayload[];
    pickup_results?: Array<Record<string, unknown>>;
    item_type?: ItemId;
    item_category?: string;
    amount: number;
    remaining?: number;
    remaining_amount?: number;
    requested_by: PlayerId | string;
    requested_by_name: string;
    message: string;
    username: string;
    inventory_delta: InventoryDeltaClientPayload[];
    inventory_deltas: InventoryDeltaClientPayload[];
    rewards: InventoryRewardEntry[];
    _server_inventory_update_applied: true;
    _apply_pickup_inventory: false;
    [key: string]: unknown;
  }

  interface InventoryTransactionResultResponse {
    type: "inventory_transaction_result";
    ok: boolean;
    request_id: string;
    action: string;
    message: string;
    username: string;
    rewards: unknown[];
    player_data?: Record<string, unknown>;
    [key: string]: unknown;
  }

  type ClientWorldActionMessage =
    | WorldBlockUpdateMessage
    | WorldItemDropCreateMessage
    | WorldItemDropPickupMessage
    | PlayerPositionMessage;

  interface ServerMessageBase {
    type: string;
  }

  interface ServerInventoryDeltaMessage extends ServerMessageBase {
    type: "inventory_delta";
    deltas: InventoryDelta[];
    equipment_slots?: EquipmentSlots;
  }

  interface ServerWorldDropCreateMessage extends ServerMessageBase {
    type: "world_item_drop_create";
    drop: WorldDrop;
  }

  interface ServerWorldDropPickupMessage extends ServerMessageBase {
    type: "world_item_drop_pickup";
    drop_ids: string[];
    inventory_delta?: InventoryDelta[];
  }
}
