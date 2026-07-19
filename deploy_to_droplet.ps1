param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$RemoteIp,

  [string]$RemoteUser = "root",
  [string]$RemoteDir = "PixelManiaServer",
  [string]$SshKeyPath,
  [string]$SmokeApiBase = "https://api.pixelmaniagame.com",
  [string]$ClientVersion,
  [string]$MinClientVersion,
  [string]$UpdateUrl,
  [switch]$ForceClientUpdate,
  [switch]$RunSmokeChecks,
  [switch]$RunRemoteFullChecks,
  [switch]$SkipLocalPreflight
)

$ErrorActionPreference = "Stop"

function Resolve-RepoDoc {
  param([string]$FileName)

  $candidateRoots = @()
  if ($env:PIXELMANIA_CLIENT_ROOT) {
    $candidateRoots += $env:PIXELMANIA_CLIENT_ROOT
  }
  $candidateRoots += Split-Path -Parent $PSScriptRoot
  $candidateRoots += Join-Path (Split-Path -Parent $PSScriptRoot) "pixel-mania"
  $candidateRoots += (Get-Location).Path

  foreach ($candidateRoot in $candidateRoots) {
    if (-not $candidateRoot) {
      continue
    }

    $candidatePath = Join-Path $candidateRoot "docs/$FileName"
    if (Test-Path $candidatePath) {
      return $candidatePath
    }
  }

  throw "Could not find docs/$FileName. Run from the Godot repo root or set PIXELMANIA_CLIENT_ROOT."
}

function Resolve-ClientRoot {
  $repoParent = Split-Path -Parent $PSScriptRoot
  $candidateRoots = @()
  if ($env:PIXELMANIA_CLIENT_ROOT) {
    $candidateRoots += $env:PIXELMANIA_CLIENT_ROOT
  }
  $candidateRoots += Join-Path $repoParent "pixel-mania"
  $candidateRoots += $repoParent
  $candidateRoots += (Get-Location).Path

  foreach ($candidateRoot in $candidateRoots) {
    if (-not $candidateRoot) {
      continue
    }

    $clientItemDatabase = Join-Path $candidateRoot "Scripts/item_database.gd"
    if (Test-Path $clientItemDatabase) {
      return $candidateRoot
    }
  }

  throw "Could not find PixelMania client root. Expected Scripts/item_database.gd under a sibling pixel-mania folder, or set PIXELMANIA_CLIENT_ROOT."
}

