const DEFAULT_STACK_LIMIT = 99999;

const CATEGORY_TO_FIELD = Object.freeze({
  block: "inventory",
  seed: "seed_inventory",
  tool: "tool_inventory",
  back: "back_inventory",
  shirt: "shirt_inventory",
  pants: "pants_inventory",
  currency: "currency_inventory",
  material: "material_inventory",
  lure: "lure_inventory",
  fish: "fish_inventory",
});

const FIELD_TO_CATEGORY = Object.freeze(Object.fromEntries(
  Object.entries(CATEGORY_TO_FIELD).map(([category, field]) => [field, category])
));

const ALLOWED_CATEGORIES = Object.freeze(Object.keys(CATEGORY_TO_FIELD));

function item(category, options = {}) {
  return {
    category,
    rarity: options.rarity || "common",
    stack_limit: Number.isFinite(options.stack_limit) ? options.stack_limit : DEFAULT_STACK_LIMIT,
    tradeable: options.tradeable ?? !options.hidden,
    dropable: options.dropable ?? !options.hidden,
    admin_grantable: options.admin_grantable ?? true,
    hidden: Boolean(options.hidden),
    equipment_slot: options.equipment_slot || "",
    gem_value: Number.isFinite(options.gem_value) ? options.gem_value : 0,
    sell_value: Number.isFinite(options.sell_value) ? options.sell_value : 0,
    shop_price: Number.isFinite(options.shop_price) ? options.shop_price : 0,
    permissions: options.permissions || {},
    ...options,
  };
}

function block(options = {}) {
  return item("block", {
    placeable: options.placeable ?? !options.hidden,
    place_layer: options.place_layer || "foreground",
    block_health: Number.isFinite(options.block_health) ? options.block_health : 3,
    breakable: options.breakable ?? !options.unbreakable,
    ...options,
  });
}

function seed(growsInto, options = {}) {
  return item("seed", {
    grows_into: growsInto,
    plantable: true,
    ...options,
  });
}

