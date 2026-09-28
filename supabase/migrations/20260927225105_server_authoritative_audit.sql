-- ============================================================
-- Phase 2D: server-authoritative annotation audit fields
-- ============================================================
-- Independent of 2B (either can be applied first).
--
-- Production state (read-only audit 2026-09-27):
--   * apply_annotation_with_history (SECURITY INVOKER) copies version,
--     updated_by and updated_at from the client's p_row. patchAnnotationsImpl
--     sends version = read version + 1, updated_by = its own uid and
--     updated_at = the browser clock. A forged p_row can set any version
--     (including a lower one), any updated_by and any timestamp.
--   * p_batch_run_id is only FK-checked, so a caller can file history under
--     another user's batch run.
--   * edit_history INSERT policy checks only that the caller is signed in:
--     direct PostgREST inserts can forge edited_by, edited_at and
--     batch_run_id. The app never inserts history directly.
--   * annotations policy is FOR ALL: direct PostgREST UPDATE/DELETE of any
--     annotation, with any audit values and no history. The app only
--     INSERTs directly (insertInitialAnnotationForCard, version 1).
--   * apply_annotation_value_cleanup (Data Health) already derives
--     version + 1, now() and auth.uid() server-side (no history rows; that
--     gap is the separate "Data Health cleanup audit trail" item).
--
-- After this migration:
--   * BEFORE INSERT OR UPDATE trigger on annotations, for signed-in client
--     sessions only (auth.role() = 'authenticated'): updated_by = auth.uid(),
--     updated_at = now(); INSERT version must be 1 (or omitted); UPDATE
--     version must be exactly old + 1; card_id cannot change. Applies to
--     every path: the RPC, direct PostgREST writes and the cleanup RPC.
--     service_role (ingest/migration scripts) and direct SQL (no JWT) keep
--     explicit values.
--   * apply_annotation_with_history: requires a signed-in caller, requires
--     p_expected_version on update, rejects p_row.version other than
--     expected + 1 (insert: 1), derives the audit columns itself, and
--     rejects a batch run the caller does not own. The optimistic-lock
--     WHERE t.version = p_expected_version and the P0001
--     ANNOTATION_VERSION_CONFLICT error are unchanged.
--   * New rejections use SQLSTATE 22023 / 42501, never P0001: the client
--     treats P0001 as a version conflict and retries it six times.
--   * edit_history INSERT policy: edited_by = caller, edited_at = now()
--     (the transaction timestamp, which is what the column default gives),
--     batch_run_id NULL or owned by the caller.
--   * Table privileges: authenticated loses DELETE/TRUNCATE on annotations
--     (unused; card deletes still cascade because FK actions bypass RLS and
--     grants) and UPDATE/DELETE/TRUNCATE on edit_history and batch_runs
--     (no policies allowed them anyway). anon loses all write privileges.
--
-- No client change is required: the client already sends
-- version = read + 1 and its own uid. Its values are now checked or
-- replaced, so a skewed browser clock no longer reaches updated_at.
--
-- Rollback: see the matching block at the end of this file.

BEGIN;

-- ── Trigger: derive audit columns for client sessions ──────────
CREATE OR REPLACE FUNCTION public.annotations_enforce_server_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Only signed-in client sessions are constrained. service_role (ingest,
  -- migrate_data.py) and direct SQL without a JWT keep explicit values.
  IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.version IS NOT NULL AND NEW.version <> 1 THEN
      RAISE EXCEPTION 'ANNOTATION_VERSION_INVALID: a new annotation starts at version 1 (got %).', NEW.version
        USING ERRCODE = '22023';
    END IF;
    NEW.version := 1;
  ELSE
    IF NEW.card_id IS DISTINCT FROM OLD.card_id THEN
      RAISE EXCEPTION 'ANNOTATION_CARD_ID_IMMUTABLE: card_id cannot be changed.'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.version IS DISTINCT FROM coalesce(OLD.version, 0) + 1 THEN
      RAISE EXCEPTION 'ANNOTATION_VERSION_INVALID: expected version %, got %.',
        coalesce(OLD.version, 0) + 1, NEW.version
        USING ERRCODE = '22023';
    END IF;
  END IF;

  NEW.updated_by := (SELECT auth.uid());
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.annotations_enforce_server_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS annotations_enforce_server_audit ON public.annotations;
CREATE TRIGGER annotations_enforce_server_audit
  BEFORE INSERT OR UPDATE ON public.annotations
  FOR EACH ROW EXECUTE FUNCTION public.annotations_enforce_server_audit();

