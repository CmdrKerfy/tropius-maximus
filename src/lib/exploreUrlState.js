/**
 * Shared Explore filter ↔ URL encoding (used by ExplorePage and BatchEditPage).
 */

export const DEFAULT_FILTERS = {
  source: "",
  supertype: "",
  rarity: [],
  set_id: [],
  region: [],
  generation: "",
  color: "",
  artist: [],
  evolution_line: [],
  trainer_type: "",
  specialty: [],
  background_pokemon: [],
  element: [],
  card_type: [],
  stage: [],
  card_id: "",
  jumbo_card: "",
  weather: [],
  environment: [],
  actions: [],
  pose: [],
  annotation_field_key: "",
  annotation_field_value: "",
  sort_by: "pokedex",
  sort_dir: "asc",
};

export const ARRAY_FILTER_KEYS = new Set([
  "rarity",
  "set_id",
  "region",
  "artist",
  "evolution_line",
  "specialty",
  "background_pokemon",
  "element",
  "card_type",
  "stage",
  "weather",
  "environment",
  "actions",
  "pose",
]);

/** Values omitted from URL when they match defaults (cleaner share links). */
export const URL_FILTER_DEFAULTS = { sort_by: "pokedex", sort_dir: "asc" };

/**
 * @param {string} search — `window.location.search` or `?foo=bar` (leading ? optional)
 */
export function readUrlStateFromSearch(search) {
  const raw = typeof search === "string" ? search : "";
  const qs = raw.startsWith("?") ? raw.slice(1) : raw;
  const params = new URLSearchParams(qs);
  const urlFilters = {};
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    if (ARRAY_FILTER_KEYS.has(key)) {
      const vals = params.getAll(key);
      if (vals.length) urlFilters[key] = vals;
    } else {
      const val = params.get(key);
      if (val !== null) urlFilters[key] = val;
    }
  }
  return {
    urlFilters,
    searchQuery: params.has("q") ? params.get("q") : null,
    page: Math.max(1, parseInt(params.get("page") || "1", 10)),
    selectedCardId: params.get("card") || null,
  };
}

export function readUrlState() {
  return readUrlStateFromSearch(typeof window !== "undefined" ? window.location.search : "");
}

export function buildUrlParams(filters, searchQuery, page, selectedCardId) {
  const p = new URLSearchParams();
  if (selectedCardId) p.set("card", selectedCardId);
  if (searchQuery) p.set("q", searchQuery);
  if (page > 1) p.set("page", String(page));
  for (const [key, value] of Object.entries(filters)) {
    if (ARRAY_FILTER_KEYS.has(key)) {
      for (const v of value) p.append(key, v);
    } else {
      if (!value || value === URL_FILTER_DEFAULTS[key]) continue;
      p.set(key, value);
    }
  }
  return p;
}
