/**
 * Card detail — which annotation fields can be pinned, grouped like the edit form (Explore drawer).
 */

export const CARD_DETAIL_PIN_MAX = 12;

/** @type {{ title: string, keys: string[] }[]} */
export const CARD_DETAIL_PIN_GROUPS = [
  {
    title: "Mon Classification",
    keys: [
      "set_name",
      "rarity",
      "artist",
      "types",
      "unique_id",
      "card_subcategory",
      "evolution_line",
      "card_border",
      "stamp",
    ],
  },
  {
    title: "Other Card Classification",
    keys: ["trainer_card_type", "trainer_card_subgroup", "energy_type"],
  },
  {
    title: "Scene & Setting",
    keys: ["pkmn_region", "card_locations", "environment", "weather", "background_details", "holiday_theme"],
  },
  {
    title: "Main Subject",
    keys: ["actions", "pose", "emotion"],
  },
  {
    title: "Background Items",
    keys: ["items", "held_item", "berries", "pokeball", "evolution_items"],
  },
  {
    title: "Additional Characters",
    keys: [
      "background_pokemon",
      "background_humans",
      "additional_characters",
      "rival_group",
      "additional_character_theme",
    ],
  },
  {
    title: "Artistic Expression",
    keys: ["art_style", "camera_angle", "perspective", "multi_card"],
  },
  {
    title: "Video Games",
    keys: ["video_game", "video_game_location"],
  },
  {
    title: "YouTube Videos",
    keys: [
      "shorts_appearance",
      "region_appearance",
      "thumbnail_used",
      "video_title",
      "video_type",
      "video_region",
      "top_10_themes",
      "wtpc_episode",
      "video_location",
    ],
  },
  {
    title: "Notes",
    keys: ["pocket_exclusive", "jumbo_card", "owned", "notes"],
  },
];

/** @type {Record<string, string>} */
export const CARD_DETAIL_PIN_LABELS = {
  set_name: "Set name",
  rarity: "Rarity",
  artist: "Artist",
  types: "Type",
  unique_id: "Unique ID",
  card_subcategory: "Card subcategory",
  evolution_line: "Evolution line",
  card_border: "Card border color",
  stamp: "Stamp",
  trainer_card_type: "Trainer card type",
  trainer_card_subgroup: "Trainer card subgroup",
  energy_type: "Energy card type",
  pkmn_region: "Featured region",
  card_locations: "Card location",
  environment: "Environment",
  weather: "Weather",
  background_details: "Background details",
  holiday_theme: "Holiday theme",
  actions: "Actions",
  pose: "Pose",
  emotion: "Emotion",
  items: "Items",
  held_item: "Held item",
  berries: "Berries (if present)",
  pokeball: "Pokeball type (if present)",
  evolution_items: "Evolution items (if present)",
  background_pokemon: "Background Pokémon",
  background_humans: "Background people type",
  additional_characters: "Background people name",
  rival_group: "Rival faction",
  additional_character_theme: "Additional character theme",
  art_style: "Art style",
  camera_angle: "Camera angle",
  perspective: "Perspective",
  multi_card: "Multi card",
  video_game: "Video game",
  video_game_location: "Video game location",
  shorts_appearance: "Shorts appearance",
  region_appearance: "Region appearance",
  thumbnail_used: "Thumbnail used",
  video_title: "Video title",
  video_type: "Video type",
  video_region: "Video region",
  top_10_themes: "Top 10 themes",
  wtpc_episode: "WTPC episode",
  video_location: "Video location",
  pocket_exclusive: "Pocket exclusive",
  jumbo_card: "Jumbo card",
  owned: "Owned",
  notes: "Notes",
};

export const CARD_DETAIL_PINNABLE_KEYS = CARD_DETAIL_PIN_GROUPS.flatMap((g) => g.keys);

const _allowed = new Set(CARD_DETAIL_PINNABLE_KEYS);

export function isCardDetailPinnableKey(key) {
  return _allowed.has(String(key || "").trim());
}

/** Normalize saved pins: allowed keys only, dedupe, preserve order, cap. */
export function normalizeCardDetailPins(raw, max = CARD_DETAIL_PIN_MAX) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .map((k) => String(k || "").trim())
    .filter((k) => {
      if (!k || !_allowed.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);
}
