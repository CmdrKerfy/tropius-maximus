-- ============================================================
-- Phase 0B.2 (2/3): refresh explore_filter_options CONCURRENTLY
-- ============================================================
-- 054/055 used a plain REFRESH MATERIALIZED VIEW, which takes an ACCESS
-- EXCLUSIVE lock and blocks every Explore filter-options read for the whole
-- refresh (~12 s). CONCURRENTLY keeps the old rows readable while the new
-- contents are computed. Requirements (both met):
--   * the view is already populated (created WITH DATA), and
--   * a unique index on plain columns covering every row exists:
--     idx_explore_filter_options_source ON explore_filter_options (source).
-- CONCURRENTLY is slower than a plain refresh; the service_role timeout
-- budget (previous migration) must be applied first.
--
-- Security: stays SECURITY DEFINER (REFRESH requires ownership/MAINTAIN), now
-- with an explicit empty search_path and a schema-qualified target.
-- CREATE OR REPLACE keeps the existing ACL unchanged; this migration does not
-- widen grants. Revoking anon/authenticated/PUBLIC execute is Phase 2C.

CREATE OR REPLACE FUNCTION public.refresh_explore_filter_options()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.explore_filter_options;
$$;

COMMENT ON FUNCTION public.refresh_explore_filter_options() IS
  'Phase 0B.2: non-blocking (CONCURRENTLY) refresh of explore_filter_options; called by push_duckdb_to_supabase.py with the service key after ingest.';
