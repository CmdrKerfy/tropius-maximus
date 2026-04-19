/**
 * Map between annotations table rows and the flat annotation objects the v1 UI expects.
 */

/** Columns stored on annotations (not metadata / JSON buckets). */
export const ANNOTATION_TYPED_COLUMNS = new Set([
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
  "storytelling",
  "card_locations",
  "pkmn_region",
  "card_region",
  "primary_color",
  "secondary_color",
  "shape",
  "trainer_card_type",
  "stamp",
  "card_border",
  "energy_type",
  "rival_group",
  "image_override",
  "notes",
  "top_10_themes",
  "wtpc_episode",
  "video_game",
  "video_game_location",
  "video_appearance",
  "shorts_appearance",
  "region_appearance",
  "thumbnail_used",
  "video_url",
  "video_title",
  "video_type",
  "video_region",
  "video_location",
  "pocket_exclusive",
  "owned",
]);

export function normalizeEmbeddedAnnotation(embedded) {
  if (embedded == null) return null;
  if (Array.isArray(embedded)) return embedded[0] ?? null;
  return embedded;
}

/** Flat object for CardDetail / patchAnnotations (excludes overrides — those merge onto card). */
export function annotationRowToFlat(row) {
  if (!row) return {};
  const {
    overrides: _ov,
    extra,
    card_id,
    version,
    updated_by,
    updated_at,
    profiles: _profilesEmbed,
    ...typed
  } = row;
  const out = { ...typed };
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    Object.assign(out, extra);
  }
  for (const k of Object.keys(out)) {
    if (out[k] === null || out[k] === undefined) delete out[k];
  }
  if (updated_by != null) out.updated_by = updated_by;
  if (updated_at != null) out.updated_at = updated_at;
  return out;
}

export function parseOverrides(overrides) {
  if (!overrides || typeof overrides !== "object") return {};
  return overrides;
}

/**
 * DB defaults for first-time annotation insert (matches `002_create_annotations.sql`).
 * Merged with the partial row before `apply_annotation_with_history` RPC so
 * `jsonb_populate_record` does not write NULL over column defaults.
 */
export const ANNOTATION_ROW_INSERT_DEFAULTS = {
  art_style: [],
  main_character: [],
  background_pokemon: [],
  background_humans: [],
  additional_characters: [],
  background_details: [],
  emotion: [],
  pose: [],
  actions: [],
  items: [],
  held_item: [],
  pokeball: [],
  evolution_items: [],
  berries: [],
  card_subcategory: [],
  trainer_card_subgroup: [],
  holiday_theme: [],
  multi_card: [],
  video_type: [],
  video_region: [],
  video_location: [],
  video_appearance: false,
  shorts_appearance: false,
  region_appearance: false,
  thumbnail_used: false,
  pocket_exclusive: false,
  owned: false,
  extra: {},
  overrides: {},
  version: 1,
};

/**
 * Split a flat v1-style patch into typed columns vs extra keys.
 * @param {Record<string, unknown>} flat
 * @param {Record<string, unknown>} prevExtra
 */
export function flatToAnnotationPayload(flat, prevExtra = {}) {
  const typed = {};
  const extra = { ...prevExtra };
  for (const [k, v] of Object.entries(flat)) {
    if (
      k === "card_id" ||
      k === "version" ||
      k === "overrides" ||
      k === "updated_by" ||
      k === "updated_at"
    )
      continue;
    if (ANNOTATION_TYPED_COLUMNS.has(k)) typed[k] = v;
    else {
      if (v === null || v === undefined) delete extra[k];
      else extra[k] = v;
    }
  }
  return { typed, extra };
}