const ITEMS = Object.freeze({
  dirt: block({
    rarity: "common",
    block_health: 3,
    seed: "dirt_seed",
    drop_rules: { seed_chance: 0.05, gem_range: [0, 1] },
  }),
  grass: block({
    rarity: "common",
    block_health: 3,
    seed: "grass_seed",
    no_collision: true,
    drop_rules: { seed_chance: 0.05, gem_range: [0, 1] },
  }),
  stone: block({
    rarity: "common",
    block_health: 4,
    seed: "stone_seed",
    drop_rules: { seed_chance: 0.05, gem_range: [0, 1] },
  }),
  wood: block({
    rarity: "uncommon",
    block_health: 3,
    seed: "wood_seed",
    no_collision: true,
    drop_rules: { seed_chance: 0.04, gem_range: [0, 2] },
  }),
  leaf: block({
    rarity: "uncommon",
    block_health: 2,
    seed: "leaf_seed",
    drop_rules: { seed_chance: 0.08, gem_range: [0, 2] },
  }),
  lava: block({
    rarity: "rare",
    block_health: 4,
    seed: "lava_seed",
    drop_rules: { seed_chance: 0.03, gem_range: [1, 3] },
  }),
  sand: block({
    rarity: "common",
    block_health: 3,
    seed: "sand_seed",
    drop_rules: { seed_chance: 0.05, gem_range: [0, 1] },
  }),
  glass: block({
    rarity: "rare",
    block_health: 2,
    seed: "glass_seed",
    drop_rules: { seed_chance: 0.03, gem_range: [1, 3] },
  }),
  water: block({
    rarity: "common",
    block_health: 2,
    no_collision: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  cave_background: block({
    rarity: "common",
    block_health: 2,
    seed: "cave_background_seed",
    place_layer: "background",
    background_block: true,
    no_collision: true,
    drop_rules: { seed_chance: 0.05, gem_range: [0, 1] },
  }),
  entrance_gate: block({
    rarity: "legendary",
    block_health: 9999,
    placeable: false,
    tradeable: false,
    dropable: false,
    admin_grantable: false,
    hidden: true,
    unbreakable: true,
    breakable: false,
    no_collision: true,
    permissions: { server_generated: true },
  }),
  world_lock: block({
    rarity: "legendary",
    block_health: 8,
    seed: "",
    shop_price: 3500,
    tradeable: true,
    dropable: true,
    permissions: { owner_controls_lock: true },
  }),
  vend_empty: block({
    rarity: "epic",
    block_health: 5,
    placeable: true,
    tradeable: true,
    dropable: true,
    admin_grantable: true,
    no_collision: true,
    shop_price: 7500,
    interact_rules: { can_interact: true, interaction_message: "Open vending machine." },
  }),
  vend_pending: block({
    rarity: "epic",
    block_health: 5,
    placeable: false,
    tradeable: false,
    dropable: false,
    admin_grantable: false,
    hidden: true,
    no_collision: true,
    breakable: true,
    placement_cost: { amount: 0 },
    interact_rules: { can_interact: true, interaction_message: "Open vending machine." },
  }),
  vend_sold: block({
    rarity: "epic",
    block_health: 5,
    placeable: false,
    tradeable: false,
    dropable: false,
    admin_grantable: false,
    hidden: true,
    no_collision: true,
    breakable: true,
    placement_cost: { amount: 0 },
    interact_rules: { can_interact: true, interaction_message: "Open vending machine." },
  }),
  safe: block({
    rarity: "epic",
    block_health: 6,
    placeable: true,
    tradeable: true,
    dropable: true,
    admin_grantable: true,
    shop_price: 7500,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
    interact_rules: { can_interact: true, interaction_message: "Open safe." },
    permissions: { world_owner_only: true },
  }),
  crafting_station: block({
    rarity: "uncommon",
    block_health: 5,
    placeable: false,
    shop_price: 80,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  crafting_station_left: block({
    rarity: "uncommon",
    block_health: 5,
    hidden: true,
    tradeable: false,
    dropable: false,
    admin_grantable: false,
    placeable: true,
    placement_cost: { item_id: "crafting_station", item_category: "block", amount: 1 },
    station_part: "left",
  }),
  crafting_station_right: block({
    rarity: "uncommon",
    block_health: 5,
    hidden: true,
    tradeable: false,
    dropable: false,
    admin_grantable: false,
    placeable: true,
    placement_cost: { amount: 0 },
    station_part: "right",
    requires_left_part: true,
  }),
  furnace: block({
    rarity: "rare",
    block_health: 6,
    craft_only: true,
    drop_rules: { drops_self: true },
  }),
  wood_plank: block({
    rarity: "uncommon",
    block_health: 3,
    seed: "wood_plank_seed",
    craft_only: true,
  }),
  stone_brick: block({
    rarity: "uncommon",
    block_health: 5,
    seed: "stone_brick_seed",
    craft_only: true,
  }),
  glass_panel: block({
    rarity: "rare",
    block_health: 2,
    seed: "glass_panel_seed",
    craft_only: true,
  }),
  gem_block: block({
    rarity: "epic",
    block_health: 5,
    seed: "gem_block_seed",
    craft_only: true,
  }),
  wood_platform: block({
    rarity: "uncommon",
    block_health: 2,
    seed: "wood_platform_seed",
  }),
  wooden_door: block({
    rarity: "rare",
    block_health: 4,
    seed: "wooden_door_seed",
    craft_only: true,
  }),
  sign: block({
    rarity: "uncommon",
    block_health: 2,
    seed: "sign_seed",
    splice_only: true,
  }),

  dirt_seed: seed("dirt", { rarity: "common" }),
  grass_seed: seed("grass", { rarity: "common" }),
  stone_seed: seed("stone", { rarity: "common" }),
  wood_seed: seed("wood", { rarity: "uncommon" }),
  leaf_seed: seed("leaf", { rarity: "uncommon" }),
  lava_seed: seed("lava", { rarity: "rare" }),
  sand_seed: seed("sand", { rarity: "common" }),
  glass_seed: seed("glass", { rarity: "rare" }),
  cave_background_seed: seed("cave_background", { rarity: "common" }),
  wood_plank_seed: seed("wood_plank", { rarity: "uncommon" }),
  wood_platform_seed: seed("wood_platform", { rarity: "uncommon" }),
  wooden_door_seed: seed("wooden_door", { rarity: "rare" }),
  sign_seed: seed("sign", { rarity: "uncommon" }),
  stone_brick_seed: seed("stone_brick", { rarity: "uncommon" }),
  glass_panel_seed: seed("glass_panel", { rarity: "rare" }),
  gem_block_seed: seed("gem_block", { rarity: "epic" }),

  gem: item("currency", {
    rarity: "currency",
    stack_limit: DEFAULT_STACK_LIMIT,
  }),

  refined_stone: item("material", { rarity: "uncommon" }),
  refined_glass: item("material", { rarity: "rare" }),
  metal_scrap: item("material", { rarity: "rare" }),

  legendary_wings: item("back", {
    rarity: "legendary",
    equipment_slot: "back",
    equipable: true,
  }),

  purple_shirt: item("shirt", {
    rarity: "common",
    equipment_slot: "shirt",
    equipable: true,
    shop_price: 50,
  }),

  purple_pants: item("pants", {
    rarity: "common",
    equipment_slot: "pants",
    equipable: true,
    shop_price: 50,
  }),

  fishing_rod: item("tool", {
    rarity: "uncommon",
    equipment_slot: "hand",
    equipable: true,
    shop_price: 5000,
  }),
  sakura_sword: item("tool", {
    rarity: "legendary",
    equipment_slot: "hand",
    equipable: true,
    shop_price: 0,
  }),
  pickaxe: item("tool", {
    rarity: "rare",
    equipment_slot: "hand",
    equipable: true,
    break_power: 1,
    effective_break_power: 3,
    effective_blocks: ["stone", "glass", "lava"],
  }),
  axe: item("tool", {
    rarity: "uncommon",
    equipment_slot: "hand",
    equipable: true,
    break_power: 1,
    effective_break_power: 3,
    effective_blocks: ["wood", "leaf"],
  }),
  shovel: item("tool", {
    rarity: "uncommon",
    equipment_slot: "hand",
    equipable: true,
    break_power: 1,
    effective_break_power: 3,
    effective_blocks: ["dirt", "grass", "sand", "cave_background"],
  }),
  entrance_mover: item("tool", {
    rarity: "rare",
    consumable: true,
    shop_price: 200,
  }),
  wrench: item("tool", {
    rarity: "uncommon",
    hidden: true,
    tradeable: false,
    dropable: false,
    admin_grantable: true,
    equipment_slot: "hand",
    equipable: true,
    permissions: { interact_player_profiles: true },
  }),

  worm_lure: item("lure", { rarity: "common" }),
  shiny_lure: item("lure", { rarity: "uncommon" }),
  golden_lure: item("lure", { rarity: "rare" }),
  lure_pack: item("lure", {
    rarity: "uncommon",
    shop_price: 25,
    shop_pack: true,
  }),

  pond_fish: item("fish", { rarity: "common", sell_value: 3 }),
  bluegill: item("fish", { rarity: "uncommon", sell_value: 8 }),
  golden_carp: item("fish", { rarity: "rare", sell_value: 25 }),
  crystal_fish: item("fish", { rarity: "epic", sell_value: 75 }),
});

const STATION_RECIPES = Object.freeze({
  crafting_station: Object.freeze([
    Object.freeze({
      id: "pickaxe",
      output: Object.freeze({ item_id: "pickaxe", category: "tool", amount: 1 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "wood", category: "block", amount: 10 }),
        Object.freeze({ item_id: "stone", category: "block", amount: 5 }),
      ]),
    }),
    Object.freeze({
      id: "axe",
      output: Object.freeze({ item_id: "axe", category: "tool", amount: 1 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "wood", category: "block", amount: 8 }),
        Object.freeze({ item_id: "stone", category: "block", amount: 3 }),
      ]),
    }),
    Object.freeze({
      id: "shovel",
      output: Object.freeze({ item_id: "shovel", category: "tool", amount: 1 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "wood", category: "block", amount: 6 }),
        Object.freeze({ item_id: "stone", category: "block", amount: 2 }),
      ]),
    }),
    Object.freeze({
      id: "furnace",
      output: Object.freeze({ item_id: "furnace", category: "block", amount: 1 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "stone", category: "block", amount: 30 }),
        Object.freeze({ item_id: "lava", category: "block", amount: 3 }),
        Object.freeze({ item_id: "gem", category: "currency", amount: 5 }),
      ]),
    }),
  ]),
  furnace: Object.freeze([
    Object.freeze({
      id: "refined_stone",
      output: Object.freeze({ item_id: "refined_stone", category: "material", amount: 5 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "stone", category: "block", amount: 15 }),
        Object.freeze({ item_id: "lava", category: "block", amount: 1 }),
      ]),
    }),
    Object.freeze({
      id: "refined_glass",
      output: Object.freeze({ item_id: "refined_glass", category: "material", amount: 5 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "glass", category: "block", amount: 10 }),
        Object.freeze({ item_id: "lava", category: "block", amount: 1 }),
      ]),
    }),
    Object.freeze({
      id: "metal_scrap",
      output: Object.freeze({ item_id: "metal_scrap", category: "material", amount: 3 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "stone", category: "block", amount: 25 }),
        Object.freeze({ item_id: "lava", category: "block", amount: 2 }),
        Object.freeze({ item_id: "gem", category: "currency", amount: 2 }),
      ]),
    }),
  ]),
});