$localBackend = Join-Path $PSScriptRoot "server.js"
$localBackendSource = Join-Path $PSScriptRoot "src/server.ts"
$localPacketContracts = Join-Path $PSScriptRoot "server_packet_contracts.js"
$localPacketContractsSource = Join-Path $PSScriptRoot "src/server_packet_contracts.ts"
$localPacketContractsBuildConfig = Join-Path $PSScriptRoot "tsconfig.packet-contracts.json"
$localDropContracts = Join-Path $PSScriptRoot "server_drop_contracts.js"
$localDropContractsSource = Join-Path $PSScriptRoot "src/server_drop_contracts.ts"
$localDropContractsBuildConfig = Join-Path $PSScriptRoot "tsconfig.drop-contracts.json"
$localInventoryContracts = Join-Path $PSScriptRoot "server_inventory_contracts.js"
$localInventoryContractsSource = Join-Path $PSScriptRoot "src/server_inventory_contracts.ts"
$localInventoryContractsBuildConfig = Join-Path $PSScriptRoot "tsconfig.inventory-contracts.json"
$localPostgresContracts = Join-Path $PSScriptRoot "postgres_store_contracts.js"
$localPostgresContractsSource = Join-Path $PSScriptRoot "src/postgres_store_contracts.ts"
$localPostgresContractsBuildConfig = Join-Path $PSScriptRoot "tsconfig.postgres-contracts.json"
$localDeployHelper = $PSCommandPath
$localEnvExample = Join-Path $PSScriptRoot ".env.example"
$localServerRuntimeStats = Join-Path $PSScriptRoot "server_runtime_stats.js"
$localServerRuntimeStatsSource = Join-Path $PSScriptRoot "src/server_runtime_stats.ts"
$localServerCrashDetails = Join-Path $PSScriptRoot "server_crash_details.js"
$localServerCrashDetailsSource = Join-Path $PSScriptRoot "src/server_crash_details.ts"
$localServerEnvConfig = Join-Path $PSScriptRoot "server_env_config.js"
$localServerEnvConfigSource = Join-Path $PSScriptRoot "src/server_env_config.ts"
$localServerIdentityHelpers = Join-Path $PSScriptRoot "server_identity_helpers.js"
$localServerIdentityHelpersSource = Join-Path $PSScriptRoot "src/server_identity_helpers.ts"
$localServerTextHelpers = Join-Path $PSScriptRoot "server_text_helpers.js"
$localServerTextHelpersSource = Join-Path $PSScriptRoot "src/server_text_helpers.ts"
$localServerVersionHelpers = Join-Path $PSScriptRoot "server_version_helpers.js"
$localServerVersionHelpersSource = Join-Path $PSScriptRoot "src/server_version_helpers.ts"
$localServerAccountHelpers = Join-Path $PSScriptRoot "server_account_helpers.js"
$localServerAccountHelpersSource = Join-Path $PSScriptRoot "src/server_account_helpers.ts"
$localServerAccountAuthRoutes = Join-Path $PSScriptRoot "server_account_auth_routes.js"
$localServerAccountAuthRoutesSource = Join-Path $PSScriptRoot "src/server_account_auth_routes.ts"
$localServerAccountSessionHelpers = Join-Path $PSScriptRoot "server_account_session_helpers.js"
$localServerAccountSessionHelpersSource = Join-Path $PSScriptRoot "src/server_account_session_helpers.ts"
$localServerAdminLookupRoutes = Join-Path $PSScriptRoot "server_admin_lookup_routes.js"
$localServerAdminLookupRoutesSource = Join-Path $PSScriptRoot "src/server_admin_lookup_routes.ts"
$localServerFriendRoutes = Join-Path $PSScriptRoot "server_friend_routes.js"
$localServerFriendRoutesSource = Join-Path $PSScriptRoot "src/server_friend_routes.ts"
$localServerTradeRoutes = Join-Path $PSScriptRoot "server_trade_routes.js"
$localServerTradeRoutesSource = Join-Path $PSScriptRoot "src/server_trade_routes.ts"
$localServerInventoryEconomyRoutes = Join-Path $PSScriptRoot "server_inventory_economy_routes.js"
$localServerInventoryEconomyRoutesSource = Join-Path $PSScriptRoot "src/server_inventory_economy_routes.ts"
$localServerPersistenceHelpers = Join-Path $PSScriptRoot "server_persistence_helpers.js"
$localServerPersistenceHelpersSource = Join-Path $PSScriptRoot "src/server_persistence_helpers.ts"
$localServerPlayerStateHelpers = Join-Path $PSScriptRoot "server_player_state_helpers.js"
$localServerPlayerStateHelpersSource = Join-Path $PSScriptRoot "src/server_player_state_helpers.ts"
$localServerWorldStateHelpers = Join-Path $PSScriptRoot "server_world_state_helpers.js"
$localServerWorldStateHelpersSource = Join-Path $PSScriptRoot "src/server_world_state_helpers.ts"
$localServerMessageRouterHelpers = Join-Path $PSScriptRoot "server_message_router_helpers.js"
$localServerMessageRouterHelpersSource = Join-Path $PSScriptRoot "src/server_message_router_helpers.ts"
$localServerBotRateLimitHelpers = Join-Path $PSScriptRoot "server_bot_rate_limit_helpers.js"
$localServerBotRateLimitHelpersSource = Join-Path $PSScriptRoot "src/server_bot_rate_limit_helpers.ts"
$localServerInventoryTransactionHelpers = Join-Path $PSScriptRoot "server_inventory_transaction_helpers.js"
$localServerInventoryTransactionHelpersSource = Join-Path $PSScriptRoot "src/server_inventory_transaction_helpers.ts"
$localServerWorldInteractionPayloadHelpers = Join-Path $PSScriptRoot "server_world_interaction_payload_helpers.js"
$localServerWorldInteractionPayloadHelpersSource = Join-Path $PSScriptRoot "src/server_world_interaction_payload_helpers.ts"
$localServerSocketDeliveryHelpers = Join-Path $PSScriptRoot "server_socket_delivery_helpers.js"
$localServerSocketDeliveryHelpersSource = Join-Path $PSScriptRoot "src/server_socket_delivery_helpers.ts"
$localServerPunishmentHelpers = Join-Path $PSScriptRoot "server_punishment_helpers.js"
$localServerPunishmentHelpersSource = Join-Path $PSScriptRoot "src/server_punishment_helpers.ts"
$localServerPhase6Helpers = Join-Path $PSScriptRoot "server_phase6_helpers.js"
$localServerPhase6HelpersSource = Join-Path $PSScriptRoot "src/server_phase6_helpers.ts"
$localServerPhase7Dispatcher = Join-Path $PSScriptRoot "server_phase7_dispatcher.js"
$localServerPhase7DispatcherSource = Join-Path $PSScriptRoot "src/server_phase7_dispatcher.ts"
$localServerPhase8PlayerSessionRoutes = Join-Path $PSScriptRoot "server_phase8_player_session_routes.js"
$localServerPhase8PlayerSessionRoutesSource = Join-Path $PSScriptRoot "src/server_phase8_player_session_routes.ts"
$localServerPhase8WorldActionRoutes = Join-Path $PSScriptRoot "server_phase8_world_action_routes.js"
$localServerPhase8WorldActionRoutesSource = Join-Path $PSScriptRoot "src/server_phase8_world_action_routes.ts"
$localServerPhase8FinalRoutes = Join-Path $PSScriptRoot "server_phase8_final_routes.js"
$localServerPhase8FinalRoutesSource = Join-Path $PSScriptRoot "src/server_phase8_final_routes.ts"
$localServerPhase9RemainingRoutes = Join-Path $PSScriptRoot "server_phase9_remaining_routes.js"
$localServerPhase9RemainingRoutesSource = Join-Path $PSScriptRoot "src/server_phase9_remaining_routes.ts"
$localServerPhase11aRuntime = Join-Path $PSScriptRoot "server_phase11a_runtime.js"
$localServerPhase11aRuntimeSource = Join-Path $PSScriptRoot "src/server_phase11a_runtime.ts"
$localServerPhase11bLifecycle = Join-Path $PSScriptRoot "server_phase11b_lifecycle.js"
$localServerPhase11bLifecycleSource = Join-Path $PSScriptRoot "src/server_phase11b_lifecycle.ts"
$localServerPhase11cTrustedMovement = Join-Path $PSScriptRoot "server_phase11c_trusted_movement.js"
$localServerPhase11cTrustedMovementSource = Join-Path $PSScriptRoot "src/server_phase11c_trusted_movement.ts"
$localServerPhase11dStandardMovement = Join-Path $PSScriptRoot "server_phase11d_standard_movement.js"
$localServerPhase11dStandardMovementSource = Join-Path $PSScriptRoot "src/server_phase11d_standard_movement.ts"
$localServerItemDatabase = Join-Path $PSScriptRoot "server_item_database.js"
$localServerItemDatabaseSource = Join-Path $PSScriptRoot "src/server_item_database.ts"
$localServerItemAtlasDb = Join-Path $PSScriptRoot "item_atlas_db.js"
$localServerItemAtlasDbSource = Join-Path $PSScriptRoot "src/item_atlas_db.ts"
$localAtlasItemDefinition = Join-Path $PSScriptRoot "atlas_item_definition.js"
$localAtlasItemDefinitionSource = Join-Path $PSScriptRoot "src/atlas_item_definition.ts"
$localRepoRoot = Resolve-ClientRoot
$localClientItemDatabase = Join-Path $localRepoRoot "Scripts/item_database.gd"
$localClientItemAtlasDb = Join-Path $localRepoRoot "Scripts/ItemAtlasDB.gd"
$localAtlasItemsDatabase = Join-Path $localRepoRoot "Data/items/atlas_items.json"
$localDeveloperPanelUi = Join-Path $localRepoRoot "Scripts/developer_panel_ui.gd"
$localNetworkManager = Join-Path $localRepoRoot "Scripts/network_manager.gd"
$localWorldScript = Join-Path $localRepoRoot "Scripts/world.gd"
$localBlockManager = Join-Path $localRepoRoot "Scripts/block_manager.gd"
$localWorldTilemapRenderer = Join-Path $localRepoRoot "Scripts/world_tilemap_renderer.gd"
$localItemGameplayManager = Join-Path $localRepoRoot "Scripts/item_gameplay_manager.gd"
$localDropManager = Join-Path $localRepoRoot "Scripts/drop_manager.gd"
$localSaveManager = Join-Path $localRepoRoot "Scripts/save_manager.gd"
$localWorldStateSyncManager = Join-Path $localRepoRoot "Scripts/world_state_sync_manager.gd"
$localProjectGodot = Join-Path $localRepoRoot "project.godot"
$localPostgresStore = Join-Path $PSScriptRoot "postgres_store.js"
$localPostgresStoreSource = Join-Path $PSScriptRoot "src/postgres_store.ts"
$localRedisStore = Join-Path $PSScriptRoot "redis_store.js"
$localRedisStoreSource = Join-Path $PSScriptRoot "src/redis_store.ts"
$localEcosystem = Join-Path $PSScriptRoot "ecosystem.config.js"
$localOpsDashboardServer = Join-Path $PSScriptRoot "ops_dashboard_server.js"
$localOpsDashboardEcosystem = Join-Path $PSScriptRoot "ecosystem.ops.config.js"
$localOpsDashboardPublic = Join-Path $PSScriptRoot "ops_dashboard_public"
$localOpsDashboardEnvExample = Join-Path $PSScriptRoot ".env.ops.example"
$localPackage = Join-Path $PSScriptRoot "package.json"
$localPackageLock = Join-Path $PSScriptRoot "package-lock.json"
$localTsConfig = Join-Path $PSScriptRoot "tsconfig.json"
$localItemDataBuildConfig = Join-Path $PSScriptRoot "tsconfig.item-data.json"
$localRedisStoreBuildConfig = Join-Path $PSScriptRoot "tsconfig.redis-store.json"
$localPostgresStoreBuildConfig = Join-Path $PSScriptRoot "tsconfig.postgres-store.json"
$localServerRuntimeStatsBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-runtime-stats.json"
$localServerCrashDetailsBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-crash-details.json"
$localServerEnvConfigBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-env-config.json"
$localServerHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-helpers.json"
$localServerPersistenceHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-persistence-helpers.json"
$localServerPlayerStateHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-player-state-helpers.json"
$localServerWorldStateHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-world-state-helpers.json"
$localServerMessageRouterHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-message-router-helpers.json"
$localServerBotRateLimitHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-bot-rate-limit-helpers.json"
$localServerInventoryTransactionHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-inventory-transaction-helpers.json"
$localServerWorldInteractionPayloadHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-world-interaction-payload-helpers.json"
$localServerSocketDeliveryHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-socket-delivery-helpers.json"
$localServerPunishmentHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-punishment-helpers.json"
$localServerPhase6HelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-phase6-helpers.json"
$localServerPhase7DispatcherBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-phase7-dispatcher.json"
$localServerPhase8PlayerSessionRoutesBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-phase8-player-session-routes.json"
$localServerPhase8WorldActionRoutesBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-phase8-world-action-routes.json"
$localServerPhase8FinalRoutesBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-phase8-final-routes.json"
$localServerPhase9RemainingRoutesBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-phase9-remaining-routes.json"
$localServerPhase11aRuntimeBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-phase11a-runtime.json"
$localServerPhase11bLifecycleBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-phase11b-lifecycle.json"
$localServerPhase11cTrustedMovementBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-phase11c-trusted-movement.json"
$localServerPhase11dStandardMovementBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-phase11d-standard-movement.json"
$localServerEntryBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-entry.json"
$localServerAccountAuthRoutesBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-account-auth-routes.json"
$localServerAccountSessionHelpersBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-account-session-helpers.json"
$localServerAdminLookupRoutesBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-admin-lookup-routes.json"
$localServerFriendRoutesBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-friend-routes.json"
$localServerTradeRoutesBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-trade-routes.json"
$localServerInventoryEconomyRoutesBuildConfig = Join-Path $PSScriptRoot "tsconfig.server-inventory-economy-routes.json"
$localTypesDir = Join-Path $PSScriptRoot "types"
$localSmoke = Join-Path $PSScriptRoot "smoke_postdeploy.ps1"
$localPostgresSchema = Join-Path $PSScriptRoot "docs/postgres_security_foundation.sql"
$localOpsDashboardDoc = Join-Path $PSScriptRoot "docs/ops_dashboard.md"
$localBackendPersistenceRules = Resolve-RepoDoc "backend_persistence_rules.md"
$localCodexHandoffStatus = Resolve-RepoDoc "codex_handoff_status.md"
$localProductionBackendWiring = Resolve-RepoDoc "production_backend_wiring.md"
$localScaleReadinessDoc = Resolve-RepoDoc "scale_readiness_10k.md"
$localPostgresBackup = Join-Path $PSScriptRoot "scripts/postgres_backup.sh"
$localPostgresRestoreCheck = Join-Path $PSScriptRoot "scripts/postgres_restore_check.sh"
$localPostgresMaintenance = Join-Path $PSScriptRoot "scripts/postgres_maintenance.sh"
$localRollbackPlan = Join-Path $PSScriptRoot "scripts/rollback_plan.js"
$localRollbackApply = Join-Path $PSScriptRoot "scripts/rollback_apply.js"
$localWorldRecoverAtCrash = Join-Path $PSScriptRoot "scripts/world_recover_at_crash.js"
$localWorldSnapshotTool = Join-Path $PSScriptRoot "scripts/world_snapshot_tool.js"
$localStagedLoadTest = Join-Path $PSScriptRoot "scripts/staged_ws_load_test.js"
$localLoadTokenProvisioner = Join-Path $PSScriptRoot "scripts/provision_load_tokens.js"
$localMultiInstanceWorldCapSmoke = Join-Path $PSScriptRoot "scripts/multi_instance_world_cap_smoke.js"
$localMultiplayerScalingSmoke = Join-Path $PSScriptRoot "scripts/multiplayer_scaling_smoke.js"
$localRouteStagingSetup = Join-Path $PSScriptRoot "scripts/start_route_staging_instances.sh"
$localRouteProductionSetup = Join-Path $PSScriptRoot "scripts/start_route_production_instances.sh"
$localPublicWorldRouteSmoke = Join-Path $PSScriptRoot "scripts/public_world_route_smoke.js"
$localOpsDashboardGitDeploy = Join-Path $PSScriptRoot "scripts/ops_dashboard_git_deploy.sh"
$localItemInstanceWiringCheck = Join-Path $PSScriptRoot "scripts/check_item_instance_wiring.js"
$localTransactionLedgerWiringCheck = Join-Path $PSScriptRoot "scripts/check_transaction_ledger_wiring.js"
$localGemLedgerWiringCheck = Join-Path $PSScriptRoot "scripts/check_gem_ledger_wiring.js"
$localWorldJournalWiringCheck = Join-Path $PSScriptRoot "scripts/check_world_journal_wiring.js"
$localRollbackWiringCheck = Join-Path $PSScriptRoot "scripts/check_rollback_wiring.js"
$localServerValidationWiringCheck = Join-Path $PSScriptRoot "scripts/check_server_validation_wiring.js"
$localAntiDupeLockingCheck = Join-Path $PSScriptRoot "scripts/check_anti_dupe_locking_wiring.js"
$localAdminActionWiringCheck = Join-Path $PSScriptRoot "scripts/check_admin_action_wiring.js"
$localAccountSessionSecurityWiringCheck = Join-Path $PSScriptRoot "scripts/check_account_session_security_wiring.js"
$localBotRateLimitWiringCheck = Join-Path $PSScriptRoot "scripts/check_bot_rate_limit_wiring.js"
$localIntegrityHashWiringCheck = Join-Path $PSScriptRoot "scripts/check_integrity_hash_wiring.js"
$localMonitoringDashboardWiringCheck = Join-Path $PSScriptRoot "scripts/check_monitoring_dashboard_wiring.js"
$localScaleReadinessWiringCheck = Join-Path $PSScriptRoot "scripts/check_scale_readiness_wiring.js"
$localJoinSpawnSafetyCheck = Join-Path $PSScriptRoot "scripts/check_join_spawn_safety.js"
$localItemDataCheck = Join-Path $PSScriptRoot "scripts/check_item_data_build.js"
$localItemDataBuildSync = Join-Path $PSScriptRoot "scripts/sync_item_data_build.js"
$localRedisStoreCheck = Join-Path $PSScriptRoot "scripts/check_redis_store_build.js"
$localRedisStoreBuildSync = Join-Path $PSScriptRoot "scripts/sync_redis_store_build.js"
$localPostgresStoreCheck = Join-Path $PSScriptRoot "scripts/check_postgres_store_build.js"
$localPostgresStoreBuildSync = Join-Path $PSScriptRoot "scripts/sync_postgres_store_build.js"
$localServerRuntimeStatsCheck = Join-Path $PSScriptRoot "scripts/check_server_runtime_stats_build.js"
$localServerRuntimeStatsBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_runtime_stats_build.js"
$localServerCrashDetailsCheck = Join-Path $PSScriptRoot "scripts/check_server_crash_details_build.js"
$localServerCrashDetailsBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_crash_details_build.js"
$localServerEnvConfigCheck = Join-Path $PSScriptRoot "scripts/check_server_env_config_build.js"
$localServerEnvConfigBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_env_config_build.js"
$localServerHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_helpers_build.js"
$localServerHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_helpers_build.js"
$localServerPersistenceHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_persistence_helpers_build.js"
$localServerPersistenceHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_persistence_helpers_build.js"
$localServerPlayerStateHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_player_state_helpers_build.js"
$localServerPlayerStateHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_player_state_helpers_build.js"
$localServerWorldStateHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_world_state_helpers_build.js"
$localServerWorldStateHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_world_state_helpers_build.js"
$localServerMessageRouterHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_message_router_helpers_build.js"
$localServerMessageRouterHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_message_router_helpers_build.js"
$localServerBotRateLimitHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_bot_rate_limit_helpers_build.js"
$localServerBotRateLimitHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_bot_rate_limit_helpers_build.js"
$localServerInventoryTransactionHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_inventory_transaction_helpers_build.js"
$localServerInventoryTransactionHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_inventory_transaction_helpers_build.js"
$localServerWorldInteractionPayloadHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_world_interaction_payload_helpers_build.js"
$localServerWorldInteractionPayloadHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_world_interaction_payload_helpers_build.js"
$localServerSocketDeliveryHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_socket_delivery_helpers_build.js"
$localServerSocketDeliveryHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_socket_delivery_helpers_build.js"
$localServerPunishmentHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_punishment_helpers_build.js"
$localServerPunishmentHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_punishment_helpers_build.js"
$localServerPhase6HelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_phase6_helpers_build.js"
$localServerPhase6HelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_phase6_helpers_build.js"
$localServerPhase7DispatcherCheck = Join-Path $PSScriptRoot "scripts/check_server_phase7_dispatcher_build.js"
$localServerPhase7DispatcherBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_phase7_dispatcher_build.js"
$localServerPhase8PlayerSessionRoutesCheck = Join-Path $PSScriptRoot "scripts/check_server_phase8_player_session_routes_build.js"
$localServerPhase8PlayerSessionRoutesBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_phase8_player_session_routes_build.js"
$localServerPhase8WorldActionRoutesCheck = Join-Path $PSScriptRoot "scripts/check_server_phase8_world_action_routes_build.js"
$localServerPhase8WorldActionRoutesBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_phase8_world_action_routes_build.js"
$localServerPhase8FinalRoutesCheck = Join-Path $PSScriptRoot "scripts/check_server_phase8_final_routes_build.js"
$localServerPhase8FinalRoutesBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_phase8_final_routes_build.js"
$localServerPhase9RemainingRoutesCheck = Join-Path $PSScriptRoot "scripts/check_server_phase9_remaining_routes_build.js"
$localServerPhase9RemainingRoutesBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_phase9_remaining_routes_build.js"
$localServerAccountAuthRoutesCheck = Join-Path $PSScriptRoot "scripts/check_server_account_auth_routes_build.js"
$localServerAccountAuthRoutesBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_account_auth_routes_build.js"
$localServerAccountSessionHelpersCheck = Join-Path $PSScriptRoot "scripts/check_server_account_session_helpers_build.js"
$localServerAccountSessionHelpersBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_account_session_helpers_build.js"
$localServerAdminLookupRoutesCheck = Join-Path $PSScriptRoot "scripts/check_server_admin_lookup_routes_build.js"
$localServerAdminLookupRoutesBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_admin_lookup_routes_build.js"
$localServerFriendRoutesCheck = Join-Path $PSScriptRoot "scripts/check_server_friend_routes_build.js"
$localServerFriendRoutesBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_friend_routes_build.js"
$localServerTradeRoutesCheck = Join-Path $PSScriptRoot "scripts/check_server_trade_routes_build.js"
$localServerTradeRoutesBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_trade_routes_build.js"
$localServerInventoryEconomyRoutesCheck = Join-Path $PSScriptRoot "scripts/check_server_inventory_economy_routes_build.js"
$localServerInventoryEconomyRoutesBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_inventory_economy_routes_build.js"
$localServerPhase10OwnershipCheck = Join-Path $PSScriptRoot "scripts/check_server_phase10_typescript_ownership.js"
$localServerPhase11aRuntimeCheck = Join-Path $PSScriptRoot "scripts/check_server_phase11a_runtime_build.js"
$localServerPhase11aRuntimeBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_phase11a_runtime_build.js"
$localServerPhase11bLifecycleCheck = Join-Path $PSScriptRoot "scripts/check_server_phase11b_lifecycle_build.js"
$localServerPhase11bLifecycleBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_phase11b_lifecycle_build.js"
$localServerPhase11cTrustedMovementCheck = Join-Path $PSScriptRoot "scripts/check_server_phase11c_trusted_movement_build.js"
$localServerPhase11cTrustedMovementBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_phase11c_trusted_movement_build.js"
$localServerPhase11dStandardMovementCheck = Join-Path $PSScriptRoot "scripts/check_server_phase11d_standard_movement_build.js"
$localServerPhase11dStandardMovementBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_phase11d_standard_movement_build.js"
$localServerEntryCheck = Join-Path $PSScriptRoot "scripts/check_server_phase11e_to_11j_entry_build.js"
$localServerEntryBuildSync = Join-Path $PSScriptRoot "scripts/sync_server_entry_build.js"
$localPacketContractsCheck = Join-Path $PSScriptRoot "scripts/check_packet_contracts.js"
$localPacketContractsBuildSync = Join-Path $PSScriptRoot "scripts/sync_packet_contracts_build.js"
$localDropContractsCheck = Join-Path $PSScriptRoot "scripts/check_drop_contracts.js"
$localDropContractsBuildSync = Join-Path $PSScriptRoot "scripts/sync_drop_contracts_build.js"
$localInventoryContractsCheck = Join-Path $PSScriptRoot "scripts/check_inventory_contracts.js"
$localInventoryContractsBuildSync = Join-Path $PSScriptRoot "scripts/sync_inventory_contracts_build.js"
$localPostgresContractsCheck = Join-Path $PSScriptRoot "scripts/check_postgres_contracts.js"
$localPostgresContractsBuildSync = Join-Path $PSScriptRoot "scripts/sync_postgres_contracts_build.js"
$localIntegrityHashAudit = Join-Path $PSScriptRoot "scripts/integrity_hash_audit.js"
$localRemovedLegacyItemsCleanup = Join-Path $PSScriptRoot "scripts/cleanup_removed_legacy_items.js"
$localOpsDashboardTokenHelper = Join-Path $PSScriptRoot "scripts/generate_ops_dashboard_token_hash.js"

