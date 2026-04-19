-- ============================================================
-- 021: Form options — single RPC for Workbench / CardDetail / CustomCardForm
-- ============================================================
-- Replaces client-side paging over cards + annotations in fetchFormOptions.
-- Client still merges static lists from annotationOptions.js + mergeAnnotationUsageIntoOptionsFromRpc.
-- SECURITY INVOKER, RLS applies. GRANT: authenticated + service_role (same as 020).

CREATE OR REPLACE FUNCTION public.get_form_options_db()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ann AS MATERIALIZED (
    SELECT
      art_style,
      main_character,
      background_pokemon,
      background_humans,
      additional_characters,
      background_details,
      emotion,
      pose,
      actions,
      items,
      held_item,
      pokeball,
      evolution_items,
      berries,
      card_subcategory,
      trainer_card_subgroup,
      holiday_theme,
      multi_card,
      video_type,
      video_region,
      video_location,
      camera_angle,
      perspective,
      weather,
      environment,
      storytelling,
      card_locations,
      pkmn_region,
      card_region,
      primary_color,
      secondary_color,
      shape,
      trainer_card_type,
      stamp,
      card_border,
      energy_type,
      rival_group,
      top_10_themes,
      wtpc_episode,
      video_game,
      video_game_location,
      video_title
    FROM annotations
  ),
  jnorm AS (
    SELECT
      CASE
        WHEN jsonb_typeof(COALESCE(art_style, '[]'::jsonb)) = 'array' THEN COALESCE(art_style, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS art_style,
      CASE
        WHEN jsonb_typeof(COALESCE(main_character, '[]'::jsonb)) = 'array' THEN COALESCE(main_character, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS main_character,
      CASE
        WHEN jsonb_typeof(COALESCE(background_pokemon, '[]'::jsonb)) = 'array' THEN COALESCE(background_pokemon, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS background_pokemon,
      CASE
        WHEN jsonb_typeof(COALESCE(background_humans, '[]'::jsonb)) = 'array' THEN COALESCE(background_humans, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS background_humans,
      CASE
        WHEN jsonb_typeof(COALESCE(additional_characters, '[]'::jsonb)) = 'array' THEN COALESCE(additional_characters, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS additional_characters,
      CASE
        WHEN jsonb_typeof(COALESCE(background_details, '[]'::jsonb)) = 'array' THEN COALESCE(background_details, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS background_details,
      CASE
        WHEN jsonb_typeof(COALESCE(emotion, '[]'::jsonb)) = 'array' THEN COALESCE(emotion, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS emotion,
      CASE
        WHEN jsonb_typeof(COALESCE(pose, '[]'::jsonb)) = 'array' THEN COALESCE(pose, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS pose,
      CASE
        WHEN jsonb_typeof(COALESCE(actions, '[]'::jsonb)) = 'array' THEN COALESCE(actions, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS actions,
      CASE
        WHEN jsonb_typeof(COALESCE(items, '[]'::jsonb)) = 'array' THEN COALESCE(items, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS items,
      CASE
        WHEN jsonb_typeof(COALESCE(held_item, '[]'::jsonb)) = 'array' THEN COALESCE(held_item, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS held_item,
      CASE
        WHEN jsonb_typeof(COALESCE(pokeball, '[]'::jsonb)) = 'array' THEN COALESCE(pokeball, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS pokeball,
      CASE
        WHEN jsonb_typeof(COALESCE(evolution_items, '[]'::jsonb)) = 'array' THEN COALESCE(evolution_items, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS evolution_items,
      CASE
        WHEN jsonb_typeof(COALESCE(berries, '[]'::jsonb)) = 'array' THEN COALESCE(berries, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS berries,
      CASE
        WHEN jsonb_typeof(COALESCE(card_subcategory, '[]'::jsonb)) = 'array' THEN COALESCE(card_subcategory, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS card_subcategory,
      CASE
        WHEN jsonb_typeof(COALESCE(trainer_card_subgroup, '[]'::jsonb)) = 'array' THEN COALESCE(trainer_card_subgroup, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS trainer_card_subgroup,
      CASE
        WHEN jsonb_typeof(COALESCE(holiday_theme, '[]'::jsonb)) = 'array' THEN COALESCE(holiday_theme, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS holiday_theme,
      CASE
        WHEN jsonb_typeof(COALESCE(multi_card, '[]'::jsonb)) = 'array' THEN COALESCE(multi_card, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS multi_card,
      CASE
        WHEN jsonb_typeof(COALESCE(video_type, '[]'::jsonb)) = 'array' THEN COALESCE(video_type, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS video_type,
      CASE
        WHEN jsonb_typeof(COALESCE(video_region, '[]'::jsonb)) = 'array' THEN COALESCE(video_region, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS video_region,
      CASE
        WHEN jsonb_typeof(COALESCE(video_location, '[]'::jsonb)) = 'array' THEN COALESCE(video_location, '[]'::jsonb)
        ELSE '[]'::jsonb
      END AS video_location
    FROM ann
  )
  SELECT jsonb_build_object(
    'cards',
    jsonb_build_object(
      'rarity',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT rarity AS x
           FROM cards
           WHERE origin = 'pokemontcg.io'
             AND rarity IS NOT NULL
             AND btrim(rarity) <> ''
         ) d),
        '[]'::jsonb
      ),
      'artist',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT artist AS x
           FROM cards
           WHERE origin = 'pokemontcg.io'
             AND artist IS NOT NULL
             AND btrim(artist) <> ''
         ) d),
        '[]'::jsonb
      ),
      'name',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT name AS x
           FROM cards
           WHERE origin = 'pokemontcg.io'
             AND name IS NOT NULL
             AND btrim(name) <> ''
         ) d),
        '[]'::jsonb
      )
    ),
    'sets',
    COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object('id', id, 'name', name, 'series', series)
         ORDER BY series NULLS LAST, name
       )
       FROM sets),
      '[]'::jsonb
    ),
    'pokemon_metadata',
    jsonb_build_object(
      'regions',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT region AS x
           FROM pokemon_metadata
           WHERE region IS NOT NULL AND btrim(region) <> ''
         ) d),
        '[]'::jsonb
      ),
      'names',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT name AS x
           FROM pokemon_metadata
           WHERE name IS NOT NULL AND btrim(name) <> ''
         ) d),
        '[]'::jsonb
      ),
      'evo_raw',
      COALESCE(
        (SELECT jsonb_agg(evo ORDER BY evo)
         FROM (
           SELECT DISTINCT evolution_chain::text AS evo
           FROM pokemon_metadata
           WHERE evolution_chain IS NOT NULL AND btrim(evolution_chain::text) <> ''
         ) d),
        '[]'::jsonb
      )
    ),
    'annotations',
    jsonb_build_object(
      'art_style',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.art_style) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'main_character',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.main_character) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'background_pokemon',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.background_pokemon) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'background_humans',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.background_humans) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'additional_characters',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.additional_characters) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'background_details',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.background_details) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'emotion',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.emotion) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'pose',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.pose) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'actions',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.actions) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'items',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.items) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'held_item',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.held_item) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'pokeball',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.pokeball) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'evolution_items',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.evolution_items) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'berries',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.berries) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'card_subcategory',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.card_subcategory) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'trainer_card_subgroup',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.trainer_card_subgroup) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'holiday_theme',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.holiday_theme) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'multi_card',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.multi_card) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'video_type',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.video_type) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'video_region',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.video_region) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'video_location',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT elem AS x
           FROM jnorm j,
           LATERAL jsonb_array_elements_text(j.video_location) AS elem
           WHERE elem IS NOT NULL AND btrim(elem) <> ''
         ) d),
        '[]'::jsonb
      ),
      'camera_angle',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT camera_angle AS x
           FROM ann
           WHERE camera_angle IS NOT NULL AND btrim(camera_angle) <> ''
         ) d),
        '[]'::jsonb
      ),
      'perspective',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT perspective AS x
           FROM ann
           WHERE perspective IS NOT NULL AND btrim(perspective) <> ''
         ) d),
        '[]'::jsonb
      ),
      'weather',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT weather AS x
           FROM ann
           WHERE weather IS NOT NULL AND btrim(weather) <> ''
         ) d),
        '[]'::jsonb
      ),
      'environment',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT environment AS x
           FROM ann
           WHERE environment IS NOT NULL AND btrim(environment) <> ''
         ) d),
        '[]'::jsonb
      ),
      'storytelling',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT storytelling AS x
           FROM ann
           WHERE storytelling IS NOT NULL AND btrim(storytelling) <> ''
         ) d),
        '[]'::jsonb
      ),
      'card_locations',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT card_locations AS x
           FROM ann
           WHERE card_locations IS NOT NULL AND btrim(card_locations) <> ''
         ) d),
        '[]'::jsonb
      ),
      'pkmn_region',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT pkmn_region AS x
           FROM ann
           WHERE pkmn_region IS NOT NULL AND btrim(pkmn_region) <> ''
         ) d),
        '[]'::jsonb
      ),
      'card_region',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT card_region AS x
           FROM ann
           WHERE card_region IS NOT NULL AND btrim(card_region) <> ''
         ) d),
        '[]'::jsonb
      ),
      'primary_color',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT primary_color AS x
           FROM ann
           WHERE primary_color IS NOT NULL AND btrim(primary_color) <> ''
         ) d),
        '[]'::jsonb
      ),
      'secondary_color',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT secondary_color AS x
           FROM ann
           WHERE secondary_color IS NOT NULL AND btrim(secondary_color) <> ''
         ) d),
        '[]'::jsonb
      ),
      'shape',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT shape AS x
           FROM ann
           WHERE shape IS NOT NULL AND btrim(shape) <> ''
         ) d),
        '[]'::jsonb
      ),
      'trainer_card_type',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT trainer_card_type AS x
           FROM ann
           WHERE trainer_card_type IS NOT NULL AND btrim(trainer_card_type) <> ''
         ) d),
        '[]'::jsonb
      ),
      'stamp',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT stamp AS x
           FROM ann
           WHERE stamp IS NOT NULL AND btrim(stamp) <> ''
         ) d),
        '[]'::jsonb
      ),
      'card_border',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT card_border AS x
           FROM ann
           WHERE card_border IS NOT NULL AND btrim(card_border) <> ''
         ) d),
        '[]'::jsonb
      ),
      'energy_type',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT energy_type AS x
           FROM ann
           WHERE energy_type IS NOT NULL AND btrim(energy_type) <> ''
         ) d),
        '[]'::jsonb
      ),
      'rival_group',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT rival_group AS x
           FROM ann
           WHERE rival_group IS NOT NULL AND btrim(rival_group) <> ''
         ) d),
        '[]'::jsonb
      ),
      'top_10_themes',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT top_10_themes AS x
           FROM ann
           WHERE top_10_themes IS NOT NULL AND btrim(top_10_themes) <> ''
         ) d),
        '[]'::jsonb
      ),
      'wtpc_episode',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT wtpc_episode AS x
           FROM ann
           WHERE wtpc_episode IS NOT NULL AND btrim(wtpc_episode) <> ''
         ) d),
        '[]'::jsonb
      ),
      'video_game',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT video_game AS x
           FROM ann
           WHERE video_game IS NOT NULL AND btrim(video_game) <> ''
         ) d),
        '[]'::jsonb
      ),
      'video_game_location',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT video_game_location AS x
           FROM ann
           WHERE video_game_location IS NOT NULL AND btrim(video_game_location) <> ''
         ) d),
        '[]'::jsonb
      ),
      'video_title',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT video_title AS x
           FROM ann
           WHERE video_title IS NOT NULL AND btrim(video_title) <> ''
         ) d),
        '[]'::jsonb
      )
    )
  );
$$;

COMMENT ON FUNCTION public.get_form_options_db() IS
  'Distinct values for fetchFormOptions: cards (TCG), sets, pokemon_metadata, annotation columns.';

GRANT EXECUTE ON FUNCTION public.get_form_options_db() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_form_options_db() TO service_role;
