/**
 * Supabase-backed implementation of db.js entry points used by the v1 UI.
 * Phase 3: browse + annotations + filters + form options (static-heavy).
 */

import { assertSupabaseConfigured, getSupabase } from "../../lib/supabaseClient.js";
import { ensureSupabaseSession } from "../../lib/supabaseAuthBootstrap.js";
import {
  normalizeEmbeddedAnnotation,
  annotationRowToFlat,
  parseOverrides,
  flatToAnnotationPayload,
  ANNOTATION_ROW_INSERT_DEFAULTS,
} from "./annotationBridge.js";
import { normalizeCardNumberForStorage } from "../../lib/manualCardId.js";
import * as annOpts from "../../lib/annotationOptions.js";
import { mergeExploreFilterOptions } from "../../lib/mergeExploreFilterOptions.js";
import { BATCH_EDIT_MAX_CARDS } from "../../lib/batchLimits.js";
import { fixDisplayText } from "../../lib/fixUtf8Mojibake.js";

export { BATCH_EDIT_MAX_CARDS };

async function sbReady() {
  await ensureSupabaseSession();
  return getSupabase();
}

function normalizeSupertypeDisplay(s) {
  if (!s || typeof s !== "string") return s;
  const norm = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (norm === "pokemon") return "Pokémon";
  const alphaOnly = s.replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (alphaOnly === "pokemon" || alphaOnly === "pokmon") return "Pokémon";
  return s;
}

function evoLabel(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.join(" → ") : raw;
  } catch {
    return raw;
  }
}

