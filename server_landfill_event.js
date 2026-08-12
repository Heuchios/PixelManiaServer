// Generated from src/server_landfill_event.ts. Do not edit by hand.
"use strict";
const LANDFILL_WORLD_PREFIX = "landfill_";
// Empty by design -- populated later, block key -> Kilograms awarded per break.
const TRASH_BLOCK_WEIGHTS = {};
// Empty by design -- populated later, rank (1-10) -> prize items.
const LANDFILL_PRIZES = {};
function registerTrashBlockWeight(blockType, kilograms) {
    const key = String(blockType || "").trim();
    const weight = Number(kilograms);
    if (key === "" || !Number.isFinite(weight) || weight <= 0)
        return;
    TRASH_BLOCK_WEIGHTS[key] = weight;
}
function getTrashBlockWeight(blockType) {
    const key = String(blockType || "").trim();
    return key !== "" && Object.prototype.hasOwnProperty.call(TRASH_BLOCK_WEIGHTS, key)
        ? TRASH_BLOCK_WEIGHTS[key]
        : 0;
}
function registerLandfillPrize(rank, items) {
    const cleanRank = Math.trunc(Number(rank));
    if (!Number.isFinite(cleanRank) || cleanRank < 1 || cleanRank > 10)
        return;
    LANDFILL_PRIZES[cleanRank] = Array.isArray(items) ? items : [];
}
function getPrizeForRank(rank) {
    return LANDFILL_PRIZES[rank] || [];
}
function pad2(value) {
    return String(value).padStart(2, "0");
}
function getSeasonKeyForDate(date) {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}
function getCurrentSeasonKey() {
    return getSeasonKeyForDate(new Date());
}
function isLandfillWorldName(worldName) {
    return String(worldName || "").toLowerCase().startsWith(LANDFILL_WORLD_PREFIX);
}
function createLandfillEventSystem(deps) {
    const { cleanAccountName, ensureWritablePlayerState, canAddItemToState, addItemToState, commitPlayerInventoryState, cloneJson, postgresStore, getWorldPopulationCount, sendJson, makeRequestId, getErrorMessage, logger = console, minPlayersToStart = 2, maxPlayersPerInstance = 5, isEventWindowOpen, instancePollIntervalMs = 5000, instanceIdleCleanupMs = 30 * 60 * 1000, 
    // Phase 2.5: used ONLY at instance-creation time to compute+cache entryPenBounds (see
    // createNewInstance) -- never called from the per-movement-tick hot path.
    getJoinWorldSpawnForWorld, entryPenRadiusPixels = 128, } = deps;
    const instances = new Map();
    let pollTimer = null;
    function listInstances() {
        return Array.from(instances.values());
    }
    // Computed once per instance, at creation time, from that world's actual join spawn point --
    // NOT recomputed on every movement packet. If the spawn point can't be resolved yet (e.g. the
    // world's terrain hasn't been generated/loaded), returns null: getLandfillEntryPenBounds then
    // reports "no confinement" for this instance rather than blocking movement on a transient
    // lookup failure, so a startup-ordering hiccup fails open (no pen) rather than trapping
    // players who did legitimately join.
    function computeEntryPenBounds(worldName) {
        if (typeof getJoinWorldSpawnForWorld !== "function")
            return null;
        const spawn = getJoinWorldSpawnForWorld(worldName);
        const spawnX = Number(spawn?.x);
        const spawnY = Number(spawn?.y);
        if (!Number.isFinite(spawnX) || !Number.isFinite(spawnY))
            return null;
        const radius = Math.max(0, Number(entryPenRadiusPixels) || 0);
        if (radius <= 0)
            return null;
        return {
            minX: spawnX - radius,
            maxX: spawnX + radius,
            minY: spawnY - radius,
            maxY: spawnY + radius,
        };
    }
    function createNewInstance() {
        let index = instances.size + 1;
        let worldName = `${LANDFILL_WORLD_PREFIX}${index}`;
        while (instances.has(worldName)) {
            index += 1;
            worldName = `${LANDFILL_WORLD_PREFIX}${index}`;
        }
        const instance = {
            worldName,
            index,
            state: "entry",
            createdAtMs: Date.now(),
            seasonKey: getCurrentSeasonKey(),
            participantUsernames: new Set(),
            entryPenBounds: computeEntryPenBounds(worldName),
        };
        instances.set(worldName, instance);
        return instance;
    }
    // Phase 2.5: the join_world-layer guard (canPlayerJoinLandfillInstance) stops a player from
    // joining a full/locked instance; this stops an already-joined player from wandering out of
    // the entry area before the gate opens. Called from server_phase11d_standard_movement.ts's
    // acceptPlayerMovement on every accepted movement tick, AFTER speed-cap clamping has already
    // run -- so this can only pull the accepted destination closer to the pen, never grant a
    // player extra distance beyond what the speed cap already allowed. Returns null (no
    // confinement) for any non-Landfill world, an unknown instance, or once the gate has opened
    // ("active" state) -- once the race has actually started, players are free to move anywhere
    // the normal collision system allows, same as any other world.
    function getLandfillEntryPenBounds(worldName) {
        if (!isLandfillWorldName(worldName))
            return null;
        const instance = instances.get(String(worldName || ""));
        if (!instance || instance.state !== "entry")
            return null;
        return instance.entryPenBounds;
    }
    function isInstanceJoinable(instance) {
        if (instance.state !== "entry")
            return false;
        if (instance.participantUsernames.size >= maxPlayersPerInstance)
            return false;
        const population = Math.max(0, Number(getWorldPopulationCount(instance.worldName)) || 0);
        return population < maxPlayersPerInstance;
    }
    // Phase 2: join_world-layer enforcement, called from server_phase8_player_session_routes.ts's
    // handleJoinWorld as an early guard clause -- see checkLandfillInstanceJoinEligibility /
    // recordLandfillInstanceJoin in that file's Phase8PlayerSessionDeps interface. Deliberately
    // does not touch anything inside handleJoinWorld's own provisional-entry state machine; it
    // only decides ok/reject BEFORE that machine starts, using data owned entirely by this module.
    function canPlayerJoinLandfillInstance(worldName, username) {
        if (!isLandfillWorldName(worldName))
            return { ok: true };
        const instance = instances.get(String(worldName || ""));
        if (!instance) {
            // Unknown to this module: either garbage-collected while idle, or a world name that was
            // never handed out by requestJoinLandfillRace (typed/guessed directly). Fail closed rather
            // than let a normal join_world flow enter an untracked Landfill instance.
            return { ok: false, reason: "instance_not_found" };
        }
        const cleanUsername = cleanAccountName(username || "");
        if (cleanUsername !== "" && instance.participantUsernames.has(cleanUsername)) {
            // Already-recorded participant (e.g. reconnecting after a disconnect) may always rejoin
            // their own instance, even if it has since locked or filled up to other players.
            return { ok: true };
        }
        if (instance.state !== "entry") {
            return { ok: false, reason: "instance_locked" };
        }
        if (instance.participantUsernames.size >= maxPlayersPerInstance) {
            return { ok: false, reason: "instance_full" };
        }
        return { ok: true };
    }
    // Companion to canPlayerJoinLandfillInstance -- called after that check passes and the normal
    // join_world flow is about to proceed, so this instance's capacity/lock bookkeeping reflects
    // the join immediately (not after the next population poll tick).
    function recordLandfillInstanceJoin(worldName, username) {
        if (!isLandfillWorldName(worldName))
            return;
        const instance = instances.get(String(worldName || ""));
        if (!instance)
            return;
        const cleanUsername = cleanAccountName(username || "");
        if (cleanUsername === "")
            return;
        instance.participantUsernames.add(cleanUsername);
    }
    function findOpenInstance() {
        for (const instance of instances.values()) {
            if (isInstanceJoinable(instance))
                return instance;
        }
        return null;
    }
    // Decides which Landfill world a joining player should be sent to. Does NOT move the player
    // -- the caller (the join_landfill_race_request handler below) hands the world name back to
    // the client, which then performs a completely normal join_world request, same as joining any
    // other named world.
    function requestJoinLandfillRace() {
        if (typeof isEventWindowOpen === "function" && !isEventWindowOpen()) {
            return { ok: false, reason: "event_not_active" };
        }
        const existing = findOpenInstance();
        const instance = existing || createNewInstance();
        return { ok: true, world_name: instance.worldName };
    }
    // Purely additive, read-only polling of already-existing world population data -- see the
    // scope note at the top of this file for why this doesn't hook the join/leave pipeline
    // directly. Flips "entry" instances to "active" (locking them) once enough players are
    // actually present, and forgets long-idle empty instances so the registry doesn't grow
    // without bound over a long-running server.
    function pollInstancesOnce() {
        const now = Date.now();
        for (const instance of instances.values()) {
            const population = Math.max(0, Number(getWorldPopulationCount(instance.worldName)) || 0);
            if (instance.state === "entry" && population >= minPlayersToStart) {
                instance.state = "active";
                logger.log(`[landfill] instance ${instance.worldName} gate opened with ${population} players.`);
                continue;
            }
            if (population === 0 && now - instance.createdAtMs > instanceIdleCleanupMs) {
                instances.delete(instance.worldName);
            }
        }
    }
    function startInstancePolling() {
        if (pollTimer)
            return;
        pollTimer = setInterval(() => {
            try {
                pollInstancesOnce();
            }
            catch (error) {
                logger.warn("[landfill] instance poll failed:", getErrorMessage ? getErrorMessage(error) : error);
            }
        }, Math.max(1000, Number(instancePollIntervalMs) || 5000));
        if (typeof pollTimer.unref === "function")
            pollTimer.unref();
    }
    function stopInstancePolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }
    function resetInstancesForNewWindow() {
        instances.clear();
    }
    // Additive hook for the world_block_update break path: if `worldName` is a Landfill instance
    // and `blockType` is a registered trash block, credits the season score. No-ops (awards
    // nothing) for any other world or unregistered block type -- safe to call unconditionally.
    async function awardKilogramsForBlockBreak(worldName, username, blockType) {
        if (!isLandfillWorldName(worldName))
            return;
        const weight = getTrashBlockWeight(String(blockType || ""));
        if (weight <= 0)
            return;
        const cleanUsername = cleanAccountName(username || "");
        if (cleanUsername === "")
            return;
        try {
            await postgresStore.incrementLandfillKilograms(cleanUsername, getCurrentSeasonKey(), weight);
        }
        catch (error) {
            logger.warn("[landfill] failed to award kilograms:", getErrorMessage ? getErrorMessage(error) : error);
        }
    }
    async function handleLandfillStatusRequest(socket, player, data) {
        const eventActive = typeof isEventWindowOpen === "function" ? isEventWindowOpen() : false;
        sendJson(socket, {
            type: "landfill_status",
            request_id: data?.request_id || "",
            event_active: eventActive,
            season_key: getCurrentSeasonKey(),
            min_players_to_start: minPlayersToStart,
            max_players_per_instance: maxPlayersPerInstance,
        });
    }
    async function handleLandfillJoinRequest(socket, player, data) {
        const result = requestJoinLandfillRace();
        sendJson(socket, {
            type: "landfill_join_result",
            request_id: data?.request_id || "",
            ok: result.ok,
            reason: result.reason || "",
            world_name: result.world_name || "",
        });
    }
    async function handleLandfillLeaderboardRequest(socket, player, data) {
        const seasonKey = getCurrentSeasonKey();
        const username = cleanAccountName(player?.account_username || player?.name || "");
        const [leaderboard, standing] = await Promise.all([
            postgresStore.getLandfillLeaderboard(seasonKey, 10),
            username !== "" ? postgresStore.getLandfillPlayerScore(username, seasonKey) : Promise.resolve(null),
        ]);
        sendJson(socket, {
            type: "landfill_leaderboard",
            request_id: data?.request_id || "",
            season_key: seasonKey,
            entries: leaderboard?.entries || [],
            your_kilograms: standing?.kilograms || 0,
            your_rank: standing?.rank || 0,
        });
    }
    async function claimLandfillPrize(socket, player, username) {
        const seasonKey = getCurrentSeasonKey();
        const leaderboard = await postgresStore.getLandfillLeaderboard(seasonKey, 10);
        const entries = leaderboard?.entries || [];
        const entry = entries.find((row) => cleanAccountName(row.username || "") === username);
        if (!entry) {
            return { ok: false, reason: "not_eligible", message: "You are not in this season's top 10." };
        }
        const rank = Number(entry.rank) || 0;
        const prizeItems = getPrizeForRank(rank);
        if (prizeItems.length === 0) {
            return { ok: false, reason: "prize_not_configured", message: "This season's prizes are not set up yet." };
        }
        const claimInsert = await postgresStore.insertLandfillPrizeClaim(username, seasonKey, rank);
        if (!claimInsert?.ok) {
            return { ok: false, reason: "database_error", message: "Could not record your claim. Try again." };
        }
        if (!claimInsert.inserted) {
            return { ok: false, reason: "already_claimed", message: "You already claimed this season's prize." };
        }
        const state = ensureWritablePlayerState(username);
        if (!state) {
            await postgresStore.deleteLandfillPrizeClaim(username, seasonKey);
            return { ok: false, reason: "inventory_unavailable", message: "Could not load your inventory." };
        }
        const beforeState = cloneJson(state);
        const stagedState = cloneJson(state);
        for (const item of prizeItems) {
            if (!canAddItemToState(stagedState, item.item_id, item.item_category, item.amount)) {
                await postgresStore.deleteLandfillPrizeClaim(username, seasonKey);
                return { ok: false, reason: "inventory_full", message: "Make room in your inventory before claiming." };
            }
            addItemToState(stagedState, item.item_id, item.item_category, item.amount);
        }
        const commit = await commitPlayerInventoryState(socket, player, username, beforeState, stagedState, {
            source: "landfill_season",
            action: "claim_prize",
            reason: "landfill_season_prize",
            request_id: makeRequestId ? makeRequestId() : "",
            metadata: { season_key: seasonKey, rank },
            failure_message: "Server inventory changed. Try again.",
        });
        if (!commit.ok) {
            await postgresStore.deleteLandfillPrizeClaim(username, seasonKey);
            return { ok: false, reason: commit.reason || "inventory_commit_failed", message: commit.message || "Could not grant your prize." };
        }
        return { ok: true, message: `Claimed rank #${rank} prize!` };
    }
    async function handleLandfillClaimPrizeRequest(socket, player, data) {
        const username = cleanAccountName(player?.account_username || player?.name || "");
        if (username === "") {
            sendJson(socket, { type: "landfill_claim_result", request_id: data?.request_id || "", ok: false, reason: "not_authenticated" });
            return;
        }
        const result = await claimLandfillPrize(socket, player, username);
        sendJson(socket, {
            type: "landfill_claim_result",
            request_id: data?.request_id || "",
            ok: result.ok,
            reason: result.reason || "",
            message: result.message || "",
        });
    }
    return {
        registerTrashBlockWeight,
        getTrashBlockWeight,
        registerLandfillPrize,
        getPrizeForRank,
        getCurrentSeasonKey,
        isLandfillWorldName,
        listInstances,
        requestJoinLandfillRace,
        canPlayerJoinLandfillInstance,
        recordLandfillInstanceJoin,
        getLandfillEntryPenBounds,
        startInstancePolling,
        stopInstancePolling,
        resetInstancesForNewWindow,
        awardKilogramsForBlockBreak,
        handleLandfillStatusRequest,
        handleLandfillJoinRequest,
        handleLandfillLeaderboardRequest,
        handleLandfillClaimPrizeRequest,
    };
}
module.exports = {
    createLandfillEventSystem,
    isLandfillWorldName,
    getCurrentSeasonKey,
    getSeasonKeyForDate,
};
