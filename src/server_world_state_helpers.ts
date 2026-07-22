"use strict";

type JsonRecord = Record<string, any>;
type ClampIntegerFunction = (value: unknown, min: number, max: number) => number;
type ClampStringFunction = (value: unknown, limit?: number) => string;
type GridPredicate = (x: number, y: number) => boolean;
type NormalizeEntryFunction = (rawEntry: unknown) => JsonRecord | null;

interface GridPosition {
  x: number;
  y: number;
}

interface WorldStateHelperConfig {
  itemDatabase: JsonRecord;
  itemAtlasDb: JsonRecord;
  dropContracts: JsonRecord;
  packetContracts: JsonRecord;
  cleanWorld: (value: unknown) => string;
  cleanName: (value: unknown) => string;
  cleanAccountName: (value: unknown) => string;
  clampString: ClampStringFunction;
  clampInteger: ClampIntegerFunction;
  cleanDoorId: (value: unknown) => string;
  cleanDoorName: (value: unknown) => string;
  cleanDoorPassword: (value: unknown) => string;
  cleanDoorDestination: (value: unknown) => string;
  parseDoorDestination: (value: unknown, sourceWorld?: unknown) => JsonRecord;
  isDoorBlockType: (blockType: unknown) => boolean;
  isPasswordDoorBlockType: (blockType: unknown) => boolean;
  isDisplayBlockType: (blockType: unknown) => boolean;
  isGridInWorld: GridPredicate;
  isPositionInWorldBounds: (x: number, y: number) => boolean;
  getSeedConfiguredGrowTime: (seedType: unknown) => number;
  getTransactionGrid: (data: JsonRecord, xKey?: string, yKey?: string) => GridPosition | null;
  getTransactionDropGrid: (data: JsonRecord, position?: GridPosition | null) => GridPosition | null;
  getDropGridFromPosition: (position: unknown) => GridPosition | null;
  makeServerDropId: (worldName: unknown, itemType: unknown) => string;
  sanitizeOptionalDropPickupPosition: (data: JsonRecord, player: JsonRecord, worldName: unknown) => unknown;
  resolveDropPickupWorldName: (worldName: unknown, update?: JsonRecord) => string;
  ensureWorldState: (worldName: unknown) => JsonRecord;
  makeAuditId: (prefix?: string) => string;
  makeEmptyElectricalNetworkCache: () => JsonRecord;
  makeEmptyCctvWorldState: (worldName: unknown) => JsonRecord;
  sanitizeWorldLockState: (state: unknown) => JsonRecord;
  sanitizeAreaLockState: (state: unknown) => JsonRecord;
  getForegroundBlocksForState: (state: JsonRecord, worldName?: unknown) => unknown[];
  serializeSeedForMessage: (seed: unknown) => unknown;
  getElectricalLayerForSave: (state: JsonRecord) => unknown[];
  getElectricalDevicesForSave: (state: JsonRecord) => unknown[];
  rebuildElectricalNetworksForState: (state: JsonRecord) => unknown;
  repairEntranceGateState: (state: JsonRecord, worldName?: unknown) => unknown;
  getActiveWorldBackgroundTheme: (state: JsonRecord) => string;
  getEffectiveWorldLockStateInState: (state: JsonRecord) => JsonRecord;
  sanitizeAreaLocksList: (locks: unknown) => unknown[];
  sanitizeCctvWorldState: (state: unknown, worldName?: unknown) => JsonRecord;
  buildActiveWorldEventSnapshot: (state: JsonRecord) => JsonRecord;
  worldBackgroundThemes: ReadonlySet<string>;
  worldWidth: number;
  worldHeight: number;
  bedrockStartY: number;
  legacyWorldGenerationVersion: number;
  currentWorldGenerationVersion: number;
  snowStormEventType: string;
  snowStormEventDurationMs: number;
  maxSignTextLength: number;
  maxMailboxMessageLength: number;
  maxBulletinBoardMessageLength: number;
  vendLogLimit: number;
  safeSlotCount: number;
  mailboxMessageLimit: number;
  bulletinBoardMessageLimit: number;
  tackleBoxCooldownMs: number;
  chickenProductionMs: number;
  chickenHungerMs: number;
  cowProductionMs: number;
  cowHungerMs: number;
  duckProductionMs: number;
  duckHungerMs: number;
  maxDropTileAmount: number;
  maxDropIdLength: number;
  maxBulkDropPickupIds: number;
  maxElectricalPadsPerGenerator: number;
  maxElectricalPolesPerGenerator: number;
  maxPoleLinksPerPole: number;
  electricalWireItem: string;
  electricalMetalPadItem: string;
  electricalGeneratorItem: string;
  electricalPoleItem: string;
  electricalDeviceWire: string;
  electricalDeviceMetalPad: string;
  electricalDeviceGenerator: string;
  electricalDevicePole: string;
  electricalItemTypes: ReadonlySet<string>;
  electricalValidDeviceTypes: ReadonlySet<string>;
  electricalSignalModes: ReadonlySet<string>;
  electricalGeneratorMaxWatts: number;
  safeBlockType: string;
  worldLockKeyItemType: string;
  oilRefineryOutputCapacity: number;
  oilRefineryBatteryInputCapacity: number;
  oilRefineryBatteryWatts: number;
  oilRefineryBatteryWattCapacity: number;
  oilRefineryConsumptionWattsPerHour: number;
  batteryChargerOutputCapacity: number;
  batteryChargerConsumptionWattsPerHour: number;
  batteryChargerOutputPerHour: number;
}