const SPLICE_RECIPES = Object.freeze({
  "wood_seed+wood_seed": "wood_plank_seed",
  "grass_seed+wood_seed": "wood_platform_seed",
  "leaf_seed+wood_seed": "wooden_door_seed",
  "stone_seed+wood_seed": "sign_seed",
  "lava_seed+stone_seed": "stone_brick_seed",
  "glass_seed+lava_seed": "gem_block_seed",
  "dirt_seed+stone_seed": "grass_seed",
  "dirt_seed+lava_seed": "wood_seed",
  "sand_seed+lava_seed": "glass_seed",
});

const FISHING_TABLES = Object.freeze({
  worm_lure: Object.freeze([
    Object.freeze({ fish_id: "pond_fish", weight: 65, difficulty: 1 }),
    Object.freeze({ fish_id: "bluegill", weight: 28, difficulty: 2 }),
    Object.freeze({ fish_id: "golden_carp", weight: 6, difficulty: 4 }),
    Object.freeze({ fish_id: "crystal_fish", weight: 1, difficulty: 6 }),
  ]),
  shiny_lure: Object.freeze([
    Object.freeze({ fish_id: "pond_fish", weight: 38, difficulty: 1 }),
    Object.freeze({ fish_id: "bluegill", weight: 42, difficulty: 2 }),
    Object.freeze({ fish_id: "golden_carp", weight: 16, difficulty: 4 }),
    Object.freeze({ fish_id: "crystal_fish", weight: 4, difficulty: 6 }),
  ]),
  golden_lure: Object.freeze([
    Object.freeze({ fish_id: "bluegill", weight: 35, difficulty: 2 }),
    Object.freeze({ fish_id: "golden_carp", weight: 50, difficulty: 4 }),
    Object.freeze({ fish_id: "crystal_fish", weight: 15, difficulty: 6 }),
  ]),
  default: Object.freeze([
    Object.freeze({ fish_id: "pond_fish", weight: 80, difficulty: 1 }),
    Object.freeze({ fish_id: "bluegill", weight: 20, difficulty: 2 }),
  ]),
});

