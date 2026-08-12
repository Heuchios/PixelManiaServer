"use strict";

export {};

type PacketRecord = Record<string, any>;

interface Phase11aRuntimeDeps extends Record<string, any> {}

function getErrorMessage(error: any): string {
  return error && error.message ? String(error.message) : String(error);
}

function copyCounterRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, rawCount] of Object.entries(value as Record<string, unknown>)) {
    const count = Math.max(0, Math.trunc(Number(rawCount) || 0));
    if (count > 0) result[String(key)] = count;
  }
  return result;
}

function isBrokenStdIoError(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  const code = String(value?.code || "");
  if (code === "EPIPE" || code === "ERR_STREAM_DESTROYED") return true;
  return String(value?.message || "").includes("EPIPE");
}

function installConsoleWriteGuard(runtimeProcess: any = process, runtimeConsole: any = console): void {
  for (const stream of [runtimeProcess.stdout, runtimeProcess.stderr]) {
    if (!stream || typeof stream.on !== "function") continue;
    stream.on("error", (error: unknown) => {
      if (isBrokenStdIoError(error)) return;
      try {
        runtimeProcess.emitWarning(error);
      } catch {
        // Broken stdio must not terminate the authoritative server.
      }
    });
  }

  for (const method of ["log", "info", "warn", "error", "debug"]) {
    const original = runtimeConsole[method];
    if (typeof original !== "function") continue;
    runtimeConsole[method] = (...args: unknown[]) => {
      try {
        original.apply(runtimeConsole, args);
      } catch (error) {
        if (!isBrokenStdIoError(error)) throw error;
      }
    };
  }
}

