# Lock decay

Small, Medium, and Big Locks become breakable after 180 consecutive days of
inactivity. World Locks and Super World Locks use 365 days.
Logging in anywhere by the owner or anyone with access restarts that period.
Public visitors do not restart it. Active sessions on other server instances
also protect the lock.

Expiry does not automatically unlock or reset anything. A nearby player must
punch the lock. A verified expired lock crumbles in one hit, with no item,
gem, seed, or experience reward. Only that lock and its access state are
removed. Terrain, other locks, containers, and their contents remain intact.
Normal unexpired lock ownership, damage, and storage restrictions still apply.

PostgreSQL account activity is authoritative. Unknown identities, missing
timestamps, database outages, and unavailable configured Redis session checks
keep locks protected. Client flags and clocks cannot authorize decay.
Removal uses the existing tile action lock, world commit, rollback-on-failure,
and world-change journal. Journal details identify `lock_decay: true`.

Run `npm run check:lock-decay` after building the server, PostgreSQL, Redis,
and world action route modules. The client test is
`res://tests/lock_decay_punch_test.gd`.
