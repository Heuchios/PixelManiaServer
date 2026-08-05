// Generated from src/server_phase11b_lifecycle.ts. Do not edit by hand.
"use strict";
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function createServerPhase11bLifecycle(deps) {
    const { ACCOUNTS_SAVE_PATH, ADMIN_LOG_PATH, ALLOW_LEGACY_WORLD_STATE_IMPORT, ANTI_DUPE_AUDIT_INTERVAL_MS, ANTI_DUPE_AUDIT_LIMIT, ANTI_DUPE_AUDIT_LOG_CLEAN, CRASH_REPORT_PATH, INTEGRITY_LOG_FOLDER, LEGACY_DATA_FOLDERS, PERIODIC_SAVE_MS, PLAYER_SAVE_FOLDER, WORLD_SAVE_FOLDER, WORLD_SNAPSHOT_FOLDER, WORLD_SNAPSHOT_INTERVAL_MINUTES, WORLD_SNAPSHOT_INTERVAL_MS, WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE, WORLD_SNAPSHOT_STARTUP_RUN, accountKey, accounts, assertAuthoritativePostgresReady, clampInteger, cleanAccountName, cleanText, cleanWorld, createWorldSnapshot, deserializeWorldState, errorToCrashDetails, exitProcess, fileSystem, flushWorldStateJsonBackups, getAccountsSaveTimer, getCrashRuntimeState, getFatalCrashReportWritten, getOwnedWorldNames, releaseOwnedWorldRoutesForShutdown, isPostgresAuthoritativeReady, loadAccountsFromJson, logger, markFatalCrashReportWritten, pathModule, pendingPersistenceWrites, persistenceHelpers, playerSaveTimers, playerStates, postgresStore, processRuntime, redisStore, refreshOwnedWorldRoutes, safeFileName, sanitizeAccountState, sanitizePlayerState, saveAccounts, savePlayerState, saveWorldState, serializeWorldState, setAccountsSaveTimer, stopGameplaySchedulers, waitForPersistenceWrites, waitForWorldPersistence, WORLD_ROUTE_TTL_MS, worldSaveTimers, worldSnapshotSchedulerState, worldStates, writeCrashReport, } = deps;
    const timerApi = deps.timerApi || {
        clearInterval,
        clearTimeout,
        setInterval,
        setTimeout,
    };
    let antiDupeAuditTimer = null;
    let antiDupeAuditStartupTimer = null;
    let antiDupeAuditRunning = false;
    let worldSnapshotSchedulerTimer = null;
    let worldSnapshotSchedulerStartupTimer = null;
    let worldSnapshotSchedulerRunning = false;
    let worldSnapshotSchedulerCursor = 0;
    let periodicSaveTimer = null;
    let worldRouteLeaseRefreshTimer = null;
    let shutdownStarted = false;
    let shutdownHandlersInstalled = false;
    function unrefTimer(timer) {
        if (timer && typeof timer.unref === "function")
            timer.unref();
    }
    function clearIntervalTimer(timer) {
        if (timer)
            timerApi.clearInterval(timer);
        return null;
    }
    function clearTimeoutTimer(timer) {
        if (timer)
            timerApi.clearTimeout(timer);
        return null;
    }
    function migrateLegacyDataFolders() {
        for (const legacyFolder of LEGACY_DATA_FOLDERS) {
            if (!fileSystem.existsSync(legacyFolder))
                continue;
            persistenceHelpers.copyJsonIfMissingOrNewer(pathModule.join(legacyFolder, "accounts.json"), ACCOUNTS_SAVE_PATH, "accounts file");
            persistenceHelpers.copyJsonFolderIfMissingOrNewer(pathModule.join(legacyFolder, "worlds"), WORLD_SAVE_FOLDER, "worlds");
            persistenceHelpers.copyJsonFolderIfMissingOrNewer(pathModule.join(legacyFolder, "players"), PLAYER_SAVE_FOLDER, "players");
        }
    }
    function ensureDataFolders() {
        fileSystem.mkdirSync(WORLD_SAVE_FOLDER, { recursive: true });
        fileSystem.mkdirSync(PLAYER_SAVE_FOLDER, { recursive: true });
        fileSystem.mkdirSync(pathModule.dirname(ADMIN_LOG_PATH), { recursive: true });
        fileSystem.mkdirSync(pathModule.dirname(CRASH_REPORT_PATH), { recursive: true });
        fileSystem.mkdirSync(INTEGRITY_LOG_FOLDER, { recursive: true });
        fileSystem.mkdirSync(WORLD_SNAPSHOT_FOLDER, { recursive: true });
        migrateLegacyDataFolders();
    }
    function getWorldSavePath(worldName) {
        return pathModule.join(WORLD_SAVE_FOLDER, `${safeFileName(cleanWorld(worldName), "START")}.json`);
    }
    function getPlayerSavePath(username) {
        return pathModule.join(PLAYER_SAVE_FOLDER, `${safeFileName(cleanAccountName(username).toLowerCase(), "guest")}.json`);
    }
    function listJsonFiles(folder) {
        try {
            if (!fileSystem.existsSync(folder))
                return [];
            return fileSystem.readdirSync(folder, { withFileTypes: true })
                .filter((entry) => entry.isFile() && pathModule.extname(entry.name).toLowerCase() === ".json")
                .map((entry) => pathModule.join(folder, entry.name));
        }
        catch (error) {
            logger.warn(`Could not scan ${folder}:`, getErrorMessage(error));
            return [];
        }
    }
    function readPlayerStatesFromJsonFolder() {
        const states = [];
        for (const filePath of listJsonFiles(PLAYER_SAVE_FOLDER)) {
            const data = persistenceHelpers.readJsonFile(filePath);
            if (!data || typeof data !== "object" || Array.isArray(data))
                continue;
            const record = data;
            const fallbackUsername = pathModule.basename(filePath, ".json");
            const state = sanitizePlayerState(record.player_data || record, record.username || fallbackUsername);
            if (!state)
                continue;
            states.push(state);
        }
        return states;
    }
    function loadPlayerStatesFromJsonFolder() {
        let loaded = 0;
        for (const state of readPlayerStatesFromJsonFolder()) {
            playerStates.set(accountKey(state.account_username), state);
            loaded += 1;
        }
        return loaded;
    }
    function readWorldStatesFromJsonFolder() {
        const states = [];
        for (const filePath of listJsonFiles(WORLD_SAVE_FOLDER)) {
            const data = persistenceHelpers.readJsonFile(filePath);
            if (!data || typeof data !== "object" || Array.isArray(data))
                continue;
            const record = data;
            const worldName = cleanWorld(record.world_name || pathModule.basename(filePath, ".json"));
            states.push({
                worldName,
                state: deserializeWorldState(worldName, record),
            });
        }
        return states;
    }
    function loadWorldStatesFromJsonFolder() {
        let loaded = 0;
        for (const entry of readWorldStatesFromJsonFolder()) {
            worldStates.set(entry.worldName, entry.state);
            loaded += 1;
        }
        return loaded;
    }
    async function loadPersistentState() {
        loadAccountsFromJson();
        const jsonAccounts = new Map(accounts);
        if (!isPostgresAuthoritativeReady()) {
            assertAuthoritativePostgresReady("persistent state load");
            return;
        }
        const dbAccounts = await postgresStore.loadAccountStates();
        if (dbAccounts.length > 0) {
            accounts.clear();
            for (const rawAccount of dbAccounts) {
                const account = sanitizeAccountState(rawAccount);
                if (account)
                    accounts.set(accountKey(account.username), account);
            }
            logger.log(`[postgres] loaded ${accounts.size} account(s) from PostgreSQL.`);
            const missingAccounts = [];
            for (const [key, account] of jsonAccounts.entries()) {
                if (accounts.has(key))
                    continue;
                accounts.set(key, account);
                missingAccounts.push(account);
            }
            if (missingAccounts.length > 0) {
                await postgresStore.saveAccountStates(missingAccounts);
                logger.log(`[postgres] imported ${missingAccounts.length} missing JSON account(s) into PostgreSQL.`);
            }
        }
        else if (accounts.size > 0) {
            await postgresStore.saveAccountStates(Array.from(accounts.values()));
            logger.log(`[postgres] imported ${accounts.size} JSON account(s) into PostgreSQL.`);
        }
        const dbPlayers = await postgresStore.loadPlayerStates();
        if (dbPlayers.length > 0) {
            playerStates.clear();
            for (const entry of dbPlayers) {
                const state = sanitizePlayerState(entry.state || {}, entry.username || "");
                if (state)
                    playerStates.set(accountKey(state.account_username), state);
            }
            logger.log(`[postgres] loaded ${playerStates.size} player state(s) from PostgreSQL.`);
            const missingPlayers = [];
            for (const state of readPlayerStatesFromJsonFolder()) {
                const key = accountKey(state.account_username);
                if (playerStates.has(key))
                    continue;
                playerStates.set(key, state);
                missingPlayers.push({ username: state.account_username, state });
            }
            if (missingPlayers.length > 0) {
                await postgresStore.savePlayerStates(missingPlayers);
                logger.log(`[postgres] imported ${missingPlayers.length} missing JSON player state(s) into PostgreSQL.`);
            }
        }
        else {
            const importedPlayers = loadPlayerStatesFromJsonFolder();
            if (importedPlayers > 0) {
                await postgresStore.savePlayerStates(Array.from(playerStates.values()).map((state) => ({
                    username: state.account_username,
                    state,
                })));
                logger.log(`[postgres] imported ${importedPlayers} JSON player state(s) into PostgreSQL.`);
            }
        }
        const itemInstanceReconcile = await postgresStore.reconcileStoredItemInstancesFromPlayerStates();
        if (itemInstanceReconcile.ok && itemInstanceReconcile.player_count > 0) {
            logger.log(`[postgres] reconciled item instances for ${itemInstanceReconcile.player_count} player state(s).`);
        }
        const dbWorlds = await postgresStore.loadWorldStates();
        const postgresAuthoritative = deps.POSTGRES_AUTHORITATIVE === true;
        const allowLegacyWorldImport = !postgresAuthoritative || ALLOW_LEGACY_WORLD_STATE_IMPORT;
        const databaseWorldNames = new Set(dbWorlds.map((entry) => (cleanWorld(entry.world_name || entry.state?.world_name || "START"))));
        if (dbWorlds.length > 0) {
            worldStates.clear();
            if (postgresAuthoritative) {
                logger.log(`[postgres] indexed ${dbWorlds.length} world state(s); authoritative worlds load on demand after route ownership is claimed.`);
            }
            else {
                for (const entry of dbWorlds) {
                    const cleanWorldName = cleanWorld(entry.world_name || entry.state?.world_name || "START");
                    worldStates.set(cleanWorldName, deserializeWorldState(cleanWorldName, entry.state || {}));
                }
                logger.log(`[postgres] loaded ${worldStates.size} world state(s) from PostgreSQL.`);
            }
            const jsonWorldEntries = readWorldStatesFromJsonFolder();
            const missingWorldEntries = jsonWorldEntries.filter((entry) => !databaseWorldNames.has(entry.worldName));
            if (allowLegacyWorldImport) {
                for (const entry of missingWorldEntries) {
                    worldStates.set(entry.worldName, entry.state);
                    const imported = await postgresStore.saveWorldState(entry.worldName, serializeWorldState(entry.worldName));
                    if (imported !== true) {
                        throw new Error(`PostgreSQL rejected legacy world import for ${entry.worldName}`);
                    }
                    if (postgresAuthoritative)
                        worldStates.delete(entry.worldName);
                }
                if (missingWorldEntries.length > 0) {
                    logger.log(`[postgres] imported ${missingWorldEntries.length} missing JSON world state(s) into PostgreSQL.`);
                }
            }
            else if (missingWorldEntries.length > 0) {
                logger.warn(`[postgres] skipped ${missingWorldEntries.length} legacy JSON world import(s) because PostgreSQL is authoritative. Set ALLOW_LEGACY_WORLD_STATE_IMPORT=true only for an intentional one-time migration.`);
            }
        }
        else if (allowLegacyWorldImport) {
            const importedWorlds = loadWorldStatesFromJsonFolder();
            for (const [worldName] of worldStates.entries()) {
                const imported = await postgresStore.saveWorldState(worldName, serializeWorldState(worldName));
                if (imported !== true) {
                    throw new Error(`PostgreSQL rejected legacy world import for ${worldName}`);
                }
            }
            if (postgresAuthoritative)
                worldStates.clear();
            if (importedWorlds > 0) {
                logger.log(`[postgres] imported ${importedWorlds} JSON world state(s) into PostgreSQL.`);
            }
        }
        else {
            const legacyWorldCount = readWorldStatesFromJsonFolder().length;
            if (legacyWorldCount > 0) {
                logger.warn(`[postgres] PostgreSQL returned no world states; skipped importing ${legacyWorldCount} JSON world state(s) because PostgreSQL is authoritative. Set ALLOW_LEGACY_WORLD_STATE_IMPORT=true only for an intentional one-time migration.`);
            }
        }
    }
    async function runAntiDupeAuditNow() {
        if (antiDupeAuditRunning || !postgresStore.isReady())
            return;
        antiDupeAuditRunning = true;
        try {
            const result = await postgresStore.auditItemInstances({ limit: ANTI_DUPE_AUDIT_LIMIT });
            if (!result?.ok) {
                logger.warn("[anti-dupe] item instance audit failed:", result?.reason || "unknown");
                return;
            }
            const totalIssues = clampInteger(result.summary?.total_issues || 0, 0, ANTI_DUPE_AUDIT_LIMIT);
            if (totalIssues > 0) {
                logger.warn("[anti-dupe] item instance audit found issues", JSON.stringify({
                    scanned_at: result.scanned_at,
                    summary: result.summary,
                    sample: Array.isArray(result.issues) ? result.issues.slice(0, 5) : [],
                }));
            }
            else if (ANTI_DUPE_AUDIT_LOG_CLEAN) {
                logger.log("[anti-dupe] item instance audit clean.");
            }
        }
        catch (error) {
            logger.warn("[anti-dupe] item instance audit crashed:", getErrorMessage(error));
        }
        finally {
            antiDupeAuditRunning = false;
        }
    }
    function startAntiDupeAuditScanner() {
        if (antiDupeAuditTimer || ANTI_DUPE_AUDIT_INTERVAL_MS <= 0)
            return;
        if (!postgresStore.isReady())
            return;
        antiDupeAuditTimer = timerApi.setInterval(() => {
            void runAntiDupeAuditNow();
        }, ANTI_DUPE_AUDIT_INTERVAL_MS);
        unrefTimer(antiDupeAuditTimer);
        antiDupeAuditStartupTimer = timerApi.setTimeout(() => {
            antiDupeAuditStartupTimer = null;
            void runAntiDupeAuditNow();
        }, 10000);
        unrefTimer(antiDupeAuditStartupTimer);
    }
    function selectWorldsForSnapshotCycle(loadedWorldNames) {
        const worlds = Array.isArray(loadedWorldNames)
            ? loadedWorldNames.filter(Boolean)
            : [];
        if (worlds.length === 0)
            return [];
        const maxWorlds = WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE;
        if (maxWorlds <= 0 || maxWorlds >= worlds.length) {
            worldSnapshotSchedulerCursor = 0;
            return worlds;
        }
        const selected = [];
        const startIndex = worldSnapshotSchedulerCursor % worlds.length;
        for (let index = 0; index < maxWorlds; index += 1) {
            selected.push(worlds[(startIndex + index) % worlds.length]);
        }
        worldSnapshotSchedulerCursor = (startIndex + maxWorlds) % worlds.length;
        return selected;
    }
    async function runWorldSnapshotCycleNow() {
        if (worldSnapshotSchedulerRunning)
            return;
        worldSnapshotSchedulerRunning = true;
        const startedAt = Date.now();
        worldSnapshotSchedulerState.last_error = "";
        worldSnapshotSchedulerState.last_run_at = new Date(startedAt).toISOString();
        try {
            const loadedWorldNames = (typeof getOwnedWorldNames === "function"
                ? getOwnedWorldNames()
                : Array.from(worldStates.keys())).map((worldName) => cleanWorld(worldName)).sort((left, right) => (left.localeCompare(right)));
            const scheduledWorldNames = selectWorldsForSnapshotCycle(loadedWorldNames);
            let createdCount = 0;
            let failedCount = 0;
            for (const worldName of scheduledWorldNames) {
                const snapshot = createWorldSnapshot(worldName, "periodic_checkpoint", null, null, {
                    scheduler: true,
                    interval_minutes: WORLD_SNAPSHOT_INTERVAL_MINUTES,
                    world_count: loadedWorldNames.length,
                    scheduled_world_count: scheduledWorldNames.length,
                });
                if (snapshot?.snapshotId) {
                    createdCount += 1;
                    const waitSummary = await waitForPersistenceWrites();
                    if (waitSummary?.ok === false)
                        failedCount += 1;
                }
                else {
                    failedCount += 1;
                }
            }
            worldSnapshotSchedulerState.last_world_count = createdCount;
            if (failedCount > 0) {
                worldSnapshotSchedulerState.last_error = `some_world_snapshots_failed_${failedCount}`;
                logger.warn("[snapshot] periodic world checkpoint completed with failures", {
                    scheduled_worlds: loadedWorldNames.length,
                    processed_worlds: scheduledWorldNames.length,
                    created: createdCount,
                    failed: failedCount,
                });
            }
        }
        catch (error) {
            worldSnapshotSchedulerState.last_error = cleanText(getErrorMessage(error) || "unknown");
            logger.warn("[snapshot] periodic world checkpoint failed:", worldSnapshotSchedulerState.last_error);
        }
        finally {
            worldSnapshotSchedulerState.last_duration_ms = Date.now() - startedAt;
            worldSnapshotSchedulerRunning = false;
        }
    }
    function startPeriodicWorldSnapshotScheduler() {
        if (WORLD_SNAPSHOT_INTERVAL_MS <= 0) {
            worldSnapshotSchedulerState.enabled = false;
            return;
        }
        if (worldSnapshotSchedulerTimer)
            return;
        worldSnapshotSchedulerState.enabled = true;
        worldSnapshotSchedulerTimer = timerApi.setInterval(() => {
            runWorldSnapshotCycleNow().catch((error) => {
                worldSnapshotSchedulerState.last_error = cleanText(getErrorMessage(error) || "unknown");
                logger.warn("[snapshot] periodic world checkpoint task failed:", worldSnapshotSchedulerState.last_error);
            });
        }, WORLD_SNAPSHOT_INTERVAL_MS);
        unrefTimer(worldSnapshotSchedulerTimer);
        if (WORLD_SNAPSHOT_STARTUP_RUN) {
            const startupDelayMs = Math.min(60000, WORLD_SNAPSHOT_INTERVAL_MS);
            worldSnapshotSchedulerStartupTimer = timerApi.setTimeout(() => {
                worldSnapshotSchedulerStartupTimer = null;
                runWorldSnapshotCycleNow().catch((error) => {
                    worldSnapshotSchedulerState.last_error = cleanText(getErrorMessage(error) || "unknown");
                    logger.warn("[snapshot] periodic world checkpoint startup run failed:", worldSnapshotSchedulerState.last_error);
                });
            }, startupDelayMs);
            unrefTimer(worldSnapshotSchedulerStartupTimer);
        }
        logger.log(`[snapshot] periodic world checkpoint every ${WORLD_SNAPSHOT_INTERVAL_MINUTES} minute(s), max ${WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE || "all"} world(s) per cycle.`);
    }
    function startPeriodicSaveScheduler() {
        if (!periodicSaveTimer && PERIODIC_SAVE_MS > 0) {
            periodicSaveTimer = timerApi.setInterval(() => {
                flushPendingSaves();
            }, PERIODIC_SAVE_MS);
            unrefTimer(periodicSaveTimer);
        }
        if (!worldRouteLeaseRefreshTimer && WORLD_ROUTE_TTL_MS > 0 && typeof refreshOwnedWorldRoutes === "function") {
            const refreshIntervalMs = Math.max(1000, Math.floor(WORLD_ROUTE_TTL_MS / 3));
            worldRouteLeaseRefreshTimer = timerApi.setInterval(() => {
                Promise.resolve(refreshOwnedWorldRoutes()).catch((error) => {
                    logger.warn("[world-persistence] ownership lease heartbeat failed:", getErrorMessage(error));
                });
            }, refreshIntervalMs);
            unrefTimer(worldRouteLeaseRefreshTimer);
        }
    }
    function stopLifecycleSchedulers() {
        periodicSaveTimer = clearIntervalTimer(periodicSaveTimer);
        worldRouteLeaseRefreshTimer = clearIntervalTimer(worldRouteLeaseRefreshTimer);
        antiDupeAuditTimer = clearIntervalTimer(antiDupeAuditTimer);
        antiDupeAuditStartupTimer = clearTimeoutTimer(antiDupeAuditStartupTimer);
        worldSnapshotSchedulerTimer = clearIntervalTimer(worldSnapshotSchedulerTimer);
        worldSnapshotSchedulerStartupTimer = clearTimeoutTimer(worldSnapshotSchedulerStartupTimer);
        worldSnapshotSchedulerState.enabled = false;
    }
    function getWorldSnapshotSchedulerRunning() {
        return worldSnapshotSchedulerRunning;
    }
    function flushPendingSaves(options = {}) {
        const syncLocalJson = options.syncLocalJson === true;
        for (const [worldName, timer] of worldSaveTimers.entries()) {
            timerApi.clearTimeout(timer);
            saveWorldState(worldName, { mutation: false, reason: "periodic_flush" });
        }
        worldSaveTimers.clear();
        flushWorldStateJsonBackups({ sync: syncLocalJson });
        for (const [usernameKey, timer] of playerSaveTimers.entries()) {
            timerApi.clearTimeout(timer);
            const state = playerStates.get(usernameKey);
            if (state)
                savePlayerState(state.account_username || usernameKey);
        }
        playerSaveTimers.clear();
        const accountsSaveTimer = getAccountsSaveTimer();
        if (accountsSaveTimer) {
            timerApi.clearTimeout(accountsSaveTimer);
            setAccountsSaveTimer(null);
            saveAccounts();
        }
    }
    async function shutdown(signal = "") {
        if (shutdownStarted)
            return;
        shutdownStarted = true;
        if (signal !== "") {
            logger.log(`PixelMania server shutting down (${signal}).`);
        }
        stopLifecycleSchedulers();
        stopGameplaySchedulers();
        flushPendingSaves();
        if (typeof waitForWorldPersistence === "function")
            await waitForWorldPersistence();
        const waitSummary = await waitForPersistenceWrites();
        // Hand back our Redis world-route leases before closing the connection. Without this a
        // restart leaves them claimed for the full TTL and the restarted process cannot
        // reclaim its own worlds, locking players out and triggering a reconnect storm.
        if (typeof releaseOwnedWorldRoutesForShutdown === "function") {
            try {
                const routeRelease = await releaseOwnedWorldRoutesForShutdown();
                if (routeRelease && (routeRelease.released > 0 || routeRelease.failed > 0)) {
                    logger.log("[world-route] released owned routes on shutdown", routeRelease);
                }
            }
            catch (error) {
                logger.error("[world-route] failed to release owned routes on shutdown", error);
            }
        }
        await postgresStore.close();
        await redisStore.close();
        if (waitSummary?.ok === false) {
            logger.error("[persistence] shutdown detected failed writes", {
                total: waitSummary.total,
                failed: waitSummary.failed,
            });
            exitProcess(1);
            return;
        }
        exitProcess(0);
    }
    function handleShutdownSignal(signal) {
        writeCrashReport("process_signal", {
            signal,
            runtime: getCrashRuntimeState(),
        });
        shutdown(signal).catch((error) => {
            markFatalCrashReportWritten();
            writeCrashReport("shutdown_failure", {
                signal,
                error: errorToCrashDetails(error),
                runtime: getCrashRuntimeState(),
            });
            logger.error("Shutdown failed:", error);
            exitProcess(1);
        });
    }
    function installShutdownHandlers() {
        if (shutdownHandlersInstalled)
            return;
        shutdownHandlersInstalled = true;
        processRuntime.on("SIGINT", () => {
            handleShutdownSignal("SIGINT");
        });
        processRuntime.on("SIGTERM", () => {
            handleShutdownSignal("SIGTERM");
        });
        processRuntime.on("exit", (code) => {
            if (Number(code) !== 0 && !getFatalCrashReportWritten()) {
                writeCrashReport("process_exit", {
                    exit_code: Number(code),
                    runtime: getCrashRuntimeState(),
                });
            }
            flushPendingSaves({ syncLocalJson: true });
        });
    }
    function getLifecycleState() {
        return {
            anti_dupe_audit_running: antiDupeAuditRunning,
            anti_dupe_audit_scheduled: Boolean(antiDupeAuditTimer),
            periodic_save_scheduled: Boolean(periodicSaveTimer),
            world_route_lease_refresh_scheduled: Boolean(worldRouteLeaseRefreshTimer),
            shutdown_handlers_installed: shutdownHandlersInstalled,
            shutdown_started: shutdownStarted,
            world_snapshot_running: worldSnapshotSchedulerRunning,
            world_snapshot_scheduled: Boolean(worldSnapshotSchedulerTimer),
        };
    }
    return {
        ensureDataFolders,
        flushPendingSaves,
        getLifecycleState,
        getPlayerSavePath,
        getWorldSavePath,
        getWorldSnapshotSchedulerRunning,
        handleShutdownSignal,
        installShutdownHandlers,
        listJsonFiles,
        loadPersistentState,
        loadPlayerStatesFromJsonFolder,
        loadWorldStatesFromJsonFolder,
        migrateLegacyDataFolders,
        readPlayerStatesFromJsonFolder,
        readWorldStatesFromJsonFolder,
        runAntiDupeAuditNow,
        runWorldSnapshotCycleNow,
        selectWorldsForSnapshotCycle,
        shutdown,
        startAntiDupeAuditScanner,
        startPeriodicSaveScheduler,
        startPeriodicWorldSnapshotScheduler,
        stopLifecycleSchedulers,
    };
}
module.exports = {
    createServerPhase11bLifecycle,
};
