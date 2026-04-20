/**
 * Annotation keys that feed dynamic suggestion options in fetchFormOptions().
 * When these fields change, invalidate FORM_OPTIONS_QUERY_KEY so corrected
 * values disappear and new values appear in dropdowns.
 */
const FORM_OPTIONS_REFRESH_KEYS = new Set([
  "set_name",
  "rarity",
  "artist",
  "evolution_line",
  "art_style",
  "main_character",
  "background_pokemon",
  "background_humans",
  "additional_characters",
  "background_details",
  "emotion",
  "pose",
  "actions",
  "items",
  "held_item",
  "pokeball",
  "evolution_items",
  "berries",
  "card_subcategory",
  "trainer_card_subgroup",
  "holiday_theme",
  "multi_card",
  "camera_angle",
  "perspective",
  "weather",
  "environment",
  "card_locations",
  "pkmn_region",
  "card_region",
  "shape",
  "trainer_card_type",
  "stamp",
  "card_border",
  "energy_type",
  "rival_group",
  "top_10_themes",
  "wtpc_episode",
  "video_game",
  "video_game_location",
  "video_title",
  "video_type",
  "video_region",
  "video_location",
]);

export function shouldRefreshFormOptionsForAnnotationKey(key) {
  return FORM_OPTIONS_REFRESH_KEYS.has(String(key || ""));
}
