require("dotenv").config({ quiet: true });

const WebSocket = require("ws");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const nodemailer = require("nodemailer");
const path = require("path");
const ItemDatabase = require("./server_item_database");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Math.max(1, Math.trunc(Number(process.env.PORT) || 8080));
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const SERVER_CLIENT_VERSION = String(process.env.SERVER_CLIENT_VERSION || "1.0.1").trim() || "1.0.1";
const MIN_CLIENT_VERSION = String(process.env.MIN_CLIENT_VERSION || SERVER_CLIENT_VERSION).trim() || SERVER_CLIENT_VERSION;
const UPDATE_URL = String(process.env.UPDATE_URL || "https://pixelmaniagame.com").trim() || "https://pixelmaniagame.com";
const DATA_FOLDER = process.env.PIXELMANIA_DATA_DIR ? path.resolve(process.env.PIXELMANIA_DATA_DIR) : __dirname;
const WORLD_SAVE_FOLDER = process.env.WORLD_SAVE_FOLDER ? path.resolve(process.env.WORLD_SAVE_FOLDER) : path.join(DATA_FOLDER, "worlds");
const PLAYER_SAVE_FOLDER = process.env.PLAYER_SAVE_FOLDER ? path.resolve(process.env.PLAYER_SAVE_FOLDER) : path.join(DATA_FOLDER, "players");
const ACCOUNTS_SAVE_PATH = process.env.ACCOUNTS_SAVE_PATH ? path.resolve(process.env.ACCOUNTS_SAVE_PATH) : path.join(DATA_FOLDER, "accounts.json");
const ADMIN_LOG_PATH = process.env.ADMIN_LOG_PATH ? path.resolve(process.env.ADMIN_LOG_PATH) : path.join(DATA_FOLDER, "admin_actions.log");
const INTEGRITY_LOG_FOLDER = process.env.INTEGRITY_LOG_FOLDER ? path.resolve(process.env.INTEGRITY_LOG_FOLDER) : path.join(DATA_FOLDER, "integrity_logs");
const WORLD_SNAPSHOT_FOLDER = process.env.WORLD_SNAPSHOT_FOLDER ? path.resolve(process.env.WORLD_SNAPSHOT_FOLDER) : path.join(DATA_FOLDER, "world_snapshots");
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
const MAX_CHAT_LENGTH = 220;
const MAX_SIGN_TEXT_LENGTH = 500;
const MAX_DROP_AMOUNT = 9999;
const MAX_ITEM_STACK = ItemDatabase.DEFAULT_STACK_LIMIT;
const MAX_PLAYER_INVENTORY_KEYS = 500;
const MAX_ITEM_ID_LENGTH = 64;
const MAX_DROP_ID_LENGTH = 96;
const ALLOW_LEGACY_PLAYER_STATE_IMPORT = !["0", "false", "no"].includes(String(process.env.ALLOW_LEGACY_PLAYER_STATE_IMPORT || "true").trim().toLowerCase());
const MAX_MOVE_PIXELS_PER_SECOND = 900;
const MAX_PICKUP_DISTANCE_PIXELS = TILE_SIZE * 6;
const MAX_GRID_ACTION_DISTANCE_PIXELS = TILE_SIZE * 6;
const MAX_DROP_CREATE_DISTANCE_PIXELS = TILE_SIZE * 6;
const SERVER_DROP_PICKUP_DELAY = 0.25;
const TRADE_SLOT_COUNT = 6;
const MAX_TRADE_DISTANCE_PIXELS = TILE_SIZE * 10;
const VEND_BLOCK_EMPTY = "vend_empty";
const VEND_BLOCK_PENDING = "vend_pending";
const VEND_BLOCK_SOLD = "vend_sold";
const VEND_BLOCK_TYPES = new Set([VEND_BLOCK_EMPTY, VEND_BLOCK_PENDING, VEND_BLOCK_SOLD]);
const VEND_LOG_LIMIT = 30;
const SAFE_BLOCK_TYPE = "safe";
const FISH_MONGER_BLOCK_TYPE = "fish_monger";
const ENTRANCE_GATE_TYPE = "entrance_gate";
const SAFE_SLOT_COUNT = 10;
const SERVER_SEED_GROW_TIME_SECONDS = Math.max(1, Number(process.env.SEED_GROW_TIME_SECONDS) || 8);
const MATURE_SEED_EXTRA_DROP_CHANCE = Math.max(0, Math.min(1, Number(process.env.MATURE_SEED_EXTRA_DROP_CHANCE) || 0.65));
const CONFIGURED_SEED_MUTATION_CHANCE = Number(process.env.SEED_MUTATION_CHANCE);
const SEED_MUTATION_CHANCE = Math.max(0, Math.min(1, Number.isFinite(CONFIGURED_SEED_MUTATION_CHANCE) ? CONFIGURED_SEED_MUTATION_CHANCE : 0.005));
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
const DEV_PIN = String(process.env.DEV_PIN || "").trim();
const DEV_PIN_HASH = String(process.env.DEV_PIN_HASH || "").trim().toLowerCase();
const DEV_PIN_REQUIRED = String(process.env.DEV_PIN_REQUIRED || "false").trim().toLowerCase() === "true" && (DEV_PIN !== "" || DEV_PIN_HASH !== "");
const DEV_PIN_UNLOCK_TTL_MS = Math.max(60 * 1000, Math.trunc(Number(process.env.DEV_PIN_UNLOCK_TTL_MINUTES) || 15) * 60 * 1000);
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Math.max(1, Math.trunc(Number(process.env.SMTP_PORT) || 587));
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true";
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "");
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || "PixelMania <no-reply@pixelmania.local>").trim();
const ADMIN_USERNAMES = new Set(["uso"]);
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
  player_state_request: { limit: 8, windowMs: 10000 },
  player_state_save: { limit: 6, windowMs: 10000 },
  join_world: { limit: 12, windowMs: 10000 },
  chat: { limit: 8, windowMs: 5000 },
  broadcast: { limit: 3, windowMs: 10000 },
  developer_pin_unlock: { limit: 5, windowMs: 15000 },
  developer_command_request: { limit: 5, windowMs: 5000 },
  world_block_update: { limit: 35, windowMs: 1000 },
  world_seed_update: { limit: 25, windowMs: 1000 },
  world_interaction_update: { limit: 20, windowMs: 1000 },
  world_item_drop_create: { limit: 20, windowMs: 1000 },
  world_drop_create: { limit: 20, windowMs: 1000 },
  world_item_drop_update: { limit: 30, windowMs: 1000 },
  world_drop_update: { limit: 30, windowMs: 1000 },
  world_item_drop_pickup: { limit: 30, windowMs: 1000 },
  world_item_drop_remove: { limit: 30, windowMs: 1000 },
  world_drop_pickup: { limit: 30, windowMs: 1000 },
  world_drop_remove: { limit: 30, windowMs: 1000 },
  player_position: { limit: 75, windowMs: 1000 },
};
const SHOP_CATALOG = new Map([
  ["world_lock", { item_id: "world_lock", item_category: "block", amount: 1, price: 3500 }],
  ["crafting_station", { item_id: "crafting_station", item_category: "block", amount: 1, price: 80 }],
  ["vend_empty", { item_id: "vend_empty", item_category: "block", amount: 1, price: 7500 }],
  ["safe", { item_id: "safe", item_category: "block", amount: 1, price: 7500 }],
  ["fish_monger", { item_id: "fish_monger", item_category: "block", amount: 1, price: 15000 }],
  ["purple_shirt", { item_id: "purple_shirt", item_category: "shirt", amount: 1, price: 50 }],
  ["purple_pants", { item_id: "purple_pants", item_category: "pants", amount: 1, price: 50 }],
  ["entrance_mover", { item_id: "entrance_mover", item_category: "tool", amount: 1, price: 200 }],
  ["fishing_rod", { item_id: "fishing_rod", item_category: "tool", amount: 1, price: 5000 }],
  ["lure_pack", { item_id: "lure_pack", item_category: "lure", amount: 1, price: 25, pack_size: 5 }],
]);
const LURE_PACK_TABLE = [
  { item_id: "worm_lure", item_category: "lure", weight: 65 },
  { item_id: "shiny_lure", item_category: "lure", weight: 28 },
  { item_id: "golden_lure", item_category: "lure", weight: 7 },
];

const httpServer = http.createServer(handleHttpRequest);
const wss = new WebSocket.Server({ server: httpServer });
const players = new Map();
const worldStates = new Map();
const playerStates = new Map();
const accounts = new Map();
const activeAccountSessions = new Map();
const activeTrades = new Map();
const tradeByPlayerId = new Map();
const activeFishingSessions = new Map();
const blockDamage = new Map();
const worldSaveTimers = new Map();
const playerSaveTimers = new Map();
let accountsSaveTimer = null;
let mailTransporter = null;
const periodicSaveTimer = setInterval(() => {
  flushPendingSaves();
}, PERIODIC_SAVE_MS);
if (typeof periodicSaveTimer.unref === "function") periodicSaveTimer.unref();

ensureDataFolders();
loadAccounts();

httpServer.listen(PORT, HOST, () => {
  console.log(`PixelMania server running on ws://${HOST}:${PORT}`);
  console.log(`PixelMania email verification running at ${PUBLIC_BASE_URL}/verify-email`);
  if (!SMTP_HOST) {
    console.warn("SMTP_HOST is not set. Verification links will be printed to the server console instead of emailed.");
  }
});

