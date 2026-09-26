-- ============================================================
-- Phase 0B.2 (3/3): Specialty / Action / Pose facets in explore_filter_options
-- ============================================================
-- Before this migration Specialty was hardcoded empty and Action/Pose were
-- static lists only: neither the view (054/055) nor the split RPCs (053)
-- returned specialties/actions/poses.
--
-- Source decision (see remediation plan 0B.2): add the facets to this view
-- instead of a new authenticated RPC. Measured 2026-09-26 as `authenticated`
-- (8 s limit, rolled-back transaction), a distinct scan of cards.subtypes took
-- 6.3 s cold / 2.5 s warm (full 130 MB heap scan plus per-row RLS checks):
-- not reliably "well under 8 s". Inside the view refresh it runs once per
-- ingest as the owner, under the service_role budget, and Explore keeps its
-- <50 ms single-read fast path.
--
-- Trade-off: Action/Pose values added by users between ingests appear after
-- the next refresh (same staleness as weathers/environments today); the
-- client always merges the curated static lists, so no curated value is lost.
--
-- Contract: identical to 055 (four rows keyed by `source`, same 18 option
-- keys); only the tcg row now fills specialties/actions/poses and adds
-- `facets_version`. The body below is 055's definition plus three CTEs.
--
-- Apply AFTER:
--   20260926092111_service_role_maintenance_timeout.sql
--   20260926092113_refresh_explore_filter_options_concurrently.sql
-- CREATE ... WITH DATA populates the view (required for later CONCURRENTLY
-- refreshes). Explore filter-option reads wait on the view lock while this
-- migration runs; the v2 client falls back to the split RPCs if they time out.
--
-- Grants: the dropped view had Supabase default privileges (anon and
-- authenticated had full table privileges). The recreated view gets only
-- SELECT for authenticated and service_role; nothing is widened.

DROP MATERIALIZED VIEW IF EXISTS public.explore_filter_options;

CREATE MATERIALIZED VIEW public.explore_filter_options AS
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
),

-- ── 0B.2 facets: Specialty (card subtypes), Action/Pose (annotations) ──────
-- Specialty mirrors the v1 definition (subtype values naming ACE SPEC, Tool,
-- or Technical Machine) across every origin that carries subtypes.
card_specialties AS (
  SELECT jsonb_agg(x ORDER BY x) AS val
  FROM (
    SELECT DISTINCT btrim(st) AS x
    FROM cards c
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(c.subtypes) = 'array' THEN c.subtypes ELSE '[]'::jsonb END
    ) AS st
    WHERE c.subtypes IS NOT NULL
      AND c.subtypes <> '[]'::jsonb
      AND (st ILIKE '%ace spec%' OR st ILIKE '%tool%' OR st ILIKE '%technical machine%')
  ) sq
),
-- Stored JSONB elements are kept verbatim (trimmed) so each option matches
-- the Explore `actions.cs.[...]` / `pose.cs.[...]` containment filter.
ann_actions AS (
  SELECT jsonb_agg(x ORDER BY x) AS val
  FROM (
    SELECT DISTINCT btrim(a) AS x
    FROM annotations n
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(n.actions) = 'array' THEN n.actions ELSE '[]'::jsonb END
    ) AS a
    WHERE btrim(a) <> ''
  ) sq
),
ann_poses AS (
  SELECT jsonb_agg(x ORDER BY x) AS val
  FROM (
    SELECT DISTINCT btrim(p) AS x
    FROM annotations n
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(n.pose) = 'array' THEN n.pose ELSE '[]'::jsonb END
    ) AS p
    WHERE btrim(p) <> ''
  ) sq
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
    'actions',    COALESCE((SELECT val FROM ann_actions), '[]'::jsonb),
    'poses',      COALESCE((SELECT val FROM ann_poses), '[]'::jsonb),
    'trainer_types', '[]'::jsonb,
    'specialties', COALESCE((SELECT val FROM card_specialties), '[]'::jsonb),
    -- Marker: lets the client tell "facets populated" from the pre-0B.2 view,
    -- whose specialties/actions/poses were always empty placeholders.
    'facets_version', 1
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_explore_filter_options_source
  ON public.explore_filter_options (source);

REVOKE ALL ON public.explore_filter_options FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.explore_filter_options TO authenticated, service_role;

COMMENT ON MATERIALIZED VIEW public.explore_filter_options IS
  'Explore filter options, one row per source. 0B.2: tcg row carries specialties/actions/poses (facets_version=1). Refreshed CONCURRENTLY after ingest.';
