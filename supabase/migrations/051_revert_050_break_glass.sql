-- ============================================================
-- 051: BREAK-GLASS ONLY — Revert 050 RPC to post-045 state
-- ============================================================
-- DO NOT APPLY in normal deploys. This migration exists only for
-- emergency rollback: restores get_explore_filter_options_db() to
-- the single-origin tcgdex-only Japanese bucket (post-045 state).
--
-- Companion to 050 (which adds dual-origin tcgdex+ptcgdb Japanese
-- bucket). Apply manually via Supabase SQL Editor if 050 breaks
-- Explore filters and a quick revert is faster than a fix-forward.
-- ============================================================

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
    ),
    'japanese',
    jsonb_build_object(
      'card_types',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT card_type AS x
           FROM cards
           WHERE origin = 'tcgdex'
             AND origin_detail = 'japanese'
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
             AND origin_detail = 'japanese'
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
             AND origin_detail = 'japanese'
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
             AND origin_detail = 'japanese'
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
           AND id NOT IN ('neo1', 'neo2', 'neo3', 'neo4')
           AND id IN (
             SELECT DISTINCT set_id FROM cards
             WHERE origin = 'tcgdex'
               AND origin_detail = 'japanese'
           )),
        '[]'::jsonb
      ),
      'artists',
      COALESCE(
        (SELECT jsonb_agg(x ORDER BY x)
         FROM (
           SELECT DISTINCT artist AS x
           FROM cards
           WHERE origin = 'tcgdex'
             AND origin_detail = 'japanese'
             AND artist IS NOT NULL
             AND btrim(artist) <> ''
         ) d),
        '[]'::jsonb
      )
    )
  );
$$;

COMMENT ON FUNCTION public.get_explore_filter_options_db() IS
  'Distinct filter values for Explore in one round-trip; client merges static option lists. Includes Japanese TCG data.';