-- ── RPC: derive audit fields, validate version and batch run ───
CREATE OR REPLACE FUNCTION public.apply_annotation_with_history(p_is_insert boolean, p_expected_version integer, p_row jsonb, p_history jsonb, p_batch_run_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  updated int;
  r annotations%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.auth_is_non_anonymous_authenticated() THEN
    RAISE EXCEPTION 'Sign in required to save annotations.'
      USING ERRCODE = '42501';
  END IF;

  IF p_batch_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.batch_runs b
    WHERE b.id = p_batch_run_id AND b.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'BATCH_RUN_NOT_OWNED: batch run % does not belong to you.', p_batch_run_id
      USING ERRCODE = '42501';
  END IF;

  r := jsonb_populate_record(NULL::annotations, p_row);
  r.updated_by := v_uid;
  r.updated_at := now();

  IF p_is_insert THEN
    IF r.version IS NOT NULL AND r.version <> 1 THEN
      RAISE EXCEPTION 'ANNOTATION_VERSION_INVALID: a new annotation starts at version 1 (got %).', r.version
        USING ERRCODE = '22023';
    END IF;
    r.version := 1;

    INSERT INTO annotations
    SELECT r.*;
  ELSE
    IF p_expected_version IS NULL THEN
      RAISE EXCEPTION 'ANNOTATION_VERSION_INVALID: expected version is required for an update.'
        USING ERRCODE = '22023';
    END IF;
    IF r.version IS DISTINCT FROM p_expected_version + 1 THEN
      RAISE EXCEPTION 'ANNOTATION_VERSION_INVALID: expected version %, got %.',
        p_expected_version + 1, r.version
        USING ERRCODE = '22023';
    END IF;

    UPDATE annotations AS t
    SET
      (art_style, main_character, background_pokemon, background_humans, additional_characters,
       background_details, emotion, pose, actions, items, held_item, pokeball, evolution_items,
       berries, card_subcategory, trainer_card_subgroup, holiday_theme, multi_card,
       camera_angle, perspective, weather, environment, storytelling, card_locations,
       pkmn_region, card_region, primary_color, secondary_color, shape, trainer_card_type,
       stamp, card_border, energy_type, rival_group, image_override, notes, top_10_themes,
       wtpc_episode, video_game, video_game_location, video_appearance, shorts_appearance,
       region_appearance, thumbnail_used, video_url, video_title, video_type, video_region,
       video_location, pocket_exclusive, owned, extra, overrides, version, updated_by, updated_at)
      = (r.art_style, r.main_character, r.background_pokemon, r.background_humans, r.additional_characters,
         r.background_details, r.emotion, r.pose, r.actions, r.items, r.held_item, r.pokeball,
         r.evolution_items, r.berries, r.card_subcategory, r.trainer_card_subgroup, r.holiday_theme,
         r.multi_card, r.camera_angle, r.perspective, r.weather, r.environment, r.storytelling,
         r.card_locations, r.pkmn_region, r.card_region, r.primary_color, r.secondary_color, r.shape,
         r.trainer_card_type, r.stamp, r.card_border, r.energy_type, r.rival_group, r.image_override,
         r.notes, r.top_10_themes, r.wtpc_episode, r.video_game, r.video_game_location,
         r.video_appearance, r.shorts_appearance, r.region_appearance, r.thumbnail_used, r.video_url,
         r.video_title, r.video_type, r.video_region, r.video_location, r.pocket_exclusive, r.owned,
         r.extra, r.overrides, t.version + 1, v_uid, now())
    WHERE t.card_id = r.card_id AND t.version = p_expected_version;

    GET DIAGNOSTICS updated = ROW_COUNT;
    IF updated = 0 THEN
      RAISE EXCEPTION 'ANNOTATION_VERSION_CONFLICT: This card was updated elsewhere. Refresh and try again.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_history IS NOT NULL
     AND jsonb_typeof(p_history) = 'array'
     AND jsonb_array_length(p_history) > 0 THEN
    INSERT INTO edit_history (card_id, field_name, old_value, new_value, edited_by, batch_run_id)
    SELECT
      r.card_id,
      (h->>'field_name')::text,
      (h->>'old_value')::text,
      (h->>'new_value')::text,
      v_uid,
      p_batch_run_id
    FROM jsonb_array_elements(p_history) AS h;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.apply_annotation_with_history(boolean, integer, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_annotation_with_history(boolean, integer, jsonb, jsonb, uuid) TO authenticated, service_role;

-- ── edit_history: only the caller, now, own batch runs ─────────
ALTER POLICY "authenticated insert edit_history" ON public.edit_history
  TO authenticated
  WITH CHECK (
    public.auth_is_non_anonymous_authenticated()
    AND edited_by = (SELECT auth.uid())
    AND edited_at = now()
    AND (
      batch_run_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.batch_runs b
        WHERE b.id = edit_history.batch_run_id
          AND b.user_id = (SELECT auth.uid())
      )
    )
  );

-- ── Table privileges (defence in depth; RLS still applies) ─────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.annotations, public.edit_history, public.batch_runs FROM anon;
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.annotations FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.edit_history FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.batch_runs FROM authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verify after applying (read-only) ───────────────────────────
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.annotations'::regclass and not tgisinternal;
--   -- expect annotations_enforce_server_audit, O
--   select with_check from pg_policies
--    where tablename = 'edit_history' and policyname = 'authenticated insert edit_history';
--   select table_name, grantee, string_agg(privilege_type, ',' order by 1)
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('annotations', 'edit_history', 'batch_runs')
--      and grantee in ('anon', 'authenticated') group by 1, 2;
-- Then the rolled-back JWT probes in docs/plans/phase-2b-2d-write-authz.md,
-- and one real save + one Batch run in the app (History shows the run).

-- ── Rollback ────────────────────────────────────────────────────
-- BEGIN;
-- DROP TRIGGER annotations_enforce_server_audit ON public.annotations;
-- DROP FUNCTION public.annotations_enforce_server_audit();
-- Re-create apply_annotation_with_history from
--   supabase/tests/fixtures/prod_shape_write_authz.sql (the deployed body)
--   and GRANT EXECUTE ... TO PUBLIC, anon;
-- ALTER POLICY "authenticated insert edit_history" ON public.edit_history TO public
--   WITH CHECK (auth_is_non_anonymous_authenticated());
-- GRANT ALL ON public.annotations, public.edit_history, public.batch_runs TO anon, authenticated;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
