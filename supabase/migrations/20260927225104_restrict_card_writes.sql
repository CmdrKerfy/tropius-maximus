-- ============================================================
-- Phase 2B: restrict card and set writes
-- ============================================================
-- Owner approved Option A on 2026-09-27: any non-anonymous signed-in
-- collaborator may rename/delete any manual card.
--
-- Production state (read-only audit 2026-09-27):
--   * cards INSERT/UPDATE/DELETE policies check only
--     auth_is_non_anonymous_authenticated(), so any signed-in collaborator
--     can PATCH or DELETE any of the 47,185 API cards (pokemontcg.io,
--     tcgdex, ptcgdb) straight through PostgREST. Deleting an API card
--     cascades to its annotation; the next ingest re-inserts the card but
--     the annotation is gone.
--   * sets UPDATE has the same check, so API set names/series can be
--     rewritten by any collaborator. No sets DELETE policy.
--   * anon and authenticated hold every table privilege, including
--     TRUNCATE (which RLS does not cover; PostgREST cannot issue it).
--
-- App write paths (src/data/supabase/appAdapter.js):
--   * addTcgCard / addPocketCard: INSERT cards (origin 'manual',
--     created_by = caller) + INSERT sets via ensureManualSetRow (origin
--     'manual'; 23505 ignored) + compensating DELETE of the new card.
--   * deleteCardsById: DELETE cards; the manual-only check is client-side.
--   * renameManualCard: RPC rename_manual_card_with_history (INVOKER, so
--     it needs the UPDATE policy).
--   * No app path updates API cards or any set; API-card edits go to
--     annotations.overrides.
--   * Ingest (push_duckdb_to_supabase.py) and migrate_data.py use the
--     service key (service_role, BYPASSRLS); unaffected.
--   * Public share: get_public_card_for_share is SECURITY DEFINER owned by
--     postgres; unaffected.
--
-- After this migration:
--   * cards: authenticated keeps SELECT, INSERT, DELETE. INSERT only
--     origin 'manual' with created_by = caller and no ingest fields.
--     DELETE only manual cards the caller may manage. No direct UPDATE:
--     rename goes through the RPC, which is now SECURITY DEFINER and
--     writes history.
--   * sets: authenticated keeps SELECT, INSERT (origin 'manual' only).
--   * anon: no write privileges on cards/sets.
--
-- Rollback: see the matching block at the end of this file.

BEGIN;

