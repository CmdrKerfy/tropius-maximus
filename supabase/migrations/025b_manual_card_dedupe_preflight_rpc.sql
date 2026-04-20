-- ============================================================
-- 025b: Manual card dedupe — read-only preflight RPC (before 026)
-- ============================================================
-- Lets you inspect duplicate manual cards with full `cards` columns
-- (for Explore SQL console → "Show in grid") before running
-- `026_manual_card_id_cleanup.sql`.
--
-- App SQL console (Supabase mode): run exactly:
--   SELECT * FROM get_manual_card_dedupe_preflight();
--
-- `normalize_card_id` is duplicated here from 026 so this migration can ship
-- before 026; 026 will replace the function with the same definition.

CREATE OR REPLACE FUNCTION public.normalize_card_id(p_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(
    regexp_replace(
      btrim(regexp_replace(coalesce(p_id, ''), E'\\s+', '-', 'g')),
      '-+',
      '-',
      'g'
    ),
    '^-+|-+$',
    '',
    'g'
  );
$$;

COMMENT ON FUNCTION public.normalize_card_id(text) IS
  'Collapse whitespace in card id to hyphens (legacy cleanup); keep in sync with scripts/strip_custom_card_ids.py.';

GRANT EXECUTE ON FUNCTION public.normalize_card_id(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_card_id(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_manual_card_dedupe_preflight()
RETURNS TABLE (
  explore_dedupe_row_key text,
  k_sid text,
  k_nm text,
  k_img text,
  role text,
  id text,
  name text,
  set_id text,
  number text,
  image_small text,
  image_large text,
  origin text,
  is_custom boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH manual AS (
    SELECT
      c.id,
      c.name,
      c.set_id,
      c.number,
      c.image_small,
      c.image_large,
      c.origin,
      lower(btrim(c.set_id)) AS k_sid,
      lower(btrim(regexp_replace(coalesce(c.name, ''), E'\\s+', ' ', 'g'))) AS k_nm,
      lower(
        btrim(
          coalesce(
            nullif(btrim(coalesce(c.image_large, '')), ''),
            nullif(btrim(coalesce(c.image_small, '')), '')
          )
        )
      ) AS k_img
    FROM public.cards c
    WHERE c.origin = 'manual'
  ),
  grouped AS (
    SELECT
      array_agg(
        m.id
        ORDER BY
          CASE WHEN m.id = public.normalize_card_id(m.id) THEN 0 ELSE 1 END,
          char_length(m.id),
          m.id
      ) AS ids,
      max(m.k_sid) AS k_sid,
      max(m.k_nm) AS k_nm,
      max(m.k_img) AS k_img
    FROM manual m
    WHERE m.k_img IS NOT NULL
      AND m.k_img <> ''
    GROUP BY m.k_sid, m.k_nm, m.k_img
    HAVING count(*) > 1
  ),
  pairs AS (
    SELECT
      g.k_sid,
      g.k_nm,
      g.k_img,
      (g.ids)[1] AS keeper_id,
      x.loser_id
    FROM grouped g
    CROSS JOIN LATERAL (
      SELECT unnest((g.ids)[2 : array_upper(g.ids, 1)]) AS loser_id
    ) x
  ),
  keeper_rows AS (
    SELECT
      (c.id || '|keeper')::text AS explore_dedupe_row_key,
      p.k_sid,
      p.k_nm,
      p.k_img,
      'keeper'::text AS role,
      c.id,
      c.name,
      c.set_id,
      c.number,
      c.image_small,
      c.image_large,
      c.origin,
      true::boolean AS is_custom
    FROM pairs p
    JOIN public.cards c ON c.id = p.keeper_id
  ),
  loser_rows AS (
    SELECT
      (c.id || '|loser')::text AS explore_dedupe_row_key,
      p.k_sid,
      p.k_nm,
      p.k_img,
      'loser'::text AS role,
      c.id,
      c.name,
      c.set_id,
      c.number,
      c.image_small,
      c.image_large,
      c.origin,
      true::boolean AS is_custom
    FROM pairs p
    JOIN public.cards c ON c.id = p.loser_id
  )
  SELECT *
  FROM (
    SELECT * FROM keeper_rows
    UNION ALL
    SELECT * FROM loser_rows
  ) u
  ORDER BY u.k_sid, u.k_nm, u.k_img, u.role;
$$;

COMMENT ON FUNCTION public.get_manual_card_dedupe_preflight() IS
  'Read-only: duplicate manual cards (same fingerprint as 026), two rows per pair (keeper + loser) with images for UI comparison.';

GRANT EXECUTE ON FUNCTION public.get_manual_card_dedupe_preflight() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_manual_card_dedupe_preflight() TO service_role;
