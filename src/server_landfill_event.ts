"use strict";

// "Landfill" seasonal race event.
//
// Design (confirmed with Hassan 2026-08-11, see project memory landfill_seasonal_event_design.md
// for the full discussion -- read that before changing this file):
//   - A cron-scheduled join window (e.g. the first week of the month), driven by
//     server_calendar_events.ts. While the window is open, players can join via the lobby
//     "Join Race" button.
//   - Joining sends the player straight into a dedicated Landfill world INSTANCE (numbered
//     landfill_1, landfill_2, ...), not a separate queue screen. Each instance caps at
//     MAX_PLAYERS_PER_INSTANCE players; once full, new joiners are routed to a different
//     (or freshly created) instance.
//   - Instances start in an "entry" state. Once at least MIN_PLAYERS_TO_START players are
//     actually present (checked by polling the existing, unmodified world-population reader --
//     see startInstancePolling below), the instance flips to "active" and LOCKS: no further
//     joins to that instance, even with empty slots.
//   - Breaking trash blocks inside an active instance awards "Kilograms" (points), weighted per
//     block type via registerTrashBlockWeight/getTrashBlockWeight. Points persist per player
//     for the whole season (calendar month), accumulated across however many instance-runs a
//     player participates in.
//   - A leaderboard shows the season's top 10; each of those slots can claim a configured prize
//     via handleLandfillClaimPrizeRequest, gated on inventory space. Unclaimed prizes are
//     forfeited once the calendar month rolls over (see claimLandfillPrize: eligibility is
//     scoped to the CURRENT season key, so an old season's prizes simply stop being claimable
//     once a new one starts -- no destructive "reset" mutation is needed, next month's season
//     key just starts at zero rows).
//
// IMPORTANT SCOPE NOTE (Phase 1 of a multi-phase build): this module deliberately does NOT hook
// into the join_world/door_enter pipeline (server_phase8_player_session_routes.ts) or the
// trusted-movement pipeline. Both are documented in project memory as the source of repeated
// serious production outages (world_join_outage_2026_08.md, world_route_epoch_fencing.md,
// world_entry_provisional_latch.md, world_ownership_lease_lost.md). Instead:
//   - Instance occupancy is detected by POLLING the existing, already-battle-tested
//     getWorldPopulationCount reader on a timer (see startInstancePolling) -- purely additive
//     and read-only, zero risk to the join/leave pipeline.
//   - requestJoinLandfillRace only decides WHICH world name a player should go to; the client
//     is expected to then issue a completely normal join_world request to that name, reusing
//     the existing, unmodified join flow (the same one every other world join already uses).
//   - Actually confining players to the "entry area" until the gate opens, and locking the
//     instance to late joiners at the join_world/door_enter layer, is Phase 2 -- it needs a
//     dedicated read of server_phase8_player_session_routes.ts first, which this pass did not
//     do. Until Phase 2 lands, isInstanceJoinable() is authoritative for routing new players via
//     requestJoinLandfillRace, but nothing yet stops a player from reaching a full/locked
//     instance through some other path (e.g. a door, or a direct join_world call with the
//     world name guessed/typed).
//
// Trash block weights and the top-10 prize catalog are intentionally empty registries: Hassan
// will add real entries later, the same workflow as the existing blocks-atlas migration
// batches. Leaving them empty is correct behavior right now (no trash blocks exist yet to
// register), not a placeholder -- awardKilogramsForBlockBreak and claim both fail closed
// (award nothing / refuse to claim) rather than fabricating fake data when a registry is empty.

interface LandfillDeps extends Record<string, any> {}

interface LandfillInstance {
  worldName: string;
  index: number;
  state: "entry" | "active";
  createdAtMs: number;
  seasonKey: string;
  // Phase 2: usernames recorded via recordLandfillInstanceJoin once they actually pass the
  // join_world-layer eligibility guard (see canPlayerJoinLandfillInstance below). This is the
  // authoritative, immediately-updated capacity signal for that guard -- unlike
  // getWorldPopulationCount, which is only refreshed by the ~5s poll in pollInstancesOnce and so
  // is too laggy to safely gate concurrent joins. A username is never removed from this set on
  // disconnect, so a participant can always rejoin their own instance later, even after it has
  // locked or is otherwise full to new players.
  participantUsernames: Set<string>;
  // Phase 2.5: the instance's holding-pen bounding box in world pixel coordinates, computed
  // ONCE at instance creation (see createNewInstance) from that world's actual join spawn point
  // -- not recomputed per movement packet, since getLandfillEntryPenBounds is called from the
  // hot per-tick movement path (see server_phase11d_standard_movement.ts). null when the join
  // spawn point could not be resolved (e.g. world state not ready yet); getLandfillEntryPenBounds
  // treats that the same as "no confinement" rather than blocking movement on a lookup failure.
  entryPenBounds: EntryPenBounds | null;
}

