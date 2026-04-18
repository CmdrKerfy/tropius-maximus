import { ARRAY_FILTER_KEYS, DEFAULT_FILTERS, URL_FILTER_DEFAULTS } from "./exploreUrlState.js";

/** True if any filter or sort differs from catalog defaults (share-link friendly). */
export function exploreFiltersAreActive(filters) {
  if (!filters) return false;
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    if (ARRAY_FILTER_KEYS.has(key)) {
      if ((filters[key] || []).length > 0) return true;
      continue;
    }
    const def = DEFAULT_FILTERS[key];
    const raw = filters[key];
    const urlDef = URL_FILTER_DEFAULTS[key];
    const expected = urlDef !== undefined ? urlDef : def;
    const val = raw === "" || raw === undefined ? expected : raw;
    if (val !== expected) return true;
  }
  return false;
}

export function exploreHasActiveConstraints(filters, searchQuery) {
  if (String(searchQuery || "").trim()) return true;
  return exploreFiltersAreActive(filters);
}
