-- ============================================================
-- 055: Annotations filter indexes + cards JSONB indexes + ANALYZE helper
-- ============================================================
-- The annotations!inner JOIN path in fetchCards had no indexes on the
-- filter columns, forcing sequential scans when annotation filters were
-- active. Combined with stale planner statistics after bulk ingest, this
-- caused statement timeouts on Supabase free tier.
--
-- Also adds GIN indexes on cards.types / cards.subtypes for the contains
-- (@>.cs.) filters used in element/specialty filtering.

-- Annotations: scalar filter columns (TEXT / BOOLEAN)
CREATE INDEX IF NOT EXISTS idx_annotations_weather
  ON public.annotations (weather);
CREATE INDEX IF NOT EXISTS idx_annotations_environment
  ON public.annotations (environment);
CREATE INDEX IF NOT EXISTS idx_annotations_pkmn_region
  ON public.annotations (pkmn_region);

-- Annotations: JSONB columns filtered with @> (cs.) contains
CREATE INDEX IF NOT EXISTS idx_annotations_background_pokemon
  ON public.annotations USING gin (background_pokemon);
CREATE INDEX IF NOT EXISTS idx_annotations_actions
  ON public.annotations USING gin (actions);
CREATE INDEX IF NOT EXISTS idx_annotations_pose
  ON public.annotations USING gin (pose);

-- Cards: JSONB array columns filtered with @> (cs.) contains
CREATE INDEX IF NOT EXISTS idx_cards_types
  ON public.cards USING gin (types);
CREATE INDEX IF NOT EXISTS idx_cards_subtypes
  ON public.cards USING gin (subtypes);

-- Helper: refresh planner statistics after bulk ingest.
-- Called by push_duckdb_to_supabase.py via RPC with service_role key.
CREATE OR REPLACE FUNCTION public.analyze_cards_and_annotations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  ANALYZE public.cards;
  ANALYZE public.annotations;
$$;

COMMENT ON INDEX idx_annotations_weather IS
  '055: btree for annotations!inner JOIN on weather filter.';
COMMENT ON INDEX idx_annotations_environment IS
  '055: btree for annotations!inner JOIN on environment filter.';
COMMENT ON INDEX idx_annotations_pkmn_region IS
  '055: btree for annotations!inner JOIN on pkmn_region filter.';
COMMENT ON INDEX idx_annotations_background_pokemon IS
  '055: GIN for @> contains filter on background_pokemon.';
COMMENT ON INDEX idx_annotations_actions IS
  '055: GIN for @> contains filter on actions.';
COMMENT ON INDEX idx_annotations_pose IS
  '055: GIN for @> contains filter on pose.';
COMMENT ON INDEX idx_cards_types IS
  '055: GIN for @> contains filter on types (element filter).';
COMMENT ON INDEX idx_cards_subtypes IS
  '055: GIN for @> contains filter on subtypes (specialty filter).';
COMMENT ON FUNCTION public.analyze_cards_and_annotations() IS
  '055: Run ANALYZE on cards + annotations after bulk ingest to keep planner stats fresh.';

-- Fix materialized view TCG bucket: the comment said "excluding Japanese
-- origin_detail" but the SQL was missing the filter (only Pocket had it).
DROP MATERIALIZED VIEW IF EXISTS explore_filter_options;
CREATE MATERIALIZED VIEW explore_filter_options AS
WITH
-- ── TCG (pokemontcg.io + manual, excluding Japanese origin_detail) ──────────
tcg_cards AS (
  SELECT * FROM cards
  WHERE origin IN ('pokemontcg.io', 'manual')
    AND (origin_detail IS NULL OR origin_detail <> 'japanese')
),
tcg_set_ids AS (
  SELECT DISTINCT set_id FROM tcg_cards WHERE set_id IS NOT NULL
),
tcg_sets AS (
  SELECT jsonb_agg(s.obj ORDER BY s.series NULLS LAST, s.name) AS val
  FROM (
    SELECT jsonb_build_object('id', st.id, 'name', st.name, 'series', st.series) AS obj,
           st.series, st.name
    FROM sets st
    WHERE st.id IN (SELECT set_id FROM tcg_set_ids)
  ) s
),

-- ── Pocket (tcgdex, non-Japanese) ───────────────────────────────────────────
pocket_cards AS (
  SELECT * FROM cards
  WHERE origin = 'tcgdex'
    AND (origin_detail IS NULL OR origin_detail <> 'japanese')
),
pocket_set_ids AS (
  SELECT DISTINCT set_id FROM pocket_cards WHERE set_id IS NOT NULL
),
pocket_sets AS (
  SELECT jsonb_agg(s.obj ORDER BY s.series NULLS LAST, s.name) AS val
  FROM (
    SELECT jsonb_build_object('id', st.id, 'name', st.name, 'series', st.series) AS obj,
           st.series, st.name
    FROM sets st
    WHERE st.id IN (SELECT set_id FROM pocket_set_ids)
  ) s
),