wss.on("connection", (socket) => {
  const playerId = crypto.randomUUID();

  players.set(playerId, {
    id: playerId,
    name: "Guest",
    account_username: "",
    account_email: "",
    authenticated: false,
    role: "player",
    world: "START",
    x: 0,
    y: 0,
    facing: 1,
    animation_state: "idle",
    equipment_slots: {},
    client_version: "",
    last_position_at: 0,
    last_block_break_at: 0,
    noclip_enabled: false,
    developer_pin_unlocked_until: 0,
  });

  socket.playerId = playerId;
  socket.rateLimits = new Map();
  socket.authRequiredNotices = new Map();

  socket.send(JSON.stringify({
    type: "connected",
    player_id: playerId,
  }));

  socket.on("message", (raw) => {
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

    if (!checkMessageRateLimit(socket, String(data.type || "unknown"))) return;

    const clientVersion = getClientVersion(data);
    if (!isClientVersionAllowed(clientVersion)) {
      sendClientUpdateRequired(socket, data, clientVersion);
      return;
    }
    player.client_version = clientVersion || player.client_version;

    if (data.type === "login") {
      player.name = cleanName(data.name);

      socket.send(JSON.stringify({
        type: "login_ok",
        player_id: playerId,
        name: player.name,
        username: player.account_username,
        email: player.account_email,
      }));
      return;
    }

    if (data.type === "account_register") {
      handleAccountRegister(socket, player, data);
      return;
    }

    if (data.type === "account_login") {
      handleAccountLogin(socket, player, data);
      return;
    }

    if (data.type === "account_token_login") {
      handleAccountTokenLogin(socket, player, data);
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
      handleInventoryTransactionRequest(socket, player, data);
      return;
    }

    if (data.type === "trade_request") {
      handleTradeRequest(socket, player, data);
      return;
    }

    if (data.type === "trade_response") {
      handleTradeResponse(socket, player, data);
      return;
    }

    if (data.type === "trade_offer_update") {
      handleTradeOfferUpdate(socket, player, data);
      return;
    }

    if (data.type === "trade_confirm") {
      handleTradeConfirm(socket, player, data);
      return;
    }

    if (data.type === "trade_final_confirm") {
      handleTradeFinalConfirm(socket, player, data);
      return;
    }

    if (data.type === "trade_cancel") {
      handleTradeCancel(socket, player, data);
      return;
    }

    if (data.type === "player_state_request") {
      if (!requireAuthenticated(socket, player, "load player data")) return;

      const username = cleanAccountName(data.username || player.account_username || player.name);
      if (username === "") return;
      if (!isPlayerOwnAccount(player, username)) return;

      const state = ensurePlayerState(username);
      socket.send(JSON.stringify({
        type: "player_state",
        found: state !== null,
        username,
        player_data: state || {},
      }));
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

      if (oldWorld && oldWorld !== newWorld) {
        cancelActiveTradeForPlayer(playerId, "Trade canceled because a player changed worlds.");
        activeFishingSessions.delete(playerId);
      }

      if (oldWorld && oldWorld !== newWorld) {
        broadcastSystemToWorld(oldWorld, `${player.name} left ${oldWorld}`);
        broadcastToWorld(oldWorld, {
          type: "player_left",
          player_id: playerId,
          name: player.name,
          world: oldWorld,
        }, playerId);
      }

      player.world = newWorld;
      player.last_position_at = 0;
      ensureWorldState(player.world);

      socket.send(JSON.stringify({
        type: "join_world_ok",
        world: player.world,
        players: getPlayersInWorld(player.world, playerId),
      }));

      socket.send(JSON.stringify(buildWorldStateMessage(player.world, { respawn_player: true })));

      broadcastToWorld(player.world, {
        type: "player_joined",
        player_id: playerId,
        name: player.name,
        role: getPublicPlayerRole(player),
        x: player.x,
        y: player.y,
        facing: player.facing,
        world: player.world,
        animation_state: player.animation_state || "idle",
        equipment_slots: player.equipment_slots,
      }, playerId);

      broadcastSystemToWorld(player.world, `${player.name} joined ${player.world}`, playerId);
      return;
    }

    if (data.type === "chat") {
      if (!requireAuthenticated(socket, player, "chat")) return;

      const message = String(data.message || "").trim().slice(0, MAX_CHAT_LENGTH);
      if (message.length === 0) return;

      if (message.toLowerCase().startsWith("/bc ")) {
        const broadcastMessage = message.slice(4).trim().slice(0, MAX_CHAT_LENGTH);
        if (broadcastMessage.length > 0) {
          broadcastToAuthenticatedPlayers({
            type: "broadcast",
            player_id: playerId,
            name: player.name,
            message: broadcastMessage,
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

      broadcastToAuthenticatedPlayers({
        type: "broadcast",
        player_id: playerId,
        name: player.name,
        message,
      });
      return;
    }

    if (data.type === "developer_pin_unlock") {
      handleDeveloperPinUnlock(socket, player, data);
      return;
    }

    if (data.type === "developer_command_request") {
      handleDeveloperCommandRequest(socket, player, data);
      return;
    }

    if (data.type === "world_block_update") {
      if (!requireAuthenticated(socket, player, "edit worlds")) return;

      const worldName = cleanWorld(data.world || player.world || "START");
      if (!requireSameWorld(socket, player, worldName, "edit that world")) return;

      const update = sanitizeBlockUpdate(data, worldName);
      if (!update) return;
      if (
        !canPlayerBuildInWorld(player, worldName) &&
        !canPlayerBreakOwnVendingMachine(player, worldName, update) &&
        !isFishMongerBreakAttempt(worldName, update)
      ) {
        sendActionRejected(socket, "world_block_update", "This world is locked.");
        return;
      }
      if ((update.action === "break" || update.action === "hit") && update.block_type === "world_lock" && isWorldLocked(worldName) && !canPlayerControlWorldLock(player, worldName)) {
        sendActionRejected(socket, "world_block_update", "Only the world lock owner can break the lock.");
        return;
      }
      if (update.action === "place" && update.block_type === "world_lock" && (ensureWorldState(worldName).world_lock?.is_locked || hasWorldLockBlock(worldName))) {
        sendActionRejected(socket, "world_block_update", "This world already has a lock.");
        return;
      }

      const validation = validateBlockUpdateAgainstServerState(socket, player, worldName, update);
      if (!validation.ok) return;
      if (validation.pendingHit) return;

      const blockTransactionId = makeAuditId("block");
      applyBlockUpdateToWorldState(worldName, update);
      if (update.action === "place" && isVendBlockType(update.block_type)) {
        initializeVendOwnerOnPlace(worldName, update, player);
      }
      if (update.action === "place" && isSafeBlockType(update.block_type)) {
        initializeSafeOwnerOnPlace(worldName, update, player);
      }
      queueWorldSave(worldName);
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
      const emittedDrops = emitBreakDrops(worldName, update, socket, player);
      logWorldChange(socket, player, {
        source_type: "world_block_update",
        source_id: blockTransactionId,
        world: worldName,
        action: update.action,
        layer: update.layer,
        x: update.x,
        y: update.y,
        block_type: update.block_type,
      });
      if (update.action === "place" && validation.playerState) {
        const placementCost = ItemDatabase.getPlacementCost(update.block_type);
        if (placementCost && Number(placementCost.amount) > 0) {
          logItemLedgerForState(socket, player, player.account_username, validation.playerState, placementCost.item_id, placementCost.item_category, -placementCost.amount, "world_block_place", blockTransactionId, "placement_cost", worldName, {
            x: update.x,
            y: update.y,
            placed_block: update.block_type,
            layer: update.layer,
          });
        }
      }
      for (const drop of emittedDrops) {
        logWorldChange(socket, player, {
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
        });
      }

      if (validation.playerState) {
        sendInventoryTransactionResult(socket, {
          ok: true,
          action: update.action === "break" ? "world_block_break" : "world_block_place",
          message: String(validation.message || ""),
          username: player.account_username,
          player_data: validation.playerState,
        });
      }
      return;
    }

    if (data.type === "world_seed_update") {
      if (!requireAuthenticated(socket, player, "edit worlds")) return;

      const worldName = cleanWorld(data.world || player.world || "START");
      if (!requireSameWorld(socket, player, worldName, "edit that world")) return;
      if (!requireBuildPermission(socket, player, worldName, "edit this locked world")) return;

      const update = sanitizeSeedUpdate(data, worldName);
      if (!update) return;

      const validation = validateSeedUpdateAgainstServerState(socket, player, worldName, update);
      if (!validation.ok) return;

      const seedTransactionId = makeAuditId("seed");
      applySeedUpdateToWorldState(worldName, update);
      queueWorldSave(worldName);
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
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
        });
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

      const update = sanitizeInteractionUpdate(data, worldName);
      if (!update) return;

      if (update.action === "entrance_gate_move") {
        if (!requireBuildPermission(socket, player, worldName, "move the Entrance Gate")) return;
        handleEntranceGateMoveUpdate(socket, player, worldName, update);
        return;
      }

      if (update.action === "world_lock_state") {
        if (!prepareWorldLockStateUpdate(socket, player, worldName, update)) return;
      } else if (!requireBuildPermission(socket, player, worldName, "edit this locked world")) {
        return;
      }

      applyInteractionUpdateToWorldState(worldName, update);
      queueWorldSave(worldName);
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
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
      } else if (update.action === "door_state") {
        interactionDetails.open = Boolean(update.open);
      }
      logWorldChange(socket, player, {
        source_type: "world_interaction_update",
        source_id: makeAuditId("interact"),
        world: worldName,
        action: update.action,
        layer: "interaction",
        x: update.x,
        y: update.y,
        block_type: update.block_type || "",
        details: interactionDetails,
      });
      return;
    }

    if (data.type === "world_item_drop_create" || data.type === "world_drop_create") {
      if (!requireAuthenticated(socket, player, "edit drops")) return;

      const worldName = cleanWorld(data.world || player.world || "START");
      if (!requireSameWorld(socket, player, worldName, "create drops in that world")) return;

      const update = sanitizeDropCreate(data, worldName);
      if (!update) return;
      if (!validateDropCreateAgainstServerState(socket, player, update)) return;

      const spendResult = spendServerInventoryCost(player.account_username, {
        item_id: update.item_type,
        item_category: update.item_category,
        amount: update.amount,
      });
      if (!spendResult.ok) {
        sendActionRejected(socket, "world_item_drop_create", spendResult.message);
        return;
      }

      const dropTransactionId = makeAuditId("drop");
      applyDropCreateToWorldState(worldName, update);
      queueWorldSave(worldName);
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
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
      });
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

      const worldName = cleanWorld(data.world || player.world || "START");
      if (!requireSameWorld(socket, player, worldName, "pick up drops in that world")) return;

      const update = sanitizeDropPickup(data, worldName, player);
      if (!update) return;

      const pickupTransactionId = makeAuditId("pickup");
      const pickedDrop = applyDropPickupToWorldState(worldName, update, player);
      if (!pickedDrop) {
        sendActionRejected(socket, "world_item_drop_pickup", "That drop is not available.");
        return;
      }

      const grant = grantItemToPlayerState(
        player.account_username,
        pickedDrop.item_type,
        pickedDrop.item_category,
        pickedDrop.amount
      );
      if (grant) {
        const pickupState = ensurePlayerState(player.account_username) || {};
        logWorldChange(socket, player, {
          source_type: "world_item_drop_pickup",
          source_id: pickupTransactionId,
          world: worldName,
          action: "drop_pickup",
          x: pickedDrop.x,
          y: pickedDrop.y,
          block_type: pickedDrop.item_type,
          details: {
            drop_id: pickedDrop.drop_id,
            item_category: pickedDrop.item_category,
            amount: pickedDrop.amount,
          },
        });
        logItemLedgerForState(socket, player, player.account_username, pickupState, pickedDrop.item_type, pickedDrop.item_category, pickedDrop.amount, "world_item_drop_pickup", pickupTransactionId, "drop_pickup", worldName, {
          drop_id: pickedDrop.drop_id,
        });
        sendInventoryTransactionResult(socket, {
          ok: true,
          action: "drop_pickup",
          message: `Picked up ${pickedDrop.amount} ${pickedDrop.item_type}.`,
          username: player.account_username,
          rewards: [{
            item_id: pickedDrop.item_type,
            item_category: pickedDrop.item_category,
            amount: pickedDrop.amount,
          }],
          player_data: pickupState,
        });
      } else {
        sendActionRejected(socket, "world_item_drop_pickup", "Could not add that item to your server inventory.");
        return;
      }

      queueWorldSave(worldName);
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);
      return;
    }

    if (data.type === "player_position") {
      if (!requireAuthenticated(socket, player, "move online")) return;

      player.name = player.account_username || player.name;

      const position = sanitizePlayerPosition(data, player);
      if (!position) return;
      if (!requireSameWorld(socket, player, position.world, "move in that world")) return;
      if (!acceptPlayerMovement(socket, player, position)) return;

      player.x = position.x;
      player.y = position.y;
      player.facing = position.facing;
      player.animation_state = sanitizePlayerAnimationState(data.animation_state);

      if (data.equipment_slots && typeof data.equipment_slots === "object" && !Array.isArray(data.equipment_slots)) {
        player.equipment_slots = sanitizeEquipmentSlots(data.equipment_slots, player.account_username);
      } else {
        player.equipment_slots = sanitizeEquipmentSlots({
          hand: data.equipped_tool || "",
          back: data.equipped_back || "",
        }, player.account_username);
      }

      broadcastToWorld(player.world, {
        type: "player_position",
        player_id: playerId,
        name: player.name,
        role: getPublicPlayerRole(player),
        x: player.x,
        y: player.y,
        facing: player.facing,
        world: position.world,
        animation_state: player.animation_state,
        equipment_slots: player.equipment_slots,
      }, playerId);
      return;
    }
  });

  socket.on("close", () => {
    const player = players.get(playerId);
    if (player) {
      cancelActiveTradeForPlayer(playerId, "Trade canceled because a player disconnected.");
      activeFishingSessions.delete(playerId);
      releaseActiveAccountSession(player);

      broadcastToWorld(player.world, {
        type: "player_left",
        player_id: playerId,
        name: player.name,
        world: player.world,
      }, playerId);

      broadcastSystemToWorld(player.world, `${player.name} left ${player.world}`, playerId);
    }

    players.delete(playerId);
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

function handleHttpRequest(request, response) {
  let url;
  try {
    url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  } catch (_error) {
    sendHtml(response, 400, "Bad Request", "That verification link is not valid.");
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({
      ok: true,
      service: "PixelManiaServer",
      server_client_version: SERVER_CLIENT_VERSION,
      min_client_version: MIN_CLIENT_VERSION,
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

function ensureDataFolders() {
  fs.mkdirSync(WORLD_SAVE_FOLDER, { recursive: true });
  fs.mkdirSync(PLAYER_SAVE_FOLDER, { recursive: true });
  fs.mkdirSync(path.dirname(ADMIN_LOG_PATH), { recursive: true });
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

function makeRequestId(data) {
  return String(data.request_id || "").trim();
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

  socket.send(JSON.stringify({
    type: "client_update_required",
    ok: false,
    request_id: makeRequestId(data || {}),
    client_version: String(clientVersion || ""),
    server_client_version: SERVER_CLIENT_VERSION,
    min_client_version: MIN_CLIENT_VERSION,
    update_url: UPDATE_URL,
    message: `This PixelMania version is out of date. Please update to version ${MIN_CLIENT_VERSION} or newer.`,
  }));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
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

function makePasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(account, password) {
  if (!account || !account.password_salt || !account.password_hash) return false;

  const result = makePasswordHash(password, account.password_salt);
  const expected = Buffer.from(account.password_hash, "hex");
  const actual = Buffer.from(result.hash, "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function makeTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function issueSessionToken(account) {
  const token = crypto.randomBytes(32).toString("hex");
  account.session_token_hash = makeTokenHash(token);
  account.session_token_expires_at = new Date(Date.now() + SESSION_TOKEN_TTL_MS).toISOString();
  account.last_seen_at = new Date().toISOString();
  queueAccountsSave();
  return token;
}

function clearSessionToken(account) {
  if (!account) return;
  account.session_token_hash = "";
  account.session_token_expires_at = "";
  queueAccountsSave();
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

  if (existingPlayer) {
    cancelActiveTradeForPlayer(activePlayerId, "Trade canceled because the account signed on somewhere else.");
    activeFishingSessions.delete(activePlayerId);
  }

  if (existingSocket) {
    sendJson(existingSocket, {
      type: "account_session_replaced",
      message: "This account signed on somewhere else.",
    });
    existingSocket.close(4001, "Account signed on elsewhere");
    return;
  }

  if (existingPlayer) {
    broadcastToWorld(existingPlayer.world, {
      type: "player_left",
      player_id: activePlayerId,
      name: existingPlayer.name,
      world: existingPlayer.world,
    }, activePlayerId);
    broadcastSystemToWorld(existingPlayer.world, `${existingPlayer.name} left ${existingPlayer.world}`, activePlayerId);
    players.delete(activePlayerId);
  }
}

function releaseActiveAccountSession(player) {
  if (!player || !player.account_username) return;

  const key = accountKey(player.account_username);
  if (activeAccountSessions.get(key) === player.id) {
    activeAccountSessions.delete(key);
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
  activeAccountSessions.set(accountKey(account.username), player.id);

  return { ok: true };
}

function isPlayerOwnAccount(player, username) {
  return accountKey(username) === accountKey(player.account_username);
}

function sendAuthError(socket, requestId, action, message, extra = {}) {
  socket.send(JSON.stringify({
    type: "account_auth_error",
    ok: false,
    request_id: requestId,
    action,
    message,
    ...extra,
  }));
}

function sendAuthOk(socket, requestId, action, account, token) {
  const role = getAccountRole(account.username);
  socket.send(JSON.stringify({
    type: "account_auth_ok",
    ok: true,
    request_id: requestId,
    action,
    username: account.username,
    email: cleanEmail(account.email || ""),
    session_token: token,
    session_token_expires_at: String(account.session_token_expires_at || ""),
    role,
    email_verified: isAccountEmailVerified(account),
    developer_pin_required: isDeveloperRole(role) && DEV_PIN_REQUIRED,
    developer_pin_unlocked: !DEV_PIN_REQUIRED,
  }));
}

function sendVerificationRequired(socket, requestId, action, account, message) {
  socket.send(JSON.stringify({
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
  }));
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
    session_token_hash: "",
    email_verified: false,
    email_verified_at: "",
    role: getAccountRole(usernameValidation.username),
    created_at: existing?.created_at || now,
    last_seen_at: now,
  };

  const verificationToken = makeEmailVerificationToken(account);
  accounts.set(key, account);
  queueAccountsSave();
  queueVerificationEmail(account, verificationToken);
  sendVerificationRequired(socket, requestId, "register", account, "Account created. Check your email to verify before signing on.");
}

function handleAccountLogin(socket, player, data) {
  const requestId = makeRequestId(data);
  const username = cleanAccountName(data.username);
  const email = cleanEmail(data.email || "");
  if (username === "") {
    sendAuthError(socket, requestId, "login", "Enter your username.");
    return;
  }

  if (email === "") {
    sendAuthError(socket, requestId, "login", "Enter your email address.");
    return;
  }

  const account = accounts.get(accountKey(username));
  if (!account || !hasPassword(account)) {
    sendAuthError(socket, requestId, "login", "Username not found.");
    return;
  }

  if (email !== cleanEmail(account.email || "")) {
    sendAuthError(socket, requestId, "login", "Email does not match that username.");
    return;
  }

  if (!verifyPassword(account, data.password)) {
    sendAuthError(socket, requestId, "login", "Password does not match.");
    return;
  }

  if (!isAccountEmailVerified(account)) {
    if (hasActiveEmailVerificationToken(account)) {
      sendAuthError(socket, requestId, "login", "Verify your email before signing on. Check your email for the verification link.", {
        requires_email_verification: true,
        email: cleanEmail(account.email || ""),
      });
      return;
    }

    const verificationToken = makeEmailVerificationToken(account);
    queueAccountsSave();
    queueVerificationEmail(account, verificationToken);
    sendAuthError(socket, requestId, "login", "Verify your email before signing on. I sent a new verification email.", {
      requires_email_verification: true,
      email: cleanEmail(account.email || ""),
    });
    return;
  }

  const activation = activatePlayerAccount(socket, player, account, { replaceExisting: true });
  if (!activation.ok) {
    sendAuthError(socket, requestId, "login", activation.message);
    return;
  }

  account.last_seen_at = new Date().toISOString();
  const token = issueSessionToken(account);
  sendAuthOk(socket, requestId, "login", account, token);
}

function handleAccountTokenLogin(socket, player, data) {
  const requestId = makeRequestId(data);
  const username = cleanAccountName(data.username);
  const token = String(data.session_token || "").trim();
  if (username === "" || token === "") {
    sendAuthError(socket, requestId, "token_login", "Saved login expired. Sign on again.");
    return;
  }

  const account = accounts.get(accountKey(username));
  if (!isSessionTokenValid(account, token)) {
    sendAuthError(socket, requestId, "token_login", "Saved login expired. Sign on again.");
    return;
  }

  if (!isAccountEmailVerified(account)) {
    sendAuthError(socket, requestId, "token_login", "Verify your email before signing on.", {
      requires_email_verification: true,
      email: cleanEmail(account.email || ""),
    });
    return;
  }

  const activation = activatePlayerAccount(socket, player, account, { replaceExisting: true });
  if (!activation.ok) {
    sendAuthError(socket, requestId, "token_login", activation.message);
    return;
  }

  account.last_seen_at = new Date().toISOString();
  const nextToken = issueSessionToken(account);
  sendAuthOk(socket, requestId, "token_login", account, nextToken);
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

  socket.send(JSON.stringify({
    type: "auth_required",
    message: `Sign on before you ${action}.`,
  }));
  return false;
}

function sendPlayerState(socket, username) {
  const state = ensurePlayerState(username);
  socket.send(JSON.stringify({
    type: "player_state",
    found: state !== null,
    username: cleanAccountName(username),
    player_data: state || {},
  }));
}

function sendInventoryTransactionResult(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({
    ...payload,
    type: "inventory_transaction_result",
    ok: Boolean(payload.ok),
    request_id: String(payload.request_id || ""),
    action: String(payload.action || ""),
    message: String(payload.message || ""),
    username: cleanAccountName(payload.username || ""),
    rewards: Array.isArray(payload.rewards) ? payload.rewards : [],
    player_data: payload.player_data || {},
  }));
}

function sendWorldUpdateToRequesterAndWorld(socket, player, worldName, payload) {
  sendJson(socket, payload);
  broadcastToWorld(worldName, payload, String(player?.id || socket?.playerId || ""));
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
  socket.send(JSON.stringify(payload));
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
  const payload = JSON.stringify(buildTradeStateMessage(trade, message));

  for (const playerId of getTradePartyIds(trade)) {
    const record = getTradeParticipantRecord(playerId);
    if (!record) continue;
    record.socket.send(payload);
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

function handleTradeRequest(socket, player, data) {
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

function handleTradeFinalConfirm(socket, player, data) {
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
    executeTrade(trade);
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

function executeTrade(trade) {
  const requesterRecord = getTradeParticipantRecord(trade.requester_id);
  const targetRecord = getTradeParticipantRecord(trade.target_id);
  if (!requesterRecord || !targetRecord) {
    cancelTrade(trade, "Trade canceled because a player is no longer online.");
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

  if (!applyValidatedTrade(stateA, stateB, validation.offersA, validation.offersB)) {
    cancelTrade(trade, "Trade canceled because inventory changed.");
    return;
  }

  const savedAt = new Date().toISOString();
  stateA.saved_at = savedAt;
  stateB.saved_at = savedAt;
  setPlayerState(trade.requester_username, stateA);
  setPlayerState(trade.target_username, stateB);
  queuePlayerSave(trade.requester_username);
  queuePlayerSave(trade.target_username);

  const tradeTransactionId = makeAuditId("trade");
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
    logItemLedgerForState(requesterRecord.socket, requesterRecord.player, trade.requester_username, stateA, item.item_id, item.item_category, -item.amount, "trade", tradeTransactionId, "trade_sent", requesterRecord.player.world, { trade_id: trade.id, counterparty: trade.target_username });
    logItemLedgerForState(targetRecord.socket, targetRecord.player, trade.target_username, stateB, item.item_id, item.item_category, item.amount, "trade", tradeTransactionId, "trade_received", targetRecord.player.world, { trade_id: trade.id, counterparty: trade.requester_username });
  }
  for (const item of validation.offersB) {
    logItemLedgerForState(targetRecord.socket, targetRecord.player, trade.target_username, stateB, item.item_id, item.item_category, -item.amount, "trade", tradeTransactionId, "trade_sent", targetRecord.player.world, { trade_id: trade.id, counterparty: trade.requester_username });
    logItemLedgerForState(requesterRecord.socket, requesterRecord.player, trade.requester_username, stateA, item.item_id, item.item_category, item.amount, "trade", tradeTransactionId, "trade_received", requesterRecord.player.world, { trade_id: trade.id, counterparty: trade.target_username });
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
}

function handleInventoryTransactionRequest(socket, player, data) {
  if (!requireAuthenticated(socket, player, "change inventory")) return;

  const action = String(data.action || "").trim();
  if (action === "shop_buy") {
    handleShopBuyTransaction(socket, player, data);
    return;
  }

  if (action === "vend_get_state" || action === "vend_set_listing" || action === "vend_buy" || action === "vend_collect" || action === "vend_cancel") {
    handleVendingTransaction(socket, player, data);
    return;
  }

  if (action === "safe_get_state" || action === "safe_deposit" || action === "safe_withdraw") {
    handleSafeTransaction(socket, player, data);
    return;
  }

  if (action === "craft_recipe" || action === "furnace_recipe") {
    handleStationRecipeTransaction(socket, player, data);
    return;
  }

  if (action === "fishing_start") {
    handleFishingStartTransaction(socket, player, data);
    return;
  }

  if (action === "fishing_complete") {
    handleFishingCompleteTransaction(socket, player, data);
    return;
  }

  if (action === "fish_monger_sell" || action === "fish_monger_sell_all") {
    handleFishMongerTransaction(socket, player, data);
    return;
  }

  if (action === "drop_inventory_item") {
    handleDropInventoryItemTransaction(socket, player, data);
    return;
  }

  if (action === "trash_inventory_item") {
    handleTrashInventoryItemTransaction(socket, player, data);
    return;
  }

  if (action === "seed_place") {
    handleSeedPlaceTransaction(socket, player, data);
    return;
  }

  if (action === "seed_splice") {
    handleSeedSpliceTransaction(socket, player, data);
    return;
  }

  if (action === "seed_harvest") {
    handleSeedHarvestTransaction(socket, player, data);
    return;
  }

  sendInventoryTransactionRejected(socket, data, "Unknown inventory transaction.");
}

function handleShopBuyTransaction(socket, player, data) {
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

  if (itemId === "lure_pack") {
    const rewardTableValid = LURE_PACK_TABLE.every((reward) => (
      ItemDatabase.hasItem(reward.item_id) &&
      ItemDatabase.canStoreItemInCategory(reward.item_id, reward.item_category)
    ));
    if (!rewardTableValid) {
      sendInventoryTransactionRejected(socket, data, "Lure Pack rewards are not configured.");
      return;
    }
  }

  const requestedAmount = clampInteger(data.amount || listing.amount, 1, ItemDatabase.getStackLimit(listing.item_id));
  const requestedPrice = clampInteger(data.price || listing.price, 0, MAX_ITEM_STACK);
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

  if (!spendItemFromState(state, "gem", "currency", listing.price)) {
    sendInventoryTransactionRejected(socket, data, "Not enough gems.");
    return;
  }

  const rewards = [];
  if (itemId === "lure_pack") {
    for (let i = 0; i < listing.pack_size * listing.amount; i += 1) {
      const reward = rollWeightedReward(LURE_PACK_TABLE);
      addItemToState(state, reward.item_id, reward.item_category, 1);
      rewards.push({
        item_id: reward.item_id,
        item_category: reward.item_category,
        amount: 1,
      });
    }
  } else {
    addItemToState(state, listing.item_id, listing.item_category, listing.amount);
    rewards.push({
      item_id: listing.item_id,
      item_category: listing.item_category,
      amount: listing.amount,
    });
  }

  state.saved_at = new Date().toISOString();
  setPlayerState(username, state);
  queuePlayerSave(username);

  const purchaseId = makeAuditId("shop");
  const combinedRewards = combineRewardEntries(rewards);
  const gemBalanceAfter = getInventoryCount(state, "gem", "currency");
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
    state,
    "gem",
    "currency",
    -listing.price,
    "shop_purchase",
    purchaseId,
    "shop_price",
    player.world,
    { listing_id: itemId }
  );
  logRewardLedgers(socket, player, username, state, combinedRewards, "shop_purchase", purchaseId, "shop_reward", player.world, { listing_id: itemId });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "shop_buy",
    item_id: itemId,
    message: itemId === "lure_pack" ? "Purchased and opened Lure Pack." : `Purchased ${listing.item_id}.`,
    username,
    rewards: combinedRewards,
    player_data: state,
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

function hasWorldLockBlock(worldName) {
  const state = ensureWorldState(worldName);
  for (const block of state.foreground.values()) {
    if (clampString(block?.block_type || "") === "world_lock") {
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
  return (isWorldLocked(worldName) || hasWorldLockBlock(worldName)) && canPlayerBuildInWorld(player, worldName);
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
  if (cleanItemId === "punch" || cleanItemId === "world_lock") return false;
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

function handleVendingTransaction(socket, player, data) {
  const action = String(data.action || "").trim();
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "use that vending machine")) return;

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
    handleVendSetListing(socket, player, data, worldName, vend);
    return;
  }

  if (action === "vend_buy") {
    handleVendBuy(socket, player, data, worldName, vend);
    return;
  }

  if (action === "vend_collect") {
    handleVendCollect(socket, player, data, worldName, vend);
    return;
  }

  if (action === "vend_cancel") {
    handleVendCancel(socket, player, data, worldName, vend);
    return;
  }

  rejectVendTransaction(socket, data, "Unknown vending action.");
}

function handleVendSetListing(socket, player, data, worldName, vend) {
  const hasOwner = accountKey(vend.owner_username || "") !== "";
  if (!hasOwner && !canPlayerPlaceVendingMachine(player, worldName)) {
    rejectVendTransaction(socket, data, isWorldLocked(worldName) ? "Only the world owner can list items in vending machines here." : "You cannot use this vending machine.");
    return;
  }

  if (hasOwner && !canPlayerManageVend(player, vend, worldName)) {
    rejectVendTransaction(socket, data, isWorldLocked(worldName) ? "Only the world owner can change this vending machine." : "Only the vending machine owner can change this listing.");
    return;
  }

  if (vend.listing || Number(vend.pending_wls) > 0) {
    rejectVendTransaction(socket, data, "Cancel or collect the current vending machine first.");
    return;
  }

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

  if (getInventoryCount(state, itemId, itemCategory) < stock) {
    rejectVendTransaction(socket, data, `Not enough ${itemId}.`);
    return;
  }

  if (!spendItemFromState(state, itemId, itemCategory, stock)) {
    rejectVendTransaction(socket, data, "Server inventory changed. Try again.");
    return;
  }

  vend.owner_username = player.account_username;
  vend.owner_name = player.account_username.toUpperCase();
  vend.listing = {
    item_id: itemId,
    item_category: itemCategory,
    stock,
    amount_per_sale: amountPerSale,
    price_wls: priceWls,
    created_at: new Date().toISOString(),
  };
  vend.pending_wls = 0;

  const savedVend = setVendStateAt(worldName, vend);
  persistPlayerInventoryChange(player.account_username, state);
  queueWorldSave(worldName);
  const vendTransactionId = makeAuditId("vend");
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
    details: { amount_per_sale: amountPerSale },
  });
  logItemLedgerForState(socket, player, player.account_username, state, itemId, itemCategory, -stock, "vending_list", vendTransactionId, "vend_listing", worldName, {
    x: vend.x,
    y: vend.y,
    amount_per_sale: amountPerSale,
    price_wls: priceWls,
  });
  sendVendStateUpdateToWorld(worldName, savedVend);
  sendVendTransactionResult(socket, data, player, savedVend, true, "Vending machine listing saved.", state);
}

function handleVendBuy(socket, player, data, worldName, vend) {
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

  if (!spendItemFromState(buyerState, "world_lock", "block", priceWls)) {
    rejectVendTransaction(socket, data, "Server inventory changed. Try again.");
    return;
  }

  addItemToState(buyerState, listing.item_id, listing.item_category, itemAmount);

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
  queueWorldSave(worldName);
  const vendTransactionId = makeAuditId("vend");
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
  });
  logItemLedgerForState(socket, player, player.account_username, buyerState, soldItemId, soldItemCategory, itemAmount, "vending_buy", vendTransactionId, "vend_purchase", worldName, {
    x: vend.x,
    y: vend.y,
    owner_username: vend.owner_username,
  });
  sendVendStateUpdateToWorld(worldName, savedVend);
  sendVendTransactionResult(socket, data, player, savedVend, true, "Purchase complete.", buyerState);
}

function handleVendCollect(socket, player, data, worldName, vend) {
  if (!canPlayerManageVend(player, vend, worldName)) {
    rejectVendTransaction(socket, data, "Only the vending machine owner can collect from it.");
    return;
  }

  const pendingWls = clampInteger(vend.pending_wls || 0, 0, ItemDatabase.getStackLimit("world_lock"));
  if (pendingWls <= 0) {
    rejectVendTransaction(socket, data, "No World Locks to collect.");
    return;
  }

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    rejectVendTransaction(socket, data, "Could not load your server inventory.");
    return;
  }

  if (!canAddItemToState(state, "world_lock", "block", pendingWls)) {
    rejectVendTransaction(socket, data, "Your inventory cannot hold those World Locks.");
    return;
  }

  addItemToState(state, "world_lock", "block", pendingWls);
  vend.pending_wls = 0;
  clearVendOwnerIfEmpty(vend);

  const savedVend = setVendStateAt(worldName, vend);
  persistPlayerInventoryChange(player.account_username, state);
  queueWorldSave(worldName);
  const vendTransactionId = makeAuditId("vend");
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
  logItemLedgerForState(socket, player, player.account_username, state, "world_lock", "block", pendingWls, "vending_collect", vendTransactionId, "vend_collect", worldName, {
    x: vend.x,
    y: vend.y,
  });
  sendVendStateUpdateToWorld(worldName, savedVend);
  sendVendTransactionResult(socket, data, player, savedVend, true, `Collected ${pendingWls} World Locks.`, state);
}

function handleVendCancel(socket, player, data, worldName, vend) {
  if (!canPlayerManageVend(player, vend, worldName)) {
    rejectVendTransaction(socket, data, "Only the vending machine owner can cancel this listing.");
    return;
  }

  if (!vend.listing) {
    rejectVendTransaction(socket, data, "There is no listing to cancel.");
    return;
  }

  const listing = vend.listing;
  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    rejectVendTransaction(socket, data, "Could not load your server inventory.");
    return;
  }

  if (!canAddItemToState(state, listing.item_id, listing.item_category, listing.stock)) {
    rejectVendTransaction(socket, data, "Your inventory cannot hold the returned items.");
    return;
  }

  addItemToState(state, listing.item_id, listing.item_category, listing.stock);
  vend.listing = null;
  clearVendOwnerIfEmpty(vend);

  const savedVend = setVendStateAt(worldName, vend);
  persistPlayerInventoryChange(player.account_username, state);
  queueWorldSave(worldName);
  const vendTransactionId = makeAuditId("vend");
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
    details: { amount_per_sale: listing.amount_per_sale },
  });
  logItemLedgerForState(socket, player, player.account_username, state, listing.item_id, listing.item_category, listing.stock, "vending_cancel", vendTransactionId, "vend_cancel", worldName, {
    x: vend.x,
    y: vend.y,
  });
  sendVendStateUpdateToWorld(worldName, savedVend);
  sendVendTransactionResult(socket, data, player, savedVend, true, "Vending listing canceled.", state);
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

function handleSafeTransaction(socket, player, data) {
  const action = String(data.action || "").trim();
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "use that safe")) return;

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
    handleSafeDeposit(socket, player, data, worldName, safe);
    return;
  }

  if (action === "safe_withdraw") {
    handleSafeWithdraw(socket, player, data, worldName, safe);
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

function handleSafeDeposit(socket, player, data, worldName, safe) {
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

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    rejectSafeTransaction(socket, data, "Could not load your server inventory.");
    return;
  }

  if (getInventoryCount(state, itemId, itemCategory) < amount) {
    rejectSafeTransaction(socket, data, `Not enough ${itemId}.`);
    return;
  }

  if (!spendItemFromState(state, itemId, itemCategory, amount)) {
    rejectSafeTransaction(socket, data, "Server inventory changed. Try again.");
    return;
  }

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
  persistPlayerInventoryChange(player.account_username, state);
  queueWorldSave(worldName);
  const safeTransactionId = makeAuditId("safe");
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
  logItemLedgerForState(socket, player, player.account_username, state, itemId, itemCategory, -amount, "safe_deposit", safeTransactionId, "safe_storage", worldName, {
    x: safe.x,
    y: safe.y,
  });
  sendSafeStateUpdateToWorld(worldName, savedSafe);
  sendSafeTransactionResult(socket, data, player, savedSafe, true, `Stored ${itemId} x${amount}.`, state);
}

function handleSafeWithdraw(socket, player, data, worldName, safe) {
  const slotIndex = clampInteger(data.slot_index || data.slot || 0, 0, SAFE_SLOT_COUNT - 1);
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

  addItemToState(state, slot.item_id, slot.item_category, amount);
  slot.amount -= amount;
  if (slot.amount <= 0) {
    safe.slots.splice(slotIndex, 1);
  } else {
    safe.slots[slotIndex] = slot;
  }

  const savedSafe = setSafeStateAt(worldName, safe);
  persistPlayerInventoryChange(player.account_username, state);
  queueWorldSave(worldName);
  const safeTransactionId = makeAuditId("safe");
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
  logItemLedgerForState(socket, player, player.account_username, state, slot.item_id, slot.item_category, amount, "safe_withdraw", safeTransactionId, "safe_withdraw", worldName, {
    x: safe.x,
    y: safe.y,
  });
  sendSafeStateUpdateToWorld(worldName, savedSafe);
  sendSafeTransactionResult(socket, data, player, savedSafe, true, `Withdrew ${slot.item_id} x${amount}.`, state);
}

function prepareSafeBreakInventoryReturn(socket, player, worldName, update) {
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

  const stagedState = JSON.parse(JSON.stringify(state));
  for (const slot of slots) {
    if (!canAddItemToState(stagedState, slot.item_id, slot.item_category, slot.amount)) {
      sendActionRejected(socket, "world_block_update", "Your inventory cannot hold the safe contents.");
      return { ok: false };
    }
    addItemToState(stagedState, slot.item_id, slot.item_category, slot.amount);
  }

  safe.slots = [];
  persistPlayerInventoryChange(player.account_username, stagedState);
  setSafeStateAt(worldName, safe);
  const safeBreakTransactionId = makeAuditId("safe_break");
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
    logItemLedgerForState(socket, player, player.account_username, stagedState, slot.item_id, slot.item_category, slot.amount, "safe_break_return", safeBreakTransactionId, "safe_break_return", worldName, {
      x: safe.x,
      y: safe.y,
    });
  }

  return {
    ok: true,
    playerState: stagedState,
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

function handleStationRecipeTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "use that station")) return;

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

  for (const cost of costs) {
    if (getInventoryCount(state, cost.item_id, cost.item_category) < cost.amount) {
      sendInventoryTransactionRejected(socket, data, `Not enough ${cost.item_id}.`);
      return;
    }
  }

  for (const cost of costs) {
    if (!spendItemFromState(state, cost.item_id, cost.item_category, cost.amount)) {
      sendInventoryTransactionRejected(socket, data, "Server inventory changed. Try again.");
      return;
    }
  }

  if (!addItemToState(state, output.item_id, output.item_category, output.amount)) {
    sendInventoryTransactionRejected(socket, data, "Could not add recipe output.");
    return;
  }

  persistPlayerInventoryChange(username, state);

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: stationId === "furnace" ? "furnace_recipe" : "craft_recipe",
    station_id: stationId,
    recipe_id: recipe.id,
    message: stationId === "furnace" ? `Smelted ${output.item_id}.` : `Crafted ${output.item_id}.`,
    username,
    rewards: [output],
    player_data: state,
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

  if (!isPlayerNearGrid(player, grid.x, grid.y, MAX_GRID_ACTION_DISTANCE_PIXELS)) {
    sendInventoryTransactionRejected(socket, data, "Water is too far away.");
    return false;
  }

  const worldState = ensureWorldState(worldName);
  const serverBlock = worldState.foreground.get(gridKey(grid.x, grid.y));
  if (serverBlock && String(serverBlock.block_type || "") !== "water") {
    sendInventoryTransactionRejected(socket, data, "Cast the fishing rod on water.");
    return false;
  }

  return true;
}

function rollFishingReward(lureId) {
  const entry = rollWeightedReward(ItemDatabase.getFishingTable(lureId));
  if (!entry) return null;

  const fishId = clampString(entry.fish_id || "");
  if (!ItemDatabase.hasItem(fishId) || resolveInventoryCategory(fishId) !== "fish") return null;

  return {
    fish_id: fishId,
    difficulty: clampInteger(entry.difficulty || 1, 1, 10),
  };
}

function getFishingServerCatchChance(difficulty) {
  const safeDifficulty = clampInteger(difficulty || 1, 1, 10);
  return Math.max(0.7, Math.min(0.98, 1.02 - safeDifficulty * 0.035));
}

function handleFishingStartTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "fish in that world")) return;

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

  if (!spendItemFromState(state, lureId, "lure", 1)) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${lureId}.`);
    return;
  }

  const reward = rollFishingReward(lureId);
  if (!reward) {
    sendInventoryTransactionRejected(socket, data, "Fishing rewards are not configured.");
    return;
  }

  const sessionId = crypto.randomUUID();
  persistPlayerInventoryChange(username, state);
  logItemLedgerForState(socket, player, username, state, lureId, "lure", -1, "fishing_start", sessionId, "fishing_lure_cost", worldName, {
    target_x: grid.x,
    target_y: grid.y,
  });
  activeFishingSessions.set(player.id, {
    session_id: sessionId,
    username,
    world: worldName,
    lure_id: lureId,
    fish_id: reward.fish_id,
    difficulty: reward.difficulty,
    target_x: grid.x,
    target_y: grid.y,
    expires_at: Date.now() + FISHING_SESSION_TTL_MS,
  });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "fishing_start",
    message: `Casting with ${lureId}.`,
    username,
    lure_id: lureId,
    session_id: sessionId,
    fish_id: reward.fish_id,
    difficulty: reward.difficulty,
    target_x: grid.x,
    target_y: grid.y,
    player_data: state,
  });
}

function handleFishingCompleteTransaction(socket, player, data) {
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

  if (Date.now() > session.expires_at || player.world !== session.world) {
    sendInventoryTransactionRejected(socket, data, "The fish got away.");
    return;
  }

  const success = Boolean(data.success) && randomChance(getFishingServerCatchChance(session.difficulty));
  if (!success) {
    sendInventoryTransactionResult(socket, {
      ok: true,
      request_id: requestId,
      action: "fishing_complete",
      message: "The fish got away.",
      username: player.account_username,
      fish_id: "",
      player_data: ensurePlayerState(player.account_username) || {},
    });
    return;
  }

  const state = ensureWritablePlayerState(player.account_username);
  if (!state || !addItemToState(state, session.fish_id, "fish", 1)) {
    sendInventoryTransactionRejected(socket, data, "Could not save caught fish.");
    return;
  }

  persistPlayerInventoryChange(player.account_username, state);
  logItemLedgerForState(socket, player, player.account_username, state, session.fish_id, "fish", 1, "fishing_complete", session.session_id, "fishing_reward", session.world, {
    lure_id: session.lure_id,
    difficulty: session.difficulty,
    target_x: session.target_x,
    target_y: session.target_y,
  });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "fishing_complete",
    message: `Caught ${session.fish_id}.`,
    username: player.account_username,
    fish_id: session.fish_id,
    rewards: [{ item_id: session.fish_id, item_category: "fish", amount: 1 }],
    player_data: state,
  });
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

function handleFishMongerTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const action = String(data.action || "").trim();
  const worldName = getTransactionWorldName(player, data);
  if (cleanWorld(player.world || "START") !== worldName) {
    sendInventoryTransactionRejected(socket, data, "Join that world before selling fish.");
    return;
  }

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

  persistPlayerInventoryChange(username, stagedState);

  const saleId = makeAuditId("fish_monger");
  for (const sale of sales) {
    logItemLedgerForState(socket, player, username, stagedState, sale.item_id, sale.item_category, -sale.amount, "fish_monger_sell", saleId, "fish_sold", worldName, {
      x: fishMongerGrid.x,
      y: fishMongerGrid.y,
      sell_value: sale.sell_value,
    });
  }
  logItemLedgerForState(socket, player, username, stagedState, "gem", "currency", totalGems, "fish_monger_sell", saleId, "fish_sale_reward", worldName, {
    x: fishMongerGrid.x,
    y: fishMongerGrid.y,
    total_fish: totalFish,
  });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action,
    message: action === "fish_monger_sell_all"
      ? `Sold ${totalFish} fish for ${totalGems} gems.`
      : `Sold ${sales[0].item_id} x${sales[0].amount} for ${totalGems} gems.`,
    username,
    rewards: [{ item_id: "gem", item_category: "currency", amount: totalGems }],
    player_data: stagedState,
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

function handleDropInventoryItemTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "drop items in that world")) return;

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

  const state = ensureWritablePlayerState(player.account_username);
  if (!state) {
    sendInventoryTransactionRejected(socket, data, "Could not load your server inventory.");
    return;
  }

  if (getInventoryCount(state, itemId, itemCategory) < amount) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${itemId}.`);
    return;
  }

  if (!spendItemFromState(state, itemId, itemCategory, amount)) {
    sendInventoryTransactionRejected(socket, data, "Server inventory changed. Try again.");
    return;
  }

  const payload = createServerDrop(worldName, itemId, itemCategory, amount, position.x, position.y, SERVER_DROP_PICKUP_DELAY);
  if (!payload) {
    addItemToState(state, itemId, itemCategory, amount);
    sendInventoryTransactionRejected(socket, data, "Could not create that drop.");
    return;
  }

  persistPlayerInventoryChange(player.account_username, state);
  queueWorldSave(worldName);
  sendWorldUpdateToRequesterAndWorld(socket, player, worldName, payload);

  const dropTransactionId = makeAuditId("drop");
  logWorldChange(socket, player, {
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
  });
  logItemLedgerForState(socket, player, player.account_username, state, itemId, itemCategory, -amount, "drop_inventory_item", dropTransactionId, "drop_from_inventory", worldName, {
    drop_id: payload.drop_id,
  });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "drop_inventory_item",
    message: `Dropped ${amount} ${itemId}.`,
    username: player.account_username,
    player_data: state,
  });
}

