-- ============================================================
-- 057: RLS performance experiment — inline session checks
-- ============================================================
-- Hypothesis: The auth_is_non_anonymous_authenticated() function
-- wrapper in RLS policies may be shifting the planner's cost
-- estimates, causing it to choose sequential scan (60,065 rows) over
-- the GIN index scan. Observed: ~80ms as superuser (RLS bypassed
-- entirely), ~6,500ms through RLS as authenticated. Part of the gap
-- is "RLS on vs off," not only "function vs inline."
--
-- Approach: Inline the same auth logic directly into each policy's
-- USING clause instead of calling the wrapper function. The logic is
-- identical to auth_is_non_anonymous_authenticated() and preserves
-- 019's intent (block anonymous Supabase sessions). Inlining may let
-- the planner recognize the session check as a once-per-query
-- constant rather than a per-row function call.
--
-- This is a hypothesis to measure — not proven root cause. Verify
-- with real PostgREST requests (or pg_stat_statements), not just SQL
-- Editor + SET ROLE, since the dashboard doesn't set auth.jwt() as
-- the app does.
--
-- If inlining doesn't change the plan, the fallback is USING (true)
-- on cards/sets/pokemon_metadata — but that removes the anon-session
-- gate and requires explicit owner sign-off against 019's intent.
--
-- IMPORTANT: These inline expressions must stay in sync with
-- public.auth_is_non_anonymous_authenticated(). If that function
-- changes, update these policies too.
--
-- Write policies on cards/sets (INSERT/UPDATE/DELETE) intentionally
-- left on the wrapper function — writes are rare so overhead doesn't
-- matter. The annotations policy is FOR ALL (single USING covers both
-- reads and writes), so this ALTER affects all operations on
-- annotations; the security semantics are unchanged.

-- ── cards ──────────────────────────────────────────────────────

ALTER POLICY "authenticated read cards" ON public.cards
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true'
  );

-- ── sets ───────────────────────────────────────────────────────

ALTER POLICY "authenticated read sets" ON public.sets
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true'
  );

-- ── pokemon_metadata ───────────────────────────────────────────

ALTER POLICY "authenticated read pokemon_metadata" ON public.pokemon_metadata
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true'
  );

-- ── annotations ────────────────────────────────────────────────
-- The Explore cards query embeds annotations, so RLS on annotations
-- adds a second policy qual to the join. Inline this one too.

ALTER POLICY "authenticated all annotations" ON public.annotations
  USING (
    auth.role() = 'authenticated'
    AND (auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true'
  );