function Assert-VersionValue {
  param(
    [string]$Name,
    [string]$Value
  )

  if (-not $Value) {
    return
  }

  if ($Value -notmatch "^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$") {
    throw "$Name must look like 1.2.3, optionally with a prerelease/build suffix."
  }
}

function Get-LocalClientVersion {
  $candidateRoots = @()
  if ($env:PIXELMANIA_CLIENT_ROOT) {
    $candidateRoots += $env:PIXELMANIA_CLIENT_ROOT
  }
  $candidateRoots += Split-Path -Parent $PSScriptRoot
  $candidateRoots += Join-Path (Split-Path -Parent $PSScriptRoot) "pixel-mania"
  $candidateRoots += (Get-Location).Path

  $localNetworkManager = ""
  foreach ($candidateRoot in $candidateRoots) {
    if (-not $candidateRoot) {
      continue
    }

    $candidatePath = Join-Path $candidateRoot "Scripts/network_manager.gd"
    if (Test-Path $candidatePath) {
      $localNetworkManager = $candidatePath
      break
    }
  }

  if (-not $localNetworkManager) {
    throw "Could not find Scripts/network_manager.gd. Run from the Godot repo root, pass -ClientVersion, or set PIXELMANIA_CLIENT_ROOT."
  }

  $content = Get-Content -LiteralPath $localNetworkManager -Raw
  $match = [regex]::Match($content, 'const\s+CLIENT_VERSION\s*:=\s*"([^"]+)"')
  if (-not $match.Success) {
    throw "Could not find CLIENT_VERSION in $localNetworkManager"
  }

  return $match.Groups[1].Value
}

function ConvertTo-ShellLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "'\''") + "'"
}

if ($ForceClientUpdate) {
  if (-not $ClientVersion) {
    $ClientVersion = Get-LocalClientVersion
  }
  if (-not $MinClientVersion) {
    $MinClientVersion = $ClientVersion
  }
}

if ($MinClientVersion -and -not $ClientVersion) {
  $ClientVersion = $MinClientVersion
}

Assert-VersionValue "ClientVersion" $ClientVersion
Assert-VersionValue "MinClientVersion" $MinClientVersion

