const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

const backendRoot = env("PIXELMANIA_BACKEND_ROOT", __dirname);
const productionEnv = {
  NODE_ENV: env("NODE_ENV", "production"),
  PIXELMANIA_BACKEND_ROOT: backendRoot,
  PIXELMANIA_RELEASE_ROOT: env("PIXELMANIA_RELEASE_ROOT"),
  PIXELMANIA_RELEASE_ID: env("PIXELMANIA_RELEASE_ID"),
  HOST: env("HOST", "127.0.0.1"),
  PORT: env("PORT", "8080"),
  PUBLIC_BASE_URL: env("PUBLIC_BASE_URL", "https://api.pixelmaniagame.com"),
  PUBLIC_WS_URL: env("PUBLIC_WS_URL", "wss://api.pixelmaniagame.com/ws"),
  SERVER_INSTANCE_ID: env("SERVER_INSTANCE_ID"),
  SERVER_INSTANCE_WS_URL: env("SERVER_INSTANCE_WS_URL", env("PUBLIC_WS_URL", "wss://api.pixelmaniagame.com/ws")),
  SERVER_CLIENT_VERSION: env("SERVER_CLIENT_VERSION", "1.0.1"),
  MIN_CLIENT_VERSION: env("MIN_CLIENT_VERSION", env("SERVER_CLIENT_VERSION", "1.0.1")),
  UPDATE_URL: env("UPDATE_URL", "https://pixelmaniagame.com"),
  MAX_PLAYERS_PER_WORLD: env("MAX_PLAYERS_PER_WORLD", "50"),
  MAX_MOVE_PIXELS_PER_SECOND: env("MAX_MOVE_PIXELS_PER_SECOND", "900"),
  MAX_MOVE_ACCEL_PIXELS_PER_SECOND2: env("MAX_MOVE_ACCEL_PIXELS_PER_SECOND2", "36000"),
  MAX_MOVE_VELOCITY_DELTA_EXTRA: env("MAX_MOVE_VELOCITY_DELTA_EXTRA", "120"),
  MOVEMENT_DISTANCE_GRACE_PIXELS: env("MOVEMENT_DISTANCE_GRACE_PIXELS", "24"),
  MOVEMENT_MAX_ELAPSED_SECONDS: env("MOVEMENT_MAX_ELAPSED_SECONDS", "0.25"),
  MOVEMENT_COLLISION_GUARD_ENABLED: env("MOVEMENT_COLLISION_GUARD_ENABLED", "true"),
  MOVEMENT_COLLISION_CACHE_MAX_WORLDS: env("MOVEMENT_COLLISION_CACHE_MAX_WORLDS", "128"),
  MOVEMENT_CORRECTION_SNAP_DISTANCE: env("MOVEMENT_CORRECTION_SNAP_DISTANCE", "160"),
  MOVEMENT_CORRECTION_SMOOTH_MS: env("MOVEMENT_CORRECTION_SMOOTH_MS", "80"),
  PLAYER_COLLISION_HALF_WIDTH: env("PLAYER_COLLISION_HALF_WIDTH", "8"),
  PLAYER_COLLISION_HALF_HEIGHT: env("PLAYER_COLLISION_HALF_HEIGHT", "12.5"),
  PLAYER_COLLISION_OFFSET_X: env("PLAYER_COLLISION_OFFSET_X", "1"),
  PLAYER_COLLISION_OFFSET_Y: env("PLAYER_COLLISION_OFFSET_Y", "-5"),
  PLAYER_COLLISION_SHRINK_PIXELS: env("PLAYER_COLLISION_SHRINK_PIXELS", "2"),
  PLAYER_POSITION_BROADCAST_INTERVAL_MS: env("PLAYER_POSITION_BROADCAST_INTERVAL_MS", "16"),
  PLAYER_POSITION_BATCHING_ENABLED: env("PLAYER_POSITION_BATCHING_ENABLED", "true"),
  PLAYER_POSITION_BATCH_MIN_CLIENT_VERSION: env("PLAYER_POSITION_BATCH_MIN_CLIENT_VERSION", "1.0.3"),
  PLAYER_POSITION_BATCH_MAX_ITEMS: env("PLAYER_POSITION_BATCH_MAX_ITEMS", "64"),
  PLAYER_POSITION_MAX_BUFFERED_AMOUNT: env("PLAYER_POSITION_MAX_BUFFERED_AMOUNT", "262144"),
  PLAYER_POSITION_RESUME_BUFFERED_AMOUNT: env("PLAYER_POSITION_RESUME_BUFFERED_AMOUNT", "65536"),
  PLAYER_POSITION_DELIVERY_RETRY_MS: env("PLAYER_POSITION_DELIVERY_RETRY_MS", "25"),
  PLAYER_INTEREST_MANAGEMENT_ENABLED: env("PLAYER_INTEREST_MANAGEMENT_ENABLED", "true"),
  PLAYER_INTEREST_RADIUS_PIXELS: env("PLAYER_INTEREST_RADIUS_PIXELS", "2560"),
  PLAYER_INTEREST_LEAVE_RADIUS_PIXELS: env("PLAYER_INTEREST_LEAVE_RADIUS_PIXELS", "3072"),
  PLAYER_ACTION_INTEREST_MANAGEMENT_ENABLED: env("PLAYER_ACTION_INTEREST_MANAGEMENT_ENABLED", "true"),
  WORLD_UPDATE_BATCHING_ENABLED: env("WORLD_UPDATE_BATCHING_ENABLED", "true"),
  WORLD_UPDATE_BATCH_MIN_CLIENT_VERSION: env("WORLD_UPDATE_BATCH_MIN_CLIENT_VERSION", "1.0.3"),
  WORLD_UPDATE_BATCH_MAX_ITEMS: env("WORLD_UPDATE_BATCH_MAX_ITEMS", "64"),
  WORLD_UPDATE_BATCH_INTERVAL_MS: env("WORLD_UPDATE_BATCH_INTERVAL_MS", "16"),
  DROP_INTEREST_MANAGEMENT_ENABLED: env("DROP_INTEREST_MANAGEMENT_ENABLED", "true"),
  DROP_INTEREST_RADIUS_PIXELS: env("DROP_INTEREST_RADIUS_PIXELS", "2560"),
  DROP_INTEREST_LEAVE_RADIUS_PIXELS: env("DROP_INTEREST_LEAVE_RADIUS_PIXELS", "3072"),
  DROP_INTEREST_SYNC_INTERVAL_MS: env("DROP_INTEREST_SYNC_INTERVAL_MS", "250"),
  PIXELMANIA_DATA_DIR: env("PIXELMANIA_DATA_DIR", "/var/lib/pixelmania"),
  ALLOW_LEGACY_PLAYER_STATE_IMPORT: env("ALLOW_LEGACY_PLAYER_STATE_IMPORT", "false"),
  ALLOW_LEGACY_WORLD_STATE_IMPORT: env("ALLOW_LEGACY_WORLD_STATE_IMPORT", "false"),
  POSTGRES_ENABLED: env("POSTGRES_ENABLED", "true"),
  POSTGRES_AUTHORITATIVE: env("POSTGRES_AUTHORITATIVE", "true"),
  ALLOW_AUTHORITATIVE_JSON_FALLBACK: env("ALLOW_AUTHORITATIVE_JSON_FALLBACK", "false"),
  REQUIRE_POSTGRES_AUTHORITATIVE_FOR_GAMEPLAY: env("REQUIRE_POSTGRES_AUTHORITATIVE_FOR_GAMEPLAY", "true"),
  POSTGRES_AUTO_BOOTSTRAP: env("POSTGRES_AUTO_BOOTSTRAP", "true"),
  POSTGRES_HOST: env("POSTGRES_HOST", "127.0.0.1"),
  POSTGRES_PORT: env("POSTGRES_PORT", "5432"),
  POSTGRES_DATABASE: env("POSTGRES_DATABASE", "pixelmania"),
  POSTGRES_USER: env("POSTGRES_USER", "pixelmania"),
  POSTGRES_PASSWORD: env("POSTGRES_PASSWORD"),
  POSTGRES_SSL: env("POSTGRES_SSL", "false"),
  POSTGRES_SCHEMA: env("POSTGRES_SCHEMA", "pixelmania"),
  POSTGRES_POOL_MAX: env("POSTGRES_POOL_MAX", "10"),
  POSTGRES_WRITE_QUEUE_MAX: env("POSTGRES_WRITE_QUEUE_MAX", "1000"),
  // Diagnostic only (added 2026-08-10 to trace the intermittent fishing-cast delay): logs any
  // write whose queue-wait + exec time crosses this many ms, tagged by transaction label. 0 disables.
  POSTGRES_SLOW_WRITE_LOG_MS: env("POSTGRES_SLOW_WRITE_LOG_MS", "250"),
  POSTGRES_BOOTSTRAP_SQL_PATH: env("POSTGRES_BOOTSTRAP_SQL_PATH", "docs/postgres_security_foundation.sql"),
  REDIS_ENABLED: env("REDIS_ENABLED", "false"),
  REDIS_URL: env("REDIS_URL", "redis://127.0.0.1:6379"),
  REDIS_KEY_PREFIX: env("REDIS_KEY_PREFIX", "pixelmania"),
  REDIS_CONNECT_TIMEOUT_MS: env("REDIS_CONNECT_TIMEOUT_MS", "1500"),
  REDIS_ACTION_LOCK_TTL_MS: env("REDIS_ACTION_LOCK_TTL_MS", "5000"),
  REDIS_PRESENCE_TTL_MS: env("REDIS_PRESENCE_TTL_MS", "45000"),
  REDIS_ACTIVE_SESSION_TTL_MS: env("REDIS_ACTIVE_SESSION_TTL_MS", "120000"),
  WORLD_ADMISSION_TTL_MS: env("WORLD_ADMISSION_TTL_MS", "45000"),
  WORLD_ROUTE_TTL_MS: env("WORLD_ROUTE_TTL_MS", "45000"),
  WORLD_ROUTE_ENFORCEMENT_ENABLED: env("WORLD_ROUTE_ENFORCEMENT_ENABLED", "false"),
  REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT: env("REDIS_REQUIRED_FOR_ROUTE_ENFORCEMENT", "false"),
  NETFOX_MOVEMENT_ENABLED: env("NETFOX_MOVEMENT_ENABLED", "true"),
  NETFOX_MOVEMENT_PUBLIC_HOST: env("NETFOX_MOVEMENT_PUBLIC_HOST", "127.0.0.1"),
  NETFOX_MOVEMENT_PUBLIC_PORT: env("NETFOX_MOVEMENT_PUBLIC_PORT", "24566"),
  NETFOX_MOVEMENT_MAX_CLIENTS: env("NETFOX_MOVEMENT_MAX_CLIENTS", "50"),
  NETFOX_MOVEMENT_ROUTE_TTL_MS: env("NETFOX_MOVEMENT_ROUTE_TTL_MS", "45000"),
  NETFOX_MOVEMENT_ALLOW_STATIC_FALLBACK: env("NETFOX_MOVEMENT_ALLOW_STATIC_FALLBACK", "true"),
  NETFOX_MOVEMENT_STATIC_WORLD: env("NETFOX_MOVEMENT_STATIC_WORLD", "START"),
  NETFOX_TRUSTED_PLAYER_STATE_ENABLED: env("NETFOX_TRUSTED_PLAYER_STATE_ENABLED", "true"),
  CUSTOM_TRUSTED_PLAYER_STATE_ENABLED: env("CUSTOM_TRUSTED_PLAYER_STATE_ENABLED", "false"),
  TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD: env("TRUSTED_MOVEMENT_REQUIRE_JOINED_WORLD", "true"),
  TRUSTED_MOVEMENT_ALLOWLIST_ENABLED: env("TRUSTED_MOVEMENT_ALLOWLIST_ENABLED", "false"),
  TRUSTED_MOVEMENT_ALLOWLIST: env("TRUSTED_MOVEMENT_ALLOWLIST", ""),
  NETFOX_SPAWN_TICKET_SECRET: env("NETFOX_SPAWN_TICKET_SECRET"),
  NETFOX_SPAWN_TICKET_TTL_MS: env("NETFOX_SPAWN_TICKET_TTL_MS", "30000"),
  NETFOX_SERVER_WORLD_STATE_TOKEN: env("NETFOX_SERVER_WORLD_STATE_TOKEN"),
  NETFOX_SERVER_WORLD_STATE_TOKEN_HASH: env("NETFOX_SERVER_WORLD_STATE_TOKEN_HASH"),
  WORLD_SNAPSHOT_STORAGE: env("WORLD_SNAPSHOT_STORAGE", "local"),
  WORLD_SNAPSHOT_SPACES_TARGET: env("WORLD_SNAPSHOT_SPACES_TARGET"),
  WORLD_SNAPSHOT_SPACES_ENDPOINT: env("WORLD_SNAPSHOT_SPACES_ENDPOINT"),
  WORLD_SNAPSHOT_SPACES_REGION: env("WORLD_SNAPSHOT_SPACES_REGION", "tor1"),
  WORLD_SNAPSHOT_POSTGRES_INLINE: env("WORLD_SNAPSHOT_POSTGRES_INLINE", "false"),
  WORLD_SNAPSHOT_INTERVAL_MINUTES: env("WORLD_SNAPSHOT_INTERVAL_MINUTES", "15"),
  WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE: env("WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE", "5"),
  WORLD_SNAPSHOT_STARTUP_RUN: env("WORLD_SNAPSHOT_STARTUP_RUN", "false"),
  SMTP_HOST: env("SMTP_HOST"),
  SMTP_PORT: env("SMTP_PORT", "587"),
  SMTP_SECURE: env("SMTP_SECURE", "false"),
  SMTP_USER: env("SMTP_USER"),
  SMTP_PASS: env("SMTP_PASS"),
  SMTP_FROM: env("SMTP_FROM", "PixelMania <no-reply@pixelmaniagame.com>"),
  TEST_EMAIL_TO: env("TEST_EMAIL_TO"),
  DESIGNER_USERNAMES: env("DESIGNER_USERNAMES"),
  // The random Snow Storm world event is gated behind this flag in server.ts and defaults to
  // "false" there when the env var is unset. Every other PM2-managed env var in this file is
  // passed through explicitly with its intended value -- this one was missing entirely, so PM2
  // never set it and the server always fell back to disabled. That's why the Snow Storm event
  // has never appeared automatically in any environment launched via this config. Explicitly
  // enabling it here (matching every other var's existing explicit-pass-through style) is the fix.
  SNOW_STORM_RANDOM_EVENTS_ENABLED: env("SNOW_STORM_RANDOM_EVENTS_ENABLED", "true"),
  SNOW_STORM_RANDOM_INTERVAL_MS: env("SNOW_STORM_RANDOM_INTERVAL_MS", "60000"),
  SNOW_STORM_RANDOM_CHANCE: env("SNOW_STORM_RANDOM_CHANCE", "0.05"),
  SNOW_STORM_PILE_OF_SNOW_CHANCE: env("SNOW_STORM_PILE_OF_SNOW_CHANCE", "0.08"),
  SNOW_STORM_EVENT_TILE_BATCH_SIZE: env("SNOW_STORM_EVENT_TILE_BATCH_SIZE", "250"),
  SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS: env("SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS", "0"),
  SNOW_STORM_MAX_CHANGED_TILES: env("SNOW_STORM_MAX_CHANGED_TILES", ""),
  SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS: env("SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS", "1000"),
  // "Landfill" seasonal race event -- see src/server_landfill_event.ts. Every env var this
  // feature reads is explicitly passed through here from day one specifically to avoid
  // repeating the Snow Storm bug above (a flag that existed in code but was never mirrored
  // into this file, so it silently never turned on in any deployed environment).
  //
  // Unlike Snow Storm, LANDFILL_EVENT_ENABLED defaults to "false" here on purpose, not by
  // omission: the trash-block weight registry and the top-10 prize catalog are both
  // intentionally empty until that content is designed (see project memory
  // landfill_seasonal_event_design.md). Flip this to "true" once that content exists --
  // until then, leaving it enabled would let players join a Landfill world where breaking
  // blocks scores nothing and there's nothing to claim.
  LANDFILL_EVENT_ENABLED: env("LANDFILL_EVENT_ENABLED", "false"),
  LANDFILL_EVENT_CRON_START: env("LANDFILL_EVENT_CRON_START", "0 0 1 * *"),
  LANDFILL_EVENT_CRON_END: env("LANDFILL_EVENT_CRON_END", "0 0 8 * *"),
  LANDFILL_MIN_PLAYERS_TO_START: env("LANDFILL_MIN_PLAYERS_TO_START", "2"),
  LANDFILL_MAX_PLAYERS_PER_INSTANCE: env("LANDFILL_MAX_PLAYERS_PER_INSTANCE", "5"),
  // Half-width/half-height, in tiles, of the holding pen players are confined to while an
  // instance is still in its "entry" state (see server_phase11d_standard_movement.ts's
  // acceptPlayerMovement and getLandfillEntryPenBounds in server_landfill_event.ts).
  LANDFILL_ENTRY_PEN_RADIUS_TILES: env("LANDFILL_ENTRY_PEN_RADIUS_TILES", "4"),
  // Total height of the visible starting pen, in tiles (spawn row + floor row + walls above).
  LANDFILL_ENTRY_PEN_HEIGHT_TILES: env("LANDFILL_ENTRY_PEN_HEIGHT_TILES", "6"),
  // Race session timing. Passed through explicitly for the same reason as everything above: a
  // value that exists in code but is missing here is a value PM2 never sets, which is exactly how
  // the Snow Storm event silently never fired in any deployed environment.
  LANDFILL_COUNTDOWN_SECONDS: env("LANDFILL_COUNTDOWN_SECONDS", "10"),
  LANDFILL_RACE_SECONDS: env("LANDFILL_RACE_SECONDS", "120"),
  LANDFILL_RESULTS_DISPLAY_SECONDS: env("LANDFILL_RESULTS_DISPLAY_SECONDS", "12"),
  // Session state machine tick. Must stay well under LANDFILL_COUNTDOWN_SECONDS or the countdown
  // will visibly overshoot.
  LANDFILL_SESSION_TICK_MS: env("LANDFILL_SESSION_TICK_MS", "250"),
  // Floor between two live race-state pushes for one session; progress is coalesced between them.
  LANDFILL_RACE_BROADCAST_MIN_INTERVAL_MS: env("LANDFILL_RACE_BROADCAST_MIN_INTERVAL_MS", "250"),
  // Bonus Kilograms by placement, comma separated, 1st first. In this event "points" ARE
  // Kilograms, so these are added to what the player collected and credited to their season total.
  LANDFILL_PLACEMENT_BONUS_KILOGRAMS: env("LANDFILL_PLACEMENT_BONUS_KILOGRAMS", "100,75,50"),
  LANDFILL_PARTICIPATION_BONUS_KILOGRAMS: env("LANDFILL_PARTICIPATION_BONUS_KILOGRAMS", "20"),
};

module.exports = {
  apps: [
    {
      name: "pixelmania",
      script: "server.js",
      cwd: backendRoot,
      exec_mode: "fork",
      instances: 1,
      watch: false,
      time: true,
      max_memory_restart: "512M",
      env: productionEnv,
      env_production: productionEnv,
    },
  ],
};
