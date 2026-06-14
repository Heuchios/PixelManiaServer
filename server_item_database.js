const DEFAULT_STACK_LIMIT = 200;
const GEM_CURRENCY_STACK_LIMIT = 100000000000;

const CATEGORY_TO_FIELD = Object.freeze({
  block: "inventory",
  seed: "seed_inventory",
  tool: "tool_inventory",
  back: "back_inventory",
  hair: "hair_inventory",
  shirt: "shirt_inventory",
  pants: "pants_inventory",
  shoes: "shoes_inventory",
  currency: "currency_inventory",
  material: "material_inventory",
  lure: "lure_inventory",
  fish: "fish_inventory",
});

const FIELD_TO_CATEGORY = Object.freeze(Object.fromEntries(
  Object.entries(CATEGORY_TO_FIELD).map(([category, field]) => [field, category])
));

const ALLOWED_CATEGORIES = Object.freeze(Object.keys(CATEGORY_TO_FIELD));
const FISHING_ROD_ITEM_ALIASES = Object.freeze({
  fishing_rod: "bamboo_rod",
  platinum_prestige_rod: "pristine_tungsten_rod",
});

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
    seed_box_icon: true,
    plantable: true,
    ...options,
  });
}

function displayNameForItemId(itemId) {
  return String(itemId || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ensureSeedDefinitionsFromBlocks(items) {
  for (const [blockId, definition] of Object.entries(items)) {
    if (!definition || definition.category !== "block") continue;

    const seedId = cleanItemId(definition.seed || "");
    if (seedId === "") continue;

    if (!items[seedId]) {
      const blockDisplayName = String(definition.display_name || displayNameForItemId(blockId)).trim();
      items[seedId] = seed(blockId, {
        display_name: `${blockDisplayName} Seed`,
        rarity: definition.rarity || "common",
        generated_from_block: true,
      });
      continue;
    }

    if (items[seedId].category !== "seed") continue;
    if (!items[seedId].grows_into) items[seedId].grows_into = blockId;
    items[seedId].seed_box_icon = true;
  }

  for (const definition of Object.values(items)) {
    if (definition && definition.category === "seed") {
      definition.seed_box_icon = true;
    }
  }
}

function backgroundBlock(options = {}) {
  return block({
    rarity: "common",
    block_health: 2,
    seed: "",
    place_layer: "background",
    background_block: true,
    no_collision: true,
    collidable: false,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
    ...options,
  });
}

function colourBlock(options = {}) {
  return block({
    rarity: "uncommon",
    block_health: 3,
    seed: "",
    drop_rules: { seed_chance: 0.04, gem_range: [0, 2] },
    ...options,
  });
}

function makeColouredBlockDropRules(blockId, seedId, gemMax) {
  return {
    seed_chance: 0,
    gem_range: [0, 0],
    fixed_drops: Object.freeze([
      Object.freeze({ item_id: blockId, item_category: "block", amount_range: Object.freeze([1, 3]) }),
      Object.freeze({ item_id: seedId, item_category: "seed", amount_range: Object.freeze([0, 2]) }),
      Object.freeze({ item_id: "gem", item_category: "currency", amount_range: Object.freeze([0, gemMax]) }),
    ]),
  };
}

function makeNaturalBlockDropRules(blockId, seedId) {
  return {
    seed_chance: 0,
    gem_range: [0, 0],
    fixed_drops: Object.freeze([
      Object.freeze({ item_id: blockId, item_category: "block", amount_range: Object.freeze([1, 4]) }),
      Object.freeze({ item_id: seedId, item_category: "seed", amount_range: Object.freeze([0, 3]) }),
      Object.freeze({ item_id: "gem", item_category: "currency", amount_range: Object.freeze([0, 3]) }),
    ]),
  };
}

function makeConfiguredSeedDropRules(blockId, seedId, blockChance, seedChance) {
  return {
    seed_chance: 0,
    gem_range: [0, 0],
    fixed_drops: Object.freeze([
      Object.freeze({ item_id: blockId, item_category: "block", amount: 1, chance: Math.max(0, Math.min(1, Number(blockChance) || 0)) }),
      Object.freeze({ item_id: seedId, item_category: "seed", amount: 1, chance: Math.max(0, Math.min(1, Number(seedChance) || 0)) }),
    ]),
  };
}

function makeConfiguredTreeDropRules(blockId, seedId, blockRange, seedRange) {
  return {
    seed_chance: 0,
    gem_range: [0, 0],
    fixed_drops: Object.freeze([
      Object.freeze({ item_id: blockId, item_category: "block", amount_range: Object.freeze(blockRange) }),
      Object.freeze({ item_id: seedId, item_category: "seed", amount_range: Object.freeze(seedRange) }),
    ]),
  };
}

const TIER_1_SPLICE_BALANCE = Object.freeze({
  pile_of_sand: Object.freeze({ grow_time: 24, block_drop_chance: 0.85, seed_drop_chance: 0.55, tree_block_range: Object.freeze([4, 7]), tree_seed_range: Object.freeze([2, 4]) }),
  glass: Object.freeze({ grow_time: 28, block_drop_chance: 0.75, seed_drop_chance: 0.45, tree_block_range: Object.freeze([4, 7]), tree_seed_range: Object.freeze([2, 4]) }),
  wood_plank: Object.freeze({ grow_time: 32, block_drop_chance: 0.80, seed_drop_chance: 0.45, tree_block_range: Object.freeze([4, 7]), tree_seed_range: Object.freeze([2, 4]) }),
  vines: Object.freeze({ grow_time: 36, block_drop_chance: 0.80, seed_drop_chance: 0.45, tree_block_range: Object.freeze([4, 7]), tree_seed_range: Object.freeze([2, 4]) }),
  rose: Object.freeze({ grow_time: 40, block_drop_chance: 0.75, seed_drop_chance: 0.40, tree_block_range: Object.freeze([4, 7]), tree_seed_range: Object.freeze([2, 4]) }),
  tulip: Object.freeze({ grow_time: 40, block_drop_chance: 0.75, seed_drop_chance: 0.40, tree_block_range: Object.freeze([4, 7]), tree_seed_range: Object.freeze([2, 4]) }),
  sun_flower: Object.freeze({ grow_time: 46, block_drop_chance: 0.75, seed_drop_chance: 0.38, tree_block_range: Object.freeze([3, 6]), tree_seed_range: Object.freeze([1, 4]) }),
  apple: Object.freeze({ grow_time: 52, block_drop_chance: 0.70, seed_drop_chance: 0.35, tree_block_range: Object.freeze([3, 6]), tree_seed_range: Object.freeze([1, 4]) }),
  climbing_vine: Object.freeze({ grow_time: 58, block_drop_chance: 0.70, seed_drop_chance: 0.35, tree_block_range: Object.freeze([3, 6]), tree_seed_range: Object.freeze([1, 4]) }),
  vines_2: Object.freeze({ grow_time: 64, block_drop_chance: 0.68, seed_drop_chance: 0.32, tree_block_range: Object.freeze([3, 6]), tree_seed_range: Object.freeze([1, 4]) }),
  poppy: Object.freeze({ grow_time: 70, block_drop_chance: 0.68, seed_drop_chance: 0.30, tree_block_range: Object.freeze([3, 6]), tree_seed_range: Object.freeze([1, 4]) }),
  lily: Object.freeze({ grow_time: 78, block_drop_chance: 0.65, seed_drop_chance: 0.28, tree_block_range: Object.freeze([3, 6]), tree_seed_range: Object.freeze([1, 4]) }),
  sand_castle: Object.freeze({ grow_time: 86, block_drop_chance: 0.65, seed_drop_chance: 0.25, tree_block_range: Object.freeze([3, 6]), tree_seed_range: Object.freeze([1, 4]) }),
  wood_platform: Object.freeze({ grow_time: 95, block_drop_chance: 0.65, seed_drop_chance: 0.25, tree_block_range: Object.freeze([3, 6]), tree_seed_range: Object.freeze([1, 4]) }),
  sign: Object.freeze({ grow_time: 105, block_drop_chance: 0.62, seed_drop_chance: 0.22, tree_block_range: Object.freeze([2, 5]), tree_seed_range: Object.freeze([0, 4]) }),
  wooden_entrance: Object.freeze({ grow_time: 115, block_drop_chance: 0.60, seed_drop_chance: 0.20, tree_block_range: Object.freeze([2, 5]), tree_seed_range: Object.freeze([0, 4]) }),
  wooden_block: Object.freeze({ grow_time: 125, block_drop_chance: 0.60, seed_drop_chance: 0.20, tree_block_range: Object.freeze([2, 5]), tree_seed_range: Object.freeze([0, 4]) }),
  wooden_background: Object.freeze({ grow_time: 135, block_drop_chance: 0.58, seed_drop_chance: 0.18, tree_block_range: Object.freeze([2, 5]), tree_seed_range: Object.freeze([0, 4]) }),
  wooden_fence: Object.freeze({ grow_time: 150, block_drop_chance: 0.55, seed_drop_chance: 0.16, tree_block_range: Object.freeze([2, 5]), tree_seed_range: Object.freeze([0, 4]) }),
  wooden_ladder: Object.freeze({ grow_time: 160, block_drop_chance: 0.55, seed_drop_chance: 0.16, tree_block_range: Object.freeze([2, 5]), tree_seed_range: Object.freeze([0, 4]) }),
  wooden_door: Object.freeze({ grow_time: 175, block_drop_chance: 0.52, seed_drop_chance: 0.14, tree_block_range: Object.freeze([2, 5]), tree_seed_range: Object.freeze([0, 4]) }),
  wooden_frame: Object.freeze({ grow_time: 190, block_drop_chance: 0.50, seed_drop_chance: 0.12, tree_block_range: Object.freeze([2, 5]), tree_seed_range: Object.freeze([0, 4]) }),
  mushroom: Object.freeze({ grow_time: 205, block_drop_chance: 0.48, seed_drop_chance: 0.10, tree_block_range: Object.freeze([1, 4]), tree_seed_range: Object.freeze([0, 4]) }),
  stone_brick: Object.freeze({ grow_time: 225, block_drop_chance: 0.45, seed_drop_chance: 0.08, tree_block_range: Object.freeze([1, 4]), tree_seed_range: Object.freeze([0, 4]) }),
  glass_panel: Object.freeze({ grow_time: 250, block_drop_chance: 0.42, seed_drop_chance: 0.07, tree_block_range: Object.freeze([1, 4]), tree_seed_range: Object.freeze([0, 4]) }),
  gem_block: Object.freeze({ grow_time: 300, block_drop_chance: 0.35, seed_drop_chance: 0.05, tree_block_range: Object.freeze([1, 4]), tree_seed_range: Object.freeze([0, 4]) }),
});

function applyTier1SpliceBalance(items) {
  for (const [blockId, balance] of Object.entries(TIER_1_SPLICE_BALANCE)) {
    const blockDefinition = items[blockId];
    if (!blockDefinition || blockDefinition.category !== "block") continue;

    const seedId = cleanItemId(blockDefinition.seed || `${blockId}_seed`);
    blockDefinition.seed = seedId;
    blockDefinition.drop_rules = makeConfiguredSeedDropRules(blockId, seedId, balance.block_drop_chance, balance.seed_drop_chance);
    blockDefinition.tree_drop_rules = makeConfiguredTreeDropRules(blockId, seedId, balance.tree_block_range, balance.tree_seed_range);

    if (!items[seedId]) {
      items[seedId] = seed(blockId, {
        display_name: `${String(blockDefinition.display_name || displayNameForItemId(blockId)).trim()} Seed`,
        rarity: blockDefinition.rarity || "common",
      });
    }

    if (items[seedId] && items[seedId].category === "seed") {
      items[seedId].grows_into = blockId;
      items[seedId].grow_time = balance.grow_time;
      items[seedId].max_grow_time = balance.grow_time;
      items[seedId].seed_box_icon = true;
    }
  }
}

function seededColourBlock(blockId, options = {}) {
  const seedId = cleanItemId(options.seed ?? `${blockId}_seed`);
  return colourBlock({
    ...options,
    seed: seedId,
    drop_rules: options.drop_rules || makeColouredBlockDropRules(blockId, seedId, 4),
    tree_drop_rules: options.tree_drop_rules || makeColouredBlockDropRules(blockId, seedId, 5),
  });
}

function prestigeColourBlock(options = {}) {
  return colourBlock({
    rarity: "epic",
    drop_rules: { seed_chance: 0, gem_range: [0, 0], drops_self: true },
    drops_self: true,
    ...options,
  });
}

function fishCatch(displayName, rarity, sellValue, options = {}) {
  return item("fish", {
    display_name: displayName,
    rarity,
    sell_value: sellValue,
    is_fish: true,
    quantity_type: "count",
    ...options,
  });
}

function fishingRod(displayName, rarity, options = {}) {
  return item("tool", {
    display_name: displayName,
    rarity,
    equipment_slot: "hand",
    equipable: true,
    fishing_rod: true,
    instance_tracked: true,
    ...options,
  });
}

const ITEM_DEFINITIONS = {
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
    display_name: "Tree Trunk",
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
    lava_rebound: true,
    lava_top_velocity: -420,
    lava_side_knockback_velocity: 300,
    lava_bottom_knockback_velocity: 280,
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
  golden_statue: block({
    display_name: "Golden Statue",
    rarity: "legendary",
    texture: "res://Assets/items/fish/golden_statue.png",
    inventory_icon: "res://Assets/items/fish/golden_statue.png",
    block_health: 4,
    seed: "",
    no_collision: true,
    collidable: false,
    drops_self: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0], drops_self: true },
    fishing_reward: true,
    sell_value: 0,
  }),
  snow_dirt: block({
    display_name: "Snow Dirt",
    rarity: "common",
    block_health: 3,
    placeable: false,
    dropable: false,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  ice_block: block({
    display_name: "Ice Block",
    rarity: "common",
    block_health: 3,
    seed: "ice_block_seed",
    placeable: true,
    drop_rules: {
      seed_chance: 0,
      gem_range: [0, 0],
      fixed_drops: Object.freeze([
        Object.freeze({ item_id: "ice_block", item_category: "block", amount_range: Object.freeze([1, 3]) }),
        Object.freeze({ item_id: "ice_block_seed", item_category: "seed", amount_range: Object.freeze([0, 2]) }),
        Object.freeze({ item_id: "gem", item_category: "currency", amount_range: Object.freeze([0, 4]) }),
      ]),
    },
  }),
  ice_block_2: block({
    display_name: "Treasure Ice",
    rarity: "rare",
    block_health: 4,
    placeable: false,
    dropable: false,
    drop_rules: {
      seed_chance: 0,
      gem_range: [0, 0],
      fixed_drops: Object.freeze([
        Object.freeze({ item_id: "frozen_treasure", item_category: "block", amount: 1 }),
      ]),
    },
  }),
  ice_fossil: block({
    display_name: "Ice Fossil",
    rarity: "rare",
    block_health: 4,
    placeable: false,
    dropable: false,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  frozen_treasure: block({
    display_name: "Frozen Treasure",
    rarity: "rare",
    block_health: 1,
    seed: "",
    no_collision: true,
    dropable: false,
    instance_tracked: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  frozen_treasure_2: block({
    display_name: "Opened Frozen Treasure",
    rarity: "rare",
    block_health: 1,
    seed: "",
    no_collision: true,
    placeable: false,
    dropable: false,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  snow_block: block({
    display_name: "Snow Block",
    rarity: "uncommon",
    block_health: 2,
    seed: "",
    instance_tracked: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0], drops_self: true },
    drops_self: true,
  }),
  snow_leaf: block({
    display_name: "Snow Leaf",
    rarity: "uncommon",
    block_health: 2,
    seed: "",
    placeable: false,
    dropable: false,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  frozen_grass: block({
    display_name: "Frozen Grass",
    rarity: "common",
    block_health: 3,
    seed: "",
    no_collision: true,
    placeable: false,
    dropable: false,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  frozen_grass_1: block({
    display_name: "Frozen Grass",
    rarity: "common",
    block_health: 3,
    seed: "",
    no_collision: true,
    placeable: false,
    dropable: false,
    hidden: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  frozen_grass_2: block({
    display_name: "Frozen Grass",
    rarity: "common",
    block_health: 3,
    seed: "",
    no_collision: true,
    placeable: false,
    dropable: false,
    hidden: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  frozen_grass_3: block({
    display_name: "Frozen Grass",
    rarity: "common",
    block_health: 3,
    seed: "",
    no_collision: true,
    placeable: false,
    dropable: false,
    hidden: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  snow_bank: block({
    display_name: "Snow Bank",
    rarity: "common",
    block_health: 3,
    seed: "",
    placeable: false,
    dropable: false,
    hidden: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  snow_stone: block({
    display_name: "Snow Stone",
    rarity: "common",
    block_health: 4,
    seed: "",
    placeable: false,
    dropable: false,
    hidden: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  pile_of_snow: block({
    display_name: "Pile of Snow",
    rarity: "common",
    block_health: 1,
    seed: "",
    no_collision: true,
    placeable: false,
    dropable: false,
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
  white_bg: backgroundBlock(),
  grey_bg: backgroundBlock(),
  black_bg: backgroundBlock(),
  red_bg: backgroundBlock(),
  orange_bg: backgroundBlock(),
  yellow_bg: backgroundBlock(),
  green_bg: backgroundBlock(),
  aqua_bg: backgroundBlock(),
  blue_bg: backgroundBlock(),
  purple_bg: backgroundBlock(),
  pink_bg: backgroundBlock(),
  brown_bg: backgroundBlock(),
  glowing_dirt: block({
    rarity: "epic",
    block_health: 4,
    seed: "",
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  red_block: seededColourBlock("red_block"),
  blue_block: seededColourBlock("blue_block"),
  green_block: seededColourBlock("green_block"),
  purple_block: seededColourBlock("purple_block"),
  yellow_block: seededColourBlock("yellow_block"),
  aqua_block: seededColourBlock("aqua_block"),
  black_block: seededColourBlock("black_block"),
  blue_pastel_block: seededColourBlock("blue_pastel_block"),
  brown_block: seededColourBlock("brown_block"),
  dark_aqua_block: seededColourBlock("dark_aqua_block"),
  dark_blue_block: seededColourBlock("dark_blue_block"),
  dark_brown_block: seededColourBlock("dark_brown_block"),
  dark_green_block: seededColourBlock("dark_green_block"),
  dark_pink_block: seededColourBlock("dark_pink_block"),
  dark_purple_block: seededColourBlock("dark_purple_block"),
  dark_red_block: seededColourBlock("dark_red_block"),
  dark_yellow_block: seededColourBlock("dark_yellow_block"),
  green_pastel_block: seededColourBlock("green_pastel_block"),
  grey_block: seededColourBlock("grey_block"),
  happy_block: seededColourBlock("happy_block"),
  light_brown_block: seededColourBlock("light_brown_block"),
  orange_block: seededColourBlock("orange_block"),
  orange_pastel_block: seededColourBlock("orange_pastel_block"),
  pastel_flower_block: seededColourBlock("pastel_flower_block"),
  pink_block: seededColourBlock("pink_block"),
  pink_pastel_block: seededColourBlock("pink_pastel_block"),
  purple_pastel_block: seededColourBlock("purple_pastel_block"),
  red_pastel_block: seededColourBlock("red_pastel_block"),
  white_block: seededColourBlock("white_block"),
  yellow_pastel_block: seededColourBlock("yellow_pastel_block"),
  ps_blue_block: prestigeColourBlock(),
  ps_green_block: prestigeColourBlock(),
  ps_purple_block: prestigeColourBlock(),
  ps_red_block: prestigeColourBlock(),
  ps_yellow_block: prestigeColourBlock(),
  rose: block({
    rarity: "uncommon",
    block_health: 2,
    seed: "rose_seed",
    no_collision: true,
    drop_rules: { seed_chance: 0.04, gem_range: [0, 2] },
  }),
  tulip: block({
    rarity: "uncommon",
    block_health: 2,
    seed: "tulip_seed",
    no_collision: true,
    drop_rules: { seed_chance: 0.04, gem_range: [0, 2] },
  }),
  vines: block({
    rarity: "common",
    block_health: 2,
    seed: "vines_seed",
    no_collision: true,
    drop_rules: { seed_chance: 0.05, gem_range: [0, 2] },
  }),
  apple: block({
    display_name: "Apple",
    rarity: "common",
    block_health: 2,
    seed: "apple_seed",
    no_collision: true,
    drop_rules: makeNaturalBlockDropRules("apple", "apple_seed"),
  }),
  climbing_vine: block({
    display_name: "Climbing Vine",
    rarity: "common",
    block_health: 2,
    seed: "climbing_vine_seed",
    platform_collision: true,
    drop_rules: makeNaturalBlockDropRules("climbing_vine", "climbing_vine_seed"),
  }),
  sun_flower: block({
    display_name: "Sun Flower",
    rarity: "common",
    block_health: 2,
    seed: "sun_flower_seed",
    no_collision: true,
    drop_rules: makeNaturalBlockDropRules("sun_flower", "sun_flower_seed"),
  }),
  poppy: block({
    display_name: "Poppy",
    rarity: "common",
    block_health: 2,
    seed: "poppy_seed",
    no_collision: true,
    drop_rules: makeNaturalBlockDropRules("poppy", "poppy_seed"),
  }),
  lily: block({
    display_name: "Lily",
    rarity: "common",
    block_health: 2,
    seed: "lily_seed",
    no_collision: true,
    drop_rules: makeNaturalBlockDropRules("lily", "lily_seed"),
  }),
  sand_castle: block({
    display_name: "Sand Castle",
    rarity: "common",
    block_health: 2,
    seed: "sand_castle_seed",
    no_collision: true,
    drop_rules: makeNaturalBlockDropRules("sand_castle", "sand_castle_seed"),
  }),
  pile_of_sand: block({
    display_name: "Pile Of Sand",
    rarity: "common",
    block_health: 2,
    seed: "pile_of_sand_seed",
    no_collision: true,
    drop_rules: makeNaturalBlockDropRules("pile_of_sand", "pile_of_sand_seed"),
  }),
  vines_2: block({
    display_name: "Vines 2",
    rarity: "common",
    block_health: 2,
    seed: "vines_2_seed",
    no_collision: true,
    drop_rules: makeNaturalBlockDropRules("vines_2", "vines_2_seed"),
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
    instance_tracked: true,
    block_health: 8,
    seed: "",
    shop_price: 3500,
    tradeable: true,
    dropable: true,
    permissions: { owner_controls_lock: true },
  }),
  super_world_lock: block({
    rarity: "legendary",
    instance_tracked: true,
    block_health: 8,
    seed: "",
    stack_limit: 200,
    tradeable: true,
    dropable: true,
    permissions: { owner_controls_lock: true },
  }),
  vend_empty: block({
    rarity: "epic",
    instance_tracked: true,
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
    instance_tracked: true,
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
  fish_monger: block({
    display_name: "Fish Monger",
    rarity: "epic",
    block_health: 6,
    break_power: 5,
    seed: "",
    placeable: true,
    tradeable: true,
    dropable: true,
    admin_grantable: true,
    shop_price: 15000,
    visual_size: [64, 49],
    collidable: false,
    collision_size: [64, 49],
    visual_offset: [16, -8.5],
    collision_offset: [16, -8.5],
    animation_frames: [
      "res://Assets/items/special items/fish_monger/fish_monger.png",
      "res://Assets/items/special items/fish_monger/fish_monger_1.png",
      "res://Assets/items/special items/fish_monger/fish_monger_2.png",
    ],
    animation_frame_seconds: 0.5,
    requires_world_lock: true,
    requires_full_area_clear: true,
    occupies_collision_area: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
    interact_rules: { can_interact: true, interaction_message: "Sell fish." },
    permissions: { world_lock_access_break: true, public_interact: true },
  }),
  crafting_station: block({
    rarity: "uncommon",
    block_health: 5,
    placeable: true,
    placement_cost: { item_id: "crafting_station", item_category: "block", amount: 1 },
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
    placeable: false,
    legacy_station_part: "left",
  }),
  crafting_station_right: block({
    rarity: "uncommon",
    block_health: 5,
    hidden: true,
    tradeable: false,
    dropable: false,
    admin_grantable: false,
    placeable: false,
    legacy_station_part: "right",
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
    platform_collision: true,
  }),
  wooden_entrance: block({
    rarity: "rare",
    block_health: 4,
    seed: "wooden_entrance_seed",
    no_collision: true,
    entrance_block: true,
    craft_only: true,
    interact_rules: { can_interact: true, interaction_message: "Lock or unlock entrance." },
  }),
  sign: block({
    rarity: "uncommon",
    block_health: 2,
    seed: "sign_seed",
    sign_block: true,
    no_collision: true,
    collidable: false,
    splice_only: true,
  }),
  mechanical_entrance: block({
    rarity: "rare",
    block_health: 4,
    seed: "",
    no_collision: true,
    entrance_block: true,
    entrance_animation_frame_seconds: 0.08,
    interact_rules: { can_interact: true, interaction_message: "Lock or unlock entrance." },
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  ceiling_lamp: block({
    rarity: "uncommon",
    block_health: 2,
    seed: "",
    no_collision: true,
    collidable: false,
    toggle_block: true,
    toggle_state_key: "toggle_on",
    toggle_action: "ceiling_lamp_state",
    interact_rules: { can_interact: true, interaction_message: "Toggle lamp." },
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  steel_door: block({
    rarity: "uncommon",
    block_health: 4,
    seed: "",
    no_collision: true,
    collidable: false,
    door_block: true,
    interact_rules: { can_interact: true, interaction_message: "Edit or enter door." },
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  steel_block: block({
    rarity: "uncommon",
    block_health: 5,
    seed: "",
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  screen_door: block({
    rarity: "uncommon",
    block_health: 3,
    seed: "",
    no_collision: true,
    collidable: false,
    door_block: true,
    interact_rules: { can_interact: true, interaction_message: "Edit or enter door." },
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  steel_background: backgroundBlock({
    rarity: "uncommon",
    block_health: 3,
  }),
  steel_sign: block({
    rarity: "uncommon",
    block_health: 3,
    seed: "",
    sign_block: true,
    no_collision: true,
    collidable: false,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  steel_platform: block({
    rarity: "uncommon",
    block_health: 3,
    seed: "",
    platform_collision: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  steel_ladder: block({
    rarity: "uncommon",
    block_health: 3,
    seed: "",
    platform_collision: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  mushroom: block({
    rarity: "uncommon",
    block_health: 2,
    seed: "",
    collidable: true,
    springboard: true,
    springboard_velocity: -420,
    springboard_animation_frame_seconds: 0.22,
  }),
  wooden_door: block({
    rarity: "uncommon",
    block_health: 3,
    seed: "",
    no_collision: true,
    collidable: false,
    door_block: true,
    interact_rules: { can_interact: true, interaction_message: "Edit or enter door." },
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  wooden_block: block({
    rarity: "uncommon",
    block_health: 3,
    seed: "",
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  wooden_background: backgroundBlock({
    rarity: "common",
    block_health: 2,
  }),
  wooden_fence: block({
    rarity: "uncommon",
    block_health: 3,
    seed: "",
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  wooden_frame: block({
    rarity: "uncommon",
    block_health: 3,
    seed: "",
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),
  wooden_ladder: block({
    rarity: "uncommon",
    block_health: 2,
    seed: "",
    platform_collision: true,
    drop_rules: { seed_chance: 0, gem_range: [0, 0] },
  }),

  dirt_seed: seed("dirt", { rarity: "common" }),
  grass_seed: seed("grass", { rarity: "common" }),
  stone_seed: seed("stone", { rarity: "common" }),
  wood_seed: seed("wood", { display_name: "Tree Trunk Seed", rarity: "uncommon" }),
  leaf_seed: seed("leaf", { rarity: "uncommon" }),
  lava_seed: seed("lava", { rarity: "rare" }),
  sand_seed: seed("sand", { rarity: "common" }),
  glass_seed: seed("glass", { rarity: "rare" }),
  cave_background_seed: seed("cave_background", { rarity: "common" }),
  red_block_seed: seed("red_block", { rarity: "uncommon" }),
  blue_block_seed: seed("blue_block", { rarity: "uncommon" }),
  green_block_seed: seed("green_block", { rarity: "uncommon" }),
  purple_block_seed: seed("purple_block", { rarity: "uncommon" }),
  yellow_block_seed: seed("yellow_block", { rarity: "uncommon" }),
  black_block_seed: seed("black_block", { rarity: "uncommon" }),
  rose_seed: seed("rose", { rarity: "uncommon" }),
  tulip_seed: seed("tulip", { rarity: "uncommon" }),
  vines_seed: seed("vines", { rarity: "common" }),
  wood_plank_seed: seed("wood_plank", { rarity: "uncommon" }),
  wood_platform_seed: seed("wood_platform", { rarity: "uncommon" }),
  wooden_entrance_seed: seed("wooden_entrance", { rarity: "rare" }),
  sign_seed: seed("sign", { rarity: "uncommon" }),
  stone_brick_seed: seed("stone_brick", { rarity: "uncommon" }),
  glass_panel_seed: seed("glass_panel", { rarity: "rare" }),
  gem_block_seed: seed("gem_block", { rarity: "epic" }),

  gem: item("currency", {
    rarity: "currency",
    stack_limit: GEM_CURRENCY_STACK_LIMIT,
    tradeable: false,
    dropable: false,
    admin_grantable: true,
    hidden: true,
  }),

  refined_stone: item("material", { rarity: "uncommon", texture: "res://Assets/items/materials/refined_stone.png" }),
  refined_glass: item("material", { rarity: "rare", texture: "res://Assets/items/materials/refined_glass.png" }),
  metal_scrap: item("material", { rarity: "rare", texture: "res://Assets/items/materials/metal_scrap.png" }),
  seaweed: item("material", { display_name: "Seaweed", rarity: "common", texture: "res://Assets/items/materials/seaweed.png", inventory_icon: "res://Assets/items/materials/seaweed.png", fishing_material: true }),
  trash_can: item("material", { display_name: "Trash Can", rarity: "common", texture: "res://Assets/items/materials/trash_can.png", inventory_icon: "res://Assets/items/materials/trash_can.png", fishing_material: true }),
  coral: item("material", { display_name: "Coral", rarity: "uncommon", texture: "res://Assets/items/materials/coral.png", inventory_icon: "res://Assets/items/materials/coral.png", fishing_material: true }),
  clam: item("material", { display_name: "Clam", rarity: "uncommon", texture: "res://Assets/items/materials/clam.png", inventory_icon: "res://Assets/items/materials/clam.png", fishing_material: true }),
  compass: item("material", { display_name: "Compass", rarity: "rare", texture: "res://Assets/items/materials/compass.png", inventory_icon: "res://Assets/items/materials/compass.png", fishing_material: true }),
  pearl: item("material", { display_name: "Pearl", rarity: "rare", texture: "res://Assets/items/materials/pearl.png", inventory_icon: "res://Assets/items/materials/pearl.png", fishing_material: true }),
  rusty_bicycle: item("material", { display_name: "Rusty Bicycle", rarity: "rare", texture: "res://Assets/items/materials/rusty_bicycle.png", inventory_icon: "res://Assets/items/materials/rusty_bicycle.png", fishing_material: true }),
  lost_chapter: item("material", { display_name: "Lost Chapter", rarity: "epic", texture: "res://Assets/items/materials/lost_chapter.png", inventory_icon: "res://Assets/items/materials/lost_chapter.png", fishing_material: true }),
  topaz_necklace: item("material", { display_name: "Topaz Necklace", rarity: "epic", texture: "res://Assets/items/materials/topaz_necklace.png", inventory_icon: "res://Assets/items/materials/topaz_necklace.png", fishing_material: true }),
  toxic_waste: item("material", { display_name: "Toxic Waste", rarity: "epic", texture: "res://Assets/items/materials/toxic_waste.png", inventory_icon: "res://Assets/items/materials/toxic_waste.png", fishing_material: true }),
  naval_mines: item("material", { display_name: "Naval Mines", rarity: "epic", texture: "res://Assets/items/materials/naval_mines.png", inventory_icon: "res://Assets/items/materials/naval_mines.png", fishing_material: true }),

  legendary_wings: item("back", {
    rarity: "legendary",
    equipment_slot: "back",
    equipable: true,
  }),
  evilangel_wings: item("back", {
    rarity: "legendary",
    equipment_slot: "back",
    equipable: true,
    tradeable: false,
    dropable: false,
  }),
  angel_wings: item("back", {
    rarity: "legendary",
    equipment_slot: "back",
    equipable: true,
    tradeable: true,
    dropable: true,
  }),
  evil_wings: item("back", {
    rarity: "legendary",
    instance_tracked: true,
    equipment_slot: "back",
    equipable: true,
    tradeable: true,
    vendable: true,
    dropable: true,
  }),
  void_aura: item("back", {
    display_name: "Void Aura",
    rarity: "legendary",
    instance_tracked: true,
    equipment_slot: "back",
    equipable: true,
    tradeable: true,
    vendable: true,
    dropable: true,
    jump_type: "double",
  }),

  purple_shirt: item("shirt", {
    rarity: "common",
    equipment_slot: "shirt",
    equipable: true,
    shop_price: 50,
  }),

  void_shirt: item("shirt", {
    rarity: "common",
    equipment_slot: "shirt",
    equipable: true,
    shop_price: 0,
  }),

  messy_brown_hair: item("hair", {
    rarity: "common",
    equipment_slot: "hair",
    equipable: true,
  }),

  basic_blue_shirt: item("shirt", {
    rarity: "common",
    equipment_slot: "shirt",
    equipable: true,
  }),
  basic_red_shirt: item("shirt", {
    rarity: "common",
    equipment_slot: "shirt",
    equipable: true,
  }),
  basic_white_shirt: item("shirt", {
    rarity: "common",
    equipment_slot: "shirt",
    equipable: true,
  }),
  basic_black_shirt: item("shirt", {
    rarity: "common",
    equipment_slot: "shirt",
    equipable: true,
  }),
  basic_heart_shirt: item("shirt", {
    rarity: "common",
    equipment_slot: "shirt",
    equipable: true,
  }),
  basic_gray_shirt: item("shirt", {
    rarity: "common",
    equipment_slot: "shirt",
    equipable: true,
  }),
  basic_maroon_shirt: item("shirt", {
    rarity: "common",
    equipment_slot: "shirt",
    equipable: true,
  }),

  basic_black_pants: item("pants", {
    rarity: "common",
    equipment_slot: "pants",
    equipable: true,
  }),
  basic_light_gray_pants: item("pants", {
    rarity: "common",
    equipment_slot: "pants",
    equipable: true,
  }),
  basic_navy_pants: item("pants", {
    rarity: "common",
    equipment_slot: "pants",
    equipable: true,
  }),
  basic_brown_pants: item("pants", {
    rarity: "common",
    equipment_slot: "pants",
    equipable: true,
  }),
  basic_green_pants: item("pants", {
    rarity: "common",
    equipment_slot: "pants",
    equipable: true,
  }),
  basic_pink_pants: item("pants", {
    rarity: "common",
    equipment_slot: "pants",
    equipable: true,
  }),

  basic_brown_shoes: item("shoes", {
    rarity: "common",
    equipment_slot: "shoes",
    equipable: true,
  }),
  basic_black_shoes: item("shoes", {
    rarity: "common",
    equipment_slot: "shoes",
    equipable: true,
  }),
  basic_red_shoes: item("shoes", {
    rarity: "common",
    equipment_slot: "shoes",
    equipable: true,
  }),
  basic_blue_shoes: item("shoes", {
    rarity: "common",
    equipment_slot: "shoes",
    equipable: true,
  }),

  purple_pants: item("pants", {
    rarity: "common",
    equipment_slot: "pants",
    equipable: true,
    shop_price: 50,
  }),

  void_pants: item("pants", {
    rarity: "common",
    equipment_slot: "pants",
    equipable: true,
    shop_price: 0,
  }),

  void_shoes: item("shoes", {
    rarity: "common",
    equipment_slot: "shoes",
    equipable: true,
    shop_price: 0,
  }),

  bamboo_rod: fishingRod("Bamboo Rod", "uncommon", {
    shop_price: 5000,
  }),
  refined_bamboo_rod: fishingRod("Refined Bamboo Rod", "rare"),
  pristine_bamboo_rod: fishingRod("Pristine Bamboo Rod", "epic"),
  fishing_rod: fishingRod("Bamboo Rod", "uncommon", {
    hidden: true,
    legacy_item_id: true,
    canonical_item_id: "bamboo_rod",
    shop_price: 0,
  }),
  fiberglass_rod: fishingRod("Fiberglass Rod", "rare", {
    shop_price: 15000,
  }),
  refined_fiberglass_rod: fishingRod("Refined Fiberglass Rod", "epic"),
  pristine_fiberglass_rod: fishingRod("Pristine Fiberglass Rod", "legendary"),
  tungsten_rod: fishingRod("Tungsten Rod", "epic", {
    shop_price: 50000,
  }),
  refined_tungsten_rod: fishingRod("Refined Tungsten Rod", "legendary"),
  pristine_tungsten_rod: fishingRod("Pristine Tungsten Rod", "legendary"),
  platinum_prestige_rod: fishingRod("Pristine Tungsten Rod", "legendary", {
    hidden: true,
    legacy_item_id: true,
    canonical_item_id: "pristine_tungsten_rod",
    shop_price: 0,
  }),
  neptune_rod: item("tool", {
    display_name: "Neptune Rod",
    rarity: "legendary",
    equipment_slot: "hand",
    equipable: true,
    fishing_rod: true,
    instance_tracked: true,
    shop_price: 0,
  }),
  sakura_sword: item("tool", {
    rarity: "legendary",
    equipment_slot: "hand",
    equipable: true,
    shop_price: 0,
  }),
  pulu_pulu: item("tool", {
    rarity: "legendary",
    equipment_slot: "hand",
    equipable: true,
    shop_price: 0,
  }),
  neptune_trident: item("tool", {
    display_name: "Neptune Trident",
    rarity: "legendary",
    equipment_slot: "hand",
    equipable: true,
    instance_tracked: true,
    shop_price: 0,
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

  hook: item("lure", { display_name: "Basic Hook", rarity: "common" }),
  worm_lure: item("lure", { display_name: "Worm Bait", rarity: "common" }),
  shiny_lure: item("lure", { display_name: "Shiny Bait", rarity: "uncommon" }),
  golden_lure: item("lure", { display_name: "Golden Bait", rarity: "rare" }),
  bonito_lure: item("lure", { display_name: "Bonito Bait", rarity: "epic" }),
  cotton_cordel_lure: item("lure", { display_name: "Cotton Cordel Bait", rarity: "epic" }),
  void_worm_lure: item("lure", { display_name: "Void Worm Bait", rarity: "legendary" }),
  magnet_lure: item("lure", { display_name: "Magnetic Bait", rarity: "uncommon", material_fishing_lure: true }),
  basic_items_pack: item("material", {
    rarity: "common",
    shop_price: 500,
    shop_pack: true,
    hidden: true,
    tradeable: false,
    dropable: false,
    admin_grantable: false,
    pack_rewards: [
      "messy_brown_hair",
      "basic_blue_shirt",
      "basic_red_shirt",
      "basic_white_shirt",
      "basic_black_shirt",
      "basic_heart_shirt",
      "basic_gray_shirt",
      "basic_maroon_shirt",
      "basic_black_pants",
      "basic_light_gray_pants",
      "basic_navy_pants",
      "basic_brown_pants",
      "basic_green_pants",
      "basic_pink_pants",
      "basic_brown_shoes",
      "basic_black_shoes",
      "basic_red_shoes",
      "basic_blue_shoes",
    ],
  }),
  prestige_coloured_block_pack: item("material", {
    rarity: "epic",
    shop_price: 500,
    shop_pack: true,
    hidden: true,
    tradeable: false,
    dropable: false,
    admin_grantable: false,
    pack_rewards: [
      "ps_blue_block",
      "ps_green_block",
      "ps_purple_block",
      "ps_red_block",
      "ps_yellow_block",
    ],
  }),
  lure_pack: item("lure", {
    rarity: "uncommon",
    shop_price: 25,
    shop_pack: true,
  }),

  pond_fish: fishCatch("Pond Fish", "common", 3, { difficulty: 1 }),
  pond_fish_small: fishCatch("Small Pond Fish", "common", 2, { difficulty: 1, fish_family: "pond_fish", fish_size: "small" }),
  pond_fish_med: fishCatch("Medium Pond Fish", "common", 4, { difficulty: 1, fish_family: "pond_fish", fish_size: "medium" }),
  pond_fish_large: fishCatch("Large Pond Fish", "common", 7, { difficulty: 2, fish_family: "pond_fish", fish_size: "large" }),
  bluegill: fishCatch("Bluegill", "uncommon", 8, { difficulty: 2 }),
  golden_carp: fishCatch("Golden Carp", "rare", 25, { difficulty: 4 }),
  crystal_fish: fishCatch("Crystal Fish", "epic", 75, { difficulty: 6 }),
  cat_fish_small: fishCatch("Small Cat Fish", "common", 4, { difficulty: 1, fish_family: "cat_fish", fish_size: "small" }),
  cat_fish_med: fishCatch("Medium Cat Fish", "common", 8, { difficulty: 2, fish_family: "cat_fish", fish_size: "medium" }),
  cat_fish_large: fishCatch("Large Cat Fish", "common", 14, { difficulty: 3, fish_family: "cat_fish", fish_size: "large" }),
  bone_fish_small: fishCatch("Small Bone Fish", "uncommon", 6, { difficulty: 2, fish_family: "bone_fish", fish_size: "small" }),
  bone_fish_med: fishCatch("Medium Bone Fish", "uncommon", 12, { difficulty: 3, fish_family: "bone_fish", fish_size: "medium" }),
  bone_fish_large: fishCatch("Large Bone Fish", "uncommon", 20, { difficulty: 4, fish_family: "bone_fish", fish_size: "large" }),
  barracuda_small: fishCatch("Small Barracuda", "epic", 10, { difficulty: 2, fish_family: "barracuda", fish_size: "small" }),
  barracuda_med: fishCatch("Medium Barracuda", "epic", 18, { difficulty: 3, fish_family: "barracuda", fish_size: "medium" }),
  barracuda_large: fishCatch("Large Barracuda", "epic", 30, { difficulty: 4, fish_family: "barracuda", fish_size: "large" }),
  sea_horse_small: fishCatch("Small Sea Horse", "common", 12, { difficulty: 3, fish_family: "sea_horse", fish_size: "small" }),
  sea_horse_med: fishCatch("Medium Sea Horse", "common", 22, { difficulty: 4, fish_family: "sea_horse", fish_size: "medium" }),
  sea_horse_large: fishCatch("Large Sea Horse", "common", 40, { difficulty: 5, fish_family: "sea_horse", fish_size: "large" }),
  stingray_small: fishCatch("Small Stingray", "uncommon", 15, { difficulty: 3, fish_family: "stingray", fish_size: "small" }),
  stingray_med: fishCatch("Medium Stingray", "uncommon", 28, { difficulty: 4, fish_family: "stingray", fish_size: "medium" }),
  stingray_large: fishCatch("Large Stingray", "uncommon", 50, { difficulty: 5, fish_family: "stingray", fish_size: "large" }),
  shark_small: fishCatch("Small Shark", "epic", 20, { difficulty: 4, fish_family: "shark", fish_size: "small" }),
  shark_med: fishCatch("Medium Shark", "epic", 40, { difficulty: 5, fish_family: "shark", fish_size: "medium" }),
  shark_large: fishCatch("Large Shark", "epic", 75, { difficulty: 6, fish_family: "shark", fish_size: "large" }),
  lava_fish_small: fishCatch("Small Lava Fish", "rare", 30, { difficulty: 5, fish_family: "lava_fish", fish_size: "small" }),
  lava_fish_med: fishCatch("Medium Lava Fish", "rare", 60, { difficulty: 6, fish_family: "lava_fish", fish_size: "medium" }),
  lava_fish_large: fishCatch("Large Lava Fish", "rare", 110, { difficulty: 7, fish_family: "lava_fish", fish_size: "large" }),
  alien_fish_small: fishCatch("Small Alien Fish", "rare", 35, { difficulty: 5, fish_family: "alien_fish", fish_size: "small" }),
  alien_fish_med: fishCatch("Medium Alien Fish", "rare", 70, { difficulty: 6, fish_family: "alien_fish", fish_size: "medium" }),
  alien_fish_large: fishCatch("Large Alien Fish", "rare", 130, { difficulty: 7, fish_family: "alien_fish", fish_size: "large" }),
  mossy_chest: fishCatch("Mossy Chest", "uncommon", 100, { difficulty: 5, fishing_treasure: true }),
  atlantic_chest: block({
    display_name: "Atlantic Chest",
    rarity: "epic",
    block_health: 4,
    texture: "res://Assets/items/fish/atlantic_chest.png",
    inventory_icon: "res://Assets/items/fish/atlantic_chest.png",
    seed: "",
    no_collision: true,
    collidable: false,
    fishing_reward: true,
    fishing_treasure: true,
    sell_value: 0,
    drop_rules: {
      seed_chance: 0,
      gem_range: [0, 0],
      loot_table: Object.freeze([
        Object.freeze({ item_id: "neptune_trident", item_category: "tool", weight: 1, amount: 1 }),
        Object.freeze({ item_id: "treasure_chest", item_category: "fish", weight: 9, amount: 1 }),
        Object.freeze({ item_id: "mossy_chest", item_category: "fish", weight: 14, amount: 1 }),
        Object.freeze({ item_id: "golden_lure", item_category: "lure", weight: 10, amount: 1 }),
        Object.freeze({ item_id: "void_worm_lure", item_category: "lure", weight: 4, amount: 1 }),
        Object.freeze({ item_id: "coral", item_category: "material", weight: 12, amount_range: [2, 5] }),
        Object.freeze({ item_id: "clam", item_category: "material", weight: 12, amount_range: [2, 5] }),
        Object.freeze({ item_id: "seaweed", item_category: "material", weight: 14, amount_range: [3, 8] }),
        Object.freeze({ item_id: "trash_can", item_category: "material", weight: 10, amount_range: [2, 5] }),
        Object.freeze({ item_id: "rusty_bicycle", item_category: "material", weight: 8, amount_range: [1, 2] }),
        Object.freeze({ item_id: "naval_mines", item_category: "material", weight: 6, amount: 1 }),
      ]),
    },
  }),
  treasure_chest: fishCatch("Treasure Chest", "rare", 300, { difficulty: 8, fishing_treasure: true }),
  sea_eater: fishCatch("Sea Eater", "legendary", 250, {
    difficulty: 9,
  }),
  tail_of_trident: fishCatch("Tail of Trident", "legendary", 225, {
    difficulty: 8,
    texture: "res://Assets/items/fish/Tail_of_trident.png",
  }),
  mermaid: fishCatch("Mermaid", "legendary", 300, { difficulty: 9 }),
  megalodon: fishCatch("Megalodon", "legendary", 450, { difficulty: 10 }),
  kraken: fishCatch("Kraken", "legendary", 500, { difficulty: 10 }),
};

applyTier1SpliceBalance(ITEM_DEFINITIONS);
ensureSeedDefinitionsFromBlocks(ITEM_DEFINITIONS);

const ITEMS = Object.freeze(ITEM_DEFINITIONS);

const STATION_RECIPES = Object.freeze({
  crafting_station: Object.freeze([
    Object.freeze({
      id: "refined_bamboo_rod",
      output: Object.freeze({ item_id: "refined_bamboo_rod", category: "tool", amount: 1 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "bamboo_rod", category: "tool", amount: 1 }),
        Object.freeze({ item_id: "seaweed", category: "material", amount: 12 }),
        Object.freeze({ item_id: "trash_can", category: "material", amount: 4 }),
        Object.freeze({ item_id: "gem", category: "currency", amount: 100 }),
      ]),
    }),
    Object.freeze({
      id: "pristine_bamboo_rod",
      output: Object.freeze({ item_id: "pristine_bamboo_rod", category: "tool", amount: 1 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "refined_bamboo_rod", category: "tool", amount: 1 }),
        Object.freeze({ item_id: "seaweed", category: "material", amount: 20 }),
        Object.freeze({ item_id: "clam", category: "material", amount: 8 }),
        Object.freeze({ item_id: "coral", category: "material", amount: 6 }),
        Object.freeze({ item_id: "pearl", category: "material", amount: 1 }),
        Object.freeze({ item_id: "gem", category: "currency", amount: 500 }),
      ]),
    }),
    Object.freeze({
      id: "refined_fiberglass_rod",
      output: Object.freeze({ item_id: "refined_fiberglass_rod", category: "tool", amount: 1 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "fiberglass_rod", category: "tool", amount: 1 }),
        Object.freeze({ item_id: "refined_glass", category: "material", amount: 10 }),
        Object.freeze({ item_id: "coral", category: "material", amount: 8 }),
        Object.freeze({ item_id: "compass", category: "material", amount: 1 }),
        Object.freeze({ item_id: "gem", category: "currency", amount: 500 }),
      ]),
    }),
    Object.freeze({
      id: "pristine_fiberglass_rod",
      output: Object.freeze({ item_id: "pristine_fiberglass_rod", category: "tool", amount: 1 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "refined_fiberglass_rod", category: "tool", amount: 1 }),
        Object.freeze({ item_id: "refined_glass", category: "material", amount: 20 }),
        Object.freeze({ item_id: "pearl", category: "material", amount: 3 }),
        Object.freeze({ item_id: "topaz_necklace", category: "material", amount: 1 }),
        Object.freeze({ item_id: "gem", category: "currency", amount: 1500 }),
      ]),
    }),
    Object.freeze({
      id: "refined_tungsten_rod",
      output: Object.freeze({ item_id: "refined_tungsten_rod", category: "tool", amount: 1 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "tungsten_rod", category: "tool", amount: 1 }),
        Object.freeze({ item_id: "metal_scrap", category: "material", amount: 10 }),
        Object.freeze({ item_id: "rusty_bicycle", category: "material", amount: 3 }),
        Object.freeze({ item_id: "lost_chapter", category: "material", amount: 1 }),
        Object.freeze({ item_id: "gem", category: "currency", amount: 2000 }),
      ]),
    }),
    Object.freeze({
      id: "pristine_tungsten_rod",
      output: Object.freeze({ item_id: "pristine_tungsten_rod", category: "tool", amount: 1 }),
      cost: Object.freeze([
        Object.freeze({ item_id: "refined_tungsten_rod", category: "tool", amount: 1 }),
        Object.freeze({ item_id: "metal_scrap", category: "material", amount: 25 }),
        Object.freeze({ item_id: "naval_mines", category: "material", amount: 2 }),
        Object.freeze({ item_id: "toxic_waste", category: "material", amount: 2 }),
        Object.freeze({ item_id: "topaz_necklace", category: "material", amount: 2 }),
        Object.freeze({ item_id: "gem", category: "currency", amount: 5000 }),
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
  "sand_seed+stone_seed": "pile_of_sand_seed",
  "lava_seed+sand_seed": "glass_seed",
  "stone_seed+wood_seed": "wood_plank_seed",
  "grass_seed+leaf_seed": "vines_seed",
  "dirt_seed+leaf_seed": "rose_seed",
  "leaf_seed+sand_seed": "tulip_seed",
  "grass_seed+sand_seed": "sun_flower_seed",
  "glass_seed+wood_seed": "apple_seed",
  "vines_seed+wood_seed": "climbing_vine_seed",
  "leaf_seed+vines_seed": "vines_2_seed",
  "rose_seed+tulip_seed": "poppy_seed",
  "glass_seed+grass_seed": "lily_seed",
  "sand_seed+wood_plank_seed": "sand_castle_seed",
  "leaf_seed+wood_seed": "wood_platform_seed",
  "cave_background_seed+stone_seed": "sign_seed",
  "leaf_seed+wood_plank_seed": "wooden_entrance_seed",
  "lava_seed+wood_plank_seed": "wooden_block_seed",
  "cave_background_seed+wood_plank_seed": "wooden_background_seed",
  "leaf_seed+wooden_block_seed": "wooden_fence_seed",
  "vines_seed+wood_platform_seed": "wooden_ladder_seed",
  "wood_plank_seed+wooden_entrance_seed": "wooden_door_seed",
  "wood_plank_seed+wooden_fence_seed": "wooden_frame_seed",
  "dirt_seed+vines_seed": "mushroom_seed",
  "lava_seed+stone_seed": "stone_brick_seed",
  "glass_seed+stone_seed": "glass_panel_seed",
  "glass_seed+lava_seed": "gem_block_seed",
});

const FISHING_RARITY_POOLS = Object.freeze({
  common: Object.freeze([
    Object.freeze({ fish_id: "pond_fish_small" }),
    Object.freeze({ fish_id: "pond_fish_med" }),
    Object.freeze({ fish_id: "pond_fish_large" }),
    Object.freeze({ fish_id: "cat_fish_small" }),
    Object.freeze({ fish_id: "cat_fish_med" }),
    Object.freeze({ fish_id: "cat_fish_large" }),
    Object.freeze({ fish_id: "sea_horse_small" }),
    Object.freeze({ fish_id: "sea_horse_med" }),
    Object.freeze({ fish_id: "sea_horse_large" }),
  ]),
  uncommon: Object.freeze([
    Object.freeze({ fish_id: "bone_fish_small" }),
    Object.freeze({ fish_id: "bone_fish_med" }),
    Object.freeze({ fish_id: "bone_fish_large" }),
    Object.freeze({ fish_id: "stingray_small" }),
    Object.freeze({ fish_id: "stingray_med" }),
    Object.freeze({ fish_id: "stingray_large" }),
  ]),
  rare: Object.freeze([
    Object.freeze({ fish_id: "lava_fish_small" }),
    Object.freeze({ fish_id: "lava_fish_med" }),
    Object.freeze({ fish_id: "lava_fish_large" }),
    Object.freeze({ fish_id: "alien_fish_small" }),
    Object.freeze({ fish_id: "alien_fish_med" }),
    Object.freeze({ fish_id: "alien_fish_large" }),
  ]),
  epic: Object.freeze([
    Object.freeze({ fish_id: "barracuda_small" }),
    Object.freeze({ fish_id: "barracuda_med" }),
    Object.freeze({ fish_id: "barracuda_large" }),
    Object.freeze({ fish_id: "shark_small" }),
    Object.freeze({ fish_id: "shark_med" }),
    Object.freeze({ fish_id: "shark_large" }),
  ]),
  legendary: Object.freeze([
    Object.freeze({ fish_id: "tail_of_trident" }),
    Object.freeze({ fish_id: "mermaid" }),
    Object.freeze({ fish_id: "megalodon" }),
    Object.freeze({ fish_id: "kraken" }),
    Object.freeze({ fish_id: "sea_eater" }),
  ]),
});

const NEPTUNE_ROD_SPECIAL_FISHING_REWARDS = Object.freeze([
  Object.freeze({ item_id: "golden_statue", item_category: "block", weight: 10, difficulty: 9, required_rod_id: "neptune_rod" }),
]);

const FISHING_TABLE_SPECS = Object.freeze({
  hook: Object.freeze({ rarity_weights: Object.freeze({ common: 8000, uncommon: 1600, rare: 300, epic: 90, legendary: 10 }) }),
  worm_lure: Object.freeze({ rarity_weights: Object.freeze({ common: 8000, uncommon: 1600, rare: 300, epic: 90, legendary: 10 }) }),
  shiny_lure: Object.freeze({ rarity_weights: Object.freeze({ common: 3000, uncommon: 6100, rare: 800, epic: 90, legendary: 10 }) }),
  golden_lure: Object.freeze({ rarity_weights: Object.freeze({ common: 2000, uncommon: 3000, rare: 4500, epic: 490, legendary: 10 }) }),
  bonito_lure: Object.freeze({ rarity_weights: Object.freeze({ common: 1000, uncommon: 2000, rare: 3000, epic: 3500, legendary: 500 }) }),
  cotton_cordel_lure: Object.freeze({ rarity_weights: Object.freeze({ common: 1000, uncommon: 2000, rare: 3000, epic: 3500, legendary: 500 }) }),
  void_worm_lure: Object.freeze({ rarity_weights: Object.freeze({ common: 1000, uncommon: 1500, rare: 2000, epic: 2000, legendary: 3500 }) }),
  magnet_lure: Object.freeze({
    rewards: Object.freeze([
      Object.freeze({ item_id: "seaweed", item_category: "material", weight: 18, difficulty: 1 }),
      Object.freeze({ item_id: "trash_can", item_category: "material", weight: 16, difficulty: 1 }),
      Object.freeze({ item_id: "coral", item_category: "material", weight: 13, difficulty: 2 }),
      Object.freeze({ item_id: "clam", item_category: "material", weight: 13, difficulty: 2 }),
      Object.freeze({ item_id: "compass", item_category: "material", weight: 9, difficulty: 3 }),
      Object.freeze({ item_id: "pearl", item_category: "material", weight: 8, difficulty: 3 }),
      Object.freeze({ item_id: "rusty_bicycle", item_category: "material", weight: 7, difficulty: 4 }),
      Object.freeze({ item_id: "lost_chapter", item_category: "material", weight: 5, difficulty: 5 }),
      Object.freeze({ item_id: "topaz_necklace", item_category: "material", weight: 4, difficulty: 6 }),
      Object.freeze({ item_id: "toxic_waste", item_category: "material", weight: 4, difficulty: 6 }),
      Object.freeze({ item_id: "naval_mines", item_category: "material", weight: 2, difficulty: 7 }),
      Object.freeze({ item_id: "atlantic_chest", item_category: "block", weight: 1, difficulty: 6 }),
    ]),
  }),
  default: Object.freeze({ rarity_weights: Object.freeze({ common: 8000, uncommon: 1600, rare: 300, epic: 90, legendary: 10 }) }),
});

function isFishingEntryAvailableForRod(entry, rodId) {
  const requiredRodId = normalizeFishingRodId(entry.required_rod_id || entry.requiredRodId || "");
  return requiredRodId === "" || requiredRodId === rodId;
}

function withFishingEntryDifficulty(entry) {
  const itemId = cleanItemId(entry.item_id || entry.fish_id || "");
  const definition = getItemDefinition(itemId);
  const difficulty = Math.max(1, Math.trunc(Number(entry.difficulty || definition?.difficulty || 1) || 1));
  return { ...entry, difficulty };
}

function distributeFishingWeight(groupWeight, entries) {
  const safeGroupWeight = Math.max(0, Math.trunc(Number(groupWeight) || 0));
  if (safeGroupWeight <= 0 || !Array.isArray(entries) || entries.length <= 0) return [];

  const baseWeight = Math.floor(safeGroupWeight / entries.length);
  let remainder = safeGroupWeight % entries.length;
  return entries.map((entry) => {
    const weight = baseWeight + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return Object.freeze({ ...withFishingEntryDifficulty(entry), weight });
  }).filter((entry) => entry.weight > 0);
}

function getAvailableNeptuneRodSpecialFishingRewards(rodId) {
  return NEPTUNE_ROD_SPECIAL_FISHING_REWARDS
    .filter((entry) => isFishingEntryAvailableForRod(entry, rodId))
    .map((entry) => Object.freeze({ ...withFishingEntryDifficulty(entry) }));
}

function buildFishingTableFromRarityWeights(rarityWeights, rodId = "") {
  const table = [];
  for (const [rarity, groupWeight] of Object.entries(rarityWeights || {})) {
    let safeGroupWeight = Math.max(0, Math.trunc(Number(groupWeight) || 0));
    const specialRewards = rarity === "common" ? getAvailableNeptuneRodSpecialFishingRewards(rodId) : [];
    const specialWeight = specialRewards.reduce((total, entry) => total + Math.max(0, Math.trunc(Number(entry.weight) || 0)), 0);
    if (specialWeight > 0) safeGroupWeight = Math.max(0, safeGroupWeight - specialWeight);

    const pool = (FISHING_RARITY_POOLS[rarity] || [])
      .filter((entry) => isFishingEntryAvailableForRod(entry, rodId));
    table.push(...distributeFishingWeight(safeGroupWeight, pool));
    if (specialRewards.length > 0) table.push(...specialRewards);
  }
  return table;
}

function buildFishingTableFromSpec(spec, rodId = "") {
  if (!spec || typeof spec !== "object") return [];
  if (spec.rewards) {
    return spec.rewards
      .filter((entry) => isFishingEntryAvailableForRod(entry, rodId))
      .map((entry) => ({ ...withFishingEntryDifficulty(entry) }));
  }
  if (spec.rarity_weights) {
    return buildFishingTableFromRarityWeights(spec.rarity_weights, rodId);
  }
  return [];
}

const FISHING_TABLES = Object.freeze(Object.fromEntries(
  Object.entries(FISHING_TABLE_SPECS).map(([lureId, spec]) => [lureId, Object.freeze(buildFishingTableFromSpec(spec, ""))])
));

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

function getFishingTable(lureId, options = {}) {
  const rodId = normalizeFishingRodId(options.rod_id || options.rodId || options.tool_id || options.toolId || "");
  const spec = FISHING_TABLE_SPECS[cleanItemId(lureId)] || FISHING_TABLE_SPECS.default;
  return buildFishingTableFromSpec(spec, rodId).map((entry) => ({ ...entry }));
}

function cleanItemId(itemId) {
  return String(itemId || "").trim().toLowerCase();
}

function normalizeFishingRodId(itemId) {
  const clean = cleanItemId(itemId);
  return FISHING_ROD_ITEM_ALIASES[clean] || clean;
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

function isVendableItem(itemId) {
  const clean = cleanItemId(itemId);
  if (clean === "" || clean === "punch" || clean === "world_lock" || clean === "super_world_lock") return false;
  if (clean === "vend_empty" || clean === "vend_pending" || clean === "vend_sold") return false;

  const definition = getItemDefinition(clean);
  return Boolean(definition && !definition.hidden && definition.tradeable);
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

function isFishingRodItem(itemId) {
  const definition = getItemDefinition(itemId);
  return Boolean(definition && definition.category === "tool" && (definition.fishing_rod || normalizeFishingRodId(definition.item_id) === "bamboo_rod"));
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

module.exports = {
  DEFAULT_STACK_LIMIT,
  GEM_CURRENCY_STACK_LIMIT,
  CATEGORY_TO_FIELD,
  FIELD_TO_CATEGORY,
  ALLOWED_CATEGORIES,
  FISHING_TABLES,
  ITEMS,
  SPLICE_RECIPES,
  STATION_RECIPES,
  cleanCategory,
  normalizeFishingRodId,
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
  hasItem,
  isDropableItem,
  isGrantableItem,
  isFishingRodItem,
  isPlaceableBlock,
  isTradeableItem,
  isVendableItem,
  canBreakBlock,
};