if (-not (Test-Path $localBackend)) {
  throw "Missing file: $localBackend"
}
if (-not (Test-Path $localBackendSource)) {
  throw "Missing file: $localBackendSource"
}
if (-not (Test-Path $localPacketContracts)) {
  throw "Missing file: $localPacketContracts"
}
if (-not (Test-Path $localPacketContractsSource)) {
  throw "Missing file: $localPacketContractsSource"
}
if (-not (Test-Path $localPacketContractsBuildConfig)) {
  throw "Missing file: $localPacketContractsBuildConfig"
}
if (-not (Test-Path $localDropContracts)) {
  throw "Missing file: $localDropContracts"
}
if (-not (Test-Path $localDropContractsSource)) {
  throw "Missing file: $localDropContractsSource"
}
if (-not (Test-Path $localDropContractsBuildConfig)) {
  throw "Missing file: $localDropContractsBuildConfig"
}
if (-not (Test-Path $localInventoryContracts)) {
  throw "Missing file: $localInventoryContracts"
}
if (-not (Test-Path $localInventoryContractsSource)) {
  throw "Missing file: $localInventoryContractsSource"
}
if (-not (Test-Path $localInventoryContractsBuildConfig)) {
  throw "Missing file: $localInventoryContractsBuildConfig"
}
if (-not (Test-Path $localPostgresContracts)) {
  throw "Missing file: $localPostgresContracts"
}
if (-not (Test-Path $localPostgresContractsSource)) {
  throw "Missing file: $localPostgresContractsSource"
}
if (-not (Test-Path $localPostgresContractsBuildConfig)) {
  throw "Missing file: $localPostgresContractsBuildConfig"
}
if (-not (Test-Path $localDeployHelper)) {
  throw "Missing file: $localDeployHelper"
}
if (-not (Test-Path $localEnvExample)) {
  throw "Missing file: $localEnvExample"
}
if (-not (Test-Path $localServerRuntimeStats)) {
  throw "Missing file: $localServerRuntimeStats"
}
if (-not (Test-Path $localServerRuntimeStatsSource)) {
  throw "Missing file: $localServerRuntimeStatsSource"
}
if (-not (Test-Path $localServerCrashDetails)) {
  throw "Missing file: $localServerCrashDetails"
}
if (-not (Test-Path $localServerCrashDetailsSource)) {
  throw "Missing file: $localServerCrashDetailsSource"
}
if (-not (Test-Path $localServerEnvConfig)) {
  throw "Missing file: $localServerEnvConfig"
}
if (-not (Test-Path $localServerEnvConfigSource)) {
  throw "Missing file: $localServerEnvConfigSource"
}
if (-not (Test-Path $localServerIdentityHelpers)) {
  throw "Missing file: $localServerIdentityHelpers"
}
if (-not (Test-Path $localServerIdentityHelpersSource)) {
  throw "Missing file: $localServerIdentityHelpersSource"
}
if (-not (Test-Path $localServerTextHelpers)) {
  throw "Missing file: $localServerTextHelpers"
}
if (-not (Test-Path $localServerTextHelpersSource)) {
  throw "Missing file: $localServerTextHelpersSource"
}
if (-not (Test-Path $localServerVersionHelpers)) {
  throw "Missing file: $localServerVersionHelpers"
}
if (-not (Test-Path $localServerVersionHelpersSource)) {
  throw "Missing file: $localServerVersionHelpersSource"
}
if (-not (Test-Path $localServerAccountHelpers)) {
  throw "Missing file: $localServerAccountHelpers"
}
if (-not (Test-Path $localServerAccountHelpersSource)) {
  throw "Missing file: $localServerAccountHelpersSource"
}
if (-not (Test-Path $localServerAccountAuthRoutes)) {
  throw "Missing file: $localServerAccountAuthRoutes"
}
if (-not (Test-Path $localServerAccountAuthRoutesSource)) {
  throw "Missing file: $localServerAccountAuthRoutesSource"
}
if (-not (Test-Path $localServerAccountSessionHelpers)) {
  throw "Missing file: $localServerAccountSessionHelpers"
}
if (-not (Test-Path $localServerAccountSessionHelpersSource)) {
  throw "Missing file: $localServerAccountSessionHelpersSource"
}
if (-not (Test-Path $localServerAdminLookupRoutes)) {
  throw "Missing file: $localServerAdminLookupRoutes"
}
if (-not (Test-Path $localServerAdminLookupRoutesSource)) {
  throw "Missing file: $localServerAdminLookupRoutesSource"
}
if (-not (Test-Path $localServerFriendRoutes)) {
  throw "Missing file: $localServerFriendRoutes"
}
if (-not (Test-Path $localServerFriendRoutesSource)) {
  throw "Missing file: $localServerFriendRoutesSource"
}
if (-not (Test-Path $localServerTradeRoutes)) {
  throw "Missing file: $localServerTradeRoutes"
}
if (-not (Test-Path $localServerTradeRoutesSource)) {
  throw "Missing file: $localServerTradeRoutesSource"
}
if (-not (Test-Path $localServerInventoryEconomyRoutes)) {
  throw "Missing file: $localServerInventoryEconomyRoutes"
}
if (-not (Test-Path $localServerInventoryEconomyRoutesSource)) {
  throw "Missing file: $localServerInventoryEconomyRoutesSource"
}
if (-not (Test-Path $localServerPersistenceHelpers)) {
  throw "Missing file: $localServerPersistenceHelpers"
}
if (-not (Test-Path $localServerPersistenceHelpersSource)) {
  throw "Missing file: $localServerPersistenceHelpersSource"
}
if (-not (Test-Path $localServerPlayerStateHelpers)) {
  throw "Missing file: $localServerPlayerStateHelpers"
}
if (-not (Test-Path $localServerPlayerStateHelpersSource)) {
  throw "Missing file: $localServerPlayerStateHelpersSource"
}
if (-not (Test-Path $localServerWorldStateHelpers)) {
  throw "Missing file: $localServerWorldStateHelpers"
}
if (-not (Test-Path $localServerWorldStateHelpersSource)) {
  throw "Missing file: $localServerWorldStateHelpersSource"
}
if (-not (Test-Path $localServerMessageRouterHelpers)) {
  throw "Missing file: $localServerMessageRouterHelpers"
}
if (-not (Test-Path $localServerMessageRouterHelpersSource)) {
  throw "Missing file: $localServerMessageRouterHelpersSource"
}
if (-not (Test-Path $localServerBotRateLimitHelpers)) {
  throw "Missing file: $localServerBotRateLimitHelpers"
}
if (-not (Test-Path $localServerBotRateLimitHelpersSource)) {
  throw "Missing file: $localServerBotRateLimitHelpersSource"
}
if (-not (Test-Path $localServerInventoryTransactionHelpers)) {
  throw "Missing file: $localServerInventoryTransactionHelpers"
}
if (-not (Test-Path $localServerInventoryTransactionHelpersSource)) {
  throw "Missing file: $localServerInventoryTransactionHelpersSource"
}
if (-not (Test-Path $localServerWorldInteractionPayloadHelpers)) {
  throw "Missing file: $localServerWorldInteractionPayloadHelpers"
}
if (-not (Test-Path $localServerWorldInteractionPayloadHelpersSource)) {
  throw "Missing file: $localServerWorldInteractionPayloadHelpersSource"
}
if (-not (Test-Path $localServerSocketDeliveryHelpers)) {
  throw "Missing file: $localServerSocketDeliveryHelpers"
}
if (-not (Test-Path $localServerSocketDeliveryHelpersSource)) {
  throw "Missing file: $localServerSocketDeliveryHelpersSource"
}
if (-not (Test-Path $localServerPunishmentHelpers)) {
  throw "Missing file: $localServerPunishmentHelpers"
}
if (-not (Test-Path $localServerPunishmentHelpersSource)) {
  throw "Missing file: $localServerPunishmentHelpersSource"
}
if (-not (Test-Path $localServerPhase6Helpers)) {
  throw "Missing file: $localServerPhase6Helpers"
}
if (-not (Test-Path $localServerPhase6HelpersSource)) {
  throw "Missing file: $localServerPhase6HelpersSource"
}
if (-not (Test-Path $localServerPhase7Dispatcher)) {
  throw "Missing file: $localServerPhase7Dispatcher"
}
if (-not (Test-Path $localServerPhase7DispatcherSource)) {
  throw "Missing file: $localServerPhase7DispatcherSource"
}
if (-not (Test-Path $localServerPhase8PlayerSessionRoutes)) {
  throw "Missing file: $localServerPhase8PlayerSessionRoutes"
}
if (-not (Test-Path $localServerPhase8PlayerSessionRoutesSource)) {
  throw "Missing file: $localServerPhase8PlayerSessionRoutesSource"
}
if (-not (Test-Path $localServerPhase8WorldActionRoutes)) {
  throw "Missing file: $localServerPhase8WorldActionRoutes"
}
if (-not (Test-Path $localServerPhase8WorldActionRoutesSource)) {
  throw "Missing file: $localServerPhase8WorldActionRoutesSource"
}
if (-not (Test-Path $localServerPhase8FinalRoutes)) {
  throw "Missing file: $localServerPhase8FinalRoutes"
}
if (-not (Test-Path $localServerPhase8FinalRoutesSource)) {
  throw "Missing file: $localServerPhase8FinalRoutesSource"
}
if (-not (Test-Path $localServerPhase9RemainingRoutes)) {
  throw "Missing file: $localServerPhase9RemainingRoutes"
}
if (-not (Test-Path $localServerPhase9RemainingRoutesSource)) {
  throw "Missing file: $localServerPhase9RemainingRoutesSource"
}
if (-not (Test-Path $localServerPhase11aRuntime)) {
  throw "Missing file: $localServerPhase11aRuntime"
}
if (-not (Test-Path $localServerPhase11aRuntimeSource)) {
  throw "Missing file: $localServerPhase11aRuntimeSource"
}
if (-not (Test-Path $localServerPhase11bLifecycle)) {
  throw "Missing file: $localServerPhase11bLifecycle"
}
if (-not (Test-Path $localServerPhase11bLifecycleSource)) {
  throw "Missing file: $localServerPhase11bLifecycleSource"
}
if (-not (Test-Path $localServerPhase11cTrustedMovement)) {
  throw "Missing file: $localServerPhase11cTrustedMovement"
}
if (-not (Test-Path $localServerPhase11cTrustedMovementSource)) {
  throw "Missing file: $localServerPhase11cTrustedMovementSource"
}
if (-not (Test-Path $localServerPhase11dStandardMovement)) {
  throw "Missing file: $localServerPhase11dStandardMovement"
}
if (-not (Test-Path $localServerPhase11dStandardMovementSource)) {
  throw "Missing file: $localServerPhase11dStandardMovementSource"
}
if (-not (Test-Path $localServerItemDatabase)) {
  throw "Missing file: $localServerItemDatabase"
}
if (-not (Test-Path $localServerItemDatabaseSource)) {
  throw "Missing file: $localServerItemDatabaseSource"
}
if (-not (Test-Path $localServerItemAtlasDb)) {
  throw "Missing file: $localServerItemAtlasDb"
}
if (-not (Test-Path $localServerItemAtlasDbSource)) {
  throw "Missing file: $localServerItemAtlasDbSource"
}
if (-not (Test-Path $localAtlasItemDefinition)) {
  throw "Missing file: $localAtlasItemDefinition"
}
if (-not (Test-Path $localAtlasItemDefinitionSource)) {
  throw "Missing file: $localAtlasItemDefinitionSource"
}
if (-not (Test-Path $localClientItemDatabase)) {
  throw "Missing file: $localClientItemDatabase"
}
if (-not (Test-Path $localClientItemAtlasDb)) {
  throw "Missing file: $localClientItemAtlasDb"
}
if (-not (Test-Path $localAtlasItemsDatabase)) {
  throw "Missing file: $localAtlasItemsDatabase"
}
if (-not (Test-Path $localDeveloperPanelUi)) {
  throw "Missing file: $localDeveloperPanelUi"
}
if (-not (Test-Path $localNetworkManager)) {
  throw "Missing file: $localNetworkManager"
}
if (-not (Test-Path $localWorldScript)) {
  throw "Missing file: $localWorldScript"
}
if (-not (Test-Path $localBlockManager)) {
  throw "Missing file: $localBlockManager"
}
if (-not (Test-Path $localWorldTilemapRenderer)) {
  throw "Missing file: $localWorldTilemapRenderer"
}
if (-not (Test-Path $localItemGameplayManager)) {
  throw "Missing file: $localItemGameplayManager"
}
if (-not (Test-Path $localDropManager)) {
  throw "Missing file: $localDropManager"
}
if (-not (Test-Path $localSaveManager)) {
  throw "Missing file: $localSaveManager"
}
if (-not (Test-Path $localWorldStateSyncManager)) {
  throw "Missing file: $localWorldStateSyncManager"
}
if (-not (Test-Path $localPostgresStore)) {
  throw "Missing file: $localPostgresStore"
}
if (-not (Test-Path $localPostgresStoreSource)) {
  throw "Missing file: $localPostgresStoreSource"
}
if (-not (Test-Path $localRedisStore)) {
  throw "Missing file: $localRedisStore"
}
if (-not (Test-Path $localRedisStoreSource)) {
  throw "Missing file: $localRedisStoreSource"
}
if (-not (Test-Path $localEcosystem)) {
  throw "Missing file: $localEcosystem"
}
if (-not (Test-Path $localOpsDashboardServer)) {
  throw "Missing file: $localOpsDashboardServer"
}
if (-not (Test-Path $localOpsDashboardEcosystem)) {
  throw "Missing file: $localOpsDashboardEcosystem"
}
if (-not (Test-Path $localOpsDashboardPublic)) {
  throw "Missing directory: $localOpsDashboardPublic"
}
if (-not (Test-Path $localOpsDashboardEnvExample)) {
  throw "Missing file: $localOpsDashboardEnvExample"
}
if (-not (Test-Path $localPackage)) {
  throw "Missing file: $localPackage"
}
if (-not (Test-Path $localPackageLock)) {
  throw "Missing file: $localPackageLock"
}
if (-not (Test-Path $localTsConfig)) {
  throw "Missing file: $localTsConfig"
}
if (-not (Test-Path $localItemDataBuildConfig)) {
  throw "Missing file: $localItemDataBuildConfig"
}
if (-not (Test-Path $localRedisStoreBuildConfig)) {
  throw "Missing file: $localRedisStoreBuildConfig"
}
if (-not (Test-Path $localPostgresStoreBuildConfig)) {
  throw "Missing file: $localPostgresStoreBuildConfig"
}
if (-not (Test-Path $localServerRuntimeStatsBuildConfig)) {
  throw "Missing file: $localServerRuntimeStatsBuildConfig"
}
if (-not (Test-Path $localServerCrashDetailsBuildConfig)) {
  throw "Missing file: $localServerCrashDetailsBuildConfig"
}
if (-not (Test-Path $localServerEnvConfigBuildConfig)) {
  throw "Missing file: $localServerEnvConfigBuildConfig"
}
if (-not (Test-Path $localServerHelpersBuildConfig)) {
  throw "Missing file: $localServerHelpersBuildConfig"
}
if (-not (Test-Path $localServerPersistenceHelpersBuildConfig)) {
  throw "Missing file: $localServerPersistenceHelpersBuildConfig"
}
if (-not (Test-Path $localServerPlayerStateHelpersBuildConfig)) {
  throw "Missing file: $localServerPlayerStateHelpersBuildConfig"
}
if (-not (Test-Path $localServerWorldStateHelpersBuildConfig)) {
  throw "Missing file: $localServerWorldStateHelpersBuildConfig"
}
if (-not (Test-Path $localServerMessageRouterHelpersBuildConfig)) {
  throw "Missing file: $localServerMessageRouterHelpersBuildConfig"
}
if (-not (Test-Path $localServerBotRateLimitHelpersBuildConfig)) {
  throw "Missing file: $localServerBotRateLimitHelpersBuildConfig"
}
if (-not (Test-Path $localServerInventoryTransactionHelpersBuildConfig)) {
  throw "Missing file: $localServerInventoryTransactionHelpersBuildConfig"
}
if (-not (Test-Path $localServerWorldInteractionPayloadHelpersBuildConfig)) {
  throw "Missing file: $localServerWorldInteractionPayloadHelpersBuildConfig"
}
if (-not (Test-Path $localServerSocketDeliveryHelpersBuildConfig)) {
  throw "Missing file: $localServerSocketDeliveryHelpersBuildConfig"
}
if (-not (Test-Path $localServerPunishmentHelpersBuildConfig)) {
  throw "Missing file: $localServerPunishmentHelpersBuildConfig"
}
if (-not (Test-Path $localServerPhase6HelpersBuildConfig)) {
  throw "Missing file: $localServerPhase6HelpersBuildConfig"
}
if (-not (Test-Path $localServerPhase7DispatcherBuildConfig)) {
  throw "Missing file: $localServerPhase7DispatcherBuildConfig"
}
if (-not (Test-Path $localServerPhase8PlayerSessionRoutesBuildConfig)) {
  throw "Missing file: $localServerPhase8PlayerSessionRoutesBuildConfig"
}
if (-not (Test-Path $localServerPhase8WorldActionRoutesBuildConfig)) {
  throw "Missing file: $localServerPhase8WorldActionRoutesBuildConfig"
}
if (-not (Test-Path $localServerPhase8FinalRoutesBuildConfig)) {
  throw "Missing file: $localServerPhase8FinalRoutesBuildConfig"
}
if (-not (Test-Path $localServerPhase9RemainingRoutesBuildConfig)) {
  throw "Missing file: $localServerPhase9RemainingRoutesBuildConfig"
}
if (-not (Test-Path $localServerPhase11aRuntimeBuildConfig)) {
  throw "Missing file: $localServerPhase11aRuntimeBuildConfig"
}
if (-not (Test-Path $localServerPhase11bLifecycleBuildConfig)) {
  throw "Missing file: $localServerPhase11bLifecycleBuildConfig"
}
if (-not (Test-Path $localServerPhase11cTrustedMovementBuildConfig)) {
  throw "Missing file: $localServerPhase11cTrustedMovementBuildConfig"
}
if (-not (Test-Path $localServerPhase11dStandardMovementBuildConfig)) {
  throw "Missing file: $localServerPhase11dStandardMovementBuildConfig"
}
if (-not (Test-Path $localServerEntryBuildConfig)) {
  throw "Missing file: $localServerEntryBuildConfig"
}
if (-not (Test-Path $localServerAccountAuthRoutesBuildConfig)) {
  throw "Missing file: $localServerAccountAuthRoutesBuildConfig"
}
if (-not (Test-Path $localServerAccountSessionHelpersBuildConfig)) {
  throw "Missing file: $localServerAccountSessionHelpersBuildConfig"
}
if (-not (Test-Path $localServerAdminLookupRoutesBuildConfig)) {
  throw "Missing file: $localServerAdminLookupRoutesBuildConfig"
}
if (-not (Test-Path $localServerFriendRoutesBuildConfig)) {
  throw "Missing file: $localServerFriendRoutesBuildConfig"
}
if (-not (Test-Path $localServerTradeRoutesBuildConfig)) {
  throw "Missing file: $localServerTradeRoutesBuildConfig"
}
if (-not (Test-Path $localServerInventoryEconomyRoutesBuildConfig)) {
  throw "Missing file: $localServerInventoryEconomyRoutesBuildConfig"
}
if (-not (Test-Path $localTypesDir)) {
  throw "Missing directory: $localTypesDir"
}
if ($RunSmokeChecks -and -not (Test-Path $localSmoke)) {
  throw "Missing file: $localSmoke"
}
if (-not (Test-Path $localPostgresSchema)) {
  throw "Missing file: $localPostgresSchema"
}
if (-not (Test-Path $localOpsDashboardDoc)) {
  throw "Missing file: $localOpsDashboardDoc"
}
if (-not (Test-Path $localBackendPersistenceRules)) {
  throw "Missing file: $localBackendPersistenceRules"
}
if (-not (Test-Path $localCodexHandoffStatus)) {
  throw "Missing file: $localCodexHandoffStatus"
}
if (-not (Test-Path $localProductionBackendWiring)) {
  throw "Missing file: $localProductionBackendWiring"
}
if (-not (Test-Path $localScaleReadinessDoc)) {
  throw "Missing file: $localScaleReadinessDoc"
}
if (-not (Test-Path $localPostgresBackup)) {
  throw "Missing file: $localPostgresBackup"
}
if (-not (Test-Path $localPostgresRestoreCheck)) {
  throw "Missing file: $localPostgresRestoreCheck"
}
if (-not (Test-Path $localPostgresMaintenance)) {
  throw "Missing file: $localPostgresMaintenance"
}
if (-not (Test-Path $localRollbackPlan)) {
  throw "Missing file: $localRollbackPlan"
}
if (-not (Test-Path $localRollbackApply)) {
  throw "Missing file: $localRollbackApply"
}
if (-not (Test-Path $localWorldRecoverAtCrash)) {
  throw "Missing file: $localWorldRecoverAtCrash"
}
if (-not (Test-Path $localWorldSnapshotTool)) {
  throw "Missing file: $localWorldSnapshotTool"
}
if (-not (Test-Path $localStagedLoadTest)) {
  throw "Missing file: $localStagedLoadTest"
}
if (-not (Test-Path $localLoadTokenProvisioner)) {
  throw "Missing file: $localLoadTokenProvisioner"
}
if (-not (Test-Path $localMultiInstanceWorldCapSmoke)) {
  throw "Missing file: $localMultiInstanceWorldCapSmoke"
}
if (-not (Test-Path $localMultiplayerScalingSmoke)) {
  throw "Missing file: $localMultiplayerScalingSmoke"
}
if (-not (Test-Path $localRouteStagingSetup)) {
  throw "Missing file: $localRouteStagingSetup"
}
if (-not (Test-Path $localRouteProductionSetup)) {
  throw "Missing file: $localRouteProductionSetup"
}
if (-not (Test-Path $localPublicWorldRouteSmoke)) {
  throw "Missing file: $localPublicWorldRouteSmoke"
}
if (-not (Test-Path $localOpsDashboardGitDeploy)) {
  throw "Missing file: $localOpsDashboardGitDeploy"
}
if (-not (Test-Path $localItemInstanceWiringCheck)) {
  throw "Missing file: $localItemInstanceWiringCheck"
}
if (-not (Test-Path $localTransactionLedgerWiringCheck)) {
  throw "Missing file: $localTransactionLedgerWiringCheck"
}
if (-not (Test-Path $localGemLedgerWiringCheck)) {
  throw "Missing file: $localGemLedgerWiringCheck"
}
if (-not (Test-Path $localWorldJournalWiringCheck)) {
  throw "Missing file: $localWorldJournalWiringCheck"
}
if (-not (Test-Path $localRollbackWiringCheck)) {
  throw "Missing file: $localRollbackWiringCheck"
}
if (-not (Test-Path $localServerValidationWiringCheck)) {
  throw "Missing file: $localServerValidationWiringCheck"
}
if (-not (Test-Path $localAntiDupeLockingCheck)) {
  throw "Missing file: $localAntiDupeLockingCheck"
}
if (-not (Test-Path $localAdminActionWiringCheck)) {
  throw "Missing file: $localAdminActionWiringCheck"
}
if (-not (Test-Path $localAccountSessionSecurityWiringCheck)) {
  throw "Missing file: $localAccountSessionSecurityWiringCheck"
}
if (-not (Test-Path $localBotRateLimitWiringCheck)) {
  throw "Missing file: $localBotRateLimitWiringCheck"
}
if (-not (Test-Path $localIntegrityHashWiringCheck)) {
  throw "Missing file: $localIntegrityHashWiringCheck"
}
if (-not (Test-Path $localMonitoringDashboardWiringCheck)) {
  throw "Missing file: $localMonitoringDashboardWiringCheck"
}
if (-not (Test-Path $localScaleReadinessWiringCheck)) {
  throw "Missing file: $localScaleReadinessWiringCheck"
}
if (-not (Test-Path $localJoinSpawnSafetyCheck)) {
  throw "Missing file: $localJoinSpawnSafetyCheck"
}
if (-not (Test-Path $localItemDataCheck)) {
  throw "Missing file: $localItemDataCheck"
}
if (-not (Test-Path $localItemDataBuildSync)) {
  throw "Missing file: $localItemDataBuildSync"
}
if (-not (Test-Path $localRedisStoreCheck)) {
  throw "Missing file: $localRedisStoreCheck"
}
if (-not (Test-Path $localRedisStoreBuildSync)) {
  throw "Missing file: $localRedisStoreBuildSync"
}
if (-not (Test-Path $localPostgresStoreCheck)) {
  throw "Missing file: $localPostgresStoreCheck"
}
if (-not (Test-Path $localPostgresStoreBuildSync)) {
  throw "Missing file: $localPostgresStoreBuildSync"
}
if (-not (Test-Path $localServerRuntimeStatsCheck)) {
  throw "Missing file: $localServerRuntimeStatsCheck"
}
if (-not (Test-Path $localServerRuntimeStatsBuildSync)) {
  throw "Missing file: $localServerRuntimeStatsBuildSync"
}
if (-not (Test-Path $localServerCrashDetailsCheck)) {
  throw "Missing file: $localServerCrashDetailsCheck"
}
if (-not (Test-Path $localServerCrashDetailsBuildSync)) {
  throw "Missing file: $localServerCrashDetailsBuildSync"
}
if (-not (Test-Path $localServerEnvConfigCheck)) {
  throw "Missing file: $localServerEnvConfigCheck"
}
if (-not (Test-Path $localServerEnvConfigBuildSync)) {
  throw "Missing file: $localServerEnvConfigBuildSync"
}
if (-not (Test-Path $localServerHelpersCheck)) {
  throw "Missing file: $localServerHelpersCheck"
}
if (-not (Test-Path $localServerHelpersBuildSync)) {
  throw "Missing file: $localServerHelpersBuildSync"
}
if (-not (Test-Path $localServerPersistenceHelpersCheck)) {
  throw "Missing file: $localServerPersistenceHelpersCheck"
}
if (-not (Test-Path $localServerPersistenceHelpersBuildSync)) {
  throw "Missing file: $localServerPersistenceHelpersBuildSync"
}
if (-not (Test-Path $localServerPlayerStateHelpersCheck)) {
  throw "Missing file: $localServerPlayerStateHelpersCheck"
}
if (-not (Test-Path $localServerPlayerStateHelpersBuildSync)) {
  throw "Missing file: $localServerPlayerStateHelpersBuildSync"
}
if (-not (Test-Path $localServerWorldStateHelpersCheck)) {
  throw "Missing file: $localServerWorldStateHelpersCheck"
}
if (-not (Test-Path $localServerWorldStateHelpersBuildSync)) {
  throw "Missing file: $localServerWorldStateHelpersBuildSync"
}
if (-not (Test-Path $localServerBotRateLimitHelpersCheck)) {
  throw "Missing file: $localServerBotRateLimitHelpersCheck"
}
if (-not (Test-Path $localServerBotRateLimitHelpersBuildSync)) {
  throw "Missing file: $localServerBotRateLimitHelpersBuildSync"
}
if (-not (Test-Path $localServerInventoryTransactionHelpersCheck)) {
  throw "Missing file: $localServerInventoryTransactionHelpersCheck"
}
if (-not (Test-Path $localServerInventoryTransactionHelpersBuildSync)) {
  throw "Missing file: $localServerInventoryTransactionHelpersBuildSync"
}
if (-not (Test-Path $localServerWorldInteractionPayloadHelpersCheck)) {
  throw "Missing file: $localServerWorldInteractionPayloadHelpersCheck"
}
if (-not (Test-Path $localServerWorldInteractionPayloadHelpersBuildSync)) {
  throw "Missing file: $localServerWorldInteractionPayloadHelpersBuildSync"
}
if (-not (Test-Path $localServerSocketDeliveryHelpersCheck)) {
  throw "Missing file: $localServerSocketDeliveryHelpersCheck"
}
if (-not (Test-Path $localServerSocketDeliveryHelpersBuildSync)) {
  throw "Missing file: $localServerSocketDeliveryHelpersBuildSync"
}
if (-not (Test-Path $localServerPunishmentHelpersCheck)) {
  throw "Missing file: $localServerPunishmentHelpersCheck"
}
if (-not (Test-Path $localServerPunishmentHelpersBuildSync)) {
  throw "Missing file: $localServerPunishmentHelpersBuildSync"
}
if (-not (Test-Path $localServerPhase6HelpersCheck)) {
  throw "Missing file: $localServerPhase6HelpersCheck"
}
if (-not (Test-Path $localServerPhase6HelpersBuildSync)) {
  throw "Missing file: $localServerPhase6HelpersBuildSync"
}
if (-not (Test-Path $localServerPhase7DispatcherCheck)) {
  throw "Missing file: $localServerPhase7DispatcherCheck"
}
if (-not (Test-Path $localServerPhase7DispatcherBuildSync)) {
  throw "Missing file: $localServerPhase7DispatcherBuildSync"
}
if (-not (Test-Path $localServerPhase8PlayerSessionRoutesCheck)) {
  throw "Missing file: $localServerPhase8PlayerSessionRoutesCheck"
}
if (-not (Test-Path $localServerPhase8PlayerSessionRoutesBuildSync)) {
  throw "Missing file: $localServerPhase8PlayerSessionRoutesBuildSync"
}
if (-not (Test-Path $localServerPhase8WorldActionRoutesCheck)) {
  throw "Missing file: $localServerPhase8WorldActionRoutesCheck"
}
if (-not (Test-Path $localServerPhase8WorldActionRoutesBuildSync)) {
  throw "Missing file: $localServerPhase8WorldActionRoutesBuildSync"
}
if (-not (Test-Path $localServerPhase8FinalRoutesCheck)) {
  throw "Missing file: $localServerPhase8FinalRoutesCheck"
}
if (-not (Test-Path $localServerPhase8FinalRoutesBuildSync)) {
  throw "Missing file: $localServerPhase8FinalRoutesBuildSync"
}
if (-not (Test-Path $localServerPhase9RemainingRoutesCheck)) {
  throw "Missing file: $localServerPhase9RemainingRoutesCheck"
}
if (-not (Test-Path $localServerPhase9RemainingRoutesBuildSync)) {
  throw "Missing file: $localServerPhase9RemainingRoutesBuildSync"
}
if (-not (Test-Path $localServerAccountAuthRoutesCheck)) {
  throw "Missing file: $localServerAccountAuthRoutesCheck"
}
if (-not (Test-Path $localServerAccountAuthRoutesBuildSync)) {
  throw "Missing file: $localServerAccountAuthRoutesBuildSync"
}
if (-not (Test-Path $localServerAccountSessionHelpersCheck)) {
  throw "Missing file: $localServerAccountSessionHelpersCheck"
}
if (-not (Test-Path $localServerAccountSessionHelpersBuildSync)) {
  throw "Missing file: $localServerAccountSessionHelpersBuildSync"
}
if (-not (Test-Path $localServerAdminLookupRoutesCheck)) {
  throw "Missing file: $localServerAdminLookupRoutesCheck"
}
if (-not (Test-Path $localServerAdminLookupRoutesBuildSync)) {
  throw "Missing file: $localServerAdminLookupRoutesBuildSync"
}
if (-not (Test-Path $localServerFriendRoutesCheck)) {
  throw "Missing file: $localServerFriendRoutesCheck"
}
if (-not (Test-Path $localServerFriendRoutesBuildSync)) {
  throw "Missing file: $localServerFriendRoutesBuildSync"
}
if (-not (Test-Path $localServerTradeRoutesCheck)) {
  throw "Missing file: $localServerTradeRoutesCheck"
}
if (-not (Test-Path $localServerTradeRoutesBuildSync)) {
  throw "Missing file: $localServerTradeRoutesBuildSync"
}
if (-not (Test-Path $localServerInventoryEconomyRoutesCheck)) {
  throw "Missing file: $localServerInventoryEconomyRoutesCheck"
}
if (-not (Test-Path $localServerInventoryEconomyRoutesBuildSync)) {
  throw "Missing file: $localServerInventoryEconomyRoutesBuildSync"
}
if (-not (Test-Path $localServerPhase10OwnershipCheck)) {
  throw "Missing file: $localServerPhase10OwnershipCheck"
}
if (-not (Test-Path $localServerPhase11aRuntimeCheck)) {
  throw "Missing file: $localServerPhase11aRuntimeCheck"
}
if (-not (Test-Path $localServerPhase11aRuntimeBuildSync)) {
  throw "Missing file: $localServerPhase11aRuntimeBuildSync"
}
if (-not (Test-Path $localServerPhase11bLifecycleCheck)) {
  throw "Missing file: $localServerPhase11bLifecycleCheck"
}
if (-not (Test-Path $localServerPhase11bLifecycleBuildSync)) {
  throw "Missing file: $localServerPhase11bLifecycleBuildSync"
}
if (-not (Test-Path $localServerPhase11cTrustedMovementCheck)) {
  throw "Missing file: $localServerPhase11cTrustedMovementCheck"
}
if (-not (Test-Path $localServerPhase11cTrustedMovementBuildSync)) {
  throw "Missing file: $localServerPhase11cTrustedMovementBuildSync"
}
if (-not (Test-Path $localServerPhase11dStandardMovementCheck)) {
  throw "Missing file: $localServerPhase11dStandardMovementCheck"
}
if (-not (Test-Path $localServerPhase11dStandardMovementBuildSync)) {
  throw "Missing file: $localServerPhase11dStandardMovementBuildSync"
}
if (-not (Test-Path $localServerEntryCheck)) {
  throw "Missing file: $localServerEntryCheck"
}
if (-not (Test-Path $localServerEntryBuildSync)) {
  throw "Missing file: $localServerEntryBuildSync"
}
if (-not (Test-Path $localRemovedLegacyItemsCleanup)) {
  throw "Missing file: $localRemovedLegacyItemsCleanup"
}
if (-not (Test-Path $localPacketContractsCheck)) {
  throw "Missing file: $localPacketContractsCheck"
}
if (-not (Test-Path $localPacketContractsBuildSync)) {
  throw "Missing file: $localPacketContractsBuildSync"
}
if (-not (Test-Path $localDropContractsCheck)) {
  throw "Missing file: $localDropContractsCheck"
}
if (-not (Test-Path $localDropContractsBuildSync)) {
  throw "Missing file: $localDropContractsBuildSync"
}
if (-not (Test-Path $localInventoryContractsCheck)) {
  throw "Missing file: $localInventoryContractsCheck"
}
if (-not (Test-Path $localInventoryContractsBuildSync)) {
  throw "Missing file: $localInventoryContractsBuildSync"
}
if (-not (Test-Path $localPostgresContractsCheck)) {
  throw "Missing file: $localPostgresContractsCheck"
}
if (-not (Test-Path $localPostgresContractsBuildSync)) {
  throw "Missing file: $localPostgresContractsBuildSync"
}
if (-not (Test-Path $localIntegrityHashAudit)) {
  throw "Missing file: $localIntegrityHashAudit"
}
if (-not (Test-Path $localOpsDashboardTokenHelper)) {
  throw "Missing file: $localOpsDashboardTokenHelper"
}

