-- ============================================================
-- 053: Split get_explore_filter_options_db() into per-bucket RPCs
-- ============================================================
-- The monolithic function timed out (>10s) after the 19k-row
-- ptcgdb bulk ingest.  Splitting into 4 lighter functions lets
-- each bucket complete within the Supabase statement timeout.
-- The client calls all 4 in parallel (same wall-clock, no single
-- function exceeds the budget).
--
-- Replaces the monolithic get_explore_filter_options_db() created
-- by migration 050.  Drop it first so there is no ambiguity.

DROP FUNCTION IF EXISTS public.get_explore_filter_options_db();

-- ── TCG bucket (pokemontcg.io + manual) ──────────────────────
CREATE OR REPLACE FUNCTION public.get_tcg_filter_options_db()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'supertypes',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT supertype AS x
         FROM cards
         WHERE origin IN ('pokemontcg.io', 'manual')
           AND supertype IS NOT NULL
           AND btrim(supertype) <> ''
       ) d),
      '[]'::jsonb
    ),
    'rarities',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT rarity AS x
         FROM cards
         WHERE origin IN ('pokemontcg.io', 'manual')
           AND rarity IS NOT NULL
           AND btrim(rarity) <> ''
       ) d),
      '[]'::jsonb
    ),
    'sets',
    COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object('id', id, 'name', name, 'series', series)
         ORDER BY series NULLS LAST, name
       )
       FROM sets
       WHERE id IN (
         SELECT DISTINCT set_id FROM cards
         WHERE origin IN ('pokemontcg.io', 'manual')
           AND set_id IS NOT NULL
           AND btrim(set_id) <> ''
       )),
      '[]'::jsonb
    ),
    'pokemon_metadata_regions',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT region AS x
         FROM pokemon_metadata
         WHERE region IS NOT NULL AND btrim(region) <> ''
       ) d),
      '[]'::jsonb
    ),
    'generations',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT generation AS x
         FROM pokemon_metadata
         WHERE generation IS NOT NULL
       ) d),
      '[]'::jsonb
    ),
    'colors',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT color AS x
         FROM pokemon_metadata
         WHERE color IS NOT NULL AND btrim(color) <> ''
       ) d),
      '[]'::jsonb
    ),
    'artists',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT artist AS x
         FROM cards
         WHERE origin IN ('pokemontcg.io', 'manual')
           AND artist IS NOT NULL
           AND btrim(artist) <> ''
       ) d),
      '[]'::jsonb
    ),
    'evo_raw',
    COALESCE(
      (SELECT jsonb_agg(evo ORDER BY evo)
       FROM (
         SELECT DISTINCT evolution_chain::text AS evo
         FROM pokemon_metadata
         WHERE evolution_chain IS NOT NULL
       ) d
       WHERE evo IS NOT NULL AND btrim(evo) <> ''),
      '[]'::jsonb
    ),
    'pokemon_metadata_names',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT name AS x
         FROM pokemon_metadata
         WHERE name IS NOT NULL AND btrim(name) <> ''
       ) d),
      '[]'::jsonb
    ),
    'annotations_weather',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT weather AS x
         FROM annotations
         WHERE weather IS NOT NULL AND btrim(weather) <> ''
       ) d),
      '[]'::jsonb
    ),
    'annotations_environment',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT environment AS x
         FROM annotations
         WHERE environment IS NOT NULL AND btrim(environment) <> ''
       ) d),
      '[]'::jsonb
    )
  );
$$;

-- ── Pocket bucket (tcgdex, non-Japanese) ─────────────────────
CREATE OR REPLACE FUNCTION public.get_pocket_filter_options_db()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'card_types',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT card_type AS x
         FROM cards
         WHERE origin = 'tcgdex'
           AND (origin_detail IS NULL OR origin_detail <> 'japanese')
           AND card_type IS NOT NULL
           AND btrim(card_type::text) <> ''
       ) d),
      '[]'::jsonb
    ),
    'rarities',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT rarity AS x
         FROM cards
         WHERE origin = 'tcgdex'
           AND (origin_detail IS NULL OR origin_detail <> 'japanese')
           AND rarity IS NOT NULL
           AND btrim(rarity) <> ''
       ) d),
      '[]'::jsonb
    ),
    'elements',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT element AS x
         FROM cards
         WHERE origin = 'tcgdex'
           AND (origin_detail IS NULL OR origin_detail <> 'japanese')
           AND element IS NOT NULL
           AND btrim(element::text) <> ''
       ) d),
      '[]'::jsonb
    ),
    'stages',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT stage AS x
         FROM cards
         WHERE origin = 'tcgdex'
           AND (origin_detail IS NULL OR origin_detail <> 'japanese')
           AND stage IS NOT NULL
           AND btrim(stage::text) <> ''
       ) d),
      '[]'::jsonb
    ),
    'sets',
    COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object('id', id, 'name', name, 'series', series)
         ORDER BY series NULLS LAST, name
       )
       FROM sets
       WHERE origin = 'tcgdex'
         AND id IN (
           SELECT DISTINCT set_id FROM cards
           WHERE origin = 'tcgdex'
             AND (origin_detail IS NULL OR origin_detail <> 'japanese')
         )),
      '[]'::jsonb
    )
  );
