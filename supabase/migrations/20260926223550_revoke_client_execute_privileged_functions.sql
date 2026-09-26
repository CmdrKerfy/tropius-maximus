-- ============================================================
-- Phase 2C: revoke client EXECUTE on privileged SECURITY DEFINER functions
-- ============================================================
-- Audit 2026-09-26 (read-only, pg_proc.proacl): every public function carries
-- the Supabase default ACL, so PUBLIC, anon and authenticated can call these
-- SECURITY DEFINER functions through PostgREST with only the anon key that
-- ships in the JS bundle:
--
--   refresh_explore_filter_options()   REFRESH MATERIALIZED VIEW CONCURRENTLY (~12 s)
--   analyze_cards_and_annotations()    ANALYZE cards + annotations
--   get_card_names_by_source(...)      returns id + name for every card of the
--                                      given origins, bypassing RLS (manual
--                                      cards included)
--
-- Callers (verified): only scripts/push_duckdb_to_supabase.py calls the two
-- maintenance functions, with the service key. Nothing calls
-- get_card_names_by_source since 99dcfb5 reverted the client-side CJK search;
-- the function and its covering index stay (removal is Phase 5, after usage
-- evidence). No other function body references these three, and pg_cron is
-- not installed. Owner postgres keeps EXECUTE.
--
-- Not changed here:
--   - get_public_card_for_share: intentional anonymous access (public share).
--   - handle_new_user / rls_auto_enable: trigger / event-trigger functions;
--     PostgREST cannot call them and EXECUTE is not checked when they fire.
--   - SECURITY INVOKER RPCs: RLS already rejects anonymous sessions (2B/2D).
--   - Default privileges (pg_default_acl) still grant EXECUTE on NEW public
--     functions to anon/authenticated; each new privileged function must
--     revoke explicitly.
--
-- Rollback: GRANT EXECUTE ON FUNCTION <sig> TO PUBLIC, anon, authenticated;
--
-- Verify after applying (read-only; expect anon_x/auth_x false, svc_x true):
--   SELECT p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_x,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
--          has_function_privilege('service_role', p.oid, 'EXECUTE')  AS svc_x,
--          p.proacl
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('refresh_explore_filter_options',
--                       'analyze_cards_and_annotations',
--                       'get_card_names_by_source');

REVOKE EXECUTE ON FUNCTION public.refresh_explore_filter_options() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.analyze_cards_and_annotations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_card_names_by_source(text[], text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.refresh_explore_filter_options() TO service_role;
GRANT EXECUTE ON FUNCTION public.analyze_cards_and_annotations() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_card_names_by_source(text[], text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
