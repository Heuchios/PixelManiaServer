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
  //
  // The one exception is the abandoned-entry reconciliation in pollInstancesOnce: because
  // recordLandfillInstanceJoin runs in handleJoinWorld BEFORE the world-route check that can
  // still fail the join, a player whose join dies after that point would otherwise hold a slot in
  // this set forever without ever being present. That is a slow capacity leak that eventually
  // makes an instance permanently un-joinable (instance_full with nobody in it), so a still-in-
  // "entry" instance that has been provably empty for a while has its participant set released.
  participantUsernames: Set<string>;
  // Wall-clock of the last participantUsernames mutation. Only read by the abandoned-entry
  // reconciliation above, to keep it from clearing a set that is still actively being filled by
  // players who are mid-load and therefore not yet counted by getWorldPopulationCount.
  lastParticipantChangeMs: number;
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

// THE single normalization used for every `instances` Map key in this module -- see the Map
// access helpers (getInstance/hasInstance/deleteInstance) inside createLandfillEventSystem.
//
// This exists because of a real, fully-diagnosed production failure. The instance registry is a
// plain Map, so `.get()` is byte-exact, but the world name makes a round trip through two
// different normalizations before it comes back here:
//
//   1. createNewInstance() mints a name and hands it to the client in landfill_join_result.
//   2. The Godot client re-normalizes it (lobby_menu.gd's _normalize_world_name -> to_upper()).
//   3. The client sends join_world, and handleJoinWorld's very first line runs it through
//      cleanWorld() (server_identity_helpers.ts), which uppercases and strips to [A-Z0-9_-].
//   4. Only THEN does canPlayerJoinLandfillInstance() look the name up in this Map.
//
// If step 1 minted "landfill_1" while steps 2-3 produced "LANDFILL_1", the lookup missed on every
// single real join and returned instance_not_found -- deterministically, for every player, on
// every retry, forever. isLandfillWorldName() is case-insensitive, so the guard still *fired*; it
// just never *found* the instance, which is why the failure surfaced as a silent stall rather
// than an obvious error.
//
// Matching cleanWorld()'s transformation here means it no longer matters what case any caller
// uses: mint, store, look up, and evict all collapse to the same key. Do not "optimize" any Map
// access in this module back to a raw string -- that is precisely the bug this prevents.
function canonicalInstanceKey(worldName: unknown): string {
  return String(worldName || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "");
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
    // How long an "entry" instance must sit provably empty, with an unchanged participant set,
    // before those recorded slots are treated as abandoned and released -- see the reconciliation
    // in pollInstancesOnce. Comfortably longer than the client's whole join budget (its retry
    // watchdog gives up after roughly 1-2 minutes, see world_loading_ui_manager.gd), so a player
    // who is genuinely still loading can never have their reserved slot pulled out from under
    // them mid-join.
    abandonedEntryReleaseMs = 3 * 60 * 1000,
    // Phase 2.5: used ONLY at instance-creation time to compute+cache entryPenBounds (see
    // createNewInstance) -- never called from the per-movement-tick hot path.
    getJoinWorldSpawnForWorld,
    entryPenRadiusPixels = 128,
    // Task: guarantees every Landfill instance is a fresh regeneration -- see createNewInstance.
    resetLandfillWorldState,
  } = deps;

  // Keyed by canonicalInstanceKey(worldName), never by a raw caller-supplied string. Every read
  // and write goes through the three helpers directly below -- see canonicalInstanceKey's comment
  // for the production failure that made this non-negotiable.
  const instances = new Map<string, LandfillInstance>();
  let pollTimer: any = null;

  function getInstance(worldName: unknown): LandfillInstance | undefined {
    return instances.get(canonicalInstanceKey(worldName));
  }

  function hasInstance(worldName: unknown): boolean {
    return instances.has(canonicalInstanceKey(worldName));
  }

  function deleteInstance(worldName: unknown): boolean {
    return instances.delete(canonicalInstanceKey(worldName));
  }

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

  async function createNewInstance(): Promise<LandfillInstance> {
    // canonicalInstanceKey() is what makes the name minted here survive the client round trip
    // intact -- see its comment. The generated name is stored in instance.worldName in exactly
    // the form it is keyed by, so the value handed to the client in landfill_join_result, the
    // value passed to getWorldPopulationCount/resetLandfillWorldState, and the Map key are all
    // one and the same string.
    let index = instances.size + 1;
    let worldName = canonicalInstanceKey(`${LANDFILL_WORLD_PREFIX}${index}`);
    while (hasInstance(worldName)) {
      index += 1;
      worldName = canonicalInstanceKey(`${LANDFILL_WORLD_PREFIX}${index}`);
    }
    // Reserve this instance's slot synchronously -- no await between the has()/set() calls
    // bracketing this object -- so a second, concurrent createNewInstance() call can't pick the
    // same worldName while this one is still resetting it below.
    const instance: LandfillInstance = {
      worldName,
      index,
      state: "entry",
      createdAtMs: Date.now(),
      seasonKey: getCurrentSeasonKey(),
      participantUsernames: new Set<string>(),
      lastParticipantChangeMs: Date.now(),
      entryPenBounds: null,
    };
    instances.set(canonicalInstanceKey(worldName), instance);
    logger.log("[WORLD_JOIN] landfill instance created", {
      world: worldName,
      instance_key: canonicalInstanceKey(worldName),
      index,
      season_key: instance.seasonKey,
      registry_size: instances.size,
    });

    // Task: every Landfill world instance must start as a fresh regeneration, never carrying
    // over a previous race's block edits -- even when this instance name (e.g. landfill_1) was
    // used before and has since been garbage-collected from `instances` (the has() loop above
    // only guards against names currently tracked in-memory, not past occupants; see
    // resetWorldStateForFreshInstance in server.ts for what actually gets wiped). Reset BEFORE
    // computing the entry pen so it's derived from genuinely fresh terrain, not a stale
    // in-memory copy of the previous occupant's world state.
    if (typeof resetLandfillWorldState === "function") {
      await resetLandfillWorldState(worldName);
    }
    instance.entryPenBounds = computeEntryPenBounds(worldName);
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
    const instance = getInstance(worldName);
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
    const instance = getInstance(worldName);
    if (!instance) {
      // Unknown to this module: either garbage-collected while idle, or a world name that was
      // never handed out by requestJoinLandfillRace (typed/guessed directly). Fail closed rather
      // than let a normal join_world flow enter an untracked Landfill instance.
      //
      // Logged with the full registry because this is the exact rejection the case-mismatch bug
      // produced (see canonicalInstanceKey). If it ever fires again, this line answers "was the
      // instance missing, or was it there under a key we failed to match?" without needing a
      // repro -- the previous silent `return` cost an entire debugging session to characterize.
      logger.warn("[WORLD_JOIN] landfill join rejected: instance_not_found", {
        requested_world: String(worldName || ""),
        lookup_key: canonicalInstanceKey(worldName),
        known_instance_keys: Array.from(instances.keys()),
      });
      return { ok: false, reason: "instance_not_found" };
    }
    const cleanUsername = cleanAccountName(username || "");
    if (cleanUsername !== "" && instance.participantUsernames.has(cleanUsername)) {
      // Already-recorded participant (e.g. reconnecting after a disconnect) may always rejoin
      // their own instance, even if it has since locked or filled up to other players, and even
      // if the event window has since closed -- this only gates brand-new entries below.
      return { ok: true };
    }
    if (instance.state === "entry" && typeof isEventWindowOpen === "function" && !isEventWindowOpen()) {
      // The calendar window closed while this instance was still sitting open in the entry pen
      // (e.g. never filled up). Block new direct/typed joins into it -- only requestJoinLandfillRace
      // (which already checks isEventWindowOpen) may hand out entry into a live instance.
      return { ok: false, reason: "event_not_active" };
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
    const instance = getInstance(worldName);
    if (!instance) return;
    const cleanUsername = cleanAccountName(username || "");
    if (cleanUsername === "") return;
    instance.participantUsernames.add(cleanUsername);
    instance.lastParticipantChangeMs = Date.now();
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
  async function requestJoinLandfillRace(): Promise<{ ok: boolean; reason?: string; world_name?: string }> {
    if (typeof isEventWindowOpen === "function" && !isEventWindowOpen()) {
      return { ok: false, reason: "event_not_active" };
    }
    const existing = findOpenInstance();
    const instance = existing || await createNewInstance();
    // This is the name the client is about to echo back in a join_world request, so log it in the
    // same canonical form canPlayerJoinLandfillInstance will key on. A mismatch between this line
    // and the lookup_key on a subsequent instance_not_found warning localizes the whole failure to
    // the round trip in one glance.
    logger.log("[WORLD_JOIN] landfill race instance assigned", {
      world: instance.worldName,
      instance_key: canonicalInstanceKey(instance.worldName),
      reused_existing: existing !== null,
      state: instance.state,
      participants: instance.participantUsernames.size,
    });
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

      // Abandoned-entry reconciliation. recordLandfillInstanceJoin runs in handleJoinWorld before
      // the world-route check that can still fail the join, so a join that dies after that point
      // leaves a username occupying a slot in participantUsernames while that player is not, and
      // never was, actually in the world. Left alone those slots accumulate until the instance
      // reports instance_full with nobody standing in it -- permanently un-joinable, and a
      // guaranteed repeat of the "silently un-enterable Landfill world" class of bug.
      //
      // Releasing is only safe when we are certain nobody is mid-join: the instance must still be
      // in "entry" (never gated open), the world must be provably empty, and the participant set
      // must have been untouched for longer than a client could plausibly still be loading. The
      // reconnect guarantee is unaffected -- an instance with zero players present has no session
      // left to reconnect into, and the freed instance stays joinable by anyone including them.
      if (
        instance.state === "entry"
        && population === 0
        && instance.participantUsernames.size > 0
        && now - instance.lastParticipantChangeMs > abandonedEntryReleaseMs
      ) {
        logger.warn("[WORLD_JOIN] releasing abandoned landfill entry slots", {
          world: instance.worldName,
          released: Array.from(instance.participantUsernames),
          idle_ms: now - instance.lastParticipantChangeMs,
        });
        instance.participantUsernames.clear();
        instance.lastParticipantChangeMs = now;
      }

      if (population === 0 && now - instance.createdAtMs > instanceIdleCleanupMs) {
        deleteInstance(instance.worldName);
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
    const result = await requestJoinLandfillRace();
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
    // Exported for check_server_landfill_event_build.js so the gate-open transition and the
    // abandoned-entry slot reconciliation can be driven deterministically in a test instead of
    // waiting on the ~5s interval timer. Nothing in the server calls this directly -- production
    // reaches it only through startInstancePolling.
    pollInstancesOnce,
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
