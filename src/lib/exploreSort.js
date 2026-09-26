/**
 * Explore sort keys the active backend can actually order by.
 *
 * The Supabase adapter's sortMap has no column for these, so a request for
 * them silently orders by name. DuckDB (v1 / local preview) implements all of
 * them. Show them only where they work, and label a stale value (saved
 * filters, old share links, the TCG default) as the sort that really runs.
 */
export const SUPABASE_UNSUPPORTED_SORTS = new Set(["pokedex", "price", "region"]);

/** True when `sortBy` is offered for this backend. */
export function isSortSupported(sortBy, { supabase }) {
  return !(supabase && SUPABASE_UNSUPPORTED_SORTS.has(sortBy));
}

/** The sort key the backend will really apply (unsupported or empty → "name"). */
export function effectiveSortBy(sortBy, { supabase }) {
  if (!sortBy) return "name";
  return isSortSupported(sortBy, { supabase }) ? sortBy : "name";
}