-- ── Owner-decision predicate ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_manual_card(p_created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  -- Option A: every signed-in collaborator.
  SELECT public.auth_is_non_anonymous_authenticated();
  -- Option C would be:
  --   SELECT public.auth_is_non_anonymous_authenticated()
  --     AND p_created_by = (SELECT auth.uid());
$$;

COMMENT ON FUNCTION public.can_manage_manual_card(uuid) IS
  'Phase 2B owner decision: who may rename/delete a manual card. Used by the cards DELETE policy and rename_manual_card_with_history.';

REVOKE EXECUTE ON FUNCTION public.can_manage_manual_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_manual_card(uuid) TO authenticated, service_role;

-- ── Table privileges (defence in depth; RLS still applies) ─────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.cards, public.sets FROM anon;
REVOKE UPDATE, TRUNCATE, TRIGGER, REFERENCES
  ON public.cards, public.sets FROM authenticated;
REVOKE DELETE ON public.sets FROM authenticated;

-- ── cards policies ──────────────────────────────────────────────
DROP POLICY "authenticated update cards" ON public.cards;

ALTER POLICY "authenticated insert cards" ON public.cards
  TO authenticated
  WITH CHECK (
    public.auth_is_non_anonymous_authenticated()
    AND origin = 'manual'
    AND created_by = (SELECT auth.uid())
    AND api_hash IS NULL
    AND last_seen_in_api IS NULL
  );

ALTER POLICY "authenticated delete cards" ON public.cards
  TO authenticated
  USING (
    origin = 'manual'
    AND public.can_manage_manual_card(created_by)
  );

-- ── sets policies ───────────────────────────────────────────────
DROP POLICY "authenticated update sets" ON public.sets;

ALTER POLICY "authenticated insert sets" ON public.sets
  TO authenticated
  WITH CHECK (
    public.auth_is_non_anonymous_authenticated()
    AND origin = 'manual'
  );

-- ── rename RPC: the only card UPDATE path, now SECURITY DEFINER ─
-- Same body and error texts as production, with schema-qualified names
-- (search_path '') and the owner-decision check.
CREATE OR REPLACE FUNCTION public.rename_manual_card_with_history(p_card_id text, p_new_name text)
 RETURNS TABLE(card_id text, old_name text, new_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_old_name text;
  v_origin text;
  v_created_by uuid;
  v_uid uuid;
  v_new_name text;
BEGIN
  IF NOT public.auth_is_non_anonymous_authenticated() THEN
    RAISE EXCEPTION 'Sign in required to rename cards.';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required to rename cards.';
  END IF;

  v_new_name := btrim(coalesce(p_new_name, ''));
  IF v_new_name = '' THEN
    RAISE EXCEPTION 'Card name cannot be empty.';
  END IF;

  SELECT c.name, c.origin, c.created_by
  INTO v_old_name, v_origin, v_created_by
  FROM public.cards AS c
  WHERE c.id = p_card_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found.';
  END IF;

  IF v_origin <> 'manual' THEN
    RAISE EXCEPTION 'Only manual/custom cards can be renamed.';
  END IF;

  IF NOT public.can_manage_manual_card(v_created_by) THEN
    RAISE EXCEPTION 'You can only rename cards you added.' USING ERRCODE = '42501';
  END IF;

  IF v_old_name IS NOT DISTINCT FROM v_new_name THEN
    RETURN QUERY SELECT p_card_id, v_old_name, v_old_name;
    RETURN;
  END IF;

  UPDATE public.cards AS c
  SET name = v_new_name
  WHERE c.id = p_card_id;

  INSERT INTO public.edit_history (card_id, field_name, old_value, new_value, edited_by)
  VALUES (p_card_id, 'card_name', v_old_name, v_new_name, v_uid);

  RETURN QUERY SELECT p_card_id, v_old_name, v_new_name;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rename_manual_card_with_history(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_manual_card_with_history(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verify after applying (read-only) ───────────────────────────
--   select policyname, cmd, roles, qual, with_check from pg_policies
--    where schemaname = 'public' and tablename in ('cards', 'sets') order by 1;
--   -- expect no UPDATE policies; insert/delete TO {authenticated}
--   select table_name, grantee, string_agg(privilege_type, ',' order by 1)
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('cards', 'sets')
--      and grantee in ('anon', 'authenticated', 'service_role') group by 1, 2;
--   -- expect anon SELECT only; authenticated cards DELETE,INSERT,SELECT,
--   -- sets INSERT,SELECT; service_role unchanged
--   select prosecdef, proconfig,
--          has_function_privilege('anon', oid, 'EXECUTE') anon_x
--     from pg_proc where proname = 'rename_manual_card_with_history';
--   -- expect true, {search_path=""}, false
-- Then the rolled-back JWT probes in docs/plans/phase-2b-2d-write-authz.md.

-- ── Rollback ────────────────────────────────────────────────────
-- BEGIN;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.cards, public.sets TO anon;
-- GRANT UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.cards, public.sets TO authenticated;
-- CREATE POLICY "authenticated update cards" ON public.cards
--   FOR UPDATE USING (auth_is_non_anonymous_authenticated());
-- CREATE POLICY "authenticated update sets" ON public.sets
--   FOR UPDATE USING (auth_is_non_anonymous_authenticated());
-- ALTER POLICY "authenticated insert cards" ON public.cards TO public
--   WITH CHECK (auth_is_non_anonymous_authenticated());
-- ALTER POLICY "authenticated delete cards" ON public.cards TO public
--   USING (auth_is_non_anonymous_authenticated());
-- ALTER POLICY "authenticated insert sets" ON public.sets TO public
--   WITH CHECK (auth_is_non_anonymous_authenticated());
-- Re-create rename_manual_card_with_history from 034 (SECURITY INVOKER,
--   search_path public) and GRANT EXECUTE ... TO PUBLIC, anon;
-- DROP FUNCTION public.can_manage_manual_card(uuid);
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