function cloneRecipe(recipe) {
  if (!recipe) return null;
  return {
    id: recipe.id,
    output: { ...recipe.output },
    cost: recipe.cost.map((entry) => ({ ...entry })),
  };
}

function getStationRecipe(stationId, recipeId) {
  const recipes = STATION_RECIPES[String(stationId || "").trim()] || [];
  const cleanRecipeId = String(recipeId || "").trim();
  const recipe = recipes.find((entry) => entry.id === cleanRecipeId);
  return cloneRecipe(recipe);
}

function getSpliceKey(seedA, seedB) {
  const pair = [cleanItemId(seedA), cleanItemId(seedB)].sort();
  return `${pair[0]}+${pair[1]}`;
}

function getSpliceResult(seedA, seedB) {
  return SPLICE_RECIPES[getSpliceKey(seedA, seedB)] || "";
}

function getFishingTable(lureId) {
  const table = FISHING_TABLES[cleanItemId(lureId)] || FISHING_TABLES.default;
  return table.map((entry) => ({ ...entry }));
}

function cleanItemId(itemId) {
  return String(itemId || "").trim();
}

function getItemDefinition(itemId) {
  const clean = cleanItemId(itemId);
  if (clean === "") return null;
  const definition = ITEMS[clean];
  if (!definition) return null;
  return Object.freeze({ item_id: clean, ...definition });
}

function hasItem(itemId) {
  return getItemDefinition(itemId) !== null;
}

function cleanCategory(category) {
  const clean = String(category || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CATEGORY_TO_FIELD, clean) ? clean : "";
}

function resolveItemCategory(itemId, requestedCategory = "") {
  const definition = getItemDefinition(itemId);
  if (definition) return definition.category;
  return cleanCategory(requestedCategory);
}

