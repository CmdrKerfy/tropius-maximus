-- ============================================================
-- Phase 2E: keep quarterly edit_history partitions ahead of now
-- ============================================================
-- 004 created partitions 2026-Q1 … 2027-Q2 only (last upper bound
-- 2027-07-01) and there is no DEFAULT partition. Annotation saves write
-- edit_history in the same transaction (017), so from 2027-07-01 every save
-- would fail with "no partition of relation edit_history found for row".
--
-- ensure_edit_history_partitions(p_quarters_ahead):
--   - creates any missing partition from the current quarter through
--     current + p_quarters_ahead, named edit_history_<yyyy>_q<n> like 004;
--   - enables RLS on each new partition explicitly (the existing partitions
--     have RLS on and no policies, so the API cannot read or write them
--     directly; the ensure_rls event trigger does the same but swallows its
--     own errors). Indexes are inherited from the partitioned parent;
--   - returns {created, horizon, future_quarters}: horizon is the upper bound
--     of the contiguous partitions from the current quarter, and
--     future_quarters counts the full quarters covered after the current one.
-- The weekly ingest push calls it with the service key and warns when fewer
-- than two future quarters remain (scripts/push_duckdb_to_supabase.py).
--
-- CREATE TABLE … PARTITION OF takes a brief ACCESS EXCLUSIVE lock on
-- edit_history, and only when a partition is missing; lock_timeout 5s makes
-- a busy table fail fast instead of queueing annotation saves behind it.
--
-- SECURITY DEFINER (owner postgres) because creating a partition requires
-- ownership of the parent. Only service_role may execute it.
--
-- Rollback: DROP FUNCTION public.ensure_edit_history_partitions(integer);
-- the new partitions are empty until their quarter starts and can stay.
--
-- Verify after applying (read-only; expect partitions through 2028_q3, all
-- rls = true with 4 indexes, and anon_x/auth_x false):
--   SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound, c.relrowsecurity AS rls,
--          (SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid) AS n_idx
--   FROM pg_inherits inh JOIN pg_class c ON c.oid = inh.inhrelid
--   WHERE inh.inhparent = 'public.edit_history'::regclass ORDER BY c.relname;
--   SELECT has_function_privilege('anon', 'public.ensure_edit_history_partitions(integer)', 'EXECUTE') AS anon_x,
--          has_function_privilege('authenticated', 'public.ensure_edit_history_partitions(integer)', 'EXECUTE') AS auth_x,
--          has_function_privilege('service_role', 'public.ensure_edit_history_partitions(integer)', 'EXECUTE') AS svc_x;

CREATE OR REPLACE FUNCTION public.ensure_edit_history_partitions(p_quarters_ahead integer DEFAULT 4)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  v_current date := date_trunc('quarter', now() AT TIME ZONE 'UTC')::date;
  v_start date;
  v_name text;
  v_created text[] := '{}';
  v_quarters integer := 0;
BEGIN
  IF p_quarters_ahead IS NULL OR p_quarters_ahead < 0 OR p_quarters_ahead > 20 THEN
    RAISE EXCEPTION 'p_quarters_ahead must be between 0 and 20, got %', p_quarters_ahead;
  END IF;

  FOR i IN 0..p_quarters_ahead LOOP
    v_start := (v_current + make_interval(months => 3 * i))::date;
    v_name := format('edit_history_%s_q%s', extract(year FROM v_start)::int, extract(quarter FROM v_start)::int);
    CONTINUE WHEN to_regclass('public.' || v_name) IS NOT NULL;
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.edit_history FOR VALUES FROM (%L) TO (%L)',
      v_name,
      v_start::text || ' 00:00:00+00',
      (v_start + interval '3 months')::date::text || ' 00:00:00+00'
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_name);
    v_created := v_created || v_name;
  END LOOP;

  -- Contiguous coverage after the current quarter (bounded scan by name).
  LOOP
    v_start := (v_current + make_interval(months => 3 * (v_quarters + 1)))::date;
    EXIT WHEN v_quarters >= 40 OR to_regclass(format(
      'public.edit_history_%s_q%s', extract(year FROM v_start)::int, extract(quarter FROM v_start)::int
    )) IS NULL;
    v_quarters := v_quarters + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'created', to_jsonb(v_created),
    'horizon', (v_current + make_interval(months => 3 * (v_quarters + 1)))::date,
    'future_quarters', v_quarters
  );
END;
$$;

COMMENT ON FUNCTION public.ensure_edit_history_partitions(integer) IS
  'Phase 2E: creates missing quarterly edit_history partitions (RLS on) through current + p_quarters_ahead; returns {created, horizon, future_quarters}. service_role only; called by the weekly ingest push.';

REVOKE EXECUTE ON FUNCTION public.ensure_edit_history_partitions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_edit_history_partitions(integer) TO service_role;

-- Two years of headroom now: 2027-Q3 … 2028-Q3 (applied 2026-Q3).
SELECT public.ensure_edit_history_partitions(8);

NOTIFY pgrst, 'reload schema';