-- ── TCG (JPN) (tcgdex + ptcgdb, Japanese-only) ──────────────────────────────
japanese_cards AS (
  SELECT * FROM cards
  WHERE origin IN ('tcgdex', 'ptcgdb')
    AND origin_detail = 'japanese'
),
jpn_set_ids AS (
  SELECT DISTINCT set_id FROM japanese_cards
  WHERE set_id IS NOT NULL
    AND set_id NOT IN ('neo1', 'neo2', 'neo3', 'neo4')
),
jpn_sets AS (
  SELECT jsonb_agg(obj ORDER BY series NULLS LAST, name) AS val
  FROM (
    SELECT jsonb_build_object('id', st.id, 'name', st.name, 'series', st.series) AS obj,
           st.series AS series, st.name AS name
    FROM sets st
    WHERE st.id IN (SELECT set_id FROM jpn_set_ids)
    UNION
    SELECT DISTINCT jsonb_build_object('id', c.set_id, 'name', upper(c.set_id), 'series', NULL::text) AS obj,
           NULL::text AS series, upper(c.set_id) AS name
    FROM japanese_cards c
    WHERE c.set_id IS NOT NULL
      AND c.set_id NOT IN ('neo1', 'neo2', 'neo3', 'neo4')
      AND NOT EXISTS (SELECT 1 FROM sets s2 WHERE s2.id = c.set_id)
  ) sq
),

-- ── Custom (manual only) ────────────────────────────────────────────────────
custom_cards AS (
  SELECT * FROM cards WHERE origin = 'manual'
),

-- ── Shared (pokemon_metadata, annotations) ──────────────────────────────────
pm_regions AS (
  SELECT jsonb_agg(x ORDER BY x) AS val
  FROM (SELECT DISTINCT region AS x FROM pokemon_metadata WHERE region IS NOT NULL AND btrim(region) <> '') sq
),
pm_generations AS (
  SELECT jsonb_agg(x ORDER BY x) AS val
  FROM (SELECT DISTINCT generation AS x FROM pokemon_metadata WHERE generation IS NOT NULL) sq
),
pm_colors AS (
  SELECT jsonb_agg(x ORDER BY x) AS val
  FROM (SELECT DISTINCT color AS x FROM pokemon_metadata WHERE color IS NOT NULL AND btrim(color) <> '') sq
),
pm_evo AS (
  SELECT jsonb_agg(x ORDER BY x) AS val
  FROM (SELECT DISTINCT evolution_chain::text AS x FROM pokemon_metadata WHERE evolution_chain IS NOT NULL) sq
),
pm_names AS (
  SELECT jsonb_agg(x ORDER BY x) AS val
  FROM (SELECT DISTINCT name AS x FROM pokemon_metadata WHERE name IS NOT NULL AND btrim(name) <> '') sq
),
ann_weather AS (
  SELECT jsonb_agg(x ORDER BY x) AS val
  FROM (SELECT DISTINCT weather AS x FROM annotations WHERE weather IS NOT NULL AND btrim(weather) <> '') sq
),
ann_environment AS (
  SELECT jsonb_agg(x ORDER BY x) AS val
  FROM (SELECT DISTINCT environment AS x FROM annotations WHERE environment IS NOT NULL AND btrim(environment) <> '') sq
)

-- ── Assemble the four source rows ───────────────────────────────────────────
SELECT 'tcg' AS source,
  jsonb_build_object(
    'supertypes', (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT supertype AS x FROM tcg_cards WHERE supertype IS NOT NULL AND btrim(supertype) <> '') sq),
    'rarities',   (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT rarity AS x FROM tcg_cards WHERE rarity IS NOT NULL AND btrim(rarity) <> '') sq),
    'sets',       COALESCE((SELECT val FROM tcg_sets), '[]'::jsonb),
    'artists',    (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT artist AS x FROM tcg_cards WHERE artist IS NOT NULL AND btrim(artist) <> '') sq),
    'regions',    COALESCE((SELECT val FROM pm_regions), '[]'::jsonb),
    'generations',COALESCE((SELECT val FROM pm_generations), '[]'::jsonb),
    'colors',     COALESCE((SELECT val FROM pm_colors), '[]'::jsonb),
    'evolution_lines', COALESCE((SELECT val FROM pm_evo), '[]'::jsonb),
    'background_pokemon', COALESCE((SELECT val FROM pm_names), '[]'::jsonb),
    'weathers',   COALESCE((SELECT val FROM ann_weather), '[]'::jsonb),
    'environments',COALESCE((SELECT val FROM ann_environment), '[]'::jsonb),
    'card_types', '[]'::jsonb,
    'elements',   '[]'::jsonb,
    'stages',     '[]'::jsonb,
    'actions',    '[]'::jsonb,
    'poses',      '[]'::jsonb,
    'trainer_types', '[]'::jsonb,
    'specialties', '[]'::jsonb
  ) AS options

UNION ALL