$sshTarget = "${RemoteUser}@${RemoteIp}"
$remotePath = "~/$RemoteDir"
$healthUrl = ("$SmokeApiBase".TrimEnd("/") + "/health")

if (-not $SshKeyPath -and $env:PIXELMANIA_SSH_KEY) {
  $SshKeyPath = $env:PIXELMANIA_SSH_KEY
}

if (-not $SshKeyPath) {
  $defaultSshKeyPath = Join-Path $HOME ".ssh/pixelmania_ed25519"
  if (Test-Path -LiteralPath $defaultSshKeyPath) {
    $SshKeyPath = $defaultSshKeyPath
  }
}

if ($SshKeyPath) {
  if (-not (Test-Path -LiteralPath $SshKeyPath)) {
    throw "SSH key not found: $SshKeyPath"
  }
  Write-Host "Using SSH key: $SshKeyPath"
  $sshBaseArgs = @("-i", $SshKeyPath)
} else {
  $sshBaseArgs = @()
}
$sshBaseArgs += @(
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=4"
)

$releaseEnvExports = @()
if ($ClientVersion) {
  $releaseEnvExports += ("export SERVER_CLIENT_VERSION=" + (ConvertTo-ShellLiteral $ClientVersion))
}
if ($MinClientVersion) {
  $releaseEnvExports += ("export MIN_CLIENT_VERSION=" + (ConvertTo-ShellLiteral $MinClientVersion))
}
if ($UpdateUrl) {
  $releaseEnvExports += ("export UPDATE_URL=" + (ConvertTo-ShellLiteral $UpdateUrl))
}
if ($releaseEnvExports.Count -gt 0) {
  $releaseEnvExports += 'echo "== Client version gate =="'
  $releaseEnvExports += 'echo "SERVER_CLIENT_VERSION=${SERVER_CLIENT_VERSION:-}"'
  $releaseEnvExports += 'echo "MIN_CLIENT_VERSION=${MIN_CLIENT_VERSION:-}"'
  $releaseEnvExports += 'echo "UPDATE_URL=${UPDATE_URL:-}"'
}
$releaseEnvScript = $releaseEnvExports -join "`n"

