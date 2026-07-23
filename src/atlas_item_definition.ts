"use strict";

const ItemAtlasDB: {
  getItem(itemId: unknown): Record<string, unknown> | null;
  getItemIdForKey(itemKey: unknown): number;
} = require("./item_atlas_db");

type ItemDefinition = Record<string, unknown>;

interface AtlasDefinitionBuilders {
  block(options: Record<string, unknown>): ItemDefinition;
  cleanItemId(value: unknown): string;
  displayNameForItemId(value: unknown): string;
}

const ATLAS_PASSTHROUGH_KEYS = Object.freeze([
  "punch_toggle_block",
  "toggle_active_block",
  "toggle_inactive_block",
  "toggle_drop_block",
  "hidden",
  "placeable",
  "dropable",
  "tradeable",
  "admin_grantable",
  "instant_death",
  "hazard_instant_death",
  "animated",
  "animation_frames",
  "animation_atlas_coords",
  "animation_frame_seconds",
  "running_animation_frames",
  "running_animation_loop_frames",
  "running_animation_frame_seconds",
  "tileset_animation",
  "drop_rules",
  "tree_drop_rules",
  "texture",
  "inventory_icon",
  "foreground_over_player",
  "display_block",
  "fish_hanger_block",
  "display_preview_max_size",
  "display_preview_alpha",
  "display_preview_offset",
  "display_glass_alpha",
  "display_glass_size",
  "donation_box_block",
  "donation_box_empty_texture",
  "donation_box_full_texture",
  "donation_box_empty_animation_frame",
  "donation_box_full_animation_frame",
  "door_block",
  "portal_block",
  "auto_door_enter",
  "interact_rules",
  "permissions",
  "chicken_block",
  "chicken_feed_item_id",
  "chicken_feed_item_category",
  "chicken_production_seconds",
  "chicken_hunger_seconds",
  "chicken_reward_item_id",
  "chicken_golden_reward_item_id",
  "chicken_golden_reward_chance",
  "chicken_hungry_atlas_coords",
  "chicken_producing_atlas_coords",
  "chicken_ready_atlas_coords",
  "cow_block",
  "cow_feed_item_id",
  "cow_feed_item_category",
  "cow_production_seconds",
  "cow_hunger_seconds",
  "cow_reward_item_id",
  "cow_hungry_atlas_coords",
  "cow_producing_atlas_coords",
  "cow_ready_atlas_coords",
  "duck_block",
  "duck_feed_item_id",
  "duck_feed_item_category",
  "duck_production_seconds",
  "duck_hunger_seconds",
  "duck_reward_table",
  "duck_hungry_atlas_coords",
  "duck_producing_atlas_coords",
  "duck_ready_atlas_coords",
  "battery_charger_block",
  "water_well_block",
  "water_well_cooldown_seconds",
  "water_well_reward_item_id",
  "water_well_reward_item_category",
  "water_well_reward_amount_range",
  "water_well_producing_atlas_coords",
  "water_well_ready_atlas_coords",
  "water_lower_atlas_coords",
  "platform_collision",
  "platform_variant_atlas_coords",
  "vertical_variant_atlas_coords",
  "connected_variant_atlas_coords",
  "connected_variant_textures",
]);

function buildAtlasItemDefinition(itemId: unknown, builders: AtlasDefinitionBuilders): Readonly<ItemDefinition> | null {
  const clean = builders.cleanItemId(itemId);
  const atlasItemId = ItemAtlasDB.getItemIdForKey(clean);
  if (atlasItemId <= 0) return null;

  const atlasItem = ItemAtlasDB.getItem(atlasItemId);
  if (!atlasItem) return null;

  const layer = builders.cleanItemId(atlasItem.layer || "foreground") === "background"
    ? "background"
    : "foreground";
  const hasCollision = Boolean(atlasItem.collision) && layer === "foreground";
  const platformCollision = Boolean(atlasItem.platform_collision) && layer === "foreground";
  const definition = builders.block({
    display_name: String(atlasItem.name || clean).trim() || builders.displayNameForItemId(clean),
    block_health: Math.max(1, Math.trunc(Number(atlasItem.hardness) || 1)),
    place_layer: layer,
    background_block: layer === "background",
    no_collision: !hasCollision && !platformCollision,
    collidable: hasCollision || platformCollision,
    solid: hasCollision,
    collision_type: hasCollision ? builders.cleanItemId(atlasItem.collision_type || "full") || "full" : "none",
    atlas_item_id: atlasItemId,
    atlas_source_id: Math.trunc(Number(atlasItem.source_id) || 0),
    atlas_coords: Array.isArray(atlasItem.atlas_coords) ? atlasItem.atlas_coords.slice(0, 2) : [0, 0],
    alternative_tile: Math.trunc(Number(atlasItem.alternative_tile) || 0),
    seed: "",
  });

  for (const passthroughKey of ATLAS_PASSTHROUGH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(atlasItem, passthroughKey)) {
      definition[passthroughKey] = atlasItem[passthroughKey];
    }
  }

  return Object.freeze(definition);
}

const AtlasItemDefinition = {
  ATLAS_PASSTHROUGH_KEYS,
  buildAtlasItemDefinition,
};

export = AtlasItemDefinition;