interface EntryPenBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface PrizeItem {
  item_id: string;
  item_category: string;
  amount: number;
}

const LANDFILL_WORLD_PREFIX = "landfill_";

// Empty by design -- populated later, block key -> Kilograms awarded per break.
const TRASH_BLOCK_WEIGHTS: Record<string, number> = {};

// Empty by design -- populated later, rank (1-10) -> prize items.
const LANDFILL_PRIZES: Record<number, PrizeItem[]> = {};

function registerTrashBlockWeight(blockType: string, kilograms: number): void {
  const key = String(blockType || "").trim();
  const weight = Number(kilograms);
  if (key === "" || !Number.isFinite(weight) || weight <= 0) return;
  TRASH_BLOCK_WEIGHTS[key] = weight;
}

function getTrashBlockWeight(blockType: string): number {
  const key = String(blockType || "").trim();
  return key !== "" && Object.prototype.hasOwnProperty.call(TRASH_BLOCK_WEIGHTS, key)
    ? TRASH_BLOCK_WEIGHTS[key]
    : 0;
}

function registerLandfillPrize(rank: number, items: PrizeItem[]): void {
  const cleanRank = Math.trunc(Number(rank));
  if (!Number.isFinite(cleanRank) || cleanRank < 1 || cleanRank > 10) return;
  LANDFILL_PRIZES[cleanRank] = Array.isArray(items) ? items : [];
}

