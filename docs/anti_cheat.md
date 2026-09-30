# PixelMania server anti-cheat

Implemented locally on 2026-09-30. Production has not been changed by this update.

## Approach

Gameplay authority belongs to the backend. Godot supplies networking, but the
game must validate client requests. Third-party client protection can supplement
this later; it cannot replace permission, movement, inventory, and transaction
validation. This update strengthens the existing WebSocket movement validator
without requiring a new client protocol, SDK, account service, or driver.

References: [Godot multiplayer security guidance](https://docs.godotengine.org/en/4.7/tutorials/networking/high_level_multiplayer.html)
and [Epic Anti-Cheat integration guidance](https://dev.epicgames.com/docs/epic-online-services/trust-and-safety/anti-cheat-interfaces/anti-cheat-interfaces).

## Protections added

- Movement and action-position updates share one per-player distance budget.
  Only server time replenishes it. Faster packet delivery, forged client clocks,
  omitted timestamps, stationary packets, and alternating action/movement
  packets cannot manufacture travel allowance.
- The existing per-packet validator remains in place. Its 16ms timing floor
  and positional grace are now also constrained by the cumulative budget.
  Accepted distance is charged even when the requested movement is clamped.
- Idle time has a bounded allowance. Respawns and world-entry acknowledgements
  cap retained, already-funded credit at the small burst tolerance so the next
  honest snapshot can arrive in the same TCP burst. Repeated respawns cannot
  refill spent tolerance. Server-issued movement resets clear both timing
  and distance state. An expired spawn guard no longer makes the first movement
  packet exempt from validation.
- Normal and speed-clamped movement inspect the path through the existing
  authoritative collision map, including embedded action positions. Sampling
  intervals are at most 8px. Diagonal moves may use either clear axis order to
  accommodate corner sliding between snapshots. These new path checks are
  **observation-only by default**: a legitimate jump hidden by lag or a block
  placed behind a moving player can make the guessed path cross solid geometry.
  They emit throttled `movement_path_unverified` diagnostics without correcting
  the player or adding security violations. Destination collisions still enforce.
  `MOVEMENT_PATH_GUARD_MODE=enforce` explicitly opts into the experimental path
  rejection behavior; it requires further staging validation.
- Lava rebound grace requires the existing server-side proximity check and is
  granted at most once per second, rather than once per packet. Admin noclip
  still requires the existing server-authorized role and noclip state.
- Rejected/clamped speed, acceleration, world, and collision checks contribute
  security evidence even for silent action-position validation. Stale or
  duplicate movement packets remain network diagnostics without adding a
  security violation. These counters do not automatically ban or kick anyone.

The existing inventory ownership, reach, permissions, cooldowns, rate limits,
PostgreSQL transaction locks, item-instance tracking, and economy ledgers remain
the authority for valuable actions.

## State and operations

The distance budget is transient state on the live player, scoped to its world
and world-entry session. It is discarded on disconnect or a server movement
reset. It does not need a database table or Redis round trip on each packet.

Security attribution uses the existing bounded violation ledger and
`recordSecurityViolation` milestone logging. Milestones call `logSecurityEvent`,
which mirrors durable evidence into PostgreSQL `security_events`. The public
health endpoint retains opaque subject IDs; account identities stay in the
protected security records. A movement correction is evidence for investigation,
not proof of cheating: lag and world edits can also produce corrections.

The existing settings continue to apply:

| Setting | Default | Meaning |
| --- | --- | --- |
| `MAX_MOVE_PIXELS_PER_SECOND` | 900 | Broad maximum travel envelope |
| `MOVEMENT_MAX_ELAPSED_SECONDS` | 0.25 | Maximum saved movement interval |
| `MOVEMENT_DISTANCE_GRACE_PIXELS` | 24 | Bounded initial/burst tolerance |
| `MOVEMENT_COLLISION_GUARD_ENABLED` | true | Authoritative solid collision checks |
| `MOVEMENT_PATH_GUARD_MODE` | observe | Observe guessed paths; `enforce` is explicit opt-in |

The network configuration snapshot in `/health` exposes `movement_path_guard_mode`
so operators can verify the active behavior.

Without a server-approved teleport or lava rebound allowance, a continuously
active player can spend at most the initial burst plus 900 pixels per elapsed
server second with the default configuration. Repeated packets share that limit.
The standard idle capacity is 249 pixels, not unlimited stored travel time.

## Validation

`npm run check:anti-cheat` builds the movement module and runs its behavior checks
plus 38 regression scenarios. The scenarios include same-tick and sustained
packet floods, timestamp forgery, alternating action/movement messages, zigzag
travel, idle banking, clock rollback, first-packet teleporting, solid-wall
crossing, corner sliding, escape from a newly placed block, lava spam, respawns,
admin noclip, stale packets, wing impulses, and network stall recovery. Two
additional false-positive regressions cover a jump arc hidden by coalesced
snapshots and movement arriving in the same burst as a spawn acknowledgement.
Strict wall-crossing tests explicitly enable experimental path enforcement.

These tests also run through the existing `check:typescript` and
`check:security` chains. A real two-client headless Godot smoke test passed with
simulated 250ms round-trip delay/jitter, block edits, inventory conservation,
remote player observation, and forced reconnect. It recorded zero position
corrections during ordinary play. This is local validation, not a production
load or PostgreSQL/Redis integration test.

All local checks in the `check:security` chain passed, including its TypeScript,
lint, persistence, economy, bot protection, and movement checks. The original
validator fails the strengthened speed regression: 2,304 pixels travelled versus
an 888-pixel server-clock ceiling.

The first approved production-dependency audit reported six affected packages
(five moderate, one high). During validation, a concurrent workspace edit
updated Nodemailer to 10.0.13. A subsequent audit of the current dependency tree
passed the repository's high-severity threshold: zero high/critical findings,
five moderate findings in qs and the googleapis/uuid dependency chain. That
dependency edit was preserved; it is separate from this movement patch. The
network-dependent audit was run separately from the local security chain.

## Limits and rollout

This is a server-side movement hardening layer, not a claim of cheat-proof play.
The 900px/s envelope intentionally remains broader than normal walking speed to
accommodate existing movement mechanics. Flight, altered gravity, and scripted
play that stay inside the envelope are not completely detected. Full movement
authority would require server simulation of inputs, jump state, terrain effects,
and knockback, with client prediction and reconciliation.

Legacy allowlisted `NETFOX_REAL` / `CUSTOM_AUTHORITATIVE` paths use their own
validator and are not converted to the new WebSocket budget. Keep the trusted
movement allowlist disabled unless those paths are deliberately operated and
audited. The default already disables it. Collision sampling also depends on
the server collision geometry matching the client; it is not exact physics replay.

Before production rollout, review the remaining dependency findings and test on staging with
real clients: walking/jumping along corners, wings, ice, lava rebound, knockback,
doors/checkpoints, Landfill entry confinement, late world entry, reconnects, and
high latency. Review correction rates and PostgreSQL security-event milestones.
Deploy the generated movement modules together with their TypeScript sources
using the existing release process. No client export or database migration is
required for this patch.
