-- ============================================================
-- 019: RLS — exclude anonymous Supabase Auth sessions
-- ============================================================
-- Anonymous sign-in creates a JWT with role "authenticated" and
-- is_anonymous=true, so policies that only check auth.role() = 'authenticated'
-- incorrectly grant full app access. This migration tightens policies to
-- require a non-anonymous authenticated user.
--
-- Public share RPC get_public_card_for_share (018) is unchanged: SECURITY DEFINER
-- and GRANT EXECUTE TO anon — share links still work without a session.
--
-- After apply: disable Anonymous provider in Supabase + set
-- VITE_SUPABASE_AUTO_ANON_AUTH=false on production (see docs/plans/production-hardening-anon-auth.md).

CREATE OR REPLACE FUNCTION public.auth_is_non_anonymous_authenticated()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT auth.role() = 'authenticated'
    AND (auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true';
$$;

COMMENT ON FUNCTION public.auth_is_non_anonymous_authenticated() IS
  'True for signed-in users (email/password, magic link, OAuth); false for anon role, anonymous JWT, or no session.';

-- ---------------------------------------------------------------------------
-- 007 policies (from 007 + 011 field_definitions renames)
-- ---------------------------------------------------------------------------

ALTER POLICY "authenticated read cards" ON public.cards
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated insert cards" ON public.cards
  WITH CHECK (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated update cards" ON public.cards
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated delete cards" ON public.cards
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated read sets" ON public.sets
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated insert sets" ON public.sets
  WITH CHECK (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated update sets" ON public.sets
  USING (public.auth_is_non_anonymous_authenticated());

-- No DELETE policy on sets in 007 (ingest uses service role).

ALTER POLICY "authenticated read pokemon_metadata" ON public.pokemon_metadata
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated all annotations" ON public.annotations
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated read field_definitions" ON public.field_definitions
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated insert custom field_definitions" ON public.field_definitions
  WITH CHECK (public.auth_is_non_anonymous_authenticated() AND category = 'custom');

ALTER POLICY "authenticated update custom field_definitions" ON public.field_definitions
  USING (public.auth_is_non_anonymous_authenticated() AND category = 'custom')
  WITH CHECK (public.auth_is_non_anonymous_authenticated() AND category = 'custom');

ALTER POLICY "authenticated delete custom field_definitions" ON public.field_definitions
  USING (public.auth_is_non_anonymous_authenticated() AND category = 'custom');

ALTER POLICY "authenticated all normalization_rules" ON public.normalization_rules
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated read edit_history" ON public.edit_history
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated insert edit_history" ON public.edit_history
  WITH CHECK (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "authenticated read health_checks" ON public.health_check_results
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "users manage own preferences" ON public.user_preferences
  USING (auth.uid() = user_id AND public.auth_is_non_anonymous_authenticated())
  WITH CHECK (auth.uid() = user_id AND public.auth_is_non_anonymous_authenticated());

ALTER POLICY "users manage own queues" ON public.workbench_queues
  USING (auth.uid() = user_id AND public.auth_is_non_anonymous_authenticated())
  WITH CHECK (auth.uid() = user_id AND public.auth_is_non_anonymous_authenticated());

-- ---------------------------------------------------------------------------
-- 013 profiles
-- ---------------------------------------------------------------------------

ALTER POLICY "profiles_select_authenticated" ON public.profiles
  USING (public.auth_is_non_anonymous_authenticated());

ALTER POLICY "profiles_insert_own" ON public.profiles
  WITH CHECK (auth.uid() = id AND public.auth_is_non_anonymous_authenticated());

ALTER POLICY "profiles_update_own" ON public.profiles
  USING (auth.uid() = id AND public.auth_is_non_anonymous_authenticated())
  WITH CHECK (auth.uid() = id AND public.auth_is_non_anonymous_authenticated());

-- ---------------------------------------------------------------------------
-- 014 storage.objects (avatars)
-- ---------------------------------------------------------------------------

ALTER POLICY "avatars_insert_own_folder" ON storage.objects
  WITH CHECK (
    bucket_id = 'avatars'
    AND (string_to_array(trim(both '/' FROM name), '/'))[1] = auth.uid()::text
    AND public.auth_is_non_anonymous_authenticated()
  );

ALTER POLICY "avatars_update_own_folder" ON storage.objects
  USING (
    bucket_id = 'avatars'
    AND (string_to_array(trim(both '/' FROM name), '/'))[1] = auth.uid()::text
    AND public.auth_is_non_anonymous_authenticated()
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (string_to_array(trim(both '/' FROM name), '/'))[1] = auth.uid()::text
    AND public.auth_is_non_anonymous_authenticated()
  );

ALTER POLICY "avatars_delete_own_folder" ON storage.objects
  USING (
    bucket_id = 'avatars'
    AND (string_to_array(trim(both '/' FROM name), '/'))[1] = auth.uid()::text
    AND public.auth_is_non_anonymous_authenticated()
  );