function getPrizeForRank(rank: number): PrizeItem[] {
  return LANDFILL_PRIZES[rank] || [];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getSeasonKeyForDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function getCurrentSeasonKey(): string {
  return getSeasonKeyForDate(new Date());
}

function isLandfillWorldName(worldName: unknown): boolean {
  return String(worldName || "").toLowerCase().startsWith(LANDFILL_WORLD_PREFIX);
}

function createLandfillEventSystem(deps: LandfillDeps) {
  const {
    cleanAccountName,
    ensureWritablePlayerState,
    canAddItemToState,
    addItemToState,
    commitPlayerInventoryState,
    cloneJson,
    postgresStore,
    getWorldPopulationCount,
    sendJson,
    makeRequestId,
    getErrorMessage,
    logger = console,
    minPlayersToStart = 2,
    maxPlayersPerInstance = 5,
    isEventWindowOpen,
    instancePollIntervalMs = 5000,
    instanceIdleCleanupMs = 30 * 60 * 1000,
    // Phase 2.5: used ONLY at instance-creation time to compute+cache entryPenBounds (see
    // createNewInstance) -- never called from the per-movement-tick hot path.
    getJoinWorldSpawnForWorld,
    entryPenRadiusPixels = 128,
  } = deps;

  const instances = new Map<string, LandfillInstance>();
  let pollTimer: any = null;

  function listInstances(): LandfillInstance[] {
    return Array.from(instances.values());
  }

  // Computed once per instance, at creation time, from that world's actual join spawn point --
  // NOT recomputed on every movement packet. If the spawn point can't be resolved yet (e.g. the
  // world's terrain hasn't been generated/loaded), returns null: getLandfillEntryPenBounds then
  // reports "no confinement" for this instance rather than blocking movement on a transient
  // lookup failure, so a startup-ordering hiccup fails open (no pen) rather than trapping
  // players who did legitimately join.
  function computeEntryPenBounds(worldName: string): EntryPenBounds | null {
    if (typeof getJoinWorldSpawnForWorld !== "function") return null;
    const spawn = getJoinWorldSpawnForWorld(worldName);
    const spawnX = Number(spawn?.x);
    const spawnY = Number(spawn?.y);
    if (!Number.isFinite(spawnX) || !Number.isFinite(spawnY)) return null;
    const radius = Math.max(0, Number(entryPenRadiusPixels) || 0);
    if (radius <= 0) return null;
    return {
      minX: spawnX - radius,
      maxX: spawnX + radius,
      minY: spawnY - radius,
      maxY: spawnY + radius,
    };
  }

  function createNewInstance(): LandfillInstance {
    let index = instances.size + 1;
    let worldName = `${LANDFILL_WORLD_PREFIX}${index}`;
    while (instances.has(worldName)) {
      index += 1;
      worldName = `${LANDFILL_WORLD_PREFIX}${index}`;
    }
    const instance: LandfillInstance = {
      worldName,
      index,
      state: "entry",
      createdAtMs: Date.now(),
      seasonKey: getCurrentSeasonKey(),
      participantUsernames: new Set<string>(),
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
  function getLandfillEntryPenBounds(worldName: unknown): EntryPenBounds | null {
    if (!isLandfillWorldName(worldName)) return null;
    const instance = instances.get(String(worldName || ""));
    if (!instance || instance.state !== "entry") return null;
    return instance.entryPenBounds;
  }

  function isInstanceJoinable(instance: LandfillInstance): boolean {
    if (instance.state !== "entry") return false;
    if (instance.participantUsernames.size >= maxPlayersPerInstance) return false;
    const population = Math.max(0, Number(getWorldPopulationCount(instance.worldName)) || 0);
    return population < maxPlayersPerInstance;
  }

  // Phase 2: join_world-layer enforcement, called from server_phase8_player_session_routes.ts's
  // handleJoinWorld as an early guard clause -- see checkLandfillInstanceJoinEligibility /
  // recordLandfillInstanceJoin in that file's Phase8PlayerSessionDeps interface. Deliberately
  // does not touch anything inside handleJoinWorld's own provisional-entry state machine; it
  // only decides ok/reject BEFORE that machine starts, using data owned entirely by this module.
  function canPlayerJoinLandfillInstance(worldName: unknown, username: unknown): { ok: boolean; reason?: string } {
    if (!isLandfillWorldName(worldName)) return { ok: true };
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
  function recordLandfillInstanceJoin(worldName: unknown, username: unknown): void {
    if (!isLandfillWorldName(worldName)) return;
    const instance = instances.get(String(worldName || ""));
    if (!instance) return;
    const cleanUsername = cleanAccountName(username || "");
    if (cleanUsername === "") return;
    instance.participantUsernames.add(cleanUsername);
  }

  function findOpenInstance(): LandfillInstance | null {
    for (const instance of instances.values()) {
      if (isInstanceJoinable(instance)) return instance;
    }
    return null;
  }

  // Decides which Landfill world a joining player should be sent to. Does NOT move the player
  // -- the caller (the join_landfill_race_request handler below) hands the world name back to
  // the client, which then performs a completely normal join_world request, same as joining any
  // other named world.
  function requestJoinLandfillRace(): { ok: boolean; reason?: string; world_name?: string } {
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
  function pollInstancesOnce(): void {
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

  function startInstancePolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      try {
        pollInstancesOnce();
      } catch (error) {
        logger.warn("[landfill] instance poll failed:", getErrorMessage ? getErrorMessage(error) : error);
      }
    }, Math.max(1000, Number(instancePollIntervalMs) || 5000));
    if (typeof pollTimer.unref === "function") pollTimer.unref();
  }

  function stopInstancePolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function resetInstancesForNewWindow(): void {
    instances.clear();
  }

  // Additive hook for the world_block_update break path: if `worldName` is a Landfill instance
  // and `blockType` is a registered trash block, credits the season score. No-ops (awards
  // nothing) for any other world or unregistered block type -- safe to call unconditionally.
  async function awardKilogramsForBlockBreak(worldName: unknown, username: unknown, blockType: unknown): Promise<void> {
    if (!isLandfillWorldName(worldName)) return;
    const weight = getTrashBlockWeight(String(blockType || ""));
    if (weight <= 0) return;
    const cleanUsername = cleanAccountName(username || "");
    if (cleanUsername === "") return;
    try {
      await postgresStore.incrementLandfillKilograms(cleanUsername, getCurrentSeasonKey(), weight);
    } catch (error) {
      logger.warn("[landfill] failed to award kilograms:", getErrorMessage ? getErrorMessage(error) : error);
    }
  }

  async function handleLandfillStatusRequest(socket: any, player: any, data: any): Promise<void> {
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

  async function handleLandfillJoinRequest(socket: any, player: any, data: any): Promise<void> {
    const result = requestJoinLandfillRace();
    sendJson(socket, {
      type: "landfill_join_result",
      request_id: data?.request_id || "",
      ok: result.ok,
      reason: result.reason || "",
      world_name: result.world_name || "",
    });
  }

  async function handleLandfillLeaderboardRequest(socket: any, player: any, data: any): Promise<void> {
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

  async function claimLandfillPrize(socket: any, player: any, username: string): Promise<{ ok: boolean; reason?: string; message?: string }> {
    const seasonKey = getCurrentSeasonKey();

    const leaderboard = await postgresStore.getLandfillLeaderboard(seasonKey, 10);
    const entries = leaderboard?.entries || [];
    const entry = entries.find((row: any) => cleanAccountName(row.username || "") === username);
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

  async function handleLandfillClaimPrizeRequest(socket: any, player: any, data: any): Promise<void> {
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

export = {
  createLandfillEventSystem,
  isLandfillWorldName,
  getCurrentSeasonKey,
  getSeasonKeyForDate,
};
