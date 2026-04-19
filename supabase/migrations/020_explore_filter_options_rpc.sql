-- ============================================================
-- 020: Explore filter options — single RPC (replaces client paging)
-- ============================================================
-- Returns JSONB consumed by src/data/supabase/appAdapter.js to build
-- the same shape as legacy fetchFilterOptions × 3 + mergeExploreFilterOptions.
-- SECURITY INVOKER: respects RLS (authenticated, non-anonymous per 019).
--
-- Grant: authenticated + service_role only (Explore requires sign-in).

CREATE OR REPLACE FUNCTION public.get_explore_filter_options_db()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tcg',
    jsonb_build_object(
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
         WHERE origin IN ('pokemontcg.io', 'tcgdex', 'manual')),
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
    ),
    'pocket',
    jsonb_build_object(
      'card_types',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT card_type AS x
           FROM cards
           WHERE origin = 'tcgdex'
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
         WHERE origin = 'tcgdex'),
        '[]'::jsonb
      )
    ),
    'custom',
    jsonb_build_object(
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
    )
  );
$$;

COMMENT ON FUNCTION public.get_explore_filter_options_db() IS
  'Distinct filter values for Explore in one round-trip; client merges static option lists.';

GRANT EXECUTE ON FUNCTION public.get_explore_filter_options_db() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_explore_filter_options_db() TO service_role;