function createServerPhase11aRuntime(deps: Phase11aRuntimeDeps) {
  const {
    ALLOW_LEGACY_WORLD_STATE_IMPORT,
    CUSTOM_TRUSTED_PLAYER_STATE_ENABLED,
    DEV_BACKEND_LOGIN_ALLOWED,
    DROP_INTEREST_LEAVE_RADIUS_PIXELS,
    DROP_INTEREST_RADIUS_PIXELS,
    DROP_INTEREST_SYNC_INTERVAL_MS,
    dropInterestByReceiver,
    handleStripeIapWebhook,
    HOST,
    IDEMPOTENCY_TTL_MS,
    IDEMPOTENCY_TTL_MS_COMBAT,
    IDEMPOTENCY_TTL_MS_CRITICAL,
    IDEMPOTENCY_TTL_MS_WORLD_ACTION,
    MAX_MOVE_ACCEL_PIXELS_PER_SECOND2,
    MAX_MOVE_PIXELS_PER_SECOND,
    MAX_PACKET_BYTES,
    MAX_PLAYERS_PER_WORLD,
    MAX_TRUSTED_POSITION_AGE_MS,
    MAX_TRUSTED_POSITION_AGE_MS_COMBAT,
    MAX_TRUSTED_POSITION_AGE_MS_WORLD_ACTION,
    MIN_CLIENT_VERSION,
    MIN_PASSWORD_LENGTH,
    MOVEMENT_COLLISION_GUARD_ENABLED,
    MOVEMENT_CORRECTION_SNAP_DISTANCE,
    MOVEMENT_DISTANCE_GRACE_PIXELS,
    MOVEMENT_MAX_ELAPSED_SECONDS,
    NETFOX_ARCHIVE_TOOLS_ALLOWED,
    NETFOX_MOVEMENT_ALLOW_STATIC_FALLBACK,
    NETFOX_MOVEMENT_ENABLED,
    NETFOX_MOVEMENT_MAX_CLIENTS,
    NETFOX_MOVEMENT_PUBLIC_HOST,
    NETFOX_MOVEMENT_PUBLIC_PORT,
    NETFOX_MOVEMENT_ROUTE_TTL_MS,
    NETFOX_SPAWN_TICKET_TTL_MS,
    NETFOX_TRUSTED_PLAYER_STATE_ENABLED,
    PACKET_SIZE_TELEMETRY_ENABLED,
    PACKET_TYPE_SIZE_SAMPLE_LIMIT,
    PLAYER_ACTION_INTEREST_MANAGEMENT_ENABLED,
    PLAYER_INTEREST_LEAVE_RADIUS_PIXELS,
    PLAYER_INTEREST_RADIUS_PIXELS,
    PLAYER_POSITION_BATCHING_ENABLED,
    PLAYER_POSITION_BATCH_MAX_ITEMS,
    PLAYER_POSITION_BATCH_MIN_CLIENT_VERSION,
    PLAYER_POSITION_BROADCAST_INTERVAL_MS,
    PLAYER_POSITION_DELIVERY_RETRY_MS,
    PLAYER_POSITION_IDLE_HEARTBEAT_MS,
    PLAYER_POSITION_MAX_BUFFERED_AMOUNT,
    PLAYER_POSITION_RESUME_BUFFERED_AMOUNT,
    PORT,
    POSTGRES_AUTHORITATIVE,
    POSTGRES_ENABLED,
    POSTGRES_SCHEMA,
    PUBLIC_BASE_URL,
    PUBLIC_WS_URL,
    REDIS_ENABLED,
    REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT,
    REQUIRE_POSTGRES_AUTHORITATIVE_FOR_GAMEPLAY,
    SAVE_DEBOUNCE_MS,
    SERVER_CLIENT_VERSION,
    SERVER_INSTANCE_ID,
    SERVER_INSTANCE_WS_URL,
    SERVER_TICK_MONITOR_INTERVAL_MS,
    SMTP_HOST,
    TRUSTED_MOVEMENT_ALLOWLIST,
    TRUSTED_MOVEMENT_ALLOWLIST_ENABLED,
    TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD,
    WORLD_ADMISSION_TTL_MS,
    WORLD_JSON_BACKUP_DEBOUNCE_MS,
    WORLD_JSON_BACKUP_WHEN_PG_READY,
    WORLD_NON_CRITICAL_WORLD_SAVE_DEBOUNCE_MS,
    WORLD_ROUTE_ENFORCEMENT_ENABLED,
    WORLD_ROUTE_TTL_MS,
    WORLD_SNAPSHOT_INTERVAL_MINUTES,
    WORLD_SNAPSHOT_INTERVAL_MS,
    WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE,
    WORLD_SNAPSHOT_POSTGRES_INLINE,
    WORLD_SNAPSHOT_SPACES_ENDPOINT,
    WORLD_SNAPSHOT_SPACES_TARGET,
    WORLD_SNAPSHOT_STARTUP_RUN,
    WORLD_SNAPSHOT_STORAGE,
    WORLD_UPDATE_BATCHING_ENABLED,
    WORLD_UPDATE_BATCH_INTERVAL_MS,
    WORLD_UPDATE_BATCH_MAX_ITEMS,
    WORLD_UPDATE_BATCH_MIN_CLIENT_VERSION,
    applyPasswordResetToken,
    assertAuthoritativePostgresReady,
    buildNetfoxWorldStateHttpPayload,
    cleanWorld,
    confirmEmailChangeToken,
    cryptoRandomUUID,
    CRASH_REPORT_PATH,
    errorToCrashDetails,
    escapeHtml,
    exitProcess,
    fileSystem,
    getNetfoxMovementRouteForWorld,
    getNetfoxMovementRouteStats,
    getWorldIndexStatsSnapshot,
    getWorldRouteStatsSnapshot,
    getWorldSnapshotSchedulerRunning,
    httpServer,
    isCustomMovementServerWorldStateEndpointConfigured,
    isDropInterestManagementEnabled,
    isNetfoxServerWorldStateEndpointConfigured,
    isNetfoxSpawnTicketConfigured,
    isPlayerInterestManagementEnabled,
    loadPersistentState,
    logger,
    markFatalCrashReportWritten,
    pathModule,
    pendingPersistenceWrites,
    pendingPlayerPositionBroadcasts,
    pendingWorldJsonBackups,
    pendingWorldUpdateBroadcasts,
    playerInterestByReceiver,
    playerNetworkStats,
    playerStates,
    players,
    postgresStore,
    processRuntime,
    recoverWorldEventsAfterLoad,
    redisStore,
    refreshWorldDropsFromPostgres,
    registerNetfoxMovementRoute,
    serverRuntimeStats,
    serverTickStats,
    startAntiDupeAuditScanner,
    startCalendarEventScheduler,
    startPeriodicWorldSnapshotScheduler,
    startWorldEventRandomScheduler,
    verifyCustomMovementServerWorldStateRequest,
    verifyEmailToken,
    verifyNetfoxServerWorldStateRequest,
    verifyNetfoxSpawnTicketPayload,
    worldJsonBackupTimers,
    worldNetworkStats,
    worldSaveTimers,
    worldSnapshotSchedulerState,
    worldSnapshotStorageIsSpaces,
    worldStates,
    wss,
  } = deps;

  let serverTickMonitorTimer: NodeJS.Timeout | null = null;
  let serverTickMonitorLastHrtime: bigint | null = null;

  function getCrashRuntimeState(): PacketRecord {
    try {
      return {
        connected_sockets: wss.clients.size,
        tracked_players: players.size,
        loaded_worlds: worldStates.size,
        loaded_player_states: playerStates.size,
        pending_persistence_writes: pendingPersistenceWrites.size,
        postgres_ready: postgresStore.isReady(),
        redis_ready: redisStore.isReady(),
      };
    } catch (error) {
      return {
        snapshot_error: getErrorMessage(error),
      };
    }
  }

  function getServerTickSnapshot(): PacketRecord {
    return serverRuntimeStats.getServerTickSnapshot(serverTickStats, {
      intervalMs: SERVER_TICK_MONITOR_INTERVAL_MS,
    });
  }

  function toMegabytes(bytes: unknown): number {
    return Math.round((Math.max(0, Number(bytes) || 0) / (1024 * 1024)) * 10) / 10;
  }

  // PM2 restarts a route instance at max_memory_restart (512M in production), which drops every
  // player on that process. /health previously reported no memory at all, so sustained load
  // could not be checked against that ceiling without shelling into the droplet. Read-only and
  // allocation-free apart from the memoryUsage() result itself.
  function getProcessRuntimeSnapshot(): PacketRecord {
    let memory: PacketRecord = {};
    try {
      memory = (processRuntime.memoryUsage() || {}) as PacketRecord;
    } catch (error) {
      return { snapshot_error: getErrorMessage(error) };
    }
    let uptimeSeconds = 0;
    try {
      uptimeSeconds = Math.max(0, Math.round(Number(processRuntime.uptime()) || 0));
    } catch {
      uptimeSeconds = 0;
    }
    return {
      pid: Math.trunc(Number(processRuntime.pid) || 0),
      node_version: String(processRuntime.version || ""),
      uptime_seconds: uptimeSeconds,
      rss_mb: toMegabytes(memory.rss),
      heap_used_mb: toMegabytes(memory.heapUsed),
      heap_total_mb: toMegabytes(memory.heapTotal),
      external_mb: toMegabytes(memory.external),
      array_buffers_mb: toMegabytes(memory.arrayBuffers),
    };
  }

  function getPendingPlayerPositionUpdateCount(): number {
    let count = 0;
    for (const worldQueue of pendingPlayerPositionBroadcasts.values()) {
      if (worldQueue && typeof worldQueue.size === "number") {
        count += worldQueue.size;
      }
    }
    return count;
  }

  function getPendingWorldUpdateCount(): number {
    let count = 0;
    for (const worldQueue of pendingWorldUpdateBroadcasts.values()) {
      if (Array.isArray(worldQueue)) {
        count += worldQueue.length;
      }
    }
    return count;
  }

  function getActivePlayerInterestLinkCount(): number {
    let count = 0;
    for (const set of playerInterestByReceiver.values()) {
      if (set && typeof set.size === "number") {
        count += set.size;
      }
    }
    return count;
  }

  function getActiveDropInterestLinkCount(): number {
    let count = 0;
    for (const set of dropInterestByReceiver.values()) {
      if (set && typeof set.size === "number") {
        count += set.size;
      }
    }
    return count;
  }

  function getWorldNetworkStatsSnapshot(): PacketRecord {
    return {
      started_at: worldNetworkStats.started_at,
      queued_world_updates: Number(worldNetworkStats.queued_world_updates || 0),
      batch_world_packets_sent: Number(worldNetworkStats.batch_world_packets_sent || 0),
      batch_world_items_sent: Number(worldNetworkStats.batch_world_items_sent || 0),
      batch_fallback_individual_sends: Number(worldNetworkStats.batch_fallback_individual_sends || 0),
      drop_interest_visible_deliveries: Number(worldNetworkStats.drop_interest_visible_deliveries || 0),
      drop_interest_culls_sent: Number(worldNetworkStats.drop_interest_culls_sent || 0),
      drop_interest_syncs: Number(worldNetworkStats.drop_interest_syncs || 0),
      active_drop_interest_receivers: dropInterestByReceiver.size,
      active_drop_interest_links: getActiveDropInterestLinkCount(),
      pending_world_update_worlds: pendingWorldUpdateBroadcasts.size,
      pending_world_updates: getPendingWorldUpdateCount(),
      config: {
        world_update_batching_enabled: Boolean(WORLD_UPDATE_BATCHING_ENABLED),
        world_update_batch_min_client_version: WORLD_UPDATE_BATCH_MIN_CLIENT_VERSION,
        world_update_batch_max_items: WORLD_UPDATE_BATCH_MAX_ITEMS,
        world_update_batch_interval_ms: WORLD_UPDATE_BATCH_INTERVAL_MS,
        drop_interest_management_enabled: isDropInterestManagementEnabled(),
        drop_interest_radius_pixels: DROP_INTEREST_RADIUS_PIXELS,
        drop_interest_leave_radius_pixels: DROP_INTEREST_LEAVE_RADIUS_PIXELS,
        drop_interest_sync_interval_ms: DROP_INTEREST_SYNC_INTERVAL_MS,
      },
    };
  }

  function isPacketTypeTelemetryEnabled(): boolean {
    return PACKET_SIZE_TELEMETRY_ENABLED === true;
  }

  function normalizePacketTypeName(rawType: unknown): string {
    return serverRuntimeStats.normalizePacketTypeName(rawType);
  }

  function recordPacketTypeSize(direction: string, rawMessageType: unknown, rawBytes: unknown): void {
    if (!isPacketTypeTelemetryEnabled()) return;

    const target = direction === "inbound"
      ? playerNetworkStats.inbound_packet_type_stats
      : playerNetworkStats.outbound_packet_type_stats;
    serverRuntimeStats.recordPacketTypeSize(target, rawMessageType, rawBytes, PACKET_TYPE_SIZE_SAMPLE_LIMIT);
  }

  function getPlayerNetworkStatsSnapshot(): PacketRecord {
    const inboundPacketTypeStats = serverRuntimeStats.getPacketTypeSizeStatsSnapshot(
      playerNetworkStats.inbound_packet_type_stats,
    );
    const outboundPacketTypeStats = serverRuntimeStats.getPacketTypeSizeStatsSnapshot(
      playerNetworkStats.outbound_packet_type_stats,
    );
    return {
      started_at: playerNetworkStats.started_at,
      inbound_messages_received: Number(playerNetworkStats.inbound_messages_received || 0),
      inbound_bytes_received: Number(playerNetworkStats.inbound_bytes_received || 0),
      inbound_messages_oversize_rejected: Number(playerNetworkStats.inbound_messages_oversize_rejected || 0),
      inbound_message_queue_pending: Number(playerNetworkStats.inbound_message_queue_pending || 0),
      inbound_message_queue_pending_max: Number(playerNetworkStats.inbound_message_queue_pending_max || 0),
      inbound_message_queue_max_socket_depth: Number(
        playerNetworkStats.inbound_message_queue_max_socket_depth || 0,
      ),
      inbound_message_queue_wait_samples: Number(playerNetworkStats.inbound_message_queue_wait_samples || 0),
      inbound_message_queue_wait_avg_ms: Number(playerNetworkStats.inbound_message_queue_wait_samples || 0) > 0
        ? Number((
          Number(playerNetworkStats.inbound_message_queue_wait_total_ms || 0)
          / Number(playerNetworkStats.inbound_message_queue_wait_samples || 1)
        ).toFixed(3))
        : 0,
      inbound_message_queue_wait_max_ms: Number(playerNetworkStats.inbound_message_queue_wait_max_ms || 0),
      coalesced_inbound_player_position_messages: Number(
        playerNetworkStats.coalesced_inbound_player_position_messages || 0,
      ),
      player_position_queue_wait_samples: Number(playerNetworkStats.player_position_queue_wait_samples || 0),
      player_position_queue_wait_avg_ms: Number(playerNetworkStats.player_position_queue_wait_samples || 0) > 0
        ? Number((
          Number(playerNetworkStats.player_position_queue_wait_total_ms || 0)
          / Number(playerNetworkStats.player_position_queue_wait_samples || 1)
        ).toFixed(3))
        : 0,
      player_position_queue_wait_max_ms: Number(playerNetworkStats.player_position_queue_wait_max_ms || 0),
      player_position_queue_wait_over_250ms: Number(
        playerNetworkStats.player_position_queue_wait_over_250ms || 0,
      ),
      player_position_queue_last_delay: playerNetworkStats.player_position_queue_last_delay
        ? { ...playerNetworkStats.player_position_queue_last_delay }
        : null,
      inbound_packet_type_stats: inboundPacketTypeStats,
      packet_type_sample_limit: PACKET_TYPE_SIZE_SAMPLE_LIMIT,
      player_position_messages_received: Number(playerNetworkStats.player_position_messages_received || 0),
      accepted_player_position_messages: Number(playerNetworkStats.accepted_player_position_messages || 0),
      rejected_player_position_messages: Number(playerNetworkStats.rejected_player_position_messages || 0),
      stale_player_position_messages: Number(playerNetworkStats.stale_player_position_messages || 0),
      corrected_player_position_messages: Number(playerNetworkStats.corrected_player_position_messages || 0),
      duplicated_player_position_heartbeats: Number(playerNetworkStats.duplicated_player_position_heartbeats || 0),
      queued_player_position_updates: Number(playerNetworkStats.queued_player_position_updates || 0),
      individual_presence_packets_sent: Number(playerNetworkStats.individual_presence_packets_sent || 0),
      batch_presence_packets_sent: Number(playerNetworkStats.batch_presence_packets_sent || 0),
      batch_player_items_sent: Number(playerNetworkStats.batch_player_items_sent || 0),
      batch_left_items_sent: Number(playerNetworkStats.batch_left_items_sent || 0),
      batch_fallback_individual_sends: Number(playerNetworkStats.batch_fallback_individual_sends || 0),
      interest_visible_deliveries: Number(playerNetworkStats.interest_visible_deliveries || 0),
      interest_culls_sent: Number(playerNetworkStats.interest_culls_sent || 0),
      receiver_interest_syncs: Number(playerNetworkStats.receiver_interest_syncs || 0),
      action_effect_packets_sent: Number(playerNetworkStats.action_effect_packets_sent || 0),
      action_effect_packets_skipped: Number(playerNetworkStats.action_effect_packets_skipped || 0),
      outbound_packets_attempted: Number(playerNetworkStats.outbound_packets_attempted || 0),
      outbound_bytes_sent: Number(playerNetworkStats.outbound_bytes_sent || 0),
      outbound_oversize_packets: Number(playerNetworkStats.outbound_oversize_packets || 0),
      outbound_packet_type_stats: outboundPacketTypeStats,
      outbound_backpressure_skips: Number(playerNetworkStats.outbound_backpressure_skips || 0),
      outbound_send_failures: Number(playerNetworkStats.outbound_send_failures || 0),
      movement_backpressure_queued_batches: Number(
        playerNetworkStats.movement_backpressure_queued_batches || 0,
      ),
      movement_backpressure_coalesced_batches: Number(
        playerNetworkStats.movement_backpressure_coalesced_batches || 0,
      ),
      movement_backpressure_replaced_items: Number(
        playerNetworkStats.movement_backpressure_replaced_items || 0,
      ),
      movement_backpressure_flushes: Number(playerNetworkStats.movement_backpressure_flushes || 0),
      movement_backpressure_dropped_items: Number(
        playerNetworkStats.movement_backpressure_dropped_items || 0,
      ),
      message_rate_limit_rejections: Number(playerNetworkStats.message_rate_limit_rejections || 0),
      bot_rate_limit_rejections: Number(playerNetworkStats.bot_rate_limit_rejections || 0),
      rate_limit_checks_by_bucket: copyCounterRecord(playerNetworkStats.rate_limit_checks_by_bucket),
      rate_limit_rejections_by_bucket: copyCounterRecord(playerNetworkStats.rate_limit_rejections_by_bucket),
      rate_limit_checks_by_subject_kind: copyCounterRecord(playerNetworkStats.rate_limit_checks_by_subject_kind),
      rate_limit_rejections_by_subject_kind: copyCounterRecord(playerNetworkStats.rate_limit_rejections_by_subject_kind),
      rate_limit_store_fallback_allows: Number(playerNetworkStats.rate_limit_store_fallback_allows || 0),
      rate_limit_last_rejection: playerNetworkStats.rate_limit_last_rejection
        ? { ...playerNetworkStats.rate_limit_last_rejection }
        : null,
      idempotency_duplicates: Number(playerNetworkStats.idempotency_duplicates || 0),
      idempotency_db_failures: Number(playerNetworkStats.idempotency_db_failures || 0),
      active_interest_receivers: playerInterestByReceiver.size,
      active_interest_links: getActivePlayerInterestLinkCount(),
      pending_position_worlds: pendingPlayerPositionBroadcasts.size,
      pending_position_updates: getPendingPlayerPositionUpdateCount(),
      config: {
        interest_management_enabled: isPlayerInterestManagementEnabled(),
        interest_radius_pixels: PLAYER_INTEREST_RADIUS_PIXELS,
        interest_leave_radius_pixels: PLAYER_INTEREST_LEAVE_RADIUS_PIXELS,
        player_action_interest_management_enabled: Boolean(PLAYER_ACTION_INTEREST_MANAGEMENT_ENABLED),
        position_batching_enabled: Boolean(PLAYER_POSITION_BATCHING_ENABLED),
        position_batch_min_client_version: PLAYER_POSITION_BATCH_MIN_CLIENT_VERSION,
        position_batch_max_items: PLAYER_POSITION_BATCH_MAX_ITEMS,
        position_broadcast_interval_ms: PLAYER_POSITION_BROADCAST_INTERVAL_MS,
        position_idle_heartbeat_ms: PLAYER_POSITION_IDLE_HEARTBEAT_MS,
        position_max_buffered_amount: PLAYER_POSITION_MAX_BUFFERED_AMOUNT,
        position_resume_buffered_amount: PLAYER_POSITION_RESUME_BUFFERED_AMOUNT,
        position_delivery_retry_ms: PLAYER_POSITION_DELIVERY_RETRY_MS,
        max_move_pixels_per_second: MAX_MOVE_PIXELS_PER_SECOND,
        max_move_accel_pixels_per_second2: MAX_MOVE_ACCEL_PIXELS_PER_SECOND2,
        movement_distance_grace_pixels: MOVEMENT_DISTANCE_GRACE_PIXELS,
        movement_max_elapsed_seconds: MOVEMENT_MAX_ELAPSED_SECONDS,
        movement_collision_guard_enabled: Boolean(MOVEMENT_COLLISION_GUARD_ENABLED),
        movement_correction_snap_distance: MOVEMENT_CORRECTION_SNAP_DISTANCE,
        netfox_trusted_player_state_enabled: Boolean(NETFOX_TRUSTED_PLAYER_STATE_ENABLED),
        custom_trusted_player_state_enabled: Boolean(CUSTOM_TRUSTED_PLAYER_STATE_ENABLED),
        trusted_movement_require_joined_world: Boolean(TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD),
        trusted_movement_allowlist_enabled: Boolean(TRUSTED_MOVEMENT_ALLOWLIST_ENABLED),
        trusted_movement_allowlist_count: TRUSTED_MOVEMENT_ALLOWLIST.size,
        max_packet_bytes: MAX_PACKET_BYTES,
        idempotency_ttl_ms: {
          default: IDEMPOTENCY_TTL_MS,
          critical: IDEMPOTENCY_TTL_MS_CRITICAL,
          world_action: IDEMPOTENCY_TTL_MS_WORLD_ACTION,
          combat: IDEMPOTENCY_TTL_MS_COMBAT,
        },
      },
    };
  }

  function startServerTickMonitor(): void {
    if (serverTickMonitorTimer) return;

    serverTickStats.enabled = true;
    serverTickStats.started_at = new Date().toISOString();
    serverTickStats.last_sample_at = "";
    serverTickStats.sample_count = 0;
    serverTickMonitorLastHrtime = processRuntime.hrtime.bigint();

    serverTickMonitorTimer = setInterval(() => {
      const now = processRuntime.hrtime.bigint() as bigint;
      const previous = serverTickMonitorLastHrtime || now;
      const elapsedMs = Number(now - previous) / 1_000_000;
      serverTickMonitorLastHrtime = now;
      serverRuntimeStats.applyServerTickSample(
        serverTickStats,
        elapsedMs,
        SERVER_TICK_MONITOR_INTERVAL_MS,
      );
    }, SERVER_TICK_MONITOR_INTERVAL_MS);

    if (typeof serverTickMonitorTimer.unref === "function") serverTickMonitorTimer.unref();
  }

  function writeCrashReport(event: unknown, details: PacketRecord = {}): void {
    try {
      const entry = {
        report_id: cryptoRandomUUID(),
        at: new Date().toISOString(),
        event: String(event || "unknown"),
        pid: processRuntime.pid,
        ppid: processRuntime.ppid,
        uptime_seconds: Math.round(processRuntime.uptime()),
        node_version: processRuntime.version,
        platform: processRuntime.platform,
        arch: processRuntime.arch,
        cwd: processRuntime.cwd(),
        memory_usage: processRuntime.memoryUsage(),
        ...details,
      };
      fileSystem.mkdirSync(pathModule.dirname(CRASH_REPORT_PATH), { recursive: true });
      fileSystem.appendFileSync(CRASH_REPORT_PATH, `${JSON.stringify(entry)}\n`, "utf8");
    } catch (error) {
      logger.error("[crash-report] failed to write crash report:", getErrorMessage(error));
    }
  }

  function handleFatalProcessError(event: string, error: unknown): void {
    markFatalCrashReportWritten();
    const errorDetails = errorToCrashDetails(error);
    writeCrashReport(event, {
      error: errorDetails,
      runtime: getCrashRuntimeState(),
    });
    logger.error(`[crash-report] ${event}:`, errorDetails.stack || errorDetails.message);
    exitProcess(1);
  }

  function sendHtml(response: any, statusCode: number, title: string, message: string): void {
    response.writeHead(statusCode, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07131d; color: #f3fbff; font-family: Arial, sans-serif; }
    main { max-width: 520px; padding: 32px; text-align: center; border: 2px solid #265a82; background: rgba(10, 28, 42, 0.92); box-shadow: 0 18px 60px rgba(0,0,0,.35); }
    h1 { margin: 0 0 12px; font-size: 32px; }
    p { margin: 0; font-size: 18px; line-height: 1.5; color: #ccecff; }
  </style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`);
  }

  function sendPasswordResetForm(response: any, token: unknown, message = ""): void {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reset PixelMania Password</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07131d; color: #f3fbff; font-family: Arial, sans-serif; }
    main { width: min(520px, calc(100vw - 40px)); padding: 32px; border: 2px solid #265a82; background: rgba(10, 28, 42, 0.92); box-shadow: 0 18px 60px rgba(0,0,0,.35); }
    h1 { margin: 0 0 12px; font-size: 32px; text-align: center; }
    p { margin: 0 0 18px; font-size: 16px; line-height: 1.5; color: #ccecff; text-align: center; }
    label { display: block; margin: 14px 0 6px; color: #ccecff; }
    input { width: 100%; box-sizing: border-box; padding: 12px; background: #07131d; border: 2px solid #4f8aa9; color: #f3fbff; font-size: 16px; }
    button { width: 100%; margin-top: 18px; padding: 12px; border: 0; background: #f1c232; color: #1a1200; font-size: 18px; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>Reset Password</h1>
    <p>${escapeHtml(message || "Enter a new PixelMania password.")}</p>
    <form method="post" action="/reset-password">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <label for="password">New password</label>
      <input id="password" name="password" type="password" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}">
      <label for="confirm_password">Confirm password</label>
      <input id="confirm_password" name="confirm_password" type="password" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}">
      <button type="submit">Change Password</button>
    </form>
  </main>
</body>
</html>`);
  }

  function sendHttpJson(response: any, statusCode: number, payload: unknown): void {
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(payload));
  }

  function readFormHttpRequestBody(request: any, maxBytes = 16384): Promise<PacketRecord> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      request.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          reject(new Error("request_body_too_large"));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });

      request.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const params = new URLSearchParams(text);
        const body: PacketRecord = {};
        for (const [key, value] of params.entries()) {
          body[key] = value;
        }
        resolve(body);
      });

      request.on("error", reject);
    });
  }

  function readJsonHttpRequestBody(request: any, maxBytes = 16384): Promise<PacketRecord> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      request.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          reject(new Error("request_body_too_large"));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });

      request.on("end", () => {
        if (totalBytes === 0) {
          resolve({});
          return;
        }

        try {
          const text = Buffer.concat(chunks).toString("utf8");
          const parsed = JSON.parse(text);
          resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
        } catch {
          reject(new Error("invalid_json_body"));
        }
      });

      request.on("error", reject);
    });
  }

  async function handleNetfoxVerifySpawnTicketHttpRequest(request: any, response: any): Promise<void> {
    if (!isNetfoxServerWorldStateEndpointConfigured()) {
      sendHttpJson(response, 503, {
        ok: false,
        error: "Netfox server authentication is not configured.",
      });
      return;
    }

    if (!verifyNetfoxServerWorldStateRequest(request)) {
      sendHttpJson(response, 401, {
        ok: false,
        error: "Unauthorized Netfox server spawn verification request.",
      });
      return;
    }

    let body: PacketRecord;
    try {
      body = await readJsonHttpRequestBody(request);
    } catch (error) {
      sendHttpJson(response, getErrorMessage(error) === "request_body_too_large" ? 413 : 400, {
        ok: false,
        error: getErrorMessage(error) === "request_body_too_large"
          ? "Request body too large."
          : "Invalid JSON body.",
      });
      return;
    }

    const verification = verifyNetfoxSpawnTicketPayload(body);
    if (!verification.ok) {
      sendHttpJson(response, verification.status || 401, {
        ok: false,
        error: verification.error || "Netfox spawn ticket rejected.",
        reason: verification.reason || "spawn_ticket_invalid",
      });
      return;
    }

    sendHttpJson(response, 200, {
      ok: true,
      world: verification.world,
      peer_id: verification.peer_id,
      identity: verification.identity,
    });
  }

  async function handleNetfoxRegisterRouteHttpRequest(request: any, response: any): Promise<void> {
    if (!isNetfoxServerWorldStateEndpointConfigured()) {
      sendHttpJson(response, 503, {
        ok: false,
        error: "Netfox server authentication is not configured.",
      });
      return;
    }

    if (!verifyNetfoxServerWorldStateRequest(request)) {
      sendHttpJson(response, 401, {
        ok: false,
        error: "Unauthorized Netfox server route registration request.",
      });
      return;
    }

    let body: PacketRecord;
    try {
      body = await readJsonHttpRequestBody(request);
    } catch (error) {
      sendHttpJson(response, getErrorMessage(error) === "request_body_too_large" ? 413 : 400, {
        ok: false,
        error: getErrorMessage(error) === "request_body_too_large"
          ? "Request body too large."
          : "Invalid JSON body.",
      });
      return;
    }

    const route = await registerNetfoxMovementRoute(body);
    sendHttpJson(response, 200, {
      ok: true,
      route,
      route_ttl_ms: NETFOX_MOVEMENT_ROUTE_TTL_MS,
    });
  }

  async function handleNetfoxGetRouteHttpRequest(request: any, response: any, url: URL): Promise<void> {
    if (!isNetfoxServerWorldStateEndpointConfigured()) {
      sendHttpJson(response, 503, {
        ok: false,
        error: "Netfox server authentication is not configured.",
      });
      return;
    }

    if (!verifyNetfoxServerWorldStateRequest(request)) {
      sendHttpJson(response, 401, {
        ok: false,
        error: "Unauthorized Netfox server route lookup request.",
      });
      return;
    }

    const worldName = cleanWorld(url.searchParams.get("world") || "START");
    const route = await getNetfoxMovementRouteForWorld(worldName);
    sendHttpJson(response, 200, {
      ok: true,
      world: worldName,
      route_found: Boolean(route),
      route: route || null,
      route_ttl_ms: NETFOX_MOVEMENT_ROUTE_TTL_MS,
      static_fallback_enabled: NETFOX_MOVEMENT_ALLOW_STATIC_FALLBACK,
      redis_ready: redisStore.isReady(),
    });
  }

  async function handleHttpRequest(request: any, response: any): Promise<void> {
    let url: URL;
    try {
      url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    } catch {
      sendHtml(response, 400, "Bad Request", "That verification link is not valid.");
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const redisHealth = await redisStore.getHealthSnapshot();
      sendHttpJson(response, 200, {
        ok: true,
        service: "PixelManiaServer",
        release_id: String(process.env.PIXELMANIA_RELEASE_ID || ""),
        server_client_version: SERVER_CLIENT_VERSION,
        min_client_version: MIN_CLIENT_VERSION,
        features: {
          world_update_requester_echo: true,
          world_update_requester_player_data: true,
          world_update_batch: true,
          world_player_index: true,
          redis_world_admission: true,
          world_route_ownership: true,
          world_route_enforcement: WORLD_ROUTE_ENFORCEMENT_ENABLED,
          netfox_movement: {
            enabled: NETFOX_MOVEMENT_ENABLED,
            public_host: NETFOX_MOVEMENT_PUBLIC_HOST,
            public_port: NETFOX_MOVEMENT_PUBLIC_PORT,
            max_clients: NETFOX_MOVEMENT_MAX_CLIENTS,
            route_ttl_ms: NETFOX_MOVEMENT_ROUTE_TTL_MS,
            route_stats: getNetfoxMovementRouteStats(),
            spawn_ticket_configured: isNetfoxSpawnTicketConfigured(),
            ticket_ttl_ms: NETFOX_SPAWN_TICKET_TTL_MS,
          },
          max_players_per_world: MAX_PLAYERS_PER_WORLD,
          world_admission_ttl_ms: WORLD_ADMISSION_TTL_MS,
          world_route_ttl_ms: WORLD_ROUTE_TTL_MS,
          server_instance_id: SERVER_INSTANCE_ID,
          trusted_position_windows_ms: {
            default: MAX_TRUSTED_POSITION_AGE_MS,
            world_action: MAX_TRUSTED_POSITION_AGE_MS_WORLD_ACTION,
            combat: MAX_TRUSTED_POSITION_AGE_MS_COMBAT,
          },
        },
        persistence: {
          postgres_ready: postgresStore.isReady(),
          postgres_authoritative: Boolean(postgresStore.isReady() && POSTGRES_AUTHORITATIVE),
          redis_ready: redisStore.isReady(),
          redis_stats: redisHealth,
          world_save_config: {
            save_debounce_ms: SAVE_DEBOUNCE_MS,
            non_critical_world_save_debounce_ms: WORLD_NON_CRITICAL_WORLD_SAVE_DEBOUNCE_MS,
            json_backup_debounce_ms: WORLD_JSON_BACKUP_DEBOUNCE_MS,
            json_backup_while_pg_ready: WORLD_JSON_BACKUP_WHEN_PG_READY,
            legacy_world_state_import_allowed: ALLOW_LEGACY_WORLD_STATE_IMPORT,
          },
          idempotency_config: {
            ttl_ms: IDEMPOTENCY_TTL_MS,
            ttl_ms_critical: IDEMPOTENCY_TTL_MS_CRITICAL,
            ttl_ms_world_action: IDEMPOTENCY_TTL_MS_WORLD_ACTION,
            ttl_ms_combat: IDEMPOTENCY_TTL_MS_COMBAT,
          },
          world_snapshot_storage: {
            mode: WORLD_SNAPSHOT_STORAGE,
            spaces_enabled: worldSnapshotStorageIsSpaces(),
            spaces_target_configured: Boolean(WORLD_SNAPSHOT_SPACES_TARGET),
            spaces_endpoint_configured: Boolean(WORLD_SNAPSHOT_SPACES_ENDPOINT),
            postgres_inline: WORLD_SNAPSHOT_POSTGRES_INLINE,
          },
          world_snapshot_scheduler: {
            enabled: worldSnapshotSchedulerState.enabled,
            interval_minutes: WORLD_SNAPSHOT_INTERVAL_MINUTES,
            interval_ms: WORLD_SNAPSHOT_INTERVAL_MS,
            max_worlds_per_cycle: WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE,
            startup_run_enabled: WORLD_SNAPSHOT_STARTUP_RUN,
            running: getWorldSnapshotSchedulerRunning(),
            last_run_at: worldSnapshotSchedulerState.last_run_at || null,
            last_duration_ms: worldSnapshotSchedulerState.last_duration_ms,
            last_world_count: worldSnapshotSchedulerState.last_world_count,
            last_error: worldSnapshotSchedulerState.last_error || "",
          },
          persistence_queue: {
            pending_world_save_timers: worldSaveTimers.size,
            pending_world_json_backups: pendingWorldJsonBackups.size,
            pending_world_json_timers: worldJsonBackupTimers.size,
            pending_persistence_writes: pendingPersistenceWrites.size,
          },
          server_tick: getServerTickSnapshot(),
          process_runtime: getProcessRuntimeSnapshot(),
          player_network: getPlayerNetworkStatsSnapshot(),
          world_network: getWorldNetworkStatsSnapshot(),
          world_index: getWorldIndexStatsSnapshot(),
          world_route: getWorldRouteStatsSnapshot(),
        },
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/netfox/server/register-route") {
      await handleNetfoxRegisterRouteHttpRequest(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/netfox/server/route") {
      await handleNetfoxGetRouteHttpRequest(request, response, url);
      return;
    }

    if (request.method === "POST" && url.pathname === "/netfox/server/verify-spawn-ticket") {
      await handleNetfoxVerifySpawnTicketHttpRequest(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/netfox/server/world-state") {
      if (!isNetfoxServerWorldStateEndpointConfigured()) {
        sendHttpJson(response, 503, {
          ok: false,
          error: "Netfox server world-state endpoint is not configured.",
        });
        return;
      }

      if (!verifyNetfoxServerWorldStateRequest(request)) {
        sendHttpJson(response, 401, {
          ok: false,
          error: "Unauthorized Netfox server world-state request.",
        });
        return;
      }

      const worldName = cleanWorld(url.searchParams.get("world") || "START");
      await refreshWorldDropsFromPostgres(worldName, "netfox_server_world_load");
      const payload = buildNetfoxWorldStateHttpPayload(worldName, "netfox_server_world_load");
      logger.log("[netfox_server_world_state] served", {
        world: payload.world,
        blocks: payload.block_count,
        background_blocks: payload.background_block_count,
        collision_blocks: payload.collision_block_count,
      });
      sendHttpJson(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/custom-movement/server/world-state") {
      if (!isCustomMovementServerWorldStateEndpointConfigured()) {
        sendHttpJson(response, 503, {
          ok: false,
          error: "Custom movement server world-state endpoint is not configured.",
        });
        return;
      }

      if (!verifyCustomMovementServerWorldStateRequest(request)) {
        sendHttpJson(response, 401, {
          ok: false,
          error: "Unauthorized custom movement server world-state request.",
        });
        return;
      }

      const worldName = cleanWorld(url.searchParams.get("world") || "START");
      await refreshWorldDropsFromPostgres(worldName, "custom_authoritative_server_world_load");
      const payload = buildNetfoxWorldStateHttpPayload(worldName, "custom_authoritative_server_world_load");
      logger.log("[custom_movement_server_world_state] served", {
        world: payload.world,
        blocks: payload.block_count,
        background_blocks: payload.background_block_count,
        collision_blocks: payload.collision_block_count,
      });
      sendHttpJson(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/dev/netfox/world-state") {
      if (!NETFOX_ARCHIVE_TOOLS_ALLOWED) {
        sendHttpJson(response, 403, {
          ok: false,
          error: "[SECURITY] Dev Netfox world-state endpoint is disabled outside archived development tools.",
        });
        return;
      }

      const worldName = cleanWorld(url.searchParams.get("world") || "NETFOX_TEST");
      await refreshWorldDropsFromPostgres(worldName, "netfox_archive_world_load");
      const payload = buildNetfoxWorldStateHttpPayload(worldName, "netfox_archive_world_load");
      logger.log("[dev_netfox_world_state] served", {
        world: payload.world,
        blocks: payload.block_count,
        background_blocks: payload.background_block_count,
        collision_blocks: payload.collision_block_count,
      });
      sendHttpJson(response, 200, payload);
      return;
    }

    if (request.method === "GET" && url.pathname === "/dev/custom-movement/world-state") {
      if (!DEV_BACKEND_LOGIN_ALLOWED) {
        sendHttpJson(response, 403, {
          ok: false,
          error: "[SECURITY] Dev custom movement world-state endpoint is disabled outside development tools.",
        });
        return;
      }

      const worldName = cleanWorld(url.searchParams.get("world") || "TEST");
      await refreshWorldDropsFromPostgres(worldName, "custom_authoritative_world_load");
      const payload = buildNetfoxWorldStateHttpPayload(worldName, "custom_authoritative_world_load");
      logger.log("[dev_custom_movement_world_state] served", {
        world: payload.world,
        blocks: payload.block_count,
        background_blocks: payload.background_block_count,
        collision_blocks: payload.collision_block_count,
      });
      sendHttpJson(response, 200, payload);
      return;
    }

    if (request.method === "POST" && url.pathname === "/iap/stripe/webhook") {
      await handleStripeIapWebhook(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/verify-email") {
      const result = await verifyEmailToken(url.searchParams.get("token") || "");
      sendHtml(
        response,
        result.ok ? 200 : 400,
        result.ok ? "Email Verified" : "Verification Failed",
        result.message,
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/reset-password") {
      const token = String(url.searchParams.get("token") || "").trim();
      if (token === "") {
        sendHtml(response, 400, "Reset Failed", "This password reset link is missing its token.");
        return;
      }
      sendPasswordResetForm(response, token);
      return;
    }

    if (request.method === "POST" && url.pathname === "/reset-password") {
      let body: PacketRecord;
      try {
        body = await readFormHttpRequestBody(request);
      } catch (error) {
        sendHtml(
          response,
          getErrorMessage(error) === "request_body_too_large" ? 413 : 400,
          "Reset Failed",
          "Could not read this password reset form.",
        );
        return;
      }

      const token = String(body.token || "").trim();
      const password = String(body.password || "");
      const confirmPassword = String(body.confirm_password || "");
      if (password !== confirmPassword) {
        sendPasswordResetForm(response, token, "Passwords do not match.");
        return;
      }

      const result = await applyPasswordResetToken(token, password);
      sendHtml(
        response,
        result.ok ? 200 : 400,
        result.ok ? "Password Changed" : "Reset Failed",
        result.message,
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/change-email") {
      const result = await confirmEmailChangeToken(url.searchParams.get("token") || "");
      sendHtml(
        response,
        result.ok ? 200 : 400,
        result.ok ? "Email Changed" : "Email Change Failed",
        result.message,
      );
      return;
    }

    sendHtml(
      response,
      404,
      "PixelMania Server",
      "This server endpoint is for PixelMania account verification.",
    );
  }

  async function bootstrapServer(): Promise<void> {
    await redisStore.init();
    await postgresStore.init();
    assertAuthoritativePostgresReady("startup");
    await loadPersistentState();
    await recoverWorldEventsAfterLoad();
    startServerTickMonitor();
    startWorldEventRandomScheduler();
    startCalendarEventScheduler();
    startAntiDupeAuditScanner();
    startPeriodicWorldSnapshotScheduler();
    startHttpServer();
  }

  function startHttpServer(): void {
    httpServer.listen(PORT, HOST, () => {
      logger.log(`PixelMania server listening privately at ws://${HOST}:${PORT}`);
      logger.log(`PixelMania public HTTPS base: ${PUBLIC_BASE_URL}`);
      logger.log(`PixelMania public WSS endpoint: ${PUBLIC_WS_URL}`);
      logger.log(`PixelMania instance id: ${SERVER_INSTANCE_ID}`);
      logger.log(`PixelMania world route endpoint: ${SERVER_INSTANCE_WS_URL}`);
      logger.log(`PixelMania world route enforcement: ${WORLD_ROUTE_ENFORCEMENT_ENABLED ? "enabled" : "disabled"} (ttl=${WORLD_ROUTE_TTL_MS}ms).`);
      logger.log(`PixelMania PostgreSQL authoritative gameplay gate: ${REQUIRE_POSTGRES_AUTHORITATIVE_FOR_GAMEPLAY ? "enabled" : "disabled"}.`);
      logger.log(`PixelMania email verification running at ${PUBLIC_BASE_URL}/verify-email`);
      if (postgresStore.isReady() && POSTGRES_AUTHORITATIVE) {
        logger.log(`PixelMania persistence: PostgreSQL authoritative (schema=${POSTGRES_SCHEMA}).`);
      } else if (POSTGRES_ENABLED) {
        if (POSTGRES_AUTHORITATIVE) {
          logger.warn("PixelMania persistence: PostgreSQL authoritative mode is enabled but not ready; explicit JSON fallback is active and unsafe for production.");
        } else {
          logger.warn("PixelMania persistence: PostgreSQL is enabled but not ready; using JSON fallback.");
        }
      } else {
        logger.warn("PixelMania persistence: JSON fallback is active because POSTGRES_ENABLED=false.");
      }
      if (redisStore.isReady()) {
        logger.log("PixelMania live cache: Redis enabled.");
      } else if (REDIS_ENABLED) {
        logger.warn("PixelMania live cache: Redis is enabled but not ready; using in-memory live state.");
      } else {
        logger.warn("PixelMania live cache: in-memory only because REDIS_ENABLED=false.");
      }
      if (WORLD_ROUTE_ENFORCEMENT_ENABLED && REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT && !REDIS_ENABLED) {
        logger.warn("PixelMania world route enforcement is enabled and requires Redis, but REDIS_ENABLED=false; routed actions will be rejected.");
      }
      if (
        WORLD_ROUTE_ENFORCEMENT_ENABLED
        && REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT
        && REDIS_ENABLED
        && !redisStore.isReady()
      ) {
        logger.warn("PixelMania world route enforcement requires Redis readiness; routed world actions will be rejected.");
      }
      if (
        WORLD_ROUTE_ENFORCEMENT_ENABLED
        && !REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT
        && !redisStore.isReady()
      ) {
        logger.warn("PixelMania world route enforcement is enabled but Redis readiness is not required; routing falls back to local instance ownership until Redis is healthy.");
      }
      if (HOST === "0.0.0.0" || HOST === "::") {
        logger.warn("HOST is bound to all interfaces. Keep port 8080 blocked by firewall unless this is intentional.");
      }
      if (!SMTP_HOST) {
        logger.warn("SMTP_HOST is not set. Verification links will be printed to the server console instead of emailed.");
      }
    });
  }

  return {
    bootstrapServer,
    getActiveDropInterestLinkCount,
    getActivePlayerInterestLinkCount,
    getCrashRuntimeState,
    getPendingPlayerPositionUpdateCount,
    getPendingWorldUpdateCount,
    getPlayerNetworkStatsSnapshot,
    getProcessRuntimeSnapshot,
    getServerTickSnapshot,
    getWorldNetworkStatsSnapshot,
    handleFatalProcessError,
    handleHttpRequest,
    handleNetfoxGetRouteHttpRequest,
    handleNetfoxRegisterRouteHttpRequest,
    handleNetfoxVerifySpawnTicketHttpRequest,
    isPacketTypeTelemetryEnabled,
    normalizePacketTypeName,
    readFormHttpRequestBody,
    readJsonHttpRequestBody,
    recordPacketTypeSize,
    sendHtml,
    sendHttpJson,
    sendPasswordResetForm,
    startHttpServer,
    startServerTickMonitor,
    writeCrashReport,
  };
}

export = {
  createServerPhase11aRuntime,
  installConsoleWriteGuard,
  isBrokenStdIoError,
};
