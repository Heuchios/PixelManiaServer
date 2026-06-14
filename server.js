require("dotenv").config({ quiet: true });

const WebSocket = require("ws");
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const nodemailer = require("nodemailer");
const path = require("path");
const ItemDatabase = require("./server_item_database");
const PostgresStore = require("./postgres_store");
const RedisStore = require("./redis_store");

const HOST = String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";
const PORT = Math.max(1, Math.trunc(Number(process.env.PORT) || 8080));
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const PUBLIC_WS_URL = String(process.env.PUBLIC_WS_URL || PUBLIC_BASE_URL.replace(/^http/i, "ws") + "/ws").trim();
const SERVER_CLIENT_VERSION = String(process.env.SERVER_CLIENT_VERSION || "1.0.1").trim() || "1.0.1";
const MIN_CLIENT_VERSION = String(process.env.MIN_CLIENT_VERSION || SERVER_CLIENT_VERSION).trim() || SERVER_CLIENT_VERSION;
const UPDATE_URL = String(process.env.UPDATE_URL || "https://pixelmaniagame.com").trim() || "https://pixelmaniagame.com";
const DATA_FOLDER = process.env.PIXELMANIA_DATA_DIR ? path.resolve(process.env.PIXELMANIA_DATA_DIR) : __dirname;
const WORLD_SAVE_FOLDER = process.env.WORLD_SAVE_FOLDER ? path.resolve(process.env.WORLD_SAVE_FOLDER) : path.join(DATA_FOLDER, "worlds");
const PLAYER_SAVE_FOLDER = process.env.PLAYER_SAVE_FOLDER ? path.resolve(process.env.PLAYER_SAVE_FOLDER) : path.join(DATA_FOLDER, "players");
const ACCOUNTS_SAVE_PATH = process.env.ACCOUNTS_SAVE_PATH ? path.resolve(process.env.ACCOUNTS_SAVE_PATH) : path.join(DATA_FOLDER, "accounts.json");
const ADMIN_LOG_PATH = process.env.ADMIN_LOG_PATH ? path.resolve(process.env.ADMIN_LOG_PATH) : path.join(DATA_FOLDER, "admin_actions.log");
const CRASH_REPORT_PATH = process.env.CRASH_REPORT_PATH ? path.resolve(process.env.CRASH_REPORT_PATH) : path.join(DATA_FOLDER, "crash_reports.log");
const INTEGRITY_LOG_FOLDER = process.env.INTEGRITY_LOG_FOLDER ? path.resolve(process.env.INTEGRITY_LOG_FOLDER) : path.join(DATA_FOLDER, "integrity_logs");
const WORLD_SNAPSHOT_FOLDER = process.env.WORLD_SNAPSHOT_FOLDER ? path.resolve(process.env.WORLD_SNAPSHOT_FOLDER) : path.join(DATA_FOLDER, "world_snapshots");
const WORLD_SNAPSHOT_STORAGE = String(process.env.WORLD_SNAPSHOT_STORAGE || "local").trim().toLowerCase() || "local";
const WORLD_SNAPSHOT_SPACES_TARGET = String(process.env.WORLD_SNAPSHOT_SPACES_TARGET || "").trim();
const WORLD_SNAPSHOT_SPACES_ENDPOINT = String(process.env.WORLD_SNAPSHOT_SPACES_ENDPOINT || "").trim();
const WORLD_SNAPSHOT_SPACES_REGION = String(process.env.WORLD_SNAPSHOT_SPACES_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1").trim() || "us-east-1";
const WORLD_SNAPSHOT_POSTGRES_INLINE = !["0", "false", "no"].includes(String(process.env.WORLD_SNAPSHOT_POSTGRES_INLINE || "false").trim().toLowerCase());
const SECURITY_EVENT_LOG_PATH = process.env.SECURITY_EVENT_LOG_PATH ? path.resolve(process.env.SECURITY_EVENT_LOG_PATH) : path.join(INTEGRITY_LOG_FOLDER, "security_events.log");
const ITEM_LEDGER_PATH = process.env.ITEM_LEDGER_PATH ? path.resolve(process.env.ITEM_LEDGER_PATH) : path.join(INTEGRITY_LOG_FOLDER, "item_ledger.log");
const GEM_LEDGER_PATH = process.env.GEM_LEDGER_PATH ? path.resolve(process.env.GEM_LEDGER_PATH) : path.join(INTEGRITY_LOG_FOLDER, "gem_ledger.log");
const SHOP_PURCHASE_LOG_PATH = process.env.SHOP_PURCHASE_LOG_PATH ? path.resolve(process.env.SHOP_PURCHASE_LOG_PATH) : path.join(INTEGRITY_LOG_FOLDER, "shop_purchases.log");
const TRADE_TRANSACTION_LOG_PATH = process.env.TRADE_TRANSACTION_LOG_PATH ? path.resolve(process.env.TRADE_TRANSACTION_LOG_PATH) : path.join(INTEGRITY_LOG_FOLDER, "trade_transactions.log");
const VENDING_TRANSACTION_LOG_PATH = process.env.VENDING_TRANSACTION_LOG_PATH ? path.resolve(process.env.VENDING_TRANSACTION_LOG_PATH) : path.join(INTEGRITY_LOG_FOLDER, "vending_transactions.log");
const WORLD_CHANGE_JOURNAL_PATH = process.env.WORLD_CHANGE_JOURNAL_PATH ? path.resolve(process.env.WORLD_CHANGE_JOURNAL_PATH) : path.join(INTEGRITY_LOG_FOLDER, "world_change_journal.log");
const LEGACY_DATA_FOLDERS = [
  path.join(__dirname, "node_modules"),
];
const SAVE_DEBOUNCE_MS = 250;
const WORLD_JSON_BACKUP_DEBOUNCE_MS = Math.max(0, Math.trunc(Number(process.env.WORLD_JSON_BACKUP_DEBOUNCE_MS) || 1000));
const PERIODIC_SAVE_MS = 30000;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 16;
const MIN_PASSWORD_LENGTH = 8;
const MAX_WORLD_NAME_LENGTH = 32;
const WORLD_WIDTH = Math.max(1, Math.trunc(Number(process.env.WORLD_WIDTH) || 100));
const WORLD_HEIGHT = Math.max(1, Math.trunc(Number(process.env.WORLD_HEIGHT) || 70));
const BEDROCK_START_Y = Math.max(0, WORLD_HEIGHT - 4);
const TILE_SIZE = Math.max(1, Math.trunc(Number(process.env.TILE_SIZE) || 32));
const POSITION_MARGIN_PIXELS = TILE_SIZE * 4;
const MAX_PACKET_BYTES = 64 * 1024;
const MAX_DAMAGE_FLASH_MS = 2000;
const PLAYER_POSITION_BROADCAST_INTERVAL_MS = Math.max(0, Math.trunc(Number(process.env.PLAYER_POSITION_BROADCAST_INTERVAL_MS) || 16));
const MAX_BLOCK_HIT_METRIC = 1024;
const MAX_CHAT_LENGTH = 220;
const MAX_SIGN_TEXT_LENGTH = 500;
const MAX_DOOR_ID_LENGTH = 32;
const MAX_DOOR_DESTINATION_LENGTH = 80;
const MAX_DROP_AMOUNT = 9999;
const MAX_DROP_TILE_AMOUNT = 2000;
const MAX_ITEM_STACK = ItemDatabase.DEFAULT_STACK_LIMIT;
const MAX_SHOP_PRICE = 999999;
const MAX_PLAYER_INVENTORY_KEYS = 500;
const ADMIN_INVENTORY_LOOKUP_PURPOSE = "admin_inventory_lookup";
const ADMIN_ITEM_INSTANCE_LOOKUP_PURPOSE = "admin_item_instance_lookup";
const ADMIN_ITEM_INSTANCE_HISTORY_LOOKUP_PURPOSE = "admin_item_instance_history_lookup";
const ADMIN_TRANSACTION_LEDGER_LOOKUP_PURPOSE = "admin_transaction_ledger_lookup";
const ADMIN_MONITORING_DASHBOARD_PURPOSE = "admin_monitoring_dashboard";
const ADMIN_ITEM_INSTANCE_LOOKUP_LIMIT = 250;
const ADMIN_TRANSACTION_LEDGER_LOOKUP_LIMIT = 150;
const ADMIN_MONITORING_DASHBOARD_LOOKUP_LIMIT = 40;
const ADMIN_MONITORING_DASHBOARD_WINDOW_HOURS = Math.max(1, Math.trunc(Number(process.env.ADMIN_MONITORING_DASHBOARD_WINDOW_HOURS) || 24));
const ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS = Math.max(1000, Math.trunc(Number(process.env.ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS) || 7000));
const SERVER_TICK_MONITOR_INTERVAL_MS = Math.max(100, Math.trunc(Number(process.env.SERVER_TICK_MONITOR_INTERVAL_MS) || 1000));
const antiDupeAuditIntervalEnv = process.env.ANTI_DUPE_AUDIT_INTERVAL_MS;
const antiDupeAuditIntervalParsed = antiDupeAuditIntervalEnv == null || String(antiDupeAuditIntervalEnv).trim() === ""
  ? NaN
  : Number(antiDupeAuditIntervalEnv);
const ANTI_DUPE_AUDIT_INTERVAL_MS = Math.max(
  0,
  Math.trunc(Number.isFinite(antiDupeAuditIntervalParsed) ? antiDupeAuditIntervalParsed : (15 * 60 * 1000))
);
const ANTI_DUPE_AUDIT_LIMIT = Math.min(200, Math.max(1, Math.trunc(Number(process.env.ANTI_DUPE_AUDIT_LIMIT) || 100)));
const ANTI_DUPE_AUDIT_LOG_CLEAN = ["1", "true", "yes"].includes(String(process.env.ANTI_DUPE_AUDIT_LOG_CLEAN || "false").trim().toLowerCase());
const WORLD_SNAPSHOT_INTERVAL_ENV = process.env.WORLD_SNAPSHOT_INTERVAL_MINUTES;
const WORLD_SNAPSHOT_INTERVAL_PARSED = WORLD_SNAPSHOT_INTERVAL_ENV == null || String(WORLD_SNAPSHOT_INTERVAL_ENV).trim() === ""
  ? NaN
  : Number(WORLD_SNAPSHOT_INTERVAL_ENV);
const WORLD_SNAPSHOT_INTERVAL_MINUTES = Math.max(0, Math.trunc(Number.isFinite(WORLD_SNAPSHOT_INTERVAL_PARSED) ? WORLD_SNAPSHOT_INTERVAL_PARSED : 15));
const WORLD_SNAPSHOT_INTERVAL_MS = WORLD_SNAPSHOT_INTERVAL_MINUTES * 60 * 1000;
const WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE = Math.max(0, Math.trunc(Number(process.env.WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE) || 5));
const WORLD_SNAPSHOT_STARTUP_RUN = ["1", "true", "yes"].includes(String(process.env.WORLD_SNAPSHOT_STARTUP_RUN || "false").trim().toLowerCase());
const ADMIN_PUNISHMENT_LOOKUP_PURPOSE = "admin_punishment_lookup";
const PUNISHMENT_CACHE_TTL_MS = Math.max(1000, Math.trunc(Number(process.env.PUNISHMENT_CACHE_TTL_MS) || 5000));
const PUNISHMENT_MAX_DURATION_MINUTES = Math.max(1, Math.trunc(Number(process.env.PUNISHMENT_MAX_DURATION_MINUTES) || (3650 * 24 * 60)));
const PUNISHMENT_TYPES = new Set(["ban", "mute", "trade_ban", "world_ban", "lockout"]);
const PUNISHMENT_SCOPE_GLOBAL = "global";
const PUNISHMENT_SCOPE_WORLD = "world";
const ADMIN_INVENTORY_LOOKUP_FIELDS = Object.freeze([
  { field: "inventory", category: "block" },
  { field: "seed_inventory", category: "seed" },
  { field: "tool_inventory", category: "tool" },
  { field: "back_inventory", category: "back" },
  { field: "hair_inventory", category: "hair" },
  { field: "shirt_inventory", category: "shirt" },
  { field: "pants_inventory", category: "pants" },
  { field: "shoes_inventory", category: "shoes" },
  { field: "currency_inventory", category: "currency" },
  { field: "material_inventory", category: "material" },
  { field: "lure_inventory", category: "lure" },
  { field: "fish_inventory", category: "fish" },
]);
const MAX_ITEM_ID_LENGTH = 64;
const MAX_DROP_ID_LENGTH = 96;
const PLAYER_LEVEL_MIN = 1;
const PLAYER_LEVEL_MAX = 100;
const PLAYER_XP_FIRST_LEVEL = 300;
const ALLOW_LEGACY_PLAYER_STATE_IMPORT = ["1", "true", "yes"].includes(String(process.env.ALLOW_LEGACY_PLAYER_STATE_IMPORT || "false").trim().toLowerCase());
const MAX_MOVE_PIXELS_PER_SECOND = Math.max(100, Math.trunc(Number(process.env.MAX_MOVE_PIXELS_PER_SECOND) || 900));
const LAVA_REBOUND_MOVE_EXTRA_PIXELS = TILE_SIZE * 4;
const LAVA_REBOUND_MOVE_RADIUS_TILES = 1;
const MAX_PICKUP_DISTANCE_PIXELS = TILE_SIZE * 6;
const MAX_GRID_ACTION_DISTANCE_PIXELS = TILE_SIZE * 6;
const MAX_DROP_CREATE_DISTANCE_PIXELS = TILE_SIZE * 6;
const MAX_FISHING_CAST_DISTANCE_PIXELS = TILE_SIZE * 4;
const SERVER_DROP_PICKUP_DELAY = 0.25;
const TRADE_SLOT_COUNT = 6;
const HOTBAR_SLOT_COUNT = 6;
const MAX_TRADE_DISTANCE_PIXELS = TILE_SIZE * 10;
const PLAYER_PUNCH_RANGE_PIXELS = TILE_SIZE * 2.25;
const PLAYER_PUNCH_VERTICAL_TOLERANCE_PIXELS = TILE_SIZE * 2.15;
const PLAYER_PUNCH_DIRECT_DISTANCE_PIXELS = TILE_SIZE * 3.0;
const PLAYER_PUNCH_BACKSIDE_TOLERANCE_PIXELS = TILE_SIZE * 0.45;
const PLAYER_PUNCH_KNOCKBACK_X = 340;
const PLAYER_PUNCH_KNOCKBACK_Y = 0;
const PLAYER_PUNCH_COOLDOWN_MS = 180;
const VEND_BLOCK_EMPTY = "vend_empty";
const VEND_BLOCK_PENDING = "vend_pending";
const VEND_BLOCK_SOLD = "vend_sold";
const VEND_BLOCK_TYPES = new Set([VEND_BLOCK_EMPTY, VEND_BLOCK_PENDING, VEND_BLOCK_SOLD]);
const VEND_LOG_LIMIT = 30;
const SAFE_BLOCK_TYPE = "safe";
const FISH_MONGER_BLOCK_TYPE = "fish_monger";
const ENTRANCE_GATE_TYPE = "entrance_gate";
const WORLD_LOCK_GRID_SENTINEL = 999999;
const DEFAULT_TRUSTED_BUILDER_SLOT_LIMIT = 6;
const MIN_TRUSTED_BUILDER_SLOT_LIMIT = 0;
const MAX_TRUSTED_BUILDER_SLOT_LIMIT = 50;
const WORLD_LOCK_ACCESS_ROLES = new Set(["admin", "builder", "visitor"]);
const SAFE_SLOT_COUNT = 10;
const SERVER_SEED_GROW_TIME_SECONDS = Math.max(1, Number(process.env.SEED_GROW_TIME_SECONDS) || 8);
const MATURE_SEED_EXTRA_DROP_CHANCE = Math.max(0, Math.min(1, Number(process.env.MATURE_SEED_EXTRA_DROP_CHANCE) || 0.65));
const CONFIGURED_SEED_MUTATION_CHANCE = Number(process.env.SEED_MUTATION_CHANCE);
const SEED_MUTATION_CHANCE = Math.max(0, Math.min(1, Number.isFinite(CONFIGURED_SEED_MUTATION_CHANCE) ? CONFIGURED_SEED_MUTATION_CHANCE : 0.005));
const SNOW_STORM_EVENT_TYPE = "snow_storm";
const SNOW_STORM_SYSTEM_MESSAGE = "Snow Storm is coming, find shelter! 10 minutes left.";
const SNOW_STORM_EVENT_DURATION_MS = 10 * 60 * 1000;
const SNOW_STORM_COUNTDOWN_MESSAGES = Object.freeze([
  Object.freeze({ remainingMs: 7 * 60 * 1000, label: "7 minutes" }),
  Object.freeze({ remainingMs: 3 * 60 * 1000, label: "3 minutes" }),
  Object.freeze({ remainingMs: 1 * 60 * 1000, label: "1 minute" }),
]);
const SNOW_STORM_RANDOM_EVENTS_ENABLED = ["1", "true", "yes"].includes(String(process.env.SNOW_STORM_RANDOM_EVENTS_ENABLED || "false").trim().toLowerCase());
const SNOW_STORM_RANDOM_INTERVAL_MS = Math.max(10000, Math.trunc(Number(process.env.SNOW_STORM_RANDOM_INTERVAL_MS) || 60000));
const SNOW_STORM_RANDOM_CHANCE = Math.max(0, Math.min(1, Number(process.env.SNOW_STORM_RANDOM_CHANCE) || 0.05));
const SNOW_STORM_PILE_OF_SNOW_CHANCE = Math.max(0, Math.min(1, Number(process.env.SNOW_STORM_PILE_OF_SNOW_CHANCE) || 0.08));
const SNOW_STORM_ICE_VARIANT_SALT = 9047;
const SNOW_STORM_EVENT_TILE_BATCH_SIZE = Math.max(25, Math.min(250, Math.trunc(Number(process.env.SNOW_STORM_EVENT_TILE_BATCH_SIZE) || 150)));
const CONFIGURED_SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS = Number(process.env.SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS);
const SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS = Math.max(0, Math.min(250, Math.trunc(Number.isFinite(CONFIGURED_SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS) ? CONFIGURED_SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS : 20)));
const SNOW_STORM_MAX_CHANGED_TILES = Math.max(100, Math.min(WORLD_WIDTH * WORLD_HEIGHT, Math.trunc(Number(process.env.SNOW_STORM_MAX_CHANGED_TILES) || (WORLD_WIDTH * WORLD_HEIGHT))));
const CONFIGURED_SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS = Number(process.env.SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS);
const SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS = Math.max(0, Math.min(10000, Math.trunc(Number.isFinite(CONFIGURED_SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS) ? CONFIGURED_SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS : 1000)));
const SERVER_WEBSOCKET_MAX_BUFFERED_AMOUNT = Math.max(256 * 1024, Math.min(32 * 1024 * 1024, Math.trunc(Number(process.env.SERVER_WEBSOCKET_MAX_BUFFERED_AMOUNT) || (4 * 1024 * 1024))));
const SERVER_TERRAIN_SURFACE_VERTICAL_OFFSET = -8;
const SERVER_TERRAIN_EXTRA_HILL_RANGE = 3;
const SERVER_BOTTOM_LAVA_STONE_HEIGHT = 4;
const SERVER_CAVE_BOTTOM_SOLID_PADDING = 7;
const SERVER_CAVE_MIN_DEPTH = 8;
const SERVER_SHALLOW_CAVE_START_DEPTH = 10;
const SERVER_DEEP_CAVE_START_DEPTH = 18;
const SERVER_TREE_MIN_HEIGHT = 5;
const SERVER_TREE_MAX_HEIGHT = 8;
const SERVER_TREE_SURFACE_NOISE_THRESHOLD = 0.30;
const SERVER_TREE_RANDOM_PLACEMENT_CHANCE = 0.45;
const SERVER_POND_WIDTH_MIN = 5;
const SERVER_POND_WIDTH_MAX = 11;
const SERVER_POND_COUNT_MIN = 2;
const SERVER_POND_COUNT_MAX = 3;
const SERVER_POND_ATTEMPT_LIMIT = 90;
const SERVER_POND_EDGE_DEPTH = 2;
const SERVER_POND_CENTER_DEPTH = 3;
const SERVER_SURFACE_DECORATION_CHANCE = 0.62;
const SERVER_SURFACE_DECORATION_GRASS_CHANCE = 0.22;
const SERVER_SURFACE_DECORATION_ROSE_CHANCE = 0.30;
const SERVER_SURFACE_DECORATION_TULIP_CHANCE = 0.30;
const SERVER_SURFACE_DECORATION_SPACING_GAP_MAX = 0.84;
const SERVER_SURFACE_DECORATION_NOISE_SCALE_X = 0.17;
const SERVER_SURFACE_DECORATION_NOISE_SCALE_Y = 2.9;
const SEED_MUTATION_REWARD_TABLE = Object.freeze([
  { item_id: "glowing_dirt", item_category: "block", min_amount: 1, max_amount: 5, y_offset: -16, weight: 80 },
  { item_id: "sakura_sword", item_category: "tool", min_amount: 1, max_amount: 1, y_offset: -16, weight: 10 },
  { item_id: "pulu_pulu", item_category: "tool", min_amount: 1, max_amount: 1, y_offset: -16, weight: 10 },
]);
const FISHING_SESSION_TTL_MS = Math.max(10000, Math.trunc(Number(process.env.FISHING_SESSION_TTL_MS) || 90000));
const MIN_BLOCK_BREAK_INTERVAL_MS = Math.max(50, Math.trunc(Number(process.env.MIN_BLOCK_BREAK_INTERVAL_MS) || 125));
const BLOCK_DAMAGE_RESET_MS = Math.max(500, Math.trunc(Number(process.env.BLOCK_DAMAGE_RESET_MS) || 3500));
const EMAIL_VERIFICATION_TTL_MS = Math.max(5 * 60 * 1000, Math.trunc(Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES) || 60) * 60 * 1000);
const SESSION_TOKEN_TTL_MS = Math.max(15 * 60 * 1000, Math.trunc(Number(process.env.SESSION_TOKEN_TTL_MINUTES) || 1440) * 60 * 1000);
const SESSION_REFRESH_TOKEN_TTL_MS = Math.max(SESSION_TOKEN_TTL_MS, Math.trunc(Number(process.env.SESSION_REFRESH_TOKEN_TTL_MINUTES) || (30 * 24 * 60)) * 60 * 1000);
const ACCOUNT_ONE_ACTIVE_SESSION = String(process.env.ACCOUNT_ONE_ACTIVE_SESSION || "true").trim().toLowerCase() !== "false";
const LOGIN_ATTEMPT_LIMIT_IP = Math.max(3, Math.trunc(Number(process.env.LOGIN_ATTEMPT_LIMIT_IP) || 20));
const LOGIN_ATTEMPT_LIMIT_ACCOUNT = Math.max(3, Math.trunc(Number(process.env.LOGIN_ATTEMPT_LIMIT_ACCOUNT) || 10));
const LOGIN_ATTEMPT_WINDOW_MS = Math.max(30 * 1000, Math.trunc(Number(process.env.LOGIN_ATTEMPT_WINDOW_SECONDS) || 300) * 1000);
const PASSWORD_SCRYPT_N = Math.max(16384, Math.trunc(Number(process.env.PASSWORD_SCRYPT_N) || 16384));
const PASSWORD_SCRYPT_R = Math.max(8, Math.trunc(Number(process.env.PASSWORD_SCRYPT_R) || 8));
const PASSWORD_SCRYPT_P = Math.max(1, Math.trunc(Number(process.env.PASSWORD_SCRYPT_P) || 1));
const PASSWORD_SCRYPT_KEYLEN = Math.max(32, Math.trunc(Number(process.env.PASSWORD_SCRYPT_KEYLEN) || 64));
const PASSWORD_HASH_ALGORITHM = `scrypt:n=${PASSWORD_SCRYPT_N},r=${PASSWORD_SCRYPT_R},p=${PASSWORD_SCRYPT_P},keylen=${PASSWORD_SCRYPT_KEYLEN}`;
const DEV_PIN = String(process.env.DEV_PIN || "").trim();
const DEV_PIN_HASH = String(process.env.DEV_PIN_HASH || "").trim().toLowerCase();
const DEV_PIN_REQUIRED = String(process.env.DEV_PIN_REQUIRED || "false").trim().toLowerCase() === "true" && (DEV_PIN !== "" || DEV_PIN_HASH !== "");
const DEV_PIN_UNLOCK_TTL_MS = Math.max(60 * 1000, Math.trunc(Number(process.env.DEV_PIN_UNLOCK_TTL_MINUTES) || 15) * 60 * 1000);
const ADMIN_2FA_REQUIRED = String(process.env.ADMIN_2FA_REQUIRED || "false").trim().toLowerCase() === "true";
const ADMIN_2FA_SECRET = String(process.env.ADMIN_2FA_SECRET || "").trim();
const ADMIN_2FA_SECRETS = String(process.env.ADMIN_2FA_SECRETS || "").trim();
const ADMIN_2FA_UNLOCK_TTL_MS = Math.max(60 * 1000, Math.trunc(Number(process.env.ADMIN_2FA_UNLOCK_TTL_MINUTES) || 15) * 60 * 1000);
const ADMIN_2FA_WINDOW_STEPS = Math.max(0, Math.min(2, Math.trunc(Number(process.env.ADMIN_2FA_WINDOW_STEPS) || 1)));
const ADMIN_COMMAND_COOLDOWN_MS = Math.max(0, Math.trunc(Number(process.env.ADMIN_COMMAND_COOLDOWN_MS) || 1000));
const ADMIN_COMMAND_CONFIRMATION_REQUIRED = String(process.env.ADMIN_COMMAND_CONFIRMATION_REQUIRED || "false").trim().toLowerCase() === "true";
const ADMIN_COMMAND_CONFIRMATION_TTL_MS = Math.max(15 * 1000, Math.trunc(Number(process.env.ADMIN_COMMAND_CONFIRMATION_TTL_SECONDS) || 60) * 1000);
const ADMIN_COMMAND_CONFIRMATION_ACTIONS = new Set(
  String(process.env.ADMIN_COMMAND_CONFIRMATION_ACTIONS || "clear,resetworld,reset_world,reworld,give,remove,ban,unban,mute,unmute,itemfreeze,itemunfreeze,itemretire,itemtransfer,itemflag")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
);
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Math.max(1, Math.trunc(Number(process.env.SMTP_PORT) || 587));
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true";
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "");
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || "PixelMania <no-reply@pixelmania.local>").trim();
const POSTGRES_ENABLED = String(process.env.POSTGRES_ENABLED || "false").trim().toLowerCase() === "true";
const POSTGRES_AUTO_BOOTSTRAP = String(process.env.POSTGRES_AUTO_BOOTSTRAP || "false").trim().toLowerCase() === "true";
const POSTGRES_CONNECTION_STRING = String(process.env.POSTGRES_CONNECTION_STRING || process.env.DATABASE_URL || "").trim();
const POSTGRES_HOST = String(process.env.POSTGRES_HOST || "").trim();
const POSTGRES_PORT = Math.max(1, Math.trunc(Number(process.env.POSTGRES_PORT) || 5432));
const POSTGRES_DATABASE = String(process.env.POSTGRES_DATABASE || "").trim();
const POSTGRES_USER = String(process.env.POSTGRES_USER || "").trim();
const POSTGRES_PASSWORD = String(process.env.POSTGRES_PASSWORD || "");
const POSTGRES_SSL = String(process.env.POSTGRES_SSL || "false").trim().toLowerCase() === "true";
const POSTGRES_SCHEMA = String(process.env.POSTGRES_SCHEMA || "pixelmania").trim() || "pixelmania";
const POSTGRES_POOL_MAX = Math.max(1, Math.trunc(Number(process.env.POSTGRES_POOL_MAX) || 10));
const POSTGRES_IDLE_TIMEOUT_MS = Math.max(1000, Math.trunc(Number(process.env.POSTGRES_IDLE_TIMEOUT_MS) || 30000));
const POSTGRES_CONNECT_TIMEOUT_MS = Math.max(1000, Math.trunc(Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS) || 8000));
const POSTGRES_WRITE_QUEUE_MAX = Math.max(100, Math.trunc(Number(process.env.POSTGRES_WRITE_QUEUE_MAX) || 1000));
const POSTGRES_BOOTSTRAP_SQL_PATH = String(
  process.env.POSTGRES_BOOTSTRAP_SQL_PATH ||
  path.join(__dirname, "docs", "postgres_security_foundation.sql")
).trim();
const POSTGRES_AUTHORITATIVE = String(process.env.POSTGRES_AUTHORITATIVE || "true").trim().toLowerCase() !== "false";
const REDIS_ENABLED = String(process.env.REDIS_ENABLED || "false").trim().toLowerCase() === "true";
const REDIS_URL = String(process.env.REDIS_URL || "redis://127.0.0.1:6379").trim();
const REDIS_KEY_PREFIX = String(process.env.REDIS_KEY_PREFIX || "pixelmania").trim() || "pixelmania";
const REDIS_CONNECT_TIMEOUT_MS = Math.max(250, Math.trunc(Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 1500));
const REDIS_ACTION_LOCK_TTL_MS = Math.max(1000, Math.trunc(Number(process.env.REDIS_ACTION_LOCK_TTL_MS) || 5000));
const REDIS_ACTION_LOCK_GUARD_MS = Math.max(3000, REDIS_ACTION_LOCK_TTL_MS + 3000);
const REDIS_PRESENCE_TTL_MS = Math.max(10000, Math.trunc(Number(process.env.REDIS_PRESENCE_TTL_MS) || 45000));
const REDIS_ACTIVE_SESSION_TTL_MS = Math.max(REDIS_PRESENCE_TTL_MS, Math.trunc(Number(process.env.REDIS_ACTIVE_SESSION_TTL_MS) || 120000));
const ADMIN_USERNAMES = new Set(["uso"]);
function readPositiveIntEnv(name, fallback, min = 1, max = 100000) {
  const parsed = Math.trunc(Number(process.env[name]));
  const value = Number.isFinite(parsed) ? parsed : Math.trunc(Number(fallback) || min);
  return Math.max(min, Math.min(max, value));
}

function readRateWindowMsEnv(msName, secondsName, fallbackMs) {
  const parsedMs = Math.trunc(Number(process.env[msName]));
  if (Number.isFinite(parsedMs) && parsedMs > 0) {
    return Math.max(100, Math.min(24 * 60 * 60 * 1000, parsedMs));
  }

  const parsedSeconds = Math.trunc(Number(process.env[secondsName]));
  if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
    return Math.max(100, Math.min(24 * 60 * 60 * 1000, parsedSeconds * 1000));
  }

  return Math.max(100, Math.min(24 * 60 * 60 * 1000, Math.trunc(Number(fallbackMs) || 1000)));
}

function makeBotRateLimitConfig(prefix, fallbackLimit, fallbackWindowMs, maxLimit = 100000) {
  return Object.freeze({
    limit: readPositiveIntEnv(`${prefix}_LIMIT`, fallbackLimit, 1, maxLimit),
    windowMs: readRateWindowMsEnv(`${prefix}_WINDOW_MS`, `${prefix}_WINDOW_SECONDS`, fallbackWindowMs),
  });
}

const BOT_RATE_LIMITS = Object.freeze({
  block_place: makeBotRateLimitConfig("BOT_BLOCK_PLACE", 12, 1000),
  block_break: makeBotRateLimitConfig("BOT_BLOCK_BREAK", 16, 1000),
  pickup_attempt: makeBotRateLimitConfig("BOT_PICKUP_ATTEMPT", 12, 1000),
  chat_message: makeBotRateLimitConfig("BOT_CHAT_MESSAGE", 3, 1000),
  player_punch: makeBotRateLimitConfig("BOT_PLAYER_PUNCH", 10, 1000),
  trade_request: makeBotRateLimitConfig("BOT_TRADE_REQUEST", 20, 60 * 1000),
  world_join: makeBotRateLimitConfig("BOT_WORLD_JOIN", 20, 60 * 1000),
  vending_purchase: makeBotRateLimitConfig("BOT_VENDING_PURCHASE", 5, 1000),
});
const BOT_RATE_LIMIT_SECURITY_LOG_WINDOW_MS = Math.max(1000, Math.trunc(Number(process.env.BOT_RATE_LIMIT_SECURITY_LOG_WINDOW_MS) || 5000));
const MESSAGE_RATE_LIMITS = {
  login: { limit: 10, windowMs: 10000 },
  account_register: { limit: 6, windowMs: 15000 },
  account_login: { limit: 8, windowMs: 15000 },
  account_token_login: { limit: 8, windowMs: 15000 },
  account_state_save: { limit: 8, windowMs: 10000 },
  inventory_transaction_request: { limit: 12, windowMs: 5000 },
  trade_request: { limit: 6, windowMs: 5000 },
  trade_response: { limit: 12, windowMs: 5000 },
  trade_offer_update: { limit: 18, windowMs: 5000 },
  trade_confirm: { limit: 12, windowMs: 5000 },
  trade_final_confirm: { limit: 12, windowMs: 5000 },
  trade_cancel: { limit: 12, windowMs: 5000 },
  friend_list_request: { limit: 8, windowMs: 5000 },
  friend_request: { limit: 6, windowMs: 5000 },
  friend_response: { limit: 12, windowMs: 5000 },
  player_state_request: { limit: 8, windowMs: 10000 },
  pull_player_request: { limit: 6, windowMs: 5000 },
  player_state_save: { limit: 6, windowMs: 10000 },
  join_world: { limit: 12, windowMs: 10000 },
  leave_world: { limit: 20, windowMs: 10000 },
  chat: BOT_RATE_LIMITS.chat_message,
  broadcast: { limit: 3, windowMs: 10000 },
  developer_pin_unlock: { limit: 5, windowMs: 15000 },
  developer_command_request: { limit: 30, windowMs: 5000 },
  world_block_update: { limit: 35, windowMs: 1000 },
  world_seed_update: { limit: 25, windowMs: 1000 },
  world_interaction_update: { limit: 20, windowMs: 1000 },
  door_enter: { limit: 8, windowMs: 1000 },
  world_item_drop_create: { limit: 20, windowMs: 1000 },
  world_drop_create: { limit: 20, windowMs: 1000 },
  world_item_drop_update: { limit: 30, windowMs: 1000 },
  world_drop_update: { limit: 30, windowMs: 1000 },
  world_item_drop_pickup: BOT_RATE_LIMITS.pickup_attempt,
  world_item_drop_remove: { limit: 30, windowMs: 1000 },
  world_drop_pickup: BOT_RATE_LIMITS.pickup_attempt,
  world_drop_remove: { limit: 30, windowMs: 1000 },
  player_position: { limit: 120, windowMs: 1000 },
  player_punch: BOT_RATE_LIMITS.player_punch,
};
const DEBUG_ACTION_POSITION_FLOW = ["1", "true", "yes"].includes(String(process.env.DEBUG_ACTION_POSITION_FLOW || "false").trim().toLowerCase());
const DEBUG_PLAYER_PROGRESSION = ["1", "true", "yes"].includes(String(process.env.DEBUG_PLAYER_PROGRESSION || "false").trim().toLowerCase());
const WORLD_LOCK_BLOCK_TYPE = "world_lock";
const SUPER_WORLD_LOCK_BLOCK_TYPE = "super_world_lock";
const SUPER_WORLD_LOCK_EXCHANGE_RATE = 100;
const SHOP_CATALOG = new Map([
  ["world_lock", { item_id: "world_lock", item_category: "block", amount: 1, price: 3500 }],
  ["crafting_station", { item_id: "crafting_station", item_category: "block", amount: 1, price: 80 }],
  ["vend_empty", { item_id: "vend_empty", item_category: "block", amount: 1, price: 7500 }],
  ["safe", { item_id: "safe", item_category: "block", amount: 1, price: 7500 }],
  ["fish_monger", { item_id: "fish_monger", item_category: "block", amount: 1, price: 15000 }],
  ["basic_items_pack", { item_id: "basic_items_pack", item_category: "material", amount: 1, price: 500, pack_size: 1 }],
  ["prestige_coloured_block_pack", { item_id: "prestige_coloured_block_pack", item_category: "material", amount: 1, price: 500, pack_size: 5 }],
  ["entrance_mover", { item_id: "entrance_mover", item_category: "tool", amount: 1, price: 200 }],
  ["bamboo_rod", { item_id: "bamboo_rod", item_category: "tool", amount: 1, price: 5000 }],
  ["fishing_rod", { item_id: "bamboo_rod", item_category: "tool", amount: 1, price: 5000 }],
  ["fiberglass_rod", { item_id: "fiberglass_rod", item_category: "tool", amount: 1, price: 15000 }],
  ["tungsten_rod", { item_id: "tungsten_rod", item_category: "tool", amount: 1, price: 50000 }],
  ["lure_pack", { item_id: "lure_pack", item_category: "lure", amount: 1, price: 25, pack_size: 5 }],
]);
const BASIC_ITEMS_PACK_TABLE = [
  { item_id: "messy_brown_hair", item_category: "hair", weight: 100 },
  { item_id: "basic_blue_shirt", item_category: "shirt", weight: 100 },
  { item_id: "basic_red_shirt", item_category: "shirt", weight: 100 },
  { item_id: "basic_white_shirt", item_category: "shirt", weight: 100 },
  { item_id: "basic_black_shirt", item_category: "shirt", weight: 100 },
  { item_id: "basic_heart_shirt", item_category: "shirt", weight: 100 },
  { item_id: "basic_gray_shirt", item_category: "shirt", weight: 100 },
  { item_id: "basic_maroon_shirt", item_category: "shirt", weight: 100 },
  { item_id: "basic_black_pants", item_category: "pants", weight: 100 },
  { item_id: "basic_light_gray_pants", item_category: "pants", weight: 100 },
  { item_id: "basic_navy_pants", item_category: "pants", weight: 100 },
  { item_id: "basic_brown_pants", item_category: "pants", weight: 100 },
  { item_id: "basic_green_pants", item_category: "pants", weight: 100 },
  { item_id: "basic_pink_pants", item_category: "pants", weight: 100 },
  { item_id: "basic_brown_shoes", item_category: "shoes", weight: 100 },
  { item_id: "basic_black_shoes", item_category: "shoes", weight: 100 },
  { item_id: "basic_red_shoes", item_category: "shoes", weight: 100 },
  { item_id: "basic_blue_shoes", item_category: "shoes", weight: 100 },
];
const PRESTIGE_COLOURED_BLOCK_PACK_TABLE = [
  { item_id: "ps_blue_block", item_category: "block", weight: 100 },
  { item_id: "ps_green_block", item_category: "block", weight: 100 },
  { item_id: "ps_purple_block", item_category: "block", weight: 100 },
  { item_id: "ps_red_block", item_category: "block", weight: 100 },
  { item_id: "ps_yellow_block", item_category: "block", weight: 100 },
];
const LURE_PACK_TABLE = [
  { item_id: "hook", item_category: "lure", weight: 300 },
  { item_id: "worm_lure", item_category: "lure", weight: 300 },
  { item_id: "shiny_lure", item_category: "lure", weight: 180 },
  { item_id: "golden_lure", item_category: "lure", weight: 100 },
  { item_id: "magnet_lure", item_category: "lure", weight: 60 },
  { item_id: "bonito_lure", item_category: "lure", weight: 30 },
  { item_id: "cotton_cordel_lure", item_category: "lure", weight: 25 },
  { item_id: "void_worm_lure", item_category: "lure", weight: 5 },
];

const httpServer = http.createServer(handleHttpRequest);
const wss = new WebSocket.Server({ server: httpServer });

httpServer.on("error", (error) => {
  const code = String(error?.code || "");
  if (code === "EADDRINUSE" || code === "EACCES") {
    handleFatalProcessError("http_server_error", error);
    return;
  }

  const details = errorToCrashDetails(error);
  writeCrashReport("http_server_error", {
    error: details,
    runtime: getCrashRuntimeState(),
  });
  console.error("[http_server_error]", details.stack || details.message);
});

wss.on("error", (error) => {
  const details = errorToCrashDetails(error);
  writeCrashReport("websocket_server_error", {
    error: details,
    runtime: getCrashRuntimeState(),
  });
  console.error("[websocket_server_error]", details.stack || details.message);
});

const players = new Map();
const worldStates = new Map();
const playerStates = new Map();
const accounts = new Map();
const activeAccountSessions = new Map();
const activeTrades = new Map();
const tradeByPlayerId = new Map();
const worldDropActionLocks = new Set();
const worldVendActionLocks = new Set();
const worldSafeActionLocks = new Set();
const playerInventoryActionLocks = new Set();
const worldEventActionLocks = new Set();
const worldFrozenTreasureOpenLocks = new Set();
const localLoginAttemptBuckets = new Map();
const punishmentCache = new Map();
const activeFishingSessions = new Map();
const blockDamage = new Map();
const pendingPlayerPositionBroadcasts = new Map();
const pendingPlayerPositionBroadcastTimers = new Map();
const worldSaveTimers = new Map();
const worldJsonBackupTimers = new Map();
const pendingWorldJsonBackups = new Map();
const playerSaveTimers = new Map();
const worldEventTimers = new Map();
const worldEventCountdownTimers = new Map();
const worldEventCommandCooldowns = new Map();
const pendingPersistenceWrites = new Set();
const worldSnapshotStorageWarnings = new Set();
let accountsSaveTimer = null;
let mailTransporter = null;
let antiDupeAuditTimer = null;
let antiDupeAuditRunning = false;
let worldSnapshotSchedulerTimer = null;
let worldSnapshotSchedulerRunning = false;
let worldSnapshotSchedulerCursor = 0;
let worldEventRandomTimer = null;
let serverTickMonitorTimer = null;
let serverTickMonitorLastHrtime = null;
const worldSnapshotSchedulerState = {
  enabled: false,
  last_run_at: "",
  last_duration_ms: 0,
  last_world_count: 0,
  last_error: "",
};
const serverTickStats = {
  enabled: false,
  started_at: "",
  last_sample_at: "",
  interval_ms: SERVER_TICK_MONITOR_INTERVAL_MS,
  sample_count: 0,
  tps: 0,
  tick_time_ms: 0,
  avg_tick_time_ms: 0,
  max_tick_time_ms: 0,
  event_loop_lag_ms: 0,
  max_event_loop_lag_ms: 0,
};
const postgresStore = new PostgresStore({
  enabled: POSTGRES_ENABLED,
  autoBootstrap: POSTGRES_AUTO_BOOTSTRAP,
  bootstrapSqlPath: POSTGRES_BOOTSTRAP_SQL_PATH,
  connectionString: POSTGRES_CONNECTION_STRING,
  host: POSTGRES_HOST,
  port: POSTGRES_PORT,
  database: POSTGRES_DATABASE,
  user: POSTGRES_USER,
  password: POSTGRES_PASSWORD,
  ssl: POSTGRES_SSL,
  schema: POSTGRES_SCHEMA,
  poolMax: POSTGRES_POOL_MAX,
  idleTimeoutMs: POSTGRES_IDLE_TIMEOUT_MS,
  connectTimeoutMs: POSTGRES_CONNECT_TIMEOUT_MS,
  maxWriteQueueDepth: POSTGRES_WRITE_QUEUE_MAX,
  logger: (...args) => console.warn(...args),
});
const redisStore = new RedisStore({
  enabled: REDIS_ENABLED,
  url: REDIS_URL,
  keyPrefix: REDIS_KEY_PREFIX,
  connectTimeoutMs: REDIS_CONNECT_TIMEOUT_MS,
  logger: (...args) => console.warn(...args),
});

function debugActionPositionFlow(label, player, extra = {}) {
  if (!DEBUG_ACTION_POSITION_FLOW) return;

  console.log("[PM_FLOW][Server]", label, {
    player_id: player?.id || "",
    username: player?.account_username || player?.name || "",
    world: player?.world || "",
    x: Number(player?.x || 0),
    y: Number(player?.y || 0),
    ...extra,
  });
}

let fatalCrashReportWritten = false;

function trimCrashText(value, maxLength = 4000) {
  const text = String(value == null ? "" : value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function crashValueToString(value) {
  if (typeof value === "string") return trimCrashText(value);
  if (value == null) return String(value);
  try {
    return trimCrashText(JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === "bigint") return nestedValue.toString();
      if (typeof nestedValue === "function") return `[Function ${nestedValue.name || "anonymous"}]`;
      return nestedValue;
    }));
  } catch (_error) {
    return trimCrashText(String(value));
  }
}

function errorToCrashDetails(error) {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: trimCrashText(error.message || ""),
      stack: trimCrashText(error.stack || ""),
      code: error.code ? String(error.code) : "",
      cause: error.cause ? crashValueToString(error.cause) : "",
    };
  }

  return {
    name: typeof error,
    message: crashValueToString(error),
    stack: "",
    code: "",
  };
}

function getCrashRuntimeState() {
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
      snapshot_error: error && error.message ? error.message : String(error),
    };
  }
}

function getServerTickSnapshot() {
  return {
    enabled: Boolean(serverTickStats.enabled),
    started_at: serverTickStats.started_at || "",
    last_sample_at: serverTickStats.last_sample_at || "",
    interval_ms: clampInteger(serverTickStats.interval_ms || SERVER_TICK_MONITOR_INTERVAL_MS, 100, 60_000),
    sample_count: clampInteger(serverTickStats.sample_count || 0, 0, Number.MAX_SAFE_INTEGER),
    tps: Number(serverTickStats.tps || 0),
    tick_time_ms: Number(serverTickStats.tick_time_ms || 0),
    avg_tick_time_ms: Number(serverTickStats.avg_tick_time_ms || 0),
    max_tick_time_ms: Number(serverTickStats.max_tick_time_ms || 0),
    event_loop_lag_ms: Number(serverTickStats.event_loop_lag_ms || 0),
    max_event_loop_lag_ms: Number(serverTickStats.max_event_loop_lag_ms || 0),
  };
}

function startServerTickMonitor() {
  if (serverTickMonitorTimer) return;

  serverTickStats.enabled = true;
  serverTickStats.started_at = new Date().toISOString();
  serverTickStats.last_sample_at = "";
  serverTickStats.sample_count = 0;
  serverTickMonitorLastHrtime = process.hrtime.bigint();

  serverTickMonitorTimer = setInterval(() => {
    const now = process.hrtime.bigint();
    const elapsedMs = Number(now - serverTickMonitorLastHrtime) / 1_000_000;
    serverTickMonitorLastHrtime = now;
    const lagMs = Math.max(0, elapsedMs - SERVER_TICK_MONITOR_INTERVAL_MS);
    const sampleCount = serverTickStats.sample_count + 1;
    const previousAverage = Number(serverTickStats.avg_tick_time_ms || 0);

    serverTickStats.last_sample_at = new Date().toISOString();
    serverTickStats.sample_count = sampleCount;
    serverTickStats.tick_time_ms = Number(elapsedMs.toFixed(2));
    serverTickStats.event_loop_lag_ms = Number(lagMs.toFixed(2));
    serverTickStats.tps = elapsedMs > 0 ? Number((1000 / elapsedMs).toFixed(2)) : 0;
    serverTickStats.avg_tick_time_ms = Number((((previousAverage * (sampleCount - 1)) + elapsedMs) / sampleCount).toFixed(2));
    serverTickStats.max_tick_time_ms = Number(Math.max(serverTickStats.max_tick_time_ms || 0, elapsedMs).toFixed(2));
    serverTickStats.max_event_loop_lag_ms = Number(Math.max(serverTickStats.max_event_loop_lag_ms || 0, lagMs).toFixed(2));
  }, SERVER_TICK_MONITOR_INTERVAL_MS);

  if (typeof serverTickMonitorTimer.unref === "function") serverTickMonitorTimer.unref();
}

function writeCrashReport(event, details = {}) {
  try {
    const entry = {
      report_id: crypto.randomUUID(),
      at: new Date().toISOString(),
      event: String(event || "unknown"),
      pid: process.pid,
      ppid: process.ppid,
      uptime_seconds: Math.round(process.uptime()),
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      memory_usage: process.memoryUsage(),
      ...details,
    };
    fs.mkdirSync(path.dirname(CRASH_REPORT_PATH), { recursive: true });
    fs.appendFileSync(CRASH_REPORT_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("[crash-report] failed to write crash report:", error && error.message ? error.message : error);
  }
}

function handleFatalProcessError(event, error) {
  fatalCrashReportWritten = true;
  const errorDetails = errorToCrashDetails(error);
  writeCrashReport(event, {
    error: errorDetails,
    runtime: getCrashRuntimeState(),
  });
  console.error(`[crash-report] ${event}:`, errorDetails.stack || errorDetails.message);
  process.exit(1);
}

process.on("uncaughtException", (error) => {
  handleFatalProcessError("uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  handleFatalProcessError("unhandledRejection", reason);
});

process.on("warning", (warning) => {
  writeCrashReport("process_warning", {
    warning: errorToCrashDetails(warning),
    runtime: getCrashRuntimeState(),
  });
});

const periodicSaveTimer = setInterval(() => {
  flushPendingSaves();
}, PERIODIC_SAVE_MS);
if (typeof periodicSaveTimer.unref === "function") periodicSaveTimer.unref();

ensureDataFolders();
bootstrapServer().catch((error) => {
  fatalCrashReportWritten = true;
  writeCrashReport("startup_failure", {
    error: errorToCrashDetails(error),
    runtime: getCrashRuntimeState(),
  });
  console.error("PixelMania server failed to start:", error);
  process.exit(1);
});

wss.on("connection", (socket, request = null) => {
  const playerId = crypto.randomUUID();

  players.set(playerId, {
    id: playerId,
    name: "Guest",
    account_username: "",
    account_email: "",
    authenticated: false,
    role: "player",
    world: "START",
    current_world: "START",
    current_world_id: "START",
    joined_world: false,
    x: 0,
    y: 0,
    facing: 1,
    animation_state: "idle",
    velocity_x: 0,
    velocity_y: 0,
    on_floor: true,
    in_water: false,
    in_lava_fire: false,
    damage_flash_expires_at: 0,
    damage_flash_token: 0,
    equipment_slots: {},
    client_version: "",
    last_position_at: 0,
    last_presence_at: 0,
    last_block_break_at: 0,
    noclip_enabled: false,
    developer_pin_unlocked_until: 0,
    admin_2fa_verified_until: 0,
    developer_command_cooldowns: new Map(),
    pending_admin_confirmations: new Map(),
  });

  socket.playerId = playerId;
  socket.userAgent = String(request?.headers?.["user-agent"] || "");
  socket.remoteAddress = String(request?.socket?.remoteAddress || "");
  socket.rateLimits = new Map();
  socket.rateLimitWarnings = new Map();
  socket.rateLimitSecurityWarnings = new Map();
  socket.authRequiredNotices = new Map();

  socket.on("error", (error) => {
    console.warn("[socket_error]", {
      player_id: playerId,
      message: error && error.message ? error.message : String(error),
    });
  });

  sendJson(socket, {
    type: "connected",
    player_id: playerId,
  });

  socket.on("message", async (raw) => {
    try {
      if (getRawLength(raw) > MAX_PACKET_BYTES) {
        socket.close(1009, "Packet too large");
        return;
      }

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }

      if (!data || typeof data !== "object" || Array.isArray(data)) return;

      const player = players.get(playerId);
      if (!player) return;

      if (!(await checkMessageRateLimit(socket, player, String(data.type || "unknown"), data))) return;
      if (!(await checkBotActionRateLimit(socket, player, String(data.type || "unknown"), data))) return;

      const clientVersion = getClientVersion(data);
      if (!isClientVersionAllowed(clientVersion)) {
        sendClientUpdateRequired(socket, data, clientVersion);
        return;
      }
      player.client_version = clientVersion || player.client_version;

      if (!(await enforceMessageIdempotency(socket, player, data))) {
        return;
      }

    if (data.type === "login") {
      player.name = cleanName(data.name);

      sendJson(socket, {
        type: "login_ok",
        player_id: playerId,
        name: player.name,
        username: player.account_username,
        email: player.account_email,
      });
      return;
    }

    if (data.type === "account_register") {
      handleAccountRegister(socket, player, data);
      return;
    }

    if (data.type === "account_login") {
      await handleAccountLogin(socket, player, data);
      return;
    }

    if (data.type === "account_token_login") {
      await handleAccountTokenLogin(socket, player, data);
      return;
    }

    if (data.type === "account_state_save") {
      const account = sanitizeAccountState(data);
      if (!account) return;
      if (!player.authenticated) return;
      if (accountKey(account.username) !== accountKey(player.account_username)) return;

      upsertAccount(account);
      return;
    }

    if (data.type === "inventory_transaction_request") {
      await handleInventoryTransactionRequest(socket, player, data);
      return;
    }

    if (data.type === "trade_request") {
      if (await rejectIfTradeBanned(socket, player, data)) return;
      await handleTradeRequest(socket, player, data);
      return;
    }

    if (data.type === "trade_response") {
      if (await rejectIfTradeBanned(socket, player, data)) return;
      handleTradeResponse(socket, player, data);
      return;
    }

    if (data.type === "friend_list_request") {
      handleFriendListRequest(socket, player, data);
      return;
    }

    if (data.type === "friend_request") {
      handleFriendRequest(socket, player, data);
      return;
    }

    if (data.type === "friend_response") {
      handleFriendResponse(socket, player, data);
      return;
    }

    if (data.type === "trade_offer_update") {
      if (await rejectIfTradeBanned(socket, player, data)) return;
      handleTradeOfferUpdate(socket, player, data);
      return;
    }

    if (data.type === "trade_confirm") {
      if (await rejectIfTradeBanned(socket, player, data)) return;
      handleTradeConfirm(socket, player, data);
      return;
    }

    if (data.type === "trade_final_confirm") {
      if (await rejectIfTradeBanned(socket, player, data)) return;
      await handleTradeFinalConfirm(socket, player, data);
      return;
    }

    if (data.type === "trade_cancel") {
      handleTradeCancel(socket, player, data);
      return;
    }

    if (data.type === "player_state_request") {
      if (!requireAuthenticated(socket, player, "load player data")) return;

      const requestId = makeRequestId(data);
      const username = cleanAccountName(data.username || data.requested_username || data.target_username || player.account_username || player.name);
      if (username === "") return;
      const purpose = clampString(data.purpose || "").toLowerCase();
      if (purpose === ADMIN_INVENTORY_LOOKUP_PURPOSE) {
        handleAdminInventoryLookupRequest(socket, player, data, username, requestId, purpose);
        return;
      }
      if (purpose === ADMIN_ITEM_INSTANCE_LOOKUP_PURPOSE) {
        await handleAdminItemInstanceLookupRequest(socket, player, data, username, requestId, purpose);
        return;
      }
      if (purpose === ADMIN_ITEM_INSTANCE_HISTORY_LOOKUP_PURPOSE) {
        await handleAdminItemInstanceHistoryLookupRequest(socket, player, data, username, requestId, purpose);
        return;
      }
      if (purpose === ADMIN_TRANSACTION_LEDGER_LOOKUP_PURPOSE) {
        await handleAdminTransactionLedgerLookupRequest(socket, player, data, username, requestId, purpose);
        return;
      }
      if (purpose === ADMIN_MONITORING_DASHBOARD_PURPOSE) {
        await handleAdminMonitoringDashboardRequest(socket, player, data, username, requestId, purpose);
        return;
      }
      if (!isPlayerOwnAccount(player, username)) {
        if (purpose === "world_lock_access_check" || purpose === "remote_player_profile") {
          const publicProfile = buildPublicPlayerProfilePayload(username, requestId, purpose);
          publicProfile.friend_status = getFriendStatus(player.account_username, username);
          sendJson(socket, publicProfile);
        }
        return;
      }

      const state = ensurePlayerState(username);
      const publicProfile = buildPublicPlayerProfilePayload(username, requestId, purpose);
      const playerData = state
        ? buildPlayerStateForClient(state, { selectFirstHotbarSlot: purpose === "active_profile" })
        : {};
      sendJson(socket, {
        type: "player_state",
        request_id: requestId,
        purpose,
        found: state !== null,
        username,
        online: true,
        world: player.world || "",
        current_world: player.world || "",
        last_seen_at: publicProfile.last_seen_at || "",
        friend_status: getFriendStatus(player.account_username, username),
        account: publicProfile.account || { username },
        equipment_slots: player.equipment_slots || {},
        player_data: playerData,
      });
      return;
    }

    if (data.type === "pull_player_request") {
      handlePullPlayerRequest(socket, player, data);
      return;
    }

    if (data.type === "door_enter") {
      await handleDoorEnterRequest(socket, player, data);
      return;
    }

    if (data.type === "player_state_save") {
      if (!requireAuthenticated(socket, player, "save player data")) return;

      if (tradeByPlayerId.has(playerId)) {
        sendActionRejected(socket, "player_state_save", "Finish or cancel your trade before saving inventory.");
        return;
      }

      const username = cleanAccountName(data.username || player.account_username || player.name);
      if (username === "") return;
      if (!isPlayerOwnAccount(player, username)) return;

      const state = sanitizePlayerState(data, username);
      if (!state) return;
      const serverState = mergeClientPlayerStateIntoServerState(username, state, {
        legacyImportRequested: Boolean(data.legacy_client_inventory_import),
        legacyImportRevision: clampInteger(data.legacy_client_inventory_import_revision || 1, 1, 1000),
      });
      if (!serverState) return;

      upsertAccount({
        username,
        email: player.account_email,
      });
      setPlayerState(username, serverState);
      player.equipment_slots = sanitizeEquipmentSlots(getEquipmentSlotsFromPlayerState(serverState), username, serverState);
      queuePlayerSave(username);
      sendJson(socket, {
        type: "player_state",
        found: true,
        username,
        player_data: serverState,
      });
      return;
    }

    if (data.type === "join_world") {
      if (!requireAuthenticated(socket, player, "join worlds")) return;

      const oldWorld = player.world;
      const newWorld = cleanWorld(data.world);
      if (await rejectIfWorldBanned(socket, player, newWorld, "join_world")) return;

      if (oldWorld && oldWorld !== newWorld) {
        cancelActiveTradeForPlayer(playerId, "Trade canceled because a player changed worlds.");
        activeFishingSessions.delete(playerId);
        clearPlayerFishingPresence(player);
      }

      if (player.joined_world && oldWorld && oldWorld !== newWorld) {
        broadcastSystemToWorld(oldWorld, `${player.name} left ${oldWorld}`, playerId);
        broadcastToWorld(oldWorld, buildPublicPlayerPresencePayload("player_left", player, oldWorld), playerId);
      }

      player.world = newWorld;
      player.current_world = newWorld;
      player.current_world_id = newWorld;
      player.joined_world = true;
      player.last_position_at = 0;
      const joinSpawn = getJoinWorldSpawnForWorld(player.world);
      player.x = joinSpawn.x;
      player.y = joinSpawn.y;
      player.velocity_x = 0;
      player.velocity_y = 0;
      player.animation_state = "idle";
      player.on_floor = true;
      player.facing = Number(data.facing) < 0 ? -1 : 1;
      postgresStore.mirrorPlayerWorld(player.account_username, player.world);

      const existingPlayers = getPlayersInWorld(player.world, playerId);
      console.log("[APPEARANCE][Server] sending world appearance snapshot", {
        player: player.account_username,
        world: player.world,
        existing_players: existingPlayers.length,
      });

      sendJson(socket, {
        type: "join_world_ok",
        world: player.world,
        players: existingPlayers,
        spawn_x: joinSpawn.x,
        spawn_y: joinSpawn.y,
        spawn_grid_x: joinSpawn.grid_x,
        spawn_grid_y: joinSpawn.grid_y,
      });

      sendJson(socket, buildWorldStateMessage(player.world, {
        respawn_player: true,
        force_player_position: true,
        world_state_reason: "join_world",
        spawn_x: joinSpawn.x,
        spawn_y: joinSpawn.y,
        spawn_grid_x: joinSpawn.grid_x,
        spawn_grid_y: joinSpawn.grid_y,
        portal_spawn_x: joinSpawn.x,
        portal_spawn_y: joinSpawn.y,
        x: joinSpawn.x,
        y: joinSpawn.y,
      }));
      sendActiveWorldEventState(socket, player.world);

      broadcastToWorld(player.world, buildPublicPlayerPresencePayload("player_joined", player, player.world), playerId);

      broadcastSystemToWorld(player.world, `${player.name} joined ${player.world}`, playerId);
      touchLivePresence(socket, player, { force: true });
      notifyOnlineFriendsOfFriendState(player.account_username);
      return;
    }

    if (data.type === "leave_world") {
      if (!requireAuthenticated(socket, player, "leave worlds")) return;

      const requestedWorld = cleanWorld(data.world || player.world || "");
      const currentWorld = cleanWorld(player.world || "");
      if (!player.joined_world || !currentWorld || (requestedWorld && requestedWorld !== currentWorld)) {
        player.joined_world = false;
        return;
      }

      cancelActiveTradeForPlayer(playerId, "Trade canceled because a player left the world.");
      activeFishingSessions.delete(playerId);
      clearPlayerFishingPresence(player);
      broadcastToWorld(currentWorld, buildPublicPlayerPresencePayload("player_left", player, currentWorld), playerId);
      broadcastSystemToWorld(currentWorld, `${player.name} left ${currentWorld}`, playerId);
      player.joined_world = false;
      player.world = "";
      player.current_world = "";
      player.current_world_id = "";
      touchLivePresence(socket, player, { force: true });
      return;
    }

    if (data.type === "chat") {
      if (!requireAuthenticated(socket, player, "chat")) return;

      const message = String(data.message || "").trim().slice(0, MAX_CHAT_LENGTH);
      if (message.length === 0) return;
      if (await rejectIfMuted(socket, player, "chat")) return;

      if (message.toLowerCase().startsWith("/bc ")) {
        const broadcastMessage = message.slice(4).trim().slice(0, MAX_CHAT_LENGTH);
        if (broadcastMessage.length > 0) {
          const broadcastWorld = getPlayerCurrentWorldName(player);
          broadcastToAuthenticatedPlayers({
            type: "broadcast",
            player_id: playerId,
            name: player.name,
            message: broadcastMessage,
            world: broadcastWorld,
            current_world: broadcastWorld,
          });
        }
        return;
      }

      broadcastToWorld(player.world, {
        type: "chat",
        player_id: playerId,
        name: player.name,
        message,
        world: player.world,
      });
      return;
    }

    if (data.type === "broadcast") {
      if (!requireAuthenticated(socket, player, "broadcast")) return;

      const message = String(data.message || "").trim().slice(0, MAX_CHAT_LENGTH);
      if (message.length === 0) return;
      if (await rejectIfMuted(socket, player, "broadcast")) return;

      const broadcastWorld = getPlayerCurrentWorldName(player);
      broadcastToAuthenticatedPlayers({
        type: "broadcast",
        player_id: playerId,
        name: player.name,
        message,
        world: broadcastWorld,
        current_world: broadcastWorld,
      });
      return;
    }

    if (data.type === "developer_pin_unlock") {
      handleDeveloperPinUnlock(socket, player, data);
      return;
    }

    if (data.type === "developer_command_request") {
      await handleDeveloperCommandRequest(socket, player, data);
      return;
    }

    if (data.type === "world_block_update") {
      try {
      if (!requireAuthenticated(socket, player, "edit worlds")) return;

      const worldName = getPlayerCurrentWorldName(player);
      if (await rejectIfWorldBanned(socket, player, worldName, "world_block_update")) return;
      if (POSTGRES_ENABLED && POSTGRES_AUTHORITATIVE && !isPostgresAuthoritativeReady()) {
        sendActionRejected(socket, "world_block_update", "PostgreSQL is not ready.");
        return;
      }

      const update = sanitizeBlockUpdate(data, worldName);
      if (!update) return;
      update.source_tool = clampString(player?.equipment_slots?.hand || update.source_tool || data.source_tool || "");
      update.player_id = String(player?.id || socket?.playerId || "");
      update.username = cleanAccountName(player?.account_username || player?.name || "");
      update.account_username = update.username;
      update.actor_x = Number(player?.x || 0);
      update.actor_y = Number(player?.y || 0);
      update.actor_facing = Number(player?.facing || 1) < 0 ? -1 : 1;
      if (update.action === "break" || update.action === "hit") {
        debugActionPositionFlow("world_block_update break request start", player, {
          action: update.action,
          layer: update.layer,
          x: update.x,
          y: update.y,
          block_type: update.block_type,
        });
      }
      if (
        !canPlayerBuildInWorld(player, worldName) &&
        !canPlayerBreakOwnVendingMachine(player, worldName, update) &&
        !isFishMongerBreakAttempt(worldName, update)
      ) {
        sendActionRejected(socket, "world_block_update", "This world is locked.");
        return;
      }
      if ((update.action === "break" || update.action === "hit") && isWorldLockBlockType(update.block_type) && isWorldLocked(worldName) && !canPlayerControlWorldLock(player, worldName)) {
        sendActionRejected(socket, "world_block_update", "Only the world lock owner can break the lock.");
        return;
      }
      if (update.action === "place" && isWorldLockBlockType(update.block_type) && (ensureWorldState(worldName).world_lock?.is_locked || hasWorldLockBlock(worldName))) {
        sendActionRejected(socket, "world_block_update", "This world already has a lock.");
        return;
      }

      const validation = await validateBlockUpdateAgainstServerState(socket, player, worldName, update, makeRequestId(data));
      if (!validation.ok) return;
      if (validation.pendingHit) {
        sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
        return;
      }
      if (update.action === "break" && update.block_type === "frozen_treasure") {
        await handleFrozenTreasureOpen(socket, player, worldName, update, makeRequestId(data));
        return;
      }

      const blockTransactionId = makeAuditId("block");
      const blockTypeBefore = getWorldBlockTypeAt(worldName, update.x, update.y, update.layer);
      const previousWorldState = serializeWorldState(worldName);
      const shouldBroadcastWorldLockState = shouldApplyWorldLockStateForBlockUpdate(worldName, update);
      applyBlockUpdateToWorldState(worldName, update);
      const worldLockStatePayload = applyWorldLockStateForBlockUpdate(worldName, update, player, shouldBroadcastWorldLockState);
      if (update.action === "place" && isVendBlockType(update.block_type)) {
        initializeVendOwnerOnPlace(worldName, update, player);
      }
      if (update.action === "place" && isSafeBlockType(update.block_type)) {
        initializeSafeOwnerOnPlace(worldName, update, player);
      }
      const progression = update.action === "break"
        ? awardPlayerExperience(player.account_username, getBlockBreakXp(update.block_type, update.layer), "world_block_break", {
          world: worldName,
          block_type: update.block_type,
          layer: update.layer,
          x: update.x,
          y: update.y,
        }, validation.playerState || null)
        : { xp_gained: 0, levels_gained: 0, state: validation.playerState || null };
      let requesterPlayerState = Number(progression.xp_gained || 0) > 0 ? progression.state : (validation.playerState || null);
      const requesterProgressionPayload = buildProgressionPayload(progression);
      logPlayerProgressionAward(player, progression);
      const emittedDrops = createBreakDrops(worldName, update);
      if (update.action === "break") {
        debugActionPositionFlow("world_block_update break request end", player, {
          layer: update.layer,
          x: update.x,
          y: update.y,
          block_type: update.block_type,
          emitted_drops: emittedDrops.length,
        });
      }
      const worldChangeEntry = {
        ...getAuditActor(socket, player),
        source_type: "world_block_update",
        source_id: blockTransactionId,
        world: worldName,
        action: update.action,
        layer: update.layer,
        x: update.x,
        y: update.y,
        block_type: update.block_type,
        block_type_before: blockTypeBefore || (update.action === "break" || update.action === "hit" ? update.block_type : ""),
        block_type_after: update.action === "break" ? "" : update.block_type,
        details: {
          old_block_id: blockTypeBefore || (update.action === "break" || update.action === "hit" ? update.block_type : ""),
          new_block_id: update.action === "break" ? "" : update.block_type,
        },
      };
      const dropWorldChangeEntries = emittedDrops.map((drop) => ({
        ...getAuditActor(socket, player),
        source_type: "world_block_break",
        source_id: blockTransactionId,
        world: worldName,
        action: "break_drop",
        layer: update.layer,
        x: update.x,
        y: update.y,
        block_type: drop.item_type,
        details: {
          drop_id: drop.drop_id,
          item_category: drop.item_category,
          amount: drop.amount,
          source_block: update.block_type,
        },
      }));
      const worldChanges = [worldChangeEntry, ...dropWorldChangeEntries];
      let worldCommit = null;

      if (validation.deferred_inventory_commit) {
        const deferred = validation.deferred_inventory_commit;
        const serializedWorld = serializeWorldState(worldName);
        const inventoryCommit = await commitPlayerInventoryState(
          socket,
          player,
          deferred.username,
          deferred.beforeState,
          deferred.afterState,
          {
            ...(deferred.options || {}),
            world: worldName,
            world_state: serializedWorld,
            world_changes: worldChanges,
          }
        );

        if (!inventoryCommit.ok) {
          worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
          const rejectMessage = inventoryCommit.reason === "database_error"
            ? "PostgreSQL rejected the world update."
            : (inventoryCommit.message || "PostgreSQL rejected the world update.");
          sendActionRejected(socket, "world_block_update", rejectMessage);
          return;
        }

        validation.playerState = inventoryCommit.state;
        validation.postgres_committed = inventoryCommit.postgres_committed;
        requesterPlayerState = inventoryCommit.state || requesterPlayerState;
        persistWorldStateAfterInventoryCommit(worldName, inventoryCommit.postgres_committed, serializedWorld);
        worldCommit = { ok: true, postgres_committed: inventoryCommit.postgres_committed, serialized: serializedWorld };
      } else {
        worldCommit = await commitWorldStateWithBlockChanges(worldName, worldChanges);
        if (!worldCommit.ok) {
          worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
          sendActionRejected(socket, "world_block_update", worldCommit.message || "PostgreSQL rejected the world update.");
          return;
        }
      }

      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update, requesterPlayerState ? {
        username: player.account_username,
        player_data: requesterPlayerState,
        progression: requesterProgressionPayload,
      } : null);
      if (worldLockStatePayload) {
        sendWorldUpdateToRequesterAndWorld(socket, player, worldName, worldLockStatePayload);
      }
      for (const drop of emittedDrops) {
        sendWorldUpdateToRequesterAndWorld(socket, player, worldName, drop);
      }
      logWorldChange(socket, player, worldChangeEntry, { skipPostgres: worldCommit.postgres_committed });
      if (update.action === "place" && validation.playerState) {
        const placementCost = ItemDatabase.getPlacementCost(update.block_type);
        if (placementCost && Number(placementCost.amount) > 0) {
          logItemLedgerForState(socket, player, player.account_username, validation.playerState, placementCost.item_id, placementCost.item_category, -placementCost.amount, "world_block_place", blockTransactionId, "placement_cost", worldName, {
            x: update.x,
            y: update.y,
            placed_block: update.block_type,
            layer: update.layer,
          }, { skipPostgres: validation.postgres_committed });
        }
      }
      for (const dropWorldChangeEntry of dropWorldChangeEntries) {
        logWorldChange(socket, player, dropWorldChangeEntry, { skipPostgres: worldCommit.postgres_committed });
      }

      if (requesterPlayerState) {
        sendInventoryTransactionResult(socket, {
          ok: true,
          action: update.action === "break" ? "world_block_break" : "world_block_place",
          message: update.action === "break"
            ? getProgressionMessage(progression, getProgressionXpMessage(progression))
            : getProgressionMessage(progression, validation.message || ""),
          username: player.account_username,
          progression: requesterProgressionPayload,
          player_data: requesterPlayerState,
        });
      }
      } catch (error) {
        const requestId = makeRequestId(data);
        const rawX = Number(data?.x);
        const rawY = Number(data?.y);
        const details = {
          request_id: requestId,
          player_id: String(player?.id || socket?.playerId || ""),
          username: cleanAccountName(player?.account_username || player?.name || ""),
          world: cleanWorld(data?.world || player?.world || "START"),
          action: String(data?.action || ""),
          layer: String(data?.layer || ""),
          x: Number.isFinite(rawX) ? Math.trunc(rawX) : null,
          y: Number.isFinite(rawY) ? Math.trunc(rawY) : null,
          block_type: clampString(data?.block_type || ""),
          error: errorToCrashDetails(error),
          runtime: getCrashRuntimeState(),
        };
        writeCrashReport("world_block_update_exception", details);
        console.warn("[world_block_update_exception]", error && error.stack ? error.stack : error);
        sendActionRejected(socket, "world_block_update", "Block update failed safely. Check crash_reports.log for details.", {
          request_id: requestId,
          reason: "exception",
          world: details.world,
          action: details.action,
          x: details.x,
          y: details.y,
          block_type: details.block_type,
        });
      }
      return;
    }

    if (data.type === "world_seed_update") {
      if (!requireAuthenticated(socket, player, "edit worlds")) return;

      const worldName = cleanWorld(data.world || player.world || "START");
      if (!requireSameWorld(socket, player, worldName, "edit that world")) return;
      if (await rejectIfWorldBanned(socket, player, worldName, "world_seed_update")) return;
      if (!requireBuildPermission(socket, player, worldName, "edit this locked world")) return;

      const update = sanitizeSeedUpdate(data, worldName);
      if (!update) return;

      const validation = await validateSeedUpdateAgainstServerState(socket, player, worldName, update, makeRequestId(data));
      if (!validation.ok) return;

      const seedTransactionId = makeAuditId("seed");
      applySeedUpdateToWorldState(worldName, update);
      queueWorldSave(worldName);
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update, validation.playerState ? {
        username: player.account_username,
        player_data: validation.playerState,
      } : null);
      logWorldChange(socket, player, {
        source_type: "world_seed_update",
        source_id: seedTransactionId,
        world: worldName,
        action: update.action,
        layer: "seed",
        x: update.x,
        y: update.y,
        block_type: update.seed_type,
        details: {
          seed_type: update.seed_type,
          mutated: Boolean(update.mutated),
        },
      });
      if (update.action === "place" && validation.playerState) {
        logItemLedgerForState(socket, player, player.account_username, validation.playerState, update.seed_type, "seed", -1, "world_seed_place", seedTransactionId, "seed_plant_cost", worldName, {
          x: update.x,
          y: update.y,
        }, { skipPostgres: validation.postgres_committed });
      }

      if (validation.playerState) {
        sendInventoryTransactionResult(socket, {
          ok: true,
          action: "world_seed_place",
          message: "",
          username: player.account_username,
          player_data: validation.playerState,
        });
      }
      return;
    }

    if (data.type === "world_interaction_update") {
      if (!requireAuthenticated(socket, player, "edit worlds")) return;

      const worldName = cleanWorld(data.world || player.world || "START");
      if (!requireSameWorld(socket, player, worldName, "edit that world")) return;
      if (await rejectIfWorldBanned(socket, player, worldName, "world_interaction_update")) return;

      const update = sanitizeInteractionUpdate(data, worldName);
      if (!update) return;

      if (update.action === "springboard_animation") {
        if (!prepareSpringboardAnimationUpdate(socket, player, worldName, update)) return;
        broadcastToWorld(worldName, update, player.id);
        touchLivePresence(socket, player);
        return;
      }

      if (update.action === "entrance_pass") {
        if (!prepareEntrancePassUpdate(socket, player, worldName, update)) return;
        broadcastToWorld(worldName, update, player.id);
        touchLivePresence(socket, player);
        return;
      }

      if (update.action === "entrance_gate_move") {
        if (!requireBuildPermission(socket, player, worldName, "move the Entrance Gate")) return;
        await handleEntranceGateMoveUpdate(socket, player, worldName, update, makeRequestId(data));
        return;
      }

      if (update.action === "wooden_entrance_state") {
        if (!prepareWoodenEntranceStateUpdate(socket, player, worldName, update)) return;
      } else if (update.action === "door_state") {
        if (!prepareDoorStateUpdate(socket, player, worldName, update)) return;
      } else if (update.action === "ceiling_lamp_state") {
        if (!requireBuildPermission(socket, player, worldName, "toggle this lamp")) return;
        if (!prepareToggleBlockStateUpdate(socket, player, worldName, update, "ceiling_lamp_state")) return;
      } else if (update.action === "world_lock_state") {
        if (!prepareWorldLockStateUpdate(socket, player, worldName, update)) return;
      } else if (!requireBuildPermission(socket, player, worldName, "edit this locked world")) {
        return;
      }

      const interactionSourceId = makeAuditId("interact");
      const previousWorldState = serializeWorldState(worldName);
      const objectBefore = getWorldObjectJournalData(worldName, update);
      applyInteractionUpdateToWorldState(worldName, update);
      const objectAfter = getWorldObjectJournalData(worldName, update);
      const interactionDetails = buildWorldInteractionDetails(update);
      const worldObjectChangeEntry = buildWorldObjectChangeEntry(
        socket,
        player,
        worldName,
        update,
        objectBefore,
        objectAfter,
        interactionSourceId,
        interactionDetails
      );
      const worldCommit = await commitWorldStateWithBlockChanges(worldName, [worldObjectChangeEntry]);
      if (!worldCommit.ok) {
        worldStates.set(cleanWorld(worldName), deserializeWorldState(worldName, previousWorldState));
        sendActionRejected(socket, "world_interaction_update", worldCommit.message || "PostgreSQL rejected the world update.");
        return;
      }
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
      if (update.action === "door_state") {
        await maybeApplyReciprocalDoorLink(socket, player, worldName, update);
      }
      logWorldChange(socket, player, worldObjectChangeEntry, { skipPostgres: worldCommit.postgres_committed });
      return;
    }

    if (data.type === "world_item_drop_create" || data.type === "world_drop_create") {
      if (!requireAuthenticated(socket, player, "edit drops")) return;

      const worldName = cleanWorld(data.world || player.world || "START");
      if (!requireSameWorld(socket, player, worldName, "create drops in that world")) return;
      if (await rejectIfWorldBanned(socket, player, worldName, "world_item_drop_create")) return;

      const update = sanitizeDropCreate(data, worldName);
      if (!update) return;
      if (!validateDropCreateAgainstServerState(socket, player, update)) return;

      const spendResult = await spendServerInventoryCost(player.account_username, {
        item_id: update.item_type,
        item_category: update.item_category,
        amount: update.amount,
      }, {
        socket,
        player,
        source: "drop_inventory",
        action: "world_item_drop_create",
        reason: "drop_from_inventory",
        request_id: makeRequestId(data),
        world: worldName,
        metadata: { drop_id: update.drop_id, x: update.x, y: update.y },
      });
      if (!spendResult.ok) {
        sendActionRejected(socket, "world_item_drop_create", spendResult.message);
        return;
      }

      const dropTransactionId = makeAuditId("drop");
      applyDropCreateToWorldState(worldName, update);
      queueWorldSave(worldName);
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update, {
        username: player.account_username,
        player_data: spendResult.state,
      });
      logWorldChange(socket, player, {
        source_type: "world_item_drop_create",
        source_id: dropTransactionId,
        world: worldName,
        action: "drop_create",
        x: update.x,
        y: update.y,
        block_type: update.item_type,
        details: {
          drop_id: update.drop_id,
          item_category: update.item_category,
          amount: update.amount,
        },
      });
      logItemLedgerForState(socket, player, player.account_username, spendResult.state, update.item_type, update.item_category, -update.amount, "world_item_drop_create", dropTransactionId, "drop_from_inventory", worldName, {
        drop_id: update.drop_id,
      }, { skipPostgres: spendResult.postgres_committed });
      sendInventoryTransactionResult(socket, {
        ok: true,
        action: "world_item_drop_create",
        message: "",
        username: player.account_username,
        player_data: spendResult.state,
      });
      return;
    }

    if (data.type === "world_item_drop_update" || data.type === "world_drop_update") {
      if (!requireAuthenticated(socket, player, "edit drops")) return;

      const worldName = cleanWorld(data.world || player.world || "START");
      if (!requireSameWorld(socket, player, worldName, "edit drops in that world")) return;
      if (await rejectIfWorldBanned(socket, player, worldName, "world_item_drop_update")) return;
      if (!requireBuildPermission(socket, player, worldName, "edit drops in this locked world")) return;

      const update = sanitizeDropUpdate(data, worldName);
      if (!update) return;
      if (!validateDropUpdateAgainstServerState(socket, player, worldName, update)) return;

      applyDropUpdateToWorldState(worldName, update);
      queueWorldSave(worldName);
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
      logWorldChange(socket, player, {
        source_type: "world_item_drop_update",
        source_id: makeAuditId("drop"),
        world: worldName,
        action: "drop_update",
        details: {
          drop_id: update.drop_id,
        },
      });
      return;
    }

    if (
      data.type === "world_item_drop_pickup" ||
      data.type === "world_item_drop_remove" ||
      data.type === "world_drop_pickup" ||
      data.type === "world_drop_remove"
    ) {
      if (!requireAuthenticated(socket, player, "pick up drops")) return;

      const worldName = getPlayerCurrentWorldName(player);
      if (await rejectIfWorldBanned(socket, player, worldName, "world_item_drop_pickup")) return;

      const update = sanitizeDropPickup(data, worldName, player);
      if (!update) return;
      const dropActionKey = `${worldName}:${update.drop_id}`;
      const dropLock = await acquireLiveActionLock(worldDropActionLocks, "drop", dropActionKey, player.id);
      if (!dropLock.acquired) {
        sendActionRejected(socket, "world_item_drop_pickup", "That drop is not available.", {
          drop_id: update.drop_id,
          world: worldName,
        });
        return;
      }

      debugActionPositionFlow("world_item_drop_pickup request start", player, {
        drop_id: update.drop_id,
      });

      if (update.action_position && acceptPlayerMovement(socket, player, update.action_position, { silent: true })) {
        player.x = update.action_position.x;
        player.y = update.action_position.y;
        player.facing = update.action_position.facing;
      }

      let inventoryLocks = null;
      try {
        const pickupPlan = prepareDropPickup(worldName, player, update);
        if (!pickupPlan.ok) {
          if (pickupPlan.reason === "inventory_full") {
            logDropPickupInventoryIssue("inventory_full", player, worldName, update.drop_id, pickupPlan);
            sendActionRejected(socket, "world_item_drop_pickup", "Inventory full.", {
              drop_id: update.drop_id,
              world: worldName,
            });
            return;
          }
          if (pickupPlan.reason === "inventory_unavailable") {
            logDropPickupInventoryIssue("inventory_unavailable", player, worldName, update.drop_id, pickupPlan);
            sendActionRejected(socket, "world_item_drop_pickup", "Could not add that item to your server inventory.", {
              drop_id: update.drop_id,
              world: worldName,
            });
            return;
          }
          if (pickupPlan.reason === "too_far") {
            logDropPickupTooFar(player, worldName, update.drop_id, pickupPlan.drop, update);
            sendActionRejected(socket, "world_item_drop_pickup", "Too far away from that drop.", {
              drop_id: update.drop_id,
              world: worldName,
            });
            return;
          }
          logDropPickupNotAvailable(player, worldName, update.drop_id);
          sendActionRejected(socket, "world_item_drop_pickup", "That drop is not available.", {
            drop_id: update.drop_id,
            world: worldName,
          });
          return;
        }

        inventoryLocks = await acquirePlayerInventoryLocks([player.account_username], `drop:${worldName}:${update.drop_id}`);
        if (!inventoryLocks.acquired) {
          sendActionRejected(socket, "world_item_drop_pickup", "Your inventory is busy. Try again.", {
            drop_id: update.drop_id,
            world: worldName,
          });
          return;
        }

        const pickupTransactionId = makeAuditId("pickup");
        const pickupTransaction = await postgresStore.applyDropPickupTransaction({
          account_username: player.account_username,
          item_type: pickupPlan.item_type,
          item_category: pickupPlan.item_category,
          amount: pickupPlan.pickedAmount,
          expected_before_amount: getInventoryCount(pickupPlan.playerState, pickupPlan.item_type, pickupPlan.item_category),
          stack_limit: ItemDatabase.getStackLimit(pickupPlan.item_type),
          allow_state_repair: false,
          world: worldName,
          drop_id: update.drop_id,
          source_id: pickupTransactionId,
          request_id: makeRequestId(data),
          correlation_id: makeAuditId("pickup"),
          ip_address: getSocketAddress(socket),
          at: new Date().toISOString(),
        });
        if (!pickupTransaction.ok) {
          logDropPickupInventoryIssue("transaction_failed", player, worldName, update.drop_id, pickupPlan, pickupTransaction);
          if (pickupTransaction.reason === "insufficient_capacity") {
            sendActionRejected(socket, "world_item_drop_pickup", "Could not add that item to your server inventory.", {
              drop_id: update.drop_id,
              world: worldName,
            });
            return;
          }
          logDropPickupNotAvailable(player, worldName, update.drop_id);
          sendActionRejected(socket, "world_item_drop_pickup", "That drop is not available.", {
            drop_id: update.drop_id,
            world: worldName,
          });
          return;
        }

        const pickupState = pickupPlan.playerState;
        if (!setInventoryCountInState(pickupState, pickupTransaction.item_type, pickupTransaction.item_category, pickupTransaction.after_amount)) {
          logDropPickupInventoryIssue("state_update_failed", player, worldName, update.drop_id, pickupPlan, pickupTransaction);
          sendActionRejected(socket, "world_item_drop_pickup", "Could not add that item to your server inventory.", {
            drop_id: update.drop_id,
            world: worldName,
          });
          return;
        }

        const pickupUpdate = applyDropPickupWorldState(worldName, pickupPlan);
        if (!pickupUpdate.ok) {
          // If world state drifted between planning and update, keep the inventory change.
          // We still let the server stay authoritative on inventory and avoid dropping state transitions into a bad path.
          console.warn("[world_drop_pickup_world_state_miss]", {
            username: cleanAccountName(player?.account_username || player?.name || ""),
            world: worldName,
            drop_id: update.drop_id,
            reason: pickupUpdate.reason || "not_available",
          });
        }

        persistPlayerInventoryChange(player.account_username, pickupState);
        logWorldChange(socket, player, {
          source_type: "world_item_drop_pickup",
          source_id: pickupTransactionId,
          world: worldName,
          action: "drop_pickup",
          x: pickupPlan.drop.x,
          y: pickupPlan.drop.y,
          block_type: pickupPlan.item_type,
          details: {
            drop_id: pickupPlan.dropId || pickupPlan.drop?.drop_id || "",
            item_category: pickupPlan.item_category,
            amount: pickupPlan.pickedAmount,
            remaining: pickupPlan.remaining,
          },
        });
        logItemLedgerForState(socket, player, player.account_username, pickupState, pickupPlan.item_type, pickupPlan.item_category, pickupPlan.pickedAmount, "world_item_drop_pickup", pickupTransactionId, "drop_pickup", worldName, {
          drop_id: pickupPlan.dropId || pickupPlan.drop?.drop_id || "",
        }, { skipPostgres: true });
        sendInventoryTransactionResult(socket, {
          ok: true,
          action: "drop_pickup",
          message: `Picked up ${pickupPlan.pickedAmount} ${pickupPlan.item_type}.`,
          username: player.account_username,
          rewards: [{
            item_id: pickupPlan.item_type,
            item_category: pickupPlan.item_category,
            amount: pickupPlan.pickedAmount,
          }],
          player_data: pickupState,
        });

        queueWorldSave(worldName);
        if (pickupUpdate.ok && pickupUpdate.payload) {
          sendWorldUpdateToRequesterAndWorld(socket, player, worldName, pickupUpdate.payload, {
            username: player.account_username,
            player_data: pickupState,
          });
        }
        debugActionPositionFlow("world_item_drop_pickup request end", player, {
          drop_id: update.drop_id,
          item_type: pickupPlan.item_type,
          amount: pickupPlan.pickedAmount,
        });
      } finally {
        releasePlayerInventoryLocks(inventoryLocks);
        releaseLiveActionLock(dropLock);
      }
      return;
    }

      if (data.type === "player_punch") {
        handlePlayerPunch(socket, player, data);
        return;
      }

      if (data.type === "player_position") {
        if (!requireAuthenticated(socket, player, "move online")) return;

        player.name = player.account_username || player.name;

        const position = sanitizePlayerPosition(data, player);
        if (!position) return;
        if (!requireSameWorld(socket, player, position.world, "move in that world")) return;
        if (!acceptPlayerMovement(socket, player, position)) return;

        const previousEquipmentKey = JSON.stringify(player.equipment_slots || {});
        const previousAnimationState = String(player.animation_state || "idle");
        player.x = position.x;
        player.y = position.y;
        player.facing = position.facing;
        player.animation_state = sanitizePlayerAnimationState(data.animation_state);
        player.velocity_x = sanitizePlayerVelocity(data.velocity_x);
        player.velocity_y = sanitizePlayerVelocity(data.velocity_y);
        player.on_floor = data.on_floor !== false;
        player.in_water = position.in_water === true;
        player.in_lava_fire = position.in_lava_fire === true;
        const damageFlash = sanitizePlayerDamageFlash(data);
        player.damage_flash_expires_at = damageFlash.active ? Date.now() + damageFlash.remaining_ms : 0;
        player.damage_flash_token = damageFlash.token;
        refreshPlayerFishingPresence(player, position.world);

        if (data.equipment_slots && typeof data.equipment_slots === "object" && !Array.isArray(data.equipment_slots)) {
          player.equipment_slots = sanitizeEquipmentSlots(data.equipment_slots, player.account_username);
        } else {
          player.equipment_slots = sanitizeEquipmentSlots({
            hand: data.equipped_tool || "",
            back: data.equipped_back || "",
            hair: data.equipped_hair_item || "",
            shirt: data.equipped_shirt_item || "",
            pants: data.equipped_pants_item || "",
            shoes: data.equipped_shoes_item || "",
          }, player.account_username);
        }

        const nextEquipmentKey = JSON.stringify(player.equipment_slots || {});
        const animationChanged = previousAnimationState !== String(player.animation_state || "idle");
        const equipmentChanged = previousEquipmentKey !== nextEquipmentKey;
        if (equipmentChanged) {
          console.log("[APPEARANCE][Server] received equipment change", {
            player: player.account_username,
            world: player.world,
            equipment_slots: player.equipment_slots,
          });
        }
        if (animationChanged) {
          console.log("[APPEARANCE][Server] received animation state", {
            player: player.account_username,
            world: player.world,
            animation_state: player.animation_state,
            facing: player.facing,
          });
        }

        const presencePayload = buildPublicPlayerPresencePayload("player_position", player, position.world);
        queuePlayerPositionBroadcast(player.world, presencePayload, playerId);
        if (equipmentChanged || animationChanged) {
          console.log("[APPEARANCE][Server] broadcast appearance update", {
            player: player.account_username,
            world: player.world,
            animation_state: presencePayload.animation_state,
            equipment_slots: presencePayload.equipment_slots,
          });
        }
        touchLivePresence(socket, player);
        return;
      }
    } catch (error) {
      console.warn("[socket_message_error]", error.message);
    }
  });

  socket.on("close", () => {
    const player = players.get(playerId);
    const closedUsername = player ? player.account_username : "";
    if (player) {
      cancelActiveTradeForPlayer(playerId, "Trade canceled because a player disconnected.");
      activeFishingSessions.delete(playerId);
      clearPlayerFishingPresence(player);
      markAccountSeen(player.account_username);
      releaseActiveAccountSession(player);

      if (player.joined_world) {
        broadcastToWorld(player.world, buildPublicPlayerPresencePayload("player_left", player, player.world), playerId);

        broadcastSystemToWorld(player.world, `${player.name} left ${player.world}`, playerId);
      }
    }

    players.delete(playerId);
    if (closedUsername) {
      notifyOnlineFriendsOfFriendState(closedUsername);
    }
  });
});

function cleanName(value) {
  const clean = String(value || "Guest").trim();
  return clean.length > 0 ? clean : "Guest";
}

function cleanAccountName(value) {
  const clean = String(value || "").trim();
  return clean.length > 0 ? clean : "";
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanWorld(value) {
  const clean = String(value || "START").trim().toUpperCase().replace(/\s+/g, "_");
  const safe = clean.replace(/[^A-Z0-9_-]/g, "").slice(0, MAX_WORLD_NAME_LENGTH);
  return safe.length > 0 ? safe : "START";
}

function getPlayerCurrentWorldName(player) {
  if (!player) return "START";
  return cleanWorld(player.current_world_id || player.current_world || player.world || "START");
}

function safeFileName(value, fallback = "data") {
  const clean = String(value || fallback).trim().replace(/\s+/g, "_");
  const safe = clean.replace(/[^a-zA-Z0-9_-]/g, "");
  return safe.length > 0 ? safe : fallback;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sendHtml(response, statusCode, title, message) {
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

async function handleHttpRequest(request, response) {
  let url;
  try {
    url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  } catch (_error) {
    sendHtml(response, 400, "Bad Request", "That verification link is not valid.");
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    const redisHealth = await redisStore.getHealthSnapshot();
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({
      ok: true,
      service: "PixelManiaServer",
      server_client_version: SERVER_CLIENT_VERSION,
      min_client_version: MIN_CLIENT_VERSION,
      features: {
        world_update_requester_echo: true,
        world_update_requester_player_data: true,
      },
      persistence: {
        postgres_ready: postgresStore.isReady(),
        postgres_authoritative: Boolean(postgresStore.isReady() && POSTGRES_AUTHORITATIVE),
        redis_ready: redisStore.isReady(),
        redis_stats: redisHealth,
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
          running: worldSnapshotSchedulerRunning,
          last_run_at: worldSnapshotSchedulerState.last_run_at || null,
          last_duration_ms: worldSnapshotSchedulerState.last_duration_ms,
          last_world_count: worldSnapshotSchedulerState.last_world_count,
          last_error: worldSnapshotSchedulerState.last_error || "",
        },
        server_tick: getServerTickSnapshot(),
      },
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/verify-email") {
    const result = verifyEmailToken(url.searchParams.get("token") || "");
    sendHtml(response, result.ok ? 200 : 400, result.ok ? "Email Verified" : "Verification Failed", result.message);
    return;
  }

  sendHtml(response, 404, "PixelMania Server", "This server endpoint is for PixelMania account verification.");
}

async function bootstrapServer() {
  await redisStore.init();
  await postgresStore.init();
  await loadPersistentState();
  await recoverWorldEventsAfterLoad();
  startServerTickMonitor();
  startWorldEventRandomScheduler();
  startAntiDupeAuditScanner();
  startPeriodicWorldSnapshotScheduler();
  startHttpServer();
}

function startAntiDupeAuditScanner() {
  if (antiDupeAuditTimer || ANTI_DUPE_AUDIT_INTERVAL_MS <= 0) return;
  if (!postgresStore.isReady()) return;

  const runAudit = async () => {
    if (antiDupeAuditRunning || !postgresStore.isReady()) return;
    antiDupeAuditRunning = true;
    try {
      const result = await postgresStore.auditItemInstances({ limit: ANTI_DUPE_AUDIT_LIMIT });
      if (!result?.ok) {
        console.warn("[anti-dupe] item instance audit failed:", result?.reason || "unknown");
        return;
      }

      const totalIssues = clampInteger(result.summary?.total_issues || 0, 0, ANTI_DUPE_AUDIT_LIMIT);
      if (totalIssues > 0) {
        console.warn("[anti-dupe] item instance audit found issues", JSON.stringify({
          scanned_at: result.scanned_at,
          summary: result.summary,
          sample: Array.isArray(result.issues) ? result.issues.slice(0, 5) : [],
        }));
      } else if (ANTI_DUPE_AUDIT_LOG_CLEAN) {
        console.log("[anti-dupe] item instance audit clean.");
      }
    } catch (error) {
      console.warn("[anti-dupe] item instance audit crashed:", error.message);
    } finally {
      antiDupeAuditRunning = false;
    }
  };

  antiDupeAuditTimer = setInterval(runAudit, ANTI_DUPE_AUDIT_INTERVAL_MS);
  if (typeof antiDupeAuditTimer.unref === "function") antiDupeAuditTimer.unref();
  const firstAuditTimer = setTimeout(runAudit, 10000);
  if (typeof firstAuditTimer.unref === "function") firstAuditTimer.unref();
}

function selectWorldsForSnapshotCycle(loadedWorldNames) {
  const worlds = Array.isArray(loadedWorldNames) ? loadedWorldNames.filter(Boolean) : [];
  if (worlds.length === 0) return [];

  const maxWorlds = WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE;
  if (maxWorlds <= 0 || maxWorlds >= worlds.length) {
    worldSnapshotSchedulerCursor = 0;
    return worlds;
  }

  const selected = [];
  const startIndex = worldSnapshotSchedulerCursor % worlds.length;
  for (let i = 0; i < maxWorlds; i += 1) {
    selected.push(worlds[(startIndex + i) % worlds.length]);
  }
  worldSnapshotSchedulerCursor = (startIndex + maxWorlds) % worlds.length;
  return selected;
}

function startPeriodicWorldSnapshotScheduler() {
  if (WORLD_SNAPSHOT_INTERVAL_MS <= 0) {
    worldSnapshotSchedulerState.enabled = false;
    return;
  }
  if (worldSnapshotSchedulerTimer) return;
  worldSnapshotSchedulerState.enabled = true;

  const runSnapshotCycle = async () => {
    if (worldSnapshotSchedulerRunning) return;
    worldSnapshotSchedulerRunning = true;
    const startedAt = Date.now();
    worldSnapshotSchedulerState.last_error = "";
    worldSnapshotSchedulerState.last_run_at = new Date(startedAt).toISOString();

    try {
      const loadedWorldNames = Array.from(worldStates.keys()).sort((a, b) => a.localeCompare(b));
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
          await waitForPersistenceWrites();
        } else {
          failedCount += 1;
        }
      }

      worldSnapshotSchedulerState.last_world_count = createdCount;
      if (failedCount > 0) {
        worldSnapshotSchedulerState.last_error = `some_world_snapshots_failed_${failedCount}`;
        console.warn("[snapshot] periodic world checkpoint completed with failures", {
          scheduled_worlds: loadedWorldNames.length,
          processed_worlds: scheduledWorldNames.length,
          created: createdCount,
          failed: failedCount,
        });
      }
    } catch (error) {
      worldSnapshotSchedulerState.last_error = cleanText(error?.message || error || "unknown");
      console.warn("[snapshot] periodic world checkpoint failed:", worldSnapshotSchedulerState.last_error);
    } finally {
      worldSnapshotSchedulerState.last_duration_ms = Date.now() - startedAt;
      worldSnapshotSchedulerRunning = false;
    }
  };

  worldSnapshotSchedulerTimer = setInterval(() => {
    runSnapshotCycle().catch((error) => {
      worldSnapshotSchedulerState.last_error = cleanText(error?.message || error || "unknown");
      console.warn("[snapshot] periodic world checkpoint task failed:", worldSnapshotSchedulerState.last_error);
    });
  }, WORLD_SNAPSHOT_INTERVAL_MS);

  if (typeof worldSnapshotSchedulerTimer.unref === "function") worldSnapshotSchedulerTimer.unref();
  if (WORLD_SNAPSHOT_STARTUP_RUN) {
    const startupDelayMs = Math.min(60_000, WORLD_SNAPSHOT_INTERVAL_MS);
    const startupTimer = setTimeout(() => {
      runSnapshotCycle().catch((error) => {
        worldSnapshotSchedulerState.last_error = cleanText(error?.message || error || "unknown");
        console.warn("[snapshot] periodic world checkpoint startup run failed:", worldSnapshotSchedulerState.last_error);
      });
    }, startupDelayMs);
    if (typeof startupTimer.unref === "function") startupTimer.unref();
  }
  console.log(`[snapshot] periodic world checkpoint every ${WORLD_SNAPSHOT_INTERVAL_MINUTES} minute(s), max ${WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE || "all"} world(s) per cycle.`);
}

function startHttpServer() {
  httpServer.listen(PORT, HOST, () => {
    console.log(`PixelMania server listening privately at ws://${HOST}:${PORT}`);
    console.log(`PixelMania public HTTPS base: ${PUBLIC_BASE_URL}`);
    console.log(`PixelMania public WSS endpoint: ${PUBLIC_WS_URL}`);
    console.log(`PixelMania email verification running at ${PUBLIC_BASE_URL}/verify-email`);
    if (postgresStore.isReady() && POSTGRES_AUTHORITATIVE) {
      console.log(`PixelMania persistence: PostgreSQL authoritative (schema=${POSTGRES_SCHEMA}).`);
    } else if (POSTGRES_ENABLED) {
      console.warn("PixelMania persistence: PostgreSQL is enabled but not ready; using JSON fallback.");
    } else {
      console.warn("PixelMania persistence: JSON fallback is active because POSTGRES_ENABLED=false.");
    }
    if (redisStore.isReady()) {
      console.log("PixelMania live cache: Redis enabled.");
    } else if (REDIS_ENABLED) {
      console.warn("PixelMania live cache: Redis is enabled but not ready; using in-memory live state.");
    } else {
      console.warn("PixelMania live cache: in-memory only because REDIS_ENABLED=false.");
    }
    if (HOST === "0.0.0.0" || HOST === "::") {
      console.warn("HOST is bound to all interfaces. Keep port 8080 blocked by firewall unless this is intentional.");
    }
    if (!SMTP_HOST) {
      console.warn("SMTP_HOST is not set. Verification links will be printed to the server console instead of emailed.");
    }
  });
}

function ensureDataFolders() {
  fs.mkdirSync(WORLD_SAVE_FOLDER, { recursive: true });
  fs.mkdirSync(PLAYER_SAVE_FOLDER, { recursive: true });
  fs.mkdirSync(path.dirname(ADMIN_LOG_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(CRASH_REPORT_PATH), { recursive: true });
  fs.mkdirSync(INTEGRITY_LOG_FOLDER, { recursive: true });
  fs.mkdirSync(WORLD_SNAPSHOT_FOLDER, { recursive: true });
  migrateLegacyDataFolders();
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Could not read ${filePath}:`, error.message);
    backupCorruptJsonFile(filePath);
    return null;
  }
}

function backupCorruptJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
  } catch (error) {
    console.warn(`Could not back up corrupt JSON ${filePath}:`, error.message);
  }
}

function writeJsonFileAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

async function writeJsonFileAtomicAsync(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.promises.unlink(tempPath);
    } catch (_unlinkError) {
      // Best effort cleanup for failed async temp writes.
    }
    throw error;
  }
}

function trackPersistenceWrite(promise, label = "persistence write") {
  if (!promise || typeof promise.then !== "function") return promise;

  const tracked = Promise.resolve(promise)
    .catch((error) => {
      console.warn(`[persistence] ${label} failed:`, error.message);
    })
    .finally(() => {
      pendingPersistenceWrites.delete(tracked);
    });

  pendingPersistenceWrites.add(tracked);
  return tracked;
}

async function waitForPersistenceWrites() {
  if (pendingPersistenceWrites.size === 0) return;
  await Promise.allSettled(Array.from(pendingPersistenceWrites));
}

function getJsonSavedAtTime(filePath) {
  const data = readJsonFile(filePath);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const savedAt = Date.parse(String(data.saved_at || data.updated_at || ""));
    if (Number.isFinite(savedAt)) return savedAt;

    const playerSavedAt = Date.parse(String(data.player_data?.saved_at || ""));
    if (Number.isFinite(playerSavedAt)) return playerSavedAt;
  }

  try {
    return fs.statSync(filePath).mtimeMs;
  } catch (_error) {
    return 0;
  }
}

function getCountDictionaryScore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;

  let score = 0;
  for (const rawCount of Object.values(value)) {
    const count = Number(rawCount);
    if (Number.isFinite(count) && count > 0) {
      score += count;
    }
  }
  return score;
}

function getJsonContentScore(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return 0;

  const playerData = data.player_data && typeof data.player_data === "object" ? data.player_data : data;
  const playerInventoryScore = [
    "inventory",
    "seed_inventory",
    "tool_inventory",
    "back_inventory",
    "hair_inventory",
    "shirt_inventory",
    "pants_inventory",
    "shoes_inventory",
    "currency_inventory",
    "material_inventory",
    "lure_inventory",
    "fish_inventory",
  ].reduce((total, field) => total + getCountDictionaryScore(playerData[field]), 0);
  if (playerInventoryScore > 0) return playerInventoryScore;

  const worldScore = [
    "foreground",
    "blocks",
    "background",
    "background_blocks",
    "removed_foreground",
    "removed_background",
    "seeds",
    "planted_seeds",
    "interactions",
    "drops",
    "item_drops",
  ].reduce((total, field) => total + (Array.isArray(data[field]) ? data[field].length : 0), 0);
  if (worldScore > 0) return worldScore;

  if (Array.isArray(data.accounts)) return data.accounts.length;
  return 0;
}

function copyJsonIfMissingOrNewer(sourcePath, targetPath, label) {
  if (!fs.existsSync(sourcePath)) return;

  const sourceData = readJsonFile(sourcePath);
  if (!sourceData) return;

  if (fs.existsSync(targetPath)) {
    const targetData = readJsonFile(targetPath);
    const sourceTime = getJsonSavedAtTime(sourcePath);
    const targetTime = getJsonSavedAtTime(targetPath);
    const sourceScore = getJsonContentScore(sourceData);
    const targetScore = getJsonContentScore(targetData);
    const targetLooksLikeEmptyPlaceholder = targetScore <= 5 && sourceScore > targetScore + 5;
    if (targetTime >= sourceTime && !targetLooksLikeEmptyPlaceholder) return;

    const backupPath = `${targetPath}.pre-migration-${Date.now()}`;
    fs.copyFileSync(targetPath, backupPath);
    console.warn(`PixelManiaServer data migration backed up older ${label}: ${backupPath}`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  console.warn(`PixelManiaServer data migration copied ${label}: ${sourcePath} -> ${targetPath}`);
}

function copyJsonFolderIfMissingOrNewer(sourceFolder, targetFolder, label) {
  if (!fs.existsSync(sourceFolder)) return;

  let entries = [];
  try {
    entries = fs.readdirSync(sourceFolder, { withFileTypes: true });
  } catch (error) {
    console.warn(`Could not scan legacy ${label} folder ${sourceFolder}:`, error.message);
    return;
  }

  fs.mkdirSync(targetFolder, { recursive: true });
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
    copyJsonIfMissingOrNewer(
      path.join(sourceFolder, entry.name),
      path.join(targetFolder, entry.name),
      `${label} file`
    );
  }
}

function migrateLegacyDataFolders() {
  for (const legacyFolder of LEGACY_DATA_FOLDERS) {
    if (!fs.existsSync(legacyFolder)) continue;

    copyJsonIfMissingOrNewer(
      path.join(legacyFolder, "accounts.json"),
      ACCOUNTS_SAVE_PATH,
      "accounts file"
    );
    copyJsonFolderIfMissingOrNewer(
      path.join(legacyFolder, "worlds"),
      WORLD_SAVE_FOLDER,
      "worlds"
    );
    copyJsonFolderIfMissingOrNewer(
      path.join(legacyFolder, "players"),
      PLAYER_SAVE_FOLDER,
      "players"
    );
  }
}

function getWorldSavePath(worldName) {
  return path.join(WORLD_SAVE_FOLDER, `${safeFileName(cleanWorld(worldName), "START")}.json`);
}

function getPlayerSavePath(username) {
  return path.join(PLAYER_SAVE_FOLDER, `${safeFileName(cleanAccountName(username).toLowerCase(), "guest")}.json`);
}

function isPostgresAuthoritativeReady() {
  return Boolean(POSTGRES_AUTHORITATIVE && postgresStore.isReady());
}

async function loadPersistentState() {
  loadAccountsFromJson();
  const jsonAccounts = new Map(accounts);

  if (!isPostgresAuthoritativeReady()) {
    return;
  }

  const dbAccounts = await postgresStore.loadAccountStates();
  if (dbAccounts.length > 0) {
    accounts.clear();
    for (const rawAccount of dbAccounts) {
      const account = sanitizeAccountState(rawAccount);
      if (account) accounts.set(accountKey(account.username), account);
    }
    console.log(`[postgres] loaded ${accounts.size} account(s) from PostgreSQL.`);
    const missingAccounts = [];
    for (const [key, account] of jsonAccounts.entries()) {
      if (accounts.has(key)) continue;
      accounts.set(key, account);
      missingAccounts.push(account);
    }
    if (missingAccounts.length > 0) {
      await postgresStore.saveAccountStates(missingAccounts);
      console.log(`[postgres] imported ${missingAccounts.length} missing JSON account(s) into PostgreSQL.`);
    }
  } else if (accounts.size > 0) {
    await postgresStore.saveAccountStates(Array.from(accounts.values()));
    console.log(`[postgres] imported ${accounts.size} JSON account(s) into PostgreSQL.`);
  }

  const dbPlayers = await postgresStore.loadPlayerStates();
  if (dbPlayers.length > 0) {
    playerStates.clear();
    for (const entry of dbPlayers) {
      const state = sanitizePlayerState(entry.state || {}, entry.username || "");
      if (state) playerStates.set(accountKey(state.account_username), state);
    }
    console.log(`[postgres] loaded ${playerStates.size} player state(s) from PostgreSQL.`);
    const missingPlayers = [];
    for (const state of readPlayerStatesFromJsonFolder()) {
      const key = accountKey(state.account_username);
      if (playerStates.has(key)) continue;
      playerStates.set(key, state);
      missingPlayers.push({ username: state.account_username, state });
    }
    if (missingPlayers.length > 0) {
      await postgresStore.savePlayerStates(missingPlayers);
      console.log(`[postgres] imported ${missingPlayers.length} missing JSON player state(s) into PostgreSQL.`);
    }
  } else {
    const importedPlayers = loadPlayerStatesFromJsonFolder();
    if (importedPlayers > 0) {
      await postgresStore.savePlayerStates(Array.from(playerStates.values()).map((state) => ({
        username: state.account_username,
        state,
      })));
      console.log(`[postgres] imported ${importedPlayers} JSON player state(s) into PostgreSQL.`);
    }
  }

  const itemInstanceReconcile = await postgresStore.reconcileStoredItemInstancesFromPlayerStates();
  if (itemInstanceReconcile.ok && itemInstanceReconcile.player_count > 0) {
    console.log(`[postgres] reconciled item instances for ${itemInstanceReconcile.player_count} player state(s).`);
  }

  const dbWorlds = await postgresStore.loadWorldStates();
  if (dbWorlds.length > 0) {
    worldStates.clear();
    for (const entry of dbWorlds) {
      const cleanWorldName = cleanWorld(entry.world_name || entry.state?.world_name || "START");
      worldStates.set(cleanWorldName, deserializeWorldState(cleanWorldName, entry.state || {}));
    }
    console.log(`[postgres] loaded ${worldStates.size} world state(s) from PostgreSQL.`);
    const missingWorlds = [];
    for (const entry of readWorldStatesFromJsonFolder()) {
      if (worldStates.has(entry.worldName)) continue;
      worldStates.set(entry.worldName, entry.state);
      missingWorlds.push(entry.worldName);
    }
    for (const worldName of missingWorlds) {
      await postgresStore.saveWorldState(worldName, serializeWorldState(worldName));
    }
    if (missingWorlds.length > 0) {
      console.log(`[postgres] imported ${missingWorlds.length} missing JSON world state(s) into PostgreSQL.`);
    }
  } else {
    const importedWorlds = loadWorldStatesFromJsonFolder();
    for (const [worldName] of worldStates.entries()) {
      const serialized = serializeWorldState(worldName);
      await postgresStore.saveWorldState(worldName, serialized);
    }
    if (importedWorlds > 0) {
      console.log(`[postgres] imported ${importedWorlds} JSON world state(s) into PostgreSQL.`);
    }
  }
}

function listJsonFiles(folder) {
  try {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
      .map((entry) => path.join(folder, entry.name));
  } catch (error) {
    console.warn(`Could not scan ${folder}:`, error.message);
    return [];
  }
}

function readPlayerStatesFromJsonFolder() {
  const states = [];
  for (const filePath of listJsonFiles(PLAYER_SAVE_FOLDER)) {
    const data = readJsonFile(filePath);
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;

    const fallbackUsername = path.basename(filePath, ".json");
    const state = sanitizePlayerState(data.player_data || data, data.username || fallbackUsername);
    if (!state) continue;

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
    const data = readJsonFile(filePath);
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;

    const worldName = cleanWorld(data.world_name || path.basename(filePath, ".json"));
    states.push({
      worldName,
      state: deserializeWorldState(worldName, data),
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

function makeRequestId(data) {
  return String(data.request_id || "").trim();
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeoutPromise,
  ]);
}

function makeMessageIdempotencyScope(data) {
  const type = String(data?.type || "").trim();
  if (type === "") return "";

  if (type === "inventory_transaction_request") {
    const action = String(data?.action || "").trim().toLowerCase() || "unknown";
    return `${type}:${action}`;
  }
  if (type === "world_block_update") {
    const action = String(data?.action || "").trim().toLowerCase() || "unknown";
    return `${type}:${action}`;
  }
  if (type === "world_seed_update" || type === "world_interaction_update") {
    const action = String(data?.action || "").trim().toLowerCase() || "unknown";
    return `${type}:${action}`;
  }
  if (
    type === "world_item_drop_create" ||
    type === "world_drop_create" ||
    type === "world_item_drop_update" ||
    type === "world_drop_update" ||
    type === "world_item_drop_pickup" ||
    type === "world_drop_pickup" ||
    type === "world_item_drop_remove" ||
    type === "world_drop_remove"
  ) {
    return type;
  }
  if (
    type === "trade_request" ||
    type === "trade_response" ||
    type === "trade_offer_update" ||
    type === "trade_confirm" ||
    type === "trade_final_confirm" ||
    type === "trade_cancel"
  ) {
    return type;
  }
  if (type === "account_register" || type === "account_login" || type === "account_token_login") {
    return type;
  }
  if (type === "pull_player_request") {
    return type;
  }
  if (type === "door_enter") {
    return type;
  }
  return "";
}

function makeMessageIdempotencyKey(player, data, scope) {
  const requestId = makeRequestId(data);
  if (requestId === "") return "";

  const username = cleanAccountName(player?.account_username || data?.username || data?.account_username || "");
  if (username === "") return "";

  const worldName = cleanWorld(data?.world || player?.world || "START");
  return `${username}:${scope}:${worldName}:${requestId}`;
}

function sendDuplicateRequestNotice(socket, data) {
  const type = String(data?.type || "").trim();
  const requestId = makeRequestId(data);

  if (type === "inventory_transaction_request") {
    sendInventoryTransactionRejected(socket, data, "Duplicate request ignored.");
    return;
  }

  if (
    type === "trade_request" ||
    type === "trade_response" ||
    type === "trade_offer_update" ||
    type === "trade_confirm" ||
    type === "trade_final_confirm" ||
    type === "trade_cancel"
  ) {
    sendJson(socket, {
      type: "trade_error",
      trade_id: String(data?.trade_id || ""),
      message: "Duplicate request ignored.",
      request_id: requestId,
    });
    return;
  }

  sendActionRejected(socket, type || "request", "Duplicate request ignored.", {
    request_id: requestId,
  });
}

async function enforceMessageIdempotency(socket, player, data) {
  if (!postgresStore.isReady()) return true;

  const scope = makeMessageIdempotencyScope(data);
  if (scope === "") return true;

  const key = makeMessageIdempotencyKey(player, data, scope);
  if (key === "") return true;

  const claim = await postgresStore.claimIdempotency(
    scope,
    key,
    cleanAccountName(player?.account_username || data?.username || data?.account_username || ""),
    {
      type: String(data?.type || ""),
      action: String(data?.action || ""),
      request_id: makeRequestId(data),
      world: cleanWorld(data?.world || player?.world || "START"),
      trade_id: String(data?.trade_id || ""),
      drop_id: String(data?.drop_id || ""),
    }
  );

  if (!claim.ok) return true;
  if (!claim.duplicate) return true;

  sendDuplicateRequestNotice(socket, data);
  return false;
}

function getClientVersion(data) {
  return String(data.client_version || data.version || "").trim();
}

function parseVersionParts(value) {
  const clean = String(value || "").trim().replace(/^v/i, "");
  if (clean === "") return null;

  const core = clean.split(/[+-]/)[0];
  const parts = core.split(".").map((part) => {
    const match = String(part || "").match(/^\d+/);
    return match ? Number(match[0]) : 0;
  });

  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return null;
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function compareVersions(a, b) {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  if (!left || !right) return null;

  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function isClientVersionAllowed(clientVersion) {
  const comparison = compareVersions(clientVersion, MIN_CLIENT_VERSION);
  return comparison !== null && comparison >= 0;
}

function sendClientUpdateRequired(socket, data, clientVersion = "") {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  sendJson(socket, {
    type: "client_update_required",
    ok: false,
    request_id: makeRequestId(data || {}),
    client_version: String(clientVersion || ""),
    server_client_version: SERVER_CLIENT_VERSION,
    min_client_version: MIN_CLIENT_VERSION,
    update_url: UPDATE_URL,
    message: `This PixelMania version is out of date. Please update to version ${MIN_CLIENT_VERSION} or newer.`,
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function makeAuditHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex");
}

function validateUsername(value) {
  const username = cleanAccountName(value);
  if (username.length < MIN_USERNAME_LENGTH) {
    return { ok: false, message: `Username must be at least ${MIN_USERNAME_LENGTH} characters.` };
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return { ok: false, message: `Username must be ${MAX_USERNAME_LENGTH} characters or less.` };
  }
  if (!/^[A-Za-z0-9_]+$/.test(username)) {
    return { ok: false, message: "Use letters, numbers, and underscore only." };
  }
  return { ok: true, username };
}

function validateEmail(value) {
  const email = cleanEmail(value);
  if (email === "") {
    return { ok: false, message: "Enter an email address." };
  }
  if (email.includes(" ")) {
    return { ok: false, message: "Email cannot contain spaces." };
  }
  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) {
    return { ok: false, message: "Enter a valid email address." };
  }
  const domain = email.slice(atIndex + 1);
  if (domain.length < 3 || domain.indexOf(".") <= 0 || domain.endsWith(".")) {
    return { ok: false, message: "Enter a valid email address." };
  }
  return { ok: true, email };
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return { ok: true, password };
}

function parsePasswordHashAlgorithm(algorithm = "") {
  const raw = String(algorithm || "").trim().toLowerCase();
  if (!raw || raw === "scrypt" || raw === "legacy_scrypt") {
    return {
      name: "scrypt",
      N: 16384,
      r: 8,
      p: 1,
      keylen: 64,
      algorithm: "legacy_scrypt",
    };
  }

  const match = raw.match(/^scrypt:n=(\d+),r=(\d+),p=(\d+),keylen=(\d+)$/);
  if (!match) {
    return {
      name: "scrypt",
      N: PASSWORD_SCRYPT_N,
      r: PASSWORD_SCRYPT_R,
      p: PASSWORD_SCRYPT_P,
      keylen: PASSWORD_SCRYPT_KEYLEN,
      algorithm: PASSWORD_HASH_ALGORITHM,
    };
  }

  return {
    name: "scrypt",
    N: Math.max(16384, Math.trunc(Number(match[1]) || PASSWORD_SCRYPT_N)),
    r: Math.max(8, Math.trunc(Number(match[2]) || PASSWORD_SCRYPT_R)),
    p: Math.max(1, Math.trunc(Number(match[3]) || PASSWORD_SCRYPT_P)),
    keylen: Math.max(32, Math.trunc(Number(match[4]) || PASSWORD_SCRYPT_KEYLEN)),
    algorithm: raw,
  };
}

function makePasswordHash(password, salt = crypto.randomBytes(16).toString("hex"), algorithm = PASSWORD_HASH_ALGORITHM) {
  const parsed = parsePasswordHashAlgorithm(algorithm);
  const hash = crypto.scryptSync(String(password || ""), salt, parsed.keylen, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: Math.max(64 * 1024 * 1024, 256 * parsed.N * parsed.r),
  }).toString("hex");
  return { salt, hash, algorithm: parsed.algorithm };
}

function verifyPassword(account, password) {
  if (!account || !account.password_salt || !account.password_hash) return false;

  const result = makePasswordHash(password, account.password_salt, account.password_algorithm || "legacy_scrypt");
  const expected = Buffer.from(account.password_hash, "hex");
  const actual = Buffer.from(result.hash, "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function makeTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function makeSecureToken(byteLength = 32) {
  return crypto.randomBytes(Math.max(16, Math.trunc(Number(byteLength) || 32))).toString("hex");
}

function issueSessionToken(account) {
  const token = makeSecureToken(32);
  account.session_token_expires_at = new Date(Date.now() + SESSION_TOKEN_TTL_MS).toISOString();
  account.session_token_hash = makeTokenHash(token);
  account.refresh_token_hash = "";
  account.refresh_token_expires_at = "";
  account.last_seen_at = new Date().toISOString();
  queueAccountsSave();
  return token;
}

function issueSessionTokens(account) {
  const sessionToken = makeSecureToken(32);
  const refreshToken = makeSecureToken(48);
  account.session_token_hash = makeTokenHash(sessionToken);
  account.session_token_expires_at = new Date(Date.now() + SESSION_TOKEN_TTL_MS).toISOString();
  account.refresh_token_hash = makeTokenHash(refreshToken);
  account.refresh_token_expires_at = new Date(Date.now() + SESSION_REFRESH_TOKEN_TTL_MS).toISOString();
  account.last_seen_at = new Date().toISOString();
  queueAccountsSave();
  return { sessionToken, refreshToken };
}

function clearSessionToken(account) {
  if (!account) return;
  const username = cleanAccountName(account.username || "");
  account.session_token_hash = "";
  account.session_token_expires_at = "";
  account.refresh_token_hash = "";
  account.refresh_token_expires_at = "";
  queueAccountsSave();
  if (username !== "") {
    postgresStore.revokeSessionsByUsername(username);
  }
}

function isSessionTokenValid(account, token) {
  if (!account || !account.session_token_hash) return false;
  if (account.session_token_hash !== makeTokenHash(token)) return false;

  const expiresAt = Date.parse(String(account.session_token_expires_at || ""));
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    clearSessionToken(account);
    return false;
  }

  return true;
}

function isAccountEmailVerified(account) {
  return Boolean(account && account.email_verified);
}

function makeEmailVerificationToken(account) {
  const token = crypto.randomBytes(32).toString("hex");
  account.email_verification_token_hash = makeTokenHash(token);
  account.email_verification_expires_at = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
  account.email_verified = false;
  account.email_verified_at = "";
  return token;
}

function makeEmailVerificationUrl(token) {
  return `${PUBLIC_BASE_URL}/verify-email?token=${encodeURIComponent(token)}`;
}

function hasActiveEmailVerificationToken(account) {
  if (!account || !account.email_verification_token_hash) return false;
  const expiresAt = Date.parse(String(account.email_verification_expires_at || ""));
  return Number.isFinite(expiresAt) && Date.now() <= expiresAt;
}

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  if (!SMTP_HOST) return null;

  const transportOptions = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
  };

  if (SMTP_USER !== "" || SMTP_PASS !== "") {
    transportOptions.auth = {
      user: SMTP_USER,
      pass: SMTP_PASS,
    };
  }

  mailTransporter = nodemailer.createTransport(transportOptions);
  return mailTransporter;
}

async function sendVerificationEmail(account, token) {
  const verificationUrl = makeEmailVerificationUrl(token);
  const to = cleanEmail(account.email || "");
  if (to === "") return;

  const transporter = getMailTransporter();
  if (!transporter) {
    console.warn(`Email verification link for ${account.username} <${to}>: ${verificationUrl}`);
    return;
  }

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: "Verify your PixelMania account",
    text: [
      `Hi ${account.username},`,
      "",
      "Verify your PixelMania account before signing on:",
      verificationUrl,
      "",
      "If you did not create this account, ignore this email.",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(account.username)},</p>`,
      "<p>Verify your PixelMania account before signing on:</p>",
      `<p><a href="${escapeHtml(verificationUrl)}">Verify PixelMania Account</a></p>`,
      "<p>If you did not create this account, ignore this email.</p>",
    ].join("\n"),
  });
}

function queueVerificationEmail(account, token) {
  sendVerificationEmail(account, token).catch((error) => {
    console.warn(`Could not send verification email to ${account.email}:`, error.message);
    console.warn(`Email verification link for ${account.username}: ${makeEmailVerificationUrl(token)}`);
  });
}

function verifyEmailToken(token) {
  const cleanToken = String(token || "").trim();
  if (cleanToken === "") {
    return { ok: false, message: "This verification link is missing its token." };
  }

  const tokenHash = makeTokenHash(cleanToken);
  for (const account of accounts.values()) {
    if (account.email_verification_token_hash !== tokenHash) continue;

    const expiresAt = Date.parse(String(account.email_verification_expires_at || ""));
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      account.email_verification_token_hash = "";
      account.email_verification_expires_at = "";
      queueAccountsSave();
      return { ok: false, message: "This verification link expired. Register again to send a new email." };
    }

    account.email_verified = true;
    account.email_verified_at = new Date().toISOString();
    account.email_verification_token_hash = "";
    account.email_verification_expires_at = "";
    clearSessionToken(account);
    queueAccountsSave();
    return { ok: true, message: "Your PixelMania email is verified. You can return to the game and sign on." };
  }

  return { ok: false, message: "This verification link is invalid or has already been used." };
}

function hasPassword(account) {
  return Boolean(account && account.password_salt && account.password_hash);
}

function getAccountRole(username) {
  const key = accountKey(username);
  const account = accounts.get(key);
  const role = String(account?.role || "").trim().toLowerCase();

  if (role === "admin" || role === "developer") return role;
  if (role === "moderator" || role === "mod") return "moderator";
  if (ADMIN_USERNAMES.has(key)) return "admin";
  return "player";
}

function isDeveloperRole(role) {
  const cleanRole = String(role || "").trim().toLowerCase();
  return cleanRole === "admin" || cleanRole === "developer";
}

function getPublicPlayerRole(player) {
  if (!player || !player.authenticated) return "player";
  return isDeveloperRole(getAccountRole(player.account_username || player.name)) ? "admin" : "player";
}

function getPublicPlayerIdentity(player, fallbackName = "Player") {
  const displayName = cleanAccountName(player?.account_username || player?.name || fallbackName) || fallbackName;
  return {
    name: displayName,
    username: displayName,
    account_username: displayName,
    display_name: displayName,
    role: getPublicPlayerRole(player),
  };
}

function buildPublicPlayerPresencePayload(type, player, worldName = "") {
  if (player) refreshPlayerFishingPresence(player, worldName || player.world || "");
  const equipmentSlots = player?.equipment_slots || {};
  const fishingTargetX = Number.isInteger(player?.fishing_target_x) ? player.fishing_target_x : -1;
  const fishingTargetY = Number.isInteger(player?.fishing_target_y) ? player.fishing_target_y : -1;
  const fishingActive = player?.fishing_active === true && isGridInWorld(fishingTargetX, fishingTargetY);
  const damageFlash = getPublicPlayerDamageFlash(player);
  return {
    type,
    player_id: String(player?.id || ""),
    ...getPublicPlayerIdentity(player),
    x: Number(player?.x || 0),
    y: Number(player?.y || 0),
    facing: Number(player?.facing || 1),
    world: String(worldName || player?.world || ""),
    animation_state: String(player?.animation_state || "idle"),
    velocity_x: sanitizePlayerVelocity(player?.velocity_x || 0),
    velocity_y: sanitizePlayerVelocity(player?.velocity_y || 0),
    on_floor: player?.on_floor !== false,
    in_water: player?.in_water === true,
    in_lava_fire: player?.in_lava_fire === true,
    ...damageFlash,
    fishing_active: fishingActive,
    fishing_target_x: fishingActive ? fishingTargetX : -1,
    fishing_target_y: fishingActive ? fishingTargetY : -1,
    fishing_lure_id: fishingActive ? clampString(player?.fishing_lure_id || "") : "",
    fishing_rod_id: fishingActive ? clampString(player?.fishing_rod_id || "") : "",
    equipment_slots: equipmentSlots,
    equipped_tool: clampString(equipmentSlots.hand || ""),
    equipped_back_item: clampString(equipmentSlots.back || ""),
    equipped_back: clampString(equipmentSlots.back || ""),
    equipped_hair_item: clampString(equipmentSlots.hair || ""),
    equipped_shirt_item: clampString(equipmentSlots.shirt || ""),
    equipped_pants_item: clampString(equipmentSlots.pants || ""),
    equipped_shoes_item: clampString(equipmentSlots.shoes || ""),
  };
}

function isAdmin(player) {
  return Boolean(player && player.authenticated && isDeveloperRole(getAccountRole(player.account_username)));
}

function canActivateAccount(username, playerId) {
  const key = accountKey(username);
  const activePlayerId = activeAccountSessions.get(key);
  return !activePlayerId || activePlayerId === playerId;
}

function replaceActiveAccountSession(username, replacementPlayerId) {
  const key = accountKey(username);
  const activePlayerId = activeAccountSessions.get(key);
  if (!activePlayerId || activePlayerId === replacementPlayerId) return;

  const existingPlayer = players.get(activePlayerId);
  const existingSocket = getSocketByPlayerId(activePlayerId);
  activeAccountSessions.delete(key);
  redisStore.clearActiveSession(username, activePlayerId).catch((error) => {
    console.warn("[redis] active session replacement cleanup failed:", error.message);
  });

  if (existingPlayer) {
    cancelActiveTradeForPlayer(activePlayerId, "Trade canceled because the account signed on somewhere else.");
    activeFishingSessions.delete(activePlayerId);
    clearPlayerFishingPresence(existingPlayer);
  }

  if (existingSocket) {
    sendJson(existingSocket, {
      type: "account_session_replaced",
      message: "This account signed on somewhere else.",
    });
    existingSocket.close(4001, "Account signed on elsewhere");
    return;
  }

  if (existingPlayer && existingPlayer.joined_world) {
    broadcastToWorld(existingPlayer.world, buildPublicPlayerPresencePayload("player_left", existingPlayer, existingPlayer.world), activePlayerId);
    broadcastSystemToWorld(existingPlayer.world, `${existingPlayer.name} left ${existingPlayer.world}`, activePlayerId);
    players.delete(activePlayerId);
  }
}

function releaseActiveAccountSession(player) {
  if (!player || !player.account_username) return;

  const key = accountKey(player.account_username);
  if (activeAccountSessions.get(key) === player.id) {
    activeAccountSessions.delete(key);
    redisStore.clearActiveSession(player.account_username, player.id).catch((error) => {
      console.warn("[redis] active session cleanup failed:", error.message);
    });
    redisStore.clearPresence(player.account_username).catch((error) => {
      console.warn("[redis] presence cleanup failed:", error.message);
    });
  }
}

function touchLivePresence(socket, player, options = {}) {
  if (!redisStore.isReady() || !player || !player.authenticated || !player.account_username) return;
  const now = Date.now();
  const force = Boolean(options.force);
  if (!force && now - Number(player.last_presence_at || 0) < Math.floor(REDIS_PRESENCE_TTL_MS / 3)) return;

  player.last_presence_at = now;
  const presence = {
    username: player.account_username,
    player_id: player.id,
    world: player.world || "",
    x: Math.round(Number(player.x || 0)),
    y: Math.round(Number(player.y || 0)),
    ip: getSocketAddress(socket),
    updated_at: new Date(now).toISOString(),
  };

  redisStore.setPresence(player.account_username, presence, REDIS_PRESENCE_TTL_MS).catch((error) => {
    console.warn("[redis] presence update failed:", error.message);
  });
  redisStore.setActiveSession(player.account_username, player.id, REDIS_ACTIVE_SESSION_TTL_MS).catch((error) => {
    console.warn("[redis] active session update failed:", error.message);
  });
}

function scheduleLiveActionLockCleanup(lockHandle) {
  if (!lockHandle || !lockHandle.localSet || !lockHandle.resource) return;
  if (lockHandle.cleanupTimer) return;

  const timer = setTimeout(() => {
    if (!lockHandle.released && lockHandle.localSet && lockHandle.resource) {
      const removed = lockHandle.localSet.delete(lockHandle.resource);
      if (removed) {
        console.warn("[redis] auto-released stale local action lock", {
          scope: lockHandle.scope,
          resource: lockHandle.resource,
        });
      }
    }
  }, REDIS_ACTION_LOCK_GUARD_MS);

  if (typeof timer.unref === "function") timer.unref();
  lockHandle.cleanupTimer = timer;
}

function clearLiveActionLockCleanup(lockHandle) {
  if (!lockHandle || !lockHandle.cleanupTimer) return;
  clearTimeout(lockHandle.cleanupTimer);
  lockHandle.cleanupTimer = null;
}

async function acquireLiveActionLock(localSet, scope, resource, owner = "") {
  const cleanResource = String(resource || "").trim();
  if (!localSet || cleanResource === "") return { acquired: false };
  if (localSet.has(cleanResource)) return { acquired: false };

  localSet.add(cleanResource);
  const lock = await redisStore.acquireLock(scope, cleanResource, REDIS_ACTION_LOCK_TTL_MS, owner);
  if (!lock.acquired) {
    localSet.delete(cleanResource);
    return { acquired: false };
  }

  const lockHandle = {
    acquired: true,
    localSet,
    resource: cleanResource,
    lock,
    scope,
    owner,
    released: false,
  };
  scheduleLiveActionLockCleanup(lockHandle);
  return lockHandle;
}

function releaseLiveActionLock(lockHandle) {
  if (!lockHandle || !lockHandle.acquired) return;
  if (lockHandle.localSet && lockHandle.resource) {
    lockHandle.localSet.delete(lockHandle.resource);
  }
  clearLiveActionLockCleanup(lockHandle);
  lockHandle.released = true;
  redisStore.releaseLock(lockHandle.lock).catch((error) => {
    console.warn("[redis] action lock release failed:", error.message);
  });
}

function getInventoryLockResource(username) {
  return accountKey(username || "");
}

async function acquirePlayerInventoryLocks(usernames, owner = "") {
  const resources = [...new Set((Array.isArray(usernames) ? usernames : [usernames])
    .map(getInventoryLockResource)
    .filter((resource) => resource !== ""))]
    .sort();

  if (resources.length === 0) {
    return { acquired: false, locks: [], blocked_resource: "" };
  }

  const locks = [];
  for (const resource of resources) {
    const lock = await acquireLiveActionLock(playerInventoryActionLocks, "inventory", resource, owner || resource);
    if (!lock.acquired) {
      for (let i = locks.length - 1; i >= 0; i -= 1) {
        releaseLiveActionLock(locks[i]);
      }
      return { acquired: false, locks: [], blocked_resource: resource };
    }
    locks.push(lock);
  }

  return { acquired: true, locks, resources };
}

function releasePlayerInventoryLocks(lockHandle) {
  const locks = Array.isArray(lockHandle?.locks) ? lockHandle.locks : [];
  for (let i = locks.length - 1; i >= 0; i -= 1) {
    releaseLiveActionLock(locks[i]);
  }
}

function activatePlayerAccount(socket, player, account, options = {}) {
  if (!canActivateAccount(account.username, player.id) && options.replaceExisting) {
    replaceActiveAccountSession(account.username, player.id);
  }

  if (!canActivateAccount(account.username, player.id)) {
    return { ok: false, message: "That account is already signed on." };
  }

  releaseActiveAccountSession(player);

  player.account_username = account.username;
  player.account_email = cleanEmail(account.email || "");
  player.authenticated = true;
  player.name = account.username;
  player.role = getAccountRole(account.username);
  const state = ensurePlayerState(account.username);
  player.equipment_slots = sanitizeEquipmentSlots(getEquipmentSlotsFromPlayerState(state), account.username, state);
  activeAccountSessions.set(accountKey(account.username), player.id);
  touchLivePresence(socket, player, { force: true });

  return { ok: true };
}

function isPlayerOwnAccount(player, username) {
  return accountKey(username) === accountKey(player.account_username);
}

function sendAuthError(socket, requestId, action, message, extra = {}) {
  sendJson(socket, {
    type: "account_auth_error",
    ok: false,
    request_id: requestId,
    action,
    message,
    ...extra,
  });
}

function sendAuthOk(socket, requestId, action, account, tokens) {
  const role = getAccountRole(account.username);
  const tokenPayload = typeof tokens === "string" ? { sessionToken: tokens, refreshToken: "" } : (tokens || {});
  sendJson(socket, {
    type: "account_auth_ok",
    ok: true,
    request_id: requestId,
    action,
    username: account.username,
    email: cleanEmail(account.email || ""),
    session_token: tokenPayload.sessionToken || "",
    session_token_expires_at: String(account.session_token_expires_at || ""),
    refresh_token: tokenPayload.refreshToken || "",
    refresh_token_expires_at: String(account.refresh_token_expires_at || ""),
    one_active_session: ACCOUNT_ONE_ACTIVE_SESSION,
    role,
    email_verified: isAccountEmailVerified(account),
    developer_pin_required: isDeveloperRole(role) && DEV_PIN_REQUIRED,
    developer_pin_unlocked: !DEV_PIN_REQUIRED,
    admin_2fa_required: isDeveloperRole(role) && ADMIN_2FA_REQUIRED,
    admin_2fa_verified: !ADMIN_2FA_REQUIRED,
  });
}

function sendVerificationRequired(socket, requestId, action, account, message) {
  sendJson(socket, {
    type: "account_auth_ok",
    ok: true,
    request_id: requestId,
    action,
    username: account.username,
    email: cleanEmail(account.email || ""),
    role: getAccountRole(account.username),
    email_verified: false,
    requires_email_verification: true,
    message,
  });
}

function findAccountByEmail(email) {
  const clean = cleanEmail(email);
  if (clean === "") return null;

  for (const account of accounts.values()) {
    if (cleanEmail(account.email || "") === clean) {
      return account;
    }
  }

  return null;
}

function handleAccountRegister(socket, player, data) {
  const requestId = makeRequestId(data);
  const usernameValidation = validateUsername(data.username);
  if (!usernameValidation.ok) {
    sendAuthError(socket, requestId, "register", usernameValidation.message);
    return;
  }

  const emailValidation = validateEmail(data.email);
  if (!emailValidation.ok) {
    sendAuthError(socket, requestId, "register", emailValidation.message);
    return;
  }

  const passwordValidation = validatePassword(data.password);
  if (!passwordValidation.ok) {
    sendAuthError(socket, requestId, "register", passwordValidation.message);
    return;
  }

  const key = accountKey(usernameValidation.username);
  const existing = accounts.get(key);
  if (existing && hasPassword(existing) && isAccountEmailVerified(existing)) {
    sendAuthError(socket, requestId, "register", "Username is already registered.");
    return;
  }
  if (existing && hasPassword(existing) && cleanEmail(existing.email || "") !== emailValidation.email) {
    sendAuthError(socket, requestId, "register", "That username is waiting for verification with a different email.");
    return;
  }

  const emailOwner = findAccountByEmail(emailValidation.email);
  if (emailOwner && accountKey(emailOwner.username) !== key && isAccountEmailVerified(emailOwner)) {
    sendAuthError(socket, requestId, "register", "Email is already registered.");
    return;
  }
  if (emailOwner && accountKey(emailOwner.username) !== key && !isAccountEmailVerified(emailOwner)) {
    sendAuthError(socket, requestId, "register", "That email is already waiting for verification.");
    return;
  }

  const passwordHash = makePasswordHash(passwordValidation.password);
  const now = new Date().toISOString();
  const account = {
    ...(existing || {}),
    username: existing?.username || usernameValidation.username,
    email: emailValidation.email,
    password_salt: passwordHash.salt,
    password_hash: passwordHash.hash,
    password_algorithm: passwordHash.algorithm,
    session_token_hash: "",
    refresh_token_hash: "",
    refresh_token_expires_at: "",
    email_verified: false,
    email_verified_at: "",
    role: getAccountRole(usernameValidation.username),
    created_at: existing?.created_at || now,
    last_seen_at: now,
    friends: sanitizeAccountNameArray(existing?.friends || [], 200),
    friend_requests_in: sanitizeAccountNameArray(existing?.friend_requests_in || existing?.pending_friend_requests || [], 200),
    friend_requests_out: sanitizeAccountNameArray(existing?.friend_requests_out || [], 200),
  };

  const verificationToken = makeEmailVerificationToken(account);
  accounts.set(key, account);
  queueAccountsSave();
  postgresStore.mirrorAccount(account, { touchLogin: false });
  queueVerificationEmail(account, verificationToken);
  sendVerificationRequired(socket, requestId, "register", account, "Account created. Check your email to verify before signing on.");
}

async function handleAccountLogin(socket, player, data) {
  const requestId = makeRequestId(data);
  const username = cleanAccountName(data.username);
  const email = cleanEmail(data.email || "");
  const fail = (message, reason, extra = {}) => {
    sendAuthError(socket, requestId, "login", message, extra);
    recordLoginAttempt(socket, player, username, "login", false, reason || message, data);
  };

  if (username === "") {
    fail("Enter your username.", "missing_username");
    return;
  }

  const rateLimit = await checkLoginAttemptAllowed(socket, username, "login");
  if (!rateLimit.ok) {
    fail(`Too many login attempts. Try again in ${rateLimit.retry_after_seconds}s.`, "rate_limited", {
      retry_after_seconds: rateLimit.retry_after_seconds,
      retry_ms: rateLimit.retry_ms,
    });
    return;
  }

  if (email === "") {
    fail("Enter your email address.", "missing_email");
    return;
  }

  const account = accounts.get(accountKey(username));
  if (!account || !hasPassword(account)) {
    fail("Username not found.", "username_not_found");
    return;
  }

  if (email !== cleanEmail(account.email || "")) {
    fail("Email does not match that username.", "email_mismatch");
    return;
  }

  if (!verifyPassword(account, data.password)) {
    fail("Password does not match.", "password_mismatch");
    return;
  }

  if (!account.password_algorithm || account.password_algorithm === "legacy_scrypt") {
    const upgradedPasswordHash = makePasswordHash(data.password);
    account.password_salt = upgradedPasswordHash.salt;
    account.password_hash = upgradedPasswordHash.hash;
    account.password_algorithm = upgradedPasswordHash.algorithm;
    queueAccountsSave();
  }

  if (!isAccountEmailVerified(account)) {
    if (hasActiveEmailVerificationToken(account)) {
      fail("Verify your email before signing on. Check your email for the verification link.", "email_not_verified", {
        requires_email_verification: true,
        email: cleanEmail(account.email || ""),
      });
      return;
    }

    const verificationToken = makeEmailVerificationToken(account);
    queueAccountsSave();
    queueVerificationEmail(account, verificationToken);
    fail("Verify your email before signing on. I sent a new verification email.", "email_not_verified_new_link", {
      requires_email_verification: true,
      email: cleanEmail(account.email || ""),
    });
    return;
  }

  const loginPunishment = await getBlockingPunishment(account.username, ["ban", "lockout"], {
    scope: PUNISHMENT_SCOPE_GLOBAL,
  });
  if (loginPunishment) {
    fail(formatPunishmentBlockMessage("login", loginPunishment), "punishment_blocked", {
      punishment: publicPunishmentPayload(loginPunishment),
    });
    logSecurityEvent(socket, player, "punishment_blocked_login", {
      target_username: account.username,
      punishment_type: loginPunishment.punishment_type,
      punishment_id: loginPunishment.punishment_id,
    }, "warning");
    return;
  }

  account.last_seen_at = new Date().toISOString();
  const previousSessionHash = cleanAccountName(account.session_token_hash || "");
  const previousSessionExpiresAt = String(account.session_token_expires_at || "");
  const previousRefreshHash = cleanAccountName(account.refresh_token_hash || "");
  const previousRefreshExpiresAt = String(account.refresh_token_expires_at || "");
  const tokens = issueSessionTokens(account);

  if (isPostgresAuthoritativeReady()) {
    if (ACCOUNT_ONE_ACTIVE_SESSION) {
      const revokeResult = await postgresStore.revokeSessionsForUsername(account.username);
      if (!revokeResult.ok) {
        account.session_token_hash = previousSessionHash;
        account.session_token_expires_at = previousSessionExpiresAt;
        account.refresh_token_hash = previousRefreshHash;
        account.refresh_token_expires_at = previousRefreshExpiresAt;
        queueAccountsSave();
        fail("Could not rotate your saved login. Try again.", "session_revoke_failed");
        return;
      }
    }

    const sessionResult = await postgresStore.saveSession(account, {
      ip: getSocketAddress(socket),
      userAgent: getSocketUserAgent(socket, data),
      deviceInfo: getSocketDeviceInfo(socket, data),
      sessionMode: ACCOUNT_ONE_ACTIVE_SESSION ? "one_active" : "multi_session",
    });
    if (!sessionResult.ok) {
      account.session_token_hash = "";
      account.session_token_expires_at = "";
      account.refresh_token_hash = "";
      account.refresh_token_expires_at = "";
      queueAccountsSave();
      fail("Could not create your saved login session. Try again.", "session_create_failed");
      return;
    }
  } else {
    postgresStore.mirrorSession(account, {
      ip: getSocketAddress(socket),
      userAgent: getSocketUserAgent(socket, data),
      deviceInfo: getSocketDeviceInfo(socket, data),
      sessionMode: ACCOUNT_ONE_ACTIVE_SESSION ? "one_active" : "multi_session",
    });
  }

  const activation = activatePlayerAccount(socket, player, account, { replaceExisting: true });
  if (!activation.ok) {
    fail(activation.message, "activation_failed");
    return;
  }

  postgresStore.mirrorAccount(account, { touchLogin: true });
  recordLoginAttempt(socket, player, account.username, "login", true, "success", data);
  sendAuthOk(socket, requestId, "login", account, tokens);
  sendFriendState(socket, account.username, requestId);
  notifyOnlineFriendsOfFriendState(account.username);
}

async function handleAccountTokenLogin(socket, player, data) {
  const requestId = makeRequestId(data);
  const username = cleanAccountName(data.username);
  const token = String(data.refresh_token || data.session_token || "").trim();
  const usingRefreshToken = String(data.refresh_token || "").trim() !== "";
  const fail = (message, reason, extra = {}) => {
    sendAuthError(socket, requestId, "token_login", message, extra);
    recordLoginAttempt(socket, player, username, usingRefreshToken ? "refresh_token_login" : "token_login", false, reason || message, data);
  };

  if (username === "" || token === "") {
    fail("Saved login expired. Sign on again.", "missing_token");
    return;
  }

  const rateLimit = await checkLoginAttemptAllowed(socket, username, usingRefreshToken ? "refresh_token_login" : "token_login");
  if (!rateLimit.ok) {
    fail(`Too many login attempts. Try again in ${rateLimit.retry_after_seconds}s.`, "rate_limited", {
      retry_after_seconds: rateLimit.retry_after_seconds,
      retry_ms: rateLimit.retry_ms,
    });
    return;
  }

  const tokenHash = makeTokenHash(token);
  let account = accounts.get(accountKey(username));
  let previousSessionHash = cleanAccountName(account?.session_token_hash || tokenHash);
  let previousSessionExpiresAt = String(account?.session_token_expires_at || "");
  let previousRefreshHash = cleanAccountName(account?.refresh_token_hash || "");
  let previousRefreshExpiresAt = String(account?.refresh_token_expires_at || "");

  if (isPostgresAuthoritativeReady()) {
    const validation = await postgresStore.validateSessionToken(username, tokenHash, {
      ip: getSocketAddress(socket),
      userAgent: getSocketUserAgent(socket, data),
      deviceInfo: getSocketDeviceInfo(socket, data),
      tokenKind: usingRefreshToken ? "refresh" : "session_or_refresh",
    });
    if (!validation.ok) {
      fail("Saved login expired. Sign on again.", validation.reason || "invalid_or_expired");
      return;
    }

    const validatedAccount = sanitizeAccountState(validation.account);
    if (!validatedAccount) {
      fail("Saved login expired. Sign on again.", "invalid_account_state");
      return;
    }

    account = accounts.get(accountKey(validatedAccount.username)) || validatedAccount;
    Object.assign(account, validatedAccount);
    accounts.set(accountKey(account.username), account);
    previousSessionHash = tokenHash;
    previousSessionExpiresAt = String(account.session_token_expires_at || validation.expires_at || "");
    previousRefreshHash = cleanAccountName(account.refresh_token_hash || validation.refresh_token_hash || "");
    previousRefreshExpiresAt = String(account.refresh_token_expires_at || validation.refresh_expires_at || "");
  } else if (!isSessionTokenValid(account, token) && !isRefreshTokenValid(account, token)) {
    fail("Saved login expired. Sign on again.", "invalid_or_expired");
    return;
  }

  if (!isAccountEmailVerified(account)) {
    fail("Verify your email before signing on.", "email_not_verified", {
      requires_email_verification: true,
      email: cleanEmail(account.email || ""),
    });
    return;
  }

  const loginPunishment = await getBlockingPunishment(account.username, ["ban", "lockout"], {
    scope: PUNISHMENT_SCOPE_GLOBAL,
  });
  if (loginPunishment) {
    fail(formatPunishmentBlockMessage("login", loginPunishment), "punishment_blocked", {
      punishment: publicPunishmentPayload(loginPunishment),
    });
    logSecurityEvent(socket, player, "punishment_blocked_token_login", {
      target_username: account.username,
      punishment_type: loginPunishment.punishment_type,
      punishment_id: loginPunishment.punishment_id,
    }, "warning");
    return;
  }

  account.last_seen_at = new Date().toISOString();
  const nextTokens = issueSessionTokens(account);

  if (isPostgresAuthoritativeReady()) {
    const sessionResult = await postgresStore.saveSession(account, {
      ip: getSocketAddress(socket),
      userAgent: getSocketUserAgent(socket, data),
      deviceInfo: getSocketDeviceInfo(socket, data),
      rotatedFromTokenHash: tokenHash,
      sessionMode: ACCOUNT_ONE_ACTIVE_SESSION ? "one_active" : "multi_session",
    });
    if (!sessionResult.ok) {
      account.session_token_hash = previousSessionHash;
      account.session_token_expires_at = previousSessionExpiresAt;
      account.refresh_token_hash = previousRefreshHash;
      account.refresh_token_expires_at = previousRefreshExpiresAt;
      queueAccountsSave();
      fail("Could not refresh your saved login. Sign on again.", "session_refresh_failed");
      return;
    }

    if (tokenHash !== "" && tokenHash !== account.session_token_hash && tokenHash !== account.refresh_token_hash) {
      await postgresStore.revokeSessionByTokenHash(tokenHash, "rotated");
    }
    if (ACCOUNT_ONE_ACTIVE_SESSION) {
      await postgresStore.revokeOtherSessionsForUsername(account.username, account.session_token_hash, "one_active_session");
    }
  } else {
    postgresStore.mirrorSession(account, {
      ip: getSocketAddress(socket),
      userAgent: getSocketUserAgent(socket, data),
      deviceInfo: getSocketDeviceInfo(socket, data),
      sessionMode: ACCOUNT_ONE_ACTIVE_SESSION ? "one_active" : "multi_session",
    });
  }

  const activation = activatePlayerAccount(socket, player, account, { replaceExisting: true });
  if (!activation.ok) {
    fail(activation.message, "activation_failed");
    return;
  }

  postgresStore.mirrorAccount(account, { touchLogin: true });
  recordLoginAttempt(socket, player, account.username, usingRefreshToken ? "refresh_token_login" : "token_login", true, "success", data);
  sendAuthOk(socket, requestId, "token_login", account, nextTokens);
  sendFriendState(socket, account.username, requestId);
  notifyOnlineFriendsOfFriendState(account.username);
}

function requireAuthenticated(socket, player, action) {
  if (player && player.authenticated && player.account_username) {
    return true;
  }

  const noticeKey = String(action || "action");
  const now = Date.now();
  if (!socket.authRequiredNotices) socket.authRequiredNotices = new Map();
  const lastNoticeAt = socket.authRequiredNotices.get(noticeKey) || 0;
  if (now - lastNoticeAt < 3000) {
    return false;
  }
  socket.authRequiredNotices.set(noticeKey, now);

  sendJson(socket, {
    type: "auth_required",
    message: `Sign on before you ${action}.`,
  });
  return false;
}

function sendPlayerState(socket, username) {
  const state = ensurePlayerState(username);
  sendJson(socket, {
    type: "player_state",
    found: state !== null,
    username: cleanAccountName(username),
    player_data: state ? buildPlayerStateForClient(state) : {},
  });
}

function sendInventoryTransactionResult(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  const response = {
    ...payload,
    type: "inventory_transaction_result",
    ok: Boolean(payload.ok),
    request_id: String(payload.request_id || ""),
    action: String(payload.action || ""),
    message: String(payload.message || ""),
    username: cleanAccountName(payload.username || ""),
    rewards: Array.isArray(payload.rewards) ? payload.rewards : [],
  };
  if (
    payload.player_data &&
    typeof payload.player_data === "object" &&
    !Array.isArray(payload.player_data) &&
    Object.keys(payload.player_data).length > 0
  ) {
    response.player_data = payload.player_data;
  } else {
    delete response.player_data;
  }

  sendJson(socket, response);
}

function sendWorldUpdateToRequesterAndWorld(socket, player, worldName, payload, requesterFields = null) {
  const publicPayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...payload }
    : payload;
  const requesterPayload = requesterFields && typeof requesterFields === "object" && !Array.isArray(requesterFields)
    ? { ...publicPayload, ...requesterFields }
    : publicPayload;

  sendJson(socket, requesterPayload);
  broadcastToWorld(worldName, publicPayload, String(player?.id || socket?.playerId || ""));
}

function sendInventoryTransactionRejected(socket, data, message) {
  sendInventoryTransactionResult(socket, {
    ok: false,
    request_id: makeRequestId(data),
    action: String(data.action || ""),
    message,
  });
}

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  let raw;
  try {
    raw = JSON.stringify(payload);
  } catch (error) {
    console.warn("[socket_serialize_error]", error && error.message ? error.message : error);
    return;
  }
  sendRawJsonToSocket(socket, raw, "direct_send", {
    message_type: String(payload?.type || ""),
  });
}

function getSocketBufferedAmount(socket) {
  const amount = Number(socket?.bufferedAmount || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function shouldLogSocketBackpressure(socket) {
  const now = Date.now();
  const previous = Number(socket?._lastBackpressureWarningAt || 0);
  if (now - previous < 5000) return false;
  if (socket) socket._lastBackpressureWarningAt = now;
  return true;
}

function sendRawJsonToSocket(socket, raw, context = "send", details = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  const bufferedAmount = getSocketBufferedAmount(socket);
  if (bufferedAmount > SERVER_WEBSOCKET_MAX_BUFFERED_AMOUNT) {
    if (shouldLogSocketBackpressure(socket)) {
      console.warn("[socket_backpressure_skip]", {
        context,
        player_id: String(socket.playerId || ""),
        buffered_amount: bufferedAmount,
        limit: SERVER_WEBSOCKET_MAX_BUFFERED_AMOUNT,
        ...details,
      });
    }
    return false;
  }

  try {
    socket.send(raw);
    return true;
  } catch (error) {
    console.warn("[socket_send_error]", {
      context,
      player_id: String(socket.playerId || ""),
      message: error && error.message ? error.message : String(error),
      ...details,
    });
    return false;
  }
}

function normalizeServerPunishmentType(value) {
  const clean = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  if (clean === "tradeban") return "trade_ban";
  if (clean === "worldban") return "world_ban";
  return PUNISHMENT_TYPES.has(clean) ? clean : "";
}

function getPunishmentTypeLabel(type) {
  switch (normalizeServerPunishmentType(type)) {
    case "trade_ban":
      return "trade ban";
    case "world_ban":
      return "world ban";
    case "lockout":
      return "security lockout";
    case "mute":
      return "mute";
    case "ban":
      return "ban";
    default:
      return "punishment";
  }
}

function getPunishmentCacheKey(username, type = "", scope = "", worldName = "") {
  const key = accountKey(username);
  const cleanType = normalizeServerPunishmentType(type);
  const cleanScope = String(scope || "").trim().toLowerCase();
  const cleanWorld = cleanScope === PUNISHMENT_SCOPE_WORLD ? cleanWorldNameForPunishment(worldName) : "";
  return `${key}:${cleanType}:${cleanScope}:${cleanWorld}`;
}

function clearPunishmentCache(username = "") {
  const key = accountKey(username);
  if (key === "") {
    punishmentCache.clear();
    return;
  }

  for (const cacheKey of Array.from(punishmentCache.keys())) {
    if (String(cacheKey).startsWith(`${key}:`)) {
      punishmentCache.delete(cacheKey);
    }
  }
}

function cleanWorldNameForPunishment(worldName = "") {
  return cleanWorld(worldName || "");
}

function cleanPunishmentReason(value = "") {
  const clean = String(value || "").trim().replace(/\s+/g, " ").slice(0, 500);
  return clean || "No reason provided.";
}

function parsePunishmentDurationToken(rawToken = "") {
  const token = String(rawToken || "").trim().toLowerCase();
  if (token === "") {
    return { ok: false, consumed: false, durationMinutes: 0, label: "permanent" };
  }

  if (["perm", "permanent", "forever", "never", "0"].includes(token)) {
    return { ok: true, consumed: true, durationMinutes: 0, label: "permanent" };
  }

  const match = token.match(/^(\d+)(m|h|d|w|mo|y)?$/);
  if (!match) {
    return { ok: false, consumed: false, durationMinutes: 0, label: "permanent" };
  }

  const amount = Math.max(0, Math.trunc(Number(match[1]) || 0));
  const unit = match[2] || "m";
  const multipliers = {
    m: 1,
    h: 60,
    d: 24 * 60,
    w: 7 * 24 * 60,
    mo: 30 * 24 * 60,
    y: 365 * 24 * 60,
  };
  const durationMinutes = Math.min(PUNISHMENT_MAX_DURATION_MINUTES, amount * (multipliers[unit] || 1));
  if (durationMinutes <= 0) {
    return { ok: true, consumed: true, durationMinutes: 0, label: "permanent" };
  }

  return {
    ok: true,
    consumed: true,
    durationMinutes,
    label: token,
  };
}

function formatPunishmentExpires(punishment) {
  const rawEndsAt = String(punishment?.ends_at || "").trim();
  if (rawEndsAt === "") return "permanent";

  const date = new Date(rawEndsAt);
  if (!Number.isFinite(date.getTime())) return "until " + rawEndsAt;
  return "until " + date.toISOString();
}

function publicPunishmentPayload(punishment = {}) {
  const scope = String(punishment.scope || "").trim().toLowerCase();
  return {
    punishment_id: Math.max(0, Math.trunc(Number(punishment.punishment_id) || 0)),
    punishment_type: normalizeServerPunishmentType(punishment.punishment_type || punishment.type || ""),
    scope,
    world: scope === PUNISHMENT_SCOPE_WORLD ? cleanWorldNameForPunishment(punishment.world || "") : "",
    reason: cleanPunishmentReason(punishment.reason || ""),
    starts_at: String(punishment.starts_at || ""),
    ends_at: String(punishment.ends_at || ""),
    issued_by: cleanAccountName(punishment.issued_by || punishment.issued_by_username || ""),
  };
}

function formatPunishmentBlockMessage(action, punishment = {}) {
  const payload = publicPunishmentPayload(punishment);
  const label = getPunishmentTypeLabel(payload.punishment_type);
  const expires = formatPunishmentExpires(payload);
  const reason = payload.reason ? ` Reason: ${payload.reason}` : "";
  if (action === "login") {
    return `This account has an active ${label} (${expires}).${reason}`;
  }
  if (action === "chat" || action === "broadcast") {
    return `You are muted (${expires}).${reason}`;
  }
  if (action === "trade") {
    return `You cannot trade right now (${expires}).${reason}`;
  }
  if (action === "world") {
    const worldText = payload.world ? ` in ${payload.world}` : "";
    return `You cannot enter or edit this world${worldText} (${expires}).${reason}`;
  }
  return `Action blocked by active ${label} (${expires}).${reason}`;
}

async function getActivePunishmentsCached(username, options = {}) {
  const cleanUsername = cleanAccountName(username);
  if (cleanUsername === "" || !isPostgresAuthoritativeReady()) return [];

  const cleanType = normalizeServerPunishmentType(options.punishment_type || options.type || "");
  const cleanScope = options.scope === undefined ? "" : String(options.scope || "").trim().toLowerCase();
  const cleanWorld = cleanScope === PUNISHMENT_SCOPE_WORLD ? cleanWorldNameForPunishment(options.world || options.world_name || "") : "";
  const cacheKey = getPunishmentCacheKey(cleanUsername, cleanType, cleanScope, cleanWorld);
  const cached = punishmentCache.get(cacheKey);
  if (cached && Number(cached.expiresAt || 0) > Date.now()) {
    return cached.rows;
  }

  const rows = await postgresStore.getActivePunishments(cleanUsername, {
    punishment_type: cleanType,
    scope: cleanScope,
    world: cleanWorld,
  });
  punishmentCache.set(cacheKey, {
    expiresAt: Date.now() + PUNISHMENT_CACHE_TTL_MS,
    rows,
  });
  return rows;
}

async function getBlockingPunishment(username, types = [], options = {}) {
  const requestedTypes = Array.isArray(types) ? types : [types];
  const typeSet = new Set(requestedTypes.map(normalizeServerPunishmentType).filter(Boolean));
  if (typeSet.size === 0) return null;

  const rows = await getActivePunishmentsCached(username, options);
  return rows.find((row) => typeSet.has(normalizeServerPunishmentType(row.punishment_type))) || null;
}

function sendPunishmentNotice(socket, player, message, punishment = null) {
  sendJson(socket, {
    type: "chat",
    player_id: "system",
    name: "System",
    message,
    world: player?.world || "",
    punishment: punishment ? publicPunishmentPayload(punishment) : undefined,
  });
}

async function rejectIfMuted(socket, player, action = "chat") {
  const punishment = await getBlockingPunishment(player?.account_username || "", ["mute"], {
    scope: PUNISHMENT_SCOPE_GLOBAL,
  });
  if (!punishment) return false;

  const message = formatPunishmentBlockMessage(action, punishment);
  sendPunishmentNotice(socket, player, message, punishment);
  logSecurityEvent(socket, player, "punishment_blocked_action", {
    action,
    punishment_type: "mute",
    punishment_id: punishment.punishment_id,
  }, "warning");
  return true;
}

async function rejectIfTradeBanned(socket, player, data = {}) {
  const punishment = await getBlockingPunishment(player?.account_username || "", ["trade_ban"], {
    scope: PUNISHMENT_SCOPE_GLOBAL,
  });
  if (!punishment) return false;

  const message = formatPunishmentBlockMessage("trade", punishment);
  sendTradeError(socket, data, message);
  logSecurityEvent(socket, player, "punishment_blocked_action", {
    action: "trade",
    punishment_type: "trade_ban",
    punishment_id: punishment.punishment_id,
  }, "warning");
  return true;
}

async function rejectIfWorldBanned(socket, player, worldName, action = "world") {
  const cleanWorldName = cleanWorldNameForPunishment(worldName);
  const punishment = await getBlockingPunishment(player?.account_username || "", ["world_ban"], {
    scope: PUNISHMENT_SCOPE_WORLD,
    world: cleanWorldName,
  });
  if (!punishment) return false;

  const message = formatPunishmentBlockMessage("world", punishment);
  sendActionRejected(socket, action, message, {
    world: cleanWorldName,
    punishment: publicPunishmentPayload(punishment),
  });
  logSecurityEvent(socket, player, "punishment_blocked_action", {
    action,
    world: cleanWorldName,
    punishment_type: "world_ban",
    punishment_id: punishment.punishment_id,
  }, "warning");
  return true;
}

function makeTradeSlots() {
  return Array.from({ length: TRADE_SLOT_COUNT }, () => null);
}

function getTradePartyIds(trade) {
  return [trade.requester_id, trade.target_id];
}

function getTradePartyName(trade, playerId) {
  if (playerId === trade.requester_id) return trade.requester_username;
  if (playerId === trade.target_id) return trade.target_username;
  return "Player";
}

function getOtherTradePartyId(trade, playerId) {
  if (playerId === trade.requester_id) return trade.target_id;
  if (playerId === trade.target_id) return trade.requester_id;
  return "";
}

function getTradeParticipantRecord(playerId) {
  const player = players.get(playerId);
  const socket = getSocketByPlayerId(playerId);
  if (!player || !socket) return null;
  return { player, socket };
}

function isTradeParticipant(trade, playerId) {
  return Boolean(trade && (trade.requester_id === playerId || trade.target_id === playerId));
}

function sendTradeError(socket, data, message) {
  sendJson(socket, {
    type: "trade_error",
    trade_id: String(data.trade_id || ""),
    message,
  });
}

function sendTradeChat(playerId, message) {
  const record = getTradeParticipantRecord(playerId);
  if (!record) return;

  sendJson(record.socket, {
    type: "chat",
    player_id: "system",
    name: "System",
    message,
    world: record.player.world,
  });
}

function serializeTradeSlots(slots) {
  const result = makeTradeSlots();
  if (!Array.isArray(slots)) return result;

  for (let i = 0; i < Math.min(slots.length, TRADE_SLOT_COUNT); i += 1) {
    const item = slots[i];
    if (!item) continue;
    const itemId = clampString(item.item_id || "");
    if (!ItemDatabase.hasItem(itemId)) continue;

    const itemCategory = resolveInventoryCategory(itemId, item.item_category || item.category || "");
    if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) continue;

    result[i] = {
      item_id: itemId,
      item_category: itemCategory,
      amount: clampInteger(item.amount || 0, 0, ItemDatabase.getStackLimit(itemId)),
    };
  }

  return result;
}

function buildTradeStateMessage(trade, message = "") {
  return {
    type: "trade_state",
    trade_id: trade.id,
    status: trade.status,
    world: trade.world,
    requester_player_id: trade.requester_id,
    requester_username: trade.requester_username,
    target_player_id: trade.target_id,
    target_username: trade.target_username,
    offers: {
      [trade.requester_id]: serializeTradeSlots(trade.offers[trade.requester_id]),
      [trade.target_id]: serializeTradeSlots(trade.offers[trade.target_id]),
    },
    accepted: {
      [trade.requester_id]: Boolean(trade.accepted[trade.requester_id]),
      [trade.target_id]: Boolean(trade.accepted[trade.target_id]),
    },
    final_accepted: {
      [trade.requester_id]: Boolean(trade.final_accepted[trade.requester_id]),
      [trade.target_id]: Boolean(trade.final_accepted[trade.target_id]),
    },
    message,
  };
}

function sendTradeState(trade, message = "") {
  const payload = buildTradeStateMessage(trade, message);

  for (const playerId of getTradePartyIds(trade)) {
    const record = getTradeParticipantRecord(playerId);
    if (!record) continue;
    sendJson(record.socket, payload);
  }
}

function clearTrade(trade) {
  if (!trade) return;
  activeTrades.delete(trade.id);
  tradeByPlayerId.delete(trade.requester_id);
  tradeByPlayerId.delete(trade.target_id);
}

function cancelTrade(trade, message = "Trade canceled.") {
  if (!trade) return;

  for (const playerId of getTradePartyIds(trade)) {
    const record = getTradeParticipantRecord(playerId);
    if (!record) continue;
    sendJson(record.socket, {
      type: "trade_canceled",
      trade_id: trade.id,
      message,
    });
    sendTradeChat(playerId, message);
  }

  clearTrade(trade);
}

function cancelActiveTradeForPlayer(playerId, message = "Trade canceled.") {
  const tradeId = tradeByPlayerId.get(playerId);
  if (!tradeId) return;
  cancelTrade(activeTrades.get(tradeId), message);
}

function findOnlinePlayerByPlayerId(playerId) {
  const cleanId = String(playerId || "").trim();
  if (cleanId === "") return null;

  const player = players.get(cleanId);
  const socket = getSocketByPlayerId(cleanId);
  if (!player || !socket) return null;
  return { player, socket };
}

function arePlayersCloseEnoughForTrade(playerA, playerB) {
  if (!playerA || !playerB) return false;
  if (playerA.world !== playerB.world) return false;

  const ax = Number(playerA.x);
  const ay = Number(playerA.y);
  const bx = Number(playerB.x);
  const by = Number(playerB.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return true;

  return Math.hypot(ax - bx, ay - by) <= MAX_TRADE_DISTANCE_PIXELS;
}

async function handleTradeRequest(socket, player, data) {
  if (!requireAuthenticated(socket, player, "trade")) return;

  if (tradeByPlayerId.has(player.id)) {
    sendTradeError(socket, data, "Finish your current trade first.");
    return;
  }

  const targetPlayerId = String(data.target_player_id || data.player_id || "").trim();
  const targetUsername = cleanAccountName(data.target_username || data.username || "");
  let targetRecord = targetPlayerId !== "" ? findOnlinePlayerByPlayerId(targetPlayerId) : null;

  if (!targetRecord && targetUsername !== "") {
    targetRecord = findOnlinePlayerByUsername(targetUsername);
  }

  if (!targetRecord || !targetRecord.player.authenticated) {
    sendTradeError(socket, data, "That player is not online.");
    return;
  }

  const target = targetRecord.player;
  if (target.id === player.id || accountKey(target.account_username) === accountKey(player.account_username)) {
    sendTradeError(socket, data, "You cannot trade with yourself.");
    return;
  }

  if (tradeByPlayerId.has(target.id)) {
    sendTradeError(socket, data, "That player is already trading.");
    return;
  }

  if (!arePlayersCloseEnoughForTrade(player, target)) {
    sendTradeError(socket, data, "Move closer to that player to trade.");
    return;
  }

  const targetPunishment = await getBlockingPunishment(target.account_username, ["trade_ban"], {
    scope: PUNISHMENT_SCOPE_GLOBAL,
  });
  if (targetPunishment) {
    sendTradeError(socket, data, `${target.account_username} cannot trade right now.`);
    sendPunishmentNotice(targetRecord.socket, target, formatPunishmentBlockMessage("trade", targetPunishment), targetPunishment);
    logSecurityEvent(socket, player, "punishment_blocked_trade_target", {
      target_username: target.account_username,
      punishment_type: "trade_ban",
      punishment_id: targetPunishment.punishment_id,
    }, "warning");
    return;
  }

  const tradeId = crypto.randomUUID();
  const trade = {
    id: tradeId,
    status: "pending",
    world: player.world,
    requester_id: player.id,
    requester_username: player.account_username,
    target_id: target.id,
    target_username: target.account_username,
    offers: {},
    accepted: {},
    final_accepted: {},
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  trade.offers[player.id] = makeTradeSlots();
  trade.offers[target.id] = makeTradeSlots();
  trade.accepted[player.id] = false;
  trade.accepted[target.id] = false;
  trade.final_accepted[player.id] = false;
  trade.final_accepted[target.id] = false;

  activeTrades.set(tradeId, trade);
  tradeByPlayerId.set(player.id, tradeId);
  tradeByPlayerId.set(target.id, tradeId);

  sendTradeChat(target.id, `${player.account_username} wants to trade with you.`);
  sendTradeChat(player.id, `Trade request sent to ${target.account_username}.`);
  sendJson(targetRecord.socket, {
    type: "trade_request_received",
    trade_id: trade.id,
    requester_player_id: trade.requester_id,
    requester_username: trade.requester_username,
    target_player_id: trade.target_id,
    target_username: trade.target_username,
    world: trade.world,
    message: `${trade.requester_username} wants to trade. Type /trade ${trade.requester_username} or wrench that player to accept.`,
  });
  sendJson(socket, {
    type: "trade_request_sent",
    trade_id: trade.id,
    requester_player_id: trade.requester_id,
    requester_username: trade.requester_username,
    target_player_id: trade.target_id,
    target_username: trade.target_username,
    world: trade.world,
    message: `Trade request sent to ${trade.target_username}.`,
  });
}

function sanitizeAccountNameArray(rawValue, limit = 200) {
  if (!Array.isArray(rawValue)) return [];

  const safe = [];
  const seen = new Set();
  for (const rawName of rawValue) {
    const clean = cleanAccountName(rawName);
    const key = accountKey(clean);
    if (clean === "" || key === "" || seen.has(key)) continue;

    seen.add(key);
    safe.push(clean);
    if (safe.length >= limit) break;
  }

  return safe;
}

function ensureFriendFields(account) {
  if (!account || typeof account !== "object" || Array.isArray(account)) return null;

  account.friends = sanitizeAccountNameArray(account.friends, 200);
  account.friend_requests_in = sanitizeAccountNameArray(account.friend_requests_in || account.pending_friend_requests || [], 200);
  account.friend_requests_out = sanitizeAccountNameArray(account.friend_requests_out || [], 200);
  return account;
}

function accountNameArrayHas(list, username) {
  const key = accountKey(username);
  if (key === "" || !Array.isArray(list)) return false;
  return list.some((entry) => accountKey(entry) === key);
}

function addAccountName(list, username) {
  const clean = cleanAccountName(username);
  if (clean === "") return sanitizeAccountNameArray(list, 200);

  const safe = sanitizeAccountNameArray(list, 200);
  if (!accountNameArrayHas(safe, clean)) safe.push(clean);
  return sanitizeAccountNameArray(safe, 200);
}

function removeAccountName(list, username) {
  const key = accountKey(username);
  if (key === "") return sanitizeAccountNameArray(list, 200);
  return sanitizeAccountNameArray(list, 200).filter((entry) => accountKey(entry) !== key);
}

function getAccountDisplayUsername(username) {
  const clean = cleanAccountName(username);
  if (clean === "") return "";
  const account = accounts.get(accountKey(clean));
  return account?.username || clean;
}

function getFriendAccount(username) {
  const clean = cleanAccountName(username);
  if (clean === "") return null;
  const account = accounts.get(accountKey(clean)) || null;
  return ensureFriendFields(account);
}

function buildFriendEntry(username) {
  const displayUsername = getAccountDisplayUsername(username);
  const onlineEntry = findOnlinePlayerByUsername(displayUsername);
  const onlinePlayer = onlineEntry ? onlineEntry.player : null;
  const account = accounts.get(accountKey(displayUsername)) || null;

  return {
    username: displayUsername,
    name: displayUsername,
    online: Boolean(onlinePlayer),
    offline: !onlinePlayer,
    player_id: onlinePlayer?.id || "",
    world: onlinePlayer?.world || "",
    current_world: onlinePlayer?.world || "",
    last_seen_at: account ? String(account.last_seen_at || "") : "",
  };
}

function getFriendStatus(viewerUsername, targetUsername) {
  const viewer = getFriendAccount(viewerUsername);
  const target = cleanAccountName(targetUsername);
  if (!viewer || target === "") return "none";
  if (accountKey(viewer.username) === accountKey(target)) return "self";
  if (accountNameArrayHas(viewer.friends, target)) return "friends";
  if (accountNameArrayHas(viewer.friend_requests_out, target)) return "outgoing";
  if (accountNameArrayHas(viewer.friend_requests_in, target)) return "incoming";
  return "none";
}

function buildFriendStatePayload(username, requestId = "") {
  const account = getFriendAccount(username);
  if (!account) {
    return {
      type: "friend_state",
      ok: false,
      request_id: requestId,
      message: "Account not found.",
      friends: [],
      pending_incoming: [],
      pending_outgoing: [],
    };
  }

  return {
    type: "friend_state",
    ok: true,
    request_id: requestId,
    username: account.username,
    friends: account.friends.map(buildFriendEntry),
    pending_incoming: account.friend_requests_in.map(buildFriendEntry),
    pending_outgoing: account.friend_requests_out.map(buildFriendEntry),
  };
}

function sendFriendState(socket, username, requestId = "") {
  sendJson(socket, buildFriendStatePayload(username, requestId));
}

function sendFriendError(socket, data, message) {
  sendJson(socket, {
    type: "friend_error",
    ok: false,
    request_id: makeRequestId(data),
    message,
  });
}

function handleFriendListRequest(socket, player, data) {
  if (!requireAuthenticated(socket, player, "friends")) return;
  sendFriendState(socket, player.account_username, makeRequestId(data));
}

function handleFriendRequest(socket, player, data) {
  if (!requireAuthenticated(socket, player, "send friend request")) return;

  const sender = getFriendAccount(player.account_username);
  const targetUsername = cleanAccountName(data.target_username || data.username || data.target || "");
  const target = getFriendAccount(targetUsername);
  if (!sender) {
    sendFriendError(socket, data, "Sign on before sending friend requests.");
    return;
  }
  if (!target) {
    sendFriendError(socket, data, "That username is not registered.");
    return;
  }
  if (accountKey(sender.username) === accountKey(target.username)) {
    sendFriendError(socket, data, "You cannot add yourself.");
    return;
  }
  if (accountNameArrayHas(sender.friends, target.username)) {
    sendJson(socket, {
      type: "friend_request_sent",
      ok: true,
      request_id: makeRequestId(data),
      target_username: target.username,
      friend_status: "friends",
      message: target.username + " is already your friend.",
    });
    sendFriendState(socket, sender.username, makeRequestId(data));
    return;
  }
  if (accountNameArrayHas(sender.friend_requests_out, target.username)) {
    sendJson(socket, {
      type: "friend_request_sent",
      ok: true,
      request_id: makeRequestId(data),
      target_username: target.username,
      friend_status: "outgoing",
      message: "Friend request already sent to " + target.username + ".",
    });
    sendFriendState(socket, sender.username, makeRequestId(data));
    return;
  }

  if (accountNameArrayHas(sender.friend_requests_in, target.username)) {
    sender.friend_requests_in = removeAccountName(sender.friend_requests_in, target.username);
    target.friend_requests_out = removeAccountName(target.friend_requests_out, sender.username);
    sender.friends = addAccountName(sender.friends, target.username);
    target.friends = addAccountName(target.friends, sender.username);
    queueAccountsSave();

    sendJson(socket, {
      type: "friend_request_accepted",
      ok: true,
      request_id: makeRequestId(data),
      friend_username: target.username,
      message: "You and " + target.username + " are now friends.",
    });
    sendFriendState(socket, sender.username, makeRequestId(data));

    const targetRecord = findOnlinePlayerByUsername(target.username);
    if (targetRecord) {
      sendJson(targetRecord.socket, {
        type: "friend_request_accepted",
        ok: true,
        friend_username: sender.username,
        message: sender.username + " accepted your friend request.",
      });
      sendFriendState(targetRecord.socket, target.username);
    }
    return;
  }

  sender.friend_requests_out = addAccountName(sender.friend_requests_out, target.username);
  target.friend_requests_in = addAccountName(target.friend_requests_in, sender.username);
  queueAccountsSave();

  sendJson(socket, {
    type: "friend_request_sent",
    ok: true,
    request_id: makeRequestId(data),
    target_username: target.username,
    friend_status: "outgoing",
    message: "Friend request sent to " + target.username + ".",
  });
  sendFriendState(socket, sender.username, makeRequestId(data));

  const targetRecord = findOnlinePlayerByUsername(target.username);
  if (targetRecord) {
    sendJson(targetRecord.socket, {
      type: "friend_request_received",
      ok: true,
      from_username: sender.username,
      requester_username: sender.username,
      message: sender.username + " sent you a friend request.",
    });
    sendFriendState(targetRecord.socket, target.username);
  }
}

function handleFriendResponse(socket, player, data) {
  if (!requireAuthenticated(socket, player, "answer friend request")) return;

  const receiver = getFriendAccount(player.account_username);
  const requesterUsername = cleanAccountName(data.from_username || data.requester_username || data.username || "");
  const requester = getFriendAccount(requesterUsername);
  const accepted = Boolean(data.accepted ?? data.accept ?? false);
  if (!receiver || !requester) {
    sendFriendError(socket, data, "Friend request not found.");
    return;
  }
  if (!accountNameArrayHas(receiver.friend_requests_in, requester.username)) {
    sendFriendError(socket, data, "No pending friend request from " + requester.username + ".");
    sendFriendState(socket, receiver.username, makeRequestId(data));
    return;
  }

  receiver.friend_requests_in = removeAccountName(receiver.friend_requests_in, requester.username);
  requester.friend_requests_out = removeAccountName(requester.friend_requests_out, receiver.username);

  if (accepted) {
    receiver.friends = addAccountName(receiver.friends, requester.username);
    requester.friends = addAccountName(requester.friends, receiver.username);
  }
  queueAccountsSave();

  sendJson(socket, {
    type: "friend_response_result",
    ok: true,
    accepted,
    request_id: makeRequestId(data),
    from_username: requester.username,
    friend_username: requester.username,
    message: accepted ? "You and " + requester.username + " are now friends." : "Declined friend request from " + requester.username + ".",
  });
  sendFriendState(socket, receiver.username, makeRequestId(data));

  const requesterRecord = findOnlinePlayerByUsername(requester.username);
  if (requesterRecord) {
    sendJson(requesterRecord.socket, {
      type: accepted ? "friend_request_accepted" : "friend_request_declined",
      ok: true,
      friend_username: receiver.username,
      from_username: receiver.username,
      message: accepted ? receiver.username + " accepted your friend request." : receiver.username + " declined your friend request.",
    });
    sendFriendState(requesterRecord.socket, requester.username);
  }
}

function notifyOnlineFriendsOfFriendState(username) {
  const account = getFriendAccount(username);
  if (!account) return;

  for (const friendUsername of account.friends) {
    const friendRecord = findOnlinePlayerByUsername(friendUsername);
    if (!friendRecord) continue;
    sendFriendState(friendRecord.socket, friendUsername);
  }
}

function handleTradeResponse(socket, player, data) {
  if (!requireAuthenticated(socket, player, "trade")) return;

  const trade = findTradeForResponse(player, data);
  if (!trade || !isTradeParticipant(trade, player.id)) {
    sendTradeError(socket, data, "Trade not found.");
    return;
  }

  if (trade.status !== "pending") {
    sendTradeError(socket, data, "That trade request is no longer pending.");
    return;
  }

  if (player.id !== trade.target_id) {
    sendTradeError(socket, data, "Only the requested player can accept this trade.");
    return;
  }

  const accepted = Boolean(data.accepted);
  if (!accepted) {
    cancelTrade(trade, `${player.account_username} declined the trade.`);
    return;
  }

  const requesterRecord = getTradeParticipantRecord(trade.requester_id);
  if (!requesterRecord || requesterRecord.player.world !== player.world) {
    cancelTrade(trade, "Trade canceled because a player is no longer available.");
    return;
  }

  trade.status = "active";
  trade.updated_at = Date.now();
  sendTradeState(trade, "Trade started.");
}

function findTradeForResponse(player, data) {
  const explicitTradeId = String(data.trade_id || "").trim();
  if (explicitTradeId !== "") return activeTrades.get(explicitTradeId);

  const requesterUsername = cleanAccountName(data.requester_username || data.target_username || data.username || "");
  if (requesterUsername !== "") {
    for (const trade of activeTrades.values()) {
      if (trade.status !== "pending") continue;
      if (trade.target_id !== player.id) continue;
      if (accountKey(trade.requester_username) !== accountKey(requesterUsername)) continue;
      return trade;
    }
  }

  const tradeId = tradeByPlayerId.get(player.id);
  return tradeId ? activeTrades.get(tradeId) : null;
}

function sanitizeTradeOfferItem(data) {
  const slotIndex = clampInteger(data.slot_index, 0, TRADE_SLOT_COUNT - 1);
  const amount = clampInteger(data.amount || 0, 0, MAX_ITEM_STACK);
  if (amount <= 0) {
    return { slotIndex, item: null };
  }

  const itemId = clampString(data.item_id || data.item_type || data.item || "");
  if (itemId === "" || itemId === "punch") return null;
  if (!ItemDatabase.hasItem(itemId)) return null;
  if (!ItemDatabase.isTradeableItem(itemId)) return null;

  const itemCategory = resolveInventoryCategory(itemId, data.item_category || data.category || "");
  if (itemId === "" || itemCategory === "" || itemId === "punch") return null;
  if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) return null;

  return {
    slotIndex,
    item: {
      item_id: itemId,
      item_category: itemCategory,
      amount: clampInteger(amount, 1, ItemDatabase.getStackLimit(itemId)),
    },
  };
}

function getTradeOfferTotals(slots, overrideSlot = -1, overrideItem = null) {
  const totals = new Map();

  for (let i = 0; i < TRADE_SLOT_COUNT; i += 1) {
    const item = i === overrideSlot ? overrideItem : slots[i];
    if (!item) continue;

    const itemId = clampString(item.item_id || "");
    if (!ItemDatabase.hasItem(itemId)) continue;
    const itemCategory = resolveInventoryCategory(itemId, item.item_category || "");
    const amount = clampInteger(item.amount || 0, 0, ItemDatabase.getStackLimit(itemId));
    if (itemId === "" || itemCategory === "" || amount <= 0) continue;
    if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) continue;

    const key = `${itemCategory}:${itemId}`;
    const existing = totals.get(key) || { item_id: itemId, item_category: itemCategory, amount: 0 };
    existing.amount = clampInteger(existing.amount + amount, 0, ItemDatabase.getStackLimit(itemId));
    totals.set(key, existing);
  }

  return Array.from(totals.values());
}

function canOfferTradeItems(username, slots, overrideSlot = -1, overrideItem = null) {
  const state = ensureWritablePlayerState(username);
  if (!state) return { ok: false, message: "Could not load server inventory." };

  const totals = getTradeOfferTotals(slots, overrideSlot, overrideItem);
  for (const item of totals) {
    if (!ItemDatabase.isTradeableItem(item.item_id)) {
      return { ok: false, message: `${item.item_id} cannot be traded.` };
    }

    if (getInventoryCount(state, item.item_id, item.item_category) < item.amount) {
      return { ok: false, message: `Not enough ${item.item_id}.` };
    }
  }

  return { ok: true };
}

function resetTradeApprovals(trade) {
  for (const playerId of getTradePartyIds(trade)) {
    trade.accepted[playerId] = false;
    trade.final_accepted[playerId] = false;
  }
}

function handleTradeOfferUpdate(socket, player, data) {
  if (!requireAuthenticated(socket, player, "trade")) return;

  const trade = activeTrades.get(String(data.trade_id || tradeByPlayerId.get(player.id) || ""));
  if (!trade || !isTradeParticipant(trade, player.id)) {
    sendTradeError(socket, data, "Trade not found.");
    return;
  }

  if (trade.status !== "active") {
    sendTradeError(socket, data, "You cannot change items during final confirmation.");
    return;
  }

  const parsed = sanitizeTradeOfferItem(data);
  if (!parsed) {
    sendTradeError(socket, data, "Invalid trade item.");
    return;
  }

  const offerSlots = trade.offers[player.id] || makeTradeSlots();
  const validation = canOfferTradeItems(player.account_username, offerSlots, parsed.slotIndex, parsed.item);
  if (!validation.ok) {
    sendTradeError(socket, data, validation.message);
    return;
  }

  offerSlots[parsed.slotIndex] = parsed.item;
  trade.offers[player.id] = offerSlots;
  resetTradeApprovals(trade);
  trade.updated_at = Date.now();
  sendTradeState(trade, "Trade offer updated.");
}

function handleTradeConfirm(socket, player, data) {
  if (!requireAuthenticated(socket, player, "trade")) return;

  const trade = activeTrades.get(String(data.trade_id || tradeByPlayerId.get(player.id) || ""));
  if (!trade || !isTradeParticipant(trade, player.id)) {
    sendTradeError(socket, data, "Trade not found.");
    return;
  }

  if (trade.status !== "active") {
    sendTradeError(socket, data, "Trade is not ready for confirmation.");
    return;
  }

  const validation = canOfferTradeItems(player.account_username, trade.offers[player.id] || makeTradeSlots());
  if (!validation.ok) {
    sendTradeError(socket, data, validation.message);
    return;
  }

  trade.accepted[player.id] = true;
  trade.updated_at = Date.now();

  if (getTradePartyIds(trade).every((playerId) => Boolean(trade.accepted[playerId]))) {
    trade.status = "final_pending";
    for (const playerId of getTradePartyIds(trade)) {
      trade.final_accepted[playerId] = false;
    }
    sendTradeState(trade, "Final confirmation required.");
    return;
  }

  sendTradeState(trade, `${player.account_username} accepted the trade.`);
}

async function handleTradeFinalConfirm(socket, player, data) {
  if (!requireAuthenticated(socket, player, "trade")) return;

  const trade = activeTrades.get(String(data.trade_id || tradeByPlayerId.get(player.id) || ""));
  if (!trade || !isTradeParticipant(trade, player.id)) {
    sendTradeError(socket, data, "Trade not found.");
    return;
  }

  if (trade.status !== "final_pending") {
    sendTradeError(socket, data, "Final confirmation is not ready.");
    return;
  }

  trade.final_accepted[player.id] = true;
  trade.updated_at = Date.now();

  if (getTradePartyIds(trade).every((playerId) => Boolean(trade.final_accepted[playerId]))) {
    await executeTrade(trade);
    return;
  }

  sendTradeState(trade, `${player.account_username} final-confirmed the trade.`);
}

function handleTradeCancel(socket, player, data) {
  if (!requireAuthenticated(socket, player, "trade")) return;

  const trade = activeTrades.get(String(data.trade_id || tradeByPlayerId.get(player.id) || ""));
  if (!trade || !isTradeParticipant(trade, player.id)) {
    sendTradeError(socket, data, "Trade not found.");
    return;
  }

  cancelTrade(trade, `${player.account_username} canceled the trade.`);
}

function validateFullTradeInventory(trade, stateA, stateB) {
  const offersA = getTradeOfferTotals(trade.offers[trade.requester_id] || makeTradeSlots());
  const offersB = getTradeOfferTotals(trade.offers[trade.target_id] || makeTradeSlots());
  const stagedA = cloneJson(stateA);
  const stagedB = cloneJson(stateB);

  for (const item of offersA) {
    if (!ItemDatabase.isTradeableItem(item.item_id)) {
      return { ok: false, message: `${item.item_id} cannot be traded.` };
    }
    if (!spendItemFromState(stagedA, item.item_id, item.item_category, item.amount)) {
      return { ok: false, message: `${trade.requester_username} no longer has enough ${item.item_id}.` };
    }
  }

  for (const item of offersB) {
    if (!ItemDatabase.isTradeableItem(item.item_id)) {
      return { ok: false, message: `${item.item_id} cannot be traded.` };
    }
    if (!spendItemFromState(stagedB, item.item_id, item.item_category, item.amount)) {
      return { ok: false, message: `${trade.target_username} no longer has enough ${item.item_id}.` };
    }
  }

  for (const item of offersA) {
    if (!canAddItemToState(stagedB, item.item_id, item.item_category, item.amount)) {
      return { ok: false, message: `${trade.target_username} cannot hold ${item.item_id}.` };
    }
    addItemToState(stagedB, item.item_id, item.item_category, item.amount);
  }

  for (const item of offersB) {
    if (!canAddItemToState(stagedA, item.item_id, item.item_category, item.amount)) {
      return { ok: false, message: `${trade.requester_username} cannot hold ${item.item_id}.` };
    }
    addItemToState(stagedA, item.item_id, item.item_category, item.amount);
  }

  return { ok: true, offersA, offersB };
}

function applyValidatedTrade(stateA, stateB, offersA, offersB) {
  for (const item of offersA) {
    if (!spendItemFromState(stateA, item.item_id, item.item_category, item.amount)) {
      return false;
    }
  }

  for (const item of offersB) {
    if (!spendItemFromState(stateB, item.item_id, item.item_category, item.amount)) {
      return false;
    }
  }

  for (const item of offersA) {
    if (!addItemToState(stateB, item.item_id, item.item_category, item.amount)) {
      return false;
    }
  }

  for (const item of offersB) {
    if (!addItemToState(stateA, item.item_id, item.item_category, item.amount)) {
      return false;
    }
  }

  return true;
}

async function executeTrade(trade) {
  if (!trade || !trade.id) return;
  if (trade._finalizing) {
    return;
  }

  const requesterRecord = getTradeParticipantRecord(trade.requester_id);
  const targetRecord = getTradeParticipantRecord(trade.target_id);
  if (!requesterRecord || !targetRecord) {
    cancelTrade(trade, "Trade canceled because a player is no longer online.");
    return;
  }

  const tradeWorld = cleanWorld(trade.world || "START");
  if (cleanWorld(requesterRecord.player.world || "START") !== tradeWorld || cleanWorld(targetRecord.player.world || "START") !== tradeWorld) {
    cancelTrade(trade, "Trade canceled because a player left the trade world.");
    return;
  }

  if (!arePlayersCloseEnoughForTrade(requesterRecord.player, targetRecord.player)) {
    cancelTrade(trade, "Trade canceled because players moved too far apart.");
    return;
  }

  trade._finalizing = true;
  let inventoryLocks = null;
  const tradeTransactionId = makeAuditId("trade");

  try {
    inventoryLocks = await acquirePlayerInventoryLocks(
      [trade.requester_username, trade.target_username],
      `trade:${trade.id}`
    );
    if (!inventoryLocks.acquired) {
      cancelTrade(trade, "Trade canceled because an inventory is busy. Try again.");
      return;
    }

    const stateA = ensureWritablePlayerState(trade.requester_username);
    const stateB = ensureWritablePlayerState(trade.target_username);
    if (!stateA || !stateB) {
      cancelTrade(trade, "Trade canceled because server inventory could not be loaded.");
      return;
    }

    const validation = validateFullTradeInventory(trade, stateA, stateB);
    if (!validation.ok) {
      cancelTrade(trade, validation.message);
      return;
    }

    const tradeResult = await postgresStore.applyTradeFinalizationTransaction({
      requester_username: trade.requester_username,
      target_username: trade.target_username,
      trade_id: trade.id,
      world: trade.world || "START",
      requester_offers: validation.offersA,
      target_offers: validation.offersB,
      requester_inventory_baseline: buildInventoryBaselineForItems(stateA, validation.offersA.concat(validation.offersB)),
      target_inventory_baseline: buildInventoryBaselineForItems(stateB, validation.offersA.concat(validation.offersB)),
      request_id: tradeTransactionId,
      ip_address: getSocketAddress(requesterRecord.socket),
    });

    if (!tradeResult.ok) {
      cancelTrade(trade, "Trade was canceled because server inventory changed. Try again.");
      return;
    }

    if (!applyInventoryLedgerToState(stateA, tradeResult.request_ledgers?.requester)) {
      cancelTrade(trade, "Trade was canceled because inventory reconciliation failed.");
      return;
    }
    if (!applyInventoryLedgerToState(stateB, tradeResult.request_ledgers?.target)) {
      cancelTrade(trade, "Trade was canceled because inventory reconciliation failed.");
      return;
    }

    persistPlayerInventoryChange(trade.requester_username, stateA);
    persistPlayerInventoryChange(trade.target_username, stateB);

    logTradeTransaction({
      transaction_id: tradeTransactionId,
      trade_id: trade.id,
      status: "completed",
      requester_username: trade.requester_username,
      target_username: trade.target_username,
      requester_offer: validation.offersA,
      target_offer: validation.offersB,
    });
    for (const item of validation.offersA) {
      logItemLedgerForState(requesterRecord.socket, requesterRecord.player, trade.requester_username, stateA, item.item_id, item.item_category, -item.amount, "trade", tradeTransactionId, "trade_sent", requesterRecord.player.world, { trade_id: trade.id, counterparty: trade.target_username }, { skipPostgres: true });
      logItemLedgerForState(targetRecord.socket, targetRecord.player, trade.target_username, stateB, item.item_id, item.item_category, item.amount, "trade", tradeTransactionId, "trade_received", targetRecord.player.world, { trade_id: trade.id, counterparty: trade.requester_username }, { skipPostgres: true });
    }
    for (const item of validation.offersB) {
      logItemLedgerForState(targetRecord.socket, targetRecord.player, trade.target_username, stateB, item.item_id, item.item_category, -item.amount, "trade", tradeTransactionId, "trade_sent", targetRecord.player.world, { trade_id: trade.id, counterparty: trade.requester_username }, { skipPostgres: true });
      logItemLedgerForState(requesterRecord.socket, requesterRecord.player, trade.requester_username, stateA, item.item_id, item.item_category, item.amount, "trade", tradeTransactionId, "trade_received", requesterRecord.player.world, { trade_id: trade.id, counterparty: trade.target_username }, { skipPostgres: true });
    }

    sendJson(requesterRecord.socket, {
      type: "trade_completed",
      trade_id: trade.id,
      message: "Trade completed.",
      username: trade.requester_username,
      player_data: stateA,
    });

    sendJson(targetRecord.socket, {
      type: "trade_completed",
      trade_id: trade.id,
      message: "Trade completed.",
      username: trade.target_username,
      player_data: stateB,
    });

    sendTradeChat(trade.requester_id, "Trade completed.");
    sendTradeChat(trade.target_id, "Trade completed.");
    clearTrade(trade);
  } finally {
    releasePlayerInventoryLocks(inventoryLocks);
    trade._finalizing = false;
  }
}

async function handleInventoryTransactionRequest(socket, player, data) {
  if (!requireAuthenticated(socket, player, "change inventory")) return;

  const action = String(data.action || "").trim();
  if (action === "shop_buy") {
    await handleShopBuyTransaction(socket, player, data);
    return;
  }

  if (action === "vend_get_state" || action === "vend_set_listing" || action === "vend_buy" || action === "vend_collect" || action === "vend_cancel") {
    await handleVendingTransaction(socket, player, data);
    return;
  }

  if (action === "safe_get_state" || action === "safe_deposit" || action === "safe_withdraw") {
    await handleSafeTransaction(socket, player, data);
    return;
  }

  if (action === "craft_recipe" || action === "furnace_recipe") {
    await handleStationRecipeTransaction(socket, player, data);
    return;
  }

  if (action === "fishing_start") {
    await handleFishingStartTransaction(socket, player, data);
    return;
  }

  if (action === "fishing_complete") {
    await handleFishingCompleteTransaction(socket, player, data);
    return;
  }

  if (action === "fish_monger_sell" || action === "fish_monger_sell_all") {
    await handleFishMongerTransaction(socket, player, data);
    return;
  }

  if (action === "drop_inventory_item") {
    await handleDropInventoryItemTransaction(socket, player, data);
    return;
  }

  if (action === "trash_inventory_item") {
    await handleTrashInventoryItemTransaction(socket, player, data);
    return;
  }

  if (action === "convert_world_lock") {
    await handleWorldLockConversionTransaction(socket, player, data);
    return;
  }

  if (action === "seed_place") {
    await handleSeedPlaceTransaction(socket, player, data);
    return;
  }

  if (action === "seed_splice") {
    await handleSeedSpliceTransaction(socket, player, data);
    return;
  }

  if (action === "seed_harvest") {
    await handleSeedHarvestTransaction(socket, player, data);
    return;
  }

  sendInventoryTransactionRejected(socket, data, "Unknown inventory transaction.");
}

async function handleShopBuyTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const itemId = clampString(data.item_id || data.item || "");
  const listing = SHOP_CATALOG.get(itemId);
  if (!listing) {
    sendInventoryTransactionRejected(socket, data, "Shop item is not sold by the server.");
    return;
  }

  if (!ItemDatabase.hasItem(listing.item_id) || !ItemDatabase.canStoreItemInCategory(listing.item_id, listing.item_category)) {
    sendInventoryTransactionRejected(socket, data, "Shop item is not valid on the server.");
    return;
  }

  const packRewardTable = itemId === "lure_pack"
    ? LURE_PACK_TABLE
    : (itemId === "basic_items_pack"
      ? BASIC_ITEMS_PACK_TABLE
      : (itemId === "prestige_coloured_block_pack" ? PRESTIGE_COLOURED_BLOCK_PACK_TABLE : null));

  if (packRewardTable) {
    const rewardTableValid = packRewardTable.every((reward) => (
      ItemDatabase.hasItem(reward.item_id) &&
      ItemDatabase.canStoreItemInCategory(reward.item_id, reward.item_category)
    ));
    if (!rewardTableValid) {
      sendInventoryTransactionRejected(socket, data, "Shop pack rewards are not configured.");
      return;
    }
  }

  const requestedAmount = clampInteger(data.amount || listing.amount, 1, ItemDatabase.getStackLimit(listing.item_id));
  const requestedPrice = clampInteger(data.price || listing.price, 0, MAX_SHOP_PRICE);
  if (requestedAmount !== listing.amount || requestedPrice !== listing.price) {
    sendInventoryTransactionRejected(socket, data, "Shop price changed. Reopen the shop.");
    return;
  }

  const username = player.account_username;
  const state = ensureWritablePlayerState(username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, "Could not load your server inventory.");
    return;
  }
  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);

  if (!spendItemFromState(stagedState, "gem", "currency", listing.price)) {
    sendInventoryTransactionRejected(socket, data, "Not enough gems.");
    return;
  }

  const rewards = [];
  if (packRewardTable) {
    for (let i = 0; i < listing.pack_size * listing.amount; i += 1) {
      const reward = rollWeightedReward(packRewardTable);
      addItemToState(stagedState, reward.item_id, reward.item_category, 1);
      rewards.push({
        item_id: reward.item_id,
        item_category: reward.item_category,
        amount: 1,
      });
    }
  } else {
    addItemToState(stagedState, listing.item_id, listing.item_category, listing.amount);
    rewards.push({
      item_id: listing.item_id,
      item_category: listing.item_category,
      amount: listing.amount,
    });
  }

  const purchaseId = makeAuditId("shop");
  const commit = await commitPlayerInventoryState(socket, player, username, beforeState, stagedState, {
    source: "shop",
    action: "shop_purchase",
    reason: "shop_buy",
    request_id: requestId,
    world: player.world || "START",
    metadata: { listing_id: itemId, purchase_id: purchaseId },
    failure_message: "Shop inventory changed. Try again.",
  });
  if (!commit.ok) {
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  const combinedRewards = combineRewardEntries(rewards);
  const gemBalanceAfter = getInventoryCount(committedState, "gem", "currency");
  logShopPurchase(socket, player, {
    purchase_id: purchaseId,
    account_username: username,
    listing_id: itemId,
    item_id: listing.item_id,
    price_gems: listing.price,
    rewards: combinedRewards,
    gem_balance_after: gemBalanceAfter,
  });
  logItemLedgerForState(
    socket,
    player,
    username,
    committedState,
    "gem",
    "currency",
    -listing.price,
    "shop_purchase",
    purchaseId,
    "shop_price",
    player.world,
    { listing_id: itemId },
    { skipPostgres: commit.postgres_committed }
  );
  logRewardLedgers(socket, player, username, committedState, combinedRewards, "shop_purchase", purchaseId, "shop_reward", player.world, { listing_id: itemId }, { skipPostgres: commit.postgres_committed });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "shop_buy",
    item_id: itemId,
    message: itemId === "lure_pack"
      ? "Purchased and opened Lure Pack."
      : (itemId === "basic_items_pack"
        ? "Purchased and opened Basic Items Pack."
        : (itemId === "prestige_coloured_block_pack" ? "Purchased and opened Prestige Coloured Block Pack." : `Purchased ${listing.item_id}.`)),
    username,
    rewards: combinedRewards,
    player_data: committedState,
  });
}

function isVendBlockType(blockType) {
  return VEND_BLOCK_TYPES.has(clampString(blockType || ""));
}

function makeEmptyVendState(worldName, x, y) {
  return {
    action: "vend_state",
    world: cleanWorld(worldName),
    x: Math.trunc(Number(x) || 0),
    y: Math.trunc(Number(y) || 0),
    owner_username: "",
    owner_name: "",
    listing: null,
    pending_wls: 0,
    logs: [],
    updated_at: new Date().toISOString(),
  };
}

function sanitizeVendListing(rawListing) {
  if (!rawListing || typeof rawListing !== "object" || Array.isArray(rawListing)) return null;

  const itemId = clampString(rawListing.item_id || rawListing.item_type || "");
  if (itemId === "" || !ItemDatabase.hasItem(itemId)) return null;

  const itemCategory = resolveInventoryCategory(itemId, rawListing.item_category || rawListing.category || "");
  if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) return null;

  const stackLimit = ItemDatabase.getStackLimit(itemId);
  const stock = clampInteger(rawListing.stock || rawListing.amount || 0, 0, stackLimit);
  const amountPerSale = clampInteger(rawListing.amount_per_sale || rawListing.per_sale || 1, 1, stackLimit);
  const priceWls = clampInteger(rawListing.price_wls || rawListing.price || 1, 1, ItemDatabase.getStackLimit("world_lock"));

  if (stock <= 0 || amountPerSale <= 0 || stock < amountPerSale) return null;

  return {
    item_id: itemId,
    item_category: itemCategory,
    stock,
    amount_per_sale: amountPerSale,
    price_wls: priceWls,
    created_at: String(rawListing.created_at || new Date().toISOString()),
  };
}

function sanitizeVendLogEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;

  const buyerName = cleanAccountName(rawEntry.buyer_username || rawEntry.buyer_name || "");
  const itemId = clampString(rawEntry.item_id || "");
  if (buyerName === "" || itemId === "" || !ItemDatabase.hasItem(itemId)) return null;

  const itemCategory = resolveInventoryCategory(itemId, rawEntry.item_category || "");
  if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) return null;

  return {
    buyer_username: buyerName,
    item_id: itemId,
    item_category: itemCategory,
    amount: clampInteger(rawEntry.amount || 0, 1, ItemDatabase.getStackLimit(itemId)),
    price_wls: clampInteger(rawEntry.price_wls || 0, 0, ItemDatabase.getStackLimit("world_lock")),
    date: String(rawEntry.date || rawEntry.sold_at || new Date().toISOString()),
  };
}

function sanitizeVendState(rawEntry, worldName, x, y) {
  const safe = makeEmptyVendState(worldName, x, y);
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return safe;

  safe.owner_username = cleanAccountName(rawEntry.owner_username || rawEntry.owner_name || "");
  safe.owner_name = safe.owner_username.toUpperCase();
  safe.listing = sanitizeVendListing(rawEntry.listing);
  safe.pending_wls = clampInteger(rawEntry.pending_wls || rawEntry.pending_world_locks || 0, 0, ItemDatabase.getStackLimit("world_lock"));
  safe.updated_at = String(rawEntry.updated_at || safe.updated_at);

  const rawLogs = Array.isArray(rawEntry.logs) ? rawEntry.logs : [];
  safe.logs = rawLogs
    .map(sanitizeVendLogEntry)
    .filter(Boolean)
    .slice(-VEND_LOG_LIMIT);

  if (!safe.listing && safe.pending_wls <= 0) {
    safe.owner_name = safe.owner_username.toUpperCase();
  }

  return safe;
}

function getVendStatus(vend) {
  if (!vend) return "empty";
  if (Number(vend.pending_wls) > 0) return "sold";
  if (vend.listing && Number(vend.listing.stock) > 0) return "listed";
  return "empty";
}

function isVendAwaitingCollection(vend) {
  if (!vend) return false;
  if (Number(vend.pending_wls) > 0) return true;
  return String(vend.status || "").trim().toLowerCase() === "sold";
}

function getVendVisualBlockType(vend) {
  const status = getVendStatus(vend);
  if (status === "sold") return VEND_BLOCK_SOLD;
  if (status === "listed") return VEND_BLOCK_PENDING;
  return VEND_BLOCK_EMPTY;
}

function serializeVendStateForClient(vend, player = null) {
  const safe = sanitizeVendState(vend, vend?.world || "", vend?.x || 0, vend?.y || 0);
  return {
    action: "vend_state",
    world: cleanWorld(safe.world || ""),
    x: safe.x,
    y: safe.y,
    owner_username: safe.owner_username,
    owner_name: safe.owner_name,
    listing: safe.listing ? { ...safe.listing } : {},
    pending_wls: safe.pending_wls,
    logs: safe.logs.map((entry) => ({ ...entry })),
    status: getVendStatus(safe),
    can_manage: canPlayerManageVend(player, safe, safe.world),
  };
}

function isWorldLocked(worldName) {
  const state = ensureWorldState(worldName);
  return Boolean(state.world_lock?.is_locked);
}

function normalizeWorldLockBlockType(blockType) {
  const clean = clampString(blockType || "").toLowerCase();
  if (clean === SUPER_WORLD_LOCK_BLOCK_TYPE) return SUPER_WORLD_LOCK_BLOCK_TYPE;
  return WORLD_LOCK_BLOCK_TYPE;
}

function isWorldLockBlockType(blockType) {
  const clean = clampString(blockType || "").toLowerCase();
  return clean === WORLD_LOCK_BLOCK_TYPE || clean === SUPER_WORLD_LOCK_BLOCK_TYPE;
}

function hasWorldLockBlock(worldName) {
  const state = ensureWorldState(worldName);
  for (const block of state.foreground.values()) {
    if (isWorldLockBlockType(block?.block_type || "")) {
      return true;
    }
  }
  return false;
}

function isActiveWorldLockGrid(state, x, y) {
  const lock = state.world_lock || {};
  if (!lock.is_locked) return false;

  const lockGridX = Math.trunc(Number(lock.lock_grid_x));
  const lockGridY = Math.trunc(Number(lock.lock_grid_y));
  if (!Number.isFinite(lockGridX) || !Number.isFinite(lockGridY) || lockGridX === 999999 || lockGridY === 999999) {
    return true;
  }

  return lockGridX === Math.trunc(Number(x) || 0) && lockGridY === Math.trunc(Number(y) || 0);
}

function shouldApplyWorldLockStateForBlockUpdate(worldName, update) {
  if (!update || update.layer !== "foreground" || !isWorldLockBlockType(update.block_type)) return false;
  if (update.action === "place") return true;
  if (update.action !== "break") return false;

  const state = ensureWorldState(worldName);
  return isActiveWorldLockGrid(state, update.x, update.y);
}

function makeWorldLockStateForPlacement(player, update) {
  const lockBlockType = normalizeWorldLockBlockType(update?.block_type || WORLD_LOCK_BLOCK_TYPE);
  return sanitizeWorldLockState({
    is_locked: true,
    owner_name: cleanAccountName(player?.account_username || player?.name || "").toUpperCase(),
    lock_block_type: lockBlockType,
    lock_type: lockBlockType,
    lock_grid_x: update.x,
    lock_grid_y: update.y,
    allowed_players: [],
    player_roles: {},
    public_build: false,
    trusted_builder_slot_limit: DEFAULT_TRUSTED_BUILDER_SLOT_LIMIT,
  });
}

function makeWorldLockStatePayload(worldName, state) {
  return {
    type: "world_interaction_update",
    world: cleanWorld(worldName),
    action: "world_lock_state",
    state: sanitizeWorldLockState(state || {}),
  };
}

function applyWorldLockStateForBlockUpdate(worldName, update, player, shouldApplyState) {
  if (!shouldApplyState) return null;

  const state = ensureWorldState(worldName);
  if (update.action === "place") {
    state.world_lock = makeWorldLockStateForPlacement(player, update);
    return makeWorldLockStatePayload(worldName, state.world_lock);
  }

  if (update.action === "break") {
    state.world_lock = {};
    return makeWorldLockStatePayload(worldName, state.world_lock);
  }

  return null;
}

function getWorldLockProtectedStorageBlocks(worldName) {
  const state = ensureWorldState(worldName);
  const protectedBlocks = [];

  for (const block of state.foreground.values()) {
    const blockType = clampString(block?.block_type || "");
    if (isVendBlockType(blockType) || isSafeBlockType(blockType) || isFishMongerBlockType(blockType)) {
      protectedBlocks.push(block);
    }
  }

  return protectedBlocks;
}

function hasWorldLockProtectedStorageBlocks(worldName) {
  return getWorldLockProtectedStorageBlocks(worldName).length > 0;
}

function canPlayerUseWorldLockAccess(player, worldName) {
  if (isAdmin(player)) return true;
  if (!player || !player.authenticated) return false;

  const state = ensureWorldState(worldName);
  const lock = state.world_lock || {};
  if (!lock.is_locked) return false;

  const playerKey = accountKey(player.account_username);
  if (playerKey === "") return false;
  if (accountKey(lock.owner_name || lock.owner_username || "") === playerKey) return true;

  const allowedPlayers = Array.isArray(lock.allowed_players) ? lock.allowed_players : [];
  return allowedPlayers.some((name) => accountKey(name) === playerKey);
}

function canPlayerPlaceVendingMachine(player, worldName) {
  if (!player || !player.authenticated) return false;
  return isWorldLocked(worldName) && isPlayerWorldOwner(player, worldName);
}

function canPlayerManageVend(player, vend, worldName = "") {
  if (!player || !player.authenticated) return false;

  const cleanWorldName = cleanWorld(worldName || vend?.world || "");
  return isWorldLocked(cleanWorldName) && isPlayerWorldOwner(player, cleanWorldName);
}

function canPlayerBreakVendingMachine(player, worldName, update) {
  if (!player || !player.authenticated) return false;
  if (!update || (update.action !== "break" && update.action !== "hit") || update.layer === "background") return false;

  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(update.x, update.y));
  if (!block || !isVendBlockType(block.block_type)) return false;

  return isWorldLocked(worldName) && isPlayerWorldOwner(player, worldName);
}

function canPlayerBreakOwnVendingMachine(player, worldName, update) {
  return canPlayerBreakVendingMachine(player, worldName, update);
}

function isFishMongerBlockType(blockType) {
  return clampString(blockType || "") === FISH_MONGER_BLOCK_TYPE;
}

function getCollisionAreaAnchorInState(state, x, y) {
  if (!state) return null;

  const directKey = gridKey(x, y);
  const directBlock = state.foreground.get(directKey);
  if (directBlock) return directBlock;

  const tileRect = {
    x: (Number(x) || 0) * TILE_SIZE - TILE_SIZE * 0.5 + 0.01,
    y: (Number(y) || 0) * TILE_SIZE - TILE_SIZE * 0.5 + 0.01,
    width: TILE_SIZE - 0.02,
    height: TILE_SIZE - 0.02,
  };

  for (const block of state.foreground.values()) {
    const blockType = clampString(block?.block_type || "");
    if (!blockOccupiesCollisionArea(blockType)) continue;

    const blockRect = getBlockCollisionRectForGrid(block.x, block.y, blockType);
    if (rectsIntersect(blockRect, tileRect)) {
      return block;
    }
  }

  return null;
}

function getFishMongerAnchorAt(worldName, x, y) {
  const state = ensureWorldState(worldName);
  const anchor = getCollisionAreaAnchorInState(state, x, y);
  if (!anchor || !isFishMongerBlockType(anchor.block_type)) return null;
  return anchor;
}

function isFishMongerBreakAttempt(worldName, update) {
  if (!update || (update.action !== "break" && update.action !== "hit") || update.layer === "background") return false;
  if (isFishMongerBlockType(update.block_type)) return true;
  return getFishMongerAnchorAt(worldName, update.x, update.y) !== null;
}

function canPlayerPlaceFishMonger(player, worldName) {
  if (!player || !player.authenticated) return false;
  return isWorldLocked(worldName) && canPlayerBuildInWorld(player, worldName);
}

function canPlayerBreakFishMonger(player, worldName, update) {
  if (!player || !player.authenticated) return false;
  if (!update || (update.action !== "break" && update.action !== "hit") || update.layer === "background") return false;

  const block = getFishMongerAnchorAt(worldName, update.x, update.y);
  if (!block) return false;

  return canPlayerUseWorldLockAccess(player, worldName);
}

function canListItemInVend(itemId, itemCategory) {
  const cleanItemId = clampString(itemId || "");
  if (cleanItemId === "" || !ItemDatabase.hasItem(cleanItemId)) return false;
  if (cleanItemId === "punch" || isWorldLockBlockType(cleanItemId)) return false;
  if (isVendBlockType(cleanItemId)) return false;

  const definition = ItemDatabase.getItemDefinition(cleanItemId);
  if (!definition || definition.hidden) return false;

  const resolvedCategory = resolveInventoryCategory(cleanItemId, itemCategory);
  return ItemDatabase.canStoreItemInCategory(cleanItemId, resolvedCategory) && ItemDatabase.isTradeableItem(cleanItemId);
}

function getVendStateAt(worldName, x, y, createIfMissing = false) {
  const state = ensureWorldState(worldName);
  const key = gridKey(x, y);
  const existing = state.interactions.get(key);

  if (existing && existing.action === "vend_state") {
    const safe = sanitizeVendState(existing, worldName, x, y);
    state.interactions.set(key, safe);
    return safe;
  }

  const empty = makeEmptyVendState(worldName, x, y);
  if (createIfMissing) {
    state.interactions.set(key, empty);
  }
  return empty;
}

function setVendStateAt(worldName, vend) {
  const state = ensureWorldState(worldName);
  const safe = sanitizeVendState(vend, worldName, vend.x, vend.y);
  safe.updated_at = new Date().toISOString();
  state.interactions.set(gridKey(safe.x, safe.y), safe);
  return safe;
}

function clearVendOwnerIfEmpty(vend) {
  if (vend && accountKey(vend.owner_username || "") !== "") {
    vend.owner_name = cleanAccountName(vend.owner_username).toUpperCase();
  }
}

function initializeVendOwnerOnPlace(worldName, update, player) {
  if (!player || !player.authenticated) return;
  const vend = makeEmptyVendState(worldName, update.x, update.y);
  vend.owner_username = player.account_username;
  vend.owner_name = player.account_username.toUpperCase();
  setVendStateAt(worldName, vend);
}

function syncVendVisualBlock(worldName, vend) {
  const state = ensureWorldState(worldName);
  const key = gridKey(vend.x, vend.y);
  const block = state.foreground.get(key);
  if (!block || !isVendBlockType(block.block_type)) return "";

  const blockType = getVendVisualBlockType(vend);
  block.block_type = blockType;
  return blockType;
}

function sendVendStateUpdateToWorld(worldName, vend) {
  const blockType = syncVendVisualBlock(worldName, vend);
  if (blockType !== "") {
    broadcastToWorld(worldName, {
      type: "world_block_update",
      action: "place",
      layer: "foreground",
      x: vend.x,
      y: vend.y,
      block_type: blockType,
      world: cleanWorld(worldName),
    });
  }

  broadcastToWorld(worldName, {
    type: "world_interaction_update",
    ...serializeVendStateForClient(vend),
    world: cleanWorld(worldName),
  });
}

function sendVendPurchaseSoundToRequesterAndWorld(socket, player, worldName, vend) {
  if (!vend) return;

  const x = Math.trunc(Number(vend.x));
  const y = Math.trunc(Number(vend.y));
  if (!isGridInWorld(x, y)) return;

  sendWorldUpdateToRequesterAndWorld(socket, player, worldName, {
    type: "world_interaction_update",
    action: "vend_purchase_sound",
    x,
    y,
    world: cleanWorld(worldName),
  });
}

function validateVendAccess(socket, player, data, worldName, grid) {
  if (!grid) {
    sendInventoryTransactionRejected(socket, data, "Vending machine position is missing.");
    return false;
  }

  if (!isPlayerNearGrid(player, grid.x, grid.y)) {
    sendInventoryTransactionRejected(socket, data, "Too far away from that vending machine.");
    return false;
  }

  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(grid.x, grid.y));
  if (!block || !isVendBlockType(block.block_type)) {
    sendInventoryTransactionRejected(socket, data, "That is not a vending machine.");
    return false;
  }

  return true;
}

function sendVendTransactionResult(socket, data, player, vend, ok, message, playerState = null) {
  sendInventoryTransactionResult(socket, {
    ok,
    request_id: makeRequestId(data),
    action: String(data.action || ""),
    message,
    username: player?.account_username || "",
    player_data: playerState || (player ? ensurePlayerState(player.account_username) || {} : {}),
    vend_state: vend ? serializeVendStateForClient(vend, player) : {},
  });
}

function rejectVendTransaction(socket, data, message) {
  sendInventoryTransactionResult(socket, {
    ok: false,
    request_id: makeRequestId(data),
    action: String(data.action || ""),
    message,
    vend_state: {},
  });
}

async function handleVendingTransaction(socket, player, data) {
  const action = String(data.action || "").trim();
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "use that vending machine")) return;
  if (await rejectIfWorldBanned(socket, player, worldName, "vending")) return;

  const grid = getTransactionGrid(data);
  if (!validateVendAccess(socket, player, data, worldName, grid)) return;

  if (!isWorldLocked(worldName)) {
    rejectVendTransaction(socket, data, "Lock the world before using vending machines.");
    return;
  }

  const vend = getVendStateAt(worldName, grid.x, grid.y, true);

  if (action === "vend_get_state") {
    sendVendTransactionResult(socket, data, player, vend, true, "");
    return;
  }

  if (tradeByPlayerId.has(player.id)) {
    rejectVendTransaction(socket, data, "Finish or cancel your trade before using a vending machine.");
    return;
  }

  if (action === "vend_set_listing") {
    await handleVendSetListing(socket, player, data, worldName, vend);
    return;
  }

  if (action === "vend_buy") {
    await handleVendBuy(socket, player, data, worldName, vend);
    return;
  }

  if (action === "vend_collect") {
    await handleVendCollect(socket, player, data, worldName, vend);
    return;
  }

  if (action === "vend_cancel") {
    await handleVendCancel(socket, player, data, worldName, vend);
    return;
  }

  rejectVendTransaction(socket, data, "Unknown vending action.");
}

async function acquireVendMutationLock(socket, player, data, worldName, vend) {
  const vendActionKey = `${worldName}:${vend.x},${vend.y}`;
  const vendLock = await acquireLiveActionLock(worldVendActionLocks, "vend", vendActionKey, player.id);
  if (!vendLock.acquired) {
    rejectVendTransaction(socket, data, "That vending machine is busy.");
    return null;
  }

  return vendLock;
}

async function handleVendSetListing(socket, player, data, worldName, vend) {
  const hasOwner = accountKey(vend.owner_username || "") !== "";
  if (!hasOwner && !canPlayerPlaceVendingMachine(player, worldName)) {
    rejectVendTransaction(socket, data, isWorldLocked(worldName) ? "Only the world owner can list items in vending machines here." : "You cannot use this vending machine.");
    return;
  }

  if (hasOwner && !canPlayerManageVend(player, vend, worldName)) {
    rejectVendTransaction(socket, data, isWorldLocked(worldName) ? "Only the world owner can change this vending machine." : "Only the vending machine owner can change this listing.");
    return;
  }

  if (vend.listing) {
    sendVendTransactionResult(socket, data, player, vend, false, "Cancel or collect the current vending machine first.");
    return;
  }

  if (isVendAwaitingCollection(vend)) {
    sendVendTransactionResult(socket, data, player, vend, false, "Collect the sold vending machine first.");
    return;
  }

  const vendLock = await acquireVendMutationLock(socket, player, data, worldName, vend);
  if (!vendLock) return;

  try {
  const itemId = clampString(data.item_id || data.item_type || "");
  const itemCategory = resolveInventoryCategory(itemId, data.item_category || data.category || "");
  const stock = clampInteger(data.stock || data.amount || 0, 1, ItemDatabase.getStackLimit(itemId));
  const amountPerSale = clampInteger(data.amount_per_sale || data.per_sale || 1, 1, ItemDatabase.getStackLimit(itemId));
  const priceWls = clampInteger(data.price_wls || data.price || 1, 1, ItemDatabase.getStackLimit("world_lock"));

  if (!canListItemInVend(itemId, itemCategory)) {
    rejectVendTransaction(socket, data, "That item cannot be sold in a vending machine.");
    return;
  }

  if (stock < amountPerSale) {
    rejectVendTransaction(socket, data, "Stock must be at least the amount sold per purchase.");
    return;
  }

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    rejectVendTransaction(socket, data, "Could not load your server inventory.");
    return;
  }
  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);

  if (getInventoryCount(stagedState, itemId, itemCategory) < stock) {
    rejectVendTransaction(socket, data, `Not enough ${itemId}.`);
    return;
  }

  if (!spendItemFromState(stagedState, itemId, itemCategory, stock)) {
    rejectVendTransaction(socket, data, "Server inventory changed. Try again.");
    return;
  }

  const originalVend = cloneJson(vend);
  const vendTransactionId = makeAuditId("vend");
  vend.owner_username = player.account_username;
  vend.owner_name = player.account_username.toUpperCase();
  vend.listing = {
    listing_id: vendTransactionId,
    item_id: itemId,
    item_category: itemCategory,
    stock,
    amount_per_sale: amountPerSale,
    price_wls: priceWls,
    created_at: new Date().toISOString(),
  };
  vend.pending_wls = 0;

  const savedVend = setVendStateAt(worldName, vend);
  const serializedWorld = serializeWorldState(worldName);
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "vending",
    action: "vending_list",
    reason: "vend_listing",
    request_id: makeRequestId(data),
    world: worldName,
    metadata: {
      transaction_id: vendTransactionId,
      listing_transaction_id: vendTransactionId,
      x: vend.x,
      y: vend.y,
      amount_per_sale: amountPerSale,
      price_wls: priceWls,
    },
    world_state: serializedWorld,
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    setVendStateAt(worldName, originalVend);
    rejectVendTransaction(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  logVendingTransaction(socket, player, {
    transaction_id: vendTransactionId,
    action: "list",
    world: worldName,
    x: vend.x,
    y: vend.y,
    owner_username: player.account_username,
    item_id: itemId,
    item_category: itemCategory,
    amount: stock,
    price_wls: priceWls,
    stock_after: stock,
    pending_wls_after: 0,
    details: { listing_transaction_id: vendTransactionId, amount_per_sale: amountPerSale },
  });
  logItemLedgerForState(socket, player, player.account_username, committedState, itemId, itemCategory, -stock, "vending_list", vendTransactionId, "vend_listing", worldName, {
    listing_transaction_id: vendTransactionId,
    x: vend.x,
    y: vend.y,
    amount_per_sale: amountPerSale,
    price_wls: priceWls,
  }, { skipPostgres: commit.postgres_committed });
  sendVendStateUpdateToWorld(worldName, savedVend);
  sendVendTransactionResult(socket, data, player, savedVend, true, "Vending machine listing saved.", committedState);
  } finally {
    releaseLiveActionLock(vendLock);
  }
}

async function handleVendBuy(socket, player, data, worldName, vend) {
  if (!vend.listing || Number(vend.listing.stock) <= 0) {
    rejectVendTransaction(socket, data, "This vending machine is empty.");
    return;
  }

  if (canPlayerManageVend(player, vend, worldName)) {
    rejectVendTransaction(socket, data, "You cannot buy from a vending machine you manage.");
    return;
  }

  const listing = vend.listing;
  const soldItemId = listing.item_id;
  const soldItemCategory = listing.item_category;
  const amountPerSale = Number(listing.amount_per_sale);
  const pricePerSale = Number(listing.price_wls);
  const maxSaleCount = Math.max(1, Math.floor(Number(listing.stock) / Number(listing.amount_per_sale)));
  const saleCount = clampInteger(data.sale_count || 1, 1, maxSaleCount);
  const itemAmount = amountPerSale * saleCount;
  const priceWls = pricePerSale * saleCount;
  const pendingLimit = ItemDatabase.getStackLimit("world_lock");

  if (Number(vend.pending_wls) + priceWls > pendingLimit) {
    rejectVendTransaction(socket, data, "This vending machine needs to be collected first.");
    return;
  }

  const buyerState = ensureWritablePlayerState(player.account_username);
  if (!buyerState) {
    rejectVendTransaction(socket, data, "Could not load your server inventory.");
    return;
  }

  if (getInventoryCount(buyerState, "world_lock", "block") < priceWls) {
    rejectVendTransaction(socket, data, "Not enough World Locks.");
    return;
  }

  if (!canAddItemToState(buyerState, listing.item_id, listing.item_category, itemAmount)) {
    rejectVendTransaction(socket, data, "Your inventory cannot hold that item.");
    return;
  }

  const vendActionKey = `${worldName}:${vend.x},${vend.y}`;
  const vendLock = await acquireLiveActionLock(worldVendActionLocks, "vend", vendActionKey, player.id);
  if (!vendLock.acquired) {
    rejectVendTransaction(socket, data, "That vending machine is busy.");
    return;
  }

  let inventoryLocks = null;
  try {
    inventoryLocks = await acquirePlayerInventoryLocks(
      [player.account_username, vend.owner_username],
      `vend:${worldName}:${vend.x},${vend.y}`
    );
    if (!inventoryLocks.acquired) {
      rejectVendTransaction(socket, data, "An inventory is busy. Try again.");
      return;
    }

    const vendTransactionId = makeAuditId("vend");
    const originalVend = cloneJson(vend);
    const transaction = await postgresStore.applyVendBuyTransaction({
      owner_username: String(vend.owner_username || ""),
      buyer_username: player.account_username,
      world: worldName,
      item_type: soldItemId,
      item_category: soldItemCategory,
      amount: itemAmount,
      price_wls: priceWls,
      buyer_inventory_baseline: buildInventoryBaselineForItems(buyerState, [
        { item_id: "world_lock", item_category: "block" },
        { item_id: soldItemId, item_category: soldItemCategory },
      ]),
      x: Number(vend.x || 0),
      y: Number(vend.y || 0),
      request_id: makeRequestId(data),
      transaction_id: vendTransactionId,
      listing_id: listing.listing_id || listing.transaction_id || "",
      ip_address: getSocketAddress(socket),
      at: new Date().toISOString(),
    });

    if (!transaction.ok) {
      if (transaction.reason === "insufficient_inventory") {
        rejectVendTransaction(socket, data, "You no longer have enough World Locks.");
        return;
      }
      if (transaction.reason === "insufficient_capacity") {
        rejectVendTransaction(socket, data, "Your inventory cannot hold that item.");
        return;
      }
      rejectVendTransaction(socket, data, "Server inventory changed. Try again.");
      return;
    }

    if (!setInventoryCountInState(buyerState, "world_lock", "block", transaction.buyer?.after_world_lock)) {
      rejectVendTransaction(socket, data, "Could not synchronize your World Lock balance.");
      return;
    }
    if (!setInventoryCountInState(buyerState, transaction.buyer?.item_type, transaction.buyer?.item_category, transaction.buyer?.after_item)) {
      rejectVendTransaction(socket, data, "Could not synchronize your purchased item balance.");
      return;
    }

    listing.stock = Math.max(0, Number(listing.stock) - itemAmount);
    vend.pending_wls = clampInteger(Number(vend.pending_wls) + priceWls, 0, pendingLimit);
    vend.logs.push({
      buyer_username: player.account_username,
      item_id: listing.item_id,
      item_category: listing.item_category,
      amount: itemAmount,
      price_wls: priceWls,
      date: new Date().toISOString(),
    });
    vend.logs = vend.logs.slice(-VEND_LOG_LIMIT);

    if (listing.stock <= 0) {
      vend.listing = null;
    }

    const savedVend = setVendStateAt(worldName, vend);
    persistPlayerInventoryChange(player.account_username, buyerState);
    const vendWorldCommit = await commitWorldStateWithBlockChanges(worldName, [
      buildWorldObjectChangeEntry(
        socket,
        player,
        worldName,
        {
          action: "vending_buy",
          source_type: "vending",
          source_id: vendTransactionId,
          request_id: makeRequestId(data),
          x: vend.x,
          y: vend.y,
          block_type: syncVendVisualBlock(worldName, savedVend) || VEND_BLOCK_EMPTY,
        },
        originalVend,
        savedVend,
        vendTransactionId,
        {
          owner_username: vend.owner_username,
          buyer_username: player.account_username,
          item_id: soldItemId,
          item_category: soldItemCategory,
          amount: itemAmount,
          price_wls: priceWls,
          sale_count: saleCount,
        }
      ),
    ]);
    if (!vendWorldCommit.ok) {
      console.warn("[world-journal] vending buy world save failed:", vendWorldCommit.message || vendWorldCommit.reason || "unknown");
      queueWorldSave(worldName);
    }
    logVendingTransaction(socket, player, {
      transaction_id: vendTransactionId,
      action: "buy",
      world: worldName,
      x: vend.x,
      y: vend.y,
      owner_username: vend.owner_username,
      buyer_username: player.account_username,
      item_id: soldItemId,
      item_category: soldItemCategory,
      amount: itemAmount,
      price_wls: priceWls,
      stock_after: Number(savedVend.listing?.stock || 0),
      pending_wls_after: Number(savedVend.pending_wls || 0),
      details: { amount_per_sale: amountPerSale, price_per_sale_wls: pricePerSale, sale_count: saleCount },
    });
    logItemLedgerForState(socket, player, player.account_username, buyerState, "world_lock", "block", -priceWls, "vending_buy", vendTransactionId, "vend_price", worldName, {
      x: vend.x,
      y: vend.y,
      owner_username: vend.owner_username,
    }, { skipPostgres: true });
    logItemLedgerForState(socket, player, player.account_username, buyerState, soldItemId, soldItemCategory, itemAmount, "vending_buy", vendTransactionId, "vend_purchase", worldName, {
      x: vend.x,
      y: vend.y,
      owner_username: vend.owner_username,
    }, { skipPostgres: true });
    sendVendStateUpdateToWorld(worldName, savedVend);
    sendVendPurchaseSoundToRequesterAndWorld(socket, player, worldName, savedVend);
    sendVendTransactionResult(socket, data, player, savedVend, true, "Purchase complete.", buyerState);
  } finally {
    releasePlayerInventoryLocks(inventoryLocks);
    releaseLiveActionLock(vendLock);
  }
}

async function handleVendCollect(socket, player, data, worldName, vend) {
  if (!canPlayerManageVend(player, vend, worldName)) {
    rejectVendTransaction(socket, data, "Only the vending machine owner can collect from it.");
    return;
  }

  const pendingWls = clampInteger(vend.pending_wls || 0, 0, ItemDatabase.getStackLimit("world_lock"));
  if (pendingWls <= 0) {
    rejectVendTransaction(socket, data, "No World Locks to collect.");
    return;
  }

  const vendLock = await acquireVendMutationLock(socket, player, data, worldName, vend);
  if (!vendLock) return;

  try {
  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    rejectVendTransaction(socket, data, "Could not load your server inventory.");
    return;
  }

  if (!canAddItemToState(state, "world_lock", "block", pendingWls)) {
    rejectVendTransaction(socket, data, "Your inventory cannot hold those World Locks.");
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!addItemToState(stagedState, "world_lock", "block", pendingWls)) {
    rejectVendTransaction(socket, data, "Your inventory cannot hold those World Locks.");
    return;
  }

  const originalVend = cloneJson(vend);
  vend.pending_wls = 0;
  clearVendOwnerIfEmpty(vend);

  const savedVend = setVendStateAt(worldName, vend);
  const vendTransactionId = makeAuditId("vend");
  const serializedWorld = serializeWorldState(worldName);
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "vending",
    action: "vending_collect",
    reason: "vend_collect",
    request_id: makeRequestId(data),
    world: worldName,
    metadata: { transaction_id: vendTransactionId, x: vend.x, y: vend.y, pending_wls: pendingWls },
    world_state: serializedWorld,
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    setVendStateAt(worldName, originalVend);
    rejectVendTransaction(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  logVendingTransaction(socket, player, {
    transaction_id: vendTransactionId,
    action: "collect",
    world: worldName,
    x: vend.x,
    y: vend.y,
    owner_username: player.account_username,
    item_id: "world_lock",
    item_category: "block",
    amount: pendingWls,
    stock_after: Number(savedVend.listing?.stock || 0),
    pending_wls_after: Number(savedVend.pending_wls || 0),
  });
  logItemLedgerForState(socket, player, player.account_username, committedState, "world_lock", "block", pendingWls, "vending_collect", vendTransactionId, "vend_collect", worldName, {
    x: vend.x,
    y: vend.y,
  }, { skipPostgres: commit.postgres_committed });
  sendVendStateUpdateToWorld(worldName, savedVend);
  sendVendTransactionResult(socket, data, player, savedVend, true, `Collected ${pendingWls} World Locks.`, committedState);
  } finally {
    releaseLiveActionLock(vendLock);
  }
}

async function handleVendCancel(socket, player, data, worldName, vend) {
  if (!canPlayerManageVend(player, vend, worldName)) {
    rejectVendTransaction(socket, data, "Only the vending machine owner can cancel this listing.");
    return;
  }

  if (!vend.listing) {
    rejectVendTransaction(socket, data, "There is no listing to cancel.");
    return;
  }

  const listing = vend.listing;
  const vendLock = await acquireVendMutationLock(socket, player, data, worldName, vend);
  if (!vendLock) return;

  try {
  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    rejectVendTransaction(socket, data, "Could not load your server inventory.");
    return;
  }

  if (!canAddItemToState(state, listing.item_id, listing.item_category, listing.stock)) {
    rejectVendTransaction(socket, data, "Your inventory cannot hold the returned items.");
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!addItemToState(stagedState, listing.item_id, listing.item_category, listing.stock)) {
    rejectVendTransaction(socket, data, "Your inventory cannot hold the returned items.");
    return;
  }

  const originalVend = cloneJson(vend);
  vend.listing = null;
  clearVendOwnerIfEmpty(vend);

  const savedVend = setVendStateAt(worldName, vend);
  const vendTransactionId = makeAuditId("vend");
  const serializedWorld = serializeWorldState(worldName);
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "vending",
    action: "vending_cancel",
    reason: "vend_cancel",
    request_id: makeRequestId(data),
    world: worldName,
    metadata: {
      transaction_id: vendTransactionId,
      listing_transaction_id: listing.listing_id || listing.transaction_id || "",
      x: vend.x,
      y: vend.y,
      item_id: listing.item_id,
      item_category: listing.item_category,
    },
    world_state: serializedWorld,
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    setVendStateAt(worldName, originalVend);
    rejectVendTransaction(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  logVendingTransaction(socket, player, {
    transaction_id: vendTransactionId,
    action: "cancel",
    world: worldName,
    x: vend.x,
    y: vend.y,
    owner_username: player.account_username,
    item_id: listing.item_id,
    item_category: listing.item_category,
    amount: listing.stock,
    price_wls: listing.price_wls,
    stock_after: Number(savedVend.listing?.stock || 0),
    pending_wls_after: Number(savedVend.pending_wls || 0),
    details: {
      listing_transaction_id: listing.listing_id || listing.transaction_id || "",
      amount_per_sale: listing.amount_per_sale,
    },
  });
  logItemLedgerForState(socket, player, player.account_username, committedState, listing.item_id, listing.item_category, listing.stock, "vending_cancel", vendTransactionId, "vend_cancel", worldName, {
    listing_transaction_id: listing.listing_id || listing.transaction_id || "",
    x: vend.x,
    y: vend.y,
  }, { skipPostgres: commit.postgres_committed });
  sendVendStateUpdateToWorld(worldName, savedVend);
  sendVendTransactionResult(socket, data, player, savedVend, true, "Vending listing canceled.", committedState);
  } finally {
    releaseLiveActionLock(vendLock);
  }
}

function isSafeBlockType(blockType) {
  return clampString(blockType || "") === SAFE_BLOCK_TYPE;
}

function makeEmptySafeState(worldName, x, y) {
  return {
    action: "safe_state",
    world: cleanWorld(worldName),
    x: Math.trunc(Number(x) || 0),
    y: Math.trunc(Number(y) || 0),
    owner_username: "",
    owner_name: "",
    slots: [],
    updated_at: new Date().toISOString(),
  };
}

function canStoreItemInSafe(itemId, itemCategory) {
  const cleanItemId = clampString(itemId || "");
  if (cleanItemId === "" || !ItemDatabase.hasItem(cleanItemId)) return false;
  if (cleanItemId === "punch" || cleanItemId === SAFE_BLOCK_TYPE) return false;

  const definition = ItemDatabase.getItemDefinition(cleanItemId);
  if (!definition || definition.hidden) return false;

  const resolvedCategory = resolveInventoryCategory(cleanItemId, itemCategory);
  return ItemDatabase.canStoreItemInCategory(cleanItemId, resolvedCategory);
}

function sanitizeSafeSlot(rawSlot) {
  if (!rawSlot || typeof rawSlot !== "object" || Array.isArray(rawSlot)) return null;

  const itemId = clampString(rawSlot.item_id || rawSlot.item_type || rawSlot.item || "");
  if (!canStoreItemInSafe(itemId, rawSlot.item_category || rawSlot.category || "")) return null;

  const itemCategory = resolveInventoryCategory(itemId, rawSlot.item_category || rawSlot.category || "");
  const amount = clampInteger(rawSlot.amount || 0, 1, ItemDatabase.getStackLimit(itemId));
  if (amount <= 0) return null;

  return {
    item_id: itemId,
    item_category: itemCategory,
    amount,
  };
}

function sanitizeSafeState(rawEntry, worldName, x, y) {
  const safe = makeEmptySafeState(worldName, x, y);
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return safe;

  safe.owner_username = cleanAccountName(rawEntry.owner_username || rawEntry.owner_name || "");
  safe.owner_name = safe.owner_username.toUpperCase();
  safe.updated_at = String(rawEntry.updated_at || safe.updated_at);

  const rawSlots = Array.isArray(rawEntry.slots) ? rawEntry.slots : [];
  safe.slots = rawSlots
    .map(sanitizeSafeSlot)
    .filter(Boolean)
    .slice(0, SAFE_SLOT_COUNT);

  return safe;
}

function serializeSafeStateForClient(safe, player = null) {
  const cleanSafe = sanitizeSafeState(safe, safe?.world || "", safe?.x || 0, safe?.y || 0);
  return {
    action: "safe_state",
    world: cleanWorld(cleanSafe.world || ""),
    x: cleanSafe.x,
    y: cleanSafe.y,
    owner_username: cleanSafe.owner_username,
    owner_name: cleanSafe.owner_name,
    slots: cleanSafe.slots.map((slot) => ({ ...slot })),
    max_slots: SAFE_SLOT_COUNT,
    can_manage: canPlayerManageSafe(player, cleanSafe, cleanSafe.world),
  };
}

function canPlayerPlaceSafe(player, worldName) {
  return isWorldLocked(worldName) && isPlayerWorldOwner(player, worldName);
}

function canPlayerManageSafe(player, safe, worldName = "") {
  if (!player || !player.authenticated) return false;
  const cleanWorldName = cleanWorld(worldName || safe?.world || "");
  return isWorldLocked(cleanWorldName) && isPlayerWorldOwner(player, cleanWorldName);
}

function canPlayerBreakSafe(player, worldName, update) {
  if (!player || !player.authenticated) return false;
  if (!update || (update.action !== "break" && update.action !== "hit") || update.layer === "background") return false;

  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(update.x, update.y));
  if (!block || !isSafeBlockType(block.block_type)) return false;

  return isWorldLocked(worldName) && isPlayerWorldOwner(player, worldName);
}

function getSafeStateAt(worldName, x, y, createIfMissing = false) {
  const state = ensureWorldState(worldName);
  const key = gridKey(x, y);
  const existing = state.interactions.get(key);

  if (existing && existing.action === "safe_state") {
    const safe = sanitizeSafeState(existing, worldName, x, y);
    state.interactions.set(key, safe);
    return safe;
  }

  const empty = makeEmptySafeState(worldName, x, y);
  if (createIfMissing) {
    state.interactions.set(key, empty);
  }
  return empty;
}

function setSafeStateAt(worldName, safe) {
  const state = ensureWorldState(worldName);
  const cleanSafe = sanitizeSafeState(safe, worldName, safe.x, safe.y);
  cleanSafe.updated_at = new Date().toISOString();
  state.interactions.set(gridKey(cleanSafe.x, cleanSafe.y), cleanSafe);
  return cleanSafe;
}

function initializeSafeOwnerOnPlace(worldName, update, player) {
  if (!player || !player.authenticated) return;
  const safe = makeEmptySafeState(worldName, update.x, update.y);
  safe.owner_username = player.account_username;
  safe.owner_name = player.account_username.toUpperCase();
  setSafeStateAt(worldName, safe);
}

function sendSafeStateUpdateToWorld(worldName, safe) {
  broadcastToWorld(worldName, {
    type: "world_interaction_update",
    ...serializeSafeStateForClient(safe),
    world: cleanWorld(worldName),
  });
}

function validateSafeAccess(socket, player, data, worldName, grid) {
  if (!grid) {
    sendInventoryTransactionRejected(socket, data, "Safe position is missing.");
    return false;
  }

  if (!isPlayerNearGrid(player, grid.x, grid.y)) {
    sendInventoryTransactionRejected(socket, data, "Too far away from that safe.");
    return false;
  }

  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(grid.x, grid.y));
  if (!block || !isSafeBlockType(block.block_type)) {
    sendInventoryTransactionRejected(socket, data, "That is not a safe.");
    return false;
  }

  return true;
}

function sendSafeTransactionResult(socket, data, player, safe, ok, message, playerState = null) {
  sendInventoryTransactionResult(socket, {
    ok,
    request_id: makeRequestId(data),
    action: String(data.action || ""),
    message,
    username: player?.account_username || "",
    player_data: playerState || (player ? ensurePlayerState(player.account_username) || {} : {}),
    safe_state: safe ? serializeSafeStateForClient(safe, player) : {},
  });
}

function rejectSafeTransaction(socket, data, message) {
  sendInventoryTransactionResult(socket, {
    ok: false,
    request_id: makeRequestId(data),
    action: String(data.action || ""),
    message,
    safe_state: {},
  });
}

async function handleSafeTransaction(socket, player, data) {
  const action = String(data.action || "").trim();
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "use that safe")) return;
  if (await rejectIfWorldBanned(socket, player, worldName, "safe")) return;

  const grid = getTransactionGrid(data);
  if (!validateSafeAccess(socket, player, data, worldName, grid)) return;

  if (!isWorldLocked(worldName)) {
    rejectSafeTransaction(socket, data, "Lock the world before using safes.");
    return;
  }

  const safe = getSafeStateAt(worldName, grid.x, grid.y, true);

  if (!canPlayerManageSafe(player, safe, worldName)) {
    rejectSafeTransaction(socket, data, "Only the world owner can open this safe.");
    return;
  }

  if (accountKey(safe.owner_username || "") !== accountKey(player.account_username)) {
    safe.owner_username = player.account_username;
    safe.owner_name = player.account_username.toUpperCase();
  }

  if (action === "safe_get_state") {
    const savedSafe = setSafeStateAt(worldName, safe);
    sendSafeTransactionResult(socket, data, player, savedSafe, true, "");
    return;
  }

  if (tradeByPlayerId.has(player.id)) {
    rejectSafeTransaction(socket, data, "Finish or cancel your trade before using a safe.");
    return;
  }

  if (action === "safe_deposit") {
    await handleSafeDeposit(socket, player, data, worldName, safe);
    return;
  }

  if (action === "safe_withdraw") {
    await handleSafeWithdraw(socket, player, data, worldName, safe);
    return;
  }

  rejectSafeTransaction(socket, data, "Unknown safe action.");
}

function findSafeMergeSlot(safe, itemId, itemCategory, amount) {
  const stackLimit = ItemDatabase.getStackLimit(itemId);
  for (let i = 0; i < safe.slots.length; i += 1) {
    const slot = safe.slots[i];
    if (!slot) continue;
    if (slot.item_id === itemId && slot.item_category === itemCategory && Number(slot.amount) + amount <= stackLimit) {
      return i;
    }
  }
  return -1;
}

async function acquireSafeMutationLock(socket, player, data, worldName, safe) {
  const safeActionKey = `${worldName}:${safe.x},${safe.y}`;
  const safeLock = await acquireLiveActionLock(worldSafeActionLocks, "safe", safeActionKey, player.id);
  if (!safeLock.acquired) {
    rejectSafeTransaction(socket, data, "That safe is busy.");
    return null;
  }

  return safeLock;
}

async function handleSafeDeposit(socket, player, data, worldName, safe) {
  const itemId = clampString(data.item_id || data.item_type || "");
  const itemCategory = resolveInventoryCategory(itemId, data.item_category || data.category || "");
  const amount = clampInteger(data.amount || 0, 1, ItemDatabase.getStackLimit(itemId));

  if (!canStoreItemInSafe(itemId, itemCategory)) {
    rejectSafeTransaction(socket, data, "That item cannot be stored in a safe.");
    return;
  }

  const mergeIndex = findSafeMergeSlot(safe, itemId, itemCategory, amount);
  if (mergeIndex < 0 && safe.slots.length >= SAFE_SLOT_COUNT) {
    rejectSafeTransaction(socket, data, "That safe is full.");
    return;
  }

  const safeLock = await acquireSafeMutationLock(socket, player, data, worldName, safe);
  if (!safeLock) return;

  try {
  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    rejectSafeTransaction(socket, data, "Could not load your server inventory.");
    return;
  }

  if (getInventoryCount(state, itemId, itemCategory) < amount) {
    rejectSafeTransaction(socket, data, `Not enough ${itemId}.`);
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!spendItemFromState(stagedState, itemId, itemCategory, amount)) {
    rejectSafeTransaction(socket, data, "Server inventory changed. Try again.");
    return;
  }

  const originalSafe = cloneJson(safe);
  if (mergeIndex >= 0) {
    safe.slots[mergeIndex].amount = clampInteger(Number(safe.slots[mergeIndex].amount) + amount, 1, ItemDatabase.getStackLimit(itemId));
  } else {
    safe.slots.push({
      item_id: itemId,
      item_category: itemCategory,
      amount,
    });
  }

  const savedSafe = setSafeStateAt(worldName, safe);
  const safeTransactionId = makeAuditId("safe");
  const serializedWorld = serializeWorldState(worldName);
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "safe",
    action: "safe_deposit",
    reason: "safe_storage",
    request_id: makeRequestId(data),
    world: worldName,
    metadata: { transaction_id: safeTransactionId, x: safe.x, y: safe.y, item_id: itemId, item_category: itemCategory },
    world_state: serializedWorld,
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    setSafeStateAt(worldName, originalSafe);
    rejectSafeTransaction(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  logWorldChange(socket, player, {
    source_type: "safe_transaction",
    source_id: safeTransactionId,
    world: worldName,
    action: "safe_deposit",
    x: safe.x,
    y: safe.y,
    block_type: SAFE_BLOCK_TYPE,
    details: { item_id: itemId, item_category: itemCategory, amount },
  });
  logItemLedgerForState(socket, player, player.account_username, committedState, itemId, itemCategory, -amount, "safe_deposit", safeTransactionId, "safe_storage", worldName, {
    x: safe.x,
    y: safe.y,
  }, { skipPostgres: commit.postgres_committed });
  sendSafeStateUpdateToWorld(worldName, savedSafe);
  sendSafeTransactionResult(socket, data, player, savedSafe, true, `Stored ${itemId} x${amount}.`, committedState);
  } finally {
    releaseLiveActionLock(safeLock);
  }
}

async function handleSafeWithdraw(socket, player, data, worldName, safe) {
  const slotIndex = clampInteger(data.slot_index || data.slot || 0, 0, SAFE_SLOT_COUNT - 1);

  const safeLock = await acquireSafeMutationLock(socket, player, data, worldName, safe);
  if (!safeLock) return;

  try {
  if (slotIndex < 0 || slotIndex >= safe.slots.length) {
    rejectSafeTransaction(socket, data, "That safe slot is empty.");
    return;
  }

  const slot = sanitizeSafeSlot(safe.slots[slotIndex]);
  if (!slot) {
    safe.slots.splice(slotIndex, 1);
    const savedSafe = setSafeStateAt(worldName, safe);
    queueWorldSave(worldName);
    sendSafeStateUpdateToWorld(worldName, savedSafe);
    rejectSafeTransaction(socket, data, "That safe slot was invalid.");
    return;
  }

  const amount = clampInteger(data.amount || slot.amount, 1, slot.amount);
  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    rejectSafeTransaction(socket, data, "Could not load your server inventory.");
    return;
  }

  if (!canAddItemToState(state, slot.item_id, slot.item_category, amount)) {
    rejectSafeTransaction(socket, data, "Your inventory cannot hold that item.");
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!addItemToState(stagedState, slot.item_id, slot.item_category, amount)) {
    rejectSafeTransaction(socket, data, "Your inventory cannot hold that item.");
    return;
  }

  const originalSafe = cloneJson(safe);
  slot.amount -= amount;
  if (slot.amount <= 0) {
    safe.slots.splice(slotIndex, 1);
  } else {
    safe.slots[slotIndex] = slot;
  }

  const savedSafe = setSafeStateAt(worldName, safe);
  const safeTransactionId = makeAuditId("safe");
  const serializedWorld = serializeWorldState(worldName);
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "safe",
    action: "safe_withdraw",
    reason: "safe_withdraw",
    request_id: makeRequestId(data),
    world: worldName,
    metadata: { transaction_id: safeTransactionId, x: safe.x, y: safe.y, item_id: slot.item_id, item_category: slot.item_category },
    world_state: serializedWorld,
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    setSafeStateAt(worldName, originalSafe);
    rejectSafeTransaction(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  logWorldChange(socket, player, {
    source_type: "safe_transaction",
    source_id: safeTransactionId,
    world: worldName,
    action: "safe_withdraw",
    x: safe.x,
    y: safe.y,
    block_type: SAFE_BLOCK_TYPE,
    details: { item_id: slot.item_id, item_category: slot.item_category, amount },
  });
  logItemLedgerForState(socket, player, player.account_username, committedState, slot.item_id, slot.item_category, amount, "safe_withdraw", safeTransactionId, "safe_withdraw", worldName, {
    x: safe.x,
    y: safe.y,
  }, { skipPostgres: commit.postgres_committed });
  sendSafeStateUpdateToWorld(worldName, savedSafe);
  sendSafeTransactionResult(socket, data, player, savedSafe, true, `Withdrew ${slot.item_id} x${amount}.`, committedState);
  } finally {
    releaseLiveActionLock(safeLock);
  }
}

async function prepareSafeBreakInventoryReturn(socket, player, worldName, update) {
  const safe = getSafeStateAt(worldName, update.x, update.y, false);
  const slots = Array.isArray(safe.slots) ? safe.slots.map(sanitizeSafeSlot).filter(Boolean) : [];

  if (slots.length === 0) {
    return { ok: true, playerState: null, message: "" };
  }

  if (!canPlayerManageSafe(player, safe, worldName)) {
    sendActionRejected(socket, "world_block_update", "Only the world owner can break this safe.");
    return { ok: false };
  }

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    sendActionRejected(socket, "world_block_update", "Could not load your server inventory.");
    return { ok: false };
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  const originalSafe = cloneJson(safe);
  for (const slot of slots) {
    if (!canAddItemToState(stagedState, slot.item_id, slot.item_category, slot.amount)) {
      sendActionRejected(socket, "world_block_update", "Your inventory cannot hold the safe contents.");
      return { ok: false };
    }
    addItemToState(stagedState, slot.item_id, slot.item_category, slot.amount);
  }

  safe.slots = [];
  setSafeStateAt(worldName, safe);
  const safeBreakTransactionId = makeAuditId("safe_break");
  const serializedWorld = serializeWorldState(worldName);
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "safe",
    action: "safe_break_return",
    reason: "safe_break_return",
    request_id: "",
    world: worldName,
    metadata: { transaction_id: safeBreakTransactionId, x: safe.x, y: safe.y, returned_entries: slots },
    world_state: serializedWorld,
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    setSafeStateAt(worldName, originalSafe);
    sendActionRejected(socket, "world_block_update", commit.message);
    return { ok: false };
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  logWorldChange(socket, player, {
    source_type: "safe_break_return",
    source_id: safeBreakTransactionId,
    world: worldName,
    action: "safe_break_return",
    x: safe.x,
    y: safe.y,
    block_type: SAFE_BLOCK_TYPE,
    details: { slot_count: slots.length, returned_entries: slots },
  });
  for (const slot of slots) {
    logItemLedgerForState(socket, player, player.account_username, committedState, slot.item_id, slot.item_category, slot.amount, "safe_break_return", safeBreakTransactionId, "safe_break_return", worldName, {
      x: safe.x,
      y: safe.y,
    }, { skipPostgres: commit.postgres_committed });
  }

  return {
    ok: true,
    playerState: committedState,
    postgres_committed: commit.postgres_committed,
    message: "Returned safe contents.",
  };
}

function normalizeInventoryAmountEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;

  const itemId = clampString(rawEntry.item_id || rawEntry.item_type || rawEntry.item || "");
  if (itemId === "" || !ItemDatabase.hasItem(itemId)) return null;

  const itemCategory = resolveInventoryCategory(itemId, rawEntry.item_category || rawEntry.category || "");
  if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) return null;

  const amount = clampInteger(rawEntry.amount || 0, 1, ItemDatabase.getStackLimit(itemId));
  return { item_id: itemId, item_category: itemCategory, amount };
}

function getTransactionWorldName(player, data) {
  return cleanWorld(data.world || player.world || "START");
}

function getTransactionGrid(data, xKey = "x", yKey = "y") {
  const x = Number(data[xKey]);
  const y = Number(data[yKey]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const gridX = Math.trunc(x);
  const gridY = Math.trunc(y);
  if (!isGridInWorld(gridX, gridY)) return null;

  return { x: gridX, y: gridY };
}

function getStationIdForTransaction(data) {
  const action = String(data.action || "").trim();
  const stationId = String(data.station_id || data.station || "").trim();
  if (stationId !== "") return stationId;
  return action === "furnace_recipe" ? "furnace" : "crafting_station";
}

function validateStationAccess(socket, player, worldName, stationId, grid) {
  if (!grid) {
    sendActionRejected(socket, "inventory_transaction_request", "Station position is missing.");
    return false;
  }

  if (!isPlayerNearGrid(player, grid.x, grid.y)) {
    sendActionRejected(socket, "inventory_transaction_request", "Too far away from that station.");
    return false;
  }

  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(grid.x, grid.y));
  const blockType = block ? String(block.block_type || "") : "";

  if (stationId === "crafting_station") {
    if (blockType === "crafting_station") return true;
    sendActionRejected(socket, "inventory_transaction_request", "Craft at a Crafting Station.");
    return false;
  }

  if (stationId === "furnace") {
    if (blockType === "furnace") return true;
    sendActionRejected(socket, "inventory_transaction_request", "Smelt at a Furnace.");
    return false;
  }

  sendActionRejected(socket, "inventory_transaction_request", "Unknown station.");
  return false;
}

async function handleStationRecipeTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "use that station")) return;
  if (await rejectIfWorldBanned(socket, player, worldName, "station_recipe")) return;

  const stationId = getStationIdForTransaction(data);
  const recipeId = clampString(data.recipe_id || data.id || "");
  const recipe = ItemDatabase.getStationRecipe(stationId, recipeId);
  if (!recipe) {
    sendInventoryTransactionRejected(socket, data, "Recipe is not configured on the server.");
    return;
  }

  const stationGrid = getTransactionGrid(data, "station_x", "station_y") || getTransactionGrid(data);
  if (!validateStationAccess(socket, player, worldName, stationId, stationGrid)) return;

  if (tradeByPlayerId.has(player.id)) {
    sendInventoryTransactionRejected(socket, data, "Finish or cancel your trade before crafting.");
    return;
  }

  const costs = recipe.cost.map(normalizeInventoryAmountEntry);
  const output = normalizeInventoryAmountEntry(recipe.output);
  if (costs.some((entry) => entry === null) || !output) {
    sendInventoryTransactionRejected(socket, data, "Recipe has invalid server item data.");
    return;
  }

  const username = player.account_username;
  const state = ensureWritablePlayerState(username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, "Could not load your server inventory.");
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  for (const cost of costs) {
    if (getCraftingCostInventoryCount(stagedState, cost.item_id, cost.item_category) < cost.amount) {
      sendInventoryTransactionRejected(socket, data, `Not enough ${cost.item_id}.`);
      return;
    }
  }

  for (const cost of costs) {
    if (!spendCraftingCostFromState(stagedState, cost.item_id, cost.item_category, cost.amount)) {
      sendInventoryTransactionRejected(socket, data, "Server inventory changed. Try again.");
      return;
    }
  }

  if (!addItemToState(stagedState, output.item_id, output.item_category, output.amount)) {
    sendInventoryTransactionRejected(socket, data, "Could not add recipe output.");
    return;
  }

  const action = stationId === "furnace" ? "furnace_recipe" : "craft_recipe";
  const progression = grantExperienceToState(stagedState, getRecipeXp(stationId, output), action, {
    world: worldName,
    station_id: stationId,
    recipe_id: recipe.id,
    output_item: output.item_id,
  });
  const recipeTransactionId = makeAuditId(stationId === "furnace" ? "furnace" : "craft");
  const commit = await commitPlayerInventoryState(socket, player, username, beforeState, stagedState, {
    source: stationId === "furnace" ? "furnace" : "craft",
    action,
    reason: action,
    request_id: requestId,
    world: worldName,
    metadata: { transaction_id: recipeTransactionId, station_id: stationId, recipe_id: recipe.id, output_item: output.item_id },
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action,
    station_id: stationId,
    recipe_id: recipe.id,
    message: getProgressionMessage(progression, stationId === "furnace" ? `Smelted ${output.item_id}.` : `Crafted ${output.item_id}.`),
    username,
    rewards: [output],
    progression: buildProgressionPayload(progression),
    player_data: committedState,
  });
}

function getFishingGrid(data) {
  return getTransactionGrid(data, "target_x", "target_y") || getTransactionGrid(data);
}

function validateFishingTarget(socket, player, worldName, grid, data) {
  if (!grid) {
    sendInventoryTransactionRejected(socket, data, "Fishing target is missing.");
    return false;
  }

  if (!isPlayerNearGrid(player, grid.x, grid.y, MAX_FISHING_CAST_DISTANCE_PIXELS)) {
    sendInventoryTransactionRejected(socket, data, "Water must be within 4 tiles.");
    return false;
  }

  const worldState = ensureWorldState(worldName);
  const serverBlock = worldState.foreground.get(gridKey(grid.x, grid.y));
  if (!serverBlock || String(serverBlock.block_type || "") !== "water") {
    sendInventoryTransactionRejected(socket, data, "Cast the fishing rod on water.");
    return false;
  }

  return true;
}

function rollFishingReward(lureId, rodId = "") {
  const entry = rollWeightedReward(ItemDatabase.getFishingTable(lureId, { rod_id: rodId }));
  if (!entry) return null;

  const itemId = clampString(entry.item_id || entry.fish_id || "");
  if (!ItemDatabase.hasItem(itemId)) return null;

  const itemCategory = resolveInventoryCategory(itemId, entry.item_category || entry.category || (entry.fish_id ? "fish" : ""));
  if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) return null;

  return {
    item_id: itemId,
    item_category: itemCategory,
    fish_id: itemCategory === "fish" ? itemId : "",
    difficulty: clampInteger(entry.difficulty || 1, 1, 10),
  };
}

function getFishingServerCatchChance(difficulty) {
  const safeDifficulty = clampInteger(difficulty || 1, 1, 10);
  return Math.max(0.7, Math.min(0.98, 1.02 - safeDifficulty * 0.035));
}

function getFishingRewardFxRarity(itemId) {
  const definition = ItemDatabase.getItemDefinition(itemId);
  return String(definition?.rarity || "common").trim().toLowerCase();
}

function isFishingRewardConfettiRarity(rarity) {
  return rarity === "epic" || rarity === "legendary";
}

function buildFishingRewardFxPayload(player, session, rewardItemId, rewardCategory) {
  const rarity = getFishingRewardFxRarity(rewardItemId);
  if (!isFishingRewardConfettiRarity(rarity)) return null;

  const playerX = Number(player?.x);
  const playerY = Number(player?.y);
  const targetX = Number(session?.target_x);
  const targetY = Number(session?.target_y);

  return {
    type: "fishing_reward_fx",
    action: "fishing_reward",
    world: String(session?.world || player?.world || ""),
    player_id: String(player?.id || ""),
    ...getPublicPlayerIdentity(player),
    x: Number.isFinite(playerX) ? playerX : (Number.isFinite(targetX) ? targetX * TILE_SIZE : 0),
    y: Number.isFinite(playerY) ? playerY : (Number.isFinite(targetY) ? targetY * TILE_SIZE : 0),
    item_id: clampString(rewardItemId || ""),
    item_category: resolveInventoryCategory(rewardItemId, rewardCategory || ""),
    fish_id: clampString(session?.fish_id || ""),
    rarity,
  };
}

function resolveFishingRodForTransaction(player, state, data = {}) {
  const candidates = [];
  const pushCandidate = (value) => {
    const itemId = clampString(value || "");
    if (itemId !== "" && !candidates.includes(itemId)) {
      candidates.push(itemId);
    }
  };

  pushCandidate(data.rod_id || data.tool_id || "");
  pushCandidate(player?.equipment_slots?.hand || "");
  pushCandidate(state?.equipped_tool || "");

  if (cleanInventoryCategory(data.selected_item_category || "") === "tool") {
    pushCandidate(data.selected_item_type || "");
  }
  if (cleanInventoryCategory(state?.selected_item_category || "") === "tool") {
    pushCandidate(state?.selected_item_type || "");
  }

  for (const itemId of candidates) {
    if (!ItemDatabase.isFishingRodItem(itemId)) continue;
    if (getInventoryCount(state, itemId, "tool") > 0) return itemId;
  }

  return "";
}

async function handleFishingStartTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "fish in that world")) return;
  if (await rejectIfWorldBanned(socket, player, worldName, "fishing_start")) return;

  if (activeFishingSessions.has(player.id)) {
    sendInventoryTransactionRejected(socket, data, "Finish your current cast first.");
    return;
  }

  const grid = getFishingGrid(data);
  if (!validateFishingTarget(socket, player, worldName, grid, data)) return;

  const lureId = clampString(data.lure_id || data.item_id || "");
  const lureDefinition = ItemDatabase.getItemDefinition(lureId);
  if (!lureDefinition || lureDefinition.category !== "lure" || lureDefinition.shop_pack) {
    sendInventoryTransactionRejected(socket, data, "That item cannot be used as fishing bait.");
    return;
  }

  const username = player.account_username;
  const state = ensureWritablePlayerState(username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, "Could not load your server inventory.");
    return;
  }

  const rodId = resolveFishingRodForTransaction(player, state, data);
  if (rodId === "") {
    sendInventoryTransactionRejected(socket, data, "Equip a fishing rod first.");
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!spendItemFromState(stagedState, lureId, "lure", 1)) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${lureId}.`);
    return;
  }

  const reward = rollFishingReward(lureId, rodId);
  if (!reward) {
    sendInventoryTransactionRejected(socket, data, "Fishing rewards are not configured.");
    return;
  }

  const sessionId = crypto.randomUUID();
  const commit = await commitPlayerInventoryState(socket, player, username, beforeState, stagedState, {
    source: "fishing",
    action: "fishing_start",
    reason: "fishing_lure_cost",
    request_id: requestId,
    correlation_id: sessionId,
    world: worldName,
    metadata: { transaction_id: sessionId, target_x: grid.x, target_y: grid.y, rod_id: rodId, lure_id: lureId },
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  logItemLedgerForState(socket, player, username, committedState, lureId, "lure", -1, "fishing_start", sessionId, "fishing_lure_cost", worldName, {
    rod_id: rodId,
    target_x: grid.x,
    target_y: grid.y,
  }, { skipPostgres: commit.postgres_committed });
  activeFishingSessions.set(player.id, {
    session_id: sessionId,
    username,
    world: worldName,
    rod_id: rodId,
    lure_id: lureId,
    item_id: reward.item_id,
    item_category: reward.item_category,
    fish_id: reward.fish_id,
    difficulty: reward.difficulty,
    target_x: grid.x,
    target_y: grid.y,
    expires_at: Date.now() + FISHING_SESSION_TTL_MS,
  });
  applyPlayerFishingPresenceFromSession(player, activeFishingSessions.get(player.id));
  broadcastToWorld(worldName, buildPublicPlayerPresencePayload("player_position", player, worldName), player.id);

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "fishing_start",
    message: `Casting with ${lureId}.`,
    username,
    rod_id: rodId,
    lure_id: lureId,
    session_id: sessionId,
    item_id: reward.item_id,
    item_category: reward.item_category,
    fish_id: reward.fish_id,
    difficulty: reward.difficulty,
    target_x: grid.x,
    target_y: grid.y,
    player_data: committedState,
  });
}

async function handleFishingCompleteTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const session = activeFishingSessions.get(player.id);
  if (!session) {
    sendInventoryTransactionRejected(socket, data, "Fishing session expired.");
    return;
  }

  const sessionId = String(data.session_id || "").trim();
  if (sessionId !== "" && sessionId !== session.session_id) {
    sendInventoryTransactionRejected(socket, data, "Fishing session changed.");
    return;
  }

  activeFishingSessions.delete(player.id);
  clearPlayerFishingPresence(player);
  broadcastToWorld(session.world, buildPublicPlayerPresencePayload("player_position", player, session.world), player.id);

  if (Date.now() > session.expires_at || player.world !== session.world) {
    sendInventoryTransactionRejected(socket, data, "The fish got away.");
    return;
  }

  if (await rejectIfWorldBanned(socket, player, session.world, "fishing_complete")) return;

  const success = Boolean(data.success) && randomChance(getFishingServerCatchChance(session.difficulty));
  if (!success) {
    sendInventoryTransactionResult(socket, {
      ok: true,
      request_id: requestId,
      action: "fishing_complete",
      message: "The catch got away.",
      username: player.account_username,
      fish_id: "",
      item_id: "",
      item_category: "",
      player_data: ensurePlayerState(player.account_username) || {},
    });
    return;
  }

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, "Could not save caught fish.");
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  const rewardItemId = clampString(session.item_id || session.fish_id || "");
  const rewardCategory = resolveInventoryCategory(rewardItemId, session.item_category || (session.fish_id ? "fish" : ""));
  if (!addItemToState(stagedState, rewardItemId, rewardCategory, 1)) {
    sendInventoryTransactionRejected(socket, data, "Could not save fishing reward.");
    return;
  }

  const progression = grantExperienceToState(stagedState, getFishingXp(rewardItemId, session.difficulty), "fishing_complete", {
    world: session.world,
    rod_id: session.rod_id || "",
    item_id: rewardItemId,
    item_category: rewardCategory,
    fish_id: session.fish_id,
    lure_id: session.lure_id,
    difficulty: session.difficulty,
  });
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "fishing",
    action: "fishing_complete",
    reason: "fishing_reward",
    request_id: requestId,
    correlation_id: session.session_id,
    world: session.world,
    metadata: {
      transaction_id: session.session_id,
      rod_id: session.rod_id || "",
      lure_id: session.lure_id,
      item_id: rewardItemId,
      item_category: rewardCategory,
      fish_id: session.fish_id,
      difficulty: session.difficulty,
      target_x: session.target_x,
      target_y: session.target_y,
    },
    failure_message: "Could not save fishing reward.",
  });
  if (!commit.ok) {
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  logItemLedgerForState(socket, player, player.account_username, committedState, rewardItemId, rewardCategory, 1, "fishing_complete", session.session_id, "fishing_reward", session.world, {
    rod_id: session.rod_id || "",
    lure_id: session.lure_id,
    fish_id: session.fish_id,
    difficulty: session.difficulty,
    target_x: session.target_x,
    target_y: session.target_y,
  }, { skipPostgres: commit.postgres_committed });

  const rewardFxPayload = buildFishingRewardFxPayload(player, session, rewardItemId, rewardCategory);
  const rewardFxSent = Boolean(rewardFxPayload);

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "fishing_complete",
    message: getProgressionMessage(progression, `Caught ${rewardItemId}.`),
    username: player.account_username,
    rod_id: session.rod_id || "",
    lure_id: session.lure_id,
    item_id: rewardItemId,
    item_category: rewardCategory,
    fish_id: session.fish_id,
    rarity: getFishingRewardFxRarity(rewardItemId),
    reward_fx_sent: rewardFxSent,
    rewards: [{ item_id: rewardItemId, item_category: rewardCategory, amount: 1 }],
    progression: buildProgressionPayload(progression),
    player_data: committedState,
  });

  if (rewardFxPayload) {
    sendWorldUpdateToRequesterAndWorld(socket, player, session.world, rewardFxPayload);
  }
}

function isSellableFishItem(itemId) {
  const definition = ItemDatabase.getItemDefinition(itemId);
  return Boolean(definition && definition.category === "fish" && !definition.hidden);
}

function getFishSellValue(itemId) {
  const definition = ItemDatabase.getItemDefinition(itemId);
  if (!definition || definition.category !== "fish") return 0;

  for (const field of ["sell_value", "fish_sell_value", "sell_price"]) {
    const configuredValue = Math.trunc(Number(definition[field]));
    if (Number.isFinite(configuredValue) && configuredValue > 0) {
      return configuredValue;
    }
  }

  switch (String(definition.rarity || "common")) {
    case "legendary":
      return 1000;
    case "epic":
      return 300;
    case "rare":
      return 125;
    case "uncommon":
      return 50;
    default:
      return 25;
  }
}

function validateFishMongerAccess(socket, player, data, worldName, grid) {
  if (!grid) {
    sendInventoryTransactionRejected(socket, data, "Fish Monger position is missing.");
    return null;
  }

  if (!isPlayerNearGrid(player, grid.x, grid.y)) {
    sendInventoryTransactionRejected(socket, data, "Too far away from the Fish Monger.");
    return null;
  }

  const anchor = getFishMongerAnchorAt(worldName, grid.x, grid.y);
  if (!anchor) {
    sendInventoryTransactionRejected(socket, data, "That is not a Fish Monger.");
    return null;
  }

  return { x: anchor.x, y: anchor.y };
}

async function handleFishMongerTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const action = String(data.action || "").trim();
  const worldName = getTransactionWorldName(player, data);
  if (cleanWorld(player.world || "START") !== worldName) {
    sendInventoryTransactionRejected(socket, data, "Join that world before selling fish.");
    return;
  }
  if (await rejectIfWorldBanned(socket, player, worldName, "fish_monger")) return;

  const grid = getTransactionGrid(data);
  const fishMongerGrid = validateFishMongerAccess(socket, player, data, worldName, grid);
  if (!fishMongerGrid) return;

  if (tradeByPlayerId.has(player.id)) {
    sendInventoryTransactionRejected(socket, data, "Finish or cancel your trade before selling fish.");
    return;
  }

  const username = player.account_username;
  const state = ensureWritablePlayerState(username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, "Could not load your server inventory.");
    return;
  }

  const sales = [];
  if (action === "fish_monger_sell_all") {
    const fishInventory = state.fish_inventory && typeof state.fish_inventory === "object" && !Array.isArray(state.fish_inventory)
      ? state.fish_inventory
      : {};

    for (const itemId of Object.keys(fishInventory)) {
      const cleanItemId = clampString(itemId || "");
      if (!isSellableFishItem(cleanItemId)) continue;

      const amount = getInventoryCount(state, cleanItemId, "fish");
      const sellValue = getFishSellValue(cleanItemId);
      if (amount <= 0 || sellValue <= 0) continue;

      sales.push({
        item_id: cleanItemId,
        item_category: "fish",
        amount,
        sell_value: sellValue,
      });
    }
  } else {
    const itemId = clampString(data.item_id || data.item_type || data.item || "");
    if (!isSellableFishItem(itemId)) {
      sendInventoryTransactionRejected(socket, data, "That item cannot be sold here.");
      return;
    }

    const requestedAmount = Math.trunc(Number(data.amount) || 0);
    if (requestedAmount <= 0 || requestedAmount > ItemDatabase.getStackLimit(itemId)) {
      sendInventoryTransactionRejected(socket, data, "Choose a valid fish quantity.");
      return;
    }

    const amount = requestedAmount;
    const owned = getInventoryCount(state, itemId, "fish");
    if (owned < amount) {
      sendInventoryTransactionRejected(socket, data, "You do not have that many fish.");
      return;
    }

    const sellValue = getFishSellValue(itemId);
    if (sellValue <= 0) {
      sendInventoryTransactionRejected(socket, data, "That fish has no sell value yet.");
      return;
    }

    sales.push({
      item_id: itemId,
      item_category: "fish",
      amount,
      sell_value: sellValue,
    });
  }

  if (sales.length === 0) {
    sendInventoryTransactionRejected(socket, data, "You don't have any fish to sell.");
    return;
  }

  const totalFish = sales.reduce((total, sale) => total + sale.amount, 0);
  const totalGems = sales.reduce((total, sale) => total + sale.amount * sale.sell_value, 0);
  if (totalFish <= 0 || totalGems <= 0) {
    sendInventoryTransactionRejected(socket, data, "That fish has no sell value yet.");
    return;
  }

  const gemCapacity = ItemDatabase.getStackLimit("gem") - getInventoryCount(state, "gem", "currency");
  if (totalGems > gemCapacity) {
    sendInventoryTransactionRejected(socket, data, "Your gem balance is full.");
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  for (const sale of sales) {
    if (!spendItemFromState(stagedState, sale.item_id, sale.item_category, sale.amount)) {
      sendInventoryTransactionRejected(socket, data, "Server inventory changed. Try again.");
      return;
    }
  }

  if (!addItemToState(stagedState, "gem", "currency", totalGems)) {
    sendInventoryTransactionRejected(socket, data, "Could not add gems.");
    return;
  }

  const saleId = makeAuditId("fish_monger");
  const commit = await commitPlayerInventoryState(socket, player, username, beforeState, stagedState, {
    source: "fish_monger",
    action,
    reason: "fish_monger_sell",
    request_id: requestId,
    world: worldName,
    metadata: { transaction_id: saleId, x: fishMongerGrid.x, y: fishMongerGrid.y, total_fish: totalFish, total_gems: totalGems },
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  for (const sale of sales) {
    logItemLedgerForState(socket, player, username, committedState, sale.item_id, sale.item_category, -sale.amount, "fish_monger_sell", saleId, "fish_sold", worldName, {
      x: fishMongerGrid.x,
      y: fishMongerGrid.y,
      sell_value: sale.sell_value,
    }, { skipPostgres: commit.postgres_committed });
  }
  logItemLedgerForState(socket, player, username, committedState, "gem", "currency", totalGems, "fish_monger_sell", saleId, "fish_sale_reward", worldName, {
    x: fishMongerGrid.x,
    y: fishMongerGrid.y,
    total_fish: totalFish,
  }, { skipPostgres: commit.postgres_committed });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action,
    message: action === "fish_monger_sell_all"
      ? `Sold ${totalFish} fish for ${totalGems} gems.`
      : `Sold ${sales[0].item_id} x${sales[0].amount} for ${totalGems} gems.`,
    username,
    rewards: [{ item_id: "gem", item_category: "currency", amount: totalGems }],
    player_data: committedState,
  });
}

function getTransactionDropPosition(player, data) {
  const x = Number(data.x);
  const y = Number(data.y);
  if (isPositionInWorldBounds(x, y)) {
    return { x, y };
  }

  const stackGrid = getTransactionGrid(data, "stack_grid_x", "stack_grid_y") || getTransactionGrid(data);
  if (stackGrid && isGridInWorld(stackGrid.x, stackGrid.y)) {
    return getGridCenterPixels(stackGrid.x, stackGrid.y);
  }

  return {
    x: Number(player?.x) || 0,
    y: Number(player?.y) || 0,
  };
}

function getDropGridFromPosition(position) {
  if (!position) return null;

  const gridX = Math.round(Number(position.x) / TILE_SIZE);
  const gridY = Math.round(Number(position.y) / TILE_SIZE);
  if (!isGridInWorld(gridX, gridY)) return null;

  return { x: gridX, y: gridY };
}

function getTransactionDropGrid(data, position = null) {
  const explicitGrid =
    getTransactionGrid(data, "stack_grid_x", "stack_grid_y") ||
    getTransactionGrid(data, "grid_x", "grid_y") ||
    getTransactionGrid(data, "tile_x", "tile_y");
  if (explicitGrid) return explicitGrid;

  return getDropGridFromPosition(position);
}

function isDropGridBlockedByBlock(worldName, grid) {
  if (!grid) return false;

  const state = ensureWorldState(worldName);
  return getCollisionAreaAnchorInState(state, grid.x, grid.y) !== null;
}

async function handleDropInventoryItemTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "drop items in that world")) return;
  if (await rejectIfWorldBanned(socket, player, worldName, "drop_inventory_item")) return;

  if (tradeByPlayerId.has(player.id)) {
    sendInventoryTransactionRejected(socket, data, "Finish or cancel your trade before dropping items.");
    return;
  }

  const itemId = clampString(data.item_type || data.item_id || data.item || "");
  if (!ItemDatabase.hasItem(itemId)) {
    sendInventoryTransactionRejected(socket, data, "That item does not exist on the server.");
    return;
  }

  if (!ItemDatabase.isDropableItem(itemId)) {
    sendInventoryTransactionRejected(socket, data, "That item cannot be dropped.");
    return;
  }

  const itemCategory = resolveInventoryCategory(itemId, data.item_category || data.category || "");
  if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) {
    sendInventoryTransactionRejected(socket, data, "That item category does not match the server.");
    return;
  }

  const amount = clampInteger(data.amount || 1, 1, Math.min(MAX_DROP_AMOUNT, ItemDatabase.getStackLimit(itemId)));
  const position = getTransactionDropPosition(player, data);
  if (!isPositionInWorldBounds(position.x, position.y) || !isPlayerNearPoint(player, position.x, position.y, MAX_DROP_CREATE_DISTANCE_PIXELS)) {
    sendInventoryTransactionRejected(socket, data, "Drop closer to your player.");
    return;
  }

  const dropGrid = getTransactionDropGrid(data, position);
  if (isDropGridBlockedByBlock(worldName, dropGrid)) {
    sendInventoryTransactionRejected(socket, data, "Can't drop on a block.");
    return;
  }

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, "Could not load your server inventory.");
    return;
  }

  if (getInventoryCount(state, itemId, itemCategory) < amount) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${itemId}.`);
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!spendItemFromState(stagedState, itemId, itemCategory, amount)) {
    sendInventoryTransactionRejected(socket, data, "Server inventory changed. Try again.");
    return;
  }

  const payload = createServerDrop(worldName, itemId, itemCategory, amount, position.x, position.y, SERVER_DROP_PICKUP_DELAY);
  if (!payload) {
    sendInventoryTransactionRejected(socket, data, "Could not create that drop.");
    return;
  }

  const dropTransactionId = makeAuditId("drop");
  const serializedWorld = serializeWorldState(worldName);
  const worldChangeEntry = {
    source_type: "drop_inventory_item",
    source_id: dropTransactionId,
    world: worldName,
    action: "drop_create",
    x: payload.x,
    y: payload.y,
    block_type: itemId,
    details: {
      drop_id: payload.drop_id,
      item_category: itemCategory,
      amount,
    },
  };
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "drop_inventory",
    action: "drop_inventory_item",
    reason: "drop_from_inventory",
    request_id: requestId,
    world: worldName,
    metadata: { transaction_id: dropTransactionId, drop_id: payload.drop_id, x: payload.x, y: payload.y },
    world_state: serializedWorld,
    world_changes: [worldChangeEntry],
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    ensureWorldState(worldName).drops.delete(payload.drop_id);
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  sendWorldUpdateToRequesterAndWorld(socket, player, worldName, payload, {
    username: player.account_username,
    player_data: committedState,
  });

  logWorldChange(socket, player, worldChangeEntry, { skipPostgres: commit.postgres_committed });
  logItemLedgerForState(socket, player, player.account_username, committedState, itemId, itemCategory, -amount, "drop_inventory_item", dropTransactionId, "drop_from_inventory", worldName, {
    drop_id: payload.drop_id,
  }, { skipPostgres: commit.postgres_committed });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "drop_inventory_item",
    message: `Dropped ${amount} ${itemId}.`,
    username: player.account_username,
    player_data: committedState,
  });
}

async function handleTrashInventoryItemTransaction(socket, player, data) {
  const requestId = makeRequestId(data);

  if (tradeByPlayerId.has(player.id)) {
    sendInventoryTransactionRejected(socket, data, "Finish or cancel your trade before trashing items.");
    return;
  }

  const itemId = clampString(data.item_type || data.item_id || data.item || "");
  if (!ItemDatabase.hasItem(itemId)) {
    sendInventoryTransactionRejected(socket, data, "That item does not exist on the server.");
    return;
  }

  const itemCategory = resolveInventoryCategory(itemId, data.item_category || data.category || "");
  if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) {
    sendInventoryTransactionRejected(socket, data, "That item category does not match the server.");
    return;
  }

  const amount = clampInteger(data.amount || 1, 1, ItemDatabase.getStackLimit(itemId));
  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, "Could not load your server inventory.");
    return;
  }

  if (getInventoryCount(state, itemId, itemCategory) < amount) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${itemId}.`);
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!spendItemFromState(stagedState, itemId, itemCategory, amount)) {
    sendInventoryTransactionRejected(socket, data, "Server inventory changed. Try again.");
    return;
  }

  const trashTransactionId = makeAuditId("trash");
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "system",
    action: "trash_inventory_item",
    reason: "inventory_trash",
    request_id: requestId,
    world: player.world,
    metadata: { transaction_id: trashTransactionId },
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  logItemLedgerForState(socket, player, player.account_username, committedState, itemId, itemCategory, -amount, "trash_inventory_item", trashTransactionId, "inventory_trash", player.world, {}, { skipPostgres: commit.postgres_committed });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "trash_inventory_item",
    message: `Trashed ${amount} ${itemId}.`,
    username: player.account_username,
    player_data: committedState,
  });
}

async function handleWorldLockConversionTransaction(socket, player, data) {
  const requestId = makeRequestId(data);

  if (tradeByPlayerId.has(player.id)) {
    sendInventoryTransactionRejected(socket, data, "Finish or cancel your trade before converting locks.");
    return;
  }

  const direction = clampString(data.direction || "").toLowerCase();
  let spendItem = WORLD_LOCK_BLOCK_TYPE;
  let spendAmount = SUPER_WORLD_LOCK_EXCHANGE_RATE;
  let gainItem = SUPER_WORLD_LOCK_BLOCK_TYPE;
  let gainAmount = 1;
  let message = "Converted 100 World Locks into 1 Super World Lock.";

  if (direction === "to_world_locks") {
    spendItem = SUPER_WORLD_LOCK_BLOCK_TYPE;
    spendAmount = 1;
    gainItem = WORLD_LOCK_BLOCK_TYPE;
    gainAmount = SUPER_WORLD_LOCK_EXCHANGE_RATE;
    message = "Converted 1 Super World Lock into 100 World Locks.";
  } else if (direction !== "to_super") {
    sendInventoryTransactionRejected(socket, data, "That lock cannot be converted.");
    return;
  }

  if (!ItemDatabase.hasItem(WORLD_LOCK_BLOCK_TYPE) || !ItemDatabase.hasItem(SUPER_WORLD_LOCK_BLOCK_TYPE)) {
    sendInventoryTransactionRejected(socket, data, "Lock conversion is not configured on the server.");
    return;
  }

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, "Could not load your server inventory.");
    return;
  }

  if (getInventoryCount(state, spendItem, "block") < spendAmount) {
    sendInventoryTransactionRejected(socket, data, direction === "to_super" ? "You need 100 World Locks to make a Super World Lock." : "You need a Super World Lock to convert back.");
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!spendItemFromState(stagedState, spendItem, "block", spendAmount)) {
    sendInventoryTransactionRejected(socket, data, "Server inventory changed. Try again.");
    return;
  }
  if (!canAddItemToState(stagedState, gainItem, "block", gainAmount)) {
    sendInventoryTransactionRejected(socket, data, direction === "to_super" ? "Your Super World Lock stack is full." : "You need 100 empty World Lock stack space.");
    return;
  }
  if (!addItemToState(stagedState, gainItem, "block", gainAmount)) {
    sendInventoryTransactionRejected(socket, data, "Server inventory changed. Try again.");
    return;
  }

  const conversionTransactionId = makeAuditId("lock_convert");
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "world_lock_conversion",
    action: "convert_world_lock",
    reason: "world_lock_conversion",
    request_id: requestId,
    world: player.world,
    metadata: { transaction_id: conversionTransactionId, direction },
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }

  const committedState = commit.state;
  logItemLedgerForState(socket, player, player.account_username, committedState, spendItem, "block", -spendAmount, "convert_world_lock", conversionTransactionId, "world_lock_conversion", player.world, { direction }, { skipPostgres: commit.postgres_committed });
  logItemLedgerForState(socket, player, player.account_username, committedState, gainItem, "block", gainAmount, "convert_world_lock", conversionTransactionId, "world_lock_conversion", player.world, { direction }, { skipPostgres: commit.postgres_committed });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "convert_world_lock",
    message,
    username: player.account_username,
    player_data: committedState,
  });
}

function getSeedGrowthRemaining(seed) {
  if (!seed) return SERVER_SEED_GROW_TIME_SECONDS;
  const maxGrowTime = Math.max(1, Number(seed.max_grow_time) || SERVER_SEED_GROW_TIME_SECONDS);
  const plantedAt = Number(seed.planted_at || 0);
  if (!Number.isFinite(plantedAt) || plantedAt <= 0) {
    return Math.max(0, Math.min(maxGrowTime, Number(seed.grow_time) || maxGrowTime));
  }

  const elapsed = Math.max(0, (Date.now() - plantedAt) / 1000);
  return Math.max(0, maxGrowTime - elapsed);
}

function getSeedConfiguredGrowTime(seedType) {
  const definition = ItemDatabase.getItemDefinition(seedType);
  const configured = Number(definition?.max_grow_time || definition?.grow_time || 0);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.min(86400, configured));
  }
  return SERVER_SEED_GROW_TIME_SECONDS;
}

function isSeedMature(seed) {
  return getSeedGrowthRemaining(seed) <= 0;
}

function serializeSeedForMessage(seed) {
  const growTime = getSeedGrowthRemaining(seed);
  const maxGrowTime = Math.max(1, Number(seed.max_grow_time) || SERVER_SEED_GROW_TIME_SECONDS);
  return {
    x: seed.x,
    y: seed.y,
    seed_type: seed.seed_type,
    grow_time: growTime,
    max_grow_time: maxGrowTime,
    mature: growTime <= 0,
    mutated: Boolean(seed.mutated),
  };
}

function makeServerSeedEntry(x, y, seedType) {
  const maxGrowTime = getSeedConfiguredGrowTime(seedType);
  return {
    x,
    y,
    seed_type: seedType,
    grow_time: maxGrowTime,
    max_grow_time: maxGrowTime,
    planted_at: Date.now(),
    mutated: randomChance(SEED_MUTATION_CHANCE),
  };
}

async function handleSeedPlaceTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "plant seeds in that world")) return;
  if (await rejectIfWorldBanned(socket, player, worldName, "seed_place")) return;
  if (!requireBuildPermission(socket, player, worldName, "edit this locked world")) return;

  const grid = getTransactionGrid(data);
  if (!grid || !isPlayerNearGrid(player, grid.x, grid.y)) {
    sendInventoryTransactionRejected(socket, data, "Too far away.");
    return;
  }

  const seedType = clampString(data.seed_type || data.item_id || "");
  if (!ItemDatabase.hasItem(seedType) || resolveInventoryCategory(seedType) !== "seed") {
    sendInventoryTransactionRejected(socket, data, "Select a valid seed to plant.");
    return;
  }

  const worldState = ensureWorldState(worldName);
  const key = gridKey(grid.x, grid.y);
  if (worldState.foreground.has(key)) {
    sendInventoryTransactionRejected(socket, data, "Need an empty tile.");
    return;
  }

  if (worldState.seeds.has(key)) {
    sendInventoryTransactionRejected(socket, data, "A seed is already planted there.");
    return;
  }

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${seedType}.`);
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!spendItemFromState(stagedState, seedType, "seed", 1)) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${seedType}.`);
    return;
  }

  const seedGrowTime = getSeedConfiguredGrowTime(seedType);
  const update = {
    type: "world_seed_update",
    action: "place",
    x: grid.x,
    y: grid.y,
    seed_type: seedType,
    grow_time: seedGrowTime,
    max_grow_time: seedGrowTime,
    world: worldName,
  };

  applySeedUpdateToWorldState(worldName, update);
  const seedTransactionId = makeAuditId("seed");
  const serializedWorld = serializeWorldState(worldName);
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "seed_place",
    action: "seed_place",
    reason: "seed_plant_cost",
    request_id: requestId,
    world: worldName,
    metadata: { transaction_id: seedTransactionId, x: grid.x, y: grid.y, seed_type: seedType, mutated: Boolean(update.mutated) },
    world_state: serializedWorld,
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    ensureWorldState(worldName).seeds.delete(key);
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update, {
    username: player.account_username,
    player_data: committedState,
  });

  logWorldChange(socket, player, {
    source_type: "seed_place",
    source_id: seedTransactionId,
    world: worldName,
    action: "place",
    layer: "seed",
    x: grid.x,
    y: grid.y,
    block_type: seedType,
    details: {
      seed_type: seedType,
      mutated: Boolean(update.mutated),
    },
  });
  logItemLedgerForState(socket, player, player.account_username, committedState, seedType, "seed", -1, "seed_place", seedTransactionId, "seed_plant_cost", worldName, {
    x: grid.x,
    y: grid.y,
  }, { skipPostgres: commit.postgres_committed });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "seed_place",
    message: `Planted ${seedType}.`,
    username: player.account_username,
    seed_type: seedType,
    player_data: committedState,
  });
}

function getBlockTypeForSeed(seedType) {
  const definition = ItemDatabase.getItemDefinition(seedType);
  if (!definition || definition.category !== "seed") return "";
  return clampString(definition.grows_into || String(seedType || "").replace(/_seed$/, ""));
}

async function handleSeedSpliceTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "splice seeds in that world")) return;
  if (await rejectIfWorldBanned(socket, player, worldName, "seed_splice")) return;
  if (!requireBuildPermission(socket, player, worldName, "edit this locked world")) return;

  const grid = getTransactionGrid(data);
  if (!grid || !isPlayerNearGrid(player, grid.x, grid.y)) {
    sendInventoryTransactionRejected(socket, data, "Too far away.");
    return;
  }

  const secondSeed = clampString(data.seed_type || data.second_seed_type || data.item_id || "");
  if (!ItemDatabase.hasItem(secondSeed) || resolveInventoryCategory(secondSeed) !== "seed") {
    sendInventoryTransactionRejected(socket, data, "Select a valid seed to splice.");
    return;
  }

  const worldState = ensureWorldState(worldName);
  const key = gridKey(grid.x, grid.y);
  const seed = worldState.seeds.get(key);
  if (!seed) {
    sendInventoryTransactionRejected(socket, data, "There is no seed-tree there.");
    return;
  }

  if (isSeedMature(seed)) {
    sendInventoryTransactionRejected(socket, data, "This seed-tree is mature. Harvest it first.");
    return;
  }

  const resultSeed = ItemDatabase.getSpliceResult(seed.seed_type, secondSeed);
  if (resultSeed === "" || !ItemDatabase.hasItem(resultSeed)) {
    sendInventoryTransactionRejected(socket, data, "These seeds cannot be spliced.");
    return;
  }

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${secondSeed}.`);
    return;
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!spendItemFromState(stagedState, secondSeed, "seed", 1)) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${secondSeed}.`);
    return;
  }

  const seedGrowTime = getSeedConfiguredGrowTime(resultSeed);
  const update = {
    type: "world_seed_update",
    action: "splice",
    x: grid.x,
    y: grid.y,
    seed_type: resultSeed,
    previous_seed_type: seed.seed_type,
    grow_time: seedGrowTime,
    max_grow_time: seedGrowTime,
    world: worldName,
  };

  const originalSeed = cloneJson(seed);
  applySeedUpdateToWorldState(worldName, update);
  const seedTransactionId = makeAuditId("seed");
  const serializedWorld = serializeWorldState(worldName);
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "seed_splice",
    action: "seed_splice",
    reason: "seed_splice",
    request_id: requestId,
    world: worldName,
    metadata: { transaction_id: seedTransactionId, x: grid.x, y: grid.y, previous_seed_type: seed.seed_type, seed_type: resultSeed },
    world_state: serializedWorld,
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    ensureWorldState(worldName).seeds.set(key, originalSeed);
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update, {
    username: player.account_username,
    player_data: committedState,
  });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "seed_splice",
    message: `Spliced into ${resultSeed}.`,
    username: player.account_username,
    seed_type: resultSeed,
    previous_seed_type: seed.seed_type,
    player_data: committedState,
  });
}

async function handleSeedHarvestTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "harvest seeds in that world")) return;
  if (await rejectIfWorldBanned(socket, player, worldName, "seed_harvest")) return;
  if (!requireBuildPermission(socket, player, worldName, "edit this locked world")) return;

  const grid = getTransactionGrid(data);
  if (!grid || !isPlayerNearGrid(player, grid.x, grid.y)) {
    sendInventoryTransactionRejected(socket, data, "Too far away.");
    return;
  }

  const worldState = ensureWorldState(worldName);
  const key = gridKey(grid.x, grid.y);
  const seed = worldState.seeds.get(key);
  if (!seed) {
    sendInventoryTransactionRejected(socket, data, "There is no seed-tree there.");
    return;
  }

  const dropPosition = getGridCenterPixels(grid.x, grid.y);
  const drops = [];
  const maturedSeed = isSeedMature(seed);
  if (maturedSeed) {
    if (Boolean(seed.mutated)) {
      const validRewardTable = SEED_MUTATION_REWARD_TABLE.filter((entry) => ItemDatabase.hasItem(entry.item_id));
      const reward = rollWeightedReward(validRewardTable);
      if (reward) {
        const minAmount = Math.max(1, Math.trunc(Number(reward.min_amount) || 1));
        const maxAmount = Math.max(minAmount, Math.trunc(Number(reward.max_amount) || minAmount));
        const amount = crypto.randomInt(minAmount, maxAmount + 1);
        drops.push({
          item_id: reward.item_id,
          item_category: reward.item_category,
          amount,
          y_offset: Number(reward.y_offset) || 0,
        });
      }
    } else {
      const blockType = getBlockTypeForSeed(seed.seed_type);
      if (blockType !== "") {
        const configuredTreeDrops = getTreeHarvestDropsForBlock(blockType);
        if (Array.isArray(configuredTreeDrops)) {
          for (const drop of configuredTreeDrops) {
            drops.push({
              item_id: drop.item_id,
              item_category: drop.item_category,
              amount: drop.amount,
              y_offset: drop.item_category === "seed" ? -8 : 0,
            });
          }
        } else {
          drops.push({ item_id: blockType, item_category: "block", amount: 1, y_offset: 0 });
          if (randomChance(MATURE_SEED_EXTRA_DROP_CHANCE)) {
            drops.push({ item_id: seed.seed_type, item_category: "seed", amount: 1, y_offset: -8 });
          }
        }
      }
    }
  } else {
    drops.push({ item_id: seed.seed_type, item_category: "seed", amount: 1, y_offset: 0 });
  }

  const update = {
    type: "world_seed_update",
    action: "remove",
    x: grid.x,
    y: grid.y,
    seed_type: seed.seed_type,
    mutated: Boolean(seed.mutated),
    world: worldName,
  };

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, "Could not load your server inventory.");
    return;
  }
  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  const originalSeed = cloneJson(seed);
  applySeedUpdateToWorldState(worldName, update);

  const rewards = [];
  const payloads = [];
  for (const drop of drops) {
    const payload = createServerDrop(
      worldName,
      drop.item_id,
      drop.item_category,
      drop.amount,
      dropPosition.x,
      dropPosition.y + drop.y_offset,
      SERVER_DROP_PICKUP_DELAY
    );
    if (!payload) continue;
    rewards.push({ item_id: drop.item_id, item_category: drop.item_category, amount: drop.amount });
    payloads.push(payload);
  }

  const progression = grantExperienceToState(stagedState, getSeedHarvestXp(rewards, maturedSeed), "seed_harvest", {
    world: worldName,
    seed_type: seed.seed_type,
    mutated: Boolean(seed.mutated),
    x: grid.x,
    y: grid.y,
  });
  const seedTransactionId = makeAuditId("seed");
  const serializedWorld = serializeWorldState(worldName);
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "seed_harvest",
    action: "seed_harvest",
    reason: "seed_harvest",
    request_id: requestId,
    world: worldName,
    metadata: {
      transaction_id: seedTransactionId,
      x: grid.x,
      y: grid.y,
      seed_type: seed.seed_type,
      mutated: Boolean(seed.mutated),
      reward_count: rewards.length,
    },
    world_state: serializedWorld,
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    const rollbackState = ensureWorldState(worldName);
    rollbackState.seeds.set(key, originalSeed);
    for (const payload of payloads) {
      rollbackState.drops.delete(payload.drop_id);
    }
    sendInventoryTransactionRejected(socket, data, commit.message);
    return;
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update, {
    username: player.account_username,
    player_data: committedState,
  });
  for (const payload of payloads) {
    sendWorldUpdateToRequesterAndWorld(socket, player, worldName, payload);
  }

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "seed_harvest",
    message: getProgressionMessage(progression, "Seed-tree harvested."),
    username: player.account_username,
    rewards,
    progression: buildProgressionPayload(progression),
    player_data: committedState,
  });
}

function rollWeightedReward(table) {
  const totalWeight = table.reduce((total, entry) => total + Math.max(0, Number(entry.weight) || 0), 0);
  if (totalWeight <= 0) return table[0];

  let roll = crypto.randomInt(1, totalWeight + 1);
  for (const entry of table) {
    roll -= Math.max(0, Number(entry.weight) || 0);
    if (roll <= 0) return entry;
  }

  return table[table.length - 1];
}

function combineRewardEntries(rewards) {
  const combined = new Map();
  for (const reward of rewards) {
    const itemId = clampString(reward.item_id || "");
    if (itemId === "") continue;
    if (!ItemDatabase.hasItem(itemId)) continue;
    const itemCategory = resolveInventoryCategory(itemId, reward.item_category || reward.category || "");
    if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) continue;
    const amount = clampInteger(reward.amount || 0, 0, ItemDatabase.getStackLimit(itemId));
    if (amount <= 0) continue;
    const key = `${itemCategory}:${itemId}`;
    const existing = combined.get(key) || { item_id: itemId, item_category: itemCategory, amount: 0 };
    existing.amount = clampInteger(existing.amount + amount, 0, ItemDatabase.getStackLimit(itemId));
    combined.set(key, existing);
  }
  return Array.from(combined.values());
}

function getRawLength(raw) {
  if (Buffer.isBuffer(raw)) return raw.length;
  return Buffer.byteLength(String(raw || ""), "utf8");
}

function getRateLimitSubject(socket, player) {
  const username = accountKey(player?.account_username || "");
  if (username !== "") return `account:${username}`;
  const ip = getSocketAddress(socket);
  if (ip !== "") return `ip:${ip}`;
  return `socket:${socket?.playerId || "unknown"}`;
}

function notifyRateLimited(socket, bucketKey, data = null) {
  const now = Date.now();
  if (bucketKey === "developer_command_request") {
    sendDeveloperDenied(
      socket,
      makeRequestId(data || {}),
      String(data?.command || "").trim(),
      "Developer command rate limited. Slow down a little.",
      { reason: "rate_limited" }
    );
    return;
  }

  if (!socket.rateLimitWarnings) socket.rateLimitWarnings = new Map();
  const lastWarnedAt = socket.rateLimitWarnings.get(bucketKey) || 0;
  if (now - lastWarnedAt <= 1000 || socket.readyState !== WebSocket.OPEN) return;

  socket.rateLimitWarnings.set(bucketKey, now);
  sendJson(socket, {
    type: "rate_limited",
    action: bucketKey,
    message: "Slow down a little.",
  });
}

function logRateLimitSecurityEvent(socket, player, scope, bucketKey, limits, result = {}, data = null) {
  const now = Date.now();
  const key = `${scope}:${bucketKey}`;
  if (!socket.rateLimitSecurityWarnings) socket.rateLimitSecurityWarnings = new Map();
  const lastLoggedAt = socket.rateLimitSecurityWarnings.get(key) || 0;
  if (now - lastLoggedAt < BOT_RATE_LIMIT_SECURITY_LOG_WINDOW_MS) return;
  socket.rateLimitSecurityWarnings.set(key, now);

  logSecurityEvent(socket, player, "rate_limit_exceeded", {
    scope,
    bucket: bucketKey,
    message_type: String(data?.type || ""),
    action: String(data?.action || ""),
    request_id: makeRequestId(data || {}),
    world: cleanWorld(data?.world || player?.world || ""),
    limit: Number(limits?.limit || 0),
    window_ms: Number(limits?.windowMs || 0),
    observed_count: Number(result?.count || 0),
    retry_ms: Math.max(0, Math.trunc(Number(result?.resetInMs) || 0)),
    redis_fallback: Boolean(result?.fallback),
    subject: getRateLimitSubject(socket, player),
  }, scope === "bot" ? "warning" : "info");
}

async function consumeScopedRateLimit(socket, player, scope, bucketKey, limits, data = null, options = {}) {
  const safeLimits = {
    limit: Math.max(1, Math.trunc(Number(limits?.limit) || 60)),
    windowMs: Math.max(100, Math.trunc(Number(limits?.windowMs) || 1000)),
  };
  const cleanScope = String(scope || "message").trim().toLowerCase() || "message";
  const cleanBucketKey = String(bucketKey || "unknown").trim().toLowerCase() || "unknown";

  if (redisStore.isReady()) {
    const subject = getRateLimitSubject(socket, player);
    const result = await redisStore.checkRateLimit(`${cleanScope}:${cleanBucketKey}`, subject, safeLimits.limit, safeLimits.windowMs);
    if (result.allowed) {
      return true;
    }
    notifyRateLimited(socket, cleanBucketKey, data);
    if (options.logSecurityEvent) {
      logRateLimitSecurityEvent(socket, player, cleanScope, cleanBucketKey, safeLimits, result, data);
    }
    return false;
  }

  const now = Date.now();
  const localBucketKey = `${cleanScope}:${cleanBucketKey}`;
  const bucket = socket.rateLimits.get(localBucketKey) || {
    count: 0,
    resetAt: now + safeLimits.windowMs,
  };

  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + safeLimits.windowMs;
  }

  bucket.count += 1;
  socket.rateLimits.set(localBucketKey, bucket);

  if (bucket.count <= safeLimits.limit) {
    return true;
  }

  notifyRateLimited(socket, cleanBucketKey, data);
  if (options.logSecurityEvent) {
    logRateLimitSecurityEvent(socket, player, cleanScope, cleanBucketKey, safeLimits, {
      allowed: false,
      fallback: true,
      count: bucket.count,
      resetInMs: Math.max(0, bucket.resetAt - now),
    }, data);
  }
  return false;
}

async function checkMessageRateLimit(socket, player, messageType, data = null) {
  const bucketKey = String(messageType || "unknown").trim().toLowerCase() || "unknown";
  const limits = MESSAGE_RATE_LIMITS[bucketKey] || { limit: 60, windowMs: 1000 };
  return consumeScopedRateLimit(socket, player, "message", bucketKey, limits, data);
}

function getBotRateLimitAction(messageType, data = {}) {
  const type = String(messageType || "").trim().toLowerCase();
  const action = String(data?.action || "").trim().toLowerCase();

  if (type === "world_block_update") {
    if (action === "place") return "block_place";
    if (action === "break" || action === "hit") return "block_break";
    return "";
  }

  if (type === "world_item_drop_pickup" || type === "world_drop_pickup") return "pickup_attempt";
  if (type === "chat") return "chat_message";
  if (type === "player_punch") return "player_punch";
  if (type === "trade_request") return "trade_request";
  if (type === "join_world") return "world_join";
  if (type === "inventory_transaction_request" && action === "vend_buy") return "vending_purchase";

  return "";
}

async function checkBotActionRateLimit(socket, player, messageType, data = null) {
  const actionKey = getBotRateLimitAction(messageType, data || {});
  if (actionKey === "") return true;
  const limits = BOT_RATE_LIMITS[actionKey];
  if (!limits) return true;
  return consumeScopedRateLimit(socket, player, "bot", actionKey, limits, data, {
    logSecurityEvent: true,
  });
}

function shouldRecordFailedTransactionLedgerAction(action) {
  const normalized = cleanName(action || "").toLowerCase();
  if (normalized === "") return false;
  if (normalized === "inventory_transaction_request") return true;
  if (normalized === "world_block_update") return true;
  if (normalized === "world_seed_update") return true;
  if (normalized === "world_interaction_update") return true;
  if (normalized === "world_item_drop_create" || normalized === "world_drop_create") return true;
  if (normalized === "world_item_drop_pickup" || normalized === "world_drop_pickup" || normalized === "drop_pickup") return true;
  if (normalized === "world_item_drop_update") return true;
  if (normalized.startsWith("trade")) return true;
  if (normalized.startsWith("vend") || normalized.startsWith("vending")) return true;
  if (normalized.includes("shop_purchase")) return true;
  return false;
}

function failedTransactionLedgerTypeForAction(action) {
  const normalized = cleanName(action || "").toLowerCase();
  if (normalized === "world_item_drop_create" || normalized === "world_drop_create") return "ITEM_DROP";
  if (normalized === "world_item_drop_pickup" || normalized === "world_drop_pickup" || normalized === "drop_pickup") return "ITEM_PICKUP";
  if (normalized.startsWith("trade")) return "TRADE_FAILED";
  if (normalized.startsWith("vend") || normalized.startsWith("vending")) return "VENDING_FAILED";
  if (normalized === "inventory_transaction_request") return "INVENTORY_TRANSACTION_FAILED";
  if (normalized === "world_block_update") return "WORLD_BLOCK_UPDATE_FAILED";
  if (normalized === "world_seed_update") return "WORLD_SEED_UPDATE_FAILED";
  if (normalized === "world_interaction_update") return "WORLD_INTERACTION_FAILED";
  if (normalized.includes("shop_purchase")) return "SHOP_PURCHASE";
  return "VALUABLE_ACTION_FAILED";
}

function failedTransactionLedgerSourceForAction(action) {
  const normalized = cleanName(action || "").toLowerCase();
  if (normalized.startsWith("trade")) return "trade";
  if (normalized.startsWith("vend") || normalized.startsWith("vending")) return "vending";
  if (normalized.includes("pickup")) return "drop_pickup";
  if (normalized.includes("drop")) return "drop_inventory";
  if (normalized.includes("seed")) return "seed_place";
  if (normalized.includes("shop")) return "shop";
  if (normalized.includes("interaction")) return "world_interaction";
  if (normalized.includes("block")) return "world_block_place";
  return "system";
}

function sanitizeRejectedActionMetadata(extra) {
  const raw = extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {};
  const metadata = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const cleanKey = cleanName(key);
    if (cleanKey === "" || cleanKey === "player_data" || cleanKey === "account" || cleanKey === "session_token") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      metadata[cleanKey] = value;
    } else if (Array.isArray(value)) {
      metadata[cleanKey] = value.slice(0, 20).map((entry) => (
        typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null
          ? entry
          : cleanName(JSON.stringify(entry)).slice(0, 500)
      ));
    } else if (typeof value === "object") {
      try {
        metadata[cleanKey] = JSON.parse(JSON.stringify(value));
      } catch (_) {
        metadata[cleanKey] = cleanName(String(value)).slice(0, 500);
      }
    }
  }
  return metadata;
}

function queueFailedTransactionLedger(socket, action, message, extra = null) {
  if (!isPostgresAuthoritativeReady()) return;
  if (!shouldRecordFailedTransactionLedgerAction(action)) return;

  const player = socket?.playerId ? players.get(socket.playerId) : null;
  const username = cleanAccountName(player?.account_username || player?.name || "");
  if (!player?.authenticated || username === "") return;

  const metadata = sanitizeRejectedActionMetadata(extra);
  const account = accounts.get(accountKey(username)) || null;
  const worldName = cleanWorld(metadata.world || metadata.world_name || player.world || "START");
  const itemType = cleanName(metadata.item_type || metadata.item_id || metadata.block_type || metadata.seed_type || "");
  const itemCategory = cleanInventoryCategory(metadata.item_category || metadata.category || "");
  const publicItemInstanceId = cleanName(metadata.public_item_instance_id || metadata.item_instance_public_id || metadata.item_instance_id || "");
  const requestId = cleanName(metadata.request_id || metadata.requestId || "");

  postgresStore.runDetached("transaction ledger failed action", () => postgresStore.recordTransactionLedgerEvent({
    transaction_type: failedTransactionLedgerTypeForAction(action),
    status: "failed",
    account_username: username,
    world: worldName,
    item_type: itemType,
    item_category: itemCategory,
    public_item_instance_id: publicItemInstanceId,
    quantity: 0,
    request_id: requestId,
    source: failedTransactionLedgerSourceForAction(action),
    action,
    ip_address: getSocketAddress(socket),
    user_agent: String(socket?.userAgent || ""),
    session_token_hash: cleanAccountName(account?.session_token_hash || ""),
    device_info: {
      user_agent: String(socket?.userAgent || ""),
      player_id: String(player?.id || ""),
    },
    metadata: {
      reason: cleanName(message || "action_rejected"),
      rejection_payload: metadata,
    },
  }));
}

function sendActionRejected(socket, action, message, extra = null) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  queueFailedTransactionLedger(socket, action, message, extra);

  const payload = {
    type: "action_rejected",
    action,
    message,
  };
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        payload[key] = value;
      }
    }
  }

  sendJson(socket, payload);
}

function requireSameWorld(socket, player, worldName, action) {
  if (!player) return false;

  const currentWorld = cleanWorld(player.world || "START");
  const targetWorld = cleanWorld(worldName || "START");
  if (currentWorld === targetWorld) return true;

  sendActionRejected(socket, action, "Join that world before sending actions for it.");
  return false;
}

function isGridInWorld(x, y) {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < WORLD_WIDTH &&
    y >= 0 &&
    y < WORLD_HEIGHT
  );
}

function isPositionInWorldBounds(x, y) {
  const min = -POSITION_MARGIN_PIXELS;
  const maxX = WORLD_WIDTH * TILE_SIZE + POSITION_MARGIN_PIXELS;
  const maxY = WORLD_HEIGHT * TILE_SIZE + POSITION_MARGIN_PIXELS;
  return Number.isFinite(x) && Number.isFinite(y) && x >= min && x <= maxX && y >= min && y <= maxY;
}

function parseBlockVector2(value, fallbackX, fallbackY) {
  if (Array.isArray(value) && value.length >= 2) {
    return {
      x: Number.isFinite(Number(value[0])) ? Number(value[0]) : fallbackX,
      y: Number.isFinite(Number(value[1])) ? Number(value[1]) : fallbackY,
    };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      x: Number.isFinite(Number(value.x)) ? Number(value.x) : fallbackX,
      y: Number.isFinite(Number(value.y)) ? Number(value.y) : fallbackY,
    };
  }

  return { x: fallbackX, y: fallbackY };
}

function blockOccupiesCollisionArea(blockType) {
  const definition = ItemDatabase.getItemDefinition(blockType);
  return Boolean(definition?.occupies_collision_area);
}

function blockRequiresFullAreaClear(blockType) {
  const definition = ItemDatabase.getItemDefinition(blockType);
  return Boolean(definition?.requires_full_area_clear);
}

function blockRequiresWorldLock(blockType) {
  const definition = ItemDatabase.getItemDefinition(blockType);
  return Boolean(definition?.requires_world_lock);
}

function isEntranceBlockType(blockType) {
  const definition = ItemDatabase.getItemDefinition(clampString(blockType || ""));
  return Boolean(definition && definition.category === "block" && definition.entrance_block);
}

function isDoorBlockType(blockType) {
  const definition = ItemDatabase.getItemDefinition(clampString(blockType || ""));
  return Boolean(definition && definition.category === "block" && definition.door_block);
}

function isSignBlockType(blockType) {
  const definition = ItemDatabase.getItemDefinition(clampString(blockType || ""));
  return Boolean(definition && definition.category === "block" && definition.sign_block);
}

function isToggleBlockType(blockType) {
  const definition = ItemDatabase.getItemDefinition(clampString(blockType || ""));
  return Boolean(definition && definition.category === "block" && definition.toggle_block);
}

function isPersistentInteractionBlockType(blockType) {
  return isDoorBlockType(blockType) || isEntranceBlockType(blockType) || isSignBlockType(blockType) || isToggleBlockType(blockType);
}

function getBlockCollisionRectForGrid(x, y, blockType) {
  const definition = ItemDatabase.getItemDefinition(blockType) || {};
  const size = parseBlockVector2(definition.collision_size || definition.visual_size, TILE_SIZE, TILE_SIZE);
  const offset = parseBlockVector2(definition.collision_offset || definition.visual_offset, 0, 0);
  const centerX = (Number(x) || 0) * TILE_SIZE + offset.x;
  const centerY = (Number(y) || 0) * TILE_SIZE + offset.y;

  return {
    x: centerX - size.x * 0.5,
    y: centerY - size.y * 0.5,
    width: size.x,
    height: size.y,
  };
}

function getGridPositionsOverlappingRect(rect) {
  const positions = [];
  const halfTile = TILE_SIZE * 0.5;
  const epsilon = 0.01;
  const minX = Math.floor((rect.x + halfTile + epsilon) / TILE_SIZE);
  const minY = Math.floor((rect.y + halfTile + epsilon) / TILE_SIZE);
  const maxX = Math.floor((rect.x + rect.width - epsilon + halfTile) / TILE_SIZE);
  const maxY = Math.floor((rect.y + rect.height - epsilon + halfTile) / TILE_SIZE);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      positions.push({ x, y });
    }
  }

  return positions;
}

function rectsIntersect(a, b) {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function doesPlacementOverlapReservedObject(state, x, y, blockType) {
  if (!state) return false;

  const proposedRect = getBlockCollisionRectForGrid(x, y, blockType);
  for (const block of state.foreground.values()) {
    const existingType = clampString(block?.block_type || "");
    if (!blockOccupiesCollisionArea(existingType)) continue;

    const existingRect = getBlockCollisionRectForGrid(block.x, block.y, existingType);
    if (rectsIntersect(proposedRect, existingRect)) {
      return true;
    }
  }

  return false;
}

function validateFullCollisionAreaPlacement(socket, state, update) {
  const collisionRect = getBlockCollisionRectForGrid(update.x, update.y, update.block_type);
  const occupiedPositions = getGridPositionsOverlappingRect(collisionRect);

  for (const position of occupiedPositions) {
    if (!isGridInWorld(position.x, position.y)) {
      sendActionRejected(socket, "world_block_update", "Need enough empty space.");
      return false;
    }

    const key = gridKey(position.x, position.y);
    if (state.foreground.has(key) || state.seeds.has(key)) {
      sendActionRejected(socket, "world_block_update", "Need enough empty space.");
      return false;
    }
  }

  if (doesPlacementOverlapReservedObject(state, update.x, update.y, update.block_type)) {
    sendActionRejected(socket, "world_block_update", "Need enough empty space.");
    return false;
  }

  return true;
}

function clampInteger(value, min, max) {
  const number = Math.trunc(Number(value) || 0);
  return Math.min(max, Math.max(min, number));
}

function clampString(value, limit = MAX_ITEM_ID_LENGTH) {
  return String(value || "").trim().slice(0, limit);
}

function cleanDoorId(value) {
  const clean = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, MAX_DOOR_ID_LENGTH);
  return clean;
}

function cleanDoorDestination(value) {
  return String(value || "").trim().slice(0, MAX_DOOR_DESTINATION_LENGTH);
}

function parseDoorDestination(value, sourceWorld = "START") {
  const destination = cleanDoorDestination(value);
  const fallbackWorld = cleanWorld(sourceWorld || "START");
  if (destination === "") {
    return {
      destination,
      target_world: "",
      target_door_id: "",
    };
  }

  const parts = destination.split(":").map((part) => String(part || "").trim()).filter((part) => part !== "");
  let targetWorld = fallbackWorld;
  let targetDoorId = "";

  if (parts.length >= 3 && parts[1].toLowerCase() === "door") {
    targetWorld = cleanWorld(parts[0]);
    targetDoorId = cleanDoorId(parts[2]);
  } else if (parts.length >= 2) {
    if (parts[0].toLowerCase() === "door") {
      targetDoorId = cleanDoorId(parts[1]);
    } else {
      targetWorld = cleanWorld(parts[0]);
      targetDoorId = cleanDoorId(parts[1]);
    }
  } else {
    targetDoorId = cleanDoorId(parts[0] || destination);
  }

  return {
    destination,
    target_world: cleanWorld(targetWorld || fallbackWorld),
    target_door_id: targetDoorId,
  };
}

function canPlayerControlWorldLock(player, worldName) {
  if (isAdmin(player)) return true;
  if (!player || !player.authenticated) return false;

  const state = ensureWorldState(worldName);
  const lock = state.world_lock || {};
  const ownerKey = accountKey(lock.owner_name || "");
  return ownerKey !== "" && ownerKey === accountKey(player.account_username);
}

function isPlayerWorldOwner(player, worldName) {
  if (!player || !player.authenticated) return false;

  const state = ensureWorldState(worldName);
  const lock = state.world_lock || {};
  const ownerKey = accountKey(lock.owner_name || lock.owner_username || "");
  return ownerKey !== "" && ownerKey === accountKey(player.account_username);
}

function canPlayerBuildInWorld(player, worldName) {
  if (isAdmin(player)) return true;
  if (!player || !player.authenticated) return false;

  const state = ensureWorldState(worldName);
  const lock = state.world_lock || {};
  if (!lock.is_locked) return true;

  const playerKey = accountKey(player.account_username);
  if (playerKey === "") return false;
  if (accountKey(lock.owner_name || "") === playerKey) return true;
  if (Boolean(lock.public_build)) return true;

  return canWorldLockRoleBuild(getWorldLockRoleForAccount(lock, player.account_username));
}

function canPlayerConfigureDoor(player, worldName) {
  if (isAdmin(player)) return true;
  if (!player || !player.authenticated) return false;

  const state = ensureWorldState(worldName);
  const lock = state.world_lock || {};
  if (!lock.is_locked) return true;

  if (isWorldLockOwnerAccount(lock, player.account_username)) return true;
  return canWorldLockRoleBuild(getWorldLockRoleForAccount(lock, player.account_username));
}

function canPlayerToggleDoorLock(player, worldName) {
  if (isAdmin(player)) return true;
  if (!player || !player.authenticated) return false;

  const state = ensureWorldState(worldName);
  const lock = state.world_lock || {};
  if (!lock.is_locked) return true;

  if (isWorldLockOwnerAccount(lock, player.account_username)) return true;
  return canWorldLockRoleToggleWoodenEntrance(getWorldLockRoleForAccount(lock, player.account_username));
}

function canPlayerPassDoor(player, worldName) {
  if (isAdmin(player)) return true;
  if (!player || !player.authenticated) return false;

  const state = ensureWorldState(worldName);
  const lock = state.world_lock || {};
  if (!lock.is_locked) return true;

  if (isWorldLockOwnerAccount(lock, player.account_username)) return true;
  return getWorldLockRoleForAccount(lock, player.account_username) !== "";
}

function requireBuildPermission(socket, player, worldName, action) {
  if (canPlayerBuildInWorld(player, worldName)) return true;

  sendActionRejected(socket, action, "This world is locked.");
  return false;
}

function getGridCenterPixels(x, y) {
  return {
    x: (Number(x) || 0) * TILE_SIZE,
    y: (Number(y) || 0) * TILE_SIZE,
  };
}

function isPlayerNearPoint(player, x, y, maxDistance = MAX_GRID_ACTION_DISTANCE_PIXELS) {
  if (!player) return false;
  const px = Number(player.x);
  const py = Number(player.y);
  const tx = Number(x);
  const ty = Number(y);
  if (![px, py, tx, ty].every(Number.isFinite)) return false;
  return Math.hypot(px - tx, py - ty) <= maxDistance;
}

function isPlayerNearGrid(player, x, y, maxDistance = MAX_GRID_ACTION_DISTANCE_PIXELS) {
  const center = getGridCenterPixels(x, y);
  return isPlayerNearPoint(player, center.x, center.y, maxDistance);
}

function getPlayerGridPosition(player) {
  const px = Number(player?.x);
  const py = Number(player?.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return {
    x: Math.round(px / TILE_SIZE),
    y: Math.round(py / TILE_SIZE),
  };
}

function isPlayerStandingOnGrid(player, x, y) {
  const playerGrid = getPlayerGridPosition(player);
  if (!playerGrid) return false;
  const deltaX = Math.abs(playerGrid.x - Math.trunc(Number(x) || 0));
  const deltaY = Math.abs(playerGrid.y - Math.trunc(Number(y) || 0));
  return deltaX === 0 && deltaY === 0;
}

function buildInventoryDeltasBetweenStates(beforeState, afterState) {
  const deltas = [];
  const seen = new Set();
  const fields = Object.values(ItemDatabase.CATEGORY_TO_FIELD || {});

  for (const field of fields) {
    const beforeInventory = beforeState && beforeState[field] && typeof beforeState[field] === "object" && !Array.isArray(beforeState[field])
      ? beforeState[field]
      : {};
    const afterInventory = afterState && afterState[field] && typeof afterState[field] === "object" && !Array.isArray(afterState[field])
      ? afterState[field]
      : {};
    for (const itemId of Object.keys(beforeInventory).concat(Object.keys(afterInventory))) {
      const cleanItemId = clampString(itemId || "");
      if (cleanItemId === "" || seen.has(`${field}\u0000${cleanItemId}`)) continue;
      seen.add(`${field}\u0000${cleanItemId}`);
      if (!ItemDatabase.hasItem(cleanItemId)) continue;

      const fallbackCategory = ItemDatabase.FIELD_TO_CATEGORY[field] || resolveInventoryCategory(cleanItemId);
      const itemCategory = resolveInventoryCategory(cleanItemId, fallbackCategory);
      if (!ItemDatabase.canStoreItemInCategory(cleanItemId, itemCategory)) continue;

      const beforeAmount = getInventoryCount(beforeState, cleanItemId, itemCategory);
      const afterAmount = getInventoryCount(afterState, cleanItemId, itemCategory);
      const delta = afterAmount - beforeAmount;
      if (delta === 0) continue;

      deltas.push({
        item_type: cleanItemId,
        item_category: itemCategory,
        delta,
        expected_before_amount: beforeAmount,
        stack_limit: ItemDatabase.getStackLimit(cleanItemId),
      });
    }
  }

  return deltas;
}

function writePlayerStateJsonBackup(username, state) {
  const clean = cleanAccountName(username);
  if (clean === "" || !state) return;

  writeJsonFileAtomic(getPlayerSavePath(clean), {
    player_state_version: 1,
    username: clean,
    saved_at: new Date().toISOString(),
    player_data: state,
  });
}

function writeWorldStateJsonBackup(worldName, serialized = null) {
  const clean = cleanWorld(worldName);
  const worldState = serialized && typeof serialized === "object" && !Array.isArray(serialized)
    ? serialized
    : serializeWorldState(clean);
  pendingWorldJsonBackups.set(clean, worldState);

  const shouldDebounce = isPostgresAuthoritativeReady() && WORLD_JSON_BACKUP_DEBOUNCE_MS > 0;
  if (!shouldDebounce) {
    flushWorldStateJsonBackup(clean);
    return;
  }

  const existingTimer = worldJsonBackupTimers.get(clean);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    flushWorldStateJsonBackup(clean);
  }, WORLD_JSON_BACKUP_DEBOUNCE_MS);
  if (typeof timer.unref === "function") timer.unref();
  worldJsonBackupTimers.set(clean, timer);
}

function flushWorldStateJsonBackup(worldName, options = {}) {
  const clean = cleanWorld(worldName);
  const timer = worldJsonBackupTimers.get(clean);
  if (timer) {
    clearTimeout(timer);
    worldJsonBackupTimers.delete(clean);
  }

  const worldState = pendingWorldJsonBackups.get(clean);
  if (!worldState) return;
  pendingWorldJsonBackups.delete(clean);

  if (options.sync === true) {
    writeJsonFileAtomic(getWorldSavePath(clean), worldState);
    return;
  }

  trackPersistenceWrite(writeJsonFileAtomicAsync(getWorldSavePath(clean), worldState), `world JSON backup ${clean}`);
}

function flushWorldStateJsonBackups(options = {}) {
  const worlds = new Set([
    ...worldJsonBackupTimers.keys(),
    ...pendingWorldJsonBackups.keys(),
  ]);
  for (const worldName of worlds) {
    flushWorldStateJsonBackup(worldName, options);
  }
}

function persistWorldStateAfterInventoryCommit(worldName, postgresCommitted, serialized = null) {
  if (postgresCommitted) {
    writeWorldStateJsonBackup(worldName, serialized);
    return;
  }

  queueWorldSave(worldName);
}

function getPostgresInventoryFailureMessage(result, fallback = "Server inventory changed. Try again.") {
  const reason = String(result?.reason || "");
  if (reason === "postgres_unavailable") return "PostgreSQL is not ready.";
  if (reason === "insufficient_inventory") {
    const item = clampString(result?.item_type || "that item");
    return `Not enough ${item}.`;
  }
  if (reason === "insufficient_capacity") {
    const item = clampString(result?.item_type || "that item");
    return `Your inventory cannot hold ${item}.`;
  }
  if (
    reason === "insufficient_item_instances" ||
    reason === "insufficient_locked_item_instances" ||
    reason === "missing_world_drop_item_instances" ||
    reason === "missing_item_instance_source" ||
    reason === "trade_missing_item_instances" ||
    reason === "vending_missing_item_instances" ||
    reason === "vending_payment_missing_item_instances"
  ) {
    const item = clampString(result?.item_type || "that item");
    return `Tracked item data is missing for ${item}.`;
  }
  if (reason === "player_not_found" || reason === "invalid_username") return "Could not load your server inventory.";
  if (reason === "database_error") return "PostgreSQL rejected the inventory update.";
  return fallback;
}

async function commitPlayerInventoryState(socket, player, username, beforeState, afterState, options = {}) {
  if (!afterState) {
    return { ok: false, message: "Could not load your server inventory." };
  }

  const cleanUsername = cleanAccountName(username || afterState.account_username || player?.account_username || "");
  if (cleanUsername === "") {
    return { ok: false, message: "Could not load your server inventory." };
  }

  let inventoryLock = null;
  if (options.skip_inventory_lock !== true) {
    inventoryLock = await acquirePlayerInventoryLocks([cleanUsername], options.inventory_lock_owner || options.action || "inventory_commit");
    if (!inventoryLock.acquired) {
      return { ok: false, reason: "inventory_locked", message: "Your inventory is busy. Try again." };
    }
  }

  try {
  afterState.saved_at = new Date().toISOString();
  const deltas = buildInventoryDeltasBetweenStates(beforeState || {}, afterState);

  if (isPostgresAuthoritativeReady()) {
    const result = await postgresStore.applyInventoryDeltaTransaction({
      account_username: cleanUsername,
      world: options.world || player?.world || "START",
      source: options.source || options.source_type || options.action || "system",
      action: options.action || "update",
      reason: options.reason || options.action || "update",
      request_id: options.request_id || "",
      correlation_id: options.correlation_id || "",
      metadata: options.metadata || {},
      ip_address: options.ip_address || getSocketAddress(socket),
      user_agent: options.user_agent || "",
      session_token_hash: options.session_token_hash || "",
      device_info: options.device_info || {},
      deltas,
      player_state: afterState,
      world_state: options.world_state || {},
      world_changes: Array.isArray(options.world_changes) ? options.world_changes : [],
      allow_state_repair: options.allow_state_repair === true,
      at: new Date().toISOString(),
    });

    if (!result || !result.ok) {
      logSecurityEvent(socket, player, "postgres_inventory_commit_failed", {
        username: cleanUsername,
        action: options.action || "",
        source: options.source || "",
        reason: result?.reason || "unknown",
        item_type: result?.item_type || "",
      }, "warning");
      return {
        ok: false,
        reason: result?.reason || "postgres_failed",
        message: getPostgresInventoryFailureMessage(result, options.failure_message || "Server inventory changed. Try again."),
      };
    }

    if (Array.isArray(result.ledger_entries) && result.ledger_entries.length > 0) {
      if (!applyInventoryLedgerToState(afterState, result.ledger_entries)) {
        return { ok: false, reason: "state_reconcile_failed", message: "Inventory reconciliation failed." };
      }
    }

    setPlayerState(cleanUsername, afterState);
    writePlayerStateJsonBackup(cleanUsername, afterState);
    return { ok: true, state: afterState, postgres_committed: true, deltas };
  }

  if (POSTGRES_ENABLED && POSTGRES_AUTHORITATIVE) {
    return { ok: false, reason: "postgres_unavailable", message: "PostgreSQL is not ready." };
  }

  return { ok: true, state: persistPlayerInventoryChange(cleanUsername, afterState), postgres_committed: false, deltas };
  } finally {
    releasePlayerInventoryLocks(inventoryLock);
  }
}

function persistPlayerInventoryChange(username, state, options = {}) {
  if (!state) return null;
  state.saved_at = new Date().toISOString();
  setPlayerState(username, state);
  if (options.postgresCommitted) {
    writePlayerStateJsonBackup(username, state);
  } else {
    queuePlayerSave(username);
  }
  return state;
}

async function spendServerInventoryCost(username, cost, options = {}) {
  if (!cost || Number(cost.amount) <= 0) return { ok: true, state: null };

  const state = ensureWritablePlayerState(username);
  if (!state) {
    return { ok: false, message: "Could not load your server inventory." };
  }

  if (!ItemDatabase.hasItem(cost.item_id) || !ItemDatabase.canStoreItemInCategory(cost.item_id, cost.item_category)) {
    return { ok: false, message: "That item is not valid on the server." };
  }

  if (getInventoryCount(state, cost.item_id, cost.item_category) < cost.amount) {
    return { ok: false, message: `Not enough ${cost.item_id}.` };
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  if (!spendItemFromState(stagedState, cost.item_id, cost.item_category, cost.amount)) {
    return { ok: false, message: "Server inventory changed. Try again." };
  }

  if (options.defer_commit === true) {
    return {
      ok: true,
      state: stagedState,
      postgres_committed: false,
      deferred_inventory_commit: {
        username,
        beforeState,
        afterState: stagedState,
        options: {
          source: options.source || "system",
          action: options.action || "spend_inventory_cost",
          reason: options.reason || "inventory_cost",
          request_id: options.request_id || "",
          correlation_id: options.correlation_id || "",
          world: options.world || options.player?.world || "",
          metadata: {
            ...(options.metadata || {}),
            item_id: cost.item_id,
            item_category: cost.item_category,
            amount: cost.amount,
          },
          failure_message: options.failure_message || "Server inventory changed. Try again.",
        },
      },
    };
  }

  const commit = await commitPlayerInventoryState(options.socket || null, options.player || null, username, beforeState, stagedState, {
    source: options.source || "system",
    action: options.action || "spend_inventory_cost",
    reason: options.reason || "inventory_cost",
    request_id: options.request_id || "",
    correlation_id: options.correlation_id || "",
    world: options.world || options.player?.world || "",
    metadata: {
      ...(options.metadata || {}),
      item_id: cost.item_id,
      item_category: cost.item_category,
      amount: cost.amount,
    },
    failure_message: options.failure_message || "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    return { ok: false, message: commit.message, reason: commit.reason };
  }

  return { ok: true, state: commit.state, postgres_committed: commit.postgres_committed };
}

function makeServerDropId(worldName, itemType) {
  const cleanWorldName = safeFileName(cleanWorld(worldName), "START");
  const cleanItem = safeFileName(clampString(itemType || "drop"), "drop");
  return `server_${cleanWorldName}_${cleanItem}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function randomChance(chance) {
  const safeChance = Math.max(0, Math.min(1, Number(chance) || 0));
  if (safeChance <= 0) return false;
  if (safeChance >= 1) return true;
  return crypto.randomInt(0, 1000000) < Math.floor(safeChance * 1000000);
}

function randomRangeInclusive(min, max) {
  const safeMin = Math.trunc(Number(min) || 0);
  const safeMax = Math.trunc(Number(max) || safeMin);
  if (safeMax <= safeMin) return safeMin;
  return crypto.randomInt(safeMin, safeMax + 1);
}

function validateBlockBreakPace(socket, player) {
  if (isAdmin(player)) return true;

  const now = Date.now();
  const lastBreakAt = Number(player.last_block_break_at || 0);
  if (lastBreakAt > 0 && now - lastBreakAt < MIN_BLOCK_BREAK_INTERVAL_MS) {
    sendActionRejected(socket, "world_block_update", "Slow down a little.");
    return false;
  }

  player.last_block_break_at = now;
  return true;
}

function makeBlockDamageKey(worldName, update) {
  return `${cleanWorld(worldName)}:${update.layer}:${Math.trunc(Number(update.x) || 0)},${Math.trunc(Number(update.y) || 0)}:${clampString(update.block_type || "")}`;
}

function clearServerBlockDamage(worldName, update) {
  if (!update) return;
  blockDamage.delete(makeBlockDamageKey(worldName, update));
}

function getPlayerBreakPower(player, blockType) {
  const handItem = clampString(player?.equipment_slots?.hand || "");
  return ItemDatabase.getBreakPower(handItem, blockType);
}

function applyServerBlockDamage(player, worldName, update) {
  const key = makeBlockDamageKey(worldName, update);
  const now = Date.now();
  const requiredDamage = ItemDatabase.getBlockHealth(update.block_type);
  const hitPower = getPlayerBreakPower(player, update.block_type);
  const previous = blockDamage.get(key);
  const currentDamage = previous && now - previous.updatedAt <= BLOCK_DAMAGE_RESET_MS
    ? Math.max(0, Math.trunc(Number(previous.damage) || 0))
    : 0;
  const nextDamage = Math.min(requiredDamage, currentDamage + hitPower);

  if (nextDamage < requiredDamage) {
    blockDamage.set(key, {
      damage: nextDamage,
      updatedAt: now,
    });
    return {
      ok: true,
      shouldBreak: false,
      damage: nextDamage,
      required: requiredDamage,
      hitPower,
    };
  }

  blockDamage.delete(key);
  return {
    ok: true,
    shouldBreak: true,
    damage: requiredDamage,
    required: requiredDamage,
    hitPower,
  };
}

function getGemDropRangeForRarity(rarity) {
  switch (String(rarity || "common").toLowerCase()) {
    case "uncommon":
      return [1, 3];
    case "rare":
      return [2, 6];
    case "epic":
      return [5, 12];
    case "legendary":
      return [15, 40];
    case "common":
    default:
      return [0, 1];
  }
}

function getBlockDropChanceForRarity(rarity) {
  switch (String(rarity || "common").toLowerCase()) {
    case "uncommon":
      return 0.8;
    case "rare":
      return 0.65;
    case "epic":
      return 0.45;
    case "legendary":
      return 0.25;
    case "common":
    default:
      return 0.9;
  }
}

function getSeedDropChanceForRarity(rarity) {
  switch (String(rarity || "common").toLowerCase()) {
    case "uncommon":
      return 0.6;
    case "rare":
      return 0.4;
    case "epic":
      return 0.2;
    case "legendary":
      return 0.1;
    case "common":
    default:
      return 0.8;
  }
}

function shouldSuppressRarityGemDrop(rules) {
  if (!rules || typeof rules !== "object" || !Array.isArray(rules.gem_range)) return false;
  const max = Math.trunc(Number(rules.gem_range[1]) || 0);
  return max <= 0;
}

function shouldSuppressRaritySeedDrop(rules) {
  if (!rules || typeof rules !== "object" || !Object.prototype.hasOwnProperty.call(rules, "seed_chance")) return false;
  return Number(rules.seed_chance) <= 0;
}

function shouldAlwaysReturnBlockOnBreak(itemId, definition, rules) {
  if (isVendBlockType(itemId)) return true;
  if (itemId === "crafting_station") return true;
  if (rules && rules.drops_self === true) return true;
  if (Number(definition?.shop_price || 0) > 0) return true;
  return false;
}

function createServerDrop(worldName, itemType, itemCategory, amount, x, y, pickupDelay = SERVER_DROP_PICKUP_DELAY) {
  const itemId = clampString(itemType || "");
  if (!ItemDatabase.hasItem(itemId)) return null;

  const resolvedCategory = resolveInventoryCategory(itemId, itemCategory);
  if (!ItemDatabase.canStoreItemInCategory(itemId, resolvedCategory)) return null;

  const safeAmount = clampInteger(amount || 1, 1, MAX_DROP_TILE_AMOUNT);
  const payload = {
    type: "drop_spawned",
    world: cleanWorld(worldName),
    drop_id: makeServerDropId(worldName, itemId),
    item_type: itemId,
    item_category: resolvedCategory,
    is_seed: resolvedCategory === "seed",
    amount: safeAmount,
    x: Number(x) || 0,
    y: Number(y) || 0,
    pickup_delay: Math.max(0, Number(pickupDelay) || 0),
  };

  applyDropCreateToWorldState(worldName, payload);
  return payload;
}

function getFixedBreakDropAmount(fixedDrop) {
  if (!fixedDrop || typeof fixedDrop !== "object") return 0;

  const amountRange = Array.isArray(fixedDrop.amount_range)
    ? fixedDrop.amount_range
    : (Array.isArray(fixedDrop.amountRange) ? fixedDrop.amountRange : null);
  if (amountRange && amountRange.length >= 2) {
    const minAmount = clampInteger(amountRange[0], 0, MAX_DROP_TILE_AMOUNT);
    const maxAmount = clampInteger(amountRange[1], minAmount, MAX_DROP_TILE_AMOUNT);
    return randomRangeInclusive(Math.min(minAmount, maxAmount), Math.max(minAmount, maxAmount));
  }

  return clampInteger(fixedDrop.amount || 1, 1, MAX_DROP_TILE_AMOUNT);
}

function getBreakDropFromRuleEntry(ruleEntry) {
  if (!ruleEntry || typeof ruleEntry !== "object") return null;

  const dropItemId = clampString(ruleEntry.item_id || ruleEntry.item_type || "");
  if (dropItemId === "" || !ItemDatabase.hasItem(dropItemId)) return null;

  const dropCategory = resolveInventoryCategory(dropItemId, ruleEntry.item_category || ruleEntry.category || "");
  if (!ItemDatabase.canStoreItemInCategory(dropItemId, dropCategory)) return null;

  const amount = getFixedBreakDropAmount(ruleEntry);
  if (amount <= 0) return null;

  return {
    item_id: dropItemId,
    item_category: dropCategory,
    amount,
  };
}

function rollWeightedBreakDrop(lootTable) {
  if (!Array.isArray(lootTable)) return null;

  const candidates = [];
  let totalWeight = 0;
  for (const entry of lootTable) {
    if (!entry || typeof entry !== "object") continue;
    const drop = getBreakDropFromRuleEntry(entry);
    if (!drop) continue;

    const weight = Math.max(0, Number(entry.weight) || 0);
    if (weight <= 0) continue;

    totalWeight += weight;
    candidates.push({ drop, weight });
  }

  if (totalWeight <= 0 || candidates.length === 0) return null;

  let roll = Math.random() * totalWeight;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll < 0) return candidate.drop;
  }

  return candidates[candidates.length - 1].drop;
}

function getConfiguredDropsFromRules(rules) {
  if (!rules || typeof rules !== "object") return null;

  const lootTable = Array.isArray(rules.loot_table)
    ? rules.loot_table
    : (Array.isArray(rules.weighted_drops) ? rules.weighted_drops : null);
  if (lootTable) {
    const weightedDrop = rollWeightedBreakDrop(lootTable);
    return weightedDrop ? [weightedDrop] : [];
  }

  if (!Array.isArray(rules.fixed_drops)) return null;

  const drops = [];
  for (const fixedDrop of rules.fixed_drops) {
    const chance = Object.prototype.hasOwnProperty.call(fixedDrop, "chance")
      ? Math.max(0, Math.min(1, Number(fixedDrop.chance) || 0))
      : 1;
    if (Math.random() > chance) continue;

    const drop = getBreakDropFromRuleEntry(fixedDrop);
    if (drop) drops.push(drop);
  }
  return drops;
}

function getBreakDropsForBlock(blockType, layer) {
  const itemId = clampString(blockType || "");
  const definition = ItemDatabase.getItemDefinition(itemId);
  if (!definition || definition.category !== "block") return [];

  const drops = [];
  const rules = definition.drop_rules && typeof definition.drop_rules === "object" ? definition.drop_rules : {};
  const configuredDrops = getConfiguredDropsFromRules(rules);
  if (configuredDrops) return configuredDrops;

  if (isVendBlockType(itemId)) {
    drops.push({ item_id: VEND_BLOCK_EMPTY, item_category: "block", amount: 1 });
  } else if (itemId === "crafting_station") {
    drops.push({ item_id: "crafting_station", item_category: "block", amount: 1 });
  } else if (
    itemId !== "crafting_station_left" &&
    itemId !== "crafting_station_right" &&
    ItemDatabase.isDropableItem(itemId) &&
    (shouldAlwaysReturnBlockOnBreak(itemId, definition, rules) || randomChance(getBlockDropChanceForRarity(definition.rarity)))
  ) {
    drops.push({ item_id: itemId, item_category: "block", amount: 1 });
  }

  const seedId = clampString(definition.seed || "");
  const seedChance = shouldSuppressRaritySeedDrop(rules) ? 0 : getSeedDropChanceForRarity(definition.rarity);
  if (seedId !== "" && ItemDatabase.hasItem(seedId) && randomChance(seedChance)) {
    drops.push({ item_id: seedId, item_category: "seed", amount: 1 });
  }

  if (layer === "foreground" && ItemDatabase.hasItem("gem")) {
    const configuredRange = shouldSuppressRarityGemDrop(rules) ? [0, 0] : getGemDropRangeForRarity(definition.rarity);
    const gemAmount = randomRangeInclusive(configuredRange[0], configuredRange[1]);
    if (gemAmount > 0) {
      drops.push({ item_id: "gem", item_category: "currency", amount: gemAmount });
    }
  }

  return drops;
}

function getTreeHarvestDropsForBlock(blockType) {
  const itemId = clampString(blockType || "");
  const definition = ItemDatabase.getItemDefinition(itemId);
  if (!definition || definition.category !== "block") return null;

  const rules = definition.tree_drop_rules && typeof definition.tree_drop_rules === "object"
    ? definition.tree_drop_rules
    : (definition.harvest_drop_rules && typeof definition.harvest_drop_rules === "object" ? definition.harvest_drop_rules : null);
  return getConfiguredDropsFromRules(rules);
}

function createBreakDrops(worldName, update) {
  if (!update || update.action !== "break" || update.block_type === "") return [];

  const position = getGridCenterPixels(update.x, update.y);
  const drops = getBreakDropsForBlock(update.block_type, update.layer);
  const createdDrops = [];
  for (const drop of drops) {
    const payload = createServerDrop(
      worldName,
      drop.item_id,
      drop.item_category,
      drop.amount,
      position.x,
      position.y,
      SERVER_DROP_PICKUP_DELAY
    );
    if (!payload) continue;
    createdDrops.push(payload);
  }
  return createdDrops;
}

function emitBreakDrops(worldName, update, socket = null, player = null) {
  const createdDrops = createBreakDrops(worldName, update);
  for (const payload of createdDrops) {
    if (socket && player) {
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, payload);
    } else {
      broadcastToWorld(worldName, payload);
    }
  }
  return createdDrops;
}

async function prepareVendBreakInventoryReturn(socket, player, worldName, update) {
  const vend = getVendStateAt(worldName, update.x, update.y, false);
  const listing = vend.listing && Number(vend.listing.stock) > 0 ? vend.listing : null;
  const pendingWls = clampInteger(vend.pending_wls || 0, 0, ItemDatabase.getStackLimit("world_lock"));

  if (!listing && pendingWls <= 0) {
    return { ok: true, playerState: null, message: "" };
  }

  if (!canPlayerManageVend(player, vend, worldName)) {
    sendActionRejected(socket, "world_block_update", isWorldLocked(worldName) ? "Only the world owner can break this vending machine." : "Only the vending machine owner can break it while it has items.");
    return { ok: false };
  }

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    sendActionRejected(socket, "world_block_update", "Could not load your server inventory.");
    return { ok: false };
  }

  const beforeState = cloneJson(state);
  const stagedState = cloneJson(state);
  const originalVend = cloneJson(vend);
  const returned = [];
  const returnedEntries = [];
  if (listing) {
    const itemId = clampString(listing.item_id || "");
    const itemCategory = resolveInventoryCategory(itemId, listing.item_category || "");
    const stock = clampInteger(listing.stock || 0, 1, ItemDatabase.getStackLimit(itemId));
    if (!canAddItemToState(stagedState, itemId, itemCategory, stock)) {
      sendActionRejected(socket, "world_block_update", "Your inventory cannot hold the vending item.");
      return { ok: false };
    }

    addItemToState(stagedState, itemId, itemCategory, stock);
    returned.push(`${itemId} x${stock}`);
    returnedEntries.push({
      item_id: itemId,
      item_category: itemCategory,
      amount: stock,
      reason: "vending_stock",
      listing_transaction_id: listing.listing_id || listing.transaction_id || "",
    });
    vend.listing = null;
  }

  if (pendingWls > 0) {
    if (!canAddItemToState(stagedState, "world_lock", "block", pendingWls)) {
      sendActionRejected(socket, "world_block_update", "Your inventory cannot hold those World Locks.");
      return { ok: false };
    }

    addItemToState(stagedState, "world_lock", "block", pendingWls);
    returned.push(`World Lock x${pendingWls}`);
    returnedEntries.push({
      item_id: "world_lock",
      item_category: "block",
      amount: pendingWls,
      reason: "vending_pending_wls",
    });
    vend.pending_wls = 0;
  }

  setVendStateAt(worldName, vend);
  const vendBreakTransactionId = makeAuditId("vend_break");
  const serializedWorld = serializeWorldState(worldName);
  const commit = await commitPlayerInventoryState(socket, player, player.account_username, beforeState, stagedState, {
    source: "vending",
    action: "vending_break_return",
    reason: "vending_break_return",
    request_id: "",
    world: worldName,
    metadata: { transaction_id: vendBreakTransactionId, x: vend.x, y: vend.y, returned_entries: returnedEntries },
    world_state: serializedWorld,
    failure_message: "Server inventory changed. Try again.",
  });
  if (!commit.ok) {
    setVendStateAt(worldName, originalVend);
    sendActionRejected(socket, "world_block_update", commit.message);
    return { ok: false };
  }
  const committedState = commit.state;
  persistWorldStateAfterInventoryCommit(worldName, commit.postgres_committed, serializedWorld);
  logVendingTransaction(socket, player, {
    transaction_id: vendBreakTransactionId,
    action: "break_return",
    world: worldName,
    x: vend.x,
    y: vend.y,
    owner_username: vend.owner_username,
    amount: returnedEntries.reduce((total, entry) => total + Number(entry.amount || 0), 0),
    stock_after: 0,
    pending_wls_after: 0,
    details: { returned_entries: returnedEntries },
  });
  logWorldChange(socket, player, {
    source_type: "vending_break_return",
    source_id: vendBreakTransactionId,
    world: worldName,
    action: "vending_break_return",
    x: vend.x,
    y: vend.y,
    block_type: update.block_type,
    details: { returned_entries: returnedEntries },
  });
  for (const entry of returnedEntries) {
    logItemLedgerForState(socket, player, player.account_username, committedState, entry.item_id, entry.item_category, entry.amount, "vending_break_return", vendBreakTransactionId, entry.reason, worldName, {
      x: vend.x,
      y: vend.y,
    }, { skipPostgres: commit.postgres_committed });
  }

  return {
    ok: true,
    playerState: committedState,
    postgres_committed: commit.postgres_committed,
    message: returned.length > 0 ? `Returned ${returned.join(", ")}.` : "",
  };
}

async function validateBlockUpdateAgainstServerState(socket, player, worldName, update, requestId = "") {
  const state = ensureWorldState(worldName);
  let key = gridKey(update.x, update.y);

  if (!isPlayerNearGrid(player, update.x, update.y)) {
    sendActionRejected(socket, "world_block_update", "Too far away.");
    return { ok: false };
  }

  if (update.action === "break" || update.action === "hit") {
    const targetLayer = update.layer === "background" ? state.background : state.foreground;
    const removedLayer = update.layer === "background" ? state.removed_background : state.removed_foreground;
    let serverBlock = targetLayer.get(key);
    if (!serverBlock && update.layer !== "background") {
      const anchorBlock = getCollisionAreaAnchorInState(state, update.x, update.y);
      if (anchorBlock) {
        update.x = anchorBlock.x;
        update.y = anchorBlock.y;
        key = gridKey(update.x, update.y);
        serverBlock = targetLayer.get(key);
      }
    }
    const blockType = serverBlock ? serverBlock.block_type : update.block_type;

    if (removedLayer.has(key) && !serverBlock) {
      sendActionRejected(socket, "world_block_update", "That block is already broken.");
      return { ok: false };
    }

    if (blockType === "") {
      sendActionRejected(socket, "world_block_update", "Server needs a block type to break.");
      return { ok: false };
    }

    if (serverBlock && update.block_type !== "" && serverBlock.block_type !== update.block_type) {
      sendActionRejected(socket, "world_block_update", "That block changed on the server.");
      return { ok: false };
    }

    const expectedLayer = ItemDatabase.getPlaceLayer(blockType);
    if (expectedLayer !== "" && expectedLayer !== update.layer) {
      sendActionRejected(socket, "world_block_update", "That block is on a different layer.");
      return { ok: false };
    }

    update.block_type = blockType;

    if (update.block_type !== "" && !ItemDatabase.canBreakBlock(update.block_type)) {
      sendActionRejected(socket, "world_block_update", "That block cannot be broken.");
      return { ok: false };
    }

    if (update.layer !== "background" && isDoorBlockType(update.block_type) && isPlayerStandingOnGrid(player, update.x, update.y)) {
      sendActionRejected(socket, "world_block_update", "Step off the door to break it.");
      return { ok: false };
    }

    if (isWorldLockBlockType(update.block_type) && hasWorldLockProtectedStorageBlocks(worldName)) {
      sendActionRejected(socket, "world_block_update", "Remove all Safes, vending machines, and Fish Mongers before breaking the World Lock.");
      return { ok: false };
    }

    const isVendBreak = isVendBlockType(update.block_type);
    const isSafeBreak = isSafeBlockType(update.block_type);
    const isFishMongerBreak = isFishMongerBlockType(update.block_type);

    if (isFishMongerBreak && !canPlayerBreakFishMonger(player, worldName, update)) {
      sendActionRejected(socket, "world_block_update", "Only the world owner or players with access can break the Fish Monger.");
      return { ok: false };
    }

    if (!validateBlockBreakPace(socket, player)) {
      return { ok: false };
    }

    if (isVendBreak) {
      if (!canPlayerBreakVendingMachine(player, worldName, update)) {
        sendActionRejected(socket, "world_block_update", isWorldLocked(worldName) ? "Only the world owner can break vending machines." : "Lock the world before breaking vending machines.");
        return { ok: false };
      }
    }

    if (isSafeBreak) {
      if (!canPlayerBreakSafe(player, worldName, update)) {
        sendActionRejected(socket, "world_block_update", isWorldLocked(worldName) ? "Only the world owner can break safes." : "Lock the world before breaking safes.");
        return { ok: false };
      }
    }

    const damageResult = applyServerBlockDamage(player, worldName, update);
    if (!damageResult.ok) return { ok: false };
    update.hit_power = clampInteger(damageResult.hitPower || 1, 1, MAX_BLOCK_HIT_METRIC);
    update.hit_count = clampInteger(damageResult.damage || 0, 0, MAX_BLOCK_HIT_METRIC);
    update.max_hits = clampInteger(damageResult.required || 1, 1, MAX_BLOCK_HIT_METRIC);
    update.damage_reset_ms = BLOCK_DAMAGE_RESET_MS;
    if (!damageResult.shouldBreak) {
      update.action = "hit";
      return { ok: true, pendingHit: true };
    }

    update.action = "break";

    if (isVendBreak) {
      const vendReturn = await prepareVendBreakInventoryReturn(socket, player, worldName, update);
      if (!vendReturn.ok) return { ok: false };
      return {
        ok: true,
        playerState: vendReturn.playerState || null,
        postgres_committed: vendReturn.postgres_committed,
        message: vendReturn.message || "",
      };
    }

    if (isSafeBreak) {
      const safeReturn = await prepareSafeBreakInventoryReturn(socket, player, worldName, update);
      if (!safeReturn.ok) return { ok: false };
      return {
        ok: true,
        playerState: safeReturn.playerState || null,
        postgres_committed: safeReturn.postgres_committed,
        message: safeReturn.message || "",
      };
    }
    return { ok: true };
  }

  if (update.block_type === "crafting_station_left" || update.block_type === "crafting_station_right") {
    sendActionRejected(socket, "world_block_update", "Crafting Station is one block now. Please update your game.");
    return { ok: false };
  }

  if (!ItemDatabase.isPlaceableBlock(update.block_type)) {
    sendActionRejected(socket, "world_block_update", "That item cannot be placed.");
    return { ok: false };
  }

  if (isWorldLockBlockType(update.block_type) && (state.world_lock?.is_locked || hasWorldLockBlock(worldName))) {
    sendActionRejected(socket, "world_block_update", "This world already has a World Lock.");
    return { ok: false };
  }

  if (isFishMongerBlockType(update.block_type) && blockRequiresWorldLock(update.block_type) && !canPlayerPlaceFishMonger(player, worldName)) {
    const message = isWorldLocked(worldName) || hasWorldLockBlock(worldName)
      ? "This world is locked."
      : "You need a World Lock in this world before placing a Fish Monger.";
    sendActionRejected(socket, "world_block_update", message);
    return { ok: false };
  }

  if (isVendBlockType(update.block_type) && !canPlayerPlaceVendingMachine(player, worldName)) {
    sendActionRejected(socket, "world_block_update", isWorldLocked(worldName) ? "Only the world owner can place vending machines." : "Lock this world before placing vending machines.");
    return { ok: false };
  }

  if (isSafeBlockType(update.block_type) && !canPlayerPlaceSafe(player, worldName)) {
    sendActionRejected(socket, "world_block_update", isWorldLocked(worldName) ? "Only the world owner can place safes." : "Lock this world before placing safes.");
    return { ok: false };
  }

  const requiredLayer = ItemDatabase.getPlaceLayer(update.block_type);
  if (requiredLayer !== update.layer) {
    sendActionRejected(socket, "world_block_update", `Place ${update.block_type} on the ${requiredLayer} layer.`);
    return { ok: false };
  }

  const targetLayer = update.layer === "background" ? state.background : state.foreground;
  if (targetLayer.has(key)) {
    sendActionRejected(socket, "world_block_update", "That spot is already occupied.");
    return { ok: false };
  }

  if (update.layer === "foreground" && state.seeds.has(key)) {
    sendActionRejected(socket, "world_block_update", "A seed is already planted there.");
    return { ok: false };
  }

  if (update.layer === "foreground") {
    if (blockRequiresFullAreaClear(update.block_type)) {
      if (!validateFullCollisionAreaPlacement(socket, state, update)) return { ok: false };
    } else if (doesPlacementOverlapReservedObject(state, update.x, update.y, update.block_type)) {
      sendActionRejected(socket, "world_block_update", "Need enough empty space.");
      return { ok: false };
    }
  }

  const cost = ItemDatabase.getPlacementCost(update.block_type);
  const spendResult = await spendServerInventoryCost(player.account_username, cost, {
    socket,
    player,
    source: "world_block_place",
    action: "world_block_place",
    reason: "placement_cost",
    request_id: requestId,
    world: worldName,
    metadata: { x: update.x, y: update.y, placed_block: update.block_type, layer: update.layer },
    defer_commit: isPostgresAuthoritativeReady(),
  });
  if (!spendResult.ok) {
    sendActionRejected(socket, "world_block_update", spendResult.message);
    return { ok: false };
  }

  return {
    ok: true,
    playerState: spendResult.state,
    postgres_committed: spendResult.postgres_committed,
    deferred_inventory_commit: spendResult.deferred_inventory_commit || null,
  };
}

async function validateSeedUpdateAgainstServerState(socket, player, worldName, update, requestId = "") {
  if (update.action !== "place") return { ok: true };

  if (!isPlayerNearGrid(player, update.x, update.y)) {
    sendActionRejected(socket, "world_seed_update", "Too far away.");
    return { ok: false };
  }

  if (!ItemDatabase.hasItem(update.seed_type) || resolveInventoryCategory(update.seed_type) !== "seed") {
    sendActionRejected(socket, "world_seed_update", "That seed does not exist on the server.");
    return { ok: false };
  }

  const state = ensureWorldState(worldName);
  const key = gridKey(update.x, update.y);
  if (state.seeds.has(key)) {
    sendActionRejected(socket, "world_seed_update", "A seed is already planted there.");
    return { ok: false };
  }

  const spendResult = await spendServerInventoryCost(player.account_username, {
    item_id: update.seed_type,
    item_category: "seed",
    amount: 1,
  }, {
    socket,
    player,
    source: "seed_place",
    action: "world_seed_place",
    reason: "seed_plant_cost",
    request_id: requestId,
    world: worldName,
    metadata: { x: update.x, y: update.y, seed_type: update.seed_type },
  });
  if (!spendResult.ok) {
    sendActionRejected(socket, "world_seed_update", spendResult.message);
    return { ok: false };
  }

  return {
    ok: true,
    playerState: spendResult.state,
    postgres_committed: spendResult.postgres_committed,
  };
}

function prepareWorldLockStateUpdate(socket, player, worldName, update) {
  const state = ensureWorldState(worldName);
  const currentLock = state.world_lock || {};
  const nextLock = update.state || {};

  if (currentLock.is_locked && !canPlayerControlWorldLock(player, worldName)) {
    sendActionRejected(socket, "world_lock_state", "Only the world lock owner can change this lock.");
    return false;
  }

  if (currentLock.is_locked && !nextLock.is_locked && hasWorldLockProtectedStorageBlocks(worldName)) {
    sendActionRejected(socket, "world_lock_state", "Remove all Safes, vending machines, and Fish Mongers before unlocking the World Lock.");
    return false;
  }

  if (currentLock.is_locked && nextLock.is_locked && !isActiveWorldLockGrid(state, nextLock.lock_grid_x, nextLock.lock_grid_y)) {
    sendActionRejected(socket, "world_lock_state", "This world already has a World Lock.");
    return false;
  }

  if (nextLock.is_locked) {
    if (!isGridInWorld(nextLock.lock_grid_x, nextLock.lock_grid_y)) {
      sendActionRejected(socket, "world_lock_state", "World lock position is outside the world.");
      return false;
    }

    const lockBlock = state.foreground.get(gridKey(nextLock.lock_grid_x, nextLock.lock_grid_y));
    if (!lockBlock || !isWorldLockBlockType(lockBlock.block_type)) {
      sendActionRejected(socket, "world_lock_state", "Place a world lock block first.");
      return false;
    }
    nextLock.lock_block_type = normalizeWorldLockBlockType(lockBlock.block_type);
    nextLock.lock_type = nextLock.lock_block_type;

    if (!isAdmin(player)) {
      nextLock.owner_name = cleanName(player.account_username).toUpperCase();
    }
  }

  update.state = nextLock;
  return true;
}

function normalizeWorldLockAccessRole(value, fallback = "builder") {
  const role = String(value || "").trim().toLowerCase();
  if (role === "access") return "builder";
  if (WORLD_LOCK_ACCESS_ROLES.has(role)) return role;
  return fallback;
}

function canWorldLockRoleBuild(role) {
  const cleanRole = normalizeWorldLockAccessRole(role, "");
  return cleanRole === "admin" || cleanRole === "builder";
}

function canWorldLockRoleToggleWoodenEntrance(role) {
  return normalizeWorldLockAccessRole(role, "") === "admin";
}

function getWorldLockRoleForAccount(lock, username) {
  const playerKey = accountKey(username);
  if (playerKey === "") return "";

  const roles = lock && typeof lock.player_roles === "object" && !Array.isArray(lock.player_roles)
    ? lock.player_roles
    : {};
  for (const [name, role] of Object.entries(roles)) {
    if (accountKey(name) === playerKey) {
      return normalizeWorldLockAccessRole(role, "builder");
    }
  }

  const allowedPlayers = Array.isArray(lock?.allowed_players) ? lock.allowed_players : [];
  if (allowedPlayers.some((name) => accountKey(name) === playerKey)) {
    return "builder";
  }

  return "";
}

function isWorldLockOwnerAccount(lock, username) {
  const ownerKey = accountKey(lock?.owner_name || lock?.owner_username || "");
  if (ownerKey === "") return false;
  return ownerKey === accountKey(username);
}

function getWorldLockPullPermission(player, worldName) {
  if (!player || !player.authenticated) return { ok: false, role: "", lock: {} };

  const state = ensureWorldState(worldName);
  const lock = state.world_lock || {};
  if (!lock.is_locked) return { ok: false, role: "", lock };

  if (isWorldLockOwnerAccount(lock, player.account_username)) {
    return { ok: true, role: "owner", lock };
  }

  const role = normalizeWorldLockAccessRole(getWorldLockRoleForAccount(lock, player.account_username), "");
  if (role === "admin") {
    return { ok: true, role, lock };
  }

  return { ok: false, role: "", lock };
}

function canPlayerToggleWoodenEntrance(player, worldName) {
  if (isAdmin(player)) return true;
  if (!player || !player.authenticated) return false;

  const state = ensureWorldState(worldName);
  const lock = state.world_lock || {};
  if (!lock.is_locked) return true;

  const playerKey = accountKey(player.account_username);
  if (playerKey === "") return false;
  if (accountKey(lock.owner_name || lock.owner_username || "") === playerKey) return true;

  return canWorldLockRoleToggleWoodenEntrance(getWorldLockRoleForAccount(lock, player.account_username));
}

function canPlayerPassWoodenEntrance(player, worldName) {
  if (isAdmin(player)) return true;
  if (!player || !player.authenticated) return false;

  const state = ensureWorldState(worldName);
  const lock = state.world_lock || {};
  if (!lock.is_locked) return true;

  const playerKey = accountKey(player.account_username);
  if (playerKey === "") return false;
  if (accountKey(lock.owner_name || lock.owner_username || "") === playerKey) return true;

  return getWorldLockRoleForAccount(lock, player.account_username) !== "";
}

function isSpringboardBlockType(blockType) {
  const clean = clampString(blockType || "");
  if (clean === "mushroom" || clean === "mushroom_1" || clean === "mushroom_2") return true;
  const definition = ItemDatabase.getItemDefinition(clean) || {};
  return Boolean(definition.springboard);
}

function prepareSpringboardAnimationUpdate(socket, player, worldName, update) {
  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(update.x, update.y));
  if (!block || !isSpringboardBlockType(block.block_type)) {
    sendActionRejected(socket, "world_interaction_update", "Springboard missing.");
    return false;
  }

  if (!isPlayerNearGrid(player, update.x, update.y)) {
    sendActionRejected(socket, "world_interaction_update", "Too far away.");
    return false;
  }

  update.block_type = block.block_type;
  return true;
}

function prepareEntrancePassUpdate(socket, player, worldName, update) {
  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(update.x, update.y));
  if (!block || !isEntranceBlockType(block.block_type)) {
    sendActionRejected(socket, "world_interaction_update", "Entrance missing.");
    return false;
  }

  if (!isPlayerNearGrid(player, update.x, update.y)) {
    sendActionRejected(socket, "world_interaction_update", "Too far away.");
    return false;
  }

  const existing = state.interactions.get(gridKey(update.x, update.y)) || {};
  const locked = Boolean(existing.locked || block.entrance_locked);
  if (locked && !canPlayerPassWoodenEntrance(player, worldName)) {
    sendActionRejected(socket, "world_interaction_update", "Entrance locked.");
    return false;
  }

  update.block_type = block.block_type;
  update.walk_direction = Number(update.walk_direction) < 0 ? -1 : 1;
  return true;
}

function prepareWoodenEntranceStateUpdate(socket, player, worldName, update) {
  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(update.x, update.y));
  if (!block || !isEntranceBlockType(block.block_type)) {
    sendActionRejected(socket, "world_interaction_update", "Entrance missing.");
    return false;
  }

  if (!isPlayerNearGrid(player, update.x, update.y)) {
    sendActionRejected(socket, "world_interaction_update", "Too far away.");
    return false;
  }

  if (!canPlayerToggleWoodenEntrance(player, worldName)) {
    sendActionRejected(socket, "world_interaction_update", "Only the world owner or world admins can lock this entrance.");
    return false;
  }

  update.locked = Boolean(update.locked);
  update.block_type = block.block_type;
  return true;
}

function prepareDoorStateUpdate(socket, player, worldName, update) {
  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(update.x, update.y));
  if (!block || !isDoorBlockType(block.block_type)) {
    sendActionRejected(socket, "world_interaction_update", "Door missing.");
    return false;
  }

  if (!isPlayerNearGrid(player, update.x, update.y)) {
    sendActionRejected(socket, "world_interaction_update", "Too far away.");
    return false;
  }

  if (!canPlayerConfigureDoor(player, worldName)) {
    sendActionRejected(socket, "world_interaction_update", "Only the owner or trusted builders can edit this door.");
    return false;
  }

  const existing = state.interactions.get(gridKey(update.x, update.y)) || {};
  const existingLocked = Boolean(existing.locked || block.entrance_locked);
  if (Boolean(update.locked) !== existingLocked && !canPlayerToggleDoorLock(player, worldName)) {
    sendActionRejected(socket, "world_interaction_update", "Only the world owner or world admins can lock this door.");
    return false;
  }

  update.locked = Boolean(update.locked);
  update.block_type = block.block_type;
  return true;
}

function sanitizeDoorEnterRequest(data, worldName) {
  const x = Number(data.x);
  const y = Number(data.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const gridX = Math.trunc(x);
  const gridY = Math.trunc(y);
  if (!isGridInWorld(gridX, gridY)) return null;

  return {
    x: gridX,
    y: gridY,
    world: cleanWorld(worldName),
    request_id: makeRequestId(data),
  };
}

function getDoorStateForBlock(state, block, worldName) {
  if (!state || !block) return null;
  const key = gridKey(block.x, block.y);
  const interaction = state.interactions.get(key) || {};
  const destination = cleanDoorDestination(interaction.destination || interaction.door_destination || block.door_destination || block.destination || "");
  const parsedDestination = parseDoorDestination(destination, worldName);

  return {
    block,
    interaction,
    door_id: cleanDoorId(interaction.door_id || block.door_id || ""),
    destination,
    target_world: cleanWorld(interaction.target_world || block.door_target_world || parsedDestination.target_world || worldName),
    target_door_id: cleanDoorId(interaction.target_door_id || block.door_target_id || parsedDestination.target_door_id || ""),
    locked: Boolean(interaction.locked || block.entrance_locked),
  };
}

function getDoorAtGrid(worldName, x, y) {
  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(x, y));
  if (!block || !isDoorBlockType(block.block_type)) return null;
  return {
    state,
    ...getDoorStateForBlock(state, block, worldName),
  };
}

function findDoorById(worldName, doorId) {
  const cleanId = cleanDoorId(doorId);
  if (cleanId === "") return null;

  const state = ensureWorldState(worldName);
  for (const block of state.foreground.values()) {
    if (!isDoorBlockType(block?.block_type || "")) continue;
    const doorState = getDoorStateForBlock(state, block, worldName);
    if (!doorState || doorState.door_id !== cleanId) continue;
    return {
      state,
      ...doorState,
    };
  }

  return null;
}

function rejectDoorEnter(socket, message, extra = {}) {
  sendActionRejected(socket, "door_enter", message, extra);
  return false;
}

async function handleDoorEnterRequest(socket, player, data) {
  if (!requireAuthenticated(socket, player, "enter doors")) return false;

  const sourceWorld = getPlayerCurrentWorldName(player);
  const requestWorld = cleanWorld(data.world || sourceWorld);
  if (!requireSameWorld(socket, player, requestWorld, "enter that door")) return false;
  if (await rejectIfWorldBanned(socket, player, sourceWorld, "door_enter")) return false;

  const request = sanitizeDoorEnterRequest(data, sourceWorld);
  if (!request) return rejectDoorEnter(socket, "Door missing.");

  const sourceDoor = getDoorAtGrid(sourceWorld, request.x, request.y);
  if (!sourceDoor) return rejectDoorEnter(socket, "Door missing.");

  if (!isPlayerNearGrid(player, request.x, request.y)) {
    return rejectDoorEnter(socket, "Too far away.");
  }

  if (sourceDoor.locked && !canPlayerPassDoor(player, sourceWorld)) {
    return rejectDoorEnter(socket, "Door is locked.");
  }

  if (sourceDoor.destination === "" || sourceDoor.target_door_id === "") {
    return rejectDoorEnter(socket, "Door is not linked.");
  }

  const targetWorld = cleanWorld(sourceDoor.target_world || sourceWorld);
  if (await rejectIfWorldBanned(socket, player, targetWorld, "door_enter")) return false;

  const targetDoor = findDoorById(targetWorld, sourceDoor.target_door_id);
  if (!targetDoor) {
    return rejectDoorEnter(socket, "Target door not found.", {
      target_world: targetWorld,
      target_door_id: sourceDoor.target_door_id,
    });
  }

  if (targetDoor.locked && !canPlayerPassDoor(player, targetWorld)) {
    return rejectDoorEnter(socket, "Target door is locked.", {
      target_world: targetWorld,
      target_door_id: sourceDoor.target_door_id,
    });
  }

  const oldWorld = sourceWorld;
  const targetPosition = getGridCenterPixels(targetDoor.block.x, targetDoor.block.y);
  const changedWorld = oldWorld !== targetWorld;

  if (changedWorld) {
    cancelActiveTradeForPlayer(player.id, "Trade canceled because a player changed worlds.");
    activeFishingSessions.delete(player.id);
    clearPlayerFishingPresence(player);

    if (player.joined_world) {
      broadcastSystemToWorld(oldWorld, `${player.name} left ${oldWorld}`, player.id);
      broadcastToWorld(oldWorld, buildPublicPlayerPresencePayload("player_left", player, oldWorld), player.id);
    }
  }

  player.world = targetWorld;
  player.current_world = targetWorld;
  player.current_world_id = targetWorld;
  player.joined_world = true;
  player.x = targetPosition.x;
  player.y = targetPosition.y;
  player.velocity_x = 0;
  player.velocity_y = 0;
  player.animation_state = "idle";
  player.last_position_at = Date.now();
  ensureWorldState(targetWorld);
  postgresStore.mirrorPlayerWorld(player.account_username, targetWorld);

  const response = {
    type: "door_enter_ok",
    request_id: request.request_id,
    world: targetWorld,
    source_world: oldWorld,
    source_x: request.x,
    source_y: request.y,
    target_door_id: targetDoor.door_id,
    x: targetPosition.x,
    y: targetPosition.y,
    same_world: !changedWorld,
    requires_world_state: changedWorld,
    message: changedWorld ? `Entering ${targetWorld}...` : "Entered door.",
  };
  sendJson(socket, response);

  if (changedWorld) {
    const existingPlayers = getPlayersInWorld(targetWorld, player.id);
    sendJson(socket, {
      type: "join_world_ok",
      world: targetWorld,
      players: existingPlayers,
    });

    sendJson(socket, buildWorldStateMessage(targetWorld, {
      respawn_player: false,
      force_player_position: true,
      portal_spawn_x: targetPosition.x,
      portal_spawn_y: targetPosition.y,
      x: targetPosition.x,
      y: targetPosition.y,
      world_state_reason: "door_enter",
      message: `Entered ${targetWorld}.`,
    }));
    sendActiveWorldEventState(socket, targetWorld);

    broadcastToWorld(targetWorld, buildPublicPlayerPresencePayload("player_joined", player, targetWorld), player.id);
    broadcastSystemToWorld(targetWorld, `${player.name} joined ${targetWorld}`, player.id);
    notifyOnlineFriendsOfFriendState(player.account_username);
  } else {
    broadcastToWorld(targetWorld, buildPublicPlayerPresencePayload("player_position", player, targetWorld), player.id);
  }

  touchLivePresence(socket, player, { force: true });
  logWorldChange(socket, player, {
    source_type: "door_enter",
    source_id: request.request_id || makeAuditId("door"),
    world: oldWorld,
    action: "door_enter",
    layer: "interaction",
    x: request.x,
    y: request.y,
    block_type: sourceDoor.block.block_type,
    details: {
      source_door_id: sourceDoor.door_id,
      destination: sourceDoor.destination,
      target_world: targetWorld,
      target_door_id: targetDoor.door_id,
      target_x: targetDoor.block.x,
      target_y: targetDoor.block.y,
    },
  });
  return true;
}

function buildDoorDestinationText(targetWorld, targetDoorId, sourceWorld) {
  const cleanTargetWorld = cleanWorld(targetWorld || sourceWorld);
  const cleanSourceWorld = cleanWorld(sourceWorld || "");
  const cleanTargetDoorId = cleanDoorId(targetDoorId);
  if (cleanTargetDoorId === "") return "";
  if (cleanTargetWorld === cleanSourceWorld) {
    return `door:${cleanTargetDoorId}`;
  }
  return `${cleanTargetWorld}:door:${cleanTargetDoorId}`;
}

async function maybeApplyReciprocalDoorLink(socket, player, sourceWorld, update) {
  if (!update || update.action !== "door_state") return null;

  const sourceDoorId = cleanDoorId(update.door_id || "");
  const targetDoorId = cleanDoorId(update.target_door_id || "");
  if (sourceDoorId === "" || targetDoorId === "") return null;

  const cleanSourceWorld = cleanWorld(sourceWorld);
  const targetWorld = cleanWorld(update.target_world || cleanSourceWorld);
  if (cleanSourceWorld === "" || targetWorld === "") return null;
  if (!canPlayerBuildInWorld(player, targetWorld)) return null;

  const targetDoor = findDoorById(targetWorld, targetDoorId);
  if (!targetDoor || !targetDoor.block) return null;
  if (targetWorld === cleanSourceWorld && Number(targetDoor.block.x) === Number(update.x) && Number(targetDoor.block.y) === Number(update.y)) {
    return null;
  }

  const targetState = getDoorStateForBlock(targetDoor.state, targetDoor.block, targetWorld);
  if (!targetState) return null;
  const existingDestination = cleanDoorDestination(targetState.destination || "");
  const existingTargetDoorId = cleanDoorId(targetState.target_door_id || "");
  if (existingDestination !== "" || existingTargetDoorId !== "") return null;

  const reverseDestination = buildDoorDestinationText(cleanSourceWorld, sourceDoorId, targetWorld);
  const reverseUpdate = {
    type: "world_interaction_update",
    world: targetWorld,
    action: "door_state",
    x: targetDoor.block.x,
    y: targetDoor.block.y,
    door_id: cleanDoorId(targetState.door_id || targetDoor.door_id || targetDoorId),
    destination: cleanDoorDestination(reverseDestination),
    target_world: cleanSourceWorld,
    target_door_id: sourceDoorId,
    locked: isDoorBlockType(targetDoor.block.block_type) && Boolean(targetState.locked),
    block_type: targetDoor.block.block_type,
  };

  const reciprocalSourceId = makeAuditId("interact");
  const previousTargetWorldState = serializeWorldState(targetWorld);
  const objectBefore = getWorldObjectJournalData(targetWorld, reverseUpdate);
  applyInteractionUpdateToWorldState(targetWorld, reverseUpdate);
  const objectAfter = getWorldObjectJournalData(targetWorld, reverseUpdate);
  const commit = await commitWorldStateWithBlockChanges(targetWorld, [
    buildWorldObjectChangeEntry(
      socket,
      player,
      targetWorld,
      {
        ...reverseUpdate,
        source_type: "door_reciprocal_link",
      },
      objectBefore,
      objectAfter,
      reciprocalSourceId,
      {
        source_world: cleanSourceWorld,
        source_door_id: sourceDoorId,
        target_door_id: targetDoorId,
      }
    ),
  ]);

  if (!commit.ok) {
    worldStates.set(cleanWorld(targetWorld), deserializeWorldState(targetWorld, previousTargetWorldState));
    console.warn("[world-journal] reciprocal door link save failed:", commit.message || commit.reason || "unknown");
    return null;
  }
  sendWorldUpdateToRequesterAndWorld(socket, player, targetWorld, reverseUpdate);
  return reverseUpdate;
}

function prepareToggleBlockStateUpdate(socket, player, worldName, update, expectedAction) {
  const state = ensureWorldState(worldName);
  const block = state.foreground.get(gridKey(update.x, update.y));
  if (!block || !isToggleBlockType(block.block_type)) {
    sendActionRejected(socket, "world_interaction_update", "Toggle block missing.");
    return false;
  }

  const definition = ItemDatabase.getItemDefinition(block.block_type) || {};
  const toggleAction = clampString(definition.toggle_action || `${block.block_type}_state`);
  if (toggleAction !== expectedAction) {
    sendActionRejected(socket, "world_interaction_update", "Toggle block missing.");
    return false;
  }

  if (!isPlayerNearGrid(player, update.x, update.y)) {
    sendActionRejected(socket, "world_interaction_update", "Too far away.");
    return false;
  }

  update.on = Boolean(update.on);
  update.block_type = block.block_type;
  return true;
}

function sanitizePlayerPosition(data, player) {
  const x = Number(data.x);
  const y = Number(data.y);
  if (!isPositionInWorldBounds(x, y)) return null;

  return {
    x,
    y,
    facing: Number(data.facing) < 0 ? -1 : 1,
    world: cleanWorld(data.world || player.world || "START"),
    in_water: data.in_water === true,
    in_lava_fire: data.in_lava_fire === true,
  };
}

function sanitizePlayerDamageFlash(data) {
  const remainingMs = clampInteger(data?.damage_flash_remaining_ms || 0, 0, MAX_DAMAGE_FLASH_MS);
  const token = clampInteger(data?.damage_flash_token || 0, 0, 2147483647);
  return {
    active: data?.damage_flash_active === true && remainingMs > 0,
    remaining_ms: remainingMs,
    token,
  };
}

function getPublicPlayerDamageFlash(player) {
  const expiresAt = Number(player?.damage_flash_expires_at || 0);
  const remainingMs = Math.max(0, Math.min(MAX_DAMAGE_FLASH_MS, Math.trunc(expiresAt - Date.now())));
  return {
    damage_flash_active: remainingMs > 0,
    damage_flash_remaining_ms: remainingMs,
    damage_flash_token: clampInteger(player?.damage_flash_token || 0, 0, 2147483647),
  };
}

function clearPlayerFishingPresence(player) {
  if (!player) return;
  player.fishing_active = false;
  player.fishing_target_x = -1;
  player.fishing_target_y = -1;
  player.fishing_lure_id = "";
  player.fishing_rod_id = "";
}

function applyPlayerFishingPresenceFromSession(player, session) {
  if (!player || !session) {
    clearPlayerFishingPresence(player);
    return false;
  }

  const targetX = Math.trunc(Number(session.target_x));
  const targetY = Math.trunc(Number(session.target_y));
  if (!isGridInWorld(targetX, targetY)) {
    clearPlayerFishingPresence(player);
    return false;
  }

  player.fishing_active = true;
  player.fishing_target_x = targetX;
  player.fishing_target_y = targetY;
  player.fishing_lure_id = clampString(session.lure_id || "");
  player.fishing_rod_id = clampString(session.rod_id || "");
  return true;
}

function refreshPlayerFishingPresence(player, worldName = "") {
  if (!player) return false;
  const session = activeFishingSessions.get(player.id);
  const clean = cleanWorld(worldName || player.world || "START");
  if (!session || session.world !== clean || Date.now() > Number(session.expires_at || 0)) {
    clearPlayerFishingPresence(player);
    return false;
  }

  return applyPlayerFishingPresenceFromSession(player, session);
}

function sanitizePlayerAnimationState(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (["idle", "walk", "jump", "fall", "punch", "hurt", "dead", "dead_spirit"].includes(clean)) return clean;
  return "idle";
}

function sanitizePlayerVelocity(value) {
  const velocity = Number(value);
  if (!Number.isFinite(velocity)) return 0;
  return Math.max(-2000, Math.min(2000, velocity));
}

function acceptPlayerMovement(socket, player, position, options = {}) {
  const silent = Boolean(options.silent);
  const now = Date.now();
  const lastAt = Number(player.last_position_at || 0);

  if (!lastAt || (isAdmin(player) && player.noclip_enabled)) {
    player.last_position_at = now;
    return true;
  }

  const elapsedSeconds = Math.max((now - lastAt) / 1000, 0.016);
  let maxDistance = MAX_MOVE_PIXELS_PER_SECOND * elapsedSeconds + TILE_SIZE * 2;
  const distance = Math.hypot(position.x - player.x, position.y - player.y);
  if (distance > maxDistance && isMovementNearLavaRebound(player, position)) {
    maxDistance += LAVA_REBOUND_MOVE_EXTRA_PIXELS;
  }

  if (distance > maxDistance) {
    if (!silent) {
      sendActionRejected(socket, "player_position", "Movement was too fast.", {
        position_correction: true,
        server_x: Number(player.x || 0),
        server_y: Number(player.y || 0),
        server_facing: Number(player.facing || 1) < 0 ? -1 : 1,
        server_world: cleanWorld(player.world || position.world || "START"),
      });
    }
    return false;
  }

  player.last_position_at = now;
  return true;
}

function sanitizePlayerPunchFacing(data, player) {
  const requestedFacing = Number(data?.facing);
  if (requestedFacing < 0) return -1;
  if (requestedFacing > 0) return 1;
  return Number(player?.facing) < 0 ? -1 : 1;
}

function resolvePlayerPunchTarget(player, data) {
  const targetPlayerId = String(data?.target_player_id || data?.target_id || "").trim();
  if (targetPlayerId !== "" && targetPlayerId !== player.id) {
    const byId = findOnlinePlayerByPlayerId(targetPlayerId);
    if (byId) return byId;
  }

  const targetUsername = cleanAccountName(data?.target_username || data?.username || "");
  if (targetUsername !== "" && accountKey(targetUsername) !== accountKey(player.account_username)) {
    const byUsername = findOnlinePlayerByUsername(targetUsername);
    if (byUsername) return byUsername;
  }

  return null;
}

function isPlayerPunchTargetReachable(player, target, facing) {
  if (!player || !target) return false;
  if (player.id === target.id) return false;
  if (cleanWorld(player.world || "START") !== cleanWorld(target.world || "START")) return false;

  const ax = Number(player.x);
  const ay = Number(player.y);
  const tx = Number(target.x);
  const ty = Number(target.y);
  if (![ax, ay, tx, ty].every(Number.isFinite)) return false;

  const dx = tx - ax;
  const dy = ty - ay;
  const forwardDistance = dx * facing;
  if (forwardDistance < -PLAYER_PUNCH_BACKSIDE_TOLERANCE_PIXELS) return false;
  if (Math.abs(dx) > PLAYER_PUNCH_RANGE_PIXELS) return false;
  if (Math.abs(dy) > PLAYER_PUNCH_VERTICAL_TOLERANCE_PIXELS) return false;
  return Math.hypot(dx, dy) <= PLAYER_PUNCH_DIRECT_DISTANCE_PIXELS;
}

function handlePlayerPunch(socket, player, data) {
  if (!requireAuthenticated(socket, player, "punch players")) return;

  const worldName = cleanWorld(data?.world || player.world || "START");
  if (!requireSameWorld(socket, player, worldName, "player_punch")) return;

  const now = Date.now();
  const lastPunchAt = Number(player.last_player_punch_at || 0);
  if (lastPunchAt > 0 && now - lastPunchAt < PLAYER_PUNCH_COOLDOWN_MS) {
    return;
  }

  const targetRecord = resolvePlayerPunchTarget(player, data);
  if (!targetRecord || !targetRecord.player) {
    sendActionRejected(socket, "player_punch", "Could not find that player.");
    return;
  }

  const target = targetRecord.player;
  if (cleanWorld(target.world || "START") !== worldName) {
    sendActionRejected(socket, "player_punch", "That player is not in this world.");
    return;
  }

  const facing = sanitizePlayerPunchFacing(data, player);
  if (!isPlayerPunchTargetReachable(player, target, facing)) {
    sendActionRejected(socket, "player_punch", "Too far away.");
    return;
  }

  const dx = Number(target.x) - Number(player.x);
  const knockbackDirection = Math.abs(dx) > 4 ? (dx < 0 ? -1 : 1) : facing;
  const knockbackX = knockbackDirection * PLAYER_PUNCH_KNOCKBACK_X;
  const knockbackY = PLAYER_PUNCH_KNOCKBACK_Y;

  player.last_player_punch_at = now;
  player.facing = facing;
  player.animation_state = "punch";
  target.velocity_x = sanitizePlayerVelocity(knockbackX);
  target.velocity_y = sanitizePlayerVelocity(knockbackY);
  target.on_floor = true;
  target.animation_state = "hurt";

  broadcastToWorld(worldName, {
    type: "player_punch_knockback",
    world: worldName,
    attacker_player_id: String(player.id || ""),
    attacker_username: cleanAccountName(player.account_username || player.name || ""),
    target_player_id: String(target.id || ""),
    target_username: cleanAccountName(target.account_username || target.name || ""),
    facing,
    knockback_x: knockbackX,
    knockback_y: knockbackY,
    source_x: Number(player.x || 0),
    source_y: Number(player.y || 0),
    target_x: Number(target.x || 0),
    target_y: Number(target.y || 0),
    server_time: now,
  });

  touchLivePresence(socket, player);
}

function isMovementNearLavaRebound(player, position) {
  const worldName = cleanWorld(position?.world || player?.world || "");
  if (worldName === "") return false;

  return (
    isPositionNearLavaReboundBlock(worldName, player?.x, player?.y) ||
    isPositionNearLavaReboundBlock(worldName, position?.x, position?.y)
  );
}

function isPositionNearLavaReboundBlock(worldName, x, y) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;

  const state = ensureWorldState(worldName);
  const gridX = Math.round(px / TILE_SIZE);
  const gridY = Math.round(py / TILE_SIZE);

  for (let dy = -LAVA_REBOUND_MOVE_RADIUS_TILES; dy <= LAVA_REBOUND_MOVE_RADIUS_TILES; dy += 1) {
    for (let dx = -LAVA_REBOUND_MOVE_RADIUS_TILES; dx <= LAVA_REBOUND_MOVE_RADIUS_TILES; dx += 1) {
      const block = state.foreground.get(gridKey(gridX + dx, gridY + dy));
      if (isLavaReboundBlockType(block?.block_type)) return true;
    }
  }

  return false;
}

function isLavaReboundBlockType(blockType) {
  const clean = clampString(blockType || "");
  if (clean === "lava") return true;

  const definition = ItemDatabase.getItemDefinition(clean);
  return Boolean(definition?.lava_rebound);
}

function getSocketAddress(socket) {
  return String(socket?._socket?.remoteAddress || socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

function getSocketUserAgent(socket, data = {}) {
  return String(data?.user_agent || data?.userAgent || socket?.userAgent || "").slice(0, 500);
}

function getSocketDeviceInfo(socket, data = {}) {
  const rawDevice = data && typeof data.device_info === "object" && !Array.isArray(data.device_info)
    ? data.device_info
    : {};
  return {
    user_agent: getSocketUserAgent(socket, data),
    client_version: getClientVersion(data || {}),
    device_id: clampString(data?.device_id || rawDevice.device_id || "", 120),
    platform: clampString(data?.platform || rawDevice.platform || "", 80),
    os: clampString(data?.os || rawDevice.os || "", 80),
    build: clampString(data?.build || rawDevice.build || "", 80),
  };
}

function getLoginAttemptSubject(socket, username = "") {
  const cleanUsername = accountKey(username || "");
  const ip = getSocketAddress(socket);
  return {
    username: cleanUsername,
    ip,
    ipSubject: ip !== "" ? `ip:${ip}` : `socket:${socket?.playerId || "unknown"}`,
    accountSubject: cleanUsername !== "" ? `account:${cleanUsername}` : "",
  };
}

function consumeLocalLoginAttempt(scope, subject, limit, windowMs) {
  const key = `${scope}:${subject}`;
  const now = Date.now();
  const bucket = localLoginAttemptBuckets.get(key) || {
    count: 0,
    resetAt: now + windowMs,
  };

  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  localLoginAttemptBuckets.set(key, bucket);
  return {
    allowed: bucket.count <= limit,
    count: bucket.count,
    resetInMs: Math.max(0, bucket.resetAt - now),
  };
}

async function checkLoginAttemptAllowed(socket, username, action = "login") {
  const subject = getLoginAttemptSubject(socket, username);
  const checks = [];

  if (redisStore.isReady()) {
    checks.push(await redisStore.checkRateLimit("auth:login:ip", subject.ipSubject, LOGIN_ATTEMPT_LIMIT_IP, LOGIN_ATTEMPT_WINDOW_MS));
    if (subject.accountSubject) {
      checks.push(await redisStore.checkRateLimit("auth:login:account", subject.accountSubject, LOGIN_ATTEMPT_LIMIT_ACCOUNT, LOGIN_ATTEMPT_WINDOW_MS));
    }
  } else {
    checks.push(consumeLocalLoginAttempt("auth:login:ip", subject.ipSubject, LOGIN_ATTEMPT_LIMIT_IP, LOGIN_ATTEMPT_WINDOW_MS));
    if (subject.accountSubject) {
      checks.push(consumeLocalLoginAttempt("auth:login:account", subject.accountSubject, LOGIN_ATTEMPT_LIMIT_ACCOUNT, LOGIN_ATTEMPT_WINDOW_MS));
    }
  }

  const blocked = checks.find((entry) => !entry.allowed);
  if (!blocked) return { ok: true };

  const retryMs = Math.max(1000, Math.trunc(Number(blocked.resetInMs) || LOGIN_ATTEMPT_WINDOW_MS));
  return {
    ok: false,
    action,
    retry_ms: retryMs,
    retry_after_seconds: Math.ceil(retryMs / 1000),
  };
}

function recordLoginAttempt(socket, player, username, action, ok, reason, data = {}) {
  const details = {
    action: String(action || "login"),
    username: cleanAccountName(username || ""),
    ip: getSocketAddress(socket),
    user_agent: getSocketUserAgent(socket, data),
    device_info: getSocketDeviceInfo(socket, data),
    request_id: makeRequestId(data || {}),
    reason: String(reason || ""),
    ok: Boolean(ok),
  };
  logSecurityEvent(socket, player, ok ? "account_login_success" : "account_login_failed", details, ok ? "info" : "warning");
  postgresStore.recordLoginAttempt({
    ...details,
    success: Boolean(ok),
    at: new Date().toISOString(),
  });
}

function parseAdminTwoFactorSecrets() {
  const map = new Map();
  for (const pair of ADMIN_2FA_SECRETS.split(",")) {
    const [rawUsername, ...secretParts] = String(pair || "").split(":");
    const username = accountKey(rawUsername || "");
    const secret = secretParts.join(":").trim();
    if (username !== "" && secret !== "") map.set(username, secret);
  }
  return map;
}

const adminTwoFactorSecretMap = parseAdminTwoFactorSecrets();

function getAdminTwoFactorSecret(username) {
  const key = accountKey(username || "");
  return adminTwoFactorSecretMap.get(key) || ADMIN_2FA_SECRET;
}

function base32ToBuffer(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  const bytes = [];

  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, "0");
    while (bits.length >= 8) {
      bytes.push(parseInt(bits.slice(0, 8), 2));
      bits = bits.slice(8);
    }
  }

  return Buffer.from(bytes);
}

function makeTotpCode(secret, timeStep = Math.floor(Date.now() / 30000)) {
  const secretBytes = base32ToBuffer(secret);
  if (secretBytes.length === 0) return "";
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
  counter.writeUInt32BE(timeStep >>> 0, 4);
  const digest = crypto.createHmac("sha1", secretBytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, "0");
}

function timingSafeCodeEqual(left, right) {
  const cleanLeft = String(left || "").replace(/\s+/g, "");
  const cleanRight = String(right || "").replace(/\s+/g, "");
  if (cleanLeft.length !== cleanRight.length) return false;
  return crypto.timingSafeEqual(Buffer.from(cleanLeft), Buffer.from(cleanRight));
}

function verifyAdminTwoFactorCode(username, code) {
  if (!ADMIN_2FA_REQUIRED) return { ok: true, required: false };
  const secret = getAdminTwoFactorSecret(username);
  if (!secret) return { ok: false, required: true, reason: "admin_2fa_not_configured" };
  const cleanCode = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleanCode)) return { ok: false, required: true, reason: "missing_or_invalid_code" };

  const currentStep = Math.floor(Date.now() / 30000);
  for (let offset = -ADMIN_2FA_WINDOW_STEPS; offset <= ADMIN_2FA_WINDOW_STEPS; offset += 1) {
    if (timingSafeCodeEqual(cleanCode, makeTotpCode(secret, currentStep + offset))) {
      return { ok: true, required: true };
    }
  }
  return { ok: false, required: true, reason: "invalid_code" };
}

function isAdminTwoFactorVerified(player) {
  if (!ADMIN_2FA_REQUIRED) return true;
  return Boolean(player && Number(player.admin_2fa_verified_until || 0) > Date.now());
}

function getDeveloperSecurityRequirement(player) {
  if (!isDeveloperPinUnlocked(player)) {
    return {
      ok: false,
      message: "Developer PIN required.",
      extra: {
        requires_developer_pin: true,
        developer_pin_required: DEV_PIN_REQUIRED,
      },
      reason: "developer_pin_required",
    };
  }
  if (!isAdminTwoFactorVerified(player)) {
    return {
      ok: false,
      message: "Admin 2FA required.",
      extra: {
        requires_admin_2fa: true,
        admin_2fa_required: ADMIN_2FA_REQUIRED,
      },
      reason: "admin_2fa_required",
    };
  }
  return { ok: true };
}

function consumeAdminCommandCooldown(player, commandName) {
  if (!player || ADMIN_COMMAND_COOLDOWN_MS <= 0) return { ok: true };
  if (!player.developer_command_cooldowns) player.developer_command_cooldowns = new Map();
  const key = String(commandName || "command").trim().toLowerCase() || "command";
  const now = Date.now();
  const nextAllowedAt = Number(player.developer_command_cooldowns.get(key) || 0);
  if (nextAllowedAt > now) {
    return {
      ok: false,
      retry_ms: nextAllowedAt - now,
    };
  }
  player.developer_command_cooldowns.set(key, now + ADMIN_COMMAND_COOLDOWN_MS);
  return { ok: true };
}

function commandNeedsAdminConfirmation(commandName) {
  if (!ADMIN_COMMAND_CONFIRMATION_REQUIRED) return false;
  const clean = String(commandName || "").trim().toLowerCase();
  return clean !== "" && ADMIN_COMMAND_CONFIRMATION_ACTIONS.has(clean);
}

function makeAdminConfirmationKey(player, commandName, command) {
  return makeAuditHash({
    username: accountKey(player?.account_username || ""),
    command_name: String(commandName || "").trim().toLowerCase(),
    command: String(command || "").trim(),
  });
}

function validateAdminCommandConfirmation(socket, player, data, commandName, command, deny) {
  if (!commandNeedsAdminConfirmation(commandName)) return true;
  if (!player.pending_admin_confirmations) player.pending_admin_confirmations = new Map();

  const confirmationKey = makeAdminConfirmationKey(player, commandName, command);
  const providedToken = String(data.confirmation_token || data.admin_confirmation_token || "").trim();
  const pending = player.pending_admin_confirmations.get(confirmationKey);
  if (pending && pending.expires_at_ms > Date.now() && providedToken !== "" && makeTokenHash(providedToken) === pending.token_hash) {
    player.pending_admin_confirmations.delete(confirmationKey);
    return true;
  }

  const token = makeSecureToken(18);
  const expiresAtMs = Date.now() + ADMIN_COMMAND_CONFIRMATION_TTL_MS;
  player.pending_admin_confirmations.set(confirmationKey, {
    token_hash: makeTokenHash(token),
    expires_at_ms: expiresAtMs,
  });

  deny("Admin confirmation required. Confirm this command before it runs.", {
    reason: "admin_confirmation_required",
    confirmation_command_name: commandName,
    confirmation_expires_at: new Date(expiresAtMs).toISOString(),
  }, {
    requires_admin_confirmation: true,
    admin_confirmation_required: true,
    confirmation_token: token,
    confirmation_expires_at: new Date(expiresAtMs).toISOString(),
  });
  return false;
}

function makeAuditId(prefix = "audit") {
  const cleanPrefix = safeFileName(prefix, "audit");
  return `${cleanPrefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function appendJsonLine(filePath, entry, label = "audit") {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, (error) => {
      if (error) console.warn(`Could not write ${label} log:`, error.message);
    });
  } catch (error) {
    console.warn(`Could not queue ${label} log:`, error.message);
  }
}

function getAuditActor(socket, player, usernameOverride = "") {
  const username = cleanAccountName(usernameOverride || player?.account_username || player?.name || "");
  return {
    actor_username: username,
    actor_role: username !== "" ? getAccountRole(username) : "unknown",
    player_id: String(player?.id || ""),
    ip: getSocketAddress(socket),
    world: player?.world ? cleanWorld(player.world) : "",
  };
}

function logSecurityEvent(socket, player, event, details = {}, severity = "info") {
  const entry = {
    event_id: makeAuditId("security"),
    at: new Date().toISOString(),
    severity: String(severity || "info"),
    event: String(event || "security_event"),
    ...getAuditActor(socket, player),
    details,
  };
  appendJsonLine(SECURITY_EVENT_LOG_PATH, entry, "security event");
  postgresStore.mirrorSecurityEvent(entry);
}

function logGemLedger(socket, player, entry = {}) {
  const actor = getAuditActor(socket, player);
  const username = cleanAccountName(entry.account_username || actor.actor_username);
  const ledgerEntry = {
    ledger_id: entry.ledger_id || makeAuditId("gem"),
    at: new Date().toISOString(),
    ...actor,
    account_username: username,
    quantity_delta: Math.trunc(Number(entry.quantity_delta) || 0),
    balance_after: Math.max(0, Math.trunc(Number(entry.balance_after) || 0)),
    source_type: String(entry.source_type || "unknown"),
    source_id: String(entry.source_id || ""),
    reason: String(entry.reason || ""),
    world: entry.world ? cleanWorld(entry.world) : actor.world,
    details: entry.details || {},
  };
  appendJsonLine(GEM_LEDGER_PATH, ledgerEntry, "gem ledger");
  if (!entry.skip_postgres) {
    postgresStore.mirrorGemLedger(ledgerEntry);
  }
}

function logItemLedger(socket, player, entry = {}) {
  const itemId = clampString(entry.item_id || "");
  if (itemId === "") return;

  const actor = getAuditActor(socket, player);
  const username = cleanAccountName(entry.account_username || actor.actor_username);
  const itemCategory = resolveInventoryCategory(itemId, entry.item_category || "");
  const ledgerId = entry.ledger_id || makeAuditId("item");
  const ledgerEntry = {
    ledger_id: ledgerId,
    at: new Date().toISOString(),
    ...actor,
    account_username: username,
    item_id: itemId,
    item_category: itemCategory,
    quantity_delta: Math.trunc(Number(entry.quantity_delta) || 0),
    balance_after: Math.max(0, Math.trunc(Number(entry.balance_after) || 0)),
    source_type: String(entry.source_type || "unknown"),
    source_id: String(entry.source_id || ""),
    reason: String(entry.reason || ""),
    world: entry.world ? cleanWorld(entry.world) : actor.world,
    details: entry.details || {},
  };

  appendJsonLine(ITEM_LEDGER_PATH, ledgerEntry, "item ledger");
  if (!entry.skip_postgres) {
    postgresStore.mirrorItemLedger(ledgerEntry);
  }
  if (itemId === "gem") {
    logGemLedger(socket, player, { ...ledgerEntry, ledger_id: makeAuditId("gem"), skip_postgres: entry.skip_postgres });
  }
}

function logItemLedgerForState(socket, actorPlayer, accountUsername, state, itemId, itemCategory, quantityDelta, sourceType, sourceId, reason, world = "", details = {}, options = {}) {
  logItemLedger(socket, actorPlayer, {
    account_username: accountUsername,
    item_id: itemId,
    item_category: itemCategory,
    quantity_delta: quantityDelta,
    balance_after: getInventoryCount(state, itemId, itemCategory),
    source_type: sourceType,
    source_id: sourceId,
    reason,
    world,
    details,
    skip_postgres: Boolean(options.skipPostgres),
  });
}

function logRewardLedgers(socket, actorPlayer, accountUsername, state, rewards, sourceType, sourceId, reason, world = "", details = {}, options = {}) {
  for (const reward of rewards) {
    logItemLedgerForState(
      socket,
      actorPlayer,
      accountUsername,
      state,
      reward.item_id,
      reward.item_category,
      reward.amount,
      sourceType,
      sourceId,
      reason,
      world,
      details,
      options
    );
  }
}

function logShopPurchase(socket, player, entry = {}) {
  const logEntry = {
    purchase_id: entry.purchase_id || makeAuditId("shop"),
    at: new Date().toISOString(),
    ...getAuditActor(socket, player),
    account_username: cleanAccountName(entry.account_username || player?.account_username || ""),
    listing_id: clampString(entry.listing_id || ""),
    item_id: clampString(entry.item_id || ""),
    price_gems: Math.max(0, Math.trunc(Number(entry.price_gems) || 0)),
    rewards: Array.isArray(entry.rewards) ? entry.rewards : [],
    gem_balance_after: Math.max(0, Math.trunc(Number(entry.gem_balance_after) || 0)),
  };
  appendJsonLine(SHOP_PURCHASE_LOG_PATH, logEntry, "shop purchase");
  postgresStore.mirrorShopPurchase(logEntry);
}

function logTradeTransaction(entry = {}) {
  const logEntry = {
    transaction_id: entry.transaction_id || makeAuditId("trade"),
    at: new Date().toISOString(),
    trade_id: String(entry.trade_id || ""),
    status: String(entry.status || "completed"),
    requester_username: cleanAccountName(entry.requester_username || ""),
    target_username: cleanAccountName(entry.target_username || ""),
    requester_offer: Array.isArray(entry.requester_offer) ? entry.requester_offer : [],
    target_offer: Array.isArray(entry.target_offer) ? entry.target_offer : [],
    details: entry.details || {},
  };
  appendJsonLine(TRADE_TRANSACTION_LOG_PATH, logEntry, "trade transaction");
  postgresStore.mirrorTradeTransaction(logEntry);
}

function logVendingTransaction(socket, player, entry = {}) {
  const logEntry = {
    transaction_id: entry.transaction_id || makeAuditId("vend"),
    at: new Date().toISOString(),
    ...getAuditActor(socket, player),
    action: String(entry.action || "vend"),
    world: cleanWorld(entry.world || player?.world || "START"),
    x: Math.trunc(Number(entry.x) || 0),
    y: Math.trunc(Number(entry.y) || 0),
    owner_username: cleanAccountName(entry.owner_username || ""),
    buyer_username: cleanAccountName(entry.buyer_username || ""),
    item_id: clampString(entry.item_id || ""),
    item_category: String(entry.item_category || ""),
    amount: Math.max(0, Math.trunc(Number(entry.amount) || 0)),
    price_wls: Math.max(0, Math.trunc(Number(entry.price_wls) || 0)),
    stock_after: Math.max(0, Math.trunc(Number(entry.stock_after) || 0)),
    pending_wls_after: Math.max(0, Math.trunc(Number(entry.pending_wls_after) || 0)),
    details: entry.details || {},
  };
  appendJsonLine(VENDING_TRANSACTION_LOG_PATH, logEntry, "vending transaction");
  postgresStore.mirrorVendingTransaction(logEntry);
}

function logWorldChange(socket, player, entry = {}, options = {}) {
  const logEntry = {
    journal_id: entry.journal_id || makeAuditId("world"),
    at: new Date().toISOString(),
    ...getAuditActor(socket, player),
    source_type: String(entry.source_type || "world_change"),
    source_id: String(entry.source_id || ""),
    world: cleanWorld(entry.world || player?.world || "START"),
    action: String(entry.action || ""),
    layer: String(entry.layer || ""),
    x: Number.isFinite(Number(entry.x)) ? Math.trunc(Number(entry.x)) : null,
    y: Number.isFinite(Number(entry.y)) ? Math.trunc(Number(entry.y)) : null,
    block_type: clampString(entry.block_type || ""),
    block_type_before: clampString(entry.block_type_before || ""),
    block_type_after: clampString(entry.block_type_after || ""),
    object_type: clampString(entry.object_type || "", 80),
    object_id: clampString(entry.object_id || "", 160),
    old_data: cloneJson(entry.old_data || {}),
    new_data: cloneJson(entry.new_data || {}),
    request_id: String(entry.request_id || ""),
    details: entry.details || {},
  };
  appendJsonLine(WORLD_CHANGE_JOURNAL_PATH, logEntry, "world change");
  if (!options.skipPostgres && !entry.skip_postgres) {
    postgresStore.mirrorWorldChange(logEntry);
  }
}

function warnWorldSnapshotStorageOnce(key, message) {
  if (worldSnapshotStorageWarnings.has(key)) return;
  worldSnapshotStorageWarnings.add(key);
  console.warn(message);
}

function worldSnapshotStorageIsSpaces() {
  return WORLD_SNAPSHOT_STORAGE === "spaces" || WORLD_SNAPSHOT_STORAGE === "s3" || WORLD_SNAPSHOT_STORAGE === "aws-s3";
}

function parseS3Uri(uri) {
  const raw = String(uri || "").trim().replace(/\/+$/, "");
  if (!raw.startsWith("s3://")) return null;
  const withoutScheme = raw.slice("s3://".length);
  const slashIndex = withoutScheme.indexOf("/");
  const bucket = slashIndex >= 0 ? withoutScheme.slice(0, slashIndex) : withoutScheme;
  const prefix = slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1).replace(/^\/+|\/+$/g, "") : "";
  if (!bucket) return null;
  return { bucket, prefix };
}

function buildS3Key(prefix, ...parts) {
  const cleanParts = parts
    .map((part) => String(part || "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  if (prefix) cleanParts.unshift(String(prefix).replace(/^\/+|\/+$/g, ""));
  return cleanParts.join("/");
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { maxBuffer: 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        const message = String(stderr || error.message || "").trim() || error.message;
        reject(new Error(message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function uploadWorldSnapshotToObjectStorage(snapshotPath, cleanWorld, snapshotFileName) {
  if (!worldSnapshotStorageIsSpaces()) return null;

  const target = parseS3Uri(WORLD_SNAPSHOT_SPACES_TARGET);
  if (!target) {
    warnWorldSnapshotStorageOnce(
      "missing-spaces-target",
      "[snapshots] WORLD_SNAPSHOT_STORAGE is Spaces/S3, but WORLD_SNAPSHOT_SPACES_TARGET is not a valid s3://bucket/path URI."
    );
    return null;
  }
  if (WORLD_SNAPSHOT_STORAGE === "spaces" && !WORLD_SNAPSHOT_SPACES_ENDPOINT) {
    warnWorldSnapshotStorageOnce(
      "missing-spaces-endpoint",
      "[snapshots] WORLD_SNAPSHOT_STORAGE=spaces requires WORLD_SNAPSHOT_SPACES_ENDPOINT, such as https://tor1.digitaloceanspaces.com."
    );
    return null;
  }

  const worldKey = safeFileName(cleanWorld, "START");
  const objectKey = buildS3Key(target.prefix, worldKey, snapshotFileName);
  const awsArgs = [];
  if (WORLD_SNAPSHOT_SPACES_ENDPOINT) {
    awsArgs.push("--endpoint-url", WORLD_SNAPSHOT_SPACES_ENDPOINT);
  }
  awsArgs.push("s3api", "put-object", "--bucket", target.bucket, "--key", objectKey, "--body", snapshotPath);

  try {
    await execFileAsync("aws", awsArgs, {
      env: {
        ...process.env,
        AWS_DEFAULT_REGION: WORLD_SNAPSHOT_SPACES_REGION,
        AWS_REGION: WORLD_SNAPSHOT_SPACES_REGION,
        AWS_REQUEST_CHECKSUM_CALCULATION: process.env.AWS_REQUEST_CHECKSUM_CALCULATION || "when_required",
        AWS_RESPONSE_CHECKSUM_VALIDATION: process.env.AWS_RESPONSE_CHECKSUM_VALIDATION || "when_required",
        AWS_EC2_METADATA_DISABLED: process.env.AWS_EC2_METADATA_DISABLED || "true",
      },
    });
    const storageUri = `s3://${target.bucket}/${objectKey}`;
    console.log(`[snapshots] uploaded world snapshot ${cleanWorld} to ${storageUri}`);
    return storageUri;
  } catch (error) {
    console.warn(`[snapshots] Spaces upload failed for ${cleanWorld}:`, error.message);
    return null;
  }
}

function createWorldSnapshot(worldName, reason, socket = null, player = null, details = {}) {
  try {
    const clean = cleanWorld(worldName);
    const snapshotId = makeAuditId("snapshot");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshotDir = path.join(WORLD_SNAPSHOT_FOLDER, safeFileName(clean, "START"));
    const snapshotFileName = `${stamp}_${safeFileName(reason, "snapshot")}.json`;
    const snapshotPath = path.join(snapshotDir, snapshotFileName);

    const snapshotPayload = {
      snapshot_id: snapshotId,
      created_at: new Date().toISOString(),
      reason: String(reason || "snapshot"),
      actor: getAuditActor(socket, player),
      details,
      world_state: serializeWorldState(clean),
    };

    const snapshotFileWrite = writeJsonFileAtomicAsync(snapshotPath, snapshotPayload)
      .then(() => true)
      .catch((error) => {
        console.warn(`[snapshots] local snapshot write failed for ${clean}:`, error.message);
        return false;
      });
    const objectStorageWrite = snapshotFileWrite.then((fileSaved) => (
      fileSaved ? uploadWorldSnapshotToObjectStorage(snapshotPath, clean, snapshotFileName) : null
    ));
    if (postgresStore.isReady()) {
      trackPersistenceWrite((async () => {
        const fileSaved = await snapshotFileWrite;
        const objectStorageUri = await objectStorageWrite;
        return postgresStore.saveWorldSnapshot(clean, snapshotPayload.world_state, {
          reason: String(reason || "snapshot"),
          storageUri: objectStorageUri || (fileSaved ? snapshotPath : ""),
          createdBy: cleanAccountName(player?.account_username || player?.name || "system") || "system",
          storeSnapshotData: !objectStorageUri || WORLD_SNAPSHOT_POSTGRES_INLINE,
        });
      })(), `world snapshot ${clean}`);
    } else {
      trackPersistenceWrite(objectStorageWrite, `world snapshot upload ${clean}`);
    }

    logWorldChange(socket, player, {
      journal_id: snapshotId,
      source_type: "world_snapshot",
      source_id: snapshotId,
      world: clean,
      action: "snapshot",
      details: { reason, snapshot_path: snapshotPath, snapshot_storage: WORLD_SNAPSHOT_STORAGE, ...details },
    });
    return { snapshotId, snapshotPath };
  } catch (error) {
    console.warn("Could not create world snapshot:", error.message);
    return null;
  }
}

function logAdminAction(socket, player, action, details = {}, ok = true, message = "") {
  const username = cleanAccountName(player?.account_username || player?.name || "");
  const detailObject = details && typeof details === "object" && !Array.isArray(details) ? details : {};
  const socketAudit = getSocketAuditContext(socket, player);
  const targetAudit = inferAdminActionTarget(detailObject);
  const entry = {
    admin_action_event_id: makeAuditId("admin_action"),
    at: new Date().toISOString(),
    admin_id: username,
    admin_username: username,
    admin_role: getAccountRole(username),
    admin_player_id: String(player?.id || ""),
    player_id: String(player?.id || ""),
    ip: socketAudit.ip,
    session_token_hash: socketAudit.session_token_hash,
    user_agent: socketAudit.user_agent,
    device_info: socketAudit.device_info,
    action: String(action || "admin_action"),
    action_type: String(action || "admin_action"),
    target_type: targetAudit.target_type,
    target_id: targetAudit.target_id,
    target_username: targetAudit.target_username,
    target_world: targetAudit.target_world,
    affected_item_id: cleanAccountName(detailObject.affected_item_id || detailObject.item_id || detailObject.item_type || ""),
    affected_item_category: cleanAccountName(detailObject.affected_item_category || detailObject.item_category || ""),
    affected_world: cleanWorld(detailObject.affected_world || detailObject.target_world || detailObject.world || ""),
    amount: Number.isFinite(Number(detailObject.amount ?? detailObject.removed ?? detailObject.requested ?? detailObject.delta))
      ? Math.trunc(Number(detailObject.amount ?? detailObject.removed ?? detailObject.requested ?? detailObject.delta))
      : null,
    reason: String(detailObject.reason || detailObject.command_name || detailObject.command_type || ""),
    ok: Boolean(ok),
    message: String(message || ""),
    ...detailObject,
  };

  appendJsonLine(ADMIN_LOG_PATH, entry, "admin action");
  postgresStore.mirrorAdminAction(entry);
  console.log(`[ADMIN] ${entry.at} ${entry.admin_username || "unknown"} ${entry.action} ${entry.ok ? "ok" : "denied"} ${entry.message}`);
}

function safeTimingEqualString(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyDeveloperPin(pin) {
  const cleanPin = String(pin || "").trim();
  if (cleanPin === "") return false;
  if (DEV_PIN !== "" && safeTimingEqualString(cleanPin, DEV_PIN)) return true;
  if (DEV_PIN_HASH !== "" && safeTimingEqualString(makeTokenHash(cleanPin), DEV_PIN_HASH)) return true;
  return false;
}

function isDeveloperPinUnlocked(player) {
  if (!DEV_PIN_REQUIRED) return true;
  return Boolean(player && Number(player.developer_pin_unlocked_until || 0) > Date.now());
}

function sendDeveloperDenied(socket, requestId, command, message, extra = {}) {
  sendJson(socket, {
    type: "developer_command_denied",
    request_id: requestId,
    command,
    message,
    ...extra,
  });
}

function sendDeveloperApproved(socket, requestId, command, message = "Server approved developer command.", extra = {}) {
  sendJson(socket, {
    type: "developer_command_approved",
    request_id: requestId,
    command,
    message,
    ...extra,
  });
}

function splitCommand(command) {
  const clean = String(command || "").trim().replace(/^\//, "");
  if (clean === "") return [];
  return clean.split(/\s+/);
}

function parseForceEventName(command) {
  const clean = String(command || "").trim().replace(/^\//, "");
  const match = clean.match(/^forceevent\s+(?:"([^"]+)"|'([^']+)'|(.+?))(?:\s+in\s+([A-Za-z0-9_ -]+))?$/i);
  const rawEventName = match ? (match[1] || match[2] || match[3] || "") : "";
  const eventName = rawEventName
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return eventName === "snowstorm" ? SNOW_STORM_EVENT_TYPE : eventName;
}

function parseTargetedGiveCommand(command) {
  const parts = splitCommand(command);
  if (parts.length < 4) return null;
  if (String(parts[0] || "").toLowerCase() !== "give") return null;

  const targetUsername = cleanAccountName(parts[1]);
  const itemId = clampString(parts[2] || "");
  const amount = clampInteger(parts[3] || 1, 1, getDeveloperItemAmountLimit(itemId));
  if (targetUsername === "" || itemId === "") return null;

  return { targetUsername, itemId, amount };
}

function getDeveloperItemAmountLimit(itemId) {
  const cleanItemId = clampString(itemId || "");
  if (cleanItemId !== "" && ItemDatabase.hasItem(cleanItemId)) {
    return ItemDatabase.getStackLimit(cleanItemId);
  }
  return MAX_ITEM_STACK;
}

function getDeveloperCommandName(command) {
  const parts = splitCommand(command);
  if (parts.length === 0) return "";
  return String(parts[0] || "").toLowerCase();
}

function getDeveloperCommandWorldArgument(command) {
  const parts = splitCommand(command);
  if (parts.length < 2) return "";

  const commandName = String(parts[0] || "").toLowerCase();
  if (
    commandName !== "clear" &&
    commandName !== "resetworld" &&
    commandName !== "reset_world" &&
    commandName !== "reworld" &&
    commandName !== "snapshot" &&
    commandName !== "snapshot_world"
  ) {
    return "";
  }

  return cleanWorld(parts.slice(1).join("_"));
}

function getDeveloperCommandWorldName(player, data) {
  return cleanWorld(data.target_world || getDeveloperCommandWorldArgument(data.command || "") || data.world_name || data.world || player?.world || "START");
}

function isClearProtectedBlockType(blockType) {
  const clean = clampString(blockType || "");
  return isWorldLockBlockType(clean) || clean === ENTRANCE_GATE_TYPE || clean === "bedrock";
}

function sanitizeProtectedForegroundEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;

  const x = Math.trunc(Number(rawEntry.x));
  const y = Math.trunc(Number(rawEntry.y));
  if (!isGridInWorld(x, y)) return null;

  const blockType = clampString(rawEntry.block_type || rawEntry.type || "");
  if (!isClearProtectedBlockType(blockType)) return null;
  if (!ItemDatabase.hasItem(blockType) || resolveInventoryCategory(blockType) !== "block") return null;

  return { x, y, block_type: blockType };
}

function putProtectedEntry(target, entry) {
  if (!entry) return;
  target.set(gridKey(entry.x, entry.y), entry);
}

function summarizeWorldAuditState(state) {
  const safeState = state || {};
  return {
    cleared: Boolean(safeState.cleared),
    foreground_count: safeState.foreground instanceof Map ? safeState.foreground.size : 0,
    background_count: safeState.background instanceof Map ? safeState.background.size : 0,
    seed_count: safeState.seeds instanceof Map ? safeState.seeds.size : 0,
    drop_count: safeState.drops instanceof Map ? safeState.drops.size : 0,
    has_world_lock: Boolean(safeState.world_lock?.is_locked),
  };
}

function buildInventoryAdminAuditContext(beforeState, afterState, itemId, itemCategory) {
  const cleanItemId = clampString(itemId || "");
  const cleanCategory = resolveInventoryCategory(cleanItemId, itemCategory || "");
  return {
    inventory_before_hash: makeAuditHash(beforeState || {}),
    inventory_after_hash: makeAuditHash(afterState || {}),
    before_count: getInventoryCount(beforeState || {}, cleanItemId, cleanCategory),
    after_count: getInventoryCount(afterState || {}, cleanItemId, cleanCategory),
  };
}

function getActiveWorldLockKeyForState(state) {
  const lock = state.world_lock || {};
  if (!lock.is_locked) return "";

  const lockGridX = Math.trunc(Number(lock.lock_grid_x));
  const lockGridY = Math.trunc(Number(lock.lock_grid_y));
  if (!isGridInWorld(lockGridX, lockGridY)) return "";

  return gridKey(lockGridX, lockGridY);
}

function getProtectedClearEntries(state, data) {
  const protectedEntries = new Map();
  const activeWorldLockKey = getActiveWorldLockKeyForState(state);
  const lock = state.world_lock || {};
  let keptLegacyWorldLock = false;

  const tryPutProtectedEntry = (entry) => {
    if (!entry) return;

    if (isWorldLockBlockType(entry.block_type)) {
      if (!lock.is_locked) return;

      const key = gridKey(entry.x, entry.y);
      if (activeWorldLockKey !== "") {
        if (key !== activeWorldLockKey) return;
      } else if (keptLegacyWorldLock) {
        return;
      }

      keptLegacyWorldLock = true;
    }

    putProtectedEntry(protectedEntries, entry);
  };

  for (const block of state.foreground.values()) {
    const entry = sanitizeProtectedForegroundEntry(block);
    tryPutProtectedEntry(entry);
  }

  const rawProtected = Array.isArray(data.protected_foreground)
    ? data.protected_foreground
    : (Array.isArray(data.protected_blocks) ? data.protected_blocks : []);

  for (const rawEntry of rawProtected) {
    const entry = sanitizeProtectedForegroundEntry(rawEntry);
    tryPutProtectedEntry(entry);
  }

  if (lock.is_locked && activeWorldLockKey !== "") {
    const lockGridX = Math.trunc(Number(lock.lock_grid_x));
    const lockGridY = Math.trunc(Number(lock.lock_grid_y));
    putProtectedEntry(protectedEntries, { x: lockGridX, y: lockGridY, block_type: normalizeWorldLockBlockType(lock.lock_block_type || lock.lock_type || WORLD_LOCK_BLOCK_TYPE) });
  }

  return protectedEntries;
}

function addBedrockFloorEntries(target) {
  for (let x = 0; x < WORLD_WIDTH; x += 1) {
    for (let y = BEDROCK_START_Y; y < WORLD_HEIGHT; y += 1) {
      target.set(gridKey(x, y), { x, y, block_type: "bedrock" });
    }
  }
}

function replaceWorldStateAndBroadcast(worldName, state, extraMessageData = {}) {
  const clean = cleanWorld(worldName);
  const existingTimer = worldSaveTimers.get(clean);
  if (existingTimer) {
    clearTimeout(existingTimer);
    worldSaveTimers.delete(clean);
  }

  worldStates.set(clean, state);
  saveWorldState(clean);
  broadcastToWorld(clean, buildWorldStateMessage(clean, extraMessageData));
}

function clearWorldByAdmin(worldName, data, socket = null, player = null) {
  const clean = cleanWorld(worldName);
  const currentState = ensureWorldState(clean);
  const beforeSummary = summarizeWorldAuditState(currentState);
  const nextState = createEmptyWorldState();
  nextState.cleared = true;

  const protectedEntries = getProtectedClearEntries(currentState, data);
  const removedCount =
    Math.max(0, currentState.foreground.size - protectedEntries.size) +
    currentState.background.size +
    currentState.seeds.size +
    currentState.drops.size;

  const snapshot = createWorldSnapshot(clean, "before_clear_world", socket, player, {
    removed_count: removedCount,
    protected_count: protectedEntries.size,
  });

  addBedrockFloorEntries(nextState.foreground);

  for (const [key, entry] of protectedEntries.entries()) {
    nextState.foreground.set(key, { ...entry });
  }

  nextState.world_lock = sanitizeWorldLockState(currentState.world_lock || {});

  replaceWorldStateAndBroadcast(clean, nextState, {
    respawn_player: true,
    force_respawn: true,
    world_state_reason: "admin_clear",
  });
  return {
    removedCount,
    protectedCount: protectedEntries.size,
    snapshotId: snapshot?.snapshotId || "",
    beforeSummary,
    afterSummary: summarizeWorldAuditState(nextState),
  };
}

function resetWorldByAdmin(worldName, socket = null, player = null) {
  const clean = cleanWorld(worldName);
  const currentState = ensureWorldState(clean);
  const beforeSummary = summarizeWorldAuditState(currentState);
  const snapshot = createWorldSnapshot(clean, "before_reset_world", socket, player);
  const nextState = createEmptyWorldState();
  replaceWorldStateAndBroadcast(clean, nextState, {
    respawn_player: true,
    force_respawn: true,
    world_state_reason: "admin_reset",
  });
  return {
    snapshotId: snapshot?.snapshotId || "",
    beforeSummary,
    afterSummary: summarizeWorldAuditState(nextState),
  };
}

function parseGiveCommand(data, command) {
  const parts = splitCommand(command);
  if (parts.length === 0 || String(parts[0] || "").toLowerCase() !== "give") return null;

  const metadataTarget = cleanAccountName(data.target_username || data.target || "");
  const metadataItemId = clampString(data.item_id || data.item_type || data.item || "");
  if (metadataTarget !== "" && metadataItemId !== "") {
    const metadataItemCategory = resolveInventoryCategory(metadataItemId, data.item_category || data.category || "");
    return {
      targetUsername: metadataTarget,
      itemId: metadataItemId,
      itemCategory: metadataItemCategory,
      amount: clampInteger(data.amount || 1, 1, getDeveloperItemAmountLimit(metadataItemId)),
    };
  }

  const targetedGive = parseTargetedGiveCommand(command);
  if (!targetedGive) return null;

  return {
    ...targetedGive,
    itemCategory: resolveInventoryCategory(targetedGive.itemId),
  };
}

function parseRemoveCommand(data, command) {
  const parts = splitCommand(command);
  if (parts.length === 0 || String(parts[0] || "").toLowerCase() !== "remove") return null;

  const metadataTarget = cleanAccountName(data.target_username || data.target || "");
  const metadataItemId = clampString(data.item_id || data.item_type || data.item || "");
  if (metadataTarget !== "" && metadataItemId !== "") {
    const metadataItemCategory = resolveInventoryCategory(metadataItemId, data.item_category || data.category || "");
    return {
      targetUsername: metadataTarget,
      itemId: metadataItemId,
      itemCategory: metadataItemCategory,
      amount: clampInteger(data.amount || 1, 1, getDeveloperItemAmountLimit(metadataItemId)),
    };
  }

  if (parts.length < 4) return null;

  return {
    targetUsername: cleanAccountName(parts[1]),
    itemId: clampString(parts[2]),
    itemCategory: resolveInventoryCategory(parts[2]),
    amount: clampInteger(parts[3] || 1, 1, getDeveloperItemAmountLimit(parts[2])),
  };
}

function getSocketAuditContext(socket, player) {
  const username = cleanAccountName(player?.account_username || player?.name || "");
  const account = username !== "" ? accounts.get(accountKey(username)) : null;
  const userAgent = String(socket?.userAgent || "");
  return {
    ip: getSocketAddress(socket),
    session_token_hash: cleanAccountName(account?.session_token_hash || ""),
    user_agent: userAgent,
    device_info: {
      user_agent: userAgent,
      client_version: String(player?.client_version || ""),
    },
  };
}

function inferAdminActionTarget(details = {}) {
  const d = details && typeof details === "object" && !Array.isArray(details) ? details : {};
  const targetUsername = cleanAccountName(d.target_username || d.username || d.target_player || "");
  const targetWorld = cleanWorld(d.target_world || d.world_name || "");
  const worldName = cleanWorld(d.world || "");
  const targetItem = cleanAccountName(d.public_item_instance_id || d.item_instance_id || "");

  const targetType = cleanAccountName(d.target_type || (
    targetUsername !== "" ? "player" :
    targetWorld !== "" ? "world" :
    targetItem !== "" ? "item_instance" :
    worldName !== "" ? "world" :
    "server"
  ));

  const targetId = cleanAccountName(d.target_id || targetUsername || targetWorld || targetItem || worldName || "");
  return {
    target_type: targetType || "server",
    target_id: targetId,
    target_username: targetUsername,
    target_world: targetWorld || worldName,
  };
}

function getAccountRoleRank(username) {
  const role = getAccountRole(username);
  if (role === "developer" || role === "admin") return 100;
  if (role === "moderator") return 50;
  return 10;
}

function canPunishTarget(actorUsername, targetUsername) {
  const actorKey = accountKey(actorUsername);
  const targetKey = accountKey(targetUsername);
  if (actorKey === "" || targetKey === "") return false;
  if (actorKey === targetKey) return false;
  return getAccountRoleRank(actorUsername) > getAccountRoleRank(targetUsername);
}

function getPunishmentStoreMessage(result, fallback = "Could not update punishment.") {
  const reason = String(result?.reason || "").trim();
  switch (reason) {
    case "postgres_unavailable":
      return "PostgreSQL is not ready.";
    case "invalid_target":
      return "Target username is required.";
    case "invalid_punishment_type":
      return "Invalid punishment type.";
    case "world_required":
      return "World is required for world bans.";
    case "player_not_found":
      return "Target account does not have a player row yet.";
    case "database_error":
      return "PostgreSQL rejected the punishment update.";
    default:
      return fallback;
  }
}

function parsePunishmentCommand(data, command, player) {
  const parts = splitCommand(command);
  if (parts.length === 0) return null;

  const commandName = String(parts[0] || "").toLowerCase().replace(/-/g, "_");
  const issueCommands = {
    ban: "ban",
    mute: "mute",
    tradeban: "trade_ban",
    trade_ban: "trade_ban",
    worldban: "world_ban",
    world_ban: "world_ban",
  };
  const revokeCommands = {
    unban: "ban",
    unmute: "mute",
    untradeban: "trade_ban",
    untrade_ban: "trade_ban",
    unworldban: "world_ban",
    unworld_ban: "world_ban",
  };
  const listCommands = new Set(["punishments", "punishment", "punish"]);
  const metadataTarget = cleanAccountName(data.target_username || data.target || data.username || "");
  const targetUsername = cleanAccountName(parts[1] || metadataTarget);

  if (listCommands.has(commandName)) {
    return {
      mode: "list",
      targetUsername,
      punishmentType: normalizeServerPunishmentType(data.punishment_type || data.type || ""),
    };
  }

  const issueType = normalizeServerPunishmentType(issueCommands[commandName] || "");
  if (issueType !== "") {
    let scope = PUNISHMENT_SCOPE_GLOBAL;
    let worldName = "";
    let durationIndex = 2;

    if (issueType === "world_ban") {
      scope = PUNISHMENT_SCOPE_WORLD;
      worldName = cleanWorldNameForPunishment(data.world_name || data.target_world || data.world || player?.world || "START");
      const worldOrDuration = String(parts[2] || "").trim();
      const durationProbe = parsePunishmentDurationToken(worldOrDuration);
      if (worldOrDuration !== "" && !durationProbe.consumed) {
        worldName = cleanWorldNameForPunishment(worldOrDuration);
        durationIndex = 3;
      }
    }

    const duration = parsePunishmentDurationToken(parts[durationIndex] || "");
    const reasonIndex = duration.consumed ? durationIndex + 1 : durationIndex;
    const reason = cleanPunishmentReason(parts.slice(reasonIndex).join(" ") || data.reason || "");
    return {
      mode: "issue",
      targetUsername,
      punishmentType: issueType,
      scope,
      world: worldName,
      durationMinutes: duration.consumed ? duration.durationMinutes : 0,
      durationLabel: duration.consumed ? duration.label : "permanent",
      reason,
    };
  }

  const revokeType = normalizeServerPunishmentType(revokeCommands[commandName] || "");
  if (revokeType !== "") {
    let scope = PUNISHMENT_SCOPE_GLOBAL;
    let worldName = "";
    let reasonIndex = 2;

    if (revokeType === "world_ban") {
      scope = PUNISHMENT_SCOPE_WORLD;
      worldName = cleanWorldNameForPunishment(data.world_name || data.target_world || data.world || player?.world || "START");
      if (String(parts[2] || "").trim() !== "") {
        worldName = cleanWorldNameForPunishment(parts[2]);
        reasonIndex = 3;
      }
    }

    const reason = cleanPunishmentReason(parts.slice(reasonIndex).join(" ") || data.reason || "revoked");
    return {
      mode: "revoke",
      targetUsername,
      punishmentType: revokeType,
      scope,
      world: worldName,
      reason,
    };
  }

  return null;
}

function parseItemInstanceAdminCommand(data, command) {
  const parts = splitCommand(command);
  if (parts.length === 0) return null;

  const commandName = String(parts[0] || "").toLowerCase().replace(/-/g, "_");
  const auditCommands = new Set(["itemaudit", "audititems", "item_audit", "audit_items"]);
  if (auditCommands.has(commandName)) {
    return {
      mode: "audit",
      limit: clampInteger(data.limit || parts[1] || ANTI_DUPE_AUDIT_LIMIT, 1, ANTI_DUPE_AUDIT_LIMIT),
    };
  }

  const copiesCommands = new Set(["itemcopies", "itemowners", "item_copies", "item_owners", "itemcopy", "item_owner"]);
  if (copiesCommands.has(commandName)) {
    const metadataIdentifier = clampString(
      data.public_item_instance_id || data.item_instance_public_id || data.item_instance_id || data.instance_id || data.item_type || data.item_id || data.id || "",
      96
    );
    return {
      mode: "copies",
      itemInstanceId: clampString(metadataIdentifier || parts[1] || "", 96),
      limit: clampInteger(data.limit || parts[2] || 100, 1, 500),
    };
  }

  const actionCommands = {
    itemfreeze: "freeze",
    freezeitem: "freeze",
    item_freeze: "freeze",
    itemunfreeze: "unfreeze",
    unfreezeitem: "unfreeze",
    item_unfreeze: "unfreeze",
    itemretire: "retire",
    retireitem: "retire",
    item_retire: "retire",
    itemdelete: "retire",
    deleteitem: "retire",
    item_delete: "retire",
    itemtransfer: "transfer",
    transferitem: "transfer",
    item_transfer: "transfer",
    itemflag: "flag",
    flagitem: "flag",
    item_flag: "flag",
  };
  const action = actionCommands[commandName] || "";
  if (action === "") return null;

  const metadataIdentifier = clampString(
    data.public_item_instance_id || data.item_instance_public_id || data.item_instance_id || data.instance_id || data.id || "",
    96
  );
  const itemInstanceId = clampString(metadataIdentifier || parts[1] || "", 96);
  let targetUsername = cleanAccountName(data.target_username || data.target || data.to_username || "");
  let reasonIndex = 2;

  if (action === "transfer") {
    if (targetUsername === "") targetUsername = cleanAccountName(parts[2] || "");
    reasonIndex = 3;
  }

  const reason = String(parts.slice(reasonIndex).join(" ") || data.reason || "").trim().slice(0, 500);
  return {
    mode: "moderate",
    action,
    itemInstanceId,
    targetUsername,
    reason,
  };
}

function getItemInstanceStoreMessage(result, fallback = "Could not update item instance.") {
  const reason = String(result?.reason || "").trim();
  switch (reason) {
    case "postgres_unavailable":
      return "PostgreSQL is not ready.";
    case "invalid_item_instance":
      return "Item instance ID is required.";
    case "invalid_action":
      return "Invalid item instance action.";
    case "item_instance_not_found":
      return "Item instance was not found.";
    case "owner_required":
      return "That item has no current owner to restore to inventory.";
    case "target_required":
      return "Target username is required.";
    case "target_not_found":
      return "Target account does not have a player row yet.";
    case "insufficient_capacity":
      return "Target inventory does not have room for that item.";
    case "database_error":
      return "PostgreSQL rejected the item instance update.";
    default:
      return fallback;
  }
}

function formatItemAuditSummary(result) {
  const summary = result?.summary || {};
  const issueCount = clampInteger(summary.total_issues || 0, 0, ANTI_DUPE_AUDIT_LIMIT);
  if (issueCount <= 0) return "Item audit clean: no duplicate or mismatched tracked items found.";

  const sample = Array.isArray(result.issues) ? result.issues.slice(0, 3) : [];
  const sampleText = sample.map((issue) => {
    if (issue.type === "inventory_count_mismatch") {
      return `${issue.username || issue.player_id} ${issue.item_type}: inventory ${issue.inventory_amount}, instances ${issue.active_instance_count}`;
    }
    return `${issue.type}: ${issue.public_item_instance_id || issue.item_instance_id || issue.item_type || "unknown"}`;
  }).join(" | ");
  const suffix = sampleText !== "" ? ` Sample: ${sampleText}` : "";
  return `Item audit found ${issueCount} issue(s): duplicates=${summary.duplicate_public_ids || 0}, impossible=${summary.impossible_states || 0}, count_mismatches=${summary.inventory_mismatches || 0}.${suffix}`;
}

function formatItemInstanceModerationMessage(result) {
  const item = result?.item_instance || {};
  const publicId = item.public_item_instance_id || item.item_instance_id || "item";
  const itemType = item.item_type || "unknown_item";
  const owner = item.current_owner_username ? ` owner=${item.current_owner_username}` : "";
  return `Item ${result.action} ok: ${publicId} (${itemType}) state=${item.state || "unknown"} location=${item.current_location || "unknown"}${owner}.`;
}

function formatItemInstanceCopiesSummary(result) {
  const query = result?.query || {};
  const summary = result?.summary || {};
  const itemType = query.item_type || query.identifier || "item";
  const total = clampInteger(summary.total || 0, 0, 500);
  if (total <= 0) return `No tracked copies found for ${itemType}.`;

  const sample = Array.isArray(result.copies) ? result.copies.slice(0, 4) : [];
  const sampleText = sample.map((copy) => {
    const id = copy.public_item_instance_id || copy.item_instance_id || "item";
    const owner = copy.current_owner_username || "no-owner";
    const source = copy.created_by_source || "unknown";
    const duplicate = copy.possible_duplicate ? " DUPLICATE?" : "";
    return `${id} owner=${owner} ${copy.state || "unknown"}/${copy.current_location || "unknown"} source=${source}${duplicate}`;
  }).join(" | ");
  const suffix = sampleText !== "" ? ` Sample: ${sampleText}` : "";
  return `Tracked copies for ${itemType}: total=${total}, active=${summary.active || 0}, frozen=${summary.frozen || 0}, retired=${summary.retired || 0}, duplicate_flags=${summary.duplicate_public_ids || 0}.${suffix}`;
}

function formatPunishmentList(targetUsername, rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `No active punishments for ${targetUsername}.`;
  }

  const rendered = rows.slice(0, 8).map((row) => {
    const payload = publicPunishmentPayload(row);
    const worldText = payload.scope === PUNISHMENT_SCOPE_WORLD && payload.world ? ` ${payload.world}` : "";
    return `${getPunishmentTypeLabel(payload.punishment_type)}${worldText} ${formatPunishmentExpires(payload)}: ${payload.reason}`;
  });
  const suffix = rows.length > rendered.length ? ` (+${rows.length - rendered.length} more)` : "";
  return `Active punishments for ${targetUsername}: ${rendered.join(" | ")}${suffix}`;
}

function notifyPunishmentTarget(targetUsername, message, punishment = null, closeConnection = false) {
  const target = findOnlinePlayerByUsername(targetUsername);
  if (!target) return;

  cancelActiveTradeForPlayer(target.player.id, "Trade canceled by moderation action.");
  sendPunishmentNotice(target.socket, target.player, message, punishment);
  if (closeConnection) {
    if (target.player.joined_world) {
      broadcastToWorld(target.player.world, buildPublicPlayerPresencePayload("player_left", target.player, target.player.world), target.player.id);
    }
    setTimeout(() => {
      if (target.socket.readyState === WebSocket.OPEN) {
        target.socket.close(1008, "Account restricted.");
      }
    }, 80);
  }
}

async function handleDeveloperPunishmentCommand(socket, player, data, command, parsed, approve, deny) {
  if (!parsed) return false;

  const targetUsername = cleanAccountName(parsed.targetUsername || "");
  if (targetUsername === "") {
    deny("Target username is required.", { command_type: "punishment" });
    return true;
  }

  if (!isPostgresAuthoritativeReady()) {
    deny("PostgreSQL is not ready for punishments.", { target_username: targetUsername });
    return true;
  }

  if (!doesAccountExist(targetUsername)) {
    deny("Target account does not exist.", { target_username: targetUsername });
    return true;
  }

  const account = accounts.get(accountKey(targetUsername)) || null;
  const displayUsername = account?.username || targetUsername;
  const actorUsername = cleanAccountName(player.account_username || player.name || "");

  if (parsed.mode === "list") {
    const rows = await postgresStore.getActivePunishments(displayUsername, {
      punishment_type: parsed.punishmentType || "",
    });
    approve(
      formatPunishmentList(displayUsername, rows),
      {
        target_username: displayUsername,
        target_type: "player",
        punishment_count: rows.length,
        reason: "developer_lookup",
      },
      {
        command_type: "punishments",
        target_username: displayUsername,
        purpose: ADMIN_PUNISHMENT_LOOKUP_PURPOSE,
        punishments: rows.map(publicPunishmentPayload),
      }
    );
    return true;
  }

  if (!canPunishTarget(actorUsername, displayUsername)) {
    deny("You cannot punish or revoke punishments for that account.", {
      target_username: displayUsername,
      target_role: getAccountRole(displayUsername),
      actor_role: getAccountRole(actorUsername),
    });
    return true;
  }

  const punishmentType = normalizeServerPunishmentType(parsed.punishmentType || "");
  if (punishmentType === "") {
    deny("Invalid punishment type.", { target_username: displayUsername });
    return true;
  }

  const scope = parsed.scope === PUNISHMENT_SCOPE_WORLD ? PUNISHMENT_SCOPE_WORLD : PUNISHMENT_SCOPE_GLOBAL;
  const worldName = scope === PUNISHMENT_SCOPE_WORLD ? cleanWorldNameForPunishment(parsed.world || player.world || "START") : "";

  if (parsed.mode === "issue") {
    const existing = await getBlockingPunishment(displayUsername, [punishmentType], {
      scope,
      world: worldName,
    });
    if (existing) {
      deny(`Target already has an active ${getPunishmentTypeLabel(punishmentType)}.`, {
        target_username: displayUsername,
        punishment_type: punishmentType,
        punishment_id: existing.punishment_id,
        scope,
        world: worldName,
      });
      return true;
    }

    const result = await postgresStore.issuePunishment({
      target_username: displayUsername,
      issued_by_username: actorUsername,
      punishment_type: punishmentType,
      reason: parsed.reason,
      scope,
      world: worldName,
      duration_minutes: parsed.durationMinutes,
      metadata: {
        request_id: makeRequestId(data),
        command,
        duration_label: parsed.durationLabel,
      },
    });

    if (!result.ok) {
      deny(getPunishmentStoreMessage(result), {
        target_username: displayUsername,
        punishment_type: punishmentType,
        scope,
        world: worldName,
        reason: result.reason,
      });
      return true;
    }

    clearPunishmentCache(displayUsername);
    const punishmentPayload = publicPunishmentPayload({
      punishment_id: result.punishment_id,
      punishment_type: punishmentType,
      scope,
      world: worldName,
      reason: parsed.reason,
      ends_at: result.ends_at,
      issued_by: actorUsername,
    });
    const targetMessage = `Moderation: active ${getPunishmentTypeLabel(punishmentType)} ${formatPunishmentExpires(punishmentPayload)}. Reason: ${parsed.reason}`;
    const shouldClose = punishmentType === "ban" || punishmentType === "lockout";
    if (shouldClose) {
      await postgresStore.revokeSessionsForUsername(displayUsername);
    }
    notifyPunishmentTarget(displayUsername, targetMessage, punishmentPayload, shouldClose);

    approve(
      `${getPunishmentTypeLabel(punishmentType)} issued for ${displayUsername} (${formatPunishmentExpires(punishmentPayload)}).`,
      {
        target_username: displayUsername,
        target_type: "player",
        punishment_type: punishmentType,
        punishment_id: result.punishment_id,
        scope,
        world: worldName,
        duration_minutes: parsed.durationMinutes,
        before_active: false,
        after_active: true,
        reason: parsed.reason,
      },
      {
        command_type: "punishment_issue",
        target_username: displayUsername,
        punishment: punishmentPayload,
      }
    );
    return true;
  }

  if (parsed.mode === "revoke") {
    const activeBefore = await postgresStore.getActivePunishments(displayUsername, {
      punishment_type: punishmentType,
      scope,
      world: worldName,
    });
    const result = await postgresStore.revokePunishment({
      target_username: displayUsername,
      punishment_type: punishmentType,
      scope,
      world: worldName,
      revoked_by_username: actorUsername,
      reason: parsed.reason,
    });

    if (!result.ok) {
      deny(getPunishmentStoreMessage(result), {
        target_username: displayUsername,
        punishment_type: punishmentType,
        scope,
        world: worldName,
        reason: result.reason,
      });
      return true;
    }

    clearPunishmentCache(displayUsername);
    notifyPunishmentTarget(displayUsername, `Moderation: your ${getPunishmentTypeLabel(punishmentType)} was removed.`, {
      punishment_type: punishmentType,
      scope,
      world: worldName,
      reason: parsed.reason,
    });

    approve(
      result.revoked_count > 0
        ? `${getPunishmentTypeLabel(punishmentType)} removed for ${displayUsername}.`
        : `No active ${getPunishmentTypeLabel(punishmentType)} matched ${displayUsername}.`,
      {
        target_username: displayUsername,
        target_type: "player",
        punishment_type: punishmentType,
        scope,
        world: worldName,
        revoked_count: result.revoked_count,
        before_active_punishment_ids: activeBefore.map((row) => row.punishment_id).filter((id) => Number(id) > 0),
        after_active: false,
        reason: parsed.reason,
      },
      {
        command_type: "punishment_revoke",
        target_username: displayUsername,
        punishment_type: punishmentType,
        scope,
        world: worldName,
        revoked_count: result.revoked_count,
      }
    );
    return true;
  }

  return false;
}

async function handleDeveloperItemInstanceAdminCommand(socket, player, data, command, parsed, approve, deny) {
  if (!parsed) return false;

  if (!isPostgresAuthoritativeReady()) {
    deny("PostgreSQL is not ready for item instance controls.", { command_type: "item_instance_admin" });
    return true;
  }

  const actorUsername = cleanAccountName(player.account_username || player.name || "");
  const requestId = makeRequestId(data);

  if (parsed.mode === "audit") {
    const result = await postgresStore.auditItemInstances({ limit: parsed.limit || ANTI_DUPE_AUDIT_LIMIT });
    if (!result.ok) {
      deny(getItemInstanceStoreMessage(result, "Item audit failed."), {
        command_type: "item_audit",
        reason: result.reason || "unknown",
      });
      return true;
    }

    const issueCount = clampInteger(result.summary?.total_issues || 0, 0, ANTI_DUPE_AUDIT_LIMIT);
    if (issueCount > 0) {
      logSecurityEvent(socket, player, "item_instance_audit_issues", {
        request_id: requestId,
        summary: result.summary,
        sample: Array.isArray(result.issues) ? result.issues.slice(0, 5) : [],
      }, "high");
    }

    approve(
      formatItemAuditSummary(result),
      {
        command_type: "item_audit",
        issue_count: issueCount,
        summary: result.summary,
      },
      {
        command_type: "item_audit",
        item_audit: result,
      }
    );
    return true;
  }

  if (parsed.mode === "copies") {
    const itemInstanceId = clampString(parsed.itemInstanceId || "", 96);
    if (itemInstanceId === "") {
      deny("Item instance ID or item type is required.", { command_type: "item_instance_copies" });
      return true;
    }

    const result = await postgresStore.listItemInstanceCopies(itemInstanceId, { limit: parsed.limit || 100 });
    if (!result.ok) {
      deny(getItemInstanceStoreMessage(result, "Item copy lookup failed."), {
        command_type: "item_instance_copies",
        reason: result.reason || "unknown",
      });
      return true;
    }

    const duplicateCount = clampInteger(result.summary?.duplicate_public_ids || 0, 0, 500);
    if (duplicateCount > 0) {
      logSecurityEvent(socket, player, "item_instance_duplicate_copies_lookup", {
        request_id: requestId,
        query: result.query,
        summary: result.summary,
      }, "high");
    }

    approve(
      formatItemInstanceCopiesSummary(result),
      {
        command_type: "item_instance_copies",
        item_type: result.query?.item_type || "",
        total: result.summary?.total || 0,
        duplicate_flags: duplicateCount,
      },
      {
        command_type: "item_instance_copies",
        item_instance_copies: result,
      }
    );
    return true;
  }

  const itemInstanceId = clampString(parsed.itemInstanceId || "", 96);
  if (itemInstanceId === "") {
    deny("Item instance ID is required.", { command_type: "item_instance_admin", action: parsed.action || "" });
    return true;
  }

  if (parsed.action === "transfer") {
    const targetUsername = cleanAccountName(parsed.targetUsername || "");
    if (targetUsername === "") {
      deny("Target username is required.", { command_type: "item_instance_transfer", item_instance_id: itemInstanceId });
      return true;
    }
    if (!doesAccountExist(targetUsername)) {
      deny("Target account does not exist.", { command_type: "item_instance_transfer", item_instance_id: itemInstanceId, target_username: targetUsername });
      return true;
    }
  }

  const result = await postgresStore.moderateItemInstance(itemInstanceId, parsed.action, {
    actor_username: actorUsername,
    target_username: parsed.targetUsername,
    reason: parsed.reason || "",
    request_id: requestId,
  });

  if (!result.ok) {
    deny(getItemInstanceStoreMessage(result), {
      command_type: "item_instance_admin",
      action: parsed.action || "",
      item_instance_id: itemInstanceId,
      reason: result.reason || "unknown",
    });
    return true;
  }

  const localUpdates = applyItemInstanceInventoryEffectsToPlayerStates(result.inventory_effects);
  logSecurityEvent(socket, player, "item_instance_admin_action", {
    request_id: requestId,
    action: result.action,
    item_instance: result.item_instance,
    inventory_effects: localUpdates,
  }, result.action === "flag" ? "warning" : "medium");

  const targetUsername = cleanAccountName(result.item_instance?.current_owner_username || "");
  const target = targetUsername !== "" ? findOnlinePlayerByUsername(targetUsername) : null;
  if (target && accountKey(target.player.account_username) !== accountKey(actorUsername)) {
    sendJson(target.socket, {
      type: "chat",
      sender: "System",
      message: `An admin updated tracked item ${result.item_instance.public_item_instance_id || itemInstanceId}.`,
    });
  }

    approve(
      formatItemInstanceModerationMessage(result),
      {
        command_type: "item_instance_admin",
        target_type: "item_instance",
        action: result.action,
        item_instance_id: result.item_instance?.item_instance_id || itemInstanceId,
        public_item_instance_id: result.item_instance?.public_item_instance_id || "",
        target_username: targetUsername,
        item_id: result.item_instance?.item_type || "",
        item_category: result.item_instance?.item_category || "",
        before_item_instance: result.previous || {},
        after_item_instance: {
          state: result.item_instance?.state || "",
          current_location: result.item_instance?.current_location || "",
          owner_username: result.item_instance?.current_owner_username || "",
        },
        reason: parsed.reason || "developer_command",
        inventory_effects: localUpdates,
      },
    {
      command_type: "item_instance_admin",
      item_instance_result: result,
      inventory_effects: localUpdates,
    }
  );
  return true;
}

function cleanInventoryCategory(value) {
  return ItemDatabase.cleanCategory(value);
}

function inferInventoryCategory(itemId) {
  return ItemDatabase.resolveItemCategory(itemId);
}

function resolveInventoryCategory(itemId, requestedCategory = "") {
  return ItemDatabase.resolveItemCategory(itemId, requestedCategory);
}

function getXpNeededForLevel(level) {
  const safeLevel = clampInteger(level || PLAYER_LEVEL_MIN, PLAYER_LEVEL_MIN, PLAYER_LEVEL_MAX);
  if (safeLevel >= PLAYER_LEVEL_MAX) return 0;

  const levelIndex = safeLevel - PLAYER_LEVEL_MIN;
  return PLAYER_XP_FIRST_LEVEL + (levelIndex * 120) + Math.floor(Math.pow(levelIndex, 1.6) * 42);
}

function getCumulativeXpAtLevel(level) {
  const safeLevel = clampInteger(level || PLAYER_LEVEL_MIN, PLAYER_LEVEL_MIN, PLAYER_LEVEL_MAX);
  let total = 0;
  for (let currentLevel = PLAYER_LEVEL_MIN; currentLevel < safeLevel; currentLevel += 1) {
    total += getXpNeededForLevel(currentLevel);
  }
  return total;
}

function getPlayerTitleForLevel(level) {
  const safeLevel = clampInteger(level || PLAYER_LEVEL_MIN, PLAYER_LEVEL_MIN, PLAYER_LEVEL_MAX);
  if (safeLevel >= 100) return "Pixel Legend";
  if (safeLevel >= 80) return "Worldsmith";
  if (safeLevel >= 60) return "Architect";
  if (safeLevel >= 40) return "Trailblazer";
  if (safeLevel >= 25) return "Crafter";
  if (safeLevel >= 10) return "Builder";
  return "Explorer";
}

function normalizeProgressionState(rawState = {}) {
  const source = rawState && typeof rawState === "object" && !Array.isArray(rawState) ? rawState : {};
  let level = clampInteger(source.player_level || source.level || PLAYER_LEVEL_MIN, PLAYER_LEVEL_MIN, PLAYER_LEVEL_MAX);
  let xp = clampInteger(source.player_xp || source.xp || 0, 0, Number.MAX_SAFE_INTEGER);
  let totalXp = clampInteger(source.player_total_xp || source.total_xp || 0, 0, Number.MAX_SAFE_INTEGER);

  if (totalXp <= 0 && (level > PLAYER_LEVEL_MIN || xp > 0)) {
    totalXp = getCumulativeXpAtLevel(level) + xp;
  }

  while (level < PLAYER_LEVEL_MAX) {
    const needed = getXpNeededForLevel(level);
    if (needed <= 0 || xp < needed) break;
    xp -= needed;
    level += 1;
  }

  if (level >= PLAYER_LEVEL_MAX) {
    level = PLAYER_LEVEL_MAX;
    xp = 0;
  }

  return {
    player_level: level,
    player_xp: xp,
    player_xp_needed: getXpNeededForLevel(level),
    player_total_xp: totalXp,
    player_title: getPlayerTitleForLevel(level),
  };
}

function applyProgressionFieldsToState(state, progression) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  const safeProgression = normalizeProgressionState(progression || state);
  state.player_level = safeProgression.player_level;
  state.player_xp = safeProgression.player_xp;
  state.player_xp_needed = safeProgression.player_xp_needed;
  state.player_total_xp = safeProgression.player_total_xp;
  state.player_title = safeProgression.player_title;
  return state;
}

function getRarityXpBonus(itemId) {
  const definition = ItemDatabase.getItemDefinition(clampString(itemId || ""));
  switch (String(definition?.rarity || "common").toLowerCase()) {
    case "legendary":
      return 80;
    case "epic":
      return 38;
    case "rare":
      return 18;
    case "uncommon":
      return 7;
    default:
      return 0;
  }
}

function getBlockBreakXp(blockType, layer) {
  const definition = ItemDatabase.getItemDefinition(clampString(blockType || ""));
  if (!definition || definition.category !== "block") return 0;

  return 3;
}

function getRecipeXp(stationId, output) {
  const reward = output && typeof output === "object" && !Array.isArray(output) ? output : {};
  const amount = clampInteger(reward.amount || 1, 1, MAX_ITEM_STACK);
  const stationBonus = stationId === "furnace" ? 7 : 10;
  return stationBonus + Math.min(120, amount * 4) + getRarityXpBonus(reward.item_id || reward.item_type || "");
}

function getFishingXp(fishId, difficulty) {
  return 12 + (clampInteger(difficulty || 1, 1, 10) * 6) + getRarityXpBonus(fishId);
}

function getSeedHarvestXp(rewards, matured) {
  if (!matured || !Array.isArray(rewards) || rewards.length === 0) return 0;

  return 3;
}

function grantExperienceToState(state, amount, source = "system", details = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { xp_gained: 0, levels_gained: 0, state: null };
  }

  const xpGained = clampInteger(amount || 0, 0, 1000000);
  const before = normalizeProgressionState(state);
  applyProgressionFieldsToState(state, before);

  if (xpGained <= 0 || before.player_level >= PLAYER_LEVEL_MAX) {
    return {
      xp_gained: 0,
      levels_gained: 0,
      level_before: before.player_level,
      level_after: before.player_level,
      xp_before: before.player_xp,
      xp_after: before.player_xp,
      xp_needed: before.player_xp_needed,
      total_xp_after: before.player_total_xp,
      title: before.player_title,
      source,
      details,
      state,
    };
  }

  let level = before.player_level;
  let xp = before.player_xp + xpGained;
  let levelsGained = 0;
  while (level < PLAYER_LEVEL_MAX) {
    const needed = getXpNeededForLevel(level);
    if (needed <= 0 || xp < needed) break;
    xp -= needed;
    level += 1;
    levelsGained += 1;
  }

  if (level >= PLAYER_LEVEL_MAX) {
    level = PLAYER_LEVEL_MAX;
    xp = 0;
  }

  const progression = {
    player_level: level,
    player_xp: xp,
    player_xp_needed: getXpNeededForLevel(level),
    player_total_xp: before.player_total_xp + xpGained,
    player_title: getPlayerTitleForLevel(level),
  };
  applyProgressionFieldsToState(state, progression);
  if (levelsGained > 0) {
    state.last_level_up_at = new Date().toISOString();
  }

  return {
    xp_gained: xpGained,
    levels_gained: levelsGained,
    level_before: before.player_level,
    level_after: level,
    xp_before: before.player_xp,
    xp_after: xp,
    xp_needed: progression.player_xp_needed,
    total_xp_after: progression.player_total_xp,
    title: progression.player_title,
    source,
    details,
    state,
  };
}

function awardPlayerExperience(username, amount, source = "system", details = {}, existingState = null) {
  const clean = cleanAccountName(username);
  if (clean === "") return { xp_gained: 0, levels_gained: 0, state: existingState || null };

  const state = existingState || ensureWritablePlayerState(clean);
  const progression = grantExperienceToState(state, amount, source, details);
  if (progression.xp_gained > 0 && progression.state) {
    persistPlayerInventoryChange(clean, progression.state);
    postgresStore.mirrorPlayerProgression(clean, progression.state, progression);
  }
  return progression;
}

function buildProgressionPayload(progression) {
  if (!progression || Number(progression.xp_gained || 0) <= 0) return {};
  return {
    xp_gained: Math.max(0, Math.trunc(Number(progression.xp_gained) || 0)),
    levels_gained: Math.max(0, Math.trunc(Number(progression.levels_gained) || 0)),
    level_before: clampInteger(progression.level_before || PLAYER_LEVEL_MIN, PLAYER_LEVEL_MIN, PLAYER_LEVEL_MAX),
    level_after: clampInteger(progression.level_after || PLAYER_LEVEL_MIN, PLAYER_LEVEL_MIN, PLAYER_LEVEL_MAX),
    xp_after: clampInteger(progression.xp_after || 0, 0, Number.MAX_SAFE_INTEGER),
    xp_needed: clampInteger(progression.xp_needed || 0, 0, Number.MAX_SAFE_INTEGER),
    total_xp_after: clampInteger(progression.total_xp_after || 0, 0, Number.MAX_SAFE_INTEGER),
    title: String(progression.title || getPlayerTitleForLevel(progression.level_after || PLAYER_LEVEL_MIN)),
    source: String(progression.source || ""),
  };
}

function getProgressionMessage(progression, fallback = "") {
  if (progression && Number(progression.levels_gained || 0) > 0) {
    return `Level ${progression.level_after} reached: ${progression.title}!`;
  }
  return String(fallback || "");
}

function getProgressionXpMessage(progression) {
  if (!progression || Number(progression.xp_gained || 0) <= 0) return "";
  const xpGained = Math.max(0, Math.trunc(Number(progression.xp_gained) || 0));
  const xpAfter = Math.max(0, Math.trunc(Number(progression.xp_after) || 0));
  const xpNeeded = Math.max(0, Math.trunc(Number(progression.xp_needed) || 0));
  if (xpNeeded <= 0) return `+${xpGained} XP`;
  return `+${xpGained} XP (${xpAfter}/${xpNeeded})`;
}

function logPlayerProgressionAward(player, progression) {
  if (!DEBUG_PLAYER_PROGRESSION || !progression || Number(progression.xp_gained || 0) <= 0) return;

  console.log("[player_progression_award]", {
    username: cleanAccountName(player?.account_username || player?.name || ""),
    source: String(progression.source || ""),
    xp_gained: Math.max(0, Math.trunc(Number(progression.xp_gained) || 0)),
    level_before: clampInteger(progression.level_before || PLAYER_LEVEL_MIN, PLAYER_LEVEL_MIN, PLAYER_LEVEL_MAX),
    level_after: clampInteger(progression.level_after || PLAYER_LEVEL_MIN, PLAYER_LEVEL_MIN, PLAYER_LEVEL_MAX),
    xp_after: Math.max(0, Math.trunc(Number(progression.xp_after) || 0)),
    xp_needed: Math.max(0, Math.trunc(Number(progression.xp_needed) || 0)),
  });
}

function getInventoryFieldForCategory(category, itemId) {
  return ItemDatabase.getInventoryFieldForItem(itemId, category) || "inventory";
}

function sanitizePrimaryHotbarTool(value) {
  const clean = clampString(value || "");
  return clean === "wrench" ? "wrench" : "punch";
}

function isServerHotbarItemAllowed(state, itemId, itemCategory, options = {}) {
  const cleanItemId = clampString(itemId || "");
  if (cleanItemId === "") return false;

  const cleanCategory = cleanInventoryCategory(itemCategory || "");
  if (cleanItemId === "punch" && cleanCategory === "tool") return true;
  if (!ItemDatabase.hasItem(cleanItemId)) return false;

  const resolvedCategory = resolveInventoryCategory(cleanItemId, cleanCategory);
  if (resolvedCategory === "") return false;
  if (!ItemDatabase.canStoreItemInCategory(cleanItemId, resolvedCategory)) return false;

  const definition = ItemDatabase.getItemDefinition(cleanItemId) || {};
  if (definition.hidden) return false;
  if (options.allowEmptyCount === true) return true;

  return getInventoryCount(state, cleanItemId, resolvedCategory) > 0;
}

function appendServerHotbarItem(state, items, categories, itemId, itemCategory, options = {}) {
  if (!Array.isArray(items) || !Array.isArray(categories)) return;
  if (items.length >= HOTBAR_SLOT_COUNT) return;

  const cleanItemId = clampString(itemId || "");
  if (cleanItemId === "") return;
  if (cleanItemId === "punch") return;

  let resolvedCategory = cleanInventoryCategory(itemCategory || "");
  if (cleanItemId !== "punch" && ItemDatabase.hasItem(cleanItemId)) {
    resolvedCategory = resolveInventoryCategory(cleanItemId, resolvedCategory);
  }
  if (resolvedCategory === "") return;

  if (!isServerHotbarItemAllowed(state, cleanItemId, resolvedCategory, options)) return;

  const key = `${resolvedCategory}:${cleanItemId}`;
  for (let i = 0; i < items.length; i += 1) {
    if (`${categories[i]}:${items[i]}` === key) return;
  }

  items.push(cleanItemId);
  categories.push(resolvedCategory);
}

function normalizePlayerHotbarState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;

  const rawItems = Array.isArray(state.hotbar_items) ? state.hotbar_items : [];
  const rawCategories = Array.isArray(state.hotbar_item_categories) ? state.hotbar_item_categories : [];
  const primaryTool = sanitizePrimaryHotbarTool(state.primary_hotbar_tool || rawItems[0]);
  const items = [primaryTool];
  const categories = ["tool"];
  const savedCount = Math.min(rawItems.length, rawCategories.length, HOTBAR_SLOT_COUNT);

  for (let i = 1; i < savedCount; i += 1) {
    appendServerHotbarItem(state, items, categories, rawItems[i], rawCategories[i]);
  }

  const selectedItem = clampString(state.selected_item_type || "");
  const selectedCategory = cleanInventoryCategory(state.selected_item_category || "");
  const selectedKey = `${selectedCategory}:${selectedItem}`;
  const selectedAlreadyPinned = items.some((item, index) => `${categories[index]}:${item}` === selectedKey);
  if (selectedItem !== "punch" && !selectedAlreadyPinned && isServerHotbarItemAllowed(state, selectedItem, selectedCategory)) {
    items.splice(1, 0, selectedItem);
    categories.splice(1, 0, resolveInventoryCategory(selectedItem, selectedCategory));
  }

  while (items.length > HOTBAR_SLOT_COUNT) {
    items.pop();
    categories.pop();
  }

  state.primary_hotbar_tool = primaryTool;
  state.hotbar_items = items;
  state.hotbar_item_categories = categories;

  if (!isServerHotbarItemAllowed(state, state.selected_item_type, state.selected_item_category)) {
    state.selected_item_type = primaryTool;
    state.selected_item_category = "tool";
  }

  return state;
}

function selectFirstHotbarSlotInState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;

  normalizePlayerHotbarState(state);
  const firstItem = clampString(Array.isArray(state.hotbar_items) ? state.hotbar_items[0] || "" : "");
  const firstCategory = cleanInventoryCategory(Array.isArray(state.hotbar_item_categories) ? state.hotbar_item_categories[0] || "" : "");
  if (firstItem !== "" && firstCategory !== "") {
    state.selected_item_type = firstItem;
    state.selected_item_category = firstCategory;
  }
  return state;
}

function buildPlayerStateForClient(state, options = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};

  const payload = {
    ...state,
    hotbar_items: Array.isArray(state.hotbar_items) ? state.hotbar_items.slice(0, HOTBAR_SLOT_COUNT) : [],
    hotbar_item_categories: Array.isArray(state.hotbar_item_categories) ? state.hotbar_item_categories.slice(0, HOTBAR_SLOT_COUNT) : [],
  };

  normalizePlayerHotbarState(payload);
  if (options.selectFirstHotbarSlot === true) {
    selectFirstHotbarSlotInState(payload);
  }
  return payload;
}

function createDefaultPlayerState(username) {
  const state = sanitizePlayerState({
    account_username: username,
    inventory: {},
    seed_inventory: {},
    tool_inventory: {},
    back_inventory: {},
    hair_inventory: {},
    shirt_inventory: {},
    pants_inventory: {},
    shoes_inventory: {},
    currency_inventory: {},
    material_inventory: {},
    lure_inventory: {},
    fish_inventory: {},
  }, username);

  return state;
}

function mergeClientPlayerStateIntoServerState(username, incomingState, options = {}) {
  const serverState = ensureWritablePlayerState(username) || createDefaultPlayerState(username);
  if (!serverState || !incomingState) return null;

  const merged = {
    ...serverState,
    player_data_version: Math.max(1, Math.trunc(Number(incomingState.player_data_version) || 1)),
    account_username: cleanAccountName(username),
    selected_item_type: clampString(incomingState.selected_item_type || "punch"),
    selected_item_category: cleanInventoryCategory(incomingState.selected_item_category || "tool") || "tool",
    primary_hotbar_tool: clampString(incomingState.primary_hotbar_tool || "punch"),
    hotbar_items: sanitizeStringArray(incomingState.hotbar_items, 16),
    hotbar_item_categories: sanitizeStringArray(incomingState.hotbar_item_categories, 16),
    player_health: clampInteger(incomingState.player_health || serverState.player_health || 3, 0, 100),
    saved_at: new Date().toISOString(),
  };

  merged.equipped_tool = doesStateOwnEquippedItem(merged, incomingState.equipped_tool || "", "hand")
    ? clampString(incomingState.equipped_tool || "")
    : "";
  merged.equipped_back_item = doesStateOwnEquippedItem(merged, incomingState.equipped_back_item || "", "back")
    ? clampString(incomingState.equipped_back_item || "")
    : "";
  merged.equipped_hair_item = doesStateOwnEquippedItem(merged, incomingState.equipped_hair_item || "", "hair")
    ? clampString(incomingState.equipped_hair_item || "")
    : "";
  merged.equipped_shirt_item = doesStateOwnEquippedItem(merged, incomingState.equipped_shirt_item || "", "shirt")
    ? clampString(incomingState.equipped_shirt_item || "")
    : "";
  merged.equipped_pants_item = doesStateOwnEquippedItem(merged, incomingState.equipped_pants_item || "", "pants")
    ? clampString(incomingState.equipped_pants_item || "")
    : "";
  merged.equipped_shoes_item = doesStateOwnEquippedItem(merged, incomingState.equipped_shoes_item || "", "shoes")
    ? clampString(incomingState.equipped_shoes_item || "")
    : "";

  const requestedLegacyImportRevision = clampInteger(options.legacyImportRevision || 0, 0, 1000);
  const currentLegacyImportRevision = clampInteger(serverState.legacy_client_inventory_import_revision || 0, 0, 1000);
  const didLegacyImport = (
    ALLOW_LEGACY_PLAYER_STATE_IMPORT &&
    Boolean(options.legacyImportRequested) &&
    requestedLegacyImportRevision > currentLegacyImportRevision
  );

  if (didLegacyImport) {
    mergeLegacyClientInventoriesIntoServerState(merged, incomingState);
    merged.legacy_client_inventory_imported_at = new Date().toISOString();
    merged.legacy_client_inventory_import_revision = requestedLegacyImportRevision;
  } else if (serverState.legacy_client_inventory_imported_at) {
    merged.legacy_client_inventory_imported_at = serverState.legacy_client_inventory_imported_at;
    merged.legacy_client_inventory_import_revision = currentLegacyImportRevision;
  }

  if (didLegacyImport) {
    merged.equipped_tool = doesStateOwnEquippedItem(merged, incomingState.equipped_tool || "", "hand")
      ? clampString(incomingState.equipped_tool || "")
      : merged.equipped_tool;
    merged.equipped_back_item = doesStateOwnEquippedItem(merged, incomingState.equipped_back_item || "", "back")
      ? clampString(incomingState.equipped_back_item || "")
      : merged.equipped_back_item;
    merged.equipped_hair_item = doesStateOwnEquippedItem(merged, incomingState.equipped_hair_item || "", "hair")
      ? clampString(incomingState.equipped_hair_item || "")
      : merged.equipped_hair_item;
    merged.equipped_shirt_item = doesStateOwnEquippedItem(merged, incomingState.equipped_shirt_item || "", "shirt")
      ? clampString(incomingState.equipped_shirt_item || "")
      : merged.equipped_shirt_item;
    merged.equipped_pants_item = doesStateOwnEquippedItem(merged, incomingState.equipped_pants_item || "", "pants")
      ? clampString(incomingState.equipped_pants_item || "")
      : merged.equipped_pants_item;
    merged.equipped_shoes_item = doesStateOwnEquippedItem(merged, incomingState.equipped_shoes_item || "", "shoes")
      ? clampString(incomingState.equipped_shoes_item || "")
      : merged.equipped_shoes_item;
  }

  normalizePlayerHotbarState(merged);
  return merged;
}

function mergeLegacyClientInventoriesIntoServerState(serverState, incomingState) {
  for (const field of Object.values(ItemDatabase.CATEGORY_TO_FIELD)) {
    const serverInventory = serverState[field] && typeof serverState[field] === "object" && !Array.isArray(serverState[field])
      ? serverState[field]
      : {};
    const incomingInventory = incomingState[field] && typeof incomingState[field] === "object" && !Array.isArray(incomingState[field])
      ? incomingState[field]
      : {};

    for (const [itemId, incomingCountRaw] of Object.entries(incomingInventory)) {
      if (!ItemDatabase.hasItem(itemId)) continue;

      const category = ItemDatabase.FIELD_TO_CATEGORY[field] || resolveInventoryCategory(itemId);
      if (!ItemDatabase.canStoreItemInCategory(itemId, category)) continue;

      const incomingCount = clampInteger(incomingCountRaw || 0, 0, ItemDatabase.getStackLimit(itemId));
      const serverCount = clampInteger(serverInventory[itemId] || 0, 0, ItemDatabase.getStackLimit(itemId));
      serverInventory[itemId] = Math.max(serverCount, incomingCount);
    }

    serverState[field] = serverInventory;
  }
}

function getInventoryCount(state, itemId, itemCategory) {
  if (!state) return 0;
  const cleanItemId = clampString(itemId || "");
  if (!ItemDatabase.hasItem(cleanItemId)) return 0;

  const resolvedCategory = resolveInventoryCategory(cleanItemId, itemCategory);
  const inventoryField = getInventoryFieldForCategory(resolvedCategory, cleanItemId);
  const inventory = state[inventoryField];
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) return 0;
  return clampInteger(inventory[cleanItemId] || 0, 0, ItemDatabase.getStackLimit(cleanItemId));
}

function canAddItemToState(state, itemId, itemCategory, amount) {
  if (!state) return false;
  const cleanItemId = clampString(itemId || "");
  if (cleanItemId === "" || !ItemDatabase.hasItem(cleanItemId)) return false;

  const resolvedCategory = resolveInventoryCategory(cleanItemId, itemCategory);
  if (!ItemDatabase.canStoreItemInCategory(cleanItemId, resolvedCategory)) return false;

  const stackLimit = ItemDatabase.getStackLimit(cleanItemId);
  const safeAmount = clampInteger(amount || 0, 0, stackLimit);
  return getInventoryCount(state, cleanItemId, resolvedCategory) + safeAmount <= stackLimit;
}

function addItemToState(state, itemId, itemCategory, amount) {
  if (!state) return null;

  const cleanItemId = clampString(itemId || "");
  if (cleanItemId === "") return null;
  if (!ItemDatabase.hasItem(cleanItemId)) return null;

  const resolvedCategory = resolveInventoryCategory(cleanItemId, itemCategory);
  if (!ItemDatabase.canStoreItemInCategory(cleanItemId, resolvedCategory)) return null;

  const inventoryField = getInventoryFieldForCategory(resolvedCategory, cleanItemId);
  if (!state[inventoryField] || typeof state[inventoryField] !== "object" || Array.isArray(state[inventoryField])) {
    state[inventoryField] = {};
  }

  const stackLimit = ItemDatabase.getStackLimit(cleanItemId);
  const currentCount = clampInteger(state[inventoryField][cleanItemId] || 0, 0, stackLimit);
  const safeAmount = clampInteger(amount || 0, 0, stackLimit);
  state[inventoryField][cleanItemId] = clampInteger(currentCount + safeAmount, 0, stackLimit);

  return {
    inventoryField,
    count: state[inventoryField][cleanItemId],
    itemCategory: resolvedCategory,
  };
}

function spendItemFromState(state, itemId, itemCategory, amount) {
  if (!state) return false;

  const cleanItemId = clampString(itemId || "");
  if (cleanItemId === "") return false;
  if (!ItemDatabase.hasItem(cleanItemId)) return false;

  const resolvedCategory = resolveInventoryCategory(cleanItemId, itemCategory);
  if (!ItemDatabase.canStoreItemInCategory(cleanItemId, resolvedCategory)) return false;

  const inventoryField = getInventoryFieldForCategory(resolvedCategory, cleanItemId);
  if (!state[inventoryField] || typeof state[inventoryField] !== "object" || Array.isArray(state[inventoryField])) {
    state[inventoryField] = {};
  }

  const currentCount = getInventoryCount(state, cleanItemId, resolvedCategory);
  const safeAmount = clampInteger(amount || 0, 0, ItemDatabase.getStackLimit(cleanItemId));
  if (currentCount < safeAmount) return false;

  state[inventoryField][cleanItemId] = currentCount - safeAmount;
  return true;
}

function getCraftingCostItemIds(itemId, itemCategory) {
  const cleanItemId = clampString(itemId || "");
  const cleanCategory = cleanInventoryCategory(itemCategory || "");
  const ids = [cleanItemId];
  if (cleanCategory !== "tool") return ids;

  if (cleanItemId === "bamboo_rod") ids.push("fishing_rod");
  if (cleanItemId === "pristine_tungsten_rod") ids.push("platinum_prestige_rod");
  return ids.filter((id, index) => id !== "" && ids.indexOf(id) === index);
}

function getCraftingCostInventoryCount(state, itemId, itemCategory) {
  let total = 0;
  for (const candidateId of getCraftingCostItemIds(itemId, itemCategory)) {
    total += getInventoryCount(state, candidateId, itemCategory);
  }
  return total;
}

function spendCraftingCostFromState(state, itemId, itemCategory, amount) {
  let remaining = clampInteger(amount || 0, 0, ItemDatabase.getStackLimit(itemId));
  if (remaining <= 0) return true;

  for (const candidateId of getCraftingCostItemIds(itemId, itemCategory)) {
    const available = getInventoryCount(state, candidateId, itemCategory);
    if (available <= 0) continue;

    const spendAmount = Math.min(available, remaining);
    if (!spendItemFromState(state, candidateId, itemCategory, spendAmount)) return false;
    remaining -= spendAmount;
    if (remaining <= 0) return true;
  }

  return false;
}

function setInventoryCountInState(state, itemId, itemCategory, amount) {
  if (!state) return false;

  const cleanItemId = clampString(itemId || "");
  if (cleanItemId === "" || !ItemDatabase.hasItem(cleanItemId)) return false;

  const resolvedCategory = resolveInventoryCategory(cleanItemId, itemCategory || "block");
  if (!ItemDatabase.canStoreItemInCategory(cleanItemId, resolvedCategory)) return false;

  const inventoryField = getInventoryFieldForCategory(resolvedCategory, cleanItemId);
  if (!state[inventoryField] || typeof state[inventoryField] !== "object" || Array.isArray(state[inventoryField])) {
    state[inventoryField] = {};
  }

  const stackLimit = ItemDatabase.getStackLimit(cleanItemId);
  const requestedRaw = Number(amount);
  if (!Number.isFinite(requestedRaw)) return false;
  if (!Number.isInteger(requestedRaw)) return false;
  const requestedAmount = Math.trunc(requestedRaw);
  if (requestedAmount < 0 || requestedAmount > stackLimit) return false;

  state[inventoryField][cleanItemId] = requestedAmount;
  return {
    inventoryField,
    itemId: cleanItemId,
    itemCategory: resolvedCategory,
    count: requestedAmount,
  };
}

function applyInventoryLedgerToState(state, ledgerEntries) {
  if (!state) return false;
  if (!Array.isArray(ledgerEntries) || ledgerEntries.length === 0) return true;

  const stagedState = cloneJson(state);
  if (!stagedState || typeof stagedState !== "object" || Array.isArray(stagedState)) return false;

  for (const entry of ledgerEntries) {
    const cleanItemId = clampString(entry?.item_type || "");
    if (cleanItemId === "" || !ItemDatabase.hasItem(cleanItemId)) return false;

    const itemCategory = entry?.item_category || "block";
    const afterAmount = Number(entry?.after_amount);
    if (!Number.isFinite(afterAmount) || !Number.isInteger(afterAmount)) return false;

    if (!setInventoryCountInState(stagedState, cleanItemId, itemCategory, afterAmount)) {
      return false;
    }
  }

  Object.assign(state, stagedState);
  state.saved_at = new Date().toISOString();
  return true;
}

function buildInventoryBaselineForItems(state, items) {
  if (!state || !Array.isArray(items)) return [];

  const baseline = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const itemId = clampString(item.item_id || item.item_type || "");
    if (itemId === "" || !ItemDatabase.hasItem(itemId)) continue;

    const itemCategory = resolveInventoryCategory(itemId, item.item_category || item.category || "");
    if (!ItemDatabase.canStoreItemInCategory(itemId, itemCategory)) continue;

    const key = `${itemId}\u0000${itemCategory}`;
    if (baseline.has(key)) continue;

    baseline.set(key, {
      item_id: itemId,
      item_category: itemCategory,
      amount: getInventoryCount(state, itemId, itemCategory),
      stack_limit: ItemDatabase.getStackLimit(itemId),
    });
  }

  return Array.from(baseline.values());
}

function ensureWritablePlayerState(username) {
  const clean = cleanAccountName(username);
  if (clean === "") return null;

  let state = ensurePlayerState(clean);
  if (!state) {
    state = createDefaultPlayerState(clean);
    setPlayerState(clean, state);
  }

  return state;
}

function applyItemInstanceInventoryEffectsToPlayerStates(effects) {
  const rows = Array.isArray(effects) ? effects : [];
  const updated = [];

  for (const effect of rows) {
    if (!effect || effect.ok === false) continue;
    const username = cleanAccountName(effect.username || "");
    const itemType = clampString(effect.item_type || "");
    const itemCategory = resolveInventoryCategory(itemType, effect.item_category || "");
    if (username === "" || itemType === "") continue;

    const state = ensureWritablePlayerState(username);
    if (!state) continue;

    const applied = setInventoryCountInState(state, itemType, itemCategory, clampInteger(effect.after_amount || 0, 0, ItemDatabase.getStackLimit(itemType)));
    if (!applied) continue;

    persistPlayerInventoryChange(username, state, { postgresCommitted: true });
    const target = findOnlinePlayerByUsername(username);
    if (target) {
      sendPlayerState(target.socket, target.player.account_username);
    }

    updated.push({
      username,
      item_type: itemType,
      item_category: itemCategory,
      delta: clampInteger(effect.delta || 0, -ItemDatabase.getStackLimit(itemType), ItemDatabase.getStackLimit(itemType)),
      before_amount: clampInteger(effect.before_amount || 0, 0, ItemDatabase.getStackLimit(itemType)),
      after_amount: clampInteger(effect.after_amount || 0, 0, ItemDatabase.getStackLimit(itemType)),
      online: Boolean(target),
    });
  }

  return updated;
}

function doesAccountExist(username) {
  const clean = cleanAccountName(username);
  if (clean === "") return false;
  return accounts.has(accountKey(clean)) || (!isPostgresAuthoritativeReady() && fs.existsSync(getPlayerSavePath(clean)));
}

function markAccountSeen(username) {
  const clean = cleanAccountName(username);
  if (clean === "") return;

  const account = accounts.get(accountKey(clean));
  if (!account) return;

  account.last_seen_at = new Date().toISOString();
  queueAccountsSave();
  postgresStore.mirrorAccount(account, { touchLogin: false });
}

function buildAdminInventoryLookupPlayerData(username, state) {
  const clean = cleanAccountName(username);
  const source = state && typeof state === "object" && !Array.isArray(state)
    ? state
    : createDefaultPlayerState(clean);
  if (!source) return {};

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
    equipped_hair_item: clampString(source.equipped_hair_item || ""),
    equipped_shirt_item: clampString(source.equipped_shirt_item || ""),
    equipped_pants_item: clampString(source.equipped_pants_item || ""),
    equipped_shoes_item: clampString(source.equipped_shoes_item || ""),
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
    if (!player || !player.authenticated) continue;
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
    if (worldCompare !== 0) return worldCompare;
    return String(a.username || "").localeCompare(String(b.username || ""));
  });
  return rows.slice(0, cappedLimit);
}

function buildAdminMonitoringWorldRows(limit = 100) {
  const worldRows = [];
  const playerCounts = new Map();
  for (const player of players.values()) {
    if (!player || !player.authenticated) continue;
    const worldName = cleanWorld(player.world || player.current_world || "");
    if (worldName === "") continue;
    playerCounts.set(worldName, (playerCounts.get(worldName) || 0) + 1);
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
    if (playerCompare !== 0) return playerCompare;
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
    authenticated_player_count: Array.from(players.values()).filter((player) => player?.authenticated).length,
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
    world_snapshot_scheduler: {
      enabled: Boolean(worldSnapshotSchedulerState.enabled),
      interval_minutes: WORLD_SNAPSHOT_INTERVAL_MINUTES,
      max_worlds_per_cycle: WORLD_SNAPSHOT_MAX_WORLDS_PER_CYCLE,
      running: Boolean(worldSnapshotSchedulerRunning),
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
    const reconcileResult = await withTimeout(
      postgresStore.reconcileItemInstancesForUsername(displayUsername, state, {
        source: "admin_item_instance_lookup",
        request_id: requestId,
        actor_username: player.account_username || player.name || "",
      }),
      ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS,
      "admin item instance reconcile"
    );
    const itemInstances = await withTimeout(
      postgresStore.listActiveItemInstances(displayUsername, { limit: rawLimit }),
      ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS,
      "admin item instance list"
    );
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
  } catch (error) {
    const message = `Item instance lookup failed: ${error.message}`;
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
      error: error.message,
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
    const history = await withTimeout(
      postgresStore.getItemInstanceHistory(itemInstanceId, { limit: 50 }),
      ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS,
      "admin item instance history"
    );

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
  } catch (error) {
    const message = `Item instance history lookup failed: ${error.message}`;
    console.warn("[admin_item_instance_history_lookup] failed", {
      item_instance_id: itemInstanceId,
      request_id: requestId,
      message,
    });
    logAdminAction(socket, player, "admin_item_instance_history_lookup", {
      ...logBase,
      error: error.message,
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
    const result = await withTimeout(
      postgresStore.listTransactionLedger({
        username: displayUsername,
        public_item_instance_id: itemInstanceId,
        item_type: itemType,
        transaction_type: transactionType,
        status,
        limit: rawLimit,
      }),
      ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS,
      "admin transaction ledger lookup"
    );

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
  } catch (error) {
    const message = `Transaction ledger lookup failed: ${error.message}`;
    console.warn("[admin_transaction_ledger_lookup] failed", {
      target: displayUsername,
      item_instance_id: itemInstanceId,
      request_id: requestId,
      message,
    });
    logAdminAction(socket, player, "admin_transaction_ledger_lookup", {
      ...logBase,
      target_username: displayUsername,
      error: error.message,
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
    const postgresDashboard = await withTimeout(
      postgresStore.getAdminMonitoringDashboard({
        window_hours: windowHours,
        limit: rawLimit,
        dupe_limit: Math.min(rawLimit, 20),
      }),
      ADMIN_ITEM_INSTANCE_LOOKUP_TIMEOUT_MS,
      "admin monitoring dashboard"
    );

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
  } catch (error) {
    const message = `Monitoring dashboard failed: ${error.message}`;
    console.warn("[admin_monitoring_dashboard] failed", {
      request_id: requestId,
      message,
    });
    logAdminAction(socket, player, "admin_monitoring_dashboard", {
      ...logBase,
      error: error.message,
    }, false, message);
    sendAdminMonitoringDashboardFailure(socket, requestId, targetUsername, message);
  }
}

function buildPublicPlayerData(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  const progression = normalizeProgressionState(state);

  return {
    player_data_version: Math.max(1, Math.trunc(Number(state.player_data_version) || 1)),
    account_username: cleanAccountName(state.account_username || state.username || ""),
    player_level: progression.player_level,
    player_xp: progression.player_xp,
    player_xp_needed: progression.player_xp_needed,
    player_total_xp: progression.player_total_xp,
    player_title: progression.player_title,
  };
}

function buildPublicPlayerProfilePayload(username, requestId = "", purpose = "") {
  const clean = cleanAccountName(username);
  const key = accountKey(clean);
  const account = accounts.get(key) || null;
  const state = ensurePlayerState(clean);
  const found = clean !== "" && (Boolean(account) || Boolean(state) || (!isPostgresAuthoritativeReady() && fs.existsSync(getPlayerSavePath(clean))));
  const onlineEntry = findOnlinePlayerByUsername(clean);
  const onlinePlayer = onlineEntry ? onlineEntry.player : null;
  const publicData = buildPublicPlayerData(state);
  const displayUsername = account?.username || publicData.account_username || clean;

  return {
    type: "player_state",
    ok: found,
    found,
    request_id: requestId,
    purpose,
    username: displayUsername,
    name: displayUsername,
    online: Boolean(onlinePlayer),
    offline: !onlinePlayer,
    player_id: onlinePlayer?.id || "",
    world: onlinePlayer?.world || "",
    current_world: onlinePlayer?.world || "",
    role: onlinePlayer ? getPublicPlayerRole(onlinePlayer) : getAccountRole(displayUsername),
    last_seen_at: account ? String(account.last_seen_at || "") : "",
    account: found ? {
      username: displayUsername,
      role: getAccountRole(displayUsername),
      last_seen_at: account ? String(account.last_seen_at || "") : "",
    } : {},
    player_data: publicData,
    message: found ? (onlinePlayer ? "Player is online." : "Player is offline.") : "Player not found.",
  };
}

function grantItemToPlayerState(username, itemId, itemCategory, amount) {
  const state = ensureWritablePlayerState(username);
  if (!state) return null;

  const grant = addItemToState(state, itemId, itemCategory, amount);
  if (!grant) return null;

  state.saved_at = new Date().toISOString();
  setPlayerState(username, state);
  queuePlayerSave(username);

  return grant;
}

function removeItemFromPlayerState(username, itemId, itemCategory, amount) {
  const state = ensureWritablePlayerState(username);
  if (!state) return null;

  const cleanItemId = clampString(itemId || "");
  const resolvedCategory = resolveInventoryCategory(cleanItemId, itemCategory);
  const available = getInventoryCount(state, cleanItemId, resolvedCategory);
  const requested = clampInteger(amount || 0, 1, MAX_ITEM_STACK);
  const removeAmount = Math.min(available, requested);
  const inventoryField = getInventoryFieldForCategory(resolvedCategory, cleanItemId);

  if (removeAmount <= 0) {
    return {
      removed: 0,
      requested,
      available,
      itemCategory: resolvedCategory,
      inventoryField,
      count: available,
    };
  }

  if (!spendItemFromState(state, cleanItemId, resolvedCategory, removeAmount)) {
    return null;
  }

  state.saved_at = new Date().toISOString();
  setPlayerState(username, state);
  queuePlayerSave(username);

  return {
    removed: removeAmount,
    requested,
    available,
    itemCategory: resolvedCategory,
    inventoryField,
    count: getInventoryCount(state, cleanItemId, resolvedCategory),
  };
}

function getSocketByPlayerId(playerId) {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client.playerId === playerId) return client;
  }

  return null;
}

function findOnlinePlayerByUsername(username) {
  const key = accountKey(username);
  if (key === "") return null;

  for (const player of players.values()) {
    if (!player.authenticated) continue;
    if (accountKey(player.account_username) !== key) continue;

    const socket = getSocketByPlayerId(player.id);
    if (!socket) continue;

    return { player, socket };
  }

  return null;
}

function handlePullPlayerRequest(socket, player, data) {
  if (!requireAuthenticated(socket, player, "pull players")) return;

  const requestId = makeRequestId(data);
  const worldName = getPlayerCurrentWorldName(player);
  const requestedWorldName = cleanWorld(data.world || worldName);
  if (!requireSameWorld(socket, player, requestedWorldName, "pull_player_request")) return;

  const targetUsername = cleanAccountName(data.target_username || data.username || data.name || "").slice(0, MAX_USERNAME_LENGTH);
  if (targetUsername === "") {
    sendActionRejected(socket, "pull_player_request", "Use: /pull username", { request_id: requestId });
    return;
  }

  const permission = getWorldLockPullPermission(player, worldName);
  if (!permission.ok) {
    sendActionRejected(socket, "pull_player_request", "Only the world owner or world admins can use /pull.", {
      request_id: requestId,
      target_username: targetUsername,
    });
    return;
  }

  const target = findOnlinePlayerByUsername(targetUsername);
  if (!target || !target.player.joined_world || getPlayerCurrentWorldName(target.player) !== worldName) {
    sendActionRejected(socket, "pull_player_request", `${targetUsername} is not in this world.`, {
      request_id: requestId,
      target_username: targetUsername,
    });
    return;
  }

  if (permission.role === "admin" && isWorldLockOwnerAccount(permission.lock, target.player.account_username)) {
    sendActionRejected(socket, "pull_player_request", "World admins cannot pull the world owner.", {
      request_id: requestId,
      target_username: targetUsername,
    });
    return;
  }

  const pullX = Number(player.x);
  const pullY = Number(player.y);
  if (!isPositionInWorldBounds(pullX, pullY)) {
    sendActionRejected(socket, "pull_player_request", "Your position is not ready yet.", {
      request_id: requestId,
      target_username: targetUsername,
    });
    return;
  }

  target.player.x = pullX;
  target.player.y = pullY;
  target.player.last_position_at = Date.now();

  const targetName = cleanAccountName(target.player.account_username || target.player.name || targetUsername);
  const pullerName = cleanAccountName(player.account_username || player.name || "Player");
  const positionPayload = buildPublicPlayerPresencePayload("player_position", target.player, worldName);

  sendJson(target.socket, {
    type: "player_pulled",
    request_id: requestId,
    player_id: target.player.id,
    name: targetName,
    username: targetName,
    pulled_by: pullerName,
    x: target.player.x,
    y: target.player.y,
    facing: target.player.facing,
    world: worldName,
    message: `${pullerName} pulled you.`,
  });

  broadcastToWorld(worldName, positionPayload, target.player.id);
  sendJson(socket, {
    type: "pull_player_result",
    ok: true,
    request_id: requestId,
    target_username: targetName,
    world: worldName,
    x: target.player.x,
    y: target.player.y,
    message: `Pulled ${targetName}.`,
  });

  touchLivePresence(target.socket, target.player, { force: true });
  touchLivePresence(socket, player, { force: true });
}

function handleDeveloperPinUnlock(socket, player, data) {
  if (!requireAuthenticated(socket, player, "unlock developer tools")) return;

  const requestId = makeRequestId(data);
  if (!isAdmin(player)) {
    logAdminAction(socket, player, "developer_pin_unlock", { request_id: requestId }, false, "Developer PIN is only for admins.");
    sendJson(socket, {
      type: "developer_pin_unlock_result",
      ok: false,
      request_id: requestId,
      message: "Developer PIN is only for admins.",
      developer_pin_required: DEV_PIN_REQUIRED,
      developer_pin_unlocked: false,
    });
    return;
  }

  if (!DEV_PIN_REQUIRED) {
    player.developer_pin_unlocked_until = Date.now() + DEV_PIN_UNLOCK_TTL_MS;
  } else {
    if (!verifyDeveloperPin(data.pin)) {
      logAdminAction(socket, player, "developer_pin_unlock", { request_id: requestId }, false, "Invalid developer PIN.");
      sendJson(socket, {
        type: "developer_pin_unlock_result",
        ok: false,
        request_id: requestId,
        message: "Invalid developer PIN.",
        developer_pin_required: true,
        developer_pin_unlocked: false,
      });
      return;
    }

    player.developer_pin_unlocked_until = Date.now() + DEV_PIN_UNLOCK_TTL_MS;
  }

  const twoFactor = verifyAdminTwoFactorCode(player.account_username, data.totp_code || data.two_factor_code || data.admin_2fa_code || data.code || "");
  if (!twoFactor.ok) {
    player.admin_2fa_verified_until = 0;
    logAdminAction(socket, player, "admin_2fa_unlock", {
      request_id: requestId,
      pin_required: DEV_PIN_REQUIRED,
      admin_2fa_required: ADMIN_2FA_REQUIRED,
      reason: twoFactor.reason || "invalid_2fa",
    }, false, twoFactor.reason === "admin_2fa_not_configured" ? "Admin 2FA is required but not configured." : "Invalid admin 2FA code.");
    logSecurityEvent(socket, player, "admin_2fa_unlock_failed", {
      request_id: requestId,
      reason: twoFactor.reason || "invalid_2fa",
      admin_2fa_required: ADMIN_2FA_REQUIRED,
    }, "warning");
    sendJson(socket, {
      type: "developer_pin_unlock_result",
      ok: false,
      request_id: requestId,
      message: twoFactor.reason === "admin_2fa_not_configured" ? "Admin 2FA is required but not configured on the server." : "Admin 2FA required.",
      developer_pin_required: DEV_PIN_REQUIRED,
      developer_pin_unlocked: true,
      admin_2fa_required: ADMIN_2FA_REQUIRED,
      admin_2fa_verified: false,
      requires_admin_2fa: ADMIN_2FA_REQUIRED,
    });
    return;
  }

  player.admin_2fa_verified_until = ADMIN_2FA_REQUIRED ? Date.now() + ADMIN_2FA_UNLOCK_TTL_MS : 0;
  logAdminAction(socket, player, "developer_pin_unlock", {
    request_id: requestId,
    pin_required: DEV_PIN_REQUIRED,
    admin_2fa_required: ADMIN_2FA_REQUIRED,
    admin_2fa_verified: isAdminTwoFactorVerified(player),
  }, true, DEV_PIN_REQUIRED ? "Developer PIN unlocked." : "Developer PIN not required.");
  if (ADMIN_2FA_REQUIRED) {
    logAdminAction(socket, player, "admin_2fa_unlock", {
      request_id: requestId,
      admin_2fa_required: true,
      verified_until: new Date(player.admin_2fa_verified_until).toISOString(),
    }, true, "Admin 2FA verified.");
  }
  sendJson(socket, {
    type: "developer_pin_unlock_result",
    ok: true,
    request_id: requestId,
    message: "Developer panel unlocked.",
    developer_pin_required: DEV_PIN_REQUIRED,
    developer_pin_unlocked: true,
    unlocked_until: new Date(player.developer_pin_unlocked_until).toISOString(),
    admin_2fa_required: ADMIN_2FA_REQUIRED,
    admin_2fa_verified: isAdminTwoFactorVerified(player),
    admin_2fa_verified_until: player.admin_2fa_verified_until ? new Date(player.admin_2fa_verified_until).toISOString() : "",
  });
}

async function handleDeveloperCommandRequest(socket, player, data) {
  try {
    await handleDeveloperCommandRequestUnsafe(socket, player, data);
  } catch (error) {
    const safeData = data && typeof data === "object" ? data : {};
    const requestId = makeRequestId(safeData);
    const command = String(safeData.command || "").trim();
    const commandName = getDeveloperCommandName(command);
    const details = {
      request_id: requestId,
      command,
      command_name: commandName,
      world: cleanWorld(safeData.world || player?.world || "START"),
      error: errorToCrashDetails(error),
      runtime: getCrashRuntimeState(),
    };
    writeCrashReport("developer_command_exception", details);
    console.warn("[developer_command_exception]", error && error.stack ? error.stack : error);
    try {
      logSecurityEvent(socket, player, "developer_command_exception", {
        request_id: requestId,
        command,
        command_name: commandName,
        message: String(error?.message || error || "unknown"),
      }, "error");
    } catch (logError) {
      console.warn("[developer_command_exception_log_failed]", logError && logError.message ? logError.message : logError);
    }
    sendDeveloperDenied(socket, requestId, command, "Developer command failed safely. Check crash_reports.log for details.", {
      reason: "exception",
      command_name: commandName,
    });
  }
}

async function handleDeveloperCommandRequestUnsafe(socket, player, data) {
  if (!requireAuthenticated(socket, player, "use admin commands")) return;

  const requestId = makeRequestId(data);
  const command = String(data.command || "").trim();
  if (command === "") return;

  const commandName = getDeveloperCommandName(command);
  const commandLogBase = {
    request_id: requestId,
    command,
    command_name: commandName,
    world: cleanWorld(data.world || player.world || "START"),
  };

  const deny = (message, details = {}, extra = {}) => {
    logAdminAction(socket, player, "developer_command_denied", { ...commandLogBase, ...details }, false, message);
    logSecurityEvent(socket, player, "developer_command_denied", { ...commandLogBase, ...details, message }, "warning");
    sendDeveloperDenied(socket, requestId, command, message, extra);
  };

  const approve = (message, details = {}, extra = {}) => {
    logAdminAction(socket, player, `developer_${commandName || "command"}`, { ...commandLogBase, ...details }, true, message);
    sendDeveloperApproved(socket, requestId, command, message, extra);
  };

  if (!isAdmin(player)) {
    deny("Developer commands are only available to admins.");
    return;
  }

  const securityRequirement = getDeveloperSecurityRequirement(player);
  if (!securityRequirement.ok) {
    deny(securityRequirement.message, { reason: securityRequirement.reason }, securityRequirement.extra);
    return;
  }

  if (!validateAdminCommandConfirmation(socket, player, data, commandName, command, deny)) {
    return;
  }

  const commandCooldown = consumeAdminCommandCooldown(player, commandName);
  if (!commandCooldown.ok) {
    deny(`Admin command is cooling down. Try again in ${Math.ceil(commandCooldown.retry_ms / 1000)}s.`, {
      reason: "admin_command_cooldown",
      retry_ms: commandCooldown.retry_ms,
    }, {
      retry_ms: commandCooldown.retry_ms,
      retry_after_seconds: Math.ceil(commandCooldown.retry_ms / 1000),
    });
    return;
  }

  if (commandName === "clear") {
    const commandWorld = getDeveloperCommandWorldName(player, data);
    const result = clearWorldByAdmin(commandWorld, data, socket, player);
    approve(
      `Server cleared ${commandWorld}. Removed ${result.removedCount} saved objects and preserved ${result.protectedCount} protected blocks.`,
      {
        target_world: commandWorld,
        affected_world: commandWorld,
        removed_count: result.removedCount,
        protected_count: result.protectedCount,
        snapshot_id: result.snapshotId,
        before_world: result.beforeSummary,
        after_world: result.afterSummary,
        reason: "developer_command",
      },
      { command_type: "clear_world", target_world: commandWorld, removed_count: result.removedCount, protected_count: result.protectedCount }
    );
    return;
  }

  if (commandName === "resetworld" || commandName === "reset_world" || commandName === "reworld") {
    const commandWorld = getDeveloperCommandWorldName(player, data);
    const result = resetWorldByAdmin(commandWorld, socket, player);
    approve(`Server reset ${commandWorld}.`, {
      target_world: commandWorld,
      affected_world: commandWorld,
      snapshot_id: result.snapshotId,
      before_world: result.beforeSummary,
      after_world: result.afterSummary,
      reason: "developer_command",
    }, { command_type: "reset_world", target_world: commandWorld });
    return;
  }

  if (commandName === "snapshot" || commandName === "snapshot_world") {
    const commandWorld = getDeveloperCommandWorldName(player, data);
    const snapshot = createWorldSnapshot(commandWorld, "manual_admin_snapshot", socket, player, {
      command,
      request_id: requestId,
    });
    if (!snapshot) {
      deny("Could not create world snapshot.", { target_world: commandWorld });
      return;
    }
    approve(
      `Server snapshot created for ${commandWorld}.`,
      {
        target_world: commandWorld,
        affected_world: commandWorld,
        snapshot_id: snapshot.snapshotId,
        snapshot_path: snapshot.snapshotPath,
        reason: "developer_command",
      },
      { command_type: "snapshot_world", target_world: commandWorld, snapshot_id: snapshot.snapshotId, snapshot_path: snapshot.snapshotPath }
    );
    return;
  }

  const punishmentCommand = parsePunishmentCommand(data, command, player);
  if (punishmentCommand) {
    await handleDeveloperPunishmentCommand(socket, player, data, command, punishmentCommand, approve, deny);
    return;
  }

  const itemInstanceAdminCommand = parseItemInstanceAdminCommand(data, command);
  if (itemInstanceAdminCommand) {
    await handleDeveloperItemInstanceAdminCommand(socket, player, data, command, itemInstanceAdminCommand, approve, deny);
    return;
  }

  const giveCommand = parseGiveCommand(data, command);
  if (giveCommand) {
    if (!ItemDatabase.hasItem(giveCommand.itemId)) {
      deny("That item does not exist on the server.", { target_username: giveCommand.targetUsername, item_id: giveCommand.itemId, amount: giveCommand.amount });
      return;
    }

    if (!ItemDatabase.isGrantableItem(giveCommand.itemId)) {
      deny("That item cannot be granted directly.", { target_username: giveCommand.targetUsername, item_id: giveCommand.itemId, amount: giveCommand.amount });
      return;
    }

    if (!ItemDatabase.canStoreItemInCategory(giveCommand.itemId, giveCommand.itemCategory)) {
      deny("That item category does not match the server database.", { target_username: giveCommand.targetUsername, item_id: giveCommand.itemId, item_category: giveCommand.itemCategory, amount: giveCommand.amount });
      return;
    }

    if (!doesAccountExist(giveCommand.targetUsername)) {
      deny("Target account does not exist.", { target_username: giveCommand.targetUsername, item_id: giveCommand.itemId, amount: giveCommand.amount });
      return;
    }

    const targetBeforeState = ensureWritablePlayerState(giveCommand.targetUsername);
    if (!targetBeforeState) {
      deny("Could not load target inventory.", { target_username: giveCommand.targetUsername, item_id: giveCommand.itemId, item_category: giveCommand.itemCategory, amount: giveCommand.amount });
      return;
    }

    const targetStagedState = cloneJson(targetBeforeState);
    const grant = addItemToState(
      targetStagedState,
      giveCommand.itemId,
      giveCommand.itemCategory,
      giveCommand.amount
    );
    if (!grant) {
      deny("Could not stage target inventory.", { target_username: giveCommand.targetUsername, item_id: giveCommand.itemId, item_category: giveCommand.itemCategory, amount: giveCommand.amount });
      return;
    }

    const commit = await commitPlayerInventoryState(socket, player, giveCommand.targetUsername, targetBeforeState, targetStagedState, {
      source: "admin",
      action: "admin_give",
      reason: "developer_command",
      request_id: requestId,
      world: player.world,
      metadata: {
        command,
        actor_username: player.account_username,
        target_username: cleanAccountName(giveCommand.targetUsername),
        item_id: giveCommand.itemId,
        item_category: giveCommand.itemCategory,
        amount: giveCommand.amount,
      },
      failure_message: "Could not save target inventory.",
    });
    if (!commit.ok) {
      deny(commit.message || "Could not save target inventory.", {
        target_username: giveCommand.targetUsername,
        item_id: giveCommand.itemId,
        item_category: giveCommand.itemCategory,
        amount: giveCommand.amount,
        reason: commit.reason || "",
      });
      return;
    }

    const target = findOnlinePlayerByUsername(giveCommand.targetUsername);
    const targetState = commit.state || ensurePlayerState(giveCommand.targetUsername) || {};
    const inventoryAudit = buildInventoryAdminAuditContext(targetBeforeState, targetState, giveCommand.itemId, giveCommand.itemCategory);
    if (target) {
      sendPlayerState(target.socket, target.player.account_username);
    }

    if (target && accountKey(target.player.account_username) !== accountKey(player.account_username)) {
      sendJson(target.socket, {
        type: "item_grant",
        username: target.player.account_username,
        target_username: target.player.account_username,
        item_id: giveCommand.itemId,
        item_type: giveCommand.itemId,
        item_category: giveCommand.itemCategory,
        amount: giveCommand.amount,
        granted_by: player.account_username,
        player_data: targetState,
      });
    }

    approve(
      accountKey(giveCommand.targetUsername) === accountKey(player.account_username)
        ? "Item delivered by server."
        : (target ? "Item delivered to online player." : "Item saved to offline account."),
      {
        target_username: cleanAccountName(giveCommand.targetUsername),
        target_type: "player",
        item_id: giveCommand.itemId,
        item_category: giveCommand.itemCategory,
        amount: giveCommand.amount,
        before_count: inventoryAudit.before_count,
        after_count: inventoryAudit.after_count,
        inventory_before_hash: inventoryAudit.inventory_before_hash,
        inventory_after_hash: inventoryAudit.inventory_after_hash,
        reason: "developer_command",
        delivery: accountKey(giveCommand.targetUsername) === accountKey(player.account_username)
          ? "self_saved"
          : (target ? "online" : "offline_saved"),
      },
      {
        command_type: "give",
        delivery: accountKey(giveCommand.targetUsername) === accountKey(player.account_username)
          ? "self_saved"
          : (target ? "online" : "offline_saved"),
        target_username: cleanAccountName(giveCommand.targetUsername),
        item_id: giveCommand.itemId,
        item_category: giveCommand.itemCategory,
        amount: giveCommand.amount,
        inventory_field: grant.inventoryField,
        count: getInventoryCount(targetState, giveCommand.itemId, giveCommand.itemCategory),
        player_data: targetState,
      }
    );
    return;
  }

  const removeCommand = parseRemoveCommand(data, command);
  if (removeCommand) {
    if (!ItemDatabase.hasItem(removeCommand.itemId)) {
      deny("That item does not exist on the server.", { target_username: removeCommand.targetUsername, item_id: removeCommand.itemId, amount: removeCommand.amount });
      return;
    }

    if (!ItemDatabase.canStoreItemInCategory(removeCommand.itemId, removeCommand.itemCategory)) {
      deny("That item category does not match the server database.", { target_username: removeCommand.targetUsername, item_id: removeCommand.itemId, item_category: removeCommand.itemCategory, amount: removeCommand.amount });
      return;
    }

    if (!doesAccountExist(removeCommand.targetUsername)) {
      deny("Target account does not exist.", { target_username: removeCommand.targetUsername, item_id: removeCommand.itemId, amount: removeCommand.amount });
      return;
    }

    const targetBeforeState = ensureWritablePlayerState(removeCommand.targetUsername);
    if (!targetBeforeState) {
      deny("Could not load target inventory.", { target_username: removeCommand.targetUsername, item_id: removeCommand.itemId, item_category: removeCommand.itemCategory, amount: removeCommand.amount });
      return;
    }

    const cleanRemoveItemId = clampString(removeCommand.itemId || "");
    const resolvedRemoveCategory = resolveInventoryCategory(cleanRemoveItemId, removeCommand.itemCategory);
    const available = getInventoryCount(targetBeforeState, cleanRemoveItemId, resolvedRemoveCategory);
    const requested = clampInteger(removeCommand.amount || 0, 1, MAX_ITEM_STACK);
    const removeAmount = Math.min(available, requested);
    const inventoryField = getInventoryFieldForCategory(resolvedRemoveCategory, cleanRemoveItemId);
    const removal = {
      removed: removeAmount,
      requested,
      available,
      itemCategory: resolvedRemoveCategory,
      inventoryField,
      count: Math.max(0, available - removeAmount),
    };

    if (removal.removed <= 0) {
      deny("Target does not have that item.", { target_username: removeCommand.targetUsername, item_id: removeCommand.itemId, item_category: removeCommand.itemCategory, requested: removal.requested, removed: removal.removed });
      return;
    }

    const targetStagedState = cloneJson(targetBeforeState);
    if (!spendItemFromState(targetStagedState, cleanRemoveItemId, resolvedRemoveCategory, removal.removed)) {
      deny("Could not stage target inventory.", { target_username: removeCommand.targetUsername, item_id: removeCommand.itemId, item_category: removeCommand.itemCategory, amount: removeCommand.amount });
      return;
    }

    const commit = await commitPlayerInventoryState(socket, player, removeCommand.targetUsername, targetBeforeState, targetStagedState, {
      source: "admin",
      action: "admin_remove",
      reason: "developer_command",
      request_id: requestId,
      world: player.world,
      metadata: {
        command,
        actor_username: player.account_username,
        target_username: cleanAccountName(removeCommand.targetUsername),
        item_id: removeCommand.itemId,
        item_category: removal.itemCategory,
        requested: removal.requested,
        removed: removal.removed,
      },
      failure_message: "Could not save target inventory.",
    });
    if (!commit.ok) {
      deny(commit.message || "Could not save target inventory.", {
        target_username: removeCommand.targetUsername,
        item_id: removeCommand.itemId,
        item_category: removal.itemCategory,
        requested: removal.requested,
        removed: removal.removed,
        reason: commit.reason || "",
      });
      return;
    }
    removal.count = getInventoryCount(commit.state, cleanRemoveItemId, removal.itemCategory);
    const inventoryAudit = buildInventoryAdminAuditContext(targetBeforeState, commit.state, cleanRemoveItemId, removal.itemCategory);

    const target = findOnlinePlayerByUsername(removeCommand.targetUsername);
    if (target) {
      sendPlayerState(target.socket, target.player.account_username);
      if (accountKey(target.player.account_username) !== accountKey(player.account_username)) {
        sendJson(target.socket, {
          type: "chat",
          sender: "System",
          message: `${player.account_username} removed ${removal.removed} ${removeCommand.itemId} from your inventory.`,
        });
      }
    }

    const partialMessage = removal.removed < removal.requested
      ? ` Removed ${removal.removed}/${removal.requested} because that was all the target had.`
      : ` Removed ${removal.removed}.`;

    approve(
      target ? `Server updated ${cleanAccountName(removeCommand.targetUsername)}.${partialMessage}` : `Server updated offline account.${partialMessage}`,
      {
        target_username: cleanAccountName(removeCommand.targetUsername),
        target_type: "player",
        item_id: removeCommand.itemId,
        item_category: removal.itemCategory,
        requested: removal.requested,
        removed: removal.removed,
        before_count: inventoryAudit.before_count,
        after_count: inventoryAudit.after_count,
        inventory_before_hash: inventoryAudit.inventory_before_hash,
        inventory_after_hash: inventoryAudit.inventory_after_hash,
        reason: "developer_command",
        delivery: target ? "online" : "offline_saved",
      },
      {
        command_type: "remove",
        target_username: cleanAccountName(removeCommand.targetUsername),
        item_id: removeCommand.itemId,
        item_category: removal.itemCategory,
        requested: removal.requested,
        removed: removal.removed,
        inventory_field: removal.inventoryField,
        count: removal.count,
        delivery: target ? "online" : "offline_saved",
        player_data: commit.state,
      }
    );
    return;
  }

  const parts = splitCommand(command);

  if (commandName === "heal" || commandName === "health") {
    const targetUsername = cleanAccountName(data.target_username || data.target || player.account_username);
    const requestedHealth = commandName === "health"
      ? clampInteger(data.amount || parts[1] || 3, 1, 100)
      : clampInteger(data.amount || 3, 1, 100);

    if (!doesAccountExist(targetUsername)) {
      deny("Target account does not exist.", { target_username: targetUsername, amount: requestedHealth });
      return;
    }

    const state = ensureWritablePlayerState(targetUsername);
    if (!state) {
      deny("Could not load target player state.", { target_username: targetUsername, amount: requestedHealth });
      return;
    }

    const beforeHealth = clampInteger(state.player_health || 0, 0, 100);
    const beforeHash = makeAuditHash(state);
    state.player_health = requestedHealth;
    persistPlayerInventoryChange(targetUsername, state);

    const target = findOnlinePlayerByUsername(targetUsername);
    if (target) {
      sendPlayerState(target.socket, target.player.account_username);
    }

    approve(
      target ? `Health set to ${requestedHealth}.` : `Health saved for offline account.`,
      {
        target_username: targetUsername,
        target_type: "player",
        amount: requestedHealth,
        before_health: beforeHealth,
        after_health: requestedHealth,
        inventory_before_hash: beforeHash,
        inventory_after_hash: makeAuditHash(state),
        reason: "developer_command",
        delivery: target ? "online" : "offline_saved",
      },
      { command_type: "health", target_username: targetUsername, amount: requestedHealth, player_data: state }
    );
    return;
  }

  if (commandName === "tp" || commandName === "teleport") {
    if (parts.length < 3 && (data.x === undefined || data.y === undefined)) {
      deny("Use: /tp x y");
      return;
    }

    const gridX = Math.trunc(Number(data.grid_x ?? data.x ?? parts[1]));
    const gridY = Math.trunc(Number(data.grid_y ?? data.y ?? parts[2]));
    if (!isGridInWorld(gridX, gridY)) {
      deny("Outside world bounds.", { grid_x: gridX, grid_y: gridY });
      return;
    }

    const beforePosition = { x: player.x, y: player.y, world: player.world };
    const pos = getGridCenterPixels(gridX, gridY);
    player.x = pos.x;
    player.y = pos.y;
    player.last_position_at = Date.now();

    broadcastToWorld(player.world, buildPublicPlayerPresencePayload("player_position", player, player.world), player.id);

    approve(
      `Teleported to ${gridX}, ${gridY}.`,
      {
        target_username: player.account_username,
        target_type: "player",
        grid_x: gridX,
        grid_y: gridY,
        before_position: beforePosition,
        after_position: { x: player.x, y: player.y, world: player.world },
        x: player.x,
        y: player.y,
        reason: "developer_command",
      },
      { command_type: "teleport", grid_x: gridX, grid_y: gridY, x: player.x, y: player.y }
    );
    return;
  }

  if (commandName === "noc" || commandName === "noclip") {
    const beforeNoclip = Boolean(player.noclip_enabled);
    player.noclip_enabled = data.enabled === undefined ? !player.noclip_enabled : Boolean(data.enabled);
    approve(
      player.noclip_enabled ? "Noclip enabled by server." : "Noclip disabled by server.",
      {
        target_username: player.account_username,
        target_type: "player",
        before_noclip_enabled: beforeNoclip,
        after_noclip_enabled: Boolean(player.noclip_enabled),
        noclip_enabled: player.noclip_enabled,
        reason: "developer_command",
      },
      { command_type: "noclip", noclip_enabled: player.noclip_enabled }
    );
    return;
  }

  if (commandName === "clear_drops") {
    const commandWorld = getDeveloperCommandWorldName(player, data);
    const state = ensureWorldState(commandWorld);
    const removedCount = state.drops.size;
    state.drops.clear();
    replaceWorldStateAndBroadcast(commandWorld, state);
    approve(
      `Cleared ${removedCount} drops in ${commandWorld}.`,
      {
        target_world: commandWorld,
        affected_world: commandWorld,
        before_drop_count: removedCount,
        after_drop_count: 0,
        removed_count: removedCount,
        reason: "developer_command",
      },
      { command_type: "clear_drops", target_world: commandWorld, removed_count: removedCount }
    );
    return;
  }

  if (commandName === "forceevent") {
    const eventType = String(data.event_type || parseForceEventName(command) || "").trim().toLowerCase();
    const commandWorld = getDeveloperCommandWorldName(player, data);

    if (eventType !== SNOW_STORM_EVENT_TYPE) {
      deny("Use: /forceevent snow_storm", { target_world: commandWorld, event_type: eventType });
      return;
    }

    const cooldown = consumeSnowStormCommandCooldown(commandWorld);
    if (!cooldown.ok) {
      deny(`Snow Storm command is cooling down. Try again in ${Math.ceil(cooldown.retry_ms / 1000)}s.`, {
        target_world: commandWorld,
        event_type: eventType,
        reason: "cooldown",
        retry_ms: cooldown.retry_ms,
      });
      return;
    }

    sendDeveloperApproved(socket, requestId, command, `Starting Snow Storm in ${commandWorld}...`, {
      command_type: "force_event",
      target_world: commandWorld,
      event_type: eventType,
      event_action: "start",
      pending: true,
    });

    let result = await startSnowStormEvent(commandWorld, { reason: "developer_forceevent" });
    if (!result.ok && result.reason === "already_active") {
      const endResult = await endSnowStormEvent(commandWorld, { reason: "developer_forceevent_restart" });
      if (!endResult.ok && endResult.reason !== "not_active") {
        deny(`Snow Storm force restart failed: ${endResult.reason || "unknown"}.`, {
          target_world: commandWorld,
          event_type: eventType,
          reason: endResult.reason || "",
        });
        return;
      }
      result = await startSnowStormEvent(commandWorld, { reason: "developer_forceevent_restart" });
    }

    if (!result.ok) {
      deny(`Snow Storm force start failed: ${result.reason || "unknown"}.`, {
        target_world: commandWorld,
        event_type: eventType,
        reason: result.reason || "",
      });
      return;
    }

    approve(
      `Snow Storm force-started in ${commandWorld}. Changed ${result.changed_tiles || 0} tiles.`,
      {
        target_world: commandWorld,
        event_type: eventType,
        event_action: "start",
        event_id: result.event_id || "",
      },
      {
        command_type: "force_event",
        target_world: commandWorld,
        event_type: eventType,
        event_action: "start",
        event_id: result.event_id || "",
      }
    );
    return;
  }

  if (commandName === "event" || commandName === "world_event") {
    try {
      const parts = splitCommand(command);
      const eventType = String(data.event_type || parts[1] || "").trim().toLowerCase();
      const action = String(data.event_action || data.action || parts[2] || "start").trim().toLowerCase();
      const commandWorld = getDeveloperCommandWorldName(player, data);

      if (eventType !== SNOW_STORM_EVENT_TYPE) {
        deny("Use: /event snow_storm start|end", { target_world: commandWorld, event_type: eventType });
        return;
      }

      const cooldown = consumeSnowStormCommandCooldown(commandWorld);
      if (!cooldown.ok) {
        deny(`Snow Storm command is cooling down. Try again in ${Math.ceil(cooldown.retry_ms / 1000)}s.`, {
          target_world: commandWorld,
          event_type: eventType,
          event_action: action,
          reason: "cooldown",
          retry_ms: cooldown.retry_ms,
        });
        return;
      }

      const result = action === "end"
        ? await endSnowStormEvent(commandWorld, { reason: "developer_command" })
        : await startSnowStormEvent(commandWorld, { reason: "developer_command" });

      if (!result.ok) {
        deny(`Snow Storm event ${action === "end" ? "end" : "start"} failed: ${result.reason || "unknown"}.`, {
          target_world: commandWorld,
          event_type: eventType,
          event_action: action,
          reason: result.reason || "",
          message: result.message || "",
        });
        return;
      }

      approve(
        action === "end"
          ? `Snow Storm ended in ${commandWorld}.`
          : `Snow Storm started in ${commandWorld}. Changed ${result.changed_tiles || 0} tiles.`,
        {
          target_world: commandWorld,
          event_type: eventType,
          event_action: action,
          event_id: result.event_id || "",
        },
        {
          command_type: "world_event",
          target_world: commandWorld,
          event_type: eventType,
          event_action: action,
          event_id: result.event_id || "",
        }
      );
      return;
    } catch (error) {
      writeCrashReport("developer_event_command_exception", {
        error: errorToCrashDetails(error),
        command: commandLogBase,
        runtime: getCrashRuntimeState(),
      });
      deny("Snow Storm command failed safely. Check crash_reports.log for details.", {
        event_type: SNOW_STORM_EVENT_TYPE,
        reason: "exception",
        message: String(error?.message || error || "unknown"),
      });
      return;
    }
  }

  if (commandName === "save") {
    const commandWorld = getDeveloperCommandWorldName(player, data);
    saveWorldState(commandWorld);
    savePlayerState(player.account_username);
    flushPendingSaves();
    approve(`Saved ${commandWorld} and pending player/account data.`, { target_world: commandWorld }, { command_type: "save_world", target_world: commandWorld });
    return;
  }

  if (commandName === "load" || commandName === "reload") {
    const commandWorld = getDeveloperCommandWorldName(player, data);
    worldStates.delete(commandWorld);
    ensureWorldState(commandWorld);
    broadcastToWorld(commandWorld, buildWorldStateMessage(commandWorld, {
      respawn_player: true,
      force_respawn: true,
      world_state_reason: "admin_reload",
    }));
    approve(`Reloaded ${commandWorld} from server storage.`, { target_world: commandWorld }, { command_type: "reload_world", target_world: commandWorld });
    return;
  }

  if (commandName === "spawn") {
    if (parts.length < 4) {
      deny("Use: /spawn block x y");
      return;
    }

    const itemId = clampString(data.item_id || data.block_type || parts[1]);
    const gridX = Math.trunc(Number(data.grid_x ?? data.x ?? parts[2]));
    const gridY = Math.trunc(Number(data.grid_y ?? data.y ?? parts[3]));
    const commandWorld = getDeveloperCommandWorldName(player, data);
    const state = ensureWorldState(commandWorld);
    const key = gridKey(gridX, gridY);

    if (!ItemDatabase.hasItem(itemId) || resolveInventoryCategory(itemId) !== "block") {
      deny("That block does not exist on the server.", { item_id: itemId, target_world: commandWorld, grid_x: gridX, grid_y: gridY });
      return;
    }

    if (!isGridInWorld(gridX, gridY)) {
      deny("Outside world bounds.", { item_id: itemId, target_world: commandWorld, grid_x: gridX, grid_y: gridY });
      return;
    }

    if (state.foreground.has(key)) {
      deny("That position already has a foreground block.", { item_id: itemId, target_world: commandWorld, grid_x: gridX, grid_y: gridY });
      return;
    }

    const update = {
      type: "world_block_update",
      action: "place",
      layer: "foreground",
      x: gridX,
      y: gridY,
      block_type: itemId,
      world: commandWorld,
    };
    applyBlockUpdateToWorldState(commandWorld, update);
    queueWorldSave(commandWorld);
    broadcastToWorld(commandWorld, update);
    approve(
      `Spawned ${itemId} in ${commandWorld}.`,
      {
        target_world: commandWorld,
        affected_world: commandWorld,
        item_id: itemId,
        item_category: "block",
        grid_x: gridX,
        grid_y: gridY,
        old_block_id: "",
        new_block_id: itemId,
        reason: "developer_command",
      },
      { command_type: "spawn", target_world: commandWorld, item_id: itemId, grid_x: gridX, grid_y: gridY }
    );
    return;
  }

  deny("That developer command is not enabled server-side yet.");
}

function gridKey(x, y) {
  return `${Number(x) || 0},${Number(y) || 0}`;
}

function ensureWorldState(worldName) {
  const clean = cleanWorld(worldName);
  if (!worldStates.has(clean)) {
    worldStates.set(clean, loadWorldState(clean));
  }
  return worldStates.get(clean);
}

function createEmptyWorldState() {
  return {
    cleared: false,
    foreground: new Map(),
    background: new Map(),
    removed_foreground: new Map(),
    removed_background: new Map(),
    seeds: new Map(),
    interactions: new Map(),
    world_lock: {},
    drops: new Map(),
    active_event_type: "",
    event_id: "",
    event_started_at: "",
    event_ends_at: "",
    event_changed_tiles: [],
  };
}

function loadWorldState(worldName) {
  if (isPostgresAuthoritativeReady()) {
    return createEmptyWorldState();
  }

  return deserializeWorldState(worldName, readJsonFile(getWorldSavePath(worldName)));
}

function deserializeWorldState(worldName, data) {
  const state = createEmptyWorldState();

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return state;
  }

  state.cleared = Boolean(data.cleared || data.world_cleared || data.clear_generated);

  loadGridArrayIntoMap(state.foreground, data.foreground || data.blocks, normalizeBlockEntry);
  loadGridArrayIntoMap(state.background, data.background || data.background_blocks, normalizeBlockEntry);
  loadGridArrayIntoMap(state.removed_foreground, data.removed_foreground, normalizeRemovedBlockEntry);
  loadGridArrayIntoMap(state.removed_background, data.removed_background, normalizeRemovedBlockEntry);
  loadGridArrayIntoMap(state.seeds, data.seeds || data.planted_seeds, normalizeSeedEntry);
  loadInteractionsIntoMap(state.interactions, data.interactions, worldName);
  loadDropsIntoMap(state.drops, data.drops || data.item_drops);

  if (!state.cleared && state.removed_foreground.size > Math.floor((WORLD_WIDTH * BEDROCK_START_Y) / 2)) {
    state.cleared = true;
    state.removed_foreground.clear();
    state.removed_background.clear();
  }

  if (state.cleared) {
    addBedrockFloorEntries(state.foreground);
  }

  if (data.world_lock && typeof data.world_lock === "object" && !Array.isArray(data.world_lock)) {
    state.world_lock = sanitizeWorldLockState(data.world_lock);
  }

  loadWorldEventStateIntoState(state, data);
  repairEntranceGateState(state);
  return state;
}

function loadWorldEventStateIntoState(state, data) {
  if (!state || !data || typeof data !== "object" || Array.isArray(data)) return;

  const activeEvent = data.active_event && typeof data.active_event === "object" && !Array.isArray(data.active_event)
    ? data.active_event
    : {};
  const eventType = clampString(data.active_event_type || activeEvent.type || activeEvent.event_type || "");
  if (eventType !== SNOW_STORM_EVENT_TYPE) return;

  const eventId = clampString(data.event_id || activeEvent.event_id || "");
  const startedAt = normalizeEventTimestamp(data.event_started_at || activeEvent.started_at || activeEvent.event_started_at || "");
  const endsAt = normalizeEventTimestamp(data.event_ends_at || activeEvent.ends_at || activeEvent.event_ends_at || "");
  const rawChangedTiles = Array.isArray(data.event_changed_tiles)
    ? data.event_changed_tiles
    : (Array.isArray(activeEvent.changed_tiles) ? activeEvent.changed_tiles : []);

  state.active_event_type = eventType;
  state.event_id = eventId || makeAuditId("event");
  state.event_started_at = startedAt || new Date().toISOString();
  state.event_ends_at = endsAt || new Date(Date.now() + SNOW_STORM_EVENT_DURATION_MS).toISOString();
  state.event_changed_tiles = rawChangedTiles
    .map((entry) => normalizeWorldEventTileEntry(entry, state.event_id))
    .filter(Boolean);
}

function normalizeEventTimestamp(value) {
  const raw = String(value || "").trim();
  if (raw === "") return "";
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toISOString();
}

function normalizeWorldEventTileEntry(rawEntry, fallbackEventId = "") {
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;

  const x = Number(rawEntry.x);
  const y = Number(rawEntry.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const gridX = Math.trunc(x);
  const gridY = Math.trunc(y);
  if (!isGridInWorld(gridX, gridY)) return null;

  const eventBlockId = clampString(rawEntry.event_block_id || rawEntry.block_type || "");
  if (eventBlockId === "" || !ItemDatabase.hasItem(eventBlockId) || resolveInventoryCategory(eventBlockId) !== "block") {
    return null;
  }

  const originalBlockId = clampString(rawEntry.original_block_id || rawEntry.original_block_type || "");
  if (originalBlockId !== "" && (!ItemDatabase.hasItem(originalBlockId) || resolveInventoryCategory(originalBlockId) !== "block")) {
    return null;
  }

  return {
    x: gridX,
    y: gridY,
    layer: "foreground",
    original_block_id: originalBlockId,
    event_block_id: eventBlockId,
    event_id: clampString(rawEntry.event_id || fallbackEventId || ""),
    changed_at: normalizeEventTimestamp(rawEntry.changed_at || "") || new Date().toISOString(),
    source: clampString(rawEntry.source || ""),
    reason: clampString(rawEntry.reason || ""),
  };
}

function loadGridArrayIntoMap(target, rawEntries, normalizeEntry) {
  if (!Array.isArray(rawEntries)) return;

  for (const rawEntry of rawEntries) {
    const entry = normalizeEntry(rawEntry);
    if (!entry) continue;
    target.set(gridKey(entry.x, entry.y), entry);
  }
}

function normalizeBlockEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;

  const x = Number(rawEntry.x);
  const y = Number(rawEntry.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const gridX = Math.trunc(x);
  const gridY = Math.trunc(y);
  if (!isGridInWorld(gridX, gridY)) return null;

  let blockType = clampString(rawEntry.block_type || rawEntry.type || "");
  if (blockType.length === 0) return null;
  if (blockType === "crafting_station_right") return null;
  if (blockType === "crafting_station_left") blockType = "crafting_station";
  if (!ItemDatabase.hasItem(blockType) || resolveInventoryCategory(blockType) !== "block") return null;

  const entry = {
    x: gridX,
    y: gridY,
    block_type: blockType,
  };

  if (Object.prototype.hasOwnProperty.call(rawEntry, "entrance_locked")) {
    entry.entrance_locked = Boolean(rawEntry.entrance_locked);
  }

  if (Object.prototype.hasOwnProperty.call(rawEntry, "sign_text")) {
    entry.sign_text = String(rawEntry.sign_text || "").slice(0, MAX_SIGN_TEXT_LENGTH);
  }

  if (Object.prototype.hasOwnProperty.call(rawEntry, "toggle_on")) {
    entry.toggle_on = Boolean(rawEntry.toggle_on);
  }

  if (isDoorBlockType(blockType) && Object.prototype.hasOwnProperty.call(rawEntry, "door_id")) {
    entry.door_id = cleanDoorId(rawEntry.door_id);
  }

  if (isDoorBlockType(blockType) && (Object.prototype.hasOwnProperty.call(rawEntry, "door_destination") || Object.prototype.hasOwnProperty.call(rawEntry, "destination"))) {
    const parsedDestination = parseDoorDestination(rawEntry.door_destination || rawEntry.destination || "", rawEntry.world || "");
    entry.door_destination = parsedDestination.destination;
    entry.door_target_world = cleanWorld(rawEntry.door_target_world || rawEntry.target_world || parsedDestination.target_world);
    entry.door_target_id = cleanDoorId(rawEntry.door_target_id || rawEntry.target_door_id || parsedDestination.target_door_id);
  } else if (isDoorBlockType(blockType)) {
    if (Object.prototype.hasOwnProperty.call(rawEntry, "door_target_world") || Object.prototype.hasOwnProperty.call(rawEntry, "target_world")) {
      entry.door_target_world = cleanWorld(rawEntry.door_target_world || rawEntry.target_world || "");
    }
    if (Object.prototype.hasOwnProperty.call(rawEntry, "door_target_id") || Object.prototype.hasOwnProperty.call(rawEntry, "target_door_id")) {
      entry.door_target_id = cleanDoorId(rawEntry.door_target_id || rawEntry.target_door_id || "");
    }
  }

  return entry;
}

function normalizeRemovedBlockEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;

  const x = Number(rawEntry.x);
  const y = Number(rawEntry.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const gridX = Math.trunc(x);
  const gridY = Math.trunc(y);
  if (!isGridInWorld(gridX, gridY)) return null;

  const blockType = clampString(rawEntry.block_type || rawEntry.type || "");
  if (blockType !== "" && (!ItemDatabase.hasItem(blockType) || resolveInventoryCategory(blockType) !== "block")) {
    return null;
  }

  return {
    x: gridX,
    y: gridY,
    block_type: blockType,
  };
}

function normalizeSeedEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return null;

  const x = Number(rawEntry.x);
  const y = Number(rawEntry.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const gridX = Math.trunc(x);
  const gridY = Math.trunc(y);
  if (!isGridInWorld(gridX, gridY)) return null;

  const seedType = clampString(rawEntry.seed_type || rawEntry.type || "");
  if (seedType.length === 0) return null;
  if (!ItemDatabase.hasItem(seedType) || resolveInventoryCategory(seedType) !== "seed") return null;

  const configuredGrowTime = getSeedConfiguredGrowTime(seedType);
  const maxGrowTime = Math.max(1, Math.min(86400, Number(rawEntry.max_grow_time) || configuredGrowTime));
  const rawMature = Boolean(rawEntry.mature);
  const growTime = rawMature ? 0 : Math.max(0, Math.min(maxGrowTime, Number(rawEntry.grow_time) || maxGrowTime));
  let plantedAt = Number(rawEntry.planted_at || 0);
  if (!Number.isFinite(plantedAt) || plantedAt <= 0) {
    plantedAt = Date.now() - Math.max(0, maxGrowTime - growTime) * 1000;
  }

  return {
    x: gridX,
    y: gridY,
    seed_type: seedType,
    grow_time: growTime,
    max_grow_time: maxGrowTime,
    planted_at: plantedAt,
    mutated: Boolean(rawEntry.mutated),
  };
}

function loadInteractionsIntoMap(target, rawEntries, worldName = "") {
  if (!Array.isArray(rawEntries)) return;

  for (const rawEntry of rawEntries) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;

    const action = String(rawEntry.action || "").trim();
    const x = Number(rawEntry.x);
    const y = Number(rawEntry.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const gridX = Math.trunc(x);
    const gridY = Math.trunc(y);
    if (!isGridInWorld(gridX, gridY)) continue;

    if (action === "wooden_entrance_state") {
      target.set(gridKey(gridX, gridY), {
        action,
        x: gridX,
        y: gridY,
        locked: Boolean(rawEntry.locked),
        world: cleanWorld(rawEntry.world || ""),
      });
    } else if (action === "door_state") {
      const parsedDestination = parseDoorDestination(rawEntry.destination || rawEntry.door_destination || "", rawEntry.world || worldName);
      target.set(gridKey(gridX, gridY), {
        action,
        x: gridX,
        y: gridY,
        locked: Boolean(rawEntry.locked),
        world: cleanWorld(rawEntry.world || worldName),
        door_id: cleanDoorId(rawEntry.door_id || ""),
        destination: parsedDestination.destination,
        target_world: cleanWorld(rawEntry.target_world || rawEntry.door_target_world || parsedDestination.target_world),
        target_door_id: cleanDoorId(rawEntry.target_door_id || rawEntry.door_target_id || parsedDestination.target_door_id),
      });
    } else if (action === "ceiling_lamp_state") {
      target.set(gridKey(gridX, gridY), {
        action,
        x: gridX,
        y: gridY,
        on: Boolean(rawEntry.on ?? rawEntry.toggle_on),
        world: cleanWorld(rawEntry.world || ""),
      });
    } else if (action === "sign_text") {
      target.set(gridKey(gridX, gridY), {
        action,
        x: gridX,
        y: gridY,
        text: String(rawEntry.text || rawEntry.sign_text || "").slice(0, MAX_SIGN_TEXT_LENGTH),
        world: cleanWorld(rawEntry.world || ""),
      });
    } else if (action === "vend_state") {
      target.set(gridKey(gridX, gridY), sanitizeVendState(rawEntry, rawEntry.world || worldName, gridX, gridY));
    } else if (action === "safe_state") {
      target.set(gridKey(gridX, gridY), sanitizeSafeState(rawEntry, rawEntry.world || worldName, gridX, gridY));
    }
  }
}

function loadDropsIntoMap(target, rawEntries) {
  if (!Array.isArray(rawEntries)) return;

  for (const rawEntry of rawEntries) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;

    const dropId = clampString(rawEntry.drop_id || "", MAX_DROP_ID_LENGTH);
    if (dropId.length === 0) continue;

    const itemType = clampString(rawEntry.item_type || rawEntry.type || "");
    if (itemType.length === 0) continue;
    if (!ItemDatabase.hasItem(itemType)) continue;

    const x = Number(rawEntry.x);
    const y = Number(rawEntry.y);
    if (!isPositionInWorldBounds(x, y)) continue;

    const itemCategory = resolveInventoryCategory(itemType, rawEntry.item_category || "");
    if (!ItemDatabase.canStoreItemInCategory(itemType, itemCategory)) continue;

    target.set(dropId, {
      drop_id: dropId,
      item_type: itemType,
      item_category: itemCategory,
      is_seed: itemCategory === "seed",
      amount: clampInteger(rawEntry.amount || 1, 1, MAX_DROP_TILE_AMOUNT),
      x,
      y,
      pickup_delay: Math.max(0, Number(rawEntry.pickup_delay) || 0),
    });
  }
}

function sanitizeBlockUpdate(data, worldName) {
  const action = String(data.action || "").trim();
  if (action !== "place" && action !== "break" && action !== "hit") return null;

  const layer = String(data.layer || "foreground").trim() === "background" ? "background" : "foreground";
  const x = Number(data.x);
  const y = Number(data.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const gridX = Math.trunc(x);
  const gridY = Math.trunc(y);
  if (!isGridInWorld(gridX, gridY)) return null;

  const blockType = clampString(data.block_type || "");
  if (action === "place" && blockType.length === 0) return null;
  if (blockType !== "" && (!ItemDatabase.hasItem(blockType) || resolveInventoryCategory(blockType) !== "block")) return null;

  return {
    type: "world_block_update",
    action,
    layer,
    x: gridX,
    y: gridY,
    block_type: blockType,
    source_tool: clampString(data.source_tool || ""),
    world: cleanWorld(worldName),
  };
}

function sanitizeSeedUpdate(data, worldName) {
  const action = String(data.action || "").trim();
  if (action !== "place" && action !== "remove") return null;

  const x = Number(data.x);
  const y = Number(data.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const gridX = Math.trunc(x);
  const gridY = Math.trunc(y);
  if (!isGridInWorld(gridX, gridY)) return null;

  const seedType = clampString(data.seed_type || "");
  if (action === "place" && seedType.length === 0) return null;
  if (seedType !== "" && (!ItemDatabase.hasItem(seedType) || resolveInventoryCategory(seedType) !== "seed")) return null;

  const maxGrowTime = action === "place" ? getSeedConfiguredGrowTime(seedType) : SERVER_SEED_GROW_TIME_SECONDS;

  return {
    type: "world_seed_update",
    action,
    x: gridX,
    y: gridY,
    seed_type: seedType,
    grow_time: maxGrowTime,
    max_grow_time: maxGrowTime,
    world: cleanWorld(worldName),
  };
}

function applyBlockUpdateToWorldState(worldName, update) {
  const state = ensureWorldState(worldName);
  const key = gridKey(update.x, update.y);
  const target = update.layer === "background" ? state.background : state.foreground;
  const removed = update.layer === "background" ? state.removed_background : state.removed_foreground;

  if (update.action === "place") {
    clearServerBlockDamage(worldName, update);
    target.set(key, {
      x: update.x,
      y: update.y,
      block_type: update.block_type,
    });
    removed.delete(key);
    if (!isPersistentInteractionBlockType(update.block_type)) {
      state.interactions.delete(key);
    }
    return;
  }

  if (update.action === "break") {
    clearServerBlockDamage(worldName, update);
    target.delete(key);
    state.interactions.delete(key);
    removed.set(key, {
      x: update.x,
      y: update.y,
      block_type: update.block_type || "",
    });

    if (isWorldLockBlockType(update.block_type) && isActiveWorldLockGrid(state, update.x, update.y)) {
      state.world_lock = {};
    }
  }
}

function applySeedUpdateToWorldState(worldName, update) {
  const state = ensureWorldState(worldName);
  const key = gridKey(update.x, update.y);

  if (update.action === "place" || update.action === "splice") {
    const seedEntry = makeServerSeedEntry(update.x, update.y, update.seed_type);
    state.seeds.set(key, seedEntry);
    update.grow_time = seedEntry.grow_time;
    update.max_grow_time = seedEntry.max_grow_time;
    update.mature = false;
    update.mutated = Boolean(seedEntry.mutated);
  } else if (update.action === "remove") {
    state.seeds.delete(key);
  }
}

function findEntranceGateInState(state) {
  for (const block of state.foreground.values()) {
    if (clampString(block?.block_type || "") === ENTRANCE_GATE_TYPE) {
      return { x: block.x, y: block.y };
    }
  }

  return null;
}

function findEntranceGatesInState(state) {
  const gates = [];
  for (const block of state.foreground.values()) {
    if (clampString(block?.block_type || "") === ENTRANCE_GATE_TYPE) {
      gates.push({ x: block.x, y: block.y });
    }
  }
  return gates;
}

function getEntranceGateSpawnForWorld(worldName) {
  const state = ensureWorldState(worldName);
  const gate = repairEntranceGateState(state) || findEntranceGateInState(state);
  if (!gate || !isGridInWorld(gate.x, gate.y)) return null;

  return {
    x: gate.x * TILE_SIZE,
    y: gate.y * TILE_SIZE,
    grid_x: gate.x,
    grid_y: gate.y,
  };
}

function getDefaultEntranceGateSpawnForWorld(worldName) {
  const gridX = clampInteger(Math.floor(WORLD_WIDTH * 0.5), 0, WORLD_WIDTH - 1);
  const terrain = buildServerTerrainSurface(worldName);
  const surfaceY = serverSurfaceYAt(terrain.surface, gridX);
  const gridY = clampInteger(surfaceY - 1, 0, WORLD_HEIGHT - 1);

  return {
    x: gridX * TILE_SIZE,
    y: gridY * TILE_SIZE,
    grid_x: gridX,
    grid_y: gridY,
  };
}

function getJoinWorldSpawnForWorld(worldName) {
  return getEntranceGateSpawnForWorld(worldName) || getDefaultEntranceGateSpawnForWorld(worldName);
}

function ensureEntranceGateSupportInState(state, gate) {
  if (!state || !gate) return;

  const x = gate.x;
  const y = gate.y + 1;
  if (!isGridInWorld(x, y)) return;

  const key = gridKey(x, y);
  state.foreground.set(key, { x, y, block_type: "bedrock" });
  state.removed_foreground.delete(key);
  state.interactions.delete(key);
  state.seeds.delete(key);
}

function cleanupLegacyEntranceGateSupportInState(state, gate) {
  if (!state || !gate) return;

  const y = gate.y + 1;
  for (const x of [gate.x - 1, gate.x + 1]) {
    if (!isGridInWorld(x, y)) continue;

    const key = gridKey(x, y);
    const blockType = clampString(state.foreground.get(key)?.block_type || "");
    if (blockType !== "bedrock") continue;

    state.foreground.set(key, { x, y, block_type: "dirt" });
    state.removed_foreground.delete(key);
  }
}

function repairEntranceGateState(state) {
  if (!state) return null;

  const gates = findEntranceGatesInState(state);
  if (gates.length === 0) return null;

  const keptGate = gates[gates.length - 1];
  const keptKey = gridKey(keptGate.x, keptGate.y);

  for (const gate of gates) {
    const key = gridKey(gate.x, gate.y);
    if (key === keptKey) continue;

    state.foreground.delete(key);
    state.interactions.delete(key);
    state.removed_foreground.set(key, {
      x: gate.x,
      y: gate.y,
      block_type: ENTRANCE_GATE_TYPE,
    });
  }

  ensureEntranceGateSupportInState(state, keptGate);
  cleanupLegacyEntranceGateSupportInState(state, keptGate);
  return keptGate;
}

function isProtectedEntranceSupportBlock(blockType) {
  const clean = clampString(blockType || "");
  return (
    isWorldLockBlockType(clean) ||
    clean === SAFE_BLOCK_TYPE ||
    clean === FISH_MONGER_BLOCK_TYPE ||
    isVendBlockType(clean) ||
    clean === "crafting_station" ||
    clean === "furnace" ||
    isPersistentInteractionBlockType(clean)
  );
}

function rejectEntranceMove(socket, message) {
  sendActionRejected(socket, "world_interaction_update", message);
  return { ok: false };
}

function validateEntranceGateMove(socket, player, worldName, update) {
  const state = ensureWorldState(worldName);
  const oldGate = findEntranceGateInState(state) || { x: update.old_x, y: update.old_y };

  if (!isGridInWorld(oldGate.x, oldGate.y)) {
    return rejectEntranceMove(socket, "Entrance Gate missing.");
  }

  if (oldGate.x === update.x && oldGate.y === update.y) {
    return rejectEntranceMove(socket, "Entrance Gate is already there.");
  }

  if (!isGridInWorld(update.x, update.y)) {
    return rejectEntranceMove(socket, "Outside world bounds.");
  }

  if (update.y <= 3 || update.y + 1 >= BEDROCK_START_Y) {
    return rejectEntranceMove(socket, "Not enough space for the Entrance Gate.");
  }

  if (!isPlayerNearGrid(player, update.x, update.y)) {
    return rejectEntranceMove(socket, "Too far away.");
  }

  const targetKey = gridKey(update.x, update.y);
  if (state.foreground.has(targetKey)) {
    return rejectEntranceMove(socket, "That spot is blocked.");
  }

  if (state.seeds.has(targetKey)) {
    return rejectEntranceMove(socket, "A seed is blocking that spot.");
  }

  for (let x = update.x - 1; x <= update.x + 1; x += 1) {
    const walkingKey = gridKey(x, update.y);
    if (!isGridInWorld(x, update.y)) {
      return rejectEntranceMove(socket, "Not enough walking space around the gate.");
    }

    if (x !== update.x && (state.foreground.has(walkingKey) || state.seeds.has(walkingKey))) {
      return rejectEntranceMove(socket, "Clear the walking space beside the gate first.");
    }
  }

  const underY = update.y + 1;
  if (!isGridInWorld(update.x, underY)) {
    return rejectEntranceMove(socket, "Not enough space under the gate.");
  }

  const underKey = gridKey(update.x, underY);
  if (state.seeds.has(underKey)) {
    return rejectEntranceMove(socket, "A seed is under the gate spot.");
  }

  const underBlock = state.foreground.get(underKey);
  const underType = clampString(underBlock?.block_type || "");

  if (underType === ENTRANCE_GATE_TYPE || isProtectedEntranceSupportBlock(underType)) {
    return rejectEntranceMove(socket, "A protected block is under that spot.");
  }

  if (underType !== "" && underType !== "bedrock" && !ItemDatabase.canBreakBlock(underType)) {
    return rejectEntranceMove(socket, "Unbreakable block under gate spot.");
  }

  return { ok: true, state, oldGate };
}

function applyEntranceGateMoveToWorldState(worldName, state, oldGate, newGate) {
  const updates = [];
  const oldGateKey = gridKey(oldGate.x, oldGate.y);

  state.foreground.delete(oldGateKey);
  state.interactions.delete(oldGateKey);
  state.removed_foreground.set(oldGateKey, {
    x: oldGate.x,
    y: oldGate.y,
    block_type: ENTRANCE_GATE_TYPE,
  });
  updates.push({
    type: "world_block_update",
    action: "break",
    layer: "foreground",
    x: oldGate.x,
    y: oldGate.y,
    block_type: ENTRANCE_GATE_TYPE,
    world: cleanWorld(worldName),
  });

  for (let x = oldGate.x - 1; x <= oldGate.x + 1; x += 1) {
    const y = oldGate.y + 1;
    if (!isGridInWorld(x, y)) continue;

    const key = gridKey(x, y);
    const oldSupportType = clampString(state.foreground.get(key)?.block_type || "");
    if (oldSupportType !== "bedrock") continue;

    state.foreground.set(key, { x, y, block_type: "dirt" });
    state.removed_foreground.delete(key);
    updates.push({
      type: "world_block_update",
      action: "place",
      layer: "foreground",
      x,
      y,
      block_type: "dirt",
      world: cleanWorld(worldName),
    });
  }

  const supportX = newGate.x;
  const supportY = newGate.y + 1;
  const supportKey = gridKey(supportX, supportY);
  state.foreground.set(supportKey, { x: supportX, y: supportY, block_type: "bedrock" });
  state.removed_foreground.delete(supportKey);
  state.interactions.delete(supportKey);
  updates.push({
    type: "world_block_update",
    action: "place",
    layer: "foreground",
    x: supportX,
    y: supportY,
    block_type: "bedrock",
    world: cleanWorld(worldName),
  });

  const newGateKey = gridKey(newGate.x, newGate.y);
  state.foreground.set(newGateKey, {
    x: newGate.x,
    y: newGate.y,
    block_type: ENTRANCE_GATE_TYPE,
  });
  state.removed_foreground.delete(newGateKey);
  state.interactions.delete(newGateKey);
  updates.push({
    type: "world_block_update",
    action: "place",
    layer: "foreground",
    x: newGate.x,
    y: newGate.y,
    block_type: ENTRANCE_GATE_TYPE,
    world: cleanWorld(worldName),
  });

  repairEntranceGateState(state);
  return updates;
}

async function handleEntranceGateMoveUpdate(socket, player, worldName, update, requestId = "") {
  const validation = validateEntranceGateMove(socket, player, worldName, update);
  if (!validation.ok) return false;

  const moveTransactionId = makeAuditId("gate_move");
  const spendResult = await spendServerInventoryCost(player.account_username, {
    item_id: "entrance_mover",
    item_category: "tool",
    amount: 1,
  }, {
    socket,
    player,
    source: "world_interaction",
    action: "entrance_gate_move",
    reason: "gate_move_cost",
    request_id: requestId,
    world: worldName,
    metadata: {
      transaction_id: moveTransactionId,
      old_x: validation.oldGate.x,
      old_y: validation.oldGate.y,
      new_x: update.x,
      new_y: update.y,
    },
  });
  if (!spendResult.ok) {
    sendActionRejected(socket, "world_interaction_update", spendResult.message);
    return false;
  }

  const updates = applyEntranceGateMoveToWorldState(
    worldName,
    validation.state,
    validation.oldGate,
    { x: update.x, y: update.y }
  );

  saveWorldState(worldName);
  logItemLedgerForState(socket, player, player.account_username, spendResult.state, "entrance_mover", "tool", -1, "entrance_gate_move", moveTransactionId, "gate_move_cost", worldName, {
    old_x: validation.oldGate.x,
    old_y: validation.oldGate.y,
    new_x: update.x,
    new_y: update.y,
  }, { skipPostgres: spendResult.postgres_committed });
  logWorldChange(socket, player, {
    source_type: "entrance_gate_move",
    source_id: moveTransactionId,
    world: worldName,
    action: "entrance_gate_move",
    layer: "foreground",
    x: update.x,
    y: update.y,
    block_type: ENTRANCE_GATE_TYPE,
    details: {
      old_x: validation.oldGate.x,
      old_y: validation.oldGate.y,
      new_x: update.x,
      new_y: update.y,
      update_count: updates.length,
    },
  });
  for (const blockUpdate of updates) {
    logWorldChange(socket, player, {
      source_type: "entrance_gate_move",
      source_id: moveTransactionId,
      world: worldName,
      action: `entrance_gate_${blockUpdate.action}`,
      layer: blockUpdate.layer,
      x: blockUpdate.x,
      y: blockUpdate.y,
      block_type: blockUpdate.block_type,
    });
    sendWorldUpdateToRequesterAndWorld(socket, player, worldName, blockUpdate, {
      username: player.account_username,
      player_data: spendResult.state || {},
    });
  }

  sendInventoryTransactionResult(socket, {
    ok: true,
    action: "entrance_gate_move",
    message: "Entrance Gate moved.",
    username: player.account_username,
    player_data: spendResult.state || {},
  });
  return true;
}

function sanitizeInteractionUpdate(data, worldName) {
  const action = String(data.action || "").trim();

  if (action === "springboard_animation") {
    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const gridX = Math.trunc(x);
    const gridY = Math.trunc(y);
    if (!isGridInWorld(gridX, gridY)) return null;

    return {
      type: "world_interaction_update",
      world: cleanWorld(worldName),
      action,
      x: gridX,
      y: gridY,
    };
  }

  if (action === "entrance_pass") {
    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const gridX = Math.trunc(x);
    const gridY = Math.trunc(y);
    if (!isGridInWorld(gridX, gridY)) return null;
    const rawDirection = Number(data.walk_direction);

    return {
      type: "world_interaction_update",
      world: cleanWorld(worldName),
      action,
      x: gridX,
      y: gridY,
      walk_direction: Number.isFinite(rawDirection) && rawDirection < 0 ? -1 : 1,
    };
  }

  if (action === "entrance_gate_move") {
    const x = Number(data.x);
    const y = Number(data.y);
    const oldX = Number(data.old_x);
    const oldY = Number(data.old_y);
    if (![x, y, oldX, oldY].every(Number.isFinite)) return null;
    const gridX = Math.trunc(x);
    const gridY = Math.trunc(y);
    const oldGridX = Math.trunc(oldX);
    const oldGridY = Math.trunc(oldY);
    if (!isGridInWorld(gridX, gridY) || !isGridInWorld(oldGridX, oldGridY)) return null;

    return {
      type: "world_interaction_update",
      world: cleanWorld(worldName),
      action,
      x: gridX,
      y: gridY,
      old_x: oldGridX,
      old_y: oldGridY,
    };
  }

  if (action === "wooden_entrance_state") {
    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const gridX = Math.trunc(x);
    const gridY = Math.trunc(y);
    if (!isGridInWorld(gridX, gridY)) return null;

    return {
      type: "world_interaction_update",
      world: cleanWorld(worldName),
      action,
      x: gridX,
      y: gridY,
      locked: Boolean(data.locked),
    };
  }

  if (action === "door_state") {
    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const gridX = Math.trunc(x);
    const gridY = Math.trunc(y);
    if (!isGridInWorld(gridX, gridY)) return null;
    const parsedDestination = parseDoorDestination(data.destination || data.door_destination || "", worldName);

    return {
      type: "world_interaction_update",
      world: cleanWorld(worldName),
      action,
      x: gridX,
      y: gridY,
      door_id: cleanDoorId(data.door_id || ""),
      destination: parsedDestination.destination,
      target_world: parsedDestination.target_world,
      target_door_id: parsedDestination.target_door_id,
      locked: Boolean(data.locked),
    };
  }

  if (action === "ceiling_lamp_state") {
    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const gridX = Math.trunc(x);
    const gridY = Math.trunc(y);
    if (!isGridInWorld(gridX, gridY)) return null;

    return {
      type: "world_interaction_update",
      world: cleanWorld(worldName),
      action,
      x: gridX,
      y: gridY,
      on: Boolean(data.on),
    };
  }

  if (action === "sign_text") {
    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const gridX = Math.trunc(x);
    const gridY = Math.trunc(y);
    if (!isGridInWorld(gridX, gridY)) return null;

    return {
      type: "world_interaction_update",
      world: cleanWorld(worldName),
      action,
      x: gridX,
      y: gridY,
      text: String(data.text || "").slice(0, MAX_SIGN_TEXT_LENGTH),
    };
  }

  if (action === "world_lock_state") {
    const state = data.state && typeof data.state === "object" && !Array.isArray(data.state) ? data.state : {};

    return {
      type: "world_interaction_update",
      world: cleanWorld(worldName),
      action,
      state: sanitizeWorldLockState(state),
    };
  }

  return null;
}

function sanitizeWorldLockState(state) {
  const rawState = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  const allowedPlayers = Array.isArray(rawState.allowed_players) ? rawState.allowed_players : [];
  const isLocked = Boolean(rawState.is_locked);
  const lockGridX = Math.trunc(Number(rawState.lock_grid_x) || WORLD_LOCK_GRID_SENTINEL);
  const lockGridY = Math.trunc(Number(rawState.lock_grid_y) || WORLD_LOCK_GRID_SENTINEL);
  const ownerName = cleanAccountName(rawState.owner_name || "").toUpperCase();
  const lockBlockType = isLocked
    ? normalizeWorldLockBlockType(rawState.lock_block_type || rawState.lock_type || WORLD_LOCK_BLOCK_TYPE)
    : WORLD_LOCK_BLOCK_TYPE;
  const allowedSet = new Set();
  const playerRoles = {};

  for (const rawName of allowedPlayers) {
    const cleanAllowedName = cleanAccountName(rawName).toUpperCase();
    if (cleanAllowedName.length === 0 || cleanAllowedName === ownerName) continue;
    allowedSet.add(cleanAllowedName);
  }

  const rawRoles = rawState.player_roles && typeof rawState.player_roles === "object" && !Array.isArray(rawState.player_roles)
    ? rawState.player_roles
    : {};
  for (const [rawName, rawRole] of Object.entries(rawRoles)) {
    const cleanRoleName = cleanAccountName(rawName).toUpperCase();
    if (cleanRoleName.length === 0 || cleanRoleName === ownerName) continue;
    allowedSet.add(cleanRoleName);
    playerRoles[cleanRoleName] = normalizeWorldLockAccessRole(rawRole, "builder");
  }

  const cleanAllowedPlayers = Array.from(allowedSet).slice(0, 100);
  for (const cleanAllowedName of cleanAllowedPlayers) {
    if (!playerRoles[cleanAllowedName]) {
      playerRoles[cleanAllowedName] = "builder";
    }
  }
  const rawTrustedBuilderSlotLimit = Number(rawState.trusted_builder_slot_limit);
  const trustedBuilderSlotLimit = Number.isFinite(rawTrustedBuilderSlotLimit)
    ? clampInteger(rawTrustedBuilderSlotLimit, MIN_TRUSTED_BUILDER_SLOT_LIMIT, MAX_TRUSTED_BUILDER_SLOT_LIMIT)
    : DEFAULT_TRUSTED_BUILDER_SLOT_LIMIT;

  return {
    is_locked: isLocked,
    owner_name: ownerName,
    lock_block_type: lockBlockType,
    lock_type: lockBlockType,
    lock_grid_x: lockGridX,
    lock_grid_y: lockGridY,
    allowed_players: cleanAllowedPlayers,
    player_roles: playerRoles,
    public_build: Boolean(rawState.public_build),
    trusted_builder_slot_limit: trustedBuilderSlotLimit,
  };
}

function interactionKey(update) {
  return gridKey(update.x, update.y);
}

function applyInteractionUpdateToWorldState(worldName, update) {
  const state = ensureWorldState(worldName);

  if (update.action === "wooden_entrance_state") {
    state.interactions.set(interactionKey(update), {
      action: update.action,
      x: update.x,
      y: update.y,
      locked: update.locked,
      world: cleanWorld(worldName),
    });
    return;
  }

  if (update.action === "door_state") {
    const key = interactionKey(update);
    const block = state.foreground.get(key);
    const hasDoorLink = cleanDoorId(update.door_id || "") !== "" || cleanDoorId(update.target_door_id || "") !== "";
    const keepLocked = isDoorBlockType(block?.block_type || "") && Boolean(update.locked);

    if (!hasDoorLink && !keepLocked) {
      state.interactions.delete(key);
      return;
    }

    state.interactions.set(key, {
      action: update.action,
      x: update.x,
      y: update.y,
      locked: Boolean(update.locked),
      world: cleanWorld(worldName),
      block_type: clampString(update.block_type || block?.block_type || ""),
      door_id: cleanDoorId(update.door_id || ""),
      destination: cleanDoorDestination(update.destination || ""),
      target_world: cleanWorld(update.target_world || worldName),
      target_door_id: cleanDoorId(update.target_door_id || ""),
    });
    return;
  }

  if (update.action === "ceiling_lamp_state") {
    state.interactions.set(interactionKey(update), {
      action: update.action,
      x: update.x,
      y: update.y,
      on: Boolean(update.on),
      world: cleanWorld(worldName),
    });
    return;
  }

  if (update.action === "sign_text") {
    state.interactions.set(interactionKey(update), {
      action: update.action,
      x: update.x,
      y: update.y,
      text: update.text,
      world: cleanWorld(worldName),
    });
    return;
  }

  if (update.action === "world_lock_state") {
    state.world_lock = update.state;
  }
}

function sanitizeDropCreate(data, worldName) {
  const itemType = clampString(data.item_type || data.type_id || data.item || "");
  if (itemType.length === 0) return null;
  if (!ItemDatabase.hasItem(itemType)) return null;
  if (!ItemDatabase.isDropableItem(itemType)) return null;

  const x = Number(data.x);
  const y = Number(data.y);
  if (!isPositionInWorldBounds(x, y)) return null;
  const stackGrid = getTransactionDropGrid(data, { x, y });

  const itemCategory = resolveInventoryCategory(itemType, data.item_category || "");
  if (!ItemDatabase.canStoreItemInCategory(itemType, itemCategory)) return null;

  return {
    type: "drop_spawned",
    world: cleanWorld(worldName),
    drop_id: makeServerDropId(worldName, itemType),
    item_type: itemType,
    item_category: itemCategory,
    is_seed: itemCategory === "seed",
    amount: clampInteger(data.amount || 1, 1, MAX_DROP_TILE_AMOUNT),
    x,
    y,
    stack_grid_x: stackGrid ? stackGrid.x : undefined,
    stack_grid_y: stackGrid ? stackGrid.y : undefined,
    pickup_delay: Math.max(0, Number(data.pickup_delay) || 0),
  };
}

function validateDropCreateAgainstServerState(socket, player, update) {
  if (!ItemDatabase.hasItem(update.item_type)) {
    sendActionRejected(socket, "world_item_drop_create", "That item does not exist on the server.");
    return false;
  }

  if (!ItemDatabase.isDropableItem(update.item_type)) {
    sendActionRejected(socket, "world_item_drop_create", "That item cannot be dropped.");
    return false;
  }

  if (!ItemDatabase.canStoreItemInCategory(update.item_type, update.item_category)) {
    sendActionRejected(socket, "world_item_drop_create", "That item category does not match the server.");
    return false;
  }

  if (!isPlayerNearPoint(player, update.x, update.y, MAX_DROP_CREATE_DISTANCE_PIXELS)) {
    sendActionRejected(socket, "world_item_drop_create", "Drop closer to your player.");
    return false;
  }

  const dropGrid = update.stack_grid_x !== undefined && update.stack_grid_y !== undefined
    ? { x: update.stack_grid_x, y: update.stack_grid_y }
    : getDropGridFromPosition(update);
  if (isDropGridBlockedByBlock(update.world, dropGrid)) {
    sendActionRejected(socket, "world_item_drop_create", "Can't drop on a block.");
    return false;
  }

  return true;
}

function sanitizeDropUpdate(data, worldName) {
  const dropId = clampString(data.drop_id || "", MAX_DROP_ID_LENGTH);
  if (dropId.length === 0) return null;

  const update = {
    type: "world_item_drop_update",
    world: cleanWorld(worldName),
    drop_id: dropId,
  };

  if (Object.prototype.hasOwnProperty.call(data, "amount")) {
    update.amount = clampInteger(data.amount || 0, 0, MAX_DROP_TILE_AMOUNT);
  }

  const x = Number(data.x);
  const y = Number(data.y);
  if (isPositionInWorldBounds(x, y)) {
    update.x = x;
    update.y = y;
  }

  return update;
}

function validateDropUpdateAgainstServerState(socket, player, worldName, update) {
  const state = ensureWorldState(worldName);
  const drop = state.drops.get(update.drop_id);
  if (!drop) {
    sendActionRejected(socket, "world_item_drop_update", "That drop no longer exists.");
    return false;
  }

  if (
    Object.prototype.hasOwnProperty.call(update, "amount") ||
    Object.prototype.hasOwnProperty.call(update, "x") ||
    Object.prototype.hasOwnProperty.call(update, "y")
  ) {
    sendActionRejected(socket, "world_item_drop_update", "Drop movement and amounts are server controlled.");
    return false;
  }

  if (!isPlayerNearPoint(player, drop.x, drop.y, MAX_DROP_CREATE_DISTANCE_PIXELS)) {
    sendActionRejected(socket, "world_item_drop_update", "Too far away.");
    return false;
  }

  return true;
}

function sanitizeDropPickup(data, worldName, player) {
  const dropId = clampString(data.drop_id || "", MAX_DROP_ID_LENGTH);
  if (dropId.length === 0) return null;
  const actionPosition = sanitizeOptionalDropPickupPosition(data, player, worldName);

  return {
    type: "world_item_drop_pickup",
    world: cleanWorld(worldName),
    drop_id: dropId,
    player_id: player.id,
    name: cleanName(player.name),
    action_position: actionPosition,
  };
}

function sanitizeOptionalDropPickupPosition(data, player, worldName) {
  if (!Object.prototype.hasOwnProperty.call(data, "x") || !Object.prototype.hasOwnProperty.call(data, "y")) {
    return null;
  }

  const position = sanitizePlayerPosition({
    x: data.x,
    y: data.y,
    facing: data.facing,
    world: data.world || worldName,
  }, player);
  if (!position) return null;
  if (cleanWorld(position.world) !== cleanWorld(worldName)) return null;
  return position;
}

function applyDropCreateToWorldState(worldName, update) {
  const state = ensureWorldState(worldName);
  state.drops.set(update.drop_id, {
    drop_id: update.drop_id,
    item_type: update.item_type,
    item_category: update.item_category,
    is_seed: update.is_seed,
    amount: update.amount,
    x: update.x,
    y: update.y,
    pickup_delay: update.pickup_delay,
  });
}

function applyDropUpdateToWorldState(worldName, update) {
  const state = ensureWorldState(worldName);
  const drop = state.drops.get(update.drop_id);
  if (!drop) return;

  if (Object.prototype.hasOwnProperty.call(update, "amount")) {
    if (update.amount <= 0) {
      state.drops.delete(update.drop_id);
      return;
    }
    drop.amount = Math.min(update.amount, drop.amount);
  }

  if (
    Object.prototype.hasOwnProperty.call(update, "x") &&
    Object.prototype.hasOwnProperty.call(update, "y")
  ) {
    drop.x = update.x;
    drop.y = update.y;
  }
}

function prepareDropPickup(worldName, player, update) {
  const found = findDropForPickup(worldName, update.drop_id);
  if (!found.drop) return { ok: false, reason: "not_available" };

  const drop = found.drop;
  const dropId = found.publicDropId;
  const dropStateKey = found.key;
  const cleanWorldName = cleanWorld(found.world || worldName);
  if (!isPlayerNearDrop(player, drop)) return { ok: false, reason: "too_far", drop, world: cleanWorldName };

  const itemType = clampString(drop.item_type || "");
  if (!ItemDatabase.hasItem(itemType)) return { ok: false, reason: "not_available", drop, world: cleanWorldName };
  const itemCategory = resolveInventoryCategory(itemType, drop.item_category || "");
  if (!ItemDatabase.canStoreItemInCategory(itemType, itemCategory)) return { ok: false, reason: "not_available", drop, world: cleanWorldName };

  const playerState = ensureWritablePlayerState(player.account_username);
  if (!playerState) return { ok: false, reason: "inventory_unavailable", drop, world: cleanWorldName };

  const stackLimit = ItemDatabase.getStackLimit(itemType);
  const dropAmount = clampInteger(drop.amount || 0, 0, MAX_DROP_TILE_AMOUNT);
  if (dropAmount <= 0) return { ok: false, reason: "not_available", world: cleanWorldName };

  const currentCount = getInventoryCount(playerState, itemType, itemCategory);
  const availableSpace = Math.max(0, stackLimit - currentCount);
  if (availableSpace <= 0) {
    return {
      ok: false,
      reason: "inventory_full",
      drop,
      world: cleanWorldName,
      item_type: itemType,
      item_category: itemCategory,
      stackLimit,
      currentCount,
      availableSpace,
      dropAmount,
    };
  }

  const pickedAmount = Math.min(dropAmount, availableSpace);
  if (pickedAmount <= 0) {
    return {
      ok: false,
      reason: "inventory_full",
      drop,
      world: cleanWorldName,
      item_type: itemType,
      item_category: itemCategory,
      stackLimit,
      currentCount,
      availableSpace,
      dropAmount,
      pickedAmount,
    };
  }

  return {
    ok: true,
    player: player,
    world: cleanWorldName,
    dropId,
    dropStateKey,
    drop: {
      ...drop,
      drop_id: dropId,
      item_type: itemType,
      item_category: itemCategory,
    },
    playerState,
    item_type: itemType,
    item_category: itemCategory,
    dropAmount,
    pickedAmount,
    remaining: Math.max(0, dropAmount - pickedAmount),
  };
}

function applyDropPickupWorldState(worldName, pickupPlan) {
  if (!pickupPlan) return { ok: false, reason: "not_available" };
  const state = ensureWorldState(worldName);
  const dropId = clampString(pickupPlan.dropId || "", MAX_DROP_ID_LENGTH);
  const targetDropId = clampString(pickupPlan.drop?.drop_id || dropId, MAX_DROP_ID_LENGTH);
  let dropStateKey = clampString(pickupPlan.dropStateKey || "", MAX_DROP_ID_LENGTH);
  let drop = null;

  if (dropStateKey && state.drops.has(dropStateKey)) {
    drop = state.drops.get(dropStateKey);
  } else {
    for (const [candidateKey, candidateDrop] of state.drops.entries()) {
      const candidateDropId = clampString(candidateDrop?.drop_id || candidateKey || "", MAX_DROP_ID_LENGTH);
      if (candidateDropId === targetDropId) {
        drop = candidateDrop;
        dropStateKey = candidateKey;
        break;
      }
    }
  }

  if (!drop) {
    const found = findDropForPickup(worldName, dropId);
    if (found && found.drop) {
      drop = found.drop;
      dropStateKey = found.key;
    }
  }

  if (!drop || !dropStateKey) {
    return { ok: false, reason: "not_available" };
  }

  if (pickupPlan.remaining <= 0) {
    for (const [candidateKey, candidateDrop] of state.drops.entries()) {
      if (candidateKey === dropStateKey || candidateDrop === drop || clampString(candidateDrop?.drop_id || "", MAX_DROP_ID_LENGTH) === dropId) {
        state.drops.delete(candidateKey);
      }
    }
    return {
      ok: true,
      payload: {
        type: "world_item_drop_remove",
        world: cleanWorld(worldName),
        drop_id: dropId,
        remaining: 0,
        removed: true,
        requested_by: pickupPlan.player?.id || "",
        requested_by_name: cleanName(pickupPlan.player?.name || ""),
      },
    };
  }

  const remainingAmount = Math.max(0, Number(pickupPlan.remaining) || 0);
  if (!state.drops.has(dropStateKey)) {
    return { ok: false, reason: "not_available" };
  }
  drop.amount = remainingAmount;

  return {
    ok: true,
    payload: {
      type: "world_item_drop_update",
      world: cleanWorld(worldName),
      drop_id: dropId,
      item_type: pickupPlan.item_type,
      item_category: pickupPlan.item_category,
      amount: Math.max(0, Number(drop.amount || 0)),
      remaining: pickupPlan.remaining,
      requested_by: pickupPlan.player?.id || "",
      requested_by_name: cleanName(pickupPlan.player?.name || ""),
    },
  };
}

function findDropForPickup(worldName, dropId) {
  const cleanWorldName = cleanWorld(worldName);
  const cleanDropId = clampString(dropId || "", MAX_DROP_ID_LENGTH);
  const state = ensureWorldState(cleanWorldName);

  if (state.drops.has(cleanDropId)) {
    return {
      state,
      drop: state.drops.get(cleanDropId),
      key: cleanDropId,
      publicDropId: cleanDropId,
      world: cleanWorldName,
    };
  }

  for (const [candidateId, candidateDrop] of state.drops.entries()) {
    const candidateDropId = clampString(candidateDrop?.drop_id || candidateId || "", MAX_DROP_ID_LENGTH);
    if (candidateDropId === cleanDropId) {
      return {
        state,
        drop: candidateDrop,
        key: candidateId,
        publicDropId: candidateDropId,
        world: cleanWorldName,
      };
    }
  }

  return {
    state,
    drop: null,
    key: cleanDropId,
    publicDropId: cleanDropId,
    world: cleanWorldName,
  };
}

function logDropPickupNotAvailable(player, worldName, dropId) {
  const cleanWorldName = cleanWorld(worldName);
  const state = ensureWorldState(cleanWorldName);
  const cleanDropId = clampString(dropId || "", MAX_DROP_ID_LENGTH);
  const loadedWorldsWithDrop = [];
  for (const [loadedWorldName, loadedState] of worldStates.entries()) {
    if (!loadedState || !loadedState.drops) continue;
    if (loadedState.drops.has(cleanDropId)) {
      loadedWorldsWithDrop.push(loadedWorldName);
      continue;
    }
    for (const [candidateId, candidateDrop] of loadedState.drops.entries()) {
      const candidateDropId = clampString(candidateDrop?.drop_id || candidateId || "", MAX_DROP_ID_LENGTH);
      if (candidateDropId === cleanDropId) {
        loadedWorldsWithDrop.push(loadedWorldName);
        break;
      }
    }
  }
  console.warn("[drop_pickup_missing]", {
    username: cleanAccountName(player?.account_username || player?.name || ""),
    current_world: cleanWorldName,
    player_world: cleanWorld(player?.world || "START"),
    requested_drop_id: cleanDropId,
    world_drop_count: state.drops.size,
    has_drop_key: state.drops.has(cleanDropId),
    loaded_worlds_with_drop: loadedWorldsWithDrop,
  });
}

function logDropPickupTooFar(player, worldName, dropId, drop, update = {}) {
  const actionPosition = update?.action_position || null;
  console.warn("[drop_pickup_too_far]", {
    username: cleanAccountName(player?.account_username || player?.name || ""),
    current_world: cleanWorld(worldName),
    requested_drop_id: clampString(dropId || "", MAX_DROP_ID_LENGTH),
    player_x: Number(player?.x || 0),
    player_y: Number(player?.y || 0),
    drop_x: Number(drop?.x || 0),
    drop_y: Number(drop?.y || 0),
    distance: Math.hypot(Number(player?.x || 0) - Number(drop?.x || 0), Number(player?.y || 0) - Number(drop?.y || 0)),
    max_distance: MAX_PICKUP_DISTANCE_PIXELS,
    action_x: actionPosition ? Number(actionPosition.x || 0) : null,
    action_y: actionPosition ? Number(actionPosition.y || 0) : null,
  });
}

function logDropPickupInventoryIssue(reason, player, worldName, dropId, pickupPlan = {}, transaction = {}) {
  console.warn("[drop_pickup_inventory_issue]", {
    reason: cleanName(reason),
    username: cleanAccountName(player?.account_username || player?.name || ""),
    current_world: cleanWorld(worldName),
    requested_drop_id: clampString(dropId || "", MAX_DROP_ID_LENGTH),
    item_type: cleanName(pickupPlan?.item_type || transaction?.item_type || ""),
    item_category: cleanName(pickupPlan?.item_category || transaction?.item_category || ""),
    stack_limit: Number(pickupPlan?.stackLimit || transaction?.stack_limit || 0),
    current_count: Number(pickupPlan?.currentCount || 0),
    available_space: Number(pickupPlan?.availableSpace || 0),
    picked_amount: Number(pickupPlan?.pickedAmount || 0),
    drop_amount: Number(pickupPlan?.dropAmount || 0),
    before_amount: Number(transaction?.before_amount || 0),
    after_amount: Number(transaction?.after_amount || 0),
    transaction_reason: cleanName(transaction?.reason || ""),
    transaction_message: cleanName(transaction?.message || ""),
  });
}

function isPlayerNearDrop(player, drop) {
  if (!player || !drop) return false;
  if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
  if (!Number.isFinite(drop.x) || !Number.isFinite(drop.y)) return false;

  return Math.hypot(player.x - drop.x, player.y - drop.y) <= MAX_PICKUP_DISTANCE_PIXELS;
}

function getForegroundNetworkPriority(entry) {
  return clampString(entry?.block_type || "") === ENTRANCE_GATE_TYPE ? 0 : 1;
}

function getForegroundBlocksForState(state, worldName = "") {
  const blocks = [];

  for (const block of state.foreground.values()) {
    const entry = { ...block };
    const interaction = state.interactions.get(gridKey(block.x, block.y));
    const blockType = clampString(entry.block_type || "");
    if (!isDoorBlockType(blockType)) {
      delete entry.door_id;
      delete entry.door_destination;
      delete entry.door_target_world;
      delete entry.door_target_id;
    }

    if (interaction && interaction.action === "wooden_entrance_state" && isEntranceBlockType(blockType)) {
      entry.entrance_locked = Boolean(interaction.locked);
    } else if (interaction && interaction.action === "door_state" && isEntranceBlockType(blockType)) {
      entry.entrance_locked = Boolean(interaction.locked);
    } else if (interaction && interaction.action === "door_state" && isDoorBlockType(blockType)) {
      entry.entrance_locked = Boolean(interaction.locked);
      entry.door_id = cleanDoorId(interaction.door_id || "");
      entry.door_destination = cleanDoorDestination(interaction.destination || interaction.door_destination || "");
      entry.door_target_world = cleanWorld(interaction.target_world || interaction.door_target_world || worldName);
      entry.door_target_id = cleanDoorId(interaction.target_door_id || interaction.door_target_id || "");
    } else if (interaction && interaction.action === "sign_text" && isSignBlockType(blockType)) {
      entry.sign_text = String(interaction.text || "");
    } else if (interaction && interaction.action === "ceiling_lamp_state" && isToggleBlockType(blockType)) {
      entry.toggle_on = Boolean(interaction.on);
    }

    blocks.push(entry);
  }

  blocks.sort((a, b) => getForegroundNetworkPriority(a) - getForegroundNetworkPriority(b));
  return blocks;
}

function serializeWorldState(worldName) {
  const state = ensureWorldState(worldName);

  return {
    world_state_version: 1,
    world_name: cleanWorld(worldName),
    saved_at: new Date().toISOString(),
    cleared: Boolean(state.cleared),
    blocks: getForegroundBlocksForState(state, worldName),
    background_blocks: Array.from(state.background.values()),
    removed_foreground: state.cleared ? [] : Array.from(state.removed_foreground.values()),
    removed_background: state.cleared ? [] : Array.from(state.removed_background.values()),
    seeds: Array.from(state.seeds.values()).map(serializeSeedForMessage),
    interactions: Array.from(state.interactions.values()),
    world_lock: state.world_lock || {},
    drops: Array.from(state.drops.values()),
    active_event_type: state.active_event_type || "",
    event_id: state.event_id || "",
    event_started_at: state.event_started_at || "",
    event_ends_at: state.event_ends_at || "",
    event_changed_tiles: Array.isArray(state.event_changed_tiles) ? state.event_changed_tiles.map((entry) => ({ ...entry })) : [],
    active_event: buildActiveWorldEventSnapshot(state),
  };
}

function getWorldBlockTypeAt(worldName, x, y, layer = "foreground") {
  const state = ensureWorldState(worldName);
  const target = String(layer || "").toLowerCase() === "background" ? state.background : state.foreground;
  const block = target.get(gridKey(x, y));
  return clampString(block?.block_type || "");
}

function getWorldObjectJournalType(update = {}) {
  const action = clampString(update.action || "", 80).toLowerCase();
  if (action.includes("vend")) return "vending";
  if (action.includes("safe")) return "safe";
  if (action === "world_lock_state" || action.includes("world_lock")) return "world_lock";
  if (action === "sign_text" || action.includes("sign")) return "sign";
  if (action === "door_state" || action.includes("door")) return "door";
  if (action === "wooden_entrance_state" || action.includes("entrance")) return "wooden_entrance";
  if (action.includes("lamp") || action.includes("toggle")) return "toggle";
  return "interaction";
}

function getWorldObjectJournalId(worldName, update = {}, objectType = "") {
  const explicit = clampString(update.object_id || "");
  if (explicit !== "") return explicit;

  const cleanType = clampString(objectType || getWorldObjectJournalType(update), 80) || "interaction";
  const doorId = cleanDoorId(update.door_id || "");
  if (doorId !== "") return `door:${doorId}`;
  if (cleanType === "world_lock") return `${cleanWorld(worldName)}:world_lock`;

  const x = Number.isFinite(Number(update.x)) ? Math.trunc(Number(update.x)) : 0;
  const y = Number.isFinite(Number(update.y)) ? Math.trunc(Number(update.y)) : 0;
  return `${cleanType}:${x}:${y}`;
}

function getWorldObjectJournalData(worldName, update = {}) {
  const state = ensureWorldState(worldName);
  const action = clampString(update.action || "", 80).toLowerCase();

  if (action === "world_lock_state") {
    return cloneJson(state.world_lock || {});
  }

  const key = gridKey(update.x, update.y);
  const interaction = state.interactions.get(key);
  if (!interaction) return {};

  const block = state.foreground.get(key);
  return cloneJson({
    block_type: clampString(update.block_type || block?.block_type || interaction.block_type || ""),
    ...interaction,
  });
}

function buildWorldInteractionDetails(update = {}) {
  const interactionDetails = {};
  if (update.action === "world_lock_state" && update.state) {
    interactionDetails.is_locked = Boolean(update.state.is_locked);
    interactionDetails.owner_name = cleanName(update.state.owner_name || "");
    interactionDetails.lock_grid_x = Number(update.state.lock_grid_x);
    interactionDetails.lock_grid_y = Number(update.state.lock_grid_y);
    interactionDetails.allowed_count = Array.isArray(update.state.allowed_players) ? update.state.allowed_players.length : 0;
    interactionDetails.public_build = Boolean(update.state.public_build);
  } else if (update.action === "sign_text") {
    interactionDetails.text_length = String(update.text || "").length;
  } else if (update.action === "wooden_entrance_state") {
    interactionDetails.locked = Boolean(update.locked);
  } else if (update.action === "door_state") {
    interactionDetails.door_id = update.door_id;
    interactionDetails.target_world = update.target_world;
    interactionDetails.target_door_id = update.target_door_id;
    interactionDetails.locked = Boolean(update.locked);
  } else if (update.action === "ceiling_lamp_state") {
    interactionDetails.on = Boolean(update.on);
  } else if (String(update.action || "").includes("vend")) {
    interactionDetails.vending_action = String(update.action || "");
  } else if (String(update.action || "").includes("safe")) {
    interactionDetails.safe_action = String(update.action || "");
  }
  return interactionDetails;
}

function buildWorldObjectChangeEntry(socket, player, worldName, update = {}, oldData = {}, newData = {}, sourceId = "", details = {}) {
  const objectType = getWorldObjectJournalType(update);
  return {
    ...getAuditActor(socket, player),
    source_type: String(update.source_type || "world_interaction_update"),
    source_id: String(sourceId || update.source_id || makeAuditId("interact")),
    request_id: String(update.request_id || ""),
    world: cleanWorld(worldName),
    action: String(update.action || "update"),
    layer: "object",
    x: Number.isFinite(Number(update.x)) ? Math.trunc(Number(update.x)) : null,
    y: Number.isFinite(Number(update.y)) ? Math.trunc(Number(update.y)) : null,
    block_type: clampString(update.block_type || oldData?.block_type || newData?.block_type || ""),
    object_type: objectType,
    object_id: getWorldObjectJournalId(worldName, update, objectType),
    old_data: cloneJson(oldData || {}),
    new_data: cloneJson(newData || {}),
    details,
  };
}

function buildWorldStateMessage(worldName, extraMessageData = {}) {
  const state = ensureWorldState(worldName);
  return {
    type: "world_state",
    world: cleanWorld(worldName),
    cleared: Boolean(state.cleared),
    foreground: getForegroundBlocksForState(state, worldName),
    background: Array.from(state.background.values()),
    removed_foreground: state.cleared ? [] : Array.from(state.removed_foreground.values()),
    removed_background: state.cleared ? [] : Array.from(state.removed_background.values()),
    seeds: Array.from(state.seeds.values()).map(serializeSeedForMessage),
    interactions: Array.from(state.interactions.values()),
    world_lock: state.world_lock || {},
    drops: Array.from(state.drops.values()),
    active_event_type: state.active_event_type || "",
    event_id: state.event_id || "",
    event_started_at: state.event_started_at || "",
    event_ends_at: state.event_ends_at || "",
    event_remaining_ms: getActiveWorldEventRemainingMs(state),
    active_event: buildActiveWorldEventSnapshot(state),
    ...extraMessageData,
  };
}

function getActiveWorldEventRemainingMs(state) {
  if (!state || state.active_event_type !== SNOW_STORM_EVENT_TYPE) return 0;
  const endsAt = Date.parse(state.event_ends_at || "");
  if (!Number.isFinite(endsAt)) return 0;
  return Math.max(0, endsAt - Date.now());
}

function buildActiveWorldEventSnapshot(state) {
  if (!state || state.active_event_type !== SNOW_STORM_EVENT_TYPE) return {};
  return {
    type: state.active_event_type,
    event_type: state.active_event_type,
    event_id: state.event_id || "",
    started_at: state.event_started_at || "",
    ends_at: state.event_ends_at || "",
    remaining_ms: getActiveWorldEventRemainingMs(state),
    changed_tile_count: Array.isArray(state.event_changed_tiles) ? state.event_changed_tiles.length : 0,
  };
}

function queueWorldSave(worldName) {
  const clean = cleanWorld(worldName);
  const existingTimer = worldSaveTimers.get(clean);
  if (existingTimer) clearTimeout(existingTimer);

  worldSaveTimers.set(clean, setTimeout(() => {
    worldSaveTimers.delete(clean);
    saveWorldState(clean);
  }, SAVE_DEBOUNCE_MS));
}

function saveWorldState(worldName) {
  const clean = cleanWorld(worldName);
  const serialized = serializeWorldState(clean);
  writeWorldStateJsonBackup(clean, serialized);
  if (postgresStore.isReady()) {
    trackPersistenceWrite(postgresStore.saveWorldState(clean, serialized), `world state ${clean}`);
  }
}

async function commitWorldStateWithBlockChanges(worldName, changes = []) {
  const clean = cleanWorld(worldName);
  const serialized = serializeWorldState(clean);

  if (isPostgresAuthoritativeReady()) {
    const result = await postgresStore.saveWorldStateWithWorldChanges(clean, serialized, changes);
    if (!result || !result.ok) {
      return {
        ok: false,
        reason: result?.reason || "postgres_failed",
        message: result?.reason === "postgres_unavailable"
          ? "PostgreSQL is not ready."
          : "PostgreSQL rejected the world update.",
      };
    }
    writeWorldStateJsonBackup(clean, serialized);
    return { ok: true, postgres_committed: true, serialized };
  }

  if (POSTGRES_ENABLED && POSTGRES_AUTHORITATIVE) {
    return { ok: false, reason: "postgres_unavailable", message: "PostgreSQL is not ready." };
  }

  saveWorldState(clean);
  return { ok: true, postgres_committed: false, serialized };
}

async function commitWorldEventStateOnly(worldName) {
  const clean = cleanWorld(worldName);
  const serialized = serializeWorldState(clean);

  if (isPostgresAuthoritativeReady()) {
    const saved = await postgresStore.saveWorldState(clean, serialized);
    if (!saved) {
      return { ok: false, reason: "database_error", message: "PostgreSQL rejected the world event update." };
    }
    writeWorldStateJsonBackup(clean, serialized);
    return { ok: true, postgres_committed: true, serialized };
  }

  if (POSTGRES_ENABLED && POSTGRES_AUTHORITATIVE) {
    return { ok: false, reason: "postgres_unavailable", message: "PostgreSQL is not ready." };
  }

  saveWorldState(clean);
  return { ok: true, postgres_committed: false, serialized };
}

function clearWorldEventState(state) {
  if (!state) return;
  state.active_event_type = "";
  state.event_id = "";
  state.event_started_at = "";
  state.event_ends_at = "";
  state.event_changed_tiles = [];
}

function hasActiveSnowStormEvent(state) {
  if (!state || state.active_event_type !== SNOW_STORM_EVENT_TYPE) return false;
  const endsAt = Date.parse(state.event_ends_at || "");
  return Number.isFinite(endsAt) && endsAt > Date.now();
}

function consumeSnowStormCommandCooldown(worldName) {
  if (SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS <= 0) return { ok: true, retry_ms: 0 };

  const key = `${cleanWorld(worldName)}:${SNOW_STORM_EVENT_TYPE}`;
  const now = Date.now();
  const lastActionAt = Number(worldEventCommandCooldowns.get(key) || 0);
  const retryMs = SNOW_STORM_EVENT_COMMAND_COOLDOWN_MS - (now - lastActionAt);
  if (retryMs > 0) {
    return { ok: false, retry_ms: retryMs };
  }

  worldEventCommandCooldowns.set(key, now);
  return { ok: true, retry_ms: 0 };
}

function buildWorldEventStartedMessage(worldName, state) {
  return {
    type: "event_started",
    world: cleanWorld(worldName),
    event_type: SNOW_STORM_EVENT_TYPE,
    event_name: SNOW_STORM_EVENT_TYPE,
    event_id: state?.event_id || "",
    started_at: state?.event_started_at || "",
    ends_at: state?.event_ends_at || "",
    duration_ms: SNOW_STORM_EVENT_DURATION_MS,
    remaining_ms: getActiveWorldEventRemainingMs(state),
    message: SNOW_STORM_SYSTEM_MESSAGE,
  };
}

function buildActiveWorldEventTileUpdates(worldName, state) {
  const clean = cleanWorld(worldName);
  if (!hasActiveSnowStormEvent(state)) return [];
  const eventId = state.event_id || "";
  const tiles = Array.isArray(state.event_changed_tiles) ? state.event_changed_tiles : [];
  const updates = [];

  for (const rawTile of tiles) {
    const tile = normalizeWorldEventTileEntry(rawTile, eventId);
    if (tile.event_block_id === "") continue;
    updates.push({
      type: "world_block_update",
      action: "place",
      layer: "foreground",
      x: tile.x,
      y: tile.y,
      block_type: tile.event_block_id,
      world: clean,
    });
  }

  return updates;
}

function sendEventTileUpdatesToSocket(socket, worldName, eventId, phase, updates = []) {
  const clean = cleanWorld(worldName);
  const safeUpdates = Array.isArray(updates) ? updates : [];
  const batchCount = Math.ceil(safeUpdates.length / SNOW_STORM_EVENT_TILE_BATCH_SIZE);

  for (let index = 0; index < safeUpdates.length; index += SNOW_STORM_EVENT_TILE_BATCH_SIZE) {
    sendJson(socket, {
      type: "event_tile_updates",
      world: clean,
      event_type: SNOW_STORM_EVENT_TYPE,
      event_id: eventId || "",
      phase,
      batch_index: Math.floor(index / SNOW_STORM_EVENT_TILE_BATCH_SIZE),
      batch_count: batchCount,
      updates: safeUpdates.slice(index, index + SNOW_STORM_EVENT_TILE_BATCH_SIZE),
    });
  }
}

function sendActiveWorldEventState(socket, worldName) {
  const state = ensureWorldState(worldName);
  if (!hasActiveSnowStormEvent(state)) return;
  sendJson(socket, buildWorldEventStartedMessage(worldName, state));
  sendEventTileUpdatesToSocket(
    socket,
    worldName,
    state.event_id || "",
    "sync",
    buildActiveWorldEventTileUpdates(worldName, state)
  );
}

function buildWorldEventEndedMessage(worldName, eventId = "", endedAt = new Date().toISOString()) {
  return {
    type: "event_ended",
    world: cleanWorld(worldName),
    event_type: SNOW_STORM_EVENT_TYPE,
    event_name: SNOW_STORM_EVENT_TYPE,
    event_id: eventId,
    ended_at: endedAt,
  };
}

function broadcastEventSystemMessage(worldName, eventId, message) {
  broadcastToWorld(worldName, {
    type: "event_system_message",
    world: cleanWorld(worldName),
    event_type: SNOW_STORM_EVENT_TYPE,
    event_id: eventId || "",
    message,
  });
  broadcastSystemToWorld(worldName, message);
}

function buildSnowStormCountdownMessage(label) {
  return `Snow Storm has ${label} left.`;
}

function clearWorldEventCountdownTimers(worldName) {
  const clean = cleanWorld(worldName);
  const timers = worldEventCountdownTimers.get(clean);
  if (Array.isArray(timers)) {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  }
  worldEventCountdownTimers.delete(clean);
}

function scheduleWorldEventCountdowns(worldName) {
  const clean = cleanWorld(worldName);
  clearWorldEventCountdownTimers(clean);

  const state = ensureWorldState(clean);
  if (state.active_event_type !== SNOW_STORM_EVENT_TYPE) return;

  const endsAt = Date.parse(state.event_ends_at || "");
  if (!Number.isFinite(endsAt)) return;

  const eventId = state.event_id || "";
  const timers = [];
  for (const countdown of SNOW_STORM_COUNTDOWN_MESSAGES) {
    const fireInMs = endsAt - countdown.remainingMs - Date.now();
    if (fireInMs <= 0) continue;
    const timer = setTimeout(() => {
      const liveState = ensureWorldState(clean);
      if (liveState.active_event_type !== SNOW_STORM_EVENT_TYPE) return;
      if ((liveState.event_id || "") !== eventId) return;
      broadcastEventSystemMessage(clean, liveState.event_id || "", buildSnowStormCountdownMessage(countdown.label));
    }, fireInMs);
    if (typeof timer.unref === "function") timer.unref();
    timers.push(timer);
  }

  if (timers.length > 0) {
    worldEventCountdownTimers.set(clean, timers);
  }
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function broadcastEventTileUpdates(worldName, eventId, phase, updates = []) {
  const clean = cleanWorld(worldName);
  const safeUpdates = Array.isArray(updates) ? updates : [];
  const batchCount = Math.ceil(safeUpdates.length / SNOW_STORM_EVENT_TILE_BATCH_SIZE);
  for (let index = 0; index < safeUpdates.length; index += SNOW_STORM_EVENT_TILE_BATCH_SIZE) {
    const batch = safeUpdates.slice(index, index + SNOW_STORM_EVENT_TILE_BATCH_SIZE);
    broadcastToWorld(clean, {
      type: "event_tile_updates",
      world: clean,
      event_type: SNOW_STORM_EVENT_TYPE,
      event_id: eventId || "",
      phase,
      batch_index: Math.floor(index / SNOW_STORM_EVENT_TILE_BATCH_SIZE),
      batch_count: batchCount,
      updates: batch,
    });
    if (
      SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS > 0 &&
      index + SNOW_STORM_EVENT_TILE_BATCH_SIZE < safeUpdates.length
    ) {
      await sleepMs(SNOW_STORM_EVENT_BROADCAST_BATCH_DELAY_MS);
    }
  }
}

function scheduleWorldEventEnd(worldName) {
  const clean = cleanWorld(worldName);
  const existing = worldEventTimers.get(clean);
  if (existing) clearTimeout(existing);
  worldEventTimers.delete(clean);
  scheduleWorldEventCountdowns(clean);

  const state = ensureWorldState(clean);
  if (state.active_event_type !== SNOW_STORM_EVENT_TYPE) return;

  const endsAt = Date.parse(state.event_ends_at || "");
  if (!Number.isFinite(endsAt)) return;
  const timer = setTimeout(() => {
    worldEventTimers.delete(clean);
    endSnowStormEvent(clean, { reason: "timer" }).catch((error) => {
      console.warn("[world_event] snow_storm end failed:", error.message);
    });
  }, Math.max(0, endsAt - Date.now()));
  if (typeof timer.unref === "function") timer.unref();
  worldEventTimers.set(clean, timer);
}

async function recoverWorldEventsAfterLoad() {
  for (const [worldName, state] of worldStates.entries()) {
    if (!state || state.active_event_type !== SNOW_STORM_EVENT_TYPE) continue;
    const endsAt = Date.parse(state.event_ends_at || "");
    if (!Number.isFinite(endsAt) || endsAt <= Date.now()) {
      await endSnowStormEvent(worldName, { reason: "startup_expired", broadcast: false });
    } else {
      scheduleWorldEventEnd(worldName);
    }
  }
}

function startWorldEventRandomScheduler() {
  if (!SNOW_STORM_RANDOM_EVENTS_ENABLED || worldEventRandomTimer) return;
  worldEventRandomTimer = setInterval(() => {
    tryStartRandomSnowStormEvent().catch((error) => {
      console.warn("[world_event] random snow_storm start failed:", error.message);
    });
  }, SNOW_STORM_RANDOM_INTERVAL_MS);
  if (typeof worldEventRandomTimer.unref === "function") worldEventRandomTimer.unref();
}

function getActiveWorldNamesForEvents() {
  const names = new Set();
  for (const player of players.values()) {
    if (!player?.authenticated || !player.joined_world) continue;
    const worldName = cleanWorld(player.world || player.current_world || "");
    if (worldName !== "") names.add(worldName);
  }
  return Array.from(names);
}

async function tryStartRandomSnowStormEvent() {
  const activeWorlds = getActiveWorldNamesForEvents()
    .filter((worldName) => !hasActiveSnowStormEvent(ensureWorldState(worldName)));
  if (activeWorlds.length === 0) return { ok: false, reason: "no_active_world" };
  if (!randomChance(SNOW_STORM_RANDOM_CHANCE)) return { ok: false, reason: "chance_missed" };

  const worldName = activeWorlds[crypto.randomInt(0, activeWorlds.length)];
  return startSnowStormEvent(worldName, { reason: "random" });
}

function makeDeterministicRng(seedText) {
  const digest = crypto.createHash("sha256").update(String(seedText || "")).digest();
  let state = digest.readUInt32LE(0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicInt(rng, min, max) {
  const safeMin = Math.trunc(Number(min) || 0);
  const safeMax = Math.trunc(Number(max) || safeMin);
  if (safeMax <= safeMin) return safeMin;
  return safeMin + Math.floor(rng() * (safeMax - safeMin + 1));
}

function deterministicTileVariantIndex(x, y, count, salt = 0) {
  const safeCount = Math.trunc(Number(count) || 0);
  if (safeCount <= 1) return 0;
  const value = (
    Math.trunc(Number(x) || 0) * 73856093 +
    Math.trunc(Number(y) || 0) * 19349663 +
    Math.trunc(Number(salt) || 0) * 83492791
  );
  return ((value % safeCount) + safeCount) % safeCount;
}

function serverWorldGenerationSeed(worldName) {
  const source = `PIXELMANIA_WORLD_${cleanWorld(worldName).toUpperCase() || "START"}`;
  let value = 173;
  for (let i = 0; i < source.length; i += 1) {
    value = (value * 131 + source.charCodeAt(i)) % 2147483647;
  }
  return Math.max(1, value);
}

function serverCellNoise(generationSeed, x, y, salt = 0) {
  const seedOffset = (generationSeed % 1000003) * 0.0001;
  const value = Math.sin((Number(x) || 0) * 12.9898 + (Number(y) || 0) * 78.233 + (Number(salt) || 0) * 37.719 + seedOffset) * 43758.5453123;
  return value - Math.floor(value);
}

function serverGenerationMinSurfaceY() {
  return Math.max(3, (BEDROCK_START_Y - 15) + SERVER_TERRAIN_SURFACE_VERTICAL_OFFSET - SERVER_TERRAIN_EXTRA_HILL_RANGE);
}

function serverGenerationMaxSurfaceY() {
  return Math.max(serverGenerationMinSurfaceY(), (BEDROCK_START_Y - 8) + SERVER_TERRAIN_SURFACE_VERTICAL_OFFSET + SERVER_TERRAIN_EXTRA_HILL_RANGE);
}

function serverGenerationSurfaceBaseY() {
  return clampInteger((BEDROCK_START_Y - 9) + SERVER_TERRAIN_SURFACE_VERTICAL_OFFSET, serverGenerationMinSurfaceY(), serverGenerationMaxSurfaceY());
}

function isServerSpawnSafeColumn(x) {
  return Math.abs(Math.trunc(Number(x) || 0) - 10) <= 3;
}

function buildServerTerrainSurface(worldName) {
  const generationSeed = serverWorldGenerationSeed(worldName);
  const baseSurfaceY = serverGenerationSurfaceBaseY();
  const minSurfaceY = serverGenerationMinSurfaceY();
  const maxSurfaceY = serverGenerationMaxSurfaceY();
  const phaseA = serverCellNoise(generationSeed, 1, 1, 5001) * Math.PI * 2;
  const phaseB = serverCellNoise(generationSeed, 2, 1, 5002) * Math.PI * 2;
  const phaseC = serverCellNoise(generationSeed, 3, 1, 5003) * Math.PI * 2;
  const surface = new Map();

  for (let x = 0; x < WORLD_WIDTH; x += 1) {
    if (isServerSpawnSafeColumn(x)) {
      surface.set(x, baseSurfaceY);
      continue;
    }

    const drift = Math.round((serverCellNoise(generationSeed, Math.floor(x / 6), 0, 5004) - 0.5) * 4);
    const wave1 = Math.sin(x * 0.070 + phaseA) * 4.8;
    const wave2 = Math.sin(x * 0.145 + phaseB) * 2.4;
    const wave3 = Math.sin(x * 0.310 + phaseC) * 1.2;
    surface.set(x, clampInteger(Math.round(baseSurfaceY + wave1 + wave2 + wave3 + drift), minSurfaceY, maxSurfaceY));
  }

  for (let pass = 0; pass < 3; pass += 1) {
    for (let x = 1; x < WORLD_WIDTH - 1; x += 1) {
      if (isServerSpawnSafeColumn(x)) {
        surface.set(x, baseSurfaceY);
        continue;
      }

      let current = surface.get(x);
      const left = surface.get(x - 1);
      const right = surface.get(x + 1);
      if (current < left - 1) current = left - 1;
      if (current > left + 1) current = left + 1;
      if (current < right - 1) current = right - 1;
      if (current > right + 1) current = right + 1;
      surface.set(x, clampInteger(current, minSurfaceY, maxSurfaceY));
    }
  }

  return { generationSeed, surface };
}

function serverSurfaceYAt(surface, x) {
  const safeX = clampInteger(x, 0, WORLD_WIDTH - 1);
  return surface.has(safeX) ? surface.get(safeX) : serverGenerationSurfaceBaseY();
}

function serverPickWeightedBlock(generationSeed, x, y, options) {
  const total = options.reduce((sum, option) => sum + Math.max(0, Number(option.weight) || 0), 0);
  if (total <= 0) return "dirt";
  let roll = serverCellNoise(generationSeed, x, y, 9047) * total;
  for (const option of options) {
    roll -= Math.max(0, Number(option.weight) || 0);
    if (roll <= 0) return option.type || "dirt";
  }
  return options[options.length - 1]?.type || "dirt";
}

function isServerBottomLavaStoneLayer(y) {
  const depth = BEDROCK_START_Y - Math.trunc(Number(y) || 0);
  return depth >= 1 && depth <= SERVER_BOTTOM_LAVA_STONE_HEIGHT;
}

function serverShallowCaveAxis(generationSeed, x, surfaceY) {
  return surfaceY + 13 + Math.round((serverCellNoise(generationSeed, x, surfaceY, 801) - 0.5) * 5.6 + (serverCellNoise(generationSeed, surfaceY, x, 802) - 0.5) * 4.0);
}

function serverDeepCaveAxis(generationSeed, x, surfaceY) {
  return surfaceY + 23 + Math.round((serverCellNoise(generationSeed, x, surfaceY, 803) - 0.5) * 7.6 + (serverCellNoise(generationSeed, surfaceY, x, 804) - 0.5) * 3.6);
}

function shouldServerGenerateCavePocket(generationSeed, x, y, surfaceY) {
  const depth = y - surfaceY;
  if (depth < SERVER_CAVE_MIN_DEPTH) return false;
  if (isServerSpawnSafeColumn(x)) return false;
  if (y >= BEDROCK_START_Y - SERVER_CAVE_BOTTOM_SOLID_PADDING) return false;
  if (isServerBottomLavaStoneLayer(y)) return false;

  if (depth >= SERVER_SHALLOW_CAVE_START_DEPTH) {
    const axis = serverShallowCaveAxis(generationSeed, x, surfaceY);
    const distance = Math.abs(y - axis);
    const width = 1.2 + (serverCellNoise(generationSeed, x, surfaceY, 1203) * 1.35);
    if (distance <= width && serverCellNoise(generationSeed, x, y, 2281) < 0.90) return true;
    if (distance <= width + 1 && serverCellNoise(generationSeed, x, y, 3359) < 0.22) return true;
  }

  if (depth >= SERVER_DEEP_CAVE_START_DEPTH) {
    const axis = serverDeepCaveAxis(generationSeed, x, surfaceY);
    const distance = Math.abs(y - axis);
    const width = 0.9 + (serverCellNoise(generationSeed, x, surfaceY, 3359) * 1.1);
    if (serverCellNoise(generationSeed, surfaceY, y, 2281) > 0.72) {
      if (distance <= width && serverCellNoise(generationSeed, x, y, 401) < 0.85) return true;
      if (distance <= width + 1 && serverCellNoise(generationSeed, x, y, 402) < 0.18) return true;
    }
  }

  if (depth >= 12 && serverCellNoise(generationSeed, x * 3, y * 3, 601) > 0.68 && serverCellNoise(generationSeed, x, y, 602) < 0.28) return true;
  if (depth >= 16 && serverCellNoise(generationSeed, x, y, 603) < 0.018) return true;
  return false;
}

function serverSurfaceBlockType(generationSeed, x, y, surfaceY) {
  if (isServerSpawnSafeColumn(x)) {
    return serverPickWeightedBlock(generationSeed, x, y, [
      { type: "dirt", weight: 86 },
      { type: "sand", weight: 7 },
      { type: "stone", weight: 7 },
    ]);
  }

  const span = Math.max(1, serverGenerationMaxSurfaceY() - serverGenerationMinSurfaceY());
  const flatness = Math.max(0, Math.min(1, (surfaceY - serverGenerationMinSurfaceY()) / span));
  if (flatness > 0.73 && serverCellNoise(generationSeed, x, surfaceY, 901) < 0.20) return "sand";
  if (serverCellNoise(generationSeed, surfaceY, x, 902) > 0.90) {
    return serverPickWeightedBlock(generationSeed, x, y, [
      { type: "stone", weight: 56 },
      { type: "dirt", weight: 34 },
      { type: "sand", weight: 10 },
    ]);
  }
  return serverPickWeightedBlock(generationSeed, x, y, [
    { type: "dirt", weight: 84 },
    { type: "sand", weight: 9 },
    { type: "stone", weight: 7 },
  ]);
}

function serverNormalUndergroundBlockType(generationSeed, x, y, depth) {
  if (depth <= 5) {
    return serverPickWeightedBlock(generationSeed, x, y, [
      { type: "dirt", weight: 89 },
      { type: "stone", weight: 7 },
      { type: "sand", weight: 4 },
    ]);
  }
  if (depth <= 16) {
    return serverPickWeightedBlock(generationSeed, x, y, [
      { type: "dirt", weight: 80 },
      { type: "stone", weight: 13 },
      { type: "sand", weight: 7 },
    ]);
  }
  if (depth <= 24) {
    return serverPickWeightedBlock(generationSeed, x, y, [
      { type: "dirt", weight: 68 },
      { type: "stone", weight: 24 },
      { type: "sand", weight: 8 },
    ]);
  }
  if (depth <= 34) {
    return serverPickWeightedBlock(generationSeed, x, y, [
      { type: "dirt", weight: 55 },
      { type: "stone", weight: 37 },
      { type: "sand", weight: 8 },
    ]);
  }
  return serverPickWeightedBlock(generationSeed, x, y, [
    { type: "dirt", weight: 40 },
    { type: "stone", weight: 53 },
    { type: "sand", weight: 8 },
  ]);
}

function serverGeneratedBlockType(generationSeed, x, y, surfaceY) {
  if (y >= BEDROCK_START_Y) return "bedrock";
  if (y < surfaceY) return "";
  if (y === surfaceY) return serverSurfaceBlockType(generationSeed, x, y, surfaceY);
  const depth = y - surfaceY;
  if (isServerBottomLavaStoneLayer(y)) {
    return serverPickWeightedBlock(generationSeed, x, y, [
      { type: "stone", weight: 62 },
      { type: "lava", weight: 28 },
      { type: "dirt", weight: 10 },
    ]);
  }
  if (isServerSpawnSafeColumn(x)) {
    return serverPickWeightedBlock(generationSeed, x, y, depth <= 9
      ? [
        { type: "dirt", weight: 88 },
        { type: "stone", weight: 9 },
        { type: "sand", weight: 3 },
      ]
      : [
        { type: "dirt", weight: 80 },
        { type: "stone", weight: 15 },
        { type: "sand", weight: 5 },
      ]);
  }
  if (shouldServerGenerateCavePocket(generationSeed, x, y, surfaceY)) return "";
  return serverNormalUndergroundBlockType(generationSeed, x, y, depth);
}

function serverMapSet(map, x, y, blockType) {
  const key = gridKey(x, y);
  if (blockType === "") {
    map.delete(key);
    return;
  }
  map.set(key, { x, y, block_type: blockType, source: "generated" });
}

function serverMapSetIfEmpty(map, x, y, blockType) {
  const key = gridKey(x, y);
  if (map.has(key)) return false;
  serverMapSet(map, x, y, blockType);
  return true;
}

function serverCanGenerateNaturalPond(map, surface, centerX, width) {
  const half = Math.floor(width * 0.5);
  let minSurface = 999999;
  let maxSurface = -999999;
  for (let x = centerX - half; x <= centerX + half; x += 1) {
    if (x <= 2 || x >= WORLD_WIDTH - 3) return false;
    if (isServerSpawnSafeColumn(x)) return false;
    const surfaceY = serverSurfaceYAt(surface, x);
    minSurface = Math.min(minSurface, surfaceY);
    maxSurface = Math.max(maxSurface, surfaceY);
    const top = map.get(gridKey(x, surfaceY))?.block_type || "";
    const below = map.get(gridKey(x, surfaceY + 1))?.block_type || "";
    if (!["dirt", "sand", "stone", "grass"].includes(top)) return false;
    if (!["dirt", "sand", "stone"].includes(below)) return false;
  }
  return maxSurface - minSurface <= 1;
}

function serverCreateNaturalPond(map, surface, rng, centerX, width) {
  const half = Math.floor(width * 0.5);
  const startX = centerX - half;
  const endX = centerX + half;
  let surfaceYForPond = -999999;
  const profileNoise = deterministicInt(rng, 0, 2147483646);
  for (let x = startX; x <= endX; x += 1) {
    surfaceYForPond = Math.max(surfaceYForPond, serverSurfaceYAt(surface, x));
  }
  const waterSurfaceY = surfaceYForPond + 1;

  for (let x = startX; x <= endX; x += 1) {
    const distanceFromCenter = Math.abs(x - centerX);
    const edgeCurve = Math.floor(SERVER_POND_EDGE_DEPTH + Math.sin(distanceFromCenter * 0.65 + profileNoise * 0.001));
    const carveDepth = clampInteger(SERVER_POND_CENTER_DEPTH + edgeCurve, SERVER_POND_EDGE_DEPTH, SERVER_POND_CENTER_DEPTH + 2);

    for (let y = serverSurfaceYAt(surface, x); y <= waterSurfaceY + SERVER_POND_CENTER_DEPTH + 1; y += 1) {
      const localDepth = y - waterSurfaceY;
      if (x === startX || x === endX) {
        serverMapSet(map, x, y, "dirt");
        continue;
      }
      if (y < waterSurfaceY) {
        serverMapSet(map, x, y, "");
        continue;
      }
      let localVariation = 0;
      if (Math.abs(distanceFromCenter) > 1) {
        localVariation = (0.22 - serverCellNoise(1, x, distanceFromCenter, profileNoise % 1000)) * 1.4;
      }
      const pondDepth = clampInteger(carveDepth + Math.round(localVariation), SERVER_POND_EDGE_DEPTH, SERVER_POND_CENTER_DEPTH + 2);
      serverMapSet(map, x, y, localDepth < pondDepth ? "water" : "dirt");
    }
  }

  serverMapSet(map, startX + 1, waterSurfaceY, "dirt");
  serverMapSet(map, endX - 1, waterSurfaceY, "dirt");
}

function serverGenerateNaturalPonds(map, surface, rng) {
  const pondCount = deterministicInt(rng, SERVER_POND_COUNT_MIN, SERVER_POND_COUNT_MAX);
  const usedCenters = [];
  let created = 0;
  for (let attempt = 0; attempt < SERVER_POND_ATTEMPT_LIMIT && created < pondCount; attempt += 1) {
    let width = deterministicInt(rng, SERVER_POND_WIDTH_MIN, SERVER_POND_WIDTH_MAX);
    if (width % 2 === 0) width += 1;
    const centerX = deterministicInt(rng, 8, WORLD_WIDTH - 9);
    const minSpacing = Math.max(7, width);
    if (isServerSpawnSafeColumn(centerX)) continue;
    if (usedCenters.some((usedX) => Math.abs(usedX - centerX) < minSpacing)) continue;
    if (!serverCanGenerateNaturalPond(map, surface, centerX, width)) continue;
    serverCreateNaturalPond(map, surface, rng, centerX, width);
    usedCenters.push(centerX);
    created += 1;
  }
}

function serverGenerateSurfaceDecorations(map, surface, generationSeed) {
  for (let x = 2; x < WORLD_WIDTH - 2; x += 1) {
    const surfaceY = serverSurfaceYAt(surface, x);
    const key = gridKey(x, surfaceY);
    const surfaceType = map.get(key)?.block_type || "";
    if (!["dirt", "sand", "stone"].includes(surfaceType)) continue;
    if (serverCellNoise(generationSeed, x, surfaceY, 7201) > SERVER_SURFACE_DECORATION_CHANCE) continue;
    if (serverCellNoise(generationSeed, Math.trunc(x * SERVER_SURFACE_DECORATION_NOISE_SCALE_X), Math.trunc(surfaceY * SERVER_SURFACE_DECORATION_NOISE_SCALE_Y), 7202) > SERVER_SURFACE_DECORATION_SPACING_GAP_MAX) continue;

    const selectionRoll = serverCellNoise(generationSeed, x, surfaceY + 1, 7201);
    const total = SERVER_SURFACE_DECORATION_GRASS_CHANCE + SERVER_SURFACE_DECORATION_ROSE_CHANCE + SERVER_SURFACE_DECORATION_TULIP_CHANCE;
    const normalized = total > 0 ? selectionRoll / total : 1;
    let decoration = "grass";
    if (normalized < (SERVER_SURFACE_DECORATION_TULIP_CHANCE / total)) {
      decoration = "tulip";
    } else if (normalized < ((SERVER_SURFACE_DECORATION_TULIP_CHANCE + SERVER_SURFACE_DECORATION_ROSE_CHANCE) / total)) {
      decoration = "rose";
    }
    serverMapSet(map, x, surfaceY, decoration);
  }
}

function serverCreateTree(map, surface, generationSeed, rng, x) {
  if (x <= 1 || x >= WORLD_WIDTH - 2) return false;
  const surfaceY = serverSurfaceYAt(surface, x);
  const groundType = map.get(gridKey(x, surfaceY))?.block_type || "";
  if (!["grass", "dirt", "sand", "stone", "rose", "tulip"].includes(groundType)) return false;
  if (Math.abs(serverSurfaceYAt(surface, x - 1) - surfaceY) > 1) return false;
  if (Math.abs(serverSurfaceYAt(surface, x + 1) - surfaceY) > 1) return false;

  serverMapSet(map, x, surfaceY, "dirt");
  const baseY = surfaceY - 1;
  const trunkHeight = deterministicInt(rng, SERVER_TREE_MIN_HEIGHT, SERVER_TREE_MAX_HEIGHT);
  let trunkTilt = 0;
  if (serverCellNoise(generationSeed, x, surfaceY, 7101) > 0.9) {
    const tiltNoise = serverCellNoise(generationSeed, x + 10, surfaceY, 7102);
    if (tiltNoise < 0.33) trunkTilt = -1;
    else if (tiltNoise > 0.66) trunkTilt = 1;
  }

  const trunkPositions = [];
  for (let i = 0; i < trunkHeight; i += 1) {
    const trunkX = x + trunkTilt * Math.floor(i / 2);
    const trunkY = baseY - i;
    serverMapSetIfEmpty(map, trunkX, trunkY, "wood");
    trunkPositions.push({ x: trunkX, y: trunkY });
  }

  const top = trunkPositions[trunkPositions.length - 1];
  const leafCoreY = baseY - trunkHeight;
  let leafSpreadX = 2;
  if (trunkHeight >= 6) leafSpreadX = 3;
  if (trunkHeight >= 7) leafSpreadX = 4;

  for (let dy = -4; dy < 2; dy += 1) {
    let rowSpan = leafSpreadX;
    if (dy >= -1) rowSpan = Math.max(2, leafSpreadX - 1);
    else if (dy <= -3) rowSpan = Math.max(3, leafSpreadX + 1);
    else rowSpan = leafSpreadX + 1;
    rowSpan = clampInteger(rowSpan + Math.round((serverCellNoise(generationSeed, x, leafCoreY + dy, 7401) - 0.5) * 1.2), 2, leafSpreadX + 2);

    for (let dx = -rowSpan; dx <= rowSpan; dx += 1) {
      const leafX = top.x + dx;
      const leafY = leafCoreY + dy;
      if (!isGridInWorld(leafX, leafY)) continue;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > 8) continue;
      const leafNoise = serverCellNoise(generationSeed, leafX, leafY, 7400);
      const isEdge = Math.abs(dx) === rowSpan || dist >= 5;
      if (dy < -1 && dist <= 2 && leafNoise < 0.03) continue;
      if (isEdge && leafNoise < 0.28) continue;
      if (dist > 4 && leafNoise < 0.16) continue;
      if (dist > 5 && leafNoise < 0.35) continue;
      serverMapSetIfEmpty(map, leafX, leafY, "leaf");
    }
  }

  return true;
}

function isRefreshTokenValid(account, token) {
  if (!account || !account.refresh_token_hash) return false;
  if (account.refresh_token_hash !== makeTokenHash(token)) return false;

  const expiresAt = Date.parse(String(account.refresh_token_expires_at || ""));
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    clearSessionToken(account);
    return false;
  }

  return true;
}

function serverGenerateTrees(map, surface, generationSeed, rng) {
  let lastTreeX = -999;
  for (let x = 4; x < WORLD_WIDTH - 4; x += 1) {
    if (isServerSpawnSafeColumn(x)) continue;
    if (x - lastTreeX < 3) continue;
    const surfaceY = serverSurfaceYAt(surface, x);
    if (serverCellNoise(generationSeed, x, surfaceY, 7001) > SERVER_TREE_SURFACE_NOISE_THRESHOLD) continue;
    if (serverCellNoise(generationSeed, x * 2, surfaceY, 7002) < 0.03) continue;
    if (rng() >= SERVER_TREE_RANDOM_PLACEMENT_CHANCE) continue;
    if (serverCreateTree(map, surface, generationSeed, rng, x)) lastTreeX = x;
  }
}

function buildServerGeneratedForegroundMap(worldName, state) {
  const map = new Map();
  if (state?.cleared) return map;

  const { generationSeed, surface } = buildServerTerrainSurface(worldName);
  for (let x = 0; x < WORLD_WIDTH; x += 1) {
    const surfaceY = serverSurfaceYAt(surface, x);
    for (let y = surfaceY; y < WORLD_HEIGHT; y += 1) {
      const blockType = serverGeneratedBlockType(generationSeed, x, y, surfaceY);
      if (blockType !== "") serverMapSet(map, x, y, blockType);
    }
  }

  const rng = makeDeterministicRng(`generated:${cleanWorld(worldName)}:${generationSeed}`);
  serverGenerateNaturalPonds(map, surface, rng);
  serverGenerateSurfaceDecorations(map, surface, generationSeed);
  serverGenerateTrees(map, surface, generationSeed, rng);
  return map;
}

function buildEffectiveForegroundMap(worldName, state, generatedMap = null) {
  const map = new Map();
  const baseMap = generatedMap || buildServerGeneratedForegroundMap(worldName, state);
  for (const [key, entry] of baseMap.entries()) {
    map.set(key, { ...entry, source: "generated" });
  }
  for (const key of state.removed_foreground.keys()) {
    map.delete(key);
  }
  for (const [key, entry] of state.foreground.entries()) {
    map.set(key, { ...entry, source: "explicit" });
  }
  return map;
}

function buildPersistedForegroundEventMap(state) {
  const map = new Map();
  if (!state || !state.foreground) return map;
  for (const [key, entry] of state.foreground.entries()) {
    map.set(key, { ...entry, source: "explicit" });
  }
  return map;
}

function getSnowStormIceEventBlock(x, y) {
  const roll = deterministicTileVariantIndex(x, y, 100, SNOW_STORM_ICE_VARIANT_SALT);
  if (roll < 2) return "ice_fossil";
  if (roll < 7) return "ice_block_2";
  return "ice_block";
}

function getSnowStormEventBlockForOriginal(originalBlockId, effectiveMap, x, y) {
  switch (originalBlockId) {
    case "dirt":
      return getSnowStormDirtEventBlock(effectiveMap, x, y);
    case "water":
      return getSnowStormIceEventBlock(x, y);
    case "sand":
      return "snow_bank";
    case "stone":
      return "snow_stone";
    case "grass":
      return "frozen_grass";
    case "leaf":
      return isSnowStormTopLeaf(effectiveMap, x, y) ? "snow_leaf" : "";
    default:
      return "";
  }
}

function getSnowStormBlockTypeAt(effectiveMap, x, y) {
  if (!effectiveMap || !isGridInWorld(x, y)) return "";
  const entry = effectiveMap.get(gridKey(x, y));
  return clampString(entry?.block_type || "");
}

function getSnowStormDirtEventBlock(effectiveMap, x, y) {
  const aboveY = Number(y) - 1;
  const aboveBlockId = getSnowStormBlockTypeAt(effectiveMap, x, aboveY);
  if (aboveBlockId !== "dirt") return "snow_block";

  const aboveAboveBlockId = getSnowStormBlockTypeAt(effectiveMap, x, aboveY - 1);
  if (aboveAboveBlockId !== "dirt") return "snow_dirt";

  return "";
}

function isSnowStormTopLeaf(effectiveMap, x, y) {
  const aboveY = Number(y) - 1;
  if (!isGridInWorld(x, aboveY)) return true;
  const aboveKey = gridKey(x, aboveY);
  const above = effectiveMap.get(aboveKey);
  return clampString(above?.block_type || "") !== "leaf";
}

function canSpawnSnowStormPileAt(state, occupancyMap, x, y) {
  if (!state || !occupancyMap || !isGridInWorld(x, y)) return false;
  const key = gridKey(x, y);
  if (state.foreground.has(key)) return false;
  if (state.seeds.has(key)) return false;
  return !occupancyMap.has(key);
}

function makeSnowStormWorldChange(worldName, tile, action, sourceId, reason) {
  return {
    source_type: "world_event",
    source_id: sourceId,
    world: cleanWorld(worldName),
    action,
    reason,
    layer: "foreground",
    x: tile.x,
    y: tile.y,
    block_type: action === "break" ? tile.event_block_id : tile.event_block_id,
    block_type_before: tile.original_block_id || "",
    block_type_after: action === "break" ? "" : tile.event_block_id,
    details: {
      event_type: SNOW_STORM_EVENT_TYPE,
      event_id: sourceId,
      original_block_id: tile.original_block_id || "",
      event_block_id: tile.event_block_id || "",
      tile_source: tile.source || "",
      reason: tile.reason || reason,
    },
  };
}

async function startSnowStormEvent(worldName, options = {}) {
  const clean = cleanWorld(worldName);
  const lockKey = `${clean}:${SNOW_STORM_EVENT_TYPE}`;
  if (worldEventActionLocks.has(lockKey)) return { ok: false, reason: "locked" };
  worldEventActionLocks.add(lockKey);
  let previousWorldState = null;

  try {
    const state = ensureWorldState(clean);
    if (hasActiveSnowStormEvent(state)) return { ok: false, reason: "already_active" };

    previousWorldState = serializeWorldState(clean);
    const eventId = makeAuditId("snow_storm");
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + SNOW_STORM_EVENT_DURATION_MS);
    const changedTiles = [];
    const updates = [];
    const convertedSnowDirtTiles = [];
    const stats = {
      dirt_converted: 0,
      water_converted: 0,
      sand_converted: 0,
      stone_converted: 0,
      grass_converted: 0,
      leaf_converted: 0,
      piles_spawned: 0,
      capped: false,
    };
    const effectiveMap = buildPersistedForegroundEventMap(state);
    const originalOccupancyMap = buildEffectiveForegroundMap(clean, state);
    const occupancyMap = new Map();
    for (const [key, entry] of originalOccupancyMap.entries()) {
      occupancyMap.set(key, { ...entry });
    }

    for (const entry of effectiveMap.values()) {
      if (changedTiles.length >= SNOW_STORM_MAX_CHANGED_TILES) {
        stats.capped = true;
        break;
      }

      const originalBlockId = clampString(entry?.block_type || "");
      if (originalBlockId === "") continue;
      const eventBlockId = getSnowStormEventBlockForOriginal(originalBlockId, originalOccupancyMap, entry.x, entry.y);
      if (eventBlockId === "" || eventBlockId === originalBlockId) continue;

      const key = gridKey(entry.x, entry.y);
      const source = clampString(entry.source || "") === "explicit" ? "explicit" : "generated";
      state.foreground.set(key, { x: entry.x, y: entry.y, block_type: eventBlockId });
      state.removed_foreground.delete(key);
      state.interactions.delete(key);
      occupancyMap.set(key, { x: entry.x, y: entry.y, block_type: eventBlockId, source });
      const changedTile = {
        x: entry.x,
        y: entry.y,
        original_block_id: originalBlockId,
        event_block_id: eventBlockId,
        event_id: eventId,
        changed_at: startedAt.toISOString(),
        source,
        reason: "snow_storm_start",
      };
      changedTiles.push(changedTile);
      updates.push({
        type: "world_block_update",
        action: "place",
        layer: "foreground",
        x: entry.x,
        y: entry.y,
        block_type: eventBlockId,
        world: clean,
      });

      if (originalBlockId === "dirt") {
        stats.dirt_converted += 1;
        if (eventBlockId === "snow_dirt") {
          convertedSnowDirtTiles.push(changedTile);
        }
      }
      else if (originalBlockId === "water") stats.water_converted += 1;
      else if (originalBlockId === "sand") stats.sand_converted += 1;
      else if (originalBlockId === "stone") stats.stone_converted += 1;
      else if (originalBlockId === "grass") stats.grass_converted += 1;
      else if (originalBlockId === "leaf") stats.leaf_converted += 1;
    }

    for (const entry of occupancyMap.values()) {
      if (changedTiles.length >= SNOW_STORM_MAX_CHANGED_TILES) {
        stats.capped = true;
        break;
      }
      if (clampString(entry?.source || "") !== "generated") continue;
      if (clampString(entry?.block_type || "") !== "water") continue;

      const key = gridKey(entry.x, entry.y);
      if (state.foreground.has(key)) continue;

      const eventBlockId = getSnowStormIceEventBlock(entry.x, entry.y);
      state.foreground.set(key, { x: entry.x, y: entry.y, block_type: eventBlockId });
      state.removed_foreground.delete(key);
      state.interactions.delete(key);
      occupancyMap.set(key, { x: entry.x, y: entry.y, block_type: eventBlockId, source: "generated" });

      const changedTile = {
        x: entry.x,
        y: entry.y,
        original_block_id: "water",
        event_block_id: eventBlockId,
        event_id: eventId,
        changed_at: startedAt.toISOString(),
        source: "generated",
        reason: "snow_storm_generated_water_freeze",
      };
      changedTiles.push(changedTile);
      updates.push({
        type: "world_block_update",
        action: "place",
        layer: "foreground",
        x: entry.x,
        y: entry.y,
        block_type: eventBlockId,
        world: clean,
      });
      stats.water_converted += 1;
    }

    const pileRng = makeDeterministicRng(`${eventId}:${clean}:pile_of_snow`);
    for (const snowDirtTile of convertedSnowDirtTiles) {
      if (changedTiles.length >= SNOW_STORM_MAX_CHANGED_TILES) {
        stats.capped = true;
        break;
      }
      if (pileRng() >= SNOW_STORM_PILE_OF_SNOW_CHANCE) continue;

      const pileX = snowDirtTile.x;
      const pileY = snowDirtTile.y - 1;
      if (!canSpawnSnowStormPileAt(state, occupancyMap, pileX, pileY)) continue;

      const pileKey = gridKey(pileX, pileY);
      state.foreground.set(pileKey, { x: pileX, y: pileY, block_type: "pile_of_snow" });
      state.removed_foreground.delete(pileKey);
      occupancyMap.set(pileKey, { x: pileX, y: pileY, block_type: "pile_of_snow", source: "event_spawn" });

      const pileTile = {
        x: pileX,
        y: pileY,
        original_block_id: "",
        event_block_id: "pile_of_snow",
        event_id: eventId,
        changed_at: startedAt.toISOString(),
        source: "event_spawn",
        reason: "snow_storm_pile_spawn",
      };
      changedTiles.push(pileTile);
      updates.push({
        type: "world_block_update",
        action: "place",
        layer: "foreground",
        x: pileX,
        y: pileY,
        block_type: "pile_of_snow",
        world: clean,
      });
      stats.piles_spawned += 1;
    }

    state.active_event_type = SNOW_STORM_EVENT_TYPE;
    state.event_id = eventId;
    state.event_started_at = startedAt.toISOString();
    state.event_ends_at = endsAt.toISOString();
    state.event_changed_tiles = changedTiles;

    const commit = await commitWorldEventStateOnly(clean);
    if (!commit.ok) {
      worldStates.set(clean, deserializeWorldState(clean, previousWorldState));
      return { ok: false, reason: commit.reason || "commit_failed", message: commit.message || "" };
    }

    scheduleWorldEventEnd(clean);
    if (options.broadcast !== false) {
      broadcastToWorld(clean, buildWorldEventStartedMessage(clean, state));
      broadcastEventSystemMessage(clean, eventId, SNOW_STORM_SYSTEM_MESSAGE);
      await broadcastEventTileUpdates(clean, eventId, "start", updates);
    }

    console.log("[world_event] snow_storm started", {
      world: clean,
      event_id: eventId,
      reason: options.reason || "system",
      ends_at: state.event_ends_at,
      changed_tiles: changedTiles.length,
      ...stats,
    });

    return { ok: true, event_id: eventId, stats, changed_tiles: changedTiles.length };
  } catch (error) {
    if (previousWorldState != null) {
      worldStates.set(clean, deserializeWorldState(clean, previousWorldState));
    }
    console.warn("[world_event] snow_storm start exception:", error && error.stack ? error.stack : error);
    return { ok: false, reason: "exception", message: String(error?.message || error || "unknown") };
  } finally {
    worldEventActionLocks.delete(lockKey);
  }
}

async function endSnowStormEvent(worldName, options = {}) {
  const clean = cleanWorld(worldName);
  const lockKey = `${clean}:${SNOW_STORM_EVENT_TYPE}`;
  if (worldEventActionLocks.has(lockKey)) return { ok: false, reason: "locked" };
  worldEventActionLocks.add(lockKey);
  let previousWorldState = null;

  try {
    const state = ensureWorldState(clean);
    if (state.active_event_type !== SNOW_STORM_EVENT_TYPE) return { ok: false, reason: "not_active" };
    const eventId = state.event_id || "";
    previousWorldState = serializeWorldState(clean);
    const changedTiles = Array.isArray(state.event_changed_tiles) ? state.event_changed_tiles.slice() : [];
    const endedAt = new Date().toISOString();
    const updates = [];
    const stats = {
      reverted: 0,
      removed_piles: 0,
      removed_generated_overrides: 0,
      skipped_player_changed: 0,
    };
    let needsWorldStateRefresh = false;

    const existingTimer = worldEventTimers.get(clean);
    if (existingTimer) clearTimeout(existingTimer);
    worldEventTimers.delete(clean);
    clearWorldEventCountdownTimers(clean);

    for (const rawTile of changedTiles) {
      const tile = normalizeWorldEventTileEntry(rawTile, eventId);
      if (!tile) continue;
      const key = gridKey(tile.x, tile.y);
      const currentBlockId = clampString(state.foreground.get(key)?.block_type || "");
      if (currentBlockId !== tile.event_block_id) {
        stats.skipped_player_changed += 1;
        continue;
      }

      const wasGeneratedOverride = clampString(tile.source || "") === "generated";
      if (tile.original_block_id !== "") {
        if (wasGeneratedOverride) {
          state.foreground.delete(key);
          state.removed_foreground.delete(key);
          stats.removed_generated_overrides += 1;
          needsWorldStateRefresh = true;
        } else {
          state.foreground.set(key, { x: tile.x, y: tile.y, block_type: tile.original_block_id });
          state.removed_foreground.delete(key);
          stats.reverted += 1;

          updates.push({
            type: "world_block_update",
            action: "place",
            layer: "foreground",
            x: tile.x,
            y: tile.y,
            block_type: tile.original_block_id,
            world: clean,
          });
        }
      } else {
        state.foreground.delete(key);
        state.removed_foreground.delete(key);
        updates.push({
          type: "world_block_update",
          action: "break",
          layer: "foreground",
          x: tile.x,
          y: tile.y,
          block_type: tile.event_block_id,
          world: clean,
        });
        if (wasGeneratedOverride) {
          stats.removed_generated_overrides += 1;
          needsWorldStateRefresh = true;
        } else {
          stats.removed_piles += 1;
        }
      }
    }

    clearWorldEventState(state);
    const commit = await commitWorldEventStateOnly(clean);
    if (!commit.ok) {
      worldStates.set(clean, deserializeWorldState(clean, previousWorldState));
      scheduleWorldEventEnd(clean);
      return { ok: false, reason: commit.reason || "commit_failed", message: commit.message || "" };
    }

    if (options.broadcast !== false) {
      broadcastToWorld(clean, buildWorldEventEndedMessage(clean, eventId, endedAt));
      if (needsWorldStateRefresh) {
        broadcastToWorld(clean, buildWorldStateMessage(clean, {
          world_state_reason: "snow_storm_end",
          respawn_player: false,
          force_respawn: false,
        }));
      } else {
        await broadcastEventTileUpdates(clean, eventId, "end", updates);
      }
    }

    console.log("[world_event] snow_storm ended", {
      world: clean,
      event_id: eventId,
      reason: options.reason || "system",
      changed_tiles: changedTiles.length,
      ...stats,
    });

    return { ok: true, event_id: eventId, stats, updates: updates.length };
  } catch (error) {
    if (previousWorldState != null) {
      worldStates.set(clean, deserializeWorldState(clean, previousWorldState));
      scheduleWorldEventEnd(clean);
    }
    console.warn("[world_event] snow_storm end exception:", error && error.stack ? error.stack : error);
    return { ok: false, reason: "exception", message: String(error?.message || error || "unknown") };
  } finally {
    worldEventActionLocks.delete(lockKey);
  }
}

async function handleFrozenTreasureOpen(socket, player, worldName, update, requestId = "") {
  const clean = cleanWorld(worldName);
  const key = gridKey(update.x, update.y);
  const lockKey = `${clean}:${key}`;
  if (worldFrozenTreasureOpenLocks.has(lockKey)) {
    sendActionRejected(socket, "world_block_update", "That treasure is already opening.");
    return false;
  }
  worldFrozenTreasureOpenLocks.add(lockKey);

  try {
    const state = ensureWorldState(clean);
    const currentBlock = state.foreground.get(key);
    if (clampString(currentBlock?.block_type || "") !== "frozen_treasure") {
      sendActionRejected(socket, "world_block_update", "That frozen treasure is already open.");
      return false;
    }

    const previousWorldState = serializeWorldState(clean);
    const transactionId = makeAuditId("frozen_treasure");
    const openedUpdate = {
      type: "world_block_update",
      action: "place",
      layer: "foreground",
      x: update.x,
      y: update.y,
      block_type: "frozen_treasure_2",
      world: clean,
    };
    const cleanupUpdate = {
      type: "world_block_update",
      action: "break",
      layer: "foreground",
      x: update.x,
      y: update.y,
      block_type: "frozen_treasure_2",
      world: clean,
    };

    state.foreground.set(key, { x: update.x, y: update.y, block_type: "frozen_treasure_2" });
    state.removed_foreground.delete(key);
    clearServerBlockDamage(clean, update);

    const dropPosition = getGridCenterPixels(update.x, update.y);
    const rewardDrop = createServerDrop(clean, "snow_block", "block", 1, dropPosition.x, dropPosition.y, SERVER_DROP_PICKUP_DELAY);
    if (!rewardDrop) {
      worldStates.set(clean, deserializeWorldState(clean, previousWorldState));
      sendActionRejected(socket, "world_block_update", "Could not create the treasure reward.");
      return false;
    }

    state.foreground.delete(key);
    state.interactions.delete(key);
    state.removed_foreground.set(key, {
      x: update.x,
      y: update.y,
      block_type: "frozen_treasure_2",
    });

    const openChange = {
      ...getAuditActor(socket, player),
      source_type: "server_event",
      source_id: transactionId,
      request_id: requestId || "",
      world: clean,
      action: "place",
      reason: "frozen_treasure_open",
      layer: "foreground",
      x: update.x,
      y: update.y,
      block_type: "frozen_treasure_2",
      block_type_before: "frozen_treasure",
      block_type_after: "frozen_treasure_2",
      details: {
        event_type: SNOW_STORM_EVENT_TYPE,
        opened_block: "frozen_treasure",
        reward_item: "snow_block",
      },
    };
    const cleanupChange = {
      ...getAuditActor(socket, player),
      source_type: "server_event",
      source_id: transactionId,
      request_id: requestId || "",
      world: clean,
      action: "break",
      reason: "frozen_treasure_open_cleanup",
      layer: "foreground",
      x: update.x,
      y: update.y,
      block_type: "frozen_treasure_2",
      block_type_before: "frozen_treasure_2",
      block_type_after: "",
      details: {
        event_type: SNOW_STORM_EVENT_TYPE,
        opened_block: "frozen_treasure",
        cleanup_block: "frozen_treasure_2",
        reward_item: "snow_block",
      },
    };
    const rewardChange = {
      ...getAuditActor(socket, player),
      source_type: "server_event",
      source_id: transactionId,
      request_id: requestId || "",
      world: clean,
      action: "drop_create",
      reason: "frozen_treasure_reward",
      layer: "foreground",
      x: update.x,
      y: update.y,
      block_type: rewardDrop.item_type,
      details: {
        event_type: SNOW_STORM_EVENT_TYPE,
        drop_id: rewardDrop.drop_id,
        item_category: rewardDrop.item_category,
        amount: rewardDrop.amount,
        source_block: "frozen_treasure",
      },
    };

    const commit = await commitWorldStateWithBlockChanges(clean, [openChange, cleanupChange, rewardChange]);
    if (!commit.ok) {
      worldStates.set(clean, deserializeWorldState(clean, previousWorldState));
      sendActionRejected(socket, "world_block_update", commit.message || "PostgreSQL rejected the treasure reward.");
      return false;
    }

    sendWorldUpdateToRequesterAndWorld(socket, player, clean, openedUpdate);
    sendWorldUpdateToRequesterAndWorld(socket, player, clean, cleanupUpdate);
    sendWorldUpdateToRequesterAndWorld(socket, player, clean, rewardDrop);
    logWorldChange(socket, player, openChange, { skipPostgres: commit.postgres_committed });
    logWorldChange(socket, player, cleanupChange, { skipPostgres: commit.postgres_committed });
    logWorldChange(socket, player, rewardChange, { skipPostgres: commit.postgres_committed });

    console.log("[world_event] frozen_treasure opened", {
      world: clean,
      x: update.x,
      y: update.y,
      actor: player?.account_username || player?.name || "",
      reward_drop_id: rewardDrop.drop_id,
      reward_item: rewardDrop.item_type,
      cleanup_block: "frozen_treasure_2",
    });
    return true;
  } finally {
    worldFrozenTreasureOpenLocks.delete(lockKey);
  }
}

function loadAccountsFromJson() {
  accounts.clear();
  const data = readJsonFile(ACCOUNTS_SAVE_PATH);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return;
  }

  const rawAccounts = Array.isArray(data.accounts) ? data.accounts : [];
  for (const rawAccount of rawAccounts) {
    const account = sanitizeAccountState(rawAccount);
    if (!account) continue;
    accounts.set(accountKey(account.username), account);
  }
}

function sanitizeAccountState(rawAccount) {
  if (!rawAccount || typeof rawAccount !== "object" || Array.isArray(rawAccount)) return null;

  const username = cleanAccountName(rawAccount.username || rawAccount.account_username || rawAccount.name || "");
  if (username === "") return null;
  const hasEmailVerifiedField = Object.prototype.hasOwnProperty.call(rawAccount, "email_verified");
  const passwordHash = String(rawAccount.password_hash || "");

  return {
    username,
    email: cleanEmail(rawAccount.email || ""),
    password_salt: String(rawAccount.password_salt || ""),
    password_hash: passwordHash,
    password_algorithm: String(rawAccount.password_algorithm || (passwordHash ? "legacy_scrypt" : "")),
    session_token_hash: String(rawAccount.session_token_hash || ""),
    session_token_expires_at: String(rawAccount.session_token_expires_at || ""),
    refresh_token_hash: String(rawAccount.refresh_token_hash || ""),
    refresh_token_expires_at: String(rawAccount.refresh_token_expires_at || ""),
    email_verified: hasEmailVerifiedField ? Boolean(rawAccount.email_verified) : passwordHash !== "",
    email_verified_at: String(rawAccount.email_verified_at || ""),
    email_verification_token_hash: String(rawAccount.email_verification_token_hash || ""),
    email_verification_expires_at: String(rawAccount.email_verification_expires_at || ""),
    role: String(rawAccount.role || getAccountRole(username)),
    created_at: String(rawAccount.created_at || new Date().toISOString()),
    last_seen_at: String(rawAccount.last_seen_at || ""),
    friends: sanitizeAccountNameArray(rawAccount.friends, 200),
    friend_requests_in: sanitizeAccountNameArray(rawAccount.friend_requests_in || rawAccount.pending_friend_requests || [], 200),
    friend_requests_out: sanitizeAccountNameArray(rawAccount.friend_requests_out || [], 200),
  };
}

function accountKey(username) {
  return cleanAccountName(username).toLowerCase();
}

function upsertAccount(rawAccount) {
  const incoming = sanitizeAccountState(rawAccount);
  if (!incoming) return null;

  const key = accountKey(incoming.username);
  const existing = accounts.get(key) || {};
  const account = {
    username: existing.username || incoming.username,
    email: incoming.email || existing.email || "",
    password_salt: existing.password_salt || incoming.password_salt || "",
    password_hash: existing.password_hash || incoming.password_hash || "",
    password_algorithm: existing.password_algorithm || incoming.password_algorithm || (existing.password_hash || incoming.password_hash ? "legacy_scrypt" : ""),
    session_token_hash: existing.session_token_hash || incoming.session_token_hash || "",
    session_token_expires_at: existing.session_token_expires_at || incoming.session_token_expires_at || "",
    refresh_token_hash: existing.refresh_token_hash || incoming.refresh_token_hash || "",
    refresh_token_expires_at: existing.refresh_token_expires_at || incoming.refresh_token_expires_at || "",
    email_verified: Object.prototype.hasOwnProperty.call(existing, "email_verified") ? Boolean(existing.email_verified) : Boolean(incoming.email_verified),
    email_verified_at: existing.email_verified_at || incoming.email_verified_at || "",
    email_verification_token_hash: existing.email_verification_token_hash || incoming.email_verification_token_hash || "",
    email_verification_expires_at: existing.email_verification_expires_at || incoming.email_verification_expires_at || "",
    role: existing.role || incoming.role || getAccountRole(incoming.username),
    created_at: existing.created_at || incoming.created_at || new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    friends: sanitizeAccountNameArray(existing.friends || incoming.friends || [], 200),
    friend_requests_in: sanitizeAccountNameArray(existing.friend_requests_in || incoming.friend_requests_in || existing.pending_friend_requests || [], 200),
    friend_requests_out: sanitizeAccountNameArray(existing.friend_requests_out || incoming.friend_requests_out || [], 200),
  };

  accounts.set(key, account);
  queueAccountsSave();
  postgresStore.mirrorAccount(account, { touchLogin: false });
  return account;
}

function queueAccountsSave() {
  if (accountsSaveTimer) clearTimeout(accountsSaveTimer);

  accountsSaveTimer = setTimeout(() => {
    accountsSaveTimer = null;
    saveAccounts();
  }, SAVE_DEBOUNCE_MS);
}

function saveAccounts() {
  const payload = {
    account_state_version: 1,
    saved_at: new Date().toISOString(),
    accounts: Array.from(accounts.values()),
  };
  writeJsonFileAtomic(ACCOUNTS_SAVE_PATH, payload);
  if (postgresStore.isReady()) {
    trackPersistenceWrite(postgresStore.saveAccountStates(payload.accounts), "account states");
  }
}

function sanitizeCountDictionary(rawValue, limit = MAX_PLAYER_INVENTORY_KEYS, expectedCategory = "") {
  const safe = {};
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return safe;

  for (const [rawKey, rawCount] of Object.entries(rawValue).slice(0, limit)) {
    const itemId = clampString(rawKey || "");
    if (itemId.length === 0) continue;
    if (!ItemDatabase.hasItem(itemId)) continue;

    const resolvedCategory = resolveInventoryCategory(itemId, expectedCategory);
    if (!ItemDatabase.canStoreItemInCategory(itemId, resolvedCategory)) continue;
    if (expectedCategory !== "" && resolvedCategory !== expectedCategory) continue;

    const count = clampInteger(rawCount || 0, 0, ItemDatabase.getStackLimit(itemId));
    safe[itemId] = count;
  }

  return safe;
}

function sanitizeStringArray(rawValue, limit = 32) {
  if (!Array.isArray(rawValue)) return [];
  return rawValue.map((value) => clampString(value || "")).slice(0, limit);
}

function sanitizePlayerState(rawState, username) {
  if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) return null;

  const accountUsername = cleanAccountName(username || rawState.account_username || rawState.username || "");
  if (accountUsername === "") return null;
  const progression = normalizeProgressionState(rawState);

  const state = {
    player_data_version: Math.max(1, Math.trunc(Number(rawState.player_data_version) || 1)),
    account_username: accountUsername,
    player_level: progression.player_level,
    player_xp: progression.player_xp,
    player_xp_needed: progression.player_xp_needed,
    player_total_xp: progression.player_total_xp,
    player_title: progression.player_title,
    last_level_up_at: String(rawState.last_level_up_at || "").slice(0, 64),
    selected_item_type: clampString(rawState.selected_item_type || "punch"),
    selected_item_category: cleanInventoryCategory(rawState.selected_item_category || "tool") || "tool",
    primary_hotbar_tool: clampString(rawState.primary_hotbar_tool || "punch"),
    hotbar_items: sanitizeStringArray(rawState.hotbar_items, 16),
    hotbar_item_categories: sanitizeStringArray(rawState.hotbar_item_categories, 16),
    player_health: clampInteger(rawState.player_health || 3, 0, 100),
    inventory: sanitizeCountDictionary(rawState.inventory, MAX_PLAYER_INVENTORY_KEYS, "block"),
    seed_inventory: sanitizeCountDictionary(rawState.seed_inventory, MAX_PLAYER_INVENTORY_KEYS, "seed"),
    tool_inventory: sanitizeCountDictionary(rawState.tool_inventory, MAX_PLAYER_INVENTORY_KEYS, "tool"),
    back_inventory: sanitizeCountDictionary(rawState.back_inventory, MAX_PLAYER_INVENTORY_KEYS, "back"),
    hair_inventory: sanitizeCountDictionary(rawState.hair_inventory, MAX_PLAYER_INVENTORY_KEYS, "hair"),
    shirt_inventory: sanitizeCountDictionary(rawState.shirt_inventory, MAX_PLAYER_INVENTORY_KEYS, "shirt"),
    pants_inventory: sanitizeCountDictionary(rawState.pants_inventory, MAX_PLAYER_INVENTORY_KEYS, "pants"),
    shoes_inventory: sanitizeCountDictionary(rawState.shoes_inventory, MAX_PLAYER_INVENTORY_KEYS, "shoes"),
    currency_inventory: sanitizeCountDictionary(rawState.currency_inventory, MAX_PLAYER_INVENTORY_KEYS, "currency"),
    material_inventory: sanitizeCountDictionary(rawState.material_inventory, MAX_PLAYER_INVENTORY_KEYS, "material"),
    lure_inventory: sanitizeCountDictionary(rawState.lure_inventory, MAX_PLAYER_INVENTORY_KEYS, "lure"),
    fish_inventory: sanitizeCountDictionary(rawState.fish_inventory, MAX_PLAYER_INVENTORY_KEYS, "fish"),
    equipped_tool: "",
    equipped_back_item: "",
    equipped_hair_item: "",
    equipped_shirt_item: "",
    equipped_pants_item: "",
    equipped_shoes_item: "",
    legacy_client_inventory_imported_at: String(rawState.legacy_client_inventory_imported_at || "").slice(0, 64),
    legacy_client_inventory_import_revision: clampInteger(rawState.legacy_client_inventory_import_revision || 0, 0, 1000),
    saved_at: new Date().toISOString(),
  };

  const equippedTool = clampString(rawState.equipped_tool || "");
  if (doesStateOwnEquippedItem(state, equippedTool, "hand")) {
    state.equipped_tool = equippedTool;
  }

  const equippedBack = clampString(rawState.equipped_back_item || "");
  if (doesStateOwnEquippedItem(state, equippedBack, "back")) {
    state.equipped_back_item = equippedBack;
  }

  const equippedHair = clampString(rawState.equipped_hair_item || "");
  if (doesStateOwnEquippedItem(state, equippedHair, "hair")) {
    state.equipped_hair_item = equippedHair;
  }

  const equippedShirt = clampString(rawState.equipped_shirt_item || "");
  if (doesStateOwnEquippedItem(state, equippedShirt, "shirt")) {
    state.equipped_shirt_item = equippedShirt;
  }

  const equippedPants = clampString(rawState.equipped_pants_item || "");
  if (doesStateOwnEquippedItem(state, equippedPants, "pants")) {
    state.equipped_pants_item = equippedPants;
  }

  const equippedShoes = clampString(rawState.equipped_shoes_item || "");
  if (doesStateOwnEquippedItem(state, equippedShoes, "shoes")) {
    state.equipped_shoes_item = equippedShoes;
  }

  normalizePlayerHotbarState(state);
  return state;
}

function ensurePlayerState(username) {
  const clean = cleanAccountName(username);
  if (clean === "") return null;

  const key = accountKey(clean);
  if (playerStates.has(key)) {
    return playerStates.get(key);
  }

  if (isPostgresAuthoritativeReady()) {
    return null;
  }

  const data = readJsonFile(getPlayerSavePath(clean));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const state = sanitizePlayerState(data.player_data || data, clean);
  if (!state) return null;

  playerStates.set(key, state);
  return state;
}

function setPlayerState(username, state) {
  const clean = cleanAccountName(username);
  if (clean === "") return;

  playerStates.set(accountKey(clean), state);
}

function queuePlayerSave(username) {
  const key = accountKey(username);
  if (key === "") return;

  const existingTimer = playerSaveTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);

  playerSaveTimers.set(key, setTimeout(() => {
    playerSaveTimers.delete(key);
    savePlayerState(username);
  }, SAVE_DEBOUNCE_MS));
}

function savePlayerState(username) {
  const clean = cleanAccountName(username);
  if (clean === "") return;

  const state = playerStates.get(accountKey(clean));
  if (!state) return;
  normalizePlayerHotbarState(state);
  applyProgressionFieldsToState(state, state);

  writePlayerStateJsonBackup(clean, state);
  if (postgresStore.isReady()) {
    trackPersistenceWrite(postgresStore.savePlayerState(clean, state), `player state ${clean}`);
  } else {
    postgresStore.mirrorInventorySnapshot(clean, state);
  }
}

function getEquipmentSlotsFromPlayerState(state) {
  const source = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  return {
    hand: clampString(source.equipped_tool || ""),
    back: clampString(source.equipped_back_item || ""),
    hair: clampString(source.equipped_hair_item || ""),
    shirt: clampString(source.equipped_shirt_item || ""),
    pants: clampString(source.equipped_pants_item || ""),
    shoes: clampString(source.equipped_shoes_item || ""),
  };
}

function isCoreVisibleEquipmentSlot(slot) {
  return slot === "hand" || slot === "back" || slot === "hair" || slot === "shirt" || slot === "pants" || slot === "shoes";
}

function sanitizeEquipmentSlots(rawSlots, username = "", stateOverride = null) {
  const safe = {};
  const state = stateOverride || (username !== "" ? ensurePlayerState(username) : null);
  const sourceSlots = rawSlots && typeof rawSlots === "object" && !Array.isArray(rawSlots) ? rawSlots : {};
  const fallbackSlots = getEquipmentSlotsFromPlayerState(state);
  const allowedSlots = [
    "hand", "back", "hair", "head", "hat", "eyes", "face",
    "shirt", "pants", "legs", "feet", "shoes",
    "neck", "aura"
  ];

  for (const slot of allowedSlots) {
    const hasIncomingSlot = Object.prototype.hasOwnProperty.call(sourceSlots, slot);
    const hasSavedSlot = Object.prototype.hasOwnProperty.call(fallbackSlots, slot);
    if (!hasIncomingSlot && !hasSavedSlot) continue;

    let value = clampString(sourceSlots[slot] || "");
    if (value === "" && !hasIncomingSlot && isCoreVisibleEquipmentSlot(slot)) {
      value = clampString(fallbackSlots[slot] || "");
    }
    if (value.length > 0 && isItemAllowedInEquipmentSlot(value, slot) && doesStateOwnEquippedItem(state, value, slot)) {
      safe[slot] = value;
    } else {
      safe[slot] = "";
    }
  }

  return safe;
}

function isItemAllowedInEquipmentSlot(itemId, slot) {
  const definition = ItemDatabase.getItemDefinition(itemId);
  if (!definition || !definition.equipable) return false;

  const equipmentSlot = String(definition.equipment_slot || "");
  if (equipmentSlot === "") return false;
  if (equipmentSlot === slot) return true;
  return equipmentSlot === "hand" && slot === "hand";
}

function doesStateOwnEquippedItem(state, itemId, slot) {
  if (itemId === "") return true;
  if (!state) return false;

  const definition = ItemDatabase.getItemDefinition(itemId);
  if (!definition) return false;

  return getInventoryCount(state, itemId, definition.category) > 0 && isItemAllowedInEquipmentSlot(itemId, slot);
}

function getPlayersInWorld(worldName, excludePlayerId = "") {
  const result = [];

  for (const player of players.values()) {
    if (player.id === excludePlayerId) continue;
    if (!player.joined_world) continue;
    if (player.world !== worldName) continue;

    refreshPlayerFishingPresence(player, worldName);
    const equipmentSlots = player.equipment_slots || {};
    const fishingTargetX = Number.isInteger(player.fishing_target_x) ? player.fishing_target_x : -1;
    const fishingTargetY = Number.isInteger(player.fishing_target_y) ? player.fishing_target_y : -1;
    const fishingActive = player.fishing_active === true && isGridInWorld(fishingTargetX, fishingTargetY);
    const damageFlash = getPublicPlayerDamageFlash(player);
    result.push({
      player_id: player.id,
      ...getPublicPlayerIdentity(player),
      x: player.x,
      y: player.y,
      facing: player.facing,
      world: player.world,
      animation_state: player.animation_state || "idle",
      velocity_x: sanitizePlayerVelocity(player.velocity_x || 0),
      velocity_y: sanitizePlayerVelocity(player.velocity_y || 0),
      on_floor: player.on_floor !== false,
      in_water: player.in_water === true,
      in_lava_fire: player.in_lava_fire === true,
      ...damageFlash,
      fishing_active: fishingActive,
      fishing_target_x: fishingActive ? fishingTargetX : -1,
      fishing_target_y: fishingActive ? fishingTargetY : -1,
      fishing_lure_id: fishingActive ? clampString(player.fishing_lure_id || "") : "",
      fishing_rod_id: fishingActive ? clampString(player.fishing_rod_id || "") : "",
      equipment_slots: equipmentSlots,
      equipped_tool: clampString(equipmentSlots.hand || ""),
      equipped_back_item: clampString(equipmentSlots.back || ""),
      equipped_back: clampString(equipmentSlots.back || ""),
      equipped_hair_item: clampString(equipmentSlots.hair || ""),
      equipped_shirt_item: clampString(equipmentSlots.shirt || ""),
      equipped_pants_item: clampString(equipmentSlots.pants || ""),
      equipped_shoes_item: clampString(equipmentSlots.shoes || ""),
    });
  }

  return result;
}

function broadcastSystemToWorld(worldName, message, excludePlayerId = "") {
  broadcastToWorld(worldName, {
    type: "chat",
    player_id: "system",
    name: "System",
    message,
    world: worldName,
  }, excludePlayerId);
}

function queuePlayerPositionBroadcast(worldName, message, excludePlayerId = "") {
  const clean = cleanWorld(worldName || message?.world || "START");
  const playerId = String(message?.player_id || excludePlayerId || "").trim();
  if (!clean || !playerId) return;

  let worldQueue = pendingPlayerPositionBroadcasts.get(clean);
  if (!worldQueue) {
    worldQueue = new Map();
    pendingPlayerPositionBroadcasts.set(clean, worldQueue);
  }

  worldQueue.set(playerId, {
    playerId,
    excludePlayerId: String(excludePlayerId || ""),
    message,
  });

  if (pendingPlayerPositionBroadcastTimers.has(clean)) return;

  const timer = setTimeout(() => {
    pendingPlayerPositionBroadcastTimers.delete(clean);
    flushQueuedPlayerPositionBroadcasts(clean);
  }, PLAYER_POSITION_BROADCAST_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  pendingPlayerPositionBroadcastTimers.set(clean, timer);
}

function flushQueuedPlayerPositionBroadcasts(worldName) {
  const clean = cleanWorld(worldName || "START");
  const worldQueue = pendingPlayerPositionBroadcasts.get(clean);
  if (!worldQueue) return;

  pendingPlayerPositionBroadcasts.delete(clean);

  for (const entry of worldQueue.values()) {
    const player = players.get(entry.playerId);
    if (!player || !player.joined_world || player.world !== clean) continue;
    broadcastToWorld(clean, entry.message, entry.excludePlayerId);
  }
}

function broadcastToWorld(worldName, message, excludePlayerId = "") {
  let raw;
  try {
    raw = JSON.stringify(message);
  } catch (error) {
    console.warn("[broadcast_serialize_error]", {
      world: worldName,
      message: error && error.message ? error.message : String(error),
    });
    return;
  }

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client.playerId === excludePlayerId) continue;

    const player = players.get(client.playerId);
    if (!player) continue;
    if (player.world !== worldName) continue;

    sendRawJsonToSocket(client, raw, "world_broadcast", {
      player_id: String(client.playerId || ""),
      world: worldName,
      message_type: String(message?.type || ""),
    });
  }
}

function broadcastToAuthenticatedPlayers(message, excludePlayerId = "") {
  let raw;
  try {
    raw = JSON.stringify(message);
  } catch (error) {
    console.warn("[broadcast_serialize_error]", {
      authenticated: true,
      message: error && error.message ? error.message : String(error),
    });
    return;
  }

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client.playerId === excludePlayerId) continue;

    const player = players.get(client.playerId);
    if (!player || !player.authenticated) continue;

    sendRawJsonToSocket(client, raw, "authenticated_broadcast", {
      player_id: String(client.playerId || ""),
      authenticated: true,
      message_type: String(message?.type || ""),
    });
  }
}

function flushPendingSaves(options = {}) {
  const syncLocalJson = options.syncLocalJson === true;
  for (const [worldName, timer] of worldSaveTimers.entries()) {
    clearTimeout(timer);
    saveWorldState(worldName);
  }
  worldSaveTimers.clear();
  flushWorldStateJsonBackups({ sync: syncLocalJson });

  for (const [usernameKey, timer] of playerSaveTimers.entries()) {
    clearTimeout(timer);
    const state = playerStates.get(usernameKey);
    if (state) savePlayerState(state.account_username || usernameKey);
  }
  playerSaveTimers.clear();

  if (accountsSaveTimer) {
    clearTimeout(accountsSaveTimer);
    accountsSaveTimer = null;
    saveAccounts();
  }
}

let shutdownStarted = false;
async function shutdown(signal = "") {
  if (shutdownStarted) return;
  shutdownStarted = true;
  if (signal !== "") {
    console.log(`PixelMania server shutting down (${signal}).`);
  }
  clearInterval(periodicSaveTimer);
  if (antiDupeAuditTimer) {
    clearInterval(antiDupeAuditTimer);
    antiDupeAuditTimer = null;
  }
  if (worldSnapshotSchedulerTimer) {
    clearInterval(worldSnapshotSchedulerTimer);
    worldSnapshotSchedulerTimer = null;
  }
  if (worldEventRandomTimer) {
    clearInterval(worldEventRandomTimer);
    worldEventRandomTimer = null;
  }
  for (const timer of worldEventTimers.values()) {
    clearTimeout(timer);
  }
  worldEventTimers.clear();
  for (const timers of worldEventCountdownTimers.values()) {
    if (Array.isArray(timers)) {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    }
  }
  worldEventCountdownTimers.clear();
  flushPendingSaves();
  await waitForPersistenceWrites();
  await postgresStore.close();
  await redisStore.close();
  process.exit(0);
}

function handleShutdownSignal(signal) {
  writeCrashReport("process_signal", {
    signal,
    runtime: getCrashRuntimeState(),
  });
  shutdown(signal).catch((error) => {
    fatalCrashReportWritten = true;
    writeCrashReport("shutdown_failure", {
      signal,
      error: errorToCrashDetails(error),
      runtime: getCrashRuntimeState(),
    });
    console.error("Shutdown failed:", error);
    process.exit(1);
  });
}

process.on("SIGINT", () => {
  handleShutdownSignal("SIGINT");
});

process.on("SIGTERM", () => {
  handleShutdownSignal("SIGTERM");
});

process.on("exit", (code) => {
  if (Number(code) !== 0 && !fatalCrashReportWritten) {
    writeCrashReport("process_exit", {
      exit_code: Number(code),
      runtime: getCrashRuntimeState(),
    });
  }
  flushPendingSaves({ syncLocalJson: true });
});