function Invoke-RemoteCommand {
  param([string]$Command)
  $remoteScript = ($Command -replace "`r`n", "`n" -replace "`r", "`n")
  $processStart = [System.Diagnostics.ProcessStartInfo]::new()
  $processStart.FileName = "ssh"
  foreach ($arg in ($sshBaseArgs + @($sshTarget, "bash -se"))) {
    [void]$processStart.ArgumentList.Add($arg)
  }
  $processStart.UseShellExecute = $false
  $processStart.RedirectStandardInput = $true

  $process = [System.Diagnostics.Process]::Start($processStart)
  $exitCode = 255
  try {
    $process.StandardInput.NewLine = "`n"
    $process.StandardInput.Write($remoteScript)
    $process.StandardInput.Close()
    $process.WaitForExit()
    $exitCode = $process.ExitCode
  } finally {
    if ($process -and -not $process.HasExited) {
      $process.Kill()
    }
    if ($process) {
      $process.Dispose()
    }
  }

  if ($exitCode -ne 0) {
    throw "Remote command failed with exit code $exitCode"
  }
}

function Invoke-LocalDeployPreflight {
  Push-Location $PSScriptRoot
  try {
    Write-Host "Building the TypeScript production entry before copy..."
    & npm run build:server-entry
    if ($LASTEXITCODE -ne 0) {
      throw "Local build:server-entry failed with exit code $LASTEXITCODE"
    }

    if ($SkipLocalPreflight) {
      Write-Host "Skipping extended local TypeScript preflight."
      & node --check server.js
      if ($LASTEXITCODE -ne 0) {
        throw "Generated server.js syntax check failed with exit code $LASTEXITCODE"
      }
      return
    }

    Write-Host "Running local TypeScript preflight before copy..."
    & npm run check:typescript
    if ($LASTEXITCODE -ne 0) {
      throw "Local check:typescript failed with exit code $LASTEXITCODE"
    }

    & node --check server.js
    if ($LASTEXITCODE -ne 0) {
      throw "Local server.js syntax check failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

Invoke-LocalDeployPreflight

Write-Host "Copying backend files to ${sshTarget}:${remotePath}..."
Invoke-RemoteCommand "mkdir -p $remotePath/scripts $remotePath/docs $remotePath/Data/items $remotePath/ops_dashboard_public $remotePath/types $remotePath/src"
Invoke-RemoteCommand "mkdir -p ~/pixel-mania/Scripts ~/pixel-mania/Data/items"
& scp @sshBaseArgs $localBackend "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localBackendSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerRuntimeStats "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerRuntimeStatsSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerCrashDetails "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerCrashDetailsSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerEnvConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerEnvConfigSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerIdentityHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerIdentityHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerTextHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerTextHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerVersionHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerVersionHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerAccountHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerAccountHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerAccountAuthRoutes "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerAccountAuthRoutesSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerAccountSessionHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerAccountSessionHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerAdminLookupRoutes "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerAdminLookupRoutesSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerFriendRoutes "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerFriendRoutesSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerTradeRoutes "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerTradeRoutesSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerInventoryEconomyRoutes "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerInventoryEconomyRoutesSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPersistenceHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPersistenceHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPlayerStateHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPlayerStateHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerWorldStateHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerWorldStateHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerMessageRouterHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerMessageRouterHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerBotRateLimitHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerBotRateLimitHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerInventoryTransactionHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerInventoryTransactionHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerWorldInteractionPayloadHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerWorldInteractionPayloadHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerSocketDeliveryHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerSocketDeliveryHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPunishmentHelpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPunishmentHelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPhase6Helpers "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase6HelpersSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPhase7Dispatcher "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase7DispatcherSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPhase8PlayerSessionRoutes "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase8PlayerSessionRoutesSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPhase8WorldActionRoutes "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase8WorldActionRoutesSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPhase8FinalRoutes "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase8FinalRoutesSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPhase9RemainingRoutes "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase9RemainingRoutesSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPhase11aRuntime "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase11aRuntimeSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPhase11bLifecycle "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase11bLifecycleSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPhase11cTrustedMovement "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase11cTrustedMovementSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerPhase11dStandardMovement "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase11dStandardMovementSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localPacketContracts "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPacketContractsSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localPacketContractsBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localDropContracts "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localDropContractsSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localDropContractsBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localInventoryContracts "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localInventoryContractsSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localInventoryContractsBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPostgresContracts "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPostgresContractsSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localPostgresContractsBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localDeployHelper "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localEnvExample "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerItemDatabase "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerItemDatabaseSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localServerItemAtlasDb "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerItemAtlasDbSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localAtlasItemDefinition "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localAtlasItemDefinitionSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localClientItemDatabase "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localClientItemAtlasDb "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localAtlasItemsDatabase "${sshTarget}:$remotePath/Data/items/"
& scp @sshBaseArgs $localAtlasItemsDatabase "${sshTarget}:~/pixel-mania/Data/items/"
& scp @sshBaseArgs $localDeveloperPanelUi "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localNetworkManager "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localWorldScript "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localBlockManager "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localWorldTilemapRenderer "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localItemGameplayManager "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localDropManager "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localSaveManager "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localWorldStateSyncManager "${sshTarget}:~/pixel-mania/Scripts/"
& scp @sshBaseArgs $localProjectGodot "${sshTarget}:~/pixel-mania/"
& scp @sshBaseArgs $localPostgresStore "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPostgresStoreSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localRedisStore "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localRedisStoreSource "${sshTarget}:$remotePath/src/"
& scp @sshBaseArgs $localEcosystem "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localOpsDashboardServer "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localOpsDashboardEcosystem "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localOpsDashboardEnvExample "${sshTarget}:$remotePath/"
& scp @sshBaseArgs -r $localOpsDashboardPublic "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPackage "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPackageLock "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localTsConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localItemDataBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localRedisStoreBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPostgresStoreBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerRuntimeStatsBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerCrashDetailsBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerEnvConfigBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPersistenceHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPlayerStateHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerWorldStateHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerMessageRouterHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerBotRateLimitHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerInventoryTransactionHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerWorldInteractionPayloadHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerSocketDeliveryHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPunishmentHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase6HelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase7DispatcherBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase8PlayerSessionRoutesBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase8WorldActionRoutesBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase8FinalRoutesBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase9RemainingRoutesBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase11aRuntimeBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase11bLifecycleBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase11cTrustedMovementBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerPhase11dStandardMovementBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerEntryBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerAccountAuthRoutesBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerAccountSessionHelpersBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerAdminLookupRoutesBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerFriendRoutesBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerTradeRoutesBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localServerInventoryEconomyRoutesBuildConfig "${sshTarget}:$remotePath/"
& scp @sshBaseArgs -r $localTypesDir "${sshTarget}:$remotePath/"
& scp @sshBaseArgs $localPostgresSchema "${sshTarget}:$remotePath/docs/"
& scp @sshBaseArgs $localOpsDashboardDoc "${sshTarget}:$remotePath/docs/"
& scp @sshBaseArgs $localBackendPersistenceRules "${sshTarget}:$remotePath/docs/"
& scp @sshBaseArgs $localCodexHandoffStatus "${sshTarget}:$remotePath/docs/"
& scp @sshBaseArgs $localProductionBackendWiring "${sshTarget}:$remotePath/docs/"
& scp @sshBaseArgs $localScaleReadinessDoc "${sshTarget}:$remotePath/docs/"
& scp @sshBaseArgs $localPostgresBackup "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPostgresRestoreCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPostgresMaintenance "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRollbackPlan "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRollbackApply "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localWorldRecoverAtCrash "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localWorldSnapshotTool "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localStagedLoadTest "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localLoadTokenProvisioner "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localMultiInstanceWorldCapSmoke "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localMultiplayerScalingSmoke "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRouteStagingSetup "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRouteProductionSetup "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPublicWorldRouteSmoke "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localOpsDashboardGitDeploy "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localItemInstanceWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localTransactionLedgerWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localGemLedgerWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localWorldJournalWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRollbackWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerValidationWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localAntiDupeLockingCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localAdminActionWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localAccountSessionSecurityWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localBotRateLimitWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localIntegrityHashWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localMonitoringDashboardWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localScaleReadinessWiringCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localJoinSpawnSafetyCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localItemDataCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localItemDataBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRedisStoreCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRedisStoreBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPostgresStoreCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPostgresStoreBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerRuntimeStatsCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerRuntimeStatsBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerCrashDetailsCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerCrashDetailsBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerEnvConfigCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerEnvConfigBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPersistenceHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPersistenceHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPlayerStateHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPlayerStateHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerWorldStateHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerWorldStateHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerMessageRouterHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerMessageRouterHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerBotRateLimitHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerBotRateLimitHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerInventoryTransactionHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerInventoryTransactionHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerWorldInteractionPayloadHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerWorldInteractionPayloadHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerSocketDeliveryHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerSocketDeliveryHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPunishmentHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPunishmentHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase6HelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase6HelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase7DispatcherCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase7DispatcherBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase8PlayerSessionRoutesCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase8PlayerSessionRoutesBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase8WorldActionRoutesCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase8WorldActionRoutesBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase8FinalRoutesCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase8FinalRoutesBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase9RemainingRoutesCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase9RemainingRoutesBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerAccountAuthRoutesCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerAccountAuthRoutesBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerAccountSessionHelpersCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerAccountSessionHelpersBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerAdminLookupRoutesCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerAdminLookupRoutesBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerFriendRoutesCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerFriendRoutesBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerTradeRoutesCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerTradeRoutesBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerInventoryEconomyRoutesCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerInventoryEconomyRoutesBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase10OwnershipCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase11aRuntimeCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase11aRuntimeBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase11bLifecycleCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase11bLifecycleBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase11cTrustedMovementCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase11cTrustedMovementBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase11dStandardMovementCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerPhase11dStandardMovementBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerEntryCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localServerEntryBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPacketContractsCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPacketContractsBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localDropContractsCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localDropContractsBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localInventoryContractsCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localInventoryContractsBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPostgresContractsCheck "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localPostgresContractsBuildSync "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localIntegrityHashAudit "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localRemovedLegacyItemsCleanup "${sshTarget}:$remotePath/scripts/"
& scp @sshBaseArgs $localOpsDashboardTokenHelper "${sshTarget}:$remotePath/scripts/"

Write-Host "Restarting PM2 and verifying health..."
$remoteCommand = @'
set -euo pipefail
cd __REMOTE_PATH__
echo "== Files on droplet =="
grep -n "redis_stats\\|getHealthSnapshot" server.js || true
if [ "__RUN_REMOTE_FULL_CHECKS__" = "1" ]; then
  npm install
else
  npm install --omit=dev --no-audit --no-fund
fi
node --check server.js
node --check scripts/sync_item_data_build.js
node --check scripts/sync_redis_store_build.js
node --check scripts/sync_packet_contracts_build.js
node --check scripts/sync_drop_contracts_build.js
node --check scripts/sync_inventory_contracts_build.js
node --check scripts/sync_postgres_contracts_build.js
node --check scripts/sync_postgres_store_build.js
node --check scripts/sync_server_runtime_stats_build.js
node --check scripts/sync_server_crash_details_build.js
node --check scripts/sync_server_env_config_build.js
node --check scripts/sync_server_helpers_build.js
node --check scripts/sync_server_persistence_helpers_build.js
node --check scripts/sync_server_player_state_helpers_build.js
node --check scripts/sync_server_world_state_helpers_build.js
node --check scripts/sync_server_message_router_helpers_build.js
node --check scripts/sync_server_bot_rate_limit_helpers_build.js
node --check scripts/sync_server_inventory_transaction_helpers_build.js
node --check scripts/sync_server_world_interaction_payload_helpers_build.js
node --check scripts/sync_server_socket_delivery_helpers_build.js
node --check scripts/sync_server_punishment_helpers_build.js
node --check scripts/sync_server_phase6_helpers_build.js
node --check scripts/sync_server_phase7_dispatcher_build.js
node --check scripts/sync_server_phase8_player_session_routes_build.js
node --check scripts/sync_server_phase8_world_action_routes_build.js
node --check scripts/sync_server_phase8_final_routes_build.js
node --check scripts/sync_server_phase9_remaining_routes_build.js
node --check scripts/sync_server_phase11a_runtime_build.js
node --check scripts/sync_server_phase11b_lifecycle_build.js
node --check scripts/sync_server_phase11c_trusted_movement_build.js
node --check scripts/sync_server_phase11d_standard_movement_build.js
node --check scripts/sync_server_entry_build.js
node --check scripts/sync_server_account_auth_routes_build.js
node --check scripts/sync_server_account_session_helpers_build.js
node --check scripts/sync_server_admin_lookup_routes_build.js
node --check scripts/sync_server_friend_routes_build.js
node --check scripts/sync_server_trade_routes_build.js
node --check scripts/sync_server_inventory_economy_routes_build.js
if [ "__RUN_REMOTE_FULL_CHECKS__" = "1" ]; then
  echo "== Remote TypeScript build/check =="
  npm run build:item-data
  npm run build:redis-store
  npm run build:server-runtime-stats
  npm run build:server-crash-details
  npm run build:server-env-config
  npm run build:server-helpers
  npm run build:server-persistence-helpers
  npm run build:server-player-state-helpers
  npm run build:server-world-state-helpers
  npm run build:server-message-router-helpers
  npm run build:server-bot-rate-limit-helpers
  npm run build:server-inventory-transaction-helpers
  npm run build:server-world-interaction-payload-helpers
  npm run build:server-socket-delivery-helpers
  npm run build:server-punishment-helpers
  npm run build:server-phase6-helpers
  npm run build:server-phase7-dispatcher
  npm run build:server-phase8-player-session-routes
  npm run build:server-phase8-world-action-routes
  npm run build:server-phase8-final-routes
  npm run build:server-phase9-remaining-routes
  npm run check:server-phase11a-runtime
  npm run check:server-phase11b-lifecycle
  npm run check:server-phase11c-trusted-movement
  npm run check:server-phase11d-standard-movement
  npm run check:server-entry
  npm run build:server-account-auth-routes
  npm run build:server-account-session-helpers
  npm run build:server-admin-lookup-routes
  npm run build:server-friend-routes
  npm run build:server-trade-routes
  npm run build:server-inventory-economy-routes
  npm run build:packet-contracts
  npm run build:drop-contracts
  npm run build:inventory-contracts
  npm run build:postgres-contracts
  npm run build:postgres-store
  npm run check:typescript
else
  echo "== Remote TypeScript build/check skipped =="
  echo "Generated JavaScript was built locally before upload."
fi
node --check server_packet_contracts.js
node --check server_drop_contracts.js
node --check server_inventory_contracts.js
node --check postgres_store_contracts.js
node --check server_runtime_stats.js
node --check server_crash_details.js
node --check server_env_config.js
node --check server_identity_helpers.js
node --check server_text_helpers.js
node --check server_version_helpers.js
node --check server_account_helpers.js
node --check server_persistence_helpers.js
node --check server_player_state_helpers.js
node --check server_world_state_helpers.js
node --check server_message_router_helpers.js
node --check server_bot_rate_limit_helpers.js
node --check server_inventory_transaction_helpers.js
node --check server_world_interaction_payload_helpers.js
node --check server_socket_delivery_helpers.js
node --check server_punishment_helpers.js
node --check server_phase6_helpers.js
node --check server_phase7_dispatcher.js
node --check server_phase8_player_session_routes.js
node --check server_phase8_world_action_routes.js
node --check server_phase8_final_routes.js
node --check server_phase9_remaining_routes.js
node --check server_phase11a_runtime.js
node --check server_phase11b_lifecycle.js
node --check server_phase11c_trusted_movement.js
node --check server_phase11d_standard_movement.js
node --check server_account_auth_routes.js
node --check server_account_session_helpers.js
node --check server_admin_lookup_routes.js
node --check server_friend_routes.js
node --check server_trade_routes.js
node --check server_inventory_economy_routes.js
node --check server_item_database.js
node --check item_atlas_db.js
node --check atlas_item_definition.js
node --check postgres_store.js
node --check redis_store.js
node --check ops_dashboard_server.js
node --check ecosystem.ops.config.js
node --check scripts/rollback_plan.js
node --check scripts/rollback_apply.js
node --check scripts/world_recover_at_crash.js
node --check scripts/world_snapshot_tool.js
node --check scripts/staged_ws_load_test.js
node --check scripts/provision_load_tokens.js
node --check scripts/multi_instance_world_cap_smoke.js
node --check scripts/multiplayer_scaling_smoke.js
node --check scripts/public_world_route_smoke.js
node --check scripts/check_server_validation_wiring.js
node --check scripts/check_anti_dupe_locking_wiring.js
node --check scripts/check_admin_action_wiring.js
node --check scripts/check_account_session_security_wiring.js
node --check scripts/check_bot_rate_limit_wiring.js
node --check scripts/check_integrity_hash_wiring.js
node --check scripts/check_monitoring_dashboard_wiring.js
node --check scripts/check_scale_readiness_wiring.js
node --check scripts/check_packet_contracts.js
node --check scripts/check_drop_contracts.js
node --check scripts/check_inventory_contracts.js
node --check scripts/check_postgres_contracts.js
node --check scripts/check_postgres_store_build.js
node --check scripts/check_server_runtime_stats_build.js
node --check scripts/check_server_crash_details_build.js
node --check scripts/check_server_env_config_build.js
node --check scripts/check_server_helpers_build.js
node --check scripts/check_server_persistence_helpers_build.js
node --check scripts/check_server_player_state_helpers_build.js
node --check scripts/check_server_world_state_helpers_build.js
node --check scripts/check_server_message_router_helpers_build.js
node --check scripts/check_server_bot_rate_limit_helpers_build.js
node --check scripts/check_server_inventory_transaction_helpers_build.js
node --check scripts/check_server_world_interaction_payload_helpers_build.js
node --check scripts/check_server_socket_delivery_helpers_build.js
node --check scripts/check_server_punishment_helpers_build.js
node --check scripts/check_server_phase6_helpers_build.js
node --check scripts/check_server_phase7_dispatcher_build.js
node --check scripts/check_server_phase8_player_session_routes_build.js
node --check scripts/check_server_phase8_world_action_routes_build.js
node --check scripts/check_server_phase8_final_routes_build.js
node --check scripts/check_server_phase9_remaining_routes_build.js
node --check scripts/check_server_account_auth_routes_build.js
node --check scripts/check_server_account_session_helpers_build.js
node --check scripts/check_server_admin_lookup_routes_build.js
node --check scripts/check_server_friend_routes_build.js
node --check scripts/check_server_trade_routes_build.js
node --check scripts/check_server_inventory_economy_routes_build.js
node --check scripts/check_server_phase10_typescript_ownership.js
node --check scripts/check_server_phase11a_runtime_build.js
node --check scripts/check_server_phase11b_lifecycle_build.js
node --check scripts/check_server_phase11c_trusted_movement_build.js
node --check scripts/check_server_phase11d_standard_movement_build.js
node --check scripts/check_server_phase11e_to_11j_entry_build.js
node --check scripts/check_join_spawn_safety.js
node --check scripts/integrity_hash_audit.js
node --check scripts/cleanup_removed_legacy_items.js
node --check scripts/generate_ops_dashboard_token_hash.js
npm run check:server-phase10-ownership
node scripts/check_server_phase11a_runtime_build.js
node scripts/check_server_phase11b_lifecycle_build.js
node scripts/check_server_phase11c_trusted_movement_build.js
node scripts/check_server_phase11d_standard_movement_build.js
npm run check:item-db
npm run check:item-instances
npm run check:transaction-ledger
npm run check:gem-ledger
npm run check:world-journal
npm run check:rollback
npm run check:server-validation
npm run check:anti-dupe
npm run check:admin-actions
npm run check:account-security
npm run check:bot-rate-limits
npm run check:integrity-hashes
npm run check:monitoring-dashboard
npm run check:scale-readiness
npm run check:join-spawn
chmod +x scripts/postgres_backup.sh scripts/postgres_restore_check.sh
chmod +x scripts/postgres_maintenance.sh scripts/start_route_staging_instances.sh scripts/start_route_production_instances.sh scripts/ops_dashboard_git_deploy.sh
bash -n scripts/start_route_staging_instances.sh
bash -n scripts/start_route_production_instances.sh
bash -n scripts/ops_dashboard_git_deploy.sh
__RELEASE_ENV_EXPORTS__
pm2 startOrReload ecosystem.config.js --env production --update-env
for route_app in pixelmania-a pixelmania-b; do
  if pm2 describe "$route_app" >/dev/null 2>&1; then
    echo "Restarting existing route app $route_app with deployed code..."
    pm2 restart "$route_app"
  fi
done
pm2 save
echo "== Health =="
health_ok=0
for attempt in $(seq 1 30); do
  http_code="$(curl -sS "__HEALTH_URL__" -o /tmp/pixelmania-health.json -w "%{http_code}" 2>/tmp/pixelmania-health.err || true)"
  if [ "$http_code" = "200" ]; then
    cat /tmp/pixelmania-health.json
    health_ok=1
    break
  fi
  echo "Health is not ready yet: attempt ${attempt}/30 (http ${http_code:-curl_failed})."
  if [ -s /tmp/pixelmania-health.err ]; then
    sed -n '1,3p' /tmp/pixelmania-health.err || true
  fi
  sleep 2
done
if [ "$health_ok" != "1" ]; then
  echo "Health check failed:"
  cat /tmp/pixelmania-health.err || true
  cat /tmp/pixelmania-health.json || true
  pm2 list || true
  pm2 logs pixelmania --lines 80 --nostream || true
  exit 1
fi
'@

$remoteFullChecksValue = if ($RunRemoteFullChecks) { "1" } else { "0" }
$remoteCommand = $remoteCommand.Replace("__REMOTE_PATH__", $remotePath).Replace("__HEALTH_URL__", $healthUrl).Replace("__RELEASE_ENV_EXPORTS__", $releaseEnvScript).Replace("__RUN_REMOTE_FULL_CHECKS__", $remoteFullChecksValue)

Invoke-RemoteCommand $remoteCommand

if ($ClientVersion -or $MinClientVersion) {
  Write-Host "Verifying client version gate from $healthUrl ..."
  $healthPayload = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 12
  if ($ClientVersion -and [string]$healthPayload.server_client_version -ne $ClientVersion) {
    throw "Expected server_client_version $ClientVersion, got $($healthPayload.server_client_version)"
  }
  if ($MinClientVersion -and [string]$healthPayload.min_client_version -ne $MinClientVersion) {
    throw "Expected min_client_version $MinClientVersion, got $($healthPayload.min_client_version)"
  }
}

if ($RunSmokeChecks) {
  Write-Host "Running local post-deploy smoke checks against $SmokeApiBase ..."
  & powershell -ExecutionPolicy Bypass -File $localSmoke -ApiBase $SmokeApiBase -RequireRedisReady -RequireRedisStats
}

Write-Host "Done. If curl output does not show persistence.redis_stats, run:"
Write-Host "ssh $sshTarget 'cd $remotePath && sed -n \"1235,1270p\" server.js'"