interface WorldStateHelpers {
  addBedrockFloorEntries(target: Map<unknown, unknown>): void;
  applyInteractionUpdateToWorldState(worldName: unknown, update: JsonRecord): void;
  cleanDropIdList(rawIds: unknown, maxIds?: number): string[];
  createEmptyWorldState(): JsonRecord;
  deserializeWorldState(worldName: unknown, data: unknown): JsonRecord;
  getDropStackGridFromDrop(drop: unknown): GridPosition | null;
  loadDropsIntoMap(target: Map<unknown, unknown>, rawEntries: unknown): void;
  loadElectricalDataIntoState(state: JsonRecord, data: unknown, worldName?: unknown): void;
  loadGridArrayIntoMap(target: Map<unknown, unknown>, rawEntries: unknown, normalizeEntry: NormalizeEntryFunction): void;
  loadInteractionsIntoMap(target: Map<unknown, unknown>, rawEntries: unknown, worldName?: unknown): void;
  loadSavedWorldGridData(state: JsonRecord, data: unknown): void;
  loadWorldEventStateIntoState(state: JsonRecord, data: unknown): void;
  normalizeBlockEntry(rawEntry: unknown): JsonRecord | null;
  normalizeElectricalEntry(rawEntry: unknown): JsonRecord | null;
  normalizeElectricalDeviceStateEntry(rawEntry: unknown): JsonRecord | null;
  normalizeEventTimestamp(value: unknown): string;
  normalizeRemovedBlockEntry(rawEntry: unknown): JsonRecord | null;
  normalizeSeedEntry(rawEntry: unknown): JsonRecord | null;
  normalizeWorldEventTileEntry(rawEntry: unknown, fallbackEventId?: unknown): JsonRecord | null;
  sanitizeBulletinBoardMessage(rawMessage: unknown): JsonRecord | null;
  sanitizeBulletinBoardState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeBlockUpdate(data: JsonRecord, worldName: unknown): JsonRecord | null;
  sanitizeBulkDropPickup(data: JsonRecord, worldName: unknown, player: JsonRecord): JsonRecord | null;
  sanitizeAntiGravityState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeAntiPunchState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeAntiTalkState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeBatteryChargerState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeChickenState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeCowState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeDiceState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeDisplaySlot(rawSlot: unknown): JsonRecord | null;
  sanitizeDisplayState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeDropCreate(data: JsonRecord, worldName: unknown): JsonRecord | null;
  sanitizeDropPickup(data: JsonRecord, worldName: unknown, player: JsonRecord): JsonRecord | null;
  sanitizeDropUpdate(data: JsonRecord, worldName: unknown): JsonRecord | null;
  sanitizeDuckState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeElectricalLayerUpdate(data: JsonRecord, worldName: unknown): JsonRecord | null;
  sanitizeInteractionUpdate(data: JsonRecord, worldName: unknown): JsonRecord | null;
  sanitizeMailboxMessage(rawMessage: unknown): JsonRecord | null;
  sanitizeMailboxState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeOilRefineryState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeSafeSlot(rawSlot: unknown): JsonRecord | null;
  sanitizeSafeState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeTackleBoxState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown, cooldownMs?: unknown): JsonRecord;
  sanitizeVendListing(rawListing: unknown): JsonRecord | null;
  sanitizeVendLogEntry(rawEntry: unknown): JsonRecord | null;
  sanitizeVendState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord;
  sanitizeWorldBackgroundTheme(value: unknown): string;
  serializeWorldState(worldName: unknown): JsonRecord;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(source: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

const MAX_OBJECT_TIMER_MS = 30 * 24 * 60 * 60 * 1000;

function createWorldStateHelpers(config: WorldStateHelperConfig): WorldStateHelpers {
  const itemDatabase = config.itemDatabase;
  const itemAtlasDb = config.itemAtlasDb;
  const dropContracts = config.dropContracts;
  const packetContracts = config.packetContracts;
  const cleanWorld = config.cleanWorld;
  const cleanName = config.cleanName;
  const cleanAccountName = config.cleanAccountName;
  const clampString = config.clampString;
  const clampInteger = config.clampInteger;
  const legacyWorldGenerationVersion = Math.max(1, Math.trunc(Number(config.legacyWorldGenerationVersion) || 1));
  const currentWorldGenerationVersion = Math.max(
    legacyWorldGenerationVersion,
    Math.trunc(Number(config.currentWorldGenerationVersion) || legacyWorldGenerationVersion)
  );

  function resolveInventoryCategory(itemId: unknown, requestedCategory = ""): string {
    return String(itemDatabase.resolveItemCategory(itemId, requestedCategory) || "");
  }

  function getStackLimit(itemId: unknown): number {
    const rawLimit = typeof itemDatabase.getStackLimit === "function" ? itemDatabase.getStackLimit(itemId) : 999;
    const limit = Math.trunc(Number(rawLimit) || 0);
    return limit > 0 ? limit : 999;
  }

  function normalizeGrid(rawEntry: JsonRecord): GridPosition | null {
    const x = Number(rawEntry.x);
    const y = Number(rawEntry.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const gridX = Math.trunc(x);
    const gridY = Math.trunc(y);
    if (!config.isGridInWorld(gridX, gridY)) return null;
    return { x: gridX, y: gridY };
  }

  function gridKey(x: unknown, y: unknown): string {
    return `${Number(x) || 0},${Number(y) || 0}`;
  }

  function parseGridKey(key: unknown): GridPosition | null {
    const parts = String(key || "").split(",");
    if (parts.length !== 2) return null;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y) };
  }

  function createEmptyWorldState(): JsonRecord {
    return {
      world_generation_version: currentWorldGenerationVersion,
      cleared: false,
      foreground: new Map(),
      background: new Map(),
      removed_foreground: new Map(),
      removed_background: new Map(),
      seeds: new Map(),
      electrical: new Map(),
      electrical_devices: new Map(),
      electrical_networks: config.makeEmptyElectricalNetworkCache(),
      electrical_network_version: 0,
      interactions: new Map(),
      world_lock: {},
      area_locks: [],
      cctv_state: config.makeEmptyCctvWorldState("START"),
      drops: new Map(),
      active_event_type: "",
      event_id: "",
      event_started_at: "",
      event_ends_at: "",
      event_changed_tiles: [],
    };
  }

  function sanitizeWorldBackgroundTheme(value: unknown): string {
    const clean = clampString(value || "").toLowerCase();
    return config.worldBackgroundThemes.has(clean) ? clean : "";
  }

  function normalizeBlockEntry(rawEntry: unknown): JsonRecord | null {
    if (!isRecord(rawEntry)) return null;

    const grid = normalizeGrid(rawEntry);
    if (!grid) return null;

    let blockType = clampString(rawEntry.block_type || rawEntry.type || "");
    if (blockType.length === 0) return null;
    if (blockType === "crafting_station_right") return null;
    if (blockType === "crafting_station_left") blockType = "crafting_station";
    if (!itemDatabase.hasItem(blockType) || resolveInventoryCategory(blockType) !== "block") return null;

    const entry: JsonRecord = {
      x: grid.x,
      y: grid.y,
      block_type: blockType,
    };

    if (hasOwn(rawEntry, "entrance_locked")) {
      entry.entrance_locked = Boolean(rawEntry.entrance_locked);
    }
    if (hasOwn(rawEntry, "sign_text")) {
      entry.sign_text = String(rawEntry.sign_text || "").slice(0, config.maxSignTextLength);
    }
    if (hasOwn(rawEntry, "toggle_on")) {
      entry.toggle_on = Boolean(rawEntry.toggle_on);
    }

    if (config.isDoorBlockType(blockType) && hasOwn(rawEntry, "door_id")) {
      entry.door_id = config.cleanDoorId(rawEntry.door_id);
    }
    if (config.isDoorBlockType(blockType) && (hasOwn(rawEntry, "door_name") || hasOwn(rawEntry, "name"))) {
      entry.door_name = config.cleanDoorName(rawEntry.door_name || rawEntry.name || "");
    }
    if (config.isPasswordDoorBlockType(blockType) && (hasOwn(rawEntry, "door_password") || hasOwn(rawEntry, "password"))) {
      entry.door_password = config.cleanDoorPassword(rawEntry.door_password || rawEntry.password || "");
    }

    if (config.isDoorBlockType(blockType) && (hasOwn(rawEntry, "door_destination") || hasOwn(rawEntry, "destination"))) {
      const parsedDestination = config.parseDoorDestination(rawEntry.door_destination || rawEntry.destination || "", rawEntry.world || "");
      entry.door_destination = parsedDestination.destination;
      entry.door_target_world = cleanWorld(rawEntry.door_target_world || rawEntry.target_world || parsedDestination.target_world);
      entry.door_target_id = config.cleanDoorId(rawEntry.door_target_id || rawEntry.target_door_id || parsedDestination.target_door_id);
    } else if (config.isDoorBlockType(blockType)) {
      if (hasOwn(rawEntry, "door_target_world") || hasOwn(rawEntry, "target_world")) {
        entry.door_target_world = cleanWorld(rawEntry.door_target_world || rawEntry.target_world || "");
      }
      if (hasOwn(rawEntry, "door_target_id") || hasOwn(rawEntry, "target_door_id")) {
        entry.door_target_id = config.cleanDoorId(rawEntry.door_target_id || rawEntry.target_door_id || "");
      }
    }

    return entry;
  }

  function cleanElectricalSignalMode(value: unknown): string {
    const clean = clampString(value || "").toLowerCase();
    return config.electricalSignalModes.has(clean) ? clean : "on_off";
  }

  function getElectricalDeviceTypeForItem(itemId: unknown, rawDeviceType = ""): string {
    const cleanItem = clampString(itemId || "").toLowerCase();
    const cleanDeviceType = clampString(rawDeviceType || "").toLowerCase();
    if (config.electricalValidDeviceTypes.has(cleanDeviceType)) return cleanDeviceType;
    if (cleanItem === config.electricalWireItem) return config.electricalDeviceWire;
    if (cleanItem === config.electricalMetalPadItem) return config.electricalDeviceMetalPad;
    if (cleanItem === config.electricalGeneratorItem) return config.electricalDeviceGenerator;
    if (cleanItem === config.electricalPoleItem) return config.electricalDevicePole;
    return "";
  }

  function normalizeElectricalLinkedGridKeys(rawValue: unknown, maxCount: number): string[] {
    const source = Array.isArray(rawValue) ? rawValue : [];
    const linkedKeys: string[] = [];
    const seen = new Set<string>();

    for (const rawEntry of source) {
      let grid: GridPosition | null = null;
      if (typeof rawEntry === "string") {
        grid = parseGridKey(rawEntry);
      } else if (isRecord(rawEntry)) {
        grid = {
          x: Math.trunc(Number(rawEntry.x)),
          y: Math.trunc(Number(rawEntry.y)),
        };
      }
      if (!grid || !Number.isFinite(grid.x) || !Number.isFinite(grid.y)) continue;
      if (!config.isGridInWorld(grid.x, grid.y)) continue;
      const key = gridKey(grid.x, grid.y);
      if (seen.has(key)) continue;
      seen.add(key);
      linkedKeys.push(key);
      if (linkedKeys.length >= maxCount) break;
    }

    return linkedKeys;
  }

  function normalizeElectricalLinkedPadKeys(rawValue: unknown): string[] {
    const source = Array.isArray(rawValue)
      ? rawValue
      : (Array.isArray((rawValue as JsonRecord | null)?.linked_pad_keys) ? (rawValue as JsonRecord).linked_pad_keys : []);
    return normalizeElectricalLinkedGridKeys(source, config.maxElectricalPadsPerGenerator);
  }

  function normalizeElectricalLinkedPoleKeys(rawValue: unknown): string[] {
    const source = Array.isArray(rawValue)
      ? rawValue
      : (Array.isArray((rawValue as JsonRecord | null)?.linked_pole_keys) ? (rawValue as JsonRecord).linked_pole_keys : []);
    return normalizeElectricalLinkedGridKeys(source, config.maxElectricalPolesPerGenerator);
  }

  function normalizeElectricPoleLinkedPoleKeys(rawValue: unknown, selfKey = ""): string[] {
    const source = Array.isArray(rawValue)
      ? rawValue
      : (Array.isArray((rawValue as JsonRecord | null)?.linked_pole_keys) ? (rawValue as JsonRecord).linked_pole_keys : []);
    return normalizeElectricalLinkedGridKeys(source, config.maxPoleLinksPerPole)
      .filter((key) => key !== selfKey);
  }

  function isElectricalLayerItem(itemId: unknown): boolean {
    const cleanItem = clampString(itemId || "").toLowerCase();
    if (!config.electricalItemTypes.has(cleanItem)) return false;
    const definition = itemDatabase.getItemDefinition(cleanItem);
    return Boolean(definition && definition.category === "block" && definition.electrical_layer === true);
  }

  function isElectricalDeviceBlockItem(itemId: unknown): boolean {
    const cleanItem = clampString(itemId || "").toLowerCase();
    if (
      cleanItem !== config.electricalMetalPadItem &&
      cleanItem !== config.electricalGeneratorItem &&
      cleanItem !== config.electricalPoleItem
    ) {
      return false;
    }
    const definition = itemDatabase.getItemDefinition(cleanItem);
    return Boolean(definition && definition.category === "block");
  }

  function getElectricalDeviceBlockLayer(itemId: unknown): string {
    const cleanItem = clampString(itemId || "").toLowerCase();
    if (cleanItem === config.electricalMetalPadItem) return "background";
    if (cleanItem === config.electricalGeneratorItem) return "foreground";
    if (cleanItem === config.electricalPoleItem) return "foreground";
    return "";
  }

  function normalizeElectricalEntry(rawEntry: unknown): JsonRecord | null {
    if (!isRecord(rawEntry)) return null;

    const grid = normalizeGrid(rawEntry);
    if (!grid) return null;

    const itemId = clampString(rawEntry.item_id || rawEntry.item_type || rawEntry.block_type || rawEntry.type || "").toLowerCase();
    if (!isElectricalLayerItem(itemId)) return null;

    const deviceType = getElectricalDeviceTypeForItem(itemId, rawEntry.device_type || rawEntry.electrical_device_type || "");
    if (deviceType === "") return null;

    const entry: JsonRecord = {
      x: grid.x,
      y: grid.y,
      item_id: itemId,
      block_type: itemId,
      device_type: deviceType,
      signal_mode: cleanElectricalSignalMode(rawEntry.signal_mode || (deviceType === config.electricalDeviceWire ? "on_off" : "power_storage")),
    };

    if (deviceType === config.electricalDeviceGenerator) {
      const maxWatts = clampInteger(rawEntry.max_watts || config.electricalGeneratorMaxWatts, 1, config.electricalGeneratorMaxWatts);
      entry.max_watts = maxWatts;
      entry.watts = clampInteger(rawEntry.watts || rawEntry.current_watts || 0, 0, maxWatts);
      entry.linked_pad_keys = normalizeElectricalLinkedPadKeys(rawEntry.linked_pad_keys || rawEntry.linked_pads || []);
      entry.linked_pole_keys = normalizeElectricalLinkedPoleKeys(rawEntry.linked_pole_keys || rawEntry.linked_poles || []);
    } else if (deviceType === config.electricalDevicePole) {
      entry.linked_pole_keys = normalizeElectricPoleLinkedPoleKeys(rawEntry.linked_pole_keys || rawEntry.linked_poles || [], gridKey(grid.x, grid.y));
    }

    return entry;
  }

  function normalizeElectricalDeviceStateEntry(rawEntry: unknown): JsonRecord | null {
    if (!isRecord(rawEntry)) return null;

    const grid = normalizeGrid(rawEntry);
    if (!grid) return null;

    const itemId = clampString(rawEntry.item_id || rawEntry.item_type || rawEntry.block_type || rawEntry.type || "").toLowerCase();
    if (!isElectricalDeviceBlockItem(itemId)) return null;

    const deviceType = getElectricalDeviceTypeForItem(itemId, rawEntry.device_type || rawEntry.electrical_device_type || "");
    if (
      deviceType !== config.electricalDeviceMetalPad &&
      deviceType !== config.electricalDeviceGenerator &&
      deviceType !== config.electricalDevicePole
    ) {
      return null;
    }

    const entry: JsonRecord = {
      x: grid.x,
      y: grid.y,
      item_id: itemId,
      block_type: itemId,
      device_type: deviceType,
      signal_mode: cleanElectricalSignalMode(rawEntry.signal_mode || "power_storage"),
    };

    if (deviceType === config.electricalDeviceGenerator) {
      const maxWatts = clampInteger(rawEntry.max_watts || config.electricalGeneratorMaxWatts, 1, config.electricalGeneratorMaxWatts);
      entry.max_watts = maxWatts;
      entry.watts = clampInteger(rawEntry.watts || rawEntry.current_watts || 0, 0, maxWatts);
      entry.linked_pad_keys = normalizeElectricalLinkedPadKeys(rawEntry.linked_pad_keys || rawEntry.linked_pads || []);
      entry.linked_pole_keys = normalizeElectricalLinkedPoleKeys(rawEntry.linked_pole_keys || rawEntry.linked_poles || []);
    } else if (deviceType === config.electricalDevicePole) {
      entry.linked_pole_keys = normalizeElectricPoleLinkedPoleKeys(rawEntry.linked_pole_keys || rawEntry.linked_poles || [], gridKey(grid.x, grid.y));
    }

    return entry;
  }

  function putElectricalDeviceEntryInState(state: JsonRecord, deviceEntry: JsonRecord): void {
    const key = gridKey(deviceEntry.x, deviceEntry.y);
    getStateMap(state, "electrical_devices").set(key, deviceEntry);
    const targetLayer = getElectricalDeviceBlockLayer(deviceEntry.item_id);
    const targetMap = targetLayer === "background" ? getStateMap(state, "background") : getStateMap(state, "foreground");
    if (!targetMap.has(key)) {
      targetMap.set(key, {
        x: deviceEntry.x,
        y: deviceEntry.y,
        block_type: deviceEntry.item_id,
      });
    }
  }

  function loadElectricalDataIntoState(state: JsonRecord, data: unknown, worldName: unknown = ""): void {
    void worldName;
    if (!isRecord(state) || !isRecord(data)) return;
    const electrical = getStateMap(state, "electrical");

    const rawLayerEntries = Array.isArray(data.electrical_layer)
      ? data.electrical_layer
      : (Array.isArray(data.electrical_tiles) ? data.electrical_tiles : (Array.isArray(data.electrical) ? data.electrical : []));

    for (const rawEntry of rawLayerEntries) {
      const rawRecord = isRecord(rawEntry) ? rawEntry : {};
      const itemId = clampString(rawRecord.item_id || rawRecord.item_type || rawRecord.block_type || rawRecord.type || "").toLowerCase();
      if (isElectricalLayerItem(itemId)) {
        const entry = normalizeElectricalEntry(rawRecord);
        if (entry) electrical.set(gridKey(entry.x, entry.y), entry);
        continue;
      }

      if (!isElectricalDeviceBlockItem(itemId)) continue;
      const deviceEntry = normalizeElectricalDeviceStateEntry(rawRecord);
      if (deviceEntry) putElectricalDeviceEntryInState(state, deviceEntry);
    }

    const rawDeviceEntries = Array.isArray(data.electrical_devices)
      ? data.electrical_devices
      : (Array.isArray(data.electrical_device_state) ? data.electrical_device_state : []);
    for (const rawEntry of rawDeviceEntries) {
      const deviceEntry = normalizeElectricalDeviceStateEntry(rawEntry);
      if (deviceEntry) putElectricalDeviceEntryInState(state, deviceEntry);
    }
  }

  function sanitizeElectricalLayerUpdate(data: JsonRecord, worldName: unknown): JsonRecord | null {
    const action = clampString(data.action || "").toLowerCase();
    if (action !== "place" && action !== "break" && action !== "remove") return null;

    const grid = normalizeGrid(data);
    if (!grid) return null;

    const blockType = clampString(data.block_type || data.item_id || data.item_type || data.type || "").toLowerCase();
    if (action === "place" && !isElectricalLayerItem(blockType)) return null;
    if (blockType !== "" && !isElectricalLayerItem(blockType)) return null;

    return {
      type: "electrical_layer_update",
      action: action === "remove" ? "break" : action,
      x: grid.x,
      y: grid.y,
      block_type: blockType,
      item_id: blockType,
      device_type: getElectricalDeviceTypeForItem(blockType, data.device_type || data.electrical_device_type || ""),
      signal_mode: cleanElectricalSignalMode(data.signal_mode || ""),
      world: cleanWorld(worldName),
    };
  }

  function normalizeRemovedBlockEntry(rawEntry: unknown): JsonRecord | null {
    if (!isRecord(rawEntry)) return null;

    const grid = normalizeGrid(rawEntry);
    if (!grid) return null;

    const blockType = clampString(rawEntry.block_type || rawEntry.type || "");
    if (blockType !== "" && (!itemDatabase.hasItem(blockType) || resolveInventoryCategory(blockType) !== "block")) {
      return null;
    }

    return {
      x: grid.x,
      y: grid.y,
      block_type: blockType,
    };
  }

  function normalizeSeedEntry(rawEntry: unknown): JsonRecord | null {
    if (!isRecord(rawEntry)) return null;

    const grid = normalizeGrid(rawEntry);
    if (!grid) return null;

    const seedType = clampString(rawEntry.seed_type || rawEntry.type || "");
    if (seedType.length === 0) return null;
    if (!itemDatabase.hasItem(seedType) || resolveInventoryCategory(seedType) !== "seed") return null;

    const configuredGrowTime = config.getSeedConfiguredGrowTime(seedType);
    const maxGrowTime = Math.max(1, Math.min(86400, Number(rawEntry.max_grow_time) || configuredGrowTime));
    const rawMature = Boolean(rawEntry.mature);
    const growTime = rawMature ? 0 : Math.max(0, Math.min(maxGrowTime, Number(rawEntry.grow_time) || maxGrowTime));
    let plantedAt = Number(rawEntry.planted_at || 0);
    if (!Number.isFinite(plantedAt) || plantedAt <= 0) {
      plantedAt = Date.now() - Math.max(0, maxGrowTime - growTime) * 1000;
    }

    return {
      x: grid.x,
      y: grid.y,
      seed_type: seedType,
      grow_time: growTime,
      max_grow_time: maxGrowTime,
      planted_at: plantedAt,
      mutated: Boolean(rawEntry.mutated),
    };
  }

  function loadGridArrayIntoMap(target: Map<unknown, unknown>, rawEntries: unknown, normalizeEntry: NormalizeEntryFunction): void {
    if (!(target instanceof Map) || !Array.isArray(rawEntries) || typeof normalizeEntry !== "function") return;

    for (const rawEntry of rawEntries) {
      const entry = normalizeEntry(rawEntry);
      if (!entry) continue;
      target.set(gridKey(entry.x, entry.y), entry);
    }
  }

  function getBedrockStartY(): number {
    const rawStart = Math.trunc(Number(config.bedrockStartY));
    if (!Number.isFinite(rawStart)) return Math.max(0, Math.trunc(Number(config.worldHeight) || 0));
    return Math.max(0, Math.min(Math.trunc(Number(config.worldHeight) || 0), rawStart));
  }

  function addBedrockFloorEntries(target: Map<unknown, unknown>): void {
    if (!(target instanceof Map)) return;
    const width = Math.max(0, Math.trunc(Number(config.worldWidth) || 0));
    const height = Math.max(0, Math.trunc(Number(config.worldHeight) || 0));
    const bedrockStartY = getBedrockStartY();
    for (let x = 0; x < width; x += 1) {
      for (let y = bedrockStartY; y < height; y += 1) {
        target.set(gridKey(x, y), { x, y, block_type: "bedrock" });
      }
    }
  }

  function applyLoadedWorldClearState(state: JsonRecord): void {
    const foreground = getStateMap(state, "foreground");
    const removedForeground = getStateMap(state, "removed_foreground");
    const removedBackground = getStateMap(state, "removed_background");
    const removedClearThreshold = Math.floor((Math.max(0, Math.trunc(Number(config.worldWidth) || 0)) * getBedrockStartY()) / 2);

    if (!state.cleared && removedForeground.size > removedClearThreshold) {
      state.cleared = true;
      removedForeground.clear();
      removedBackground.clear();
    }

    if (state.cleared) {
      addBedrockFloorEntries(foreground);
    }
  }

  function loadSavedWorldGridData(state: JsonRecord, data: unknown): void {
    if (!isRecord(state) || !isRecord(data)) return;

    state.cleared = Boolean(data.cleared || data.world_cleared || data.clear_generated);
    loadGridArrayIntoMap(getStateMap(state, "foreground"), data.foreground || data.blocks, normalizeBlockEntry);
    loadGridArrayIntoMap(getStateMap(state, "background"), data.background || data.background_blocks, normalizeBlockEntry);
    loadGridArrayIntoMap(getStateMap(state, "removed_foreground"), data.removed_foreground, normalizeRemovedBlockEntry);
    loadGridArrayIntoMap(getStateMap(state, "removed_background"), data.removed_background, normalizeRemovedBlockEntry);
    loadGridArrayIntoMap(getStateMap(state, "seeds"), data.seeds || data.planted_seeds, normalizeSeedEntry);
    applyLoadedWorldClearState(state);
  }

  function normalizeEventTimestamp(value: unknown): string {
    const raw = String(value || "").trim();
    if (raw === "") return "";
    const time = Date.parse(raw);
    if (!Number.isFinite(time)) return "";
    return new Date(time).toISOString();
  }

  function normalizeWorldEventTileEntry(rawEntry: unknown, fallbackEventId: unknown = ""): JsonRecord | null {
    if (!isRecord(rawEntry)) return null;

    const grid = normalizeGrid(rawEntry);
    if (!grid) return null;

    const eventBlockId = clampString(rawEntry.event_block_id || rawEntry.block_type || "");
    if (eventBlockId === "" || !itemDatabase.hasItem(eventBlockId) || resolveInventoryCategory(eventBlockId) !== "block") {
      return null;
    }

    const originalBlockId = clampString(rawEntry.original_block_id || rawEntry.original_block_type || "");
    if (originalBlockId !== "" && (!itemDatabase.hasItem(originalBlockId) || resolveInventoryCategory(originalBlockId) !== "block")) {
      return null;
    }

    return {
      x: grid.x,
      y: grid.y,
      layer: "foreground",
      original_block_id: originalBlockId,
      event_block_id: eventBlockId,
      event_id: clampString(rawEntry.event_id || fallbackEventId || ""),
      changed_at: normalizeEventTimestamp(rawEntry.changed_at || "") || new Date().toISOString(),
      source: clampString(rawEntry.source || ""),
      reason: clampString(rawEntry.reason || ""),
    };
  }

  function loadWorldEventStateIntoState(state: JsonRecord, data: unknown): void {
    if (!isRecord(state) || !isRecord(data)) return;

    const activeEvent = isRecord(data.active_event) ? data.active_event : {};
    const eventType = clampString(data.active_event_type || activeEvent.type || activeEvent.event_type || "");
    if (eventType !== config.snowStormEventType) return;

    const eventId = clampString(data.event_id || activeEvent.event_id || "");
    const startedAt = normalizeEventTimestamp(data.event_started_at || activeEvent.started_at || activeEvent.event_started_at || "");
    const endsAt = normalizeEventTimestamp(data.event_ends_at || activeEvent.ends_at || activeEvent.event_ends_at || "");
    const rawChangedTiles = Array.isArray(data.event_changed_tiles)
      ? data.event_changed_tiles
      : (Array.isArray(activeEvent.changed_tiles) ? activeEvent.changed_tiles : []);

    state.active_event_type = eventType;
    state.event_id = eventId || config.makeAuditId("event");
    state.event_started_at = startedAt || new Date().toISOString();
    state.event_ends_at = endsAt || new Date(Date.now() + Math.max(0, Number(config.snowStormEventDurationMs) || 0)).toISOString();
    state.event_changed_tiles = rawChangedTiles
      .map((entry: unknown) => normalizeWorldEventTileEntry(entry, state.event_id))
      .filter(Boolean);
  }

  function deserializeWorldState(worldName: unknown, data: unknown): JsonRecord {
    const state = createEmptyWorldState();
    if (!isRecord(data)) return state;

    state.world_generation_version = clampInteger(
      data.world_generation_version || legacyWorldGenerationVersion,
      legacyWorldGenerationVersion,
      currentWorldGenerationVersion
    );
    loadSavedWorldGridData(state, data);
    loadElectricalDataIntoState(state, data, worldName);
    loadInteractionsIntoMap(getStateMap(state, "interactions"), data.interactions, worldName);
    loadDropsIntoMap(getStateMap(state, "drops"), data.drops || data.item_drops);

    const worldLock = isRecord(data.world_lock) ? data.world_lock : null;
    if (worldLock) {
      state.world_lock = config.sanitizeWorldLockState(worldLock);
    }
    state.area_locks = config.sanitizeAreaLocksList(data.area_locks || (worldLock ? worldLock.area_locks : []) || []);

    if (isRecord(data.cctv_state)) {
      state.cctv_state = config.sanitizeCctvWorldState(data.cctv_state, worldName);
    }

    loadWorldEventStateIntoState(state, data);
    config.rebuildElectricalNetworksForState(state);
    config.repairEntranceGateState(state, worldName);
    return state;
  }

  function makeEmptyVendState(worldName: unknown, x: unknown, y: unknown): JsonRecord {
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

  function sanitizeVendListing(rawListing: unknown): JsonRecord | null {
    if (!isRecord(rawListing)) return null;

    const itemId = clampString(rawListing.item_id || rawListing.item_type || "");
    if (itemId === "" || !itemDatabase.hasItem(itemId)) return null;

    const itemCategory = resolveInventoryCategory(itemId, rawListing.item_category || rawListing.category || "");
    if (!itemDatabase.canStoreItemInCategory(itemId, itemCategory)) return null;

    const stackLimit = getStackLimit(itemId);
    const stock = clampInteger(rawListing.stock || rawListing.amount || 0, 0, stackLimit);
    const amountPerSale = clampInteger(rawListing.amount_per_sale || rawListing.per_sale || 1, 1, stackLimit);
    const priceWls = clampInteger(rawListing.price_wls || rawListing.price || 1, 1, getStackLimit("world_lock"));
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

  function sanitizeVendLogEntry(rawEntry: unknown): JsonRecord | null {
    if (!isRecord(rawEntry)) return null;

    const buyerName = cleanAccountName(rawEntry.buyer_username || rawEntry.buyer_name || "");
    const itemId = clampString(rawEntry.item_id || "");
    if (buyerName === "" || itemId === "" || !itemDatabase.hasItem(itemId)) return null;

    const itemCategory = resolveInventoryCategory(itemId, rawEntry.item_category || "");
    if (!itemDatabase.canStoreItemInCategory(itemId, itemCategory)) return null;

    return {
      buyer_username: buyerName,
      item_id: itemId,
      item_category: itemCategory,
      amount: clampInteger(rawEntry.amount || 0, 1, getStackLimit(itemId)),
      price_wls: clampInteger(rawEntry.price_wls || 0, 0, getStackLimit("world_lock")),
      date: String(rawEntry.date || rawEntry.sold_at || new Date().toISOString()),
    };
  }

  function sanitizeVendState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    const safe = makeEmptyVendState(worldName, x, y);
    if (!isRecord(rawEntry)) return safe;

    safe.owner_username = cleanAccountName(rawEntry.owner_username || rawEntry.owner_name || "");
    safe.owner_name = safe.owner_username.toUpperCase();
    safe.listing = sanitizeVendListing(rawEntry.listing);
    safe.pending_wls = clampInteger(rawEntry.pending_wls || rawEntry.pending_world_locks || 0, 0, getStackLimit("world_lock"));
    safe.updated_at = String(rawEntry.updated_at || safe.updated_at);

    const rawLogs = Array.isArray(rawEntry.logs) ? rawEntry.logs : [];
    const logs: JsonRecord[] = [];
    for (const rawLog of rawLogs) {
      const log = sanitizeVendLogEntry(rawLog);
      if (log) logs.push(log);
    }
    safe.logs = logs.slice(-config.vendLogLimit);

    if (!safe.listing && safe.pending_wls <= 0) {
      safe.owner_name = safe.owner_username.toUpperCase();
    }

    return safe;
  }

  function canStoreItemInSafe(itemId: unknown, itemCategory: unknown): boolean {
    const cleanItemId = clampString(itemId || "");
    if (cleanItemId === "" || !itemDatabase.hasItem(cleanItemId)) return false;
    if (cleanItemId === "punch" || cleanItemId === config.safeBlockType || cleanItemId === config.worldLockKeyItemType) return false;

    const definition = itemDatabase.getItemDefinition(cleanItemId);
    if (!definition || definition.hidden) return false;

    const resolvedCategory = resolveInventoryCategory(cleanItemId, String(itemCategory || ""));
    return itemDatabase.canStoreItemInCategory(cleanItemId, resolvedCategory);
  }

  function makeEmptySafeState(worldName: unknown, x: unknown, y: unknown): JsonRecord {
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

  function sanitizeSafeSlot(rawSlot: unknown): JsonRecord | null {
    if (!isRecord(rawSlot)) return null;

    const itemId = clampString(rawSlot.item_id || rawSlot.item_type || rawSlot.item || "");
    if (!canStoreItemInSafe(itemId, rawSlot.item_category || rawSlot.category || "")) return null;

    const itemCategory = resolveInventoryCategory(itemId, rawSlot.item_category || rawSlot.category || "");
    const amount = clampInteger(rawSlot.amount || 0, 1, getStackLimit(itemId));
    if (amount <= 0) return null;

    return {
      item_id: itemId,
      item_category: itemCategory,
      amount,
    };
  }

  function sanitizeSafeState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    const safe = makeEmptySafeState(worldName, x, y);
    if (!isRecord(rawEntry)) return safe;

    safe.owner_username = cleanAccountName(rawEntry.owner_username || rawEntry.owner_name || "");
    safe.owner_name = safe.owner_username.toUpperCase();
    safe.updated_at = String(rawEntry.updated_at || safe.updated_at);

    const rawSlots = Array.isArray(rawEntry.slots) ? rawEntry.slots : [];
    const slots: JsonRecord[] = [];
    for (const rawSlot of rawSlots) {
      const slot = sanitizeSafeSlot(rawSlot);
      if (slot) slots.push(slot);
    }
    safe.slots = slots.slice(0, config.safeSlotCount);

    return safe;
  }

  function canStoreItemInDisplay(itemId: unknown, itemCategory: unknown): boolean {
    const cleanItemId = clampString(itemId || "");
    if (cleanItemId === "" || !itemDatabase.hasItem(cleanItemId)) return false;
    if (
      cleanItemId === "punch" ||
      cleanItemId === config.safeBlockType ||
      config.isDisplayBlockType(cleanItemId) ||
      cleanItemId === config.worldLockKeyItemType
    ) {
      return false;
    }

    const definition = itemDatabase.getItemDefinition(cleanItemId);
    if (!definition || definition.hidden) return false;

    const resolvedCategory = resolveInventoryCategory(cleanItemId, String(itemCategory || ""));
    return itemDatabase.canStoreItemInCategory(cleanItemId, resolvedCategory);
  }

  function makeEmptyDisplayState(worldName: unknown, x: unknown, y: unknown): JsonRecord {
    return {
      action: "display_state",
      world: cleanWorld(worldName),
      x: Math.trunc(Number(x) || 0),
      y: Math.trunc(Number(y) || 0),
      owner_username: "",
      owner_name: "",
      slot: null,
      updated_at: new Date().toISOString(),
    };
  }

  function sanitizeDisplaySlot(rawSlot: unknown): JsonRecord | null {
    if (!isRecord(rawSlot)) return null;

    const itemId = clampString(rawSlot.item_id || rawSlot.item_type || rawSlot.item || "");
    if (!canStoreItemInDisplay(itemId, rawSlot.item_category || rawSlot.category || "")) return null;

    const itemCategory = resolveInventoryCategory(itemId, rawSlot.item_category || rawSlot.category || "");
    const slot: JsonRecord = {
      item_id: itemId,
      item_type: itemId,
      item_category: itemCategory,
      amount: 1,
    };
    const sourceTransactionId = clampString(rawSlot.source_transaction_id || rawSlot.display_transaction_id || rawSlot.transaction_id || "", 96);
    if (sourceTransactionId !== "") {
      slot.source_transaction_id = sourceTransactionId;
      slot.display_transaction_id = sourceTransactionId;
    }
    const sourceInventoryOccupiedSlots = clampInteger(rawSlot.source_inventory_occupied_slots || 0, 0, 10000);
    if (sourceInventoryOccupiedSlots > 0) {
      slot.source_inventory_occupied_slots = sourceInventoryOccupiedSlots;
    }
    return slot;
  }

  function sanitizeDisplayState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    const display = makeEmptyDisplayState(worldName, x, y);
    if (!isRecord(rawEntry)) return display;

    display.owner_username = cleanAccountName(rawEntry.owner_username || rawEntry.owner_name || "");
    display.owner_name = display.owner_username.toUpperCase();
    display.updated_at = String(rawEntry.updated_at || display.updated_at);
    display.slot = sanitizeDisplaySlot(rawEntry.slot || rawEntry.item || null);
    return display;
  }

  function makeEmptyMailboxState(worldName: unknown, x: unknown, y: unknown): JsonRecord {
    return {
      action: "mailbox_state",
      world: cleanWorld(worldName),
      x: Math.trunc(Number(x) || 0),
      y: Math.trunc(Number(y) || 0),
      messages: [],
      updated_at: new Date().toISOString(),
    };
  }

  function sanitizeMailboxMessage(rawMessage: unknown): JsonRecord | null {
    if (!isRecord(rawMessage)) return null;
    const message = String(rawMessage.message || rawMessage.text || "").trim().slice(0, config.maxMailboxMessageLength);
    if (message === "") return null;
    return {
      from: cleanAccountName(rawMessage.from || rawMessage.sender || rawMessage.sender_username || "Player").toUpperCase() || "PLAYER",
      message,
      sent_at: String(rawMessage.sent_at || rawMessage.created_at || new Date().toISOString()),
    };
  }

  function sanitizeMailboxState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    const mailbox = makeEmptyMailboxState(worldName, x, y);
    if (!isRecord(rawEntry)) return mailbox;

    mailbox.updated_at = String(rawEntry.updated_at || mailbox.updated_at);
    const rawMessages = Array.isArray(rawEntry.messages) ? rawEntry.messages : [];
    const messages: JsonRecord[] = [];
    for (const rawMessage of rawMessages) {
      const message = sanitizeMailboxMessage(rawMessage);
      if (message) messages.push(message);
    }
    mailbox.messages = messages.slice(-config.mailboxMessageLimit);
    return mailbox;
  }

  function makeEmptyBulletinBoardState(worldName: unknown, x: unknown, y: unknown): JsonRecord {
    return {
      action: "bulletin_board_state",
      world: cleanWorld(worldName),
      x: Math.trunc(Number(x) || 0),
      y: Math.trunc(Number(y) || 0),
      messages: [],
      updated_at: new Date().toISOString(),
    };
  }

  function sanitizeBulletinBoardMessage(rawMessage: unknown): JsonRecord | null {
    if (!isRecord(rawMessage)) return null;
    const message = String(rawMessage.message || rawMessage.text || "").trim().slice(0, config.maxBulletinBoardMessageLength);
    if (message === "") return null;
    const playerName = cleanAccountName(
      rawMessage.player_name || rawMessage.username || rawMessage.from || rawMessage.sender || "Player"
    ).toUpperCase() || "PLAYER";
    return {
      player_name: playerName,
      username: playerName,
      message,
      posted_at: String(rawMessage.posted_at || rawMessage.created_at || rawMessage.sent_at || new Date().toISOString()),
    };
  }

  function sanitizeBulletinBoardState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    const board = makeEmptyBulletinBoardState(worldName, x, y);
    if (!isRecord(rawEntry)) return board;

    board.updated_at = String(rawEntry.updated_at || board.updated_at);
    const rawMessages = Array.isArray(rawEntry.messages) ? rawEntry.messages : [];
    const messages: JsonRecord[] = [];
    for (const rawMessage of rawMessages) {
      const message = sanitizeBulletinBoardMessage(rawMessage);
      if (message) messages.push(message);
    }
    board.messages = messages.slice(-config.bulletinBoardMessageLimit);
    return board;
  }

  function parseObjectTimestampMs(value: unknown): number {
    if (Number.isFinite(Number(value))) {
      return Math.max(0, Math.trunc(Number(value)));
    }
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function makeEmptyTackleBoxState(worldName: unknown, x: unknown, y: unknown, cooldownMs: unknown = config.tackleBoxCooldownMs): JsonRecord {
    return {
      action: "tackle_box_state",
      world: cleanWorld(worldName),
      x: Math.trunc(Number(x) || 0),
      y: Math.trunc(Number(y) || 0),
      next_harvest_at: "",
      next_harvest_at_ms: 0,
      last_harvested_at: "",
      last_harvested_at_ms: 0,
      cooldown_ms: clampInteger(cooldownMs, 0, MAX_OBJECT_TIMER_MS),
      updated_at: new Date().toISOString(),
    };
  }

  function sanitizeTackleBoxState(
    rawEntry: unknown,
    worldName: unknown,
    x: unknown,
    y: unknown,
    cooldownMs: unknown = config.tackleBoxCooldownMs
  ): JsonRecord {
    const tackle = makeEmptyTackleBoxState(worldName, x, y, cooldownMs);
    if (!isRecord(rawEntry)) return tackle;

    const nextMs = parseObjectTimestampMs(rawEntry.next_harvest_at_ms ?? rawEntry.next_ready_at_ms ?? rawEntry.next_harvest_at ?? rawEntry.ready_at);
    const lastMs = parseObjectTimestampMs(rawEntry.last_harvested_at_ms ?? rawEntry.harvested_at_ms ?? rawEntry.last_harvested_at ?? rawEntry.harvested_at);
    const savedCooldownMs = clampInteger(rawEntry.cooldown_ms || rawEntry.harvest_cooldown_ms || cooldownMs, 0, MAX_OBJECT_TIMER_MS);

    tackle.next_harvest_at_ms = nextMs;
    tackle.next_harvest_at = nextMs > 0 ? new Date(nextMs).toISOString() : "";
    tackle.last_harvested_at_ms = lastMs;
    tackle.last_harvested_at = lastMs > 0 ? new Date(lastMs).toISOString() : "";
    tackle.cooldown_ms = savedCooldownMs;
    tackle.updated_at = String(rawEntry.updated_at || tackle.updated_at);
    return tackle;
  }

  function makeEmptyAnimalState(action: string, worldName: unknown, x: unknown, y: unknown, productionMs: number, hungerMs: number): JsonRecord {
    return {
      action,
      world: cleanWorld(worldName),
      x: Math.trunc(Number(x) || 0),
      y: Math.trunc(Number(y) || 0),
      status: "hungry",
      fed_at: "",
      fed_at_ms: 0,
      next_harvest_at: "",
      next_harvest_at_ms: 0,
      last_harvested_at: "",
      last_harvested_at_ms: 0,
      hungry_since_at: "",
      hungry_since_at_ms: 0,
      dies_at: "",
      dies_at_ms: 0,
      production_ms: productionMs,
      hunger_ms: hungerMs,
      updated_at: new Date().toISOString(),
    };
  }

  function normalizeAnimalStatus(rawStatus: unknown, nextHarvestAtMs: number, diesAtMs: number, nowMs = Date.now()): string {
    const cleanStatus = clampString(rawStatus || "").toLowerCase();
    if (nextHarvestAtMs > 0) {
      return nowMs >= nextHarvestAtMs ? "ready" : "producing";
    }
    if (cleanStatus === "ready" || cleanStatus === "producing") return cleanStatus;
    if (diesAtMs > 0 || cleanStatus === "hungry") return "hungry";
    return "hungry";
  }

  function sanitizeAnimalState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown, action: string, productionDefault: number, hungerDefault: number): JsonRecord {
    const animal = makeEmptyAnimalState(action, worldName, x, y, productionDefault, hungerDefault);
    if (!isRecord(rawEntry)) return animal;

    const nowMs = Date.now();
    const productionMs = clampInteger(rawEntry.production_ms || rawEntry.produce_ms || productionDefault, 0, productionDefault);
    const hungerMs = clampInteger(rawEntry.hunger_ms || rawEntry.starve_ms || hungerDefault, 0, hungerDefault);
    const fedMs = parseObjectTimestampMs(rawEntry.fed_at_ms ?? rawEntry.fed_at);
    const nextMs = parseObjectTimestampMs(rawEntry.next_harvest_at_ms ?? rawEntry.next_ready_at_ms ?? rawEntry.next_harvest_at ?? rawEntry.ready_at);
    const lastMs = parseObjectTimestampMs(rawEntry.last_harvested_at_ms ?? rawEntry.harvested_at_ms ?? rawEntry.last_harvested_at ?? rawEntry.harvested_at);
    let hungrySinceMs = parseObjectTimestampMs(rawEntry.hungry_since_at_ms ?? rawEntry.hungry_since_ms ?? rawEntry.hungry_since_at);
    let diesAtMs = parseObjectTimestampMs(rawEntry.dies_at_ms ?? rawEntry.starves_at_ms ?? rawEntry.dies_at ?? rawEntry.starves_at);
    const rawReady = Boolean(rawEntry.ready || rawEntry.can_harvest);

    if (diesAtMs <= 0 && hungrySinceMs > 0 && hungerMs > 0) {
      diesAtMs = hungrySinceMs + hungerMs;
    } else if (hungrySinceMs <= 0 && diesAtMs > 0 && hungerMs > 0) {
      hungrySinceMs = Math.max(0, diesAtMs - hungerMs);
    }

    animal.production_ms = productionMs;
    animal.hunger_ms = hungerMs;
    animal.fed_at_ms = fedMs;
    animal.fed_at = fedMs > 0 ? new Date(fedMs).toISOString() : "";
    animal.next_harvest_at_ms = nextMs;
    animal.next_harvest_at = nextMs > 0 ? new Date(nextMs).toISOString() : "";
    animal.last_harvested_at_ms = lastMs;
    animal.last_harvested_at = lastMs > 0 ? new Date(lastMs).toISOString() : "";
    animal.hungry_since_at_ms = hungrySinceMs;
    animal.hungry_since_at = hungrySinceMs > 0 ? new Date(hungrySinceMs).toISOString() : "";
    animal.dies_at_ms = diesAtMs;
    animal.dies_at = diesAtMs > 0 ? new Date(diesAtMs).toISOString() : "";
    animal.status = rawReady ? "ready" : normalizeAnimalStatus(rawEntry.status || rawEntry.phase || "", nextMs, diesAtMs, nowMs);
    animal.updated_at = String(rawEntry.updated_at || animal.updated_at);

    if (animal.status === "producing" || animal.status === "ready") {
      animal.hungry_since_at_ms = 0;
      animal.hungry_since_at = "";
      animal.dies_at_ms = 0;
      animal.dies_at = "";
    } else {
      animal.next_harvest_at_ms = 0;
      animal.next_harvest_at = "";
      animal.fed_at_ms = 0;
      animal.fed_at = "";
    }

    return animal;
  }

  function sanitizeChickenState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    return sanitizeAnimalState(rawEntry, worldName, x, y, "chicken_state", config.chickenProductionMs, config.chickenHungerMs);
  }

  function sanitizeCowState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    return sanitizeAnimalState(rawEntry, worldName, x, y, "cow_state", config.cowProductionMs, config.cowHungerMs);
  }

  function sanitizeDuckState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    return sanitizeAnimalState(rawEntry, worldName, x, y, "duck_state", config.duckProductionMs, config.duckHungerMs);
  }

  function makeEmptyDiceState(worldName: unknown, x: unknown, y: unknown): JsonRecord {
    return {
      action: "dice_roll",
      world: cleanWorld(worldName),
      x: Math.trunc(Number(x) || 0),
      y: Math.trunc(Number(y) || 0),
      face: 1,
      rolled_number: 1,
      rolled_by: "",
      rolled_at: "",
      roll_id: "",
      updated_at: new Date().toISOString(),
    };
  }

  function sanitizeDiceState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    const dice = makeEmptyDiceState(worldName, x, y);
    if (!isRecord(rawEntry)) return dice;

    const face = clampInteger(rawEntry.face || rawEntry.rolled_number || 1, 1, 6);
    dice.face = face;
    dice.rolled_number = face;
    dice.rolled_by = cleanAccountName(rawEntry.rolled_by || rawEntry.username || rawEntry.account_username || "");
    dice.rolled_at = String(rawEntry.rolled_at || rawEntry.updated_at || "");
    dice.roll_id = clampString(rawEntry.roll_id || rawEntry.source_id || "", 96);
    dice.updated_at = String(rawEntry.updated_at || dice.updated_at);
    return dice;
  }

  function sanitizeToggleObjectState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown, action: string, fallbackBlockType: string): JsonRecord {
    const raw = isRecord(rawEntry) ? rawEntry : {};
    return {
      action,
      world: cleanWorld(raw.world || worldName),
      x: Math.trunc(Number(raw.x ?? x) || 0),
      y: Math.trunc(Number(raw.y ?? y) || 0),
      block_type: clampString(raw.block_type || fallbackBlockType),
      enabled: Boolean(raw.enabled),
    };
  }

  function sanitizeAntiPunchState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    return sanitizeToggleObjectState(rawEntry, worldName, x, y, "anti_punch_state", "anti_punch");
  }

  function sanitizeAntiTalkState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    return sanitizeToggleObjectState(rawEntry, worldName, x, y, "anti_talk_state", "anti_talk");
  }

  function sanitizeAntiGravityState(rawEntry: unknown, worldName: unknown, x: unknown, y: unknown): JsonRecord {
    return sanitizeToggleObjectState(rawEntry, worldName, x, y, "anti_gravity_state", "anti_gravity");
  }

  function getLinkedPoleKeyFromTimedMachineState(rawState: JsonRecord): string {
    const rawKey = clampString(rawState.linked_pole_key || rawState.pole_key || "", 64);
    const parsedKeyGrid = rawKey !== "" ? parseGridKey(rawKey) : null;
    if (parsedKeyGrid && config.isGridInWorld(parsedKeyGrid.x, parsedKeyGrid.y)) {
      return gridKey(parsedKeyGrid.x, parsedKeyGrid.y);
    }

    const rawX = Number(rawState.linked_pole_x ?? rawState.pole_x);
    const rawY = Number(rawState.linked_pole_y ?? rawState.pole_y);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return "";
    const poleX = Math.trunc(rawX);
    const poleY = Math.trunc(rawY);
    if (!config.isGridInWorld(poleX, poleY)) return "";
    return gridKey(poleX, poleY);
  }

  function getOilRefineryBatteryCountFromWatts(watts: unknown): number {
    const cleanWatts = clampInteger(watts || 0, 0, config.oilRefineryBatteryWattCapacity);
    if (cleanWatts <= 0) return 0;
    return Math.max(1, Math.min(config.oilRefineryBatteryInputCapacity, Math.ceil(cleanWatts / config.oilRefineryBatteryWatts)));
  }

  function getOilRefineryBatteryWattsFromRaw(rawState: JsonRecord): number {
    const rawWatts = Number(
      rawState.battery_watts ??
      rawState.input_battery_watts ??
      rawState.stored_battery_watts ??
      rawState.available_battery_watts
    );
    if (Number.isFinite(rawWatts)) {
      return clampInteger(rawWatts, 0, config.oilRefineryBatteryWattCapacity);
    }

    const rawCount = Number(
      rawState.battery_count ??
      rawState.input_battery_count ??
      rawState.batteries ??
      rawState.battery_stack
    );
    if (!Number.isFinite(rawCount)) return 0;
    return clampInteger(Math.trunc(rawCount), 0, config.oilRefineryBatteryInputCapacity) * config.oilRefineryBatteryWatts;
  }

  function sanitizeOilRefineryState(rawEntry: unknown = {}, worldName: unknown = "", fallbackX: unknown = 0, fallbackY: unknown = 0): JsonRecord {
    const rawState = isRecord(rawEntry) ? rawEntry : {};
    const x = clampInteger(rawState.x ?? fallbackX, 0, config.worldWidth - 1);
    const y = clampInteger(rawState.y ?? fallbackY, 0, config.worldHeight - 1);
    const outputCount = clampInteger(rawState.output_count ?? rawState.produced_count ?? 0, 0, config.oilRefineryOutputCapacity);
    const crudeProgress = Math.max(0, Math.min(0.999999, Number(rawState.crude_progress) || 0));
    const linkedPoleKey = getLinkedPoleKeyFromTimedMachineState(rawState);
    const batteryWatts = getOilRefineryBatteryWattsFromRaw(rawState);
    const batteryCount = getOilRefineryBatteryCountFromWatts(batteryWatts);
    const now = Date.now();
    let lastTickMs = Math.trunc(Number(rawState.last_tick_ms) || now);
    if (!Number.isFinite(lastTickMs) || lastTickMs <= 0) lastTickMs = now;

    return {
      action: "oil_refinery_state",
      world: cleanWorld(rawState.world || worldName),
      x,
      y,
      enabled: Boolean(rawState.enabled ?? rawState.machine_enabled ?? false),
      running: Boolean(rawState.running ?? rawState.is_running ?? false),
      direct_power: Boolean(rawState.direct_power ?? rawState.powered ?? false),
      battery_powered: Boolean(rawState.battery_powered ?? rawState.battery_power ?? rawState.using_battery_power ?? false),
      linked_pole_key: linkedPoleKey,
      output_count: outputCount,
      produced_count: outputCount,
      output_capacity: config.oilRefineryOutputCapacity,
      crude_progress: crudeProgress,
      battery_watts: batteryWatts,
      input_battery_watts: batteryWatts,
      battery_count: batteryCount,
      input_battery_count: batteryCount,
      battery_capacity: config.oilRefineryBatteryInputCapacity,
      battery_watts_per_item: config.oilRefineryBatteryWatts,
      pending_consumption_watts: Math.max(0, Math.min(0.999999, Number(rawState.pending_consumption_watts ?? rawState.pending_watts) || 0)),
      consumption_rate_watts_per_hour: config.oilRefineryConsumptionWattsPerHour,
      last_tick_ms: lastTickMs,
      auto_shutdown: Boolean(rawState.auto_shutdown),
      shutdown_reason: clampString(rawState.shutdown_reason || "", 64),
    };
  }

  function sanitizeBatteryChargerState(rawEntry: unknown = {}, worldName: unknown = "", fallbackX: unknown = 0, fallbackY: unknown = 0): JsonRecord {
    const rawState = isRecord(rawEntry) ? rawEntry : {};
    const x = clampInteger(rawState.x ?? fallbackX, 0, config.worldWidth - 1);
    const y = clampInteger(rawState.y ?? fallbackY, 0, config.worldHeight - 1);
    const outputCount = clampInteger(rawState.output_count ?? rawState.produced_count ?? 0, 0, config.batteryChargerOutputCapacity);
    const batteryProgress = Math.max(0, Math.min(0.999999, Number(rawState.battery_progress ?? rawState.production_progress ?? rawState.charge_ratio) || 0));
    const linkedPoleKey = getLinkedPoleKeyFromTimedMachineState(rawState);
    const now = Date.now();
    let lastTickMs = Math.trunc(Number(rawState.last_tick_ms) || now);
    if (!Number.isFinite(lastTickMs) || lastTickMs <= 0) lastTickMs = now;

    return {
      action: "battery_charger_state",
      world: cleanWorld(rawState.world || worldName),
      x,
      y,
      enabled: Boolean(rawState.enabled ?? rawState.machine_enabled ?? rawState.running ?? false),
      running: Boolean(rawState.running ?? rawState.is_running ?? false),
      direct_power: Boolean(rawState.direct_power ?? rawState.powered ?? false),
      linked_pole_key: linkedPoleKey,
      output_count: outputCount,
      produced_count: outputCount,
      output_capacity: config.batteryChargerOutputCapacity,
      battery_progress: batteryProgress,
      production_progress: batteryProgress,
      pending_consumption_watts: Math.max(0, Math.min(0.999999, Number(rawState.pending_consumption_watts ?? rawState.pending_watts) || 0)),
      consumption_rate_watts_per_hour: config.batteryChargerConsumptionWattsPerHour,
      production_rate_per_hour: config.batteryChargerOutputPerHour,
      last_tick_ms: lastTickMs,
      auto_shutdown: Boolean(rawState.auto_shutdown),
      shutdown_reason: clampString(rawState.shutdown_reason || "", 64),
    };
  }

  function sanitizeBlockUpdate(data: JsonRecord, worldName: unknown): JsonRecord | null {
    const action = String(data.action || "").trim();
    if (action !== "place" && action !== "break" && action !== "hit") return null;

    const rawLayer = String(data.layer || "foreground").trim().toLowerCase();
    const layer = rawLayer === "background" ? rawLayer : "foreground";
    const grid = normalizeGrid(data);
    if (!grid) return null;

    const atlasItemId = Math.max(0, Math.trunc(Number(data.item_id) || 0));
    let blockType = clampString(data.block_type || "");
    let resolvedAtlasItemId = 0;
    if (atlasItemId > 0) {
      const atlasItemKey = String(itemAtlasDb.getItemKey(atlasItemId) || "");
      if (atlasItemKey !== "") {
        if (blockType !== "" && blockType !== atlasItemKey) return null;
        blockType = atlasItemKey;
        resolvedAtlasItemId = atlasItemId;
      }
    }
    if (action === "place" && blockType.length === 0) return null;
    if (blockType !== "" && (!itemDatabase.hasItem(blockType) || resolveInventoryCategory(blockType) !== "block")) return null;
    const blockTypeAtlasItemId = Number(itemAtlasDb.getItemIdForKey(blockType) || 0);
    const normalizedAtlasItemId = resolvedAtlasItemId > 0 ? resolvedAtlasItemId : blockTypeAtlasItemId;
    const rawWaterBucketAction = clampString(data.water_bucket_action || "", 16).toLowerCase();
    const waterBucketAction = rawWaterBucketAction === "pour" || rawWaterBucketAction === "scoop"
      ? rawWaterBucketAction
      : "";

    return {
      type: "world_block_update",
      action,
      layer,
      x: grid.x,
      y: grid.y,
      block_type: blockType,
      item_id: normalizedAtlasItemId > 0 ? normalizedAtlasItemId : undefined,
      source_tool: clampString(data.source_tool || ""),
      water_bucket_action: waterBucketAction,
      world: cleanWorld(worldName),
    };
  }

  function sanitizeInteractionGridAction(data: JsonRecord, worldName: unknown, action: string): JsonRecord | null {
    const grid = normalizeGrid(data);
    if (!grid) return null;
    return {
      type: "world_interaction_update",
      world: cleanWorld(worldName),
      action,
      x: grid.x,
      y: grid.y,
    };
  }

  function sanitizeInteractionUpdate(data: JsonRecord, worldName: unknown): JsonRecord | null {
    const action = String(data.action || "").trim();

    if (action === "springboard_animation") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      void sanitized;
    }

    if (action === "entrance_pass") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      if (sanitized) {
        const rawDirection = Number(data.walk_direction);
        sanitized.walk_direction = Number.isFinite(rawDirection) && rawDirection < 0 ? -1 : 1;
      }
      void sanitized;
    }

    if (action === "entrance_gate_move" || action === "world_lock_move" || action === "door_move") {
      const x = Number(data.x);
      const y = Number(data.y);
      const oldX = Number(data.old_x);
      const oldY = Number(data.old_y);
      if (![x, y, oldX, oldY].every(Number.isFinite)) return null;
      const gridX = Math.trunc(x);
      const gridY = Math.trunc(y);
      const oldGridX = Math.trunc(oldX);
      const oldGridY = Math.trunc(oldY);
      if (!config.isGridInWorld(gridX, gridY) || !config.isGridInWorld(oldGridX, oldGridY)) return null;

      const sanitized = {
        type: "world_interaction_update",
        world: cleanWorld(worldName),
        action,
        x: gridX,
        y: gridY,
        old_x: oldGridX,
        old_y: oldGridY,
      };
      return sanitized;
    }

    if (action === "wooden_entrance_state") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      if (!sanitized) return null;
      sanitized.locked = Boolean(data.locked);
      return sanitized;
    }

    if (action === "door_state") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      if (!sanitized) return null;
      const parsedDestination = config.parseDoorDestination(data.destination || data.door_destination || "", worldName);

      sanitized.door_id = config.cleanDoorId(data.door_id || "");
      sanitized.destination = parsedDestination.destination;
      sanitized.target_world = parsedDestination.target_world;
      sanitized.target_door_id = parsedDestination.target_door_id;
      sanitized.locked = Boolean(data.locked);
      sanitized.password_changed = Boolean(data.password_changed);
      sanitized.password = config.cleanDoorPassword(data.password || "");
      if (hasOwn(data, "door_name") || hasOwn(data, "name")) {
        sanitized.door_name = config.cleanDoorName(data.door_name || data.name || "");
      }
      return sanitized;
    }

    if (action === "ceiling_lamp_state") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      if (!sanitized) return null;
      sanitized.on = Boolean(data.on);
      return sanitized;
    }

    if (action === "sign_text") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      if (!sanitized) return null;
      sanitized.text = String(data.text || "").slice(0, config.maxSignTextLength);
      return sanitized;
    }

    if (action === "mailbox_state") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      if (!sanitized) return null;
      sanitized.operation = clampString(data.operation || "").toLowerCase();
      sanitized.message = String(data.message || "").trim().slice(0, config.maxMailboxMessageLength);
      return sanitized;
    }

    if (action === "bulletin_board_state") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      if (!sanitized) return null;
      sanitized.operation = clampString(data.operation || "").toLowerCase();
      sanitized.message = String(data.message || "").trim().slice(0, config.maxBulletinBoardMessageLength);
      return sanitized;
    }

    if (action === "tackle_box_state" || action === "chicken_state" || action === "cow_state" || action === "duck_state") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      if (!sanitized) return null;
      sanitized.operation = clampString(data.operation || "harvest").toLowerCase();
      return sanitized;
    }

    if (action === "dice_roll" || action === "checkpoint_activate") {
      return sanitizeInteractionGridAction(data, worldName, action);
    }

    if (action === "anti_punch_state" || action === "anti_talk_state" || action === "anti_gravity_state") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      if (!sanitized) return null;
      sanitized.enabled = Boolean(data.enabled);
      return sanitized;
    }

    if (action === "theme_machine_state") {
      const sanitized = sanitizeInteractionGridAction(data, worldName, action);
      if (!sanitized) return null;
      sanitized.enabled = Boolean(data.enabled);
      sanitized.theme = sanitizeWorldBackgroundTheme(data.theme || "");
      return sanitized;
    }

    if (action === "world_lock_state") {
      const state = isRecord(data.state) ? data.state : {};
      return {
        type: "world_interaction_update",
        world: cleanWorld(worldName),
        action,
        state: config.sanitizeWorldLockState(state),
      };
    }

    if (action === "area_lock_state") {
      const state = isRecord(data.state) ? data.state : {};
      return {
        type: "world_interaction_update",
        world: cleanWorld(worldName),
        action,
        state: config.sanitizeAreaLockState(state),
      };
    }

    return null;
  }

  function getStateMap(state: JsonRecord, field: string): Map<unknown, unknown> {
    if (state[field] instanceof Map) return state[field];
    const map = new Map<unknown, unknown>();
    state[field] = map;
    return map;
  }

  function interactionKey(update: JsonRecord): string {
    return gridKey(update.x, update.y);
  }

  function getEmbeddedInteractionState(update: JsonRecord): JsonRecord {
    return isRecord(update.state) ? update.state : update;
  }

  function applyInteractionUpdateToWorldState(worldName: unknown, update: JsonRecord): void {
    const state = config.ensureWorldState(worldName);
    const interactions = getStateMap(state, "interactions");

    if (update.action === "wooden_entrance_state") {
      interactions.set(interactionKey(update), {
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
      const foreground = getStateMap(state, "foreground");
      const rawBlock = foreground.get(key);
      const block = isRecord(rawBlock) ? rawBlock : {};
      const rawExisting = interactions.get(key);
      const existing = isRecord(rawExisting) ? rawExisting : {};
      const blockType = clampString(update.block_type || block.block_type || "");
      const passwordDoor = config.isPasswordDoorBlockType(blockType);
      const existingPassword = config.cleanDoorPassword(existing.password || existing.door_password || "");
      const existingDoorName = config.cleanDoorName(existing.door_name || existing.name || block.door_name || block.name || "");
      const nextDoorName = hasOwn(update, "door_name") || hasOwn(update, "name")
        ? config.cleanDoorName(update.door_name || update.name || "")
        : existingDoorName;
      const nextPassword = passwordDoor
        ? (hasOwn(update, "password") ? config.cleanDoorPassword(update.password || "") : existingPassword)
        : "";
      const hasDoorLink =
        config.cleanDoorId(update.door_id || "") !== "" ||
        config.cleanDoorDestination(update.destination || "") !== "" ||
        config.cleanDoorId(update.target_door_id || "") !== "";
      const keepLocked = config.isDoorBlockType(block.block_type || "") && Boolean(update.locked);
      const hasPassword = passwordDoor && nextPassword !== "";
      const hasDoorName = nextDoorName !== "";

      if (!hasDoorLink && !keepLocked && !hasPassword && !hasDoorName) {
        interactions.delete(key);
        return;
      }

      const entry: JsonRecord = {
        action: update.action,
        x: update.x,
        y: update.y,
        locked: Boolean(update.locked),
        world: cleanWorld(worldName),
        block_type: blockType,
        door_id: config.cleanDoorId(update.door_id || ""),
        destination: config.cleanDoorDestination(update.destination || ""),
        target_world: cleanWorld(update.target_world || worldName),
        target_door_id: config.cleanDoorId(update.target_door_id || ""),
      };
      if (hasDoorName) {
        entry.door_name = nextDoorName;
      }
      if (hasPassword) {
        entry.password = nextPassword;
      }
      interactions.set(key, entry);
      return;
    }

    if (update.action === "ceiling_lamp_state") {
      interactions.set(interactionKey(update), {
        action: update.action,
        x: update.x,
        y: update.y,
        on: Boolean(update.on),
        world: cleanWorld(worldName),
      });
      return;
    }

    if (update.action === "sign_text") {
      interactions.set(interactionKey(update), {
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
      return;
    }

    if (update.action === "area_lock_state") {
      state.area_locks = config.sanitizeAreaLocksList(isRecord(update.state) ? (update.state.area_locks || update.state) : (update.state || []));
      return;
    }

    if (update.action === "mailbox_state") {
      interactions.set(interactionKey(update), sanitizeMailboxState(getEmbeddedInteractionState(update), worldName, update.x, update.y));
      return;
    }

    if (update.action === "bulletin_board_state") {
      interactions.set(interactionKey(update), sanitizeBulletinBoardState(getEmbeddedInteractionState(update), worldName, update.x, update.y));
      return;
    }

    if (update.action === "tackle_box_state") {
      interactions.set(interactionKey(update), sanitizeTackleBoxState(getEmbeddedInteractionState(update), worldName, update.x, update.y));
      return;
    }

    if (update.action === "chicken_state") {
      interactions.set(interactionKey(update), sanitizeChickenState(getEmbeddedInteractionState(update), worldName, update.x, update.y));
      return;
    }

    if (update.action === "cow_state") {
      interactions.set(interactionKey(update), sanitizeCowState(getEmbeddedInteractionState(update), worldName, update.x, update.y));
      return;
    }

    if (update.action === "duck_state") {
      interactions.set(interactionKey(update), sanitizeDuckState(getEmbeddedInteractionState(update), worldName, update.x, update.y));
      return;
    }

    if (update.action === "dice_roll") {
      interactions.set(interactionKey(update), sanitizeDiceState(getEmbeddedInteractionState(update), worldName, update.x, update.y));
      return;
    }

    if (update.action === "anti_punch_state") {
      if (update.enabled) {
        interactions.set(interactionKey(update), sanitizeAntiPunchState(update, worldName, update.x, update.y));
      } else {
        interactions.delete(interactionKey(update));
      }
      return;
    }

    if (update.action === "anti_talk_state") {
      if (update.enabled) {
        interactions.set(interactionKey(update), sanitizeAntiTalkState(update, worldName, update.x, update.y));
      } else {
        interactions.delete(interactionKey(update));
      }
      return;
    }

    if (update.action === "anti_gravity_state") {
      if (update.enabled) {
        interactions.set(interactionKey(update), sanitizeAntiGravityState(update, worldName, update.x, update.y));
      } else {
        interactions.delete(interactionKey(update));
      }
      return;
    }

    if (update.action === "theme_machine_state") {
      if (update.enabled) {
        interactions.set(interactionKey(update), {
          action: update.action,
          x: update.x,
          y: update.y,
          enabled: true,
          theme: sanitizeWorldBackgroundTheme(update.theme || "night") || "night",
          world: cleanWorld(worldName),
        });
      } else {
        interactions.delete(interactionKey(update));
      }
      return;
    }

    if (update.action === "oil_refinery_state") {
      interactions.set(interactionKey(update), sanitizeOilRefineryState(update, worldName, update.x, update.y));
      return;
    }

    if (update.action === "battery_charger_state") {
      interactions.set(interactionKey(update), sanitizeBatteryChargerState(update, worldName, update.x, update.y));
      return;
    }

    if (update.action === "display_state") {
      interactions.set(interactionKey(update), sanitizeDisplayState(getEmbeddedInteractionState(update), worldName, update.x, update.y));
    }
  }

  function loadInteractionsIntoMap(target: Map<unknown, unknown>, rawEntries: unknown, worldName: unknown = ""): void {
    if (!Array.isArray(rawEntries)) return;

    for (const rawEntry of rawEntries) {
      if (!isRecord(rawEntry)) continue;

      const action = String(rawEntry.action || "").trim();
      const grid = normalizeGrid(rawEntry);
      if (!grid) continue;
      const key = gridKey(grid.x, grid.y);

      if (action === "wooden_entrance_state") {
        target.set(key, {
          action,
          x: grid.x,
          y: grid.y,
          locked: Boolean(rawEntry.locked),
          world: cleanWorld(rawEntry.world || ""),
        });
      } else if (action === "door_state") {
        const parsedDestination = config.parseDoorDestination(rawEntry.destination || rawEntry.door_destination || "", rawEntry.world || worldName);
        target.set(key, {
          action,
          x: grid.x,
          y: grid.y,
          locked: Boolean(rawEntry.locked),
          world: cleanWorld(rawEntry.world || worldName),
          door_id: config.cleanDoorId(rawEntry.door_id || ""),
          door_name: config.cleanDoorName(rawEntry.door_name || rawEntry.name || ""),
          destination: parsedDestination.destination,
          target_world: cleanWorld(rawEntry.target_world || rawEntry.door_target_world || parsedDestination.target_world),
          target_door_id: config.cleanDoorId(rawEntry.target_door_id || rawEntry.door_target_id || parsedDestination.target_door_id),
          password: config.cleanDoorPassword(rawEntry.password || rawEntry.door_password || ""),
        });
      } else if (action === "ceiling_lamp_state") {
        target.set(key, {
          action,
          x: grid.x,
          y: grid.y,
          on: Boolean(rawEntry.on ?? rawEntry.toggle_on),
          world: cleanWorld(rawEntry.world || ""),
        });
      } else if (action === "sign_text") {
        target.set(key, {
          action,
          x: grid.x,
          y: grid.y,
          text: String(rawEntry.text || rawEntry.sign_text || "").slice(0, config.maxSignTextLength),
          world: cleanWorld(rawEntry.world || ""),
        });
      } else if (action === "vend_state") {
        target.set(key, sanitizeVendState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "safe_state") {
        target.set(key, sanitizeSafeState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "mailbox_state") {
        target.set(key, sanitizeMailboxState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "bulletin_board_state") {
        target.set(key, sanitizeBulletinBoardState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "display_state") {
        target.set(key, sanitizeDisplayState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "tackle_box_state") {
        target.set(key, sanitizeTackleBoxState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "chicken_state") {
        target.set(key, sanitizeChickenState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "cow_state") {
        target.set(key, sanitizeCowState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "duck_state") {
        target.set(key, sanitizeDuckState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "dice_roll") {
        target.set(key, sanitizeDiceState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "anti_punch_state") {
        const antiPunchState = sanitizeAntiPunchState(rawEntry, rawEntry.world || worldName, grid.x, grid.y);
        if (antiPunchState.enabled) {
          target.set(key, antiPunchState);
        }
      } else if (action === "anti_talk_state") {
        const antiTalkState = sanitizeAntiTalkState(rawEntry, rawEntry.world || worldName, grid.x, grid.y);
        if (antiTalkState.enabled) {
          target.set(key, antiTalkState);
        }
      } else if (action === "anti_gravity_state") {
        const antiGravityState = sanitizeAntiGravityState(rawEntry, rawEntry.world || worldName, grid.x, grid.y);
        if (antiGravityState.enabled) {
          target.set(key, antiGravityState);
        }
      } else if (action === "theme_machine_state") {
        const theme = sanitizeWorldBackgroundTheme(rawEntry.theme || "night") || "night";
        if (Boolean(rawEntry.enabled)) {
          target.set(key, {
            action,
            x: grid.x,
            y: grid.y,
            enabled: true,
            theme,
            world: cleanWorld(rawEntry.world || worldName),
          });
        }
      } else if (action === "oil_refinery_state") {
        target.set(key, sanitizeOilRefineryState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      } else if (action === "battery_charger_state") {
        target.set(key, sanitizeBatteryChargerState(rawEntry, rawEntry.world || worldName, grid.x, grid.y));
      }
    }
  }

  function loadDropsIntoMap(target: Map<unknown, unknown>, rawEntries: unknown): void {
    if (!Array.isArray(rawEntries)) return;

    for (const rawEntry of rawEntries) {
      if (!isRecord(rawEntry)) continue;

      const dropId = clampString(rawEntry.drop_id || "", config.maxDropIdLength);
      if (dropId.length === 0) continue;

      const itemType = clampString(rawEntry.item_type || rawEntry.type || "");
      if (itemType.length === 0) continue;
      if (!itemDatabase.hasItem(itemType)) continue;

      const x = Number(rawEntry.x);
      const y = Number(rawEntry.y);
      if (!config.isPositionInWorldBounds(x, y)) continue;

      const itemCategory = resolveInventoryCategory(itemType, rawEntry.item_category || "");
      if (!itemDatabase.canStoreItemInCategory(itemType, itemCategory)) continue;

      target.set(dropId, {
        drop_id: dropId,
        item_type: itemType,
        item_category: itemCategory,
        is_seed: itemCategory === "seed",
        amount: clampInteger(rawEntry.amount || 1, 1, config.maxDropTileAmount),
        x,
        y,
        stack_grid_x: Number.isFinite(Number(rawEntry.stack_grid_x)) ? Math.trunc(Number(rawEntry.stack_grid_x)) : undefined,
        stack_grid_y: Number.isFinite(Number(rawEntry.stack_grid_y)) ? Math.trunc(Number(rawEntry.stack_grid_y)) : undefined,
        pickup_delay: Math.max(0, Number(rawEntry.pickup_delay) || 0),
      });
    }
  }

  function sanitizeDropCreate(data: JsonRecord, worldName: unknown): JsonRecord | null {
    const itemType = clampString(data.item_type || data.type_id || data.item || "");
    if (itemType.length === 0) return null;
    if (!itemDatabase.hasItem(itemType)) return null;
    if (!itemDatabase.isDropableItem(itemType)) return null;

    const x = Number(data.x);
    const y = Number(data.y);
    if (!config.isPositionInWorldBounds(x, y)) return null;
    const stackGrid = config.getTransactionDropGrid(data, { x, y });

    const itemCategory = resolveInventoryCategory(itemType, data.item_category || "");
    if (!itemDatabase.canStoreItemInCategory(itemType, itemCategory)) return null;

    return dropContracts.buildSanitizedDropCreate({
      world: cleanWorld(worldName),
      dropId: config.makeServerDropId(worldName, itemType),
      itemType,
      itemCategory,
      isSeed: itemCategory === "seed",
      amount: clampInteger(data.amount || 1, 1, config.maxDropTileAmount),
      x,
      y,
      stackGrid,
      pickupDelay: Math.max(0, Number(data.pickup_delay) || 0),
    });
  }

  function sanitizeDropUpdate(data: JsonRecord, worldName: unknown): JsonRecord | null {
    const dropId = clampString(data.drop_id || "", config.maxDropIdLength);
    if (dropId.length === 0) return null;

    const update: JsonRecord = {
      world: cleanWorld(worldName),
      dropId,
    };

    if (hasOwn(data, "amount")) {
      update.amount = clampInteger(data.amount || 0, 0, config.maxDropTileAmount);
    }

    const x = Number(data.x);
    const y = Number(data.y);
    if (config.isPositionInWorldBounds(x, y)) {
      update.x = x;
      update.y = y;
    }

    return dropContracts.buildSanitizedDropUpdate(update);
  }

  function sanitizeDropPickup(data: JsonRecord, worldName: unknown, player: JsonRecord): JsonRecord | null {
    const dropId = clampString(data.drop_id || "", config.maxDropIdLength);
    if (dropId.length === 0) return null;
    const actionPosition = config.sanitizeOptionalDropPickupPosition(data, player, worldName);
    const requestedWorld = cleanWorld(data.world || data.world_name || data.current_world_id || worldName);

    return dropContracts.buildSanitizedDropPickup({
      world: cleanWorld(worldName),
      requestedWorld,
      dropId,
      playerId: player.id,
      name: cleanName(player.name),
      actionPosition,
    });
  }

  function cleanDropIdList(rawIds: unknown, maxIds = config.maxBulkDropPickupIds): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    if (!Array.isArray(rawIds)) return result;
    for (const rawId of rawIds) {
      const cleanId = clampString(rawId || "", config.maxDropIdLength);
      if (cleanId === "" || seen.has(cleanId)) continue;
      seen.add(cleanId);
      result.push(cleanId);
      if (result.length >= maxIds) break;
    }
    return result;
  }

  function getDropStackGridFromDrop(drop: unknown): GridPosition | null {
    if (!isRecord(drop)) return null;
    const stackGridX = Number(drop.stack_grid_x);
    const stackGridY = Number(drop.stack_grid_y);
    if (Number.isFinite(stackGridX) && Number.isFinite(stackGridY)) {
      const gridX = Math.trunc(stackGridX);
      const gridY = Math.trunc(stackGridY);
      if (config.isGridInWorld(gridX, gridY)) return { x: gridX, y: gridY };
    }
    return config.getDropGridFromPosition(drop);
  }

  function appendSameTileBulkDropIds(targetIds: string[], worldName: unknown, stackGrid: GridPosition | null): string[] {
    if (!stackGrid || !config.isGridInWorld(stackGrid.x, stackGrid.y)) return targetIds;
    const state = config.ensureWorldState(worldName);
    const seen = new Set(targetIds);
    const drops = state.drops instanceof Map ? state.drops : new Map();
    for (const [candidateKey, candidateDrop] of drops.entries()) {
      const candidateRecord = isRecord(candidateDrop) ? candidateDrop : {};
      const candidateAmount = clampInteger(candidateRecord.amount || 0, 0, config.maxDropTileAmount);
      const candidateStatus = String(candidateRecord.status || "active").trim().toLowerCase();
      if (candidateAmount <= 0 || candidateStatus !== "active") continue;
      const candidateGrid = getDropStackGridFromDrop(candidateRecord);
      if (!candidateGrid || candidateGrid.x !== stackGrid.x || candidateGrid.y !== stackGrid.y) continue;
      const candidateDropId = clampString(candidateRecord.drop_id || candidateKey || "", config.maxDropIdLength);
      if (candidateDropId === "" || seen.has(candidateDropId)) continue;
      seen.add(candidateDropId);
      targetIds.push(candidateDropId);
      if (targetIds.length >= config.maxBulkDropPickupIds) break;
    }
    return targetIds;
  }

  function sanitizeBulkDropPickup(data: JsonRecord, worldName: unknown, player: JsonRecord): JsonRecord | null {
    const primaryDropId = clampString(data.drop_id || "", config.maxDropIdLength);
    const requestedWorld = cleanWorld(data.world || data.world_name || data.current_world_id || worldName);
    const actionPosition = config.sanitizeOptionalDropPickupPosition(data, player, worldName);
    const resolvedWorld = config.resolveDropPickupWorldName(worldName, {
      drop_id: primaryDropId,
      requested_world: requestedWorld,
    });

    const dropIds = cleanDropIdList(data.drop_ids, config.maxBulkDropPickupIds);
    if (primaryDropId !== "" && !dropIds.includes(primaryDropId)) {
      dropIds.unshift(primaryDropId);
    }

    const sameTile = packetContracts.isSameTileBulkDropPickupRequested(data);
    if (sameTile) {
      let stackGrid =
        config.getTransactionGrid(data, "stack_grid_x", "stack_grid_y") ||
        config.getTransactionGrid(data, "grid_x", "grid_y") ||
        config.getTransactionGrid(data, "tile_x", "tile_y");
      if (!stackGrid && primaryDropId !== "") {
        const state = config.ensureWorldState(resolvedWorld);
        const drops = state.drops instanceof Map ? state.drops : new Map();
        const primaryDrop = drops.get(primaryDropId) || drops.get(String(primaryDropId));
        stackGrid = getDropStackGridFromDrop(primaryDrop);
      }
      appendSameTileBulkDropIds(dropIds, resolvedWorld, stackGrid);
    }

    const cleanIds = cleanDropIdList(dropIds, config.maxBulkDropPickupIds);
    if (cleanIds.length === 0) return null;
    return dropContracts.buildSanitizedBulkDropPickup({
      world: cleanWorld(resolvedWorld || worldName),
      requestedWorld,
      dropId: cleanIds[0],
      dropIds: cleanIds,
      playerId: player.id,
      name: cleanName(player.name),
      actionPosition,
    });
  }

  function serializeWorldState(worldName: unknown): JsonRecord {
    const state = config.ensureWorldState(worldName);

    return {
      world_state_version: 1,
      world_generation_version: clampInteger(
        state.world_generation_version || legacyWorldGenerationVersion,
        legacyWorldGenerationVersion,
        currentWorldGenerationVersion
      ),
      world_name: cleanWorld(worldName),
      saved_at: new Date().toISOString(),
      cleared: Boolean(state.cleared),
      blocks: config.getForegroundBlocksForState(state, worldName),
      background_blocks: Array.from((state.background instanceof Map ? state.background : new Map()).values()),
      removed_foreground: state.cleared ? [] : Array.from((state.removed_foreground instanceof Map ? state.removed_foreground : new Map()).values()),
      removed_background: state.cleared ? [] : Array.from((state.removed_background instanceof Map ? state.removed_background : new Map()).values()),
      seeds: Array.from((state.seeds instanceof Map ? state.seeds : new Map()).values()).map(config.serializeSeedForMessage),
      electrical_layer: config.getElectricalLayerForSave(state),
      electrical_devices: config.getElectricalDevicesForSave(state),
      interactions: Array.from((state.interactions instanceof Map ? state.interactions : new Map()).values()),
      background_theme: config.getActiveWorldBackgroundTheme(state),
      world_lock: config.getEffectiveWorldLockStateInState(state),
      area_locks: config.sanitizeAreaLocksList(state.area_locks || []),
      cctv_state: config.sanitizeCctvWorldState(state.cctv_state || {}, worldName),
      drops: Array.from((state.drops instanceof Map ? state.drops : new Map()).values()),
      active_event_type: state.active_event_type || "",
      event_id: state.event_id || "",
      event_started_at: state.event_started_at || "",
      event_ends_at: state.event_ends_at || "",
      event_changed_tiles: Array.isArray(state.event_changed_tiles) ? state.event_changed_tiles.map((entry: JsonRecord) => ({ ...entry })) : [],
      active_event: config.buildActiveWorldEventSnapshot(state),
    };
  }

  return {
    addBedrockFloorEntries,
    applyInteractionUpdateToWorldState,
    cleanDropIdList,
    createEmptyWorldState,
    deserializeWorldState,
    getDropStackGridFromDrop,
    loadDropsIntoMap,
    loadElectricalDataIntoState,
    loadGridArrayIntoMap,
    loadInteractionsIntoMap,
    loadSavedWorldGridData,
    loadWorldEventStateIntoState,
    normalizeBlockEntry,
    normalizeElectricalEntry,
    normalizeElectricalDeviceStateEntry,
    normalizeEventTimestamp,
    normalizeRemovedBlockEntry,
    normalizeSeedEntry,
    normalizeWorldEventTileEntry,
    sanitizeBulletinBoardMessage,
    sanitizeBulletinBoardState,
    sanitizeBlockUpdate,
    sanitizeBulkDropPickup,
    sanitizeAntiGravityState,
    sanitizeAntiPunchState,
    sanitizeAntiTalkState,
    sanitizeBatteryChargerState,
    sanitizeChickenState,
    sanitizeCowState,
    sanitizeDiceState,
    sanitizeDisplaySlot,
    sanitizeDisplayState,
    sanitizeDropCreate,
    sanitizeDropPickup,
    sanitizeDropUpdate,
    sanitizeDuckState,
    sanitizeElectricalLayerUpdate,
    sanitizeInteractionUpdate,
    sanitizeMailboxMessage,
    sanitizeMailboxState,
    sanitizeOilRefineryState,
    sanitizeSafeSlot,
    sanitizeSafeState,
    sanitizeTackleBoxState,
    sanitizeVendListing,
    sanitizeVendLogEntry,
    sanitizeVendState,
    sanitizeWorldBackgroundTheme,
    serializeWorldState,
  };
}

export = {
  createWorldStateHelpers,
};
