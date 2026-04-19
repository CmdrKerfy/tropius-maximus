-- ============================================================
-- 017: Atomic annotation save + edit_history (single transaction)
-- ============================================================
-- Client sends full merged row as jsonb (same shape as PostgREST insert/update).
-- Phase 7: annotation write and audit rows succeed or fail together.

CREATE OR REPLACE FUNCTION public.apply_annotation_with_history(
  p_is_insert boolean,
  p_expected_version int,
  p_row jsonb,
  p_history jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated int;
  r annotations%ROWTYPE;
BEGIN
  r := jsonb_populate_record(NULL::annotations, p_row);

  IF p_is_insert THEN
    INSERT INTO annotations
    SELECT * FROM jsonb_populate_record(NULL::annotations, p_row);
  ELSE
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
         r.extra, r.overrides, r.version, r.updated_by, r.updated_at)
    WHERE t.card_id = r.card_id AND t.version = p_expected_version;

    GET DIAGNOSTICS updated = ROW_COUNT;
    IF updated = 0 THEN
      -- P0001: client maps via `isAnnotationVersionConflictFromRpc` (message may also appear in PostgREST `details` / `hint`)
      RAISE EXCEPTION 'ANNOTATION_VERSION_CONFLICT: This card was updated elsewhere. Refresh and try again.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_history IS NOT NULL
     AND jsonb_typeof(p_history) = 'array'
     AND jsonb_array_length(p_history) > 0 THEN
    INSERT INTO edit_history (card_id, field_name, old_value, new_value, edited_by)
    SELECT
      r.card_id,
      (h->>'field_name')::text,
      (h->>'old_value')::text,
      (h->>'new_value')::text,
      auth.uid()
    FROM jsonb_array_elements(p_history) AS h;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.apply_annotation_with_history(boolean, int, jsonb, jsonb) IS
  'Writes annotations + edit_history in one transaction (Phase 7).';

GRANT EXECUTE ON FUNCTION public.apply_annotation_with_history(boolean, int, jsonb, jsonb) TO authenticated;