SELECT 'pocket' AS source,
  jsonb_build_object(
    'card_types',  (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT card_type::text AS x FROM pocket_cards WHERE card_type IS NOT NULL AND btrim(card_type::text) <> '') sq),
    'rarities',    (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT rarity AS x FROM pocket_cards WHERE rarity IS NOT NULL AND btrim(rarity) <> '') sq),
    'elements',    (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT element::text AS x FROM pocket_cards WHERE element IS NOT NULL AND btrim(element::text) <> '') sq),
    'stages',      (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT stage::text AS x FROM pocket_cards WHERE stage IS NOT NULL AND btrim(stage::text) <> '') sq),
    'sets',        COALESCE((SELECT val FROM pocket_sets), '[]'::jsonb),
    'supertypes',  '[]'::jsonb,
    'artists',     '[]'::jsonb,
    'regions',     '[]'::jsonb,
    'generations', '[]'::jsonb,
    'colors',      '[]'::jsonb,
    'evolution_lines', '[]'::jsonb,
    'background_pokemon', '[]'::jsonb,
    'weathers',    '[]'::jsonb,
    'environments','[]'::jsonb,
    'actions',     '[]'::jsonb,
    'poses',       '[]'::jsonb,
    'trainer_types', '[]'::jsonb,
    'specialties', '[]'::jsonb
  ) AS options

UNION ALL

SELECT 'japanese' AS source,
  jsonb_build_object(
    'card_types',  (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT card_type::text AS x FROM japanese_cards WHERE card_type IS NOT NULL AND btrim(card_type::text) <> '') sq),
    'rarities',    (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT rarity AS x FROM japanese_cards WHERE rarity IS NOT NULL AND btrim(rarity) <> '') sq),
    'elements',    (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT element::text AS x FROM japanese_cards WHERE element IS NOT NULL AND btrim(element::text) <> '') sq),
    'stages',      (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT stage::text AS x FROM japanese_cards WHERE stage IS NOT NULL AND btrim(stage::text) <> '') sq),
    'artists',     (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT artist AS x FROM japanese_cards WHERE artist IS NOT NULL AND btrim(artist) <> '') sq),
    'sets',        COALESCE((SELECT val FROM jpn_sets), '[]'::jsonb),
    'supertypes',  '[]'::jsonb,
    'regions',     '[]'::jsonb,
    'generations', '[]'::jsonb,
    'colors',      '[]'::jsonb,
    'evolution_lines', '[]'::jsonb,
    'background_pokemon', '[]'::jsonb,
    'weathers',    '[]'::jsonb,
    'environments','[]'::jsonb,
    'actions',     '[]'::jsonb,
    'poses',       '[]'::jsonb,
    'trainer_types', '[]'::jsonb,
    'specialties', '[]'::jsonb
  ) AS options

UNION ALL

SELECT 'custom' AS source,
  jsonb_build_object(
    'supertypes', (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT supertype AS x FROM custom_cards WHERE supertype IS NOT NULL AND btrim(supertype) <> '') sq),
    'rarities',   (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT rarity AS x FROM custom_cards WHERE rarity IS NOT NULL AND btrim(rarity) <> '') sq),
    'artists',    (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT artist AS x FROM custom_cards WHERE artist IS NOT NULL AND btrim(artist) <> '') sq),
    'sets',       (SELECT jsonb_agg(s.obj ORDER BY s.series NULLS LAST, s.name)
                   FROM (SELECT jsonb_build_object('id', st.id, 'name', st.name, 'series', st.series) AS obj, st.series, st.name
                         FROM sets st WHERE st.origin = 'manual') s),
    'card_types', '[]'::jsonb,
    'elements',   '[]'::jsonb,
    'stages',     '[]'::jsonb,
    'regions',    '[]'::jsonb,
    'generations','[]'::jsonb,
    'colors',     '[]'::jsonb,
    'evolution_lines', '[]'::jsonb,
    'background_pokemon', '[]'::jsonb,
    'weathers',   '[]'::jsonb,
    'environments','[]'::jsonb,
    'actions',    '[]'::jsonb,
    'poses',      '[]'::jsonb,
    'trainer_types', '[]'::jsonb,
    'specialties', '[]'::jsonb
  ) AS options;

-- 2. Index for fast source lookup --------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_explore_filter_options_source
ON explore_filter_options (source);

-- 3. Refresh function — called after ingest ----------------------------------
CREATE OR REPLACE FUNCTION refresh_explore_filter_options()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  REFRESH MATERIALIZED VIEW public.explore_filter_options;
$$;

-- Grant to the service role (used by ingest script) and authenticated users
GRANT EXECUTE ON FUNCTION refresh_explore_filter_options() TO service_role;
GRANT EXECUTE ON FUNCTION refresh_explore_filter_options() TO authenticated;
GRANT EXECUTE ON FUNCTION public.analyze_cards_and_annotations() TO service_role;

-- Grant read on the materialized view to authenticated users
GRANT SELECT ON explore_filter_options TO authenticated;
