// Generated from src/server_admin_lookup_routes.ts. Do not edit by hand.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function toErrorMessage(error) {
    return error && error.message ? String(error.message) : String(error || "unknown");
}
function createServerAdminLookupRoutes(deps) {
    const { ADMIN_INVENTORY_LOOKUP_FIELDS, ADMIN_INVENTORY_LOOKUP_PURPOSE, ADMIN_ITEM_INSTANCE_HISTORY_LOOKUP_PURPOSE, ADMIN_ITEM_INSTANCE_LOOKUP_LIMIT, ADMIN_ITEM_INSTANCE_LOOKUP_PURPOSE, ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS, ADMIN_MONITORING_DASHBOARD_LOOKUP_LIMIT, ADMIN_MONITORING_DASHBOARD_PURPOSE, ADMIN_MONITORING_DASHBOARD_WINDOW_HOURS, ADMIN_TRANSACTION_LEDGER_LOOKUP_LIMIT, ADMIN_TRANSACTION_LEDGER_LOOKUP_PURPOSE, MAX_PLAYER_INVENTORY_KEYS, PLAYER_LEVEL_MAX, PLAYER_LEVEL_MIN, WORLD_SNAPSHOT_INTERVAL_MINUTES, WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE, accountKey, accounts, activeTrades, cleanAccountName, cleanInventoryCategory, cleanName, cleanText, cleanWorld, clampInteger, clampString, createDefaultPlayerState, doesAccountExist, ensurePlayerState, findOnlinePlayerByUsername, getAccountRole, getDeveloperSecurityRequirement, getPlayerNetworkStatsSnapshot, getServerTickSnapshot, getWorldIndexStatsSnapshot, getWorldPopulationCount, getWorldSnapshotSchedulerRunning, isAdmin, isPostgresAuthoritativeReady, logAdminAction, logSecurityEvent, pendingPersistenceWrites, playerStates, players, postgresStore, redisStore, sanitizeCountDictionary, sanitizeStringArray, sendJson, withTimeout, worldPlayers, worldSnapshotSchedulerState, worldStates, wss, } = deps;
    function buildAdminInventoryLookupPlayerData(username, state) {
        const clean = cleanAccountName(username);
        const source = state && typeof state === "object" && !Array.isArray(state)
            ? state
            : createDefaultPlayerState(clean);
        if (!source)
            return {};
        const payload = {
            account_username: cleanAccountName(source.account_username || source.username || clean),
            player_level: clampInteger(source.player_level || PLAYER_LEVEL_MIN, PLAYER_LEVEL_MIN, PLAYER_LEVEL_MAX),
            player_title: clampString(source.player_title || ""),
            selected_item_type: clampString(source.selected_item_type || ""),
            selected_item_category: cleanInventoryCategory(source.selected_item_category || ""),
            primary_hotbar_tool: clampString(source.primary_hotbar_tool || ""),
            hotbar_items: sanitizeStringArray(source.hotbar_items, 16),
            hotbar_item_categories: sanitizeStringArray(source.hotbar_item_categories, 16),
            equipped_tool: clampString(source.equipped_tool || ""),
            equipped_back_item: clampString(source.equipped_back_item || ""),
            equipped_hat_item: clampString(source.equipped_hat_item || ""),
            equipped_hair_item: clampString(source.equipped_hair_item || ""),
            equipped_eyewear_item: clampString(source.equipped_eyewear_item || ""),
            equipped_shirt_item: clampString(source.equipped_shirt_item || ""),
            equipped_pants_item: clampString(source.equipped_pants_item || ""),
            equipped_shoes_item: clampString(source.equipped_shoes_item || ""),
            equipped_ride_item: clampString(source.equipped_ride_item || ""),
            saved_at: String(source.saved_at || "").slice(0, 64),
        };
        for (const spec of ADMIN_INVENTORY_LOOKUP_FIELDS) {
            payload[spec.field] = sanitizeCountDictionary(source[spec.field], MAX_PLAYER_INVENTORY_KEYS, spec.category);
        }
        return payload;
    }
    function sendAdminInventoryLookupFailure(socket, requestId, targetUsername, message, extra = {}) {
        sendJson(socket, {
            type: "player_state",
            ok: false,
            found: false,
            request_id: requestId,
            purpose: ADMIN_INVENTORY_LOOKUP_PURPOSE,
            action: ADMIN_INVENTORY_LOOKUP_PURPOSE,
            username: cleanAccountName(targetUsername),
            message,
            ...extra,
        });
    }
    function sendAdminItemInstanceLookupFailure(socket, requestId, targetUsername, message, extra = {}) {
        sendJson(socket, {
            type: "player_state",
            ok: false,
            found: false,
            request_id: requestId,
            purpose: ADMIN_ITEM_INSTANCE_LOOKUP_PURPOSE,
            action: ADMIN_ITEM_INSTANCE_LOOKUP_PURPOSE,
            username: cleanAccountName(targetUsername),
            message,
            ...extra,
        });
    }
    function sendAdminItemInstanceHistoryLookupFailure(socket, requestId, targetUsername, itemInstanceId, message, extra = {}) {
        sendJson(socket, {
            type: "player_state",
            ok: false,
            found: false,
            request_id: requestId,
            purpose: ADMIN_ITEM_INSTANCE_HISTORY_LOOKUP_PURPOSE,
            action: ADMIN_ITEM_INSTANCE_HISTORY_LOOKUP_PURPOSE,
            username: cleanAccountName(targetUsername),
            item_instance_id: cleanAccountName(itemInstanceId),
            message,
            ...extra,
        });
    }
    function sendAdminTransactionLedgerLookupFailure(socket, requestId, targetUsername, itemInstanceId, message, extra = {}) {
        sendJson(socket, {
            type: "player_state",
            ok: false,
            found: false,
            request_id: requestId,
            purpose: ADMIN_TRANSACTION_LEDGER_LOOKUP_PURPOSE,
            action: ADMIN_TRANSACTION_LEDGER_LOOKUP_PURPOSE,
            username: cleanAccountName(targetUsername),
            item_instance_id: cleanAccountName(itemInstanceId),
            message,
            ...extra,
        });
    }
    function sendAdminMonitoringDashboardFailure(socket, requestId, targetUsername, message, extra = {}) {
        sendJson(socket, {
            type: "player_state",
            ok: false,
            found: false,
            request_id: requestId,
            purpose: ADMIN_MONITORING_DASHBOARD_PURPOSE,
            action: ADMIN_MONITORING_DASHBOARD_PURPOSE,
            username: cleanAccountName(targetUsername),
            message,
            ...extra,
        });
    }
    function buildAdminMonitoringOnlinePlayers(limit = 100) {
        const rows = [];
        const cappedLimit = clampInteger(limit, 1, 250);
        for (const player of players.values()) {
            if (!player || !player.authenticated)
                continue;
            rows.push({
                username: cleanAccountName(player.account_username || player.name || ""),
                display_name: cleanText(player.name || player.account_username || ""),
                role: cleanName(player.role || getAccountRole(player.account_username || "")),
                world: cleanWorld(player.world || player.current_world || ""),
                x: clampInteger(player.x || 0, -999999, 999999),
                y: clampInteger(player.y || 0, -999999, 999999),
                joined_world: Boolean(player.joined_world),
                connected_at: String(player.connected_at || ""),
                last_seen_at: String(player.last_seen_at || ""),
            });
        }
        rows.sort((a, b) => {
            const worldCompare = String(a.world || "").localeCompare(String(b.world || ""));
            if (worldCompare !== 0)
                return worldCompare;
            return String(a.username || "").localeCompare(String(b.username || ""));
        });
        return rows.slice(0, cappedLimit);
    }
    function buildAdminMonitoringWorldRows(limit = 100) {
        const worldRows = [];
        const playerCounts = new Map();
        for (const worldName of Array.from(worldPlayers.keys())) {
            const count = getWorldPopulationCount(worldName);
            if (count > 0)
                playerCounts.set(cleanWorld(worldName), count);
        }
        for (const [worldName, state] of worldStates.entries()) {
            const drops = state?.drops && typeof state.drops === "object" && !Array.isArray(state.drops)
                ? Object.keys(state.drops).length
                : 0;
            worldRows.push({
                world_name: cleanWorld(worldName),
                online_players: clampInteger(playerCounts.get(cleanWorld(worldName)) || 0, 0, 999999),
                drop_count: clampInteger(drops, 0, 999999),
                saved_at: String(state?.saved_at || ""),
                updated_at: String(state?.updated_at || ""),
            });
        }
        worldRows.sort((a, b) => {
            const playerCompare = clampInteger(b.online_players || 0, 0, 999999) - clampInteger(a.online_players || 0, 0, 999999);
            if (playerCompare !== 0)
                return playerCompare;
            return String(a.world_name || "").localeCompare(String(b.world_name || ""));
        });
        return worldRows.slice(0, clampInteger(limit, 1, 250));
    }
    function buildAdminMonitoringRuntimeSnapshot(limit = 100) {
        const memory = process.memoryUsage();
        return {
            generated_at: new Date().toISOString(),
            uptime_seconds: Math.max(0, Math.round(process.uptime())),
            connected_sockets: wss.clients.size,
            online_player_count: players.size,
            authenticated_player_count: Array.from(players.values()).filter((player) => Boolean(player?.authenticated)).length,
            loaded_world_count: worldStates.size,
            loaded_player_state_count: playerStates.size,
            tracked_account_count: accounts.size,
            active_trade_count: activeTrades.size,
            pending_persistence_writes: pendingPersistenceWrites.size,
            redis_ready: redisStore.isReady(),
            postgres_ready: postgresStore.isReady(),
            memory: {
                rss_mb: Number((memory.rss / 1024 / 1024).toFixed(2)),
                heap_used_mb: Number((memory.heapUsed / 1024 / 1024).toFixed(2)),
                heap_total_mb: Number((memory.heapTotal / 1024 / 1024).toFixed(2)),
                external_mb: Number((memory.external / 1024 / 1024).toFixed(2)),
            },
            server_tick: getServerTickSnapshot(),
            player_network: getPlayerNetworkStatsSnapshot(),
            world_index: getWorldIndexStatsSnapshot(),
            world_snapshot_scheduler: {
                enabled: Boolean(worldSnapshotSchedulerState.enabled),
                interval_minutes: WORLD_SNAPSHOT_INTERVAL_MINUTES,
                max_worlds_per_cycle: WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE,
                running: Boolean(getWorldSnapshotSchedulerRunning()),
                last_run_at: worldSnapshotSchedulerState.last_run_at || "",
                last_duration_ms: clampInteger(worldSnapshotSchedulerState.last_duration_ms || 0, 0, 999999999),
                last_world_count: clampInteger(worldSnapshotSchedulerState.last_world_count || 0, 0, 999999),
                last_error: cleanText(worldSnapshotSchedulerState.last_error || ""),
            },
            online_players: buildAdminMonitoringOnlinePlayers(limit),
            loaded_worlds: buildAdminMonitoringWorldRows(limit),
        };
    }
    function buildAdminItemInstanceLookupRows(itemInstances) {
        const rows = Array.isArray(itemInstances) ? itemInstances : [];
        return rows.map((entry) => ({
            item_instance_id: cleanAccountName(entry.item_instance_id || ""),
            public_item_instance_id: cleanAccountName(entry.public_item_instance_id || ""),
            item_type: cleanAccountName(entry.item_type || ""),
            item_category: cleanAccountName(entry.item_category || ""),
            state: cleanAccountName(entry.state || ""),
            created_by_source: cleanAccountName(entry.created_by_source || ""),
            current_location: cleanAccountName(entry.current_location || ""),
            created_at: String(entry.created_at || ""),
            updated_at: String(entry.updated_at || ""),
        }));
    }
    function buildAdminTransactionLedgerLookupRows(entries) {
        const rows = Array.isArray(entries) ? entries : [];
        return rows.map((entry) => ({
            transaction_ledger_id: Number(entry.transaction_ledger_id || 0),
            transaction_id: cleanAccountName(entry.transaction_id || ""),
            transaction_type: cleanAccountName(entry.transaction_type || ""),
            status: cleanAccountName(entry.status || ""),
            username: cleanAccountName(entry.username || ""),
            other_username: cleanAccountName(entry.other_username || ""),
            world_name: cleanWorld(entry.world_name || ""),
            item_instance_id: cleanAccountName(entry.item_instance_id || ""),
            public_item_instance_id: cleanAccountName(entry.public_item_instance_id || ""),
            item_type: cleanAccountName(entry.item_type || ""),
            item_category: cleanInventoryCategory(entry.item_category || ""),
            quantity: clampInteger(entry.quantity || 0, -999999999999, 999999999999),
            gems_before: entry.gems_before == null ? null : clampInteger(entry.gems_before || 0, -999999999999, 999999999999),
            gems_after: entry.gems_after == null ? null : clampInteger(entry.gems_after || 0, -999999999999, 999999999999),
            inventory_before_hash: cleanAccountName(entry.inventory_before_hash || ""),
            inventory_after_hash: cleanAccountName(entry.inventory_after_hash || ""),
            ip_address: cleanAccountName(entry.ip_address || ""),
            request_id: cleanAccountName(entry.request_id || ""),
            correlation_id: cleanAccountName(entry.correlation_id || ""),
            source: cleanAccountName(entry.source || ""),
            action: cleanAccountName(entry.action || ""),
            metadata: entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? entry.metadata : {},
            server_time: String(entry.server_time || ""),
            created_at: String(entry.created_at || ""),
        }));
    }
    function handleAdminInventoryLookupRequest(socket, player, data, username, requestId, purpose) {
        const targetUsername = cleanAccountName(data.target_username || data.requested_username || username);
        const logBase = {
            request_id: requestId,
            purpose,
            target_username: targetUsername,
            world: cleanWorld(data.world || player.world || "START"),
        };
        const deny = (message, details = {}, extra = {}) => {
            logAdminAction(socket, player, "admin_inventory_lookup_denied", { ...logBase, ...details }, false, message);
            logSecurityEvent(socket, player, "admin_inventory_lookup_denied", { ...logBase, ...details, message }, "warning");
            sendAdminInventoryLookupFailure(socket, requestId, targetUsername, message, extra);
        };
        if (!isAdmin(player)) {
            deny("Inventory lookup is only available to admins.");
            return;
        }
        const securityRequirement = getDeveloperSecurityRequirement(player);
        if (!securityRequirement.ok) {
            deny(securityRequirement.message, { reason: securityRequirement.reason }, securityRequirement.extra);
            return;
        }
        if (targetUsername === "") {
            logAdminAction(socket, player, "admin_inventory_lookup", logBase, false, "Target username is required.");
            sendAdminInventoryLookupFailure(socket, requestId, targetUsername, "Target username is required.");
            return;
        }
        const state = ensurePlayerState(targetUsername);
        const found = Boolean(state) || doesAccountExist(targetUsername);
        if (!found) {
            logAdminAction(socket, player, "admin_inventory_lookup", logBase, false, "Target account does not exist.");
            sendAdminInventoryLookupFailure(socket, requestId, targetUsername, "Target account does not exist.");
            return;
        }
        const target = findOnlinePlayerByUsername(targetUsername);
        const account = accounts.get(accountKey(targetUsername)) || null;
        const displayUsername = account?.username || state?.account_username || targetUsername;
        const lookupState = state || createDefaultPlayerState(targetUsername);
        const playerData = buildAdminInventoryLookupPlayerData(displayUsername, lookupState);
        logAdminAction(socket, player, "admin_inventory_lookup", {
            ...logBase,
            target_username: displayUsername,
            target_found: true,
            target_online: Boolean(target),
        }, true, "Inventory lookup completed.");
        sendJson(socket, {
            type: "player_state",
            ok: true,
            found: true,
            request_id: requestId,
            purpose: ADMIN_INVENTORY_LOOKUP_PURPOSE,
            action: ADMIN_INVENTORY_LOOKUP_PURPOSE,
            username: displayUsername,
            name: displayUsername,
            online: Boolean(target),
            offline: !target,
            world: target?.player?.world || "",
            current_world: target?.player?.world || "",
            account: {
                username: displayUsername,
                role: getAccountRole(displayUsername),
                last_seen_at: account ? String(account.last_seen_at || "") : "",
            },
            player_data: playerData,
            message: "Inventory loaded.",
        });
    }
    async function handleAdminItemInstanceLookupRequest(socket, player, data, username, requestId, purpose) {
        const targetUsername = cleanAccountName(data.target_username || data.requested_username || username);
        const logBase = {
            request_id: requestId,
            purpose,
            target_username: targetUsername,
            world: cleanWorld(data.world || player.world || "START"),
        };
        const deny = (message, details = {}, extra = {}) => {
            logAdminAction(socket, player, "admin_item_instance_lookup_denied", { ...logBase, ...details }, false, message);
            logSecurityEvent(socket, player, "admin_item_instance_lookup_denied", { ...logBase, ...details, message }, "warning");
            sendAdminItemInstanceLookupFailure(socket, requestId, targetUsername, message, extra);
        };
        if (!isAdmin(player)) {
            deny("Item instance lookup is only available to admins.");
            return;
        }
        const securityRequirement = getDeveloperSecurityRequirement(player);
        if (!securityRequirement.ok) {
            deny(securityRequirement.message, { reason: securityRequirement.reason }, securityRequirement.extra);
            return;
        }
        if (targetUsername === "") {
            logAdminAction(socket, player, "admin_item_instance_lookup", logBase, false, "Target username is required.");
            sendAdminItemInstanceLookupFailure(socket, requestId, targetUsername, "Target username is required.");
            return;
        }
        if (!isPostgresAuthoritativeReady()) {
            logAdminAction(socket, player, "admin_item_instance_lookup", logBase, false, "PostgreSQL is not ready.");
            sendAdminItemInstanceLookupFailure(socket, requestId, targetUsername, "PostgreSQL is not ready.");
            return;
        }
        const state = ensurePlayerState(targetUsername);
        const found = Boolean(state) || doesAccountExist(targetUsername);
        if (!found) {
            logAdminAction(socket, player, "admin_item_instance_lookup", logBase, false, "Target account does not exist.");
            sendAdminItemInstanceLookupFailure(socket, requestId, targetUsername, "Target account does not exist.");
            return;
        }
        const target = findOnlinePlayerByUsername(targetUsername);
        const account = accounts.get(accountKey(targetUsername)) || null;
        const displayUsername = account?.username || state?.account_username || targetUsername;
        const rawLimit = clampInteger(data.limit || ADMIN_ITEM_INSTANCE_LOOKUP_LIMIT, 1, ADMIN_ITEM_INSTANCE_LOOKUP_LIMIT);
        console.log("[admin_item_instance_lookup] start", {
            actor: player.account_username || player.name || "",
            target: displayUsername,
            request_id: requestId,
        });
        try {
            const reconcileResult = await withTimeout(postgresStore.reconcileItemInstancesForUsername(displayUsername, state, {
                source: "admin_item_instance_lookup",
                request_id: requestId,
                actor_username: player.account_username || player.name || "",
            }), ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS, "admin item instance reconcile");
            const itemInstances = await withTimeout(postgresStore.listActiveItemInstances(displayUsername, { limit: rawLimit }), ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS, "admin item instance list");
            const itemInstanceRows = buildAdminItemInstanceLookupRows(itemInstances);
            logAdminAction(socket, player, "admin_item_instance_lookup", {
                ...logBase,
                target_username: displayUsername,
                target_found: true,
                target_online: Boolean(target),
                item_instance_count: itemInstanceRows.length,
                reconcile_ok: Boolean(reconcileResult?.ok),
                reconcile_reason: String(reconcileResult?.reason || ""),
            }, true, "Item instance lookup completed.");
            console.log("[admin_item_instance_lookup] ok", {
                target: displayUsername,
                count: itemInstanceRows.length,
                request_id: requestId,
            });
            sendJson(socket, {
                type: "player_state",
                ok: true,
                found: true,
                request_id: requestId,
                purpose: ADMIN_ITEM_INSTANCE_LOOKUP_PURPOSE,
                action: ADMIN_ITEM_INSTANCE_LOOKUP_PURPOSE,
                username: displayUsername,
                name: displayUsername,
                online: Boolean(target),
                offline: !target,
                world: target?.player?.world || "",
                current_world: target?.player?.world || "",
                account: {
                    username: displayUsername,
                    role: getAccountRole(displayUsername),
                    last_seen_at: account ? String(account.last_seen_at || "") : "",
                },
                item_instances: itemInstanceRows,
                item_instance_count: itemInstanceRows.length,
                item_instance_limit: rawLimit,
                item_instance_reconcile: reconcileResult || { ok: false, reason: "not_run" },
                message: "Item instances loaded.",
            });
        }
        catch (error) {
            const errorMessage = toErrorMessage(error);
            const message = `Item instance lookup failed: ${errorMessage}`;
            console.warn("[admin_item_instance_lookup] failed", {
                target: displayUsername,
                request_id: requestId,
                message,
            });
            logAdminAction(socket, player, "admin_item_instance_lookup", {
                ...logBase,
                target_username: displayUsername,
                target_found: true,
                target_online: Boolean(target),
                error: errorMessage,
            }, false, message);
            sendAdminItemInstanceLookupFailure(socket, requestId, displayUsername, message, {
                online: Boolean(target),
                offline: !target,
                item_instances: [],
                item_instance_count: 0,
                item_instance_limit: rawLimit,
            });
        }
    }
    async function handleAdminItemInstanceHistoryLookupRequest(socket, player, data, username, requestId, purpose) {
        const targetUsername = cleanAccountName(data.target_username || data.requested_username || username);
        const itemInstanceId = cleanAccountName(data.public_item_instance_id || data.item_instance_public_id || data.item_instance_id || data.id || "");
        const logBase = {
            request_id: requestId,
            purpose,
            target_username: targetUsername,
            item_instance_id: itemInstanceId,
            world: cleanWorld(data.world || player.world || "START"),
        };
        const deny = (message, details = {}, extra = {}) => {
            logAdminAction(socket, player, "admin_item_instance_history_lookup_denied", { ...logBase, ...details }, false, message);
            logSecurityEvent(socket, player, "admin_item_instance_history_lookup_denied", { ...logBase, ...details, message }, "warning");
            sendAdminItemInstanceHistoryLookupFailure(socket, requestId, targetUsername, itemInstanceId, message, extra);
        };
        if (!isAdmin(player)) {
            deny("Item instance history is only available to admins.");
            return;
        }
        const securityRequirement = getDeveloperSecurityRequirement(player);
        if (!securityRequirement.ok) {
            deny(securityRequirement.message, { reason: securityRequirement.reason }, securityRequirement.extra);
            return;
        }
        if (itemInstanceId === "") {
            logAdminAction(socket, player, "admin_item_instance_history_lookup", logBase, false, "Item instance ID is required.");
            sendAdminItemInstanceHistoryLookupFailure(socket, requestId, targetUsername, itemInstanceId, "Item instance ID is required.");
            return;
        }
        if (!isPostgresAuthoritativeReady()) {
            logAdminAction(socket, player, "admin_item_instance_history_lookup", logBase, false, "PostgreSQL is not ready.");
            sendAdminItemInstanceHistoryLookupFailure(socket, requestId, targetUsername, itemInstanceId, "PostgreSQL is not ready.");
            return;
        }
        console.log("[admin_item_instance_history_lookup] start", {
            actor: player.account_username || player.name || "",
            target: targetUsername,
            item_instance_id: itemInstanceId,
            request_id: requestId,
        });
        try {
            const history = await withTimeout(postgresStore.getItemInstanceHistory(itemInstanceId, { limit: 50 }), ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS, "admin item instance history");
            if (!history?.ok) {
                const message = history?.reason === "item_instance_not_found"
                    ? "Item instance was not found."
                    : `Item instance history unavailable: ${history?.message || history?.reason || "unknown_error"}`;
                logAdminAction(socket, player, "admin_item_instance_history_lookup", {
                    ...logBase,
                    lookup_ok: false,
                    reason: String(history?.reason || ""),
                }, false, message);
                sendAdminItemInstanceHistoryLookupFailure(socket, requestId, targetUsername, itemInstanceId, message, {
                    item_instance_history: history || {},
                });
                return;
            }
            logAdminAction(socket, player, "admin_item_instance_history_lookup", {
                ...logBase,
                lookup_ok: true,
                event_count: history.events?.length || 0,
                source_confidence: history.item_instance?.source_confidence || "",
                integrity_flags: history.integrity?.flags || [],
            }, true, "Item instance history lookup completed.");
            console.log("[admin_item_instance_history_lookup] ok", {
                item_instance_id: itemInstanceId,
                events: history.events?.length || 0,
                flags: history.integrity?.flags || [],
                request_id: requestId,
            });
            sendJson(socket, {
                type: "player_state",
                ok: true,
                found: true,
                request_id: requestId,
                purpose: ADMIN_ITEM_INSTANCE_HISTORY_LOOKUP_PURPOSE,
                action: ADMIN_ITEM_INSTANCE_HISTORY_LOOKUP_PURPOSE,
                username: targetUsername,
                item_instance_id: itemInstanceId,
                item_instance_history: history,
                message: "Item instance history loaded.",
            });
        }
        catch (error) {
            const errorMessage = toErrorMessage(error);
            const message = `Item instance history lookup failed: ${errorMessage}`;
            console.warn("[admin_item_instance_history_lookup] failed", {
                item_instance_id: itemInstanceId,
                request_id: requestId,
                message,
            });
            logAdminAction(socket, player, "admin_item_instance_history_lookup", {
                ...logBase,
                error: errorMessage,
            }, false, message);
            sendAdminItemInstanceHistoryLookupFailure(socket, requestId, targetUsername, itemInstanceId, message);
        }
    }
    async function handleAdminTransactionLedgerLookupRequest(socket, player, data, username, requestId, purpose) {
        const requestedUsernameValue = Object.prototype.hasOwnProperty.call(data, "requested_username")
            ? data.requested_username
            : username;
        const targetUsername = cleanAccountName(data.target_username || requestedUsernameValue || "");
        const itemInstanceId = cleanAccountName(data.public_item_instance_id || data.item_instance_public_id || data.item_instance_id || data.id || "");
        const itemType = cleanName(data.item_type || data.item_id || "");
        const transactionType = cleanName(data.transaction_type || data.ledger_type || "");
        const status = cleanName(data.status || "");
        const logBase = {
            request_id: requestId,
            purpose,
            target_username: targetUsername,
            item_instance_id: itemInstanceId,
            item_type: itemType,
            transaction_type: transactionType,
            status,
            world: cleanWorld(data.world || player.world || "START"),
        };
        const deny = (message, details = {}, extra = {}) => {
            logAdminAction(socket, player, "admin_transaction_ledger_lookup_denied", { ...logBase, ...details }, false, message);
            logSecurityEvent(socket, player, "admin_transaction_ledger_lookup_denied", { ...logBase, ...details, message }, "warning");
            sendAdminTransactionLedgerLookupFailure(socket, requestId, targetUsername, itemInstanceId, message, extra);
        };
        if (!isAdmin(player)) {
            deny("Transaction ledger lookup is only available to admins.");
            return;
        }
        const securityRequirement = getDeveloperSecurityRequirement(player);
        if (!securityRequirement.ok) {
            deny(securityRequirement.message, { reason: securityRequirement.reason }, securityRequirement.extra);
            return;
        }
        if (targetUsername === "" && itemInstanceId === "" && itemType === "" && transactionType === "") {
            logAdminAction(socket, player, "admin_transaction_ledger_lookup", logBase, false, "A player, item instance, item type, or transaction type is required.");
            sendAdminTransactionLedgerLookupFailure(socket, requestId, targetUsername, itemInstanceId, "Enter a player, item instance, item type, or transaction type.");
            return;
        }
        if (!isPostgresAuthoritativeReady()) {
            logAdminAction(socket, player, "admin_transaction_ledger_lookup", logBase, false, "PostgreSQL is not ready.");
            sendAdminTransactionLedgerLookupFailure(socket, requestId, targetUsername, itemInstanceId, "PostgreSQL is not ready.");
            return;
        }
        const target = targetUsername !== "" ? findOnlinePlayerByUsername(targetUsername) : null;
        const account = targetUsername !== "" ? accounts.get(accountKey(targetUsername)) || null : null;
        const displayUsername = account?.username || target?.player?.account_username || targetUsername;
        const rawLimit = clampInteger(data.limit || ADMIN_TRANSACTION_LEDGER_LOOKUP_LIMIT, 1, ADMIN_TRANSACTION_LEDGER_LOOKUP_LIMIT);
        console.log("[admin_transaction_ledger_lookup] start", {
            actor: player.account_username || player.name || "",
            target: displayUsername,
            item_instance_id: itemInstanceId,
            item_type: itemType,
            transaction_type: transactionType,
            request_id: requestId,
        });
        try {
            const result = await withTimeout(postgresStore.listTransactionLedger({
                username: displayUsername,
                public_item_instance_id: itemInstanceId,
                item_type: itemType,
                transaction_type: transactionType,
                status,
                limit: rawLimit,
            }), ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS, "admin transaction ledger lookup");
            if (!result?.ok) {
                const message = result?.reason === "target_required"
                    ? "Enter a player, item instance, item type, or transaction type."
                    : `Transaction ledger unavailable: ${result?.message || result?.reason || "unknown_error"}`;
                logAdminAction(socket, player, "admin_transaction_ledger_lookup", {
                    ...logBase,
                    lookup_ok: false,
                    reason: String(result?.reason || ""),
                }, false, message);
                sendAdminTransactionLedgerLookupFailure(socket, requestId, displayUsername, itemInstanceId, message, {
                    transaction_ledger: [],
                    transaction_ledger_count: 0,
                });
                return;
            }
            const rows = buildAdminTransactionLedgerLookupRows(result.entries || []);
            logAdminAction(socket, player, "admin_transaction_ledger_lookup", {
                ...logBase,
                target_username: displayUsername,
                target_online: Boolean(target),
                lookup_ok: true,
                transaction_ledger_count: rows.length,
            }, true, "Transaction ledger lookup completed.");
            console.log("[admin_transaction_ledger_lookup] ok", {
                target: displayUsername,
                item_instance_id: itemInstanceId,
                count: rows.length,
                request_id: requestId,
            });
            sendJson(socket, {
                type: "player_state",
                ok: true,
                found: true,
                request_id: requestId,
                purpose: ADMIN_TRANSACTION_LEDGER_LOOKUP_PURPOSE,
                action: ADMIN_TRANSACTION_LEDGER_LOOKUP_PURPOSE,
                username: displayUsername,
                name: displayUsername,
                online: Boolean(target),
                offline: displayUsername !== "" ? !target : false,
                world: target?.player?.world || "",
                current_world: target?.player?.world || "",
                account: displayUsername !== "" ? {
                    username: displayUsername,
                    role: getAccountRole(displayUsername),
                    last_seen_at: account ? String(account.last_seen_at || "") : "",
                } : {},
                item_instance_id: itemInstanceId,
                transaction_ledger: rows,
                transaction_ledger_count: rows.length,
                transaction_ledger_limit: rawLimit,
                transaction_ledger_query: result.query || {},
                message: "Transaction ledger loaded.",
            });
        }
        catch (error) {
            const errorMessage = toErrorMessage(error);
            const message = `Transaction ledger lookup failed: ${errorMessage}`;
            console.warn("[admin_transaction_ledger_lookup] failed", {
                target: displayUsername,
                item_instance_id: itemInstanceId,
                request_id: requestId,
                message,
            });
            logAdminAction(socket, player, "admin_transaction_ledger_lookup", {
                ...logBase,
                target_username: displayUsername,
                error: errorMessage,
            }, false, message);
            sendAdminTransactionLedgerLookupFailure(socket, requestId, displayUsername, itemInstanceId, message, {
                transaction_ledger: [],
                transaction_ledger_count: 0,
                transaction_ledger_limit: rawLimit,
            });
        }
    }
    async function handleAdminMonitoringDashboardRequest(socket, player, data, username, requestId, purpose) {
        const targetUsername = cleanAccountName(data.target_username || data.requested_username || username || player.account_username || player.name);
        const rawLimit = clampInteger(data.limit || ADMIN_MONITORING_DASHBOARD_LOOKUP_LIMIT, 1, ADMIN_MONITORING_DASHBOARD_LOOKUP_LIMIT);
        const windowHours = clampInteger(data.window_hours || ADMIN_MONITORING_DASHBOARD_WINDOW_HOURS, 1, 24 * 14);
        const logBase = {
            request_id: requestId,
            purpose,
            target_username: targetUsername,
            window_hours: windowHours,
            limit: rawLimit,
            world: cleanWorld(data.world || player.world || "START"),
        };
        const deny = (message, details = {}, extra = {}) => {
            logAdminAction(socket, player, "admin_monitoring_dashboard_denied", { ...logBase, ...details }, false, message);
            logSecurityEvent(socket, player, "admin_monitoring_dashboard_denied", { ...logBase, ...details, message }, "warning");
            sendAdminMonitoringDashboardFailure(socket, requestId, targetUsername, message, extra);
        };
        if (!isAdmin(player)) {
            deny("Monitoring dashboard is only available to admins.");
            return;
        }
        const securityRequirement = getDeveloperSecurityRequirement(player);
        if (!securityRequirement.ok) {
            deny(securityRequirement.message, { reason: securityRequirement.reason }, securityRequirement.extra);
            return;
        }
        if (!isPostgresAuthoritativeReady()) {
            logAdminAction(socket, player, "admin_monitoring_dashboard", logBase, false, "PostgreSQL is not ready.");
            sendAdminMonitoringDashboardFailure(socket, requestId, targetUsername, "PostgreSQL is not ready.");
            return;
        }
        try {
            const runtime = buildAdminMonitoringRuntimeSnapshot(rawLimit);
            const postgresDashboard = await withTimeout(postgresStore.getAdminMonitoringDashboard({
                window_hours: windowHours,
                limit: rawLimit,
                dupe_limit: Math.min(rawLimit, 20),
            }), ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS, "admin monitoring dashboard");
            if (!postgresDashboard?.ok) {
                const message = `Monitoring dashboard unavailable: ${postgresDashboard?.message || postgresDashboard?.reason || "unknown_error"}`;
                logAdminAction(socket, player, "admin_monitoring_dashboard", {
                    ...logBase,
                    lookup_ok: false,
                    reason: String(postgresDashboard?.reason || ""),
                }, false, message);
                sendAdminMonitoringDashboardFailure(socket, requestId, targetUsername, message);
                return;
            }
            const dashboard = {
                ok: true,
                generated_at: new Date().toISOString(),
                window_hours: windowHours,
                limit: rawLimit,
                live: runtime,
                postgres: postgresDashboard,
            };
            logAdminAction(socket, player, "admin_monitoring_dashboard", {
                ...logBase,
                lookup_ok: true,
                online_player_count: runtime.online_player_count,
                authenticated_player_count: runtime.authenticated_player_count,
                world_count: postgresDashboard.world_count,
                dupe_warning_count: postgresDashboard.dupe_warning_count,
                suspicious_account_count: Array.isArray(postgresDashboard.suspicious_accounts) ? postgresDashboard.suspicious_accounts.length : 0,
            }, true, "Monitoring dashboard loaded.");
            sendJson(socket, {
                type: "player_state",
                ok: true,
                found: true,
                request_id: requestId,
                purpose: ADMIN_MONITORING_DASHBOARD_PURPOSE,
                action: ADMIN_MONITORING_DASHBOARD_PURPOSE,
                username: targetUsername,
                dashboard,
                message: "Monitoring dashboard loaded.",
            });
        }
        catch (error) {
            const errorMessage = toErrorMessage(error);
            const message = `Monitoring dashboard failed: ${errorMessage}`;
            console.warn("[admin_monitoring_dashboard] failed", {
                request_id: requestId,
                message,
            });
            logAdminAction(socket, player, "admin_monitoring_dashboard", {
                ...logBase,
                error: errorMessage,
            }, false, message);
            sendAdminMonitoringDashboardFailure(socket, requestId, targetUsername, message);
        }
    }
    return {
        buildAdminInventoryLookupPlayerData,
        buildAdminItemInstanceLookupRows,
        buildAdminMonitoringRuntimeSnapshot,
        buildAdminMonitoringOnlinePlayers,
        buildAdminMonitoringWorldRows,
        buildAdminTransactionLedgerLookupRows,
        handleAdminInventoryLookupRequest,
        handleAdminItemInstanceHistoryLookupRequest,
        handleAdminItemInstanceLookupRequest,
        handleAdminMonitoringDashboardRequest,
        handleAdminTransactionLedgerLookupRequest,
    };
}
module.exports = {
    createServerAdminLookupRoutes,
};