function handleTrashInventoryItemTransaction(socket, player, data) {
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

  if (!spendItemFromState(state, itemId, itemCategory, amount)) {
    sendInventoryTransactionRejected(socket, data, "Server inventory changed. Try again.");
    return;
  }

  persistPlayerInventoryChange(player.account_username, state);

  const trashTransactionId = makeAuditId("trash");
  logItemLedgerForState(socket, player, player.account_username, state, itemId, itemCategory, -amount, "trash_inventory_item", trashTransactionId, "inventory_trash", player.world, {});

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "trash_inventory_item",
    message: `Trashed ${amount} ${itemId}.`,
    username: player.account_username,
    player_data: state,
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
  return {
    x,
    y,
    seed_type: seedType,
    grow_time: SERVER_SEED_GROW_TIME_SECONDS,
    max_grow_time: SERVER_SEED_GROW_TIME_SECONDS,
    planted_at: Date.now(),
    mutated: randomChance(SEED_MUTATION_CHANCE),
  };
}

function handleSeedPlaceTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "plant seeds in that world")) return;
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
  if (!state || !spendItemFromState(state, seedType, "seed", 1)) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${seedType}.`);
    return;
  }

  persistPlayerInventoryChange(player.account_username, state);

  const update = {
    type: "world_seed_update",
    action: "place",
    x: grid.x,
    y: grid.y,
    seed_type: seedType,
    grow_time: SERVER_SEED_GROW_TIME_SECONDS,
    max_grow_time: SERVER_SEED_GROW_TIME_SECONDS,
    world: worldName,
  };

  applySeedUpdateToWorldState(worldName, update);
  queueWorldSave(worldName);
  sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);

  const seedTransactionId = makeAuditId("seed");
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
  logItemLedgerForState(socket, player, player.account_username, state, seedType, "seed", -1, "seed_place", seedTransactionId, "seed_plant_cost", worldName, {
    x: grid.x,
    y: grid.y,
  });

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "seed_place",
    message: `Planted ${seedType}.`,
    username: player.account_username,
    seed_type: seedType,
    player_data: state,
  });
}

function getBlockTypeForSeed(seedType) {
  const definition = ItemDatabase.getItemDefinition(seedType);
  if (!definition || definition.category !== "seed") return "";
  return clampString(definition.grows_into || String(seedType || "").replace(/_seed$/, ""));
}

function handleSeedSpliceTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "splice seeds in that world")) return;
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
  if (!state || !spendItemFromState(state, secondSeed, "seed", 1)) {
    sendInventoryTransactionRejected(socket, data, `Not enough ${secondSeed}.`);
    return;
  }

  persistPlayerInventoryChange(player.account_username, state);

  const update = {
    type: "world_seed_update",
    action: "splice",
    x: grid.x,
    y: grid.y,
    seed_type: resultSeed,
    previous_seed_type: seed.seed_type,
    grow_time: SERVER_SEED_GROW_TIME_SECONDS,
    max_grow_time: SERVER_SEED_GROW_TIME_SECONDS,
    world: worldName,
  };

  applySeedUpdateToWorldState(worldName, update);
  queueWorldSave(worldName);
  sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "seed_splice",
    message: `Spliced into ${resultSeed}.`,
    username: player.account_username,
    seed_type: resultSeed,
    previous_seed_type: seed.seed_type,
    player_data: state,
  });
}

function handleSeedHarvestTransaction(socket, player, data) {
  const requestId = makeRequestId(data);
  const worldName = getTransactionWorldName(player, data);
  if (!requireSameWorld(socket, player, worldName, "harvest seeds in that world")) return;
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
  if (isSeedMature(seed)) {
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
        drops.push({ item_id: blockType, item_category: "block", amount: 1, y_offset: 0 });
      }
      if (randomChance(MATURE_SEED_EXTRA_DROP_CHANCE)) {
        drops.push({ item_id: seed.seed_type, item_category: "seed", amount: 1, y_offset: -8 });
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

  applySeedUpdateToWorldState(worldName, update);
  queueWorldSave(worldName);
  sendWorldUpdateToRequesterAndWorld(socket, player, worldName, update);

  const rewards = [];
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
    sendWorldUpdateToRequesterAndWorld(socket, player, worldName, payload);
  }

  sendInventoryTransactionResult(socket, {
    ok: true,
    request_id: requestId,
    action: "seed_harvest",
    message: "Seed-tree harvested.",
    username: player.account_username,
    rewards,
    player_data: ensurePlayerState(player.account_username) || {},
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

function checkMessageRateLimit(socket, messageType) {
  const limits = MESSAGE_RATE_LIMITS[messageType] || { limit: 60, windowMs: 1000 };
  const now = Date.now();
  const bucketKey = messageType || "unknown";
  const bucket = socket.rateLimits.get(bucketKey) || {
    count: 0,
    resetAt: now + limits.windowMs,
    warnedAt: 0,
  };

  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + limits.windowMs;
    bucket.warnedAt = 0;
  }

  bucket.count += 1;
  socket.rateLimits.set(bucketKey, bucket);

  if (bucket.count <= limits.limit) {
    return true;
  }

  if (now - bucket.warnedAt > 1000 && socket.readyState === WebSocket.OPEN) {
    bucket.warnedAt = now;
    socket.send(JSON.stringify({
      type: "rate_limited",
      action: bucketKey,
      message: "Slow down a little.",
    }));
  }

  return false;
}

function sendActionRejected(socket, action, message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({
    type: "action_rejected",
    action,
    message,
  }));
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

  const allowedPlayers = Array.isArray(lock.allowed_players) ? lock.allowed_players : [];
  return allowedPlayers.some((name) => accountKey(name) === playerKey);
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

function persistPlayerInventoryChange(username, state) {
  if (!state) return null;
  state.saved_at = new Date().toISOString();
  setPlayerState(username, state);
  queuePlayerSave(username);
  return state;
}

function spendServerInventoryCost(username, cost) {
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

  if (!spendItemFromState(state, cost.item_id, cost.item_category, cost.amount)) {
    return { ok: false, message: "Server inventory changed. Try again." };
  }

  return { ok: true, state: persistPlayerInventoryChange(username, state) };
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
  const previous = blockDamage.get(key);
  const currentDamage = previous && now - previous.updatedAt <= BLOCK_DAMAGE_RESET_MS
    ? Math.max(0, Math.trunc(Number(previous.damage) || 0))
    : 0;
  const nextDamage = Math.min(requiredDamage, currentDamage + getPlayerBreakPower(player, update.block_type));

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
    };
  }

  blockDamage.delete(key);
  return {
    ok: true,
    shouldBreak: true,
    damage: requiredDamage,
    required: requiredDamage,
  };
}

function getGemDropRangeForRarity(rarity) {
  switch (String(rarity || "common")) {
    case "uncommon":
      return [2, 6];
    case "rare":
      return [5, 10];
    case "epic":
      return [10, 20];
    case "legendary":
      return [20, 35];
    case "common":
    default:
      return [0, 3];
  }
}

function createServerDrop(worldName, itemType, itemCategory, amount, x, y, pickupDelay = SERVER_DROP_PICKUP_DELAY) {
  const itemId = clampString(itemType || "");
  if (!ItemDatabase.hasItem(itemId)) return null;

  const resolvedCategory = resolveInventoryCategory(itemId, itemCategory);
  if (!ItemDatabase.canStoreItemInCategory(itemId, resolvedCategory)) return null;

  const safeAmount = clampInteger(amount || 1, 1, Math.min(MAX_DROP_AMOUNT, ItemDatabase.getStackLimit(itemId)));
  const payload = {
    type: "world_item_drop_create",
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

function getBreakDropsForBlock(blockType, layer) {
  const itemId = clampString(blockType || "");
  const definition = ItemDatabase.getItemDefinition(itemId);
  if (!definition || definition.category !== "block") return [];

  const drops = [];
  if (isVendBlockType(itemId)) {
    drops.push({ item_id: VEND_BLOCK_EMPTY, item_category: "block", amount: 1 });
  } else if (itemId === "crafting_station") {
    drops.push({ item_id: "crafting_station", item_category: "block", amount: 1 });
  } else if (itemId !== "crafting_station_left" && itemId !== "crafting_station_right" && ItemDatabase.isDropableItem(itemId)) {
    drops.push({ item_id: itemId, item_category: "block", amount: 1 });
  }

  const rules = definition.drop_rules && typeof definition.drop_rules === "object" ? definition.drop_rules : {};
  const seedId = clampString(definition.seed || "");
  const seedChance = Number.isFinite(rules.seed_chance) ? rules.seed_chance : 0.25;
  if (seedId !== "" && ItemDatabase.hasItem(seedId) && randomChance(seedChance)) {
    drops.push({ item_id: seedId, item_category: "seed", amount: 1 });
  }

  if (layer === "foreground" && ItemDatabase.hasItem("gem")) {
    const configuredRange = Array.isArray(rules.gem_range) ? rules.gem_range : getGemDropRangeForRarity(definition.rarity);
    const gemAmount = randomRangeInclusive(configuredRange[0], configuredRange[1]);
    if (gemAmount > 0) {
      drops.push({ item_id: "gem", item_category: "currency", amount: gemAmount });
    }
  }

  return drops;
}

function emitBreakDrops(worldName, update, socket = null, player = null) {
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
    if (socket && player) {
      sendWorldUpdateToRequesterAndWorld(socket, player, worldName, payload);
    } else {
      broadcastToWorld(worldName, payload);
    }
    createdDrops.push(payload);
  }
  return createdDrops;
}

function prepareVendBreakInventoryReturn(socket, player, worldName, update) {
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

  const returned = [];
  const returnedEntries = [];
  if (listing) {
    const itemId = clampString(listing.item_id || "");
    const itemCategory = resolveInventoryCategory(itemId, listing.item_category || "");
    const stock = clampInteger(listing.stock || 0, 1, ItemDatabase.getStackLimit(itemId));
    if (!canAddItemToState(state, itemId, itemCategory, stock)) {
      sendActionRejected(socket, "world_block_update", "Your inventory cannot hold the vending item.");
      return { ok: false };
    }

    addItemToState(state, itemId, itemCategory, stock);
    returned.push(`${itemId} x${stock}`);
    returnedEntries.push({ item_id: itemId, item_category: itemCategory, amount: stock, reason: "vending_stock" });
    vend.listing = null;
  }

  if (pendingWls > 0) {
    if (!canAddItemToState(state, "world_lock", "block", pendingWls)) {
      sendActionRejected(socket, "world_block_update", "Your inventory cannot hold those World Locks.");
      return { ok: false };
    }

    addItemToState(state, "world_lock", "block", pendingWls);
    returned.push(`World Lock x${pendingWls}`);
    returnedEntries.push({ item_id: "world_lock", item_category: "block", amount: pendingWls, reason: "vending_pending_wls" });
    vend.pending_wls = 0;
  }

  persistPlayerInventoryChange(player.account_username, state);
  setVendStateAt(worldName, vend);
  const vendBreakTransactionId = makeAuditId("vend_break");
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
    logItemLedgerForState(socket, player, player.account_username, state, entry.item_id, entry.item_category, entry.amount, "vending_break_return", vendBreakTransactionId, entry.reason, worldName, {
      x: vend.x,
      y: vend.y,
    });
  }

  return {
    ok: true,
    playerState: state,
    message: returned.length > 0 ? `Returned ${returned.join(", ")}.` : "",
  };
}

function validateBlockUpdateAgainstServerState(socket, player, worldName, update) {
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

    if (update.block_type === "world_lock" && hasWorldLockProtectedStorageBlocks(worldName)) {
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
    if (!damageResult.shouldBreak) {
      if (update.action === "break") {
        sendActionRejected(socket, "world_block_update", `Keep breaking that block (${damageResult.damage}/${damageResult.required}).`);
        return { ok: false };
      }
      return { ok: true, pendingHit: true };
    }

    update.action = "break";

    if (isVendBreak) {
      const vendReturn = prepareVendBreakInventoryReturn(socket, player, worldName, update);
      if (!vendReturn.ok) return { ok: false };
      return {
        ok: true,
        playerState: vendReturn.playerState || null,
        message: vendReturn.message || "",
      };
    }

    if (isSafeBreak) {
      const safeReturn = prepareSafeBreakInventoryReturn(socket, player, worldName, update);
      if (!safeReturn.ok) return { ok: false };
      return {
        ok: true,
        playerState: safeReturn.playerState || null,
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

  if (update.block_type === "world_lock" && (state.world_lock?.is_locked || hasWorldLockBlock(worldName))) {
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
  const spendResult = spendServerInventoryCost(player.account_username, cost);
  if (!spendResult.ok) {
    sendActionRejected(socket, "world_block_update", spendResult.message);
    return { ok: false };
  }

  return {
    ok: true,
    playerState: spendResult.state,
  };
}

function validateSeedUpdateAgainstServerState(socket, player, worldName, update) {
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

  const spendResult = spendServerInventoryCost(player.account_username, {
    item_id: update.seed_type,
    item_category: "seed",
    amount: 1,
  });
  if (!spendResult.ok) {
    sendActionRejected(socket, "world_seed_update", spendResult.message);
    return { ok: false };
  }

  return {
    ok: true,
    playerState: spendResult.state,
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
    if (!lockBlock || lockBlock.block_type !== "world_lock") {
      sendActionRejected(socket, "world_lock_state", "Place a world lock block first.");
      return false;
    }

    if (!isAdmin(player)) {
      nextLock.owner_name = cleanName(player.account_username).toUpperCase();
    }
  }

  update.state = nextLock;
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
  };
}

function sanitizePlayerAnimationState(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (["idle", "walk", "jump"].includes(clean)) return clean;
  return "idle";
}

function acceptPlayerMovement(socket, player, position) {
  const now = Date.now();
  const lastAt = Number(player.last_position_at || 0);

  if (!lastAt || (isAdmin(player) && player.noclip_enabled)) {
    player.last_position_at = now;
    return true;
  }

  const elapsedSeconds = Math.max((now - lastAt) / 1000, 0.016);
  const maxDistance = MAX_MOVE_PIXELS_PER_SECOND * elapsedSeconds + TILE_SIZE * 2;
  const distance = Math.hypot(position.x - player.x, position.y - player.y);

  if (distance > maxDistance) {
    sendActionRejected(socket, "player_position", "Movement was too fast.");
    return false;
  }

  player.last_position_at = now;
  return true;
}

function getSocketAddress(socket) {
  return String(socket?._socket?.remoteAddress || socket?.remoteAddress || "").replace(/^::ffff:/, "");
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
  appendJsonLine(SECURITY_EVENT_LOG_PATH, {
    event_id: makeAuditId("security"),
    at: new Date().toISOString(),
    severity: String(severity || "info"),
    event: String(event || "security_event"),
    ...getAuditActor(socket, player),
    details,
  }, "security event");
}

function logGemLedger(socket, player, entry = {}) {
  const actor = getAuditActor(socket, player);
  const username = cleanAccountName(entry.account_username || actor.actor_username);
  appendJsonLine(GEM_LEDGER_PATH, {
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
  }, "gem ledger");
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
  if (itemId === "gem") {
    logGemLedger(socket, player, { ...ledgerEntry, ledger_id: makeAuditId("gem") });
  }
}

function logItemLedgerForState(socket, actorPlayer, accountUsername, state, itemId, itemCategory, quantityDelta, sourceType, sourceId, reason, world = "", details = {}) {
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
  });
}

function logRewardLedgers(socket, actorPlayer, accountUsername, state, rewards, sourceType, sourceId, reason, world = "", details = {}) {
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
      details
    );
  }
}

function logShopPurchase(socket, player, entry = {}) {
  appendJsonLine(SHOP_PURCHASE_LOG_PATH, {
    purchase_id: entry.purchase_id || makeAuditId("shop"),
    at: new Date().toISOString(),
    ...getAuditActor(socket, player),
    account_username: cleanAccountName(entry.account_username || player?.account_username || ""),
    listing_id: clampString(entry.listing_id || ""),
    item_id: clampString(entry.item_id || ""),
    price_gems: Math.max(0, Math.trunc(Number(entry.price_gems) || 0)),
    rewards: Array.isArray(entry.rewards) ? entry.rewards : [],
    gem_balance_after: Math.max(0, Math.trunc(Number(entry.gem_balance_after) || 0)),
  }, "shop purchase");
}

function logTradeTransaction(entry = {}) {
  appendJsonLine(TRADE_TRANSACTION_LOG_PATH, {
    transaction_id: entry.transaction_id || makeAuditId("trade"),
    at: new Date().toISOString(),
    trade_id: String(entry.trade_id || ""),
    status: String(entry.status || "completed"),
    requester_username: cleanAccountName(entry.requester_username || ""),
    target_username: cleanAccountName(entry.target_username || ""),
    requester_offer: Array.isArray(entry.requester_offer) ? entry.requester_offer : [],
    target_offer: Array.isArray(entry.target_offer) ? entry.target_offer : [],
    details: entry.details || {},
  }, "trade transaction");
}

function logVendingTransaction(socket, player, entry = {}) {
  appendJsonLine(VENDING_TRANSACTION_LOG_PATH, {
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
  }, "vending transaction");
}

function logWorldChange(socket, player, entry = {}) {
  appendJsonLine(WORLD_CHANGE_JOURNAL_PATH, {
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
    details: entry.details || {},
  }, "world change");
}

function createWorldSnapshot(worldName, reason, socket = null, player = null, details = {}) {
  try {
    const clean = cleanWorld(worldName);
    const snapshotId = makeAuditId("snapshot");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshotDir = path.join(WORLD_SNAPSHOT_FOLDER, safeFileName(clean, "START"));
    const snapshotPath = path.join(snapshotDir, `${stamp}_${safeFileName(reason, "snapshot")}.json`);
    fs.mkdirSync(snapshotDir, { recursive: true });

    writeJsonFileAtomic(snapshotPath, {
      snapshot_id: snapshotId,
      created_at: new Date().toISOString(),
      reason: String(reason || "snapshot"),
      actor: getAuditActor(socket, player),
      details,
      world_state: serializeWorldState(clean),
    });

    logWorldChange(socket, player, {
      journal_id: snapshotId,
      source_type: "world_snapshot",
      source_id: snapshotId,
      world: clean,
      action: "snapshot",
      details: { reason, snapshot_path: snapshotPath, ...details },
    });
    return { snapshotId, snapshotPath };
  } catch (error) {
    console.warn("Could not create world snapshot:", error.message);
    return null;
  }
}

function logAdminAction(socket, player, action, details = {}, ok = true, message = "") {
  const username = cleanAccountName(player?.account_username || player?.name || "");
  const entry = {
    at: new Date().toISOString(),
    admin_username: username,
    admin_role: getAccountRole(username),
    player_id: String(player?.id || ""),
    ip: getSocketAddress(socket),
    action: String(action || "admin_action"),
    ok: Boolean(ok),
    message: String(message || ""),
    ...details,
  };

  appendJsonLine(ADMIN_LOG_PATH, entry, "admin action");
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

function parseTargetedGiveCommand(command) {
  const parts = splitCommand(command);
  if (parts.length < 4) return null;
  if (String(parts[0] || "").toLowerCase() !== "give") return null;

  const targetUsername = cleanAccountName(parts[1]);
  const itemId = clampString(parts[2] || "");
  const amount = clampInteger(parts[3] || 1, 1, MAX_ITEM_STACK);
  if (targetUsername === "" || itemId === "") return null;

  return { targetUsername, itemId, amount };
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
  if (commandName !== "clear" && commandName !== "resetworld" && commandName !== "reset_world" && commandName !== "reworld") {
    return "";
  }

  return cleanWorld(parts.slice(1).join("_"));
}

function getDeveloperCommandWorldName(player, data) {
  return cleanWorld(data.target_world || getDeveloperCommandWorldArgument(data.command || "") || data.world_name || data.world || player?.world || "START");
}

function isClearProtectedBlockType(blockType) {
  const clean = clampString(blockType || "");
  return clean === "world_lock" || clean === ENTRANCE_GATE_TYPE || clean === "bedrock";
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

    if (entry.block_type === "world_lock") {
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
    putProtectedEntry(protectedEntries, { x: lockGridX, y: lockGridY, block_type: "world_lock" });
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
  const nextState = createEmptyWorldState();
  nextState.cleared = true;

  const protectedEntries = getProtectedClearEntries(currentState, data);
  const removedCount =
    Math.max(0, currentState.foreground.size - protectedEntries.size) +
    currentState.background.size +
    currentState.seeds.size +
    currentState.drops.size;

  createWorldSnapshot(clean, "before_clear_world", socket, player, {
    removed_count: removedCount,
    protected_count: protectedEntries.size,
  });

  addBedrockFloorEntries(nextState.foreground);

  for (const [key, entry] of protectedEntries.entries()) {
    nextState.foreground.set(key, { ...entry });
  }

  nextState.world_lock = sanitizeWorldLockState(currentState.world_lock || {});

  replaceWorldStateAndBroadcast(clean, nextState, { respawn_player: true });
  return { removedCount, protectedCount: protectedEntries.size };
}

function resetWorldByAdmin(worldName, socket = null, player = null) {
  const clean = cleanWorld(worldName);
  createWorldSnapshot(clean, "before_reset_world", socket, player);
  replaceWorldStateAndBroadcast(clean, createEmptyWorldState(), { respawn_player: true });
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
      amount: clampInteger(data.amount || 1, 1, MAX_ITEM_STACK),
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
      amount: clampInteger(data.amount || 1, 1, MAX_ITEM_STACK),
    };
  }

  if (parts.length < 4) return null;

  return {
    targetUsername: cleanAccountName(parts[1]),
    itemId: clampString(parts[2]),
    itemCategory: resolveInventoryCategory(parts[2]),
    amount: clampInteger(parts[3] || 1, 1, MAX_ITEM_STACK),
  };
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

function getInventoryFieldForCategory(category, itemId) {
  return ItemDatabase.getInventoryFieldForItem(itemId, category) || "inventory";
}

function createDefaultPlayerState(username) {
  const state = sanitizePlayerState({
    account_username: username,
    inventory: {},
    seed_inventory: {},
    tool_inventory: { pickaxe: 1 },
    back_inventory: {},
    shirt_inventory: {},
    pants_inventory: {},
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
  merged.equipped_shirt_item = doesStateOwnEquippedItem(merged, incomingState.equipped_shirt_item || "", "shirt")
    ? clampString(incomingState.equipped_shirt_item || "")
    : "";
  merged.equipped_pants_item = doesStateOwnEquippedItem(merged, incomingState.equipped_pants_item || "", "pants")
    ? clampString(incomingState.equipped_pants_item || "")
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
    merged.equipped_shirt_item = doesStateOwnEquippedItem(merged, incomingState.equipped_shirt_item || "", "shirt")
      ? clampString(incomingState.equipped_shirt_item || "")
      : merged.equipped_shirt_item;
    merged.equipped_pants_item = doesStateOwnEquippedItem(merged, incomingState.equipped_pants_item || "", "pants")
      ? clampString(incomingState.equipped_pants_item || "")
      : merged.equipped_pants_item;
  }

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
  state[inventoryField][cleanItemId] = clampInteger(currentCount + amount, 0, stackLimit);

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

function doesAccountExist(username) {
  const clean = cleanAccountName(username);
  if (clean === "") return false;
  return accounts.has(accountKey(clean)) || fs.existsSync(getPlayerSavePath(clean));
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
    logAdminAction(socket, player, "developer_pin_unlock", { request_id: requestId, pin_required: false }, true, "Developer PIN not required.");
    sendJson(socket, {
      type: "developer_pin_unlock_result",
      ok: true,
      request_id: requestId,
      message: "Developer PIN is not required on this server.",
      developer_pin_required: false,
      developer_pin_unlocked: true,
    });
    return;
  }

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
  logAdminAction(socket, player, "developer_pin_unlock", { request_id: requestId }, true, "Developer PIN unlocked.");
  sendJson(socket, {
    type: "developer_pin_unlock_result",
    ok: true,
    request_id: requestId,
    message: "Developer panel unlocked.",
    developer_pin_required: true,
    developer_pin_unlocked: true,
    unlocked_until: new Date(player.developer_pin_unlocked_until).toISOString(),
  });
}

function handleDeveloperCommandRequest(socket, player, data) {
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

  if (!isDeveloperPinUnlocked(player)) {
    deny("Developer PIN required.", { reason: "developer_pin_required" }, { requires_developer_pin: true });
    return;
  }

  if (commandName === "clear") {
    const commandWorld = getDeveloperCommandWorldName(player, data);
    const result = clearWorldByAdmin(commandWorld, data, socket, player);
    approve(
      `Server cleared ${commandWorld}. Removed ${result.removedCount} saved objects and preserved ${result.protectedCount} protected blocks.`,
      { target_world: commandWorld, removed_count: result.removedCount, protected_count: result.protectedCount },
      { command_type: "clear_world", target_world: commandWorld, removed_count: result.removedCount, protected_count: result.protectedCount }
    );
    return;
  }

  if (commandName === "resetworld" || commandName === "reset_world" || commandName === "reworld") {
    const commandWorld = getDeveloperCommandWorldName(player, data);
    resetWorldByAdmin(commandWorld, socket, player);
    approve(`Server reset ${commandWorld}.`, { target_world: commandWorld }, { command_type: "reset_world", target_world: commandWorld });
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

    const grant = grantItemToPlayerState(
      giveCommand.targetUsername,
      giveCommand.itemId,
      giveCommand.itemCategory,
      giveCommand.amount
    );
    if (!grant) {
      deny("Could not save target inventory.", { target_username: giveCommand.targetUsername, item_id: giveCommand.itemId, item_category: giveCommand.itemCategory, amount: giveCommand.amount });
      return;
    }

    const target = findOnlinePlayerByUsername(giveCommand.targetUsername);
    const targetState = ensurePlayerState(giveCommand.targetUsername) || {};
    if (target) {
      sendPlayerState(target.socket, target.player.account_username);
    }

    if (target && accountKey(target.player.account_username) !== accountKey(player.account_username)) {
      target.socket.send(JSON.stringify({
        type: "item_grant",
        username: target.player.account_username,
        target_username: target.player.account_username,
        item_id: giveCommand.itemId,
        item_type: giveCommand.itemId,
        item_category: giveCommand.itemCategory,
        amount: giveCommand.amount,
        granted_by: player.account_username,
        player_data: targetState,
      }));
    }

    logItemLedger(socket, player, {
      account_username: cleanAccountName(giveCommand.targetUsername),
      item_id: giveCommand.itemId,
      item_category: giveCommand.itemCategory,
      quantity_delta: giveCommand.amount,
      balance_after: grant.count,
      source_type: "admin_give",
      source_id: requestId,
      reason: "developer_command",
      world: player.world,
      details: { command, delivery: target ? "online" : "offline_saved" },
    });

    approve(
      accountKey(giveCommand.targetUsername) === accountKey(player.account_username)
        ? "Item delivered by server."
        : (target ? "Item delivered to online player." : "Item saved to offline account."),
      {
        target_username: cleanAccountName(giveCommand.targetUsername),
        item_id: giveCommand.itemId,
        item_category: giveCommand.itemCategory,
        amount: giveCommand.amount,
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
        count: grant.count,
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

    const removal = removeItemFromPlayerState(
      removeCommand.targetUsername,
      removeCommand.itemId,
      removeCommand.itemCategory,
      removeCommand.amount
    );
    if (!removal) {
      deny("Could not save target inventory.", { target_username: removeCommand.targetUsername, item_id: removeCommand.itemId, item_category: removeCommand.itemCategory, amount: removeCommand.amount });
      return;
    }

    if (removal.removed <= 0) {
      deny("Target does not have that item.", { target_username: removeCommand.targetUsername, item_id: removeCommand.itemId, item_category: removeCommand.itemCategory, requested: removal.requested, removed: removal.removed });
      return;
    }

    const target = findOnlinePlayerByUsername(removeCommand.targetUsername);
    if (target) {
      sendPlayerState(target.socket, target.player.account_username);
      if (accountKey(target.player.account_username) !== accountKey(player.account_username)) {
        target.socket.send(JSON.stringify({
          type: "chat",
          sender: "System",
          message: `${player.account_username} removed ${removal.removed} ${removeCommand.itemId} from your inventory.`,
        }));
      }
    }

    const partialMessage = removal.removed < removal.requested
      ? ` Removed ${removal.removed}/${removal.requested} because that was all the target had.`
      : ` Removed ${removal.removed}.`;

    logItemLedger(socket, player, {
      account_username: cleanAccountName(removeCommand.targetUsername),
      item_id: removeCommand.itemId,
      item_category: removal.itemCategory,
      quantity_delta: -removal.removed,
      balance_after: removal.count,
      source_type: "admin_remove",
      source_id: requestId,
      reason: "developer_command",
      world: player.world,
      details: { command, requested: removal.requested, delivery: target ? "online" : "offline_saved" },
    });

    approve(
      target ? `Server updated ${cleanAccountName(removeCommand.targetUsername)}.${partialMessage}` : `Server updated offline account.${partialMessage}`,
      {
        target_username: cleanAccountName(removeCommand.targetUsername),
        item_id: removeCommand.itemId,
        item_category: removal.itemCategory,
        requested: removal.requested,
        removed: removal.removed,
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

    state.player_health = requestedHealth;
    persistPlayerInventoryChange(targetUsername, state);

    const target = findOnlinePlayerByUsername(targetUsername);
    if (target) {
      sendPlayerState(target.socket, target.player.account_username);
    }

    approve(
      target ? `Health set to ${requestedHealth}.` : `Health saved for offline account.`,
      { target_username: targetUsername, amount: requestedHealth, delivery: target ? "online" : "offline_saved" },
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

    const pos = getGridCenterPixels(gridX, gridY);
    player.x = pos.x;
    player.y = pos.y;
    player.last_position_at = Date.now();

    broadcastToWorld(player.world, {
      type: "player_position",
      player_id: player.id,
      name: player.name,
      role: getPublicPlayerRole(player),
      x: player.x,
      y: player.y,
      facing: player.facing,
      world: player.world,
      animation_state: player.animation_state || "idle",
      equipment_slots: player.equipment_slots || {},
    }, player.id);

    approve(
      `Teleported to ${gridX}, ${gridY}.`,
      { target_username: player.account_username, grid_x: gridX, grid_y: gridY, x: player.x, y: player.y },
      { command_type: "teleport", grid_x: gridX, grid_y: gridY, x: player.x, y: player.y }
    );
    return;
  }

  if (commandName === "noc" || commandName === "noclip") {
    player.noclip_enabled = data.enabled === undefined ? !player.noclip_enabled : Boolean(data.enabled);
    approve(
      player.noclip_enabled ? "Noclip enabled by server." : "Noclip disabled by server.",
      { target_username: player.account_username, noclip_enabled: player.noclip_enabled },
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
      { target_world: commandWorld, removed_count: removedCount },
      { command_type: "clear_drops", target_world: commandWorld, removed_count: removedCount }
    );
    return;
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
    broadcastToWorld(commandWorld, buildWorldStateMessage(commandWorld, { respawn_player: true }));
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
      { target_world: commandWorld, item_id: itemId, grid_x: gridX, grid_y: gridY },
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
  };
}

function loadWorldState(worldName) {
  const state = createEmptyWorldState();
  const data = readJsonFile(getWorldSavePath(worldName));

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

  repairEntranceGateState(state);
  return state;
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

  if (Object.prototype.hasOwnProperty.call(rawEntry, "door_open")) {
    entry.door_open = Boolean(rawEntry.door_open);
  }

  if (Object.prototype.hasOwnProperty.call(rawEntry, "sign_text")) {
    entry.sign_text = String(rawEntry.sign_text || "").slice(0, MAX_SIGN_TEXT_LENGTH);
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

  const maxGrowTime = Math.max(1, Math.min(86400, Number(rawEntry.max_grow_time) || SERVER_SEED_GROW_TIME_SECONDS));
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

    if (action === "door_state") {
      target.set(gridKey(gridX, gridY), {
        action,
        x: gridX,
        y: gridY,
        open: Boolean(rawEntry.open),
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
      amount: clampInteger(rawEntry.amount || 1, 1, Math.min(MAX_DROP_AMOUNT, ItemDatabase.getStackLimit(itemType))),
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

  const maxGrowTime = SERVER_SEED_GROW_TIME_SECONDS;

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
    if (update.block_type !== "wooden_door" && update.block_type !== "sign") {
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

    if (update.block_type === "world_lock" && isActiveWorldLockGrid(state, update.x, update.y)) {
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
    update.grow_time = SERVER_SEED_GROW_TIME_SECONDS;
    update.max_grow_time = SERVER_SEED_GROW_TIME_SECONDS;
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
    clean === "world_lock" ||
    clean === SAFE_BLOCK_TYPE ||
    clean === FISH_MONGER_BLOCK_TYPE ||
    isVendBlockType(clean) ||
    clean === "crafting_station" ||
    clean === "furnace" ||
    clean === "wooden_door" ||
    clean === "sign"
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

function handleEntranceGateMoveUpdate(socket, player, worldName, update) {
  const validation = validateEntranceGateMove(socket, player, worldName, update);
  if (!validation.ok) return false;

  const moveTransactionId = makeAuditId("gate_move");
  const spendResult = spendServerInventoryCost(player.account_username, {
    item_id: "entrance_mover",
    item_category: "tool",
    amount: 1,
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
  });
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
    sendWorldUpdateToRequesterAndWorld(socket, player, worldName, blockUpdate);
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

  if (action === "door_state") {
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
      open: Boolean(data.open),
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
  const lockGridX = Math.trunc(Number(rawState.lock_grid_x) || 999999);
  const lockGridY = Math.trunc(Number(rawState.lock_grid_y) || 999999);

  return {
    is_locked: isLocked,
    owner_name: cleanAccountName(rawState.owner_name || "").toUpperCase(),
    lock_grid_x: lockGridX,
    lock_grid_y: lockGridY,
    allowed_players: allowedPlayers
      .map((name) => cleanAccountName(name).toUpperCase())
      .filter((name, index, list) => name.length > 0 && list.indexOf(name) === index)
      .slice(0, 100),
    public_build: Boolean(rawState.public_build),
  };
}

function interactionKey(update) {
  return gridKey(update.x, update.y);
}

function applyInteractionUpdateToWorldState(worldName, update) {
  const state = ensureWorldState(worldName);

  if (update.action === "door_state") {
    state.interactions.set(interactionKey(update), {
      action: update.action,
      x: update.x,
      y: update.y,
      open: update.open,
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
  const dropId = clampString(data.drop_id || "", MAX_DROP_ID_LENGTH);
  if (dropId.length === 0) return null;

  const itemType = clampString(data.item_type || data.type_id || data.item || "");
  if (itemType.length === 0) return null;
  if (!ItemDatabase.hasItem(itemType)) return null;
  if (!ItemDatabase.isDropableItem(itemType)) return null;

  const x = Number(data.x);
  const y = Number(data.y);
  if (!isPositionInWorldBounds(x, y)) return null;

  const itemCategory = resolveInventoryCategory(itemType, data.item_category || "");
  if (!ItemDatabase.canStoreItemInCategory(itemType, itemCategory)) return null;

  return {
    type: "world_item_drop_create",
    world: cleanWorld(worldName),
    drop_id: dropId,
    item_type: itemType,
    item_category: itemCategory,
    is_seed: itemCategory === "seed",
    amount: clampInteger(data.amount || 1, 1, Math.min(MAX_DROP_AMOUNT, ItemDatabase.getStackLimit(itemType))),
    x,
    y,
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
    update.amount = clampInteger(data.amount || 0, 0, MAX_DROP_AMOUNT);
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

  return {
    type: "world_item_drop_pickup",
    world: cleanWorld(worldName),
    drop_id: dropId,
    player_id: player.id,
    name: cleanName(player.name),
  };
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

function applyDropPickupToWorldState(worldName, update, player) {
  const state = ensureWorldState(worldName);
  const drop = state.drops.get(update.drop_id);
  if (!drop) return false;
  if (!isPlayerNearDrop(player, drop)) return false;

  state.drops.delete(update.drop_id);
  return drop;
}

function isPlayerNearDrop(player, drop) {
  if (!player || !drop) return false;
  if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) return false;
  if (!Number.isFinite(drop.x) || !Number.isFinite(drop.y)) return false;

  return Math.hypot(player.x - drop.x, player.y - drop.y) <= MAX_PICKUP_DISTANCE_PIXELS;
}

function getForegroundBlocksForState(state) {
  const blocks = [];

  for (const block of state.foreground.values()) {
    const entry = { ...block };
    const interaction = state.interactions.get(gridKey(block.x, block.y));

    if (interaction && interaction.action === "door_state") {
      entry.door_open = Boolean(interaction.open);
    } else if (interaction && interaction.action === "sign_text") {
      entry.sign_text = String(interaction.text || "");
    }

    blocks.push(entry);
  }

  return blocks;
}

function serializeWorldState(worldName) {
  const state = ensureWorldState(worldName);

  return {
    world_state_version: 1,
    world_name: cleanWorld(worldName),
    saved_at: new Date().toISOString(),
    cleared: Boolean(state.cleared),
    blocks: getForegroundBlocksForState(state),
    background_blocks: Array.from(state.background.values()),
    removed_foreground: state.cleared ? [] : Array.from(state.removed_foreground.values()),
    removed_background: state.cleared ? [] : Array.from(state.removed_background.values()),
    seeds: Array.from(state.seeds.values()).map(serializeSeedForMessage),
    interactions: Array.from(state.interactions.values()),
    world_lock: state.world_lock || {},
    drops: Array.from(state.drops.values()),
  };
}

function buildWorldStateMessage(worldName, extraMessageData = {}) {
  const state = ensureWorldState(worldName);
  return {
    type: "world_state",
    world: cleanWorld(worldName),
    cleared: Boolean(state.cleared),
    foreground: getForegroundBlocksForState(state),
    background: Array.from(state.background.values()),
    removed_foreground: state.cleared ? [] : Array.from(state.removed_foreground.values()),
    removed_background: state.cleared ? [] : Array.from(state.removed_background.values()),
    seeds: Array.from(state.seeds.values()).map(serializeSeedForMessage),
    interactions: Array.from(state.interactions.values()),
    world_lock: state.world_lock || {},
    drops: Array.from(state.drops.values()),
    ...extraMessageData,
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
  writeJsonFileAtomic(getWorldSavePath(clean), serializeWorldState(clean));
}

function loadAccounts() {
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
    session_token_hash: String(rawAccount.session_token_hash || ""),
    session_token_expires_at: String(rawAccount.session_token_expires_at || ""),
    email_verified: hasEmailVerifiedField ? Boolean(rawAccount.email_verified) : passwordHash !== "",
    email_verified_at: String(rawAccount.email_verified_at || ""),
    email_verification_token_hash: String(rawAccount.email_verification_token_hash || ""),
    email_verification_expires_at: String(rawAccount.email_verification_expires_at || ""),
    role: String(rawAccount.role || getAccountRole(username)),
    created_at: String(rawAccount.created_at || new Date().toISOString()),
    last_seen_at: String(rawAccount.last_seen_at || ""),
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
    session_token_hash: existing.session_token_hash || incoming.session_token_hash || "",
    session_token_expires_at: existing.session_token_expires_at || incoming.session_token_expires_at || "",
    email_verified: Object.prototype.hasOwnProperty.call(existing, "email_verified") ? Boolean(existing.email_verified) : Boolean(incoming.email_verified),
    email_verified_at: existing.email_verified_at || incoming.email_verified_at || "",
    email_verification_token_hash: existing.email_verification_token_hash || incoming.email_verification_token_hash || "",
    email_verification_expires_at: existing.email_verification_expires_at || incoming.email_verification_expires_at || "",
    role: existing.role || incoming.role || getAccountRole(incoming.username),
    created_at: existing.created_at || incoming.created_at || new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  };

  accounts.set(key, account);
  queueAccountsSave();
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
  writeJsonFileAtomic(ACCOUNTS_SAVE_PATH, {
    account_state_version: 1,
    saved_at: new Date().toISOString(),
    accounts: Array.from(accounts.values()),
  });
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

  const state = {
    player_data_version: Math.max(1, Math.trunc(Number(rawState.player_data_version) || 1)),
    account_username: accountUsername,
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
    shirt_inventory: sanitizeCountDictionary(rawState.shirt_inventory, MAX_PLAYER_INVENTORY_KEYS, "shirt"),
    pants_inventory: sanitizeCountDictionary(rawState.pants_inventory, MAX_PLAYER_INVENTORY_KEYS, "pants"),
    currency_inventory: sanitizeCountDictionary(rawState.currency_inventory, MAX_PLAYER_INVENTORY_KEYS, "currency"),
    material_inventory: sanitizeCountDictionary(rawState.material_inventory, MAX_PLAYER_INVENTORY_KEYS, "material"),
    lure_inventory: sanitizeCountDictionary(rawState.lure_inventory, MAX_PLAYER_INVENTORY_KEYS, "lure"),
    fish_inventory: sanitizeCountDictionary(rawState.fish_inventory, MAX_PLAYER_INVENTORY_KEYS, "fish"),
    equipped_tool: "",
    equipped_back_item: "",
    equipped_shirt_item: "",
    equipped_pants_item: "",
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

  const equippedShirt = clampString(rawState.equipped_shirt_item || "");
  if (doesStateOwnEquippedItem(state, equippedShirt, "shirt")) {
    state.equipped_shirt_item = equippedShirt;
  }

  const equippedPants = clampString(rawState.equipped_pants_item || "");
  if (doesStateOwnEquippedItem(state, equippedPants, "pants")) {
    state.equipped_pants_item = equippedPants;
  }

  return state;
}

function ensurePlayerState(username) {
  const clean = cleanAccountName(username);
  if (clean === "") return null;

  const key = accountKey(clean);
  if (playerStates.has(key)) {
    return playerStates.get(key);
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

  writeJsonFileAtomic(getPlayerSavePath(clean), {
    player_state_version: 1,
    username: clean,
    saved_at: new Date().toISOString(),
    player_data: state,
  });
}

function sanitizeEquipmentSlots(rawSlots, username = "") {
  const safe = {};
  const state = username !== "" ? ensurePlayerState(username) : null;
  const allowedSlots = [
    "hand", "back", "head", "hat", "eyes", "face",
    "shirt", "pants", "legs", "feet", "shoes",
    "neck", "aura"
  ];

  for (const slot of allowedSlots) {
    if (!Object.prototype.hasOwnProperty.call(rawSlots, slot)) continue;

    const value = clampString(rawSlots[slot] || "");
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
    if (player.world !== worldName) continue;

    result.push({
      player_id: player.id,
      name: player.name,
      role: getPublicPlayerRole(player),
      x: player.x,
      y: player.y,
      facing: player.facing,
      world: player.world,
      animation_state: player.animation_state || "idle",
      equipment_slots: player.equipment_slots || {},
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

function broadcastToWorld(worldName, message, excludePlayerId = "") {
  const raw = JSON.stringify(message);

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client.playerId === excludePlayerId) continue;

    const player = players.get(client.playerId);
    if (!player) continue;
    if (player.world !== worldName) continue;

    client.send(raw);
  }
}

function broadcastToAuthenticatedPlayers(message, excludePlayerId = "") {
  const raw = JSON.stringify(message);

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client.playerId === excludePlayerId) continue;

    const player = players.get(client.playerId);
    if (!player || !player.authenticated) continue;

    client.send(raw);
  }
}

function flushPendingSaves() {
  for (const [worldName, timer] of worldSaveTimers.entries()) {
    clearTimeout(timer);
    saveWorldState(worldName);
  }
  worldSaveTimers.clear();

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

process.on("SIGINT", () => {
  flushPendingSaves();
  process.exit(0);
});

process.on("SIGTERM", () => {
  flushPendingSaves();
  process.exit(0);
});

process.on("exit", () => {
  flushPendingSaves();
});
