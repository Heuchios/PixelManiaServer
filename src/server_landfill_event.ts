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

// ---------------------------------------------------------------------------------------------
// Race session model
// ---------------------------------------------------------------------------------------------
//
// A "session" and an "instance" are the same object here on purpose. An earlier draft split them
// into two modules; that would have meant a second tsconfig/sync/check triple in the build chain
// and a second require() in server.ts, for a state machine that is only ever 1:1 with an instance.
// Keeping them unified means the whole event still ships through the single already-wired
// build:server-landfill-event pipeline.
//
// The state names below replace the original "entry" | "active" pair. The mapping is:
//   "entry"  -> WAITING_FOR_PLAYERS + COUNTDOWN  (pre-race: entry pen on, joins allowed)
//   "active" -> RACING                            (pen off, joins locked)
// plus the three terminal states the original model had no concept of. Anything reading state
// must go through the isPreRace/isJoinable/isScoring helpers rather than comparing strings, so
// adding a state later cannot silently change pen or join behavior.
type LandfillSessionState =
  | "waiting_for_players"
  | "countdown"
  | "racing"
  | "finishing"
  | "finished"
  | "cleanup";

interface LandfillParticipant {
  username: string;
  displayName: string;
  // Kilograms collected in THIS race only. Deliberately distinct from the player's lifetime
  // season total in landfill_season_scores -- see persistSessionResults. Never read from the DB
  // and never written to it mid-race.
  kilograms: number;
  // Monotonic order of first appearance in this session. The final, stable tie-break so equal
  // scores never shuffle between broadcasts (requirement: deterministic ranking).
  joinOrder: number;
  // When this participant last reached their current kilograms total. Second tie-break: on equal
  // scores the player who got there first ranks higher, which is both fairer and stable.
  lastProgressAtMs: number;
  // Reconciled every tick from the live world roster. False means "not currently in the world" --
  // used for the min-players check and to mark DNF at completion. Their kilograms are preserved
  // so a reconnect inside the same race resumes exactly where they left off.
  connected: boolean;
}

interface LandfillRanking {
  username: string;
  displayName: string;
  kilograms: number;
  placement: number;
  connected: boolean;
}

