/** Normalize Explore's selected set values into canonical IDs. */
export function normalizeExploreSetIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

/**
 * Apply an indexed set-ID filter to a Supabase/PostgREST query builder.
 * Dropdown values are canonical set IDs; display names must not be included in
 * an OR clause because that prevents the existing set_id indexes being useful.
 */
export function applyExploreSetIdFilter(query, values) {
  const setIds = normalizeExploreSetIds(values);
  return setIds.length ? query.in("set_id", setIds) : query;
}
