// Generated from src/server_player_state_helpers.ts. Do not edit by hand.
"use strict";
const EQUIPMENT_STATE_FIELDS_BY_SLOT = Object.freeze({
    hand: "equipped_tool",
    back: "equipped_back_item",
    hat: "equipped_hat_item",
    hair: "equipped_hair_item",
    eyewear: "equipped_eyewear_item",
    shirt: "equipped_shirt_item",
    pants: "equipped_pants_item",
    shoes: "equipped_shoes_item",
    ride: "equipped_ride_item",
});
const EQUIPMENT_SLOT_COMPARISON_ORDER = Object.freeze([
    "hand", "back", "hat", "hair", "eyewear", "shirt", "pants", "shoes", "ride",
    "head", "eyes", "face", "legs", "feet", "neck", "aura",
]);
const ALLOWED_EQUIPMENT_SLOTS = Object.freeze([
    "hand", "back", "hat", "hair", "eyewear", "head", "eyes", "face",
    "shirt", "pants", "legs", "feet", "shoes", "ride",
    "neck", "aura",
]);
const INVENTORY_FIELDS = Object.freeze([
    { field: "inventory", category: "block" },
    { field: "seed_inventory", category: "seed" },
    { field: "tool_inventory", category: "tool" },
    { field: "back_inventory", category: "back" },
    { field: "hat_inventory", category: "hat" },
    { field: "hair_inventory", category: "hair" },
    { field: "eyewear_inventory", category: "eyewear" },
    { field: "shirt_inventory", category: "shirt" },
    { field: "pants_inventory", category: "pants" },
    { field: "shoes_inventory", category: "shoes" },
    { field: "ride_inventory", category: "ride" },
    { field: "currency_inventory", category: "currency" },
    { field: "material_inventory", category: "material" },
    { field: "lure_inventory", category: "lure" },
    { field: "fish_inventory", category: "fish" },
]);
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function createPlayerStateHelpers(config) {
    const itemDatabase = config.itemDatabase;
    const cleanAccountName = config.cleanAccountName;
    const clampInteger = config.clampInteger;
    const clampString = config.clampString;
    const maxProfileBioLength = Math.max(1, Math.trunc(Number(config.maxProfileBioLength) || 160));
    function cleanInventoryCategory(value) {
        return itemDatabase.cleanCategory(value);
    }
    function resolveInventoryCategory(itemId, requestedCategory = "") {
        return itemDatabase.resolveItemCategory(itemId, requestedCategory);
    }
    function getInventoryFieldForCategory(category, itemId) {
        return itemDatabase.getInventoryFieldForItem(itemId, cleanInventoryCategory(category)) || "inventory";
    }
    function getXpNeededForLevel(level) {
        const safeLevel = clampInteger(Number(level) || config.playerLevelMin, config.playerLevelMin, config.playerLevelMax);
        if (safeLevel >= config.playerLevelMax)
            return 0;
        const levelIndex = safeLevel - config.playerLevelMin;
        return config.playerXpFirstLevel + (levelIndex * 120) + Math.floor(Math.pow(levelIndex, 1.6) * 42);
    }
    function getCumulativeXpAtLevel(level) {
        const safeLevel = clampInteger(Number(level) || config.playerLevelMin, config.playerLevelMin, config.playerLevelMax);
        let total = 0;
        for (let currentLevel = config.playerLevelMin; currentLevel < safeLevel; currentLevel += 1) {
            total += getXpNeededForLevel(currentLevel);
        }
        return total;
    }
    function getPlayerTitleForLevel(level) {
        const safeLevel = clampInteger(Number(level) || config.playerLevelMin, config.playerLevelMin, config.playerLevelMax);
        if (safeLevel >= 100)
            return "Pixel Legend";
        if (safeLevel >= 80)
            return "Worldsmith";
        if (safeLevel >= 60)
            return "Architect";
        if (safeLevel >= 40)
            return "Trailblazer";
        if (safeLevel >= 25)
            return "Crafter";
        if (safeLevel >= 10)
            return "Builder";
        return "Explorer";
    }
    function normalizeProgressionState(rawState = {}) {
        const source = isRecord(rawState) ? rawState : {};
        let level = clampInteger(source.player_level || source.level || config.playerLevelMin, config.playerLevelMin, config.playerLevelMax);
        let xp = clampInteger(source.player_xp || source.xp || 0, 0, Number.MAX_SAFE_INTEGER);
        let totalXp = clampInteger(source.player_total_xp || source.total_xp || 0, 0, Number.MAX_SAFE_INTEGER);
        if (totalXp <= 0 && (level > config.playerLevelMin || xp > 0)) {
            totalXp = getCumulativeXpAtLevel(level) + xp;
        }
        while (level < config.playerLevelMax) {
            const needed = getXpNeededForLevel(level);
            if (needed <= 0 || xp < needed)
                break;
            xp -= needed;
            level += 1;
        }
        if (level >= config.playerLevelMax) {
            level = config.playerLevelMax;
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
        if (!isRecord(state))
            return state;
        const safeProgression = normalizeProgressionState(progression || state);
        state.player_level = safeProgression.player_level;
        state.player_xp = safeProgression.player_xp;
        state.player_xp_needed = safeProgression.player_xp_needed;
        state.player_total_xp = safeProgression.player_total_xp;
        state.player_title = safeProgression.player_title;
        return state;
    }
    function sanitizePrimaryHotbarTool(value) {
        const clean = clampString(value || "");
        return clean === "wrench" ? "wrench" : "punch";
    }
    function getInventoryCount(state, itemId, itemCategory = "") {
        if (!isRecord(state))
            return 0;
        const cleanItemId = clampString(itemId || "");
        if (!itemDatabase.hasItem(cleanItemId))
            return 0;
        const resolvedCategory = resolveInventoryCategory(cleanItemId, String(itemCategory || ""));
        const inventoryField = getInventoryFieldForCategory(resolvedCategory, cleanItemId);
        const inventory = state[inventoryField];
        if (!isRecord(inventory))
            return 0;
        return clampInteger(inventory[cleanItemId] || 0, 0, itemDatabase.getStackLimit(cleanItemId));
    }
    function getInventoryOccupiedSlotCount(state) {
        if (!isRecord(state))
            return 0;
        let occupiedSlots = 0;
        for (const spec of INVENTORY_FIELDS) {
            if (spec.category === "currency")
                continue;
            const inventory = state[spec.field];
            if (!isRecord(inventory))
                continue;
            for (const [rawItemId, rawCount] of Object.entries(inventory)) {
                const itemId = clampString(rawItemId || "");
                if (itemId === "" || !itemDatabase.hasItem(itemId))
                    continue;
                const definition = itemDatabase.getItemDefinition(itemId) || {};
                if (definition.hidden === true)
                    continue;
                const resolvedCategory = resolveInventoryCategory(itemId, spec.category);
                if (resolvedCategory !== spec.category)
                    continue;
                if (!itemDatabase.canStoreItemInCategory(itemId, resolvedCategory))
                    continue;
                const count = clampInteger(rawCount || 0, 0, itemDatabase.getStackLimit(itemId));
                if (count > 0)
                    occupiedSlots += 1;
            }
        }
        return occupiedSlots;
    }
    function canRestoreReservedInventorySlot(state, sourceOccupiedSlots) {
        if (!isRecord(state))
            return false;
        const occupiedSlots = getInventoryOccupiedSlotCount(state);
        const reservedCeiling = clampInteger(sourceOccupiedSlots, 0, config.maxPlayerInventoryKeys);
        const allowedOccupiedSlots = Math.max(resolveInventorySlotCount(state), reservedCeiling);
        return occupiedSlots + 1 <= allowedOccupiedSlots;
    }
    function isServerHotbarItemAllowed(state, itemId, itemCategory = "", options = {}) {
        const cleanItemId = clampString(itemId || "");
        if (cleanItemId === "")
            return false;
        const cleanCategory = cleanInventoryCategory(itemCategory || "");
        if (cleanItemId === "punch" && cleanCategory === "tool")
            return true;
        if (!itemDatabase.hasItem(cleanItemId))
            return false;
        const resolvedCategory = resolveInventoryCategory(cleanItemId, cleanCategory);
        if (resolvedCategory === "")
            return false;
        if (!itemDatabase.canStoreItemInCategory(cleanItemId, resolvedCategory))
            return false;
        const definition = itemDatabase.getItemDefinition(cleanItemId) || {};
        if (definition.hidden)
            return false;
        if (options.allowEmptyCount === true)
            return true;
        return getInventoryCount(state, cleanItemId, resolvedCategory) > 0;
    }
    function appendServerHotbarItem(state, items, categories, itemId, itemCategory, options = {}) {
        if (items.length >= config.hotbarSlotCount)
            return;
        const cleanItemId = clampString(itemId || "");
        if (cleanItemId === "" || cleanItemId === "punch")
            return;
        let resolvedCategory = cleanInventoryCategory(itemCategory || "");
        if (itemDatabase.hasItem(cleanItemId)) {
            resolvedCategory = resolveInventoryCategory(cleanItemId, resolvedCategory);
        }
        if (resolvedCategory === "")
            return;
        if (!isServerHotbarItemAllowed(state, cleanItemId, resolvedCategory, options))
            return;
        const key = `${resolvedCategory}:${cleanItemId}`;
        for (let i = 0; i < items.length; i += 1) {
            if (`${categories[i]}:${items[i]}` === key)
                return;
        }
        items.push(cleanItemId);
        categories.push(resolvedCategory);
    }
    function normalizePlayerHotbarState(state) {
        if (!isRecord(state))
            return state;
        const rawItems = Array.isArray(state.hotbar_items) ? state.hotbar_items : [];
        const rawCategories = Array.isArray(state.hotbar_item_categories) ? state.hotbar_item_categories : [];
        const primaryTool = sanitizePrimaryHotbarTool(state.primary_hotbar_tool || rawItems[0]);
        const items = [primaryTool];
        const categories = ["tool"];
        const savedCount = Math.min(rawItems.length, rawCategories.length, config.hotbarSlotCount);
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
        while (items.length > config.hotbarSlotCount) {
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
        if (!isRecord(state))
            return state;
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
        if (!isRecord(state))
            return {};
        const payload = {
            ...state,
            inventory_slot_count: resolveInventorySlotCount(state),
            hotbar_items: Array.isArray(state.hotbar_items) ? state.hotbar_items.slice(0, config.hotbarSlotCount) : [],
            hotbar_item_categories: Array.isArray(state.hotbar_item_categories)
                ? state.hotbar_item_categories.slice(0, config.hotbarSlotCount)
                : [],
        };
        normalizePlayerHotbarState(payload);
        if (options.selectFirstHotbarSlot === true) {
            selectFirstHotbarSlotInState(payload);
        }
        return payload;
    }
    function normalizeInventoryAmountEntry(rawEntry) {
        if (!isRecord(rawEntry))
            return null;
        const itemId = clampString(rawEntry.item_id || rawEntry.item_type || rawEntry.item || "");
        if (itemId === "" || !itemDatabase.hasItem(itemId))
            return null;
        const itemCategory = resolveInventoryCategory(itemId, String(rawEntry.item_category || rawEntry.category || ""));
        if (!itemDatabase.canStoreItemInCategory(itemId, itemCategory))
            return null;
        const amount = clampInteger(rawEntry.amount || 0, 1, itemDatabase.getStackLimit(itemId));
        return { item_id: itemId, item_category: itemCategory, amount };
    }
    function sanitizeCountDictionary(rawValue, limit = config.maxPlayerInventoryKeys, expectedCategory = "") {
        const safe = {};
        if (!isRecord(rawValue))
            return safe;
        for (const [rawKey, rawCount] of Object.entries(rawValue).slice(0, limit)) {
            const itemId = clampString(rawKey || "");
            if (itemId.length === 0)
                continue;
            if (!itemDatabase.hasItem(itemId))
                continue;
            const resolvedCategory = resolveInventoryCategory(itemId, expectedCategory);
            if (!itemDatabase.canStoreItemInCategory(itemId, resolvedCategory))
                continue;
            if (expectedCategory !== "" && resolvedCategory !== expectedCategory)
                continue;
            safe[itemId] = clampInteger(rawCount || 0, 0, itemDatabase.getStackLimit(itemId));
        }
        return safe;
    }
    function sanitizeStringArray(rawValue, limit = 32) {
        if (!Array.isArray(rawValue))
            return [];
        return rawValue.map((value) => clampString(value || "")).slice(0, limit);
    }
    function normalizeInventorySlotCount(value, fallback = config.inventoryMinSlotCount) {
        const parsed = Math.trunc(Number(value));
        const base = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : Math.trunc(Number(fallback) || config.inventoryMinSlotCount);
        const clamped = Math.max(config.inventoryMinSlotCount, Math.min(config.inventoryMaxSlotCount, base));
        if (clamped <= config.inventoryMinSlotCount)
            return config.inventoryMinSlotCount;
        const upgradeSteps = Math.ceil((clamped - config.inventoryMinSlotCount) / config.inventorySlotUpgradeStep);
        return Math.max(config.inventoryMinSlotCount, Math.min(config.inventoryMaxSlotCount, config.inventoryMinSlotCount + upgradeSteps * config.inventorySlotUpgradeStep));
    }
    function resolveInventorySlotCount(rawState, fallback = config.inventoryMinSlotCount) {
        if (!isRecord(rawState)) {
            return normalizeInventorySlotCount(fallback);
        }
        for (const key of ["inventory_slot_count", "inventory_slots", "inventory_slot_capacity", "inventory_capacity"]) {
            if (!Object.prototype.hasOwnProperty.call(rawState, key))
                continue;
            const value = rawState[key];
            if (value === null || value === undefined || value === "")
                continue;
            return normalizeInventorySlotCount(value, fallback);
        }
        return normalizeInventorySlotCount(fallback);
    }
    function getInventoryUpgradeIndexForSlotCount(slotCount) {
        const normalized = normalizeInventorySlotCount(slotCount);
        return Math.floor((normalized - config.inventoryMinSlotCount) / config.inventorySlotUpgradeStep);
    }
    function getInventoryUpgradeCostForSlotCount(slotCount) {
        const upgradeIndex = getInventoryUpgradeIndexForSlotCount(slotCount);
        if (upgradeIndex < 0 || upgradeIndex >= config.inventorySlotUpgradeCosts.length)
            return 0;
        return config.inventorySlotUpgradeCosts[upgradeIndex];
    }
    function buildInventoryUpgradePreview(slotCount) {
        const currentSlots = normalizeInventorySlotCount(slotCount);
        const nextSlots = currentSlots >= config.inventoryMaxSlotCount
            ? config.inventoryMaxSlotCount
            : normalizeInventorySlotCount(currentSlots + config.inventorySlotUpgradeStep);
        const cost = currentSlots >= config.inventoryMaxSlotCount ? 0 : getInventoryUpgradeCostForSlotCount(currentSlots);
        return {
            inventory_slot_count: currentSlots,
            current_slots: currentSlots,
            next_inventory_slot_count: nextSlots,
            next_slots: nextSlots,
            inventory_upgrade_cost: cost,
            cost,
            max_slots: config.inventoryMaxSlotCount,
            step: config.inventorySlotUpgradeStep,
        };
    }
    function sanitizePlayerState(rawState, username) {
        if (!isRecord(rawState))
            return null;
        const accountUsername = cleanAccountName(username || rawState.account_username || rawState.username || "");
        if (accountUsername === "")
            return null;
        const progression = normalizeProgressionState(rawState);
        const state = {
            player_data_version: Math.max(1, Math.trunc(Number(rawState.player_data_version) || 1)),
            account_username: accountUsername,
            profile_bio: clampString(rawState.profile_bio || "", maxProfileBioLength),
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
            inventory_slot_count: resolveInventorySlotCount(rawState),
            player_health: clampInteger(rawState.player_health || 3, 0, 100),
            equipped_tool: "",
            equipped_back_item: "",
            equipped_hat_item: "",
            equipped_hair_item: "",
            equipped_eyewear_item: "",
            equipped_shirt_item: "",
            equipped_pants_item: "",
            equipped_shoes_item: "",
            equipped_ride_item: "",
            legacy_client_inventory_imported_at: String(rawState.legacy_client_inventory_imported_at || "").slice(0, 64),
            legacy_client_inventory_import_revision: clampInteger(rawState.legacy_client_inventory_import_revision || 0, 0, 1000),
            saved_at: new Date().toISOString(),
        };
        for (const spec of INVENTORY_FIELDS) {
            state[spec.field] = sanitizeCountDictionary(rawState[spec.field], config.maxPlayerInventoryKeys, spec.category);
        }
        const equipmentSources = [
            { field: "equipped_tool", slot: "hand" },
            { field: "equipped_back_item", slot: "back" },
            { field: "equipped_hat_item", slot: "hat" },
            { field: "equipped_hair_item", slot: "hair" },
            { field: "equipped_eyewear_item", slot: "eyewear" },
            { field: "equipped_shirt_item", slot: "shirt" },
            { field: "equipped_pants_item", slot: "pants" },
            { field: "equipped_shoes_item", slot: "shoes" },
            { field: "equipped_ride_item", slot: "ride" },
        ];
        for (const spec of equipmentSources) {
            const equippedItem = clampString(rawState[spec.field] || "");
            if (doesStateOwnEquippedItem(state, equippedItem, spec.slot)) {
                state[spec.field] = equippedItem;
            }
        }
        normalizePlayerHotbarState(state);
        return state;
    }
    function createDefaultPlayerState(username) {
        const raw = { account_username: username };
        for (const spec of INVENTORY_FIELDS) {
            raw[spec.field] = {};
        }
        return sanitizePlayerState(raw, username);
    }
    function getEquipmentSlotsFromPlayerState(state) {
        const source = isRecord(state) ? state : {};
        return {
            hand: clampString(source.equipped_tool || ""),
            back: clampString(source.equipped_back_item || ""),
            hat: clampString(source.equipped_hat_item || ""),
            hair: clampString(source.equipped_hair_item || ""),
            eyewear: clampString(source.equipped_eyewear_item || ""),
            shirt: clampString(source.equipped_shirt_item || ""),
            pants: clampString(source.equipped_pants_item || ""),
            shoes: clampString(source.equipped_shoes_item || ""),
            ride: clampString(source.equipped_ride_item || ""),
        };
    }
    function getEquipmentSlotsComparisonKey(slots = {}) {
        const source = isRecord(slots) ? slots : {};
        return EQUIPMENT_SLOT_COMPARISON_ORDER
            .map((slot) => `${slot}:${clampString(source[slot] || "")}`)
            .join("|");
    }
    function isCoreVisibleEquipmentSlot(slot) {
        return slot === "hand" || slot === "back" || slot === "hat" || slot === "hair" || slot === "eyewear" ||
            slot === "shirt" || slot === "pants" || slot === "shoes" || slot === "ride";
    }
    function isItemAllowedInEquipmentSlot(itemId, slot) {
        const definition = itemDatabase.getItemDefinition(itemId);
        if (!definition || !definition.equipable)
            return false;
        const equipmentSlot = String(definition.equipment_slot || "");
        if (equipmentSlot === "")
            return false;
        if (equipmentSlot === slot)
            return true;
        return equipmentSlot === "hand" && slot === "hand";
    }
    function doesStateOwnEquippedItem(state, itemId, slot) {
        const cleanItemId = clampString(itemId || "");
        if (cleanItemId === "")
            return true;
        if (!isRecord(state))
            return false;
        const definition = itemDatabase.getItemDefinition(cleanItemId);
        if (!definition)
            return false;
        return getInventoryCount(state, cleanItemId, definition.category || "") > 0 && isItemAllowedInEquipmentSlot(cleanItemId, slot);
    }
    function sanitizeEquipmentSlots(rawSlots, state = null) {
        const safe = {};
        const sourceSlots = isRecord(rawSlots) ? rawSlots : {};
        const fallbackSlots = getEquipmentSlotsFromPlayerState(state);
        for (const slot of ALLOWED_EQUIPMENT_SLOTS) {
            const hasIncomingSlot = Object.prototype.hasOwnProperty.call(sourceSlots, slot);
            const hasSavedSlot = Object.prototype.hasOwnProperty.call(fallbackSlots, slot);
            if (!hasIncomingSlot && !hasSavedSlot)
                continue;
            let value = clampString(sourceSlots[slot] || "");
            if (value === "" && !hasIncomingSlot && isCoreVisibleEquipmentSlot(slot)) {
                value = clampString(fallbackSlots[slot] || "");
            }
            if (value.length > 0 && isItemAllowedInEquipmentSlot(value, slot) && doesStateOwnEquippedItem(state, value, slot)) {
                safe[slot] = value;
            }
            else {
                safe[slot] = "";
            }
        }
        return safe;
    }
    function clearUnavailableEquipmentInState(state) {
        if (!isRecord(state))
            return false;
        let changed = false;
        for (const [slot, field] of Object.entries(EQUIPMENT_STATE_FIELDS_BY_SLOT)) {
            const itemId = clampString(state[field] || "");
            if (itemId === "")
                continue;
            if (doesStateOwnEquippedItem(state, itemId, slot))
                continue;
            state[field] = "";
            changed = true;
        }
        return changed;
    }
    function syncPlayerEquipmentSlotsFromState(player, state) {
        if (!isRecord(player) || !isRecord(state))
            return false;
        const previousKey = getEquipmentSlotsComparisonKey(player.equipment_slots || {});
        player.equipment_slots = sanitizeEquipmentSlots(getEquipmentSlotsFromPlayerState(state), state);
        return previousKey !== getEquipmentSlotsComparisonKey(player.equipment_slots || {});
    }
    return {
        applyProgressionFieldsToState,
        buildInventoryUpgradePreview,
        buildPlayerStateForClient,
        canRestoreReservedInventorySlot,
        clearUnavailableEquipmentInState,
        createDefaultPlayerState,
        doesStateOwnEquippedItem,
        getCumulativeXpAtLevel,
        getEquipmentSlotsComparisonKey,
        getEquipmentSlotsFromPlayerState,
        getInventoryCount,
        getInventoryOccupiedSlotCount,
        getInventoryUpgradeCostForSlotCount,
        getInventoryUpgradeIndexForSlotCount,
        getPlayerTitleForLevel,
        getXpNeededForLevel,
        isCoreVisibleEquipmentSlot,
        isItemAllowedInEquipmentSlot,
        isServerHotbarItemAllowed,
        normalizeInventoryAmountEntry,
        normalizeInventorySlotCount,
        normalizePlayerHotbarState,
        normalizeProgressionState,
        resolveInventorySlotCount,
        sanitizeCountDictionary,
        sanitizeEquipmentSlots,
        sanitizePlayerState,
        sanitizePrimaryHotbarTool,
        sanitizeStringArray,
        selectFirstHotbarSlotInState,
        syncPlayerEquipmentSlotsFromState,
    };
}
module.exports = {
    createPlayerStateHelpers,
};