function canStoreItemInCategory(itemId, category) {
  const definition = getItemDefinition(itemId);
  return Boolean(definition && definition.category === cleanCategory(category));
}

function getInventoryFieldForCategory(category) {
  return CATEGORY_TO_FIELD[cleanCategory(category)] || "";
}

function getInventoryFieldForItem(itemId, requestedCategory = "") {
  return getInventoryFieldForCategory(resolveItemCategory(itemId, requestedCategory));
}

function getStackLimit(itemId) {
  const definition = getItemDefinition(itemId);
  if (!definition) return DEFAULT_STACK_LIMIT;
  return Math.max(1, Math.trunc(Number(definition.stack_limit) || DEFAULT_STACK_LIMIT));
}

function isTradeableItem(itemId) {
  const definition = getItemDefinition(itemId);
  return Boolean(definition && definition.tradeable);
}

function isDropableItem(itemId) {
  const definition = getItemDefinition(itemId);
  return Boolean(definition && definition.dropable);
}

function isGrantableItem(itemId) {
  const definition = getItemDefinition(itemId);
  return Boolean(definition && definition.admin_grantable);
}

function isPlaceableBlock(itemId) {
  const definition = getItemDefinition(itemId);
  return Boolean(definition && definition.category === "block" && definition.placeable);
}

function getPlaceLayer(itemId) {
  const definition = getItemDefinition(itemId);
  if (!definition || definition.category !== "block") return "";
  return definition.place_layer === "background" ? "background" : "foreground";
}

function canBreakBlock(itemId) {
  const definition = getItemDefinition(itemId);
  if (!definition || definition.category !== "block") return true;
  return Boolean(definition.breakable);
}

function getBlockHealth(itemId) {
  const definition = getItemDefinition(itemId);
  if (!definition || definition.category !== "block") return 1;
  return Math.max(1, Math.trunc(Number(definition.block_health) || 1));
}

function getBreakPower(toolId, blockType = "") {
  const definition = getItemDefinition(toolId);
  if (!definition || definition.category !== "tool") return 1;

  const basePower = Math.max(1, Math.trunc(Number(definition.break_power) || 1));
  const effectiveBlocks = Array.isArray(definition.effective_blocks)
    ? definition.effective_blocks.map(cleanItemId)
    : [];

  if (effectiveBlocks.includes(cleanItemId(blockType))) {
    return Math.max(basePower, Math.trunc(Number(definition.effective_break_power) || basePower));
  }

  return basePower;
}

function getPlacementCost(itemId) {
  const definition = getItemDefinition(itemId);
  if (!definition || definition.category !== "block") return null;

  if (definition.placement_cost && typeof definition.placement_cost === "object") {
    const amount = Math.max(0, Math.trunc(Number(definition.placement_cost.amount) || 0));
    if (amount <= 0) return null;

    const costItemId = cleanItemId(definition.placement_cost.item_id || itemId);
    const costCategory = resolveItemCategory(costItemId, definition.placement_cost.item_category || definition.category);
    return { item_id: costItemId, item_category: costCategory, amount };
  }

  return { item_id: itemId, item_category: definition.category, amount: 1 };
}

function getStationPart(itemId) {
  const definition = getItemDefinition(itemId);
  return definition ? String(definition.station_part || "") : "";
}

function requiresLeftStationPart(itemId) {
  const definition = getItemDefinition(itemId);
  return Boolean(definition && definition.requires_left_part);
}

module.exports = {
  DEFAULT_STACK_LIMIT,
  CATEGORY_TO_FIELD,
  FIELD_TO_CATEGORY,
  ALLOWED_CATEGORIES,
  FISHING_TABLES,
  ITEMS,
  SPLICE_RECIPES,
  STATION_RECIPES,
  cleanCategory,
  resolveItemCategory,
  canStoreItemInCategory,
  getFishingTable,
  getInventoryFieldForCategory,
  getInventoryFieldForItem,
  getItemDefinition,
  getBlockHealth,
  getBreakPower,
  getPlaceLayer,
  getPlacementCost,
  getSpliceKey,
  getSpliceResult,
  getStationRecipe,
  getStackLimit,
  getStationPart,
  hasItem,
  isDropableItem,
  isGrantableItem,
  isPlaceableBlock,
  isTradeableItem,
  canBreakBlock,
  requiresLeftStationPart,
};