$$;

-- ── Custom bucket (manual) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_custom_filter_options_db()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'supertypes',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT supertype AS x
         FROM cards
         WHERE origin = 'manual'
           AND supertype IS NOT NULL
           AND btrim(supertype) <> ''
       ) d),
      '[]'::jsonb
    ),
    'rarities',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT rarity AS x
         FROM cards
         WHERE origin = 'manual'
           AND rarity IS NOT NULL
           AND btrim(rarity) <> ''
       ) d),
      '[]'::jsonb
    ),
    'artists',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (
         SELECT DISTINCT artist AS x
         FROM cards
         WHERE origin = 'manual'
           AND artist IS NOT NULL
           AND btrim(artist) <> ''
       ) d),
      '[]'::jsonb
    ),
    'sets',
    COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object('id', id, 'name', name, 'series', series)
         ORDER BY series NULLS LAST, name
       )
       FROM sets
       WHERE origin = 'manual'),
      '[]'::jsonb
    )
  );
$$;

-- ── Japanese bucket (tcgdex + ptcgdb) ────────────────────────
CREATE OR REPLACE FUNCTION public.get_japanese_filter_options_db()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH jpn_cards AS MATERIALIZED (
    SELECT card_type, rarity, element, stage, artist, set_id
    FROM cards
    WHERE origin IN ('tcgdex', 'ptcgdb')
      AND origin_detail = 'japanese'
      AND set_id IS NOT NULL
      AND btrim(set_id) <> ''
      AND set_id NOT IN ('neo1', 'neo2', 'neo3', 'neo4')
  )
  SELECT jsonb_build_object(
    'card_types',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (SELECT DISTINCT card_type AS x FROM jpn_cards WHERE card_type IS NOT NULL AND btrim(card_type::text) <> '') d),
      '[]'::jsonb
    ),
    'rarities',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (SELECT DISTINCT rarity AS x FROM jpn_cards WHERE rarity IS NOT NULL AND btrim(rarity) <> '') d),
      '[]'::jsonb
    ),
    'elements',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (SELECT DISTINCT element AS x FROM jpn_cards WHERE element IS NOT NULL AND btrim(element::text) <> '') d),
      '[]'::jsonb
    ),
    'stages',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (SELECT DISTINCT stage AS x FROM jpn_cards WHERE stage IS NOT NULL AND btrim(stage::text) <> '') d),
      '[]'::jsonb
    ),
    'sets',
    COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object('id', id, 'name', name, 'series', series)
         ORDER BY series NULLS LAST, name
       )
       FROM (
         SELECT DISTINCT c.set_id AS id,
                COALESCE(s.name, upper(c.set_id)) AS name,
                s.series
         FROM jpn_cards c
         LEFT JOIN sets s ON s.id = c.set_id
       ) combined),
      '[]'::jsonb
    ),
    'artists',
    COALESCE(
      (SELECT jsonb_agg(x ORDER BY x)
       FROM (SELECT DISTINCT artist AS x FROM jpn_cards WHERE artist IS NOT NULL AND btrim(artist) <> '') d),
      '[]'::jsonb
    )
  );
$$;

-- ── Grants ───────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_tcg_filter_options_db() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tcg_filter_options_db() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pocket_filter_options_db() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pocket_filter_options_db() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_custom_filter_options_db() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_custom_filter_options_db() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_japanese_filter_options_db() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_japanese_filter_options_db() TO service_role;

-- ── Comments ─────────────────────────────────────────────────
COMMENT ON FUNCTION public.get_tcg_filter_options_db() IS
  'TCG bucket for Explore filter options (pokemontcg.io + manual). Part of split-RPC set (053).';
COMMENT ON FUNCTION public.get_pocket_filter_options_db() IS
  'Pocket bucket for Explore filter options (tcgdex non-Japanese). Part of split-RPC set (053).';
COMMENT ON FUNCTION public.get_custom_filter_options_db() IS
  'Custom bucket for Explore filter options (manual only). Part of split-RPC set (053).';
COMMENT ON FUNCTION public.get_japanese_filter_options_db() IS
  'Japanese bucket for Explore filter options (tcgdex + ptcgdb). Uses MATERIALIZED CTE for single scan. Part of split-RPC set (053).';