interface LandfillInstance {
  sessionId: string;
  worldName: string;
  index: number;
  state: LandfillSessionState;
  createdAtMs: number;
  // Authoritative wall-clock deadlines. These are the ONLY source of truth for phase timing --
  // they are broadcast to clients so every client renders the same countdown/timer from a shared
  // deadline instead of each counting down independently from whenever its packet happened to
  // arrive. 0 means "not set yet".
  countdownEndsAtMs: number;
  raceStartedAtMs: number;
  raceEndsAtMs: number;
  finishedAtMs: number;
  seasonKey: string;
  participants: Map<string, LandfillParticipant>;
  nextJoinOrder: number;
  // Frozen at the RACING -> FINISHING transition. Once set, progress is closed: it is what gets
  // persisted and what the results screen shows, so a late-arriving block break cannot alter a
  // result that has already been ranked.
  finalRankings: LandfillRanking[] | null;
  // Exactly-once latches for the persist step. inFlight guards against the tick re-entering while
  // an await is outstanding; persisted is the terminal marker. The DB has its own
  // UNIQUE(session_id, player_id) guard underneath -- these just avoid the pointless round trip.
  resultsPersistInFlight: boolean;
  resultsPersisted: boolean;
  // Coalescing state for the throttled race-state broadcast (see maybeBroadcastSessionState).
  broadcastDirty: boolean;
  lastBroadcastAtMs: number;
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

// ---------------------------------------------------------------------------------------------
// Default trash weights: block key -> Kilograms awarded per break.
// ---------------------------------------------------------------------------------------------
// This registry was empty until now, which meant getTrashBlockWeight() returned 0 for every block
// and awardKilogramsForBlockBreak short-circuited on EVERY break -- the event was unscoreable in
// every environment. These defaults are derived from each block's atlas hardness (see
// Data/items/atlas_items.json ids 71-78), so tougher trash is worth proportionally more:
//   hardness 1 (bottle/jar/flask) -> 1kg, hardness 2 (garbage box) -> 2kg,
//   hardness 3 (trash dirt, vending machine) -> 3kg
// registerTrashBlockWeight still exists and still overrides these at runtime, so tuning does not
// require a code change here.
const DEFAULT_TRASH_BLOCK_WEIGHTS: Record<string, number> = {
  broken_bottle: 1,
  broken_jar: 1,
  broken_flask: 1,
  garbage_box: 2,
  trash_dirt_top: 3,
  trash_dirt_below: 3,
  broken_vending_machine: 3,
  trash_wallpaper: 1,
};

// Block key -> Kilograms. Seeded from the defaults above; registerTrashBlockWeight mutates it.
const TRASH_BLOCK_WEIGHTS: Record<string, number> = { ...DEFAULT_TRASH_BLOCK_WEIGHTS };

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
    // ----- Race session timing (all overridable from ecosystem.config.js; see LANDFILL_* env) --
    // The session tick. Must be comfortably finer than the countdown so a 10s countdown does not
    // visibly overshoot -- the original 5s population poll was far too coarse to drive a race.
    // Population is re-read on each tick, which is O(players in world) over a handful of live
    // instances, i.e. negligible.
    sessionTickIntervalMs = 250,
    countdownMs = 10_000,
    raceDurationMs = 120_000,
    // How long the finished session lingers so clients can render the results screen before
    // players are released and the world is destroyed.
    resultsDisplayMs = 12_000,
    // Floor between two race-state broadcasts for one session. Progress is coalesced into a dirty
    // flag and flushed at most this often, following queueWorldUpdateBroadcast's discipline in
    // server.ts -- a break-heavy race must not turn into a per-break fan-out.
    broadcastMinIntervalMs = 250,
    // Kilograms awarded on top of what a player collected, by finishing placement. Index 0 = 1st.
    // Anyone who finishes outside this list, or who collected nothing, still gets the
    // participation award. Centralized here so tuning never means touching several files.
    placementBonusKilograms = [100, 75, 50],
    participationBonusKilograms = 20,
    // Injectable purely so the build check can mint deterministic world names; production leaves
    // it undefined and gets Math.random.
    randomUnit,
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
    // Read-only roster reader: (worldName) => [{ username, displayName }] for the players actually
    // present in that world right now. This is how the session tracks who is present without
    // hooking the join/leave pipeline that this module's scope note explicitly forbids touching
    // (see the header). It is the same underlying reader getWorldPopulationCount already uses,
    // just returning identities instead of a bare count, so it inherits the same self-healing of
    // stale roster entries.
    getWorldPlayerIdentities,
    // (worldName, payload) => void. Pushes a message to exactly the players in one world.
    broadcastToWorld,
  } = deps;

  // Keyed by canonicalInstanceKey(worldName), never by a raw caller-supplied string. Every read
  // and write goes through the three helpers directly below -- see canonicalInstanceKey's comment
  // for the production failure that made this non-negotiable.
  const instances = new Map<string, LandfillInstance>();
  let pollTimer: any = null;
  let sessionSequence = 0;
  // World names retired by recent races. A finished world's terrain is a pure function of its
  // name (serverWorldGenerationSeed in server.ts hashes the name and nothing else), so reusing a
  // name would hand players the exact map they just finished. Bounded so it cannot grow forever.
  const recentlyUsedWorldNames: string[] = [];
  const RECENT_WORLD_NAME_MEMORY = 128;

  // Phase predicates. Every behavioral decision goes through these rather than comparing state
  // strings at the call site, so a new state cannot silently flip the entry pen on or reopen a
  // locked session.
  function isPreRaceState(state: LandfillSessionState): boolean {
    return state === "waiting_for_players" || state === "countdown";
  }

  function isJoinableState(state: LandfillSessionState): boolean {
    // Joining during the countdown is allowed: the race has not started, so nobody gains an
    // advantage, and refusing would make a nearly-full lobby feel broken. Once RACING begins the
    // session is locked for good (no late entry).
    return isPreRaceState(state);
  }

  function isScoringState(state: LandfillSessionState): boolean {
    // The single gate that stops progress counting before GO and after the finish.
    return state === "racing";
  }

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

  // Mint a world name no live session holds and no recent race used.
  //
  // This is what makes "every race is a fresh randomized world" true. Server terrain is a PURE
  // FUNCTION of the world name -- serverWorldGenerationSeed() in server.ts hashes only
  // `PIXELMANIA_WORLD_<NAME>` with no time or randomness anywhere -- so a given name always
  // regenerates byte-for-byte the same map. The previous naming scheme (`instances.size + 1`,
  // with idle eviction recycling low indices) therefore meant LANDFILL_1 was the identical map
  // for every race, forever; the first race of any day was always the same map.
  //
  // Randomising the suffix rather than incrementing it matters: serverWorldGenerationSeed maps
  // consecutive names to consecutive integers, and serverCellNoise folds the seed in only as a
  // small phase offset, so sequential names are a weak spread. A wide random suffix decorrelates
  // properly. Deliberately NOT threading an explicit seed through the shared terrain generator --
  // that generator serves every ordinary world in the game, and this achieves the same result
  // with zero blast radius outside this module.
  function mintSessionWorldName(): string {
    const nextUnit = typeof randomUnit === "function" ? randomUnit : Math.random;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const suffix = 100000 + Math.floor(Number(nextUnit()) * 899999);
      const candidate = canonicalInstanceKey(`${LANDFILL_WORLD_PREFIX}${suffix}`);
      if (!instances.has(candidate) && !recentlyUsedWorldNames.includes(candidate)) return candidate;
    }
    // Exhausting 64 random draws means the namespace is somehow saturated. Fall back to a
    // monotonic suffix so session creation degrades instead of failing -- a repeated map is far
    // better than a race that cannot start.
    let fallbackIndex = instances.size + 1;
    let fallback = canonicalInstanceKey(`${LANDFILL_WORLD_PREFIX}${fallbackIndex}`);
    while (instances.has(fallback)) {
      fallbackIndex += 1;
      fallback = canonicalInstanceKey(`${LANDFILL_WORLD_PREFIX}${fallbackIndex}`);
    }
    logger.warn("[WORLD_JOIN] landfill world-name minting fell back to a sequential name", {
      world: fallback,
      live_sessions: instances.size,
    });
    return fallback;
  }

  function rememberRetiredWorldName(worldName: string): void {
    const key = canonicalInstanceKey(worldName);
    if (key === "" || recentlyUsedWorldNames.includes(key)) return;
    recentlyUsedWorldNames.push(key);
    while (recentlyUsedWorldNames.length > RECENT_WORLD_NAME_MEMORY) recentlyUsedWorldNames.shift();
  }

  async function createNewInstance(): Promise<LandfillInstance> {
    // canonicalInstanceKey() is what makes the name minted here survive the client round trip
    // intact -- see its comment. The generated name is stored in instance.worldName in exactly
    // the form it is keyed by, so the value handed to the client in landfill_join_result, the
    // value passed to getWorldPopulationCount/resetLandfillWorldState, and the Map key are all
    // one and the same string.
    sessionSequence += 1;
    const index = sessionSequence;
    const worldName = mintSessionWorldName();
    // Reserve this instance's slot synchronously -- no await between the has()/set() calls
    // bracketing this object -- so a second, concurrent createNewInstance() call can't pick the
    // same worldName while this one is still resetting it below.
    const nowMs = Date.now();
    const instance: LandfillInstance = {
      sessionId: `lfs_${nowMs.toString(36)}_${index.toString(36)}_${canonicalInstanceKey(worldName)}`,
      worldName,
      index,
      state: "waiting_for_players",
      createdAtMs: nowMs,
      countdownEndsAtMs: 0,
      raceStartedAtMs: 0,
      raceEndsAtMs: 0,
      finishedAtMs: 0,
      seasonKey: getCurrentSeasonKey(),
      participants: new Map<string, LandfillParticipant>(),
      nextJoinOrder: 1,
      finalRankings: null,
      resultsPersistInFlight: false,
      resultsPersisted: false,
      broadcastDirty: true,
      lastBroadcastAtMs: 0,
      participantUsernames: new Set<string>(),
      lastParticipantChangeMs: nowMs,
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
    // isPreRaceState covers WAITING_FOR_PLAYERS and COUNTDOWN. The pen is released the instant the
    // session flips to RACING, which is exactly the GO moment -- so "players cannot leave the
    // start area before the race begins" is enforced by the same transition that starts the clock,
    // with no second mechanism to keep in sync.
    if (!instance || !isPreRaceState(instance.state)) return null;
    return instance.entryPenBounds;
  }

  function isInstanceJoinable(instance: LandfillInstance): boolean {
    if (!isJoinableState(instance.state)) return false;
    if (instance.participants.size >= maxPlayersPerInstance) return false;
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
    if (isPreRaceState(instance.state) && typeof isEventWindowOpen === "function" && !isEventWindowOpen()) {
      // The calendar window closed while this instance was still sitting open in the entry pen
      // (e.g. never filled up). Block new direct/typed joins into it -- only requestJoinLandfillRace
      // (which already checks isEventWindowOpen) may hand out entry into a live instance.
      return { ok: false, reason: "event_not_active" };
    }
    if (!isJoinableState(instance.state)) {
      // RACING and every terminal state. This is the late-entry lock: once the race is underway
      // nobody new gets in, so a player who joined at t=0 is never racing someone who arrived at
      // t=90s. Already-recorded participants short-circuited above, so a mid-race reconnect by a
      // genuine competitor still works.
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
  async function requestJoinLandfillRace(username: unknown = ""): Promise<{ ok: boolean; reason?: string; world_name?: string }> {
    if (typeof isEventWindowOpen === "function" && !isEventWindowOpen()) {
      return { ok: false, reason: "event_not_active" };
    }
    // A player may only belong to one live session. Without this, pressing Join Race again while
    // already in a race would enrol the same account in a second session: their breaks would score
    // in whichever world they are standing in, but BOTH sessions would persist a result for them
    // at completion, awarding KG twice for one race's worth of work. Returning their existing
    // session instead makes the button idempotent and doubles as the reconnect path.
    const cleanRequester = cleanAccountName(username || "");
    if (cleanRequester !== "") {
      const existingSession = findSessionForParticipant(cleanRequester);
      if (existingSession) {
        logger.log("[WORLD_JOIN] landfill join returning player to their existing session", {
          world: existingSession.worldName,
          session_id: existingSession.sessionId,
          state: existingSession.state,
          username: cleanRequester,
        });
        return { ok: true, world_name: existingSession.worldName };
      }
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

      // Roster reconciliation first: every transition below depends on knowing who is actually
      // standing in the world right now, not on who once passed the join guard.
      reconcileParticipants(instance, now);
      advanceSessionState(instance, now);
      maybeBroadcastSessionState(instance, now);

      if (instance.state === "cleanup") {
        retireSession(instance);
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
        instance.state === "waiting_for_players"
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

      // Idle sweep. Only ever applies to a session that never got off the ground -- a session that
      // actually raced retires through the FINISHED -> CLEANUP path above, which also destroys its
      // world. Kept as the backstop for a session nobody ever entered.
      if (
        isPreRaceState(instance.state)
        && population === 0
        && instance.participants.size === 0
        && now - instance.createdAtMs > instanceIdleCleanupMs
      ) {
        retireSession(instance);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Session state machine
  // -------------------------------------------------------------------------------------------

  function findSessionForParticipant(cleanUsername: string): LandfillInstance | null {
    if (cleanUsername === "") return null;
    for (const instance of instances.values()) {
      // A terminal session is not a membership that should block or redirect a new join.
      if (instance.state === "finished" || instance.state === "cleanup") continue;
      if (instance.participants.has(cleanUsername)) return instance;
      if (instance.participantUsernames.has(cleanUsername)) return instance;
    }
    return null;
  }

  function countConnectedParticipants(instance: LandfillInstance): number {
    let total = 0;
    for (const participant of instance.participants.values()) {
      if (participant.connected) total += 1;
    }
    return total;
  }

  // Sync instance.participants against who is physically in the world. This is the module's only
  // knowledge of arrivals and departures, and it is deliberately a READ of the existing roster
  // rather than a hook into the join/leave pipeline -- the header scope note documents why that
  // pipeline is not to be touched. The cost is up to one tick of latency on a departure, which is
  // immaterial for a 10s countdown and a 120s race.
  function reconcileParticipants(instance: LandfillInstance, nowMs: number): void {
    if (typeof getWorldPlayerIdentities !== "function") return;
    let roster: unknown;
    try {
      roster = getWorldPlayerIdentities(instance.worldName);
    } catch (error) {
      logger.warn("[landfill] roster read failed:", getErrorMessage ? getErrorMessage(error) : error);
      return;
    }
    if (!Array.isArray(roster)) return;

    const presentNow = new Set<string>();
    for (const entry of roster) {
      const cleanUsername = cleanAccountName((entry as any)?.username || "");
      if (cleanUsername === "") continue;
      presentNow.add(cleanUsername);

      const existing = instance.participants.get(cleanUsername);
      if (existing) {
        if (!existing.connected) {
          existing.connected = true;
          instance.broadcastDirty = true;
        }
        const displayName = String((entry as any)?.displayName || "").trim();
        if (displayName !== "" && displayName !== existing.displayName) {
          existing.displayName = displayName;
          instance.broadcastDirty = true;
        }
        continue;
      }

      // A newcomer. Only admitted while the session can still take entrants -- somebody who
      // reaches a RACING world through an unexpected route is present but never becomes a
      // competitor, so they cannot score or appear in results.
      if (!isJoinableState(instance.state)) continue;
      instance.participants.set(cleanUsername, {
        username: cleanUsername,
        displayName: String((entry as any)?.displayName || "").trim() || cleanUsername,
        kilograms: 0,
        joinOrder: instance.nextJoinOrder,
        lastProgressAtMs: nowMs,
        connected: true,
      });
      instance.nextJoinOrder += 1;
      instance.participantUsernames.add(cleanUsername);
      instance.lastParticipantChangeMs = nowMs;
      instance.broadcastDirty = true;
    }

    for (const participant of instance.participants.values()) {
      if (participant.connected && !presentNow.has(participant.username)) {
        // Left or dropped. Kept in the map with their progress intact: mid-race this is a DNF
        // that still gets ranked and still persists (so a disconnect never silently erases work),
        // and pre-race it simply stops counting toward the minimum.
        participant.connected = false;
        instance.broadcastDirty = true;
      }
    }
  }

  function advanceSessionState(instance: LandfillInstance, nowMs: number): void {
    const connected = countConnectedParticipants(instance);

    if (instance.state === "waiting_for_players") {
      if (connected >= minPlayersToStart) {
        instance.state = "countdown";
        instance.countdownEndsAtMs = nowMs + countdownMs;
        instance.broadcastDirty = true;
        logger.log("[landfill] countdown started", {
          world: instance.worldName,
          session_id: instance.sessionId,
          players: connected,
          countdown_ends_at_ms: instance.countdownEndsAtMs,
        });
      }
      return;
    }

    if (instance.state === "countdown") {
      if (connected < minPlayersToStart) {
        // Someone left and took us back under the minimum. Abort rather than start a race that
        // does not meet its own entry condition, and clear the deadline so a resumed countdown
        // starts from a full 10s rather than resuming a stale one.
        instance.state = "waiting_for_players";
        instance.countdownEndsAtMs = 0;
        instance.broadcastDirty = true;
        logger.log("[landfill] countdown cancelled, dropped below minimum", {
          world: instance.worldName,
          session_id: instance.sessionId,
          players: connected,
          required: minPlayersToStart,
        });
        return;
      }
      if (nowMs >= instance.countdownEndsAtMs) {
        instance.state = "racing";
        instance.raceStartedAtMs = nowMs;
        instance.raceEndsAtMs = nowMs + raceDurationMs;
        instance.broadcastDirty = true;
        logger.log("[landfill] race started", {
          world: instance.worldName,
          session_id: instance.sessionId,
          players: connected,
          race_ends_at_ms: instance.raceEndsAtMs,
        });
      }
      return;
    }

    if (instance.state === "racing") {
      if (nowMs >= instance.raceEndsAtMs) {
        // Freeze progress here, once. Everything downstream reads finalRankings, so a block break
        // that lands after this instant cannot change a placement that has been ranked.
        instance.state = "finishing";
        instance.finishedAtMs = nowMs;
        instance.finalRankings = buildRankings(instance);
        instance.broadcastDirty = true;
        logger.log("[landfill] race finished", {
          world: instance.worldName,
          session_id: instance.sessionId,
          rankings: instance.finalRankings.map((row) => `${row.placement}:${row.username}=${row.kilograms}`),
        });
      }
      // Deliberately no early return: fall through to the FINISHING branch below so the persist
      // starts on this same tick rather than a tick later. Players should not wait an extra tick
      // for their results, and the branch is a no-op while the race is still running.
    }

    if (instance.state === "finishing") {
      if (instance.resultsPersisted) {
        instance.state = "finished";
        instance.broadcastDirty = true;
        return;
      }
      if (!instance.resultsPersistInFlight) {
        instance.resultsPersistInFlight = true;
        // Fire-and-forget: the tick must never block the event loop on the DB. The in-flight latch
        // above means a slow write cannot be started twice by successive ticks.
        void persistSessionResults(instance);
      }
      return;
    }

    if (instance.state === "finished") {
      if (nowMs - instance.finishedAtMs >= resultsDisplayMs) {
        instance.state = "cleanup";
      }
    }
  }

  // Deterministic ordering: most kilograms first; on a tie the player who reached that total
  // earliest ranks higher; and if even that ties, the order they entered the session. The last key
  // is unique per session, so the sort is total -- the displayed order can never shuffle between
  // two broadcasts while nothing changed.
  function buildRankings(instance: LandfillInstance): LandfillRanking[] {
    return Array.from(instance.participants.values())
      .sort((left, right) => {
        if (right.kilograms !== left.kilograms) return right.kilograms - left.kilograms;
        if (left.lastProgressAtMs !== right.lastProgressAtMs) return left.lastProgressAtMs - right.lastProgressAtMs;
        return left.joinOrder - right.joinOrder;
      })
      .map((participant, index) => ({
        username: participant.username,
        displayName: participant.displayName,
        kilograms: participant.kilograms,
        placement: index + 1,
        connected: participant.connected,
      }));
  }

  function getPlacementBonus(placement: number): number {
    const table = Array.isArray(placementBonusKilograms) ? placementBonusKilograms : [];
    const bonus = Number(table[placement - 1]);
    return Number.isFinite(bonus) && bonus > 0 ? Math.trunc(bonus) : Math.max(0, Math.trunc(Number(participationBonusKilograms) || 0));
  }

  function retireSession(instance: LandfillInstance): void {
    rememberRetiredWorldName(instance.worldName);
    deleteInstance(instance.worldName);
    // Destroy the world itself, not just the session bookkeeping. Without this the finished race's
    // terrain edits would persist under a name that is never reused, leaking a world row per race.
    if (typeof resetLandfillWorldState === "function") {
      Promise.resolve(resetLandfillWorldState(instance.worldName)).catch((error: unknown) => {
        logger.warn("[landfill] failed to destroy finished race world:", getErrorMessage ? getErrorMessage(error) : error);
      });
    }
    logger.log("[landfill] session retired", {
      world: instance.worldName,
      session_id: instance.sessionId,
      persisted: instance.resultsPersisted,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Live race state broadcast
  // -------------------------------------------------------------------------------------------

  function buildSessionStatePayload(instance: LandfillInstance) {
    const rankings = instance.finalRankings || buildRankings(instance);
    return {
      type: "landfill_race_state",
      session_id: instance.sessionId,
      world: instance.worldName,
      state: instance.state,
      // Absolute server deadlines, not remaining durations. The client renders its countdown and
      // race clock by differencing these against its own clock, so every client shows the same
      // number and a dropped or delayed packet does not desynchronise anyone -- as opposed to each
      // client independently counting down from whenever a "start" packet happened to land.
      server_time_ms: Date.now(),
      countdown_ends_at_ms: instance.countdownEndsAtMs,
      race_started_at_ms: instance.raceStartedAtMs,
      race_ends_at_ms: instance.raceEndsAtMs,
      min_players_to_start: minPlayersToStart,
      max_players: maxPlayersPerInstance,
      connected_players: countConnectedParticipants(instance),
      competitors: rankings.map((row) => ({
        username: row.username,
        display_name: row.displayName,
        kilograms: row.kilograms,
        placement: row.placement,
        connected: row.connected,
      })),
    };
  }

  // Coalesced push. Progress marks the session dirty; this flushes at most once per
  // broadcastMinIntervalMs, so a player breaking blocks as fast as the break-pace limiter allows
  // produces a bounded, steady stream instead of a fan-out per break. Mirrors the dirty-flag +
  // single-timer discipline queueWorldUpdateBroadcast uses in server.ts.
  function maybeBroadcastSessionState(instance: LandfillInstance, nowMs: number): void {
    if (!instance.broadcastDirty) return;
    if (nowMs - instance.lastBroadcastAtMs < broadcastMinIntervalMs) return;
    if (typeof broadcastToWorld !== "function") return;
    instance.broadcastDirty = false;
    instance.lastBroadcastAtMs = nowMs;
    try {
      broadcastToWorld(instance.worldName, buildSessionStatePayload(instance));
    } catch (error) {
      logger.warn("[landfill] race state broadcast failed:", getErrorMessage ? getErrorMessage(error) : error);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Result persistence -- exactly once per (session, player)
  // -------------------------------------------------------------------------------------------

  async function persistSessionResults(instance: LandfillInstance): Promise<void> {
    const rankings = instance.finalRankings || buildRankings(instance);
    try {
      for (const row of rankings) {
        const awarded = row.kilograms + getPlacementBonus(row.placement);
        if (typeof postgresStore?.recordLandfillRaceResult !== "function") {
          logger.warn("[landfill] recordLandfillRaceResult unavailable; race results not persisted", {
            session_id: instance.sessionId,
          });
          break;
        }
        // One transaction per player: the result row and the lifetime KG increment commit
        // together or not at all, so a crash mid-way can never leave a player credited without a
        // result row (which would let a retry credit them twice) or vice versa. The DB's
        // UNIQUE(session_id, player_id) makes the insert the idempotency key -- a duplicate call
        // inserts nothing and, critically, skips the increment.
        const result = await postgresStore.recordLandfillRaceResult({
          sessionId: instance.sessionId,
          username: row.username,
          seasonKey: instance.seasonKey,
          worldName: instance.worldName,
          kilograms: row.kilograms,
          placement: row.placement,
          awardedKilograms: awarded,
          finished: row.connected,
        });
        if (result && result.ok === false) {
          logger.warn("[landfill] failed to persist a race result", {
            session_id: instance.sessionId,
            username: row.username,
            reason: result.reason,
          });
        }
      }
      instance.resultsPersisted = true;
      logger.log("[landfill] race results persisted", {
        session_id: instance.sessionId,
        world: instance.worldName,
        players: rankings.length,
      });
      if (typeof broadcastToWorld === "function") {
        broadcastToWorld(instance.worldName, {
          type: "landfill_race_results",
          session_id: instance.sessionId,
          world: instance.worldName,
          season_key: instance.seasonKey,
          results: rankings.map((row) => ({
            username: row.username,
            display_name: row.displayName,
            kilograms: row.kilograms,
            placement: row.placement,
            awarded_kilograms: row.kilograms + getPlacementBonus(row.placement),
            finished: row.connected,
          })),
        });
      }
    } catch (error) {
      logger.warn("[landfill] persisting race results failed:", getErrorMessage ? getErrorMessage(error) : error);
      // Deliberately mark persisted so the session can retire instead of wedging in FINISHING
      // forever and holding its world open. The transactional, idempotent write means a partial
      // run left no half-credited player behind.
      instance.resultsPersisted = true;
    } finally {
      instance.resultsPersistInFlight = false;
    }
  }

  // Point lookup for a single world's live race state, so a freshly-arrived client can render the
  // HUD immediately instead of waiting for the next coalesced broadcast.
  function getLandfillRaceStateForWorld(worldName: unknown) {
    if (!isLandfillWorldName(worldName)) return null;
    const instance = getInstance(worldName);
    if (!instance) return null;
    return buildSessionStatePayload(instance);
  }

  // Single source of truth for the tunables, so the client and the check script read the same
  // numbers this module actually runs on rather than duplicating literals.
  function getSessionConfig() {
    return {
      min_players_to_start: minPlayersToStart,
      max_players_per_instance: maxPlayersPerInstance,
      countdown_ms: countdownMs,
      race_duration_ms: raceDurationMs,
      results_display_ms: resultsDisplayMs,
      placement_bonus_kilograms: Array.isArray(placementBonusKilograms) ? placementBonusKilograms.slice() : [],
      participation_bonus_kilograms: participationBonusKilograms,
    };
  }

  function startInstancePolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      try {
        pollInstancesOnce();
      } catch (error) {
        logger.warn("[landfill] instance poll failed:", getErrorMessage ? getErrorMessage(error) : error);
      }
      // The tick now drives race phase transitions, not just occupancy sweeping, so it runs at
      // sessionTickIntervalMs (default 250ms) rather than the original 5s. A 5s tick could
      // overshoot a 10s countdown by half its length. instancePollIntervalMs is retained as an
      // upper bound only so an operator who deliberately set a slower poll still gets it honored.
    }, Math.max(50, Math.min(Number(sessionTickIntervalMs) || 250, Number(instancePollIntervalMs) || 5000)));
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
  // Called from the validated block-break path (server_phase8_world_action_routes.ts). Progress is
  // credited to the in-memory session ONLY -- this used to open a Postgres transaction on every
  // single break, which put the database on the hot path of the most frequent action in the game.
  // The lifetime total is now written once per player at race completion (persistSessionResults).
  //
  // Still async, and still awaited nowhere, so the call site's `void` is unchanged.
  async function awardKilogramsForBlockBreak(worldName: unknown, username: unknown, blockType: unknown): Promise<void> {
    if (!isLandfillWorldName(worldName)) return;
    const weight = getTrashBlockWeight(String(blockType || ""));
    if (weight <= 0) return;
    const cleanUsername = cleanAccountName(username || "");
    if (cleanUsername === "") return;

    const instance = getInstance(worldName);
    if (!instance) return;
    // THE authoritative progress gate. Breaks before GO (entry pen / countdown) and after the
    // finish score nothing, so a player cannot bank work during the countdown or sneak a break in
    // after the clock expires. Progress is never taken from the client -- it is derived here, from
    // an action the server already validated for permission, reach, cooldown and block identity.
    if (!isScoringState(instance.state)) return;

    const participant = instance.participants.get(cleanUsername);
    if (!participant) return;

    participant.kilograms += weight;
    participant.lastProgressAtMs = Date.now();
    instance.broadcastDirty = true;
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
    // Pass the requester so requestJoinLandfillRace can enforce one-live-session-per-player and
    // return an existing session rather than enrolling the same account twice.
    const result = await requestJoinLandfillRace(player?.account_username || player?.name || "");
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
    // Race-session surface. getLandfillRaceStateForWorld lets server.ts answer a client's
    // "what's the current state?" request (e.g. right after world entry, before the next
    // broadcast tick) without waiting up to broadcastMinIntervalMs for the next push.
    getLandfillRaceStateForWorld,
    getSessionConfig,
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