function mergeEvolutionLines(arr) {
  const seenLabels = new Set();
  const result = [];
  for (const raw of arr) {
    const s = fixDisplayText(String(raw).trim());
    if (!s) continue;
    const label = fixDisplayText(String(evoLabel(s)).trim());
    if (!label) continue;
    const key = label.toLowerCase();
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    result.push(label);
  }
  return result.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function mergeSupertypes(arr) {
  const seen = new Set();
  return arr
    .map((s) => normalizeSupertypeDisplay(s))
    .filter((s) => {
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
}

function parseJsonbStringArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const p = JSON.parse(val);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mergeSortedUniqueStrings(existing, additions) {
  const base = Array.isArray(existing) ? existing : [];
  const set = new Set(
    [...base, ...additions].filter((x) => x != null && String(x).trim() !== "")
  );
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** PostgREST/jsonb arrays from `get_explore_filter_options_db` RPC. */
function rpcJsonToStringArray(val) {
  if (!Array.isArray(val)) return [];
  return val.map((x) => (x == null ? "" : String(x))).filter((s) => s.trim() !== "");
}

function rpcJsonToNumberArray(val) {
  if (!Array.isArray(val)) return [];
  return val.map((x) => (typeof x === "number" ? x : Number(x))).filter((n) => !Number.isNaN(n));
}

function rpcJsonToSets(val) {
  if (!Array.isArray(val)) return [];
  return val
    .map((r) => {
      if (!r || typeof r !== "object") return null;
      const id = r.id != null ? String(r.id) : "";
      if (!id) return null;
      return {
        id,
        name: r.name != null ? String(r.name) : "",
        series: r.series != null ? String(r.series) : "",
      };
    })
    .filter(Boolean);
}

function buildTcgFilterOptionsFromRpc(tcg) {
  const t = tcg && typeof tcg === "object" ? tcg : {};
  const st = rpcJsonToStringArray(t.supertypes);
  const dbRegions = rpcJsonToStringArray(t.pokemon_metadata_regions);
  const regions = [...new Set([...annOpts.PKMN_REGION_OPTIONS, ...dbRegions])].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const generations = rpcJsonToNumberArray(t.generations).sort((a, b) => a - b);
  const colors = rpcJsonToStringArray(t.colors);
  const evoRaw = rpcJsonToStringArray(t.evo_raw);
  const evolution_lines = mergeEvolutionLines(evoRaw);
  const sets = rpcJsonToSets(t.sets);
  const merge = (staticOpts, dbVals) => [...new Set([...staticOpts, ...dbVals])];
  return {
    supertypes: mergeSupertypes(st),
    rarities: rpcJsonToStringArray(t.rarities).sort(),
    sets,
    regions,
    generations,
    colors,
    artists: rpcJsonToStringArray(t.artists).sort(),
    evolution_lines,
    trainer_types: [],
    specialties: [],
    background_pokemon: merge([], rpcJsonToStringArray(t.pokemon_metadata_names)),
    card_types: [],
    elements: [],
    stages: [],
    weathers: mergeSortedUniqueStrings(annOpts.WEATHER_OPTIONS, rpcJsonToStringArray(t.annotations_weather)),
    environments: mergeSortedUniqueStrings(
      annOpts.ENVIRONMENT_OPTIONS,
      rpcJsonToStringArray(t.annotations_environment)
    ),
    actions: mergeSortedUniqueStrings(annOpts.ACTIONS_OPTIONS, []),
    poses: mergeSortedUniqueStrings(annOpts.POSE_OPTIONS, []),
  };
}

function buildPocketFilterOptionsFromRpc(pocket) {
  const p = pocket && typeof pocket === "object" ? pocket : {};
  return {
    supertypes: [],
    rarities: rpcJsonToStringArray(p.rarities).sort(),
    sets: rpcJsonToSets(p.sets),
    regions: [],
    generations: [],
    colors: [],
    artists: [],
    evolution_lines: [],
    trainer_types: [],
    specialties: [],
    background_pokemon: [],
    card_types: rpcJsonToStringArray(p.card_types).sort(),
    elements: rpcJsonToStringArray(p.elements).sort(),
    stages: rpcJsonToStringArray(p.stages).sort(),
    weathers: [],
    environments: [],
    actions: [],
    poses: [],
  };
}

function buildCustomFilterOptionsFromRpc(custom) {
  const c = custom && typeof custom === "object" ? custom : {};
  return {
    supertypes: mergeSupertypes(rpcJsonToStringArray(c.supertypes)),
    rarities: rpcJsonToStringArray(c.rarities).sort(),
    sets: rpcJsonToSets(c.sets),
    regions: [],
    generations: [],
    colors: [],
    artists: rpcJsonToStringArray(c.artists).sort(),
    evolution_lines: [],
    trainer_types: [],
    specialties: [],
    background_pokemon: [],
    card_types: [],
    elements: [],
    stages: [],
    weathers: [],
    environments: [],
    actions: [],
    poses: [],
  };
}

async function fetchExploreFilterOptionsClientPaged() {
  const [tcg, pocket, custom] = await Promise.all([
    fetchFilterOptions("TCG"),
    fetchFilterOptions("Pocket"),
    fetchFilterOptions("Custom"),
  ]);
  return mergeExploreFilterOptions(tcg, pocket, custom);
}

/** DB JSONB array column → camelCase key on fetchFormOptions() result. */
const ANN_JSONB_ARRAY_TO_FORM = {
  art_style: "artStyle",
  main_character: "mainCharacter",
  background_pokemon: "backgroundPokemon",
  background_humans: "backgroundHumans",
  additional_characters: "additionalCharacters",
  background_details: "backgroundDetails",
  emotion: "emotion",
  pose: "pose",
  actions: "actions",
  items: "items",
  held_item: "heldItem",
  pokeball: "pokeball",
  evolution_items: "evolutionItems",
  berries: "berries",
  card_subcategory: "cardSubcategory",
  trainer_card_subgroup: "trainerCardSubgroup",
  holiday_theme: "holidayTheme",
  multi_card: "multiCard",
  video_type: "videoType",
  video_region: "videoRegion",
  video_location: "videoLocation",
};

/** DB TEXT column → camelCase key on fetchFormOptions() result. */
const ANN_TEXT_TO_FORM = {
  camera_angle: "cameraAngle",
  perspective: "perspective",
  weather: "weather",
  environment: "environment",
  storytelling: "storytelling",
  card_locations: "cardLocations",
  pkmn_region: "pkmnRegion",
  card_region: "cardRegion",
  primary_color: "primaryColor",
  secondary_color: "secondaryColor",
  shape: "shape",
  trainer_card_type: "trainerCardType",
  stamp: "stamp",
  card_border: "cardBorder",
  energy_type: "energyType",
  rival_group: "rivalGroup",
  top_10_themes: "top10Themes",
  wtpc_episode: "wtpcEpisode",
  video_game: "videoGame",
  video_game_location: "videoGameLocation",
  video_title: "videoTitle",
};

/**
 * Union values already used on annotations into form option lists (paged full-table scan).
 * Keeps static/curated lists and adds distinct typed-column usage.
 */
async function mergeAnnotationUsageIntoOptions(out) {
  const sb = await sbReady();
  const jsonbCols = Object.keys(ANN_JSONB_ARRAY_TO_FORM);
  const textCols = Object.keys(ANN_TEXT_TO_FORM);
  const allCols = [...jsonbCols, ...textCols];
  const selectList = allCols.join(", ");

  const setsByCol = {};
  for (const c of allCols) setsByCol[c] = new Set();

  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("annotations")
      .select(selectList)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      for (const col of jsonbCols) {
        for (const el of parseJsonbStringArray(row[col])) {
          const s = typeof el === "string" ? el.trim() : String(el).trim();
          if (s) setsByCol[col].add(s);
        }
      }
      for (const col of textCols) {
        const v = row[col];
        if (v != null && String(v).trim() !== "") setsByCol[col].add(String(v).trim());
      }
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  for (const col of jsonbCols) {
    const fk = ANN_JSONB_ARRAY_TO_FORM[col];
    out[fk] = mergeSortedUniqueStrings(out[fk], [...setsByCol[col]]);
  }
  for (const col of textCols) {
    const fk = ANN_TEXT_TO_FORM[col];
    out[fk] = mergeSortedUniqueStrings(out[fk], [...setsByCol[col]]);
  }
}

/** Same merges as mergeAnnotationUsageIntoOptions using `get_form_options_db` payload. */
function mergeAnnotationUsageIntoOptionsFromRpc(out, annPayload) {
  if (!annPayload || typeof annPayload !== "object") return;
  for (const col of Object.keys(ANN_JSONB_ARRAY_TO_FORM)) {
    const fk = ANN_JSONB_ARRAY_TO_FORM[col];
    const extra = rpcJsonToStringArray(annPayload[col]);
    out[fk] = mergeSortedUniqueStrings(out[fk], extra);
  }
  for (const col of Object.keys(ANN_TEXT_TO_FORM)) {
    const fk = ANN_TEXT_TO_FORM[col];
    const extra = rpcJsonToStringArray(annPayload[col]);
    out[fk] = mergeSortedUniqueStrings(out[fk], extra);
  }
}

function buildFormOptionsFromRpcPayload(data) {
  const merge = (a, b) => [...new Set([...a, ...b])];
  const cards = data.cards && typeof data.cards === "object" ? data.cards : {};
  const pm = data.pokemon_metadata && typeof data.pokemon_metadata === "object" ? data.pokemon_metadata : {};
  const ann = data.annotations && typeof data.annotations === "object" ? data.annotations : {};

  const rarity = rpcJsonToStringArray(cards.rarity).sort();
  const artist = rpcJsonToStringArray(cards.artist).sort();
  const names = rpcJsonToStringArray(cards.name).sort();

  const setRows = Array.isArray(data.sets) ? data.sets : [];
  const setSeries = [...new Set(setRows.map((r) => r?.series).filter(Boolean))].sort();
  const setId = [...new Set(setRows.map((r) => (r?.id != null ? String(r.id) : "")).filter(Boolean))].sort();
  const setName = [...new Set(setRows.map((r) => r?.name).filter(Boolean))].sort();

  const dbRegions = rpcJsonToStringArray(pm.regions);
  const pkmnMerged = merge(annOpts.PKMN_REGION_OPTIONS, dbRegions).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  const out = {
    rarity,
    artist,
    pkmnRegion: pkmnMerged,
    cardRegion: pkmnMerged,
    setSeries,
    types: [],
    subtypes: [],
    emotion: [...annOpts.EMOTION_OPTIONS],
    pose: [...annOpts.POSE_OPTIONS],
    cameraAngle: [...annOpts.CAMERA_ANGLE_OPTIONS],
    perspective: [...annOpts.PERSPECTIVE_OPTIONS],
    weather: [...annOpts.WEATHER_OPTIONS],
    environment: [...annOpts.ENVIRONMENT_OPTIONS],
    storytelling: [],
    cardLocations: [...annOpts.CARD_LOCATIONS_OPTIONS],
    items: [...annOpts.ITEMS_OPTIONS],
    actions: [...annOpts.ACTIONS_OPTIONS],
    videoTitle: [],
    setId,
    setName,
    name: names,
    source: [...annOpts.SOURCE_OPTIONS],
    heldItem: [...annOpts.HELD_ITEM_OPTIONS],
    pokeball: [...annOpts.POKEBALL_OPTIONS],
    trainerCardType: [...annOpts.TRAINER_CARD_TYPE_OPTIONS],
    stamp: [...annOpts.STAMP_OPTIONS],
    artStyle: [...annOpts.ART_STYLE_OPTIONS],
    mainCharacter: [],
    backgroundPokemon: merge([], rpcJsonToStringArray(pm.names)),
    backgroundHumans: [...annOpts.BACKGROUND_HUMANS_OPTIONS],
    additionalCharacters: [...annOpts.ADDITIONAL_CHARACTERS_OPTIONS],
    backgroundDetails: [...annOpts.BACKGROUND_DETAILS_OPTIONS],
    evolutionLine: mergeEvolutionLines(rpcJsonToStringArray(pm.evo_raw)),
    cardSubcategory: [...annOpts.CARD_SUBCATEGORY_OPTIONS],
    evolutionItems: [...annOpts.EVOLUTION_ITEMS_OPTIONS],
    berries: [...annOpts.BERRIES_OPTIONS],
    holidayTheme: [...annOpts.HOLIDAY_THEME_OPTIONS],
    multiCard: [...annOpts.MULTI_CARD_OPTIONS],
    trainerCardSubgroup: [...annOpts.TRAINER_CARD_SUBGROUP_OPTIONS],
    videoType: [...annOpts.VIDEO_TYPE_OPTIONS],
    videoRegion: [...annOpts.VIDEO_REGION_OPTIONS],
    videoLocation: [...annOpts.VIDEO_LOCATION_OPTIONS],
    cardBorder: [...annOpts.CARD_BORDER_OPTIONS],
    energyType: [...annOpts.ENERGY_TYPE_OPTIONS],
    rivalGroup: [...annOpts.RIVAL_GROUP_OPTIONS],
    primaryColor: [],
    secondaryColor: [],
    shape: [],
    top10Themes: [],
    wtpcEpisode: [],
    videoGame: [],
    videoGameLocation: [],
    additionalCharacterTheme: [],
  };

  mergeAnnotationUsageIntoOptionsFromRpc(out, ann);
  return out;
}

/** Paginated distinct values for a scalar column on `cards` (dev-costly but no RPC required). */
async function distinctColumn(column, originFilter) {
  const sb = await sbReady();
  const values = new Set();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    let q = sb.from("cards").select(column).range(from, from + pageSize - 1);
    if (originFilter) q = q.eq("origin", originFilter);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const v = row[column];
      if (v != null && v !== "") values.add(v);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return [...values];
}

/** Distinct non-empty scalar fields on `annotations` (weather, environment, etc.). */
async function distinctAnnotationColumn(column) {
  const sb = await sbReady();
  const values = new Set();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("annotations")
      .select(column)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const v = row[column];
      if (v != null && v !== "") values.add(v);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return [...values];
}

function stripUndefined(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) o[k] = v;
  }
  return o;
}

/** Annotation columns stored as JSONB arrays (see `002_create_annotations.sql`). */
const ANNOTATION_JSONB_COLUMNS = new Set([
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
  "video_type",
  "video_region",
  "video_location",
]);

const ANNOTATION_BOOLEAN_COLUMNS = new Set([
  "video_appearance",
  "shorts_appearance",
  "region_appearance",
  "thumbnail_used",
  "pocket_exclusive",
  "owned",
]);

/** Single-value TEXT columns on `annotations` (form sometimes sends string[]). */
const ANNOTATION_TEXT_SCALAR_KEYS = new Set([
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
  "video_url",
  "video_title",
]);

function coerceAnnotationTextScalars(flat) {
  const out = { ...flat };
  for (const k of ANNOTATION_TEXT_SCALAR_KEYS) {
    if (!(k in out)) continue;
    const v = out[k];
    if (Array.isArray(v)) out[k] = v.join(", ") || null;
    else if (typeof v === "string" && v.trim() === "") out[k] = null;
  }
  return out;
}

function coerceJsonbArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    const t = val.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeAnnotationFlatForDb(flat) {
  const out = { ...flat };
  for (const k of ANNOTATION_JSONB_COLUMNS) {
    if (k in out) out[k] = coerceJsonbArray(out[k]);
  }
  for (const k of ANNOTATION_BOOLEAN_COLUMNS) {
    if (k in out) out[k] = Boolean(out[k]);
  }
  return out;
}

async function attachProfileDisplayNames(sb, rows) {
  if (!rows?.length) return [];
  const ids = [...new Set(rows.map((r) => r.edited_by).filter(Boolean))];
  if (!ids.length) {
    return rows.map((r) => ({ ...r, editor_display_name: null }));
  }
  const { data: profs, error } = await sb.from("profiles").select("id, display_name").in("id", ids);
  if (error) throw error;
  const map = new Map((profs || []).map((p) => [p.id, p.display_name]));
  return rows.map((r) => ({
    ...r,
    editor_display_name: r.edited_by ? map.get(r.edited_by) ?? null : null,
  }));
}

function pickAnnotationFlatFromCustomCard(card, skipKeys) {
  const flat = {};
  for (const [k, v] of Object.entries(card)) {
    if (skipKeys.has(k)) continue;
    if (v === undefined) continue;
    flat[k] = v;
  }
  return coerceAnnotationTextScalars(normalizeAnnotationFlatForDb(flat));
}

async function ensureManualSetRow(sb, setId, setName) {
  const sid = String(setId || "").trim();
  if (!sid) throw new Error("Set ID is required.");
  const name = String(setName || sid).trim() || sid;
  const { error } = await sb.from("sets").insert({ id: sid, name, origin: "manual" });
  if (error && error.code !== "23505") throw error;
}

async function insertInitialAnnotationForCard(sb, cardId, flat, updatedBy) {
  const { typed, extra } = flatToAnnotationPayload(flat, {});
  const row = stripUndefined({
    card_id: cardId,
    ...typed,
    extra,
    version: 1,
    updated_by: updatedBy ?? null,
  });
  const { error } = await sb.from("annotations").insert(row);
  if (error) throw error;
}

/**
 * Value for PostgREST `.or('col.eq.VALUE,...')` (handles spaces/special chars in artist names).
 */
function postgrestOrEqValue(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** JSON value for PostgREST `cs` (jsonb @>) with a one-element string array. */
function jsonbArrayContainsOneString(s) {
  return JSON.stringify([String(s)]);
}

/** `profiles` row from PostgREST embed (object or single-element array). */
function displayNameFromProfileEmbed(embed) {
  if (embed == null) return null;
  const p = Array.isArray(embed) ? embed[0] : embed;
  if (!p || typeof p !== "object") return null;
  const n = p.display_name;
  if (n == null || String(n).trim() === "") return null;
  return String(n).trim();
}

function gridRowFromCard(row) {
  const ann = normalizeEmbeddedAnnotation(row.annotations);
  const created_by = row.created_by ?? null;
  const annotation_updated_by = ann?.updated_by ?? null;
  const annotation_updated_at = ann?.updated_at ?? null;
  return {
    id: row.id,
    name: row.name,
    set_id: row.set_id ?? null,
    set_name: row.set_name,
    image_small: row.image_small,
    image_large: row.image_large,
    image_override: ann?.image_override || null,
    number: row.number,
    hp: row.hp,
    rarity: row.rarity,
    is_custom: row.origin === "manual",
    created_by,
    creator_display_name: created_by ? displayNameFromProfileEmbed(row.profiles) : null,
    annotation_updated_by,
    annotation_updated_at,
    annotation_editor_display_name: annotation_updated_by
      ? displayNameFromProfileEmbed(ann?.profiles)
      : null,
  };
}

/**
 * Paginated card grid for Explore (and batch tooling).
 * @param {object} [params]
 * @param {boolean} [params.exact_count] — If true, use `count: exact` (batch confirm, ID lists).
 *   Default false uses planner `count: planned` for faster Explore totals.
 */
export async function fetchCards(params = {}) {
  const sb = await sbReady();
  const {
    q = "",
    supertype = "",
    rarity = [],
    set_id = [],
    element = [],
    artist = [],
    evolution_line = [],
    region = [],
    weather = [],
    environment = [],
    specialty = [],
    background_pokemon = [],
    actions = [],
    pose = [],
    source = "TCG",
    sort_by = "name",
    sort_dir = "asc",
    page = 1,
    page_size = 40,
    exact_count = false,
  } = params;

  const pageInt = parseInt(page, 10) || 1;
  const pageSizeInt = parseInt(page_size, 10) || 40;
  const offset = (pageInt - 1) * pageSizeInt;
  const ascending = sort_dir !== "desc";

  const sortMap = {
    name: "name",
    number: "number_sort_key",
    hp: "hp",
    rarity: "rarity",
    set_name: "set_name",
    /** Row insert time in Postgres (API/manual ingest); good for “new to database” ordering. */
    recent: "created_at",
  };
  const orderCol = sortMap[sort_by] || "name";

  const hasRegion = Array.isArray(region) && region.length > 0;
  const hasWeather = Array.isArray(weather) && weather.length > 0;
  const hasEnvironment = Array.isArray(environment) && environment.length > 0;
  const hasBg = Array.isArray(background_pokemon) && background_pokemon.length > 0;
  const hasActions = Array.isArray(actions) && actions.length > 0;
  const hasPose = Array.isArray(pose) && pose.length > 0;
  const useAnnInner =
    hasRegion || hasWeather || hasEnvironment || hasBg || hasActions || hasPose;

  // Grid only: omit profiles embeds — nested embeds can interact badly with nullable FKs
  // under some PostgREST versions; creator/editor names are optional here (detail view embeds).
  const annSelect = useAnnInner
    ? `annotations!inner(image_override, weather, environment, pkmn_region, background_pokemon, actions, pose, updated_by, updated_at)`
    : `annotations(image_override, updated_by, updated_at)`;

  let query = sb
    .from("cards")
    .select(
      `id, name, set_id, set_name, image_small, image_large, number, hp, rarity, origin, supertype, subtypes, created_by, ${annSelect}`,
      { count: exact_count ? "exact" : "planned" }
    );

  if (source === "TCG") {
    query = query.in("origin", ["pokemontcg.io", "manual"]);
  } else if (source === "Pocket") {
    query = query.eq("origin", "tcgdex");
  } else if (source === "Custom") {
    query = query.eq("origin", "manual");
  } else {
    // Source "All" (empty string) — every origin
    query = query.in("origin", ["pokemontcg.io", "manual", "tcgdex"]);
  }

  if (q) query = query.ilike("name", `%${q}%`);

  if (supertype) {
    const norm = supertype.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (norm === "pokemon") {
      query = query.or("supertype.eq.Pokémon,supertype.eq.Pokemon");
    } else {
      query = query.eq("supertype", supertype);
    }
  }

  if (Array.isArray(rarity) && rarity.length) query = query.in("rarity", rarity);
  if (Array.isArray(set_id) && set_id.length) query = query.in("set_id", set_id);

  if (Array.isArray(element) && element.length) {
    if (source === "Pocket") {
      query = query.in("element", element);
    } else if (source === "") {
      const clauses = [];
      for (const e of element) {
        clauses.push(`types.cs.${jsonbArrayContainsOneString(e)}`);
        clauses.push(`element.eq.${postgrestOrEqValue(e)}`);
      }
      query = query.or(clauses.join(","));
    } else {
      const parts = element.map((e) => `types.cs.${jsonbArrayContainsOneString(e)}`);
      query = query.or(parts.join(","));
    }
  }

  if (Array.isArray(artist) && artist.length) {
    if (source === "Pocket") {
      query = query.in("illustrator", artist);
    } else if (source === "") {
      const clauses = [];
      for (const a of artist) {
        const e = postgrestOrEqValue(a);
        clauses.push(`artist.eq.${e}`);
        clauses.push(`illustrator.eq.${e}`);
      }
      query = query.or(clauses.join(","));
    } else {
      query = query.in("artist", artist);
    }
  }

  if (Array.isArray(evolution_line) && evolution_line.length) {
    query = query.in("evolution_line", evolution_line);
  }

  if (hasRegion) query = query.in("annotations.pkmn_region", region);
  if (hasWeather) query = query.in("annotations.weather", weather);
  if (hasEnvironment) query = query.in("annotations.environment", environment);

  if (hasBg) {
    const parts = background_pokemon.map((p) => {
      const j = jsonbArrayContainsOneString(String(p).toLowerCase());
      return `background_pokemon.cs.${j}`;
    });
    query = query.or(parts.join(","), { referencedTable: "annotations" });
  }
  if (hasActions) {
    const parts = actions.map((a) => `actions.cs.${jsonbArrayContainsOneString(a)}`);
    query = query.or(parts.join(","), { referencedTable: "annotations" });
  }
  if (hasPose) {
    const parts = pose.map((p) => `pose.cs.${jsonbArrayContainsOneString(p)}`);
    query = query.or(parts.join(","), { referencedTable: "annotations" });
  }

  if (Array.isArray(specialty) && specialty.length) {
    const parts = specialty.map((s) => `subtypes.cs.${jsonbArrayContainsOneString(s)}`);
    query = query.or(parts.join(","));
  }

  // number_sort_key (generated) avoids lexicographic sort on TEXT `number`.
  query = query.order(orderCol, { ascending, nullsFirst: false });
  if (sort_by === "number") {
    query = query.order("id", { ascending: true, nullsFirst: false });
  } else if (sort_by === "recent") {
    // Keep "recent desc" stable when many rows share near-identical created_at.
    query = query.order("id", { ascending, nullsFirst: false });
  }
  query = query.range(offset, offset + pageSizeInt - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const cards = (data || []).map((row) => gridRowFromCard(row));
  return { cards, total: count ?? cards.length, page: pageInt, page_size: pageSizeInt };
}

const BATCH_ID_PAGE_SIZE = 500;

/**
 * First `limit` card IDs matching the same filters as `fetchCards` (stable server sort order).
 * Use for Explore "select all matching" when total may exceed {@link BATCH_EDIT_MAX_CARDS}.
 * @returns {{ ids: string[], totalMatch: number, capped: boolean }}
 */
export async function fetchFirstNMatchingCardIds(params = {}, limit = BATCH_EDIT_MAX_CARDS) {
  const { page: _p, page_size: _ps, ...rest } = params;
  const probe = await fetchCards({ ...rest, page: 1, page_size: 1, exact_count: true });
  const totalMatch = typeof probe.total === "number" ? probe.total : 0;
  const cap = Math.min(Math.max(0, limit), totalMatch);
  if (cap === 0) {
    return { ids: [], totalMatch, capped: false };
  }
  const ids = [];
  let page = 1;
  while (ids.length < cap) {
    const pageSize = Math.min(BATCH_ID_PAGE_SIZE, cap - ids.length);
    const { cards } = await fetchCards({
      ...rest,
      page,
      page_size: pageSize,
      exact_count: true,
    });
    for (const c of cards) {
      ids.push(c.id);
      if (ids.length >= cap) break;
    }
    if (!cards || cards.length === 0) break;
    page++;
  }
  return { ids, totalMatch, capped: totalMatch > cap };
}

const BATCH_WIZARD_PREVIEW_LIMIT = 48;
const CARD_NAME_FETCH_CHUNK = 200;

/**
 * Minimal rows for Batch wizard review (first N ids in list order).
 * @param {string[]} cardIds
 * @param {string} fieldKey
 * @returns {{ cards: { id: string, name: string | null, image_small: string | null, image_large: string | null, previousValue: unknown }[] }}
 */
export async function fetchBatchWizardPreview(cardIds, fieldKey) {
  const sb = await sbReady();
  const chunk = cardIds.slice(0, BATCH_WIZARD_PREVIEW_LIMIT).filter(Boolean);
  if (chunk.length === 0) return { cards: [] };
  const { data, error } = await sb
    .from("cards")
    .select("id, name, image_small, image_large, annotations(*)")
    .in("id", chunk);
  if (error) throw error;
  const byId = new Map((data || []).map((row) => [row.id, row]));
  return {
    cards: chunk.map((id) => {
      const row = byId.get(id);
      if (!row) {
        return { id, name: null, image_small: null, image_large: null, previousValue: null };
      }
      const ann = normalizeEmbeddedAnnotation(row.annotations);
      const flat = annotationRowToFlat(ann);
      const previousValue = flat[fieldKey];
      return {
        id: row.id,
        name: row.name,
        image_small: row.image_small,
        image_large: row.image_large,
        previousValue: previousValue === undefined ? null : previousValue,
      };
    }),
  };
}

/**
 * @param {string[]} cardIds
 * @returns {Record<string, string>}
 */
export async function fetchCardNamesByIds(cardIds) {
  const sb = await sbReady();
  const chunk = [...new Set(cardIds.filter(Boolean))];
  if (chunk.length === 0) return {};
  const out = {};
  for (let i = 0; i < chunk.length; i += CARD_NAME_FETCH_CHUNK) {
    const slice = chunk.slice(i, i + CARD_NAME_FETCH_CHUNK);
    const { data, error } = await sb.from("cards").select("id, name").in("id", slice);
    if (error) throw error;
    for (const c of data || []) out[c.id] = c.name || "";
  }
  return out;
}

/**
 * @param {string[]} cardIds
 * @returns {Promise<Record<string, { image_small: string | null, image_large: string | null, name: string | null }>>}
 */
export async function fetchCardThumbnailsByIds(cardIds) {
  const sb = await sbReady();
  const chunk = [...new Set(cardIds.filter(Boolean))];
  if (chunk.length === 0) return {};
  const out = {};
  for (let i = 0; i < chunk.length; i += CARD_NAME_FETCH_CHUNK) {
    const slice = chunk.slice(i, i + CARD_NAME_FETCH_CHUNK);
    const { data, error } = await sb.from("cards").select("id, name, image_small, image_large").in("id", slice);
    if (error) throw error;
    for (const c of data || []) {
      out[c.id] = {
        image_small: c.image_small || null,
        image_large: c.image_large || null,
        name: c.name || null,
      };
    }
  }
  return out;
}

/**
 * All card IDs matching the same filters as `fetchCards` (paginates internally).
 * @param {object} params — same as fetchCards; `page` / `page_size` are ignored
 */
export async function fetchMatchingCardIds(params = {}) {
  const { page: _p, page_size: _ps, ...rest } = params;
  const probe = await fetchCards({ ...rest, page: 1, page_size: 1, exact_count: true });
  if (probe.total > BATCH_EDIT_MAX_CARDS) {
    throw new Error(
      `This filter matches more than ${BATCH_EDIT_MAX_CARDS.toLocaleString()} cards. Narrow filters on Explore, then try again.`
    );
  }
  const ids = [];
  let page = 1;
  for (;;) {
    const { cards, total } = await fetchCards({
      ...rest,
      page,
      page_size: BATCH_ID_PAGE_SIZE,
      exact_count: true,
    });
    for (const c of cards) ids.push(c.id);
    if (ids.length >= total || cards.length === 0) break;
    page++;
  }
  return ids;
}

/**
 * Apply the same annotation patch to many cards (sequential; survives partial failures).
 * @param {{ onProgress?: (done: number, total: number) => void }} [options]
 * @returns {{ updated: number, errors: { cardId: string, message: string }[] }}
 */
export async function batchPatchAnnotations(cardIds, patch, options = {}) {
  const { onProgress, batchRunId } = options;
  const errors = [];
  let updated = 0;
  const total = cardIds.length;
  for (let i = 0; i < total; i++) {
    const cardId = cardIds[i];
    try {
      await patchAnnotations(cardId, patch, { batchRunId });
      updated++;
    } catch (e) {
      errors.push({ cardId, message: e?.message || String(e) });
    }
    onProgress?.(i + 1, total);
  }
  return { updated, errors };
}

export async function fetchCard(id, _source = "TCG") {
  const sb = await sbReady();
  const { data: row, error } = await sb
    .from("cards")
    .select(
      "*, profiles!cards_created_by_fkey(display_name), annotations(*, profiles!annotations_updated_by_fkey(display_name))"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!row) throw new Error("Card not found");

  const isPocket = row.origin === "tcgdex";

  const annRow = normalizeEmbeddedAnnotation(row.annotations);
  const creator_display_name = row.created_by ? displayNameFromProfileEmbed(row.profiles) : null;
  const annotation_editor_display_name = annRow?.updated_by
    ? displayNameFromProfileEmbed(annRow.profiles)
    : null;

  const raw_data =
    row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {};
  const pokedex_numbers = raw_data?.nationalPokedexNumbers || [];

  // Pocket cards do not use pokemon_metadata in the returned shape; skip the extra round trip.
  let pm = null;
  if (!isPocket) {
    const dex = pokedex_numbers[0];
    if (dex != null) {
      const { data: pmd } = await sb
        .from("pokemon_metadata")
        .select("*")
        .eq("pokedex_number", dex)
        .maybeSingle();
      pm = pmd;
    }
  }

  const overrides = parseOverrides(annRow?.overrides);
  const baseCard = { ...row };
  delete baseCard.annotations;
  delete baseCard.profiles;
  const merged = { ...baseCard, ...overrides };

  const annotations = annotationRowToFlat(annRow);
  // Legacy v1 annotation field: duplicate of cards.id for "Unique ID" in UI; prefer cards.id for new code.
  if (!annotations.unique_id) annotations.unique_id = id;

  const prices = row.prices && typeof row.prices === "object" ? row.prices : {};

  if (isPocket) {
    const weaknesses = row.weakness ? [{ type: row.weakness, value: "" }] : [];
    return {
      id: row.id,
      name: row.name,
      supertype: normalizeSupertypeDisplay(row.card_type || ""),
      subtypes: "[]",
      hp: row.hp,
      types: row.element ? JSON.stringify([row.element]) : "[]",
      evolves_from: row.evolves_from || null,
      rarity: row.rarity,
      artist: row.artist || null,
      set_id: row.set_id,
      set_name: row.set_name,
      set_series: row.set_series,
      number: String(row.number),
      regulation_mark: null,
      image_small: merged.image_small || row.image_small,
      image_large: merged.image_large || row.image_large,
      image_fallback: row.image_small || row.image_large,
      raw_data: { ...raw_data, weaknesses },
      annotations,
      prices: null,
      pokedex_numbers: [],
      genus: null,
      stage: row.stage || null,
      packs: Array.isArray(row.packs) ? row.packs : [],
      retreat_cost: row.retreat_cost,
      element: row.element || null,
      source: "Pocket",
      is_custom: false,
      created_by: row.created_by ?? null,
      created_at: row.created_at ?? null,
      creator_display_name,
      annotation_editor_display_name,
    };
  }

  return {
    id: merged.id,
    name: merged.name,
    alt_name: null,
    supertype: normalizeSupertypeDisplay(merged.supertype || ""),
    subtypes: JSON.stringify(merged.subtypes ?? []),
    hp: merged.hp,
    types: JSON.stringify(merged.types ?? []),
    evolves_from: merged.evolves_from ?? null,
    rarity: merged.rarity,
    special_rarity: null,
    artist: merged.artist,
    set_id: merged.set_id,
    set_name: merged.set_name,
    set_series: merged.set_series,
    number: merged.number,
    regulation_mark: merged.regulation_mark ?? null,
    image_small: merged.image_small || merged.image_large,
    image_large: merged.image_large,
    image_fallback:
      merged.origin === "manual"
        ? merged.image_large || merged.image_small || undefined
        : undefined,
    raw_data,
    annotations,
    prices,
    pokedex_numbers,
    genus: pm?.genus || null,
    source: merged.origin === "manual" ? merged.origin_detail || "TCG" : "TCG",
    is_custom: merged.origin === "manual",
    created_by: row.created_by ?? null,
    created_at: row.created_at ?? null,
    creator_display_name,
    annotation_editor_display_name,
  };
}

/**
 * Single card JSON for public /share/card/:id — no session required (RPC granted to anon).
 * @returns {Promise<object | null>}
 */
export async function fetchPublicCardForShare(cardId) {
  assertSupabaseConfigured();
  const sb = getSupabase();
  const id = String(cardId ?? "").trim();
  if (!id) return null;
  const { data, error } = await sb.rpc("get_public_card_for_share", { p_card_id: id });
  if (error) throw error;
  if (data == null || data === undefined) return null;
  return typeof data === "object" ? data : null;
}

export async function fetchFilterOptions(source = "TCG") {
  const sb = await sbReady();

  if (source === "Pocket") {
    const [card_types, rarities, elements, stages, setsData] = await Promise.all([
      distinctColumn("card_type", "tcgdex"),
      distinctColumn("rarity", "tcgdex"),
      distinctColumn("element", "tcgdex"),
      distinctColumn("stage", "tcgdex"),
      sb.from("sets").select("id, name, series").eq("origin", "tcgdex"),
    ]);
    const sets = (setsData.data || []).map((r) => ({
      id: r.id,
      name: r.name,
      series: r.series,
    }));
    return {
      supertypes: [],
      rarities: rarities.sort(),
      sets,
      regions: [],
      generations: [],
      colors: [],
      artists: [],
      evolution_lines: [],
      trainer_types: [],
      specialties: [],
      background_pokemon: [],
      card_types: card_types.sort(),
      elements: elements.sort(),
      stages: stages.sort(),
      weathers: [],
      environments: [],
      actions: [],
      poses: [],
    };
  }

  if (source === "Custom") {
    const [st, rar, setsData, artists] = await Promise.all([
      distinctColumn("supertype", "manual"),
      distinctColumn("rarity", "manual"),
      sb.from("sets").select("id, name, series").eq("origin", "manual"),
      distinctColumn("artist", "manual"),
    ]);
    return {
      supertypes: mergeSupertypes(st),
      rarities: rar.sort(),
      sets: (setsData.data || []).map((r) => ({
        id: r.id,
        name: r.name,
        series: r.series,
      })),
      regions: [],
      generations: [],
      colors: [],
      artists: artists.sort(),
      evolution_lines: [],
      trainer_types: [],
      specialties: [],
      background_pokemon: [],
      card_types: [],
      elements: [],
      stages: [],
      weathers: [],
      environments: [],
      actions: [],
      poses: [],
    };
  }

  // TCG + custom (all non-Pocket)
  const originList = ["pokemontcg.io", "manual"];
  const [st, rar, setsData, artists, pmRegions, pmGens, pmColors, pmEvo] =
    await Promise.all([
      (async () => {
        const acc = new Set();
        for (const o of originList) {
          for (const v of await distinctColumn("supertype", o)) acc.add(v);
        }
        return [...acc];
      })(),
      (async () => {
        const acc = new Set();
        for (const o of originList) {
          for (const v of await distinctColumn("rarity", o)) acc.add(v);
        }
        return [...acc];
      })(),
      sb
        .from("sets")
        .select("id, name, series")
        .in("origin", ["pokemontcg.io", "tcgdex", "manual"]),
      (async () => {
        const acc = new Set();
        for (const o of originList) {
          for (const v of await distinctColumn("artist", o)) acc.add(v);
        }
        return [...acc];
      })(),
      sb.from("pokemon_metadata").select("region"),
      sb.from("pokemon_metadata").select("generation"),
      sb.from("pokemon_metadata").select("color"),
      sb.from("pokemon_metadata").select("evolution_chain"),
    ]);

  const dbRegions = [
    ...new Set((pmRegions.data || []).map((r) => r.region).filter(Boolean)),
  ].sort();
  const regions = [...new Set([...annOpts.PKMN_REGION_OPTIONS, ...dbRegions])].sort();
  const generations = [
    ...new Set(
      (pmGens.data || [])
        .map((r) => r.generation)
        .filter((g) => g != null)
    ),
  ].sort((a, b) => a - b);
  const colors = [
    ...new Set((pmColors.data || []).map((r) => r.color).filter(Boolean)),
  ].sort();

  const evoRaw = (pmEvo.data || [])
    .map((r) => {
      const c = r.evolution_chain;
      if (c == null) return null;
      return typeof c === "object" ? JSON.stringify(c) : String(c);
    })
    .filter(Boolean);
  const evolution_lines = mergeEvolutionLines(evoRaw);

  const sets = (setsData.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    series: r.series,
  }));

  const merge = (staticOpts, dbVals) => [...new Set([...staticOpts, ...dbVals])];

  return {
    supertypes: mergeSupertypes(st),
    rarities: rar.sort(),
    sets,
    regions,
    generations,
    colors,
    artists: artists.sort(),
    evolution_lines,
    trainer_types: [],
    specialties: [],
    background_pokemon: merge(
      [],
      (await sb.from("pokemon_metadata").select("name")).data?.map((r) => r.name) ||
        []
    ),
    card_types: [],
    elements: [],
    stages: [],
    weathers: merge(
      annOpts.WEATHER_OPTIONS,
      await distinctAnnotationColumn("weather")
    ),
    environments: merge(
      annOpts.ENVIRONMENT_OPTIONS,
      await distinctAnnotationColumn("environment")
    ),
    actions: merge(annOpts.ACTIONS_OPTIONS, []),
    poses: merge(annOpts.POSE_OPTIONS, []),
  };
}

/** Explore: one merged option list so changing Source does not hide/show filter dropdowns. */
export async function fetchExploreFilterOptions() {
  const sb = await sbReady();
  // Phase 6 rollback: set VITE_USE_FILTER_OPTIONS_RPC=false to skip RPC (many paged reads) without redeploying SQL.
  if (import.meta.env.VITE_USE_FILTER_OPTIONS_RPC === "false") {
    return fetchExploreFilterOptionsClientPaged();
  }
  const { data, error } = await sb.rpc("get_explore_filter_options_db");
  if (!error && data != null && typeof data === "object") {
    try {
      const tcg = buildTcgFilterOptionsFromRpc(data.tcg);
      const pocket = buildPocketFilterOptionsFromRpc(data.pocket);
      const custom = buildCustomFilterOptionsFromRpc(data.custom);
      return mergeExploreFilterOptions(tcg, pocket, custom);
    } catch (e) {
      console.warn(
        "get_explore_filter_options_db parse:",
        e?.message || e,
        "— using client-paged filter options"
      );
    }
  } else if (error) {
    console.warn(
      "get_explore_filter_options_db:",
      error.message || error,
      "— using client-paged filter options"
    );
  }
  return fetchExploreFilterOptionsClientPaged();
}

async function fetchFormOptionsClientPaged() {
  const sb = await sbReady();
  const [rarity, artist, regions, series, setIds, setNames, names] =
    await Promise.all([
      distinctColumn("rarity", "pokemontcg.io"),
      distinctColumn("artist", "pokemontcg.io"),
      sb.from("pokemon_metadata").select("region"),
      sb.from("sets").select("series").not("series", "is", null),
      sb.from("sets").select("id"),
      sb.from("sets").select("name"),
      distinctColumn("name", "pokemontcg.io"),
    ]);

  const merge = (a, b) => [...new Set([...a, ...b])];

  const out = {
    rarity: rarity.sort(),
    artist: artist.sort(),
    pkmnRegion: merge(
      annOpts.PKMN_REGION_OPTIONS,
      (regions.data || []).map((r) => r.region).filter(Boolean)
    ),
    cardRegion: merge(
      annOpts.PKMN_REGION_OPTIONS,
      (regions.data || []).map((r) => r.region).filter(Boolean)
    ),
    setSeries: [...new Set((series.data || []).map((r) => r.series).filter(Boolean))].sort(),
    types: [],
    subtypes: [],
    emotion: [...annOpts.EMOTION_OPTIONS],
    pose: [...annOpts.POSE_OPTIONS],
    cameraAngle: [...annOpts.CAMERA_ANGLE_OPTIONS],
    perspective: [...annOpts.PERSPECTIVE_OPTIONS],
    weather: [...annOpts.WEATHER_OPTIONS],
    environment: [...annOpts.ENVIRONMENT_OPTIONS],
    storytelling: [],
    cardLocations: [...annOpts.CARD_LOCATIONS_OPTIONS],
    items: [...annOpts.ITEMS_OPTIONS],
    actions: [...annOpts.ACTIONS_OPTIONS],
    videoTitle: [],
    setId: [...new Set((setIds.data || []).map((r) => r.id))].sort(),
    setName: [...new Set((setNames.data || []).map((r) => r.name))].sort(),
    name: names.sort(),
    source: [...annOpts.SOURCE_OPTIONS],
    heldItem: [...annOpts.HELD_ITEM_OPTIONS],
    pokeball: [...annOpts.POKEBALL_OPTIONS],
    trainerCardType: [...annOpts.TRAINER_CARD_TYPE_OPTIONS],
    stamp: [...annOpts.STAMP_OPTIONS],
    artStyle: [...annOpts.ART_STYLE_OPTIONS],
    mainCharacter: [],
    backgroundPokemon: merge(
      [],
      (await sb.from("pokemon_metadata").select("name")).data?.map((r) => r.name) || []
    ),
    backgroundHumans: [...annOpts.BACKGROUND_HUMANS_OPTIONS],
    additionalCharacters: [...annOpts.ADDITIONAL_CHARACTERS_OPTIONS],
    backgroundDetails: [...annOpts.BACKGROUND_DETAILS_OPTIONS],
    evolutionLine: mergeEvolutionLines(
      (await sb.from("pokemon_metadata").select("evolution_chain").not("evolution_chain", "is", null))
        .data?.map((r) => {
          const c = r.evolution_chain;
          if (c == null) return null;
          return typeof c === "object" ? JSON.stringify(c) : String(c);
        })
        .filter(Boolean) || []
    ),
    cardSubcategory: [...annOpts.CARD_SUBCATEGORY_OPTIONS],
    evolutionItems: [...annOpts.EVOLUTION_ITEMS_OPTIONS],
    berries: [...annOpts.BERRIES_OPTIONS],
    holidayTheme: [...annOpts.HOLIDAY_THEME_OPTIONS],
    multiCard: [...annOpts.MULTI_CARD_OPTIONS],
    trainerCardSubgroup: [...annOpts.TRAINER_CARD_SUBGROUP_OPTIONS],
    videoType: [...annOpts.VIDEO_TYPE_OPTIONS],
    videoRegion: [...annOpts.VIDEO_REGION_OPTIONS],
    videoLocation: [...annOpts.VIDEO_LOCATION_OPTIONS],
    cardBorder: [...annOpts.CARD_BORDER_OPTIONS],
    energyType: [...annOpts.ENERGY_TYPE_OPTIONS],
    rivalGroup: [...annOpts.RIVAL_GROUP_OPTIONS],
    primaryColor: [],
    secondaryColor: [],
    shape: [],
    top10Themes: [],
    wtpcEpisode: [],
    videoGame: [],
    videoGameLocation: [],
    additionalCharacterTheme: [],
  };

  await mergeAnnotationUsageIntoOptions(out);
  return out;
}

export async function fetchFormOptions() {
  const sb = await sbReady();
  const { data, error } = await sb.rpc("get_form_options_db");
  if (!error && data != null && typeof data === "object") {
    try {
      return buildFormOptionsFromRpcPayload(data);
    } catch (e) {
      console.warn(
        "get_form_options_db parse:",
        e?.message || e,
        "— using client-paged form options"
      );
    }
  } else if (error) {
    console.warn(
      "get_form_options_db:",
      error.message || error,
      "— using client-paged form options"
    );
  }
  return fetchFormOptionsClientPaged();
}

export async function fetchAnnotations(cardId) {
  const sb = await sbReady();
  const { data, error } = await sb
    .from("annotations")
    .select("*")
    .eq("card_id", cardId)
    .maybeSingle();
  if (error) throw error;
  return annotationRowToFlat(data);
}

function annotationValuesEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function serializeEditHistoryValue(val) {
  if (val === undefined || val === null) return null;
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

/** Payload for `apply_annotation_with_history` (edited_by set server-side). */
function buildEditHistoryPayload(patch, prevFlat) {
  const rows = [];
  for (const [k, v] of Object.entries(patch)) {
    const oldVal = prevFlat[k];
    const newVal = v === null || v === undefined ? undefined : v;
    if (annotationValuesEqual(oldVal, newVal)) continue;
    rows.push({
      field_name: k,
      old_value: serializeEditHistoryValue(oldVal),
      new_value: serializeEditHistoryValue(newVal),
    });
  }
  return rows;
}

/**
 * Recent annotation edits (newest first). Optional filter by card, field, or time window.
 * @param {{
 *   card_id?: string | null,
 *   field_name?: string | null,
 *   edited_after?: string | null,
 *   batch_run_id?: string | null,
 *   limit?: number,
 *   only_mine?: boolean
 * }} [opts]
 */
export async function fetchEditHistory({
  card_id = null,
  field_name = null,
  edited_after = null,
  batch_run_id = null,
  limit = 200,
  only_mine = false,
} = {}) {
  const sb = await sbReady();
  const lim = Math.min(500, Math.max(1, Number(limit) || 200));
  let q = sb
    .from("edit_history")
    .select("id, card_id, field_name, old_value, new_value, edited_at, edited_by, batch_run_id")
    .order("edited_at", { ascending: false })
    .limit(lim);
  if (card_id) q = q.eq("card_id", card_id);
  const fieldTrim = field_name != null ? String(field_name).trim() : "";
  if (fieldTrim) q = q.eq("field_name", fieldTrim);
  const afterTrim = edited_after != null ? String(edited_after).trim() : "";
  if (afterTrim) q = q.gte("edited_at", afterTrim);
  const br = batch_run_id != null ? String(batch_run_id).trim() : "";
  if (br) q = q.eq("batch_run_id", br);
  if (only_mine) {
    const { data: authData } = await sb.auth.getUser();
    const uid = authData?.user?.id;
    if (!uid) return [];
    q = q.eq("edited_by", uid);
  }
  const { data, error } = await q;
  if (error) throw error;
  return attachProfileDisplayNames(sb, data || []);
}

/**
 * Server copy of the Batch card ID list (signed-in, non-anonymous users only).
 * @returns {Promise<{ card_ids: string[], updated_at: string } | null>}
 */
export async function fetchBatchSelection() {
  const sb = await sbReady();
  const { data: authData } = await sb.auth.getUser();
  const user = authData?.user;
  if (!user?.id || user.is_anonymous === true) return null;
  const { data, error } = await sb
    .from("batch_selections")
    .select("card_ids, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const ids = Array.isArray(data.card_ids) ? data.card_ids.filter((x) => typeof x === "string" && x.length > 0) : [];
  return { card_ids: ids, updated_at: data.updated_at };
}

/**
 * Upsert the Batch card ID list for the current user.
 * @param {string[]} cardIds
 */
export async function upsertBatchSelection(cardIds) {
  const sb = await sbReady();
  const { data: authData } = await sb.auth.getUser();
  const user = authData?.user;
  if (!user?.id || user.is_anonymous === true) return;
  const unique = [...new Set((cardIds || []).filter((x) => typeof x === "string" && x.length > 0))].slice(
    0,
    BATCH_EDIT_MAX_CARDS
  );
  const { error } = await sb.from("batch_selections").upsert(
    {
      user_id: user.id,
      card_ids: unique,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

/**
 * Record one Batch wizard apply (before per-card writes). RLS: own rows only.
 * @param {{ field_name: string, card_count: number }} meta
 * @returns {Promise<string>} batch run id (uuid)
 */
export async function createBatchRun({ field_name, card_count }) {
  const sb = await sbReady();
  const { data: authData } = await sb.auth.getUser();
  const user = authData?.user;
  if (!user?.id || user.is_anonymous === true) {
    throw new Error("Sign in required to run batch.");
  }
  const { data, error } = await sb
    .from("batch_runs")
    .insert({
      user_id: user.id,
      field_name: String(field_name || "").trim() || "(batch)",
      card_count: Math.max(0, Number(card_count) || 0),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Recent batch runs for the signed-in user (newest first). */
export async function fetchBatchRuns({ limit = 40 } = {}) {
  const sb = await sbReady();
  const lim = Math.min(100, Math.max(1, Number(limit) || 40));
  const { data, error } = await sb
    .from("batch_runs")
    .select("id, field_name, card_count, created_at")
    .order("created_at", { ascending: false })
    .limit(lim);
  if (error) throw error;
  return data || [];
}

/** Current user's profile row (or null). */
export async function fetchProfile() {
  const sb = await sbReady();
  const { data: authData } = await sb.auth.getUser();
  const uid = authData?.user?.id;
  if (!uid) return null;
  const { data, error } = await sb.from("profiles").select("id, display_name, avatar_url, created_at, updated_at").eq("id", uid).maybeSingle();
  if (error) throw error;
  return data;
}

/** Another member's `profiles` row (same columns). RLS: authenticated may read all profiles. */
export async function fetchProfileById(userId) {
  const sb = await sbReady();
  const id = String(userId || "").trim();
  if (!id) return null;
  const { data: authData } = await sb.auth.getUser();
  if (!authData?.user?.id) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name, avatar_url, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const AVATAR_BUCKET = "avatars";
/** Object key after bucket: `{userId}/avatar` (upsert overwrites). */
function profileAvatarObjectPath(userId) {
  return `${userId}/avatar`;
}

const AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_MAX_BYTES = 1024 * 1024;

async function requireNonAnonymousUserForProfileWrite(sb) {
  const { data: sessData } = await sb.auth.getSession();
  const fromSession = sessData?.session?.user;
  if (fromSession?.id && fromSession.is_anonymous !== true) return fromSession;

  const { data: userData, error: userErr } = await sb.auth.getUser();
  const user = userData?.user;
  if (userErr || !user?.id || user.is_anonymous === true) {
    throw new Error("Sign in with your team account, then try uploading a profile photo again.");
  }
  return user;
}

/** Upload image to Storage and set `profiles.avatar_url` (public URL). */
export async function uploadProfileAvatar(file) {
  const sb = await sbReady();
  const user = await requireNonAnonymousUserForProfileWrite(sb);
  const uid = user.id;
  if (!file?.size) throw new Error("Choose an image file.");
  const mime = file.type || "";
  if (!AVATAR_MIME.has(mime)) throw new Error("Use a JPEG, PNG, or WebP image.");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("Image must be 1 MB or smaller.");
  const path = profileAvatarObjectPath(uid);
  const { error: upErr } = await sb.storage.from(AVATAR_BUCKET).upload(path, file, {
    upsert: true,
    contentType: mime,
    cacheControl: "3600",
  });
  if (upErr) throw upErr;
  const { data: pub } = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const url = pub?.publicUrl;
  if (!url) throw new Error("Could not resolve public URL for avatar.");
  return upsertProfile({ avatar_url: url });
}

/** Remove Storage object and clear `profiles.avatar_url`. */
export async function removeProfileAvatar() {
  const sb = await sbReady();
  const user = await requireNonAnonymousUserForProfileWrite(sb);
  const uid = user.id;
  const path = profileAvatarObjectPath(uid);
  const { error: rmErr } = await sb.storage.from(AVATAR_BUCKET).remove([path]);
  if (rmErr) console.warn("removeProfileAvatar storage:", rmErr.message);
  return upsertProfile({ avatar_url: null });
}

/** Update display_name and/or avatar_url for the signed-in user (insert row if missing). */
export async function upsertProfile({ display_name, avatar_url } = {}) {
  const sb = await sbReady();
  const user = await requireNonAnonymousUserForProfileWrite(sb);
  const uid = user.id;
  const patch = {};
  if (display_name !== undefined) patch.display_name = String(display_name).trim() || null;
  if (avatar_url !== undefined) patch.avatar_url = avatar_url;
  if (!Object.keys(patch).length) return fetchProfile();

  const { data: existing, error: exErr } = await sb.from("profiles").select("id").eq("id", uid).maybeSingle();
  if (exErr) throw exErr;
  if (existing) {
    const { data, error } = await sb.from("profiles").update(patch).eq("id", uid).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await sb.from("profiles").insert({ id: uid, ...patch }).select().single();
  if (error) throw error;
  return data;
}

const CARD_DETAIL_PINS_MAX = 12;

/** Current user's preferences row (card_detail_pins, quick_fields, etc.) or null. */
export async function fetchUserPreferences() {
  const sb = await sbReady();
  const { data: authData } = await sb.auth.getUser();
  const uid = authData?.user?.id;
  if (!uid) return null;
  const { data, error } = await sb
    .from("user_preferences")
    .select("user_id, quick_fields, default_category, card_detail_pins, updated_at")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { card_detail_pins: [] };
  return data;
}

/**
 * Upsert user_preferences for the signed-in user. Pass only fields to change.
 * @param {{ card_detail_pins?: string[] }} patch
 */
export async function upsertUserPreferences(patch = {}) {
  const sb = await sbReady();
  const { data: authData } = await sb.auth.getUser();
  const uid = authData?.user?.id;
  if (!uid) throw new Error("Sign in required to save preferences.");

  let pins = patch.card_detail_pins;
  if (pins !== undefined) {
    if (!Array.isArray(pins)) pins = [];
    const seen = new Set();
    pins = pins.map((k) => String(k || "").trim()).filter((k) => {
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    pins = pins.slice(0, CARD_DETAIL_PINS_MAX);
  }

  const row = {
    user_id: uid,
    updated_at: new Date().toISOString(),
  };
  if (pins !== undefined) row.card_detail_pins = pins;

  const { data: existing } = await sb.from("user_preferences").select("user_id").eq("user_id", uid).maybeSingle();

  if (existing) {
    const update = { updated_at: row.updated_at };
    if (pins !== undefined) update.card_detail_pins = pins;
    const { data, error } = await sb.from("user_preferences").update(update).eq("user_id", uid).select().single();
    if (error) throw error;
    return data;
  }

  const insert = {
    user_id: uid,
    quick_fields: ["art_style", "pose", "emotion", "environment", "owned"],
    default_category: "general",
    card_detail_pins: pins !== undefined ? pins : [],
    updated_at: row.updated_at,
  };
  const { data, error } = await sb.from("user_preferences").insert(insert).select().single();
  if (error) throw error;
  return data;
}

/** Recent edit_history rows for the signed-in user only. */
export async function fetchMyEditHistory({ limit = 40 } = {}) {
  const sb = await sbReady();
  const { data: authData } = await sb.auth.getUser();
  const uid = authData?.user?.id;
  if (!uid) return [];
  const lim = Math.min(200, Math.max(1, Number(limit) || 40));
  const { data, error } = await sb
    .from("edit_history")
    .select("id, card_id, field_name, old_value, new_value, edited_at, edited_by")
    .eq("edited_by", uid)
    .order("edited_at", { ascending: false })
    .limit(lim);
  if (error) throw error;
  return attachProfileDisplayNames(sb, data || []);
}

/** Cards created by the signed-in user (manual / custom inserts). */
export async function fetchMyCards({ limit = 200, set_id = "", q = "", sort = "recent_desc" } = {}) {
  const sb = await sbReady();
  const { data: authData } = await sb.auth.getUser();
  const uid = authData?.user?.id;
  if (!uid) return [];
  const lim = Math.min(1000, Math.max(1, Number(limit) || 200));
  let query = sb
    .from("cards")
    .select("id, name, set_id, set_name, set_series, number, origin, created_at, created_by, image_small, image_large")
    .eq("created_by", uid)
    .limit(lim);

  const sid = String(set_id || "").trim();
  if (sid) query = query.eq("set_id", sid);

  const term = String(q || "").trim();
  if (term) {
    query = query.or(`name.ilike.%${term}%,id.ilike.%${term}%`);
  }

  const sortKey = String(sort || "recent_desc");
  if (sortKey === "set_number_asc") {
    query = query
      .order("set_name", { ascending: true, nullsFirst: false })
      .order("set_id", { ascending: true, nullsFirst: false })
      .order("number_sort_key", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true, nullsFirst: false });
  } else if (sortKey === "name_asc") {
    query = query
      .order("name", { ascending: true, nullsFirst: false })
      .order("set_name", { ascending: true, nullsFirst: false })
      .order("number_sort_key", { ascending: true, nullsFirst: false });
  } else {
    query = query
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false, nullsFirst: false });
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Thrown when `annotations.version` changed between read and write (concurrent edit). */
export const ANNOTATION_VERSION_CONFLICT_MESSAGE =
  "ANNOTATION_VERSION_CONFLICT: This card was updated elsewhere. Refresh and try again.";

const PATCH_ANNOTATIONS_MAX_ATTEMPTS = 6;

/**
 * `apply_annotation_with_history` raises `ERRCODE = P0001` and a message containing
 * `ANNOTATION_VERSION_CONFLICT`. PostgREST sometimes splits text across `message`, `details`, and `hint`.
 * @param {{ message?: string, details?: string, hint?: string, code?: string } | null | undefined} rpcErr
 */
function isAnnotationVersionConflictFromRpc(rpcErr) {
  if (!rpcErr || typeof rpcErr !== "object") return false;
  if (rpcErr.code === "P0001") return true;
  const parts = [rpcErr.message, rpcErr.details, rpcErr.hint].filter(
    (x) => typeof x === "string" && x.trim() !== ""
  );
  return /ANNOTATION_VERSION_CONFLICT/i.test(parts.join(" "));
}

/**
 * Merge annotation patch into Supabase via `apply_annotation_with_history` (single transaction with
 * `edit_history`). Insert races retry on `23505`; concurrent edits map RPC errors to {@link ANNOTATION_VERSION_CONFLICT_MESSAGE}.
 * @param {string} cardId
 * @param {Record<string, unknown>} patch
 * @param {{ batchRunId?: string | null }} [options]
 */
export async function patchAnnotations(cardId, patch, options = {}) {
  const { batchRunId } = options;
  const sb = await sbReady();
  const patchForHistoryBase = { ...patch };
  delete patchForHistoryBase.updated_by;
  delete patchForHistoryBase.updated_at;

  for (let attempt = 0; attempt < PATCH_ANNOTATIONS_MAX_ATTEMPTS; attempt++) {
    const { data: cur, error: readErr } = await sb
      .from("annotations")
      .select("*")
      .eq("card_id", cardId)
      .maybeSingle();
    if (readErr) throw readErr;

    const prevFlat = annotationRowToFlat(cur);
    const merged = { ...prevFlat };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete merged[k];
      else merged[k] = v;
    }

    const prevExtra = (cur?.extra && typeof cur.extra === "object" ? cur.extra : {}) || {};
    const { typed, extra } = flatToAnnotationPayload(merged, prevExtra);

    const { data: authData } = await sb.auth.getUser();
    const uid = authData?.user?.id ?? null;
    const audit = { updated_at: new Date().toISOString() };
    if (uid) audit.updated_by = uid;

    const ver = cur?.version ?? 0;
    const row = stripUndefined({
      card_id: cardId,
      ...typed,
      extra,
      version: ver + 1,
      ...audit,
    });

    const patchForHistory = { ...patchForHistoryBase };
    const historyPayload = buildEditHistoryPayload(patchForHistory, prevFlat);
    // Skip writes for no-op interactions (focus/blur, re-selecting same value, etc.).
    // This prevents edit_history noise and avoids bumping annotation version/updated_at.
    if (historyPayload.length === 0) {
      return prevFlat;
    }
    const fullRowForRpc = !cur
      ? { ...ANNOTATION_ROW_INSERT_DEFAULTS, ...row }
      : { ...cur, ...row };

    const { error: rpcErr } = await sb.rpc("apply_annotation_with_history", {
      p_is_insert: !cur,
      p_expected_version: cur ? ver : null,
      p_row: fullRowForRpc,
      p_history: historyPayload,
      p_batch_run_id: batchRunId ?? null,
    });

    if (rpcErr) {
      if (rpcErr.code === "23505" && !cur) {
        continue;
      }
      if (isAnnotationVersionConflictFromRpc(rpcErr)) {
        // Rapid local edits can race each other (same card/version). Re-read and retry
        // so the patch rebases onto the newest row before surfacing a conflict.
        if (attempt < PATCH_ANNOTATIONS_MAX_ATTEMPTS - 1) {
          continue;
        }
        throw new Error(ANNOTATION_VERSION_CONFLICT_MESSAGE);
      }
      throw rpcErr;
    }

    return fetchAnnotations(cardId);
  }

  throw new Error("Could not save annotation after retries.");
}

export async function fetchAttributes() {
  const sb = await sbReady();
  const { data, error } = await sb
    .from("field_definitions")
    .select("name, label, field_type, category, sort_order, curated_options")
    .order("category")
    .order("sort_order");
  if (error) throw error;
  return (data || []).map((r) => ({
    key: r.name,
    label: r.label,
    value_type: r.field_type,
    options: r.curated_options,
    default_value: null,
    is_builtin: r.category !== "custom",
    sort_order: r.sort_order,
  }));
}

async function nextCustomFieldSortOrder(sb) {
  const { data, error } = await sb
    .from("field_definitions")
    .select("sort_order")
    .eq("category", "custom")
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error) throw error;
  const mx = data?.[0]?.sort_order;
  return typeof mx === "number" ? mx + 1 : 10_000;
}

export async function createAttribute(attr) {
  const sb = await sbReady();
  const { key, label, value_type, options = null } = attr;
  const name = String(key || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error("Key must be lowercase letters, numbers, and underscores only");
  }

  const allowed = new Set(["text", "number", "boolean", "select", "multi_select", "url"]);
  const field_type = value_type;
  if (!allowed.has(field_type)) {
    throw new Error(`Unsupported field type: ${field_type}`);
  }

  const { data: exists, error: exErr } = await sb
    .from("field_definitions")
    .select("name")
    .eq("name", name)
    .maybeSingle();
  if (exErr) throw exErr;
  if (exists) throw new Error(`Field '${name}' already exists`);

  let curated_options = [];
  if (field_type === "select" || field_type === "multi_select") {
    const arr = Array.isArray(options) ? options : [];
    if (arr.length < 2) {
      throw new Error("Select and multi-select fields need at least 2 options");
    }
    curated_options = arr;
  } else if (field_type === "number" && options && typeof options === "object") {
    curated_options = options;
  }

  const { data: userData } = await sb.auth.getUser();
  const sort_order = await nextCustomFieldSortOrder(sb);

  const { error } = await sb.from("field_definitions").insert({
    name,
    label: String(label || name).trim() || name,
    field_type,
    category: "custom",
    sort_order,
    curated_options,
    created_by: userData?.user?.id ?? null,
  });
  if (error) throw error;
}

export async function deleteAttribute(key) {
  const sb = await sbReady();
  const name = String(key);
  const { data: row, error: readErr } = await sb
    .from("field_definitions")
    .select("name, category")
    .eq("name", name)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) throw new Error(`Field '${name}' not found`);
  if (row.category !== "custom") {
    throw new Error("Built-in fields cannot be deleted");
  }
  const { error } = await sb.from("field_definitions").delete().eq("name", name).eq("category", "custom");
  if (error) throw error;
}

/**
 * Append string tokens to `curated_options` for a **custom** select / multi_select field (RLS allows updates only for `category = custom`).
 * Dedupes case-insensitively; keeps existing order and appends new values at the end.
 * @param {string} fieldName — `field_definitions.name`
 * @param {string[]} newStrings
 * @returns {{ appended: string[] }}
 */
export async function appendCuratedOptionsForCustomField(fieldName, newStrings) {
  const sb = await sbReady();
  const name = String(fieldName);
  const toAdd = (newStrings || [])
    .map((s) => (s == null ? "" : String(s).trim()))
    .filter(Boolean);
  if (toAdd.length === 0) return { appended: [] };

  const { data: row, error: readErr } = await sb
    .from("field_definitions")
    .select("name, category, field_type, curated_options")
    .eq("name", name)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) throw new Error(`Field '${name}' not found`);
  if (row.category !== "custom") {
    throw new Error("Only custom fields can update curated options from Batch.");
  }
  if (row.field_type !== "select" && row.field_type !== "multi_select") {
    throw new Error("Curated options apply to select or multi-select fields only.");
  }

  let rawOpts = row.curated_options;
  if (typeof rawOpts === "string") {
    try {
      rawOpts = JSON.parse(rawOpts);
    } catch {
      rawOpts = [];
    }
  }
  const existing = Array.isArray(rawOpts) ? [...rawOpts] : [];
  const seen = new Set(existing.map((x) => String(x).toLowerCase()));
  const appended = [];
  for (const t of toAdd) {
    const tl = t.toLowerCase();
    if (!seen.has(tl)) {
      seen.add(tl);
      existing.push(t);
      appended.push(t);
    }
  }
  if (appended.length === 0) return { appended: [] };

  const { error: upErr } = await sb
    .from("field_definitions")
    .update({ curated_options: existing })
    .eq("name", name)
    .eq("category", "custom");
  if (upErr) throw upErr;
  return { appended };
}

const MANUAL_DEDUPE_PREFLIGHT_SQL_RE =
  /^\s*(?:--[^\n]*\n\s*)*select\s+\*\s+from\s+get_manual_card_dedupe_preflight\s*\(\s*\)\s*;?\s*$/i;

function rpcRowsToSqlConsoleShape(data) {
  const defaultCols = [
    "explore_dedupe_row_key",
    "k_sid",
    "k_nm",
    "k_img",
    "role",
    "id",
    "name",
    "set_id",
    "number",
    "image_small",
    "image_large",
    "origin",
    "is_custom",
  ];
  if (!data?.length) {
    return { columns: defaultCols, rows: [], row_count: 0 };
  }
  const columns = Object.keys(data[0]);
  const rows = data.map((row) => columns.map((c) => row[c] ?? null));
  return { columns, rows, row_count: rows.length };
}

/** SQL console: only whitelisted reads; arbitrary SQL is not exposed to the browser. */
export async function executeSql(query) {
  const trimmed = String(query ?? "").trim();
  if (MANUAL_DEDUPE_PREFLIGHT_SQL_RE.test(trimmed)) {
    const sb = await sbReady();
    const { data, error } = await sb.rpc("get_manual_card_dedupe_preflight");
    if (error) throw error;
    return rpcRowsToSqlConsoleShape(data ?? []);
  }
  throw new Error("SQL console is not available with the Supabase data layer.");
}

/** Phase 6: snapshot counts for Data Health (head-only; RLS applies). */
export async function fetchDataHealthSummary() {
  const sb = await sbReady();
  const [
    cardsRes,
    annRes,
    setsRes,
    fieldsRes,
    pmRes,
    normRes,
    queuesRes,
    customFieldsRes,
    healthRes,
    manualIdHealthRes,
  ] = await Promise.all([
    sb.from("cards").select("id", { count: "exact", head: true }),
    sb.from("annotations").select("card_id", { count: "exact", head: true }),
    sb.from("sets").select("id", { count: "exact", head: true }),
    sb.from("field_definitions").select("name", { count: "exact", head: true }),
    sb.from("pokemon_metadata").select("pokedex_number", { count: "exact", head: true }),
    sb.from("normalization_rules").select("id", { count: "exact", head: true }),
    sb.from("workbench_queues").select("id", { count: "exact", head: true }),
    sb.from("field_definitions").select("name", { count: "exact", head: true }).eq("category", "custom"),
    sb
      .from("health_check_results")
      .select("check_type, severity, title, details, checked_at")
      .order("checked_at", { ascending: false })
      .limit(25),
    sb.rpc("get_manual_card_id_health_issues", { p_limit: 25 }),
  ]);
  const manualHealthRpcMissing =
    manualIdHealthRes.error &&
    /Could not find the function public\.get_manual_card_id_health_issues/i.test(
      String(manualIdHealthRes.error?.message || "")
    );
  for (const r of [cardsRes, annRes, setsRes, fieldsRes, pmRes, normRes, queuesRes, customFieldsRes]) {
    if (r.error) throw r.error;
  }
  if (healthRes.error) throw healthRes.error;
  if (manualIdHealthRes.error && !manualHealthRpcMissing) throw manualIdHealthRes.error;

  const totalCards = cardsRes.count ?? 0;
  const annotationRows = annRes.count ?? 0;
  const originKeys = ["pokemontcg.io", "tcgdex", "manual"];
  const originCounts = await Promise.all(
    originKeys.map((origin) =>
      sb.from("cards").select("id", { count: "exact", head: true }).eq("origin", origin)
    )
  );
  for (const r of originCounts) {
    if (r.error) throw r.error;
  }
  const cardsByOrigin = {};
  originKeys.forEach((o, i) => {
    cardsByOrigin[o] = originCounts[i].count ?? 0;
  });
  const manualIdHealthRows = Array.isArray(manualIdHealthRes.data) ? manualIdHealthRes.data : [];
  const manualCardIdHealth = manualHealthRpcMissing
    ? null
    : {
        totalIssues:
          manualIdHealthRows.length > 0
            ? Number(manualIdHealthRows[0]?.total_issues ?? manualIdHealthRows.length) || 0
            : 0,
        sample: manualIdHealthRows.map((r) => ({
          id: r.id,
          set_id: r.set_id,
          number: r.number,
          expected_id: r.expected_id,
          issue: r.issue,
        })),
      };

  return {
    totalCards,
    annotationRows,
    cardsWithoutAnnotationRow: Math.max(0, totalCards - annotationRows),
    sets: setsRes.count ?? 0,
    fieldDefinitions: fieldsRes.count ?? 0,
    customFieldDefinitions: customFieldsRes.count ?? 0,
    pokemonMetadataRows: pmRes.count ?? 0,
    normalizationRules: normRes.count ?? 0,
    workbenchQueues: queuesRes.count ?? 0,
    healthCheckResults: healthRes.data || [],
    manualCardIdHealth,
    missingHealthRpcs: manualHealthRpcMissing ? ["get_manual_card_id_health_issues"] : [],
    cardsByOrigin,
  };
}

/** Data Health: distinct annotation array values with card counts (triage list). */
export async function fetchAnnotationValueIssues({ limit = 100, minCount = 2 } = {}) {
  const sb = await sbReady();
  const { data, error } = await sb.rpc("get_annotation_value_issues", {
    p_limit: Math.max(0, Number(limit) || 100),
    p_min_count: Math.max(1, Number(minCount) || 2),
  });
  if (error) throw error;
  return (data || []).map((r) => ({
    field_key: r.field_key,
    field_value: r.field_value,
    card_count: Number(r.card_count || 0),
  }));
}

/** Data Health: cards currently containing one annotation array value. */
export async function fetchCardsForAnnotationValueIssue({ fieldKey, value, limit = 200 } = {}) {
  const fk = String(fieldKey || "").trim();
  const val = String(value || "").trim();
  if (!fk || !val) return [];
  const sb = await sbReady();
  const { data, error } = await sb.rpc("get_cards_for_annotation_value_issue", {
    p_field_key: fk,
    p_value: val,
    p_limit: Math.max(0, Number(limit) || 200),
  });
  if (error) throw error;
  return data || [];
}

/**
 * Data Health bulk cleanup for one annotation array value.
 * @returns {{ updatedRows: number }}
 */
export async function applyAnnotationValueCleanup({
  fieldKey,
  oldValue,
  newValue = null,
  mode = "replace",
} = {}) {
  const fk = String(fieldKey || "").trim();
  const oldv = String(oldValue || "").trim();
  const newv = newValue == null ? null : String(newValue).trim();
  const m = String(mode || "replace").toLowerCase();
  if (!fk || !oldv) throw new Error("fieldKey and oldValue are required.");
  if (!["replace", "remove"].includes(m)) throw new Error("mode must be replace or remove.");
  if (m === "replace" && !newv) throw new Error("newValue is required in replace mode.");

  const sb = await sbReady();
  const { data, error } = await sb.rpc("apply_annotation_value_cleanup", {
    p_field_key: fk,
    p_old_value: oldv,
    p_new_value: m === "replace" ? newv : null,
    p_mode: m,
  });
  if (error) throw error;
  const updatedRows = Number(data?.[0]?.updated_rows ?? 0) || 0;
  return { updatedRows };
}

export async function exportAllAnnotations() {
  const sb = await sbReady();
  const { data, error } = await sb.from("annotations").select("*");
  if (error) throw error;
  const out = {};
  for (const row of data || []) {
    const flat = annotationRowToFlat(row);
    if (Object.keys(flat).length) out[row.card_id] = flat;
  }
  return out;
}

export async function syncMutableTablesToIndexedDB() {
  return { annotationsSynced: 0, customCardsSynced: 0, customCardsData: { cards: [] } };
}

export async function deleteCardsById(cardIds) {
  const sb = await sbReady();
  const deleted = [];
  for (const id of cardIds) {
    const { data: row } = await sb
      .from("cards")
      .select("id, origin")
      .eq("id", id)
      .maybeSingle();
    if (!row || row.origin !== "manual") continue;
    const { error } = await sb.from("cards").delete().eq("id", id);
    if (error) throw error;
    deleted.push(id);
  }
  return deleted;
}

export async function triggerIngest() {
  throw new Error("Ingest to Supabase is planned for Phase 7.");
}

export async function addCustomSet() {
  throw new Error("addCustomSet via Supabase is not implemented yet (Phase 5+).");
}

/** Canonical manual card id from Postgres `generate_card_id` (collision check on server). */
export async function rpcGenerateManualCardId(setId, number) {
  const sb = await sbReady();
  const { data, error } = await sb.rpc("generate_card_id", {
    p_set_id: String(setId ?? "").trim(),
    p_number: String(number ?? "").trim(),
  });
  if (error) {
    const msg = error.message || String(error);
    if (/already exists/i.test(msg)) {
      throw new Error(
        "A card with this set and number already exists. Change the number or use a different set."
      );
    }
    throw new Error(msg);
  }
  if (typeof data !== "string" || !data) {
    throw new Error("Could not generate card ID.");
  }
  return data;
}

const TCG_CARD_BODY_SKIP = new Set([
  "id",
  "name",
  "alt_name",
  "supertype",
  "subtypes",
  "hp",
  "types",
  "evolves_from",
  "rarity",
  "special_rarity",
  "artist",
  "set_id",
  "set_name",
  "set_series",
  "number",
  "regulation_mark",
  "image_small",
  "image_large",
  "source",
  "_table",
]);

const POCKET_CARD_BODY_SKIP = new Set([
  "id",
  "name",
  "set_id",
  "number",
  "rarity",
  "card_type",
  "element",
  "hp",
  "stage",
  "retreat_cost",
  "weakness",
  "evolves_from",
  "packs",
  "image_url",
  "illustrator",
  "source",
  "_table",
]);

export async function addTcgCard(card) {
  const sb = await sbReady();
  const {
    data: { user },
    error: authErr,
  } = await sb.auth.getUser();
  if (authErr || !user?.id) throw new Error("Sign in required to add a custom card.");
  const uid = user.id;
  if (!card?.id) throw new Error("Card must have an id");
  const { data: exists } = await sb.from("cards").select("id").eq("id", card.id).maybeSingle();
  if (exists) throw new Error(`Card with ID '${card.id}' already exists`);

  await ensureManualSetRow(sb, card.set_id, card.set_name);

  const subtypes = parseJsonbStringArray(card.subtypes);
  const types = parseJsonbStringArray(card.types);
  const cardRow = stripUndefined({
    id: card.id,
    name: card.name,
    supertype: normalizeSupertypeDisplay(card.supertype || "Pokémon"),
    subtypes,
    hp: card.hp != null && card.hp !== "" ? String(card.hp) : null,
    types,
    evolves_from: card.evolves_from || null,
    rarity: card.rarity || null,
    artist: card.artist || null,
    set_id: card.set_id,
    number: normalizeCardNumberForStorage(card.number),
    set_name: card.set_name || "",
    set_series: card.set_series || "",
    regulation_mark: card.regulation_mark || null,
    image_small: card.image_small || card.image_large,
    image_large: card.image_large || card.image_small,
    raw_data: stripUndefined({
      source: card.source || "TCG",
      alt_name: card.alt_name || "",
      special_rarity: card.special_rarity || "",
    }),
    prices: {},
    evolution_line: card.evolution_line || null,
    origin: "manual",
    origin_detail: (card.source && String(card.source).trim()) || "TCG",
    format: "printed",
    created_by: uid,
  });

  const { error: cErr } = await sb.from("cards").insert(cardRow);
  if (cErr) throw new Error(cErr.message || String(cErr));

  try {
    const annFlat = pickAnnotationFlatFromCustomCard(card, TCG_CARD_BODY_SKIP);
    await insertInitialAnnotationForCard(sb, card.id, annFlat, uid);
  } catch (e) {
    await sb.from("cards").delete().eq("id", card.id);
    throw e;
  }
  return card;
}

export async function addPocketCard(card) {
  const sb = await sbReady();
  const {
    data: { user },
    error: authErr,
  } = await sb.auth.getUser();
  if (authErr || !user?.id) throw new Error("Sign in required to add a custom card.");
  const uid = user.id;
  if (!card?.id) throw new Error("Card must have an id");
  const { data: exists } = await sb.from("cards").select("id").eq("id", card.id).maybeSingle();
  if (exists) throw new Error(`Card with ID '${card.id}' already exists`);

  await ensureManualSetRow(sb, card.set_id, card.set_name || card.set_id);

  const packs = Array.isArray(card.packs) ? card.packs : parseJsonbStringArray(card.packs);
  const cardRow = stripUndefined({
    id: card.id,
    name: card.name,
    card_type: card.card_type || "",
    supertype: normalizeSupertypeDisplay(card.card_type || ""),
    subtypes: [],
    hp: card.hp != null && card.hp !== "" ? String(card.hp) : null,
    types: card.element ? [String(card.element)] : [],
    evolves_from: card.evolves_from || null,
    rarity: card.rarity || null,
    artist: null,
    illustrator: card.illustrator || "",
    set_id: card.set_id,
    number: normalizeCardNumberForStorage(card.number),
    set_name: card.set_name || card.set_id || "",
    set_series: card.set_series || "",
    image_small: card.image_url || card.image_small,
    image_large: card.image_url || card.image_large || card.image_small,
    stage: card.stage || null,
    retreat_cost:
      card.retreat_cost != null && card.retreat_cost !== ""
        ? Number(card.retreat_cost)
        : null,
    weakness: card.weakness || null,
    packs: packs.length ? packs : [],
    raw_data: stripUndefined({ source: card.source || "Pocket" }),
    prices: {},
    evolution_line: card.evolution_line || null,
    origin: "manual",
    origin_detail: "Pocket",
    format: "printed",
    created_by: uid,
  });

  const { error: cErr } = await sb.from("cards").insert(cardRow);
  if (cErr) throw new Error(cErr.message || String(cErr));

  try {
    const annFlat = pickAnnotationFlatFromCustomCard(card, POCKET_CARD_BODY_SKIP);
    await insertInitialAnnotationForCard(sb, card.id, annFlat, uid);
  } catch (e) {
    await sb.from("cards").delete().eq("id", card.id);
    throw e;
  }
  return card;
}

export async function addCustomCard(card) {
  if (card?._table === "pocket") return addPocketCard(card);
  return addTcgCard(card);
}

// ── Workbench queues (006) ───────────────────────────────────────────

async function workbenchUserId(sb) {
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();
  if (error || !user?.id) {
    throw new Error("Sign in required for Workbench queues.");
  }
  return user.id;
}

function asCardIdArray(raw) {
  if (Array.isArray(raw)) return [...raw];
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

export async function fetchWorkbenchQueues() {
  const sb = await sbReady();
  const uid = await workbenchUserId(sb);
  const { data, error } = await sb
    .from("workbench_queues")
    .select("*")
    .eq("user_id", uid)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function ensureDefaultWorkbenchQueue() {
  const sb = await sbReady();
  const uid = await workbenchUserId(sb);
  const { data: existing, error: e1 } = await sb
    .from("workbench_queues")
    .select("*")
    .eq("user_id", uid)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (e1) throw e1;
  if (existing?.length) return existing[0];
  const { data: row, error: e2 } = await sb
    .from("workbench_queues")
    .insert({
      user_id: uid,
      name: "Default",
      card_ids: [],
      fields: [],
      current_index: 0,
      filters_used: {},
    })
    .select()
    .single();
  if (e2) throw e2;
  return row;
}

export async function updateWorkbenchQueue(queueId, patch) {
  const sb = await sbReady();
  const uid = await workbenchUserId(sb);
  const allowed = ["name", "card_ids", "fields", "current_index", "filters_used"];
  const row = {};
  for (const k of allowed) {
    if (k in patch) row[k] = patch[k];
  }
  if (!Object.keys(row).length) return null;
  row.updated_at = new Date().toISOString();
  const { data, error } = await sb
    .from("workbench_queues")
    .update(row)
    .eq("id", queueId)
    .eq("user_id", uid)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Append a card id to the user's default queue (deduped). */
export async function appendCardToDefaultQueue(cardId) {
  const q = await ensureDefaultWorkbenchQueue();
  const ids = asCardIdArray(q.card_ids);
  if (!ids.includes(cardId)) ids.push(cardId);
  return updateWorkbenchQueue(q.id, {
    card_ids: ids,
    current_index: ids.length - 1,
  });
}

/**
 * Append many card ids in one update (deduped against existing queue order; new ids appended in given order).
 * @param {string[]} cardIds
 * @returns {Promise<{ added: number, queue: object }>}
 */
export async function appendCardsToDefaultQueue(cardIds) {
  const q = await ensureDefaultWorkbenchQueue();
  const existing = asCardIdArray(q.card_ids);
  const seen = new Set(existing.map((id) => String(id)));
  const merged = [...existing];
  let added = 0;
  for (const raw of cardIds || []) {
    const id = raw == null ? "" : String(raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
    added++;
  }
  if (added === 0) {
    return { added: 0, queue: q };
  }
  const data = await updateWorkbenchQueue(q.id, {
    card_ids: merged,
    current_index: merged.length - 1,
  });
  return { added, queue: data };
}
